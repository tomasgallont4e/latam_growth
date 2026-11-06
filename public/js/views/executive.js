'use strict';
(function (A) {
  const U = A.ui;
  const state = { month: '', zoom: false, span: 'month', data: null, error: '', loading: false };
  function activationFunnelOptions() {
    const view = state.data && state.data.view || {};
    return { path: 'marketing_project', from: A.LAUNCH, to: state.data && (state.data.cutoff || view.cutoff || state.data.asOf) || state.month + '-01', exclude: true };
  }

  function bogotaMonth() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit' }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    const month = `${parts.year}-${parts.month}`;
    return month < A.LAUNCH.slice(0, 7) ? A.LAUNCH.slice(0, 7) : month;
  }
  function monthOptions(selected) {
    const end = bogotaMonth();
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const out = [];
    let ym = A.LAUNCH.slice(0, 7);
    while (ym <= end) {
      out.push({ id: ym, label: `${MON[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}` });
      const [year, month] = ym.split('-').map(Number);
      ym = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
    }
    if (selected && !out.some((item) => item.id === selected)) out.push({ id: selected, label: selected });
    return out;
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
  function cfStage(stage, index) {
    const loaded = stage.status === 'loaded' && stage.value != null;
    const volume = loaded ? `<span class="cf-volume">${U.fmt(stage.value)}</span>` : '<span class="awaiting-chip">No data yet</span>';
    const c = stage.conversion;
    const conv = !c ? '<span class="text-muted">–</span><small>First stage</small>'
      : c.value != null ? `<b>${U.pct(c.value, 2)}</b><small>${U.esc(c.basis || '')}</small>`
        : `<span class="text-muted">n/a</span><small>${U.esc(c.reason || c.basis || '')}</small>`;
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
    return `<div class="cf-stage" role="listitem"><div class="cf-row"><span class="funnel-idx">${index + 1}</span><span class="cf-cell"><b>${U.esc(stage.name)}</b><small>${U.esc(stage.source || '')}</small></span><span class="cf-cell">${volume}</span><span class="cf-cell">${conv}</span><span class="cf-cell">${target}</span><span class="cf-cell">${costHtml}</span></div>${extras ? `<div class="cf-meta">${extras}</div>` : ''}${notes}${detail ? U.details('Detail by channel, platform and campaign', null, detail) : ''}</div>`;
  }
  function campaignFunnelHtml(block) {
    if (!block) return U.empty('Campaign funnel unavailable', 'The Executive response has no campaign funnel yet.', 'filter');
    if (block.status !== 'loaded') return U.empty('No data yet', U.esc(block.reason || ''), 'filter');
    const head = '<div class="cf-head cf-row" aria-hidden="true"><span></span><span>Stage</span><span>Volume</span><span>vs previous stage</span><span>vs target (pace)</span><span>Cost per result</span></div>';
    const notes = (block.notes || []).map((n) => `<li>${U.esc(n)}</li>`).join('');
    return `${head}<div class="cf-list" role="list" aria-label="Campaign funnel">${(block.stages || []).map(cfStage).join('')}</div>${notes ? `<ul class="cf-notes">${notes}</ul>` : ''}`;
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
    if (!block.certified) return { controls, body: U.empty('No data yet', block.reason || 'Sign-ups are not available for this month.', 'chart-column') };
    const points = state.span === 'launch' ? (block.sinceLaunch || []) : (block.days || []);
    const goal = state.span === 'launch' ? null : block.goal;
    const note = state.span === 'month' && block.note ? `<p class="card-note">${U.esc(block.note)}</p>` : state.span === 'launch' && block.underReview ? `<p class="card-note">Under review: ${U.esc(block.underReview.reason)}</p>` : '';
    const drawn = A.charts.executiveSignups({ points, goal, goalLabel: state.span === 'launch' ? null : block.goalLabel, zoom: state.zoom || state.span === 'launch', label: 'Sign-ups this month vs goal' });
    return { controls, body: drawn + note };
  }

  function render() {
    if (!state.month) state.month = bogotaMonth();
    if (state.error) return U.section('Executive', '', U.card({ title: 'Executive', body: U.empty('Could not load Executive', state.error, 'triangle-exclamation') }));
    if (!state.data || state.data.month !== state.month) {
      if (!state.loading) {
        state.loading = true;
        const requested = state.month;
        A.api(`api/executive?month=${encodeURIComponent(requested)}`).then((data) => {
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
    const cards = view.cards || {};
    const options = monthOptions(state.month).map((item) => `<option value="${U.esc(item.id)}"${item.id === state.month ? ' selected' : ''}>${U.esc(item.label)}</option>`).join('');
    const loaded = view.lastLoad ? ` · last load ${stamp(view.lastLoad)}` : '';
    const cutoff = view.cutoff ? `Data through ${longDate(view.cutoff)}${loaded}` : ((cards.signups && cards.signups.reason) || 'No complete day in this month yet');
    const header = `<div class="form-row"><label class="field"><span>Month</span><select id="exec-month" aria-label="Month">${options}</select></label><span class="text-muted">${U.esc(cutoff)}</span></div>`;
    const signups = cards.signups || {};
    const since = cards.sinceLaunch || {};
    const spend = cards.spend || {};
    const cps = cards.cps || {};
    const visit = cards.visit || {};
    const paidFunnel = funnel(view.funnel || { steps: [] });
    const activationFunnelHtml = A.posthogFunnel ? A.posthogFunnel.render(activationFunnelOptions()) : '<p class="card-note">PostHog funnel unavailable.</p>';
    const pendingReason = (item, fallback) => U.esc(item.reason || fallback);
    const tiles = [
      card({ ...signups, label: 'Sign-ups this month' }, signups.value != null ? U.fmt(signups.value) : pending(signups)),
      card({ ...since, label: 'Sign-ups since launch' }, since.value != null ? U.fmt(since.value) : pending(since)),
      card({ ...spend, label: 'Ad spend this month', labelStatus: spend.underReview && spend.underReview.label }, spend.value != null ? money(spend.value) : pending(spend)),
      card({ ...cps, label: 'Cost per sign-up' }, cps.value != null ? money(cps.value) : pending(cps)),
      card({ ...visit, label: 'Visit to sign-up rate' }, visit.value != null ? U.pct(visit.value, 2) : pending(visit)),
    ];
    if (signups.value == null) tiles[0] = A.ui.kpi({ cls: 'under-review', label: 'Sign-ups this month', source: 'PostHog', value: pending(signups), compare: pendingReason(signups, 'PostHog sign-up coverage is incomplete.') });
    if (signups.status === 'loaded' && signups.underReview) tiles[0] = A.ui.kpi({ cls: 'under-review', label: 'Sign-ups this month', source: 'PostHog', value: `<span class="under-review-value">${U.fmt(signups.value)}</span>`, compare: `<span class="under-review">Under review · ${pendingReason(signups.underReview, '')}</span>` });
    if (since.value == null) tiles[1] = A.ui.kpi({ cls: 'under-review', label: 'Sign-ups since launch', source: 'PostHog', value: pending(since), compare: pendingReason(since, 'PostHog sign-up coverage is incomplete.') });
    if (since.status === 'loaded' && since.underReview) tiles[1] = A.ui.kpi({ cls: 'under-review', label: 'Sign-ups since launch', source: 'PostHog', value: `<span class="under-review-value">${U.fmt(since.value)}</span>`, compare: `<span class="under-review">Under review · ${pendingReason(since.underReview, '')}</span>` });
    if (spend.value == null) tiles[2] = A.ui.kpi({ label: 'Ad spend this month', source: spend.source || 'Paid', value: pending(spend), compare: (spend.lines || []).map((line) => `<div>${U.esc(line)}</div>`).join('') });
    else if (spend.underReview || spend.complete === false) tiles[2] = A.ui.kpi({ cls: 'under-review', label: 'Ad spend this month', source: spend.source || 'Paid', value: `<span class="under-review-value">${money(spend.value)}</span>`, compare: `<span class="under-review">Under review · ${pendingReason(spend.underReview, 'One or more paid sources are pending.')}</span>${(spend.lines || []).map((line) => `<div>${U.esc(line)}</div>`).join('')}` });
    if (cps.status !== 'loaded') tiles[3] = A.ui.kpi({ cls: cps.underReview ? 'under-review' : '', label: 'Cost per sign-up', source: 'Paid spend / PostHog', value: cps.status === 'no_signups' ? 'No sign-ups yet' : pending(cps), compare: `${cps.underReview ? `<span class="under-review">Under review · ${pendingReason(cps.underReview, '')}</span>` : ''}${U.esc(cps.reason === 'spend incomplete' ? 'Paid spend incomplete' : (cps.reason === 'No data yet' ? '' : (cps.reason || '')) )}` });
    if (visit.status !== 'loaded') tiles[4] = A.ui.kpi({ cls: visit.underReview ? 'under-review' : '', label: 'Visit to sign-up rate', source: 'PostHog / GA4', value: pending(visit), compare: `${visit.underReview ? `<span class="under-review">Under review · ${pendingReason(visit.underReview, '')}</span>` : ''}${U.esc(visit.reason || (signups.underReview ? signups.underReview.reason : 'Required coverage is incomplete.'))}` });

    const total = view.allAccounts || state.data.allAccounts || (view.executiveAccounts || {}).allAccounts || state.data.executiveAccounts?.allAccounts || {};
    const formatTypes = (values) => `External ${U.fmt((values || {}).External || 0)} · Unknown ${U.fmt((values || {}).Unknown || 0)} · Internal ${U.fmt((values || {}).Internal || 0)}`;
    const formatPeriod = (label, count, types) => `<p><b>${label}:</b> ${count == null ? 'Unavailable (coverage incomplete)' : `${U.fmt(count)} total · ${formatTypes(types)}`}</p>`;
    const totalBody = total.status === 'loaded'
      ? `${formatPeriod('Selected month', total.month, total.monthByType)}${formatPeriod('Since launch', total.sinceLaunch, total.byType)}<p class="card-note">All hosts · Unknown is not classified as External · data through ${U.esc(total.dataThrough || 'unknown')}</p>`
      : U.empty('All-host sign-up total unavailable', 'PostHog first-identify coverage for this population is missing or incomplete.', 'users');
    const drawn = chart(view);
    const chartControls = drawn && drawn.controls ? drawn.controls : '';
    const chartBody = drawn && drawn.body ? drawn.body : drawn;
    const chartSources = '<p class="card-note">Sources: PostHog (sign-ups) · monthly goals (Targets)</p>';
    const changed = view.changed || { phrases: [] };
    const research = view.researchNote ? `<p class="card-note">Research note, ${U.esc(longDate(view.researchNote.date))}: ${U.esc(view.researchNote.text)}</p>` : '';
    const phrases = (changed.phrases || []).map((line) => `<p>${U.esc(line)}</p>`).join('') || '<p>No comparison yet.</p>';
    const cf = view.campaignFunnel || {};
    const cfSub = cf.from && cf.to ? `Window ${U.esc(longDate(cf.from))} – ${U.esc(longDate(cf.to))} · the same window for every stage` : 'Waiting for the first complete day';
    return U.section('Executive', 'Monthly progress for the business owner. Internal and test accounts stay excluded.', `${header}`)
      + `<section class="section">${U.kpiRow(tiles)}</section>`
      + U.section('Campaign funnel', 'Consolidated campaign performance, from ad and page impressions to builders. Open a stage to see each channel, platform and campaign.', U.card({ cls: 'cf-card', title: 'From impressions to builders', sub: cfSub, body: campaignFunnelHtml(view.campaignFunnel) }))
      + U.section('Sign-ups this month vs goal', state.span === 'launch' ? 'Cumulative external sign-ups since launch. The goal line is monthly, so it stays on This month.' : 'Bars are the day’s sign-ups. The line is the month’s cumulative total.', U.card({ cls: 'chart-card', title: 'Sign-ups vs goal', right: chartControls, body: `${chartSources}${chartBody}` }))
      + `<section class="section"><div class="grid-2">${U.card({ title: 'Top 5 countries', sub: 'Sources: PostHog (sign-ups) · GA4 (sessions). Countries with either measure appear; zero rows are omitted.', body: countries(view.countries) })}${U.card({ title: 'All-host sign-ups · first identify', sub: 'Separate total across every host; Unknown remains unclassified and Internal is shown explicitly.', body: totalBody })}</div></section>`
      + `<section class="section">${U.card({ title: 'Executive sign-ups by reported plan', sub: `Sign-ups · first identify · approved-host External population · ${U.fmt((view.executiveAccounts || {}).sinceLaunch)} since launch`, body: subscriptionBreakdown(view.executiveAccounts) })}</section>`
      + U.section('What changed', 'The last 7 complete days against the 7 days before them.', U.card({ title: 'What changed', body: research + phrases }))
      + U.section('Marketing-to-Project Activation Funnel', 'Product activation in PostHog, after sign-up.', U.card({ title: 'Marketing-to-Project Activation Funnel', sub: 'Saved PostHog ordered funnel · aggregate selected range · excludes internal and test accounts. This is product activation, not an advertising funnel.', body: activationFunnelHtml }));
  }

  function mount(el) {
    const month = el.querySelector('#exec-month');
    if (month) month.addEventListener('change', () => {
      state.month = month.value;
      state.data = null;
      state.error = '';
      A.render();
    });
    el.querySelectorAll('[data-exec-span]').forEach((button) => button.addEventListener('click', () => {
      state.span = button.dataset.execSpan;
      A.render();
    }));
    const zoom = el.querySelector('[data-exec-zoom]');
    if (zoom) zoom.addEventListener('click', () => { state.zoom = !state.zoom; A.render(); });
    if (A.posthogFunnel) A.posthogFunnel.mount(el, activationFunnelOptions());
  }

  A.views.executive = { title: 'Executive', render, mount };
})(window.App);
