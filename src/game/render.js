// client/three — рендер 0.1: земля, здания, отряды (капсулы), флаги, трассеры, кольца выбора.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WORLD_SCALE, isVisible, teamOf } from './sim.js';

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class GameRender {
  constructor(container, state, palette) {
    this.state = state;
    this.palette = palette;
    this.worldSize = state.map.size_m * WORLD_SCALE;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1420);
    this.scene.fog = new THREE.Fog(0x0e1420, 220, 520);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 2000);
    const s0 = state.map.spawns[0];
    this.home = { x: s0.x * WORLD_SCALE, z: s0.z * WORLD_SCALE };
    this.camera.position.set(this.home.x, 55, this.home.z + 60);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(this.home.x, 0, this.home.z);
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(60);
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(20);
    this.controls.minDistance = 12;
    this.controls.maxDistance = 260;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.update();

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
    sun.position.set(120, 180, 60);
    this.scene.add(sun);

    this.buildGround(state);
    this.buildStatics(state);
    this.buildFog(state);
    this.buildRiver(state);
    this.buildMountains(state);

    this.dyn = new THREE.Group(); // здания, отряды, флаги
    this.scene.add(this.dyn);

    this.bMeshes = new Map(); // buildingId -> group
    this.sMeshes = new Map(); // squadId -> group
    this.fMeshes = new Map(); // flagId -> {flagMat, ringMat}
    this.rings = new Map(); // entityKey -> ring mesh
    this.barsLayer = document.createElement('div');
    this.barsLayer.className = 'bars-layer';
    container.appendChild(this.barsLayer);
    this.barEls = new Map();

    this.soldierGeo = new THREE.CapsuleGeometry(0.35, 0.8, 3, 8);
    this.teamMats = {};
    for (const [k, hex] of Object.entries(palette.teams)) {
      this.teamMats[k] = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 });
    }
    this.teamMats.neutral = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 1 });
    this.roofMats = {};
    for (const [k, f] of Object.entries(palette.factions)) {
      this.roofMats[k] = new THREE.MeshStandardMaterial({ color: f.roof, roughness: 0.9 });
    }
    this.tracers = [];
    this.tracerGeo = new THREE.BoxGeometry(0.25, 0.25, 1);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });
    this.markRings = [];
    for (let i = 0; i < 8; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.6, 3.1, 32),
        new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      this.scene.add(ring);
      this.markRings.push(ring);
    }    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.tracers.push({ mesh, t: 0, dur: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
    }
    this.resize();
  }

  teamMat(owner) {
    if (owner === 'neutral') return this.teamMats.neutral;
    return this.teamMats[{ player: 'p0', ally: 'p2', enemy1: 'p1', enemy2: 'p2', enemy3: 'p3', bot: 'p1' }[owner] || 'p1'];
  }

  buildGround(state) {
    const W = this.worldSize;
    const tex = canvasTexture(1024, (g, S) => {
      const px = (v) => (v / state.map.size_m) * S; // метры -> px
      g.fillStyle = '#2d4a2b';
      g.fillRect(0, 0, S, S);
      // пятна травы
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(${40 + Math.random() * 30},${80 + Math.random() * 40},${40 + Math.random() * 20},0.5)`;
        const r = 4 + Math.random() * 14;
        g.beginPath();
        g.arc(Math.random() * S, Math.random() * S, r, 0, 7);
        g.fill();
      }
      // леса у west/east
      for (const p of state.map.provinces.filter((p) => p.type === 'forest')) {
        for (let i = 0; i < 90; i++) {
          g.fillStyle = 'rgba(18,60,25,0.9)';
          const r = 5 + Math.random() * 10;
          g.beginPath();
          g.arc(px(p.x) + (Math.random() - 0.5) * 130, px(p.z) + (Math.random() - 0.5) * 130, r, 0, 7);
          g.fill();
        }
      }
      // холмы
      for (const h of state.hills) {
        g.fillStyle = 'rgba(122,102,70,0.9)';
        g.beginPath();
        g.arc(px(h.x), px(h.z), h.r / WORLD_SCALE / state.map.size_m * S, 0, 7);
        g.fill();
      }
      // центр-золото
      const c = state.map.provinces.find((p) => p.type === 'gold');
      if (c) {
        g.fillStyle = 'rgba(180,150,60,0.35)';
        g.beginPath();
        g.arc(px(c.x), px(c.z), 60, 0, 7);
        g.fill();
      }
      // шахты (сырые метры карты)
      g.fillStyle = '#8a8f96';
      for (const mpt of state.map.mines || []) {
        g.fillRect(px(mpt.x) - 4, px(mpt.z) - 4, 8, 8);
      }
      // сетка тайлов (тонко)
      g.strokeStyle = 'rgba(255,255,255,0.04)';
      for (let i = 0; i <= 24; i++) {
        g.beginPath(); g.moveTo((i * S) / 24, 0); g.lineTo((i * S) / 24, S); g.stroke();
        g.beginPath(); g.moveTo(0, (i * S) / 24); g.lineTo(S, (i * S) / 24); g.stroke();
      }
    });
    const geo = new THREE.PlaneGeometry(W, W);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, 0, W / 2);
    ground.userData.ground = true;
    this.ground = ground;
    this.scene.add(ground);
    // координаты мира: 0..W по x/z (карта из метров уже переведена симом)
  }

  buildStatics(state) {
    // холмы-пригорки
    for (const h of state.hills) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(h.r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x6b5d43, roughness: 1 })
      );
      mesh.position.set(h.x, 0, h.z);
      mesh.scale.y = 0.25;
      this.scene.add(mesh);
    }
    // лагери нейтралов — маркеры
    for (const c of state.camps) {
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(1.2, 2.4, 6),
        new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 1 })
      );
      mesh.position.set(c.x, 1.2, c.z);
      this.scene.add(mesh);
    }
    // флаги провинций
    for (const f of state.flags) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 7),
        new THREE.MeshStandardMaterial({ color: 0x888888 })
      );
      pole.position.y = 3.5;
      const flagMat = new THREE.MeshStandardMaterial({ color: 0x999999, side: THREE.DoubleSide });
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2), flagMat);
      flag.position.set(1.7, 5.6, 0);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(6.4, 7, 40), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.1;
      g.add(pole, flag, ring);
      g.position.set(f.x, 0, f.z);
      this.scene.add(g);
      this.fMeshes.set(f.id, { flagMat, ringMat });
    }
  }

  buildFog(state) {
    const N = state.fog.N;
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.fogCanvas.height = N;
    this.fogCtx = this.fogCanvas.getContext('2d');
    this.fogTex = new THREE.CanvasTexture(this.fogCanvas);
    this.fogTex.magFilter = THREE.NearestFilter;
    const W = this.worldSize;
    const mat = new THREE.MeshBasicMaterial({ map: this.fogTex, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, W), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(W / 2, 0.6, W / 2);
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    this.lastFogDraw = -1;
  }

  buildRiver(state) {
    const r = state.river;
    if (!r) return;
    const W = this.worldSize;
    const waterMat = new THREE.MeshBasicMaterial({ color: 0x2a6f9e, transparent: true, opacity: 0.75 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(r.half * 2, W), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(r.x, 0.25, W / 2);
    this.scene.add(water);
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
    const addBridge = (z, half) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(r.half * 2 + 6, 0.5, half * 2), bridgeMat);
      b.position.set(r.x, 0.35, z);
      this.scene.add(b);
    };
    for (const b of r.bridges) addBridge(b.z, b.half);
    if (r.ford) {
      const ford = new THREE.Mesh(
        new THREE.PlaneGeometry(r.half * 2, r.ford.half * 2),
        new THREE.MeshBasicMaterial({ color: 0x7fb8d9, transparent: true, opacity: 0.6 })
      );
      ford.rotation.x = -Math.PI / 2;
      ford.position.set(r.x, 0.3, r.ford.z);
      this.scene.add(ford);
    }
  }

  buildMountains(state) {
    const mt = state.mountains;
    if (mt) {
      const W = this.worldSize;
      const mat = new THREE.MeshStandardMaterial({ color: 0x5a5f6b, roughness: 1 });
      // хребет полосами, разрывы — проходы
      const segs = [];
      let z0 = 0;
      const gaps = [...mt.gaps].sort((a, b) => a.z - b.z);
      for (const gp of gaps) {
        segs.push([z0, gp.z - gp.half]);
        z0 = gp.z + gp.half;
      }
      segs.push([z0, W]);
      for (const [a, b] of segs) {
        if (b - a < 1) continue;
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(mt.half * 2, 7, b - a), mat);
        ridge.position.set(mt.x, 3.5, (a + b) / 2);
        this.scene.add(ridge);
      }
    }
    // пинги коопа
    this.pingRings = [];
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.2, 2.8, 32),
        new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      this.scene.add(ring);
      this.pingRings.push(ring);
    }
  }

  syncPings(state) {
    if (!this.pingRings) return;
    let i = 0;
    for (const pg of state.pings) {
      if (i >= this.pingRings.length) break;
      const ring = this.pingRings[i++];
      ring.visible = true;
      ring.position.set(pg.x, 0.2, pg.z);
      const s = 1 + (8 - pg.t) * 0.15;
      ring.scale.setScalar(s);
    }
    for (; i < this.pingRings.length; i++) this.pingRings[i].visible = false;
  }

  drawFog(state) {
    if (state.t - this.lastFogDraw < 0.19) return;
    this.lastFogDraw = state.t;
    const { N, vis, exp } = state.fog;
    const img = this.fogCtx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const o = i * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 0;
      img.data[o + 3] = vis[i] ? 0 : exp[i] ? 115 : 218;
    }
    this.fogCtx.putImageData(img, 0, 0);
    this.fogTex.needsUpdate = true;
  }

  buildingSize(type) {
    switch (type) {
      case 'townhall': return { w: 9, h: 6, d: 9 };
      case 'barracks': return { w: 7, h: 4, d: 5 };
      case 'tower': return { w: 3, h: 10, d: 3 };
      case 'house': return { w: 4, h: 3, d: 4 };
      case 'farm': return { w: 6, h: 1.5, d: 6 };
      case 'wall': return { w: 1.9, h: 2.6, d: 1.0 };
      case 'mill': return { w: 3, h: 9, d: 3 };
      case 'temple': return { w: 5, h: 4, d: 5 };
      case 'market': return { w: 6, h: 3, d: 5 };
      case 'mine': return { w: 5, h: 2.5, d: 5 };
      default: return { w: 5, h: 3.5, d: 5 };
    }
  }

  // акцентные детали по типу (купол храма, лопасти мельницы, труба пекарни)
  decorateBuilding(g, type, w, h, d, owner) {
    if (type === 'mill') {
      const blades = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.9 });
      for (let i = 0; i < 4; i++) {
        const arm = new THREE.Group();
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.5, 0.2), mat);
        blade.position.y = 2.75;
        arm.add(blade);
        arm.rotation.z = (i * Math.PI) / 2;
        blades.add(arm);
      }
      blades.position.set(0, h - 1, d / 2 + 0.4);
      g.add(blades);
      g.userData.blades = blades;
    } else if (type === 'temple') {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(w, d) * 0.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xffd76a, roughness: 0.5, metalness: 0.4 })
      );
      dome.position.y = h;
      g.add(dome);
    } else if (type === 'bakery') {
      const chimney = new THREE.Mesh(
        new THREE.BoxGeometry(1, 3, 1),
        new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 1 })
      );
      chimney.position.set(w / 4, h + 1, 0);
      g.add(chimney);
    } else if (type === 'market') {
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(w + 1, 0.4, d + 1),
        new THREE.MeshStandardMaterial({ color: owner === 'player' || owner === 'ally' ? 0xe8b400 : 0xd23c2e, roughness: 0.9 })
      );
      awning.position.y = h + 0.6;
      g.add(awning);
    } else if (type === 'mine') {
      const beams = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.7, h * 1.6, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 1 })
      );
      beams.position.y = h * 0.8;
      beams.rotation.z = 0.5;
      g.add(beams);
    }
  }

  syncBuilding(b, bdef) {
    let g = this.bMeshes.get(b.id);
    if (!g && b.hp > 0) {
      g = new THREE.Group();
      const { w, h, d } = this.buildingSize(b.type);
      if (b.type === 'wall') {
        const stone = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 1 });
        const seg = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stone);
        seg.position.y = h / 2;
        const teeth = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), this.teamMat(b.owner));
        teeth.position.y = h + 0.25;
        g.add(seg, teeth);
      } else {
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.9 })
        );
        body.position.y = h / 2;
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(Math.max(w, d) * 0.72, h * 0.7, 4),
          (this.roofMats[{ nord: 'nord', kaganat: 'kaganat', league: 'league' }[this.state.raceOf?.[b.owner]] || 'nord']).clone()
        );
        roof.position.y = h + h * 0.35;
        roof.rotation.y = Math.PI / 4;
        const banner = new THREE.Mesh(new THREE.BoxGeometry(w * 0.2, h * 0.9, d + 0.3), this.teamMat(b.owner));
        banner.position.y = h / 2;
        g.add(body, roof, banner);
        this.decorateBuilding(g, b.type, w, h, d, b.owner);
      }
      g.position.set(b.x, 0, b.z);
      g.traverse((o) => { if (o.isMesh) o.userData.entity = { kind: 'building', id: b.id }; });
      this.dyn.add(g);
      this.bMeshes.set(b.id, g);
    }
    if (g) {
      g.visible = b.hp > 0 && isVisible(this.state, b);
      const progress = b.buildT > 0 ? 1 - b.buildT / b.buildTotal : 1;
      g.scale.setScalar(0.3 + 0.7 * progress);
      if (g.userData.blades && b.hp > 0 && b.buildT <= 0) g.userData.blades.rotation.z += 0.02;
      g.traverse((o) => {
        if (o.isMesh) o.userData.entity = { kind: 'building', id: b.id };
      });
    }
  }

  syncSquad(s) {
    let g = this.sMeshes.get(s.id);
    if (!g) {
      g = new THREE.Group();
      const mat = this.teamMat(s.owner);
      for (const sol of s.soldiers) {
        const mesh = new THREE.Mesh(this.soldierGeo, mat);
        mesh.position.set(sol.dx, 0.9, sol.dz);
        mesh.userData.entity = { kind: 'squad', id: s.id };
        g.add(mesh);
      }
      if (s.type === 'hero') {
        // герой в 1.5 раза крупнее + золотая метка (leveling-gear.md вид)
        g.scale.setScalar(1.45);
        const crown = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.5),
          new THREE.MeshBasicMaterial({ color: 0xffd76a })
        );
        crown.position.y = 2.6;
        g.userData.crown = crown;
        g.add(crown);
        const auraR = s.hero ? 5.5 : 5.5;
        const aura = new THREE.Mesh(
          new THREE.RingGeometry(auraR - 0.3, auraR, 48),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
        );
        aura.rotation.x = -Math.PI / 2;
        aura.position.y = 0.12;
        g.userData.aura = aura;
        g.add(aura);
      }
      this.dyn.add(g);
      this.sMeshes.set(s.id, g);
    }
    g.position.set(s.x, 0, s.z);
    g.visible = isVisible(this.state, s);
    g.rotation.y = s.face || 0;
    if (g.userData.crown) g.userData.crown.rotation.y += 0.03;
    if (g.userData.aura) g.userData.aura.visible = s.owner === 'player' || teamOf(this.state, s.owner) === 'A';
    // засада: полупрозрачность (материалы клонируем один раз)
    const ghost = (s.invisT || 0) > 0;
    if (ghost !== !!g.userData.ghost) {
      g.userData.ghost = ghost;
      for (const child of g.children) {
        if (!child.isMesh || child === g.userData.crown || child === g.userData.aura) continue;
        if (ghost && !child.userData.ownMat) {
          child.material = child.material.clone();
          child.userData.ownMat = true;
        }
        if (child.userData.ownMat) {
          child.material.transparent = ghost;
          child.material.opacity = ghost ? 0.35 : 1;
        }
      }
    }
    // рассыпной строй — бойцы шире
    const spread = s.loose ? 2 : 1;
    let i = 0;
    for (const child of g.children) {
      const sol = s.soldiers[i++];
      child.visible = !!(sol && sol.alive);
      if (sol) child.position.set(sol.dx * spread, 0.9, sol.dz * spread);
    }
  }

  consumeShots(state) {
    if (!state.shots) return;
    for (const sh of state.shots.splice(0)) {
      const slot = this.tracers.find((t) => t.t <= 0);
      if (!slot) continue;
      slot.from.set(sh.x1, 6, sh.z1);
      slot.to.set(sh.x2, 1, sh.z2);
      slot.t = slot.dur = 0.22;
      slot.mesh.visible = true;
    }
  }

  updateTracers(dt) {
    for (const t of this.tracers) {
      if (t.t <= 0) continue;
      t.t -= dt;
      const k = 1 - Math.max(t.t, 0) / t.dur;
      t.mesh.position.lerpVectors(t.from, t.to, k);
      t.mesh.lookAt(t.to);
      if (t.t <= 0) t.mesh.visible = false;
    }
  }

  syncFlags(state) {
    for (const f of state.flags) {
      const rec = this.fMeshes.get(f.id);
      if (!rec) continue;
      const color = f.owner === 'player' ? 0x2f9dff : f.owner === 'bot' ? 0xff4d4d : 0x999999;
      rec.flagMat.color.setHex(color);
      rec.ringMat.color.setHex(color);
      rec.ringMat.opacity = f.progress > 0 ? 0.4 + 0.5 * Math.abs(Math.sin(state.t * 4)) : 0.6;
    }
  }

  syncRings(sel) {    const want = new Set();
    for (const id of sel.squads) want.add(`squad:${id}`);
    if (sel.building) want.add(`building:${sel.building}`);
    for (const [key, ring] of this.rings) {
      if (!want.has(key)) {
        ring.visible = false;
      }
    }
    for (const key of want) {
      let ring = this.rings.get(key);
      if (!ring) {
        ring = new THREE.Mesh(
          new THREE.RingGeometry(2.4, 3, 32),
          new THREE.MeshBasicMaterial({ color: 0x39d353, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        this.scene.add(ring);
        this.rings.set(key, ring);
      }
      const [kind, id] = key.split(':');
      const g = kind === 'squad' ? this.sMeshes.get(Number(id)) : this.bMeshes.get(Number(id));
      if (g) {
        ring.visible = true;
        ring.position.set(g.position.x, 0.15, g.position.z);
        const s = kind === 'squad' ? 1.6 : 2.6;
        ring.scale.setScalar(s);
      } else {
        ring.visible = false;
      }
    }
  }

  syncBars(state, sel) {
    const seen = new Set();
    const cam = this.camera;
    const v = new THREE.Vector3();
    const put = (key, x, y, z, frac, label) => {
      if (frac >= 0.999 && key !== sel) return;
      seen.add(key);
      v.set(x, y, z).project(cam);
      if (v.z > 1) return;
      let el = this.barEls.get(key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'hpbar';
        el.innerHTML = '<div class="hpfill"></div><div class="hplabel"></div>';
        this.barsLayer.appendChild(el);
        this.barEls.set(key, el);
      }
      const sx = (v.x * 0.5 + 0.5) * innerWidth;
      const sy = (-v.y * 0.5 + 0.5) * innerHeight;
      el.style.transform = `translate(${sx - 30}px, ${sy}px)`;
      el.querySelector('.hpfill').style.width = `${Math.max(0, Math.min(100, frac * 100))}%`;
      el.querySelector('.hplabel').textContent = label || '';
      el.style.display = 'block';
    };
    for (const s of state.squads) {
      if (s.owner !== 'player' && !isVisible(state, s)) continue;
      if (s.owner !== 'player' && s.hp / s.hpMax > 0.999) continue;
      put(`sq${s.id}`, s.x, 3.2, s.z, s.hp / s.hpMax, `${s.count}`);
    }
    for (const b of state.buildings) {
      if (b.hp <= 0 || b.hp / b.hpMax > 0.999) continue;
      if (b.owner !== 'player' && !isVisible(state, b)) continue;
      put(`bd${b.id}`, b.x, 9, b.z, b.hp / b.hpMax, '');
    }
    for (const [key, el] of this.barEls) {
      if (!seen.has(key)) el.style.display = 'none';
    }
  }

  sync(state, sel, dt) {
    this.consumeShots(state);
    this.updateTracers(dt);
    this.drawFog(state);
    // здания
    const bIds = new Set();
    for (const b of state.buildings) {
      bIds.add(b.id);
      const bdef = { id: b.type };
      this.syncBuilding(b, bdef);
    }
    for (const [id, g] of this.bMeshes) {
      if (!bIds.has(id)) {
        this.dyn.remove(g);
        this.bMeshes.delete(id);
      }
    }
    // отряды
    const sIds = new Set();
    for (const s of state.squads) {
      sIds.add(s.id);
      this.syncSquad(s);
    }
    for (const [id, g] of this.sMeshes) {
      if (!sIds.has(id)) {
        this.dyn.remove(g);
        this.sMeshes.delete(id);
      }
    }
    this.syncFlags(state);
    this.syncRings(sel);
    this.syncMarks(state);
    this.syncPings(state);
    this.syncBars(state, null);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  syncMarks(state) {
    let i = 0;
    const mark = (x, z, s) => {
      if (i >= this.markRings.length) return;
      const ring = this.markRings[i++];
      ring.visible = true;
      ring.position.set(x, 0.18, z);
      ring.scale.setScalar((s || 1) * (1 + 0.08 * Math.sin(state.t * 6)));
    };
    for (const s of state.squads) {
      if ((s.markT || 0) > 0 && isVisible(state, s)) mark(s.x, s.z, s.type === 'hero' ? 1.4 : 1.6);
    }
    for (const b of state.buildings) {
      if ((b.markT || 0) > 0 && b.hp > 0 && isVisible(state, b)) mark(b.x, b.z, 2.2);
    }
    for (; i < this.markRings.length; i++) this.markRings[i].visible = false;
  }

  pick(ndc) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const hits = rc.intersectObjects(this.dyn.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.entity) o = o.parent;
      if (!o) continue;
      // невидимых в тумане выбирать/атаковать нельзя
      const ent = o.userData.entity;
      const list = ent.kind === 'squad' ? this.state.squads : this.state.buildings;
      const target = list.find((x) => x.id === ent.id);
      if (target && teamOf(this.state, target.owner) !== 'A' && !isVisible(this.state, target)) continue;
      return ent;
    }
    return null;
  }

  groundPoint(ndc) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const hit = rc.intersectObject(this.ground);
    return hit.length ? hit[0].point : null;
  }

  resize() {
    const w = this.renderer.domElement.parentElement.clientWidth || innerWidth;
    const h = this.renderer.domElement.parentElement.clientHeight || innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
