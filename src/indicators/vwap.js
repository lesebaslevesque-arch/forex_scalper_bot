import { config } from '../config.js';

/**
 * VWAP de session — reset à chaque début de session London/NY (13h UTC).
 * En Forex, volume = tick count (pas de volume réel disponible).
 */
export class SessionVwap {
  constructor() {
    this.pv = 0;   // price × volume cumulé
    this.vol = 0;  // volume cumulé (tick count)
    this.sessionStartHour = config.session.startHour;
    this.lastHour = null;
  }

  addCandle({ close, high, low, volume, time }) {
    const hour = new Date(time).getUTCHours();

    // Reset au début de la session
    if (this.lastHour !== null && this.lastHour < this.sessionStartHour && hour >= this.sessionStartHour) {
      this.pv = 0;
      this.vol = 0;
    }
    this.lastHour = hour;

    const tp = (high + low + close) / 3;
    const v = volume ?? 1;
    this.pv += tp * v;
    this.vol += v;

    return this.get();
  }

  get() {
    if (this.vol === 0) return null;
    return this.pv / this.vol;
  }

  reset() {
    this.pv = 0;
    this.vol = 0;
    this.lastHour = null;
  }
}
