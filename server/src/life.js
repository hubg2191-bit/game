// LifeRoom — персистентный шард (rooms.md): чанки 3x3, автосейв 10с, офлайн-доход при входе.
import { CFG } from './simAdapter.js';
import { createShard, settleCapital, attack, tickShard, offlineShard, chunkOf, chunkFilter, phaseOf } from './lifeSim.js';

const WARP = Number(process.env.TIME_WARP || 1); // тиков симуляции в секунду (тесты ускоряют)

export class LifeRoom {
  constructor({ store, onClose, log }) {
    this.id = 'life-1';
    this.store = store;
    this.onClose = onClose;
    this.log = log || (() => {});
    this.clients = new Map(); // clientId -> {ws, pid, goneAt, sub:{cx,cz}, lastSent:Map}
    this.state = createShard(20260923);
    this.tick = 0;
    this.acc = 0;
    this.last = Date.now();
    this.timer = setInterval(() => this.tickFn(), 1000 / CFG.snapHz.life);
    this.lastSave = 0;
  }

  send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  diffFor(c) {
    // дифф провинций в подписке 3x3 + события
    const list = chunkFilter(this.state, c.sub.cx, c.sub.cz);
    const up = [];
    for (const p of list) {
      const js = JSON.stringify([p.owner, p.outpost ? 1 : 0, p.capital ? 1 : 0, p.shieldUntil > this.state.tick ? 1 : 0]);
      if (c.lastSent.get(p.id) !== js) {
        c.lastSent.set(p.id, js);
        up.push({ id: p.id, x: p.x, z: p.z, type: p.type, o: p.owner, out: p.outpost ? 1 : 0, cap: p.capital ? 1 : 0, sh: p.shieldUntil > this.state.tick ? 1 : 0 });
      }
    }
    const cap = this.state.capitals[c.pid];
    return {
      life: true, t: this.state.tick, day: this.state.day, phase: phaseOf(this.state.day).id,
      up, online: this.clients.size,
      me: c.pid ? { stock: cap?.stock || {}, scores: this.state.scores[c.pid] || 0, shield: (cap?.shieldUntil || 0) > this.state.tick } : null,
      events: this.state.events.slice(-5),
    };
  }

  join(clientId, ws, profile = {}) {
    const pid = profile.pid || clientId;
    const isNew = !this.state.capitals[pid];
    const awaySec = profile.awaySec || 0;
    settleCapital(this.state, pid, profile);
    let offlineGain = 0;
    if (!isNew && awaySec > 60) offlineGain = offlineShard(this.state, pid, awaySec);
    const cap = this.state.capitals[pid];
    const home = this.state.provinces.find((p) => p.id === cap.prov);
    const c = { ws, pid, goneAt: 0, sub: chunkOf(home), lastSent: new Map() };
    this.clients.set(clientId, c);
    this.send(ws, { life: true, room: this.id, pid, clientId, full: true, day: this.state.day, offlineGain, capital: cap.prov, ...this.diffFor(c) });
    this.log(`life join ${pid} (offline +${offlineGain})`);
  }

  leave(clientId) {
    const c = this.clients.get(clientId);
    if (c) c.goneAt = Date.now();
  }

  onCmd(clientId, msg) {
    const c = this.clients.get(clientId);
    if (!c || c.goneAt) return;
    if (msg.cmd === 'lifeAttack') {
      const r = attack(this.state, c.pid, msg.prov, { heroLevel: msg.heroLevel || 1 });
      if (r.err) this.send(c.ws, { err: r.err });
      else {
        this.send(c.ws, { ack: msg.seq, ...(r.loot ? { loot: r.loot } : {}) });
        // сброс диффов чтобы разослать смену владельца
        for (const [, x] of this.clients) x.lastSent.clear();
      }
    } else if (msg.cmd === 'lifeMove') {
      // смена подписки (центр обзора)
      const cx = Math.max(0, Math.min(7, Math.round(msg.cx || 0)));
      const cz = Math.max(0, Math.min(7, Math.round(msg.cz || 0)));
      c.sub = { cx, cz };
      c.lastSent.clear();
      this.send(c.ws, { ack: msg.seq });
    }
  }

  tickFn() {
    const now = Date.now();
    const steps = Math.max(1, Math.round(((now - this.last) / 1000) * WARP));
    this.last = now;
    for (let i = 0; i < steps; i++) {
      tickShard(this.state);
      this.tick += 1;
    }
    for (const [, c] of this.clients) {
      if (!c.goneAt) this.send(c.ws, this.diffFor(c));
    }
    if (now - this.lastSave > CFG.autosaveSec * 1000) {
      this.lastSave = now;
      this.store.saveLife(this.id, this.tick, {
        day: this.state.day, scores: this.state.scores,
        capitals: Object.fromEntries(Object.entries(this.state.capitals).map(([k, v]) => [k, { prov: v.prov, thLevel: v.thLevel, stock: v.stock }])),
        taken: Object.fromEntries(this.state.provinces.filter((p) => p.owner).map((p) => [p.id, p.owner])),
      }).catch(() => {});
      this.log(`life autosave tick=${this.tick} day=${this.state.day} backend=${this.store.backend}`);
    }
  }

  close() {
    clearInterval(this.timer);
    this.onClose(this.id);
  }
}
