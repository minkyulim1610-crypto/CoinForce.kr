export type Candle = {
  time: number; // 시작 시각(초)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

let candles: Candle[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export const getCandles = () => candles;

export function setCandles(list: Candle[]) {
  candles = list;
  notify();
}

export function upsertCandle(c: Candle) {
  const last = candles[candles.length - 1];
  if (last && last.time === c.time) candles[candles.length - 1] = c;
  else if (!last || c.time > last.time) candles.push(c);
  else return;
  notify();
}

export function onCandles(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}