(function () {
  'use strict';
  var selector = [
    '.bot-entry-hero', '.bot-platform-card', '.bot-login-gate', '.bot-metrics > *',
    '.bot-platform-status-row > *', '.bot-info-card', '.activity-panel', '.bot-shortcuts',
    '.category-card', '.tool-card', '.platform-choice', '.info-card', '.admin-section',
    '.metric-card', '.platform-hub', '.setup-guide'
  ].join(',');

  function boot() {
    var candidates = new WeakSet();
    var observer = null;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -5% 0px', threshold: 0.08 });
    }

    function addNode(node, index) {
      if (candidates.has(node)) return;
      candidates.add(node);
      node.classList.add('scroll-reveal');
      node.style.setProperty('--reveal-delay', (Math.min(index % 5, 4) * 55) + 'ms');
      if (observer) observer.observe(node);
      else node.classList.add('is-visible');
    }

    function scan(root) {
      if (!root || (root.nodeType !== 1 && root !== document)) return;
      var nodes = [];
      if (root !== document && root.matches && root.matches(selector)) nodes.push(root);
      if (root.querySelectorAll) {
        var found = root.querySelectorAll(selector);
        for (var i = 0; i < found.length; i++) nodes.push(found[i]);
      }
      for (var j = 0; j < nodes.length; j++) addNode(nodes[j], j);
    }

    scan(document);
    var mutationObserver = new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(function (node) { scan(node); });
      });
    });
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
