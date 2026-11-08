/* Motor de la calculadora (js/abaco-calc-engine.js): precedencia, borrado, paréntesis, cinta. Sin navegador.
 * Ejecutar: node --test tests/calc-engine.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Calc } = require('../js/abaco-calc-engine.js');

const run = (...keys) => {
  const c = new Calc();
  for (const k of keys) {
    if (/^\d$/.test(k)) c.digit(k);
    else if (k === '.') c.dot();
    else if (k === '=') c.equals();
    else if (k === '⌫') c.backspace();
    else if (k === 'C') c.clearEntry();
    else if (k === 'AC') c.clearAll();
    else if (k === '(') c.open();
    else if (k === ')') c.close();
    else if (k === '%') c.percent();
    else if (k === '±') c.sign();
    else if (k.startsWith('v:')) c.insert(Number(k.slice(2).split('|')[0]), k.includes('|') ? k.split('|')[1] : '');
    else c.op(k === '−' ? '-' : k);
  }
  return c;
};

test('respeta la jerarquía: × y ÷ antes que + y −', () => {
  assert.equal(run('2', '+', '3', '×', '4', '=').display(), '14');
  assert.equal(run('1', '0', '0', '-', '2', '5', '×', '2', '=').display(), '50');
  assert.equal(run('8', '÷', '2', '+', '1', '=').display(), '5');
});

test('los paréntesis cambian el orden', () => {
  assert.equal(run('(', '2', '+', '3', ')', '×', '4', '=').display(), '20');
  assert.equal(run('(', '1', '0', '-', '4', ')', '÷', '2', '=').display(), '3');
});

test('borra dígito por dígito y, si no hay número, quita la última ficha', () => {
  assert.equal(run('1', '2', '3', '⌫').display(), '12');
  assert.equal(run('1', '2', '3', '⌫', '⌫', '⌫', '⌫').display(), '0');
  // Después de un operador, borrar regresa el número anterior para corregirlo.
  const c = run('2', '5', '+', '1', '⌫');
  assert.equal(c.display(), '0');
  assert.equal(c.expression(), '25 +');
  const d = run('2', '5', '+', '⌫');
  assert.equal(d.expression(), '25');
  assert.equal(d.display(), '25');
});

test('C borra solo el número que se escribe; AC borra todo', () => {
  const c = run('2', '+', '7', '7', 'C');
  assert.equal(c.display(), '0');
  assert.equal(c.expression(), '2 +');
  assert.equal(run('2', '+', '7', 'AC').expression(), '');
});

test('muestra la operación mientras se escribe, con el origen de los valores', () => {
  const c = run('v:6500|Débito', '-', 'v:1200|Débito');
  assert.equal(c.expression(), 'Débito 6500 - Débito 1200');
  assert.deepEqual(c.evaluate(), { ok: true, value: 5300 });
});

test('dividir entre cero se avisa y no inventa un resultado', () => {
  const c = run('8', '÷', '0', '=');
  assert.equal(c.error, 'No se puede dividir entre cero');
  assert.equal(c.history.length, 0);
});

test('porcentaje, signo y decimales', () => {
  assert.equal(run('5', '0', '%').display(), '0.5');
  assert.equal(run('5', '±').display(), '-5');
  assert.equal(run('1', '0', '0', '÷', '3', '=').display(), '33.33');
  assert.equal(run('1', '.', '5', '×', '2', '=').display(), '3');
});

test('después de «=», seguir con un operador usa el resultado; un número empieza de nuevo', () => {
  assert.equal(run('2', '+', '3', '=', '×', '2', '=').display(), '10');
  assert.equal(run('2', '+', '3', '=', '7').display(), '7');
});

test('el historial guarda los últimos cálculos, más reciente primero', () => {
  const c = run('2', '+', '3', '=', '4', '×', '5', '=');
  assert.deepEqual(c.history.map((h) => [h.expr, h.result]), [['4 × 5', 20], ['2 + 3', 5]]);
});

test('una operación incompleta no se calcula', () => {
  const c = run('2', '+');
  assert.equal(c.evaluate().ok, true, 'el operador colgado al final se ignora');
  assert.equal(run().evaluate().ok, false);
});

test('se puede empezar con un signo menos', () => {
  const c = run('-', '5', '×', '2', '=');
  assert.equal(c.display(), '-10');
});
