import 'dotenv/config';

const isPractice = (process.env.OANDA_ENV || 'practice') === 'practice';

export const config = {
  oanda: {
    apiKey: process.env.OANDA_API_KEY,
    accountId: process.env.OANDA_ACCOUNT_ID,
    env: isPractice ? 'practice' : 'live',
    restBase: isPractice
      ? 'https://api-fxpractice.oanda.com'
      : 'https://api-fxtrade.oanda.com',
    streamBase: isPractice
      ? 'https://stream-fxpractice.oanda.com'
      : 'https://stream-fxtrade.oanda.com',
  },
  trading: {
    instrument: 'EUR_USD',
    units: 1000,            // 0.01 lot mini
    stopLossPips: 5,
    takeProfitPips: 8,
    maxSpreadPips: 2,       // ne pas trader si spread > 2 pips
  },
  session: {
    startHour: 13,          // 13h00 UTC (London/NY overlap)
    endHour: 17,            // 17h00 UTC
  },
  indicators: {
    cvdWindowMs: 5 * 60 * 1000,   // 5 minutes
    rsiPeriod: 14,
    atrPeriod: 14,
    minSignalStrength: 0.6,
  },
};
