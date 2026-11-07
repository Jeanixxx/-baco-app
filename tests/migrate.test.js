/* Pruebas de la migración v2 → v3 (js/abaco-migrate.js). Sin navegador.
 * Ejecutar: node --test tests/migrate.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Ledger } = require(path.resolve(__dirname, '..', 'js', 'abaco-core.js'));
const { migrateLegacy } = require(path.resolve(__dirname, '..', 'js', 'abaco-migrate.js'));

/* Estado antiguo con la forma real de localStorage de la app v2. */
function legacyFixture() {
  const msiPurchase = Date.UTC(2026, 9, 15, 12);
  return {
    user_id: 'u1',
    user_name: 'Hugo',
    theme: 'dark',
    pinned: ['hormiga', 'inicio'],
    accounts: [
      { id: 'a-ef', name: 'Efectivo', type: 'efectivo', balance: 850 },
      { id: 'a-bb', name: 'BBVA', type: 'débito', balance: 4500 },
      { id: 'a-card', name: 'Oro', type: 'crédito', balance: 2000, card_id: 'c1' }
    ],
    cards: [{ id: 'c1', name: 'Oro', type: 'crédito', limit: 20000, balance: 2000, wallet_id: 'a-card' }],
    msiPlans: [{
      id: 'm1', cardId: 'c1', concept: 'TV', total: 6000, months: 6, purchase_date: msiPurchase,
      installments: [
        { number: 1, amount: 1000, paid: true },
        { number: 2, amount: 1000, paid: false },
        { number: 3, amount: 1000, paid: true },
        { number: 4, amount: 1000, paid: false },
        { number: 5, amount: 1000, paid: false },
        { number: 6, amount: 1000, paid: false }
      ]
    }],
    loans: [{ id: 'l1', name: 'Coche', type: 'personal', principal: 12000, current: 10900, annualRate: 12, term: 12, payment: 1066.19, paid: 1 }],
    debtors: [
      { id: 'd1', person: 'Ana', concept: 'Comida', amount: 300, remaining: 300, settled: false, date: '2026-11-01' },
      { id: 'd2', person: 'Luis', concept: 'Taxi', amount: 80, remaining: 0, settled: true }
    ],
    savings: [{ id: 's1', name: 'Vacaciones', amount: 400, current: 550, type: 'open', target: 1000 }],
    investments: [{ id: 'i1', name: 'CETES', amount: 500, current: 520, rate: 10, date: '2026-10-01' }],
    budgets: [{ id: 'b1', concept: 'Comida', category: 'alimentación', amount: 2500 }],
    expenses: [{ id: 'e1', description: 'Tacos', amount: 200, created_at: 1 }],
    historial: [{ id: 'h1', description: 'Tacos', amount: 200, direction: 'out' }],
    shop: [{ id: 'sh1', name: 'Pan', price: 30, status: 'pending' }]
  };
}

const clock = () => Date.UTC(2026, 10, 1, 12);

test('la migración produce un ledger que cuadra', () => {
  const r = migrateLegacy(legacyFixture(), { Ledger, now: clock });
  assert.equal(r.report.verify.ok, true, JSON.stringify(r.report.verify.issues));
  assert.equal(r.ledger.verify().ok, true);
});

test('cuentas normales conservan su saldo actual', () => {
  const r = migrateLegacy(legacyFixture(), { Ledger, now: clock });
  const byName = (n) => r.ledger.listAccounts().find((a) => a.name === n);
  assert.equal(byName('Efectivo').balanceC, 85000);
  assert.equal(byName('BBVA').balanceC, 450000);
});

test('la cuenta de crédito vinculada a la tarjeta no se duplica', () => {
  const r = migrateLegacy(legacyFixture(), { Ledger, now: clock });
  const oro = r.ledger.listAccounts({ includeInternal: true }).filter((a) => a.name === 'Oro');
  assert.equal(oro.length, 1);
  assert.equal(r.report.counts.cards, 1);
});

test('MSI: cuotas pagadas en cualquier orden y deuda igual a la app antigua', () => {
  const r = migrateLegacy(legacyFixture(), { Ledger, now: clock });
  const plan = [...r.ledger.msiPlans.values()][0];
  assert.deepEqual(plan.installments.map((i) => i.paid), [true, false, true, false, false, false]);
  const card = [...r.ledger.cards.values()][0];
  // La app antigua registraba 2000 de deuda; la migración la deja en 2000 exactos.
  assert.equal(r.ledger.cardDebt(card.id), 200000);
});

test('préstamo: conserva el saldo vigente y la cuota antigua', () => {
  const r = migrateLegacy(legacyFixture(), { Ledger, now: clock });
  const loan = [...r.ledger.loans.values()][0];
  assert.equal(loan.paymentC, 106619);
  assert.equal(loan.term, 11, 'plazo restante = 12 - 1 pagado');
  assert.equal(-r.ledger.balance(loan.id), 1090000);
});

test('cobros pendientes se importan y los liquidados se ignoran', () => {
  const r = migrateLegacy(legacyFixture(), { Ledger, now: clock });
  const debtors = [...r.ledger.debtors.values()];
  assert.equal(debtors.length, 1);
  assert.equal(debtors[0].person, 'Ana');
  assert.equal(r.ledger.balance(debtors[0].id), 30000);
});

test('ahorros e inversiones con su saldo actual', () => {
  const r = migrateLegacy(legacyFixture(), { Ledger, now: clock });
  const goal = [...r.ledger.goals.values()][0];
  const inv = [...r.ledger.investments.values()][0];
  assert.equal(r.ledger.balance(goal.id), 55000);
  assert.equal(r.ledger.balance(inv.id), 52000);
});

test('presupuestos, historial archivado y datos de la app se conservan', () => {
  const r = migrateLegacy(legacyFixture(), { Ledger, now: clock });
  assert.equal(r.ledger.budgets.size, 1);
  assert.equal(r.legacyHistory.expenses.length, 1, 'el gasto antiguo queda archivado, no como movimiento');
  assert.equal(r.legacyHistory.historial.length, 1);
  assert.equal(r.app.user_name, 'Hugo');
  assert.equal(r.app.theme, 'dark');
  assert.equal(r.app.shop.length, 1);
});

test('la migración no duplica dinero: el patrimonio neto es el de la app antigua', () => {
  const r = migrateLegacy(legacyFixture(), { Ledger, now: clock });
  const liquid = r.ledger.liquidAccounts().reduce((s, a) => s + a.balanceC, 0);
  assert.equal(liquid, 85000 + 450000);
  // activos: líquidos 5350 + ahorro 550 + inversión 520 + por cobrar 300 = 6720
  // deudas: tarjeta 2000 + préstamo 10900 = 12900 → neto = -6180
  assert.equal(r.ledger.netWorth(), -618000);
});

test('un saldo negativo en una cuenta líquida se avisa y se migra como 0', () => {
  const data = legacyFixture();
  data.accounts.push({ id: 'a-x', name: 'Caja', type: 'efectivo', balance: -50 });
  const r = migrateLegacy(data, { Ledger, now: clock });
  assert.ok(r.report.warnings.some((w) => w.includes('Caja')));
  assert.equal(r.ledger.listAccounts().find((a) => a.name === 'Caja').balanceC, 0);
  assert.equal(r.report.verify.ok, true);
});

test('sin datos antiguos la migración solo crea las cuentas por defecto', () => {
  const r = migrateLegacy({}, { Ledger, now: clock });
  assert.deepEqual(r.ledger.listAccounts().map((a) => a.name).sort(), ['Débito', 'Efectivo']);
  assert.equal(r.report.verify.ok, true);
});
