/* Ábaco · ideas de convivencia (lógica pura).
 *
 * Todo lo que no es dinero en sí sino la relación de la app con la persona:
 *   equivalencias en su propia unidad, pausa antes de pagar, cajón de decisiones,
 *   pactos, cartas de cierre de mes, préstamos entre sobres, preguntas sin prisa,
 *   medidas elegidas, silencio por encargo y la brújula.
 *
 * Reglas del tono: informar con cifras, ofrecer opciones, dejar decidir, no culpar.
 *
 * Este módulo no toca el documento. Opera sobre un objeto `extras` (se guarda dentro de los
 * datos de la app) y lo modifica en sitio; quien llama decide cuándo guardar.
 */
(function (root) {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const DEFAULT_UNITS = [
    { id: 'cafe', singular: 'café', plural: 'cafés', price: 80 },
    { id: 'cine', singular: 'ida al cine', plural: 'idas al cine', price: 120 },
    { id: 'comida', singular: 'comida', plural: 'comidas', price: 150 },
    { id: 'pasaje', singular: 'pasaje', plural: 'pasajes', price: 12 }
  ];

  const METRICS = [
    { id: 'colchon', label: 'Días de colchón', kind: 'days' },
    { id: 'hormiga', label: 'Gasto hormiga', kind: 'money' },
    { id: 'ahorro', label: 'Ahorrado', kind: 'money' },
    { id: 'sobra', label: 'Lo que me sobra del mes', kind: 'money' }
  ];

  const TONES = ['directo', 'amable', 'silencioso'];

  const money = (n) => '$' + (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
  const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const makeId = (p) => p + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  function defaults() {
    return {
      version: 1,
      prefs: {
        tone: 'amable', unitId: null, customUnits: [], pause: true, pauseSeconds: 5,
        silenceUntil: null, metrics: ['colchon', 'hormiga'], bigAmount: 500, decisionDays: 90
      },
      decisions: [], pacts: [], letters: [], letterSkips: [], borrows: [], answers: {}, pendingMoney: []
    };
  }

  /* Completa lo que falte sin perder lo que ya hay (por si se guardó una versión anterior). */
  function normalize(raw) {
    const base = defaults();
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = { ...base, ...src, prefs: { ...base.prefs, ...(src.prefs || {}) } };
    for (const k of ['decisions', 'pacts', 'letters', 'letterSkips', 'borrows', 'pendingMoney']) if (!Array.isArray(out[k])) out[k] = [];
    if (!out.answers || typeof out.answers !== 'object') out.answers = {};
    if (!Array.isArray(out.prefs.customUnits)) out.prefs.customUnits = [];
    if (!Array.isArray(out.prefs.metrics)) out.prefs.metrics = base.prefs.metrics.slice();
    if (!TONES.includes(out.prefs.tone)) out.prefs.tone = 'amable';
    return out;
  }

  /* ---------- tono y silencio ---------- */

  /* Elige el texto según el tono. En "silencioso" se usa el amable (solo se muestra si la persona toca). */
  function say(extras, variants) {
    const tone = extras.prefs.tone;
    return tone === 'directo' && variants.directo != null ? variants.directo : (variants.amable != null ? variants.amable : variants.directo);
  }

  function isSilent(extras, now) {
    const until = extras.prefs.silenceUntil;
    if (extras.prefs.tone === 'silencioso') return true;
    return !!until && num(now) < until;
  }

  /* Próximo lunes a las 00:00, hora local. Si hoy es lunes, el siguiente. */
  function nextMonday(now) {
    const d = new Date(now);
    const add = ((8 - d.getDay()) % 7) || 7;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + add).getTime();
  }

  function setSilence(extras, until) { extras.prefs.silenceUntil = until; return until; }
  function clearSilence(extras) { extras.prefs.silenceUntil = null; }

  /* ---------- equivalencias ---------- */

  function units(extras) { return DEFAULT_UNITS.concat(extras.prefs.customUnits); }

  function selectedUnit(extras) {
    const id = extras.prefs.unitId;
    return id ? units(extras).find((u) => u.id === id) || null : null;
  }

  function setUnit(extras, id) {
    if (id !== null && !units(extras).some((u) => u.id === id)) return false;
    extras.prefs.unitId = id;
    return true;
  }

  function addUnit(extras, { singular, plural, price }) {
    const name = String(singular || '').trim();
    const p = num(price);
    if (!name) return { ok: false, error: 'Ponle un nombre a la unidad' };
    if (!(p > 0)) return { ok: false, error: 'El precio debe ser mayor que cero' };
    const unit = { id: makeId('u'), singular: name, plural: String(plural || '').trim() || name + 's', price: p };
    extras.prefs.customUnits.push(unit);
    return { ok: true, unit };
  }

  function removeUnit(extras, id) {
    const before = extras.prefs.customUnits.length;
    extras.prefs.customUnits = extras.prefs.customUnits.filter((u) => u.id !== id);
    if (extras.prefs.unitId === id) extras.prefs.unitId = null;
    return extras.prefs.customUnits.length < before;
  }

  /* "Son 3 cafés" para un monto, o null si no hay unidad o monto. */
  function equivalence(amount, unit) {
    const a = num(amount);
    if (!unit || !(unit.price > 0) || !(a > 0)) return null;
    const raw = a / unit.price;
    const n = raw >= 3 ? Math.round(raw) : Math.round(raw * 10) / 10;
    let text;
    if (n < 1) text = 'Menos de 1 ' + unit.singular;
    else if (n === 1) text = 'Es 1 ' + unit.singular;
    else text = 'Son ' + n + ' ' + unit.plural;
    return { n, text, unit: unit.id };
  }

  /* ---------- pausa antes de pagar ---------- */

  function shouldPause(extras, { impulse }) {
    return !!(extras.prefs.pause && impulse);
  }

  /* ---------- cajón de decisiones ---------- */

  function addDecision(extras, { title, amount, reason, kind, now }) {
    const t = String(title || '').trim();
    if (!t) return { ok: false, error: 'Anota de qué se trata' };
    const item = {
      id: makeId('d'), title: t, amount: num(amount), reason: String(reason || '').trim(),
      kind: kind === 'no-compre' ? 'no-compre' : 'compra', ts: num(now) || Date.now(),
      verdict: null, answeredAt: null, snoozeUntil: 0
    };
    extras.decisions.push(item);
    return { ok: true, decision: item };
  }

  function dueDecisions(extras, now) {
    const limit = extras.prefs.decisionDays * DAY;
    return extras.decisions
      .filter((d) => d.kind === 'compra' && d.verdict === null && num(now) - d.ts >= limit && num(now) >= (d.snoozeUntil || 0))
      .sort((a, b) => a.ts - b.ts);
  }

  function answerDecision(extras, id, verdict, now) {
    const d = extras.decisions.find((x) => x.id === id);
    if (!d) return false;
    if (verdict === 'luego') { d.snoozeUntil = num(now) + 14 * DAY; return true; }
    if (verdict !== 'si' && verdict !== 'no') return false;
    d.verdict = verdict;
    d.answeredAt = num(now);
    return true;
  }

  function removeDecision(extras, id) {
    const before = extras.decisions.length;
    extras.decisions = extras.decisions.filter((d) => d.id !== id);
    return extras.decisions.length < before;
  }

  /* ---------- pactos ---------- */

  function addPact(extras, { title, now }) {
    const t = String(title || '').trim();
    if (!t) return { ok: false, error: 'Escribe en qué consiste el pacto' };
    const pact = { id: makeId('p'), title: t, createdAt: num(now) || Date.now(), log: [] };
    extras.pacts.push(pact);
    return { ok: true, pact };
  }

  function logPact(extras, id, { ok, note, now }) {
    const p = extras.pacts.find((x) => x.id === id);
    if (!p) return false;
    p.log.push({ ts: num(now) || Date.now(), ok: !!ok, note: String(note || '').trim() });
    return true;
  }

  function pactStats(pact) {
    const total = pact.log.length;
    const done = pact.log.filter((l) => l.ok).length;
    const broken = pact.log.filter((l) => !l.ok);
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0, lastBroken: broken.length ? broken[broken.length - 1] : null };
  }

  function removePact(extras, id) {
    const before = extras.pacts.length;
    extras.pacts = extras.pacts.filter((p) => p.id !== id);
    return extras.pacts.length < before;
  }

  /* ---------- preguntas sin prisa ---------- */

  function monthKeyOf(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function prevMonthKey(ts) {
    const d = new Date(ts);
    return monthKeyOf(new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime());
  }

  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return MONTHS[m - 1] + (y ? ' ' + y : '');
  }

  function monthName(key) {
    return MONTHS[Number(key.split('-')[1]) - 1];
  }

  function monthRange(key) {
    const [y, m] = key.split('-').map(Number);
    return { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime() };
  }

  /* Una suscripción a la vez, solo si no se respondió este mes y no se pidió "luego" hoy. */
  function pendingQuestion(extras, subscriptions, now) {
    if (isSilent(extras, now)) return null;
    const key = monthKeyOf(now);
    for (const sub of subscriptions || []) {
      const a = extras.answers[sub.id + ':' + key];
      if (a && (a.a === 'si' || a.a === 'no')) continue;
      if (a && a.a === 'luego' && num(now) - a.at < DAY) continue;
      return { sub, key };
    }
    return null;
  }

  function answerQuestion(extras, subId, answer, now) {
    if (!['si', 'no', 'luego'].includes(answer)) return false;
    extras.answers[subId + ':' + monthKeyOf(now)] = { a: answer, at: num(now) };
    return true;
  }

  /* ---------- préstamos entre sobres ---------- */

  /* Valida y calcula los nuevos montos. Se puede pedir prestado solo de lo que le queda al sobre. */
  function borrowPlan(budgets, fromCat, toCat, amount) {
    const a = num(amount);
    const from = (budgets || []).find((b) => b.category === fromCat);
    const to = (budgets || []).find((b) => b.category === toCat);
    if (!from || !to) return { ok: false, error: 'Elige dos sobres que existan' };
    if (from.category === to.category) return { ok: false, error: 'Elige dos sobres distintos' };
    if (!(a > 0)) return { ok: false, error: 'El monto debe ser mayor que cero' };
    const room = num(from.amount) - num(from.spent);
    if (a > room) return { ok: false, error: from.category + ' solo tiene ' + money(Math.max(0, room)) + ' disponibles' };
    return { ok: true, fromAmount: num(from.amount) - a, toAmount: num(to.amount) + a };
  }

  function recordBorrow(extras, { from, to, amount, note, now }) {
    const b = { id: makeId('b'), from, to, amount: num(amount), note: String(note || '').trim(), ts: num(now) || Date.now(), undone: false };
    extras.borrows.push(b);
    return b;
  }

  function undoBorrow(extras, id) {
    const b = extras.borrows.find((x) => x.id === id);
    if (!b || b.undone) return null;
    b.undone = true;
    return b;
  }

  /* ---------- medidas elegidas ---------- */

  function sumIn(list, from, to) {
    return (list || []).filter((x) => x.created_at >= from && x.created_at < to).reduce((s, x) => s + num(x.amount), 0);
  }

  function computeMetrics(view, now) {
    const { from, to } = monthRange(monthKeyOf(now));
    const available = num(view.totals && view.totals.available);
    const last30 = (view.expenses || []).filter((e) => e.created_at >= now - 30 * DAY && e.created_at <= now);
    const daily = last30.reduce((s, e) => s + num(e.amount), 0) / 30;
    const small = (view.expenses || []).filter((e) => e.created_at >= from && e.created_at < to && num(e.amount) <= 100);
    return {
      colchon: daily > 0 ? Math.floor(available / daily) : null,
      hormiga: small.reduce((s, e) => s + num(e.amount), 0),
      ahorro: (view.savings || []).reduce((s, g) => s + num(g.amount), 0),
      sobra: sumIn(view.incomes, from, to) - sumIn(view.expenses, from, to)
    };
  }

  function formatMetric(id, value) {
    if (value === null || value === undefined) return '—';
    const m = METRICS.find((x) => x.id === id);
    return m && m.kind === 'days' ? value + (value === 1 ? ' día' : ' días') : money(value);
  }

  /* ---------- cartas de cierre de mes ---------- */

  function monthSummary(view, key) {
    const { from, to } = monthRange(key);
    const exp = (view.expenses || []).filter((e) => e.created_at >= from && e.created_at < to);
    const byCat = {};
    for (const e of exp) byCat[e.category] = (byCat[e.category] || 0) + num(e.amount);
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0] || null;
    return {
      income: sumIn(view.incomes, from, to),
      expense: exp.reduce((s, e) => s + num(e.amount), 0),
      count: exp.length + (view.incomes || []).filter((i) => i.created_at >= from && i.created_at < to).length,
      topCat: top ? { category: top[0], amount: top[1] } : null
    };
  }

  function buildLetter({ name, monthKey, summary, overBudget, goal, available, tone, catName, unit, partial }) {
    const mes = monthName(monthKey);
    const next = MONTHS[(MONTHS.indexOf(mes) + 1) % 12];
    const paragraphs = [];
    const directo = tone === 'directo';
    const label = (c) => (catName ? catName(c) : c);

    if (summary.topCat) {
      let p = directo
        ? 'Lo que más pesó en ' + mes + ': ' + label(summary.topCat.category).toLowerCase() + ', ' + money(summary.topCat.amount) + '.'
        : 'En ' + mes + ' lo que más pesó fue ' + label(summary.topCat.category).toLowerCase() + ': ' + money(summary.topCat.amount) + '.';
      const eq = equivalence(summary.topCat.amount, unit);
      if (eq) p += ' ' + eq.text + '.';
      if (overBudget && overBudget.length) {
        const o = overBudget[0];
        p += ' ' + label(o.category) + ' quedó ' + money(o.over) + ' por encima de lo que habías apartado.';
      } else if (overBudget) {
        p += ' Respetaste lo que apartaste en tus sobres.';
      }
      paragraphs.push(p);
    } else {
      paragraphs.push('En ' + mes + ' casi no hubo gastos registrados.');
    }

    const diff = summary.income - summary.expense;
    let p2 = diff >= 0
      ? 'Entraron ' + money(summary.income) + ' y salieron ' + money(summary.expense) + ': te quedaron ' + money(diff) + ' a favor.'
      : 'Salió ' + money(-diff) + ' más de lo que entró (' + money(summary.expense) + ' contra ' + money(summary.income) + ').';
    if (goal) p2 += ' Tu meta "' + goal.name + '" va en ' + goal.pct + '%.';
    paragraphs.push(p2);

    paragraphs.push(partial
      ? 'Hasta hoy tienes ' + money(available) + ' disponibles.'
      : 'Empiezas ' + next + ' con ' + money(available) + ' disponibles.' + (directo ? '' : ' Si te sirve, lo revisamos juntos la próxima semana.'));

    return {
      title: 'Carta de ' + mes + (partial ? ' (hasta hoy)' : ''),
      greeting: 'Hola, ' + (name || 'tú') + '.',
      paragraphs,
      signoff: directo ? 'Ábaco' : 'Con cariño, tu Ábaco'
    };
  }

  function letterText(letter) {
    return letter.paragraphs.join('\n\n');
  }

  /* Mes anterior si todavía no tiene carta, no la borraron y hubo movimientos. */
  function letterDue(extras, now, view) {
    const key = prevMonthKey(now);
    if (extras.letters.some((l) => l.monthKey === key)) return null;
    if (extras.letterSkips.includes(key)) return null;
    return monthSummary(view, key).count > 0 ? key : null;
  }

  function addLetter(extras, { monthKey, letter, now }) {
    const item = {
      id: makeId('l'), monthKey, createdAt: num(now) || Date.now(), title: letter.title,
      greeting: letter.greeting, paragraphs: letter.paragraphs.slice(), signoff: letter.signoff,
      state: 'nueva', edited: false
    };
    extras.letters = extras.letters.filter((l) => l.monthKey !== monthKey).concat(item);
    extras.letterSkips = extras.letterSkips.filter((k) => k !== monthKey);
    return item;
  }

  function keepLetter(extras, id) {
    const l = extras.letters.find((x) => x.id === id);
    if (!l) return false;
    l.state = 'guardada';
    return true;
  }

  function editLetter(extras, id, text) {
    const l = extras.letters.find((x) => x.id === id);
    const paragraphs = String(text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    if (!l || !paragraphs.length) return false;
    l.paragraphs = paragraphs;
    l.edited = true;
    if (l.state === 'nueva') l.state = 'guardada';
    return true;
  }

  /* Borrar es definitivo: el mes se anota para que la carta no vuelva a aparecer sola. */
  function deleteLetter(extras, id) {
    const l = extras.letters.find((x) => x.id === id);
    if (!l) return false;
    extras.letters = extras.letters.filter((x) => x.id !== id);
    if (!extras.letterSkips.includes(l.monthKey)) extras.letterSkips.push(l.monthKey);
    return true;
  }

  /* ---------- brújula ---------- */

  /* Norte = ahorro, este = meta, sur = gasto, oeste = deuda. La aguja apunta a donde conviene mirar. */
  const COMPASS_ANGLE = { ahorro: 0, meta: 90, gasto: 180, deuda: 270 };

  function compass(view, extras, now, catNameFn) {
    const budgets = (view.budgets || []).map((b) => ({ category: b.category, over: num(b.spent) - num(b.amount) })).filter((b) => b.over > 0).sort((a, b) => b.over - a.over);
    const available = num(view.totals && view.totals.available);
    const debt = num(view.totals && view.totals.debt);
    const goals = (view.savings || []).filter((g) => num(g.target) > 0 && num(g.amount) < num(g.target))
      .map((g) => ({ name: g.name, pct: Math.floor((num(g.amount) / num(g.target)) * 100) })).sort((a, b) => b.pct - a.pct);
    const catName = catNameFn || ((c) => c);
    let key;
    let detail;
    let headline;
    if (budgets.length) {
      key = 'gasto';
      const b = budgets[0];
      headline = 'Hay un sobre que mirar';
      detail = say(extras, {
        directo: catName(b.category) + ': ' + money(b.over) + ' por encima del sobre.',
        amable: 'Me sacudo un poquito porque ' + catName(b.category).toLowerCase() + ' está ' + money(b.over) + ' arriba este mes. Ahí conviene mirar, sin prisa.'
      });
    } else if (debt > 0 && debt > available) {
      key = 'deuda';
      headline = 'Las deudas pesan más que lo disponible';
      detail = say(extras, {
        directo: 'Deuda ' + money(debt) + ' contra ' + money(available) + ' disponibles.',
        amable: 'Debes ' + money(debt) + ' y tienes ' + money(available) + ' disponibles. Mirar ahí primero ayuda a ordenar lo demás.'
      });
    } else if (goals.length) {
      key = 'meta';
      headline = 'Vas en buen rumbo';
      detail = say(extras, {
        directo: 'Meta "' + goals[0].name + '": ' + goals[0].pct + '%.',
        amable: 'Voy hacia tu meta "' + goals[0].name + '", que lleva ' + goals[0].pct + '%. Nada se sale del rumbo ahora.'
      });
    } else {
      key = 'ahorro';
      headline = 'Todo en orden';
      detail = say(extras, {
        directo: 'Sin sobres excedidos ni deudas por encima de lo disponible.',
        amable: 'Todo está en orden. Un buen rumbo ahora es apartar algo para ahorrar, si quieres.'
      });
    }
    return { key, angle: COMPASS_ANGLE[key], calm: key !== 'gasto' && key !== 'deuda', headline, detail };
  }

  const api = {
    DAY, MONTHS, DEFAULT_UNITS, METRICS, TONES, COMPASS_ANGLE,
    money, defaults, normalize, clone, say, isSilent, nextMonday, setSilence, clearSilence,
    units, selectedUnit, setUnit, addUnit, removeUnit, equivalence, shouldPause,
    addDecision, dueDecisions, answerDecision, removeDecision,
    addPact, logPact, pactStats, removePact,
    monthKeyOf, prevMonthKey, monthLabel, monthName, monthRange, pendingQuestion, answerQuestion,
    borrowPlan, recordBorrow, undoBorrow,
    computeMetrics, formatMetric,
    monthSummary, buildLetter, letterText, letterDue, addLetter, keepLetter, editLetter, deleteLetter,
    compass
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AbacoExtras = api;
})(typeof window !== 'undefined' ? window : globalThis);
