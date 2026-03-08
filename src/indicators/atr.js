// Copie directe depuis arbitrage_bot_5m — aucun changement nécessaire

export function computeAtr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;

  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    if (h === null || l === null || pc === null) continue;
    trueRanges.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  if (trueRanges.length < period) return null;

  let sum = 0;
  for (let i = trueRanges.length - period; i < trueRanges.length; i++) {
    sum += trueRanges[i];
  }
  return sum / period;
}

export function atrRatio(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period * 3) return null;

  const atrValues = [];
  for (let end = period + 1; end <= candles.length; end++) {
    const v = computeAtr(candles.slice(0, end), period);
    if (v !== null) atrValues.push(v);
  }

  if (atrValues.length < 2) return null;

  const sorted = [...atrValues].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median === 0) return null;

  return atrValues[atrValues.length - 1] / median;
}

// Convertit ATR (en price) en pips pour EUR_USD
export function atrInPips(candles, period = 14) {
  const atr = computeAtr(candles, period);
  if (atr === null) return null;
  return Math.round(atr * 100_000) / 10; // 0.0001 = 1 pip
}
