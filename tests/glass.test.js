/* Pruebas de la interfaz de cristal líquido y de convivencia. Chromium real, teléfono 390x844.
 * Ejecutar: node --test tests/glass.test.js
 *
 * La hora se fija con ?hora=19 (ver js/abaco-sky.js) y la fecha con window.__abacoNow.
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
let pageErrors = [];

before(async () => { browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'], timeout: 30000 }); });
after(async () => { if (browser) await browser.close(); });
beforeEach(async () => {
  if (context) await context.close();
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  pageErrors = [];
});

async function open(hora = 14) {
  if (page) await page.close().catch(() => {});
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(APP_URL + '?hora=' + hora, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AbacoApp && window.AbacoApp.ready);
  await page.evaluate(() => window.AbacoApp.ready);
}

async function register(name = 'Hugo') {
  await page.fill('#userName', name);
  await page.click('#btnRegister');
  await page.waitForFunction(() => !!state.user_id);
  if (await page.isVisible('#btnSkipWalletQuiz')) await page.click('#btnSkipWalletQuiz');
}

/* El motor rechaza gastos sin saldo: se le da un fondo a la cuenta por defecto. */
async function fondos(monto = 5000) {
  await page.evaluate(async (m) => {
    await AbacoApp.data().income({ description: 'Fondo', amount: m, type: 'otro' });
    AbacoApp.refreshUI();
  }, monto);
}

/* Datos de ejemplo: cuenta, ingreso, gastos que pasan el sobre de comida y una meta. */
async function seed() {
  await page.evaluate(async () => {
    const d = AbacoApp.data();
    await d.addAccount({ name: 'BBVA', type: 'débito', balance: 48250 });
    await d.income({ description: 'Quincena', amount: 16200, type: 'salario' });
    await d.expense({ description: 'Súper', amount: 3400, category: 'comida' });
    await d.setBudget({ category: 'comida', amount: 3000, description: '' });
    await d.setBudget({ category: 'transporte', amount: 1000, description: '' });
    await d.setBudget({ category: 'ocio', amount: 800, description: '' });
    await d.createGoal({ name: 'Viaje', amount: 6000, type: 'target', target: 12000 });
    AbacoApp.refreshUI();
  });
}

const go = (name) => page.evaluate((n) => goPanel(n), name);
const extras = () => page.evaluate(() => JSON.parse(JSON.stringify(AbacoExtrasUI.extras())));

/* Responde el diálogo propio: llena campos (select o input) y pulsa el botón principal. */
async function answerDialog(values = {}, { cancel = false } = {}) {
  await page.waitForSelector('.abaco-dialog');
  for (const [id, v] of Object.entries(values)) {
    const tag = await page.$eval('#dlg-' + id, (el) => el.tagName);
    if (tag === 'SELECT') await page.selectOption('#dlg-' + id, String(v));
    else await page.fill('#dlg-' + id, String(v));
  }
  await page.click(cancel ? '.abaco-dialog-actions .btn-ghost' : '.abaco-dialog-actions .btn:last-child');
  await page.waitForSelector('.abaco-dialog', { state: 'detached' });
}

/* ---------- cielo y tema ---------- */

test('cielo: el tema sigue la hora y el sol y la luna se mueven', async () => {
  const lectura = async (h) => {
    await open(h);
    return page.evaluate(() => {
      const sun = document.querySelector('.sky-sun');
      const moon = document.querySelector('.sky-moon');
      const layer = document.getElementById('skyLayer');
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        sunX: parseFloat(sun.style.left), sunY: parseFloat(sun.style.top),
        sunOp: parseFloat(layer.style.getPropertyValue('--sun-op')),
        moonOp: parseFloat(layer.style.getPropertyValue('--moon-op')),
        stars: parseFloat(layer.style.getPropertyValue('--stars-op')),
        grad: getComputedStyle(document.body).backgroundImage
      };
    });
  };
  const manana = await lectura(8);
  const mediodia = await lectura(12.75);
  const tarde = await lectura(18);
  const noche = await lectura(22);
  const madrugada = await lectura(3);
  assert.equal(manana.theme, 'light');
  assert.equal(tarde.theme, 'light');
  assert.equal(noche.theme, 'dark');
  assert.equal(madrugada.theme, 'dark');
  assert.ok(manana.sunX < mediodia.sunX && mediodia.sunX < tarde.sunX, 'el sol avanza hacia la derecha');
  assert.ok(mediodia.sunY < manana.sunY && mediodia.sunY < tarde.sunY, 'el sol sube y baja');
  assert.equal(noche.sunOp, 0);
  assert.ok(noche.moonOp > 0 && mediodia.moonOp === 0, 'la luna entra de noche');
  assert.ok(noche.stars > 0 && mediodia.stars === 0, 'las estrellas son de noche');
  assert.notEqual(manana.grad, noche.grad, 'el cielo cambia de color');
});

test('tema: el botón alterna automático, día y noche y lo recuerda', async () => {
  await open(3);
  const tema = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const click = () => page.evaluate(() => document.getElementById('btnThemeMenu').click());
  assert.equal(await tema(), 'dark', 'automático a las 3:00 es noche');
  await click();
  assert.equal(await tema(), 'light', 'día fijo');
  assert.equal(await page.evaluate(() => localStorage.getItem('theme_mode')), 'light');
  await click();
  assert.equal(await tema(), 'dark', 'noche fija');
  await click();
  assert.equal(await page.evaluate(() => AbacoSky.getMode()), 'auto');
  assert.equal(await tema(), 'dark');
  // El modo elegido sobrevive a recargar.
  await click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AbacoApp && window.AbacoApp.ready);
  assert.equal(await page.evaluate(() => AbacoSky.getMode()), 'light');
});

test('inicio: el saludo y el momento siguen la hora', async () => {
  await open(22);
  await register('Ana');
  await go('inicio');
  assert.equal(await page.textContent('#hgHello'), 'Buenas noches, Ana');
  assert.equal(await page.textContent('#hgChip'), 'Noche · 22:00');
  await open(9.5); // la persona ya está registrada: los datos viven en el mismo contexto
  await go('inicio');
  assert.equal(await page.textContent('#hgHello'), 'Buenos días, Ana');
  assert.equal(await page.textContent('#hgChip'), 'Mañana · 09:30');
});

test('barra inferior y menú traen las pantallas del diseño', async () => {
  await open();
  await register();
  const etiquetas = await page.$$eval('#pinnedBar .pin-label', (els) => els.map((e) => e.textContent));
  assert.deepEqual(etiquetas, ['Inicio', 'Movimientos', 'Registrar', 'Estadísticas', 'Cuentas']);
  await page.evaluate(() => openMenu());
  const menu = await page.textContent('#menuList');
  for (const t of ['Estadísticas', 'Cartas', 'Decisiones', 'Pactos', 'Configuración', 'Movimientos']) assert.match(menu, new RegExp(t));
});

test('cada pantalla nueva se abre y pinta contenido sin errores', async () => {
  await open();
  await register();
  await seed();
  for (const n of ['estadisticas', 'decisiones', 'pactos', 'cartas', 'config']) {
    await go(n);
    const texto = await page.textContent('#xv-' + n);
    assert.ok(texto.trim().length > 20, 'la pantalla ' + n + ' no está vacía');
    assert.equal(await page.isVisible('#panel-' + n), true);
  }
  assert.deepEqual(pageErrors, []);
});

/* ---------- registrar: equivalencia, impulso y pausa ---------- */

test('registrar: la equivalencia solo aparece si la persona eligió una unidad', async () => {
  await open();
  await register();
  await go('hormiga');
  await page.fill('#hormAmount', '240');
  assert.equal(await page.isVisible('#hormEquiv'), false, 'sin unidad no compara');
  await go('config');
  await page.click('[data-x="unit"][data-v="cafe"]');
  await go('hormiga');
  await page.fill('#hormAmount', '240');
  assert.match(await page.textContent('#hormEquiv'), /Son 3 cafés/);
  await page.fill('#hormAmount', '80');
  assert.match(await page.textContent('#hormEquiv'), /Es 1 café/);
  await page.fill('#hormAmount', '');
  assert.equal(await page.isVisible('#hormEquiv'), false);
});

async function prepararImpulso(segundos = 1) {
  await open();
  await register();
  await fondos();
  await page.evaluate((s) => { AbacoExtrasUI.extras().prefs.pauseSeconds = s; }, segundos);
  await go('hormiga');
  await page.fill('#hormAmount', '100');
  await page.fill('#hormDesc', 'Antojo');
  await page.click('#hormImpulse');
}
const gastos = () => page.evaluate(() => state.expenses.length);

test('pausa: "Sigo con esto" se habilita al terminar la cuenta y guarda el gasto', async () => {
  await prepararImpulso(1);
  const antes = await gastos();
  await page.evaluate(() => { window.__r = registerHormiga(); });
  await page.waitForSelector('.x-pause');
  assert.match(await page.textContent('.x-pause'), /¿Sigues queriendo esto\?/);
  assert.match(await page.textContent('.xp-amount'), /\$100/);
  assert.equal(await page.isDisabled('[data-pause="go"]'), true, 'durante la pausa no se puede seguir');
  await page.waitForFunction(() => !document.querySelector('[data-pause="go"]').disabled);
  await page.click('[data-pause="go"]');
  await page.evaluate(() => window.__r);
  assert.equal(await gastos(), antes + 1);
  assert.equal(await page.inputValue('#hormAmount'), '');
  assert.equal(await page.evaluate(() => document.getElementById('hormImpulse').classList.contains('active')), false, 'el impulso se reinicia');
});

test('pausa: "Mejor no" no guarda, lo anota como decisión y limpia el formulario', async () => {
  await prepararImpulso(1);
  const antes = await gastos();
  await page.evaluate(() => { window.__r = registerHormiga(); });
  await page.waitForSelector('.x-pause');
  await page.click('[data-pause="no"]');
  await page.evaluate(() => window.__r);
  assert.equal(await gastos(), antes);
  assert.equal(await page.inputValue('#hormAmount'), '');
  const e = await extras();
  assert.equal(e.decisions.length, 1);
  assert.equal(e.decisions[0].kind, 'no-compre');
  assert.equal(e.decisions[0].title, 'Antojo');
  await go('decisiones');
  assert.match(await page.textContent('#xv-decisiones'), /Decidí no comprar/);
});

test('pausa: Escape cierra sin guardar y deja el formulario como estaba', async () => {
  await prepararImpulso(1);
  const antes = await gastos();
  await page.evaluate(() => { window.__r = registerHormiga(); });
  await page.waitForSelector('.x-pause');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__r);
  assert.equal(await gastos(), antes);
  assert.equal(await page.inputValue('#hormAmount'), '100');
  assert.equal((await extras()).decisions.length, 0, 'cerrar no cuenta como "decidí no"');
});

test('pausa: sin impulso, o con la pausa apagada, guarda directo', async () => {
  await open();
  await register();
  await fondos();
  await go('hormiga');
  await page.fill('#hormAmount', '50');
  await page.evaluate(() => registerHormiga());
  assert.equal(await page.$('.x-pause'), null);
  assert.equal(await gastos(), 1);
  await page.evaluate(() => { AbacoExtrasUI.extras().prefs.pause = false; });
  await page.fill('#hormAmount', '60');
  await page.click('#hormImpulse');
  await page.evaluate(() => registerHormiga());
  assert.equal(await page.$('.x-pause'), null);
  assert.equal(await gastos(), 2);
});

test('decisión: una compra grande con su motivo queda en el cajón', async () => {
  await open();
  await register();
  await fondos();
  await go('hormiga');
  await page.fill('#hormAmount', '100');
  assert.equal(await page.isVisible('#hormWhyWrap'), false, 'el motivo se pide solo en compras grandes');
  await page.fill('#hormAmount', '1500');
  assert.equal(await page.isVisible('#hormWhyWrap'), true);
  await page.fill('#hormDesc', 'Audífonos');
  await page.fill('#hormWhy', 'Los necesito para trabajar');
  await page.evaluate(() => registerHormiga());
  const e = await extras();
  assert.equal(e.decisions.length, 1);
  assert.deepEqual([e.decisions[0].title, e.decisions[0].amount, e.decisions[0].reason], ['Audífonos', 1500, 'Los necesito para trabajar']);
  assert.equal(await page.inputValue('#hormWhy'), '');
});

test('decisión vencida: avisa en Inicio y se responde sin culpa', async () => {
  await open();
  await register();
  await page.evaluate(() => {
    AbacoExtras.addDecision(AbacoExtrasUI.extras(), { title: 'Audífonos', amount: 1200, reason: 'Trabajo', now: Date.now() - 100 * 86400000 });
    AbacoExtrasUI.onPanel('inicio');
  });
  await go('inicio');
  assert.match(await page.textContent('#homeNotices'), /¿Valió la pena «Audífonos»\?/);
  await page.click('#homeNotices [data-go="decisiones"]');
  await page.waitForSelector('#xv-decisiones [data-x="dec"][data-v="si"]');
  await page.click('#xv-decisiones [data-x="dec"][data-v="si"]');
  assert.equal((await extras()).decisions[0].verdict, 'si');
  await go('inicio');
  assert.equal((await page.textContent('#homeNotices')).trim(), '');
  assert.match(await page.textContent('#xv-decisiones'), /Sí valió/);
});

/* ---------- brújula ---------- */

test('brújula: está en Inicio, al tocarla muestra la nota y no navega', async () => {
  await open();
  await register();
  await seed();
  await go('inicio');
  assert.equal(await page.isVisible('#brujulaBtn'), true);
  assert.equal(await page.evaluate(() => document.getElementById('brujulaCard').classList.contains('open')), false);
  await page.click('#brujulaBtn');
  assert.equal(await page.isVisible('#brujulaCard'), true);
  assert.match(await page.textContent('#brujulaCard'), /Hay un sobre que mirar/);
  assert.match(await page.textContent('#brujulaCard'), /comida está \$400 arriba/);
  assert.equal(await page.evaluate(() => state.activePanel), 'inicio', 'no cambia de pantalla');
  assert.equal(await page.getAttribute('#brujulaBtn', 'aria-expanded'), 'true');
  await page.click('#brujulaBtn');
  assert.equal(await page.isVisible('#brujulaCard'), false);
  await go('cuentas');
  assert.equal(await page.isVisible('#brujulaBtn'), false, 'solo vive en Inicio');
});

test('brújula: la aguja apunta a donde conviene mirar y se sacude (inquieta) si hay algo que mirar', async () => {
  await open();
  await register();
  await seed();
  await go('inicio');
  assert.equal(await page.evaluate(() => document.getElementById('brujulaNeedle').style.transform), 'rotate(180deg)');
  assert.equal(await page.evaluate(() => document.getElementById('brujulaBtn').classList.contains('restless')), true);
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('#brujulaBtn .wobble')).animationName);
  assert.equal(anim, 'abacoWobble');
  // Sin sobres excedidos apunta a la meta y se calma.
  await page.evaluate(async () => { await AbacoApp.data().setBudget({ category: 'comida', amount: 9000, description: '' }); AbacoApp.refreshUI(); });
  assert.equal(await page.evaluate(() => document.getElementById('brujulaNeedle').style.transform), 'rotate(90deg)');
  assert.equal(await page.evaluate(() => document.getElementById('brujulaBtn').classList.contains('calm')), true);
});

/* ---------- sobres, preguntas, silencio ---------- */

const sobre = (cat) => page.evaluate((c) => state.budgets.find((b) => b.category === c).amount, cat);

test('sobres: pedir prestado mueve dinero entre sobres, queda anotado y se deshace', async () => {
  await open();
  await register();
  await seed();
  await go('presupuesto');
  assert.match(await page.textContent('#budgetList'), /113%/);
  await page.click('[data-x="borrow"]');
  await answerDialog({ from: 'transporte', to: 'ocio', amount: 200, note: 'regalo' });
  await page.waitForFunction(() => state.budgets.find((b) => b.category === 'ocio').amount === 1000);
  assert.equal(await sobre('transporte'), 800);
  assert.match(await page.textContent('#borrowBox'), /\$200 de transporte para ocio/i);
  assert.match(await page.textContent('#borrowBox'), /regalo/);
  await page.click('[data-x="borrow-undo"]');
  await page.waitForFunction(() => state.budgets.find((b) => b.category === 'ocio').amount === 800);
  assert.equal(await sobre('transporte'), 1000);
  assert.equal((await extras()).borrows[0].undone, true);
});

test('sobres: no se devuelve un préstamo si el sobre ya gastó ese dinero', async () => {
  await open();
  await register();
  await seed();
  await go('presupuesto');
  await page.click('[data-x="borrow"]');
  await answerDialog({ from: 'transporte', to: 'comida', amount: 200 });
  await page.waitForFunction(() => state.budgets.find((b) => b.category === 'comida').amount === 3200);
  await page.click('[data-x="borrow-undo"]');
  await page.waitForFunction(() => /ya usó ese dinero/.test(document.getElementById('toast').textContent));
  assert.equal(await sobre('comida'), 3200, 'todo queda como estaba');
  assert.equal((await extras()).borrows[0].undone, false);
});

test('sobres: no deja pedir más de lo que le queda al sobre', async () => {
  await open();
  await register();
  await seed();
  await go('presupuesto');
  await page.click('[data-x="borrow"]');
  await answerDialog({ from: 'transporte', to: 'ocio', amount: 5000 });
  await page.waitForFunction(() => /solo tiene/.test(document.getElementById('toast').textContent));
  assert.equal(await sobre('transporte'), 1000);
  assert.equal((await extras()).borrows.length, 0);
});

test('cuentas: una pregunta sin prisa por suscripción, y "Luego" no insiste hoy', async () => {
  await open();
  await register();
  await page.evaluate(() => { state.subscriptions = [{ id: 's1', name: 'Streaming', amount: 199 }, { id: 's2', name: 'Música', amount: 99 }]; });
  await go('cuentas');
  assert.match(await page.textContent('#questionBox'), /¿Usaste Streaming el mes pasado\?/);
  await page.click('#questionBox [data-v="luego"]');
  assert.match(await page.textContent('#questionBox'), /¿Usaste Música/, 'pasa a la siguiente');
  await page.click('#questionBox [data-v="no"]');
  assert.equal((await page.textContent('#questionBox')).trim(), '', 'hoy no vuelve a preguntar');
  const e = await extras();
  assert.equal(Object.values(e.answers).filter((a) => a.a === 'no').length, 1);
});

test('silencio por encargo: calla avisos y preguntas hasta el lunes', async () => {
  await open();
  await register();
  await page.evaluate(() => {
    state.subscriptions = [{ id: 's1', name: 'Streaming', amount: 199 }];
    AbacoExtras.addDecision(AbacoExtrasUI.extras(), { title: 'Algo', amount: 900, now: Date.now() - 120 * 86400000 });
  });
  await go('inicio');
  assert.notEqual((await page.textContent('#homeNotices')).trim(), '');
  await go('config');
  await page.click('[data-x="silence"][data-v="on"]');
  assert.match(await page.textContent('#xv-config'), /En silencio hasta/);
  await go('inicio');
  assert.equal((await page.textContent('#homeNotices')).trim(), '');
  await go('cuentas');
  assert.equal((await page.textContent('#questionBox')).trim(), '');
  await go('config');
  await page.click('[data-x="silence"][data-v="off"]');
  await go('cuentas');
  assert.match(await page.textContent('#questionBox'), /Streaming/);
});

/* ---------- pactos, cartas, configuración ---------- */

test('pactos: se crean, se cumplen y se rompen con nota, sin castigo', async () => {
  await open();
  await register();
  await go('pactos');
  await page.click('[data-x="pact-add"]');
  await answerDialog({ title: 'No delivery los martes' });
  assert.match(await page.textContent('#xv-pactos'), /No delivery los martes/);
  await page.click('[data-x="pact-log"][data-v="ok"]');
  await page.click('[data-x="pact-log"][data-v="ok"]');
  await page.click('[data-x="pact-log"][data-v="no"]');
  await answerDialog({ note: 'fue mi cumpleaños' });
  const texto = await page.textContent('#xv-pactos');
  assert.match(texto, /2 de 3/);
  assert.match(texto, /fue mi cumpleaños/);
  assert.match(texto, /sin reproche/);
  await page.click('[data-x="pact-del"]');
  await page.click('.abaco-dialog-actions .btn:last-child');
  await page.waitForSelector('.abaco-dialog', { state: 'detached' });
  assert.equal((await extras()).pacts.length, 0);
});

test('cartas: se escribe sola al cambiar de mes, se lee, se edita y borrar es definitivo', async () => {
  await open();
  await register('Hugo');
  await seed();
  // Un mes después, los movimientos de ahora son del "mes anterior".
  await page.evaluate(() => {
    const d = new Date();
    window.__abacoNow = new Date(d.getFullYear(), d.getMonth() + 1, 3, 12).getTime();
  });
  const creada = await page.evaluate(() => !!AbacoExtrasUI.checkLetters());
  assert.equal(creada, true);
  await go('inicio');
  assert.match(await page.textContent('#homeNotices'), /está lista/);
  await page.click('#homeNotices [data-go="cartas"]');
  await page.waitForSelector('.x-letter');
  const carta = await page.textContent('.x-letter');
  assert.match(carta, /Hola, Hugo\./);
  assert.match(carta, /Con cariño, tu Ábaco/);
  assert.match(carta, /lo que más pesó fue comida/);
  assert.equal((await extras()).letters[0].state, 'leida', 'leerla apaga el aviso');
  await go('inicio');
  assert.equal((await page.textContent('#homeNotices')).trim(), '');
  await go('cartas');
  await page.click('[data-x="letter-edit"]');
  await answerDialog({ text: 'Mi propio texto.\n\nSegundo párrafo.' });
  assert.match(await page.textContent('.x-letter'), /Mi propio texto\./);
  assert.match(await page.textContent('.x-letter'), /editada/);
  await page.click('[data-x="letter-del"]');
  await page.click('.abaco-dialog-actions .btn:last-child');
  await page.waitForSelector('.abaco-dialog', { state: 'detached' });
  assert.equal((await extras()).letters.length, 0);
  assert.equal(await page.evaluate(() => AbacoExtrasUI.checkLetters()), null, 'no vuelve a aparecer sola');
  // Sí se puede pedir a propósito.
  assert.match(await page.textContent('#xv-cartas'), /Escribir la carta de/);
});

test('configuración: tono, unidad propia, pausa y medidas; todo sobrevive a recargar', async () => {
  await open();
  await register();
  await go('config');
  await page.click('[data-x="tone"][data-v="directo"]');
  await page.click('[data-x="unit-add"]');
  await answerDialog({ singular: 'taco', plural: 'tacos', price: 25 });
  await page.click('[data-x="pause"]');
  await page.click('[data-x="metric"][data-v="ahorro"]');
  await go('hormiga');
  await page.fill('#hormAmount', '100');
  assert.match(await page.textContent('#hormEquiv'), /Son 4 tacos/);
  await page.evaluate(() => state.extras && window.save());
  await page.waitForTimeout(250);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AbacoApp && window.AbacoApp.ready);
  await page.evaluate(() => window.AbacoApp.ready);
  const e = await extras();
  assert.equal(e.prefs.tone, 'directo');
  assert.equal(e.prefs.pause, false);
  assert.equal(e.prefs.customUnits.length, 1);
  assert.equal(e.prefs.customUnits[0].singular, 'taco');
  assert.ok(e.prefs.metrics.includes('ahorro'));
  // También viaja en la copia de seguridad (que exporta todo `app`).
  assert.equal(await page.evaluate(() => AbacoApp.data().current().app.extras.prefs.tone), 'directo');
});

test('estadísticas: barras de la semana, lo que más pesó y las medidas elegidas', async () => {
  await open();
  await register();
  await seed();
  await go('estadisticas');
  const t = await page.textContent('#xv-estadisticas');
  assert.match(t, /Gastos de la semana/);
  assert.match(t, /\$3,400/);
  assert.match(t, /Lo que más pesó: (Comida|comida)/);
  assert.match(t, /Días de colchón/);
  assert.equal(await page.$$eval('#xv-estadisticas .xb', (els) => els.length), 7);
});

test('las pantallas existentes siguen mostrando sus datos con el cristal puesto', async () => {
  await open();
  await register();
  await seed();
  await go('cuentas');
  assert.match(await page.textContent('#accountList'), /BBVA/);
  await go('historial');
  assert.match(await page.textContent('#panel-historial'), /Súper/);
  const fondo = await page.evaluate(() => getComputedStyle(document.querySelector('.form-card, .card, .balance-card')).backdropFilter);
  assert.match(fondo, /blur/);
  assert.deepEqual(pageErrors, []);
});

test('borrar todos los datos también reinicia las preferencias de convivencia', async () => {
  await open();
  await register();
  await go('config');
  await page.click('[data-x="tone"][data-v="directo"]');
  await page.click('[data-x="unit"][data-v="cafe"]');
  assert.equal((await extras()).prefs.tone, 'directo');
  await page.evaluate(() => { window.__c = clearAll(); });
  // Puede pedir más de una confirmación: se aceptan hasta que termine.
  for (let i = 0; i < 4; i++) {
    const dialogo = await page.waitForSelector('.abaco-dialog', { timeout: 1500 }).catch(() => null);
    if (!dialogo) break;
    await page.click('.abaco-dialog-actions .btn:last-child');
    await page.waitForSelector('.abaco-dialog', { state: 'detached' });
  }
  await page.evaluate(() => window.__c);
  const e = await extras();
  assert.equal(e.prefs.tone, 'amable');
  assert.equal(e.prefs.unitId, null);
  assert.deepEqual(pageErrors, []);
});
