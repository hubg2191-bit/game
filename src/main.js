// Схватка 0.1 — точка входа: сим (15 Гц) + рендер + ввод RTS.
import './style.css';
import * as THREE from 'three';
import { createGame, update, orderMove, orderAttack, recruit, construct, upgrade, trade, SIM_TICK_HZ, WORLD_SCALE } from './game/sim.js';
import { GameRender } from './game/render.js';
import { GameUI } from './game/ui.js';
import unitsData from './game/data/units.json';
import buildingsData from './game/data/buildings.json';
import palette from './game/data/palette.json';
import mapPlain from './game/data/maps/skirmish-plain.json';

const rules = unitsData.rules;
const app = document.querySelector('#app');
app.innerHTML = `<div id="scene"></div><div id="hud"></div><div id="rubber"></div>`;
const sceneEl = app.querySelector('#scene');

const state = createGame(mapPlain, unitsData, buildingsData, rules);
const render = new GameRender(sceneEl, state, palette);
const sel = { squads: [], building: null };
let buildMode = null;
let started = false;

const ui = new GameUI(app.querySelector('#hud'), {
  onRecruit: (bId, unitId) => recruit(state, 'player', bId, unitId),
  onUpgrade: (bId) => upgrade(state, 'player', bId),
  onTrade: () => trade(state, 'player'),
  onBuild: (typeId) => {
    buildMode = buildMode === typeId ? null : typeId;
    ui.buildMode = buildMode;
  },
  onStop: () => {
    for (const s of state.squads) {
      if (sel.squads.includes(s.id)) s.order = { kind: 'move', x: s.x, z: s.z };
    }
  },
});
const groups = {}; // Ctrl+1..9 (controls.md)
let attackMode = false; // клавиша A: следующий ЛКМ — attackmove

function ndc(e) {
  const r = render.renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

// ---------- выбор ----------
const rubber = app.querySelector('#rubber');
let dragStart = null;
const canvas = render.renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
    // ПКМ: отмена стройки либо приказ
    if (buildMode) {
      buildMode = null;
      ui.buildMode = null;
      return;
    }
    const pt = render.groundPoint(ndc(e));
    const ent = render.pick(ndc(e));
    if (pt && sel.squads.length) {
      if (ent && (ent.kind === 'squad' || ent.kind === 'building')) {
        const target = ent.kind === 'squad'
          ? state.squads.find((s) => s.id === ent.id)
          : state.buildings.find((b) => b.id === ent.id);
        if (target && target.owner === 'bot' && target.hp > 0 && (target.count === undefined || target.count > 0)) {
          orderAttack(state, sel.squads, ent);
          return;
        }
      }
      orderMove(state, sel.squads, pt.x, pt.z);
    }
    return;
  }
  if (e.button !== 0 || !dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  if (Math.abs(dx) + Math.abs(dy) > 10) {
    // рамка
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
    // клик
    const pt = render.groundPoint(ndc(e));
    const ent = render.pick(ndc(e));
    if (attackMode && pt && sel.squads.length) {
      // режим A: ЛКМ — attackmove / атака цели
      if (ent && (ent.kind === 'squad' || ent.kind === 'building')) {
        const target = ent.kind === 'squad'
          ? state.squads.find((s) => s.id === ent.id)
          : state.buildings.find((b) => b.id === ent.id);
        if (target && target.owner !== 'player' && target.hp > 0) {
          orderAttack(state, sel.squads, ent);
          attackMode = false;
          dragStart = null;
          rubber.style.display = 'none';
          return;
        }
      }
      orderMove(state, sel.squads, pt.x, pt.z);
      attackMode = false;
    } else if (buildMode && pt) {
      if (construct(state, 'player', buildMode, pt.x, pt.z)) {
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
// дабл-клик по юниту — все такие на экране (controls.md)
canvas.addEventListener('dblclick', (e) => {
  const ent = render.pick(ndc(e));
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
// ПКМ по миникарте — быстрый марш (controls.md)
ui.minimap.addEventListener('mousedown', (e) => {
  if (e.button !== 2 || !sel.squads.length) return;
  e.preventDefault();
  const r = ui.minimap.getBoundingClientRect();
  const W = mapPlain.size_m * WORLD_SCALE;
  const wx = ((e.clientX - r.left) / r.width) * W;
  const wz = ((e.clientY - r.top) / r.height) * W;
  orderMove(state, sel.squads, wx, wz);
});
ui.minimap.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Escape') {
    buildMode = null;
    ui.buildMode = null;
    attackMode = false;
  }
  if (!started || state.over) return;
  if (e.code === 'KeyA') attackMode = true; // атаковать-идти
  if (e.code === 'KeyS') {
    for (const s of state.squads) {
      if (sel.squads.includes(s.id)) s.order = { kind: 'move', x: s.x, z: s.z };
    }
  }
  if (e.code === 'KeyH') {
    // к Ратуше (controls.md)
    const th = state.buildings.find((b) => b.owner === 'player' && b.type === 'townhall' && b.hp > 0);
    if (th) {
      render.controls.target.set(th.x, 0, th.z);
      render.camera.position.set(th.x, 55, th.z + 60);
    }
  }
  if (e.code === 'Space') {
    // к последнему бою
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
      const alive = groups[n].filter((id) => state.squads.some((s) => s.id === id && s.owner === 'player'));
      sel.squads = alive;
      sel.building = null;
    }
  }
});
addEventListener('keyup', (e) => (keys[e.code] = false));
const keys = {};

// ---------- камера WASD/край ----------
function panCamera(dt) {
  const sp = 40 * dt;
  const fwd = new THREE.Vector3();
  render.camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  const right = new THREE.Vector3(fwd.z, 0, -fwd.x).negate();
  const mv = new THREE.Vector3();
  if (keys.KeyW) mv.add(fwd);
  if (keys.KeyS) mv.sub(fwd);
  if (keys.KeyA) mv.add(right);
  if (keys.KeyD) mv.sub(right);
  if (mv.lengthSq() > 0) {
    mv.normalize().multiplyScalar(sp);
    render.camera.position.add(mv);
    render.controls.target.add(mv);
  }
}

// ---------- цикл ----------
let acc = 0;
let last = performance.now();
const STEP = 1 / SIM_TICK_HZ;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  if (!started || state.over) {
    render.sync(state, sel, dt);
    if (started && state.over) ui.showEnd(state.winner, state.reason, state.score, state.stats, state.squads);
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
  if (state.over) ui.showEnd(state.winner, state.reason, state.score, state.stats, state.squads);
}

addEventListener('resize', () => render.resize());
ui.showStart(mapPlain.name, () => {
  started = true;
});
requestAnimationFrame(frame);
