// client/meta — столица, герой, клан, сезон (0.4, локально в localStorage).
// Серверный MAIN (LifeRoom/Colyseus) — задача 0.4-полной; здесь офлайн-прототип по тем же правилам.
const KEY = 'tt_meta_v1';

export function defaultMeta() {
  return {
    capital: { thLevel: 1, gold: 200 },
    hero: { arch: 'warlord', level: 1, xp: 0, gear: {}, inventory: [] },
    clan: { name: '', vault: 0 },
    season: { day: 1, battlesToday: 0, date: new Date().toISOString().slice(0, 10) },
    lastSeen: Date.now(),
  };
}
export function loadMeta() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultMeta();
    const m = { ...defaultMeta(), ...JSON.parse(raw) };
    // новый день — сброс дейли-капа
    const today = new Date().toISOString().slice(0, 10);
    if (m.season.date !== today) {
      m.season.date = today;
      m.season.battlesToday = 0;
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
// Офлайн-доход: 40% от налога столицы, кап 8ч (03-resources)
export function offlineEarnings(m) {
  const awaySec = Math.min(8 * 3600, Math.max(0, (Date.now() - (m.lastSeen || Date.now())) / 1000));
  if (awaySec < 60) return { secs: 0, gold: 0 };
  const rateMin = [0, 5, 8, 12][m.capital.thLevel] || 5;
  const gold = Math.floor(((rateMin / 60) * awaySec * 0.4));
  return { secs: Math.floor(awaySec), gold };
}
export function xpNext(level) {
  return Math.floor(100 * Math.pow(level, 1.5));
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
export function rollGear(rng, tier) {
  const slots = Object.keys(GEAR_POOL);
  const slot = slots[Math.floor(rng() * slots.length)];
  const pool = GEAR_POOL[slot];
  const n = tier === 'blue' ? 2 : 1;
  const stats = {};
  for (let i = 0; i < n; i++) {
    const [k, lo, hi] = pool[Math.floor(rng() * pool.length)];
    const v = lo + rng() * (hi - lo);
    stats[k] = Math.round((stats[k] || 0) + v * 100) / 100;
  }
  return { id: `gear${Date.now().toString(36)}${gearSeq++}`, slot, tier, stats };
}
export function applyBattleResult(m, { win, xp, goldEarned, maxLevel = 15 }) {
  m.season.day = Math.min(90, m.season.day + 1);
  m.season.battlesToday += 1;
  const rw = battleRewards(win, m.season.battlesToday - 1);
  const vaultCut = Math.floor(rw.gold * 0.1); // налог клана 10%
  m.capital.gold += rw.gold - vaultCut + goldEarned;
  m.clan.vault += vaultCut;
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
export function wipeSeason(m) {
  // вайп дня 91 (ручной): столица жмётся, герои/шмот/золото/MMR остаются
  const keepGold = Math.min(5000, m.capital.gold);
  m.capital = { thLevel: 1, gold: keepGold };
  m.season = { day: 1, battlesToday: 0, date: new Date().toISOString().slice(0, 10) };
  saveMeta(m);
}
