// BattleRoom: эфемерная комната 40 мин (rooms.md).
// wait -> build 10 мин (урон 50%) -> battle -> score/win -> rewards -> close.
// Тик 15 Гц, дифф-снапшот 10 Гц, туман на сторону, хеш/десинк, реконнект 90с, реплей-лог.
import { sim, data, SIM_VERSION, CFG } from './simAdapter.js';
import { fullSnap, diffSnap, snapSizeKb } from './snapshot.js';
import { makeLimiter, validateCmd, applyCmd } from './validate.js';

let roomSeq = 1;

export class BattleRoom {
  constructor({ mode, mapId, seed, heroes, store, onClose, log }) {
    this.id = `battle-${roomSeq++}`;
    this.mode = mode; // 1v1 | 2v2 | ffa
    this.map = data.maps[mapId] || data.maps.plain;
    this.seed = seed ?? Math.floor(Math.random() * 1e9);
    this.heroes = heroes; // heroes.json для симов
    this.store = store;
    this.onClose = onClose;
    this.log = log || (() => {});
    this.clients = new Map(); // clientId -> {ws, pid, lastSent, lastEventT, limiter, misses, goneAt, hashTick}
    this.pidOf = new Map(); // clientId -> pid
    this.orderLog = []; // реплей: {tick, pid, cmd}
    this.hashRing = new Map(); // tick -> hash
    this.maxTick = 40 * 60 * CFG.simTickHz;
    this.over = false;
    this.overAt = 0;
    this.lastSnapAt = 0;
    this.lastHashAt = 0;
    this.lastFogAt = 0;
    this.fogTeam = {}; // team/pid -> tick когда считали (туман общий на тик, не на клиента)
    this.state = null;
    this.timer = null;
    this.startedAt = Date.now();
  }

  racesFor(humans) {
    // humans: [{pid, race}] — остальным случайные другие расы
    const races = {};
    const used = new Set();
    for (const h of humans) {
      races[h.pid] = h.race;
      used.add(h.race);
    }
    const pool = data.races.races.map((r) => r.id).filter((r) => !used.has(r));
    let i = 0;
    for (const pid of this.pids()) {
      if (!races[pid]) races[pid] = pool[i++ % pool.length] || 'nord';
    }
    return races;
  }

  pids() {
    return this.mode === '2v2'
      ? ['player', 'ally', 'enemy1', 'enemy2']
      : this.mode === 'ffa'
        ? ['player', 'enemy1', 'enemy2', 'enemy3']
        : ['player', 'bot'];
  }

  start(humans) {
    const races = this.racesFor(humans);
    this.state = sim.createGame(this.map, data.units, data.bdefs, data.units.rules, data.races, {
      mode: this.mode,
      races,
      difficulty: 'normal',
      seed: this.seed,
      heroesData: this.heroes,
      hero: { arch: 'warlord', level: 1, gear: {}, perks: [] },
    });
    // герои людей — из их hello (поверх дефолтных)
    for (const h of humans) {
      if (h.hero) this.respawnHero(h.pid, h.hero);
      this.state.players[h.pid].bot = false; // живым не микрит ИИ
    }
    this.state.phase = 'build';
    this.log(`room ${this.id} started mode=${this.mode} seed=${this.seed} humans=${humans.map((h) => h.pid).join(',')}`);
    const stepMs = 1000 / CFG.simTickHz;
    this.timer = setInterval(() => this.tick(), stepMs);
  }

  respawnHero(pid, setup) {
    // герой из меты клиента поверх дефолтного (sim.spawnHero — та же функция что у клиента)
    const cur = sim.heroOf(this.state, pid);
    if (cur) {
      cur.count = 0;
      cur.hp = 0;
    }
    this.state.heroSetup[pid] = setup;
    sim.spawnHero(this.state, pid, setup.arch, setup.level, setup.gear, setup.perks || []);
  }

  teamOf(pid) {
    return sim.teamOf(this.state, pid);
  }

  join(clientId, ws, pid, hero) {
    const existing = this.clients.get(clientId);
    if (existing) {
      // реконнект: подменяем сокет, отдаём полный снапшот
      existing.ws = ws;
      existing.goneAt = 0;
      this.sendFull(clientId);
      this.log(`room ${this.id} client ${clientId} reconnected as ${pid}`);
      return true;
    }
    if ([...this.clients.values()].some((c) => c.pid === pid && !c.goneAt)) return false;
    this.clients.set(clientId, {
      ws, pid, lastSent: new Map(), lastEventT: -1,
      limiter: makeLimiter(), misses: 0, goneAt: 0,
    });
    this.pidOf.set(clientId, pid);
    if (hero) {
      this.state.heroSetup[pid] = hero;
      this.respawnHero(pid, hero);
    }
    this.state.players[pid].bot = false; // живым не микрит ИИ
    this.sendFull(clientId);
    return true;
  }

  leave(clientId) {
    const c = this.clients.get(clientId);
    if (c) c.goneAt = Date.now(); // окно реконнекта 90с
  }

  freePid(prefer) {
    const taken = new Set([...this.clients.values()].filter((c) => !c.goneAt).map((c) => c.pid));
    const order = this.mode === '2v2' ? ['player', 'ally']
      : this.mode === 'ffa' ? ['player', 'enemy1', 'enemy2', 'enemy3']
      : ['player'];
    for (const pid of [...(prefer ? [prefer] : []), ...order]) {
      if (!taken.has(pid)) return pid;
    }
    return null;
  }

  send(ws, msg) {
    if (ws.readyState === 1) {
      const js = JSON.stringify(msg);
      if (Buffer.byteLength(js) > CFG.maxSnapKb * 1024) {
        this.log(`room ${this.id} snapshot oversize, dropped`);
        return;
      }
      ws.send(js);
    }
  }

  sendFull(clientId) {
    const c = this.clients.get(clientId);
    if (!c) return;
    c.lastSent = new Map();
    c.lastEventT = this.state.t;
    sim.updateFog(this.state, this.fogTeamOf(c.pid));
    this.send(c.ws, fullSnap(this.state, c.pid, SIM_VERSION));
  }

  fogTeamOf(pid) {
    return this.state.mode === 'ffa' ? pid : sim.teamOf(this.state, pid);
  }

  onCmd(clientId, msg) {
    const c = this.clients.get(clientId);
    if (!c || c.goneAt) return;
    const pid = c.pid;
    if (!c.limiter.check()) {
      this.send(c.ws, { err: 'rate', seq: msg.seq });
      return;
    }
    const v = validateCmd(this.state, pid, msg);
    if (v.err) {
      this.send(c.ws, { err: v.err, seq: msg.seq, reason: v.reason });
      return;
    }
    if (applyCmd(this.state, pid, msg)) {
      this.orderLog.push({ tick: this.state.tick, pid, cmd: msg.cmd, args: msg });
      this.send(c.ws, { ack: msg.seq });
    } else {
      this.send(c.ws, { err: 'invalid', seq: msg.seq });
    }
  }

  onHash(clientId, tick, hash) {
    const c = this.clients.get(clientId);
    if (!c) return;
    // клиенты предсказывают (движение сразу) — тики гуляют: ищем свой хеш в окне ±30 тиков.
    // Совпадение в окне = та же траектория, рассинхрона нет. 3 мимо подряд — desync.
    let found = false;
    for (let t = tick - 30; t <= tick + 30; t++) {
      if (this.hashRing.get(t) === hash) {
        found = true;
        break;
      }
    }
    if (this.hashRing.size && !found) {
      c.misses += 1;
      this.log(`room ${this.id} hash mismatch ${c.pid} tick=${tick} (${c.misses}/3)`);
      if (c.misses >= 3) {
        c.misses = 0;
        this.log(`room ${this.id} desync ${c.pid} — full snapshot + лог`);
        this.sendFull(clientId);
      }
    } else if (found) {
      c.misses = 0;
    }
  }

  tick() {
    const s = this.state;
    if (!s) return;
    sim.update(s, 1 / CFG.simTickHz);
    // фазы rooms.md
    if (s.phase === 'build' && s.t > 600) {
      s.phase = 'battle';
      this.log(`room ${this.id} phase -> battle`);
    }
    const now = Date.now();
    // туман — на сторону каждого клиента (5 Гц на клиента, дёшево)
    if (now - this.lastFogAt > 200) {
      this.lastFogAt = now;
      this.fogDue = true;
    }
    // диффы 10 Гц
    if (now - this.lastSnapAt > 1000 / CFG.snapHz.battle) {
      this.lastSnapAt = now;
      for (const [cid, c] of this.clients) {
        if (c.goneAt) continue;
        if (this.fogDue) sim.updateFog(this.state, this.fogTeamOf(c.pid));
        const d = diffSnap(s, c.pid, c.lastSent, SIM_VERSION, c.lastEventT);
        if (d) {
          c.lastEventT = s.t;
          if (snapSizeKb(d) > CFG.maxSnapKb) {
            this.sendFull(cid);
          } else {
            this.send(c.ws, d);
          }
        }
      }
      this.fogDue = false;
    }
    // хеш каждые 5 сек
    if (now - this.lastHashAt > 5000) {
      this.lastHashAt = now;
      const h = sim.hashState(s);
      this.hashRing.set(s.tick, h);
      if (this.hashRing.size > 600) {
        const first = this.hashRing.keys().next().value;
        this.hashRing.delete(first);
      }
    }
    // конец: победа/40 мин/все ушли+90с
    if (s.over && !this.over) {
      this.over = true;
      this.overAt = now;
      this.finish();
    }
    if ((s.t > this.maxTick / CFG.simTickHz || (this.over && now - this.overAt > 60000))) {
      this.close();
      return;
    }
    let anyAlive = false;
    for (const c of this.clients.values()) {
      if (!c.goneAt) anyAlive = true;
      else if (now - c.goneAt > CFG.reconnectSec * 1000 && !anyAlive) {
        // все ушли и окно вышло — комнату можно закрыть после over
      }
    }
    if (!anyAlive && (s.over || s.t > 120)) {
      // пустая комната без игры — держим до реконнекта, но не вечно
      if (!this.emptyAt) this.emptyAt = now;
      if (now - this.emptyAt > CFG.reconnectSec * 1000) this.close();
    } else {
      this.emptyAt = 0;
    }
  }

  finish() {
    const s = this.state;
    const rec = {
      seed: this.seed,
      cfg: { mode: this.mode, map: this.map.id, races: s.raceOf },
      orders: this.orderLog,
      result: { winner: s.winner, reason: s.reason, score: s.score, stats: s.stats, hash: sim.hashState(s), tick: s.tick },
    };
    this.replay = rec;
    this.store?.saveReplay(this.id, rec).catch(() => {});
    for (const [cid, c] of this.clients) {
      if (c.goneAt) continue;
      this.send(c.ws, {
        end: true, winner: s.winner, reason: s.reason,
        score: s.score, stats: s.stats,
        replayId: this.id,
      });
    }
    this.log(`room ${this.id} finished winner=${s.winner} hash=${rec.result.hash}`);
  }

  getReplay() {
    return this.replay || null;
  }

  close() {
    clearInterval(this.timer);
    this.timer = null;
    for (const [, c] of this.clients) {
      try {
        c.ws.close();
      } catch { /* ignore */ }
    }
    this.clients.clear();
    this.onClose(this.id);
  }
}
