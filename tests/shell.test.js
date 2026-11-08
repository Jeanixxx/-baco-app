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

test('cada pantalla pone su título; Inicio (Hoy) saluda, sin chip de hora', async () => {
  await register();
  const titulos = { inicio: 'Hoy', hormiga: 'Registrar', historial: 'Movimientos', presupuesto: 'Sobres', deudores: 'Deudas', prestamos: 'Deudas', lista: 'Qué comprar', config: 'Ajustes', cartas: 'Cartas' };
  for (const [panel, titulo] of Object.entries(titulos)) {
    await go(panel);
    assert.equal(await page.textContent('#tbTitle'), titulo, panel);
  }
  await go('inicio');
  assert.equal(await page.textContent('#tbSub'), 'Buenas tardes, Hugo');
  assert.equal(await page.isVisible('#tbChip'), false, 'modo calmado: sin chip de hora');
  assert.equal(await page.isVisible('#btnCalcHeader'), false, 'la calculadora vive en el menú');
  await go('cuentas');
  assert.equal(await page.textContent('#tbSub'), 'Tarde');
  // Los títulos de la interfaz anterior ya no se ven.
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.op-title-card, .panel-name, .hormiga-hero')].some((e) => e.offsetParent !== null)), false);
});

test('la cabecera se compacta al desplazar y vuelve al cambiar de pantalla', async () => {
  await register();
  await go('config');
  // Ajustes ahora es corta: se agrega espacio para poder desplazar.
  await page.evaluate(() => document.getElementById('xv-config').insertAdjacentHTML('beforeend', '<div style="height:1600px"></div>'));
  await page.evaluate(() => { const c = document.getElementById('appContent'); c.scrollTop = 300; c.dispatchEvent(new Event('scroll')); });
  assert.equal(await page.evaluate(() => document.getElementById('topbar').classList.contains('compact')), true);
  await go('inicio');
  assert.equal(await page.evaluate(() => document.getElementById('topbar').classList.contains('compact')), false);
  assert.equal(await page.evaluate(() => document.getElementById('appContent').scrollTop), 0);
});

test('un formulario se abre como hoja inferior; el fondo y "volver" la cierran', async () => {
  await register();
  await go('cuentas');
  await page.click('#btnOpenAccountForm');
  const estado = () => page.evaluate(() => ({
    hoja: document.getElementById('accountFormPanel').classList.contains('sheet-open'),
    oculta: document.getElementById('accountFormPanel').classList.contains('hidden'),
    fondo: document.getElementById('sheetScrim').classList.contains('open'),
    pos: getComputedStyle(document.getElementById('accountFormPanel')).position
  }));
  assert.deepEqual(await estado(), { hoja: true, oculta: false, fondo: true, pos: 'fixed' });
  await page.waitForTimeout(450); // la hoja termina de subir (0.32 s)
  const caja = await page.evaluate(() => { const r = document.getElementById('accountFormPanel').getBoundingClientRect(); return { bottom: Math.round(r.bottom), width: Math.round(r.width) }; });
  assert.equal(caja.bottom, 844, 'pegada al borde inferior de la pantalla');
  assert.equal(caja.width, 390);
  await page.click('#sheetScrim', { position: { x: 20, y: 40 } });
  assert.deepEqual(await estado(), { hoja: false, oculta: true, fondo: false, pos: 'static' });
  // "Volver" de Android cierra la hoja antes que cualquier otra cosa.
  await page.click('#btnOpenAccountForm');
  await page.evaluate(() => window.handleAndroidBack());
  assert.equal((await estado()).oculta, true);
  assert.equal(await page.evaluate(() => state.activePanel), 'cuentas', 'no cambió de pantalla');
});

test('guardar desde la hoja la cierra y quita el fondo', async () => {
  await register();
  await go('cuentas');
  await page.click('#btnOpenAccountForm');
  await page.fill('#accountName', 'Ahorro');
  await page.fill('#accountBalance', '1000');
  await page.evaluate(() => addAccount());
  await page.waitForFunction(() => document.getElementById('accountFormPanel').classList.contains('hidden'));
  assert.equal(await page.evaluate(() => document.getElementById('sheetScrim').classList.contains('open')), false);
  assert.ok(await page.evaluate(() => state.accounts.some((a) => a.name === 'Ahorro')));
});

test('el menú: lo que más usas arriba, el resto plegado; navega y marca la actual', async () => {
  await register();
  await go('ahorros');
  await page.evaluate(() => openMenu());
  assert.equal(await page.$$eval('#menuList .menu-tile.big', (els) => els.length), 4, 'cuatro mosaicos grandes');
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('#menuList .menu-tile.big')].some((e) => e.dataset.go === 'ahorros')), 'lo que abres seguido sube a "Lo que más usas"');
  assert.equal(await page.$$eval('#menuList .menu-grid', (els) => els.length), 0, 'el resto está plegado');
  await page.click('#menuAllToggle');
  const mosaicos = await page.$$eval('#menuList .menu-grid .menu-tile', (els) => els.map((e) => e.dataset.go));
  assert.ok(mosaicos.length >= 22, 'todas las secciones');
  assert.ok(!mosaicos.includes('deudores'), 'Por cobrar vive dentro de Deudas');
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
  await page.click('#menuAllToggle');
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

test('Registrar en dos pasos: teclado y Guardar; después "¿Qué fue?" opcional', async () => {
  await register();
  await page.evaluate(async () => { await AbacoApp.data().income({ description: 'Fondo', amount: 1000, type: 'otro' }); AbacoApp.refreshUI(); });
  await go('hormiga');
  for (const k of ['2', '4', '0', '.', '5', '0', '9']) await page.click('#regPad [data-key="' + k + '"]');
  assert.equal(await page.inputValue('#hormAmount'), '240.50', 'dos decimales como máximo');
  await page.click('#regPad [data-key="del"]');
  assert.equal(await page.inputValue('#hormAmount'), '240.5');
  assert.equal(await page.isVisible('#regMore'), false, 'las opciones extra empiezan escondidas');
  await page.click('#btnRegSave');
  await page.waitForSelector('#regStep2:not(.hidden)');
  assert.equal(await page.evaluate(() => state.expenses.length), 1, 'ya está guardado antes de preguntar');
  assert.match(await page.textContent('#regStep2'), /Guardado: \$240\.5/);
  assert.match(await page.textContent('#regStep2'), /Puedes dejarlo así: ya está guardado/);
  assert.equal(await page.$$eval('#regStep2 .reg2-chip', (els) => els.length), 3);
  await page.click('#regStep2 [data-calm="cat"][data-v="comida"]');
  await page.waitForFunction(() => state.expenses[0].category === 'comida');
  await page.fill('#regNote', 'Antojo de tarde');
  await page.click('#regStep2 [data-calm="reg-done"]');
  await page.waitForFunction(() => state.expenses[0].description === 'Antojo de tarde');
  assert.equal(await page.isVisible('#regStep1'), true, 'vuelve al paso 1');
  assert.equal(await page.inputValue('#hormAmount'), '');
});

test('el paso 2 no compromete: se puede ignorar y nunca vuelve a preguntar', async () => {
  await register();
  await page.evaluate(async () => { await AbacoApp.data().income({ description: 'Fondo', amount: 1000, type: 'otro' }); AbacoApp.refreshUI(); });
  await go('hormiga');
  await page.fill('#hormAmount', '80');
  await page.click('#btnRegSave');
  await page.waitForSelector('#regStep2:not(.hidden)');
  await go('inicio');   // se va sin contestar
  await go('hormiga');
  assert.equal(await page.isVisible('#regStep2'), false, 'no insiste al volver');
  assert.equal(await page.evaluate(() => state.expenses[0].category), 'general', 'queda guardado tal cual');
  // Si ya dijo qué fue en "Más opciones", no hay segundo paso.
  await page.fill('#hormAmount', '45');
  await page.click('#regMoreBtn');
  await page.fill('#hormDesc', 'Pasaje');
  await page.click('#btnRegSave');
  await page.waitForFunction(() => state.expenses.length === 2);
  assert.equal(await page.isVisible('#regStep2'), false);
  assert.deepEqual(errors, []);
});

test('las gráficas se abren desde Estadísticas y el mosaico tiene sus seis entradas', async () => {
  await register();
  await go('estadisticas');
  await page.click('#xv-estadisticas [data-x="stats-more"]');
  const entradas = await page.$$eval('#xv-estadisticas .x-tile', (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(entradas, ['Gráficas', 'Constancia', 'Lo que viene', 'Cartas', 'Decisiones', 'Pactos']);
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
