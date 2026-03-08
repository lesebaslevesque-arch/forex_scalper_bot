import https from 'https';
import { config } from '../config.js';

const HEARTBEAT_TIMEOUT_MS = 10_000;

/**
 * OANDA v20 pricing stream — HTTP chunked streaming (pas WebSocket).
 * OANDA envoie des JSON line-by-line via une connexion HTTP persistante.
 */
export class OandaWs {
  constructor(onTick) {
    this.onTick = onTick;
    this.req = null;
    this.heartbeatTimer = null;
    this.reconnectDelay = 1000;
    this.stopped = false;
    this._buf = '';
  }

  connect() {
    if (this.stopped) return;

    const streamHost = new URL(config.oanda.streamBase).hostname;
    const path =
      `/v3/accounts/${config.oanda.accountId}/pricing/stream` +
      `?instruments=${config.trading.instrument}`;

    console.log(`[STREAM] Connecting to ${config.oanda.env} (${streamHost})...`);

    this.req = https.request(
      {
        hostname: streamHost,
        path,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.oanda.apiKey}`,
          Accept: 'application/octet-stream',
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          console.error(`[STREAM] HTTP ${res.statusCode}`);
          res.resume();
          this._scheduleReconnect();
          return;
        }

        console.log(`[STREAM] Connected — streaming ${config.trading.instrument}`);
        this.reconnectDelay = 1000;
        this._resetHeartbeat();

        res.on('data', (chunk) => {
          this._resetHeartbeat();
          this._buf += chunk.toString();
          const lines = this._buf.split('\n');
          this._buf = lines.pop(); // conserver fragment incomplet
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const msg = JSON.parse(trimmed);
              if (msg.type === 'PRICE') this._handlePrice(msg);
            } catch { /* fragment invalide */ }
          }
        });

        res.on('end', () => {
          console.warn('[STREAM] Connexion terminée — reconnect');
          clearTimeout(this.heartbeatTimer);
          this._scheduleReconnect();
        });

        res.on('error', (err) => {
          console.error('[STREAM] Res error:', err.message);
          this._scheduleReconnect();
        });
      }
    );

    this.req.on('error', (err) => {
      console.error('[STREAM] Req error:', err.message);
      this._scheduleReconnect();
    });

    this.req.end();
  }

  disconnect() {
    this.stopped = true;
    clearTimeout(this.heartbeatTimer);
    this.req?.destroy();
  }

  _handlePrice(msg) {
    const bid = parseFloat(msg.bids?.[0]?.price);
    const ask = parseFloat(msg.asks?.[0]?.price);
    if (isNaN(bid) || isNaN(ask)) return;

    const mid = (bid + ask) / 2;
    const spreadPips = Math.round((ask - bid) * 1_000_000) / 100; // EUR_USD pips

    this.onTick({ time: msg.time, bid, ask, mid, spreadPips });
  }

  _resetHeartbeat() {
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      console.warn('[STREAM] Heartbeat timeout — reconnect');
      this.req?.destroy();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    console.warn(`[STREAM] Reconnect dans ${this.reconnectDelay}ms...`);
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }
}
