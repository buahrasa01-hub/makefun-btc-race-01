import { BPS, runBars, type Bar, type SellInput } from './vendor/makefun-bars.ts';

// Trend and risk parameters are expressed in bars and basis points for easy review.
const FAST_EMA_BARS = 12;
const SIGNAL_EMA_BARS = 34;
const TREND_EMA_BARS = 75;
const MOMENTUM_BARS = 24;
const MIN_MOMENTUM_BPS = 60;
const ATR_BARS = 20;
const EXPECTED_MOVE_HORIZON_BARS = 24;
const TRAIL_ATR_MULTIPLIER = 2.6;
const STOP_ATR_MULTIPLIER = 2.8;
const COOLDOWN_BARS = 8;
const MAX_SLIPPAGE_BPS = 200;
const MIN_EXPECTED_MOVE_BPS = 110;

interface Indicators {
  fast: number | null;
  signal: number | null;
  trend: number | null;
  atr: number | null;
  priorClose: number | null;
  closes: number[];
  ranges: number[];
  peak: number;
}

const indicators: Indicators = {
  fast: null, signal: null, trend: null, atr: null,
  priorClose: null, closes: [], ranges: [], peak: 0,
};
let priorFastSignalGap: number | null = null;
let lastExitDecision = -1_000_000;

function ema(previous: number | null, value: number, span: number): number {
  return previous === null ? value : previous + (2 / (span + 1)) * (value - previous);
}

function update(bar: Bar): void {
  const close = Number(bar.c);
  const high = Number(bar.h);
  const low = Number(bar.l);
  const previousFast = indicators.fast;
  const previousSignal = indicators.signal;
  indicators.fast = ema(indicators.fast, close, FAST_EMA_BARS);
  indicators.signal = ema(indicators.signal, close, SIGNAL_EMA_BARS);
  indicators.trend = ema(indicators.trend, close, TREND_EMA_BARS);

  if (indicators.priorClose !== null) {
    const trueRange = Math.max(high - low, Math.abs(high - indicators.priorClose), Math.abs(low - indicators.priorClose));
    indicators.ranges.push(trueRange);
    if (indicators.ranges.length > ATR_BARS) indicators.ranges.shift();
    const average = indicators.ranges.reduce((sum, value) => sum + value, 0) / indicators.ranges.length;
    indicators.atr = indicators.atr === null ? average : indicators.atr + (2 / (ATR_BARS + 1)) * (average - indicators.atr);
  }
  indicators.closes.push(close);
  if (indicators.closes.length > MOMENTUM_BARS + 1) indicators.closes.shift();
  indicators.priorClose = close;
  if (indicators.peak === 0 || close > indicators.peak) indicators.peak = close;
  if (previousFast !== null && previousSignal !== null) priorFastSignalGap = previousFast - previousSignal;
}

function momentumBps(): number | null {
  if (indicators.closes.length <= MOMENTUM_BARS) return null;
  const then = indicators.closes[0]!;
  const now = indicators.closes[indicators.closes.length - 1]!;
  return ((now - then) * 10_000) / then;
}

await runBars({
  onBatch(state, batch) {
    const bar = batch.bars.find((item) => item.symbol === 'CBBTC');
    if (bar === undefined) return [];
    update(bar);
    const held = state.positions.get('CBBTC');
    const close = Number(bar.c);
    const atr = indicators.atr;

    if (held !== undefined) {
      if (close > indicators.peak) indicators.peak = close;
      const asset = state.symbols.get('CBBTC')!;
      const averageEntry = (Number(held.cost) * 10 ** (asset.qty_scale + asset.price_scale - state.hello.capital.quote_scale)) / Number(held.qty);
      // Risk exits use price levels; the account cost remains the hard backstop if volatility expands.
      const trailHit = atr !== null && close <= indicators.peak - TRAIL_ATR_MULTIPLIER * atr;
      const costStop = atr !== null && close <= averageEntry - STOP_ATR_MULTIPLIER * atr;
      const trendExit = indicators.fast !== null && indicators.signal !== null && indicators.fast < indicators.signal
        && priorFastSignalGap !== null && priorFastSignalGap >= 0;
      const longTrendLost = indicators.trend !== null && close < indicators.trend;
      const emergencyLoss = state.value('CBBTC', held.qty) * 100n < held.cost * 97n;
      if (trailHit || costStop || trendExit || longTrendLost || emergencyLoss) {
        lastExitDecision = batch.seq;
        indicators.peak = close;
        return [{ side: 'sell', symbol: 'CBBTC', qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
      }
      return [];
    }

    indicators.peak = close;
    if (batch.seq - lastExitDecision <= COOLDOWN_BARS) return [];
    if (indicators.fast === null || indicators.signal === null || indicators.trend === null || atr === null) return [];
    const momentum = momentumBps();
    if (momentum === null || momentum < MIN_MOMENTUM_BPS || close <= indicators.trend || indicators.fast <= indicators.signal) return [];

    const expectedRangeBps = ((atr * 10_000) / close) * Math.sqrt(EXPECTED_MOVE_HORIZON_BARS);
    if (expectedRangeBps < MIN_EXPECTED_MOVE_BPS) return [];
    const notional = (state.cash * BigInt(state.hello.caps.max_weight_bps)) / BPS;
    if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    return [{ side: 'buy', symbol: 'CBBTC', notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
