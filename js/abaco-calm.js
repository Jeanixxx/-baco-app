/* Ábaco · modo calmado (aprobado en el canvas, pensado también para TDAH).
 *
 * Regla de cada pantalla: un dato principal, una acción, y el detalle solo cuando se pide.
 *  - Inicio "Hoy, solo tres cosas": una lista corta, calculada de tus datos, que se palomea.
 *  - Registrar en dos pasos: 1) el monto con teclado y Guardar; 2) "¿Qué fue?", opcional y sin
 *    presión: el gasto ya está guardado, "Listo" no pide nada y nunca se vuelve a preguntar.
 *  - Sobres y Tarjetas: un renglón o tarjeta por elemento; el detalle se abre en una hoja.
 *  - Menú: lo que más usas arriba; el resto plegado.
 *
 * Se carga después de app.js y de js/abaco-shell.js.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const money = (n) => '$' + (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
  const now = () => Number(window.__abacoNow) || Date.now();
  const DAY = 86400000;
  const BAR = ['inicio', 'historial', 'hormiga', 'estadisticas', 'cuentas'];
  const DEFAULT_FAV = ['ingresos', 'presupuesto', 'tarjetas', 'ahorros'];
  const label = (c) => (typeof catName === 'function' ? catName(c) : c);
  const extras = () => (window.AbacoExtrasUI ? AbacoExtrasUI.extras() : null);
  const persist = () => { try { if (typeof window.save === 'function') window.save(); } catch (e) { console.warn(e); } };
  const data = () => (window.AbacoApp ? AbacoApp.data() : null);

  const api = { menuAllOpen: false };

  /* ---------- hoja inferior propia ---------- */

  let sheet = null; // { title, hint, render() }

  function paintSheet() {
    const app = document.querySelector('.app') || document.body;
    let el = $('calmSheet');
    let scrim = $('calmScrim');
    if (!sheet) {
      if (el) el.remove();
      if (scrim) scrim.remove();
      app.classList.remove('calm-sheet-open');
      return;
    }
    if (!el) {
      scrim = document.createElement('div');
      scrim.id = 'calmScrim';
      scrim.className = 'sheet-scrim open';
      scrim.addEventListener('click', closeSheet);
      el = document.createElement('div');
      el.id = 'calmSheet';
      el.className = 'calm-sheet';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      app.appendChild(scrim);
      app.appendChild(el);
    }
    const body = sheet.render();
    if (body === null) { closeSheet(); return; } // lo que mostraba ya no existe
    el.setAttribute('aria-label', sheet.title);
    el.innerHTML = '<div class="cs-title">' + esc(sheet.title) + '</div>' + (sheet.hint ? '<div class="cs-hint">' + esc(sheet.hint) + '</div>' : '') + body;
    app.classList.add('calm-sheet-open');
  }
  function openSheet(def) { sheet = def; paintSheet(); }
  /* Se cierra deslizando hacia abajo; el id se libera enseguida para poder abrir otra. */
  function closeSheet() {
    const was = !!sheet;
    sheet = null;
    const el = $('calmSheet');
    const scrim = $('calmScrim');
    if (el) {
      el.removeAttribute('id');
      el.classList.add('closing');
      if (scrim) { scrim.removeAttribute('id'); scrim.classList.remove('open'); }
      (document.querySelector('.app') || document.body).classList.remove('calm-sheet-open');
      setTimeout(() => { el.remove(); if (scrim) scrim.remove(); }, 220);
    }
    return was;
  }
  function refreshSheet() { if (sheet) paintSheet(); }

  /* ---------- Inicio: hoy, solo tres cosas ---------- */

  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

  function todayState() {
    const e = extras();
    if (!e) return { day: '', done: [] };
    const k = dayKey(now());
    if (!e.today || e.today.day !== k) e.today = { day: k, done: [] };
    return e.today;
  }

  /* Próximo cobro de una suscripción a partir de su fecha de referencia y su ciclo. */
  function nextCharge(sub, t) {
    if (!sub || !sub.date) return null;
    const ref = new Date(String(sub.date) + 'T12:00:00');
    if (isNaN(ref)) return null;
    const today = new Date(t); today.setHours(0, 0, 0, 0);
    const step = sub.range === 'semanal' ? 7 : sub.range === 'quincenal' ? 14 : 0;
    let d = new Date(ref); d.setHours(0, 0, 0, 0);
    if (step) { while (d < today) d = new Date(d.getTime() + step * DAY); return d; }
    d = new Date(today.getFullYear(), today.getMonth(), ref.getDate());
    if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, ref.getDate());
    return d;
  }

  const whenWord = (d, t) => {
    const today = new Date(t); today.setHours(0, 0, 0, 0);
    const n = Math.round((d - today) / DAY);
    return n <= 0 ? 'Hoy' : n === 1 ? 'Mañana' : 'El ' + d.toLocaleDateString('es-MX', { weekday: 'long' });
  };

  /* Las cosas de hoy, en orden de importancia. Anotar siempre va primero; el resto, solo si aplica. */
  function homeItems() {
    const t = now();
    const e = extras();
    const start = new Date(t); start.setHours(0, 0, 0, 0);
    const hoy = (state.expenses || []).filter((x) => x.created_at >= start.getTime());
    const list = [{
      key: 'anotar', title: 'Anotar lo que gastes hoy', go: 'hormiga', auto: hoy.length > 0,
      sub: hoy.length ? (hoy.length === 1 ? '1 gasto anotado' : hoy.length + ' gastos anotados') : 'Cuando gastes algo, lo anotas en un toque'
    }];
    if (e && window.AbacoExtras && AbacoExtras.isSilent(e, t)) return list;

    // Día de pago (lo que se dijo en el tour): recordar anotar el ingreso, si aún no se anotó hoy.
    const pay = e && e.profile && e.profile.payFreq;
    const ingresoHoy = (state.incomes || []).some((x) => x.created_at >= start.getTime());
    if (pay && window.AbacoTour && AbacoTour.isPayday(pay, t) && !ingresoHoy) {
      list.push({ key: 'pago:' + dayKey(t), title: 'Hoy es día de pago', sub: 'Cuando te llegue, anótalo como ingreso', income: true });
    }

    // Lo pesado (pagar la tarjeta, cancelar algo que no usas) llega partido en pasos chiquitos.
    const F = window.AbacoFocus;
    if (F) F.tramiteItems(t).forEach((x) => list.push(x));

    const soon = [];
    for (const s of state.subscriptions || []) {
      if (s.active === false) continue;
      const d = nextCharge(s, t);
      if (d && d - start <= 2 * DAY) soon.push({ d, key: 'sub:' + s.id + ':' + dayKey(d), title: whenWord(d, t) + ' se cobra ' + s.name, sub: money(s.amount), go: 'proximos' });
    }
    if (!F) {
      for (const p of state.msiPlans || []) {
        const i = (p.installments || []).find((x) => !x.paid);
        if (!i || !i.due) continue;
        const d = new Date(i.due); d.setHours(0, 0, 0, 0);
        if (d - start <= 2 * DAY) soon.push({ d, key: 'msi:' + p.id + ':' + i.number, title: (d < start ? 'Mensualidad pendiente: ' : whenWord(d, t) + ' toca pagar ') + p.concept, sub: money(i.amount), go: 'tarjetas' });
      }
    }
    soon.sort((a, b) => a.d - b.d).forEach((s) => list.push(s));

    // Domingo (o lunes, si se pasó): la revisión de un minuto.
    if (F && e && F.sundayDue(e, t)) list.push({ key: 'domingo:' + F.sundayKey(t), title: 'Revisión de domingo', sub: 'Un minuto, tres tarjetas', tag: '1 min', focus: 'domingo' });

    const over = (state.budgets || []).map((b) => ({ c: b.category, o: (Number(b.spent) || 0) - (Number(b.amount) || 0) })).filter((b) => b.o > 0).sort((a, b) => b.o - a.o)[0];
    if (over) list.push({ key: 'sobre:' + over.c, title: 'Echar un ojo al sobre de ' + label(over.c).toLowerCase(), sub: 'va ' + money(over.o) + ' arriba, sin prisa', go: 'presupuesto' });

    if (e) {
      const letter = e.letters.find((l) => l.state === 'nueva');
      if (letter) list.push({ key: 'carta:' + letter.id, title: 'Leer tu ' + letter.title.charAt(0).toLowerCase() + letter.title.slice(1), sub: 'Escrita para ti, cuando quieras', go: 'cartas' });
      const due = window.AbacoExtras ? AbacoExtras.dueDecisions(e, t)[0] : null;
      if (due) list.push({ key: 'dec:' + due.id, title: '¿Valió la pena «' + due.title + '»?', sub: money(due.amount) + ' · tú pones la respuesta', go: 'decisiones' });
    }
    try {
      const r = typeof getOverdueReminders === 'function' ? getOverdueReminders()[0] : null;
      if (r) list.push({ key: 'rec:' + r.id, title: r.text || 'Un recordatorio', sub: 'Recordatorio', go: 'recordatorios' });
    } catch (err) { /* sin recordatorios */ }
    return list.slice(0, 3);
  }

  function renderHome(just) {
    const box = $('homeToday');
    if (!box || typeof state !== 'object') return;
    const st = todayState();
    const items = homeItems();
    const isDone = (it) => it.auto || st.done.includes(it.key);
    const allDone = items.every(isDone);
    const available = (state.financeTotals || {}).available || 0;
    const over = (state.budgets || []).some((b) => (Number(b.spent) || 0) > (Number(b.amount) || 0));
    const count = ['', 'Solo una cosa', 'Solo dos cosas', 'Solo tres cosas'][items.length];
    box.innerHTML =
      '<div class="hoy-lead">Tienes <b>' + money(available) + '</b> · ' + (over ? 'casi todo en orden' : 'vas bien') + '</div>' +
      '<div class="section-title">' + count + '</div>' +
      '<div class="hoy-list">' + items.map((it) => {
        const done = isDone(it);
        return '<div class="hoy-row' + (done ? ' done' : '') + (it.key === just ? ' just' : '') + '">' +
          '<button type="button" class="hoy-check" data-calm="check" data-k="' + esc(it.key) + '" aria-pressed="' + done + '" aria-label="' + (done ? 'Desmarcar' : 'Marcar como hecho') + ': ' + esc(it.title) + '">' +
          (done ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>' : '') + '</button>' +
          '<button type="button" class="hoy-text" ' + (it.income ? 'data-calm="go-income"' : it.focus === 'domingo' ? 'data-fx="domingo"' : it.focus ? 'data-fx="tramite" data-kind="' + it.focus + '" data-id="' + esc(it.id) + '"' : 'data-go="' + it.go + '"') + '><span class="ht">' + esc(it.title) + '</span><span class="hs">' + esc(it.sub) + '</span></button>' +
          (it.tag && !done ? '<span class="hoy-tag">' + esc(it.tag) + '</span>' : '') + '</div>';
      }).join('') + '</div>' +
      '<div class="hoy-end">' + (allDone ? 'Listo por hoy. Aquí no hay nada más pendiente.' : 'Cuando termines, aquí no hay nada más pendiente.') + '</div>' +
      '<button type="button" class="btn btn-primary hoy-add" data-go="hormiga">＋ Anotar un gasto</button>';
  }

  function toggleCheck(key) {
    const st = todayState();
    const it = homeItems().find((x) => x.key === key);
    if (!it) return;
    const i = st.done.indexOf(key);
    if (i >= 0) st.done.splice(i, 1);
    else if (!it.auto) st.done.push(key);
    persist();
    renderHome(key);
  }

  /* ---------- Registrar: paso 1 (monto) y paso 2 opcional ---------- */

  function typeKey(k) {
    const input = $('hormAmount');
    if (!input) return;
    let v = String(input.value || '');
    if (k === 'del') v = v.slice(0, -1);
    else if (k === '.') { if (!v.includes('.')) v = (v || '0') + '.'; }
    else {
      const [, dec] = v.split('.');
      if (dec != null && dec.length >= 2) return;
      if (v.replace('.', '').length >= 9) return;
      v = v === '0' ? k : v + k;
    }
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function toggleMore(force) {
    const box = $('regMore');
    const btn = $('regMoreBtn');
    if (!box || !btn) return;
    const open = typeof force === 'boolean' ? force : box.classList.contains('hidden');
    box.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Ocultar opciones ⌃' : 'Más opciones ›';
  }

  /* Las tres categorías que más usas (sin "general"); si faltan, las de siempre. */
  function topCategories() {
    const count = {};
    for (const x of state.expenses || []) if (x.category && x.category !== 'general') count[x.category] = (count[x.category] || 0) + 1;
    const ids = Object.keys(count).sort((a, b) => count[b] - count[a]);
    for (const d of ['comida', 'transporte', 'hogar', 'ocio', 'salud']) if (!ids.includes(d)) ids.push(d);
    const known = new Set((state.categories || []).map((c) => c.id));
    return ids.filter((c) => known.has(c)).slice(0, 3);
  }

  let step2 = null; // { id, amount, category, kind }
  let mode = 'gasto'; // Registrar anota gastos o ingresos

  const INCOME_TYPES = [['salario', 'Salario'], ['freelance', 'Freelance'], ['extra', 'Extra'], ['otro', 'Otro']];

  /* Cambia Registrar entre gasto e ingreso: misma pantalla, distintas palabras. */
  function setMode(next) {
    mode = next === 'ingreso' ? 'ingreso' : 'gasto';
    const panel = $('panel-hormiga');
    if (panel) panel.classList.toggle('mode-ingreso', mode === 'ingreso');
    document.querySelectorAll('#regStep1 [data-calm="mode"]').forEach((b) => {
      const on = b.dataset.v === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    const ing = mode === 'ingreso';
    if ($('regQ')) $('regQ').textContent = ing ? '¿Cuánto te entró?' : '¿Cuánto gastaste?';
    if ($('regAccountLabel')) $('regAccountLabel').textContent = ing ? 'Llega a' : 'Sale de';
    if ($('hormDesc')) $('hormDesc').placeholder = ing ? 'Quincena, venta, regalo…' : 'Antojo, súper, pasaje…';
    if ($('btnRegSave')) $('btnRegSave').textContent = ing ? 'Guardar ingreso' : 'Guardar';
  }

  function save() {
    if (mode === 'ingreso') { if (typeof registerQuickIncome === 'function') registerQuickIncome(); }
    else if (typeof registerHormiga === 'function') registerHormiga();
  }

  function afterSave(entry, info, kind) {
    toggleMore(false);
    const amount = Number(info && info.amount) || 0;
    const k = kind === 'ingreso' ? 'ingreso' : 'gasto';
    // Si ya dijo qué fue en "Más opciones", no hay nada que preguntar.
    if (!entry || !entry.id || (info && info.description)) { toast(k === 'ingreso' ? '✓ Ingreso guardado' : '✓ Gasto guardado'); return; }
    step2 = { id: entry.id, amount, category: null, kind: k };
    paintStep2();
  }

  function paintStep2() {
    const s1 = $('regStep1');
    const s2 = $('regStep2');
    if (!s1 || !s2) return;
    if (!step2) { s2.classList.add('hidden'); s2.innerHTML = ''; s1.classList.remove('hidden'); return; }
    const e = extras();
    const ing = step2.kind === 'ingreso';
    const big = !ing && e && step2.amount >= e.prefs.bigAmount;
    const options = ing ? INCOME_TYPES : topCategories().map((c) => [c, label(c)]);
    s1.classList.add('hidden');
    s2.classList.remove('hidden');
    s2.innerHTML =
      '<div class="reg-saved"><span class="rs-ok"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg></span>' +
      '<div><b>Guardado: ' + money(step2.amount) + '</b><small>Ya está en tus movimientos</small></div></div>' +
      '<div class="reg2-q">' + (ing ? '¿De qué fue?' : '¿Qué fue?') + ' <span>si quieres</span></div>' +
      '<div class="reg2-chips">' + options.map(([c, t]) => '<button type="button" class="reg2-chip' + (step2.category === c ? ' on' : '') + '" data-calm="cat" data-v="' + esc(c) + '" aria-pressed="' + (step2.category === c) + '">' + esc(t) + '</button>').join('') + '</div>' +
      '<input type="text" id="regNote" placeholder="' + (big ? '¿Por qué lo compraste? (si quieres)' : 'Una nota (si quieres)') + '" aria-label="Nota">' +
      '<button type="button" class="btn btn-primary" data-calm="reg-done">Listo</button>' +
      '<div class="reg2-free">Puedes dejarlo así: ya está guardado.</div>';
  }

  async function setCategory(cat) {
    if (!step2) return;
    step2.category = cat;
    paintStep2();
    const d = data();
    if (!d) return;
    const r = await d.annotate(step2.id, step2.kind === 'ingreso' ? { incomeType: cat } : { category: cat });
    if (r.ok) AbacoApp.refreshUI();
  }

  /* Guarda la nota (si hay) y vuelve al paso 1. Nunca insiste. */
  async function finishStep2() {
    if (!step2) return;
    const note = ($('regNote') && $('regNote').value.trim()) || '';
    const cur = step2;
    step2 = null;
    paintStep2();
    if (note) {
      const d = data();
      if (d) { const r = await d.annotate(cur.id, { description: note }); if (r.ok) AbacoApp.refreshUI(); }
      const e = extras();
      if (e && window.AbacoExtras && cur.kind !== 'ingreso' && cur.amount >= e.prefs.bigAmount) {
        AbacoExtras.addDecision(e, { title: label(cur.category || 'general'), amount: cur.amount, reason: note, now: now() });
        persist();
      }
    }
  }

  /* ---------- Sobres ---------- */

  const ring = (pct, cls) => '<span class="calm-ring ' + cls + '" style="--p:' + Math.max(0, Math.min(100, pct)) + '%"></span>';

  function renderSobres() {
    const list = $('budgetList');
    const lead = $('sobresLead');
    if (!list) return;
    const items = (state.budgets || []).filter((b) => !b.period || b.period === 'mensual');
    const planned = items.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const spent = items.reduce((s, b) => s + (Number(b.spent) || 0), 0);
    if (lead) {
      lead.innerHTML = !items.length ? 'Aún no tienes sobres. Crea uno para apartar dinero por tema.'
        : planned - spent >= 0 ? 'Te quedan <b>' + money(planned - spent) + '</b> de lo que planeaste este mes.'
          : 'Este mes ya usaste lo que planeaste. Puedes ajustar un sobre si hace falta.';
    }
    list.innerHTML = items.length ? '<div class="calm-list">' + items.map((b) => {
      const left = (Number(b.amount) || 0) - (Number(b.spent) || 0);
      const pct = b.amount ? Math.round(((Number(b.spent) || 0) / b.amount) * 100) : 0;
      return '<button type="button" class="calm-row" data-calm="sobre" data-id="' + esc(b.id) + '">' + ring(pct, left < 0 ? 'warn' : '') +
        '<span class="cr-body"><span class="cr-title">' + esc(label(b.category)) + '</span><span class="cr-sub">' +
        (left < 0 ? money(-left) + ' por encima · toca para ver' : 'Te quedan ' + money(left)) + '</span></span><span class="cr-chev">›</span></button>';
    }).join('') + '</div>' : '';
    refreshSheet();
  }

  function sobreSheet(id) {
    openSheet({
      title: '', hint: '',
      render() {
        const b = (state.budgets || []).find((x) => x.id === id);
        if (!b) return null;
        this.title = label(b.category);
        const left = (Number(b.amount) || 0) - (Number(b.spent) || 0);
        const pct = b.amount ? Math.round(((Number(b.spent) || 0) / b.amount) * 100) : 0;
        return '<div class="cs-figure">' + ring(pct, 'big' + (left < 0 ? ' warn' : '')) + '<div><div class="cs-big">' + money(b.spent) + '</div><div class="cs-small">de ' + money(b.amount) + ' planeados</div></div></div>' +
          '<p class="cs-text">' + (left < 0 ? 'Vas ' + money(-left) + ' por encima. Si quieres, puedes tomar de otro sobre que tenga dinero.' : 'Te quedan ' + money(left) + ' en este sobre.') + '</p>' +
          '<div class="cs-actions"><button type="button" class="btn btn-primary" data-x="borrow">Pedir prestado de otro sobre</button>' +
          '<button type="button" class="btn btn-ghost" data-calm="sobre-plan" data-id="' + esc(b.id) + '">Cambiar lo planeado</button>' +
          '<button type="button" class="btn btn-ghost cs-danger" data-budget-del="' + esc(b.id) + '">Quitar sobre</button></div>';
      }
    });
  }

  async function changePlan(id) {
    const b = (state.budgets || []).find((x) => x.id === id);
    if (!b || typeof askFields !== 'function') return;
    const f = await askFields({ title: 'Cambiar lo planeado', body: label(b.category), confirmLabel: 'Guardar', fields: [{ id: 'amount', label: 'Monto del sobre $', type: 'number', inputmode: 'decimal', value: String(b.amount || 0) }] });
    if (!f) return;
    const r = await data().setBudget({ category: b.category, amount: f.amount, description: b.description });
    if (!r.ok) { toast(r.error); return; }
    AbacoApp.refreshUI();
    toast('Listo');
  }

  /* ---------- Tarjetas ---------- */

  function nextPayment(card) {
    let best = null;
    for (const p of (state.msiPlans || []).filter((x) => x.cardId === card.id)) {
      const i = (p.installments || []).find((x) => !x.paid);
      if (i && (!best || new Date(i.due) < new Date(best.due))) best = { ...i, concept: p.concept };
    }
    return best;
  }

  function renderTarjetas() {
    const list = $('cardList');
    if (!list) return;
    if (!(state.cards || []).length) { list.innerHTML = '<div class="calm-empty">Aún no tienes tarjetas. Agrega una cuando quieras.</div>'; refreshSheet(); return; }
    list.innerHTML = state.cards.map((c, i) => {
      const n = nextPayment(c);
      const fecha = n && n.due ? new Date(n.due).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }) : '';
      const [lab, amt, when] = n ? ['Siguiente pago', money(n.amount), 'el ' + fecha + ' · toca para ver el plan']
        : (Number(c.balance) || 0) > 0 ? ['Debes', money(c.balance), 'Sin mensualidades pendientes'] : ['Sin pagos pendientes', '$0', 'Todo al día'];
      return '<button type="button" class="calm-card tone' + (i % 3) + '" data-calm="tarjeta" data-id="' + esc(c.id) + '">' +
        '<span class="cc-top"><span>' + esc(c.name) + '</span><span class="cc-kind">' + esc(c.type || 'crédito') + '</span></span>' +
        '<span class="cc-lab">' + lab + '</span><span class="cc-amt">' + amt + '</span><span class="cc-when">' + when + '</span></button>';
    }).join('');
    refreshSheet();
  }

  function tarjetaSheet(id) {
    openSheet({
      title: '', hint: 'Plan y acciones',
      render() {
        const c = (state.cards || []).find((x) => x.id === id);
        if (!c || typeof cardDetailHtml !== 'function') return null;
        this.title = c.name;
        return '<div class="cs-card-detail">' + cardDetailHtml(c) + '</div>';
      }
    });
  }

  /* ---------- Deudas: lo que debo y lo que me deben ---------- */

  let debtPane = 'debo';

  function setDebtPane(v) {
    debtPane = v === 'cobrar' ? 'cobrar' : 'debo';
    const panel = $('panel-prestamos');
    if (panel) panel.dataset.pane = debtPane;
    document.querySelectorAll('#panel-prestamos [data-calm="debts"]').forEach((b) => {
      const on = b.dataset.v === debtPane;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    renderDebtLeads();
  }

  function renderDebtLeads() {
    const debo = (state.loans || []).filter((l) => !l.paid).reduce((s, l) => s + (Number(l.current) || 0), 0);
    const cobrar = (state.debtors || []).filter((d) => !d.settled).reduce((s, d) => s + (Number(d.remaining) || 0), 0);
    if ($('debtLeadDebo')) $('debtLeadDebo').innerHTML = debo > 0 ? 'Debes <b>' + money(debo) + '</b> en total.' : 'No debes nada por ahora.';
    if ($('debtLeadCobrar')) $('debtLeadCobrar').innerHTML = cobrar > 0 ? 'Te deben <b>' + money(cobrar) + '</b> en total.' : 'Nadie te debe por ahora.';
  }

  /* ---------- Menú ---------- */

  function usage() { try { return JSON.parse(localStorage.getItem('nav_usage') || '{}') || {}; } catch (e) { return {}; } }

  function favorites() {
    const u = usage();
    const known = new Set((typeof MENU_GROUPS !== 'undefined' ? MENU_GROUPS : []).flatMap((g) => g.items));
    const ranked = Object.keys(u).filter((k) => known.has(k) && !BAR.includes(k)).sort((a, b) => u[b] - u[a]);
    for (const d of DEFAULT_FAV) if (!ranked.includes(d)) ranked.push(d);
    return ranked.slice(0, 4);
  }

  function countUse(name) {
    if (BAR.includes(name)) return;
    const u = usage();
    u[name] = (u[name] || 0) + 1;
    try { localStorage.setItem('nav_usage', JSON.stringify(u)); } catch (e) { /* sin almacenamiento */ }
  }

  /* ---------- eventos ---------- */

  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;
    const key = t.closest('#regPad [data-key]');
    if (key) { typeKey(key.dataset.key); return; }
    if (t.closest('#btnRegSave')) { save(); return; }
    if (t.closest('#regMoreBtn')) { toggleMore(); return; }
    if (t.closest('#btnNewSobre')) { if (typeof openBudgetEntry === 'function') openBudgetEntry(); return; }
    if (t.closest('#btnNewCard')) { if (typeof openOpForm === 'function') openOpForm('cardFormPanel'); return; }
    if (t.closest('#menuAllToggle')) { api.menuAllOpen = !api.menuAllOpen; if (typeof renderMenu === 'function') renderMenu(); return; }
    if (t.closest('#btnCalcMenu')) { if (typeof closeMenu === 'function') closeMenu(); if (typeof openCalc === 'function') openCalc(); return; }
    const el = t.closest('[data-calm]');
    if (!el) return;
    const a = el.dataset.calm;
    if (a === 'close') closeSheet();
    else if (a === 'mode') setMode(el.dataset.v);
    else if (a === 'debts') setDebtPane(el.dataset.v);
    else if (a === 'go-income') { setMode('ingreso'); if (typeof goPanel === 'function') goPanel('hormiga'); }
    else if (a === 'check') toggleCheck(el.dataset.k);
    else if (a === 'cat') setCategory(el.dataset.v);
    else if (a === 'reg-done') finishStep2();
    else if (a === 'sobre') sobreSheet(el.dataset.id);
    else if (a === 'sobre-plan') changePlan(el.dataset.id);
    else if (a === 'tarjeta') tarjetaSheet(el.dataset.id);
  });

  /* "Volver" de Android cierra primero la hoja calmada. */
  (function wrapBack() {
    const prev = window.handleAndroidBack;
    if (typeof prev !== 'function' || prev.__calm) return;
    window.handleAndroidBack = function () { if (closeSheet()) return; return prev.apply(this, arguments); };
    window.handleAndroidBack.__calm = true;
  })();

  function onPanel(name) {
    countUse(name);
    closeSheet();
    if (name !== 'hormiga' && step2) finishStep2();
    if (name !== 'hormiga') setMode('gasto'); // al volver a Registrar, empieza en gasto (lo más común)
    if (name === 'inicio') renderHome();
    if (name === 'prestamos') renderDebtLeads();
  }

  function afterRefresh() {
    if (typeof state !== 'object') return;
    if (state.activePanel === 'inicio') renderHome();
    if (state.activePanel === 'prestamos') renderDebtLeads();
    refreshSheet();
  }

  Object.assign(api, {
    onPanel, afterRefresh, afterSave, renderHome, renderSobres, renderTarjetas, favorites, homeItems, nextCharge,
    openSheet, closeSheet, refreshSheet, typeKey, setMode, mode: () => mode, setDebtPane
  });
  /* "Agregar ingreso" (pantalla Ingresos) lleva a Registrar en modo ingreso: un solo lugar para anotar. */
  const incBtn = $('btnOpenIncForm');
  if (incBtn) incBtn.onclick = () => { setMode('ingreso'); if (typeof goPanel === 'function') goPanel('hormiga'); };
  window.AbacoCalm = api;
})();
