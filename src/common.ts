// ===== 색상 =====
export const BG = '#121723';
export const UP = '#26a69a';
export const DOWN = '#ef5350';
export const GRAY = '#787b86';

// ===== 타임프레임 (초) =====
export const INTERVAL_SEC: Record<string, number> = {
  '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400,
};

// ===== 시간 (한국 시간, UTC+9) =====
const KST_OFFSET = 9 * 3600;
export const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export const pad = (n: number) => String(n).padStart(2, '0');
export const sign = (n: number) => (n >= 0 ? '+' : '');

export const kst = (t: number) => {
  const d = new Date((t + KST_OFFSET) * 1000);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    wd: d.getUTCDay(),
  };
};

// ===== 숫자 =====
export const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const compact = (v: number) => {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(0)}`;
};

export const fmtRemain = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
};

export const INTERVAL_LABEL: Record<string, string> = {
  '1m': '1분', '5m': '5분', '15m': '15분', '1h': '1시간', '4h': '4시간', '1d': '일',
};