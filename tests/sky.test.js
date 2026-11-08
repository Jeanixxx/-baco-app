/* Pruebas del cielo del día (funciones puras). Ejecutar: node --test tests/sky.test.js */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Sky = require('../js/abaco-sky.js');

test('momento y saludo por hora', () => {
  assert.equal(Sky.momentoAt(3), 'Madrugada');
  assert.equal(Sky.momentoAt(9), 'Mañana');
  assert.equal(Sky.momentoAt(14), 'Tarde');
  assert.equal(Sky.momentoAt(18), 'Atardecer');
  assert.equal(Sky.momentoAt(18.5), 'Noche', 'en México la noche empieza como a las 18:30');
  assert.equal(Sky.momentoAt(21), 'Noche');
  assert.equal(Sky.saludoAt(9), 'Buenos días');
  assert.equal(Sky.saludoAt(15), 'Buenas tardes');
  assert.equal(Sky.saludoAt(22), 'Buenas noches');
});

test('el tema es oscuro de noche y claro de día', () => {
  assert.equal(Sky.skyAt(2).theme, 'dark');
  assert.equal(Sky.skyAt(5.9).theme, 'dark');
  assert.equal(Sky.skyAt(6).theme, 'light');
  assert.equal(Sky.skyAt(12).theme, 'light');
  assert.equal(Sky.skyAt(17).theme, 'light');
  assert.equal(Sky.skyAt(18).theme, 'dark', 'el tema oscurece con el cielo, antes de que salga la luna');
  assert.equal(Sky.skyAt(18.5).theme, 'dark');
});

test('el sol cruza la pantalla de izquierda a derecha y sube y baja', () => {
  const salida = Sky.skyAt(6.5).sun;
  const mediodia = Sky.skyAt(12.75).sun;
  const puesta = Sky.skyAt(18).sun;
  assert.ok(salida.up && mediodia.up && puesta.up);
  assert.ok(salida.x < mediodia.x && mediodia.x < puesta.x, 'avanza hacia la derecha');
  assert.ok(mediodia.y < salida.y && mediodia.y < puesta.y, 'está más alto al mediodía');
  assert.ok(mediodia.opacity > salida.opacity);
});

test('de noche el sol no se ve y la luna entra por la derecha y cruza', () => {
  assert.equal(Sky.skyAt(23).sun.up, false);
  assert.equal(Sky.skyAt(23).sun.opacity, 0);
  const entra = Sky.skyAt(18.6).moon;
  const media = Sky.skyAt(0.5).moon;
  const sale = Sky.skyAt(5.5).moon;
  assert.ok(entra.x > media.x && media.x > sale.x, 'avanza hacia la izquierda');
  assert.ok(entra.x > 0.9, 'entra por la derecha');
  assert.ok(media.y < entra.y, 'sube hacia la mitad de la noche');
  assert.equal(Sky.skyAt(12).moon.opacity, 0);
});

test('las estrellas solo salen de noche', () => {
  assert.equal(Sky.skyAt(12).stars, 0);
  assert.ok(Sky.skyAt(23).stars > 0.4);
});

test('los colores del cielo cambian con la hora y son hexadecimales válidos', () => {
  const horas = [0, 3, 6, 9, 12, 15, 17.5, 18.5, 21, 24];
  const vistos = new Set();
  for (const h of horas) {
    const s = Sky.skyAt(h);
    for (const c of [s.top, s.mid, s.bot]) assert.match(c, /^#[0-9a-f]{6}$/);
    vistos.add(s.top + s.bot);
    assert.match(s.grad, /^linear-gradient/);
  }
  assert.ok(vistos.size >= 8, 'el cielo no es el mismo a cada hora');
  // La noche a las 0 y a las 24 es idéntica: el ciclo cierra sin saltos.
  assert.deepEqual(Sky.skyColors(0), Sky.skyColors(24));
});

test('los valores fuera de rango se acotan', () => {
  assert.equal(Sky.normHour(-3), 0);
  assert.equal(Sky.normHour(40), 24);
  assert.equal(Sky.normHour('abc'), 12);
});

test('resolveHour respeta ?hora y __abacoHour, y si no usa el reloj', () => {
  assert.equal(Sky.resolveHour(new Date(2026, 10, 7, 9, 30), {}), 9.5);
  assert.equal(Sky.resolveHour(new Date(2026, 10, 7, 9, 30), { location: { search: '?hora=19' } }), 19);
  assert.equal(Sky.resolveHour(new Date(2026, 10, 7, 9, 30), { __abacoHour: 22.5 }), 22.5);
  assert.equal(Sky.resolveHour(new Date(2026, 10, 7, 9, 30), { location: { search: '?hora=' } }), 9.5);
});

test('mixHex mezcla en línea recta', () => {
  assert.equal(Sky.mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(Sky.mixHex('#102030', '#102030', 0.3), '#102030');
});

test('la inclinación del teléfono mueve el cielo de lado, con tope', () => {
  assert.equal(Sky.tiltOffset(0), 0);
  assert.equal(Sky.tiltOffset(15), 14);
  assert.equal(Sky.tiltOffset(-15), -14);
  assert.equal(Sky.tiltOffset(90), 28, 'no se va más allá del tope');
  assert.equal(Sky.tiltOffset(null), 0);
});

test('la aguja apunta al sol de día y a la luna de noche', () => {
  assert.equal(Sky.needleAngleAt(6), -90, 'el sol sale por la izquierda');
  assert.equal(Sky.needleAngleAt(12.25), 0, 'al mediodía, arriba');
  assert.equal(Sky.needleAngleAt(18.5), 90, 'el sol se pone por la derecha');
  assert.ok(Sky.needleAngleAt(9) < Sky.needleAngleAt(15), 'de mañana a tarde avanza hacia la derecha');
  // La luna entra por la derecha y sale por la izquierda.
  assert.equal(Sky.needleAngleAt(18.6) > 80, true, 'la luna entra por la derecha');
  assert.ok(Sky.needleAngleAt(21) > Sky.needleAngleAt(2), 'de noche avanza hacia la izquierda');
  assert.ok(Math.abs(Sky.needleAngleAt(0.5)) < 10, 'a medianoche, casi arriba');
  for (let h = 0; h < 24; h += 0.5) {
    const a = Sky.needleAngleAt(h);
    assert.ok(a >= -90 && a <= 90, 'dentro del arco: ' + h + ' -> ' + a);
  }
});
