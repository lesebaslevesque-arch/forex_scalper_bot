import fs from 'fs';

/**
 * Thompson Sampling Multi-Armed Bandit
 *
 * Chaque bras représente une configuration de paramètres de trading.
 * Récompense = win/loss du trade (Bernoulli).
 * Distribution a priori : Beta(α, β) avec α=β=1 (uniforme).
 *
 * À chaque trade :
 *   1. Tirer un sample Beta(α, β) pour chaque bras
 *   2. Choisir le bras avec le sample le plus haut
 *   3. Exécuter le trade avec cette configuration
 *   4. Mettre à jour : win → α++, loss → β++
 */

// ── Bras disponibles ─────────────────────────────────────────
// Ratio TP/SL minimum 2.5:1 pour compenser le spread practice (~1.8p)
// WR requise avec ratio 2.5:1 = SL/(SL+TP) = ~29% → atteignable
export const ARMS = [
  { id: 0, name: 'conserv-3-1',    cvdWindowMs: 5 * 60_000, minScore: 5, stopLossPips: 5,  takeProfitPips: 15 },
  { id: 1, name: 'baseline-2-5',   cvdWindowMs: 5 * 60_000, minScore: 5, stopLossPips: 6,  takeProfitPips: 15 },
  { id: 2, name: 'tight-3-1',      cvdWindowMs: 3 * 60_000, minScore: 6, stopLossPips: 4,  takeProfitPips: 12 },
  { id: 3, name: 'wide-2-5',       cvdWindowMs: 7 * 60_000, minScore: 5, stopLossPips: 8,  takeProfitPips: 20 },
  { id: 4, name: 'score6-3-1',     cvdWindowMs: 5 * 60_000, minScore: 6, stopLossPips: 5,  takeProfitPips: 15 },
];

// ── Sampling Beta via méthode Johnk ─────────────────────────
function gammaRandom(shape) {
  // Marsaglia-Tsang pour shape >= 1
  if (shape < 1) return gammaRandom(1 + shape) * Math.random() ** (1 / shape);

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    let x, v;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);

    v = v ** 3;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x ** 2) ** 2) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function randn() {
  // Box-Muller
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function betaSample(alpha, beta) {
  const x = gammaRandom(alpha);
  const y = gammaRandom(beta);
  return x / (x + y);
}

// ── Bandit ───────────────────────────────────────────────────
export function createBandit({ statePath } = {}) {
  // État : α et β pour chaque bras (prior Beta(1,1) = uniforme)
  let state = ARMS.map((arm) => ({ id: arm.id, alpha: 1, beta: 1, trades: 0, wins: 0 }));

  // Charger état persisté
  if (statePath) {
    try {
      const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (Array.isArray(saved) && saved.length === ARMS.length) {
        state = saved;
        console.log('[BANDIT] État chargé:');
        state.forEach((s, i) => {
          const winRate = s.trades > 0 ? ((s.wins / s.trades) * 100).toFixed(0) : '?';
          console.log(`  Arm ${i} (${ARMS[i].name}): ${s.trades} trades, WR=${winRate}%, α=${s.alpha} β=${s.beta}`);
        });
      }
    } catch { /* premier démarrage */ }
  }

  function save() {
    if (!statePath) return;
    try {
      fs.mkdirSync(statePath.split('/').slice(0, -1).join('/'), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch {}
  }

  return {
    /**
     * Choisir un bras via Thompson Sampling.
     * Retourne { arm: ARMS[i], armIndex: i }
     */
    selectArm() {
      const samples = state.map((s) => betaSample(s.alpha, s.beta));
      const best = samples.indexOf(Math.max(...samples));

      console.log(
        '[BANDIT] Samples: ' +
        samples.map((s, i) => `${ARMS[i].name}=${s.toFixed(3)}`).join(' | ')
      );
      console.log(`[BANDIT] Arm sélectionné: ${ARMS[best].name}`);

      return { arm: ARMS[best], armIndex: best };
    },

    /**
     * Enregistrer le résultat d'un trade.
     * @param {number} armIndex
     * @param {boolean} win - true si trade profitable
     */
    update(armIndex, win) {
      state[armIndex].trades++;
      if (win) {
        state[armIndex].alpha++;
        state[armIndex].wins++;
      } else {
        state[armIndex].beta++;
      }

      const s = state[armIndex];
      const wr = ((s.wins / s.trades) * 100).toFixed(0);
      console.log(
        `[BANDIT] Update arm ${armIndex} (${ARMS[armIndex].name}): ` +
        `${win ? 'WIN' : 'LOSS'} | ${s.trades} trades WR=${wr}% α=${s.alpha} β=${s.beta}`
      );

      save();
    },

    getStats() {
      return state.map((s, i) => ({
        arm: ARMS[i].name,
        trades: s.trades,
        winRate: s.trades > 0 ? s.wins / s.trades : null,
        alpha: s.alpha,
        beta: s.beta,
        // Moyenne de la distribution Beta = α / (α+β)
        expectedWinRate: s.alpha / (s.alpha + s.beta),
      }));
    },
  };
}
