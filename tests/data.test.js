/* Pruebas de la capa de datos para la interfaz (js/abaco-data.js). Sin navegador.
 * Usa un almacenamiento falso que registra cada guardado.
 * Ejecutar: node --test tests/data.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Ledger } = require(path.resolve(__dirname, '..', 'js', 'abaco-core.js'));
const { createDataService } = require(path.resolve(__dirname, '..', 'js', 'abaco-data.js'));
const { StorageError } = (() => { class S extends Error { constructor(c, m) { super(m || c); this.name = 'StorageError'; this.code = c; } } return { StorageError: S }; })();

function setup({ failCommit = null, delayMs = 0 } = {}) {
  let t = Date.UTC(2026, 10, 1, 12);
  let n = 0;
  const ledger = new Ledger({ now: () => t, uid: () => 'x' + (++n) });
  ledger.ensureDefaultAccounts();
  const commits = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const store = {
    async commit(l) {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      inFlight--;
      if (failCommit) throw failCommit;
      commits.push(l.entries.length);
    }
  };
  const data = createDataService({ ledger, app: { user_name: 'Hugo' }, store });
  return { ledger, data, commits, maxInFlight: () => maxInFlight };
}

const efectivoId = (ledger) => ledger.liquidAccounts().find((a) => a.name === 'Efectivo').id;

test('addAccount guarda y aparece en la vista en pesos', async () => {
  const { data, commits } = setup();
  const r = await data.addAccount({ name: 'BBVA', type: 'débito', balance: 5000 });
  assert.equal(r.ok, true);
  assert.equal(commits.length, 1);
  const bbva = data.view().accounts.find((a) => a.name === 'BBVA');
  assert.equal(bbva.balance, 5000);
  assert.equal(data.view().app.user_name, 'Hugo');
});

test('un gasto sin saldo se rechaza con mensaje en español y no se guarda', async () => {
  const { data, ledger, commits } = setup();
  const r = await data.expense({ amount: 10, accountId: efectivoId(ledger) });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'Saldo disponible insuficiente');
  assert.equal(r.code, 'INSUFFICIENT_FUNDS');
  assert.equal(commits.length, 0);
});

test('gasto válido aparece en expenses con importe, categoría y cuenta', async () => {
  const { data, ledger } = setup();
  const ef = efectivoId(ledger);
  await data.adjustAccount(ef, 500);
  const r = await data.expense({ amount: '120.5', description: 'Tacos', category: 'alimentación', accountId: ef });
  assert.equal(r.ok, true);
  const v = data.view();
  assert.equal(v.expenses.length, 1);
  assert.deepEqual(
    { d: v.expenses[0].description, a: v.expenses[0].amount, c: v.expenses[0].category, acc: v.expenses[0].accountId },
    { d: 'Tacos', a: 120.5, c: 'alimentación', acc: ef }
  );
  assert.equal(v.accounts.find((a) => a.id === ef).balance, 379.5);
  assert.equal(v.verify, true);
});

test('transferencia aparece en el historial como transfer', async () => {
  const { data, ledger } = setup();
  const ef = efectivoId(ledger);
  const bbva = (await data.addAccount({ name: 'BBVA', type: 'débito', balance: 1000 })).result;
  await data.transfer({ fromId: bbva.id, toId: ef, amount: 250 });
  const h = data.view().historial.find((x) => x.type === 'transferencia');
  assert.equal(h.direction, 'transfer');
  assert.equal(h.amount, 250);
});

test('ingreso aparece en incomes y en el historial como entrada', async () => {
  const { data, ledger } = setup();
  await data.income({ amount: 800, description: 'Quincena', type: 'salario', accountId: efectivoId(ledger) });
  const v = data.view();
  assert.equal(v.incomes[0].amount, 800);
  assert.equal(v.incomes[0].type, 'salario');
  assert.equal(v.historial.find((h) => h.type === 'ingreso').direction, 'in');
});

test('préstamo: la vista muestra saldo vigente y cuota en pesos', async () => {
  const { data, ledger } = setup();
  await data.addAccount({ name: 'Cartera', type: 'efectivo', balance: 2000 });
  await data.loan({ name: 'Coche', principal: 12000, annualRate: 12, term: 12 });
  const l = data.view().loans[0];
  assert.equal(l.principal, 12000);
  assert.equal(l.current, 12000);
  assert.equal(l.payment, 1066.19);
  await data.loanPayment({ loanId: l.id, accountId: ledger.liquidAccounts().find((a) => a.name === 'Cartera').id });
  const after = data.view().loans[0];
  assert.ok(after.current < 12000 && after.current > 10900, 'saldo tras un pago: ' + after.current);
  assert.equal(after.paid, 1);
});

test('tarjeta y MSI: la vista muestra cuotas y deuda positiva', async () => {
  const { data, ledger } = setup();
  const card = (await data.createCard({ name: 'Oro', limit: 20000 })).result;
  await data.msiPurchase({ cardId: card.id, concept: 'TV', total: 6000, months: 6, purchaseDate: '2026-11-01' });
  const v = data.view();
  assert.equal(v.cards[0].balance, 6000);
  assert.equal(v.msiPlans[0].installments.length, 6);
  assert.equal(v.msiPlans[0].installments.reduce((s, i) => s + i.amount, 0), 6000);
  const pay = await data.msiPay({ planId: v.msiPlans[0].id, number: 1, accountId: efectivoId(ledger) });
  assert.equal(pay.ok, false, 'sin saldo en efectivo no se paga');
  await data.adjustAccount(efectivoId(ledger), 2000);
  await data.msiPay({ planId: v.msiPlans[0].id, number: 1, accountId: efectivoId(ledger) });
  assert.equal(data.view().cards[0].balance, 5000);
  assert.equal(data.view().msiPlans[0].installments[0].paid, true);
});

test('borrar tarjeta con deuda devuelve el mensaje del usuario', async () => {
  const { data } = setup();
  const card = (await data.createCard({ name: 'Oro', limit: 20000 })).result;
  await data.msiPurchase({ cardId: card.id, total: 1000, months: 2, purchaseDate: '2026-11-01' });
  const r = await data.deleteCard(card.id);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'No puedes borrar una tarjeta con deuda pendiente');
});

test('si el guardado falla, la operación se reporta como fallida', async () => {
  const { data, ledger } = setup({ failCommit: new StorageError('WRITE_FAILED', 'cuota llena') });
  const r = await data.adjustAccount(efectivoId(ledger), 100);
  assert.equal(r.ok, false);
  assert.match(r.error, /No se pudo guardar: cuota llena/);
});

test('las operaciones se encolan: nunca hay dos guardados a la vez', async () => {
  const { data, ledger, maxInFlight } = setup({ delayMs: 5 });
  const ef = efectivoId(ledger);
  await Promise.all([
    data.adjustAccount(ef, 100),
    data.income({ amount: 10, accountId: ef }),
    data.income({ amount: 20, accountId: ef }),
    data.expense({ amount: 5, accountId: ef }),
    data.setApp({ theme: 'dark' })
  ]);
  assert.equal(maxInFlight(), 1);
  assert.equal(data.view().accounts.find((a) => a.id === ef).balance, 125);
});

test('vista: totales coinciden con el núcleo', async () => {
  const { data, ledger } = setup();
  await data.addAccount({ name: 'BBVA', type: 'débito', balance: 5000 });
  await data.adjustAccount(efectivoId(ledger), 1000);
  const lent = await data.lend({ person: 'Ana', amount: 300, accountId: efectivoId(ledger) });
  assert.equal(lent.ok, true, 'el préstamo debe registrarse para que la prueba signifique algo');
  const t = data.view().totals;
  assert.equal(t.netWorth, ledger.netWorth() / 100);
  assert.equal(t.assets, 6000, 'BBVA 5000 + Efectivo 700 + por cobrar 300');
  assert.equal(t.debt, 0);
});
