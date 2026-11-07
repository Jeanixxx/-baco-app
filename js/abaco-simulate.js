/* Ábaco · simulador financiero (Fase 4.3).
 *
 * Funciones puras para proyectar decisiones: suscripciones, deudas, inversiones,
 * metas de ahorro y compras a meses. No modifican ningún dato ni guardan nada.
 * Los cálculos usan pesos con decimales; los resultados se redondean a centavos
 * solo al mostrarse.
 *
 * Browser: window.AbacoSimulate. Node: module.exports.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AbacoSimulate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const cents = (x) => Math.round((Number(x) || 0) * 100) / 100;
  const num = (x) => {
    const n = Number(x);
    if (!Number.isFinite(n)) throw new RangeError('Valor numérico inválido');
    return n;
  };
  const monthlyRate = (annualRate) => num(annualRate) / 100 / 12;

  /* Veces que se cobra al mes cada frecuencia. */
  const PER_MONTH = { mensual: 1, quincenal: 2, semanal: 52 / 12, anual: 1 / 12 };

  /* ---------- suscripciones ---------- */

  /* subs: [{ name, amount, frequency }]. Devuelve costo mensual, anual y acumulado por mes. */
  function subscriptions(subs = [], { months = 12 } = {}) {
    const rows = subs.map((s) => {
      const per = PER_MONTH[s.frequency] || PER_MONTH.mensual;
      const monthly = num(s.amount) * per;
      return { name: s.name || 'Suscripción', amount: cents(s.amount), frequency: s.frequency || 'mensual', monthly: cents(monthly), yearly: cents(monthly * 12) };
    });
    const monthlyTotal = rows.reduce((s, r) => s + r.monthly, 0);
    const cumulative = [];
    let acc = 0;
    for (let m = 1; m <= months; m++) { acc += monthlyTotal; cumulative.push(cents(acc)); }
    return {
      rows: rows.sort((a, b) => b.monthly - a.monthly),
      monthlyTotal: cents(monthlyTotal),
      yearlyTotal: cents(monthlyTotal * 12),
      cumulative
    };
  }

  /* Cuánto dejas de pagar si cancelas una suscripción durante los meses indicados. */
  function cancelSaving(subs, name, { months = 12 } = {}) {
    const target = subs.find((s) => s.name === name);
    if (!target) return { saved: 0, months };
    const per = PER_MONTH[target.frequency] || PER_MONTH.mensual;
    return { saved: cents(num(target.amount) * per * months), months };
  }

  /* ---------- deudas ---------- */

  /* Cuota mensual para liquidar en n meses (interés francés). */
  function minimumPayment(principal, annualRate, months) {
    const P = num(principal), r = monthlyRate(annualRate), n = Math.max(1, Math.floor(num(months)));
    if (!r) return cents(P / n);
    return cents((P * r) / (1 - Math.pow(1 + r, -n)));
  }

  /* Calendario de pagos. extra = pago adicional fijo cada mes. Devuelve resumen y primeras filas. */
  function debtPayoff({ principal, annualRate = 0, payment, extra = 0, maxMonths = 600 } = {}) {
    let balance = num(principal);
    const r = monthlyRate(annualRate);
    const pay = num(payment) + num(extra);
    if (pay <= 0) throw new RangeError('El pago mensual debe ser mayor a cero');
    if (balance * r >= pay) return { payable: false, reason: 'El pago no cubre los intereses del mes', months: null, totalInterest: null, totalPaid: null, schedule: [] };
    let interestTotal = 0, paidTotal = 0, month = 0;
    const schedule = [];
    while (balance > 0.005 && month < maxMonths) {
      month++;
      const interest = balance * r;
      const due = balance + interest;
      const paidNow = Math.min(pay, due);
      balance = Math.max(0, due - paidNow);
      interestTotal += interest;
      paidTotal += paidNow;
      if (month <= 24 || balance <= 0.005) schedule.push({ month, payment: cents(paidNow), interest: cents(interest), balance: cents(balance) });
    }
    return { payable: true, months: month, totalInterest: cents(interestTotal), totalPaid: cents(paidTotal), schedule };
  }

  /* Compara pagar solo el mínimo contra pagar el mínimo más un extra mensual. */
  function compareDebtStrategies({ principal, annualRate, termMonths, extra = 0 }) {
    const minPay = minimumPayment(principal, annualRate, termMonths);
    const base = debtPayoff({ principal, annualRate, payment: minPay });
    const faster = debtPayoff({ principal, annualRate, payment: minPay, extra });
    return {
      minimumPayment: minPay,
      withoutExtra: { months: base.months, totalInterest: base.totalInterest, totalPaid: base.totalPaid },
      withExtra: { months: faster.months, totalInterest: faster.totalInterest, totalPaid: faster.totalPaid },
      monthsSaved: base.months - faster.months,
      interestSaved: cents(base.totalInterest - faster.totalInterest)
    };
  }

  /* ---------- inversiones y metas ---------- */

  /* Crecimiento con aportes mensuales (los aportes se hacen al final de cada mes). */
  function investmentGrowth({ initial = 0, monthlyContribution = 0, annualRate = 0, years = 1, inflation = 0 } = {}) {
    const r = monthlyRate(annualRate);
    const months = Math.max(0, Math.round(num(years) * 12));
    let balance = num(initial);
    const aportes = num(monthlyContribution);
    const series = [];
    for (let m = 1; m <= months; m++) {
      balance = balance * (1 + r) + aportes;
      if (m % 12 === 0 || m === months) series.push({ month: m, balance: cents(balance) });
    }
    const contributed = num(initial) + aportes * months;
    const interest = balance - contributed;
    const realFactor = Math.pow(1 + num(inflation) / 100, num(years));
    return {
      finalBalance: cents(balance),
      contributed: cents(contributed),
      interest: cents(interest),
      realBalance: cents(balance / realFactor),
      series
    };
  }

  /* Aporte mensual necesario para llegar a una meta en un plazo (en años). */
  function requiredContribution({ target, initial = 0, annualRate = 0, years }) {
    const T = num(target), P = num(initial), r = monthlyRate(annualRate), n = Math.max(1, Math.round(num(years) * 12));
    const growth = Math.pow(1 + r, n);
    const fvInitial = P * growth;
    if (fvInitial >= T) return { monthly: 0, months: n, reached: true };
    const monthly = r ? ((T - fvInitial) * r) / (growth - 1) : (T - fvInitial) / n;
    return { monthly: cents(monthly), months: n, reached: false };
  }

  /* Meses necesarios para una meta con un aporte fijo. */
  function monthsToGoal({ target, initial = 0, monthly, annualRate = 0 }) {
    const T = num(target), P = num(initial), A = num(monthly), r = monthlyRate(annualRate);
    if (P >= T) return { months: 0, reachable: true };
    if (A <= 0) return { months: null, reachable: false };
    if (!r) return { months: Math.ceil((T - P) / A), reachable: true };
    // Fórmula cerrada: T = P(1+r)^n + A((1+r)^n - 1)/r
    const k = (T * r + A) / (P * r + A);
    if (k <= 0) return { months: null, reachable: false };
    const n = Math.log(k) / Math.log(1 + r);
    return { months: Math.ceil(n - 1e-9), reachable: true };
  }

  /* ---------- MSI contra contado ---------- */

  /* Valor presente de las mensualidades a una tasa de oportunidad (anual). */
  function msiVsCash({ total, months, opportunityRate = 0, cashDiscount = 0 } = {}) {
    const T = num(total), n = Math.max(2, Math.floor(num(months))), r = monthlyRate(opportunityRate);
    const monthlyPay = T / n;
    let pv = 0;
    for (let m = 1; m <= n; m++) pv += monthlyPay / Math.pow(1 + r, m);
    const cash = T * (1 - num(cashDiscount) / 100);
    return {
      installmentsNominal: cents(T),
      installmentsPresentValue: cents(pv),
      cash: cents(cash),
      msiCheaper: pv < cash,
      difference: cents(cash - pv)
    };
  }

  return {
    subscriptions, cancelSaving, minimumPayment, debtPayoff, compareDebtStrategies,
    investmentGrowth, requiredContribution, monthsToGoal, msiVsCash, PER_MONTH
  };
});
