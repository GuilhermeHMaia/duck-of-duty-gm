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
  /** Features oculares base [lx, ly, rx, ry] (ver extractGazeFeatures). null sem rosto ou com olho fechado. */
  gazeFeatures: number[] | null;
}

export interface DebugConfig {
  winkThreshold: number;         // 0.5
  winkCounterThreshold: number;  // 0.25
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
}
