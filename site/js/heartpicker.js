// The rhythm picker: a modal dialog with a search box and the rhythms grouped by category.
import { CATEGORIES, filterRhythms } from "./heartstate.js";
import { localized, t } from "./i18n.js";

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  n.append(...kids);
  return n;
};

// Opens the dialog; onPick(key) is called with the chosen rhythm. Enter picks the highlighted row, arrows move.
export function openPicker(dialog, rhythms, lang, current, onPick) {
  const input = h("input", { type: "search", class: "picker-search", placeholder: t("heart.searchPlaceholder"), "aria-label": t("heart.search", { n: rhythms.length }),
    role: "combobox", "aria-expanded": "true", "aria-controls": "picker-list", "aria-autocomplete": "list" });
  const list = h("div", { class: "picker-list", role: "listbox", id: "picker-list" });
  const close = h("button", { class: "btn small picker-close", type: "button" }, t("heart.close"));
  let rows = [], active = 0;

  const render = () => {
    const found = filterRhythms(rhythms, input.value, lang);
    rows = [];
    list.replaceChildren();
    for (const cat of CATEGORIES) {
      const inCat = found.filter((r) => r.category === cat);
      if (!inCat.length) continue;
      const head = h("h3", { id: `picker-cat-${cat}` }, t(`heart.cat.${cat}`));
      const group = h("div", { role: "group", "aria-labelledby": head.id });
      for (const r of inCat) {
        const b = h("button", { type: "button", role: "option", tabindex: "-1", id: `picker-${r.key}`, class: "picker-row", "data-key": r.key, "aria-selected": r.key === current }, localized(r.title, lang));
        b.onclick = () => pick(r.key);
        rows.push(b);
        group.append(b);
      }
      list.append(head, group);
    }
    if (!rows.length) list.append(h("p", { class: "muted" }, t("heart.nomatch")));
    active = Math.max(0, rows.findIndex((b) => b.dataset.key === current));
    mark();
  };
  const mark = () => {
    rows.forEach((b, i) => b.classList.toggle("active", i === active));
    if (rows[active]) input.setAttribute("aria-activedescendant", rows[active].id); else input.removeAttribute("aria-activedescendant");
  };
  const pick = (key) => { dialog.close(); onPick(key); };

  input.oninput = () => { render(); active = 0; mark(); };
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!rows.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
      mark();
      rows[active].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && rows[active]) { e.preventDefault(); pick(rows[active].dataset.key); }
  };
  close.onclick = () => dialog.close();
  dialog.onclick = (e) => { if (e.target === dialog) dialog.close(); };
  dialog.replaceChildren(h("div", { class: "picker-head" }, input, close), list);
  render();
  dialog.showModal();
  input.focus();
  rows[active]?.scrollIntoView({ block: "center" });
}
