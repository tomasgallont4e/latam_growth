
'use strict';
/* Conversion: from visit to account. KPIs, goals, funnel, daily sign-ups by type, collapsed details. */
(function (A) {
  const EVENT_INFO = {
    form_start: 'Started the sign-up form on the landing', sign_up: 'Submitted the sign-up form', login: 'Clicked log in', generate_lead: 'Lead sent to HubSpot',
    page_view: 'Page view', session_start: 'Session started', user_engagement: 'Page in focus for 1s or more', first_visit: 'First visit of a user', scroll: 'Scrolled 90% of the page',
  };
  function render() {
    const U = A.ui, C = A.charts, D = A.D, S = A.S;
    const prev = D.prev();
    const cmp = prev ? `vs previous ${prev.len} days` : 'Since launch · no comparison';
    const days = U.days(S.from, S.to);
    const all = D.formsAll(), shown = D.forms();
    const form = shown.length, pForm = prev ? D.forms(prev.from, prev.to).length : null;
    const plat = D.platform(), pPlat = prev ? D.platform(prev.from, prev.to) : null;
    const total = form + (plat || 0), pTotal = prev ? pForm + (pPlat || 0) : null;
    const sess = D.sessions(), pSess = prev ? D.sessions(prev.from, prev.to) : null;
    const rate = sess ? total / sess : null, pRate = prev && pSess ? pTotal / pSess : null;
    const su = D.dailySignups();

    const kpis = U.kpiRow([
      U.kpi({ label: 'Total Sign-ups', source: 'HubSpot + PostHog', value: U.fmt(total), hero: true, delta: U.delta(total, pTotal), spark: days.map((d) => su[d].form + su[d].platform), compare: cmp }),
      U.kpi({ label: S.exInt ? 'External Form Sign-ups' : 'Form Sign-ups', source: 'HubSpot', value: U.fmt(form), delta: U.delta(form, pForm), spark: days.map((d) => su[d].form), compare: `${all.length - shown.length} internal tests ${S.exInt ? 'excluded' : 'included'}` }),
      plat != null ? U.kpi({ label: 'Platform Sign-ups', source: 'PostHog', value: U.fmt(plat), delta: U.delta(plat, pPlat), spark: days.map((d) => su[d].platform), compare: 'Accounts created in the product, any entry point' }) : U.kpi({ label: 'Platform Sign-ups', source: 'PostHog', awaiting: 'PostHog' }),
      D.has('hubspot', 'sessions') ? U.kpi({ label: 'Visit-to-Sign-up Rate', source: 'Derived', value: U.pct(rate), delta: U.delta(rate, pRate), compare: `${U.fmt(total)} sign-ups / ${U.fmt(sess)} sessions` }) : U.kpi({ label: 'Visit-to-Sign-up Rate', source: 'Derived', awaiting: 'HubSpot' }),
    ], 4);
    const goals = A.targets.strip(['total_signups', 'platform_signups', 'visit_to_signup_rate']);

    const funnel = U.card({ cls: 'chart-card', title: 'Visit-to-active-account funnel', sub: `Count, % of step 1 and step-to-step % · internal tests ${S.exInt ? 'excluded' : 'included'}`, body: C.funnel(D.funnel()) });
    const keys = [{ name: S.exInt ? 'External form sign-ups' : 'Form sign-ups', color: 'var(--series-a)' }, { name: 'Platform sign-ups', color: 'var(--series-b)' }];
    const chart = U.card({ cls: 'chart-card', title: 'Daily sign-ups by type', sub: `${U.win(S.from, S.to)} · landing form (HubSpot) and platform (PostHog)`, body: C.stacked({ dates: days, keys, value: (d, i) => (i ? su[d].platform : su[d].form), label: 'Daily sign-ups by type' }) });

    const KEY = ['form_start', 'sign_up', 'login', 'generate_lead'];
    const hasEv = D.has('ga4', 'ga_event');
    const evRows = D.gaEvents().sort((a, b) => (KEY.includes(b.event) - KEY.includes(a.event)) || b.count - a.count);
    const PF = ['sessions', 'engaged_sessions', 'users', 'key_events'];
    const utmSnap = D.snap('ga4', 'utm_attribution');
    const gaPages = D.group(D.utmRows(), (r) => D.path(r.landing_page), PF).sort((a, b) => b.sessions - a.sessions).slice(0, 25);
    const sa = D.snap('posthog', 'signup_attribution');
    const saRows = sa ? D.group((sa.rows || []).filter((r) => r.date >= S.from && r.date <= S.to), (r) => [r.campaign, r.source, r.medium, r.content].join('\u0001'), ['people'])
      .map((r) => { const [campaign, source, medium, content] = r.key.split('\u0001'); return { ...r, campaign, source, medium, content }; })
      .sort((a, b) => b.people - a.people) : [];
    const saTagged = saRows.some((r) => r.campaign !== '(not set)' || r.content !== '(not set)');
    const dash = '<span class="text-muted">–</span>';
    const people = D.has('posthog', 'ph_new_persons') ? D.byDay('posthog', 'ph_new_persons') : null;
    const active = D.has('posthog', 'ph_active_users') ? D.byDay('posthog', 'ph_active_users') : {};
    const platRows = people ? Object.keys(people).sort().reverse().map((d) => ({ d, p: people[d] || 0, a: active[d] || 0 })).filter((r) => r.p || r.a) : [];
    const phEvents = D.byDim('posthog', 'ph_event');
    const forms = D.snap('hubspot', 'forms'), hp = D.snap('hubspot', 'pages'), gp = D.snap('ga4', 'pages'), gtm = D.snap('gtm', 'tags');
    const PST = { live: ['success', 'Live'], broken: ['error', 'Check links'], preview: ['info', 'Preview'] };
    const details = `<div class="detail-group">
      ${U.details('Sign-up log', `${shown.length} shown${S.exInt && all.length > shown.length ? ` · ${all.length - shown.length} internal hidden` : ''}`, shown.length ? U.table([
        { t: 'Date', f: (r) => `<span class="mono">${U.dshort(r.date)}</span>` }, { t: 'Form', k: 'form' }, { t: 'Channel', f: (r) => U.esc(r.channel || r.source || '') }, { t: 'Country', k: 'country' },
        { t: 'Campaign', f: (r) => { const c = D.formCampaign(r); return c ? `<code>${U.esc(c)}</code>` : dash; } },
        { t: 'Persona', f: (r) => { const p = D.formPersona(r); return p ? U.pill('info', p) : dash; } },
        { t: 'Type', f: (r) => (r.internal ? U.pill('neutral', 'Internal test') : U.pill('success', 'External')) },
      ], shown.slice().sort((a, b) => (a.date < b.date ? 1 : -1)), (r) => (r.internal ? 'muted' : '')) : U.empty('No external sign-ups in this period', all.length ? `Turn off "Exclude internal tests" to see the ${all.length} test entries.` : ''))}
      ${U.details('Landing events (GA4)', hasEv ? `${evRows.length} events · ${U.win(S.from, S.to)}` : '', hasEv ? (evRows.length ? U.table([
        { t: 'Event', f: (r) => `<code>${U.esc(r.event)}</code>${KEY.includes(r.event) ? ` ${U.pill('info', 'key')}` : ''}<br><small>${U.esc(EVENT_INFO[r.event] || '')}</small>` },
        { t: 'Events', num: 1, f: (r) => U.fmt(r.count) },
      ], evRows) : U.empty('No GA4 events in this period')) : U.awaiting('ga4'))}
      ${U.details('Platform activity (PostHog)', platRows.length ? `${platRows.length} days` : '', people ? (platRows.length ? U.table([
        { t: 'Date', f: (r) => `<span class="mono">${U.dshort(r.d)}</span>` }, { t: 'New people', num: 1, f: (r) => U.fmt(r.p) }, { t: 'Active people', num: 1, f: (r) => U.fmt(r.a) },
      ], platRows) : U.empty('No platform activity in this period')) : U.awaiting('posthog', 'Accounts created, active users and product events will appear here'))}
      ${U.details('Platform sign-ups by campaign and persona (PostHog)', saRows.length ? `${saRows.length} combinations` : '', !sa
        ? (D.has('posthog', 'ph_new_persons') ? U.empty('Appears after the next PostHog sync', 'New accounts grouped by their first-touch UTM.', 'users') : U.awaiting('posthog', 'New accounts by first-touch campaign and persona'))
        : saRows.length ? U.table([
          { t: 'Campaign', f: (r) => `<code>${U.esc(r.campaign)}</code>` },
          { t: 'Source / medium', f: (r) => `${U.esc(r.source)} / ${U.esc(r.medium)}` },
          { t: 'Piece (utm_content)', f: (r) => { const p = D.persona(r.content); return `<code>${U.esc(r.content)}</code>${p ? ` ${U.pill('info', p)}` : ''}`; } },
          { t: 'New accounts', num: 1, f: (r) => U.fmt(r.people) },
        ], saRows.slice(0, 100)) + (saTagged ? '' : '<p class="card-note" style="padding:0 20px 16px">All new accounts in this period arrived without UTMs. Rows fill in once the portal sends the first-touch UTMs in posthog.identify (see docs/utm-measurement.md).</p>')
          : U.empty('No new accounts in this period'))}
      ${phEvents.length ? U.details('Platform events (PostHog)', `${phEvents.length} events`, U.table([{ t: 'Event', f: (r) => `<code>${U.esc(r[0])}</code>` }, { t: 'Occurrences', num: 1, f: (r) => U.fmt(r[1]) }], phEvents)) : ''}
      ${U.details('Forms (HubSpot)', forms ? U.win(forms.from, forms.to) : '', forms ? U.table([
        { t: 'Form', k: 'form' }, { t: 'Type', k: 'type' }, { t: 'Entries', num: 1, f: (r) => U.fmt(r.submissions) }, { t: 'External', num: 1, f: (r) => U.fmt(r.external) }, { t: 'When', k: 'dates' },
      ], forms.rows || []) : U.awaiting('hubspot'))}
      ${utmSnap || hp || gp ? U.details('Landing pages', utmSnap ? `${gaPages.length} pages · ${U.win(S.from, S.to)}` : hp ? U.win(hp.from, hp.to) : '', `${utmSnap ? (gaPages.length ? U.table([
        { t: 'Entry page (GA4)', f: (r) => `<code>${U.esc(r.key)}</code>` }, { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) },
        { t: 'Engagement', num: 1, f: (r) => U.pct(r.sessions ? r.engaged_sessions / r.sessions : null) },
        { t: 'Users (daily sum)', num: 1, f: (r) => U.fmt(r.users) }, { t: 'Key events', num: 1, f: (r) => U.fmt(r.key_events) },
      ], gaPages) : U.empty('No GA4 sessions in this period')) : ''}${hp ? U.table([
        { t: 'Page', f: (r) => `<code>${U.esc(r.page)}</code>` }, { t: 'Views (HubSpot)', num: 1, f: (r) => U.fmt(r.views) },
        { t: 'Status', f: (r) => { const p = PST[r.status] || ['neutral', r.status || '–']; return U.pill(p[0], p[1]); } },
      ], hp.rows || []) : ''}`) : ''}
      ${gtm ? U.details('How the landing events are measured (Tag Manager)', U.win(gtm.from, gtm.to), U.table([
        { t: 'Tag', k: 'tag' }, { t: 'Type', k: 'type' }, { t: 'Fires on', f: (r) => `<code>${U.esc(r.trigger)}</code>` }, { t: 'Sends to', k: 'destination' },
      ], gtm.rows || []) + '<p class="card-note" style="padding:0 20px 16px">Sign-ups through "Sign up with Google" go straight to the platform: only PostHog sees them.</p>') : ''}
    </div>`;

    return U.section('Conversion at a glance', `${U.win(S.from, S.to)} · ${cmp}`, kpis)
      + goals
      + `<section class="section grid-2">${funnel}${chart}</section>`
      + U.section('Details', 'Collapsed tables for analysts', details);
  }
  A.views.conversion = { title: 'Conversion', render };
})(window.App);
