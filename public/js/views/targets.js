
'use strict';
/* Monthly targets (memory #113): goal cards used on every dashboard screen, plus the Targets screen
   (template, CSV upload with preview, month selector, inline edit and delete). Every logged-in user can edit. */
(function (A) {
  const U = A.ui;
  const T = A.targets = { meta: {}, byMonth: {}, loading: {} };
  const SRC = {
    landing_sessions: 'HubSpot', unique_visitors: 'GA4', engagement_rate: 'GA4', total_signups: 'HubSpot + PostHog',
    platform_signups: 'PostHog', visit_to_signup_rate: 'HubSpot + PostHog', ad_spend_budget: 'ads platforms', clicks: 'ads platforms', ctr: 'ads platforms',
  };
  const FALLBACK_META = {
    landing_sessions: { label: 'Landing sessions', kind: 'count' }, unique_visitors: { label: 'Unique visitors', kind: 'count' },
    engagement_rate: { label: 'Engagement rate', kind: 'rate' }, total_signups: { label: 'Total sign-ups', kind: 'count' },
    platform_signups: { label: 'Platform sign-ups', kind: 'count' }, visit_to_signup_rate: { label: 'Visit-to-sign-up rate', kind: 'rate' },
    ad_spend_budget: { label: 'Ad spend budget', kind: 'money' }, clicks: { label: 'Clicks', kind: 'count' }, ctr: { label: 'Click-through rate', kind: 'rate' },
  };
  const meta = () => (Object.keys(T.meta).length ? T.meta : FALLBACK_META);

  T.ensure = async (month, force) => {
    if (!month || (!force && (T.byMonth[month] || T.loading[month]))) return;
    T.loading[month] = true;
    try {
      const r = await A.api(`api/targets?month=${encodeURIComponent(month)}`);
      if (r.metrics) T.meta = r.metrics;
      T.byMonth[month] = r.targets || [];
    } catch (e) {
      T.byMonth[month] = T.byMonth[month] || [];
      if (e.message !== 'code') U.toast(`Targets: ${e.message}`, 'error');
    } finally { T.loading[month] = false; }
    if (A.S.data) A.render();
  };
  T.refresh = (month) => { T.byMonth = {}; T.ensure(month, true); if (month !== A.S.to.slice(0, 7)) T.ensure(A.S.to.slice(0, 7), true); };

  // Goal for one metric in one month: month-to-date actual, % of target, pace to month end and status.
  T.goal = (key, month) => {
    const row = (T.byMonth[month] || []).find((t) => t.metric_key === key);
    if (!row) return null;
    const m = meta()[key] || { label: key, kind: 'count' };
    const first = `${month}-01`, last = U.endOfMonth(month), today = U.today();
    const g = { key, row, label: m.label, kind: m.kind, target: row.target_value, month, upcoming: first > today };
    if (g.upcoming) return { ...g, actual: null, status: 'none' };
    const to = last < today ? last : today;
    const elapsed = U.diffDays(first, to) + 1, dim = U.diffDays(first, last) + 1;
    g.ongoing = to < last; g.to = to;
    g.actual = A.D.actual(key, first, to);
    if (g.actual == null) return { ...g, status: 'none' };
    g.ratio = g.target ? g.actual / g.target : null;
    g.projected = m.kind === 'rate' || !g.ongoing ? g.actual : (g.actual / elapsed) * dim;
    const pr = g.target ? g.projected / g.target : null;
    if (pr == null) g.status = 'none';
    else if (key === 'ad_spend_budget') g.status = pr <= 1 ? 'green' : pr <= 1.1 ? 'yellow' : 'red';
    else g.status = pr >= 1 ? 'green' : pr >= 0.9 ? 'yellow' : 'red';
    g.pr = pr;
    return g;
  };
  const STATUS = {
    green: ['success', 'On track'], yellow: ['warning', 'At risk'], red: ['error', 'Off track'], none: ['neutral', 'No data'],
  };
  const BUDGET = { green: ['success', 'Within budget'], yellow: ['warning', 'Near the cap'], red: ['error', 'Over budget'], none: ['neutral', 'No data'] };
  T.statusPill = (g) => { const [k, t] = (g.key === 'ad_spend_budget' ? BUDGET : STATUS)[g.status] || STATUS.none; return U.pill(k, g.upcoming ? 'Upcoming' : t, true); };
  T.card = (g) => {
    const v = (n) => U.value(g.kind, n);
    let meta2;
    if (g.upcoming) meta2 = '<span>Month has not started</span>';
    else if (g.actual == null) meta2 = `<span>Awaiting ${U.esc(SRC[g.key] || 'data')}</span>`;
    else if (g.kind === 'rate') meta2 = `<span>Month-to-date rate, compared directly</span><span><b>${U.pct(g.ratio, 0)}</b> of goal</span>`;
    else if (g.ongoing) meta2 = `<span>Pace to month end <b>${v(g.projected)}</b></span><span><b>${U.pct(g.pr, 0)}</b> of goal</span>`;
    else meta2 = `<span>Month closed</span><span><b>${U.pct(g.ratio, 0)}</b> of goal</span>`;
    const width = g.ratio != null ? Math.min(100, Math.max(0, g.ratio * 100)) : 0;
    return `<div class="goal-card st-${g.status}"><div class="goal-top"><span>${U.esc(g.label)}</span>${T.statusPill(g)}</div>
      <div class="goal-nums"><span class="goal-actual">${g.actual == null ? '–' : v(g.actual)}</span><span class="goal-target">of ${v(g.target)} target</span></div>
      <div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(width)}" aria-label="${U.esc(g.label)} progress"><i style="width:${width.toFixed(1)}%"></i></div>
      <div class="goal-meta">${meta2}</div></div>`;
  };
  // Month goals strip for a dashboard screen: always the month that contains the end of the selected period.
  T.strip = (keys, month = A.S.to.slice(0, 7)) => {
    if (!T.byMonth[month]) { T.ensure(month); return U.section(`Month goals · ${U.monthName(month)}`, 'Loading targets…', '<div class="goal-row"><div class="goal-card"><div class="skeleton" style="height:70px"></div></div></div>'); }
    const goals = keys.map((k) => T.goal(k, month)).filter(Boolean);
    const today = U.today(), last = U.endOfMonth(month);
    const sub = `Month to date (${U.win(`${month}-01`, last < today ? last : today)}) vs the ${U.monthName(month)} target · green ≥100%, yellow 90–99%, red &lt;90% of goal (pace for counts)`;
    const link = `<button type="button" class="btn btn-secondary btn-sm" data-go="targets">${U.icon('bullseye')} Targets</button>`;
    if (!goals.length) return U.section(`Month goals · ${U.monthName(month)}`, sub, `<div class="goal-empty"><span>${U.icon('bullseye')} No targets set for ${U.monthName(month)} on these metrics yet.</span>${link}</div>`);
    return U.section(`Month goals · ${U.monthName(month)}`, sub, `<div class="goal-row">${goals.map(T.card).join('')}</div>`, link);
  };

  // ---------- Targets screen
  const TV = { month: null, preview: null, csv: null, fileName: '', editing: null, busy: false };
  const PV = { plan: null, loading: false, saving: false };
  const PLAN_FIELDS = [
    ['verified_users', 'Verified users', 'count'], ['landing_sessions', 'Landing sessions', 'count'],
    ['visit_to_signup', 'Visit to verified user', 'rate'], ['impressions', 'Paid impressions', 'count'],
    ['impression_to_visit', 'Impression to landing visit', 'rate'], ['paid_budget', 'Paid media budget', 'money'],
    ['paid_cps', 'Planned cost per sign-up', 'money'], ['activation_7d', 'Activation within 7 days', 'rate'],
    ['valid_signups', 'Valid sign-ups', 'rate'],
  ];
  async function ensurePlan() {
    if (PV.plan || PV.loading) return;
    PV.loading = true;
    try { PV.plan = await A.api('api/goal-plan'); }
    catch (e) { if (e.message !== 'code') U.toast(`Scale plan: ${e.message}`, 'error'); }
    finally { PV.loading = false; }
    if (A.S.data) A.render();
  }
  function planForm() {
    if (!PV.plan) { ensurePlan(); return U.section('LATAM scale targets', 'Loading the persistent global and country targets…', '<div class="skeleton" style="height:220px"></div>'); }
    const p = PV.plan;
    const field = ([key, label, kind]) => `<label class="field"><span>${U.esc(label)}${kind === 'rate' ? ' (decimal or %)' : ''}</span><input name="plan:${U.esc(key)}" value="${U.esc(kind === 'rate' ? `${+(Number(p[key]) * 100).toFixed(4)}%` : p[key])}" inputmode="decimal" required></label>`;
    const countries = Object.entries(p.countries || {}).sort((a, b) => a[0].localeCompare(b[0]));
    const countryRows = countries.map(([country, target]) => `<tr><td>${U.esc(country)}</td><td><input name="country:${U.esc(country)}" value="${U.esc(target)}" inputmode="numeric" aria-label="Target for ${U.esc(country)}"></td></tr>`).join('');
    return U.section('LATAM scale targets', 'Persistent targets for the 500K plan. Overview reads these values directly; save here to change the global or country goal.',
      `<form class="card" id="plan-form"><div class="card-header"><div><div class="card-title">${U.esc(p.label || 'LATAM scale goal')}</div><div class="card-sub">Global target and country allocation. The country values can sum differently while you model scenarios; the dashboard shows the allocation you save.</div></div><button class="btn btn-primary"${PV.saving ? ' disabled' : ''}>${U.icon('floppy-disk')} ${PV.saving ? 'Saving…' : 'Save scale targets'}</button></div>
        <div class="ad-form">${PLAN_FIELDS.map(field).join('')}</div>
        <div class="card-header mt-16"><div><div class="card-title">Verified-user target by country</div><div class="card-sub">Traffic uses GA4 country data. Account-country actuals require a trusted country code from product or PostHog.</div></div></div>
        <div class="tbl-wrap"><table><thead><tr><th>Country</th><th class="td-num">Verified-user target</th></tr></thead><tbody>${countryRows}</tbody></table></div>
      </form>`);
  }
  function previewBox() {
    const p = TV.preview; if (!p) return '';
    const ST = { ok: ['success', 'OK'], overwrite: ['warning', 'Overwrite'], error: ['error', 'Error'], skip: ['neutral', 'Skipped'] };
    const n = p.counts.ok + p.counts.overwrite;
    return U.card({
      id: 'targets-preview', title: `Preview · ${TV.fileName || 'targets CSV'}`, sub: 'Nothing is saved until you confirm. Error and skipped rows are left out.',
      right: `<div class="card-actions"><button type="button" class="btn btn-secondary" data-t-cancel>Cancel</button><button type="button" class="btn btn-primary" data-t-confirm${n ? '' : ' disabled'}>${U.icon('check')} Import ${n} row${n === 1 ? '' : 's'}</button></div>`,
      body: `<div class="preview-summary">${U.pill('success', `${p.counts.ok} OK`)}${U.pill('warning', `${p.counts.overwrite} overwrite`)}${U.pill('error', `${p.counts.error} error`)}${U.pill('neutral', `${p.counts.skip} skipped`)}</div>`
        + U.table([
          { t: 'Line', num: 1, f: (r) => r.line }, { t: 'Month', f: (r) => `<span class="mono">${U.esc(r.month)}</span>` },
          { t: 'Metric', f: (r) => `${U.esc(r.label || r.metric_key)}<br><small><code>${U.esc(r.metric_key)}</code></small>` },
          { t: 'Target', num: 1, f: (r) => (r.target_value == null ? U.esc(r.raw) : U.value((meta()[r.metric_key] || {}).kind, r.target_value)) },
          { t: 'Current', num: 1, f: (r) => (r.previous == null ? '–' : U.value((meta()[r.metric_key] || {}).kind, r.previous)) },
          { t: 'Status', f: (r) => { const s = ST[r.status]; return `${U.pill(s[0], s[1])}${r.message ? `<br><small>${U.esc(r.message)}</small>` : ''}`; } },
        ], p.rows, (r) => (r.status === 'skip' ? 'muted' : '')),
    });
  }
  function render() {
    const S = A.S;
    TV.month = TV.month || S.to.slice(0, 7);
    const month = TV.month;
    if (!T.byMonth[month]) T.ensure(month);
    const rows = T.byMonth[month];
    const M = meta();
    const head = `<section class="card"><div class="card-header"><div><div class="card-title">Monthly targets</div><div class="card-sub">Shared by the whole team. Upload a CSV (month, metric_key, target_value) or edit a single value. Rates accept 45% or 0.45.</div></div></div>
      <div class="form-row">
        <label class="field" for="t-month"><span>Month</span><input type="month" id="t-month" value="${U.esc(month)}" style="width:180px"></label>
        <button type="button" class="btn btn-secondary" data-t-template>${U.icon('file-arrow-down')} Download template</button>
        <label class="btn btn-primary" for="t-file" style="margin:0">${U.icon('file-arrow-up')} Upload targets CSV<input type="file" id="t-file" accept=".csv,text/csv" hidden></label>
      </div></section>`;
    const goals = rows ? (rows.length
      ? U.section(`Goal completion · ${U.monthName(month)}`, 'Actual month to date vs target · pace to month end for counts', `<div class="goal-row">${Object.keys(M).map((k) => T.goal(k, month)).filter(Boolean).map(T.card).join('')}</div>`)
      : U.section(`Goal completion · ${U.monthName(month)}`, '', `<div class="goal-empty"><span>${U.icon('bullseye')} No targets for ${U.monthName(month)} yet. Download the template, fill in the values and upload it, or set a value in the table below.</span></div>`)) : '';
    const tableRows = Object.keys(M).map((k) => ({ key: k, m: M[k], t: rows ? rows.find((r) => r.metric_key === k) : null, g: T.goal(k, month) }));
    const table = U.card({
      title: `Targets for ${U.monthName(month)}`, sub: `${rows ? rows.length : 0} of ${Object.keys(M).length} metrics have a target`,
      body: !rows ? '<div class="skeleton" style="height:180px"></div>' : U.table([
        { t: 'Metric', f: (r) => `${U.esc(r.m.label)}<br><small><code>${U.esc(r.key)}</code> · ${U.esc(r.m.kind)}</small>` },
        { t: 'Target', num: 1, f: (r) => (TV.editing === r.key
          ? `<form class="inline-edit" data-t-form="${U.esc(r.key)}"><input name="v" value="${r.t ? U.esc(r.m.kind === 'rate' ? `${+(r.t.target_value * 100).toFixed(2)}%` : r.t.target_value) : ''}" placeholder="${r.m.kind === 'rate' ? '45%' : r.m.kind === 'money' ? '500' : '1000'}" aria-label="Target for ${U.esc(r.m.label)}" required><button class="btn btn-primary btn-sm">Save</button><button type="button" class="btn btn-ghost btn-sm" data-t-cancel-edit>Cancel</button></form>`
          : r.t ? `<b>${U.value(r.m.kind, r.t.target_value)}</b>` : '<span class="text-muted">Not set</span>') },
        { t: 'Actual MTD', num: 1, f: (r) => (r.g && r.g.actual != null ? U.value(r.m.kind, r.g.actual) : '–') },
        { t: '% of goal', num: 1, f: (r) => (r.g && r.g.ratio != null ? U.pct(r.g.ratio, 0) : '–') },
        { t: 'Status', f: (r) => (r.g ? T.statusPill(r.g) : U.pill('neutral', 'No target')) },
        { t: 'Updated', f: (r) => (r.t ? `<small>${U.esc(r.t.updated_by)}<br>${U.esc(U.stamp(r.t.updated_at))}</small>` : '') },
        { t: '', num: 1, f: (r) => (TV.editing === r.key ? '' : `<div class="row-actions"><button type="button" class="ghost-icon-btn" data-t-edit="${U.esc(r.key)}" aria-label="${r.t ? 'Edit' : 'Set'} ${U.esc(r.m.label)} target" title="${r.t ? 'Edit' : 'Set'}">${U.icon(r.t ? 'pen' : 'plus')}</button>${r.t ? `<button type="button" class="ghost-icon-btn danger" data-t-del="${r.t.id}" aria-label="Delete ${U.esc(r.m.label)} target" title="Delete">${U.icon('trash-can', 'fa-regular')}</button>` : ''}</div>`) },
      ], tableRows),
    });
    return `${planForm()}${head}${TV.preview ? `<section class="section">${previewBox()}</section>` : ''}${goals}<section class="section">${table}</section>`;
  }
  async function afterChange(msg) { U.toast(msg); TV.editing = null; T.refresh(TV.month); }
  function mount(el) {
    el.addEventListener('submit', async (e) => {
      if (e.target.id !== 'plan-form') return;
      e.preventDefault();
      const f = e.target, values = new FormData(f), current = PV.plan || {}, body = { countries: {} };
      for (const [key] of PLAN_FIELDS) body[key] = values.get(`plan:${key}`);
      for (const country of Object.keys(current.countries || {})) body.countries[country] = values.get(`country:${country}`);
      PV.saving = true; A.render();
      try {
        PV.plan = await A.api('api/goal-plan', { method: 'PUT', body: JSON.stringify(body) });
        await A.load(); U.toast('Scale targets saved');
      } catch (err) { if (err.message !== 'code') U.toast(err.message, 'error'); }
      finally { PV.saving = false; if (A.S.data) A.render(); }
    });
    el.querySelector('#t-month').addEventListener('change', (e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { TV.month = e.target.value; TV.editing = null; T.ensure(TV.month); A.render(); } });
    el.querySelector('#t-file').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        TV.csv = await file.text(); TV.fileName = file.name;
        TV.preview = await A.api('api/targets/import', { method: 'POST', body: JSON.stringify({ csv: TV.csv }) });
        A.render();
        document.getElementById('targets-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) { if (err.message !== 'code') U.toast(err.message, 'error'); }
    });
    el.addEventListener('submit', async (e) => {
      const f = e.target.closest('[data-t-form]'); if (!f) return;
      e.preventDefault();
      const key = f.dataset.tForm, val = f.elements.v.value.trim();
      const cur = (T.byMonth[TV.month] || []).find((r) => r.metric_key === key);
      try {
        if (cur) await A.api(`api/targets/${cur.id}`, { method: 'PUT', body: JSON.stringify({ target_value: val }) });
        else {
          const r = await A.api('api/targets/import', { method: 'POST', body: JSON.stringify({ csv: `month,metric_key,target_value\n${TV.month},${key},"${val.replace(/"/g, '')}"`, confirm: true }) });
          if (!r.applied) throw new Error((r.rows[0] && r.rows[0].message) || 'The value was not accepted');
        }
        afterChange('Target saved');
      } catch (err) { if (err.message !== 'code') U.toast(err.message, 'error'); }
    });
    el.addEventListener('click', async (e) => {
      const a = (k) => e.target.closest(`[data-${k}]`);
      let b;
      if ((b = a('t-template'))) {
        try { U.download(`monthly-targets-${TV.month}.csv`, await A.apiText(`api/targets/template?month=${encodeURIComponent(TV.month)}`)); }
        catch (err) { if (err.message !== 'code') U.toast(err.message, 'error'); }
        return;
      }
      if ((b = a('t-cancel'))) { TV.preview = null; TV.csv = null; A.render(); return; }
      if ((b = a('t-confirm'))) {
        b.disabled = true;
        try {
          const r = await A.api('api/targets/import', { method: 'POST', body: JSON.stringify({ csv: TV.csv, confirm: true }) });
          TV.preview = null; TV.csv = null;
          afterChange(`${r.applied} target${r.applied === 1 ? '' : 's'} imported`);
        } catch (err) { b.disabled = false; if (err.message !== 'code') U.toast(err.message, 'error'); }
        return;
      }
      if ((b = a('t-edit'))) { TV.editing = b.dataset.tEdit; A.render(); document.querySelector('[data-t-form] input')?.focus(); return; }
      if ((b = a('t-cancel-edit'))) { TV.editing = null; A.render(); return; }
      if ((b = a('t-del'))) {
        if (!(await U.confirm('Delete this target? The goal card for this metric disappears for the month.', 'Delete'))) return;
        try { await A.api(`api/targets/${b.dataset.tDel}`, { method: 'DELETE' }); afterChange('Target deleted'); }
        catch (err) { if (err.message !== 'code') U.toast(err.message, 'error'); }
      }
    });
  }
  A.views.targets = { title: 'Targets', render, mount };
})(window.App);
