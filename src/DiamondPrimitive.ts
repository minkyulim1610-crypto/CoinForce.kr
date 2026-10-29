import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';

export type DiamondMark = {
  time: number;          // 봉 시작 시각(초)
  price: number;         // 매수는 저가, 매도는 고가
  side: 'buy' | 'sell';
  big: boolean;
};

type Scope = {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
};
type Target = { useBitmapCoordinateSpace: <T>(f: (scope: Scope) => T) => T };
type ChartLike = { timeScale(): { timeToCoordinate(time: Time): number | null } };
type SeriesLike = { priceToCoordinate(price: number): number | null };

const GAP = 6; // 봉 끝과 다이아 사이 간격 (px)

class DiamondRenderer implements IPrimitivePaneRenderer {
  private _src: DiamondPrimitive;

  constructor(src: DiamondPrimitive) {
    this._src = src;
  }

  draw(target: Target): void {
    target.useBitmapCoordinateSpace((scope) => {
      const src = this._src;
      if (!src.chart || !src.series || src.marks.length === 0) return;
      const ts = src.chart.timeScale();
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;

      // 봉 한 개의 너비(px): 이웃한 두 봉의 가로 좌표 차이
      let spacing = 8;
      if (src.spacingTimes) {
        const a = ts.timeToCoordinate(src.spacingTimes[0] as Time);
        const b = ts.timeToCoordinate(src.spacingTimes[1] as Time);
        if (a !== null && b !== null && b > a) spacing = b - a;
      }
      const small = Math.max(6, spacing * src.sizeScale); // 작은 다이아의 가로 대각선

      for (const m of src.marks) {
        const x = ts.timeToCoordinate(m.time as Time);
        const y = src.series.priceToCoordinate(m.price);
        if (x === null || y === null) continue;
        const w = m.big ? small * 2 : small; // 큰 다이아는 2배
        const half = w / 2;
        const cy = m.side === 'buy' ? y + GAP + half : y - GAP - half;
        const px = x * hr;
        const py = cy * vr;
        ctx.fillStyle = m.side === 'buy' ? src.buyColor : src.sellColor;
        ctx.beginPath();
        ctx.moveTo(px, py - half * vr);
        ctx.lineTo(px + half * hr, py);
        ctx.lineTo(px, py + half * vr);
        ctx.lineTo(px - half * hr, py);
        ctx.closePath();
        ctx.fill();
      }
    });
  }
}

class DiamondView implements IPrimitivePaneView {
  private _renderer: DiamondRenderer;

  constructor(src: DiamondPrimitive) {
    this._renderer = new DiamondRenderer(src);
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }

  zOrder() {
    return 'top' as const;
  }
}

export class DiamondPrimitive implements ISeriesPrimitive<Time> {
  marks: DiamondMark[] = [];
  spacingTimes: [number, number] | null = null;
  buyColor = '#4DFF00';
  sellColor = '#FF00D0';
  sizeScale = 1;
  chart: ChartLike | null = null;
  series: SeriesLike | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _view: DiamondView;

  constructor() {
    this._view = new DiamondView(this);
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart as unknown as ChartLike;
    this.series = param.series as unknown as SeriesLike;
    this._requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this._requestUpdate = null;
  }

  paneViews() {
    return [this._view];
  }

  setData(
    marks: DiamondMark[],
    spacingTimes: [number, number] | null,
    buyColor: string,
    sellColor: string,
    sizeScale: number
  ) {
    this.marks = marks;
    this.spacingTimes = spacingTimes;
    this.buyColor = buyColor;
    this.sellColor = sellColor;
    this.sizeScale = sizeScale;
    this._requestUpdate?.();
  }
}