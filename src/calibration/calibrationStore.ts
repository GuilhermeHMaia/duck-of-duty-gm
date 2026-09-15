import type { DebugConfig, FaceFrame } from '../types';
import { fitRidge, predict } from './ridgeRegression';

type HeadPose = FaceFrame['headPose'];

// v2: modelo linear de 5 termos (v1 tinha 11 termos; pesos incompatíveis).
export const CALIBRATION_VERSION = 2;
const STORAGE_KEY = `duck-of-duty.calibration.v${CALIBRATION_VERSION}`;

export interface CalibrationModel {
  version: number;
  weightsX: number[];
  weightsY: number[];
  /** Média e desvio de cada termo no treino, para padronizar (posição 0 = bias, fica 0/1). */
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
  /** DIAGNÓSTICO TEMPORÁRIO: medianas na janela de sinais verticais candidatos (pálpebras, eyeLook*). */
  extra?: Record<string, number>;
}

/** absent: sem modelo · loaded: veio do localStorage · trained: treinado nesta sessão. */
export type CalibrationStatus = 'absent' | 'loaded' | 'trained';

/**
 * Vetor passado à regressão: [1, lx, ly, rx, ry]  (linear, 5 termos).
 *
 * A especificação original pedia 11 termos (com os quadráticos lx², ly², rx², ry²,
 * lx·ly, rx·ry). Com as amostras reais (18, sinal vertical fraco), os quadráticos
 * ajustavam ruído: leave-one-out de 305 px contra 149 px do linear. Ver
 * QUADRATIC_REFERENCE no diagnóstico para comparar a cada calibração.
 */
export function expandFeatures(base: number[]): number[] {
  const [lx, ly, rx, ry] = base;
  return [1, lx, ly, rx, ry];
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

    logCalibrationDiagnostics(samples, lambda, screenW, screenH); // TEMPORÁRIO

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
 * Sem padronizar, features em escalas diferentes (lx varia ~0,14, ly ~0,06) seriam
 * penalizadas de forma desigual pelo mesmo λ.
 */
function trainWeights(samples: CalibrationSample[], lambda: number, expand = expandFeatures): Weights {
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
  return {
    weightsX: fitRidge(X, samples.map((s) => s.target.x), lambda),
    weightsY: fitRidge(X, samples.map((s) => s.target.y), lambda),
    mean,
    std,
  };
}

function applyWeights(w: Weights, base: number[], expand = expandFeatures): { x: number; y: number } {
  const f = standardize(expand(base), w.mean, w.std);
  return { x: predict(w.weightsX, f), y: predict(w.weightsY, f) };
}

function standardize(row: number[], mean: number[], std: number[]): number[] {
  return row.map((v, j) => (j === 0 ? 1 : (v - mean[j]) / std[j]));
}

// ---------- DIAGNÓSTICO TEMPORÁRIO (remover depois de investigar o erro alto) ----------

/**
 * Imprime no Console, a cada treino:
 *  1. erro dentro do treino × leave-one-out, para o modelo linear atual e o quadrático de referência;
 *  2. erro separado em X e em Y;
 *  3. consistência das features: distância entre as 2 amostras do MESMO alvo × entre alvos diferentes;
 *  4. JSON com as amostras, para copiar e analisar fora do navegador.
 */
function logCalibrationDiagnostics(samples: CalibrationSample[], lambda: number, screenW: number, screenH: number): void {
  const QUADRATIC_REFERENCE = ([lx, ly, rx, ry]: number[]) => [1, lx, ly, rx, ry, lx * lx, ly * ly, rx * rx, ry * ry, lx * ly, rx * ry];
  const models = { 'linear (5) — atual': expandFeatures, 'quadrático (11) — referência': QUADRATIC_REFERENCE };
  const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1);

  const table: Record<string, Record<string, string>> = {};
  for (const [name, expand] of Object.entries(models)) {
    const all = trainWeights(samples, lambda, expand);
    const inSample = samples.map((s) => applyWeights(all, s.features, expand));
    const looPred = samples.map((s) => {
      const w = trainWeights(samples.filter((o) => o.pointIndex !== s.pointIndex), lambda, expand);
      return applyWeights(w, s.features, expand);
    });
    const err = (preds: { x: number; y: number }[], f: (p: { x: number; y: number }, s: CalibrationSample) => number) =>
      avg(preds.map((p, i) => f(p, samples[i]))).toFixed(0);
    table[name] = {
      'treino px': err(inSample, (p, s) => Math.hypot(p.x - s.target.x, p.y - s.target.y)),
      'LOO px': err(looPred, (p, s) => Math.hypot(p.x - s.target.x, p.y - s.target.y)),
      'LOO |X| px': err(looPred, (p, s) => Math.abs(p.x - s.target.x)),
      'LOO |Y| px': err(looPred, (p, s) => Math.abs(p.y - s.target.y)),
    };
  }

  const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, k) => v - b[k]));
  const same: number[] = [];
  const different: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const d = dist(samples[i].features, samples[j].features);
      (samples[i].pointIndex === samples[j].pointIndex ? same : different).push(d);
    }
  }
  const featureSpread = [0, 1, 2, 3].map((k) => {
    const col = samples.map((s) => s.features[k]);
    return (Math.max(...col) - Math.min(...col)).toFixed(4);
  });

  console.groupCollapsed('[calibração][diagnóstico] clique para abrir');
  console.table(table);
  console.log(
    `features — distância média entre as 2 amostras do MESMO alvo: ${avg(same).toFixed(4)} | ` +
      `entre alvos DIFERENTES: ${avg(different).toFixed(4)} | razão: ${(avg(same) / avg(different)).toFixed(2)} ` +
      `(perto de 1 = o olho não distingue os alvos)`,
  );
  console.log(`amplitude (máx − mín) de lx, ly, rx, ry: ${featureSpread.join(', ')}`);
  console.log('COPIE A LINHA ABAIXO E ENVIE:');
  console.log(JSON.stringify({ screenW, screenH, lambda, samples }));
  console.groupEnd();
}
