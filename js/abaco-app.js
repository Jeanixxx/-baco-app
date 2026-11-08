/* Ábaco · controlador de la interfaz sobre el motor nuevo (Fase 4.2).
 *
 * Se carga ANTES de app.js: los botones de app.js se enlazan a estas funciones.
 * - Arranque: abre la base (migra la primera vez), copia el estado del ledger a
 *   `state` y repinta. Mientras carga, la app muestra el estado vacío.
 * - Cada acción financiera llama a la capa de datos; si el núcleo rechaza algo o
 *   el guardado falla, se muestra el mensaje y la interfaz no cambia.
 * - Los datos no financieros (lista de compras, recordatorios...) se guardan en la
 *   misma base; las preferencias visuales (tema, pestaña activa...) siguen en localStorage.
 */
(function () {
  'use strict';

  /* Claves de `state` que se guardan en la base (no financieras). */
  const APP_DATA_KEYS = ['user_id', 'user_name', 'shop', 'checklist', 'cart', 'shopMode', 'kanban', 'reminders', 'reactions', 'categories', 'subscriptions', 'extras'];

  let data = null;
  let store = null;
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });

  const $$ = (id) => document.getElementById(id);
  const val = (id) => ($$(id) ? $$(id).value : '');
  const clear = (...ids) => ids.forEach((id) => { if ($$(id)) $$(id).value = ''; });

  /* Copia el estado financiero del motor a `state` (formas que la interfaz ya usa). */
  function syncFinance() {
    if (!data || typeof state !== 'object') return;
    const v = data.view();
    state.accounts = v.accounts;
    state.cards = v.cards;
    state.msiPlans = v.msiPlans;
    state.loans = v.loans;
    state.debtors = v.debtors;
    state.savings = v.savings;
    state.investments = v.investments;
    state.budgets = v.budgets;
    state.expenses = v.expenses;
    state.incomes = v.incomes;
    state.transfers = v.transfers;
    state.historial = v.historial;
    state.transactions = v.transactions;
    state.financeTotals = v.totals;
    state.financeVerified = v.verify;
  }

  function refreshUI() {
    syncFinance();
    const renders = ['updateUI', 'renderAccounts', 'renderCards', 'renderLoans', 'renderDebtors', 'renderInvestments',
      'renderSavings', 'renderHistorial', 'renderIncomes', 'renderBudget', 'renderCardSelect'];
    for (const name of renders) {
      try { if (typeof window[name] === 'function') window[name](); } catch (e) { console.warn('render ' + name, e); }
    }
    try { if (window.AbacoExtrasUI) window.AbacoExtrasUI.afterRefresh(); } catch (e) { console.warn('convivencia', e); }
    try { if (window.AbacoShell) window.AbacoShell.refresh(); } catch (e) { console.warn('estructura', e); }
    try { if (window.AbacoCalm) window.AbacoCalm.afterRefresh(); } catch (e) { console.warn('modo calmado', e); }
  }

  /* Como act(), pero no llama a updateUI: el asistente de bienvenida depende de esa función
   * para decidir qué pantalla mostrar, así que no debe ejecutarse mientras el asistente está abierto. */
  async function actQuiet(promise, { onOk, okMessage } = {}) {
    const r = await promise;
    if (!r.ok) { toast(r.error || 'No se pudo completar la operación'); return null; }
    syncFinance();
    ['renderAccounts', 'renderCards', 'renderInicio'].forEach((n) => { try { if (typeof window[n] === 'function') window[n](); } catch (e) { console.warn(n, e); } });
    if (onOk) onOk(r.result);
    if (okMessage) toast(okMessage);
    return r.result;
  }

  /* Ejecuta una operación del motor y refresca solo si se guardó. */
  async function act(promise, { onOk, okMessage } = {}) {
    const r = await promise;
    if (!r.ok) { toast(r.error || 'No se pudo completar la operación'); return null; }
    refreshUI();
    if (onOk) onOk(r.result);
    if (okMessage) toast(okMessage);
    return r.result;
  }

  /* Cuenta líquida por defecto cuando el formulario no ofrece elegir una. */
  function defaultLiquidId() {
    const first = (state.accounts || []).find((a) => a.kind === 'liquid');
    return first ? first.id : undefined;
  }

  /* Guarda los datos no financieros. Si la base aún no abrió, espera a que abra. */
  function persistApp() {
    const patch = {};
    for (const k of APP_DATA_KEYS) patch[k] = state[k];
    return ready.then(() => data && data.setApp(patch));
  }

  /* Reemplazo de save() de la app: solo guarda datos no financieros. */
  window.save = function save() { persistApp(); return true; };

  /* ---------- arranque ---------- */

  async function boot() {
    try {
      const r = await window.AbacoStore.open({
        idb: window.indexedDB, storage: window.localStorage,
        Ledger: window.AbacoCore.Ledger, migrate: window.AbacoMigrate.migrateLegacy, now: () => Date.now()
      });
      store = r.store;
      data = window.AbacoData.createDataService({ ledger: r.ledger, app: r.app, store });
      for (const k of APP_DATA_KEYS) if (r.app[k] !== undefined) state[k] = r.app[k];
      syncFinance();
      refreshUI();
      if (window.AbacoExtrasUI) window.AbacoExtrasUI.start();
      if (r.status === 'migrated') toast('Tus datos se actualizaron a la nueva versión de Ábaco');
      readyResolve(true);
    } catch (err) {
      console.error(err);
      toast('No se pudieron abrir tus datos: ' + (err && err.message ? err.message : 'error desconocido'));
      readyResolve(false);
    }
  }

  /* ---------- acciones ---------- */

  window.addAccount = async function addAccount() {
    const balance = Number(val('accountBalance') || 0);
    if (balance < 0) { toast('El saldo inicial no puede ser negativo'); return; }
    await act(data.addAccount({ name: val('accountName'), type: val('accountType') || 'débito', balance }), {
      onOk() { clear('accountName', 'accountBalance'); closeOpForm('accountFormPanel'); },
      okMessage: 'Cuenta agregada'
    });
  };

  window.editAccount = async function editAccount(id) {
    const acc = (state.accounts || []).find((a) => a.id === id);
    if (!acc) return;
    const form = await askFields({ title: 'Editar cuenta', confirmLabel: 'Guardar', fields: [
      { id: 'name', label: 'Nombre de la cuenta', value: acc.name },
      { id: 'balance', label: 'Saldo actual $', value: String(acc.balance || 0), type: 'number', inputmode: 'decimal' }
    ] });
    if (!form) return;
    const name = form.name;
    const balance = form.balance;
    if (name.trim() && name.trim() !== acc.name) {
      const r = await data.renameAccount(id, name);
      if (!r.ok) { toast(r.error); return; }
    }
    if (Number(balance) !== Number(acc.balance)) {
      const r = await data.adjustAccount(id, Number(balance));
      if (!r.ok) { toast(r.error); return; }
    }
    refreshUI();
    toast('Cuenta actualizada');
  };

  window.addIncome = async function addIncome() {
    if (!ensureUser()) return;
    await act(data.income({ description: val('incDesc').trim(), amount: val('incAmount'), type: val('incType') || 'otro', accountId: val('incDestAccount') || undefined }), {
      onOk() { clear('incDesc', 'incAmount', 'incNote'); closeOpForm('incFormPanel'); },
      okMessage: 'Ingreso guardado'
    });
  };

  window.transferFunds = async function transferFunds() {
    await act(data.transfer({ fromId: val('transferFrom'), toId: val('transferTo'), amount: val('transferAmount') }), {
      onOk() { clear('transferAmount'); },
      okMessage: 'Transferencia realizada'
    });
  };

  window.registerHormiga = async function registerHormiga() {
    const ui = window.AbacoExtrasUI;
    const info = { amount: val('hormAmount'), description: val('hormDesc').trim() };
    // Pausa antes de pagar: solo si la persona marcó "fue por impulso" y la tiene activada.
    if (ui && (await ui.beforeExpense(info)) !== 'go') return;
    const r = await data.expense({
      amount: info.amount, description: info.description || 'Gasto rápido',
      category: state.hormCat || 'general', accountId: val('hormFromAccount') || undefined, source: 'hormiga'
    });
    if (!r.ok) { toast(r.error); return; }
    refreshUI();
    if (ui) ui.afterExpense(info);
    clear('hormAmount', 'hormDesc');
    // Paso 2 opcional (qué fue). Si no existe la capa calmada, basta un aviso.
    if (window.AbacoCalm) window.AbacoCalm.afterSave(r.result, info);
    else toast('✓ Gasto guardado');
    if ($$('hormAmount')) $$('hormAmount').focus();
  };

  /* Ingreso desde Registrar (modo "Ingreso"): mismo teclado y mismo paso opcional que un gasto. */
  window.registerQuickIncome = async function registerQuickIncome() {
    if (!ensureUser()) return null;
    const info = { amount: val('hormAmount'), description: val('hormDesc').trim() };
    const r = await data.income({ description: info.description || 'Ingreso', amount: info.amount, type: 'otro', accountId: val('hormFromAccount') || undefined });
    if (!r.ok) { toast(r.error); return null; }
    refreshUI();
    clear('hormAmount', 'hormDesc');
    if (window.AbacoCalm) window.AbacoCalm.afterSave(r.result, info, 'ingreso');
    else toast('✓ Ingreso guardado');
    return r.result;
  };

  window.deleteExpense = async function deleteExpense(id) {
    if (!await askConfirm('¿Borrar este gasto?')) return;
    await act(data.reverse(id), { onOk() { closeDetail(); }, okMessage: 'Gasto borrado y saldo corregido' });
  };
  window.deleteIncome = async function deleteIncome(id) {
    if (!await askConfirm('¿Borrar este ingreso?')) return;
    await act(data.reverse(id), { onOk() { closeDetail(); }, okMessage: 'Ingreso borrado y saldo corregido' });
  };
  window.deleteHistorialItem = async function deleteHistorialItem(id) {
    if (!await askConfirm('¿Borrar esta compra del historial?')) return;
    await act(data.reverse(id), { onOk() { closeDetail(); }, okMessage: 'Movimiento borrado y saldo corregido' });
  };

  window.addDebtor = async function addDebtor() {
    if (!ensureUser()) return;
    await act(data.lend({ person: val('debtPerson'), concept: val('debtConcept'), amount: val('debtAmount'), date: val('debtDate'), accountId: defaultLiquidId() }), {
      onOk() { clear('debtPerson', 'debtConcept', 'debtAmount', 'debtDate'); closeOpForm('debtFormPanel'); },
      okMessage: 'Préstamo registrado y descontado de tu disponible'
    });
  };

  window.settleDebtor = async function settleDebtor(id) {
    await act(data.collect({ debtorId: id, accountId: defaultLiquidId() }), { onOk() { closeDetail(); }, okMessage: 'Cobro registrado y añadido a tu disponible' });
  };

  window.deleteDebtor = async function deleteDebtor(id) {
    if (!await askConfirm('¿Borrar este registro?')) return;
    await act(data.deleteRecord(id), { onOk() { closeDetail(); }, okMessage: 'Registro borrado' });
  };

  window.addInvestment = async function addInvestment() {
    if (!ensureUser()) return;
    await act(data.invest({ name: val('invName').trim(), amount: val('invAmount'), rate: val('invRate'), date: val('invDate') || '', note: val('invNote').trim(), accountId: defaultLiquidId() }), {
      onOk() { clear('invName', 'invAmount', 'invRate', 'invDate', 'invNote'); closeOpForm('invFormPanel'); },
      okMessage: 'Inversión registrada'
    });
  };

  window.deleteInvestment = async function deleteInvestment(id) {
    if (!await askConfirm('¿Borrar esta inversión?')) return;
    await act(data.deleteRecord(id), { onOk() { closeDetail(); }, okMessage: 'Inversión borrada y dinero devuelto' });
  };

  window.addSaving = async function addSaving() {
    const type = ($$('saveTypeChips') && $$('saveTypeChips').querySelector('.chip.active') && $$('saveTypeChips').querySelector('.chip.active').dataset.val) || state.saveType || 'open';
    await act(data.createGoal({ name: val('saveName').trim() || 'Ahorro', amount: val('saveCurrent'), type, target: val('saveTarget') || 0, accountId: defaultLiquidId() }), {
      okMessage: 'Ahorro creado y separado de tu disponible'
    });
  };

  window.contributeSaving = async function contributeSaving() {
    await act(data.contributeGoal({ goalId: val('saveSelect'), amount: val('saveAdd'), accountId: defaultLiquidId() }), {
      onOk() { clear('saveAdd', 'saveAddNote'); }, okMessage: 'Aporte registrado'
    });
  };

  window.deleteSaving = async function deleteSaving(id) {
    if (!await askConfirm('¿Borrar este ahorro? El dinero vuelve a tu disponible.')) return;
    await act(data.deleteRecord(id), { onOk() { closeDetail(); }, okMessage: 'Ahorro borrado' });
  };

  window.applySavingYield = async function applySavingYield(id) {
    const s = (state.savings || []).find((x) => x.id === id);
    if (!s) return;
    const gain = savingsYieldEstimate(s);
    if (gain <= 0) { toast('Aún no hay rendimiento para aplicar'); return; }
    await act(data.accrue({ holdingId: id, amount: gain }), { onOk() { closeDetail(); }, okMessage: 'Rendimiento aplicado: ' + money(gain) });
  };

  window.addLoan = async function addLoan() {
    if (!ensureUser()) return;
    await act(data.loan({ name: val('loanName').trim(), principal: val('loanPrincipal'), annualRate: val('loanRate') || 0, term: val('loanTerm'), type: val('loanType') || 'personal' }), {
      onOk() { clear('loanName', 'loanPrincipal', 'loanRate', 'loanTerm'); closeOpForm('loanFormPanel'); },
      okMessage: 'Deuda registrada'
    });
  };

  window.markLoanPayment = async function markLoanPayment(id) {
    await act(data.loanPayment({ loanId: id, accountId: defaultLiquidId() }), { okMessage: 'Pago registrado con capital e interés separados' });
  };

  window.addCard = async function addCard() {
    const type = val('cardType') || 'crédito';
    const name = val('cardName').trim();
    const limit = Number(val('cardLimit') || 0);
    if (limit < 0) { toast('Límite inválido'); return; }
    const op = /crédito|credito/i.test(type)
      ? data.createCard({ name, limit })
      : data.addAccount({ name, type, balance: 0 });
    await act(op, {
      onOk() { clear('cardName', 'cardLimit'); closeOpForm('cardFormPanel'); },
      okMessage: 'Cuenta agregada y conectada'
    });
  };

  window.editCard = async function editCard(id) {
    const c = (state.cards || []).find((x) => x.id === id);
    if (!c) return;
    const form = await askFields({ title: 'Editar tarjeta', confirmLabel: 'Guardar', fields: [
      { id: 'name', label: 'Nombre de la tarjeta', value: c.name },
      { id: 'limit', label: 'Límite $', value: String(c.limit || 0), type: 'number', inputmode: 'decimal' }
    ] });
    if (!form) return;
    await act(data.updateCard({ cardId: id, name: form.name.trim() || c.name, limit: Math.max(0, Number(form.limit) || 0) }), {
      okMessage: 'Tarjeta actualizada'
    });
  };

  window.deleteCard = async function deleteCard(id) {
    const c = (state.cards || []).find((x) => x.id === id);
    if (!c) return;
    if (Number(c.balance) > 0.005) { toast('No puedes borrar una tarjeta con deuda pendiente'); return; }
    if (!await askConfirm('¿Borrar esta tarjeta? Sus compras a MSI también se borrarán.')) return;
    await act(data.deleteCard(id), { onOk() { closeDetail(); }, okMessage: 'Tarjeta eliminada' });
  };

  window.addMsi = async function addMsi() {
    await act(data.msiPurchase({
      cardId: val('msiCardSelect'), concept: val('msiConcept').trim(), total: val('msiTotal'), months: val('msiMonths'),
      paidBefore: val('msiPaidBefore') || 0, purchaseDate: val('msiPurchaseDate') || todayInputValue()
    }), {
      onOk() {
        clear('msiConcept', 'msiTotal', 'msiMonths', 'msiPaidBefore');
        if ($$('msiPurchaseDate')) $$('msiPurchaseDate').value = todayInputValue();
      },
      okMessage: 'Plan MSI conectado a tu crédito'
    });
  };

  window.toggleMsiInstallment = async function toggleMsiInstallment(planId, index) {
    const plan = (state.msiPlans || []).find((p) => p.id === planId);
    const inst = plan && plan.installments && plan.installments[index];
    if (!inst) return;
    if (inst.paid) {
      await act(data.msiRevert({ planId, number: index + 1 }), { okMessage: 'Pago MSI revertido y dinero devuelto' });
    } else {
      await act(data.msiPay({ planId, number: index + 1, accountId: defaultLiquidId() }), { okMessage: 'Pago MSI registrado' });
    }
  };

  window.clearMine = async function clearMine() {
    if (!ensureUser()) return;
    if (!await askConfirm('¿Borrar tus movimientos? No se puede deshacer.')) return;
    const ids = [...(state.expenses || []), ...(state.incomes || []), ...(state.transfers || [])].map((x) => x.id);
    for (const id of ids) {
      const r = await data.reverse(id);
      if (!r.ok) { toast(r.error); break; }
    }
    refreshUI();
    closeMenu();
    toast('Tus movimientos fueron borrados');
  };

  window.clearAll = async function clearAll() {
    if (!await askConfirm('¿Borrar todos los datos? No se puede deshacer.')) return;
    const fresh = new window.AbacoCore.Ledger({ now: () => Date.now() });
    fresh.ensureDefaultAccounts();
    const r = await data.replaceAll(fresh, {});
    if (!r.ok) { toast(r.error); return; }
    ['user_id', 'user_name'].forEach((k) => { try { localStorage.removeItem(k); } catch (_) { /* sin almacenamiento */ } });
    for (const k of APP_DATA_KEYS) state[k] = (k === 'user_id' || k === 'user_name') ? (k === 'user_id' ? null : '') : (Array.isArray(state[k]) ? [] : null);
    refreshUI();
    closeMenu();
    toast('Datos vaciados');
  };

  /* ---------- presupuestos ---------- */

  window.saveBudgetPlan = async function saveBudgetPlan() {
    const rows = [...$$('budgetRows').querySelectorAll('.excel-grid')].map((row) => ({
      concept: (row.querySelector('[data-budget-field="concept"]') || {}).value || '',
      description: (row.querySelector('[data-budget-field="description"]') || {}).value || '',
      amount: Number((row.querySelector('[data-budget-field="amount"]') || {}).value || 0)
    })).map((r) => ({ concept: r.concept.trim(), description: r.description.trim(), amount: r.amount })).filter((r) => r.concept || r.description || r.amount);
    if (!rows.length) { toast('Agrega al menos un gasto planeado'); return; }
    if (rows.some((r) => !r.concept || r.amount <= 0)) { toast('Cada fila necesita concepto y costo válido'); return; }
    for (const b of state.budgets || []) {
      if (!rows.some((r) => r.concept === b.category)) await data.deleteBudget(b.id);
    }
    for (const r of rows) {
      const res = await data.setBudget({ category: r.concept, amount: r.amount, description: r.description });
      if (!res.ok) { toast(res.error); return; }
    }
    refreshUI();
    closeBudgetEntry();
    toast('Plan guardado');
  };

  window.adjustBudgetSpent = function adjustBudgetSpent() {
    toast('El gasto de cada concepto se calcula solo con tus movimientos');
  };

  window.deleteBudget = async function deleteBudget(id) {
    if (!await askConfirm('¿Quitar este concepto del plan?')) return;
    await act(data.deleteBudget(id), { okMessage: 'Concepto quitado' });
  };

  window.clearBudget = async function clearBudget() {
    if (!(state.budgets || []).length) { toast('Este periodo no tiene conceptos'); return; }
    if (!await askConfirm('¿Limpiar el plan de ' + budgetPeriodLabel().toLowerCase() + '?')) return;
    for (const b of state.budgets) await data.deleteBudget(b.id);
    refreshUI();
    toast('Plan limpiado');
  };

  /* ---------- copias de seguridad ---------- */

  window.exportBackup = async function exportBackup() {
    try {
      const cur = data.current();
      const json = store.exportJSON(cur.ledger, cur.app);
      const filename = 'abaco_backup_' + todayInputValue() + '.json';
      const native = window.AndroidBridge;
      const FS = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
      const Share = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
      if (native && native.shareBackup) {
        native.shareBackup(filename, json);
      } else if (FS && FS.writeFile) {
        const res = await FS.writeFile({ path: filename, data: json, directory: 'CACHE', encoding: 'utf8' });
        if (Share && Share.share) await Share.share({ title: 'Copia de seguridad de Ábaco', url: res.uri });
        else toast('Copia guardada: ' + filename);
      } else {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      try { localStorage.setItem('last_backup_at', String(Date.now())); } catch (_) { /* sin almacenamiento */ }
      updateBackupStatusLabel();
      toast('Copia de seguridad exportada');
    } catch (e) {
      console.warn('exportBackup', e);
      toast('No se pudo exportar la copia');
    }
  };

  /* Acepta copias v3 (de esta versión) y copias v2 (de la app anterior, migradas al vuelo). */
  window.importBackup = function importBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = String(reader.result || '');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
        let next;
        if (parsed && parsed.version === 3 && parsed.app === 'abaco') {
          next = store.importJSON(text);
        } else if (parsed && parsed.state && typeof parsed.state === 'object') {
          const m = window.AbacoMigrate.migrateLegacy(parsed.state, { Ledger: window.AbacoCore.Ledger, now: () => Date.now() });
          if (!m.report.verify.ok) throw new Error('La copia antigua no cuadra');
          next = { ledger: m.ledger, app: m.app };
        } else {
          throw new Error('Formato no reconocido');
        }
        if (!await askConfirm('¿Reemplazar tus datos con esta copia?')) return;
        const r = await data.replaceAll(next.ledger, next.app);
        if (!r.ok) throw new Error(r.error);
        for (const k of APP_DATA_KEYS) if (next.app[k] !== undefined) state[k] = next.app[k];
        refreshUI();
        closeMenu();
        toast('Copia de seguridad restaurada');
      } catch (e) {
        console.warn('importBackup', e);
        toast('La copia no es válida o contiene datos incompatibles');
      }
    };
    reader.onerror = () => toast('No se pudo leer el archivo de copia');
    reader.readAsText(file);
  };

  /* ---------- compras (lista de compras con presupuesto) ---------- */

  window.confirmShop = async function confirmShop() {
    if (!state.shopMode) return;
    const total = (state.cart || []).reduce((s, c) => s + Number(c.price || 0), 0);
    const budget = Number((state.shopMode || {}).budget || 0);
    if (!state.cart.length) { toast('El carrito está vacío'); return; }
    if (total > budget) { toast('El carrito supera tu presupuesto'); return; }
    if (total > (data.view().totals.available || 0)) { toast('Saldo disponible insuficiente para esta compra'); return; }
    for (const c of state.cart) {
      const r = await data.expense({ amount: c.price, description: c.name, category: 'general', accountId: defaultLiquidId(), source: 'compras' });
      if (!r.ok) { toast(r.error); refreshUI(); return; }
    }
    state.shopMode = null;
    state.cart = [];
    persistApp();
    refreshUI();
    showConfetti();
    toast('Compra registrada: ' + money(total));
  };

  /* ---------- asistente de bienvenida ---------- */


  /* ---------- lectura para el motor del tablero (sin escribir) ---------- */

  window.ensureFinancialCore = function ensureFinancialCore() {
    if (!Array.isArray(state.accounts)) state.accounts = [];
    if (!Array.isArray(state.cards)) state.cards = [];
    if (!Array.isArray(state.transactions)) state.transactions = [];
  };
  window.ensureDefaultAccounts = function ensureDefaultAccounts() { /* el motor crea Efectivo y Débito al registrarse */ };
  window.coreAccountForCard = function coreAccountForCard(card) {
    if (!card) return null;
    return (state.accounts || []).find((a) => a.id === card.wallet_id) || null;
  };

  /* Arranque: tras DOMContentLoaded, cuando app.js ya definió `state` y la interfaz. */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
  window.AbacoApp = { ready, refreshUI, syncFinance, persistApp, data: () => data };
})();
