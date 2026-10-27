'use strict';
/* Hash router: one view module per sidebar item, swapped inside #view. */
(function (A) {
  const ALIAS = { channels: 'social' };
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const closeNav = () => { sidebar.classList.remove('open'); scrim.classList.remove('show'); };

  A.resolve = (name) => { const n = ALIAS[name] || name; return A.views[n] ? n : 'overview'; };
  A.go = (name) => {
    const n = A.resolve(name);
    closeNav();
    if (location.hash.slice(1) !== n) location.hash = n; // hashchange renders
    else A.setTab(n);
  };
  A.setTab = (name) => {
    A.S.tab = A.resolve(name);
    A.store('t4e-growth-tab', A.S.tab);
    A.render();
    window.scrollTo({ top: 0 });
  };
  window.addEventListener('hashchange', () => {
    const n = A.resolve(location.hash.slice(1));
    if (n !== A.S.tab) A.setTab(n);
  });

  A.render = () => {
    const S = A.S, view = A.views[S.tab] || A.views.overview;
    document.querySelectorAll('#sidebar [data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === S.tab));
    document.getElementById('page-title').textContent = view.title;
    document.title = `${view.title} · LATAM Growth`;
    if (!S.data) return;
    const host = document.getElementById('view');
    const el = document.createElement('div');
    el.className = `view view-${S.tab} fade-in`;
    try { el.innerHTML = view.render(); } catch (e) {
      console.error(e);
      el.innerHTML = `<section class="card">${A.ui.empty('This screen could not be drawn', A.ui.esc(e.message), 'triangle-exclamation')}</section>`;
    }
    host.replaceChildren(el);
    if (view.mount) view.mount(el);
    A.footer();
  };

  sidebar.addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) A.go(b.dataset.page); });
  document.getElementById('nav-toggle').addEventListener('click', () => { sidebar.classList.add('open'); scrim.classList.add('show'); });
  scrim.addEventListener('click', closeNav);
  document.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); A.go(g.dataset.go); } });
})(window.App);
