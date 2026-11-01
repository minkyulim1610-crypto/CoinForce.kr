const PROXY = 'https://coinalyze-proxy.coinforce.workers.dev';
const BYBIT_CODE = '6';

const COINALYZE_INTERVAL: Record<string, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '1hour',
  '4h': '4hour',
  '1d': 'daily',
};

export type LiqBucket = { t: number; long: number; short: number };

const cache = new Map<string, { at: number; rows: LiqBucket[] }>();
const TTL_MS = 60_000;

export async function fetchLiqHistory(
  symbol: string,
  interval: string,
  fromSec: number,
  toSec: number,
  signal?: AbortSignal
): Promise<LiqBucket[]> {
  const iv = COINALYZE_INTERVAL[interval];
  if (!iv) return [];

  const key = `${symbol}|${interval}|${fromSec}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;

  const qs = new URLSearchParams({
    symbols: `${symbol}.${BYBIT_CODE}`,
    interval: iv,
    from: String(fromSec),
    to: String(toSec),
    convert_to_usd: 'true',
  });
  const res = await fetch(`${PROXY}/liquidation-history?${qs}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  const history: { t: number; l: number; s: number }[] = json?.[0]?.history ?? [];
  const rows = history.map((x) => ({ t: x.t, long: x.l, short: x.s }));
  cache.set(key, { at: Date.now(), rows });
  return rows;
}
