import 'dotenv/config';
import { config } from './config.js';
import { OandaWs } from './data/oandaWs.js';
import { CvdReconstructor } from './data/cvdReconstructor.js';
import { SessionVwap } from './indicators/vwap.js';
import { computeAtr } from './indicators/atr.js';
import { analyzeRegime } from './engines/regime.js';
import { generateSignal } from './engines/signal.js';
import { createBandit } from './engines/thompsonBandit.js';
import { WeekendGuard } from './engines/weekendGuard.js';
import { placeOrder } from './execution/oandaOrder.js';
import { PositionManager } from './execution/positionManager.js';
import { printStats } from './logger.js';

// ── Modules ──────────────────────────────────────────────────
const vwap         = new SessionVwap();
const pos          = new PositionManager();
const weekendGuard = new WeekendGuard();
const bandit       = createBandit({ statePath: 'logs/bandit_state.json' });

let cvd            = new CvdReconstructor();
let activeArm      = null;
let activeArmIndex = null;
let lastSpread     = null;
let lastRegime     = null;

// Candles 1min
const candles      = [];
let currentCandle  = null;

// ── Sync position broker toutes les 30s ──────────────────────
setInterval(async () => {
  if (!pos.inPosition) return;
  const wasIn = pos.inPosition;
  const record = await pos.syncWithBroker();
  if (wasIn && !pos.inPosition && record && activeArmIndex !== null) {
    bandit.update(activeArmIndex, record.win === true);
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
      ts: minuteTs, time: new Date(minuteTs).toISOString(),
      open: tick.mid, high: tick.mid, low: tick.mid, close: tick.mid, volume: 1,
    };
  } else {
    currentCandle.high   = Math.max(currentCandle.high, tick.mid);
    currentCandle.low    = Math.min(currentCandle.low,  tick.mid);
    currentCandle.close  = tick.mid;
    currentCandle.volume++;
  }
}

// ── Tick principal ───────────────────────────────────────────
async function onTick(tick) {
  buildCandle(tick);
  lastSpread = tick.spreadPips;

  const now = new Date(tick.time);

  // ── Weekend Guard ────────────────────────────────────────
  const wg = weekendGuard.analyze(now, tick.mid);

  if (wg.forceClose && pos.inPosition) {
    console.warn(`[WEEKEND] ${wg.phase} — fermeture forcée`);
    const record = await pos.forceClose();
    if (record && activeArmIndex !== null) {
      bandit.update(activeArmIndex, false);
      activeArm = null; activeArmIndex = null;
    }
    return;
  }

  if (wg.blockNewTrades && !pos.inPosition) return;

  // ── Gap Fade dimanche ────────────────────────────────────
  if (wg.gapFade && !pos.inPosition) {
    console.log(`[GAP FADE] ${wg.gapFade.direction} | gap=${wg.gapFade.pips.toFixed(1)}p | conf=${(wg.gapFade.confidence*100).toFixed(0)}%`);
    const gapArm = { stopLossPips: 8, takeProfitPips: 12, name: 'gap-fade' };
    const fill = await placeOrder(wg.gapFade.direction, gapArm);
    if (fill) {
      pos.enter({
        direction: wg.gapFade.direction, ...fill,
        arm: 'gap-fade', armIndex: -1,
        spreadEntry: tick.spreadPips, regime: 'GAP_FADE', signal: null,
      });
    }
    return;
  }

  // ── CVD & VWAP ───────────────────────────────────────────
  const cvdState = cvd.addTick(tick);
  const vwapVal  = currentCandle
    ? vwap.addCandle({ ...currentCandle, time: currentCandle.time })
    : null;

  if (candles.length < 15) return;

  // ── Régime ───────────────────────────────────────────────
  const regime = analyzeRegime({ candles, spreadPips: tick.spreadPips, now });
  lastRegime = regime;
  if (!regime.active) return;

  if (pos.inPosition || pos.isPlacing) return;

  // ── Sélection bras Thompson Sampling ─────────────────────
  if (!activeArm) {
    const selected = bandit.selectArm();
    activeArm      = selected.arm;
    activeArmIndex = selected.armIndex;
    cvd = new CvdReconstructor(activeArm.cvdWindowMs);
  }

  // ── Signal ───────────────────────────────────────────────
  const signal = generateSignal({
    cvd: cvdState, candles, vwap: vwapVal,
    spreadPips: tick.spreadPips,
    minScore: activeArm.minScore,
  });

  if (!signal) return;

  // ATR au moment de l'entrée
  const atrPips = regime.atrPips;

  console.log(
    `[SIGNAL] ${signal.direction} | arm=${activeArm.name} score=${signal.score}/7` +
    ` CVD=${signal.details.cvd?.toFixed(2)} RSI=${signal.details.rsi?.toFixed(1)}` +
    ` spread=${tick.spreadPips.toFixed(1)}p ATR=${atrPips?.toFixed(1)}p`
  );

  // ── Ordre ────────────────────────────────────────────────
  pos.startPlacing();
  const fill = await placeOrder(signal.direction, activeArm);
  if (!fill) { pos.cancelPlacing(); return; }

  pos.enter({
    direction:      signal.direction,
    ...fill,
    arm:            activeArm.name,
    armIndex:       activeArmIndex,
    armParams:      activeArm,
    spreadEntry:    tick.spreadPips,
    regime:         regime.regime,
    atrPips,
    vwap:           vwapVal,
    signal: {
      score:      signal.score,
      longScore:  signal.longScore,
      shortScore: signal.shortScore,
      confidence: signal.confidence,
      cvd:        signal.details.cvd,
      rsi:        signal.details.rsi,
      macd:       signal.details.macd,
      rejection:  signal.details.rejection,
    },
  });
}

// ── Démarrage ────────────────────────────────────────────────
console.log(`\n[BOT] Forex Scalper — ENV=${config.oanda.env.toUpperCase()}`);
console.log(`[BOT] Instrument: ${config.trading.instrument}`);
console.log(`[BOT] Session: ${config.session.startHour}h-${config.session.endHour}h UTC`);
console.log(`[BOT] Thompson Sampling: ${bandit.getStats().length} bras`);

printStats();

const ws = new OandaWs(onTick);
ws.connect();

// Arrêt propre
process.on('SIGINT', async () => {
  console.log('\n[BOT] Arrêt...');
  printStats();
  if (pos.inPosition) await pos.forceClose();
  ws.disconnect();
  process.exit(0);
});
