function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function computeRsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += -diff;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return clamp(100 - 100 / (1 + avgGain / avgLoss), 0, 100);
}

export function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const slice = values.slice(values.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function slopeLast(values, points) {
  if (!Array.isArray(values) || values.length < points) return null;
  const slice = values.slice(values.length - points);
  return (slice[slice.length - 1] - slice[0]) / (points - 1);
}
