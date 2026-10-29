import { useEffect, useRef, useState } from 'react';
import {
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { GRAY } from './common';
import { getCandles } from './candleStore';
import { useCandleTick } from './LineOverlay';
import { rsi } from './indicatorMath';

const PANE_HEIGHT = 130;

type Props = {
  chart: IChartApi | null;
  enabled: boolean;
  paneIndex: number;
  period: number;
  upper: number;
  lower: number;
  color: string;
};

export default function RsiPane({ chart, enabled, paneIndex, period, upper, lower, color }: Props) {
  const titleRef = useRef<HTMLDivElement>(null);
  const [series, setSeries] = useState<ISeriesApi<'Line'> | null>(null);
  const [latest, setLatest] = useState<number | null>(null);
  const tick = useCandleTick();
  const p = Math.max(1, Math.round(period));

  // 1) RSI 선과 기준선(과매수, 과매도, 50)을 하단 패널에 추가
  useEffect(() => {
    if (!chart || !enabled) return;
    const s = chart.addSeries(
      LineSeries,
      {
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        priceFormat: { type: 'custom', formatter: (v: number) => v.toFixed(1), minMove: 0.1 },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      },
      paneIndex
    );
    chart.panes()[paneIndex]?.setHeight(PANE_HEIGHT);
    const line = (price: number, c: string) =>
      s.createPriceLine({
        price,
        color: c,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: '',
      });
    line(upper, 'rgba(239, 83, 80, 0.7)');
    line(lower, 'rgba(38, 166, 154, 0.7)');
    line(50, 'rgba(255, 255, 255, 0.2)');
    setSeries(s);
    return () => {
      setSeries(null);
      try {
        chart.removeSeries(s);
      } catch {
        // 차트가 이미 제거된 경우
      }
    };
  }, [chart, enabled, paneIndex, upper, lower, color]);

  // 2) 계산해서 표시
  useEffect(() => {
    if (!series) return;
    const candles = getCandles();
    const vals = rsi(candles.map((c) => c.close), p);
    const data: { time: UTCTimestamp; value: number }[] = [];
    for (let i = 0; i < candles.length; i++) {
      const v = vals[i];
      if (v !== null) data.push({ time: candles[i].time as UTCTimestamp, value: v });
    }
    series.setData(data);
    setLatest(vals.length ? vals[vals.length - 1] : null);
  }, [series, tick, p]);

  // 3) 패널 제목 위치를 맞춤
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

  const valueColor =
    latest === null ? GRAY : latest >= upper ? '#ef5350' : latest <= lower ? '#26a69a' : '#d1d4dc';

  return (
    <div
      ref={titleRef}
      style={{
        position: 'absolute', left: 8, top: 0, visibility: 'hidden',
        zIndex: 2, pointerEvents: 'none', fontSize: 11, color: GRAY,
        display: 'flex', alignItems: 'center', gap: 8,
      }}
    >
      <span>RSI ({p})</span>
      {latest !== null && <span style={{ color: valueColor }}>{latest.toFixed(1)}</span>}
    </div>
  );
}