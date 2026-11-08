/* Detector de frases de la notificación rápida (js/abaco-intent.js).
 * Cada caso es una frase escrita deprisa y lo que Ábaco debe entender. Solo se comparan los campos
 * escritos en el caso. Estas mismas frases servirán para el motor nativo (Kotlin).
 * Ejecutar: node --test tests/intent.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const I = require('../js/abaco-intent.js');

// Domingo 8 de noviembre de 2026, 13:00 (hora local).
const NOW = new Date(2026, 10, 8, 13, 0).getTime();
const at = (month, day, h = 0, m = 0, year = 2026) => new Date(year, month - 1, day, h, m).getTime();

const CTX = {
  now: NOW,
  categories: [
    { id: 'comida', name: 'Comida' }, { id: 'transporte', name: 'Transporte' }, { id: 'hogar', name: 'Hogar' },
    { id: 'ocio', name: 'Ocio' }, { id: 'salud', name: 'Salud' }, { id: 'general', name: 'General' }, { id: 'mascotas', name: 'Mascotas' }
  ],
  loans: [{ id: 'L1', name: 'Pedro', current: 1000 }, { id: 'L2', name: 'Banco Azteca', current: 5000 }, { id: 'L3', name: 'Rosa', current: 0 }],
  debtors: [{ id: 'D1', person: 'Ana López', settled: false }, { id: 'D2', person: 'mi primo Beto', settled: false }, { id: 'D3', person: 'Carla', settled: true }],
  accounts: [{ id: 'A1', name: 'Efectivo' }, { id: 'A2', name: 'BBVA' }, { id: 'A3', name: 'Nu' }]
};

const G = (amount, description, category, extra) => ({ intent: 'gasto', amount, description, category, ...extra });
const ING = (amount, description, extra) => ({ intent: 'ingreso', amount, description, ...extra });

const CASES = [
  /* ---------- gastos: solo monto y qué fue ---------- */
  ['85 tacos', G(85, 'tacos', 'comida')],
  ['tacos 85', G(85, 'tacos', 'comida')],
  ['$85 tacos', G(85, 'tacos', 'comida')],
  ['$ 30 café', G(30, 'café', 'comida')],
  ['café 45', G(45, 'café', 'comida')],
  ['uber 120', G(120, 'uber', 'transporte')],
  ['120 uber', G(120, 'uber', 'transporte')],
  ['$1,250.50 súper', G(1250.5, 'súper', 'comida')],
  ['1,250 renta', G(1250, 'renta', 'hogar')],
  ['120,5 pan', G(120.5, 'pan', 'comida')],
  ['1.500 gasolina', G(1500, 'gasolina', 'transporte')],
  ['45.', G(45, '', 'general')],
  ['500', G(500, '', 'general')],
  ['200 pesos de luz', G(200, 'luz', 'hogar')],
  ['300 varos cine', G(300, 'cine', 'ocio')],
  ['farmacia 230', G(230, 'farmacia', 'salud')],
  ['croquetas mascotas 400', G(400, 'croquetas mascotas', 'mascotas')],
  ['regalo 350', G(350, 'regalo', 'general')],
  ['netflix 219', G(219, 'netflix', 'ocio')],
  ['oxxo 67', G(67, 'oxxo', 'comida')],
  ['didi 95', G(95, 'didi', 'transporte')],
  ['metro 5', G(5, 'metro', 'transporte')],
  ['internet 499', G(499, 'internet', 'hogar')],
  ['dentista 800', G(800, 'dentista', 'salud')],
  ['2 tacos 50', G(50, '2 tacos', 'comida')],
  ['dos tacos 50', G(50, 'dos tacos', 'comida')],
  ['3 cervezas 120', G(120, '3 cervezas', 'comida')],
  ['un café 40', G(40, 'café', 'comida')],
  ['una torta 55', G(55, 'torta', 'comida')],

  /* ---------- gastos: con verbo ---------- */
  ['gasté 85 en tacos', G(85, 'tacos', 'comida')],
  ['gaste 85 en tacos', G(85, 'tacos', 'comida')],
  ['Gasté 200 en el súper', G(200, 'súper', 'comida')],
  ['pagué 600 de luz', G(600, 'luz', 'hogar')],
  ['pague la renta 4500', G(4500, 'renta', 'hogar')],
  ['compré unos tenis en 1200', G(1200, 'tenis', 'general')],
  ['compre pizza 250', G(250, 'pizza', 'comida')],
  ['me cobraron 150 de estacionamiento', G(150, 'estacionamiento', 'transporte')],
  ['me costó 90 el taxi', G(90, 'taxi', 'transporte')],
  ['se fueron 300 en el cine', G(300, 'cine', 'ocio')],
  ['salió en 480 la cena', G(480, 'cena', 'comida')],
  ['gasolina 700 con BBVA', G(700, 'gasolina', 'transporte', { accountId: 'A2' })],
  ['uber 120 con Nu', G(120, 'uber', 'transporte', { accountId: 'A3' })],
  ['tacos 85 en efectivo', G(85, 'tacos', 'comida', { accountId: 'A1' })],
  ['pagué 85 de tacos con la BBVA', G(85, 'tacos', 'comida', { accountId: 'A2' })],

  /* ---------- gastos: números con letra y abreviados ---------- */
  ['gasté cien en pan', G(100, 'pan', 'comida')],
  ['ciento cincuenta de gasolina', G(150, 'gasolina', 'transporte')],
  ['doscientos cincuenta de luz', G(250, 'luz', 'hogar')],
  ['trescientos cuarenta y cinco súper', G(345, 'súper', 'comida')],
  ['mil quinientos renta', G(1500, 'renta', 'hogar')],
  ['ayer gasté mil quinientos en el súper', G(1500, 'súper', 'comida', { when: at(11, 7, 13) })],
  ['dos mil y medio de renta', G(2500, 'renta', 'hogar')],
  ['tres mil de renta', G(3000, 'renta', 'hogar')],
  ['veinticinco de pan', G(25, 'pan', 'comida')],
  ['setenta y cinco tacos', G(75, 'tacos', 'comida')],
  ['2k renta', G(2000, 'renta', 'hogar')],
  ['1.5k gasolina', G(1500, 'gasolina', 'transporte')],
  ['2 k súper', G(2000, 'súper', 'comida')],
  ['3 mil súper', G(3000, 'súper', 'comida')],
  ['quinientos pesos cena', G(500, 'cena', 'comida')],

  /* ---------- gastos: con fecha ---------- */
  ['ayer 85 tacos', G(85, 'tacos', 'comida', { when: at(11, 7, 13) })],
  ['antier 120 uber', G(120, 'uber', 'transporte', { when: at(11, 6, 13) })],
  ['el lunes gasté 300', G(300, '', 'general', { when: at(11, 2, 13) })],
  ['el viernes 450 cena', G(450, 'cena', 'comida', { when: at(11, 6, 13) })],
  ['hoy 60 café', G(60, 'café', 'comida', { when: at(11, 8, 13) })],
  ['el 3 pagué 500 de internet', G(500, 'internet', 'hogar', { when: at(11, 3, 13) })],
  ['pagué 900 de luz el 15', G(900, 'luz', 'hogar', { when: at(10, 15, 13) })],
  ['1 de noviembre 200 pan', G(200, 'pan', 'comida', { when: at(11, 1, 13) })],

  /* ---------- ingresos ---------- */
  ['me pagaron 8000', ING(8000, '')],
  ['me pagaron la quincena 8 mil', ING(8000, 'quincena', { incomeType: 'sueldo' })],
  ['quincena 7500', ING(7500, 'quincena', { incomeType: 'sueldo' })],
  ['cayó la quincena 9,200', ING(9200, 'quincena', { incomeType: 'sueldo' })],
  ['me depositaron 1500', ING(1500, '')],
  ['me transfirieron 600 del freelance', ING(600, 'freelance', { incomeType: 'extra' })],
  ['recibí 2000 de aguinaldo', ING(2000, 'aguinaldo', { incomeType: 'sueldo' })],
  ['vendí mi bici en 2,500', ING(2500, 'bici', { incomeType: 'venta' })],
  ['vendi la tele 3k', ING(3000, 'tele', { incomeType: 'venta' })],
  ['gané 500 en la rifa', ING(500, 'rifa')],
  ['me dieron 300 de propinas', ING(300, 'propinas', { incomeType: 'extra' })],
  ['sueldo 12000', ING(12000, 'sueldo', { incomeType: 'sueldo' })],
  ['nómina 15,000', ING(15000, 'nómina', { incomeType: 'sueldo' })],
  ['bono 2000', ING(2000, 'bono', { incomeType: 'sueldo' })],
  ['reembolso 350', ING(350, 'reembolso')],
  ['me llegó el reembolso de 350', ING(350, 'reembolso')],
  ['me pagaron 400 con BBVA', ING(400, '', { accountId: 'A2' })],
  ['ayer me pagaron 1200', ING(1200, '', { when: at(11, 7, 13) })],
  ['me pagó Luis 300', ING(300, 'Luis')],
  ['me pagaron mil', ING(1000, '')],
  ['me pagaron seis mil quinientos', ING(6500, '')],
  ['entraron 5000 de comisión', ING(5000, 'comisión', { incomeType: 'extra' })],

  /* ---------- yo debo ---------- */
  ['le debo 500 a Juan', { intent: 'debo', amount: 500, person: 'Juan', description: '', disburse: false }],
  ['le debo 500 a Juan por la pizza', { intent: 'debo', amount: 500, person: 'Juan', description: 'pizza' }],
  ['le debo a Juan 500', { intent: 'debo', amount: 500, person: 'Juan' }],
  ['debo 300 a mi hermana', { intent: 'debo', amount: 300, person: 'Mi hermana' }],
  ['le debo 1200 a doña Rosa del gas', { intent: 'debo', amount: 1200, person: 'Doña Rosa', description: 'gas' }],
  ['Juan me prestó 2k', { intent: 'debo', amount: 2000, person: 'Juan', disburse: true }],
  ['juan me presto 2000', { intent: 'debo', amount: 2000, person: 'Juan', disburse: true }],
  ['me prestó Pedro 500', { intent: 'debo', amount: 500, person: 'Pedro', disburse: true }],
  ['mi mamá me prestó mil', { intent: 'debo', amount: 1000, person: 'Mi mamá', disburse: true }],
  ['me prestaron 3000 en el trabajo', { intent: 'debo', amount: 3000, disburse: true }],
  ['pedí prestado 800 a Memo', { intent: 'debo', amount: 800, person: 'Memo', disburse: true }],
  ['le debo a mi primo Beto 300', { intent: 'debo', amount: 300, person: 'mi primo Beto' }],
  ['quedé a deber 250 a Toño', { intent: 'debo', amount: 250, person: 'Toño' }],
  ['les debo 600 a mis papás', { intent: 'debo', amount: 600, person: 'Mis papás' }],
  ['le debo quinientos a Juan', { intent: 'debo', amount: 500, person: 'Juan' }],
  ['le debo 500', { intent: 'debo', amount: 500, missing: ['person'] }],
  ['le debo a Juan', { intent: 'debo', person: 'Juan', missing: ['amount'] }],

  /* ---------- me deben ---------- */
  ['le presté 300 a Ana', { intent: 'me_deben', amount: 300, person: 'Ana López' }],
  ['le preste 300 a Luis', { intent: 'me_deben', amount: 300, person: 'Luis' }],
  ['le presté 300 a mi primo Beto', { intent: 'me_deben', amount: 300, person: 'mi primo Beto' }],
  ['le presté 400 a mi tía Lupe', { intent: 'me_deben', amount: 400, person: 'Mi tía Lupe' }],
  ['Luis me debe 200', { intent: 'me_deben', amount: 200, person: 'Luis' }],
  ['mi hermana me debe doscientos cincuenta', { intent: 'me_deben', amount: 250, person: 'Mi hermana' }],
  ['Memo me debe 150 de la comida', { intent: 'me_deben', amount: 150, person: 'Memo', description: 'comida' }],
  ['me debe 300 Sofía', { intent: 'me_deben', amount: 300, person: 'Sofía' }],
  ['preste 1000 a Raúl para la renta', { intent: 'me_deben', amount: 1000, person: 'Raúl', description: 'renta' }],
  ['le di prestado 500 a Lalo', { intent: 'me_deben', amount: 500, person: 'Lalo' }],
  ['le fié 80 al vecino', { intent: 'me_deben', amount: 80, person: 'Vecino' }],
  ['le presté 300', { intent: 'me_deben', amount: 300, missing: ['person'] }],
  ['Luis me debe', { intent: 'me_deben', person: 'Luis', missing: ['amount'] }],

  /* ---------- abono a lo que yo debo (Pedro y Banco Azteca tienen deuda abierta) ---------- */
  ['le pagué 500 a Pedro', { intent: 'abono', amount: 500, person: 'Pedro', targetId: 'L1' }],
  ['le abono 200 a Pedro', { intent: 'abono', amount: 200, person: 'Pedro', targetId: 'L1' }],
  ['Pedro, le abono 200', { intent: 'abono', amount: 200, person: 'Pedro', targetId: 'L1' }],
  ['abono 300 a Pedro', { intent: 'abono', amount: 300, targetId: 'L1' }],
  ['abone 300 a pedro', { intent: 'abono', amount: 300, targetId: 'L1' }],
  ['pagué 1500 a Banco Azteca', { intent: 'abono', amount: 1500, targetId: 'L2' }],
  ['le pagué a Pedro', { intent: 'abono', amount: null, targetId: 'L1', missing: [] }],
  ['liquidé lo de Pedro', { intent: 'abono', targetId: 'L1', missing: [] }],
  ['le devolví 200 a Pedro', { intent: 'abono', amount: 200, targetId: 'L1' }],
  // Sin deuda abierta con esa persona, pagarle es un gasto.
  ['le pagué 200 a Juan', { intent: 'gasto', amount: 200 }],
  ['le pagué 200 a Rosa', { intent: 'gasto', amount: 200 }],

  /* ---------- cobro de lo que me deben (Ana López y mi primo Beto deben) ---------- */
  ['Ana me pagó 300', { intent: 'cobro', amount: 300, person: 'Ana López', targetId: 'D1' }],
  ['ana me pago 300', { intent: 'cobro', amount: 300, targetId: 'D1' }],
  ['me pagó Ana 150', { intent: 'cobro', amount: 150, targetId: 'D1' }],
  ['Ana me abonó 100', { intent: 'cobro', amount: 100, targetId: 'D1' }],
  ['Ana me devolvió todo', { intent: 'cobro', amount: null, targetId: 'D1', missing: [] }],
  ['Beto me pagó 200', { intent: 'cobro', amount: 200, targetId: 'D2' }],
  ['le cobré 300 a Ana', { intent: 'cobro', amount: 300, targetId: 'D1' }],
  ['Ana me depositó 500', { intent: 'cobro', amount: 500, targetId: 'D1' }],
  // Sin cobro abierto, que alguien te pague es un ingreso.
  ['Carla me pagó 300', { intent: 'ingreso', amount: 300 }],
  ['me pagó Luis 300', { intent: 'ingreso', amount: 300 }],

  /* ---------- recordatorios ---------- */
  ['recuérdame pagar la luz el viernes', { intent: 'recordatorio', description: 'Pagar la luz', when: at(11, 13, 9) }],
  ['recuerdame pagar la luz', { intent: 'recordatorio', description: 'Pagar la luz', when: at(11, 9, 9) }],
  ['recuérdame comprar pan mañana a las 8', { intent: 'recordatorio', description: 'Comprar pan', when: at(11, 9, 8) }],
  ['recuérdame llamar a mamá a las 6', { intent: 'recordatorio', description: 'Llamar a mamá', when: at(11, 8, 18) }],
  ['recuérdame llamar a mamá a las 6 de la mañana', { intent: 'recordatorio', description: 'Llamar a mamá', when: at(11, 9, 6) }],
  ['recuérdame a las 10 am junta', { intent: 'recordatorio', description: 'Junta', when: at(11, 9, 10) }],
  ['recuérdame a las 3:30 pm la cita', { intent: 'recordatorio', description: 'Cita', when: at(11, 8, 15, 30) }],
  ['recuérdame a las 18:45 sacar la basura', { intent: 'recordatorio', description: 'Sacar la basura', when: at(11, 8, 18, 45) }],
  ['avísame en 2 horas sacar la ropa', { intent: 'recordatorio', description: 'Sacar la ropa', when: NOW + 2 * 3600000 }],
  ['avísame en 30 minutos apagar el horno', { intent: 'recordatorio', description: 'Apagar el horno', when: NOW + 30 * 60000 }],
  ['recuérdame en media hora tomar la pastilla', { intent: 'recordatorio', description: 'Tomar la pastilla', when: NOW + 30 * 60000 }],
  ['no olvidar cita dentista 15/12 a las 5', { intent: 'recordatorio', description: 'Cita dentista', when: at(12, 15, 17) }],
  ['no olvides la tarjeta el 20', { intent: 'recordatorio', description: 'Tarjeta', when: at(11, 20, 9) }],
  ['recuérdame el 5 pagar internet', { intent: 'recordatorio', description: 'Pagar internet', when: at(12, 5, 9) }],
  ['recuérdame pagar 500 a Pedro el lunes', { intent: 'recordatorio', when: at(11, 9, 9) }],
  ['recordatorio renovar licencia el 3 de enero', { intent: 'recordatorio', description: 'Renovar licencia', when: at(1, 3, 9, 0, 2027) }],
  ['acuérdame del gas pasado mañana', { intent: 'recordatorio', description: 'Gas', when: at(11, 10, 9) }],
  ['recuérdame el viernes que viene ir al banco', { intent: 'recordatorio', description: 'Ir al banco', when: at(11, 13, 9) }],
  ['recuérdame mañana en la tarde lavar el coche', { intent: 'recordatorio', description: 'Lavar el coche', when: at(11, 9, 16) }],
  ['recuérdame mañana en la noche', { intent: 'recordatorio', missing: ['description'] }],
  ['a las 6 de la tarde recuérdame ir al gym', { intent: 'recordatorio', description: 'Ir al gym', when: at(11, 8, 18) }],
  ['recuérdame al mediodía comer', { intent: 'recordatorio', description: 'Comer', when: at(11, 9, 12) }],

  /* ---------- lista de compras ---------- */
  ['hay que comprar tortillas', { intent: 'lista', description: 'Tortillas' }],
  ['comprar leche', { intent: 'lista', description: 'Leche' }],
  ['comprar pilas y foco', { intent: 'lista', description: 'Pilas y foco' }],
  ['falta jabón', { intent: 'lista', description: 'Jabón' }],
  ['faltan huevos', { intent: 'lista', description: 'Huevos' }],
  ['se acabó el café', { intent: 'lista', description: 'Café' }],
  ['necesito comprar cartulinas', { intent: 'lista', description: 'Cartulinas' }],
  ['apunta detergente', { intent: 'lista', description: 'Detergente' }],
  ['papel de baño a la lista', { intent: 'lista', description: 'Papel de baño' }],

  /* ---------- variantes reales: mayúsculas, sin acentos, modismos ---------- */
  ['TACOS 85', G(85, 'TACOS', 'comida')],
  ['Uber 89.50', G(89.5, 'Uber', 'transporte')],
  ['gaste 40 en el metrobus', G(40, 'metrobus', 'transporte')],
  ['pague 350 del gas', G(350, 'gas', 'hogar')],
  ['me gasté 600 en el antro', G(600, 'antro', 'ocio')],
  ['compramos despensa 1,800', G(1800, 'despensa', 'comida')],
  ['caseta 112', G(112, 'caseta', 'transporte')],
  ['spotify 129', G(129, 'spotify', 'ocio')],
  ['consulta 600', G(600, 'consulta', 'salud')],
  ['predial 2300', G(2300, 'predial', 'hogar')],
  ['elote 35', G(35, 'elote', 'comida')],
  ['rappi 210', G(210, 'rappi', 'comida')],
  ['ayer en la noche 300 de cena', G(300, 'cena', 'comida')],
  ['me cayeron 2 mil del aguinaldo', ING(2000, 'aguinaldo', { incomeType: 'sueldo' })],
  ['me depositaron la nomina 7k', ING(7000, 'nomina', { incomeType: 'sueldo' })],
  ['Me Pagaron 900', ING(900, '')],
  ['vendí ropa 450', ING(450, 'ropa', { incomeType: 'venta' })],
  ['LE DEBO 200 A JUAN', { intent: 'debo', amount: 200, person: 'JUAN' }],
  ['le debo 200 al Chuy', { intent: 'debo', amount: 200, person: 'Chuy' }],
  ['le presto 100 a Maru', { intent: 'me_deben', amount: 100, person: 'Maru' }],
  ['le presté mil a Ana', { intent: 'me_deben', amount: 1000, person: 'Ana López' }],
  ['pedro, ya le pagué 300', { intent: 'abono', amount: 300, targetId: 'L1' }],
  ['le di 200 a Pedro', { intent: 'abono', amount: 200, targetId: 'L1' }],
  ['beto me abonó 50', { intent: 'cobro', amount: 50, targetId: 'D2' }],
  ['recuerdame manana pagar la tarjeta', { intent: 'recordatorio', description: 'Pagar la tarjeta', when: at(11, 9, 9) }],
  ['RECUÉRDAME el martes la junta a las 4', { intent: 'recordatorio', description: 'Junta', when: at(11, 10, 16) }],
  ['no se me olvide el cumple de Ana el 2 de diciembre', { intent: 'recordatorio', description: 'Cumple de Ana', when: at(12, 2, 9) }],
  ['falta papel', { intent: 'lista', description: 'Papel' }],
  ['comprar croquetas para el perro', { intent: 'lista', description: 'Croquetas para el perro' }],

  /* ---------- lo que no se entiende ---------- */
  ['', { intent: null }],
  ['   ', { intent: null }],
  ['hola', { intent: null }],
  ['tacos', { intent: null }],
  ['sin número', { intent: null }],
  ['0 nada', { intent: 'gasto', amount: null, missing: ['amount'] }],
  ['jajaja', { intent: null }],
  ['ok', { intent: null }],
  ['99999999 demasiado', { intent: 'gasto', amount: null, missing: ['amount'] }],
  ['gasté en tacos', { intent: 'gasto', missing: ['amount'] }],
  ['me pagaron', { intent: 'ingreso', missing: ['amount'] }]
];

for (const [text, expected] of CASES) {
  test(`«${text}»`, () => {
    const r = I.detect(text, CTX);
    const got = {};
    for (const k of Object.keys(expected)) got[k] = r[k];
    assert.deepEqual(got, expected);
  });
}

test('hay al menos 200 frases de prueba', () => {
  assert.ok(CASES.length >= 200, 'casos: ' + CASES.length);
});

test('las alternativas aparecen cuando dos lecturas empatan', () => {
  const r = I.detect('500', CTX);
  assert.equal(r.intent, 'gasto');
  assert.ok(r.confidence <= 0.6, 'solo un monto: confianza media');
  const sure = I.detect('gasté 500 en tacos', CTX);
  assert.ok(sure.confidence >= 0.9);
});

test('el resumen se lee como lo diría una persona', () => {
  assert.equal(I.summary(I.detect('85 tacos', CTX)), 'Gasto · $85 · tacos');
  assert.equal(I.summary(I.detect('le debo 500 a Juan', CTX)), 'Le debes a Juan · $500');
  assert.equal(I.summary(I.detect('le pagué 500 a Pedro', CTX)), 'Abono a Pedro · $500');
  assert.equal(I.summary(I.detect('Ana me pagó 300', CTX)), 'Ana López te pagó · $300');
  assert.equal(I.summary(I.detect('le presté 300 a Luis', CTX)), 'Luis te debe · $300');
  assert.equal(I.summary(I.detect('me pagaron la quincena 8 mil', CTX)), 'Ingreso · $8,000 · quincena');
  assert.equal(I.summary(I.detect('recuérdame pagar la luz', CTX)), 'Recordatorio · Pagar la luz');
  assert.equal(I.summary(I.detect('hola', CTX)), '');
});

test('los números con letra se leen bien', () => {
  const n = (s) => { const r = I.readWords(s.split(' '), 0); return r && r.value; };
  assert.equal(n('mil'), 1000);
  assert.equal(n('mil quinientos'), 1500);
  assert.equal(n('dos mil trescientos cuarenta y cinco'), 2345);
  assert.equal(n('cien mil'), 100000);
  assert.equal(n('doscientos cincuenta mil'), 250000);
  assert.equal(n('veintiun mil'), 21000);
  assert.equal(n('un millon'), 1000000);
  assert.equal(n('un'), null, 'un artículo solo no es un número');
  assert.equal(n('una'), null);
  assert.equal(n('tacos'), null);
});

test('las reglas se pueden exportar como JSON para el motor nativo', () => {
  const json = JSON.parse(JSON.stringify(I.RULES));
  assert.deepEqual(Object.keys(json.intents).sort(), ['abono', 'cobro', 'debo', 'gasto', 'ingreso', 'lista', 'me_deben', 'recordatorio']);
  for (const list of Object.values(json.intents)) for (const [re, w] of list) { assert.doesNotThrow(() => new RegExp(re)); assert.equal(typeof w, 'number'); }
});
