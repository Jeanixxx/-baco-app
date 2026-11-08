/* Ábaco · calculadora (pantalla y flujo con el dinero de la app).
 *
 * Lo que puedes hacer con ella:
 *  - Operaciones con jerarquía (× ÷ antes que + −), paréntesis, borrar dígito a dígito y cinta
 *    que muestra la operación mientras la escribes.
 *  - Tomar valores de tus cuentas, de lo que debes y de lo que te deben («Tomar de…»).
 *  - Usar el resultado para anotar un gasto o un abono a una deuda.
 *  - Si la cuenta no tiene el dinero, la operación se acepta igual: queda pendiente y Hoy
 *    muestra «Agregar dinero a…». Cuando la cuenta alcanza, se anota sola.
 *
 * El motor de cálculo está en js/abaco-calc-engine.js. Aquí solo hay pantalla y flujo.
 */
(function (root) {
  'use strict';

  const ENG = root.AbacoCalcEngine;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = (n) => '$' + (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
  const now = () => Number(root.__abacoNow) || Date.now();
  const ex = () => (root.AbacoExtrasUI ? root.AbacoExtrasUI.extras() : null);
  const persist = () => { try { if (typeof root.save === 'function') root.save(); } catch (e) { console.warn(e); } };
  const data = () => root.AbacoApp.data();
  const toast2 = (m) => { if (typeof toast === 'function') toast(m); };

  let calc = new ENG.Calc();
  let isOpen = false;
  let settling = false;

  /* ---------- datos de la app ---------- */

  function liquidAccounts() {
    return (state.accounts || []).filter((a) => a.kind === 'liquid' && !a.archived);
  }
  function accountById(id) { return (state.accounts || []).find((a) => a.id === id) || null; }

  /* Lo que se puede tomar: cuentas, deudas (lo que debes) y préstamos (lo que te deben). */
  function sources() {
    const out = [];
    for (const a of liquidAccounts()) out.push({ label: a.name, value: Number(a.balance) || 0, group: 'Cuentas', id: a.id });
    for (const l of state.loans || []) {
      if (l.paid >= l.term && l.term > 0) continue;
      const cur = Number(l.current) || 0;
      if (cur > 0) out.push({ label: 'Deuda ' + l.name, value: cur, group: 'Lo que debes', id: l.id });
    }
    for (const d of state.debtors || []) {
      if (d.settled) continue;
      const rem = Number(d.remaining) || 0;
      if (rem > 0) out.push({ label: d.person + ' te debe', value: rem, group: 'Lo que te deben', id: d.id });
    }
    return out;
  }

  /* ---------- pantalla ---------- */

  const KEYS = [
    ['AC', 'C', '⌫', '÷'],
    ['(', ')', '%', '×'],
    ['7', '8', '9', '−'],
    ['4', '5', '6', '+'],
    ['1', '2', '3', '='],
    ['±', '0', '.', null]
  ];

  function buildKeys() {
    const box = $('ckKeys');
    if (!box || box.dataset.built) return;
    box.dataset.built = '1';
    box.innerHTML = KEYS.flat().map((k, i) => {
      if (k === null) return ''; // la celda de «=» ocupa las dos filas de la última columna
      const cls = ['÷', '×', '−', '+'].includes(k) ? 'op' : k === '=' ? 'eq' : ['AC', 'C', '⌫', '(', ')', '%', '±'].includes(k) ? 'fn' : '';
      const label = k === '⌫' ? '<span aria-label="Borrar">⌫</span>' : esc(k);
      return '<button type="button" class="ck-key ' + cls + '" data-k="' + esc(k) + '" aria-label="' + (k === '⌫' ? 'Borrar' : k === 'AC' ? 'Borrar todo' : k === 'C' ? 'Borrar número' : k) + '">' + label + '</button>';
    }).join('');
  }

  function fmtDisplay(s) {
    if (/^-?\d+$/.test(s)) return Number(s).toLocaleString('es-MX');
    const m = /^(-?\d+)\.(\d*)$/.exec(s);
    if (m) return Number(m[1]).toLocaleString('es-MX') + '.' + m[2];
    return s;
  }

  function render() {
    const tape = $('ckTape');
    const disp = $('ckDisplay');
    const err = $('ckError');
    if (!tape || !disp) return;
    const expr = calc.expression();
    tape.textContent = expr || (calc.fresh ? 'Resultado: ' + money(calc._resultValue) : '');
    disp.textContent = calc.error ? '' : fmtDisplay(calc.display());
    err.textContent = calc.error || '';
    const v = calc.value();
    const ok = v != null && v > 0;
    if ($('ckSpend')) $('ckSpend').disabled = !ok;
    if ($('ckPay')) $('ckPay').disabled = !ok || !openDebts().length;
    renderHistory();
  }

  function renderHistory() {
    const box = $('ckHist');
    if (!box) return;
    box.innerHTML = calc.history.slice(0, 3).map((h, i) =>
      '<button type="button" class="ck-hrow" data-hist="' + i + '"><span>' + esc(h.expr) + '</span><b>= ' + money(h.result) + '</b></button>').join('');
  }

  function press(k) {
    if (k === 'AC') calc.clearAll();
    else if (k === 'C') calc.clearEntry();
    else if (k === '⌫') calc.backspace();
    else if (k === '=') calc.equals();
    else if (k === '±') calc.sign();
    else if (k === '%') calc.percent();
    else if (k === '(') calc.open();
    else if (k === ')') calc.close();
    else if (k === '.') calc.dot();
    else if (k === '+' || k === '−' || k === '×' || k === '÷') calc.op(k === '−' ? '-' : k);
    else calc.digit(k);
    render();
  }

  /* Teclado de la computadora, por si la usas con teclado. */
  const KEYMAP = { '/': '÷', '*': '×', '-': '−', '+': '+', Enter: '=', '=': '=', Backspace: '⌫', Escape: 'AC', '.': '.', ',': '.', '(': '(', ')': ')', '%': '%' };
  function onKey(ev) {
    if (!isOpen) return;
    if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
    const k = KEYMAP[ev.key] || (/^\d$/.test(ev.key) ? ev.key : null);
    if (!k) return;
    ev.preventDefault();
    press(k);
  }

  /* ---------- abrir y cerrar ---------- */

  function openCalc() {
    buildKeys();
    isOpen = true;
    $('calcPage')?.classList.add('open');
    $('calcOverlay')?.classList.add('open');
    document.querySelector('.app')?.classList.add('calc-open');
    render();
  }
  function closeCalc() {
    if (!isOpen) return false;
    isOpen = false;
    closeSheet();
    $('calcPage')?.classList.remove('open');
    $('calcOverlay')?.classList.remove('open');
    document.querySelector('.app')?.classList.remove('calc-open');
    return true;
  }

  /* ---------- hoja inferior propia (tomar de…, anotar gasto, abonar) ---------- */

  function sheetEl() {
    let el = $('ckSheet');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ckSheet';
      el.className = 'calm-sheet ck-sheet';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.hidden = true;
      (document.querySelector('.app') || document.body).appendChild(el);
    }
    return el;
  }
  function openSheet(title, html) {
    const el = sheetEl();
    el.innerHTML = '<div class="cs-title">' + esc(title) + '</div>' + html;
    el.hidden = false;
    el.setAttribute('aria-label', title);
  }
  function closeSheet() {
    const el = $('ckSheet');
    if (el && !el.hidden) { el.hidden = true; return true; }
    return false;
  }
  function sheetOpen() { const el = $('ckSheet'); return !!el && !el.hidden; }

  /* Tomar de…: lista de cuentas, deudas y préstamos; al elegir, el valor entra a la calculadora. */
  function openFrom() {
    const groups = {};
    for (const s of sources()) (groups[s.group] = groups[s.group] || []).push(s);
    const avail = (state.financeTotals || {}).available;
    let html = '';
    if (typeof avail === 'number') html += '<div class="ck-group">Disponible</div><button type="button" class="ck-opt" data-ck="from" data-v="' + avail + '" data-l="Disponible"><span>Disponible</span><b>' + money(avail) + '</b></button>';
    for (const g of Object.keys(groups)) {
      html += '<div class="ck-group">' + esc(g) + '</div>' + groups[g].map((s, i) =>
        '<button type="button" class="ck-opt" data-ck="from" data-v="' + s.value + '" data-l="' + esc(s.label) + '"><span>' + esc(s.label) + '</span><b>' + money(s.value) + '</b></button>').join('');
    }
    if (!html) html = '<div class="calm-empty">Aún no tienes cuentas, deudas ni préstamos para tomar.</div>';
    openSheet('Tomar de…', '<div class="ck-list">' + html + '</div>');
  }

  /* Anotar gasto: descripción, categoría y de qué cuenta sale. */
  function openSpend() {
    const v = calc.value();
    if (!(v > 0)) return;
    const accs = liquidAccounts();
    if (!accs.length) { toast2('Primero agrega una cuenta'); return; }
    const cats = state.categories && state.categories.length ? state.categories : [{ id: 'general', name: 'General' }];
    const best = accs.slice().sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0))[0];
    const html = '<div class="ck-amount">' + money(v) + '</div>' +
      '<label class="fx-label" for="ckDesc">¿Qué fue?</label><input id="ckDesc" class="fx-input" placeholder="Tacos, súper, gasolina…" maxlength="60">' +
      '<div class="ck-group">Categoría</div><div class="ck-chips" id="ckCats">' + cats.map((c, i) =>
        '<button type="button" class="tour-chip' + (i === 0 ? ' on' : '') + '" data-ck="cat" data-v="' + esc(c.id) + '" aria-pressed="' + (i === 0) + '">' + esc(c.name) + '</button>').join('') + '</div>' +
      '<div class="ck-group">¿De qué cuenta sale?</div><div class="ck-chips" id="ckAccs">' + accs.map((a) =>
        '<button type="button" class="tour-chip' + (a.id === best.id ? ' on' : '') + '" data-ck="acc" data-v="' + esc(a.id) + '" aria-pressed="' + (a.id === best.id) + '">' + esc(a.name) + ' · ' + money(a.balance) + '</button>').join('') + '</div>' +
      '<button type="button" class="btn btn-primary ck-go" data-ck="spend-go">Anotar</button>' +
      '<p class="ck-note">Si la cuenta no tiene ese dinero, se queda pendiente y Hoy te pide agregarlo.</p>';
    openSheet('Anotar gasto', html);
    sheetEl().dataset.kind = 'gasto';
  }

  /* Abonar a deuda: elige la deuda y la cuenta. */
  function openDebts() {
    return (state.loans || []).filter((l) => (Number(l.current) || 0) > 0);
  }
  function openPay() {
    const v = calc.value();
    if (!(v > 0)) return;
    const debts = openDebts();
    if (!debts.length) { toast2('No tienes deudas por abonar'); return; }
    const accs = liquidAccounts();
    if (!accs.length) { toast2('Primero agrega una cuenta'); return; }
    const best = accs.slice().sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0))[0];
    const html = '<div class="ck-amount">' + money(v) + '</div>' +
      '<div class="ck-group">¿A qué deuda?</div><div class="ck-chips" id="ckDebts">' + debts.map((l, i) =>
        '<button type="button" class="tour-chip' + (i === 0 ? ' on' : '') + '" data-ck="debt" data-v="' + esc(l.id) + '" aria-pressed="' + (i === 0) + '">' + esc(l.name) + ' · ' + money(l.current) + '</button>').join('') + '</div>' +
      '<div class="ck-group">¿De qué cuenta sale?</div><div class="ck-chips" id="ckAccs">' + accs.map((a) =>
        '<button type="button" class="tour-chip' + (a.id === best.id ? ' on' : '') + '" data-ck="acc" data-v="' + esc(a.id) + '" aria-pressed="' + (a.id === best.id) + '">' + esc(a.name) + ' · ' + money(a.balance) + '</button>').join('') + '</div>' +
      '<button type="button" class="btn btn-primary ck-go" data-ck="pay-go">Abonar</button>' +
      '<p class="ck-note">Si la cuenta no tiene ese dinero, se queda pendiente y Hoy te pide agregarlo.</p>';
    openSheet('Abonar a deuda', html);
    sheetEl().dataset.kind = 'abono';
  }

  function pickOne(container, el) {
    container.querySelectorAll('.tour-chip').forEach((b) => { const on = b === el; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }
  function chosen(id) { const b = sheetEl().querySelector('#' + id + ' .tour-chip.on'); return b ? b.dataset.v : null; }

  /* ---------- aplicar: contra la app, o pendiente si falta dinero ---------- */

  function runOp(p) {
    const d = data();
    if (p.kind === 'gasto') return d.expense({ amount: p.amount, description: p.desc || 'Gasto de la calculadora', category: p.category || 'general', accountId: p.accountId, source: 'calculadora', at: p.at });
    if (p.kind === 'abono') return d.loanPayment({ loanId: p.loanId, accountId: p.accountId, amount: p.amount });
    return Promise.resolve({ ok: false, error: 'Operación desconocida' });
  }

  function pendingList() {
    const e = ex();
    if (!e) return [];
    if (!Array.isArray(e.pendingMoney)) e.pendingMoney = [];
    return e.pendingMoney;
  }

  async function apply(p) {
    const acc = accountById(p.accountId);
    if (!acc) { toast2('Elige una cuenta'); return false; }
    const r = await runOp(p);
    if (r.ok) {
      toast2(p.kind === 'gasto' ? 'Anotado: ' + money(p.amount) + ' de ' + acc.name : 'Abono anotado: ' + money(p.amount));
      root.AbacoApp.refreshUI();
      return true;
    }
    if (r.code === 'INSUFFICIENT_FUNDS') {
      const missing = Math.round((p.amount - (Number(acc.balance) || 0)) * 100) / 100;
      pendingList().push({ id: 'pm-' + now().toString(36) + Math.random().toString(36).slice(2, 6), ...p, accountName: acc.name, missing, createdAt: now() });
      persist();
      toast2('Quedó pendiente: faltan ' + money(missing) + ' en ' + acc.name + '. Te lo marco en Hoy.');
      root.AbacoApp.refreshUI();
      return true;
    }
    toast2(r.error || 'No se pudo anotar');
    return false;
  }

  /* Cuando la cuenta ya tiene el dinero, la operación pendiente se anota sola. */
  async function settlePending() {
    if (settling) return;
    const list = pendingList();
    if (!list.length) return;
    settling = true;
    try {
      for (const p of list.slice()) {
        const acc = accountById(p.accountId);
        if (!acc) { remove(p.id); continue; }
        if ((Number(acc.balance) || 0) + 0.001 < p.amount) continue;
        const r = await runOp(p);
        if (r.ok) { remove(p.id); toast2('Listo: se anotó ' + (p.kind === 'gasto' ? (p.desc || 'el gasto') : 'el abono') + ' por ' + money(p.amount)); }
        else if (r.code === 'INSUFFICIENT_FUNDS') continue;
        else { remove(p.id); toast2('No se pudo anotar ' + (p.desc || 'una operación') + ': ' + (r.error || '')); }
      }
      persist();
      root.AbacoApp.refreshUI();
    } finally { settling = false; }
  }
  function remove(id) {
    const e = ex();
    if (!e) return;
    e.pendingMoney = pendingList().filter((x) => x.id !== id);
  }

  /* ---------- eventos ---------- */

  document.addEventListener('click', async (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;
    const key = t.closest('#ckKeys [data-k]');
    if (key) { press(key.dataset.k); return; }
    const hist = t.closest('#ckHist [data-hist]');
    if (hist) {
      const h = calc.history[Number(hist.dataset.hist)];
      if (h) { calc.clearAll(); calc.insert(h.result, ''); render(); }
      return;
    }
    if (t.closest('#btnCloseCalc')) { closeCalc(); return; }
    if (t.closest('#calcOverlay')) { closeCalc(); return; }
    if (t.closest('#ckFrom')) { openFrom(); return; }
    if (t.closest('#ckAvail')) {
      const avail = (state.financeTotals || {}).available;
      if (typeof avail === 'number') { calc.insert(avail, 'Disponible'); render(); }
      return;
    }
    if (t.closest('#ckSpend')) { openSpend(); return; }
    if (t.closest('#ckPay')) { openPay(); return; }
    const opt = t.closest('#ckSheet [data-ck]');
    if (!opt) return;
    const a = opt.dataset.ck;
    if (a === 'from') { calc.insert(Number(opt.dataset.v), opt.dataset.l); render(); closeSheet(); return; }
    if (a === 'cat' || a === 'acc' || a === 'debt') { pickOne(opt.parentElement, opt); return; }
    if (a === 'spend-go') {
      const p = { kind: 'gasto', amount: calc.value(), desc: (sheetEl().querySelector('#ckDesc').value || '').trim() || 'Gasto de la calculadora', category: chosen('ckCats'), accountId: chosen('ckAccs'), at: now() };
      if (await apply(p)) { calc.clearAll(); render(); closeSheet(); closeCalc(); }
      return;
    }
    if (a === 'pay-go') {
      const p = { kind: 'abono', amount: calc.value(), loanId: chosen('ckDebts'), accountId: chosen('ckAccs'), at: now() };
      if (await apply(p)) { calc.clearAll(); render(); closeSheet(); closeCalc(); }
      return;
    }
  });

  document.addEventListener('keydown', onKey);

  /* «Volver» de Android: primero la hoja, después la calculadora. */
  (function wrapBack() {
    const prev = root.handleAndroidBack;
    if (typeof prev !== 'function' || prev.__calc) return;
    root.handleAndroidBack = function () {
      if (sheetOpen()) { closeSheet(); return true; }
      if (isOpen) { closeCalc(); return true; }
      return prev.apply(this, arguments);
    };
    root.handleAndroidBack.__calc = true;
  })();

  /* Llamado por refreshUI: intenta anotar lo pendiente cada vez que cambian los datos. */
  function afterRefresh() { if (pendingList().length) settlePending(); }

  root.openCalc = openCalc;
  root.closeCalc = closeCalc;
  root.AbacoCalc = { open: openCalc, close: closeCalc, afterRefresh, settlePending, pending: pendingList, sources, isOpen: () => isOpen, _calc: () => calc };

  /* Botón de arriba. */
  const top = $('btnCalcTop');
  if (top) top.addEventListener('click', openCalc);
})(typeof window !== 'undefined' ? window : globalThis);
