'use strict';
/* Acquisition: who signed up and where they came from, then the traffic that brought them.
   Users acquired: PostHog accounts created (non-Internal, the same people as Overview) against the month goal,
   split by first-touch channel, paid or organic, persona, campaign and country, with how many verified and the
   spend per account and per verified account for the paid platforms.
   Traffic: GA4 sessions, users and engagement by channel, with UTM, entry-page and country detail. */
(function (A) {
  const external = (r) => r.dim === 'account_type' && r.dim_value !== 'Internal';
  // First-touch UTMs reach PostHog from this day: the portal stores utm_*_first since 2026-11-04 and the
  // landing's first-touch cookie script went live on 2026-11-06 (KB, medicion-flujo-registro-con-intencion).
  // Accounts before it carry no UTM, so every split by UTM starts here.
  const ATTRIBUTION_FROM = '2026-11-06';
  const sum = (rows, f) => rows.reduce((s, r) => s + (f ? f(r) : r.people), 0);

  function acquired(U, C, D, S) {
    const CH = A.channels, P = A.paid;
    const grain = D.grainName();
    const ready = !!D.covered('posthog', 'account_coverage', S.from, S.to);
    if (!ready) {
      return U.section('Users acquired', 'Accounts created in the platform · PostHog', U.kpiRow([
        U.kpi({ label: 'Accounts created', source: 'PostHog', awaiting: 'PostHog' }),
        U.kpi({ label: 'Month goal', source: 'PostHog · goal', awaiting: 'PostHog' }),
        U.kpi({ label: 'With a first-touch UTM', source: 'PostHog', awaiting: 'PostHog' }),
        U.kpi({ label: 'Paid / organic', source: 'PostHog · UTM', awaiting: 'PostHog' }),
        U.kpi({ label: 'Spend per paid account', source: 'Ads · PostHog', awaiting: 'PostHog' }),
      ]));
    }
    const total = D.sum('posthog', 'ph_accounts', external, S.from, S.to);
    const cmp = D.completeBucketComparison();
    const inBucket = (p) => (p && D.covered('posthog', 'account_coverage', p.from, p.to) ? D.sum('posthog', 'ph_accounts', external, p.from, p.to) : null);
    const cmpLabel = cmp ? `Latest complete ${grain.toLowerCase()}: ${cmp.current.label} vs ${cmp.previous.label}` : `No two complete ${grain.toLowerCase()} buckets since launch`;
    const now = cmp ? inBucket(cmp.current) : null, before = cmp ? inBucket(cmp.previous) : null;

    // Month goal: the same progress Overview shows (Targets, else the 500K plan), on the top-bar Month.
    const g = D.goalAccounts();
    const goalTile = g.status === 'loaded' && g.goal
      ? U.kpi({ label: 'Month goal', source: 'PostHog · goal', value: U.pct(g.ratio), compare: `${U.fmt(g.value)} of ${U.fmt(g.goal)} accounts · ${U.monthName(g.month)} to ${U.dshort(g.to)} · ${g.goalSource === 'targets' ? 'target from Targets' : '500K plan'} · same progress as Overview · Month selector at the top` })
      : U.kpi({ label: 'Month goal', source: 'PostHog · goal', value: '–', compare: g.status === 'loaded' ? 'No goal set for this month' : 'Account coverage unavailable for this month; not zero' });

    // Every split by UTM uses the attribution window: the selected range from ATTRIBUTION_FROM on.
    const aFrom = S.from > ATTRIBUTION_FROM ? S.from : ATTRIBUTION_FROM, aTo = S.to;
    const attrOk = aFrom <= aTo;
    const aWin = U.win(aFrom, aTo);
    const attrNote = S.from < ATTRIBUTION_FROM ? `First-touch UTMs are recorded from ${U.dshort(ATTRIBUTION_FROM)}; earlier accounts are left out of this split.` : '';
    const acc = attrOk ? D.accountsByUtm(aFrom, aTo) : null;
    const ver = attrOk ? D.verifiedByUtm(aFrom, aTo) : null;
    const utmPending = attrOk ? 'Waiting for the next PostHog sync (accounts by first-touch UTM)' : `First-touch UTMs are recorded from ${U.dshort(ATTRIBUTION_FROM)}; pick a range that reaches it`;
    const accAll = acc ? sum(acc) : null;
    const tagged = (r) => CH.classify(r) !== 'none';
    const withUtm = acc ? sum(acc.filter(tagged)) : null;
    const paid = acc ? sum(acc.filter((r) => P.paidMedium(r.medium))) : null;
    const byPlatform = (rows, key) => (rows ? sum(rows.filter((r) => P.platform(r.source, r.medium) === key)) : null);
    const platforms = C.PLATFORMS.map((p) => ({ ...p, spend: attrOk ? D.paidStats(p.key, aFrom, aTo).spend : null, accounts: byPlatform(acc, p.key), verified: byPlatform(ver, p.key) }));
    // A platform with spend but no account carrying its UTM most likely runs ads without UTMs: its spend is left
    // out of spend per account and named, so it never reads as "the platform brings no one".
    const untracked = acc ? platforms.filter((p) => p.spend > 0 && !p.accounts) : [];
    const tracked = platforms.filter((p) => p.spend > 0 && p.accounts > 0);
    const spendAll = platforms.some((p) => p.spend != null) ? platforms.reduce((s, p) => s + (p.spend || 0), 0) : null;
    const spendTracked = tracked.reduce((s, p) => s + p.spend, 0);
    const platformAccounts = tracked.reduce((s, p) => s + p.accounts, 0);
    const platformVerified = ver ? tracked.reduce((s, p) => s + (p.verified || 0), 0) : null;
    const untrackedNote = untracked.length ? `${untracked.map((p) => p.name).join(', ')} ${untracked.length > 1 ? 'have' : 'has'} spend but no account carries ${untracked.length > 1 ? 'their' : 'its'} UTM: most likely the ads have no UTM yet, so ${untracked.length > 1 ? 'they are' : 'it is'} left out of spend per account rather than read as bringing no one.` : '';
    // Splits by UTM run on the attribution window, so their titles carry the real dates.
    const inWin = (title) => (attrOk ? `${title} · ${aWin}` : title);

    const kpis = U.kpiRow([
      U.kpi({ label: 'Accounts created', source: 'PostHog', hero: true, value: U.fmt(total), delta: cmp ? U.delta(now, before) : null,
        spark: D.series(D.byDay('posthog', 'ph_accounts', S.from, S.to, external)),
        compare: `Selected-range total · first account_created or $identify per person · internal excluded, same count as Overview · ${cmpLabel}` }),
      goalTile,
      acc ? U.kpi({ label: inWin('With a first-touch UTM'), source: 'PostHog', value: U.fmt(withUtm), compare: `${U.pct(accAll ? withUtm / accAll : null)} of ${U.fmt(accAll)} accounts · ${aWin} · the rest arrived with no UTM, so their campaign is unknown` })
        : U.kpi({ label: 'With a first-touch UTM', source: 'PostHog', value: '–', compare: utmPending }),
      acc ? U.kpi({ label: inWin('Paid / organic'), source: 'PostHog · UTM', value: `${U.fmt(paid)} / ${U.fmt(accAll - paid)}`, small: true, compare: `${U.pct(accAll ? paid / accAll : null)} paid · ${aWin} · paid = a paid utm_medium (cpc, paid_social, display…); organic is the rest, no UTM included` })
        : U.kpi({ label: 'Paid / organic', source: 'PostHog · UTM', value: '–', compare: utmPending }),
      spendAll == null ? U.kpi({ label: 'Spend per paid account', source: 'Ads · PostHog', awaiting: 'Ads' })
        : !acc ? U.kpi({ label: 'Spend per paid account', source: 'Ads · PostHog', value: '–', compare: utmPending })
          : !tracked.length ? U.kpi({ label: inWin('Spend per paid account'), source: 'Ads · PostHog', value: '–', compare: `No paid platform has accounts with its UTM in ${aWin}. ${untrackedNote}` })
            : U.kpi({ label: inWin('Spend per paid account'), source: 'Ads · PostHog', value: U.money(P.cost(spendTracked, platformAccounts)),
              compare: `${U.money(spendTracked)} ÷ ${U.fmt(platformAccounts)} accounts from ${tracked.map((p) => p.name).join(', ')} UTMs · ${U.money(P.cost(spendTracked, platformVerified))} per verified account · ${aWin} · an upper bound: paid sign-ups without a UTM are not counted${untrackedNote ? ` · ${untrackedNote}` : ''}` }),
    ]);

    // By channel: Overview's channel split, with how many people verified in the same days.
    const origin = attrOk ? D.accountsByOrigin(aFrom, aTo) : null, originVer = attrOk ? D.verifiedByOrigin(aFrom, aTo) : null;
    const originTotal = origin ? Object.values(origin).reduce((s, v) => s + v, 0) : 0;
    const originRows = origin ? CH.CHANNELS.map((c) => ({ key: c.key, name: c.label, accounts: origin[c.key] || 0, verified: originVer ? originVer[c.key] || 0 : null }))
      .filter((r) => r.accounts || r.verified).sort((a, b) => b.accounts - a.accounts) : [];
    const verifiedCols = [
      { t: 'Verified', num: 1, f: (r) => (r.verified == null ? '–' : U.fmt(r.verified)) },
      { t: 'Verified ÷ accounts', num: 1, f: (r) => (r.verified == null ? '–' : U.pct(r.accounts ? r.verified / r.accounts : null)) },
    ];
    const verNote = 'Verified = first account_verified per person in the same days (the Developer Network definition), so the ratio compares days, not a cohort.';
    const byChannel = U.card({ title: inWin('Accounts by channel'), sub: origin ? `${U.fmt(originTotal)} accounts · first-touch UTM · ${aWin}` : '', right: U.srcPill('posthog', 'first touch'),
      body: origin ? (originRows.length ? U.table([
        { t: 'Channel', f: (r) => U.esc(r.name) },
        { t: 'Accounts', num: 1, f: (r) => U.fmt(r.accounts) }, { t: 'Share', num: 1, f: (r) => U.pct(originTotal ? r.accounts / originTotal : null) },
        ...verifiedCols,
      ], originRows) : U.empty('No accounts in this period')) + `<p class="card-note">Channels follow the Developer Network links, plus Meta Ads (instagram or facebook with a paid medium). Any other campaign counts as Other UTM; the campaign table names them. ${verNote} ${attrNote}</p>`
        : U.empty(attrOk ? 'Waiting for PostHog' : 'Attribution not recorded yet', attrOk ? 'Accounts by channel appear after the next PostHog sync.' : utmPending) });

    // By country against each market's monthly goal (goal plan), on the top-bar Month like the goal tile.
    const plan = (S.data && S.data.goalPlan && S.data.goalPlan.countries) || {};
    let byCountry;
    if (g.status === 'loaded' && Object.keys(plan).length) {
      const geo = {};
      for (const r of D.M()) if (r.source === 'posthog' && r.metric === 'ph_accounts_geo' && r.dim === 'country' && r.date >= g.from && r.date <= g.to) geo[r.dim_value] = (geo[r.dim_value] || 0) + (Number(r.value) || 0);
      const assigned = Object.values(geo).reduce((s, v) => s + v, 0);
      const rows = Object.entries(plan).map(([country, goal]) => ({ country, accounts: geo[country] || 0, goal })).sort((a, b) => b.goal - a.goal);
      const other = Object.entries(geo).filter(([c]) => !(c in plan)).reduce((s, [, v]) => s + v, 0);
      rows.push({ country: 'Other countries', accounts: other, goal: null }, { country: 'No country', accounts: Math.max(0, g.value - assigned), goal: null });
      byCountry = U.card({ title: 'Accounts by country vs monthly goal', sub: `${U.monthName(g.month)} to ${U.dshort(g.to)} · Month selector at the top · goals from the plan`, right: U.srcPill('posthog', 'country'), body: U.table([
        { t: 'Country', f: (r) => U.esc(r.country) },
        { t: 'Accounts', num: 1, f: (r) => U.fmt(r.accounts) },
        { t: 'Monthly goal', num: 1, f: (r) => (r.goal == null ? '–' : U.fmt(r.goal)) },
        { t: '% of goal', num: 1, f: (r) => (r.goal ? U.pct(r.accounts / r.goal) : '–') },
      ], rows) + '<p class="card-note">Country comes from the first sign-in in the browser. Accounts created only on the server have no country and are shown as No country, never guessed.</p>' });
    } else {
      byCountry = U.card({ title: 'Accounts by country vs monthly goal', body: U.empty('No country goals or account coverage for this month') });
    }

    // By persona: the pNN code at the start of utm_content (UTM convention; its place in paid ads is por confirmar).
    const personaOf = (r) => D.persona(r.content) || (tagged(r) ? 'No persona code' : 'No UTM');
    const group = (rows, keyOf) => { const m = new Map(); for (const r of rows || []) { const k = keyOf(r); m.set(k, (m.get(k) || 0) + r.people); } return m; };
    const personaAcc = group(acc, personaOf), personaVer = group(ver, personaOf);
    const personaRows = [...personaAcc.keys()].map((k) => ({ name: k, accounts: personaAcc.get(k) || 0, verified: ver ? personaVer.get(k) || 0 : null }))
      .sort((a, b) => (/^p\d/.test(b.name) - /^p\d/.test(a.name)) || (/^p\d/.test(a.name) ? a.name.localeCompare(b.name) : b.accounts - a.accounts));
    const byPersona = U.card({ title: inWin('Accounts by persona'), sub: acc ? `${U.fmt(accAll)} accounts · persona code at the start of utm_content · ${aWin}` : '', right: U.srcPill('posthog', 'first touch'),
      body: !acc ? U.empty(attrOk ? 'Waiting for PostHog' : 'Attribution not recorded yet', utmPending) : personaRows.length ? U.table([
        { t: 'Persona', f: (r) => (/^p\d/.test(r.name) ? U.pill('info', r.name) : U.esc(r.name)) },
        { t: 'Accounts', num: 1, f: (r) => U.fmt(r.accounts) }, { t: 'Share', num: 1, f: (r) => U.pct(accAll ? r.accounts / accAll : null) },
        ...verifiedCols,
      ], personaRows) + `<p class="card-note">Personas p01 to p13 per the UTM convention. Creator links carry the creator's user and Gmail ads the piece in utm_content, so they show as No persona code. Where paid ads put the persona code is still to be confirmed with the web team. ${attrNote}</p>` : U.empty('No accounts in this period') });

    // Paid funnel by platform (the 2026-11-06 decision: drill from the aggregate funnel to each channel), every
    // step in the attribution window so the rates compare the same days. CTR and click → session are read against
    // Overview's targets for the same steps (C.STEP_TARGETS), in the same actual-vs-target box. HubSpot forms are a
    // separate path, not a step: the landing registers with email and a 6-digit code without HubSpot.
    const funnelRows = attrOk ? platforms.map((p) => { const s = D.paidStats(p.key, aFrom, aTo); return { ...p, impressions: s.impressions, clicks: s.clicks, sessions: s.sessions, forms: s.forms }; }) : [];
    if (funnelRows.length) {
      const add = (k) => (funnelRows.some((r) => r[k] != null) ? funnelRows.reduce((s, r) => s + (r[k] || 0), 0) : null);
      funnelRows.push({ name: 'All paid', color: 'transparent', total: true, ...Object.fromEntries(['spend', 'impressions', 'clicks', 'sessions', 'forms', 'accounts', 'verified'].map((k) => [k, add(k)])) });
    }
    const n = (v) => (v == null ? '<span class="text-muted">–</span>' : U.fmt(v));
    const rate = (a, b, digits) => (a == null || !b ? '–' : U.pct(a / b, digits));
    const T = C.STEP_TARGETS;
    const isUntracked = (r) => untracked.some((p) => p.key === r.key);
    const noUtm = '<span class="text-muted">No account with its UTM</span>';
    const paidFunnel = !attrOk ? U.card({ title: 'Paid funnel by platform', body: U.empty('Attribution not recorded yet', utmPending) }) : U.card({ title: inWin('Paid funnel by platform'), sub: 'impressions → clicks → landing sessions → accounts → verified, each from its own source · targets as in Overview', body: U.table([
      { t: 'Platform', f: (r) => (r.total ? `<b>${U.esc(r.name)}</b>` : `<span class="ch-dot" style="--ch:${r.color};margin-right:8px"></span>${U.esc(r.name)}`) },
      { t: 'Impressions', num: 1, f: (r) => n(r.impressions) },
      { t: 'Clicks', num: 1, f: (r) => n(r.clicks) }, { t: 'CTR vs target', f: (r) => (r.impressions == null ? '–' : C.rateVerdict(r.clicks, r.impressions, T['Clicks to the landing'], true)) },
      { t: 'Landing sessions', num: 1, f: (r) => n(r.sessions) }, { t: 'Click → session vs target', f: (r) => (r.clicks == null ? '–' : C.rateVerdict(r.sessions, r.clicks, T['Landing sessions'], true)) },
      { t: 'Accounts', num: 1, f: (r) => (isUntracked(r) ? noUtm : n(r.accounts)) }, { t: 'Session → account', num: 1, f: (r) => (isUntracked(r) ? '–' : rate(r.accounts, r.sessions)) },
      { t: 'Verified', num: 1, f: (r) => (isUntracked(r) ? '–' : n(r.verified)) },
      { t: 'Spend', num: 1, f: (r) => (r.spend == null ? '<span class="text-muted">Not connected</span>' : U.money(r.spend)) },
      { t: 'Per account', num: 1, f: (r) => (isUntracked(r) ? '–' : r.spend == null || r.accounts == null ? '–' : r.accounts ? U.money(P.cost(r.total ? spendTracked : r.spend, r.accounts)) : '<span class="text-muted">No accounts</span>') },
      { t: 'Per verified', num: 1, f: (r) => (isUntracked(r) ? '–' : r.spend == null || r.verified == null ? '–' : r.verified ? U.money(P.cost(r.total ? spendTracked : r.spend, r.verified)) : '<span class="text-muted">None verified</span>') },
      { t: 'HubSpot forms · separate path', num: 1, f: (r) => n(r.forms) },
    ], funnelRows) + `<p class="card-note">${untrackedNote ? `<b>${U.esc(untrackedNote)}</b> ` : ''}Impressions and clicks from each ad platform (Meta counts link clicks); landing sessions from GA4 by paid UTM; accounts and verified people from PostHog first-touch UTMs. The sources are not linked person by person, so each rate compares totals. CTR and click → session use Overview's targets for the same steps. HubSpot forms are a separate path, not a step between sessions and accounts: the landing registers with an email and a 6-digit code without HubSpot. Spend in US dollars, converted at sync; a paid sign-up that lost its UTM is not counted, so spend per account is an upper bound. ${attrNote}</p>` });

    // By campaign: accounts and verified people per source / medium / campaign (utm_content summed).
    const campKey = (r) => [r.campaign, r.source, r.medium].join('\u0001');
    const campAcc = new Map(), campVer = group((ver || []).filter(tagged), campKey);
    for (const r of (acc || []).filter(tagged)) { const k = campKey(r); const o = campAcc.get(k) || { campaign: r.campaign, source: r.source, medium: r.medium, accounts: 0 }; o.accounts += r.people; campAcc.set(k, o); }
    const campaignRows = [...campAcc.entries()].map(([k, o]) => ({ ...o, verified: ver ? campVer.get(k) || 0 : null })).sort((a, b) => b.accounts - a.accounts);
    const campaigns = U.card({ title: inWin('Accounts by campaign'), sub: acc ? `${U.fmt(campaignRows.length)} source / medium / campaign rows · first-touch UTM · ${aWin}` : '', right: U.srcPill('posthog', 'first touch'),
      body: !acc ? U.empty(attrOk ? 'Waiting for PostHog' : 'Attribution not recorded yet', attrOk ? 'Accounts by campaign appear after the next PostHog sync.' : utmPending) : campaignRows.length ? U.table([
        { t: 'Campaign', f: (r) => `<code>${U.esc(r.campaign)}</code>` },
        { t: 'Source / medium', f: (r) => `${U.esc(r.source)} / ${U.esc(r.medium)}` },
        { t: 'Channel', f: (r) => { const k = P.platform(r.source, r.medium); const pf = k && C.PLATFORMS.find((p) => p.key === k); return `${U.esc(CH.label(CH.classify(r)))}${pf ? ` ${U.pill('info', `Paid · ${pf.name}`)}` : ''}`; } },
        { t: 'Accounts', num: 1, f: (r) => U.fmt(r.accounts) },
        { t: 'Share of accounts', num: 1, f: (r) => U.pct(accAll ? r.accounts / accAll : null) },
        ...verifiedCols,
      ], campaignRows.slice(0, 25)) + (campaignRows.length > 25 ? `<p class="card-note">Top 25 of ${U.fmt(campaignRows.length)} rows.</p>` : '')
        + `<p class="card-note">${U.fmt(accAll - withUtm)} accounts have no first-touch UTM and are not listed. Counted from each account's own first-touch UTM in PostHog; Executive's campaign funnel splits a different population (external people on approved hosts, matched to HubSpot forms), so its per-campaign numbers can differ. ${attrNote}</p>`
        : U.empty('No accounts with a UTM in this period') });

    return U.section('Users acquired', `${U.win(S.from, S.to)} · accounts created in the platform (PostHog), internal excluded · splits by UTM from ${U.dshort(ATTRIBUTION_FROM)} · change compares the latest two complete ${grain.toLowerCase()} buckets since launch`, kpis)
      + `<section class="section grid-2">${byChannel}${byCountry}</section>`
      + `<section class="section">${paidFunnel}</section>`
      + `<section class="section grid-2">${byPersona}${campaigns}</section>`;
  }

  function render() {
    const U = A.ui, C = A.charts, D = A.D, S = A.S;
    const grain = D.grainName();
    const ticks = D.ticks(), periods = D.periods();
    const periodIndex = new Map(periods.map((period, index) => [period.key, index]));
    const periodFor = (date) => periods.find((period) => date >= period.from && date <= period.to) || null;
    const g = D.ga();
    const siteUser = (r) => r.dim !== 'channel';
    const hasSiteUsers = D.M().some((r) => r.source === 'ga4' && (r.metric === 'ga_users' || r.metric === 'ga_new_users') && siteUser(r));
    const gaNewDay = hasSiteUsers ? D.byDay('ga4', 'ga_new_users', S.from, S.to, siteUser) : null;
    const gaSessDay = D.byDay('ga4', 'ga_sessions', S.from, S.to, (r) => r.dim === 'channel');
    const gaEngDay = D.byDay('ga4', 'ga_engaged_sessions', S.from, S.to, (r) => r.dim === 'channel');
    const gaChannels = D.gaChannels();
    const channelTotal = g && g.sessions;
    const topChannel = gaChannels[0];
    const bucketComparison = D.completeBucketComparison();
    const bucketNow = bucketComparison ? D.ga(bucketComparison.current.from, bucketComparison.current.to) : null;
    const bucketPrevious = bucketComparison ? D.ga(bucketComparison.previous.from, bucketComparison.previous.to) : null;
    const bucketDeltaLabel = bucketComparison ? `Latest complete ${grain.toLowerCase()}: ${bucketComparison.current.label} vs ${bucketComparison.previous.label}` : `No two complete ${grain.toLowerCase()} buckets since launch`;
    const channelInBucket = (period) => period ? D.gaChannels(period.from, period.to)[0] : null;
    const currentTop = bucketComparison && channelInBucket(bucketComparison.current);
    const previousTop = bucketComparison && channelInBucket(bucketComparison.previous);
    const channelDeltaLabel = bucketComparison ? `Latest complete ${grain}: ${currentTop ? `${U.esc(currentTop.channel)} (${U.fmt(currentTop.sessions)})` : 'no channel data'} · previous ${grain}: ${previousTop ? `${U.esc(previousTop.channel)} (${U.fmt(previousTop.sessions)})` : 'no channel data'}` : bucketDeltaLabel;
    const hasBucketGA = !!(bucketNow || bucketPrevious);
    const countDelta = (metric) => bucketComparison ? U.delta(bucketNow && bucketNow[metric], bucketPrevious && bucketPrevious[metric]) : null;
    const rateDelta = () => bucketComparison ? U.deltaPoints(bucketNow && bucketNow.rate, bucketPrevious && bucketPrevious.rate) : null;
    // The two complete buckets' own values, so each change reads with its numbers ("Nov 9–15: 5,018 · Nov 2–8: 2,979").
    const bucketValues = (metric, format = U.fmt) => bucketComparison
      ? `${bucketComparison.current.label}: ${format(bucketNow && bucketNow[metric])} · ${bucketComparison.previous.label}: ${format(bucketPrevious && bucketPrevious[metric])}` : bucketDeltaLabel;
    const missingRangeKpi = (label, delta, note) => hasBucketGA
      ? U.kpi({ label, source: 'GA4', value: '–', delta, compare: `No selected-range value · ${note} · ${bucketDeltaLabel}` })
      : U.kpi({ label, source: 'GA4', awaiting: 'GA4' });

    const kpis = U.kpiRow([
      !g ? missingRangeKpi('GA4 sessions', countDelta('sessions'), 'bucket counts are still shown') : U.kpi({ label: 'GA4 sessions', source: 'GA4', value: U.fmt(g.sessions), delta: countDelta('sessions'), spark: D.series(gaSessDay), compare: `Selected-range total · ${bucketDeltaLabel} · ${bucketValues('sessions')}` }),
      // Unique visitors are deduplicated over the whole range; GA4 daily uniques cannot be added, so there is no period change.
      !g ? U.kpi({ label: 'Unique visitors', source: 'GA4', awaiting: 'GA4' })
        : U.kpi({ label: 'Unique visitors', source: 'GA4', value: g.users == null ? '–' : U.fmt(g.users), compare: g.users == null ? 'Deduplicated total not available for this range' : 'Deduplicated selected-range total · no period change: daily unique visitors cannot be added' }),
      !g ? missingRangeKpi('New users', countDelta('newUsers'), 'bucket counts are still shown')
        : g.newUsers == null ? U.kpi({ label: 'New users', source: 'GA4', value: '–', delta: countDelta('newUsers'), compare: `New-user total unavailable for this range · ${bucketDeltaLabel}` })
          : U.kpi({ label: 'New users', source: 'GA4', value: U.fmt(g.newUsers), delta: countDelta('newUsers'), spark: gaNewDay ? D.series(gaNewDay) : null, compare: `First visits; selected-range total · ${bucketDeltaLabel} · ${bucketValues('newUsers')}` }),
      !g ? missingRangeKpi('Engagement rate', rateDelta(), 'bucket rates are still shown when both rates exist')
        : !g.sessions ? U.kpi({ label: 'Engagement rate', source: 'GA4', value: '–', delta: rateDelta(), compare: `No selected-range sessions · ${bucketDeltaLabel}` })
          : U.kpi({ label: 'Engagement rate', source: 'GA4', value: U.pct(g.rate), delta: rateDelta(), spark: D.seriesRate(gaEngDay, gaSessDay), compare: `${U.fmt(g.engaged)} engaged of ${U.fmt(g.sessions)} range sessions · ${bucketDeltaLabel} · ${bucketValues('rate', U.pct)}` }),
      topChannel ? U.kpi({ label: 'Top channel', source: 'GA4', value: U.esc(topChannel.channel), small: true, compare: `Selected-range share · ${U.fmt(topChannel.sessions)} sessions · ${U.pct(channelTotal ? topChannel.sessions / channelTotal : null)} of total · ${channelDeltaLabel}` })
        : (currentTop || previousTop) ? U.kpi({ label: 'Top channel', source: 'GA4', value: '–', small: true, compare: `No top channel in selected range · ${channelDeltaLabel}` })
          : U.kpi({ label: 'Top channel', source: 'GA4', awaiting: 'GA4' }),
    ]);
    const goals = A.targets.strip(['landing_sessions', 'unique_visitors', 'engagement_rate']);

    const channelBars = gaChannels.map((r) => ({ name: r.channel, color: C.CHANNELS[C.channelOf(r.channel)].color, value: r.sessions, label: U.fmt(r.sessions) }));
    const perf = U.card({ title: 'GA4 sessions by channel', sub: `${U.fmt(channelTotal)} sessions · session-attributed traffic · ${U.win(S.from, S.to)}`, right: U.srcPill('ga4', 'session channel'), body: channelBars.length ? C.hbars(channelBars, channelTotal) : U.awaiting('ga4') });
    const channelEngagement = U.card({ title: 'Engagement by channel', sub: 'Selected-range channel totals · engaged sessions / sessions; the detail table below is split by time bucket', body: gaChannels.length ? U.table([
      { t: 'Channel', f: (r) => `<span class="ch-dot" style="--ch:${C.CHANNELS[C.channelOf(r.channel)].color};margin-right:8px"></span>${U.esc(r.channel)}` },
      { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Engaged sessions', num: 1, f: (r) => U.fmt(r.engaged_sessions) },
      { t: 'Engagement rate', num: 1, f: (r) => U.pct(r.sessions ? r.engaged_sessions / r.sessions : null) },
    ], gaChannels) : U.awaiting('ga4') });
    const channelPeriodRows = periods.flatMap((period) => D.gaChannels(period.from, period.to).map((row) => ({ ...row, periodKey: period.key, period: period.label })))
      .sort((a, b) => periodIndex.get(a.periodKey) - periodIndex.get(b.periodKey) || b.sessions - a.sessions);
    const periodRowsNote = (rows, shown) => rows > shown ? `<p class="card-note" style="padding:0 20px 16px">Showing the latest ${U.fmt(shown)} of ${U.fmt(rows)} period rows; headline totals and charts cover the full selected range.</p>` : '';
    const channelPeriodDetails = U.details('GA4 channel engagement by period', `${grain} · ${U.fmt(channelPeriodRows.length)} channel-period rows`, channelPeriodRows.length ? U.table([
      { t: 'Period', f: (r) => U.esc(r.period) },
      { t: 'Channel', f: (r) => `<span class="ch-dot" style="--ch:${C.CHANNELS[C.channelOf(r.channel)].color};margin-right:8px"></span>${U.esc(r.channel)}` },
      { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Engaged sessions', num: 1, f: (r) => U.fmt(r.engaged_sessions) },
      { t: 'Engagement rate', num: 1, f: (r) => U.pct(r.sessions ? r.engaged_sessions / r.sessions : null) },
    ], channelPeriodRows.slice(-300)) + periodRowsNote(channelPeriodRows.length, 300) : U.awaiting('ga4'));
    const rawDaily = Object.fromEntries(U.days(S.from, S.to).map((d) => [d, Array(8).fill(0)]));
    for (const r of D.M()) if (r.source === 'ga4' && r.metric === 'ga_sessions' && r.dim === 'channel' && rawDaily[r.date]) rawDaily[r.date][C.channelOf(r.dim_value)] += Number(r.value) || 0;
    const daily = D.rollChannels(rawDaily);
    const chart = U.card({ cls: 'chart-card', title: `${grain} GA4 sessions by channel`, sub: `One bar per ${D.grainBar()} · ${U.win(S.from, S.to)}`, body: C.stacked({ dates: ticks, keys: C.CHANNELS, value: (d, i) => (daily[d] || [])[i] || 0, label: `${grain} GA4 sessions by channel` })
      + '<p class="card-note">GA4 attributes sessions to the channel that started each session. This report does not contain new users by first-user channel, so that attribution is not inferred.</p>' });

    // Collapsed detail tables
    const utmSnap = D.snap('ga4', 'utm_attribution'), utmRows = D.utmRows(), utmCov = D.utmCoverage();
    const F = ['sessions', 'engaged_sessions', 'users', 'key_events'];
    const bySessions = (a, b) => b.sessions - a.sessions;
    const byPeriod = (a, b) => periodIndex.get(a.periodKey) - periodIndex.get(b.periodKey) || bySessions(a, b);
    const latestPeriodRows = (rows, limit) => rows.slice().sort((a, b) => periodIndex.get(b.periodKey) - periodIndex.get(a.periodKey) || bySessions(a, b)).slice(0, limit).sort(byPeriod);
    const utmDated = utmRows.map((row) => { const period = periodFor(row.date); return period ? { ...row, periodKey: period.key, period: period.label } : null; }).filter(Boolean);
    const utm = D.group(utmDated, (r) => [r.periodKey, r.campaign, r.source, r.medium, r.content].join('\u0001'), F)
      .map((r) => { const [periodKey, campaign, source, medium, content] = r.key.split('\u0001'); const period = periods.find((p) => p.key === periodKey); return { ...r, periodKey, period: period ? period.label : '', campaign, source, medium, content }; }).sort(byPeriod);
    const pages = D.group(utmDated, (r) => [r.periodKey, D.path(r.landing_page)].join('\u0001'), F)
      .map((r) => { const [periodKey, page] = r.key.split('\u0001'); const period = periods.find((p) => p.key === periodKey); return { ...r, periodKey, period: period ? period.label : '', page }; }).sort(byPeriod);
    const utmVisible = latestPeriodRows(utm, 100), pageVisible = latestPeriodRows(pages, 100);
    const rateOf = (r) => U.pct(r.sessions ? r.engaged_sessions / r.sessions : null);
    const sumCols = [
      { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Engagement', num: 1, f: rateOf },
      { t: 'Key events', num: 1, f: (r) => U.fmt(r.key_events) },
    ];
    const utmCoverageNote = utmSnap && !(utmSnap.from <= S.from && utmSnap.to >= S.to) ? ' Stored snapshot coverage does not span the full selected range, so some buckets may be partial.' : '';
    // Older loads have no coverage row and were cut at one GA4 page of 1,000 rows.
    const utmCut = utmCov ? utmCov.truncated : utmSnap && (utmSnap.rows || []).length >= 1000;
    const utmNote = `<p class="card-note" style="padding:0 20px 16px">(not set) means the visit arrived without that UTM value. Every ad, post and email should carry utm_source, utm_medium, utm_campaign and utm_content (starting with the persona code pNN).${utmCut ? ' The GA4 report reached its row limit, so the oldest detail may be missing.' : ''}${utmCoverageNote}${utm.length > 100 ? ` Showing the latest 100 of ${U.fmt(utm.length)} campaign-period rows.` : ''}</p>`;
    const crow = periods.flatMap((period) => {
      const countries = {};
      for (const row of D.gaCountries(period.from, period.to)) countries[row.country] = { ...row, periodKey: period.key, period: period.label };
      for (const event of D.forms(period.from, period.to)) if (event.country) {
        countries[event.country] = countries[event.country] || { country: event.country, periodKey: period.key, period: period.label };
        countries[event.country].forms = (countries[event.country].forms || 0) + 1;
      }
      return Object.values(countries);
    }).sort((a, b) => periodIndex.get(a.periodKey) - periodIndex.get(b.periodKey) || (b.sessions || 0) - (a.sessions || 0) || (b.forms || 0) - (a.forms || 0));
    // Deduplicated GA4 visitors per country for the synced window (launch to the last sync). GA4 users cannot be
    // added across days, so this is the only per-country visitor count; it does not follow the date range.
    const countrySnap = D.snap('ga4', 'countries');
    const countryUsers = countrySnap ? (countrySnap.rows || []).filter((r) => Number(r.users) > 0).sort((a, b) => Number(b.users) - Number(a.users)) : [];
    const countryUsersTotal = countryUsers.reduce((s, r) => s + Number(r.users), 0);
    const visitorsByCountry = U.details('Visitors by country since launch (GA4, deduplicated)', countrySnap ? `${U.fmt(countryUsers.length)} countries · ${U.win(countrySnap.from, countrySnap.to)}` : '', countrySnap ? (countryUsers.length ? U.table([
      { t: 'Country', k: 'country' }, { t: 'Visitors', num: 1, f: (r) => U.fmt(Number(r.users)) },
      { t: 'Share', num: 1, f: (r) => U.pct(countryUsersTotal ? Number(r.users) / countryUsersTotal : null) },
      { t: 'Engaged sessions', num: 1, f: (r) => U.fmt(Number(r.engaged_sessions)) }, { t: 'Key events', num: 1, f: (r) => U.fmt(Number(r.key_events)) },
    ], countryUsers.slice(0, 50)) + `<p class="card-note" style="padding:0 20px 16px">Each person counted once per country over the synced window (${U.win(countrySnap.from, countrySnap.to)}), whatever the date range or Group by at the top. Shares are of the visitors with a country; a person seen in two countries counts in both.</p>` : U.empty('No GA4 visitors by country yet')) : U.awaiting('ga4'));
    // HubSpot traffic by its own source labels: a cross-check on GA4 (the goals spec), not the landing number.
    const srcRows = periods.flatMap((period) => {
      const total = D.sessions(period.from, period.to);
      return D.byDim('hubspot', 'sessions', period.from, period.to).map(([k, s]) => {
        const match = (r) => (r.dim_value || 'Total') === k;
        return { periodKey: period.key, period: period.label, k, s, total, pv: D.sum('hubspot', 'pageviews', match, period.from, period.to), b: D.sum('hubspot', 'bounces', match, period.from, period.to), c: D.sum('hubspot', 'contacts', match, period.from, period.to) };
      });
    }).sort((a, b) => periodIndex.get(a.periodKey) - periodIndex.get(b.periodKey) || b.s - a.s);
    const hubspotCheck = U.details('HubSpot sessions by source and period (cross-check)', `${U.fmt(srcRows.length)} source-period rows · ${grain} · whole HubSpot-tracked site`, srcRows.length ? U.table([
      { t: 'Period', f: (r) => U.esc(r.period) },
      { t: 'Source', f: (r) => `<span class="ch-dot" style="--ch:${C.CHANNELS[C.channelOf(r.k)].color};margin-right:8px"></span>${U.esc(r.k)}` },
      { t: 'Sessions', num: 1, f: (r) => U.fmt(r.s) }, { t: 'Share in period', num: 1, f: (r) => U.pct(r.total ? r.s / r.total : null) },
      { t: 'Page views', num: 1, f: (r) => U.fmt(r.pv) }, { t: 'Bounce rate', num: 1, f: (r) => U.pct(r.s ? r.b / r.s : null) }, { t: 'New contacts', num: 1, f: (r) => U.fmt(r.c) },
    ], srcRows.slice(-300)) + periodRowsNote(srcRows.length, 300) + '<p class="card-note" style="padding:0 20px 16px">HubSpot counts every page carrying its tracking code, with no domain filter, so these sessions check GA4 rather than match it; GA4 is the source for landing sessions. New contacts use HubSpot\'s original source: accounts the portal creates in HubSpot show as Offline sources.</p>' : U.awaiting('hubspot'));
    const details = `<div class="detail-group">
      ${channelPeriodDetails}
      ${U.details('UTM campaigns by period (GA4)', utmSnap ? `${U.fmt(utm.length)} campaign-period rows · ${grain} · snapshot ${U.win(utmSnap.from, utmSnap.to)}` : '', utmSnap ? (utm.length ? U.table([
        { t: 'Period', f: (r) => U.esc(r.period) }, { t: 'Campaign', f: (r) => `<code>${U.esc(r.campaign)}</code>` },
        { t: 'Source / medium', f: (r) => `${U.esc(r.source)} / ${U.esc(r.medium)}` },
        { t: 'Piece (utm_content)', f: (r) => { const p = D.persona(r.content); return `<code>${U.esc(r.content)}</code>${p ? ` ${U.pill('info', p)}` : ''}`; } },
        ...sumCols,
      ], utmVisible) + utmNote : U.empty('No GA4 sessions in this period')) : U.awaiting('ga4'))}
      ${U.details('Entry pages by period (GA4)', utmSnap ? `${U.fmt(pages.length)} page-period rows · ${grain}` : '', utmSnap ? (pages.length ? U.table([{ t: 'Period', f: (r) => U.esc(r.period) }, { t: 'Page', f: (r) => `<code>${U.esc(r.page)}</code>` }, ...sumCols], pageVisible) + periodRowsNote(pages.length, 100) : U.empty('No GA4 sessions in this period')) : U.awaiting('ga4'))}
      ${U.details('Countries by period (GA4)', crow.length ? `${U.fmt(crow.length)} country-period rows · ${grain}` : '', crow.length ? U.table([
        { t: 'Period', f: (r) => U.esc(r.period) }, { t: 'Country', k: 'country' }, { t: 'Sessions (GA4)', num: 1, f: (r) => U.fmt(r.sessions) },
        { t: 'Engagement', num: 1, f: rateOf }, { t: 'Key events', num: 1, f: (r) => U.fmt(r.key_events) },
        { t: 'Form sign-ups (HubSpot)', num: 1, f: (r) => U.fmt(r.forms || 0) },
      ], crow.slice(-300)) + periodRowsNote(crow.length, 300) : U.empty('No country data yet', 'GA4 country rows and HubSpot form sign-ups by country appear here once loaded.'))}
      ${visitorsByCountry}
      ${hubspotCheck}
    </div>`;

    return acquired(U, C, D, S)
      + U.section('Traffic to the sites', `${U.win(S.from, S.to)} · GA4 on the landing, portal and main site · KPI values are selected-range totals; changes compare the latest two complete ${grain.toLowerCase()} buckets since launch`, kpis)
      + goals
      + `<section class="section grid-2">${perf}${channelEngagement}</section>`
      + `<section class="section">${chart}</section>`
      + U.section('Details', `Period detail uses ${grain.toLowerCase()} buckets; GA4 unique users are never summed across days`, details);
  }
  A.views.acquisition = { title: 'Acquisition', render };
})(window.App);
