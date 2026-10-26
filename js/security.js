/* Seguridad de acceso local de Ábaco.
 * Guarda únicamente una derivación PBKDF2 con sal aleatoria; nunca guarda PIN/patrón en texto.
 * La protección es local al dispositivo y no sustituye el cifrado del almacenamiento del sistema.
 */
(function AbacoLocalSecurity(){
  'use strict';
  const STORAGE_KEY = 'abaco_access_security_v1';
  const ITERATIONS = 120000;
  let mode = 'pin';
  let stage = 'menu';
  let firstSecret = '';
  let pattern = [];
  let pendingPattern = [];
  let busy = false;
  let failedAttempts = 0;
  let blockedUntil = 0;
  let overlay, card, errorEl;

  const readConfig = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (_) { return null; }
  };
  const writeConfig = config => localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  const bytesToBase64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const base64ToBytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  function getCrypto() {
    if (!window.crypto || !window.crypto.subtle || !window.crypto.getRandomValues) {
      throw new Error('Este dispositivo no ofrece almacenamiento criptográfico seguro en este contexto. Actualiza el navegador o usa la app Android.');
    }
    return window.crypto;
  }
  async function derive(secret, salt) {
    const crypto = getCrypto();
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits({name:'PBKDF2', salt, iterations:ITERATIONS, hash:'SHA-256'}, key, 256);
  }
  async function makeConfig(secret, selectedMode) {
    const crypto = getCrypto();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derive(secret, salt);
    return {version:1, mode:selectedMode, salt:bytesToBase64(salt), hash:bytesToBase64(hash), iterations:ITERATIONS, updatedAt:Date.now()};
  }
  function constantTimeEqual(a,b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i=0;i<a.length;i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }
  async function verify(secret, config) {
    try {
      const actual = await derive(secret, base64ToBytes(config.salt));
      return constantTimeEqual(new Uint8Array(actual), base64ToBytes(config.hash));
    } catch (e) {
      showError(e.message || 'No se pudo comprobar la clave.');
      return false;
    }
  }
  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('section');
    overlay.id = 'abacoSecurityOverlay';
    overlay.className = 'security-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-labelledby','abacoSecurityTitle');
    overlay.innerHTML = '<div class="security-card"><h2 id="abacoSecurityTitle">Seguridad de acceso</h2><p id="abacoSecurityDescription"></p><div id="abacoSecurityBody"></div><p id="abacoSecurityError" class="security-error" role="status" aria-live="polite"></p></div>';
    document.body.appendChild(overlay);
    card = overlay.querySelector('.security-card');
    errorEl = overlay.querySelector('#abacoSecurityError');
  }
  function showError(message='') { if (errorEl) errorEl.textContent = message; }
  function openOverlay() { ensureOverlay(); overlay.hidden = false; document.body.classList.add('security-open'); }
  function closeOverlay() { if (overlay) overlay.hidden = true; document.body.classList.remove('security-open'); showError(''); }
  function setScreen(title, description, body) {
    ensureOverlay();
    overlay.querySelector('#abacoSecurityTitle').textContent = title;
    overlay.querySelector('#abacoSecurityDescription').textContent = description;
    overlay.querySelector('#abacoSecurityBody').innerHTML = body;
    showError('');
  }
  function patternMarkup() {
    return '<div class="security-pattern" aria-label="Patrón de nueve puntos">' +
      Array.from({length:9},(_,i)=>'<button type="button" data-pattern-node="'+(i+1)+'" aria-label="Punto '+(i+1)+'">'+(i+1)+'</button>').join('') +
      '</div><p class="security-help">Selecciona al menos 4 puntos en orden. Toca cada punto una vez.</p>';
  }
  function bindPattern() {
    pattern = [];
    const grid = overlay.querySelector('.security-pattern');
    if (!grid) return;
    grid.querySelectorAll('[data-pattern-node]').forEach(btn => btn.addEventListener('click', () => {
      const n = Number(btn.dataset.patternNode);
      if (pattern.includes(n) || pattern.length >= 9) return;
      pattern.push(n);
      btn.classList.add('selected');
      btn.setAttribute('aria-pressed','true');
    }));
  }
  function readPattern() { return pattern.length >= 4 ? pattern.join('-') : ''; }
  function resetPattern() {
    pattern = [];
    overlay?.querySelectorAll('[data-pattern-node]').forEach(btn=>{btn.classList.remove('selected');btn.setAttribute('aria-pressed','false');});
  }
  function showMenu() {
    stage = 'menu';
    setScreen('Protege tu acceso', 'Puedes usar un PIN o un patrón para bloquear Ábaco al abrirla. Es opcional y la clave se guarda solo en este dispositivo.', 
      '<div class="security-choice"><button type="button" data-mode="pin" class="active">Crear PIN</button><button type="button" data-mode="pattern">Crear patrón</button></div>' +
      '<div id="securitySetupFields"></div><div class="security-actions"><button type="button" class="btn btn-primary" id="securityStart">Configurar protección</button><button type="button" class="btn btn-ghost" id="securityLater">Ahora no</button>' +
      (readConfig() ? '<button type="button" class="btn btn-ghost" id="securityDisable">Desactivar protección</button>' : '') + '</div>');
    const fieldBox = overlay.querySelector('#securitySetupFields');
    const renderFields = () => {
      overlay.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
      fieldBox.innerHTML = mode==='pin'
        ? '<label for="securityPin">PIN de 4 a 8 dígitos</label><input id="securityPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" pattern="[0-9]{4,8}" placeholder="Crea tu PIN"><label for="securityPinConfirm">Confirma el PIN</label><input id="securityPinConfirm" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" placeholder="Repite el PIN">'
        : '<p class="security-help">Dibuja tu patrón tocando al menos cuatro puntos.</p>'+patternMarkup()+'<button type="button" class="btn btn-ghost" id="securityPatternNext">Continuar con este patrón</button>';
      if (mode==='pattern') bindPattern();
    };
    overlay.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;renderFields();showError('');}));
    renderFields();
    overlay.querySelector('#securityStart').addEventListener('click', async()=>{
      if (busy) return;
      let secret = '';
      if (mode==='pin') {
        const pin = overlay.querySelector('#securityPin')?.value || '';
        const confirm = overlay.querySelector('#securityPinConfirm')?.value || '';
        if (!/^\d{4,8}$/.test(pin)) return showError('El PIN debe tener entre 4 y 8 dígitos.');
        if (pin!==confirm) return showError('Los PIN no coinciden.');
        secret=pin;
      } else {
        secret=readPattern();
        if (!secret) return showError('El patrón debe unir al menos 4 puntos.');
        return showPatternConfirmation(secret);
      }
      await saveSecret(secret,mode);
    });
    overlay.querySelector('#securityLater').addEventListener('click',()=>{closeOverlay();});
    overlay.querySelector('#securityDisable')?.addEventListener('click',()=>{
      if(confirm('¿Desactivar el PIN o patrón de Ábaco en este dispositivo?')) {
        localStorage.removeItem(STORAGE_KEY); closeOverlay(); showToast('Protección desactivada');
      }
    });
    openOverlay();
  }
  function showPatternConfirmation(secret) {
    firstSecret=secret;
    stage='confirm-pattern';
    setScreen('Confirma tu patrón','Vuelve a dibujar exactamente el mismo patrón para evitar errores.',patternMarkup()+
      '<div class="security-actions"><button type="button" class="btn btn-primary" id="securityConfirmPattern">Confirmar patrón</button><button type="button" class="btn btn-ghost" id="securityRedoPattern">Volver a dibujar</button></div>');
    bindPattern();
    overlay.querySelector('#securityConfirmPattern').addEventListener('click',async()=>{
      const second=readPattern();
      if(!second)return showError('Selecciona al menos 4 puntos.');
      if(second!==firstSecret){firstSecret='';resetPattern();return showError('El patrón no coincide. Inténtalo de nuevo.');}
      await saveSecret(second,'pattern');
    });
    overlay.querySelector('#securityRedoPattern').addEventListener('click',()=>showMenu());
  }
  async function saveSecret(secret,selectedMode) {
    busy=true;
    try {
      const config=await makeConfig(secret,selectedMode);
      writeConfig(config);
      closeOverlay();
      showToast(selectedMode==='pin'?'PIN configurado en este dispositivo':'Patrón configurado en este dispositivo');
    } catch(e) {
      showError(e.message || 'No se pudo configurar la protección.');
    } finally { busy=false; }
  }
  function showUnlock(config) {
    stage='unlock';
    mode=config.mode;
    setScreen('Desbloquea Ábaco',config.mode==='pin'?'Introduce tu PIN para continuar.':'Dibuja tu patrón para continuar.',
      (config.mode==='pin'
        ? '<label for="securityUnlockPin">PIN</label><input id="securityUnlockPin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" placeholder="Introduce tu PIN">'
        : patternMarkup()) +
      '<div class="security-actions"><button type="button" class="btn btn-primary" id="securityUnlock">Desbloquear</button></div>');
    if (config.mode==='pattern') bindPattern();
    overlay.querySelector('#securityUnlock').addEventListener('click',async()=>{
      if (busy) return;
      let secret='';
      if (config.mode==='pin') {
        secret=overlay.querySelector('#securityUnlockPin')?.value || '';
        if (!/^\d{4,8}$/.test(secret)) return showError('Introduce un PIN válido.');
      } else {
        secret=readPattern();
        if (!secret) return showError('Dibuja tu patrón.');
      }
      if(Date.now()<blockedUntil) return showError('Espera unos segundos antes de volver a intentarlo.');
      busy=true;
      try {
        if(await verify(secret,config)) {
          failedAttempts=0; blockedUntil=0; closeOverlay();
          try { window.dispatchEvent(new Event('abaco:unlocked')); } catch (_) {}
        } else {
          failedAttempts++;
          if(failedAttempts>=5){blockedUntil=Date.now()+30000;failedAttempts=0;}
          showError(Date.now()<blockedUntil?'Demasiados intentos. Espera 30 segundos.':'No coincide. Inténtalo de nuevo.');
          if(mode==='pattern') resetPattern();
          const pin=overlay.querySelector('#securityUnlockPin'); if(pin){pin.value='';pin.focus();}
        }
      } finally { busy=false; }
    });
    openOverlay();
    if(config.mode==='pin') setTimeout(()=>overlay.querySelector('#securityUnlockPin')?.focus(),50);
  }
  function showToast(message) {
    try { if(typeof window.toast==='function'){window.toast(message);return;} } catch (_) {}
    const el=document.createElement('div');
    el.textContent=message;
    Object.assign(el.style,{position:'fixed',bottom:'20px',left:'20px',right:'20px',zIndex:'100001',padding:'12px',background:'#0F766E',color:'#fff',borderRadius:'12px',textAlign:'center'});
    document.body.appendChild(el);setTimeout(()=>el.remove(),2400);
  }
  function addMenuEntry() {
    const clear=document.getElementById('btnClearAll');
    if(!clear || document.getElementById('btnSecuritySettings')) return;
    const item=document.createElement('div');
    item.className='menu-item security-menu-item';
    item.id='btnSecuritySettings';
    item.innerHTML='<span class="ico">⌑</span><span class="menu-item-label">Seguridad de acceso</span>';
    item.setAttribute('role','button');item.tabIndex=0;
    item.addEventListener('click',showMenu);
    item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showMenu();}});
    clear.insertAdjacentElement('afterend',item);
  }
  function init() {
    ensureOverlay();
    addMenuEntry();
    const config=readConfig();
    if(config && config.version===1 && ['pin','pattern'].includes(config.mode) && config.salt && config.hash) showUnlock(config);
    // Si no se configuró, el acceso sigue como siempre; la opción está disponible en Menú.
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();