import {
  customSeriesDefaultOptions,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesPricePlotValues,
  type CustomSeriesWhitespaceData,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type PaneRendererCustomData,
  type PriceToCoordinateConverter,
  type Time,
} from 'lightweight-charts';

// 아래에서부터 칸 번호
// 0: 매도 마커 자리 / 1~3: 매도 칸(가장 강함 1, 강함 2, 보통 3) / 4: 빈 칸(점선)
// 5~7: 매수 칸(가장 강함 5, 강함 6, 보통 7) / 8: 매수 마커 자리
export const WHALE_SLOTS = 9;
export const ROW_PAD = 0.1;
export const DIVIDER_PRICE = 4.5;
export const BUY_CENTER = 6.5;  // 매수 3칸의 가운데 (라벨 위치)
export const SELL_CENTER = 2.5; // 매도 3칸의 가운데 (라벨 위치)
export const slotOf = (side: 0 | 1, j: number) => (side === 0 ? 7 - j : 3 - j); // side 0 = 매수, 1 = 매도, j 0 = 보통

export interface WhaleData extends CustomData<Time> {
  buy: number;       // 0~3 (0 = 없음, 1 = 보통, 2 = 강함, 3 = 가장 강함)
  sell: number;      // 0~3
  buyPeak: boolean;  // 이 구간에서 가장 센 봉 (매수)
  sellPeak: boolean; // 이 구간에서 가장 센 봉 (매도)
  buyMark: boolean;  // ▲ 마커를 붙일 봉
  sellMark: boolean; // ▼ 마커를 붙일 봉
}

export interface WhaleOptions extends CustomSeriesOptions {
  buyColor: string;
  sellColor: string;
  buyPeakColor: string;
  sellPeakColor: string;
  buyMarkColor: string;
  sellMarkColor: string;
  rowColor: string;
  dividerColor: string;
}

type Scope = {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  bitmapSize: { width: number; height: number };
};
type Target = { useBitmapCoordinateSpace: <T>(f: (scope: Scope) => T) => T };

function triangle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  bottom: number,
  halfW: number,
  up: boolean
) {
  ctx.beginPath();
  if (up) {
    ctx.moveTo(cx, top);
    ctx.lineTo(cx - halfW, bottom);
    ctx.lineTo(cx + halfW, bottom);
  } else {
    ctx.moveTo(cx - halfW, top);
    ctx.lineTo(cx + halfW, top);
    ctx.lineTo(cx, bottom);
  }
  ctx.closePath();
  ctx.fill();
}

class WhaleRenderer implements ICustomSeriesPaneRenderer {
  private _data: PaneRendererCustomData<Time, WhaleData> | null = null;
  private _options: WhaleOptions | null = null;

  update(data: PaneRendererCustomData<Time, WhaleData>, options: WhaleOptions) {
    this._data = data;
    this._options = options;
  }

  draw(target: Target, priceConverter: PriceToCoordinateConverter): void {
    target.useBitmapCoordinateSpace((scope) => {
      const o = this._options;
      if (!o) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const width = scope.bitmapSize.width;

      // 6칸의 세로 위치 계산
      const rows: { y: number; h: number; side: 0 | 1; j: number }[] = [];
      for (const side of [0, 1] as const) {
        for (let j = 0; j < 3; j++) {
          const slot = slotOf(side, j);
          const top = priceConverter(slot + 1 - ROW_PAD);
          const bottom = priceConverter(slot + ROW_PAD);
          if (top === null || bottom === null) continue;
          const y0 = Math.round(top * vr);
          const y1 = Math.round(bottom * vr);
          rows.push({ y: y0, h: Math.max(1, y1 - y0), side, j });
        }
      }

      // 마커(삼각형)가 들어갈 세로 범위
      const mk = (hiPrice: number, loPrice: number) => {
        const a = priceConverter(hiPrice);
        const b = priceConverter(loPrice);
        if (a === null || b === null) return null;
        return { top: Math.round(a * vr), bottom: Math.round(b * vr) };
      };
      const buyMarkY = mk(WHALE_SLOTS - 0.2, WHALE_SLOTS - 1 + 0.2); // 맨 위 자리
      const sellMarkY = mk(1 - 0.2, 0.2);                            // 맨 아래 자리

      // 1) 칸 배경 (회색, 반투명)
      ctx.fillStyle = o.rowColor;
      for (const r of rows) ctx.fillRect(0, r.y, width, r.h);

      // 2) 매수/매도 사이 점선
      const dy = priceConverter(DIVIDER_PRICE);
      if (dy !== null) {
        ctx.save();
        ctx.strokeStyle = o.dividerColor;
        ctx.lineWidth = Math.max(1, Math.round(vr));
        ctx.setLineDash([6 * hr, 4 * hr]);
        const y = Math.round(dy * vr) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.restore();
      }

      // 3) 블록: 봉 폭만큼 꽉 채워서 이웃한 봉과 이어지게 그림
      const d = this._data;
      if (!d || !d.visibleRange) return;
      const half = d.barSpacing / 2;
      for (let i = d.visibleRange.from; i <= d.visibleRange.to; i++) {
        const bar = d.bars[i];
        if (!bar) break;
        const x0 = Math.round((bar.x - half) * hr);
        const x1 = Math.round((bar.x + half) * hr);
        const w = Math.max(1, x1 - x0);
        const { buy, sell, buyPeak, sellPeak, buyMark, sellMark } = bar.originalData;
        for (const r of rows) {
          const level = r.side === 0 ? sell : buy;
          if (level < r.j + 1) continue;
          // 구간에서 가장 센 봉은 맨 위 칸만 밝은 색으로
          const peak = r.j === 0 && (r.side === 0 ? sellPeak : buyPeak);
          ctx.fillStyle =
          r.side === 0
          ? peak ? o.buyPeakColor : o.buyColor
          : peak ? o.sellPeakColor : o.sellColor;
          ctx.fillRect(x0, r.y, w, r.h);
        }

        // 마커
        const cx = bar.x * hr;
        const halfW = 6 * hr;
        if (sellMark && buyMarkY) {
          ctx.fillStyle = o.buyMarkColor;
          triangle(ctx, cx, buyMarkY.top, buyMarkY.bottom, halfW, true);
        }
        if (buyMark && sellMarkY) {
          ctx.fillStyle = o.sellMarkColor;
          triangle(ctx, cx, sellMarkY.top, sellMarkY.bottom, halfW, false);
        }
      }
    });
  }
}

export class WhaleBandsView implements ICustomSeriesPaneView<Time, WhaleData, WhaleOptions> {
  private _renderer = new WhaleRenderer();

  renderer(): ICustomSeriesPaneRenderer {
    return this._renderer;
  }

  update(data: PaneRendererCustomData<Time, WhaleData>, options: WhaleOptions): void {
    this._renderer.update(data, options);
  }

  priceValueBuilder(_plotRow: WhaleData): CustomSeriesPricePlotValues {
    return [0, WHALE_SLOTS, 0];
  }

  isWhitespace(
    data: WhaleData | CustomSeriesWhitespaceData<Time>
  ): data is CustomSeriesWhitespaceData<Time> {
    return (data as Partial<WhaleData>).buy === undefined;
  }

  defaultOptions(): WhaleOptions {
    return {
      ...customSeriesDefaultOptions,
      buyColor: '#2962ff',
      sellColor: '#d9622b',
      buyPeakColor: '#4dd0ff',
      sellPeakColor: '#ff5252',
      buyMarkColor: '#3db4f2',
      sellMarkColor: '#ff6f61',
      rowColor: 'rgba(156, 163, 175, 0.14)',
      dividerColor: 'rgba(255, 255, 255, 0.25)',
    };
  }
}