import type { FaceFrame } from '../types';

const CAPACITY = 60;

/**
 * Buffer circular dos últimos 60 FaceFrame (era 20 no M0; aumentado para cobrir a
 * janela de coleta da calibração, 500 ms antes do início do wink, a 30 FPS).
 * A 30 FPS isso cobre 2 s de histórico. getFrameAgo com N maior que isso devolve
 * o frame mais antigo disponível.
 */
export class FrameBuffer {
  private readonly frames: (FaceFrame | undefined)[] = new Array(CAPACITY);
  private next = 0;  // posição onde o próximo push escreve
  private count = 0;

  push(frame: FaceFrame): void {
    this.frames[this.next] = frame;
    this.next = (this.next + 1) % CAPACITY;
    this.count = Math.min(this.count + 1, CAPACITY);
  }

  latest(): FaceFrame | null {
    if (this.count === 0) return null;
    return this.frames[(this.next - 1 + CAPACITY) % CAPACITY] ?? null;
  }

  /** Todos os frames guardados, do mais antigo para o mais recente. */
  getFrames(): FaceFrame[] {
    const out: FaceFrame[] = [];
    const start = (this.next - this.count + CAPACITY) % CAPACITY;
    for (let i = 0; i < this.count; i++) {
      const frame = this.frames[(start + i) % CAPACITY];
      if (frame) out.push(frame);
    }
    return out;
  }

  /** Frame cujo timestamp está mais perto de (timestamp do último frame − ms). */
  getFrameAgo(ms: number): FaceFrame | null {
    const newest = this.latest();
    if (!newest) return null;
    const target = newest.timestamp - ms;

    let best: FaceFrame | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < this.count; i++) {
      const frame = this.frames[i];
      if (!frame) continue;
      const dist = Math.abs(frame.timestamp - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = frame;
      }
    }
    return best;
  }
}
