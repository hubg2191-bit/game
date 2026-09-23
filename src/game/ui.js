// client/ui — HUD 0.1: ресурсы, панель выбора, найм, стройка, миникарта, оверлеи.
import { affordable, recruitTime, buildTime, squadCap, capOf, tradeRate, upgrade, trade, forgeUpgrade, FORGE_COSTS, giveAlly, recruitable, buildMenuFor, MVP_BUILD_MENU, unitById, buildingById, defOf, isVisible, teamOf, sameTeam, WORLD_SCALE } from './sim.js';
import { xpNext, pendingPerks } from './meta.js';
// Свой pid во вьюхе (онлайн): state.me; офлайн — 'player'
const ME = (s) => s.me || 'player';

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
          ${ctx.comeback ? '<p class="good">⚔️ С возвращением! Реванш 3 дня: +50% XP/золота.</p>' : ''}
          ${ctx.offline && ctx.offline.vacation ? '<p class="dim">Отпуск: дохода нет.</p>' : ''}
          ${ctx.offline && ctx.offline.gold > 0 ? `<p class="good">Пока вас не было (${Math.floor(ctx.offline.secs / 60)} мин): +${ctx.offline.gold}🪙 (40%, кап 8ч)</p>` : ''}
          <p class="dim">Уровень столицы: +100🪙 и +50🍞 к старту схватки за уровень.</p>
          ${meta.capital.thLevel < 3
            ? `<button id="mUpTh" ${meta.capital.gold >= cost ? '' : 'disabled'}>Улучшить Ратушу (${cost}🪙)</button>`
            : '<p>Максимальный уровень</p>'}
          <button id="mWorld">🗺️ Карта мира (онлайн-шард)</button>`;
      } else if (tab === 'hero') {
        const eq = h.gear || {};
        const perks = pendingPerks(meta, ctx.heroesData);
        const blues = (h.inventory || []).filter((it) => it.tier === 'blue');
        body = `
          <div class="lrow"><span>Герой:</span>${ctx.heroesData.heroes.map((x) => `<button data-arch="${x.id}" class="${h.arch === x.id ? 'active' : ''}">${x.name}</button>`).join('')}</div>
          <p><b>${H.name}</b> · ур.${h.level} • XP ${h.xp}/${need} • СИЛ/ХОЗ/ДУХ ${H.stats.str}/${H.stats.adm}/${H.stats.spi}</p>
          <p class="dim">Аура: ${H.aura.morale ? `+${H.aura.morale} морали` : ''}${H.aura.build ? ` стройка +${Math.round((H.aura.build - 1) * 100)}%` : ''}${H.aura.vision ? ` обзор +${Math.round((H.aura.vision - 1) * 100)}%` : ''} • Q: ${H.skills[0].name} • E: ${H.skills[1].name}</p>
          ${perks.map((row) => `<div class="lrow"><span>Перк ур.${row.level}:</span>${row.options.map((o) => `<button data-perk="${o.id}">${o.name}</button>`).join('')}</div>`).join('')}
          <p>Снаряжение:</p>
          ${ctx.heroesData.gearSlots.map((slot) => {
            const it = eq[slot];
            return `<div class="lrow"><span>${slot}:</span>${it ? `<button data-unequip="${slot}">${gearText(it)} [снять]</button>` : '<i class="dim">пусто</i>'}</div>`;
          }).join('')}
          <p>Рюкзак (${(h.inventory || []).length}):</p>
          ${(h.inventory || []).map((it) => `<div class="lrow"><button data-equip="${it.id}">${gearText(it)}</button>${it.tier === 'blue' ? `<button data-craft="${it.id}" title="Фиолет за 800🪙, столица ур.2+">Крафт ➡🟣</button>` : ''}</div>`).join('') || '<p class="dim">Пусто. Шмот падает с лагерей бандитов.</p>'}`;
      } else if (tab === 'tavern') {
        const qd = ctx.questsData;
        const prog = meta.quests.prog || {};
        const done = meta.quests.done || [];
        const active = meta.quests.active || [];
        const qtext = (q) => {
          if (q.res === 'wood') return `Добыть дерева: ${Math.floor(prog[q.id] || 0)}/${q.need}`;
          if (q.res === 'food') return `Добыть еды: ${Math.floor(prog[q.id] || 0)}/${q.need}`;
          if (q.res === 'neutrals_killed') return `Убить нейтралов: ${prog[q.id] || 0}/${q.need}`;
          if (q.needSec) return `Держать флаги: ${Math.floor(prog[q.id] || 0)}/${q.needSec}с`;
          if (q.id === 'skirmish2') return `Схваток с 50+ приказами: ${prog[q.id] || 0}/${q.need}`;
          return q.name;
        };
        const hqtext = (q) => {
          const cur = prog[`hq_${q.id}`] || 0;
          const what = { kill30: 'Фраги героем', unbr_hold: 'Точек под Несгибаемыми', ambush_cap: 'Флагов засадой', marks5: 'Меток', aura_build: 'Зданий под аурой', convoy_heal: 'Хила обозом' }[q.id] || q.id;
          return `${q.hero === meta.hero.arch ? '' : '(чужой герой) '}${what}: ${cur}/${q.need}`;
        };
        body = `
          <p>Дейлики — выбери 3 из 5 (сброс в полночь):</p>
          ${(qd.dailies || []).map((q) => {
            const on = active.includes(q.id);
            return `<div class="lrow"><span>${done.includes(q.id) ? '☑' : on ? '✅' : '☐'}</span><i>${qtext(q)} → +${q.gold}🪙 +${q.xp}XP</i>${!done.includes(q.id) ? `<button data-qpick="${q.id}">${on ? 'убрать' : 'взять'}</button>` : ''}</div>`;
          }).join('')}
          <p>Викли (понедельник):</p>
          <div class="lrow"><span>${(meta.weekly?.done || []).includes('conqueror') ? '☑' : '☐'}</span><i>Завоеватель: 3 флага разом ${Math.floor((meta.weekly?.prog || {}).conqueror || 0)}/600с → +400🪙 +600XP</i></div>
          <div class="lrow"><span>${(meta.weekly?.done || []).includes('duelist') ? '☑' : '☐'}</span><i>Дуэлянт: побед на неделе ${(meta.weekly?.wins || 0)}/3 → +400🪙 +600XP</i></div>
          <p>Клановые (лайфтайм → очки):</p>
          ${(qd.clanQuests || []).map((q) => {
            const cd = meta.clan.qdone || [];
            const cur = q.res === 'woodTotal' ? Math.floor(meta.stats.wood || 0) : q.res === 'towersTotal' ? (meta.stats.towers || 0) : (meta.stats.kills || 0);
            return `<div class="lrow"><span>${cd.includes(q.id) ? '☑' : '☐'}</span><i>${q.name}: ${cur}/${q.need} → +${q.points} очк.</i></div>`;
          }).join('')}
          <p>Героические (${meta.hero.arch}):</p>
          ${(qd.heroQuests || []).map((q) => `<div class="lrow"><span>${done.includes(`hq_${q.id}`) ? '☑' : '☐'}</span><i>${hqtext(q)} → +${q.gold}🪙 +${q.xp}XP</i></div>`).join('')}
          <p class="dim">Фраги всего: ${meta.stats.kills} • Построек: ${meta.stats.built} • Меток: ${meta.stats.marks}</p>`;
      } else if (tab === 'clan') {
        body = `
          <div class="lrow"><span>Клан:</span><input id="clanName" value="${meta.clan.name || ''}" placeholder="Название клана" maxlength="24"/></div>
          <p>Казна клана: <b>${Math.floor(meta.clan.vault)}🪙</b> <span class="dim">(10% с наград боёв)</span></p>
          <p>Очки сезона: <b>${meta.clan.points || 0}</b> <span class="dim">(победа 100 / поражение 30, выходные x2)</span></p>
          ${meta.war && Date.now() < meta.war.endsAt
            ? `<p>⚔️ Война с ${meta.war.enemy}: ${meta.war.wins}:${meta.war.losses} (боёв ${meta.war.battles}, до 3 побед)</p>`
            : '<button id="mWar">Объявить войну (2v2, 7 дней)</button>'}
          <button id="mVault">Забрать в казну столицы</button>
          <p class="dim">Союзники-боты в 2v2 — члены вашего клана.</p>`;
      } else {
        const shieldOn = meta.shield?.active && meta.shield.until > Date.now();
        const vacOn = meta.vacationUntil && Date.now() < meta.vacationUntil;
        const buffOn = meta.buffUntil && Date.now() < meta.buffUntil;
        body = `
          <p>День сезона: <b>${meta.season.day}/90</b> • Боёв сегодня: ${meta.season.battlesToday}/3 (дальше награды 20%)</p>
          <p>${shieldOn ? `🛡️ Щит новичка до ${new Date(meta.shield.until).toLocaleDateString()}` : 'Щита нет'}</p>
          ${buffOn ? '<p class="good">⚔️ Реванш: +50% XP/золота</p>' : ''}
          ${vacOn ? `<p>🏖️ Отпуск до ${new Date(meta.vacationUntil).toLocaleDateString()} (дохода нет)</p><button id="mVacEnd">Вернуться досрочно</button>`
            : '<button id="mVac">Отпуск 7 дней (заморозка)</button>'}
          <p>7-дневка новичка:</p>
          ${(ctx.track || []).map((t) => {
            const done = (meta.track.done || []).includes(t.id);
            const can = !done && t.check(meta);
            return `<div class="lrow"><span>${done ? '☑' : can ? '✅' : '☐'}</span><i>${t.name}</i>${!done && can ? `<button data-track="${t.id}">Забрать</button>` : ''}</div>`;
          }).join('')}
          <p>Сезонный магазин (очки клана: ${meta.clan.points || 0}):</p>
          ${(ctx.shop || []).map((it) => `<div class="lrow"><button data-shop="${it.id}" ${(meta.clan.points || 0) >= it.cost ? '' : 'disabled'}>${it.name} — ${it.cost} очк.</button></div>`).join('')}
          <p class="dim">Вайп: столица жмётся до ур.1, герои/шмот/золото/MMR остаются.</p>
          <button id="mWipe">Ручной вайп сезона</button>`;
      }
      this.overlay.innerHTML = `
      <div class="card lobby">
        <h1>Thrones & Towns <span>столица</span></h1>
        <div class="lrow"><span></span>
          ${['capital', 'hero', 'tavern', 'clan', 'season'].map((t) => `<button data-tab="${t}" class="${tab === t ? 'active' : ''}">${{ capital: 'Столица', hero: 'Герой', tavern: 'Таверна', clan: 'Клан', season: 'Сезон' }[t]}</button>`).join('')}
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
      this.overlay.querySelectorAll('[data-perk]').forEach((b) => {
        b.onclick = () => { cb.onPerk(b.dataset.perk); draw(); };
      });
      this.overlay.querySelectorAll('[data-craft]').forEach((b) => {
        b.onclick = () => { cb.onCraft(b.dataset.craft); draw(); };
      });
      this.overlay.querySelectorAll('[data-unequip]').forEach((b) => {
        b.onclick = () => { cb.onUnequip(b.dataset.unequip); draw(); };
      });
      const up = this.overlay.querySelector('#mUpTh');
      if (up) up.onclick = () => { cb.onCapitalUp(); draw(); };
      const mw = this.overlay.querySelector('#mWorld');
      if (mw) mw.onclick = () => { cb.onWorld(); };
      const wv = this.overlay.querySelector('#mVault');
      if (wv) wv.onclick = () => { cb.onVault(); draw(); };
      const mwr = this.overlay.querySelector('#mWar');
      if (mwr) mwr.onclick = () => { cb.onWar(); draw(); };
      const wp = this.overlay.querySelector('#mWipe');
      if (wp) wp.onclick = () => { if (confirm('Вайпнуть сезон? Столица ужмётся.')) { cb.onWipe(); draw(); } };
      const vc = this.overlay.querySelector('#mVac');
      if (vc) vc.onclick = () => { cb.onVacation(); draw(); };
      const ve = this.overlay.querySelector('#mVacEnd');
      if (ve) ve.onclick = () => { cb.onVacationEnd(); draw(); };
      this.overlay.querySelectorAll('[data-track]').forEach((b) => {
        b.onclick = () => { cb.onTrack(b.dataset.track); draw(); };
      });
      this.overlay.querySelectorAll('[data-shop]').forEach((b) => {
        b.onclick = () => { cb.onShop(b.dataset.shop); draw(); };
      });
      this.overlay.querySelectorAll('[data-qpick]').forEach((b) => {
        b.onclick = () => { cb.onQuestPick(b.dataset.qpick); draw(); };
      });
      const cn = this.overlay.querySelector('#clanName');
      if (cn) cn.onchange = () => cb.onClanName(cn.value);
      this.overlay.querySelector('#mPlay').onclick = () => {
        this.overlay.classList.add('hidden');
        cb.onPlay();
      };
    };
    draw();
  }

  showRoomList(rooms, onPick, onBack) {    this.overlay.innerHTML = `
      <div class="card">
        <h1>Наблюдение <span>задержка 30с</span></h1>
        ${rooms.length ? rooms.map((r) => `<div class="lrow"><button data-room="${r.room}">${r.mode} • ${r.map} • ${Math.floor(r.t / 60)}:${String(Math.floor(r.t % 60)).padStart(2, '0')} • игроков ${r.players}</button></div>`).join('') : '<p class="dim">Нет открытых матчей. Создайте сетевой матч — он появится здесь.</p>'}
        <button id="backBtn">Назад</button>
      </div>`;
    this.overlay.classList.remove('hidden');
    this.overlay.querySelectorAll('[data-room]').forEach((b) => {
      b.onclick = () => onPick(b.dataset.room);
    });
    this.overlay.querySelector('#backBtn').onclick = () => onBack();
  }

  showMissionEnd(mission, rewardText) {
    this.overlay.innerHTML = `
      <div class="card">
        <h1>Миссия выполнена!</h1>
        <p>${mission.name}</p>
        ${rewardText ? `<p class="good">Награда: ${rewardText}</p>` : ''}
        <button id="exitBtn">К столице</button>
      </div>`;
    this.overlay.classList.remove('hidden');
    this.overlay.querySelector('#exitBtn').onclick = () => location.reload();
  }

  // Карта MAIN-шарда 16x16 (2D): провинции, столицы, щиты, атака соседних
  showWorld(api, onExit) {
    this.overlay.innerHTML = `
      <div class="card wide">
        <h1>Карта мира <span id="wDay"></span></h1>
        <canvas id="wmap" width="384" height="384"></canvas>
        <div id="winfo" class="dim">Кликните провинцию</div>
        <div class="lrow"><button id="wAttack" disabled>Атаковать</button><button id="wExitBtn">К столице</button></div>
        <div id="wfeed"></div>
      </div>`;
    this.overlay.classList.remove('hidden');
    const cv = this.overlay.querySelector('#wmap');
    const g = cv.getContext('2d');
    const CELL = 384 / 16;
    let sel = null;
    const colors = { center: '#8a6d2f', gold: '#9a8a3f', forest: '#1d4a24', hill: '#6b5d43', plain: '#2d4a2b' };
    const draw = () => {
      const st = api.state;
      this.overlay.querySelector('#wDay').textContent = `день ${st.day || 1} • онлайн ${st.online || 0}`;
      g.clearRect(0, 0, 384, 384);
      for (const p of st.provs.values()) {
        g.fillStyle = p.o ? (p.o === api.pid ? '#2f9dff' : '#d23c2e') : colors[p.type] || '#222';
        g.fillRect(p.x * CELL + 1, p.z * CELL + 1, CELL - 2, CELL - 2);
        if (p.cap) {
          g.fillStyle = '#ffd76a';
          g.fillRect(p.x * CELL + 8, p.z * CELL + 8, CELL - 16, CELL - 16);
        }
        if (p.sh) {
          g.strokeStyle = '#7ee787';
          g.strokeRect(p.x * CELL + 2, p.z * CELL + 2, CELL - 4, CELL - 4);
        }
        if (sel && sel.id === p.id) {
          g.strokeStyle = '#fff';
          g.strokeRect(p.x * CELL + 1, p.z * CELL + 1, CELL - 2, CELL - 2);
        }
      }
      const feed = this.overlay.querySelector('#wfeed');
      if (feed && st.events) feed.innerHTML = st.events.slice(-3).map((e) => `<div class="ev">${e.text}</div>`).join('');
    };
    cv.onclick = (e) => {
      const r = cv.getBoundingClientRect();
      const px = Math.floor(((e.clientX - r.left) / r.width) * 16);
      const pz = Math.floor(((e.clientY - r.top) / r.height) * 16);
      sel = api.state.provs.get(`p${px}_${pz}`) || null;
      const info = this.overlay.querySelector('#winfo');
      const atk = this.overlay.querySelector('#wAttack');
      if (sel) {
        info.textContent = `${sel.id} • ${sel.type} • ${sel.o ? (sel.o === api.pid ? 'ваша' : 'враг: ' + sel.o) : 'ничья'}${sel.cap ? ' • столица' : ''}${sel.sh ? ' • щит' : ''}`;
        atk.disabled = !(sel.o !== api.pid);
      } else {
        info.textContent = 'Кликните провинцию';
        atk.disabled = true;
      }
    };
    this.overlay.querySelector('#wAttack').onclick = () => {
      if (sel) api.attack(sel.id);
    };
    this.overlay.querySelector('#wExitBtn').onclick = () => onExit();
    api.onDraw = draw;
    draw();
  }

  showLobby(lobby, onStart) {
    const cfg = { map: 'plain', race: 'nord', difficulty: 'normal', mission: null };
    const render = () => {
      this.overlay.innerHTML = `
      <div class="card lobby">
        <h1>Thrones & Towns <span>1.0 Релиз</span></h1>        <div class="lrow"><span>Карта:</span> ${lobby.maps.map((m) => `<button data-k="map" data-v="${m.id}" class="${!cfg.mission && cfg.map === m.id ? 'active' : ''}">${m.name}</button>`).join('')}</div>
        <div class="lrow"><span>Обучение:</span> ${(lobby.missions || []).map((m) => `<button data-k="mission" data-v="${m.id}" title="${m.briefing}" class="${cfg.mission === m.id ? 'active' : ''}">${m.name}</button>`).join('')}</div>
        <div class="lrow"><span>Раса:</span> ${lobby.races.map((r) => `<button data-k="race" data-v="${r.id}" title="${r.desc}" class="${cfg.race === r.id ? 'active' : ''}">${r.name}</button>`).join('')}</div>
        <div class="lrow"><span>Боты:</span> ${lobby.diffs.map((d) => `<button data-k="difficulty" data-v="${d.id}" class="${cfg.difficulty === d.id ? 'active' : ''}">${d.label}</button>`).join('')}</div>
        <p class="dim">Равнина 1v1 • Речная долина 2v2 • Перевал FFA • MMR ${lobby.mmr}</p>
        <button id="startBtn">В бой</button>
        <button id="onlineBtn" title="Сетевой матч через WSS_URL">🌐 В сеть</button>
        <button id="observeBtn" title="Наблюдать матч с задержкой 30с">👁 Смотреть</button>
      </div>`;
      this.overlay.classList.remove('hidden');
      this.overlay.querySelectorAll('[data-k]').forEach((btn) => {
        btn.onclick = () => {
          cfg[btn.dataset.k] = btn.dataset.v;
          if (btn.dataset.k === 'mission') cfg.mission = btn.dataset.v;
          if (btn.dataset.k === 'map') cfg.mission = null;
          render();
        };
      });
      this.overlay.querySelector('#startBtn').onclick = () => {
        this.overlay.classList.add('hidden');
        onStart(cfg);
      };
      const ob = this.overlay.querySelector('#onlineBtn');
      if (ob && lobby.onOnline) {
        ob.onclick = () => {
          this.overlay.classList.add('hidden');
          lobby.onOnline(cfg);
        };
      }
      const ow = this.overlay.querySelector('#observeBtn');
      if (ow && lobby.onObserve) {
        ow.onclick = () => {
          lobby.onObserve(cfg);
        };
      }
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
    const stt = extra.state;
    const me = ME(stt || {});
    const ffa = stt?.mode === 'ffa';
    const win = ffa ? winner === me : winner === 'A';
    const st = { kills: 0, losses: 0 };
    const foe = { kills: 0, losses: 0 };
    for (const [pid, s] of Object.entries(stats)) {
      const mine = ffa ? pid === me : teamOf(stt, pid) === winner;
      const dst = mine ? st : foe;
      dst.kills += s.kills;
      dst.losses += s.losses;
    }
    const mvp = squads
      .filter((s) => (ffa ? s.owner === winner : teamOf(stt, s.owner) === winner))
      .sort((a, b) => (b.kills || 0) - (a.kills || 0))[0];
    const mvpName = mvp ? (extra.unitName ? extra.unitName(mvp.type, mvp.owner) : mvp.type) : '';
    const scoreLine = ffa
      ? `Счёт ${Math.floor(score[me] || 0)} (топ врага ${Math.max(...stt.pids.filter((p) => p !== me).map((p) => Math.floor(score[p] || 0)))})`
      : `Счёт ${Math.floor(score.A)} : ${Math.floor(score.B)}`;
    this.overlay.innerHTML = `
      <div class="card">
        <h1>${win ? 'Победа!' : 'Поражение'}</h1>
        <p>${reason}</p>
        <p>${scoreLine}${extra.mmr != null ? ` • MMR ${extra.mmr}` : ''}</p>
        ${extra.rewardText ? `<p class="good">${extra.rewardText}</p>` : ''}
        <p class="dim">Фраги ${st.kills} : ${foe.kills} • Потери ${st.losses}${mvp ? ` • MVP-отряд: ${mvpName} (${mvp.kills} убийств)` : ''}</p>
        <button id="againBtn">Ещё раз</button>
        ${extra.onReplay ? `<button id="replayBtn">${extra.replayLabel || 'Смотреть реплей'}</button>` : ''}
        ${extra.onExit ? '<button id="exitBtn">К столице</button>' : ''}
      </div>`;
    this.overlay.classList.remove('hidden');
    this.overlay.querySelector('#againBtn').onclick = () => location.reload();
    const rb = this.overlay.querySelector('#replayBtn');
    if (rb && extra.onReplay) rb.onclick = () => extra.onReplay();
    const xb = this.overlay.querySelector('#exitBtn');
    if (xb && extra.onExit) xb.onclick = () => extra.onExit();
  }

  update(state, sel, apm = null) {
    const me = ME(state);
    const p = state.players[me] || state.players.player;
    const r = p.res;
    const prod = p._prod || {};
    const hunger = p.starving ? ' <b class="hunger">⚠️ ГОЛОД</b>' : '';
    this.top.innerHTML = `
      <span title="Еда (кап склада)">🍞 ${Math.floor(r.food)}/${capOf(state, me, 'food')} <i>${prod.food ? '+' + prod.food.toFixed(1) : ''}</i></span>
      <span title="Дерево">🪵 ${Math.floor(r.wood)}/${capOf(state, me, 'wood')} <i>${prod.wood ? '+' + prod.wood.toFixed(1) : ''}</i></span>
      <span title="Камень">🪨 ${Math.floor(r.stone)}</span>
      <span title="Железо">⛓️ ${Math.floor(r.iron)}</span>
      <span title="Золото">🪙 ${Math.floor(r.gold)}</span>
      <span title="Население">👥 ${r.popUsed}/${r.popMax}</span>
      <span title="Лимит отрядов (герой не в счёт)">⚔️ ${state.squads.filter((s) => s.owner === me && s.type !== 'hero').length}/${squadCap(state, me)}</span>${hunger}${apm != null ? `<span title="Приказов/сек (лимит 10)">⚡${apm}</span>` : ''}`;
    // полоса счёта по hud-battle.md: флаги, доход, прогноз
    const win = state.map.winScore || 1000;
    if (state.mode === 'ffa') {
      const foes = state.pids.filter((p) => p !== me);
      const top = Math.max(...foes.map((p) => Math.floor(state.score[p] || 0)));
      this.score.innerHTML = `
        <b class="me">${Math.floor(state.score[me] || 0)}</b>
        <span>${fmtTime(state.t)} • до ${win} • топ врага ${top}</span>
        <b class="en">${top}</b>`;
    } else {
      const flA = state.flags.filter((f) => f.owner === 'A').length;
      const flB = state.flags.filter((f) => f.owner === 'B').length;
      const rates = state.map.scorePerSec || {};
      const inc = flA >= 3 ? rates['3flags'] : flA === 2 ? rates['2flags'] : flA === 1 ? rates['1flag'] : 0;
      const forecast = inc > 0 ? ` • победа через ${Math.max(0, Math.ceil((win - state.score.A) / inc))}с` : '';
      this.score.innerHTML = `
        <b class="me">${Math.floor(state.score.A)}</b>
        <span>${fmtTime(state.t)} • до ${win} • 🚩${flA}-${flB} • +${inc || 0}/с${forecast}</span>
        <b class="en">${Math.floor(state.score.B)}</b>`;
    }
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
    const me = ME(state);
    const r = (state.players[me] || state.players.player).res;
    if (sel.building) {
      const b = state.buildings.find((x) => x.id === sel.building);
      if (!b || b.hp <= 0 || b.owner !== me) {
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
        const rate = Math.round(tradeRate(state, me));
        html += `<button data-trade ${r.wood >= 100 ? '' : 'disabled'}>Обменять 100🪵 → ${rate}🪙</button>`;
        if (state.pids.some((q) => q !== me && teamOf(state, q) === teamOf(state, me))) {
          html += `<button data-give="wood" ${r.wood >= 200 ? '' : 'disabled'}>Союзнику 200🪵</button>`;
          html += `<button data-give="stone" ${r.stone >= 100 ? '' : 'disabled'}>Союзнику 100🪨</button>`;
          html += `<button data-give="iron" ${r.iron >= 100 ? '' : 'disabled'}>Союзнику 100⛓️</button>`;
        }
      }
      if (b.type === 'forge' && b.buildT <= 0) {
        const lv = (state.upgrades[ME(state)] || {}).forge || 0;
        const names = ['', '+10% HP пехоты', '+10% урон пехоты', '+10% броня vs стрелы'];
        html += `<div>Улучшения кузницы: ур.${lv}/3</div>`;
        if (lv < 3) {
          const cost = FORGE_COSTS[lv + 1];
          html += `<button data-forge ${affordable(r, cost) ? '' : 'disabled'}>${names[lv + 1]} ${costText(cost)}</button>`;
        }
      }
      for (const uid of recruitable(state, me, b.type)) {
        const u = unitById(state.units, uid);
        const ok = affordable(r, u.cost);
        html += `<button data-rec="${uid}" ${ok ? '' : 'disabled'}>${u.name} (${u.size} 👥) ${costText(u.cost)} • ${Math.ceil(recruitTime(u))}с</button>`;
      }
      if (recruitable(state, me, b.type).length) html += `<div class="dim">Точка сбора — рядом со зданием</div>`;
      this.panel.innerHTML = html;
      this.panel.classList.remove('hidden');
      this.panel.querySelectorAll('[data-rec]').forEach((btn) => {
        btn.onclick = () => this.cb.onRecruit(b.id, btn.dataset.rec);
      });
      const upBtn = this.panel.querySelector('[data-up]');
      if (upBtn) upBtn.onclick = () => this.cb.onUpgrade(b.id);
      const trBtn = this.panel.querySelector('[data-trade]');
      if (trBtn) trBtn.onclick = () => this.cb.onTrade(b.id);
      const gvBtns = this.panel.querySelectorAll('[data-give]');
      gvBtns.forEach((btn) => {
        btn.onclick = () => this.cb.onGive(b.id, btn.dataset.give);
      });
      const fgBtn = this.panel.querySelector('[data-forge]');
      if (fgBtn) fgBtn.onclick = () => this.cb.onForgeUp(b.id);
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
            let u;
            try {
              u = defOf(state, s.type, s.owner);
            } catch {
              u = null;
            }
            u = u || { name: s.type, size: s.count };
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
    const me = ME(state);
    const r = (state.players[me] || state.players.player).res;
    this.buildmenu.innerHTML =
      `<span class="btitle">Построить:</span>` +
      buildMenuFor(state, me).map((id) => {
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
    const h = state.squads.find((s) => s.owner === ME(state) && s.type === 'hero');
    if (!h) {
      const rp = (state.respawns || []).find((r) => r.pid === ME(state));
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
      <div class="hbar mana"><div style="width:${h.hero.mm ? (h.hero.mana / h.hero.mm) * 100 : 0}%"></div></div>
      <button data-skill="q" class="${this.pendingSkill === 'q' ? 'armed' : ''}" ${qRdy || this.pendingSkill === 'q' ? '' : 'disabled'} title="${q.name}: ${h.hero.qCd > 0 ? Math.ceil(h.hero.qCd) + 'с' : q.mana + ' маны'}">Q ${q.name}</button>
      <button data-skill="e" class="${this.pendingSkill === 'e' ? 'armed' : ''}" ${eRdy || this.pendingSkill === 'e' ? '' : 'disabled'} title="${eSk.name}: ${h.hero.eCd > 0 ? Math.ceil(h.hero.eCd) + 'с' : eSk.mana + ' маны'}">E ${eSk.name}</button>`;
    el.querySelectorAll('[data-skill]').forEach((btn) => {
      btn.onclick = () => this.cb.onSkill(btn.dataset.skill);
    });
  }

  // Цели миссии (панель слева сверху)
  objectives(list) {
    let el = this.root.querySelector('#objectives');
    if (!el) {
      el = document.createElement('div');
      el.id = 'objectives';
      this.root.appendChild(el);
    }
    if (!list) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.innerHTML = `<h4>Задачи</h4>` + list.map((o) => `<div class="${o.done ? 'done' : ''}">${o.done ? '☑' : '☐'} ${o.text}</div>`).join('');
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
      if (owner === ME(state)) return '#2f9dff';
      if (sameTeam(state, owner, ME(state))) return '#9fd0ff';
      const foes = state.pids.filter((p) => p !== ME(state) && !sameTeam(state, p, ME(state)));
      const cols = ['#ff4d4d', '#ffd23f', '#b07dff'];
      const ix = foes.indexOf(owner);
      return ix >= 0 ? cols[ix % cols.length] : '#888';
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
