// Controles de interfaz generados a partir de esquemas de parámetros: todo control mostrado está conectado.

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

const fmt = (v, step) => {
  if (typeof v !== 'number') return String(v);
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return v.toFixed(d);
};

/** Deslizador: onInput mientras se arrastra, onChange al soltar (un paso de deshacer). */
export function slider({ label, min, max, step = 0.01, value, onInput, onChange, title }) {
  const val = el('span', { class: 'val' }, fmt(value, step));
  const input = el('input', { type: 'range', min, max, step, value, 'aria-label': label, title });
  input.addEventListener('input', () => { const v = parseFloat(input.value); val.textContent = fmt(v, step); onInput?.(v); });
  input.addEventListener('change', () => onChange?.(parseFloat(input.value)));
  input.addEventListener('dblclick', () => { /* doble clic: valor por defecto si lo hay */ if (input.dataset.def) { input.value = input.dataset.def; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change')); } });
  const row = el('div', { class: 'row' }, el('label', {}, label), val, input);
  row.set = (v) => { input.value = v; val.textContent = fmt(v, step); };
  row.input = input;
  return row;
}

export function select({ label, options, value, onChange }) {
  const s = el('select', { 'aria-label': label });
  for (const o of options) {
    const opt = el('option', { value: String(o.value) }, o.label);
    if (String(o.value) === String(value)) opt.selected = true;
    s.append(opt);
  }
  s.addEventListener('change', () => {
    const o = options.find((x) => String(x.value) === s.value);
    onChange?.(o ? o.value : s.value);
  });
  const row = el('div', { class: 'row inline' }, el('label', {}, label), s);
  row.input = s;
  return row;
}

export function toggle({ label, value, onChange }) {
  const i = el('input', { type: 'checkbox' });
  i.checked = !!value;
  i.addEventListener('change', () => onChange?.(i.checked));
  const l = el('label', { class: 'toggle' }, el('span', {}, label), i);
  l.input = i;
  return l;
}

export function color({ label, value, onInput, onChange }) {
  const i = el('input', { type: 'color', value });
  i.addEventListener('input', () => onInput?.(i.value));
  i.addEventListener('change', () => onChange?.(i.value));
  const row = el('div', { class: 'row inline' }, el('label', {}, label), i);
  row.input = i;
  return row;
}

export function button(label, onClick, cls = 'ghost-btn', attrs = {}) { return el('button', { class: cls, onclick: onClick, ...attrs }, label); }
export function group(title, open = true, ...children) {
  const d = el('details', { class: 'group' }, el('summary', {}, title), el('div', { class: 'group-body' }, ...children));
  d.open = open;
  return d;
}
export function hint(text) { return el('p', { class: 'hint' }, text); }
export function note(text) { return el('div', { class: 'note' }, text); }
export function btnRow(...b) { return el('div', { class: 'btn-row' }, ...b); }

/**
 * Formulario a partir de un esquema.
 * onChange(key, value, final) — final=true al soltar (crear paso de deshacer).
 * extra: { photos: [...], palettes: [...] } para tipos especiales.
 */
export function paramsForm(schema, params, onChange, extra = {}) {
  const box = el('div', { class: 'params' });
  for (const p of schema) {
    if (extra.skip?.includes(p.key)) continue;
    const v = params[p.key] ?? p.value;
    let ctl;
    if (p.type === 'toggle') ctl = toggle({ label: p.label, value: v, onChange: (x) => onChange(p.key, x, true) });
    else if (p.type === 'color') ctl = color({ label: p.label, value: v, onInput: (x) => onChange(p.key, x, false), onChange: (x) => onChange(p.key, x, true) });
    else if (p.type === 'photo') ctl = select({ label: p.label, options: (extra.photos || []).map((ph, i) => ({ value: ph.id, label: `${i + 1}. ${ph.name}` })), value: v, onChange: (x) => onChange(p.key, x, true) });
    else if (p.type === 'palette') ctl = select({ label: p.label, options: (extra.palettes || []).map((pl) => ({ value: pl.id, label: pl.name })), value: v, onChange: (x) => onChange(p.key, x, true) });
    else if (p.options) ctl = select({ label: p.label, options: p.options, value: v, onChange: (x) => onChange(p.key, x, true) });
    else {
      ctl = slider({ label: p.label, min: p.min, max: p.max, step: p.step, value: v, onInput: (x) => onChange(p.key, x, false), onChange: (x) => onChange(p.key, x, true) });
      ctl.input.dataset.def = p.value;
    }
    box.append(ctl);
  }
  return box;
}

// ---------------------------------------------------------------- avisos y diálogos
let toastTimer = 0;
export function toast(msg, isError = false, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('err', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function modal(title, body, actions = [{ label: 'Cerrar' }]) {
  return new Promise((resolve) => {
    const m = document.getElementById('modal');
    document.getElementById('modal-title').textContent = title;
    const b = document.getElementById('modal-body');
    b.innerHTML = '';
    b.append(typeof body === 'string' ? el('p', {}, body) : body);
    const a = document.getElementById('modal-actions');
    a.innerHTML = '';
    for (const act of actions) a.append(button(act.label, () => { m.classList.add('hidden'); resolve(act.value ?? act.label); }, act.primary ? 'neon-btn small' : 'ghost-btn'));
    m.classList.remove('hidden');
  });
}

export async function promptText(title, value = '') {
  const input = el('input', { type: 'text', value, style: { width: '100%' } });
  setTimeout(() => input.focus(), 50);
  const r = await modal(title, input, [{ label: 'Cancelar', value: null }, { label: 'Aceptar', value: 'ok', primary: true }]);
  return r === 'ok' ? input.value.trim() : null;
}

// Iconos del menú (trazos propios)
export const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  director: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  tunnels: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 7.5l4 2.3v4.4L12 16.5l-4-2.3V9.8z"/><circle cx="12" cy="12" r="1"/>',
  equalizers: '<path d="M4 20V12M8 20V6M12 20V9M16 20V4M20 20V11"/><circle cx="12" cy="12" r="10" opacity=".35"/>',
  meshes: '<path d="M3 17c3-6 6 2 9-4s6 2 9-4"/><path d="M3 12c3-6 6 2 9-4s6 2 9-4" opacity=".6"/><path d="M6 21l3-12M12 21l2-14M18 21l1-12" opacity=".5"/>',
  photos: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  filters: '<circle cx="9" cy="10" r="5"/><circle cx="15" cy="10" r="5"/><circle cx="12" cy="15" r="5"/>',
  transitions: '<rect x="3" y="6" width="8" height="12" rx="1.5"/><rect x="13" y="6" width="8" height="12" rx="1.5"/><path d="M9 12h6M13 10l2 2-2 2"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  sync: '<path d="M3 12h3l2-6 4 12 3-9 2 3h4"/>',
  timeline: '<path d="M3 6h18M3 12h18M3 18h18" opacity=".4"/><rect x="4" y="4" width="7" height="4" rx="1"/><rect x="9" y="10" width="9" height="4" rx="1"/><rect x="6" y="16" width="6" height="4" rx="1"/><path d="M14 2v20"/>',
  palettes: '<path d="M12 3a9 9 0 100 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 004-4c0-4.5-4-8-9-8z"/><circle cx="7.5" cy="11" r="1.3"/><circle cx="10" cy="7" r="1.3"/><circle cx="15" cy="7.5" r="1.3"/>',
  export: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  library: '<rect x="4" y="3" width="4" height="18" rx="1"/><rect x="10" y="3" width="4" height="18" rx="1"/><path d="M16.5 4.5l3.8 15.6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
};
export function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`; }
