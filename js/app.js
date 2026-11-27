/* UI wiring for the allocation tester. Depends on MCDefaults, MCEngine and Chart.js. */
(function () {
  'use strict';
  const { DEFAULTS, PRESETS } = window.MCDefaults;
  const E = window.MCEngine;
  const STORE_KEY = 'pmc-state-v1', COMPARE_KEY = 'pmc-compare-v1';
  const $ = id => document.getElementById(id);
  const clone = o => JSON.parse(JSON.stringify(o));
  const pct = (v, d = 1) => (Number.isFinite(v) ? (v * 100).toFixed(d) + '%' : 'n/a');
  const yrs = m => (Number.isFinite(m) ? (m / 12).toFixed(1) + ' yrs' : 'n/a');

  // ---------------- state ----------------
  function defaultState() {
    return {
      assets: clone(DEFAULTS.assets),
      weights: PRESETS['Diversified with privates'].slice(),   // percentages
      corr: clone(DEFAULTS.corr),
      cpi: clone(DEFAULTS.cpi),
      objectiveSpread: DEFAULTS.objectiveSpread,
      distribution: DEFAULTS.distribution, df: DEFAULTS.df, tailMonths: DEFAULTS.tailMonths,
      rebalance: DEFAULTS.rebalance, horizons: DEFAULTS.horizons.slice(),
      paths: DEFAULTS.paths, seed: DEFAULTS.seed,
      payoutOn: false, payoutRate: 0.025,   // annual distribution, share of current value
      ddBasis: 'nominal', fanBasis: 'real',
    };
  }
  function load(key, fallback) {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage unavailable */ } }

  let state = Object.assign(defaultState(), load(STORE_KEY, {}));
  if (!Array.isArray(state.assets) || state.assets.length !== DEFAULTS.assets.length) state = defaultState();
  let compare = load(COMPARE_KEY, []);
  let lastRun = null; // { res, summary, cfg }
  const charts = {};

  function engineConfig() {
    return {
      assets: state.assets.map(a => ({ ...a })),
      weights: state.weights.map(w => w / 100),
      corr: state.corr,
      cpi: { ...state.cpi },
      objectiveSpread: state.objectiveSpread,
      distribution: state.distribution, df: state.df, tailMonths: state.tailMonths,
      rebalance: state.rebalance,
      payoutRate: state.payoutOn ? state.payoutRate : 0,
      horizons: state.horizons.slice().sort((a, b) => a - b),
      paths: state.paths, seed: state.seed,
    };
  }

  // ---------------- inputs: assets ----------------
  function numInput(value, onChange, { step = 0.1, min, max, dp = 1 } = {}) {
    const el = document.createElement('input');
    el.type = 'number'; el.step = step;
    if (min !== undefined) el.min = min;
    if (max !== undefined) el.max = max;
    el.value = round(value, dp);
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      const ok = Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max);
      el.classList.toggle('invalid', !ok);
      if (ok) { onChange(v); persist(); }
    });
    return el;
  }
  function round(v, dp) { return Number.isFinite(v) ? +v.toFixed(dp) : ''; }

  function renderAssets() {
    const tb = $('assetTable').querySelector('tbody');
    tb.innerHTML = '';
    state.assets.forEach((a, i) => {
      const tr = document.createElement('tr');
      const th = document.createElement('td'); th.textContent = a.name; tr.appendChild(th);
      const cells = [
        numInput(state.weights[i], v => { state.weights[i] = v; updateTotals(); }, { step: 1, min: 0, max: 100, dp: 2 }),
        numInput(a.ret * 100, v => { a.ret = v / 100; updateTotals(); }, { step: 0.1, min: -50, max: 50, dp: 2 }),
        numInput(a.vol * 100, v => { a.vol = v / 100; updateTotals(); }, { step: 0.5, min: 0, max: 150, dp: 2 }),
      ];
      cells.forEach(c => { const td = document.createElement('td'); td.appendChild(c); tr.appendChild(td); });
      tr.children[1].firstChild.setAttribute('aria-label', a.name + ' weight');
      tr.children[2].firstChild.setAttribute('aria-label', a.name + ' return');
      tr.children[3].firstChild.setAttribute('aria-label', a.name + ' volatility');
      tb.appendChild(tr);
    });
    updateTotals();
  }
  function updateTotals() {
    const tot = state.weights.reduce((a, b) => a + b, 0);
    $('wTotal').textContent = tot.toFixed(1) + '%';
    $('wTotal').classList.toggle('bad', Math.abs(tot - 100) > 1e-6);
    if (Math.abs(tot - 100) < 1e-6 && E.cholesky(state.corr)) {
      const an = E.analytic(engineConfig());
      $('analytic').textContent = `Approx. ${pct(an.compound)} compound return, ${pct(an.vol)} volatility`;
    } else $('analytic').textContent = Math.abs(tot - 100) > 1e-6 ? 'Weights must add up to 100%' : '';
  }

  // ---------------- inputs: correlation ----------------
  const corrLabels = ['Public equity', 'PE buyout', 'PE growth', 'PE venture', 'Distressed', 'Real estate', 'TIPS', 'Nominal bonds', 'Cash', 'CPI'];
  function renderCorr() {
    const t = $('corrTable'); t.innerHTML = '';
    const n = state.corr.length;
    const head = document.createElement('tr');
    head.appendChild(document.createElement('th'));
    corrLabels.forEach(l => { const th = document.createElement('th'); th.textContent = l; head.appendChild(th); });
    t.appendChild(head);
    for (let i = 0; i < n; i++) {
      const tr = document.createElement('tr');
      const th = document.createElement('th'); th.textContent = corrLabels[i]; th.style.textAlign = 'left'; tr.appendChild(th);
      for (let j = 0; j < n; j++) {
        const td = document.createElement('td');
        const el = numInput(state.corr[i][j], v => {
          state.corr[i][j] = state.corr[j][i] = v;
          const mirror = t.querySelector(`input[data-i="${j}"][data-j="${i}"]`);
          if (mirror && mirror !== el) mirror.value = round(v, 3);
          updateCorrStatus(); updateTotals();
        }, { step: 0.05, min: -1, max: 1, dp: 3 });
        el.dataset.i = i; el.dataset.j = j;
        el.setAttribute('aria-label', `Correlation ${corrLabels[i]} with ${corrLabels[j]}`);
        if (i === j) el.disabled = true;
        td.appendChild(el); tr.appendChild(td);
      }
      t.appendChild(tr);
    }
    updateCorrStatus();
  }
  function updateCorrStatus() {
    const ok = !!E.cholesky(state.corr);
    const p = $('corrStatus');
    p.textContent = ok ? 'Valid' : 'Not consistent: use Fix matrix';
    p.className = 'pill ' + (ok ? 'ok' : 'bad');
    if (!ok) $('corrCard').open = true;
  }

  // ---------------- inputs: other ----------------
  function bindField(id, get, set, { pctUnit = false, dp = 2 } = {}) {
    const el = $(id);
    el.value = pctUnit ? round(get() * 100, dp) : get();
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) { el.classList.add('invalid'); return; }
      el.classList.remove('invalid');
      set(pctUnit ? v / 100 : v); persist(); afterSettingChange();
    });
  }
  function afterSettingChange() {
    $('hdrSpread').textContent = (state.objectiveSpread * 100).toFixed(1);
    document.querySelectorAll('.fat-only').forEach(el => el.classList.toggle('hide', state.distribution !== 'fat'));
    document.querySelectorAll('.payout-only').forEach(el => el.classList.toggle('hide', !state.payoutOn));
  }
  function renderSettings() {
    bindField('cpiMean', () => state.cpi.mean, v => (state.cpi.mean = v), { pctUnit: true });
    bindField('cpiVol', () => state.cpi.vol, v => (state.cpi.vol = v), { pctUnit: true });
    bindField('cpiPers', () => state.cpi.persistence, v => (state.cpi.persistence = v));
    bindField('cpiStart', () => state.cpi.start, v => (state.cpi.start = v), { pctUnit: true });
    bindField('spread', () => state.objectiveSpread, v => (state.objectiveSpread = v), { pctUnit: true });
    bindField('df', () => state.df, v => (state.df = v));
    bindField('tailMonths', () => state.tailMonths, v => (state.tailMonths = Math.round(v)));
    bindField('payoutRate', () => state.payoutRate, v => (state.payoutRate = v), { pctUnit: true });
    $('payoutOn').checked = !!state.payoutOn;
    $('payoutOn').addEventListener('change', e => { state.payoutOn = e.target.checked; persist(); afterSettingChange(); });
    bindField('paths', () => state.paths, v => (state.paths = Math.round(v)));
    bindField('seed', () => state.seed, v => (state.seed = Math.round(v)));
    document.querySelectorAll('input[name="dist"]').forEach(r => {
      r.checked = r.value === state.distribution;
      r.addEventListener('change', () => { if (r.checked) { state.distribution = r.value; persist(); afterSettingChange(); } });
    });
    const rb = $('rebalance'); rb.value = state.rebalance;
    rb.addEventListener('change', () => { state.rebalance = rb.value; persist(); });
    const hz = $('horizons'); hz.value = state.horizons.join(', ');
    hz.addEventListener('input', () => {
      const parts = hz.value.split(/[,\s]+/).filter(Boolean).map(Number);
      const ok = parts.length > 0 && parts.length <= 6 && parts.every(h => Number.isInteger(h) && h >= 1 && h <= 50);
      hz.classList.toggle('invalid', !ok);
      if (ok) { state.horizons = [...new Set(parts)].sort((a, b) => a - b); persist(); }
    });
    $('ddBasis').value = state.ddBasis;
    $('ddBasis').addEventListener('change', e => { state.ddBasis = e.target.value; persist(); if (lastRun) { lastRun.summary = E.summarise(lastRun.res, state.ddBasis); renderResults(); } });
    $('fanBasis').value = state.fanBasis;
    $('fanBasis').addEventListener('change', e => { state.fanBasis = e.target.value; persist(); if (lastRun) drawFan(); });
    afterSettingChange();
  }

  function renderPresets() {
    const sel = $('preset');
    Object.keys(PRESETS).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = k; sel.appendChild(o); });
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      state.weights = PRESETS[sel.value].slice(); persist(); renderAssets(); sel.value = '';
    });
  }

  function persist() { save(STORE_KEY, state); }

  // ---------------- run ----------------
  function run() {
    const cfg = engineConfig();
    const errs = E.validate(cfg);
    const box = $('errors');
    if (errs.length) {
      box.hidden = false; box.innerHTML = errs.map(e => `<p>${escapeHtml(e)}</p>`).join('');
      $('status').textContent = 'Fix the inputs above to run.';
      return;
    }
    box.hidden = true;
    $('runBtn').disabled = true;
    $('status').textContent = `Running ${cfg.paths.toLocaleString()} scenarios…`;
    setTimeout(() => {
      const t0 = performance.now();
      try {
        const res = E.simulate(cfg);
        lastRun = { res, cfg, summary: E.summarise(res, state.ddBasis) };
        renderResults();
        $('status').textContent = `Done: ${cfg.paths.toLocaleString()} scenarios in ${((performance.now() - t0) / 1000).toFixed(1)}s.`;
      } catch (e) {
        box.hidden = false; box.innerHTML = `<p>${escapeHtml(e.message)}</p>`;
        $('status').textContent = '';
      } finally { $('runBtn').disabled = false; }
    }, 30);
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------------- results ----------------
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function alpha(hex, a) {
    const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function baseOptions() {
    const text = css('--text-2'), grid = css('--grid');
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: text, boxWidth: 12, boxHeight: 12 } }, tooltip: { padding: 8 } },
      scales: {
        x: { ticks: { color: text }, grid: { color: grid, drawTicks: false }, border: { color: grid } },
        y: { ticks: { color: text }, grid: { color: grid, drawTicks: false }, border: { display: false } },
      },
    };
  }
  function makeChart(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($(id), config);
  }

  function renderResults() {
    const s = lastRun.summary, cfg = lastRun.cfg;
    document.querySelectorAll('.spreadTxt').forEach(el => (el.textContent = (cfg.objectiveSpread * 100).toFixed(1)));
    // tiles: probability of beating objective per horizon
    $('tiles').innerHTML = s.map(h => `
      <div class="tile"><div class="k">Beats CPI + ${(cfg.objectiveSpread * 100).toFixed(1)}% over ${h.years} yrs</div>
      <div class="v">${pct(h.probBeat, 0)}</div>
      <div class="s">Median ${pct(h.nominal.p50)} nominal, ${pct(h.real.p50)} real p.a.${cfg.payoutRate ? ` after ${pct(cfg.payoutRate)} distributions` : ''}</div></div>`).join('');
    // summary table
    const rows = [
      ['Probability of beating objective', h => pct(h.probBeat, 0)],
      ['Annualised nominal return: median', h => pct(h.nominal.p50)],
      ['Annualised nominal return: 5th to 95th pct', h => `${pct(h.nominal.p5)} to ${pct(h.nominal.p95)}`],
      ['Annualised real return: median', h => pct(h.real.p50)],
      ['Annualised real return: 5th to 95th pct', h => `${pct(h.real.p5)} to ${pct(h.real.p95)}`],
      ['Return vs objective: median', h => pct(h.excess.p50)],
      ['Probability of a real loss', h => pct(h.probRealLoss, 0)],
      ['Median annual CPI', h => pct(h.cpi.p50)],
      ...(cfg.payoutRate ? [
        ['Total distributions paid: median (nominal, start = 1)', h => h.paid.nominalP50.toFixed(2)],
        ['Total distributions paid: median (real, start = 1)', h => h.paid.realP50.toFixed(2)],
      ] : []),
      ['Max drawdown: median', h => pct(-h.mdd.p50, 0)],
      ['Max drawdown: 1-in-20 worst', h => pct(-h.mdd.p95, 0)],
      ['Time to recover: median', h => yrs(h.recovery.p50Months)],
      ['Time to recover: 1-in-20 longest', h => yrs(h.recovery.p95Months)],
      ['Not recovered by end of horizon', h => pct(h.recovery.probNotRecovered, 0)],
    ];
    $('summaryTable').innerHTML =
      `<thead><tr><th></th>${s.map(h => `<th>${h.years} years</th>`).join('')}</tr></thead><tbody>` +
      rows.map(([label, f]) => `<tr><th>${label}</th>${s.map(h => `<td>${f(h)}</td>`).join('')}</tr>`).join('') + '</tbody>';
    // horizon picker for histograms
    const hs = $('histHorizon'), prev = +hs.value;
    hs.innerHTML = s.map(h => `<option value="${h.years}">${h.years} years</option>`).join('');
    hs.value = s.some(h => h.years === prev) ? prev : s[s.length - 1].years;
    drawFan(); drawBeat(); drawHists(); renderCompare();
  }

  function drawFan() {
    const res = lastRun.res, basis = state.fanBasis;
    const f = E.fan(res, basis);
    const c1 = css('--series-1'), c2 = css('--series-2');
    const pts = arr => Array.from(arr, (y, t) => ({ x: t / 12, y }));
    const spread = lastRun.cfg.objectiveSpread;
    // objective path: in real terms (1+s)^t; in nominal terms, CPI is uncertain so use median CPI path
    let obj;
    if (basis === 'real') obj = Array.from({ length: res.T + 1 }, (_, t) => ({ x: t / 12, y: Math.pow(1 + spread, t / 12) }));
    else {
      const cpiMed = new Float64Array(res.T + 1), N = res.N, T1 = res.T + 1, col = new Float64Array(N);
      for (let t = 0; t < T1; t++) { for (let p = 0; p < N; p++) col[p] = res.nominal[p * T1 + t] / res.real[p * T1 + t]; col.sort(); cpiMed[t] = E.quantile(col, 0.5); }
      obj = Array.from(cpiMed, (c, t) => ({ x: t / 12, y: c * Math.pow(1 + spread, t / 12) }));
    }
    const opt = baseOptions();
    opt.scales.x.type = 'linear'; opt.scales.x.min = 0; opt.scales.x.max = res.maxYears;
    opt.scales.x.title = { display: true, text: 'Years', color: css('--text-2') };
    opt.scales.x.ticks.stepSize = res.maxYears > 20 ? 5 : 1;
    opt.scales.y.title = { display: true, text: basis === 'real' ? 'Real value (start = 1)' : 'Nominal value (start = 1)', color: css('--text-2') };
    opt.scales.y.ticks.callback = v => v.toFixed(1);
    opt.plugins.tooltip.callbacks = {
      title: items => `Year ${items[0].parsed.x.toFixed(1)}`,
      label: item => `${({ _p5: '5th percentile', '5th to 95th percentile': '95th percentile', _p25: '25th percentile', '25th to 75th percentile': '75th percentile' })[item.dataset.label] || item.dataset.label}: ${item.parsed.y.toFixed(2)}`,
    };
    opt.plugins.legend.labels.filter = item => !item.text.startsWith('_');
    opt.elements = { point: { radius: 0, hitRadius: 6 }, line: { borderWidth: 2 } };
    makeChart('fanChart', {
      type: 'line',
      data: {
        datasets: [
          { label: '_p5', data: pts(f.bands[0]), borderColor: alpha(c1, 0.35), borderWidth: 1, fill: false },
          { label: '5th to 95th percentile', data: pts(f.bands[4]), borderColor: alpha(c1, 0.35), borderWidth: 1, backgroundColor: alpha(c1, 0.12), fill: '-1' },
          { label: '_p25', data: pts(f.bands[1]), borderColor: alpha(c1, 0.5), borderWidth: 1, fill: false },
          { label: '25th to 75th percentile', data: pts(f.bands[3]), borderColor: alpha(c1, 0.5), borderWidth: 1, backgroundColor: alpha(c1, 0.22), fill: '-1' },
          { label: 'Median', data: pts(f.bands[2]), borderColor: c1, borderWidth: 2.5, fill: false },
          { label: `Objective (CPI + ${(spread * 100).toFixed(1)}%)`, data: obj, borderColor: c2, borderDash: [6, 4], borderWidth: 2, fill: false },
        ],
      },
      options: opt,
    });
  }

  function drawBeat() {
    const res = lastRun.res, years = res.maxYears;
    const labels = Array.from({ length: years }, (_, i) => i + 1);
    const palette = [1, 2, 3, 4, 5, 6, 7, 8].map(i => css('--series-' + i));
    const datasets = [{ label: 'Current run', data: labels.map(y => res.beatByYear[y] * 100), borderColor: palette[0], backgroundColor: palette[0], borderWidth: 2.5, pointRadius: 3 }];
    compare.slice(0, 7).forEach((c, k) => {
      datasets.push({ label: c.name, data: labels.map(y => (c.beatByYear[y] !== undefined ? c.beatByYear[y] * 100 : null)), borderColor: palette[k + 1], backgroundColor: palette[k + 1], borderWidth: 2, pointRadius: 2 });
    });
    const opt = baseOptions();
    opt.scales.y.min = 0; opt.scales.y.max = 100;
    opt.scales.y.ticks.callback = v => v + '%';
    opt.scales.x.title = { display: true, text: 'Years', color: css('--text-2') };
    opt.plugins.tooltip.callbacks = { title: i => `Year ${i[0].label}`, label: i => `${i.dataset.label}: ${i.parsed.y == null ? 'n/a' : i.parsed.y.toFixed(0) + '%'}` };
    opt.plugins.legend.display = datasets.length > 1;
    makeChart('beatChart', { type: 'line', data: { labels, datasets }, options: opt });
  }

  function histChart(id, labels, counts, colors, xTitle, tipLabel) {
    const N = lastRun.res.N;
    const opt = baseOptions();
    opt.interaction = { mode: 'index', intersect: false };
    opt.plugins.legend.display = false;
    opt.scales.y.ticks.callback = v => v + '%';
    opt.scales.x.title = { display: true, text: xTitle, color: css('--text-2') };
    opt.scales.x.grid.display = false;
    opt.plugins.tooltip.callbacks = { title: i => tipLabel(i[0].dataIndex), label: i => `${i.parsed.y.toFixed(1)}% of scenarios` };
    makeChart(id, {
      type: 'bar',
      data: { labels, datasets: [{ data: counts.map(c => (c / N) * 100), backgroundColor: colors, borderRadius: 3, borderSkipped: 'bottom', categoryPercentage: 0.92, barPercentage: 0.92 }] },
      options: opt,
    });
  }

  function drawHists() {
    const years = +$('histHorizon').value;
    const hz = lastRun.res.horizons.find(h => h.years === years);
    if (!hz) return;
    const c1 = css('--series-1'), neg = css('--neg'), c7 = css('--text-2');
    // excess return vs objective, 1% bins from -10% to +10%
    const ex = []; for (let e = -10; e <= 10; e++) ex.push(e / 100);
    const exCounts = E.histogram(hz.annExcess, ex);
    const exLabels = exCounts.map((_, i) => (i === 0 ? '≤' : i === exCounts.length - 1 ? '≥' : '') + ((ex[i] + ex[i + 1]) / 2 * 100).toFixed(1));
    histChart('excessChart', exLabels, exCounts, exCounts.map((_, i) => (ex[i] < 0 ? neg : c1)),
      'Annualised return minus objective (%)', i => `${(ex[i] * 100).toFixed(0)}% to ${(ex[i + 1] * 100).toFixed(0)}% a year${i === 0 ? ' or below' : i === exCounts.length - 1 ? ' or above' : ''}`);
    // max drawdown, 5% bins
    const mdd = state.ddBasis === 'real' ? hz.mddReal : hz.mddNominal;
    const md = []; for (let e = 0; e <= 60; e += 5) md.push(e / 100);
    const mdCounts = E.histogram(mdd, md);
    histChart('mddChart', mdCounts.map((_, i) => `${Math.round(md[i] * 100)}–${Math.round(md[i + 1] * 100)}${i === mdCounts.length - 1 ? '+' : ''}`), mdCounts, mdCounts.map(() => c1),
      `Max drawdown (%, ${state.ddBasis})`, i => `Drawdown ${Math.round(md[i] * 100)}% to ${Math.round(md[i + 1] * 100)}%${i === mdCounts.length - 1 ? ' or more' : ''}`);
    // recovery time in years plus "not recovered"
    const rec = state.ddBasis === 'real' ? hz.recReal : hz.recNominal;
    const nb = Math.min(years, 10), width = years / nb;
    const counts = new Array(nb + 1).fill(0);
    for (const m of rec) {
      if (m < 0) counts[nb]++;
      else counts[Math.min(nb - 1, Math.floor(m / 12 / width))]++;
    }
    const labels = Array.from({ length: nb }, (_, i) => `${+(i * width).toFixed(1)}–${+((i + 1) * width).toFixed(1)}`).concat(['Not yet']);
    histChart('recChart', labels, counts, counts.map((_, i) => (i === nb ? c7 : c1)),
      'Years from trough back to previous peak', i => (i === nb ? `Not recovered within ${years} years` : `${labels[i]} years`));
  }

  // ---------------- comparison ----------------
  function weightsLabel(w) {
    const short = ['Eq', 'BO', 'Gr', 'VC', 'Dist', 'RE', 'TIPS', 'Bonds', 'Cash'];
    return w.map((x, i) => (x > 0 ? `${short[i]} ${+x.toFixed(1)}` : null)).filter(Boolean).join(', ');
  }
  function saveRun() {
    if (!lastRun) return;
    const name = $('saveName').value.trim() || `Run ${compare.length + 1}`;
    const cfg = lastRun.cfg;
    compare.push({
      name,
      weights: cfg.weights.map(w => w * 100),
      settings: `${cfg.distribution === 'fat' ? `Fat tails (df ${cfg.df})` : 'Lognormal'}, ${cfg.rebalance === 'none' ? 'no rebalancing' : cfg.rebalance + ' rebalancing'}${cfg.payoutRate ? `, ${pct(cfg.payoutRate)} annual distribution` : ''}`,
      spread: cfg.objectiveSpread,
      basis: state.ddBasis,
      summary: lastRun.summary,
      beatByYear: Array.from(lastRun.res.beatByYear),
    });
    if (compare.length > 12) compare.shift();
    save(COMPARE_KEY, compare);
    $('saveName').value = '';
    renderCompare(); drawBeat();
  }
  function renderCompare() {
    const t = $('compareTable');
    if (!compare.length) { t.innerHTML = ''; $('compareHint').hidden = false; return; }
    $('compareHint').hidden = true;
    const horizons = [...new Set(compare.flatMap(c => c.summary.map(h => h.years)))].sort((a, b) => a - b);
    const palette = [2, 3, 4, 5, 6, 7, 8].map(i => css('--series-' + i));
    const metric = (c, y, f) => { const h = c.summary.find(s => s.years === y); return h ? f(h) : ''; };
    t.innerHTML = `<thead><tr><th>Run</th>${horizons.map(y => `<th>Beats obj. ${y}y</th><th>Real ret. ${y}y</th><th>Max DD ${y}y</th><th>Not recov. ${y}y</th>`).join('')}<th></th></tr></thead><tbody>` +
      compare.map((c, k) => `<tr><td>${k < 7 ? `<span class="swatch" style="background:${palette[k]}"></span>` : ''}<strong>${escapeHtml(c.name)}</strong><span class="muted" style="font-size:12px">${escapeHtml(weightsLabel(c.weights))}<br>${escapeHtml(c.settings)}, CPI + ${(c.spread * 100).toFixed(1)}%, ${c.basis} drawdowns</span></td>` +
        horizons.map(y => `<td>${metric(c, y, h => pct(h.probBeat, 0))}</td><td>${metric(c, y, h => pct(h.real.p50))}</td><td>${metric(c, y, h => pct(-h.mdd.p50, 0))}</td><td>${metric(c, y, h => pct(h.recovery.probNotRecovered, 0))}</td>`).join('') +
        `<td><button class="link-btn" data-load="${k}">Load</button><button class="link-btn" data-del="${k}">Remove</button></td></tr>`).join('') + '</tbody>';
    t.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { compare.splice(+b.dataset.del, 1); save(COMPARE_KEY, compare); renderCompare(); if (lastRun) drawBeat(); }));
    t.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => { state.weights = compare[+b.dataset.load].weights.slice(); persist(); renderAssets(); }));
  }

  // ---------------- settings file ----------------
  function exportSettings() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'portfolio-montecarlo-settings.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importSettings(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const s = JSON.parse(r.result);
        if (!Array.isArray(s.assets) || s.assets.length !== DEFAULTS.assets.length || !Array.isArray(s.corr)) throw new Error('bad');
        state = Object.assign(defaultState(), s); persist(); rerenderInputs(); run();
      } catch (e) { $('status').textContent = 'That file is not a valid settings file.'; }
    };
    r.readAsText(file);
  }
  function rerenderInputs() {
    // rebuild input bindings by replacing nodes (simplest way to drop old listeners)
    ['cpiMean', 'cpiVol', 'cpiPers', 'cpiStart', 'spread', 'df', 'tailMonths', 'payoutOn', 'payoutRate', 'paths', 'seed', 'rebalance', 'horizons', 'ddBasis', 'fanBasis'].forEach(id => {
      const el = $(id), c = el.cloneNode(true); el.replaceWith(c);
    });
    document.querySelectorAll('input[name="dist"]').forEach(el => el.replaceWith(el.cloneNode(true)));
    renderAssets(); renderCorr(); renderSettings();
  }

  // ---------------- init ----------------
  function init() {
    renderPresets(); renderAssets(); renderCorr(); renderSettings(); renderCompare();
    $('runBtn').addEventListener('click', run);
    $('normaliseBtn').addEventListener('click', () => {
      const tot = state.weights.reduce((a, b) => a + b, 0); if (!(tot > 0)) return;
      state.weights = state.weights.map(w => (w / tot) * 100);
      const diff = 100 - state.weights.reduce((a, b) => a + b, 0); state.weights[state.weights.indexOf(Math.max(...state.weights))] += diff;
      persist(); renderAssets();
    });
    $('resetAssetsBtn').addEventListener('click', () => { state.assets = clone(DEFAULTS.assets); persist(); renderAssets(); });
    $('fixCorrBtn').addEventListener('click', () => {
      if (E.cholesky(state.corr)) return;
      const fixed = E.nearestCorrelation(state.corr);
      const rounded = fixed.map(r => r.map(v => +v.toFixed(3)));
      state.corr = E.cholesky(rounded) ? rounded : fixed;
      persist(); renderCorr(); updateTotals();
    });
    $('resetCorrBtn').addEventListener('click', () => { state.corr = clone(DEFAULTS.corr); persist(); renderCorr(); updateTotals(); });
    $('resetAllBtn').addEventListener('click', () => { state = defaultState(); persist(); rerenderInputs(); run(); });
    $('exportBtn').addEventListener('click', exportSettings);
    $('importFile').addEventListener('change', e => { if (e.target.files[0]) importSettings(e.target.files[0]); e.target.value = ''; });
    $('saveBtn').addEventListener('click', saveRun);
    $('clearCompareBtn').addEventListener('click', () => { compare = []; save(COMPARE_KEY, compare); renderCompare(); if (lastRun) drawBeat(); });
    $('histHorizon').addEventListener('change', () => lastRun && drawHists());
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => lastRun && renderResults());
    if (typeof Chart === 'undefined') {
      $('errors').hidden = false;
      $('errors').innerHTML = '<p>The charting library could not load. Check your internet connection and reload the page.</p>';
      return;
    }
    run();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
