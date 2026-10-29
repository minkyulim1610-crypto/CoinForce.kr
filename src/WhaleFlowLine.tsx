import { useEffect, useRef, useState } from 'react';
import {
  LineSeries,
  LineStyle,
  LineType,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { DOWN, GRAY, INTERVAL_LABEL, INTERVAL_SEC, compact } from './common';
import {
  THRESHOLDS,
  SCALE_EXPONENT,
  BASIS_MIN_SEC,
  BASIS_INTERVAL,
  AUTO_MULTIPLES,
  parseKline,
  referenceRms,
} from './WhalePane';

// ===== 설정 (여기만 고치면 됩니다) =====
const PANE_HEIGHT = 130;
const POS_COLOR = '#4dd0ff'; // 순매수(고래 매수) 쪽
const NEG_COLOR = '#ff8a65'; // 순매도(고래 매도) 쪽
const LINE_NAMES = ['보통', '강함', '가장 강함'];
const POLL_MS = 5000;
// ======================================

type Row = { t: number; net: number };
type Thr = { vals: number[]; fixed: boolean };
type Props = {
  chart: IChartApi | null;
  symbol: string;
  interval: string;
  enabled: boolean;
  paneIndex?: number;
};

const signed = (v: number) => `${v >= 0 ? '+' : ''}${compact(v)}`;

export default function WhaleFlowLine({ chart, symbol, interval, enabled, paneIndex = 3 }: Props) {
  const titleRef = useRef<HTMLDivElement>(null);
  const thrRef = useRef<number[]>([0, 0, 0]);
  const [series, setSeries] = useState<ISeriesApi<'Line'> | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [latest, setLatest] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [thr, setThr] = useState<Thr | null>(null);

  // 1) 선 시리즈를 차트에 추가 (지표를 끄면 제거)
  useEffect(() => {
    if (!chart || !enabled) return;
    const s = chart.addSeries(
      LineSeries,
      {
        color: GRAY,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: 'custom', formatter: compact, minMove: 1 },
        // 보통 기준선이 항상 화면 안에 들어오도록 범위를 넓혀 줌
        
autoscaleInfoProvider: (
  base: () => AutoscaleInfo | null
): AutoscaleInfo | null => {
  const r = base();
  const t = thrRef.current[0] || 0;
  const range = r?.priceRange;

  return {
    priceRange: {
      minValue: Math.min(range?.minValue ?? 0, -t),
      maxValue: Math.max(range?.maxValue ?? 0, t),
    },
    margins: r?.margins,
  };
},

      },
      paneIndex
    );
    chart.panes()[paneIndex]?.setHeight(PANE_HEIGHT);
    s.createPriceLine({
      price: 0,
      color: 'rgba(255, 255, 255, 0.3)',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: false,
      title: '',
    });
    setSeries(s);

    return () => {
      setSeries(null);
      try {
        chart.removeSeries(s);
      } catch {
        // 차트가 이미 제거된 경우
      }
    };
  }, [chart, paneIndex, enabled]);

  // 2) 마우스를 올린 봉의 값
  useEffect(() => {
    if (!chart || !series) return;
    const handler = (param: MouseEventParams<Time>) => {
      const d = param.seriesData.get(series) as { value?: number } | undefined;
      setHover(d && typeof d.value === 'number' ? d.value : null);
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [chart, series]);

  // 3) 바이낸스 캔들에서 순매수 금액을 받아 선으로 표시
  useEffect(() => {
    if (!series) return;

    const chartSec = INTERVAL_SEC[interval] ?? 60;
    const basisSec = Math.max(chartSec, BASIS_MIN_SEC);
    const basis = BASIS_INTERVAL[basisSec];
    if (!basis) return;
    const subs = chartSec < basisSec ? Math.round(basisSec / chartSec) : 1;
    series.applyOptions({ lineType: subs > 1 ? LineType.WithSteps : LineType.Simple });

    // 고래 흐름 패널과 같은 기준 금액
    const baseThr = THRESHOLDS[symbol];
    const scale = Math.pow(basisSec / BASIS_MIN_SEC, SCALE_EXPONENT);
    const fixed = baseThr ? baseThr.map((v) => v * scale) : null;

    let rows: Row[] = [];
    let lines: IPriceLine[] = [];
    let linesKey = '';
    const ctrl = new AbortController();
    const base = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${basis}`;

    const setLines = (vals: number[]) => {
      const key = vals.map(Math.round).join();
      if (key === linesKey) return;
      linesKey = key;
      lines.forEach((l) => series.removePriceLine(l));
      lines = [];
      vals.forEach((v, k) => {
        if (!(v > 0)) return;
        for (const sgn of [1, -1]) {
          lines.push(
            series.createPriceLine({
              price: sgn * v,
              color: sgn > 0 ? POS_COLOR : NEG_COLOR,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: LINE_NAMES[k],
            })
          );
        }
      });
    };

    const render = () => {
      const ref = AUTO_MULTIPLES.map((m) => m * referenceRms(rows));
      const vals = fixed ?? ref;
      thrRef.current = vals;
      setLines(vals);
      setThr((prev) =>
        prev && prev.fixed === !!fixed && prev.vals.map(Math.round).join() === vals.map(Math.round).join()
          ? prev
          : { vals, fixed: !!fixed }
      );

      const nowSec = Math.floor(Date.now() / 1000);
      const data: { time: UTCTimestamp; value: number; color: string }[] = [];
      for (const r of rows) {
        for (let s = 0; s < subs; s++) {
          const time = r.t + s * chartSec;
          if (time > nowSec) break;
          data.push({
            time: time as UTCTimestamp,
            value: r.net,
            color: r.net >= 0 ? POS_COLOR : NEG_COLOR,
          });
        }
      }
      series.setData(data);
      setLatest(rows.length ? rows[rows.length - 1].net : null);
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

    setStatus('loading');
    fetch(`${base}&limit=1000`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((raw) => {
        if (!Array.isArray(raw)) throw new Error('klines 응답 오류');
        rows = raw.map(parseKline);
        render();
        setStatus('ok');
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        console.warn('고래 순매수 값 불러오기 실패:', err);
        setStatus('error');
      });

    const timer = setInterval(async () => {
      if (!rows.length) return;
      try {
        const res = await fetch(`${base}&limit=2`, { signal: ctrl.signal });
        const raw = await res.json();
        if (!Array.isArray(raw)) return;
        raw.map(parseKline).forEach(upsert);
        render();
      } catch {
        // 다음 주기에 다시 시도
      }
    }, POLL_MS);

    return () => {
      ctrl.abort();
      clearInterval(timer);
      lines.forEach((l) => {
        try {
          series.removePriceLine(l);
        } catch {
          // 이미 제거됨
        }
      });
    };
  }, [series, symbol, interval]);

  // 4) 패널 제목 위치를 맞춤
  useEffect(() => {
    if (!chart || !series) return;
    const timer = setInterval(() => {
      const panes = chart.panes();
      if (!panes[paneIndex]) return;
      let top = 0;
      for (let i = 0; i < paneIndex; i++) top += panes[i].getHeight() + 1;
      const title = titleRef.current;
      if (title) {
        title.style.top = `${top + 4}px`;
        title.style.visibility = 'visible';
      }
    }, 200);
    return () => clearInterval(timer);
  }, [chart, series, paneIndex]);

  if (!enabled) return null;

  const basisKey = (INTERVAL_SEC[interval] ?? 60) < BASIS_MIN_SEC ? '5m' : interval;
  const shownValue = hover ?? latest;
  const levelName = (v: number) => {
    if (!thr) return '';
    const a = Math.abs(v);
    let k = -1;
    thr.vals.forEach((t, i) => {
      if (t > 0 && a >= t) k = i;
    });
    return k < 0 ? '기준 미만' : LINE_NAMES[k];
  };

  return (
    <div
      ref={titleRef}
      style={{
        position: 'absolute', left: 8, top: 0, visibility: 'hidden',
        zIndex: 2, pointerEvents: 'none', fontSize: 11, color: GRAY,
        display: 'flex', alignItems: 'center', flexWrap: 'wrap',
        gap: '2px 8px', maxWidth: 'calc(100% - 120px)',
      }}
    >
      <span>고래 순매수 값 (USDT · {INTERVAL_LABEL[basisKey] ?? basisKey} 기준)</span>
      <span style={{ color: POS_COLOR }}>위 = 고래 매수</span>
      <span style={{ color: NEG_COLOR }}>아래 = 고래 매도</span>
      {status === 'loading' && <span>불러오는 중…</span>}
      {status === 'error' && <span style={{ color: DOWN }}>불러오기 실패</span>}
      {shownValue !== null && (
        <span style={{ color: '#d1d4dc' }}>
          {hover !== null ? '선택 봉' : '현재 봉'} {signed(shownValue)} ({levelName(shownValue)})
        </span>
      )}
    </div>
  );
}