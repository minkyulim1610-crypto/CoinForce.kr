import { useEffect, useRef, useState } from 'react';
import {
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  startLiq,
  getLiqs,
  getLiqStatus,
  onLiq,
  onLiqStatus,
  type LiqSide,
  type LiqStatus,
} from './liqStore';
import { fetchLiqHistory } from './liqHistory';
import { UP, DOWN, GRAY, INTERVAL_SEC, compact } from './common';

// ===== 설정 (여기만 고치면 됩니다) =====
const PANE_HEIGHT = 180;
const LONG_COLOR = UP;     // 롱 청산 막대 색
const SHORT_COLOR = DOWN;  // 숏 청산 막대 색
const LONG_SIGN = 1;       // 1 = 위쪽, -1 = 아래쪽
const SHORT_SIGN = -1;
// ======================================

type Side = LiqSide;
type Props = {
  chart: IChartApi | null;
  symbol: string;
  interval: string;
  enabled: boolean;   // false면 패널을 차트에서 제거
  paneIndex?: number; // 차트 안에서 몇 번째 패널인지 (0은 캔들)
};

const LIQ_STATUS_COLOR: Record<LiqStatus, string> = {
  connecting: '#f5a623',
  live: UP,
  error: DOWN,
};

export default function LiquidationPane({
  chart, symbol, interval, enabled, paneIndex = 1,
}: Props) {
  const labelRef = useRef<HTMLDivElement>(null);
  const [series, setSeries] = useState<Record<Side, ISeriesApi<'Histogram'>> | null>(null);
  const [liqStatus, setLiqStatus] = useState<LiqStatus>(getLiqStatus());
  const [histStatus, setHistStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  // 0) Bybit 실시간 청산 연결 시작 (꺼져 있어도 계속 받아둠)
  useEffect(() => {
    startLiq();
    setLiqStatus(getLiqStatus());
    return onLiqStatus(setLiqStatus);
  }, []);

  // 1) 청산 막대 시리즈를 차트에 추가 (지표를 끄면 제거)
  useEffect(() => {
    if (!chart || !enabled) return;
    const opts = {
      priceFormat: { type: 'custom' as const, formatter: compact, minMove: 1 },
      priceLineVisible: false,
      lastValueVisible: false,
    };
    const short = chart.addSeries(HistogramSeries, { ...opts, color: SHORT_COLOR }, paneIndex);
    const long = chart.addSeries(HistogramSeries, { ...opts, color: LONG_COLOR }, paneIndex);
    chart.panes()[paneIndex]?.setHeight(PANE_HEIGHT);
    setSeries({ long, short });

    return () => {
      setSeries(null);
      try {
        chart.removeSeries(short);
        chart.removeSeries(long);
      } catch {
        // 차트가 이미 제거된 경우
      }
    };
  }, [chart, paneIndex, enabled]);

  // 2) 과거(Coinalyze) + 실시간(Bybit)을 봉 단위로 합쳐서 표시
  useEffect(() => {
    if (!series) return;

    const sec = INTERVAL_SEC[interval] ?? 60;
    const bucket = (ms: number) => Math.floor(ms / 1000 / sec) * sec;

    const hist: Record<Side, Map<number, number>> = { long: new Map(), short: new Map() };
    const real: Record<Side, Map<number, number>> = { long: new Map(), short: new Map() };

    // 같은 봉에서 두 출처가 겹치면 큰 값을 사용 (이중 합산 방지)
    const merged = (side: Side, b: number) =>
      Math.max(hist[side].get(b) ?? 0, real[side].get(b) ?? 0);
    const signOf = (side: Side) => (side === 'long' ? LONG_SIGN : SHORT_SIGN);

    const toData = (side: Side) => {
      const times = new Set<number>([...hist[side].keys(), ...real[side].keys()]);
      return Array.from(times)
        .sort((a, b) => a - b)
        .map((t) => ({ time: t as UTCTimestamp, value: signOf(side) * merged(side, t) }));
    };
    const render = () => {
      series.long.setData(toData('long'));
      series.short.setData(toData('short'));
    };

    // 이번 접속 중 쌓인 실시간 청산
    for (const e of getLiqs(symbol)) {
      const b = bucket(e.t);
      real[e.side].set(b, (real[e.side].get(b) ?? 0) + e.usd);
    }
    render();

    // 과거 청산 (캔들 1000개 구간)
    const ctrl = new AbortController();
    setHistStatus('loading');
    const nowSec = Math.floor(Date.now() / 1000);
    const from = Math.floor(nowSec / sec) * sec - 1000 * sec;
    fetchLiqHistory(symbol, interval, from, nowSec, ctrl.signal)
      .then((rows) => {
        if (ctrl.signal.aborted) return;
        for (const r of rows) {
          hist.long.set(r.t, r.long);
          hist.short.set(r.t, r.short);
        }
        render();
        setHistStatus('ok');
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        console.warn('과거 청산 불러오기 실패:', err);
        setHistStatus('error');
      });

    // 이후 실시간 청산
    const off = onLiq((e) => {
      if (e.symbol !== symbol) return;
      const b = bucket(e.t);
      real[e.side].set(b, (real[e.side].get(b) ?? 0) + e.usd);
      try {
        series[e.side].update({
          time: b as UTCTimestamp,
          value: signOf(e.side) * merged(e.side, b),
        });
      } catch {
        render();
      }
    });

    return () => {
      ctrl.abort();
      off();
    };
  }, [series, symbol, interval]);

  // 3) 패널 라벨 위치를 패널 맨 위에 맞춤
  useEffect(() => {
    if (!chart) return;
    const timer = setInterval(() => {
      const label = labelRef.current;
      const panes = chart.panes();
      if (!label || !panes[paneIndex]) return;
      let top = 0;
      for (let i = 0; i < paneIndex; i++) top += panes[i].getHeight() + 1;
      label.style.top = `${top + 4}px`;
      label.style.visibility = 'visible';
    }, 200);
    return () => clearInterval(timer);
  }, [chart, paneIndex]);

  const arrow = (s: number) => (s > 0 ? '▲' : '▼');

  if (!enabled) return null;

  return (
    <div
      ref={labelRef}
      style={{
        position: 'absolute', left: 8, top: 0, visibility: 'hidden',
        zIndex: 2, pointerEvents: 'none', fontSize: 11, color: GRAY,
        display: 'flex', alignItems: 'center', gap: 8,
      }}
    >
      <span
        style={{
          width: 6, height: 6, borderRadius: '50%',
          background: LIQ_STATUS_COLOR[liqStatus],
        }}
      />
      <span>Bybit 청산 (USDT)</span>
      <span style={{ color: LONG_COLOR }}>롱 {arrow(LONG_SIGN)}</span>
      <span style={{ color: SHORT_COLOR }}>숏 {arrow(SHORT_SIGN)}</span>
      {histStatus === 'loading' && <span>과거 불러오는 중…</span>}
      {histStatus === 'error' && <span style={{ color: DOWN }}>과거 불러오기 실패</span>}
    </div>
  );
}