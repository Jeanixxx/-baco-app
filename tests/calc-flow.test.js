/* Calculadora en la app: botón de arriba, teclas, tomar datos de cuentas y deudas, anotar gasto,
 * abonar, y el dinero pendiente que se marca en Hoy y se anota solo al tener saldo.
 * Chromium real, teléfono 390x844. Ejecutar: node --test tests/calc-flow.test.js
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
  // Débito con saldo; Efectivo queda en 0 a propósito.
  await page.evaluate(async () => {
    const deb = state.accounts.find((a) => a.name === 'Débito');
    await AbacoApp.data().income({ description: 'Fondo', amount: 5000, type: 'otro', accountId: deb.id, at: Date.now() - 86400000 });
    AbacoApp.refreshUI();
  });
});

const key = (k) => page.click('#ckKeys [data-k="' + k + '"]');
const display = () => page.textContent('#ckDisplay');
const tape = () => page.textContent('#ckTape');
const acc = (name) => page.evaluate((n) => state.accounts.find((a) => a.name === n).id, name);
const expenses = () => page.evaluate(() => state.expenses.map((e) => [e.description, e.amount]));

test('la calculadora está arriba, no en el menú', async () => {
  assert.ok(await page.isVisible('#btnCalcTop'));
  assert.equal(await page.$('#btnCalcMenu'), null, 'ya no está en el menú');
  await page.click('#btnCalcTop');
  assert.ok(await page.evaluate(() => document.getElementById('calcPage').classList.contains('open')));
  await page.click('#btnCloseCalc');
  assert.equal(await page.evaluate(() => document.getElementById('calcPage').classList.contains('open')), false);
  assert.deepEqual(errors, []);
});

test('jerarquía, cinta visible y borrar dígito en la pantalla', async () => {
  await page.click('#btnCalcTop');
  for (const k of ['2', '+', '3', '×', '4']) await key(k);
  assert.equal(await tape(), '2 + 3 × 4');
  assert.equal(await display(), '4');
  await key('=');
  assert.equal(await display(), '14');
  await key('AC');
  await key('1'); await key('2'); await key('3');
  await key('⌫');
  assert.equal(await display(), '12');
  assert.deepEqual(errors, []);
});

test('tomar datos: una cuenta, lo que debo y lo que me deben entran a la operación', async () => {
  const deb = await acc('Débito');
  await page.evaluate(async () => {
    await AbacoApp.data().loan({ name: 'Pedro', principal: 2000, annualRate: 0, term: 4, disburse: false });
    await AbacoApp.data().lend({ person: 'Ana', concept: 'Comida', amount: 300, accountId: state.accounts.find((a) => a.name === 'Débito').id });
    AbacoApp.refreshUI();
  });
  await page.click('#btnCalcTop');
  await page.click('#ckFrom');
  assert.match(await page.textContent('#ckSheet .ck-list'), /Débito/);
  assert.match(await page.textContent('#ckSheet .ck-list'), /Lo que debes/);
  assert.match(await page.textContent('#ckSheet .ck-list'), /Ana te debe/);
  await page.click('#ckSheet [data-ck="from"][data-l="Débito"]');
  // Débito quedó en 4,700 tras prestarle 300 a Ana.
  assert.equal(await display(), '4,700');
  await key('−');
  await key('1'); await key('2'); await key('0'); await key('0');
  assert.match(await tape(), /Débito 4700 - 1200/);
  await key('=');
  assert.equal(await display(), '3,500');
  // Lo que me deben, en la misma operación.
  await key('+');
  await page.click('#ckFrom');
  await page.click('#ckSheet [data-ck="from"][data-l="Ana te debe"]');
  await key('=');
  assert.equal(await display(), '3,800');
  assert.deepEqual(errors, []);
});

test('anotar gasto con dinero: se guarda con su categoría y la cuenta elegida', async () => {
  const deb = await acc('Débito');
  await page.click('#btnCalcTop');
  for (const k of ['3', '0', '0']) await key(k);
  await page.click('#ckSpend');
  await page.fill('#ckDesc', 'Súper');
  await page.click('#ckSheet [data-ck="spend-go"]');
  await page.waitForFunction(() => state.expenses.some((e) => e.description === 'Súper'));
  assert.deepEqual((await expenses()).find((e) => e[0] === 'Súper'), ['Súper', 300]);
  assert.equal(await page.evaluate(() => document.getElementById('calcPage').classList.contains('open')), false, 'al anotar, vuelve a la app');
  assert.deepEqual(errors, []);
});

test('sin dinero: la operación se acepta, queda pendiente y Hoy pide agregar dinero', async () => {
  const efe = await acc('Efectivo');
  await page.click('#btnCalcTop');
  for (const k of ['9', '0', '0']) await key(k);
  await page.click('#ckSpend');
  await page.fill('#ckDesc', 'Renta del cuarto');
  await page.click('#ckSheet [data-ck="acc"][data-v="' + efe + '"]');
  await page.click('#ckSheet [data-ck="spend-go"]');
  await page.waitForFunction(() => (extrasPending = AbacoExtrasUI.extras().pendingMoney).length === 1);
  assert.match(await page.textContent('#toast'), /Quedó pendiente: faltan \$900/);
  // No entra al libro todavía.
  assert.equal((await expenses()).some((e) => e[0] === 'Renta del cuarto'), false);
  // Hoy lo marca como tarea.
  await page.evaluate(() => goPanel('inicio'));
  const hoy = await page.$$eval('#homeToday .hoy-text .ht', (els) => els.map((e) => e.textContent));
  assert.ok(hoy.includes('Agregar dinero a Efectivo'), JSON.stringify(hoy));
  assert.match(await page.textContent('#homeToday'), /Faltan \$900 para: Renta del cuarto/);
  // Tocarla lleva a agregar ingreso.
  await page.click('#homeToday .hoy-text:has(.ht:text("Agregar dinero a Efectivo"))');
  assert.equal(await page.evaluate(() => state.activePanel), 'hormiga');
  assert.equal(await page.evaluate(() => AbacoCalm.mode()), 'ingreso');
  assert.deepEqual(errors, []);
});

test('al agregar el dinero, la operación pendiente se anota sola y la tarea desaparece', async () => {
  const efe = await acc('Efectivo');
  await page.click('#btnCalcTop');
  for (const k of ['9', '0', '0']) await key(k);
  await page.click('#ckSpend');
  await page.fill('#ckDesc', 'Renta del cuarto');
  await page.click('#ckSheet [data-ck="acc"][data-v="' + efe + '"]');
  await page.click('#ckSheet [data-ck="spend-go"]');
  await page.waitForFunction(() => AbacoExtrasUI.extras().pendingMoney.length === 1);
  // Agregar el ingreso que falta.
  await page.evaluate(async (id) => { await AbacoApp.data().income({ description: 'Quincena', amount: 1000, type: 'sueldo', accountId: id }); AbacoApp.refreshUI(); }, efe);
  await page.waitForFunction(() => AbacoExtrasUI.extras().pendingMoney.length === 0, null, { timeout: 5000 });
  assert.ok((await expenses()).some((e) => e[0] === 'Renta del cuarto' && e[1] === 900), 'se anotó sola');
  assert.match(await page.textContent('#toast'), /Listo: se anotó Renta del cuarto por \$900/);
  await page.evaluate(() => goPanel('inicio'));
  const hoy = await page.$$eval('#homeToday .hoy-text .ht', (els) => els.map((e) => e.textContent));
  assert.equal(hoy.some((t) => t.startsWith('Agregar dinero')), false, 'la tarea ya no aparece');
  assert.deepEqual(errors, []);
});

test('abonar a una deuda con dinero, y el saldo de la deuda baja', async () => {
  const deb = await acc('Débito');
  await page.evaluate(async () => { await AbacoApp.data().loan({ name: 'Pedro', principal: 2000, annualRate: 0, term: 4, disburse: false }); AbacoApp.refreshUI(); });
  const before = await page.evaluate(() => state.loans.find((l) => l.name === 'Pedro').current);
  await page.click('#btnCalcTop');
  for (const k of ['5', '0', '0']) await key(k);
  await page.click('#ckPay');
  await page.click('#ckSheet [data-ck="pay-go"]');
  await page.waitForFunction((b) => state.loans.find((l) => l.name === 'Pedro').current < b, before, { timeout: 5000 });
  const after = await page.evaluate(() => state.loans.find((l) => l.name === 'Pedro').current);
  assert.equal(Math.round((before - after) * 100) / 100, 500);
  assert.deepEqual(errors, []);
});

test('el historial de la calculadora vuelve a cargar un resultado', async () => {
  await page.click('#btnCalcTop');
  for (const k of ['2', '+', '3', '=']) await key(k);
  await page.click('#ckHist [data-hist="0"]');
  assert.equal(await display(), '5');
  await key('×'); await key('2'); await key('=');
  assert.equal(await display(), '10');
  assert.deepEqual(errors, []);
});

test('Android «Volver» cierra primero la hoja y luego la calculadora', async () => {
  await page.click('#btnCalcTop');
  await page.click('#ckFrom');
  await page.evaluate(() => handleAndroidBack());
  assert.equal(await page.evaluate(() => document.getElementById('ckSheet').hidden), true);
  assert.equal(await page.evaluate(() => document.getElementById('calcPage').classList.contains('open')), true);
  await page.evaluate(() => handleAndroidBack());
  assert.equal(await page.evaluate(() => document.getElementById('calcPage').classList.contains('open')), false);
});
