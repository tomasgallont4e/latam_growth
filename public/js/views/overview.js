
'use strict';
/* Overview: the CEO glance. Launch at a glance is the six-step funnel from impressions
   through landing sign-up and direct website sign-up. The right-hand reading is a placeholder
   until an AI agent explains the data. */
(function (A) {
  // The plan is intentionally separate from monthly targets. It starts with
  // the 500K verified-user outcome and shows the traffic/media inputs implied
  // by that scenario. Live values retain their source labels and are never
  // fabricated for a country that has not been identified by a source.
  // Completion is actual ÷ target. A target of 500 and an actual of 100 is 20% of the goal.
  // Rates use the same ratio: 3.20% against a 4.02% plan is 79.6% of that rate goal.
  function completionOf(actual, target) {
    const U = A.ui;
    if (!U.num(actual) || !U.num(target) || Number(target) === 0) return null;
    return Number(actual) / Number(target);
  }
  function completionLabel(ratio) {
    const p = Math.abs(ratio) * 100;
    const digits = p !== 0 && p < 0.1 ? 3 : p < 10 ? 2 : 1;
    return A.ui.pct(ratio, digits);
  }
  function goalMetric(label, target, actual, note, raw) {
    const U = A.ui;
    const ratio = raw ? completionOf(raw.actual, raw.target) : null;
    const tracked = !!raw;
    const width = ratio == null ? 0 : Math.min(100, Math.max(0, ratio * 100));
    const bar = tracked ? `<span class="plan-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(width)}" aria-label="${U.esc(label)} goal completion"><i style="width:${width.toFixed(1)}%"></i></span>` : '';
    const complete = tracked ? `<strong class="plan-complete">${ratio == null ? '– of goal' : `${completionLabel(ratio)} of goal`}</strong>` : '';
    return `<div class="plan-metric"><span>${U.esc(label)}</span><b>${U.esc(target)}</b><em>${actual == null ? 'No live value yet' : `Actual ${U.esc(actual)}`}</em>${bar}${complete}<small>${U.esc(note)}</small></div>`;
  }

  function goalPanels() {
    const U = A.ui, D = A.D, S = A.S, p = S.data && S.data.goalPlan;
    if (!p) return '';
    const markets = Object.keys(p.countries || {});
    const country = markets.includes(S.goalCountry) ? S.goalCountry : (markets[0] || '');
    const target = country ? Number(p.countries[country]) || 0 : 0;
    const geoSessions = D.countryMetric('ga_geo_sessions', country);
    const geoUsers = D.countryMetric('ga_geo_users', country);
    const geoEngaged = D.countryMetric('ga_geo_engaged_sessions', country);
    const snapshot = D.countrySnapshot(country);
    const sessions = geoSessions || (snapshot && Number(snapshot.sessions)) || null;
    const users = geoUsers || (snapshot && Number(snapshot.users)) || null;
    const engagement = sessions && geoEngaged ? geoEngaged / sessions : null;
    const forms = D.forms().filter((e) => e.country === country).length;
    const plannedSessions = target ? Number(p.landing_sessions) * target / Number(p.verified_users) : null;
    const options = markets.map((name) => `<option value="${U.esc(name)}"${name === country ? ' selected' : ''}>${U.esc(name)}</option>`).join('');
    const goal = Number(p.verified_users) || 0;
    const month = S.to.slice(0, 7);
    const first = `${month}-01`;
    const end = [S.to, U.today(), U.endOfMonth(month)].sort()[0];
    const days = end < first ? [] : U.days(first, end);
    const daily = days.length ? D.dailySignups(first, end) : {};
    let running = 0;
    const cumulative = days.map((d) => {
      const row = daily[d] || { form: 0, platform: 0 };
      running += (row.form || 0) + (row.platform || 0);
      return running;
    });
    const monthSignups = cumulative.length ? cumulative[cumulative.length - 1] : 0;
    const ratio = goal ? monthSignups / goal : null;
    const tests = S.exInt ? 'excluded' : 'included';
    const hero = U.card({
      cls: 'chart-card goal-hero',
      title: 'LATAM 500K goal',
      sub: `Bars: month-to-date sign-ups · line: % of the ${U.fmt(goal)} goal · resets on the 1st · internal tests ${tests}`,
      right: `<span class="pill goal-now">${ratio == null ? '– of goal' : `${completionLabel(ratio)} of goal`} · ${U.fmt(monthSignups)} sign-ups this month</span>`,
      body: A.charts.goalProgress({ dates: days, values: cumulative, goal, label: `LATAM 500K goal, ${U.monthName(month)}` }),
    });

    const countryPanel = markets.length ? `<details class="goal-panel"><summary><span><b>Country goal</b><small>${U.esc(country)} within the LATAM plan</small></span><span class="goal-summary">${U.fmt(target)} verified users <i>View country</i></span></summary><div class="goal-body">
        <label class="goal-select">Country <select id="goal-country" aria-label="Country goal">${options}</select></label>
        <p>Country traffic comes from GA4. Each percentage is the live count divided by this market’s target.</p>
        <div class="plan-grid">
          ${goalMetric('Verified-user target', U.fmt(target), users == null ? null : U.fmt(users), 'GA4 users observed in this country, against this market’s allocation.', { target, actual: users })}
          ${goalMetric('Planned landing sessions', U.fmt(plannedSessions), sessions == null ? null : U.fmt(sessions), 'Actual sessions come from GA4.', { target: plannedSessions, actual: sessions })}
          ${goalMetric('GA4 users', 'Traffic readout', users == null ? null : U.fmt(users), 'Users observed in this country.')}
          ${goalMetric('GA4 engagement rate', 'Quality readout', engagement == null ? null : U.pct(engagement), 'Engaged sessions divided by sessions.')}
          ${goalMetric('HubSpot form sign-ups', 'Lead readout', U.fmt(forms), 'Contacts with a matching CRM country.')}
          ${goalMetric('Verified accounts by country', 'Identity coverage', null, 'Requires a country code on the verified account.')}
        </div></div></details>` : '';

    return `<section class="section goal-plan-section">${hero}${countryPanel}</section>`;
  }

  // HubSpot stores sessions, page views and bounces by source. Direct is channel index 1.
  function channelSum(metric, index, from, to) {
    const D = A.D;
    let s = 0;
    for (const r of D.M()) {
      if (r.source === 'hubspot' && r.metric === metric && r.date >= from && r.date <= to && A.charts.channelOf(r.dim_value) === index) s += Number(r.value) || 0;
    }
    return s;
  }
  function directSessionsByDay(from, to) {
    const U = A.ui, D = A.D, out = {};
    for (const d of U.days(from, to)) out[d] = 0;
    for (const r of D.M()) {
      if (r.source === 'hubspot' && r.metric === 'sessions' && out[r.date] != null && A.charts.channelOf(r.dim_value) === 1) out[r.date] += Number(r.value) || 0;
    }
    return out;
  }
  function platformCountries(from, to) {
    const out = {};
    for (const r of A.D.M()) {
      if (r.source !== 'posthog' || r.metric !== 'ph_new_persons_geo' || r.date < from || r.date > to) continue;
      const c = r.dim_value || 'Unknown';
      out[c] = (out[c] || 0) + (Number(r.value) || 0);
    }
    return Object.entries(out).sort((a, b) => b[1] - a[1]);
  }
  function directTouch(from, to) {
    const snap = A.D.snap('posthog', 'signup_attribution');
    if (!snap) return null;
    const rows = (snap.rows || []).filter((r) => r.date >= from && r.date <= to);
    if (!rows.length) return null;
    const isDirect = (r) => /direct/i.test(r.source || '') || /direct/i.test(r.medium || '');
    const n = rows.filter(isDirect).reduce((s, r) => s + (Number(r.people) || 0), 0);
    const total = rows.reduce((s, r) => s + (Number(r.people) || 0), 0);
    return { n, total };
  }
  function directBehavior(from, to) {
    const U = A.ui, D = A.D;
    const sessions = channelSum('sessions', 1, from, to);
    const views = channelSum('pageviews', 1, from, to);
    const bounces = channelSum('bounces', 1, from, to);
    const rows = D.utmRows(from, to).filter((r) => /direct/i.test(r.source || ''));
    const pages = D.group(rows, (r) => D.path(r.landing_page), ['sessions', 'engaged_sessions', 'key_events']).sort((a, b) => b.sessions - a.sessions);
    const bits = [];
    if (sessions) bits.push(`${U.fmt(views)} page views`, `${U.pct(bounces / sessions)} bounce`);
    if (pages.length) {
      const top = pages[0];
      const did = top.key_events ? `${U.fmt(top.key_events)} key events` : `${U.fmt(top.engaged_sessions)} engaged`;
      bits.push(`top page ${top.key} · ${U.fmt(top.sessions)} sessions · ${did}`);
    }
    return { sessions, text: bits.length ? bits.join(' · ') : '' };
  }
  // Open customers and paying customers are not written by the PostHog connector today.
  // These names are accepted if a later sync or CSV uses them, and never invented.
  const CUSTOMER_METRICS = ['ph_customers', 'ph_open_accounts', 'open_accounts'];
  const PAYING_METRICS = ['ph_paying_customers', 'ph_paid_customers', 'paid_subs', 'paying'];
  function posthogMetric(names, from, to) {
    const hit = names.find((metric) => A.D.has('posthog', metric));
    if (!hit) return null;
    return A.D.sum('posthog', hit, null, from, to);
  }
  function posthogByDay(names) {
    const hit = names.find((metric) => A.D.has('posthog', metric));
    return hit ? A.D.byDay('posthog', hit) : null;
  }
  function priorNoun() {
    return { day: 'yesterday', week: 'last week', biweek: 'the previous two weeks', month: 'last month', quarter: 'last quarter', year: 'last year' }[A.D.grain()] || 'the previous period';
  }
  function changeSentence(cur, prev) {
    const word = priorNoun();
    if (cur == null || prev == null) return `No ${word} to compare`;
    if (!Number(prev)) return Number(cur) ? `New versus ${word}` : `Flat versus ${word}`;
    const ch = (Number(cur) - Number(prev)) / Math.abs(Number(prev));
    if (Math.abs(ch) < 0.0005) return `Flat versus ${word}`;
    const pct = (Math.abs(ch) * 100).toFixed(Math.abs(ch) * 100 < 10 ? 1 : 0);
    return `${pct}% ${ch > 0 ? 'more' : 'less'} than ${word}`;
  }
  function clipSpan(key) {
    const U = A.ui, S = A.S, span = U.bucketSpan(key);
    const from = span.start < S.from ? S.from : span.start;
    const to = span.end > S.to ? S.to : span.end;
    return from <= to ? { from, to } : null;
  }
  function sumMap(map, range) {
    if (!range || !map) return null;
    let s = 0;
    for (const [d, v] of Object.entries(map)) if (d >= range.from && d <= range.to) s += Number(v) || 0;
    return s;
  }
  function ratioOf(num, den) {
    if (num == null || den == null || !Number(den)) return null;
    return num / den;
  }

  function countryLine(rows, total) {
    const U = A.ui;
    if (!rows.length) return 'Country is not on these sign-ups yet';
    const shown = rows.slice(0, 3).map(([c, n]) => `${c} ${U.fmt(n)}`).join(' · ');
    const known = rows.reduce((s, [, n]) => s + n, 0);
    const more = rows.length > 3 ? ` · +${rows.length - 3} countries` : '';
    const missing = total != null && known < total ? ` · ${U.fmt(total - known)} without a country` : '';
    return `${shown}${more}${missing}`;
  }

  function render() {
    const U = A.ui, C = A.charts, D = A.D, S = A.S;
    const grain = D.grainName();
    const ticks = D.ticks();
    const hasSess = D.has('hubspot', 'sessions');
    const sess = D.sessions();
    const form = D.forms().length;
    const plat = D.platform();
    const sessDay = D.byDay('hubspot', 'sessions');
    const suDay = D.dailySignups();
    const parts = D.impressionParts();
    const impressions = D.impressions();
    const impMaps = [...D.PAID.map((k) => D.byDay(k, 'ad_impressions')), D.byDay('linkedin', 'post_impressions')];
    const impByDay = {};
    for (const d of U.days(S.from, S.to)) impByDay[d] = impMaps.reduce((s, m) => s + (m[d] || 0), 0);
    const formByDay = {}, platByDay = {};
    for (const d of Object.keys(suDay)) { formByDay[d] = suDay[d].form; platByDay[d] = suDay[d].platform; }
    const month = S.to.slice(0, 7);
    const impGoal = A.targets && A.targets.goal ? A.targets.goal('total_impressions', month, 'LATAM') : null;
    const goalBit = impGoal && impGoal.target != null ? `${U.monthName(month)} target ${U.fmt(impGoal.target)}` : 'Monthly target is paid + organic impressions';
    const organicBit = parts.some((p) => p.organicKnown) ? `LinkedIn organic ${U.fmt(parts.find((p) => p.key === 'linkedin').organic)}` : 'LinkedIn organic not connected';
    const impCompare = `${parts.map((p) => `${p.name} paid ${U.fmt(p.paid)}`).join(' · ')} · ${organicBit} · Meta and Google organic not connected · ${goalBit}`;
    const countries = platformCountries(S.from, S.to);
    const touch = directTouch(S.from, S.to);
    const touchBit = touch ? `${U.fmt(touch.n)} of ${U.fmt(touch.total)} with a direct first touch` : 'First-touch source is not on these accounts yet';
    const signups = form + (plat || 0);
    const signupByDay = {};
    for (const d of Object.keys(formByDay)) signupByDay[d] = (formByDay[d] || 0) + (platByDay[d] || 0);
    const customers = posthogMetric(CUSTOMER_METRICS);
    const paying = posthogMetric(PAYING_METRICS);
    const customerDay = posthogByDay(CUSTOMER_METRICS);
    const payingDay = posthogByDay(PAYING_METRICS);
    const keys = D.ticks();
    const curKey = keys[keys.length - 1] || null;
    const prevKey = keys.length > 1 ? keys[keys.length - 2] : null;
    const curSpan = curKey && clipSpan(curKey);
    const prevSpan = prevKey && clipSpan(prevKey);
    const bucket = (map, span) => (span ? sumMap(map, span) : null);
    const sessNow = bucket(sessDay, curSpan), sessPrev = bucket(sessDay, prevSpan);
    const impNow = impressions == null ? null : bucket(impByDay, curSpan);
    const impPrev = impressions == null ? null : bucket(impByDay, prevSpan);
    const formNow = bucket(formByDay, curSpan), formPrev = bucket(formByDay, prevSpan);
    const platNow = plat == null ? null : bucket(platByDay, curSpan);
    const platPrev = plat == null ? null : bucket(platByDay, prevSpan);
    const signNow = (formNow || 0) + (platNow || 0);
    const signPrev = prevSpan ? (formPrev || 0) + (platPrev || 0) : null;
    const payNow = payingDay ? bucket(payingDay, curSpan) : null;
    const payPrev = payingDay && prevSpan ? bucket(payingDay, prevSpan) : null;
    const custNow = customerDay ? bucket(customerDay, curSpan) : null;
    const custPrev = customerDay && prevSpan ? bucket(customerDay, prevSpan) : null;
    const impToSess = ratioOf(hasSess ? sess : null, impressions);
    const sessToForm = ratioOf(form, hasSess ? sess : null);
    const directRate = ratioOf(plat, hasSess ? sess : null);
    const payRate = ratioOf(paying, signups);
    const rateCard = (label, cur, spark, formula) => {
      const compare = U.esc(formula);
      if (cur == null) return U.kpi({ label, source: 'Derived', value: '–', compare });
      return U.kpi({ label, source: 'Derived', value: U.pct(cur), spark, compare });
    };
    const periodBit = curKey ? `${U.axis(curKey)} versus ${priorNoun()}` : priorNoun();
    const moved = (now, before) => changeSentence(now, before);

    const totals = U.kpiRow([
      impressions == null
        ? U.kpi({ label: 'Total Impressions', source: 'Paid + organic', awaiting: 'LinkedIn, Meta or Google', compare: 'Paid and organic impressions for the month' })
        : U.kpi({ label: 'Total Impressions', source: 'Paid + organic', value: U.fmt(impressions), hero: true, delta: U.delta(impNow, impPrev), spark: D.series(impByDay), compare: `${U.esc(moved(impNow, impPrev))} · ${impCompare}` }),
      hasSess
        ? U.kpi({ label: 'Landing Page Sessions', source: 'HubSpot · todo el sitio', value: U.fmt(sess), delta: U.delta(sessNow, sessPrev), spark: D.series(sessDay), compare: U.esc(moved(sessNow, sessPrev)) })
        : U.kpi({ label: 'Landing Page Sessions', source: 'HubSpot · todo el sitio', awaiting: 'HubSpot' }),
      U.kpi({ label: 'Landing Page Sign-ups', source: 'HubSpot', value: U.fmt(form), delta: U.delta(formNow, formPrev), spark: D.series(formByDay), compare: U.esc(moved(formNow, formPrev)) }),
      plat != null
        ? U.kpi({ label: 'Direct Platform Sign-ups', source: 'PostHog', value: U.fmt(plat), delta: U.delta(platNow, platPrev), spark: D.series(platByDay), compare: U.esc(`${moved(platNow, platPrev)} · ${countryLine(countries, plat)} · ${touchBit}`) })
        : U.kpi({ label: 'Direct Platform Sign-ups', source: 'PostHog', awaiting: 'PostHog', compare: 'Country appears once PostHog sends the sign-up country' }),
      U.kpi({ label: 'Sign-ups', source: 'HubSpot + PostHog', value: U.fmt(signups), delta: U.delta(signNow, signPrev), spark: D.series(signupByDay), compare: U.esc(`${moved(signNow, signPrev)} · ${U.fmt(form)} landing form + ${plat == null ? 'PostHog pending' : `${U.fmt(plat)} platform`}`) }),
      customers == null
        ? U.kpi({ label: 'Customers', source: 'PostHog', awaiting: 'PostHog', compare: 'Open accounts are not in the PostHog sync yet' })
        : U.kpi({ label: 'Customers', source: 'PostHog', value: U.fmt(customers), delta: U.delta(custNow, custPrev), spark: customerDay ? D.series(customerDay) : null, compare: U.esc(moved(custNow, custPrev)) }),
      paying == null
        ? U.kpi({ label: 'Paying Customers', source: 'PostHog', awaiting: 'PostHog', compare: 'Paying customers are not in the PostHog sync yet' })
        : U.kpi({ label: 'Paying Customers', source: 'PostHog', value: U.fmt(paying), delta: U.delta(payNow, payPrev), spark: payingDay ? D.series(payingDay) : null, compare: U.esc(moved(payNow, payPrev)) }),
    ]);
    const rates = U.kpiRow([
      rateCard('Impressions to Landing Page Sessions', impToSess, D.seriesRate(sessDay, impByDay), impressions == null ? 'Paid and organic impressions are not connected' : `${U.fmt(sess)} sessions / ${U.fmt(impressions)} impressions`),
      rateCard('Landing Page Sessions to Form Sign-ups', sessToForm, D.seriesRate(formByDay, sessDay), hasSess ? `${U.fmt(form)} form sign-ups / ${U.fmt(sess)} sessions` : 'Landing sessions are not connected'),
      rateCard('Landing Page Sign-up Rate', sessToForm, D.seriesRate(formByDay, sessDay), hasSess ? `${U.fmt(form)} form sign-ups / ${U.fmt(sess)} sessions` : 'Landing sessions are not connected'),
      rateCard('Direct Platform Sign-up Rate', directRate, D.seriesRate(platByDay, sessDay), plat == null ? 'Platform sign-ups awaiting PostHog' : !hasSess ? 'Landing sessions are not connected' : `${U.fmt(plat)} platform sign-ups / ${U.fmt(sess)} sessions`),
      rateCard('Sign-ups to Paying Customers', payRate, payingDay ? D.seriesRate(payingDay, signupByDay) : null, paying == null ? 'Paying customers are not in the PostHog sync yet' : `${U.fmt(paying)} paying / ${U.fmt(signups)} sign-ups`),
    ]);
    const kpis = `<div class="glance-block"><p class="glance-kicker">Totals · since launch</p>${totals}</div><div class="glance-block"><p class="glance-kicker">Rates · since launch</p>${rates}</div>`;

    const goals = A.targets.strip(['total_impressions', 'total_signups', 'platform_signups', 'visit_to_signup_rate', 'landing_sessions', 'unique_visitors', 'engagement_rate']);

    const ch = D.channels();
    const mix = U.card({ title: 'Channel mix', sub: `Share of landing sessions · <span class="mono">${U.fmt(sess)} sessions</span>`, right: U.srcPill('hubspot', 'todo el sitio'), body: hasSess ? C.mix(ch) : U.awaiting('hubspot') });

    const notes = ((S.data.notes) || []).filter((n) => n.date >= S.from && n.date <= S.to).sort((a, b) => (a.date < b.date ? -1 : 1));
    const daily = D.rollChannels(D.dailyChannels());
    const chart = U.card({
      cls: 'chart-card', title: `${grain} sessions by channel`, sub: `One bar per ${D.grainBar()} · since launch · numbered markers are timeline notes`,
      right: `<button type="button" class="btn btn-secondary btn-sm" data-go="notes">${U.icon('message', 'fa-regular')} Timeline Notes</button>`,
      body: (hasSess ? C.stacked({ dates: ticks, keys: C.CHANNELS, value: (d, i) => daily[d][i], notes, label: `${grain} sessions by channel, ${U.win(S.from, S.to)}` }) : U.awaiting('hubspot'))
        + `<ul class="notes-chips">${notes.length ? notes.map((n, i) => `<li class="note-chip"><span class="note-idx">${i + 1}</span><span class="mono">${U.dshort(n.date)}</span><span class="note-type note-${U.esc(n.kind || 'other')}">${U.esc(n.kind || 'other')}</span><span class="note-txt">${U.esc(n.label)}</span></li>`).join('') : '<li class="text-muted">No timeline notes in this period.</li>'}</ul>`,
    });

    const steps = [
      { name: 'Total impressions', src: 'LinkedIn · Meta · Google', n: impressions, note: 'Awaiting LinkedIn, Meta or Google' },
      { name: 'Landing page sessions', src: 'HubSpot', n: hasSess ? sess : null },
      { name: 'Landing page sign-ups', src: 'HubSpot', n: form },
      { name: 'Direct platform sign-ups', src: 'PostHog · by country', n: plat, separate: true, bridge: `Separate path · ${countryLine(countries, plat)}` },
      { name: 'Sign-ups', src: 'HubSpot + PostHog', n: signups, separate: true, bridge: `${U.fmt(form)} landing form + ${plat == null ? 'PostHog pending' : `${U.fmt(plat)} platform`}` },
      { name: 'Customers', src: 'PostHog', n: customers, note: 'Open accounts are not in the PostHog sync yet' },
      { name: 'Paying customers', src: 'PostHog', n: paying, note: 'Paying customers are not in the PostHog sync yet' },
    ];
    const funnel = U.card({ cls: 'chart-card', title: 'Launch funnel', sub: `Impressions through paying customers · internal tests ${S.exInt ? 'excluded' : 'included'}`, right: U.pill('neutral', 'LinkedIn · Meta · Google · HubSpot · PostHog'), body: C.funnel(steps, 'Launch funnel') });

    const readings = U.card({
      cls: 'agent-placeholder',
      title: 'Coming soon',
      body: U.empty('Coming soon', 'We are integrating an AI agent to explain the Overview of the data.', 'robot'),
    });

    return goalPanels()
      + U.section('Launch at a glance', `Totals since launch, with each rate equal to the later total divided by the earlier one · badge compares ${U.esc(periodBit)} · ${U.win(S.from, S.to)}`, kpis)
      + goals
      + `<section class="section">${mix}</section>`
      + `<section class="section">${chart}</section>`
      + `<section class="section grid-2-1">${funnel}${readings}</section>`;
  }
  function mount(el) {
    el.addEventListener('change', (e) => {
      if (e.target.id === 'goal-country') { A.S.goalCountry = e.target.value; A.render(); }
    });
  }
  A.views.overview = { title: 'Overview', render, mount };
})(window.App);
