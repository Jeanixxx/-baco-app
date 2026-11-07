/* Pruebas unitarias del núcleo financiero (js/abaco-core.js). Sin navegador.
 * Ejecutar: node --test tests/core.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Ledger, CoreError, EXT, monthlyPaymentCents, splitCents, toCents } = require(path.resolve(__dirname, '..', 'js', 'abaco-core.js'));

/* Reloj fijo y ids secuenciales para que las pruebas sean deterministas. */
function make(startMs = Date.UTC(2026, 10, 1, 12)) {
  let t = startMs;
  let n = 0;
  return new Ledger({ now: () => t, uid: () => 'id' + (++n) });
}
const byName = (l, name) => l.listAccounts().find((a) => a.name === name);
const assertOk = (l) => {
  const v = l.verify();
  assert.equal(v.ok, true, JSON.stringify(v.issues));
};

/* ---------- utilidades ---------- */

test('toCents convierte pesos a centavos sin flotantes', () => {
  assert.equal(toCents('0.1'), 10);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents('1250'), 125000);
  assert.throws(() => toCents('abc'), (e) => e.code === 'INVALID_AMOUNT');
  assert.throws(() => toCents(0), (e) => e.code === 'INVALID_AMOUNT');
  assert.throws(() => toCents(-5), (e) => e.code === 'INVALID_AMOUNT');
  assert.equal(toCents(0, { allowZero: true }), 0);
});

test('splitCents reparte exactamente en centavos', () => {
  const parts = splitCents(600000, 6);
  assert.equal(parts.reduce((a, b) => a + b, 0), 600000);
  const odd = splitCents(10000, 3);
  assert.equal(odd.reduce((a, b) => a + b, 0), 10000);
  assert.deepEqual(odd, [3333, 3333, 3334]);
});

test('cuota francesa coincide con la fórmula que usa la app', () => {
  // 12 000 a 12 % anual en 12 meses ≈ 1 066.18
  assert.equal(monthlyPaymentCents(1200000, 12, 12), 106619); // 1066.1854… redondea a 1066.19
  assert.equal(monthlyPaymentCents(1200000, 0, 12), 100000);
});

/* ---------- cuentas y saldos iniciales ---------- */

test('ensureDefaultAccounts crea Efectivo y Débito con saldo 0', () => {
  const l = make();
  l.ensureDefaultAccounts();
  assert.equal(l.listAccounts().length, 2);
  assert.equal(byName(l, 'Efectivo').balanceC, 0);
  assert.equal(byName(l, 'Débito').balanceC, 0);
  assertOk(l);
});

test('saldo inicial de una cuenta queda en el ledger y cuadra', () => {
  const l = make();
  const acc = l.createAccount({ name: 'BBVA', type: 'débito', balance: 5000 });
  assert.equal(l.balance(acc.id), 500000);
  assert.equal(l.balance(EXT.OPENING), -500000);
  assertOk(l);
});

test('una cuenta de crédito con saldo inicial registra una deuda', () => {
  const l = make();
  const acc = l.createAccount({ name: 'Liverpool', type: 'crédito', balance: 800 });
  assert.equal(l.balance(acc.id), -80000);
  assert.equal(l.totalDebt(), 80000);
  assertOk(l);
});

test('no se permite crear cuentas sin nombre ni con tipo desconocido', () => {
  const l = make();
  assert.throws(() => l.createAccount({ name: ' ', type: 'débito' }), (e) => e.code === 'INVALID_NAME');
  assert.throws(() => l.createAccount({ name: 'X', type: 'cripto' }), (e) => e.code === 'INVALID_TYPE');
});

/* ---------- movimientos cotidianos ---------- */

test('gasto descuenta de la cuenta elegida, no de la primera', () => {
  const l = make();
  l.ensureDefaultAccounts();
  const bbva = l.createAccount({ name: 'BBVA', type: 'débito', balance: 1000 });
  l.expense({ amount: '200', description: 'Tacos', category: 'alimentación', accountId: bbva.id });
  assert.equal(l.balance(bbva.id), 80000);
  assert.equal(byName(l, 'Efectivo').balanceC, 0, 'la primera cuenta no se toca');
  assertOk(l);
});

test('gasto sin cuenta elegida usa la primera líquida', () => {
  const l = make();
  l.ensureDefaultAccounts();
  const efectivo = byName(l, 'Efectivo');
  l.adjustBalance(efectivo.id, 500);
  l.expense({ amount: 120 });
  assert.equal(l.balance(efectivo.id), 38000);
  assertOk(l);
});

test('gasto mayor al saldo se rechaza sin dejar huella', () => {
  const l = make();
  const c = l.createAccount({ name: 'Cartera', type: 'efectivo', balance: 100 });
  const before = l.entries.length;
  assert.throws(() => l.expense({ amount: 999, accountId: c.id }), (e) => e.code === 'INSUFFICIENT_FUNDS');
  assert.equal(l.entries.length, before);
  assert.equal(l.balance(c.id), 10000);
  assertOk(l);
});

test('ingreso suma y aparece en el ledger', () => {
  const l = make();
  const bbva = l.createAccount({ name: 'BBVA', type: 'débito', balance: 5000 });
  l.income({ amount: 1000, description: 'Quincena', type: 'salario', accountId: bbva.id });
  assert.equal(l.balance(bbva.id), 600000);
  assertOk(l);
});

test('transferencia conserva el patrimonio neto y exige cuentas líquidas distintas', () => {
  const l = make();
  const a = l.createAccount({ name: 'A', type: 'débito', balance: 5000 });
  const b = l.createAccount({ name: 'B', type: 'débito', balance: 2000 });
  const before = l.netWorth();
  l.transfer({ fromId: a.id, toId: b.id, amount: 500 });
  assert.equal(l.balance(a.id), 450000);
  assert.equal(l.balance(b.id), 250000);
  assert.equal(l.netWorth(), before);
  assert.throws(() => l.transfer({ fromId: a.id, toId: a.id, amount: 1 }), (e) => e.code === 'SAME_ACCOUNT');
  assertOk(l);
});

test('precisión: 0.10 + 0.20 suman exactamente 0.30', () => {
  const l = make();
  const c = l.createAccount({ name: 'C', type: 'efectivo', balance: 0 });
  l.income({ amount: 0.1, accountId: c.id });
  l.income({ amount: 0.2, accountId: c.id });
  assert.equal(l.balance(c.id), 30);
  assertOk(l);
});

test('revertir un gasto deja el saldo original y conserva el historial', () => {
  const l = make();
  const c = l.createAccount({ name: 'C', type: 'efectivo', balance: 300 });
  const e = l.expense({ amount: 100, accountId: c.id });
  l.reverse(e.id);
  assert.equal(l.balance(c.id), 30000);
  assert.equal(l.entries.length, 3, 'apertura + gasto + reversa');
  assert.equal(l.entries.find((x) => x.id === e.id).reversed, true);
  assert.throws(() => l.reverse(e.id), (x) => x.code === 'ALREADY_REVERSED');
  assertOk(l);
});

/* ---------- cuentas por cobrar, ahorros e inversiones ---------- */

test('prestar y cobrar: el dinero sale de la cuenta elegida y vuelve completo', () => {
  const l = make();
  const efectivo = l.createAccount({ name: 'Efectivo', type: 'efectivo', balance: 1000 });
  const debtor = l.lend({ person: 'Ana', concept: 'Comida', amount: 300, accountId: efectivo.id });
  assert.equal(l.balance(efectivo.id), 70000);
  assert.equal(l.totalAssets(), 100000, 'lo prestado sigue siendo activo');
  l.collect({ debtorId: debtor.id, accountId: efectivo.id });
  assert.equal(l.balance(efectivo.id), 100000);
  assert.equal(debtor.settled, true);
  assert.throws(() => l.collect({ debtorId: debtor.id }), (e) => e.code === 'ALREADY_SETTLED');
  assertOk(l);
});

test('ahorro y aportes se acumulan en la meta sin mover el patrimonio', () => {
  const l = make();
  const bbva = l.createAccount({ name: 'BBVA', type: 'débito', balance: 1000 });
  const before = l.netWorth();
  const goal = l.createGoal({ name: 'Vacaciones', amount: 400, target: 1000, accountId: bbva.id });
  l.contributeGoal({ goalId: goal.id, amount: 100, accountId: bbva.id });
  assert.equal(l.balance(bbva.id), 50000);
  assert.equal(l.balance(goal.id), 50000, 'la meta acumula 400 + 100');
  assert.equal(l.netWorth(), before);
  assertOk(l);
});

test('inversión descuenta la cuenta y el rendimiento cuenta como ingreso', () => {
  const l = make();
  const bbva = l.createAccount({ name: 'BBVA', type: 'débito', balance: 1000 });
  const inv = l.invest({ name: 'CETES', amount: 500, rate: 10, accountId: bbva.id });
  assert.equal(l.balance(bbva.id), 50000);
  l.accrue({ holdingId: inv.id, amount: 5 });
  assert.equal(l.balance(inv.id), 50500);
  assertOk(l);
});

/* ---------- préstamos ---------- */

test('préstamo existente no mueve efectivo; con disburse sí', () => {
  const l = make();
  const c = l.createAccount({ name: 'Cartera', type: 'efectivo', balance: 0 });
  const p = l.loan({ name: 'Coche', principal: 12000, annualRate: 12, term: 12, accountId: c.id });
  assert.equal(l.balance(c.id), 0);
  assert.equal(l.totalDebt(), 1200000);
  const q = l.loan({ name: 'Moto', principal: 1000, annualRate: 0, term: 2, disburse: true, accountId: c.id });
  assert.equal(l.balance(c.id), 100000);
  assert.ok(p && q);
  assertOk(l);
});

test('pago de préstamo separa interés (gasto) y capital (deuda)', () => {
  const l = make();
  const c = l.createAccount({ name: 'Cartera', type: 'efectivo', balance: 5000 });
  const loan = l.loan({ name: 'Coche', principal: 12000, annualRate: 12, term: 12 });
  const r = l.loanPayment({ loanId: loan.id, accountId: c.id });
  assert.equal(r.interestC, 12000, 'interés del primer mes: 120.00');
  assert.equal(r.principalC, 106619 - 12000);
  assert.equal(l.balance(c.id), 500000 - 106619);
  assert.equal(l.balance(EXT.EXPENSE), 12000, 'el interés se reconoce como gasto');
  assert.equal(loan.paid, 1);
  assertOk(l);
});

test('pagar todas las mensualidades deja el préstamo en cero exacto', () => {
  const l = make();
  const c = l.createAccount({ name: 'Cartera', type: 'efectivo', balance: 100000 });
  const loan = l.loan({ name: 'Coche', principal: 12000, annualRate: 12, term: 12 });
  for (let i = 0; i < 12; i++) l.loanPayment({ loanId: loan.id, accountId: c.id });
  assert.equal(l.balance(loan.id), 0);
  assert.throws(() => l.loanPayment({ loanId: loan.id, accountId: c.id }), (e) => e.code === 'ALREADY_PAID');
  assertOk(l);
});

/* ---------- tarjetas y MSI ---------- */

test('MSI: crea seis cuotas que suman exacto y deja la deuda de la tarjeta', () => {
  const l = make();
  const card = l.createCard({ name: 'Oro', limit: 20000 });
  const plan = l.msiPurchase({ cardId: card.id, concept: 'TV', total: 6000, months: 6, purchaseDate: '2026-11-01' });
  assert.equal(plan.installments.length, 6);
  assert.equal(plan.installments.reduce((s, i) => s + i.amount, 0), 600000);
  assert.equal(l.cardDebt(card.id), 600000);
  assertOk(l);
});

test('MSI: pagar una cuota baja la deuda y se reconoce como gasto', () => {
  const l = make();
  const c = l.createAccount({ name: 'BBVA', type: 'débito', balance: 5000 });
  const card = l.createCard({ name: 'Oro', limit: 20000 });
  const plan = l.msiPurchase({ cardId: card.id, concept: 'TV', total: 6000, months: 6, purchaseDate: '2026-11-01' });
  const expenseBefore = l.balance(EXT.EXPENSE);
  l.msiPayInstallment({ planId: plan.id, number: 1, accountId: c.id });
  assert.equal(l.cardDebt(card.id), 500000);
  assert.equal(l.balance(c.id), 500000 - 100000);
  assert.equal(l.balance(EXT.EXPENSE) - expenseBefore, 100000);
  assert.equal(l.balance(EXT.MSI), 500000, 'lo pendiente baja al ritmo de las cuotas');
  assertOk(l);
});

test('MSI: revertir un pago devuelve dinero y deuda', () => {
  const l = make();
  const c = l.createAccount({ name: 'BBVA', type: 'débito', balance: 5000 });
  const card = l.createCard({ name: 'Oro', limit: 20000 });
  const plan = l.msiPurchase({ cardId: card.id, total: 6000, months: 6, purchaseDate: '2026-11-01' });
  l.msiPayInstallment({ planId: plan.id, number: 2, accountId: c.id });
  l.msiRevertInstallment({ planId: plan.id, number: 2 });
  assert.equal(l.balance(c.id), 500000);
  assert.equal(l.cardDebt(card.id), 600000);
  assert.equal(plan.installments[1].paid, false);
  assertOk(l);
});

test('MSI: cuotas pagadas antes no generan movimientos', () => {
  const l = make();
  const card = l.createCard({ name: 'Oro', limit: 20000 });
  l.msiPurchase({ cardId: card.id, total: 6000, months: 6, paidBefore: 2, purchaseDate: '2026-11-01' });
  assert.equal(l.cardDebt(card.id), 400000);
  assertOk(l);
});

test('tarjeta con deuda no se puede borrar; sin deuda sí', () => {
  const l = make();
  const c = l.createAccount({ name: 'BBVA', type: 'débito', balance: 5000 });
  const card = l.createCard({ name: 'Oro', limit: 20000 });
  const plan = l.msiPurchase({ cardId: card.id, total: 1000, months: 2, purchaseDate: '2026-11-01' });
  assert.throws(() => l.deleteCard(card.id), (e) => e.code === 'CARD_HAS_DEBT');
  l.msiPayInstallment({ planId: plan.id, number: 1, accountId: c.id });
  l.msiPayInstallment({ planId: plan.id, number: 2, accountId: c.id });
  assert.equal(l.deleteCard(card.id), true);
  assert.equal(l.cards.size, 0);
  assert.equal(l.msiPlans.size, 0);
  assertOk(l);
});

/* ---------- presupuestos, patrimonio y persistencia ---------- */

test('presupuesto suma el gasto de su categoría dentro del periodo', () => {
  const l = make();
  const c = l.createAccount({ name: 'C', type: 'efectivo', balance: 1000 });
  l.setBudget({ category: 'alimentación', amount: 500 });
  l.expense({ amount: 120, category: 'alimentación', accountId: c.id });
  l.expense({ amount: 30, category: 'transporte', accountId: c.id });
  const [b] = l.budgetProgress(0, Date.now() + 1);
  assert.equal(b.spentC, 12000);
  assert.equal(b.remainingC, 38000);
});

test('toJSON / fromJSON conserva saldos y cuadra', () => {
  const l = make();
  const c = l.createAccount({ name: 'BBVA', type: 'débito', balance: 5000 });
  const card = l.createCard({ name: 'Oro', limit: 20000 });
  l.msiPurchase({ cardId: card.id, total: 6000, months: 6, purchaseDate: '2026-11-01' });
  l.expense({ amount: 99.99, accountId: c.id });
  const copy = JSON.parse(JSON.stringify(l.toJSON()));
  const r = Ledger.fromJSON(copy);
  assert.equal(r.balance(c.id), l.balance(c.id));
  assert.equal(r.netWorth(), l.netWorth());
  assertOk(r);
});

test('fromJSON rechaza datos que no cuadran', () => {
  const l = make();
  l.createAccount({ name: 'BBVA', type: 'débito', balance: 50 });
  const data = JSON.parse(JSON.stringify(l.toJSON()));
  data.entries[0].postings[0].amount += 1;
  assert.throws(() => Ledger.fromJSON(data), (e) => e.code === 'CORRUPT_DATA');
});

test('propiedad: miles de operaciones aleatorias mantienen la partida doble y ningún líquido negativo', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const l = make();
  l.ensureDefaultAccounts();
  l.createAccount({ name: 'BBVA', type: 'débito', balance: 3000 });
  const card = l.createCard({ name: 'Oro', limit: 50000 });
  const liquid = () => l.liquidAccounts().map((a) => a.id);
  const debtors = [], goals = [], loans = [], plans = [];
  for (let step = 0; step < 2000; step++) {
    const op = Math.floor(rnd() * 11);
    const amount = Math.round(rnd() * 50000) / 100 + 0.01;
    try {
      if (op === 0) l.income({ amount, accountId: pick(liquid()) });
      else if (op === 1) l.expense({ amount, accountId: pick(liquid()) });
      else if (op === 2) l.transfer({ fromId: pick(liquid()), toId: pick(liquid()), amount });
      else if (op === 3) debtors.push(l.lend({ person: 'P', amount, accountId: pick(liquid()) }).id);
      else if (op === 4 && debtors.length) l.collect({ debtorId: pick(debtors), accountId: pick(liquid()) });
      else if (op === 5) goals.push(l.createGoal({ name: 'G', amount, accountId: pick(liquid()) }).id);
      else if (op === 6 && goals.length) l.contributeGoal({ goalId: pick(goals), amount, accountId: pick(liquid()) });
      else if (op === 7) loans.push(l.loan({ name: 'L', principal: amount * 10, annualRate: 12, term: 6 }).id);
      else if (op === 8 && loans.length) l.loanPayment({ loanId: pick(loans), accountId: pick(liquid()) });
      else if (op === 9) plans.push(l.msiPurchase({ cardId: card.id, total: amount, months: 3, purchaseDate: '2026-11-01' }).id);
      else if (op === 10 && plans.length) {
        const plan = l.msiPlans.get(pick(plans));
        const next = plan && plan.installments.findIndex((i) => !i.paid);
        if (next >= 0) l.msiPayInstallment({ planId: plan.id, number: next + 1, accountId: pick(liquid()) });
      }
    } catch (e) {
      if (!(e instanceof CoreError)) throw e;
      // Rechazos esperados (saldo insuficiente, etc.): no deben romper el ledger.
    }
    if (step % 200 === 0) assertOk(l);
  }
  assertOk(l);
  for (const a of l.liquidAccounts()) assert.ok(a.balanceC >= 0, a.name + ' negativo');
  assert.ok(l.entries.length > 500, 'la prueba debe ejecutar operaciones reales');
});
