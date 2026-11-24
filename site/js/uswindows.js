// FAST windows: what the fan contains, whether a view is "found", how close the probe is. DOM-free.
import { nearest } from "./usgeom.js";
import { FAN, fanRay, sampleDepth } from "./usrender.js";

const STEP = 3; // every 3rd line and sample: plenty for fractions, cheap enough per frame

// Fraction of fan samples per label id, plus "fluid:<site>" for fluid visible at the current amounts.
export function fanContents(vol, frame, depthMm, amounts = [0, 0, 0, 0, 0]) {
  const { labels, fluid, dims, spacing } = vol;
  const counts = new Map();
  let total = 0;
  for (let i = 0; i < FAN.lines; i += STEP) {
    const { origin: o, dir } = fanRay(frame, i);
    for (let k = 0; k < FAN.samples; k += STEP) {
      const d = sampleDepth(k, depthMm);
      const x = o[0] + d * dir[0], y = o[1] + d * dir[1], z = o[2] + d * dir[2];
      total++;
      const fv = fluid ? nearest(fluid, dims, spacing, x, y, z) : 0;
      if (fv && (fv & 3) <= (amounts[fv >> 2] || 0)) {
        const key = `fluid:${fv >> 2}`;
        counts.set(key, (counts.get(key) || 0) + 1);
        continue;
      }
      const lab = nearest(labels, dims, spacing, x, y, z);
      if (lab) counts.set(lab, (counts.get(lab) || 0) + 1);
    }
  }
  for (const [k, v] of counts) counts.set(k, v / total);
  return counts;
}

// Every landmark group ({keys, minFrac}) must fill at least minFrac of the fan, summed over its keys.
export function viewFound(contents, win, idByKey) {
  return win.landmarks.every(({ keys, minFrac }) =>
    keys.reduce((s, k) => s + (contents.get(idByKey[k]) || 0), 0) >= minFrac);
}

const angDiff = (a, b) => Math.abs(((((a - b) + 180) % 360) + 360) % 360 - 180);

// 1 at the target pose, falling off over ~40 mm of skin and ~30° of probe angle. Theta becomes mm on a
// ~150 mm radius trunk.
export function closeness(pose, target) {
  const mm = Math.hypot(pose.zMm - target.zMm, (angDiff(pose.theta, target.theta) * Math.PI * 150) / 180);
  const deg = Math.max(Math.abs(pose.rock - target.rock), Math.abs(pose.fan - target.fan), angDiff(pose.rot, target.rot));
  return Math.exp(-((mm / 40) ** 2) - (deg / 30) ** 2);
}
