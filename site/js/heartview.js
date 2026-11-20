// three.js view of the idealised heart for heart.html: the wall surface coloured per vertex from the simulation,
// the conduction system as tubes, section cuts (four-chamber, short axis), the heart vector, and a torso with the
// ten ECG electrodes. World coordinates are RAS mm; the camera looks from the front, so the patient's right is on
// the viewer's left.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { sectionPlane, toRas, TORSO } from "./heartshape.js";
import { timeColour } from "./heartschematic.js";

const token = (name, fallback) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

function label(text, colour = "#1d232b") {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const x = c.getContext("2d");
  x.font = "600 34px IBM Plex Mono, monospace";
  x.fillStyle = colour; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(text, 64, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(28, 14, 1);
  s.renderOrder = 10;
  return s;
}

export async function createHeartView(container, { json, grid, g, surface }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4ec, 0x2a2224, 1.5));
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 6000);
  camera.up.set(0, 0, 1);
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-0.3, 1, 0.7);
  camera.add(key);
  scene.add(camera);
  const controls = new OrbitControls(camera, renderer.domElement);
  const centre = new THREE.Vector3(...json.centre);
  controls.target.copy(centre);

  const palette = ["--heart-rest", "--heart-front", "--heart-plateau", "--heart-repol"].map((v, i) => token(v, ["#c98b7f", "#fff3a8", "#e8a23c", "#5d8fd6"][i]));
  const lineIdle = token("--heart-line", "#d9d4c8");

  // Heart surface.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(surface.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(surface.indices, 1));
  geo.computeVertexNormals();
  const colours = new Float32Array(surface.positions.length);
  geo.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e6);
  const heartMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, side: THREE.DoubleSide, clippingPlanes: [clipPlane] });
  scene.add(new THREE.Mesh(geo, heartMat));

  // Conduction system: one tube per line through its graph nodes; colour per frame from the line's nodes.
  const csGroup = new THREE.Group();
  const tubes = [];
  for (const ids of Object.values(g.lineNodes)) {
    const pts = ids.map((id) => new THREE.Vector3(g.pos[id * 3], g.pos[id * 3 + 1], g.pos[id * 3 + 2]));
    if (pts.length < 2) continue;
    const mat = new THREE.MeshBasicMaterial({ color: lineIdle.clone(), depthTest: false, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, pts.length * 2), 1.1, 6), mat);
    mesh.renderOrder = 5;
    csGroup.add(mesh);
    tubes.push({ mat, ids });
  }
  for (const lm of ["sa", "avnode"]) {
    const v = json.landmarks[lm];
    const mat = new THREE.MeshBasicMaterial({ color: lineIdle.clone(), depthTest: false, transparent: true });
    const m = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), mat);
    m.position.set(json.pos[v * 3], json.pos[v * 3 + 1], json.pos[v * 3 + 2]);
    m.renderOrder = 5;
    csGroup.add(m);
    tubes.push({ mat, ids: [v] });
  }
  scene.add(csGroup);

  // Heart vector arrow from the centre.
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), centre, 60, 0xffd166, 12, 7);
  arrow.line.material.depthTest = false; arrow.cone.material.depthTest = false;
  arrow.renderOrder = 6;
  scene.add(arrow);

  // Torso: a translucent elliptic cylinder around the chest with the ten electrodes.
  const torso = new THREE.Group();
  const cx = json.centre[0] + TORSO.dx, cy = json.centre[1] + TORSO.dy;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 560, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xa9b8c9, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  body.rotation.x = Math.PI / 2;
  body.scale.set(TORSO.halfWidth, 1, TORSO.halfDepth);
  body.position.set(cx, cy, json.centre[2] - 110);
  torso.add(body);
  for (const [name, p] of [...Object.entries(json.electrodes), ...Object.entries(json.limbs)]) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), new THREE.MeshStandardMaterial({ color: token("--heart-electrode", "#4fd1e8") }));
    dot.position.set(...p);
    const l = label(name);
    l.position.set(p[0], p[1] + 14, p[2] + 12);
    torso.add(dot, l);
  }
  scene.add(torso);

  const state = { torso: false, section: "outside", vector: true };
  function frameCamera() {
    const dist = state.torso ? 1500 : 420;
    camera.position.set(centre.x, centre.y + dist, centre.z + (state.torso ? 120 : 30));
    controls.target.copy(state.torso ? new THREE.Vector3(cx, cy, json.centre[2] - 60) : centre);
    controls.update();
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(() => { resize(); render(); });
  ro.observe(container);
  const render = () => renderer.render(scene, camera);
  controls.addEventListener("change", render);
  resize();
  frameCamera();

  return {
    setOptions({ section, level, torso: showTorso, conduction, vector }) {
      if (showTorso !== state.torso) { state.torso = showTorso; frameCamera(); }
      torso.visible = showTorso;
      csGroup.visible = conduction;
      state.vector = vector;
      // Cuts: four-chamber removes the front half (v > 0); short axis removes everything above the level.
      if (section === "outside") clipPlane.constant = 1e6;
      else {
        const pl = sectionPlane(section, level);
        const normal = section === "sax" ? toRas(grid.ax, [0, 0, -1]) : toRas(grid.ax, [0, -1, 0]);
        const at = toRas(grid.ax, pl.origin);
        clipPlane.normal.set(...normal);
        clipPlane.constant = -(normal[0] * at[0] + normal[1] * at[1] + normal[2] * at[2]);
      }
      render();
    },
    setFrame(states, vector, timeMode) {
      const vn = surface.vertexNode;
      let times = null;
      if (timeMode) {
        times = new Float32Array(g.nMesh).fill(-1);
        for (const w of timeMode.sim.wavefronts) {
          if (w.t0 > timeMode.t) continue;
          for (let v = 0; v < g.nMesh; v++) if (w.act[v] <= timeMode.t) times[v] = w.act[v] - w.t0;
        }
      }
      for (let i = 0; i < vn.length; i++) {
        const v = vn[i];
        if (times) {
          const c = times[v] >= 0 ? timeColour(times[v]).map((x) => x / 255) : [palette[0].r, palette[0].g, palette[0].b];
          colours[i * 3] = c[0]; colours[i * 3 + 1] = c[1]; colours[i * 3 + 2] = c[2];
        } else {
          const c = palette[states[v]];
          colours[i * 3] = c.r; colours[i * 3 + 1] = c.g; colours[i * 3 + 2] = c.b;
        }
      }
      geo.attributes.color.needsUpdate = true;
      for (const tb of tubes) {
        const s = tb.ids.some((id) => states[id] === 1) ? 1 : tb.ids.some((id) => states[id] === 2) ? 2 : 0;
        tb.mat.color.copy(s ? palette[s] : lineIdle);
      }
      const m = Math.hypot(...vector);
      arrow.visible = state.vector && m > 1e-6;
      if (arrow.visible) {
        arrow.setDirection(new THREE.Vector3(...vector).normalize());
        arrow.setLength(Math.min(120, 25 + m * 0.02), 12, 7);
      }
      render();
    },
    dispose() { ro.disconnect(); renderer.dispose(); renderer.domElement.remove(); },
  };
}
