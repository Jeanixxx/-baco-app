/* Ábaco · motor de la calculadora (sin pantalla).
 *
 * Lleva la expresión como lista de fichas: números (con su origen, por ejemplo «Débito»),
 * operadores + − × ÷ y paréntesis. Evalúa con precedencia (× ÷ antes que + −),
 * borra dígito por dígito, y recuerda los últimos cálculos.
 *
 * Esta parte no toca la app: la interfaz (js/abaco-calc.js) decide qué hacer con el resultado.
 */
(function (root) {
  'use strict';

  const PREC = { '+': 1, '-': 1, '×': 2, '÷': 2 };
  const HISTORY_MAX = 8;

  function round2(n) { return Math.round(n * 100) / 100; }

  /* Número como se escribe en la cinta: sin ceros de más, con hasta dos decimales. */
  function fmtNum(n) {
    if (!Number.isFinite(n)) return '';
    const r = round2(n);
    return String(Object.is(r, -0) ? 0 : r);
  }

  function clone(list) { return list.map((t) => ({ ...t })); }

  class Calc {
    constructor() {
      this.tokens = [];      // fichas ya cerradas
      this.entry = '';       // número que se está escribiendo (cadena)
      this.entryLabel = '';  // de dónde vino, si se tomó de una cuenta o deuda
      this.error = '';
      this.history = [];     // { expr, result }
      this.fresh = false;    // true justo después de «=»: lo siguiente empieza de nuevo (o sigue con el resultado)
    }

    /* ---------- entradas ---------- */

    digit(d) {
      this.error = '';
      if (this.fresh) this._restart();
      if (!/^\d$/.test(d)) return this;
      if (this.entry === '0') this.entry = d;
      else if (this.entry === '-0') this.entry = '-' + d;
      else this.entry += d;
      return this;
    }

    dot() {
      this.error = '';
      if (this.fresh) this._restart();
      if (!this.entry.includes('.')) this.entry = (this.entry === '' || this.entry === '-' ? this.entry + '0' : this.entry) + '.';
      return this;
    }

    /* Operador: cierra el número que se escribe y lo pone en la cinta. Si ya hay un operador al final, lo cambia. */
    op(o) {
      if (!PREC[o]) return this;
      this.error = '';
      if (this.fresh) {
        // Después de «=», un operador sigue con el resultado.
        this.fresh = false;
        this.tokens = [{ t: 'n', raw: fmtNum(this._resultValue), v: this._resultValue, label: '' }];
        this.entry = '';
      }
      this._flush();
      const last = this.tokens[this.tokens.length - 1];
      if (!last || last.t === '(') {
        // Al inicio solo cabe un signo menos (número negativo).
        if (o === '-' && this.entry === '') this.entry = '-';
        return this;
      }
      if (last.t === 'op') { last.v = o; return this; }
      this.tokens.push({ t: 'op', v: o });
      return this;
    }

    open() {
      this.error = '';
      if (this.fresh) this._restart();
      if (this.entry !== '') return this;
      const last = this.tokens[this.tokens.length - 1];
      if (last && last.t === 'n') return this;
      this.tokens.push({ t: '(' });
      return this;
    }

    close() {
      this.error = '';
      this._flush();
      if (this.depth() <= 0) return this;
      const last = this.tokens[this.tokens.length - 1];
      if (!last || last.t === 'op' || last.t === '(') return this;
      this.tokens.push({ t: ')' });
      return this;
    }

    depth() {
      return this.tokens.reduce((d, t) => (t.t === '(' ? d + 1 : t.t === ')' ? d - 1 : d), 0);
    }

    /* Borra el último dígito. Si no queda nada que escribir, quita la última ficha. */
    backspace() {
      this.error = '';
      if (this.fresh) { this._restart(); return this; }
      if (this.entry !== '') {
        this.entry = this.entry.slice(0, -1);
        if (this.entry === '' || this.entry === '-') { this.entry = ''; this.entryLabel = ''; }
        return this;
      }
      const last = this.tokens.pop();
      if (last && last.t === 'n') { this.entry = last.raw; this.entryLabel = last.label || ''; }
      return this;
    }

    /* Borra solo lo que se está escribiendo (C). */
    clearEntry() {
      this.error = '';
      if (this.fresh) { this._restart(); return this; }
      this.entry = ''; this.entryLabel = '';
      return this;
    }

    /* Borra todo (AC). El historial se queda. */
    clearAll() {
      this.tokens = []; this.entry = ''; this.entryLabel = ''; this.error = ''; this.fresh = false;
      return this;
    }

    sign() {
      this.error = '';
      if (this.fresh) this._restart();
      if (this.entry === '') return this;
      this.entry = this.entry.startsWith('-') ? this.entry.slice(1) : '-' + this.entry;
      return this;
    }

    percent() {
      this.error = '';
      if (this.fresh) this._restart();
      if (this.entry === '' || this.entry === '-') return this;
      this.entry = fmtNum(Number(this.entry) / 100);
      return this;
    }

    /* Mete un valor que viene de la app (saldo, deuda, préstamo) como número, con su origen. */
    insert(value, label) {
      this.error = '';
      if (this.fresh) this._restart();
      const v = Number(value);
      if (!Number.isFinite(v)) return this;
      // Si ya hay un número escrito, se pone uno detrás con × para no perderlo.
      if (this.entry !== '' || (this.tokens.length && this.tokens[this.tokens.length - 1].t === 'n')) {
        this._flush();
        const last = this.tokens[this.tokens.length - 1];
        if (last && last.t === 'n') this.tokens.push({ t: 'op', v: '×' });
      }
      this.entry = fmtNum(v);
      this.entryLabel = label || '';
      return this;
    }

    /* ---------- cálculo ---------- */

    /* Evalúa la expresión completa. Devuelve { ok, value } o { ok:false, error }. */
    evaluate() {
      const list = this._closedTokens();
      if (!list.length) return { ok: false, error: 'Escribe una operación' };
      const out = [];
      const ops = [];
      for (const t of list) {
        if (t.t === 'n') out.push(t.v);
        else if (t.t === '(') ops.push(t);
        else if (t.t === ')') {
          while (ops.length && ops[ops.length - 1].t !== '(') out.push(...[ops.pop()]);
          ops.pop();
        } else {
          while (ops.length && ops[ops.length - 1].t === 'op' && PREC[ops[ops.length - 1].v] >= PREC[t.v]) out.push(ops.pop());
          ops.push(t);
        }
      }
      while (ops.length) out.push(ops.pop());
      // Evaluación en orden postfijo.
      const st = [];
      for (const x of out) {
        if (typeof x === 'number') { st.push(x); continue; }
        if (x.t !== 'op') return { ok: false, error: 'Operación incompleta' };
        if (st.length < 2) return { ok: false, error: 'Operación incompleta' };
        const b = st.pop();
        const a = st.pop();
        if (x.v === '+') st.push(a + b);
        else if (x.v === '-') st.push(a - b);
        else if (x.v === '×') st.push(a * b);
        else {
          if (b === 0) return { ok: false, error: 'No se puede dividir entre cero' };
          st.push(a / b);
        }
      }
      if (st.length !== 1 || !Number.isFinite(st[0])) return { ok: false, error: 'Operación incompleta' };
      return { ok: true, value: round2(st[0]) };
    }

    /* Igual: calcula, guarda en el historial y deja el resultado listo para seguir o usar. */
    equals() {
      if (this.fresh) return this;
      this._flush();
      if (!this.tokens.length) return this;
      const expr = this.expression();
      const r = this.evaluate();
      if (!r.ok) { this.error = r.error; return this; }
      this.history.unshift({ expr, result: r.value });
      if (this.history.length > HISTORY_MAX) this.history.length = HISTORY_MAX;
      this.tokens = []; this.entry = ''; this.entryLabel = '';
      this._resultValue = r.value;
      this.fresh = true;
      return this;
    }

    /* Valor que se muestra en grande: lo que se escribe, o el resultado, o el último número. */
    display() {
      if (this.error) return this.error;
      if (this.entry !== '') return this.entry;
      if (this.fresh) return fmtNum(this._resultValue);
      const last = this.tokens[this.tokens.length - 1];
      if (last && last.t === 'n') return last.raw;
      return '0';
    }

    /* Cinta: la operación tal como se va escribiendo, con el origen de los números. */
    expression() {
      const parts = [];
      for (const t of this._withEntry()) {
        if (t.t === 'n') parts.push(t.label ? t.label + ' ' + t.raw : t.raw);
        else parts.push(t.t === 'op' ? t.v : t.t);
      }
      return parts.join(' ');
    }

    /* Resultado actual, si lo hay (para usarlo en una acción). */
    value() {
      if (this.fresh) return this._resultValue;
      const r = this.evaluate();
      return r.ok ? r.value : null;
    }

    last() { return this.history.length ? this.history[0].result : 0; }

    /* Fichas numéricas que el usuario ya cerró con un operador o un paréntesis (no las del número en curso). */
    snapshot() { return { tokens: clone(this.tokens), entry: this.entry, entryLabel: this.entryLabel }; }

    /* ---------- internos ---------- */

    _restart() {
      this.tokens = []; this.entry = ''; this.entryLabel = ''; this.fresh = false; this.error = '';
    }

    _flush() {
      if (this.entry === '' || this.entry === '-') return;
      const v = Number(this.entry);
      this.tokens.push({ t: 'n', raw: this.entry, v, label: this.entryLabel || '' });
      this.entry = ''; this.entryLabel = '';
    }

    /* Fichas, incluido el número en curso, para evaluar sin modificar el estado. */
    _closedTokens() {
      const list = clone(this.tokens);
      if (this.entry !== '' && this.entry !== '-') list.push({ t: 'n', raw: this.entry, v: Number(this.entry), label: this.entryLabel || '' });
      // Paréntesis sin cerrar: se cierran al calcular.
      let d = list.reduce((x, t) => (t.t === '(' ? x + 1 : t.t === ')' ? x - 1 : x), 0);
      while (d > 0) { list.push({ t: ')' }); d--; }
      // Un operador colgado al final se ignora.
      while (list.length && list[list.length - 1].t === 'op') list.pop();
      return list;
    }

    _withEntry() {
      const list = clone(this.tokens);
      if (this.entry !== '') list.push({ t: 'n', raw: this.entry, label: this.entryLabel || '' });
      return list;
    }
  }

  const api = { Calc, fmtNum, round2, PREC, HISTORY_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AbacoCalcEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
