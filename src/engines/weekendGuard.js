/**
 * Weekend Gap Guard
 *
 * Stratégie professionnelle en 4 phases :
 *
 * PHASE 1 — Vendredi 20h00 UTC : stop nouvelles positions
 * PHASE 2 — Vendredi 20h30 UTC : force close toutes positions ouvertes
 * PHASE 3 — Dimanche 21h00 UTC : marché rouvre, attendre 30 min
 * PHASE 4 — Dimanche 21h30 UTC : mesurer le gap
 *   → Gap < 5 pips  : reprendre trading normal
 *   → Gap 5-15 pips : trading normal mais stops élargis
 *   → Gap > 15 pips : trader le FADE (mean reversion)
 *
 * EUR/USD remplit le weekend gap dans ~65% des cas (données historiques).
 * Le gap fade n'est actif que les 30 premières minutes de la session dimanche.
 */

const PIP = 0.0001;

export class WeekendGuard {
  constructor() {
    this.fridayClose = null;  // prix de clôture vendredi
    this.gapDetected = null;  // { size, direction, fadeable }
    this.sundayOpenTime = null;
  }

  /**
   * Analyser le statut weekend pour un timestamp donné.
   *
   * @returns {object} {
   *   blockNewTrades  : boolean — ne pas ouvrir
   *   forceClose      : boolean — fermer tout immédiatement
   *   phase           : string
   *   gapFade         : { direction, pips } | null — signal fade si applicable
   * }
   */
  analyze(now = new Date(), currentPrice = null) {
    const day  = now.getUTCDay();   // 0=dim, 1=lun ... 5=ven, 6=sam
    const hour = now.getUTCHours();
    const min  = now.getUTCMinutes();
    const totalMinutesUTC = hour * 60 + min;

    // ── Vendredi ─────────────────────────────────────────────
    if (day === 5) {
      if (totalMinutesUTC >= 20 * 60 + 30) {
        // 20h30+ : force close
        if (currentPrice) this.fridayClose = currentPrice;
        return { blockNewTrades: true, forceClose: true, phase: 'FRI_FORCE_CLOSE', gapFade: null };
      }
      if (totalMinutesUTC >= 20 * 60) {
        // 20h00-20h30 : stop nouvelles positions
        if (currentPrice) this.fridayClose = currentPrice;
        return { blockNewTrades: true, forceClose: false, phase: 'FRI_NO_NEW', gapFade: null };
      }
    }

    // ── Samedi (marché fermé) ─────────────────────────────────
    if (day === 6) {
      return { blockNewTrades: true, forceClose: false, phase: 'SATURDAY', gapFade: null };
    }

    // ── Dimanche ─────────────────────────────────────────────
    if (day === 0) {
      if (totalMinutesUTC < 21 * 60) {
        // Avant réouverture
        return { blockNewTrades: true, forceClose: false, phase: 'SUN_CLOSED', gapFade: null };
      }

      // Première détection à la réouverture (21h00)
      if (!this.sundayOpenTime && currentPrice) {
        this.sundayOpenTime = now;
        if (this.fridayClose) {
          const gapPips = (currentPrice - this.fridayClose) / PIP;
          const absPips = Math.abs(gapPips);
          this.gapDetected = {
            pips: absPips,
            direction: gapPips > 0 ? 'UP' : 'DOWN',
            fadeable: absPips >= 15,
            openPrice: currentPrice,
            closePrice: this.fridayClose,
          };
          console.log(
            `[WEEKEND] Gap détecté: ${gapPips > 0 ? '+' : ''}${gapPips.toFixed(1)} pips` +
            ` (${this.gapDetected.fadeable ? 'FADEABLE' : 'normal'})`
          );
        }
      }

      const minutesSinceOpen = this.sundayOpenTime
        ? (now - this.sundayOpenTime) / 60_000
        : 0;

      // Phase tampon (30 min)
      if (minutesSinceOpen < 30) {
        // Si gap fadeable → signal fade pendant les 30 premières minutes
        if (this.gapDetected?.fadeable) {
          const fadeDirection = this.gapDetected.direction === 'UP' ? 'SHORT' : 'LONG';
          return {
            blockNewTrades: false,
            forceClose: false,
            phase: 'SUN_GAP_FADE',
            gapFade: {
              direction: fadeDirection,
              pips: this.gapDetected.pips,
              confidence: 0.65, // taux historique de fill EUR/USD
            },
          };
        }
        // Pas de gap significatif → attendre
        return { blockNewTrades: true, forceClose: false, phase: 'SUN_BUFFER', gapFade: null };
      }

      // 30 min écoulées → reprendre trading normal, réinitialiser
      if (minutesSinceOpen >= 30 && this.gapDetected) {
        const stopsTight = this.gapDetected.pips >= 5 && this.gapDetected.pips < 15;
        this.gapDetected = null;
        this.sundayOpenTime = null;
        return {
          blockNewTrades: false,
          forceClose: false,
          phase: 'SUN_NORMAL',
          widenStops: stopsTight, // stops +2 pips si gap modéré
          gapFade: null,
        };
      }
    }

    // ── Semaine normale ───────────────────────────────────────
    return { blockNewTrades: false, forceClose: false, phase: 'NORMAL', gapFade: null };
  }

  reset() {
    this.fridayClose = null;
    this.gapDetected = null;
    this.sundayOpenTime = null;
  }
}
