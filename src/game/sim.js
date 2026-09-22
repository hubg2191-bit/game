// shared/sim — чистая симуляция боя Схватки 0.1 (без Three.js и DOM).
// Все дистанции GDD (метры) переводятся в мировые единицы через WORLD_SCALE.
// Скорости НЕ масштабируются — иначе 1.5км карта неиграбельна в демо.
// Время найма/постройки и CAPTURE_TUNING — демо-допущения, баланс будет в data/*.json v0.3.

export const WORLD_SCALE = 0.25;
export const SIM_TICK_HZ = 15;
export const FOG_HZ = 5;

// Детерминированный RNG для реплеев (07-tech: реплей = лог команд)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Наём 0.3: базовые списки; уникальные юниты открываются уникальными зданиями своей расы
const BASE_RECRUIT = {
  townhall: ['militia'],
  barracks: ['swords', 'spears'],
  shooting_range: ['archers', 'xbows'],
  stable: ['light_cav', 'heavy_cav'],
  siege_workshop: ['ballista', 'trebuchet'],
  temple: ['healer'],
};
const UNIQUE_UNIT_NEED = { guard_nord: 'hall_nord', nukers: 'tabun_kaganat', halberdiers: 'guild_league' };
export function recruitable(state, pid, btype) {
  const list = [...(BASE_RECRUIT[btype] || [])];
  const race = state.raceOf[pid];
  const R = (state.racesData?.races || []).find((r) => r.id === race);
  if (R && btype === 'barracks' && R.uniqueUnit !== 'nukers'
    && state.buildings.some((b) => b.owner === pid && b.type === R.uniqueBuilding && b.hp > 0)) {
    if (R.uniqueUnit === 'guard_nord' || R.uniqueUnit === 'halberdiers') list.push(R.uniqueUnit);
  }
  if (R && btype === 'stable' && R.uniqueUnit === 'nukers'
    && state.buildings.some((b) => b.owner === pid && b.type === 'tabun_kaganat' && b.hp > 0)) {
    list.push('nukers');
  }
  return list;
}
// MVP_RECRUIT оставлен для совместимости UI 0.1/0.2
export const MVP_RECRUIT = BASE_RECRUIT;

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

export const MVP_BUILD_MENU = [
  'farm', 'house', 'sawmill', 'quarry', 'mine',
  'mill', 'bakery', 'market', 'temple', 'shooting_range', 'stable', 'siege_workshop',
  'tower', 'wall', 'warehouse',
];
// Уникальное здание расы добавляется в меню отдельно (см. buildMenuFor)
export function buildMenuFor(state, pid) {
  const list = [...MVP_BUILD_MENU];
  const R = (state.racesData?.races || []).find((r) => r.id === state.raceOf[pid]);
  if (R && !list.includes(R.uniqueBuilding)) {
    const ix = list.indexOf('siege_workshop');
    list.splice(ix + 1, 0, R.uniqueBuilding);
  }
  return list;
}

const START_RES = { food: 650, wood: 650, stone: 300, iron: 200, gold: 350 };

let nextId = 1;
const nid = () => nextId++;

export function unitById(unitsData, id) {
  return unitsData.squads.find((u) => u.id === id);
}
// def отряда по типу с учётом нейтралов (их нет в units.json) и героев (статы из меты)
export function defOf(state, type, owner) {
  if (type === 'hero') return state.heroStats?.[owner];
  if (owner === 'neutral') return NEUTRAL_DEFS[type];
  return unitById(state.units, type);
}
// Статы героя: база + рост за уровень + шмот (heroes/*.md, leveling-gear.md)
export function computeHeroDef(heroesData, arch, level, gearStats = {}) {
  const H = heroesData.heroes.find((h) => h.id === arch);
  const g = (k) => gearStats[k] || 0;
  const str = H.stats.str + H.growth.str * (level - 1) + g('str');
  const adm = H.stats.adm + H.growth.adm * (level - 1) + g('adm');
  const spi = H.stats.spi + H.growth.spi * (level - 1) + g('spi');
  return {
    id: 'hero', name: H.name, size: 1,
    hpPer: H.base.hp + 60 * (level - 1) + g('hp'),
    dmg: H.base.dmg + (str - H.stats.str) * 3 + g('dmg'),
    armor: H.base.armor, speed: H.base.speed * (1 + g('speed')), range: H.base.range,
    sight: H.base.sight, auraR: H.base.auraR,
    cost: {}, upkeep: { food: 1.0, gold: 0.2 },
    str, adm, spi, manaMax: Math.round(100 + spi * 10 + g('mana')),
  };
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
    loose: false, // рассыпной строй (F): -50% урона по площади
    charge: 0, // разгон кавалерии для чардока
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

// ---------- герои 0.4 ----------
export function heroOf(state, pid) {
  return state.squads.find((s) => s.owner === pid && s.type === 'hero' && s.count > 0);
}
function gearStatsOf(gear = {}) {
  const total = {};
  for (const item of Object.values(gear)) {
    for (const [k, v] of Object.entries(item.stats || {})) total[k] = (total[k] || 0) + v;
  }
  return total;
}
function spawnHero(state, pid, arch, level, gear) {
  const gs = gearStatsOf(gear);
  const def = computeHeroDef(state.heroesData, arch, level, gs);
  state.heroStats[pid] = def;
  const base = state.players[pid];
  const s = addSquad(state, pid, 'hero', base._bx, base._bz + 14, { def });
  s.hero = {
    arch, level, gearMorale: gs.morale || 0,
    mana: def.manaMax, qCd: 0, eCd: 0, xpBattle: 0,
  };
  return s;
}
// Опыт за фраг (leveling-gear.md): засчитывается герою-убийце в радиусе 30м
function awardXp(state, pid, amount) {
  const h = heroOf(state, pid);
  if (h) h.hero.xpBattle += amount;
}
function xpForVictim(state, e) {
  const X = state.heroesData?.xpKills || {};
  if (e.type === 'hero') return X.hero ?? 200;
  if (e.owner === 'neutral') return X[e.type] ?? 50;
  if ((state.heroesData?.eliteTypes || []).includes(e.type)) return X.elite ?? 40;
  if (e.type === 'militia') return X.militia ?? 10;
  return X.base ?? 20;
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

// cfg: { mode: '1v1'|'2v2', races: {player, bot?, ally?, enemy1?, enemy2?}, difficulty: 'easy'|'normal'|'hard', seed,
//        heroesData, hero: {arch, level, gear} }
export const DIFFS = {
  easy: { econ: 0.8, aggro: 3, label: 'Легко' },
  normal: { econ: 1.0, aggro: 2, label: 'Норма' },
  hard: { econ: 1.25, aggro: 2, label: 'Сложно' },
};
export function teamOf(state, pid) {
  if (pid === 'neutral') return null;
  return state.teamMap[pid];
}
export function sameTeam(state, a, b) {
  if (a === 'neutral' || b === 'neutral') return false;
  return state.teamMap[a] === state.teamMap[b];
}

export function createGame(map, unitsData, buildingsData, rules, racesData, cfg = {}) {
  nextId = 1;
  const mode = cfg.mode || '1v1';
  const seed = cfg.seed ?? Math.floor(Math.random() * 1e9);
  const diff = DIFFS[cfg.difficulty] || DIFFS.normal;
  const races = { player: 'nord', ...(cfg.races || {}) };
  const pids = mode === '2v2' ? ['player', 'ally', 'enemy1', 'enemy2'] : ['player', 'bot'];
  if (mode === '2v2') {
    races.ally = races.ally || 'nord';
    races.enemy1 = races.enemy1 || 'kaganat';
    races.enemy2 = races.enemy2 || 'league';
  } else {
    races.bot = races.bot || (races.player === 'kaganat' ? 'league' : 'kaganat');
  }
  const teamMap = mode === '2v2'
    ? { player: 'A', ally: 'A', enemy1: 'B', enemy2: 'B' }
    : { player: 'A', bot: 'B' };
  const mkRes = (raceId) => {
    const base = { ...START_RES, popUsed: 0, popMax: 20, morale: 70 };
    const R = (racesData?.races || []).find((r) => r.id === raceId) || {};
    for (const [k, v] of Object.entries(R.startBonus || {})) base[k] = (base[k] || 0) + v;
    for (const [k, v] of Object.entries(cfg.startBonus || {})) base[k] = (base[k] || 0) + v; // бонусы столицы
    return base;
  };
  const state = {
    map,
    units: unitsData,
    bdefs: buildingsData,
    rules,
    racesData,
    raceOf: races,
    heroesData: cfg.heroesData,
    heroStats: {},
    heroSetup: {},
    respawns: [],
    mode,
    pids,
    teamMap,
    diff,
    seed,
    rng: mulberry32(seed),
    t: 0,
    tick: 0,
    over: false,
    winner: null, // 'A' | 'B'
    reason: '',
    players: Object.fromEntries(pids.map((pid, i) => [pid, {
      id: pid, res: mkRes(races[pid]),
      bot: pid !== 'player', thinkT: 1 + i, townMor: 0, starving: false, tradeLog: [],
      defensive: pid === 'ally', // союзник держит оборону, пушит только большим стаком
    }])),
    buildings: [],
    squads: [],
    flags: map.provinces.map((p) => ({
      id: p.id, x: m(p.x), z: m(p.z), type: p.type, buff: p.buff,
      owner: null, progress: 0, capSec: p.capSec || 120,
    })),
    mines: (map.mines || []).map((pt) => ({ x: m(pt.x), z: m(pt.z) })),
    mineSpots: (map.mines || []).map((pt) => ({ x: m(pt.x), z: m(pt.z) })),
    camps: (map.camps || []).map((c) => ({ type: c.type, x: m(c.x), z: m(c.z) })),
    hills: (map.hills || []).map((h) => ({ x: m(h.x), z: m(h.z), r: 12, h: h.h })),
    forests: (map.provinces || []).filter((p) => p.type === 'forest').map((p) => ({ x: m(p.x), z: m(p.z), r: FOREST_R })),
    river: map.river ? {
      x: m(map.river.x), half: m(map.river.width) / 2,
      bridges: (map.river.bridges || []).map((b) => ({ z: m(b.z), half: m(8) / 2 })),
      ford: map.river.ford ? { z: m(map.river.ford.z), half: m(map.river.ford.width) / 2 } : null,
    } : null,
    score: { A: 0, B: 0 },
    stats: Object.fromEntries(pids.map((pid) => [pid, { kills: 0, losses: 0 }])),
    droppedGear: [], // тиры шмота с лагерей для меты
    lastCombat: null,
    events: [],
    fog: { N: FOG_N, vis: new Uint8Array(FOG_N * FOG_N), exp: new Uint8Array(FOG_N * FOG_N), t: 0 },
  };
  // спавны: 1v1 team0->player team1->bot; 2v2 team0->[player,ally] team1->[enemy1,enemy2]
  const byTeam = { 0: [], 1: [] };
  for (const sp of map.spawns) byTeam[sp.team === 1 ? 1 : 0].push(sp);
  const assign = mode === '2v2'
    ? [['player', byTeam[0][0]], ['ally', byTeam[0][1]], ['enemy1', byTeam[1][0]], ['enemy2', byTeam[1][1]]]
    : [['player', byTeam[0][0]], ['bot', byTeam[1][0]]];
  for (const [pid, sp] of assign) {
    const px = m(sp.x);
    const pz = m(sp.z);
    state.players[pid]._bx = px;
    state.players[pid]._bz = pz;
    const layout = baseLayout(px, pz);
    const R = (racesData?.races || []).find((r) => r.id === races[pid]);
    if (R?.startMarket) layout.push({ type: 'market', x: px + 12, z: pz - 10 });
    for (const slot of layout) addBuilding(state, pid, slot.type, slot.x, slot.z);
    const dz = pid === 'player' || pid === 'ally' ? 8 : -8;
    addSquad(state, pid, 'militia', px - 4, pz + dz);
    addSquad(state, pid, 'swords', px + 4, pz + dz);
  }
  // герои: игрок — из меты, боты — воевода 3 ур. (только если переданы heroesData)
  if (cfg.heroesData) {
    const pHero = cfg.hero || { arch: 'warlord', level: 1, gear: {} };
    state.heroSetup.player = pHero;
    spawnHero(state, 'player', pHero.arch, pHero.level, pHero.gear);
    for (const pid of pids) {
      if (pid === 'player') continue;
      state.heroSetup[pid] = { arch: 'warlord', level: 3, gear: {} };
      spawnHero(state, pid, 'warlord', 3, {});
    }
  }
  spawnNeutrals(state);
  recalcPop(state);
  updateFog(state); // стартовый обзор
  event(state, mode === '2v2' ? 'Бой 2v2 начался! Держите мосты и остров.' : 'Бой начался. Удерживайте флаги и снесите Ратушу врага.');
  return state;
}

function event(state, text, kind = 'info') {
  state.events.push({ t: state.t, text, kind });
  if (state.events.length > 40) state.events.shift();
}

function recalcPop(state) {
  for (const pid of state.pids) {
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
  if (!recruitable(state, pid, b.type).includes(unitId)) return false;
  const p = state.players[pid];
  recalcPop(state);
  if (p.res.popUsed + 1 > p.res.popMax) return false;
  if (!affordable(p.res, u.cost)) return false;
  const cap = squadCap(state, pid);
  const owned = state.squads.filter((s) => s.owner === pid && s.type !== 'hero').length
    + state.buildings.filter((x) => x.owner === pid).reduce((a, x) => a + x.queue.length, 0);
  if (owned >= cap) return false;
  // лимиты элиты (pacing): тяж.кава 3, требушет 2
  if (u.limitPerPlayer) {
    const have = state.squads.filter((s) => s.owner === pid && s.type === unitId).length
      + state.buildings.filter((x) => x.owner === pid)
        .reduce((a, x) => a + x.queue.filter((q) => q.unitId === unitId).length, 0);
    if (have >= u.limitPerPlayer) return false;
  }
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
  if (def.race && state.raceOf[pid] !== def.race) return 'чужая уникалка';
  if (def.needsMill && !state.buildings.some((b) => b.owner === pid && b.type === 'mill' && b.hp > 0)) {
    return 'нужна Мельница';
  }
  if (inWater(state, x, z)) return 'нельзя строить в воде';
  if (typeId === 'wall') {
    if (thLevel(state, pid) < 3) return 'каменные стены — с Ратуши-3';
    const n = state.buildings.filter((b) => b.owner === pid && b.type === 'wall' && b.hp > 0).length;
    if (n >= WALL_MAX) return `лимит стен (${WALL_MAX})`;
    return null;
  }
  if (typeId === 'sawmill') {
    const ok = state.forests.some((f) => (x - f.x) ** 2 + (z - f.z) ** 2 < 20 * 20);
    if (!ok) return 'лесопилка только у леса (в 20м)';
  }
  if (typeId === 'mine') {
    const ok = state.hills.some((h) => (x - h.x) ** 2 + (z - h.z) ** 2 < 15 * 15)
      || state.mineSpots.some((sp) => (x - sp.x) ** 2 + (z - sp.z) ** 2 < 15 * 15);
    if (!ok) return 'шахта только у холмов/рудников';
  }
  return null;
}
export function construct(state, pid, typeId, x, z) {
  if (!buildMenuFor(state, pid).includes(typeId)) return false;
  const def = buildingById(state.bdefs, typeId);
  if (!def) return false;
  const p = state.players[pid];
  const block = buildBlockReason(state, pid, typeId, x, z);
  if (block) {
    if (pid === 'player') event(state, `Нельзя построить: ${block}`, 'combat');
    return false;
  }
  if (typeId === 'wall') {
    // сегмент на сетке 1 ед., цена/HP по wall.md
    const gx = Math.round(x);
    const gz = Math.round(z);
    const busy = state.buildings.some((b) => b.hp > 0 && Math.hypot(b.x - gx, b.z - gz) < 1.2);
    if (busy) {
      if (pid === 'player') event(state, 'Нельзя построить: занято', 'combat');
      return false;
    }
    if ((p.res.stone || 0) < WALL_COST) return false;
    p.res.stone -= WALL_COST;
    const b = addBuilding(state, pid, 'wall', gx, gz, { hp: 1, buildT: 4, buildTotal: 4 });
    b.wallHp = wallHpOf(state, pid);
    recalcPop(state);
    event(state, 'Строится стена');
    return true;
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
// Каст скилла героя (warlord/steward/ranger × Q/E). Возвращает true/false.
export function castSkill(state, pid, heroId, slot, targetRef = null) {
  const h = state.squads.find((s) => s.id === heroId && s.owner === pid && s.type === 'hero' && s.count > 0);
  if (!h) return false;
  const H = state.heroesData.heroes.find((x) => x.id === h.hero.arch);
  const sk = H.skills[slot === 'q' ? 0 : 1];
  if (!sk) return false;
  const cd = slot === 'q' ? h.hero.qCd : h.hero.eCd;
  if (cd > 0 || h.hero.mana < sk.mana) return false;
  const inR = (x, z, r) => Math.hypot(x - h.x, z - h.z) <= r;
  const ownSquadsIn = (r) => state.squads.filter((s) => s.owner === pid && s.count > 0 && inR(s.x, s.z, r));
  const ownBuildingsIn = (r) => state.buildings.filter((b) => b.owner === pid && b.hp > 0 && inR(b.x, b.z, r));
  let ok = false;
  if (sk.id === 'rush') {
    for (const s of ownSquadsIn(sk.radius)) s.rushT = sk.dur;
    ok = true;
  } else if (sk.id === 'unbreakable') {
    for (const s of ownSquadsIn(H.base.auraR)) s.unbrT = sk.dur;
    ok = true;
  } else if (sk.id === 'convoy') {
    const p = state.players[pid];
    p.res.food = Math.min(capOf(state, pid, 'food'), p.res.food + sk.food);
    for (const b of ownBuildingsIn(sk.radius)) {
      if (b.type === 'wall' || b.type === 'siege_workshop' || b.type === 'tower') {
        b.hp = Math.min(b.hpMax, b.hp + sk.repair);
      }
    }
    ok = true;
  } else if (sk.id === 'fortify') {
    for (const b of ownBuildingsIn(sk.radius)) {
      const add = b.hpMax * (sk.shieldMult - 1);
      b.hp += add;
      b.shield = (b.shield || 0) + add;
      b.shieldT = sk.dur;
    }
    ok = true;
  } else if (sk.id === 'ambush') {
    const t = targetRef ? targetPos(state, targetRef) : null;
    if (t && t.count !== undefined && t.owner === pid && inR(t.x, t.z, sk.radius)) {
      t.invisT = sk.dur;
      ok = true;
    }
  } else if (sk.id === 'mark') {
    const t = targetRef ? targetPos(state, targetRef) : null;
    if (t && !sameTeam(state, t.owner, pid) && inR(t.x, t.z, sk.radius)) {
      t.markT = sk.dur;
      ok = true;
    }
  }
  if (!ok) return false;
  h.hero.mana -= sk.mana;
  if (slot === 'q') h.hero.qCd = sk.cd;
  else h.hero.eCd = sk.cd;
  event(state, `${H.name}: ${sk.name}!`, 'combat');
  return true;
}
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
    if (o.owner === s.owner || sameTeam(state, o.owner, s.owner) || o.count <= 0) continue;
    if (o.invisT > 0) continue; // засада: не видят
    const d = (o.x - s.x) ** 2 + (o.z - s.z) ** 2;
    if (d < bestD) { bestD = d; best = { kind: 'squad', id: o.id }; }
  }
  for (const b of state.buildings) {
    if (b.hp <= 0 || sameTeam(state, b.owner, s.owner)) continue;
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
// Река v0.3 (skirmish-river): вода -40%, мосты — чок без штрафа, брод -20%
export function waterMult(state, x, z) {
  const r = state.river;
  if (!r) return 1;
  if (Math.abs(x - r.x) > r.half) return 1;
  for (const b of r.bridges) if (Math.abs(z - b.z) < b.half) return 1;
  if (r.ford && Math.abs(z - r.ford.z) < r.ford.half) return 0.8;
  return 0.6;
}
export function inWater(state, x, z) {
  const r = state.river;
  if (!r) return false;
  if (Math.abs(x - r.x) > r.half) return false;
  for (const b of r.bridges) if (Math.abs(z - b.z) < b.half) return false;
  if (r.ford && Math.abs(z - r.ford.z) < r.ford.half) return false;
  return true;
}
// Стены v0.3: сегмент 4м, камень 900 HP/сегмент, 120 камня
export const WALL_SEG_M = 4;
export const WALL_HP = 900 * WALL_SEG_M;
export const WALL_COST = 120;
export const WALL_MAX = 30;
export function wallHpOf(state, pid) {
  const R = (state.racesData?.races || []).find((r) => r.id === state.raceOf[pid]) || {};
  return Math.round(WALL_HP * (R.wallHpMult || 1));
}
// Отталкивание от стен (стенам нет ворот в 0.3 — стройте с проходами)
function collideWalls(state, s) {
  for (const b of state.buildings) {
    if (b.type !== 'wall' || b.hp <= 0 || b.buildT > 0) continue;
    const dx = s.x - b.x;
    const dz = s.z - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.1 && d > 0.001) {
      s.x = b.x + (dx / d) * 1.1;
      s.z = b.z + (dz / d) * 1.1;
    }
  }
}
// Удар по площади (требушет): своим — 50% дружурон, рассыпному строю — 50% (05-units)
function aoeStrike(state, s, tx, tz) {
  const def = defOf(state, s.type, s.owner);
  const R = m(def.aoeR || 6);
  for (const v of state.squads) {
    if (v.count <= 0 || v.id === s.id) continue;
    const d = Math.hypot(v.x - tx, v.z - tz);
    if (d > R) continue;
    const own = sameTeam(state, v.owner, s.owner);
    if (own && v.owner === 'neutral') continue;
    let mult = own ? 0.5 : 1;
    if (v.loose) mult *= 0.5;
    dealDamage(state, s, { kind: 'squad', id: v.id }, mult);
  }
}
// Бонус баллисты МК-II Лиги при живой Гильдии (+20% урон, +5м дальность)
function siegeBonus(state, s) {
  if (s.type !== 'ballista') return { dmg: 1, range: 0 };
  const league = state.raceOf[s.owner] === 'league';
  const guild = state.buildings.some((b) => b.owner === s.owner && b.type === 'guild_league' && b.hp > 0 && b.buildT <= 0);
  return league && guild ? { dmg: 1.2, range: m(5) } : { dmg: 1, range: 0 };
}
// Эффективная мораль: база + аура храма/холла/воеводы (+10 рядом) + запах хлеба
export function effMor(state, s) {
  let m = s.mor;
  if (nearOwn(state, s.owner, 'temple', s.x, s.z, TEMPLE_AURA)) m += 10;
  if (nearOwn(state, s.owner, 'hall_nord', s.x, s.z, 7.5)) m += 10;
  const wh = heroOf(state, s.owner);
  if (wh && wh.hero.arch === 'warlord' && wh.id !== s.id
    && Math.hypot(s.x - wh.x, s.z - wh.z) <= 5.5) m += 10;
  if (s.type === 'hero' && s.hero) m += s.hero.gearMorale || 0;
  if (state.players[s.owner]?.townMor) m += state.players[s.owner].townMor;
  return m;
}
export function sightOf(state, b) {
  if (b.count !== undefined) {
    let sg = SIGHT.squad;
    if (b.type === 'hero') {
      const hd = defOf(state, 'hero', b.owner);
      sg = hd?.sight || sg;
    }
    // аура следопыта: +30% обзор своим рядом
    const rh = heroOf(state, b.owner);
    if (rh && rh.hero.arch === 'ranger' && rh.id !== b.id
      && Math.hypot(b.x - rh.x, b.z - rh.z) <= 5.5) sg *= 1.3;
    return sg;
  }
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
  const srcRanged = !def ? true : (def.range || 0) > 0;
  let dmg = baseDmg * mult;
  if (def && e.type && CAV_IDS.has(e.type) && def.bonusVsCav) dmg *= def.bonusVsCav;
  if (def && e.count !== undefined) {
    // пробитие по тяжелой броне (xbows 1.5, halberdiers 2.0)
    const eDef = defOf(state, e.type, e.owner);
    if (def.bonusVsHeavy && eDef.armor === 'heavy') dmg *= def.bonusVsHeavy;
    // резисты к стрелам (combat-v02 EHP): medium 0.85, heavy 0.7
    if (srcRanged && eDef.armor === 'medium') dmg *= 0.85;
    if (srcRanged && eDef.armor === 'heavy') dmg *= 0.7;
  }
  // метка следопыта: x1.3
  if (e.markT > 0) dmg *= 1.3;
  const fm = e.count !== undefined ? flankMultOf(state, src, e) : 1;
  dmg *= fm;
  // аура воеводы: +5% урона ближним рядом
  if (def && (def.range || 0) === 0 && e.count !== undefined) {
    const wh = heroOf(state, src.owner);
    if (wh && wh.hero.arch === 'warlord' && Math.hypot(src.x - wh.x, src.z - wh.z) <= 5.5) dmg *= 1.05;
  }
  // атака снимает засаду
  if (src.invisT) src.invisT = 0;
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
    // здания: стены — осадные x1.5, пехота 50% (wall.md)
    let bm = 1;
    if (e.type === 'wall' && def) {
      const siege = src.type === 'ballista' || src.type === 'trebuchet';
      const melee = (def.range || 0) === 0;
      bm = siege ? 1.5 : melee ? 0.5 : 1;
    }
    e.hp -= dmg * bm;
  }
}

function onSquadWiped(state, src, e) {
  const killer = state.players[src.owner] ? src.owner : null;
  const bodies = e.soldiers.length;
  if (killer) {
    state.stats[killer].kills += bodies;
    const ks = state.squads.find((x) => x.id === src.id);
    if (ks) ks.kills += bodies;
    // опыт герою-убийце в радиусе 30м (следопыт +20% с лагерей)
    const h = heroOf(state, killer);
    if (h && Math.hypot(h.x - e.x, h.z - e.z) <= 7.5) {
      let xp = xpForVictim(state, e);
      if (e.owner === 'neutral' && h.hero.arch === 'ranger') xp = Math.round(xp * 1.2);
      awardXp(state, killer, xp);
    }
  }
  if (state.stats[e.owner]) state.stats[e.owner].losses += bodies;
  state.lastCombat = { x: e.x, z: e.z, t: state.t };
  if (e.owner === 'neutral') {
    const nd = NEUTRAL_DEFS[e.type];
    if (nd && killer) {
      const p = state.players[killer];
      const R = (state.racesData?.races || []).find((r) => r.id === state.raceOf[killer]);
      const loot = R?.lootMult || 1; // каганат: грабеж +30%
      const parts = [];
      for (const [k, v] of Object.entries(nd.reward)) {
        const amt = Math.round(v * (k === 'gold' || k === 'food' ? loot : 1));
        p.res[k] = Math.min(capOf(state, killer, k), p.res[k] + amt);
        parts.push(`+${amt} ${k === 'food' ? 'еды' : 'золота'}`);
      }
      if (killer === 'player') event(state, `Лагерь зачищен (${nd.name}): ${parts.join(', ')}`, 'flag');
      // шмот с бандитов: серый всегда, синий 20% (loot фиксируется в s.droppedGear)
      if (e.type === 'bandits' && killer === 'player') {
        e.droppedGear = state.rng() < 0.2 ? 'blue' : 'gray';
        state.droppedGear.push(e.droppedGear);
      }
    }
  } else {
    event(state, `Отряд ${defOf(state, e.type, e.owner).name} (${e.owner}) уничтожен`, 'combat');
  }
  // смерть героя: респаун 30 сек у Ратуши, уровень сохраняется
  if (e.type === 'hero') {
    state.respawns.push({ pid: e.owner, t: state.heroesData?.respawnSec ?? 30 });
    event(state, `Герой ${e.owner === 'player' ? 'пал! Респаун 30 сек.' : 'врага повержен! +200 XP'}`, 'combat');
  }
}

function updateSquad(state, s, dt) {
  if (s.count <= 0) return;
  const def = defOf(state, s.type, s.owner);
  s.atkCd -= dt;
  // тики баффов/меток/засады
  if (s.rushT > 0) s.rushT -= dt;
  if (s.unbrT > 0) s.unbrT -= dt;
  if (s.invisT > 0) s.invisT -= dt;
  if (s.markT > 0) s.markT -= dt;
  // герой: мана и кулдауны
  if (s.hero) {
    s.hero.mana = Math.min(def.manaMax, s.hero.mana + 2 * dt);
    s.hero.qCd = Math.max(0, s.hero.qCd - dt);
    s.hero.eCd = Math.max(0, s.hero.eCd - dt);
  }
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
      if (!state.players[o.owner]) continue; // нейтралы дерутся только с игроками
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

  // --- бегство (порог по эффективной морали; несгибаемые игнорят) ---
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
  if (effMor(state, s) < (state.rules.moraleFlee ?? 30) && !s.unbrT) {
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

  // --- лекарь: лечит своих в 15м (6 HP/сек), не атакует ---
  if (s.type === 'healer') {
    let best = null;
    let bestMissing = 0;
    for (const o of state.squads) {
      if (o.owner !== s.owner || o.count <= 0 || o.id === s.id) continue;
      if (Math.hypot(o.x - s.x, o.z - s.z) > m(15)) continue;
      const missing = o.hpCap - o.hp;
      if (missing > bestMissing) { bestMissing = missing; best = o; }
    }
    if (best && bestMissing > 1) {
      s.face = Math.atan2(best.x - s.x, best.z - s.z);
      best.hp = Math.min(best.hpCap, best.hp + 6 * dt);
      const per = defOf(state, best.type, best.owner).hpPer;
      best.count = Math.max(best.count, Math.ceil(best.hp / per));
    }
  }

  const sb = siegeBonus(state, s);
  const range = m(def.range || 0) * (def.range ? 1 : 0) + sb.range + 1.2;
  const minR = m(def.minRange || 0);
  const period = def.reload || (def.range ? RANGED_PERIOD_DEFAULT : MELEE_PERIOD);

  let moveX = null;
  let moveZ = null;
  let tgtRef = s.order && s.order.kind === 'attack' ? s.order.target : null;
  let tgt = tgtRef ? targetPos(state, tgtRef) : null;
  if (s.order && s.order.kind === 'attack' && !tgt) { s.order = null; tgtRef = null; }
  if (!tgt && s.type !== 'healer' && (!s.order || s.order.kind === 'attackmove')) {
    const found = nearestEnemy(state, s, AGGRO_RADIUS);
    if (found) { tgtRef = found; tgt = targetPos(state, found); }
  }
  if (tgt && s.type !== 'healer') {
    const d = Math.hypot(tgt.x - s.x, tgt.z - s.z);
    if (d <= range) {
      s.face = Math.atan2(tgt.x - s.x, tgt.z - s.z);
      if (s.atkCd <= 0) {
        s.atkCd = period;
        let mult = sb.dmg;
        const p = state.players[s.owner];
        if (p.res.gold <= 0 && (def.upkeep?.gold || 0) > 0) mult *= 0.8; // нет золота на upkeep
        // чардж кавалерии: разгон >1.5с — light x1.8, heavy x2 первые удары
        if ((s.type === 'light_cav' && s.charge > 1.5) || (s.type === 'heavy_cav' && s.charge > 1.5)) {
          mult *= s.type === 'heavy_cav' ? 2.0 : 1.8;
        }
        s.charge = 0;
        if (def.aoe) {
          aoeStrike(state, s, tgt.x, tgt.z);
        } else {
          dealDamage(state, s, tgtRef, mult);
        }
      }
    } else if (minR > 0 && d < minR) {
      // мин.дистанция осадных: отъехать
      moveX = s.x + (s.x - tgt.x);
      moveZ = s.z + (s.z - tgt.z);
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
    let speed = def.speed;
    if (s.rushT > 0) speed *= 1.3; // рывок воеводы
    // каганат +15% каве; табун +10% каве рядом
    if (CAV_IDS.has(s.type)) {
      const R = (state.racesData?.races || []).find((r) => r.id === state.raceOf[s.owner]) || {};
      speed *= R.cavSpeedMult || 1;
      if (nearOwn(state, s.owner, 'tabun_kaganat', s.x, s.z, 6.25)) speed *= 1.1;
    }
    speed *= waterMult(state, s.x, s.z); // река -40%
    const step = Math.min(d, speed * dt);
    s.x += ((moveX - s.x) / d) * step;
    s.z += ((moveZ - s.z) / d) * step;
    s.charge = (s.charge || 0) + dt; // разгон для чардока
    collideWalls(state, s);
  }
  // хил кавалерии у табуна 2%/сек вне боя
  collideWalls(state, s); // стены держат всех (и бегущих тоже)
  if (CAV_IDS.has(s.type) && state.t - s.lastDmgT > 6
    && nearOwn(state, s.owner, 'tabun_kaganat', s.x, s.z, 6.25) && s.hp < s.hpCap) {
    s.hp = Math.min(s.hpCap, s.hp + s.hpMax * 0.02 * dt);
    s.count = Math.max(s.count, Math.ceil(s.hp / def.hpPer));
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
  for (const pid of state.pids) {
    const p = state.players[pid];
    const R = (state.racesData?.races || []).find((r) => r.id === state.raceOf[pid]) || {};
    const econMult = p.bot ? state.diff.econ : 1; // сложность двигает только ботов
    const goldMult = R.goldMult || 1; // лига +15% золота
    const prod = { food: 0, wood: 0, stone: 0, iron: 0, gold: 0 };
    let eaters = 0;
    let goldUp = 0;
    const team = teamOf(state, pid);
    const woodBuff = state.flags.some((f) => f.owner === team && (f.buff || '').includes('wood')) ? 1.15 : 1;
    const goldBuff = state.flags.some((f) => f.owner === team && (f.buff || '').includes('gold')) ? 1.1 : 1;
    const stoneBuff = state.flags.some((f) => f.owner === team && (f.buff || '').includes('stone')) ? 1.15 : 1;
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
      if (def.stonePerSec) prod.stone += def.stonePerSec * stoneBuff;
      if (def.ironPerSec) prod.iron += def.ironPerSec;
      if (b.type === 'market') prod.gold += (6 / 60) * goldMult; // +6 з/мин
      if (def.taxGoldPerMin) {
        // у Ратуши налог — массив по уровням, у остальных — число
        const tax = Array.isArray(def.taxGoldPerMin) ? def.taxGoldPerMin[b.level - 1] : def.taxGoldPerMin;
        prod.gold += ((tax / 60) * goldBuff * goldMult);
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
    p.res.food += (prod.food * econMult - eaters * 0.02 - foodUp) * dt;
    p.res.wood += prod.wood * econMult * dt;
    p.res.stone += prod.stone * econMult * dt;
    p.res.iron += prod.iron * econMult * dt;
    p.res.gold = Math.max(0, p.res.gold + (prod.gold * econMult - goldUp) * dt);
    p.res.food = Math.max(0, p.res.food);
    // капы складов
    for (const k of ['food', 'wood', 'stone', 'iron']) p.res[k] = Math.min(capOf(state, pid, k), p.res[k]);
    // голод: найм -30%, мораль -15/мин (обрабатывается в updateSquad/updateQueues)
    const starving = p.res.food <= 0;
    if (starving && !p.starving) {
      const msg = pid === 'player' ? 'ГОЛОД! Стройте фермы.'
        : team === 'A' ? 'Союзник голодает!' : 'У врага голод!';
      event(state, msg, 'combat');
    }
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
        const full = b.type === 'wall' ? (b.wallHp || WALL_HP) : (Array.isArray(def.hp) ? def.hp[0] : def.hp || 500);
        b.hp = b.hpMax = full;
        recalcPop(state);
        if (b.owner === 'player') event(state, `Построено: ${b.type === 'wall' ? 'Стена' : def.name}`);
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
    // голод: найм -30% скорости; норд: казармы +20%; наместник: стройка +15% рядом
    const R = (state.racesData?.races || []).find((r) => r.id === state.raceOf[b.owner]) || {};
    const slow = state.players[b.owner]?.starving ? 0.7 : 1;
    const fast = b.type === 'barracks' && R.barracksSpeed ? R.barracksSpeed : 1;
    const stw = heroOf(state, b.owner);
    const stewardAura = stw && stw.hero.arch === 'steward'
      && Math.hypot(b.x - stw.x, b.z - stw.z) <= 5.5 ? 1.15 : 1;
    q.t -= dt * slow * fast * stewardAura;
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
      if (s.count <= 0 || sameTeam(state, s.owner, b.owner)) continue;
      if (s.invisT > 0 && Math.hypot(s.x - b.x, s.z - b.z) > 5) continue; // башни видят засаду в 20м
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
    let nA = 0;
    let nB = 0;
    for (const s of state.squads) {
      if (s.count <= 0 || s.owner === 'neutral') continue;
      if ((s.x - f.x) ** 2 + (s.z - f.z) ** 2 > CAPTURE_RADIUS * CAPTURE_RADIUS) continue;
      if (teamOf(state, s.owner) === 'A') nA += s.count;
      else nB += s.count;
    }
    if (nA >= CAPTURE_MIN_SOLDIERS && nB < CAPTURE_MIN_SOLDIERS && f.owner !== 'A') {
      f.progress += dt * (nA / 10) / (f.capSec / CAPTURE_TUNING);
      if (f.progress >= 1) {
        f.owner = 'A';
        f.progress = 0;
        event(state, `Флаг ${f.id} захвачен!`, 'flag');
        for (const s of state.squads) {
          if (s.type === 'hero' && s.count > 0 && teamOf(state, s.owner) === 'A') s.hero.xpBattle += 150;
        }
      }
    } else if (nB >= CAPTURE_MIN_SOLDIERS && nA < CAPTURE_MIN_SOLDIERS && f.owner !== 'B') {
      f.progress += dt * (nB / 10) / (f.capSec / CAPTURE_TUNING);
      if (f.progress >= 1) {
        f.owner = 'B';
        f.progress = 0;
        event(state, `Враг захватил флаг ${f.id}!`, 'flag');
      }
    } else {
      f.progress = Math.max(0, f.progress - dt * 0.05);
    }
  }
  const owned = { A: 0, B: 0 };
  for (const f of state.flags) if (f.owner) owned[f.owner]++;
  const rate = (n) => (n >= 3 ? rates['3flags'] : n === 2 ? rates['2flags'] : n === 1 ? rates['1flag'] : 0) || 0;
  state.score.A += rate(owned.A) * dt;
  state.score.B += rate(owned.B) * dt;
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
    if (teamOf(state, s.owner) !== 'A' || s.count <= 0) continue;
    paint(s.x, s.z, SIGHT.squad, false);
  }
  for (const b of state.buildings) {
    if (teamOf(state, b.owner) !== 'A' || b.hp <= 0 || b.buildT > 0) continue;
    paint(b.x, b.z, sightOf(state, b), b.type === 'tower');
  }
}
// Видно ли сущность команде игрока: свои всегда; чужие — только в обзоре;
// в лесу скрыты дальше STEALTH_DIST (башни видят скрытых в своём обзоре).
export function isVisible(state, e) {
  if (teamOf(state, e.owner) === 'A') return true;
  const idx = fogCell(state, e.x, e.z);
  if (!state.fog.vis[idx]) return false;
  if (e.count !== undefined && inForest(state, e.x, e.z)) {
    // рядом свой?
    for (const s of state.squads) {
      if (teamOf(state, s.owner) !== 'A' || s.count <= 0) continue;
      if (Math.hypot(s.x - e.x, s.z - e.z) < STEALTH_DIST) return true;
    }
    // башня видит скрытых в своём обзоре (20м)
    for (const b of state.buildings) {
      if (teamOf(state, b.owner) !== 'A' || b.type !== 'tower' || b.hp <= 0 || b.buildT > 0) continue;
      if (Math.hypot(b.x - e.x, b.z - e.z) < SIGHT.tower) return true;
    }
    return false;
  }
  return true;
}

function updateBot(state, dt) {
  for (const pid of state.pids) {
    const p = state.players[pid];
    if (!p.bot) continue;
    p.thinkT -= dt;
    if (p.thinkT > 0) continue;
    p.thinkT = BOT_THINK;
    recalcPop(state);
    const R = state.rng;
    // найм: ополчение + случайное из казармы; с конюшней — иногда кава
    const hall = state.buildings.find((b) => b.owner === pid && b.type === 'townhall' && b.hp > 0 && b.buildT <= 0);
    const barr = state.buildings.find((b) => b.owner === pid && b.type === 'barracks' && b.hp > 0 && b.buildT <= 0);
    const stab = state.buildings.find((b) => b.owner === pid && b.type === 'stable' && b.hp > 0 && b.buildT <= 0);
    if (hall && hall.queue.length < 2) recruit(state, pid, hall.id, 'militia');
    if (barr && barr.queue.length < 2) {
      const pool = recruitable(state, pid, 'barracks').filter((u) => u !== 'militia');
      const pick = pool[Math.floor(R() * pool.length)] || 'swords';
      if (!recruit(state, pid, barr.id, pick)) recruit(state, pid, barr.id, 'swords');
    }
    if (stab && stab.queue.length < 1 && R() < 0.5) {
      const pool = recruitable(state, pid, 'stable');
      recruit(state, pid, stab.id, pool[Math.floor(R() * pool.length)]);
    }
    if (hall && hall.level === 1 && state.t > 240 && !hall.upT) upgrade(state, pid, hall.id);
    if (hall && hall.level === 2 && state.t > 900 && !hall.upT) upgrade(state, pid, hall.id);
    // стройка: ферма -> рынок/мельница -> конюшня к лейту
    const bx = p._bx;
    const bz = p._bz;
    if (state.t > 300 && bx !== undefined) {
      const step = p._buildStep || 0;
      const plan = [
        ['farm', 16, 6], ['market', -16, 6], ['farm', 16, -8],
        ['stable', -20, -10], ['shooting_range', 20, -10], ['temple', -12, 14],
      ];
      if (step < plan.length && construct(state, pid, plan[step][0], bx + plan[step][1], bz + plan[step][2])) {
        p._buildStep = step + 1;
      } else if (step < plan.length && state.t - (p._buildT || 0) > 30) {
        p._buildT = state.t; // не топчемся: пропускаем ход
        p._buildStep = step + 1;
      }
    }
    if (state.t > 420) {
      const anyMarket = state.buildings.some((b) => b.owner === pid && b.type === 'market' && b.hp > 0 && b.buildT <= 0);
      if (anyMarket && p.res.wood > 300) trade(state, pid);
    }
    // атака: союзник держится до 3 отрядов, остальные идут от aggro
    const need = p.defensive ? 3 : state.diff.aggro;
    const army = state.squads.filter((s) => s.owner === pid && s.count > 0 && !s.order && s.type !== 'hero');
    if (army.length >= need) {
      const myTeam = teamOf(state, pid);
      const free = state.flags.find((f) => f.owner !== myTeam);
      const foeTH = state.buildings.find((b) => b.type === 'townhall' && b.hp > 0 && !sameTeam(state, b.owner, pid));
      const dest = (army.length >= need + 2 && foeTH) ? foeTH : free || foeTH;
      if (dest) {
        for (const s of army) s.order = { kind: 'attackmove', x: dest.x, z: dest.z, target: null };
        // герой идёт с армией и жмёт рывок
        const hh = heroOf(state, pid);
        if (hh) {
          hh.order = { kind: 'attackmove', x: dest.x, z: dest.z, target: null };
          if (hh.hero.arch === 'warlord') castSkill(state, pid, hh.id, 'q');
        }
        if (myTeam === 'B' && pid === state.pids.find((q) => state.players[q].bot && teamOf(state, q) === 'B')) {
          event(state, 'Враг наступает!', 'combat');
        }
      }
    }
  }
}

export function update(state, dt) {
  if (state.over) return;
  state.t += dt;
  state.tick += 1;
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
  // респаун героев 30 сек у Ратуши
  for (let i = state.respawns.length - 1; i >= 0; i--) {
    const rp = state.respawns[i];
    rp.t -= dt;
    if (rp.t <= 0) {
      state.respawns.splice(i, 1);
      const setup = state.heroSetup[rp.pid];
      const th = state.buildings.find((b) => b.owner === rp.pid && b.type === 'townhall' && b.hp > 0);
      if (setup && th) {
        const s = spawnHero(state, rp.pid, setup.arch, setup.level, setup.gear);
        s.x = th.x + 4;
        s.z = th.z + 8;
        recalcPop(state);
        if (rp.pid === 'player') event(state, 'Герой вернулся в строй!', 'flag');
      }
    }
  }
  // условия победы — по командам
  const winScore = state.map.winScore || 1000;
  const aliveTH = (team) => state.buildings.some((b) => b.type === 'townhall' && b.hp > 0 && teamOf(state, b.owner) === team);
  if (!aliveTH('B') || state.score.A >= winScore) {
    state.over = true;
    state.winner = 'A';
    state.reason = !aliveTH('B') ? 'Ратуши врага разрушены' : 'Доминация: 1000 очков';
  } else if (!aliveTH('A') || state.score.B >= winScore) {
    state.over = true;
    state.winner = 'B';
    state.reason = !aliveTH('A') ? 'Ваша Ратуша разрушена' : 'Враг набрал 1000 очков';
  }
  // разрушенные здания, спад щитов/меток, респаун героев
  for (const b of state.buildings) {
    if (b.shieldT > 0) {
      b.shieldT -= dt;
      if (b.shieldT <= 0) {
        b.hp = Math.min(b.hp, b.hpMax);
        b.shield = 0;
      }
    }
    if (b.markT > 0) b.markT -= dt;
    if (b.hp <= 0 && !b.ruined) {
      b.ruined = true;
      const def = buildingById(state.bdefs, b.type);
      event(state, `${teamOf(state, b.owner) === 'A' ? 'Потеряно' : 'Уничтожено'}: ${def.name}`, 'combat');
      recalcPop(state);
    }
  }
}
