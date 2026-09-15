import type { AimState, AimTarget } from '../game/aiming';
import type { FrameBuffer } from '../tracking/frameBuffer';
import type { DebugConfig, FaceFrame } from '../types';
import { median, type CalibrationSample, type CalibrationStore } from './calibrationStore';

// ---------- Parâmetros da coleta ----------
const SETTLE_MS = 400;            // atraso entre o alvo aparecer e a captura ser habilitada
const WINDOW_START_MS = 500;      // janela de amostra: de 500 ms…
const WINDOW_END_MS = 150;        // …a 150 ms antes do início do fechamento
const MIN_WINDOW_FRAMES = 4;      // menos que isso, mediana e desvio não significam nada
const MAX_HEAD_RANGE_DEG = 5;     // variação máxima da cabeça dentro da janela, por eixo
const MAX_HEAD_FROM_OTHERS_DEG = 5; // distância máxima da pose até a mediana das amostras já aceitas
/** Desvio padrão máximo de cada feature na janela, em larguras de olho (unidade crua das features). */
const FEATURE_STD_LIMIT = 0.02;
const FEATURE_NAMES = ['lx', 'ly', 'rx', 'ry'];

// ---------- Apresentação ----------
const PASSES = 2;
const TARGET_RADIUS = 40;
const FALL_MS = 600;
const NEXT_TARGET_GAP_MS = 300;
const POP_MS = 200;
const BAD_POINT_PX = 150;
const GRID_MARGIN = 0.1;

type Phase = 'intro' | 'target' | 'falling' | 'results' | 'free';

export interface DiscardInfo {
  reason: string;
  at: number;
  pointIndex: number;
}

export interface CalibrationSceneHooks {
  setPanelCollapsed(collapsed: boolean): void;
}

/**
 * Estande de Treino: uma cena de aquecimento que, por baixo, coleta as amostras da
 * calibração. Depois do resultado vira a "mira livre" com os 9 alvos parados.
 */
export class CalibrationScene {
  private phase: Phase = 'free';
  private queue: number[] = [];
  private currentPoint = 0;
  private appearedAt = 0;
  private fallStart = 0;
  private armed = false;
  private samples: CalibrationSample[] = [];
  private totalInRun = 0;
  private repeating: number | null = null;
  private worstPoint: number | null = null;
  private resultError: string | null = null;

  /** Último descarte de amostra, com o motivo (mostrado só no painel). */
  lastDiscard: DiscardInfo | null = null;

  constructor(
    private readonly config: DebugConfig,
    private readonly store: CalibrationStore,
    private readonly buffer: FrameBuffer,
    private readonly hooks: CalibrationSceneHooks,
  ) {}

  /** Abre o Estande do zero (tela inicial). */
  start(): void {
    this.phase = 'intro';
    this.samples = [];
    this.queue = [];
    this.repeating = null;
    this.worstPoint = null;
    this.resultError = null;
    this.lastDiscard = null;
    this.armed = false;
    this.hooks.setPanelCollapsed(true);
  }

  showFreeAim(): void {
    this.phase = 'free';
  }

  /** Durante a coleta o cursor fica escondido para não puxar o olhar. */
  hidesCursor(): boolean {
    return this.phase === 'intro' || this.phase === 'target' || this.phase === 'falling';
  }

  getTargets(screenW: number, screenH: number): AimTarget[] {
    if (this.phase === 'target') return [gridTarget(this.currentPoint, screenW, screenH)];
    if (this.phase === 'free') return Array.from({ length: 9 }, (_, i) => gridTarget(i, screenW, screenH));
    return [];
  }

  /** Chamado a cada frame de tracking (já empurrado no buffer). */
  onFrame(frame: FaceFrame, screenW: number, screenH: number): void {
    const c = this.config;
    const blinkL = frame.blendshapes.eyeBlinkLeft ?? 0;
    const blinkR = frame.blendshapes.eyeBlinkRight ?? 0;
    // Rearma só depois que o wink termina (a diferença entre os olhos volta abaixo do
    // limiar) e sem piscada dupla em curso: um wink = uma ação.
    if (frame.faceDetected && Math.abs(blinkL - blinkR) <= c.winkThreshold && !frame.eyeState.bothClosed) {
      this.armed = true;
    }

    const wink = frame.eyeState.winkLeft ? 'left' : frame.eyeState.winkRight ? 'right' : null;
    if (!wink || !this.armed) return;
    this.armed = false;

    const now = performance.now();
    switch (this.phase) {
      case 'intro':
        this.beginRun(shuffledPasses(), now);
        break;
      case 'target':
        if (now < this.appearedAt + SETTLE_MS) return; // captura ainda não habilitada
        this.capture(wink, screenW, screenH, now);
        break;
      case 'results':
        if (this.worstPoint !== null && wink === 'left') {
          this.repeatPoint(this.worstPoint, now);
        } else {
          this.phase = 'free';
        }
        break;
      default:
        break;
    }
  }

  render(ctx: CanvasRenderingContext2D, now: number, screenW: number, screenH: number, aim: AimState | null): void {
    if (this.phase === 'falling' && now > this.fallStart + FALL_MS + NEXT_TARGET_GAP_MS) {
      this.advance(screenW, screenH, now);
    }

    switch (this.phase) {
      case 'intro':
        drawText(ctx, screenW / 2, screenH / 2 - 30, 'Estande de Treino', 44, '#f8fafc');
        drawText(ctx, screenW / 2, screenH / 2 + 20, 'acerte os alvos para calibrar sua mira', 22, '#cbd5e1');
        drawText(ctx, screenW / 2, screenH / 2 + 70, 'Melhor de duas rodadas · dê um wink para começar', 18, '#94a3b8');
        break;

      case 'target': {
        const t = gridTarget(this.currentPoint, screenW, screenH);
        const pop = Math.min(1, (now - this.appearedAt) / POP_MS);
        drawTarget(ctx, t.x, t.y, TARGET_RADIUS * (0.6 + 0.4 * easeOut(pop)), 1, false);
        this.drawHud(ctx, screenW);
        break;
      }

      case 'falling': {
        const t = gridTarget(this.currentPoint, screenW, screenH);
        const k = Math.min(1, (now - this.fallStart) / FALL_MS);
        ctx.save();
        ctx.translate(t.x, t.y + easeIn(k) * 220);
        ctx.rotate(easeIn(k) * 1.2);
        drawTarget(ctx, 0, 0, TARGET_RADIUS, 1 - k, false);
        ctx.restore();
        this.drawHud(ctx, screenW);
        break;
      }

      case 'results':
        this.drawResults(ctx, screenW, screenH);
        break;

      case 'free': {
        for (let i = 0; i < 9; i++) {
          const t = gridTarget(i, screenW, screenH);
          drawTarget(ctx, t.x, t.y, TARGET_RADIUS, 1, aim?.snappedTargetId === t.id);
        }
        break;
      }
    }
  }

  // ---------- Fluxo ----------

  private beginRun(order: number[], now: number): void {
    this.queue = order;
    this.totalInRun = order.length;
    this.showNextTarget(now);
  }

  private repeatPoint(point: number, now: number): void {
    this.repeating = point;
    this.samples = this.samples.filter((s) => s.pointIndex !== point);
    this.hooks.setPanelCollapsed(true);
    this.beginRun([point, point], now);
  }

  private showNextTarget(now: number): void {
    this.currentPoint = this.queue.shift()!;
    this.appearedAt = now;
    this.phase = 'target';
  }

  private advance(screenW: number, screenH: number, now: number): void {
    if (this.queue.length > 0) {
      this.showNextTarget(now);
      return;
    }
    this.finish(screenW, screenH);
  }

  private finish(screenW: number, screenH: number): void {
    this.repeating = null;
    this.resultError = null;
    this.worstPoint = null;
    try {
      const model = this.store.fit(this.samples, screenW, screenH);
      let worst = -1;
      model.residuals.forEach((r, i) => {
        if (r > BAD_POINT_PX && (worst < 0 || r > model.residuals[worst])) worst = i;
      });
      this.worstPoint = worst >= 0 ? worst : null;
    } catch (err) {
      console.error('[calibração] falha no treino', err);
      this.resultError = err instanceof Error ? err.message : String(err);
    }
    this.phase = 'results';
    this.hooks.setPanelCollapsed(false);
  }

  // ---------- Coleta ----------

  private capture(wink: 'left' | 'right', screenW: number, screenH: number, now: number): void {
    const result = this.buildSample(wink, screenW, screenH);
    if (typeof result === 'string') {
      // Descartado: registra o motivo no painel e o mesmo alvo "reaparece", sem aviso na cena.
      this.lastDiscard = { reason: result, at: now, pointIndex: this.currentPoint };
      this.appearedAt = now;
      return;
    }
    this.samples.push(result);
    this.phase = 'falling';
    this.fallStart = now;
  }

  /** Monta a amostra a partir da janela pré-wink do frameBuffer, ou devolve o motivo do descarte. */
  private buildSample(wink: 'left' | 'right', screenW: number, screenH: number): CalibrationSample | string {
    const c = this.config;
    const frames = this.buffer.getFrames();
    if (frames.length === 0) return 'Buffer vazio';

    // Início do fechamento: primeiro frame da sequência consecutiva que confirmou o wink.
    const closing = (f: FaceFrame): boolean => {
      const l = f.blendshapes.eyeBlinkLeft ?? 0;
      const r = f.blendshapes.eyeBlinkRight ?? 0;
      return wink === 'left' ? l - r > c.winkThreshold : r - l > c.winkThreshold;
    };
    let i = frames.length - 1;
    while (i >= 0 && frames[i].faceDetected && closing(frames[i])) i--;
    const closureStart = frames[Math.min(i + 1, frames.length - 1)].timestamp;

    const from = closureStart - WINDOW_START_MS;
    const to = closureStart - WINDOW_END_MS;

    if (from < this.appearedAt + SETTLE_MS) {
      return 'Wink cedo demais: a janela de 500 ms começa antes do olhar se acomodar no alvo';
    }
    if (frames[0].timestamp > from) return 'O buffer não cobre a janela de 500 ms';

    const win = frames.filter((f) => f.timestamp >= from && f.timestamp <= to);
    if (win.length < MIN_WINDOW_FRAMES) {
      return `Poucos frames na janela (${win.length} < ${MIN_WINDOW_FRAMES}) — FPS da câmera baixo`;
    }
    if (win.some((f) => !f.faceDetected)) return 'Rosto perdido em algum frame da janela';
    if (win.some((f) => !f.gazeFeatures)) return 'Olho fechado ou perdido em algum frame da janela';

    const axes = ['yaw', 'pitch', 'roll'] as const;
    for (const axis of axes) {
      const values = win.map((f) => f.headPose[axis]);
      const range = Math.max(...values) - Math.min(...values);
      if (range > MAX_HEAD_RANGE_DEG) {
        return `Cabeça variou ${range.toFixed(1)}° em ${axis} na janela (máx. ${MAX_HEAD_RANGE_DEG}°)`;
      }
    }

    const features = FEATURE_NAMES.map((_, k) => win.map((f) => f.gazeFeatures![k]));
    for (let k = 0; k < features.length; k++) {
      const sd = stdDev(features[k]);
      if (sd > FEATURE_STD_LIMIT) {
        return `Olhar instável: σ(${FEATURE_NAMES[k]}) = ${sd.toFixed(3)} > ${FEATURE_STD_LIMIT}`;
      }
    }

    const headPose = {
      yaw: median(win.map((f) => f.headPose.yaw)),
      pitch: median(win.map((f) => f.headPose.pitch)),
      roll: median(win.map((f) => f.headPose.roll)),
    };

    // A cabeça precisa estar perto da posição das amostras já aceitas; senão parte do
    // deslocamento até o alvo foi feita pela cabeça e contaminaria o modelo ocular.
    if (this.samples.length > 0) {
      for (const axis of axes) {
        const ref = median(this.samples.map((s) => s.headPose[axis]));
        const d = Math.abs(headPose[axis] - ref);
        if (d > MAX_HEAD_FROM_OTHERS_DEG) {
          return `Cabeça a ${d.toFixed(1)}° (${axis}) da posição das outras amostras (máx. ${MAX_HEAD_FROM_OTHERS_DEG}°)`;
        }
      }
    }

    const target = gridTarget(this.currentPoint, screenW, screenH);
    return {
      features: features.map(median),
      headPose,
      target: { x: target.x, y: target.y },
      pointIndex: this.currentPoint,
    };
  }

  // ---------- Desenho ----------

  private drawHud(ctx: CanvasRenderingContext2D, screenW: number): void {
    const label =
      this.repeating !== null
        ? 'Tiro extra'
        : `Rodada ${this.totalInRun - this.queue.length <= 9 ? 1 : 2} de ${PASSES} · alvo ${
            ((this.totalInRun - this.queue.length - 1) % 9) + 1
          }/9`;
    drawText(ctx, screenW / 2, 40, label, 18, '#94a3b8');
  }

  private drawResults(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    const cx = screenW / 2;
    const cy = screenH / 2;
    const model = this.store.model;
    if (this.resultError || !model) {
      drawText(ctx, cx, cy - 20, 'Não foi possível calibrar', 36, '#fca5a5');
      drawText(ctx, cx, cy + 25, this.resultError ?? '', 16, '#cbd5e1');
      drawText(ctx, cx, cy + 65, 'Dê um wink para continuar', 18, '#94a3b8');
      return;
    }
    drawText(ctx, cx, cy - 80, 'Estande concluído', 40, '#f8fafc');
    drawText(ctx, cx, cy - 20, `Precisão: ${stars(model.meanResidual)}`, 36, '#facc15');
    drawText(ctx, cx, cy + 25, `Erro médio: ${Math.round(model.meanResidual)} px`, 20, '#cbd5e1');
    if (this.worstPoint !== null) {
      const r = Math.round(model.residuals[this.worstPoint]);
      drawText(ctx, cx, cy + 75, `O alvo ${this.worstPoint + 1} ficou impreciso (${r} px)`, 20, '#fca5a5');
      drawText(ctx, cx, cy + 110, 'Wink esquerdo: repetir esse alvo  ·  Wink direito: continuar', 18, '#94a3b8');
    } else {
      drawText(ctx, cx, cy + 75, 'Dê um wink para continuar', 18, '#94a3b8');
    }
  }
}

// ---------- Utilitários ----------

/** Alvo i (0–8) da grade 3×3, com margem de 10% das bordas. */
function gridTarget(i: number, screenW: number, screenH: number): AimTarget {
  const col = i % 3;
  const row = Math.floor(i / 3);
  const span = 1 - 2 * GRID_MARGIN;
  return {
    id: `grid-${i}`,
    x: screenW * (GRID_MARGIN + (span / 2) * col),
    y: screenH * (GRID_MARGIN + (span / 2) * row),
  };
}

/** Duas passadas embaralhadas, sem repetir o mesmo alvo na virada entre elas. */
function shuffledPasses(): number[] {
  const order: number[] = [];
  for (let p = 0; p < PASSES; p++) {
    let pass: number[];
    do {
      pass = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    } while (order.length > 0 && pass[0] === order[order.length - 1]);
    order.push(...pass);
  }
  return order;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function stdDev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
}

function stars(meanErrorPx: number): string {
  const n = meanErrorPx <= 40 ? 5 : meanErrorPx <= 70 ? 4 : meanErrorPx <= 100 ? 3 : meanErrorPx <= 150 ? 2 : 1;
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function drawTarget(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number, lit: boolean): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  if (lit) {
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 30;
  }
  const rings = lit ? ['#facc15', '#f8fafc', '#facc15'] : ['#dc2626', '#f8fafc', '#dc2626'];
  rings.forEach((color, k) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r * (1 - k * 0.33), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, size: number, color: string): void {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px system-ui, 'Segoe UI', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function easeIn(k: number): number {
  return k * k;
}

function easeOut(k: number): number {
  return 1 - (1 - k) * (1 - k);
}
