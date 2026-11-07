/* Ábaco · núcleo financiero (Fase 2).
 *
 * Ledger de partida doble: cada movimiento son líneas (postings) cuyos importes
 * suman cero. Los saldos se derivan del ledger; nadie escribe un saldo a mano.
 *
 * Convenciones:
 *  - Importes internos en centavos enteros (nunca flotantes).
 *  - Cada cuenta guarda su posición neta: activos positivos, deudas negativas.
 *  - Cuentas externas (ingresos, gastos, saldos iniciales, MSI pendientes) cierran
 *    la partida doble sin crear dinero.
 *  - Sin DOM ni almacenamiento. La persistencia vive en la capa de datos (Fase 3).
 *
 * Funciona en el navegador (window.AbacoCore) y en Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AbacoCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  class CoreError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'CoreError';
      this.code = code;
    }
  }

  const EXT = {
    INCOME: 'ext:income',
    EXPENSE: 'ext:expense',
    OPENING: 'ext:opening',
    ADJUST: 'ext:adjust',
    MSI: 'ext:msi'
  };
  const EXT_NAMES = {
    [EXT.INCOME]: 'Ingresos',
    [EXT.EXPENSE]: 'Gastos',
    [EXT.OPENING]: 'Saldos iniciales',
    [EXT.ADJUST]: 'Ajustes',
    [EXT.MSI]: 'Compras MSI pendientes'
  };

  const normType = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const KIND_BY_TYPE = { efectivo: 'liquid', debito: 'liquid', otro: 'liquid', credito: 'credit', ahorro: 'holding' };

  function defaultUid() {
    if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* Convierte un monto de pesos (número o texto) a centavos enteros. */
  function toCents(value, { allowZero = false } = {}) {
    const n = typeof value === 'string' ? Number(value.trim()) : Number(value);
    if (!Number.isFinite(n)) throw new CoreError('INVALID_AMOUNT', 'Monto inválido');
    const cents = Math.round(n * 100);
    if (cents < 0 || (!allowZero && cents === 0)) throw new CoreError('INVALID_AMOUNT', 'Monto inválido');
    return cents;
  }

  /* Cuota mensual de un préstamo con interés francés, en centavos. */
  function monthlyPaymentCents(principalC, annualRate, months) {
    const r = Number(annualRate) / 100 / 12;
    if (!r) return Math.round(principalC / months);
    return Math.round((principalC * r) / (1 - Math.pow(1 + r, -months)));
  }

  /* Reparte un total en n cuotas exactas en centavos; la última absorbe el redondeo. */
  function splitCents(totalC, n) {
    const base = Math.floor(totalC / n);
    return Array.from({ length: n }, (_, i) => (i === n - 1 ? totalC - base * (n - 1) : base));
  }

  class Ledger {
    constructor({ now = () => Date.now(), uid = defaultUid } = {}) {
      this.now = now;
      this.uid = uid;
      this.accounts = new Map();   // id -> { id, name, type, kind, internal, archived, createdAt }
      this.balances = new Map();   // id -> centavos (caché derivada del ledger)
      this.entries = [];           // movimientos; solo se añaden o se marcan como revertidos
      this.cards = new Map();      // id -> { id, name, limit, accountId }
      this.msiPlans = new Map();   // id -> { id, cardId, concept, totalC, installments[] }
      this.loans = new Map();      // id -> { id, name, type, principalC, annualRate, term, paymentC, paid }
      this.debtors = new Map();    // id -> { id, person, concept, amountC, settled, date }
      this.goals = new Map();      // id -> { id, name, type, targetC }
      this.investments = new Map();// id -> { id, name, rate, date, note }
      this.budgets = new Map();    // id -> { id, category, amountC }
      for (const [id, name] of Object.entries(EXT_NAMES)) {
        this.accounts.set(id, { id, name, type: 'externa', kind: 'external', internal: true, archived: false, createdAt: 0 });
        this.balances.set(id, 0);
      }
    }

    /* ---------- lectura ---------- */

    balance(accountId) {
      this._account(accountId);
      return this.balances.get(accountId) || 0;
    }

    /* Saldo en pesos (número con dos decimales) para la interfaz. */
    pesos(cents) { return cents / 100; }

    listAccounts({ includeInternal = false, includeArchived = false } = {}) {
      return [...this.accounts.values()]
        .filter((a) => a.kind !== 'external')
        .filter((a) => includeInternal || !a.internal)
        .filter((a) => includeArchived || !a.archived)
        .map((a) => ({ ...a, balanceC: this.balance(a.id) }));
    }

    liquidAccounts() {
      return this.listAccounts().filter((a) => a.kind === 'liquid');
    }

    /* Activos: cuentas líquidas, ahorros, inversiones y cuentas por cobrar. */
    totalAssets() {
      return this._sumKinds(['liquid', 'holding', 'goal', 'investment', 'receivable']);
    }

    /* Deudas: tarjetas de crédito y préstamos, en positivo. */
    totalDebt() {
      return -this._sumKinds(['credit', 'loan']);
    }

    netWorth() {
      return this.totalAssets() - this.totalDebt();
    }

    /* Gasto del periodo: suma de gastos y de intereses registrados en [from, to). */
    spentBetween(from, to) {
      // Todo lo que carga a la cuenta externa de gastos cuenta como gasto del periodo.
      const expenseTypes = new Set(['gasto', 'pago_prestamo', 'pago_msi']);
      return this.entries
        .filter((e) => !e.reversed && expenseTypes.has(e.type) && e.at >= from && e.at < to)
        .reduce((sum, e) => sum + e.postings.filter((p) => p.account === EXT.EXPENSE).reduce((s, p) => s + p.amount, 0), 0);
    }

    /* Verificación independiente: recalcula saldos desde el ledger y comprueba la partida doble. */
    verify() {
      const issues = [];
      const recomputed = new Map([...this.accounts.keys()].map((id) => [id, 0]));
      let grand = 0;
      for (const e of this.entries) {
        const sum = e.postings.reduce((s, p) => s + p.amount, 0);
        if (sum !== 0) issues.push({ type: 'unbalanced_entry', entryId: e.id });
        for (const p of e.postings) {
          if (!recomputed.has(p.account)) issues.push({ type: 'orphan_posting', entryId: e.id, account: p.account });
          else recomputed.set(p.account, recomputed.get(p.account) + p.amount);
          grand += p.amount;
        }
      }
      if (grand !== 0) issues.push({ type: 'grand_total_not_zero', amount: grand });
      for (const [id, c] of recomputed) {
        if ((this.balances.get(id) || 0) !== c) issues.push({ type: 'cache_mismatch', account: id });
        const acc = this.accounts.get(id);
        if (acc && acc.kind === 'liquid' && c < 0) issues.push({ type: 'negative_liquid', account: id, amountC: c });
      }
      return { ok: issues.length === 0, issues };
    }

    /* ---------- cuentas ---------- */

    createAccount({ name, type = 'débito', balance = 0, internal = false } = {}) {
      const label = String(name || '').trim();
      if (!label) throw new CoreError('INVALID_NAME', 'Escribe el nombre de la cuenta');
      const t = normType(type);
      const kind = KIND_BY_TYPE[t];
      if (!kind) throw new CoreError('INVALID_TYPE', 'Tipo de cuenta no válido');
      const opening = Number(balance) === 0 ? 0 : toCents(balance, { allowZero: true });
      const id = this.uid();
      this.accounts.set(id, { id, name: label, type: String(type), kind, internal, archived: false, createdAt: this.now() });
      this.balances.set(id, 0);
      if (opening > 0) {
        // Crédito: el saldo inicial es una deuda existente (negativa en la posición).
        const sign = kind === 'credit' ? -1 : 1;
        this.post('saldo_inicial', 'Saldo inicial: ' + label, [
          { account: id, amount: sign * opening },
          { account: EXT.OPENING, amount: -sign * opening }
        ]);
      }
      return this.accounts.get(id);
    }

    /* Crea las dos cuentas que la app ofrece al registrarse. */
    ensureDefaultAccounts() {
      const existing = new Set([...this.accounts.values()].map((a) => normType(a.name)));
      if (!existing.has('efectivo')) this.createAccount({ name: 'Efectivo', type: 'efectivo' });
      if (!existing.has('debito')) this.createAccount({ name: 'Débito', type: 'débito' });
      return this.listAccounts();
    }

    /* Ajuste explícito de saldo: deja rastro en el ledger en lugar de sobrescribir. */
    adjustBalance(accountId, newBalance, description = 'Ajuste de saldo') {
      const acc = this._account(accountId);
      const target = toCents(newBalance, { allowZero: true });
      const sign = acc.kind === 'credit' ? -1 : 1;
      const delta = sign * target - this.balance(accountId);
      if (delta === 0) return null;
      return this.post('ajuste', description, [
        { account: accountId, amount: delta },
        { account: EXT.ADJUST, amount: -delta }
      ]);
    }

    archiveAccount(accountId) {
      const acc = this._account(accountId);
      if (acc.kind === 'liquid' || acc.kind === 'holding') {
        if (this.balance(accountId) !== 0) throw new CoreError('ACCOUNT_NOT_EMPTY', 'La cuenta todavía tiene saldo');
      }
      acc.archived = true;
      return acc;
    }

    /* ---------- movimientos cotidianos ---------- */

    expense({ amount, description = 'Gasto', category = 'general', accountId } = {}) {
      const c = toCents(amount);
      const acc = this._liquidOrFirst(accountId);
      return this.post('gasto', description, [
        { account: acc.id, amount: -c },
        { account: EXT.EXPENSE, amount: c }
      ], { category });
    }

    income({ amount, description = 'Ingreso', type = 'otro', accountId } = {}) {
      const c = toCents(amount);
      const acc = this._liquidOrFirst(accountId);
      return this.post('ingreso', description, [
        { account: acc.id, amount: c },
        { account: EXT.INCOME, amount: -c }
      ], { incomeType: type });
    }

    transfer({ fromId, toId, amount } = {}) {
      const c = toCents(amount);
      const from = this._account(fromId);
      const to = this._account(toId);
      if (from.kind !== 'liquid' || to.kind !== 'liquid') throw new CoreError('NOT_LIQUID', 'Las transferencias usan cuentas líquidas');
      if (from.id === to.id) throw new CoreError('SAME_ACCOUNT', 'Elige dos cuentas distintas');
      return this.post('transferencia', `Transferencia: ${from.name} → ${to.name}`, [
        { account: from.id, amount: -c },
        { account: to.id, amount: c }
      ]);
    }

    /* ---------- cuentas por cobrar (prestar dinero) ---------- */

    lend({ person, concept = 'Préstamo', amount, date, accountId } = {}) {
      const c = toCents(amount);
      const name = String(person || '').trim();
      if (!name) throw new CoreError('INVALID_NAME', 'Escribe a quién le prestaste');
      const acc = this._liquidOrFirst(accountId);
      const id = this.uid();
      this._internal(id, 'Por cobrar: ' + name, 'receivable');
      const entry = this.post('prestamo_personal', `Le prestaste a ${name}: ${concept}`, [
        { account: acc.id, amount: -c },
        { account: id, amount: c }
      ], { debtorId: id });
      this.debtors.set(id, { id, person: name, concept, amountC: c, settled: false, date: date || '', entryId: entry.id });
      return this.debtors.get(id);
    }

    collect({ debtorId, accountId } = {}) {
      const d = this.debtors.get(debtorId);
      if (!d) throw new CoreError('NOT_FOUND', 'Registro no encontrado');
      if (d.settled) throw new CoreError('ALREADY_SETTLED', 'Este cobro ya está registrado');
      const acc = this._liquidOrFirst(accountId);
      const remaining = this.balance(debtorId);
      this.post('cobro', `Cobro a ${d.person}: ${d.concept}`, [
        { account: debtorId, amount: -remaining },
        { account: acc.id, amount: remaining }
      ], { debtorId });
      d.settled = true;
      return d;
    }

    /* ---------- ahorros (metas) ---------- */

    createGoal({ name, amount, type = 'open', target = 0, accountId } = {}) {
      const label = String(name || '').trim() || 'Ahorro';
      const c = toCents(amount);
      const acc = this._liquidOrFirst(accountId);
      const id = this.uid();
      this._internal(id, label, 'goal');
      this.goals.set(id, { id, name: label, type, targetC: toCents(target || 0, { allowZero: true }) });
      this.post('ahorro', `Ahorro: ${label}`, [
        { account: acc.id, amount: -c },
        { account: id, amount: c }
      ], { goalId: id });
      return this.goals.get(id);
    }

    contributeGoal({ goalId, amount, accountId } = {}) {
      const goal = this.goals.get(goalId);
      if (!goal) throw new CoreError('NOT_FOUND', 'Ahorro no encontrado');
      const c = toCents(amount);
      const acc = this._liquidOrFirst(accountId);
      return this.post('aporte_ahorro', `Aporte a ${goal.name}`, [
        { account: acc.id, amount: -c },
        { account: goalId, amount: c }
      ], { goalId });
    }

    /* ---------- inversiones ---------- */

    invest({ name, amount, rate = 0, date = '', note = '', accountId } = {}) {
      const label = String(name || '').trim() || 'Inversión';
      const c = toCents(amount);
      const acc = this._liquidOrFirst(accountId);
      const id = this.uid();
      this._internal(id, label, 'investment');
      this.investments.set(id, { id, name: label, rate: Number(rate) || 0, date, note });
      this.post('inversion', `Inversión: ${label}`, [
        { account: acc.id, amount: -c },
        { account: id, amount: c }
      ], { investmentId: id });
      return this.investments.get(id);
    }

    /* Rendimiento de una inversión o meta: ingreso por intereses. */
    accrue({ holdingId, amount, description = 'Rendimiento' } = {}) {
      const holding = this._account(holdingId);
      if (holding.kind !== 'investment' && holding.kind !== 'goal') throw new CoreError('NOT_HOLDING', 'Solo se puede dar rendimiento a inversiones y ahorros');
      const c = toCents(amount);
      return this.post('rendimiento', description, [
        { account: holdingId, amount: c },
        { account: EXT.INCOME, amount: -c }
      ]);
    }

    /* ---------- préstamos ---------- */

    loan({ name, principal, annualRate = 0, term, type = 'personal', disburse = false, accountId } = {}) {
      const label = String(name || '').trim() || 'Préstamo';
      const p = toCents(principal);
      const n = Math.max(1, Math.floor(Number(term) || 0));
      const rate = Number(annualRate) || 0;
      const id = this.uid();
      this._internal(id, label, 'loan');
      // Con disburse=false se registra una deuda ya existente (saldo inicial, como en la app actual).
      const counterpart = disburse ? this._liquidOrFirst(accountId).id : EXT.OPENING;
      this.loans.set(id, { id, name: label, type, principalC: p, annualRate: rate, term: n, paymentC: monthlyPaymentCents(p, rate, n), paid: 0 });
      this.post('prestamo', `Deuda: ${label}`, [
        { account: id, amount: -p },
        { account: counterpart, amount: p }
      ], { loanId: id, disburse: !!disburse });
      return this.loans.get(id);
    }

    loanPayment({ loanId, accountId } = {}) {
      const loan = this.loans.get(loanId);
      if (!loan) throw new CoreError('NOT_FOUND', 'Préstamo no encontrado');
      const remaining = -this.balance(loanId);
      if (remaining <= 0) throw new CoreError('ALREADY_PAID', 'Este préstamo ya está liquidado');
      const acc = this._liquidOrFirst(accountId);
      const interest = Math.round(remaining * (loan.annualRate / 100 / 12));
      const scheduled = loan.paymentC || monthlyPaymentCents(remaining, loan.annualRate, loan.term);
      const payment = Math.min(remaining + interest, scheduled);
      const interestPart = Math.min(interest, payment);
      const principalPart = payment - interestPart;
      const postings = [
        { account: acc.id, amount: -payment },
        { account: loanId, amount: principalPart }
      ];
      if (interestPart > 0) postings.push({ account: EXT.EXPENSE, amount: interestPart });
      const entry = this.post('pago_prestamo', 'Pago: ' + loan.name, postings, { loanId, interestC: interestPart, principalC: principalPart });
      loan.paid = Math.min(loan.term, loan.paid + 1);
      return { entry, interestC: interestPart, principalC: principalPart, remainingC: remaining - principalPart };
    }

    /* ---------- tarjetas y MSI ---------- */

    createCard({ name, limit = 0 } = {}) {
      const label = String(name || '').trim();
      if (!label) throw new CoreError('INVALID_NAME', 'Escribe el nombre de la tarjeta');
      const limitC = toCents(limit, { allowZero: true });
      const acc = this.createAccount({ name: label, type: 'crédito', internal: true });
      const id = this.uid();
      this.cards.set(id, { id, name: label, limitC, accountId: acc.id });
      return this.cards.get(id);
    }

    cardDebt(cardId) {
      const card = this._card(cardId);
      return -this.balance(card.accountId);
    }

    /* Compra a meses. Las cuotas ya pagadas antes (paidBefore) no generan movimientos. */
    msiPurchase({ cardId, concept = 'Compra MSI', total, months, paidBefore = 0, purchaseDate } = {}) {
      const card = this._card(cardId);
      const totalC = toCents(total);
      const n = Math.max(2, Math.floor(Number(months) || 0));
      const paid = Math.min(n, Math.max(0, Math.floor(Number(paidBefore) || 0)));
      const base = new Date((purchaseDate || this._today()) + 'T12:00:00');
      if (Number.isNaN(base.getTime())) throw new CoreError('INVALID_DATE', 'Fecha inválida');
      const amounts = splitCents(totalC, n);
      const installments = amounts.map((amount, i) => {
        const due = new Date(base);
        due.setMonth(due.getMonth() + i + 1);
        return { number: i + 1, amount, due: due.getTime(), paid: i < paid, entryId: null, paymentAccountId: null };
      });
      const unpaidC = installments.filter((i) => !i.paid).reduce((s, i) => s + i.amount, 0);
      const id = this.uid();
      if (unpaidC > 0) {
        this.post('msi', `MSI: ${concept}`, [
          { account: card.accountId, amount: -unpaidC },
          { account: EXT.MSI, amount: unpaidC }
        ], { msiId: id, cardId });
      }
      this.msiPlans.set(id, { id, cardId, concept, totalC, months: n, installments });
      return this.msiPlans.get(id);
    }

    /* Paga una cuota desde una cuenta líquida: baja la deuda y se reconoce como gasto. */
    msiPayInstallment({ planId, number, accountId } = {}) {
      const plan = this.msiPlans.get(planId);
      if (!plan) throw new CoreError('NOT_FOUND', 'Plan MSI no encontrado');
      const inst = plan.installments[number - 1];
      if (!inst) throw new CoreError('NOT_FOUND', 'Cuota no encontrada');
      if (inst.paid) throw new CoreError('ALREADY_PAID', 'Esta cuota ya está pagada');
      const card = this._card(plan.cardId);
      const acc = this._liquidOrFirst(accountId);
      const entry = this.post('pago_msi', `Pago MSI: ${plan.concept} · mes ${number}`, [
        { account: acc.id, amount: -inst.amount },
        { account: card.accountId, amount: inst.amount },
        { account: EXT.MSI, amount: -inst.amount },
        { account: EXT.EXPENSE, amount: inst.amount }
      ], { msiId: planId, number });
      inst.paid = true;
      inst.entryId = entry.id;
      inst.paymentAccountId = acc.id;
      return entry;
    }

    /* Revierte el pago de una cuota con un movimiento compensatorio (el ledger nunca se borra). */
    msiRevertInstallment({ planId, number } = {}) {
      const plan = this.msiPlans.get(planId);
      const inst = plan && plan.installments[number - 1];
      if (!inst || !inst.paid) throw new CoreError('NOT_PAID', 'Esa cuota no está pagada');
      this.reverse(inst.entryId, 'Reversa de pago MSI: ' + plan.concept + ' · mes ' + number);
      inst.paid = false;
      inst.entryId = null;
      inst.paymentAccountId = null;
      return inst;
    }

    deleteCard(cardId) {
      const card = this._card(cardId);
      if (this.cardDebt(cardId) !== 0) throw new CoreError('CARD_HAS_DEBT', 'No puedes borrar una tarjeta con deuda pendiente');
      for (const [pid, plan] of this.msiPlans) if (plan.cardId === cardId) this.msiPlans.delete(pid);
      this.accounts.get(card.accountId).archived = true;
      this.cards.delete(cardId);
      return true;
    }

    /* ---------- reversas y presupuestos ---------- */

    /* Deshace un movimiento agregando otro con importes opuestos. */
    reverse(entryId, description) {
      const original = this.entries.find((e) => e.id === entryId);
      if (!original) throw new CoreError('NOT_FOUND', 'Movimiento no encontrado');
      if (original.reversed) throw new CoreError('ALREADY_REVERSED', 'Este movimiento ya fue revertido');
      const entry = this.post('reversa', description || 'Reversa: ' + original.description,
        original.postings.map((p) => ({ account: p.account, amount: -p.amount })),
        { reverses: entryId });
      original.reversed = true;
      return entry;
    }

    setBudget({ category, amount } = {}) {
      const name = String(category || '').trim();
      if (!name) throw new CoreError('INVALID_NAME', 'Elige una categoría');
      const existing = [...this.budgets.values()].find((b) => b.category === name);
      const amountC = toCents(amount, { allowZero: true });
      const id = existing ? existing.id : this.uid();
      this.budgets.set(id, { id, category: name, amountC });
      return this.budgets.get(id);
    }

    budgetProgress(from, to) {
      return [...this.budgets.values()].map((b) => {
        const spentC = this.entries
          .filter((e) => !e.reversed && e.type === 'gasto' && e.at >= from && e.at < to && e.meta.category === b.category)
          .reduce((s, e) => s + e.postings.filter((p) => p.account === EXT.EXPENSE).reduce((x, p) => x + p.amount, 0), 0);
        return { ...b, spentC, remainingC: b.amountC - spentC };
      });
    }

    /* ---------- persistencia (la usa la capa de datos) ---------- */

    toJSON() {
      return {
        version: 3,
        accounts: [...this.accounts.values()],
        entries: this.entries,
        cards: [...this.cards.values()],
        msiPlans: [...this.msiPlans.values()],
        loans: [...this.loans.values()],
        debtors: [...this.debtors.values()],
        goals: [...this.goals.values()],
        investments: [...this.investments.values()],
        budgets: [...this.budgets.values()]
      };
    }

    static fromJSON(data, options = {}) {
      if (!data || data.version !== 3) throw new CoreError('UNSUPPORTED_VERSION', 'Versión de datos no compatible');
      const ledger = new Ledger(options);
      ledger.accounts = new Map(data.accounts.map((a) => [a.id, { ...a }]));
      ledger.balances = new Map([...ledger.accounts.keys()].map((id) => [id, 0]));
      ledger.entries = data.entries.map((e) => ({ ...e, postings: e.postings.map((p) => ({ ...p })) }));
      for (const e of ledger.entries) for (const p of e.postings) {
        ledger.balances.set(p.account, (ledger.balances.get(p.account) || 0) + p.amount);
      }
      ledger.cards = new Map(data.cards.map((x) => [x.id, { ...x }]));
      ledger.msiPlans = new Map(data.msiPlans.map((x) => [x.id, { ...x, installments: x.installments.map((i) => ({ ...i })) }]));
      ledger.loans = new Map(data.loans.map((x) => [x.id, { ...x }]));
      ledger.debtors = new Map(data.debtors.map((x) => [x.id, { ...x }]));
      ledger.goals = new Map(data.goals.map((x) => [x.id, { ...x }]));
      ledger.investments = new Map(data.investments.map((x) => [x.id, { ...x }]));
      ledger.budgets = new Map(data.budgets.map((x) => [x.id, { ...x }]));
      const check = ledger.verify();
      if (!check.ok) throw new CoreError('CORRUPT_DATA', 'Los datos no cuadran: ' + JSON.stringify(check.issues.slice(0, 3)));
      return ledger;
    }

    /* ---------- internos ---------- */

    post(type, description, postings, meta = {}) {
      if (postings.length < 2) throw new CoreError('INVALID_ENTRY', 'Un movimiento necesita al menos dos líneas');
      let sum = 0;
      const delta = new Map();
      for (const p of postings) {
        if (!Number.isInteger(p.amount) || p.amount === 0) throw new CoreError('INVALID_AMOUNT', 'Importe interno inválido');
        this._account(p.account);
        sum += p.amount;
        delta.set(p.account, (delta.get(p.account) || 0) + p.amount);
      }
      if (sum !== 0) throw new CoreError('UNBALANCED', 'El movimiento no cuadra');
      // Validación completa antes de tocar nada: un movimiento fallido no deja huella.
      for (const [id, d] of delta) {
        const acc = this.accounts.get(id);
        if (acc.kind === 'liquid' && (this.balances.get(id) || 0) + d < 0) {
          throw new CoreError('INSUFFICIENT_FUNDS', 'Saldo disponible insuficiente en ' + acc.name);
        }
      }
      const entry = {
        id: this.uid(),
        type,
        description,
        at: this.now(),
        postings: postings.map((p) => ({ account: p.account, amount: p.amount })),
        meta: { ...meta },
        reversed: false
      };
      this.entries.push(entry);
      for (const [id, d] of delta) this.balances.set(id, (this.balances.get(id) || 0) + d);
      return entry;
    }

    _account(id) {
      const acc = this.accounts.get(id);
      if (!acc) throw new CoreError('NOT_FOUND', 'Cuenta no encontrada');
      return acc;
    }

    _card(id) {
      const card = this.cards.get(id);
      if (!card) throw new CoreError('NOT_FOUND', 'Tarjeta no encontrada');
      return card;
    }

    _internal(id, name, kind) {
      this.accounts.set(id, { id, name, type: kind, kind, internal: true, archived: false, createdAt: this.now() });
      this.balances.set(id, 0);
    }

    /* Si no se indica cuenta, se usa la primera líquida (comportamiento actual de la app). */
    _liquidOrFirst(accountId) {
      if (accountId) {
        const acc = this._account(accountId);
        if (acc.kind !== 'liquid') throw new CoreError('NOT_LIQUID', 'Elige una cuenta de dinero disponible');
        return acc;
      }
      const first = this.liquidAccounts()[0];
      if (!first) throw new CoreError('NO_LIQUID_ACCOUNT', 'Agrega una cuenta primero');
      return first;
    }

    _sumKinds(kinds) {
      const set = new Set(kinds);
      let total = 0;
      for (const acc of this.accounts.values()) {
        if (set.has(acc.kind) && !acc.archived) total += this.balances.get(acc.id) || 0;
      }
      return total;
    }

    _today() {
      const d = new Date(this.now());
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
  }

  return { Ledger, CoreError, EXT, toCents, monthlyPaymentCents, splitCents };
});
