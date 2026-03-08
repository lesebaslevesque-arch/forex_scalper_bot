import fs from 'fs';
import path from 'path';

const LOG_DIR  = 'logs';
const LOG_FILE = path.join(LOG_DIR, 'trades.jsonl');

fs.mkdirSync(LOG_DIR, { recursive: true });

/**
 * Log un trade complet en JSONL.
 *
 * Métriques capturées pour analyse post-session :
 *
 * IDENTIFICATION
 *   ts, direction, exitReason, win
 *
 * THOMPSON SAMPLING
 *   arm, armIndex, armParams (SL/TP/CVD/minScore)
 *
 * PRIX & PNL
 *   entryPrice, exitPrice, pnlPips, pnlUsd, holdSec
 *
 * CONDITIONS D'ENTRÉE
 *   spreadEntry, regime, hourUTC, dayOfWeek
 *
 * SIGNAL — scores détaillés
 *   score, cvd, rsi, macd, macdHist, wickRejection, vwapDiff, srLevel
 *   longScore, shortScore (pour voir à quel point c'était serré)
 *
 * VOLATILITÉ
 *   atrPips (volatilité au moment de l'entrée)
 *
 * RÉSULTAT
 *   slPips, tpPips, rrRatio (risk/reward réalisé)
 */
export function logTrade(trade) {
  const now = new Date();

  // Risk/reward réalisé
  const rrRatio = trade.pnlPips !== null && trade.stopLossPips
    ? +(trade.pnlPips / trade.stopLossPips).toFixed(2)
    : null;

  // Distance entry vs VWAP en pips
  const vwapDiffPips = trade.vwap && trade.entryPrice
    ? +((trade.entryPrice - trade.vwap) * 10_000).toFixed(1)
    : null;

  const record = {
    // ── Identification ──
    ts:          now.toISOString(),
    hourUTC:     now.getUTCHours(),
    minuteUTC:   now.getUTCMinutes(),
    dayOfWeek:   ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getUTCDay()],
    direction:   trade.direction,
    exitReason:  trade.exitReason,   // 'SL' | 'TP' | 'FORCE' | 'UNKNOWN'
    win:         trade.pnlPips !== null ? trade.pnlPips > 0 : null,

    // ── Thompson Sampling ──
    arm:         trade.arm,
    armIndex:    trade.armIndex,
    armParams: {
      cvdWindowMin: trade.armParams?.cvdWindowMs ? trade.armParams.cvdWindowMs / 60_000 : null,
      minScore:     trade.armParams?.minScore     ?? null,
      slPips:       trade.armParams?.stopLossPips  ?? null,
      tpPips:       trade.armParams?.takeProfitPips ?? null,
    },

    // ── Prix & PnL ──
    entryPrice:  trade.entryPrice,
    exitPrice:   trade.exitPrice    ?? null,
    pnlPips:     trade.pnlPips      !== null ? +trade.pnlPips.toFixed(2) : null,
    pnlUsd:      trade.pnlUsd       !== null ? +trade.pnlUsd.toFixed(4)  : null,
    holdSec:     trade.holdSec      ?? null,
    rrRatio,

    // ── Conditions d'entrée ──
    spreadEntry: trade.spreadEntry  ?? null,
    regime:      trade.regime       ?? null,
    atrPips:     trade.atrPips      !== undefined ? +trade.atrPips?.toFixed(2) : null,

    // ── Signal détaillé ──
    signal: {
      score:        trade.signal?.score        ?? null,
      longScore:    trade.signal?.longScore     ?? null,
      shortScore:   trade.signal?.shortScore    ?? null,
      confidence:   trade.signal?.confidence   !== undefined ? +trade.signal.confidence.toFixed(3) : null,
      cvdNorm:      trade.signal?.cvd          !== undefined ? +trade.signal.cvd.toFixed(3)    : null,
      rsi:          trade.signal?.rsi          !== undefined ? +trade.signal.rsi.toFixed(1)    : null,
      macdHist:     trade.signal?.macd         !== undefined ? +trade.signal.macd.toFixed(6)   : null,
      wickRejection: trade.signal?.rejection   ?? null,
      vwapDiffPips,        // + = prix au-dessus VWAP, - = en dessous
      nearSR:       trade.signal?.nearSR       ?? null,
    },
  };

  fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');
  return record;
}

/**
 * Résumé affiché au démarrage du bot.
 */
export function printStats() {
  if (!fs.existsSync(LOG_FILE)) {
    console.log('[STATS] Aucun trade loggé encore.\n');
    return;
  }

  const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
  if (!lines.length) { console.log('[STATS] Aucun trade.\n'); return; }

  const trades  = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const withPnl = trades.filter((t) => t.pnlPips !== null);
  const wins    = withPnl.filter((t) => t.win);
  const losses  = withPnl.filter((t) => !t.win);

  const totalPnl   = withPnl.reduce((s, t) => s + t.pnlPips, 0);
  const avgWin     = wins.length   ? wins.reduce((s,t)   => s + t.pnlPips, 0) / wins.length   : 0;
  const avgLoss    = losses.length ? losses.reduce((s,t) => s + t.pnlPips, 0) / losses.length : 0;
  const winRate    = withPnl.length ? wins.length / withPnl.length : 0;
  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;
  const avgRR      = withPnl.filter(t => t.rrRatio).reduce((s,t) => s + t.rrRatio, 0) / (withPnl.filter(t=>t.rrRatio).length || 1);

  // Exit reasons
  const byReason = {};
  trades.forEach(t => { byReason[t.exitReason] = (byReason[t.exitReason] || 0) + 1; });

  console.log('\n[STATS] ══════════════════════════════════');
  console.log(`  Trades    : ${withPnl.length} (${wins.length}W / ${losses.length}L)`);
  console.log(`  Win rate  : ${(winRate * 100).toFixed(1)}%`);
  console.log(`  Avg win   : +${avgWin.toFixed(1)}p`);
  console.log(`  Avg loss  : ${avgLoss.toFixed(1)}p`);
  console.log(`  Expectancy: ${expectancy >= 0 ? '+' : ''}${expectancy.toFixed(2)}p/trade`);
  console.log(`  Avg R:R   : ${avgRR.toFixed(2)}`);
  console.log(`  Total PnL : ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(1)}p`);
  console.log(`  Exit reasons: ${Object.entries(byReason).map(([k,v]) => `${k}=${v}`).join(' ')}`);

  // Par bras
  const byArm = {};
  withPnl.forEach((t) => {
    const k = t.arm || 'unknown';
    if (!byArm[k]) byArm[k] = { trades: 0, wins: 0, pnl: 0 };
    byArm[k].trades++;
    if (t.win) byArm[k].wins++;
    byArm[k].pnl += t.pnlPips;
  });
  if (Object.keys(byArm).length > 0) {
    console.log('  ── Par bras ──────────────────────────');
    Object.entries(byArm).sort((a,b) => b[1].pnl - a[1].pnl).forEach(([arm, s]) => {
      const wr = ((s.wins / s.trades) * 100).toFixed(0);
      const pnl = s.pnl >= 0 ? '+' + s.pnl.toFixed(1) : s.pnl.toFixed(1);
      console.log(`    ${arm.padEnd(18)}: ${String(s.trades).padStart(3)}T  WR=${wr.padStart(3)}%  PnL=${pnl}p`);
    });
  }

  // Par heure UTC (voir quelle heure est la plus profitable)
  const byHour = {};
  withPnl.forEach(t => {
    const h = t.hourUTC;
    if (!byHour[h]) byHour[h] = { trades: 0, wins: 0, pnl: 0 };
    byHour[h].trades++;
    if (t.win) byHour[h].wins++;
    byHour[h].pnl += t.pnlPips;
  });
  if (Object.keys(byHour).length > 1) {
    console.log('  ── Par heure UTC ─────────────────────');
    Object.entries(byHour).sort((a,b) => +a[0] - +b[0]).forEach(([h, s]) => {
      const wr = ((s.wins / s.trades) * 100).toFixed(0);
      const pnl = s.pnl >= 0 ? '+' + s.pnl.toFixed(1) : s.pnl.toFixed(1);
      console.log(`    ${h}h UTC: ${s.trades}T  WR=${wr}%  PnL=${pnl}p`);
    });
  }

  console.log('[STATS] ══════════════════════════════════\n');
}
