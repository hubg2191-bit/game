// client/three — рендер 0.1: земля, здания, отряды (капсулы), флаги, трассеры, кольца выбора.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WORLD_SCALE, isVisible, teamOf, sameTeam } from './sim.js';
import { UnitsMesh } from './unitsMesh.js';
import { HeroMesh } from './heroMesh.js';

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
    // светлый фон 2.5D (было 0x1a2436 — темно); туман в цвет фона
    this.scene.background = new THREE.Color(0x5f6f8f);
    this.scene.fog = new THREE.Fog(0x5f6f8f, 260, 620);

    // 2.5D лок: орто-изометрия 45°, без вращения (style-lock.md)
    const frustum = 150;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 2000);
    this.frustum = frustum;
    const s0 = state.map.spawns[0];
    this.home = { x: s0.x * WORLD_SCALE, z: s0.z * WORLD_SCALE };
    // направление взгляда: азимут 45° (3/4 вид), элевация 45°
    const az = Math.PI / 4;
    const el = Math.PI / 4;
    const dist = 300;
    this.isoDir = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    );
    this.camera.position.set(
      this.home.x + this.isoDir.x * dist,
      this.isoDir.y * dist,
      this.home.z + this.isoDir.z * dist
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(this.home.x, 0, this.home.z);
    this.controls.enableRotate = false; // вращения нет
    this.controls.minZoom = 0.45;
    this.controls.maxZoom = 2.6;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.update();

    // тёплый свет Townsmen: сцена была темной
    this.scene.add(new THREE.AmbientLight(0xfff4e0, 1.15));
    this.scene.add(new THREE.HemisphereLight(0xbdd7ff, 0x8a7a5a, 0.55));
    const sun = new THREE.DirectionalLight(0xffe7c4, 2.4);
    sun.position.set(120, 180, 60);
    this.scene.add(sun);

    this.buildGround(state);

    this.dyn = new THREE.Group(); // здания, отряды, флаги
    this.scene.add(this.dyn);

    this.bMeshes = new Map(); // buildingId -> group
    this.fMeshes = new Map(); // flagId -> {flagMat, ringMat}
    this.rings = new Map(); // entityKey -> ring mesh
    this.barsLayer = document.createElement('div');
    this.barsLayer.className = 'bars-layer';
    container.appendChild(this.barsLayer);
    this.barEls = new Map();

    // солдаты рисуются инстансингом (unitsMesh.js), герои — ригами (heroMesh.js)
    this.units = new UnitsMesh(this.scene, palette);
    this.heroMesh = new HeroMesh(this.scene);
    this.teamHexOf = (owner) => {
      const m = {
        player: palette.teams.p0, ally: palette.teams.p2,
        enemy1: palette.teams.p1, enemy2: palette.teams.p2, enemy3: palette.teams.p3,
        bot: palette.teams.p1, neutral: 0x777777,
      };
      return m[owner] ?? 0xffffff;
    };
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
    }
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.tracers.push({ mesh, t: 0, dur: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
    }
    this.buildStatics(state);
    this.buildFog(state);
    this.buildRiver(state);
    this.buildMountains(state);
    this.resize();
  }

  teamMat(owner) {
    if (owner === 'neutral') return this.teamMats.neutral;
    const me = this.state.me || 'player';
    if (owner === me) return this.teamMats.p0;
    if (sameTeam(this.state, owner, me)) return this.teamMats.p2;
    const foes = (this.state.pids || []).filter((p) => p !== me && !sameTeam(this.state, p, me));
    const cols = ['p1', 'p2', 'p3'];
    const ix = foes.indexOf(owner);
    return this.teamMats[ix >= 0 ? cols[ix % cols.length] : 'p1'];
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
      case 'shooting_range': return { w: 7, h: 3, d: 5 };
      case 'tower': return { w: 3, h: 10, d: 3 };
      case 'house': return { w: 4, h: 3, d: 4 };
      case 'warehouse': return { w: 6, h: 3, d: 5 };
      case 'farm': return { w: 6, h: 1.5, d: 6 };
      case 'mill': return { w: 3, h: 9, d: 3 };
      case 'forge': return { w: 5, h: 3.5, d: 5 };
      case 'stable': case 'tabun_kaganat': return { w: 8, h: 4, d: 6 };
      case 'siege_workshop': return { w: 8, h: 4, d: 6 };
      case 'hall_nord': return { w: 10, h: 5, d: 6 };
      case 'guild_league': return { w: 6, h: 4, d: 5 };
      case 'sawmill': return { w: 6, h: 3, d: 5 };
      case 'quarry': return { w: 5, h: 2, d: 5 };
      case 'wall': return { w: 1.9, h: 2.6, d: 1.0 };
      case 'temple': return { w: 5, h: 4, d: 5 };
      case 'market': return { w: 6, h: 3, d: 5 };
      case 'mine': return { w: 5, h: 2.5, d: 5 };
      default: return { w: 5, h: 3.5, d: 5 };
    }
  }

  // общие материалы декора (1 на всех — без аллокаций в кадре)
  decoMat(color, emissive = 0) {
    const key = `${color}:${emissive}`;
    if (!this.decoMats) this.decoMats = {};
    if (!this.decoMats[key]) {
      this.decoMats[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.9, emissive, emissiveIntensity: emissive ? 0.9 : 0 });
    }
    return this.decoMats[key];
  }

  // крыша по типу: пирамида / плоская плита (ратуша) / низкая двускатная-имитация
  roofFor(g, type, w, h, d, roofMat) {
    if (type === 'farm') return; // грядки вместо крыши
    if (type === 'townhall') {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6), roofMat);
      slab.position.y = h + 0.25;
      g.add(slab);
      return;
    }
    const squash = type === 'warehouse' || type === 'sawmill' ? 0.4 : 0.7;
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(w, d) * 0.72, h * squash, 4),
      roofMat
    );
    roof.position.y = h + (h * squash) / 2;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
  }

  // акцентные детали по типу + уровневые пристройки (ур.2 — боковой пристрой,
  // ур.3 — башенка/флаг). Лимит: 2-3 мешей на здание, иначе calls улетят за бюджет.
  decorateBuilding(g, type, w, h, d, owner, level = 1) {
    const wood = this.decoMat(0x6b4a2f);
    const stone = this.decoMat(0x9aa0a8);
    const teamHex = this.teamHexOf(owner);
    const team = this.decoMat(teamHex);
    if (type === 'mill') {
      const blades = new THREE.Group();
      const mat = this.decoMat(0xe8e0cc);
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
    } else if (type === 'townhall') {
      // второй этаж-ступень + флаг фракции 6м
      const step = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, h * 0.4, d * 0.6), this.decoMat(0xd9c9a3));
      step.position.y = h + 0.4;
      g.add(step);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 6, 6), wood);
      pole.position.set(w / 4, h + 3, -d / 4);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ color: teamHex, side: THREE.DoubleSide }));
      flag.position.set(w / 4 + 0.85, h + 5.2, -d / 4);
      g.add(pole, flag);
    } else if (type === 'temple') {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(w, d) * 0.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        this.decoMat(0xffd76a)
      );
      dome.position.y = h;
      g.add(dome);
    } else if (type === 'bakery' || type === 'house' || type === 'forge') {
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), stone);
      chimney.position.set(w / 4, h + 1, 0);
      g.add(chimney);
      if (type === 'forge') {
        // горн-свечение
        const glow = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 0.3), this.decoMat(0xff7722, 0xff5511));
        glow.position.set(-w / 4, 0.8, d / 2 + 0.1);
        g.add(glow);
      }
    } else if (type === 'market') {
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(w + 1, 0.4, d + 1),
        this.decoMat(owner === 'player' || owner === 'ally' ? 0xe8b400 : 0xd23c2e)
      );
      awning.position.y = h + 0.6;
      // прилавок с флажком
      const stall = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 1.2), wood);
      stall.position.set(-w / 2 - 1.4, 0.5, d / 2);
      g.add(awning, stall);
    } else if (type === 'mine' || type === 'quarry') {
      const beams = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, h * 1.6, 0.6), wood);
      beams.position.y = h * 0.8;
      beams.rotation.z = 0.5;
      // штабель блоков
      const blocks = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.2, 1.4), stone);
      blocks.position.set(w / 2 + 1.2, 0.6, d / 2);
      g.add(beams, blocks);
    } else if (type === 'farm') {
      // грядки-ряды вместо крыши
      for (let i = -1; i <= 1; i++) {
        const bed = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.25, 0.9), this.decoMat(0x4a6b2f));
        bed.position.set(0, h + 0.1, i * 1.6);
        g.add(bed);
      }
    } else if (type === 'warehouse') {
      // ящики-стопка у сарая
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), wood);
      c1.position.set(w / 2 + 1, 0.7, 0);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), wood);
      c2.position.set(w / 2 + 1, 1.9, 0.2);
      g.add(c1, c2);
    } else if (type === 'barracks' || type === 'shooting_range') {
      // стойка с оружием + мишень у стрельбища
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 0.25), wood);
      post.position.set(w / 2 + 1.2, 1.1, 0);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 2.0), wood);
      bar.position.set(w / 2 + 1.2, 1.9, 0);
      g.add(post, bar);
      if (type === 'shooting_range') {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.15, 10), this.decoMat(0xd23c2e));
        disc.rotation.x = Math.PI / 2;
        disc.position.set(w / 2 + 1.2, 1.1, 2.2);
        g.add(disc);
      }
    } else if (type === 'stable' || type === 'tabun_kaganat') {
      // загон: 2 жерди + стог
      const rail = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.18, 0.18), wood);
      rail.position.set(0, 1.1, d / 2 + 1.6);
      const hay = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.8, 8), this.decoMat(0xc9a94a));
      hay.position.set(w / 2 + 1.2, 0.9, d / 2 + 1);
      g.add(rail, hay);
    } else if (type === 'sawmill') {
      // штабель брёвен
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3.2, 8), wood);
      log.rotation.z = Math.PI / 2;
      log.position.set(w / 2 + 1.4, 0.4, 0);
      g.add(log);
    } else if (type === 'tower') {
      // зубцы + вымпел
      const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.6, d + 0.5), stone);
      top.position.y = h + 0.3;
      const penn = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshBasicMaterial({ color: teamHex, side: THREE.DoubleSide }));
      penn.position.set(0.6, h + 1.6, 0);
      g.add(top, penn);
    } else if (type === 'hall_nord') {
      // рога над входом + кострище
      const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.4, 6), this.decoMat(0xe8e0cc));
      hornL.position.set(-1.2, h + 0.8, d / 2 + 0.2);
      hornL.rotation.z = 0.5;
      const fire = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), this.decoMat(0xff7722, 0xff5511));
      fire.position.set(0, 0.3, d / 2 + 2.2);
      g.add(hornL, fire);
    } else if (type === 'guild_league') {
      // весы: столб + коромысло + золотой блеск
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.4, 0.25), wood);
      post.position.set(0, h + 1.2, d / 2 + 1);
      const gold = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), this.decoMat(0xe8b400, 0x664400));
      gold.position.set(0, h + 0.4, d / 2 + 1);
      g.add(post, gold);
    } else if (type === 'siege_workshop') {
      // кран-балка + колесо
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 5.5), wood);
      beam.position.set(-w / 4, h + 1.2, 0.5);
      beam.rotation.x = -0.35;
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.3, 10), wood);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(w / 2 + 1, 0.9, 0);
      g.add(beam, wheel);
    }
    // уровневые пристройки: ур.2 — боковой пристрой, ур.3 — угловая башенка
    if (level >= 2 && type !== 'wall' && type !== 'farm') {
      const ax = new THREE.Mesh(new THREE.BoxGeometry(w * 0.45, h * 0.55, d * 0.5), this.decoMat(0xd9c9a3));
      ax.position.set(w / 2 + (w * 0.45) / 2 - 0.2, (h * 0.55) / 2, -d / 4);
      const axRoof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w * 0.45, d * 0.5) * 0.72, 1.2, 4), stone);
      axRoof.position.set(ax.position.x, h * 0.55 + 0.6, -d / 4);
      axRoof.rotation.y = Math.PI / 4;
      g.add(ax, axRoof);
    }
    if (level >= 3 && type !== 'wall') {
      const tur = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 3.2, 8), stone);
      tur.position.set(-w / 2 - 0.6, 1.6, -d / 2 - 0.6);
      const turRoof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.4, 8), team);
      turRoof.position.set(-w / 2 - 0.6, 3.9, -d / 2 - 0.6);
      g.add(tur, turRoof);
    }
  }

  syncBuilding(b, bdef) {
    let g = this.bMeshes.get(b.id);
    const lv = b.level || 1;
    // уровень сменился — перестроить (пристройки/башенка)
    if (g && g.userData.lv !== lv) {
      this.dyn.remove(g);
      this.bMeshes.delete(b.id);
      g = null;
    }
    if (!g && b.hp > 0) {
      g = new THREE.Group();
      g.userData.lv = lv;
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
        this.roofFor(g, b.type, w, h, d,
          (this.roofMats[{ nord: 'nord', kaganat: 'kaganat', league: 'league' }[this.state.raceOf?.[b.owner]] || 'nord']).clone()
        );
        const banner = new THREE.Mesh(new THREE.BoxGeometry(w * 0.2, h * 0.9, d + 0.3), this.teamMat(b.owner));
        banner.position.y = h / 2;
        g.add(body, banner);
        this.decorateBuilding(g, b.type, w, h, d, b.owner, lv);
      }
      // леса стройки (buildings-visual: стройка = леса-боксы)
      const scaf = new THREE.Group();
      const poleM = this.decoMat(0x8a6f4d);
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, h + 2, 0.25), poleM);
        pole.position.set(px * (w / 2 + 0.5), (h + 2) / 2, pz * (d / 2 + 0.5));
        scaf.add(pole);
      }
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 1.4, 0.25, d + 1.4), poleM);
      frame.position.y = h + 1.8;
      scaf.add(frame);
      g.add(scaf);
      g.userData.scaf = scaf;
      g.position.set(b.x, 0, b.z);
      g.traverse((o) => { if (o.isMesh) o.userData.entity = { kind: 'building', id: b.id }; });
      this.dyn.add(g);
      this.bMeshes.set(b.id, g);
    }
    if (g) {
      g.visible = b.hp > 0 && isVisible(this.state, b);
      const total = b.buildTotal || b.bt0 || 1;
      const progress = b.buildT > 0 ? 1 - b.buildT / total : 1;
      g.scale.setScalar(0.3 + 0.7 * progress);
      if (g.userData.blades && b.hp > 0 && b.buildT <= 0) g.userData.blades.rotation.z += 0.02;
      if (g.userData.scaf) g.userData.scaf.visible = b.buildT > 0;
      g.traverse((o) => {
        if (o.isMesh) o.userData.entity = { kind: 'building', id: b.id };
      });
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

  syncRings(state, sel) {
    const want = new Set();
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
      const g = kind === 'squad'
        ? state.squads.find((x) => x.id === Number(id))
        : this.bMeshes.get(Number(id));
      if (g && (kind !== 'squad' || g.count > 0)) {
        ring.visible = true;
        const gx = kind === 'squad' ? g.x : g.position.x;
        const gz = kind === 'squad' ? g.z : g.position.z;
        ring.position.set(gx, 0.15, gz);
        const s = kind === 'squad' ? (g.type === 'hero' ? 2.4 : 1.6) : 2.6;
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
    // отряды: инстансинг + риги героев
    this.units.sync(state, this.camera, state.t, (st, e) => isVisible(st, e), this.controls.target);
    this.heroMesh.sync(state, state.t, dt, (st, e) => isVisible(st, e), (o) => this.teamHexOf(o));
    this.syncFlags(state);
    this.syncRings(state, sel);
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
    // здания (обычные меши) + солдаты (инстансинг)
    const unitMeshes = [];
    for (const pool of Object.values(this.units.pools)) {
      if (pool.team) unitMeshes.push(pool.team);
      if (pool.fixed) unitMeshes.push(pool.fixed);
    }
    unitMeshes.push(this.units.lod);
    const hits = rc.intersectObjects([...this.dyn.children, ...unitMeshes], true);
    // инстансы ближе? сортируем по дистанции
    hits.sort((a, b) => a.distance - b.distance);
    for (const h of hits) {
      // попадание в инстанс солдата
      if (h.instanceId !== undefined && h.object !== this.units.lod) {
        const sqId = this.units.squadAt(h.object, h.instanceId);
        if (sqId != null) {
          const target = this.state.squads.find((x) => x.id === sqId);
          if (target && target.count > 0) {
            if (teamOf(this.state, target.owner) !== 'A' && !isVisible(this.state, target)) continue;
            return { kind: 'squad', id: sqId };
          }
        }
        continue;
      }
      if (h.instanceId !== undefined && h.object === this.units.lod) {
        const sqId = this.units.squadAt(h.object, h.instanceId);
        if (sqId != null) {
          const target = this.state.squads.find((x) => x.id === sqId);
          if (target && target.count > 0) return { kind: 'squad', id: sqId };
        }
        continue;
      }
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

  // Фокус с сохранением изометрии: камера едет по лучу
  focus(x, z, dist = null) {
    const d = dist || this.camera.position.distanceTo(this.controls.target);
    this.controls.target.set(x, 0, z);
    this.camera.position.set(
      x + this.isoDir.x * d,
      this.isoDir.y * d,
      z + this.isoDir.z * d
    );
    this.controls.update();
  }

  resize() {
    const w = this.renderer.domElement.parentElement.clientWidth || innerWidth;
    const h = this.renderer.domElement.parentElement.clientHeight || innerHeight;
    const half = (this.frustum || 150) / 2;
    const a = w / h;
    this.camera.left = -half * a;
    this.camera.right = half * a;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
