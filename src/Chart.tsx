import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  createChart,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  PriceScaleMode,
  TickMarkType,
  type ChartOptions,
  type DeepPartial,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import LiquidationPane from './LiquidationPane';
import WhalePane from './WhalePane';
import WhaleFlowLine from './WhaleFlowLine';
import RsiPane from './RsiPane';
import DiamondOverlay from './DiamondOverlay';
import { SmaOverlay, EmaOverlay, BollingerOverlay, VwapOverlay } from './BasicOverlays';
import { setCandles, upsertCandle } from './candleStore';
import { num, str, type ParamValues } from './indicators';
import {
  BG, UP, DOWN, GRAY, WEEK, INTERVAL_LABEL,
  pad, sign, fmt, kst, fmtRemain,
} from './common';

// ===== 설정 (여기만 고치면 됩니다) =====
const CHART_OPTIONS: DeepPartial<ChartOptions> = {
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid, color: BG },
    textColor: '#d1d4dc',
  },
  grid: {
    vertLines: { color: 'rgba(255, 255, 255, 0.05)', style: LineStyle.Solid },
    horzLines: { color: 'rgba(255, 255, 255, 0.05)', style: LineStyle.Solid },
  },
  localization: {
    priceFormatter: (p: number) => fmt(p),
    timeFormatter: (t: Time) => {
      const x = kst(t as number);
      return `${x.y}-${pad(x.mo)}-${pad(x.d)} (${WEEK[x.wd]}) ${pad(x.h)}:${pad(x.mi)}`;
    },
  },
  timeScale: {
    timeVisible: true,
    secondsVisible: false,
    tickMarkFormatter: (t: Time, type: TickMarkType) => {
      const x = kst(t as number);
      switch (type) {
        case TickMarkType.Year: return `${x.y}`;
        case TickMarkType.Month: return `${x.mo}월`;
        case TickMarkType.DayOfMonth: return `${x.d}`;
        default: return `${pad(x.h)}:${pad(x.mi)}`;
      }
    },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: {
      color: 'rgba(255, 255, 255, 0.3)',
      width: 1,
      style: LineStyle.Dashed,
      labelBackgroundColor: '#363a45',
    },
    horzLine: {
      color: 'rgba(255, 255, 255, 0.3)',
      width: 1,
      style: LineStyle.Dashed,
      labelVisible: false, // 가격 라벨은 아래에서 직접 그림 (% + 가격)
    },
  },
};
// ======================================

type Status = 'loading' | 'connecting' | 'live' | 'error';
type Props = {
  symbol: string;
  interval: string;
  toolbar?: ReactNode;                       // 헤더 아래에 표시할 툴바 (종목/시간 버튼)
  enabled: Record<string, boolean>;          // 지표별 켜짐 상태
  settings: Record<string, ParamValues>;     // 지표별 설정값
};
type Bar = {
  time: UTCTimestamp;
  open: number; high: number; low: number; close: number;
  volume: number;
};
type Ohlc = { o: number; h: number; l: number; c: number; pct: number };
type Live = { price: number; pct24: number | null };

const STATUS_COLOR: Record<Status, string> = {
  loading: '#f5a623',
  connecting: '#f5a623',
  live: UP,
  error: DOWN,
};

const toCandle = (k: (string | number)[]): Bar => ({
  time: ((k[0] as number) / 1000) as UTCTimestamp,
  open: +k[1], high: +k[2], low: +k[3], close: +k[4],
  volume: +k[5],
});

const toStore = (b: Bar) => ({
  time: b.time as number,
  open: b.open, high: b.high, low: b.low, close: b.close,
  volume: b.volume,
});

const makeOhlc = (b: Bar, prevClose: number): Ohlc => ({
  o: b.open, h: b.high, l: b.low, c: b.close,
  pct: prevClose ? ((b.close - prevClose) / prevClose) * 100 : 0,
});

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span>
      <span style={{ color: GRAY }}>{label} </span>
      <span style={{ color }}>{value}</span>
    </span>
  );
}

export default function Chart({ symbol, interval, toolbar, enabled, settings }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lastBarRef = useRef<Bar | null>(null);
  const lastCloseMsRef = useRef(0);
  const barsRef = useRef<Bar[]>([]);
  const indexRef = useRef<Map<number, number>>(new Map());
  const hoverTimeRef = useRef<number | null>(null);

  const pillRef = useRef<HTMLDivElement>(null);
  const pillPctRef = useRef<HTMLSpanElement>(null);
  const pillPriceRef = useRef<HTMLSpanElement>(null);
  const countdownRef = useRef<HTMLDivElement>(null);
  const scaleBoxRef = useRef<HTMLDivElement>(null);

  const [chart, setChart] = useState<IChartApi | null>(null); // 지표들에 넘겨줌
  const [status, setStatus] = useState<Status>('loading');
  const [live, setLive] = useState<Live | null>(null);
  const [lastOhlc, setLastOhlc] = useState<Ohlc | null>(null);
  const [hover, setHover] = useState<Ohlc | null>(null);
  const [scaleState, setScaleState] = useState({ auto: true, log: false });

  // 1) 차트는 한 번만 생성
  useEffect(() => {
    const chart = createChart(boxRef.current!, CHART_OPTIONS);
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN,
      borderUpColor: UP, borderDownColor: DOWN,
      wickUpColor: UP, wickDownColor: DOWN,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    setChart(chart);

    chart.subscribeCrosshairMove((param) => {
      // 가격 라벨 (% + 가격) - 캔들 패널 안에서만 표시
      const pill = pillRef.current;
      const pctEl = pillPctRef.current;
      const priceEl = pillPriceRef.current;
      if (pill && pctEl && priceEl) {
        const y = param.point?.y;
        const pane0H = chart.panes()[0]?.getHeight() ?? Infinity;
        const price = y !== undefined && y <= pane0H ? series.coordinateToPrice(y) : null;
        const base = lastBarRef.current?.close;
        if (y === undefined || price === null || !base) {
          pill.style.display = 'none';
        } else {
          const pct = ((price - base) / base) * 100;
          pill.style.display = 'flex';
          pill.style.transform = `translateY(${y - 11}px)`;
          pctEl.textContent = `${sign(pct)}${pct.toFixed(2)}%`;
          pctEl.style.color = pct >= 0 ? UP : DOWN;
          priceEl.textContent = fmt(price);
        }
      }

      // 차트 왼쪽 위 정보줄: 마우스가 올라간 봉의 시고저종
      const t = param.time as number | undefined;
      if (t === undefined) {
        if (hoverTimeRef.current !== null) {
          hoverTimeRef.current = null;
          setHover(null);
        }
        return;
      }
      if (hoverTimeRef.current === t) return;
      const i = indexRef.current.get(t);
      if (i === undefined) return;
      hoverTimeRef.current = t;
      const bars = barsRef.current;
      setHover(makeOhlc(bars[i], i > 0 ? bars[i - 1].close : bars[i].open));
    });

    // 남은 시간 · A/L 버튼 위치 · 스케일 상태를 0.1초마다 갱신
    const timer = setInterval(() => {
      const ps = chart.priceScale('right');
      const w = ps.width();
      const th = chart.timeScale().height();
      const boxH = boxRef.current?.clientHeight ?? 0;
      const pane0H = chart.panes()[0]?.getHeight() || boxH - th;

      if (scaleBoxRef.current) {
        scaleBoxRef.current.style.width = `${w}px`;
        scaleBoxRef.current.style.height = `${th}px`;
      }

      const cd = countdownRef.current;
      const bar = lastBarRef.current;
      if (cd) {
        const y = bar ? series.priceToCoordinate(bar.close) : null;
        if (bar && y !== null && y > 12 && y < pane0H - 24) {
          cd.style.display = 'block';
          cd.style.width = `${w}px`;
          cd.style.transform = `translateY(${y + 10}px)`;
          cd.style.background = bar.close >= bar.open ? UP : DOWN;
          cd.textContent = fmtRemain(lastCloseMsRef.current + 1 - Date.now());
        } else {
          cd.style.display = 'none';
        }
      }

      const o = ps.options();
      const auto = o.autoScale;
      const log = o.mode === PriceScaleMode.Logarithmic;
      setScaleState((p) => (p.auto === auto && p.log === log ? p : { auto, log }));
    }, 100);

    return () => {
      clearInterval(timer);
      setChart(null);
      chart.remove();
    };
  }, []);

  // 2) 심볼/타임프레임이 바뀌면 캔들 데이터와 웹소켓만 교체
  useEffect(() => {
    let ws: WebSocket | undefined;
    let cancelled = false;
    let isLive = false;
    let raf = 0;

    lastBarRef.current = null;
    barsRef.current = [];
    indexRef.current = new Map();
    hoverTimeRef.current = null;
    setCandles([]);
    setStatus('loading');
    setLive(null);
    setLastOhlc(null);
    setHover(null);

    const syncBars = (bar: Bar) => {
      const bars = barsRef.current;
      const last = bars[bars.length - 1];
      if (last && last.time === bar.time) {
        bars[bars.length - 1] = { ...bar };
      } else if (!last || bar.time > last.time) {
        bars.push({ ...bar });
        indexRef.current.set(bar.time, bars.length - 1);
      }
    };

    const pushInfo = (bar: Bar) => {
      const bars = barsRef.current;
      const prevClose = bars.length >= 2 ? bars[bars.length - 2].close : bar.open;
      const next = makeOhlc(bar, prevClose);
      setLastOhlc((p) =>
        p && p.o === next.o && p.h === next.h && p.l === next.l && p.c === next.c ? p : next
      );
      setLive((l) =>
        l && l.price === bar.close ? l : { price: bar.close, pct24: l ? l.pct24 : null }
      );
    };

    const flush = () => {
      raf = 0;
      const bar = lastBarRef.current;
      if (cancelled || !bar) return;
      seriesRef.current?.update(bar);
      syncBars(bar);
      pushInfo(bar);
      upsertCandle(toStore(bar));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(flush);
    };

    (async () => {
      try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=1000`;
        const raw = await (await fetch(url)).json();
        if (cancelled) return;
        const bars: Bar[] = raw.map(toCandle);
        seriesRef.current?.setData(bars);
        barsRef.current = bars;
        indexRef.current = new Map(bars.map((b, i) => [b.time as number, i]));
        lastBarRef.current = { ...bars[bars.length - 1] };
        lastCloseMsRef.current = raw[raw.length - 1][6];
        pushInfo(lastBarRef.current);
        setCandles(bars.map(toStore));
        setStatus('connecting');

        const s = symbol.toLowerCase();
        ws = new WebSocket(
          `wss://fstream.binance.com/market/stream?streams=${s}@kline_${interval}/${s}@aggTrade/${s}@miniTicker`
        );
        ws.onerror = () => setStatus('error');
        ws.onclose = () => {
          if (!cancelled) setStatus('error');
        };
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data).data;
          if (!isLive) {
            isLive = true;
            setStatus('live');
          }

          if (m.e === 'kline') {
            const k = m.k;
            lastBarRef.current = {
              time: (k.t / 1000) as UTCTimestamp,
              open: +k.o, high: +k.h, low: +k.l, close: +k.c,
              volume: +k.v,
            };
            lastCloseMsRef.current = k.T;
            schedule();
          } else if (m.e === 'aggTrade') {
            const bar = lastBarRef.current;
            if (!bar || m.T > lastCloseMsRef.current) return;
            const p = +m.p;
            bar.high = Math.max(bar.high, p);
            bar.low = Math.min(bar.low, p);
            bar.close = p;
            bar.volume += +m.q;
            schedule();
          } else if (m.e === '24hrMiniTicker') {
            const pct24 = ((+m.c - +m.o) / +m.o) * 100;
            setLive((l) => (l ? { ...l, pct24 } : l));
          }
        };
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      ws?.close();
    };
  }, [symbol, interval]);

  const toggleAuto = () => {
    const ps = chartRef.current?.priceScale('right');
    if (ps) ps.applyOptions({ autoScale: !ps.options().autoScale });
  };
  const toggleLog = () => {
    const ps = chartRef.current?.priceScale('right');
    if (!ps) return;
    ps.applyOptions({
      mode:
        ps.options().mode === PriceScaleMode.Logarithmic
          ? PriceScaleMode.Normal
          : PriceScaleMode.Logarithmic,
    });
  };

  const scaleBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    fontSize: 12,
    background: active ? '#2a2e39' : 'transparent',
    color: active ? '#fff' : GRAY,
    fontWeight: active ? 700 : 400,
  });

  const shown = hover ?? lastOhlc;
  const dir = shown ? (shown.c >= shown.o ? UP : DOWN) : GRAY;
  const color = STATUS_COLOR[status];
  const base = symbol.replace('USDT', '');

  // 지표별 켜짐 상태와 설정값
  const on = (id: string) => !!enabled[id];
  const prm = (id: string): ParamValues => settings[id] ?? {};

  // 아래 패널 번호: 켜져 있는 패널만 위에서부터 차례로 붙음 (0은 캔들)
  const liqIndex = 1;
  const whaleIndex = liqIndex + (on('liquidation') ? 1 : 0);
  const flowIndex = whaleIndex + (on('whale') ? 1 : 0);
  const rsiIndex = flowIndex + (on('whaleValue') ? 1 : 0);

  return (
    <div style={{ background: BG, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes live-pulse {
          0%   { transform: scale(1);   opacity: 0.6; }
          100% { transform: scale(2.8); opacity: 0; }
        }
      `}</style>

      {/* 맨 위 헤더: 종목 · 현재가 · 24시간 등락률 */}
      <div
        style={{
          display: 'flex', alignItems: 'baseline', flexWrap: 'wrap',
          gap: '2px 12px', padding: '8px 12px', color: '#d1d4dc',
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{base}</span>
        <span style={{ fontSize: 12, color: GRAY }}>USDT 무기한</span>
        <span style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>
          {live ? fmt(live.price) : '--'}
        </span>
        {live && live.pct24 !== null && (
          <span style={{ fontSize: 14, fontWeight: 600, color: live.pct24 >= 0 ? UP : DOWN }}>
            {sign(live.pct24)}{live.pct24.toFixed(2)}%
          </span>
        )}
      </div>

      {/* 툴바 (종목 / 시간 버튼 / 지표 버튼) */}
      {toolbar}

      {/* 차트 영역: 남은 공간을 전부 사용 */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={boxRef} style={{ position: 'absolute', inset: 0 }} />

        {/* 차트 왼쪽 위: 연결 상태 점 + 시/고/저/종 */}
        <div
          style={{
            position: 'absolute', top: 8, left: 10, zIndex: 2, pointerEvents: 'none',
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: '2px 10px', fontSize: 12, maxWidth: 'calc(100% - 110px)',
          }}
        >
          <span style={{ color: GRAY }}>
            {base} · {INTERVAL_LABEL[interval] ?? interval}
          </span>
          <span style={{ position: 'relative', width: 10, height: 10, display: 'inline-block' }}>
            {status === 'live' && (
              <span
                style={{
                  position: 'absolute', inset: 0, borderRadius: '50%',
                  background: color,
                  animation: 'live-pulse 1.8s ease-out infinite',
                }}
              />
            )}
            <span
              style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: color }}
            />
          </span>
          {shown && (
            <>
              <Stat label="시" value={fmt(shown.o)} color={dir} />
              <Stat label="고" value={fmt(shown.h)} color={dir} />
              <Stat label="저" value={fmt(shown.l)} color={dir} />
              <Stat label="종" value={fmt(shown.c)} color={dir} />
              <span style={{ color: shown.pct >= 0 ? UP : DOWN }}>
                {sign(shown.pct)}{shown.pct.toFixed(2)}%
              </span>
            </>
          )}
        </div>

        {/* 캔들 위에 표시하는 기본 지표들 */}
        <SmaOverlay chart={chart} enabled={on('sma')} params={prm('sma')} />
        <EmaOverlay chart={chart} enabled={on('ema')} params={prm('ema')} />
        <VwapOverlay chart={chart} enabled={on('vwap')} params={prm('vwap')} />
        <BollingerOverlay chart={chart} enabled={on('bollinger')} params={prm('bollinger')} />
        <DiamondOverlay
          chart={chart}
          symbol={symbol}
          interval={interval}
          enabled={on('diamond')}
          params={prm('diamond')}
        />

        {/* 아래 지표 패널들 - 각각 별도 파일 */}
        <LiquidationPane
          chart={chart}
          symbol={symbol}
          interval={interval}
          enabled={on('liquidation')}
          paneIndex={liqIndex}
        />
        <WhalePane
          chart={chart}
          symbol={symbol}
          interval={interval}
          enabled={on('whale')}
          paneIndex={whaleIndex}
        />
        <WhaleFlowLine
          chart={chart}
          symbol={symbol}
          interval={interval}
          enabled={on('whaleValue')}
          paneIndex={flowIndex}
        />
        <RsiPane
          chart={chart}
          enabled={on('rsi')}
          paneIndex={rsiIndex}
          period={num(prm('rsi').period, 14)}
          upper={num(prm('rsi').upper, 70)}
          lower={num(prm('rsi').lower, 30)}
          color={str(prm('rsi').color, '#b388ff')}
        />

        {/* 크로스헤어 가격 라벨 (% + 가격) */}
        <div
          ref={pillRef}
          style={{
            position: 'absolute', top: 0, right: 0, display: 'none',
            zIndex: 3, pointerEvents: 'none', height: 22,
            fontSize: 12, fontWeight: 600, borderRadius: 3, overflow: 'hidden',
          }}
        >
          <span
            ref={pillPctRef}
            style={{ background: '#2a2e39', padding: '0 8px', lineHeight: '22px' }}
          />
          <span
            ref={pillPriceRef}
            style={{ background: '#434651', color: '#fff', padding: '0 8px', lineHeight: '22px' }}
          />
        </div>

        {/* 현재가 아래 봉 남은 시간 */}
        <div
          ref={countdownRef}
          style={{
            position: 'absolute', top: 0, right: 0, display: 'none',
            zIndex: 2, pointerEvents: 'none', textAlign: 'center',
            color: '#fff', fontSize: 11, fontWeight: 600, lineHeight: '18px',
          }}
        />

        {/* 가격축 하단 A / L 버튼 */}
        <div
          ref={scaleBoxRef}
          style={{ position: 'absolute', right: 0, bottom: 0, width: 70, height: 26, display: 'flex', zIndex: 3 }}
        >
          <button style={scaleBtn(scaleState.auto)} onClick={toggleAuto}>A</button>
          <button style={scaleBtn(scaleState.log)} onClick={toggleLog}>L</button>
        </div>
      </div>
    </div>
  );
}