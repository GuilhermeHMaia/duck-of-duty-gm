import type { DebugConfig, FaceFrame } from '../types';

export interface BlinkResult {
  eyeState: FaceFrame['eyeState'];
  blinkRise: FaceFrame['blinkRise'];
  /** Algum olho fechado (subida > blinkRise ou acima do teto doubleBlinkThreshold). */
  eitherClosed: boolean;
  jawOpen: number;
  browInnerUp: number;
}

/** Constante de tempo do nível de repouso: acompanha em ~0,5 s a pálpebra de quem olha para baixo. */
const REST_TAU_MS = 500;
/** Repouso inicial máximo, para o primeiro frame não "ensinar" um olho fechado como normal. */
const INITIAL_REST_MAX = 0.3;

// Convenção: "Left"/"Right" = olho esquerdo/direito DA PESSOA (a mesma dos
// nomes dos blendshapes do MediaPipe, eyeBlinkLeft/eyeBlinkRight).
export class BlinkDetector {
  private winkLeftFrames = 0;
  private winkRightFrames = 0;
  private restLeft: number | null = null;
  private restRight: number | null = null;
  private lastTimestamp: number | null = null;

  constructor(private readonly config: DebugConfig) {}

  update(blendshapes: Record<string, number>, timestamp: number): BlinkResult {
    const c = this.config;
    const blinkLeft = blendshapes.eyeBlinkLeft ?? 0;
    const blinkRight = blendshapes.eyeBlinkRight ?? 0;
    const dt = this.lastTimestamp === null ? 0 : timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;

    // Wink por DIFERENÇA entre os olhos. Olhar para baixo faz os dois eyeBlink subirem
    // juntos (a pálpebra acompanha o olhar), então limiares absolutos confundem isso com
    // olho fechado. Um wink sobe só um lado, e é a diferença que o separa.
    // Contadores de frames consecutivos: zeram assim que a condição falha.
    const leftCandidate = blinkLeft - blinkRight > c.winkThreshold;
    const rightCandidate = blinkRight - blinkLeft > c.winkThreshold;
    this.winkLeftFrames = leftCandidate ? this.winkLeftFrames + 1 : 0;
    this.winkRightFrames = rightCandidate ? this.winkRightFrames + 1 : 0;

    // Olho fechado pela SUBIDA acima do repouso daquele olho, não por um valor fixo.
    // Olhar para baixo sobe o eyeBlink devagar e até ~0,5; o repouso acompanha isso.
    // Uma piscada sobe rápido e alto; enquanto o olho está fechado o repouso não se move.
    this.restLeft ??= Math.min(blinkLeft, INITIAL_REST_MAX);
    this.restRight ??= Math.min(blinkRight, INITIAL_REST_MAX);
    const riseLeft = Math.max(0, blinkLeft - this.restLeft);
    const riseRight = Math.max(0, blinkRight - this.restRight);
    const leftClosed = riseLeft > c.blinkRise || blinkLeft > c.doubleBlinkThreshold;
    const rightClosed = riseRight > c.blinkRise || blinkRight > c.doubleBlinkThreshold;
    const k = Math.min(1, dt / REST_TAU_MS);
    if (!leftClosed) this.restLeft += (blinkLeft - this.restLeft) * k;
    if (!rightClosed) this.restRight += (blinkRight - this.restRight) * k;

    return {
      eyeState: {
        leftOpen: 1 - blinkLeft,
        rightOpen: 1 - blinkRight,
        bothClosed: leftClosed && rightClosed,
        winkLeft: this.winkLeftFrames >= c.winkMinFrames,
        winkRight: this.winkRightFrames >= c.winkMinFrames,
      },
      blinkRise: { left: riseLeft, right: riseRight },
      eitherClosed: leftClosed || rightClosed,
      jawOpen: blendshapes.jawOpen ?? 0,
      browInnerUp: blendshapes.browInnerUp ?? 0,
    };
  }

  reset(): void {
    this.winkLeftFrames = 0;
    this.winkRightFrames = 0;
    this.lastTimestamp = null;
  }
}
