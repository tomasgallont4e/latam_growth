'use strict';
/* Data Sources + Source Detail & Status: every tool behind the numbers, Sync now for automatic connectors,
   status and note per source (api/sources/:key), load history and definitions. */
(function (A) {
  const SV = { sel: null };
  function detail(s) {
    const U = A.ui, esc = U.esc;
    const loads = (A.S.data.synclog || []).filter((r) => r.source === s.key);
    return U.card({
      cls: 'source-detail', id: 'source-detail', title: `${s.name} · details and status`, sub: esc(s.area || ''),
      right: `<button type="button" class="ghost-icon-btn" data-close-src aria-label="Close details">${U.icon('xmark')}</button>`,
      body: `<dl class="kv">
        <dt>Status</dt><dd>${U.statePill(s.state)}</dd>
        <dt>Provides</dt><dd>${esc(s.provides || '–')}</dd>
        <dt>How it connects</dt><dd>${esc(s.connect || '–')}</dd>
        <dt>Service variables</dt><dd>${s.env && s.env.length ? s.env.map((v) => `<code>${esc(v)}</code>`).join(' ') : 'None'}</dd>
        <dt>Automatic sync</dt><dd>${s.auto ? U.pill('success', 'Configured') : U.pill('neutral', 'Not configured: manual or CSV')}</dd>
        <dt>Last load</dt><dd class="mono">${s.last_sync ? esc(U.stamp(s.last_sync)) : 'No loads yet'}</dd>
        <dt>Data window</dt><dd>${esc(s.window || '–')}</dd>
        <dt>Recent loads</dt><dd>${loads.length ? `${loads.length} in the last 30 loads${loads.some((r) => r.error) ? ` · ${U.pill('error', `${loads.filter((r) => r.error).length} with errors`)}` : ''}` : 'None in the last 30 loads'}</dd>
        <dt>Note</dt><dd>${esc(s.note || '–')}</dd></dl>
        <form id="source-form" class="form-row mt-16" data-key="${esc(s.key)}">
          <label class="field"><span>Status</span><select name="state" style="width:190px">${[['connected', 'Connected'], ['pending', 'Access pending'], ['not_started', 'Not started']].map(([v, t]) => `<option value="${v}"${s.state === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
          <label class="field grow"><span>Status note</span><input name="note" maxlength="300" value="${esc(s.note || '')}" placeholder="What is pending, who is on it"></label>
          <button class="btn btn-primary">${U.icon('floppy-disk')} Save status</button>
          ${s.auto ? `<button type="button" class="btn btn-secondary" data-sync="${esc(s.key)}">${U.icon('rotate')} Sync now</button>` : ''}
        </form>`,
    });
  }
  function render() {
    const U = A.ui, S = A.S, esc = U.esc;
    const ss = S.data.sources || [], log = S.data.synclog || [];
    const last = ss.filter((s) => s.last_sync).map((s) => s.last_sync).sort().pop();
    const kpis = U.kpiRow([
      U.kpi({ label: 'Connected sources', source: 'Catalog', value: `${ss.filter((s) => s.state === 'connected').length} / ${ss.length}`, compare: 'Connection/status only. Empty or partial reports can still show Connected.' }),
      U.kpi({ label: 'Automatic connectors', source: 'Service variables', value: U.fmt(ss.filter((s) => s.auto).length), compare: 'Sync on a schedule and with Sync now' }),
      U.kpi({ label: 'Last data load', source: 'All sources', value: last ? U.dshort(last.slice(0, 10)) : '–', compare: last ? `${esc(last.slice(11, 16))} UTC` : 'No loads yet' }),
      U.kpi({ label: 'Loads with errors', source: 'Last 30 loads', value: U.fmt(log.filter((r) => r.error).length), compare: 'Open a source to see what failed' }),
    ], 4);
    const cards = ss.map((s) => `<article class="card source-card${SV.sel === s.key ? ' is-selected' : ''}" data-src="${esc(s.key)}" tabindex="0" role="button" aria-label="Open ${esc(s.name)} details">
      <div class="source-head"><div><div class="card-title">${esc(s.name)}</div><div class="card-sub">${esc(s.area || '')}</div></div>${U.statePill(s.state)}</div>
      <p class="source-provides">${esc(s.provides || '')}</p>
      <div class="source-foot"><span class="mono">${s.last_sync ? `Last load ${esc(U.stamp(s.last_sync))}` : 'No loads yet'}</span>${s.auto ? `<button type="button" class="btn btn-secondary btn-sm" data-sync="${esc(s.key)}">${U.icon('rotate')} Sync now</button>` : U.pill('neutral', 'Manual / CSV')}</div></article>`).join('');
    const sel = ss.find((s) => s.key === SV.sel);
    const history = U.table([
      { t: 'When', f: (r) => `<span class="mono">${esc(U.stamp(r.at))}</span>` }, { t: 'Source', k: 'source' }, { t: 'How', k: 'how' },
      { t: 'Rows', num: 1, f: (r) => (r.error ? U.pill('error', 'Error') : U.fmt((Number(r.metrics) || 0) + (Number(r.snapshots) || 0) + (Number(r.events) || 0))) },
      { t: 'Detail', f: (r) => esc(r.error || '') },
    ], log);
    const defs = `<div class="pad"><dl class="defs">
      <div><dt>Landing sessions (HubSpot)</dt><dd>Visits to every go.think4ever.com page HubSpot tracks, including preview pages. Counts the team's own visits.</dd></div>
      <div><dt>Sessions (Google Analytics)</dt><dd>Sessions on configured SITE_HOSTS after analytics consent. Different coverage from HubSpot whole-site traffic; never mix their denominators. GA4 can include internal/test visits.</dd></div>
      <div><dt>Engaged session</dt><dd>Lasted more than 10 seconds, viewed 2 or more pages, or triggered a key event.</dd></div>
      <div><dt>CRM contact (HubSpot)</dt><dd>A contact whose first/last landing URL matches the configured site. Dated by contact creation, not necessarily form submission. Known internal domains/companies and explicit QA medium/campaigns are excluded when the checkbox is active.</dd></div>
      <div><dt>New observed person (PostHog)</dt><dd>A new person record with a site event. Internal/External/Unknown classification uses configured email domains and companies. Unknown identity is shown separately; person creation does not prove registration or verification.</dd></div>
      <div><dt>Sign-ups / 500K goal</dt><dd>First registration_started per person since launch in PostHog, excluding qa_probe and project test accounts. account_created is a separate later funnel step. CRM contacts and person creation are not substituted for this event.</dd></div>
      <div><dt>Visit-to-verification / seven-day activation</dt><dd>Requires linked sessions, registrations and dated project events for the same cohort. Independent totals and the click Action cannot supply these rates.</dd></div>
      <div><dt>Cost per attributed CRM contact</dt><dd>Spend divided by paid UTM contacts for the same reporting channels and dates. This is not cost per sign-up. Missing spend or zero contacts leaves cost unavailable.</dd></div>
    </dl></div>`;
    return U.section('Data sources', 'Every number in this dashboard comes from one of these tools. Credentials go in the service variables, never in files.', kpis)
      + `<section class="section">${sel ? detail(sel) : ''}<div class="source-grid">${cards}</div></section>`
      + U.section('History and definitions', '', `<div class="detail-group">${U.details('Load history', `last ${log.length} loads`, log.length ? history : U.empty('No loads yet'), true)}${U.details('Definitions', 'why two tools can show different numbers', defs)}</div>`);
  }
  async function sync(btn) {
    const U = A.ui;
    btn.disabled = true; const label = btn.innerHTML; btn.innerHTML = `${U.icon('spinner', 'fa-solid', 'fa-spin')} Syncing…`;
    try { const r = await A.api(`api/sync/${encodeURIComponent(btn.dataset.sync)}`, { method: 'POST' }); U.toast(`Synced: ${r.metrics} rows`); await A.load(); }
    catch (err) { if (err.message !== 'code') U.toast(err.message, 'error'); btn.disabled = false; btn.innerHTML = label; }
  }
  function mount(el) {
    const open = (key) => { SV.sel = SV.sel === key ? null : key; A.render(); if (SV.sel) document.getElementById('source-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    el.addEventListener('click', (e) => {
      const s = e.target.closest('[data-sync]'); if (s) { e.stopPropagation(); sync(s); return; }
      if (e.target.closest('[data-close-src]')) { SV.sel = null; A.render(); return; }
      const c = e.target.closest('[data-src]'); if (c) open(c.dataset.src);
    });
    el.addEventListener('keydown', (e) => { const c = e.target.closest && e.target.closest('[data-src]'); if (c && (e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); open(c.dataset.src); } });
    el.addEventListener('submit', async (e) => {
      if (e.target.id !== 'source-form') return;
      e.preventDefault();
      const f = e.target;
      try {
        await A.api(`api/sources/${encodeURIComponent(f.dataset.key)}`, { method: 'PUT', body: JSON.stringify({ state: f.elements.state.value, note: f.elements.note.value }) });
        A.ui.toast('Status saved'); await A.load();
      } catch (err) { if (err.message !== 'code') A.ui.toast(err.message, 'error'); }
    });
  }
  A.views.sources = { title: 'Data Sources', render, mount };
})(window.App);
