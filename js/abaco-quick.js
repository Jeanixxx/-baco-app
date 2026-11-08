/* Ábaco · frases anotadas desde la notificación de Android.
 *
 * La notificación fija (app/src/main/java/mx/abaco/app/QuickExpense.kt) guarda en una cola lo que
 * la persona escribe: "85 tacos", "me pagaron 8 mil", "le debo 500 a Juan", "recuérdame pagar la luz".
 * Al abrir o volver a Ábaco, sync() lee esa cola, interpreta cada frase con AbacoIntent
 * (js/abaco-intent.js) y la guarda como gasto, ingreso, deuda, préstamo, abono, cobro, recordatorio
 * o artículo de la lista, con la hora en que se anotó. Luego le dice a Android cuáles ya quedaron.
 * Si el motor rechaza algo (por ejemplo, sin saldo), se queda en la cola para otro intento;
 * lo que no se entiende se descarta con un aviso.
 *
 * En el navegador (sin AndroidBridge) no hace nada.
 */
(function (root) {
  'use strict';

  const MAX = 10000000;

  /* "85 tacos", "$1,250.50 súper", "120,5 pan", "café 45" -> { amount, description } */
  function parse(text) {
    const raw = String(text == null ? '' : text).trim();
    const m = raw.match(/\$?\s*(\d[\d.,]*)/);
    if (!m) return null;
    let n = m[1].replace(/[.,]+$/, '');
    if (n.includes(',') && n.includes('.')) n = n.replace(/,/g, '');
    else if (n.includes(',')) {
      const parts = n.split(',');
      n = parts.length === 2 && parts[1].length !== 3 ? parts[0] + '.' + parts[1] : parts.join('');
    } else if ((n.match(/\./g) || []).length > 1) n = n.replace(/\./g, '');
    const amount = Math.round(Number(n) * 100) / 100;
    if (!(amount > 0) || amount > MAX) return null;
    const description = (raw.slice(0, m.index) + ' ' + raw.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return { amount, description };
  }

  const WORDS = {
    comida: ['taco', 'café', 'cafe', 'comida', 'súper', 'super', 'pan', 'torta', 'pizza', 'restaurante', 'cena', 'desayuno', 'antojo', 'despensa', 'mercado'],
    transporte: ['uber', 'taxi', 'metro', 'pasaje', 'gasolina', 'camión', 'camion', 'didi', 'estacionamiento', 'caseta'],
    hogar: ['luz', 'agua', 'gas', 'renta', 'internet', 'limpieza'],
    ocio: ['cine', 'bar', 'fiesta', 'concierto', 'juego', 'boletos'],
    salud: ['farmacia', 'doctor', 'medicina', 'consulta', 'dentista']
  };

  /* Categoría por el nombre de una categoría de la persona o por palabras comunes; si no, "general". */
  function guessCategory(description, categories) {
    const d = String(description || '').toLowerCase();
    const cats = categories || [];
    if (!d) return 'general';
    const byName = cats.find((c) => c && c.name && d.includes(String(c.name).toLowerCase()));
    if (byName) return byName.id;
    for (const [cat, words] of Object.entries(WORDS)) {
      if (words.some((w) => d.includes(w)) && cats.some((c) => c.id === cat)) return cat;
    }
    return 'general';
  }

  const bridge = () => (typeof window !== 'undefined' ? window.AndroidBridge : null);
  const available = () => { const b = bridge(); return !!(b && typeof b.pendingQuickExpenses === 'function'); };

  function enabled() {
    try { return available() && !!bridge().quickExpenseEnabled(); } catch (e) { return false; }
  }

  function setEnabled(on) {
    const b = bridge();
    if (available() && typeof b.setQuickExpenseEnabled === 'function') b.setQuickExpenseEnabled(!!on);
  }

  let running = null;
  const warned = new Set(); // avisar una sola vez por sesión de cada frase que no se pudo guardar

  const intentApi = () => root.AbacoIntent || (typeof require === 'function' ? require('./abaco-intent.js') : null);
  const newId = () => (typeof uid === 'function' ? uid() : 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  const persist = () => { if (typeof save === 'function') save(); };

  function contextFor(item) {
    return {
      now: Number(item.at) > 0 ? Number(item.at) : Date.now(),
      categories: state.categories || [],
      loans: state.loans || [],
      debtors: state.debtors || [],
      accounts: (state.accounts || []).filter((a) => a.kind !== 'credit' && !a.archived)
    };
  }

  const LISTA_SUPER = /\b(leche|pan|huevo|huevos|tortillas|fruta|verdura|carne|pollo|arroz|frijol|cafe|azucar|aceite|jabon|papel|detergente|agua|refresco|queso|jamon)\b/;

  /* Guarda una frase según lo que la persona quiso decir. Devuelve { ok, kind, label } o { ok:false, msg, retry }. */
  async function apply(item, data) {
    const I = intentApi();
    const r = I.detect(item.text, contextFor(item));
    const quote = '«' + item.text + '»';
    if (!r.intent) return { ok: false, msg: quote + ' no lo entendí' };
    if (r.missing.includes('amount')) return { ok: false, msg: quote + ' no tiene un monto' };
    if (r.missing.includes('person')) return { ok: false, msg: quote + ': falta con quién' };
    if (r.missing.includes('description')) return { ok: false, msg: quote + ' está vacío' };
    const at = Number(item.at) > 0 ? Number(item.at) : undefined;
    const past = r.when != null && r.when <= Date.now() ? r.when : at;
    let res;
    switch (r.intent) {
      case 'gasto':
        res = await data.expense({ amount: r.amount, description: r.description || 'Gasto rápido', category: r.category || 'general', accountId: r.accountId, source: 'notificacion', at: past });
        break;
      case 'ingreso':
        res = await data.income({ amount: r.amount, description: r.description || 'Ingreso', type: r.incomeType || 'otro', accountId: r.accountId, at: past });
        break;
      case 'debo':
        res = await data.loan({ name: r.person + (r.description ? ' · ' + r.description : ''), principal: r.amount, annualRate: 0, term: 1, type: 'personal', disburse: r.disburse, accountId: r.accountId });
        break;
      case 'me_deben':
        res = await data.lend({ person: r.person, concept: r.description || 'Préstamo', amount: r.amount, accountId: r.accountId });
        break;
      case 'abono':
        res = await data.loanPayment({ loanId: r.targetId, amount: r.amount || undefined, accountId: r.accountId });
        break;
      case 'cobro':
        res = await data.collect({ debtorId: r.targetId, amount: r.amount || undefined, accountId: r.accountId });
        break;
      case 'recordatorio': {
        const rem = { id: newId(), text: r.description, when: r.when, done: false, notified: false, user_id: state.user_id, created_at: Date.now(), source: 'notificacion' };
        state.reminders = state.reminders || [];
        state.reminders.push(rem);
        if (typeof scheduleReminderNotification === 'function') scheduleReminderNotification(rem);
        persist();
        res = { ok: true };
        break;
      }
      case 'lista': {
        const cat = LISTA_SUPER.test(I.fold(r.description)) ? 'super' : 'otro';
        state.checklist = state.checklist || [];
        state.checklist.push({ id: newId(), text: r.description, qty: '', cat, done: false, user_id: state.user_id, created_at: Date.now(), source: 'notificacion' });
        persist();
        res = { ok: true };
        break;
      }
      default:
        return { ok: false, msg: quote + ' no lo entendí' };
    }
    if (!res.ok) return { ok: false, retry: true, msg: quote + ': ' + res.error };
    return { ok: true, kind: r.intent, label: I.summary(r) };
  }

  async function runSync() {
    await window.AbacoApp.ready;
    if (typeof state !== 'object' || !state.user_id) return { saved: 0, failed: 0 };
    let list = [];
    try { list = JSON.parse(bridge().pendingQuickExpenses() || '[]'); } catch (e) { list = []; }
    if (!list.length) return { saved: 0, failed: 0 };
    const data = window.AbacoApp.data();
    const done = [];
    const failed = [];
    const savedItems = [];
    for (const item of list) {
      let r;
      try { r = await apply(item, data); } catch (err) { r = { ok: false, retry: true, msg: '«' + item.text + '»: ' + (err && err.message) }; }
      if (r.ok) { done.push(item.id); savedItems.push(r); continue; }
      if (!r.retry) done.push(item.id); // lo que no se entiende no se reintenta
      failed.push({ id: item.id, msg: r.msg });
    }
    const saved = savedItems.length;
    const allGastos = savedItems.every((x) => x.kind === 'gasto');
    const noun = allGastos ? (saved === 1 ? 'gasto' : 'gastos') : (saved === 1 ? 'cosa' : 'cosas');
    let message = '';
    if (saved === 1 && !allGastos) message = 'Listo: ' + savedItems[0].label + '.';
    else if (saved) message = 'Listo: guardé ' + saved + ' ' + noun + ' en Ábaco.';
    try { bridge().confirmQuickExpenses(JSON.stringify(done), message); } catch (e) { /* sin puente */ }
    if (saved) {
      window.AbacoApp.refreshUI();
      if (saved === 1) toast(allGastos ? 'Se guardó el gasto que anotaste en la notificación' : 'Guardé lo que anotaste: ' + savedItems[0].label);
      else toast('Se guardaron ' + saved + ' ' + noun + ' que anotaste en la notificación');
    }
    const fresh = failed.filter((f) => !warned.has(f.id));
    fresh.forEach((f) => warned.add(f.id));
    if (fresh.length) toast('No pude guardar ' + fresh.map((f) => f.msg).join(' · '));
    return { saved, failed: failed.length };
  }

  async function sync() {
    if (!available()) return { saved: 0, failed: 0 };
    if (running) return running;
    running = runSync().catch((err) => { console.warn('Gastos de la notificación', err); return { saved: 0, failed: 0 }; });
    try { return await running; } finally { running = null; }
  }

  /* Abrir Ábaco desde la notificación lleva a Registrar con el monto listo para escribir. */
  async function open(panel) {
    await window.AbacoApp.ready;
    if (typeof state !== 'object' || !state.user_id || typeof goPanel !== 'function') return;
    goPanel(panel || 'hormiga');
    setTimeout(() => { const el = document.getElementById('hormAmount'); if (el) el.focus(); }, 200);
  }

  const api = { parse, guessCategory, available, enabled, setEnabled, sync, open };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') root.AbacoQuick = api;
})(typeof window !== 'undefined' ? window : globalThis);
