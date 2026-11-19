// three.js view of the 3D atlas. Loaded with import() only when 3D is switched on.
// World coordinates are RAS mm. Default camera looks from anterior, so the patient's right
// is on the viewer's left (radiological), and redraws only when something changes.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// Material per tissue (atlasdata.tissueOf): wet, glossy organs and vessels; matte bone.
const TISSUES = {
  organ: { roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.3, sheen: 0.35, sheenRoughness: 0.6 },
  vessel: { roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 },
  muscle: { roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.5, sheen: 0.5, sheenRoughness: 0.5 },
  bone: { roughness: 0.78, clearcoat: 0.05 },
  cartilage: { roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 },
  nerve: { roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.3, sheen: 0.3, sheenRoughness: 0.5 },
};

const WHITE = new THREE.Color(0xffffff);

// Soft studio backdrop: lighter in the middle, dark at the edges.
function backdrop() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(128, 110, 10, 128, 128, 190);
  grad.addColorStop(0, "#3a4350");
  grad.addColorStop(1, "#0c1015");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createView3d(container, before) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  const canvas = renderer.domElement;
  container.insertBefore(canvas, before);

  const scene = new THREE.Scene();
  scene.background = backdrop();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  scene.add(new THREE.HemisphereLight(0xfff4ec, 0x2a2224, 0.6));
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 10000);
  camera.up.set(0, 0, 1);
  const key = new THREE.DirectionalLight(0xfff6ee, 2.2);
  const rim = new THREE.DirectionalLight(0xbcd4ff, 1.1);
  camera.add(key, rim); // lights move with the camera: the side you look at is always lit
  key.position.set(-0.5, 0.8, 1);
  rim.position.set(0.6, 0.3, -1);
  scene.add(camera);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.zoomToCursor = true;

  const group = new THREE.Group();
  scene.add(group);
  const meshes = new Map();
  const raycaster = new THREE.Raycaster();
  let selected = new Set(), frame = 0, changed = () => {};
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

  // The current CT slice: a see-through quad with an outline, spanning the visible bodies.
  const planeMat = new THREE.MeshBasicMaterial({ color: 0x4fd1e8, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMat);
  plane.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => new THREE.Vector3(x, y, 0))),
    new THREE.LineBasicMaterial({ color: 0x4fd1e8 })));
  plane.renderOrder = 2;
  plane.visible = false;
  scene.add(plane);

  // Ambient occlusion darkens creases and contact areas, which is most of the "atlas" depth.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.updateGtaoMaterial({ radius: 12, distanceExponent: 1.5, thickness: 4, scale: 1.2 });
  ao.blendIntensity = 0.85;
  composer.addPass(ao);
  composer.addPass(new OutputPass());

  const lastCam = new THREE.Matrix4();
  function render() {
    frame = 0;
    composer.render();
    const moved = !lastCam.equals(camera.matrixWorld);
    lastCam.copy(camera.matrixWorld);
    changed(moved); // moved: screen positions of everything changed
  }
  const requestRender = () => { if (!frame) frame = requestAnimationFrame(render); };
  controls.addEventListener("change", requestRender);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  function visibleBox() {
    const vis = new THREE.Box3();
    for (const m of meshes.values()) if (m.visible) vis.expandByObject(m);
    return vis;
  }

  // Frames box ([x0,y0,z0,x1,y1,z1], e.g. the CT volume mapped into the atlas), else what is shown.
  function frameBox(box) {
    const vis = visibleBox();
    if (!box && vis.isEmpty()) return;
    const [x0, y0, z0, x1, y1, z1] = box ?? [...vis.min.toArray(), ...vis.max.toArray()];
    const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const fitH = (z1 - z0) / 2 / Math.tan(fov / 2);
    const fitW = Math.max(x1 - x0, y1 - y0) / 2 / Math.tan(fov / 2) / Math.max(camera.aspect, 0.1);
    const dist = Math.max(fitH, fitW) * 1.15 + Math.max(y1 - y0, x1 - x0) / 2;
    controls.target.copy(c);
    // Anterior (+y), looking posterior, from 15 degrees above so an axial slice plane reads as a band.
    camera.position.set(c.x, c.y + dist * Math.cos(0.26), c.z + dist * Math.sin(0.26));
    ao.updateGtaoMaterial({ radius: dist / 80 });
    camera.near = dist / 50;
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    controls.update();
  }

  // Loads one atlas system's GLB. byKey: Map atlas key -> index.json structure (anchor, size).
  // Meshes stay hidden until the next setVisibility.
  async function addSystem(url, byKey) {
    const gltf = await loader.loadAsync(url);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      let n = o;
      while (n && !byKey.has(n.name)) n = n.parent; // gltfpack may nest the mesh under its named node
      if (!n) return;
      const s = byKey.get(n.name);
      o.geometry.computeVertexNormals();
      o.material = new THREE.MeshPhysicalMaterial();
      o.userData = { id: n.name, anchor: new THREE.Vector3(...s.anchor), size: s.size };
      o.visible = false;
      meshes.set(n.name, o);
    });
    group.add(gltf.scene);
  }

  // p: { axis: "x" | "y" | "z", value, box? } in atlas mm, or null to hide. The quad spans box (the scan's
  // extent mapped into the atlas) on the other two axes, else everything shown.
  function setPlane(p) {
    const vis = p?.box ? new THREE.Box3().setFromArray(p.box) : visibleBox();
    plane.visible = !!p && !vis.isEmpty();
    if (plane.visible) {
      const c = vis.getCenter(new THREE.Vector3()), d = vis.getSize(new THREE.Vector3()).addScalar(10);
      plane.position.copy(c).setComponent("xyz".indexOf(p.axis), p.value);
      plane.rotation.set(p.axis === "y" ? Math.PI / 2 : 0, p.axis === "x" ? Math.PI / 2 : 0, 0);
      plane.scale.set(p.axis === "x" ? d.z : d.x, p.axis === "y" ? d.z : d.y, 1);
    }
    requestRender();
  }

  // shown: Map key -> { color, tissue, opacity } from atlasVisibility.
  function setVisibility(shown) {
    for (const [id, m] of meshes) {
      const s = shown.get(id);
      m.visible = !!s;
      const u = m.userData;
      if (!s || (u.color === s.color && u.tissue === s.tissue && u.opacity === s.opacity)) continue; // unchanged
      if (u.tissue !== s.tissue) {
        m.material.setValues({ roughness: 0.5, clearcoat: 0, clearcoatRoughness: 0, sheen: 0, sheenRoughness: 1, ...TISSUES[s.tissue] });
      }
      const faded = s.opacity < 1;
      m.material.color.set(s.color);
      m.material.sheenColor.set(s.color).lerp(WHITE, 0.5);
      m.material.opacity = s.opacity;
      if (m.material.transparent !== faded) m.material.needsUpdate = true; // opaque shaders force alpha to 1
      m.material.transparent = faded;
      m.material.depthWrite = !faded;
      m.renderOrder = faded ? 1 : 0;
      Object.assign(u, { color: s.color, tissue: s.tissue, opacity: s.opacity });
    }
    requestRender();
  }

  function select(keys) {
    if (keys.length === selected.size && keys.every((k) => selected.has(k))) return;
    selected = new Set(keys);
    for (const [k, m] of meshes) m.material.emissive.set(selected.has(k) ? 0x444444 : 0x000000);
    requestRender();
  }

  const solid = () => [...meshes.values()].filter((m) => m.visible && !m.material.transparent);
  function ndc(x, y) {
    return new THREE.Vector2((x / container.clientWidth) * 2 - 1, -(y / container.clientHeight) * 2 + 1);
  }

  // x, y in px relative to the container. Faded and hidden structures are seen through.
  function pick(x, y) {
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc(x, y), camera);
    return raycaster.intersectObjects(solid(), false)[0]?.object.userData.id ?? null;
  }

  function centerOn(id) {
    const m = meshes.get(id);
    if (!m) return;
    controls.target.copy(new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()));
    controls.update();
  }

  // Screen position of a structure's label anchor; visible is false when something solid covers it.
  function project(id) {
    const m = meshes.get(id);
    if (!m || !m.visible) return null;
    camera.updateMatrixWorld();
    const a = m.userData.anchor;
    const p = a.clone().project(camera);
    const x = ((p.x + 1) / 2) * container.clientWidth, y = ((1 - p.y) / 2) * container.clientHeight;
    const dir = a.clone().sub(camera.position);
    const dist = dir.length();
    raycaster.set(camera.position, dir.normalize());
    const hit = raycaster.intersectObjects(solid(), false)[0];
    const visible = p.z < 1 && (!hit || hit.object === m || hit.distance > dist - 2);
    return { x, y, visible, size: m.userData.size };
  }

  return {
    canvas, addSystem, setPlane, reset(box) { frameBox(box); requestRender(); }, setVisibility, select, pick, centerOn, project,
    has: (key) => meshes.has(key),
    onChange(cb) { changed = cb; },
    show(on) { canvas.hidden = !on; if (on) resize(); },
    dispose() { ro.disconnect(); controls.dispose(); composer.dispose(); renderer.dispose(); canvas.remove(); },
  };
}
