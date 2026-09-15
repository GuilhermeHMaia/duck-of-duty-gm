// Único lugar com URLs e caminhos de assets do MediaPipe.

export type ModelPrecision = 'float16' | 'float32';

// Mantenha igual à versão de @mediapipe/tasks-vision em package.json:
// o JS do pacote e o WASM precisam ser da mesma versão.
const MEDIAPIPE_VERSION = '1.0.1';

export const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

export const MODEL_PRECISION: ModelPrecision = 'float16';

const MODEL_URLS: Record<ModelPrecision, string> = {
  float16:
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  // O Google não publica um float32 do Face Landmarker (float32/1 e float32/latest dão 404).
  // Para usar, coloque o arquivo em public/ com este nome.
  float32: '/face_landmarker_float32.task',
};

export const MODEL_ASSET_PATH = MODEL_URLS[MODEL_PRECISION];
