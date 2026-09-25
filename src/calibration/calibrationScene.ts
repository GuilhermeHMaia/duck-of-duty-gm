import type { AimState, AimTarget } from '../game/aiming';
import type { FrameBuffer } from '../tracking/frameBuffer';
import { GAZE_FEATURE_NAMES } from '../tracking/gazeEstimator';
import type { FaceFrame } from '../types';
import { median, type CalibrationSample, type CalibrationStore } from './calibrationStore';

// ---------- Parâmetros da coleta ----------
const SETTLE_MS = 400;            // atraso entre o alvo aparecer e a captura ser habilitada
/** Gatilho: os dois olhos fechados (bothClosed) por pelo menos isso. Piscada natural fica em ~100–150 ms. */
export const BLINK_TRIGGER_MS = 200;
/** Mira livre: sobrancelhas levantadas (browInnerUp) por RECENTER_HOLD_MS = recentralizar. */
const BROW_UP_THRESHOLD = 0.5;
const RECENTER_HOLD_MS = 1000;
const RECENTER_FLASH_MS = 1500;
const WINDOW_START_MS = 500;      // janela de amostra: de 500 ms…
const WINDOW_END_MS = 150;        // …a 150 ms antes do início do fechamento
const MIN_WINDOW_FRAMES = 4;      // menos que isso, mediana e desvio não significam nada
const MAX_HEAD_RANGE_DEG = 5;     // variação máxima da cabeça dentro da janela, por eixo
const MAX_HEAD_FROM_OTHERS_DEG = 5; // distância máxima da pose até a mediana das amostras já aceitas
/**
 * Desvio padrão máximo de cada feature na janela (ordem de GAZE_FEATURE_NAMES).
 * Íris e pálpebra em larguras de olho; lookDown−Up em unidades de blendshape (0–1),
 * que oscilam mais de frame a frame, por isso o limite maior (estimado, ajustar se
 * aparecer muito "Olhar instável" em lookDU*).
 */
const FEATURE_STD_LIMITS = [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.06, 0.06];

/**
 * Tolerância: quando o MESMO alvo é descartado DISCARDS_TO_RELAX vezes, o Estande passa para o
 * próximo nível de folga (e avisa na tela). Sem isso, quem tem câmera fraca ou não consegue ficar
 * parado fica preso no mesmo alvo para sempre. Nível 0 = limites originais.
 */
export const DISCARDS_TO_RELAX = 3;
export const TOLERANCE_LEVELS = [
  { head: 1, featureStd: 1, windowStartMs: WINDOW_START_MS, minFrames: MIN_WINDOW_FRAMES, settleMs: SETTLE_MS },
  { head: 1.8, featureStd: 2, windowStartMs: 400, minFrames: 3, settleMs: 300 },
  { head: 2.6, featureStd: 3, windowStartMs: 320, minFrames: 2, settleMs: 250 },
] as const;
const TOLERANCE_MESSAGES = [
  '',
  'Vamos com mais folga: olhe o centro do alvo e feche os olhos quando estiver pronto',
  'Folga máxima: se ainda não cair, dá para jogar só com a cabeça no fim do Estande',
];

// ---------- Apresentação ----------
const PASSES = 2;
const TARGET_RADIUS = 40;
const FALL_MS = 600;
const NEXT_TARGET_GAP_MS = 300;
const POP_MS = 200;
const BAD_POINT_PX = 150;
const GRID_MARGIN = 0.1;
/** Por quanto tempo a dica de uma amostra descartada fica na tela. */
const DISCARD_HINT_MS = 2500;
/** Quanto tempo o aviso de folga aumentada fica na tela. */
const TOLERANCE_MESSAGE_MS = 4000;

type Phase = 'intro' | 'target' | 'falling' | 'free';

/** Resultado do Estande, mostrado pela tela de resultado (scenes/calibrationResultScene). */
export interface CalibrationOutcome {
  meanResidual: number | null;
  /** Alvo com o pior resíduo (acima de BAD_POINT_PX), para oferecer repetir só ele. */
  worstPoint: number | null;
  worstResidual: number | null;
  /** Mensagem de erro quando nem deu para treinar o modelo. */
  error: string | null;
  /** Nível de folga usado na coleta (0 = limites originais). */
  toleranceLevel: number;
}

export interface DiscardInfo {
  reason: string;
  at: number;
  pointIndex: number;
}

export interface CalibrationSceneHooks {
  setPanelCollapsed(collapsed: boolean): void;
  /** Piscada deliberada na mira livre: começa o jogo. */
  startGame(): void;
  /** Recentralizar a mira no ponto (x, y) que o jogador está olhando. Devolve se deu certo. */
  recenter(x: number, y: number): boolean;
  /** O Estande terminou (com sucesso ou não): quem chama mostra a tela de resultado. */
  onResults(outcome: CalibrationOutcome): void;
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
  /** Timestamp do primeiro frame com os dois olhos fechados na piscada atual; null com olhos abertos. */
  private closedSince: number | null = null;
  /** A piscada atual já disparou uma ação (uma piscada = uma ação). */
  private closureHandled = false;
  private samples: CalibrationSample[] = [];
  private totalInRun = 0;
  private repeating: number | null = null;
  private worstPoint: number | null = null;
  /** Quantas amostras foram descartadas em cada alvo nesta tentativa (para afrouxar os limites). */
  private discardsByPoint = new Map<number, number>();
  private toleranceLevel = 0;
  private toleranceMessageAt = -Infinity;

  private browUpSince: number | null = null;
  private browHandled = false;
  private recenterMessage: { text: string; at: number } | null = null;

  /** Último descarte de amostra, com o motivo (mostrado só no painel). */
  lastDiscard: DiscardInfo | null = null;

  constructor(
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
    this.discardsByPoint.clear();
    this.toleranceLevel = 0;
    this.lastDiscard = null;
    this.closedSince = null;
    this.closureHandled = true; // uma piscada já em curso ao abrir o Estande não conta
    this.hooks.setPanelCollapsed(true);
  }

  showFreeAim(): void {
    this.phase = 'free';
  }

  /** Repete só o pior alvo do resultado (botão da tela de resultado). */
  repeatWorstPoint(): void {
    if (this.worstPoint === null) return;
    this.repeatPoint(this.worstPoint, performance.now());
  }

  /** Limites de aceitação da amostra no nível de folga atual. */
  private get tolerance(): (typeof TOLERANCE_LEVELS)[number] {
    return TOLERANCE_LEVELS[Math.min(this.toleranceLevel, TOLERANCE_LEVELS.length - 1)];
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
    // Gatilho = piscada deliberada: os dois olhos fechados (bothClosed, doubleBlinkThreshold)
    // por pelo menos BLINK_TRIGGER_MS. Uma piscada dispara no máximo uma ação.
    const t = frame.timestamp;
    const now = performance.now();

    if (this.phase === 'free') this.updateRecenterGesture(frame, t, screenW, screenH);

    if (frame.faceDetected && frame.eyeState.bothClosed) {
      if (this.closedSince === null) {
        this.closedSince = t;
        this.closureHandled = false;
      }
      const held = t - this.closedSince;
      if (this.closureHandled) return;

      if (held >= BLINK_TRIGGER_MS) {
        this.closureHandled = true;
        this.onDeliberateBlink(this.closedSince, screenW, screenH, now);
      }
      return;
    }

    // Olhos reabriram.
    if (this.closedSince !== null) {
      this.closedSince = null;
      this.closureHandled = false;
    }
  }

  /** Recentraliza na mira livre olhando o alvo do centro (gesto de sobrancelha ou tecla C). */
  recenterOnCenter(screenW: number, screenH: number): void {
    if (this.phase !== 'free') return;
    const ok = this.hooks.recenter(screenW / 2, screenH / 2);
    this.recenterMessage = {
      text: ok ? 'Mira recentralizada' : 'Calibre primeiro para poder recentralizar',
      at: performance.now(),
    };
  }

  private updateRecenterGesture(frame: FaceFrame, t: number, screenW: number, screenH: number): void {
    const up = frame.faceDetected && (frame.blendshapes.browInnerUp ?? 0) > BROW_UP_THRESHOLD;
    if (!up) {
      this.browUpSince = null;
      this.browHandled = false;
      return;
    }
    this.browUpSince ??= t;
    if (!this.browHandled && t - this.browUpSince >= RECENTER_HOLD_MS) {
      this.browHandled = true;
      this.recenterOnCenter(screenW, screenH);
    }
  }

  private onDeliberateBlink(closureStart: number, screenW: number, screenH: number, now: number): void {
    switch (this.phase) {
      case 'intro':
        this.beginRun(shuffledPasses(), now);
        break;
      case 'free':
        this.hooks.startGame();
        break;
      case 'target':
        if (now < this.appearedAt + this.tolerance.settleMs) return; // captura ainda não habilitada
        this.capture(closureStart, screenW, screenH, now);
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
        drawText(ctx, screenW / 2, screenH / 2 + 70, 'Olhe o centro de cada alvo mexendo SÓ OS OLHOS, com a cabeça parada,', 18, '#e2e8f0');
        drawText(ctx, screenW / 2, screenH / 2 + 98, 'e feche os dois olhos por um instante para derrubá-lo. São 18 alvos.', 18, '#e2e8f0');
        drawText(ctx, screenW / 2, screenH / 2 + 148, 'Feche os dois olhos por um instante para começar', 18, '#94a3b8');
        break;

      case 'target': {
        const t = gridTarget(this.currentPoint, screenW, screenH);
        const pop = Math.min(1, (now - this.appearedAt) / POP_MS);
        drawTarget(ctx, t.x, t.y, TARGET_RADIUS * (0.6 + 0.4 * easeOut(pop)), 1, false);
        this.drawHud(ctx, screenW);
        if (this.lastDiscard && now - this.lastDiscard.at < DISCARD_HINT_MS) {
          drawText(ctx, screenW / 2, 72, friendlyDiscardHint(this.lastDiscard.reason), 20, '#fde68a');
        }
        if (this.toleranceLevel > 0) {
          drawText(ctx, screenW / 2, screenH - 30, `folga aumentada (nivel ${this.toleranceLevel})`, 14, '#64748b');
          if (now - this.toleranceMessageAt < TOLERANCE_MESSAGE_MS) {
            drawText(ctx, screenW / 2, 104, TOLERANCE_MESSAGES[this.toleranceLevel] ?? '', 18, '#7dd3fc');
          }
        }
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

      case 'free': {
        for (let i = 0; i < 9; i++) {
          const t = gridTarget(i, screenW, screenH);
          drawTarget(ctx, t.x, t.y, TARGET_RADIUS, 1, aim?.snappedTargetId === t.id);
        }
        drawText(ctx, screenW / 2, 40, 'Mira livre · feche os dois olhos por um instante para ir ao menu', 18, '#94a3b8');
        drawText(ctx, screenW / 2, 66, 'Mira desviada? Olhe o alvo do centro e levante as sobrancelhas por 1 s (ou tecla C)', 15, '#64748b');
        if (this.recenterMessage && now - this.recenterMessage.at < RECENTER_FLASH_MS) {
          drawText(ctx, screenW / 2, screenH / 2 - 90, this.recenterMessage.text, 24, '#4ade80');
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
    this.worstPoint = null;
    const outcome: CalibrationOutcome = {
      meanResidual: null,
      worstPoint: null,
      worstResidual: null,
      error: null,
      toleranceLevel: this.toleranceLevel,
    };
    try {
      const model = this.store.fit(this.samples, screenW, screenH);
      let worst = -1;
      model.residuals.forEach((r, i) => {
        if (r > BAD_POINT_PX && (worst < 0 || r > model.residuals[worst])) worst = i;
      });
      this.worstPoint = worst >= 0 ? worst : null;
      outcome.meanResidual = model.meanResidual;
      outcome.worstPoint = this.worstPoint;
      outcome.worstResidual = this.worstPoint === null ? null : model.residuals[this.worstPoint];
    } catch (err) {
      console.error('[calibração] falha no treino', err);
      outcome.error = err instanceof Error ? err.message : String(err);
    }
    // A cena volta para a mira livre por baixo; a tela de resultado fica por cima, com os botões.
    this.phase = 'free';
    this.hooks.setPanelCollapsed(false);
    this.hooks.onResults(outcome);
  }

  // ---------- Coleta ----------

  private capture(closureStart: number, screenW: number, screenH: number, now: number): void {
    const result = this.buildSample(closureStart, screenW, screenH);
    if (typeof result === 'string') {
      // Descartado: registra o motivo (vira dica na tela) e o mesmo alvo "reaparece".
      this.lastDiscard = { reason: result, at: now, pointIndex: this.currentPoint };
      this.appearedAt = now;
      // Insistiu no mesmo alvo: afrouxa os limites para ninguém ficar preso nele.
      const discards = (this.discardsByPoint.get(this.currentPoint) ?? 0) + 1;
      this.discardsByPoint.set(this.currentPoint, discards);
      const level = Math.min(Math.floor(discards / DISCARDS_TO_RELAX), TOLERANCE_LEVELS.length - 1);
      if (level > this.toleranceLevel) {
        this.toleranceLevel = level;
        this.toleranceMessageAt = now;
      }
      return;
    }
    this.samples.push(result);
    this.phase = 'falling';
    this.fallStart = now;
  }

  /**
   * Monta a amostra a partir da janela antes da piscada no frameBuffer, ou devolve o
   * motivo do descarte. closureStart = timestamp do primeiro frame com os dois olhos fechados.
   */
  private buildSample(closureStart: number, screenW: number, screenH: number): CalibrationSample | string {
    const frames = this.buffer.getFrames();
    if (frames.length === 0) return 'Buffer vazio';

    const tol = this.tolerance;
    const from = closureStart - tol.windowStartMs;
    const to = closureStart - WINDOW_END_MS;

    if (from < this.appearedAt + tol.settleMs) {
      return `Piscada cedo demais: a janela de ${tol.windowStartMs} ms começa antes do olhar se acomodar no alvo`;
    }
    if (frames[0].timestamp > from) return `O buffer não cobre a janela de ${tol.windowStartMs} ms`;

    const win = frames.filter((f) => f.timestamp >= from && f.timestamp <= to);
    if (win.length < tol.minFrames) {
      return `Poucos frames na janela (${win.length} < ${tol.minFrames}) — FPS da câmera baixo`;
    }
    if (win.some((f) => !f.faceDetected)) return 'Rosto perdido em algum frame da janela';
    if (win.some((f) => !f.gazeFeatures)) return 'Olho fechado ou perdido em algum frame da janela';

    const axes = ['yaw', 'pitch', 'roll'] as const;
    for (const axis of axes) {
      const values = win.map((f) => f.headPose[axis]);
      const range = Math.max(...values) - Math.min(...values);
      const maxRange = MAX_HEAD_RANGE_DEG * tol.head;
      if (range > maxRange) {
        return `Cabeça variou ${range.toFixed(1)}° em ${axis} na janela (máx. ${maxRange.toFixed(1)}°)`;
      }
    }

    const features = GAZE_FEATURE_NAMES.map((_, k) => win.map((f) => f.gazeFeatures![k]));
    for (let k = 0; k < features.length; k++) {
      const sd = stdDev(features[k]);
      const limit = FEATURE_STD_LIMITS[k] * tol.featureStd;
      if (sd > limit) {
        return `Olhar instável: σ(${GAZE_FEATURE_NAMES[k]}) = ${sd.toFixed(3)} > ${limit.toFixed(3)}`;
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
        const maxFromOthers = MAX_HEAD_FROM_OTHERS_DEG * tol.head;
        if (d > maxFromOthers) {
          return `Cabeça a ${d.toFixed(1)}° (${axis}) da posição das outras amostras (máx. ${maxFromOthers.toFixed(1)}°)`;
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

}

// ---------- Utilitários ----------

/** Traduz o motivo técnico de um descarte numa dica curta para quem está jogando. */
export function friendlyDiscardHint(reason: string): string {
  if (reason.startsWith('Cabeça')) return 'Mantenha a cabeça parada e mexa só os olhos';
  if (reason.startsWith('Piscada cedo')) return 'Olhe o alvo por meio segundo antes de fechar os olhos';
  if (reason.startsWith('Olhar instável')) return 'Segure o olhar firme no centro do alvo';
  if (reason.startsWith('Poucos frames')) return 'Câmera lenta: melhore a iluminação do rosto';
  return 'Mantenha o rosto visível e os olhos abertos antes de fechar';
}

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

export function stars(meanErrorPx: number): string {
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
