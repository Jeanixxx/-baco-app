/* Ábaco · cielo del día.
 *
 * El fondo de la app sigue la hora real: amanecer, mañana, tarde, atardecer y noche.
 * El sol cruza la pantalla de izquierda a derecha entre las 6:00 y las 18:30 (en México la noche
 * empieza más o menos a esa hora); después entra la luna por la derecha y cruza hasta las 6:00.
 * De noche aparecen las estrellas. Al inclinar el teléfono, el sol, la luna y las estrellas se
 * desplazan un poco hacia los lados (paralaje), como si el cielo estuviera detrás de la pantalla.
 *
 * Dos partes:
 *  - Funciones puras (skyAt, momentoAt, saludoAt...): no tocan el documento, se prueban en Node.
 *  - init(): instala la capa de cielo, pone el tema (claro/oscuro) según la hora y se
 *    actualiza cada minuto.
 *
 * Para revisar una hora concreta sin esperar: abrir la app con ?hora=19 (o 19.5), o poner
 * window.__abacoHour = 19 en la consola. No hay control visible para esto.
 */
(function (root) {
  'use strict';

  const SUNRISE = 6;
  const SUNSET = 18.5;

  /* Colores del cielo por hora (0 a 24). Entre dos hileras se mezclan en línea recta. */
  const STOPS = [
    { h: 0, top: '#070B1F', mid: '#111838', bot: '#2A2F62' },
    { h: 5.5, top: '#2B3A67', mid: '#7A6A9A', bot: '#F5B88A' },
    { h: 7, top: '#9FD3F0', mid: '#CFE8F5', bot: '#FFF4E0' },
    { h: 12, top: '#8CC8EC', mid: '#CFE8F5', bot: '#FBE3B8' },
    { h: 17, top: '#5C7DB8', mid: '#F4C48F', bot: '#FFD38A' },
    { h: 18.5, top: '#22305C', mid: '#5E4A7A', bot: '#C9806A' },
    { h: 19.5, top: '#111838', mid: '#1E2552', bot: '#2A2F62' },
    { h: 24, top: '#070B1F', mid: '#111838', bot: '#2A2F62' }
  ];

  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.substr(i, 2), 16));

  /* Luminancia relativa (0 negro, 1 blanco). */
  function luminance(c) {
    const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    const [r, g, b] = hex(c);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  function mixHex(a, b, k) {
    const A = hex(a);
    const B = hex(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('');
  }

  /* Normaliza cualquier número a una hora entre 0 y 24. */
  function normHour(h) {
    const n = Number(h);
    if (!Number.isFinite(n)) return 12;
    return clamp(n, 0, 24);
  }

  function isNight(h) {
    const t = normHour(h);
    return t >= SUNSET || t < SUNRISE;
  }

  function momentoAt(h) {
    const t = normHour(h);
    if (t < 6) return 'Madrugada';
    if (t < 12) return 'Mañana';
    if (t < 17) return 'Tarde';
    if (t < SUNSET) return 'Atardecer';
    return 'Noche';
  }

  function saludoAt(h) {
    const t = normHour(h);
    if (t < 12) return 'Buenos días';
    if (t < SUNSET) return 'Buenas tardes';
    return 'Buenas noches';
  }

  function skyColors(h) {
    const t = normHour(h);
    for (let i = 0; i < STOPS.length - 1; i++) {
      const a = STOPS[i];
      const b = STOPS[i + 1];
      if (t >= a.h && t <= b.h) {
        const k = (t - a.h) / (b.h - a.h);
        return { top: mixHex(a.top, b.top, k), mid: mixHex(a.mid, b.mid, k), bot: mixHex(a.bot, b.bot, k) };
      }
    }
    return { top: STOPS[0].top, mid: STOPS[0].mid, bot: STOPS[0].bot };
  }

  /* Todo lo que hace falta para pintar el cielo a una hora dada.
   * Las posiciones del sol y la luna son fracciones de la pantalla (0 a 1). */
  function skyAt(h) {
    const t = normHour(h);
    const colors = skyColors(t);

    const dayFrac = (t - SUNRISE) / (SUNSET - SUNRISE);
    const sunUp = dayFrac >= 0 && dayFrac <= 1;
    const arc = sunUp ? Math.sin(Math.PI * dayFrac) : 0;
    const sun = {
      up: sunUp,
      x: sunUp ? 0.1 + dayFrac * 0.8 : -0.5,
      y: sunUp ? 0.56 - arc * 0.45 : 1.1,
      opacity: sunUp ? clamp(0.4 + arc * 1.6, 0, 1) : 0,
      core: mixHex('#FFFBE6', '#FF9F5A', 1 - arc),
      glow: mixHex('#FFE49A', '#FFB070', 1 - arc),
      halo: 'rgba(255,' + Math.round(200 - 60 * (1 - arc)) + ',120,' + (0.25 + 0.3 * arc).toFixed(2) + ')'
    };

    const night = isNight(t);
    const q = night ? clamp(((t - SUNSET + 24) % 24) / (24 - SUNSET + SUNRISE), 0, 1) : 0;
    const moonArc = Math.sin(Math.PI * q);
    const moon = {
      up: night,
      x: night ? 0.97 - q * 0.77 : 1.2,
      y: night ? 0.62 - moonArc * 0.45 : 1.1,
      opacity: night ? clamp(q * 6, 0, 1) : 0
    };

    return {
      h: t,
      top: colors.top,
      mid: colors.mid,
      bot: colors.bot,
      grad: 'linear-gradient(180deg,' + colors.top + ' 0%,' + colors.mid + ' 60%,' + colors.bot + ' 100%)',
      night,
      // El tema sigue lo oscuro que está el cielo donde van las tarjetas (no solo la hora):
      // así el texto siempre se lee, también al atardecer y al amanecer.
      theme: luminance(colors.mid) < 0.3 ? 'dark' : 'light',
      momento: momentoAt(t),
      saludo: saludoAt(t),
      sun,
      moon,
      stars: night ? clamp(0.4 + q, 0, 1) : 0
    };
  }

  /* Hora efectiva: la del reloj, salvo que se pida una (?hora=19 o __abacoHour). */
  function resolveHour(now, win) {
    const w = win || {};
    const forced = Number(w.__abacoHour);
    if (w.__abacoHour != null && Number.isFinite(forced)) return normHour(forced);
    try {
      const q = new URLSearchParams((w.location && w.location.search) || '').get('hora');
      if (q != null && q !== '' && Number.isFinite(Number(q))) return normHour(Number(q));
    } catch (e) { /* sin ?hora */ }
    const d = now instanceof Date ? now : new Date();
    return d.getHours() + d.getMinutes() / 60;
  }

  /* ---------- paralaje: inclinación del teléfono ---------- */

  /* gamma (inclinación izquierda-derecha, en grados) -> desplazamiento horizontal en píxeles. */
  const TILT_MAX = 28;
  function tiltOffset(gamma) {
    const g = Number(gamma);
    if (!Number.isFinite(g)) return 0;
    return Math.round((clamp(g, -30, 30) / 30) * TILT_MAX * 10) / 10;
  }

  /* ---------- parte con documento ---------- */

  const MODES = ['auto', 'light', 'dark'];
  const MODE_LABEL = { auto: 'Automático según la hora', light: 'Día', dark: 'Noche' };
  const FIXED_HOUR = { light: 12, dark: 0 };

  let env = null;

  function layerHtml() {
    return '<div class="sky-star" style="left:9%;top:14%;width:3px;height:3px"></div>'
      + '<div class="sky-star" style="left:77%;top:20%;width:2px;height:2px"></div>'
      + '<div class="sky-star" style="left:38%;top:10%;width:2px;height:2px"></div>'
      + '<div class="sky-star" style="left:64%;top:36%;width:3px;height:3px"></div>'
      + '<div class="sky-star" style="left:18%;top:42%;width:2px;height:2px"></div>'
      + '<div class="sky-sun-glow"></div><div class="sky-sun"></div>'
      + '<div class="sky-moon"></div>';
  }

  function ensureLayer(doc) {
    let layer = doc.getElementById('skyLayer');
    if (!layer) {
      layer = doc.createElement('div');
      layer.id = 'skyLayer';
      layer.setAttribute('aria-hidden', 'true');
      layer.innerHTML = layerHtml();
      doc.body.insertBefore(layer, doc.body.firstChild);
    }
    return layer;
  }

  function place(el, x, y) {
    if (!el) return;
    el.style.left = (x * 100).toFixed(2) + '%';
    el.style.top = (y * 100).toFixed(2) + '%';
  }

  function paint(state) {
    const { doc } = env;
    const rootEl = doc.documentElement;
    const layer = ensureLayer(doc);
    rootEl.style.setProperty('--sky-top', state.top);
    rootEl.style.setProperty('--sky-mid', state.mid);
    rootEl.style.setProperty('--sky-bot', state.bot);
    rootEl.style.setProperty('--sky-grad', state.grad);
    rootEl.setAttribute('data-theme', state.theme);
    rootEl.setAttribute('data-momento', state.momento.toLowerCase());

    layer.style.setProperty('--sun-core', state.sun.core);
    layer.style.setProperty('--sun-glow', state.sun.glow);
    layer.style.setProperty('--sun-halo', state.sun.halo);
    layer.style.setProperty('--sun-op', state.sun.opacity.toFixed(2));
    layer.style.setProperty('--moon-op', state.moon.opacity.toFixed(2));
    layer.style.setProperty('--stars-op', state.stars.toFixed(2));
    place(layer.querySelector('.sky-sun'), state.sun.x, state.sun.y);
    place(layer.querySelector('.sky-sun-glow'), state.sun.x, state.sun.y);
    place(layer.querySelector('.sky-moon'), state.moon.x, state.moon.y);
    // Las transiciones se activan después de la primera pintura para que el sol no "vuele" al abrir.
    if (!layer.classList.contains('ready')) env.win.requestAnimationFrame(() => layer.classList.add('ready'));

    const meta = doc.getElementById('metaThemeColor');
    if (meta) meta.setAttribute('content', state.top);
  }

  function current() { return env ? env.last : null; }

  /* Sigue la inclinación con suavidad: cada cuadro se acerca un poco al objetivo (sin saltos). */
  function startTilt(win, doc) {
    const reduce = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('DeviceOrientationEvent' in win)) return;
    env.tilt = { target: 0, x: 0, raf: 0 };
    const step = () => {
      const t = env.tilt;
      t.x += (t.target - t.x) * 0.12;
      if (Math.abs(t.target - t.x) < 0.05) t.x = t.target;
      const layer = doc.getElementById('skyLayer');
      if (layer) layer.style.setProperty('--tilt-x', t.x.toFixed(2) + 'px');
      t.raf = t.x === t.target ? 0 : win.requestAnimationFrame(step);
    };
    win.addEventListener('deviceorientation', (e) => {
      env.tilt.target = tiltOffset(e.gamma);
      if (!env.tilt.raf) env.tilt.raf = win.requestAnimationFrame(step);
    });
  }
  function tilt() { return env && env.tilt ? env.tilt.x : 0; }

  function refresh() {
    if (!env) return null;
    const real = resolveHour(new Date(), env.win);
    const effective = env.mode === 'auto' ? real : FIXED_HOUR[env.mode];
    const state = skyAt(effective);
    // El momento y el saludo siempre son los del reloj, aunque el tema se fije.
    state.momento = momentoAt(real);
    state.saludo = saludoAt(real);
    state.realHour = real;
    state.mode = env.mode;
    env.last = state;
    paint(state);
    try {
      env.win.dispatchEvent(new env.win.CustomEvent('abaco:sky', { detail: state }));
    } catch (e) { /* sin eventos personalizados */ }
    return state;
  }

  function getMode() { return env ? env.mode : 'auto'; }

  function setMode(mode) {
    if (!env) return null;
    env.mode = MODES.includes(mode) ? mode : 'auto';
    try { env.win.localStorage.setItem('theme_mode', env.mode); } catch (e) { /* sin almacenamiento */ }
    return refresh();
  }

  function cycleMode() {
    const next = MODES[(MODES.indexOf(getMode()) + 1) % MODES.length];
    setMode(next);
    return { mode: next, label: MODE_LABEL[next] };
  }

  function init(opts) {
    const o = opts || {};
    const win = o.win || root;
    const doc = o.doc || win.document;
    let mode = o.mode;
    if (!MODES.includes(mode)) {
      try { mode = win.localStorage.getItem('theme_mode'); } catch (e) { mode = null; }
    }
    env = { win, doc, mode: MODES.includes(mode) ? mode : 'auto', last: null, timer: null };
    refresh();
    // El sol avanza mientras la app está abierta; al volver a primer plano se pone al día.
    env.timer = win.setInterval(refresh, 60000);
    startTilt(win, doc);
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden) refresh(); });
    return env.last;
  }

  const api = {
    SUNRISE, SUNSET, STOPS, MODES, MODE_LABEL,
    mixHex, luminance, normHour, isNight, momentoAt, saludoAt, skyColors, skyAt, resolveHour, tiltOffset,
    init, refresh, current, getMode, setMode, cycleMode, tilt
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AbacoSky = api;
})(typeof window !== 'undefined' ? window : globalThis);
