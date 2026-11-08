/* Ábaco · detector de frases para la notificación rápida.
 *
 * Convierte lo que la persona escribe deprisa ("le debo 500 a Juan", "me pagaron la quincena 8 mil",
 * "recuérdame pagar la luz el viernes") en una intención y sus datos:
 *
 *   detect(texto, contexto) -> {
 *     intent: 'gasto' | 'ingreso' | 'debo' | 'me_deben' | 'abono' | 'cobro' | 'recordatorio' | 'lista' | null,
 *     amount, person, description, category, accountId, when, disburse,
 *     confidence (0..1), alternatives: [intenciones casi empatadas], missing: [datos que faltan]
 *   }
 *
 * Funciona con reglas (sin internet ni modelos): normaliza el texto, convierte números escritos con
 * letra ("mil quinientos", "2k"), puntúa cada intención por sus señales y extrae los datos.
 * El contexto aporta lo que la persona ya tiene: deudas y cobros abiertos (para reconocer nombres y
 * distinguir un abono de un gasto), cuentas, categorías y la hora actual.
 *
 * Las reglas viven en RULES para que el motor nativo (Kotlin) pueda leer las mismas.
 */
(function (root) {
  'use strict';

  const MAX = 10000000;

  /* ---------- reglas compartidas ---------- */

  // Cada señal es una expresión sobre el texto normalizado (minúsculas, sin acentos) y un peso.
  const RULES = {
    intents: {
      gasto: [
        ['\\b(gaste|gastamos|gaste en|pague|pagamos|compre|compramos|me cobraron|me costo|costo|salio en|se fue en|se fueron|se me fue|se me fueron|me gaste)\\b', 3],
        ['\\b(gasto|compra|pago de|cuenta de)\\b', 1.5]
      ],
      ingreso: [
        ['\\b(me pagaron|me depositaron|me transfirieron|me cayo|me cayeron|cayo|cayeron|recibi|vendi|gane|me dieron|cobre la|cobre mi|entro|entraron|me llego|me llegaron)\\b', 3],
        ['\\b(quincena|sueldo|nomina|aguinaldo|salario|ingreso|bono|comision|reembolso|freelance)\\b', 2]
      ],
      debo: [
        ['\\b(le debo|les debo|debo|me presto|me prestaron|me presta|pedi prestado|pedi un prestamo|me fiaron|quede a deber|me endeude)\\b', 4]
      ],
      me_deben: [
        ['\\b(me debe|me deben|le preste|les preste|le presto|les presto|preste|le di prestado|le fie|me queda a deber|me quedo a deber)\\b', 4]
      ],
      abono: [
        ['\\b(abone|le abone|le abono|les abono|abono a|abono|le pague a|les pague a|le pague|pague a|le di a|le di|le devolvi|le regrese|liquide)\\b', 3.5]
      ],
      cobro: [
        ['\\b(me pago|me deposito|me transfirio|me abono|me devolvio|me regreso|me repuso|me liquido|cobre a|le cobre)\\b', 3.5]
      ],
      recordatorio: [
        ['\\b(recuerdame|recordarme|recordar|acuerdame|acordarme|no olvidar|no olvides|no se me olvide|avisame|recordatorio|pendiente de)\\b', 5]
      ],
      lista: [
        ['\\b(hay que comprar|necesito comprar|falta comprar|comprar|se acabo|se acabaron|falta|faltan|apunta|anota en la lista|a la lista|lista)\\b', 3]
      ]
    },
    // Palabras que nunca son parte del concepto ni del nombre.
    filler: ['de', 'del', 'en', 'por', 'para', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'al', 'a', 'y', 'que', 'me', 'le', 'les', 'lo', 'mi', 'mis', 'con', 'pesos', 'peso', 'varos', 'baros', 'lana', 'mxn', 'hoy', 'ayer', 'ya'],
    categories: {
      comida: ['taco', 'tacos', 'cafe', 'comida', 'super', 'pan', 'torta', 'tortas', 'pizza', 'restaurante', 'cena', 'desayuno', 'antojo', 'despensa', 'mercado', 'tamal', 'tamales', 'elote', 'refresco', 'cerveza', 'cervezas', 'helado', 'hamburguesa', 'sushi', 'pollo', 'tortillas', 'oxxo', 'walmart', 'soriana', 'chedraui', 'costco', 'comidas', 'almuerzo', 'lonche', 'botana', 'rappi', 'uber eats', 'didi food'],
      transporte: ['uber', 'taxi', 'metro', 'pasaje', 'gasolina', 'camion', 'didi', 'estacionamiento', 'caseta', 'metrobus', 'combi', 'micro', 'peaje', 'gas del carro', 'vuelo', 'autobus'],
      hogar: ['luz', 'agua', 'gas', 'renta', 'internet', 'limpieza', 'cfe', 'telmex', 'izzi', 'totalplay', 'predial', 'mantenimiento'],
      ocio: ['cine', 'bar', 'fiesta', 'concierto', 'juego', 'boletos', 'netflix', 'spotify', 'videojuego', 'antro', 'teatro'],
      salud: ['farmacia', 'doctor', 'medicina', 'medicinas', 'consulta', 'dentista', 'hospital', 'analisis', 'lentes']
    },
    incomeTypes: {
      sueldo: ['quincena', 'sueldo', 'nomina', 'salario', 'aguinaldo', 'bono'],
      venta: ['vendi', 'venta'],
      extra: ['freelance', 'comision', 'propinas', 'chamba', 'proyecto']
    }
  };

  const COMPILED = Object.fromEntries(Object.entries(RULES.intents).map(([k, list]) => [k, list.map(([re, w]) => [new RegExp(re), w])]));
  const FILLER = new Set(RULES.filler);

  /* ---------- normalización ---------- */

  function fold(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /* ---------- números escritos con letra ---------- */

  const UNITS = {
    cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
    diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
    veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
    veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
    treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
    cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
    quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700,
    ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900
  };

  /* Lee una secuencia de palabras numéricas desde i. Devuelve { value, end } o null.
   * "un", "una" y "uno" solos no cuentan (son artículos: "un taco"); sí cuentan antes de "mil". */
  function readWords(tokens, i) {
    let total = 0;
    let current = 0;
    let j = i;
    let used = 0;
    let lastWasNumber = false;
    while (j < tokens.length) {
      const t = tokens[j];
      if (t === 'y' && lastWasNumber && j + 1 < tokens.length && ((UNITS[tokens[j + 1]] != null && UNITS[tokens[j + 1]] < 10) || tokens[j + 1] === 'medio')) { j++; lastWasNumber = false; continue; }
      if (t === 'mil') { total += (current || 1) * 1000; current = 0; j++; used++; lastWasNumber = true; continue; }
      if (t === 'millon' || t === 'millones') { total = (total + (current || 1)) * 1000000; current = 0; j++; used++; lastWasNumber = true; continue; }
      if (t === 'medio' && used && tokens[j - 1] === 'y') { if (tokens[j - 2] === 'mil') total += 500; else current += 0.5; j++; used++; continue; }
      const v = UNITS[t];
      if (v == null) break;
      current += v;
      j++; used++; lastWasNumber = true;
    }
    if (!used) return null;
    // Un artículo suelto ("un", "una", "uno") no es un monto.
    if (used === 1 && /^(un|una|uno)$/.test(tokens[i])) return null;
    if (tokens[j - 1] === 'y') j--;
    return { value: total + current, end: j };
  }

  /* ---------- montos con dígitos ---------- */

  function digitsValue(raw) {
    let n = raw.replace(/[.,]+$/, '');
    if (n.includes(',') && n.includes('.')) n = n.replace(/,/g, '');
    else if (n.includes(',')) {
      const parts = n.split(',');
      n = parts.length === 2 && parts[1].length !== 3 ? parts[0] + '.' + parts[1] : parts.join('');
    } else if ((n.match(/\./g) || []).length > 1) n = n.replace(/\./g, '');
    else if (/^\d{1,3}\.\d{3}$/.test(n)) n = n.replace('.', '');
    return Number(n);
  }

  /* ---------- fechas y horas ---------- */

  const WEEKDAYS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
  const MONTHS = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };

  function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function addDays(ms, n) { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }

  /* Busca en el texto normalizado expresiones de fecha y hora. Marca los tokens usados.
   * future=true para recordatorios y vencimientos; false para gastos e ingresos (miran al pasado). */
  function readWhen(tokens, used, now, future) {
    let day = null;      // inicio del día elegido (ms)
    let hour = null;     // hora y minuto elegidos
    let minute = 0;
    let relative = null; // "en 2 horas"
    const mark = (a, b) => { for (let k = a; k < b; k++) used[k] = true; };
    const today = startOfDay(now);
    for (let i = 0; i < tokens.length; i++) {
      if (used[i]) continue;
      const t = tokens[i];
      const n1 = tokens[i + 1];
      const n2 = tokens[i + 2];
      if (t === 'hoy') { day = today; mark(i, i + 1); continue; }
      if (t === 'ayer') { day = addDays(today, -1); mark(i, i + 1); continue; }
      if (t === 'antier' || t === 'anteayer') { day = addDays(today, -2); mark(i, i + 1); continue; }
      if (t === 'pasado' && n1 === 'manana') { day = addDays(today, 2); mark(i, i + 2); continue; }
      if (t === 'manana' && !(tokens[i - 1] === 'la' && (tokens[i - 2] === 'en' || tokens[i - 2] === 'de' || tokens[i - 2] === 'por'))) {
        day = addDays(today, 1); mark(i, i + 1); continue;
      }
      if ((t === 'en' || t === 'por' || t === 'de') && n1 === 'la' && (n2 === 'manana' || n2 === 'tarde' || n2 === 'noche')) {
        if (hour == null) hour = n2 === 'manana' ? 9 : n2 === 'tarde' ? 16 : 20;
        else if (n2 !== 'manana' && hour < 12) hour += 12;
        mark(i, i + 3); continue;
      }
      if (t === 'mediodia' || (t === 'al' && n1 === 'mediodia')) { hour = 12; minute = 0; mark(i, t === 'al' ? i + 2 : i + 1); continue; }
      if (WEEKDAYS[t] != null || (t === 'el' && WEEKDAYS[n1] != null)) {
        const name = WEEKDAYS[t] != null ? t : n1;
        const target = WEEKDAYS[name];
        const cur = new Date(today).getDay();
        let delta = target - cur;
        if (future) { if (delta <= 0) delta += 7; } else if (delta > 0) delta -= 7;
        if (tokens[i + (t === 'el' ? 2 : 1)] === 'que' && tokens[i + (t === 'el' ? 3 : 2)] === 'viene') { if (delta <= 0) delta += 7; mark(i, i + (t === 'el' ? 4 : 3)); }
        else mark(i, t === 'el' ? i + 2 : i + 1);
        day = addDays(today, delta);
        continue;
      }
      // "en 2 horas", "en 30 minutos", "en media hora", "en una hora"
      if (t === 'en') {
        const q = /^\d+$/.test(n1 || '') ? Number(n1) : (n1 === 'media' ? 0.5 : (UNITS[n1] != null ? UNITS[n1] : null));
        if (q != null && /^(hora|horas|minuto|minutos|min|hr|hrs|dia|dias)$/.test(n2 || '')) {
          relative = /^dia/.test(n2) ? q * 86400000 : /^(hora|hr)/.test(n2) ? q * 3600000 : q * 60000;
          mark(i, i + 3); continue;
        }
      }
      // "a las 6", "a las 6:30", "a las 6 pm", "a la 1", "6pm"
      if (t === 'a' && (n1 === 'las' || n1 === 'la')) {
        const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(n2 || '');
        const w = m ? null : readWords(tokens, i + 2);
        if (m || w) {
          let h = m ? Number(m[1]) : w.value;
          let end = m ? i + 3 : w.end;
          const mm = m && m[2] ? Number(m[2]) : 0;
          let ampm = m && m[3];
          if (!ampm && /^(am|pm)$/.test(tokens[end] || '')) { ampm = tokens[end]; end++; }
          if (!ampm && tokens[end] === 'de' && tokens[end + 1] === 'la' && /^(manana|tarde|noche)$/.test(tokens[end + 2] || '')) {
            ampm = tokens[end + 2] === 'manana' ? 'am' : 'pm'; end += 3;
          }
          if (h >= 0 && h <= 23 && mm < 60) {
            if (ampm === 'pm' && h < 12) h += 12;
            else if (ampm === 'am' && h === 12) h = 0;
            else if (!ampm && h >= 1 && h <= 7) h += 12; // "a las 6" casi siempre es de la tarde
            hour = h; minute = mm;
            mark(i, end); continue;
          }
        }
      }
      { const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(t);
        if (m) { let h = Number(m[1]); if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0; hour = h; minute = m[2] ? Number(m[2]) : 0; mark(i, i + 1); continue; } }
      // "15 de marzo", "el 15 de marzo", "el 15", "15/03"
      { const k = t === 'el' ? i + 1 : i;
        const dn = /^\d{1,2}$/.test(tokens[k] || '') ? Number(tokens[k]) : null;
        if (dn && dn >= 1 && dn <= 31) {
          const monthName = tokens[k + 1] === 'de' ? tokens[k + 2] : null;
          if (monthName && MONTHS[monthName] != null) {
            const d = new Date(today); d.setDate(1); d.setMonth(MONTHS[monthName]); d.setDate(dn);
            let ms = d.getTime();
            if (future && ms < today) { const d2 = new Date(ms); d2.setFullYear(d2.getFullYear() + 1); ms = d2.getTime(); }
            if (!future && ms > today) { const d2 = new Date(ms); d2.setFullYear(d2.getFullYear() - 1); ms = d2.getTime(); }
            day = ms; mark(i, k + 3); continue;
          }
          if (t === 'el') {
            const d = new Date(today); d.setDate(dn);
            let ms = d.getTime();
            if (future && ms < today) { const d2 = new Date(today); d2.setDate(1); d2.setMonth(d2.getMonth() + 1); d2.setDate(dn); ms = d2.getTime(); }
            if (!future && ms > today) { const d2 = new Date(today); d2.setDate(1); d2.setMonth(d2.getMonth() - 1); d2.setDate(dn); ms = d2.getTime(); }
            day = ms; mark(i, k + 1); continue;
          }
        }
        const sl = /^(\d{1,2})\/(\d{1,2})$/.exec(t);
        if (sl) {
          const d = new Date(today); d.setDate(1); d.setMonth(Number(sl[2]) - 1); d.setDate(Number(sl[1]));
          day = d.getTime(); mark(i, i + 1); continue;
        }
      }
    }
    if (relative != null) return { when: now + relative, hasDay: true, hasTime: true };
    if (day == null && hour == null) return null;
    let base = day == null ? today : day;
    if (hour == null && future) hour = 9; // un recordatorio con día pero sin hora suena a las 9:00
    if (hour == null && !future) { const n = new Date(now); hour = n.getHours(); minute = n.getMinutes(); } // "ayer": a esta misma hora
    if (hour != null) {
      const d = new Date(base); d.setHours(hour, minute, 0, 0);
      base = d.getTime();
      if (day == null && future && base <= now) base = addDays(base, 1);
    }
    return { when: base, hasDay: day != null, hasTime: hour != null };
  }

  /* ---------- tokenización ---------- */

  /* Separa el texto en palabras manteniendo la forma original de cada una (para nombres y conceptos). */
  function tokenize(text) {
    const orig = [];
    const norm = [];
    const re = /\d{1,2}\/\d{1,2}(?!\d)|(?:\$\s?)?\d[\d.,]*(?:\s?k\b)?(?::\d{2})?(?:am|pm)?|[\p{L}\p{N}/]+/giu;
    let m;
    const src = String(text == null ? '' : text);
    while ((m = re.exec(src))) {
      const o = m[0].replace(/^\$\s?/, '$');
      orig.push(o);
      norm.push(fold(o));
    }
    return { orig, norm };
  }

  /* Monto: prefiere el que trae "$" o "k"; si no, el número más grande que no sea fecha ni hora. */
  function readAmount(tokens, used) {
    const found = [];
    for (let i = 0; i < tokens.length; i++) {
      if (used[i]) continue;
      const t = tokens[i];
      const m = /^(\$)?\s?(\d[\d.,]*)\s?(k)?$/.exec(t);
      if (m) {
        let v = digitsValue(m[2]);
        let end = i + 1;
        let mark = Boolean(m[1]);
        if (m[3]) { v *= 1000; mark = true; }
        else if (tokens[i + 1] === 'k' || tokens[i + 1] === 'mil') { v *= 1000; end = i + 2; mark = true; }
        else if (tokens[i + 1] === 'millones' || tokens[i + 1] === 'millon') { v *= 1000000; end = i + 2; }
        if (/^(pesos|peso|varos|baros|mxn)$/.test(tokens[end] || '')) { mark = true; end++; }
        found.push({ value: v, start: i, end, mark });
        i = end - 1;
        continue;
      }
      const w = readWords(tokens, i);
      if (w) {
        let end = w.end;
        let mark = false;
        if (/^(pesos|peso|varos|baros|mxn)$/.test(tokens[end] || '')) { mark = true; end++; }
        // "dos tacos": un número pequeño seguido de una cosa es una cantidad, no un monto.
        found.push({ value: w.value, start: i, end, mark, words: true });
        i = end - 1;
      }
    }
    if (!found.length) return null;
    const pool = found.some((f) => f.mark) ? found.filter((f) => f.mark) : found;
    const best = pool.reduce((a, b) => (b.value > a.value ? b : a));
    for (let k = best.start; k < best.end; k++) used[k] = true;
    const amount = Math.round(best.value * 100) / 100;
    return amount > 0 && amount <= MAX ? amount : null;
  }

  /* ---------- personas ---------- */

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* Busca un nombre conocido (deudas y cobros abiertos) dentro del texto. */
  function knownPerson(norm, people) {
    const text = ' ' + norm.join(' ') + ' ';
    let best = null;
    for (const p of people || []) {
      const name = fold(p.name || p).trim();
      if (!name) continue;
      // Nombre completo, o una palabra del nombre que no sea parentesco ("Beto" por "mi primo Beto").
      let hit = 0;
      let words = null;
      if (text.includes(' ' + name + ' ')) { hit = name.length + 100; words = name.split(/\s+/); }
      else {
        for (const w of name.split(/\s+/)) {
          if (w.length > 2 && !KIN.has(w) && !STOP_NAME.has(w) && text.includes(' ' + w + ' ') && w.length > hit) { hit = w.length; words = [w]; }
        }
      }
      if (hit && (!best || hit > best.score)) best = { score: hit, entry: p, words };
    }
    return best;
  }

  const STOP_NAME = new Set(['por', 'para', 'de', 'del', 'en', 'el', 'la', 'los', 'las', 'que', 'y', 'con', 'desde', 'hasta', 'hoy', 'ayer', 'manana', 'pesos', 'varos', 'lana', 'porque', 'pero', 'cuando', 'a', 'al', 'me', 'le', 'se']);
  const KIN = new Set(['mi', 'mis', 'tu', 'su', 'don', 'dona', 'tia', 'tio', 'primo', 'prima', 'hermano', 'hermana', 'mama', 'papa', 'jefe', 'jefa', 'compa', 'amigo', 'amiga', 'abuela', 'abuelo', 'suegra', 'suegro', 'cunado', 'cunada', 'novio', 'novia', 'vecino', 'vecina', 'senor', 'senora']);

  /* Toma hasta 3 palabras a partir de i que parezcan un nombre ("Juan", "mi primo Beto", "doña Rosa"). */
  function nameFrom(tokens, orig, used, i) {
    const out = [];
    let j = i;
    while (j < tokens.length && out.length < 3) {
      const t = tokens[j];
      if (used[j] || STOP_NAME.has(t) || /\d/.test(t) || UNITS[t] != null) break;
      if (out.length && !KIN.has(tokens[j - 1]) && !/^\p{Lu}/u.test(orig[j])) break;
      out.push(j);
      j++;
      if (!KIN.has(t) && out.length >= 1 && !/^\p{Lu}/u.test(orig[j] || '')) break;
    }
    // "mi" solo no es un nombre.
    if (!out.length || (out.length === 1 && KIN.has(tokens[out[0]]) && /^(mi|mis|tu|su)$/.test(tokens[out[0]]))) return null;
    return out;
  }

  function readPerson(norm, orig, used, intent, people) {
    const known = knownPerson(norm, people);
    if (known) {
      for (let i = 0; i <= norm.length - known.words.length; i++) {
        if (known.words.every((w, k) => norm[i + k] === w)) { for (let k = 0; k < known.words.length; k++) used[i + k] = true; break; }
      }
      return { name: known.entry.name || known.entry, entry: known.entry };
    }
    const take = (idx) => { idx.forEach((k) => { used[k] = true; }); return cap(idx.map((k) => orig[k]).join(' ')); };
    // Sujeto antes de "me": "Juan me prestó", "mi primo me debe".
    for (let i = 1; i < norm.length; i++) {
      if (norm[i] === 'me' && /^(presto|prestaron|presta|debe|deben|pago|abono|devolvio|regreso|fio|liquido|repuso|queda|quedo)$/.test(norm[i + 1] || '')) {
        let s = i - 1;
        while (s > 0 && !used[s - 1] && (KIN.has(norm[s - 1]) || /^\p{Lu}/u.test(orig[s])) && !STOP_NAME.has(norm[s - 1]) && i - s < 3) s--;
        const idx = nameFrom(norm, orig, used, s);
        if (idx && idx[idx.length - 1] < i) return { name: take(idx) };
      }
    }
    // Objeto después de "a", "de" o "con", o tras el verbo: "le debo a Juan", "le presté a Ana", "me prestó Pedro".
    for (let i = 0; i < norm.length; i++) {
      if (used[i]) continue;
      const t = norm[i];
      if (t === 'a' || t === 'al' || (t === 'de' && intent === 'debo') || (t === 'con' && intent === 'debo')) {
        const idx = nameFrom(norm, orig, used, i + 1);
        if (idx) { used[i] = true; return { name: take(idx) }; }
      }
    }
    for (let i = 0; i < norm.length - 1; i++) {
      if (/^(presto|pago|abono|debe|devolvio|regreso)$/.test(norm[i]) && norm[i - 1] === 'me') {
        let j = i + 1;
        while (j < norm.length && used[j]) j++;
        const idx = nameFrom(norm, orig, used, j);
        if (idx) return { name: take(idx) };
      }
    }
    return null;
  }

  /* ---------- categoría, cuenta y concepto ---------- */

  function guessCategory(description, categories) {
    const d = ' ' + fold(description).replace(/[^\p{L}\p{N} ]/gu, ' ') + ' ';
    const cats = categories || [];
    if (!d.trim()) return 'general';
    const byName = cats.find((c) => c && c.name && fold(c.name).trim() && d.includes(fold(c.name).trim()));
    if (byName) return byName.id;
    for (const [cat, words] of Object.entries(RULES.categories)) {
      if (words.some((w) => d.includes(' ' + w + ' ') || d.includes(' ' + w + 's ')) && cats.some((c) => c.id === cat)) return cat;
    }
    return 'general';
  }

  function incomeType(norm) {
    for (const [type, words] of Object.entries(RULES.incomeTypes)) if (words.some((w) => norm.includes(w))) return type;
    return 'otro';
  }

  /* Una cuenta por su nombre ("con BBVA", "en efectivo"), o la primera tarjeta si dice "con tarjeta". */
  function readAccount(norm, used, accounts) {
    const text = norm.join(' ');
    let best = null;
    for (const a of accounts || []) {
      const name = fold(a.name).trim();
      if (name && (' ' + text + ' ').includes(' ' + name + ' ') && (!best || name.length > fold(best.name).length)) best = a;
    }
    if (best) {
      const words = fold(best.name).trim().split(/\s+/);
      for (let i = 0; i <= norm.length - words.length; i++) {
        if (words.every((w, k) => norm[i + k] === w)) {
          for (let k = 0; k < words.length; k++) used[i + k] = true;
          if (/^(con|en|de|desde)$/.test(norm[i - 1] || '')) used[i - 1] = true;
          if (/^(la|el|mi)$/.test(norm[i - 1] || '') && /^(con|en|de|desde)$/.test(norm[i - 2] || '')) { used[i - 1] = true; used[i - 2] = true; }
        }
      }
      return best.id;
    }
    return undefined;
  }

  function cleanConcept(orig, norm, used) {
    const words = [];
    for (let i = 0; i < norm.length; i++) if (!used[i]) words.push(i);
    // Recorta palabras de relleno al principio y al final ("por la pizza" -> "pizza").
    while (words.length && FILLER.has(norm[words[0]])) words.shift();
    while (words.length && FILLER.has(norm[words[words.length - 1]])) words.pop();
    return words.map((i) => orig[i]).join(' ').replace(/\s+/g, ' ').trim();
  }

  /* ---------- puntuación de intenciones ---------- */

  function scoreIntents(text) {
    const scores = {};
    const cues = {};
    for (const [intent, list] of Object.entries(COMPILED)) {
      let s = 0;
      for (const [re, w] of list) {
        const m = re.exec(text);
        if (m) { s += w; if (w >= 3) (cues[intent] = cues[intent] || []).push(m[0]); }
      }
      if (s) scores[intent] = s;
    }
    return { scores, cues };
  }

  /* Palabras de las señales que no deben quedar en el concepto. */
  function markCues(norm, used, cueTexts) {
    for (const cue of cueTexts) {
      const words = cue.split(/\s+/);
      for (let i = 0; i <= norm.length - words.length; i++) {
        if (!used[i] && words.every((w, k) => norm[i + k] === w)) { for (let k = 0; k < words.length; k++) used[i + k] = true; break; }
      }
    }
  }

  /* ---------- detección ---------- */

  function detect(text, ctx) {
    const c = ctx || {};
    const now = Number(c.now) || Date.now();
    const loans = (c.loans || []).filter((l) => !(l.current <= 0));
    const debtors = (c.debtors || []).filter((d) => !d.settled);
    const people = [...loans.map((l) => ({ name: l.name, kind: 'loan', id: l.id })), ...debtors.map((d) => ({ name: d.person, kind: 'debtor', id: d.id }))];
    const { orig, norm } = tokenize(text);
    const flat = ' ' + norm.join(' ') + ' ';
    const used = norm.map(() => false);
    const out = { intent: null, amount: null, person: null, description: '', category: null, accountId: undefined, when: null, disburse: false, confidence: 0, alternatives: [], missing: [], text: String(text == null ? '' : text).trim() };
    if (!norm.length) return out;

    let { scores, cues } = scoreIntents(flat);

    // Ajustes por contexto.
    const known = knownPerson(norm, people);
    if (scores.abono && !(known && known.entry.kind === 'loan')) {
      // "le pagué 200 a Juan" sin deuda con Juan es un gasto; "le di a Juan" sin deuda, también.
      scores.gasto = (scores.gasto || 0) + scores.abono - 0.5;
      delete scores.abono;
    }
    if (scores.cobro && !(known && known.entry.kind === 'debtor')) {
      // "me pagó Juan" sin cobro abierto con Juan es un ingreso.
      scores.ingreso = (scores.ingreso || 0) + scores.cobro - 0.5;
      delete scores.cobro;
    }
    if (scores.abono) scores.abono += 1.5;
    if (scores.cobro) scores.cobro += 1.5;
    if (known && known.entry.kind === 'loan' && scores.gasto && /\b(pague|di|deposite|transferi)\b/.test(flat) && !scores.abono) scores.abono = scores.gasto + 1;
    if (known && known.entry.kind === 'debtor' && scores.ingreso && /\b(pago|pagaron|deposito|transfirio|dio)\b/.test(flat) && !scores.cobro) scores.cobro = scores.ingreso + 1;
    // "me prestó" y "me debe" compiten con "debo"/"me deben" por "debe"/"presto": gana el más específico.
    if (scores.me_deben && /\bme (debe|deben)\b/.test(flat) && scores.debo && !/\b(le debo|les debo|debo)\b/.test(flat.replace(/\bme debe\b/g, ''))) delete scores.debo;
    if (scores.debo && /\bme (presto|prestaron|presta)\b/.test(flat) && scores.me_deben && !/\b(le preste|les preste)\b/.test(flat)) delete scores.me_deben;
    // "comprar" en pasado ("compré") es gasto, no lista; con monto y verbo de pago, también.
    if (scores.lista && scores.gasto) scores.lista -= 2;
    // Un recordatorio puede mencionar "pagar" o "comprar": manda el recordatorio.
    if (scores.recordatorio) { delete scores.lista; if (scores.gasto) scores.gasto -= 2; }

    const whenInfo = readWhen(norm, used, now, !!scores.recordatorio);
    out.when = whenInfo ? whenInfo.when : null;
    if (scores.recordatorio && out.when == null) {
      // Sin fecha: a las 9:00 de hoy si aún no pasan, si no, mañana.
      const d = new Date(now); d.setHours(9, 0, 0, 0);
      out.when = d.getTime() > now ? d.getTime() : addDays(d.getTime(), 1);
    }
    out.accountId = readAccount(norm, used, c.accounts);
    const hadNumber = norm.some((t, i) => !used[i] && /\d/.test(t));
    out.amount = readAmount(norm, used);

    if (out.amount && !Object.keys(scores).length) scores.gasto = 1; // solo un monto: es un gasto
    if (!out.amount) {
      // Sin monto, lo financiero pierde fuerza frente a recordatorio y lista.
      for (const k of ['gasto', 'ingreso', 'debo', 'me_deben']) if (scores[k]) scores[k] -= 1;
      if (scores.lista != null && !scores.recordatorio) scores.lista += 1;
    }

    if (!out.amount && hadNumber && !Object.values(scores).some((v) => v > 0)) scores.gasto = 0.5; // "0 nada": un monto que no sirve
    const ranked = Object.entries(scores).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return out;
    const [top, topScore] = ranked[0];
    out.intent = top;
    const second = ranked[1] ? ranked[1][1] : 0;
    out.confidence = Math.round(Math.min(1, (topScore / (topScore + second + 1)) + (topScore >= 3 ? 0.25 : 0)) * 100) / 100;
    out.alternatives = ranked.slice(1).filter(([, v]) => topScore - v < 1).map(([k]) => k);

    markCues(norm, used, cues[top] || []);
    // En un recordatorio, "comprar" o "pagar" son parte de lo que hay que recordar.
    if (top !== 'recordatorio') for (const k of Object.keys(cues)) if (k !== top) markCues(norm, used, cues[k]);

    if (['debo', 'me_deben', 'abono', 'cobro'].includes(top)) {
      const p = readPerson(norm, orig, used, top, people);
      if (p) {
        out.person = p.entry ? p.entry.name : p.name;
        if (p.entry) out.targetId = p.entry.id;
      }
    }
    if (top === 'debo') out.disburse = /\b(me presto|me prestaron|me presta|pedi prestado|pedi un prestamo)\b/.test(flat);

    out.description = cleanConcept(orig, norm, used);
    if (top === 'gasto') out.category = guessCategory(out.description, c.categories);
    if (top === 'ingreso') out.incomeType = incomeType(flat);
    if (top === 'recordatorio' || top === 'lista') out.description = cap(out.description);

    // Datos indispensables para guardar.
    if (['gasto', 'ingreso', 'debo', 'me_deben', 'abono', 'cobro'].includes(top) && !out.amount) {
      if (!((top === 'abono' || top === 'cobro') && out.targetId)) out.missing.push('amount');
    }
    if ((top === 'me_deben' || top === 'debo') && !out.person) out.missing.push('person');
    if ((top === 'recordatorio' || top === 'lista') && !out.description) out.missing.push('description');
    return out;
  }

  /* Resumen corto para la notificación y los avisos: "Gasto · $85 · Comida". */
  function summary(r) {
    if (!r || !r.intent) return '';
    const money = (n) => '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 });
    const label = { gasto: 'Gasto', ingreso: 'Ingreso', debo: 'Le debes', me_deben: 'Te debe', abono: 'Abono', cobro: 'Te pagó', recordatorio: 'Recordatorio', lista: 'Por comprar' }[r.intent];
    const parts = [label];
    if (r.person) {
      if (r.intent === 'debo') parts[0] = 'Le debes a ' + r.person;
      else if (r.intent === 'abono') parts[0] = 'Abono a ' + r.person;
      else if (r.intent === 'me_deben') parts[0] = r.person + ' te debe';
      else if (r.intent === 'cobro') parts[0] = r.person + ' te pagó';
    }
    if (r.amount) parts.push(money(r.amount));
    if (r.description && !['recordatorio', 'lista'].includes(r.intent)) parts.push(r.description);
    if (['recordatorio', 'lista'].includes(r.intent) && r.description) parts.push(r.description);
    return parts.join(' · ');
  }

  const api = { detect, summary, guessCategory, tokenize, readWords, fold, RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') root.AbacoIntent = api;
})(typeof window !== 'undefined' ? window : globalThis);
