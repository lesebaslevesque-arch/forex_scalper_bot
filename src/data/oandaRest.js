import { config } from '../config.js';

const BASE = `${config.oanda.restBase}/v3`;

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.oanda.apiKey}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(`OANDA ${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

export const oandaRest = {
  // Compte
  getAccount: () =>
    request('GET', `/accounts/${config.oanda.accountId}/summary`),

  // Prix courant
  getPrice: (instrument = config.trading.instrument) =>
    request('GET', `/accounts/${config.oanda.accountId}/pricing?instruments=${instrument}`),

  // Passer un ordre market avec SL et TP
  placeMarketOrder: ({ instrument, units, stopLossPips, takeProfitPips, direction }) => {
    const pipUnit = 0.0001; // EUR_USD
    const sl = stopLossPips * pipUnit;
    const tp = takeProfitPips * pipUnit;
    const signedUnits = direction === 'LONG' ? units : -units;

    return request('POST', `/accounts/${config.oanda.accountId}/orders`, {
      order: {
        type: 'MARKET',
        instrument,
        units: String(signedUnits),
        stopLossOnFill: { distance: sl.toFixed(5) },
        takeProfitOnFill: { distance: tp.toFixed(5) },
        timeInForce: 'FOK',
      },
    });
  },

  // Fermer une position ouverte
  closePosition: (instrument = config.trading.instrument) =>
    request('PUT', `/accounts/${config.oanda.accountId}/positions/${instrument}/close`, {
      longUnits: 'ALL',
      shortUnits: 'ALL',
    }),

  // Positions ouvertes
  getOpenPositions: () =>
    request('GET', `/accounts/${config.oanda.accountId}/openPositions`),

  // Historique des trades
  getRecentTrades: (count = 20) =>
    request('GET', `/accounts/${config.oanda.accountId}/trades?count=${count}`),

  // Détail d'un trade fermé par son ID
  getClosedTrade: (tradeId) =>
    request('GET', `/accounts/${config.oanda.accountId}/trades/${tradeId}`),
};
