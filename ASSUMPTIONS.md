# Starting assumptions: Monte Carlo allocation tester

Agreed 26 Nov 2026. Every number below will be editable in the tool. These are the defaults it loads with.

The figures are long-term (10 to 20 year) forward-looking estimates. They are broadly in line with the published capital market assumptions of large asset managers and consultants. They are my judgement, not quotes from any one source, and they are in US dollars.

## 1. Asset classes

| Asset class | Expected return (nominal, compound p.a.) | Volatility (p.a.) | Notes |
|---|---|---|---|
| Public equity (global) | 7.0% | 16% | MSCI ACWI-style |
| Private equity: buyout | 9.0% | 22% | Net of fees. De-smoothed volatility |
| Private equity: growth | 10.0% | 26% | Net of fees. De-smoothed |
| Private equity: venture | 11.0% | 35% | Net of fees. De-smoothed, with very wide dispersion |
| Distressed credit | 8.0% | 15% | Net of fees |
| Real estate (private) | 6.5% | 14% | Core-plus. De-smoothed (reported appraisal-based vol is about 7%) |
| US TIPS | 4.3% | 6% | About 1.8% real yield plus inflation |
| US nominal bonds | 4.6% | 6% | Aggregate-style, intermediate duration |
| Cash | 3.3% | 1% | T-bills |

**Why "de-smoothed"?** Private assets are valued by appraisal, so their reported returns look much smoother than their true economic risk. Using reported volatilities would make private-heavy portfolios look unrealistically safe. That would flatter both drawdowns and recovery times.

## 2. US CPI inflation

| Parameter | Default | Meaning |
|---|---|---|
| Long-run mean | 2.5% p.a. | The average inflation the simulation reverts to |
| Volatility | 1.5% p.a. | The size of year-to-year inflation surprises |
| Persistence | 0.6 (annual) | Share of this year's deviation from the mean that carries into next year. 0 means no memory; close to 1 means inflation regimes last a long time |
| Distribution | Normal or fat-tailed | Uses the same tail setting as the assets |

Inflation is modelled as a mean-reverting process, so a high-inflation year tends to be followed by further above-average years. The objective is then CPI + 4% p.a., about 6.5% nominal at the default mean.

## 3. Correlations

The matrix covers asset returns and the inflation surprise. I've checked that it is internally consistent (positive definite).

| | PubEq | Buyout | Growth | Venture | Distressed | RE | TIPS | Bonds | Cash | CPI |
|---|---|---|---|---|---|---|---|---|---|---|
| **Public equity** | 1.00 | 0.80 | 0.75 | 0.65 | 0.65 | 0.55 | 0.15 | 0.05 | 0.00 | -0.10 |
| **PE buyout** | 0.80 | 1.00 | 0.85 | 0.70 | 0.65 | 0.55 | 0.10 | 0.00 | 0.00 | -0.05 |
| **PE growth** | 0.75 | 0.85 | 1.00 | 0.80 | 0.55 | 0.45 | 0.05 | -0.05 | 0.00 | -0.10 |
| **PE venture** | 0.65 | 0.70 | 0.80 | 1.00 | 0.45 | 0.35 | 0.00 | -0.10 | 0.00 | -0.10 |
| **Distressed credit** | 0.65 | 0.65 | 0.55 | 0.45 | 1.00 | 0.50 | 0.25 | 0.15 | 0.00 | 0.00 |
| **Real estate** | 0.55 | 0.55 | 0.45 | 0.35 | 0.50 | 1.00 | 0.20 | 0.10 | 0.05 | 0.20 |
| **US TIPS** | 0.15 | 0.10 | 0.05 | 0.00 | 0.25 | 0.20 | 1.00 | 0.75 | 0.10 | 0.30 |
| **US nominal bonds** | 0.05 | 0.00 | -0.05 | -0.10 | 0.15 | 0.10 | 0.75 | 1.00 | 0.15 | -0.20 |
| **Cash** | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.05 | 0.10 | 0.15 | 1.00 | 0.20 |
| **CPI surprise** | -0.10 | -0.05 | -0.10 | -0.10 | 0.00 | 0.20 | 0.30 | -0.20 | 0.20 | 1.00 |

The key relationships are:
- the private equity strategies move closely with public equity and with each other;
- TIPS and real estate partly hedge inflation surprises;
- nominal bonds are hurt by them.

## 4. Modelling choices

- **Time step:** monthly, simulated over 20 years. Results are read off at 5, 10 and 20 years, and the horizons will be editable.
- **Paths:** 10,000 by default, adjustable.
- **Return distribution:** you can choose either option.
  - *Lognormal:* correlated normal draws of monthly log returns, so prices are lognormal.
  - *Fat tails:* a multivariate Student-t with 5 degrees of freedom by default (adjustable), with the same log volatility as the lognormal case. The tail scaling is shared by all assets and held for 12 months by default (adjustable as "tail event length"). This makes *annual* returns fat-tailed, with crisis years that hit all assets at once. A one-month setting gives fat-tailed months that mostly average out over a year. The scaling is capped at 4 times normal volatility, so no single draw gives an absurd value.
- **Return convention:** the "expected return" inputs are compound (geometric) returns, so a 7% asset grows at about 7% p.a. in the median path.
- **Rebalancing:** choose between rebalancing to target weights (monthly, quarterly or annually) and buy-and-hold drift.
- **Outputs:**
  - a fan chart of real and nominal wealth;
  - the probability of beating CPI + 4% at each horizon;
  - the distribution of annualised returns;
  - the distribution of maximum drawdowns;
  - time to recover from the worst drawdown, including how often it never recovers within the horizon;
  - a side-by-side comparison of saved allocations.

## 5. A quick sense check with these defaults

| Portfolio | Approx. compound return | Volatility | Versus CPI + 4% (about 6.5%) |
|---|---|---|---|
| 60% public equity / 40% bonds | ~6.4% | ~10% | Roughly at target, so about a coin flip |
| Diversified with 20% PE, 10% RE, 5% distressed | ~7.4% | ~11.5% | About 0.9% p.a. above target |

The diversified mix is 35% public equity, 10% buyout, 5% growth, 5% venture, 5% distressed, 10% real estate, 10% TIPS, 15% bonds and 5% cash.

## 6. Not modelled in this version

- Fees beyond the net-of-fee private returns.
- Private-equity capital calls, distributions and illiquidity.
- Withdrawals or spending.
- Taxes.
- Currency.

I can add withdrawals later if the portfolio funds spending.
