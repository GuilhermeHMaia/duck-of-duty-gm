import { BLINK_TRIGGER_MS } from '../calibration/calibrationScene';
import type { DebugConfig, FaceFrame } from '../types';
import type { AimState, AimTarget } from './aiming';
import { Duck } from './duck';
import { drawDarkness, drawEnvironmentBack, drawEnvironmentFront, isDark, isLit, type EnvironmentId } from './environments';
import { FocusMeter } from './focusMeter';
import { DUCKS_PER_ROUND, Score } from './score';
import type { WeaponDef } from './weapons';

const DUCKS_PER_WAVE = 2;
const ROUND_INTRO_MS = 1600;
const ROUND_END_MS = 2200;

/**
 * Uma rodada: quantos patos e como voam. speed e escape multiplicam os sliders duckSpeed e
 * duckEscapeMs; turn é o intervalo [mín, máx] ms entre mudanças de direção.
 */
export interface RoundSpec {
  ducks: number;
  speed: number;
  escape: number;
  turn: readonly [number, number];
  armored: number;
  shy: number;
}

/**
 * Treino Livre: curva de dificuldade das 5 rodadas. Rodada 1 é aprendizado; o salto maior
 * fica para as duas últimas.
 */
export const ARCADE_ROUNDS: readonly RoundSpec[] = [
  { ducks: 10, speed: 1.0, escape: 1.0, turn: [2400, 3400], armored: 0, shy: 0 },
  { ducks: 10, speed: 1.2, escape: 0.95, turn: [2000, 3000], armored: 1, shy: 0 },
  { ducks: 10, speed: 1.4, escape: 0.88, turn: [1600, 2500], armored: 1, shy: 0 },
  { ducks: 10, speed: 1.7, escape: 0.8, turn: [1200, 2000], armored: 2, shy: 0 },
  { ducks: 10, speed: 2.0, escape: 0.72, turn: [900, 1500], armored: 2, shy: 0 },
];

export interface GameSetup {
  mode: 'arcade' | 'mission';
  /** Texto do HUD, ex.: "Lago do Vovô · Missão 2". */
  title: string;
  rounds: readonly RoundSpec[];
  environment: EnvironmentId;
  weapon: WeaponDef;
  /** Missão tutorial: mostra dicas passo a passo. */
  tutorial?: boolean;
  /** Meta de patos do objetivo principal, para o HUD. */
  goalHits?: number;
  /** Missão da carreira sendo jogada (mode 'mission'). */
  missionId?: string;
}

/** O que aconteceu na partida — base para estrelas, penas e recorde. */
export interface GameStats {
  ducks: number;
  hits: number;
  escaped: number;
  /** Cartuchos disparados (o super não conta). */
  shots: number;
  /** Cartuchos que derrubaram pelo menos um pato. */
  shotsHit: number;
  supers: number;
  armoredKills: number;
  shyKills: number;
  score: number;
  newRecord: boolean;
}

/** Munição: levantar as sobrancelhas recarrega. Cada rodada começa com o pente cheio. */
const BROW_UP_THRESHOLD = 0.5;
const BROW_RELOAD_HOLD_MS = 250;
/** Super: boca aberta (jawOpen) carrega; ~SUPER_CHARGE_MS de boca aberta acumulada enche a barra. */
const JAW_OPEN_THRESHOLD = 0.4;
const SUPER_CHARGE_MS = 2000;
const ARMORED_MULTIPLIER = 3;
const GROUND_FRACTION = 0.84;     // a grama começa em 84% da altura
const HIT_RADIUS = 48;            // tiro sem snap: distância máxima do centro do pato
const AIM_HISTORY_MS = 1500;
const FLASH_MS = 700;
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

/**
 * A partida: rodadas de patos que saem em duplas, voam e fogem pelo topo. Serve tanto ao
 * Treino Livre (5 rodadas, recorde) quanto às missões da carreira (1 rodada com objetivos).
 *
 * Tiro = piscada deliberada (dois olhos fechados por ≥ BLINK_TRIGGER_MS). A posição do tiro é
 * a da mira preBlinkBufferMs ANTES de os olhos começarem a fechar. O tiro só derruba se o foco
 * naquele instante for ≥ o da arma, e consome o foco todo.
 * Munição: levantar as sobrancelhas recarrega. Super "Rajada": boca aberta enche a barra; cheia,
 * a próxima piscada derruba todos os patos da tela, inclusive os blindados.
 * Floresta: só dá para ver e mirar patos dentro do círculo de luz da mira; os Tímidos fogem dela.
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
  private lastFrameT: number | null = null;
  private lastRenderT: number | null = null;
  private paused = false;
  private lastBonus = 0;
  private closedSince: number | null = null;
  private closureHandled = false;
  private duckSeq = 0;
  private ammo = 0;
  private browUpSince: number | null = null;
  private browHandled = false;
  /** Carga do super, 0–1. Fica cheia até ser usada. */
  private superCharge = 0;
  private superFlashAt = -Infinity;
  private armoredSlots = new Set<number>();
  private shySlots = new Set<number>();
  /** Centro do círculo de luz (a mira antes do snap, do último frame). */
  private light: { x: number; y: number } | null = null;
  private stats: GameStats = emptyStats();

  constructor(
    private readonly config: DebugConfig,
    private readonly onFinish: (stats: GameStats, setup: GameSetup) => void,
  ) {}

  start(setup: GameSetup): void {
    this.setup = setup;
    this.score.startGame();
    this.roundIndex = 0;
    this.flashes = [];
    this.superCharge = 0;
    this.stats = emptyStats();
    this.light = null;
    this.closureHandled = true; // uma piscada já em curso (a que iniciou o jogo) não atira
    this.beginRound(performance.now());
  }

  /** Sai da partida sem registrar resultado (ex.: tecla Esc). */
  stop(): void {
    this.phase = 'idle';
    this.ducks = [];
  }

  getSetup(): GameSetup | null {
    return this.setup;
  }

  getTargets(): AimTarget[] {
    const env = this.setup?.environment ?? 'lake';
    return this.ducks
      .filter((d) => d.isTargetable() && isLit(env, d.x, d.y, this.light))
      .map((d) => ({ id: d.id, x: d.x, y: d.y }));
  }

  /** Chamado a cada frame de tracking, depois de aiming.update. */
  onFrame(frame: FaceFrame, aim: AimState | null): void {
    const t = frame.timestamp;
    const dt = this.lastFrameT === null ? 0 : Math.min(t - this.lastFrameT, MAX_FRAME_DT_MS);
    this.lastFrameT = t;
    this.paused = !frame.faceDetected;
    if (this.paused || !this.setup || this.phase === 'idle' || this.phase === 'done') return;
    if (aim) this.light = { ...aim.unsnapped };

    // Foco: enche com a mira grudada num pato vivo (e visível).
    const snappedDuck = aim?.snappedTargetId && this.getTargets().some((d) => d.id === aim.snappedTargetId)
      ? aim.snappedTargetId
      : null;
    if (this.phase === 'wave') {
      this.focus.update(dt, snappedDuck, this.config.focusFillPerSec, this.config.focusDecayPerSec);
    }

    if (aim) {
      this.aimHistory.push({ t, cursor: { ...aim.cursor }, snappedId: snappedDuck, focus: this.focus.value });
      while (this.aimHistory.length > 0 && this.aimHistory[0].t < t - AIM_HISTORY_MS) this.aimHistory.shift();
    }

    if (this.phase === 'wave' || this.phase === 'roundIntro') this.updateExpressions(frame, dt);

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

    drawEnvironmentBack(ctx, env, screenW, screenH, groundY);
    for (const d of this.ducks) drawDuck(ctx, d);
    drawEnvironmentFront(ctx, env, screenW, screenH, groundY);
    drawDarkness(ctx, env, screenW, screenH, isDark(env) ? (aim?.unsnapped ?? this.light) : null);
    this.drawFlashes(ctx, now);
    if (now - this.superFlashAt < 400) {
      ctx.save();
      ctx.globalAlpha = 0.5 * (1 - (now - this.superFlashAt) / 400);
      ctx.fillStyle = '#fde047';
      ctx.fillRect(0, 0, screenW, screenH);
      ctx.restore();
    }
    if (!setup) return;
    const needFocus = setup.weapon.focusToShoot(this.config);
    if (aim && this.phase === 'wave') drawFocusRing(ctx, aim.cursor.x, aim.cursor.y, this.focus.value, this.focus.value >= needFocus);
    this.drawHud(ctx, screenW, screenH, groundY, needFocus);
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
          if (setup.goalHits) drawText(ctx, cx, cy + 44, `Objetivo: derrube ${setup.goalHits} patos`, 22, '#cbd5e1');
        }
        break;
      case 'roundEnd': {
        const hits = this.score.roundResults.filter((r) => r === 'hit').length;
        drawText(ctx, cx, cy, `${hits} de ${this.score.roundResults.length} patos`, 44, '#f8fafc');
        if (this.lastBonus > 0) drawText(ctx, cx, cy + 44, `Rodada perfeita! +${this.lastBonus}`, 22, '#facc15');
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
    this.score.startRound(round.ducks);
    this.released = 0;
    this.ducks = [];
    this.focus.reset();
    this.ammo = this.setup!.weapon.ammo;
    // Sorteia quais patos da rodada são blindados e tímidos (nunca o primeiro, para dar tempo de aprender).
    const slots = Array.from({ length: round.ducks - 1 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    this.armoredSlots = new Set(slots.slice(0, round.armored));
    this.shySlots = new Set(slots.slice(round.armored, round.armored + round.shy));
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
      if (!wasGone && d.state === 'gone' && d.escaped) {
        this.score.escaped(d.slot);
        this.stats.escaped++;
      }
    }

    switch (this.phase) {
      case 'roundIntro':
        if (now - this.phaseStart >= ROUND_INTRO_MS) {
          this.phase = 'wave';
          this.releaseWave(screenW, groundY);
        }
        break;
      case 'wave':
        if (this.ducks.every((d) => d.state === 'gone')) {
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

  private finish(): void {
    const setup = this.setup!;
    this.stats.score = this.score.total;
    this.stats.newRecord = setup.mode === 'arcade' ? this.score.endGame() : false;
    this.ducks = [];
    this.phase = 'done';
    this.onFinish({ ...this.stats }, setup);
  }

  private releaseWave(screenW: number, groundY: number): void {
    const round = this.currentRound();
    const speed = this.config.duckSpeed * round.speed;
    const count = Math.min(DUCKS_PER_WAVE, round.ducks - this.released);
    this.ducks = [];
    for (let i = 0; i < count; i++) {
      const slot = this.released;
      this.ducks.push(
        new Duck(`duck-${this.duckSeq++}`, slot, screenW, groundY, speed, round.turn, this.armoredSlots.has(slot), this.shySlots.has(slot)),
      );
      this.released++;
      this.stats.ducks++;
    }
    this.focus.reset();
  }

  // ---------- Expressões: sobrancelhas recarregam, boca carrega o super ----------

  private updateExpressions(frame: FaceFrame, dt: number): void {
    const now = performance.now();
    const t = frame.timestamp;
    const capacity = this.setup!.weapon.ammo;

    // Recarga: sobrancelhas levantadas por BROW_RELOAD_HOLD_MS; uma recarga por levantada.
    if ((frame.blendshapes.browInnerUp ?? 0) > BROW_UP_THRESHOLD) {
      this.browUpSince ??= t;
      if (!this.browHandled && t - this.browUpSince >= BROW_RELOAD_HOLD_MS) {
        this.browHandled = true;
        if (this.ammo < capacity) {
          this.ammo = capacity;
          this.flashes.push({ x: 110, y: this.hudBaseY - 40, at: now, text: 'recarregado', hit: true });
        }
      }
    } else {
      this.browUpSince = null;
      this.browHandled = false;
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
    const weapon = setup.weapon;
    const roundNumber = this.roundIndex + 1;

    // Mira de preBlinkBufferMs antes de os olhos começarem a fechar.
    const shot = nearest(this.aimHistory, closureStart - this.config.preBlinkBufferMs);
    const now = performance.now();
    if (!shot) return;

    const visible = this.ducks.filter((d) => d.isTargetable() && isLit(setup.environment, d.x, d.y, this.light));

    // Super cheio: a piscada vira a Rajada — todos os patos visíveis caem, inclusive blindados.
    // Não gasta munição nem foco. Na Floresta, só os que estão na luz.
    if (this.superCharge >= 1) {
      this.superCharge = 0;
      this.superFlashAt = now;
      this.stats.supers++;
      for (const d of visible) this.kill(d, roundNumber, now);
      return;
    }

    if (this.ammo <= 0) {
      this.flashes.push({ ...shot.cursor, at: now, text: 'sem munição · levante as sobrancelhas', hit: false });
      return;
    }
    this.ammo--;
    this.stats.shots++;

    const enoughFocus = shot.focus >= weapon.focusToShoot(this.config) - 1e-9;
    this.focus.consume();
    if (!enoughFocus) {
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

    if (weapon.areaRadius > 0) this.flashes.push({ ...shot.cursor, at: now, text: '', hit: false, });

    let killed = 0;
    for (const d of targets) {
      if (d.armored) {
        this.flashes.push({ x: d.x, y: d.y, at: now, text: 'blindado! use o super', hit: false });
      } else {
        this.kill(d, roundNumber, now);
        killed++;
      }
    }
    if (killed > 0) this.stats.shotsHit++;
    else if (targets.length === 0) this.flashes.push({ ...shot.cursor, at: now, text: 'errou', hit: false });
  }

  private kill(d: Duck, roundNumber: number, now: number): void {
    d.hit();
    this.stats.hits++;
    if (d.armored) this.stats.armoredKills++;
    if (d.shy) this.stats.shyKills++;
    const points = this.score.hit(roundNumber, d.slot, d.armored ? ARMORED_MULTIPLIER : 1);
    this.flashes.push({ x: d.x, y: d.y, at: now, text: `+${points}`, hit: true });
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
    if (this.ammo === 0) hint = 'Sem munição: levante as sobrancelhas para recarregar';
    else if (this.superCharge >= 1) hint = 'Super pronto! Feche os olhos por um instante para a Rajada';
    else if (this.focus.value >= needFocus) hint = 'Anel verde: feche os dois olhos por um instante para atirar';
    else if (this.stats.hits >= 2) hint = 'Dica: abra a boca para carregar o super';
    else hint = 'Olhe para um pato até o anel em volta da mira ficar verde';
    drawText(ctx, screenW / 2, 84, hint, 20, '#fde68a');
  }

  /** Altura da faixa de HUD na grama (usada também para posicionar avisos). */
  private hudBaseY = 0;

  private drawHud(ctx: CanvasRenderingContext2D, screenW: number, screenH: number, groundY: number, needFocus: number): void {
    const setup = this.setup!;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = `600 20px system-ui, 'Segoe UI', sans-serif`;
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'left';
    ctx.fillText(setup.mode === 'arcade' ? `Rodada ${this.roundIndex + 1}/${setup.rounds.length}` : setup.title, 24, 32);
    ctx.textAlign = 'center';
    ctx.fillText(
      setup.mode === 'arcade' ? `${this.score.total}` : `Patos ${this.stats.hits}${setup.goalHits ? ` / ${setup.goalHits}` : ''}`,
      screenW / 2,
      32,
    );
    ctx.textAlign = 'right';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(setup.mode === 'arcade' ? `Recorde ${this.score.record}` : setup.weapon.name, screenW - 24, 32);
    ctx.restore();

    // Placar da rodada: patinhos na grama (amarelo = abatido, vermelho = fugiu; anel = especial).
    const count = this.score.roundResults.length || DUCKS_PER_ROUND;
    const size = count > 10 ? 11 : 14;
    const gap = 8;
    const totalW = count * (size * 2) + (count - 1) * gap;
    const baseY = groundY + (screenH - groundY) / 2;
    this.hudBaseY = baseY;
    for (let i = 0; i < count; i++) {
      const r = this.score.roundResults[i];
      const x = screenW / 2 - totalW / 2 + size + i * (size * 2 + gap);
      ctx.fillStyle = r === 'hit' ? '#facc15' : r === 'miss' ? '#ef4444' : 'rgba(248, 250, 252, 0.35)';
      ctx.beginPath();
      ctx.arc(x, baseY, size, 0, Math.PI * 2);
      ctx.fill();
      if (this.armoredSlots.has(i) || this.shySlots.has(i)) {
        ctx.strokeStyle = this.armoredSlots.has(i) ? '#94a3b8' : '#7dd3fc';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }

    // Munição (direita da grama): cartuchos; aviso quando vazio.
    const shellX = screenW - 24;
    for (let i = 0; i < setup.weapon.ammo; i++) {
      ctx.fillStyle = i < this.ammo ? '#f59e0b' : 'rgba(248, 250, 252, 0.2)';
      ctx.fillRect(shellX - (i + 1) * 20, baseY - 14, 12, 28);
    }
    ctx.save();
    ctx.font = `600 13px system-ui, 'Segoe UI', sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText('MUNIÇÃO', shellX, baseY - 26);
    if (this.ammo === 0 && this.phase === 'wave') {
      ctx.fillStyle = '#fca5a5';
      ctx.fillText('levante as sobrancelhas', shellX, baseY + 30);
    }
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
      ctx.fillStyle = ready ? (Math.floor(performance.now() / 250) % 2 ? '#f472b6' : '#fde047') : '#c084fc';
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
  return { ducks: 0, hits: 0, escaped: 0, shots: 0, shotsHit: 0, supers: 0, armoredKills: 0, shyKills: 0, score: 0, newRecord: false };
}

function nearest(history: AimSnapshot[], t: number): AimSnapshot | null {
  let best: AimSnapshot | null = null;
  for (const h of history) if (!best || Math.abs(h.t - t) < Math.abs(best.t - t)) best = h;
  return best;
}

function drawDuck(ctx: CanvasRenderingContext2D, d: Duck): void {
  if (d.state === 'gone') return;
  const r = Duck.RADIUS;
  ctx.save();
  ctx.translate(d.x, d.y);
  if (d.tumbling) ctx.rotate(Math.PI);
  ctx.scale(d.facing, 1);

  // corpo (blindado: metal cinza; tímido: azulado)
  ctx.fillStyle = d.armored ? '#64748b' : d.shy ? '#3b6b8f' : d.state === 'falling' ? '#8b5a2b' : '#6b4f2a';
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  // asa batendo
  const flap = Math.sin(d.wingPhase) * 0.9;
  ctx.fillStyle = d.shy ? '#2a4d68' : '#4a3720';
  ctx.beginPath();
  ctx.ellipse(-r * 0.15, -r * 0.1, r * 0.55, r * 0.28, -flap, 0, Math.PI * 2);
  ctx.fill();
  // cabeça, olho e bico
  ctx.fillStyle = '#166534';
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
