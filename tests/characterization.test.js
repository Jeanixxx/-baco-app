/* Pruebas de caracterización de Ábaco (Fase 0).
 *
 * Fijan el comportamiento financiero que la app tiene hoy, a través de las
 * mismas funciones que llaman los botones. Sirven de red de seguridad para la
 * limpieza del código: si una refactorización cambia un saldo, estas pruebas fallan.
 *
 * Ejecutar:  node --test tests/characterization.test.js
 * Requiere Playwright y el Chromium preinstalado en /opt/pw-browsers.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const INDEX_URL = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const CHROMIUM = process.env.ABACO_CHROMIUM || '/opt/pw-browsers/chromium';

let browser;
let page;

before(async () => {
  browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'], timeout: 30000 });
});
after(async () => {
  if (browser) await browser.close();
});

// Cada prueba empieza con un contexto nuevo: localStorage e IndexedDB vacíos.
beforeEach(async () => {
  if (page) await page.context().close();
  const context = await browser.newContext();
  page = await context.newPage();
  page.on('pageerror', (e) => { throw e; });
  // confirm() se acepta en las pruebas; si no, Playwright lo cancela y la prueba pasa por error.
  page.on('dialog', (d) => d.accept());
  await page.goto(INDEX_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state === 'object' && !!document.getElementById('btnRegister'));
});

/* ---------- helpers ---------- */

async function registerUser(name = 'Hugo') {
  await page.fill('#userName', name);
  await page.click('#btnRegister');
  await page.waitForFunction(() => !!state.user_id);
  if (await page.isVisible('#btnSkipWalletQuiz')) await page.click('#btnSkipWalletQuiz');
}

/* Rellena los campos del formulario y llama la función que el botón ejecuta. */
async function run(fields, fnName, args = []) {
  await page.evaluate(({ fields }) => {
    for (const [id, value] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (!el) throw new Error('Falta #' + id);
      el.value = value;
    }
  }, { fields });
  return page.evaluate(({ fnName, args }) => {
    try { window[fnName](...args); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }, { fnName, args });
}

async function addAccount(name, balance, type = 'débito') {
  await run({ accountName: name, accountBalance: String(balance), accountType: type }, 'addAccount');
  return page.evaluate((n) => state.accounts.find((a) => a.name === n).id, name);
}

const balanceOf = (name) => page.evaluate((n) => state.accounts.find((a) => a.name === n).balance, name);
const liquidTotal = () => page.evaluate(() => state.accounts.filter(isLiquidAccount).reduce((s, a) => s + Number(a.balance), 0));
const idOf = (name) => page.evaluate((n) => state.accounts.find((a) => a.name === n).id, name);

async function lastTransactionCount() {
  return page.evaluate(() => (state.transactions || []).length);
}

async function flushSave() {
  await page.waitForTimeout(400); // save() es diferido 280 ms
}

/* ---------- pruebas ---------- */

test('registro: guarda el nombre y el usuario', async () => {
  await registerUser('Hugo');
  const user = await page.evaluate(() => ({ name: state.user_name, id: !!state.user_id }));
  assert.equal(user.name, 'Hugo');
  assert.equal(user.id, true);
});

test('cuentas: se pueden crear cinco cuentas con saldos iniciales', async () => {
  await registerUser();
  await addAccount('Cartera', 1000, 'efectivo');
  await addAccount('BBVA', 5000, 'débito');
  await addAccount('Nu', 2000, 'débito');
  await addAccount('Ahorro extra', 3000, 'ahorro');
  await addAccount('Billetera', 500, 'efectivo');
  // Al registrarse la app ya crea dos cuentas por defecto (Efectivo y Débito, saldo 0).
  const count = await page.evaluate(() => state.accounts.length);
  assert.equal(count, 7, 'dos por defecto + cinco creadas');
  assert.equal(await balanceOf('Cartera'), 1000);
  assert.equal(await balanceOf('BBVA'), 5000);
  assert.equal(await balanceOf('Nu'), 2000);
  assert.equal(await balanceOf('Ahorro extra'), 3000);
  assert.equal(await balanceOf('Billetera'), 500);
});

test('cuentas: no se aceptan nombre vacío ni saldo negativo', async () => {
  await registerUser();
  const base = await page.evaluate(() => state.accounts.length);
  await run({ accountName: '', accountBalance: '100', accountType: 'débito' }, 'addAccount');
  assert.equal(await page.evaluate(() => state.accounts.length), base);
  await run({ accountName: 'X', accountBalance: '-5', accountType: 'débito' }, 'addAccount');
  assert.equal(await page.evaluate(() => state.accounts.length), base);
});

test('gasto rápido: descuenta de la cuenta elegida y registra un movimiento', async () => {
  await registerUser();
  const efectivo = await addAccount('Cartera', 1000, 'efectivo');
  await run({ hormAmount: '200', hormDesc: 'Tacos', hormFromAccount: efectivo }, 'registerHormiga');
  assert.equal(await balanceOf('Cartera'), 800);
  const expenses = await page.evaluate(() => state.expenses.length);
  assert.equal(expenses, 1);
  assert.ok((await lastTransactionCount()) >= 1, 'debe haber al menos una transacción');
});

test('gasto rápido: rechaza un monto mayor al saldo sin tocar la cuenta', async () => {
  await registerUser();
  const efectivo = await addAccount('Cartera', 100, 'efectivo');
  await run({ hormAmount: '999', hormDesc: 'Exceso', hormFromAccount: efectivo }, 'registerHormiga');
  assert.equal(await balanceOf('Cartera'), 100);
  assert.equal(await page.evaluate(() => state.expenses.length), 0);
});

test('ingreso: suma al saldo de la cuenta de destino', async () => {
  await registerUser();
  await addAccount('BBVA', 5000);
  const bbva = await idOf('BBVA');
  await run({ incAmount: '1000', incDesc: 'Quincena', incType: 'salario', incDestAccount: bbva }, 'addIncome');
  assert.equal(await balanceOf('BBVA'), 6000);
  assert.equal(await page.evaluate(() => state.incomes.length), 1);
});

test('transferencia: mueve dinero entre cuentas y conserva el total líquido', async () => {
  await registerUser();
  await addAccount('BBVA', 5000);
  await addAccount('Nu', 2000);
  const [bbva, nu] = [await idOf('BBVA'), await idOf('Nu')];
  const before = await liquidTotal();
  await run({ transferFrom: bbva, transferTo: nu, transferAmount: '500' }, 'transferFunds');
  assert.equal(await balanceOf('BBVA'), 4500);
  assert.equal(await balanceOf('Nu'), 2500);
  assert.equal(await liquidTotal(), before);
});

test('transferencia: rechaza cuentas iguales y saldo insuficiente', async () => {
  await registerUser();
  await addAccount('BBVA', 100);
  await addAccount('Nu', 0);
  const [bbva, nu] = [await idOf('BBVA'), await idOf('Nu')];
  await run({ transferFrom: bbva, transferTo: bbva, transferAmount: '10' }, 'transferFunds');
  await run({ transferFrom: bbva, transferTo: nu, transferAmount: '9999' }, 'transferFunds');
  assert.equal(await balanceOf('BBVA'), 100);
  assert.equal(await balanceOf('Nu'), 0);
});

test('prestamo personal: usa la PRIMERA cuenta líquida, no la elegida (comportamiento actual)', async () => {
  await registerUser();
  await addAccount('Cartera', 1000, 'efectivo');
  // La primera cuenta líquida es la «Efectivo» creada por defecto (saldo 0).
  await page.evaluate(() => { state.accounts.find((a) => a.name === 'Efectivo').balance = 1000; save(true); });
  await run({ debtPerson: 'Ana', debtConcept: 'Comida', debtAmount: '300', debtDate: '2026-11-01' }, 'addDebtor');
  assert.equal(await balanceOf('Efectivo'), 700, 'descuenta de Efectivo, la primera líquida');
  assert.equal(await balanceOf('Cartera'), 1000, 'Cartera no se toca aunque sea la elegida en otros flujos');
  const id = await page.evaluate(() => state.debtors[0].id);
  await run({}, 'settleDebtor', [id]);
  assert.equal(await balanceOf('Efectivo'), 1000);
  assert.equal(await page.evaluate(() => state.debtors[0].settled), true);
});

test('ahorro: descuenta de la primera cuenta líquida y crea la meta (comportamiento actual)', async () => {
  await registerUser();
  await page.evaluate(() => { state.accounts.find((a) => a.name === 'Efectivo').balance = 1000; save(true); });
  await run({ saveName: 'Vacaciones', saveCurrent: '400', saveTarget: '1000' }, 'addSaving');
  assert.equal(await balanceOf('Efectivo'), 600);
  const s = await page.evaluate(() => state.savings[0]);
  assert.equal(s.name, 'Vacaciones');
  assert.equal(Number(s.current), 400);
});

test('préstamo: calcula la mensualidad y el pago reduce el saldo', async () => {
  await registerUser();
  await page.evaluate(() => { state.accounts.find((a) => a.name === 'Efectivo').balance = 20000; save(true); });
  await run({ loanName: 'Coche', loanPrincipal: '12000', loanRate: '12', loanTerm: '12', loanType: 'personal' }, 'addLoan');
  const loan = await page.evaluate(() => state.loans[0]);
  assert.equal(loan.term, 12);
  assert.ok(Math.abs(loan.payment - 1066.18) < 0.01, 'mensualidad esperada ~1066.18, obtenida ' + loan.payment);
  await run({}, 'markLoanPayment', [loan.id]);
  const after = await page.evaluate(() => state.loans[0]);
  assert.equal(after.paid, 1);
  assert.ok(after.current < 12000 && after.current > 10900, 'saldo tras un pago: ' + after.current);
});

test('MSI: BUG CONOCIDO, no se puede crear ningún plan (financialType recibe un string)', async () => {
  await registerUser();
  await run({ cardName: 'Oro', cardType: 'crédito', cardLimit: '20000' }, 'addCard');
  const cardId = await page.evaluate(() => state.cards[0]?.id);
  assert.ok(cardId, 'la tarjeta sí se crea');
  const r = await run({ msiCardSelect: cardId, msiConcept: 'TV', msiTotal: '6000', msiMonths: '6', msiPaidBefore: '0', msiPurchaseDate: '2026-11-01' }, 'addMsi');
  const plans = await page.evaluate(() => state.msiPlans.length);
  // Cuando se corrija el bug, esta aserción debe invertirse y verificar 6 cuotas que suman 6000.
  assert.equal(plans, 0, 'comportamiento actual: no se crea el plan');
  assert.equal(r.ok, true);
});

test('tarjeta: se puede borrar sin deuda cuando el usuario confirma', async () => {
  await registerUser();
  await run({ cardName: 'Oro', cardType: 'crédito', cardLimit: '20000' }, 'addCard');
  const cardId = await page.evaluate(() => state.cards[0].id);
  await run({}, 'deleteCard', [cardId]);
  assert.equal(await page.evaluate(() => state.cards.length), 0);
});

test('persistencia: los datos sobreviven a recargar la página', async () => {
  await registerUser();
  await addAccount('Cartera', 1000, 'efectivo');
  await addAccount('BBVA', 5000);
  const efectivo = await idOf('Cartera');
  await run({ hormAmount: '150', hormDesc: 'Café', hormFromAccount: efectivo }, 'registerHormiga');
  await flushSave();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state === 'object' && state.accounts && state.accounts.length > 0, null, { timeout: 5000 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => state.accounts.length), 4, 'dos por defecto + dos creadas');
  assert.equal(await balanceOf('Cartera'), 850);
  assert.equal(await balanceOf('BBVA'), 5000);
});

test('auditoría interna: el motor reporta coherencia tras operaciones mixtas', async () => {
  await registerUser();
  await addAccount('Cartera', 1000, 'efectivo');
  await addAccount('BBVA', 5000);
  const [ef, bb] = [await idOf('Cartera'), await idOf('BBVA')];
  await run({ hormAmount: '50', hormDesc: 'Pan', hormFromAccount: ef }, 'registerHormiga');
  await run({ incAmount: '800', incDesc: 'Extra', incType: 'extra', incDestAccount: bb }, 'addIncome');
  await run({ transferFrom: bb, transferTo: ef, transferAmount: '300' }, 'transferFunds');
  const audit = await page.evaluate(() => window.Abaco.Finance.audit());
  assert.equal(audit.ok, true, 'issues: ' + JSON.stringify(audit.issues));
  assert.equal(await liquidTotal(), 1000 + 5000 - 50 + 800);
});
