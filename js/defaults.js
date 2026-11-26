/* Default capital market assumptions. See ASSUMPTIONS.md for the reasoning.
 * Returns are compound (geometric) annual nominal returns; volatilities are
 * annual standard deviations of simple returns. All values are decimals. */
(function (root) {
  const DEFAULTS = {
    assets: [
      { id: 'pubeq',  name: 'Public equity',          ret: 0.070, vol: 0.16 },
      { id: 'buyout', name: 'Private equity: buyout',  ret: 0.090, vol: 0.22 },
      { id: 'growth', name: 'Private equity: growth',  ret: 0.100, vol: 0.26 },
      { id: 'vc',     name: 'Private equity: venture', ret: 0.110, vol: 0.35 },
      { id: 'dist',   name: 'Distressed credit',       ret: 0.080, vol: 0.15 },
      { id: 're',     name: 'Real estate',             ret: 0.065, vol: 0.14 },
      { id: 'tips',   name: 'US TIPS',                 ret: 0.043, vol: 0.06 },
      { id: 'bonds',  name: 'US nominal bonds',        ret: 0.046, vol: 0.06 },
      { id: 'cash',   name: 'Cash',                    ret: 0.033, vol: 0.01 },
    ],
    // Rows/cols: the 9 assets above, then the CPI inflation surprise.
    corr: [
      [ 1.00, 0.80, 0.75, 0.65, 0.65, 0.55, 0.15, 0.05, 0.00, -0.10],
      [ 0.80, 1.00, 0.85, 0.70, 0.65, 0.55, 0.10, 0.00, 0.00, -0.05],
      [ 0.75, 0.85, 1.00, 0.80, 0.55, 0.45, 0.05,-0.05, 0.00, -0.10],
      [ 0.65, 0.70, 0.80, 1.00, 0.45, 0.35, 0.00,-0.10, 0.00, -0.10],
      [ 0.65, 0.65, 0.55, 0.45, 1.00, 0.50, 0.25, 0.15, 0.00,  0.00],
      [ 0.55, 0.55, 0.45, 0.35, 0.50, 1.00, 0.20, 0.10, 0.05,  0.20],
      [ 0.15, 0.10, 0.05, 0.00, 0.25, 0.20, 1.00, 0.75, 0.10,  0.30],
      [ 0.05, 0.00,-0.05,-0.10, 0.15, 0.10, 0.75, 1.00, 0.15, -0.20],
      [ 0.00, 0.00, 0.00, 0.00, 0.00, 0.05, 0.10, 0.15, 1.00,  0.20],
      [-0.10,-0.05,-0.10,-0.10, 0.00, 0.20, 0.30,-0.20, 0.20,  1.00],
    ],
    cpi: { mean: 0.025, vol: 0.015, persistence: 0.6, start: 0.025 },
    objectiveSpread: 0.04,          // objective = CPI + this, per year
    distribution: 'lognormal',      // 'lognormal' | 'fat'
    df: 5,                          // Student-t degrees of freedom for 'fat'
    tailMonths: 12,                 // how long a fat-tail volatility regime lasts
    rebalance: 'annual',            // 'none' | 'monthly' | 'quarterly' | 'annual'
    horizons: [5, 10, 20],          // years
    paths: 10000,
    seed: 12345,
  };

  const PRESETS = {
    '60/40 equity / bonds':       [60, 0, 0, 0, 0, 0, 0, 40, 0],
    'Diversified with privates':  [35, 10, 5, 5, 5, 10, 10, 15, 5],
    'Endowment style':            [30, 15, 10, 10, 5, 10, 5, 10, 5],
    'Conservative':               [25, 5, 0, 0, 5, 10, 20, 25, 10],
    '100% cash':                  [0, 0, 0, 0, 0, 0, 0, 0, 100],
  };

  const api = { DEFAULTS, PRESETS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MCDefaults = api;
})(typeof self !== 'undefined' ? self : this);
