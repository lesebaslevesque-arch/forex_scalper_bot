import { config } from '../config.js';
import { computeRsi } from '../indicators/rsi.js';
import { computeMacd } from '../indicators/macd.js';
import { detectRejectionWick, findSRLevels, nearLevel } from './microstructure.js';

/**
 * Signal engine — génère des signaux d'entrée LONG/SHORT.
 *
 * Conditions requises pour un signal :
 * 1. CVD aligné avec la direction (pression directionnelle)
 * 2. RSI pas en zone extrême contraire (pas d'achat en surachat)
 * 3. MACD histogramme dans le bon sens
 * 4. Wick de rejet à un niveau S/R
 * 5. Prix sous/sur VWAP (confirmation directionnelle)
 */
export function generateSignal({ cvd, candles, vwap, spreadPips, minScore = null }) {
  if (!cvd || !candles || candles.length < 30) return null;

  const closes = candles.map((c) => c.close);
  const lastCandle = candles[candles.length - 1];
  const price = lastCandle.close;

  const rsi = computeRsi(closes, config.indicators.rsiPeriod);
  const macd = computeMacd(closes, 12, 26, 9);
  const { rejection } = detectRejectionWick(lastCandle);
  const { support, resistance } = findSRLevels(candles, 20);

  // Score de signal : accumulation de confirmations
  let longScore = 0;
  let shortScore = 0;

  // CVD (poids fort)
  if (cvd.normalized > 0.15) longScore += 2;
  if (cvd.normalized < -0.15) shortScore += 2;

  // RSI
  if (rsi !== null) {
    if (rsi < 45) longScore += 1;       // oversold zone
    if (rsi > 55) shortScore += 1;      // overbought zone
    if (rsi < 30) longScore += 1;       // fort oversold
    if (rsi > 70) shortScore += 1;      // fort overbought
  }

  // MACD histogramme
  if (macd) {
    if (macd.hist > 0 && (macd.histDelta ?? 0) > 0) longScore += 1;
    if (macd.hist < 0 && (macd.histDelta ?? 0) < 0) shortScore += 1;
  }

  // Wick de rejet à un niveau S/R
  if (rejection === 'BULLISH' && nearLevel(price, support)) longScore += 2;
  if (rejection === 'BEARISH' && nearLevel(price, resistance)) shortScore += 2;

  // VWAP (filtre directionnel)
  if (vwap !== null) {
    if (price < vwap) longScore += 1;   // prix sous VWAP → acheteurs
    if (price > vwap) shortScore += 1;  // prix sur VWAP → vendeurs
  }

  const minScore_ = minScore ?? Math.round(config.indicators.minSignalStrength * 7);

  if (longScore >= minScore_ && longScore > shortScore) {
    return {
      direction: 'LONG',
      score: longScore,
      confidence: longScore / 7,
      details: { rsi, macd: macd?.hist, cvd: cvd.normalized, rejection, vwap },
    };
  }

  if (shortScore >= minScore_ && shortScore > longScore) {
    return {
      direction: 'SHORT',
      score: shortScore,
      confidence: shortScore / 7,
      details: { rsi, macd: macd?.hist, cvd: cvd.normalized, rejection, vwap },
    };
  }

  return null;
}
