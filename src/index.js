import 'dotenv/config';
import { config } from './config.js';
import { OandaWs } from './data/oandaWs.js';
import { CvdReconstructor } from './data/cvdReconstructor.js';
import { SessionVwap } from './indicators/vwap.js';
import { analyzeRegime } from './engines/regime.js';
import { generateSignal } from './engines/signal.js';
import { createBandit } from './engines/thompsonBandit.js';
import { WeekendGuard } from './engines/weekendGuard.js';
import { placeOrder } from './execution/oandaOrder.js';
import { PositionManager } from './execution/positionManager.js';
import { oandaRest } from './data/oandaRest.js';

// ── Modules ──────────────────────────────────────────────────
const vwap        = new SessionVwap();
const pos         = new PositionManager();
const weekendGuard = new WeekendGuard();
const bandit      = createBandit({ statePath: 'logs/bandit_state.json' });

// CVD dynamique — recréé selon le bras actif
let cvd = new CvdReconstructor();
let activeArm = null;   // bras Thompson Sampling en cours
let activeArmIndex = null;

// Candles 1min
const candles = [];
let currentCandle = null;

// Sync position broker toutes les 30s
setInterval(async () => {
  if (!pos.inPosition) return;
  const wasIn = pos.inPosition;
  await pos.syncWithBroker();
  // Si position fermée par SL/TP → mettre à jour le bandit
  if (wasIn && !pos.inPosition && activeArmIndex !== null) {
    const win = pos.lastPnlPips !== null ? pos.lastPnlPips > 0 : false;
    bandit.update(activeArmIndex, win);
    activeArm = null;
    activeArmIndex = null;
  }
}, 30_000);

// ── Construction bougies 1min ────────────────────────────────
function buildCandle(tick) {
  const minuteTs = Math.floor(new Date(tick.time).getTime() / 60_000) * 60_000;

  if (!currentCandle || currentCandle.ts !== minuteTs) {
    if (currentCandle) {
      candles.push(currentCandle);
      if (candles.length > 200) candles.shift();
    }
    currentCandle = {
      ts: minuteTs,
      time: new Date(minuteTs).toISOString(),
      open: tick.mid,
      high: tick.mid,
      low: tick.mid,
      close: tick.mid,
      volume: 1,
    };
  } else {
    currentCandle.high = Math.max(currentCandle.high, tick.mid);
    currentCandle.low  = Math.min(currentCandle.low,  tick.mid);
    currentCandle.close = tick.mid;
    currentCandle.volume++;
  }
}

// ── Tick principal ───────────────────────────────────────────
async function onTick(tick) {
  buildCandle(tick);

  const now = new Date(tick.time);

  // ── Weekend Guard ────────────────────────────────────────
  const wg = weekendGuard.analyze(now, tick.mid);

  if (wg.forceClose && pos.inPosition) {
    console.warn(`[WEEKEND] ${wg.phase} — fermeture forcée`);
    const result = await pos.forceClose();
    if (activeArmIndex !== null) {
      bandit.update(activeArmIndex, result?.win ?? false);
      activeArm = null;
      activeArmIndex = null;
    }
    return;
  }

  if (wg.blockNewTrades && !pos.inPosition) return;

  // ── Gap Fade (dimanche ouverture) ────────────────────────
  if (wg.gapFade && !pos.inPosition) {
    console.log(`[GAP FADE] ${wg.gapFade.direction} ${wg.gapFade.pips.toFixed(1)}p gap | conf=${(wg.gapFade.confidence * 100).toFixed(0)}%`);
    // Utiliser bras baseline pour le gap fade (stops adaptés)
    const gapArm = { stopLossPips: 8, takeProfitPips: 12 }; // stops larges sur gap
    const fill = await placeOrder(wg.gapFade.direction, gapArm);
    if (fill) pos.enter({ direction: wg.gapFade.direction, ...fill });
    return;
  }

  // ── CVD via bras actif ───────────────────────────────────
  const cvdState = cvd.addTick(tick);
  const vwapVal  = currentCandle
    ? vwap.addCandle({ ...currentCandle, time: currentCandle.time })
    : null;

  if (candles.length < 15) return;

  // ── Régime ───────────────────────────────────────────────
  const regime = analyzeRegime({ candles, spreadPips: tick.spreadPips, now });
  if (!regime.active) return;

  // ── Pas de double position ────────────────────────────────
  if (pos.inPosition) return;

  // ── Sélection bras Thompson Sampling ─────────────────────
  if (!activeArm) {
    const selected = bandit.selectArm();
    activeArm      = selected.arm;
    activeArmIndex = selected.armIndex;
    // Reconfigurer CVD window selon le bras
    cvd = new CvdReconstructor(activeArm.cvdWindowMs);
  }

  // ── Signal via config du bras actif ─────────────────────
  const signal = generateSignal({
    cvd: cvdState,
    candles,
    vwap: vwapVal,
    spreadPips: tick.spreadPips,
    minScore: activeArm.minScore,
  });

  if (!signal) return;

  console.log(
    `[SIGNAL] ${signal.direction} | arm=${activeArm.name} score=${signal.score} ` +
    `CVD=${signal.details.cvd?.toFixed(2)} RSI=${signal.details.rsi?.toFixed(1)} ` +
    `spread=${tick.spreadPips.toFixed(1)}p`
  );

  const fill = await placeOrder(signal.direction, activeArm);
  if (fill) pos.enter({ direction: signal.direction, ...fill });
}

// ── Démarrage ────────────────────────────────────────────────
console.log(`\n[BOT] Forex Scalper — ENV=${config.oanda.env.toUpperCase()}`);
console.log(`[BOT] Instrument: ${config.trading.instrument}`);
console.log(`[BOT] Session: ${config.session.startHour}h-${config.session.endHour}h UTC`);
console.log(`[BOT] Thompson Sampling: ${bandit.getStats().length} bras\n`);

const ws = new OandaWs(onTick);
ws.connect();

// Arrêt propre
process.on('SIGINT', async () => {
  console.log('\n[BOT] Arrêt...');
  if (pos.inPosition) await pos.forceClose();
  ws.disconnect();
  process.exit(0);
});
