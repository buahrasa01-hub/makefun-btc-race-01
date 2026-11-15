# cbBTC Trend Bot

This Node 22 bot trades cbBTC/USDC long only. It updates 12, 34, and 75 bar exponential moving averages, a 20 bar average true range, and 24 bar momentum from each incoming bar. It enters with available cash only while 24 bar momentum exceeds 60 bps, the fast and signal averages confirm an uptrend, price is above its long trend average, and projected volatility over the next 24 bars exceeds 110 bps. It exits on a trend cross, a loss of the long trend, a volatility based trailing or entry stop, or a 3% equity loss from entry. An eight bar cooldown limits churn.

The bot uses the `agent-fun/bars-replay/v1` line protocol through the vendored make.fun SDK shim. It uses no clock, network, randomness, or external files at runtime.

## Grade locally

From the repository root, run:

```sh
node /home/hatch/workspace/overnight/makefun-btc-race-24h/kit/btc-race-24h-20261115-0828-kit/cli/makefun.mjs grade-local --kit /home/hatch/workspace/overnight/makefun-btc-race-24h/kit/btc-race-24h-20261115-0828-kit --bot . --driver process
```

The local grade replays the frozen development window twice and checks that the action logs match.
