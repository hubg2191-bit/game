// client/meta — столица, герой, клан, сезон (0.4, локально в localStorage).
// Серверный MAIN (LifeRoom/Colyseus) — задача 0.4-полной; здесь офлайн-прототип по тем же правилам.
const KEY = 'tt_meta_v1';

export function defaultMeta() {
  return {
    capital: { thLevel: 1, gold: 200 },
    hero: { arch: 'warlord', level: 1, xp: 0, gear: {}, inventory: [], perks: [] },
    stats: { kills: 0, built: 0, marks: 0, wins: 0, maxSquads: 0, flagsCapped: 0 },
    quests: { date: new Date().toISOString().slice(0, 10), prog: {}, done: [] },
    clan: { name: '', vault: 0, points: 0 },
    shield: { until: Date.now() + 72 * 3600 * 1000, active: true }, // щит новичка 72ч
    vacationUntil: 0,
    buffUntil: 0, // реванш: +50% XP/золота после 14+ дней офлайна
    track: { done: [] }, // 7-дневка новичка
    season: { day: 1, battlesToday: 0, date: new Date().toISOString().slice(0, 10) },
    lastSeen: Date.now(),
  };
}
export function loadMeta() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultMeta();
    const d = defaultMeta();
    const m = { ...d, ...JSON.parse(raw) };
    m.hero = { ...d.hero, ...(m.hero || {}) };
    m.stats = { ...d.stats, ...(m.stats || {}) };
    m.capital = { ...d.capital, ...(m.capital || {}) };
    m.clan = { ...d.clan, ...(m.clan || {}) };
    m.season = { ...d.season, ...(m.season || {}) };
    m.shield = { ...d.shield, ...(m.shield || {}) };
    m.track = { done: [], ...d.track, ...(m.track || {}) };
    if (m.shield.until && Date.now() > m.shield.until) m.shield.active = false;
    // новый день — сброс дейли-капа
    const today = new Date().toISOString().slice(0, 10);
    if (m.season.date !== today) {
      m.season.date = today;
      m.season.battlesToday = 0;
    }
    if (!m.quests || m.quests.date !== today) {
      m.quests = { date: today, prog: {}, done: [] };
    }
    return m;
  } catch {
    return defaultMeta();
  }
}
export function saveMeta(m) {
  m.lastSeen = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch { /* ignore */ }
}
// Офлайн-доход: 40% от налога столицы, кап 8ч (03-resources). В отпуске — 0.
export function offlineEarnings(m) {
  if (m.vacationUntil && Date.now() < m.vacationUntil) return { secs: 0, gold: 0, vacation: true };
  const awaySec = Math.min(8 * 3600, Math.max(0, (Date.now() - (m.lastSeen || Date.now())) / 1000));
  if (awaySec < 60) return { secs: 0, gold: 0 };
  const rateMin = [0, 5, 8, 12][m.capital.thLevel] || 5;
  const gold = Math.floor(((rateMin / 60) * awaySec * 0.4));
  return { secs: Math.floor(awaySec), gold };
}
// Возвращение после 14+ дней: бафф Реванш 3 дня (+50% XP/золота)
export function checkComeback(m) {
  const awayDays = (Date.now() - (m.lastSeen || Date.now())) / 86400000;
  if (awayDays >= 14) {
    m.buffUntil = Date.now() + 3 * 86400000;
    saveMeta(m);
    return true;
  }
  return false;
}
// 7-дневка новичка (onboarding.md): проверка + выдача
export const TRACK = [
  { id: 'd1', name: 'День 1: Ратуша-2', check: (m) => m.capital.thLevel >= 2, reward: { gold: 100 } },
  { id: 'd2', name: 'День 2: 5 отрядов', check: (m) => (m.stats.maxSquads || 0) >= 5, reward: { xp: 150 } },
  { id: 'd3', name: 'День 3: 1 провинция', check: (m) => (m.stats.flagsCapped || 0) >= 1, reward: { gold: 150 } },
  { id: 'd4', name: 'День 4: герой 5 ур.', check: (m) => m.hero.level >= 5, reward: { xp: 200 } },
  { id: 'd5', name: 'День 5: вступи в клан', check: (m) => !!(m.clan.name || '').trim(), reward: { gold: 200 } },
  { id: 'd6', name: 'День 6: выиграй схватку', check: (m) => (m.stats.wins || 0) >= 1, reward: { xp: 300 } },
  { id: 'd7', name: 'День 7: переживи рейд (2 победы)', check: (m) => (m.stats.wins || 0) >= 2, reward: { purpleAmulet: true } },
];
export function claimTrack(m, id, maxLevel = 30) {  const t = TRACK.find((x) => x.id === id);
  if (!t || (m.track.done || []).includes(id) || !t.check(m)) return null;
  m.track.done.push(id);
  if (t.reward.gold) m.capital.gold += t.reward.gold;
  if (t.reward.xp) {
    m.hero.xp += t.reward.xp;
    while (m.hero.level < maxLevel && m.hero.xp >= xpNext(m.hero.level)) {
      m.hero.xp -= xpNext(m.hero.level);
      m.hero.level += 1;
    }
  }
  if (t.reward.purpleAmulet) {
    m.hero.inventory.push({ id: `gear${Date.now().toString(36)}track`, slot: 'amulet', tier: 'purple', stats: { mana: 50, spi: 4, hp: 80 } });
    m.shield = { until: Date.now() + 24 * 3600 * 1000, active: true }; // +щит новичка 24ч
  }
  saveMeta(m);
  return t;
}
export function xpNext(level) {
  return Math.floor(100 * Math.pow(level, 1.5));
}
// Сезонный магазин: фиолет за очки клана (leveling-gear.md)
export const SEASON_SHOP = [
  { id: 'shop-purple', name: 'Фиолет (случайный)', cost: 500, give: { tier: 'purple' } },
  { id: 'shop-blue-weapon', name: 'Синее оружие', cost: 200, give: { tier: 'blue', slot: 'weapon' } },
  { id: 'shop-gold', name: '500 золота', cost: 100, give: { gold: 500 } },
];
export function buyShop(m, itemId) {
  const item = SEASON_SHOP.find((x) => x.id === itemId);
  if (!item || (m.clan.points || 0) < item.cost) return null;
  m.clan.points -= item.cost;
  if (item.give.gold) m.capital.gold += item.give.gold;
  else m.hero.inventory.push(rollGear(Math.random, item.give.tier, item.give.slot || null));
  saveMeta(m);
  return item;
}
// Награды схватки (01-modes, leveling-gear): победа 500з+800xp, поражение 150+300; с 4-го боя дня — 20%
export function battleRewards(win, battlesToday) {
  const factor = battlesToday < 3 ? 1 : 0.2;
  return {
    gold: Math.floor((win ? 500 : 150) * factor),
    xp: Math.floor((win ? 800 : 300) * factor),
    capped: battlesToday >= 3,
  };
}
// Генерация шмота с лагерей: серый 1 стат, синий 20% 2 стата (leveling-gear)
const GEAR_POOL = {
  weapon: [['dmg', 4, 9], ['str', 2, 4], ['spi', 2, 4]],
  armor: [['hp', 60, 150], ['str', 1, 3], ['morale', 3, 6]],
  mount: [['speed', 0.05, 0.12], ['spi', 1, 3], ['hp', 40, 100]],
  amulet: [['mana', 20, 50], ['adm', 2, 4], ['spi', 2, 4]],
};
let gearSeq = 1;
export function rollGear(rng, tier, forceSlot = null) {
  const slots = Object.keys(GEAR_POOL);
  const slot = forceSlot || slots[Math.floor(rng() * slots.length)];
  const pool = GEAR_POOL[slot];
  const n = tier === 'purple' ? 3 : tier === 'blue' ? 2 : 1;
  const stats = {};
  for (let i = 0; i < n; i++) {
    const [k, lo, hi] = pool[Math.floor(rng() * pool.length)];
    const v = lo + rng() * (hi - lo);
    stats[k] = Math.round((stats[k] || 0) + v * 100) / 100;
  }
  return { id: `gear${Date.now().toString(36)}${gearSeq++}`, slot, tier, stats };
}
// Крафт фиолета: синяя вещь + 800 золота, столица ур.2+
export function craftPurple(m, itemId) {
  const ix = (m.hero.inventory || []).findIndex((it) => it.id === itemId && it.tier === 'blue');
  if (ix < 0 || m.capital.thLevel < 2 || m.capital.gold < 800) return null;
  const [blue] = m.hero.inventory.splice(ix, 1);
  m.capital.gold -= 800;
  const purple = rollGear(Math.random, 'purple', blue.slot);
  m.hero.inventory.push(purple);
  saveMeta(m);
  return purple;
}
// Невыбранные перки: уровни 5..тек по 5, где ни один вариант не взят
export function pendingPerks(m, heroesData) {
  const rows = ((heroesData.perks || {})[m.hero.arch] || []);
  return rows.filter((row) => row.level <= m.hero.level
    && !row.options.some((o) => (m.hero.perks || []).includes(o.id)));
}
// Квесты таверны: прогресс за матч + выдача наград
export function settleQuests(m, questsData, match) {
  // match: {wood, food, neutrals, flagSec, battles, orders, heroKills, built, marks, heroArch, wins}
  const today = new Date().toISOString().slice(0, 10);
  if (m.quests.date !== today) m.quests = { date: today, prog: {}, done: [] };
  const done = [];
  const prog = m.quests.prog;
  const add = (qid, cur, need, gold, xp) => {
    if (m.quests.done.includes(qid)) return;
    prog[qid] = Math.min(need, (prog[qid] || 0) + cur);
    if (prog[qid] >= need) {
      m.quests.done.push(qid);
      m.capital.gold += gold;
      const h = m.hero;
      h.xp += xp;
      while (h.level < 30 && h.xp >= xpNext(h.level)) {
        h.xp -= xpNext(h.level);
        h.level += 1;
      }
      done.push(`Квест выполнен: +${gold}🪙 +${xp} XP`);
    }
  };
  for (const q of questsData.dailies || []) {
    if (q.res === 'wood') add(q.id, match.wood, q.need, q.gold, q.xp);
    else if (q.res === 'food') add(q.id, match.food, q.need, q.gold, q.xp);
    else if (q.res === 'neutrals_killed') add(q.id, match.neutrals, q.need, q.gold, q.xp);
    else if (q.needSec) add(q.id, match.flagSec, q.needSec, q.gold, q.xp);
    else if (q.id === 'skirmish2' && match.orders >= (q.minOrders || 50)) {
      add(q.id, 1, q.need, q.gold, q.xp);
    }
  }
  for (const q of questsData.heroQuests || []) {
    if (match.heroArch !== q.hero) continue;
    if (q.id === 'kill30') add(`hq_${q.id}`, match.heroKills, q.need, q.gold, q.xp);
    else if (q.id === 'build3') add(`hq_${q.id}`, match.built, q.need, q.gold, q.xp);
    else if (q.id === 'marks5') add(`hq_${q.id}`, match.marks, q.need, q.gold, q.xp);
  }
  m.stats.kills += match.heroKills;
  m.stats.built += match.built;
  m.stats.marks += match.marks;
  saveMeta(m);
  return done;
}
export function applyBattleResult(m, { win, xp, goldEarned, maxLevel = 15 }) {
  m.season.day = Math.min(90, m.season.day + 1);
  m.season.battlesToday += 1;
  const rw = battleRewards(win, m.season.battlesToday - 1);
  // реванш: +50% после долгого офлайна
  const buff = m.buffUntil && Date.now() < m.buffUntil ? 1.5 : 1;
  rw.gold = Math.floor(rw.gold * buff);
  rw.xp = Math.floor(rw.xp * buff);
  const vaultCut = Math.floor(rw.gold * 0.1); // налог клана 10%
  m.capital.gold += rw.gold - vaultCut + goldEarned;
  m.clan.vault += vaultCut;
  m.clan.points = (m.clan.points || 0) + (win ? 100 : 30); // очки сезона (season-structure)
  if (win) m.stats.wins = (m.stats.wins || 0) + 1;
  // опыт герою
  const h = m.hero;
  h.xp += rw.xp + xp;
  while (h.level < maxLevel && h.xp >= xpNext(h.level)) {
    h.xp -= xpNext(h.level);
    h.level += 1;
  }
  saveMeta(m);
  return rw;
}
export function wipeSeason(m) {  // вайп дня 91 (ручной): столица жмётся, герои/шмот/золото/MMR остаются
  const keepGold = Math.min(5000, m.capital.gold);
  m.capital = { thLevel: 1, gold: keepGold };
  m.clan.points = 0; // очки клана в 0
  m.season = { day: 1, battlesToday: 0, date: new Date().toISOString().slice(0, 10) };
  saveMeta(m);
}
// Награда миссии: без дейли-капа и без +дня (обучение)
export function grantMissionReward(m, reward, maxLevel = 30) {
  const out = [];
  if (reward.gold) {
    m.capital.gold += reward.gold;
    out.push(`+${reward.gold}🪙`);
  }
  if (reward.xp) {
    const h = m.hero;
    h.xp += reward.xp;
    while (h.level < maxLevel && h.xp >= xpNext(h.level)) {
      h.xp -= xpNext(h.level);
      h.level += 1;
    }
    out.push(`+${reward.xp} XP`);
  }
  if (reward.gear === 'blue-weapon') {
    const item = rollGear(Math.random, 'blue', 'weapon');
    m.hero.inventory.push(item);
    out.push('синее оружие!');
  }
  saveMeta(m);
  return out.join(' ');
}
// Автосезон: день >90 — вайп сам (1.0)
export function autoSeason(m) {
  if (m.season.day > 90) {
    wipeSeason(m);
    return true;
  }
  return false;
}
