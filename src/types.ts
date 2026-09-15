export interface FaceFrame {
  timestamp: number;
  gazeRaw: { x: number; y: number } | null;
  gazeFiltered: { x: number; y: number } | null;
  headPose: { yaw: number; pitch: number; roll: number };
  blendshapes: Record<string, number>;
  eyeState: {
    leftOpen: number;
    rightOpen: number;
    bothClosed: boolean;
    winkLeft: boolean;
    winkRight: boolean;
  };
  faceDetected: boolean;
  /** Features oculares base, 8 valores (ver extractGazeFeatures / GAZE_FEATURE_NAMES). null sem rosto ou com olho fechado. */
  gazeFeatures: number[] | null;
}

export interface DebugConfig {
  winkThreshold: number;         // 0.5  — limiar da DIFERENÇA entre os olhos (|eyeBlinkLeft − eyeBlinkRight|) para wink
  winkCounterThreshold: number;  // 0.25 — sem uso desde que o wink passou a ser por diferença
  winkMinFrames: number;         // 2
  doubleBlinkThreshold: number;  // 0.5
  minCutoff: number;             // 1.0
  beta: number;                  // 0.007
  dCutoff: number;               // 1.0
  preBlinkBufferMs: number;      // 180
  snapRadius: number;            // 70
  snapHysteresis: number;        // 25
  headWeight: number;            // 0.65
  headDeadzone: number;          // 3.0   (graus)
  eyeMaxOffset: number;          // 150   (pixels)
  ridgeLambda: number;           // 0.001
  cursorMinCutoff: number;       // 1.0
  cursorBeta: number;            // 0.02
  duckSpeed: number;             // 220   (px/s na rodada 1; +25% por rodada)
  duckEscapeMs: number;          // 6000  (tempo de voo antes de o pato fugir)
  focusFillPerSec: number;       // 1.25  (foco ganho por segundo com a mira grudada num pato)
  focusDecayPerSec: number;      // 0.8   (foco perdido por segundo fora dos patos)
  focusToShoot: number;          // 1.0   (foco mínimo para o tiro derrubar)
}
