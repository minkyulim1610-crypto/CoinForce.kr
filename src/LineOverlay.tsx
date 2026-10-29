import { useEffect, useRef, useState } from 'react';
import {
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { getCandles, onCandles, type Candle } from './candleStore';

// 캔들이 바뀔 때마다 숫자가 올라가는 값 (너무 자주 계산하지 않게 0.25초로 묶음)
export function useCandleTick(throttleMs = 250): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let timer: number | undefined;
    const off = onCandles(() => {
      if (timer === undefined) {
        timer = window.setTimeout(() => {
          timer = undefined;
          setTick((t) => t + 1);
        }, throttleMs);
      }
    });
    return () => {
      off();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [throttleMs]);
  return tick;
}

export type LineSpec = { color: string; width?: 1 | 2 | 3 | 4; dashed?: boolean };

type Props = {
  chart: IChartApi | null;
  enabled: boolean;
  specs: LineSpec[];
  computeKey: string; // 설정이 바뀌면 다시 계산하기 위한 표시
  compute: (candles: Candle[]) => (number | null)[][];
};

export default function LineOverlay({ chart, enabled, specs, computeKey, compute }: Props) {
  const [series, setSeries] = useState<ISeriesApi<'Line'>[] | null>(null);
  const tick = useCandleTick();
  const computeRef = useRef(compute);
  computeRef.current = compute;
  const specKey = JSON.stringify(specs);

  // 선 시리즈를 캔들 패널(0번)에 추가
  useEffect(() => {
    if (!chart || !enabled || specs.length === 0) return;
    const list = specs.map((sp) =>
      chart.addSeries(
        LineSeries,
        {
          color: sp.color,
          lineWidth: sp.width ?? 1,
          lineStyle: sp.dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        0
      )
    );
    setSeries(list);
    return () => {
      setSeries(null);
      try {
        list.forEach((s) => chart.removeSeries(s));
      } catch {
        // 차트가 이미 제거된 경우
      }
    };
  }, [chart, enabled, specKey]);

  // 계산해서 표시
  useEffect(() => {
    if (!series) return;
    const candles = getCandles();
    const lines = computeRef.current(candles);
    series.forEach((s, k) => {
      const vals = lines[k] ?? [];
      const data: { time: UTCTimestamp; value: number }[] = [];
      for (let i = 0; i < candles.length; i++) {
        const v = vals[i];
        if (v !== null && v !== undefined && Number.isFinite(v)) {
          data.push({ time: candles[i].time as UTCTimestamp, value: v });
        }
      }
      s.setData(data);
    });
  }, [series, tick, computeKey]);

  return null;
}