# Forex Scalper Bot — Contexte de départ

## Origine du projet

Ce bot est inspiré du bot de scalping BTC sur Polymarket (`/root/arbitrage_bot_5m`).
L'observation clé : le modèle (CVD + mean reversion + momentum court terme) est plus
adapté à un marché moins volatile et moins manipulé que BTC. Le Forex, particulièrement
EUR/USD, est le candidat idéal.

---

## Stratégie

**Type** : Scalping directionnel mean-reverting
**Paire cible** : EUR/USD (départ), puis USD/JPY
**Timeframe** : 1min à 5min
**Sessions** : London/NY overlap uniquement — 13h00 à 17h00 UTC

### Logique centrale
- Détecter pression directionnelle via CVD reconstruit depuis tick data
- Entrer sur rejection wicks aux niveaux S/R
- Sortir rapidement (1-3 pips de profit), stop serré (3-5 pips)
- Win rate cible : 55%+, RR minimum 1.5:1

---

## Architecture technique

```
Tick stream (OANDA WebSocket v20)
    ↓
CVD reconstructor     ← classifier chaque tick par direction de prix
    ↓
Indicators (ATR, RSI, VWAP, MACD)
    ↓
Regime engine         ← filtrer sessions, détecter range vs trend
    ↓
Signal engine         ← seuils adaptés Forex (pips, pas %)
    ↓
OANDA REST execution  ← ordres market + stop loss en pips
```

---

## Broker : OANDA

- API : v20 (REST + WebSocket streaming)
- Tick streaming : WebSocket, latence ~5-15ms
- Paper trading : gratuit, pas de capital requis pour tester
- Spreads EUR/USD : ~0.8-1.2 pips
- Documentation : https://developer.oanda.com/rest-live-v20/introduction/

### Variables d'environnement nécessaires
```
OANDA_API_KEY=...
OANDA_ACCOUNT_ID=...
OANDA_ENV=practice   # ou "live"
```

---

## Reconstruction CVD en Forex

Forex n'a pas de trades signés (pas de tape publique). On classifie chaque tick
par direction du prix moyen (mid price) :

```js
function classifyTick(prevMid, currentMid, volume) {
  if (currentMid > prevMid) return +volume;  // acheteur agressif
  if (currentMid < prevMid) return -volume;  // vendeur agressif
  return 0;
}
// CVD = somme cumulée des deltas sur la fenêtre de temps
```

---

## Modules à créer (plan de développement)

### Phase 1 — Data pipeline
- [ ] `src/data/oandaWs.js` — WebSocket tick streaming OANDA
- [ ] `src/data/oandaRest.js` — REST client (prix, compte, historique)
- [ ] `src/data/cvdReconstructor.js` — CVD depuis tick stream

### Phase 2 — Indicateurs (copier/adapter depuis arbitrage_bot_5m)
- [ ] `src/indicators/atr.js` — copie directe
- [ ] `src/indicators/rsi.js` — copie directe
- [ ] `src/indicators/vwap.js` — adapter (session VWAP, reset à 13h UTC)
- [ ] `src/indicators/macd.js` — copie directe

### Phase 3 — Moteurs de décision
- [ ] `src/engines/regime.js` — range vs trend, filtre session
- [ ] `src/engines/signal.js` — logique entrée/sortie en pips
- [ ] `src/engines/microstructure.js` — spread awareness, wick detection

### Phase 4 — Exécution
- [ ] `src/execution/oandaOrder.js` — market order + stop loss OANDA
- [ ] `src/execution/positionManager.js` — trailing stop, partial close

### Phase 5 — Infrastructure
- [ ] `src/index.js` — orchestrateur principal
- [ ] `src/config.js` — paramètres (pips, lots, sessions)

---

## Paramètres initiaux (à tuner)

| Paramètre | Valeur initiale |
|---|---|
| Taille position | 0.01 lot (mini) |
| Stop loss | 5 pips |
| Take profit | 8 pips |
| CVD window | 5 minutes |
| RSI period | 14 |
| ATR period | 14 |
| Min signal strength | 0.6 |

---

## Réutilisation depuis arbitrage_bot_5m

| Fichier source | Réutilisation |
|---|---|
| `src/indicators/atr.js` | Copie directe |
| `src/indicators/rsi.js` | Copie directe |
| `src/indicators/macd.js` | Copie directe |
| `src/indicators/vwap.js` | Adapter (session reset) |
| `src/indicators/divergence.js` | Copie directe |
| `src/engines/regime.js` | Adapter (sessions Forex) |
| `src/engines/microstructure.js` | Adapter (spread Forex) |
| `src/engines/flowLearner.js` | Adapter |
| `src/scalping.js` | Adapter (logique principale) |

---

## Notes importantes

- **Pas de trading vendredi 21h UTC → dimanche 21h UTC** (weekend gap)
- **Spread intégré dès l'entrée** : si spread > 2 pips, ne pas trader
- **Slippage** : prévoir 0.1-0.5 pip de slippage sur market orders
- **Rollover/swap** : éviter de tenir des positions overnight (frais de swap)
- **Backtest d'abord** : OANDA offre des données historiques tick par tick via REST

---

## Prochaine étape recommandée

Commencer par `src/data/oandaWs.js` — la connexion WebSocket tick streaming.
C'est la pièce fondamentale qui valide que le pipeline de données fonctionne
avant de construire les indicateurs et la logique de trading.
