import type { DebugConfig, FaceFrame } from '../types';
import { fitRidge, predict } from './ridgeRegression';

type HeadPose = FaceFrame['headPose'];

// v4: média dos dois olhos por sinal (v3 usava cada olho separado; pesos opostos amplificavam tremor).
export const CALIBRATION_VERSION = 4;
const STORAGE_KEY = `duck-of-duty.calibration.v${CALIBRATION_VERSION}`;

export interface CalibrationModel {
  version: number;
  weightsX: number[];
  weightsY: number[];
  /** Média e desvio de cada termo no treino, por eixo, para padronizar (posição 0 = bias, fica 0/1). */
  featureMeanX: number[];
  featureStdX: number[];
  featureMeanY: number[];
  featureStdY: number[];
  headBaseline: { yaw: number; pitch: number; roll: number };
  residuals: number[];        // erro em px por ponto da grade (leave-one-out)
  meanResidual: number;
  createdAt: number;
  screenSize: { w: number; h: number };
  /** Correção somada à mira, definida por "Recentralizar" (olhar o centro). 0 logo após calibrar. */
  aimBias?: { x: number; y: number };
}

export interface CalibrationSample {
  /** Features base, 8 valores na ordem de GAZE_FEATURE_NAMES (mediana da janela). */
  features: number[];
  headPose: HeadPose;
  /** Centro do alvo, em px CSS da janela. */
  target: { x: number; y: number };
  /** Índice 0–8 na grade 3×3. */
  pointIndex: number;
}

/** absent: sem modelo · loaded: veio do localStorage · trained: treinado nesta sessão. */
export type CalibrationStatus = 'absent' | 'loaded' | 'trained';

type Expand = (base: number[]) => number[];

/**
 * Termos da regressão de X de tela: [1, média(lx, rx)]  (só a íris).
 * Termos da regressão de Y de tela: [1, média(ly, ry), média(lidUpL, lidUpR), média(lookDUL, lookDUR)].
 *
 * Histórico, medido por leave-one-out nas amostras reais:
 *  - especificação original, 11 termos quadráticos nos dois eixos: 305 px (ajustava ruído);
 *  - linear [lx, ly, rx, ry] nos dois eixos: 134–157 px, quase todo o erro em Y;
 *  - por eixo, cada olho separado: 106–109 px, mas pesos enormes e de sinais opostos entre
 *    olho esquerdo e direito (+10.580 × −1.889 px por unidade) amplificavam o tremor frame
 *    a frame (~110–150 px em Y);
 *  - por eixo, média dos olhos, λ = 1 (atual): 108–119 px com tremor estimado ~40–50% menor.
 * Os dois lados medem quase o mesmo sinal: a média reduz o ruído em vez de deixar a regressão
 * equilibrar pesos grandes que se cancelam.
 */
export const expandX: Expand = (b) => [1, (b[0] + b[2]) / 2];
export const expandY: Expand = (b) => [1, (b[1] + b[3]) / 2, (b[4] + b[5]) / 2, (b[6] + b[7]) / 2];

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
    const full = trainWeights(samples, lambda, expandX, expandY);

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
      const w = trainWeights(rest, lambda, expandX, expandY);
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
      weightsX: full.x.weights,
      weightsY: full.y.weights,
      featureMeanX: full.x.mean,
      featureStdX: full.x.std,
      featureMeanY: full.y.mean,
      featureStdY: full.y.std,
      headBaseline,
      residuals,
      meanResidual,
      createdAt: Date.now(),
      screenSize: { w: screenW, h: screenH },
      aimBias: { x: 0, y: 0 },
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

  /** Guarda a correção de "Recentralizar" no modelo atual (e no localStorage). */
  setAimBias(bias: { x: number; y: number }): void {
    if (!this.model) return;
    this.model.aimBias = bias;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.model));
    } catch (err) {
      console.warn('[calibração] não foi possível salvar a recentralização', err);
    }
  }

  /** Posição ocular prevista, em px CSS da janela. null sem modelo. */
  apply(features: number[]): { x: number; y: number } | null {
    const m = this.model;
    if (!m) return null;
    return applyWeights(
      {
        x: { weights: m.weightsX, mean: m.featureMeanX, std: m.featureStdX, expand: expandX },
        y: { weights: m.weightsY, mean: m.featureMeanY, std: m.featureStdY, expand: expandY },
      },
      features,
    );
  }
}

interface AxisWeights {
  weights: number[];
  mean: number[];
  std: number[];
  expand: Expand;
}

interface Weights {
  x: AxisWeights;
  y: AxisWeights;
}

/**
 * Duas ridges independentes, uma para X e outra para Y de tela, cada uma com seus
 * próprios termos. Antes de resolver, padroniza os termos não-bias (média 0, desvio 1
 * no conjunto de treino): sem isso, features em escalas diferentes (íris ~0,1,
 * eyeLook ~0,4) seriam penalizadas de forma desigual pelo mesmo λ.
 */
function trainWeights(samples: CalibrationSample[], lambda: number, expX: Expand, expY: Expand): Weights {
  return {
    x: trainAxis(samples, lambda, expX, (s) => s.target.x),
    y: trainAxis(samples, lambda, expY, (s) => s.target.y),
  };
}

function trainAxis(samples: CalibrationSample[], lambda: number, expand: Expand, target: (s: CalibrationSample) => number): AxisWeights {
  const rows = samples.map((s) => expand(s.features));
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
  return { weights: fitRidge(X, samples.map(target), lambda), mean, std, expand };
}

function applyWeights(w: Weights, base: number[]): { x: number; y: number } {
  const axis = (a: AxisWeights) => predict(a.weights, standardize(a.expand(base), a.mean, a.std));
  return { x: axis(w.x), y: axis(w.y) };
}

function standardize(row: number[], mean: number[], std: number[]): number[] {
  return row.map((v, j) => (j === 0 ? 1 : (v - mean[j]) / std[j]));
}
