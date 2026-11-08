/* Herramientas para TDAH (js/abaco-focus.js): volver sin culpa, trámites en pasos, lo que viene,
 * constancia y revisión de domingo. Primero el cálculo (sin navegador) y luego cada flujo en
 * Chromium, teléfono 390x844.
 * Ejecutar: node --test tests/focus.test.js
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const F = require('../js/abaco-focus.js');

const DAY = 86400000;
const at = (m, d, h = 12) => new Date(2026, m - 1, d, h).getTime();

/* ---------- cálculo ---------- */

test('volver: da la bienvenida a partir de 7 días sin abrir', () => {
  assert.equal(F.daysAway(at(11, 1), at(11, 8)), 7);
  assert.equal(F.shouldWelcomeBack(at(11, 1), at(11, 8)), true);
  assert.equal(F.shouldWelcomeBack(at(11, 2), at(11, 8)), false);
  assert.equal(F.shouldWelcomeBack(0, at(11, 8)), false, 'la primera vez no hay a qué volver');
  assert.equal(F.daysAway(at(11, 8, 1), at(11, 8, 23)), 0);
});

test('volver: solo ajusta las cuentas que se contestaron y que no cuadran', () => {
  const accounts = [{ id: 'a', name: 'Efectivo', balance: 1240 }, { id: 'b', name: 'Débito', balance: 8410 }, { id: 'c', name: 'Ahorro', balance: 100 }];
  const r = F.reconcile(accounts, { a: '620', b: '8410', c: '' });
  assert.deepEqual(r, [{ accountId: 'a', name: 'Efectivo', before: 1240, after: 620, diff: -620 }]);
  assert.deepEqual(F.reconcile(accounts, { c: '150.5' })[0].diff, 50.5);
});

test('lo que viene: ordena por cercanía y la barra se llena al acercarse', () => {
  const now = at(11, 8);
  const st = {
    subscriptions: [
      { id: 's1', name: 'Renta', amount: 6500, date: '2026-10-01', range: 'mensual' },
      { id: 's2', name: 'Streaming', amount: 199, date: '2026-10-09', range: 'mensual' },
      { id: 's3', name: 'Viejo', amount: 99, date: '2026-10-10', range: 'mensual', active: false }
    ],
    msiPlans: [{ id: 'p1', cardId: 'c1', concept: 'Tele', installments: [{ number: 1, amount: 500, due: at(11, 2), paid: true }, { number: 2, amount: 500, due: at(11, 11), paid: false }] }]
  };
  const list = F.upcoming(st, now);
  assert.deepEqual(list.map((c) => [c.name, c.days]), [['Streaming', 1], ['Tele', 3], ['Renta', 23]]);
  assert.ok(list[0].fill > list[1].fill && list[1].fill > list[2].fill);
  assert.equal(F.daysWord(0), 'hoy');
  assert.equal(F.daysWord(1), 'mañana');
  assert.equal(F.daysWord(9), 'en 9 días');
});

test('constancia: cuenta días distintos del mes y compara con el mejor mes', () => {
  const st = {
    expenses: [{ created_at: at(11, 1) }, { created_at: at(11, 1, 18) }, { created_at: at(11, 3) }, { created_at: at(10, 5) }, { created_at: at(10, 6) }, { created_at: at(10, 7) }],
    incomes: [{ created_at: at(11, 5) }]
  };
  const c = F.constancy(st, at(11, 8));
  assert.equal(c.count, 3);
  assert.deepEqual([...c.days].sort((a, b) => a - b), [1, 3, 5]);
  assert.equal(c.best, 3);
  assert.equal(c.record, true, 'empatar el mejor mes cuenta como el mejor');
  assert.equal(c.total, 30);
});

test('domingo: resume la semana contra la anterior y propone objetivos pequeños', () => {
  const now = at(11, 8);
  const st = {
    expenses: [
      { created_at: now - 1 * DAY, amount: 300, category: 'transporte' }, { created_at: now - 2 * DAY, amount: 200, category: 'comida' },
      { created_at: now - 8 * DAY, amount: 900, category: 'comida' }, { created_at: now - 9 * DAY, amount: 100, category: 'comida' }
    ]
  };
  const w = F.weekSummary(st, now);
  assert.equal(w.total, 500);
  assert.equal(w.prevTotal, 1000);
  assert.equal(w.top[0].category, 'transporte');
  assert.deepEqual([w.improved.category, w.improved.drop, w.improved.before, w.improved.after], ['comida', 800, 2, 1]);
  const goals = F.goalsFor('transporte');
  assert.equal(goals[0], 'Usar transporte público 2 veces');
  assert.equal(goals[goals.length - 1], 'Esta semana, nada');
  // Aparece en domingo y en lunes; no si ya se hizo esa semana.
  assert.equal(F.sundayDue({ sundays: [] }, at(11, 8)), true);
  assert.equal(F.sundayDue({ sundays: [] }, at(11, 9)), true);
  assert.equal(F.sundayDue({ sundays: [] }, at(11, 10)), false);
  assert.equal(F.sundayDue({ sundays: [{ week: F.sundayKey(at(11, 8)) }] }, at(11, 9)), false);
  assert.equal(F.sundayKey(at(11, 9)), F.sundayKey(at(11, 8)));
});

test('trámites: cuatro pasos claros para pagar la tarjeta y para cancelar', () => {
  const t = F.TRAMITES.tarjeta({ name: 'BBVA' });
  assert.equal(t.title, 'Pagar la tarjeta BBVA');
  assert.equal(t.steps.length, 4);
  assert.equal(t.steps[1].input, 'amount');
  assert.equal(t.steps[2].input, 'account');
  assert.equal(F.TRAMITES.cancelar({ name: 'Gimnasio' }).steps.length, 4);
});

/* ---------- en la app ---------- */

const APP_URL = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const CHROMIUM = process.env.ABACO_CHROMIUM || '/opt/pw-browsers/chromium';
let browser;
let context;
let page;
let errors = [];

before(async () => { browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'], timeout: 30000 }); });
after(async () => { if (browser) await browser.close(); });

async function openApp() {
  if (context) await context.close();
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  errors = [];
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP_URL + '?hora=10', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AbacoApp && window.AbacoApp.ready);
  await page.evaluate(() => window.AbacoApp.ready);
  await page.fill('#userName', 'Hugo');
  await page.click('#btnRegister');
  await page.waitForFunction(() => !!state.user_id);
  if (await page.isVisible('#btnSkipWalletQuiz')) await page.click('#btnSkipWalletQuiz');
  await page.evaluate(async () => {
    await AbacoApp.data().income({ description: 'Fondo', amount: 10000, type: 'otro' });
    const e = AbacoExtrasUI.extras();
    e.sundays = [{ week: AbacoFocus.sundayKey(Date.now()), goal: null, at: Date.now() }]; // sin la revisión de domingo, salvo donde se pruebe
    AbacoApp.refreshUI();
  });
}
beforeEach(async () => { await openApp(); });

const go = (n) => page.evaluate((x) => goPanel(x), n);
const hoy = () => page.$$eval('#homeToday .hoy-row .ht', (els) => els.map((e) => e.textContent));
const flowText = () => page.textContent('#focusFlow');

test('volver sin culpa: tras 12 días pregunta cuenta por cuenta y ajusta sin pedir detalle', async () => {
  const efectivoId = await page.evaluate(async () => {
    const ef = state.accounts.find((a) => a.name === 'Efectivo');
    await AbacoApp.data().adjustAccount(ef.id, 1240);
    AbacoApp.refreshUI();
    AbacoExtrasUI.extras().lastSeen = Date.now() - 12 * 86400000;
    return ef.id;
  });
  assert.equal(await page.evaluate(() => AbacoFocus.checkReturn()), true);
  assert.match(await flowText(), /Qué bueno verte/);
  assert.match(await flowText(), /Pasaron 12 días/);
  assert.match(await flowText(), /Son 2\./);
  await page.click('[data-fx="ret-start"]');
  // Primera cuenta: Efectivo (orden de la lista); escribe 620 con el teclado.
  const first = await page.textContent('.fx-q');
  for (const k of ['6', '2', '0']) await page.click('.fx-pad [data-k="' + k + '"]');
  assert.equal(await page.textContent('#fxAmount'), '$620');
  await page.click('[data-fx="ret-next"]');
  await page.click('[data-fx="ret-skip"]'); // la segunda: «No sé, déjalo igual»
  await page.waitForSelector('#focusFlow .fx-ok');
  const txt = await flowText();
  assert.match(txt, /Al día/);
  const r = await page.evaluate((id) => ({
    bal: state.accounts.find((a) => a.id === id).balance,
    sinDetalle: state.expenses.filter((e) => e.description === 'Gastos sin detalle').map((e) => e.amount),
    returns: AbacoExtrasUI.extras().returns.length
  }), efectivoId);
  if (/Efectivo/.test(first)) {
    assert.equal(r.bal, 620);
    assert.deepEqual(r.sinDetalle, [620]);
    assert.match(txt, /\$620/);
  }
  assert.equal(r.returns, 1);
  await page.click('[data-fx="close"]');
  assert.equal(await page.$('#focusFlow'), null);
  assert.equal(await page.evaluate(() => state.activePanel), 'inicio');
  // No vuelve a preguntar al reabrir el mismo día.
  assert.equal(await page.evaluate(() => AbacoFocus.checkReturn()), false);
  assert.deepEqual(errors, []);
});

test('volver: «Ahora no» cierra sin tocar nada', async () => {
  await page.evaluate(() => { AbacoExtrasUI.extras().lastSeen = Date.now() - 9 * 86400000; AbacoFocus.checkReturn(); });
  await page.click('#focusFlow [data-fx="close"]');
  assert.equal(await page.$('#focusFlow'), null);
  assert.equal(await page.evaluate(() => state.expenses.length), 0);
});

async function cardWithInstallment(daysAhead) {
  return page.evaluate(async (n) => {
    const d = AbacoApp.data();
    const card = (await d.createCard({ name: 'BBVA', limit: 20000 })).result;
    const due = new Date(Date.now() + n * 86400000);
    // Compra a 3 meses cuya primera mensualidad vence en n días.
    const purchase = new Date(due); purchase.setMonth(purchase.getMonth() - 1);
    const r = await d.msiPurchase({ cardId: card.id, concept: 'Tele', total: 3000, months: 3, purchaseDate: purchase.toISOString().slice(0, 10) });
    AbacoApp.refreshUI();
    return { card: card.id, ok: r.ok, err: r.error, plans: state.msiPlans.map((p) => p.installments.map((i) => [i.number, new Date(i.due).toDateString(), i.paid])) };
  }, daysAhead);
}

test('trámite: pagar la tarjeta aparece en Hoy con «4 pasitos», se puede pausar y retomar', async () => {
  const c = await cardWithInstallment(3);
  assert.ok(c.ok, c.err);
  await go('inicio');
  const titles = await hoy();
  assert.ok(titles.includes('Pagar la tarjeta BBVA'), JSON.stringify({ titles, plans: c.plans }));
  assert.match(await page.textContent('#homeToday'), /4 pasitos/);
  await page.click('#homeToday [data-fx="tramite"]');
  assert.match(await flowText(), /Paso 1 de 4/);
  assert.match(await flowText(), /Abre la app de tu banco/);
  await page.click('[data-fx="tram-next"]');
  assert.match(await flowText(), /Pago para no generar intereses/);
  assert.equal(await page.inputValue('#fxTramAmount'), '1000', 'propone lo que vence');
  // «Lo sigo después» guarda el paso.
  await page.click('.fx-link[data-fx="tram-later"]');
  assert.equal(await page.$('#focusFlow'), null);
  assert.match(await page.textContent('#homeToday'), /vas en el paso 2/);
  await page.click('#homeToday [data-fx="tramite"]');
  assert.match(await flowText(), /Paso 2 de 4/);
  // Temporizador opcional: se enciende al tocar.
  await page.click('[data-fx="timer"]');
  await page.waitForFunction(() => document.getElementById('fxTime').textContent !== '2:00', null, { timeout: 3000 });
  await page.click('[data-fx="tram-next"]');
  assert.match(await flowText(), /Haz el pago/);
  await page.click('[data-fx="tram-next"]');
  assert.match(await flowText(), /Confírmalo aquí/);
  await page.click('[data-fx="tram-next"]');
  await page.waitForSelector('#focusFlow .fx-ok');
  assert.match(await flowText(), /Tarjeta pagada/);
  assert.match(await flowText(), /Anoté el pago de \$1,000/);
  const paid = await page.evaluate(() => state.msiPlans[0].installments.filter((i) => i.paid).length);
  assert.ok(paid >= 1);
  await page.click('#focusFlow [data-fx="close"]');
  await go('inicio');
  assert.ok(!(await hoy()).includes('Pagar la tarjeta BBVA'), 'ya no aparece en Hoy');
  assert.deepEqual(errors, []);
});

test('lo que viene: barras por cercanía, «¿lo usaste?» y cancelar en pasos', async () => {
  await page.evaluate(() => {
    const ymd = (n) => { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10); };
    state.subscriptions = [
      { id: 'g', name: 'Gimnasio', amount: 450, date: ymd(2), range: 'mensual', active: true },
      { id: 'm', name: 'Música', amount: 129, date: ymd(9), range: 'mensual', active: true }
    ];
    AbacoApp.refreshUI();
  });
  await go('proximos');
  assert.equal(await page.textContent('#tbTitle'), 'Lo que viene');
  const rows = await page.$$eval('#fx-proximos .fx-charge', (els) => els.map((e) => e.querySelector('.fx-row b').textContent));
  assert.deepEqual(rows, ['Gimnasio', 'Música']);
  const widths = await page.$$eval('#fx-proximos .fx-bar i', (els) => els.map((e) => parseFloat(e.style.width)));
  assert.ok(widths[0] > widths[1], 'la barra del cobro más cercano está más llena');
  await page.click('#fx-proximos [data-fx="uso"]');
  assert.match(await page.textContent('#calmSheet'), /¿Usaste gimnasio este mes\?/);
  await page.click('#calmSheet [data-v="no"]');
  const r = await page.evaluate(() => ({ use: AbacoExtrasUI.extras().subUse.g.answer, rem: state.reminders.map((x) => x.text) }));
  assert.equal(r.use, 'no');
  assert.deepEqual(r.rem, ['Cancelar Gimnasio antes de que se cobre']);
  assert.match(await page.textContent('#fx-proximos'), /cancelar en pasos/);
  await go('inicio');
  assert.ok((await hoy()).includes('Cancelar Gimnasio'));
  await page.click('#homeToday [data-kind="cancelar"]');
  for (let i = 0; i < 4; i++) await page.click('[data-fx="tram-next"]');
  await page.waitForSelector('#focusFlow .fx-ok');
  assert.match(await flowText(), /Gimnasio cancelada/);
  assert.equal(await page.evaluate(() => state.subscriptions.find((s) => s.id === 'g').active), false);
  await page.click('#focusFlow [data-fx="close"]');
  await go('proximos');
  assert.deepEqual(await page.$$eval('#fx-proximos .fx-charge .fx-row b:first-child', (els) => els.map((e) => e.textContent)), ['Música']);
  assert.deepEqual(errors, []);
});

test('constancia: días anotados, calendario sin rojo y lo que vas juntando', async () => {
  await page.evaluate(async () => {
    const d = AbacoApp.data();
    await d.expense({ amount: 50, description: 'Café', category: 'comida' });
    AbacoExtras.addDecision(AbacoExtrasUI.extras(), { title: 'Audífonos', amount: 1200, reason: 'Decidí no comprarlo', kind: 'no-compre', now: Date.now() });
    AbacoApp.refreshUI();
  });
  await go('constancia');
  assert.equal(await page.textContent('#tbTitle'), 'Constancia');
  assert.match(await page.textContent('#fx-constancia .fx-hero'), /^1día anotando este mes/);
  assert.match(await page.textContent('#fx-constancia .fx-hero'), /Los días sin anotar no borran nada/);
  assert.equal(await page.$$eval('#fx-constancia .fx-day.on', (els) => els.length), 1);
  assert.match(await page.textContent('#fx-constancia'), /Decidiste no comprar 1 vez/);
  assert.match(await page.textContent('#fx-constancia'), /te ahorraste \$1,200/);
  // Se llega desde Estadísticas.
  await go('estadisticas');
  await page.click('[data-x="stats-more"]');
  assert.ok(await page.$('#xv-estadisticas [data-go="constancia"]'));
  assert.ok(await page.$('#xv-estadisticas [data-go="proximos"]'));
});

test('domingo: aparece en Hoy, tres tarjetas, se elige un objetivo y no vuelve esa semana', async () => {
  await page.evaluate(() => {
    // Un domingo fijo para que no dependa del día en que corre la prueba.
    const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(10, 0, 0, 0);
    window.__abacoNow = d.getTime();
    AbacoExtrasUI.extras().sundays = [];
  });
  await page.evaluate(async () => { await AbacoApp.data().expense({ amount: 300, description: 'Uber', category: 'transporte', at: window.__abacoNow - 3600000 }); AbacoApp.refreshUI(); });
  await go('inicio');
  assert.ok((await hoy()).includes('Revisión de domingo'));
  await page.click('#homeToday [data-fx="domingo"]');
  assert.match(await flowText(), /Lo mejor de tu semana/i);
  await page.click('[data-fx="sun-next"]');
  assert.match(await flowText(), /En qué se fue más/i);
  assert.match(await flowText(), /Transporte: \$300/);
  await page.click('[data-fx="sun-next"]');
  assert.match(await flowText(), /Un objetivo pequeño/);
  await page.click('[data-fx="goal"][data-v="Esta semana, nada"]');
  assert.equal(await page.getAttribute('[data-fx="goal"][data-v="Esta semana, nada"]', 'aria-pressed'), 'true');
  await page.click('[data-fx="sun-done"]');
  assert.equal(await page.$('#focusFlow'), null);
  assert.equal(await page.evaluate(() => AbacoExtrasUI.extras().sundays.length), 1);
  await go('inicio');
  assert.ok(!(await hoy()).includes('Revisión de domingo'));
  // Lo guardado sobrevive a recargar.
  await page.evaluate(() => AbacoApp.persistApp && AbacoApp.persistApp());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AbacoApp && window.AbacoApp.ready);
  await page.evaluate(() => window.AbacoApp.ready);
  assert.equal(await page.evaluate(() => AbacoExtrasUI.extras().sundays.length), 1);
  assert.deepEqual(errors, []);
});

test('el botón Atrás de Android cierra el flujo (y un trámite guarda su avance)', async () => {
  await cardWithInstallment(2);
  await go('inicio');
  await page.click('#homeToday [data-fx="tramite"]');
  await page.click('[data-fx="tram-next"]');
  await page.evaluate(() => handleAndroidBack());
  assert.equal(await page.$('#focusFlow'), null);
  const saved = await page.evaluate(() => Object.values(AbacoExtrasUI.extras().tramites)[0].step);
  assert.equal(saved, 1);
});
