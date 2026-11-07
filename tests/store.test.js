/* Pruebas del almacenamiento IndexedDB (js/abaco-store.js) en Chromium real.
 * Incluye la migración de extremo a extremo: datos reales de la app antigua
 * → migración → los totales coinciden con los que la app antigua calcula.
 *
 * Ejecutar: node --test tests/store.test.js
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const APP_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const HARNESS_URL = pathToFileURL(path.join(ROOT, 'tests', 'harness', 'store.html')).href;
const CHROMIUM = process.env.ABACO_CHROMIUM || '/opt/pw-browsers/chromium';

let browser;
let context;

before(async () => {
  browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'], timeout: 30000 });
});
after(async () => {
  if (browser) await browser.close();
});
beforeEach(async () => {
  if (context) await context.close();
  context = await browser.newContext();
});

/* Abre el harness con una base IndexedDB limpia. */
async function harness() {
  const page = await context.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(HARNESS_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => new Promise((res, rej) => {
    const req = indexedDB.deleteDatabase('abaco');
    req.onsuccess = req.onerror = req.onblocked = () => res();
  }));
  return page;
}

test('instalación nueva: crea Efectivo y Débito y los vuelve a leer tras recargar', async () => {
  const page = await harness();
  const first = await page.evaluate(async () => {
    const r = await AbacoStore.open({ storage: { getItem: () => null } });
    r.store.db.close();
    return { status: r.status, names: r.ledger.listAccounts().map((a) => a.name).sort() };
  });
  assert.equal(first.status, 'fresh');
  assert.deepEqual(first.names, ['Débito', 'Efectivo']);

  const second = await page.evaluate(async () => {
    const r = await AbacoStore.open({ storage: { getItem: () => null } });
    return { status: r.status, names: r.ledger.listAccounts().map((a) => a.name).sort() };
  });
  assert.equal(second.status, 'loaded');
  assert.deepEqual(second.names, ['Débito', 'Efectivo']);
});

test('guardados incrementales: sin duplicar movimientos y con saldos idénticos al recargar', async () => {
  const page = await harness();
  const result = await page.evaluate(async () => {
    const r = await AbacoStore.open({ storage: { getItem: () => null } });
    const { store, ledger } = r;
    const bbva = ledger.createAccount({ name: 'BBVA', type: 'débito', balance: 5000 });
    ledger.expense({ amount: 200, accountId: bbva.id });
    await store.commit(ledger, { theme: 'dark' });
    ledger.income({ amount: 1000, accountId: bbva.id });
    ledger.transfer({ fromId: bbva.id, toId: ledger.liquidAccounts().find((a) => a.name === 'Efectivo').id, amount: 300 });
    await store.commit(ledger, { theme: 'dark' });
    await store.commit(ledger, { theme: 'dark' }); // guardar sin cambios no duplica nada

    const reopened = await AbacoStore.open({ storage: { getItem: () => null } });
    return {
      localEntries: ledger.entries.length,
      storedEntries: (await readCount(reopened.store.db)),
      bbvaLocal: ledger.balance(bbva.id),
      bbvaStored: reopened.ledger.balance(bbva.id),
      verify: reopened.ledger.verify().ok,
      theme: reopened.app.theme
    };
    async function readCount(db) {
      return new Promise((res, rej) => {
        const q = db.transaction('entries').objectStore('entries').count();
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
    }
  });
  assert.equal(result.storedEntries, result.localEntries);
  assert.equal(result.bbvaStored, result.bbvaLocal);
  assert.equal(result.verify, true);
  assert.equal(result.theme, 'dark');
});

test('un guardado que falla no deja escrituras a medias', async () => {
  const page = await harness();
  const outcome = await page.evaluate(async () => {
    const r = await AbacoStore.open({ storage: { getItem: () => null } });
    const { store, ledger } = r;
    ledger.income({ amount: 50, accountId: ledger.liquidAccounts()[0].id });
    await store.commit(ledger, {});
    const before = await new Promise((res) => {
      const q = store.db.transaction('entries').objectStore('entries').count();
      q.onsuccess = () => res(q.result);
    });
    // Un valor que no se puede clonar (una función) debe cancelar TODO el guardado.
    ledger.expense({ amount: 10, accountId: ledger.liquidAccounts()[0].id });
    let error = null;
    try { await store.commit(ledger, { callback: () => 1 }); } catch (e) { error = e; }
    const after = await new Promise((res) => {
      const q = store.db.transaction('entries').objectStore('entries').count();
      q.onsuccess = () => res(q.result);
    });
    return { error: error && error.code, before, after };
  });
  assert.equal(outcome.error, 'NOT_SERIALIZABLE');
  assert.equal(outcome.after, outcome.before, 'ni el movimiento nuevo ni el registro se guardaron');
});

test('exportar e importar la copia v3 reproduce el mismo estado', async () => {
  const page = await harness();
  const result = await page.evaluate(async () => {
    const r = await AbacoStore.open({ storage: { getItem: () => null } });
    const { store, ledger } = r;
    const bbva = ledger.createAccount({ name: 'BBVA', type: 'débito', balance: 1234.56 });
    ledger.expense({ amount: 99.99, accountId: bbva.id });
    const text = store.exportJSON(ledger, { user_name: 'Hugo' });
    const back = store.importJSON(text);
    const broken = JSON.parse(text);
    broken.ledger.entries[0].postings[0].amount += 1;
    let brokenError = null;
    try { store.importJSON(JSON.stringify(broken)); } catch (e) { brokenError = e.code; }
    return {
      balance: back.ledger.balance(bbva.id),
      original: ledger.balance(bbva.id),
      name: back.app.user_name,
      brokenError
    };
  });
  assert.equal(result.balance, result.original);
  assert.equal(result.name, 'Hugo');
  assert.equal(result.brokenError, 'CORRUPT_DATA');
});

test('migración de extremo a extremo: los totales coinciden con la app antigua', async () => {
  // 1. Usar la app antigua tal como está hoy para generar datos reales.
  const legacy = await context.newPage();
  legacy.on('pageerror', (e) => { throw e; });
  await legacy.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await legacy.waitForFunction(() => !!document.getElementById('btnRegister'));
  await legacy.fill('#userName', 'Hugo');
  await legacy.click('#btnRegister');
  await legacy.waitForFunction(() => !!state.user_id);
  if (await legacy.isVisible('#btnSkipWalletQuiz')) await legacy.click('#btnSkipWalletQuiz');
  const set = (fields) => legacy.evaluate((f) => { for (const [id, v] of Object.entries(f)) document.getElementById(id).value = v; }, fields);
  const call = (fn, args = []) => legacy.evaluate(([n, a]) => { try { window[n](...a); return true; } catch (e) { return e.message; } }, [fn, args]);
  const idOf = (name) => legacy.evaluate((n) => state.accounts.find((a) => a.name === n).id, name);

  await set({ accountName: 'BBVA', accountBalance: '5000', accountType: 'débito' }); await call('addAccount');
  await set({ accountName: 'Cartera', accountBalance: '1000', accountType: 'efectivo' }); await call('addAccount');
  const cartera = await idOf('Cartera');
  const bbva = await idOf('BBVA');
  await set({ hormAmount: '200', hormDesc: 'Tacos', hormFromAccount: cartera }); await call('registerHormiga');
  await set({ incAmount: '800', incDesc: 'Extra', incType: 'extra', incDestAccount: bbva }); await call('addIncome');
  await set({ transferFrom: bbva, transferTo: cartera, transferAmount: '300' }); await call('transferFunds');
  // Las operaciones que usan la primera cuenta líquida necesitan saldo en «Efectivo».
  await legacy.evaluate(() => { state.accounts.find((a) => a.name === 'Efectivo').balance = 2000; save(true); });
  await set({ saveName: 'Vacaciones', saveCurrent: '400', saveTarget: '1000' }); await call('addSaving');
  await set({ invName: 'CETES', invAmount: '500', invRate: '10', invDate: '2026-10-01', invNote: '' }); await call('addInvestment');
  await set({ debtPerson: 'Ana', debtConcept: 'Comida', debtAmount: '300', debtDate: '2026-11-01' }); await call('addDebtor');
  await set({ loanName: 'Coche', loanPrincipal: '12000', loanRate: '12', loanTerm: '12', loanType: 'personal' }); await call('addLoan');
  await legacy.evaluate(() => markLoanPayment(state.loans[0].id));
  await set({ cardName: 'Oro', cardType: 'crédito', cardLimit: '20000' }); await call('addCard');
  await legacy.waitForTimeout(400);

  // 2. Totales que la app antigua calcula con sus propias funciones.
  const expected = await legacy.evaluate(() => {
    const F = Abaco.Finance;
    return {
      available: F.available(),
      savings: F.savings(),
      investments: F.investments(),
      receivables: F.receivables(),
      debt: F.creditDebt() + F.loansDebt(),
      netWorth: F.netWorth(),
      accounts: state.accounts.filter((a) => !a.card_id).map((a) => [a.name, a.balance])
    };
  });
  // 3. Datos de localStorage tal como los dejó la app antigua.
  const storage = await legacy.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));

  // 4. Migrar en el harness y comparar.
  const page = await harness();
  const migrated = await page.evaluate(async (storage) => {
    const fake = { getItem: (k) => (k in storage ? storage[k] : null) };
    const r = await AbacoStore.open({ storage: fake });
    const L = r.ledger;
    const liquid = L.liquidAccounts().reduce((s, a) => s + a.balanceC, 0) / 100;
    const goals = [...L.goals.values()].reduce((s, g) => s + L.balance(g.id), 0) / 100;
    const invs = [...L.investments.values()].reduce((s, g) => s + L.balance(g.id), 0) / 100;
    const recv = [...L.debtors.values()].filter((d) => !d.settled).reduce((s, d) => s + L.balance(d.id), 0) / 100;
    const debt = L.totalDebt() / 100;
    const accounts = L.listAccounts().map((a) => [a.name, a.balanceC / 100]);
    const report = r.report;
    r.store.db.close();
    return { status: r.status, liquid, goals, invs, recv, debt, netWorth: L.netWorth() / 100, accounts, verify: L.verify().ok, warnings: report ? report.warnings : [] };
  }, storage);

  assert.equal(migrated.status, 'migrated');
  assert.equal(migrated.verify, true);
  assert.ok(Math.abs(migrated.liquid - expected.available) < 0.01, `disponible ${migrated.liquid} vs ${expected.available}`);
  assert.ok(Math.abs(migrated.goals - expected.savings) < 0.01, `ahorros ${migrated.goals} vs ${expected.savings}`);
  assert.ok(Math.abs(migrated.invs - expected.investments) < 0.01, `inversiones ${migrated.invs} vs ${expected.investments}`);
  assert.ok(Math.abs(migrated.recv - expected.receivables) < 0.01, `por cobrar ${migrated.recv} vs ${expected.receivables}`);
  assert.ok(Math.abs(migrated.debt - expected.debt) < 0.01, `deuda ${migrated.debt} vs ${expected.debt}`);
  assert.ok(Math.abs(migrated.netWorth - expected.netWorth) < 0.02, `patrimonio ${migrated.netWorth} vs ${expected.netWorth}`);
});

test('la migración ocurre una sola vez: la segunda apertura carga el estado v3', async () => {
  const page = await harness();
  const storage = { user_name: 'Hugo', accounts: JSON.stringify([{ id: 'x', name: 'Efectivo', type: 'efectivo', balance: 100 }]) };
  const statuses = await page.evaluate(async (storage) => {
    const fake = { getItem: (k) => (k in storage ? storage[k] : null) };
    const a = await AbacoStore.open({ storage: fake });
    const b = await AbacoStore.open({ storage: { getItem: () => null } });
    return [a.status, b.status, b.ledger.listAccounts().find((x) => x.name === 'Efectivo').balanceC];
  }, storage);
  assert.equal(statuses[0], 'migrated');
  assert.equal(statuses[1], 'loaded');
  assert.equal(statuses[2], 10000);
});
