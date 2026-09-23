// Gateway: WS-вход, hello/simVersion, очередь матчмейкинга, комнаты, реконнект 90с.
// Конфиг только из .env: PORT, WSS_URL, DB_URL, REDIS_URL. Адресов в коде ноль.
import fs from 'fs';
import { WebSocketServer } from 'ws';
import { sim, data, SIM_VERSION } from './simAdapter.js';
import { initStore } from './store.js';
import { BattleRoom } from './battle.js';
import { LifeRoom } from './life.js';

function loadEnv(path) {
  const env = { ...process.env };
  try {
    for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2];
    }
  } catch { /* нет файла — только process.env */ }
  return env;
}

const env = loadEnv('./.env');
const PORT = Number(env.PORT || 3000);
const log = (...a) => console.log(new Date().toISOString(), ...a);

const store = await initStore(env, log);
const wss = new WebSocketServer({ port: PORT });
const rooms = new Map(); // roomId -> BattleRoom | LifeRoom
const queue = []; // {clientId, ws, mode, map, race, hero, mmr, since}
let clientSeq = 1;

const life = new LifeRoom({ store, log, onClose: () => {} });
rooms.set(life.id, life);

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function tryMatch() {
  // пары 1v1 в окне MMR ±200 (mmrWindow), остальные ждут queueSec и добиваются ботами
  for (let i = 0; i < queue.length; i++) {
    for (let j = i + 1; j < queue.length; j++) {
      const a = queue[i];
      const b = queue[j];
      if (a.mode !== b.mode || a.mode !== '1v1') continue;
      if (Math.abs((a.mmr || 1000) - (b.mmr || 1000)) > 200) continue;
      queue.splice(j, 1);
      queue.splice(i, 1);
      startRoom('1v1', a.map, [
        { client: a, pid: 'player' },
        { client: b, pid: 'bot' },
      ]);
      return;
    }
  }
  const now = Date.now();
  for (let i = queue.length - 1; i >= 0; i--) {
    const q = queue[i];
    const waitMs = q.mode === 'ffa' ? 10000 : 15000;
    if (now - q.since > waitMs) {
      queue.splice(i, 1);
      if (q.mode === '2v2') {
        startRoom('2v2', q.map, [{ client: q, pid: 'player' }]);
      } else if (q.mode === 'ffa') {
        startRoom('ffa', q.map, [{ client: q, pid: 'player' }]);
      } else {
        startRoom('1v1', q.map, [{ client: q, pid: 'player' }]);
      }
    }
  }
}
setInterval(tryMatch, 1000);

function startRoom(mode, mapId, slots) {
  const seed = Math.floor(Math.random() * 1e9);
  const room = new BattleRoom({
    mode, mapId, seed, heroes: data.heroes, store, log,
    onClose: (id) => rooms.delete(id),
  });
  rooms.set(room.id, room);
  const humans = slots.map((s) => ({
    pid: s.pid, race: s.client.race,
    hero: s.client.hero, clientId: s.client.clientId,
  }));
  room.start(humans);
  const humansPids = humans.map((s) => s.pid);
  for (const s of slots) {
    room.join(s.client.clientId, s.client.ws, s.pid, s.client.hero);
    send(s.client.ws, { joined: true, room: room.id, pid: s.pid, seed, mode, map: mapId, races: room.state.raceOf, humans: humansPids });
  }
  log(`match room=${room.id} mode=${mode} map=${mapId}`);
}

wss.on('connection', (ws) => {
  const clientId = `c${clientSeq++}`;
  ws._cid = clientId;
  ws._authed = false;
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handle(ws, clientId, msg);
  });
  ws.on('close', () => {
    for (const [, room] of rooms) {
      if (room.leave) room.leave(clientId);
      if (room.leaveObserver) room.leaveObserver(clientId);
    }
    const qi = queue.findIndex((q) => q.clientId === clientId);
    if (qi >= 0) queue.splice(qi, 1);
  });
});

function handle(ws, clientId, msg) {
  if (msg.hello) {
    if (msg.simVersion !== SIM_VERSION) {
      send(ws, { kick: 'desync', reason: `simVersion: клиент ${msg.simVersion}, сервер ${SIM_VERSION}. Обновитесь.` });
      ws.close();
      return;
    }
    ws._authed = true;
    // реконнект: clientId + room известны
    if (msg.clientId && msg.room) {
      const room = rooms.get(msg.room);
      if (room instanceof BattleRoom) {
        const c = room.clients.get(msg.clientId);
        if (c && c.goneAt && Date.now() - c.goneAt < 90 * 1000) {
          room.join(msg.clientId, ws, c.pid, null);
          const humansPids = [...room.clients.values()].filter((x) => !x.goneAt).map((x) => x.pid);
          send(ws, { joined: true, room: msg.room, pid: c.pid, seed: room.seed, mode: room.mode, map: room.map.id, races: room.state.raceOf, humans: humansPids, reconnected: true });
          return;
        }
      }
      send(ws, { err: 'reconnect_expired' });
      return;
    }
    if (msg.room === 'life') {
      life.join(msg.clientId || clientId, ws);
      return;
    }
    // список открытых комнат для наблюдателей
    if (msg.listRooms) {
      send(ws, {
        rooms: [...rooms.values()]
          .filter((r) => r instanceof BattleRoom)
          .map((r) => ({
            room: r.id, mode: r.mode, map: r.map.name || r.map.id,
            t: Math.floor(r.state?.t || 0),
            players: [...r.clients.values()].filter((c) => !c.goneAt).length,
            over: !!r.state?.over,
          })),
      });
      return;
    }
    // наблюдатель: снапшоты с задержкой 30с, команд нет
    if (msg.observe) {
      const room = rooms.get(msg.observe);
      if (room instanceof BattleRoom) room.joinObserver(msg.clientId || clientId, ws);
      else send(ws, { err: 'no_room' });
      return;
    }
    // новая игра: в очередь (только по явному запросу с mode)
    if (!msg.mode) return;
    queue.push({
      clientId, ws,
      mode: msg.mode === '2v2' ? '2v2' : msg.mode === 'ffa' ? 'ffa' : '1v1',
      map: ['plain', 'river', 'pass'].includes(msg.map) ? msg.map : 'plain',
      race: msg.race || 'nord',
      hero: msg.hero || null,
      mmr: msg.mmr || 1000,
      since: Date.now(),
    });
    send(ws, { queued: true, clientId });
    tryMatch();
    return;
  }
  if (!ws._authed) return;
  // команды в комнату
  const room = rooms.get(msg.room);
  if (room instanceof BattleRoom) {
    if (msg.cmd) room.onCmd(msg.clientId || clientId, msg);
    else if (msg.hash) room.onHash(msg.clientId || clientId, msg.tick, msg.hash);
    else if (msg.getReplay) {
      const rec = room.getReplay();
      send(ws, rec ? { replay: rec } : { err: 'no_replay_yet' });
    }
    return;
  }
  if (room instanceof LifeRoom) return; // заглушка: команд нет
}

log(`tt-game-server слушает :${PORT} (WSS_URL=${env.WSS_URL || 'не задан'})`);
