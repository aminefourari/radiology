// Case loading and reslicing. DOM-free so Node can test it.
// Volumes are [z][y][x] (RAS+), dims = [X, Y, Z]. Display is radiological:
// patient right on viewer's left, anterior/superior on top, anterior on the left in sagittal.

export const PLANES = ["axial", "coronal", "sagittal"];

export const WINDOWS = {
  soft: { c: 40, w: 400 },
  liver: { c: 60, w: 160 },
  bone: { c: 400, w: 1800 },
  lung: { c: -600, w: 1500 },
  brain: { c: 40, w: 80 },
  mediastinum: { c: 50, w: 350 },
};

export async function decodeMaybeGzip(buf) {
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf; // host already decoded Content-Encoding
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function fetchBytes(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  if (!res.body || !onBytes) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onBytes(got, total);
  }
  return new Blob(chunks).arrayBuffer();
}

export async function loadCase(baseUrl, onProgress) {
  const res = await fetch(`${baseUrl}/meta.json`);
  if (!res.ok) throw new Error(`${baseUrl}/meta.json: HTTP ${res.status}`);
  const meta = await res.json();
  const progress = { ct: [0, 0], labels: [0, 0] };
  const report = (key) => (got, total) => {
    progress[key] = [got, total];
    const t = progress.ct[1] + progress.labels[1];
    if (onProgress && t) onProgress(Math.min(1, (progress.ct[0] + progress.labels[0]) / t));
  };
  const [ctBuf, labBuf] = await Promise.all([
    fetchBytes(`${baseUrl}/ct.bin.gz`, report("ct")).then(decodeMaybeGzip),
    fetchBytes(`${baseUrl}/labels.bin.gz`, report("labels")).then(decodeMaybeGzip),
  ]);
  return { meta, ct: new Int16Array(ctBuf), labels: new Uint8Array(labBuf) };
}

export function sliceCount([X, Y, Z], plane) {
  return plane === "axial" ? Z : plane === "coronal" ? Y : X;
}

export function planeSize([X, Y, Z], plane) {
  return plane === "axial" ? [X, Y] : plane === "coronal" ? [X, Z] : [Y, Z];
}

export function pixelAspect([sx, sy, sz], plane) {
  return plane === "axial" ? [sx, sy] : plane === "coronal" ? [sx, sz] : [sy, sz];
}

// Flat-index arithmetic: start offset for (col 0, row 0), then steps per column and per row.
function walk([X, Y, Z], plane, i) {
  const sy = X, sz = X * Y;
  if (plane === "axial") return { start: i * sz + (Y - 1) * sy + (X - 1), dc: -1, dr: -sy };
  if (plane === "coronal") return { start: (Z - 1) * sz + i * sy + (X - 1), dc: -1, dr: -sz };
  return { start: (Z - 1) * sz + (Y - 1) * sy + i, dc: -sy, dr: -sz };
}

export function extractSlice(vol, dims, plane, index) {
  const [w, h] = planeSize(dims, plane);
  const { start, dc, dr } = walk(dims, plane, index);
  const out = new vol.constructor(w * h);
  for (let r = 0, o = 0; r < h; r++) {
    for (let c = 0, p = start + r * dr; c < w; c++, p += dc) out[o++] = vol[p];
  }
  return out;
}

export function windowToGray(slice, center, width, out) {
  const lo = center - width / 2, scale = 255 / width;
  for (let i = 0, j = 0; i < slice.length; i++, j += 4) {
    const g = (slice[i] - lo) * scale; // Uint8ClampedArray clamps and rounds
    out[j] = out[j + 1] = out[j + 2] = g;
    out[j + 3] = 255;
  }
}
