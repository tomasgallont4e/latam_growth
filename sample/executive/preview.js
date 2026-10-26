'use strict';

const PAGES = {
  overview: 'Overview',
  marketing: 'Marketing campaigns',
  growth: 'Growth',
  core: 'Core product',
  economics: 'Unit economics',
  targets: 'Targets',
  sources: 'Data sources',
};
const SOURCE_STATE = {
  connected: ['ok', 'Connected'],
  pending: ['warn', 'Access pending'],
  not_started: ['mute', 'Not started'],
};
const SOURCES = [
  {
    key: 'hubspot', name: 'HubSpot', area: 'Landing and CRM', metricSource: 'HubSpot', state: 'connected',
    provides: 'Landing sessions by source and day, UTM campaigns, countries, pages, form entries and contacts',
    last: '2026-10-21', window: '2026-10-15 to 2026-10-21',
    env: ['HUBSPOT_TOKEN'],
    connect: 'Private app token with the scopes crm.objects.contacts.read, forms and business-intelligence, saved as the service variable HUBSPOT_TOKEN.',
  },
  {
    key: 'ga4', name: 'Google Analytics 4', area: 'Landing behaviour', metricSource: 'Google Analytics 4', state: 'connected',
    provides: 'Users, engaged sessions, channels (T4E Channels), countries and landing events: form_start, sign_up, login, generate_lead',
    last: '2026-10-21', window: '2026-10-01 to 2026-10-21',
    env: ['GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT'],
    connect: 'Service account with Viewer access on the property; save the property id as GA4_PROPERTY_ID and the key JSON as GA4_SERVICE_ACCOUNT.',
  },
  {
    key: 'gtm', name: 'Google Tag Manager', area: 'Event definitions', metricSource: '', state: 'connected',
    provides: 'Defines the landing events that Google Analytics records (sign-up, log-in, form start)',
    last: '2026-10-15', window: '2026-10-14 to 2026-10-14',
    env: [],
    connect: 'No data of its own: it feeds Google Analytics. Listed so every event in this dashboard has a documented origin.',
  },
  {
    key: 'posthog', name: 'PostHog', area: 'Platform', metricSource: 'PostHog', state: 'connected',
    provides: 'Accounts created in the platform, activation (first project, first build) and retention',
    last: '2026-10-21', window: '2026-10-01 to 2026-10-21',
    env: ['POSTHOG_HOST', 'POSTHOG_PROJECT_ID', 'POSTHOG_API_KEY'],
    connect: 'Personal API key with read access to the project, saved as POSTHOG_API_KEY, with POSTHOG_HOST and POSTHOG_PROJECT_ID.',
  },
  {
    key: 'clarity', name: 'Microsoft Clarity', area: 'Landing behaviour', metricSource: '', state: 'pending',
    provides: 'Heatmaps, scroll depth, rage and dead clicks, traffic origin',
    last: '', window: '',
    env: ['CLARITY_TOKEN'],
    connect: 'Data export token from the Clarity project settings, saved as CLARITY_TOKEN.',
  },
  {
    key: 'meta', name: 'Meta (Facebook and Instagram)', area: 'Social and paid', metricSource: 'Meta', state: 'pending',
    provides: 'Organic reach and followers, ad spend, impressions, clicks and cost per result by campaign and ad',
    last: '', window: '',
    env: ['META_TOKEN', 'META_AD_ACCOUNT_ID'],
    connect: 'System user token with ads_read, saved as META_TOKEN, and the ad account id as META_AD_ACCOUNT_ID. Exports can also be loaded as CSV.',
  },
  {
    key: 'linkedin', name: 'LinkedIn', area: 'Social and paid', metricSource: 'LinkedIn', state: 'connected',
    provides: 'Page followers, post impressions and engagement; ad spend and clicks once campaigns run',
    last: '2026-10-21', window: '2026-10-20 to 2026-10-21',
    env: ['LINKEDIN_ORG_ID', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REFRESH_TOKEN'],
    connect: 'Community Management API: a LinkedIn developer app linked to the page, with that product approved by LinkedIn, and a token from a page admin. Until the approval, the page analytics export (CSV) can be loaded here.',
  },
  {
    key: 'google_ads', name: 'Google Ads', area: 'Paid', metricSource: 'Google Ads', state: 'not_started',
    provides: 'Spend, clicks and cost per sign-up by campaign',
    last: '', window: '',
    env: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'],
    connect: 'Developer token from the manager account API Center, an OAuth client and a refresh token of a user with access to the ad account. Linking Google Ads to Google Analytics 4 also brings costs into GA4.',
  },
];
const TARGET_VIEWS = [
  { id: 'marketing', label: 'Marketing' },
  { id: 'growth', label: 'Growth' },
  { id: 'core', label: 'Core product' },
  { id: 'economics', label: 'Unit economics' },
];
const TARGET_KEY = 't4e-exec-targets';
const PAGE_LEAD = {
  marketing: 'Paid results use the country a campaign targets. LinkedIn page totals stay app-wide.',
  growth: 'From a landing visit to a new account. Internal tests are excluded. New accounts compare with the previous month.',
  core: 'Who has an open account, who used the product in the last 7 days, and who stopped paying. Split by the account country.',
  economics: 'CAC is ad spend divided by new sign-ups. Spend uses the campaign’s target country. Sign-ups use the account country.',
};
const HERO = ['platform_signups', 'signup_to_paid', 'cac', 'ad_spend', 'activation_rate'];
const CHANNELS = ['Meta', 'LinkedIn', 'Google Ads'];
const CHANNEL_COLOR = { Meta: 'var(--navy-2)', LinkedIn: 'var(--orange)', 'Google Ads': 'var(--navy-3)' };
const PIECES = {
  ctr: ['clicks', 'impressions'],
  cpc: ['ad_spend', 'clicks'],
  cost_per_signup: ['ad_spend', 'paid_signups'],
  engagement_rate: ['engaged', 'ga_sessions'],
  visit_to_signup: ['platform_signups', 'landing_sessions'],
  form_completion: ['form_submits', 'form_starts'],
  activation_rate: ['activated', 'platform_signups'],
  build_rate: ['first_builds', 'activated'],
  signup_to_paid: ['paid_subs', 'platform_signups'],
  cac: ['ad_spend', 'platform_signups'],
  cost_per_paid: ['ad_spend', 'paid_subs'],
  cost_per_activated: ['ad_spend', 'activated'],
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const S = { data: null, page: 'overview', range: 'd30', grain: 'day', selected: new Set(), charts: [], overrides: {}, targetView: 'marketing', targetMonth: '2026-10', targetNote: '', loads: [] };
let tip;

function showTip(e, chartId, dayIndex) {
  const chart = S.charts[chartId];
  if (!chart || !tip) return;
  document.querySelectorAll('svg.chart .hit.on').forEach((el) => el.classList.remove('on'));
  const hit = e.target.closest('.hit');
  if (hit) hit.classList.add('on');
  const day = chart.days[dayIndex];
  const rows = chart.series.map((ser) => {
    const v = ser.values[dayIndex];
    const text = v == null ? '—' : chart.currency ? money(v) : fmt(v);
    return `<div class="tip-row"><i style="background:${ser.color}"></i><span>${esc(ser.name)}</span><b>${esc(text)}</b></div>`;
  }).join('');
  const extra = (chart.extra || []).map((row) => {
    const v = row.values[dayIndex];
    const text = v == null ? '—' : row.rate ? rate(v) : fmt(v);
    return `<div class="tip-row"><span>${esc(row.name)}</span><b>${esc(text)}</b></div>`;
  }).join('');
  let total = '';
  if (chart.stack && chart.series.length > 1) {
    const sum = chart.series.reduce((s, ser) => s + (ser.values[dayIndex] || 0), 0);
    total = `<div class="tip-row total"><span>Total</span><b>${esc(chart.currency ? money(sum) : fmt(sum))}</b></div>`;
  }
  tip.innerHTML = `<div class="tip-date">${esc(day)}</div>${rows}${extra}${total}`;
  tip.hidden = false;
  const margin = 14;
  tip.style.left = `${e.clientX + margin}px`;
  tip.style.top = `${e.clientY + margin}px`;
  const rect = tip.getBoundingClientRect();
  let x = e.clientX + margin;
  let y = e.clientY + margin;
  if (rect.right > window.innerWidth - 8) x = e.clientX - rect.width - margin;
  if (rect.bottom > window.innerHeight - 8) y = e.clientY - rect.height - margin;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
function hideTip() {
  if (!tip) return;
  tip.hidden = true;
  document.querySelectorAll('svg.chart .hit.on').forEach((el) => el.classList.remove('on'));
}

const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const num1 = (n) => {
  const digits = Math.abs(Number(n)) < 10 ? 2 : 1;
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const money = (n) => (Math.abs(n) < 100
  ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : `$${Math.round(n).toLocaleString('en-US')}`);
const rate = (n) => `${(n * 100).toFixed(n < 0.1 && n > 0 ? 1 : 0)}%`;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dshort = (iso) => `${+iso.slice(8)} ${MON[+iso.slice(5, 7) - 1]}`;

// Live data helpers: every request carries the session cookie and the team code (if the classic dashboard stored one).
function api(url, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  try { const code = localStorage.getItem('t4e-growth-code'); if (code) headers['x-team-code'] = code; } catch (err) { /* no stored code */ }
  return fetch(url, Object.assign({}, opts, { headers, credentials: 'same-origin' })).then((r) => {
    if (r.status === 401) { location.assign('login.html'); throw new Error('Session expired. Opening the login page…'); }
    return r;
  });
}
async function persistTargets(message) {
  try {
    const r = await api('api/targets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S.overrides) });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `Targets were not saved (${r.status}).`);
    }
    S.overrides = await r.json();
    S.targetNote = message;
  } catch (err) {
    S.targetNote = err.message;
  }
  render();
}
const CHART_NEED = [
  ['New accounts', 'platform_signups'], ['Paid clicks', 'clicks'], ['Landing sessions', 'landing_sessions'],
  ['Sign-up form', 'form_starts'], ['Impressions', 'impressions'], ['Clicks', 'clicks'], ['Spend', 'ad_spend'],
  ['Customers and active', 'open_accounts'], ['Credits spent', 'avg_credits'], ['CAC', 'cac'], ['Cost per paying', 'cost_per_paid'],
];
function chartNoData(title) {
  const hit = CHART_NEED.find(([prefix]) => String(title).startsWith(prefix));
  const m = hit && metric(hit[1]);
  return m && m.noData ? m.noData : '';
}
function metric(id) { return S.data.metrics.find((m) => m.id === id); }
function allOn() { return S.selected.size === S.data.countries.length; }
function windowIndexes() {
  const days = S.data.days;
  if (!days) return [];
  if (S.range[0] === 'd') {
    const n = Math.min(Number(S.range.slice(1)), days.length);
    const start = days.length - n;
    return Array.from({ length: n }, (_, i) => start + i);
  }
  if (S.range[0] === 'm') {
    const month = S.range.slice(1);
    const idx = [];
    days.forEach((d, i) => { if (d.slice(0, 7) === month) idx.push(i); });
    return idx;
  }
  const year = S.range.slice(1, 5);
  const q = Number(S.range.slice(6));
  const startM = (q - 1) * 3 + 1;
  const allowed = new Set([0, 1, 2].map((k) => `${year}-${String(startM + k).padStart(2, '0')}`));
  const idx = [];
  days.forEach((d, i) => { if (allowed.has(d.slice(0, 7))) idx.push(i); });
  return idx;
}
function windowDays() { return windowIndexes().map((i) => S.data.days[i]); }

function sumArray(arr) { return arr.reduce((s, n) => s + (n || 0), 0); }
function sliceWindow(arr) { return windowIndexes().map((i) => arr[i]); }

function countryTotal(metricId, name) {
  return sumArray(sliceWindow(S.data.series[metricId][name]));
}
function flowTotal(metricId) {
  if (metricId === 'new_accounts') metricId = 'platform_signups';
  if (metricId === 'acq_spend') metricId = 'ad_spend';
  let n = 0;
  for (const name of S.selected) n += countryTotal(metricId, name);
  return n;
}
function fullDaily(metricId) {
  const n = S.data.days.length;
  const out = Array(n).fill(0);
  const id = metricId === 'new_accounts' ? 'platform_signups' : metricId === 'acq_spend' ? 'ad_spend' : metricId;
  for (const name of S.selected) {
    const arr = S.data.series[id][name];
    for (let i = 0; i < n; i++) out[i] += arr[i] || 0;
  }
  return out;
}
function channelDaily(field) {
  const idx = windowIndexes();
  return CHANNELS.map((name) => ({
    name,
    color: CHANNEL_COLOR[name],
    values: idx.map((i) => {
      let n = 0;
      for (const country of S.selected) n += S.data.platformSeries[name][field][country][i] || 0;
      return n;
    }),
  }));
}
function rollingRatio(numId, denId, window) {
  const num = fullDaily(numId);
  const den = fullDaily(denId);
  return windowIndexes().map((i) => {
    const a = Math.max(0, i - window + 1);
    let n = 0, d = 0;
    for (let k = a; k <= i; k++) { n += num[k]; d += den[k]; }
    return d ? n / d : null;
  });
}
function dailyRatio(numId, denId) {
  const num = fullDaily(numId);
  const den = fullDaily(denId);
  return windowIndexes().map((i) => (den[i] ? num[i] / den[i] : null));
}
function endIndex() {
  const idx = windowIndexes();
  return idx.length ? idx[idx.length - 1] : -1;
}
function stock(metricId, index) {
  if (index < 0) return 0;
  let n = 0;
  for (const name of S.selected) n += S.data.series[metricId][name][index] || 0;
  return n;
}
function stockBefore(metricId, index) {
  if (index <= 0) {
    const map = S.data.opening && S.data.opening[metricId];
    if (!map) return 0;
    let n = 0;
    for (const name of S.selected) n += map[name] || 0;
    return n;
  }
  return stock(metricId, index - 1);
}
function sumIdx(metricId, indexes) {
  const id = metricId === 'new_accounts' ? 'platform_signups' : metricId === 'acq_spend' ? 'ad_spend' : metricId;
  let n = 0;
  for (const name of S.selected) {
    const arr = S.data.series[id][name];
    for (const i of indexes) n += arr[i] || 0;
  }
  return n;
}
function indexesForMonth(ym, maxDom) {
  const out = [];
  S.data.days.forEach((d, i) => {
    if (d.slice(0, 7) !== ym) return;
    if (maxDom && Number(d.slice(8)) > maxDom) return;
    out.push(i);
  });
  return out;
}
function monthIsComplete(ym) {
  const idx = indexesForMonth(ym);
  if (!idx.length) return false;
  const lastDom = String(daysInMonth(ym)).padStart(2, '0');
  return S.data.days[idx[0]].endsWith('-01') && S.data.days[idx[idx.length - 1]] === `${ym}-${lastDom}`;
}
function prevMonth(ym) {
  const [y, mo] = ym.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}
function rangeIndexes(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}
function lastNIndexes(n, end) {
  if (end < 0) return [];
  return rangeIndexes(Math.max(0, end - n + 1), end);
}
function share(n, d) { return d ? rate(n / d) : '—'; }
function growthText(pct) {
  const n = Math.round(pct * 100);
  if (n === 0) return '0%';
  return `${n > 0 ? '+' : ''}${n}%`;
}
function growthPill(pct, lower) {
  if (pct == null || !Number.isFinite(pct)) return '<span class="pill mute">—</span>';
  const score = lower ? -pct : pct;
  const cls = score >= 0.1 ? 'beat' : score >= 0 ? 'ok' : score >= -0.1 ? 'warn' : 'bad';
  return `<span class="pill ${cls}">${growthText(pct)}</span>`;
}
function finishGrowth(metricId, currentIdx, priorIdx, labelFor) {
  const prior = sumIdx(metricId, priorIdx);
  const current = sumIdx(metricId, currentIdx);
  if (!prior) return { pct: null, prior, basis: 'No new accounts in the comparison period' };
  return { pct: (current - prior) / prior, prior, basis: labelFor(prior) };
}
function priorIndexes() {
  const currentIdx = windowIndexes();
  if (!currentIdx.length) return { idx: [], reason: 'No days in this period' };
  if (S.range[0] === 'm') {
    const ym = S.range.slice(1);
    const prev = prevMonth(ym);
    const partial = currentIdx.length < daysInMonth(ym);
    if (partial) {
      const maxDom = Math.max(...currentIdx.map((i) => Number(S.data.days[i].slice(8))));
      const priorIdx = indexesForMonth(prev, maxDom);
      if (priorIdx.length < currentIdx.length) return { idx: [], reason: `${monthLabel(prev)} is not complete in this preview` };
      return { idx: priorIdx, reason: '' };
    }
    if (!monthIsComplete(prev)) return { idx: [], reason: `${monthLabel(prev)} is not a complete month in this preview` };
    return { idx: indexesForMonth(prev), reason: '' };
  }
  const n = currentIdx.length;
  const start = currentIdx[0] - n;
  if (start < 0) return { idx: [], reason: 'Not enough earlier days for a comparison' };
  return { idx: rangeIndexes(start, currentIdx[0] - 1), reason: '' };
}
function periodGrowth(metricId) {
  const currentIdx = windowIndexes();
  const prior = priorIndexes();
  if (!currentIdx.length) return { pct: null, basis: 'No days in this period' };
  if (!prior.idx.length) return { pct: null, basis: prior.reason };
  const n = currentIdx.length;
  const labelFor = (count) => {
    if (S.range[0] === 'm') {
      const ym = S.range.slice(1);
      const prevName = prevMonth(ym);
      if (n < daysInMonth(ym)) return `MoM vs ${fmt(count)} on the same days in ${monthLabel(prevName)}`;
      return `MoM vs ${fmt(count)} in ${monthLabel(prevName)}`;
    }
    const mom = S.range === 'd30' || (n >= 28 && n <= 31);
    return mom ? `MoM vs ${fmt(count)} in the previous ${n} days` : `vs ${fmt(count)} in the previous ${n} days`;
  };
  return finishGrowth(metricId, currentIdx, prior.idx, labelFor);
}
function changePct(current, prior) {
  if (current == null || prior == null || !prior) return null;
  return (current - prior) / prior;
}
function ratioMom(numId, denId) {
  const prior = priorIndexes();
  if (!prior.idx.length) return { pct: null, reason: prior.reason };
  const nowN = sumIdx(numId, windowIndexes());
  const nowD = sumIdx(denId, windowIndexes());
  const thenN = sumIdx(numId, prior.idx);
  const thenD = sumIdx(denId, prior.idx);
  return { pct: changePct(nowD ? nowN / nowD : null, thenD ? thenN / thenD : null), reason: prior.reason };
}
function stockMom(metricId) {
  const currentIdx = windowIndexes();
  const prior = priorIndexes();
  if (!currentIdx.length || !prior.idx.length) return { pct: null, reason: prior.reason || 'No days in this period' };
  const now = stock(metricId, currentIdx[currentIdx.length - 1]);
  const then = stock(metricId, prior.idx[prior.idx.length - 1]);
  return { pct: changePct(now, then), reason: prior.reason };
}
function endRatioMom(numId, denId) {
  const currentIdx = windowIndexes();
  const prior = priorIndexes();
  if (!currentIdx.length || !prior.idx.length) return { pct: null, reason: prior.reason || 'No days in this period' };
  const a = currentIdx[currentIdx.length - 1];
  const b = prior.idx[prior.idx.length - 1];
  const nowD = stock(denId, a);
  const thenD = stock(denId, b);
  return { pct: changePct(nowD ? stock(numId, a) / nowD : null, thenD ? stock(numId, b) / thenD : null), reason: prior.reason };
}
function creditsMom() {
  const currentIdx = windowIndexes();
  const prior = priorIndexes();
  if (!currentIdx.length || !prior.idx.length) return { pct: null, reason: prior.reason || 'No days in this period' };
  const avg = (end) => {
    const active = stock('active_7d', end);
    if (!active) return null;
    return sumIdx('credits', lastNIndexes(7, end)) / active;
  };
  return { pct: changePct(avg(currentIdx[currentIdx.length - 1]), avg(prior.idx[prior.idx.length - 1])), reason: prior.reason };
}
function cancelMom() {
  const prior = priorIndexes();
  if (!prior.idx.length) return { pct: null, reason: prior.reason };
  const rateOf = (idx) => {
    const opening = stockBefore('open_accounts', idx[0]);
    return opening ? sumIdx('canceled', idx) / opening : null;
  };
  return { pct: changePct(rateOf(windowIndexes()), rateOf(prior.idx)), reason: prior.reason };
}
function churnRateAt(end) {
  if (end < 0) return null;
  const month = prevMonth(S.data.days[end].slice(0, 7));
  if (!monthIsComplete(month)) return null;
  const baseIdx = indexesForMonth(month).at(-1);
  const base = stock('paying', baseIdx);
  if (!base) return null;
  return sumIdx('churned', rangeIndexes(baseIdx + 1, end)) / base;
}
function churnMom() {
  const currentIdx = windowIndexes();
  const prior = priorIndexes();
  if (!currentIdx.length || !prior.idx.length) return { pct: null, reason: prior.reason || 'No days in this period' };
  return { pct: changePct(churnRateAt(currentIdx[currentIdx.length - 1]), churnRateAt(prior.idx[prior.idx.length - 1])), reason: prior.reason };
}
function fullMonthChurn(ym) {
  const prior = prevMonth(ym);
  if (!monthIsComplete(ym) || !monthIsComplete(prior)) return null;
  const baseIdx = indexesForMonth(prior).at(-1);
  const endIdx = indexesForMonth(ym).at(-1);
  const base = stock('paying', baseIdx);
  if (!base) return null;
  return sumIdx('churned', rangeIndexes(baseIdx + 1, endIdx)) / base;
}
function ltvMom(gp) {
  const info = ltvChurn();
  if (!info.pct || !info.month) return { pct: null, reason: info.reason || 'No complete month of churn' };
  const earlier = fullMonthChurn(prevMonth(info.month));
  if (!earlier) return { pct: null, reason: `${monthLabel(prevMonth(info.month))} has no complete churn month before it` };
  return { pct: changePct(gp / info.pct, gp / earlier), reason: '' };
}
function dayCacMom(end) {
  const day = S.data.days[end];
  const prevDay = `${prevMonth(day.slice(0, 7))}-${day.slice(8)}`;
  const i = S.data.days.indexOf(prevDay);
  if (i < 0) return { pct: null, reason: 'The same day last month is not in this preview' };
  const ratio = (index) => {
    const spend = fullDaily('ad_spend')[index];
    const signups = fullDaily('platform_signups')[index];
    return spend && signups ? spend / signups : null;
  };
  return { pct: changePct(ratio(end), ratio(i)), reason: '' };
}
function cancellationSnapshot() {
  const idx = windowIndexes();
  if (!idx.length) return { pct: null, canceled: 0, opening: 0 };
  const opening = stockBefore('open_accounts', idx[0]);
  const canceled = sumIdx('canceled', idx);
  return { canceled, opening, pct: opening ? canceled / opening : null };
}
function churnSnapshot() {
  const end = endIndex();
  if (end < 0) return { pct: null, lost: null, base: null, asOf: null, month: null, reason: 'No days in this period' };
  const asOf = S.data.days[end];
  const month = prevMonth(asOf.slice(0, 7));
  if (!monthIsComplete(month)) {
    return { pct: null, lost: null, base: null, asOf, month, reason: `${monthLabel(month)} is not a complete month in this preview` };
  }
  const baseIdx = indexesForMonth(month).at(-1);
  const lost = sumIdx('churned', rangeIndexes(baseIdx + 1, end));
  const base = stock('paying', baseIdx);
  return { pct: base ? lost / base : null, lost, base, asOf, month, reason: '' };
}
function churnTargetScale() {
  const end = endIndex();
  if (end < 0) return null;
  const asOf = S.data.days[end];
  return Number(asOf.slice(8)) / daysInMonth(asOf.slice(0, 7));
}
function ltvChurn() {
  const end = endIndex();
  if (end < 0) return { pct: null, reason: 'No days in this period' };
  const endMonth = S.data.days[end].slice(0, 7);
  const month = monthIsComplete(endMonth) ? endMonth : prevMonth(endMonth);
  if (!monthIsComplete(month)) return { pct: null, month, reason: 'No complete month of churn in this preview' };
  const prior = prevMonth(month);
  if (!monthIsComplete(prior)) return { pct: null, month, reason: `${monthLabel(prior)} is not a complete month in this preview` };
  const baseIdx = indexesForMonth(prior).at(-1);
  const endIdx = indexesForMonth(month).at(-1);
  const base = stock('paying', baseIdx);
  const lost = sumIdx('churned', rangeIndexes(baseIdx + 1, endIdx));
  return { pct: base ? lost / base : null, month, lost, base, reason: '' };
}
function snapshotValue(m, monthly) {
  if (m.id === 'activity_rate') {
    const end = endIndex();
    const base = stock('open_accounts', end);
    const num = stock('active_7d', end);
    return { target: monthly, actual: base ? num / base : null, number: num, base, global: false };
  }
  if (m.id === 'project_rate') {
    const end = endIndex();
    const base = stock('open_accounts', end);
    const num = stock('with_project', end);
    return { target: monthly, actual: base ? num / base : null, number: num, base, global: false };
  }
  if (m.id === 'avg_projects') {
    const end = endIndex();
    const base = stock('open_accounts', end);
    const num = stock('project_count', end);
    return { target: monthly, actual: base ? num / base : null, number: num, base, global: false };
  }
  if (m.id === 'avg_credits') {
    const end = endIndex();
    const base = stock('active_7d', end);
    const num = sumIdx('credits', lastNIndexes(7, end));
    return { target: monthly, actual: base ? num / base : null, number: num, base, global: false };
  }
  if (m.id === 'cancellation_rate') {
    const snap = cancellationSnapshot();
    const days = windowIndexes().length;
    const factor = S.range[0] === 'm' ? days / daysInMonth(S.range.slice(1)) : days / 30;
    return { target: monthly == null ? null : monthly * factor, actual: snap.pct, number: snap.canceled, base: snap.opening, global: false };
  }
  const snap = churnSnapshot();
  const scale = churnTargetScale();
  return { target: monthly == null || scale == null ? null : monthly * scale, actual: snap.pct, number: snap.lost, base: snap.base, global: false };
}

function valueOf(m) {
  const target = periodTarget(m);
  if (m.noData) return { target, actual: null, global: m.split === 'No' };
  if (m.id === 'retention') return { target: null, actual: null, global: false };
  if (m.id === 'activity_rate' || m.id === 'project_rate' || m.id === 'avg_projects' || m.id === 'avg_credits' || m.id === 'cancellation_rate' || m.id === 'churn_rate') {
    return snapshotValue(m, target);
  }
  if (m.split === 'No') {
    const g = S.data.globalSeries;
    if (m.id === 'li_engagement') {
      const imps = sumArray(sliceWindow(g.li_impressions));
      const eng = sumArray(sliceWindow(g.li_engagements));
      const actual = imps ? eng / imps : null;
      return { target, actual, number: actual, global: true };
    }
    const key = m.id === 'li_impressions' ? 'li_impressions' : 'li_followers';
    return { target, actual: sumArray(sliceWindow(g[key])), global: true };
  }
  if (m.id === 'campaigns') {
    let actual = 0;
    for (const [country, count] of Object.entries(S.data.campaignCounts)) {
      if (S.selected.has(country) && countryTotal('ad_spend', country) > 0) actual += count;
    }
    return { target, actual, global: false };
  }
  if (m.id === 'mau') {
    const vals = sliceWindow(fullDaily('dau'));
    return { target, actual: vals.length ? Math.max(...vals) : null, global: false };
  }
  if (m.point && S.data.series[m.id]) {
    return { target, actual: stock(m.id, endIndex()), global: false };
  }
  if (PIECES[m.id]) {
    const [num, den] = PIECES[m.id].map(flowTotal);
    return { target, actual: den ? num / den : null, number: num, base: den, global: false };
  }
  return { target, actual: flowTotal(m.id), global: false };
}

function daysInMonth(ym) {
  const [y, mo] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}
function monthLabel(ym) {
  const [y, mo] = ym.split('-').map(Number);
  return `${MON[mo - 1]} ${y}`;
}
function effectiveTarget(month, id) {
  if (S.overrides[month] && S.overrides[month][id] != null) return S.overrides[month][id];
  if (S.data.targets[month] && S.data.targets[month][id] != null) return S.data.targets[month][id];
  return S.data.monthTarget[id] == null ? null : S.data.monthTarget[id];
}
function weightedRateTarget(id, days) {
  const counts = {};
  for (const d of days) {
    const ym = d.slice(0, 7);
    counts[ym] = (counts[ym] || 0) + 1;
  }
  let total = 0;
  let n = 0;
  for (const [ym, c] of Object.entries(counts)) {
    const base = effectiveTarget(ym, id);
    if (base == null) continue;
    total += base * c;
    n += c;
  }
  return n ? total / n : null;
}
function periodTarget(m) {
  const days = windowDays();
  if (!days.length) return null;
  const endMonth = days[days.length - 1].slice(0, 7);
  const monthKey = S.range[0] === 'm' ? S.range.slice(1) : endMonth;
  if (m.unit === 'rate' || m.ratio) return weightedRateTarget(m.id, days);
  if (m.point || m.id === 'campaigns') return effectiveTarget(monthKey, m.id);
  if (S.range[0] === 'm') return effectiveTarget(S.range.slice(1), m.id);
  const counts = {};
  for (const d of days) {
    const ym = d.slice(0, 7);
    counts[ym] = (counts[ym] || 0) + 1;
  }
  let total = 0;
  let any = false;
  for (const [ym, n] of Object.entries(counts)) {
    const base = effectiveTarget(ym, m.id);
    if (base == null) continue;
    any = true;
    total += base * (n / 30);
  }
  return any ? total : null;
}
function periodInfo() {
  const days = windowDays();
  const range = days.length ? `${dshort(days[0])} to ${dshort(days[days.length - 1])}` : 'No days in this preview';
  if (S.range[0] === 'd') {
    const n = Number(S.range.slice(1));
    return { label: `Last ${n} days`, range, note: 'Count and money targets use each month’s goal for the days in this range. Rates and costs per result stay the monthly figure.' };
  }
  if (S.range[0] === 'm') {
    const ym = S.range.slice(1);
    const dim = daysInMonth(ym);
    const partial = days.length < dim;
    return { label: monthLabel(ym), range, note: partial ? `${days.length} of ${dim} days are in this preview. The target is the full month.` : 'The target is this month’s goal.' };
  }
  const year = S.range.slice(1, 5);
  const q = S.range.slice(6);
  return { label: `Q${q} ${year}`, range, note: 'Count and money targets use each month’s goal for the days of that month in this quarter. Rates and costs per result stay the monthly figure.' };
}

function completion(m, v) {
  if (v.actual == null || v.target == null || v.target === 0) return null;
  if (m.direction === 'lower') return v.actual === 0 ? null : v.target / v.actual;
  return v.actual / v.target;
}
function tone(m, pct) {
  if (pct == null) return 'mute';
  if (m.direction === 'budget') {
    const gap = Math.abs(pct - 1);
    if (gap <= 0.1) return 'ok';
    if (gap <= 0.2) return 'warn';
    return 'bad';
  }
  if (pct >= 1.1) return 'beat';
  if (pct >= 1) return 'ok';
  if (pct >= 0.9) return 'warn';
  return 'bad';
}
function display(m, n) {
  if (m.unit === 'currency') return money(n);
  if (m.unit === 'rate') return rate(n);
  if (m.unit === 'decimal') return num1(n);
  return fmt(n);
}
function figure(m, v) {
  if (v.actual == null) {
    if (m.id === 'retention') return { main: '—', sub: 'Not in this preview' };
    return { main: '—', sub: '' };
  }
  if (m.id === 'signup_to_paid') return { main: `${fmt(v.number)} of ${fmt(v.base)}`, sub: 'paid of sign-ups' };
  if (m.unit === 'rate') return { main: `${rate(v.actual)} of ${rate(v.target)}`, sub: 'actual of target rate' };
  const sub = m.direction === 'budget' ? 'of budget for this period' : 'of target for this period';
  return { main: `${display(m, v.actual)} of ${display(m, v.target)}`, sub };
}
function pill(m, v) {
  const pct = completion(m, v);
  if (pct == null) return '<span class="pill mute">—</span>';
  return `<span class="pill ${tone(m, pct)}">${Math.round(pct * 100)}%</span>`;
}
function bar(m, v) {
  const pct = completion(m, v);
  if (pct == null) return '<span class="track"></span>';
  const width = Math.max(2, Math.min(100, pct * 100));
  return `<span class="track ${pct > 1 ? 'over' : ''}"><i style="width:${width}%"></i></span>`;
}

function axisMax(max) {
  if (max <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const step = pow * (n > 5 ? 2 : n > 2 ? 1 : 0.5);
  return { max: Math.ceil(max / step) * step, step };
}
function axisText(n, currency) {
  if (currency) return n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return fmt(n);
}

function grainKey(day) {
  if (S.grain === 'month') return day.slice(0, 7);
  if (S.grain !== 'week') return day;
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}
function chartBuckets(days) {
  const buckets = [];
  days.forEach((day, i) => {
    const key = grainKey(day);
    const last = buckets[buckets.length - 1];
    if (!last || last.key !== key) buckets.push({ key, start: day, end: day, indexes: [i] });
    else { last.end = day; last.indexes.push(i); }
  });
  return buckets;
}
function bucketLabel(bucket) {
  if (S.grain === 'month') return MON[Number(bucket.start.slice(5, 7)) - 1];
  return dshort(bucket.start);
}
function bucketTip(bucket) {
  if (bucket.start === bucket.end) return dshort(bucket.start);
  return `${dshort(bucket.start)} – ${dshort(bucket.end)}`;
}
function sumIndexes(arr, indexes) {
  let n = 0;
  for (const i of indexes) n += arr[i] || 0;
  return n;
}
function collapseValue(ser, bucket) {
  if (ser.ratio) {
    if (S.grain === 'day' && ser.rolling) {
      const v = ser.values[bucket.indexes[0]];
      return v == null ? null : v;
    }
    const den = sumIndexes(ser.den, bucket.indexes);
    return den ? sumIndexes(ser.num, bucket.indexes) / den : null;
  }
  if (ser.agg === 'last') return ser.values[bucket.indexes[bucket.indexes.length - 1]];
  let any = false;
  let n = 0;
  for (const i of bucket.indexes) {
    const v = ser.values[i];
    if (v == null) continue;
    any = true;
    n += v;
  }
  return any ? n : null;
}
function chartControls() {
  const word = S.grain === 'week' ? 'week' : S.grain === 'month' ? 'month' : 'day';
  const hint = S.grain === 'week'
    ? 'Each bar is a week starting Monday. A week at the edge of the range includes only the days in view.'
    : S.grain === 'month'
      ? 'Each bar is a calendar month, limited to the days in view. Counts add up. A level, such as customers, is the last day of that month.'
      : 'Each bar is one day.';
  const buttons = [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']].map(([id, label]) => (
    `<button type="button" data-grain="${id}" class="${S.grain === id ? 'active' : ''}" aria-pressed="${S.grain === id}">${label}</button>`
  )).join('');
  return `<div class="grain"><span>Chart view</span><div class="view-picks" role="group" aria-label="Chart view">${buttons}</div><p class="footnote">Showing one ${word}. ${hint} Rates are recalculated from the totals in that ${word}.</p></div>`;
}
function byGrain(name) {
  const word = S.grain === 'week' ? 'week' : S.grain === 'month' ? 'month' : 'day';
  return `${name} by ${word}`;
}
function drawChart({ title, note, summary, series, stack, currency, extra }) {
  const missing = chartNoData(title);
  if (missing) {
    return `<section class="card"><h2>${esc(title)}</h2><p class="lead">${esc(note)}</p><div class="empty">${esc(missing)}</div></section>`;
  }
  const buckets = chartBuckets(windowDays());
  const labels = buckets.map(bucketLabel);
  const days = buckets.map(bucketTip);
  series = series.map((ser) => ({ name: ser.name, color: ser.color, values: buckets.map((b) => collapseValue(ser, b)) }));
  extra = (extra || []).map((row) => ({
    name: row.name,
    rate: !!row.rate,
    values: buckets.map((b) => collapseValue(row.num ? { ratio: true, num: row.num, den: row.den } : row, b)),
  }));
  const id = S.charts.length;
  S.charts.push({ days, series, currency: !!currency, stack: !!stack, extra: extra.length ? extra : null });
  const W = 760, H = 228, L = 46, R = 10, T = 14, B = 196;
  const totals = days.map((_, i) => series.reduce((s, ser) => s + (ser.values[i] || 0), 0));
  const peak = stack
    ? Math.max(0, ...totals)
    : Math.max(0, ...series.flatMap((ser) => ser.values.map((v) => v || 0)));
  const axis = axisMax(peak || 1);
  const y = (v) => B - (v / axis.max) * (B - T);
  const step = (W - L - R) / days.length;
  const bw = Math.max(1.5, step * 0.7);
  let g = '';
  for (let t = 0; t <= axis.max + 1e-9; t += axis.step) {
    g += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${axisText(t, currency)}</text>`;
  }
  const every = Math.ceil(days.length / 8);
  if (stack) {
    days.forEach((d, i) => {
      const x = L + i * step + (step - bw) / 2;
      let acc = 0;
      for (const ser of series) {
        const v = ser.values[i] || 0;
        if (!v) continue;
        g += `<rect x="${x.toFixed(2)}" y="${y(acc + v).toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(0, y(acc) - y(acc + v)).toFixed(2)}" style="fill:${ser.color}"/>`;
        acc += v;
      }
      if (i % every === 0) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${B + 16}" text-anchor="middle">${esc(labels[i])}</text>`;
    });
  } else {
    series.forEach((ser) => {
      let run = [];
      const flush = () => {
        if (run.length < 2) { run = []; return; }
        const pts = run.map(([x, yy]) => `${x.toFixed(1)},${yy.toFixed(1)}`).join(' ');
        g += `<polyline points="${pts}" style="fill:none;stroke:${ser.color};stroke-width:2"/>`;
        run = [];
      };
      days.forEach((d, i) => {
        const v = ser.values[i];
        const x = L + i * step + step / 2;
        if (v == null) { flush(); return; }
        run.push([x, y(v)]);
        g += `<circle cx="${x.toFixed(1)}" cy="${y(v).toFixed(1)}" r="${days.length > 40 ? 0 : 2.5}" style="fill:${ser.color}"/>`;
        if (i % every === 0 && ser === series[0]) g += `<text x="${x.toFixed(1)}" y="${B + 16}" text-anchor="middle">${esc(labels[i])}</text>`;
      });
      flush();
    });
  }
  days.forEach((d, i) => {
    const x = L + i * step;
    g += `<rect class="hit" data-chart="${id}" data-i="${i}" x="${x.toFixed(2)}" y="${T}" width="${step.toFixed(2)}" height="${(B - T).toFixed(2)}"/>`;
  });
  const legend = series.map((ser) => `<span><i style="background:${ser.color}"></i>${esc(ser.name)}</span>`).join('');
  return `<section class="card"><h2>${esc(title)}</h2><p class="lead">${esc(note)}</p>${summary || ''}<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${g}</svg></div><div class="legend">${legend}</div></section>`;
}

function signupSeries() {
  return [{ name: 'External sign-ups', color: 'var(--navy-2)', values: sliceWindow(fullDaily('platform_signups')) }];
}
function sessionSeries() {
  return [{ name: 'Landing sessions', color: 'var(--navy-2)', values: sliceWindow(fullDaily('landing_sessions')) }];
}
function formPack() {
  const starts = sliceWindow(fullDaily('form_starts'));
  const done = sliceWindow(fullDaily('form_submits'));
  return {
    series: [
      { name: 'Form started', color: 'var(--navy-2)', values: starts },
      { name: 'Form completed', color: 'var(--orange)', values: done },
    ],
    extra: [{ name: 'Completion', num: done, den: starts, rate: true }],
  };
}
function accountsNote() {
  const g = periodGrowth('platform_signups');
  const cmp = g.pct == null ? g.basis : `${growthText(g.pct)} · ${g.basis}`;
  const word = S.grain === 'week' ? 'week' : S.grain === 'month' ? 'month' : 'day';
  return `New accounts created each ${word}. ${cmp}`;
}

function chartsFor(page) {
  const word = S.grain === 'week' ? 'week' : S.grain === 'month' ? 'month' : 'day';
  const span = `${windowDays().length} days`;
  let body = '';
  if (page === 'overview' || page === 'growth') {
    const blocks = [
      drawChart({
        title: byGrain('New accounts'),
        note: page === 'growth' ? accountsNote() : `New external accounts each ${word} · ${span}`,
        series: signupSeries(),
        stack: true,
      }),
    ];
    if (page === 'overview') {
      blocks.push(drawChart({ title: byGrain('Paid clicks'), note: 'Clicks from Meta, LinkedIn, and Google Ads.', series: channelDaily('clicks'), stack: true }));
    } else {
      const form = formPack();
      blocks.unshift(drawChart({ title: byGrain('Landing sessions'), note: `Visits to the landing · ${span}`, series: sessionSeries(), stack: true }));
      blocks.push(drawChart({
        title: byGrain('Sign-up form'),
        note: `Form started and form completed. Hover a ${word} for its completion rate.`,
        series: form.series,
        extra: form.extra,
        stack: false,
      }));
    }
    body = blocks.join('');
  } else if (page === 'marketing') {
    body = [
      drawChart({ title: byGrain('Impressions'), note: `Hover a ${word} to see impressions on each channel.`, series: channelDaily('impressions'), stack: true }),
      drawChart({ title: byGrain('Clicks'), note: `Hover a ${word} to see which channel those clicks came from.`, series: channelDaily('clicks'), stack: true }),
      drawChart({ title: byGrain('Spend'), note: `Hover a ${word} to see the dollars spent on each channel.`, series: channelDaily('ad_spend'), stack: true, currency: true }),
    ].join('');
  } else if (page === 'core') {
    body = [
      drawChart({
        title: 'Customers and active customers',
        note: `Open accounts at the end of each ${word}, and customers who used the app in the 7 days ending that date · ${span}`,
        series: [
          { name: 'Customers', color: 'var(--navy-2)', values: sliceWindow(fullDaily('open_accounts')), agg: 'last' },
          { name: 'Active, last 7 days', color: 'var(--orange)', values: sliceWindow(fullDaily('active_7d')), agg: 'last' },
        ],
        stack: false,
      }),
      drawChart({ title: byGrain('New accounts'), note: `External accounts created each ${word}.`, series: signupSeries(), stack: true }),
      drawChart({ title: byGrain('Credits spent'), note: `Credits used in the product each ${word}.`, series: [{ name: 'Credits', color: 'var(--navy-2)', values: sliceWindow(fullDaily('credits')) }], stack: true }),
    ].join('');
  } else if (page === 'economics') {
    const unit = word === 'day' ? 'that day' : `that ${word}`;
    body = [
      drawChart({
        title: S.grain === 'day' ? 'CAC by day' : `CAC each ${word}`,
        note: `Ad spend ${unit} divided by new sign-ups ${unit}. A gap means no new sign-ups.`,
        series: [{ name: 'CAC', color: 'var(--navy-2)', ratio: true, num: sliceWindow(fullDaily('ad_spend')), den: sliceWindow(fullDaily('platform_signups')) }],
        stack: false,
        currency: true,
      }),
      drawChart({
        title: word === 'day' ? 'Cost per paying customer, trailing 7 days' : `Cost per paying customer each ${word}`,
        note: word === 'day'
          ? 'Spend over the last 7 days divided by new paid subscriptions in those days. A gap means no new subscriber in the window.'
          : `Ad spend in that ${word} divided by new paid subscriptions in that ${word}. A gap means no new subscriber.`,
        series: [{
          name: 'Cost per paying customer',
          color: 'var(--orange)',
          ratio: true,
          rolling: 7,
          values: rollingRatio('ad_spend', 'paid_subs', 7),
          num: sliceWindow(fullDaily('ad_spend')),
          den: sliceWindow(fullDaily('paid_subs')),
        }],
        stack: false,
        currency: true,
      }),
    ].join('');
  }
  return body ? `${chartControls()}${body}` : '';
}

function noSpend(m) {
  return (m.id === 'cac' || m.id === 'cpc' || m.id === 'cost_per_signup' || m.id === 'cost_per_paid' || m.id === 'cost_per_activated') && flowTotal('ad_spend') === 0;
}
function row(m) {
  const v = valueOf(m);
  const empty = noSpend(m);
  const f = empty ? { main: '—', sub: 'No campaign spend in this selection' } : figure(m, v);
  const tag = v.global && !allOn() ? '<span class="tag">All countries</span>' : '';
  return `<div class="row">
    <div><span class="name">${esc(m.name)}${tag}</span><span class="def">${esc(m.definition)}</span></div>
    <div class="figure">${esc(f.main)}<small>${esc(f.sub)}</small></div>
    ${bar(m, empty ? { actual: null } : v)}
    ${empty ? '<span class="pill mute">—</span>' : pill(m, v)}
  </div>`;
}
function goalStatus(m, v) {
  const pct = completion(m, v);
  if (pct == null) return { cls: 'mute', pctText: '—', label: '' };
  if (m.direction === 'budget') {
    const gap = Math.abs(pct - 1);
    if (gap <= 0.1) return { cls: 'ok', pctText: `${Math.round(pct * 100)}%`, label: 'Goal met' };
    if (gap <= 0.2) return { cls: 'warn', pctText: `${Math.round(pct * 100)}%`, label: 'Goal not met' };
    return { cls: 'bad', pctText: `${Math.round(pct * 100)}%`, label: 'Goal not met' };
  }
  if (pct >= 1.1) return { cls: 'beat', pctText: `${Math.round(pct * 100)}%`, label: 'Goal stretch' };
  if (pct >= 1) return { cls: 'ok', pctText: `${Math.round(pct * 100)}%`, label: 'Goal met' };
  if (pct >= 0.9) return { cls: 'warn', pctText: `${Math.round(pct * 100)}%`, label: 'Goal not met' };
  return { cls: 'bad', pctText: `${Math.round(pct * 100)}%`, label: 'Goal not met' };
}
function goalLine(m, v) {
  const g = goalStatus(m, v);
  const name = g.label ? `<span class="goal-name ${g.cls}">${esc(g.label)}</span>` : '';
  return `<span class="goal"><span class="pill ${g.cls}">${esc(g.pctText)}</span>${name}</span>`;
}
function changeLabel() {
  const n = windowIndexes().length;
  if (S.range[0] === 'm' || S.range === 'd30' || (n >= 28 && n <= 31)) return 'MoM';
  return n ? `vs prior ${n} days` : 'MoM';
}
function momLine(result, sense, label) {
  const pct = result && typeof result === 'object' ? result.pct : result;
  const reason = result && typeof result === 'object' ? result.reason : '';
  const word = label || changeLabel();
  if (pct == null || !Number.isFinite(pct)) {
    return `<span class="mom mute" title="${esc(reason || 'Not enough earlier days to compare with the previous period.')}">— ${esc(word)}</span>`;
  }
  let cls = 'mute';
  if (sense !== 'flat') {
    const score = sense === 'lower' ? -pct : pct;
    cls = score >= 0.1 ? 'beat' : score >= 0 ? 'ok' : score >= -0.1 ? 'warn' : 'bad';
  }
  return `<span class="mom ${cls}">${esc(growthText(pct))} ${esc(word)}</span>`;
}
function noDataCard(label, m) {
  return metricCard({ label, value: '—', flow: m.noData, goal: '<span class="goal"><span class="pill mute">No data yet</span></span>', mom: '' });
}
function metricCard({ label, value, flow, goal, mom }) {
  return `<div class="kpi"><span class="lbl">${esc(label)}</span><span class="val">${esc(value)}</span><span class="sub">${esc(flow)}</span>${goal}${mom}</div>`;
}
function metricKey() {
  return `<p class="key"><b>How to read each metric.</b> The large number is the result for this period. The line under it is that step’s share of the flow. The colored percent divides the result by its goal. A count is divided by the count goal. A rate, such as form completion, is divided by the rate goal, so 36% against a 35% goal reads 102%. <span class="goal-name ok">Goal met</span> is 100% or more. <span class="goal-name beat">Goal stretch</span> is 110% or more. <span class="goal-name warn">Goal not met</span> in amber is under the goal but within 10%. <span class="goal-name bad">Goal not met</span> in red is further below. Spend that stays within 10% of its budget is Goal met. The last line is how much the large number rose or fell versus the previous month. A shorter range compares the previous stretch of the same length.</p>`;
}
function senseOf(m) {
  if (!m) return 'higher';
  if (m.direction === 'lower') return 'lower';
  if (m.direction === 'budget') return 'flat';
  return 'higher';
}
function momForFlow(metricId, sense) {
  const prior = priorIndexes();
  if (!prior.idx.length) return momLine({ pct: null, reason: prior.reason }, sense);
  const current = sumIdx(metricId, windowIndexes());
  const before = sumIdx(metricId, prior.idx);
  if (!before) return momLine({ pct: null, reason: 'Nothing in the previous period' }, sense);
  return momLine({ pct: (current - before) / before }, sense);
}
function hero(id) {
  const m = metric(id);
  if (m.noData) return noDataCard(m.name, m);
  const v = valueOf(m);
  const empty = noSpend(m);
  if (empty || v.actual == null) {
    return metricCard({
      label: m.name,
      value: '—',
      flow: empty ? 'No campaign spend in this selection' : 'No result in this period',
      goal: goalLine(m, { actual: null, target: null }),
      mom: momLine(null, senseOf(m)),
    });
  }
  let flow = '';
  if (id === 'platform_signups') flow = `${share(v.actual, flowTotal('landing_sessions'))} of landing sessions`;
  else if (id === 'signup_to_paid') flow = `${fmt(v.number)} of ${fmt(v.base)} sign-ups`;
  else if (id === 'cac') flow = 'Ad spend ÷ new sign-ups';
  else if (id === 'ad_spend') flow = 'Start of paid results';
  else if (id === 'activation_rate') flow = `${fmt(v.number)} of ${fmt(v.base)} new accounts`;
  const value = m.unit === 'currency' ? money(v.actual) : m.unit === 'rate' ? rate(v.actual) : fmt(v.actual);
  const mom = PIECES[id] ? momLine(ratioMom(PIECES[id][0], PIECES[id][1]), senseOf(m)) : momForFlow(id, senseOf(m));
  return metricCard({ label: m.name, value, flow, goal: goalLine(m, v), mom });
}

function flowCard(label, metricId, value, flow, goalId) {
  const m = metric(metricId);
  if (m.noData) return noDataCard(label, m);
  const judged = metric(goalId || metricId);
  const v = valueOf(judged);
  const empty = noSpend(m);
  return metricCard({
    label,
    value: empty ? '—' : value,
    flow: empty ? 'No campaign spend in this selection' : flow,
    goal: goalLine(judged, empty || v.actual == null ? { actual: null, target: null } : v),
    mom: momForFlow(metricId, senseOf(m)),
  });
}
function openGoal() {
  return '<span class="goal"><span class="pill mute">—</span></span>';
}

function marketingCards() {
  const spend = flowTotal('ad_spend');
  const imps = flowTotal('impressions');
  const clicks = flowTotal('clicks');
  const sessions = flowTotal('paid_sessions');
  const signups = flowTotal('paid_signups');
  const campaigns = valueOf(metric('campaigns'));
  const running = campaigns.actual ? `${fmt(campaigns.actual)} campaigns spent money in this selection.` : 'No campaign spent money in this selection.';
  const cards = [
    flowCard('Ad spend', 'ad_spend', money(spend), 'Start of the funnel'),
    flowCard('Impressions', 'impressions', fmt(imps), 'Paid impressions'),
    flowCard('Clicks', 'clicks', fmt(clicks), imps ? `${share(clicks, imps)} of impressions` : 'No impressions'),
    flowCard('Paid sessions', 'paid_sessions', fmt(sessions), clicks ? `${share(sessions, clicks)} of clicks` : 'No clicks'),
    flowCard('Paid sign-ups', 'paid_signups', fmt(signups), sessions ? `${share(signups, sessions)} of paid sessions` : 'No paid sessions'),
  ].join('');
  return `<section class="kpis" aria-label="Marketing funnel">${cards}</section><p class="footnote">${esc(running)} Spend, impressions, and clicks use the country a campaign targets.</p>`;
}

function channelWindowTotals() {
  const fields = ['ad_spend', 'impressions', 'clicks', 'paid_sessions', 'paid_signups'];
  const idx = windowIndexes();
  return CHANNELS.map((name) => {
    const row = { name, color: CHANNEL_COLOR[name] };
    for (const field of fields) {
      let n = 0;
      const series = S.data.platformSeries[name][field];
      for (const country of S.selected) {
        const arr = series[country];
        for (const i of idx) n += arr[i] || 0;
      }
      row[field] = n;
    }
    row.ctr = row.impressions ? row.clicks / row.impressions : null;
    row.cpc = row.clicks ? row.ad_spend / row.clicks : null;
    row.cps = row.paid_signups ? row.ad_spend / row.paid_signups : null;
    row.clickToSignup = row.clicks ? row.paid_signups / row.clicks : null;
    return row;
  });
}

function channelRead(rows) {
  const mostImps = rows.reduce((a, b) => (b.impressions > a.impressions ? b : a));
  const mostClicks = rows.reduce((a, b) => (b.clicks > a.clicks ? b : a));
  if (!mostImps.impressions) return 'No paid impressions in this selection.';
  const bestCtr = rows.filter((r) => r.ctr != null).reduce((a, b) => (b.ctr > a.ctr ? b : a));
  const withConv = rows.filter((r) => r.clickToSignup != null);
  const bestConvert = withConv.length ? withConv.reduce((a, b) => (b.clickToSignup > a.clickToSignup ? b : a)) : null;
  const withCps = rows.filter((r) => r.cps != null);
  const cheapest = withCps.length ? withCps.reduce((a, b) => (a.cps < b.cps ? a : b)) : null;
  const volume = mostImps.name === mostClicks.name
    ? `${mostImps.name} has the most impressions and the most clicks.`
    : `${mostImps.name} has the most impressions. ${mostClicks.name} has the most clicks.`;
  const convert = bestConvert ? ` ${bestConvert.name} turns the largest share of its clicks into sign-ups, at ${rate(bestConvert.clickToSignup)}.` : '';
  const cost = cheapest ? ` ${cheapest.name} has the lowest cost per sign-up, at ${money(cheapest.cps)}.` : '';
  return `${volume} ${bestCtr.name} has the highest click-through rate, at ${rate(bestCtr.ctr)}.${convert}${cost}`;
}

function mixRow(label, key, rows) {
  const total = rows.reduce((s, r) => s + r[key], 0);
  if (!total) return '';
  const segs = rows.map((r) => `<i style="width:${(r[key] / total) * 100}%;background:${r.color}"></i>`).join('');
  return `<div class="mix-row"><span>${esc(label)}</span><span class="mix-bar" role="img" aria-label="${esc(label)} by channel">${segs}</span></div>`;
}

function channelCard() {
  const rows = channelWindowTotals();
  const totals = {
    ad_spend: rows.reduce((s, r) => s + r.ad_spend, 0),
    impressions: rows.reduce((s, r) => s + r.impressions, 0),
    clicks: rows.reduce((s, r) => s + r.clicks, 0),
    paid_signups: rows.reduce((s, r) => s + r.paid_signups, 0),
  };
  const cheapest = rows.filter((r) => r.cps != null).reduce((a, b) => (a && a.cps < b.cps ? a : b), null);
  const share = (n, total) => (total ? `<span class="share">${Math.round((n / total) * 100)}% of total</span>` : '');
  const body = rows.map((r) => `<tr>
    <td><span class="ch"><i style="background:${r.color}"></i>${esc(r.name)}</span></td>
    <td>${r.ad_spend ? money(r.ad_spend) : '—'}${share(r.ad_spend, totals.ad_spend)}</td>
    <td>${fmt(r.impressions)}${share(r.impressions, totals.impressions)}</td>
    <td>${fmt(r.clicks)}${share(r.clicks, totals.clicks)}</td>
    <td>${r.ctr == null ? '—' : rate(r.ctr)}</td>
    <td>${r.cpc == null ? '—' : money(r.cpc)}</td>
    <td>${fmt(r.paid_signups)}${share(r.paid_signups, totals.paid_signups)}<span class="share">${r.clickToSignup == null ? '' : `${rate(r.clickToSignup)} of clicks`}</span></td>
    <td class="${cheapest && cheapest.name === r.name ? 'best' : ''}">${r.cps == null ? '—' : money(r.cps)}</td>
  </tr>`).join('');
  const legend = rows.map((r) => `<span><i style="background:${r.color}"></i>${esc(r.name)}</span>`).join('');
  return `<section class="card"><h2>What each channel returned</h2><p class="lead">Impressions and clicks show which channel is being seen and clicked. Cost per sign-up sets that result against the money spent on the same channel.</p><p class="readout">${esc(channelRead(rows))}</p><div class="mix">${mixRow('Impressions', 'impressions', rows)}${mixRow('Clicks', 'clicks', rows)}${mixRow('Spend', 'ad_spend', rows)}${mixRow('Sign-ups', 'paid_signups', rows)}</div><div class="legend">${legend}</div><div class="table-wrap"><table class="chan"><thead><tr><th>Channel</th><th>Spend</th><th>Impressions</th><th>Clicks</th><th>Click-through</th><th>Cost per click</th><th>Sign-ups</th><th>Cost per sign-up</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function attributionCard() {
  const days = new Set(windowDays());
  const ga4 = ((S.data.attribution || {}).ga4 || []).filter((r) => days.has(r.date));
  const hubspot = ((S.data.attribution || {}).hubspot || []).filter((r) => days.has(r.date));
  const projects = ((S.data.attribution || {}).projects || []).filter((r) => days.has(r.date));
  if (!ga4.length && !hubspot.length && !projects.length) {
    return `<section class="card"><h2>Campaign attribution</h2><p class="lead">UTM, landing page, city and confirmed projects.</p><div class="empty">No attribution rows yet. The next GA4 sync will populate visits with UTM tags. Confirmed projects appear after the portal sends <code>project_created</code> with the documented UTM properties.</div></section>`;
  }
  const visitMap = new Map();
  for (const r of ga4) {
    const k = [r.source, r.medium, r.campaign, r.content, r.landing_page, r.city].join('\u0001');
    const x = visitMap.get(k) || { source: r.source, medium: r.medium, campaign: r.campaign, content: r.content, landing_page: r.landing_page, city: r.city, sessions: 0, engaged_sessions: 0, users: 0, key_events: 0 };
    for (const f of ['sessions', 'engaged_sessions', 'users', 'key_events']) x[f] += Number(r[f]) || 0;
    visitMap.set(k, x);
  }
  const visitRows = [...visitMap.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 100);
  const projectMap = new Map();
  for (const r of projects) {
    const k = [r.source, r.medium, r.campaign, r.content, r.landing_page].join('\u0001');
    const x = projectMap.get(k) || { source: r.source, medium: r.medium, campaign: r.campaign, content: r.content, landing_page: r.landing_page, projects_created: 0, people: 0 };
    x.projects_created += Number(r.projects_created) || 0;
    x.people += Number(r.people) || 0;
    projectMap.set(k, x);
  }
  const projectRows = [...projectMap.values()].sort((a, b) => b.projects_created - a.projects_created).slice(0, 100);
  const signupMap = new Map();
  for (const r of hubspot) {
    const k = [r.source, r.medium, r.campaign, r.content, r.landing_page].join('\u0001');
    const x = signupMap.get(k) || { source: r.source, medium: r.medium, campaign: r.campaign, content: r.content, landing_page: r.landing_page, signups: 0 };
    x.signups += 1;
    signupMap.set(k, x);
  }
  const signupRows = [...signupMap.values()].sort((a, b) => b.signups - a.signups).slice(0, 100);
  const visitTable = visitRows.length
    ? `<div class="table-wrap"><table class="chan"><thead><tr><th>Source / medium</th><th>Campaign</th><th>Piece</th><th>Landing</th><th>City</th><th>Sessions</th><th>Engaged</th><th>Users</th><th>Key events</th></tr></thead><tbody>${visitRows.map((r) => `<tr><td>${esc(`${r.source} / ${r.medium}`)}</td><td><code>${esc(r.campaign)}</code></td><td><code>${esc(r.content)}</code></td><td><code>${esc(r.landing_page)}</code></td><td>${esc(r.city)}</td><td>${fmt(r.sessions)}</td><td>${fmt(r.engaged_sessions)}</td><td>${fmt(r.users)}</td><td>${fmt(r.key_events)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">GA4 has not returned UTM rows for this period.</div>';
  const projectTable = projectRows.length
    ? `<h3>Confirmed projects</h3><div class="table-wrap"><table class="chan"><thead><tr><th>Source / medium</th><th>Campaign</th><th>Piece</th><th>Landing</th><th>Projects</th><th>People</th></tr></thead><tbody>${projectRows.map((r) => `<tr><td>${esc(`${r.source} / ${r.medium}`)}</td><td><code>${esc(r.campaign)}</code></td><td><code>${esc(r.content)}</code></td><td><code>${esc(r.landing_page)}</code></td><td>${fmt(r.projects_created)}</td><td>${fmt(r.people)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="footnote">No confirmed projects yet. The current click Action remains a separate, temporary activation proxy.</p>';
  const signupTable = signupRows.length
    ? `<h3>External HubSpot form sign-ups</h3><div class="table-wrap"><table class="chan"><thead><tr><th>Source / medium</th><th>Campaign</th><th>Piece</th><th>Landing</th><th>Sign-ups</th></tr></thead><tbody>${signupRows.map((r) => `<tr><td>${esc(`${r.source} / ${r.medium}`)}</td><td><code>${esc(r.campaign)}</code></td><td><code>${esc(r.content)}</code></td><td><code>${esc(r.landing_page)}</code></td><td>${fmt(r.signups)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="footnote">No external HubSpot form sign-ups in this period.</p>';
  return `<section class="card"><h2>Campaign attribution</h2><p class="lead">GA4 reports visits by UTM, landing page and city. HubSpot shows external form sign-ups. Confirmed projects require the backend <code>project_created</code> event; “(not set)” means that the visitor or event did not include that value.</p>${visitTable}${signupTable}${projectTable}</section>`;
}

function marketingView() {
  const ads = metric('ad_spend');
  const channels = ads.noData
    ? `<section class="card"><h2>What each channel returned</h2><div class="empty">${esc(ads.noData)}</div></section>`
    : channelCard();
  return `${marketingCards()}${channels}${attributionCard()}${chartsFor('marketing')}`;
}

function coreCard(label, value, flow, metricId, momResult) {
  const m = metric(metricId);
  if (m.noData) return noDataCard(label, m);
  return metricCard({
    label,
    value,
    flow,
    goal: goalLine(m, valueOf(m)),
    mom: momLine(momResult, senseOf(m)),
  });
}

function coreView() {
  const end = endIndex();
  const asOf = S.data.days[end];
  const customers = stock('open_accounts', end);
  const active = stock('active_7d', end);
  const withProject = stock('with_project', end);
  const projects = stock('project_count', end);
  const avgProjects = customers ? projects / customers : null;
  const credits = sumIdx('credits', lastNIndexes(7, end));
  const avgCredits = active ? credits / active : null;
  const cancel = cancellationSnapshot();
  const churn = churnSnapshot();
  const accounts = flowTotal('platform_signups');
  const activated = flowTotal('activated');
  const builds = flowTotal('first_builds');
  const paid = flowTotal('paid_subs');
  const row1 = [
    coreCard('Customers', fmt(customers), `${fmt(accounts)} new in this period`, 'open_accounts', stockMom('open_accounts')),
    coreCard('Active customers', fmt(active), customers ? `${share(active, customers)} of customers` : 'No open accounts', 'active_7d', stockMom('active_7d')),
    coreCard('With a project', fmt(withProject), customers ? `${share(withProject, customers)} of open accounts` : 'No open accounts', 'with_project', stockMom('with_project')),
    coreCard('Avg projects', avgProjects == null ? '—' : num1(avgProjects), `Projects ÷ open accounts, as of ${dshort(asOf)}`, 'avg_projects', endRatioMom('project_count', 'open_accounts')),
  ].join('');
  const churnFlow = churn.pct == null
    ? churn.reason
    : `${fmt(churn.lost)} of ${fmt(churn.base)} who paid in ${monthLabel(churn.month)}`;
  const row2 = [
    coreCard('Avg credits', avgCredits == null ? '—' : num1(avgCredits), 'Last 7 days ÷ active customers', 'avg_credits', creditsMom()),
    coreCard('Cancellation', cancel.pct == null ? '—' : rate(cancel.pct), cancel.opening ? `${fmt(cancel.canceled)} of ${fmt(cancel.opening)} at the start` : 'No customers at the start', 'cancellation_rate', cancelMom()),
    coreCard('Churn', churn.pct == null ? '—' : rate(churn.pct), churnFlow, 'churn_rate', churnMom()),
  ].join('');
  const flow = [
    flowCard('New accounts', 'platform_signups', fmt(accounts), 'Start of the funnel'),
    flowCard('Activated', 'activated', fmt(activated), accounts ? `${share(activated, accounts)} of new accounts` : 'No new accounts'),
    flowCard('First build', 'first_builds', fmt(builds), activated ? `${share(builds, activated)} of activated` : 'No activated accounts'),
    flowCard('Started paying', 'paid_subs', fmt(paid), builds ? `${share(paid, builds)} of first builds` : 'No first builds'),
  ].join('');
  const note = `Activity uses the 7 days ending ${dshort(asOf)}. Cancellation is this period, divided by customers at the start. Churn is who paid in the previous month and is not paying as of ${dshort(asOf)}.`;
  const payNote = paid > builds ? '<p class="footnote">Started paying can be higher than first builds. Paying is not limited to people who already built.</p>' : '';
  return `<section class="kpis four" aria-label="Customers">${row1}</section><section class="kpis three" aria-label="Depth and retention">${row2}</section><p class="footnote">${esc(note)}</p><div class="block"><h2>New-account flow</h2><p class="lead">What the accounts created in this period have done. The line under each number is that step’s share of the previous step. The colored percent is that number divided by its goal, and the last line is the change versus the previous month.</p></div><section class="kpis four" aria-label="New-account flow">${flow}</section>${payNote}${chartsFor('core')}`;
}
function growthView() {
  const sessions = flowTotal('landing_sessions');
  const starts = flowTotal('form_starts');
  const done = flowTotal('form_submits');
  const accounts = flowTotal('platform_signups');
  const cards = [
    flowCard('Landing sessions', 'landing_sessions', fmt(sessions), 'Start of the flow'),
    flowCard('Form started', 'form_starts', fmt(starts), sessions ? `${share(starts, sessions)} of landing sessions` : 'No landing sessions'),
    flowCard('Form completed', 'form_submits', fmt(done), starts ? `${share(done, starts)} of form starts` : 'No form starts', 'form_completion'),
    flowCard('New accounts', 'platform_signups', fmt(accounts), done ? `${share(accounts, done)} of forms completed · ${share(accounts, sessions)} of sessions` : 'No forms completed'),
  ].join('');
  const extra = accounts > done ? '<p class="footnote">New accounts are higher than form completions. Some accounts are created outside this landing form.</p>' : '';
  return `<section class="kpis four" aria-label="Growth funnel">${cards}</section>${extra}${chartsFor('growth')}`;
}

function monthTotals(ym) {
  const idx = indexesForMonth(ym);
  const spend = sumIdx('ad_spend', idx);
  const signups = sumIdx('platform_signups', idx);
  return {
    ym,
    days: idx.length,
    spend,
    signups,
    paid: sumIdx('paid_subs', idx),
    activated: sumIdx('activated', idx),
    cac: spend && signups ? spend / signups : null,
  };
}
function monthsInData() {
  const months = [];
  S.data.days.forEach((d) => {
    const ym = d.slice(0, 7);
    if (months[months.length - 1] !== ym) months.push(ym);
  });
  return months;
}
function monthlyCacCard() {
  const selected = new Set(windowDays().map((d) => d.slice(0, 7)));
  const rows = monthsInData().map((ym) => monthTotals(ym));
  let best = null;
  for (const row of rows) {
    if (row.cac == null || row.days < 14) continue;
    if (!best || row.cac < best.cac) best = row;
  }
  let prevCac = null;
  const body = rows.map((row) => {
    const mom = row.cac != null && prevCac != null ? (row.cac - prevCac) / prevCac : null;
    prevCac = row.cac;
    const bestCell = best && best.ym === row.ym ? ' class="best"' : '';
    return `<tr${selected.has(row.ym) ? ' class="on"' : ''}>
      <td>${esc(monthLabel(row.ym))}</td>
      <td>${row.days}</td>
      <td>${row.spend ? money(row.spend) : '—'}</td>
      <td>${fmt(row.signups)}</td>
      <td${bestCell}>${row.cac == null ? '—' : money(row.cac)}</td>
      <td>${mom == null ? '—' : growthPill(mom, true)}</td>
    </tr>`;
  }).join('');
  return `<section class="card"><h2>CAC by month</h2><p class="lead">Ad spend in that month divided by new sign-ups in that month. Jul and Oct are partial in this preview. A ratio can still be compared with a full month. The lowest CAC is marked, and the months in this period are shaded.</p><div class="table-wrap"><table class="chan"><thead><tr><th>Month</th><th>Days</th><th>Ad spend</th><th>New sign-ups</th><th>CAC</th><th>vs prior month</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}
function costCard({ label, value, flow, metricId, actual, target, mom, sense, word }) {
  const m = metricId ? metric(metricId) : null;
  if (m && m.noData) return noDataCard(label, m);
  const goal = m ? goalLine(m, actual == null ? { actual: null, target: null } : { actual, target }) : openGoal();
  return metricCard({ label, value, flow, goal, mom: momLine(mom, sense || (m ? senseOf(m) : 'higher'), word) });
}
function unitValueCard() {
  const idx = windowIndexes();
  const spend = sumIdx('ad_spend', idx);
  const signups = sumIdx('platform_signups', idx);
  const paid = sumIdx('paid_subs', idx);
  const activated = sumIdx('activated', idx);
  const assumptions = S.data.assumptions || { planPrice: 49, grossMargin: 0.8 };
  const gp = assumptions.planPrice * assumptions.grossMargin;
  const paidCac = spend && paid ? spend / paid : null;
  const activatedCost = spend && activated ? spend / activated : null;
  const paidRate = signups ? paid / signups : null;
  const perThousand = spend ? signups / (spend / 1000) : null;
  const ltvInfo = ltvChurn();
  const ltv = ltvInfo.pct ? gp / ltvInfo.pct : null;
  const payback = paidCac != null && gp ? paidCac / gp : null;
  const ltvCac = ltv != null && paidCac ? ltv / paidCac : null;
  const paidChange = ratioMom('ad_spend', 'paid_subs');
  const life = ltvMom(gp);
  let worthMom = { pct: null, reason: life.reason || paidChange.reason || '' };
  if (ltv != null && paidCac && life.pct != null && paidChange.pct != null) {
    const priorLtv = ltv / (1 + life.pct);
    const priorPaid = paidCac / (1 + paidChange.pct);
    worthMom = { pct: priorPaid ? (ltv / paidCac - priorLtv / priorPaid) / (priorLtv / priorPaid) : null, reason: '' };
  }
  const activatedTarget = valueOf(metric('cost_per_activated')).target;
  const paidRateTarget = valueOf(metric('signup_to_paid')).target;
  const boxes = [
    costCard({
      label: 'Cost per activated account',
      value: !spend ? '—' : activatedCost == null ? '—' : money(activatedCost),
      flow: !spend ? 'No campaign spend in this selection' : activated ? `${money(spend)} ÷ ${fmt(activated)} activated` : 'No activated accounts',
      metricId: 'cost_per_activated',
      actual: !spend ? null : activatedCost,
      target: activatedTarget,
      mom: ratioMom('ad_spend', 'activated'),
    }),
    costCard({
      label: 'Sign-up to paid',
      value: paidRate == null ? '—' : rate(paidRate),
      flow: signups ? `${fmt(paid)} of ${fmt(signups)} new accounts` : 'No new sign-ups',
      metricId: 'signup_to_paid',
      actual: paidRate,
      target: paidRateTarget,
      mom: ratioMom('paid_subs', 'platform_signups'),
    }),
    costCard({
      label: 'Sign-ups per $1,000',
      value: perThousand == null ? '—' : num1(perThousand),
      flow: 'New sign-ups for each $1,000 of ad spend',
      mom: ratioMom('platform_signups', 'ad_spend'),
      sense: 'higher',
    }),
    costCard({
      label: 'Payback',
      value: payback == null ? '—' : `${num1(payback)} months`,
      flow: `Cost per paying customer ÷ ${money(gp)} monthly gross profit`,
      mom: paidChange,
      sense: 'lower',
    }),
    costCard({
      label: 'LTV',
      value: ltv == null ? '—' : money(ltv),
      flow: ltvInfo.pct == null ? ltvInfo.reason : `Gross profit ÷ ${monthLabel(ltvInfo.month)} churn of ${rate(ltvInfo.pct)}`,
      mom: life,
      sense: 'higher',
      word: 'MoM',
    }),
    costCard({
      label: 'LTV : CAC',
      value: ltvCac == null ? '—' : `${num1(ltvCac)}×`,
      flow: 'LTV divided by cost per paying customer',
      mom: worthMom,
      sense: 'higher',
      word: 'MoM',
    }),
  ].join('');
  const lead = `Plan price is ${money(assumptions.planPrice)} a month and gross margin is ${rate(assumptions.grossMargin)}. Both are placeholders in this preview, so payback, LTV, and LTV : CAC have no goal yet. They use cost per paying customer.`;
  return `<div class="block"><h2>What a new customer is worth</h2><p class="lead">${esc(lead)}</p></div><section class="kpis three" aria-label="Customer value">${boxes}</section>`;
}
function economicsView() {
  const idx = windowIndexes();
  const spend = sumIdx('ad_spend', idx);
  const signups = sumIdx('platform_signups', idx);
  const paid = sumIdx('paid_subs', idx);
  const end = endIndex();
  const endDay = S.data.days[end];
  const ym = endDay.slice(0, 7);
  const thisMonth = monthTotals(ym);
  const priorMonth = prevMonth(ym);
  const prev = monthTotals(priorMonth);
  const monthGrowth = thisMonth.cac != null && prev.cac != null ? (thisMonth.cac - prev.cac) / prev.cac : null;
  const monthReason = prev.days ? (prev.cac == null ? 'No CAC in the previous month' : '') : `${monthLabel(priorMonth)} is not in this preview`;
  const daySpend = fullDaily('ad_spend')[end];
  const daySign = fullDaily('platform_signups')[end];
  const dayCac = daySpend && daySign ? daySpend / daySign : null;
  const paidCost = spend && paid ? spend / paid : null;
  const cacTarget = valueOf(metric('cac')).target;
  const monthTarget = effectiveTarget(ym, 'cac');
  const paidTarget = valueOf(metric('cost_per_paid')).target;
  const kpis = [
    costCard({
      label: 'CAC',
      value: !spend ? '—' : signups ? money(spend / signups) : '—',
      flow: !spend ? 'No campaign spend in this selection' : signups ? `${money(spend)} ÷ ${fmt(signups)} new sign-ups` : 'No new sign-ups in this selection',
      metricId: 'cac',
      actual: !spend || !signups ? null : spend / signups,
      target: cacTarget,
      mom: ratioMom('ad_spend', 'platform_signups'),
    }),
    costCard({
      label: 'Monthly CAC',
      value: thisMonth.cac == null ? '—' : money(thisMonth.cac),
      flow: `${monthLabel(ym)} · ${thisMonth.days} days`,
      metricId: 'cac',
      actual: thisMonth.cac,
      target: monthTarget,
      mom: { pct: monthGrowth, reason: monthReason },
      word: 'MoM',
    }),
    costCard({
      label: 'Daily CAC',
      value: !daySpend ? '—' : dayCac == null ? '—' : money(dayCac),
      flow: !daySpend ? `${dshort(endDay)} · No campaign spend` : dayCac == null ? `${dshort(endDay)} · No new sign-ups that day` : `${dshort(endDay)} · ${money(daySpend)} ÷ ${fmt(daySign)} sign-ups`,
      metricId: 'cac',
      actual: !daySpend ? null : dayCac,
      target: monthTarget,
      mom: dayCacMom(end),
      word: 'MoM',
    }),
    costCard({
      label: 'Cost per paying customer',
      value: !spend || paidCost == null ? '—' : money(paidCost),
      flow: !spend ? 'No campaign spend in this selection' : paid ? `${money(spend)} ÷ ${fmt(paid)} new subscriptions` : 'No new subscriptions in this period',
      metricId: 'cost_per_paid',
      actual: !spend ? null : paidCost,
      target: paidTarget,
      mom: ratioMom('ad_spend', 'paid_subs'),
    }),
  ].join('');
  const note = 'CAC is ad spend divided by new sign-ups. The first box is this period. Monthly CAC is the calendar month of the last day in view, scored against that month’s goal. Daily CAC is that last day, scored against the same monthly cost goal, and its change is versus the same calendar day last month.';
  return `<section class="kpis four" aria-label="CAC">${kpis}</section><p class="footnote">${esc(note)}</p>${monthlyCacCard()}${unitValueCard()}${chartsFor('economics')}`;
}

function planningMonths() {
  const ids = new Set(S.data.months.map((m) => m.id));
  for (const d of S.data.days) ids.add(d.slice(0, 7));
  return [...ids].sort();
}
function targetHint(month, m) {
  if (m.id === 'retention') return 'No monthly target.';
  if (m.id === 'campaigns') return 'Campaigns with spend. A shorter or longer range does not scale this number.';
  if (m.point) return 'Level at the end of the month. A shorter or longer range does not scale this number.';
  if (m.ratio) return 'Cost for the month. A shorter or longer range does not scale this number.';
  if (m.unit === 'rate') return 'Percent for the month. Enter 2 for 2%. A rolling range keeps this rate.';
  const saved = S.overrides[month] && S.overrides[month][m.id] != null;
  const planned = S.data.targets[month] && S.data.targets[month][m.id] != null;
  const unit = m.unit === 'currency' ? 'Dollars for the month' : 'Count for the month';
  if (!saved && !planned) return `${unit}. Blank until you set it.`;
  return unit;
}
function targetInputValue(m, month) {
  const v = effectiveTarget(month, m.id);
  if (v == null) return '';
  if (m.unit === 'rate') return String(Math.round(v * 10000) / 100);
  if (m.unit === 'decimal') return String(Math.round(v * 10) / 10);
  if (m.unit === 'currency') return String(Math.round(v * 100) / 100);
  return String(Math.round(v));
}
function citedSources(text) {
  return String(text || '').split(',').map((part) => part.trim()).filter(Boolean).map((part) => (/^platform billing/i.test(part) ? 'Platform billing (to confirm)' : part));
}
function metricsFor(source) {
  if (!source.metricSource || !S.data) return [];
  return S.data.metrics.filter((m) => citedSources(m.source).includes(source.metricSource));
}
function pill(state) {
  const [cls, label] = SOURCE_STATE[state] || ['mute', state];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}
function sourcesView() {
  const known = new Set(SOURCES.map((s) => s.metricSource).filter(Boolean));
  const missing = new Map();
  for (const m of S.data.metrics) {
    for (const part of citedSources(m.source)) {
      if (known.has(part)) continue;
      if (!missing.has(part)) missing.set(part, []);
      missing.get(part).push(m.name);
    }
  }
  const missingNote = [...missing.entries()].map(([part, names]) => `${part}: ${names.join(', ')}`).join('. ');
  // Live statuses from the server (gd_items kind 'source' merged with the source catalog).
  const live = new Map((S.data.sources || []).map((s) => [s.key, s]));
  const rows = SOURCES.map((s) => {
    const l = live.get(s.key) || {};
    const state = l.state || s.state;
    const last = l.last_sync ? String(l.last_sync).slice(0, 10) : '';
    const used = metricsFor(s);
    const usedLine = used.length ? `<span class="sub">Dashboard: ${used.map((m) => esc(m.name)).join(', ')}</span>` : '';
    const noteLine = l.note ? `<span class="sub">${esc(l.note)}</span>` : '';
    const loaded = last ? `${esc(last)}<span class="sub">${esc(l.window || '')}</span>` : '–';
    const auto = l.auto ? '<span class="pill ok">Automatic</span>' : '<span class="pill mute">Manual</span>';
    return `<tr><td><span class="name">${esc(s.name)}</span><span class="sub">${esc(s.area)}</span></td><td>${pill(state)}${noteLine}</td><td>${esc(s.provides)}${usedLine}</td><td>${loaded}</td><td>${auto}</td></tr>`;
  }).join('');
  const connect = SOURCES.map((s) => {
    const vars = s.env.length ? `<br><small>Variables: ${s.env.map((v) => `<code>${esc(v)}</code>`).join(' ')}</small>` : '';
    return `<div><dt>${esc(s.name)}</dt><dd>${esc(s.connect)}${vars}</dd></div>`;
  }).join('');
  const history = S.loads.length
    ? `<div class="table-wrap"><table class="sources"><thead><tr><th>When</th><th>Source</th><th>How</th><th>Rows</th><th>Detail</th></tr></thead><tbody>${S.loads.map((r) => `<tr><td>${esc(String(r.at).slice(0, 16).replace('T', ' '))}</td><td>${esc(r.source)}</td><td>${esc(r.how)}</td><td>${r.error ? '<span class="pill bad">Error</span>' : esc(String(r.rows))}</td><td>${esc(r.error || r.detail || '')}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">No loads recorded yet.</div>';
  return `<section class="card roomy"><h2>Data sources</h2><p class="lead">Every number in this dashboard comes from one of these tools. Statuses, last loads and the automatic flag are live from the server. Metrics whose source is not connected show “No data yet” on the other tabs.</p>
    <div class="table-wrap"><table class="sources"><thead><tr><th>Source</th><th>Status</th><th>Provides</th><th>Last load</th><th>Automatic</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${missingNote ? `<p class="page-note">Still without a connector. ${esc(missingNote)}.</p>` : ''}</section>
  <div class="split">
    <section class="card roomy"><h2>Load a CSV export</h2><p class="lead">For tools without an automatic connection yet (LinkedIn, Meta, Clarity). Columns: date, metric, value; optional dim and dim_value.</p>
      <form id="csv-form" class="form-row">
        <select id="csv-source" aria-label="Source">${SOURCES.map((s) => `<option value="${esc(s.key)}">${esc(s.name)}</option>`).join('')}</select>
        <input type="file" id="csv-file" accept=".csv,text/csv" aria-label="CSV file" required>
        <button class="btn" type="submit">Load</button>
      </form>
      <p class="page-note">Example: <code>2026-10-20,ad_spend,35.5,campaign,LATAM launch</code>. Paid metrics: ad_spend, ad_impressions, ad_clicks, ad_results. Loading the same date and metric again replaces the value in the live dashboard. Here, a valid file is checked and added to Load history.</p>
      <p class="page-note"><a href="#" id="dl-csv">Download all daily data (CSV)</a></p></section>
    <section class="card roomy"><h2>How each source connects</h2><p class="lead">Credentials go in the service variables of this app, never in files</p>
      <dl class="defs">${connect}</dl></section>
  </div>
  <section class="card roomy"><h2>Definitions</h2><p class="lead">Why the same idea can show different numbers in two tools</p>
    <dl class="defs">
      <div><dt>Landing sessions (HubSpot)</dt><dd>Visits to every go.think4ever.com page HubSpot tracks, including the "page not found" page and preview pages. Counts the team's own visits.</dd></div>
      <div><dt>Sessions (Google Analytics)</dt><dd>Visits to /latam only, after cookie consent. Lower than HubSpot because it skips other pages and visitors who block tracking.</dd></div>
      <div><dt>Engaged session</dt><dd>Lasted more than 10 seconds, viewed 2 or more pages, or triggered a key event.</dd></div>
      <div><dt>Sign-up submit</dt><dd>The <code>sign_up</code> event set up in Tag Manager when the landing sign-up form is sent. It cannot tell internal tests from real visitors.</dd></div>
      <div><dt>Form sign-up (HubSpot)</dt><dd>A contact created from a landing form. Internal means a think4ever.com address; "External sign-ups" leaves those out.</dd></div>
      <div><dt>Platform account (PostHog)</dt><dd>A new person in the product, whether they came from the landing or signed up directly.</dd></div>
      <div><dt>Cost per sign-up</dt><dd>Campaign spend divided by external sign-ups with that campaign's utm_campaign.</dd></div>
    </dl></section>
  <section class="card roomy"><h2>Load history</h2><p class="lead">Last 30 loads recorded by the server (connectors, CSV and the daily routine)</p>${history}</section>`;
}
function parseCSV(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === ';') { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells.map((x) => x.trim()));
  }
  return rows;
}
function csvMetrics(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const hdr = rows[0].map((h) => h.toLowerCase());
  const hasHeader = hdr.includes('date') && hdr.includes('value');
  const idx = (name, fallback) => (hasHeader ? hdr.indexOf(name) : fallback);
  const iD = idx('date', 0);
  const iM = idx('metric', 1);
  const iV = idx('value', 2);
  const iDim = idx('dim', 3);
  const iDv = idx('dim_value', 4);
  return (hasHeader ? rows.slice(1) : rows).map((r) => ({
    date: r[iD],
    metric: r[iM],
    value: Number(String(r[iV] || '').replace(/[$\s]/g, '')),
    dim: iDim >= 0 ? r[iDim] || '' : '',
    dim_value: iDv >= 0 ? r[iDv] || '' : '',
  })).filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.date || '') && m.metric && Number.isFinite(m.value));
}
function previewCSV() {
  const lines = ['date,metric,value,dim,dim_value'];
  const idx = windowIndexes();
  for (const m of S.data.metrics) {
    const series = S.data.series[m.id];
    if (!series) continue;
    for (const country of S.selected) {
      const arr = series[country];
      if (!arr) continue;
      for (const i of idx) {
        const v = arr[i];
        if (!v) continue;
        lines.push([S.data.days[i], m.id, v, 'country', `"${String(country).replace(/"/g, '""')}"`].join(','));
      }
    }
  }
  return lines.join('\n');
}
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}
function currentTheme() {
  const picked = document.documentElement.dataset.theme;
  if (picked === 'dark' || picked === 'light') return picked;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function paintTheme() {
  const theme = currentTheme();
  document.querySelectorAll('[data-theme-pick]').forEach((b) => {
    const on = b.dataset.themePick === theme;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function targetsView() {
  const month = S.targetMonth;
  const picks = TARGET_VIEWS.map((v) => `<button type="button" data-target-view="${v.id}" class="${v.id === S.targetView ? 'active' : ''}">${esc(v.label)}</button>`).join('');
  const monthOptions = planningMonths().map((ym) => `<option value="${ym}"${ym === month ? ' selected' : ''}>${esc(monthLabel(ym))}</option>`).join('');
  const metrics = S.data.metrics.filter((m) => m.section === PAGES[S.targetView]);
  const rows = metrics.map((m) => {
    if (m.id === 'retention') {
      return `<div class="trow"><div><span class="name">${esc(m.name)}</span><span class="def">${esc(m.definition)}</span></div><div class="unit">No monthly target</div></div>`;
    }
    const step = m.unit === 'rate' || m.unit === 'decimal' ? '0.1' : '1';
    return `<div class="trow"><div><span class="name">${esc(m.name)}</span><span class="def">${esc(m.definition)}</span></div><label><input data-target-id="${esc(m.id)}" type="number" min="0" step="${step}" value="${esc(targetInputValue(m, month))}" aria-label="${esc(m.name)} target"><span class="unit">${esc(targetHint(month, m))}</span></label></div>`;
  }).join('');
  const note = S.targetNote ? `<p class="target-note">${esc(S.targetNote)}</p>` : '';
  return `<section class="card"><h2>Monthly targets</h2><p class="lead">Pick a view, then set the monthly goal for each metric. Targets stay app-wide. The country list does not change them. Save writes this month for the view you picked.</p><div class="view-picks" role="group" aria-label="View">${picks}</div><label class="ctl" for="target-month">Month <select id="target-month">${monthOptions}</select></label><div class="target-list">${rows}</div><div class="target-actions"><button type="button" class="btn" id="save-targets">Save targets</button><button type="button" class="btn secondary" id="reset-targets">Reset this month</button></div>${note}</section>`;
}
function readTargetInputs() {
  const out = {};
  let bad = false;
  document.querySelectorAll('[data-target-id]').forEach((input) => {
    const id = input.dataset.targetId;
    const raw = input.value.trim();
    if (raw === '') { out[id] = null; return; }
    const n = Number(raw.replace(/[$,%\s,]/g, ''));
    if (!Number.isFinite(n) || n < 0) { bad = true; return; }
    out[id] = metric(id).unit === 'rate' ? n / 100 : n;
  });
  return bad ? null : out;
}
function saveTargets() {
  const values = readTargetInputs();
  if (!values) { S.targetNote = 'Enter a number in every field you want to keep, or leave it blank for no target.'; render(); return; }
  const month = S.targetMonth;
  if (!S.overrides[month]) S.overrides[month] = {};
  for (const [id, v] of Object.entries(values)) {
    if (v == null) delete S.overrides[month][id];
    else S.overrides[month][id] = v;
  }
  persistTargets(`Saved ${monthLabel(month)} targets for ${TARGET_VIEWS.find((v) => v.id === S.targetView).label}.`);
}
function resetTargets() {
  const month = S.targetMonth;
  const ids = new Set(S.data.metrics.filter((m) => m.section === PAGES[S.targetView]).map((m) => m.id));
  if (S.overrides[month]) {
    for (const id of ids) delete S.overrides[month][id];
  }
  persistTargets(`Cleared the ${monthLabel(month)} targets for ${TARGET_VIEWS.find((v) => v.id === S.targetView).label}.`);
}

function render() {
  hideTip();
  S.charts = [];
  const days = windowDays();
  const names = [...S.selected];
  const scope = allOn() ? 'All countries' : (names.length ? names.join(', ') : 'No country selected');
  const info = periodInfo();
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.page === S.page));
  const periodSelect = document.getElementById('period');
  if (periodSelect && periodSelect.value !== S.range) periodSelect.value = S.range;
  document.querySelector('.layout').classList.toggle('solo', S.page === 'sources');
  if (S.page === 'sources') {
    document.getElementById('main').innerHTML = sourcesView();
    return;
  }
  if (!names.length && S.page !== 'targets') {
    document.getElementById('main').innerHTML = `<div class="empty">Select at least one country.</div>`;
    paintCounts();
    return;
  }
  if (!days.length && S.page !== 'targets') {
    document.getElementById('main').innerHTML = `<div class="empty">No results in ${esc(info.label)}.</div>`;
    paintCounts();
    return;
  }
  const custom = S.page === 'overview' || S.page === 'marketing' || S.page === 'growth' || S.page === 'core' || S.page === 'economics' || S.page === 'targets';
  const section = custom ? '' : `<section class="card"><h2>${esc(PAGES[S.page])}</h2><p class="lead">${esc(PAGE_LEAD[S.page])}</p>${S.data.metrics.filter((m) => m.section === PAGES[S.page]).map(row).join('')}</section>`;
  const kpis = S.page === 'overview' ? `<section class="kpis" aria-label="Summary">${HERO.map(hero).join('')}</section>` : '';
  const body = S.page === 'marketing' ? marketingView()
    : S.page === 'growth' ? growthView()
    : S.page === 'core' ? coreView()
    : S.page === 'economics' ? economicsView()
    : S.page === 'targets' ? targetsView()
    : `${kpis}${chartsFor(S.page)}${section}`;
  const countryBit = S.page === 'targets' ? 'Targets are app-wide.' : `${esc(scope)}${allOn() ? '' : '. The percent compares this selection with the app-wide target.'}`;
  const key = S.page === 'targets' ? '' : metricKey();
  document.getElementById('main').innerHTML = `
    <div class="banner"><b>Live data.</b><p>Real figures from the connected sources, through ${esc(S.data.asOf)} (the latest day with data). Metrics without a connected source say which one to connect. Daily totals that a source does not split by country appear under “Not split by country”. Targets are shared by the team and set on the Targets page.</p></div>
    <p class="scope"><b>${esc(info.label)}</b> · ${esc(info.range)} · ${countryBit} ${esc(info.note)}</p>
    ${key}
    ${body}`;
  paintCounts();
}
function paintCounts() {
  document.querySelectorAll('#country-list .n').forEach((el) => {
    el.textContent = fmt(countryTotal('platform_signups', el.dataset.country));
  });
}
function paintCountries() {
  const list = document.getElementById('country-list');
  list.innerHTML = S.data.countries.map((c) => `<label class="chk"><input type="checkbox" data-country="${esc(c.name)}" ${S.selected.has(c.name) ? 'checked' : ''}> <span class="cname">${esc(c.name)}</span><span class="n" data-country="${esc(c.name)}"></span></label>`).join('');
  document.getElementById('all').checked = allOn();
  list.onchange = (e) => {
    const name = e.target.dataset.country;
    if (!name) return;
    if (e.target.checked) S.selected.add(name); else S.selected.delete(name);
    document.getElementById('all').checked = allOn();
    render();
  };
}

async function init() {
  tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  const main = document.getElementById('main');
  main.addEventListener('mousemove', (e) => {
    const hit = e.target.closest && e.target.closest('.hit');
    if (!hit || !main.contains(hit)) { hideTip(); return; }
    showTip(e, Number(hit.dataset.chart), Number(hit.dataset.i));
  });
  main.addEventListener('mouseleave', hideTip);
  const res = await api('api/executive');
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(`Could not load live data (${res.status}${j.error ? `: ${j.error}` : ''}). If this dashboard uses a team code, enter it on the Classic dashboard first.`);
  }
  S.data = await res.json();
  const tr = await api('api/targets');
  S.overrides = tr.ok ? await tr.json() : {};
  S.targetMonth = S.data.asOf.slice(0, 7);
  S.loads = (S.data.synclog || []).map((r) => ({ at: r.at, source: r.source, how: r.how, rows: r.rows, error: r.error, detail: r.detail }));
  for (const c of S.data.countries) S.selected.add(c.name);
  const hash = location.hash.slice(1);
  if (PAGES[hash]) S.page = hash;
  paintTheme();
  document.querySelector('.theme-switch').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-theme-pick]');
    if (!pick) return;
    document.documentElement.dataset.theme = pick.dataset.themePick;
    try { localStorage.setItem('t4e-exec-theme', pick.dataset.themePick); } catch (err) { /* the choice still applies for this visit */ }
    paintTheme();
  });
  fillPeriod();
  document.getElementById('period').onchange = (e) => { S.range = e.target.value; render(); };
  document.getElementById('tabs').onclick = (e) => {
    const page = e.target.closest('button') && e.target.closest('button').dataset.page;
    if (!page) return;
    S.page = page;
    history.replaceState(null, '', `#${page}`);
    render();
  };
  main.addEventListener('submit', async (e) => {
    if (e.target.id !== 'csv-form') return;
    e.preventDefault();
    const file = document.getElementById('csv-file').files[0];
    const source = SOURCES.find((s) => s.key === document.getElementById('csv-source').value);
    if (!file || !source) return;
    const metrics = csvMetrics(await file.text());
    if (!metrics.length) {
      toast('No valid rows: use date (YYYY-MM-DD), metric and value');
      return;
    }
    const dates = metrics.map((m) => m.date).sort();
    S.loads.unshift({ at: new Date().toISOString(), source: source.name, how: 'csv', rows: metrics.length, detail: `${dates[0]} to ${dates[dates.length - 1]}` });
    S.loads = S.loads.slice(0, 30);
    toast(`${metrics.length} rows checked`);
    render();
  });
  main.addEventListener('click', (e) => {
    if (e.target.id === 'dl-csv') {
      e.preventDefault();
      const url = URL.createObjectURL(new Blob([previewCSV()], { type: 'text/csv' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: `latam-growth-${S.data.asOf}.csv` });
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    const grainBtn = e.target.closest && e.target.closest('[data-grain]');
    if (grainBtn) { S.grain = grainBtn.dataset.grain; render(); return; }
    const viewBtn = e.target.closest && e.target.closest('[data-target-view]');
    if (viewBtn) { S.targetView = viewBtn.dataset.targetView; S.targetNote = ''; render(); return; }
    if (e.target.id === 'save-targets') saveTargets();
    if (e.target.id === 'reset-targets') resetTargets();
  });
  main.addEventListener('change', (e) => {
    if (e.target.id !== 'target-month') return;
    S.targetMonth = e.target.value;
    S.targetNote = '';
    render();
  });
  document.getElementById('all').onchange = (e) => {
    S.selected = new Set(e.target.checked ? S.data.countries.map((c) => c.name) : []);
    paintCountries();
    render();
  };
  paintCountries();
  render();
}

function fillPeriod() {
  const months = [];
  for (const d of S.data.days) {
    const ym = d.slice(0, 7);
    if (months[months.length - 1] !== ym) months.push(ym);
  }
  const quarters = [];
  for (const ym of months) {
    const [y, mo] = ym.split('-').map(Number);
    const q = Math.ceil(mo / 3);
    const id = `q${y}-${q}`;
    if (!quarters.some((item) => item.id === id)) quarters.push({ id, label: `Q${q} ${y}` });
  }
  const sel = document.getElementById('period');
  sel.innerHTML = `<optgroup label="Rolling">
      <option value="d7">Last 7 days</option>
      <option value="d30">Last 30 days</option>
      <option value="d60">Last 60 days</option>
      <option value="d90">Last 90 days</option>
    </optgroup>
    <optgroup label="Month">${months.map((ym) => `<option value="m${ym}">${monthLabel(ym)}</option>`).join('')}</optgroup>
    <optgroup label="Quarter">${quarters.map((q) => `<option value="${q.id}">${q.label}</option>`).join('')}</optgroup>`;
  sel.value = S.range;
}

init().catch((e) => { document.getElementById('main').innerHTML = `<p class="empty">${esc(e.message)}</p>`; });
