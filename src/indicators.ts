export type ParamDef =
  | { key: string; label: string; type: 'number'; default: number; min?: number; max?: number; step?: number }
  | { key: string; label: string; type: 'color'; default: string }
  | {
      key: string;
      label: string;
      type: 'select';
      default: string;
      options: { value: string; label: string }[];
    };

export type ParamValues = Record<string, number | string>;

export type IndicatorDef = {
  id: string;
  name: string;
  desc: string;
  tags: string[];
  color: string;
  group: 'onchain' | 'basic'; // onchain = 온체인 데이터 지표
  hidden?: boolean;           // true면 화면 목록에 안 나오고 항상 꺼져 있음 (코드는 유지)
  defaultOn?: boolean;
  params?: ParamDef[];
};

export const GROUP_NAME: Record<IndicatorDef['group'], string> = {
  onchain: '온체인 데이터 지표',
  basic: '기본 지표',
};

export const num = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;
export const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v : d);

const maParams = (
  periods: [number, number, number],
  colors: [string, string, string]
): ParamDef[] => [
  { key: 'period1', label: '기간 1 (0 = 안 씀)', type: 'number', default: periods[0], min: 0, max: 1000 },
  { key: 'color1', label: '색 1', type: 'color', default: colors[0] },
  { key: 'period2', label: '기간 2 (0 = 안 씀)', type: 'number', default: periods[1], min: 0, max: 1000 },
  { key: 'color2', label: '색 2', type: 'color', default: colors[1] },
  { key: 'period3', label: '기간 3 (0 = 안 씀)', type: 'number', default: periods[2], min: 0, max: 1000 },
  { key: 'color3', label: '색 3', type: 'color', default: colors[2] },
];

export const INDICATORS: IndicatorDef[] = [
  // ===== 온체인 데이터 지표 =====
  {
    id: 'liquidation',
    name: '청산량',
    desc: 'Bybit 롱·숏 청산 금액을 봉마다 합산해 아래 패널에 표시',
    tags: ['1분~1일', 'BTC·ETH·SOXL', 'Bybit'],
    color: '#26a69a',
    group: 'onchain',
    defaultOn: true,
  },
  {
    id: 'whale',
    name: '고래 흐름',
    desc: '바이낸스 테이커 순매수·순매도 강도를 보통·강함·가장 강함 3칸으로 표시 (고래 추정)',
    tags: ['1분·5분 기준', '모든 종목', '바이낸스'],
    color: '#2962ff',
    group: 'onchain',
    defaultOn: true,
  },
  {
    id: 'diamond',
    name: '다이아',
    desc: '짧은 봉 반전 다이아',
    tags: ['캔들 위', 'BTC·ETH·SOXL', '청산·고래·볼린저'],
    color: '#4DFF00',
    group: 'onchain',
    defaultOn: true,
    params: [
      { key: 'bbPeriod', label: '볼린저 기간 (봉 개수)', type: 'number', default: 200, min: 1, max: 1000 },
      { key: 'bbMult', label: '볼린저 표준편차', type: 'number', default: 2, min: 0.1, max: 10, step: 0.1 },
      { key: 'qtyBTC', label: '작은 다이아 청산 기준 · BTC (개)', type: 'number', default: 1, min: 0, step: 0.1 },
      { key: 'qtyETH', label: '작은 다이아 청산 기준 · ETH (개, 임시값)', type: 'number', default: 25, min: 0, step: 1 },
      { key: 'qtySOXL', label: '작은 다이아 청산 기준 · SOXL (개, 임시값)', type: 'number', default: 2000, min: 0, step: 10 },
      { key: 'bigMultiple', label: '큰 다이아: 작은 기준의 몇 배', type: 'number', default: 5, min: 1, step: 0.5 },
      { key: 'size', label: '다이아 크기 배율', type: 'number', default: 1, min: 0.3, max: 4, step: 0.1 },
      { key: 'buyColor', label: '매수 다이아 색', type: 'color', default: '#4DFF00' },
      { key: 'sellColor', label: '매도 다이아 색', type: 'color', default: '#FF00D0' },
      {
        key: 'useWhale',
        label: '고래 화살표 조건',
        type: 'select',
        default: 'on',
        options: [
          { value: 'on', label: '사용 (기본)' },
          { value: 'off', label: '사용 안 함 (확인용)' },
        ],
      },
    ],
  },
  {
    // 기준값을 맞출 때 쓰는 비교용 지표. 다시 보고 싶으면 hidden: true 줄을 지우세요.
    id: 'whaleValue',
    name: '고래 순매수 값',
    desc: '고래 흐름의 원래 값(5분 순매수 금액)을 선으로 표시. 기준 금액을 정할 때 비교용',
    tags: ['기준값 조정용', '바이낸스'],
    color: '#4dd0ff',
    group: 'onchain',
    hidden: true,
  },

  // ===== 기본 지표 =====
  {
    id: 'sma',
    name: '이동평균선 (SMA)',
    desc: '종가 기준 단순 이동평균. 선 3개의 기간과 색을 정할 수 있어요',
    tags: ['캔들 위', '모든 종목'],
    color: '#f5a623',
    group: 'basic',
    params: maParams([20, 60, 120], ['#f5a623', '#2962ff', '#e040fb']),
  },
  {
    id: 'ema',
    name: '지수이동평균선 (EMA)',
    desc: '종가 기준 지수 이동평균. 최근 가격에 더 큰 비중을 둬요',
    tags: ['캔들 위', '모든 종목'],
    color: '#42a5f5',
    group: 'basic',
    params: maParams([9, 21, 50], ['#ffd54f', '#42a5f5', '#ba68c8']),
  },
  {
    id: 'vwap',
    name: 'VWAP',
    desc: '거래량 가중 평균 가격. 기본은 매일 한국 시간 09:00에 다시 시작해요',
    tags: ['캔들 위', '모든 종목'],
    color: '#ff9800',
    group: 'basic',
    params: [
      {
        key: 'reset',
        label: '리셋',
        type: 'select',
        default: 'daily',
        options: [
          { value: 'daily', label: '매일 09:00 (한국 시간)' },
          { value: 'none', label: '리셋 안 함' },
        ],
      },
      { key: 'color', label: '색', type: 'color', default: '#ff9800' },
    ],
  },
  {
    id: 'bollinger',
    name: '볼린저 밴드',
    desc: '종가 기준 이동평균 ± 표준편차 × 배수. 기간은 봉 개수예요',
    tags: ['캔들 위', '모든 종목'],
    color: '#42a5f5',
    group: 'basic',
    params: [
      { key: 'period', label: '기간 (봉 개수)', type: 'number', default: 200, min: 1, max: 1000 },
      { key: 'mult', label: '표준편차 배수', type: 'number', default: 2, min: 0.1, max: 10, step: 0.1 },
      { key: 'bandColor', label: '상단·하단 색', type: 'color', default: '#42a5f5' },
      { key: 'midColor', label: '중심선 색', type: 'color', default: '#9e9e9e' },
    ],
  },
  {
    id: 'rsi',
    name: 'RSI',
    desc: '상대강도지수. 아래 패널에 0~100 선으로 표시해요',
    tags: ['하단 패널', '모든 종목'],
    color: '#b388ff',
    group: 'basic',
    params: [
      { key: 'period', label: '기간', type: 'number', default: 14, min: 1, max: 200 },
      { key: 'upper', label: '과매수 기준', type: 'number', default: 70, min: 50, max: 100 },
      { key: 'lower', label: '과매도 기준', type: 'number', default: 30, min: 0, max: 50 },
      { key: 'color', label: '선 색', type: 'color', default: '#b388ff' },
    ],
  },
];

// ===== 켜짐 상태와 설정값 기본값 / 저장 =====
export function defaultEnabled(): Record<string, boolean> {
  return Object.fromEntries(
    INDICATORS.map((i) => [i.id, i.hidden ? false : !!i.defaultOn])
  );
}

export function defaultSettings(): Record<string, ParamValues> {
  const out: Record<string, ParamValues> = {};
  for (const ind of INDICATORS) {
    const p: ParamValues = {};
    for (const d of ind.params ?? []) p[d.key] = d.default;
    out[ind.id] = p;
  }
  return out;
}

const STORAGE_KEY = 'chart-indicators-v1';

export function loadState() {
  const enabled = defaultEnabled();
  const settings = defaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const ind of INDICATORS) {
        if (!ind.hidden && typeof saved?.enabled?.[ind.id] === 'boolean') {
          enabled[ind.id] = saved.enabled[ind.id];
        }
        for (const d of ind.params ?? []) {
          const v = saved?.settings?.[ind.id]?.[d.key];
          if (typeof v === typeof d.default) settings[ind.id][d.key] = v;
        }
      }
    }
  } catch {
    // 저장된 값을 읽지 못하면 기본값 사용
  }
  return { enabled, settings };
}

export function saveState(enabled: Record<string, boolean>, settings: Record<string, ParamValues>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, settings }));
  } catch {
    // 저장 실패는 무시
  }
}