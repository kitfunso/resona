// POS (Plane-Orthogonal-to-Skin) rPPG algorithm, Wang et al. IEEE TBE 2017.
// Normalises R/G/B by a 1.6s rolling mean, projects onto skin-orthogonal axes,
// combines as X+alpha*Y (alpha=std(X)/std(Y)); derivation in docs/ARCHITECTURE.md.

export function computePosSignal({ r, g, b, fps = 30, windowSec = 1.6 }) {
  if (!(r && g && b) || r.length !== g.length || g.length !== b.length) {
    throw new Error('computePosSignal: r, g, b must be equal-length Float32Arrays');
  }
  const n = r.length;
  const w = Math.max(16, Math.round(fps * windowSec));
  const out = new Float32Array(n);

  // Stride windows by w/2 so adjacent windows overlap; sum into `out`.
  const stride = Math.max(1, Math.floor(w / 2));

  // Reusable scratch buffers.
  const rN = new Float32Array(w);
  const gN = new Float32Array(w);
  const bN = new Float32Array(w);

  for (let start = 0; start + w <= n; start += stride) {
    // Per-window channel means.
    let rMean = 0, gMean = 0, bMean = 0;
    for (let i = 0; i < w; i++) {
      rMean += r[start + i];
      gMean += g[start + i];
      bMean += b[start + i];
    }
    rMean /= w; gMean /= w; bMean /= w;
    if (rMean < 1e-6) rMean = 1e-6;
    if (gMean < 1e-6) gMean = 1e-6;
    if (bMean < 1e-6) bMean = 1e-6;

    // Normalise each channel by its own mean (multiplicative drift removal).
    for (let i = 0; i < w; i++) {
      rN[i] = r[start + i] / rMean;
      gN[i] = g[start + i] / gMean;
      bN[i] = b[start + i] / bMean;
    }

    let xSum = 0, ySum = 0;
    const x = new Float32Array(w);
    const y = new Float32Array(w);
    for (let i = 0; i < w; i++) {
      x[i] = gN[i] - bN[i];
      y[i] = -2 * rN[i] + gN[i] + bN[i];
      xSum += x[i];
      ySum += y[i];
    }
    const xMean = xSum / w;
    const yMean = ySum / w;

    let xVar = 0, yVar = 0;
    for (let i = 0; i < w; i++) {
      const dx = x[i] - xMean;
      const dy = y[i] - yMean;
      xVar += dx * dx;
      yVar += dy * dy;
    }
    const xStd = Math.sqrt(xVar / w);
    const yStd = Math.sqrt(yVar / w) || 1e-9;
    const alpha = xStd / yStd;

    // Window combine + overlap-add.
    for (let i = 0; i < w; i++) {
      const s = (x[i] - xMean) + alpha * (y[i] - yMean);
      out[start + i] += s;
    }
  }

  return out;
}
