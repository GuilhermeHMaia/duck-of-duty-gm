import type { DebugConfig, FaceFrame } from '../types';
import { fitRidge, predict } from './ridgeRegression';

type HeadPose = FaceFrame['headPose'];

export const CALIBRATION_VERSION = 1;
const STORAGE_KEY = `duck-of-duty.calibration.v${CALIBRATION_VERSION}`;

export interface CalibrationModel {
  version: number;
  weightsX: number[];
  weightsY: number[];
  /** Média e desvio de cada um dos 11 termos no treino, para padronizar (posição 0 = bias, fica 0/1). */
  featureMean: number[];
  featureStd: number[];
  headBaseline: { yaw: number; pitch: number; roll: number };
  residuals: number[];        // erro em px por ponto da grade (leave-one-out)
  meanResidual: number;
  createdAt: number;
  screenSize: { w: number; h: number };
}

export interface CalibrationSample {
  /** Features base [lx, ly, rx, ry] (mediana da janela). */
  features: number[];
  headPose: HeadPose;
  /** Centro do alvo, em px CSS da janela. */
  target: { x: number; y: number };
  /** Índice 0–8 na grade 3×3. */
  pointIndex: number;
}

/** absent: sem modelo · loaded: veio do localStorage · trained: treinado nesta sessão. */
export type CalibrationStatus = 'absent' | 'loaded' | 'trained';

/**
 * Vetor de 11 termos passado à regressão:
 *   [1, lx, ly, rx, ry, lx², ly², rx², ry², lx·ly, rx·ry]
 */
export function expandFeatures(base: number[]): number[] {
  const [lx, ly, rx, ry] = base;
  return [1, lx, ly, rx, ry, lx * lx, ly * ly, rx * rx, ry * ry, lx * ly, rx * ry];
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export class CalibrationStore {
  model: CalibrationModel | null = null;
  status: CalibrationStatus = 'absent';
  /** Motivo da última invalidação (ex.: janela redimensionada), para avisar no painel. */
  invalidatedReason: string | null = null;

  constructor(private readonly config: DebugConfig) {}

  /** Carrega do localStorage. Descarta se a versão ou o tamanho da janela não baterem. */
  load(screenW: number, screenH: number): void {
    let saved: CalibrationModel | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      saved = raw ? (JSON.parse(raw) as CalibrationModel) : null;
    } catch (err) {
      console.warn('[calibração] não foi possível ler o localStorage', err);
    }
    if (!saved || saved.version !== CALIBRATION_VERSION) return;
    this.model = saved;
    this.status = 'loaded';
    this.checkScreen(screenW, screenH);
  }

  /** Invalida (e apaga do localStorage) se a janela mudou de tamanho desde o treino. */
  checkScreen(screenW: number, screenH: number): boolean {
    const m = this.model;
    if (!m) return true;
    if (m.screenSize.w === screenW && m.screenSize.h === screenH) return true;
    this.clear();
    this.invalidatedReason =
      `A janela mudou de ${m.screenSize.w}×${m.screenSize.h} para ${screenW}×${screenH}. Calibração descartada — recalibre.`;
    return false;
  }

  clear(): void {
    this.model = null;
    this.status = 'absent';
    this.invalidatedReason = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.warn('[calibração] não foi possível limpar o localStorage', err);
    }
  }

  /** Treina com todas as amostras, calcula os resíduos leave-one-out e a baseline da cabeça, e persiste. */
  fit(samples: CalibrationSample[], screenW: number, screenH: number): CalibrationModel {
    const lambda = this.config.ridgeLambda;
    const full = trainWeights(samples, lambda);

    // Leave-one-out POR PONTO DA GRADE: tira as duas amostras do ponto, treina com o
    // resto e mede a distância (px) entre a previsão e o alvo, na média das amostras do ponto.
    const residuals: number[] = [];
    for (let point = 0; point < 9; point++) {
      const heldOut = samples.filter((s) => s.pointIndex === point);
      const rest = samples.filter((s) => s.pointIndex !== point);
      if (heldOut.length === 0 || rest.length === 0) {
        residuals.push(NaN);
        continue;
      }
      const w = trainWeights(rest, lambda);
      const errors = heldOut.map((s) => {
        const p = applyWeights(w, s.features);
        return Math.hypot(p.x - s.target.x, p.y - s.target.y);
      });
      residuals.push(errors.reduce((a, b) => a + b, 0) / errors.length);
    }
    const valid = residuals.filter((r) => Number.isFinite(r));
    const meanResidual = valid.reduce((a, b) => a + b, 0) / Math.max(valid.length, 1);

    // Baseline da cabeça: mediana da pose de todas as amostras. Em runtime a cabeça
    // entra sempre como delta em relação a ela (ver aiming.ts).
    const headBaseline = {
      yaw: median(samples.map((s) => s.headPose.yaw)),
      pitch: median(samples.map((s) => s.headPose.pitch)),
      roll: median(samples.map((s) => s.headPose.roll)),
    };

    const model: CalibrationModel = {
      version: CALIBRATION_VERSION,
      weightsX: full.weightsX,
      weightsY: full.weightsY,
      featureMean: full.mean,
      featureStd: full.std,
      headBaseline,
      residuals,
      meanResidual,
      createdAt: Date.now(),
      screenSize: { w: screenW, h: screenH },
    };

    this.model = model;
    this.status = 'trained';
    this.invalidatedReason = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
    } catch (err) {
      console.warn('[calibração] não foi possível salvar no localStorage', err);
    }
    return model;
  }

  /** Posição ocular prevista, em px CSS da janela. null sem modelo. */
  apply(features: number[]): { x: number; y: number } | null {
    const m = this.model;
    if (!m) return null;
    return applyWeights({ weightsX: m.weightsX, weightsY: m.weightsY, mean: m.featureMean, std: m.featureStd }, features);
  }
}

interface Weights {
  weightsX: number[];
  weightsY: number[];
  mean: number[];
  std: number[];
}

/**
 * Padroniza os 10 termos não-bias (média 0, desvio 1 no conjunto de treino) e
 * resolve duas ridges independentes, uma para X e outra para Y de tela.
 * Sem padronizar, os termos quadráticos (valores ~0,001) e os lineares (~0,05)
 * ficariam em escalas diferentes e o mesmo λ penalizaria cada um de forma desigual.
 */
function trainWeights(samples: CalibrationSample[], lambda: number): Weights {
  const rows = samples.map((s) => expandFeatures(s.features));
  const p = rows[0].length;
  const mean = new Array(p).fill(0);
  const std = new Array(p).fill(1);
  for (let j = 1; j < p; j++) {
    const col = rows.map((r) => r[j]);
    mean[j] = col.reduce((a, b) => a + b, 0) / col.length;
    const variance = col.reduce((a, v) => a + (v - mean[j]) ** 2, 0) / col.length;
    std[j] = variance > 1e-18 ? Math.sqrt(variance) : 1;
  }
  const X = rows.map((r) => standardize(r, mean, std));
  return {
    weightsX: fitRidge(X, samples.map((s) => s.target.x), lambda),
    weightsY: fitRidge(X, samples.map((s) => s.target.y), lambda),
    mean,
    std,
  };
}

function applyWeights(w: Weights, base: number[]): { x: number; y: number } {
  const f = standardize(expandFeatures(base), w.mean, w.std);
  return { x: predict(w.weightsX, f), y: predict(w.weightsY, f) };
}

function standardize(row: number[], mean: number[], std: number[]): number[] {
  return row.map((v, j) => (j === 0 ? 1 : (v - mean[j]) / std[j]));
}
