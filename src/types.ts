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
  /**
   * Quanto cada eyeBlink está ACIMA do nível de repouso daquele olho (0 = normal).
   * O repouso acompanha devagar a pálpebra caída de quem olha para baixo; uma piscada sobe rápido.
   */
  blinkRise: { left: number; right: number };
}

export interface DebugConfig {
  winkThreshold: number;         // 0.5  — limiar da DIFERENÇA entre os olhos (|eyeBlinkLeft − eyeBlinkRight|) para wink
  winkCounterThreshold: number;  // 0.25 — sem uso desde que o wink passou a ser por diferença
  winkMinFrames: number;         // 2
  doubleBlinkThreshold: number;  // 0.8  — eyeBlink acima disso = olho fechado sempre (teto absoluto)
  blinkRise: number;             // 0.35 — subida acima do repouso que conta como olho fechado
  minCutoff: number;             // 1.0
  beta: number;                  // 0.007
  dCutoff: number;               // 1.0
  preBlinkBufferMs: number;      // 180
  snapRadius: number;            // 110
  snapHysteresis: number;        // 60
  headGain: number;              // 45    (px de mira por grau de rotação da cabeça, igual nos dois eixos)
  headDeadzone: number;          // 0     (graus; com a soma cabeça+olho, zona morta atrapalha a compensação)
  eyeMaxOffset: number;          // 1200  (pixels; limite da contribuição do olho a partir do centro)
  ridgeLambda: number;           // 1
  eyeMinCutoff: number;          // 0.5   (filtro 1€ da contribuição do olho, sinal ruidoso: filtra forte)
  eyeBeta: number;               // 0.005
  headMinCutoff: number;         // 1.5   (filtro 1€ da contribuição da cabeça, sinal limpo: filtra leve)
  headBeta: number;              // 0.02
  duckSpeed: number;             // 130   (px/s na rodada 1; +30% por rodada)
  duckEscapeMs: number;          // 9000  (tempo de voo antes de o pato fugir)
  focusFillPerSec: number;       // 1.25  (foco ganho por segundo com a mira grudada num pato)
  focusDecayPerSec: number;      // 0.3   (foco perdido por segundo fora dos patos, após 300 ms de tolerância)
  focusToShoot: number;          // 0.6   (foco mínimo para o tiro derrubar)
}
