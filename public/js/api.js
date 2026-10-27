'use strict';
/* Every request to the server goes through here. Same calls, headers and error rules as before the redesign:
   x-team-code when a team code is stored, login.html on an expired session, the team code prompt on 401 code. */
window.App = window.App || {};
(function (A) {
  A.views = A.views || {};
  A.store = function (k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
    return null;
  };
  async function request(path, opts = {}, asText = false) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const code = A.store('t4e-growth-code'); if (code) headers['x-team-code'] = code;
    const r = await fetch(path, { credentials: 'same-origin', ...opts, headers });
    if (asText && r.ok) return r.text();
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && j.error === 'code') { if (A.ui) A.ui.askCode(); throw new Error('code'); }
    if (r.status === 401 && (j.error === 'auth' || j.error === 'not_configured')) { location.href = 'login.html'; throw new Error('code'); }
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }
  A.api = (path, opts) => request(path, opts);
  A.apiText = (path) => request(path, {}, true);
  A.logout = async () => {
    try { await fetch('api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) { /* the session cookie expires anyway */ }
    location.href = 'login.html';
  };
})(window.App);
