export const ROUNDS = 5;
export const DUCKS_PER_ROUND = 10;
const BASE_POINTS = 100;
const POINTS_PER_ROUND_STEP = 0.25; // patos mais rápidos (rodadas seguintes) valem mais
const PERFECT_ROUND_BONUS = 1000;
const RECORD_KEY = 'duck-of-duty.record.v1';

export type DuckResult = 'hit' | 'miss' | null;

/** Pontuação da partida: pontos por pato, bônus de rodada perfeita e recorde no localStorage. */
export class Score {
  total = 0;
  record = 0;
  /** Resultado de cada pato da rodada atual (null = ainda não saiu / em voo). */
  roundResults: DuckResult[] = [];
  hitsTotal = 0;

  constructor() {
    try {
      this.record = Number(localStorage.getItem(RECORD_KEY)) || 0;
    } catch {
      this.record = 0;
    }
  }

  static pointsPerDuck(round: number): number {
    return Math.round(BASE_POINTS * (1 + POINTS_PER_ROUND_STEP * (round - 1)));
  }

  startGame(): void {
    this.total = 0;
    this.hitsTotal = 0;
  }

  startRound(): void {
    this.roundResults = new Array(DUCKS_PER_ROUND).fill(null);
  }

  /** Registra um pato abatido e devolve os pontos ganhos. */
  hit(round: number, slot: number): number {
    const points = Score.pointsPerDuck(round);
    this.roundResults[slot] = 'hit';
    this.total += points;
    this.hitsTotal++;
    return points;
  }

  escaped(slot: number): void {
    this.roundResults[slot] = 'miss';
  }

  /** Fecha a rodada; devolve o bônus (0 se não foi perfeita). */
  endRound(): number {
    const perfect = this.roundResults.every((r) => r === 'hit');
    if (!perfect) return 0;
    this.total += PERFECT_ROUND_BONUS;
    return PERFECT_ROUND_BONUS;
  }

  /** Fecha a partida; devolve true se bateu o recorde (e o salva). */
  endGame(): boolean {
    if (this.total <= this.record) return false;
    this.record = this.total;
    try {
      localStorage.setItem(RECORD_KEY, String(this.record));
    } catch {
      // sem localStorage: o recorde vale só nesta sessão
    }
    return true;
  }
}
