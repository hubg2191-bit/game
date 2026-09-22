// client/ui — HUD 0.1: ресурсы, панель выбора, найм, стройка, миникарта, оверлеи.
import { affordable, recruitTime, buildTime, squadCap, capOf, tradeRate, upgrade, trade, recruitable, buildMenuFor, MVP_BUILD_MENU, unitById, buildingById, isVisible, teamOf, WORLD_SCALE } from './sim.js';

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
      <div id="hint">ЛКМ — выбрать • ПКМ — идти/атаковать • A — атаковать-идти • S — стоп • H — Ратуша • Пробел — бой • Ctrl+1..9 — группы • ПКМ по миникарте — марш</div>
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

  showLobby(lobby, onStart) {
    const cfg = { map: 'plain', race: 'nord', difficulty: 'normal' };
    const render = () => {
      this.overlay.innerHTML = `
      <div class="card lobby">
        <h1>Thrones & Towns <span>0.3 Полная Схватка</span></h1>
        <div class="lrow"><span>Карта:</span> ${lobby.maps.map((m) => `<button data-k="map" data-v="${m.id}" class="${cfg.map === m.id ? 'active' : ''}">${m.name}</button>`).join('')}</div>
        <div class="lrow"><span>Раса:</span> ${lobby.races.map((r) => `<button data-k="race" data-v="${r.id}" title="${r.desc}" class="${cfg.race === r.id ? 'active' : ''}">${r.name}</button>`).join('')}</div>
        <div class="lrow"><span>Боты:</span> ${lobby.diffs.map((d) => `<button data-k="difficulty" data-v="${d.id}" class="${cfg.difficulty === d.id ? 'active' : ''}">${d.label}</button>`).join('')}</div>
        <p class="dim">1v1 — Равнина • 2v2 с союзником — Речная долина (мосты и брод) • MMR ${lobby.mmr}</p>
        <button id="startBtn">В бой</button>
      </div>`;
      this.overlay.classList.remove('hidden');
      this.overlay.querySelectorAll('[data-k]').forEach((btn) => {
        btn.onclick = () => { cfg[btn.dataset.k] = btn.dataset.v; render(); };
      });
      this.overlay.querySelector('#startBtn').onclick = () => {
        this.overlay.classList.add('hidden');
        onStart(cfg);
      };
    };
    render();
  }

  showReplayBar(replay, onExit) {
    let bar = this.root.querySelector('#replaybar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'replaybar';
      this.root.appendChild(bar);
    }
    bar.style.display = 'flex';
    const draw = () => {
      bar.innerHTML = `
        <span>📼 Реплей ${Math.floor(replay.state.t)}с</span>
        <button id="rpPlay">${replay.playing ? '⏸' : '▶'}</button>
        <button data-sp="1" class="${replay.speed === 1 ? 'active' : ''}">1x</button>
        <button data-sp="2" class="${replay.speed === 2 ? 'active' : ''}">2x</button>
        <button data-sp="4" class="${replay.speed === 4 ? 'active' : ''}">4x</button>
        <button id="rpExit">Выйти</button>`;
      bar.querySelector('#rpPlay').onclick = () => { replay.playing = !replay.playing; draw(); };
      bar.querySelectorAll('[data-sp]').forEach((b) => {
        b.onclick = () => { replay.speed = Number(b.dataset.sp); draw(); };
      });
      bar.querySelector('#rpExit').onclick = () => { bar.style.display = 'none'; onExit(); };
    };
    draw();
    this._replayDraw = draw;
  }
  refreshReplayBar() {
    if (this._replayDraw) this._replayDraw();
  }

  showEnd(winner, reason, score, stats, squads, extra = {}) {
    const win = winner === 'A';
    const st = { kills: 0, losses: 0 };
    const foe = { kills: 0, losses: 0 };
    for (const [pid, s] of Object.entries(stats)) {
      const dst = teamOf(extra.state, pid) === winner ? st : foe;
      dst.kills += s.kills;
      dst.losses += s.losses;
    }
    const mvp = squads
      .filter((s) => teamOf(extra.state, s.owner) === winner)
      .sort((a, b) => (b.kills || 0) - (a.kills || 0))[0];
    const mvpName = mvp ? (extra.unitName ? extra.unitName(mvp.type, mvp.owner) : mvp.type) : '';
    this.overlay.innerHTML = `
      <div class="card">
        <h1>${win ? 'Победа!' : 'Поражение'}</h1>
        <p>${reason}</p>
        <p>Счёт ${Math.floor(score.A)} : ${Math.floor(score.B)}${extra.mmr != null ? ` • MMR ${extra.mmr}` : ''}</p>
        <p class="dim">Фраги ${st.kills} : ${foe.kills} • Потери ${st.losses}${mvp ? ` • MVP-отряд: ${mvpName} (${mvp.kills} убийств)` : ''}</p>
        <button id="againBtn">Ещё раз</button>
        ${extra.onReplay ? '<button id="replayBtn">Смотреть реплей</button>' : ''}
      </div>`;
    this.overlay.classList.remove('hidden');
    this.overlay.querySelector('#againBtn').onclick = () => location.reload();
    const rb = this.overlay.querySelector('#replayBtn');
    if (rb && extra.onReplay) rb.onclick = () => extra.onReplay();
  }

  update(state, sel) {
    const p = state.players.player;
    const r = p.res;
    const prod = p._prod || {};
    const hunger = p.starving ? ' <b class="hunger">⚠️ ГОЛОД</b>' : '';
    this.top.innerHTML = `
      <span title="Еда (кап склада)">🍞 ${Math.floor(r.food)}/${capOf(state, 'player', 'food')} <i>${prod.food ? '+' + prod.food.toFixed(1) : ''}</i></span>
      <span title="Дерево">🪵 ${Math.floor(r.wood)}/${capOf(state, 'player', 'wood')} <i>${prod.wood ? '+' + prod.wood.toFixed(1) : ''}</i></span>
      <span title="Камень">🪨 ${Math.floor(r.stone)}</span>
      <span title="Железо">⛓️ ${Math.floor(r.iron)}</span>
      <span title="Золото">🪙 ${Math.floor(r.gold)}</span>
      <span title="Население">👥 ${r.popUsed}/${r.popMax}</span>
      <span title="Лимит отрядов">⚔️ ${state.squads.filter((s) => s.owner === 'player').length}/${squadCap(state, 'player')}</span>${hunger}`;
    // полоса счёта по hud-battle.md: флаги, доход, прогноз
    const win = state.map.winScore || 1000;
    const flA = state.flags.filter((f) => f.owner === 'A').length;
    const flB = state.flags.filter((f) => f.owner === 'B').length;
    const rates = state.map.scorePerSec || {};
    const inc = flA >= 3 ? rates['3flags'] : flA === 2 ? rates['2flags'] : flA === 1 ? rates['1flag'] : 0;
    const forecast = inc > 0 ? ` • победа через ${Math.max(0, Math.ceil((win - state.score.A) / inc))}с` : '';
    this.score.innerHTML = `
      <b class="me">${Math.floor(state.score.A)}</b>
      <span>${fmtTime(state.t)} • до ${win} • 🚩${flA}-${flB} • +${inc || 0}/с${forecast}</span>
      <b class="en">${Math.floor(state.score.B)}</b>`;
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
      if (b.upT > 0) html += `<div>Улучшается: ${Math.ceil(b.upT)}с</div>`;
      if (q) {
        const u = unitById(state.units, q.unitId);
        html += `<div>Найм: ${u.name} ${Math.ceil(q.t)}с</div><div class="qbar"><div style="width:${((1 - q.t / q.total) * 100).toFixed(0)}%"></div></div>`;
      }
      if (b.type === 'townhall' && b.level < (def.levels || 3) && !b.upT) {
        const cost = def.cost[b.level];
        const ok = affordable(r, cost);
        html += `<button data-up ${ok ? '' : 'disabled'}>Улучшить до ур.${b.level + 1} ${costText(cost)}</button>`;
      }
      if (b.type === 'market' && b.buildT <= 0) {
        const rate = Math.round(tradeRate(state, 'player'));
        html += `<button data-trade ${r.wood >= 100 ? '' : 'disabled'}>Обменять 100🪵 → ${rate}🪙</button>`;
      }
      for (const uid of recruitable(state, 'player', b.type)) {
        const u = unitById(state.units, uid);
        const ok = affordable(r, u.cost);
        html += `<button data-rec="${uid}" ${ok ? '' : 'disabled'}>${u.name} (${u.size} 👥) ${costText(u.cost)} • ${Math.ceil(recruitTime(u))}с</button>`;
      }
      if (recruitable(state, 'player', b.type).length) html += `<div class="dim">Точка сбора — рядом со зданием</div>`;
      this.panel.innerHTML = html;
      this.panel.classList.remove('hidden');
      this.panel.querySelectorAll('[data-rec]').forEach((btn) => {
        btn.onclick = () => this.cb.onRecruit(b.id, btn.dataset.rec);
      });
      const upBtn = this.panel.querySelector('[data-up]');
      if (upBtn) upBtn.onclick = () => this.cb.onUpgrade(b.id);
      const trBtn = this.panel.querySelector('[data-trade]');
      if (trBtn) trBtn.onclick = () => this.cb.onTrade(b.id);
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
      buildMenuFor(state, 'player').map((id) => {
        const def = buildingById(state.bdefs, id);
        const ok = affordable(r, def.cost || (id === 'wall' ? { stone: 120 } : {}));
        const active = this.buildMode === id ? ' class="active"' : '';
        return `<button data-build="${id}"${active} ${ok ? '' : 'disabled'} title="${costText(def.cost || { stone: 120 })}">${def.name || 'Стена'}</button>`;
      }).join('');
    this.buildmenu.querySelectorAll('[data-build]').forEach((btn) => {
      btn.onclick = () => this.cb.onBuild(btn.dataset.build);
    });
  }

  drawMinimap(state) {
    const g = this.mm;
    const S = 180;
    const W = state.map.size_m * WORLD_SCALE; // мировые единицы (см. sim WORLD_SCALE)
    g.fillStyle = '#101820';
    g.fillRect(0, 0, S, S);
    const px = (v) => (v / W) * S;
    for (const f of state.flags) {
      g.fillStyle = f.owner === 'A' ? '#2f9dff' : f.owner === 'B' ? '#ff4d4d' : '#888';
      g.save();
      g.translate(px(f.x), px(f.z));
      g.rotate(Math.PI / 4);
      g.fillRect(-4, -4, 8, 8);
      g.restore();
    }
    const dotColor = (owner) => {
      if (owner === 'player') return '#2f9dff';
      if (owner === 'ally') return '#9fd0ff';
      if (owner === 'enemy1') return '#ff4d4d';
      if (owner === 'enemy2') return '#ff9d9d';
      return '#888';
    };
    for (const b of state.buildings) {
      if (b.hp <= 0) continue;
      if (teamOf(state, b.owner) !== 'A' && !isVisible(state, b)) continue;
      g.fillStyle = dotColor(b.owner);
      g.fillRect(px(b.x) - 2, px(b.z) - 2, 4, 4);
    }
    for (const s of state.squads) {
      if (teamOf(state, s.owner) !== 'A' && !isVisible(state, s)) continue;
      g.fillStyle = dotColor(s.owner);
      g.beginPath();
      g.arc(px(s.x), px(s.z), 1.6, 0, 7);
      g.fill();
    }
  }
}
