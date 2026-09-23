// heroMesh — 9 героев: x1.5, свой силуэт, иконка класса, аура, свечение тира шмота.
// Стиль тот же чиби что юниты (hero-vs-unit.md): масштаб + силуэт + маркер отличают.
import * as THREE from 'three';
import { defOf, isVisible } from './sim.js';

const SKIN = 0xe8b98a;
const ICONS = {
  warlord: '⚔', paladin: '🛡', druid: '🌿', barbarian: '🪓', rogue: '🗡',
  necromancer: '💀', mage: '🔮', steward: '⚖', ranger: '🏹',
};
const TIER_GLOW = { gray: null, blue: '#4488ff', purple: '#cc66ff' };

function iconTexture(arch, tier) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const glow = TIER_GLOW[tier];
  if (glow) {
    const grad = g.createRadialGradient(32, 32, 6, 32, 32, 30);
    grad.addColorStop(0, glow);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  g.fillStyle = 'rgba(10,12,20,0.85)';
  g.beginPath();
  g.arc(32, 32, 20, 0, 7);
  g.fill();
  g.strokeStyle = glow || '#888';
  g.lineWidth = 3;
  g.stroke();
  g.font = '30px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ICONS[arch] || '?', 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, transparent: true, ...opts });
}
function box(parent, w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function sph(parent, r, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cyl(parent, rt, rb, h, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 8), mat(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cone(parent, r, h, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), mat(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export class HeroMesh {
  constructor(scene) {
    this.scene = scene;
    this.rigs = new Map(); // squadId -> {group, arm, icon, aura, phase, lx, lz}
    this.iconCache = new Map();
  }

  icon(arch, tier) {
    const k = `${arch}:${tier || 'gray'}`;
    if (!this.iconCache.has(k)) {
      this.iconCache.set(k, iconTexture(arch, tier || 'gray'));
    }
    return this.iconCache.get(k);
  }

  buildRig(arch, teamHex) {
    const g = new THREE.Group();
    const team = new THREE.Color(teamHex);
    const teamMat = new THREE.MeshLambertMaterial({ color: team });
    // ноги + торс-база
    box(g, 0.55, 0.6, 0.4, 0x3a3a44, 0, 0.3, 0);
    const torso = box(g, 0.7, 0.75, 0.48, 0x555560, 0, 0.95, 0);
    const head = sph(g, 0.3, SKIN, 0, 1.62, 0.03);
    // плащ команды
    const cloak = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.0), teamMat);
    cloak.position.set(0, 0.85, -0.3);
    cloak.rotation.x = 0.12;
    g.add(cloak);
    // рука с оружием (для каст-стейтов)
    const arm = new THREE.Group();
    arm.position.set(0.45, 1.2, 0);
    g.add(arm);
    const put = (fn) => fn;
    void put;
    const W = {
      warlord() {
        torso.material.color.set(0x4a4a55);
        sph(g, 0.32, 0x8a8f96, 0, 1.7, 0); // шлем
        cone(g, 0.09, 0.35, 0xe8e0cc, -0.28, 1.95, 0).rotation.z = 0.7; // рога
        cone(g, 0.09, 0.35, 0xe8e0cc, 0.28, 1.95, 0).rotation.z = -0.7;
        box(arm, 0.12, 1.1, 0.07, 0x9aa0a8, 0, 0.4, 0.15); // меч
        box(arm, 0.22, 0.1, 0.09, 0x6b4a2f, 0, -0.1, 0.15);
        cyl(g, 0.04, 0.04, 1.9, 0x6b4a2f, -0.5, 1.0, -0.1); // знамя-древко
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.4), teamMat.clone());
        flag.position.set(-0.22, 1.7, -0.1);
        g.add(flag);
      },
      steward() {
        torso.material.color.set(0x6b4a33);
        cyl(g, 0.3, 0.32, 0.22, 0x3a3a44, 0, 1.82, 0); // круглая шапка
        box(arm, 0.16, 0.9, 0.16, 0x6b4a2f, 0, 0.3, 0.15); // молот-рукоять
        box(arm, 0.3, 0.22, 0.22, 0x5a5f6b, 0, 0.75, 0.15); // боёк
        box(g, 0.3, 0.4, 0.08, 0xe8e0cc, -0.3, 0.9, 0.28); // гроссбух
      },
      ranger() {
        torso.material.color.set(0x3f6b3f);
        cone(g, 0.34, 0.5, 0x2f5a2f, 0, 1.85, -0.03); // капюшон
        const bow = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 6, 10, Math.PI), mat(0x6b4a2f));
        bow.position.set(0.45, 0.4, 0.15);
        bow.rotation.y = Math.PI / 2;
        arm.add(bow);
        box(g, 0.18, 0.55, 0.18, 0x6b4a2f, -0.32, 1.1, -0.32); // колчан
      },
      paladin() {
        torso.material.color.set(0x7a8aa0);
        sph(g, 0.32, 0x9aa0a8, 0, 1.7, 0);
        cyl(arm, 0.34, 0.34, 0.08, 0xe8e0cc, 0, 0.35, 0.2, Math.PI / 2, 0, 0); // щит-солнце
        sph(arm, 0.12, 0xe8b400, 0, 0.35, 0.26); // босс-солнце
        box(arm, 0.14, 0.7, 0.14, 0x8a6f4d, 0, -0.2, 0.1); // булава
        box(g, 0.74, 0.12, 0.5, 0xe8b400, 0, 1.28, 0); // золотая оторочка
      },
      druid() {
        torso.material.color.set(0x4a5a34);
        cyl(g, 0.04, 0.05, 2.0, 0x5a4028, 0.5, 1.0, 0.1); // посох-ветка
        cone(g, 0.12, 0.3, 0x3f7a3f, 0.5, 2.05, 0.1); // листва
        cone(g, 0.34, 0.5, 0x3a4a2a, 0, 1.85, -0.03); // капюшон
        box(g, 0.3, 0.25, 0.1, 0x8a7a5a, -0.25, 0.85, 0.3); // борода? сумка
      },
      barbarian() {
        torso.material.color.set(SKIN); // голый торс
        box(g, 0.74, 0.14, 0.5, 0xb03030, 0, 1.28, 0); // головная повязка-обруч
        cyl(g, 0.32, 0.34, 0.14, 0xb03030, 0, 1.78, 0); // обруч
        box(arm, 0.12, 0.7, 0.1, 0x6b4a2f, 0, 0.3, 0.12); // топор 1
        box(arm, 0.3, 0.22, 0.06, 0x8a8f96, 0, 0.65, 0.12);
        const arm2 = new THREE.Group();
        arm2.position.set(-0.45, 1.2, 0);
        g.add(arm2);
        box(arm2, 0.12, 0.7, 0.1, 0x6b4a2f, 0, 0.3, 0.12); // топор 2
        box(arm2, 0.3, 0.22, 0.06, 0x8a8f96, 0, 0.65, 0.12);
        g.userData.arm2 = arm2;
        const trail = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), mat(0xb03030, { transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
        trail.position.set(0, 0.6, -0.32);
        g.add(trail);
      },
      rogue() {
        torso.material.color.set(0x1a1a22);
        cone(g, 0.33, 0.5, 0x1a1a22, 0, 1.85, -0.03); // капюшон
        box(g, 0.4, 0.16, 0.1, 0x0a0a0e, 0, 1.58, 0.2); // маска
        box(arm, 0.09, 0.55, 0.05, 0x9aa0a8, 0, 0.2, 0.12); // кинжал
        const arm2 = new THREE.Group();
        arm2.position.set(-0.45, 1.2, 0);
        g.add(arm2);
        box(arm2, 0.09, 0.55, 0.05, 0x9aa0a8, 0, 0.2, 0.12);
        g.userData.arm2 = arm2;
        cloak.material.color.set(0x2a1a3a); // фиолетовый плащ вместо командного
      },
      necromancer() {
        torso.material.color.set(0x14141a);
        cone(g, 0.42, 1.1, 0x14141a, 0, 0.85, 0); // балахон
        cyl(g, 0.04, 0.05, 1.9, 0x3a3028, 0.5, 0.95, 0.1); // череп-посох
        sph(g, 0.14, 0xe8e0cc, 0.5, 1.95, 0.1); // череп
        const wisp = sph(g, 0.12, 0x39d353, -0.4, 1.4, 0.2); // зелёный туман-огонёк
        wisp.material = mat(0x39d353, { transparent: true, opacity: 0.85, emissive: 0x39d353, emissiveIntensity: 0.8 });
        g.userData.wisp = wisp;
        box(g, 0.25, 0.32, 0.1, 0x5a4028, -0.3, 0.9, 0.3); // книга
      },
      mage() {
        torso.material.color.set(0x7a2e1e);
        cyl(g, 0.04, 0.05, 1.9, 0x5a4028, 0.5, 0.95, 0.1); // посох
        const cry = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), mat(0xff4422, { emissive: 0xff4422, emissiveIntensity: 0.7 }));
        cry.position.set(0.5, 1.95, 0.1); // кристалл
        g.add(cry);
        box(g, 0.25, 0.32, 0.1, 0x6b2a1a, -0.3, 0.9, 0.3); // книга рун
        cone(g, 0.3, 0.4, 0x5a2018, 0, 1.82, -0.03); // капюшон
      },
    };
    (W[arch] || W.warlord)();
    // иконка класса над головой
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.icon(arch, 'gray'), depthTest: true }));
    icon.scale.set(1.6, 1.6, 1);
    icon.position.y = 3.1;
    g.add(icon);
    // круг ауры
    const aura = new THREE.Mesh(
      new THREE.RingGeometry(5.2, 5.5, 40),
      new THREE.MeshBasicMaterial({ color: team, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.12;
    g.add(aura);
    g.scale.setScalar(1.5);
    this.scene.add(g);
    return { group: g, arm: arm, icon, aura, phase: Math.random() * 6, lx: 0, lz: 0 };
  }

  sync(state, time, dt, isVisible, teamHexOf) {
    const seen = new Set();
    for (const s of state.squads) {
      if (s.type !== 'hero' || s.count <= 0) continue;
      if (!isVisible(state, s)) continue;
      seen.add(s.id);
      let r = this.rigs.get(s.id);
      const def = defOf(state, 'hero', s.owner);
      const tier = this.gearTier(s);
      if (!r) {
        r = this.buildRig(s.hero.arch, teamHexOf(s.owner));
        r.icon.material.map = this.icon(s.hero.arch, tier);
        r.icon.material.needsUpdate = true;
        r.lx = s.x;
        r.lz = s.z;
        this.rigs.set(s.id, r);
      }
      // тир сменился — перерисовать иконку
      const wantTier = tier;
      if (r.tier !== wantTier) {
        r.tier = wantTier;
        r.icon.material.map = this.icon(s.hero.arch, wantTier);
        r.icon.material.needsUpdate = true;
      }
      // движение/стойки: idle bob, walk lean, cast — рука вверх + вспышка
      const moved = Math.hypot(s.x - r.lx, s.z - r.lz);
      if (moved > 0.02) r.phase += moved * 3;
      r.lx = s.x;
      r.lz = s.z;
      r.group.position.set(s.x, moved > 0.02 ? Math.abs(Math.sin(r.phase)) * 0.2 : Math.sin(time * 1.6 + r.phase) * 0.05, s.z);
      r.group.rotation.y = s.face || 0;
      r.group.rotation.x = moved > 0.02 ? 0.08 : 0;
      if (s.castT > 0) {
        s.castT -= dt;
        r.arm.rotation.x = -1.8; // замах посохом/оружием
        if (r.group.userData.arm2) r.group.userData.arm2.rotation.x = -1.8;
        r.icon.scale.set(2.0, 2.0, 1);
      } else {
        r.arm.rotation.x = moved > 0.02 ? Math.sin(r.phase) * 0.5 : 0;
        if (r.group.userData.arm2) r.group.userData.arm2.rotation.x = moved > 0.02 ? -Math.sin(r.phase) * 0.5 : 0;
        r.icon.scale.set(1.6, 1.6, 1);
      }
      // аура по радиусу из данных
      if (def?.auraR) {
        const sc = def.auraR / 5.5;
        r.aura.scale.set(sc, sc, 1);
      }
      // инвиз
      const ghost = (s.invisT || 0) > 0 || !!s.stealthHide;
      r.group.traverse((o) => {
        if (o.isMesh && o.material.transparent !== undefined) {
          o.material.transparent = ghost || o.material.opacity < 1;
          o.material.opacity = ghost ? 0.35 : 1;
        }
      });
      r.aura.visible = !ghost;
      r.group.visible = true;
    }
    for (const [id, r] of this.rigs) {
      if (!seen.has(id)) r.group.visible = false;
    }
  }

  gearTier(s) {
    // тир по шмоту героя: есть фиолет — яркое свечение, синь — слабое
    if (!s.hero) return 'gray';
    // тир восстанавливаем по маркеру: герой из вьюхи не несёт тиры — смотрим герою-мету? упрощение:
    // светим по уровню: 10+ синий оттенок, 20+ фиолет (документировано как приближение)
    if (s.hero.level >= 20) return 'purple';
    if (s.hero.level >= 10) return 'blue';
    return 'gray';
  }
}
