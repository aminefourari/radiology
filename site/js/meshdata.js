// 3D mesh decoding and visibility rules. DOM-free so Node can test it.

// buf: decompressed mesh.bin.gz; index: meshes.json. Positions come back in RAS mm.
export function decodeMeshes(buf, { box, meshes }) {
  const out = new Map();
  for (const m of meshes) {
    const q = new Uint16Array(buf, m.offset, m.vertexCount * 3);
    const positions = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) {
      const k = i % 3;
      positions[i] = box[k] + (q[i] / 65535) * (box[k + 3] - box[k]);
    }
    const indices = new Uint16Array(buf, m.offset + m.vertexCount * 6, m.indexCount);
    out.set(m.id, { positions, indices, anchor: m.anchor, size: m.size });
  }
  return out;
}

// Natural tissue colours for 3D, first match wins. Systems whose point is telling parts apart keep
// their legend colours. tissue picks the material in view3d.js.
const KEEP_LEGEND = new Set(["segments", "lobes", "deep-nuclei"]);
const ARTERY = "#b8302c", VEIN = "#33589e", BONE = "#e2d5bb", MUSCLE = "#a3463c";
const LOOKS = [
  [/pulmonary_artery/, VEIN, "vessel"], [/pulmonary_vein/, ARTERY, "vessel"],
  [/heart_atrium_right|heart_ventricle_right/, "#4a62a0", "organ"],
  [/heart_atrium_left|heart_ventricle_left|atrial_appendage/, "#b23a36", "organ"],
  [/myocardium/, "#93342f", "muscle"],
  [/aorta|artery|arterie|brachiocephalic_trunk/, ARTERY, "vessel"],
  [/vena|vein|jugular|venous_sinus/, VEIN, "vessel"],
  [/cartilage/, "#c3d3da", "cartilage"],
  [/vertebrae|rib_|skull|hip_|sacrum|femur|humerus|scapula|clavicula|sternum|tibia|fibula|patella|tarsal|metatarsal|phalanges|hyoid|styloid|hard_palate/, BONE, "bone"],
  [/spinal_cord|optic_nerve/, "#ecd28a", "organ"],
  [/ventricle|subarachnoid|septum_pellucidum/, "#8fc3de", "fluid"],
  [/eye_lens/, "#d6e6ee", "fluid"], [/eye_/, "#efe9df", "organ"],
  [/brainstem/, "#dfb7a0", "organ"], [/cerebellum/, "#d6a08f", "organ"], [/brain/, "#d9a493", "organ"],
  [/liver/, "#7a2f25", "organ"], [/spleen/, "#6c2b3b", "organ"], [/kidney/, "#87392c", "organ"],
  [/adrenal/, "#c99c48", "organ"], [/pancreas/, "#d8ae76", "organ"], [/gallbladder/, "#4c7739", "organ"],
  [/stomach|duodenum|esophagus/, "#c4766c", "organ"], [/small_bowel/, "#cf8670", "organ"], [/colon/, "#b47c5e", "organ"],
  [/urinary_bladder/, "#d6b493", "organ"], [/prostate/, "#b5766a", "organ"],
  [/thyroid_gland/, "#a4474a", "organ"], [/parotid|submandibular/, "#d4ab78", "organ"],
  [/lung_airways|trachea|larynx_air|nasal|pharynx|auditory|soft_palate/, "#d8a39c", "organ"],
  [/lung/, "#e4a9a6", "organ"],
  [/muscle|gluteus|iliopsoas|scalene|trapezius|platysma|sterno|thyrohyoid|levator|prevertebral|masseter|pterygoid|temporalis|constrictor|tongue/, MUSCLE, "muscle"],
];

export function tissueLook({ key = "", system, color }) {
  if (!KEEP_LEGEND.has(system)) for (const [re, c, tissue] of LOOKS) if (re.test(key)) return { color: c, tissue };
  return { color, tissue: "organ" };
}

// Which meshes to draw, with colour and opacity. Mirrors overlay.colorTable: a parent (liver) is
// drawn as its own union mesh unless its children's system (segments) is on, then as the children.
export function meshVisibility(structures, systemsOn, hidden, faded, isolated, meshIds) {
  const kids = new Map();
  for (const s of structures) if (s.parent) kids.set(s.parent, [...(kids.get(s.parent) ?? []), s]);
  const out = new Map();
  for (const s of structures) {
    if (!meshIds.has(s.id) || hidden.has(s.id) || !systemsOn.has(s.system)) continue;
    if (kids.get(s.id)?.some((c) => systemsOn.has(c.system))) continue;
    if (isolated && s.id !== isolated) continue;
    out.set(s.id, { ...tissueLook(s), opacity: faded.has(s.id) ? 0.15 : 1 });
  }
  return out;
}
