'use strict';
(function (A) {
  const U = A.ui;
  const state = {
    month: '', zoom: false, span: 'month', data: null, error: '', loading: false,
    product: { key: null, status: 'loading' },
    daily: { open: false, month: '', status: 'idle', data: null, error: '', channel: '', campaign: '' },
    review: { month: '', status: 'idle', data: null, error: '' },
    campaignChannel: '',
  };
  function activationFunnelOptions() {
    const view = state.data && state.data.view || {};
    return { path: 'marketing_project', from: A.LAUNCH, to: state.data && (state.data.cutoff || view.cutoff || state.data.asOf) || state.month + '-01', exclude: true };
  }

  function stamp(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return U.esc(String(value).slice(0, 16).replace('T', ' '));
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  }
  function longDate(iso) {
    if (!iso) return '';
    const [year, month, day] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, day)));
  }
  const paceLabel = { leading: 'Leading', trailing: 'Trailing', met: 'Met', missed: 'Missed' };

  function card(item, valueHtml) {
    const review = item.underReview ? `<div class="kpi-compare">Under review · ${U.esc(item.underReview.reason)}</div>` : '';
    const lines = (item.lines || []).map((line) => `<div>${U.esc(line)}</div>`).join('');
    const pace = item.pace ? `<div class="pace-${item.pace}">${paceLabel[item.pace] || ''}</div>` : '';
    return U.kpi({
      cls: item.underReview ? 'under-review' : '',
      label: item.label,
      source: item.source,
      value: valueHtml,
      compare: `${pace}${lines}${review}`,
    });
  }
  function money(n) {
    return `US$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  function pending(item) {
    return `<span class="kpi-awaiting">No data yet</span>`;
  }

  function funnel(block) {
    const steps = block.steps || [];
    let html = '';
    let firstKnown = null;
    let previousKnown = null;
    steps.forEach((step, index) => {
      if (index > 0) {
        const missing = step.status !== 'loaded' || previousKnown == null;
        const rate = !missing && previousKnown > 0 ? step.value / previousKnown : null;
        const marked = block.biggestDrop === index;
        html += `<div class="funnel-conn${marked ? ' weakest' : ''}"><span class="keep">${U.icon('arrow-down')} ${rate == null ? 'n/a' : U.pct(rate)}</span>${marked ? `<span class="weak-badge">${U.icon('triangle-exclamation')} Biggest drop</span>` : ''}</div>`;
      }
      const waiting = step.status !== 'loaded';
      if (!waiting && firstKnown == null) firstKnown = Number(step.value);
      const width = waiting || !(firstKnown > 0) ? 0 : Math.min(100, Math.max(step.value > 0 ? 0.8 : 0, (step.value / firstKnown) * 100));
      if (!waiting) previousKnown = Number(step.value);
      const count = waiting
        ? `<span class="awaiting-chip">No data yet${step.reason ? ` · ${U.esc(step.reason)}` : ''}</span>`
        : `${U.fmt(step.value)}`;
      html += `<div class="funnel-step" role="listitem"><span class="funnel-idx">${index + 1}</span><span class="funnel-name">${U.esc(step.name)}<small>${U.esc(step.source || '')}</small></span><div class="funnel-track${waiting ? ' pending' : ''}">${waiting || !step.value ? '' : `<div class="funnel-fill" style="width:${width.toFixed(2)}%"></div>`}</div><span class="funnel-count">${count}</span></div>`;
    });
    return `<div class="funnel" role="list" aria-label="Paid funnel">${html}</div><p class="card-note">${U.esc(block.note || '')}</p>`;
  }

  const CF_PACE = {
    green: '<span class="pill pill-success">On pace</span>',
    yellow: '<span class="pill pill-warning">Near pace</span>',
    red: '<span class="pill cf-pill-red">Behind pace</span>',
  };
  function cfFormat(kind, value) {
    if (kind === 'status') return value === 'loaded' ? U.pill('success', 'Reported', true) : U.pill('warning', 'Pending', true);
    if (value == null || value === '') return '–';
    if (kind === 'money') return money(value);
    if (kind === 'rate') return U.pct(value, 2);
    if (kind === 'count') return U.fmt(value);
    return U.esc(value);
  }
  function cfTable(table) {
    const title = `<h4 class="cf-sub">${U.esc(table.title)}</h4>`;
    if (!table.rows || !table.rows.length) return `${title}<p class="card-note">${U.esc(table.empty || 'No rows for this period.')}</p>`;
    return title + U.table((table.columns || []).map((c) => ({
      t: c.t,
      num: ['count', 'money', 'rate'].includes(c.kind) ? 1 : 0,
      f: (row) => cfFormat(c.kind || 'text', row[c.k]),
    })), table.rows);
  }
  function cfStage(stage, index, weakest) {
    const loaded = stage.status === 'loaded' && stage.value != null;
    const volume = loaded ? `<span class="cf-volume">${U.fmt(stage.value)}</span>` : '<span class="awaiting-chip">No data yet</span>';
    const c = stage.conversion;
    const conv = !c ? '<span class="text-muted">–</span><small>First stage</small>'
      : c.value != null ? `<b>${U.pct(c.value, 2)}</b><small>${U.esc(c.basis || '')}</small>`
        : `<span class="text-muted">n/a</span><small>${U.esc(c.reason || c.basis || '')}</small>`;
    const weakBadge = weakest && weakest === stage.id ? `<span class="weak-badge">${U.icon('triangle-exclamation')} Weakest step</span>` : '';
    const t = stage.target;
    const target = !t ? '<span class="text-muted">No target</span>'
      : t.progress == null ? `<span class="text-muted">n/a</span><small>Target ${U.fmt(t.value)}</small>`
        : `<b>${U.pct(t.progress, 1)} of ${U.fmt(t.value)}</b>${t.status ? `<span>${CF_PACE[t.status]}</span>` : ''}<div class="cf-bar"><span style="width:${Math.min(100, t.progress * 100).toFixed(1)}%"></span></div><small>${U.esc(t.basis || '')}</small>`;
    const k = stage.cost;
    const costHtml = !k ? '<span class="text-muted">–</span>'
      : k.value != null ? `<b>${money(k.value)}</b><small>${U.esc(k.label || '')}${k.partial ? ' · known spend only' : ''}</small>`
        : `<span class="text-muted">n/a</span><small>${U.esc(k.label || '')}${k.reason ? ` · ${U.esc(k.reason)}` : ''}</small>`;
    const extras = (stage.extras || []).map((x) => `<span><b>${U.esc(x.label)}:</b> ${x.value == null ? 'No data yet' : cfFormat(x.kind || 'count', x.value)}${x.reason ? ` <small>· ${U.esc(x.reason)}</small>` : ''}</span>`).join('');
    const notes = (!loaded && stage.reason ? `<div class="cf-review">${U.icon('circle-info')} ${U.esc(stage.reason)}</div>` : '')
      + (stage.underReview ? `<div class="cf-review">${U.icon('triangle-exclamation')} Under review · ${U.esc(stage.underReview.reason)}</div>` : '');
    const detail = (stage.breakdowns || []).map(cfTable).join('') + (stage.definition ? `<p class="card-note">${U.esc(stage.definition)}</p>` : '');
    return `<div class="cf-stage" role="listitem"><div class="cf-row"><span class="funnel-idx">${index + 1}</span><span class="cf-cell"><b>${U.esc(stage.name)}</b><small>${U.esc(stage.source || '')}</small></span><span class="cf-cell">${volume}</span><span class="cf-cell">${conv}${weakBadge}</span><span class="cf-cell">${target}</span><span class="cf-cell">${costHtml}</span></div>${extras ? `<div class="cf-meta">${extras}</div>` : ''}${notes}${detail ? U.details('Detail by channel, platform and campaign', null, detail) : ''}</div>`;
  }
  function campaignFunnelHtml(block) {
    if (!block) return U.empty('Campaign funnel unavailable', 'The Executive response has no campaign funnel yet.', 'filter');
    if (block.status !== 'loaded') return U.empty('No data yet', U.esc(block.reason || ''), 'filter');
    const head = '<div class="cf-head cf-row" aria-hidden="true"><span></span><span>Stage</span><span>Volume</span><span>vs previous stage</span><span>vs target (pace)</span><span>Cost per result</span></div>';
    const notes = (block.notes || []).map((n) => `<li>${U.esc(n)}</li>`).join('');
    const weakestId = block.weakest && block.weakest.id;
    return `${head}<div class="cf-list" role="list" aria-label="Campaign funnel">${(block.stages || []).map((s, i) => cfStage(s, i, weakestId)).join('')}</div>${notes ? `<ul class="cf-notes">${notes}</ul>` : ''}`;
  }

  function countries(block) {
    const link = `<p class="card-note"><button type="button" class="btn btn-secondary btn-sm" data-go="overview">All countries</button></p>`;
    if (!block || block.status !== 'loaded' || !block.rows.length) return U.empty('No country data yet', block && block.reason || '', 'earth-americas') + link;
    const rows = block.rows.filter((row) => row.signups > 0 || row.sessions > 0);
    if (!rows.length) return U.empty('No country data yet', '', 'earth-americas') + link;
    const paceClass = (pace) => pace === 'Leading' || pace === 'Met' ? 'pace-leading' : pace === 'Trailing' || pace === 'Missed' ? 'pace-trailing' : '';
    const table = U.table([
      { t: 'Country', f: (row) => `${U.esc(row.country)}${row.proposal ? ' · Proposal' : ''}` },
      { t: 'Sign-ups', num: 1, f: (row) => row.signups == null ? '–' : U.fmt(row.signups) },
      { t: 'Sessions', num: 1, f: (row) => row.sessions == null ? '–' : U.fmt(row.sessions) },
      { t: 'Rate', num: 1, f: (row) => row.rate == null ? 'n/a' : U.pct(row.rate, 2) },
      { t: '% of min.', num: 1, f: (row) => row.percentOfMin == null ? 'n/a' : U.pct(row.percentOfMin, 0) },
      { t: 'Pace', f: (row) => `<span class="${paceClass(row.pace)}">${U.esc(row.pace)}</span>` },
    ], rows);
    const missing = block.noCountry ? `<p class="card-note">No country: ${U.fmt(block.noCountry)} sign-ups</p>` : '';
    return table + missing + link;
  }

  function subscriptionBreakdown(block) {
    const details = block || {};
    const plan = details.byPlan || {};
    const reason = plan.reason || 'Plan data is unavailable.';
    const byCountry = details.byCountry || {};
    const rows = Object.entries(byCountry).map(([country, accounts]) => ({ country, accounts }));
    const countryTable = rows.length ? U.table([
      { t: 'Country', k: 'country' }, { t: 'Approved-host sign-ups', num: 1, f: (row) => U.fmt(row.accounts) },
    ], rows) : U.empty('No approved-host country split yet', 'Country attribution is unavailable or no approved-host account has a country.', 'earth-americas');
    const coverage = `<p class="card-note">Approved-host external sign-ups since launch: ${U.fmt(details.sinceLaunch)} · ${U.fmt(details.country_assigned)} assigned a country · ${U.fmt(details.country_missing)} without country · ${U.fmt(details.excludedHosts)} external sign-ups on unapproved hosts excluded.</p>`;
    const plans = plan.status === 'loaded' ? `<p class="card-note">Last plan reported by signed_in / plan_changed · not verified current billing status.</p>${U.kpiRow([
      U.kpi({ label: 'Last reported Free', source: 'PostHog', value: U.fmt(plan.free), compare: 'Latest reported plan event per approved-host external sign-up' }),
      U.kpi({ label: 'Last reported Paid', source: 'PostHog', value: U.fmt(plan.paid), compare: 'Latest reported plan event per approved-host external sign-up' }),
      U.kpi({ label: 'Other plan', source: 'PostHog', value: U.fmt(plan.other), compare: 'Plan value other than free or paid' }),
      U.kpi({ label: 'Plan unknown', source: 'PostHog', value: U.fmt(plan.unknown), compare: 'No plan value found in plan events' }),
    ], 4)}` : U.empty('Plan data unavailable', reason, 'circle-question');
    return plans + coverage + countryTable;
  }

  function chartControls() {
    return `<div class="form-row">
      <button type="button" class="btn btn-secondary btn-sm" data-exec-span="month" aria-pressed="${state.span === 'month'}">This month</button>
      <button type="button" class="btn btn-secondary btn-sm" data-exec-span="launch" aria-pressed="${state.span === 'launch'}">Since launch</button>
      <button type="button" class="btn btn-secondary btn-sm" data-exec-zoom aria-pressed="${state.zoom}">Zoom to actual</button>
    </div>`;
  }

  function chart(view) {
    const block = view.chart || {};
    const controls = chartControls();
    if (!block.certified) return { controls, body: U.empty('No data yet', block.reason || 'Accounts created are not available for this month.', 'chart-column') };
    const points = state.span === 'launch' ? (block.sinceLaunch || []) : (block.days || []);
    const goal = state.span === 'launch' ? null : block.goal;
    const note = state.span === 'month' && block.note ? `<p class="card-note">${U.esc(block.note)}</p>` : state.span === 'launch' && block.underReview ? `<p class="card-note">Under review: ${U.esc(block.underReview.reason)}</p>` : '';
    const drawn = A.charts.executiveSignups({ points, goal, goalLabel: state.span === 'launch' ? null : block.goalLabel, zoom: state.zoom || state.span === 'launch', label: 'Accounts created this month vs goal' });
    return { controls, body: drawn + note };
  }

  // ---------- CEO brief (docs/ceo-brief.md). Logic lives in public/js/ceoBrief.js; this only draws it.
  function productCutoff(month) {
    const yesterday = U.addDays(U.today(), -1);
    const end = U.endOfMonth(month);
    const cut = end < yesterday ? end : yesterday;
    return cut < A.LAUNCH || cut < `${month}-01` ? null : cut;
  }
  function ensureProduct(month) {
    const cutoff = productCutoff(month);
    const key = cutoff || `none:${month}`;
    if (state.product.key === key) return;
    if (!cutoff) { state.product = { key, status: 'unavailable', reason: 'This month has no complete day yet.' }; return; }
    state.product = { key, status: 'loading' };
    A.api(`api/product/metrics?cutoff=${encodeURIComponent(cutoff)}`).then((d) => {
      if (state.product.key !== key) return;
      state.product = { key, status: 'loaded', data: { ...(d || {}), projectDays: (d && d.projectDays) || [] } };
      A.render();
    }).catch((e) => {
      if (state.product.key !== key) return;
      state.product = { key, status: 'error', error: (e && e.message) || 'request failed' };
      A.render();
    });
  }
  const BRIEF_EMPTY = { loading: 'Loading…', nodata: 'No data' };
  function briefValue(t) {
    if (t.value != null) return U.esc(t.value);
    const text = t.state === 'waiting' ? `Waiting for event${t.event ? ` · ${t.event}` : ''}` : BRIEF_EMPTY[t.state] || 'No data';
    return `<span class="kpi-awaiting">${U.esc(text)}</span>`;
  }
  function ceoBrief(view) {
    const B = A.ceoBrief;
    if (!B) return '';
    const cards = view.cards || {};
    // Same Accounts created number as the Overview 500K card (External, all hosts, internal always excluded).
    const goal = A.D.goalAccounts(state.month);
    const countries = ((view.countries && view.countries.rows) || []).filter((r) => !r.noCountry).map((r) => ({ country: r.country, signups: r.signups, pace: r.pace }));
    const m = B.build({ month: state.month, goal, product: state.product, spend: cards.spend || {}, cps: cards.cps || {}, countries, changed: (view.changed && view.changed.phrases) || [], dataThrough: view.cutoff });
    const tile = (t) => `<div class="ceo-tile ceo-tile-${t.tone || 'neutral'}"><div class="ceo-tile-label">${U.esc(t.label)}${t.badge ? ` <span class="ceo-badge ceo-badge-${t.tone || 'neutral'}">${U.esc(t.badge)}</span>` : ''}</div><div class="ceo-tile-value">${briefValue(t)}${t.delta ? ` <span class="ceo-delta ceo-delta-${t.delta.tone}">${U.esc(t.delta.text)}</span>` : ''}</div><div class="ceo-tile-sub">${U.esc(t.sub || '')}</div></div>`;
    const chip = (c) => `<div class="ceo-chip"><span>${U.esc(c.label)}</span><b>${briefValue(c)}</b><small>${U.esc(c.sub || '')}</small></div>`;
    const list = (cls, title, icon, items) => `<div class="ceo-list ceo-list-${cls}"><h4>${U.icon(icon)} ${U.esc(title)}</h4><ul>${items.map((i) => `<li>${U.esc(i)}</li>`).join('')}</ul></div>`;
    return `<section class="card ceo-brief ceo-${m.headline.tone}"><div class="ceo-top"><div><div class="ceo-eyebrow">${U.icon('briefcase')} CEO brief · ${U.esc(m.monthLabel)} · ${U.esc(m.through)}</div><h2 class="ceo-headline">${U.esc(m.headline.text)}</h2>${m.subline ? `<p class="ceo-subline">${U.esc(m.subline)}</p>` : ''}</div><button type="button" class="btn btn-secondary btn-sm ceo-print" data-ceo-print>${U.icon('file-pdf')} Export PDF</button></div>`
      + `<div class="ceo-kpis">${m.tiles.map(tile).join('')}</div><div class="ceo-strip">${m.strip.map(chip).join('')}</div>`
      + `<div class="ceo-lists">${list('changed', 'What changed', 'arrow-trend-up', m.changed)}${list('risks', 'Risks & blockers', 'triangle-exclamation', m.risks)}${list('actions', 'Next actions', 'list-check', m.actions)}</div>`
      + `<p class="ceo-foot">${U.esc(m.foot)}</p></section><div class="ceo-detail-sep"><span>Detail</span></div>`;
  }

  // ---------- Daily Landing Funnel Report (docs/daily-landing-funnel.md). Folded by default, loaded on open.
  function ensureDaily(month) {
    if (state.daily.month === month && state.daily.status !== 'idle') return;
    state.daily = { ...state.daily, month, status: 'loading', data: null, error: '' };
    A.api(`api/daily-funnel?month=${encodeURIComponent(month)}`).then((d) => {
      if (state.daily.month !== month) return;
      state.daily = { ...state.daily, status: 'loaded', data: d || {} };
      A.render();
    }).catch((e) => {
      if (state.daily.month !== month) return;
      state.daily = { ...state.daily, status: 'error', error: (e && e.message) || 'request failed' };
      A.render();
    });
  }
  const dfVal = (v, kind) => (v == null ? '<span class="text-muted">–</span>' : kind === 'money' ? money(v) : U.fmt(v));
  const DF_STATUS = { loaded: ['success', 'Loaded'], no_data: ['warning', 'No data'], not_connected: ['neutral', 'Not connected'], pending: ['warning', 'Pending'] };
  function dailyBody() {
    const d = state.daily;
    if (d.status === 'loading' || d.status === 'idle') return '<p class="card-note">Loading…</p>';
    if (d.status === 'error') return U.empty('Could not load the daily report', U.esc(d.error), 'triangle-exclamation');
    const r = d.data || {};
    if (r.status !== 'loaded') return U.empty('No data yet', U.esc(r.reason || 'No day in this month yet.'), 'calendar-day');
    const stages = (r.stages || []).map((s) => {
      const [kind, text] = DF_STATUS[s.status] || ['neutral', s.status || 'Unknown'];
      return `<li><b>${U.esc(s.name)}</b> ${U.pill(kind, text, true)} <small class="text-muted">${U.esc(s.source || '')}${s.reason ? ` · ${U.esc(s.reason)}` : ''}</small></li>`;
    }).join('');
    const rows = r.rows || [];
    const channels = [...new Set(rows.map((x) => x.channel))].sort();
    const campaigns = [...new Set(rows.filter((x) => !d.channel || x.channel === d.channel).map((x) => x.campaign))].sort();
    const opt = (list, cur, all) => `<option value="">${all}</option>${list.map((v) => `<option value="${U.esc(v)}"${v === cur ? ' selected' : ''}>${U.esc(v)}</option>`).join('')}`;
    const filters = `<div class="form-row"><label class="field"><span>Channel</span><select data-df-channel aria-label="Channel">${opt(channels, d.channel, 'All channels')}</select></label><label class="field"><span>Campaign</span><select data-df-campaign aria-label="Campaign">${opt(campaigns, d.campaign, 'All campaigns')}</select></label></div>`;
    const cols = [
      { t: 'Spend', num: 1, f: (x) => dfVal(x.spend, 'money') },
      { t: 'Impressions', num: 1, f: (x) => dfVal(x.impressions) },
      { t: 'Clicks', num: 1, f: (x) => dfVal(x.clicks) },
      { t: 'Sessions', num: 1, f: (x) => dfVal(x.sessions) },
      { t: 'Forms', num: 1, f: (x) => dfVal(x.forms) },
      { t: 'Accounts', num: 1, f: (x) => dfVal(x.accounts) },
      { t: 'Projects', num: 1, f: (x) => dfVal(x.projects) },
    ];
    const totals = U.table([
      { t: 'Day', f: (x) => `${U.esc(U.dshort(x.date))}${x.partial ? ' <span class="pill pill-neutral">Today · partial</span>' : ''}` },
      ...cols.slice(0, 6),
      { t: 'Logins', num: 1, f: (x) => dfVal(x.logins) },
      ...cols.slice(6),
      { t: 'Cost per account', num: 1, f: (x) => dfVal(x.metrics && x.metrics.costPerAccountBlended, 'money') },
    ], (r.days || []).slice().reverse());
    const filtered = rows.filter((x) => (!d.channel || x.channel === d.channel) && (!d.campaign || x.campaign === d.campaign));
    const detail = filtered.length
      ? U.table([{ t: 'Day', f: (x) => U.esc(U.dshort(x.date)) }, { t: 'Channel', f: (x) => U.esc(x.channel) }, { t: 'Campaign', f: (x) => U.esc(x.campaign) }, ...cols], filtered.slice(0, 200))
      : U.empty('No rows', 'No row matches this channel and campaign.', 'filter');
    const notes = (r.notes || []).map((n) => `<li>${U.esc(n)}</li>`).join('');
    return `<ul class="cf-notes">${stages}</ul><h4 class="cf-sub">Daily totals</h4>${totals}<h4 class="cf-sub">By day, channel and campaign</h4>${filters}${detail}${filtered.length > 200 ? `<p class="card-note">Showing the first 200 of ${U.fmt(filtered.length)} rows.</p>` : ''}${notes ? `<ul class="cf-notes">${notes}</ul>` : ''}`;
  }
  // ---------- Month review (lib/monthReview.js): same-days comparison, channels and campaigns.
  function ensureReview(month) {
    if (state.review.month === month) return;
    state.review = { month, status: 'loading', data: null, error: '' };
    const done = (patch) => { if (state.review.month !== month) return; state.review = { ...state.review, ...patch }; A.render(); };
    A.api(`api/month-review?month=${encodeURIComponent(month)}`)
      .then((d) => done({ status: 'loaded', data: d || {} }))
      .catch((e) => done({ status: 'error', error: (e && e.message) || 'request failed' }));
  }
  const reviewPending = '<span class="kpi-awaiting">Pending</span>';
  function reviewState() {
    const r = state.review;
    if (r.status === 'error') return U.empty('Could not load the month review', U.esc(r.error), 'triangle-exclamation');
    if (r.status !== 'loaded') return '<p class="card-note">Loading…</p>';
    return null;
  }
  function momSection() {
    const s = (state.review.data && state.review.data.sameDays) || {};
    const sub = s.status === 'loaded'
      ? `${U.win(s.current.from, s.through)} against ${U.win(s.previous.from, s.previous.to)} · today is left out until it closes`
      : 'Closed days of this month against the same days of the previous month';
    const val = (r, v) => (v == null ? reviewPending : r.kind === 'money' ? money(v) : U.fmt(v));
    const body = reviewState() || (s.status !== 'loaded' ? U.empty('No comparison yet', U.esc(s.reason || ''), 'calendar-day') : U.table([
      { t: 'Metric', f: (r) => `${U.esc(r.name)}<br><small class="text-muted">${U.esc(r.source)}</small>` },
      { t: 'This month', num: 1, f: (r) => val(r, r.current) },
      { t: 'Last month', num: 1, f: (r) => val(r, r.previous) },
      { t: 'Change', num: 1, f: (r) => U.delta(r.current, r.previous, { invert: r.lowerIsBetter }) },
    ], s.rows) + (s.reason ? `<p class="card-note">${U.esc(s.reason)} Pending is not zero.</p>` : '<p class="card-note">Pending means a day in the window has no data from that source. Only one month is closed, so full months are not compared yet.</p>'));
    return U.section('This month vs last month · same days', sub, U.card({ title: 'This month vs last month', sub: 'Same days of each month · from the daily report', body }));
  }

  const TOP_CHANNELS = 6;
  function channelBars(list, color, label) {
    const top = list.slice(0, TOP_CHANNELS);
    const rest = list.slice(TOP_CHANNELS).reduce((n, x) => n + x.value, 0);
    const rows = [...top, ...(rest ? [{ name: `Other ${list.length - TOP_CHANNELS}`, value: rest }] : [])];
    const total = rows.reduce((n, x) => n + x.value, 0);
    return A.charts.hbars(rows.map((x) => ({ name: x.name, value: x.value, color, label: label(x.value) })), total);
  }
  function channelsSection() {
    const c = (state.review.data && state.review.data.channels) || {};
    const block = (list, reason, color, label, emptyText) => (list == null
      ? U.empty('Pending', U.esc(reason || 'This stage has no data yet.'), 'hourglass-half')
      : list.length ? channelBars(list, color, label) : U.empty(emptyText, '', 'chart-bar'));
    const loaded = !reviewState() && c.status === 'loaded';
    const body = (list, key, color, label, emptyText) => reviewState() || (c.status !== 'loaded' ? U.empty('No data yet', U.esc(c.reason || ''), 'calendar-day') : block(list, c.reasons && c.reasons[key], color, label, emptyText));
    const win = loaded ? U.win(c.from, c.to) : U.monthName(state.month);
    return U.section('Where traffic and spend come from', `${win} · month to date, today included · the same rows as the daily report`, `<div class="grid-2">`
      + U.card({ title: 'Landing sessions by channel', sub: 'GA4 · go.think4ever.com · ad network when the campaign matches, otherwise utm_source', body: body(c.sessions, 'sessions', 'var(--series-a)', (v) => U.fmt(v), 'No landing sessions this month') })
      + U.card({ title: 'Ads spend by platform', sub: 'Meta Ads · Google Ads · LinkedIn Ads is not connected', body: body(c.spend, 'spend', 'var(--series-b)', (v) => money(v), 'No ads spend this month') })
      + '</div>');
  }

  const CAMPAIGN_ROWS = 25;
  function campaignsSection() {
    const c = (state.review.data && state.review.data.campaigns) || {};
    const all = c.rows || [];
    const channels = [...new Set(all.map((r) => r.channel))].sort();
    const pick = channels.includes(state.campaignChannel) ? state.campaignChannel : '';
    const rows = all.filter((r) => !pick || r.channel === pick);
    const filter = channels.length > 1 ? `<label class="field"><span>Channel</span><select data-mr-channel aria-label="Channel"><option value="">All channels</option>${channels.map((v) => `<option value="${U.esc(v)}"${v === pick ? ' selected' : ''}>${U.esc(v)}</option>`).join('')}</select></label>` : '';
    const n = (v) => dfVal(v), m = (v) => dfVal(v, 'money');
    const body = reviewState() || (c.status !== 'loaded' ? U.empty('No data yet', U.esc(c.reason || ''), 'calendar-day') : !rows.length ? U.empty('No campaign rows this month', '', 'bullhorn') : U.table([
      { t: 'Campaign', f: (r) => `<code>${U.esc(r.campaign)}</code>` },
      { t: 'Channel', f: (r) => U.esc(r.channel) },
      { t: 'Spend', num: 1, f: (r) => m(r.spend) },
      { t: 'Impressions', num: 1, f: (r) => n(r.impressions) },
      { t: 'Clicks', num: 1, f: (r) => n(r.clicks) },
      { t: 'Sessions', num: 1, f: (r) => n(r.sessions) },
      { t: 'Forms', num: 1, f: (r) => n(r.forms) },
      { t: 'Accounts', num: 1, f: (r) => n(r.accounts) },
      { t: 'Cost per account', num: 1, f: (r) => m(r.costPerAccount) },
    ], rows.slice(0, CAMPAIGN_ROWS)) + `<p class="card-note">${rows.length > CAMPAIGN_ROWS ? `Showing the ${CAMPAIGN_ROWS} rows with the most spend of ${U.fmt(rows.length)}. ` : ''}Accounts per campaign need the identity cohort (UTM match). A campaign without that match shows –, never 0. Open the daily report below for each day.</p>`);
    const win = c.status === 'loaded' ? U.win(c.from, c.to) : U.monthName(state.month);
    return U.section('Campaigns this month', `${win} · one row per campaign, rolled up from the daily report · sorted by spend`, U.card({ title: 'Campaigns this month', sub: 'Spend, traffic and results per campaign', body: (filter ? `<div class="form-row">${filter}</div>` : '') + body }));
  }

  function dailySection() {
    const body = state.daily.open ? dailyBody() : '';
    return U.section('Daily Landing Funnel Report', `Ad → landing → form → account → project, per day × channel × campaign · ${U.esc(U.monthName(state.month))} · America/Bogota · read-only`,
      U.card({ title: 'Daily Landing Funnel Report', body: `<details class="collapsible" data-df-toggle${state.daily.open ? ' open' : ''}><summary>${U.icon('chevron-right', 'fa-solid', 'chev')}Open the daily report by date, channel and campaign</summary><div class="collapsible-body">${body}</div></details>` }));
  }

  function render() {
    // The page follows the global top-bar Month (memory #141).
    const month = A.S.goalMonth || A.bogotaMonth();
    if (state.month !== month) {
      state.month = month;
      state.data = null;
      state.error = '';
      state.daily = { ...state.daily, month: '', status: 'idle', data: null, error: '', channel: '', campaign: '' };
    }
    if (state.error) return U.section('Executive', '', U.card({ title: 'Executive', body: U.empty('Could not load Executive', state.error, 'triangle-exclamation') }));
    if (!state.data || state.data.month !== state.month) {
      if (!state.loading) {
        state.loading = true;
        const requested = state.month;
        A.api(`api/executive?month=${encodeURIComponent(requested)}&goalMonth=${encodeURIComponent(requested)}`).then((data) => {
          if (state.month === requested) { state.data = data; state.error = ''; }
          state.loading = false;
          A.render();
        }).catch((error) => {
          state.loading = false;
          state.error = error.message || 'The Executive data did not load.';
          A.render();
        });
      }
      return U.section('Executive', 'Loading the selected month…', U.card({ title: 'Executive', body: '<p class="card-note">Loading…</p>' }));
    }
    const view = state.data.view || {};
    ensureProduct(state.month);
    if (state.daily.open) ensureDaily(state.month);
    ensureReview(state.month);
    const cards = view.cards || {};

    const signups = cards.signups || {};
    const spend = cards.spend || {};
    const pendingReason = (item, fallback) => U.esc(item.reason || fallback);
    const loaded = view.lastLoad ? ` · last load ${stamp(view.lastLoad)}` : '';
    const cutoff = view.cutoff ? `Data through ${longDate(view.cutoff)}${loaded}` : ((cards.signups && cards.signups.reason) || 'No complete day in this month yet');
    const header = `<div class="form-row"><span class="text-muted">${U.esc(U.monthName(state.month))} · ${U.esc(cutoff)} · change the month with the Month selector at the top</span></div>`;
    const outcomes = view.outcomes || {};
    const outcomeTile = (label, outcome, event) => U.kpi({
      label,
      source: `PostHog · ${event}`,
      value: outcome && outcome.status === 'loaded' && outcome.value != null ? U.fmt(outcome.value) : '<span class="kpi-awaiting">Pending</span>',
      compare: U.esc((outcome && outcome.reason) || `${event} coverage unavailable.`),
    });
    const tiles = [
      card({ ...signups, label: 'Sign-ups target progress' }, signups.value != null ? U.fmt(signups.value) : pending(signups)),
      card({ ...spend, label: 'Ads spend', labelStatus: spend.underReview && spend.underReview.label }, spend.value != null ? money(spend.value) : pending(spend)),
      outcomeTile('Accounts created', outcomes.accountsCreated, 'account_created'),
      outcomeTile('Projects created', outcomes.projectsCreated, 'project_created'),
      outcomeTile('14-day project activation', outcomes.activation14d, 'account_created + project_created'),
    ];
    if (spend.underReview || spend.complete === false) tiles[1] = A.ui.kpi({
      cls: 'under-review', label: 'Ads spend', source: spend.source || 'Ads',
      value: spend.value != null ? `<span class="under-review-value">${money(spend.value)}</span>` : pending(spend),
      compare: `<span class="under-review">${U.esc(pendingReason(spend.underReview, 'One or more ad sources are pending.'))}</span>${(spend.lines || []).map((line) => `<div>${U.esc(line)}</div>`).join('')}`,
    });
    const changed = view.changed || { phrases: [] };
    const notes = (changed.phrases || []).map((line) => `<p>${U.esc(line)}</p>`).join('') || '<p>No evidence-backed changes for this period.</p>';
    const research = view.researchNote ? `<p class="card-note">Research note, ${U.esc(longDate(view.researchNote.date))}: ${U.esc(view.researchNote.text)}</p>` : '';
    const cf = view.campaignFunnel || {};
    const cfSub = cf.from && cf.to ? `Window ${U.esc(longDate(cf.from))} – ${U.esc(longDate(cf.to))} · the same window for every stage` : 'Waiting for the first complete day';
    const drawn = chart(view);
    const activationFunnelHtml = A.posthogFunnel ? A.posthogFunnel.render(activationFunnelOptions()) : '<p class="card-note">PostHog funnel unavailable.</p>';
    return U.section('Executive', 'Monthly targets, Ads coverage and confirmed product outcomes.', header)
      + ceoBrief(view)
      + '<div class="exec-detail">'
      + momSection()
      + channelsSection()
      + U.section('Management indicators', 'Source-native metrics stay separate. Pending outcomes need verified event coverage and identity linkage.', U.kpiRow(tiles, 3))
      + U.section('Campaign funnel', 'Seven stages from ad and page impressions to projects created. % is versus the previous stage; open a stage to see each channel, platform and campaign.', U.card({ cls: 'cf-card', title: 'Executive funnel · 7 stages', sub: cfSub, body: campaignFunnelHtml(view.campaignFunnel) }))
      + campaignsSection()
      + dailySection()
      + U.section('Accounts created this month vs goal', state.span === 'launch' ? 'Cumulative External accounts created since launch. The goal line is monthly, so it stays on This month.' : 'Bars are the day’s accounts created. The line is the month’s cumulative total.', U.card({ cls: 'chart-card', title: 'Accounts created vs goal', right: drawn.controls, body: `<p class="card-note">Sources: PostHog (accounts created) · monthly goals (Targets)</p>${drawn.body}` }))
      + (A.goalMonthChart ? U.section('LATAM 500K goal by month', 'External accounts created per month as % of the monthly goal · internal always excluded · the same number as Overview · click a month to select it.', U.card({ cls: 'chart-card', title: 'LATAM 500K goal by month', sub: `Selected: ${U.esc(U.monthName(state.month))}${A.goalActualCumText ? ` · ${U.esc(A.goalActualCumText(A.D.goalAccounts(state.month)))}` : ''}`, body: `${A.goalPaceChart ? `<h4 class="cf-sub">Sign-ups vs goal · ${U.esc(U.monthName(state.month))}</h4>${A.goalPaceChart(state.month)}<h4 class="cf-sub">% of the monthly goal by month</h4>` : ''}${A.goalMonthChart(state.month)}` })) : '')
      + U.section('What changed', 'Evidence from the selected month.', U.card({ title: 'What changed', body: research + notes }))
      + U.section('Marketing-to-Project Activation Funnel', 'Product activation in PostHog, after sign-up.', U.card({ title: 'Marketing-to-Project Activation Funnel', sub: 'Saved PostHog ordered funnel · excludes internal and test accounts. This is product activation, not an advertising funnel.', body: activationFunnelHtml }))
      + '</div>';
  }

  function mount(el) {
    el.querySelectorAll('[data-exec-span]').forEach((button) => button.addEventListener('click', () => {
      state.span = button.dataset.execSpan;
      A.render();
    }));
    const zoom = el.querySelector('[data-exec-zoom]');
    if (zoom) zoom.addEventListener('click', () => { state.zoom = !state.zoom; A.render(); });
    if (A.posthogFunnel) A.posthogFunnel.mount(el, activationFunnelOptions());
    if (A.bindGoalMonthChart) A.bindGoalMonthChart(el);
    const print = el.querySelector('[data-ceo-print]');
    if (print) print.addEventListener('click', () => window.print());
    const df = el.querySelector('[data-df-toggle]');
    if (df) df.addEventListener('toggle', () => {
      if (df.open === state.daily.open) return;
      state.daily.open = df.open;
      if (df.open) ensureDaily(state.month);
      A.render();
    });
    const ch = el.querySelector('[data-df-channel]');
    if (ch) ch.addEventListener('change', () => { state.daily.channel = ch.value; state.daily.campaign = ''; A.render(); });
    const mr = el.querySelector('[data-mr-channel]');
    if (mr) mr.addEventListener('change', () => { state.campaignChannel = mr.value; A.render(); });
    const ca = el.querySelector('[data-df-campaign]');
    if (ca) ca.addEventListener('change', () => { state.daily.campaign = ca.value; A.render(); });
  }

  A.views.executive = { title: 'Executive', render, mount };
})(window.App);
