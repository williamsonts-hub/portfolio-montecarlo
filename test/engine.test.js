// Run with: node test/engine.test.js
'use strict';
const assert = require('assert');
const E = require('../js/engine.js');
const { DEFAULTS, PRESETS } = require('../js/defaults.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(4)}, expected ${b.toFixed(4)} ± ${tol}`); }

function cfg(over = {}) {
  return {
    assets: DEFAULTS.assets.map(a => ({ ...a })),
    corr: DEFAULTS.corr.map(r => r.slice()),
    cpi: { ...DEFAULTS.cpi },
    objectiveSpread: DEFAULTS.objectiveSpread,
    distribution: 'lognormal', df: 5, rebalance: 'annual',
    horizons: [5, 10, 20], paths: 4000, seed: 7,
    weights: PRESETS['Diversified with privates'].map(x => x / 100),
    ...over,
  };
}
function single(i) { const w = new Array(9).fill(0); w[i] = 1; return w; }

// Annual simple returns of path p, year y, from the stored nominal series.
function annualReturns(res) {
  const out = [], T1 = res.T + 1;
  for (let p = 0; p < res.N; p++) for (let y = 1; y <= res.maxYears; y++)
    out.push(res.nominal[p * T1 + y * 12] / res.nominal[p * T1 + (y - 1) * 12] - 1);
  return out;
}
const sd = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const median = a => E.quantile(Float64Array.from(a).sort(), 0.5);

test('default correlation matrix is valid', () => {
  assert.ok(E.cholesky(DEFAULTS.corr), 'Cholesky failed');
  assert.ok(E.minEigenvalue(DEFAULTS.corr) > 0.05);
});

test('presets add up to 100%', () => {
  for (const [k, w] of Object.entries(PRESETS)) assert.strictEqual(w.reduce((a, b) => a + b, 0), 100, k);
});

test('logVol reproduces simple-return volatility', () => {
  for (const [g, s] of [[0.07, 0.16], [0.11, 0.35], [0.033, 0.01]]) {
    const v = E.logVol(g, s), mu = Math.log(1 + g);
    near(Math.sqrt((Math.exp(v * v) - 1) * Math.exp(2 * mu + v * v)), s, 1e-6, 'sd');
  }
});

for (const dist of ['lognormal', 'fat']) {
  test(`${dist}: single-asset median growth and volatility match inputs`, () => {
    for (const i of [0, 3, 7]) {
      const c = cfg({ weights: single(i), distribution: dist, horizons: [20] });
      const res = E.simulate(c), a = c.assets[i];
      const s = E.summarise(res)[0];
      near(s.nominal.p50, a.ret, 0.004 + a.vol * 0.03, `${a.name} median 20y compound return`);
      if (dist === 'lognormal') near(sd(annualReturns(res)), a.vol, a.vol * 0.05, `${a.name} annual vol`);
      else near(sd(annualReturns(res).map(r => Math.log(1 + r))), E.logVol(a.ret, a.vol), a.vol * 0.05, `${a.name} annual log vol`);
    }
  });
}

test('simulated correlations match the matrix', () => {
  // Equal-weight run but read asset returns via single-asset runs with the same seed.
  const r0 = annualReturns(E.simulate(cfg({ weights: single(0), horizons: [20], paths: 3000 })));
  const r7 = annualReturns(E.simulate(cfg({ weights: single(7), horizons: [20], paths: 3000 })));
  const r1 = annualReturns(E.simulate(cfg({ weights: single(1), horizons: [20], paths: 3000 })));
  const corr = (x, y) => {
    const mx = x.reduce((a, b) => a + b) / x.length, my = y.reduce((a, b) => a + b) / y.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
  };
  near(corr(r0, r1), 0.80, 0.03, 'equity vs buyout');
  near(corr(r0, r7), 0.05, 0.03, 'equity vs bonds');
});

test('CPI has the entered annual mean, volatility and persistence', () => {
  const c = cfg({ weights: single(8), horizons: [20], paths: 3000 });
  const p = E.cpiMonthlyParams(c.cpi);
  // simulate CPI directly with the same params
  const rng = E.makeRng(3), ann = [];
  let pi = p.start; const series = [];
  for (let t = 0; t < 12 * 20000; t++) { pi = p.mean + p.phi * (pi - p.mean) + p.shockSd * rng.normal(); series.push(pi); }
  for (let y = 0; y < 20000; y++) { let s = 0; for (let m = 0; m < 12; m++) s += series[y * 12 + m]; ann.push(s); }
  const m = ann.reduce((a, b) => a + b) / ann.length;
  near(Math.exp(m) - 1, 0.025, 0.002, 'CPI mean');
  near(sd(ann), 0.015, 0.001, 'CPI vol');
  let num = 0, den = 0;
  for (let i = 1; i < ann.length; i++) num += (ann[i] - m) * (ann[i - 1] - m);
  for (let i = 0; i < ann.length; i++) den += (ann[i] - m) ** 2;
  near(num / den, 0.6, 0.03, 'CPI persistence');
});

test('100% cash: tiny drawdowns, real return close to cash minus CPI, rarely beats CPI+4%', () => {
  const s = E.summarise(E.simulate(cfg({ weights: single(8) })));
  for (const h of s) {
    assert.ok(h.mdd.p95 < 0.03, `nominal drawdown ${h.mdd.p95}`);
    assert.ok(h.probBeat < 0.01, `prob beat ${h.probBeat}`);
  }
  near(s[2].real.p50, 1.033 / 1.025 - 1, 0.004, '20y real median');
});

test('fat tails produce deeper extreme drawdowns than lognormal', () => {
  const w = PRESETS['60/40 equity / bonds'].map(x => x / 100);
  const n = E.summarise(E.simulate(cfg({ weights: w, distribution: 'lognormal' })));
  const f = E.summarise(E.simulate(cfg({ weights: w, distribution: 'fat', df: 4 })));
  // compare 1-in-100 worst monthly portfolio returns
  assert.ok(f[2].mdd.p95 > n[2].mdd.p95 * 0.98, `fat ${f[2].mdd.p95} vs normal ${n[2].mdd.p95}`);
  const worstMonth = res => {
    const T1 = res.T + 1, out = [];
    for (let p = 0; p < res.N; p++) for (let t = 1; t < T1; t++) out.push(res.nominal[p * T1 + t] / res.nominal[p * T1 + t - 1] - 1);
    return E.quantile(Float64Array.from(out).sort(), 0.0005);
  };
  const resN = E.simulate(cfg({ weights: w, paths: 1500 })), resF = E.simulate(cfg({ weights: w, paths: 1500, distribution: 'fat', df: 4 }));
  assert.ok(worstMonth(resF) < worstMonth(resN) - 0.01, `worst month fat ${worstMonth(resF)} vs normal ${worstMonth(resN)}`);
});

test('fat tails: annual returns have excess kurtosis; lognormal does not', () => {
  const kurt = a => { const m = a.reduce((x, y) => x + y) / a.length; let m2 = 0, m4 = 0; for (const v of a) { m2 += (v - m) ** 2; m4 += (v - m) ** 4; } m2 /= a.length; m4 /= a.length; return m4 / (m2 * m2) - 3; };
  const logs = res => annualReturns(res).map(r => Math.log(1 + r));
  const kn = kurt(logs(E.simulate(cfg({ weights: single(0), horizons: [20] }))));
  const kf = kurt(logs(E.simulate(cfg({ weights: single(0), horizons: [20], distribution: 'fat', df: 5 }))));
  near(kn, 0, 0.15, 'lognormal excess kurtosis');
  assert.ok(kf > 1.5, `fat-tailed excess kurtosis ${kf.toFixed(2)}`);
});

test('rebalancing changes results; buy-and-hold drifts toward equity', () => {
  const w = PRESETS['60/40 equity / bonds'].map(x => x / 100);
  const a = E.summarise(E.simulate(cfg({ weights: w, rebalance: 'annual' })));
  const b = E.summarise(E.simulate(cfg({ weights: w, rebalance: 'none' })));
  assert.notStrictEqual(a[2].nominal.p50, b[2].nominal.p50);
  assert.ok(b[2].nominal.p95 > a[2].nominal.p95, 'buy-and-hold should have a wider upside tail');
});

test('drawdown tracker: depth and recovery time', () => {
  const d = E._dd.newDD(); E._dd.resetDD(d);
  const path = [1.1, 1.0, 0.88, 0.99, 1.1, 1.2, 0.6, 0.7];
  path.forEach((v, i) => E._dd.stepDD(d, v, i + 1));
  near(d.maxDD, 0.5, 1e-12, 'max drawdown');
  assert.strictEqual(d.maxRec, -1, 'not recovered');
  const d2 = E._dd.newDD(); E._dd.resetDD(d2);
  [1.1, 1.0, 0.88, 0.99, 1.1, 1.2].forEach((v, i) => E._dd.stepDD(d2, v, i + 1));
  near(d2.maxDD, 0.2, 1e-12, 'max drawdown 2');
  assert.strictEqual(d2.maxRec, 2, 'recovered 2 months after trough');
});

test('invalid inputs are rejected with clear messages', () => {
  const bad = cfg({ weights: [0.5, 0, 0, 0, 0, 0, 0, 0, 0] });
  assert.ok(E.validate(bad)[0].includes('50.0%'));
  const c = cfg(); c.corr[0][7] = c.corr[7][0] = -0.95; c.corr[0][6] = c.corr[6][0] = 0.9;
  assert.ok(E.validate(c).some(e => e.includes('positive definite')));
  const fixed = E.nearestCorrelation(c.corr);
  assert.ok(E.cholesky(fixed), 'nearestCorrelation should be valid');
  assert.ok(fixed.every((r, i) => Math.abs(r[i] - 1) < 1e-12));
});

test('same seed gives identical results', () => {
  const a = E.summarise(E.simulate(cfg({ paths: 500 })));
  const b = E.summarise(E.simulate(cfg({ paths: 500 })));
  assert.deepStrictEqual(a, b);
});

test('performance: 10,000 paths x 20 years', () => {
  const t0 = Date.now();
  E.simulate(cfg({ paths: 10000, distribution: 'fat' }));
  const ms = Date.now() - t0;
  console.log(`     (${ms} ms)`);
  assert.ok(ms < 8000);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
