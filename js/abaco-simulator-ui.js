/* Ábaco · pestaña Simulador (Fase 4.3). Solo lee datos y muestra resultados; no guarda nada.
 * Los cálculos viven en js/abaco-simulate.js. Se carga después de app.js.
 */
(function () {
  'use strict';

  const SIM = window.AbacoSimulate;
  let mode = 'suscripciones';

  const $ = (id) => document.getElementById(id);
  const num = (id) => {
    const el = $(id);
    const v = el ? Number(el.value) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  const fmt = (x) => money(Number(x) || 0);
  const esc2 = (x) => esc(String(x == null ? '' : x));
  const row = (label, value, cls = '') => `<div class="item"><div class="item-body"><div class="item-title">${esc2(label)}</div></div><div class="item-amount ${cls}">${value}</div></div>`;
  const note = (text) => `<div class="note">${esc2(text)}</div>`;

  /* ---------- resultados por modo ---------- */

  function resultSubscriptions() {
    const subs = (state.subscriptions || []).filter((s) => s.active !== false)
      .map((s) => ({ name: s.name, amount: s.amount, frequency: s.range || 'mensual' }));
    if (!subs.length) return note('Aún no tienes suscripciones. Agrégalas en Suscripciones para verlas aquí.');
    const r = SIM.subscriptions(subs, { months: 12 });
    const rows = r.rows.map((s) => row(`${s.name} · ${s.frequency}`, `${fmt(s.monthly)}/mes`)).join('');
    return `<div class="stat-row"><div class="stat"><div class="n">${fmt(r.monthlyTotal)}</div><div class="l">Al mes</div></div>` +
      `<div class="stat"><div class="n">${fmt(r.yearlyTotal)}</div><div class="l">Al año</div></div></div>` +
      `<div class="note">Mayor costo primero. Cancelar la más cara durante un año te ahorra ${fmt(SIM.cancelSaving(subs, r.rows[0].name, { months: 12 }).saved)}.</div>` +
      rows;
  }

  function resultDebt() {
    const principal = num('simDebt'), rate = num('simDebtRate'), months = num('simDebtMonths'), extra = num('simDebtExtra') || 0;
    if (!principal || principal <= 0 || !months || months <= 0) return note('Escribe el saldo y los meses restantes para simular.');
    let c;
    try {
      c = SIM.compareDebtStrategies({ principal, annualRate: rate || 0, termMonths: months, extra });
    } catch (e) { return note('Revisa los datos de la deuda.'); }
    const base = c.withoutExtra;
    let html = `<div class="stat-row"><div class="stat"><div class="n">${fmt(c.minimumPayment)}</div><div class="l">Pago mínimo al mes</div></div>` +
      `<div class="stat"><div class="n">${base.months} meses</div><div class="l">Sin extra</div></div></div>` +
      row('Intereses sin pago extra', fmt(base.totalInterest), 'neg');
    if (extra > 0) {
      if (!c.withExtra.months) return html + note('Con ese pago extra no se liquida la deuda.');
      html += row(`Con ${fmt(extra)} extra al mes`, `${c.withExtra.months} meses`, 'pos') +
        row('Intereses con pago extra', fmt(c.withExtra.totalInterest), 'neg') +
        `<div class="note">Ahorras ${c.monthsSaved} meses y ${fmt(c.interestSaved)} en intereses.</div>`;
    }
    return html;
  }

  function resultInvestment() {
    const initial = num('simInitial') || 0, monthly = num('simMonthly') || 0, rate = num('simRate') || 0;
    const years = num('simYears'), inflation = num('simInflation') || 0;
    if (!years || years <= 0) return note('Escribe el plazo en años para simular.');
    let r;
    try { r = SIM.investmentGrowth({ initial, monthlyContribution: monthly, annualRate: rate, years, inflation }); }
    catch (e) { return note('Revisa los datos de la inversión.'); }
    const byYear = r.series.filter((p) => p.month % 12 === 0).map((p) => row(`Año ${p.month / 12}`, fmt(p.balance)));
    let html = `<div class="stat-row"><div class="stat"><div class="n">${fmt(r.finalBalance)}</div><div class="l">Saldo final</div></div>` +
      `<div class="stat"><div class="n">${fmt(r.interest)}</div><div class="l">Rendimiento</div></div></div>` +
      row('Aportado', fmt(r.contributed));
    if (inflation > 0) html += `<div class="note">Con ${inflation}% de inflación, ${fmt(r.finalBalance)} equivalen hoy a ${fmt(r.realBalance)}.</div>`;
    return html + byYear.join('');
  }

  function resultGoal() {
    const target = num('simTarget'), initial = num('simMetaInitial') || 0, years = num('simMetaYears'), rate = num('simMetaRate') || 0;
    if (!target || target <= 0 || !years || years <= 0) return note('Escribe la meta y el plazo en años.');
    let r;
    try { r = SIM.requiredContribution({ target, initial, annualRate: rate, years }); }
    catch (e) { return note('Revisa los datos de la meta.'); }
    if (r.reached) return note('Con lo que ya tienes, la meta se alcanza sin aportar más.');
    return `<div class="stat-row"><div class="stat"><div class="n">${fmt(r.monthly)}</div><div class="l">Aporte al mes</div></div>` +
      `<div class="stat"><div class="n">${r.months} meses</div><div class="l">Plazo</div></div></div>` +
      note(`Para llegar a ${fmt(target)} en ${years} años, aparta ${fmt(r.monthly)} al mes con un rendimiento de ${rate}% anual.`);
  }

  function resultMsi() {
    const total = num('simMsiTotal'), months = num('simMsiMonths'), rate = num('simMsiRate') || 0, discount = num('simMsiDiscount') || 0;
    if (!total || total <= 0 || !months || months < 2) return note('Escribe el precio y al menos 2 meses.');
    let r;
    try { r = SIM.msiVsCash({ total, months, opportunityRate: rate, cashDiscount: discount }); }
    catch (e) { return note('Revisa los datos de la compra.'); }
    const verdict = r.msiCheaper
      ? `Conviene pagar a meses: ahorras ${fmt(r.difference)} en valor presente.`
      : `Conviene pagar de contado: pagar a meses cuesta ${fmt(-r.difference)} más en valor presente.`;
    return `<div class="stat-row"><div class="stat"><div class="n">${fmt(r.cash)}</div><div class="l">De contado</div></div>` +
      `<div class="stat"><div class="n">${fmt(r.installmentsPresentValue)}</div><div class="l">A meses (valor presente)</div></div></div>` +
      row('Total nominal a meses', fmt(r.installmentsNominal)) +
      `<div class="note">${esc2(verdict)}</div>`;
  }

  const RESULTS = { suscripciones: resultSubscriptions, deudas: resultDebt, inversiones: resultInvestment, meta: resultGoal, msi: resultMsi };

  /* ---------- interfaz ---------- */

  function showMode() {
    document.querySelectorAll('#simModes [data-sim]').forEach((chip) => {
      const on = chip.dataset.sim === mode;
      chip.classList.toggle('active', on);
      chip.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('[data-sim-form]').forEach((box) => { box.hidden = box.dataset.simForm !== mode; });
  }

  function fillLoanOptions() {
    const sel = $('simLoan');
    if (!sel) return;
    const keep = sel.value;
    const loans = (state.loans || []).filter((l) => Number(l.current) > 0);
    sel.innerHTML = '<option value="">Escribir los datos</option>' +
      loans.map((l) => `<option value="${esc2(l.id)}">${esc2(l.name)} · ${fmt(l.current)}</option>`).join('');
    if (keep && loans.some((l) => l.id === keep)) sel.value = keep;
  }

  function applyLoan(id) {
    const l = (state.loans || []).find((x) => x.id === id);
    if (!l) return;
    $('simDebt').value = Number(l.current).toFixed(2);
    $('simDebtRate').value = l.annualRate || 0;
    $('simDebtMonths').value = Math.max(1, (Number(l.term) || 0) - (Number(l.paid) || 0));
    $('simDebtExtra').value = '';
  }

  function recalc() {
    const box = $('simResult');
    if (!box) return;
    box.innerHTML = RESULTS[mode] ? RESULTS[mode]() : '';
  }

  /* Llamada desde el registro de pestañas al abrir el Simulador. */
  window.renderSimulator = function renderSimulator() {
    showMode();
    fillLoanOptions();
    recalc();
  };

  function bind() {
    const modes = $('simModes');
    if (!modes) return;
    modes.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-sim]');
      if (!chip) return;
      mode = chip.dataset.sim;
      showMode();
      recalc();
    });
    const panel = $('panel-simulador');
    if (panel) {
      panel.addEventListener('input', recalc);
      panel.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'simLoan') applyLoan(e.target.value);
        recalc();
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
