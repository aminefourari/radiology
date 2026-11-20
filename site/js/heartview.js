// three.js view of the heart for heart.html: chambers coloured by the simulation's per-vertex state,
// conduction system as tubes, optional cuts and a chest view with electrodes and the heart vector.
// World coordinates are RAS mm (same frame as the atlas and heart-graph.json). The camera looks from
// anterior, so the patient's right is on the viewer's left.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const CHAMBERS = ["right_atrium", "left_atrium", "right_ventricle", "left_ventricle"]; // graph chamber ids 0..3
const THORAX = /rib|stern|costal|xiphoid|manubrium|clavicle/;

function token(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

// Nearest graph vertex (restricted to the given chambers) for each point, via a uniform grid.
function nearestMap(g, positions, chambers, cell = 6) {
  const grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let v = 0; v < g.nMesh; v++) {
    if (!chambers.includes(g.chamber[v])) continue;
    const k = key(g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(v);
  }
  const out = new Int32Array(positions.count).fill(-1);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 3 && best < 0; r++) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        for (const v of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
          const d = (g.pos[v * 3] - x) ** 2 + (g.pos[v * 3 + 1] - y) ** 2 + (g.pos[v * 3 + 2] - z) ** 2;
          if (d < bd) { bd = d; best = v; }
        }
      }
    }
    out[i] = best;
  }
  return out;
}

const vec = (a) => new THREE.Vector3(...a);
const graphPos = (g, v) => new THREE.Vector3(g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]);

export async function createHeartView(container, { glbUrl, graph: g, skeletonUrl }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  const canvas = renderer.domElement;
  container.append(canvas);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4ec, 0x2a2224, 1.4));
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
  camera.up.set(0, 0, 1);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-0.4, 1, 0.8);
  camera.add(key);
  scene.add(camera);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;

  const palette = [token("--heart-rest", "#b8746c"), token("--heart-front", "#fff3a8"), token("--heart-plateau", "#e8a23c"), token("--heart-repol", "#5d8fd6")];
  const lineColor = [token("--heart-line", "#d9d4c8"), palette[1], palette[2], palette[3]];

  // Heart meshes: chambers and papillary muscles coloured from the graph; valve leaflets fixed.
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(glbUrl);
  const coloured = []; // { attr, map }
  const clip = [];
  const materials = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    let n = o;
    while (n && !n.name) n = n.parent;
    const name = n?.name ?? "";
    const geo = o.geometry;
    geo.computeVertexNormals();
    const cid = CHAMBERS.indexOf(name);
    const leaflet = /leaflet/.test(name);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, side: THREE.DoubleSide, vertexColors: !leaflet,
      color: leaflet ? 0xe9e1d2 : 0xffffff, clippingPlanes: clip });
    materials.push(mat);
    o.material = mat;
    if (leaflet) return;
    const chambers = cid >= 0 ? [cid] : [2, 3]; // papillary muscles follow the nearest ventricular wall
    const attr = new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3);
    geo.setAttribute("color", attr);
    o.updateWorldMatrix(true, false);
    const world = geo.attributes.position.clone().applyMatrix4(o.matrixWorld);
    coloured.push({ attr, map: nearestMap(g, world, chambers) });
  });
  scene.add(gltf.scene);

  // Conduction system: tubes along the conduction lines, plus the SA and AV nodes.
  const lines = [];
  for (const ids of Object.values(g.lineNodes)) {
    const curve = new THREE.CatmullRomCurve3(ids.map((v) => graphPos(g, v)));
    const mat = new THREE.MeshBasicMaterial({ color: lineColor[0], clippingPlanes: clip, depthTest: false, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, ids.length * 3, 1.1, 6), mat);
    mesh.renderOrder = 3;
    scene.add(mesh);
    lines.push({ ids, mat });
  }
  for (const v of [g.landmarks.sa, g.landmarks.avnode]) {
    const mat = new THREE.MeshBasicMaterial({ color: lineColor[0], depthTest: false, transparent: true, opacity: 0.9 });
    const m = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), mat);
    m.position.copy(graphPos(g, v));
    m.renderOrder = 3;
    scene.add(m);
    lines.push({ ids: [v], mat });
  }

  // Heart frame: long axis (mitral ring centre → apex) and the AV-valve line, for cuts and camera.
  const ringC = (ids) => ids.reduce((a, v) => a.add(graphPos(g, v)), new THREE.Vector3()).multiplyScalar(1 / ids.length);
  const mitral = ringC(g.landmarks.mitral_ring), tricuspid = ringC(g.landmarks.tricuspid_ring), apex = graphPos(g, g.landmarks.apex);
  const centre = vec(g.centre);
  const longAxis = apex.clone().sub(mitral).normalize();
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3()).length();

  // Chest view extras, created on first use.
  let chest = null;
  async function ensureChest() {
    if (chest) return chest;
    chest = new THREE.Group();
    const sk = await loader.loadAsync(skeletonUrl);
    const keep = [];
    sk.scene.traverse((o) => {
      if (!o.isMesh) return;
      let n = o;
      while (n && !THORAX.test(n.name)) n = n.parent;
      if (n) keep.push(o);
    });
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xe2d5bb, roughness: 0.8, transparent: true, opacity: 0.22, depthWrite: false });
    for (const o of keep) { o.updateWorldMatrix(true, false); const m = new THREE.Mesh(o.geometry, boneMat); m.applyMatrix4(o.matrixWorld); chest.add(m); }
    const eMat = new THREE.MeshBasicMaterial({ color: token("--heart-electrode", "#4fd1e8") });
    for (const p of Object.values(g.electrodes)) { const s = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12), eMat); s.position.copy(vec(p)); chest.add(s); }
    chest.heartArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), centre, 1, token("--heart-front", "#fff3a8"), 12, 8);
    chest.leadLine = new THREE.ArrowHelper(new THREE.Vector3(-1, 0, 0), centre, 140, token("--heart-electrode", "#4fd1e8"), 10, 6);
    for (const a of [chest.heartArrow, chest.leadLine]) { a.traverse((o) => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; } o.renderOrder = 4; }); chest.add(a); }
    scene.add(chest);
    return chest;
  }

  function place(dir, dist) {
    controls.target.copy(centre);
    camera.position.copy(centre).addScaledVector(dir.clone().normalize(), dist);
    camera.near = dist / 50;
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    controls.update();
  }

  let frame = 0;
  const render = () => { frame = 0; renderer.render(scene, camera); };
  const requestRender = () => { if (!frame) frame = requestAnimationFrame(render); };
  controls.addEventListener("change", requestRender);

  async function setView(name) {
    clip.length = 0;
    if (chest) chest.visible = name === "chest";
    if (name === "4ch") {
      // Plane through the long axis and both AV valves; keep the posterior half, look from anterior.
      const n = longAxis.clone().cross(tricuspid.clone().sub(mitral)).normalize();
      if (n.y > 0) n.negate();
      clip.push(new THREE.Plane().setFromNormalAndCoplanarPoint(n, centre));
      place(n.clone().negate().add(new THREE.Vector3(0, 0, 0.15)), size * 1.6);
    } else if (name === "sax") {
      // Plane across the ventricles halfway down; keep the base, look up from the apex.
      const mid = mitral.clone().lerp(apex, 0.55);
      clip.push(new THREE.Plane().setFromNormalAndCoplanarPoint(longAxis.clone().negate(), mid));
      place(longAxis, size * 1.6);
    } else if (name === "chest") {
      await ensureChest();
      chest.visible = true;
      place(new THREE.Vector3(0.15, 1, 0.25), size * 3.6);
    } else {
      place(new THREE.Vector3(0, 1, 0.15), size * 1.6);
    }
    requestRender();
  }

  function setStates(states) {
    for (const { attr, map } of coloured) {
      const a = attr.array;
      for (let i = 0; i < map.length; i++) {
        const c = palette[map[i] >= 0 ? states[map[i]] : 0];
        a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
      }
      attr.needsUpdate = true;
    }
    for (const { ids, mat } of lines) {
      let s = 0;
      for (const v of ids) if (states[v] === 1 || (states[v] && !s)) s = states[v];
      mat.color.copy(lineColor[s]);
    }
    requestRender();
  }

  // heart: the heart vector now (any units); leadAxis: unit axis of the selected lead, or null.
  let vmax = 1e-9;
  function setVectors(heart, leadAxis) {
    if (!chest?.visible) return;
    const h = vec(heart), len = h.length();
    vmax = Math.max(vmax, len);
    chest.heartArrow.visible = len > vmax * 0.03;
    if (chest.heartArrow.visible) { chest.heartArrow.setDirection(h.clone().normalize()); chest.heartArrow.setLength(20 + 110 * (len / vmax), 12, 8); }
    chest.leadLine.visible = !!leadAxis;
    if (leadAxis) chest.leadLine.setDirection(vec(leadAxis));
    requestRender();
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  await setView("outside");
  resize();

  return {
    setStates, setView, setVectors, resize,
    dispose() { ro.disconnect(); controls.dispose(); renderer.dispose(); canvas.remove(); },
  };
}
