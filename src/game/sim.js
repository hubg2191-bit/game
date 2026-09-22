// shared/sim — чистая симуляция боя Схватки 0.1 (без Three.js и DOM).
// Все дистанции GDD (метры) переводятся в мировые единицы через WORLD_SCALE.
// Скорости НЕ масштабируются — иначе 1.5км карта неиграбельна в демо.
// Время найма/постройки и CAPTURE_TUNING — демо-допущения, баланс будет в data/*.json v0.3.

export const WORLD_SCALE = 0.25;
export const SIM_TICK_HZ = 15;
export const FOG_HZ = 5;

const MELEE_PERIOD = 1.2; // v0.2: ближние 1.2с
const RANGED_PERIOD_DEFAULT = 2.0; // v0.2: луки 2.0с (reload из data приоритетнее)
const AGGRO_RADIUS = 16;
const CAPTURE_RADIUS = 7;
const CAPTURE_TUNING = 6; // захват в capSec/6 сек полным отрядом (демо-темп)
const CAPTURE_MIN_SOLDIERS = 8;
const BOT_THINK = 2.0;
const CAV_IDS = new Set(['light_cav', 'heavy_cav', 'nukers']);

// v0.2: обзор в мировых единицах (метры GDD * WORLD_SCALE)
export const SIGHT = { squad: 7, building: 6, townhall: 10, tower: 15 };
export const FOREST_R = 16; // радиус лесной зоны вокруг provinces type=forest
export const STEALTH_DIST = 2.5; // скрытых в лесу видно только в упор (10м)
export const TEMPLE_AURA = 6.25; // 25м
export const MILL_AURA = 6.25; // 25м
export const FOG_N = 64;

// v0.2: капы складов (03-resources + economy-v02)
const BASE_CAPS = { food: 2000, wood: 2000, stone: 1500, iron: 1200, gold: 5000 };
const WAREHOUSE_BONUS = 600; // +к food/wood/stone/iron за склад

export const MVP_RECRUIT = {
  townhall: ['militia'],
  barracks: ['swords', 'spears', 'archers'],
};

export const MVP_BUILD_MENU = [
  'farm', 'house', 'sawmill', 'quarry', 'mine',
  'mill', 'bakery', 'market', 'temple', 'tower', 'warehouse',
];

const START_RES = { food: 650, wood: 650, stone: 300, iron: 200, gold: 350 };

let nextId = 1;
const nid = () => nextId++;

export function unitById(unitsData, id) {
  return unitsData.squads.find((u) => u.id === id);
}
// def отряда по типу с учётом нейтралов (их нет в units.json)
export function defOf(state, type, owner) {
  if (owner === 'neutral') return NEUTRAL_DEFS[type];
  return unitById(state.units, type);
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

function addSquad(state, owner, typeId, x, z, opts = {}) {
  const def = opts.def || unitById(state.units, typeId);
  const offs = formationOffsets(def.size);
  const sq = {
    id: nid(),
    type: typeId,
    owner,
    x,
    z,
    face: opts.face ?? 0, // радианы, 0 = +z
    hp: def.hpPer * def.size,
    hpMax: def.hpPer * def.size,
    hpCap: def.hpPer * def.size, // хил не воскрешает
    count: def.size,
    kills: 0,
    mor: 70,
    order: null,
    atkCd: 0,
    fleeT: 0,
    lastDmgT: -99,
    home: opts.home || null, // нейтралы: лагерь {x,z}
    soldiers: offs.map((o) => ({ dx: o.dx, dz: o.dz, alive: true })),
  };
  state.squads.push(sq);
  return sq;
}

// Нейтралы v0.2 (maps/neutrals.md). Награды — еда/золото; XP/шмот до героев 0.4.
const NEUTRAL_DEFS = {
  wolves: { name: 'Волки', size: 6, hpPer: 30, dmg: 5, speed: 7.0, aggro: 5, leash: 10, reward: { food: 50 } },
  bandits: { name: 'Бандиты', size: 10, hpPer: 60, dmg: 8, speed: 4.0, aggro: 6.25, leash: 10, reward: { gold: 400 } },
};
function spawnNeutrals(state) {
  for (const c of state.camps) {
    const nd = NEUTRAL_DEFS[c.type];
    if (!nd) continue;
    const elite = c.type === 'bandits' && state.flags.some((f) => f.type === 'gold' && Math.hypot(f.x - c.x, f.z - c.z) < 12);
    const size = nd.size + (elite ? 4 : 0);
    const sq = addSquad(state, 'neutral', c.type, c.x, c.z, {
      def: { ...nd, size },
      home: { x: c.x, z: c.z },
    });
    sq.elite = elite;
  }
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
    ['house', -9, 10], // pacing 0:00 — 2 дома + ферма
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
    forests: (map.provinces || []).filter((p) => p.type === 'forest').map((p) => ({ x: m(p.x), z: m(p.z), r: FOREST_R })),
    score: { player: 0, bot: 0 },
    stats: { player: { kills: 0, losses: 0 }, bot: { kills: 0, losses: 0 } },
    lastCombat: null,
    events: [],
    fog: { N: FOG_N, vis: new Uint8Array(FOG_N * FOG_N), exp: new Uint8Array(FOG_N * FOG_N), t: 0 },
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
  spawnNeutrals(state);
  recalcPop(state);
  updateFog(state); // стартовый обзор
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
export function thLevel(state, pid) {
  const th = state.buildings.find((b) => b.owner === pid && b.type === 'townhall' && b.hp > 0);
  return th ? th.level : 0;
}
// Проверка требований стройки (terrain.md + buildings/*.md)
export function buildBlockReason(state, pid, typeId, x, z) {
  const def = buildingById(state.bdefs, typeId);
  if (!def) return 'нет данных';
  if (def.requires === 'townhall-2' && thLevel(state, pid) < 2) return 'нужна Ратуша-2';
  if (def.requires === 'townhall-3' && thLevel(state, pid) < 3) return 'нужна Ратуша-3';
  if (def.needsMill && !state.buildings.some((b) => b.owner === pid && b.type === 'mill' && b.hp > 0)) {
    return 'нужна Мельница';
  }
  if (typeId === 'sawmill') {
    const ok = state.forests.some((f) => (x - f.x) ** 2 + (z - f.z) ** 2 < 20 * 20);
    if (!ok) return 'лесопилка только у леса (в 20м)';
  }
  if (typeId === 'mine') {
    const ok = state.hills.some((h) => (x - h.x) ** 2 + (z - h.z) ** 2 < 15 * 15);
    if (!ok) return 'шахта только у холмов';
  }
  return null;
}
export function construct(state, pid, typeId, x, z) {
  const def = buildingById(state.bdefs, typeId);
  if (!def || !MVP_BUILD_MENU.includes(typeId)) return false;
  const p = state.players[pid];
  const block = buildBlockReason(state, pid, typeId, x, z);
  if (block) {
    if (pid === 'player') event(state, `Нельзя построить: ${block}`, 'combat');
    return false;
  }
  if (!affordable(p.res, def.cost)) return false;
  pay(p.res, def.cost);
  const t = buildTime(def);
  addBuilding(state, pid, typeId, x, z, { hp: 1, buildT: t, buildTotal: t });
  recalcPop(state);
  event(state, `Строится: ${def.name}`);
  return true;
}
// Апгрейд Ратуши (pacing: TH2 ~7:00, TH3 ~18:00)
export function upgrade(state, pid, buildingId) {
  const b = state.buildings.find((x) => x.id === buildingId);
  if (!b || b.owner !== pid || b.type !== 'townhall' || b.buildT > 0 || b.upT > 0) return false;
  const def = buildingById(state.bdefs, 'townhall');
  if (b.level >= def.levels) return false;
  const cost = def.cost[b.level]; // cost[1] = цена перехода на 2
  const p = state.players[pid];
  if (!affordable(p.res, cost)) return false;
  pay(p.res, cost);
  b.upT = 15;
  b.upTotal = 15;
  event(state, `Улучшается Ратуша до ур.${b.level + 1}`);
  return true;
}
// Обмен на рынке: 100 дерева -> ~60 золота, деградация -5% каждые 5 сделок за 2 мин
export function tradeRate(state, pid) {
  const p = state.players[pid];
  const now = state.t;
  p.tradeLog = (p.tradeLog || []).filter((t) => now - t < 120);
  return 60 * Math.pow(0.95, Math.floor(p.tradeLog.length / 5));
}
export function trade(state, pid) {
  const hasMarket = state.buildings.some((b) => b.owner === pid && b.type === 'market' && b.hp > 0 && b.buildT <= 0);
  if (!hasMarket) return 0;
  const p = state.players[pid];
  if ((p.res.wood || 0) < 100) return 0;
  const rate = tradeRate(state, pid);
  p.res.wood -= 100;
  p.res.gold = Math.min(capOf(state, pid, 'gold'), p.res.gold + rate);
  p.tradeLog.push(state.t);
  return Math.round(rate);
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

function angDiff(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}
// Фланг v0.2: атакующий за спиной цели (противоположно её взгляду) — x2, сбоку — x1.5
export function flankMultOf(state, src, e) {
  if (e.face === undefined || e.count === undefined) return 1; // здания без фланга
  const toSrc = Math.atan2(src.x - e.x, src.z - e.z);
  const d = angDiff(toSrc, e.face);
  if (d > (2 * Math.PI) / 3) return state.rules.flankRear ?? 2.0;
  if (d > Math.PI / 3) return state.rules.flankSide ?? 1.5;
  return 1;
}
export function inForest(state, x, z) {
  return state.forests.some((f) => (x - f.x) ** 2 + (z - f.z) ** 2 < f.r * f.r);
}
export function nearOwn(state, pid, type, x, z, radius) {
  return state.buildings.some(
    (b) => b.owner === pid && b.type === type && b.hp > 0 && b.buildT <= 0
      && (x - b.x) ** 2 + (z - b.z) ** 2 < radius * radius
  );
}
// Эффективная мораль: база + аура храма (+10 рядом) + запах хлеба (+5 при рабочей пекарне)
export function effMor(state, s) {
  let m = s.mor;
  if (nearOwn(state, s.owner, 'temple', s.x, s.z, TEMPLE_AURA)) m += 10;
  if (state.players[s.owner]?.townMor) m += state.players[s.owner].townMor;
  return m;
}
export function sightOf(state, b) {
  if (b.count !== undefined) return SIGHT.squad; // отряд
  if (b.type === 'tower') return SIGHT.tower;
  if (b.type === 'townhall') return SIGHT.townhall;
  return SIGHT.building;
}

function dealDamage(state, src, target, mult = 1) {
  const e = targetPos(state, target);
  if (!e) return;
  // src: {type} для отрядов (урон из data) или {dmg} для башен
  const def = src.type && src.type !== '__tower' ? defOf(state, src.type, src.owner) : null;
  const baseDmg = def ? def.dmg : src.dmg || 10;
  let dmg = baseDmg * mult;
  if (def && e.type && CAV_IDS.has(e.type) && def.bonusVsCav) dmg *= def.bonusVsCav;
  const fm = e.count !== undefined ? flankMultOf(state, src, e) : 1;
  dmg *= fm;
  if (onHill(state, src.x, src.z)) dmg *= 1 + (state.rules.heightBonus ?? 0.15);
  if (e.hp !== undefined && e.count !== undefined) {
    // отряд: урон в общий пул HP
    const before = e.count;
    e.hp -= dmg;
    e.lastDmgT = state.t;
    const per = defOf(state, e.type, e.owner).hpPer;
    e.count = Math.max(0, Math.ceil(e.hp / per));
    const deaths = before - e.count;
    if (deaths > 0) {
      // v0.2: -2 морали за тело, -3 за фланговый удар
      e.mor = Math.max(0, e.mor - deaths * 2 - (fm > 1 ? 3 : 0));
      let aliveIdx = 0;
      for (const sol of e.soldiers) {
        if (sol.alive) {
          aliveIdx++;
          if (aliveIdx > e.count) sol.alive = false;
        }
      }
      e.hpCap = e.count * per;
    }
    if (e.count <= 0) {
      e.hp = 0;
      onSquadWiped(state, src, e);
    }
  } else {
    e.hp -= dmg;
  }
}

function onSquadWiped(state, src, e) {
  const killer = src.owner === 'player' || src.owner === 'bot' ? src.owner : null;
  const bodies = e.soldiers.length;
  if (killer) {
    state.stats[killer].kills += bodies;
    const ks = state.squads.find((x) => x.id === src.id);
    if (ks) ks.kills += bodies;
  }
  if (e.owner === 'player' || e.owner === 'bot') state.stats[e.owner].losses += bodies;
  state.lastCombat = { x: e.x, z: e.z, t: state.t };
  if (e.owner === 'neutral') {
    const nd = NEUTRAL_DEFS[e.type];
    if (nd && killer) {
      const p = state.players[killer];
      const parts = [];
      for (const [k, v] of Object.entries(nd.reward)) {
        p.res[k] = Math.min(capOf(state, killer, k), p.res[k] + v);
        parts.push(`+${v} ${k === 'food' ? 'еды' : 'золота'}`);
      }
      event(state, `Лагерь зачищен (${nd.name}): ${parts.join(', ')}`, 'flag');
    }
  } else {
    event(state, `Отряд ${defOf(state, e.type, e.owner).name} (${e.owner}) уничтожен`, 'combat');
  }
}

function updateSquad(state, s, dt) {
  if (s.count <= 0) return;
  const def = defOf(state, s.type, s.owner);
  s.atkCd -= dt;
  const neutral = s.owner === 'neutral';

  // --- нейтралы: сидят у лагеря, агрятся, дальше leash не уходят, дома регенят ---
  if (neutral) {
    const nd = NEUTRAL_DEFS[s.type];
    const dh = Math.hypot(s.x - s.home.x, s.z - s.home.z);
    if (dh > 0.5 && (!s.order || s.order.kind === 'leash')) {
      // возврат домой + полный реген пака
      const d = dh;
      s.face = Math.atan2(s.home.x - s.x, s.home.z - s.z);
      const step = Math.min(d, def.speed * dt);
      s.x += ((s.home.x - s.x) / d) * step;
      s.z += ((s.home.z - s.z) / d) * step;
      if (dh < 2) {
        s.hp = s.hpMax;
        s.hpCap = s.hpMax;
        s.count = s.soldiers.length;
        for (const sol of s.soldiers) sol.alive = true;
        s.mor = 70;
        s.order = null;
      }
      return;
    }
    // поиск цели рядом (только отряды игроков)
    let best = null;
    let bestD = nd.aggro * nd.aggro;
    for (const o of state.squads) {
      if (o.owner !== 'player' && o.owner !== 'bot') continue;
      if (o.count <= 0) continue;
      if (Math.hypot(o.x - s.home.x, o.z - s.home.z) > nd.leash) continue; // не гнаться далеко
      const d = (o.x - s.x) ** 2 + (o.z - s.z) ** 2;
      if (d < bestD) { bestD = d; best = o; }
    }
    if (best) {
      const d = Math.hypot(best.x - s.x, best.z - s.z);
      s.face = Math.atan2(best.x - s.x, best.z - s.z);
      if (d <= 1.5) {
        if (s.atkCd <= 0) {
          s.atkCd = MELEE_PERIOD;
          dealDamage(state, s, { kind: 'squad', id: best.id }, 1);
        }
      } else {
        const step = Math.min(d, def.speed * dt);
        s.x += ((best.x - s.x) / d) * step;
        s.z += ((best.z - s.z) / d) * step;
      }
    }
    return;
  }

  // --- бегство (порог по эффективной морали) ---
  if (s.fleeT > 0) {
    s.fleeT -= dt;
    const threat = nearestEnemy(state, s, AGGRO_RADIUS * 2);
    if (threat) {
      const e = targetPos(state, threat);
      if (e) {
        const dx = s.x - e.x;
        const dz = s.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        s.face = Math.atan2(dx, dz);
        s.x += (dx / d) * def.speed * dt;
        s.z += (dz / d) * def.speed * dt;
      }
    }
    return;
  }
  if (effMor(state, s) < (state.rules.moraleFlee ?? 30)) {
    s.fleeT = state.rules.fleeSec ?? 8;
    s.mor = 45;
    event(state, `Отряд ${def.name} бежит!`, 'combat');
    return;
  }
  // реген морали вне боя; при голоде регена нет, только -15/мин (03-resources)
  if (state.players[s.owner]?.starving) {
    s.mor = Math.max(0, s.mor - 0.25 * dt);
  } else if (state.t - s.lastDmgT > 6) {
    const cap = 70 + (nearOwn(state, s.owner, 'temple', s.x, s.z, TEMPLE_AURA) ? 10 : 0)
      + (state.players[s.owner]?.townMor || 0);
    s.mor = Math.min(cap, s.mor + 2 * dt);
  }
  // хил храма 1%/сек вне боя
  if (nearOwn(state, s.owner, 'temple', s.x, s.z, TEMPLE_AURA)
    && state.t - s.lastDmgT > 6 && s.hp < s.hpCap) {
    s.hp = Math.min(s.hpCap, s.hp + s.hpMax * 0.01 * dt);
    s.count = Math.max(s.count, Math.ceil(s.hp / def.hpPer));
  }

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
      s.face = Math.atan2(tgt.x - s.x, tgt.z - s.z);
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
    s.face = Math.atan2(moveX - s.x, moveZ - s.z);
    const step = Math.min(d, def.speed * dt);
    s.x += ((moveX - s.x) / d) * step;
    s.z += ((moveZ - s.z) / d) * step;
  }
}

export function capOf(state, pid, res) {
  if (res === 'gold') return BASE_CAPS.gold;
  let cap = BASE_CAPS[res] ?? Infinity;
  for (const b of state.buildings) {
    if (b.owner !== pid || b.type !== 'warehouse' || b.hp <= 0 || b.buildT > 0) continue;
    cap += WAREHOUSE_BONUS;
  }
  return cap;
}

function updateEconomy(state, dt) {
  for (const pid of ['player', 'bot']) {
    const p = state.players[pid];
    const prod = { food: 0, wood: 0, stone: 0, iron: 0, gold: 0 };
    let eaters = 0;
    let goldUp = 0;
    const woodBuff = state.flags.some((f) => f.owner === pid && f.buff.includes('wood')) ? 1.15 : 1;
    const goldBuff = state.flags.some((f) => f.owner === pid && f.buff.includes('gold')) ? 1.1 : 1;
    const hasMill = state.buildings.some((b) => b.owner === pid && b.type === 'mill' && b.hp > 0 && b.buildT <= 0);
    let bakeryOn = false;
    for (const b of state.buildings) {
      if (b.owner !== pid || b.buildT > 0 || b.hp <= 0) continue;
      const def = buildingById(state.bdefs, b.type);
      if (def.foodPerSec) {
        let rate = def.foodPerSec;
        // мельница x1.5 фермам в 25м (mill.md)
        if (b.type === 'farm' && nearOwn(state, pid, 'mill', b.x, b.z, MILL_AURA)) rate *= 1.5;
        prod.food += rate;
      }
      // пекарня: 4 еды/сек только при мельнице (зерно), иначе встает
      if (b.type === 'bakery' && hasMill) {
        prod.food += 4.0;
        bakeryOn = true;
      }
      if (def.woodPerSec) prod.wood += def.woodPerSec * woodBuff;
      if (def.stonePerSec) prod.stone += def.stonePerSec;
      if (def.ironPerSec) prod.iron += def.ironPerSec;
      if (b.type === 'market') prod.gold += 6 / 60; // +6 з/мин
      if (def.taxGoldPerMin) {
        // у Ратуши налог — массив по уровням, у остальных — число
        const tax = Array.isArray(def.taxGoldPerMin) ? def.taxGoldPerMin[b.level - 1] : def.taxGoldPerMin;
        prod.gold += (tax / 60) * goldBuff;
      }
      eaters += def.workers || 0;
    }
    p.townMor = bakeryOn ? 5 : 0; // запах хлеба +5 морали городу
    let foodUp = 0;
    for (const s of state.squads) {
      if (s.owner !== pid || s.count <= 0) continue;
      const def = defOf(state, s.type, s.owner);
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
    // капы складов
    for (const k of ['food', 'wood', 'stone', 'iron']) p.res[k] = Math.min(capOf(state, pid, k), p.res[k]);
    // голод: найм -30%, мораль -15/мин (обрабатывается в updateSquad/updateQueues)
    const starving = p.res.food <= 0;
    if (starving && !p.starving) event(state, pid === 'player' ? 'ГОЛОД! Стройте фермы.' : 'У врага голод!', 'combat');
    p.starving = starving;
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
        if (b.owner === 'player') event(state, `Построено: ${def.name}`);
      }
      continue;
    }
    // апгрейд Ратуши
    if (b.upT > 0) {
      b.upT -= dt;
      if (b.upT <= 0) {
        const def = buildingById(state.bdefs, b.type);
        b.level += 1;
        b.hp = b.hpMax = def.hp[b.level - 1];
        recalcPop(state);
        event(state, `${def.name} улучшена до ур.${b.level}! Лимит отрядов: ${def.squadCap[b.level - 1]}`);
      }
    }
    const q = b.queue[0];
    if (!q) continue;
    // голод: найм -30% скорости
    const slow = state.players[b.owner]?.starving ? 0.7 : 1;
    q.t -= dt * slow;
    if (q.t <= 0) {
      b.queue.shift();
      addSquad(state, b.owner, q.unitId, b.rally.x, b.rally.z);
      recalcPop(state);
      if (b.owner === 'player') event(state, `Готов: ${defOf(state, q.unitId, b.owner).name}`);
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
      dealDamage(state, { type: '__tower', dmg: def.dmg || 12, x: b.x, z: b.z, owner: b.owner }, { kind: 'squad', id: best.id }, 1);
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

// ---------- туман войны (серверный по GDD, здесь локальный; бот 0.2 видит всё — чит пустышки) ----------
function fogCell(state, x, z) {
  const W = state.map.size_m * WORLD_SCALE;
  const cx = Math.max(0, Math.min(state.fog.N - 1, Math.floor((x / W) * state.fog.N)));
  const cz = Math.max(0, Math.min(state.fog.N - 1, Math.floor((z / W) * state.fog.N)));
  return cz * state.fog.N + cx;
}
export function updateFog(state) {
  const { N, vis, exp } = state.fog;
  const W = state.map.size_m * WORLD_SCALE;
  vis.fill(0);
  const paint = (x, z, r, tower) => {
    const cr = Math.ceil(r / (W / N));
    const ccx = Math.floor((x / W) * N);
    const ccz = Math.floor((z / W) * N);
    for (let dz = -cr; dz <= cr; dz++) {
      for (let dx = -cr; dx <= cr; dx++) {
        if (dx * dx + dz * dz > cr * cr) continue;
        const cx = ccx + dx;
        const cz = ccz + dz;
        if (cx < 0 || cz < 0 || cx >= N || cz >= N) continue;
        vis[cz * N + cx] = 1;
        exp[cz * N + cx] = 1;
      }
    }
  };
  for (const s of state.squads) {
    if (s.owner !== 'player' || s.count <= 0) continue;
    paint(s.x, s.z, SIGHT.squad, false);
  }
  for (const b of state.buildings) {
    if (b.owner !== 'player' || b.hp <= 0 || b.buildT > 0) continue;
    paint(b.x, b.z, sightOf(state, b), b.type === 'tower');
  }
}
// Видно ли сущность игроку: свои всегда; чужие — только в обзоре;
// в лесу скрыты дальше STEALTH_DIST (башни 0.2 видят скрытых в своём обзоре).
export function isVisible(state, e) {
  if (e.owner === 'player') return true;
  const idx = fogCell(state, e.x, e.z);
  if (!state.fog.vis[idx]) return false;
  if (e.count !== undefined && inForest(state, e.x, e.z)) {
    // рядом свой?
    for (const s of state.squads) {
      if (s.owner !== 'player' || s.count <= 0) continue;
      if (Math.hypot(s.x - e.x, s.z - e.z) < STEALTH_DIST) return true;
    }
    // башня видит скрытых в своём обзоре (20м)
    for (const b of state.buildings) {
      if (b.owner !== 'player' || b.type !== 'tower' || b.hp <= 0 || b.buildT > 0) continue;
      if (Math.hypot(b.x - e.x, b.z - e.z) < SIGHT.tower) return true;
    }
    return false;
  }
  return true;
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
  // 0.2: ап Ратуши-2 и пара ферм/мельница после 4-й минуты
  if (hall && hall.level === 1 && state.t > 240 && !hall.upT) upgrade(state, 'bot', hall.id);
  if (state.t > 300 && !state._botBuilt) {
    const bx = p._baseX ?? state.buildings.find((b) => b.owner === 'bot' && b.type === 'townhall')?.x;
    const bz = p._baseZ ?? state.buildings.find((b) => b.owner === 'bot' && b.type === 'townhall')?.z;
    if (bx !== undefined) {
      if (construct(state, 'bot', 'farm', bx + 16, bz + 6)) state._botBuilt = 1;
      else if (state._botBuilt === 1 && construct(state, 'bot', 'market', bx - 16, bz + 6)) state._botBuilt = 2;
    }
  }
  if (state.t > 420) {
    const anyMarket = state.buildings.some((b) => b.owner === 'bot' && b.type === 'market' && b.hp > 0 && b.buildT <= 0);
    if (anyMarket && p.res.wood > 300) trade(state, 'bot');
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
  // туман 5 Гц (netcode fogHz)
  state.fog.t += dt;
  if (state.fog.t >= 1 / FOG_HZ) {
    state.fog.t = 0;
    updateFog(state);
  }
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
