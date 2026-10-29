import { useEffect, useState } from 'react';
import { INDICATORS, GROUP_NAME, type IndicatorDef, type ParamDef, type ParamValues } from './indicators';
import { getLiqStatus, onLiqStatus, type LiqStatus } from './liqStore';
import { UP, DOWN, GRAY } from './common';

type Tab = 'on' | 'all' | 'basic';

type Props = {
  enabled: Record<string, boolean>;
  settings: Record<string, ParamValues>;
  onToggle: (id: string) => void;
  onParam: (id: string, key: string, value: number | string) => void;
  onReset: (id: string) => void;
  onClose: () => void;
  overlay: boolean; // 좁은 화면에서는 차트 위에 겹쳐서 표시
};

const STATUS_TEXT: Record<LiqStatus, string> = {
  connecting: 'Bybit 연결 중…',
  live: 'Bybit 실시간 연결됨',
  error: 'Bybit 연결 오류 (재연결 시도 중)',
};
const STATUS_COLOR: Record<LiqStatus, string> = {
  connecting: '#f5a623',
  live: UP,
  error: DOWN,
};

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onClick}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', padding: 0,
        cursor: 'pointer', flexShrink: 0, position: 'relative',
        background: on ? '#2962ff' : '#363a45',
      }}
    >
      <span
        style={{
          position: 'absolute', top: 2, left: on ? 20 : 2,
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          transition: 'left 0.15s',
        }}
      />
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#1c2230', color: '#fff', border: '1px solid #2a2e39',
  borderRadius: 4, padding: '4px 6px', fontSize: 13, width: 110,
};

function Field({
  def, value, resetKey, onChange,
}: {
  def: ParamDef;
  value: number | string;
  resetKey: number;
  onChange: (v: number | string) => void;
}) {
  let control: React.ReactNode = null;
  if (def.type === 'number') {
    control = (
      <input
        key={`${def.key}-${resetKey}`}
        type="number"
        defaultValue={Number(value)}
        min={def.min}
        max={def.max}
        step={def.step ?? 1}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        style={inputStyle}
      />
    );
  } else if (def.type === 'color') {
    control = (
      <input
        type="color"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 40, height: 26, border: 'none', background: 'transparent', padding: 0 }}
      />
    );
  } else {
    control = (
      <select
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, width: 170 }}
      >
        {def.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, fontSize: 12, color: '#b2b5be', padding: '4px 0',
      }}
    >
      <span>{def.label}</span>
      {control}
    </div>
  );
}

export default function IndicatorPanel({
  enabled, settings, onToggle, onParam, onReset, onClose, overlay,
}: Props) {
  const [tab, setTab] = useState<Tab>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [liqStatus, setLiqStatus] = useState<LiqStatus>(getLiqStatus());

  useEffect(() => {
    setLiqStatus(getLiqStatus());
    return onLiqStatus(setLiqStatus);
  }, []);

  const visible = INDICATORS.filter((i) => !i.hidden);
  const onCount = visible.filter((i) => enabled[i.id]).length;
  const basicCount = visible.filter((i) => i.group === 'basic').length;
  const list =
    tab === 'on'
      ? visible.filter((i) => enabled[i.id])
      : tab === 'basic'
      ? visible.filter((i) => i.group === 'basic')
      : visible;

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '6px 10px', border: 'none', background: 'transparent', cursor: 'pointer',
    fontSize: 14, fontWeight: active ? 700 : 400, color: active ? '#fff' : GRAY,
    borderBottom: active ? '2px solid #2962ff' : '2px solid transparent',
    whiteSpace: 'nowrap',
  });

  const box: React.CSSProperties = overlay
    ? {
        position: 'absolute', right: 0, top: 0, bottom: 0,
        width: 'min(340px, 92vw)', zIndex: 30,
        boxShadow: '-8px 0 24px rgba(0,0,0,0.5)',
      }
    : { width: 340, flexShrink: 0 };

  const renderCard = (ind: IndicatorDef) => {
    const on = !!enabled[ind.id];
    const open = openId === ind.id;
    const values = settings[ind.id] ?? {};
    return (
      <div
        key={ind.id}
        style={{
          padding: '14px 14px 12px', borderBottom: '1px solid #1c2230',
          background: on ? 'rgba(41, 98, 255, 0.07)' : 'transparent',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: ind.color }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: '#fff', flex: 1 }}>{ind.name}</span>
          {ind.params && (
            <button
              onClick={() => setOpenId(open ? null : ind.id)}
              aria-label="설정"
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                fontSize: 16, color: open ? '#fff' : GRAY, padding: '2px 4px',
              }}
            >
              ⚙
            </button>
          )}
          <Switch on={on} onClick={() => onToggle(ind.id)} />
        </div>
        <div style={{ fontSize: 12, color: GRAY, margin: '6px 0 8px 16px' }}>{ind.desc}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginLeft: 16 }}>
          {ind.tags.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 4,
                background: '#1c2230', color: '#b2b5be',
              }}
            >
              {t}
            </span>
          ))}
        </div>
        {ind.id === 'liquidation' && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, color: GRAY, margin: '10px 0 0 16px',
            }}
          >
            <span
              style={{
                width: 6, height: 6, borderRadius: '50%',
                background: STATUS_COLOR[liqStatus],
              }}
            />
            {STATUS_TEXT[liqStatus]}
          </div>
        )}
        {open && ind.params && (
          <div
            style={{
              margin: '12px 0 0 16px', padding: '8px 10px', borderRadius: 6,
              background: '#0b101b', border: '1px solid #1c2230',
            }}
          >
            {ind.params.map((d) => (
              <Field
                key={d.key}
                def={d}
                value={values[d.key] ?? d.default}
                resetKey={resetKey}
                onChange={(v) => onParam(ind.id, d.key, v)}
              />
            ))}
            <button
              onClick={() => {
                onReset(ind.id);
                setResetKey((k) => k + 1);
              }}
              style={{
                marginTop: 6, border: '1px solid #2a2e39', background: 'transparent',
                color: GRAY, borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
              }}
            >
              기본값으로
            </button>
          </div>
        )}
      </div>
    );
  };

  // 전체 탭에서는 그룹 제목을 붙여서 보여줌
  const rows: React.ReactNode[] = [];
  let prevGroup = '';
  for (const ind of list) {
    if (tab === 'all' && ind.group !== prevGroup) {
      prevGroup = ind.group;
      rows.push(
        <div
          key={`g-${ind.group}`}
          style={{ padding: '10px 14px 4px', fontSize: 12, color: GRAY }}
        >
          {GROUP_NAME[ind.group]}
        </div>
      );
    }
    rows.push(renderCard(ind));
  }

  return (
    <div
      style={{
        ...box, height: '100%', display: 'flex', flexDirection: 'column',
        background: '#0f1420', borderLeft: '1px solid #1c2230', color: '#d1d4dc',
      }}
    >
      {/* 탭 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', padding: '8px 8px 0',
          borderBottom: '1px solid #1c2230',
        }}
      >
        <button style={tabBtn(tab === 'on')} onClick={() => setTab('on')}>
          켜짐 {onCount}
        </button>
        <button style={tabBtn(tab === 'all')} onClick={() => setTab('all')}>
          전체 {visible.length}
        </button>
        <button style={tabBtn(tab === 'basic')} onClick={() => setTab('basic')}>
          기본 지표 {basicCount}
        </button>
        <span style={{ flex: 1 }} />
        <button
          onClick={onClose}
          aria-label="닫기"
          style={{
            border: 'none', background: 'transparent', color: GRAY,
            fontSize: 18, cursor: 'pointer', padding: '4px 8px',
          }}
        >
          ✕
        </button>
      </div>

      {/* 지표 목록 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {list.length === 0 && (
          <div style={{ padding: 16, fontSize: 13, color: GRAY }}>켜져 있는 지표가 없어요</div>
        )}
        {rows}
      </div>
    </div>
  );
}