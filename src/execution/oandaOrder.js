import { oandaRest } from '../data/oandaRest.js';
import { config } from '../config.js';

/**
 * Passe un ordre market avec SL/TP.
 * arm override optionnel (Thompson Sampling).
 */
export async function placeOrder(direction, arm = null) {
  const instrument    = config.trading.instrument;
  const units         = config.trading.units;
  const stopLossPips  = arm?.stopLossPips  ?? config.trading.stopLossPips;
  const takeProfitPips = arm?.takeProfitPips ?? config.trading.takeProfitPips;

  console.log(`[ORDER] ${direction} ${units} ${instrument} | SL=${stopLossPips}p TP=${takeProfitPips}p`);

  try {
    const res = await oandaRest.placeMarketOrder({
      instrument,
      units,
      stopLossPips,
      takeProfitPips,
      direction,
    });

    const fill = res.orderFillTransaction;
    if (!fill) {
      console.warn('[ORDER] Rejeté:', JSON.stringify(res));
      return null;
    }

    const tradeId   = fill.tradeOpened?.tradeID;
    const fillPrice = parseFloat(fill.price);
    console.log(`[ORDER] Fill @ ${fillPrice} | tradeId=${tradeId}`);
    return { tradeId, fillPrice, stopLossPips, takeProfitPips };
  } catch (err) {
    console.error('[ORDER] Erreur:', err.message);
    return null;
  }
}
