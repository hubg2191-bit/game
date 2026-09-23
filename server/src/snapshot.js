// snapshot: сериализация + дифф 10 Hz + фильтрация туманом (sync.md: в тумане нет данных).
import { sim } from './simAdapter.js';

const r2 = (v) => Math.round(v * 100) / 100;

function serSquad(s, pid, state) {
  const mine = s.owner === pid || sim.sameTeam(state, s.owner, pid);
  const o = {
    k: 's', id: s.id, t: s.type, o: s.owner,
    x: r2(s.x), z: r2(s.z), hp: Math.round(s.hp), hm: s.hpMax, c: s.count,
    m: Math.round(s.mor), f: r2(s.face || 0),
  };
  if (s.loose) o.l = 1;
  if ((s.markT || 0) > 0) o.mk = 1;
  if ((s.invisT || 0) > 0) o.iv = 1;
  if (s.type === 'hero' && s.hero) {
    o.hero = mine
      ? { arch: s.hero.arch, level: s.hero.level, mana: Math.round(s.hero.mana), mm: defOfMana(state, s.owner), q: Math.ceil(s.hero.qCd), e: Math.ceil(s.hero.eCd), xp: Math.round(s.hero.xpBattle) }
      : { arch: s.hero.arch, level: s.hero.level };
  }
  return o;
}

function defOfMana(state, owner) {
  try {
    return state.heroStats?.[owner]?.manaMax || 100;
  } catch {
    return 100;
  }
}

function serBuilding(b) {
  return {
    k: 'b', id: b.id, t: b.type, o: b.owner,
    x: r2(b.x), z: r2(b.z), hp: Math.round(b.hp), hm: b.hpMax, lv: b.level,
    q: b.queue.map((q) => ({ u: q.unitId, t: Math.ceil(q.t), total: Math.ceil(q.total || q.t) })),
    bt: b.buildT > 0 ? Math.ceil(b.buildT) : 0,
    bt0: b.buildTotal ? Math.ceil(b.buildTotal) : 0,
    up: b.upT > 0 ? Math.ceil(b.upT) : 0,
    sh: (b.shieldT || 0) > 0 ? 1 : 0,
    mk: (b.markT || 0) > 0 ? 1 : 0,
  };
}

// Полный отфильтрованный снапшот для pid. Туман должен быть посчитан
// updateFog(state, team) под сторону pid ДО вызова. noFog=true — всё как есть (наблюдатель).
export function fullSnap(state, pid, simVersion, noFog = false) {
  const squads = [];
  for (const s of state.squads) {
    if (s.count <= 0) continue;
    if (!noFog && !sim.isVisibleFor(state, s, pid)) continue;
    squads.push(serSquad(s, pid, state));
  }
  const buildings = [];
  for (const b of state.buildings) {
    if (b.hp <= 0) continue;
    if (!noFog && !sim.isVisibleFor(state, b, pid)) continue;
    buildings.push(serBuilding(b));
  }
  const snap = {
    full: true,
    snap: state.tick,
    t: r2(state.t),
    phase: state.phase,
    simVersion,
    squads, buildings,
    flags: state.flags.map((f) => ({ id: f.id, o: f.owner, p: r2(f.progress) })),
    score: state.mode === 'ffa'
      ? Object.fromEntries(state.pids.map((p) => [p, Math.round(state.score[p] || 0)]))
      : { A: Math.round(state.score.A), B: Math.round(state.score.B) },
    stats: Object.fromEntries(state.pids.map((p) => [p, { ...(state.stats[p] || { kills: 0, losses: 0 }) }])),
    q: { ...state.quest },
    res: { ...state.players[pid].res },
    hash: sim.hashState(state),
  };
  for (const k of ['food', 'wood', 'stone', 'iron', 'gold', 'popUsed', 'popMax']) {
    snap.res[k] = Math.round(snap.res[k]);
  }
  return snap;
}

// Дифф против lastSent (Map id->json). Возвращает {snap, up, del, ...meta} или null если пусто.
export function diffSnap(state, pid, lastSent, simVersion, lastEventT) {
  const full = fullSnap(state, pid, simVersion);
  const up = [];
  const seen = new Set();
  for (const e of [...full.squads, ...full.buildings]) {
    const key = `${e.k}${e.id}`;
    seen.add(key);
    const js = JSON.stringify(e);
    if (lastSent.get(key) !== js) {
      lastSent.set(key, js);
      up.push(e);
    }
  }
  const del = [];
  for (const key of [...lastSent.keys()]) {
    if (key === '__meta') continue;
    if (!seen.has(key)) {
      lastSent.delete(key);
      const m = key.match(/^([sb])(-?\d+)$/);
      if (m) del.push({ k: m[1], id: Number(m[2]) });
    }
  }
  const meta = { t: full.t, phase: full.phase, score: full.score, res: full.res, flags: full.flags, q: full.q, stats: full.stats };
  const metaJs = JSON.stringify(meta);
  const metaChanged = lastSent.get('__meta') !== metaJs;
  if (metaChanged) lastSent.set('__meta', metaJs);
  const events = state.events.filter((e) => e.t > lastEventT).slice(-8);
  if (!up.length && !del.length && !metaChanged && !events.length) return null;
  return { snap: state.tick, up, del, ...meta, events, hash: state.tick % 75 === 0 ? full.hash : undefined };
}

export function snapSizeKb(snap) {
  return Buffer.byteLength(JSON.stringify(snap), 'utf8') / 1024;
}
