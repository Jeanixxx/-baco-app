/* Ábaco · migración del formato antiguo (localStorage de la app v2) al ledger v3.
 *
 * Función pura: no lee ni escribe almacenamiento. Recibe los valores ya parseados
 * de las claves antiguas y devuelve:
 *  - ledger: el núcleo nuevo, con saldos actuales como apertura y cuotas/préstamos/cobros vigentes.
 *  - app: datos no financieros (nombre, tema, recordatorios, listas...).
 *  - legacyHistory: copia de los gastos, ingresos y transferencias antiguos (referencia).
 *  - report: contadores y advertencias de lo que no se pudo migrar tal cual.
 *
 * El historial antiguo se reproduce en el ledger con su fecha original. El saldo
 * inicial de cada cuenta se calcula para que el resultado final coincida con el saldo actual.
 */
(function (root, factory) {
  const core = typeof module === 'object' && module.exports ? require('./abaco-core.js') : root.AbacoCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AbacoMigrate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  const APP_KEYS = [
    'user_id', 'user_name', 'user_pronoun', 'theme', 'pinned', 'reminders', 'kanban', 'checklist',
    'shop', 'shopMode', 'cart', 'reactions', 'categories', 'subscriptions', 'money_chart_prefs',
    'wallet_quiz', 'account_view', 'budget_period', 'active_panel', 'last_backup_at', 'swipe_hint_closed'
  ];
  const HISTORY_KEYS = ['expenses', 'incomes', 'historial', 'transfers'];

  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const toCents = (v) => Math.round((Number(v) || 0) * 100);
  const toIsoDay = (ms) => {
    const d = new Date(Number(ms));
    if (Number.isNaN(d.getTime())) return undefined;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  function migrateLegacy(legacy = {}, { Ledger = core.Ledger, now = () => Date.now() } = {}) {
    const ledger = new Ledger({ now });
    const report = { warnings: [], counts: { accounts: 0, cards: 0, msiPlans: 0, loans: 0, loansPaidOff: 0, debtors: 0, goals: 0, investments: 0, budgets: 0 } };
    const list = (key) => (Array.isArray(legacy[key]) ? legacy[key] : []);
    const warn = (msg) => report.warnings.push(msg);

    /* 1. Tarjetas y su cuenta de crédito. La cuenta vinculada no se duplica como cuenta normal. */
    const cards = list('cards').filter((c) => norm(c.type) === 'credito');
    const cardAccountIds = new Set();
    const cardDebtC = new Map();
    for (const card of cards) {
      const linked = list('accounts').filter((a) => norm(a.type) === 'credito' && (a.id === card.wallet_id || a.card_id === card.id));
      linked.forEach((a) => cardAccountIds.add(a.id));
      const legacyBalance = linked.length ? linked[0].balance : card.balance;
      cardDebtC.set(card.id, Math.max(0, toCents(legacyBalance)));
    }

    /* 2. Cuentas normales y su historial.
     * El saldo inicial de cada cuenta es su saldo actual menos el efecto de los movimientos
     * históricos. Así, al reproducir el historial con su fecha original, el saldo final es
     * exactamente el actual, y la lista de movimientos y las estadísticas del mes quedan completas. */
    const legacyAccounts = list('accounts').filter((a) => !cardAccountIds.has(a.id));
    const liquidTypes = new Set(['efectivo', 'debito', 'otro']);
    const firstLiquid = legacyAccounts.find((a) => liquidTypes.has(norm(a.type)));
    const fallbackId = firstLiquid ? firstLiquid.id : null;

    const history = [];
    for (const e of list('expenses')) history.push({ kind: 'gasto', acc: e.accountId || fallbackId, amountC: toCents(e.amount), at: e.created_at, description: e.description || 'Gasto', category: e.category || 'general', source: e.hormiga ? 'hormiga' : 'gasto' });
    for (const i of list('incomes')) history.push({ kind: 'ingreso', acc: i.accountId || fallbackId, amountC: toCents(i.amount), at: i.created_at, description: i.description || 'Ingreso', incomeType: i.type || 'otro' });
    for (const t of list('transfers')) history.push({ kind: 'transferencia', from: t.from, to: t.to, amountC: toCents(t.amount), at: t.created_at });

    const effect = new Map();
    const bump = (id, c) => { if (id) effect.set(id, (effect.get(id) || 0) + c); };
    for (const h of history) {
      if (h.kind === 'gasto') bump(h.acc, -h.amountC);
      else if (h.kind === 'ingreso') bump(h.acc, h.amountC);
      else { bump(h.from, -h.amountC); bump(h.to, h.amountC); }
    }

    const newIdByLegacy = new Map();
    const withoutHistory = new Set();
    for (const a of legacyAccounts) {
      const name = String(a.name || 'Cuenta').trim() || 'Cuenta';
      const isLiquid = liquidTypes.has(norm(a.type));
      let currentC = toCents(a.balance);
      if (!isLiquid && norm(a.type) !== 'credito' && currentC < 0) { warn(`Saldo negativo en «${name}»: se migró como 0. Revisa el saldo real.`); currentC = 0; }
      if (isLiquid && currentC < 0) { warn(`Saldo negativo en «${name}»: se migró como 0. Revisa el saldo real.`); currentC = 0; }
      let openingC = currentC - (effect.get(a.id) || 0);
      if (isLiquid && openingC < 0) {
        // El historial no cuadra con el saldo actual: se conserva el saldo y no se reproduce el historial de esta cuenta.
        warn(`El historial de «${name}» no cuadra con su saldo; se conserva el saldo y no se reproduce su historial`);
        openingC = currentC;
        withoutHistory.add(a.id);
      }
      try {
        const created = ledger.createAccount({ name, type: a.type || 'débito', balance: openingC / 100 });
        newIdByLegacy.set(a.id, created.id);
        report.counts.accounts++;
      } catch (e) {
        warn(`No se pudo migrar la cuenta «${name}»: ${e.message}`);
      }
    }

    /* Reproduce el historial en orden cronológico, con la fecha original. */
    let skipped = 0;
    const ordered = history.slice().sort((x, y) => (Number(x.at) || 0) - (Number(y.at) || 0));
    for (const h of ordered) {
      try {
        if (h.kind === 'transferencia') {
          const from = newIdByLegacy.get(h.from), to = newIdByLegacy.get(h.to);
          if (!from || !to || withoutHistory.has(h.from) || withoutHistory.has(h.to)) { skipped++; continue; }
          ledger.transfer({ fromId: from, toId: to, amount: h.amountC / 100, at: h.at });
        } else {
          const acc = newIdByLegacy.get(h.acc);
          if (!acc || withoutHistory.has(h.acc)) { skipped++; continue; }
          if (h.kind === 'gasto') ledger.expense({ amount: h.amountC / 100, description: h.description, category: h.category, accountId: acc, source: h.source, at: h.at });
          else ledger.income({ amount: h.amountC / 100, description: h.description, type: h.incomeType, accountId: acc, at: h.at });
        }
        report.counts.history = (report.counts.history || 0) + 1;
      } catch (e) {
        skipped++;
      }
    }
    if (skipped) warn(`${skipped} movimientos históricos no se pudieron reproducir; sus efectos ya están en el saldo actual`);
    // Las cuentas por defecto (Efectivo y Débito) son solo para instalaciones nuevas:
    // quien migra conserva exactamente sus cuentas.

    /* 3. Tarjetas: primero sus planes MSI (con las cuotas ya pagadas), luego el ajuste
     *    a la deuda que la app antigua tenía registrada. */
    for (const card of cards) {
      const created = ledger.createCard({ name: card.name || 'Tarjeta', limit: Number(card.limit) || 0 });
      report.counts.cards++;
      const plans = list('msiPlans').filter((p) => p.cardId === card.id);
      for (const p of plans) {
        const insts = Array.isArray(p.installments) ? p.installments : [];
        const months = insts.length || Number(p.months) || 0;
        if (months < 2) { warn(`Plan MSI «${p.concept || ''}» sin cuotas válidas: no se migró`); continue; }
        const paidNumbers = insts.map((i, idx) => (i && i.paid ? idx + 1 : 0)).filter(Boolean);
        try {
          ledger.msiPurchase({
            cardId: created.id,
            concept: p.concept || 'Compra MSI',
            total: Number(p.total) || 0,
            months,
            paidNumbers,
            purchaseDate: toIsoDay(p.purchase_date || p.created_at)
          });
          report.counts.msiPlans++;
        } catch (e) {
          warn(`No se pudo migrar el plan MSI «${p.concept || ''}»: ${e.message}`);
        }
      }
      const accountId = created.accountId;
      const target = cardDebtC.get(card.id) || 0;
      const current = -ledger.balance(accountId);
      if (target !== current) {
        // La deuda registrada por la app antigua manda; la diferencia (redondeos) queda explícita.
        ledger.adjustBalance(accountId, target / 100, 'Ajuste de migración: deuda de ' + created.name);
        if (Math.abs(target - current) > 1) warn(`Deuda de «${created.name}» ajustada en ${(Math.abs(target - current) / 100).toFixed(2)} para coincidir con la app anterior`);
      }
    }

    /* 4. Préstamos vigentes. La cuota antigua se conserva; el plazo restante es term - pagados. */
    for (const l of list('loans')) {
      const remainingC = toCents(l.current ?? l.principal);
      if (remainingC <= 0) { report.counts.loansPaidOff++; continue; }
      const termLeft = Math.max(1, (Number(l.term) || 1) - (Number(l.paid) || 0));
      try {
        ledger.loan({
          name: l.name || 'Préstamo',
          principal: remainingC / 100,
          annualRate: Number(l.annualRate) || 0,
          term: termLeft,
          type: l.type || 'personal',
          disburse: false,
          paymentCents: toCents(l.payment) || undefined
        });
        report.counts.loans++;
      } catch (e) {
        warn(`No se pudo migrar el préstamo «${l.name || ''}»: ${e.message}`);
      }
    }

    /* 5. Cuentas por cobrar pendientes. */
    for (const d of list('debtors')) {
      if (d.settled) continue;
      const remainingC = toCents(d.remaining ?? d.amount);
      if (remainingC <= 0) continue;
      ledger.importReceivable({ person: d.person, concept: d.concept, amount: remainingC / 100, date: d.date || '' });
      report.counts.debtors++;
    }

    /* 6. Ahorros e inversiones con su saldo actual. */
    for (const s of list('savings')) {
      ledger.importGoal({ name: s.name, type: s.type || 'open', targetAmount: Number(s.target) || 0, amount: (s.current ?? s.amount) || 0 });
      report.counts.goals++;
    }
    for (const i of list('investments')) {
      ledger.importInvestment({ name: i.name, amount: (i.current ?? i.amount) || 0, rate: i.rate || 0, date: i.date || '', note: i.note || '' });
      report.counts.investments++;
    }

    /* 7. Presupuestos. */
    for (const b of list('budgets')) {
      const category = b.category || b.concept;
      if (!category) continue;
      try {
        ledger.setBudget({ category, amount: Number(b.amount) || 0 });
        report.counts.budgets++;
      } catch (e) {
        warn(`Presupuesto «${category}» no migrado: ${e.message}`);
      }
    }

    /* 8. Datos no financieros y archivo de historial antiguo. */
    const app = {};
    for (const key of APP_KEYS) if (legacy[key] !== undefined) app[key] = legacy[key];
    const legacyHistory = {};
    for (const key of HISTORY_KEYS) legacyHistory[key] = list(key);

    report.verify = ledger.verify();
    if (!report.verify.ok) warn('El ledger migrado no cuadra; no debe guardarse. Revisa el informe.');
    return { ledger, app, legacyHistory, report };
  }

  return { migrateLegacy, APP_KEYS, HISTORY_KEYS };
});
