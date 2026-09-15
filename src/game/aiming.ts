import type { CalibrationStore } from '../calibration/calibrationStore';
import { OneEuroFilter } from '../tracking/oneEuroFilter';
import type { DebugConfig, FaceFrame } from '../types';

/** Alcance angular (após a zona morta) que leva a contribuição da cabeça do centro até a borda. */
const HEAD_RANGE_DEG = 20;

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
  private lastEyeOffset: { x: number; y: number } | null = null;
  private snappedId: string | null = null;
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

    // 2. Olho. Com o olho fechado (features null), congela o último valor válido.
    let eyeOffset: { x: number; y: number } | null = null;
    if (model) {
      const eye = frame.gazeFeatures ? this.store.apply(frame.gazeFeatures) : null;
      if (eye) {
        this.lastEyeOffset = {
          x: clamp(eye.x - cx, -c.eyeMaxOffset, c.eyeMaxOffset),
          y: clamp(eye.y - cy, -c.eyeMaxOffset, c.eyeMaxOffset),
        };
      }
      eyeOffset = this.lastEyeOffset;
    } else {
      this.lastEyeOffset = null;
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
    const current = this.snappedId ? targets.find((tg) => tg.id === this.snappedId) : undefined;
    if (current && distance(unsnapped, current) <= c.snapRadius + c.snapHysteresis) {
      // continua grudado
    } else {
      this.snappedId = null;
      let best: AimTarget | null = null;
      let bestDist = c.snapRadius;
      for (const tg of targets) {
        const d = distance(unsnapped, tg);
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
