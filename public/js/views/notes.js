
'use strict';
/* Timeline Notes: campaign launches, posts and fixes that explain a change in the charts (api/notes). */
(function (A) {
  const KINDS = [['launch', 'Campaign launch'], ['content', 'Content published'], ['fix', 'Fix'], ['test', 'Test'], ['other', 'Other']];
  function render() {
    const U = A.ui, S = A.S, esc = U.esc;
    const notes = (S.data.notes || []).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const inPeriod = notes.filter((n) => n.date >= S.from && n.date <= S.to).length;
    const form = U.card({
      title: 'Add a note', sub: 'Notes show as numbered markers on the daily charts',
      body: `<form id="note-form" class="form-row">
        <label class="field" for="note-date"><span>Date</span><input type="date" id="note-date" value="${S.to}" required style="width:160px"></label>
        <label class="field" for="note-kind"><span>Type</span><select id="note-kind" style="width:190px">${KINDS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
        <label class="field grow" for="note-label"><span>Note</span><input type="text" id="note-label" maxlength="140" placeholder="e.g. First Medium article published" required></label>
        <button class="btn btn-primary">${U.icon('plus')} Add note</button>
      </form>`,
    });
    const list = U.card({
      title: 'All notes', sub: `${notes.length} notes · ${inPeriod} in the selected period`,
      body: notes.length ? `<ul class="note-list">${notes.map((n) => `<li class="note-item"><span class="mono">${esc(n.date)}</span><span class="note-type note-${esc(n.kind || 'other')}">${esc((KINDS.find((k) => k[0] === n.kind) || KINDS[4])[1])}</span><span>${esc(n.label)}</span><button type="button" class="ghost-icon-btn danger" data-del-note="${esc(n.id)}" aria-label="Delete note" title="Delete">${U.icon('trash-can', 'fa-regular')}</button></li>`).join('')}</ul>`
        : U.empty('No notes yet', 'Add the first launch, post or fix above.', 'message'),
    });
    return `${form}<section class="section">${list}</section>`;
  }
  function mount(el) {
    const U = A.ui;
    el.querySelector('#note-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await A.api('api/notes', { method: 'POST', body: JSON.stringify({ date: el.querySelector('#note-date').value, kind: el.querySelector('#note-kind').value, label: el.querySelector('#note-label').value }) });
        U.toast('Note added'); await A.load();
      } catch (err) { if (err.message !== 'code') U.toast(err.message, 'error'); }
    });
    el.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-del-note]'); if (!del) return;
      if (!(await U.confirm('Delete this timeline note?', 'Delete'))) return;
      try { await A.api(`api/notes/${encodeURIComponent(del.dataset.delNote)}`, { method: 'DELETE' }); U.toast('Note removed'); await A.load(); }
      catch (err) { if (err.message !== 'code') U.toast(err.message, 'error'); }
    });
  }
  A.views.notes = { title: 'Timeline Notes', render, mount };
})(window.App);
