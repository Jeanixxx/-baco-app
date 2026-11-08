/* Ábaco · tour de bienvenida (se puede saltar).
 *
 * Después de escribir el nombre, seis pasos cortos. Dos enseñan cómo se ve la app (Hoy y
 * Registrar) y cuatro recogen lo mínimo para que empiece a funcionar: cuánto dinero tienes,
 * cada cuánto te pagan, dos sobres y un pago fijo. Cada paso se puede saltar con "Ahora no";
 * "Saltar tour" termina en cualquier momento. Nada es obligatorio.
 *
 * Mientras el tour está abierto no se llama a updateUI (cerraría la bienvenida): solo se
 * sincroniza el estado; al terminar, finishWalletQuiz() muestra la app en Hoy.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = (id) => { const v = $(id) ? String($(id).value).replace(/[$,\s]/g, '') : ''; return v === '' ? null : Number(v); };

  const check = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>';
  const miniHoy =
    '<div class="tour-preview"><div class="tp-label">Solo tres cosas</div>' +
    '<div class="tp-row done"><span class="tp-check">' + check + '</span><span>Anotar lo que gastes hoy</span></div>' +
    '<div class="tp-row"><span class="tp-check"></span><span>Mañana se cobra tu streaming</span></div>' +
    '<div class="tp-row"><span class="tp-check"></span><span>Echar un ojo al sobre de comida</span></div></div>';
  const miniRegistrar =
    '<div class="tour-preview tp-reg"><div class="tp-tabs"><span class="on">Gasto</span><span>Ingreso</span></div>' +
    '<div class="tp-amount">$85</div><div class="tp-keys">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => '<span>' + k + '</span>').join('') + '</div>' +
    '<div class="tp-save">Guardar</div></div>';

  const field = (id, label, ph, type) =>
    '<label class="x-label" for="' + id + '">' + label + '</label><input type="' + (type || 'text') + '" id="' + id + '" ' +
    (type === 'text' ? '' : 'inputmode="decimal" ') + 'placeholder="' + esc(ph || '$0') + '" autocomplete="off">';

  const STEPS = [
    { id: 'hoy', title: 'Así funciona tu día', copy: 'Cada día te muestro solo tres cosas. Las palomeas y listo: nada más que revisar.', body: () => miniHoy },
    {
      id: 'dinero', title: '¿Cuánto tienes hoy?', copy: 'Con esto Ábaco empieza a funcionar. Lo puedes cambiar cuando quieras.', ask: true,
      body: () => field('tourCash', 'En efectivo') + field('tourBank', 'En tu cuenta de banco (débito)')
    },
    {
      id: 'pago', title: '¿Cada cuánto te pagan?', copy: 'Así te recuerdo anotar tu ingreso el día que te llega.', ask: true,
      body: () => '<div class="tour-chips" role="radiogroup" aria-label="Cada cuánto te pagan">' +
        [['quincenal', 'Cada quincena'], ['mensual', 'Cada mes'], ['semanal', 'Cada semana'], ['variable', 'Varía']]
          .map(([v, t]) => '<button type="button" class="tour-chip' + (tour.pay === v ? ' on' : '') + '" role="radio" aria-checked="' + (tour.pay === v) + '" data-tour-pay="' + v + '">' + t + '</button>').join('') +
        '</div>' + field('tourPayAmount', '¿Cuánto, más o menos? (opcional)')
    },
    {
      id: 'sobres', title: 'Aparta para lo de siempre', copy: 'Un sobre es lo que quieres gastar al mes en algo. Si se pasa, te aviso con calma.', ask: true,
      body: () => field('tourFood', 'Comida al mes') + field('tourTransport', 'Transporte al mes')
    },
    {
      id: 'fijos', title: '¿Pagas algo cada mes?', copy: 'Streaming, gimnasio, teléfono… Te lo recuerdo un día antes.', ask: true,
      body: () => field('tourSubName', 'Nombre', 'Streaming', 'text') + '<div class="tour-two"><div>' + field('tourSubAmount', 'Monto') + '</div><div>' + field('tourSubDay', 'Día de cobro', '15') + '</div></div>'
    },
    { id: 'anotar', title: 'Anota en un toque', copy: 'Escribes el monto y listo: gasto o ingreso, en el mismo lugar. En Android también puedes anotar desde la barra de notificaciones.', body: () => miniRegistrar }
  ];

  const tour = { step: 0, pay: null, busy: false };

  function paint(direction) {
    const s = STEPS[tour.step];
    const body = $('tourBody');
    const dots = $('tourDots');
    if (!body) return;
    if (dots) dots.innerHTML = STEPS.map((_, i) => '<span class="' + (i === tour.step ? 'on' : i < tour.step ? 'past' : '') + '"></span>').join('');
    body.innerHTML = '<h2>' + esc(s.title) + '</h2><p>' + esc(s.copy) + '</p><div class="tour-content">' + s.body() + '</div>';
    body.classList.remove('tour-in', 'tour-back');
    void body.offsetWidth; // reinicia la animación de entrada
    body.classList.add(direction === 'back' ? 'tour-back' : 'tour-in');
    const next = $('btnNextWalletQuiz');
    if (next) next.textContent = tour.step === STEPS.length - 1 ? 'Empezar' : 'Continuar';
    const later = $('btnTourLater');
    if (later) later.classList.toggle('hidden', !s.ask);
    const first = body.querySelector('input');
    if (first) setTimeout(() => { try { first.focus({ preventScroll: true }); } catch (e) { /* sin foco */ } }, 260);
  }

  function start() {
    tour.step = 0;
    tour.pay = null;
    paint();
  }

  const data = () => (window.AbacoApp ? AbacoApp.data() : null);

  /* Guarda lo que la persona escribió en el paso actual. Devuelve false si algo no es válido. */
  async function saveStep(id) {
    const d = data();
    if (!d) return true;
    if (id === 'dinero') {
      const pairs = [['tourCash', 'Efectivo', 'efectivo'], ['tourBank', 'Débito', 'débito']];
      for (const [input, name, type] of pairs) {
        const v = num(input);
        if (v === null) continue;
        if (!(v >= 0)) { toast('El monto no puede ser negativo'); return false; }
        const acc = (state.accounts || []).find((a) => a.name === name);
        const r = acc ? await d.adjustAccount(acc.id, v) : await d.addAccount({ name, type, balance: v });
        if (!r.ok) { toast(r.error); return false; }
      }
    } else if (id === 'pago') {
      const amount = num('tourPayAmount');
      if (tour.pay || amount) {
        const e = window.AbacoExtrasUI ? AbacoExtrasUI.extras() : null;
        if (e) e.profile = { payFreq: tour.pay || 'variable', payAmount: amount > 0 ? amount : null };
      }
    } else if (id === 'sobres') {
      for (const [input, cat] of [['tourFood', 'comida'], ['tourTransport', 'transporte']]) {
        const v = num(input);
        if (v === null) continue;
        if (!(v > 0)) { toast('Escribe un monto mayor que cero o déjalo vacío'); return false; }
        const r = await d.setBudget({ category: cat, amount: v, description: '' });
        if (!r.ok) { toast(r.error); return false; }
      }
    } else if (id === 'fijos') {
      const name = ($('tourSubName') && $('tourSubName').value.trim()) || '';
      const amount = num('tourSubAmount');
      const day = Math.min(31, Math.max(1, Math.floor(num('tourSubDay') || new Date().getDate())));
      if (name || amount) {
        if (!name || !(amount > 0)) { toast('Completa nombre y monto, o déjalos vacíos'); return false; }
        const t = new Date();
        let when = new Date(t.getFullYear(), t.getMonth(), day);
        if (when < new Date(t.getFullYear(), t.getMonth(), t.getDate())) when = new Date(t.getFullYear(), t.getMonth() + 1, day);
        const date = when.getFullYear() + '-' + String(when.getMonth() + 1).padStart(2, '0') + '-' + String(when.getDate()).padStart(2, '0');
        const id = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'sub-' + Date.now().toString(36);
        state.subscriptions = [...(state.subscriptions || []), { id, name, amount, range: 'mensual', date, active: true, user_id: state.user_id, created_at: Date.now() }];
      }
    }
    try { if (typeof window.save === 'function') window.save(); } catch (e) { console.warn(e); }
    if (window.AbacoApp) AbacoApp.syncFinance();
    return true;
  }

  async function next(opts) {
    if (tour.busy) return;
    const s = STEPS[tour.step];
    tour.busy = true;
    try {
      if (s.ask && !(opts && opts.skipStep) && !(await saveStep(s.id))) return;
      if (tour.step >= STEPS.length - 1) { if (typeof finishWalletQuiz === 'function') finishWalletQuiz(false); return; }
      tour.step++;
      paint();
    } finally { tour.busy = false; }
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;
    const pay = t.closest('[data-tour-pay]');
    if (pay) {
      tour.pay = pay.dataset.tourPay;
      document.querySelectorAll('[data-tour-pay]').forEach((b) => {
        const on = b === pay;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
      return;
    }
    if (t.closest('#btnTourLater')) next({ skipStep: true });
  });

  /* ---------- día de pago (lo usa Hoy) ---------- */

  /* Quincena: el 15 y el último día del mes. Mes: el último día. Semana: viernes. */
  function isPayday(freq, ts) {
    const d = new Date(ts);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (freq === 'quincenal') return d.getDate() === 15 || d.getDate() === last;
    if (freq === 'mensual') return d.getDate() === last;
    if (freq === 'semanal') return d.getDay() === 5;
    return false;
  }

  window.AbacoTour = { start, next, isPayday, STEPS, state: () => ({ step: tour.step, pay: tour.pay }) };
})();
