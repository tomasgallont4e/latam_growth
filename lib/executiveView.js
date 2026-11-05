'use strict';
// Section 3 of the Executive tab. Numbers come from series already built by lib/executive.js.
// A missing source stays null with a reason. A measured zero is returned only after coverage says the query succeeded.

const UNSPLIT = 'Not split by country';
const LATAM = ['Brazil', 'Mexico', 'Colombia', 'Argentina', 'Peru', 'Chile', 'Ecuador', 'Dominican Republic', 'Bolivia', 'Paraguay', 'Uruguay'];
const LATAM_SET = new Set(LATAM);
const ISO = {
  BR: 'Brazil', MX: 'Mexico', CO: 'Colombia', AR: 'Argentina', PE: 'Peru', CL: 'Chile', EC: 'Ecuador',
  DO: 'Dominican Republic', BO: 'Bolivia', PY: 'Paraguay', UY: 'Uruguay', US: 'United States', CA: 'Canada',
};
const SIGNUP_KEYS = new Set(['platform_signups', 'total_signups']);
const FUNNEL_NOTE = 'Steps come from different tools. Sign-ups include every entry point, so step-to-step rates are indicative.';

const fmtInt = (n) => Math.round(Number(n)).toLocaleString('en-US');
const fmtUsd = (n) => `US$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtRate = (n) => `${(Number(n) * 100).toFixed(2)}%`;

function canonicalCountry(raw) {
  const value = String(raw || '').trim();
  if (!value || value === UNSPLIT || value === '(not set)' || /^no country$/i.test(value)) return 'No country';
  return ISO[value.toUpperCase()] || value;
}
function inGoal(name) { return name === 'No country' || LATAM_SET.has(name); }
function monthDay(iso) { return Number(String(iso).slice(8, 10)); }
function ymd(month, day) {
  const [year, monthNumber] = month.split('-').map(Number);
  const dim = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  if (day < 1 || day > dim) return null;
  return `${month}-${String(day).padStart(2, '0')}`;
}
function previousMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return monthNumber === 1 ? `${year - 1}-12` : `${year}-${String(monthNumber - 1).padStart(2, '0')}`;
}
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dateRange(from, to) {
  const days = [];
  for (let day = from; day && to && day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}
function rangeLabel(from, to) {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const left = `${MON[monthDay(from) ? Number(from.slice(5, 7)) - 1 : 0]} ${monthDay(from)}`;
  const right = from.slice(0, 7) === to.slice(0, 7) ? String(monthDay(to)) : `${MON[Number(to.slice(5, 7)) - 1]} ${monthDay(to)}`;
  return `${left}-${right}`;
}
function daySpan(from, to) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}

function buildView(input) {
  const {
    month, cutoff, now, launchDate, firstDay, monthLabel,
    days, pos, series, byMetric, platformSeries,
    posthogSnapshot, ga4Snapshot, validCoverage,
    signupsAvailable, sessionsAvailable, signupReason, signupReviewReason, signupReviewFlags,
    sources, notes, targetRows,
  } = input;
  const today = input.today;
  const monthEnd = input.monthEnd;
  const D = monthDay(monthEnd);
  const d = cutoff && cutoff.slice(0, 7) === month ? monthDay(cutoff) : 0;
  const closed = cutoff != null && cutoff >= monthEnd;
  const landingRow = (ga4Snapshot && ga4Snapshot.rows && ga4Snapshot.rows[0]) || {};
  const flags = {};
  for (const note of notes || []) {
    const id = String(note.id || note._k || '');
    if (id.startsWith('exec_flag|')) flags[id.slice('exec_flag|'.length)] = note.label || 'Under review';
  }
  const review = (id) => {
    const reason = signupReviewFlags && signupReviewFlags[id] || flags[id];
    return reason ? { label: 'Under review', reason } : null;
  };

  const covers = (snapshot, day) => validCoverage(snapshot) && day >= snapshot.from && day <= snapshot.to;
  function sumSignups(dates, predicate) {
    if (!signupsAvailable) return null;
    let total = 0;
    for (const date of dates) {
      if (!covers(posthogSnapshot, date)) return null;
      const index = pos.get(date);
      if (index == null) continue;
      for (const [country, values] of Object.entries(series.platform_signups || {})) {
        if (!predicate(canonicalCountry(country))) continue;
        const value = values[index];
        if (value == null) return null;
        total += Number(value) || 0;
      }
    }
    return total;
  }
  function sumSessions(dates) {
    if (!sessionsAvailable) return null;
    let total = 0;
    for (const date of dates) {
      if (!covers(ga4Snapshot, date)) return null;
      const index = pos.get(date);
      if (index == null) continue;
      for (const values of Object.values(series.landing_sessions || {})) {
        const value = values[index];
        if (value == null) return null;
        total += Number(value) || 0;
      }
    }
    return total;
  }
  function countrySum(metric, countryName, dates, available) {
    if (!available) return null;
    const snapshot = metric === 'landing_sessions' ? ga4Snapshot : posthogSnapshot;
    let total = 0;
    for (const date of dates) {
      if (!covers(snapshot, date)) return null;
      const index = pos.get(date);
      if (index == null) continue;
      let day = 0;
      for (const [country, values] of Object.entries(series[metric] || {})) {
        if (canonicalCountry(country) !== countryName) continue;
        const value = values[index];
        if (value == null) return null;
        day += Number(value) || 0;
      }
      total += day;
    }
    return total;
  }

  const monthDates = cutoff ? dateRange(firstDay, cutoff) : [];
  const latamSignupsRaw = sumSignups(monthDates, inGoal);
  const latamSignupsUnfiltered = sumSignups(monthDates, () => true);
  const outsideSignups = sumSignups(monthDates, (name) => !inGoal(name));
  const monthSessions = sumSessions(monthDates);
  const launchDates = cutoff && cutoff >= launchDate ? dateRange(launchDate, cutoff) : [];
  const launchTotalRaw = sumSignups(launchDates, () => true);
  const currentHostReview = Boolean(latamSignupsUnfiltered != null && signupReviewReason);
  const launchHostReview = Boolean(launchTotalRaw != null && signupReviewReason);
  const underReview = (id, reason) => review(id) || (reason ? { label: 'Under review', reason } : null);
  const hostReviewReason = signupReviewReason || 'Unclassified first-identify hosts were excluded; this count covers approved hosts only.';
  const spendIncompleteReason = 'Paid spend incomplete: one or more channels have not reported. This amount includes only known channels.';
  const signupFlagReview = review('signups') || review('platform_signups') || review('exec_accounts');
  const launchFlagReview = review('sinceLaunch') || signupFlagReview;
  const signupsUnderReview = latamSignupsRaw != null
    ? (signupFlagReview && signupFlagReview.reason) || (currentHostReview ? hostReviewReason : null)
    : null;
  const sinceUnderReview = launchTotalRaw != null
    ? (launchFlagReview && launchFlagReview.reason) || (launchHostReview ? hostReviewReason : null)
    : null;
  const reviewReason = signupsUnderReview || sinceUnderReview;
  const latamSignups = latamSignupsRaw;

  const october = month === '2026-10';
  const usedTargets = [];
  if (!october) {
    const countryTargets = (targetRows || []).filter((row) => row.month === month && SIGNUP_KEYS.has(row.metric_key) && LATAM_SET.has(row.country));
    if (countryTargets.length) usedTargets.push(...countryTargets.filter((row) => row.metric_key === 'platform_signups').concat(countryTargets.filter((row) => row.metric_key === 'total_signups' && !countryTargets.some((other) => other.country === row.country && other.metric_key === 'platform_signups'))));
    else {
      const latamTarget = (targetRows || []).find((row) => row.month === month && (row.country || 'LATAM') === 'LATAM' && row.metric_key === 'platform_signups')
        || (targetRows || []).find((row) => row.month === month && (row.country || 'LATAM') === 'LATAM' && row.metric_key === 'total_signups');
      if (latamTarget) usedTargets.push(latamTarget);
    }
  }
  const goal = usedTargets.length ? usedTargets.reduce((sum, row) => sum + Number(row.target_value || 0), 0) : null;
  const proposal = usedTargets.some((row) => row.proposal === true || row.status === 'proposal');
  const minToDate = goal != null && d > 0 ? goal * d / D : null;
  const projection = signupsUnderReview ? null : latamSignups != null && d >= 7 ? latamSignups / d * D : null;
  let pace = null;
  if (goal != null && latamSignups != null && d > 0 && !signupsUnderReview) {
    if (closed) pace = latamSignups >= goal ? 'met' : 'missed';
    else pace = latamSignups + 1e-9 >= minToDate ? 'leading' : 'trailing';
  }

  let signupReasonText = signupReason || 'PostHog first-identify account data is unavailable.';
  if (!cutoff && month === String(today).slice(0, 7) && String(today).endsWith('-01')) signupReasonText = 'Month starts today; first complete day tomorrow';
  const signupsStatus = latamSignups == null ? 'pending' : 'loaded';

  let comparison = month === launchDate.slice(0, 7) ? 'First month since launch' : null;
  if (comparison == null && d > 0 && signupsStatus === 'loaded') {
    const prev = previousMonth(month);
    const prevDates = [];
    for (let day = 1; day <= d; day += 1) {
      const iso = ymd(prev, day);
      if (iso && iso >= launchDate) prevDates.push(iso);
    }
    const previous = !signupsUnderReview && prevDates.length === d ? sumSignups(prevDates, inGoal) : null;
    if (previous == null) comparison = null;
    else if (previous >= 30) {
      const pct = previous ? (latamSignups - previous) / Math.abs(previous) * 100 : 0;
      comparison = `vs same days last month: ${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%`;
    } else {
      const diff = latamSignups - previous;
      comparison = `vs same days last month: ${diff >= 0 ? '+' : '−'}${fmtInt(Math.abs(diff))}`;
    }
  }

  const signupLines = [];
  if (signupsStatus === 'loaded') {
    if (goal == null) signupLines.push(october ? 'No goal for October 2026' : 'No goal for this month');
    else signupLines.push(`of ${fmtInt(goal)} goal${proposal ? ' · Proposal' : ''}`);
    if (minToDate != null) signupLines.push(`Min. to date ${fmtInt(Math.round(minToDate))} · ${goal ? fmtRate(latamSignups / minToDate) : ''} of min.`.replace(' ·  of min.', ''));
    if (d < 7) signupLines.push('Too early to project');
    else if (projection != null) signupLines.push(`Projection: ${fmtInt(Math.round(projection))}`);
    if (outsideSignups > 0) signupLines.push(`+${fmtInt(outsideSignups)} external outside LATAM`);
    if (comparison) signupLines.push(comparison);
  }

  if (reviewReason) {
    const message = `Under review: ${reviewReason}`;
    comparison = message;
    signupLines.splice(0, signupLines.length, message);
  }
  const launchReviewLine = sinceUnderReview ? `Under review: ${signupReviewReason || 'First-identify host coverage is incomplete.'}` : null;

  const sinceDates = cutoff ? dateRange(launchDate, cutoff) : [];
  const sinceReady = signupsStatus === 'loaded' && validCoverage(posthogSnapshot) && cutoff && posthogSnapshot.from <= launchDate && posthogSnapshot.to >= cutoff;
  const sinceLatam = sinceReady ? sumSignups(sinceDates, inGoal) : null;
  const sinceOutside = sinceReady ? sumSignups(sinceDates, (name) => !inGoal(name)) : null;
  const sinceTotal = sinceLatam == null || sinceOutside == null ? null : sinceLatam + sinceOutside;
  const sinceHostReview = sinceTotal != null && launchHostReview;

  const channels = channelStates({ sources, byMetric, platformSeries, pos, monthDates, cutoff, firstDay });
  const spendReported = ['meta', 'linkedin', 'google_ads'].some((key) => channels[key].status === 'loaded' || channels[key].status === 'no_campaigns');
  const pendingChannel = ['meta', 'linkedin', 'google_ads'].map((key) => channels[key]).find((channel) => channel.status === 'pending');
  const spendTotal = spendReported ? ['meta', 'linkedin', 'google_ads']
    .filter((key) => channels[key].status !== 'pending')
    .reduce((sum, key) => sum + (channels[key].spend || 0), 0) : null;
  const spendComplete = !pendingChannel;
  const spend = {
    id: 'spend',
      status: spendReported && (spendComplete || spendTotal > 0) ? 'loaded' : 'pending',
      reason: spendReported && (spendComplete || spendTotal > 0) ? null : (pendingChannel && pendingChannel.reason) || 'No paid source reported data for this period.',
      value: spendReported && (spendComplete || spendTotal > 0) ? spendTotal : null,
    complete: spendComplete,
    source: 'Meta Ads, LinkedIn Ads, Google Ads',
    lines: ['meta', 'linkedin', 'google_ads'].map((key) => channels[key].line),
    underReview: review('spend') || (!spendComplete ? { label: 'Under review', reason: pendingChannel.reason } : null),
  };

  let cpsStatus = 'pending';
  let cpsReason = 'spend incomplete';
  let cpsValue = null;
  if (spend.status !== 'loaded' || !spendComplete || latamSignups == null || signupsUnderReview) {
    cpsReason = spend.status !== 'loaded' || !spendComplete ? 'spend incomplete' : signupsUnderReview ? signupReviewReason || hostReviewReason : signupReasonText;
  } else if (latamSignups === 0 && spendTotal > 0) {
    cpsStatus = 'no_signups';
    cpsReason = `No sign-ups yet · ${fmtUsd(spendTotal)} spent`;
  } else if (latamSignups === 0 && spendTotal === 0) {
    cpsReason = 'No data yet';
  } else {
    cpsStatus = 'loaded';
    cpsReason = null;
    cpsValue = spendTotal / latamSignups;
  }
  const cpsLines = [];
  if (cpsStatus === 'loaded') cpsLines.push('Blended: total paid spend ÷ external LATAM sign-ups. Per-channel cost per sign-up when sign-ups carry the UTM.');
  if (cpsStatus === 'loaded' && latamSignups < 30) cpsLines.push(`Small sample: ${fmtInt(latamSignups)} sign-ups`);

  let visitStatus = 'pending';
  let visitReason = signupsUnderReview || (sessionsAvailable ? signupReasonText : 'GA4 last load is missing for go.think4ever.com');
  let visitRate = null;
  if (!signupsUnderReview && latamSignups != null && monthSessions != null && monthSessions > 0) {
    visitStatus = 'loaded';
    visitReason = null;
    visitRate = latamSignups / monthSessions;
  } else if (!signupsUnderReview && latamSignups != null && monthSessions === 0) {
    visitReason = 'No landing sessions yet';
  }
  const visitLines = [];
  if (visitStatus === 'loaded') {
    visitLines.push(`${fmtInt(latamSignups)} sign-ups of ${fmtInt(monthSessions)} sessions`);
    visitLines.push('Sessions include internal visits');
  }

  const chart = buildChart({
    month, monthEnd, launchDate, cutoff, D, d, goal, proposal, october,
    certified: signupsStatus === 'loaded',
    reason: signupReasonText,
    underReviewReason: signupsUnderReview,
    sinceUnderReview,
    signupReviewReason,
    sumSignups, inGoal, sinceReady, sinceDates,
  });

  const countryNames = new Set(LATAM);
  for (const metric of ['platform_signups', 'landing_sessions']) {
    for (const key of Object.keys(series[metric] || {})) {
      const name = canonicalCountry(key);
      if (name !== 'No country') countryNames.add(name);
    }
  }
  const countries = buildCountries({
    monthDates, goal, proposal, d, D, closed,
    signupsAvailable: signupsStatus === 'loaded', sessionsAvailable: monthSessions != null,
    countrySum, targetRows, month, countryNames,
  });

  const formStarts = formStartTotal({ landingRow, sessionsAvailable, ga4Snapshot, monthDates, byMetric, covers });
  const impressions = pendingChannel ? { status: 'pending', value: null, reason: pendingChannel.reason } : {
    status: 'loaded',
    value: ['meta', 'linkedin', 'google_ads'].reduce((sum, key) => sum + (channels[key].impressions || 0), 0),
    reason: null,
  };
  const funnel = buildFunnel({
    impressions,
    sessions: monthSessions == null ? { status: 'pending', value: null, reason: visitReason } : { status: 'loaded', value: monthSessions, reason: null },
    formStarts,
    signups: signupsStatus === 'loaded' ? { status: 'loaded', value: latamSignups, reason: null } : { status: 'pending', value: null, reason: signupReasonText },
  });

  const changed = buildChanged({
    cutoff, launchDate, signupsStatus, signupReason: signupReasonText, signupReviewReason: reviewReason, signupFlagReview,
    sumSignups, sumSessions, channels, pendingChannel, formStartsReady: formStarts.status === 'loaded',
    landingRow, sessionsAvailable: monthSessions != null, byMetric, ga4Snapshot, posthogSnapshot, covers, pos, series,
  });

  const stamps = [posthogSnapshot, ga4Snapshot].map((snapshot) => snapshot && (snapshot.pulled_at || snapshot._at)).filter(Boolean).sort();
  const research = (notes || [])
    .filter((note) => String(note.id || note._k || '').startsWith('exec_note|'))
    .filter((note) => note.date && cutoff && note.date <= cutoff && daySpan(note.date, cutoff) <= 7)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;

  return {
    month,
    monthLabel,
    cutoff,
    lastLoad: stamps.length ? stamps[stamps.length - 1] : null,
    timezone: 'America/Bogota',
    elapsedDays: d,
    daysInMonth: D,
    cards: {
      signups: {
        id: 'signups', status: signupsStatus, reason: signupsStatus === 'loaded' ? null : signupReasonText,
        value: latamSignups, outside: outsideSignups, goal, proposal, minToDate, projection, pace,
        source: 'PostHog', lines: signupLines, underReview: underReview('signups', signupsUnderReview),
      },
      sinceLaunch: {
        id: 'sinceLaunch', status: sinceTotal == null ? 'pending' : 'loaded',
        reason: sinceTotal == null ? signupReasonText : null,
        value: sinceTotal, latam: sinceLatam, outside: sinceOutside,
        source: 'PostHog',
        lines: [...(sinceTotal == null ? [] : [`LATAM ${fmtInt(sinceLatam)} · Outside LATAM ${fmtInt(sinceOutside)}`, 'since Oct 1, 2026']), ...(launchReviewLine ? [launchReviewLine] : [])],
        underReview: underReview('sinceLaunch', sinceUnderReview),
      },
      spend,
      cps: {
        id: 'cps', status: cpsStatus, reason: cpsReason, value: cpsValue, smallSample: cpsStatus === 'loaded' && latamSignups < 30,
        source: 'Paid spend / PostHog', lines: cpsLines,
        underReview: cpsStatus === 'loaded' && !spendComplete ? underReview('cps', spendIncompleteReason) : (cpsStatus === 'pending' && signupsUnderReview ? underReview('cps', `${signupReviewReason || hostReviewReason} ${!spendComplete ? spendIncompleteReason : ''}`.trim()) : underReview('cps')),
      },
      visit: {
        id: 'visit', status: visitStatus, reason: visitReason, value: visitRate, signups: latamSignups, sessions: monthSessions,
        source: 'PostHog / GA4', lines: visitLines, underReview: underReview('visit', signupsUnderReview),
      },
    },
    channels,
    chart,
    countries,
    funnel,
    changed,
    researchNote: research ? { date: research.date, text: research.label, role: 'Research' } : null,
    outsideLatamNote: 'Countries other than the 11 plan markets are Outside LATAM until an Other LATAM list is confirmed. No country stays in the monthly sign-up number.',
  };
}

function channelStates({ sources, byMetric, monthDates, cutoff, firstDay }) {
  const sourceOf = (key) => (sources || []).find((row) => row._k === key || row.key === key) || {};
  const windowOf = (row) => {
    const match = String(row.window || '').match(/(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/);
    return match ? { from: match[1], to: match[2] } : null;
  };
  const rowsFor = (source, metric) => (byMetric.get(metric) || []).filter((row) => row.source === source && cutoff && row.date >= firstDay && row.date <= cutoff);
  const covered = (key) => {
    const source = sourceOf(key);
    const span = windowOf(source);
    return source.state === 'connected' && span && cutoff && span.from <= firstDay && span.to >= cutoff;
  };
  const sum = (rows) => rows.reduce((total, row) => total + (Number(row.value) || 0), 0);

  const metaSpendRows = rowsFor('meta', 'ad_spend');
  const metaImpressionRows = rowsFor('meta', 'ad_impressions');
  const metaCovered = covered('meta');
  let meta;
  if (metaSpendRows.length) {
    meta = { status: 'loaded', reason: null, spend: sum(metaSpendRows), impressions: sum(metaImpressionRows) };
  } else if (metaCovered && !metaImpressionRows.length) {
    meta = { status: 'no_campaigns', reason: null, spend: 0, impressions: 0 };
  } else {
    meta = { status: 'pending', reason: 'Meta ad account access pending', spend: null, impressions: sum(metaImpressionRows) };
  }

  const googleSpendRows = rowsFor('google_ads', 'ad_spend');
  const googleImpressionRows = rowsFor('google_ads', 'ad_impressions');
  let google;
  if (!covered('google_ads')) google = { status: 'pending', reason: 'Google Ads has not reported for this month', spend: null, impressions: null };
  else if (!googleSpendRows.length && !googleImpressionRows.length) google = { status: 'no_campaigns', reason: null, spend: 0, impressions: 0 };
  else google = { status: 'loaded', reason: null, spend: sum(googleSpendRows), impressions: sum(googleImpressionRows) };

  const linkedin = { status: 'pending', reason: 'LinkedIn paid reporting is not connected', spend: null, impressions: null };
  const lineFor = (name, channel) => {
    if (channel.status === 'loaded') return `${name} ${fmtUsd(channel.spend)}`;
    if (channel.status === 'no_campaigns') return `${name}: no campaigns`;
    return `${name} · No data yet · ${channel.reason}`;
  };
  meta.line = lineFor('Meta', meta);
  linkedin.line = lineFor('LinkedIn', linkedin);
  google.line = lineFor('Google Ads', google);
  void monthDates;
  return { meta, linkedin, google_ads: google };
}

function formStartTotal({ landingRow, sessionsAvailable, ga4Snapshot, monthDates, byMetric, covers }) {
  if (landingRow.form_start_available !== true || !sessionsAvailable) {
    return { status: 'pending', value: null, reason: landingRow.form_start_reason || 'Sign-up form starts are not isolated to go.think4ever.com' };
  }
  let total = 0;
  for (const date of monthDates) {
    if (!covers(ga4Snapshot, date)) return { status: 'pending', value: null, reason: 'GA4 form-start coverage does not cover the full selected month through the cutoff.' };
  }
  for (const row of byMetric.get('ga_exec_form_starts') || []) {
    if (row.source !== 'ga4' || !monthDates.includes(row.date)) continue;
    total += Number(row.value) || 0;
  }
  return { status: 'loaded', value: total, reason: null };
}

function buildFunnel({ impressions, sessions, formStarts, signups }) {
  const steps = [
    { id: 'impressions', name: 'Paid impressions', source: 'Meta, LinkedIn, Google Ads', ...impressions },
    { id: 'sessions', name: 'Landing sessions', source: 'GA4 · go.think4ever.com', ...sessions },
    { id: 'form_start', name: 'Sign-up started', source: 'GA4 · go.think4ever.com', ...formStarts },
    { id: 'signups', name: 'Sign-ups', source: 'PostHog', ...signups },
  ];
  let biggestDrop = null;
  let worst = Infinity;
  for (let index = 1; index < steps.length; index += 1) {
    const previous = steps[index - 1];
    const current = steps[index];
    if (previous.status !== 'loaded' || current.status !== 'loaded' || !(previous.value > 0)) {
      current.rateFromPrevious = null;
      continue;
    }
    const rate = current.value / previous.value;
    current.rateFromPrevious = rate;
    if (rate < worst) { worst = rate; biggestDrop = index; }
  }
  return { steps, biggestDrop, note: FUNNEL_NOTE };
}

function buildCountries({ monthDates, goal, proposal, d, D, closed, signupsAvailable, sessionsAvailable, countrySum, targetRows, month, countryNames }) {
  if (!signupsAvailable && !sessionsAvailable) return { status: 'pending', reason: 'No country data yet', rows: [], noCountry: null };
  const names = countryNames || new Set(LATAM);
  const rows = [];
  for (const name of names) {
    const signups = countrySum('platform_signups', name, monthDates, signupsAvailable);
    const sessions = countrySum('landing_sessions', name, monthDates, sessionsAvailable);
    if (!(signups > 0) && !(sessions > 0)) continue;
    const countryTarget = (targetRows || []).find((row) => row.month === month && row.country === name && SIGNUP_KEYS.has(row.metric_key) && row.metric_key === 'platform_signups')
      || (targetRows || []).find((row) => row.month === month && row.country === name && row.metric_key === 'total_signups');
    const countryGoal = goal == null ? null : (countryTarget ? Number(countryTarget.target_value) : null);
    const minimum = countryGoal != null && d > 0 ? countryGoal * d / D : null;
    let pace = 'No goal';
    if (countryGoal != null && signups != null && d > 0) {
      if (closed) pace = signups >= countryGoal ? 'Met' : 'Missed';
      else pace = signups + 1e-9 >= minimum ? 'Leading' : 'Trailing';
    }
    rows.push({
      country: name,
      proposal: proposal && countryGoal != null,
      signups,
      sessions,
      rate: sessions > 0 && signups != null ? signups / sessions : null,
      percentOfMin: minimum ? signups / minimum : null,
      pace,
    });
  }
  rows.sort((a, b) => (b.signups || 0) - (a.signups || 0) || (b.sessions || 0) - (a.sessions || 0) || a.country.localeCompare(b.country));
  const noCountry = signupsAvailable ? countrySum('platform_signups', 'No country', monthDates, true) : null;
  return {
    status: 'loaded',
    reason: null,
    rows: rows.slice(0, 5),
    noCountry: noCountry > 0 ? noCountry : null,
  };
}

function buildChart({ month, monthEnd, launchDate, cutoff, D, d, goal, proposal, october, certified, reason, underReviewReason, sinceUnderReview, signupReviewReason, sumSignups, inGoal, sinceReady, sinceDates }) {
  const monthDays = dateRange(`${month}-01`, monthEnd).filter((day) => day >= launchDate);
  let run = 0;
  let gap = false;
  const actual = certified && cutoff ? sumSignups(monthDays.filter((day) => day <= cutoff), inGoal) : null;
  const projectedEnd = actual != null && d >= 7 && d < D ? actual / d * D : null;
  const days = monthDays.map((date) => {
    const after = !cutoff || date > cutoff;
    const signups = !certified || after ? null : sumSignups([date], inGoal);
    if (signups == null) gap = true;
    else if (!gap) run += signups;
    const dayNumber = monthDay(date);
    const projected = projectedEnd == null || !cutoff || date < cutoff ? null : actual + (projectedEnd - actual) * ((dayNumber - d) / (D - d));
    return {
      date,
      signups,
      cumulative: signups == null || gap ? null : run,
      minimum: goal != null ? goal * dayNumber / D : null,
      projected,
    };
  });
  let sinceRun = 0;
  const sinceLaunch = sinceReady ? sinceDates.map((date) => {
    const signups = sumSignups([date], () => true);
    if (signups != null) sinceRun += signups;
    return { date, signups, cumulative: signups == null ? null : sinceRun };
  }) : [];
  const chartUnderReviewReason = underReviewReason || (sinceUnderReview ? (signupReviewReason || 'First-identify host coverage is incomplete.') : null);
  return {
    certified,
    reason: certified ? null : reason,
    underReview: chartUnderReviewReason ? { label: 'Under review', reason: chartUnderReviewReason } : null,
    goal,
    proposal,
    goalLabel: goal != null ? `Goal ${fmtInt(goal)}${proposal ? ' · Proposal' : ''}` : null,
    note: underReviewReason ? `Under review: ${underReviewReason}` : (october ? 'No goal for October 2026. Goals start in November (proposal).' : (goal == null ? 'No goal is stored for this month.' : null)),
    days,
    sinceLaunch,
  };
}

function buildChanged(ctx) {
  const { cutoff, launchDate, signupsStatus, signupReason, signupFlagReview } = ctx;
  if (signupsStatus !== 'loaded' || !cutoff) return { phrases: [`No data yet · ${signupReason}`], ready: false };
  if (daySpan(launchDate, cutoff) + 1 < 14) return { phrases: ['Not enough history to compare yet.'], ready: false };
  const currentFrom = addDays(cutoff, -6);
  const previousFrom = addDays(cutoff, -13);
  const previousTo = addDays(cutoff, -7);
  const currentDates = dateRange(currentFrom, cutoff);
  const previousDates = dateRange(previousFrom, previousTo);
  if (signupFlagReview) return { phrases: [`Under review: ${signupFlagReview.reason}`], ready: false };
  const currentSignups = ctx.sumSignups(currentDates, inGoal);
  const previousSignups = ctx.sumSignups(previousDates, inGoal);
  if (currentSignups == null || previousSignups == null) return { phrases: ['Not enough history to compare yet.'], ready: false };

  const phrases = [signupPhrase(currentSignups, previousSignups, currentFrom, cutoff)];
  const spendPhrase = ctx.pendingChannel ? `Ad spend not compared: ${ctx.pendingChannel.reason}.` : null;
  if (spendPhrase) phrases.push(spendPhrase);

  const candidates = [];
  const currentSessions = ctx.sumSessions(currentDates);
  const previousSessions = ctx.sumSessions(previousDates);
  if (currentSessions != null && previousSessions != null) {
    candidates.push(countCandidate(2, 'Landing sessions', 'Landing sessions', currentSessions, previousSessions, previousSessions));
  }
  if (currentSessions > 0 && previousSessions > 0 && currentSignups != null) {
    const currentRate = currentSignups / currentSessions;
    const previousRate = previousSignups / previousSessions;
    candidates.push({
      order: 3, name: 'Visit to sign-up rate', available: true,
      relative: previousRate === 0 ? (currentRate === 0 ? 0 : Infinity) : Math.abs(currentRate - previousRate) / Math.abs(previousRate),
      meaningful: previousSessions >= 30
        ? (previousRate === 0 ? currentRate !== 0 : Math.abs(currentRate - previousRate) / previousRate >= 0.10)
        : Math.abs(currentRate - previousRate) >= 0.03,
      text: `Visit to sign-up rate: ${fmtRate(currentRate)}, from ${fmtRate(previousRate)}.`,
    });
  }
  if (!ctx.pendingChannel) {
    const currentSpend = windowSpend(ctx, currentDates);
    const previousSpend = windowSpend(ctx, previousDates);
    if (currentSpend != null && previousSpend != null) candidates.push(moneyCandidate(4, 'Ad spend', currentSpend, previousSpend));
    if (currentSpend != null && previousSpend != null && currentSignups > 0) {
      const currentCps = currentSpend / currentSignups;
      const previousCps = previousSignups > 0 ? previousSpend / previousSignups : null;
      const text = previousCps == null
        ? `Cost per sign-up: ${fmtUsd(currentCps)}, from no sign-ups the week before.`
        : `Cost per sign-up: ${fmtUsd(currentCps)}, from ${fmtUsd(previousCps)}.`;
      candidates.push({
        order: 5, name: 'Cost per sign-up', available: true,
        relative: previousCps == null || previousCps === 0 ? (currentCps === 0 ? 0 : Infinity) : Math.abs(currentCps - previousCps) / Math.abs(previousCps),
        meaningful: previousSignups === 0 ? currentSpend > 0 : (previousSignups >= 30 ? Math.abs(currentCps - previousCps) / previousCps >= 0.10 : Math.abs(currentCps - previousCps) >= 3),
        text,
      });
    }
  }
  const currentDrop = dropLabel(ctx, currentDates);
  const previousDrop = dropLabel(ctx, previousDates);
  if (currentDrop && previousDrop && currentDrop !== previousDrop) {
    candidates.push({ order: 6, name: 'Biggest funnel drop', available: true, relative: 1, meaningful: true, text: `Biggest drop moved from "${previousDrop}" to "${currentDrop}".` });
  }
  const currentLeader = leader(ctx, currentDates);
  const previousLeader = leader(ctx, previousDates);
  if (currentLeader && previousLeader && currentLeader !== previousLeader) {
    candidates.push({ order: 7, name: 'Top country', available: true, relative: 1, meaningful: true, text: `Top country by sign-ups changed from ${previousLeader} to ${currentLeader}.` });
  }
  candidates.sort((a, b) => (b.relative - a.relative) || (a.order - b.order));
  for (const candidate of candidates.filter((item) => item.meaningful)) {
    if (phrases.length >= 3) break;
    phrases.push(candidate.text);
  }
  if (phrases.length === 1 && candidates.length) phrases.push(`No meaningful change in ${candidates[0].name}.`);
  return { phrases, ready: true };
}

function signupPhrase(current, previous, from, to) {
  const diff = current - previous;
  const tail = previous >= 30
    ? `${diff >= 0 ? 'up' : 'down'} ${Math.abs(previous ? diff / previous * 100 : 0).toFixed(0)}% vs the previous 7 days`
    : `${diff === 0 ? 'the same as' : diff > 0 ? `${fmtInt(diff)} more than` : `${fmtInt(Math.abs(diff))} fewer than`} the previous 7 days`;
  return `External sign-ups: ${fmtInt(current)} in the last 7 days (${rangeLabel(from, to)}), ${tail}.`;
}
function countCandidate(order, name, label, current, previous, base) {
  const diff = current - previous;
  const relative = previous === 0 ? (current === 0 ? 0 : Infinity) : Math.abs(diff) / Math.abs(previous);
  const meaningful = Math.abs(base) >= 30 ? relative >= 0.10 : Math.abs(diff) >= 3;
  const tail = Math.abs(base) >= 30
    ? `${diff >= 0 ? 'up' : 'down'} ${Math.abs(previous ? diff / previous * 100 : 0).toFixed(0)}% vs the previous 7 days`
    : `${diff === 0 ? 'the same as' : diff > 0 ? `${fmtInt(diff)} more than` : `${fmtInt(Math.abs(diff))} fewer than`} the previous 7 days`;
  return { order, name, available: true, relative, meaningful, text: `${label}: ${fmtInt(current)}, ${tail}.` };
}
function moneyCandidate(order, name, current, previous) {
  const diff = current - previous;
  const relative = previous === 0 ? (current === 0 ? 0 : Infinity) : Math.abs(diff) / Math.abs(previous);
  const meaningful = previous >= 30 ? relative >= 0.10 : Math.abs(diff) >= 3;
  const tail = previous >= 30
    ? `${diff >= 0 ? 'up' : 'down'} ${(Math.abs(previous ? diff / previous * 100 : 0)).toFixed(0)}% vs the previous 7 days`
    : `${diff >= 0 ? 'up' : 'down'} ${fmtUsd(Math.abs(diff))} vs the previous 7 days`;
  return { order, name, available: true, relative, meaningful, text: `${name}: ${fmtUsd(current)}, ${tail}.` };
}
function windowSpend(ctx, dates) {
  let total = 0;
  for (const source of ['meta', 'google_ads']) {
    const channel = ctx.channels[source];
    if (channel.status === 'pending') return null;
    for (const metric of ['ad_spend']) {
      for (const row of ctx.byMetric.get(metric) || []) {
        if (row.source === source && dates.includes(row.date)) total += Number(row.value) || 0;
      }
    }
  }
  return total;
}
function dropLabel(ctx, dates) {
  const steps = [];
  const impressionsPending = ctx.pendingChannel;
  steps.push(impressionsPending ? null : windowSpend(ctx, dates) == null ? null : impressionSum(ctx, dates));
  steps.push(ctx.sumSessions(dates));
  steps.push(ctx.formStartsReady ? formSum(ctx, dates) : null);
  steps.push(ctx.sumSignups(dates, inGoal));
  const names = ['Paid impressions', 'Landing sessions', 'Sign-up started', 'Sign-ups'];
  let worst = Infinity;
  let label = null;
  for (let index = 1; index < steps.length; index += 1) {
    if (steps[index] == null || steps[index - 1] == null || !(steps[index - 1] > 0)) continue;
    const rate = steps[index] / steps[index - 1];
    if (rate < worst) { worst = rate; label = `${names[index - 1]} to ${names[index]}`; }
  }
  return label;
}
function impressionSum(ctx, dates) {
  let total = 0;
  for (const source of ['meta', 'google_ads']) {
    if (ctx.channels[source].status === 'pending') return null;
    for (const row of ctx.byMetric.get('ad_impressions') || []) {
      if (row.source === source && dates.includes(row.date)) total += Number(row.value) || 0;
    }
  }
  return total;
}
function formSum(ctx, dates) {
  let total = 0;
  for (const row of ctx.byMetric.get('ga_exec_form_starts') || []) {
    if (row.source === 'ga4' && dates.includes(row.date)) total += Number(row.value) || 0;
  }
  return total;
}
function leader(ctx, dates) {
  let best = null;
  let bestValue = 0;
  for (const name of LATAM) {
    const value = ctx.sumSignups(dates, (country) => country === name);
    if (value > bestValue) { bestValue = value; best = name; }
  }
  return best;
}

module.exports = { buildView, LATAM };
