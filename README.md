# Portfolio Monte Carlo

This is a browser-based tool for testing starting asset allocations against an objective of **US CPI + 4% a year**. It uses Monte Carlo simulation. There is nothing to install: the page is plain HTML and JavaScript, and the simulation runs in your browser.

## What it does

- **Allocations:** set weights across nine asset classes: public equity, private equity (buyout, growth and venture), distressed credit, real estate, US TIPS, US nominal bonds and cash. Presets are included.
- **Assumptions:** edit every one of them. That covers each asset's expected return and volatility, and the full correlation matrix, which includes inflation. It also covers US CPI: mean, volatility, persistence and starting level. Finally, you can change the objective spread.
- **Return distribution:** choose **lognormal** returns or **fat tails** (multivariate Student-t, with adjustable degrees of freedom and tail event length).
- **Rebalancing:** choose none (buy and hold), monthly, quarterly or annual.
- **Results at 5, 10 and 20 years** (the horizons are editable):
  - how often the portfolio beats CPI + 4%, both at each horizon and year by year;
  - the spread of annualised nominal and real returns;
  - max drawdown, measured in nominal or real terms;
  - time to recover from the max drawdown, and how often the portfolio has not recovered by the end of the horizon;
  - a fan chart of projected real or nominal value.
- **Comparisons:** save runs and compare allocations side by side.
- **Settings files:** download your settings and load them back.

The default assumptions and the reasoning behind them are in [ASSUMPTIONS.md](ASSUMPTIONS.md).

## Using it

**Option 1: GitHub Pages.** This gives you a shareable link.
1. In this repository go to **Settings → Pages**.
2. Under "Build and deployment", choose **Deploy from a branch**. Pick `main` and `/ (root)`, then save.
3. After a minute the tool is live at `https://williamsonts-hub.github.io/portfolio-montecarlo/`.

GitHub Pages is free for public repositories. For a private repository it needs a paid GitHub plan; otherwise use option 2.

**Option 2: on your computer.** Download or clone the repository and open `index.html` in a browser. If your browser blocks local files, run `python3 -m http.server 8000` in the folder and open http://localhost:8000.

## How the model works

- **Steps and paths:** monthly steps, with 10,000 paths by default.
- **Returns:** each asset's monthly log return has mean ln(1 + expected return)/12. Its volatility is set so that annual simple returns have the volatility you entered (in the lognormal case).
- **Correlation:** shocks are linked through the Cholesky factor of the 10 × 10 matrix (nine assets plus the CPI surprise). If you edit the matrix into an inconsistent state, **Fix matrix** finds the nearest valid one.
- **Fat tails:** all shocks are multiplied by a shared Student-t scaling factor, rescaled so volatility is unchanged. The factor is held for the tail event length, 12 months by default, so bad years hit all assets together.
- **Inflation:** monthly log inflation follows a mean-reverting AR(1) process. It is calibrated so that annual CPI has the entered mean, volatility and year-on-year persistence.
- **Beating the objective:** at horizon H, this means real wealth is greater than (1 + spread)^H.
- **Max drawdown:** the worst peak-to-trough fall within the horizon, using month-end values. Time to recover is the number of months from that trough back to the previous peak.
- **Repeatable results:** the random seed is fixed, so different allocations are tested against the same scenarios, which makes comparisons fair.

**Not modelled:** fees beyond net-of-fee private returns, private equity capital calls and distributions, illiquidity, withdrawals, taxes and currency.

## Development

```
js/defaults.js   default assumptions and presets
js/engine.js     simulation engine (no DOM; runs in Node too)
js/app.js        page wiring and charts
js/vendor/       Chart.js 4.4.1 (MIT), bundled so the page works offline
test/            engine tests: run `npm test` (needs Node 18+)
```
