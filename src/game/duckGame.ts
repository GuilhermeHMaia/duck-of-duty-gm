import { BLINK_TRIGGER_MS } from '../calibration/calibrationScene';
import type { DebugConfig, FaceFrame } from '../types';
import type { AimState, AimTarget } from './aiming';
import { Boss, BOSS_ID } from './boss';
import { Duck } from './duck';
import { drawDarkness, drawEnvironmentBack, drawEnvironmentFront, isDark, isLit, type EnvironmentId } from './environments';
import { FocusMeter } from './focusMeter';
import { DUCKS_PER_ROUND, Score } from './score';
import { sfx } from './sound';
import type { WeaponDef } from './weapons';

const DUCKS_PER_WAVE = 2;
const ROUND_INTRO_MS = 1600;
const ROUND_END_MS = 2200;

/**
 * Uma rodada: quantos patos e como voam. speed e escape multiplicam os sliders duckSpeed e
 * duckEscapeMs; turn é o intervalo [mín, máx] ms entre mudanças de direção.
 * boss: rodada de chefe — o General Grasnado luta enquanto duplas de patos de apoio (ducks
 * por "leva") continuam saindo; a rodada acaba quando ele cai ou o tempo acaba.
 */
export interface RoundSpec {
  ducks: number;
  speed: number;
  escape: number;
  turn: readonly [number, number];
  armored: number;
  shy: number;
  ghost: number;
  boss?: { hp: number; timeLimitMs: number };
}

/**
 * Treino Livre: curva de dificuldade das 5 rodadas. Rodada 1 é aprendizado; o salto maior
 * fica para as duas últimas.
 */
export const ARCADE_ROUNDS: readonly RoundSpec[] = [
  { ducks: 10, speed: 1.0, escape: 1.0, turn: [2400, 3400], armored: 0, shy: 0, ghost: 0 },
  { ducks: 10, speed: 1.2, escape: 0.95, turn: [2000, 3000], armored: 1, shy: 0, ghost: 0 },
  { ducks: 10, speed: 1.4, escape: 0.88, turn: [1600, 2500], armored: 1, shy: 0, ghost: 0 },
  { ducks: 10, speed: 1.7, escape: 0.8, turn: [1200, 2000], armored: 2, shy: 0, ghost: 0 },
  { ducks: 10, speed: 2.0, escape: 0.72, turn: [900, 1500], armored: 2, shy: 0, ghost: 0 },
];

export interface GameSetup {
  mode: 'arcade' | 'mission' | 'daily';
  /** Texto do HUD, ex.: "Lago do Vovô · Missão 2". */
  title: string;
  rounds: readonly RoundSpec[];
  environment: EnvironmentId;
  /** Armas disponíveis (já com melhorias); a primeira começa na mão. Wink direito alterna entre elas. */
  weapons: readonly WeaponDef[];
  /** Missão tutorial: mostra dicas passo a passo. */
  tutorial?: boolean;
  /** Meta de patos do objetivo principal, para o HUD. */
  goalHits?: number;
  /** Missão da carreira sendo jogada (mode 'mission'). */
  missionId?: string;
}

/** O que aconteceu na partida — base para estrelas, penas, conquistas e recorde. */
export interface GameStats {
  ducks: number;
  hits: number;
  escaped: number;
  /** Cartuchos disparados (o super não conta). */
  shots: number;
  /** Cartuchos que derrubaram ou feriram algo. */
  shotsHit: number;
  supers: number;
  armoredKills: number;
  shyKills: number;
  ghostKills: number;
  /** Maior sequência de tiros certeiros. */
  maxCombo: number;
  /** Mais patos derrubados por uma única Rajada. */
  maxSuperKills: number;
  bossDefeated: boolean;
  score: number;
  newRecord: boolean;
}

/**
 * Winks: esquerdo recarrega a arma atual, direito troca de arma. O wink só vale se um olho ficar
 * fechado por WINK_HOLD_MS com o outro aberto o tempo todo; se o outro olho fechar no meio (o
 * começo de uma piscada de tiro), o wink é cancelado. Cada rodada começa com os pentes cheios.
 */
const WINK_HOLD_MS = 250;
/**
 * Recarga pelo olhar: manter a mira (antes do snap) na caixa de munição, no canto da grama, por
 * LOOK_RELOAD_MS recarrega, como "atirar fora da tela" nos jogos de pistola. A caixa tem folga de
 * AMMO_ZONE_PADDING px porque a mira do olho não é precisa. Sair da caixa esvazia o progresso
 * 2× mais rápido do que enche, então um tremor rápido para fora não zera tudo.
 */
export const LOOK_RELOAD_MS = 600;
export const AMMO_ZONE_PADDING = 60;
/** Super: boca aberta (jawOpen) carrega; ~SUPER_CHARGE_MS de boca aberta acumulada enche a barra. */
const JAW_OPEN_THRESHOLD = 0.4;
const SUPER_CHARGE_MS = 2000;
const SUPER_BOSS_DAMAGE = 2;
const ARMORED_MULTIPLIER = 3;
/** Combo: cada tiro certeiro seguido soma 25% nos pontos, até 3×. Erro, "sem foco" ou fuga zeram. */
const COMBO_STEP = 0.25;
const COMBO_MAX_MULTIPLIER = 3;
const MINION_GAP_MS = 1500;
const GROUND_FRACTION = 0.84;     // a grama começa em 84% da altura
const HIT_RADIUS = 48;            // tiro sem snap: distância máxima do centro do pato
const AIM_HISTORY_MS = 1500;
const FLASH_MS = 700;
const SHAKE_MS = 350;
const MAX_FRAME_DT_MS = 100;      // evita "teletransporte" depois de uma aba em segundo plano

type Phase = 'idle' | 'roundIntro' | 'wave' | 'roundEnd' | 'done';

interface AimSnapshot {
  t: number;
  cursor: { x: number; y: number };
  snappedId: string | null;
  focus: number;
}

interface Flash {
  x: number;
  y: number;
  at: number;
  text: string;
  hit: boolean;
}

interface Feather {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  life: number;
  color: string;
}

/**
 * A partida: rodadas de patos que saem em duplas, voam e fogem pelo topo. Serve ao Treino Livre
 * (5 rodadas, recorde), às missões da carreira (1 rodada com objetivos, às vezes com chefe) e ao
 * Desafio Diário.
 *
 * Tiro = piscada deliberada (dois olhos fechados por ≥ BLINK_TRIGGER_MS). A posição do tiro é
 * a da mira preBlinkBufferMs ANTES de os olhos começarem a fechar. O tiro só derruba se o foco
 * naquele instante for ≥ o da arma, e consome o foco todo.
 * Munição: olhar a caixa de munição ou wink esquerdo recarrega; wink direito troca de arma. Super "Rajada": boca aberta enche
 * a barra; cheia, a próxima piscada derruba todos os patos visíveis, inclusive os blindados.
 * Floresta: só dá para ver e mirar patos dentro da luz; os Tímidos fogem dela.
 * Pântano: neblina com clareira na mira; os Fantasmas somem e reaparecem.
 */
export class DuckGame {
  private setup: GameSetup | null = null;
  private phase: Phase = 'idle';
  private phaseStart = 0;
  private roundIndex = 0;
  private released = 0;
  private ducks: Duck[] = [];
  private readonly focus = new FocusMeter();
  private readonly score = new Score();
  private aimHistory: AimSnapshot[] = [];
  private flashes: Flash[] = [];
  private feathers: Feather[] = [];
  private lastFrameT: number | null = null;
  private lastRenderT: number | null = null;
  private paused = false;
  private lastBonus = 0;
  private closedSince: number | null = null;
  private closureHandled = false;
  private duckSeq = 0;
  /** Munição de cada arma (cada uma guarda a sua; trocar não recarrega). */
  private ammoByWeapon = new Map<string, number>();
  private weaponIndex = 0;
  private winkSide: 'left' | 'right' | null = null;
  private winkSince = 0;
  private winkHandled = false;
  /** Depois que os dois olhos fecharam, nenhum wink conta até os dois reabrirem. */
  private winkBlocked = false;
  /** Carga do super, 0–1. Fica cheia até ser usada. */
  private superCharge = 0;
  private superFlashAt = -Infinity;
  private shakeAt = -Infinity;
  private combo = 0;
  private comboAt = -Infinity;
  private armoredSlots = new Set<number>();
  private shySlots = new Set<number>();
  private ghostSlots = new Set<number>();
  private boss: Boss | null = null;
  private bossStart = 0;
  private minionGapStart: number | null = null;
  private endMessage = '';
  /** Centro do círculo de visão (a mira antes do snap, do último frame). */
  private light: { x: number; y: number } | null = null;
  private stats: GameStats = emptyStats();
  /** Caixa de munição na tela (calculada no desenho do HUD) e progresso da recarga pelo olhar. */
  private ammoZone: { x: number; y: number; w: number; h: number } | null = null;
  private lookReloadMs = 0;

  constructor(
    private readonly config: DebugConfig,
    private readonly onFinish: (stats: GameStats, setup: GameSetup) => void,
  ) {}

  start(setup: GameSetup): void {
    this.setup = setup;
    this.score.startGame();
    this.roundIndex = 0;
    this.weaponIndex = 0;
    this.flashes = [];
    this.feathers = [];
    this.superCharge = 0;
    this.combo = 0;
    this.stats = emptyStats();
    this.light = null;
    this.closureHandled = true; // uma piscada já em curso (a que iniciou o jogo) não atira
    this.beginRound(performance.now());
  }

  /** Sai da partida sem registrar resultado (ex.: tecla Esc). */
  stop(): void {
    this.phase = 'idle';
    this.ducks = [];
    this.boss = null;
  }

  getSetup(): GameSetup | null {
    return this.setup;
  }

  getTargets(): AimTarget[] {
    const env = this.setup?.environment ?? 'lake';
    const targets = this.ducks
      .filter((d) => d.isTargetable() && isLit(env, d.x, d.y, this.light))
      .map((d) => ({ id: d.id, x: d.x, y: d.y }));
    // O chefe fica sempre visível, mesmo na neblina: é preciso poder encarar o olho dele.
    if (this.boss?.isTargetable()) targets.push({ id: BOSS_ID, x: this.boss.x, y: this.boss.y });
    return targets;
  }

  /** Chamado a cada frame de tracking, depois de aiming.update. */
  onFrame(frame: FaceFrame, aim: AimState | null): void {
    const t = frame.timestamp;
    const dt = this.lastFrameT === null ? 0 : Math.min(t - this.lastFrameT, MAX_FRAME_DT_MS);
    this.lastFrameT = t;
    this.paused = !frame.faceDetected;
    if (this.paused || !this.setup || this.phase === 'idle' || this.phase === 'done') return;
    if (aim) this.light = { ...aim.unsnapped };

    // Foco: enche com a mira grudada num alvo vivo e visível (pato ou chefe).
    const snapped = aim?.snappedTargetId && this.getTargets().some((d) => d.id === aim.snappedTargetId) ? aim.snappedTargetId : null;
    if (this.phase === 'wave') {
      this.focus.update(dt, snapped, this.config.focusFillPerSec * this.weapon().focusFill, this.config.focusDecayPerSec);
    }

    if (aim) {
      this.aimHistory.push({ t, cursor: { ...aim.cursor }, snappedId: snapped, focus: this.focus.value });
      while (this.aimHistory.length > 0 && this.aimHistory[0].t < t - AIM_HISTORY_MS) this.aimHistory.shift();
    }

    // Chefe: encarar o olho (mira perto dele, olhos abertos e sem piscada começando) abre o escudo.
    if (this.boss && this.phase === 'wave') {
      const looking = !!aim && !aim.eyeFrozen && !frame.eyeState.bothClosed && this.boss.isStaringAt(aim.unsnapped.x, aim.unsnapped.y);
      if (this.boss.stare(dt, looking)) {
        sfx.shieldOpen();
        this.flashes.push({ x: this.boss.x, y: this.boss.y - Boss.RADIUS * 1.6, at: performance.now(), text: 'ESCUDO ABERTO!', hit: true });
      }
    }

    if (this.phase === 'wave' || this.phase === 'roundIntro') {
      this.updateExpressions(frame, dt);
      this.updateLookReload(frame, aim, dt);
    }

    // Gatilho: piscada deliberada, uma ação por piscada.
    if (frame.eyeState.bothClosed) {
      if (this.closedSince === null) {
        this.closedSince = t;
        this.closureHandled = false;
      }
      if (!this.closureHandled && t - this.closedSince >= BLINK_TRIGGER_MS) {
        this.closureHandled = true;
        this.shoot(this.closedSince);
      }
    } else {
      this.closedSince = null;
      this.closureHandled = false;
    }
  }

  render(ctx: CanvasRenderingContext2D, now: number, screenW: number, screenH: number, aim: AimState | null): void {
    const dt = this.lastRenderT === null ? 0 : Math.min(now - this.lastRenderT, MAX_FRAME_DT_MS);
    this.lastRenderT = now;
    const setup = this.setup;
    const env = setup?.environment ?? 'lake';
    const groundY = screenH * GROUND_FRACTION;
    if (!this.paused && setup) this.advance(dt, now, screenW, groundY);
    this.updateFeathers(dt, groundY);

    // Tremida da tela (Rajada, chefe derrotado).
    ctx.save();
    const shake = Math.max(0, 1 - (now - this.shakeAt) / SHAKE_MS);
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 16 * shake, (Math.random() - 0.5) * 16 * shake);

    drawEnvironmentBack(ctx, env, screenW, screenH, groundY);
    for (const d of this.ducks) drawDuck(ctx, d);
    drawEnvironmentFront(ctx, env, screenW, screenH, groundY);
    drawDarkness(ctx, env, screenW, screenH, isDark(env) ? (aim?.unsnapped ?? this.light) : null);
    this.boss?.draw(ctx);
    this.drawFeathers(ctx);
    this.drawFlashes(ctx, now);
    ctx.restore();

    if (now - this.superFlashAt < 400) {
      ctx.save();
      ctx.globalAlpha = 0.5 * (1 - (now - this.superFlashAt) / 400);
      ctx.fillStyle = '#fde047';
      ctx.fillRect(0, 0, screenW, screenH);
      ctx.restore();
    }
    if (!setup) return;
    const weapon = this.weapon();
    const needFocus = weapon.focusToShoot(this.config);
    if (aim && this.phase === 'wave' && weapon.lens && aim.snappedTargetId) drawLens(ctx, aim.cursor.x, aim.cursor.y);
    if (aim && this.phase === 'wave') drawFocusRing(ctx, aim.cursor.x, aim.cursor.y, this.focus.value, this.focus.value >= needFocus);
    this.drawHud(ctx, screenW, screenH, groundY, needFocus, now);
    if (setup.tutorial && this.phase === 'wave') this.drawTutorialHint(ctx, screenW, needFocus);

    const cx = screenW / 2;
    const cy = screenH * 0.42;
    switch (this.phase) {
      case 'roundIntro':
        if (setup.mode === 'arcade') {
          drawText(ctx, cx, cy, `Rodada ${this.roundIndex + 1}`, 48, '#f8fafc');
          drawText(ctx, cx, cy + 44, `${Score.pointsPerDuck(this.roundIndex + 1)} pontos por pato`, 20, '#cbd5e1');
        } else {
          drawText(ctx, cx, cy, setup.title, 40, '#f8fafc');
          const round = this.currentRound();
          const sub = round.boss
            ? 'Encare o olho do General para abrir o escudo'
            : setup.mode === 'daily'
              ? 'Faça o máximo de pontos'
              : setup.goalHits
                ? `Objetivo: derrube ${setup.goalHits} patos`
                : '';
          if (sub) drawText(ctx, cx, cy + 44, sub, 22, '#cbd5e1');
        }
        break;
      case 'roundEnd': {
        if (this.endMessage) {
          drawText(ctx, cx, cy, this.endMessage, 44, '#f8fafc');
        } else {
          const hits = this.score.roundResults.filter((r) => r === 'hit').length;
          drawText(ctx, cx, cy, `${hits} de ${this.score.roundResults.length} patos`, 44, '#f8fafc');
          if (this.lastBonus > 0) drawText(ctx, cx, cy + 44, `Rodada perfeita! +${this.lastBonus}`, 22, '#facc15');
        }
        break;
      }
      default:
        break;
    }
    if (this.paused) drawText(ctx, cx, screenH * 0.2, 'Rosto não detectado — jogo pausado', 22, '#fca5a5');
  }

  // ---------- Fluxo ----------

  private currentRound(): RoundSpec {
    const rounds = this.setup!.rounds;
    return rounds[Math.min(this.roundIndex, rounds.length - 1)];
  }

  private beginRound(now: number): void {
    const round = this.currentRound();
    this.score.startRound(round.boss ? 0 : round.ducks);
    this.released = 0;
    this.ducks = [];
    this.boss = null;
    this.minionGapStart = null;
    this.endMessage = '';
    this.focus.reset();
    this.lookReloadMs = 0;
    this.ammoByWeapon = new Map(this.setup!.weapons.map((w) => [w.id, w.ammo]));
    // Sorteia quais patos da rodada são especiais (nunca o primeiro, para dar tempo de aprender).
    const slots = Array.from({ length: Math.max(0, round.ducks - 1) }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    this.armoredSlots = new Set(slots.slice(0, round.armored));
    this.shySlots = new Set(slots.slice(round.armored, round.armored + round.shy));
    this.ghostSlots = new Set(slots.slice(round.armored + round.shy, round.armored + round.shy + round.ghost));
    this.phase = 'roundIntro';
    this.phaseStart = now;
  }

  private advance(dt: number, now: number, screenW: number, groundY: number): void {
    const env = this.setup!.environment;
    const round = this.currentRound();
    for (const d of this.ducks) {
      const wasGone = d.state === 'gone';
      d.updateLight(dt, isLit(env, d.x, d.y, this.light), this.light);
      d.update(dt, screenW, groundY, this.config.duckEscapeMs * round.escape);
      if (d.consumeQuack() && isLit(env, d.x, d.y, this.light)) sfx.quack();
      if (!wasGone && d.state === 'gone' && d.escaped) {
        this.score.escaped(d.slot);
        this.stats.escaped++;
        this.breakCombo();
      }
    }
    this.boss?.update(dt, screenW);

    switch (this.phase) {
      case 'roundIntro':
        if (now - this.phaseStart >= ROUND_INTRO_MS) {
          this.phase = 'wave';
          if (round.boss) {
            this.boss = new Boss(screenW, groundY, round.boss.hp);
            this.bossStart = now;
          }
          this.releaseWave(screenW, groundY);
        }
        break;
      case 'wave':
        if (round.boss) this.advanceBossRound(now, screenW, groundY, round.boss.timeLimitMs);
        else if (this.ducks.every((d) => d.state === 'gone')) {
          if (this.released < round.ducks) {
            this.releaseWave(screenW, groundY);
          } else {
            this.lastBonus = this.setup!.mode === 'arcade' ? this.score.endRound() : 0;
            this.phase = 'roundEnd';
            this.phaseStart = now;
          }
        }
        break;
      case 'roundEnd':
        if (now - this.phaseStart >= ROUND_END_MS) {
          if (this.roundIndex < this.setup!.rounds.length - 1) {
            this.roundIndex++;
            this.beginRound(now);
          } else {
            this.finish();
          }
        }
        break;
      default:
        break;
    }
  }

  private advanceBossRound(now: number, screenW: number, groundY: number, timeLimitMs: number): void {
    const boss = this.boss!;
    if (boss.state === 'gone') {
      this.stats.bossDefeated = true;
      this.ducks.forEach((d) => d.hit());
      this.endMessage = 'General Grasnado derrotado!';
      this.phase = 'roundEnd';
      this.phaseStart = now;
      return;
    }
    if (boss.state === 'fighting' && now - this.bossStart >= timeLimitMs) {
      this.endMessage = 'Tempo esgotado — o General escapou';
      this.phase = 'roundEnd';
      this.phaseStart = now;
      return;
    }
    // Patos de apoio: uma nova dupla MINION_GAP_MS depois que a anterior some.
    if (boss.state === 'fighting' && this.ducks.every((d) => d.state === 'gone')) {
      this.minionGapStart ??= now;
      if (now - this.minionGapStart >= MINION_GAP_MS) {
        this.minionGapStart = null;
        this.releaseWave(screenW, groundY);
      }
    }
  }

  private finish(): void {
    const setup = this.setup!;
    this.stats.score = this.score.total;
    this.stats.newRecord = setup.mode === 'arcade' ? this.score.endGame() : false;
    this.ducks = [];
    this.boss = null;
    this.phase = 'done';
    this.onFinish({ ...this.stats }, setup);
  }

  private releaseWave(screenW: number, groundY: number): void {
    const round = this.currentRound();
    const speed = this.config.duckSpeed * round.speed;
    this.ducks = [];
    if (round.boss) {
      // Apoio do chefe: sem placar por slot; blindado com a chance proporcional da rodada.
      for (let i = 0; i < DUCKS_PER_WAVE; i++) {
        const armored = Math.random() < round.armored / Math.max(1, round.ducks);
        this.ducks.push(new Duck(`duck-${this.duckSeq++}`, -1, screenW, groundY, speed, round.turn, armored));
        this.stats.ducks++;
      }
      return;
    }
    const count = Math.min(DUCKS_PER_WAVE, round.ducks - this.released);
    for (let i = 0; i < count; i++) {
      const slot = this.released;
      this.ducks.push(
        new Duck(
          `duck-${this.duckSeq++}`, slot, screenW, groundY, speed, round.turn,
          this.armoredSlots.has(slot), this.shySlots.has(slot), this.ghostSlots.has(slot),
        ),
      );
      this.released++;
      this.stats.ducks++;
    }
    this.focus.reset();
  }

  // ---------- Arma atual e munição ----------

  private weapon(): WeaponDef {
    const weapons = this.setup!.weapons;
    return weapons[this.weaponIndex % weapons.length];
  }

  private get ammo(): number {
    return this.ammoByWeapon.get(this.weapon().id) ?? 0;
  }

  private set ammo(value: number) {
    this.ammoByWeapon.set(this.weapon().id, value);
  }

  private reload(now: number): void {
    const capacity = this.weapon().ammo;
    if (this.ammo >= capacity) return;
    this.ammo = capacity;
    sfx.reload();
    this.flashes.push({ x: this.hudShellX - 30, y: this.hudBaseY - 50, at: now, text: 'recarregado', hit: true });
  }

  /** Olhar a caixa de munição recarrega (ver LOOK_RELOAD_MS). Olhos fechados não contam. */
  private updateLookReload(frame: FaceFrame, aim: AimState | null, dt: number): void {
    const zone = this.ammoZone;
    if (!zone || this.ammo >= this.weapon().ammo) {
      this.lookReloadMs = 0;
      return;
    }
    const p = aim?.unsnapped;
    const inside =
      !!p &&
      !frame.eyeState.bothClosed &&
      p.x >= zone.x - AMMO_ZONE_PADDING &&
      p.x <= zone.x + zone.w + AMMO_ZONE_PADDING &&
      p.y >= zone.y - AMMO_ZONE_PADDING &&
      p.y <= zone.y + zone.h + AMMO_ZONE_PADDING;
    this.lookReloadMs = inside ? this.lookReloadMs + dt : Math.max(0, this.lookReloadMs - 2 * dt);
    if (this.lookReloadMs >= LOOK_RELOAD_MS) {
      this.lookReloadMs = 0;
      this.reload(performance.now());
    }
  }

  private switchWeapon(now: number): void {
    const weapons = this.setup!.weapons;
    if (weapons.length < 2) {
      this.flashes.push({ x: this.hudShellX - 60, y: this.hudBaseY - 50, at: now, text: 'você só tem uma arma', hit: false });
      return;
    }
    this.weaponIndex = (this.weaponIndex + 1) % weapons.length;
    this.lookReloadMs = 0;
    sfx.switchWeapon();
    this.flashes.push({ x: this.hudShellX - 80, y: this.hudBaseY - 50, at: now, text: this.weapon().name, hit: true });
  }

  // ---------- Expressões: winks (recarga / troca), boca carrega o super ----------

  private updateExpressions(frame: FaceFrame, dt: number): void {
    const now = performance.now();
    const t = frame.timestamp;

    // Winks, com proteção contra a piscada de tiro (os dois olhos) ser lida como wink.
    const side = frame.eyeState.winkLeft ? 'left' : frame.eyeState.winkRight ? 'right' : null;
    if (frame.eyeState.bothClosed) {
      this.winkBlocked = true;
      this.winkSide = null;
    } else if (!side) {
      this.winkSide = null;
      this.winkBlocked = false;
    } else if (!this.winkBlocked) {
      if (side !== this.winkSide) {
        this.winkSide = side;
        this.winkSince = t;
        this.winkHandled = false;
      } else if (!this.winkHandled && t - this.winkSince >= WINK_HOLD_MS) {
        this.winkHandled = true;
        if (side === 'left') this.reload(now);
        else this.switchWeapon(now);
      }
    }

    // Super: boca aberta acumula carga.
    if (this.superCharge < 1 && (frame.blendshapes.jawOpen ?? 0) > JAW_OPEN_THRESHOLD) {
      this.superCharge = Math.min(1, this.superCharge + dt / SUPER_CHARGE_MS);
    }
  }

  // ---------- Tiro ----------

  private shoot(closureStart: number): void {
    if (this.phase !== 'wave') return;
    const setup = this.setup!;
    const weapon = this.weapon();
    const roundNumber = this.roundIndex + 1;

    // Mira de preBlinkBufferMs antes de os olhos começarem a fechar.
    const shot = nearest(this.aimHistory, closureStart - this.config.preBlinkBufferMs);
    const now = performance.now();
    if (!shot) return;

    const visible = this.ducks.filter((d) => d.isTargetable() && isLit(setup.environment, d.x, d.y, this.light));
    const boss = this.boss?.isTargetable() ? this.boss : null;

    // Super cheio: a piscada vira a Rajada — todos os patos visíveis caem, inclusive blindados.
    // Não gasta munição nem foco. No chefe, só fere com o escudo aberto.
    if (this.superCharge >= 1) {
      this.superCharge = 0;
      this.superFlashAt = now;
      this.shakeAt = now;
      this.stats.supers++;
      sfx.superBlast();
      for (const d of visible) this.kill(d, roundNumber, now, 1);
      this.stats.maxSuperKills = Math.max(this.stats.maxSuperKills, visible.length);
      if (boss) {
        if (boss.shielded) this.flashes.push({ x: boss.x, y: boss.y - Boss.RADIUS * 1.6, at: now, text: 'o escudo bloqueou a Rajada', hit: false });
        else this.damageBoss(boss, SUPER_BOSS_DAMAGE, now);
      }
      return;
    }

    if (this.ammo <= 0) {
      sfx.empty();
      this.flashes.push({ ...shot.cursor, at: now, text: 'sem munição · olhe a caixa de munição', hit: false });
      return;
    }
    this.ammo--;
    this.stats.shots++;
    sfx.shot();

    const enoughFocus = shot.focus >= weapon.focusToShoot(this.config) - 1e-9;
    this.focus.consume();

    // Tiro no chefe (grudado nele ou acertando o corpo).
    const onBoss = boss && (shot.snappedId === BOSS_ID || Math.hypot(boss.x - shot.cursor.x, boss.y - shot.cursor.y) <= Boss.RADIUS * 1.2);
    if (boss && onBoss) {
      if (boss.shielded) {
        sfx.armorBlock();
        this.breakCombo();
        this.flashes.push({ x: boss.x, y: boss.y - Boss.RADIUS * 1.6, at: now, text: 'escudo! encare o olho dele', hit: false });
      } else if (!enoughFocus) {
        this.breakCombo();
        this.flashes.push({ ...shot.cursor, at: now, text: 'sem foco', hit: false });
      } else {
        this.stats.shotsHit++;
        this.bumpCombo();
        this.damageBoss(boss, weapon.bossDamage, now);
      }
      return;
    }

    if (!enoughFocus) {
      this.breakCombo();
      this.flashes.push({ ...shot.cursor, at: now, text: 'sem foco', hit: false });
      return;
    }

    // Quem o tiro atinge: arma de área pega todos no raio; arma normal pega o grudado ou o mais perto.
    const targets =
      weapon.areaRadius > 0
        ? visible.filter((d) => d.id === shot.snappedId || Math.hypot(d.x - shot.cursor.x, d.y - shot.cursor.y) <= weapon.areaRadius)
        : [
            visible.find((d) => d.id === shot.snappedId) ??
              visible.find((d) => Math.hypot(d.x - shot.cursor.x, d.y - shot.cursor.y) <= HIT_RADIUS),
          ].filter((d): d is Duck => !!d);

    if (weapon.areaRadius > 0) this.flashes.push({ ...shot.cursor, at: now, text: '', hit: false });

    const killable = targets.filter((d) => !d.armored || weapon.piercesArmor);
    for (const d of targets) {
      if (d.armored && !weapon.piercesArmor) {
        sfx.armorBlock();
        this.flashes.push({ x: d.x, y: d.y, at: now, text: 'blindado! use o super', hit: false });
      }
    }
    if (killable.length === 0) {
      this.breakCombo();
      if (targets.length === 0) this.flashes.push({ ...shot.cursor, at: now, text: 'errou', hit: false });
      return;
    }
    this.stats.shotsHit++;
    this.bumpCombo();
    for (const d of killable) this.kill(d, roundNumber, now, this.comboMultiplier());
  }

  private damageBoss(boss: Boss, damage: number, now: number): void {
    const defeated = boss.hit(damage);
    this.spawnFeathers(boss.x, boss.y, '#4d3a1f', 14);
    this.flashes.push({ x: boss.x, y: boss.y - Boss.RADIUS, at: now, text: `-${damage}`, hit: true });
    this.score.hit(this.roundIndex + 1, -1, 5 * damage);
    if (defeated) {
      this.shakeAt = now;
      sfx.victory();
    } else {
      sfx.hit();
    }
  }

  private kill(d: Duck, roundNumber: number, now: number, multiplier: number): void {
    d.hit();
    this.stats.hits++;
    if (d.armored) this.stats.armoredKills++;
    if (d.shy) this.stats.shyKills++;
    if (d.ghost) this.stats.ghostKills++;
    const points = this.score.hit(roundNumber, d.slot, (d.armored ? ARMORED_MULTIPLIER : 1) * multiplier);
    this.spawnFeathers(d.x, d.y, d.armored ? '#94a3b8' : d.shy ? '#3b6b8f' : '#8b5a2b', 9);
    sfx.hit();
    this.flashes.push({ x: d.x, y: d.y, at: now, text: `+${Math.round(points)}`, hit: true });
  }

  private comboMultiplier(): number {
    return Math.min(COMBO_MAX_MULTIPLIER, 1 + COMBO_STEP * Math.max(0, this.combo - 1));
  }

  private bumpCombo(): void {
    this.combo++;
    this.comboAt = performance.now();
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
    if (this.combo >= 2) sfx.combo(Math.min(this.combo, 10));
  }

  private breakCombo(): void {
    this.combo = 0;
  }

  // ---------- Penas ----------

  private spawnFeathers(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 160;
      this.feathers.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 60,
        rot: Math.random() * Math.PI, vrot: (Math.random() - 0.5) * 8, life: 1, color,
      });
    }
  }

  private updateFeathers(dtMs: number, groundY: number): void {
    const dt = dtMs / 1000;
    for (const f of this.feathers) {
      f.vx *= 0.96;
      f.vy = f.vy * 0.96 + 140 * dt; // cai devagar, planando
      f.x += f.vx * dt + Math.sin(f.rot) * 20 * dt;
      f.y += f.vy * dt;
      f.rot += f.vrot * dt;
      f.life -= dt * 0.8;
    }
    this.feathers = this.feathers.filter((f) => f.life > 0 && f.y < groundY + 40);
  }

  private drawFeathers(ctx: CanvasRenderingContext2D): void {
    for (const f of this.feathers) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, 9, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(9, 0);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- Desenho ----------

  private drawFlashes(ctx: CanvasRenderingContext2D, now: number): void {
    this.flashes = this.flashes.filter((f) => now - f.at < FLASH_MS);
    for (const f of this.flashes) {
      const k = (now - f.at) / FLASH_MS;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.hit ? '#facc15' : '#f8fafc';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 20 + k * 40, 0, Math.PI * 2);
      ctx.stroke();
      if (f.text) drawText(ctx, f.x, f.y - 50 - k * 20, f.text, f.hit ? 24 : 18, f.hit ? '#facc15' : '#e5e7eb');
      ctx.restore();
    }
  }

  private drawTutorialHint(ctx: CanvasRenderingContext2D, screenW: number, needFocus: number): void {
    let hint: string;
    if (this.ammo === 0) hint = 'Sem munição: olhe para a CAIXA DE MUNIÇÃO (canto de baixo) ou feche só o olho esquerdo';
    else if (this.superCharge >= 1) hint = 'Super pronto! Feche os olhos por um instante para a Rajada';
    else if (this.focus.value >= needFocus) hint = 'Anel verde: feche os dois olhos por um instante para atirar';
    else if (this.stats.hits >= 2) hint = 'Dica: abra a boca para carregar o super';
    else hint = 'Olhe para um pato até o anel em volta da mira ficar verde';
    drawText(ctx, screenW / 2, 84, hint, 20, '#fde68a');
  }

  /** Posição da faixa de HUD na grama (usada também para posicionar avisos). */
  private hudBaseY = 0;
  private hudShellX = 0;

  private drawHud(ctx: CanvasRenderingContext2D, screenW: number, screenH: number, groundY: number, needFocus: number, now: number): void {
    const setup = this.setup!;
    const round = this.currentRound();
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = `600 20px system-ui, 'Segoe UI', sans-serif`;
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'left';
    ctx.fillText(setup.mode === 'arcade' ? `Rodada ${this.roundIndex + 1}/${setup.rounds.length}` : setup.title, 24, 32);
    ctx.textAlign = 'center';
    const center =
      setup.mode === 'mission' && !round.boss
        ? `Patos ${this.stats.hits}${setup.goalHits ? ` / ${setup.goalHits}` : ''}`
        : `${Math.round(this.score.total)} pontos`;
    ctx.fillText(center, screenW / 2, 32);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(setup.mode === 'arcade' ? `Recorde ${this.score.record}` : this.weapon().name, screenW - 24, 32);
    ctx.restore();

    // Combo
    if (this.combo >= 2) {
      const pop = Math.max(0, 1 - (now - this.comboAt) / 250);
      drawText(ctx, screenW / 2, 64, `COMBO ${this.combo}  ·  ×${this.comboMultiplier().toFixed(2).replace(/\.?0+$/, '')}`, 22 + 10 * pop, '#fb923c');
    }

    // Chefe: barra de vida, tempo e estado do escudo.
    const baseY = groundY + (screenH - groundY) / 2;
    this.hudBaseY = baseY;
    if (this.boss && round.boss && this.phase === 'wave') {
      const boss = this.boss;
      const bw = Math.min(420, screenW * 0.5);
      const bx = screenW / 2 - bw / 2;
      const by = 96;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.fillRect(bx, by, bw, 16);
      ctx.fillStyle = boss.shielded ? '#7dd3fc' : '#ef4444';
      ctx.fillRect(bx, by, bw * (boss.hp / boss.maxHp), 16);
      const left = Math.max(0, round.boss.timeLimitMs - (now - this.bossStart));
      const mm = Math.floor(left / 60000);
      const ss = Math.floor((left % 60000) / 1000).toString().padStart(2, '0');
      drawText(ctx, screenW / 2, by - 14, `General Grasnado · ${boss.hp}/${boss.maxHp} · ${mm}:${ss}`, 16, '#f8fafc');
      drawText(
        ctx, screenW / 2, by + 34,
        boss.shielded ? 'ESCUDO — encare o olho dele sem piscar' : `ESCUDO ABERTO — atire! (${Math.ceil(boss.openProgress * 3)} s)`,
        16, boss.shielded ? '#7dd3fc' : '#fca5a5',
      );
    } else {
      // Placar da rodada: patinhos na grama (amarelo = abatido, vermelho = fugiu; anel = especial).
      const count = this.score.roundResults.length || DUCKS_PER_ROUND;
      const size = count > 10 ? 11 : 14;
      const gap = 8;
      const totalW = count * (size * 2) + (count - 1) * gap;
      for (let i = 0; i < count; i++) {
        const r = this.score.roundResults[i];
        const x = screenW / 2 - totalW / 2 + size + i * (size * 2 + gap);
        ctx.fillStyle = r === 'hit' ? '#facc15' : r === 'miss' ? '#ef4444' : 'rgba(248, 250, 252, 0.35)';
        ctx.beginPath();
        ctx.arc(x, baseY, size, 0, Math.PI * 2);
        ctx.fill();
        const special = this.armoredSlots.has(i) ? '#94a3b8' : this.shySlots.has(i) ? '#7dd3fc' : this.ghostSlots.has(i) ? '#e2e8f0' : null;
        if (special) {
          ctx.strokeStyle = special;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
    }

    // Munição (direita da grama): caixa de munição (olhar recarrega), cartuchos e comandos.
    const shellX = screenW - 24;
    this.hudShellX = shellX;
    const shellW = this.weapon().ammo > 4 ? 9 : 12;
    {
      const boxW = Math.max(this.weapon().ammo * (shellW + 8), 300) + 24;
      const zone = { x: shellX + 12 - boxW, y: baseY - 50, w: boxW, h: 100 };
      this.ammoZone = zone;
      const empty = this.ammo === 0 && this.phase === 'wave';
      const progress = Math.min(1, this.lookReloadMs / LOOK_RELOAD_MS);
      ctx.save();
      ctx.fillStyle = 'rgba(66, 32, 6, 0.55)';
      ctx.strokeStyle = empty ? (Math.floor(now / 300) % 2 ? '#fca5a5' : '#f59e0b') : 'rgba(245, 158, 11, 0.45)';
      ctx.lineWidth = empty ? 3 : 1.5;
      ctx.beginPath();
      ctx.roundRect(zone.x, zone.y, zone.w, zone.h, 10);
      ctx.fill();
      ctx.stroke();
      if (progress > 0) {
        ctx.fillStyle = 'rgba(74, 222, 128, 0.35)';
        ctx.fillRect(zone.x + 2, zone.y + zone.h - 10, (zone.w - 4) * progress, 8);
      }
      ctx.restore();
    }
    for (let i = 0; i < this.weapon().ammo; i++) {
      ctx.fillStyle = i < this.ammo ? '#f59e0b' : 'rgba(248, 250, 252, 0.2)';
      ctx.fillRect(shellX - (i + 1) * (shellW + 8), baseY - 14, shellW, 28);
    }
    ctx.save();
    ctx.font = `600 13px system-ui, 'Segoe UI', sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(this.weapon().name.toUpperCase(), shellX, baseY - 26);
    ctx.fillStyle = this.ammo === 0 && this.phase === 'wave' ? '#fca5a5' : '#94a3b8';
    ctx.fillText(
      this.lookReloadMs > 0 ? 'recarregando...' : setup.weapons.length > 1 ? 'olhe aqui ou wink ← recarrega · wink → troca' : 'olhe aqui ou wink ← recarrega',
      shellX,
      baseY + 30,
    );
    ctx.restore();

    // Super (acima da barra de foco): enche com a boca aberta; cheio pisca.
    {
      const bw = 180;
      const bh = 12;
      const bx = 24;
      const by = baseY - bh / 2 - 34;
      const ready = this.superCharge >= 1;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = ready ? (Math.floor(now / 250) % 2 ? '#f472b6' : '#fde047') : '#c084fc';
      ctx.fillRect(bx, by, bw * this.superCharge, bh);
      ctx.font = `600 13px system-ui, 'Segoe UI', sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(ready ? 'SUPER PRONTO · pisque!' : 'SUPER · abra a boca', bx, by - 12);
    }

    // Barra de foco, com a marca do mínimo da arma.
    if (this.phase === 'wave') {
      const bw = 180;
      const bh = 12;
      const bx = 24;
      const by = baseY - bh / 2;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = this.focus.value >= needFocus ? '#4ade80' : '#38bdf8';
      ctx.fillRect(bx, by, bw * this.focus.value, bh);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(bx + bw * needFocus - 1, by - 4, 2, bh + 8);
      ctx.font = `600 13px system-ui, 'Segoe UI', sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText('FOCO', bx, by - 12);
    }
  }
}

function emptyStats(): GameStats {
  return {
    ducks: 0, hits: 0, escaped: 0, shots: 0, shotsHit: 0, supers: 0, armoredKills: 0, shyKills: 0, ghostKills: 0,
    maxCombo: 0, maxSuperKills: 0, bossDefeated: false, score: 0, newRecord: false,
  };
}

function nearest(history: AimSnapshot[], t: number): AimSnapshot | null {
  let best: AimSnapshot | null = null;
  for (const h of history) if (!best || Math.abs(h.t - t) < Math.abs(best.t - t)) best = h;
  return best;
}

/** Lupa do Rifle: amplia 2× a região em volta da mira, desenhando o próprio canvas dentro de um círculo. */
function drawLens(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const radius = 70;
  const zoom = 2;
  const dpr = ctx.getTransform().a;
  const source = ctx.canvas;
  const size = ((radius * 2) / zoom) * dpr;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(source, (x - radius / zoom) * dpr, (y - radius / zoom) * dpr, size, size, x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawDuck(ctx: CanvasRenderingContext2D, d: Duck): void {
  if (d.state === 'gone') return;
  const opacity = d.opacity;
  if (opacity <= 0) return;
  const r = Duck.RADIUS;
  ctx.save();
  ctx.globalAlpha = opacity * (d.ghost ? 0.85 : 1);
  ctx.translate(d.x, d.y);
  if (d.tumbling) ctx.rotate(Math.PI);
  ctx.scale(d.facing, 1);

  // corpo (blindado: metal cinza; tímido: azulado; fantasma: pálido)
  ctx.fillStyle = d.armored ? '#64748b' : d.shy ? '#3b6b8f' : d.ghost ? '#cbd5e1' : d.state === 'falling' ? '#8b5a2b' : '#6b4f2a';
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  // asa batendo
  const flap = Math.sin(d.wingPhase) * 0.9;
  ctx.fillStyle = d.shy ? '#2a4d68' : d.ghost ? '#94a3b8' : '#4a3720';
  ctx.beginPath();
  ctx.ellipse(-r * 0.15, -r * 0.1, r * 0.55, r * 0.28, -flap, 0, Math.PI * 2);
  ctx.fill();
  // cabeça, olho e bico
  ctx.fillStyle = d.ghost ? '#e2e8f0' : '#166534';
  ctx.beginPath();
  ctx.arc(r * 0.85, -r * 0.45, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
  if (d.armored) {
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(r * 0.85, -r * 0.5, r * 0.4, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.7, r * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // olho (tímido: olho grande e assustado, maior ainda quando foge)
  const eyeR = d.shy ? r * (d.fleeing ? 0.2 : 0.14) : r * 0.08;
  if (d.shy) {
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(r * 0.95, -r * 0.55, eyeR * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = d.state === 'falling' ? '#f8fafc' : '#0b0d12';
  ctx.beginPath();
  ctx.arc(r * 0.95, -r * 0.55, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.moveTo(r * 1.15, -r * 0.5);
  ctx.lineTo(r * 1.6, -r * 0.38);
  ctx.lineTo(r * 1.15, -r * 0.28);
  ctx.fill();
  ctx.restore();

  // Balão "QUACK!" avisando que vai fugir.
  if (d.warning) {
    ctx.save();
    ctx.globalAlpha = opacity;
    drawText(ctx, d.x, d.y - r - 18, 'QUACK!', 16, '#fde68a');
    ctx.restore();
  }
}

/** Anel em volta da mira mostrando o foco; fica verde quando dá para atirar. */
function drawFocusRing(ctx: CanvasRenderingContext2D, x: number, y: number, value: number, ready: boolean): void {
  if (value <= 0) return;
  ctx.save();
  ctx.strokeStyle = ready ? '#4ade80' : '#38bdf8';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, 34, -Math.PI / 2, -Math.PI / 2 + value * Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, size: number, color: string): void {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px system-ui, 'Segoe UI', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
