/* Pruebas de integración de la app conectada al motor (Fase 4.2). Chromium real.
 * Ejecutar: node --test tests/app.test.js
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

before(async () => { browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'], timeout: 30000 }); });
after(async () => { if (browser) await browser.close(); });

beforeEach(async () => {
  if (context) await context.close();
  context = await browser.newContext();
  await context.addInitScript(() => { /* las pruebas usan datos limpios salvo que indiquen lo contrario */ });
});

async function open(seed) {
  if (page) await page.close().catch(() => {});
  if (seed) {
    await context.addInitScript((s) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, seed);
  }
  page = await context.newPage();
  page.on('pageerror', (e) => { throw e; });
  page.on('dialog', (d) => d.accept());
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AbacoApp && window.AbacoApp.ready);
  await page.evaluate(() => window.AbacoApp.ready);
}

async function register(name = 'Hugo') {
  await page.fill('#userName', name);
  await page.click('#btnRegister');
  await page.waitForFunction(() => !!state.user_id);
  if (await page.isVisible('#btnSkipWalletQuiz')) await page.click('#btnSkipWalletQuiz');
}

/* Llama una acción de la interfaz y responde a su diálogo si lo abre.
 * answer: 'ok' acepta (botón principal), 'cancel' cancela. */
async function act(fn, args = [], { answer = 'ok' } = {}) {
  const pending = page.evaluate(async ({ fn, args }) => {
    await window[fn](...args);
    await new Promise((r) => setTimeout(r, 60));
    return true;
  }, { fn, args });
  try {
    await page.waitForSelector('.abaco-dialog', { timeout: 400 });
    const sel = answer === 'ok' ? '.abaco-dialog-actions .btn-primary, .abaco-dialog-actions .btn-danger' : '.abaco-dialog-actions .btn-ghost';
    await page.click(sel);
  } catch (e) { /* la acción no pide confirmación */ }
  return pending;
}
async function fields(values) {
  await page.evaluate((v) => { for (const [id, x] of Object.entries(v)) document.getElementById(id).value = x; }, values);
}
const accountNamed = (name) => page.evaluate((n) => state.accounts.find((a) => a.name === n), name);
const balance = async (name) => (await accountNamed(name)).balance;
async function setBalance(name, amount) {
  await page.evaluate(async ({ name, amount }) => {
    const acc = AbacoApp.data().view().accounts.find((a) => a.name === name);
    await AbacoApp.data().adjustAccount(acc.id, amount);
    AbacoApp.refreshUI();
  }, { name, amount });
}

test('borrar pide confirmación: si el usuario cancela, no se borra nada', async () => {
  await open();
  await register();
  await setBalance('Efectivo', 1000);
  await fields({ debtPerson: 'Ana', debtConcept: 'Comida', debtAmount: '300', debtDate: '2026-11-01' });
  await act('addDebtor');
  const id = await page.evaluate(() => state.debtors[0].id);
  await act('deleteDebtor', [id], { answer: 'cancel' });
  assert.equal(await page.evaluate(() => state.debtors.length), 1);
  assert.equal(await balance('Efectivo'), 700);
});

test('editar suscripción: una fecha inválida se rechaza y no cambia nada', async () => {
  await open();
  await register();
  await page.evaluate(() => { state.subscriptions = [{ id: 's1', name: 'Netflix', amount: 199, range: 'mensual', date: '2026-11-15', active: true }]; AbacoApp.persistApp(); });
  await page.evaluate(() => { editSubscription('s1'); });
  await page.waitForSelector('.abaco-dialog');
  await page.fill('#dlg-date', '15/11/2026');
  await page.click('.abaco-dialog-actions .btn-primary');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => state.subscriptions[0].date), '2026-11-15');
});

test('editar suscripción: cambia nombre, monto y fecha válidos', async () => {
  await open();
  await register();
  await page.evaluate(() => { state.subscriptions = [{ id: 's1', name: 'Netflix', amount: 199, range: 'mensual', date: '2026-11-15', active: true }]; AbacoApp.persistApp(); });
  await page.evaluate(() => { editSubscription('s1'); });
  await page.waitForSelector('.abaco-dialog');
  await page.fill('#dlg-name', 'Spotify');
  await page.fill('#dlg-amount', '149');
  await page.fill('#dlg-date', '2026-12-01');
  await page.click('.abaco-dialog-actions .btn-primary');
  await page.waitForTimeout(150);
  const s = await page.evaluate(() => state.subscriptions[0]);
  assert.deepEqual([s.name, s.amount, s.date], ['Spotify', 149, '2026-12-01']);
});

test('registro: crea cuentas por defecto y guarda el usuario', async () => {
  await open();
  await register('Ana');
  const names = await page.evaluate(() => state.accounts.map((a) => a.name).sort());
  assert.deepEqual(names, ['Débito', 'Efectivo']);
  assert.equal(await page.evaluate(() => state.user_name), 'Ana');
});

test('borrar un cobro pendiente devuelve el dinero a la cuenta', async () => {
  await open();
  await register();
  await setBalance('Efectivo', 1000);
  await fields({ debtPerson: 'Ana', debtConcept: 'Comida', debtAmount: '300', debtDate: '2026-11-01' });
  await act('addDebtor');
  assert.equal(await balance('Efectivo'), 700);
  const id = await page.evaluate(() => state.debtors[0].id);
  await act('deleteDebtor', [id]);
  assert.equal(await balance('Efectivo'), 1000);
  assert.equal(await page.evaluate(() => state.debtors.length), 0);
});

test('borrar un ahorro devuelve el dinero (antes se perdía)', async () => {
  await open();
  await register();
  await setBalance('Efectivo', 1000);
  await fields({ saveName: 'Vacaciones', saveCurrent: '400', saveTarget: '1000' });
  await act('addSaving');
  assert.equal(await balance('Efectivo'), 600);
  const id = await page.evaluate(() => state.savings[0].id);
  await act('deleteSaving', [id]);
  assert.equal(await balance('Efectivo'), 1000);
});

test('borrar un gasto corrige el saldo y lo quita de la lista', async () => {
  await open();
  await register();
  await setBalance('Efectivo', 500);
  await fields({ hormAmount: '120', hormDesc: 'Tacos', hormFromAccount: await page.evaluate(() => state.accounts.find((a) => a.name === 'Efectivo').id) });
  await act('registerHormiga');
  assert.equal(await balance('Efectivo'), 380);
  const id = await page.evaluate(() => state.expenses[0].id);
  await act('deleteExpense', [id]);
  assert.equal(await balance('Efectivo'), 500);
  assert.equal(await page.evaluate(() => state.expenses.length), 0);
});

test('compra de la lista: descuenta el carrito completo y registra cada producto', async () => {
  await open();
  await register();
  await setBalance('Efectivo', 1000);
  await page.evaluate(() => { state.shopMode = { budget: 500 }; state.cart = [{ id: 'c1', name: 'Pan', price: 30 }, { id: 'c2', name: 'Leche', price: 50 }]; });
  await act('confirmShop');
  assert.equal(await balance('Efectivo'), 920);
  assert.equal(await page.evaluate(() => state.expenses.length), 2);
  assert.equal(await page.evaluate(() => state.cart.length), 0);
});

test('compra de la lista: se rechaza si supera el presupuesto y no toca el saldo', async () => {
  await open();
  await register();
  await setBalance('Efectivo', 1000);
  await page.evaluate(() => { state.shopMode = { budget: 10 }; state.cart = [{ id: 'c1', name: 'Pan', price: 30 }]; });
  await act('confirmShop');
  assert.equal(await balance('Efectivo'), 1000);
  assert.equal(await page.evaluate(() => state.expenses.length), 0);
});

test('asistente de bienvenida: agrega una cuenta con el saldo indicado', async () => {
  await open();
  await register();
  await fields({ quizAccountName: 'BBVA', quizAccountType: 'débito', quizAccountBalance: '2500' });
  await act('quizAddAccount');
  assert.equal(await balance('BBVA'), 2500);
});

test('presupuesto: el gasto de cada concepto se calcula con los movimientos', async () => {
  await open();
  await register();
  await setBalance('Efectivo', 1000);
  await page.evaluate(async () => { await AbacoApp.data().setBudget({ category: 'alimentación', amount: 500 }); AbacoApp.refreshUI(); });
  await fields({ hormAmount: '120', hormDesc: 'Tacos', hormFromAccount: await page.evaluate(() => state.accounts.find((a) => a.name === 'Efectivo').id) });
  await act('registerHormiga');
  const b = await page.evaluate(() => state.budgets.find((x) => x.category === 'alimentación'));
  assert.ok(b, 'el presupuesto aparece en la vista');
  // El gasto rápido usa la categoría general; el presupuesto de alimentación sigue en 0.
  assert.equal(b.spent, 0);
});

test('datos no financieros (lista de compras) sobreviven a recargar', async () => {
  await open();
  await register();
  await page.evaluate(async () => {
    state.shop = [{ id: 's1', name: 'Café', price: 40, status: 'pending' }];
    AbacoApp.persistApp();
    await new Promise((r) => setTimeout(r, 100));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AbacoApp);
  await page.evaluate(() => window.AbacoApp.ready);
  assert.equal(await page.evaluate(() => state.shop.length), 1);
  assert.equal(await page.evaluate(() => state.user_name), 'Hugo');
});

test('borrar todo: deja solo las cuentas por defecto y vuelve al registro', async () => {
  await open();
  await register();
  await fields({ accountName: 'BBVA', accountBalance: '5000', accountType: 'débito' });
  await act('addAccount');
  await act('clearAll');
  assert.deepEqual(await page.evaluate(() => state.accounts.map((a) => a.name).sort()), ['Débito', 'Efectivo']);
  assert.equal(await page.evaluate(() => state.user_id), null);
});

test('migración al abrir la app: datos del formato antiguo aparecen con sus saldos', async () => {
  const legacy = {
    user_id: 'u-legacy', user_name: 'Hugo', user_pronoun: 'el',
    accounts: JSON.stringify([
      { id: 'a1', name: 'Efectivo', type: 'efectivo', balance: 850 },
      { id: 'a2', name: 'BBVA', type: 'débito', balance: 4500 }
    ]),
    cards: '[]', msiPlans: '[]', loans: '[]', debtors: '[]', savings: '[]', investments: '[]',
    expenses: '[]', incomes: '[]', historial: '[]', budgets: '[]', transfers: '[]',
    shop: JSON.stringify([{ id: 's1', name: 'Pan', price: 30, status: 'pending' }])
  };
  await open(legacy);
  assert.equal(await balance('BBVA'), 4500);
  assert.equal(await balance('Efectivo'), 850);
  assert.equal(await page.evaluate(() => state.shop.length), 1, 'los datos no financieros también llegan');
});

/* ---------- pestaña Simulador ---------- */

async function openSimulator() {
  await page.evaluate(() => goPanel('simulador'));
  await page.waitForTimeout(350);
}
const simText = () => page.evaluate(() => document.getElementById('simResult').innerText);

test('simulador: suscripciones reflejan tus datos reales y no cambian nada', async () => {
  await open();
  await register();
  await page.evaluate(() => { state.subscriptions = [{ id: 's1', name: 'Netflix', amount: 199, range: 'mensual', active: true }]; AbacoApp.persistApp(); });
  const before = await page.evaluate(() => JSON.stringify({ accounts: state.accounts, subs: state.subscriptions }));
  await openSimulator();
  const text = await simText();
  assert.match(text, /199/, 'muestra el costo mensual');
  const after = await page.evaluate(() => JSON.stringify({ accounts: state.accounts, subs: state.subscriptions }));
  assert.equal(after, before, 'simular no modifica datos');
});

test('simulador: deuda con pago extra muestra meses e intereses ahorrados', async () => {
  await open();
  await register();
  await openSimulator();
  await page.click('#simModes [data-sim="deudas"]');
  await page.fill('#simDebt', '10000');
  await page.fill('#simDebtRate', '24');
  await page.fill('#simDebtMonths', '12');
  await page.fill('#simDebtExtra', '500');
  const text = await simText();
  assert.match(text, /Ahorras \d+ meses/);
});

test('simulador: inversión de 1 000 al mes al 12 % durante un año', async () => {
  await open();
  await register();
  await openSimulator();
  await page.click('#simModes [data-sim="inversiones"]');
  await page.fill('#simMonthly', '1000');
  await page.fill('#simRate', '12');
  await page.fill('#simYears', '1');
  const text = await simText();
  assert.match(text, /12,682\.5/, 'saldo final con formato mexicano');
});

test('formato de montos: separador de miles mexicano (12,345 y no 12.345)', async () => {
  await open();
  const s = await page.evaluate(() => money(12345));
  assert.equal(s, '$12,345');
});
