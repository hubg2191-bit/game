// client/ui — HUD 0.1: ресурсы, панель выбора, найм, стройка, миникарта, оверлеи.
import { affordable, recruitTime, buildTime, squadCap, capOf, tradeRate, upgrade, trade, recruitable, buildMenuFor, MVP_BUILD_MENU, unitById, buildingById, defOf, isVisible, teamOf, WORLD_SCALE } from './sim.js';
import { xpNext } from './meta.js';

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

  showMeta(meta, ctx, cb) {
    let tab = 'capital';
    const gearText = (it) => `${it.tier === 'blue' ? '🔵' : '⚪'} ${it.slot}: ` +
      Object.entries(it.stats).map(([k, v]) => `${k}+${v}`).join(' ');
    const draw = () => {
      const h = meta.hero;
      const H = ctx.heroesData.heroes.find((x) => x.id === h.arch);
      const need = xpNext(h.level);
      let body = '';
      if (tab === 'capital') {
        const cost = [0, 500, 1500][meta.capital.thLevel] || 0;
        body = `
          <p>Ратуша ур.${meta.capital.thLevel} • Казна: <b>${Math.floor(meta.capital.gold)}🪙</b></p>
          ${ctx.offline && ctx.offline.gold > 0 ? `<p class="good">Пока вас не было (${Math.floor(ctx.offline.secs / 60)} мин): +${ctx.offline.gold}🪙 (40%, кап 8ч)</p>` : ''}
          <p class="dim">Уровень столицы: +100🪙 и +50🍞 к старту схватки за уровень.</p>
          ${meta.capital.thLevel < 3
            ? `<button id="mUpTh" ${meta.capital.gold >= cost ? '' : 'disabled'}>Улучшить Ратушу (${cost}🪙)</button>`
            : '<p>Максимальный уровень</p>'}`;
      } else if (tab === 'hero') {
        const eq = h.gear || {};
        body = `
          <div class="lrow"><span>Герой:</span>${ctx.heroesData.heroes.map((x) => `<button data-arch="${x.id}" class="${h.arch === x.id ? 'active' : ''}">${x.name}</button>`).join('')}</div>
          <p><b>${H.name}</b> · ур.${h.level} • XP ${h.xp}/${need} • СИЛ/ХОЗ/ДУХ ${H.stats.str}/${H.stats.adm}/${H.stats.spi}</p>
          <p class="dim">Аура: ${H.aura.morale ? `+${H.aura.morale} морали` : ''}${H.aura.build ? ` стройка +${Math.round((H.aura.build - 1) * 100)}%` : ''}${H.aura.vision ? ` обзор +${Math.round((H.aura.vision - 1) * 100)}%` : ''} • Q: ${H.skills[0].name} • E: ${H.skills[1].name}</p>
          <p>Снаряжение:</p>
          ${ctx.heroesData.gearSlots.map((slot) => {
            const it = eq[slot];
            return `<div class="lrow"><span>${slot}:</span>${it ? `<button data-unequip="${slot}">${gearText(it)} [снять]</button>` : '<i class="dim">пусто</i>'}</div>`;
          }).join('')}
          <p>Рюкзак (${(h.inventory || []).length}):</p>
          ${(h.inventory || []).map((it) => `<div class="lrow"><button data-equip="${it.id}">${gearText(it)}</button></div>`).join('') || '<p class="dim">Пусто. Шмот падает с лагерей бандитов.</p>'}`;
      } else if (tab === 'clan') {
        body = `
          <div class="lrow"><span>Клан:</span><input id="clanName" value="${meta.clan.name || ''}" placeholder="Название клана" maxlength="24"/></div>
          <p>Казна клана: <b>${Math.floor(meta.clan.vault)}🪙</b> <span class="dim">(10% с наград боёв)</span></p>
          <button id="mVault">Забрать в казну столицы</button>
          <p class="dim">Союзники-боты в 2v2 — члены вашего клана.</p>`;
      } else {
        body = `
          <p>День сезона: <b>${meta.season.day}/90</b> • Боёв сегодня: ${meta.season.battlesToday}/3 (дальше награды 20%)</p>
          <p class="dim">Вайп: столица жмётся до ур.1, герои/шмот/золото/MMR остаются.</p>
          <button id="mWipe">Ручной вайп сезона</button>`;
      }
      this.overlay.innerHTML = `
      <div class="card lobby">
        <h1>Thrones & Towns <span>столица</span></h1>
        <div class="lrow"><span></span>
          ${['capital', 'hero', 'clan', 'season'].map((t) => `<button data-tab="${t}" class="${tab === t ? 'active' : ''}">${{ capital: 'Столица', hero: 'Герой', clan: 'Клан', season: 'Сезон' }[t]}</button>`).join('')}
        </div>
        ${body}
        <button id="mPlay">В бой →</button>
      </div>`;
      this.overlay.classList.remove('hidden');
      this.overlay.querySelectorAll('[data-tab]').forEach((b) => {
        b.onclick = () => { tab = b.dataset.tab; draw(); };
      });
      this.overlay.querySelectorAll('[data-arch]').forEach((b) => {
        b.onclick = () => { cb.onArch(b.dataset.arch); draw(); };
      });
      this.overlay.querySelectorAll('[data-equip]').forEach((b) => {
        b.onclick = () => { cb.onEquip(b.dataset.equip); draw(); };
      });
      this.overlay.querySelectorAll('[data-unequip]').forEach((b) => {
        b.onclick = () => { cb.onUnequip(b.dataset.unequip); draw(); };
      });
      const up = this.overlay.querySelector('#mUpTh');
      if (up) up.onclick = () => { cb.onCapitalUp(); draw(); };
      const wv = this.overlay.querySelector('#mVault');
      if (wv) wv.onclick = () => { cb.onVault(); draw(); };
      const wp = this.overlay.querySelector('#mWipe');
      if (wp) wp.onclick = () => { if (confirm('Вайпнуть сезон? Столица ужмётся.')) { cb.onWipe(); draw(); } };
      const cn = this.overlay.querySelector('#clanName');
      if (cn) cn.onchange = () => cb.onClanName(cn.value);
      this.overlay.querySelector('#mPlay').onclick = () => {
        this.overlay.classList.add('hidden');
        cb.onPlay();
      };
    };
    draw();
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
        ${extra.rewardText ? `<p class="good">${extra.rewardText}</p>` : ''}
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
      <span title="Лимит отрядов (герой не в счёт)">⚔️ ${state.squads.filter((s) => s.owner === 'player' && s.type !== 'hero').length}/${squadCap(state, 'player')}</span>${hunger}`;
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
            const u = defOf(state, s.type, s.owner) || { name: s.type, size: '?', hpPer: 1 };
            const mor = s.type === 'hero' && s.hero ? ` • мана ${Math.floor(s.hero.mana)}` : ` • мораль ${Math.ceil(s.mor)}`;
            return `<div>${u.name} — ${s.count}/${u.size} • HP ${Math.ceil(s.hp)}/${s.hpMax}${mor}${s.fleeT > 0 ? ' 🏃 БЕЖИТ' : ''}${(s.invisT || 0) > 0 ? ' 👻' : ''}</div>`;
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

  // Панель героя: уровень, мана, Q/E (вызывается из main каждый кадр)
  heroPanel(state, heroesData) {
    let el = this.root.querySelector('#heropanel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'heropanel';
      this.root.appendChild(el);
    }
    const h = state.squads.find((s) => s.owner === 'player' && s.type === 'hero');
    if (!h) {
      const rp = (state.respawns || []).find((r) => r.pid === 'player');
      el.innerHTML = rp ? `<div class="hname">Герой возродится через ${Math.ceil(rp.t)}с</div>` : '';
      el.style.display = rp ? 'block' : 'none';
      return;
    }
    const H = heroesData.heroes.find((x) => x.id === h.hero.arch);
    const q = H.skills[0];
    const eSk = H.skills[1];
    const qRdy = h.hero.qCd <= 0 && h.hero.mana >= q.mana;
    const eRdy = h.hero.eCd <= 0 && h.hero.mana >= eSk.mana;
    const need = xpNext(h.hero.level);
    el.style.display = 'block';
    el.innerHTML = `
      <div class="hname">${H.name} · ур.${h.hero.level}</div>
      <div class="hbar xp"><div style="width:${Math.min(100, (h.hero.xpBattle / need) * 100)}%"></div></div>
      <div class="hbar mana"><div style="width:${(h.hero.mana / defOf(state, 'hero', 'player').manaMax) * 100}%"></div></div>
      <button data-skill="q" class="${this.pendingSkill === 'q' ? 'armed' : ''}" ${qRdy || this.pendingSkill === 'q' ? '' : 'disabled'} title="${q.name}: ${h.hero.qCd > 0 ? Math.ceil(h.hero.qCd) + 'с' : q.mana + ' маны'}">Q ${q.name}</button>
      <button data-skill="e" class="${this.pendingSkill === 'e' ? 'armed' : ''}" ${eRdy || this.pendingSkill === 'e' ? '' : 'disabled'} title="${eSk.name}: ${h.hero.eCd > 0 ? Math.ceil(h.hero.eCd) + 'с' : eSk.mana + ' маны'}">E ${eSk.name}</button>`;
    el.querySelectorAll('[data-skill]').forEach((btn) => {
      btn.onclick = () => this.cb.onSkill(btn.dataset.skill);
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
