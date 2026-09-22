// Схватка 0.3: лобби (карта/раса/сложность), MMR, реплеи (сид + лог приказов), сим 15 Гц + рендер.
import './style.css';
import * as THREE from 'three';
import {
  createGame, update, orderMove, orderAttack, recruit, construct, upgrade, trade, castSkill,
  SIM_TICK_HZ, WORLD_SCALE, DIFFS, teamOf, defOf, heroOf,
} from './game/sim.js';
import { GameRender } from './game/render.js';
import { GameUI } from './game/ui.js';
import { loadMeta, saveMeta, offlineEarnings, applyBattleResult, wipeSeason, rollGear, xpNext } from './game/meta.js';
import unitsData from './game/data/units.json';
import buildingsData from './game/data/buildings.json';
import palette from './game/data/palette.json';
import racesData from './game/data/races.json';
import heroesData from './game/data/heroes.json';
import mapPlain from './game/data/maps/skirmish-plain.json';
import mapRiver from './game/data/maps/skirmish-river.json';

const MAPS = [
  { id: 'plain', name: 'Равнина 1v1', data: mapPlain, mode: '1v1' },
  { id: 'river', name: 'Речная долина 2v2', data: mapRiver, mode: '2v2' },
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
  const map = MAPS.find((m) => m.id === lobbyCfg.map) || MAPS[0];
  const capLv = meta?.capital.thLevel || 1;
  const cfg = {
    mode: map.mode,
    races: { player: lobbyCfg.race },
    difficulty: lobbyCfg.difficulty,
    seed: replayRec ? replayRec.seed : Math.floor(Math.random() * 1e9),
    heroesData,
    hero: replayRec?.hero || { arch: meta?.hero.arch || 'warlord', level: meta?.hero.level || 1, gear: meta?.hero.gear || {} },
    startBonus: { gold: 100 * (capLv - 1), food: 50 * (capLv - 1) }, // бонусы столицы
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

  const ui = new GameUI(app.querySelector('#hud'), {
    onRecruit: (bId, unitId) => {
      if (isReplay) return;
      if (recruit(state, 'player', bId, unitId)) record('recruit', ['player', bId, unitId]);
    },
    onUpgrade: (bId) => {
      if (isReplay) return;
      if (upgrade(state, 'player', bId)) record('upgrade', ['player', bId]);
    },
    onTrade: () => {
      if (isReplay) return;
      if (trade(state, 'player')) record('trade', ['player']);
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
      if (isReplay || !started) return;
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
    if (isReplay || !started) return;
    orderMove(state, sel.squads, x, z);
    record('orderMove', [sel.squads.slice(), x, z]);
  };
  const doAttackOrder = (ent) => {
    if (isReplay || !started) return;
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
      if (pendingSkill && ent) {
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
    skill: (a) => {
      // id героя может смениться после респауна — ищем живого героя владельца
      const h = state.squads.find((s) => s.owner === a[0] && s.type === 'hero' && s.count > 0);
      if (h) castSkill(state, a[0], h.id, a[2], a[3]);
    },
    loose: (a) => {
      for (const s of state.squads) if (a[0].includes(s.id)) s.loose = !s.loose;
    },
  };

  // финиш матча: MMR, награды в мету, шмот, реплей
  let finished = false;
  function finishMatch() {
    if (finished) return;
    finished = true;
    const win = state.winner === 'A';
    mmr = Math.max(100, Math.min(3000, mmr + (win ? 25 : -20)));
    localStorage.setItem('tt_mmr', String(mmr));
    let rewardText = '';
    if (meta && !isReplay) {
      const heroSq = state.squads.find((s) => s.owner === 'player' && s.type === 'hero');
      const xp = heroSq?.hero.xpBattle || 0;
      const rw = applyBattleResult(meta, { win, xp, goldEarned: 0, maxLevel: heroesData.maxLevel });
      for (const tier of state.droppedGear) {
        const item = rollGear(Math.random, tier);
        meta.hero.inventory.push(item);
      }
      saveMeta(meta);
      rewardText = `Награды: +${rw.gold}🪙 +${rw.xp + xp} XP${rw.capped ? ' (дейли-кап!)' : ''}${state.droppedGear.length ? ` • Шмот: ${state.droppedGear.length} шт.` : ''}`;
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
    ui.update(state, sel);
    ui.heroPanel(state, heroesData);
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

// --- вход: мета (столица/герой/клан/сезон) -> лобби -> бой ---
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
      races: racesData.races,
      diffs: Object.entries(DIFFS).map(([id, d]) => ({ id, label: d.label })),
      mmr,
    },
    (cfg) => startMatch(cfg, null, meta)
  );
}
bootUI.showMeta(meta, { heroesData, racesData, offline }, {
  onArch: (arch) => { meta.hero.arch = arch; saveMeta(meta); },
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
