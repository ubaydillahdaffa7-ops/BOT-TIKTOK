'use strict';
(() => {
  const dialog = document.getElementById('adminInfoDialog');
  if (!dialog) return;
  document.querySelectorAll('[data-admin-info-trigger]').forEach(button => {
    button.addEventListener('click', () => {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
  });
  const close = () => { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); };
  dialog.querySelectorAll('[data-admin-info-close]').forEach(button => button.addEventListener('click', close));
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });
})();
