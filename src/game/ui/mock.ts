// Мок-снапшот для разработки UI без сервера.
// Использование в другом чате:
// import { mockSnap, mockBattleSnap, tickMock } from './mock';
// TopBar.render(mockSnap.resources); SelectionPanel.render(mockSnap.squads[0]);
// setInterval(() => tickMock(mockSnap), 1000); // оживить цифры без WS

export interface MockResources {
  food: number; foodPerSec: number;
  wood: number; woodPerSec: number;
  stone: number; iron: number; gold: number; goldUpkeep: number;
  popUsed: number; popMax: number; morale: number;
}

export interface MockSquad {
  id: number; type: string; hp: number; hpMax: number;
  mor: number; dmg: number; count: number; stance: string;
}

export interface MockHero {
  id: number; name: string; level: number; xp: number; xpNext: number;
  hp: number; hpMax: number; mana: number; manaMax: number;
  qCd: number; qCdMax: number; eCd: number; eCdMax: number;
}

export interface MockSnap {
  simVersion: number;
  tick: number;
  resources: MockResources;
  squads: MockSquad[];
  hero: MockHero;
  flags: { id: string; owner: number; progress: number }[];
  quests: { id: string; text: string; cur: number; need: number }[];
  score?: { mine: number; enemy: number; toWin: number; timeLeftSec: number };
}

export const mockSnap: MockSnap = {
  simVersion: 12,
  tick: 900,
  resources: {
    food: 850, foodPerSec: 4.2,
    wood: 620, woodPerSec: 5.1,
    stone: 300, iron: 180, gold: 800, goldUpkeep: 0.8,
    popUsed: 32, popMax: 50, morale: 72,
  },
  squads: [
    { id: 12, type: 'swords', hp: 1300, hpMax: 1400, mor: 72, dmg: 11, count: 20, stance: 'line' },
    { id: 13, type: 'spears', hp: 900, hpMax: 1200, mor: 45, dmg: 8, count: 20, stance: 'kare' },
    { id: 14, type: 'archers', hp: 560, hpMax: 560, mor: 60, dmg: 6.5, count: 16, stance: 'loose' },
  ],
  hero: {
    id: 1, name: 'Воевода', level: 5, xp: 320, xpNext: 500,
    hp: 1100, hpMax: 1250, mana: 80, manaMax: 150,
    qCd: 0, qCdMax: 40, eCd: 12, eCdMax: 90,
  },
  flags: [
    { id: 'west', owner: 0, progress: 100 },
    { id: 'center', owner: -1, progress: 40 },
    { id: 'east', owner: 1, progress: 100 },
  ],
  quests: [
    { id: 'lumber', text: 'Лесоруб 620/1000', cur: 620, need: 1000 },
    { id: 'flag', text: 'Флаг 2:10/5:00', cur: 130, need: 300 },
    { id: 'skirmish2', text: 'Схватка 1/2', cur: 1, need: 2 },
  ],
};

export const mockBattleSnap: MockSnap = {
  ...mockSnap,
  score: { mine: 420, enemy: 310, toWin: 1000, timeLeftSec: 24 * 60 + 36 },
};

// Оживляет мок без сервера: тикает ресурсы, КД, время. Вызывать раз в секунду.
export function tickMock(s: MockSnap): void {
  s.tick += 15;
  s.resources.food += s.resources.foodPerSec;
  s.resources.wood += s.resources.woodPerSec;
  s.resources.gold -= s.resources.goldUpkeep;
  if (s.hero.qCd > 0) s.hero.qCd -= 1;
  if (s.hero.eCd > 0) s.hero.eCd -= 1;
  if (s.score && s.score.timeLeftSec > 0) {
    s.score.timeLeftSec -= 1;
    s.score.mine += 12 / 10; // ~12/сек как при 2 флагах, для демо
  }
}
