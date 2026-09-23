// unitsMesh — процедурные юниты 1в1 по docs/gdd/units/ref/*.jpg (чиби 1.7м).
// Стиль: Townsmen-теплые цвета + Warspear-читаемость (плащ цветом команды).
// Перф: на тип 1 InstancedMesh (vertexColors + instanceColor для команды) + LOD-бокс дальше 60м.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const C = {
  skin: 0xe8b98a, steel: 0x9aa0a8, darkSteel: 0x5a5f6b, wood: 0x6b4a2f,
  brown: 0x6b4a33, leather: 0x7a5a3a, hoodGreen: 0x3f7a3f, white: 0xf0f0f0,
  trimBlue: 0x3f6dbf, gold: 0xe8b400, horseTan: 0xb98d5e, horseDark: 0x5a3a28,
  gray: 0x777777, bone: 0xd9cdb4, red: 0xb03030,
};

function paint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function put(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  return geo;
}
const BOX = (w, h, d, color, x, y, z, rx, ry, rz) => paint(put(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz), color);
const CYL = (rt, rb, h, color, x, y, z, rx, ry, rz, seg = 8) => paint(put(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz), color);
const SPH = (r, color, x, y, z, ws = 8, hs = 6) => paint(put(new THREE.SphereGeometry(r, ws, hs), x, y, z), color);
const CONE = (r, h, color, x, y, z, seg = 8) => paint(put(new THREE.ConeGeometry(r, h, seg), x, y, z), color);
const TORUS = (r, t, color, x, y, z, arc = Math.PI) => paint(put(new THREE.TorusGeometry(r, t, 6, 10, arc), x, y, z), color);
// TEAM — часть красится цветом команды через instanceColor (база белая)
const TBOX = (w, h, d, x, y, z, rx, ry, rz) => paint(put(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz), 0xffffff);
const TPLANE = (w, h, x, y, z, rx, ry, rz) => paint(put(new THREE.PlaneGeometry(w, h), x, y, z, rx, ry, rz), 0xffffff);
const TCYL = (rt, rb, h, x, y, z, rx, ry, rz, seg = 10) => paint(put(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz), 0xffffff);

// База пехотинца: ноги+торс+голова. Возвращает [teamGeos, fixedGeos].
function baseInfantry(tunicTeam = true) {
  const team = [];
  const fixed = [
    BOX(0.42, 0.5, 0.32, C.brown, 0, 0.25, 0), // ноги/сапоги
    SPH(0.24, C.skin, 0, 1.32, 0.02), // голова
  ];
  team.push(BOX(0.6, 0.62, 0.4, 0, 0.82, 0)); // торс-плащ цветом команды
  team.push(TPLANE(0.72, 0.85, 0, 0.75, -0.26, 0, 0.12, 0)); // плащ сзади
  return { team, fixed };
}

// Геометрия по типам: { team: mergedGeo, fixed: mergedGeo, h: высота }
function buildTypeGeos() {
  const T = {};
  // --- militia: коричневая роба, вилы, без щита ---
  {
    const team = [TPLANE(0.5, 0.7, 0, 0.7, -0.24)];
    const fixed = [
      BOX(0.55, 0.9, 0.38, C.brown, 0, 0.65, 0),
      BOX(0.42, 0.5, 0.32, C.brown, 0, 0.25, 0),
      SPH(0.24, C.skin, 0, 1.32, 0.02),
      CONE(0.26, 0.3, C.brown, 0, 1.52, 0), // капюшон
      CYL(0.035, 0.035, 1.9, C.wood, 0.35, 0.95, 0.1), // вилы-палка
      BOX(0.16, 0.04, 0.04, C.darkSteel, 0.35, 1.85, 0.1),
    ];
    T.militia = { team, fixed };
  }
  // --- swords: кираса, котелок, heater-щит, меч ---
  {
    const { team, fixed } = baseInfantry();
    fixed.push(
      BOX(0.62, 0.5, 0.44, C.steel, 0, 0.9, 0), // кираса
      SPH(0.27, C.steel, 0, 1.42, 0), // шлем-котелок
      BOX(0.14, 0.9, 0.08, C.steel, 0.42, 0.9, 0.25), // меч
      BOX(0.2, 0.12, 0.1, C.wood, 0.42, 0.5, 0.25), // гарда/рукоять
    );
    team.push(BOX(0.5, 0.65, 0.1, -0.42, 0.85, 0.15, 0, 0.25, 0)); // heater-щит цветом
    T.swords = { team, fixed };
  }
  // --- spears: кираса, шлем, круглый щит, копьё 2.5м ---
  {
    const { team, fixed } = baseInfantry();
    fixed.push(
      BOX(0.62, 0.5, 0.44, C.darkSteel, 0, 0.9, 0),
      SPH(0.27, C.steel, 0, 1.42, 0),
      CYL(0.035, 0.035, 2.5, C.wood, 0.4, 1.25, 0.1), // копьё
      CONE(0.06, 0.25, C.steel, 0.4, 2.55, 0.1), // наконечник
    );
    team.push(TCYL(0.34, 0.34, 0.08, -0.44, 0.85, 0.15, 0, 0, Math.PI / 2)); // круглый щит
    T.spears = { team, fixed };
  }
  // --- archers: капюшон, лук-дуга, колчан ---
  {
    const team = [TPLANE(0.5, 0.7, 0, 0.7, -0.24)];
    const fixed = [
      BOX(0.55, 0.85, 0.38, C.leather, 0, 0.62, 0), // кожаная туника
      BOX(0.42, 0.5, 0.32, C.brown, 0, 0.25, 0),
      SPH(0.22, C.skin, 0, 1.3, 0.03),
      CONE(0.28, 0.42, C.hoodGreen, 0, 1.5, -0.03), // капюшон с вышивкой
      TORUS(0.42, 0.045, C.wood, 0.42, 0.95, 0.15, 0, Math.PI / 2, 0), // лук-дуга
      BOX(0.16, 0.5, 0.16, C.wood, -0.25, 1.0, -0.3), // колчан
    ];
    T.archers = { team, fixed };
  }
  // --- xbows: бригантина, капюшон, арбалет, павеза ---
  {
    const team = [TPLANE(0.5, 0.7, 0, 0.7, -0.24)];
    const fixed = [
      BOX(0.6, 0.85, 0.4, C.darkSteel, 0, 0.62, 0), // бригантина
      BOX(0.42, 0.5, 0.32, C.brown, 0, 0.25, 0),
      SPH(0.22, C.skin, 0, 1.3, 0.03),
      CONE(0.28, 0.4, C.hoodGreen, 0, 1.48, -0.03),
      BOX(0.7, 0.1, 0.12, C.wood, 0.3, 1.0, 0.2), // ложе арбалета
      BOX(0.1, 0.5, 0.08, C.darkSteel, 0.3, 1.0, 0.45), // дуга
      BOX(0.5, 0.9, 0.08, C.wood, -0.3, 0.9, -0.35), // павеза за спиной
    ];
    T.xbows = { team, fixed };
  }
  // --- light_cav: лошадь 2.2м + всадник с саблей ---
  {
    const team = [
      BOX(0.5, 0.55, 0.35, 0, 1.75, -0.1), // торс всадника
      TPLANE(0.6, 0.7, 0, 1.6, -0.55, 0, 0.3, 0), // плащ
    ];
    const fixed = [
      BOX(0.55, 0.65, 2.2, C.horseTan, 0, 0.85, 0), // корпус лошади
      BOX(0.4, 0.5, 0.5, C.horseTan, 0, 1.25, 1.15), // шея+голова
      BOX(0.16, 0.7, 0.16, C.horseDark, -0.18, 0.35, 0.7), // ноги
      BOX(0.16, 0.7, 0.16, C.horseDark, 0.18, 0.35, 0.7),
      BOX(0.16, 0.7, 0.16, C.horseDark, -0.18, 0.35, -0.7),
      BOX(0.16, 0.7, 0.16, C.horseDark, 0.18, 0.35, -0.7),
      SPH(0.22, C.skin, 0, 2.15, -0.1), // голова всадника
      SPH(0.24, C.leather, 0, 2.28, -0.1), // шлем
      BOX(0.1, 0.85, 0.06, C.steel, 0.35, 1.8, 0.3, 0, 0, -0.3), // сабля
    ];
    T.light_cav = { team, fixed };
  }
  // --- heavy_cav: лошадь 2.6 + бардинг + ланс 3м ---
  {
    const team = [
      BOX(0.55, 0.6, 0.4, 0, 1.95, -0.2),
      TPLANE(0.7, 0.8, 0, 1.8, -0.7, 0, 0.3, 0),
    ];
    const fixed = [
      BOX(0.65, 0.75, 2.6, C.horseDark, 0, 0.9, 0),
      BOX(0.7, 0.5, 1.4, C.darkSteel, 0, 1.15, 0.3), // бардинг
      BOX(0.45, 0.55, 0.55, C.horseDark, 0, 1.4, 1.4),
      BOX(0.18, 0.75, 0.18, C.horseDark, -0.2, 0.37, 0.85),
      BOX(0.18, 0.75, 0.18, C.horseDark, 0.2, 0.37, 0.85),
      BOX(0.18, 0.75, 0.18, C.horseDark, -0.2, 0.37, -0.85),
      BOX(0.18, 0.75, 0.18, C.horseDark, 0.2, 0.37, -0.85),
      BOX(0.6, 0.55, 0.42, C.darkSteel, 0, 2.0, -0.2), // латы всадника
      SPH(0.26, C.darkSteel, 0, 2.45, -0.2), // шлем с гребнем
      BOX(0.08, 0.3, 0.3, C.trimBlue, 0, 2.6, -0.2),
      CYL(0.04, 0.04, 3.0, C.wood, 0.4, 2.0, 0.9, Math.PI / 2.2, 0, 0), // ланс
      CONE(0.07, 0.3, C.steel, 0.4, 2.0, 2.3),
    ];
    T.heavy_cav = { team, fixed };
  }
  // --- guard_nord: кольчуга, шпангенхельм, ЩИТ огромный, копьё ---
  {
    const { team, fixed } = baseInfantry();
    fixed.push(
      BOX(0.66, 0.7, 0.46, 0x4a4a52, 0, 0.85, 0), // тяжелая кольчуга
      SPH(0.28, C.darkSteel, 0, 1.44, 0), // шпангенхельм
      CYL(0.035, 0.035, 2.2, C.wood, 0.42, 1.1, 0.1),
      CONE(0.06, 0.25, C.steel, 0.42, 2.25, 0.1),
    );
    team.push(TCYL(0.5, 0.5, 0.09, -0.5, 0.85, 0.15, 0, 0, Math.PI / 2)); // массивный круглый щит
    team.push(BOX(0.64, 0.5, 0.42, 0, 0.82, 0)); // плащ-накидка поверх
    T.guard_nord = { team, fixed };
  }
  // --- nukers: ламеляр, конический шлем, композитный лук, лошадь ---
  {
    const team = [
      BOX(0.5, 0.55, 0.35, 0, 1.7, -0.1),
      TPLANE(0.45, 0.6, 0.25, 1.6, -0.4),
    ];
    const fixed = [
      BOX(0.5, 0.6, 2.0, C.horseTan, 0, 0.8, 0),
      BOX(0.38, 0.45, 0.45, C.horseTan, 0, 1.15, 1.0),
      BOX(0.15, 0.65, 0.15, C.horseDark, -0.16, 0.32, 0.6),
      BOX(0.15, 0.65, 0.15, C.horseDark, 0.16, 0.32, 0.6),
      BOX(0.15, 0.65, 0.15, C.horseDark, -0.16, 0.32, -0.6),
      BOX(0.15, 0.65, 0.15, C.horseDark, 0.16, 0.32, -0.6),
      BOX(0.52, 0.6, 0.38, 0x8a6f4d, 0, 1.65, -0.1), // ламеляр
      SPH(0.22, C.skin, 0, 2.05, -0.1),
      CONE(0.24, 0.35, C.brown, 0, 2.3, -0.1), // конический шлем
      TORUS(0.32, 0.04, C.wood, 0.35, 1.75, 0.25, 0, Math.PI / 2, 0), // композитный лук
    ];
    T.nukers = { team, fixed };
  }
  // --- halberdiers: латы, саллет, алебарда 2.2м, табард ---
  {
    const { team, fixed } = baseInfantry();
    fixed.push(
      BOX(0.62, 0.55, 0.44, C.steel, 0, 0.9, 0),
      SPH(0.27, C.darkSteel, 0, 1.44, 0, 8, 6), // саллет
      CYL(0.035, 0.035, 2.2, C.wood, 0.4, 1.1, 0.15),
      BOX(0.08, 0.4, 0.25, C.gold, 0.4, 2.0, 0.15), // топор алебарды
      CONE(0.05, 0.25, C.steel, 0.4, 2.3, 0.15),
    );
    team.push(BOX(0.5, 0.7, 0.46, 0, 0.75, 0)); // табард цветом
    T.halberdiers = { team, fixed };
  }
  // --- ballista: рама + колёса + болт ---
  {
    const team = [TPLANE(0.7, 0.5, 0, 1.3, -0.9, 0, -0.4, 0)]; // флажок
    const fixed = [
      BOX(1.6, 0.4, 3.2, C.wood, 0, 0.7, 0), // рама
      BOX(0.3, 0.5, 3.4, 0x3f5a34, -0.7, 0.75, 0), // борта зелёные
      BOX(0.3, 0.5, 3.4, 0x3f5a34, 0.7, 0.75, 0),
      CYL(0.55, 0.55, 0.25, C.wood, -0.95, 0.55, 0.8, 0, 0, Math.PI / 2), // колёса
      CYL(0.55, 0.55, 0.25, C.wood, 0.95, 0.55, 0.8, 0, 0, Math.PI / 2),
      CYL(0.55, 0.55, 0.25, C.wood, -0.95, 0.55, -0.8, 0, 0, Math.PI / 2),
      CYL(0.55, 0.55, 0.25, C.wood, 0.95, 0.55, -0.8, 0, 0, Math.PI / 2),
      BOX(2.0, 0.12, 0.12, C.darkSteel, 0, 1.15, 1.2), // дуга
      CYL(0.07, 0.07, 1.8, C.wood, 0, 1.1, 0.6, Math.PI / 2, 0, 0), // болт
      CONE(0.12, 0.35, C.steel, 0, 1.1, 1.6),
    ];
    T.ballista = { team, fixed };
  }
  // --- trebuchet: рама + рычаг + противовес ---
  {
    const team = [TPLANE(0.7, 0.5, 0, 1.0, -1.2, 0, -0.4, 0)];
    const fixed = [
      BOX(2.2, 0.4, 4.0, C.wood, 0, 0.5, 0),
      BOX(0.3, 2.6, 0.3, C.wood, -0.8, 1.7, 0.3, 0, 0, 0.25), // А-рама
      BOX(0.3, 2.6, 0.3, C.wood, 0.8, 1.7, 0.3, 0, 0, -0.25),
      BOX(0.25, 0.25, 5.2, C.wood, 0, 3.2, 0.6, 0.5, 0, 0), // рычаг
      BOX(0.9, 0.9, 0.9, C.darkSteel, 0, 1.6, -1.6), // противовес
      SPH(0.35, C.gray, 0, 4.4, 1.9), // камень
    ];
    T.trebuchet = { team, fixed };
  }
  // --- healer: белая роба, посох с шаром ---
  {
    const team = [TPLANE(0.5, 0.75, 0, 0.7, -0.26)];
    const fixed = [
      CYL(0.28, 0.42, 1.1, C.white, 0, 0.55, 0), // роба
      SPH(0.22, C.skin, 0, 1.3, 0.03),
      CONE(0.3, 0.45, C.white, 0, 1.5, -0.03), // капюшон
      CYL(0.035, 0.035, 1.7, C.wood, 0.38, 0.85, 0.1), // посох
      SPH(0.11, 0x66ccff, 0.38, 1.75, 0.1), // светящийся шар
    ];
    T.healer = { team, fixed };
  }
  // --- raised (скелеты): кость + ржавый меч ---
  {
    const team = [TPLANE(0.45, 0.6, 0, 0.65, -0.22)];
    const fixed = [
      BOX(0.5, 0.8, 0.35, C.bone, 0, 0.6, 0),
      SPH(0.22, C.bone, 0, 1.25, 0.02),
      BOX(0.14, 0.8, 0.06, C.gray, 0.36, 0.8, 0.2), // ржавый меч
    ];
    T.raised = { team, fixed };
  }
  // --- wolves: серый корпус ---
  {
    const team = [];
    const fixed = [
      BOX(0.45, 0.45, 1.1, C.gray, 0, 0.45, 0),
      BOX(0.3, 0.3, 0.35, C.gray, 0, 0.65, 0.65), // голова
      BOX(0.12, 0.4, 0.12, C.gray, -0.15, 0.2, 0.35),
      BOX(0.12, 0.4, 0.12, C.gray, 0.15, 0.2, 0.35),
      BOX(0.12, 0.4, 0.12, C.gray, -0.15, 0.2, -0.35),
      BOX(0.12, 0.4, 0.12, C.gray, 0.15, 0.2, -0.35),
    ];
    T.wolves = { team, fixed };
  }
  // --- hero: базовый болванчик (герои рисуются отдельно в heroMesh.js, но нужен LOD) ---
  {
    const team = [BOX(0.7, 0.9, 0.5, 0, 0.9, 0)];
    const fixed = [SPH(0.3, C.skin, 0, 1.6, 0.02)];
    T.hero = { team, fixed };
  }
  const out = {};
  for (const [k, v] of Object.entries(T)) {
    out[k] = {
      team: v.team.length ? mergeGeometries(v.team, false) : null,
      fixed: v.fixed.length ? mergeGeometries(v.fixed, false) : null,
    };
  }
  return out;
}

const CAPS = {
  militia: 1200, swords: 900, spears: 900, archers: 800, xbows: 400,
  light_cav: 300, heavy_cav: 200, guard_nord: 400, nukers: 300, halberdiers: 400,
  ballista: 80, trebuchet: 60, healer: 150, raised: 300, wolves: 150, hero: 32,
};

export class UnitsMesh {
  constructor(scene, palette) {
    this.scene = scene;
    this.teamHex = {
      player: palette.teams.p0, ally: palette.teams.p2,
      enemy1: palette.teams.p1, enemy2: palette.teams.p2, enemy3: palette.teams.p3,
      bot: palette.teams.p1, neutral: 0x777777,
    };
    this.geos = buildTypeGeos();
    this.teamMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.fixedMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.pools = {}; // type -> {team, fixed}
    // нулевая матрица для скрытия неиспользуемых инстансов (иначе identity в origin жрёт tris)
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const [type, g] of Object.entries(this.geos)) {
      const cap = CAPS[type] || 300;
      const entry = {};
      if (g.team) {
        entry.team = new THREE.InstancedMesh(g.team, this.teamMat, cap);
        entry.team.frustumCulled = false;
        entry.team.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const white = new THREE.Color(1, 1, 1);
        for (let i = 0; i < cap; i++) {
          entry.team.setColorAt(i, white);
          entry.team.setMatrixAt(i, this.zero);
        }
        scene.add(entry.team);
      }
      if (g.fixed) {
        entry.fixed = new THREE.InstancedMesh(g.fixed, this.fixedMat, cap);
        entry.fixed.frustumCulled = false;
        entry.fixed.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < cap; i++) entry.fixed.setMatrixAt(i, this.zero);
        scene.add(entry.fixed);
      }
      entry.squads = []; // squadId на инстанс (для pick)
      this.pools[type] = entry;
    }
    // LOD: 1 бокс на дальний отряд
    const lodGeo = paint(new THREE.BoxGeometry(1.7, 1.7, 1.7), 0xffffff);
    this.lod = new THREE.InstancedMesh(lodGeo, this.teamMat, 128);
    this.lod.frustumCulled = false;
    this.lod.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    {
      const white = new THREE.Color(1, 1, 1);
      for (let i = 0; i < 128; i++) {
        this.lod.setColorAt(i, white);
        this.lod.setMatrixAt(i, this.zero);
      }
    }
    scene.add(this.lod);
    this.lodSquads = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3(1, 1, 1);
    this.col = new THREE.Color();
    this.anim = new Map(); // squadId -> {x, z, phase}
  }

  teamColor(owner) {
    return this.col.set(this.teamHex[owner] ?? '#ffffff');
  }

  // focus: точка взгляда на земле (controls.target) — LOD меряем от неё, НЕ от позиции
  // камеры (та смещена на ~150м по изометрии и загоняла всё в LOD). Сим не трогаем.
  sync(state, camera, time, isVisible, focus) {
    const counts = {};
    for (const k of Object.keys(this.pools)) counts[k] = 0;
    let lodN = 0;
    const fx = focus ? focus.x : camera.position.x;
    const fz = focus ? focus.z : camera.position.z;
    for (const s of state.squads) {
      if (s.count <= 0 || s.type === 'hero') continue;
      if (!isVisible(state, s)) continue;
      const pool = this.pools[s.type];
      if (!pool) continue;
      // LOD дальше 60м от фокуса: 1 бокс на отряд
      const dx = s.x - fx;
      const dz = s.z - fz;
      if (dx * dx + dz * dz > 60 * 60 && lodN < 128) {
        this.e.set(0, s.face || 0, 0);
        this.q.setFromEuler(this.e);
        this.v.set(s.x, 0.85, s.z);
        this.s.set(1, 1, 1);
        this.m.compose(this.v, this.q, this.s);
        this.lod.setMatrixAt(lodN, this.m);
        this.lod.setColorAt(lodN, this.teamColor(s.owner));
        this.lodSquads[lodN] = s.id;
        lodN++;
        continue;
      }
      // анимация ходьбы: фаза по движению
      let a = this.anim.get(s.id);
      if (!a) {
        a = { x: s.x, z: s.z, phase: Math.random() * 6 };
        this.anim.set(s.id, a);
      }
      const moved = Math.hypot(s.x - a.x, s.z - a.z);
      if (moved > 0.02) a.phase += moved * 4;
      a.x = s.x;
      a.z = s.z;
      const bob = moved > 0.02 ? Math.abs(Math.sin(a.phase)) * 0.14 : Math.sin(time * 1.5 + a.phase) * 0.03;
      const spread = s.loose ? 2 : 1;
      let i = 0;
      for (const sol of s.soldiers) {
        if (!sol.alive) continue;
        const idx = counts[s.type]++;
        if (!pool.team && !pool.fixed) break;
        const cap = CAPS[s.type] || 300;
        if (idx >= cap) break;
        // поворот оффсета за лицом отряда
        const cs = Math.cos(s.face || 0);
        const sn = Math.sin(s.face || 0);
        const ox = (sol.dx * spread * cs - sol.dz * spread * sn);
        const oz = (sol.dx * spread * sn + sol.dz * spread * cs);
        this.e.set(0, s.face || 0, moved > 0.02 ? Math.sin(a.phase) * 0.06 : 0);
        this.q.setFromEuler(this.e);
        this.v.set(s.x + ox, bob + (s.type === 'wolves' ? 0 : 0), s.z + oz);
        // высота геометрии уже заложена; кава/осада стоят на земле (y=0)
        this.s.set(1, 1, 1);
        this.m.compose(this.v, this.q, this.s);
        if (pool.team) {
          pool.team.setMatrixAt(idx, this.m);
          pool.team.setColorAt(idx, this.teamColor(s.owner));
        }
        if (pool.fixed) pool.fixed.setMatrixAt(idx, this.m);
        pool.squads[idx] = s.id;
        i++;
      }
    }
    for (const [type, pool] of Object.entries(this.pools)) {
      const cap = CAPS[type] || 300;
      const used = Math.min(counts[type], cap);
      for (const mesh of [pool.team, pool.fixed]) {
        if (!mesh) continue;
        // хвост сверх used: занулить (shrink от кадра к кадру), рисуем только used
        const hi = mesh.userData.hi || 0;
        for (let i = used; i < Math.min(cap, hi); i++) mesh.setMatrixAt(i, this.zero);
        mesh.userData.hi = used;
        mesh.count = used;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      pool.squads.length = used;
    }
    const lodHi = this.lod.userData.hi || 0;
    for (let i = lodN; i < lodHi; i++) this.lod.setMatrixAt(i, this.zero);
    this.lod.userData.hi = lodN;
    this.lod.count = lodN;
    this.lod.instanceMatrix.needsUpdate = true;
    if (this.lod.instanceColor) this.lod.instanceColor.needsUpdate = true;
    this.lodSquads.length = lodN;
    // чистка анимаций погибших
    if (this.anim.size > 400) {
      const alive = new Set(state.squads.map((s) => s.id));
      for (const k of this.anim.keys()) if (!alive.has(k)) this.anim.delete(k);
    }
  }

  // pick: instanceId -> squadId
  squadAt(mesh, instanceId) {
    if (mesh === this.lod) return this.lodSquads[instanceId];
    for (const pool of Object.values(this.pools)) {
      if (pool.team === mesh || pool.fixed === mesh) return pool.squads[instanceId];
    }
    return null;
  }
}
