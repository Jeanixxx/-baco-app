/* ABACO: arranque mínimo independiente para que el registro nunca dependa del motor principal.
   Este bloque solo gestiona los controles críticos del primer acceso. */
(function(){
  function boot(){
    const q=s=>document.querySelector(s);
    const all=s=>Array.from(document.querySelectorAll(s));
    const name=q('#userName'), register=q('#btnRegister');
    const pronouns=all('#pronounChoice [data-pronoun], #pronounNeutro');
    if(!register || !name || !pronouns.length) return;
    function selectPronoun(btn){
      const value=btn.dataset.pronoun || 'el';
      pronouns.forEach(b=>{
        const on=b===btn; b.classList.toggle('active',on); b.setAttribute('aria-pressed',String(on));
      });
      try{localStorage.setItem('user_pronoun',value)}catch(e){}
    }
    let saved='el';
    try{saved=localStorage.getItem('user_pronoun')||'el'}catch(e){}
    selectPronoun(pronouns.find(b=>b.dataset.pronoun===saved)||pronouns[0]);
    /* El arranque solo prepara el pronombre guardado.
       El registro y la selección quedan a cargo del controlador principal;
       evitamos dos listeners sobre el mismo botón, que podían ejecutar el flujo dos veces. */
    pronouns.forEach(btn=>{ btn.type='button'; });
    register.type='button';
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
