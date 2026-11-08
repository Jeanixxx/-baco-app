/* Nombres asignados más abajo en un IIFE; se declaran aquí para no crear globales implícitas. */
/* ===== Safe areas (APK / WebView) =====
   En muchos Android env(safe-area-inset-*) = 0.
   Forzamos mínimos y afinamos con JS. */
(function applySystemInsets() {
  const root = document.documentElement;
  function set(topPx, bottomPx) {
    const t = Math.max(16, Math.round(topPx || 0));
    const b = Math.max(10, Math.round(bottomPx || 0));
    root.style.setProperty('--js-safe-top', t + 'px');
    root.style.setProperty('--js-safe-bottom', b + 'px');
  }
  function cssInset(side) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;inset:0;padding-' + side + ':env(safe-area-inset-' + side + ');';
    document.body.appendChild(probe);
    const value = parseFloat(getComputedStyle(probe).getPropertyValue('padding-' + side)) || 0;
    probe.remove();
    return value;
  }
  function adjustInsets(nativeTop, nativeBottom) {
    const vv = window.visualViewport;
    const viewportTop = vv ? Math.max(vv.offsetTop || 0, 0) : 0;
    // Diferencia screen vs visualViewport ≈ nav bar cuando no hay teclado
    const viewportBottom = vv ? Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0)) : 0;
    const isAndroid = /Android/i.test(navigator.userAgent || '');
    const dpr = window.devicePixelRatio || 1;
    // Status bar Android típica ~24–28 dp; Navigation bar 3-botones ~48 dp; gestos ~16–24 dp
    const fallbackTop = isAndroid ? Math.max(28, Math.round(24 * Math.min(dpr, 2.5) / Math.max(dpr, 1))) : 20;
    // Preferir 48px si parece navegación de botones; si no, mínimo 20–24
    const screenGap = Math.max(0, (window.screen && window.screen.height ? window.screen.height - window.innerHeight : 0));
    let fallbackBottom = isAndroid ? 24 : 12;
    if (isAndroid) {
      if (screenGap >= 40 || viewportBottom >= 40) fallbackBottom = Math.max(48, viewportBottom);
      else fallbackBottom = Math.max(20, Math.min(48, viewportBottom || 24));
    }
    const top = Math.max(Number(nativeTop) || 0, cssInset('top'), viewportTop, fallbackTop);
    const bottom = Math.max(Number(nativeBottom) || 0, cssInset('bottom'), viewportBottom, fallbackBottom);
    set(top, bottom);
    try {
      const meta = document.getElementById('metaThemeColor');
      if (meta) {
        const sky = window.AbacoSky && AbacoSky.current();
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        meta.setAttribute('content', sky ? sky.top : (dark ? '#2B303A' : '#E8EEF5'));
      }
    } catch (e) {}
  }
  // Recalcula el borde superior para cada dispositivo, orientación y WebView.
  window.adjustTopInset = topPx => adjustInsets(topPx, undefined);
  adjustInsets();

  // Capacitor StatusBar / SafeArea si existen
  try {
    if (window.Capacitor && window.Capacitor.Plugins) {
      const SA = window.Capacitor.Plugins.SafeArea;
      if (SA && SA.getSafeAreaInsets) {
        SA.getSafeAreaInsets().then(function(r) {
          const i = r && (r.insets || r);
          if (i) adjustInsets(i.top, i.bottom);
        }).catch(function(){});
      }
    }
  } catch (e) {}

  // Heurística: diferencia screen vs visualViewport
  function fromViewport() {
    try {
      adjustInsets();
    } catch (e) {}
  }
  fromViewport();
  window.addEventListener('resize', fromViewport);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fromViewport);
    window.visualViewport.addEventListener('scroll', fromViewport);
  }

  fromViewport();
})();

/* Teclado móvil: oculta la barra inferior para que no quede "arriba" del teclado */
(function keyboardNavFix() {
  let baseline = Math.max(window.innerHeight, (window.visualViewport && window.visualViewport.height) || 0);
  let focusInsideForm = false;

  function setOpen(open) {
    document.body.classList.toggle('keyboard-open', !!open);
    if (!open) {
      // re-medir altura “sin teclado”
      baseline = Math.max(window.innerHeight, (window.visualViewport && window.visualViewport.height) || 0);
      resetMenuLayout();
    }
  }

  function checkViewport() {
    try {
      const vv = window.visualViewport;
      const vh = vv ? vv.height : window.innerHeight;
      const full = Math.max(window.innerHeight, baseline);
      // Teclado: viewport visible mucho menor, o hay focus en input
      const shrunk = (full - vh) > 80 || (baseline - vh) > 80;
      if (focusInsideForm) {
        setOpen(true);
        return;
      }
      setOpen(shrunk);
    } catch (e) {}
  }

  function isFormField(el) {
    if (!el || !el.tagName) return false;
    const t = el.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  document.addEventListener('focusin', (e) => {
    if (isFormField(e.target)) {
      focusInsideForm = true;
      setOpen(true);
      // re-check por si el viewport tarda en animar
      setTimeout(checkViewport, 100);
      setTimeout(checkViewport, 350);
    }
  }, true);

  document.addEventListener('focusout', () => {
    // esperar a que el siguiente focus se asiente
    setTimeout(() => {
      const ae = document.activeElement;
      focusInsideForm = isFormField(ae);
      if (!focusInsideForm) {
        setOpen(false);
        setTimeout(checkViewport, 100);
        setTimeout(checkViewport, 400);
      } else {
        setOpen(true);
      }
    }, 50);
  }, true);

  window.addEventListener('resize', () => {
    setTimeout(checkViewport, 50);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', checkViewport);
    window.visualViewport.addEventListener('scroll', checkViewport);
  }
  window.addEventListener('orientationchange', () => {
    focusInsideForm = false;
    setTimeout(() => {
      baseline = window.innerHeight;
      setOpen(false);
      checkViewport();
    }, 500);
  });
  // seguridad: si el teclado se cerró pero la clase quedó pegada
  function resetMenuLayout() {
    const menu = document.getElementById('menuPage');
    if (!menu) return;
    // siempre anclado al layout viewport completo (no al teclado)
    menu.style.top = '0';
    menu.style.height = '';
    menu.style.bottom = '0';
    menu.style.transform = menu.classList.contains('open') ? 'translateX(0)' : '';
  }

  setInterval(() => {
    if (!document.body.classList.contains('keyboard-open')) return;
    if (focusInsideForm) return;
    const vv = window.visualViewport;
    const vh = vv ? vv.height : window.innerHeight;
    if (vh >= baseline - 40) {
      setOpen(false);
      resetMenuLayout();
    }
  }, 800);

})();

const DEFAULT_CATS = [
  {id:'comida',name:'Comida',icon:'🍽️'},{id:'transporte',name:'Transporte',icon:'🚗'},
  {id:'hogar',name:'Hogar',icon:'🏠'},{id:'ocio',name:'Ocio',icon:'🎬'},
  {id:'salud',name:'Salud',icon:'💊'},{id:'general',name:'General',icon:'📦'},
];
/* Única lista de claves persistidas: la usan tanto save()/clearAll() como el
   respaldo/restauración, para que nunca queden desincronizadas entre sí. */
const PERSISTED_KEYS = ['user_id','user_name','expenses','incomes','shop','checklist','cart',
  'shopMode','historial','savings','kanban','reminders','reactions','categories','budgets',
  'budget_period','cards','msiPlans','accounts','transfers','loans','subscriptions','debtors',
  'investments','account_view','pinned','user_pronoun','money_chart_prefs','active_panel',
  'wallet_quiz','theme','theme_mode'];
const LS = k => localStorage.getItem(k);
const LS_SET = (k,v) => localStorage.setItem(k, typeof v==='string'?v:JSON.stringify(v));

/* Persistencia debounced (patrón del store del backend) */
let _saveTimer = null;
let _saveErrorNotified = false;

/* Utilidades nativas compartidas: mismo patrón defensivo que ya usan SafeArea/
   StatusBar/App (window.Capacitor?.Plugins?.X), con degradación a Web APIs si
   el plugin no está instalado. Viven junto al resto de helpers, no aisladas. */
function hapticTap(style) {
  try {
    const Haptics = window.Capacitor?.Plugins?.Haptics;
    if (Haptics?.impact) { Haptics.impact({ style: style || 'LIGHT' }); return; }
  } catch (e) {}
  try {
    const native = window.AndroidBridge;
    if (native?.hapticTap) { native.hapticTap(style || 'LIGHT'); return; }
  } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
}
function reminderNotifId(id) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 2147483647;
}
function scheduleReminderNotification(r) {
  const id = reminderNotifId(r.id);
  const when = Number(r.when);
  try {
    const native = window.AndroidBridge;
    if (native?.scheduleLocalNotification && Number.isFinite(when) && when > Date.now()) {
      native.requestNotificationPermission?.();
      native.scheduleLocalNotification(String(id), 'Ábaco · Recordatorio', String(r.text || ''), when);
      return;
    }
  } catch (e) { console.warn('Notificación Android no programada', e); }
  try {
    const LN = window.Capacitor?.Plugins?.LocalNotifications;
    if (!LN?.schedule) return;
    LN.requestPermissions?.().catch(() => {});
    LN.schedule({ notifications: [{ title: 'Ábaco · Recordatorio', body: r.text, id, schedule: { at: new Date(when) } }] }).catch(e => console.warn('Notificación no programada', e));
  } catch (e) {}
}
function cancelReminderNotification(r) {
  const id = reminderNotifId(r.id);
  try {
    const native = window.AndroidBridge;
    if (native?.cancelLocalNotification) { native.cancelLocalNotification(String(id)); return; }
  } catch (e) {}
  try {
    const LN = window.Capacitor?.Plugins?.LocalNotifications;
    if (!LN?.cancel) return;
    LN.cancel({ notifications: [{ id }] }).catch(() => {});
  } catch (e) {}
}
/* Respaldo del sistema de recordatorios cuando no hay plugin nativo de
   notificaciones (navegador o WebView sin Capacitor): revisa recordatorios
   vencidos y avisa con toast + Notification del navegador si hay permiso. */
function getOverdueReminders() {
  return (state.reminders || []).filter(r => !r.done && r.when && r.when < Date.now());
}
function checkReminders() {
  try {
    const due = getOverdueReminders().filter(r => !r.notified);
    if (!due.length) return;
    due.forEach(r => {
      r.notified = true;
      try { if (window.Notification && Notification.permission === 'granted') new Notification('Ábaco · Recordatorio', { body: r.text }); } catch (e) {}
    });
    save();
    renderMenu();
    if (state.activePanel === 'recordatorios' && typeof renderReminders === 'function') renderReminders();
    toast(due.length === 1 ? `Recordatorio: ${due[0].text}` : `${due.length} recordatorios vencidos`);
  } catch (e) {}
}

/* Red de seguridad de persistencia: en un WebView/APK, al cerrar o mandar la app
   a segundo plano el temporizador de 280ms de save() puede no llegar a ejecutarse
   (el proceso se pausa o se mata antes). Estos listeners fuerzan un save(true)
   -osea, el flush inmediato ya definido arriba- en cada punto donde el sistema
   puede cortar la ejecución, para que nunca quede un cambio pendiente sin guardar.
   El mismo bloque de ciclo de vida revisa recordatorios vencidos al volver a
   primer plano, en vez de crear un listener aparte para eso. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save(true);
  else { checkReminders(); try{ renderActivePanel(state.activePanel || 'hormiga'); }catch(e){} }
});
window.addEventListener('pagehide', () => save(true));
window.addEventListener('blur', () => save(true));
document.addEventListener('freeze', () => save(true));
setInterval(checkReminders, 60000);

let state = {
  user_id: LS('user_id')||null, user_name: LS('user_name')||'',
  expenses: [],
  incomes: [],
  shop: JSON.parse(LS('shop')||'[]'),
  checklist: JSON.parse(LS('checklist')||'[]'),
  checklistFilter: 'todos',
  cart: JSON.parse(LS('cart')||'[]'),
  shopMode: JSON.parse(LS('shopMode')||'null'),
  historial: [],
  savings: [],
  kanban: JSON.parse(LS('kanban')||'[]'),
  reminders: JSON.parse(LS('reminders')||'[]'),
  reactions: JSON.parse(LS('reactions')||'{}'),
  categories: JSON.parse(LS('categories')||'null')||DEFAULT_CATS,
   budgets: [],
   budgetPeriod: LS('budget_period')||'mensual',
   cards: [],
   msiPlans: [],
   accounts: [],
   transfers: [],
   loans: [],
   subscriptions: JSON.parse(LS('subscriptions')||'[]'),
   subRange: 'mensual',
   debtors: [],
   investments: [],
   accountView: LS('account_view')||'todas',
   tipSplitMode: 'all',
  pinned: JSON.parse(LS('pinned')||'null')||['inicio','historial','hormiga','estadisticas','cuentas'],
  pronoun: LS('user_pronoun')||'el',
  hormCat:'general', hormShared:'1', incShared:'0', saveType:'target',
  moneyChartPrefs: JSON.parse(LS('money_chart_prefs')||'{}')||{},
  walletQuiz: JSON.parse(LS('wallet_quiz')||'null')||{done:false},
  activePanel: 'hormiga',
};


const $ = id => document.getElementById(id);
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const money = n => '$'+(Number(n)||0).toLocaleString('es-MX',{maximumFractionDigits:2});
const uid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'abaco-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
const catIcon = id => (state.categories.find(c=>c.id===id)||{}).icon||'📦';
const catName = id => (state.categories.find(c=>c.id===id)||{}).name||id;
function timeAgo(ts) {
  if(!ts) return '';
  const s=Math.floor((Date.now()-ts)/1000);
  if(s<60) return 'Ahora'; if(s<3600) return `Hace ${Math.floor(s/60)}m`;
  if(s<86400) return `Hace ${Math.floor(s/3600)}h`; return `Hace ${Math.floor(s/86400)}d`;
}
function formatDate(ts) {
  if(!ts) return '—';
  return new Date(ts).toLocaleString('es',{dateStyle:'medium',timeStyle:'short'});
}
function whoLabel(userId) {
  if(!userId) return '?';
  if(userId===state.user_id) return state.user_name||'Tú';
  return 'Otro';
}
function toast(msg) {
  const t=$('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.remove('show'),2400);
  hapticTap();
}

function showDetail(title, rows, actions) {
  $('detailTitle').textContent = title;
  $('detailBody').innerHTML = rows.map(r =>
    `<div class="detail-row"><span class="lbl">${esc(r.lbl)}</span><span class="val">${esc(r.val)}</span></div>`
  ).join('');
  const act = $('detailActions');
  if (act) {
    act.innerHTML = '';
    (actions || []).forEach(a => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = a.danger ? 'btn btn-ghost' : 'btn btn-primary';
      if (a.danger) {
        btn.style.borderColor = '#EF4444';
        btn.style.color = '#EF4444';
      }
      btn.textContent = a.label;
      btn.onclick = () => { a.onClick(); };
      act.appendChild(btn);
    });
  }
  $('detailOverlay').classList.add('open');
}
function closeDetail() { $('detailOverlay').classList.remove('open'); }
$('btnCloseDetail').onclick = closeDetail;
$('detailOverlay').onclick = e => { if(e.target===$('detailOverlay')) closeDetail(); };
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDetail();
    const menu = document.querySelector('.app.menu-open');
    if (menu) { try { closeMenu(); } catch (err) {} }
    const savePanel = $('saveMenuPanel');
    if (savePanel && !savePanel.classList.contains('hidden')) savePanel.classList.add('hidden');
  }
});


function bindLongPress(el, onLong, onTap) {
  let timer=null, moved=false;
  const start = () => { moved=false; timer=setTimeout(()=>{timer=null;onLong();},480); };
  const end = () => { if(timer){clearTimeout(timer);timer=null; if(!moved&&onTap) onTap();} };
  el.addEventListener('touchstart', start, {passive:true});
  el.addEventListener('touchend', end);
  el.addEventListener('touchmove', ()=>{moved=true;if(timer){clearTimeout(timer);timer=null;}}, {passive:true});
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', end);
  el.addEventListener('mouseleave', ()=>{if(timer){clearTimeout(timer);timer=null;}});
}

/* Reactions */
function reactHtml(id) {
  const r = state.reactions[id] || {};
  const heart = r.heart||0, clap = r.clap||0;
  return `<div class="reactions">
    <button type="button" class="react-btn ${r.myHeart?'active':''}" data-react-id="${esc(id)}" data-react-type="heart">❤️ ${heart||''}</button>
    <button type="button" class="react-btn ${r.myClap?'active':''}" data-react-id="${esc(id)}" data-react-type="clap">👏 ${clap||''}</button>
  </div>`;
}
document.addEventListener('click', e => {
  const btn = e.target.closest?.('.react-btn[data-react-id][data-react-type]');
  if (!btn) return;
  e.stopPropagation();
  window.doReact(btn.dataset.reactId, btn.dataset.reactType);
});
window.doReact = (id, type) => {
  if (type !== 'heart' && type !== 'clap') return;
  if(!state.reactions[id]) state.reactions[id]={heart:0,clap:0};
  const r = state.reactions[id];
  if(type==='heart') {
    if(r.myHeart){ r.heart=Math.max(0,(r.heart||1)-1); r.myHeart=false; }
    else { r.heart=(r.heart||0)+1; r.myHeart=true; }
  } else {
    if(r.myClap){ r.clap=Math.max(0,(r.clap||1)-1); r.myClap=false; }
    else { r.clap=(r.clap||0)+1; r.myClap=true; }
  }
  save();
  // animate without full re-render of everything
  const btns = document.querySelectorAll('.react-btn');
  btns.forEach(b => {
    if (b.dataset.reactId !== id || b.dataset.reactType !== type) return;
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
    b.textContent = (type === 'heart' ? '❤️ ' : '👏 ') + (type === 'heart' ? (r.heart||'') : (r.clap||''));
    b.classList.toggle('active', type==='heart' ? r.myHeart : r.myClap);
  });
};

function showConfetti() {
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  const emojis = ['🎉','✨','💚','⭐','🎊','🌟'];
  for (let i=0;i<18;i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.textContent = emojis[i%emojis.length];
    p.style.left = (Math.random()*100)+'%';
    p.style.animationDelay = (Math.random()*0.4)+'s';
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(()=>layer.remove(), 1800);
}

/* Registrar (monto, teclado, paso opcional) vive en js/abaco-calm.js. */


/* El tema sigue al cielo: claro de día y oscuro de noche (js/abaco-sky.js).
   El botón alterna entre automático, día fijo y noche fija. */
if (window.AbacoSky) AbacoSky.init({ mode: LS('theme_mode') || 'auto' });
else document.documentElement.setAttribute('data-theme', LS('theme')||'light');
$('btnThemeMenu').onclick = () => {
  if (!window.AbacoSky) return;
  const r = AbacoSky.cycleMode();
  toast('Tema: ' + r.label);
};

const MENU_GROUPS = [
  {label:'Principal', items:['inicio','hormiga','presupuesto']},
  {label:'Dinero', items:['compras','ingresos','ahorros','tarjetas','cuentas','prestamos','suscripciones','inversiones','simulador']},
  {label:'Organiza', items:['lista','kanban','recordatorios']},
  {label:'Consulta', items:['historial','estadisticas','categorias','cartas']},
  {label:'Contigo', items:['decisiones','pactos','config']}
];
const NAV_META = {
  hormiga:{label:'Registrar'}, inicio:{label:'Inicio'}, presupuesto:{label:'Sobres'}, compras:{label:'Compras'},
  lista:{label:'Qué comprar'},
  ingresos:{label:'Ingresos'}, ahorros:{label:'Ahorros'}, tarjetas:{label:'Tarjetas'},
  cuentas:{label:'Cuentas'}, prestamos:{label:'Deudas'}, suscripciones:{label:'Suscripciones'}, inversiones:{label:'Inversiones'}, deudores:{label:'Por cobrar'}, simulador:{label:'Simulador'},
  kanban:{label:'Pendientes'}, recordatorios:{label:'Recordatorios'},
  historial:{label:'Movimientos'}, categorias:{label:'Categorías'},
  estadisticas:{label:'Estadísticas'}, cartas:{label:'Cartas'}, decisiones:{label:'Decisiones'}, pactos:{label:'Pactos'}, config:{label:'Ajustes'},
};
const NAV_ICON_PATHS = {
  hormiga:'<path d="M5 3h14v18l-3-2-4 2-4-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  inicio:'<path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/>',
  presupuesto:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  compras:'<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M3 4h2l2.5 11h11L21 8H6"/>',
  lista:'<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  ingresos:'<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 15v4h14v-4"/>',
  ahorros:'<path d="M3 8h18l-2-4H5zM5 8v12M9 8v12M15 8v12M19 8v12M3 20h18"/>',
  tarjetas:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  cuentas:'<path d="M4 7h15a2 2 0 0 1 2 2v10H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12"/><path d="M16 13h5"/>',
  prestamos:'<rect x="4" y="4" width="11" height="16" rx="2"/><path d="M8 8h4M8 12h3"/><circle cx="17" cy="16" r="4"/><path d="M17 14v4M16 16h2"/>',
  simulador:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2"/>',
  suscripciones:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3"/>',
  inversiones:'<path d="M3 20h18M5 17l5-6 4 3 6-8"/><path d="M16 6h4v4"/>',
  deudores:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 6a3 3 0 0 1 0 5M18 14a5 5 0 0 1 3 5"/>',
  kanban:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16M5 8h2M11 8h2M17 8h2"/>',
  recordatorios:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  historial:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M3 4v4h4"/>',
  categorias:'<path d="M20 13 11 22 2 13V4h9z"/><circle cx="7.5" cy="8.5" r="1"/>',
  estadisticas:'<path d="M4 20V11M10 20V5M16 20v-8M22 20H2"/>',
  cartas:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  decisiones:'<path d="M3 8h18v12H3z"/><path d="m3 8 2-4h14l2 4M10 13h4"/>',
  pactos:'<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
  config:'<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>'
};
function navIconSvg(section){
  const shape=NAV_ICON_PATHS[section]||'<circle cx="12" cy="12" r="8"/>';
  return `<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${shape}</svg>`;
}
/* Un solo mapa panel -> función que pinta su contenido con el estado actual.
   goPanel() lo consulta cada vez que se entra a una pantalla, así ninguna
   sección depende de que una acción (agregar/editar/borrar) la haya
   refrescado antes: siempre se ve lo que ya está guardado, sin necesitar
   una función aislada por panel. */
const PANEL_RENDERERS = {
  hormiga: () => renderHormiga(), inicio: () => renderInicio(), presupuesto: () => renderBudget(),
  compras: () => renderShop(), lista: () => renderChecklist(), ingresos: () => renderIncomes(),
  ahorros: () => renderSavings(), tarjetas: () => renderCards(), cuentas: () => renderAccounts(),
  prestamos: () => { renderLoans(); renderDebtors(); }, suscripciones: () => renderSubscriptions(), inversiones: () => renderInvestments(), simulador: () => renderSimulator(),
  deudores: () => renderDebtors(), kanban: () => renderKanban(), recordatorios: () => renderReminders(),
  historial: () => renderHistorial(), categorias: () => renderCategories(),
  estadisticas: () => renderExtrasPanel('estadisticas'), cartas: () => renderExtrasPanel('cartas'),
  decisiones: () => renderExtrasPanel('decisiones'), pactos: () => renderExtrasPanel('pactos'), config: () => renderExtrasPanel('config'),
};
/* Las pantallas de convivencia las pinta js/abaco-extras-ui.js (se carga después de este archivo). */
function renderExtrasPanel(name){ if (window.AbacoExtrasUI) AbacoExtrasUI.render(name); }
function renderActivePanel(name) {
  const fn = PANEL_RENDERERS[name];
  if (typeof fn === 'function') { try { fn(); } catch (e) { console.warn('Render de panel', name, e); } }
}


const PANEL_HELP = {
  estadisticas: { title: 'Estadísticas', body: 'Tus gastos de la semana, lo que más pesó y las medidas que tú elegiste. Aquí también está la lista de cartas.' },
  cartas: { title: 'Cartas', body: 'Al cerrar cada mes, Ábaco te escribe una carta corta con lo que pasó. Puedes guardarla, editarla o borrarla; si la borras, no vuelve a aparecer.' },
  decisiones: { title: 'Cajón de decisiones', body: 'Anota por qué hiciste una compra grande. Tiempo después, Ábaco te pregunta si valió la pena y tú decides la respuesta.' },
  pactos: { title: 'Pactos contigo', body: 'Acuerdos que haces contigo, como "no pedir comida los martes". Tú marcas si los cumpliste o los rompiste; no hay castigos.' },
  config: { title: 'Configuración', body: 'Elige cómo te habla Ábaco, tu unidad de equivalencia, la pausa antes de pagar, el silencio por encargo y tus medidas.' },
  hormiga: {
    title: 'Anotar gasto',
    body: 'Elige categoría, monto y cuenta. Guarda con el botón o desliza.'
  },
  inicio: {
    title: 'Ver mi mes',
    body: 'Consulta tu saldo, resumen, pagos próximos y distribución de gastos.'
  },
  presupuesto: {
    title: 'Planear mi mes',
    body: 'Define gastos por periodo y consulta cuánto te queda.'
  },
  compras: {
    title: 'Ir de compras',
    body: 'Crea una lista o usa el carrito. Al confirmar, los productos se registran como gastos.'
  },
  lista: {
    title: 'Qué comprar',
    body: 'Anota productos y márcalos al comprarlos. No afectan tus gastos.'
  },
  ingresos: {
    title: 'Anotar ingreso',
    body: 'Registra el monto, tipo y cuenta de destino.'
  },
  ahorros: {
    title: 'Guardar dinero',
    body: 'Crea metas, registra aportes y consulta su avance.'
  },
  tarjetas: {
    title: 'Mis tarjetas',
    body: 'Registra tarjetas y compras MSI. Marca pagos para evitar duplicados.'
  },
  cuentas: {
    title: 'Mis cuentas',
    body: 'Registra tus cuentas y transfiere saldo entre ellas.'
  },
  prestamos: {
    title: 'Deudas',
    body: 'En "Yo debo" llevas tus préstamos y marcas cada pago sin duplicar gastos. En "Me deben" anotas a quién le prestaste y lo marcas cuando te pague.'
  },
  simulador: {
    title: 'Simulador',
    body: 'Compara decisiones antes de tomarlas: suscripciones, deudas, inversiones, metas y MSI. Nada de lo que veas aquí cambia tus datos.'
  },
  suscripciones: {
    title: 'Mis suscripciones',
    body: 'Registra monto y fecha de cobro; consulta las próximas fechas.'
  },
  inversiones: {
    title: 'Mis inversiones',
    body: 'Registra monto y rendimiento para consultar tus inversiones.'
  },
  deudores: {
    title: 'Quién me debe',
    body: 'Anota préstamos y márcalos como cobrados. No afectan tus gastos.'
  },
  kanban: {
    title: 'Mis pendientes',
    body: 'Organiza tareas y toca una tarjeta para cambiar su estado.'
  },
  recordatorios: {
    title: 'Recordarme algo',
    body: 'Añade una fecha y hora para recibir recordatorios.'
  },
  historial: {
    title: 'Historial completo',
    body: 'Consulta tus entradas y salidas.'
  },
  categorias: {
    title: 'Mis categorías',
    body: 'Crea y organiza tus categorías.'
  }
};

const HEADER_PHRASES = [
  'Cada pequeño paso te acerca a una vida financiera más tranquila.',
  'Tu dinero puede ser más sencillo de entender.',
  'Hoy puedes tomar decisiones con más claridad.',
  'Revisar tus finanzas también es una forma de cuidarte.',
  'Los hábitos pequeños construyen tranquilidad.',
  'Avanzas a tu ritmo; cada paso cuenta.',
  'Mirar tus números te ayuda a elegir con calma.',
  'Tu futuro se construye con decisiones pequeñas.',
  'Más claridad para tu dinero, más tranquilidad para ti.',
  'Cuidar tu quincena también es cuidar de ti.'
];

function updateHeaderPhrase(){
  const sub = $('headerSub');
  const phraseEl = $('headerPhrase');
  if (sub) sub.textContent = state.user_id ? 'Finanzas personales' : 'Sin registrar';
  if (!phraseEl) return;
  const dayKey = new Date().toDateString();
  let phrase = sessionStorage.getItem('abaco_phrase');
  let phraseDay = sessionStorage.getItem('abaco_phrase_day');
  if (!phrase || phraseDay !== dayKey) {
    phrase = HEADER_PHRASES[Math.floor(Math.random() * HEADER_PHRASES.length)];
    sessionStorage.setItem('abaco_phrase', phrase);
    sessionStorage.setItem('abaco_phrase_day', dayKey);
  }
  phraseEl.textContent = phrase;
}

function showPanelHelp(){
  const key = state.activePanel || 'hormiga';
  const h = PANEL_HELP[key] || { title: 'Ayuda', body: 'Explora esta sección con calma. Si algo no cuadra, revisa el historial o tus cuentas.' };
  showDetail('Ayuda · ' + h.title, [], []);
  const body = $('detailBody');
  if (body) {
    const copy = document.createElement('div');
    copy.className = 'help-sheet-body';
    copy.textContent = h.body;
    body.replaceChildren(copy);
  }
}

function renderUpcoming(){
  const list = $('upcomingList');
  const banner = $('cutoffBanner');
  if (!list) return;
  const items = [];
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  // Suscripciones: día de cobro en el mes
  (state.subscriptions||[]).forEach(s => {
    if (!s.date) return;
    const day = parseInt(String(s.date).slice(8,10), 10);
    if (!day) return;
    let next = new Date(y, m, day);
    if (next < new Date(y, m, now.getDate())) next = new Date(y, m + 1, day);
    const diff = Math.ceil((next - now) / 86400000);
    items.push({
      title: s.name,
      meta: money(s.amount) + ' · ' + (typeof subRangeLabel==='function'?subRangeLabel(s.range):'mensual'),
      when: diff <= 0 ? 'Hoy' : (diff === 1 ? 'Mañana' : 'En ' + diff + ' días'),
      warn: diff <= 3,
      ts: next.getTime()
    });
  });
  // MSI próximos no pagados
  (state.msiPlans||[]).forEach(p => {
    const pending = (p.installments||[]).filter(i => !i.paid);
    if (!pending.length) return;
    items.push({
      title: 'MSI · ' + (p.concept||'Plan'),
      meta: money(p.monthly) + ' · ' + pending.length + ' mens. restan',
      when: 'Corte / pago del mes',
      warn: true,
      ts: now.getTime() + 1
    });
  });
  // Préstamos: recordatorio de cuota
  (state.loans||[]).forEach(l => {
    if ((l.paid||0) >= (l.term||0)) return;
    items.push({
      title: 'Cuota · ' + l.name,
      meta: money(l.payment) + ' / mes',
      when: 'Revisa tu fecha de corte',
      warn: false,
      ts: now.getTime() + 2
    });
  });
  items.sort((a,b) => a.ts - b.ts);
  if (!items.length) {
    list.innerHTML = '<div class="note">Sin pagos cercanos. Cuando agregues suscripciones o MSI, aparecerán aquí.</div>';
  } else {
    list.innerHTML = items.slice(0, 8).map(it => `
      <div class="upcoming-row ${it.warn?'warn':''}">
        <div>
          <div style="font-weight:600">${esc(it.title)}</div>
          <div class="when">${esc(it.meta)}</div>
        </div>
        <div class="when">${esc(it.when)}</div>
      </div>`).join('');
  }
  // Banner de corte (día 1-5 o 15-18 como quincena típica MX)
  if (banner) {
    const d = now.getDate();
    let msg = '';
    if (d >= 1 && d <= 5) msg = 'Estás en zona de <strong>corte / quincena de inicio de mes</strong>. Revisa suscripciones y MSI para no llevarte sorpresas.';
    else if (d >= 14 && d <= 18) msg = 'Se acerca o estás en la <strong>quincena</strong>. Buen momento para mirar lo que falta por pagar.';
    else if (d >= 27) msg = 'Cierra el mes con calma: checa <strong>préstamos, tarjetas y suscripciones</strong> antes del próximo corte.';
    if (msg) {
      banner.classList.remove('hidden');
      banner.innerHTML = msg;
    } else {
      banner.classList.add('hidden');
      banner.innerHTML = '';
    }
  }
}


/* Navegación Android: el botón del sistema controla la app, no el historial web. */
let lastAndroidBack = 0;
function closeTopLayer() {
  const detail = $('detailOverlay');
  if (detail?.classList.contains('open')) { closeDetail(); return true; }
  const calc = $('calcPage');
  if (calc?.classList.contains('open')) { closeCalc(); return true; }
  const menu = $('menuPage');
  if (menu?.classList.contains('open')) { closeMenu(); return true; }
  const budgetEntry = $('budgetEntryPanel');
  if (budgetEntry && !budgetEntry.classList.contains('hidden')) { closeBudgetEntry(); return true; }
  const savePanel = $('saveMenuPanel');
  if (savePanel && !savePanel.classList.contains('hidden')) { savePanel.classList.add('hidden'); return true; }
  const subForm = $('subFormPanel');
  if (subForm && !subForm.classList.contains('hidden')) { closeSubForm(); return true; }
  const opForms = ['shopFormPanel','incFormPanel','cardFormPanel','accountFormPanel','loanFormPanel'];
  for (const fid of opForms) {
    const f = $(fid);
    if (f && !f.classList.contains('hidden')) { closeOpForm(fid); return true; }
  }
  const charts = $('chartsBlock');
  if (charts && !charts.classList.contains('hidden-soft')) { charts.classList.add('hidden-soft'); return true; }
  return false;
}
function handleAndroidBack() {
  if (closeTopLayer()) return;
  const currentPanel = state.activePanel || 'hormiga';
  if (currentPanel !== 'inicio') {
    goPanel('inicio');
    return;
  }
  const now = Date.now();
  if (now - lastAndroidBack < 1800) {
    const appPlugin = window.Capacitor?.Plugins?.App;
    if (appPlugin?.exitApp) appPlugin.exitApp();
    else toast('La aplicación permanece abierta');
    lastAndroidBack = 0;
  } else {
    lastAndroidBack = now;
    toast('Presiona volver otra vez para salir');
  }
}
function setupAndroidNavigation() {
  const appPlugin = window.Capacitor?.Plugins?.App;
  if (appPlugin?.addListener) {
    try { appPlugin.addListener('backButton', handleAndroidBack); } catch (e) {}
  }
  document.addEventListener('backbutton', e => {
    e.preventDefault();
    handleAndroidBack();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') handleAndroidBack();
  });
  try {
    history.pushState({philoApp: true}, '', location.href);
    window.addEventListener('popstate', () => {
      history.pushState({philoApp: true}, '', location.href);
      handleAndroidBack();
    });
  } catch (e) {}
}

function todayInputValue(){ const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
/* El tour de bienvenida vive en js/abaco-tour.js. Se marca como pendiente para que updateUI no lo cierre. */
function startWalletQuiz(){ if(!LS('wallet_quiz')){state.walletQuiz={done:false};LS_SET('wallet_quiz',JSON.stringify(state.walletQuiz));} window.AbacoTour&&AbacoTour.start(); $('onboarding').classList.remove('hidden'); $('onboarding').classList.add('wallet-fullscreen'); $('step-register').classList.add('hidden'); $('step-wallet').classList.remove('hidden'); }
function finishWalletQuiz(skip=false){ state.walletQuiz={done:true,skipped:!!skip}; LS_SET('wallet_quiz',JSON.stringify(state.walletQuiz)); $('step-wallet')?.classList.add('hidden'); $('onboarding')?.classList.add('hidden'); $('onboarding')?.classList.remove('wallet-fullscreen'); $('appPanels')?.classList.remove('hidden'); goPanel('inicio'); updateUI(); }
function nextWalletQuiz(){ if(window.AbacoTour) AbacoTour.next(); else finishWalletQuiz(false); }

function renderMenu() {
  const list = $('menuList');
  if (!list) return;
  const overdue = getOverdueReminders().length;
  updateBackupStatusLabel();
  const active = state.activePanel || 'inicio';
  const tile = (t, big) => {
    const meta = NAV_META[t] || { label: t };
    const badge = (t === 'recordatorios' && overdue) ? `<span class="menu-badge">${overdue}</span>` : '';
    return `<button type="button" class="menu-tile${big ? ' big' : ''}${t === active ? ' on' : ''}" data-go="${t}">${navIconSvg(t)}<span>${meta.label}</span>${badge}</button>`;
  };
  /* Modo calmado: arriba lo que más usas; el resto, plegado hasta pedirlo. */
  const fav = window.AbacoCalm ? AbacoCalm.favorites() : ['ingresos','presupuesto','tarjetas','ahorros'];
  const open = !!(window.AbacoCalm && AbacoCalm.menuAllOpen);
  const others = MENU_GROUPS.reduce((n, g) => n + g.items.length, 0) - fav.length;
  $('menuPage')?.classList.toggle('all-open', open);
  list.innerHTML = `<div class="menu-section">Lo que más usas</div><div class="menu-fav">${fav.map(t => tile(t, true)).join('')}</div>`
    + `<button type="button" class="menu-all" id="menuAllToggle" aria-expanded="${open}"><span>Todas las secciones</span><span class="menu-all-n">${others} ${open ? '⌃' : '⌄'}</span></button>`
    + (open ? MENU_GROUPS.map(group => `<div class="menu-section">${group.label}</div><div class="menu-grid">${group.items.map(t => tile(t, false)).join('')}</div>`).join('') : '');
}

/* Barra inferior fija: Inicio, Movimientos, Registrar, Estadísticas, Cuentas. Las pantallas que no
   están en la barra iluminan la más cercana (las de "Contigo" y consulta, Estadísticas; las de dinero, Cuentas). */
const BAR_ITEMS = ['inicio','historial','hormiga','estadisticas','cuentas'];
const BAR_PARENT = { cartas:'estadisticas', decisiones:'estadisticas', pactos:'estadisticas', config:'estadisticas', categorias:'estadisticas' };
const BAR_ICON_PLUS = '<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>';
function renderPinned(){
  const bar=$('pinnedBar'); if(!bar)return;
  const active=state.activePanel||'hormiga';
  const lit=BAR_ITEMS.includes(active)?active:(BAR_PARENT[active]||'cuentas');
  bar.classList.add('has-pins');
  document.querySelector('.app')?.classList.add('has-bottom-nav');
  bar.innerHTML=BAR_ITEMS.map(t=>{
    const label=(NAV_META[t]||{label:t}).label;
    const icon=t==='hormiga'?BAR_ICON_PLUS:navIconSvg(t);
    return `<button type="button" class="pinned-chip ${t===lit?'active-pin':''}" data-go="${t}" title="${label}" aria-label="${label}"><span class="pin-ico">${icon}</span><span class="pin-label">${label}</span></button>`;
  }).join('');
}

function setupMenuSwipe() {
  if(window.__abacoMenuControllerV3)return;window.__abacoMenuControllerV3=true;
  const menu=$('menuPage'),overlay=$('menuOverlay'),app=document.querySelector('.app');if(!menu||!app)return;let dragging=false,startX=0,startY=0;
  const isOpen=()=>menu.classList.contains('open');const reset=()=>{menu.style.transition='';menu.style.transform='';if(overlay){overlay.style.transition='';overlay.style.opacity='';overlay.style.pointerEvents='';}};
  app.addEventListener('touchstart',e=>{if(!isOpen()||e.target.closest?.('input,textarea,select,button')){dragging=false;return;}const t=e.touches[0];startX=t.clientX;startY=t.clientY;dragging=true;},{passive:true});
  app.addEventListener('touchmove',e=>{if(!dragging||!isOpen())return;const t=e.touches[0],dx=t.clientX-startX,dy=t.clientY-startY;if(Math.abs(dy)>Math.abs(dx)+8){dragging=false;reset();return;}if(dx>0){const w=menu.offsetWidth||300,pos=Math.min(w,dx);menu.style.transition='none';menu.style.transform=`translateX(${pos}px)`;if(overlay){overlay.style.transition='none';overlay.style.opacity=String(1-pos/w);}}},{passive:true});
  app.addEventListener('touchend',e=>{if(!dragging)return;dragging=false;const dx=e.changedTouches[0].clientX-startX,dy=e.changedTouches[0].clientY-startY;reset();if(!isOpen())return;if(dx>56&&Math.abs(dx)>Math.abs(dy)*.85)closeMenu();else openMenu();},{passive:true});
  app.addEventListener('touchcancel',()=>{dragging=false;reset();if(isOpen())openMenu();},{passive:true});overlay.onclick=closeMenu;
  document.addEventListener('pointerdown',e=>{if(!isOpen())return;if(e.target.closest?.('#menuPage')||e.target.closest?.('#btnMenuHeader'))return;closeMenu();},true);
}

/* goPanel() vive una sola vez, más abajo, junto al resto de funciones de
   panel — así no hay dos definiciones que puedan desincronizarse. */

function updateUI() {
  const hasUser = !!state.user_id;
  const showApp = hasUser && (state.walletQuiz?.done || !LS('wallet_quiz'));
  $('onboarding').classList.toggle('hidden', showApp);
  $('appPanels').classList.toggle('hidden', !showApp);
  $('menuEdgeHint') && ($('menuEdgeHint').style.display = showApp ? '' : 'none');
  $('pinnedBar') && ($('pinnedBar').style.display = showApp ? '' : 'none');
  $('btnHelpHeader') && ($('btnHelpHeader').style.visibility = hasUser ? 'visible' : 'hidden');
  $('btnCalcHeader') && ($('btnCalcHeader').style.visibility = hasUser ? 'visible' : 'hidden');
  $('step-register').classList.toggle('hidden', hasUser);

  if(hasUser) {
    $('avatar').textContent = state.user_name.charAt(0).toUpperCase();
    $('headerName').textContent = state.user_name;
    $('headerSub').textContent = 'Modo personal';
  }
  if(state.shopMode) {
    $('shopNormal').classList.add('hidden');
    $('shopModeActive').classList.remove('hidden');
    renderCart();
  } else {
    $('shopNormal').classList.remove('hidden');
    $('shopModeActive').classList.add('hidden');
  }
  save();
}

function expenseDetail(e) {
  showDetail(e.description||'Gasto', [
    {lbl:'Monto', val: money(e.amount)},
    {lbl:'Categoría', val: catName(e.category)},
    {lbl:'Quién', val: whoLabel(e.user_id)},
    {lbl:'Fecha', val: formatDate(e.created_at)},
    {lbl:'Tipo', val: e.shared?'Compartido':'Personal'},
  ], [
    { label: '🗑️ Borrar', danger: true, onClick: () => deleteExpense(e.id) }
  ]);
}
function incomeDetail(i) {
  showDetail(i.description||'Ingreso', [
    {lbl:'Monto', val: money(i.amount)},
    {lbl:'Tipo', val: i.type||''},
    {lbl:'Quién', val: whoLabel(i.user_id)},
    {lbl:'Fecha', val: formatDate(i.created_at)},
    {lbl:'Ámbito', val: i.shared?'Compartido':'Personal'},
  ], [
    { label: '🗑️ Borrar', danger: true, onClick: () => deleteIncome(i.id) }
  ]);
}

function renderHormiga() {
  $('hormChips').innerHTML = state.categories.map(c =>
    `<div class="chip ${state.hormCat===c.id?'active':''}" data-val="${esc(c.id)}">${esc(c.icon)} ${esc(c.name)}</div>`
  ).join('');
  $('hormChips').querySelectorAll('.chip').forEach(ch => {
    ch.onclick = () => { state.hormCat=ch.dataset.val; renderHormiga(); };
  });
}

/* Gráficas del tablero de Inicio. Se atienden por delegación (data-home en index.html). */
function toggleHomeCharts(){
  const chartBlock=$('chartsBlock'), chartBack=$('chartsModalBackdrop');
  if(!chartBlock) return;
  const open=!chartBlock.classList.contains('chart-modal-open');
  chartBlock.classList.toggle('hidden-soft',!open);
  chartBlock.classList.toggle('chart-modal-open',open);
  if(chartBack) chartBack.classList.toggle('hidden',!open);
  document.querySelector('.app')?.classList.toggle('charts-open',open);
  if(open) setTimeout(()=>chartBlock.scrollTop=0,20);
}
function closeHomeCharts(){
  const chartBlock=$('chartsBlock'), chartBack=$('chartsModalBackdrop');
  chartBlock?.classList.remove('chart-modal-open');
  chartBlock?.classList.add('hidden-soft');
  chartBack?.classList.add('hidden');
  document.querySelector('.app')?.classList.remove('charts-open');
}

function renderInicio() {
  ensureFinancialCore();
  const chips = $('accountViewChips');
  if (chips) {
    const views = [{id:'todas',label:'Todas'},{id:'efectivo',label:'Efectivo'},{id:'débito',label:'Débito'},{id:'crédito',label:'Crédito'},{id:'liquidez',label:'Efectivo + Débito'}];
    const cur = state.accountView || 'todas';
    chips.innerHTML = views.map(v=>`<button type="button" class="chip ${cur===v.id?'active':''}" data-av="${v.id}">${v.label}</button>`).join('');
    
  }
  const incomesForBalance = state.incomes;
  const expBalance = state.expenses;
  const expPersonal = state.expenses;

  const totalInc = incomesForBalance.reduce((s,i)=>s+(i.amount||0),0);
  const totalExp = expBalance.reduce((s,e)=>s+(e.amount||0),0);
  const personalTotal = expPersonal.reduce((s,e)=>s+(e.amount||0),0);
  let available = walletLiquidity();
  const view = state.accountView || 'todas';
  const balanceNode = document.querySelector('.balance-card');
  if (balanceNode) { balanceNode.classList.remove('account-switching'); void balanceNode.offsetWidth; balanceNode.classList.add('account-switching'); }
  try {
    if (view === 'efectivo' || view === 'débito') {
      available = accountsByType(view).reduce((s,a)=>s+safeNum(a.balance),0);
    } else if (view === 'crédito') {
      available = -accountsByType('crédito').reduce((s,a)=>s+Math.max(0,safeNum(a.balance)),0);
    } else if (view === 'liquidez') {
      available = walletLiquidity();
    } else {
      available = walletLiquidity();
    }
  } catch(e) {}
  if ($('balanceLabel')) {
    const labels = {todas:'Disponible', efectivo:'Efectivo', 'débito':'Débito', 'crédito':'Crédito', liquidez:'Efectivo + Débito'};
    $('balanceLabel').textContent = labels[view] || 'Disponible';
  }
  $('balanceValue').textContent = money(available);
  if (view === 'crédito') {
    try {
      const msiPending = (state.msiPlans||[]).reduce((s,p)=>s+((p.installments||[]).filter(i=>!i.paid).reduce((x,i)=>x+safeNum(i.amount),0)),0);
      if ($('balanceMotto') && msiPending>0) $('balanceMotto').textContent = 'MSI pendientes: '+money(msiPending);
    } catch(e) {}
  }

  $('totalIngresos').textContent = money(totalInc);
  $('totalGastos').textContent = money(totalExp);

  // Ring + motto
  const pctUsed = totalInc > 0 ? Math.min(100, Math.round((totalExp/totalInc)*100)) : 0;
  const ring = $('balanceRing');
  if (ring) ring.style.setProperty('--pct', pctUsed + '%');
  if ($('balanceRingPct')) $('balanceRingPct').textContent = pctUsed + '%';
  let motto = '¡' + (typeof greetWord==='function'?greetWord():'Bienvenido') + '!';
  if (available > 0) motto = '¡Estás ahorrando! 🌟';
  else if (available < 0) motto = 'Este mes gastaste más... revisa hábitos 💡';
  else motto = 'Vas justo, ¡sin deudas! 💪';
  if ($('balanceMotto')) $('balanceMotto').textContent = motto;

  // Wrapped
  const byCat = {};
  expBalance.forEach(e => { byCat[e.category]=(byCat[e.category]||0)+e.amount; });
  const top = Object.entries(byCat).sort((a,b)=>b[1]-a[1])[0];
  $('wTopCat').textContent = top ? (catIcon(top[0])+' '+catName(top[0])) : '—';
  const reminderCount = (state.reminders||[]).filter(r=>!r.done && !r.completed).length;
  const activeSubs = (state.subscriptions||[]).filter(x=>x.active!==false).length;
  const pendingMsi = (state.msiPlans||[]).reduce((sum,p)=>sum+(p.installments||[]).filter(i=>!i.paid).length,0);
  const pendingCredit = (state.msiPlans||[]).reduce((sum,p)=>sum+(p.installments||[]).filter(i=>!i.paid).reduce((x,i)=>x+safeNum(i.amount),0),0);
  $('wReminders').textContent = String(reminderCount);
  $('wSubs').textContent = String(activeSubs);
  $('wMsi').textContent = String(pendingMsi);
  $('wCreditPending').textContent = money(pendingCredit);
  $('wIncome').textContent = money(totalInc);
  $('wLine').textContent = motto;

  // Profiles
  const myExp = state.expenses.filter(e=>e.user_id===state.user_id).reduce((s,e)=>s+e.amount,0);
  const otherExp = state.expenses.filter(e=>e.user_id!==state.user_id).reduce((s,e)=>s+e.amount,0);
  const myTop = {};
  state.expenses.filter(e=>e.user_id===state.user_id).forEach(e=>{myTop[e.category]=(myTop[e.category]||0)+e.amount;});
  const myTopCat = Object.entries(myTop).sort((a,b)=>b[1]-a[1])[0];
  const savingsRate = totalInc > 0 ? Math.round((Math.max(0, available) / totalInc) * 100) : 0;
  const insightItems = [
    {n: top ? catName(top[0]) : '—', t: 'Categoría principal'},
    {n: savingsRate + '%', t: 'Margen disponible'},
    {n: String(expBalance.length), t: 'Gastos registrados'}
  ];
  $('profilesBox').innerHTML = insightItems.map(x => `<div class="profile-card"><div class="pn">${esc(x.n)}</div><div class="pt">${x.t}</div></div>`).join('');

  // Category scroll - all categories
  const maxCat = Math.max(1, ...Object.values(byCat), 1);
  const catEl = $('catGrid');
  if (catEl) {
    catEl.innerHTML = state.categories.map(c => {
      const amt = byCat[c.id]||0;
      const pct = Math.round((amt/maxCat)*100);
      return `<div class="cat-tile">
        <div class="ci">${esc(c.icon)}</div>
        <div class="cn">${esc(c.name)}</div>
        <div class="cp">${money(amt)}</div>
        <div class="bar"><div style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
  }

  // Waterfall
  const maxV = Math.max(totalInc,totalExp,1);
  const topCats = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const remain = Math.max(0,available);
  let bars = `<div class="wf-col"><div class="wf-bar income" style="height:${Math.round(totalInc/maxV*80)}px"></div><div class="wf-label">Ing.<br>${money(totalInc)}</div></div>`;
  topCats.forEach(([cat,amt]) => {
    bars += `<div class="wf-col"><div class="wf-bar expense" style="height:${Math.round(amt/maxV*80)}px"></div><div class="wf-label">${catIcon(cat)}<br>${money(amt)}</div></div>`;
  });
  bars += `<div class="wf-col"><div class="wf-bar remain" style="height:${Math.round(remain/maxV*80)}px"></div><div class="wf-label">Queda<br>${money(remain)}</div></div>`;
  if ($('waterfallBars')) $('waterfallBars').innerHTML = bars;

  try { renderBudgetHealth(expBalance, incomesForBalance); } catch (e) { console.warn(e); }
  const recent = [
    ...state.expenses.map(e=>({...e,_t:'exp'})),
    ...state.incomes.map(i=>({...i,_t:'inc'})),
    ...(state.historial||[]).filter(h=>h.source && !['hormiga','ingresos','compras'].includes(h.source)).map(h=>({
      id:h.id, description:h.description, amount:h.amount, created_at:h.created_at, user_id:h.user_id,
      _t: h.direction==='in'?'inc':'exp'
    })),
  ].sort((a,b)=>(b.created_at||0)-(a.created_at||0)).slice(0,12);
  if(!recent.length) {
    $('recentList').innerHTML='<div class="empty"><p>Aún no hay movimientos. Cuando registres algo, aparecerá aquí.</p></div>';
  } else {
    $('recentList').innerHTML = recent.map(m => `
      <div class="item" data-tid="${m._t}" data-id="${m.id}">
        <div class="item-icon ${m._t==='inc'?'inc':'exp'}">${m._t==='inc'?'💰':catIcon(m.category)}</div>
        <div class="item-body">
          <div class="item-title">${esc(m.description||'?')} ${m._t==='exp'?`<span class="pill ${m.shared?'shared':'personal'}">${m.shared?'Comp.':'Pers.'}</span>`:''}</div>
          <div class="item-meta">${esc(whoLabel(m.user_id))} · ${timeAgo(m.created_at)}</div>
          ${reactHtml(m.id)}
        </div>
        <div class="item-amount ${m._t==='inc'?'pos':'neg'}">${m._t==='inc'?'+':'-'}${money(m.amount)}</div>
      </div>
    `).join('');
    $('recentList').querySelectorAll('.item').forEach(el => {
      const id=el.dataset.id, t=el.dataset.tid;
      if(t==='exp'){ const e=state.expenses.find(x=>x.id===id); if(e) bindLongPress(el,()=>expenseDetail(e),()=>expenseDetail(e)); }
      else { const i=state.incomes.find(x=>x.id===id); if(i) bindLongPress(el,()=>incomeDetail(i),()=>incomeDetail(i)); }
    });
  }
  // Movimientos del día: una sola lista, ordenada y uniforme.
  const dayStart = new Date(); dayStart.setHours(0,0,0,0);
  const todayItems = [
    ...state.expenses.filter(e => (e.created_at||0) >= dayStart.getTime()).map(e=>({...e,_t:'exp'})),
    ...state.incomes.filter(i => (i.created_at||0) >= dayStart.getTime()).map(i=>({...i,_t:'inc'}))
  ].sort((a,b)=>(b.created_at||0)-(a.created_at||0));
  const todayEl = $('todayList');
  if(todayEl){
    todayEl.innerHTML = todayItems.length ? todayItems.map(m => `<div class="item today-item">
      <div class="item-icon ${m._t==='inc'?'inc':'exp'}">${m._t==='inc'?'💰':catIcon(m.category)}</div>
      <div class="item-body"><div class="item-title">${esc(m.description||'Movimiento')}</div><div class="item-meta">${m._t==='inc'?'Ingreso':'Gasto'} · ${new Date(m.created_at||Date.now()).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div></div>
      <div class="item-amount ${m._t==='inc'?'pos':'neg'}">${m._t==='inc'?'+':'-'}${money(m.amount)}</div>
    </div>`).join('') : '<div class="empty"><p>No hay movimientos registrados hoy.</p></div>';
  }
  try { renderUpcoming(); } catch(e) {}
  try { updateHeaderPhrase(); } catch(e) {}
}


/* ===== Gráficas por apartado Dinero ===== */
const MONEY_CHART_KEYS = ['ahorros','prestamos','inversiones'];
function moneyChartPref(key){
  if(!state.moneyChartPrefs) state.moneyChartPrefs = {};
  if(!state.moneyChartPrefs[key]) state.moneyChartPrefs[key] = {open:false, period:'mensual'};
  return state.moneyChartPrefs[key];
}
function periodRange(period){
  const now = Date.now();
  if(period==='semanal') return {start: now - 7*86400000, end: now};
  if(period==='quincenal') return {start: now - 15*86400000, end: now};
  const d = new Date();
  return {start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), end: now};
}
function inPeriod(ts, period){
  if(ts==null || ts===undefined || ts==='') return false;
  let t = ts;
  if(typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ts)) t = new Date(ts).getTime();
  t = Number(t);
  if(!Number.isFinite(t)) return false;
  const r = periodRange(period);
  return t >= r.start && t <= r.end;
}
function periodLabel(p){ return p==='semanal'?'semana':p==='quincenal'?'quincena':'mes'; }
function scaleFromMonthly(monthly, period){
  if(period==='semanal') return monthly * 12 / 52;
  if(period==='quincenal') return monthly / 2;
  return monthly;
}
function collectMoneyChartData(key, period){
  const bars = [];
  const activities = [];
  let total = 0;
  if(key==='compras'){
    const items = [
      ...state.expenses.filter(e => e.fromShop && inPeriod(e.created_at, period)),
      ...state.historial.filter(h => inPeriod(h.created_at, period))
    ];
    const byName = {};
    items.forEach(it => {
      const name = it.description || it.name || 'Compra';
      byName[name] = (byName[name]||0) + safeNum(it.amount);
      activities.push({title: name, meta: formatDate(it.created_at), amount: safeNum(it.amount), neg:true});
    });
    Object.entries(byName).sort((a,b)=>b[1]-a[1]).slice(0,8).forEach(([name,amt]) => bars.push({label:name, amount:amt}));
    total = items.reduce((s,i)=>s+safeNum(i.amount),0);
  } else if(key==='ingresos'){
    const items = state.incomes.filter(i => inPeriod(i.created_at, period));
    const byType = {};
    items.forEach(i => {
      const t = i.type || 'otro';
      byType[t] = (byType[t]||0) + safeNum(i.amount);
      activities.push({title: i.description||'Ingreso', meta: (i.type||'')+' · '+formatDate(i.created_at), amount: safeNum(i.amount), neg:false});
    });
    Object.entries(byType).sort((a,b)=>b[1]-a[1]).forEach(([name,amt]) => bars.push({label:name, amount:amt}));
    total = items.reduce((s,i)=>s+safeNum(i.amount),0);
  } else if(key==='ahorros'){
    (state.savings||[]).forEach(s => {
      bars.push({label: s.name, amount: safeNum(s.current)});
      activities.push({title: s.name, meta: (s.type==='open'?'Abierto':'Meta '+money(s.target))+(s.annualRate?` · ${s.annualRate}%`:''), amount: safeNum(s.current), neg:false});
    });
    total = (state.savings||[]).reduce((s,x)=>s+safeNum(x.current),0);
  } else if(key==='tarjetas'){
    (state.msiPlans||[]).forEach(p => {
      const monthly = safeNum(p.monthly);
      const amt = scaleFromMonthly(monthly, period);
      bars.push({label: p.concept, amount: amt});
      const paid = (p.installments||[]).filter(i=>i.paid).length;
      activities.push({title: p.concept, meta: `${paid}/${p.months} pagadas · ${money(monthly)}/mes`, amount: amt, neg:true});
    });
    total = bars.reduce((s,b)=>s+b.amount,0);
  } else if(key==='cuentas'){
    (state.accounts||[]).forEach(a => {
      bars.push({label: a.name, amount: Math.max(0, safeNum(a.balance))});
      activities.push({title: a.name, meta: a.type||'cuenta', amount: safeNum(a.balance), neg:false});
    });
    (state.transfers||[]).filter(t => inPeriod(t.created_at, period)).forEach(t => {
      const from = (state.accounts.find(a=>a.id===t.from)||{}).name || 'Origen';
      const to = (state.accounts.find(a=>a.id===t.to)||{}).name || 'Destino';
      activities.push({title: `Transferencia ${from} → ${to}`, meta: formatDate(t.created_at), amount: safeNum(t.amount), neg:false});
    });
    total = bars.reduce((s,b)=>s+b.amount,0);
  } else if(key==='prestamos'){
    (state.loans||[]).forEach(l => {
      const monthly = safeNum(l.payment);
      const amt = scaleFromMonthly(monthly, period);
      bars.push({label: l.name, amount: amt});
      activities.push({title: l.name, meta: `${l.paid||0}/${l.term} pagos · ${money(monthly)}/mes`, amount: amt, neg:true});
    });
    total = bars.reduce((s,b)=>s+b.amount,0);
  } else if(key==='suscripciones'){
    (state.subscriptions||[]).forEach(s => {
      const monthly = monthlyEquivalent(s);
      const amt = scaleFromMonthly(monthly, period);
      bars.push({label: s.name, amount: amt});
      activities.push({title: s.name, meta: `${subRangeLabel(s.range)} · ${esc(s.date||'—')}`, amount: amt, neg:true});
    });
    total = bars.reduce((s,b)=>s+b.amount,0);
  } else if(key==='deudores'){
    (state.debtors||[]).filter(d => !d.settled).forEach(d => {
      bars.push({label: d.person, amount: safeNum(d.amount)});
      activities.push({title: d.person, meta: (d.concept||'Préstamo')+(d.date?' · '+d.date:''), amount: safeNum(d.amount), neg:false});
    });
    total = bars.reduce((s,b)=>s+b.amount,0);
  } else if(key==='inversiones'){
    (state.investments||[]).forEach(inv => {
      bars.push({label: inv.name, amount: safeNum(inv.amount)});
      activities.push({title: inv.name, meta: (inv.rate?inv.rate+'% · ':'')+(inv.date||''), amount: safeNum(inv.amount), neg:false});
    });
    total = bars.reduce((s,b)=>s+b.amount,0);
  }
  activities.sort((a,b)=>(b.amount||0)-(a.amount||0));
  return {bars, activities, total, count: activities.length};
}
function renderMoneyChartBlock(key){
  const pref = moneyChartPref(key);
  const btn = document.querySelector(`.money-chart-toggle[data-money-key="${key}"]`);
  const block = $(`moneyCharts-${key}`);
  if(btn){
    btn.textContent = pref.open ? '📊 Ocultar gráficas' : '📊 Mostrar gráficas';
  }
  if(block){
    block.classList.toggle('hidden-soft', !pref.open);
  }
  const chips = document.querySelector(`.money-period-chips[data-money-key="${key}"]`);
  if(chips){
    chips.querySelectorAll('.chip').forEach(ch => ch.classList.toggle('active', ch.dataset.period === pref.period));
  }
  if(!pref.open) return;
  const data = collectMoneyChartData(key, pref.period);
  const stats = $(`moneyChartStats-${key}`);
  if(stats){
    stats.innerHTML = `<div class="stat"><div class="n">${data.count}</div><div class="l">Movimientos</div></div>
      <div class="stat"><div class="n">${money(data.total)}</div><div class="l">Total periodo</div></div>
      <div class="stat"><div class="n">${periodLabel(pref.period)}</div><div class="l">Vista</div></div>`;
  }
  const barsEl = $(`moneyChartBars-${key}`);
  if(barsEl){
    if(!data.bars.length){
      barsEl.innerHTML = '<div class="empty" style="width:100%"><p>Sin datos en este periodo</p></div>';
    } else {
      const maxV = Math.max(1, ...data.bars.map(b => b.amount));
      barsEl.innerHTML = data.bars.map(b => {
        const h = Math.max(6, Math.round((b.amount/maxV)*100));
        return `<div class="sub-bar-col">
          <div class="sub-bar-amt">${money(b.amount)}</div>
          <div class="sub-bar" style="height:${h}px"></div>
          <div class="sub-bar-label" title="${esc(b.label)}">${esc(b.label)}</div>
        </div>`;
      }).join('');
    }
  }
  const act = $(`moneyActivity-${key}`);
  if(act){
    if(!data.activities.length){
      act.innerHTML = '<div class="empty"><p>Sin actividad en este periodo</p></div>';
    } else {
      act.innerHTML = data.activities.slice(0, 20).map(a => `
        <div class="item">
          <div class="item-icon ${a.neg?'exp':'inc'}">${a.neg?'📉':'📈'}</div>
          <div class="item-body">
            <div class="item-title">${esc(a.title)}</div>
            <div class="item-meta">${esc(a.meta||'')}</div>
          </div>
          <div class="item-amount ${a.neg?'neg':'pos'}">${a.neg?'-':'+'}${money(a.amount)}</div>
        </div>`).join('');
    }
  }
}
function renderAllMoneyCharts(){
  MONEY_CHART_KEYS.forEach(k => {
    try { renderMoneyChartBlock(k); } catch(e){ console.warn('money chart', k, e); }
  });
}
function setupMoneyChartsUI(){
  document.querySelectorAll('.money-chart-toggle').forEach(btn => {
    btn.onclick = () => {
      const key = btn.dataset.moneyKey;
      const pref = moneyChartPref(key);
      pref.open = !pref.open;
      save();
      renderMoneyChartBlock(key);
    };
  });
  document.querySelectorAll('.money-period-chips').forEach(wrap => {
    wrap.querySelectorAll('.chip').forEach(ch => {
      ch.onclick = () => {
        const key = wrap.dataset.moneyKey;
        const pref = moneyChartPref(key);
        pref.period = ch.dataset.period || 'mensual';
        pref.open = true;
        save();
        renderMoneyChartBlock(key);
      };
    });
  });
}

function renderShop() {
  if(!state.shop.length){ $('shopList').innerHTML='<div class="empty"><p>Lista vacía</p></div>'; return; }
  $('shopList').innerHTML = state.shop.map(s => s.status==='pending' ? `
    <div class="item standby">
      <div class="item-icon shop">🛒</div>
      <div class="item-body"><div class="item-title">${esc(s.name)} <span class="pill standby-pill">Espera</span></div>
      <div class="item-meta">${money(s.price||0)}</div></div>
      <button class="btn btn-primary btn-sm" type="button" data-shop-action="accept" data-shop-id="${esc(s.id)}">✓</button>
      <button class="btn btn-ghost btn-sm" type="button" data-shop-action="decline" data-shop-id="${esc(s.id)}">✕</button>
    </div>` : `
    <div class="item"><div class="item-icon shop">🛒</div>
    <div class="item-body"><div class="item-title">${esc(s.name)}</div><div class="item-meta">aceptado</div></div></div>`
  ).join('');
  $('shopList').querySelectorAll('[data-shop-action]').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.shopAction === 'accept') acceptShop(btn.dataset.shopId);
      else if (btn.dataset.shopAction === 'decline') declineShop(btn.dataset.shopId);
    };
  });
}
function renderCart() {
  if(!state.shopMode) return;
  const total=state.cart.reduce((s,c)=>s+(c.price||0),0);
  const avail=state.shopMode.budget||0;
  $('shopAvail').textContent=money(avail); $('cartTotal').textContent=money(total);
  $('shopRemainLabel').textContent='Restante: '+money(avail-total);
  $('cartList').innerHTML = state.cart.length ? state.cart.map((c,i)=>`
    <div class="item"><div class="item-icon shop">🛍️</div><div class="item-body"><div class="item-title">${esc(c.name)}</div></div>
    <div class="item-amount neg">${money(c.price)}</div>
    <button class="btn btn-ghost btn-sm" type="button" data-cart-remove="${i}">✕</button></div>`).join('') : '<div class="empty"><p>Carrito vacío</p></div>';
  $('cartList').querySelectorAll('[data-cart-remove]').forEach(btn => {
    
  });
}

function renderIncomes() {
  if(!state.incomes.length){ $('incomeList').innerHTML='<div class="empty"><p>Sin ingresos</p></div>'; return; }
  $('incomeList').innerHTML = [...state.incomes].sort((a,b)=>(b.created_at||0)-(a.created_at||0)).map(i=>`
    <div class="item" data-id="${i.id}">
      <div class="item-icon inc">💰</div>
      <div class="item-body">
        <div class="item-title">${esc(i.description)}</div>
        <div class="item-meta">${esc(whoLabel(i.user_id))} · ${timeAgo(i.created_at)}</div>
        ${reactHtml(i.id)}
      </div>
      <div class="item-amount pos">+${money(i.amount)}</div>
    </div>`).join('');
  $('incomeList').querySelectorAll('.item').forEach(el => {
    const i = state.incomes.find(x => x.id === el.dataset.id);
    if (i) bindLongPress(el, () => incomeDetail(i), () => incomeDetail(i));
  });
}


/* ===== Eventos y módulos ===== */
function safeNum(v){ const n=Number(v); return Number.isFinite(n) ? n : 0; }
function ensureUser(){ if(!state.user_id){ toast('Primero dinos tu nombre, porfa'); return false; } return true; }

function accountsByType(type){
  const t = (type||'').toLowerCase();
  return (state.accounts||[]).filter(a => (a.type||'').toLowerCase() === t || (t==='débito' && (a.type||'').toLowerCase()==='debito') || (t==='crédito' && (a.type||'').toLowerCase()==='credito'));
}
function getAccount(id){ return (state.accounts||[]).find(a=>a.id===id) || null; }
function firstLiquidAccount(){
  ensureDefaultAccounts();
  return state.accounts.find(a=>['efectivo','débito','debito'].includes((a.type||'').toLowerCase())) || null;
}
let calcValue='0', calcPrev=null, calcOp=null, calcFresh=true, calcExpressionText='';
function openCalc(){ $('calcPage')?.classList.add('open'); $('calcOverlay')?.classList.add('open'); document.querySelector('.app')?.classList.add('calc-open'); }
function closeCalc(){ $('calcPage')?.classList.remove('open'); $('calcOverlay')?.classList.remove('open'); document.querySelector('.app')?.classList.remove('calc-open'); }
function updateCalcDisplay(){
  if($('calcDisplay')) $('calcDisplay').textContent=calcValue;
  if($('calcExpression')) $('calcExpression').textContent=calcExpressionText;
}
function updatePendingCalcExpression(){
  if(calcOp!==null&&calcPrev!==null){
    calcExpressionText=`${calcPrev} ${calcOp}${calcFresh?'':` ${calcValue}`}`;
  }
}
function calcInput(key){
  if(key==='C'){ calcValue='0'; calcPrev=null; calcOp=null; calcFresh=true; calcExpressionText=''; updateCalcDisplay(); return; }
  if(key==='±'){ calcValue=String(-(parseFloat(calcValue)||0)); updatePendingCalcExpression(); updateCalcDisplay(); return; }
  if(key==='%'){ calcValue=String((parseFloat(calcValue)||0)/100); updatePendingCalcExpression(); updateCalcDisplay(); return; }
  if(['+','-','×','÷'].includes(key)){
    if(calcOp&&!calcFresh) calcEquals();
    calcPrev=parseFloat(calcValue)||0; calcOp=key; calcFresh=true;
    calcExpressionText=`${calcPrev} ${calcOp}`; updateCalcDisplay(); return;
  }
  if(key==='='){ calcEquals(); return; }
  if(key==='.'){
    if(calcFresh){calcValue='0.';calcFresh=false;} else if(!calcValue.includes('.')) calcValue+='.';
    updatePendingCalcExpression(); updateCalcDisplay(); return;
  }
  if(calcFresh||calcValue==='0'){ calcValue=key; calcFresh=false; if(calcOp===null) calcExpressionText=''; } else calcValue+=key;
  updatePendingCalcExpression();
  updateCalcDisplay();
}
function calcEquals(){
  if(calcOp==null||calcPrev==null) return;
  const a=calcPrev, op=calcOp, b=parseFloat(calcValue)||0; let r=a;
  if(op==='+') r=a+b; if(op==='-') r=a-b; if(op==='×') r=a*b; if(op==='÷') r=b===0?0:a/b;
  calcExpressionText=`${a} ${op} ${calcValue} =`;
  calcValue=String(Math.round(r*1e8)/1e8); calcOp=null; calcPrev=null; calcFresh=true; updateCalcDisplay();
}
function setupCalculator(){
  const grid=$('calcGrid'); if(!grid) return;
  const keys=['C','±','%','÷','7','8','9','×','4','5','6','-','1','2','3','+','0','.','='];
  grid.innerHTML=keys.map(k=>{const cls=['+','-','×','÷','%','±'].includes(k)?'op':(k==='='?'eq':'');return `<button type="button" class="${cls}" data-k="${k}">${k}</button>`;}).join('');
  grid.querySelectorAll('button').forEach(b=>b.onclick=()=>calcInput(b.dataset.k));
  if($('btnCloseCalc')) $('btnCloseCalc').onclick=closeCalc;
  if($('calcOverlay')) $('calcOverlay').onclick=closeCalc;
  // Apertura solo por botón (header), sin gesto de borde
}
function renderDebtors(){
  const list=$('debtorsList'); if(!list)return;
  const items=(state.debtors||[]).filter(d=>!d.settled).sort((a,b)=>(b.created_at||0)-(a.created_at||0));
  if(!items.length){list.innerHTML='<div class="empty"><p>Nadie te debe por ahora</p></div>';return;}
  list.innerHTML=items.map(d=>`<div class="item" data-debt-id="${d.id}"><div class="item-icon inc">🤝</div><div class="item-body"><div class="item-title">${esc(d.person)}</div><div class="item-meta">${esc(d.concept||'Préstamo')}${d.date?' · '+d.date:''}</div></div><div class="item-amount pos">${money(d.amount)}</div><button type="button" class="btn btn-ghost btn-sm" data-debt-del="${d.id}">✕</button></div>`).join('');
  
  list.querySelectorAll('.item').forEach(el=>{
    const d=(state.debtors||[]).find(x=>x.id===el.dataset.debtId); if(!d)return;
    el.onclick=e=>{ if(e.target.closest('[data-debt-del]'))return;
      showDetail(d.person,[{lbl:'Monto',val:money(d.amount)},      {lbl:'Concepto',val:d.concept||'—'},{lbl:'Fecha',val:d.date||'Sin fecha'}],[
        {label:'✓ Ya me pagó',onClick:()=>settleDebtor(d.id)},{label:'🗑️ Borrar',danger:true,onClick:()=>deleteDebtor(d.id)}]); };
  });
}
function renderInvestments(){
  const list=$('investList'); if(!list)return;
  const items=[...(state.investments||[])].sort((a,b)=>(b.created_at||0)-(a.created_at||0));
  if(!items.length){list.innerHTML='<div class="empty"><p>Sin inversiones aún</p></div>';return;}
  list.innerHTML=items.map(inv=>`<div class="item" data-inv-id="${inv.id}"><div class="item-icon inc">📈</div><div class="item-body"><div class="item-title">${esc(inv.name)}</div><div class="item-meta">${inv.rate?inv.rate+'% anual':'Sin tasa'}${inv.date?' · '+inv.date:''}</div></div><div class="item-amount pos">${money(inv.amount)}</div><button type="button" class="btn btn-ghost btn-sm" data-inv-del="${inv.id}">✕</button></div>`).join('');
  
  list.querySelectorAll('.item').forEach(el=>{
    const inv=(state.investments||[]).find(x=>x.id===el.dataset.invId); if(!inv)return;
    el.onclick=e=>{ if(e.target.closest('[data-inv-del]'))return;
      showDetail(inv.name,[{lbl:'Monto',val:money(inv.amount)},{lbl:'Rendimiento',val:inv.rate?inv.rate+'%':'—'},{lbl:'Fecha',val:inv.date||'—'},{lbl:'Nota',val:inv.note||'—'}],[{label:'🗑️ Borrar',danger:true,onClick:()=>deleteInvestment(inv.id)}]); };
  });
}
function renderSubCalendar(){
  const el=$('subCalendar'); if(!el||el.classList.contains('hidden')) return;
  const now=new Date(); const y=now.getFullYear(), m=now.getMonth();
  const first=new Date(y,m,1); const startPad=(first.getDay()+6)%7; const daysInMonth=new Date(y,m+1,0).getDate();
  const byDay={}; (state.subscriptions||[]).forEach(s=>{ if(!s.date)return; const d=parseInt(String(s.date).slice(8,10),10); if(!d)return; (byDay[d]=byDay[d]||[]).push(s); });
  let html=['L','M','M','J','V','S','D'].map(d=>`<div class="dow">${d}</div>`).join('');
  for(let i=0;i<startPad;i++) html+=`<div class="sub-cal-day"></div>`;
  for(let day=1;day<=daysInMonth;day++){ const has=byDay[day]; html+=`<div class="sub-cal-day ${has?'has-sub':''} ${day===now.getDate()?'today':''}" title="${has?has.map(s=>s.name).join(', '):''}">${day}${has?'<div class="dot"></div>':''}</div>`; }
  el.innerHTML=`<div class="note" style="margin-bottom:8px">${now.toLocaleString('es',{month:'long',year:'numeric'})}</div><div class="sub-cal-grid">${html}</div>`;
}


function openOpForm(id){ const el=$(id); if(el) el.classList.remove('hidden'); }
function closeOpForm(id){ const el=$(id); if(el) el.classList.add('hidden'); }


function greetWord(){
  const p = state.pronoun || 'el';
  if (p === 'ella') return 'Bienvenida';
  if (p === 'neutro') return 'Bienvenida/o';
  return 'Bienvenido';
}
function addressLabel(){
  const p = state.pronoun || 'el';
  if (p === 'ella') return 'lista';
  if (p === 'neutro') return 'listo/a';
  return 'listo';
}
function applyPronounUI(){
  const p = state.pronoun || 'el';
  if ($('welcomeTitle')) {
    $('welcomeTitle').textContent = (p==='ella'?'Bienvenida':'Bienvenido') + ' a Ábaco';
  }
  const motto = $('balanceMotto');
  if (motto && /Bienvenid/i.test(motto.textContent||'')) {
    motto.textContent = greetWord() + '!';
  }
  const item = $('btnPronounMenu');
  if (item) {
    const lab = item.querySelector('.menu-item-label');
    if (lab) lab.textContent = 'Pronombres';
  }
  document.querySelectorAll('#pronounChoice [data-pronoun], #pronounNeutro').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pronoun === p);
  });
}
function cyclePronoun(){
  const order = ['el','ella','neutro'];
  const i = order.indexOf(state.pronoun||'el');
  state.pronoun = order[(i+1)%order.length];
  LS_SET('user_pronoun', state.pronoun);
  save(); applyPronounUI();
  toast(state.pronoun==='ella'?'Te trataremos en femenino':state.pronoun==='neutro'?'Trato neutro':'Te trataremos en masculino');
}
function registerUser(){
  try {
    const name=($('userName')?.value||'').trim();
    if(!name){toast('Escribe tu nombre');$('userName')?.focus();return false;}
    state.user_id=state.user_id||uid();
    state.user_name=name;
    state.pronoun=state.pronoun||'el';
    LS_SET('user_id',state.user_id); LS_SET('user_name',state.user_name); LS_SET('app_mode','personal'); LS_SET('user_pronoun',state.pronoun);
    try{ save(true); }catch(e){ console.warn('Abaco register save',e); }
    updateHeaderPhrase(); startWalletQuiz(); updateUI(); return true;
  } catch(e) {
    console.error('Abaco registerUser',e); toast('No se pudo guardar el registro. Intenta de nuevo.'); return false;
  }
}


function showJoin(){
  $('joinSection').style.display='block';
  $('joinCodeInput')?.focus();
}







/* Salud del gasto personal vs salario (50/30/20) */
const NEED_CATS = new Set(['comida','transporte','hogar','salud','servicios','renta','luz','agua','gas','educacion','escuela']);
const WANT_CATS = new Set(['ocio','entretenimiento','compras','ropa','restaurante','cafe','viajes','streaming','suscripciones','gustos']);

function classifyExpenseBucket(catId) {
  const id = (catId || 'general').toLowerCase();
  if (NEED_CATS.has(id)) return 'need';
  if (WANT_CATS.has(id)) return 'want';
  // general y desconocidas: mitad necesidad / mitad gusto (conservador: need)
  if (id === 'general' || id === 'otros') return 'need';
  // por nombre de categoría personalizada
  const name = (catName(id) || '').toLowerCase();
  if (/comida|super|mercado|renta|casa|hogar|luz|agua|gas|salud|medico|transporte|gasolina|colegio|escuela/.test(name)) return 'need';
  if (/ocio|cine|juego|ropa|gusto|viaje|fiesta|streaming|netflix|spotify|cafe|antojo/.test(name)) return 'want';
  return 'need';
}

function monthSalary(incomes) {
  // Preferir tipo salario; si no hay, suma de ingresos del mes
  const sal = incomes.filter(i => {
    const t = (i.type || '').toLowerCase();
    return t === 'salario' || t === 'nomina' || t === 'nómina' || t === 'sueldo';
  });
  if (sal.length) return sal.reduce((s, i) => s + safeNum(i.amount), 0);
  return incomes.reduce((s, i) => s + safeNum(i.amount), 0);
}

function renderBudgetHealth(expBalance, incomesForBalance) {
  const track = $('bhTrack');
  const adviceEl = $('bhAdvice');
  const noteEl = $('bhSalaryNote');
  if (!track || !adviceEl) return;

  const salary = monthSalary(incomesForBalance || []);
  let need = 0, want = 0;
  (expBalance || []).forEach(e => {
    const b = classifyExpenseBucket(e.category);
    if (b === 'want') want += safeNum(e.amount);
    else need += safeNum(e.amount);
  });
  // Ahorro del mes: aportes a ahorros + inversiones + lo no gastado del ingreso
  const now = Date.now();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const ms = monthStart.getTime();
  const saveFromGoals = (state.savings || []).reduce((s, sav) => {
    // no historial fino de aportes: usar 0; el "ahorro" principal es residual
    return s;
  }, 0);
  const invMonth = (state.investments || []).filter(i => (i.created_at || 0) >= ms).reduce((s, i) => s + safeNum(i.amount), 0);
  const totalSpent = need + want;
  const residual = Math.max(0, salary - totalSpent);
  const saveAmt = residual + invMonth + saveFromGoals;

  const ideal = { need: 0.50, want: 0.30, save: 0.20 };

  if (salary <= 0) {
    track.innerHTML = '<div class="note">Aún no hay ingresos este mes. Registra tu salario en Ingresos para activar el diagnóstico.</div>';
    adviceEl.className = 'bh-advice warn';
    adviceEl.innerHTML = '<div class="bh-title">🌱 Empieza por tu ingreso</div><div>Cuando anotes tu salario (o ingresos del mes), podremos decirte si tus gastos respetan una división sana: <b>50% necesidades · 30% gustos · 20% ahorro</b>.</div>';
    if (noteEl) noteEl.textContent = '';
    return;
  }

  const pct = (v) => Math.round((v / salary) * 1000) / 10;
  const pNeed = pct(need), pWant = pct(want), pSave = pct(saveAmt);
  // barra relativa al ideal (ideal = 100% del ancho de meta; overshoot se corta visualmente a 140%)
  const barW = (actualPct, idealPct) => Math.min(140, Math.round((actualPct / (idealPct * 100)) * 100));

  function status(actualPct, idealFrac, kind) {
    const idealPct = idealFrac * 100;
    const diff = actualPct - idealPct;
    // para ahorro, estar por debajo es malo; para need/want, estar por encima es malo
    if (kind === 'save') {
      if (actualPct >= idealPct * 0.85) return 'ok';
      if (actualPct >= idealPct * 0.5) return 'warn';
      return 'bad';
    }
    if (actualPct <= idealPct * 1.1) return 'ok';
    if (actualPct <= idealPct * 1.35) return 'warn';
    return 'bad';
  }

  const stNeed = status(pNeed, ideal.need, 'need');
  const stWant = status(pWant, ideal.want, 'want');
  const stSave = status(pSave, ideal.save, 'save');

  const fillClass = (st, isSave) => {
    if (st === 'ok') return isSave ? 'bh-fill-save' : 'bh-fill-ok';
    if (st === 'warn') return 'bh-fill-warn';
    return 'bh-fill-bad';
  };

  const rows = [
    { key: 'need', name: '🏠 Necesidades', ideal: 50, actual: pNeed, amount: need, st: stNeed, idealFrac: 0.5 },
    { key: 'want', name: '✨ Gustos', ideal: 30, actual: pWant, amount: want, st: stWant, idealFrac: 0.3 },
    { key: 'save', name: '💚 Ahorro / lo que queda', ideal: 20, actual: pSave, amount: saveAmt, st: stSave, idealFrac: 0.2, isSave: true },
  ];

  track.innerHTML = rows.map(r => {
    const w = Math.min(100, Math.round((r.actual / 100) * 100)); // % del salario como ancho de barra completa = 100% ingreso
    const idealLeft = r.ideal; // marca vertical en % del ingreso
    return `<div class="bh-row">
      <div class="bh-row-top">
        <span class="bh-name">${r.name}</span>
        <span class="bh-nums">${money(r.amount)} · <b>${r.actual}%</b> <span style="opacity:.7">(ideal ${r.ideal}%)</span></span>
      </div>
      <div class="bh-bar-bg">
        <div class="bh-bar-fill ${fillClass(r.st, r.isSave)}" style="width:${Math.min(100, r.actual)}%"></div>
        <div class="bh-bar-ideal" style="left:${r.ideal}%" title="Ideal ${r.ideal}%"></div>
      </div>
    </div>`;
  }).join('');

  // Score global
  const scores = { ok: 0, warn: 0, bad: 0 };
  [stNeed, stWant, stSave].forEach(s => scores[s]++);
  let level = 'ok';
  if (scores.bad >= 1 || scores.warn >= 2) level = scores.bad >= 2 ? 'bad' : 'warn';
  if (scores.ok === 3) level = 'ok';

  const tips = [];
  if (stNeed === 'bad') tips.push('Tus <b>necesidades</b> se comen más del 50% del ingreso. Revisa renta, comida y transporte: hay gastos fijos que se pueden negociar o recortar un poco.');
  else if (stNeed === 'warn') tips.push('Vas un poco arriba en <b>necesidades</b>. No es grave, pero conviene vigilar supermercado y gasolina este mes.');
  else tips.push('Bien: tus <b>necesidades</b> están cerca del 50% recomendado.');

  if (stWant === 'bad') tips.push('Los <b>gustos</b> se pasaron del 30%. Los antojos y el ocio están pesando: prueba un tope semanal solo para “extras”.');
  else if (stWant === 'warn') tips.push('Los <b>gustos</b> van un poco altos. Un café menos o un streaming de menos puede bastar para equilibrar.');
  else tips.push('Tus <b>gustos</b> respetan el margen del 30%. Se nota disciplina amable.');

  if (stSave === 'bad') tips.push('El <b>ahorro</b> quedó corto (ideal ~20%). Antes de fin de mes, aparta aunque sea un porcentaje chico apenas te paguen.');
  else if (stSave === 'warn') tips.push('Estás ahorrando, pero aún no llegas al 20%. Cada aporte cuenta; súbelo un poco cuando puedas.');
  else tips.push('Excelente: estás reservando cerca del 20% (o más). Tu yo del futuro te lo agradece.');

  let title = '💚 Vas bien encaminado';
  if (level === 'warn') title = '🌤️ Te estás desviando un poco';
  if (level === 'bad') title = '🚦 El mes se está yendo de las manos';

  adviceEl.className = 'bh-advice ' + level;
  adviceEl.innerHTML = `<div class="bh-title">${title}</div>
    <div>Referencia sana sobre tu ingreso: <b>50% necesidades · 30% gustos · 20% ahorro</b>.</div>
    <ul>${tips.map(t => `<li>${t}</li>`).join('')}</ul>`;

  if (noteEl) {
    const usedSal = monthSalary(incomesForBalance) === incomesForBalance.filter(i => /salario|nomina|nómina|sueldo/i.test(i.type||'')).reduce((s,i)=>s+safeNum(i.amount),0) && incomesForBalance.some(i => /salario|nomina|nómina|sueldo/i.test(i.type||''));
    noteEl.textContent = usedSal
      ? 'Usando tu salario registrado este mes · ' + money(salary)
      : 'Usando el total de ingresos del mes como base · ' + money(salary);
  }
}


function showAllCategoriesModal(){
  const rows=state.categories.map(c=>{
    const total=state.expenses.filter(e=>e.category===c.id).reduce((s,e)=>s+safeNum(e.amount),0);
    return {lbl:(c.icon||'📦')+' '+c.name,val:money(total)};
  });
  showDetail('Todas las categorías', rows.length?rows:[{lbl:'Estado',val:'Sin categorías'}]);
}

function addShop(){
  if(!ensureUser()) return;
  const name=($('shopItem')?.value||'').trim(), price=safeNum($('shopPrice')?.value);
  if(!name){ toast('Escribe el producto'); $('shopItem')?.focus(); return; }
  if(price<0){ toast('El precio no puede ser negativo'); return; }
  const item={id:uid(),name,price,status:'pending',user_id:state.user_id,created_at:Date.now()};
  state.shop.push(item);  save(); $('shopItem').value=''; $('shopPrice').value=''; renderShop(); toast('Añadido a la lista');
}
function acceptShop(id){ const s=state.shop.find(x=>x.id===id); if(!s)return; s.status='accepted';  save(); renderShop(); toast('Compra aceptada'); }
function declineShop(id){ state.shop=state.shop.filter(x=>x.id!==id);  save(); renderShop(); toast('Compra descartada'); }

/* Lista de compras (checklist semanal: súper, papelería, despensa) */
const LISTA_CAT_META = {
  super: {ico:'🛒', label:'Súper'},
  papeleria: {ico:'✏️', label:'Papelería'},
  despensa: {ico:'🏠', label:'Despensa'},
  otro: {ico:'📦', label:'Otro'},
};
function addChecklistItem(){
  if(!ensureUser()) return;
  const text=($('listaItem')?.value||'').trim();
  if(!text){ toast('Escribe el producto'); $('listaItem')?.focus(); return; }
  const qty=($('listaQty')?.value||'').trim();
  const cat=$('listaCatChips')?.querySelector('.chip.active')?.dataset.val || 'otro';
  const item={id:uid(),text,qty,cat,done:false,user_id:state.user_id,created_at:Date.now()};
  state.checklist.push(item);
  
  save();
  $('listaItem').value=''; $('listaQty').value='';
  renderChecklist();
  toast('Añadido a la lista');
}
function toggleChecklistItem(id){
  const it=state.checklist.find(x=>x.id===id); if(!it) return;
  it.done=!it.done;
  
  save(); renderChecklist();
}
function deleteChecklistItem(id){
  state.checklist=state.checklist.filter(x=>x.id!==id);
  
  save(); renderChecklist();
}
async function clearChecklistDone(){
  const doneCount = state.checklist.filter(x=>x.done).length;
  if(!doneCount){ toast('No hay comprados que vaciar'); return; }
  if(!await askConfirm('¿Quitar los '+doneCount+' productos ya comprados?')) return;
  state.checklist = state.checklist.filter(x=>!x.done);
  state.checklist=state.checklist.filter(x=>!x.done);
  save(); renderChecklist();
}
function checklistItemHtml(it){
  const meta=LISTA_CAT_META[it.cat]||LISTA_CAT_META.otro;
  return `<div class="item ${it.done?'lista-done':''}" data-lid="${it.id}">
    <div class="item-icon task">${meta.ico}</div>
    <div class="item-body">
      <div class="item-title">${esc(it.text)}${it.qty?` · ${esc(it.qty)}`:''}</div>
      <div class="item-meta">${meta.label}</div>
    </div>
    <button type="button" class="btn btn-ghost btn-sm" data-lista-toggle="${it.id}">${it.done?'↩':'✓'}</button>
    <button type="button" class="btn btn-ghost btn-sm" data-lista-del="${it.id}">✕</button>
  </div>`;
}
function renderChecklist(){
  const pendEl=$('listaPendItems'), doneEl=$('listaDoneItems'), doneTitle=$('listaDoneTitle');
  if(!pendEl||!doneEl) return;
  const filter=state.checklistFilter||'todos';
  const all=state.checklist.filter(it=>filter==='todos'||it.cat===filter);
  const pend=all.filter(it=>!it.done).sort((a,b)=>(b.created_at||0)-(a.created_at||0));
  const done=all.filter(it=>it.done).sort((a,b)=>(b.created_at||0)-(a.created_at||0));
  pendEl.innerHTML = pend.length ? pend.map(checklistItemHtml).join('') : '<div class="empty"><p>Nada pendiente por comprar</p><p class="note">Toca ＋ para agregar el primer producto.</p></div>';
  doneTitle.classList.toggle('hidden', done.length===0);
  doneEl.innerHTML = done.map(checklistItemHtml).join('');
  [pendEl, doneEl].forEach(el=>{
    
    
  });
}
function startShopMode(){
  const budget=safeNum($('shopBudget')?.value); if(budget<=0){ toast('Indica un presupuesto'); return; }
  state.shopMode={budget,started_at:Date.now()}; state.cart=[]; save(); updateUI(); toast('Modo compras iniciado');
}
function addCart(){
  const name=($('cartItem')?.value||'').trim(), price=safeNum($('cartPrice')?.value);
  if(!name){toast('Escribe el producto');return;} if(price<0){toast('Precio inválido');return;}
  state.cart.push({id:uid(),name,price}); save(); renderCart(); $('cartItem').value=''; $('cartPrice').value=''; toast('Añadido al carrito');
}
function removeCart(i){ if(i<0||i>=state.cart.length)return; state.cart.splice(i,1); save(); renderCart(); }
function cancelShop(){ state.shopMode=null; state.cart=[]; save(); updateUI(); toast('Compra cancelada'); }

function savingsYieldEstimate(s){
  const rate=safeNum(s.annualRate);
  if(rate<=0||safeNum(s.current)<=0)return 0;
  const start=s.lastYieldAt||s.created_at||Date.now();
  const months=Math.max(0,(Date.now()-start)/(1000*60*60*24*30.44));
  return safeNum(s.current)*(rate/100)*months/12;
}
function renderSavings(){
  const list=$('saveList'); if(!list)return;
  const saves=state.savings||[];
  if(!saves.length){list.innerHTML='<div class="empty"><p>Sin ahorros aún</p></div>'; renderSaveSelect(); return;}
  list.innerHTML=saves.map(s=>{
    const target=s.type==='open'?0:safeNum(s.target), current=safeNum(s.current);
    const pct=target?Math.min(100,Math.round(current/target*100)):0, estimate=savingsYieldEstimate(s);
    return `<div class="item" data-save-id="${s.id}">
      <div class="item-icon inc">🏦</div>
      <div class="item-body">
        <div class="item-title">${esc(s.name)}</div>
        <div class="item-meta">${s.type==='open'?'Abierto':money(current)+' / '+money(target)}${s.annualRate?` · ${s.annualRate}% anual`:''}${s.note?' · '+esc(s.note):''}</div>
        ${target?`<div class="progress"><div style="width:${pct}%"></div></div>`:''}
        ${estimate?`<div class="item-meta">Rendimiento estimado pendiente: ${money(estimate)}</div>`:''}
      </div>
      <div class="item-amount pos">${money(current)}</div>
    </div>`;
  }).join('');
  list.querySelectorAll('.item').forEach(el=>el.onclick=()=>{
    const s=saves.find(x=>x.id===el.dataset.saveId); if(!s)return;
    const estimate=savingsYieldEstimate(s);
    const actions=[{label:'🗑️ Borrar',danger:true,onClick:()=>deleteSaving(s.id)}];
    if(estimate>0) actions.unshift({label:'＋ Aplicar rendimiento',onClick:()=>applySavingYield(s.id)});
    showDetail(s.name,[
      {lbl:'Actual',val:money(s.current)},
      {lbl:'Meta',val:s.type==='open'?'Abierto':money(s.target)},
      {lbl:'Rendimiento anual',val:s.annualRate?`${s.annualRate}%`:'Sin configurar'},
      {lbl:'Estimado pendiente',val:money(estimate)},
      {lbl:'Nota',val:s.note||'—'}
    ],actions);
  });
  renderSaveSelect();
}
function renderSaveSelect(){ const sel=$('saveSelect'); if(!sel)return; sel.innerHTML=(state.savings||[]).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join(''); }
function toggleSaveMenu(){ $('saveMenuPanel')?.classList.toggle('hidden'); renderSaveSelect(); }
function switchSaveTab(tab){ const isNew=tab==='new'; $('saveTabNew')?.classList.toggle('active',isNew); $('saveTabAdd')?.classList.toggle('active',!isNew); $('saveFormNew')?.classList.toggle('hidden',!isNew); $('saveFormAdd')?.classList.toggle('hidden',isNew); }

const BUDGET_PERIODS={
  mensual:{label:'Mensual',description:'Tu presupuesto mensual, claro y sin ruido.'},
  quincenas:{label:'2 quincenas',description:'Divide tu dinero en dos momentos de pago.'},
  semanas:{label:'4 semanas',description:'Planea una cantidad para cada semana.'}
};
function budgetPeriodLabel(){return BUDGET_PERIODS[state.budgetPeriod]?.label||BUDGET_PERIODS.mensual.label;}
function appendBudgetInputRow(values={}){
  const wrap=$('budgetRows'); if(!wrap)return;
  const row=document.createElement('div'); row.className='excel-grid';
  row.innerHTML='<input type="text" data-budget-field="concept" placeholder="Concepto"><input type="text" data-budget-field="description" placeholder="Descripción"><input type="number" data-budget-field="amount" placeholder="$" inputmode="decimal"><button type="button" class="excel-remove" aria-label="Quitar fila">×</button>';
  row.querySelector('[data-budget-field="concept"]').value=values.concept||'';
  row.querySelector('[data-budget-field="description"]').value=values.description||'';
  row.querySelector('[data-budget-field="amount"]').value=values.amount||'';
  row.querySelector('.excel-remove').onclick=()=>{if(wrap.children.length>1)row.remove();};
  wrap.appendChild(row);
}
function openBudgetEntry(){
  const panel=$('budgetEntryPanel'); if(!panel)return;
  panel.classList.remove('hidden'); $('budgetRows').innerHTML='';
  const current=state.budgets.filter(b=>b.period===state.budgetPeriod);
  (current.length?current:[{}]).forEach(appendBudgetInputRow);
  $('budgetRows').querySelector('input')?.focus();
}
function closeBudgetEntry(){ $('budgetEntryPanel')?.classList.add('hidden'); }
function setBudgetPeriod(period){
  if(!BUDGET_PERIODS[period])return;
  state.budgetPeriod=period; LS_SET('budget_period',period);
  $('budgetPeriodChips').querySelectorAll('.chip').forEach(ch=>ch.classList.toggle('active',ch.dataset.budgetPeriod===period));
  $('budgetPeriodLabel').textContent=BUDGET_PERIODS[period].description;
  closeBudgetEntry(); renderBudget();
}
function renderBudget(){
  if(window.AbacoCalm){ AbacoCalm.renderSobres(); return; }
  const period=state.budgetPeriod||'mensual', items=state.budgets.filter(b=>b.period===period);
  $('budgetPeriodLabel').textContent=BUDGET_PERIODS[period]?.description||BUDGET_PERIODS.mensual.description;
  $('budgetPeriodChips').querySelectorAll('.chip').forEach(ch=>ch.classList.toggle('active',ch.dataset.budgetPeriod===period));
  const planned=items.reduce((sum,b)=>sum+safeNum(b.amount),0), spent=items.reduce((sum,b)=>sum+safeNum(b.spent),0), remaining=planned-spent;
  $('budgetSummary').innerHTML=`<div class="stat"><div class="n">${money(planned)}</div><div class="l">Planeado</div></div><div class="stat"><div class="n">${money(spent)}</div><div class="l">Gastado</div></div><div class="stat"><div class="n">${money(remaining)}</div><div class="l">Disponible</div></div>`;
  $('budgetList').innerHTML=items.length?items.map(b=>{
    const pct=b.amount?Math.min(100,Math.round(safeNum(b.spent)/b.amount*100)):0;
    return `<div class="budget-row"><div class="budget-row-top"><div class="item-title">${esc(b.concept)}<div class="budget-desc">${esc(b.description||'Sin descripción')}</div></div><div class="item-amount">${money(b.amount)}</div></div><div class="progress"><div style="width:${pct}%"></div></div><div class="module-kpis"><span>Gastado <b>${money(b.spent||0)}</b></span><span>Queda <b>${money(safeNum(b.amount)-safeNum(b.spent))}</b></span><button type="button" class="btn btn-ghost btn-sm" data-budget-spend="${b.id}">Actualizar</button><button type="button" class="btn btn-ghost btn-sm" data-budget-del="${b.id}">×</button></div></div>`;
  }).join(''):'<div class="empty"><p>Tu plan está vacío. Captura tu primer gasto planeado.</p></div>';
  
  
}

function renderCardSelect(){
  const select=$('msiCardSelect'); if(!select)return;
  select.innerHTML=state.cards.length?state.cards.map(c=>`<option value="${c.id}">${esc(c.name)} · ${esc(c.type)}</option>`).join(''):'<option value="">Primero agrega una tarjeta</option>';
}
/* Detalle completo de una tarjeta (planes a meses y acciones). Lo usa la hoja de js/abaco-calm.js. */
function cardDetailHtml(card){
    const plans=state.msiPlans.filter(p=>p.cardId===card.id);
    return `<div class="form-card" data-card-id="${card.id}"><div class="budget-row-top"><div><div class="item-title">💳 ${esc(card.name)}</div><div class="account-type">${esc(card.type)} · Límite ${money(card.limit||0)}</div></div><div class="account-balance">${money(card.balance||0)}</div></div><div class="row mt-6"><button type="button" class="btn btn-ghost btn-sm" data-card-edit="${card.id}">Editar</button><button type="button" class="btn btn-ghost btn-sm" data-card-del="${card.id}">Borrar</button></div>${plans.length?plans.map(p=>{const paid=p.installments.filter(i=>i.paid).length;return `<div class="module-note mt-6"><div class="budget-row-top"><b>${esc(p.concept)}</b><b>${money(p.monthly)}/mes</b></div><div class="module-kpis"><span>${paid}/${p.months} mensualidades pagadas</span><span>Total ${money(p.total)}</span></div>${p.installments.map((i,idx)=>`<div class="msi-row"><div class="item-body"><b>Mes ${i.number}</b><div class="item-meta">${formatDate(i.due)}</div></div><span class="status-pill ${i.paid?'paid':''}">${i.paid?'Pagada':'Pendiente'}</span><button class="btn btn-ghost btn-sm" type="button" data-msi-paid="${p.id}:${idx}">${i.paid?'Desmarcar':'Marcar pagada'}</button></div>`).join('')}</div>`;}).join(''):'<p class="note mt-6">Sin compras a MSI.</p>'}</div>`;
}
function renderCards(){
  renderCardSelect();
  const list=$('cardList'); if(!list)return;
  if(window.AbacoCalm){ AbacoCalm.renderTarjetas(); return; }
  if(!state.cards.length){list.innerHTML='<div class="empty"><p>Aún no tienes tarjetas o cuentas registradas.</p></div>';return;}
  list.innerHTML=state.cards.map(cardDetailHtml).join('');
}

function loanPayment(principal,annualRate,months){
  const rate=safeNum(annualRate)/100/12;
  return rate?principal*rate/(1-Math.pow(1+rate,-months)):principal/months;
}
function renderLoans(){
  const list=$('loanList');if(!list)return;
  list.innerHTML=state.loans.length?state.loans.map(l=>{const pct=Math.round(l.paid/l.term*100),remaining=Math.max(0,l.term-l.paid);return `<div class="form-card"><div class="budget-row-top"><div><div class="item-title">🏦 ${esc(l.name)}</div><div class="account-type">${esc(l.type)} · ${l.annualRate||0}% anual</div></div><div class="loan-payment">${money(l.payment)}/mes</div></div><div class="progress"><div style="width:${pct}%"></div></div><div class="module-kpis"><span>${l.paid}/${l.term} pagos</span><span>Restan ${remaining}</span><button type="button" class="btn btn-purple btn-sm" data-loan-pay="${l.id}" ${remaining?'':'disabled'}>${remaining?'Marcar pago':'Liquidado'}</button></div></div>`;}).join(''):'<div class="empty"><p>Sin préstamos por ahora. Cuando tengas uno, agrégalo aquí.</p></div>';
  
}

const SUB_RANGE_LABELS = {mensual:'Mensual', quincenal:'Quincenal', semanal:'Semanal'};
function subRangeLabel(r){ return SUB_RANGE_LABELS[r] || 'Mensual'; }
function openSubForm(){
  const panel = $('subFormPanel');
  if(!panel) return;
  panel.classList.remove('hidden');
  state.subRange = state.subRange || 'mensual';
  const chips = $('subRangeChips');
  if(chips) chips.querySelectorAll('.chip').forEach(ch => ch.classList.toggle('active', ch.dataset.val === state.subRange));
  setTimeout(() => $('subName')?.focus(), 80);
}
function closeSubForm(){
  const panel = $('subFormPanel');
  if(panel) panel.classList.add('hidden');
}
function addSubscription(){
  if(!ensureUser()) return;
  const name=($('subName')?.value||'').trim();
  const amount=safeNum($('subAmount')?.value);
  const dateVal=$('subDate')?.value||'';
  const range=state.subRange||'mensual';
  if(!name){ toast('Escribe el nombre'); $('subName')?.focus(); return; }
  if(amount<=0){ toast('Indica un monto válido'); return; }
  if(!dateVal){ toast('Elige una fecha'); return; }
  const item={
    id:uid(),
    name,
    amount,
    date: dateVal,
    range,
    user_id: state.user_id,
    created_at: Date.now()
  };
  state.subscriptions.push(item);
  
  save();
  renderSubscriptions();
  ['subName','subAmount'].forEach(id=>{ if($(id)) $(id).value=''; });
  if($('subDate')) $('subDate').value='';
  closeSubForm();
  toast('Suscripción guardada');
}
async function editSubscription(id){
  const s=state.subscriptions.find(x=>x.id===id); if(!s) return;
  const r=await askFields({title:'Editar suscripción',fields:[
    {id:'name',label:'Nombre',value:s.name},
    {id:'amount',label:'Monto $',value:String(s.amount),type:'number',inputmode:'decimal'},
    {id:'date',label:'Fecha de cobro (AAAA-MM-DD)',value:s.date||todayInputValue(),placeholder:'2026-11-15'}
  ],confirmLabel:'Guardar'});
  if(!r) return;
  const name=r.name.trim()||s.name, amount=Math.max(0,safeNum(r.amount));
  const date=r.date.trim()||s.date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(new Date(date+'T12:00:00').getTime())){toast('La fecha debe tener el formato AAAA-MM-DD');return;}
  s.name=name; s.amount=amount; s.date=date;
  save(); renderSubscriptions(); renderInicio(); toast('Suscripción actualizada');
}
async function deleteSubscription(id){
  if(!await askConfirm('¿Borrar esta suscripción?')) return;
  state.subscriptions = state.subscriptions.filter(s => s.id !== id);
  
  save();
  closeDetail();
  renderSubscriptions();
  toast('Suscripción borrada');
}
function subscriptionDetail(s){
  showDetail(s.name || 'Suscripción', [
    {lbl:'Monto', val: money(s.amount)},
    {lbl:'Fecha', val: s.date || '—'},
    {lbl:'Rango', val: subRangeLabel(s.range)},
    {lbl:'Equiv. mensual', val: money(monthlyEquivalent(s))},
    {lbl:'Creada', val: formatDate(s.created_at)},
  ], [
    { label: '✏️ Editar', onClick: () => editSubscription(s.id) },
    { label: '🗑️ Borrar', danger: true, onClick: () => deleteSubscription(s.id) }
  ]);
}
function monthlyEquivalent(s){
  const a = safeNum(s.amount);
  if(s.range==='semanal') return a * 52 / 12;
  if(s.range==='quincenal') return a * 2;
  return a;
}
function renderSubChart(subs){
  const bars = $('subChartBars');
  const empty = $('subChartEmpty');
  if(!bars) return;
  if(!subs.length){
    bars.innerHTML = '';
    if(empty) empty.style.display = '';
    return;
  }
  if(empty) empty.style.display = 'none';
  const items = subs.map(s => ({name: s.name, monthly: monthlyEquivalent(s)})).sort((a,b)=>b.monthly-a.monthly);
  const maxV = Math.max(1, ...items.map(i => i.monthly));
  bars.innerHTML = items.map(i => {
    const h = Math.max(6, Math.round((i.monthly / maxV) * 100));
    return `<div class="sub-bar-col">
      <div class="sub-bar-amt">${money(i.monthly)}</div>
      <div class="sub-bar" style="height:${h}px"></div>
      <div class="sub-bar-label" title="${esc(i.name)}">${esc(i.name)}</div>
    </div>`;
  }).join('');
}
function renderSubscriptions(){
  const list = $('subList');
  const summary = $('subSummary');
  if(!list) return;
  const subs = [...(state.subscriptions||[])].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const monthlyTotal = subs.reduce((sum,s)=>sum+monthlyEquivalent(s),0);
  const count = subs.length;
  if(summary){
    summary.innerHTML = `<div class="stat"><div class="n">${count}</div><div class="l">Activas</div></div>
      <div class="stat"><div class="n">${money(monthlyTotal)}</div><div class="l">Gasto / mes</div></div>
      <div class="stat"><div class="n">${money(monthlyTotal*12)}</div><div class="l">Proyección / año</div></div>`;
  }
  const chips = $('subRangeChips');
  if(chips){
    chips.querySelectorAll('.chip').forEach(ch=>{
      ch.classList.toggle('active', ch.dataset.val === (state.subRange||'mensual'));
    });
  }
  try{renderMoneyChartBlock("suscripciones");}catch(e){}
  if(!subs.length){
    list.innerHTML = '<div class="empty"><p>Cuando agregues suscripciones, las verás aquí</p><p class="note">Toca ＋ para agregar la primera.</p></div>';
    return;
  }
  list.innerHTML = subs.map(s => `
    <div class="item" data-sub-id="${s.id}">
      <div class="item-icon shop">🔁</div>
      <div class="item-body">
        <div class="item-title">${esc(s.name)}</div>
        <div class="item-meta">${subRangeLabel(s.range)} · ${esc(s.date||'—')} · ~${money(monthlyEquivalent(s))}/mes</div>
      </div>
      <div class="item-amount neg">${money(s.amount)}</div>
    </div>
  `).join('');
  list.querySelectorAll('.item').forEach(el=>{
    const s = state.subscriptions.find(x=>x.id===el.dataset.subId);
    if(s) bindLongPress(el, ()=>subscriptionDetail(s), ()=>subscriptionDetail(s));
  });
}

let activeSharedEventId=null;
let sharedDraftParticipants=[];



















function renderKanban(){
  const groups={individual:$('kanbanIndividual')};
  Object.entries(groups).forEach(([scope,el])=>{if(!el)return;const items=state.kanban.filter(k=>k.scope===scope);el.innerHTML=['todo','doing','done'].map(col=>`<div class="kanban-col"><h4>${col==='todo'?'Por hacer':col==='doing'?'En curso':'Hecho'}</h4>${items.filter(k=>k.col===col).map(k=>`<div class="kanban-card" data-kid="${k.id}"><div class="kc-text">${esc(k.text)}</div><div class="kc-meta">${formatDate(k.created_at)}</div><div class="kanban-actions"><button type="button" class="edit" data-edit="${k.id}" aria-label="Editar"></button><button type="button" class="del" data-del="${k.id}" aria-label="Borrar"></button></div></div>`).join('')}</div>`).join('');
    el.querySelectorAll('.kanban-card').forEach(card=>card.addEventListener('click',e=>{if(e.target.closest('[data-edit],[data-del]'))return;const k=state.kanban.find(x=>x.id===card.dataset.kid);if(!k)return;k.col=k.col==='todo'?'doing':k.col==='doing'?'done':'todo';save();renderKanban();}));
    
    
  });
}
function addKanban(){const text=($('kanbanText')?.value||'').trim();if(!text){toast('Escribe una tarea');return;}const item={id:uid(),text,scope:$('kanbanScope')?.value||'individual',col:$('kanbanCol')?.value||'todo',user_id:state.user_id,created_at:Date.now()};state.kanban.push(item);save();renderKanban();$('kanbanText').value='';toast('Tarea agregada');}
async function editKanban(id){
  const k=state.kanban.find(x=>x.id===id); if(!k) return;
  const r=await askFields({title:'Editar tarea',fields:[{id:'text',label:'Tarea',value:k.text}],confirmLabel:'Guardar'});
  if(!r) return;
  const text=r.text.trim(); if(!text) return;
  k.text=text; save(); renderKanban();
}
async function deleteKanban(id){if(!await askConfirm('¿Borrar esta tarea?'))return;state.kanban=state.kanban.filter(x=>x.id!==id);save();renderKanban();toast('Tarea borrada');}
function renderReminders(){const el=$('remList');if(!el)return;const rs=[...state.reminders].sort((a,b)=>a.when-b.when);if(!rs.length){el.innerHTML='<div class="empty"><p>Sin recordatorios</p></div>';return;}el.innerHTML=rs.map(r=>`<div class="item ${r.done?'standby':''}" data-rid="${r.id}"><div class="item-icon task">⏰</div><div class="item-body"><div class="item-title">${esc(r.text)}</div><div class="item-meta">${formatDate(r.when)}</div></div><button type="button" class="btn btn-ghost btn-sm" data-rem-toggle="${r.id}">${r.done?'↩':'✓'}</button><button type="button" class="btn btn-ghost btn-sm" data-rem-del="${r.id}">✕</button></div>`).join('');el.querySelectorAll('[data-rem-toggle]').forEach(b=>b.onclick=()=>toggleReminder(b.dataset.remToggle));el.querySelectorAll('[data-rem-del]').forEach(b=>b.onclick=()=>deleteReminder(b.dataset.remDel));}
function addReminder(){const text=($('remText')?.value||'').trim(),date=$('remDate')?.value,time=$('remTime')?.value||'09:00';if(!text||!date){toast('Completa texto y fecha');return;}const when=new Date(date+'T'+time).getTime();if(!Number.isFinite(when)){toast('Fecha inválida');return;}const r={id:uid(),text,when,done:false,notified:false,user_id:state.user_id,created_at:Date.now()};state.reminders.push(r);try{if(window.Notification&&Notification.permission==='default')Notification.requestPermission();}catch(e){}scheduleReminderNotification(r);save();renderReminders();$('remText').value='';toast('Recordatorio creado');}
function toggleReminder(id){const r=state.reminders.find(x=>x.id===id);if(!r)return;r.done=!r.done;if(r.done){cancelReminderNotification(r);}else{r.notified=false;if(r.when>Date.now())scheduleReminderNotification(r);}save();renderReminders();}
async function deleteReminder(id){if(!await askConfirm('¿Borrar recordatorio?'))return;const r=state.reminders.find(x=>x.id===id);if(r)cancelReminderNotification(r);state.reminders=state.reminders.filter(x=>x.id!==id);save();renderReminders();}



function renderCategories(){const el=$('catList');if(!el)return;el.innerHTML=state.categories.map(c=>`<div class="item" data-cid="${esc(c.id)}"><div class="item-icon shop">${esc(c.icon)}</div><div class="item-body"><div class="item-title">${esc(c.name)}</div><div class="item-meta">Categoría</div></div>${DEFAULT_CATS.some(d=>d.id===c.id)?'':'<button type="button" class="btn btn-ghost btn-sm" data-cat-del="'+esc(c.id)+'">✕</button>'}</div>`).join('');el.querySelectorAll('[data-cat-del]').forEach(b=>b.onclick=()=>deleteCategory(b.dataset.catDel));}
function addCategory(){const name=($('catName')?.value||'').trim(),icon=($('catIcon')?.value||'📦').trim();if(!name){toast('Escribe el nombre');return;}const id=name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||uid();if(state.categories.some(c=>c.id===id)){toast('Esa categoría ya existe');return;}const c={id,name,icon};state.categories.push(c);save();renderCategories();renderHormiga();renderInicio();$('catName').value='';$('catIcon').value='📦';toast('Categoría creada');}
async function deleteCategory(id){if(DEFAULT_CATS.some(c=>c.id===id)){toast('Las categorías base no se pueden borrar');return;}if(!await askConfirm('¿Borrar categoría? Se conserva en el historial.'))return;state.categories=state.categories.filter(c=>c.id!==id);if(state.hormCat===id)state.hormCat='general';save();renderCategories();renderHormiga();renderInicio();toast('Categoría borrada');}
/* Respaldo/Restauración: usa PERSISTED_KEYS (la misma lista que clearAll) para
   que exportar/importar y vaciar datos nunca queden desincronizados. */
function updateBackupStatusLabel(){
  const el=$('menuBackupStatusLabel'); if(!el)return;
  const ts=safeNum(LS('last_backup_at'));
  el.textContent=ts?('Última copia: '+timeAgo(ts)):'Sin respaldo';
}


/* ===== Núcleo financiero v2 =====
   Una sola lógica para que Cuentas, Gasto rápido, Ingresos, Tarjetas/MSI,
   Préstamos, Ahorros, Inversiones, Deudores, Compras e Historial hablen
   del mismo dinero. No cambia la presentación visual. */
function financialType(a){ return String(a?.type||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function isCreditAccount(a){ return financialType(a)==='credito'; }
function isLiquidAccount(a){ const t=financialType(a); return t==='efectivo'||t==='debito'||t==='otro'; }
function coreAccount(id){ return (state.accounts||[]).find(a=>a.id===id)||null; }
function coreCreditAccountForCard(card){
  if(!card || financialType(card.type)!=='credito') return null;
  return coreAccountForCard(card);
}
function syncCardDebt(card){
  if(!card || financialType(card.type)!=='credito') return 0;
  const acc=coreCreditAccountForCard(card); if(!acc)return 0;
  card.balance=Math.max(0,safeNum(acc.balance));
  return card.balance;
}
function coreLiquidAccounts(){ ensureFinancialCore(); return state.accounts.filter(isLiquidAccount); }
function coreFirstLiquid(){ return coreLiquidAccounts()[0]||null; }
function walletLiquidity(){ ensureFinancialCore(); return coreLiquidAccounts().reduce((s,a)=>s+safeNum(a.balance),0); }
function walletAssets(){
  ensureFinancialCore();
  const savings=(state.savings||[]).reduce((s,x)=>s+Math.max(0,safeNum(x.current)),0);
  const investments=(state.investments||[]).reduce((s,x)=>s+Math.max(0,safeNum(x.current??x.amount)),0);
  const receivables=(state.debtors||[]).filter(x=>!x.settled).reduce((s,x)=>s+Math.max(0,safeNum(x.remaining??x.amount)),0);
  return walletLiquidity()+savings+investments+receivables;
}
function walletDebt(){
  ensureFinancialCore();
  const credit=state.accounts.filter(isCreditAccount).reduce((s,a)=>s+Math.max(0,safeNum(a.balance)),0);
  const loans=state.loans.reduce((s,l)=>s+Math.max(0,safeNum(l.current??l.principal)),0);
  return credit+loans;
}
function walletNet(){ return walletAssets()-walletDebt(); }

// Reemplaza el selector de cuentas vacío y hace que las páginas usen las mismas cuentas.
function renderAccounts(){
  ensureFinancialCore();
  const options=state.accounts.length?state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}${isCreditAccount(a)?' · crédito':''}</option>`).join(''):'<option value="">Sin cuentas</option>';
  ['transferFrom','transferTo','hormFromAccount'].forEach(id=>{if($(id))$(id).innerHTML=options;});
  const inc=$('incDestAccount');
  if(inc){
    inc.innerHTML=state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}${isCreditAccount(a)?' · crédito':''}</option>`).join('');
    if(!inc.value){const d=coreFirstLiquid();if(d)inc.value=d.id;}
  }
  const list=$('accountList'); if(!list)return;
  list.innerHTML=state.accounts.length?state.accounts.map(a=>`<div class="item" data-account-edit="${a.id}"><div class="item-icon shop">💼</div><div class="item-body"><div class="item-title">${esc(a.name)}</div><div class="account-type">${esc(a.type)}${isCreditAccount(a)?' · deuda':''}</div></div><div class="account-balance">${money(a.balance)}</div></div>`).join(''):'<div class="empty"><p>Agrega tu primera cuenta.</p></div>';
  
}








function renderHistorial(){
  const el=$('historialList');if(!el)return;const h=[...(state.historial||[])].sort((a,b)=>(b.created_at||0)-(a.created_at||0));if(!h.length){el.innerHTML='<div class="empty"><p>Sin historial</p></div>';return;}
  el.innerHTML=h.map(x=>{const dir=x.direction||'out',incoming=dir==='in',memo=dir==='memo'||dir==='transfer';const sign=incoming?'+':(memo?'':'-');const cls=incoming?'pos':(memo?'':'neg');return `<div class="item" data-hid="${esc(x.id)}"><div class="item-icon shop">${incoming?'💰':(memo?'↔️':'🛒')}</div><div class="item-body"><div class="item-title">${esc(x.description||'Movimiento')}</div><div class="item-meta">${esc(whoLabel(x.user_id))} · ${formatDate(x.created_at)}</div></div><div class="item-amount ${cls}">${sign}${money(x.amount)}</div></div>`;}).join('');
  el.querySelectorAll('.item').forEach(e=>e.onclick=()=>{const h=state.historial.find(x=>x.id===e.dataset.hid);if(h)showDetail('Movimiento',[{lbl:'Descripción',val:h.description||''},{lbl:'Monto',val:money(h.amount)},{lbl:'Tipo',val:h.type||'movimiento'},{lbl:'Fecha',val:formatDate(h.created_at)}],[]);});
}

ensureFinancialCore();

/* ===== ABACO APP V3 ===== */
(function(){const DEFAULT_PINS=['inicio','historial','hormiga','estadisticas','cuentas'];if(!Array.isArray(state.pinned)||!state.pinned.length){state.pinned=[...DEFAULT_PINS];LS_SET('pinned',JSON.stringify(state.pinned));}})();

function openMenu(){try{closeCalc();}catch(e){console.warn('No se pudo cerrar calculadora',e)}const menu=$('menuPage'),ov=$('menuOverlay');if(menu)menu.classList.add('open');if(ov){ov.classList.add('open');ov.style.pointerEvents='auto';}document.querySelector('.app')?.classList.add('menu-open');try{renderMenu();}catch(e){console.warn('No se pudo renderizar menú',e)}}
function closeMenu(){const menu=$('menuPage'),ov=$('menuOverlay');if(menu){menu.classList.remove('open');menu.style.transform='';menu.style.transition='';}if(ov){ov.classList.remove('open');ov.style.transform='';ov.style.transition='';ov.style.opacity='';ov.style.pointerEvents='';}document.querySelector('.app')?.classList.remove('menu-open');}
function toggleMenu(){if($('menuPage')?.classList.contains('open'))closeMenu();else openMenu();}
function goPanel(name){if(name==='deudores'){name='prestamos';window.AbacoCalm&&AbacoCalm.setDebtPane('cobrar');}closeMenu();document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));const panel=$('panel-'+name);if(panel){panel.classList.add('active','panel-enter');setTimeout(()=>panel.classList.remove('panel-enter'),320);}state.activePanel=name;window.__abacoNavigated=true;LS_SET('active_panel',name);renderPinned();try{updateHeaderPhrase();}catch(e){console.warn('Encabezado no actualizado',e)}renderActivePanel(name);try{window.AbacoExtrasUI&&AbacoExtrasUI.onPanel(name);}catch(e){console.warn('Convivencia no actualizada',e)}try{window.AbacoShell&&AbacoShell.onPanel(name);}catch(e){console.warn('Estructura no actualizada',e)}try{window.AbacoCalm&&AbacoCalm.onPanel(name);}catch(e){console.warn('Modo calmado no actualizado',e)}if(name==='hormiga')setTimeout(()=>{$('hormAmount')?.focus();},150);}





/* ===== ABACO ARQUITECTURA FINANCIERA v3 =====
   Una sola fuente de verdad: datos -> transacciones -> motor -> consultas -> UI.
   La interfaz no debe inventar matemáticas; las pantallas consultan Abaco.Finance.
*/
(function(){
  const DB_NAME='abaco_finanzas_db', DB_VERSION=3, DB_STORE='snapshots', DB_KEY='current';
  const DB={
    handle:null,
    open(){
      return new Promise((resolve,reject)=>{
        if(!('indexedDB' in window)){resolve(null);return;}
        const req=indexedDB.open(DB_NAME,DB_VERSION);
        req.onupgradeneeded=()=>{const db=req.result;['snapshots','accounts','transactions','cards','msiPlans','loans','subscriptions','savings','investments','debtors','budgets','categories','goals'].forEach(n=>{if(!db.objectStoreNames.contains(n))db.createObjectStore(n);});};
        req.onsuccess=()=>{DB.handle=req.result;resolve(DB.handle);};
        req.onerror=()=>reject(req.error);
      });
    },
    put(snapshot){
      if(!DB.handle)return Promise.resolve();
      return new Promise((resolve,reject)=>{const tx=DB.handle.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put(snapshot,DB_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    },
    get(){
      if(!DB.handle)return Promise.resolve(null);
      return new Promise((resolve,reject)=>{const tx=DB.handle.transaction(DB_STORE,'readonly');const req=tx.objectStore(DB_STORE).get(DB_KEY);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});
    },
    clear(){
      if(!DB.handle)return Promise.resolve();
      return new Promise((resolve,reject)=>{const tx=DB.handle.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    }
  };

  function cloneData(){
    const copy={};
    Object.keys(state||{}).forEach(k=>{if(k!=='db')try{copy[k]=JSON.parse(JSON.stringify(state[k]));}catch(_){}});
    return copy;
  }
  function normalizeTransactions(){
    state.transactions=Array.isArray(state.transactions)?state.transactions:[];
    const seen=new Set(state.transactions.map(t=>t.id));
    (state.historial||[]).forEach(h=>{
      const id='hist:'+h.id;
      if(seen.has(id))return;
      state.transactions.push({
        id,type:h.type||'movement',amount:safeNum(h.amount),direction:h.direction||'out',
        description:h.description||'',accountId:h.accountId||null,refId:h.refId||null,
        source:h.source||'',user_id:h.user_id||state.user_id,created_at:h.created_at||Date.now(),legacy:true
      });
    });
  }

  const MathEngine={
    round:(n,d=2)=>{const p=10**d;return Math.round((safeNum(n)+Number.EPSILON)*p)/p;},
    sum:(arr,fn=x=>x)=>MathEngine.round((arr||[]).reduce((s,x)=>s+safeNum(fn(x)),0)),
    percent:(part,total)=>safeNum(total)?MathEngine.round((safeNum(part)/safeNum(total))*100):0,
    monthlyPayment:(principal,annualRate,months)=>{
      principal=safeNum(principal);annualRate=safeNum(annualRate);months=Math.max(1,Math.floor(safeNum(months)));
      const r=annualRate/100/12;if(!r)return MathEngine.round(principal/months);
      return MathEngine.round(principal*r/(1-Math.pow(1+r,-months)));
    },
    amortization:(principal,annualRate,months)=>{
      let balance=safeNum(principal);const r=safeNum(annualRate)/100/12,n=Math.max(1,Math.floor(safeNum(months))),pay=MathEngine.monthlyPayment(balance,annualRate,n),rows=[];
      for(let i=1;i<=n&&balance>0.005;i++){
        const interest=MathEngine.round(balance*r),principalPaid=MathEngine.round(Math.min(balance,Math.max(0,pay-interest))),total=MathEngine.round(principalPaid+interest);
        balance=MathEngine.round(Math.max(0,balance-principalPaid));rows.push({number:i,payment:total,interest,principal:principalPaid,balance});
      }
      return rows;
    },
    installmentSchedule:(total,months,startDate)=>{
      const n=Math.max(1,Math.floor(safeNum(months))),base=safeNum(total)/n,d=new Date(startDate||Date.now()),rows=[];
      for(let i=1;i<=n;i++){const due=new Date(d);due.setMonth(due.getMonth()+i);const amount=i===n?MathEngine.round(safeNum(total)-base*(n-1)):MathEngine.round(base);rows.push({number:i,amount,due:due.getTime(),paid:false});}
      return rows;
    }
  };

  const Finance={
    db:DB, math:MathEngine,
    ensure(){ensureFinancialCore();normalizeTransactions();return state;},
    accounts(){this.ensure();return state.accounts||[];},
    liquidAccounts(){return this.accounts().filter(isLiquidAccount);},
    creditAccounts(){return this.accounts().filter(isCreditAccount);},
    available(){return MathEngine.sum(this.liquidAccounts(),a=>Math.max(0,safeNum(a.balance)));},
    creditDebt(){return MathEngine.sum(this.creditAccounts(),a=>Math.max(0,safeNum(a.balance)));},
    loansDebt(){return MathEngine.sum(state.loans||[],l=>Math.max(0,safeNum(l.current??l.principal)));},
    receivables(){return MathEngine.sum(state.debtors||[],d=>d.settled?0:safeNum(d.remaining??d.amount));},
    savings(){return MathEngine.sum(state.savings||[],s=>safeNum(s.current??s.amount));},
    investments(){return MathEngine.sum(state.investments||[],i=>safeNum(i.current??i.amount));},
    assets(){return MathEngine.round(this.available()+this.savings()+this.investments()+this.receivables());},
    debt(){return MathEngine.round(this.creditDebt()+this.loansDebt());},
    netWorth(){return MathEngine.round(this.assets()-this.debt());},
    monthBounds(date=new Date()){
      const d=new Date(date),y=d.getFullYear(),m=d.getMonth();return {start:new Date(y,m,1).getTime(),end:new Date(y,m+1,1).getTime()};
    },
    monthTransactions(date=new Date()){
      this.ensure();const b=this.monthBounds(date);
      return (state.transactions||[]).filter(t=>safeNum(t.created_at)>=b.start&&safeNum(t.created_at)<b.end);
    },
    monthlyIncome(date=new Date()){
      const tx=this.monthTransactions(date).filter(t=>t.meta?.impact?.income===true || t.type==='ingreso');
      const raw=this.sumIncomeFallback(date);return tx.length?MathEngine.sum(tx,t=>t.amount):raw;
    },
    monthlyExpense(date=new Date()){
      const tx=this.monthTransactions(date).filter(t=>t.meta?.impact?.expense===true || t.type==='gasto');
      const raw=this.sumExpenseFallback(date);return tx.length?MathEngine.sum(tx,t=>t.amount):raw;
    },
    sumIncomeFallback(date){const b=this.monthBounds(date);return MathEngine.sum(state.incomes||[],i=>{const t=safeNum(i.created_at);return t>=b.start&&t<b.end?safeNum(i.amount):0;});},
    sumExpenseFallback(date){const b=this.monthBounds(date);return MathEngine.sum(state.expenses||[],e=>{const t=safeNum(e.created_at);return t>=b.start&&t<b.end?safeNum(e.amount):0;});},
    commitments(date=new Date()){
      const b=this.monthBounds(date),subs=MathEngine.sum((state.subscriptions||[]).filter(s=>s.active!==false),s=>{
        const raw=s.nextDate??s.date??0; const t=typeof raw==='number'?raw:(raw?new Date(raw).getTime():0); return (!t||t>=b.start&&t<b.end)?s.amount:0;
      });
      const msi=MathEngine.sum((state.msiPlans||[]),p=>MathEngine.sum((p.installments||[]).filter(i=>!i.paid&&safeNum(i.due)>=b.start&&safeNum(i.due)<b.end),i=>i.amount));
      const loans=MathEngine.sum((state.loans||[]).filter(l=>safeNum(l.current)>0),l=>Math.min(safeNum(l.payment)||MathEngine.monthlyPayment(l.current,l.annualRate,l.term),safeNum(l.current)));
      return MathEngine.round(subs+msi+loans);
    },
    plan(date=new Date()){
      const income=this.monthlyIncome(date),expense=this.monthlyExpense(date),commit=this.commitments(date),free=MathEngine.round(income-expense-commit);
      const budgetTotal=MathEngine.sum(state.budgets||[],b=>b.amount);
      return {income,expense,commitments:commit,free,budgetTotal,expenseRate:MathEngine.percent(expense,income),available:this.available(),creditDebt:this.creditDebt(),netWorth:this.netWorth()};
    },
    dashboard(date=new Date()){
      const p=this.plan(date);return {...p,assets:this.assets(),debt:this.debt(),savings:this.savings(),investments:this.investments(),receivables:this.receivables()};
    },
    transactions(filter={}){
      this.ensure();let rows=[...(state.transactions||[])];if(filter.type)rows=rows.filter(t=>t.type===filter.type);if(filter.accountId)rows=rows.filter(t=>t.accountId===filter.accountId);if(filter.from)rows=rows.filter(t=>safeNum(t.created_at)>=safeNum(filter.from));if(filter.to)rows=rows.filter(t=>safeNum(t.created_at)<safeNum(filter.to));return rows.sort((a,b)=>safeNum(b.created_at)-safeNum(a.created_at));
    }
  };

  window.Abaco={DB,Math:MathEngine,Finance};
  state.transactions=Array.isArray(state.transactions)?state.transactions:[];
  normalizeTransactions();

  /* Todas las escrituras futuras pasan también por la base IndexedDB. */
      
  /* Historial y transacciones nacen juntos; no se crean dos fuentes de verdad. */
      
  /* Arranque: IndexedDB es una segunda capa persistente; localStorage sigue siendo
     compatible para no romper instalaciones existentes. Solo restaura si realmente
     es más reciente que la copia local. */
  
  /* API de dominio: las interfaces futuras deben usar estas operaciones. */
      Finance.normalizeTransactions=normalizeTransactions;
})();

/* ===== ABACO MOTOR FINANCIERO v4 =====
   Lleva la arquitectura a las operaciones reales sin cambiar la interfaz.
   Flujo: UI -> Services -> estado/ledger -> motor -> persistencia -> UI.
*/
(function(){
  const A=window.Abaco, F=A.Finance, M=A.Math, DB=A.DB;
  const clone=o=>{try{return JSON.parse(JSON.stringify(o));}catch(_){return o;}};
  const now=()=>Date.now();
  const txGroup=()=>uid();
  const refresh=()=>{ try{F.ensure();}catch(_){} try{updateUI();}catch(_){} try{renderInicio();}catch(_){} };
  const saveNow=()=>{ try{save();}catch(e){console.warn('Abaco save',e)} };

  /* Persistencia normalizada: IndexedDB conserva entidades separadas además del snapshot legado. */
    /* El esquema v2 se abre desde el núcleo v3; así no hay carreras entre versiones. */

  /* Índice transaccional coherente con el historial existente. */
    function account(id){F.ensure();return (state.accounts||[]).find(a=>a.id===id)||null;}
  function liquid(id){const a=account(id);return a&&isLiquidAccount(a)?a:null;}
  function firstLiquid(){return F.liquidAccounts()[0]||null;}
  function requireAmount(n){return safeNum(n)>0?safeNum(n):0;}
  function redraw(names){refresh();(names||[]).forEach(n=>{try{window[n]&&window[n]();}catch(_){} });}

                        
  /* API pública: cualquier módulo nuevo puede trabajar sin tocar saldos a mano. */
  
  /* Lecturas de negocio: presupuesto predictivo, compromisos y salud financiera. */
  F.forecast=function(date=new Date()){
    const p=this.plan(date),b=this.monthBounds(date),days=Math.max(1,new Date(date).getDate()),totalDays=Math.max(1,new Date(date.getFullYear(),date.getMonth()+1,0).getDate());
    const pace=p.expense/days,projected=M.round(pace*totalDays),projectedCommit=M.round(p.commitments),projectedEnd=M.round(p.income-projected-projectedCommit);
    return {...p,daysElapsed:days,daysInMonth:totalDays,projectedExpense:projected,projectedEnd,paceDaily:M.round(pace),status:projectedEnd<0?'riesgo':(projectedEnd<p.income*.1?'ajustar':'saludable')};
  };
  F.budgetProgress=function(date=new Date()){
    const rows=(state.budgets||[]).map(b=>{const spent=this.monthTransactions(date).filter(t=>(t.meta?.impact?.expense===true||t.type==='gasto')&&((t.meta&&t.meta.category)===b.category||t.category===b.category||t.meta?.categoryId===b.category)).reduce((s,t)=>s+safeNum(t.amount),0);const limit=safeNum(b.amount);return{...b,spent:M.round(spent),remaining:M.round(limit-spent),percent:limit?M.round(spent/limit*100):0};});return rows;
  };
  F.health=function(date=new Date()){
    const p=this.forecast(date),commitRatio=p.income?M.round(p.commitments/p.income*100):0,expenseRatio=p.income?M.round(p.expense/p.income*100):0;
    return {score:Math.max(0,Math.min(100,M.round(100-Math.min(70,expenseRatio)-Math.min(25,commitRatio)))),expenseRatio,commitRatio,available:p.available,netWorth:p.netWorth};
  };

  /* ===== UNIFICACIÓN v5: semántica canónica, categorías, eventos, metas y simulación ===== */
  const IMPACTS={
    ingreso:{income:true,cash:true},
    gasto:{expense:true,cash:true},
    transferencia:{transfer:true,cash:false},
    prestamo_personal:{receivable:true,cash:true},
    cobro:{receivable:true,cash:true},
    ahorro:{assetMove:true,cash:true},
    aporte_ahorro:{assetMove:true,cash:true},
    inversion:{assetMove:true,cash:true},
    prestamo:{liability:true,cash:false},
    pago_prestamo:{liability:true,cash:true},
    interes_prestamo:{expense:true,cash:true},
    msi:{liability:true,cash:false}
  };
  function canonicalizeTransactions(){
    state.transactions=Array.isArray(state.transactions)?state.transactions:[];
    state.transactions.forEach(t=>{
      const base=IMPACTS[t.type]||{};
      t.meta=t.meta||{};
      t.meta.impact={...base,...(t.meta.impact||{})};
      if(t.meta.category==null && t.category!=null)t.meta.category=t.category;
      t.economicKind=t.meta.impact.expense?'expense':t.meta.impact.income?'income':t.meta.impact.transfer?'transfer':t.meta.impact.assetMove?'asset_move':t.meta.impact.liability?'liability':t.meta.impact.receivable?'receivable':'memo';
      t.amount=M.round(t.amount);
    });
  }
  function ensureArray(name){if(!Array.isArray(state[name]))state[name]=[];return state[name];}
  canonicalizeTransactions();

  F.categories=function(){
    const defaults=['general','alimentación','transporte','hogar','salud','entretenimiento','compras','educación','servicios','deudas','otros'];
    const existing=ensureArray('categories');
    defaults.forEach(name=>{if(!existing.some(c=>c.id===name||c.name===name))existing.push({id:name,name,active:true});});
    return existing.filter(c=>c.active!==false);
  };
  F.monthlyExpense=function(date=new Date()){
    const tx=this.monthTransactions(date).filter(t=>t.meta?.impact?.expense===true || t.type==='gasto' || t.type==='interes_prestamo');
    return M.sum(tx,t=>t.amount);
  };
  F.monthlyIncome=function(date=new Date()){
    const tx=this.monthTransactions(date).filter(t=>t.meta?.impact?.income===true || t.type==='ingreso');
    return M.sum(tx,t=>t.amount);
  };
  F.cashFlow=function(date=new Date()){
    const tx=this.monthTransactions(date),income=M.sum(tx.filter(t=>t.meta?.impact?.income),t=>t.amount),out=M.sum(tx.filter(t=>t.meta?.impact?.cash&&t.direction==='out'),t=>t.amount),inflow=M.sum(tx.filter(t=>t.meta?.impact?.cash&&t.direction==='in'),t=>t.amount);
    return {income:M.round(income),cashIn:M.round(inflow),cashOut:M.round(out),net:M.round(inflow-out)};
  };
  F.dailyCapacity=function(date=new Date()){
    const p=this.forecast(date),today=new Date(date),remainingDays=Math.max(1,p.daysInMonth-p.daysElapsed+1),reserved=Math.max(0,p.commitments),remainingBudget=Math.max(0,p.income-p.expense-reserved),daily=M.round(remainingBudget/remainingDays);
    return {remainingDays,remainingBudget:M.round(remainingBudget),dailyLimit:daily};
  };
  F.events=function(date=new Date()){
    const events=[],d=new Date(date),b=this.monthBounds(d),todayStart=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
    (state.subscriptions||[]).filter(s=>s.active!==false).forEach(s=>{const raw=s.nextDate??s.date;const t=typeof raw==='number'?raw:(raw?new Date(raw).getTime():0);if(t>=todayStart&&t<b.end)events.push({type:'subscription',date:t,title:s.name,amount:s.amount,priority:'normal'});});
    (state.msiPlans||[]).forEach(p=>{(p.installments||[]).filter(i=>!i.paid&&safeNum(i.due)>=todayStart&&safeNum(i.due)<b.end).forEach(i=>events.push({type:'msi',date:i.due,title:`MSI: ${p.concept}`,amount:i.amount,priority:'normal'}));});
    (state.loans||[]).filter(l=>safeNum(l.current)>0).forEach(l=>{events.push({type:'loan',date:l.nextPaymentAt||todayStart,title:`Pago: ${l.name}`,amount:Math.min(safeNum(l.payment),safeNum(l.current)),priority:'normal'});});
    const f=this.forecast(d);if(f.status==='riesgo')events.push({type:'risk',date:todayStart,title:'Ritmo de gasto por encima de lo sostenible',amount:0,priority:'high'});
    return events.sort((a,b)=>safeNum(a.date)-safeNum(b.date));
  };
  F.goals=function(){ensureArray('goals');return state.goals;};
  F.addGoal=function({name,target,current=0,deadline=null,savingId=null}){const g={id:uid(),name:(name||'Meta').trim(),target:M.round(target),current:M.round(current),deadline,savingId:savingId||null,created_at:now(),user_id:state.user_id,active:true};state.goals.push(g);saveNow();return g;};
  F.updateGoal=function(id,current){const g=state.goals.find(x=>x.id===id);if(!g)return null;g.current=M.round(Math.max(0,current));if(g.current>=safeNum(g.target))g.completedAt=now();saveNow();return g;};
  F.simulate=function({expense=0,income=0,transfer=0,saving=0,investment=0,date=new Date()}={}){
    const p=this.plan(date),e=Math.max(0,safeNum(expense)),i=Math.max(0,safeNum(income)),s=Math.max(0,safeNum(saving)),inv=Math.max(0,safeNum(investment)),tr=Math.max(0,safeNum(transfer));
    const available=M.round(p.available+i-e-s-inv),monthlyExpense=M.round(p.expense+e),free=M.round(p.free+i-e-s-inv),netWorth=M.round(p.netWorth+i-e);
    return {available,monthlyExpense,free,netWorth,deltaAvailable:M.round(available-p.available),deltaNetWorth:M.round(netWorth-p.netWorth)};
  };
  F.commitmentsDetailed=function(date=new Date()){
    const rows=[];
    (state.subscriptions||[]).filter(s=>s.active!==false).forEach(s=>{const raw=s.nextDate??s.date;const t=typeof raw==='number'?raw:(raw?new Date(raw).getTime():0);if(t)rows.push({kind:'subscription',id:s.id,title:s.name,amount:M.round(s.amount),date:t});});
    (state.msiPlans||[]).forEach(p=>(p.installments||[]).filter(i=>!i.paid).forEach(i=>rows.push({kind:'msi',id:p.id,title:p.concept,amount:M.round(i.amount),date:i.due,number:i.number})));
    (state.loans||[]).filter(l=>safeNum(l.current)>0).forEach(l=>rows.push({kind:'loan',id:l.id,title:l.name,amount:M.round(Math.min(safeNum(l.payment),safeNum(l.current))),date:l.nextPaymentAt||null}));
    return rows.sort((a,b)=>safeNum(a.date)-safeNum(b.date));
  };
  F.snapshotModel=function(date=new Date()){
    return {date:new Date(date).toISOString(),available:this.available(),assets:this.assets(),debt:this.debt(),netWorth:this.netWorth(),cashFlow:this.cashFlow(date),plan:this.plan(date),forecast:this.forecast(date),dailyCapacity:this.dailyCapacity(date),events:this.events(date),audit:this.audit()};
  };
  F.audit=function(){
    this.ensure();canonicalizeTransactions();const issues=[],seen=new Set(),accounts=new Set((state.accounts||[]).map(a=>a.id));
    (state.transactions||[]).forEach(t=>{if(!t.id)issues.push({type:'missing_transaction_id'});if(seen.has(t.id))issues.push({type:'duplicate_transaction',id:t.id});seen.add(t.id);if(t.accountId&&!accounts.has(t.accountId))issues.push({type:'orphan_account',transactionId:t.id,accountId:t.accountId});if(safeNum(t.amount)<0)issues.push({type:'negative_transaction',id:t.id});});
    (state.cards||[]).forEach(c=>{const a=coreCreditAccountForCard(c);if(!a)issues.push({type:'card_without_account',id:c.id});});
    (state.msiPlans||[]).forEach(p=>{if(!state.cards.some(c=>c.id===p.cardId))issues.push({type:'msi_without_card',id:p.id});});
    (state.loans||[]).forEach(l=>{if(safeNum(l.current)<-0.005)issues.push({type:'negative_loan',id:l.id});});
    (state.debtors||[]).forEach(d=>{if(!d.settled&&safeNum(d.remaining)<-0.005)issues.push({type:'negative_receivable',id:d.id});});
    (state.accounts||[]).forEach(a=>{if(isLiquidAccount(a)&&safeNum(a.balance)<-0.005)issues.push({type:'negative_liquid_account',id:a.id,balance:a.balance});});
    return {ok:issues.length===0,issues,count:issues.length,available:this.available(),assets:this.assets(),debt:this.debt(),netWorth:this.netWorth(),transactionCount:(state.transactions||[]).length};
  };
  F.repair=function(){
    ensureFinancialCore();canonicalizeTransactions();
    (state.savings||[]).forEach(s=>{s.current=M.round(Math.max(0,safeNum(s.current??s.amount)));});
    (state.investments||[]).forEach(i=>{i.current=M.round(Math.max(0,safeNum(i.current??i.amount)));});
    (state.loans||[]).forEach(l=>{l.current=M.round(Math.max(0,safeNum(l.current??l.principal)));l.payment=M.monthlyPayment(l.current,l.annualRate,l.term);});
    (state.debtors||[]).forEach(d=>{d.remaining=M.round(Math.max(0,d.settled?0:(d.remaining??d.amount)));});
    (state.msiPlans||[]).forEach(p=>{const c=state.cards.find(x=>x.id===p.cardId);if(c){const a=coreCreditAccountForCard(c);if(a)a.balance=M.sum((p.installments||[]).filter(i=>!i.paid),i=>i.amount);syncCardDebt(c);}});
    saveNow();return this.audit();
  };
  F.health=function(date=new Date()){
    const p=this.forecast(date),commitRatio=p.income?M.round(p.commitments/p.income*100):0,expenseRatio=p.income?M.round(p.expense/p.income*100):0,score=Math.max(0,Math.min(100,M.round(100-Math.min(70,expenseRatio)-Math.min(25,commitRatio))));
    return {score,expenseRatio,commitRatio,available:p.available,netWorth:p.netWorth,heuristic:true};
  };
  canonicalizeTransactions();

  /* Migración/reparación: convierte balances antiguos a la semántica nueva sin borrar datos. */
  F.reconcile=function(){
    ensureFinancialCore();
    (state.loans||[]).forEach(l=>{l.current=safeNum(l.current??l.principal);l.paid=safeNum(l.paid);l.payment=safeNum(l.payment)||M.monthlyPayment(l.current,l.annualRate,l.term);});
    (state.debtors||[]).forEach(d=>{d.remaining=d.settled?0:safeNum(d.remaining??d.amount);});
    (state.savings||[]).forEach(s=>{s.current=safeNum(s.current??s.amount);});
    (state.investments||[]).forEach(i=>{i.current=safeNum(i.current??i.amount);});
    (state.msiPlans||[]).forEach(p=>{const c=state.cards.find(x=>x.id===p.cardId);if(c){const a=coreCreditAccountForCard(c);if(a)a.balance=M.sum((p.installments||[]).filter(i=>!i.paid),i=>i.amount);syncCardDebt(c);}});
    F.normalizeTransactions();saveNow();return true;
  };

  F.audit=function(){
    this.ensure();
    const issues=[];
    const seen=new Set();
    (state.transactions||[]).forEach(t=>{if(seen.has(t.id))issues.push({type:'duplicate_transaction',id:t.id});seen.add(t.id);if(t.accountId&&!account(t.accountId))issues.push({type:'orphan_account',transactionId:t.id,accountId:t.accountId});});
    (state.cards||[]).forEach(c=>{const a=coreCreditAccountForCard(c);if(!a)issues.push({type:'card_without_account',id:c.id});});
    (state.msiPlans||[]).forEach(p=>{if(!state.cards.some(c=>c.id===p.cardId))issues.push({type:'msi_without_card',id:p.id});});
    (state.loans||[]).forEach(l=>{if(safeNum(l.current)<-0.005)issues.push({type:'negative_loan',id:l.id});});
    (state.debtors||[]).forEach(d=>{if(!d.settled&&safeNum(d.remaining)<-0.005)issues.push({type:'negative_receivable',id:d.id});});
    (state.accounts||[]).forEach(a=>{if(isLiquidAccount(a)&&safeNum(a.balance)<-0.005)issues.push({type:'negative_liquid_account',id:a.id,balance:a.balance});});
    return {ok:issues.length===0,issues,count:issues.length,available:this.available(),assets:this.assets(),debt:this.debt(),netWorth:this.netWorth()};
  };

  /* Reemplazos de UI: mismos controles, ahora delegan en servicios. */
                      
  /* Guardado normalizado tras cada save; no altera el almacenamiento legacy. */
          try{F.audit();}catch(e){console.warn('Abaco audit',e)}
})();

/* Vinculación de botones existentes. No modifica estilos ni HTML visual. */
$('btnRegister')?.addEventListener('click', registerUser);
if($('msiPurchaseDate')&&!$('msiPurchaseDate').value)$('msiPurchaseDate').value=todayInputValue();
$('budgetPeriodChips')?.querySelectorAll('.chip').forEach(ch=>ch.onclick=()=>setBudgetPeriod(ch.dataset.budgetPeriod));
$('btnBudgetEntry')&&( $('btnBudgetEntry')&&( $('btnBudgetEntry').onclick=openBudgetEntry ) );
$('btnBudgetCancel')&&( $('btnBudgetCancel')&&( $('btnBudgetCancel').onclick=closeBudgetEntry ) );
$('btnBudgetAddRow')&&( $('btnBudgetAddRow')&&( $('btnBudgetAddRow').onclick=()=>appendBudgetInputRow() ) );
$('btnBudgetSave')&&( $('btnBudgetSave')&&( $('btnBudgetSave').onclick=saveBudgetPlan ) );
$('btnBudgetClear')&&( $('btnBudgetClear')&&( $('btnBudgetClear').onclick=clearBudget ) );
$('btnOpenShopForm')&&($('btnOpenShopForm')&&( $('btnOpenShopForm').onclick=()=>openOpForm('shopFormPanel')) );
$('btnCloseShopForm')&&($('btnCloseShopForm')&&( $('btnCloseShopForm').onclick=()=>closeOpForm('shopFormPanel')) );
$('btnOpenListaForm')&&($('btnOpenListaForm')&&( $('btnOpenListaForm').onclick=()=>openOpForm('listaFormPanel')) );
$('btnCloseListaForm')&&($('btnCloseListaForm')&&( $('btnCloseListaForm').onclick=()=>closeOpForm('listaFormPanel')) );
$('btnAddLista')&&($('btnAddLista')&&( $('btnAddLista').onclick=addChecklistItem) );
$('btnClearListaDone')&&($('btnClearListaDone')&&( $('btnClearListaDone').onclick=clearChecklistDone) );
$('listaCatChips')&&$('listaCatChips').querySelectorAll('.chip').forEach(ch=>ch.onclick=()=>{
  $('listaCatChips').querySelectorAll('.chip').forEach(c=>c.classList.toggle('active',c===ch));
});
$('listaFilterChips')&&$('listaFilterChips').querySelectorAll('.chip').forEach(ch=>ch.onclick=()=>{
  state.checklistFilter=ch.dataset.filter;
  $('listaFilterChips').querySelectorAll('.chip').forEach(c=>c.classList.toggle('active',c===ch));
  renderChecklist();
});
$('btnOpenIncForm')&&($('btnOpenIncForm')&&( $('btnOpenIncForm').onclick=()=>openOpForm('incFormPanel')) );
$('btnCloseIncForm')&&($('btnCloseIncForm')&&( $('btnCloseIncForm').onclick=()=>closeOpForm('incFormPanel')) );
$('btnCloseSaveForm')&&($('btnCloseSaveForm')&&( $('btnCloseSaveForm').onclick=()=>closeOpForm('saveMenuPanel')) );
$('btnOpenCardForm')&&($('btnOpenCardForm')&&( $('btnOpenCardForm').onclick=()=>openOpForm('cardFormPanel')) );
$('btnCloseCardForm')&&($('btnCloseCardForm')&&( $('btnCloseCardForm').onclick=()=>closeOpForm('cardFormPanel')) );
$('btnOpenAccountForm')&&($('btnOpenAccountForm')&&( $('btnOpenAccountForm').onclick=()=>openOpForm('accountFormPanel')) );
$('btnCloseAccountForm')&&($('btnCloseAccountForm')&&( $('btnCloseAccountForm').onclick=()=>closeOpForm('accountFormPanel')) );
$('btnOpenLoanForm')&&($('btnOpenLoanForm')&&( $('btnOpenLoanForm').onclick=()=>openOpForm('loanFormPanel')) );
$('btnCloseLoanForm')&&($('btnCloseLoanForm')&&( $('btnCloseLoanForm').onclick=()=>closeOpForm('loanFormPanel')) );
$('btnStartShopMode')&&( $('btnStartShopMode').onclick=startShopMode );
$('btnAddShop')&&( $('btnAddShop').onclick=addShop );
$('btnAddCart')&&( $('btnAddCart').onclick=addCart );
$('btnCancelShop')&&( $('btnCancelShop').onclick=cancelShop );
$('btnConfirmShop')&&( $('btnConfirmShop').onclick=confirmShop );
$('btnAddIncome')&&( $('btnAddIncome').onclick=addIncome );
$('btnSaveMenu')&&( $('btnSaveMenu').onclick=toggleSaveMenu );
$('saveTabNew')&&( $('saveTabNew').onclick=()=>switchSaveTab('new') );
$('saveTabAdd')&&( $('saveTabAdd').onclick=()=>switchSaveTab('add') );
$('saveTypeChips').querySelectorAll('.chip').forEach(ch=>ch.onclick=()=>{state.saveType=ch.dataset.val;$('saveTypeChips').querySelectorAll('.chip').forEach(c=>c.classList.toggle('active',c===ch));$('saveTargetFields').classList.toggle('hidden',state.saveType==='open');});
$('btnAddSave')&&( $('btnAddSave').onclick=addSaving );
$('btnContribute')&&( $('btnContribute').onclick=contributeSaving );
$('btnAddCard')&&( $('btnAddCard').onclick=addCard );
$('btnAddMsi')&&( $('btnAddMsi').onclick=addMsi );
$('btnAddAccount')&&( $('btnAddAccount').onclick=addAccount );
$('btnTransfer')&&( $('btnTransfer').onclick=transferFunds );
$('btnAddLoan')&&( $('btnAddLoan').onclick=addLoan );
$('btnOpenSubForm')&&( $('btnOpenSubForm').onclick=openSubForm );
$('btnCloseSubForm')&&( $('btnCloseSubForm').onclick=closeSubForm );
$('btnAddSub')&&( $('btnAddSub').onclick=addSubscription );
$('subRangeChips')?.querySelectorAll('.chip').forEach(ch=>ch.onclick=()=>{
  state.subRange=ch.dataset.val||'mensual';
  $('subRangeChips').querySelectorAll('.chip').forEach(c=>c.classList.toggle('active',c===ch));
});

$('btnAddKanban')&&( $('btnAddKanban').onclick=addKanban );
$('btnAddRem')&&( $('btnAddRem').onclick=addReminder );
$('btnAddCat')&&( $('btnAddCat').onclick=addCategory );
$('btnClearMine')&&( $('btnClearMine').onclick=clearMine );
$('btnClearAll')&&( $('btnClearAll').onclick=clearAll );
$('btnExportBackup')&&( $('btnExportBackup').onclick=exportBackup );
$('btnImportBackup')&&( $('btnImportBackup').onclick=()=>$('inputImportBackup')?.click() );
$('inputImportBackup')&&( $('inputImportBackup').onchange=e=>{const f=e.target.files&&e.target.files[0];importBackup(f);e.target.value='';} );
updateBackupStatusLabel();
checkReminders();

setupMoneyChartsUI();
try{setupCalculator();}catch(e){console.warn(e)}
$('btnMenuHeader')&&($('btnMenuHeader')&&( $('btnMenuHeader').onclick=()=>openMenu()) );
$('btnCalcHeader')&&($('btnCalcHeader')&&( $('btnCalcHeader').onclick=()=>openCalc()) );
$('btnHelpHeader')&&($('btnHelpHeader')&&( $('btnHelpHeader').onclick=()=>showPanelHelp()) );
$('btnPronounMenu') && ($('btnPronounMenu').onclick = () => { cyclePronoun(); });
document.querySelectorAll('#pronounChoice [data-pronoun], #pronounNeutro').forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll('#pronounChoice [data-pronoun], #pronounNeutro').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    state.pronoun = btn.dataset.pronoun || 'el';
  };
});
try{applyPronounUI();}catch(e){}

$('btnOpenDebtForm')&&($('btnOpenDebtForm')&&( $('btnOpenDebtForm').onclick=()=>openOpForm('debtFormPanel')) );
$('btnCloseDebtForm')&&($('btnCloseDebtForm')&&( $('btnCloseDebtForm').onclick=()=>closeOpForm('debtFormPanel')) );
$('btnAddDebt')&&($('btnAddDebt')&&( $('btnAddDebt').onclick=addDebtor) );
$('btnOpenInvForm')&&($('btnOpenInvForm')&&( $('btnOpenInvForm').onclick=()=>openOpForm('invFormPanel')) );
$('btnCloseInvForm')&&($('btnCloseInvForm')&&( $('btnCloseInvForm').onclick=()=>closeOpForm('invFormPanel')) );
$('btnAddInv')&&($('btnAddInv')&&( $('btnAddInv').onclick=addInvestment) );
$('btnToggleSubCal') && ($('btnToggleSubCal').onclick = () => { const el = $('subCalendar'); if(!el)return; const hide=el.classList.toggle('hidden'); $('btnToggleSubCal').textContent=hide?'Mostrar':'Ocultar'; if(!hide) renderSubCalendar(); });
$('sharedTipSplitChips')?.querySelectorAll('.chip').forEach(ch=>ch.onclick=()=>{ state.tipSplitMode=ch.dataset.val||'all'; $('sharedTipSplitChips').querySelectorAll('.chip').forEach(c=>c.classList.toggle('active',c===ch)); const wrap=$('sharedTipPeopleWrap'); if(wrap) wrap.classList.toggle('hidden', state.tipSplitMode!=='some'); });
setupMenuSwipe(); setupAndroidNavigation(); renderMenu(); renderPinned(); updateUI(); try{Abaco?.Finance?.ensure(); save(true);}catch(e){console.warn('Abaco core startup',e)} try{updateHeaderPhrase();}catch(e){console.warn('Frase de encabezado no disponible',e)}
/* Al abrir la app (o al restaurar desde segundo plano) el panel que ya está
   marcado como activo en el HTML también debe pintarse con los datos
   guardados, no solo los paneles a los que se navega después. Reutiliza el
   mismo PANEL_RENDERERS que usa goPanel(), en vez de otra función aparte. */
try{ renderActivePanel(document.querySelector('.panel.active')?.id?.replace('panel-','') || state.activePanel || 'hormiga'); }catch(e){console.warn('Render inicial de panel',e)}


/* ===== ABACO UNIFICACIÓN UI v6: el motor alimenta las pantallas existentes ===== */
(function(){
  const _renderInicio = window.renderInicio;
  function setWrappedCube(index,label,value,icon){
    const box=document.getElementById('wrappedBox');
    if(!box)return;
    const cubes=box.querySelectorAll('.month-info-cube');
    const c=cubes[index]; if(!c)return;
    const small=c.querySelector('small'), b=c.querySelector('b'), i=c.querySelector('.mic-icon');
    if(small)small.textContent=label;
    if(b)b.textContent=value;
    if(i)i.textContent=icon;
  }
  function renderEngineDashboard(){
    // El motor de lectura vive en window.Abaco.Finance; este bloque no ve la variable local F.
    const F=window.Abaco&&window.Abaco.Finance; if(!F) return;
    try{
      const d=F.dashboard(new Date()), cap=F.dailyCapacity(new Date()), fc=F.forecast(new Date()), health=F.health(new Date()), cf=F.cashFlow(new Date()), events=F.events(new Date()), commitments=F.commitmentsDetailed(new Date()), goals=F.goals();
      setWrappedCube(0,'Capacidad diaria',money(cap.dailyLimit),'🎯'); setWrappedCube(1,'Comprometido',money(d.commitments||0),'📌'); setWrappedCube(2,'Salud financiera',health.score+'/100','💚'); setWrappedCube(3,'Proyección fin de mes',money(fc.projectedEnd),'🔮'); setWrappedCube(4,'Patrimonio',money(F.netWorth()),'🏦'); setWrappedCube(5,'Flujo neto',money(cf.net),'↕️');
      const profiles=document.getElementById('profilesBox'); if(profiles){const status=fc.status==='riesgo'?'Ajustar ritmo':fc.status==='ajustar'?'Vigilar gasto':'Mes saludable',next=events[0],active=goals.find(g=>g.active!==false&&!g.completedAt),pct=active&&safeNum(active.target)>0?Math.min(100,Math.round(safeNum(active.current)/safeNum(active.target)*100)):0;profiles.innerHTML=[{n:status,t:'Lectura del motor'},{n:next?money(next.amount):'—',t:next?'Próximo: '+next.title:'Sin próximos avisos'},{n:active?pct+'%':'—',t:active?'Meta activa':'Sin meta activa'}].map(x=>`<div class="profile-card"><div class="pn">${esc(x.n)}</div><div class="pt">${esc(x.t)}</div></div>`).join('');}
      const banner=document.getElementById('cutoffBanner'); if(banner){const n=commitments[0];if(n){const dt=new Date(n.date),when=Number.isNaN(dt.getTime())?'Próximo':dt.toLocaleDateString([],{day:'2-digit',month:'short'});banner.textContent=`Próximo compromiso · ${n.title} · ${money(n.amount)} · ${when}`;banner.classList.remove('hidden');}else if(fc.status==='riesgo'){banner.textContent='Atención · el ritmo actual proyecta un cierre negativo del mes.';banner.classList.remove('hidden');}else banner.classList.add('hidden');}
      const upcoming=document.getElementById('upcomingList'); if(upcoming){const visible=events.slice(0,5);upcoming.innerHTML=visible.length?visible.map(e=>{const dt=new Date(e.date),date=Number.isNaN(dt.getTime())?'':dt.toLocaleDateString([],{day:'2-digit',month:'short'}),icon=e.type==='msi'?'🛍️':e.type==='loan'?'💳':e.type==='subscription'?'🔄':'⚠️';return `<div class="item"><div class="item-icon task">${icon}</div><div class="item-body"><div class="item-title">${esc(e.title)}</div><div class="item-meta">${esc(date)} · ${e.priority==='high'?'Prioridad alta':'Compromiso'}</div></div><div class="item-amount neg">${e.amount?money(e.amount):''}</div></div>`;}).join(''):'<div class="note">Sin compromisos próximos. Tu mes está despejado.</div>';}
    }catch(e){console.warn('Abaco dashboard UI',e)}
  }

  if(typeof _renderInicio==='function'){
    window.renderInicio=function(){_renderInicio.apply(this,arguments);setTimeout(renderEngineDashboard,0);};
  }

  /* Transferencia = movimiento interno: no cambia patrimonio ni flujo económico. */
  if(window.Abaco?.Finance?.simulate){
    const _simulate=window.Abaco.Finance.simulate;
    window.Abaco.Finance.simulate=function(opts={}){
      const r=_simulate.call(this,opts);
      r.transferImpact=0;
      return r;
    };
  }

  /* Toda pantalla vuelve a mostrar el estado del motor al regresar a Inicio. */
  const _goPanel=window.goPanel;
  if(typeof _goPanel==='function'){
    window.goPanel=function(name){
      const r=_goPanel.apply(this,arguments);
      if(name==='inicio')setTimeout(renderEngineDashboard,0);
      return r;
    };
  }
})();


/* ===== CONTROLADOR DE BOTONES: respaldo único para Inicio y accesos dinámicos ===== */
(function abacoButtonController(){
  const q=s=>document.querySelector(s);
  const bind=()=>{
    // Accesos de Inicio que se crean/re-renderizan dinámicamente.
    document.querySelectorAll('[data-home-action]').forEach(btn=>{
      if(btn.dataset.boundHome==='1') return;
      btn.dataset.boundHome='1';
      btn.addEventListener('click',function(ev){
        ev.preventDefault(); ev.stopPropagation();
        const action=btn.dataset.homeAction;
        if(action==='charts'){
          const charts=q('#btnToggleCharts');
          if(charts){ charts.click(); }
          else if(typeof window.openCharts==='function'){ window.openCharts(); }
          return;
        }
        if(action && typeof window.goPanel==='function'){
          window.goPanel(action);
        }
      });
    });

    // Los chips de cuenta también quedan protegidos por delegación.
    const chips=q('#accountViewChips');
    if(chips && chips.dataset.boundDelegate!=='1'){
      chips.dataset.boundDelegate='1';
      chips.addEventListener('click',ev=>{
        const btn=ev.target.closest?.('[data-av]'); if(!btn) return;
        if(typeof window.renderInicio==='function'){
          state.accountView=btn.dataset.av;
          LS_SET('account_view',state.accountView);
          try{save();}catch(_){}
          window.renderInicio();
        }
      },true);
    }

  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind,{once:true}); else bind();
  // RenderInicio reconstruye varios controles; reaplicar después de cada actualización visual.
  const oldRender=window.renderInicio;
  if(typeof oldRender==='function' && !oldRender.__buttonSafe){
    const wrapped=function(){ const r=oldRender.apply(this,arguments); setTimeout(bind,0); return r; };
    wrapped.__buttonSafe=true; window.renderInicio=wrapped;
  }
})();


/* ===== Android UX final: keyboard-safe layout + predictable Back behavior ===== */
(function androidUxFinal(){
  const root=document.documentElement;
  function syncKeyboardState(){
    try{
      const vv=window.visualViewport;
      const keyboardOpen=!!vv && (window.innerHeight-vv.height)>140;
      document.body.classList.toggle('keyboard-open', keyboardOpen);
    }catch(e){}
  }
  syncKeyboardState();
  window.addEventListener('resize', syncKeyboardState, {passive:true});
  window.visualViewport?.addEventListener('resize', syncKeyboardState, {passive:true});
  document.addEventListener('focusin', e=>{
    if(e.target?.matches?.('input,textarea,select')){
      setTimeout(()=>{ try{ e.target.scrollIntoView({block:'center',behavior:'smooth'}); }catch(_){} }, 120);
    }
  });
  // Keep the system bar color synchronized with the app theme.
  window.setAndroidThemeColor=function(){
    try{
      const meta=document.getElementById('metaThemeColor');
      if(!meta)return;
      const dark=document.documentElement.getAttribute('data-theme')==='dark';
      const sky=window.AbacoSky&&AbacoSky.current();
      const barColor=sky?sky.top:(dark?'#2B303A':'#EAEFF5');
      meta.content=barColor;
      const status=window.Capacitor?.Plugins?.StatusBar;
      if(status?.setBackgroundColor) status.setBackgroundColor({color:barColor}).catch(()=>{});
      if(status?.setStyle) status.setStyle({style:dark?'DARK':'LIGHT'}).catch(()=>{});
      const native=window.AndroidBridge; if(native?.setStatusBarColor) native.setStatusBarColor(meta.content);
    }catch(e){}
  };
  window.setAndroidThemeColor();
  root.addEventListener('themechange', window.setAndroidThemeColor);
})();
