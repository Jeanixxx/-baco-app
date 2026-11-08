/* Modo calmado (js/abaco-calm.js): Inicio "Hoy, solo tres cosas", hojas de Sobres y Tarjetas,
 * favoritos del menú. Chromium real, teléfono 390x844.
 * Ejecutar: node --test tests/calm.test.js
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const APP_URL = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const CHROMIUM = process.env.ABACO_CHROMIUM || '/opt/pw-browsers/chromium';
let browser;
let context;
let page;
let errors = [];

before(async () => { browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'], timeout: 30000 }); });
after(async () => { if (browser) await browser.close(); });
beforeEach(async () => {
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
  await page.evaluate(async () => { await AbacoApp.data().income({ description: 'Fondo', amount: 10000, type: 'otro' }); AbacoApp.refreshUI(); });
});

const go = (n) => page.evaluate((x) => goPanel(x), n);
const items = () => page.$$eval('#homeToday .hoy-row', (els) => els.map((e) => ({ t: e.querySelector('.ht').textContent, done: e.classList.contains('done') })));

test('Hoy: una sola cosa si no hay nada más; se palomea sola al anotar un gasto', async () => {
  await go('inicio');
  let it = await items();
  assert.deepEqual(it, [{ t: 'Anotar lo que gastes hoy', done: false }]);
  assert.match(await page.textContent('#homeToday'), /Solo una cosa/);
  assert.match(await page.textContent('#homeToday'), /Tienes \$10,000 · vas bien/);
  await page.evaluate(async () => { await AbacoApp.data().expense({ amount: 50, description: 'Café', category: 'comida' }); AbacoApp.refreshUI(); });
  it = await items();
  assert.equal(it[0].done, true);
  assert.match(await page.textContent('#homeToday .hoy-row'), /1 gasto anotado/);
  assert.match(await page.textContent('#homeToday'), /Listo por hoy\. Aquí no hay nada más pendiente\./);
});

test('Hoy: como máximo tres cosas, en orden, y se pueden palomear (se recuerda)', async () => {
  await page.evaluate(async () => {
    const d = AbacoApp.data();
    await d.expense({ amount: 3400, category: 'comida' });
    await d.setBudget({ category: 'comida', amount: 3000 });
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    state.subscriptions = [{ id: 's1', name: 'Streaming', amount: 199, date: manana, range: 'mensual' }];
    AbacoExtras.addDecision(AbacoExtrasUI.extras(), { title: 'Audífonos', amount: 1200, now: Date.now() - 100 * 86400000 });
    AbacoApp.refreshUI();
  });
  await go('inicio');
  const it = await items();
  assert.equal(it.length, 3, 'nunca más de tres');
  assert.deepEqual(it.map((x) => x.t), ['Anotar lo que gastes hoy', 'Mañana se cobra Streaming', 'Echar un ojo al sobre de comida']);
  assert.match(await page.textContent('#homeToday'), /va \$400 arriba, sin prisa/);
  await page.click('#homeToday .hoy-row:nth-child(2) .hoy-check');
  assert.equal((await items())[1].done, true);
  assert.equal(await page.getAttribute('#homeToday .hoy-row:nth-child(2) .hoy-check', 'aria-pressed'), 'true');
  // Se guarda: sobrevive a recargar.
  await page.evaluate(() => AbacoApp.persistApp());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AbacoApp && window.AbacoApp.ready);
  await page.evaluate(() => AbacoApp.ready);
  await go('inicio');
  assert.equal((await items())[1].done, true);
  // Tocar el texto lleva a la pantalla de esa cosa.
  await page.click('#homeToday .hoy-row:nth-child(3) .hoy-text');
  assert.equal(await page.evaluate(() => state.activePanel), 'presupuesto');
});

test('Hoy: en silencio solo queda "anotar"', async () => {
  await page.evaluate(() => {
    const e = AbacoExtrasUI.extras();
    AbacoExtras.addDecision(e, { title: 'Audífonos', amount: 1200, now: Date.now() - 100 * 86400000 });
    AbacoExtras.setSilence(e, AbacoExtras.nextMonday(Date.now()));
  });
  await go('inicio');
  assert.deepEqual((await items()).map((x) => x.t), ['Anotar lo que gastes hoy']);
});

test('Sobres: un renglón por sobre; la hoja muestra el detalle y permite cambiar lo planeado', async () => {
  await page.evaluate(async () => {
    const d = AbacoApp.data();
    await d.setBudget({ category: 'comida', amount: 3000 });
    await d.setBudget({ category: 'ocio', amount: 800 });
    await d.expense({ amount: 3400, category: 'comida' });
    AbacoApp.refreshUI();
  });
  await go('presupuesto');
  assert.match(await page.textContent('#sobresLead'), /Te quedan \$400 de lo que planeaste este mes/);
  const filas = await page.$$eval('#budgetList .calm-row', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  assert.equal(filas.length, 2);
  assert.match(filas.join(' | '), /Comida \$400 por encima · toca para ver/);
  assert.match(filas.join(' | '), /Ocio Te quedan \$800/);
  await page.click('#budgetList [data-calm="sobre"]');
  assert.match(await page.textContent('#calmSheet'), /de \$3,000 planeados/);
  await page.click('#calmSheet [data-calm="sobre-plan"]');
  await page.waitForSelector('.abaco-dialog');
  await page.fill('#dlg-amount', '4000');
  await page.click('.abaco-dialog-actions .btn:last-child');
  await page.waitForFunction(() => state.budgets.find((b) => b.category === 'comida').amount === 4000);
  assert.match(await page.textContent('#calmSheet'), /de \$4,000 planeados/, 'la hoja se actualiza sola');
  assert.match(await page.textContent('#calmSheet'), /Te quedan \$600/);
  await page.evaluate(() => window.handleAndroidBack());
  assert.equal(await page.$('#calmSheet'), null, '"volver" cierra la hoja');
  assert.equal(await page.evaluate(() => state.activePanel), 'presupuesto');
});

test('Tarjetas: cada tarjeta dice solo el siguiente pago; el plan se abre en la hoja', async () => {
  await page.evaluate(async () => {
    const d = AbacoApp.data();
    const c = await d.createCard({ name: 'Oro', limit: 20000 });
    await d.msiPurchase({ cardId: c.result.id, concept: 'TV', total: 6000, months: 6, purchaseDate: '2026-11-01' });
    await d.createCard({ name: 'Nu', limit: 5000 });
    AbacoApp.refreshUI();
  });
  await go('tarjetas');
  const tarjetas = await page.$$eval('#cardList .calm-card', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  assert.equal(tarjetas.length, 2);
  assert.match(tarjetas[0], /Oro .*Siguiente pago \$1,000 el \d+ de \w+ · toca para ver el plan/i);
  assert.match(tarjetas[1], /Nu .*Sin pagos pendientes \$0 Todo al día/);
  await page.click('#cardList [data-calm="tarjeta"]');
  assert.match(await page.textContent('#calmSheet'), /TV/);
  assert.equal(await page.$$eval('#calmSheet [data-msi-paid]', (els) => els.length), 6);
});

test('Menú: lo que más abres sube a "Lo que más usas"', async () => {
  for (let i = 0; i < 3; i++) { await go('kanban'); await go('lista'); }
  await go('simulador');
  await page.evaluate(() => openMenu());
  const fav = await page.$$eval('#menuList .menu-tile.big', (els) => els.map((e) => e.dataset.go));
  assert.equal(fav.length, 4);
  assert.deepEqual(fav.slice(0, 2).sort(), ['kanban', 'lista']);
  assert.ok(fav.includes('simulador'));
  assert.ok(!fav.some((f) => ['inicio', 'historial', 'hormiga', 'estadisticas', 'cuentas'].includes(f)), 'lo de la barra no se repite');
  assert.deepEqual(errors, []);
});

test('Registrar anota ingresos en el mismo lugar: cambia el texto y el paso 2 pregunta el tipo', async () => {
  await go('hormiga');
  await page.click('#regStep1 [data-calm="mode"][data-v="ingreso"]');
  assert.equal(await page.textContent('#regQ'), '¿Cuánto te entró?');
  assert.equal(await page.textContent('#btnRegSave'), 'Guardar ingreso');
  for (const k of ['1', '6', '2', '0', '0']) await page.click('#regPad [data-key="' + k + '"]');
  await page.click('#btnRegSave');
  await page.waitForSelector('#regStep2:not(.hidden)');
  assert.match(await page.textContent('#regStep2'), /¿De qué fue\?/);
  await page.click('#regStep2 [data-calm="cat"][data-v="salario"]');
  await page.waitForFunction(() => state.incomes.some((i) => i.amount === 16200 && i.type === 'salario'));
  await page.click('#regStep2 [data-calm="reg-done"]');
  assert.equal(await page.evaluate(() => state.expenses.length), 0, 'no se registró como gasto');
  // "Agregar ingreso" en Ingresos abre este mismo lugar.
  await go('ingresos');
  await page.click('#btnOpenIncForm');
  assert.equal(await page.evaluate(() => state.activePanel), 'hormiga');
  assert.equal(await page.textContent('#regQ'), '¿Cuánto te entró?');
  // Al salir y volver por la barra, empieza otra vez en gasto.
  await go('inicio');
  await go('hormiga');
  assert.equal(await page.textContent('#regQ'), '¿Cuánto gastaste?');
});

test('Deudas: lo que debo y lo que me deben en una pantalla con dos pestañas', async () => {
  await page.evaluate(async () => {
    const d = AbacoApp.data();
    await d.loan({ name: 'Auto', principal: 12000, annualRate: 0, term: 12, type: 'auto' });
    await d.lend({ person: 'Ana', concept: 'Comida', amount: 450, accountId: state.accounts.find((a) => a.balance > 0).id });
    AbacoApp.refreshUI();
  });
  await go('prestamos');
  assert.equal(await page.textContent('#tbTitle'), 'Deudas');
  assert.match(await page.textContent('#debtLeadDebo'), /Debes \$12,000/);
  assert.equal(await page.isVisible('#loanList'), true);
  assert.equal(await page.isVisible('#debtorsList'), false);
  await page.click('#panel-prestamos [data-calm="debts"][data-v="cobrar"]');
  assert.equal(await page.isVisible('#debtorsList'), true);
  assert.equal(await page.isVisible('#loanList'), false);
  assert.match(await page.textContent('#debtLeadCobrar'), /Te deben \$450/);
  assert.match(await page.textContent('#debtorsList'), /Ana/);
  // El nombre anterior lleva a la misma pantalla, en la pestaña correcta.
  await go('inicio');
  await go('deudores');
  assert.equal(await page.evaluate(() => state.activePanel), 'prestamos');
  assert.equal(await page.getAttribute('#panel-prestamos', 'data-pane'), 'cobrar');
  await page.evaluate(() => openMenu());
  await page.click('#menuAllToggle');
  assert.equal(await page.$('#menuList [data-go="deudores"]'), null, 'ya no hay una sección aparte');
});

test('el cielo se mueve de lado al inclinar el teléfono, con suavidad', async () => {
  const tilt = () => page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('skyLayer')).getPropertyValue('--tilt-x')) || 0);
  assert.equal(await tilt(), 0);
  await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { gamma: 30, beta: 0, alpha: 0 })));
  await page.waitForTimeout(80);
  const midway = await tilt();
  assert.ok(midway > 0 && midway < 28, 'se acerca poco a poco, sin saltar: ' + midway);
  await page.waitForFunction(() => AbacoSky.tilt() === 28);
  const t = await page.evaluate(() => getComputedStyle(document.querySelector('#skyLayer .sky-sun')).transform);
  assert.match(t, /matrix\(1, 0, 0, 1, 28/, 'el sol se desplaza');
  await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { gamma: -30, beta: 0, alpha: 0 })));
  await page.waitForFunction(() => AbacoSky.tilt() === -28);
  assert.deepEqual(errors, []);
});
