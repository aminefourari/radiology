import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHeart, tissueAt, VOXEL } from "../site/js/heartshape.js";

const t0 = performance.now();
const { json, grid } = buildHeart();
const buildMs = performance.now() - t0;
const n = json.chamber.length;
const P = (v) => [json.pos[v * 3], json.pos[v * 3 + 1], json.pos[v * 3 + 2]];

test("build is quick (bound loose; real time logged)", () => {
  console.log(`heart: ${n} voxels in ${Math.round(buildMs)} ms`);
  assert.ok(buildMs < 5000);
});

test("no atrial voxel lies within the 3.5 mm neighbour radius of a ventricular voxel", () => {
  const atrial = [], vent = [];
  for (let v = 0; v < n; v++) (json.chamber[v] <= 1 ? atrial : vent).push(v);
  const near = atrial.filter((a) => grid.local[a][2] < 10);
  for (const a of near) for (const b of vent) {
    if (grid.local[b][2] < -8) continue;
    assert.ok(Math.hypot(...P(a).map((x, i) => x - P(b)[i])) >= 3.5, `atrial ${a} near ventricular ${b}`);
  }
});

test("each chamber wall is one 26-connected piece", () => {
  const key = (p) => p.map((x) => Math.round(x / VOXEL)).join();
  const at = new Map(grid.local.map((p, v) => [key(p), v]));
  for (const c of [0, 1, 2, 3]) {
    const mine = [...Array(n).keys()].filter((v) => json.chamber[v] === c);
    const seen = new Set([mine[0]]), stack = [mine[0]];
    while (stack.length) {
      const v = stack.pop(), p = grid.local[v];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const u = at.get(key([p[0] + dx * VOXEL, p[1] + dy * VOXEL, p[2] + dz * VOXEL]));
        if (u != null && json.chamber[u] === c && !seen.has(u)) { seen.add(u); stack.push(u); }
      }
    }
    assert.equal(seen.size, mine.length, `chamber ${c}: ${mine.length - seen.size} voxels apart`);
  }
});

test("every landmark is a wall voxel of the expected chamber", () => {
  const want = { sa: 0, hra: 0, lra: 0, lateral_ra: 0, avnode: 0, site_ra: 0, la_focus: 1, rvot: 2, his: 3, apex: 3, pvc: 3, lv_lateral: 3, fascicular: 3, site_septum: 3, site_lv: 3 };
  for (const [k, c] of Object.entries(want)) assert.equal(json.chamber[json.landmarks[k]], c, k);
  for (const v of json.landmarks.tricuspid_ring) assert.equal(json.chamber[v], 0, "flutter circuit in the RA");
  assert.equal(json.chamber[json.landmarks.accessory[0]], 1);
  assert.ok(json.chamber[json.landmarks.accessory[1]] >= 2);
});

test("tissueAt: cavities inside, walls around, nothing in the AV gap", () => {
  assert.deepEqual(tissueAt([0, 0, -30]), { wall: -1, cavity: 3 });
  assert.equal(tissueAt([-29, 0, -30]).wall, 3);
  assert.deepEqual(tissueAt([0, 0, 1.5]), { wall: -1, cavity: -1 });
});
