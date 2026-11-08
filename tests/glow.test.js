/* Integración: la aguja de la brújula según la hora, el saludo al tocarla, la constancia que brilla
 * al anotar por primera vez el día y el reflejo del cristal. Chromium real, teléfono 390x844.
 * Ejecutar: node --test tests/glow.test.js
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const APP = (hora) => pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href + '?hora=' + hora;
const CHROMIUM = process.env.ABACO_CHROMIUM || '/opt/pw-browsers/chromium';
let browser;
let context;
let page;
let errors = [];

before(async () => { browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'], timeout: 30000 }); });
after(async () => { if (browser) await browser.close(); });

async function open(hora) {
  if (context) await context.close();
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  errors = [];
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP(hora), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AbacoApp && window.AbacoApp.ready);
  await page.evaluate(() => window.AbacoApp.ready);
  await page.fill('#userName', 'Hugo');
  await page.click('#btnRegister');
  await page.waitForFunction(() => !!state.user_id);
  if (await page.isVisible('#btnSkipWalletQuiz')) await page.click('#btnSkipWalletQuiz');
  await page.evaluate(async () => {
    const deb = state.accounts.find((a) => a.name === 'Débito');
    // El ingreso inicial es de ayer, para que hoy empiece sin movimientos.
    await AbacoApp.data().income({ description: 'Fondo', amount: 5000, type: 'otro', accountId: deb.id, at: Date.now() - 86400000 });
    AbacoExtrasUI.extras().sundays = [{ week: AbacoFocus.sundayKey(Date.now()), goal: null, at: Date.now() }];
    AbacoApp.refreshUI();
  });
}
beforeEach(async () => { await open(9); });

const needleDeg = () => page.$eval('#brujulaNeedle', (el) => {
  const m = /rotate\((-?[\d.]+)deg\)/.exec(el.style.transform || '');
  return m ? Number(m[1]) : null;
});

test('la aguja apunta al sol según la hora (mañana a la izquierda, tarde a la derecha)', async () => {
  await page.evaluate(() => { goPanel('inicio'); AbacoExtrasUI.afterRefresh(); });
  const manana = await needleDeg();
  assert.ok(manana < 0, 'a las 9 el sol está a la izquierda: ' + manana);
  await page.evaluate(() => { window.__abacoHour = 17; AbacoExtrasUI.afterRefresh(); });
  const tarde = await needleDeg();
  assert.ok(tarde > 0 && tarde > manana, 'a las 17 el sol ya está a la derecha: ' + tarde);
  await page.evaluate(() => { window.__abacoHour = 22; AbacoExtrasUI.afterRefresh(); });
  assert.ok((await needleDeg()) !== tarde, 'de noche la aguja sigue a la luna');
});

test('al tocar la brújula, el saludo va primero: Buenos días, Buenas tardes, Buenas noches', async () => {
  await page.evaluate(() => goPanel('inicio'));
  await page.click('#brujulaBtn');
  assert.match(await page.textContent('#brujulaCard .bc-body'), /^Buenos días\./);
  await page.click('#brujulaCard');
  await page.evaluate(() => { window.__abacoHour = 15; AbacoExtrasUI.afterRefresh(); });
  await page.click('#brujulaBtn');
  assert.match(await page.textContent('#brujulaCard .bc-body'), /^Buenas tardes\./);
  await page.click('#brujulaCard');
  await page.evaluate(() => { window.__abacoHour = 21; AbacoExtrasUI.afterRefresh(); });
  await page.click('#brujulaBtn');
  assert.match(await page.textContent('#brujulaCard .bc-body'), /^Buenas noches\./);
  assert.deepEqual(errors, []);
});

test('la constancia brilla el día de hoy cuando anotas por primera vez, y solo una vez', async () => {
  await page.evaluate(() => goPanel('constancia'));
  assert.equal(await page.$('#fx-constancia .fx-day.today.glow'), null, 'sin anotar hoy no brilla');
  await page.evaluate(async () => { const deb = state.accounts.find((x) => x.name === 'Débito'); const r = await AbacoApp.data().expense({ amount: 45, description: 'Café', category: 'comida', accountId: deb.id }); if (!r.ok) throw new Error(r.error); AbacoApp.refreshUI(); });
  assert.ok(await page.$('#fx-constancia .fx-day.today.glow'), 'al anotar, hoy brilla');
  // Al volver a abrir la pantalla ya no brilla.
  await page.evaluate(() => goPanel('inicio'));
  await page.evaluate(() => goPanel('constancia'));
  assert.equal(await page.$('#fx-constancia .fx-day.today.glow'), null, 'brilla una sola vez');
  assert.deepEqual(errors, []);
});

test('el reflejo del cristal existe en las tarjetas y sigue la variable de inclinación', async () => {
  await page.evaluate(() => goPanel('inicio'));
  const bg = await page.$eval('#homeToday .hoy-list', (el) => getComputedStyle(el, '::after').backgroundImage);
  assert.match(bg, /radial-gradient/);
  await page.evaluate(() => document.documentElement.style.setProperty('--sheen-x', '20px'));
  const bg2 = await page.$eval('#homeToday .hoy-list', (el) => getComputedStyle(el, '::after').backgroundImage);
  assert.notEqual(bg, bg2, 'al inclinarse, el reflejo se mueve');
});
