import { useEffect, useMemo, useState } from 'react';
import Chart from './Chart';
import IndicatorPanel from './IndicatorPanel';
import {
  INDICATORS,
  defaultSettings,
  loadState,
  saveState,
  type ParamValues,
} from './indicators';
import { BG, GRAY, INTERVAL_LABEL } from './common';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOXLUSDT'];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

// 화면 너비가 넓은지 (넓으면 지표 패널이 옆에 붙고, 좁으면 차트 위에 겹쳐서 열림)
function useWide(min = 900) {
  const [wide, setWide] = useState(() => window.innerWidth >= min);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= min);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [min]);
  return wide;
}

export default function App() {
  const wide = useWide();
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState('1h');
  const [panelOpen, setPanelOpen] = useState(wide);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => loadState().enabled);
  const [settings, setSettings] = useState<Record<string, ParamValues>>(
    () => loadState().settings
  );

  // 켜짐 상태와 설정값을 브라우저에 저장
  useEffect(() => {
    saveState(enabled, settings);
  }, [enabled, settings]);

  const toggle = (id: string) => setEnabled((p) => ({ ...p, [id]: !p[id] }));
  const setParam = (id: string, key: string, value: number | string) =>
    setSettings((p) => ({ ...p, [id]: { ...p[id], [key]: value } }));
  const resetParams = (id: string) =>
    setSettings((p) => ({ ...p, [id]: defaultSettings()[id] }));

  // 숨김 처리된 지표는 항상 꺼진 상태로 차트에 전달
  const effective = useMemo(() => {
    const e = { ...enabled };
    for (const ind of INDICATORS) if (ind.hidden) e[ind.id] = false;
    return e;
  }, [enabled]);
  const onCount = INDICATORS.filter((i) => !i.hidden && effective[i.id]).length;

  const btn = (active: boolean): React.CSSProperties => ({
    padding: '6px 10px',
    border: 'none',
    borderRadius: 6,
    background: active ? '#2a2e39' : 'transparent',
    color: active ? '#fff' : GRAY,
    fontWeight: active ? 700 : 400,
    fontSize: 13,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  });

  const toolbar = (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px',
        borderTop: '1px solid #1c2230', borderBottom: '1px solid #1c2230',
        overflowX: 'auto',
      }}
    >
      {SYMBOLS.map((s) => (
        <button key={s} style={btn(s === symbol)} onClick={() => setSymbol(s)}>
          {s.replace('USDT', '')}
        </button>
      ))}
      <span style={{ width: 1, height: 18, background: '#2a2e39', margin: '0 8px', flexShrink: 0 }} />
      {TIMEFRAMES.map((t) => (
        <button key={t} style={btn(t === timeframe)} onClick={() => setTimeframe(t)}>
          {INTERVAL_LABEL[t]}
        </button>
      ))}
      <span style={{ flex: 1 }} />
      <button style={btn(panelOpen)} onClick={() => setPanelOpen((o) => !o)}>
        지표 {onCount}
      </button>
    </div>
  );

  return (
    <div
      style={{
        height: '100vh', width: '100%', display: 'flex',
        background: BG, overflow: 'hidden', position: 'relative',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
        <Chart
          symbol={symbol}
          interval={timeframe}
          toolbar={toolbar}
          enabled={effective}
          settings={settings}
        />
      </div>
      {panelOpen && (
        <IndicatorPanel
          enabled={effective}
          settings={settings}
          onToggle={toggle}
          onParam={setParam}
          onReset={resetParams}
          onClose={() => setPanelOpen(false)}
          overlay={!wide}
        />
      )}
    </div>
  );
}