/**
 * Regressão ridge (mínimos quadrados com penalidade L2), sem dependências.
 *
 * PROBLEMA
 * Temos n amostras. Cada linha X[i] é um vetor de p features (aqui p = 5, com o
 * bias na posição 0) e y[i] é o valor alvo (a coordenada X ou Y do alvo na tela,
 * em pixels). Queremos pesos w tais que  X[i] · w ≈ y[i].
 *
 * Mínimos quadrados puro minimiza  ‖Xw − y‖².  Com poucas amostras (18) e vários
 * pesos, isso tende a sobreajustar: os pesos crescem para caçar o ruído. A ridge
 * soma uma penalidade no tamanho dos pesos:
 *
 *     J(w) = ‖Xw − y‖² + λ · Σ_{j≥1} w_j²
 *
 * O bias (j = 0) fica fora da penalidade: ele só desloca a previsão inteira e
 * encolhê-lo puxaria tudo em direção a zero pixel sem motivo.
 *
 * SOLUÇÃO FECHADA (equações normais)
 * Derivando J em relação a w e igualando a zero:
 *
 *     2Xᵀ(Xw − y) + 2λI'w = 0   ⇒   (XᵀX + λI') w = Xᵀy
 *     w = (XᵀX + λI')⁻¹ Xᵀy
 *
 * onde I' é a identidade com I'[0][0] = 0 (sem penalizar o bias).
 * XᵀX é p×p (5×5), então inverter é barato; basta Gauss-Jordan.
 */

/** Maior |pivô| aceitável relativo à escala da matriz, abaixo disso tratamos como singular. */
const SINGULAR_EPS = 1e-10;
const MAX_LAMBDA_RETRIES = 12;

export function fitRidge(X: number[][], y: number[], lambda: number): number[] {
  const p = X[0].length;

  // XᵀX e Xᵀy, acumulando linha a linha:
  //   (XᵀX)[j][k] = Σ_i X[i][j]·X[i][k]      (Xᵀy)[j] = Σ_i X[i][j]·y[i]
  const xtx: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const xty: number[] = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    const row = X[i];
    for (let j = 0; j < p; j++) {
      xty[j] += row[j] * y[i];
      for (let k = 0; k < p; k++) xtx[j][k] += row[j] * row[k];
    }
  }

  let lam = lambda;
  for (let attempt = 0; attempt <= MAX_LAMBDA_RETRIES; attempt++) {
    // A = XᵀX + λI', com I'[0][0] = 0.
    const a = xtx.map((row, j) => row.map((v, k) => (j === k && j !== 0 ? v + lam : v)));
    const inv = invertGaussJordan(a);
    if (inv) {
      if (lam !== lambda) console.warn(`[ridge] matriz singular com λ=${lambda}; resolvido com λ=${lam}`);
      // w = A⁻¹ · Xᵀy
      return inv.map((row) => row.reduce((sum, v, k) => sum + v * xty[k], 0));
    }
    // Singular: aumenta λ. Mais penalidade soma mais na diagonal e afasta a matriz da singularidade.
    lam = lam > 0 ? lam * 10 : 1e-6;
  }
  throw new Error('[ridge] matriz continua singular mesmo aumentando λ');
}

/** Previsão linear: w · features (features já inclui o bias na posição 0). */
export function predict(weights: number[], features: number[]): number {
  let sum = 0;
  for (let j = 0; j < weights.length; j++) sum += weights[j] * features[j];
  return sum;
}

/**
 * Inversa por Gauss-Jordan com pivotamento parcial.
 *
 * Monta a matriz aumentada [A | I] e aplica operações de linha até a metade
 * esquerda virar I; a metade direita vira A⁻¹. Para cada coluna c:
 *   1. Pivotamento parcial: escolhe, entre as linhas c..p−1, a de maior |valor| na
 *      coluna c e troca com a linha c. Dividir por números pequenos amplifica erro
 *      de ponto flutuante; o maior pivô disponível minimiza isso.
 *   2. Se até o maior pivô for ~0, a coluna é combinação das outras → singular.
 *   3. Divide a linha c pelo pivô (o pivô vira 1).
 *   4. Subtrai múltiplos da linha c de TODAS as outras linhas (acima e abaixo),
 *      zerando a coluna c fora da diagonal. Isso é o "Jordan": elimina dos dois lados,
 *      então não precisa de substituição de volta no final.
 *
 * Retorna null se singular.
 */
function invertGaussJordan(a: number[][]): number[][] | null {
  const n = a.length;
  const aug = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, k) => (k === i ? 1 : 0))]);

  let scale = 0;
  for (const row of a) for (const v of row) scale = Math.max(scale, Math.abs(v));
  if (scale === 0) return null;

  for (let c = 0; c < n; c++) {
    // 1. pivotamento parcial
    let pivotRow = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(aug[r][c]) > Math.abs(aug[pivotRow][c])) pivotRow = r;
    }
    // 2. teste de singularidade
    if (Math.abs(aug[pivotRow][c]) < SINGULAR_EPS * scale) return null;
    [aug[c], aug[pivotRow]] = [aug[pivotRow], aug[c]];

    // 3. normaliza a linha do pivô
    const pivot = aug[c][c];
    for (let k = 0; k < 2 * n; k++) aug[c][k] /= pivot;

    // 4. elimina a coluna c das outras linhas
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const factor = aug[r][c];
      if (factor === 0) continue;
      for (let k = 0; k < 2 * n; k++) aug[r][k] -= factor * aug[c][k];
    }
  }

  return aug.map((row) => row.slice(n));
}
