/* Estructura del rediseño (js/abaco-shell.js y app.js): cabecera de título grande, hojas inferiores,
 * menú en mosaico y barra inferior fija. Chromium real, teléfono 390x844.
 * Ejecutar: node --test tests/shell.test.js
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const APP_URL = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const CHROMIUM = process.env.ABACO_CHROMIUM || '/opt/pw-browsers/chromium';
let browser;
let context;
let page;
let errors = [];

before(async () => { browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'], timeout: 30000 }); });
after(async () => { if (browser) await browser.close(); });
beforeEach(async () => {
  if (context) await context.close();
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  errors = [];
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP_URL + '?hora=15', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AbacoApp && window.AbacoApp.ready);
  await page.evaluate(() => window.AbacoApp.ready);
});

async function register() {
  await page.fill('#userName', 'Hugo');
  await page.click('#btnRegister');
  await page.waitForFunction(() => !!state.user_id);
  if (await page.isVisible('#btnSkipWalletQuiz')) await page.click('#btnSkipWalletQuiz');
}
const go = (n) => page.evaluate((x) => goPanel(x), n);

test('la bienvenida no muestra la cabecera; al registrarse aparece con el título de la pantalla', async () => {
  assert.equal(await page.isVisible('#topbar'), false);
  assert.match(await page.textContent('#welcomeTitle'), /Ábaco/);
  await register();
  assert.equal(await page.isVisible('#topbar'), true);
});

test('cada pantalla pone su título; Inicio saluda y muestra el momento', async () => {
  await register();
  const titulos = { inicio: 'Inicio', hormiga: 'Registrar', historial: 'Movimientos', presupuesto: 'Sobres', deudores: 'Por cobrar', lista: 'Qué comprar', config: 'Ajustes', cartas: 'Cartas' };
  for (const [panel, titulo] of Object.entries(titulos)) {
    await go(panel);
    assert.equal(await page.textContent('#tbTitle'), titulo, panel);
  }
  await go('inicio');
  assert.equal(await page.textContent('#tbSub'), 'Buenas tardes, Hugo');
  assert.equal(await page.isVisible('#tbChip'), true);
  await go('cuentas');
  assert.equal(await page.textContent('#tbSub'), 'Tarde');
  assert.equal(await page.isVisible('#tbChip'), false, 'el chip de hora solo vive en Inicio');
  // Los títulos de la interfaz anterior ya no se ven.
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.op-title-card, .panel-name, .hormiga-hero')].some((e) => e.offsetParent !== null)), false);
});

test('la cabecera se compacta al desplazar y vuelve al cambiar de pantalla', async () => {
  await register();
  await go('config');
  await page.evaluate(() => { const c = document.getElementById('appContent'); c.scrollTop = 300; c.dispatchEvent(new Event('scroll')); });
  assert.equal(await page.evaluate(() => document.getElementById('topbar').classList.contains('compact')), true);
  await go('inicio');
  assert.equal(await page.evaluate(() => document.getElementById('topbar').classList.contains('compact')), false);
  assert.equal(await page.evaluate(() => document.getElementById('appContent').scrollTop), 0);
});

test('un formulario se abre como hoja inferior; el fondo y "volver" la cierran', async () => {
  await register();
  await go('ingresos');
  await page.click('#btnOpenIncForm');
  const estado = () => page.evaluate(() => ({
    hoja: document.getElementById('incFormPanel').classList.contains('sheet-open'),
    oculta: document.getElementById('incFormPanel').classList.contains('hidden'),
    fondo: document.getElementById('sheetScrim').classList.contains('open'),
    pos: getComputedStyle(document.getElementById('incFormPanel')).position
  }));
  assert.deepEqual(await estado(), { hoja: true, oculta: false, fondo: true, pos: 'fixed' });
  await page.waitForTimeout(450); // la hoja termina de subir (0.32 s)
  const caja = await page.evaluate(() => { const r = document.getElementById('incFormPanel').getBoundingClientRect(); return { bottom: Math.round(r.bottom), width: Math.round(r.width) }; });
  assert.equal(caja.bottom, 844, 'pegada al borde inferior de la pantalla');
  assert.equal(caja.width, 390);
  await page.click('#sheetScrim', { position: { x: 20, y: 40 } });
  assert.deepEqual(await estado(), { hoja: false, oculta: true, fondo: false, pos: 'static' });
  // "Volver" de Android cierra la hoja antes que cualquier otra cosa.
  await page.click('#btnOpenIncForm');
  await page.evaluate(() => window.handleAndroidBack());
  assert.equal((await estado()).oculta, true);
  assert.equal(await page.evaluate(() => state.activePanel), 'ingresos', 'no cambió de pantalla');
});

test('guardar desde la hoja la cierra y quita el fondo', async () => {
  await register();
  await go('ingresos');
  await page.click('#btnOpenIncForm');
  await page.fill('#incDesc', 'Quincena');
  await page.fill('#incAmount', '1000');
  await page.evaluate(() => addIncome());
  await page.waitForFunction(() => document.getElementById('incFormPanel').classList.contains('hidden'));
  assert.equal(await page.evaluate(() => document.getElementById('sheetScrim').classList.contains('open')), false);
  assert.equal(await page.evaluate(() => state.incomes.length), 1);
});

test('el menú es un mosaico: cada sección es un mosaico que navega y marca la actual', async () => {
  await register();
  await go('ahorros');
  await page.evaluate(() => openMenu());
  const mosaicos = await page.$$eval('#menuList .menu-tile', (els) => els.map((e) => e.dataset.go));
  assert.ok(mosaicos.length >= 23, 'todas las secciones');
  for (const s of ['inicio', 'hormiga', 'presupuesto', 'ingresos', 'simulador', 'kanban', 'historial', 'estadisticas', 'cartas', 'decisiones', 'pactos', 'config']) assert.ok(mosaicos.includes(s), s);
  assert.equal(await page.evaluate(() => document.querySelector('#menuList .menu-tile.on').dataset.go), 'ahorros');
  assert.equal(await page.$('#menuList .pin-btn'), null, 'ya no hay botones de fijar');
  await page.click('#menuList .menu-tile[data-go="pactos"]');
  assert.equal(await page.evaluate(() => state.activePanel), 'pactos');
  assert.equal(await page.evaluate(() => document.getElementById('menuPage').classList.contains('open')), false);
});

test('el menú se cierra con su botón y ofrece la ayuda de la sección', async () => {
  await register();
  await go('ahorros');
  await page.evaluate(() => openMenu());
  await page.click('#btnHelpMenu');
  assert.equal(await page.evaluate(() => document.getElementById('detailOverlay').classList.contains('open')), true);
  assert.match(await page.textContent('#detailTitle'), /Ayuda/);
  await page.evaluate(() => { closeDetail(); openMenu(); });
  await page.click('#btnCloseMenu');
  assert.equal(await page.evaluate(() => document.getElementById('menuPage').classList.contains('open')), false);
});

test('la barra inferior es fija e ilumina la sección más cercana', async () => {
  await register();
  const ilumina = async (panel) => { await go(panel); return page.evaluate(() => document.querySelector('#pinnedBar .active-pin').dataset.go); };
  assert.deepEqual(await page.$$eval('#pinnedBar .pinned-chip', (els) => els.map((e) => e.dataset.go)), ['inicio', 'historial', 'hormiga', 'estadisticas', 'cuentas']);
  assert.equal(await ilumina('historial'), 'historial');
  assert.equal(await ilumina('ingresos'), 'cuentas');
  assert.equal(await ilumina('kanban'), 'cuentas');
  assert.equal(await ilumina('pactos'), 'estadisticas');
  assert.equal(await ilumina('config'), 'estadisticas');
  await page.click('#pinnedBar [data-go="hormiga"]');
  assert.equal(await page.evaluate(() => state.activePanel), 'hormiga');
});

test('Registrar sigue el canvas: tarjeta grande arriba con el monto y el interruptor de impulso', async () => {
  await register();
  await page.evaluate(async () => { await AbacoApp.data().income({ description: 'Fondo', amount: 1000, type: 'otro' }); AbacoApp.refreshUI(); });
  await go('hormiga');
  await page.fill('#hormAmount', '240');
  assert.equal(await page.textContent('#scAmount'), '$240');
  const orden = await page.evaluate(() => {
    const top = (id) => document.getElementById(id).getBoundingClientRect().top;
    return top('swipeCard') < top('quickAmounts') && top('quickAmounts') < top('hormAmount');
  });
  assert.equal(orden, true, 'tarjeta, montos rápidos y después el formulario');
  await page.click('#hormImpulse');
  assert.equal(await page.getAttribute('#hormImpulse', 'aria-pressed'), 'true');
  await page.click('#btnSwipeOk');
  await page.waitForFunction(() => state.expenses.length === 0 || document.querySelector('.x-pause'));
});

test('las gráficas se abren desde Estadísticas y el mosaico tiene las cuatro entradas', async () => {
  await register();
  await go('estadisticas');
  const entradas = await page.$$eval('#xv-estadisticas .x-tile', (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(entradas, ['Gráficas', 'Cartas', 'Decisiones', 'Pactos']);
  await page.click('#xv-estadisticas [data-x="charts"]');
  await page.waitForFunction(() => document.getElementById('chartsBlock').classList.contains('chart-modal-open'));
  assert.equal(await page.evaluate(() => state.activePanel), 'inicio');
  assert.deepEqual(errors, []);
});

test('Inter viene empaquetada (funciona sin internet)', async () => {
  const familia = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  assert.match(familia, /^Inter/);
  const cargada = await page.evaluate(async () => { await document.fonts.load('600 16px Inter'); return document.fonts.check('600 16px Inter'); });
  assert.equal(cargada, true);
});
