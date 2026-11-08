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
  // La app es para teléfono: las pruebas de interfaz usan la ventana de teléfono.
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
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

/* ---------- delegación de eventos: los botones de las listas funcionan con clics reales ---------- */

test('delegación: el botón de borrar un cobro en la lista funciona con un clic', async () => {
  await open();
  await register();
  await setBalance('Efectivo', 1000);
  await fields({ debtPerson: 'Ana', debtConcept: 'Comida', debtAmount: '300', debtDate: '2026-11-01' });
  await act('addDebtor');
  await page.evaluate(() => goPanel('deudores'));
  await page.waitForTimeout(350);
  await page.click('[data-debt-del]');
  await page.waitForSelector('.abaco-dialog');
  await page.click('.abaco-dialog-actions .btn-danger, .abaco-dialog-actions .btn-primary');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => state.debtors.length), 0);
  assert.equal(await balance('Efectivo'), 1000);
});

test('delegación: pagar una cuota MSI con un clic en la lista de tarjetas', async () => {
  await open();
  await register();
  await setBalance('Efectivo', 5000);
  await fields({ cardName: 'Oro', cardType: 'crédito', cardLimit: '20000' });
  await act('addCard');
  const cardId = await page.evaluate(() => state.cards[0].id);
  await fields({ msiCardSelect: cardId, msiConcept: 'TV', msiTotal: '6000', msiMonths: '6', msiPaidBefore: '0', msiPurchaseDate: '2026-11-01' });
  await act('addMsi');
  await page.evaluate(() => goPanel('tarjetas'));
  await page.waitForTimeout(350);
  await page.click('[data-calm="tarjeta"]');   // el plan se abre en una hoja al tocar la tarjeta
  await page.click('#calmSheet [data-msi-paid]');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => state.msiPlans[0].installments[0].paid), true);
});

test('delegación: los botones siguen funcionando después de repintar la lista', async () => {
  await open();
  await register();
  await setBalance('Efectivo', 1000);
  await fields({ debtPerson: 'Ana', debtConcept: 'A', debtAmount: '100', debtDate: '2026-11-01' });
  await act('addDebtor');
  await fields({ debtPerson: 'Luis', debtConcept: 'B', debtAmount: '50', debtDate: '2026-11-01' });
  await act('addDebtor');
  await page.evaluate(() => goPanel('deudores'));
  await page.waitForTimeout(350);
  // Repintar varias veces no debe duplicar ni perder el manejador.
  await page.evaluate(() => { renderDebtors(); renderDebtors(); });
  const buttons = await page.locator('[data-debt-del]').count();
  assert.equal(buttons, 2);
  await page.click('[data-debt-del]');
  await page.waitForSelector('.abaco-dialog');
  await page.click('.abaco-dialog-actions .btn-danger, .abaco-dialog-actions .btn-primary');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => state.debtors.length), 1, 'un clic borra exactamente un registro');
});

/* ---------- tablero de Inicio: botones por delegación ---------- */

/* Con el rediseño, "Gráficas" se abre desde el mosaico de Estadísticas. */
async function openCharts() {
  await page.evaluate(() => goPanel('estadisticas'));
  await page.click('#xv-estadisticas [data-x="stats-more"]');   // "Ver más" muestra los mosaicos
  await page.click('#xv-estadisticas [data-x="charts"]');
  await page.waitForFunction(() => document.getElementById('chartsBlock').classList.contains('chart-modal-open'));
}

test('tablero: el botón de gráficas abre y cierra el panel con clics', async () => {
  await open();
  await register();
  const open_ = () => page.evaluate(() => document.getElementById('chartsBlock').classList.contains('chart-modal-open'));
  assert.equal(await open_(), false);
  await openCharts();
  assert.equal(await open_(), true, 'se abre');
  assert.equal(await page.evaluate(() => state.activePanel), 'inicio', 'las gráficas viven en Inicio');
  await page.click('#btnCloseCharts');
  assert.equal(await open_(), false, 'se cierra con Cerrar');
});

test('tablero: el fondo oscuro cierra las gráficas abiertas', async () => {
  await open();
  await register();
  await openCharts();
  // La hoja de gráficas cubre la pantalla después de su animación de entrada, así que un clic con el dedo
  // sobre el fondo solo cabría en los primeros milisegundos. Se dispara el evento directo sobre el fondo
  // para probar que el botón delegado lo atiende, sin depender del tiempo.
  await page.dispatchEvent('#chartsModalBackdrop', 'click');
  assert.equal(await page.evaluate(() => document.getElementById('chartsBlock').classList.contains('chart-modal-open')), false);
});

test('tablero: Ver todas abre el listado de categorías', async () => {
  await open();
  await register();
  await openCharts();   // "Ver todas" vive dentro del panel de gráficas
  await page.click('#btnAllCats');
  await page.waitForTimeout(200);
  assert.match(await page.evaluate(() => document.body.innerText), /Todas las categorías/);
});

/* ---------- tour de bienvenida (js/abaco-tour.js) ---------- */

async function registerOnly(name = 'Hugo') {
  await page.fill('#userName', name);
  await page.click('#btnRegister');
  await page.waitForFunction(() => !!state.user_id);
  await page.waitForSelector('#step-wallet:not(.hidden)');
}

test('tour: recoge saldos, día de pago, sobres y un pago fijo, y termina en Hoy', async () => {
  await open();
  await registerOnly();
  assert.match(await page.textContent('#tourBody'), /Así funciona tu día/);
  assert.equal(await page.isVisible('#btnTourLater'), false, 'el primer paso solo enseña');
  await page.click('#btnNextWalletQuiz');
  await page.fill('#tourCash', '1200');
  await page.fill('#tourBank', '15000');
  await page.click('#btnNextWalletQuiz');
  await page.waitForFunction(() => /Cada cuánto/.test(document.getElementById('tourBody').textContent));
  await page.click('[data-tour-pay="quincenal"]');
  await page.fill('#tourPayAmount', '16200');
  await page.click('#btnNextWalletQuiz');
  await page.waitForFunction(() => !!document.getElementById('tourFood'));
  await page.fill('#tourFood', '3000');
  await page.click('#btnNextWalletQuiz');
  await page.waitForFunction(() => !!document.getElementById('tourSubName'));
  await page.fill('#tourSubName', 'Streaming');
  await page.fill('#tourSubAmount', '199');
  await page.fill('#tourSubDay', '15');
  await page.click('#btnNextWalletQuiz');
  await page.waitForFunction(() => /Anota en un toque/.test(document.getElementById('tourBody').textContent));
  assert.equal(await page.textContent('#btnNextWalletQuiz'), 'Empezar');
  await page.click('#btnNextWalletQuiz');
  await page.waitForFunction(() => state.activePanel === 'inicio');
  assert.equal(await page.isVisible('#step-wallet'), false);
  const r = await page.evaluate(() => ({
    efectivo: state.accounts.find((a) => a.name === 'Efectivo').balance,
    debito: state.accounts.find((a) => a.name === 'Débito').balance,
    sobre: state.budgets.find((b) => b.category === 'comida').amount,
    sub: state.subscriptions.map((x) => [x.name, x.amount, Number(x.date.slice(8, 10))]),
    perfil: AbacoExtrasUI.extras().profile
  }));
  assert.deepEqual(r, { efectivo: 1200, debito: 15000, sobre: 3000, sub: [['Streaming', 199, 15]], perfil: { payFreq: 'quincenal', payAmount: 16200 } });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('wallet_quiz')).done), true);
});

test('tour: "Ahora no" salta un paso sin guardar y "Saltar tour" termina en cualquier momento', async () => {
  await open();
  await registerOnly();
  await page.click('#btnNextWalletQuiz');
  await page.fill('#tourCash', '999');
  await page.click('#btnTourLater');
  await page.waitForFunction(() => /Cada cuánto/.test(document.getElementById('tourBody').textContent));
  assert.equal(await page.evaluate(() => state.accounts.find((a) => a.name === 'Efectivo').balance), 0, '"Ahora no" no guarda');
  await page.click('#btnSkipWalletQuiz');
  await page.waitForFunction(() => document.getElementById('step-wallet').classList.contains('hidden'));
  assert.equal(await page.isVisible('#appPanels'), true);
});

test('tour: valida sin regañar (un monto negativo no avanza)', async () => {
  await open();
  await registerOnly();
  await page.click('#btnNextWalletQuiz');
  await page.fill('#tourCash', '-5');
  await page.click('#btnNextWalletQuiz');
  await page.waitForFunction(() => /no puede ser negativo/.test(document.getElementById('toast').textContent));
  assert.ok(await page.$('#tourCash'), 'se queda en el mismo paso');
});

test('Hoy recuerda anotar el ingreso el día de pago (según el tour)', async () => {
  await open();
  await register();
  const quincena = await page.evaluate(() => {
    AbacoExtrasUI.extras().profile = { payFreq: 'quincenal' };
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 15, 10).getTime();
  });
  await page.evaluate((t) => { window.__abacoNow = t; goPanel('inicio'); }, quincena);
  assert.match(await page.textContent('#homeToday'), /Hoy es día de pago/);
  await page.click('#homeToday [data-calm="go-income"]');
  assert.equal(await page.evaluate(() => state.activePanel), 'hormiga');
  assert.equal(await page.textContent('#regQ'), '¿Cuánto te entró?', 'abre Registrar en modo ingreso');
  assert.equal(await page.evaluate(() => AbacoTour.isPayday('semanal', new Date(2026, 10, 13).getTime())), true, 'viernes');
  assert.equal(await page.evaluate(() => AbacoTour.isPayday('mensual', new Date(2026, 10, 30).getTime())), true, 'último día');
  assert.equal(await page.evaluate(() => AbacoTour.isPayday('variable', new Date(2026, 10, 30).getTime())), false);
});
