// Troque um sinal para inverter a orientação daquele eixo, sem mexer na matemática.
export const YAW_SIGN = -1; // testado: virar para a direita dava yaw negativo; aiming.ts espera positivo = direita
export const PITCH_SIGN = -1; // testado: cabeça erguida dava pitch negativo; aiming.ts espera positivo = cima
export const ROLL_SIGN = 1;

// Acima deste |sin(pitch)| (≈ 87,4°), yaw e roll ficam indistinguíveis (gimbal lock).
const GIMBAL_LOCK_SIN = 0.999;

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Extrai yaw/pitch/roll (graus) da facialTransformationMatrixes do MediaPipe.
 *
 * LAYOUT DO ARRAY
 * `matrix` é o `data` de 16 números de uma matriz 4×4 em COLUMN-MAJOR: o array
 * vem direto do campo `packed_data` do proto `MatrixData`, cujo layout padrão é
 * column-major. Logo, elemento(linha r, coluna c) = data[c * 4 + r].
 *
 * Rotação 3×3 (bloco superior esquerdo) → índice no array plano:
 *
 *            col 0      col 1      col 2
 *   linha 0  R00=d[0]   R01=d[4]   R02=d[8]
 *   linha 1  R10=d[1]   R11=d[5]   R12=d[9]
 *   linha 2  R20=d[2]   R21=d[6]   R22=d[10]
 *
 * (d[12], d[13], d[14] são a translação; d[3], d[7], d[11] = 0; d[15] = 1.)
 *
 * CONVENÇÃO DOS ÂNGULOS
 * Espaço do rosto canônico do MediaPipe: X lateral, Y para cima, Z saindo do
 * rosto em direção à câmera (destro). Decomposição R = Ry(yaw) · Rx(pitch) · Rz(roll)
 * (ordem "YXZ"):
 *   yaw   = rotação em torno de Y (virar a cabeça para os lados)
 *   pitch = rotação em torno de X (acenar sim)
 *   roll  = rotação em torno de Z (inclinar a cabeça para o ombro)
 * Expandindo o produto:
 *   R02 =  sin(yaw)·cos(pitch)
 *   R12 = −sin(pitch)
 *   R22 =  cos(yaw)·cos(pitch)
 *   R10 =  cos(pitch)·sin(roll)
 *   R11 =  cos(pitch)·cos(roll)
 * O sentido positivo segue a regra da mão direita em cada eixo. Se na tela
 * parecer invertido, troque o *_SIGN correspondente.
 */
export function extractHeadPose(matrix: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  // Normaliza cada coluna da rotação, para o caso de a matriz carregar escala.
  const sx = Math.hypot(matrix[0], matrix[1], matrix[2]) || 1;
  const sy = Math.hypot(matrix[4], matrix[5], matrix[6]) || 1;
  const sz = Math.hypot(matrix[8], matrix[9], matrix[10]) || 1;

  const r00 = matrix[0] / sx;
  const r10 = matrix[1] / sx;
  const r20 = matrix[2] / sx;
  const r11 = matrix[5] / sy;
  const r02 = matrix[8] / sz;
  const r12 = matrix[9] / sz;
  const r22 = matrix[10] / sz;

  const sinPitch = Math.max(-1, Math.min(1, -r12));
  const pitch = Math.asin(sinPitch);

  let yaw: number;
  let roll: number;
  if (Math.abs(sinPitch) < GIMBAL_LOCK_SIN) {
    yaw = Math.atan2(r02, r22);
    roll = Math.atan2(r10, r11);
  } else {
    // Gimbal lock: com cos(pitch) ≈ 0, R02/R22 e R10/R11 viram ≈ 0/0 e o atan2
    // fica instável. Só a soma (ou diferença) yaw ± roll é observável; fixamos
    // roll = 0 e jogamos toda a rotação restante em yaw, lida de R00 e R20
    // (com roll = 0: R00 = cos(yaw), R20 = −sin(yaw)).
    yaw = Math.atan2(-r20, r00);
    roll = 0;
  }

  return {
    yaw: YAW_SIGN * yaw * RAD_TO_DEG,
    pitch: PITCH_SIGN * pitch * RAD_TO_DEG,
    roll: ROLL_SIGN * roll * RAD_TO_DEG,
  };
}
