/* Pruebas de la lógica de convivencia. Ejecutar: node --test tests/extras.test.js */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const X = require('../js/abaco-extras.js');

const DAY = X.DAY;
const NOW = new Date(2026, 10, 7, 12, 0).getTime(); // 7 nov 2026, sábado

const fresh = () => X.normalize(null);

test('normalize completa lo que falta y conserva lo guardado', () => {
  const e = X.normalize({ prefs: { tone: 'directo' }, pacts: [{ id: 'p1', title: 'x', log: [] }] });
  assert.equal(e.prefs.tone, 'directo');
  assert.equal(e.prefs.pause, true);
  assert.equal(e.pacts.length, 1);
  assert.deepEqual(e.decisions, []);
  assert.equal(X.normalize({ prefs: { tone: 'raro' } }).prefs.tone, 'amable');
});

test('equivalencia: "Son 3 cafés" y casos de borde', () => {
  const cafe = X.DEFAULT_UNITS[0];
  assert.equal(X.equivalence(240, cafe).text, 'Son 3 cafés');
  assert.equal(X.equivalence(80, cafe).text, 'Es 1 café');
  assert.equal(X.equivalence(40, cafe).text, 'Menos de 1 café');
  assert.equal(X.equivalence(120, cafe).n, 1.5);
  assert.equal(X.equivalence(0, cafe), null);
  assert.equal(X.equivalence(100, null), null);
});

test('por defecto no hay unidad: nunca compara si la persona no eligió', () => {
  const e = fresh();
  assert.equal(X.selectedUnit(e), null);
  assert.equal(X.setUnit(e, 'cine'), true);
  assert.equal(X.selectedUnit(e).id, 'cine');
  assert.equal(X.setUnit(e, 'no-existe'), false);
  assert.equal(X.selectedUnit(e).id, 'cine');
  assert.equal(X.setUnit(e, null), true);
  assert.equal(X.selectedUnit(e), null);
});

test('unidades propias: validan y se pueden quitar', () => {
  const e = fresh();
  assert.equal(X.addUnit(e, { singular: '', price: 10 }).ok, false);
  assert.equal(X.addUnit(e, { singular: 'taco', price: 0 }).ok, false);
  const r = X.addUnit(e, { singular: 'taco', plural: 'tacos', price: 25 });
  assert.equal(r.ok, true);
  X.setUnit(e, r.unit.id);
  assert.equal(X.equivalence(100, X.selectedUnit(e)).text, 'Son 4 tacos');
  assert.equal(X.removeUnit(e, r.unit.id), true);
  assert.equal(X.selectedUnit(e), null);
});

test('pausa: solo cuando está activa y la compra es por impulso', () => {
  const e = fresh();
  assert.equal(X.shouldPause(e, { impulse: true }), true);
  assert.equal(X.shouldPause(e, { impulse: false }), false);
  e.prefs.pause = false;
  assert.equal(X.shouldPause(e, { impulse: true }), false);
});

test('silencio por encargo: hasta el lunes y modo silencioso', () => {
  const e = fresh();
  assert.equal(X.isSilent(e, NOW), false);
  const lunes = X.nextMonday(NOW);
  assert.equal(new Date(lunes).getDay(), 1);
  assert.equal(new Date(lunes).getDate(), 9);
  X.setSilence(e, lunes);
  assert.equal(X.isSilent(e, NOW), true);
  assert.equal(X.isSilent(e, lunes + 1), false);
  X.clearSilence(e);
  assert.equal(X.isSilent(e, NOW), false);
  // Un lunes, el siguiente lunes es en 7 días.
  assert.equal(new Date(X.nextMonday(new Date(2026, 10, 9, 8).getTime())).getDate(), 16);
  e.prefs.tone = 'silencioso';
  assert.equal(X.isSilent(e, NOW), true);
});

test('el tono elige el texto', () => {
  const e = fresh();
  const v = { directo: 'seco', amable: 'cálido' };
  assert.equal(X.say(e, v), 'cálido');
  e.prefs.tone = 'directo';
  assert.equal(X.say(e, v), 'seco');
  e.prefs.tone = 'silencioso';
  assert.equal(X.say(e, v), 'cálido');
});

test('decisiones: preguntan a los 90 días y se pueden posponer sin culpa', () => {
  const e = fresh();
  assert.equal(X.addDecision(e, { title: '' }).ok, false);
  const d = X.addDecision(e, { title: 'Audífonos', amount: 1200, reason: 'Para trabajar', now: NOW - 91 * DAY }).decision;
  X.addDecision(e, { title: 'Reciente', amount: 700, now: NOW - 10 * DAY });
  X.addDecision(e, { title: 'Cena', amount: 300, kind: 'no-compre', now: NOW - 200 * DAY });
  const due = X.dueDecisions(e, NOW);
  assert.deepEqual(due.map((x) => x.title), ['Audífonos']);
  X.answerDecision(e, d.id, 'luego', NOW);
  assert.equal(X.dueDecisions(e, NOW).length, 0);
  assert.equal(X.dueDecisions(e, NOW + 15 * DAY).length, 1);
  assert.equal(X.answerDecision(e, d.id, 'si', NOW + 15 * DAY), true);
  assert.equal(d.verdict, 'si');
  assert.equal(X.dueDecisions(e, NOW + 30 * DAY).length, 0);
  assert.equal(X.answerDecision(e, d.id, 'quizá', NOW), false);
});

test('pactos: llevan la cuenta y anotan lo roto sin castigo', () => {
  const e = fresh();
  assert.equal(X.addPact(e, { title: '  ' }).ok, false);
  const p = X.addPact(e, { title: 'No delivery los martes', now: NOW }).pact;
  for (let i = 0; i < 3; i++) X.logPact(e, p.id, { ok: true, now: NOW + i });
  X.logPact(e, p.id, { ok: false, note: 'fue mi cumpleaños', now: NOW + 9 });
  const s = X.pactStats(p);
  assert.equal(s.done, 3);
  assert.equal(s.total, 4);
  assert.equal(s.pct, 75);
  assert.equal(s.lastBroken.note, 'fue mi cumpleaños');
  assert.equal(X.logPact(e, 'nada', { ok: true }), false);
  assert.equal(X.removePact(e, p.id), true);
  assert.equal(e.pacts.length, 0);
});

test('preguntas: una suscripción a la vez, "luego" espera un día y silencio las calla', () => {
  const e = fresh();
  const subs = [{ id: 's1', name: 'Streaming' }, { id: 's2', name: 'Música' }];
  assert.equal(X.pendingQuestion(e, subs, NOW).sub.id, 's1');
  X.answerQuestion(e, 's1', 'luego', NOW);
  assert.equal(X.pendingQuestion(e, subs, NOW).sub.id, 's2', 'pasa a la siguiente');
  X.answerQuestion(e, 's2', 'no', NOW);
  assert.equal(X.pendingQuestion(e, subs, NOW), null, 's1 espera hasta mañana');
  assert.equal(X.pendingQuestion(e, subs, NOW + DAY + 1).sub.id, 's1');
  X.answerQuestion(e, 's1', 'si', NOW + DAY + 1);
  assert.equal(X.pendingQuestion(e, subs, NOW + DAY + 2), null);
  // El mes siguiente se vuelve a preguntar.
  assert.ok(X.pendingQuestion(e, subs, new Date(2026, 11, 3).getTime()));
  X.setSilence(e, new Date(2026, 11, 10).getTime());
  assert.equal(X.pendingQuestion(e, subs, new Date(2026, 11, 3).getTime()), null, 'en silencio no pregunta');
  assert.ok(X.pendingQuestion(e, subs, new Date(2026, 11, 11).getTime()), 'termina el silencio y vuelve a preguntar');
  assert.equal(X.answerQuestion(e, 's1', 'raro', NOW), false);
});

test('préstamo entre sobres: solo de lo que queda, y se puede deshacer', () => {
  const budgets = [
    { category: 'comida', amount: 3000, spent: 3670 },
    { category: 'transporte', amount: 1000, spent: 300 },
    { category: 'ocio', amount: 800, spent: 0 }
  ];
  assert.equal(X.borrowPlan(budgets, 'comida', 'ocio', 100).ok, false, 'comida no tiene remanente');
  assert.equal(X.borrowPlan(budgets, 'transporte', 'transporte', 100).ok, false);
  assert.equal(X.borrowPlan(budgets, 'transporte', 'nada', 100).ok, false);
  assert.equal(X.borrowPlan(budgets, 'transporte', 'comida', 0).ok, false);
  assert.match(X.borrowPlan(budgets, 'transporte', 'comida', 900).error, /solo tiene \$700/);
  const ok = X.borrowPlan(budgets, 'transporte', 'comida', 200);
  assert.deepEqual([ok.ok, ok.fromAmount, ok.toAmount], [true, 800, 3200]);
  const e = fresh();
  const b = X.recordBorrow(e, { from: 'transporte', to: 'comida', amount: 200, note: 'despensa', now: NOW });
  assert.equal(e.borrows.length, 1);
  assert.equal(X.undoBorrow(e, b.id).amount, 200);
  assert.equal(X.undoBorrow(e, b.id), null, 'no se deshace dos veces');
});

test('medidas elegidas', () => {
  const view = {
    totals: { available: 3000 },
    savings: [{ amount: 500 }, { amount: 250 }],
    incomes: [{ amount: 10000, created_at: NOW - DAY }],
    expenses: [
      { amount: 60, category: 'comida', created_at: NOW - DAY },
      { amount: 40, category: 'comida', created_at: NOW - 2 * DAY },
      { amount: 2900, category: 'hogar', created_at: NOW - 3 * DAY }
    ]
  };
  const m = X.computeMetrics(view, NOW);
  assert.equal(m.hormiga, 100);
  assert.equal(m.ahorro, 750);
  assert.equal(m.sobra, 7000);
  assert.equal(m.colchon, 30); // 3000 / (3000/30 por día)
  assert.equal(X.formatMetric('colchon', 1), '1 día');
  assert.equal(X.formatMetric('colchon', 30), '30 días');
  assert.equal(X.formatMetric('hormiga', 100), '$100');
  assert.equal(X.formatMetric('colchon', null), '—');
  assert.equal(X.computeMetrics({ totals: { available: 10 }, expenses: [], incomes: [], savings: [] }, NOW).colchon, null);
});

const octubre = new Date(2026, 9, 15).getTime();
const viewOct = {
  totals: { available: 48250 },
  incomes: [{ amount: 32400, created_at: octubre }],
  expenses: [
    { amount: 3670, category: 'comida', created_at: octubre },
    { amount: 1000, category: 'ocio', created_at: octubre }
  ],
  budgets: [{ category: 'comida', amount: 3000, spent: 3670 }],
  savings: [{ name: 'Viaje', amount: 6000, target: 12000 }]
};

test('carta: se debe el mes anterior si hubo movimientos y no existe', () => {
  const e = fresh();
  assert.equal(X.letterDue(e, NOW, viewOct), '2026-10');
  assert.equal(X.letterDue(e, NOW, { incomes: [], expenses: [] }), null, 'sin movimientos no hay carta');
  X.addLetter(e, { monthKey: '2026-10', letter: { title: 't', greeting: 'g', paragraphs: ['a'], signoff: 's' }, now: NOW });
  assert.equal(X.letterDue(e, NOW, viewOct), null);
});

test('carta: cuenta lo que pasó con cifras y sin culpar', () => {
  const sum = X.monthSummary(viewOct, '2026-10');
  assert.equal(sum.income, 32400);
  assert.equal(sum.expense, 4670);
  assert.deepEqual(sum.topCat, { category: 'comida', amount: 3670 });
  const l = X.buildLetter({
    name: 'Hugo', monthKey: '2026-10', summary: sum, overBudget: [{ category: 'comida', over: 670 }],
    goal: { name: 'Viaje', pct: 50 }, available: 48250, tone: 'amable', catName: (c) => c[0].toUpperCase() + c.slice(1), unit: X.DEFAULT_UNITS[0]
  });
  assert.equal(l.title, 'Carta de octubre');
  assert.equal(l.greeting, 'Hola, Hugo.');
  const text = X.letterText(l);
  assert.match(text, /lo que más pesó fue comida: \$3,670/);
  assert.match(text, /Son 46 cafés/);
  assert.match(text, /Comida quedó \$670 por encima/);
  assert.match(text, /te quedaron \$27,730 a favor/);
  assert.match(text, /Viaje" va en 50%/);
  assert.match(text, /Empiezas noviembre con \$48,250/);
  assert.equal(l.signoff, 'Con cariño, tu Ábaco');
  assert.doesNotMatch(text, /culpa|mal|error|fracaso/i);
});

test('carta: tono directo es más seco y un mes con más gasto que ingreso no regaña', () => {
  const sum = { income: 1000, expense: 1500, count: 3, topCat: { category: 'hogar', amount: 900 } };
  const l = X.buildLetter({ name: 'Ana', monthKey: '2026-03', summary: sum, overBudget: [], available: 200, tone: 'directo' });
  const text = X.letterText(l);
  assert.match(text, /Salió \$500 más de lo que entró/);
  assert.match(text, /Respetaste lo que apartaste/);
  assert.equal(l.signoff, 'Ábaco');
  assert.doesNotMatch(text, /lo revisamos juntos/);
});

test('carta del mes en curso: dice "hasta hoy" en lugar de prometer el mes siguiente', () => {
  const sum = X.monthSummary(viewOct, '2026-10');
  const l = X.buildLetter({ name: 'Hugo', monthKey: '2026-10', summary: sum, available: 100, tone: 'amable', partial: true });
  assert.equal(l.title, 'Carta de octubre (hasta hoy)');
  assert.match(X.letterText(l), /Hasta hoy tienes \$100 disponibles/);
  assert.doesNotMatch(X.letterText(l), /Empiezas/);
});

test('carta: guardar, editar y borrar (borrar es definitivo)', () => {
  const e = fresh();
  const l = X.addLetter(e, { monthKey: '2026-10', letter: { title: 'Carta de octubre', greeting: 'Hola.', paragraphs: ['uno', 'dos'], signoff: 's' }, now: NOW });
  assert.equal(l.state, 'nueva');
  assert.equal(X.keepLetter(e, l.id), true);
  assert.equal(l.state, 'guardada');
  assert.equal(X.editLetter(e, l.id, 'nuevo uno\n\nnuevo dos\n\ntres'), true);
  assert.deepEqual(l.paragraphs, ['nuevo uno', 'nuevo dos', 'tres']);
  assert.equal(l.edited, true);
  assert.equal(X.editLetter(e, l.id, '   '), false);
  assert.equal(X.deleteLetter(e, l.id), true);
  assert.equal(e.letters.length, 0);
  assert.equal(X.letterDue(e, NOW, viewOct), null, 'no vuelve a aparecer sola');
  // La persona sí puede pedir esa carta otra vez a propósito.
  X.addLetter(e, { monthKey: '2026-10', letter: { title: 't', greeting: 'g', paragraphs: ['x'], signoff: 's' }, now: NOW });
  assert.equal(e.letterSkips.includes('2026-10'), false);
});

test('brújula: apunta a donde conviene mirar', () => {
  const e = fresh();
  const nombre = (c) => c[0].toUpperCase() + c.slice(1);
  const gasto = X.compass(viewOct, e, NOW, nombre);
  assert.equal(gasto.key, 'gasto');
  assert.equal(gasto.angle, 180);
  assert.equal(gasto.calm, false);
  assert.match(gasto.detail, /comida está \$670 arriba/);

  const meta = X.compass({ ...viewOct, budgets: [] }, e, NOW);
  assert.equal(meta.key, 'meta');
  assert.equal(meta.angle, 90);
  assert.equal(meta.calm, true);
  assert.match(meta.detail, /meta "Viaje"/);

  const deuda = X.compass({ totals: { available: 100, debt: 900 }, budgets: [], savings: [] }, e, NOW);
  assert.equal(deuda.key, 'deuda');
  assert.equal(deuda.angle, 270);

  const ahorro = X.compass({ totals: { available: 100, debt: 0 }, budgets: [], savings: [] }, e, NOW);
  assert.equal(ahorro.key, 'ahorro');
  assert.equal(ahorro.angle, 0);

  e.prefs.tone = 'directo';
  assert.equal(X.compass(viewOct, e, NOW, nombre).detail, 'Comida: $670 por encima del sobre.');
});
