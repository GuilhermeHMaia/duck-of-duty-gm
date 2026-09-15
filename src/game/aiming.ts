import type { CalibrationStore } from '../calibration/calibrationStore';
import { OneEuroFilter } from '../tracking/oneEuroFilter';
import type { DebugConfig, FaceFrame } from '../types';

/** Quanto histórico da contribuição do olho guardar para o congelamento na piscada. */
const EYE_HISTORY_MS = 1000;
/**
 * Atraso típico da mira em relação ao mundo (câmera + detecção + filtro). Para alvos em
 * movimento, o snap compara a mira também com a posição que o alvo tinha há esse tempo:
 * a mira atrasada "atrás" de um pato rápido não conta como ter saído dele.
 */
const SNAP_LAG_MS = 150;
const TARGET_HISTORY_MS = 400;
/** A mira congela quando o eyeBlink sobe esta fração de blinkRise acima do repouso (início da piscada). */
const BLINK_ONSET_FRACTION = 0.6;

export interface AimTarget {
  id: string;
  x: number;
  y: number;
}

export interface AimState {
  /** Cursor final (após filtros e snap), px CSS. */
  cursor: { x: number; y: number };
  /** Cursor antes do snap. */
  unsnapped: { x: number; y: number };
  snappedTargetId: string | null;
  /** Contribuição da cabeça (filtrada), px a partir do centro: headGain · Δcabeça. */
  headOffset: { x: number; y: number };
  /** Contribuição do olho (filtrada), px a partir do centro. null sem modelo. */
  eyeOffset: { x: number; y: number } | null;
  headDelta: { yaw: number; pitch: number; roll: number };
  hasModel: boolean;
  /** A contribuição do olho está congelada por uma piscada em curso. */
  eyeFrozen: boolean;
}

/**
 * Único lugar onde os sinais de cabeça e olho se encontram.
 *
 *   1. cabeça: Δ = headPose − headBaseline → zona morta → headGain px/grau (igual em X e Y)
 *              → filtro 1€ leve (headMinCutoff / headBeta)
 *   2. olho:   calibrationStore.apply(features) − centro, limitado a ±eyeMaxOffset,
 *              congelado durante piscadas → filtro 1€ forte (eyeMinCutoff / eyeBeta)
 *   3. fusão por SOMA: centro + olho + cabeça
 *   4. snap magnético com histerese (compensando o atraso de alvos em movimento)
 *
 * Por que soma e não média: o ponto olhado na tela é direção da cabeça + direção do olho
 * dentro da cabeça. O modelo do olho foi calibrado com a cabeça parada na baseline; se a
 * cabeça gira Δ graus e você continua olhando o mesmo ponto, o olho gira −Δ dentro da órbita
 * (o modelo lê ≈ −Δ·px/grau) e a cabeça soma +headGain·Δ — os dois se cancelam e a mira fica
 * no ponto. Com média ponderada eles não se cancelavam e a mira escorregava para o lado
 * contrário do movimento da cabeça. headGain ≈ px por grau de olhar na sua distância da tela.
 *
 * Os filtros são separados porque a cabeça é um sinal limpo (bom para seguir movimento) e o
 * olho é ruidoso (precisa de mais suavização); um filtro único depois da soma tratava os dois igual.
 */
export class Aiming {
  private readonly eyeFilterX = new OneEuroFilter(0.5, 0.005, 1);
  private readonly eyeFilterY = new OneEuroFilter(0.5, 0.005, 1);
  private readonly headFilterX = new OneEuroFilter(1.5, 0.02, 1);
  private readonly headFilterY = new OneEuroFilter(1.5, 0.02, 1);
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
  ) {}

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
    const now = frame.timestamp;
    const t = now / 1000;

    // 1. Cabeça. Sem modelo não há baseline; usamos pose zero.
    const base = model?.headBaseline ?? { yaw: 0, pitch: 0, roll: 0 };
    const headDelta = {
      yaw: frame.headPose.yaw - base.yaw,
      pitch: frame.headPose.pitch - base.pitch,
      roll: frame.headPose.roll - base.roll,
    };
    // Zona morta suave: subtrai a zona em vez de zerar, para o cursor não pular na borda dela.
    // yaw positivo → direita; pitch positivo → cima (Y da tela cresce para baixo).
    // Se ficar invertido, troque YAW_SIGN / PITCH_SIGN em headPose.ts.
    this.headFilterX.updateParams(c.headMinCutoff, c.headBeta, c.dCutoff);
    this.headFilterY.updateParams(c.headMinCutoff, c.headBeta, c.dCutoff);
    const headOffset = {
      x: this.headFilterX.filter(softDeadzone(headDelta.yaw, c.headDeadzone) * c.headGain, t),
      y: this.headFilterY.filter(-softDeadzone(headDelta.pitch, c.headDeadzone) * c.headGain, t),
    };

    // 2. Olho, com congelamento na piscada.
    // O modelo de Y usa pálpebra e eyeLook; no começo de uma piscada a pálpebra desce antes
    // de o olho contar como fechado, e a mira "pularia" para baixo. Então, assim que qualquer
    // eyeBlink sobe BLINK_ONSET_FRACTION·blinkRise acima do repouso (ou as features somem), a
    // contribuição do olho congela no valor de preBlinkBufferMs ANTES disso, e só volta a
    // seguir o olho preBlinkBufferMs depois que a subida some.
    let eyeOffset: { x: number; y: number } | null = null;
    let eyeFrozen = false;
    if (model) {
      const onset = c.blinkRise * BLINK_ONSET_FRACTION;
      const closing = !frame.gazeFeatures || frame.blinkRise.left > onset || frame.blinkRise.right > onset;
      if (closing) {
        if (now >= this.holdUntil || !this.frozenEye) this.frozenEye = this.eyeOffsetAgo(now, c.preBlinkBufferMs);
        this.holdUntil = now + c.preBlinkBufferMs;
      }

      let current: { x: number; y: number } | null;
      if (now < this.holdUntil) {
        current = this.frozenEye;
        eyeFrozen = true;
      } else {
        this.frozenEye = null;
        const eye = this.store.apply(frame.gazeFeatures!);
        current = eye ? { x: eye.x - cx, y: eye.y - cy } : null;
        if (current) {
          this.eyeHistory.push({ t: now, offset: current });
          while (this.eyeHistory.length > 0 && this.eyeHistory[0].t < now - EYE_HISTORY_MS) this.eyeHistory.shift();
        }
      }
      if (current) {
        this.eyeFilterX.updateParams(c.eyeMinCutoff, c.eyeBeta, c.dCutoff);
        this.eyeFilterY.updateParams(c.eyeMinCutoff, c.eyeBeta, c.dCutoff);
        eyeOffset = {
          x: this.eyeFilterX.filter(clamp(current.x, -c.eyeMaxOffset, c.eyeMaxOffset), t),
          y: this.eyeFilterY.filter(clamp(current.y, -c.eyeMaxOffset, c.eyeMaxOffset), t),
        };
      }
    } else {
      this.eyeHistory = [];
      this.frozenEye = null;
      this.eyeFilterX.reset();
      this.eyeFilterY.reset();
    }

    // 3. Fusão por soma.
    const e = eyeOffset ?? { x: 0, y: 0 };
    const unsnapped = {
      x: clamp(cx + e.x + headOffset.x, 0, screenW),
      y: clamp(cy + e.y + headOffset.y, 0, screenH),
    };

    // 4. Snap com histerese: gruda abaixo de snapRadius, só solta acima de snapRadius + snapHysteresis.
    // A distância usada é a menor entre a posição atual do alvo e a de SNAP_LAG_MS atrás
    // (para alvos parados as duas são iguais).
    this.recordTargets(now, targets);
    const snapDistance = (tg: AimTarget) => {
      const past = this.targetPositionAgo(tg.id, now, SNAP_LAG_MS);
      return Math.min(distance(unsnapped, tg), past ? distance(unsnapped, past) : Infinity);
    };
    const snappedNow = this.snappedId ? targets.find((tg) => tg.id === this.snappedId) : undefined;
    if (!(snappedNow && snapDistance(snappedNow) <= c.snapRadius + c.snapHysteresis)) {
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
      eyeFrozen,
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
