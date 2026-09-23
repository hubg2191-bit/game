// validate: APM 10/сек, владение, туман, цены/лимиты/КД (protocol.md + sync.md).
// Невалидное отклоняется с {err}; телепорт невозможен по построению (позиции задаёт только сим).
import { sim, CFG } from './simAdapter.js';

export function makeLimiter() {
  const hits = [];
  return {
    check() {
      const now = Date.now();
      while (hits.length && now - hits[0] > 1000) hits.shift();
      if (hits.length >= CFG.maxOrdersPerSec) return false;
      hits.push(now);
      return true;
    },
  };
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

export function validateCmd(state, pid, msg) {
  const W = state.map.size_m * sim.WORLD_SCALE;
  const inMap = (x, z) => finite(x) && finite(z) && x >= 0 && x <= W && z >= 0 && z <= W;
  const ownSquads = (ids) => Array.isArray(ids) && ids.length > 0 && ids.length <= 24
    && ids.every((id) => state.squads.some((s) => s.id === id && s.owner === pid && s.count > 0));

  switch (msg.cmd) {
    case 'move': {
      if (!ownSquads(msg.ids) || !inMap(msg.x, msg.z)) return { err: 'invalid' };
      return { ok: true };
    }
    case 'attack': {
      if (!ownSquads(msg.ids)) return { err: 'invalid' };
      const list = msg.kind === 'building' ? state.buildings : state.squads;
      const t = list.find((x) => x.id === msg.target);
      if (!t || t.hp <= 0 || (t.count !== undefined && t.count <= 0)) return { err: 'invalid' };
      if (sim.sameTeam(state, t.owner, pid)) return { err: 'invalid' };
      if (!sim.isVisibleFor(state, t, pid)) return { err: 'fog' };
      return { ok: true };
    }
    case 'build': {
      if (typeof msg.b !== 'string' || !inMap(msg.x, msg.z)) return { err: 'invalid' };
      const reason = sim.buildBlockReason(state, pid, msg.b, msg.x, msg.z);
      if (reason) return { err: 'invalid', reason };
      const def = sim.buildingById(state.bdefs, msg.b);
      const cost = msg.b === 'wall' ? { stone: sim.WALL_COST } : def?.cost;
      if (!sim.affordable(state.players[pid].res, cost || {})) return { err: 'no_gold' };
      return { ok: true };
    }
    case 'recruit': {
      const b = state.buildings.find((x) => x.id === msg.b);
      if (!b || b.owner !== pid || b.buildT > 0) return { err: 'invalid' };
      if (!sim.recruitable(state, pid, b.type).includes(msg.unit)) return { err: 'invalid' };
      const u = sim.unitById(state.units, msg.unit);
      if (!u || !sim.affordable(state.players[pid].res, u.cost || {})) return { err: 'no_gold' };
      return { ok: true };
    }
    case 'stance': {
      // stance 'loose' = рассыпной (F), остальное — line
      if (!ownSquads(msg.ids) || !['loose', 'line'].includes(msg.stance)) return { err: 'invalid' };
      return { ok: true };
    }
    case 'cast': {
      const h = state.squads.find((s) => s.owner === pid && s.type === 'hero' && s.count > 0);
      if (!h || !state.heroesData) return { err: 'invalid' };
      const H = state.heroesData.heroes.find((x) => x.id === h.hero.arch);
      const sk = H.skills[msg.slot === 'q' ? 0 : 1];
      if (!sk) return { err: 'invalid' };
      const cd = msg.slot === 'q' ? h.hero.qCd : h.hero.eCd;
      if (cd > 0 || h.hero.mana < sk.mana) return { err: 'invalid', reason: 'cd' };
      return { ok: true };
    }
    case 'ping': {
      if (!['F1', 'F2', 'F4'].includes(msg.ping)) return { err: 'invalid' };
      if (msg.ping === 'F1' && !inMap(msg.x, msg.z)) return { err: 'invalid' };
      if (!state.pids.some((q) => q !== pid && sim.sameTeam(state, q, pid))) return { err: 'invalid' };
      return { ok: true };
    }
    case 'upgrade': {
      const b = state.buildings.find((x) => x.id === msg.b);
      if (!b || b.owner !== pid || b.type !== 'townhall') return { err: 'invalid' };
      return { ok: true };
    }
    case 'trade':
    case 'give': {
      const hasMarket = state.buildings.some((b) => b.owner === pid && b.type === 'market' && b.hp > 0 && b.buildT <= 0);
      if (!hasMarket) return { err: 'invalid' };
      return { ok: true };
    }
    case 'forge': {
      const b = state.buildings.find((x) => x.id === msg.b);
      if (!b || b.owner !== pid || b.type !== 'forge') return { err: 'invalid' };
      return { ok: true };
    }
    default:
      return { err: 'invalid' };
  }
}

// Применить валидную команду к симу (возвращает false если сим отклонил на всякий случай).
export function applyCmd(state, pid, msg) {
  switch (msg.cmd) {
    case 'move':
      sim.orderMove(state, msg.ids, msg.x, msg.z);
      return true;
    case 'attack':
      sim.orderAttack(state, msg.ids, { kind: msg.kind === 'building' ? 'building' : 'squad', id: msg.target });
      return true;
    case 'build':
      return sim.construct(state, pid, msg.b, msg.x, msg.z);
    case 'recruit':
      return sim.recruit(state, pid, msg.b, msg.unit);
    case 'stance': {
      let n = 0;
      for (const s of state.squads) {
        if (msg.ids.includes(s.id) && s.owner === pid) {
          s.loose = msg.stance === 'loose';
          n++;
        }
      }
      return n > 0;
    }
    case 'cast': {
      const h = state.squads.find((s) => s.owner === pid && s.type === 'hero' && s.count > 0);
      if (!h) return false;
      const tgt = msg.target != null
        ? { kind: msg.kind === 'building' ? 'building' : 'squad', id: msg.target }
        : null;
      return sim.castSkill(state, pid, h.id, msg.slot, tgt);
    }
    case 'ping': {
      const map = { F1: 'attack', F2: 'defend', F4: 'follow' };
      const kind = map[msg.ping];
      if (kind === 'attack') sim.setDirective(state, { kind, x: msg.x, z: msg.z });
      else sim.setDirective(state, { kind });
      return true;
    }
    case 'upgrade':
      return sim.upgrade(state, pid, msg.b);
    case 'trade':
      return sim.trade(state, pid) > 0;
    case 'give':
      return sim.giveAlly(state, pid);
    case 'forge':
      return sim.forgeUpgrade(state, pid, msg.b);
    default:
      return false;
  }
}
