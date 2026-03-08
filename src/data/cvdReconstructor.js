import { config } from '../config.js';

/**
 * Reconstruit le CVD (Cumulative Volume Delta) depuis le tick stream OANDA.
 *
 * En Forex il n'y a pas de tape publique, donc on classifie chaque tick
 * par la direction du mid price (acheteur = +, vendeur = -).
 *
 * Le volume Forex n'est pas disponible directement — on utilise 1 unité par tick
 * (tick volume). En pratique, le CVD devient un "cumulative price delta" qui
 * capture la pression directionnelle.
 */
export class CvdReconstructor {
  constructor(windowMs = null) {
    this.prevMid = null;
    this.ticks = []; // { time, delta }
    this.windowMs = windowMs ?? config.indicators.cvdWindowMs;
  }

  addTick({ time, mid }) {
    if (this.prevMid === null) {
      this.prevMid = mid;
      return null;
    }

    const delta = mid > this.prevMid ? 1 : mid < this.prevMid ? -1 : 0;
    this.prevMid = mid;

    const now = new Date(time).getTime();
    this.ticks.push({ time: now, delta });

    // Garder seulement la fenêtre temporelle
    const cutoff = now - this.windowMs;
    this.ticks = this.ticks.filter((t) => t.time >= cutoff);

    return this.getCurrent();
  }

  getCurrent() {
    if (this.ticks.length === 0) return null;

    const cvd = this.ticks.reduce((sum, t) => sum + t.delta, 0);
    const total = this.ticks.length;

    // Normaliser : -1 à +1
    const normalized = total > 0 ? cvd / total : 0;

    return {
      cvd,
      normalized,         // -1 (vendeurs dominants) → +1 (acheteurs dominants)
      tickCount: total,
      bullish: normalized > 0.1,
      bearish: normalized < -0.1,
    };
  }

  reset() {
    this.prevMid = null;
    this.ticks = [];
  }
}
