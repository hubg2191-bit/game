// LifeRoom — заглушка persistent-шарда (rooms.md).
// Полный шард на 60 игроков — после BattleRoom. Сейчас: вход, heartbeat 3 Гц, автосейв 10с.
import { CFG } from './simAdapter.js';

export class LifeRoom {
  constructor({ store, onClose, log }) {
    this.id = 'life-1';
    this.store = store;
    this.onClose = onClose;
    this.log = log || (() => {});
    this.clients = new Map(); // clientId -> {ws, goneAt}
    this.tick = 0;
    this.timer = setInterval(() => this.tickFn(), 1000 / CFG.snapHz.life);
    this.lastSave = 0;
  }

  join(clientId, ws) {
    this.clients.set(clientId, { ws, goneAt: 0 });
    this.send(ws, { life: true, room: this.id, t: this.tick, online: this.clients.size, stub: true });
  }

  leave(clientId) {
    const c = this.clients.get(clientId);
    if (c) c.goneAt = Date.now();
  }

  send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  tickFn() {
    this.tick += 1;
    const now = Date.now();
    for (const [, c] of this.clients) {
      if (!c.goneAt) this.send(c.ws, { life: true, t: this.tick, online: this.clients.size });
    }
    if (now - this.lastSave > CFG.autosaveSec * 1000) {
      this.lastSave = now;
      this.store.saveLife(this.id, this.tick, { online: this.clients.size, stub: true }).catch(() => {});
      this.log(`life autosave tick=${this.tick} backend=${this.store.backend}`);
    }
  }

  close() {
    clearInterval(this.timer);
    this.onClose(this.id);
  }
}
