import type { DebugConfig, FaceFrame } from '../types';

export interface BlinkResult {
  eyeState: FaceFrame['eyeState'];
  jawOpen: number;
  browInnerUp: number;
}

// Convenção: "Left"/"Right" = olho esquerdo/direito DA PESSOA (a mesma dos
// nomes dos blendshapes do MediaPipe, eyeBlinkLeft/eyeBlinkRight).
export class BlinkDetector {
  private winkLeftFrames = 0;
  private winkRightFrames = 0;

  constructor(private readonly config: DebugConfig) {}

  update(blendshapes: Record<string, number>): BlinkResult {
    const c = this.config;
    const blinkLeft = blendshapes.eyeBlinkLeft ?? 0;
    const blinkRight = blendshapes.eyeBlinkRight ?? 0;

    // Wink por DIFERENÇA entre os olhos. Olhar para baixo faz os dois eyeBlink subirem
    // juntos (a pálpebra acompanha o olhar), então limiares absolutos confundem isso com
    // olho fechado. Um wink sobe só um lado, e é a diferença que o separa.
    // Contadores de frames consecutivos: zeram assim que a condição falha.
    const leftCandidate = blinkLeft - blinkRight > c.winkThreshold;
    const rightCandidate = blinkRight - blinkLeft > c.winkThreshold;
    this.winkLeftFrames = leftCandidate ? this.winkLeftFrames + 1 : 0;
    this.winkRightFrames = rightCandidate ? this.winkRightFrames + 1 : 0;

    return {
      eyeState: {
        leftOpen: 1 - blinkLeft,
        rightOpen: 1 - blinkRight,
        bothClosed: blinkLeft > c.doubleBlinkThreshold && blinkRight > c.doubleBlinkThreshold,
        winkLeft: this.winkLeftFrames >= c.winkMinFrames,
        winkRight: this.winkRightFrames >= c.winkMinFrames,
      },
      jawOpen: blendshapes.jawOpen ?? 0,
      browInnerUp: blendshapes.browInnerUp ?? 0,
    };
  }

  reset(): void {
    this.winkLeftFrames = 0;
    this.winkRightFrames = 0;
  }
}
