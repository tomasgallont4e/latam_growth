
'use strict';
/* Product usage (handoff WBS 6.4.20). Separate from the LATAM Growth acquisition funnel and from
   the Early Builders board: same PostHog events, different metrics and cohorts.
   Every count is unique portal accounts or distinct projects, never raw events. Data is
   consolidated through yesterday (America/Bogota). Internal/test accounts are excluded.
   Source: the synced product_usage snapshot when present, otherwise the read-only
   api/product/metrics reader (memory #149). A missing event shows "Waiting for event", never zero. */
(function (A) {
  const api = { key: null, status: 'idle', data: null, error: '' };

  function snaps(key) {
    return ((A.S.data && A.S.data.snapshots) || []).filter((s) => s.source === 'posthog' && s.key === key)
      .sort((a, b) => String(b.pulled_at || b._at || '').localeCompare(String(a.pulled_at || a._at || '')));
  }
  function load() {
    const head = snaps('product_usage')[0];
    const cov = head && head.rows && head.rows[0];
    if (!cov || cov.available !== true) return { ok: false, missing: !head, reason: (cov && cov.reason) || 'PostHog product usage has not synced yet.' };
    const accounts = ((A.S.data && A.S.data.snapshots) || [])
      .filter((s) => s.source === 'posthog' && /^product_usage_\d+$/.test(String(s.key || '')) && s.from === head.from && s.to === head.to)
      .sort((a, b) => Number(String(a.key).slice(14)) - Number(String(b.key).slice(14)))
      .flatMap((s) => s.rows || []);
    const projects = (snaps('product_projects').find((s) => s.from === head.from && s.to === head.to) || { rows: [] }).rows || [];
    return { ok: true, head, cov, accounts, projects };
  }
  // Read-only PostHog reader, one request per cutoff (the server caches it for 30 minutes).
  function fromApi(cutoff) {
    if (api.key !== cutoff) {
      api.key = cutoff; api.status = 'loading'; api.data = null; api.error = '';
      A.api(`api/product/metrics?cutoff=${encodeURIComponent(cutoff)}`).then((d) => {
        if (api.key !== cutoff) return;
        api.status = 'loaded'; api.data = d || {};
        A.render();
      }).catch((e) => {
        if (api.key !== cutoff) return;
        api.status = 'error'; api.error = (e && e.message) || 'request failed';
        A.render();
      });
    }
    if (api.status === 'loading') return { ok: false, reason: 'Loading from PostHog…' };
    if (api.status === 'error') return { ok: false, reason: `Product metrics did not load: ${api.error}` };
    const d = api.data || {};
    if (!Array.isArray(d.accounts)) return { ok: false, reason: (d.warnings && d.warnings[0]) || 'The PostHog accounts query returned no rows.' };
    return {
      ok: true,
      head: { to: d.cutoff, pulled_at: d.pulled_at },
      cov: { internal_patterns: d.internal_patterns, truncated: !!(d.truncated && d.truncated.accounts) },
      accounts: d.accounts, projects: d.projectDays || [], events: d.events || {}, extra: d,
    };
  }
  function kpi(label, value, sub) {
    const U = A.ui;
    return U.card({ title: label, body: `<div class="overview-metric-value">${value == null ? '<span class="kpi-awaiting">Pending</span>' : typeof value === 'string' ? U.esc(value) : U.fmt(value)}</div><p class="card-note">${U.esc(sub)}</p>` });
  }
  function pending(label, why) {
    return A.ui.card({ title: label, body: `<div class="overview-metric-value"><span class="kpi-awaiting">No data · Product event pending</span></div><p class="card-note">${A.ui.esc(why)}</p>` });
  }
  function waiting(label, name, why) {
    return A.ui.card({ title: label, body: `<div class="overview-metric-value"><span class="kpi-awaiting">Waiting for event · ${A.ui.esc(name)}</span></div><p class="card-note">${A.ui.esc(why)}</p>` });
  }
  // Credits, churn and retention. With the live reader they turn on by themselves once the event exists.
  function later(data, cutoff) {
    const U = A.ui, P = A.productUsage;
    const retention = pending('Retention D1 / D7', 'Product must define calendar day vs 24-hour windows before this is shown.');
    const ev = data && data.events;
    if (!ev) {
      return [
        pending('Credits consumed', 'Needs backend credits_granted / credits_consumed events with account, amount and timestamp.'),
        pending('Time to first credit use', 'Needs the same credit events.'),
        pending('Cancellations and monthly churn', 'Needs subscription_started / subscription_cancelled and an agreed denominator. Inactivity is never treated as churn.'),
        retention,
      ];
    }
    const extra = data.extra || {};
    const has = (k) => !!(ev[k] && ev[k].available);
    const name = (k) => (ev[k] && ev[k].name) || k;
    const out = [];
    if (has('credits_consumed') && extra.credits) {
      const c = P.creditUsage({ days: extra.credits.days, people: extra.credits.people, from: extra.from, cutoff });
      out.push(kpi('Credits consumed', c.total, `Since launch · ${U.fmt(c.last_7d)} in the last 7 days · ${U.fmt(c.accounts_using)} accounts used credits.`));
      out.push(kpi('Time to first credit use', c.median_days_to_first == null ? null : `${c.median_days_to_first} days`, 'Median days from account creation to the first credits_consumed.'));
    } else {
      out.push(waiting('Credits consumed', name('credits_consumed'), 'Turns on by itself when Product sends this backend event with the amount.'));
      out.push(waiting('Time to first credit use', name('credits_consumed'), 'Needs the same credit events.'));
    }
    if (has('subscription_cancelled') && extra.subscriptions) {
      const months = P.monthlyChurn({ subscriptions: extra.subscriptions, from: extra.from, cutoff }).months;
      const cur = months[months.length - 1];
      out.push(kpi('Monthly churn (provisional)', cur && cur.churn != null ? U.pct(cur.churn, 1) : null,
        cur ? `${U.fmt(cur.cancelled)} of ${U.fmt(cur.active_start)} subscriptions active on ${U.monthName(cur.month)} 1 cancelled${cur.partial ? ' (month in progress)' : ''}. Inactivity is never treated as churn.` : 'No subscription data yet.'));
    } else {
      out.push(waiting('Cancellations and monthly churn', `${name('subscription_started')} / ${name('subscription_cancelled')}`, 'Needs subscription_started / subscription_cancelled and an agreed denominator. Inactivity is never treated as churn.'));
    }
    out.push(retention);
    return out;
  }
  function render() {
    const U = A.ui, P = A.productUsage;
    const from = A.LAUNCH;
    // Yesterday in America/Bogota, never later than yesterday on the app clock: today is never consolidated.
    const cutoffWanted = [P.bogotaYesterday(), U.addDays(U.today(), -1)].sort()[0];
    let data = load();
    if (!data.ok && data.missing) data = fromApi(cutoffWanted);
    if (!data.ok) {
      return U.section('Product usage', 'PostHog · unique portal accounts · America/Bogota', U.card({ title: 'Product usage', body: U.empty('No data yet', U.esc(data.reason), 'chart-line') }))
        + U.section('Waiting on Product', 'Shown as no data, never as zero.', `<div class="grid-2">${later(null, cutoffWanted).join('')}</div>`);
    }
    const cutoff = data.head.to && data.head.to < cutoffWanted ? data.head.to : cutoffWanted;
    const s = P.summarize({ accounts: data.accounts, projectDays: data.projects, from, cutoff });
    const last = s.daily[s.daily.length - 1] || {};
    const sum = (f) => s.daily.reduce((n, r) => n + r[f], 0);
    const mature = s.cohorts.filter((c) => !c.open);
    const matureAccounts = mature.reduce((n, c) => n + c.accounts, 0);
    const matureActivated = mature.reduce((n, c) => n + c.activated_7d, 0);
    const activation = matureAccounts ? `${U.pct(matureActivated / matureAccounts, 0)}` : null;
    const projects = sum('projects_created');
    // Days before the first product event are absent, not zero: the events went live on Oct 29.
    const firstData = [...data.accounts.flatMap((r) => [r.created, r.first_project, ...(r.signin_days || [])]), ...data.projects.map((r) => r.date)]
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))).sort()[0] || null;
    const header = `<div class="card exec-header"><span class="text-muted">Data through ${U.esc(U.dshort(cutoff))} · America/Bogota · last sync ${U.esc(U.stamp(data.head.pulled_at || data.head._at || ''))} · ${U.fmt(s.internalAccounts)} internal or test account${s.internalAccounts === 1 ? '' : 's'} excluded (${U.esc((data.cov.internal_patterns || ['think4ever', 'moadbus', 't4e']).join(', '))})${data.cov.truncated ? ' · <b>Partial: query row limit reached</b>' : ''}</span></div>`;
    const kpis = [
      kpi('Active users (7 days)', last.active_7d, `Unique accounts with signed_in from ${U.dshort(P.addDays(cutoff, -6))} to ${U.dshort(cutoff)}. Login only; meaningful product activity is not defined yet.`),
      kpi('7-day activation', activation, matureAccounts ? `${matureActivated} of ${matureAccounts} mature accounts created a first project within 7 days. Not the 14-day campaign activation.` : 'No account has completed its 7-day window yet. Not the 14-day campaign activation.'),
      kpi('Accounts with a project', last.accounts_with_project, 'Unique accounts with at least one project_created since launch.'),
      kpi('Projects created', projects, `Distinct project_id since ${U.dshort(from)}. Includes accounts created before account_created existed.`),
      kpi('Accounts created', sum('accounts_created'), 'Unique accounts with account_created (event live since Oct 29; backfilled rows keep their original date).'),
      kpi('Avg projects per active user', last.active_7d ? (projects && s.daily.length ? (s.daily.slice(-7).reduce((n, r) => n + r.projects_created, 0) / last.active_7d).toFixed(2) : '0.00') : null, 'Distinct projects in the last 7 days ÷ active users in the same 7 days.'),
    ];
    const trend = U.table([
      { t: 'Day', f: (r) => U.esc(U.dshort(r.date)) },
      { t: 'Signed in', num: 1, f: (r) => U.fmt(r.signed_in) },
      { t: 'Active 7d', num: 1, f: (r) => U.fmt(r.active_7d) },
      { t: 'Projects created', num: 1, f: (r) => U.fmt(r.projects_created) },
      { t: 'Accounts created', num: 1, f: (r) => U.fmt(r.accounts_created) },
    ], s.daily.filter((r) => r.date >= P.addDays(cutoff, -13) && firstData && r.date >= firstData).reverse());
    const cohorts = s.cohorts.length ? U.table([
      { t: 'Account created', f: (c) => `${U.esc(U.dshort(c.cohort))}${c.open ? ' <span class="pill pill-neutral">Open cohort</span>' : ''}` },
      { t: 'Cohort size', num: 1, f: (c) => U.fmt(c.accounts) },
      { t: 'Project within 7 days', num: 1, f: (c) => U.fmt(c.activated_7d) },
      { t: '7-day activation', num: 1, f: (c) => (c.open ? '–' : U.pct(c.activated_7d / c.accounts, 0)) },
    ], s.cohorts.slice().reverse()) : U.empty('No cohorts yet', 'No external account_created in this period.', 'users');
    const note = '<p class="card-note">Unique accounts are keyed by portal_user_id inside PostHog; no identifier is stored here. Open cohort = created less than 7 days before the cut, so it can still activate. Small cohorts move the rate a lot; read it with its n.</p>';
    return U.section('Product usage', 'PostHog · unique portal accounts and distinct projects · separate from the acquisition funnel', header + `<div class="grid-3">${kpis.join('')}</div>`)
      + U.section('Daily trend', 'Last 14 consolidated days. Units differ per column; nothing is added across them.', U.card({ title: 'Daily activity and projects', body: trend }))
      + U.section('Cohorts by account creation day', '7-day activation = first project_created on day 0 to 6 after account_created.', U.card({ title: 'Activation cohorts', body: cohorts + note }))
      + U.section('Waiting on Product', 'Shown as no data, never as zero.', `<div class="grid-2">${later(data, cutoff).join('')}</div>`);
  }
  A.views.product = { title: 'Product usage', render, mount() {} };
})(window.App);
