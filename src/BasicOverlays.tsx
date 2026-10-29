import type { IChartApi } from 'lightweight-charts';
import LineOverlay from './LineOverlay';
import { sma, ema, bollinger, vwap } from './indicatorMath';
import { num, str, type ParamValues } from './indicators';

type P = { chart: IChartApi | null; enabled: boolean; params: ParamValues };

// 기간 3개 + 색 3개로 이동평균선을 그림 (기간 0이면 사용 안 함)
function maLines(params: ParamValues) {
  return [1, 2, 3]
    .map((i) => ({
      period: Math.round(num(params[`period${i}`], 0)),
      color: str(params[`color${i}`], '#ffffff'),
    }))
    .filter((l) => l.period >= 1);
}

export function SmaOverlay({ chart, enabled, params }: P) {
  const lines = maLines(params);
  return (
    <LineOverlay
      chart={chart}
      enabled={enabled}
      specs={lines.map((l) => ({ color: l.color }))}
      computeKey={JSON.stringify(lines)}
      compute={(c) => {
        const closes = c.map((x) => x.close);
        return lines.map((l) => sma(closes, l.period));
      }}
    />
  );
}

export function EmaOverlay({ chart, enabled, params }: P) {
  const lines = maLines(params);
  return (
    <LineOverlay
      chart={chart}
      enabled={enabled}
      specs={lines.map((l) => ({ color: l.color }))}
      computeKey={JSON.stringify(lines)}
      compute={(c) => {
        const closes = c.map((x) => x.close);
        return lines.map((l) => ema(closes, l.period));
      }}
    />
  );
}

export function BollingerOverlay({ chart, enabled, params }: P) {
  const period = Math.max(1, Math.round(num(params.period, 200)));
  const mult = num(params.mult, 2);
  const band = str(params.bandColor, '#42a5f5');
  const mid = str(params.midColor, '#9e9e9e');
  return (
    <LineOverlay
      chart={chart}
      enabled={enabled}
      specs={[{ color: band }, { color: mid, dashed: true }, { color: band }]}
      computeKey={`${period}|${mult}`}
      compute={(c) => bollinger(c.map((x) => x.close), period, mult)}
    />
  );
}

export function VwapOverlay({ chart, enabled, params }: P) {
  const daily = str(params.reset, 'daily') === 'daily';
  const color = str(params.color, '#ff9800');
  return (
    <LineOverlay
      chart={chart}
      enabled={enabled}
      specs={[{ color, width: 2 }]}
      computeKey={String(daily)}
      compute={(c) => [vwap(c, daily)]}
    />
  );
}