import { useEffect, useRef, useState } from 'react';
import { startLiq, getLiqs, onLiq } from './liqStore';
import { fetchLiqHistory } from './liqHistory';
import { INTERVAL_SEC } from './common';

type Side = 'long' | 'short';

// 봉 시작 시각(초) → 청산 금액(USDT). 과거(Coinalyze)와 실시간(Bybit)을 큰 값 기준으로 합침
export function useLiqBuckets(symbol: string, interval: string, enabled: boolean) {
  const longRef = useRef<Map<number, number>>(new Map());
  const shortRef = useRef<Map<number, number>>(new Map());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    longRef.current = new Map();
    shortRef.current = new Map();
    if (!enabled) return;
    startLiq();

    const sec = INTERVAL_SEC[interval] ?? 60;
    const bucket = (ms: number) => Math.floor(ms / 1000 / sec) * sec;
    const hist: Record<Side, Map<number, number>> = { long: new Map(), short: new Map() };
    const real: Record<Side, Map<number, number>> = { long: new Map(), short: new Map() };
    let timer: number | undefined;

    const merge = () => {
      for (const side of ['long', 'short'] as const) {
        const out = new Map<number, number>();
        const keys = new Set<number>([...hist[side].keys(), ...real[side].keys()]);
        keys.forEach((k) =>
          out.set(k, Math.max(hist[side].get(k) ?? 0, real[side].get(k) ?? 0))
        );
        (side === 'long' ? longRef : shortRef).current = out;
      }
      setVersion((v) => v + 1);
    };
    const schedule = () => {
      if (timer === undefined) {
        timer = window.setTimeout(() => {
          timer = undefined;
          merge();
        }, 500);
      }
    };

    // 이번 접속 중 쌓인 실시간 청산
    for (const e of getLiqs(symbol)) {
      const b = bucket(e.t);
      real[e.side].set(b, (real[e.side].get(b) ?? 0) + e.usd);
    }
    merge();

    // 과거 청산 (캔들 1000개 구간)
    const ctrl = new AbortController();
    const nowSec = Math.floor(Date.now() / 1000);
    const from = Math.floor(nowSec / sec) * sec - 1000 * sec;
    fetchLiqHistory(symbol, interval, from, nowSec, ctrl.signal)
      .then((rows) => {
        if (ctrl.signal.aborted) return;
        for (const r of rows) {
          hist.long.set(r.t, r.long);
          hist.short.set(r.t, r.short);
        }
        merge();
      })
      .catch(() => {
        // 과거 불러오기에 실패해도 실시간 값만으로 계속 동작
      });

    // 이후 실시간 청산
    const off = onLiq((e) => {
      if (e.symbol !== symbol) return;
      const b = bucket(e.t);
      real[e.side].set(b, (real[e.side].get(b) ?? 0) + e.usd);
      schedule();
    });

    return () => {
      ctrl.abort();
      off();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [symbol, interval, enabled]);

  return { longRef, shortRef, version };
}