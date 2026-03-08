import { config } from '../config.js';
import { computeAtr } from '../indicators/atr.js';
import { sma } from '../indicators/rsi.js';

/**
 * Regime engine — détermine si les conditions sont favorables au trading.
 *
 * Filtre :
 * 1. Session London/NY overlap (13h-17h UTC)
 * 2. Pas de weekend (vendredi 21h UTC → dimanche 21h UTC)
 * 3. Spread acceptable (< maxSpreadPips)
 * 4. Volatilité suffisante (ATR > seuil minimum)
 * 5. Détection range vs trend
 */
export function analyzeRegime({ candles, spreadPips, now = new Date() }) {
  const hour = now.getUTCHours();
  const day = now.getUTCDay(); // 0=dim, 5=ven, 6=sam

  // Filtre weekend
  const isWeekend =
    day === 0 ||
    day === 6 ||
    (day === 5 && hour >= 21) ||
    (day === 0 && hour < 21);

  if (isWeekend) {
    return { active: false, reason: 'weekend', regime: null };
  }

  // Filtre session
  const inSession = hour >= config.session.startHour && hour < config.session.endHour;
  if (!inSession) {
    return { active: false, reason: 'hors session', regime: null };
  }

  // Filtre spread
  if (spreadPips > config.trading.maxSpreadPips) {
    return { active: false, reason: `spread ${spreadPips.toFixed(1)}p > ${config.trading.maxSpreadPips}p`, regime: null };
  }

  // ATR minimum (besoin de données)
  if (!candles || candles.length < 15) {
    return { active: false, reason: 'données insuffisantes', regime: null };
  }

  const atr = computeAtr(candles, 14);
  if (!atr) return { active: false, reason: 'ATR indisponible', regime: null };

  const atrPips = Math.round(atr * 100_000) / 10;

  // Volatilité trop faible (< 3 pips ATR = marché mort)
  if (atrPips < 3) {
    return { active: false, reason: `volatilité trop faible (ATR ${atrPips.toFixed(1)}p)`, regime: 'flat' };
  }

  // Détection range vs trend via comparaison SMA courte/longue
  const closes = candles.map((c) => c.close);
  const sma5 = sma(closes, 5);
  const sma20 = sma(closes, 20);

  let regime = 'range';
  if (sma5 !== null && sma20 !== null) {
    const diff = Math.abs(sma5 - sma20) * 100_000; // en pips
    if (diff > atrPips * 0.5) regime = 'trend';
  }

  return {
    active: true,
    regime,
    atrPips,
    spreadPips,
    reason: null,
  };
}
