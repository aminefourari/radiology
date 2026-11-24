// three.js view of one fracture on the atlas bones: the broken bone cut into fragments (fracturegeom.splitMesh)
// with filled cut faces, neighbouring bones, the section plane, and for an approach the incision and the
// structures at risk. Built on view3d (same renderer, lights and controls as the CT atlas).
import * as THREE from "three";
import { createView3d } from "./view3d.js";
import { fragmentCaps, moveMatrix, planeFrame, splitMesh } from "./fracturegeom.js";

export const FRAG_COLORS = ["#e8913a", "#4fb3d9", "#9b7fe0", "#5cc28a", "#e06a8f", "#d8c84a"];
const BONE = "#e2d5bb", CANCELLOUS = "#b8735a";
const RISK = { nerve: "#f2d24b", vessel: "#e0524d", muscle: "#b5574f", cartilage: "#8fc6d8" };
const TISSUE = { skeleton: "bone", joints: "cartilage", muscles: "muscle", vessels: "vessel", nervous: "nerve" };

export async function createFractureView(container, index) {
  const v = createView3d(container, null);
  const byKey = new Map(index.structures.map((s) => [s.key, s]));
  const loaded = new Set();
  const load = (system) => {
    if (loaded.has(system)) return null;
    loaded.add(system);
    return v.addSystem(`atlas/${index.systems.find((s) => s.key === system).file}`, byKey);
  };
  await load("skeleton");

  // World-space positions + index of an atlas mesh (positions are quantized; matrixWorld undoes it).
  const meshOf = new Map();
  v.scene.traverse((o) => { if (o.isMesh && o.userData.id) meshOf.set(o.userData.id, o); });
  function worldMesh(key) {
    const m = meshOf.get(key);
    m.updateWorldMatrix(true, false);
    const a = m.geometry.attributes.position, p = new THREE.Vector3(), pos = [];
    for (let i = 0; i < a.count; i++) { p.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld); pos.push(p.x, p.y, p.z); }
    return { pos, idx: Array.from(m.geometry.index.array) };
  }

  const pieces = new THREE.Group();
  const extras = new THREE.Group();
  v.scene.add(pieces, extras);
  const mat = (color, side = THREE.FrontSide) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.78, clearcoat: 0.05, side });
  let frags = [], shown = new Map(), state = {};

  function capMesh(cap, color) {
    // Triangulate in the cap plane's own 2D frame.
    const up = Math.abs(cap.n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const fr = planeFrame({ p: cap.poly[0], n: cap.n, up });
    const flat = cap.poly.map((x) => new THREE.Vector2(...fr.project(x)));
    const tris = THREE.ShapeUtils.triangulateShape(flat, []);
    const g = new THREE.BufferGeometry().setFromPoints(cap.poly.map((x) => new THREE.Vector3(...x)));
    g.setIndex(tris.flat());
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat(color, THREE.DoubleSide));
  }

  function clear(group) {
    for (const o of [...group.children]) {
      o.traverse((c) => { c.geometry?.dispose(); c.material?.dispose(); });
      group.remove(o);
    }
  }

  // shape: { bone, context: [keys], fade: [keys], fragments: [{ cuts, move, bone?, color? }] }. A fragment belongs to
  // shape.bone unless it names another bone; a fragment with no cuts is a whole bone (e.g. a shifted talus).
  function setShape(shape) {
    clear(pieces);
    state = { ...state, shape };
    frags = [];
    const fractured = [...new Set([shape.bone, ...shape.fragments.map((f) => f.bone ?? shape.bone)])];
    for (const bone of fractured) {
      const { pos, idx } = worldMesh(bone);
      const mine = shape.fragments.map((f, i) => ({ f, i })).filter(({ f }) => (f.bone ?? shape.bone) === bone);
      const groups = splitMesh(pos, idx, mine.map(({ f }) => f)).map((piece, k) => {
        const f = k ? mine[k - 1] : null;
        const color = !f || f.f.color === "bone" ? BONE : FRAG_COLORS[f.i % FRAG_COLORS.length];
        const grp = new THREE.Group();
        grp.matrixAutoUpdate = false;
        if (piece.pos.length) {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.Float32BufferAttribute(piece.pos, 3));
          g.setAttribute("normal", new THREE.Float32BufferAttribute(piece.nrm, 3));
          grp.add(new THREE.Mesh(g, mat(color)));
        }
        pieces.add(grp);
        frags.push({ grp, move: f?.f.move ?? null });
        return grp;
      });
      // Cut faces move with their fragment; the intact bone gets the same faces so it looks solid when they part.
      mine.forEach(({ f }, k) => {
        if (!f.cuts.length) return;
        for (const cap of fragmentCaps(pos, idx, f)) {
          groups[k + 1].add(capMesh(cap, CANCELLOUS));
          groups[0].add(capMesh(cap, CANCELLOUS));
        }
      });
    }
    setDisplacement(state.t ?? 1);
    showOnly();
  }

  function setDisplacement(t) {
    state.t = t;
    for (const f of frags) f.grp.matrix.fromArray(moveMatrix(f.move, t));
    v.requestRender();
  }

  function showOnly() {
    const s = state.shape;
    shown = new Map();
    const broken = new Set([s?.bone, ...(s?.fragments ?? []).map((f) => f.bone)]);
    for (const k of s?.context ?? []) if (!broken.has(k)) shown.set(k, { color: BONE, tissue: "bone", opacity: s.fade?.includes(k) ? 0.25 : 1 });
    for (const r of state.risk ?? []) {
      const st = byKey.get(r);
      if (!st) continue;
      const tissue = TISSUE[st.system] ?? "organ";
      shown.set(r, { color: RISK[tissue] ?? st.color, tissue, opacity: 1 });
    }
    v.setVisibility(shown);
  }

  // approach: { incisions: [[[x, y, z], ...], ...], risk: [atlas keys] } or null
  async function setApproach(ap) {
    clear(extras);
    state.risk = ap?.risk ?? [];
    const systems = new Set(state.risk.map((k) => byKey.get(k)?.system).filter(Boolean));
    await Promise.all([...systems].map(load));
    for (const line of ap?.incisions ?? []) {
      const curve = new THREE.CatmullRomCurve3(line.map((p) => new THREE.Vector3(...p)));
      extras.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 1.2, 8), new THREE.MeshBasicMaterial({ color: 0xff3b6b })));
    }
    showOnly();
    if (state.section) setSection(state.section);
  }

  // The 2D section's plane, drawn as an outlined see-through quad. sec: { p, n, up, size } or null.
  function setSection(sec) {
    state.section = sec;
    for (const o of extras.children.filter((o) => o.userData.section)) { extras.remove(o); o.geometry.dispose(); }
    if (!sec) return v.requestRender();
    const s = sec.size ?? 80;
    const n = new THREE.Vector3(...sec.n).normalize();
    const up = new THREE.Vector3(...sec.up);
    up.sub(n.clone().multiplyScalar(up.dot(n))).normalize();
    const u = new THREE.Vector3().crossVectors(up, n);
    const c = new THREE.Vector3(...sec.p);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => c.clone().addScaledVector(u, (a * s) / 2).addScaledVector(up, (b * s) / 2));
    const quad = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]]),
      new THREE.MeshBasicMaterial({ color: 0x4fd1e8, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }));
    quad.userData.section = true;
    quad.renderOrder = 2;
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({ color: 0x4fd1e8 }));
    line.userData.section = true;
    extras.add(quad, line);
    v.requestRender();
  }

  // cam: { target: [x, y, z], dir: [x, y, z] (from target towards the eye), dist }
  function setCamera(cam) {
    v.reset();
    const target = new THREE.Vector3(...cam.target);
    const dir = new THREE.Vector3(...cam.dir).normalize();
    v.controls.target.copy(target);
    v.camera.position.copy(target).addScaledVector(dir, cam.dist);
    v.camera.near = cam.dist / 50;
    v.camera.far = cam.dist * 20;
    v.camera.updateProjectionMatrix();
    v.controls.update();
    v.requestRender();
  }

  return { setShape, setDisplacement, setApproach, setSection, setCamera, worldMesh, dispose: v.dispose };
}
