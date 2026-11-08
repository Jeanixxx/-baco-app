/* Ábaco · delegación de eventos (Fase 5).
 *
 * Un solo escucha de clics en el documento. Cada botón de una lista lleva un atributo
 * data-… con su identificador; la tabla ACTIONS dice qué función lo atiende.
 * Así las listas se pueden repintar sin volver a enlazar cada botón, y no quedan
 * manejadores huérfanos en memoria.
 *
 * Se carga después de app.js. Las funciones se buscan al momento del clic.
 */
(function () {
  'use strict';

  /* atributo -> acción(valor, elemento, evento) */
  const ACTIONS = {
    'data-debt-del': (v) => deleteDebtor(v),
    'data-inv-del': (v) => deleteInvestment(v),
    'data-lista-toggle': (v) => toggleChecklistItem(v),
    'data-lista-del': (v) => deleteChecklistItem(v),
    'data-budget-spend': (v) => adjustBudgetSpent(v),
    'data-budget-del': (v) => deleteBudget(v),
    'data-msi-paid': (v) => { const [id, index] = v.split(':'); toggleMsiInstallment(id, Number(index)); },
    'data-card-edit': (v) => editCard(v),
    'data-card-del': (v) => deleteCard(v),
    'data-loan-pay': (v) => markLoanPayment(v),
    'data-edit': (v) => editKanban(v),
    'data-del': (v) => deleteKanban(v),
    'data-account-edit': (v) => editAccount(v),
    'data-cart-remove': (v) => removeCart(Number(v)),
    'data-go': (v) => { closeMenu(); goPanel(v); },
    'data-av': (v) => { state.accountView = v; LS_SET('account_view', state.accountView); save(); renderInicio(); },
    'data-quiz': (v) => {
      if (v === 'next') nextWalletQuiz();
      else if (v === 'skip') finishWalletQuiz(true);
    },
    'data-home': (v, el, e) => {
      if (v === 'charts') toggleHomeCharts();
      else if (v === 'close') closeHomeCharts();
      else if (v === 'all') showAllCategoriesModal();
      else if (v === 'backdrop' && e.target === el) closeHomeCharts();
    }
  };
  const SELECTOR = Object.keys(ACTIONS).map((a) => '[' + a + ']').join(',');

  document.addEventListener('click', (e) => {
    if (!e.target || !e.target.closest) return;
    const el = e.target.closest(SELECTOR);
    if (!el) return;
    // El atributo de la acción es el primero que el elemento tenga de la tabla.
    for (const attr of Object.keys(ACTIONS)) {
      if (el.hasAttribute(attr)) {
        const value = el.getAttribute(attr);
        // Los botones dentro de una tarjeta no deben activar también el clic de la tarjeta.
        if (attr === 'data-edit' || attr === 'data-del' || attr === 'data-debt-del' || attr === 'data-inv-del') e.stopPropagation();
        ACTIONS[attr](value, el, e);
        return;
      }
    }
  });
})();
