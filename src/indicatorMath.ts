import type { Candle } from './candleStore';

type Series = (number | null)[];

// 단순 이동평균
export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period < 1) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// 지수 이동평균 (처음 기간만큼의 평균으로 시작)
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// 볼린저밴드 (모집단 표준편차): [상단, 중심, 하단]
export function bollinger(values: number[], period: number, mult: number): [Series, Series, Series] {
  const mid = sma(values, period);
  const up: Series = new Array(values.length).fill(null);
  const lo: Series = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const m = mid[i];
    if (m === null) continue;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (values[j] - m) ** 2;
    const sd = Math.sqrt(v / period);
    up[i] = m + mult * sd;
    lo[i] = m - mult * sd;
  }
  return [up, mid, lo];
}

// RSI (Wilder 방식)
export function rsi(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period < 1 || values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const calc = () => (avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  out[period] = calc();
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = calc();
  }
  return out;
}

// VWAP: resetDaily가 true면 매일 UTC 00:00(한국 시간 09:00)에 다시 시작
export function vwap(candles: Candle[], resetDaily: boolean): Series {
  const out: Series = new Array(candles.length).fill(null);
  let cumPV = 0;
  let cumV = 0;
  let day = -1;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const d = Math.floor(c.time / 86400);
    if (resetDaily && d !== day) {
      cumPV = 0;
      cumV = 0;
      day = d;
    }
    cumPV += ((c.high + c.low + c.close) / 3) * c.volume;
    cumV += c.volume;
    out[i] = cumV > 0 ? cumPV / cumV : null;
  }
  return out;
}