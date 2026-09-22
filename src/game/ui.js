// client/ui — HUD 0.1: ресурсы, панель выбора, найм, стройка, миникарта, оверлеи.
import { affordable, recruitTime, buildTime, squadCap, MVP_RECRUIT, MVP_BUILD_MENU, unitById, buildingById } from './sim.js';

function costText(cost) {
  const names = { food: '🍞', wood: '🪵', stone: '🪨', iron: '⛓️', gold: '🪙' };
  return Object.entries(cost || {})
    .map(([k, v]) => `${names[k] || k}${v}`)
    .join(' ');
}
function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export class GameUI {
  constructor(root, cb) {
    this.cb = cb;
    this.root = root;
    this.seenEvents = 0;
    root.innerHTML = `
      <div id="topbar"></div>
      <div id="scorebar"></div>
      <div id="feed"></div>
      <div id="selpanel" class="hidden"></div>
      <div id="buildmenu"></div>
      <div id="hint">ЛКМ — выбрать (рамка — несколько) • ПКМ — идти/атаковать • WASD/край — камера • колесо — зум</div>
      <canvas id="minimap" width="180" height="180"></canvas>
      <div id="overlay"></div>`;
    this.top = root.querySelector('#topbar');
    this.score = root.querySelector('#scorebar');
    this.feed = root.querySelector('#feed');
    this.panel = root.querySelector('#selpanel');
    this.buildmenu = root.querySelector('#buildmenu');
    this.overlay = root.querySelector('#overlay');
    this.minimap = root.querySelector('#minimap');
    this.mm = this.minimap.getContext('2d');
    this.buildMode = null;
  }

  showStart(mapName, onStart) {
    this.overlay.innerHTML = `
      <div class="card">
        <h1>Thrones & Towns <span>0.1 Схватка-скелет</span></h1>
        <p>Раса: <b>Нордвейн</b> • Карта: <b>${mapName}</b> • Противник: <b>бот-пустышка</b></p>
        <p class="dim">Захватывайте флаги (5/12/20 очк/с) или снесите Ратушу врага. Победа — 1000 очков.</p>
        <button id="startBtn">В бой</button>
      </div>`;
    this.overlay.classList.remove('hidden');
    this.overlay.querySelector('#startBtn').onclick = () => {
      this.overlay.classList.add('hidden');
      onStart();
    };
  }

  showEnd(winner, reason, score, onRestart) {
    const win = winner === 'player';
    this.overlay.innerHTML = `
      <div class="card">
        <h1>${win ? 'Победа!' : 'Поражение'}</h1>
        <p>${reason}</p>
        <p>Счёт ${Math.floor(score.player)} : ${Math.floor(score.bot)}</p>
        <button id="againBtn">Ещё раз</button>
      </div>`;
    this.overlay.classList.remove('hidden');
    this.overlay.querySelector('#againBtn').onclick = () => location.reload();
  }

  update(state, sel) {
    const r = state.players.player.res;
    const prod = state.players.player._prod || {};
    this.top.innerHTML = `
      <span title="Еда">🍞 ${Math.floor(r.food)} <i>${prod.food ? '+' + prod.food.toFixed(1) : ''}</i></span>
      <span title="Дерево">🪵 ${Math.floor(r.wood)} <i>${prod.wood ? '+' + prod.wood.toFixed(1) : ''}</i></span>
      <span title="Камень">🪨 ${Math.floor(r.stone)}</span>
      <span title="Железо">⛓️ ${Math.floor(r.iron)}</span>
      <span title="Золото">🪙 ${Math.floor(r.gold)}</span>
      <span title="Население">👥 ${r.popUsed}/${r.popMax}</span>
      <span title="Лимит отрядов">⚔️ ${state.squads.filter((s) => s.owner === 'player').length}/${squadCap(state, 'player')}</span>`;
    const win = state.map.winScore || 1000;
    this.score.innerHTML = `
      <b class="me">${Math.floor(state.score.player)}</b>
      <span>${fmtTime(state.t)} • до ${win}</span>
      <b class="en">${Math.floor(state.score.bot)}</b>`;
    // лента событий
    if (state.events.length !== this.seenEvents) {
      this.seenEvents = state.events.length;
      this.feed.innerHTML = state.events
        .slice(-5)
        .map((e) => `<div class="ev ${e.kind}">[${fmtTime(e.t)}] ${e.text}</div>`)
        .join('');
    }
    this.renderPanel(state, sel);
    this.renderBuildMenu(state);
    this.drawMinimap(state);
  }

  renderPanel(state, sel) {
    const r = state.players.player.res;
    if (sel.building) {
      const b = state.buildings.find((x) => x.id === sel.building);
      if (!b || b.hp <= 0 || b.owner !== 'player') {
        this.panel.classList.add('hidden');
        return;
      }
      const def = buildingById(state.bdefs, b.type);
      const q = b.queue[0];
      let html = `<h3>${def.name} <span class="hp">${Math.ceil(b.hp)}/${b.hpMax}</span></h3>`;
      if (b.buildT > 0) html += `<div>Строится: ${Math.ceil(b.buildT)}с</div>`;
      if (q) {
        const u = unitById(state.units, q.unitId);
        html += `<div>Найм: ${u.name} ${Math.ceil(q.t)}с</div><div class="qbar"><div style="width:${((1 - q.t / q.total) * 100).toFixed(0)}%"></div></div>`;
      }
      for (const uid of MVP_RECRUIT[b.type] || []) {
        const u = unitById(state.units, uid);
        const ok = affordable(r, u.cost);
        html += `<button data-rec="${uid}" ${ok ? '' : 'disabled'}>${u.name} (${u.size} 👥) ${costText(u.cost)} • ${Math.ceil(recruitTime(u))}с</button>`;
      }
      if ((MVP_RECRUIT[b.type] || []).length) html += `<div class="dim">Точка сбора — рядом со зданием</div>`;
      this.panel.innerHTML = html;
      this.panel.classList.remove('hidden');
      this.panel.querySelectorAll('[data-rec]').forEach((btn) => {
        btn.onclick = () => this.cb.onRecruit(b.id, btn.dataset.rec);
      });
      return;
    }
    if (sel.squads.length) {
      const list = sel.squads
        .map((id) => state.squads.find((s) => s.id === id))
        .filter(Boolean);
      if (!list.length) {
        this.panel.classList.add('hidden');
        return;
      }
      this.panel.innerHTML =
        `<h3>Отряды: ${list.length}</h3>` +
        list
          .map((s) => {
            const u = unitById(state.units, s.type);
            return `<div>${u.name} — ${s.count}/${u.size} • HP ${Math.ceil(s.hp)}/${s.hpMax} • мораль ${Math.ceil(s.mor)}${s.fleeT > 0 ? ' 🏃 БЕЖИТ' : ''}</div>`;
          })
          .join('') +
        `<button id="stopBtn">Стоп</button>`;
      this.panel.classList.remove('hidden');
      this.panel.querySelector('#stopBtn').onclick = () => this.cb.onStop();
      return;
    }
    this.panel.classList.add('hidden');
  }

  renderBuildMenu(state) {
    const r = state.players.player.res;
    this.buildmenu.innerHTML =
      `<span class="btitle">Построить:</span>` +
      MVP_BUILD_MENU.map((id) => {
        const def = buildingById(state.bdefs, id);
        const ok = affordable(r, def.cost);
        const active = this.buildMode === id ? ' class="active"' : '';
        return `<button data-build="${id}"${active} ${ok ? '' : 'disabled'} title="${costText(def.cost)}">${def.name}</button>`;
      }).join('');
    this.buildmenu.querySelectorAll('[data-build]').forEach((btn) => {
      btn.onclick = () => this.cb.onBuild(btn.dataset.build);
    });
  }

  drawMinimap(state) {
    const g = this.mm;
    const S = 180;
    const W = state.map.size_m * 0.25; // мировые единицы (см. sim WORLD_SCALE)
    g.fillStyle = '#101820';
    g.fillRect(0, 0, S, S);
    const px = (v) => (v / W) * S;
    for (const f of state.flags) {
      g.fillStyle = f.owner === 'player' ? '#2f9dff' : f.owner === 'bot' ? '#ff4d4d' : '#888';
      g.save();
      g.translate(px(f.x), px(f.z));
      g.rotate(Math.PI / 4);
      g.fillRect(-4, -4, 8, 8);
      g.restore();
    }
    for (const b of state.buildings) {
      if (b.hp <= 0) continue;
      g.fillStyle = b.owner === 'player' ? '#2f9dff' : '#ff4d4d';
      g.fillRect(px(b.x) - 2, px(b.z) - 2, 4, 4);
    }
    for (const s of state.squads) {
      g.fillStyle = s.owner === 'player' ? '#9fd0ff' : '#ff9d9d';
      g.beginPath();
      g.arc(px(s.x), px(s.z), 1.6, 0, 7);
      g.fill();
    }
  }
}
