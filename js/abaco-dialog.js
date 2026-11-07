/* Ábaco · diálogos propios (Fase 5).
 * Reemplazan confirm() y prompt() del navegador: su comportamiento no es igual en
 * todos los WebView de Android, y bloquean el hilo. Aquí todo es asíncrono y
 * accesible: foco en el primer campo, Esc cancela, Enter confirma.
 *
 *   await askConfirm('¿Borrar?')            -> true | false
 *   await askFields({ title, fields })      -> { campo: valor } | null
 */
(function () {
  'use strict';

  let open = null; // diálogo abierto en este momento (solo uno a la vez)

  function build({ title, body, fields = [], confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', danger = false }) {
    return new Promise((resolve) => {
      if (open) open.close(null); // un diálogo nuevo reemplaza al anterior sin dejarlo colgado

      const overlay = document.createElement('div');
      overlay.className = 'abaco-dialog-overlay';
      const card = document.createElement('div');
      card.className = 'abaco-dialog';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      const h = document.createElement('h3');
      h.textContent = title;
      card.appendChild(h);
      if (body) {
        const p = document.createElement('p');
        p.className = 'abaco-dialog-body';
        p.textContent = body;
        card.appendChild(p);
      }

      const inputs = {};
      for (const f of fields) {
        const label = document.createElement('label');
        label.className = 'abaco-dialog-label';
        label.textContent = f.label;
        label.htmlFor = 'dlg-' + f.id;
        let input;
        if (f.type === 'select') {
          input = document.createElement('select');
          for (const o of f.options || []) {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            input.appendChild(opt);
          }
        } else if (f.type === 'textarea') {
          input = document.createElement('textarea');
          input.rows = f.rows || 8;
        } else {
          input = document.createElement('input');
          input.type = f.type || 'text';
        }
        input.id = 'dlg-' + f.id;
        if (f.inputmode) input.setAttribute('inputmode', f.inputmode);
        input.value = f.value == null ? '' : String(f.value);
        if (f.placeholder) input.placeholder = f.placeholder;
        card.appendChild(label);
        card.appendChild(input);
        inputs[f.id] = input;
      }

      const actions = document.createElement('div');
      actions.className = 'abaco-dialog-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn-ghost';
      cancel.textContent = cancelLabel;
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = danger ? 'btn btn-danger' : 'btn btn-primary';
      ok.textContent = confirmLabel;
      actions.appendChild(cancel);
      actions.appendChild(ok);
      card.appendChild(actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      const finish = (result) => {
        if (open !== handle) return;
        open = null;
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(result);
      };
      const collect = () => {
        if (!fields.length) return true;
        const out = {};
        for (const f of fields) out[f.id] = inputs[f.id].value;
        return out;
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); finish(fields.length ? null : false); }
        else if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') { e.preventDefault(); finish(collect()); }
      };
      const handle = { close: (v) => finish(v) };
      open = handle;
      document.addEventListener('keydown', onKey, true);
      cancel.addEventListener('click', () => finish(fields.length ? null : false));
      ok.addEventListener('click', () => finish(collect()));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(fields.length ? null : false); });

      const first = fields.length ? inputs[fields[0].id] : ok;
      setTimeout(() => first.focus(), 30);
    });
  }

  window.askConfirm = (message, opts = {}) =>
    build({ title: message, confirmLabel: opts.confirmLabel || 'Sí', cancelLabel: 'No', danger: opts.danger !== false }).then((r) => r === true);

  window.askFields = (opts) => build(opts);
})();
