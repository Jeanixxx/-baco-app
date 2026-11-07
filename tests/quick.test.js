/* Gastos anotados desde la notificación de Android (js/abaco-quick.js).
 * La parte nativa no corre aquí: un AndroidBridge simulado hace de cola.
 * Ejecutar: node --test tests/quick.test.js
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const Q = require('../js/abaco-quick.js');

/* ---------- interpretación del texto (sin navegador) ---------- */

test('interpreta montos y descripción como los escribe una persona', () => {
  assert.deepEqual(Q.parse('85 tacos'), { amount: 85, description: 'tacos' });
  assert.deepEqual(Q.parse('tacos 85'), { amount: 85, description: 'tacos' });
  assert.deepEqual(Q.parse('$1,250.50 súper'), { amount: 1250.5, description: 'súper' });
  assert.deepEqual(Q.parse('120,5 pan'), { amount: 120.5, description: 'pan' });
  assert.deepEqual(Q.parse('1,250 renta'), { amount: 1250, description: 'renta' });
  assert.deepEqual(Q.parse('45.'), { amount: 45, description: '' });
  assert.deepEqual(Q.parse('  $ 30  café de la mañana '), { amount: 30, description: 'café de la mañana' });
  assert.equal(Q.parse('tacos'), null);
  assert.equal(Q.parse(''), null);
  assert.equal(Q.parse('0 nada'), null);
  assert.equal(Q.parse('99999999 demasiado'), null);
});

test('adivina la categoría por nombre o por palabras comunes, y si no, general', () => {
  const cats = [{ id: 'comida', name: 'Comida' }, { id: 'transporte', name: 'Transporte' }, { id: 'general', name: 'General' }, { id: 'mascotas', name: 'Mascotas' }];
  assert.equal(Q.guessCategory('tacos al pastor', cats), 'comida');
  assert.equal(Q.guessCategory('Uber al trabajo', cats), 'transporte');
  assert.equal(Q.guessCategory('croquetas mascotas', cats), 'mascotas');
  assert.equal(Q.guessCategory('regalo', cats), 'general');
  assert.equal(Q.guessCategory('', cats), 'general');
  assert.equal(Q.guessCategory('cine', cats), 'general', 'no inventa categorías que la persona no tiene');
});

/* ---------- sincronización con la cola de Android (Chromium) ---------- */

const APP_URL = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const CHROMIUM = process.env.ABACO_CHROMIUM || '/opt/pw-browsers/chromium';
let browser;
let context;
let page;

before(async () => { browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'], timeout: 30000 }); });
after(async () => { if (browser) await browser.close(); });
beforeEach(async () => {
  if (context) await context.close();
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    // Simula QuickExpense.kt: una cola que la interfaz lee y confirma.
    window.AndroidBridge = {
      queue: [], enabled: true, confirmed: [], toggles: [],
      quickExpenseEnabled() { return this.enabled; },
      setQuickExpenseEnabled(v) { this.enabled = !!v; this.toggles.push(!!v); },
      pendingQuickExpenses() { return JSON.stringify(this.queue); },
      confirmQuickExpenses(idsJson, message) {
        const ids = new Set(JSON.parse(idsJson));
        this.queue = this.queue.filter((i) => !ids.has(i.id));
        this.confirmed.push({ ids: [...ids], message });
      }
    };
  });
});

async function openApp() {
  page = await context.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(APP_URL + '?hora=13', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AbacoApp && window.AbacoApp.ready);
  await page.evaluate(() => window.AbacoApp.ready);
  await page.fill('#userName', 'Hugo');
  await page.click('#btnRegister');
  await page.waitForFunction(() => !!state.user_id);
  if (await page.isVisible('#btnSkipWalletQuiz')) await page.click('#btnSkipWalletQuiz');
  await page.evaluate(async () => { await AbacoApp.data().income({ description: 'Fondo', amount: 2000, type: 'otro' }); AbacoApp.refreshUI(); });
}

const queue = (items) => page.evaluate((list) => { window.AndroidBridge.queue = list; }, items);

test('sync guarda lo anotado en la notificación con su hora y categoría, y lo confirma', async () => {
  await openApp();
  const ayer = Date.now() - 26 * 3600 * 1000;
  await queue([{ id: 'a', text: '85 tacos', at: ayer }, { id: 'b', text: 'uber 120', at: ayer + 1000 }]);
  const r = await page.evaluate(() => AbacoQuick.sync());
  assert.deepEqual(r, { saved: 2, failed: 0 });
  const gastos = await page.evaluate(() => state.expenses.map((e) => ({ d: e.description, a: e.amount, c: e.category, at: e.created_at })));
  const tacos = gastos.find((g) => g.d === 'tacos');
  assert.deepEqual([tacos.a, tacos.c], [85, 'comida']);
  assert.equal(tacos.at, ayer, 'conserva la hora en que se anotó');
  assert.equal(gastos.find((g) => g.d === 'uber').c, 'transporte');
  const bridge = await page.evaluate(() => window.AndroidBridge);
  assert.equal(bridge.queue.length, 0, 'la cola queda vacía');
  assert.deepEqual(bridge.confirmed[0].ids.sort(), ['a', 'b']);
  assert.equal(bridge.confirmed[0].message, 'Listo: guardé 2 gastos en Ábaco.');
  assert.match(await page.textContent('#toast'), /Se guardaron 2 gastos/);
  // Llamar otra vez no duplica nada.
  assert.deepEqual(await page.evaluate(() => AbacoQuick.sync()), { saved: 0, failed: 0 });
  assert.equal(await page.evaluate(() => state.expenses.length), 2);
});

test('un gasto que el motor rechaza se queda en la cola; un texto sin monto se descarta', async () => {
  await openApp();
  await queue([{ id: 'x', text: '999999 avión', at: Date.now() }, { id: 'y', text: 'sin número', at: Date.now() }]);
  const r = await page.evaluate(() => AbacoQuick.sync());
  assert.equal(r.saved, 0);
  assert.equal(r.failed, 2);
  const bridge = await page.evaluate(() => window.AndroidBridge);
  assert.deepEqual(bridge.queue.map((i) => i.id), ['x'], 'el que no cupo espera otro intento');
  assert.deepEqual(bridge.confirmed[0].ids, ['y']);
  assert.match(await page.textContent('#toast'), /No pude guardar/);
  assert.equal(await page.evaluate(() => state.expenses.length), 0);
});

test('abrir desde la notificación lleva a Registrar', async () => {
  await openApp();
  await page.evaluate(() => goPanel('cuentas'));
  await page.evaluate(() => AbacoQuick.open('hormiga'));
  assert.equal(await page.evaluate(() => state.activePanel), 'hormiga');
  assert.equal(await page.textContent('#tbTitle'), 'Registrar');
});

test('Ajustes muestra el interruptor y lo cambia en Android', async () => {
  await openApp();
  await page.evaluate(() => goPanel('config'));
  const toggle = '#xv-config [data-x="quick"]';
  assert.equal(await page.getAttribute(toggle, 'aria-checked'), 'true');
  await page.click(toggle);
  await page.waitForFunction(() => document.querySelector('#xv-config [data-x="quick"]').getAttribute('aria-checked') === 'false');
  assert.deepEqual(await page.evaluate(() => window.AndroidBridge.toggles), [false]);
});

test('sin Android (navegador) no hace nada y Ajustes lo explica', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.AbacoApp && window.AbacoApp.ready);
  await p.evaluate(() => window.AbacoApp.ready);
  assert.deepEqual(await p.evaluate(() => AbacoQuick.sync()), { saved: 0, failed: 0 });
  await p.fill('#userName', 'Ana');
  await p.click('#btnRegister');
  await p.waitForFunction(() => !!state.user_id);
  await p.evaluate(() => goPanel('config'));
  assert.match(await p.textContent('#xv-config'), /Disponible en la app de Android/);
  await ctx.close();
});
