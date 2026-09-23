// Схватка 0.3: лобби (карта/раса/сложность), MMR, реплеи (сид + лог приказов), сим 15 Гц + рендер.
import './style.css';
import * as THREE from 'three';
import {
  createGame, update, orderMove, orderAttack, recruit, construct, upgrade, trade, castSkill,
  setDirective, giveAlly, forgeUpgrade, formationOffsets,
  SIM_TICK_HZ, WORLD_SCALE, DIFFS, teamOf, defOf, heroOf,
} from './game/sim.js';
import { NetClient, getWssUrl } from './game/net.js';
import { GameRender } from './game/render.js';
import { GameUI } from './game/ui.js';
import {
  loadMeta, saveMeta, offlineEarnings, applyBattleResult, wipeSeason, rollGear,
  grantMissionReward, autoSeason, settleQuests, craftPurple, pendingPerks, xpNext,
} from './game/meta.js';
import { MISSIONS, setupMission, missionProgress, missionDone } from './game/missions.js';
import unitsData from './game/data/units.json';
import buildingsData from './game/data/buildings.json';
import palette from './game/data/palette.json';
import racesData from './game/data/races.json';
import heroesData from './game/data/heroes.json';
import questsData from './game/data/quests.json';
import mapPlain from './game/data/maps/skirmish-plain.json';
import mapRiver from './game/data/maps/skirmish-river.json';
import mapPass from './game/data/maps/skirmish-pass.json';

const MAPS = [
  { id: 'plain', name: 'Равнина 1v1', data: mapPlain, mode: '1v1' },
  { id: 'river', name: 'Речная долина 2v2', data: mapRiver, mode: '2v2' },
  { id: 'pass', name: 'Перевал FFA', data: mapPass, mode: 'ffa' },
];
const rules = unitsData.rules;
const app = document.querySelector('#app');
app.innerHTML = `<div id="scene"></div><div id="hud"></div><div id="rubber"></div>`;
const sceneEl = app.querySelector('#scene');
const rubber = app.querySelector('#rubber');

let mmr = Number(localStorage.getItem('tt_mmr') || 1000);
const unitName = (type, owner) => {
  try {
    return defOf(window.__state, type, owner)?.name || type;
  } catch {
    return type;
  }
};

function ndcOf(e, renderer) {
  const r = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

function startMatch(lobbyCfg, replayRec = null, meta = null) {
  sceneEl.innerHTML = '';
  const mission = lobbyCfg.mission ? MISSIONS.find((m) => m.id === lobbyCfg.mission) : null;
  const map = mission ? MAPS[0] : MAPS.find((m) => m.id === lobbyCfg.map) || MAPS[0];
  const capLv = meta?.capital.thLevel || 1;
  const cfg = {
    mode: map.mode,
    races: { player: lobbyCfg.race },
    difficulty: mission ? (mission.vsEasy ? 'easy' : 'passive') : lobbyCfg.difficulty,
    seed: replayRec ? replayRec.seed : Math.floor(Math.random() * 1e9),
    heroesData,
    hero: replayRec?.hero || {
      arch: mission?.hero || meta?.hero.arch || 'warlord',
      level: meta?.hero.level || 1,
      gear: meta?.hero.gear || {},
      perks: meta?.hero.perks || [],
    },
    startBonus: { gold: 100 * (capLv - 1), food: 50 * (capLv - 1) }, // бонусы столицы
    missionNoEnd: !!mission && mission.id !== 'm5',
  };
  // ботам — случайные другие расы (детерминировано из сида)
  const raceIds = racesData.races.map((r) => r.id).filter((r) => r !== cfg.races.player);
  if (map.mode === '2v2') {
    cfg.races.ally = raceIds[0];
    cfg.races.enemy1 = raceIds[1] || raceIds[0];
    cfg.races.enemy2 = raceIds[0];
  } else {
    cfg.races.bot = raceIds[0];
  }
  const state = createGame(map.data, unitsData, buildingsData, rules, racesData, cfg);
  window.__state = state;
  if (mission) setupMission(state, mission.id);
  const render = new GameRender(sceneEl, state, palette);
  const sel = { squads: [], building: null };
  const groups = {};
  let buildMode = null;
  let attackMode = false;
  let started = !replayRec;
  const isReplay = !!replayRec;
  const rec = replayRec || { seed: cfg.seed, cfg: lobbyCfg, hero: cfg.hero, orders: [] };
  let replayIdx = 0;
  let pendingSkill = null; // 'q' | 'e' для прицельных скиллов (засада/метка)
  ui.pendingSkill = null;

  const heroAlive = () => state.squads.find((s) => s.owner === 'player' && s.type === 'hero' && s.count > 0);
  const record = (fn, args) => {
    if (isReplay || !started || state.over) return;
    rec.orders.push({ tick: state.tick, fn, args });
  };
  // Античит 1.0: лимит 10 приказов/сек, спам режется
  const apmTimes = [];
  let apmCount = 0;
  const apmTick = () => {
    const now = performance.now();
    while (apmTimes.length && now - apmTimes[0] > 1000) apmTimes.shift();
    apmCount = apmTimes.length;
  };
  const throttle = () => {
    apmTick();
    if (apmTimes.length >= 10) return false;
    apmTimes.push(performance.now());
    apmCount = apmTimes.length;
    return true;
  };

  const ui = new GameUI(app.querySelector('#hud'), {
    onRecruit: (bId, unitId) => {
      if (isReplay || !throttle()) return;
      if (recruit(state, 'player', bId, unitId)) record('recruit', ['player', bId, unitId]);
    },
    onUpgrade: (bId) => {
      if (isReplay || !throttle()) return;
      if (upgrade(state, 'player', bId)) record('upgrade', ['player', bId]);
    },
    onTrade: () => {
      if (isReplay || !throttle()) return;
      if (trade(state, 'player')) record('trade', ['player']);
    },
    onGive: () => {
      if (isReplay || !throttle()) return;
      if (giveAlly(state, 'player')) record('give', ['player']);
    },
    onForgeUp: (bId) => {
      if (isReplay || !throttle()) return;
      if (forgeUpgrade(state, 'player', bId)) record('forgeUp', ['player', bId]);
    },
    onBuild: (typeId) => {
      buildMode = buildMode === typeId ? null : typeId;
      ui.buildMode = buildMode;
    },
    onStop: () => {
      for (const s of state.squads) {
        if (sel.squads.includes(s.id)) s.order = { kind: 'move', x: s.x, z: s.z };
      }
    },
    onSkill: (slot) => {
      if (isReplay || !started || !throttle()) return;
      const h = heroAlive();
      if (!h) return;
      const H = heroesData.heroes.find((x) => x.id === h.hero.arch);
      const sk = H.skills[slot === 'q' ? 0 : 1];
      if (pendingSkill === slot) {
        pendingSkill = null;
        ui.pendingSkill = null;
        return;
      }
      if (sk.id === 'ambush' || sk.id === 'mark') {
        // прицельные: следующий клик — цель
        if (h.hero[slot === 'q' ? 'qCd' : 'eCd'] <= 0 && h.hero.mana >= sk.mana) {
          pendingSkill = slot;
          ui.pendingSkill = slot;
        }
        return;
      }
      if (castSkill(state, 'player', h.id, slot)) record('skill', ['player', h.id, slot, null]);
    },
  });

  const canvas = render.renderer.domElement;
  const keys = {};
  const W = map.data.size_m * WORLD_SCALE;

  const doMoveOrder = (x, z) => {
    if (isReplay || !started || !throttle()) return;
    orderMove(state, sel.squads, x, z);
    record('orderMove', [sel.squads.slice(), x, z]);
  };
  const doAttackOrder = (ent) => {
    if (isReplay || !started || !throttle()) return;
    orderAttack(state, sel.squads, ent);
    record('orderAttack', [sel.squads.slice(), ent]);
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  let dragStart = null;
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || isReplay) return;
    dragStart = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!dragStart) return;
    const x = Math.min(dragStart.x, e.clientX);
    const y = Math.min(dragStart.y, e.clientY);
    const w = Math.abs(e.clientX - dragStart.x);
    const h = Math.abs(e.clientY - dragStart.y);
    rubber.style.display = w + h > 10 ? 'block' : 'none';
    rubber.style.transform = `translate(${x}px, ${y}px)`;
    rubber.style.width = `${w}px`;
    rubber.style.height = `${h}px`;
  });
  canvas.addEventListener('mouseup', (e) => {
    if (isReplay) return;
    if (e.button === 2) {
      if (buildMode) {
        buildMode = null;
        ui.buildMode = null;
        return;
      }
      const pt = render.groundPoint(ndcOf(e, render.renderer));
      const ent = render.pick(ndcOf(e, render.renderer));
      if (pt && sel.squads.length) {
        if (ent && (ent.kind === 'squad' || ent.kind === 'building')) {
          const target = ent.kind === 'squad'
            ? state.squads.find((s) => s.id === ent.id)
            : state.buildings.find((b) => b.id === ent.id);
          if (target && teamOf(state, target.owner) !== 'A' && target.hp > 0
            && (target.count === undefined || target.count > 0)) {
            doAttackOrder(ent);
            return;
          }
        }
        doMoveOrder(pt.x, pt.z);
      }
      return;
    }
    if (e.button !== 0 || !dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 10) {
      const x0 = Math.min(dragStart.x, e.clientX);
      const y0 = Math.min(dragStart.y, e.clientY);
      const x1 = Math.max(dragStart.x, e.clientX);
      const y1 = Math.max(dragStart.y, e.clientY);
      const v = new THREE.Vector3();
      sel.squads = state.squads
        .filter((s) => s.owner === 'player' && s.count > 0)
        .filter((s) => {
          v.set(s.x, 1, s.z).project(render.camera);
          const sx = (v.x * 0.5 + 0.5) * innerWidth;
          const sy = (-v.y * 0.5 + 0.5) * innerHeight;
          return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
        })
        .map((s) => s.id);
      sel.building = null;
    } else {
      const pt = render.groundPoint(ndcOf(e, render.renderer));
      const ent = render.pick(ndcOf(e, render.renderer));
      if (e.altKey && pt && state.pids.includes('ally')) {
        // Alt+клик — пинг атаки союзнику (controls.md)
        setDirective(state, { kind: 'attack', x: pt.x, z: pt.z });
        record('directive', [{ kind: 'attack', x: pt.x, z: pt.z }]);
      } else if (pendingSkill && ent) {
        // прицельный скилл героя
        const h = heroAlive();
        if (h && castSkill(state, 'player', h.id, pendingSkill, ent)) {
          record('skill', ['player', h.id, pendingSkill, ent]);
        }
        pendingSkill = null;
        ui.pendingSkill = null;
      } else if (attackMode && pt && sel.squads.length) {
        if (ent && (ent.kind === 'squad' || ent.kind === 'building')) {
          const target = ent.kind === 'squad'
            ? state.squads.find((s) => s.id === ent.id)
            : state.buildings.find((b) => b.id === ent.id);
          if (target && teamOf(state, target.owner) !== 'A' && target.hp > 0) {
            doAttackOrder(ent);
            attackMode = false;
            dragStart = null;
            rubber.style.display = 'none';
            return;
          }
        }
        doMoveOrder(pt.x, pt.z);
        attackMode = false;
      } else if (buildMode && pt) {
        if (construct(state, 'player', buildMode, pt.x, pt.z)) {
          record('construct', ['player', buildMode, pt.x, pt.z]);
          buildMode = null;
          ui.buildMode = null;
        }
      } else if (ent) {
        if (ent.kind === 'squad') {
          const s = state.squads.find((x) => x.id === ent.id);
          if (s && s.owner === 'player') {
            sel.squads = e.shiftKey ? [...new Set([...sel.squads, s.id])] : [s.id];
            sel.building = null;
          }
        } else {
          const b = state.buildings.find((x) => x.id === ent.id);
          if (b && b.owner === 'player' && b.hp > 0) {
            sel.building = b.id;
            sel.squads = [];
          }
        }
      } else {
        sel.squads = [];
        sel.building = null;
      }
    }
    dragStart = null;
    rubber.style.display = 'none';
  });
  canvas.addEventListener('dblclick', (e) => {
    if (isReplay) return;
    const ent = render.pick(ndcOf(e, render.renderer));
    if (!ent || ent.kind !== 'squad') return;
    const proto = state.squads.find((s) => s.id === ent.id);
    if (!proto || proto.owner !== 'player') return;
    const v = new THREE.Vector3();
    sel.squads = state.squads
      .filter((s) => s.owner === 'player' && s.type === proto.type && s.count > 0)
      .filter((s) => {
        v.set(s.x, 1, s.z).project(render.camera);
        return v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
      })
      .map((s) => s.id);
    sel.building = null;
  });
  ui.minimap.addEventListener('mousedown', (e) => {
    if (e.button !== 2 || isReplay || !sel.squads.length) return;
    e.preventDefault();
    const r = ui.minimap.getBoundingClientRect();
    doMoveOrder(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * W);
  });
  ui.minimap.addEventListener('contextmenu', (e) => e.preventDefault());

  const onKey = (e) => {
    keys[e.code] = true;
    if (isReplay) return;
    if (e.code === 'Escape') {
      buildMode = null;
      ui.buildMode = null;
      attackMode = false;
      pendingSkill = null;
      ui.pendingSkill = null;
    }
    if (!started || state.over) return;
    if (e.code === 'KeyA') attackMode = true;
    if (e.code === 'F1' && state.pids.includes('ally')) {
      // пинг атаки в центр экрана
      const t = render.controls.target;
      setDirective(state, { kind: 'attack', x: t.x, z: t.z });
      record('directive', [{ kind: 'attack', x: t.x, z: t.z }]);
    }
    if (e.code === 'F2' && state.pids.includes('ally')) {
      setDirective(state, { kind: 'defend' });
      record('directive', [{ kind: 'defend' }]);
    }
    if (e.code === 'F4' && state.pids.includes('ally')) {
      setDirective(state, { kind: 'follow' });
      record('directive', [{ kind: 'follow' }]);
    }
    if (e.code === 'KeyS') {
      for (const s of state.squads) {
        if (sel.squads.includes(s.id)) s.order = { kind: 'move', x: s.x, z: s.z };
      }
    }
    if (e.code === 'KeyF' && sel.squads.length) {
      // рассыпной строй вкл/выкл
      for (const s of state.squads) {
        if (sel.squads.includes(s.id)) s.loose = !s.loose;
      }
      record('loose', [sel.squads.slice()]);
    }
    if (e.code === 'KeyH') {
      const th = state.buildings.find((b) => b.owner === 'player' && b.type === 'townhall' && b.hp > 0);
      if (th) {
        render.controls.target.set(th.x, 0, th.z);
        render.camera.position.set(th.x, 55, th.z + 60);
      }
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.lastCombat) {
        render.controls.target.set(state.lastCombat.x, 0, state.lastCombat.z);
        render.camera.position.set(state.lastCombat.x, 55, state.lastCombat.z + 60);
      }
    }
    const digit = e.code.match(/^Digit([0-9])$/);
    if (digit) {
      const n = digit[1];
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        groups[n] = [...sel.squads];
      } else if (groups[n]?.length) {
        sel.squads = groups[n].filter((id) => state.squads.some((s) => s.id === id && s.owner === 'player'));
        sel.building = null;
      }
    }
  };
  const onKeyUp = (e) => (keys[e.code] = false);
  addEventListener('keydown', onKey);
  addEventListener('keyup', onKeyUp);

  function panCamera(dt) {
    const sp = 40 * dt;
    const fwd = new THREE.Vector3();
    render.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x).negate();
    const mv = new THREE.Vector3();
    // A занята под атаку (controls.md) — камера на стрелках + WSD
    if (keys.KeyW || keys.ArrowUp) mv.add(fwd);
    if (keys.KeyS || keys.ArrowDown) {
      if (!sel.squads.length || keys.ArrowDown) mv.sub(fwd);
    }
    if (keys.KeyD || keys.ArrowRight) mv.add(right);
    if (keys.ArrowLeft) mv.sub(right);
    if (mv.lengthSq() > 0) {
      mv.normalize().multiplyScalar(sp);
      render.camera.position.add(mv);
      render.controls.target.add(mv);
    }
  }

  // --- реплей ---
  const replay = isReplay ? { state, playing: true, speed: 1 } : null;
  const applyRec = {
    orderMove: (a) => orderMove(state, a[0].filter((id) => state.squads.some((s) => s.id === id)), a[1], a[2]),
    orderAttack: (a) => orderAttack(state, a[0].filter((id) => state.squads.some((s) => s.id === id)), a[1]),
    recruit: (a) => recruit(state, a[0], a[1], a[2]),
    construct: (a) => construct(state, a[0], a[1], a[2], a[3]),
    upgrade: (a) => upgrade(state, a[0], a[1]),
    trade: (a) => trade(state, a[0]),
    give: (a) => giveAlly(state, a[0]),
    forgeUp: (a) => forgeUpgrade(state, a[0], a[1]),
    directive: (a) => setDirective(state, a[0]),
    skill: (a) => {
      // id героя может смениться после респауна — ищем живого героя владельца
      const h = state.squads.find((s) => s.owner === a[0] && s.type === 'hero' && s.count > 0);
      if (h) castSkill(state, a[0], h.id, a[2], a[3]);
    },
    loose: (a) => {
      for (const s of state.squads) if (a[0].includes(s.id)) s.loose = !s.loose;
    },
  };

  // финиш миссии 1-4: награда в мету, выход к столице
  let finished = false;
  function finishMission() {
    if (finished) return;
    finished = true;
    let text = '';
    if (meta && !isReplay) {
      text = grantMissionReward(meta, mission.reward, heroesData.maxLevel);
    }
    ui.objectives(null);
    ui.showMissionEnd(mission, text);
  }
  function finishMatch() {
    if (finished) return;
    finished = true;
    const win = state.mode === 'ffa' ? state.winner === 'player' : state.winner === 'A';
    mmr = Math.max(100, Math.min(3000, mmr + (win ? 25 : -20)));
    localStorage.setItem('tt_mmr', String(mmr));
    let rewardText = '';
    if (meta && !isReplay) {
      const heroSq = state.squads.find((s) => s.owner === 'player' && s.type === 'hero');
      const xp = heroSq?.hero.xpBattle || 0;
      const rw = applyBattleResult(meta, { win, xp, goldEarned: 0, maxLevel: heroesData.maxLevel });
      rewardText = `Награды: +${rw.gold}🪙 +${rw.xp + xp} XP${rw.capped ? ' (дейли-кап!)' : ''}`;
      if (mission?.id === 'm5' && win) {
        rewardText += ' • Миссия: ' + grantMissionReward(meta, mission.reward, heroesData.maxLevel);
      }
      for (const tier of state.droppedGear) {
        const item = rollGear(Math.random, tier);
        meta.hero.inventory.push(item);
      }
      if (state.droppedGear.length) rewardText += ` • Шмот: ${state.droppedGear.length} шт.`;
      saveMeta(meta);
      // квесты таверны + автосезон
      const qdone = settleQuests(meta, questsData, {
        wood: state.quest.wood, food: state.quest.food, neutrals: state.quest.neutrals,
        flagSec: state.quest.flagSec, battles: 1, orders: rec.orders.length,
        heroKills: state.quest.heroKills || 0, built: state.quest.built,
        marks: state.quest.marks, heroArch: meta.hero.arch, wins: win ? 1 : 0,
      });
      if (qdone.length) rewardText += ' • ' + qdone.join(' • ');
      if (autoSeason(meta)) rewardText += ' • Новый сезон (авто-вайп)!';
    }
    try {
      localStorage.setItem('tt_last_replay', JSON.stringify(rec));
    } catch { /* переполнение — не критично */ }
    ui.showEnd(state.winner, state.reason, state.score, state.stats, state.squads, {
      state, unitName, mmr, rewardText,
      onReplay: isReplay ? null : () => {
        cancelAnimationFrame(raf);
        removeEventListener('keydown', onKey);
        removeEventListener('keyup', onKeyUp);
        startMatch(rec.cfg, JSON.parse(localStorage.getItem('tt_last_replay')), meta);
      },
    });
  }

  let acc = 0;
  let last = performance.now();
  let raf = 0;
  const STEP = 1 / SIM_TICK_HZ;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    if (isReplay) {
      if (replay.playing && !state.over) {
        acc += dt * replay.speed;
        let n = 0;
        while (acc >= STEP && n < 10 && !state.over) {
          while (replayIdx < rec.orders.length && rec.orders[replayIdx].tick <= state.tick) {
            const o = rec.orders[replayIdx++];
            try {
              applyRec[o.fn]?.(o.args);
            } catch { /* приказ устарел */ }
          }
          update(state, STEP);
          acc -= STEP;
          n++;
        }
      }
      panCamera(dt);
      render.sync(state, { squads: [], building: null }, dt);
      ui.update(state, { squads: [], building: null });
      ui.heroPanel(state, heroesData);
      ui.refreshReplayBar();
      if (state.over) {
        replay.playing = false;
        finishMatch();
      }
      return;
    }
    if (!started || state.over) {
      render.sync(state, sel, dt);
      if (started && state.over) finishMatch();
      return;
    }
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      update(state, STEP);
      acc -= STEP;
      n++;
      if (state.over) break;
    }
    panCamera(dt);
    render.sync(state, sel, dt);
    apmTick();
    ui.update(state, sel, apmCount);
    ui.heroPanel(state, heroesData);
    if (mission && mission.id !== 'm5' && started && !state.over) {
      const prog = missionProgress(state, mission.id);
      ui.objectives(prog);
      if (prog.every((o) => o.done)) {
        ui.objectives(null);
        finishMission();
        return;
      }
    }
    if (state.over) finishMatch();
  }

  addEventListener('resize', () => render.resize());
  if (isReplay) {
    ui.buildMode = null;
    ui.showReplayBar(replay, () => location.reload());
  } else {
    ui.update(state, sel);
    ui.heroPanel(state, heroesData);
  }
  requestAnimationFrame(frame);
}

// --- онлайн: сервер авторитетен, клиент — вьюха из снапшотов + мгновенные маркеры ---
function upsertSquad(view, e) {
  let s = view.squads.find((x) => x.id === e.id);
  if (!s) {
    s = { id: e.id, soldiers: [], order: null, atkCd: 0, fleeT: 0, lastDmgT: -99, home: null, charge: 0, kills: 0 };
    view.squads.push(s);
  }
  s.type = e.t;
  s.owner = e.o;
  s.x = e.x;
  s.z = e.z;
  s.hp = e.hp;
  s.hpMax = e.hm;
  s.hpCap = e.hm;
  s.count = e.c;
  s.mor = e.m;
  s.face = e.f;
  s.loose = !!e.l;
  s.markT = e.mk ? 8 : 0;
  s.invisT = e.iv ? 8 : 0;
  if (!s.size || e.c > s.size) s.size = e.c;
  const want = s.size;
  if (!s.soldiers || s.soldiers.length !== want) {
    s.soldiers = formationOffsets(want).map((o) => ({ dx: o.dx, dz: o.dz, alive: true }));
  }
  let aliveN = 0;
  for (const sol of s.soldiers) {
    sol.alive = aliveN < e.c;
    if (sol.alive) aliveN++;
  }
  s.hero = e.hero ? { arch: e.hero.arch, level: e.hero.level, mana: e.hero.mana || 0, mm: e.hero.mm || 100, qCd: e.hero.q || 0, eCd: e.hero.e || 0, xpBattle: e.hero.xp || 0 } : undefined;
}
function upsertBuilding(view, e) {
  let b = view.buildings.find((x) => x.id === e.id);
  if (!b) {
    b = { id: e.id, rally: { x: e.x + 6, z: e.z + 6 }, cd: 0 };
    view.buildings.push(b);
  }
  b.type = e.t;
  b.owner = e.o;
  b.x = e.x;
  b.z = e.z;
  b.hp = e.hp;
  b.hpMax = e.hm;
  b.level = e.lv;
  b.queue = (e.q || []).map((q) => ({ unitId: q.u, t: q.t, total: q.total || q.t }));
  b.buildT = e.bt;
  b.buildTotal = e.bt0;
  b.upT = e.up;
  b.shieldT = e.sh ? 30 : 0;
  b.markT = e.mk ? 8 : 0;
}
function applySnapToView(view, snap) {
  if (snap.full) {
    view.squads = [];
    view.buildings = [];
  }
  for (const e of snap.up || []) {
    if (e.k === 's') upsertSquad(view, e);
    else upsertBuilding(view, e);
  }
  for (const d of snap.del || []) {
    if (d.k === 's') view.squads = view.squads.filter((x) => x.id !== d.id);
    else view.buildings = view.buildings.filter((x) => x.id !== d.id);
  }
  if (snap.flags) {
    for (const f of snap.flags) {
      const t = view.flags.find((x) => x.id === f.id);
      if (t) {
        t.owner = f.o;
        t.progress = f.p;
      }
    }
  }
  if (snap.score) view.score = snap.score;
  if (snap.res) Object.assign(view.players.player.res, snap.res);
  if (snap.t != null) view.t = snap.t;
  if (snap.snap != null) view.tick = snap.snap;
  if (snap.phase) view.phase = snap.phase;
  if (snap.stats) view.stats = snap.stats;
  if (snap.q) view.quest = snap.q;
  if (snap.events) {
    for (const ev of snap.events) {
      if (!view.events.some((x) => x.t === ev.t && x.text === ev.text)) view.events.push(ev);
    }
    if (view.events.length > 40) view.events.splice(0, view.events.length - 40);
  }
}

function makeView(mapData, mode, race) {
  const m = (v) => v * WORLD_SCALE;
  const all1 = () => {
    const a = new Uint8Array(64 * 64);
    a.fill(1);
    return a;
  };
  const pids = mode === '2v2' ? ['player', 'ally', 'enemy1', 'enemy2']
    : mode === 'ffa' ? ['player', 'enemy1', 'enemy2', 'enemy3'] : ['player', 'bot'];
  const teamMap = mode === 'ffa' ? Object.fromEntries(pids.map((p) => [p, p]))
    : mode === '2v2' ? { player: 'A', ally: 'A', enemy1: 'B', enemy2: 'B' } : { player: 'A', bot: 'B' };
  return {
    map: mapData, mode, pids, teamMap,
    raceOf: { player: race }, racesData, units: unitsData, bdefs: buildingsData,
    t: 0, tick: 0, phase: 'build', over: false, winner: null, reason: '',
    players: { player: { id: 'player', res: { food: 0, wood: 0, stone: 0, iron: 0, gold: 0, popUsed: 0, popMax: 0, morale: 70 } } },
    upgrades: { player: { forge: 0 } },
    squads: [], buildings: [],
    flags: (mapData.provinces || []).map((p) => ({ id: p.id, x: m(p.x), z: m(p.z), type: p.type, buff: p.buff, owner: null, progress: 0 })),
    mines: (mapData.mines || []).map((pt) => ({ x: m(pt.x), z: m(pt.z) })),
    camps: (mapData.camps || []).map((c) => ({ type: c.type, x: m(c.x), z: m(c.z) })),
    hills: [
      ...((mapData.hills || []).map((h) => ({ x: m(h.x), z: m(h.z), r: 12 }))),
      ...((mapData.provinces || []).filter((p) => p.type === 'hill').map((p) => ({ x: m(p.x), z: m(p.z), r: 12 }))),
    ],
    forests: (mapData.provinces || []).filter((p) => p.type === 'forest').map((p) => ({ x: m(p.x), z: m(p.z), r: 16 })),
    river: mapData.river ? {
      x: m(mapData.river.x), half: m(mapData.river.width) / 2,
      bridges: (mapData.river.bridges || []).map((b) => ({ z: m(b.z), half: m(8) / 2 })),
      ford: mapData.river.ford ? { z: m(mapData.river.ford.z), half: m(mapData.river.ford.width) / 2 } : null,
    } : null,
    mountains: (mapData.passages || []).length ? {
      x: m(768), half: 10,
      gaps: (mapData.passages || []).map((ps) => ({ z: m(ps.z), half: m(ps.width || 6) / 2 + 2 })),
    } : null,
    score: mode === 'ffa' ? Object.fromEntries(pids.map((p) => [p, 0])) : { A: 0, B: 0 },
    stats: {}, quest: { wood: 0, food: 0, neutrals: 0, flagSec: 0, marks: 0, built: 0 },
    events: [], pings: [],
    fog: { N: 64, vis: all1(), exp: all1() },
  };
}

async function startOnline(lobbyCfg, meta) {
  sceneEl.innerHTML = '';
  const map = MAPS.find((m) => m.id === lobbyCfg.map) || MAPS[0];
  const view = makeView(map.data, map.mode, lobbyCfg.race);
  window.__state = view;
  const render = new GameRender(sceneEl, view, palette);
  const sel = { squads: [], building: null };
  const groups = {};
  let buildMode = null;
  let attackMode = false;
  let pendingSkill = null;
  let ordersSent = 0;
  const apmTimes = [];
  let apmCount = 0;
  const throttle = () => {
    const now = performance.now();
    while (apmTimes.length && now - apmTimes[0] > 1000) apmTimes.shift();
    if (apmTimes.length >= 10) return false;
    apmTimes.push(now);
    apmCount = apmTimes.length;
    return true;
  };
  const ghostMark = (x, z) => {
    // мгновенный маркер приказа (предсказание intent по sync.md)
    view.pings.push({ x, z, t: 7.9, team: 'A' });
    setTimeout(() => {
      const i = view.pings.findIndex((p) => p.x === x && p.z === z);
      if (i >= 0) view.pings.splice(i, 1);
    }, 700);
  };

  const ui = new GameUI(app.querySelector('#hud'), {
    onRecruit: (bId, unitId) => {
      if (!throttle()) return;
      net.cmd({ cmd: 'recruit', b: bId, unit: unitId });
      ordersSent++;
    },
    onUpgrade: (bId) => {
      if (!throttle()) return;
      net.cmd({ cmd: 'upgrade', b: bId });
      ordersSent++;
    },
    onTrade: () => {
      if (!throttle()) return;
      net.cmd({ cmd: 'trade' });
      ordersSent++;
    },
    onGive: () => {
      if (!throttle()) return;
      net.cmd({ cmd: 'give' });
      ordersSent++;
    },
    onForgeUp: (bId) => {
      if (!throttle()) return;
      net.cmd({ cmd: 'forge', b: bId });
      ordersSent++;
    },
    onBuild: (typeId) => {
      buildMode = buildMode === typeId ? null : typeId;
      ui.buildMode = buildMode;
    },
    onStop: () => {
      for (const id of sel.squads) {
        const s = view.squads.find((x) => x.id === id);
        if (s) net.cmd({ cmd: 'move', ids: [id], x: s.x, z: s.z });
      }
    },
    onSkill: (slot) => {
      if (pendingSkill === slot) {
        pendingSkill = null;
        ui.pendingSkill = null;
        return;
      }
      const h = view.squads.find((s) => s.owner === 'player' && s.type === 'hero' && s.count > 0);
      if (!h) return;
      const H = heroesData.heroes.find((x) => x.id === h.hero.arch);
      const sk = H.skills[slot === 'q' ? 0 : 1];
      if (['ambush', 'mark'].includes(sk.id)) {
        pendingSkill = slot;
        ui.pendingSkill = slot;
        return;
      }
      if (!throttle()) return;
      net.cmd({ cmd: 'cast', slot, hero: h.id });
      ordersSent++;
    },
  });
  ui.pendingSkill = null;

  const doMove = (x, z) => {
    if (!sel.squads.length || !throttle()) return;
    net.cmd({ cmd: 'move', ids: sel.squads.slice(), x, z });
    ordersSent++;
    ghostMark(x, z);
  };
  const doAttack = (ent, kind) => {
    if (!sel.squads.length || !throttle()) return;
    net.cmd({ cmd: 'attack', ids: sel.squads.slice(), target: ent.id, kind });
    ordersSent++;
  };

  const canvas = render.renderer.domElement;
  const keys = {};
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  let dragStart = null;
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragStart = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!dragStart) return;
    const x = Math.min(dragStart.x, e.clientX);
    const y = Math.min(dragStart.y, e.clientY);
    const w = Math.abs(e.clientX - dragStart.x);
    const h = Math.abs(e.clientY - dragStart.y);
    rubber.style.display = w + h > 10 ? 'block' : 'none';
    rubber.style.transform = `translate(${x}px, ${y}px)`;
    rubber.style.width = `${w}px`;
    rubber.style.height = `${h}px`;
  });
  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
      if (buildMode) {
        buildMode = null;
        ui.buildMode = null;
        return;
      }
      const pt = render.groundPoint(ndcOf(e, render.renderer));
      const ent = render.pick(ndcOf(e, render.renderer));
      if (pt && sel.squads.length) {
        if (ent && (ent.kind === 'squad' || ent.kind === 'building')) {
          const target = ent.kind === 'squad'
            ? view.squads.find((s) => s.id === ent.id)
            : view.buildings.find((b) => b.id === ent.id);
          if (target && teamOf(view, target.owner) !== teamOf(view, 'player') && target.hp > 0) {
            doAttack(ent, ent.kind);
            return;
          }
        }
        doMove(pt.x, pt.z);
      }
      return;
    }
    if (e.button !== 0 || !dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 10) {
      const x0 = Math.min(dragStart.x, e.clientX);
      const y0 = Math.min(dragStart.y, e.clientY);
      const x1 = Math.max(dragStart.x, e.clientX);
      const y1 = Math.max(dragStart.y, e.clientY);
      const v = new THREE.Vector3();
      sel.squads = view.squads
        .filter((s) => s.owner === 'player' && s.count > 0)
        .filter((s) => {
          v.set(s.x, 1, s.z).project(render.camera);
          const sx = (v.x * 0.5 + 0.5) * innerWidth;
          const sy = (-v.y * 0.5 + 0.5) * innerHeight;
          return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
        })
        .map((s) => s.id);
      sel.building = null;
    } else {
      const pt = render.groundPoint(ndcOf(e, render.renderer));
      const ent = render.pick(ndcOf(e, render.renderer));
      if (pendingSkill && ent) {
        const h = view.squads.find((s) => s.owner === 'player' && s.type === 'hero' && s.count > 0);
        if (h && throttle()) {
          net.cmd({ cmd: 'cast', slot: pendingSkill, hero: h.id, target: ent.id, kind: ent.kind });
          ordersSent++;
        }
        pendingSkill = null;
        ui.pendingSkill = null;
      } else if (attackMode && pt && sel.squads.length) {
        doMove(pt.x, pt.z);
        attackMode = false;
      } else if (buildMode && pt) {
        if (throttle()) {
          net.cmd({ cmd: 'build', b: buildMode, x: pt.x, z: pt.z });
          ordersSent++;
        }
        buildMode = null;
        ui.buildMode = null;
      } else if (ent) {
        if (ent.kind === 'squad') {
          const s = view.squads.find((x) => x.id === ent.id);
          if (s && s.owner === 'player') {
            sel.squads = e.shiftKey ? [...new Set([...sel.squads, s.id])] : [s.id];
            sel.building = null;
          }
        } else {
          const b = view.buildings.find((x) => x.id === ent.id);
          if (b && b.owner === 'player' && b.hp > 0) {
            sel.building = b.id;
            sel.squads = [];
          }
        }
      } else {
        sel.squads = [];
        sel.building = null;
      }
    }
    dragStart = null;
    rubber.style.display = 'none';
  });
  ui.minimap.addEventListener('mousedown', (e) => {
    if (e.button !== 2 || !sel.squads.length) return;
    e.preventDefault();
    const r = ui.minimap.getBoundingClientRect();
    const W = map.data.size_m * WORLD_SCALE;
    doMove(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * W);
  });
  ui.minimap.addEventListener('contextmenu', (e) => e.preventDefault());

  const onKey = (e) => {
    keys[e.code] = true;
    if (e.code === 'Escape') {
      buildMode = null;
      ui.buildMode = null;
      attackMode = false;
      pendingSkill = null;
      ui.pendingSkill = null;
    }
    if (e.code === 'KeyA') attackMode = true;
    if (e.code === 'KeyF' && sel.squads.length && throttle()) {
      const loose = !view.squads.find((s) => s.id === sel.squads[0])?.loose;
      net.cmd({ cmd: 'stance', ids: sel.squads.slice(), stance: loose ? 'loose' : 'line' });
      ordersSent++;
    }
    if (e.code === 'KeyH') {
      const th = view.buildings.find((b) => b.owner === 'player' && b.type === 'townhall' && b.hp > 0);
      if (th) {
        render.controls.target.set(th.x, 0, th.z);
        render.camera.position.set(th.x, 55, th.z + 60);
      }
    }
    if (e.code === 'F1' || e.code === 'F2' || e.code === 'F4') {
      if (map.mode !== '2v2' || !throttle()) return;
      const ping = e.code === 'F1' ? 'F1' : e.code === 'F2' ? 'F2' : 'F4';
      const t = render.controls.target;
      net.cmd(ping === 'F1' ? { cmd: 'ping', ping, x: t.x, z: t.z } : { cmd: 'ping', ping });
      ordersSent++;
    }
  };
  const onKeyUp = (e) => (keys[e.code] = false);
  addEventListener('keydown', onKey);
  addEventListener('keyup', onKeyUp);

  function panCamera(dt) {
    const sp = 40 * dt;
    const fwd = new THREE.Vector3();
    render.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x).negate();
    const mv = new THREE.Vector3();
    if (keys.KeyW || keys.ArrowUp) mv.add(fwd);
    if (keys.KeyS || keys.ArrowDown) mv.sub(fwd);
    if (keys.KeyD || keys.ArrowRight) mv.add(right);
    if (keys.ArrowLeft) mv.sub(right);
    if (mv.lengthSq() > 0) {
      mv.normalize().multiplyScalar(sp);
      render.camera.position.add(mv);
      render.controls.target.add(mv);
    }
  }

  // --- сеть ---
  let lastSnapAt = 0;
  let finished = false;
  const net = new NetClient({
    onOpen: () => {},
    onJoined: (m) => {
      if (m.races) Object.assign(view.raceOf, m.races);
      if (m.pid && m.pid !== 'player') {
        // прототип: браузер играет только слот player (второй человек в 1v1 — headless/PvP на протоколе)
        ui.overlay.innerHTML = `<div class="card"><h1>Слот занят</h1><p class="dim">Матчмейкер отдал вам pid ${m.pid} — браузерный клиент прототипа играет только за player. Откройте второе окно позже.</p><button onclick="location.reload()">Назад</button></div>`;
        ui.overlay.classList.remove('hidden');
        net.close();
      }
    },
    onOpen: () => {},
    onQueue: () => {
      ui.overlay.innerHTML = `<div class="card"><h1>Поиск матча…</h1><p class="dim">${getWssUrl()}</p></div>`;
      ui.overlay.classList.remove('hidden');
    },
    onSnap: (m) => {
      lastSnapAt = performance.now();
      applySnapToView(view, m);
    },
    onEnd: (m) => {
      if (finished) return;
      finished = true;
      const win = view.mode === 'ffa' ? m.winner === net.pid : m.winner === 'A';
      mmr = Math.max(100, Math.min(3000, mmr + (win ? 25 : -20)));
      localStorage.setItem('tt_mmr', String(mmr));
      let rewardText = '';
      if (meta) {
        const heroSq = view.squads.find((s) => s.owner === 'player' && s.type === 'hero');
        const rw = applyBattleResult(meta, { win, xp: heroSq?.hero.xpBattle || 0, goldEarned: 0, maxLevel: heroesData.maxLevel });
        rewardText = `Награды: +${rw.gold}🪙 +${rw.xp} XP${rw.capped ? ' (дейли-кап!)' : ''}`;
        const qdone = settleQuests(meta, questsData, {
          wood: view.quest.wood, food: view.quest.food, neutrals: view.quest.neutrals,
          flagSec: view.quest.flagSec, battles: 1, orders: ordersSent,
          heroKills: view.quest.heroKills || 0, built: view.quest.built,
          marks: view.quest.marks, heroArch: meta.hero.arch, wins: win ? 1 : 0,
        });
        if (qdone.length) rewardText += ' • ' + qdone.join(' • ');
        if (autoSeason(meta)) rewardText += ' • Новый сезон (авто-вайп)!';
      }
      ui.showEnd(m.winner, m.reason, m.score, m.stats, view.squads, {
        state: view, unitName, mmr, rewardText, replayLabel: 'Скачать реплей',
        onReplay: () => net.getReplay(),
      });
    },
    onReplay: (m) => {
      const blob = new Blob([JSON.stringify(m.replay)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `replay-${Date.now()}.json`;
      a.click();
    },
    onErr: (m) => {
      view.events.push({ t: view.t, text: m.kick ? `Кик: ${m.reason || ''}` : `Приказ отклонён: ${m.err}`, kind: 'combat' });
    },
    onClose: () => {
      if (finished) return;
      ui.overlay.innerHTML = `<div class="card"><h1>Соединение потеряно</h1><p class="dim">Переподключение…</p></div>`;
      ui.overlay.classList.remove('hidden');
      setTimeout(async () => {
        try {
          await net.connect();
          net.hello({ simVersion: 12, clientId: net.clientId, room: net.room });
        } catch { /* следующая попытка следующим разрывом */ }
      }, 2000);
    },
  });

  try {
    await net.connect();
  } catch {
    ui.overlay.innerHTML = `<div class="card"><h1>Нет связи</h1><p class="dim">${getWssUrl()} — поднимите сервер: cd server && node src/index.js</p><button onclick="location.reload()">Назад</button></div>`;
    ui.overlay.classList.remove('hidden');
    return;
  }
  net.hello({
    simVersion: 12, mode: map.mode, map: lobbyCfg.map, race: lobbyCfg.race,
    hero: { arch: meta?.hero.arch || 'warlord', level: meta?.hero.level || 1, gear: meta?.hero.gear || {}, perks: meta?.hero.perks || [] },
    mmr,
  });

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    if (performance.now() - lastSnapAt > 1500 && net.room) {
      // лаг-бейдж сменяет тишину
      render.controls.target.y = render.controls.target.y; // noop keep
    }
    panCamera(dt);
    render.controls.update();
    render.sync(view, sel, dt);
    const nowMs = performance.now();
    while (apmTimes.length && nowMs - apmTimes[0] > 1000) apmTimes.shift();
    ui.update(view, sel, apmTimes.length);
    ui.heroPanel(view, heroesData);
  }
  addEventListener('resize', () => render.resize());
  requestAnimationFrame(frame);
}
const meta = loadMeta();
const offline = offlineEarnings(meta);
if (offline.gold > 0) {
  meta.capital.gold += offline.gold;
  saveMeta(meta);
}
const bootUI = new GameUI(app.querySelector('#hud'), {
  onRecruit: () => {},
  onUpgrade: () => {},
  onTrade: () => {},
  onBuild: () => {},
  onStop: () => {},
  onSkill: () => {},
});
function openLobby() {
  bootUI.showLobby(
    {
      maps: MAPS.map((m) => ({ id: m.id, name: m.name })),
      missions: MISSIONS,
      races: racesData.races,
      diffs: Object.entries(DIFFS).filter(([id]) => id !== 'passive').map(([id, d]) => ({ id, label: d.label })),
      mmr,
      onOnline: (cfg) => startOnline(cfg, meta),
    },
    (cfg) => startMatch(cfg, null, meta)
  );
}
bootUI.showMeta(meta, { heroesData, racesData, questsData, offline }, {
  onArch: (arch) => { meta.hero.arch = arch; saveMeta(meta); },
  onPerk: (id) => { meta.hero.perks.push(id); saveMeta(meta); },
  onCraft: (itemId) => { craftPurple(meta, itemId); },
  onEquip: (id) => {
    const ix = (meta.hero.inventory || []).findIndex((it) => it.id === id);
    if (ix < 0) return;
    const [item] = meta.hero.inventory.splice(ix, 1);
    const old = meta.hero.gear[item.slot];
    if (old) meta.hero.inventory.push(old);
    meta.hero.gear[item.slot] = item;
    saveMeta(meta);
  },
  onUnequip: (slot) => {
    const old = meta.hero.gear[slot];
    if (!old) return;
    delete meta.hero.gear[slot];
    meta.hero.inventory.push(old);
    saveMeta(meta);
  },
  onCapitalUp: () => {
    const cost = [0, 500, 1500][meta.capital.thLevel] || 0;
    if (meta.capital.thLevel < 3 && meta.capital.gold >= cost) {
      meta.capital.gold -= cost;
      meta.capital.thLevel += 1;
      saveMeta(meta);
    }
  },
  onVault: () => {
    meta.capital.gold += meta.clan.vault;
    meta.clan.vault = 0;
    saveMeta(meta);
  },
  onClanName: (name) => { meta.clan.name = name.slice(0, 24); saveMeta(meta); },
  onWipe: () => wipeSeason(meta),
  onPlay: () => openLobby(),
});
