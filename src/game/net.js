// client/net — сокет онлайн-игры (architecture.md: client/net).
// Фронт ходит только по WSS_URL из env. По умолчанию локально из .env,
// снаружи — wss://...trycloudflare.com вписать в .env без правок кода.
// TODO(VPS): поменять VITE_WSS_URL в .env на домен, quick-туннель убрать (см. server/MIGRATION.md).
const WSS_URL = import.meta.env.VITE_WSS_URL || 'ws://localhost:3000'; // TODO(VPS)

export function getWssUrl() {
  return WSS_URL;
}

export class NetClient {
  constructor(onEvent) {
    this.onEvent = onEvent; // {onSnap, onFull, onEnd, onQueue, onErr, onOpen, onClose}
    this.ws = null;
    this.seq = 0;
    this.pending = new Map(); // seq -> {msg, t}
    this.clientId = localStorage.getItem('tt_client_id') || null;
    this.room = null;
    this.pid = null;
    this.seed = 0;
    this.retryTimer = null;
  }

  connect(url = WSS_URL) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      const to = setTimeout(() => reject(new Error('timeout')), 8000);
      this.ws.onopen = () => {
        clearTimeout(to);
        this.onEvent.onOpen?.();
        this.retryTimer = setInterval(() => this.retry(), 1000);
        resolve();
      };
      this.ws.onmessage = (ev) => this.route(JSON.parse(ev.data));
      this.ws.onclose = () => {
        clearInterval(this.retryTimer);
        this.onEvent.onClose?.();
      };
    });
  }

  send(o) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o));
  }

  hello(opts) {
    // opts: {simVersion, mode, map, race, hero, mmr} или {simVersion, clientId, room} для реконнекта
    this.send({ hello: true, ...opts });
  }

  cmd(cmd) {
    // cmd: {cmd, ...} по protocol.md; seq + ретрай при потере ack (sync.md: приказы не теряются)
    const seq = ++this.seq;
    const msg = { room: this.room, clientId: this.clientId, t: Date.now(), seq, ...cmd };
    this.pending.set(seq, { msg, t: Date.now() });
    this.send(msg);
    return seq;
  }

  retry() {
    const now = Date.now();
    for (const [seq, p] of this.pending) {
      if (now - p.t > 1000) {
        p.t = now;
        this.send(p.msg);
      }
      if (now - p.t > 30000) this.pending.delete(seq);
    }
  }

  sendHash(tick, hash) {
    this.send({ room: this.room, clientId: this.clientId, hash, tick });
  }

  getReplay() {
    this.send({ room: this.room, clientId: this.clientId, getReplay: true });
  }

  route(m) {
    if (m.ack) this.pending.delete(m.ack);
    if (m.queued) {
      this.clientId = m.clientId;
      localStorage.setItem('tt_client_id', m.clientId);
    }
    if (m.joined) {
      this.room = m.room;
      this.pid = m.pid;
      this.seed = m.seed;
      this.onEvent.onJoined?.(m);
    }
    if (m.snap !== undefined || m.full) this.onEvent.onSnap?.(m);
    if (m.end) this.onEvent.onEnd?.(m);
    if (m.queued) this.onEvent.onQueue?.(m);
    if (m.err || m.kick) this.onEvent.onErr?.(m);
    if (m.replay) this.onEvent.onReplay?.(m);
  }

  close() {
    clearInterval(this.retryTimer);
    this.ws?.close();
  }
}
