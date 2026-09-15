import type { CalibrationStore } from '../calibration/calibrationStore';
import { OneEuroFilter } from '../tracking/oneEuroFilter';
import type { DebugConfig, FaceFrame } from '../types';

/** Alcance angular (após a zona morta) que leva a contribuição da cabeça do centro até a borda. */
const HEAD_RANGE_DEG = 20;
/** Quanto histórico da contribuição do olho guardar para o congelamento na piscada. */
const EYE_HISTORY_MS = 1000;
/**
 * Atraso típico da mira em relação ao mundo (câmera + detecção + filtro). Para alvos em
 * movimento, o snap compara a mira também com a posição que o alvo tinha há esse tempo:
 * a mira atrasada "atrás" de um pato rápido não conta como ter saído dele.
 */
const SNAP_LAG_MS = 150;
const TARGET_HISTORY_MS = 400;

export interface AimTarget {
  id: string;
  x: number;
  y: number;
}

export interface AimState {
  /** Cursor final (após filtro e snap), px CSS. */
  cursor: { x: number; y: number };
  /** Cursor filtrado antes do snap. */
  unsnapped: { x: number; y: number };
  snappedTargetId: string | null;
  /** Contribuição da cabeça como deslocamento do centro, SEM o peso. */
  headOffset: { x: number; y: number };
  /** Contribuição do olho como deslocamento do centro, SEM o peso. null sem modelo. */
  eyeOffset: { x: number; y: number } | null;
  headDelta: { yaw: number; pitch: number; roll: number };
  hasModel: boolean;
}

/**
 * Único lugar onde os sinais de cabeça e olho se encontram.
 *
 *   1. cabeça: delta = headPose − headBaseline → zona morta → graus para px
 *   2. olho:   calibrationStore.apply(features) − centro, limitado a ±eyeMaxOffset
 *   3. fusão:  centro + headWeight·cabeça + (1 − headWeight)·olho
 *              (sem modelo: centro + cabeça)
 *   4. filtro One Euro próprio (cursorMinCutoff / cursorBeta)
 *   5. snap magnético com histerese
 */
export class Aiming {
  private readonly filterX: OneEuroFilter;
  private readonly filterY: OneEuroFilter;
  /** Previsões do olho (deslocamento do centro, sem clamp) dos frames com olhos abertos. */
  private eyeHistory: { t: number; offset: { x: number; y: number } }[] = [];
  /** Deslocamento congelado durante uma piscada, e até quando segurar. */
  private frozenEye: { x: number; y: number } | null = null;
  private holdUntil = -Infinity;
  private snappedId: string | null = null;
  /** Posições recentes de cada alvo, para o snap compensar o atraso da mira. */
  private targetHistory = new Map<string, { t: number; x: number; y: number }[]>();
  private state: AimState | null = null;

  constructor(
    private readonly config: DebugConfig,
    private readonly store: CalibrationStore,
  ) {
    this.filterX = new OneEuroFilter(config.cursorMinCutoff, config.cursorBeta, config.dCutoff);
    this.filterY = new OneEuroFilter(config.cursorMinCutoff, config.cursorBeta, config.dCutoff);
  }

  getState(): AimState | null {
    return this.state;
  }

  update(frame: FaceFrame, screenW: number, screenH: number, targets: readonly AimTarget[]): AimState | null {
    // Sem rosto: mantém o último cursor.
    if (!frame.faceDetected) return this.state;

    const c = this.config;
    const model = this.store.model;
    const cx = screenW / 2;
    const cy = screenH / 2;

    // 1. Cabeça. Sem modelo não há baseline; usamos pose zero.
    const base = model?.headBaseline ?? { yaw: 0, pitch: 0, roll: 0 };
    const headDelta = {
      yaw: frame.headPose.yaw - base.yaw,
      pitch: frame.headPose.pitch - base.pitch,
      roll: frame.headPose.roll - base.roll,
    };
    // Zona morta suave: subtrai a zona em vez de zerar, para o cursor não pular na borda dela.
    const yaw = softDeadzone(headDelta.yaw, c.headDeadzone);
    const pitch = softDeadzone(headDelta.pitch, c.headDeadzone);
    // yaw positivo → direita; pitch positivo → cima (Y da tela cresce para baixo).
    // Se ficar invertido, troque YAW_SIGN / PITCH_SIGN em headPose.ts.
    const headOffset = {
      x: yaw * (cx / HEAD_RANGE_DEG),
      y: -pitch * (cy / HEAD_RANGE_DEG),
    };

    // 2. Olho, com congelamento na piscada.
    // O modelo de Y usa pálpebra e eyeLook; no começo de uma piscada a pálpebra desce
    // antes de o olho contar como fechado, e a mira "pularia" para baixo. Então, assim
    // que qualquer olho passa de doubleBlinkThreshold (ou as features somem), a
    // contribuição do olho congela no valor de preBlinkBufferMs ANTES disso, e só volta
    // a seguir o olho preBlinkBufferMs depois que os olhos reabrem.
    let eyeOffset: { x: number; y: number } | null = null;
    if (model) {
      const now = frame.timestamp;
      const blinkL = frame.blendshapes.eyeBlinkLeft ?? 0;
      const blinkR = frame.blendshapes.eyeBlinkRight ?? 0;
      const closing = !frame.gazeFeatures || blinkL > c.doubleBlinkThreshold || blinkR > c.doubleBlinkThreshold;

      if (closing) {
        if (now >= this.holdUntil || !this.frozenEye) this.frozenEye = this.eyeOffsetAgo(now, c.preBlinkBufferMs);
        this.holdUntil = now + c.preBlinkBufferMs;
      }

      let current: { x: number; y: number } | null;
      if (now < this.holdUntil) {
        current = this.frozenEye;
      } else {
        this.frozenEye = null;
        const eye = this.store.apply(frame.gazeFeatures!);
        current = eye ? { x: eye.x - cx, y: eye.y - cy } : null;
        if (current) {
          this.eyeHistory.push({ t: now, offset: current });
          while (this.eyeHistory.length > 0 && this.eyeHistory[0].t < now - EYE_HISTORY_MS) this.eyeHistory.shift();
        }
      }
      eyeOffset = current
        ? { x: clamp(current.x, -c.eyeMaxOffset, c.eyeMaxOffset), y: clamp(current.y, -c.eyeMaxOffset, c.eyeMaxOffset) }
        : null;
    } else {
      this.eyeHistory = [];
      this.frozenEye = null;
    }

    // 3. Fusão.
    let rawX: number;
    let rawY: number;
    if (model) {
      const e = eyeOffset ?? { x: 0, y: 0 };
      rawX = cx + c.headWeight * headOffset.x + (1 - c.headWeight) * e.x;
      rawY = cy + c.headWeight * headOffset.y + (1 - c.headWeight) * e.y;
    } else {
      rawX = cx + headOffset.x;
      rawY = cy + headOffset.y;
    }

    // 4. Suavização (filtro separado do gazeFiltered do M0).
    const t = frame.timestamp / 1000;
    this.filterX.updateParams(c.cursorMinCutoff, c.cursorBeta, c.dCutoff);
    this.filterY.updateParams(c.cursorMinCutoff, c.cursorBeta, c.dCutoff);
    const unsnapped = {
      x: clamp(this.filterX.filter(rawX, t), 0, screenW),
      y: clamp(this.filterY.filter(rawY, t), 0, screenH),
    };

    // 5. Snap com histerese: gruda abaixo de snapRadius, só solta acima de snapRadius + snapHysteresis.
    // A distância usada é a menor entre a posição atual do alvo e a de SNAP_LAG_MS atrás
    // (para alvos parados as duas são iguais).
    this.recordTargets(frame.timestamp, targets);
    const snapDistance = (tg: AimTarget) => {
      const past = this.targetPositionAgo(tg.id, frame.timestamp, SNAP_LAG_MS);
      return Math.min(distance(unsnapped, tg), past ? distance(unsnapped, past) : Infinity);
    };
    const current = this.snappedId ? targets.find((tg) => tg.id === this.snappedId) : undefined;
    if (current && snapDistance(current) <= c.snapRadius + c.snapHysteresis) {
      // continua grudado
    } else {
      this.snappedId = null;
      let best: AimTarget | null = null;
      let bestDist = c.snapRadius;
      for (const tg of targets) {
        const d = snapDistance(tg);
        if (d < bestDist) {
          bestDist = d;
          best = tg;
        }
      }
      if (best) this.snappedId = best.id;
    }
    const snapped = this.snappedId ? targets.find((tg) => tg.id === this.snappedId) : undefined;

    this.state = {
      cursor: snapped ? { x: snapped.x, y: snapped.y } : unsnapped,
      unsnapped,
      snappedTargetId: snapped ? snapped.id : null,
      headOffset,
      eyeOffset,
      headDelta,
      hasModel: !!model,
    };
    return this.state;
  }

  private recordTargets(now: number, targets: readonly AimTarget[]): void {
    const alive = new Set(targets.map((tg) => tg.id));
    for (const id of this.targetHistory.keys()) if (!alive.has(id)) this.targetHistory.delete(id);
    for (const tg of targets) {
      const h = this.targetHistory.get(tg.id) ?? [];
      h.push({ t: now, x: tg.x, y: tg.y });
      while (h.length > 0 && h[0].t < now - TARGET_HISTORY_MS) h.shift();
      this.targetHistory.set(tg.id, h);
    }
  }

  private targetPositionAgo(id: string, now: number, ms: number): { x: number; y: number } | null {
    const h = this.targetHistory.get(id);
    if (!h || h.length === 0) return null;
    const want = now - ms;
    return h.reduce((best, p) => (Math.abs(p.t - want) < Math.abs(best.t - want) ? p : best));
  }

  /** Contribuição do olho mais próxima de `ms` antes de `now`, entre os frames com olhos abertos. */
  private eyeOffsetAgo(now: number, ms: number): { x: number; y: number } | null {
    const target = now - ms;
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    for (const h of this.eyeHistory) {
      const d = Math.abs(h.t - target);
      if (d < bestDist) {
        bestDist = d;
        best = h.offset;
      }
    }
    return best;
  }
}

function softDeadzone(v: number, zone: number): number {
  return Math.sign(v) * Math.max(0, Math.abs(v) - zone);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
