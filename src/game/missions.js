// client/missions — 5 миссий обучения (quests-seasons/onboarding.md).
// Бот пассивен (difficulty 'passive'), сетапы выдают нужное; награды — в мету.
export const MISSIONS = [
  {
    id: 'm1', name: 'Дома и еда', time: '7 мин',
    briefing: 'Постройте 3 дома и 2 фермы, не уйдите в голод. Награда: 100 золота.',
    reward: { gold: 100 },
    objectives: [
      { id: 'houses', text: 'Дома: 3 (есть 2)', check: (s) => countB(s, 'house') >= 3 },
      { id: 'farms', text: 'Фермы: 2 (есть 1)', check: (s) => countB(s, 'farm') >= 2 },
      { id: 'alive', text: 'Продержитесь 2 мин без голода', check: (s) => s.t > 120 && !s.players.player.starving },
    ],
  },
  {
    id: 'm2', name: 'Производство', time: '7 мин',
    briefing: 'Постройте лесопилку у леса и кузницу, сделайте 1 улучшение. Награда: синее оружие.',
    reward: { gear: 'blue-weapon' },
    objectives: [
      { id: 'saw', text: 'Лесопилка у леса', check: (s) => countB(s, 'sawmill') >= 2 },
      { id: 'forge', text: 'Кузница', check: (s) => countB(s, 'forge') >= 1 },
      { id: 'up', text: '1 улучшение (кузница или Ратуша-2)', check: (s) => (s.upgrades.player?.forge || 0) >= 1 || thLv(s) >= 2 },
    ],
  },
  {
    id: 'm3', name: 'Первый отряд', time: '7 мин',
    briefing: 'Наймите мечников и лучников, зачистите волков. Награда: 200 XP герою.',
    reward: { xp: 200 },
    setup(s) {
      // выдаём Ратушу-2, стрельбище и кузницу авансом
      const th = s.buildings.find((b) => b.owner === 'player' && b.type === 'townhall');
      th.level = 2; th.hp = th.hpMax = 5000;
      const p = s.players.player;
      Object.assign(p.res, { wood: 800, stone: 500, food: 600 });
      const { construct } = setupHelpers(s);
      construct('shooting_range', th.x + 25, th.z);
      construct('forge', th.x - 25, th.z);
    },
    objectives: [
      { id: 'sw', text: 'Наймите мечников', check: (s) => hasSquad(s, 'swords') },
      { id: 'ar', text: 'Наймите лучников', check: (s) => hasSquad(s, 'archers') },
      { id: 'wolf', text: 'Убейте стаю волков', check: (s) => s.squads.filter((x) => x.owner === 'neutral' && x.type === 'wolves').reduce((a, x) => a + x.count, 0) <= 6 },
    ],
  },
  {
    id: 'm4', name: 'Герой и флаг', time: '7 мин',
    briefing: 'Ваш герой — Следопыт. Захватите любой флаг и удерживайте. Награда: 300 XP.',
    reward: { xp: 300 },
    hero: 'ranger',
    objectives: [
      { id: 'flag', text: 'Захватите любой флаг', check: (s) => s.flags.some((f) => f.owner === 'A' || f.owner === 'player') },
      { id: 'hold', text: 'Удерживайте флаг 2 мин суммарно', check: (s) => s.t > 240 && s.flags.some((f) => f.owner === 'A' || f.owner === 'player') },
    ],
  },
  {
    id: 'm5', name: 'Полная схватка', time: 'до победы',
    briefing: '1v1 против легкого бота на Равнине. Победа любым способом. Награда: 500 золота.',
    reward: { gold: 500 },
    vsEasy: true,
    objectives: [
      { id: 'win', text: 'Победите бота', check: () => false }, // победа = конец матча
    ],
  },
];

function countB(s, type) {
  return s.buildings.filter((b) => b.owner === 'player' && b.type === type && b.hp > 0 && b.buildT <= 0).length;
}
function hasSquad(s, type) {
  return s.squads.some((x) => x.owner === 'player' && x.type === type);
}
function thLv(s) {
  return s.buildings.find((b) => b.owner === 'player' && b.type === 'townhall')?.level || 0;
}
// Мгновенная достройка для сетапов (без читов в бою)
function setupHelpers(s) {
  return {
    construct(type, x, z) {
      // напрямую через внутренний конструкт: создаём готовое здание (id из счётчика стейта)
      s.buildings.push({
        id: s.nextId++,
        type, owner: 'player', x, z,
        hp: 1000, hpMax: 1000, level: 1, queue: [],
        rally: { x: x + 6, z: z + 6 }, cd: 0, buildT: 0, buildTotal: 0,
      });
    },
  };
}
export function setupMission(state, id) {
  const m = MISSIONS.find((x) => x.id === id);
  if (m?.setup) m.setup(state);
}
export function missionProgress(state, id) {
  const m = MISSIONS.find((x) => x.id === id);
  return m.objectives.map((o) => {
    let done = false;
    try {
      done = !!o.check(state);
    } catch {
      done = false;
    }
    return { id: o.id, text: o.text, done };
  });
}
export function missionDone(state, id) {
  return missionProgress(state, id).every((o) => o.done);
}
