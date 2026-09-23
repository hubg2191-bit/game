// lifeSim — симуляция MAIN-шарда 16x16 провинций (01-modes, season-structure).
// Чистая логика без сети: тик = 1 игровая минута. Тестируется отдельно.
export const SHARD = 16;

function hash2(x, z, seed) {
  let h = (x * 374761393 + z * 668265263 + seed * 974634) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function provType(x, z, seed) {
  const cx = x >= 6 && x < 10 && z >= 6 && z < 10;
  if (cx) return 'center';
  const r = hash2(x, z, seed);
  if (r < 0.05) return 'gold';
  if (r < 0.20) return 'forest';
  if (r < 0.35) return 'hill';
  return 'plain';
}

export function createShard(seed = 1) {
  const provinces = [];
  for (let x = 0; x < SHARD; x++) {
    for (let z = 0; z < SHARD; z++) {
      provinces.push({
        id: `p${x}_${z}`, x, z,
        type: provType(x, z, seed),
        owner: null, // pid
        outpost: false,
        capital: false,
        shieldUntil: 0, // tick
      });
    }
  }
  return {
    seed, tick: 0, day: 1,
    provinces,
    capitals: {}, // pid -> {prov, thLevel, stock:{...}, shieldUntil, power}
    scores: {}, // pid/clan -> очки сезона
    events: [],
  };
}

export function phaseOf(day) {
  if (day <= 14) return { id: 'settle', mult: 0.5, centerClosed: true };
  if (day <= 70) return { id: 'wars', mult: 1.0, centerClosed: false };
  if (day <= 85) return { id: 'final', mult: 2.0, centerClosed: false, centerMult: 3.0 };
  return { id: 'frozen', mult: 0, centerClosed: true, frozen: true };
}

const RES_RATES = { forest: { wood: 2 }, hill: { stone: 1 }, gold: { gold: 1 }, plain: { food: 1 }, center: { gold: 2 } };

// Мощь армии (абстракт): Ратуша 50/ур + герой 20/ур
export function powerOf(state, pid, profile = {}) {
  const cap = state.capitals[pid];
  const th = cap?.thLevel || 1;
  const hl = profile.heroLevel || 1;
  return th * 50 + hl * 20;
}

// Поселить столицу: свободная провинция у края
export function settleCapital(state, pid, profile = {}) {
  if (state.capitals[pid]) return state.capitals[pid];
  const edge = [];
  for (const p of state.provinces) {
    if (p.owner || p.type === 'center') continue;
    const edgeDist = Math.min(p.x, p.z, SHARD - 1 - p.x, SHARD - 1 - p.z);
    if (edgeDist <= 1) edge.push(p);
  }
  const pick = edge[Math.floor(hash2(pid.length, state.tick, state.seed) * edge.length)] || edge[0];
  pick.owner = pid;
  pick.capital = true;
  pick.shieldUntil = state.tick + 72 * 60; // щит новичка 72ч
  state.capitals[pid] = {
    prov: pick.id, thLevel: profile.thLevel || 1,
    stock: { food: 200, wood: 200, stone: 100, iron: 50, gold: 200 },
    shieldUntil: pick.shieldUntil,
  };
  state.scores[pid] = state.scores[pid] || 0;
  event(state, `${pid} основал столицу (${pick.id})`);
  return state.capitals[pid];
}

function event(state, text) {
  state.events.push({ t: state.tick, text });
  if (state.events.length > 20) state.events.shift();
}

function adjacent(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === 1;
}

// Атака соседней провинции. Столицы не захватываются (рейд: -10% склада), форпосты — да.
export function attack(state, attPid, provId, profile = {}) {
  const target = state.provinces.find((p) => p.id === provId);
  if (!target) return { err: 'invalid' };
  const phase = phaseOf(state.day);
  if (phase.frozen) return { err: 'frozen' };
  if (target.type === 'center' && phase.centerClosed) return { err: 'closed' };
  if (target.owner === attPid) return { err: 'own' };
  if (target.shieldUntil > state.tick) return { err: 'shield' };
  const from = state.provinces.filter((p) => p.owner === attPid);
  if (!from.some((f) => adjacent(f, target))) return { err: 'no_adjacent' };
  const atk = powerOf(state, attPid, profile);
  const defPid = target.owner;
  const def = defPid ? powerOf(state, defPid, {}) + (target.capital ? 200 : target.outpost ? 100 : 30) : 30;
  if (atk <= def) {
    event(state, `${attPid} отбит у ${provId}`);
    return { err: 'repelled' };
  }
  if (target.capital) {
    // рейд столицы: грабёж 10% + щит 24ч, без захвата
    const victim = state.capitals[target.owner];
    const loot = {};
    for (const [k, v] of Object.entries(victim.stock)) {
      loot[k] = Math.floor(v * 0.1);
      victim.stock[k] -= loot[k];
    }
    const mine = state.capitals[attPid];
    for (const [k, v] of Object.entries(loot)) mine.stock[k] = (mine.stock[k] || 0) + v;
    victim.shieldUntil = state.tick + 24 * 60;
    target.shieldUntil = victim.shieldUntil;
    event(state, `${attPid} разграбил столицу ${target.owner}!`);
    return { ok: true, raid: true, loot };
  }
  target.owner = attPid;
  target.outpost = true;
  target.shieldUntil = 0;
  event(state, `${attPid} захватил ${provId}`);
  return { ok: true };
}

// Тик = 1 игровая минута: доходы, очки, день, щиты тают сами по tick
export function tickShard(state) {
  state.tick += 1;
  state.day = Math.min(90, 1 + Math.floor(state.tick / 1440));
  const phase = phaseOf(state.day);
  const mult = phase.mult;
  for (const pid of Object.keys(state.capitals)) {
    const cap = state.capitals[pid];
    const prov = state.provinces.find((p) => p.id === cap.prov);
    // доход столицы по её типу + налог
    const rate = RES_RATES[prov.type] || {};
    for (const [k, v] of Object.entries(rate)) {
      cap.stock[k] = Math.min(5000, (cap.stock[k] || 0) + v * mult);
    }
    cap.stock.gold = Math.min(5000, (cap.stock.gold || 0) + (cap.thLevel * 0.2) * mult);
    // очки: 10/мин за прову, центр 30/мин (season-structure)
    let owned = 0;
    let center = 0;
    for (const p of state.provinces) {
      if (p.owner !== pid) continue;
      owned++;
      if (p.type === 'center') center++;
    }
    const pts = (owned * 10 + center * 30 * (phase.centerMult || 1)) * mult;
    state.scores[pid] = (state.scores[pid] || 0) + pts;
  }
}

// Офлайн-доход при входе: 40%, кап 8ч (rooms.md)
export function offlineShard(state, pid, awaySec) {
  const cap = state.capitals[pid];
  if (!cap) return 0;
  const secs = Math.min(8 * 3600, Math.max(0, awaySec));
  const mins = secs / 60;
  const phase = phaseOf(state.day);
  const gain = Math.floor(mins * 2 * phase.mult * 0.4);
  cap.stock.gold = Math.min(5000, cap.stock.gold + gain);
  cap.stock.food = Math.min(5000, (cap.stock.food || 0) + gain);
  return gain;
}

// Чанки 2x2 провы (8x8 чанков); подписка 3x3 вокруг чанка столицы
export function chunkOf(p) {
  return { cx: Math.floor(p.x / 2), cz: Math.floor(p.z / 2) };
}
export function chunkFilter(state, cx, cz) {
  return state.provinces.filter((p) => {
    const c = chunkOf(p);
    return Math.abs(c.cx - cx) <= 1 && Math.abs(c.cz - cz) <= 1;
  });
}
