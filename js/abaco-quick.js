/* Ábaco · gastos anotados desde la notificación de Android.
 *
 * La notificación fija (app/src/main/java/mx/abaco/app/QuickExpense.kt) guarda en una cola lo que
 * la persona escribe, por ejemplo "85 tacos". Al abrir o volver a Ábaco, sync() lee esa cola,
 * registra cada gasto con la hora en que se anotó y le dice a Android cuáles ya quedaron guardados.
 * Si un gasto no se puede guardar (por ejemplo, sin saldo), se queda en la cola para otro intento.
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
  const warned = new Set(); // avisar una sola vez por sesión de cada gasto que no se pudo guardar

  async function runSync() {
    await window.AbacoApp.ready;
    if (typeof state !== 'object' || !state.user_id) return { saved: 0, failed: 0 };
    let list = [];
    try { list = JSON.parse(bridge().pendingQuickExpenses() || '[]'); } catch (e) { list = []; }
    if (!list.length) return { saved: 0, failed: 0 };
    const data = window.AbacoApp.data();
    const done = [];
    const failed = [];
    let saved = 0;
    for (const item of list) {
      const p = parse(item.text);
      if (!p) { done.push(item.id); failed.push({ id: item.id, msg: '«' + item.text + '» no tiene un monto' }); continue; }
      const r = await data.expense({
        amount: p.amount, description: p.description || 'Gasto rápido',
        category: guessCategory(p.description, state.categories), source: 'notificacion',
        at: Number(item.at) > 0 ? Number(item.at) : undefined
      });
      if (r.ok) { done.push(item.id); saved++; } else failed.push({ id: item.id, msg: '«' + item.text + '»: ' + r.error });
    }
    const message = saved ? 'Listo: guardé ' + saved + (saved === 1 ? ' gasto' : ' gastos') + ' en Ábaco.' : '';
    try { bridge().confirmQuickExpenses(JSON.stringify(done), message); } catch (e) { /* sin puente */ }
    if (saved) {
      window.AbacoApp.refreshUI();
      toast(saved === 1 ? 'Se guardó el gasto que anotaste en la notificación' : 'Se guardaron ' + saved + ' gastos que anotaste en la notificación');
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
