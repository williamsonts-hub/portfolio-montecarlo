/* Monte Carlo engine for the allocation tester.
 * Pure functions, no DOM. Works in the browser (window.MCEngine) and in Node
 * (require('./engine.js')) so it can be tested from the command line.
 *
 * Model (monthly steps):
 *  - Asset log returns: mean ln(1+g)/12, sd v/sqrt(12), where g is the compound
 *    annual return and v is the annual log-vol that reproduces the annual
 *    simple-return volatility the user entered.
 *  - Shocks are correlated through a Cholesky factor of the 10x10 matrix
 *    (9 assets + CPI surprise). Either Gaussian ("lognormal" prices) or
 *    multivariate Student-t ("fat tails"), rescaled to unit variance so the
 *    volatility is unchanged; the t draws share one scaling factor per month,
 *    so bad periods hit every asset together. The scaling factor is held for
 *    `tailMonths` months (default 12): with 12, *annual* returns are
 *    Student-t, and crisis years have persistently high volatility. With 1,
 *    only single months are fat-tailed and the effect mostly averages out.
 *    Fat tails keep the same *log* volatility as the lognormal case, so the
 *    median and typical spread are unchanged; simple-return volatility comes
 *    out a little higher because the extremes are larger.
 *  - CPI: monthly log inflation follows a mean-reverting AR(1). The monthly
 *    coefficient and shock size are solved so that *annual* inflation has the
 *    entered mean, volatility and year-on-year persistence.
 *  - Rebalancing back to target weights monthly, quarterly, annually or never.
 *  - Optional annual distribution (`payoutRate`, e.g. 0.025): at each year end
 *    that share of the portfolio's current value is paid out, pro rata across
 *    holdings. Every value-based result (returns, objective, drawdowns, fan
 *    chart) is then measured on the value left after distributions; the
 *    amount paid out is tracked separately.
 */
(function (root) {
  'use strict';

  // ---------- random numbers (seeded, reproducible) ----------
  function makeRng(seed) {
    // splitmix32 to initialise xoshiro128**
    let s = seed >>> 0;
    function sm() {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    }
    let a = sm(), b = sm(), c = sm(), d = sm();
    function next() {
      const r = Math.imul(rotl(Math.imul(b, 5) >>> 0, 7), 9) >>> 0;
      const t = (b << 9) >>> 0;
      c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = rotl(d, 11);
      return r;
    }
    function rotl(x, k) { return ((x << k) | (x >>> (32 - k))) >>> 0; }
    function uniform() { return (next() + 0.5) / 4294967296; } // (0,1)
    let spare = null;
    function normal() {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let u, v, q;
      do { u = 2 * uniform() - 1; v = 2 * uniform() - 1; q = u * u + v * v; } while (q >= 1 || q === 0);
      const f = Math.sqrt(-2 * Math.log(q) / q);
      spare = v * f;
      return u * f;
    }
    // Marsaglia-Tsang gamma(shape, 1)
    function gamma(shape) {
      if (shape < 1) return gamma(shape + 1) * Math.pow(uniform(), 1 / shape);
      const d3 = shape - 1 / 3, c3 = 1 / Math.sqrt(9 * d3);
      for (;;) {
        let x, v;
        do { x = normal(); v = 1 + c3 * x; } while (v <= 0);
        v = v * v * v;
        const u = uniform();
        if (u < 1 - 0.0331 * x * x * x * x) return d3 * v;
        if (Math.log(u) < 0.5 * x * x + d3 * (1 - v + Math.log(v))) return d3 * v;
      }
    }
    function chi2(df) { return 2 * gamma(df / 2); }
    return { uniform, normal, chi2 };
  }

  // ---------- linear algebra ----------
  function cholesky(A) {
    const n = A.length, L = A.map(() => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = A[i][j];
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) {
          if (s <= 1e-10) return null; // not positive definite
          L[i][i] = Math.sqrt(s);
        } else L[i][j] = s / L[j][j];
      }
    }
    return L;
  }

  // Jacobi eigen-decomposition of a symmetric matrix.
  function eigSym(A) {
    const n = A.length, a = A.map(r => r.slice());
    const V = a.map((r, i) => r.map((_, j) => (i === j ? 1 : 0)));
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
      if (off < 1e-20) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
        }
      }
    }
    return { values: a.map((r, i) => r[i]), vectors: V };
  }

  function minEigenvalue(C) { return Math.min(...eigSym(C).values); }

  // Nearest valid correlation matrix (alternating projections, Higham-style).
  function nearestCorrelation(C, floor = 1e-4) {
    const n = C.length;
    let X = C.map(r => r.slice()), dS = X.map(r => r.map(() => 0));
    for (let it = 0; it < 200; it++) {
      const R = X.map((r, i) => r.map((v, j) => v - dS[i][j]));
      const { values, vectors } = eigSym(R);
      const P = R.map(() => new Array(n).fill(0));
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += vectors[i][k] * Math.max(values[k], floor) * vectors[j][k];
        P[i][j] = s;
      }
      dS = P.map((r, i) => r.map((v, j) => v - R[i][j]));
      const Xn = P.map((r, i) => r.map((v, j) => (i === j ? 1 : v)));
      let diff = 0;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) diff = Math.max(diff, Math.abs(Xn[i][j] - X[i][j]));
      X = Xn;
      if (diff < 1e-9 && minEigenvalue(X) > 0) break;
    }
    // symmetrise and round to 3 dp for display, keeping it valid
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) { const v = (X[i][j] + X[j][i]) / 2; X[i][j] = X[j][i] = v; }
    return X;
  }

  // ---------- parameter conversion ----------
  // Annual log-vol v such that a lognormal with median growth (1+g) has
  // simple-return standard deviation sigma.
  function logVol(g, sigma) {
    if (sigma <= 0) return 0;
    const mu = Math.log(1 + g);
    let lo = 0, hi = 3;
    for (let i = 0; i < 100; i++) {
      const v = (lo + hi) / 2;
      const sd = Math.sqrt((Math.exp(v * v) - 1) * Math.exp(2 * mu + v * v));
      if (sd > sigma) hi = v; else lo = v;
    }
    return (lo + hi) / 2;
  }

  // Annual-sum autocorrelation and variance factor of a monthly AR(1).
  function annualStats(phi) {
    const pw = k => Math.pow(phi, Math.abs(k));
    let v = 0, c = 0;
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) v += pw(i - j);
    for (let i = 0; i < 12; i++) for (let j = 12; j < 24; j++) c += pw(j - i);
    return { varFactor: v / (1 - phi * phi), autocorr: c / v }; // var of annual sum per unit shock var
  }

  function cpiMonthlyParams(cpi) {
    const target = Math.min(Math.max(cpi.persistence, 0), 0.99);
    let lo = 0, hi = 0.9999;
    for (let i = 0; i < 80; i++) {
      const m = (lo + hi) / 2;
      if (annualStats(m).autocorr > target) hi = m; else lo = m;
    }
    const phi = target <= 0 ? 0 : (lo + hi) / 2;
    const st = annualStats(phi);
    return {
      phi,
      mean: Math.log(1 + cpi.mean) / 12,
      shockSd: cpi.vol / Math.sqrt(st.varFactor),
      start: Math.log(1 + cpi.start) / 12,
    };
  }

  const REBAL_MONTHS = { none: 0, monthly: 1, quarterly: 3, annual: 12 };

  // ---------- validation ----------
  function validate(cfg) {
    const errors = [];
    const n = cfg.assets.length;
    const wsum = cfg.weights.reduce((a, b) => a + b, 0);
    if (Math.abs(wsum - 1) > 1e-6) errors.push(`Weights add up to ${(wsum * 100).toFixed(1)}%, not 100%.`);
    if (cfg.weights.some(w => w < 0)) errors.push('Weights cannot be negative.');
    cfg.assets.forEach(a => {
      if (!(a.vol >= 0)) errors.push(`${a.name}: volatility must be zero or more.`);
      if (!(a.ret > -1)) errors.push(`${a.name}: return must be above -100%.`);
    });
    if (!(cfg.cpi.vol >= 0)) errors.push('CPI volatility must be zero or more.');
    if (!(cfg.cpi.persistence >= 0 && cfg.cpi.persistence < 1)) errors.push('CPI persistence must be between 0 and 0.99.');
    if (cfg.distribution === 'fat' && !(cfg.df > 2)) errors.push('Degrees of freedom must be above 2.');
    if (cfg.distribution === 'fat' && cfg.tailMonths !== undefined && !(cfg.tailMonths >= 1 && cfg.tailMonths <= 60)) errors.push('Tail event length must be between 1 and 60 months.');
    if (!cfg.horizons.length || cfg.horizons.some(h => !(h >= 1 && h <= 50 && Number.isInteger(h)))) errors.push('Horizons must be whole years between 1 and 50.');
    if (cfg.payoutRate !== undefined && !(cfg.payoutRate >= 0 && cfg.payoutRate <= 0.25)) errors.push('Annual distribution must be between 0% and 25%.');
    if (!(cfg.paths >= 100 && cfg.paths <= 50000)) errors.push('Number of paths must be between 100 and 50,000.');
    const C = cfg.corr;
    if (C.length !== n + 1) errors.push('Correlation matrix has the wrong size.');
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      if (Math.abs(C[i][j] - C[j][i]) > 1e-9) { errors.push('Correlation matrix must be symmetric.'); i = j = n + 1; }
      else if (Math.abs(C[i][j]) > 1 + 1e-12) { errors.push('Correlations must be between -1 and 1.'); i = j = n + 1; }
    }
    if (!errors.length && !cholesky(C)) errors.push('The correlation matrix is not internally consistent (not positive definite). Use "Fix matrix" to repair it.');
    return errors;
  }

  // ---------- simulation ----------
  function simulate(cfg) {
    const errs = validate(cfg);
    if (errs.length) throw new Error(errs.join(' '));
    const nA = cfg.assets.length, nV = nA + 1;
    const N = cfg.paths, maxYears = Math.max(...cfg.horizons), T = maxYears * 12, T1 = T + 1;
    const L = cholesky(cfg.corr);
    const rng = makeRng(cfg.seed);
    const w = cfg.weights.slice();
    const mu = cfg.assets.map(a => Math.log(1 + a.ret) / 12);
    const sd = cfg.assets.map(a => logVol(a.ret, a.vol) / Math.sqrt(12));
    const cp = cpiMonthlyParams(cfg.cpi);
    const fat = cfg.distribution === 'fat', df = cfg.df;
    const tailBlock = Math.max(1, Math.round(cfg.tailMonths || 12)); // months a tail "regime" lasts
    const rebal = REBAL_MONTHS[cfg.rebalance] || 0;
    const spread = cfg.objectiveSpread;
    const payout = cfg.payoutRate || 0, keep = 1 - payout;
    const horizonMonths = new Map(cfg.horizons.map((h, k) => [h * 12, k]));

    const nominal = new Float32Array(N * T1), real = new Float32Array(N * T1);
    const beatByYear = new Float64Array(maxYears + 1);
    const H = cfg.horizons.map(h => ({
      years: h,
      annNominal: new Float64Array(N), annReal: new Float64Array(N), annExcess: new Float64Array(N),
      annCpi: new Float64Array(N), beat: new Uint8Array(N),
      mddNominal: new Float64Array(N), mddReal: new Float64Array(N),
      recNominal: new Float64Array(N), recReal: new Float64Array(N), // months trough->recovery, -1 if not recovered
      paidNominal: new Float64Array(N), paidReal: new Float64Array(N), // cumulative distributions, start value = 1
    }));

    const eps = new Float64Array(nV), z = new Float64Array(nV), h = new Float64Array(nA);
    const ddN = newDD(), ddR = newDD();

    for (let p = 0; p < N; p++) {
      for (let i = 0; i < nA; i++) h[i] = w[i];
      let W = 1, logI = 0, pi = cp.start, paidN = 0, paidR = 0;
      const base = p * T1;
      nominal[base] = 1; real[base] = 1;
      resetDD(ddN); resetDD(ddR);
      let scale = 1;
      for (let t = 1; t <= T; t++) {
        for (let i = 0; i < nV; i++) eps[i] = rng.normal();
        // Capped at 4x normal volatility so a single draw can't produce absurd values.
        if (fat && (t - 1) % tailBlock === 0) scale = Math.min(4, Math.sqrt((df - 2) / rng.chi2(df)));
        for (let i = 0; i < nV; i++) {
          let s = 0; const Li = L[i];
          for (let k = 0; k <= i; k++) s += Li[k] * eps[k];
          z[i] = s * scale;
        }
        W = 0;
        for (let i = 0; i < nA; i++) { h[i] *= Math.exp(mu[i] + sd[i] * z[i]); W += h[i]; }
        pi = cp.mean + cp.phi * (pi - cp.mean) + cp.shockSd * z[nA];
        logI += pi;
        if (payout && t % 12 === 0) {
          const d = W * payout;
          paidN += d; paidR += d / Math.exp(logI);
          for (let i = 0; i < nA; i++) h[i] *= keep;
          W -= d;
        }
        if (rebal && t % rebal === 0) for (let i = 0; i < nA; i++) h[i] = W * w[i];
        const R = W / Math.exp(logI);
        nominal[base + t] = W; real[base + t] = R;
        stepDD(ddN, W, t); stepDD(ddR, R, t);
        if (t % 12 === 0) {
          const yrs = t / 12;
          if (R > Math.pow(1 + spread, yrs)) beatByYear[yrs] += 1;
        }
        const k = horizonMonths.get(t);
        if (k !== undefined) {
          const yrs = t / 12, hz = H[k];
          hz.annNominal[p] = Math.pow(W, 1 / yrs) - 1;
          hz.annReal[p] = Math.pow(R, 1 / yrs) - 1;
          hz.annCpi[p] = Math.exp(logI / yrs) - 1;
          hz.annExcess[p] = Math.pow(R / Math.pow(1 + spread, yrs), 1 / yrs) - 1;
          hz.beat[p] = R > Math.pow(1 + spread, yrs) ? 1 : 0;
          hz.mddNominal[p] = ddN.maxDD; hz.recNominal[p] = ddN.maxRec;
          hz.paidNominal[p] = paidN; hz.paidReal[p] = paidR;
          hz.mddReal[p] = ddR.maxDD; hz.recReal[p] = ddR.maxRec;
        }
      }
    }
    for (let y = 0; y <= maxYears; y++) beatByYear[y] /= N;
    return { N, T, maxYears, nominal, real, beatByYear, horizons: H, cfg };
  }

  // Drawdown tracker: worst peak-to-trough fall so far, and months from that
  // trough until the series regains the earlier peak (-1 while not regained;
  // 0 if there has been no drawdown at all).
  function newDD() { return {}; }
  function resetDD(d) {
    d.peak = 1; d.maxDD = 0; d.maxPeak = 1; d.maxTroughT = 0; d.maxRec = 0;
  }
  function stepDD(d, v, t) {
    if (v >= d.peak) {
      d.peak = v;
    } else {
      const dd = 1 - v / d.peak;
      if (dd > d.maxDD) { d.maxDD = dd; d.maxPeak = d.peak; d.maxTroughT = t; d.maxRec = -1; }
    }
    if (d.maxRec === -1 && v >= d.maxPeak) d.maxRec = t - d.maxTroughT;
  }

  // ---------- summaries ----------
  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function sortedCopy(arr) { return Float64Array.from(arr).sort(); }
  function mean(arr) { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i]; return s / arr.length; }

  function summarise(res, basis = 'nominal') {
    return res.horizons.map(hz => {
      const nom = sortedCopy(hz.annNominal), rl = sortedCopy(hz.annReal), ex = sortedCopy(hz.annExcess);
      const mdd = sortedCopy(basis === 'real' ? hz.mddReal : hz.mddNominal);
      const rec = basis === 'real' ? hz.recReal : hz.recNominal;
      const recovered = [], N = rec.length; let notRec = 0;
      for (let i = 0; i < N; i++) { if (rec[i] < 0) notRec++; else if (rec[i] > 0) recovered.push(rec[i]); }
      recovered.sort((a, b) => a - b);
      return {
        years: hz.years,
        probBeat: mean(hz.beat),
        probRealLoss: rl.filter(v => v < 0).length / rl.length,
        nominal: { p5: quantile(nom, 0.05), p50: quantile(nom, 0.5), p95: quantile(nom, 0.95) },
        real: { p5: quantile(rl, 0.05), p50: quantile(rl, 0.5), p95: quantile(rl, 0.95) },
        excess: { p5: quantile(ex, 0.05), p50: quantile(ex, 0.5), p95: quantile(ex, 0.95) },
        cpi: { p50: quantile(sortedCopy(hz.annCpi), 0.5) },
        paid: { nominalP50: quantile(sortedCopy(hz.paidNominal), 0.5), realP50: quantile(sortedCopy(hz.paidReal), 0.5) },
        mdd: { p50: quantile(mdd, 0.5), p95: quantile(mdd, 0.95), mean: mean(mdd) },
        recovery: {
          p50Months: quantile(recovered, 0.5), p95Months: quantile(recovered, 0.95),
          probNotRecovered: notRec / N,
        },
      };
    });
  }

  // Percentile bands of the wealth paths, one row per month.
  function fan(res, basis = 'real', qs = [0.05, 0.25, 0.5, 0.75, 0.95]) {
    const src = basis === 'real' ? res.real : res.nominal, T1 = res.T + 1, N = res.N;
    const out = qs.map(() => new Float64Array(T1)), col = new Float64Array(N);
    for (let t = 0; t < T1; t++) {
      for (let p = 0; p < N; p++) col[p] = src[p * T1 + t];
      col.sort();
      qs.forEach((q, k) => { out[k][t] = quantile(col, q); });
    }
    return { qs, bands: out };
  }

  function histogram(values, edges) {
    const counts = new Array(edges.length - 1).fill(0);
    for (const v of values) {
      if (v < edges[0]) { counts[0]++; continue; }
      if (v >= edges[edges.length - 1]) { counts[counts.length - 1]++; continue; }
      let lo = 0, hi = edges.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (v >= edges[m]) lo = m; else hi = m; }
      counts[lo]++;
    }
    return counts;
  }

  // Analytic (approximate) portfolio expected return and volatility from inputs.
  function analytic(cfg) {
    const n = cfg.assets.length, w = cfg.weights;
    const arith = cfg.assets.map(a => {
      const mu = Math.log(1 + a.ret), v = logVol(a.ret, a.vol);
      return Math.exp(mu + v * v / 2) - 1;
    });
    let m = 0, v = 0;
    for (let i = 0; i < n; i++) {
      m += w[i] * arith[i];
      for (let j = 0; j < n; j++) v += w[i] * w[j] * cfg.assets[i].vol * cfg.assets[j].vol * cfg.corr[i][j];
    }
    return { arithmetic: m, vol: Math.sqrt(v), compound: m - v / 2 };
  }

  const api = {
    makeRng, cholesky, eigSym, minEigenvalue, nearestCorrelation, logVol, cpiMonthlyParams, annualStats,
    validate, simulate, summarise, fan, histogram, quantile, analytic, _dd: { newDD, resetDD, stepDD },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MCEngine = api;
})(typeof self !== 'undefined' ? self : this);
