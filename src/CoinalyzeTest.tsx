import { useState } from 'react';

const WANT = ['BTC', 'ETH', 'SOXL'];

type Market = {
  symbol: string;
  exchange: string;
  symbol_on_exchange: string;
  base_asset: string;
  quote_asset: string;
  is_perpetual: boolean;
  oi_lq_vol_denominated_in: string;
};
type Point = { t: number; l: number; s: number };

const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(a / 1e3).toFixed(1)}K`;
  return a.toFixed(0);
};
const kstTime = (sec: number) =>
  new Date(sec * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

export default function CoinalyzeTest() {
  const [proxy, setProxy] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const add = (s: string) => setLog((p) => [...p, s]);

  const get = async (path: string, params: Record<string, string> = {}) => {
    const base = proxy.trim().replace(/\/$/, '');
    const res = await fetch(`${base}${path}?${new URLSearchParams(params)}`);
    if (res.status === 429) {
      throw new Error(`요청 제한(429): ${res.headers.get('Retry-After')}초 후 다시 시도`);
    }
    if (res.status === 401) throw new Error('Worker에 저장한 API 키가 잘못됐거나 없음(401)');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  const run = async () => {
    if (!proxy.trim()) {
      setLog(['Worker 주소를 먼저 입력하세요']);
      return;
    }
    setBusy(true);
    setLog([]);
    try {
      // 1) Bybit 코드 찾기
      const exchanges: { name: string; code: string }[] = await get('/exchanges');
      const bybit = exchanges.find((e) => e.name.toLowerCase().includes('bybit'));
      if (!bybit) {
        add('거래소 목록에서 Bybit를 찾지 못함');
        return;
      }
      add(`Bybit 코드: ${bybit.code}`);

      // 2) Bybit의 BTC/ETH/SOXL USDT 무기한 선물 찾기
      const markets: Market[] = await get('/future-markets');
      const bybitAll = markets.filter(
        (m) => m.exchange === bybit.code || m.exchange === bybit.name
      );
      add(`Bybit 선물 시장 ${bybitAll.length}개 / 전체 ${markets.length}개`);

      const mine = bybitAll.filter(
        (m) => m.is_perpetual && m.quote_asset === 'USDT' && WANT.includes(m.base_asset)
      );
      for (const coin of WANT) {
        const found = mine.filter((m) => m.base_asset === coin);
        if (found.length === 0) add(`${coin}: Bybit USDT 무기한 목록에 없음`);
        for (const m of found) {
          add(`${coin}: ${m.symbol} (거래소 표기 ${m.symbol_on_exchange}, 단위 ${m.oi_lq_vol_denominated_in})`);
        }
      }

      // 3) 종목별 청산 이력 조회 (1분 3일치 / 5분 14일치 요청 → 실제로 오는 범위 확인)
      const now = Math.floor(Date.now() / 1000);
      const tests = [
        { interval: '1min', label: '1분', from: now - 3 * 86400 },
        { interval: '5min', label: '5분', from: now - 14 * 86400 },
      ];
      for (const m of mine) {
        for (const t of tests) {
          const data = await get('/liquidation-history', {
            symbols: m.symbol,
            interval: t.interval,
            from: String(t.from),
            to: String(now),
            convert_to_usd: 'true',
          });
          const h: Point[] = data?.[0]?.history ?? [];
          if (h.length === 0) {
            add(`${m.base_asset} ${t.label}: 데이터 없음`);
            continue;
          }
          const sumL = h.reduce((a, x) => a + x.l, 0);
          const sumS = h.reduce((a, x) => a + x.s, 0);
          add(
            `${m.base_asset} ${t.label}: ${h.length}개 | ${kstTime(h[0].t)} ~ ${kstTime(h[h.length - 1].t)} | 롱 ${compact(sumL)} / 숏 ${compact(sumS)} USD`
          );
        }
      }
      add('완료');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      add(`오류: ${msg}`);
      if (msg.includes('Failed to fetch')) {
        add('→ Worker 주소가 맞는지, Worker 코드가 배포됐는지 확인');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 12, color: '#d1d4dc', fontSize: 12 }}>
      <input
        type="password"
        value={proxy}
        onChange={(e) => setProxy(e.target.value)}
        placeholder="Worker 주소 붙여넣기"
        style={{ width: '100%', boxSizing: 'border-box', padding: 8, marginBottom: 8 }}
      />
      <button onClick={run} disabled={busy} style={{ padding: '6px 12px', marginBottom: 8 }}>
        {busy ? '조회 중...' : 'Coinalyze 청산 이력 테스트'}
      </button>
      {log.map((l, i) => (
        <div key={i} style={{ wordBreak: 'break-all', marginBottom: 4 }}>
          {l}
        </div>
      ))}
    </div>
  );
}