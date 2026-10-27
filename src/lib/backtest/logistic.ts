/**
 * L2-regularised logistic regression without an intercept, fitted by Newton's method.
 *
 * No intercept on purpose: "EUR/USD up" is "USD/EUR down", so flipping a pair flips every
 * feature and the label. A model that respects that symmetry must give 50% when every
 * technique is neutral, instead of learning whatever drift the pair mix happened to have.
 */
export function fitLogistic(X: number[][], y: number[], lambda: number, iters = 12): number[] {
  const d = X[0]?.length ?? 0;
  let w = new Array(d).fill(0);
  for (let it = 0; it < iters; it++) {
    const grad = w.map((wj) => lambda * wj);
    const H = Array.from({ length: d }, (_, r) => Array.from({ length: d }, (_, c) => (r === c ? lambda : 0)));
    for (let n = 0; n < X.length; n++) {
      const x = X[n];
      const p = sigmoid(dot(w, x));
      const g = p - y[n];
      const s = p * (1 - p);
      for (let r = 0; r < d; r++) {
        if (x[r] === 0) continue;
        grad[r] += g * x[r];
        const sxr = s * x[r];
        for (let c = r; c < d; c++) if (x[c] !== 0) H[r][c] += sxr * x[c];
      }
    }
    for (let r = 0; r < d; r++) for (let c = 0; c < r; c++) H[r][c] = H[c][r];
    const step = solve(H, grad);
    if (!step) break;
    w = w.map((wj, j) => wj - step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-6) break;
  }
  return w;
}

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
export const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

/** Solve A·x = b with Gaussian elimination and partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}
