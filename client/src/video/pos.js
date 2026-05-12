// POS (Plane-Orthogonal-to-Skin) algorithm from Wang et al., IEEE TBE 2017.
// Input: per-frame mean R, G, B channels for one ROI, sampled at a uniform fps.
// Output: a 1D pulse signal (Float32Array, same length as input). Downstream
// code FFTs this signal to find the heart rate.
//
// The algorithm normalises each channel by its own rolling 1.6-second mean
// (kills lighting drift), then projects onto two skin-orthogonal axes using
// the Wang 2017 projection matrix P:
//   X =  0*R_n + 1*G_n - 1*B_n  (= G_n - B_n)
//   Y = -2*R_n + 1*G_n + 1*B_n
// and combines them as S = X + alpha*Y, with alpha = std(X)/std(Y) per window.
// The per-window outputs are overlap-added into a final signal.

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

    // Project onto skin-orthogonal axes using Wang 2017 matrix P:
    //   P = [[0, 1, -1],   => X = G_n - B_n
    //        [-2, 1, 1]]   => Y = -2*R_n + G_n + B_n
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

    // alpha = std(X) / std(Y).
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
