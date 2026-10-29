import { useEffect, useRef, useState } from 'react';
import { type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { DOWN, GRAY, INTERVAL_LABEL, INTERVAL_SEC, compact } from './common';
import {
  WhaleBandsView,
  WHALE_SLOTS,
  BUY_CENTER,
  SELL_CENTER,
  type WhaleData,
} from './WhaleBandsSeries';

// ===== 설정 (여기만 고치면 됩니다) =====
const PANE_HEIGHT = 160;

// 강도 기준 금액 (USDT, 5분 순매수 합계): [보통, 강함, 가장 강함]
// 목록에 없는 종목은 자동 기준(평소 변동폭의 1·2·3배)을 사용합니다.
const THRESHOLDS: Record<string, [number, number, number]> = {
  BTCUSDT: [15_000_000, 20_000_000, 30_000_000],
  // ETHUSDT: [30_000, 60_000, 300_000],
  // SOXLUSDT: [5_000, 10_000, 50_000],
};
// 15분봉 이상에서 기준 금액을 키우는 정도 (0 = 그대로, 0.5 = 제곱근, 1 = 봉 길이에 비례)
const SCALE_EXPONENT = 0.5;

// true: 시장가 순매도가 클 때를 '고래 매수'로 봄 (방향이 반대로 보이면 true/false를 바꾸세요)
const FLIP_DIRECTION = false;

const AUTO_MULTIPLES = [1.0, 2.0, 3.0]; // 자동 기준: 평소 변동폭의 몇 배인지
export const MARK_MIN_LEVEL = 2;               // 구간에서 가장 센 봉이 이 단계 이상이면 ▲▼ 표시 (2 = 강함, 4로 두면 끔)
const BASELINE_N = 288;                 // 평소 변동폭을 재는 구간 (봉 개수)
const MIN_SAMPLES = 30;                 // 자동 기준일 때 이 개수가 쌓이기 전에는 신호를 내지 않음
const BASIS_MIN_SEC = 300;              // 계산 기본 단위: 5분
const POLL_MS = 5000;                   // 현재 봉을 갱신하는 주기
const BUY_COLOR = '#2962ff';
const SELL_COLOR = '#d9622b';
const BUY_PEAK_COLOR = '#4dd0ff';  // 구간에서 가장 센 봉 (매수)
const SELL_PEAK_COLOR = '#ff5252'; // 구간에서 가장 센 봉 (매도)
const BUY_MARK_COLOR = '#3db4f2';
const SELL_MARK_COLOR = '#ff6f61';
const ROW_COLOR = 'rgba(156, 163, 175, 0.14)'; // 칸 배경 (회색, 반투명)
const DIVIDER_COLOR = 'rgba(255, 255, 255, 0.25)';
const BUY_LABEL = '#8ab4ff';
const SELL_LABEL = '#ff8a80';
// ======================================

const BASIS_INTERVAL: Record<number, string> = {
  300: '5m', 900: '15m', 3600: '1h', 14400: '4h', 86400: '1d',
};

type Kline = { t: number; net: number }; // t: 시작 시각(초), net: 순매수 금액(USDT)
type Info = { fixed: number[] | null; ref: number[] };
type Props = {
  chart: IChartApi | null;
  symbol: string;
  interval: string;
  enabled: boolean;
  paneIndex?: number;
};

const parseKline = (k: (string | number)[]): Kline => {
  const total = +k[7]; // 거래대금(USDT)
  const buy = +k[10];  // 테이커 매수 거래대금
  const net = 2 * buy - total;
  return { t: (k[0] as number) / 1000, net: FLIP_DIRECTION ? -net : net };
};

// 평소 변동폭 (진행 중인 마지막 봉은 제외)
function referenceRms(rows: Kline[]): number {
  const tail = rows.slice(-BASELINE_N - 1, -1);
  if (tail.length < MIN_SAMPLES) return 0;
  let s = 0;
  for (const r of tail) s += r.net * r.net;
  return Math.sqrt(s / tail.length);
}

// 봉마다 강도를 구함: +1~+3 = 매수, -1~-3 = 매도, 0 = 없음
export function computeLevels(rows: Kline[], fixed: number[] | null): number[] {
  const n = rows.length;
  const out = new Array<number>(n).fill(0);

  // 고정 금액 기준
  if (fixed) {
    for (let i = 0; i < n; i++) {
      const a = Math.abs(rows[i].net);
      let lv = 0;
      for (let k = 0; k < fixed.length; k++) if (a >= fixed[k]) lv = k + 1;
      out[i] = rows[i].net >= 0 ? lv : -lv;
    }
    return out;
  }

  // 자동 기준: 직전 봉들의 변동폭 대비 배수
  const sq = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) sq[i + 1] = sq[i] + rows[i].net * rows[i].net;
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - BASELINE_N);
    const cnt = i - start;
    if (cnt < MIN_SAMPLES) continue;
    const rms = Math.sqrt((sq[i] - sq[start]) / cnt);
    if (rms <= 0) continue;
    const z = rows[i].net / rms;
    const a = Math.abs(z);
    let lv = 0;
    for (let k = 0; k < AUTO_MULTIPLES.length; k++) if (a >= AUTO_MULTIPLES[k]) lv = k + 1;
    out[i] = z >= 0 ? lv : -lv;
  }
  return out;
}

// 연속으로 칠해진 구간마다 순매수(매도) 금액이 가장 큰 봉 하나를 고름
export function findPeaks(rows: Kline[], lv: number[]): boolean[] {
  const peak = new Array<boolean>(rows.length).fill(false);
  let i = 0;
  while (i < rows.length) {
    if (lv[i] === 0) {
      i++;
      continue;
    }
    const sgn = Math.sign(lv[i]);
    let best = i;
    let j = i;
    while (j < rows.length && Math.sign(lv[j]) === sgn) {
      if (Math.abs(rows[j].net) > Math.abs(rows[best].net)) best = j;
      j++;
    }
    peak[best] = true;
    i = j;
  }
  return peak;
}

const labelStyle = (color: string): React.CSSProperties => ({
  position: 'absolute', right: 6, top: 0, visibility: 'hidden',
  zIndex: 2, pointerEvents: 'none', fontSize: 12, fontWeight: 600, color,
});

export default function WhalePane({ chart, symbol, interval, enabled, paneIndex = 2 }: Props) {
  const titleRef = useRef<HTMLDivElement>(null);
  const buyRef = useRef<HTMLDivElement>(null);
  const sellRef = useRef<HTMLDivElement>(null);
  const [series, setSeries] = useState<ISeriesApi<'Custom'> | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [info, setInfo] = useState<Info | null>(null);

  // 1) 패널 시리즈를 차트에 추가 (지표를 끄면 제거)
  useEffect(() => {
    if (!chart || !enabled) return;
    const s = chart.addCustomSeries(
      new WhaleBandsView(),
      {
        buyColor: BUY_COLOR,
        sellColor: SELL_COLOR,
        buyPeakColor: BUY_PEAK_COLOR,
        sellPeakColor: SELL_PEAK_COLOR,
        buyMarkColor: BUY_MARK_COLOR,
        sellMarkColor: SELL_MARK_COLOR,
        rowColor: ROW_COLOR,
        dividerColor: DIVIDER_COLOR,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: 'custom', formatter: () => '', minMove: 0.01 },
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: 0, maxValue: WHALE_SLOTS },
        }),
      },
      paneIndex
    );
    chart.panes()[paneIndex]?.setHeight(PANE_HEIGHT);
    s.priceScale().applyOptions({ scaleMargins: { top: 0.04, bottom: 0.04 } });
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

  // 2) 바이낸스 캔들로 강도를 계산해서 칸을 채움
  useEffect(() => {
    if (!series) return;

    const chartSec = INTERVAL_SEC[interval] ?? 60;
    const basisSec = Math.max(chartSec, BASIS_MIN_SEC);
    const basis = BASIS_INTERVAL[basisSec];
    if (!basis) return;
    const subs = chartSec < basisSec ? Math.round(basisSec / chartSec) : 1;
    const mid = Math.floor(subs / 2);

    // 이 종목과 봉 길이에 적용할 고정 기준 금액 (없으면 자동 기준)
    const baseThr = THRESHOLDS[symbol];
    const scale = Math.pow(basisSec / BASIS_MIN_SEC, SCALE_EXPONENT);
    const fixed = baseThr ? baseThr.map((v) => v * scale) : null;

    let rows: Kline[] = [];
    const ctrl = new AbortController();
    const base = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${basis}`;

    const render = () => {
      const lv = computeLevels(rows, fixed);
      const peak = findPeaks(rows, lv);
      const nowSec = Math.floor(Date.now() / 1000);
      const data: WhaleData[] = [];
      for (let i = 0; i < rows.length; i++) {
        const isBuy = lv[i] > 0;
        const isSell = lv[i] < 0;
        const level = Math.abs(lv[i]);
        for (let s = 0; s < subs; s++) {
          const time = rows[i].t + s * chartSec;
          if (time > nowSec) break;
          const marked = peak[i] && level >= MARK_MIN_LEVEL && s === mid;
          data.push({
            time: time as UTCTimestamp,
            buy: isBuy ? level : 0,
            sell: isSell ? level : 0,
            buyPeak: isBuy && peak[i],
            sellPeak: isSell && peak[i],
            buyMark: isBuy && marked,
            sellMark: isSell && marked,
          });
        }
      }
      series.setData(data);

      // 제목에 표시할 기준 금액 (고정 기준 + 비교용 자동 기준)
      const rms = referenceRms(rows);
      const ref = AUTO_MULTIPLES.map((m) => Math.round(m * rms));
      setInfo((prev) =>
        prev &&
        prev.fixed?.join() === fixed?.join() &&
        prev.ref.join() === ref.join()
          ? prev
          : { fixed, ref }
      );
    };

    const upsert = (k: Kline) => {
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
        console.warn('고래 흐름 불러오기 실패:', err);
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
    };
  }, [series, symbol, interval]);

  // 3) 패널 제목과 오른쪽 라벨 위치를 맞춤
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
      const place = (el: HTMLDivElement | null, value: number) => {
        if (!el) return;
        const y = series.priceToCoordinate(value);
        if (y === null) return;
        el.style.top = `${top + y - 8}px`;
        el.style.visibility = 'visible';
      };
      place(buyRef.current, BUY_CENTER);
      place(sellRef.current, SELL_CENTER);
    }, 200);
    return () => clearInterval(timer);
  }, [chart, series, paneIndex]);

  if (!enabled) return null;

  const basisKey = (INTERVAL_SEC[interval] ?? 60) < BASIS_MIN_SEC ? '5m' : interval;
  const thr = info ? info.fixed ?? info.ref : null;

  return (
    <>
      <div
        ref={titleRef}
        style={{
          position: 'absolute', left: 8, top: 0, visibility: 'hidden',
          zIndex: 2, pointerEvents: 'none', fontSize: 11, color: GRAY,
          display: 'flex', alignItems: 'center', flexWrap: 'wrap',
          gap: '2px 8px', maxWidth: 'calc(100% - 120px)',
        }}
      >
        <span>고래 흐름 (테이커 순매수 · {INTERVAL_LABEL[basisKey] ?? basisKey} 기준)</span>
        <span style={{ color: BUY_COLOR }}>■ 매수</span>
        <span style={{ color: SELL_COLOR }}>■ 매도</span>
        {status === 'loading' && <span>불러오는 중…</span>}
        {status === 'error' && <span style={{ color: DOWN }}>불러오기 실패</span>}
        {thr && (
          <span>
            기준({info?.fixed ? '고정' : '자동'}) 보통 {compact(thr[0])} · 강함 {compact(thr[1])} · 가장 강함 {compact(thr[2])}
          </span>
        )}
        {info && info.fixed && info.ref[0] > 0 && (
          <span>
            참고(평소 변동폭 1·2·3배) {compact(info.ref[0])} · {compact(info.ref[1])} · {compact(info.ref[2])}
          </span>
        )}
      </div>
      <div ref={buyRef} style={labelStyle(BUY_LABEL)}>고래 매수</div>
      <div ref={sellRef} style={labelStyle(SELL_LABEL)}>고래 매도</div>
    </>
  );
}
export { THRESHOLDS, SCALE_EXPONENT, BASIS_MIN_SEC, BASIS_INTERVAL, AUTO_MULTIPLES, parseKline, referenceRms };