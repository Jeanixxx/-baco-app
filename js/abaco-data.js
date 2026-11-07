/* Ábaco · capa de datos para la interfaz (Fase 4.1).
 *
 * Une el núcleo (ledger), el almacenamiento (AbacoStore) y la interfaz:
 *  - view(): deriva la forma que la interfaz espera (importes en pesos, listas
 *    por tipo). La interfaz no calcula saldos: los lee de aquí.
 *  - Operaciones (addExpense, transfer, lend...): ejecutan el núcleo, guardan en
 *    una sola transacción y devuelven el resultado o un error con mensaje en español.
 *  - Las operaciones se encolan: dos guardados nunca se solapan.
 *
 * Sin DOM. Browser: window.AbacoData (createDataService). Node: module.exports.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AbacoData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MESSAGES = {
    INVALID_AMOUNT: 'Monto inválido',
    INVALID_NAME: 'Escribe un nombre',
    INVALID_TYPE: 'Tipo de cuenta no válido',
    INVALID_DATE: 'Fecha inválida',
    INSUFFICIENT_FUNDS: 'Saldo disponible insuficiente',
    SAME_ACCOUNT: 'Elige dos cuentas distintas',
    NOT_LIQUID: 'Elige una cuenta de dinero disponible',
    NO_LIQUID_ACCOUNT: 'Agrega una cuenta primero',
    NOT_FOUND: 'No se encontró el registro',
    ALREADY_SETTLED: 'Este cobro ya está registrado',
    ALREADY_PAID: 'Ya está pagado',
    ALREADY_REVERSED: 'Este movimiento ya fue revertido',
    NOT_PAID: 'Esa cuota no está pagada',
    CARD_HAS_DEBT: 'No puedes borrar una tarjeta con deuda pendiente',
    ACCOUNT_NOT_EMPTY: 'La cuenta todavía tiene saldo',
    NOT_HOLDING: 'Solo se puede dar rendimiento a inversiones y ahorros'
  };

  const pesos = (cents) => Math.round(Number(cents) || 0) / 100;

  function userMessage(err) {
    if (err && err.code && MESSAGES[err.code]) return MESSAGES[err.code];
    return (err && err.message) || 'No se pudo completar la operación';
  }

  function createDataService({ ledger, app = {}, store }) {
    let queue = Promise.resolve();

    /* Ejecuta una operación del núcleo y guarda. Si el núcleo falla, no se guarda nada. */
    function run(fn) {
      const job = queue.then(async () => {
        try {
          const result = fn(ledger);
          await store.commit(ledger, app);
          return { ok: true, result };
        } catch (err) {
          // Un fallo del núcleo no llega a guardar; un fallo de guardado se reporta tal cual.
          if (err && err.name === 'StorageError') return { ok: false, error: 'No se pudo guardar: ' + err.message, code: err.code };
          return { ok: false, error: userMessage(err), code: err && err.code };
        }
      });
      queue = job.catch(() => {});
      return job;
    }

    /* Guarda datos no financieros (nombre, tema, recordatorios...) con la misma garantía. */
    function setApp(patch) {
      return run(() => { Object.assign(app, patch); return null; });
    }

    /* ---------- vista para la interfaz (en pesos) ---------- */

    function view() {
      const accounts = ledger.listAccounts({ includeInternal: true }).map((a) => ({
        id: a.id, name: a.name, type: a.type, kind: a.kind, internal: !!a.internal, archived: !!a.archived,
        balance: pesos(ledger.balance(a.id)) * (a.kind === 'credit' ? -1 : 1)
      }));
      const cards = [...ledger.cards.values()].map((c) => ({
        id: c.id, name: c.name, type: 'crédito', limit: pesos(c.limitC), wallet_id: c.accountId,
        balance: Math.max(0, pesos(ledger.cardDebt(c.id)))
      }));
      const msiPlans = [...ledger.msiPlans.values()].map((p) => ({
        id: p.id, cardId: p.cardId, concept: p.concept, total: pesos(p.totalC), months: p.months,
        installments: p.installments.map((i) => ({ number: i.number, amount: pesos(i.amount), due: i.due, paid: !!i.paid })),
        purchase_date: p.installments.length ? p.installments[0].due : null
      }));
      const loans = [...ledger.loans.values()].map((l) => {
        const current = -ledger.balance(l.id);
        return {
          id: l.id, name: l.name, type: l.type, principal: pesos(l.principalC), current: pesos(current),
          annualRate: l.annualRate, term: l.term, payment: pesos(l.paymentC), paid: l.paid
        };
      });
      const debtors = [...ledger.debtors.values()].map((d) => ({
        id: d.id, person: d.person, concept: d.concept, amount: pesos(d.amountC),
        remaining: d.settled ? 0 : pesos(ledger.balance(d.id)), settled: !!d.settled, date: d.date || ''
      }));
      const savings = [...ledger.goals.values()].map((g) => ({
        id: g.id, name: g.name, type: g.type, target: pesos(g.targetC),
        amount: pesos(ledger.balance(g.id)), current: pesos(ledger.balance(g.id))
      }));
      const investments = [...ledger.investments.values()].map((i) => ({
        id: i.id, name: i.name, rate: i.rate, date: i.date, note: i.note,
        amount: pesos(ledger.balance(i.id)), current: pesos(ledger.balance(i.id))
      }));
      const budgets = [...ledger.budgets.values()].map((b) => ({ id: b.id, category: b.category, concept: b.category, amount: pesos(b.amountC) }));

      const live = ledger.entries.filter((e) => !e.reversed);
      const expenses = live.filter((e) => e.type === 'gasto').map((e) => ({
        id: e.id, description: e.description, amount: pesos(amountOf(e, 'ext:expense')),
        category: (e.meta && e.meta.category) || 'general', accountId: accountOf(e), created_at: e.at
      }));
      const incomes = live.filter((e) => e.type === 'ingreso').map((e) => ({
        id: e.id, description: e.description, amount: pesos(amountOf(e, 'ext:income')),
        type: (e.meta && e.meta.incomeType) || 'otro', accountId: accountOf(e), created_at: e.at
      }));
      const transfers = live.filter((e) => e.type === 'transferencia').map((e) => ({ id: e.id, amount: pesos(positive(e)), created_at: e.at }));
      const historial = live.map((e) => ({
        id: e.id, type: e.type, description: e.description, amount: pesos(positive(e)),
        direction: e.type === 'ingreso' ? 'in' : (e.type === 'transferencia' ? 'transfer' : 'out'),
        accountId: accountOf(e), created_at: e.at, refId: e.id
      }));

      return {
        user_id: app.user_id || null, user_name: app.user_name || '',
        accounts, cards, msiPlans, loans, debtors, savings, investments, budgets,
        expenses, incomes, transfers, historial,
        totals: {
          available: pesos(ledger.liquidAccounts().reduce((s, a) => s + ledger.balance(a.id), 0)),
          assets: pesos(ledger.totalAssets()),
          debt: pesos(ledger.totalDebt()),
          netWorth: pesos(ledger.netWorth())
        },
        verify: ledger.verify().ok,
        app
      };
    }

    function amountOf(entry, account) {
      const p = entry.postings.find((x) => x.account === account);
      return p ? Math.abs(p.amount) : 0;
    }
    function accountOf(entry) {
      const p = entry.postings.find((x) => x.account.indexOf('ext:') !== 0);
      return p ? p.account : null;
    }
    function positive(entry) {
      return Math.max(0, ...entry.postings.map((p) => Math.abs(p.amount)));
    }

    /* ---------- operaciones (cada una guarda) ---------- */

    const ops = {
      addAccount: (input) => run((l) => l.createAccount(input)),
      adjustAccount: (id, balance) => run((l) => l.adjustBalance(id, balance)),
      archiveAccount: (id) => run((l) => l.archiveAccount(id)),
      expense: (input) => run((l) => l.expense(input)),
      income: (input) => run((l) => l.income(input)),
      transfer: (input) => run((l) => l.transfer(input)),
      lend: (input) => run((l) => l.lend(input)),
      collect: (input) => run((l) => l.collect(input)),
      createGoal: (input) => run((l) => l.createGoal(input)),
      contributeGoal: (input) => run((l) => l.contributeGoal(input)),
      invest: (input) => run((l) => l.invest(input)),
      accrue: (input) => run((l) => l.accrue(input)),
      loan: (input) => run((l) => l.loan(input)),
      loanPayment: (input) => run((l) => l.loanPayment(input)),
      createCard: (input) => run((l) => l.createCard(input)),
      msiPurchase: (input) => run((l) => l.msiPurchase(input)),
      msiPay: (input) => run((l) => l.msiPayInstallment(input)),
      msiRevert: (input) => run((l) => l.msiRevertInstallment(input)),
      deleteCard: (id) => run((l) => l.deleteCard(id)),
      reverse: (id) => run((l) => l.reverse(id)),
      setBudget: (input) => run((l) => l.setBudget(input))
    };

    return { view, setApp, ...ops };
  }

  return { createDataService, userMessage, MESSAGES };
});
