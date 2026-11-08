/* Ábaco · herramientas para TDAH (aprobadas en el canvas).
 *
 *  1. Volver sin culpa: si pasaron 7 días o más sin abrir Ábaco, no se pide anotar lo atrasado.
 *     Se pregunta cuánto hay hoy en cada cuenta y la diferencia queda como «sin detalle».
 *  4. Trámites en pasos: lo pesado (pagar la tarjeta, cancelar una suscripción) aparece en Hoy
 *     partido en pasos chiquitos, uno por pantalla, con temporizador opcional y «lo sigo después».
 *  5. Lo que viene: cada cobro con una barra que se llena mientras se acerca, y la pregunta
 *     «¿lo usaste?» para no seguir pagando lo que se olvidó.
 *  6. Constancia: días anotando en el mes; los días sin anotar no borran nada.
 *  7. Revisión de domingo: tres tarjetas (lo mejor, en qué se fue más, un objetivo pequeño).
 *
 * La parte de cálculo no toca el documento y se prueba sin navegador (module.exports).
 * Los datos propios viven en state.extras: lastSeen, tramites, subUse, sundays, returns.
 */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const RETURN_DAYS = 7;
  const money = (n) => '$' + (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

  /* ---------- cálculo (puro) ---------- */

  /* Días completos entre la última visita y ahora. */
  function daysAway(lastSeen, now) {
    if (!(Number(lastSeen) > 0)) return 0;
    return Math.floor((startOfDay(now) - startOfDay(lastSeen)) / DAY);
  }

  const shouldWelcomeBack = (lastSeen, now) => daysAway(lastSeen, now) >= RETURN_DAYS;

  /* Próximo cobro de una suscripción (misma regla que Hoy). */
  function nextCharge(sub, t) {
    if (!sub || !sub.date) return null;
    const ref = new Date(String(sub.date) + 'T12:00:00');
    if (isNaN(ref)) return null;
    const today = new Date(startOfDay(t));
    const step = sub.range === 'semanal' ? 7 : sub.range === 'quincenal' ? 14 : 0;
    let d = new Date(ref); d.setHours(0, 0, 0, 0);
    if (step) { while (d < today) d = new Date(d.getTime() + step * DAY); return d; }
    d = new Date(today.getFullYear(), today.getMonth(), ref.getDate());
    if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, ref.getDate());
    return d;
  }

  /* Cobros de los próximos `horizon` días: suscripciones activas y mensualidades a meses.
   * fill: 0..100, se llena mientras se acerca (100 = hoy). */
  function upcoming(st, t, horizon = 31) {
    const today = startOfDay(t);
    const out = [];
    for (const s of st.subscriptions || []) {
      if (s.active === false) continue;
      const d = nextCharge(s, t);
      if (!d) continue;
      const days = Math.round((d.getTime() - today) / DAY);
      if (days <= horizon) out.push({ kind: 'sub', id: s.id, name: s.name, amount: Number(s.amount) || 0, at: d.getTime(), days });
    }
    for (const p of st.msiPlans || []) {
      const i = (p.installments || []).find((x) => !x.paid);
      if (!i || !i.due) continue;
      const at = startOfDay(new Date(i.due).getTime());
      const days = Math.round((at - today) / DAY);
      if (days <= horizon) out.push({ kind: 'msi', id: p.id, cardId: p.cardId, name: p.concept, amount: Number(i.amount) || 0, at, days, number: i.number });
    }
    return out.sort((a, b) => a.days - b.days).map((c) => ({ ...c, fill: Math.max(4, Math.min(100, Math.round((1 - Math.max(0, c.days) / 30) * 100))) }));
  }

  const daysWord = (n) => (n < 0 ? 'atrasado' : n === 0 ? 'hoy' : n === 1 ? 'mañana' : 'en ' + n + ' días');

  /* Días distintos del mes con al menos un movimiento anotado. */
  function monthDays(st, t) {
    const d = new Date(t);
    const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const set = new Set();
    for (const x of [...(st.expenses || []), ...(st.incomes || [])]) {
      if (x.created_at >= from && x.created_at < to) set.add(new Date(x.created_at).getDate());
    }
    return set;
  }

  /* Constancia del mes y el mejor mes anterior (en días anotados). */
  function constancy(st, t) {
    const days = monthDays(st, t);
    const d = new Date(t);
    let best = 0;
    for (let k = 1; k <= 12; k++) best = Math.max(best, monthDays(st, new Date(d.getFullYear(), d.getMonth() - k, 15).getTime()).size);
    const total = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return { days, count: days.size, best, total, today: d.getDate(), record: days.size > 0 && days.size >= best };
  }

  /* Gastos de los 7 días que terminan hoy y de los 7 anteriores, por categoría. */
  function weekSummary(st, t) {
    const end = startOfDay(t) + DAY;
    const sum = (from, to) => {
      const byCat = {};
      let total = 0;
      let count = 0;
      for (const x of st.expenses || []) {
        if (x.created_at >= from && x.created_at < to) {
          const a = Number(x.amount) || 0;
          total += a; count++;
          const c = x.category || 'general';
          byCat[c] = byCat[c] || { total: 0, count: 0 };
          byCat[c].total += a; byCat[c].count++;
        }
      }
      return { total, count, byCat };
    };
    const now = sum(end - 7 * DAY, end);
    const prev = sum(end - 14 * DAY, end - 7 * DAY);
    const top = Object.entries(now.byCat).sort((a, b) => b[1].total - a[1].total).map(([c, v]) => ({ category: c, total: v.total, count: v.count }));
    // La categoría que más bajó respecto a la semana pasada (lo mejor de la semana).
    let improved = null;
    for (const [c, v] of Object.entries(prev.byCat)) {
      const cur = now.byCat[c] || { total: 0, count: 0 };
      const drop = v.total - cur.total;
      if (drop > 0 && (!improved || drop > improved.drop)) improved = { category: c, drop, before: v.count, after: cur.count };
    }
    return { total: now.total, count: now.count, prevTotal: prev.total, top, improved };
  }

  /* Objetivos pequeños según en qué se fue más. Siempre se puede elegir «nada». */
  function goalsFor(category) {
    const by = {
      transporte: 'Usar transporte público 2 veces', comida: 'Llevar comida 1 día', ocio: 'Un plan gratis esta semana',
      hogar: 'Apagar lo que no uses', salud: 'Comparar precio en otra farmacia', general: 'Anotar 4 días de 7'
    };
    const first = by[category] || by.general;
    const list = [first];
    for (const g of ['Anotar 4 días de 7', 'Llevar comida 1 día', 'Esperar un día antes de comprar algo']) if (!list.includes(g) && list.length < 2) list.push(g);
    list.push('Esta semana, nada');
    return list;
  }

  /* Domingo de la semana de `t` (el mismo día si es domingo; el anterior si es lunes). */
  function sundayKey(t) {
    const d = new Date(startOfDay(t));
    d.setDate(d.getDate() - d.getDay());
    return dayKey(d.getTime());
  }
  /* La revisión aparece el domingo y, si no se hizo, también el lunes. */
  function sundayDue(extras, t) {
    const wd = new Date(t).getDay();
    if (wd !== 0 && wd !== 1) return false;
    const k = sundayKey(t);
    return !((extras && extras.sundays) || []).some((s) => s.week === k);
  }

  /* Diferencias para quedar al día: lo que dice la persona contra lo que Ábaco tenía. */
  function reconcile(accounts, answers) {
    const out = [];
    for (const a of accounts) {
      const v = answers[a.id];
      if (v == null || v === '' || !Number.isFinite(Number(v))) continue;
      const diff = Math.round((Number(v) - (Number(a.balance) || 0)) * 100) / 100;
      if (Math.abs(diff) >= 0.01) out.push({ accountId: a.id, name: a.name, before: Number(a.balance) || 0, after: Number(v), diff });
    }
    return out;
  }

  /* Trámites: pasos chiquitos con lo que hace falta en cada uno. */
  const TRAMITES = {
    tarjeta: (ctx) => ({
      title: 'Pagar la tarjeta ' + ctx.name,
      done: 'Tarjeta pagada',
      steps: [
        { t: 'Abre la app de tu banco', d: 'Solo ábrela. Todavía no tienes que pagar nada.' },
        { t: 'Busca «Pago para no generar intereses»', d: 'Está en tu tarjeta, casi siempre arriba. Solo búscalo, todavía no pagues.', input: 'amount' },
        { t: 'Haz el pago en tu banco', d: 'Págalo desde tu cuenta. Aquí elige de cuál salió el dinero.', input: 'account' },
        { t: 'Confírmalo aquí', d: 'Al tocar «Hecho» anoto el pago y ya no aparece en Hoy.' }
      ]
    }),
    cancelar: (ctx) => ({
      title: 'Cancelar ' + ctx.name,
      done: ctx.name + ' cancelada',
      steps: [
        { t: 'Abre la app o la página de ' + ctx.name, d: 'Entra con tu cuenta. Nada más.' },
        { t: 'Busca «Cancelar suscripción»', d: 'Suele estar en Cuenta, Perfil o Ajustes. A veces dice «Administrar plan».' },
        { t: 'Confirma la cancelación', d: 'Si te ofrecen un descuento para quedarte, tú decides. Sin presión.' },
        { t: 'Márcalo aquí', d: 'Al tocar «Hecho» la quito de tus cobros.' }
      ]
    })
  };

  const pure = { daysAway, shouldWelcomeBack, nextCharge, upcoming, daysWord, constancy, weekSummary, goalsFor, sundayKey, sundayDue, reconcile, TRAMITES, RETURN_DAYS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }

  /* =====================================================================
   * Interfaz
   * ===================================================================== */

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const now = () => Number(root.__abacoNow) || Date.now();
  const ex = () => (root.AbacoExtrasUI ? AbacoExtrasUI.extras() : null);
  const persist = () => { try { if (typeof root.save === 'function') root.save(); } catch (e) { console.warn(e); } };
  const data = () => root.AbacoApp.data();
  const catLabel = (c) => (typeof catName === 'function' ? catName(c) : c);
  const liquid = () => (state.accounts || []).filter((a) => a.kind !== 'credit' && !a.internal && !a.archived);
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>';

  function store() {
    const e = ex();
    if (!e) return null;
    if (!e.tramites || typeof e.tramites !== 'object') e.tramites = {};
    if (!e.subUse || typeof e.subUse !== 'object') e.subUse = {};
    if (!Array.isArray(e.sundays)) e.sundays = [];
    if (!Array.isArray(e.returns)) e.returns = [];
    return e;
  }

  /* ---------- pantalla completa (un flujo a la vez) ---------- */

  let flow = null; // { kind, render(), ... }
  let timer = null;

  function paint() {
    let el = $('focusFlow');
    if (!flow) { if (el) el.remove(); document.body.classList.remove('focus-open'); stopTimer(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'focusFlow';
      el.className = 'fx-flow';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      (document.querySelector('.app') || document.body).appendChild(el);
    }
    el.innerHTML = '<div class="fx-inner' + (flow.anim ? ' ' + flow.anim : '') + '">' + flow.render() + '</div>';
    flow.anim = 'fx-step';
    document.body.classList.add('focus-open');
    if (flow.afterPaint) flow.afterPaint(el);
  }
  function open(def) { flow = Object.assign({ anim: 'fx-in' }, def); paint(); }
  function close() { const was = !!flow; flow = null; paint(); if (was && root.AbacoApp) AbacoApp.refreshUI(); return was; }

  const dots = (n, on) => '<div class="fx-dots" aria-hidden="true">' + Array.from({ length: n }, (_, i) => '<span class="' + (i === on ? 'on' : i < on ? 'past' : '') + '"></span>').join('') + '</div>';
  const okCircle = () => '<div class="fx-ok">' + CHECK + '</div>';
  const pad = () => '<div class="reg-pad fx-pad">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => '<button type="button" data-fx="key" data-k="' + k + '" aria-label="' + (k === '⌫' ? 'Borrar' : k) + '">' + k + '</button>').join('') + '</div>';

  function typeInto(cur, k) {
    let v = String(cur || '');
    if (k === '⌫') return v.slice(0, -1);
    if (k === '.' && v.includes('.')) return v;
    if (v.includes('.') && v.split('.')[1].length >= 2) return v;
    if (v.replace('.', '').length >= 9) return v;
    if (v === '0' && k !== '.') v = '';
    return (v === '' && k === '.') ? '0.' : v + k;
  }

  /* ---------- 1 · Volver sin culpa ---------- */

  function checkReturn() {
    const e = store();
    if (!e || typeof state !== 'object' || !state.user_id) return false;
    const t = now();
    const last = Number(e.lastSeen) || 0;
    e.lastSeen = t;
    persist();
    const tourOpen = $('onboarding') && !$('onboarding').classList.contains('hidden') && $('onboarding').offsetParent !== null;
    if (!last || tourOpen || flow || !shouldWelcomeBack(last, t) || !liquid().length) return false;
    startReturn(daysAway(last, t), last);
    return true;
  }

  function startReturn(days, since) {
    const accounts = liquid();
    const answers = {};
    let i = -1; // -1 = bienvenida
    let result = null;
    open({
      kind: 'volver',
      render() {
        if (result) {
          const lost = result.filter((r) => r.diff < 0).reduce((s, r) => s - r.diff, 0);
          const found = result.filter((r) => r.diff > 0).reduce((s, r) => s + r.diff, 0);
          const from = new Date(since).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
          const to = new Date(now()).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
          const line = !result.length ? 'Todo cuadraba. No hubo nada que ajustar.'
            : (lost ? 'La diferencia de <b>' + money(lost) + '</b> quedó como «gastos sin detalle» del ' + esc(from) + ' al ' + esc(to) + '. No hace falta explicarla.' : '') +
              (found ? (lost ? ' ' : '') + 'Apareció <b>' + money(found) + '</b> de más: quedó como «ingresos sin detalle».' : '');
          return '<div class="fx-center">' + okCircle() + '<h2 class="fx-h">Al día</h2><p class="fx-p">' + line + '</p></div>' +
            '<div class="fx-card fx-list">' + liquid().map((a) => '<div class="fx-row"><span>' + esc(a.name) + '</span><b>' + money(a.balance) + '</b></div>').join('') + '</div>' +
            '<button type="button" class="btn btn-primary fx-main" data-fx="close" data-go-after="inicio">Ir a Hoy</button>' +
            '<p class="fx-note">Si un día recuerdas en qué se fue, puedes ponerle nombre desde Movimientos.</p>';
        }
        if (i < 0) {
          return '<div class="fx-center fx-top"><h2 class="fx-h">Qué bueno verte</h2>' +
            '<p class="fx-p">Pasaron ' + days + ' días. No hace falta anotar lo que pasó: con saber cuánto tienes hoy, quedamos al día.</p></div>' +
            '<div class="fx-card hi fx-badge"><span class="fx-emoji" aria-hidden="true">⏱</span><div><b>Unos 30 segundos</b><small>Una pregunta por cuenta. ' + (accounts.length === 1 ? 'Es 1.' : 'Son ' + accounts.length + '.') + '</small></div></div>' +
            '<button type="button" class="btn btn-primary fx-main" data-fx="ret-start">Ponerme al día</button>' +
            '<button type="button" class="fx-link" data-fx="close">Ahora no, solo quiero ver</button>';
        }
        const a = accounts[i];
        const v = answers[a.id];
        return dots(accounts.length, i) +
          '<div class="fx-center"><div class="fx-q">¿Cuánto tienes hoy en ' + esc(a.name) + '?</div>' +
          '<div class="fx-amount" id="fxAmount">' + (v != null && v !== '' ? money(v) : '<span class="fx-ph">$0</span>') + '</div>' +
          '<div class="fx-sub">Ábaco tenía ' + money(a.balance) + ' · no pasa nada si no cuadra</div></div>' + pad() +
          '<button type="button" class="btn btn-primary fx-main" data-fx="ret-next">' + (i === accounts.length - 1 ? 'Listo' : 'Siguiente') + '</button>' +
          '<button type="button" class="fx-link" data-fx="ret-skip">No sé, déjalo igual</button>';
      },
      key(k) { if (i < 0 || result) return; const a = accounts[i]; answers[a.id] = typeInto(answers[a.id], k); paint(); },
      start() { i = 0; paint(); },
      async next(skip) {
        if (skip) delete answers[accounts[i].id];
        if (i < accounts.length - 1) { i++; paint(); return; }
        const diffs = reconcile(accounts, answers);
        const at = now();
        for (const d of diffs) {
          const r = d.diff < 0
            ? await data().expense({ amount: -d.diff, description: 'Gastos sin detalle', category: 'general', accountId: d.accountId, source: 'ajuste', at })
            : await data().income({ amount: d.diff, description: 'Ingresos sin detalle', type: 'otro', accountId: d.accountId, at });
          if (!r.ok) { toast('No pude ajustar ' + d.name + ': ' + r.error); return; }
        }
        const e = store();
        e.returns.push({ at, days, diffs: diffs.map((d) => ({ accountId: d.accountId, diff: d.diff })) });
        persist();
        if (root.AbacoApp) AbacoApp.refreshUI();
        result = diffs;
        paint();
      }
    });
  }

  /* ---------- 4 · Trámites en pasos ---------- */

  /* Trámites pendientes que deben aparecer en Hoy (los más urgentes primero). */
  function tramiteItems(t) {
    const e = store();
    const out = [];
    const today = startOfDay(t);
    for (const c of state.cards || []) {
      const due = dueInstallments(c.id, t, 7);
      if (!due.length) continue;
      const first = Math.min(...due.map((d) => d.at));
      const n = Math.round((first - today) / DAY);
      const when = n < 0 ? 'ya venció, sin culpa' : n === 0 ? 'vence hoy' : n === 1 ? 'vence mañana' : 'vence el ' + new Date(first).toLocaleDateString('es-MX', { weekday: 'long' });
      const saved = e && e.tramites['tarjeta:' + c.id];
      out.push({ d: first, key: 'tram:tarjeta:' + c.id, title: 'Pagar la tarjeta ' + c.name, sub: when + ' · ' + (saved ? 'vas en el paso ' + (saved.step + 1) : 'unos 6 minutos'), tag: '4 pasitos', focus: 'tarjeta', id: c.id });
    }
    for (const s of state.subscriptions || []) {
      if (s.active === false) continue;
      const use = e && e.subUse[s.id];
      if (!use || use.answer !== 'no') continue;
      const d = nextCharge(s, t);
      out.push({ d: d ? d.getTime() : t, key: 'tram:cancelar:' + s.id, title: 'Cancelar ' + s.name, sub: (d ? 'antes del ' + d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }) : 'cuando puedas') + ' · unos 5 minutos', tag: '4 pasitos', focus: 'cancelar', id: s.id });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /* Mensualidades sin pagar de una tarjeta que vencen dentro de `within` días (o ya vencieron). */
  function dueInstallments(cardId, t, within) {
    const limit = startOfDay(t) + (within + 1) * DAY;
    const out = [];
    for (const p of (state.msiPlans || []).filter((x) => x.cardId === cardId)) {
      for (const i of p.installments || []) {
        if (i.paid || !i.due) continue;
        const at = startOfDay(new Date(i.due).getTime());
        if (at < limit) out.push({ planId: p.id, number: i.number, amount: Number(i.amount) || 0, at });
      }
    }
    return out;
  }

  function startTramite(kind, id) {
    const e = store();
    const src = kind === 'tarjeta' ? (state.cards || []).find((c) => c.id === id) : (state.subscriptions || []).find((s) => s.id === id);
    if (!src || !TRAMITES[kind]) return;
    const def = TRAMITES[kind]({ name: src.name });
    const key = kind + ':' + id;
    const prog = e.tramites[key] || { step: 0, startedAt: now() };
    const due = kind === 'tarjeta' ? dueInstallments(id, now(), 7) : [];
    const total = Math.round(due.reduce((s, d) => s + d.amount, 0) * 100) / 100;
    if (prog.amount == null && total) prog.amount = String(total);
    // Por defecto, la cuenta con más saldo (la que más probablemente alcanza para el pago).
    if (!prog.accountId && liquid().length) prog.accountId = liquid().slice().sort((x, y) => (Number(y.balance) || 0) - (Number(x.balance) || 0))[0].id;
    let finished = null;
    let left = 120;
    open({
      kind: 'tramite',
      render() {
        if (finished) {
          return '<div class="fx-center fx-top">' + okCircle() + '<h2 class="fx-h">' + esc(def.done) + '</h2><p class="fx-p">Lo más difícil era empezar, y empezaste. ' + finished.line + '</p></div>' +
            '<div class="fx-card"><div class="fx-label">Tus pasos</div>' + def.steps.map((s) => '<div class="fx-done-step">' + CHECK + '<span>' + esc(s.t) + '</span></div>').join('') + '</div>' +
            '<button type="button" class="btn btn-primary fx-main" data-fx="close">Listo</button>' +
            '<p class="fx-note">Tardaste ' + finished.minutes + (finished.minutes === 1 ? ' minuto.' : ' minutos.') + '</p>';
        }
        const s = def.steps[prog.step];
        let input = '';
        if (s.input === 'amount') {
          input = '<div class="fx-card"><label class="fx-label" for="fxTramAmount">Cuando lo veas, escríbelo aquí (opcional)</label>' +
            '<input id="fxTramAmount" class="fx-input" inputmode="decimal" placeholder="$0" value="' + esc(prog.amount || '') + '"></div>';
        } else if (s.input === 'account') {
          input = '<div class="fx-chips">' + liquid().map((a) => '<button type="button" class="tour-chip' + (a.id === prog.accountId ? ' on' : '') + '" data-fx="tram-acc" data-id="' + esc(a.id) + '" aria-pressed="' + (a.id === prog.accountId) + '">' + esc(a.name) + '</button>').join('') + '</div>';
        }
        return '<div class="fx-head"><span>' + esc(def.title) + '</span><button type="button" class="fx-x" data-fx="tram-later" aria-label="Cerrar y seguir después">✕</button></div>' +
          dots(def.steps.length, prog.step) + '<div class="fx-kicker">Paso ' + (prog.step + 1) + ' de ' + def.steps.length + '</div>' +
          '<h2 class="fx-h fx-center">' + esc(s.t) + '</h2><p class="fx-p fx-center">' + esc(s.d) + '</p>' +
          '<button type="button" class="fx-timer" data-fx="timer" aria-label="Temporizador opcional de dos minutos"><span class="fx-ring" id="fxRing"><span><b id="fxTime">2:00</b><small>opcional</small></span></span></button>' +
          input +
          '<button type="button" class="btn btn-primary fx-main" data-fx="tram-next">' + (prog.step === def.steps.length - 1 ? 'Hecho' : 'Hecho, siguiente') + '</button>' +
          '<button type="button" class="fx-link" data-fx="tram-later">Lo sigo después (guardo en qué paso vas)</button>';
      },
      afterPaint() { left = 120; stopTimer(); drawTimer(left); },
      toggleTimer() {
        if (timer) { stopTimer(); return; }
        timer = setInterval(() => { left = Math.max(0, left - 1); drawTimer(left); if (!left) stopTimer(); }, 1000);
      },
      readInput() { const el = $('fxTramAmount'); if (el) prog.amount = el.value.replace(/[^\d.,]/g, '').replace(',', '.'); },
      account(id) { this.readInput(); prog.accountId = id; paint(); },
      later() {
        this.readInput();
        e.tramites[key] = prog;
        persist();
        close();
        toast('Guardé tu avance: sigues en el paso ' + (prog.step + 1));
      },
      async next() {
        this.readInput();
        if (prog.step < def.steps.length - 1) { prog.step++; e.tramites[key] = prog; persist(); paint(); return; }
        let line = '';
        if (kind === 'tarjeta') {
          let paid = 0;
          for (const d of dueInstallments(id, now(), 7)) {
            const r = await data().msiPay({ planId: d.planId, number: d.number, accountId: prog.accountId });
            if (!r.ok) { toast('No pude anotar el pago: ' + r.error); return; }
            paid += d.amount;
          }
          if (root.AbacoApp) AbacoApp.refreshUI();
          line = paid ? 'Anoté el pago de <b>' + money(paid) + '</b> y ya no aparece en Hoy.' : 'Ya no aparece en Hoy.';
        } else {
          src.active = false;
          if (e.subUse[id]) e.subUse[id].cancelled = now();
          line = 'La quité de tus cobros. Ya no aparece en Lo que viene.';
        }
        delete e.tramites[key];
        persist();
        finished = { line, minutes: Math.max(1, Math.round((now() - (prog.startedAt || now())) / 60000)) };
        paint();
      }
    });
  }

  function drawTimer(left) {
    const ring = $('fxRing');
    const txt = $('fxTime');
    if (!ring || !txt) return;
    txt.textContent = left ? Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') : 'Sin prisa';
    ring.style.setProperty('--p', String(Math.round((left / 120) * 100)));
    ring.classList.toggle('running', !!timer);
  }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; const r = $('fxRing'); if (r) r.classList.remove('running'); }

  /* ---------- 5 · Lo que viene ---------- */

  let showAll = false;

  function renderProximos() {
    const box = $('fx-proximos');
    if (!box) return;
    const e = store();
    const t = now();
    const list = upcoming(state, t);
    if (!list.length) {
      box.innerHTML = '<div class="calm-sentence">No hay cobros en el próximo mes.</div><div class="calm-empty">Cuando agregues suscripciones o compras a meses, aparecen aquí con una barra que se llena mientras se acercan.</div>' +
        '<button type="button" class="btn btn-ghost fx-wide" data-go="suscripciones">Ver suscripciones</button>';
      return;
    }
    const shown = showAll ? list : list.slice(0, 4);
    box.innerHTML = '<p class="fx-lead">La barra se llena mientras se acerca el cobro. Llena = hoy.</p>' +
      '<div class="fx-card fx-charges">' + shown.map((c) => {
        const use = c.kind === 'sub' && e ? e.subUse[c.id] : null;
        let note = '';
        if (c.kind === 'sub') {
          if (use && use.answer === 'no') note = '<button type="button" class="fx-mini" data-fx="tramite" data-kind="cancelar" data-id="' + esc(c.id) + '">cancelar en pasos</button>';
          else if (c.days <= 3 && !(use && use.period === dayKey(c.at))) note = '<button type="button" class="fx-mini" data-fx="uso" data-id="' + esc(c.id) + '">¿lo usaste?</button>';
          else if (c.days <= 1) note = '<span>ya apartado</span>';
        } else note = '<span>a meses</span>';
        return '<div class="fx-charge"><div class="fx-row"><b>' + esc(c.name) + '</b><b>' + money(c.amount) + '</b></div>' +
          '<div class="fx-bar' + (c.days <= 3 ? ' near' : '') + '"><i style="width:' + c.fill + '%"></i></div>' +
          '<div class="fx-row fx-meta"><span>' + daysWord(c.days) + '</span>' + note + '</div></div>';
      }).join('') + '</div>' +
      (list.length > 4 ? '<button type="button" class="btn btn-ghost fx-wide" data-fx="prox-all">' + (showAll ? 'Ver menos ⌃' : 'Ver los ' + list.length + ' cobros del mes ⌄') + '</button>' : '');
  }

  function usoSheet(id) {
    const s = (state.subscriptions || []).find((x) => x.id === id);
    if (!s || !root.AbacoCalm) return;
    const d = nextCharge(s, now());
    const opt = (v, emoji, txt) => '<button type="button" class="cs-option fx-opt" data-fx="uso-set" data-id="' + esc(id) + '" data-v="' + v + '"><span class="fx-emoji" aria-hidden="true">' + emoji + '</span><span class="cs-opt-text"><b>' + txt + '</b></span></button>';
    AbacoCalm.openSheet({
      title: '¿Usaste ' + s.name.toLowerCase().replace(/^el |^la /, '') + ' este mes?',
      hint: 'Se cobra ' + money(s.amount) + ' ' + (d ? daysWord(Math.round((d.getTime() - startOfDay(now())) / DAY)) : ''),
      render() {
        return opt('si', '💪', 'Sí, lo uso') + opt('casi', '🤏', 'Casi no') + opt('no', '🫥', 'No, se me olvidó que lo pagaba') +
          '<p class="fx-sheet-note">Si no lo usas, te recuerdo cancelarlo antes de que se cobre otra vez.</p>' +
          '<button type="button" class="btn btn-ghost fx-wide" data-fx="uso-set" data-id="' + esc(id) + '" data-v="luego">Preguntarme el otro mes</button>';
      }
    });
  }

  function setUso(id, v) {
    const e = store();
    const s = (state.subscriptions || []).find((x) => x.id === id);
    if (!s) return;
    const d = nextCharge(s, now());
    e.subUse[id] = { answer: v, period: d ? dayKey(d.getTime()) : '', at: now() };
    if (v === 'no' && d) {
      // Recordatorio el día anterior al cobro a las 9:00 (o en una hora si ya no da tiempo).
      let when = d.getTime() - DAY + 9 * 3600000;
      if (when <= now()) when = now() + 3600000;
      const rem = { id: typeof uid === 'function' ? uid() : 'r' + Date.now(), text: 'Cancelar ' + s.name + ' antes de que se cobre', when, done: false, notified: false, user_id: state.user_id, created_at: now(), source: 'cobros' };
      state.reminders = state.reminders || [];
      state.reminders.push(rem);
      if (typeof scheduleReminderNotification === 'function') scheduleReminderNotification(rem);
    }
    persist();
    AbacoCalm.closeSheet();
    renderProximos();
    toast({ si: 'Anotado. Que lo disfrutes.', casi: 'Anotado. Te vuelvo a preguntar el otro mes.', no: 'Te lo puse en Hoy en pasos chiquitos, y te recuerdo antes del cobro.', luego: 'Te pregunto el otro mes.' }[v]);
  }

  /* ---------- 6 · Constancia ---------- */

  function renderConstancia() {
    const box = $('fx-constancia');
    if (!box) return;
    const e = store();
    const t = now();
    const c = constancy(state, t);
    const lead = c.count === 0 ? 'Este mes todavía no anotas nada. Cualquier día es buen día para empezar.'
      : c.record ? 'Tu mejor mes hasta ahora. Los días sin anotar no borran nada.'
        : 'Tu mejor mes fueron ' + c.best + ' días. Los días sin anotar no borran nada.';
    let cal = '';
    const first = new Date(new Date(t).getFullYear(), new Date(t).getMonth(), 1).getDay();
    for (let k = 0; k < first; k++) cal += '<span class="fx-day blank"></span>';
    for (let d = 1; d <= c.total; d++) {
      const cls = c.days.has(d) ? 'on' : d > c.today ? 'future' : '';
      cal += '<span class="fx-day ' + cls + (d === c.today ? ' today' : '') + '">' + d + '</span>';
    }
    const skipped = e ? e.decisions.filter((d) => d.kind === 'no-compre') : [];
    const saved = skipped.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const kept = e ? e.pacts.reduce((s, p) => s + ((p.log || []).filter((l) => l.ok).length), 0) : 0;
    const rows = [];
    if (skipped.length) rows.push(['🌙', 'Decidiste no comprar ' + skipped.length + (skipped.length === 1 ? ' vez' : ' veces'), 'te ahorraste ' + money(saved)]);
    if (e && e.sundays.length) rows.push(['☀️', e.sundays.length + (e.sundays.length === 1 ? ' domingo revisado' : ' domingos revisados'), 'desde ' + new Date(e.sundays[0].at).toLocaleDateString('es-MX', { month: 'long' })]);
    if (kept) rows.push(['🤝', kept + (kept === 1 ? ' pacto cumplido' : ' pactos cumplidos'), 'contigo, sin castigos']);
    if (e && e.returns.length) rows.push(['🧭', 'Volviste ' + e.returns.length + (e.returns.length === 1 ? ' vez' : ' veces') + ' después de una pausa', 'y te pusiste al día']);
    box.innerHTML = '<div class="fx-card hi fx-hero"><div class="fx-big">' + c.count + '</div><b>' + (c.count === 1 ? 'día anotando este mes' : 'días anotando este mes') + '</b><small>' + lead + '</small></div>' +
      '<div class="fx-card"><div class="fx-cal">' + cal + '</div></div>' +
      '<div class="section-title">Lo que vas juntando</div>' +
      (rows.length ? '<div class="fx-card fx-list">' + rows.map(([i, a, b]) => '<div class="fx-gather"><span class="fx-emoji" aria-hidden="true">' + i + '</span><div><b>' + esc(a) + '</b><small>' + esc(b) + '</small></div></div>').join('') + '</div>'
        : '<div class="calm-empty">Aquí se van juntando tus pausas, domingos revisados y pactos cumplidos.</div>');
  }

  /* ---------- 7 · Revisión de domingo ---------- */

  function startSunday() {
    const e = store();
    const t = now();
    const w = weekSummary(state, t);
    const goals = goalsFor(w.top[0] ? w.top[0].category : 'general');
    const last = e.sundays[e.sundays.length - 1];
    let i = 0;
    let goal = goals[0];
    const card1 = () => {
      let title;
      let body;
      if (!w.count && !w.prevTotal) { title = 'Semana tranquila'; body = 'No hubo gastos anotados. Si sí gastaste, no pasa nada: el domingo que viene seguimos.'; }
      else if (w.total < w.prevTotal) {
        title = 'Gastaste ' + money(w.prevTotal - w.total) + ' menos que la semana pasada';
        body = w.improved ? 'Sobre todo en ' + catLabel(w.improved.category).toLowerCase() + (w.improved.before > w.improved.after ? ': ' + w.improved.after + (w.improved.after === 1 ? ' vez' : ' veces') + ' en lugar de ' + w.improved.before : '') + '. Eso ya cuenta.' : 'Eso ya cuenta.';
      } else if (w.improved) {
        title = 'Bajaste en ' + catLabel(w.improved.category).toLowerCase();
        body = money(w.improved.drop) + ' menos que la semana pasada. Lo demás se movió, y está bien.';
      } else { title = 'Anotaste ' + w.count + (w.count === 1 ? ' gasto' : ' gastos'); body = 'Ver en qué se va el dinero ya es la mitad del camino.'; }
      const max = Math.max(w.total, w.prevTotal, 1);
      return { kicker: 'Lo mejor de tu semana', title, body: body + (last && last.goal && last.goal !== 'Esta semana, nada' ? ' La semana pasada elegiste: «' + last.goal + '».' : ''),
        extra: '<div class="fx-compare"><div><i style="height:' + Math.max(6, Math.round((w.prevTotal / max) * 110)) + 'px"></i><span>Semana pasada</span></div><div><i class="on" style="height:' + Math.max(6, Math.round((w.total / max) * 110)) + 'px"></i><span>Esta semana</span></div></div>' };
    };
    const card2 = () => {
      const top = w.top[0];
      if (!top) return { kicker: 'En qué se fue más', title: 'Nada que destacar', body: 'No hubo gastos anotados esta semana.', extra: '' };
      const max = top.total || 1;
      return { kicker: 'En qué se fue más', title: catLabel(top.category) + ': ' + money(top.total),
        body: 'Fueron ' + top.count + (top.count === 1 ? ' gasto' : ' gastos') + '. No es bueno ni malo: solo para que lo veas.',
        extra: '<div class="fx-cats">' + w.top.slice(0, 3).map((c, k) => '<div><div class="fx-row"><span>' + esc(catLabel(c.category)) + '</span><b>' + money(c.total) + '</b></div><div class="fx-bar' + (k === 0 ? ' near' : '') + '"><i style="width:' + Math.max(6, Math.round((c.total / max) * 100)) + '%"></i></div></div>').join('') + '</div>' };
    };
    const card3 = () => ({ kicker: 'Para la semana que viene', title: 'Un objetivo pequeño', body: 'Elige uno o ninguno. El domingo que viene te lo recuerdo.',
      extra: '<div class="fx-goals">' + goals.map((g) => '<button type="button" class="fx-goal' + (g === goal ? ' on' : '') + '" data-fx="goal" data-v="' + esc(g) + '" aria-pressed="' + (g === goal) + '">' + esc(g) + '</button>').join('') + '</div>' });
    open({
      kind: 'domingo',
      render() {
        const c = [card1, card2, card3][i]();
        return '<div class="fx-head"><span>Revisión de domingo</span><button type="button" class="fx-x" data-fx="close" aria-label="Cerrar">✕</button></div>' + dots(3, i) +
          '<div class="fx-swipe" id="fxSwipe"><div class="fx-kicker2">' + esc(c.kicker) + '</div><h2 class="fx-h">' + esc(c.title) + '</h2><p class="fx-p">' + esc(c.body) + '</p>' + c.extra + '</div>' +
          (i < 2 ? '<button type="button" class="btn btn-primary fx-main" data-fx="sun-next">Siguiente</button><p class="fx-note">También puedes deslizar →</p>'
            : '<button type="button" class="btn btn-primary fx-main" data-fx="sun-done">Listo, hasta el domingo</button>');
      },
      afterPaint(el) {
        const card = el.querySelector('#fxSwipe');
        if (!card) return;
        let x0 = null;
        card.addEventListener('touchstart', (ev) => { x0 = ev.touches[0].clientX; }, { passive: true });
        card.addEventListener('touchend', (ev) => {
          if (x0 == null) return;
          const dx = ev.changedTouches[0].clientX - x0;
          x0 = null;
          if (dx < -50 && i < 2) { i++; paint(); } else if (dx > 50 && i > 0) { i--; paint(); }
        });
      },
      next() { if (i < 2) { i++; paint(); } },
      pick(g) { goal = g; paint(); },
      done() {
        e.sundays.push({ week: sundayKey(t), goal, at: now() });
        persist();
        close();
        toast(goal === 'Esta semana, nada' ? 'Listo. Nos vemos el domingo.' : 'Listo: «' + goal + '». Nos vemos el domingo.');
      }
    });
  }

  /* ---------- eventos ---------- */

  document.addEventListener('click', (ev) => {
    const el = ev.target && ev.target.closest && ev.target.closest('[data-fx]');
    if (!el) return;
    const a = el.dataset.fx;
    if (a === 'close') { close(); if (el.dataset.goAfter && typeof goPanel === 'function') goPanel(el.dataset.goAfter); return; }
    if (a === 'key' && flow && flow.key) { flow.key(el.dataset.k); return; }
    if (a === 'ret-start' && flow) { flow.start(); return; }
    if (a === 'ret-next' && flow) { flow.next(false); return; }
    if (a === 'ret-skip' && flow) { flow.next(true); return; }
    if (a === 'tramite') { if (root.AbacoCalm) AbacoCalm.closeSheet(); startTramite(el.dataset.kind, el.dataset.id); return; }
    if (a === 'tram-next' && flow) { flow.next(); return; }
    if (a === 'tram-later' && flow) { flow.later(); return; }
    if (a === 'tram-acc' && flow) { flow.account(el.dataset.id); return; }
    if (a === 'timer' && flow && flow.toggleTimer) { flow.toggleTimer(); return; }
    if (a === 'domingo') { startSunday(); return; }
    if (a === 'sun-next' && flow) { flow.next(); return; }
    if (a === 'sun-done' && flow) { flow.done(); return; }
    if (a === 'goal' && flow) { flow.pick(el.dataset.v); return; }
    if (a === 'uso') { usoSheet(el.dataset.id); return; }
    if (a === 'uso-set') { setUso(el.dataset.id, el.dataset.v); return; }
    if (a === 'prox-all') { showAll = !showAll; renderProximos(); }
  });

  /* "Volver" de Android cierra primero el flujo abierto (un trámite guarda su avance). */
  (function wrapBack() {
    const prev = root.handleAndroidBack;
    if (typeof prev !== 'function' || prev.__focus) return;
    root.handleAndroidBack = function () {
      if (flow) { if (flow.kind === 'tramite') flow.later(); else close(); return; }
      return prev.apply(this, arguments);
    };
    root.handleAndroidBack.__focus = true;
  })();

  /* Volver después de días: al abrir y al regresar a la app. */
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReturn(); });

  function start() { checkReturn(); }
  function onPanel(name) {
    if (name === 'proximos') { showAll = false; renderProximos(); }
    if (name === 'constancia') renderConstancia();
  }
  function afterRefresh() {
    if (typeof state !== 'object') return;
    if (state.activePanel === 'proximos') renderProximos();
    if (state.activePanel === 'constancia') renderConstancia();
  }

  root.AbacoFocus = Object.assign({}, pure, {
    start, checkReturn, startReturn, startTramite, startSunday, tramiteItems, dueInstallments, renderProximos, renderConstancia,
    usoSheet, setUso, onPanel, afterRefresh, close, isOpen: () => !!flow
  });
})(typeof window !== 'undefined' ? window : globalThis);
