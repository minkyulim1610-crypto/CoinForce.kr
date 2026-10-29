import { useEffect, useRef, useState } from 'react';
import type { IChartApi } from 'lightweight-charts';
import { getCandles } from './candleStore';
import { useCandleTick } from './LineOverlay';
import { bollinger } from './indicatorMath';
import { useLiqBuckets } from './liqBuckets';
import { useWhaleArrows } from './whaleArrows';
import { DiamondPrimitive, type DiamondMark } from './DiamondPrimitive';
import { num, str, type ParamValues } from './indicators';

type Props = {
  chart: IChartApi | null;
  symbol: string;
  interval: string;
  enabled: boolean;
  params: ParamValues;
};

// 종목별 '작은 다이아' 청산 기준(개수) 설정 이름
const qtyKeyOf = (symbol: string) =>
  symbol.startsWith('BTC') ? 'qtyBTC' : symbol.startsWith('ETH') ? 'qtyETH' : 'qtySOXL';

export default function DiamondOverlay({ chart, symbol, interval, enabled, params }: Props) {
  const primRef = useRef<DiamondPrimitive | null>(null);
  const [ready, setReady] = useState(false);
  const tick = useCandleTick();
  const useWhale = str(params.useWhale, 'on') === 'on';
  const liq = useLiqBuckets(symbol, interval, enabled);
  const whale = useWhaleArrows(symbol, interval, enabled && useWhale);
  const paramKey = JSON.stringify(params);

  // 1) 캔들 시리즈에 다이아를 그리는 도구를 붙임
  useEffect(() => {
    if (!chart || !enabled) return;
    const candle = chart
      .panes()[0]
      ?.getSeries()
      .find((s) => s.seriesType() === 'Candlestick');
    if (!candle) {
      console.warn('다이아: 캔들 시리즈를 찾지 못했어요');
      return;
    }
    const prim = new DiamondPrimitive();
    candle.attachPrimitive(prim);
    primRef.current = prim;
    setReady(true);
    return () => {
      setReady(false);
      primRef.current = null;
      try {
        candle.detachPrimitive(prim);
      } catch {
        // 차트가 이미 제거된 경우
      }
    };
  }, [chart, enabled]);

  // 2) 조건을 판정해서 다이아 위치를 갱신
  useEffect(() => {
    const prim = primRef.current;
    if (!ready || !prim) return;

    const candles = getCandles();
    const period = Math.max(1, Math.round(num(params.bbPeriod, 200)));
    const mult = num(params.bbMult, 2);
    const small = Math.max(0, num(params[qtyKeyOf(symbol)], 1));
    const big = small * Math.max(1, num(params.bigMultiple, 5));
    const [upper, , lower] = bollinger(candles.map((c) => c.close), period, mult);

    const marks: DiamondMark[] = [];
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const arrow = whale.marksRef.current.get(c.time);
      const lo = lower[i];
      const up = upper[i];

      // 매수 다이아: 저가 ≤ 볼린저 하단선, 롱 청산 개수 ≥ 기준, 고래 흐름에 ▼
      if (lo !== null && c.low <= lo && (!useWhale || arrow === 'sell')) {
        const qty = (liq.longRef.current.get(c.time) ?? 0) / c.close;
        if (qty > 0 && qty >= small) {
          marks.push({ time: c.time, price: c.low, side: 'buy', big: qty >= big });
        }
      }

      // 매도 다이아: 고가 ≥ 볼린저 상단선, 숏 청산 개수 ≥ 기준, 고래 흐름에 ▲
      if (up !== null && c.high >= up && (!useWhale || arrow === 'buy')) {
        const qty = (liq.shortRef.current.get(c.time) ?? 0) / c.close;
        if (qty > 0 && qty >= small) {
          marks.push({ time: c.time, price: c.high, side: 'sell', big: qty >= big });
        }
      }
    }

    const n = candles.length;
    prim.setData(
      marks,
      n >= 2 ? [candles[n - 2].time, candles[n - 1].time] : null,
      str(params.buyColor, '#4DFF00'),
      str(params.sellColor, '#FF00D0'),
      num(params.size, 1)
    );
  }, [ready, tick, liq.version, whale.version, paramKey, symbol, interval]);

  return null;
}