'use strict';
/* Goals: color-coded pace board per metric, per cadence (calendar month, quarter or a custom
   big-goal window) and per grouping (overall, traffic source, channel, campaign). Targets come
   from api/goals — admin-only writes, archived never deleted, changes logged server-side.
   The pace marker shows the straight-line share of the target due by today. */
(function (A) {
  const U = A.ui;
  const G = A.goals = { data: null, edit: null, arch: false, loading: false };
  const STATUS = { met: ['success', 'Goal met', 'green'], on: ['success', 'On pace', 'green'], watch: ['warning', 'Watch', 'yellow'], behind: ['error', 'Behind pace', 'red'] };
  const RING = { met: 'success', on: 'success', watch: 'warning', behind: 'error' };

  G.ensure = async (force) => {
    if ((G.data && !force) || G.loading) return;
    G.loading = true;
    try { G.data = await A.api('api/goals'); }
    catch (e) { if (e.message !== 'code') U.toast(`Goals: ${e.message}`, 'error'); }
    finally { G.loading = false; }
    if (A.S.data) A.render();
  };

  const admin = () => A.S.me && A.S.me.role === 'admin';
  const num = (g, v) => (g.metric === 'ad_spend' ? U.money(v) : U.fmt(v));

  // The values a grouping can take, straight from the loaded data.
  function groups(metricKey) {
    const spec = (G.data.metrics || {})[metricKey] || {};
    if (metricKey === 'external_signups')
      return [...new Set(((A.S.data.events) || []).filter((e) => e.kind === 'form_signup').map((e) => e.channel || e.source || '').filter(Boolean))].sort();
    const srcs = spec.sources || (spec.source ? [spec.source] : []);
    return [...new Set(A.D.M().filter((r) => srcs.includes(r.source) && r.metric === spec.metric && r.dim_value).map((r) => r.dim_value))].sort();
  }

  function actual(g) {
    const w = g.window, to = U.today();
    const spec = (G.data.metrics || {})[g.metric] || {};
    const grp = g.grouping !== 'overall' ? (r) => (r.dim_value || '') === g.group : undefined;
    if (g.metric === 'external_signups') {
      return ((A.S.data.events) || []).filter((e) => e.kind === 'form_signup' && e.date >= w.from && e.date <= to && !e.internal
        && (g.grouping !== 'channel' || (e.channel || e.source || '') === g.group)).length;
    }
    if (g.metric === 'platform_signups') return A.D.sum('posthog', 'ph_new_persons', (r) => r.dim_value !== 'Internal', w.from, to);
    if (g.metric === 'ga4_sessions') {
      // Daily metrics once the GA4 connector runs; the seed baseline is snapshot-only, so the
      // channels table (its own window, best overlap) is the fallback.
      if (A.D.has('ga4', 'ga_sessions')) return A.D.sum('ga4', 'ga_sessions', grp, w.from, to);
      const ch = A.D.snap('ga4', 'channels', w.from, to);
      const row = ch && (ch.rows || []).find((r) => !grp || r.channel === g.group);
      return row ? (row.sessions || 0) : 0;
    }
    return (spec.sources || [spec.source]).reduce((s, k) => s + A.D.sum(k, spec.metric, grp, w.from, to), 0);
  }

  function status(g, act) {
    const w = g.window;
    const elapsed = Math.min(w.total_days, Math.max(1, U.diffDays(w.from, U.today()) + 1));
    const expected = (g.target * elapsed) / w.total_days;
    const key = act >= g.target ? 'met' : act >= expected ? 'on' : act >= expected * 0.85 ? 'watch' : 'behind';
    return { key, expected, elapsed };
  }

  function ring(share, color) {
    const p = Math.max(0, Math.min(1, share));
    const C = 2 * Math.PI * 30;
    return `<svg class="goal-ring" viewBox="0 0 72 72" role="img" aria-label="${Math.round(p * 100)}% of target">
      <circle class="track" cx="36" cy="36" r="30"></circle>
      <circle class="fg" cx="36" cy="36" r="30" style="stroke:var(--color-${color});stroke-dasharray:${(p * C).toFixed(1)} ${C.toFixed(1)}"></circle>
      <text x="36" y="40.5" text-anchor="middle">${Math.round(p * 100)}%</text></svg>`;
  }

  function tile(g) {
    const spec = (G.data.metrics || {})[g.metric] || {};
    const act = actual(g);
    const st = status(g, act);
    const [pk, label, sc] = STATUS[st.key];
    const share = g.target ? act / g.target : 0;
    const pace = g.target ? st.expected / g.target : 0;
    const daysLeft = Math.max(0, U.diffDays(U.today(), g.window.end));
    const gl = G.data.group_label || {};
    return `<div class="goal-card st-${sc}${g.cadence === 'custom' ? ' big' : ''}">
      <div class="goal-top"><span class="goal-name">${U.esc(g.name)}</span>${U.pill(pk, label, true)}</div>
      <div class="goal-chips">${U.pill('info', g.window.label)}${U.pill('neutral', `${gl[g.grouping] || g.grouping}${g.group ? ' · ' + U.esc(g.group) : ''}`)}${g.example ? U.pill('neutral', 'Example') : ''}</div>
      <div class="goal-side">
        <div class="goal-main">
          <div class="goal-nums"><span class="goal-actual">${num(g, act)}</span><span class="goal-target">of ${num(g, g.target)} · ${U.esc(spec.hint || '')}</span></div>
          <div class="goal-pace" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100, share * 100))}" aria-label="${U.esc(g.name)} progress"><i style="width:${Math.min(100, share * 100).toFixed(1)}%;background:var(--color-${RING[st.key]})"></i><b style="left:${Math.min(99.5, pace * 100).toFixed(1)}%" title="Expected by today"></b></div>
          <div class="goal-meta"><span>expected by today <b>${num(g, Math.round(st.expected * 10) / 10)}</b></span><span><b>${daysLeft}d</b> left</span></div>
        </div>
        ${ring(share, RING[st.key])}
      </div>
      ${(admin() && !g.example) ? `<div class="goal-act"><button type="button" class="btn btn-secondary btn-sm" data-goal-edit="${U.esc(g.id)}">${U.icon('pen')} Edit</button><button type="button" class="btn btn-secondary btn-sm" data-goal-arch="${U.esc(g.id)}">${g.status === 'archived' ? 'Restore' : 'Archive'}</button></div>` : ''}
    </div>`;
  }

  function formCard() {
    const p = G.edit;
    const grps = groups(p.metric);
    const spec = (G.data.metrics || {})[p.metric] || {};
    const groupings = spec.groupings || ['overall'];
    const f = (name, label, inner, hint) => `<label class="field"><span>${U.esc(label)}</span>${inner}${hint ? `<small>${U.esc(hint)}</small>` : ''}</label>`;
    const sel = (name, opts, cur) => `<select name="${name}" style="width:100%">${opts.map(([v, t]) => `<option value="${U.esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${U.esc(t)}</option>`).join('')}</select>`;
    const cadence = p.cadence || 'monthly';
    return U.card({
      id: 'goal-form-card', title: p.id ? 'Edit goal' : 'New goal',
      sub: 'A goal tracks one metric for a calendar month or quarter, or a custom start-to-end window (the big goal), overall or for one source, channel or campaign.',
      body: `<form id="goal-form" data-id="${U.esc(p.id || '')}"><div class="ad-form">
        ${f('name', 'Goal name (optional)', `<input name="name" type="text" value="${U.esc(p.name || '')}" placeholder="External sign-ups in the month">`)}
        ${f('metric', 'What it measures', sel('metric', Object.entries(G.data.metrics).map(([k, m]) => [k, m.label]), p.metric), spec.hint)}
        ${f('cadence', 'Cadence', sel('cadence', Object.entries(G.data.cadences), cadence))}
        ${cadence === 'custom' ? f('start', 'Window start', `<input name="start" type="date" value="${U.esc(p.start || '')}" required>`) + f('end', 'Window end', `<input name="end" type="date" value="${U.esc(p.end || '')}" required>`) : ''}
        ${f('grouping', 'Grouping', sel('grouping', groupings.map((k) => [k, (G.data.group_label || {})[k] || k]), p.grouping || 'overall'))}
        ${(p.grouping || 'overall') !== 'overall' ? f('group', 'Value', `<select name="group" style="width:100%" required>${grps.length ? grps.map((v) => `<option value="${U.esc(v)}"${p.group === v ? ' selected' : ''}>${U.esc(v)}</option>`).join('') : '<option value="">No values in the data yet</option>'}</select>`, 'Values come from the data loaded so far.') : ''}
        ${f('target', 'Target', `<input name="target" type="number" min="0" step="any" value="${p.target != null ? U.esc(p.target) : ''}" required>`)}
        ${f('notes', 'Notes (optional)', `<textarea name="notes" rows="2">${U.esc(p.notes || '')}</textarea>`)}
        <div class="form-row" style="grid-column:1/-1"><button class="btn btn-primary">${U.icon('check')} ${p.id ? 'Save goal' : 'Add goal'}</button><button type="button" class="btn btn-secondary" data-goal-cancel>Cancel</button></div>
      </div></form>`,
    });
  }

  function render() {
    if (!G.data) { G.ensure(); return U.card({ title: 'Goals', sub: 'Color-coded targets per metric, cadence and grouping', body: '<div class="skeleton" style="height:180px"></div>' }); }
    const list = G.data.goals.filter((g) => G.arch || g.status !== 'archived');
    const counts = { met: 0, on: 0, watch: 0, behind: 0 };
    for (const g of list) counts[status(g, actual(g)).key] += 1;
    const head = U.card({
      title: 'Goals',
      sub: 'Green: at or above the expected value for today (marker on each bar). Yellow: within 15% below. Red: further behind. Custom windows pace the big goals.',
      right: `<div class="card-actions"><label class="check-chip"><input type="checkbox" id="goal-arch"${G.arch ? ' checked' : ''}>Show archived</label>${admin() ? `<button type="button" class="btn btn-primary" data-goal-new>${U.icon('plus')} New goal</button>` : ''}</div>`,
      body: `<div class="goal-summary">${U.pill('success', `${counts.met} met`, true)}${U.pill('success', `${counts.on} on pace`, true)}${U.pill('warning', `${counts.watch} watch`, true)}${U.pill('error', `${counts.behind} behind`, true)}</div>`,
    });
    return `${head}${(G.edit && admin()) ? formCard() : ''}
      ${list.length ? `<div class="goal-board">${list.map(tile).join('')}</div>`
        : U.card({ title: 'No goals yet', body: U.empty('No goals yet', admin() ? 'Leadership sets them with New goal; the examples show how each one reads.' : 'Ask an admin to set targets; the examples show how each one reads.', 'bullseye') })}`;
  }

  function goalFromForm(form) {
    const o = {};
    for (const [k, v] of new FormData(form).entries()) o[k] = typeof v === 'string' ? v.trim() : v;
    if (o.target !== undefined && o.target !== '') o.target = Number(o.target);
    return o;
  }

  function mount(el) {
    const form = el.querySelector('#goal-form');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = form.dataset.id, body = goalFromForm(form);
      try {
        await A.api(id ? `api/goals/${encodeURIComponent(id)}` : 'api/goals', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
        U.toast(id ? 'Goal saved' : 'Goal added'); G.edit = null; await G.ensure(true);
      } catch (err) { U.toast(err.message, 'error'); }
    });
    const arch = el.querySelector('#goal-arch');
    if (arch) arch.addEventListener('change', (e) => { G.arch = e.target.checked; A.render(); });
    el.addEventListener('change', (e) => {
      const f = e.target.closest && e.target.closest('#goal-form');
      if (!f || !['metric', 'grouping', 'cadence'].includes(e.target.name)) return;
      // The fields change with the metric, grouping and cadence: keep what was typed and redraw.
      const cur = goalFromForm(f);
      G.edit = { ...G.edit, ...cur, group: e.target.name === 'grouping' && cur.grouping === 'overall' ? '' : G.edit.group, id: f.dataset.id || undefined };
      A.render();
    });
    el.addEventListener('click', async (e) => {
      let t;
      if ((t = e.target.closest('[data-goal-new]'))) { G.edit = { metric: 'landing_sessions', cadence: 'monthly', grouping: 'overall' }; A.render(); const n = el.querySelector('#goal-form input'); if (n) n.focus(); return; }
      if ((t = e.target.closest('[data-goal-cancel]'))) { G.edit = null; A.render(); return; }
      if ((t = e.target.closest('[data-goal-edit]'))) { G.edit = { ...(G.data.goals.find((x) => x.id === t.dataset.goalEdit) || {}) }; A.render(); el.querySelector('#goal-form-card')?.scrollIntoView({ behavior: 'smooth' }); return; }
      if ((t = e.target.closest('[data-goal-arch]'))) {
        const g = G.data.goals.find((x) => x.id === t.dataset.goalArch);
        try { await A.api(`api/goals/${encodeURIComponent(g.id)}`, { method: 'PUT', body: JSON.stringify({ status: g.status === 'archived' ? 'active' : 'archived' }) }); U.toast(g.status === 'archived' ? 'Goal restored' : 'Goal archived'); await G.ensure(true); }
        catch (err) { U.toast(err.message, 'error'); }
      }
    });
  }

  A.views.goals = { title: 'Goals', render, mount };
})(window.App);
