import { useEffect, useRef, useState } from 'react';
import { INTERVAL_SEC } from './common';
import {
  THRESHOLDS,
  SCALE_EXPONENT,
  BASIS_MIN_SEC,
  BASIS_INTERVAL,
  MARK_MIN_LEVEL,
  parseKline,
  computeLevels,
  findPeaks,
} from './WhalePane';

type Row = ReturnType<typeof parseKline>;
export type Arrow = 'buy' | 'sell'; // buy = ▲, sell = ▼

const POLL_MS = 5000;

// 봉 시작 시각(초) → 그 봉에 찍히는 고래 흐름 화살표
export function useWhaleArrows(symbol: string, interval: string, enabled: boolean) {
  const marksRef = useRef<Map<number, Arrow>>(new Map());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    marksRef.current = new Map();
    if (!enabled) return;

    const chartSec = INTERVAL_SEC[interval] ?? 60;
    const basisSec = Math.max(chartSec, BASIS_MIN_SEC);
    const basis = BASIS_INTERVAL[basisSec];
    if (!basis) return;
    const subs = chartSec < basisSec ? Math.round(basisSec / chartSec) : 1;
    const mid = Math.floor(subs / 2);

    // 고래 흐름 패널과 같은 기준 금액
    const baseThr = THRESHOLDS[symbol];
    const scale = Math.pow(basisSec / BASIS_MIN_SEC, SCALE_EXPONENT);
    const fixed = baseThr ? baseThr.map((v) => v * scale) : null;

    let rows: Row[] = [];
    const ctrl = new AbortController();
    const base = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${basis}`;

    const compute = () => {
      const lv = computeLevels(rows, fixed);
      const peak = findPeaks(rows, lv);
      const nowSec = Math.floor(Date.now() / 1000);
      const out = new Map<number, Arrow>();
      for (let i = 0; i < rows.length; i++) {
        if (!peak[i] || Math.abs(lv[i]) < MARK_MIN_LEVEL) continue;
        const time = rows[i].t + mid * chartSec; // 고래 패널에서 화살표가 그려지는 봉
        if (time > nowSec) continue;
        out.set(time, lv[i] > 0 ? 'buy' : 'sell');
      }
      marksRef.current = out;
      setVersion((v) => v + 1);
    };

    const upsert = (k: Row) => {
      for (let i = rows.length - 1; i >= Math.max(0, rows.length - 3); i--) {
        if (rows[i].t === k.t) {
          rows[i] = k;
          return;
        }
      }
      if (!rows.length || k.t > rows[rows.length - 1].t) {
        rows.push(k);
        if (rows.length > 1500) rows.shift();
      }
    };

    fetch(`${base}&limit=1000`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((raw) => {
        if (!Array.isArray(raw)) return;
        rows = raw.map(parseKline);
        compute();
      })
      .catch(() => {
        // 실패하면 화살표 없이 계속 (다이아가 안 뜸)
      });

    const timer = setInterval(async () => {
      if (!rows.length) return;
      try {
        const res = await fetch(`${base}&limit=2`, { signal: ctrl.signal });
        const raw = await res.json();
        if (!Array.isArray(raw)) return;
        raw.map(parseKline).forEach(upsert);
        compute();
      } catch {
        // 다음 주기에 다시 시도
      }
    }, POLL_MS);

    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, [symbol, interval, enabled]);

  return { marksRef, version };
}