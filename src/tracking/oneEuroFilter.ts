/**
 * 1€ Filter — Casiez, Roussel & Vogel, "1€ Filter: A Simple Speed-based Low-pass
 * Filter for Noisy Input in Interactive Systems", CHI 2012.
 *
 * Implementação de referência usada: versão TypeScript oficial dos autores,
 * https://github.com/casiez/OneEuroFilter/blob/main/typescript/src/OneEuroFilter.ts
 * (Alix Giguey e Géry Casiez, detalhes em https://gery.casiez.net/1euro/).
 * Licença da referência: BSD 3-Clause. Este arquivo é uma adaptação dela
 * (API reduzida a filter/reset/updateParams e timestamp obrigatório), então o
 * aviso original segue abaixo, como a licença exige:
 *
 *   Copyright 2019 Inria
 *   BSD License https://opensource.org/licenses/BSD-3-Clause
 *
 *   Redistribution and use in source and binary forms, with or without
 *   modification, are permitted provided that the following conditions are met:
 *   1. Redistributions of source code must retain the above copyright notice,
 *      this list of conditions and the following disclaimer.
 *   2. Redistributions in binary form must reproduce the above copyright notice,
 *      this list of conditions and the following disclaimer in the documentation
 *      and/or other materials provided with the distribution.
 *   3. Neither the name of the copyright holder nor the names of its contributors
 *      may be used to endorse or promote products derived from this software
 *      without specific prior written permission.
 *
 *   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 *   ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 *   WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 *   DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
 *   ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 *   (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 *   LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 *   ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 *   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 *   SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * Passa-baixa exponencial de primeira ordem: s_i = a·x_i + (1 − a)·s_{i−1}.
 * a ∈ (0, 1]: a = 1 não filtra nada, a → 0 filtra muito.
 */
class LowPassFilter {
  private lastFiltered = 0;
  private initialized = false;

  filterWithAlpha(value: number, alpha: number): number {
    // A primeira amostra não tem histórico: passa direto e vira o estado inicial.
    const result = this.initialized ? alpha * value + (1 - alpha) * this.lastFiltered : value;
    this.initialized = true;
    this.lastFiltered = result;
    return result;
  }

  hasLastValue(): boolean {
    return this.initialized;
  }

  lastValue(): number {
    return this.lastFiltered;
  }

  reset(): void {
    this.initialized = false;
  }
}

export class OneEuroFilter {
  private readonly x = new LowPassFilter();   // filtra o sinal
  private readonly dx = new LowPassFilter();  // filtra a derivada (velocidade)
  private lastTimestamp: number | null = null;
  private freq = 30; // estimativa inicial em Hz; é substituída a partir dos timestamps

  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff: number,
  ) {}

  updateParams(minCutoff: number, beta: number, dCutoff: number): void {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastTimestamp = null;
  }

  /**
   * @param value     amostra ruidosa
   * @param timestamp em SEGUNDOS
   */
  filter(value: number, timestamp: number): number {
    // Passo 1 — taxa de amostragem. O período Te = 1/freq sai da diferença entre
    // timestamps, então o filtro aguenta frames com intervalo irregular.
    if (this.lastTimestamp !== null && timestamp > this.lastTimestamp) {
      this.freq = 1 / (timestamp - this.lastTimestamp);
    }
    this.lastTimestamp = timestamp;

    // Passo 2 — velocidade do sinal: (x_i − x̂_{i−1}) · freq, medida contra o
    // último valor FILTRADO (como no paper). Na primeira amostra vale 0.
    const rawDerivative = this.x.hasLastValue() ? (value - this.x.lastValue()) * this.freq : 0;

    // Passo 3 — suaviza a velocidade com cutoff fixo dCutoff, para o ruído da
    // derivada não fazer o cutoff do passo 4 oscilar.
    const derivative = this.dx.filterWithAlpha(rawDerivative, this.alpha(this.dCutoff));

    // Passo 4 — cutoff adaptativo: f_c = minCutoff + beta·|velocidade|.
    // Parado → f_c ≈ minCutoff (filtra muito, tira jitter).
    // Rápido → f_c cresce (filtra pouco, reduz atraso).
    const cutoff = this.minCutoff + this.beta * Math.abs(derivative);

    // Passo 5 — aplica o passa-baixa ao sinal com o alpha desse cutoff.
    return this.x.filterWithAlpha(value, this.alpha(cutoff));
  }

  /**
   * Converte frequência de corte em alpha do passa-baixa:
   *   τ = 1 / (2π·f_c)   (constante de tempo)
   *   a = 1 / (1 + τ/Te) com Te = 1/freq
   */
  private alpha(cutoff: number): number {
    const te = 1 / this.freq;
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / te);
  }
}
