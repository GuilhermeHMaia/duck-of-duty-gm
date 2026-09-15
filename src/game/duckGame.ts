import { BLINK_TRIGGER_MS } from '../calibration/calibrationScene';
import type { DebugConfig, FaceFrame } from '../types';
import type { AimState, AimTarget } from './aiming';
import { Duck } from './duck';
import { FocusMeter } from './focusMeter';
import { DUCKS_PER_ROUND, ROUNDS, Score } from './score';

const DUCKS_PER_WAVE = 2;
const ROUND_INTRO_MS = 1600;
const ROUND_END_MS = 2200;
const SPEED_STEP_PER_ROUND = 0.3;   // rodada 5 = duckSpeed × 2,2
/** Intervalo entre mudanças de direção: longo na rodada 1 (voo previsível), curto na última. */
const TURN_INTERVAL_FIRST: readonly [number, number] = [2200, 3200];
const TURN_INTERVAL_LAST: readonly [number, number] = [900, 1500];
const GROUND_FRACTION = 0.84;     // a grama começa em 84% da altura
const HIT_RADIUS = 48;            // tiro sem snap: distância máxima do centro do pato
const AIM_HISTORY_MS = 1500;
const FLASH_MS = 700;
const MAX_FRAME_DT_MS = 100;      // evita "teletransporte" depois de uma aba em segundo plano

type Phase = 'roundIntro' | 'wave' | 'roundEnd' | 'gameOver';

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
 * O jogo: 5 rodadas de 10 patos, que saem em duplas, voam e fogem pelo topo.
 *
 * Tiro = piscada deliberada (dois olhos fechados por ≥ BLINK_TRIGGER_MS). A posição do
 * tiro é a da mira preBlinkBufferMs ANTES de os olhos começarem a fechar, lida do
 * histórico — fechar os olhos não desvia o tiro. O tiro só derruba se o foco naquele
 * instante for ≥ focusToShoot, e consome o foco todo.
 */
export class DuckGame {
  private phase: Phase = 'gameOver';
  private phaseStart = 0;
  private round = 1;
  private released = 0;
  private ducks: Duck[] = [];
  private readonly focus = new FocusMeter();
  private readonly score = new Score();
  private aimHistory: AimSnapshot[] = [];
  private flashes: Flash[] = [];
  private lastFrameT: number | null = null;
  private lastRenderT: number | null = null;
  private paused = false;
  private newRecord = false;
  private lastBonus = 0;
  private closedSince: number | null = null;
  private closureHandled = false;
  private duckSeq = 0;

  constructor(private readonly config: DebugConfig) {}

  start(): void {
    this.score.startGame();
    this.round = 1;
    this.newRecord = false;
    this.flashes = [];
    this.closureHandled = true; // uma piscada já em curso (a que iniciou o jogo) não atira
    this.beginRound(performance.now());
  }

  getTargets(): AimTarget[] {
    return this.ducks.filter((d) => d.isTargetable()).map((d) => ({ id: d.id, x: d.x, y: d.y }));
  }

  /** Chamado a cada frame de tracking, depois de aiming.update. */
  onFrame(frame: FaceFrame, aim: AimState | null): void {
    const t = frame.timestamp;
    const dt = this.lastFrameT === null ? 0 : Math.min(t - this.lastFrameT, MAX_FRAME_DT_MS);
    this.lastFrameT = t;
    this.paused = !frame.faceDetected;
    if (this.paused) return;

    // Foco: enche com a mira grudada num pato vivo.
    const snappedDuck = aim?.snappedTargetId && this.ducks.some((d) => d.id === aim.snappedTargetId && d.isTargetable())
      ? aim.snappedTargetId
      : null;
    if (this.phase === 'wave') {
      this.focus.update(dt, snappedDuck, this.config.focusFillPerSec, this.config.focusDecayPerSec);
    }

    if (aim) {
      this.aimHistory.push({ t, cursor: { ...aim.cursor }, snappedId: snappedDuck, focus: this.focus.value });
      while (this.aimHistory.length > 0 && this.aimHistory[0].t < t - AIM_HISTORY_MS) this.aimHistory.shift();
    }

    // Gatilho: piscada deliberada, uma ação por piscada.
    if (frame.eyeState.bothClosed) {
      if (this.closedSince === null) {
        this.closedSince = t;
        this.closureHandled = false;
      }
      if (!this.closureHandled && t - this.closedSince >= BLINK_TRIGGER_MS) {
        this.closureHandled = true;
        this.onDeliberateBlink(this.closedSince);
      }
    } else {
      this.closedSince = null;
      this.closureHandled = false;
    }
  }

  render(ctx: CanvasRenderingContext2D, now: number, screenW: number, screenH: number, aim: AimState | null): void {
    const dt = this.lastRenderT === null ? 0 : Math.min(now - this.lastRenderT, MAX_FRAME_DT_MS);
    this.lastRenderT = now;
    const groundY = screenH * GROUND_FRACTION;
    if (!this.paused) this.advance(dt, now, screenW, groundY);

    drawBackground(ctx, screenW, screenH, groundY);
    for (const d of this.ducks) drawDuck(ctx, d);
    drawGrass(ctx, screenW, screenH, groundY);
    this.drawFlashes(ctx, now);
    if (aim && this.phase === 'wave') drawFocusRing(ctx, aim.cursor.x, aim.cursor.y, this.focus.value, this.focus.value >= this.config.focusToShoot);
    this.drawHud(ctx, screenW, screenH, groundY);

    const cx = screenW / 2;
    const cy = screenH * 0.42;
    switch (this.phase) {
      case 'roundIntro':
        drawText(ctx, cx, cy, `Rodada ${this.round}`, 48, '#f8fafc');
        drawText(ctx, cx, cy + 44, `${Score.pointsPerDuck(this.round)} pontos por pato`, 20, '#cbd5e1');
        break;
      case 'roundEnd': {
        const hits = this.score.roundResults.filter((r) => r === 'hit').length;
        drawText(ctx, cx, cy, `${hits} de ${DUCKS_PER_ROUND} patos`, 44, '#f8fafc');
        if (this.lastBonus > 0) drawText(ctx, cx, cy + 44, `Rodada perfeita! +${this.lastBonus}`, 22, '#facc15');
        break;
      }
      case 'gameOver':
        drawText(ctx, cx, cy - 40, 'Fim de jogo', 48, '#f8fafc');
        drawText(ctx, cx, cy + 10, `${this.score.total} pontos · ${this.score.hitsTotal}/${ROUNDS * DUCKS_PER_ROUND} patos`, 24, '#cbd5e1');
        drawText(ctx, cx, cy + 48, this.newRecord ? 'Novo recorde!' : `Recorde: ${this.score.record}`, 22, this.newRecord ? '#facc15' : '#94a3b8');
        drawText(ctx, cx, cy + 92, 'Feche os dois olhos por um instante para jogar de novo', 18, '#94a3b8');
        break;
      case 'wave':
        break;
    }
    if (this.paused) drawText(ctx, cx, screenH * 0.2, 'Rosto não detectado — jogo pausado', 22, '#fca5a5');
  }

  // ---------- Fluxo ----------

  private beginRound(now: number): void {
    this.score.startRound();
    this.released = 0;
    this.ducks = [];
    this.focus.reset();
    this.phase = 'roundIntro';
    this.phaseStart = now;
  }

  private advance(dt: number, now: number, screenW: number, groundY: number): void {
    for (const d of this.ducks) {
      const wasGone = d.state === 'gone';
      d.update(dt, screenW, groundY, this.config.duckEscapeMs);
      if (!wasGone && d.state === 'gone' && d.escaped) this.score.escaped(d.slot);
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
          if (this.released < DUCKS_PER_ROUND) {
            this.releaseWave(screenW, groundY);
          } else {
            this.lastBonus = this.score.endRound();
            this.phase = 'roundEnd';
            this.phaseStart = now;
          }
        }
        break;
      case 'roundEnd':
        if (now - this.phaseStart >= ROUND_END_MS) {
          if (this.round < ROUNDS) {
            this.round++;
            this.beginRound(now);
          } else {
            this.newRecord = this.score.endGame();
            this.ducks = [];
            this.phase = 'gameOver';
          }
        }
        break;
      case 'gameOver':
        break;
    }
  }

  private releaseWave(screenW: number, groundY: number): void {
    const speed = this.config.duckSpeed * (1 + SPEED_STEP_PER_ROUND * (this.round - 1));
    const count = Math.min(DUCKS_PER_WAVE, DUCKS_PER_ROUND - this.released);
    this.ducks = [];
    for (let i = 0; i < count; i++) {
      const k = (this.round - 1) / Math.max(1, ROUNDS - 1);
      const turn: [number, number] = [
        TURN_INTERVAL_FIRST[0] + (TURN_INTERVAL_LAST[0] - TURN_INTERVAL_FIRST[0]) * k,
        TURN_INTERVAL_FIRST[1] + (TURN_INTERVAL_LAST[1] - TURN_INTERVAL_FIRST[1]) * k,
      ];
      this.ducks.push(new Duck(`duck-${this.duckSeq++}`, this.released, screenW, groundY, speed, turn));
      this.released++;
    }
    this.focus.reset();
  }

  // ---------- Tiro ----------

  private onDeliberateBlink(closureStart: number): void {
    if (this.phase === 'gameOver') {
      this.start();
      return;
    }
    if (this.phase !== 'wave') return;

    // Mira de preBlinkBufferMs antes de os olhos começarem a fechar.
    const at = closureStart - this.config.preBlinkBufferMs;
    const shot = nearest(this.aimHistory, at);
    const now = performance.now();
    if (!shot) return;

    const enoughFocus = shot.focus >= this.config.focusToShoot - 1e-9;
    this.focus.consume();

    const alive = this.ducks.filter((d) => d.isTargetable());
    const duck =
      alive.find((d) => d.id === shot.snappedId) ??
      alive.find((d) => Math.hypot(d.x - shot.cursor.x, d.y - shot.cursor.y) <= HIT_RADIUS);

    if (!enoughFocus) {
      this.flashes.push({ ...shot.cursor, at: now, text: 'sem foco', hit: false });
      return;
    }
    if (duck) {
      duck.hit();
      const points = this.score.hit(this.round, duck.slot);
      this.flashes.push({ x: duck.x, y: duck.y, at: now, text: `+${points}`, hit: true });
    } else {
      this.flashes.push({ ...shot.cursor, at: now, text: 'errou', hit: false });
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
      drawText(ctx, f.x, f.y - 50 - k * 20, f.text, f.hit ? 24 : 18, f.hit ? '#facc15' : '#e5e7eb');
      ctx.restore();
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D, screenW: number, screenH: number, groundY: number): void {
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = `600 20px system-ui, 'Segoe UI', sans-serif`;
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'left';
    ctx.fillText(`Rodada ${this.round}/${ROUNDS}`, 24, 32);
    ctx.textAlign = 'center';
    ctx.fillText(`${this.score.total}`, screenW / 2, 32);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`Recorde ${this.score.record}`, screenW - 24, 32);
    ctx.restore();

    // Placar da rodada: 10 patinhos na grama (amarelo = abatido, vermelho = fugiu).
    const size = 14;
    const gap = 10;
    const totalW = DUCKS_PER_ROUND * (size * 2) + (DUCKS_PER_ROUND - 1) * gap;
    const baseY = groundY + (screenH - groundY) / 2;
    for (let i = 0; i < DUCKS_PER_ROUND; i++) {
      const r = this.score.roundResults[i];
      ctx.fillStyle = r === 'hit' ? '#facc15' : r === 'miss' ? '#ef4444' : 'rgba(248, 250, 252, 0.35)';
      ctx.beginPath();
      ctx.arc(screenW / 2 - totalW / 2 + size + i * (size * 2 + gap), baseY, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Barra de foco no canto inferior esquerdo, com a marca do mínimo para atirar.
    if (this.phase === 'wave') {
      const bw = 180;
      const bh = 12;
      const bx = 24;
      const by = baseY - bh / 2;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = this.focus.value >= this.config.focusToShoot ? '#4ade80' : '#38bdf8';
      ctx.fillRect(bx, by, bw * this.focus.value, bh);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(bx + bw * this.config.focusToShoot - 1, by - 4, 2, bh + 8);
      ctx.font = `600 13px system-ui, 'Segoe UI', sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText('FOCO', bx, by - 12);
    }
  }
}

function nearest(history: AimSnapshot[], t: number): AimSnapshot | null {
  let best: AimSnapshot | null = null;
  for (const h of history) if (!best || Math.abs(h.t - t) < Math.abs(best.t - t)) best = h;
  return best;
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, groundY: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, '#0f1b33');
  sky.addColorStop(1, '#27456b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
}

function drawGrass(ctx: CanvasRenderingContext2D, w: number, h: number, groundY: number): void {
  ctx.fillStyle = '#1f4d2b';
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.fillStyle = '#2d6a3a';
  for (let x = 0; x < w; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, groundY + 2);
    ctx.lineTo(x + 9, groundY - 16);
    ctx.lineTo(x + 18, groundY + 2);
    ctx.fill();
  }
}

function drawDuck(ctx: CanvasRenderingContext2D, d: Duck): void {
  if (d.state === 'gone') return;
  const r = Duck.RADIUS;
  ctx.save();
  ctx.translate(d.x, d.y);
  if (d.tumbling) ctx.rotate(Math.PI);
  ctx.scale(d.facing, 1);

  // corpo
  ctx.fillStyle = d.state === 'falling' ? '#8b5a2b' : '#6b4f2a';
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  // asa batendo
  const flap = Math.sin(d.wingPhase) * 0.9;
  ctx.fillStyle = '#4a3720';
  ctx.beginPath();
  ctx.ellipse(-r * 0.15, -r * 0.1, r * 0.55, r * 0.28, -flap, 0, Math.PI * 2);
  ctx.fill();
  // cabeça, olho e bico
  ctx.fillStyle = '#166534';
  ctx.beginPath();
  ctx.arc(r * 0.85, -r * 0.45, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = d.state === 'falling' ? '#f8fafc' : '#0b0d12';
  ctx.beginPath();
  ctx.arc(r * 0.95, -r * 0.55, r * 0.08, 0, Math.PI * 2);
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
