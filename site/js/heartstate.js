// Page state for heart.html: URL hash and the what-if toggles. DOM-free.

export const VIEWS = ["outside", "4ch", "sax", "chest"];
export const SPEEDS = [0.1, 0.2, 0.5, 1];
const WHAT_IF = { cutRbb: false, cutLbb: false, avDelay: 160, blockNode: false, accessory: false, extraBeat: false };

export function parseHash(hash, rhythmKeys) {
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  const rhythm = rhythmKeys.includes(h.get("rhythm")) ? h.get("rhythm") : "nsr";
  const view = VIEWS.includes(h.get("view")) ? h.get("view") : "outside";
  const speed = SPEEDS.includes(Number(h.get("speed"))) && h.has("speed") ? Number(h.get("speed")) : 0.2;
  const t = Math.max(0, Number(h.get("t")) || 0);
  const whatIf = { ...WHAT_IF };
  if (rhythm === "nsr") {
    for (const k of ["cutRbb", "cutLbb", "blockNode", "accessory", "extraBeat"]) whatIf[k] = h.get(k) === "1";
    const pr = Number(h.get("avDelay"));
    if (pr >= 120 && pr <= 400) whatIf.avDelay = pr;
  }
  return { rhythm, view, speed, t, whatIf };
}

export function formatHash({ rhythm, view, speed, t, whatIf }) {
  const h = new URLSearchParams();
  if (rhythm !== "nsr") h.set("rhythm", rhythm);
  if (view !== "outside") h.set("view", view);
  if (speed !== 0.2) h.set("speed", speed);
  if (t) h.set("t", Math.round(t));
  for (const [k, d] of Object.entries(WHAT_IF)) if (whatIf[k] !== d) h.set(k, typeof d === "boolean" ? "1" : whatIf[k]);
  const s = h.toString();
  return s ? `#${s}` : "";
}

// The normal-heart model with the learner's changes, and the rhythm the heart now has.
export function applyWhatIf(base, w) {
  const m = structuredClone(base);
  const becomes = [];
  if (w.cutRbb && w.cutLbb) {
    Object.assign(m, { block: { level: "his", pattern: [0] }, escape: { site: "ventricle", cycle: 1700 } });
    becomes.push("3avb");
  } else if (w.cutRbb) { m.cut = ["rbb"]; becomes.push("rbbb"); } else if (w.cutLbb) { m.cut = ["lbb"]; becomes.push("lbbb"); }
  if (w.avDelay !== WHAT_IF.avDelay) {
    m.avDelay = base.avDelay + (w.avDelay - WHAT_IF.avDelay);
    if (w.avDelay > 200) becomes.push("1avb");
  }
  if (w.blockNode) {
    Object.assign(m, { block: { level: "node", pattern: [0] }, escape: { site: "junction", cycle: 1300 } });
    becomes.push("3avb_node");
  }
  if (w.accessory) { m.accessory = true; becomes.push("wpw"); }
  if (w.extraBeat) { m.ectopic = [{ site: "pvc", t: 1450 }]; becomes.push("pvc"); }
  return becomes.length ? { model: m, becomes: becomes[0] } : { model: base, becomes: "nsr" };
}
