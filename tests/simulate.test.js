/* Pruebas del simulador financiero (js/abaco-simulate.js). Sin navegador.
 * Ejecutar: node --test tests/simulate.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const S = require(path.resolve(__dirname, '..', 'js', 'abaco-simulate.js'));

test('suscripciones: convierte cada frecuencia a costo mensual', () => {
  const r = S.subscriptions([
    { name: 'Netflix', amount: 199, frequency: 'mensual' },
    { name: 'Gym', amount: 50, frequency: 'semanal' },
    { name: 'Dominio', amount: 1200, frequency: 'anual' }
  ]);
  // 199 + 50·52/12 + 1200/12 = 515.67
  assert.ok(Math.abs(r.monthlyTotal - 515.67) < 0.01, 'mensual ' + r.monthlyTotal);
  assert.ok(Math.abs(r.yearlyTotal - 6188.0) < 0.1, 'anual ' + r.yearlyTotal);
  assert.equal(r.rows[0].name, 'Gym', 'gym semanal (216.67 al mes) pesa más que Netflix (199)');
  assert.equal(r.cumulative.length, 12);
  assert.ok(Math.abs(r.cumulative[11] - r.yearlyTotal) < 0.1);
});

test('cancelar una suscripción: ahorro durante el periodo', () => {
  const subs = [{ name: 'Netflix', amount: 199, frequency: 'mensual' }];
  assert.equal(S.cancelSaving(subs, 'Netflix', { months: 12 }).saved, 2388);
  assert.equal(S.cancelSaving(subs, 'No existe').saved, 0);
});

test('pago mínimo de un préstamo coincide con la fórmula francesa', () => {
  // 12 000 a 12 % anual en 12 meses = 1 066.19
  assert.equal(S.minimumPayment(12000, 12, 12), 1066.19);
  assert.equal(S.minimumPayment(1000, 0, 4), 250);
});

test('deuda sin interés: meses y total pagado exactos', () => {
  const r = S.debtPayoff({ principal: 1000, annualRate: 0, payment: 250 });
  assert.equal(r.payable, true);
  assert.equal(r.months, 4);
  assert.equal(r.totalInterest, 0);
  assert.equal(r.totalPaid, 1000);
});

test('deuda con interés: el pago extra reduce meses e intereses', () => {
  const c = S.compareDebtStrategies({ principal: 10000, annualRate: 24, termMonths: 12, extra: 500 });
  assert.equal(c.withoutExtra.months, 12);
  assert.ok(c.withExtra.months < c.withoutExtra.months);
  assert.ok(c.monthsSaved > 0);
  assert.ok(c.interestSaved > 0);
  assert.ok(c.withExtra.totalInterest < c.withoutExtra.totalInterest);
});

test('un pago que no cubre los intereses se marca como no liquidable', () => {
  const r = S.debtPayoff({ principal: 10000, annualRate: 24, payment: 100 });
  assert.equal(r.payable, false);
  assert.match(r.reason, /intereses/);
});

test('inversión: 1000 al mes al 12 % anual durante un año', () => {
  const r = S.investmentGrowth({ monthlyContribution: 1000, annualRate: 12, years: 1 });
  assert.ok(Math.abs(r.finalBalance - 12682.5) < 0.01, 'saldo ' + r.finalBalance);
  assert.equal(r.contributed, 12000);
  assert.ok(Math.abs(r.interest - 682.5) < 0.01);
  assert.equal(r.series[0].month, 12);
});

test('inflación reduce el valor real del saldo', () => {
  const r = S.investmentGrowth({ initial: 10000, annualRate: 10, years: 5, inflation: 4 });
  assert.ok(r.realBalance < r.finalBalance);
});

test('aporte necesario para una meta es el inverso del crecimiento', () => {
  const r = S.requiredContribution({ target: 12682.5, annualRate: 12, years: 1 });
  assert.ok(Math.abs(r.monthly - 1000) < 0.01, 'aporte ' + r.monthly);
  const done = S.requiredContribution({ target: 1000, initial: 5000, annualRate: 5, years: 1 });
  assert.equal(done.reached, true);
  assert.equal(done.monthly, 0);
});

test('meses para una meta con aporte fijo', () => {
  const sinInteres = S.monthsToGoal({ target: 1000, monthly: 300 });
  assert.equal(sinInteres.months, 4);
  const conInteres = S.monthsToGoal({ target: 12682.5, monthly: 1000, annualRate: 12 });
  assert.equal(conInteres.months, 12);
  assert.equal(S.monthsToGoal({ target: 1000, monthly: 0 }).reachable, false);
});

test('MSI contra contado: sin tasa de oportunidad, pagar a meses no conviene con descuento', () => {
  const sinTasa = S.msiVsCash({ total: 6000, months: 6, opportunityRate: 0 });
  assert.equal(sinTasa.installmentsPresentValue, 6000);
  assert.equal(sinTasa.msiCheaper, false);
  const conTasa = S.msiVsCash({ total: 6000, months: 6, opportunityRate: 12 });
  assert.equal(conTasa.msiCheaper, true, 'si el dinero rinde, pagar a meses sale mejor');
  const conDescuento = S.msiVsCash({ total: 6000, months: 6, opportunityRate: 12, cashDiscount: 10 });
  assert.equal(conDescuento.msiCheaper, false, 'un descuento de contado de 10 % cambia la decisión');
});

test('entradas inválidas se rechazan en lugar de devolver NaN', () => {
  assert.throws(() => S.investmentGrowth({ monthlyContribution: 'abc' }), RangeError);
  assert.throws(() => S.debtPayoff({ principal: 1000, annualRate: 0, payment: 0 }), RangeError);
});
