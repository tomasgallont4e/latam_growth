'use strict';
// Goal setter for the LATAM launch: targets per metric, per cadence (calendar month or quarter) and
// per grouping (overall, traffic source, channel, campaign). Goals live as kind "goal" in the store;
// the Goals view computes progress from api/data and colors each tile by pace against the target.
// Goals are created and changed by admins; the values themselves will be set by leadership later.

const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const CADENCES = { monthly: 'Monthly (calendar month)', quarterly: 'Quarterly (calendar quarter)' };

// What a goal can measure. `groupings` lists the breakdowns a goal can be set for; the client offers
// the values it actually sees in the data for the chosen grouping.
const METRICS = {
  landing_sessions: { label: 'Landing sessions', hint: 'HubSpot sessions on the landing, by traffic source', source: 'hubspot', metric: 'sessions', dim: 'source', groupings: ['overall', 'source'] },
  external_signups: { label: 'External sign-ups', hint: 'HubSpot landing form sign-ups, internal tests excluded', kind: 'events', groupings: ['overall', 'channel'] },
  platform_signups: { label: 'Platform sign-ups', hint: 'PostHog new people with an email, any entry point', source: 'posthog', metric: 'ph_new_persons', excludeInternal: true, groupings: ['overall'] },
  ga4_sessions: { label: 'GA4 sessions', hint: 'Google Analytics sessions on /latam, by channel', source: 'ga4', metric: 'ga_sessions', dim: 'channel', groupings: ['overall', 'channel'] },
  ad_spend: { label: 'Ad spend', hint: 'Meta and Google Ads spend, by campaign', sources: ['meta', 'google_ads'], metric: 'ad_spend', dim: 'campaign', groupings: ['overall', 'campaign'] },
};

const GROUP_LABEL = { overall: 'Overall', source: 'Traffic source', channel: 'Channel', campaign: 'Campaign' };

// Window for a cadence: the calendar month or quarter containing today (UTC), with its full length
// so the client can compute the pace (expected value at this point of the window).
function windowOf(cadence, todayStr) {
  const t = todayStr || new Date().toISOString().slice(0, 10);
  const y = +t.slice(0, 4), m = +t.slice(5, 7) - 1;
  let from, end, label;
  if (cadence === 'quarterly') {
    const q = Math.floor(m / 3), fm = q * 3;
    from = iso(y, fm, 1); end = iso(y, fm + 2, lastDay(y, fm + 2)); label = `Q${q + 1} ${y}`;
  } else {
    from = iso(y, m, 1); end = iso(y, m, lastDay(y, m)); label = `${MONTHS[m]} ${y}`;
  }
  const total_days = Math.round((Date.parse(end) - Date.parse(from)) / 864e5) + 1;
  return { from, end, label, total_days };
}

// Color-coded status by pace: met (>= target), on (at or above the expected pace),
// watch (within 15% below pace), behind (further below). Mirrored in the Goals view.
function statusOf(actual, target, elapsedDays, totalDays) {
  const t = Number(target) || 0;
  if (t <= 0) return 'behind';
  const expected = t * Math.min(1, Math.max(elapsedDays, 0) / Math.max(totalDays, 1));
  if (actual >= t) return 'met';
  if (actual >= expected) return 'on';
  if (actual >= expected * 0.85) return 'watch';
  return 'behind';
}

// Validates and normalizes a goal from the request body. Returns { error } or the goal fields.
function clean(body) {
  const b = body || {};
  const metric = METRICS[b.metric];
  if (!metric) return { error: 'Choose what the goal measures.' };
  if (!CADENCES[b.cadence]) return { error: 'Choose a cadence: monthly or quarterly.' };
  const grouping = b.grouping || 'overall';
  if (!metric.groupings.includes(grouping)) return { error: `${metric.label} cannot be set by ${GROUP_LABEL[grouping] || grouping}.` };
  const group = grouping === 'overall' ? '' : String(b.group || '').trim().slice(0, 120);
  if (grouping !== 'overall' && !group) return { error: `Choose the ${GROUP_LABEL[grouping].toLowerCase()} this goal tracks.` };
  const target = Number(b.target);
  if (!Number.isFinite(target) || target <= 0) return { error: 'Set a target above 0.' };
  const name = String(b.name || '').trim().slice(0, 140) || `${metric.label} · ${grouping === 'overall' ? 'overall' : group}`;
  return { name, metric: b.metric, cadence: b.cadence, grouping, group, target, notes: String(b.notes || '').slice(0, 300) };
}

// Example goals so the view opens in a working state. Marked as examples; leadership sets the real ones.
const EXAMPLES = [
  { name: 'EXAMPLE · Landing sessions in the month', metric: 'landing_sessions', cadence: 'monthly', grouping: 'overall', group: '', target: 100, notes: 'Sessions on the landing since the first of the month, every source together.' },
  { name: 'EXAMPLE · External sign-ups in the month', metric: 'external_signups', cadence: 'monthly', grouping: 'overall', group: '', target: 12, notes: 'Form sign-ups excluding internal tests. Zero today: no campaign is sending traffic yet.' },
  { name: 'EXAMPLE · Platform sign-ups in the month', metric: 'platform_signups', cadence: 'monthly', grouping: 'overall', group: '', target: 10, notes: 'New people with an email in the platform, from any entry point.' },
  { name: 'EXAMPLE · GA4 sessions from Direct', metric: 'ga4_sessions', cadence: 'monthly', grouping: 'channel', group: 'Direct', target: 60, notes: 'A goal can track one channel, source or campaign on its own.' },
  { name: 'EXAMPLE · Ad spend for the quarter', metric: 'ad_spend', cadence: 'quarterly', grouping: 'overall', group: '', target: 3000, notes: 'Spend planned for the quarter across Meta and Google Ads. Paces from zero until campaigns run.' },
];

module.exports = { METRICS, CADENCES, GROUP_LABEL, windowOf, statusOf, clean, EXAMPLES };
