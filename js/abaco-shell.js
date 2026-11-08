/* Ábaco · estructura de la interfaz (rediseño del canvas).
 *
 *  - Cabecera de título grande: subtítulo (saludo en Inicio, momento del día en las demás) y
 *    título de la pantalla. Al desplazar se compacta.
 *  - Formularios como hojas inferiores: cualquier formulario de captura que se muestre se
 *    convierte en hoja con fondo atenuado. Tocar el fondo o "volver" la cierra.
 *  - Ayuda de la sección y cierre desde el menú.
 *
 * Se carga después de app.js. No cambia datos: solo la presentación.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const TITLES = {
    inicio: 'Hoy', hormiga: 'Registrar', historial: 'Movimientos', estadisticas: 'Estadísticas', cuentas: 'Cuentas',
    ingresos: 'Ingresos', ahorros: 'Ahorros', tarjetas: 'Tarjetas', prestamos: 'Préstamos', deudores: 'Por cobrar',
    inversiones: 'Inversiones', suscripciones: 'Suscripciones', presupuesto: 'Sobres', simulador: 'Simulador',
    compras: 'Compras', lista: 'Qué comprar', kanban: 'Pendientes', recordatorios: 'Recordatorios', categorias: 'Categorías',
    decisiones: 'Decisiones', pactos: 'Pactos', cartas: 'Cartas', config: 'Ajustes'
  };

  /* Formularios que se presentan como hoja inferior. */
  const SHEETS = ['accountFormPanel', 'budgetEntryPanel', 'cardFormPanel', 'debtFormPanel', 'incFormPanel', 'invFormPanel',
    'listaFormPanel', 'loanFormPanel', 'shopFormPanel', 'subFormPanel', 'saveMenuPanel'];

  const sky = () => (window.AbacoSky ? AbacoSky.current() : null);


  /* ---------- cabecera ---------- */

  function refresh() {
    const title = $('tbTitle');
    const sub = $('tbSub');
    const chip = $('tbChip');
    if (!title || !sub || !chip || typeof state !== 'object') return;
    const name = state.activePanel || 'hormiga';
    const s = sky();
    title.textContent = TITLES[name] || 'Ábaco';
    // Modo calmado: sin chip de hora; en Inicio, solo el saludo.
    sub.textContent = name === 'inicio' ? (s ? s.saludo : 'Hola') + (state.user_name ? ', ' + state.user_name : '') : (s ? s.momento : '');
    chip.classList.add('hidden');
  }

  function bindScroll() {
    const content = $('appContent');
    const bar = $('topbar');
    if (!content || !bar) return;
    content.addEventListener('scroll', () => { bar.classList.toggle('compact', content.scrollTop > 36); }, { passive: true });
  }

  /* ---------- hojas inferiores ---------- */

  function scrim() {
    let el = $('sheetScrim');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sheetScrim';
      el.className = 'sheet-scrim';
      el.addEventListener('click', closeSheets);
      (document.querySelector('.app') || document.body).appendChild(el);
    }
    return el;
  }

  function openSheets() {
    return SHEETS.map($).filter((el) => el && !el.classList.contains('hidden'));
  }

  function sync() {
    for (const id of SHEETS) {
      const el = $(id);
      if (el) el.classList.toggle('sheet-open', !el.classList.contains('hidden'));
    }
    const any = openSheets().length > 0;
    scrim().classList.toggle('open', any);
    const app = document.querySelector('.app');
    if (app) app.classList.toggle('sheet-active', any);
  }

  /* Cierra con la función propia de cada formulario cuando existe (limpia su estado). */
  function closeSheets() {
    let closed = false;
    for (const el of openSheets()) {
      closed = true;
      if (el.id === 'budgetEntryPanel' && typeof closeBudgetEntry === 'function') closeBudgetEntry();
      else if (el.id === 'subFormPanel' && typeof closeSubForm === 'function') closeSubForm();
      else el.classList.add('hidden');
    }
    sync();
    return closed;
  }

  function observeSheets() {
    const mo = new MutationObserver(sync);
    for (const id of SHEETS) {
      const el = $(id);
      if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    }
    sync();
  }

  /* El botón "volver" de Android cierra primero una hoja abierta. */
  function wrapBack() {
    const prev = window.handleAndroidBack;
    if (typeof prev !== 'function' || prev.__shell) return;
    window.handleAndroidBack = function () {
      if (closeSheets()) return;
      return prev.apply(this, arguments);
    };
    window.handleAndroidBack.__shell = true;
  }

  /* ---------- navegación ---------- */

  function onPanel() {
    closeSheets();
    refresh();
    const content = $('appContent');
    if (content) content.scrollTop = 0;
    const bar = $('topbar');
    if (bar) bar.classList.remove('compact');
  }

  function bindMenu() {
    const help = $('btnHelpMenu');
    if (help) help.onclick = () => { if (typeof closeMenu === 'function') closeMenu(); if (typeof showPanelHelp === 'function') showPanelHelp(); };
    const header = document.querySelector('.menu-page-header');
    if (header && !$('btnCloseMenu')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'btnCloseMenu';
      btn.className = 'tb-btn';
      btn.setAttribute('aria-label', 'Cerrar menú');
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
      btn.onclick = () => { if (typeof closeMenu === 'function') closeMenu(); };
      header.appendChild(btn);
    }
  }

  function init() {
    bindScroll();
    observeSheets();
    bindMenu();
    wrapBack();
    refresh();
    window.addEventListener('abaco:sky', refresh);
  }

  window.AbacoShell = { TITLES, SHEETS, refresh, onPanel, closeSheets, sync };
  init();
})();
