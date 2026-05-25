/**
 * Lightweight ARIMA(p, d, q) implementation in pure TypeScript.
 *
 * Defaults to ARIMA(1, 1, 1) which is the workhorse model for retail
 * demand forecasting on short series — exactly the JOAP Hardware use
 * case (a few months of daily SKU outflow).
 *
 * Parameters estimated by:
 *   - AR coefficient (phi)   → lag-1 autocorrelation of the differenced series (Yule-Walker order 1)
 *   - MA coefficient (theta) → lag-1 autocorrelation of the residuals
 *
 * This is not a publication-grade implementation (no MLE, no AIC search),
 * but it produces sensible 7-30 day forecasts on noisy retail series and
 * is fully auditable for the project documentation in Chapter 3.
 */

export interface ArimaConfig {
  p?: number; // AR order — currently supported: 0, 1
  d?: number; // differencing degree — supported: 0, 1, 2
  q?: number; // MA order — currently supported: 0, 1
  horizon: number; // number of future steps to forecast
}

export interface ArimaResult {
  /** The fitted parameters chosen for the model */
  params: { p: number; d: number; q: number; phi: number; theta: number; intercept: number };
  /** Forecasted values for `horizon` future steps (in the original scale, not differenced) */
  forecast: number[];
  /** 95% lower bound for each forecast point */
  lower95: number[];
  /** 95% upper bound for each forecast point */
  upper95: number[];
  /** Residual standard deviation — proxy for prediction error */
  sigma: number;
  /** Confidence: how many observations the model was fit on */
  observations: number;
}

/**
 * Run d-th differencing on a series. d=0 returns the series unchanged.
 * d=1 returns x[t] - x[t-1] for t in 1..n.
 * d=2 differences twice.
 */
function difference(series: number[], d: number): number[] {
  let out = series.slice();
  for (let i = 0; i < d; i++) {
    const next: number[] = [];
    for (let t = 1; t < out.length; t++) next.push(out[t] - out[t - 1]);
    out = next;
  }
  return out;
}

/** Inverse of `difference` — reconstruct the original series from the
 *  differenced forecast and the last `d` actual values. */
function undifference(forecastDiff: number[], lastValues: number[]): number[] {
  // lastValues = original series tail; for d=1 we need just the last value.
  // For d=2 we need the last two values (and we integrate twice).
  const out: number[] = [];
  let cum = lastValues[lastValues.length - 1];
  for (const d of forecastDiff) {
    cum += d;
    out.push(cum);
  }
  return out;
}

/** Sample mean of an array (returns 0 for empty). */
function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Lag-k autocorrelation of a series. */
function autocorr(xs: number[], k: number): number {
  if (xs.length <= k + 1) return 0;
  const m = mean(xs);
  let num = 0;
  let den = 0;
  for (let t = 0; t < xs.length; t++) {
    den += (xs[t] - m) ** 2;
  }
  for (let t = k; t < xs.length; t++) {
    num += (xs[t] - m) * (xs[t - k] - m);
  }
  return den === 0 ? 0 : num / den;
}

/** Compute residuals from an AR(1) fit. */
function arResiduals(xs: number[], phi: number, intercept: number): number[] {
  const res: number[] = [];
  for (let t = 1; t < xs.length; t++) {
    res.push(xs[t] - intercept - phi * xs[t - 1]);
  }
  return res;
}

/** Sample standard deviation. */
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

/**
 * Fit ARIMA(p, d, q) and forecast `horizon` steps ahead.
 *
 * For very short series (<= 4 obs after differencing), falls back to
 * a constant forecast at the last observed value with high uncertainty.
 */
export function arima(series: number[], cfg: ArimaConfig): ArimaResult {
  const p = cfg.p ?? 1;
  const d = cfg.d ?? 1;
  const q = cfg.q ?? 1;
  const horizon = Math.max(1, Math.floor(cfg.horizon || 7));

  const observations = series.length;
  // Guard rails
  if (observations === 0) {
    return {
      params: { p, d, q, phi: 0, theta: 0, intercept: 0 },
      forecast: Array(horizon).fill(0),
      lower95: Array(horizon).fill(0),
      upper95: Array(horizon).fill(0),
      sigma: 0,
      observations,
    };
  }

  const differenced = difference(series, d);
  if (differenced.length < 3) {
    // Not enough data — fall back to mean of original series
    const m = mean(series);
    const sd = stddev(series);
    return {
      params: { p, d, q, phi: 0, theta: 0, intercept: m },
      forecast: Array(horizon).fill(m),
      lower95: Array(horizon).fill(m - 1.96 * sd),
      upper95: Array(horizon).fill(m + 1.96 * sd),
      sigma: sd,
      observations,
    };
  }

  // AR(1) parameter — lag-1 autocorrelation of differenced series
  const phi = p >= 1 ? Math.max(-0.99, Math.min(0.99, autocorr(differenced, 1))) : 0;
  // Intercept — sample mean of differenced series scaled by (1 - phi)
  const meanDiff = mean(differenced);
  const intercept = meanDiff * (1 - phi);
  // Residuals from AR(1) fit
  const residuals = arResiduals(differenced, phi, intercept);
  // MA(1) parameter — lag-1 autocorrelation of residuals
  const theta = q >= 1 ? Math.max(-0.99, Math.min(0.99, autocorr(residuals, 1))) : 0;

  const sigma = stddev(residuals);

  // Walk forward `horizon` steps in differenced space
  const forecastDiff: number[] = [];
  let prev = differenced[differenced.length - 1];
  let prevResidual = residuals.length > 0 ? residuals[residuals.length - 1] : 0;
  for (let h = 0; h < horizon; h++) {
    const nextDiff = intercept + phi * prev + theta * prevResidual;
    forecastDiff.push(nextDiff);
    prev = nextDiff;
    prevResidual = 0; // future residuals have expected value 0
  }

  // Undifference d times to get back to original scale
  let forecast: number[];
  if (d === 0) {
    forecast = forecastDiff;
  } else {
    // Repeatedly integrate
    let cur = forecastDiff;
    let tail = series.slice();
    for (let i = 0; i < d; i++) {
      cur = undifference(cur, tail);
      tail = difference(tail, 1).concat(cur);
    }
    forecast = cur;
  }

  // 95% prediction intervals — sigma grows as sqrt(h) for ARIMA, scaled by 1.96
  const lower95 = forecast.map((v, h) => v - 1.96 * sigma * Math.sqrt(h + 1));
  const upper95 = forecast.map((v, h) => v + 1.96 * sigma * Math.sqrt(h + 1));

  return {
    params: { p, d, q, phi, theta, intercept },
    forecast,
    lower95,
    upper95,
    sigma,
    observations,
  };
}

/**
 * Helper to aggregate raw timestamped events into a daily count series.
 * `events` should be sorted ascending by date. Days with no events get 0.
 * Returns an array of length = (endDate - startDate) + 1.
 */
export function bucketByDay(events: Array<{ date: Date; qty: number }>, startDate: Date, endDate: Date): number[] {
  const days: number[] = [];
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
  const MS = 24 * 60 * 60 * 1000;
  const nDays = Math.floor((end - start) / MS) + 1;
  for (let i = 0; i < nDays; i++) days.push(0);
  for (const ev of events) {
    const key = new Date(ev.date.getFullYear(), ev.date.getMonth(), ev.date.getDate()).getTime();
    const idx = Math.floor((key - start) / MS);
    if (idx >= 0 && idx < nDays) days[idx] += ev.qty;
  }
  return days;
}
