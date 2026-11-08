/* Ábaco · interfaz de convivencia.
 *
 * Pinta lo que no es dinero en sí: saludo y avisos de Inicio, la brújula, la equivalencia y la pausa
 * en Registrar, los préstamos entre sobres, las preguntas de Cuentas y las pantallas Estadísticas,
 * Decisiones, Pactos, Cartas y Configuración. La lógica vive en js/abaco-extras.js.
 *
 * Se carga después de app.js. Los clics se atienden por delegación: cada botón lleva data-x="acción".
 * Para probar con otra fecha: window.__abacoNow = <milisegundos>.
 */
(function () {
  'use strict';

  const X = window.AbacoExtras;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const money = X.money;
  const DAYMS = X.DAY;
  const OWN = ['estadisticas', 'decisiones', 'pactos', 'cartas', 'config'];
  const now = () => (Number(window.__abacoNow) || Date.now());
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const shortDate = (ts) => new Date(ts).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

  let started = false;
  let impulse = false; // "fue por impulso" del formulario de Registrar
  let compassOpen = false;
  let viewMonth = null; // carta que se está leyendo
  let statsMore = false; // Estadísticas: "Ver más" abierto

  /* ---------- datos ---------- */

  function ex() {
    if (!state.extras || state.extras.version !== 1 || !Array.isArray(state.extras.decisions)) state.extras = X.normalize(state.extras);
    return state.extras;
  }
  function persist() {
    try { if (typeof window.save === 'function') window.save(); } catch (e) { console.warn('No se pudo guardar', e); }
  }
  const catLabel = (c) => (typeof catName === 'function' ? catName(c) : c);
  function viewForExtras() {
    return { budgets: state.budgets || [], savings: state.savings || [], totals: state.financeTotals || {}, expenses: state.expenses || [], incomes: state.incomes || [] };
  }

  /* ---------- Inicio: saludo, avisos y brújula ---------- */


  const notice = (title, sub, label, go) =>
    '<div class="x-notice"><div class="xn-body"><div class="xn-title">' + title + '</div><div class="xn-sub">' + sub +
    '</div></div><button type="button" class="btn btn-ghost btn-sm" data-go="' + go + '">' + label + '</button></div>';

  function renderNotices() {
    const box = $('homeNotices');
    if (!box) return;
    const e = ex();
    const t = now();
    if (X.isSilent(e, t)) { box.innerHTML = ''; return; }
    const parts = [];
    const letter = e.letters.filter((l) => l.state === 'nueva').sort((a, b) => b.createdAt - a.createdAt)[0];
    if (letter) parts.push(notice('Tu ' + esc(letter.title.charAt(0).toLowerCase() + letter.title.slice(1)) + ' está lista', 'Escrita para ti. Tú decides qué hacer con ella.', 'Leerla', 'cartas'));
    const due = X.dueDecisions(e, t)[0];
    if (due) {
      const months = Math.max(1, Math.round((t - due.ts) / DAYMS / 30));
      parts.push(notice('¿Valió la pena «' + esc(due.title) + '»?', money(due.amount) + ' · hace ' + months + (months === 1 ? ' mes' : ' meses'), 'Responder', 'decisiones'));
    }
    box.innerHTML = parts.join('');
  }

  function updateCompass() {
    const btn = $('brujulaBtn');
    const card = $('brujulaCard');
    const needle = $('brujulaNeedle');
    if (!btn || !card || !needle) return;
    const e = ex();
    const c = X.compass(viewForExtras(), e, now(), catLabel);
    const quiet = X.isSilent(e, now());
    needle.style.transform = 'rotate(' + c.angle + 'deg)';
    btn.classList.toggle('calm', c.calm || quiet);
    btn.classList.toggle('restless', !c.calm && !quiet);
    btn.dataset.key = c.key;
    card.innerHTML = '<div class="bc-title">Tu brújula <span>✦</span></div><div class="bc-body"><b>' + esc(c.headline) + '.</b> ' + esc(c.detail) +
      '</div><div class="bc-hint">Toca de nuevo para cerrar</div>';
  }

  function toggleCompass(force) {
    const btn = $('brujulaBtn');
    const card = $('brujulaCard');
    if (!btn || !card) return;
    compassOpen = typeof force === 'boolean' ? force : !compassOpen;
    if (compassOpen) updateCompass();
    card.classList.toggle('open', compassOpen);
    btn.setAttribute('aria-expanded', String(compassOpen));
  }

  /* ---------- Registrar: equivalencia, impulso, pausa ---------- */

  function updateEquiv() {
    const box = $('hormEquiv');
    const amt = $('hormAmount');
    if (!box || !amt) return;
    const e = ex();
    const a = Number(amt.value) || 0;
    const eq = X.equivalence(a, X.selectedUnit(e));
    if (eq) {
      box.classList.remove('hidden');
      box.innerHTML = esc(eq.text) + '<small>en tu unidad, elegida en Configuración</small>';
    } else box.classList.add('hidden');
    const why = $('hormWhyWrap');
    if (why) why.classList.toggle('hidden', !(a >= e.prefs.bigAmount));
    const chip = $('hormImpulse');
    if (chip) {
      chip.classList.toggle('active', impulse);
      chip.setAttribute('aria-pressed', String(impulse));
    }
  }

  function pause({ amount, description }) {
    return new Promise((resolve) => {
      const e = ex();
      const secs = Math.max(1, Number(e.prefs.pauseSeconds) || 5);
      const unit = X.equivalence(amount, X.selectedUnit(e));
      const ov = document.createElement('div');
      ov.className = 'x-pause-overlay';
      ov.innerHTML = '<div class="x-pause" role="dialog" aria-modal="true" aria-labelledby="xpTitle">' +
        '<h3 id="xpTitle">' + esc(X.say(e, { amable: '¿Sigues queriendo esto?', directo: 'Pausa de ' + secs + ' s' })) + '</h3>' +
        '<div class="xp-amount">' + money(amount) + '</div>' +
        '<div class="xp-note">' + esc(description || 'Gasto') + ' · lo marcaste como compra por impulso. Tú decides.' + (unit ? ' ' + esc(unit.text) + '.' : '') + '</div>' +
        '<div class="xp-count" id="xpCount">' + secs + ' s</div><div class="xp-track"><div class="xp-fill" id="xpFill"></div></div>' +
        '<div class="xp-actions"><button type="button" class="btn btn-ghost" data-pause="no">Mejor no</button>' +
        '<button type="button" class="btn btn-primary" data-pause="go" disabled>Sigo con esto</button></div></div>';
      document.body.appendChild(ov);
      const go = ov.querySelector('[data-pause="go"]');
      const count = ov.querySelector('#xpCount');
      const fill = ov.querySelector('#xpFill');
      requestAnimationFrame(() => { fill.style.transition = 'width ' + secs + 's linear'; fill.style.width = '100%'; });
      let left = secs;
      const timer = setInterval(() => {
        left -= 1;
        if (left > 0) count.textContent = left + ' s';
        else { clearInterval(timer); count.textContent = 'Cuando quieras'; go.disabled = false; go.focus(); }
      }, 1000);
      const finish = (v) => { clearInterval(timer); document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); };
      const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); finish('back'); } };
      document.addEventListener('keydown', onKey, true);
      ov.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-pause]');
        if (b && !b.disabled) finish(b.dataset.pause);
      });
    });
  }

  /* 'go' = seguir y guardar · 'cancel' = "mejor no" (se anota) · 'back' = cerró la pausa, el formulario queda igual. */
  async function beforeExpense(info) {
    const e = ex();
    const amount = Number(info.amount) || 0;
    if (!(amount > 0) || !X.shouldPause(e, { impulse })) return 'go';
    const v = await pause({ amount, description: info.description });
    if (v === 'go') return 'go';
    if (v === 'no') {
      X.addDecision(e, { title: info.description || 'Compra', amount, reason: 'Decidí no comprarlo', kind: 'no-compre', now: now() });
      persist();
      ['hormAmount', 'hormDesc', 'hormWhy'].forEach((id) => { if ($(id)) $(id).value = ''; });
      impulse = false;
      updateEquiv();
      toast('Anotado: decidí no. Sin reproches.');
      return 'cancel';
    }
    return 'back';
  }

  function afterExpense(info) {
    const e = ex();
    const amount = Number(info.amount) || 0;
    const why = $('hormWhy') ? $('hormWhy').value.trim() : '';
    if (why && amount >= e.prefs.bigAmount) {
      X.addDecision(e, { title: info.description || 'Compra', amount, reason: why, now: now() });
      persist();
    }
    impulse = false;
    if ($('hormWhy')) $('hormWhy').value = '';
    setTimeout(updateEquiv, 0);
  }

  /* ---------- Presupuesto: porcentajes y préstamos entre sobres ---------- */

  function renderBorrow() {
    const box = $('borrowBox');
    if (!box) return;
    const list = ex().borrows.filter((b) => !b.undone).sort((a, b) => b.ts - a.ts).slice(0, 3);
    box.innerHTML = list.length ? '<div class="section-title">Movimientos entre sobres</div><div class="calm-list">' + list.map((b) =>
      '<div class="calm-row static"><span class="cr-body"><span class="cr-title">' + money(b.amount) + ' de ' + esc(catLabel(b.from)) + ' para ' + esc(catLabel(b.to)) + '</span>' +
      '<span class="cr-sub">' + shortDate(b.ts) + (b.note ? ' · «' + esc(b.note) + '»' : '') + ' · anotado, sin reproche</span></span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-x="borrow-undo" data-id="' + esc(b.id) + '">Deshacer</button></div>').join('') + '</div>' : '';
  }

  async function borrowDialog() {
    const budgets = state.budgets || [];
    if (budgets.length < 2) { toast('Necesitas al menos dos sobres'); return; }
    const opts = budgets.map((b) => ({ value: b.category, label: catLabel(b.category) + ' · queda ' + money(b.amount - b.spent) }));
    const f = await askFields({
      title: 'Pedir prestado de otro sobre', body: 'Mueves dinero entre sobres. Queda anotado, sin reproche.', confirmLabel: 'Mover',
      fields: [
        { id: 'from', label: 'Tomar de', type: 'select', options: opts, value: opts[0].value },
        { id: 'to', label: 'Poner en', type: 'select', options: opts, value: opts[1].value },
        { id: 'amount', label: 'Monto $', type: 'number', inputmode: 'decimal' },
        { id: 'note', label: 'Nota (opcional)' }
      ]
    });
    if (!f) return;
    const plan = X.borrowPlan(budgets, f.from, f.to, f.amount);
    if (!plan.ok) { toast(plan.error); return; }
    await moveBudgets(f.from, plan.fromAmount, f.to, plan.toAmount, () => {
      X.recordBorrow(ex(), { from: f.from, to: f.to, amount: Number(f.amount), note: f.note, now: now() });
      toast('Listo: ' + money(f.amount) + ' de ' + catLabel(f.from) + ' para ' + catLabel(f.to));
    });
  }

  /* Cambia dos sobres; si el segundo falla, deja el primero como estaba. */
  async function moveBudgets(catA, amountA, catB, amountB, onDone) {
    const data = window.AbacoApp && AbacoApp.data();
    const budgets = state.budgets || [];
    const a = budgets.find((b) => b.category === catA);
    const b = budgets.find((x) => x.category === catB);
    if (!data || !a || !b) { toast('No se pudo mover el dinero'); return; }
    const r1 = await data.setBudget({ category: catA, amount: amountA, description: a.description });
    if (!r1.ok) { toast(r1.error); return; }
    const r2 = await data.setBudget({ category: catB, amount: amountB, description: b.description });
    if (!r2.ok) {
      await data.setBudget({ category: catA, amount: a.amount, description: a.description });
      AbacoApp.refreshUI();
      toast(r2.error);
      return;
    }
    onDone();
    persist();
    AbacoApp.refreshUI();
  }

  async function undoBorrow(id) {
    const e = ex();
    const rec = e.borrows.find((x) => x.id === id && !x.undone);
    if (!rec) return;
    const budgets = state.budgets || [];
    const from = budgets.find((b) => b.category === rec.from);
    const to = budgets.find((b) => b.category === rec.to);
    if (!from || !to) { toast('Uno de los sobres ya no existe'); return; }
    if (to.amount - rec.amount < to.spent) { toast(catLabel(to.category) + ' ya usó ese dinero'); return; }
    await moveBudgets(rec.to, to.amount - rec.amount, rec.from, from.amount + rec.amount, () => {
      X.undoBorrow(e, id);
      toast('Devuelto a ' + catLabel(rec.from));
    });
  }

  /* ---------- Cuentas: una pregunta a la vez ---------- */

  function renderQuestion() {
    const box = $('questionBox');
    if (!box) return;
    const q = X.pendingQuestion(ex(), state.subscriptions || [], now());
    if (!q) { box.innerHTML = ''; return; }
    const id = esc(q.sub.id);
    box.innerHTML = '<div class="x-card"><div class="xc-label">Una pregunta, sin prisa</div><div class="xc-title">¿Usaste ' + esc(q.sub.name) + ' el mes pasado?</div>' +
      '<div class="x-actions"><button type="button" class="btn btn-ghost" data-x="q" data-id="' + id + '" data-v="si">Sí</button>' +
      '<button type="button" class="btn btn-ghost" data-x="q" data-id="' + id + '" data-v="no">No</button>' +
      '<button type="button" class="btn btn-ghost" data-x="q" data-id="' + id + '" data-v="luego">Luego</button></div></div>';
  }

  /* ---------- pantallas propias ---------- */

  const dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };

  function renderEstadisticas() {
    const box = $('xv-estadisticas');
    if (!box) return;
    const e = ex();
    const t = now();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(t);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      days.push({ d, key: dayKey(d.getTime()), total: 0 });
    }
    const byCat = {};
    let total = 0;
    (state.expenses || []).forEach((x) => {
      const day = days.find((dd) => dd.key === dayKey(x.created_at));
      if (!day) return;
      day.total += Number(x.amount) || 0;
      total += Number(x.amount) || 0;
      byCat[x.category] = (byCat[x.category] || 0) + (Number(x.amount) || 0);
    });
    const max = Math.max(1, ...days.map((d) => d.total));
    const initials = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    const bars = days.map((d, i) => '<div class="xb ' + (i === 6 ? 'today' : '') + (d.total ? '' : ' zero') + '"><i style="height:' + (d.total ? Math.max(8, Math.round((d.total / max) * 96)) : 4) + 'px" title="' + money(d.total) + '"></i><span>' + initials[d.d.getDay()] + '</span></div>').join('');
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    const eq = top ? X.equivalence(top[1], X.selectedUnit(e)) : null;
    const m = X.computeMetrics(viewForExtras(), t);
    const chosen = e.prefs.metrics.map((id) => X.METRICS.find((x) => x.id === id)).filter(Boolean);
    const tiles = '<div class="x-tiles">' + [['charts', 'estadisticas', 'Gráficas'], ['cartas', 'cartas', 'Cartas'], ['decisiones', 'decisiones', 'Decisiones'], ['pactos', 'pactos', 'Pactos']]
      .map(([to, icon, label]) => '<button type="button" class="x-tile" ' + (to === 'charts' ? 'data-x="charts"' : 'data-go="' + to + '"') + '>' + navIconSvg(icon) + '<span>' + label + '</span></button>').join('') + '</div>';
    box.innerHTML = '<div class="calm-sentence">' + (total ? 'Esta semana gastaste <b>' + money(total) + '</b>. Lo que más pesó fue ' + esc(catLabel(top[0]).toLowerCase()) + '.' : 'Esta semana todavía no hay gastos.') + '</div>' +
      '<div class="x-card hi"><div class="x-bars">' + bars + '</div></div>' +
      (statsMore
        ? (top ? '<div class="x-card"><div class="xc-title">' + esc(catLabel(top[0])) + ': ' + money(top[1]) + '</div>' + (eq ? '<div class="xc-sub">' + esc(eq.text) + ' en tu unidad</div>' : '') + '</div>' : '') +
          '<div class="x-card"><div class="xc-label">Tus medidas</div>' +
          (chosen.length ? '<div class="x-metrics">' + chosen.map((c) => '<div><div class="xm-l">' + esc(c.label) + '</div><div class="xm-v">' + esc(X.formatMetric(c.id, m[c.id])) + '</div></div>').join('') + '</div>'
            : '<div class="xc-sub">Elige las que quieras ver en Ajustes.</div>') + '</div>' + tiles +
          '<div class="calm-pill-row"><button type="button" class="calm-pill" data-x="stats-more">Ver menos ⌃</button></div>'
        : '<div class="calm-pill-row"><button type="button" class="calm-pill" data-x="stats-more">Ver más (medidas, gráficas, cartas) ⌄</button></div>');
  }

  function decisionCard(d, t, due) {
    const months = Math.max(1, Math.round((t - d.ts) / DAYMS / 30));
    return '<div class="x-card ' + (due ? 'hi' : '') + '"><div class="xc-label">Hace ' + months + (months === 1 ? ' mes' : ' meses') + ' · ' + money(d.amount) + '</div>' +
      '<div class="xc-title">' + esc(d.title) + '</div>' + (d.reason ? '<div class="xc-sub" style="font-size:14px;color:var(--text)">«' + esc(d.reason) + '»</div>' : '') +
      '<div class="xc-sub" style="margin-top:10px">¿Valió la pena?</div><div class="x-actions">' +
      '<button type="button" class="btn btn-ghost" data-x="dec" data-id="' + esc(d.id) + '" data-v="si">Sí</button>' +
      '<button type="button" class="btn btn-ghost" data-x="dec" data-id="' + esc(d.id) + '" data-v="no">No</button>' +
      '<button type="button" class="btn btn-ghost" data-x="dec" data-id="' + esc(d.id) + '" data-v="luego">Ahora no</button></div></div>';
  }

  function decisionRow(d, sub) {
    return '<div class="x-card"><div class="x-row"><div><div class="xc-title">' + esc(d.title) + '</div><div class="xc-sub">' + sub + '</div></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" style="width:auto" aria-label="Quitar" data-x="dec-del" data-id="' + esc(d.id) + '">×</button></div></div>';
  }

  function renderDecisiones() {
    const box = $('xv-decisiones');
    if (!box) return;
    const e = ex();
    const t = now();
    const due = X.dueDecisions(e, t);
    const dueIds = new Set(due.map((d) => d.id));
    const waiting = e.decisions.filter((d) => d.kind === 'compra' && d.verdict === null && !dueIds.has(d.id)).sort((a, b) => a.ts - b.ts);
    const yes = e.decisions.filter((d) => d.verdict === 'si');
    const no = e.decisions.filter((d) => d.verdict === 'no');
    const skipped = e.decisions.filter((d) => d.kind === 'no-compre').sort((a, b) => b.ts - a.ts);
    const group = (title, items, fn) => (items.length ? '<div class="section-title">' + title + '</div>' + items.map(fn).join('') : '');
    const review = (d) => shortDate(d.ts + e.prefs.decisionDays * DAYMS + 0);
    box.innerHTML = '<div class="x-note" style="margin:0 6px 10px">Anota por qué haces una compra grande. Meses después te pregunto si valió la pena; tú pones la respuesta.</div>' +
      due.map((d) => decisionCard(d, t, true)).join('') +
      '<button type="button" class="btn btn-primary" data-x="dec-add">＋ Anotar una decisión</button>' +
      group('Esperando su momento', waiting, (d) => decisionRow(d, money(d.amount) + ' · se revisa hacia el ' + review(d) + (d.reason ? ' · «' + esc(d.reason) + '»' : ''))) +
      group('Sí valió', yes, (d) => decisionRow(d, money(d.amount) + (d.reason ? ' · «' + esc(d.reason) + '»' : ''))) +
      group('No valió', no, (d) => decisionRow(d, money(d.amount) + ' · lo anotaste sin culpa')) +
      group('Decidí no comprar', skipped, (d) => decisionRow(d, money(d.amount) + ' · ' + shortDate(d.ts))) +
      (e.decisions.length ? '' : '<div class="x-empty">Aún no hay decisiones. Al registrar una compra de ' + money(e.prefs.bigAmount) + ' o más puedes anotar por qué, o agrégala aquí.</div>');
  }

  function renderPactos() {
    const box = $('xv-pactos');
    if (!box) return;
    const e = ex();
    const cards = e.pacts.map((p) => {
      const s = X.pactStats(p);
      const lb = s.lastBroken;
      return '<div class="x-card"><div class="x-row"><div class="xc-title">' + esc(p.title) + '</div><div class="x-pct">' + (s.total ? s.done + ' de ' + s.total : 'Sin registros') + '</div></div>' +
        '<div class="x-bar"><div style="width:' + s.pct + '%"></div></div>' +
        (lb ? '<div class="xc-sub">Roto el ' + shortDate(lb.ts) + (lb.note ? ' · «' + esc(lb.note) + '»' : '') + ' · anotado, sin reproche</div>' : '<div class="xc-sub">Cumplir es tuyo. Si un día se rompe, lo anotas y ya.</div>') +
        '<div class="x-actions"><button type="button" class="btn btn-ghost" data-x="pact-log" data-id="' + esc(p.id) + '" data-v="ok">Cumplí hoy</button>' +
        '<button type="button" class="btn btn-ghost" data-x="pact-log" data-id="' + esc(p.id) + '" data-v="no">Lo rompí</button>' +
        '<button type="button" class="btn btn-ghost" aria-label="Quitar pacto" data-x="pact-del" data-id="' + esc(p.id) + '" style="flex:0 0 auto;min-width:0">×</button></div></div>';
    }).join('');
    box.innerHTML = '<div class="x-note" style="margin:0 6px 10px">Acuerdos que haces contigo. Los marcas tú; no hay castigos.</div>' + cards +
      '<button type="button" class="btn btn-primary" data-x="pact-add">＋ Nuevo pacto</button>' +
      (e.pacts.length ? '' : '<div class="x-empty">Aún no tienes pactos. Por ejemplo: «No pedir comida a domicilio los martes».</div>');
  }

  function letterPaper(l) {
    const created = new Date(l.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
    return '<div class="x-letter"><div class="xl-date">' + esc(created) + ' · ' + esc(cap(X.monthName(l.monthKey))) + (l.state === 'guardada' ? ' · guardada' : '') + (l.edited ? ' · editada' : '') + '</div>' +
      '<div class="xl-hello">' + esc(l.greeting) + '</div>' + l.paragraphs.map((p) => '<p>' + esc(p) + '</p>').join('') + '<div class="xl-sign">' + esc(l.signoff) + '</div></div>' +
      '<div class="x-actions"><button type="button" class="btn btn-ghost" data-x="letter-keep" data-id="' + esc(l.id) + '">Guardar</button>' +
      '<button type="button" class="btn btn-ghost" data-x="letter-edit" data-id="' + esc(l.id) + '">Editar</button>' +
      '<button type="button" class="btn btn-ghost" data-x="letter-del" data-id="' + esc(l.id) + '" style="color:var(--bad)">Borrar</button></div>' +
      '<div class="x-note">Si la borras, no volverá a aparecer.</div>';
  }

  function renderCartas() {
    const box = $('xv-cartas');
    if (!box) return;
    const e = ex();
    const t = now();
    const letters = e.letters.slice().sort((a, b) => b.monthKey.localeCompare(a.monthKey));
    if (!viewMonth || !letters.some((l) => l.monthKey === viewMonth)) {
      const first = letters.find((l) => l.state === 'nueva') || letters[0];
      viewMonth = first ? first.monthKey : null;
    }
    const sel = letters.find((l) => l.monthKey === viewMonth);
    if (sel && sel.state === 'nueva') { sel.state = 'leida'; persist(); }
    const prev = X.prevMonthKey(t);
    const cur = X.monthKeyOf(t);
    const writers = [];
    if (!letters.some((l) => l.monthKey === prev)) writers.push('<button type="button" class="btn btn-ghost" data-x="letter-write" data-v="prev">Escribir la carta de ' + esc(X.monthName(prev)) + '</button>');
    if (!letters.some((l) => l.monthKey === cur)) writers.push('<button type="button" class="btn btn-ghost" data-x="letter-write" data-v="now">Escribir la carta de este mes (hasta hoy)</button>');
    box.innerHTML = (letters.length ? '<div class="x-chips" style="margin:0 0 12px">' + letters.map((l) => '<button type="button" class="' + (l.monthKey === viewMonth ? 'on' : '') + '" data-x="letter-view" data-v="' + esc(l.monthKey) + '">' + esc(cap(X.monthName(l.monthKey))) + (l.state === 'nueva' ? ' •' : '') + '</button>').join('') + '</div>' : '') +
      (sel ? letterPaper(sel) : '<div class="x-empty">Aún no hay cartas. Al cerrar cada mes te escribo una con lo que pasó; también puedes pedirla cuando quieras.</div>') +
      '<div class="x-actions" style="margin-top:14px">' + writers.join('') + '</div>';
  }

  /* ---------- Ajustes (modo calmado): una lista corta; cada renglón abre una hoja con una sola decisión ---------- */

  const opt = (action, v, title, desc, on, multi) =>
    '<button type="button" class="cs-option' + (on ? ' on' : '') + '" data-x="' + action + '" data-v="' + esc(v) + '" aria-pressed="' + !!on + '">' +
    '<span class="' + (multi ? 'cs-check' : 'cs-radio') + '"></span><span class="cs-opt-text"><b>' + esc(title) + '</b>' + (desc ? '<small>' + esc(desc) + '</small>' : '') + '</span></button>';
  const done = '<button type="button" class="btn btn-primary cs-done" data-calm="close">Listo</button>';
  const TONES = { directo: ['Directo', 'Cifras secas, sin adornos.'], amable: ['Amable', 'Con contexto y calma.'], silencioso: ['Silencioso', 'Solo hablo cuando tú me tocas.'] };
  const SKY = { auto: 'Según la hora', light: 'Día', dark: 'Noche' };
  const quickOn = () => !!(window.AbacoQuick && AbacoQuick.available() && AbacoQuick.enabled());

  const CONFIG_SHEETS = {
    tone: { title: 'Cómo te hablo', hint: 'Una sola decisión por hoja.', render: () => Object.entries(TONES).map(([k, [t, d]]) => opt('tone', k, t, d, ex().prefs.tone === k)).join('') + done },
    sky: { title: 'Cielo', hint: 'El fondo y los colores de la app.', render: () => Object.entries(SKY).map(([k, t]) => opt('theme', k, t, k === 'auto' ? 'Día de día y noche de noche' : '', (window.AbacoSky ? AbacoSky.getMode() : 'auto') === k)).join('') + done },
    unit: {
      title: 'Mi unidad', hint: 'Si eliges una, te muestro cuánto equivale cada gasto. Si no, no comparo nada.',
      render: () => {
        const e = ex();
        return opt('unit', 'none', 'Ninguna', '', !e.prefs.unitId) +
          X.units(e).map((u) => opt('unit', u.id, cap(u.singular), money(u.price), e.prefs.unitId === u.id)).join('') +
          '<button type="button" class="cs-link" data-x="unit-add">＋ Nueva unidad</button>' +
          (e.prefs.customUnits.length ? '<div class="cs-note">Propias: ' + e.prefs.customUnits.map((u) => esc(u.singular) + ' <a href="#" data-x="unit-del" data-id="' + esc(u.id) + '">quitar</a>').join(' · ') + '</div>' : '') + done;
      }
    },
    pause: {
      title: 'Pausa antes de pagar', hint: 'Solo en compras que marques como impulso.',
      render: () => { const p = ex().prefs; return opt('pause-set', '0', 'No', 'Guardar sin pausa', !p.pause) + [3, 5, 10].map((n) => opt('pause-set', String(n), 'Sí, ' + n + ' segundos', '', p.pause && p.pauseSeconds === n)).join('') + done; }
    },
    quick: {
      title: 'Notificación rápida', hint: 'Una notificación fija y silenciosa: escribes «85 tacos» y se guarda al abrir Ábaco.',
      render: () => (window.AbacoQuick && AbacoQuick.available()
        ? opt('quick-set', '1', 'Sí', 'Queda en tu barra de notificaciones', quickOn()) + opt('quick-set', '0', 'No', 'Quitarla de la barra', !quickOn())
        : '<div class="cs-note">Disponible en la app de Android.</div>') + done
    },
    silence: {
      title: 'Silencio por encargo', hint: 'Sin avisos ni preguntas.',
      render: () => { const p = ex().prefs; const on = p.silenceUntil && now() < p.silenceUntil; return opt('silence', 'off', 'No', 'Te aviso como siempre', !on) + opt('silence', 'on', 'Hasta el lunes', 'No te digo nada hasta entonces', on) + done; }
    },
    metrics: { title: 'Mis medidas', hint: 'Las que verás en Estadísticas. Elige las que quieras.', render: () => X.METRICS.map((m) => opt('metric', m.id, m.label, '', ex().prefs.metrics.includes(m.id), true)).join('') + done },
    data: {
      title: 'Mis datos', hint: 'Son tuyos: expórtalos o bórralos cuando quieras.',
      render: () => '<div class="cs-actions"><button type="button" class="btn btn-ghost" data-x="data" data-v="export">Exportar copia</button>' +
        '<button type="button" class="btn btn-ghost" data-x="data" data-v="import">Importar copia</button>' +
        '<button type="button" class="btn btn-ghost cs-danger" data-x="data" data-v="clear">Borrar todo</button></div>' + done
    }
  };

  function renderConfig() {
    const box = $('xv-config');
    if (!box) return;
    const e = ex();
    const p = e.prefs;
    const unit = X.selectedUnit(e);
    const silent = p.silenceUntil && now() < p.silenceUntil;
    const row = (k, t, v) => '<button type="button" class="calm-row" data-x="cfg" data-v="' + k + '"><span class="cr-body"><span class="cr-title">' + t + '</span></span><span class="cr-value">' + esc(v) + '</span><span class="cr-chev">›</span></button>';
    box.innerHTML = '<div class="calm-list">' +
      row('tone', 'Cómo te hablo', TONES[p.tone][0]) + row('sky', 'Cielo', SKY[window.AbacoSky ? AbacoSky.getMode() : 'auto']) +
      row('unit', 'Mi unidad', unit ? cap(unit.singular) : 'Ninguna') + row('pause', 'Pausa antes de pagar', p.pause ? 'Sí' : 'No') +
      row('quick', 'Notificación rápida', window.AbacoQuick && AbacoQuick.available() ? (quickOn() ? 'Sí' : 'No') : 'Android') +
      row('silence', 'Silencio', silent ? 'Hasta el lunes' : 'No') + '</div>' +
      '<div class="calm-list">' + row('metrics', 'Mis medidas', String(p.metrics.length)) + row('data', 'Mis datos', 'Copias') + '</div>';
    if (window.AbacoCalm) AbacoCalm.refreshSheet();
  }

  const RENDERERS = { estadisticas: renderEstadisticas, decisiones: renderDecisiones, pactos: renderPactos, cartas: renderCartas, config: renderConfig };
  function render(name) {
    if (typeof state === 'undefined' || !RENDERERS[name]) return;
    RENDERERS[name]();
  }

  /* ---------- cartas ---------- */

  function makeLetter(monthKey, partial) {
    const e = ex();
    const view = viewForExtras();
    const summary = X.monthSummary(view, monthKey);
    const { from, to } = X.monthRange(monthKey);
    const spentIn = (cat) => (state.expenses || []).filter((x) => x.created_at >= from && x.created_at < to && x.category === cat).reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const planned = (state.budgets || []).filter((b) => b.amount > 0);
    const overBudget = planned.length
      ? planned.map((b) => ({ category: b.category, over: spentIn(b.category) - b.amount })).filter((o) => o.over > 0).sort((a, b) => b.over - a.over)
      : undefined;
    const goal = (state.savings || []).filter((g) => g.target > 0).map((g) => ({ name: g.name, pct: Math.floor((g.amount / g.target) * 100) })).sort((a, b) => b.pct - a.pct)[0];
    const letter = X.buildLetter({
      name: state.user_name, monthKey, summary, overBudget, goal, available: (state.financeTotals || {}).available || 0,
      tone: e.prefs.tone === 'directo' ? 'directo' : 'amable', catName: catLabel, unit: X.selectedUnit(e), partial: !!partial
    });
    return X.addLetter(e, { monthKey, letter, now: now() });
  }

  /* ---------- acciones por delegación ---------- */

  async function onAction(el) {
    const a = el.dataset.x;
    const v = el.dataset.v;
    const id = el.dataset.id;
    const e = ex();
    const t = now();
    const after = (name) => { persist(); render(name); };
    switch (a) {
      case 'tone': e.prefs.tone = v; after('config'); updateCompass(); renderNotices(); break;
      case 'theme': if (window.AbacoSky) AbacoSky.setMode(v); render('config'); try { localStorage.setItem('theme_mode', v); } catch (err) { /* sin almacenamiento */ } break;
      case 'unit': X.setUnit(e, v === 'none' ? null : v); after('config'); updateEquiv(); break;
      case 'unit-add': {
        const f = await askFields({ title: 'Nueva unidad', body: 'Algo con lo que quieras comparar tus gastos.', confirmLabel: 'Agregar', fields: [
          { id: 'singular', label: 'Nombre en singular (ej. taco)' }, { id: 'plural', label: 'Nombre en plural (ej. tacos)' },
          { id: 'price', label: 'Precio de una unidad $', type: 'number', inputmode: 'decimal' }] });
        if (!f) break;
        const r = X.addUnit(e, f);
        if (!r.ok) { toast(r.error); break; }
        X.setUnit(e, r.unit.id);
        after('config');
        updateEquiv();
        break;
      }
      case 'unit-del': X.removeUnit(e, id); after('config'); updateEquiv(); break;
      case 'cfg': if (window.AbacoCalm && CONFIG_SHEETS[v]) AbacoCalm.openSheet(CONFIG_SHEETS[v]); break;
      case 'pause-set': e.prefs.pause = v !== '0'; if (v !== '0') e.prefs.pauseSeconds = Number(v); after('config'); break;
      case 'quick-set': {
        const next = v === '1';
        window.AbacoQuick.setEnabled(next);
        toast(next ? 'Listo: la notificación queda en tu barra' : 'Quité la notificación de la barra');
        setTimeout(() => render('config'), 200);
        break;
      }
      case 'silence':
        if (v === 'on') { X.setSilence(e, X.nextMonday(t)); toast('Listo, hasta el lunes no te digo nada'); } else { X.clearSilence(e); toast('Volví a hablar'); }
        after('config'); renderNotices(); updateCompass(); break;
      case 'metric': {
        const i = e.prefs.metrics.indexOf(v);
        if (i >= 0) e.prefs.metrics.splice(i, 1); else e.prefs.metrics.push(v);
        after('config'); break;
      }
      case 'data': {
        const map = { export: 'btnExportBackup', import: 'btnImportBackup', clear: 'btnClearAll' };
        if ($(map[v])) $(map[v]).click();
        break;
      }
      case 'dec': X.answerDecision(e, id, v, t); after('decisiones'); renderNotices(); toast(v === 'luego' ? 'Te lo vuelvo a preguntar más adelante' : 'Anotado, gracias'); break;
      case 'dec-add': {
        const f = await askFields({ title: 'Anotar una decisión', confirmLabel: 'Guardar', fields: [
          { id: 'title', label: '¿Qué decidiste?' }, { id: 'amount', label: 'Monto $', type: 'number', inputmode: 'decimal' }, { id: 'reason', label: '¿Por qué? (para acordarte)' }] });
        if (!f) break;
        const r = X.addDecision(e, { title: f.title, amount: f.amount, reason: f.reason, now: t });
        if (!r.ok) { toast(r.error); break; }
        after('decisiones'); toast('Guardada en tu cajón');
        break;
      }
      case 'dec-del': if (await askConfirm('¿Quitar esta decisión del cajón?')) { X.removeDecision(e, id); after('decisiones'); renderNotices(); } break;
      case 'pact-add': {
        const f = await askFields({ title: 'Nuevo pacto contigo', confirmLabel: 'Crear', fields: [{ id: 'title', label: 'En qué consiste', placeholder: 'No pedir comida a domicilio los martes' }] });
        if (!f) break;
        const r = X.addPact(e, { title: f.title, now: t });
        if (!r.ok) { toast(r.error); break; }
        after('pactos'); break;
      }
      case 'pact-log': {
        if (v === 'ok') { X.logPact(e, id, { ok: true, now: t }); toast('Anotado. Bien por ti.'); after('pactos'); break; }
        const f = await askFields({ title: 'Anotar que lo rompiste', body: 'Sin reproche: solo queda anotado.', confirmLabel: 'Anotar', fields: [{ id: 'note', label: '¿Decidiste romperlo o se te pasó? (opcional)' }] });
        if (!f) break;
        X.logPact(e, id, { ok: false, note: f.note, now: t });
        after('pactos'); break;
      }
      case 'pact-del': if (await askConfirm('¿Quitar este pacto?')) { X.removePact(e, id); after('pactos'); } break;
      case 'letter-view': viewMonth = v; render('cartas'); break;
      case 'letter-keep': X.keepLetter(e, id); after('cartas'); toast('Carta guardada'); break;
      case 'letter-edit': {
        const l = e.letters.find((x) => x.id === id);
        if (!l) break;
        const f = await askFields({ title: 'Editar la carta', body: 'Separa los párrafos con una línea en blanco.', confirmLabel: 'Guardar', fields: [{ id: 'text', label: 'Texto', type: 'textarea', rows: 12, value: X.letterText(l) }] });
        if (!f) break;
        if (!X.editLetter(e, id, f.text)) { toast('La carta no puede quedar vacía'); break; }
        after('cartas'); renderNotices(); break;
      }
      case 'letter-del':
        if (await askConfirm('Si la borras, no volverá a aparecer. ¿Borrarla?', { confirmLabel: 'Borrar' })) { X.deleteLetter(e, id); viewMonth = null; after('cartas'); renderNotices(); }
        break;
      case 'letter-write': {
        const key = v === 'prev' ? X.prevMonthKey(t) : X.monthKeyOf(t);
        const l = makeLetter(key, v === 'now');
        viewMonth = l.monthKey;
        after('cartas'); renderNotices(); break;
      }
      case 'q': X.answerQuestion(e, id, v, t); persist(); renderQuestion(); if (v === 'no') toast('Anotado. Si quieres, la revisas en Suscripciones.'); else if (v === 'si') toast('Gracias'); break;
      case 'stats-more': statsMore = !statsMore; render('estadisticas'); break;
      case 'charts': goPanel('inicio'); setTimeout(() => { if (typeof toggleHomeCharts === 'function') toggleHomeCharts(); }, 60); break;
      case 'borrow': await borrowDialog(); break;
      case 'borrow-undo': await undoBorrow(id); break;
      default: break;
    }
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;
    if (t.closest('#brujulaBtn')) { toggleCompass(); return; }
    if (t.closest('#brujulaCard')) { toggleCompass(false); return; }
    if (t.closest('#hormImpulse')) { impulse = !impulse; updateEquiv(); return; }
    const el = t.closest('[data-x]');
    if (el) { ev.preventDefault(); onAction(el).catch((err) => { console.warn('Acción', el.dataset.x, err); toast('No se pudo completar'); }); }
  });
  document.addEventListener('input', (ev) => { if (ev.target && ev.target.id === 'hormAmount') updateEquiv(); });

  /* ---------- ciclo de vida ---------- */

  function onPanel(name) {
    const app = document.querySelector('.app');
    if (app) app.classList.toggle('on-inicio', name === 'inicio');
    toggleCompass(false);
    if (name === 'inicio') { renderNotices(); updateCompass(); }
    if (name === 'hormiga') updateEquiv();
    if (name === 'presupuesto') renderBorrow();
    if (name === 'cuentas') renderQuestion();
  }

  function afterRefresh() {
    if (!started || typeof state === 'undefined') return;
    const name = state.activePanel;
    if (name === 'inicio') { renderNotices(); updateCompass(); }
    if (name === 'hormiga') updateEquiv();
    if (name === 'presupuesto') renderBorrow();
    if (name === 'cuentas') renderQuestion();
    if (OWN.includes(name)) render(name);
  }

  /* Si el mes anterior tuvo movimientos y aún no tiene carta, la escribe. */
  function checkLetters() {
    try {
      const key = X.letterDue(ex(), now(), viewForExtras());
      if (!key) return null;
      const l = makeLetter(key, false);
      persist();
      return l;
    } catch (err) { console.warn('No se pudo escribir la carta', err); return null; }
  }

  function start() {
    if (started) return;
    started = true;
    ex();
    checkLetters();
    onPanel(state.activePanel || 'hormiga');
  }

  window.AbacoExtrasUI = { start, render, onPanel, afterRefresh, beforeExpense, afterExpense, makeLetter, checkLetters, extras: ex, updateEquiv, updateCompass };
})();
