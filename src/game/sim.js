// shared/sim — чистая симуляция боя Схватки 0.1 (без Three.js и DOM).
// Все дистанции GDD (метры) переводятся в мировые единицы через WORLD_SCALE.
// Скорости НЕ масштабируются — иначе 1.5км карта неиграбельна в демо.
// Время найма/постройки и CAPTURE_TUNING — демо-допущения, баланс будет в data/*.json v0.3.

export const WORLD_SCALE = 0.25;
export const SIM_TICK_HZ = 15;

const MELEE_PERIOD = 1.5;
const RANGED_PERIOD_DEFAULT = 2.5;
const AGGRO_RADIUS = 16;
const CAPTURE_RADIUS = 7;
const CAPTURE_TUNING = 6; // захват в capSec/6 сек полным отрядом (демо-темп)
const CAPTURE_MIN_SOLDIERS = 8;
const BOT_THINK = 2.0;
const CAV_IDS = new Set(['light_cav', 'heavy_cav', 'nukers']);

export const MVP_RECRUIT = {
  townhall: ['militia'],
  barracks: ['swords', 'spears', 'archers'],
};

export const MVP_BUILD_MENU = ['farm', 'house', 'sawmill', 'quarry', 'tower', 'warehouse'];

const START_RES = { food: 650, wood: 650, stone: 300, iron: 200, gold: 350 };

let nextId = 1;
const nid = () => nextId++;

export function unitById(unitsData, id) {
  return unitsData.squads.find((u) => u.id === id);
}
export function buildingById(buildingsData, id) {
  return buildingsData.buildings.find((b) => b.id === id);
}

function m(x) {
  return x * WORLD_SCALE;
}

export function recruitTime(unit) {
  const total = Object.values(unit.cost || {}).reduce((a, b) => a + b, 0);
  return 4 + total / 120;
}
export function buildTime(bdef) {
  const cost = bdef.cost || bdef.costPerM || {};
  const total = Object.values(cost).reduce((a, b) => a + b, 0);
  return 5 + total / 80;
}
export function affordable(res, cost) {
  for (const [k, v] of Object.entries(cost || {})) {
    if ((res[k] || 0) < v) return false;
  }
  return true;
}
export function pay(res, cost) {
  for (const [k, v] of Object.entries(cost || {})) res[k] -= v;
}

function formationOffsets(n) {
  const offs = [];
  const perRow = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / perRow);
    const c = i % perRow;
    offs.push({ dx: (c - (perRow - 1) / 2) * 1.3, dz: (r - 0.9) * 1.3 });
  }
  return offs;
}

function addSquad(state, owner, typeId, x, z) {
  const def = unitById(state.units, typeId);
  const offs = formationOffsets(def.size);
  const sq = {
    id: nid(),
    type: typeId,
    owner,
    x,
    z,
    hp: def.hpPer * def.size,
    hpMax: def.hpPer * def.size,
    count: def.size,
    mor: 70,
    order: null,
    atkCd: 0,
    fleeT: 0,
    lastDmgT: -99,
    soldiers: offs.map((o) => ({ dx: o.dx, dz: o.dz, alive: true })),
  };
  state.squads.push(sq);
  return sq;
}

function addBuilding(state, owner, typeId, x, z, opts = {}) {
  const def = buildingById(state.bdefs, typeId);
  const hp = Array.isArray(def.hp) ? def.hp[0] : def.hp || 500;
  const b = {
    id: nid(),
    type: typeId,
    owner,
    x,
    z,
    hp: opts.hp ?? hp,
    hpMax: hp,
    level: 1,
    queue: [],
    rally: { x: x + 6, z: z + 6 },
    cd: 0,
    buildT: opts.buildT ?? 0, // >0 = строится
    buildTotal: opts.buildT ?? 0,
  };
  state.buildings.push(b);
  return b;
}

function baseLayout(sx, sz) {
  // sx,sz — мировые единицы спавна
  return [
    ['townhall', 0, 0],
    ['house', -9, 4],
    ['farm', 9, 3],
    ['sawmill', -9, -6],
    ['quarry', 9, -6],
    ['barracks', 0, -12],
    ['tower', 12, 10],
    ['warehouse', -12, 10],
  ].map(([type, dx, dz]) => ({ type, x: sx + dx, z: sz + dz }));
}

export function createGame(map, unitsData, buildingsData, rules) {
  nextId = 1;
  const state = {
    map,
    units: unitsData,
    bdefs: buildingsData,
    rules,
    t: 0,
    over: false,
    winner: null,
    reason: '',
    players: {
      player: { id: 'player', team: 0, res: { ...START_RES, popUsed: 0, popMax: 20, morale: 70 }, bot: false, thinkT: 0 },
      bot: { id: 'bot', team: 1, res: { ...START_RES, popUsed: 0, popMax: 20, morale: 70 }, bot: true, thinkT: 1 },
    },
    buildings: [],
    squads: [],
    flags: map.provinces.map((p) => ({
      id: p.id, x: m(p.x), z: m(p.z), type: p.type, buff: p.buff,
      owner: null, progress: 0, capSec: p.capSec || 120,
    })),
    mines: (map.mines || []).map((pt) => ({ x: m(pt.x), z: m(pt.z) })),
    camps: (map.camps || []).map((c) => ({ type: c.type, x: m(c.x), z: m(c.z) })),
    hills: (map.hills || []).map((h) => ({ x: m(h.x), z: m(h.z), r: 12, h: h.h })),
    score: { player: 0, bot: 0 },
    events: [],
  };
  const [s0, s1] = map.spawns;
  const p0 = { x: m(s0.x), z: m(s0.z) };
  const p1 = { x: m(s1.x), z: m(s1.z) };
  for (const slot of baseLayout(p0.x, p0.z)) addBuilding(state, 'player', slot.type, slot.x, slot.z);
  for (const slot of baseLayout(p1.x, p1.z)) addBuilding(state, 'bot', slot.type, slot.x, slot.z);
  addSquad(state, 'player', 'militia', p0.x - 4, p0.z + 8);
  addSquad(state, 'player', 'swords', p0.x + 4, p0.z + 8);
  addSquad(state, 'bot', 'militia', p1.x - 4, p1.z - 8);
  addSquad(state, 'bot', 'swords', p1.x + 4, p1.z - 8);
  recalcPop(state);
  event(state, 'Бой начался. Удерживайте флаги и снесите Ратушу врага.');
  return state;
}

function event(state, text, kind = 'info') {
  state.events.push({ t: state.t, text, kind });
  if (state.events.length > 40) state.events.shift();
}

function recalcPop(state) {
  for (const pid of ['player', 'bot']) {
    const p = state.players[pid];
    let used = 0;
    let max = 20; // базовая вместимость столицы
    for (const b of state.buildings) {
      if (b.owner !== pid || b.buildT > 0) continue;
      const def = buildingById(state.bdefs, b.type);
      used += def.workers || 0;
      if (def.pop) max += def.pop;
    }
    // 0.1: население = рабочие + отряды (не бойцы), иначе стартовая армия всё забивает
    for (const s of state.squads) if (s.owner === pid) used += 1;
    p.res.popUsed = used;
    p.res.popMax = max;
  }
}

function onHill(state, x, z) {
  return state.hills.some((h) => (x - h.x) ** 2 + (z - h.z) ** 2 < h.r * h.r);
}

// ---------- приказы ----------

export function orderMove(state, ids, x, z) {
  for (const s of state.squads) {
    if (!ids.includes(s.id)) continue;
    s.order = { kind: 'attackmove', x, z, target: null };
  }
}
export function orderAttack(state, ids, target) {
  for (const s of state.squads) {
    if (!ids.includes(s.id)) continue;
    s.order = { kind: 'attack', target };
  }
}
export function recruit(state, pid, buildingId, unitId) {
  const b = state.buildings.find((x) => x.id === buildingId);
  const u = unitById(state.units, unitId);
  if (!b || !u || b.owner !== pid || b.buildT > 0) return false;
  if (!(MVP_RECRUIT[b.type] || []).includes(unitId)) return false;
  const p = state.players[pid];
  recalcPop(state);
  if (p.res.popUsed + 1 > p.res.popMax) return false;
  if (!affordable(p.res, u.cost)) return false;
  const cap = squadCap(state, pid);
  const owned = state.squads.filter((s) => s.owner === pid).length
    + state.buildings.filter((x) => x.owner === pid).reduce((a, x) => a + x.queue.length, 0);
  if (owned >= cap) return false;
  pay(p.res, u.cost);
  const t = recruitTime(u);
  b.queue.push({ unitId, t, total: t });
  recalcPop(state);
  return true;
}
export function construct(state, pid, typeId, x, z) {
  const def = buildingById(state.bdefs, typeId);
  if (!def || !MVP_BUILD_MENU.includes(typeId)) return false;
  const p = state.players[pid];
  if (!affordable(p.res, def.cost)) return false;
  pay(p.res, def.cost);
  const t = buildTime(def);
  addBuilding(state, pid, typeId, x, z, { hp: 1, buildT: t, buildTotal: t });
  recalcPop(state);
  event(state, `Строится: ${def.name}`);
  return true;
}
export function squadCap(state, pid) {
  const th = state.buildings.find((b) => b.owner === pid && b.type === 'townhall');
  if (!th) return 0;
  const def = buildingById(state.bdefs, 'townhall');
  return def.squadCap[Math.min(th.level - 1, def.squadCap.length - 1)];
}

// ---------- тик ----------

function nearestEnemy(state, s, range) {
  let best = null;
  let bestD = range * range;
  for (const o of state.squads) {
    if (o.owner === s.owner || o.count <= 0) continue;
    const d = (o.x - s.x) ** 2 + (o.z - s.z) ** 2;
    if (d < bestD) { bestD = d; best = { kind: 'squad', id: o.id }; }
  }
  for (const b of state.buildings) {
    if (b.owner === s.owner) continue;
    const d = (b.x - s.x) ** 2 + (b.z - s.z) ** 2;
    if (d < bestD) { bestD = d; best = { kind: 'building', id: b.id }; }
  }
  return best;
}
function targetPos(state, target) {
  if (!target) return null;
  const list = target.kind === 'squad' ? state.squads : state.buildings;
  const e = list.find((x) => x.id === target.id);
  if (!e || (e.count !== undefined && e.count <= 0) || e.hp <= 0) return null;
  return e;
}

function dealDamage(state, src, target, mult = 1) {
  const e = targetPos(state, target);
  if (!e) return;
  // src: {type} для отрядов (урон из data) или {dmg} для башен
  const def = src.type && src.type !== '__tower' ? unitById(state.units, src.type) : null;
  const baseDmg = def ? def.dmg : src.dmg || 10;
  let dmg = baseDmg * mult;
  if (def && e.type && CAV_IDS.has(e.type) && def.bonusVsCav) dmg *= def.bonusVsCav;
  if (onHill(state, src.x, src.z)) dmg *= 1 + (state.rules.heightBonus ?? 0.15);
  if (e.hp !== undefined && e.count !== undefined) {
    // отряд: урон в общий пул HP
    const before = e.count;
    e.hp -= dmg;
    e.lastDmgT = state.t;
    const per = unitById(state.units, e.type).hpPer;
    e.count = Math.max(0, Math.ceil(e.hp / per));
    if (e.count < before) {
      e.mor = Math.max(0, e.mor - ((before - e.count) / before) * 35);
      let aliveIdx = 0;
      for (const sol of e.soldiers) {
        if (sol.alive) {
          aliveIdx++;
          if (aliveIdx > e.count) sol.alive = false;
        }
      }
    }
    if (e.count <= 0) {
      e.hp = 0;
      event(state, `Отряд ${unitById(state.units, e.type).name} (${e.owner}) уничтожен`, 'combat');
    }
  } else {
    e.hp -= dmg;
  }
}

function updateSquad(state, s, dt) {
  if (s.count <= 0) return;
  const def = unitById(state.units, s.type);
  s.atkCd -= dt;
  // бегство
  if (s.fleeT > 0) {
    s.fleeT -= dt;
    const threat = nearestEnemy(state, s, AGGRO_RADIUS * 2);
    if (threat) {
      const e = targetPos(state, threat);
      if (e) {
        const dx = s.x - e.x;
        const dz = s.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        s.x += (dx / d) * def.speed * dt;
        s.z += (dz / d) * def.speed * dt;
      }
    }
    return;
  }
  if (s.mor < (state.rules.moraleFlee ?? 30)) {
    s.fleeT = state.rules.fleeSec ?? 8;
    s.mor = 45;
    event(state, `Отряд ${def.name} бежит!`, 'combat');
    return;
  }
  if (state.t - s.lastDmgT > 6) s.mor = Math.min(70, s.mor + 2 * dt);

  const range = m(def.range || 0) + 1.2;
  const period = def.reload || (def.range ? RANGED_PERIOD_DEFAULT : MELEE_PERIOD);

  let moveX = null;
  let moveZ = null;
  let tgtRef = s.order && s.order.kind === 'attack' ? s.order.target : null;
  let tgt = tgtRef ? targetPos(state, tgtRef) : null;
  if (s.order && s.order.kind === 'attack' && !tgt) { s.order = null; tgtRef = null; }
  if (!tgt && (!s.order || s.order.kind === 'attackmove')) {
    const found = nearestEnemy(state, s, AGGRO_RADIUS);
    if (found) { tgtRef = found; tgt = targetPos(state, found); }
  }
  if (tgt) {
    const d = Math.hypot(tgt.x - s.x, tgt.z - s.z);
    if (d <= range) {
      if (s.atkCd <= 0) {
        s.atkCd = period;
        let mult = 1;
        const p = state.players[s.owner];
        if (p.res.gold <= 0 && (def.upkeep?.gold || 0) > 0) mult *= 0.8; // нет золота на upkeep
        dealDamage(state, s, tgtRef, mult);
      }
    } else {
      moveX = tgt.x;
      moveZ = tgt.z;
    }
  } else if (s.order && (s.order.kind === 'move' || s.order.kind === 'attackmove')) {
    const d = Math.hypot(s.order.x - s.x, s.order.z - s.z);
    if (d > 1.0) {
      moveX = s.order.x;
      moveZ = s.order.z;
    } else if (s.order.kind === 'move') {
      s.order = null;
    }
  }
  if (moveX !== null) {
    const d = Math.hypot(moveX - s.x, moveZ - s.z) || 1;
    const step = Math.min(d, def.speed * dt);
    s.x += ((moveX - s.x) / d) * step;
    s.z += ((moveZ - s.z) / d) * step;
  }
}

function updateEconomy(state, dt) {
  for (const pid of ['player', 'bot']) {
    const p = state.players[pid];
    const prod = { food: 0, wood: 0, stone: 0, iron: 0, gold: 0 };
    let eaters = 0;
    let goldUp = 0;
    const woodBuff = state.flags.some((f) => f.owner === pid && f.buff.includes('wood')) ? 1.15 : 1;
    const goldBuff = state.flags.some((f) => f.owner === pid && f.buff.includes('gold')) ? 1.1 : 1;
    for (const b of state.buildings) {
      if (b.owner !== pid || b.buildT > 0 || b.hp <= 0) continue;
      const def = buildingById(state.bdefs, b.type);
      if (def.foodPerSec) prod.food += def.foodPerSec;
      if (def.woodPerSec) prod.wood += def.woodPerSec * woodBuff;
      if (def.stonePerSec) prod.stone += def.stonePerSec;
      if (def.ironPerSec) prod.iron += def.ironPerSec;
      if (def.taxGoldPerMin) {
        // у Ратуши налог — массив по уровням, у остальных — число
        const tax = Array.isArray(def.taxGoldPerMin) ? def.taxGoldPerMin[b.level - 1] : def.taxGoldPerMin;
        prod.gold += (tax / 60) * goldBuff;
      }
      eaters += def.workers || 0;
    }
    let foodUp = 0;
    for (const s of state.squads) {
      if (s.owner !== pid || s.count <= 0) continue;
      const def = unitById(state.units, s.type);
      foodUp += (def.upkeep?.food || 0) * (s.count / def.size);
      goldUp += (def.upkeep?.gold || 0) * (s.count / def.size);
      eaters += s.count;
    }
    p.res.food += (prod.food - eaters * 0.02 - foodUp) * dt;
    p.res.wood += prod.wood * dt;
    p.res.stone += prod.stone * dt;
    p.res.iron += prod.iron * dt;
    p.res.gold = Math.max(0, p.res.gold + (prod.gold - goldUp) * dt);
    p.res.food = Math.max(0, p.res.food);
    p._prod = prod;
  }
}

function updateQueues(state, dt) {
  for (const b of state.buildings) {
    if (b.hp <= 0) continue;
    if (b.buildT > 0) {
      b.buildT -= dt;
      if (b.buildT <= 0) {
        const def = buildingById(state.bdefs, b.type);
        b.hp = b.hpMax = Array.isArray(def.hp) ? def.hp[0] : def.hp || 500;
        recalcPop(state);
        event(state, `Построено: ${def.name}`);
      }
      continue;
    }
    const q = b.queue[0];
    if (!q) continue;
    q.t -= dt;
    if (q.t <= 0) {
      b.queue.shift();
      addSquad(state, b.owner, q.unitId, b.rally.x, b.rally.z);
      recalcPop(state);
      if (b.owner === 'player') event(state, `Готов: ${unitById(state.units, q.unitId).name}`);
    }
  }
}

function updateTowers(state, dt) {
  for (const b of state.buildings) {
    if (b.type !== 'tower' || b.owner === null || b.hp <= 0 || b.buildT > 0) continue;
    const def = buildingById(state.bdefs, 'tower');
    b.cd -= dt;
    if (b.cd > 0) continue;
    const range = m(def.range || 40);
    let best = null;
    let bestD = range * range;
    for (const s of state.squads) {
      if (s.owner === b.owner || s.count <= 0) continue;
      const d = (s.x - b.x) ** 2 + (s.z - b.z) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) {
      b.cd = 2.0;
      dealDamage(state, { type: '__tower', dmg: def.dmg || 12, x: b.x, z: b.z }, { kind: 'squad', id: best.id }, 1);
      state.shots = state.shots || [];
      state.shots.push({ x1: b.x, z1: b.z, x2: best.x, z2: best.z, t: 0.25, from: b.owner });
    }
  }
}

function updateFlags(state, dt) {
  const rates = state.map.scorePerSec || { '1flag': 5, '2flags': 12, '3flags': 20 };
  for (const f of state.flags) {
    let nP = 0;
    let nB = 0;
    for (const s of state.squads) {
      if (s.count <= 0) continue;
      if ((s.x - f.x) ** 2 + (s.z - f.z) ** 2 > CAPTURE_RADIUS * CAPTURE_RADIUS) continue;
      if (s.owner === 'player') nP += s.count;
      else nB += s.count;
    }
    if (nP >= CAPTURE_MIN_SOLDIERS && nB < CAPTURE_MIN_SOLDIERS && f.owner !== 'player') {
      f.progress += dt * (nP / 10) / (f.capSec / CAPTURE_TUNING);
      if (f.progress >= 1) {
        f.owner = 'player';
        f.progress = 0;
        event(state, `Флаг ${f.id} захвачен!`, 'flag');
      }
    } else if (nB >= CAPTURE_MIN_SOLDIERS && nP < CAPTURE_MIN_SOLDIERS && f.owner !== 'bot') {
      f.progress += dt * (nB / 10) / (f.capSec / CAPTURE_TUNING);
      if (f.progress >= 1) {
        f.owner = 'bot';
        f.progress = 0;
        event(state, `Враг захватил флаг ${f.id}!`, 'flag');
      }
    } else {
      f.progress = Math.max(0, f.progress - dt * 0.05);
    }
  }
  const owned = { player: 0, bot: 0 };
  for (const f of state.flags) if (f.owner) owned[f.owner]++;
  const rate = (n) => (n >= 3 ? rates['3flags'] : n === 2 ? rates['2flags'] : n === 1 ? rates['1flag'] : 0) || 0;
  state.score.player += rate(owned.player) * dt;
  state.score.bot += rate(owned.bot) * dt;
}

function updateBot(state, dt) {
  const p = state.players.bot;
  p.thinkT -= dt;
  if (p.thinkT > 0) return;
  p.thinkT = BOT_THINK;
  recalcPop(state);
  // найм
  const order = ['militia', 'swords', 'spears', 'archers'];
  const hall = state.buildings.find((b) => b.owner === 'bot' && b.type === 'townhall' && b.hp > 0 && b.buildT <= 0);
  const barr = state.buildings.find((b) => b.owner === 'bot' && b.type === 'barracks' && b.hp > 0 && b.buildT <= 0);
  if (hall && hall.queue.length < 2) recruit(state, 'bot', hall.id, 'militia');
  if (barr && barr.queue.length < 2) {
    const pick = order[1 + Math.floor(Math.random() * 3)];
    if (!recruit(state, 'bot', barr.id, pick)) recruit(state, 'bot', barr.id, 'swords');
  }
  // атака: собираем свободные отряды
  const army = state.squads.filter((s) => s.owner === 'bot' && s.count > 0 && !s.order);
  if (army.length >= 2) {
    const free = state.flags.find((f) => f.owner !== 'bot');
    const th = state.buildings.find((b) => b.owner === 'player' && b.type === 'townhall' && b.hp > 0);
    const dest = free || th;
    if (dest) {
      for (const s of army) s.order = { kind: 'attackmove', x: dest.x, z: dest.z, target: null };
      event(state, 'Враг наступает!', 'combat');
    }
  }
}

export function update(state, dt) {
  if (state.over) return;
  state.t += dt;
  updateEconomy(state, dt);
  updateQueues(state, dt);
  for (const s of state.squads) updateSquad(state, s, dt);
  // чистка погибших
  state.squads = state.squads.filter((s) => s.count > 0);
  updateTowers(state, dt);
  updateFlags(state, dt);
  updateBot(state, dt);
  // условия победы
  const winScore = state.map.winScore || 1000;
  const thP = state.buildings.find((b) => b.owner === 'player' && b.type === 'townhall');
  const thB = state.buildings.find((b) => b.owner === 'bot' && b.type === 'townhall');
  if ((!thB || thB.hp <= 0) || state.score.player >= winScore) {
    state.over = true;
    state.winner = 'player';
    state.reason = !thB || thB.hp <= 0 ? 'Ратуша врага разрушена' : 'Доминация: 1000 очков';
  } else if ((!thP || thP.hp <= 0) || state.score.bot >= winScore) {
    state.over = true;
    state.winner = 'bot';
    state.reason = !thP || thP.hp <= 0 ? 'Ваша Ратуша разрушена' : 'Враг набрал 1000 очков';
  }
  // разрушенные здания убираем из списков (оставляем руины рендеру через hp<=0)
  for (const b of state.buildings) {
    if (b.hp <= 0 && !b.ruined) {
      b.ruined = true;
      const def = buildingById(state.bdefs, b.type);
      event(state, `${b.owner === 'player' ? 'Потеряно' : 'Уничтожено'}: ${def.name}`, 'combat');
      recalcPop(state);
    }
  }
}
