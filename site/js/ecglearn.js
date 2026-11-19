// ECG reading method and Learn-mode logic. DOM-free.

// The same seven steps drive the Study reading card and the Learn checklist; diagnosis is step 8.
export const STEPS = [
  { key: "rate", choices: ["slow", "normal", "fast"], measure: "hr", unit: "bpm", range: "60–100" },
  { key: "rhythm", choices: ["yes", "no"], measure: null, unit: "", range: "" },
  { key: "axis", choices: ["normal", "left", "right"], measure: "axis", unit: "°", range: "−30…+90" },
  { key: "pr", choices: ["short", "normal", "long", "none"], measure: "pr", unit: "ms", range: "120–200" },
  { key: "qrs", choices: ["narrow", "wide"], measure: "qrs", unit: "ms", range: "< 120" },
  { key: "qt", choices: ["normal", "long"], measure: "qtc", unit: "ms", range: "≤ 450/460" },
  { key: "st", choices: ["normal", "elevated", "depressed"], measure: null, unit: "", range: "" },
];

export const NORMAL = { rate: "normal", rhythm: "yes", axis: "normal", pr: "normal", qrs: "narrow", qt: "normal", st: "normal" };

export const isNormal = (key, answer) => NORMAL[key] === answer;

export function formatMeasure(value, unit) {
  if (value == null) return "—";
  const n = Math.round(value);
  if (unit === "°") return `${n < 0 ? "−" : "+"}${Math.abs(n)}°`;
  return unit ? `${n} ${unit}` : String(n);
}

// mulberry32: small seeded PRNG so tests are deterministic; the page passes Math.random.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Random unseen id; once all are seen, start a new round without repeating the last one.
export function nextRandom(ids, seen, rand) {
  let pool = ids.filter((id) => !seen.includes(id));
  let base = seen;
  if (!pool.length) {
    base = [];
    pool = ids.length > 1 ? ids.filter((id) => id !== seen.at(-1)) : ids;
  }
  const id = pick(pool, rand);
  return { id, seen: [...base, id] };
}

// Correct id + 3 distractors (one from the same group when possible), shuffled.
export function diagnosisChoices(list, id, rand) {
  const me = list.find((e) => e.id === id);
  const same = list.filter((e) => e.id !== id && e.group === me.group).map((e) => e.id);
  const other = shuffle(list.filter((e) => e.group !== me.group).map((e) => e.id), rand);
  const out = same.length ? [pick(same, rand), ...other.slice(0, 2)] : other.slice(0, 3);
  return shuffle([id, ...out], rand);
}

export function score(answers, picks, correctId) {
  let correct = STEPS.filter((s) => picks[s.key] === answers[s.key]).length;
  if (picks.dx === correctId) correct++;
  return { correct, total: STEPS.length + 1 };
}

// Key-value store over localStorage that keeps working (in memory) when storage is blocked.
export function makeStore(getStorage) {
  const mem = {};
  return {
    get(k, d) {
      try {
        const v = getStorage().getItem(k);
        if (v != null) return JSON.parse(v);
      } catch { /* blocked: fall through to memory */ }
      return k in mem ? mem[k] : d;
    },
    set(k, v) {
      mem[k] = v;
      try { getStorage().setItem(k, JSON.stringify(v)); } catch { /* private mode */ }
    },
  };
}

// Left-to-right isolate, so "−30…+90" or "−64°" keep their order inside Arabic text.
export const ltr = (s) => `⁦${s}⁩`;
