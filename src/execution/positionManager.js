import { oandaRest } from '../data/oandaRest.js';
import { config } from '../config.js';
import { logTrade } from '../logger.js';

const PIP = 0.0001;

export class PositionManager {
  constructor() {
    this._reset();
    this.lastPnlPips = null;
  }

  _reset() {
    this.inPosition   = false;
    this.direction    = null;
    this.entryPrice   = null;
    this.tradeId      = null;
    this.entryTime    = null;
    this.stopLossPips = null;
    this.takeProfitPips = null;
    this.arm          = null;
    this.armIndex     = null;
    this.spreadEntry  = null;
    this.regime       = null;
    this.signal       = null;
  }

  enter({ direction, fillPrice, tradeId, stopLossPips, takeProfitPips,
          arm, armIndex, spreadEntry, regime, signal }) {
    this.inPosition     = true;
    this.direction      = direction;
    this.entryPrice     = fillPrice;
    this.tradeId        = tradeId;
    this.entryTime      = Date.now();
    this.stopLossPips   = stopLossPips;
    this.takeProfitPips = takeProfitPips;
    this.arm            = arm;
    this.armIndex       = armIndex;
    this.spreadEntry    = spreadEntry;
    this.regime         = regime;
    this.signal         = signal;
    this.lastPnlPips    = null;
    console.log(`[POS] Entré ${direction} @ ${fillPrice} | SL=${stopLossPips}p TP=${takeProfitPips}p | arm=${arm}`);
  }

  async _logAndExit(exitPrice, exitReason) {
    const holdSec = Math.round((Date.now() - this.entryTime) / 1000);

    let pnlPips = null;
    let pnlUsd  = null;

    if (exitPrice && this.entryPrice) {
      const raw = (exitPrice - this.entryPrice) / PIP;
      pnlPips = this.direction === 'LONG' ? raw : -raw;
      pnlUsd  = pnlPips * PIP * config.trading.units;
    }

    this.lastPnlPips = pnlPips;

    const record = logTrade({
      direction:   this.direction,
      arm:         this.arm,
      armIndex:    this.armIndex,
      entryPrice:  this.entryPrice,
      exitPrice,
      pnlPips,
      pnlUsd,
      exitReason,
      holdSec,
      spreadEntry: this.spreadEntry,
      regime:      this.regime,
      signal:      this.signal,
    });

    console.log(
      `[POS] Sorti ${exitReason} | PnL=${pnlPips !== null ? (pnlPips > 0 ? '+' : '') + pnlPips.toFixed(1) + 'p' : 'n/a'}` +
      ` ($${pnlUsd !== null ? pnlUsd.toFixed(2) : 'n/a'}) | ${holdSec}s`
    );

    this._reset();
    return record;
  }

  // Sync broker toutes les 30s — détecte SL/TP
  async syncWithBroker() {
    if (!this.inPosition) return null;
    try {
      const res   = await oandaRest.getOpenPositions();
      const open  = (res.positions ?? []).find((p) => p.instrument === config.trading.instrument);

      if (!open) {
        // Récupérer le prix de clôture depuis l'historique
        let exitPrice = null;
        let exitReason = 'UNKNOWN';
        try {
          const detail = await oandaRest.getClosedTrade(this.tradeId);
          const trade  = detail.trade;
          exitPrice  = parseFloat(trade?.averageClosePrice ?? trade?.price ?? 0) || null;
          // Détecter la raison (SL ou TP)
          if (trade?.stopLossOrder?.state === 'FILLED') exitReason = 'SL';
          else if (trade?.takeProfitOrder?.state === 'FILLED') exitReason = 'TP';
        } catch {}

        const record = await this._logAndExit(exitPrice, exitReason);
        return record;
      }
    } catch (err) {
      console.error('[POS] Sync error:', err.message);
    }
    return null;
  }

  // Fermeture d'urgence (weekend, SIGINT)
  async forceClose() {
    if (!this.inPosition) return null;
    console.warn('[POS] Fermeture forcée...');
    try {
      await oandaRest.closePosition();
    } catch (err) {
      console.error('[POS] Force close error:', err.message);
    }
    return this._logAndExit(null, 'FORCE');
  }

  get holdingMs() {
    return this.entryTime ? Date.now() - this.entryTime : 0;
  }
}
