(function () {
  'use strict';
  var dialog = document.getElementById('adminInfoDialog');
  if (!dialog) return;

  var previousFocus = null;
  var closeButton = dialog.querySelector('[data-admin-info-close]');

  function openInfo(event) {
    if (event && event.preventDefault) event.preventDefault();
    previousFocus = document.activeElement;
    dialog.hidden = false;
    dialog.classList.add('is-open');
    document.body.classList.add('admin-info-open');
    if (closeButton && closeButton.focus) closeButton.focus();
  }

  function closeInfo() {
    if (dialog.hidden) return;
    dialog.classList.remove('is-open');
    dialog.hidden = true;
    document.body.classList.remove('admin-info-open');
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    previousFocus = null;
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (target && target.nodeType !== 1) target = target.parentElement;
    var trigger = target && target.closest ? target.closest('[data-admin-info-trigger]') : null;
    if (trigger) { openInfo(event); return; }
    var close = target && target.closest ? target.closest('[data-admin-info-close]') : null;
    if (close) { closeInfo(); return; }
    if (event.target === dialog) closeInfo();
  });

  document.addEventListener('keydown', function (event) {
    if (dialog.hidden) return;
    if (event.key === 'Escape') {
      if (event.preventDefault) event.preventDefault();
      closeInfo();
      return;
    }
    if (event.key === 'Tab') {
      var nodes = dialog.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      var focusable = [];
      for (var i = 0; i < nodes.length; i++) {
        if (!nodes[i].hidden && nodes[i].offsetParent !== null) focusable.push(nodes[i]);
      }
      if (!focusable.length) {
        if (event.preventDefault) event.preventDefault();
        dialog.focus();
        return;
      }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
  });
})();
