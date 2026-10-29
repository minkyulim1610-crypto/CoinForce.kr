export type LiqSide = 'long' | 'short';
export type Liq = { t: number; symbol: string; side: LiqSide; usd: number };
export type LiqStatus = 'connecting' | 'live' | 'error';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOXLUSDT'];
const MAX_EVENTS = 100000;

const events: Liq[] = [];
const liqListeners = new Set<(e: Liq) => void>();
const statusListeners = new Set<(s: LiqStatus) => void>();

let status: LiqStatus = 'connecting';
let started = false;
let retry = 0;
let pingTimer: ReturnType<typeof setInterval> | undefined;

function setStatus(s: LiqStatus) {
  status = s;
  statusListeners.forEach((fn) => fn(s));
}

function connect() {
  setStatus('connecting');
  const socket = new WebSocket('wss://stream.bybit.com/v5/public/linear');

  socket.onopen = () => {
    retry = 0;
    setStatus('live');
    // 종목마다 따로 구독 (하나가 실패해도 나머지는 동작)
    for (const s of SYMBOLS) {
      socket.send(JSON.stringify({ op: 'subscribe', args: [`allLiquidation.${s}`] }));
    }
    pingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ op: 'ping' }));
      }
    }, 20000);
  };

  socket.onmessage = (e) => {
    let m: any;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.success === false) {
      console.warn('Bybit 구독 실패:', m.ret_msg);
      return;
    }
    if (
      typeof m.topic !== 'string' ||
      !m.topic.startsWith('allLiquidation.') ||
      !Array.isArray(m.data)
    ) {
      return;
    }
    for (const d of m.data) {
      const ev: Liq = {
        t: Number(d.T),
        symbol: d.s,
        // Buy = 롱 포지션이 청산됨, Sell = 숏 포지션이 청산됨
        side: d.S === 'Buy' ? 'long' : 'short',
        usd: Number(d.v) * Number(d.p),
      };
      events.push(ev);
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
      liqListeners.forEach((fn) => fn(ev));
    }
  };

  socket.onerror = () => setStatus('error');
  socket.onclose = () => {
    if (pingTimer) clearInterval(pingTimer);
    setStatus('error');
    const delay = Math.min(15000, 1000 * 2 ** retry++);
    setTimeout(connect, delay);
  };
}

export function startLiq() {
  if (started) return;
  started = true;
  connect();
}

export const getLiqs = (symbol: string) => events.filter((e) => e.symbol === symbol);
export const getLiqStatus = () => status;

export function onLiq(fn: (e: Liq) => void) {
  liqListeners.add(fn);
  return () => {
    liqListeners.delete(fn);
  };
}

export function onLiqStatus(fn: (s: LiqStatus) => void) {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
}