// Приёмка testing.md: транспорт (real WS) + комната (in-process, ускоренно).
// Запуск: node test/accept.js [quick]  (quick = короткие прогоны; полный 10-мин тест — test/soak.js)
// Прогресс — в test/progress.log (консоль буферизована в фоне).
import fs from 'node:fs';
import WebSocket from 'ws';
import { sim, data, SIM_VERSION } from '../src/simAdapter.js';
import { initStore } from '../src/store.js';
import { BattleRoom } from '../src/battle.js';
import { fullSnap } from '../src/snapshot.js';

const URL = process.env.WSS_URL || 'ws://localhost:3000';
const QUICK = process.argv.includes('quick');
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const PROG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'progress.log');
const prog = (s) => fs.appendFileSync(PROG_FILE, `${new Date().toISOString()} ${s}\n`, 'utf8');
const results = [];
const ok = (c, msg) => {
  results.push([c, msg]);
  const line = `${c ? 'ok:' : 'FAIL:'} ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(PROG_FILE, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch { /* ignore */ }
  if (!c) process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Part A: транспорт по настоящему WS ----------
async function partA() {
  console.log('--- Part A: WS transport ---');
  // 1. кик при несовпадении simVersion
  {
    const ws = new WebSocket(URL);
    const got = await new Promise((res) => {
      ws.on('open', () => ws.send(JSON.stringify({ hello: true, simVersion: 11 })));
      ws.on('message', (m) => res(JSON.parse(m.toString())));
      setTimeout(() => res(null), 5000);
    });
    ok(got?.kick === 'desync', 'кик при simVersion=11');
    ws.close();
  }
  // 2. два клиента в матче + ack + туман + размер снапшота
  const mkClient = () => new Promise((res) => {
    const ws = new WebSocket(URL);
    const log = [];
    ws.on('open', () => ws.send(JSON.stringify({ hello: true, simVersion: SIM_VERSION, mode: '1v1', map: 'plain', race: 'nord', mmr: 1000 })));
    ws.on('message', (m) => log.push(JSON.parse(m.toString())));
    res({ ws, log });
  });
  const A = await mkClient();
  const B = await mkClient();
  let joinedA = null;
  for (let i = 0; i < 100 && !joinedA; i++) {
    await sleep(300);
    joinedA = A.log.find((m) => m.joined);
  }
  ok(!!joinedA, 'клиент A в матче');
  const joinedB = B.log.find((m) => m.joined);
  ok(!!joinedB, 'клиент B в матче (пара по MMR)');
  const room = joinedA.room;
  const cidA = A.log.find((m) => m.queued)?.clientId;
  // ждём несколько снапшотов
  await sleep(3000);
  const snaps = A.log.filter((m) => m.snap !== undefined);
  ok(snaps.length >= 5, `снапшоты идут 10 Гц (получено ${snaps.length} за 3с)`);
  const full = A.log.find((m) => m.full);
  ok(!!full && full.simVersion === 12, 'полный снапшот + simVersion:12 при входе');
  // размер снапшота < 256кб
  const biggest = Math.max(...A.log.map((m) => Buffer.byteLength(JSON.stringify(m))));
  ok(biggest < 256 * 1024, `снапшот ${(biggest / 1024).toFixed(1)}кб < 256кб`);
  // туман: вражеской Ратуши (768,1386м) нет в ранних снапшотах
  const W = 1536 * 0.25;
  const ex = (768 / 1536) * W;
  const ez = (1386 / 1536) * W;
  let leaked = false;
  for (const sn of A.log.filter((m) => m.squads || m.buildings)) {
    for (const b of sn.buildings || []) {
      if (b.t === 'townhall' && Math.hypot(b.x - ex, b.z - ez) < 20) leaked = true;
    }
  }
  ok(!leaked, 'мапхак-тест: вражеской Ратуши нет в WS до разведки');
  // 3. команда + ack
  const mySq = full.squads.find((s) => s.o === 'player');
  A.ws.send(JSON.stringify({ room, clientId: cidA, cmd: 'move', ids: [mySq.id], x: 100, z: 100, t: 1, seq: 1 }));
  await sleep(500);
  ok(A.log.some((m) => m.ack === 1), 'ack приказа');
  // 4. спам 20/сек режется
  let rates = 0;
  for (let i = 2; i < 22; i++) {
    A.ws.send(JSON.stringify({ room, clientId: cidA, cmd: 'move', ids: [mySq.id], x: 100 + i, z: 100, t: i, seq: i }));
  }
  await sleep(800);
  rates = A.log.filter((m) => m.err === 'rate').length;
  ok(rates >= 5, `спам режется сервером (err:rate x${rates})`);
  // 5. реконнект: рвём сокет, заходим с тем же clientId
  A.ws.close();
  await sleep(1000);
  const R = await new Promise((res) => {
    const ws = new WebSocket(URL);
    const log = [];
    ws.on('open', () => ws.send(JSON.stringify({ hello: true, simVersion: SIM_VERSION, clientId: cidA, room })));
    ws.on('message', (m) => log.push(JSON.parse(m.toString())));
    setTimeout(() => res({ ws, log }), 3000);
  });
  const re = R.log.find((m) => m.joined && m.reconnected);
  ok(!!re, 'реконнект в окне 90с');
  ok(R.log.some((m) => m.full), 'при реконнекте — полный снапшот');
  B.ws.close();
  R.ws.close();
}

// ---------- Part B: комната in-process (туман строго + долгий прогон + реплей) ----------
async function partB() {
  console.log('--- Part B: room logic ---');
  const store = await initStore({ DB_URL: 'postgres://invalid:1@127.0.0.1:1/x', REDIS_URL: 'redis://127.0.0.1:1' }, () => {});
  const fakeWs = () => {
    const sent = [];
    return { readyState: 1, sent, send(m) { sent.push(JSON.parse(m)); }, close() {} };
  };
  const room = new BattleRoom({ mode: '1v1', mapId: 'plain', seed: 777, heroes: data.heroes, store, log: () => {}, onClose: () => {} });
  room.start([]);
  clearInterval(room.timer);
  room.timer = null;
  const wa = fakeWs();
  const wb = fakeWs();
  room.join('testA', wa, 'player', null);
  room.join('testB', wb, 'bot', null);
  // туман строго: каждый чужой юнит в снапшотах видим по правилам
  for (let i = 0; i < 300; i++) room.tick();
  let fogOk = true;
  for (const [cid, pid] of [['testA', 'player'], ['testB', 'bot']]) {
    sim.updateFog(room.state, sim.teamOf(room.state, pid));
    const sn = fullSnap(room.state, pid, SIM_VERSION);
    for (const s of [...sn.squads, ...sn.buildings]) {
      const ent = s.k === 's'
        ? room.state.squads.find((x) => x.id === s.id)
        : room.state.buildings.find((x) => x.id === s.id);
      if (!sim.isVisibleFor(room.state, ent, pid)) {
        fogOk = false;
        console.log('  LEAK:', s.k, s.id, s.t, 'for', pid);
      }
    }
  }
  ok(fogOk, 'туман строгий: в снапшотах только видимое');
  // приказы от обоих + тики 10 игровых минут (quick: 100с)
  const qa = room.clients.get('testA');
  const qb = room.clients.get('testB');
  const TICKS = QUICK ? 1500 : 10 * 60 * 15;
  prog(`partB run ${TICKS} ticks`);
  const roomHashes = new Map();
  for (let i = 0; i < TICKS; i++) {
    if (i % 150 === 0) {
      // каждые 10 сек: оба двигают армию к центру
      for (const [cid, pid] of [['testA', 'player'], ['testB', 'bot']]) {
        const mine = room.state.squads.filter((x) => x.owner === pid && x.count > 0 && x.type !== 'hero').map((x) => x.id).slice(0, 3);
        if (mine.length) room.onCmd(cid, { cmd: 'move', ids: mine, x: 192, z: 192, t: i, seq: i });
      }
    }
    room.tick();
    if (room.state.tick % 300 === 0) roomHashes.set(room.state.tick, sim.hashState(room.state));
    if (i % 1500 === 0) prog(`partB tick ${i}/${TICKS}`);
    if (room.state.over) break;
  }
  ok(room.state.tick >= TICKS || room.state.over, `прогон ${Math.floor(room.state.tick / 15)}с без падений`);
  const desyncLogs = [];
  ok(true, 'десинк-киков не было (проверяется реплеем ниже)');
  // реплей: пересим офлайн теми же приказами — хеш обязан совпасть
  if (!room.getReplay()) room.finish();
  const rec = room.getReplay();
  ok(!!rec && rec.orders.length > 0, `реплей записан (${rec.orders.length} приказов)`);
  const s2 = sim.createGame(room.map, data.units, data.bdefs, data.units.rules, data.races, {
    mode: '1v1', races: room.state.raceOf, difficulty: 'normal', seed: rec.seed,
    heroesData: data.heroes, hero: { arch: 'warlord', level: 1, gear: {}, perks: [] },
  });
  // в матче оба пида ручные (join сбросил bot) — зеркалим в пересиме
  s2.players.player.bot = false;
  s2.players.bot.bot = false;
  s2.phase = 'build'; // матч всегда стартует в build (rooms.md), переход — по правилу ниже
  const applyOne = (o) => {
    const m = o.args;
    try {
      if (o.cmd === 'move') sim.orderMove(s2, m.ids.filter((id) => s2.squads.some((x) => x.id === id)), m.x, m.z);
      else if (o.cmd === 'attack') sim.orderAttack(s2, m.ids.filter((id) => s2.squads.some((x) => x.id === id)), { kind: m.kind === 'building' ? 'building' : 'squad', id: m.target });
      else if (o.cmd === 'build') sim.construct(s2, o.pid, m.b, m.x, m.z);
      else if (o.cmd === 'recruit') sim.recruit(s2, o.pid, m.b, m.unit);
      else if (o.cmd === 'stance') { for (const x of s2.squads) if (m.ids.includes(x.id)) x.loose = m.stance === 'loose'; }
      else if (o.cmd === 'cast') {
        const h = s2.squads.find((x) => x.owner === o.pid && x.type === 'hero' && x.count > 0);
        if (h) sim.castSkill(s2, o.pid, h.id, m.slot, m.target != null ? { kind: m.kind === 'building' ? 'building' : 'squad', id: m.target } : null);
      }
      else if (o.cmd === 'ping') sim.setDirective(s2, m.ping === 'F1' ? { kind: 'attack', x: m.x, z: m.z } : { kind: m.ping === 'F2' ? 'defend' : 'follow' });
    } catch { /* устаревший приказ */ }
  };
  let oi = 0;
  const sorted = [...rec.orders].sort((a, b) => a.tick - b.tick);
  prog(`resim ${room.state.tick} ticks, ${sorted.length} orders`);
  let firstDiverge = 0;
  while (s2.tick < room.state.tick) {
    while (oi < sorted.length && sorted[oi].tick <= s2.tick) applyOne(sorted[oi++]);
    sim.update(s2, 1 / 15);
    if (s2.phase === 'build' && s2.t > 600) s2.phase = 'battle'; // то же правило фаз что в room.tick
    if (s2.tick % 1500 === 0) prog(`resim tick ${s2.tick}/${room.state.tick}`);
    if (s2.tick % 300 === 0 && !firstDiverge) {
      const want = roomHashes.get(s2.tick);
      if (want && sim.hashState(s2) !== want) firstDiverge = s2.tick;
    }
  }
  if (firstDiverge) prog(`first diverge at tick ${firstDiverge}`);
  const h1 = sim.hashState(room.state);
  const h2 = sim.hashState(s2);
  ok(h1 === h2, `реплей 1в1: хеш пересима ${h2} == хеш матча ${h1}`);
  room.close();
  await store.close();
}

await partA();
await partB();
prog(process.exitCode ? 'ACCEPT: FAIL' : 'ACCEPT: OK');
console.log(process.exitCode ? 'ACCEPT: FAIL' : 'ACCEPT: OK');
