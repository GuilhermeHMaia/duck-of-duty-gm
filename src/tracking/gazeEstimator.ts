import type { DebugConfig, FaceFrame } from '../types';

/** Ponto 2D em pixels da imagem da câmera (não normalizado, para preservar o aspect ratio). */
interface Point {
  x: number;
  y: number;
}

/**
 * Índices do Face Landmarker (478 pontos), por olho DA PESSOA.
 * Numa imagem sem espelhar, o olho direito da pessoa aparece à esquerda.
 *   íris: centro + 4 pontos do contorno
 *   cantos: os dois extremos horizontais da abertura, na ordem "imagem-esquerda → imagem-direita"
 *   pálpebras: ponto central superior e inferior
 */
const RIGHT_EYE = {
  iris: [468, 469, 470, 471, 472],
  cornerImageLeft: 33,   // canto externo
  cornerImageRight: 133, // canto interno
  upperLid: 159,
  lowerLid: 145,
};

const LEFT_EYE = {
  iris: [473, 474, 475, 476, 477],
  cornerImageLeft: 362,  // canto interno
  cornerImageRight: 263, // canto externo
  upperLid: 386,
  lowerLid: 374,
};

type EyeIndices = typeof RIGHT_EYE;

/**
 * Direção do olhar a partir SÓ da região dos olhos: onde a íris está dentro da
 * abertura ocular. Não usa pose da cabeça nem a posição do rosto na imagem.
 *
 * Saída em [-1, 1], do ponto de vista da pessoa (bate com a tela espelhada):
 *   x = −1 olhando para a própria esquerda, +1 para a própria direita
 *   y = −1 olhando para cima, +1 para baixo
 * Sem calibração: ±1 quer dizer "íris no canto/pálpebra", o que o olho quase
 * nunca alcança. Na prática a faixa útil é bem menor.
 */
export class GazeEstimator {
  constructor(private readonly config: DebugConfig) {}

  /**
   * @param landmarks landmarks normalizados [0,1] do Face Landmarker
   * @param imageWidth/imageHeight tamanho da imagem, para medir distâncias em pixels
   */
  estimate(
    landmarks: ReadonlyArray<Point>,
    imageWidth: number,
    imageHeight: number,
    eyeState: FaceFrame['eyeState'],
  ): { x: number; y: number } | null {
    if (eyeState.bothClosed) return null;

    const toPx = (i: number): Point => ({ x: landmarks[i].x * imageWidth, y: landmarks[i].y * imageHeight });

    // Numa piscadela, usa só o olho que ficou aberto.
    const leftUsable = 1 - eyeState.leftOpen <= this.config.doubleBlinkThreshold;
    const rightUsable = 1 - eyeState.rightOpen <= this.config.doubleBlinkThreshold;

    const samples: Point[] = [];
    if (leftUsable) samples.push(irisPositionInEye(LEFT_EYE, toPx));
    if (rightUsable) samples.push(irisPositionInEye(RIGHT_EYE, toPx));
    if (samples.length === 0) return null;

    let x = 0;
    let y = 0;
    for (const s of samples) {
      x += s.x;
      y += s.y;
    }
    x /= samples.length;
    y /= samples.length;

    // Na imagem da câmera, a íris que vai para a direita da imagem significa a
    // pessoa olhando para a PRÓPRIA esquerda. Inverte X para ficar do ponto de vista dela.
    return { x: clamp(-x), y: clamp(y) };
  }
}

/**
 * Features oculares cruas de um frame, para a regressão da calibração:
 *   [lx, ly, rx, ry]   (l = olho esquerdo DA PESSOA, r = direito)
 *
 * Diferente do gazeRaw (que usa a abertura entre as pálpebras), aqui as duas
 * componentes são medidas contra os CANTOS do olho, que não se movem com o olhar
 * nem com a pálpebra:
 *   eixo u = canto imagem-esquerda → canto imagem-direita (unitário)
 *   eixo v = perpendicular a u, apontando para baixo na imagem
 *   x = (íris − ponto médio dos cantos) · u / largura do olho
 *   y = (íris − ponto médio dos cantos) · v / largura do olho
 * Dividir pela largura do próprio olho remove a distância até a câmera; medir a
 * partir dos cantos remove a posição do rosto na imagem; projetar nos eixos do
 * olho remove a inclinação da cabeça. Sem espelhamento de sinal: a regressão
 * aprende a orientação.
 *
 * Os termos de 2ª ordem e o bias são montados depois (calibrationStore.expandFeatures).
 *
 * Retorna null se qualquer olho estiver fechado: eyeBlink > closedThreshold
 * (o doubleBlinkThreshold, mesmo critério do gazeRaw). Um olho semicerrado, como ao
 * olhar para baixo, continua valendo como aberto.
 */
export function extractGazeFeatures(
  landmarks: ReadonlyArray<Point>,
  imageWidth: number,
  imageHeight: number,
  eyeState: FaceFrame['eyeState'],
  closedThreshold: number,
): number[] | null {
  if (1 - eyeState.leftOpen > closedThreshold || 1 - eyeState.rightOpen > closedThreshold) return null;
  const toPx = (i: number): Point => ({ x: landmarks[i].x * imageWidth, y: landmarks[i].y * imageHeight });
  const left = irisOffsetFromCorners(LEFT_EYE, toPx);
  const right = irisOffsetFromCorners(RIGHT_EYE, toPx);
  if (!left || !right) return null;
  return [left.x, left.y, right.x, right.y];
}

function irisOffsetFromCorners(eye: EyeIndices, toPx: (i: number) => Point): Point | null {
  const a = toPx(eye.cornerImageLeft);
  const b = toPx(eye.cornerImageRight);
  const width = Math.hypot(b.x - a.x, b.y - a.y);
  if (width < 1e-3) return null;
  const ux = (b.x - a.x) / width;
  const uy = (b.y - a.y) / width;
  // Perpendicular: gira u em +90° no sistema da imagem (y para baixo) → aponta para baixo.
  const vx = -uy;
  const vy = ux;
  const iris = centroid(eye.iris.map(toPx));
  const dx = iris.x - (a.x + b.x) / 2;
  const dy = iris.y - (a.y + b.y) / 2;
  return { x: (dx * ux + dy * uy) / width, y: (dx * vx + dy * vy) / width };
}

/**
 * Posição da íris dentro da abertura de um olho, em coordenadas da imagem:
 *   x: projeção do centro da íris no segmento canto→canto; 0 = canto imagem-esquerda,
 *      1 = canto imagem-direita. Remapeado para [-1, 1].
 *   y: projeção no segmento pálpebra superior→inferior; 0 = superior, 1 = inferior.
 *      Remapeado para [-1, 1].
 * Dividir pelo comprimento do próprio segmento normaliza pelo tamanho do olho
 * (independe da distância até a câmera), e projetar no eixo do olho aguenta
 * inclinação da cabeça sem precisar da pose.
 */
function irisPositionInEye(eye: EyeIndices, toPx: (i: number) => Point): Point {
  const iris = centroid(eye.iris.map(toPx));
  return {
    x: 2 * projectOnSegment(iris, toPx(eye.cornerImageLeft), toPx(eye.cornerImageRight)) - 1,
    y: 2 * projectOnSegment(iris, toPx(eye.upperLid), toPx(eye.lowerLid)) - 1,
  };
}

/** t tal que a + t·(b − a) é a projeção de p sobre a reta ab. */
function projectOnSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-6) return 0.5;
  return ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
}

function centroid(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
