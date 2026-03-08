import { oandaRest } from '../data/oandaRest.js';
import { config } from '../config.js';

const PIP = 0.0001;

export class PositionManager {
  constructor() {
    this.inPosition   = false;
    this.direction    = null;
    this.entryPrice   = null;
    this.tradeId      = null;
    this.entryTime    = null;
    this.stopLossPips = null;
    this.lastPnlPips  = null; // PnL du dernier trade (pour bandit)
  }

  enter({ direction, fillPrice, tradeId, stopLossPips, takeProfitPips }) {
    this.inPosition    = true;
    this.direction     = direction;
    this.entryPrice    = fillPrice;
    this.tradeId       = tradeId;
    this.entryTime     = Date.now();
    this.stopLossPips  = stopLossPips;
    this.lastPnlPips   = null;
    console.log(`[POS] Entré ${direction} @ ${fillPrice} | SL=${stopLossPips}p TP=${takeProfitPips}p`);
  }

  exit(closePriceOrPnl = null) {
    if (closePriceOrPnl !== null) {
      // Si on reçoit un prix de clôture, calculer PnL en pips
      if (this.entryPrice) {
        const raw = (closePriceOrPnl - this.entryPrice) / PIP;
        this.lastPnlPips = this.direction === 'LONG' ? raw : -raw;
      }
    }
    const held = this.holdingMs;
    console.log(
      `[POS] Sorti | PnL=${this.lastPnlPips !== null ? this.lastPnlPips.toFixed(1) + 'p' : 'n/a'}` +
      ` | durée=${Math.round(held / 1000)}s`
    );
    this.inPosition   = false;
    this.direction    = null;
    this.entryPrice   = null;
    this.tradeId      = null;
    this.entryTime    = null;
    this.stopLossPips = null;
  }

  // Sync avec broker — appelé toutes les 30s
  async syncWithBroker() {
    if (!this.inPosition) return;
    try {
      const res       = await oandaRest.getOpenPositions();
      const positions = res.positions ?? [];
      const open      = positions.find((p) => p.instrument === config.trading.instrument);

      if (!open) {
        // Position fermée côté broker (SL ou TP touché)
        // Récupérer le PnL depuis l'historique trades
        await this._fetchLastPnl();
        console.log('[POS] Fermée par SL/TP côté broker');
        this.exit();
      }
    } catch (err) {
      console.error('[POS] Sync error:', err.message);
    }
  }

  async _fetchLastPnl() {
    try {
      const res    = await oandaRest.getRecentTrades(1);
      const trade  = res.trades?.[0];
      if (trade && trade.id === this.tradeId) {
        this.lastPnlPips = parseFloat(trade.realizedPL) /
          (config.trading.units * PIP * 1); // approximation PnL en pips
      }
    } catch {}
  }

  // Fermeture d'urgence (weekend, SIGINT)
  async forceClose() {
    if (!this.inPosition) return null;
    console.warn('[POS] Fermeture forcée...');
    try {
      const res = await oandaRest.closePosition();
      const closePrice = parseFloat(res.relatedTransactionIDs ? null : null); // OANDA retourne les IDs
      this.exit(null);
      return { win: false }; // force close = pas un win naturel
    } catch (err) {
      console.error('[POS] Force close error:', err.message);
      this.exit(null);
      return { win: false };
    }
  }

  get holdingMs() {
    return this.entryTime ? Date.now() - this.entryTime : 0;
  }
}
