// Único arquivo do projeto que conhece a API do MediaPipe.
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { MODEL_ASSET_PATH, WASM_BASE_URL } from '../config';
import type { DebugConfig, FaceFrame } from '../types';
import { BlinkDetector } from './blinkDetector';
import { extractGazeFeatures, GazeEstimator } from './gazeEstimator';
import { extractHeadPose } from './headPose';
import { OneEuroFilter } from './oneEuroFilter';

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private readonly blink: BlinkDetector;
  private readonly gaze: GazeEstimator;
  private readonly filterX: OneEuroFilter;
  private readonly filterY: OneEuroFilter;
  private lastVideoTimestamp = -1;
  private landmarks: ReadonlyArray<{ x: number; y: number }> | null = null;

  constructor(private readonly config: DebugConfig) {
    this.blink = new BlinkDetector(config);
    this.gaze = new GazeEstimator(config);
    this.filterX = new OneEuroFilter(config.minCutoff, config.beta, config.dCutoff);
    this.filterY = new OneEuroFilter(config.minCutoff, config.beta, config.dCutoff);
  }

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_ASSET_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO',
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  }

  /** Landmarks normalizados [0,1] do último frame processado, ou null sem rosto. Para desenho no debug. */
  getLandmarks(): ReadonlyArray<{ x: number; y: number }> | null {
    return this.landmarks;
  }

  /** @param timestamp ms, monotônico (performance.now / requestVideoFrameCallback) */
  process(video: HTMLVideoElement, timestamp: number): FaceFrame {
    if (!this.landmarker) throw new Error('FaceTracker.process chamado antes de init()');

    // O modo VIDEO exige timestamps estritamente crescentes.
    const ts = Math.max(timestamp, this.lastVideoTimestamp + 0.001);
    this.lastVideoTimestamp = ts;

    const result = this.landmarker.detectForVideo(video, ts);
    const faceLandmarks = result.faceLandmarks[0];

    if (!faceLandmarks) {
      this.landmarks = null;
      this.blink.reset();
      this.filterX.reset();
      this.filterY.reset();
      return {
        timestamp: ts,
        gazeRaw: null,
        gazeFiltered: null,
        headPose: { yaw: 0, pitch: 0, roll: 0 },
        blendshapes: {},
        eyeState: { leftOpen: 0, rightOpen: 0, bothClosed: false, winkLeft: false, winkRight: false },
        faceDetected: false,
        gazeFeatures: null,
      };
    }
    this.landmarks = faceLandmarks;

    const blendshapes: Record<string, number> = {};
    for (const category of result.faceBlendshapes[0]?.categories ?? []) {
      blendshapes[category.categoryName] = category.score;
    }

    const matrix = result.facialTransformationMatrixes[0];
    const headPose = matrix ? extractHeadPose(matrix.data) : { yaw: 0, pitch: 0, roll: 0 };

    const { eyeState } = this.blink.update(blendshapes);

    const gazeRaw = this.gaze.estimate(faceLandmarks, video.videoWidth, video.videoHeight, eyeState);

    // Parâmetros relidos a cada frame: o painel muta o DebugConfig diretamente.
    const c = this.config;
    this.filterX.updateParams(c.minCutoff, c.beta, c.dCutoff);
    this.filterY.updateParams(c.minCutoff, c.beta, c.dCutoff);
    const gazeFiltered = gazeRaw
      ? { x: this.filterX.filter(gazeRaw.x, ts / 1000), y: this.filterY.filter(gazeRaw.y, ts / 1000) }
      : null;

    const gazeFeatures = extractGazeFeatures(faceLandmarks, video.videoWidth, video.videoHeight, eyeState, c.winkThreshold);

    return { timestamp: ts, gazeRaw, gazeFiltered, headPose, blendshapes, eyeState, faceDetected: true, gazeFeatures };
  }
}
