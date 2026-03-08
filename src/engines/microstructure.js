/**
 * Microstructure Forex — détection de wicks de rejet et awareness du spread.
 *
 * Adapté depuis arbitrage_bot_5m pour le Forex (unités en pips, pas en %).
 */

// EUR_USD : 1 pip = 0.0001 = 0.1 * 0.001
const PIP = 0.0001;

/**
 * Détecte un wick de rejet sur la dernière bougie.
 * Un wick de rejet = longue mèche dans une direction + petit corps dans l'autre.
 *
 * Retourne :
 *   { rejection: 'BULLISH' | 'BEARISH' | null, wickPips, bodyPips, wickRatio }
 */
export function detectRejectionWick(candle) {
  if (!candle) return { rejection: null };

  const { open, high, low, close } = candle;
  const body = Math.abs(close - open);
  const range = high - low;
  if (range < PIP) return { rejection: null }; // bougie plate

  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;

  const wickRatio = 0.6; // wick doit représenter 60%+ du range

  // Wick baissier (rejet des hauts) → signal BEARISH
  if (upperWick / range >= wickRatio && upperWick > lowerWick * 2) {
    return {
      rejection: 'BEARISH',
      wickPips: upperWick / PIP,
      bodyPips: body / PIP,
      wickRatio: upperWick / range,
    };
  }

  // Wick haussier (rejet des bas) → signal BULLISH
  if (lowerWick / range >= wickRatio && lowerWick > upperWick * 2) {
    return {
      rejection: 'BULLISH',
      wickPips: lowerWick / PIP,
      bodyPips: body / PIP,
      wickRatio: lowerWick / range,
    };
  }

  return { rejection: null };
}

/**
 * Identifie les niveaux S/R simples via pivots des N dernières bougies.
 */
export function findSRLevels(candles, lookback = 20) {
  if (!candles || candles.length < lookback) return { support: null, resistance: null };

  const recent = candles.slice(-lookback);
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);

  const resistance = Math.max(...highs);
  const support = Math.min(...lows);

  return { support, resistance };
}

/**
 * Vérifie si le prix est proche d'un niveau S/R (tolérance en pips).
 */
export function nearLevel(price, level, tolerancePips = 3) {
  if (level === null || level === undefined) return false;
  return Math.abs(price - level) <= tolerancePips * PIP;
}
