function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

export function computeMacd(closes, fast = 12, slow = 26, signal = 9) {
  if (!Array.isArray(closes) || closes.length < slow + signal) return null;

  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  if (fastEma === null || slowEma === null) return null;

  const macdLine = fastEma - slowEma;

  const macdSeries = [];
  for (let i = 0; i < closes.length; i++) {
    const f = ema(closes.slice(0, i + 1), fast);
    const s = ema(closes.slice(0, i + 1), slow);
    if (f !== null && s !== null) macdSeries.push(f - s);
  }

  const signalLine = ema(macdSeries, signal);
  if (signalLine === null) return null;

  const hist = macdLine - signalLine;
  const prevSignal = ema(macdSeries.slice(0, -1), signal);
  const prevHist = prevSignal !== null ? macdSeries[macdSeries.length - 2] - prevSignal : null;

  return {
    macd: macdLine,
    signal: signalLine,
    hist,
    histDelta: prevHist !== null ? hist - prevHist : null,
  };
}
