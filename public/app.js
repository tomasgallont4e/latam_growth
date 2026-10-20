'use strict';
/* LATAM Growth dashboard. Reads everything from api/data and aggregates in the browser.
   Daily metrics follow the period selector; snapshots (tables pulled for a fixed window) show their own window. */

const LAUNCH = '2026-10-01';
const S = { data: null, tab: 'overview', period: 'launch', from: LAUNCH, to: today(), exInt: true };
const main = document.getElementById('main');

// ---------- utils
function today() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function days(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }
function diffDays(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null || Number.isNaN(n) ? '–' : Number(n).toLocaleString('en-US', { maximumFractionDigits: n % 1 ? 1 : 0 }));
const pct = (n) => (n == null || !Number.isFinite(n) ? '–' : `${(n * 100).toFixed(n < 0.1 && n > 0 ? 1 : 0)}%`);
const money = (n) => (n == null ? '–' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dshort = (iso) => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]}`;
const win = (a, b) => (a === b ? dshort(a) : `${dshort(a)} to ${dshort(b)}`);
function toast(t) { const el = document.getElementById('toast'); el.textContent = t; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2400); }
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; }

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const code = store('t4e-growth-code'); if (code) headers['x-team-code'] = code;
  const r = await fetch(path, { ...opts, headers });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.error === 'code') { askCode(); throw new Error('code'); }
  if (r.status === 401 && (j.error === 'auth' || j.error === 'not_configured')) { location.href = 'login.html'; throw new Error('code'); }
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}
function askCode() {
  main.innerHTML = `<section class="card" style="max-width:420px"><h2>Team code</h2><p class="note">This dashboard asks for the team code. Ask the Research lead for it.</p>
  <form id="code-form" class="form-row" style="margin-top:12px"><input type="password" id="code-in" aria-label="Team code" required><button class="btn">Open</button></form></section>`;
  document.getElementById('code-form').onsubmit = (e) => { e.preventDefault(); store('t4e-growth-code', document.getElementById('code-in').value); load(); };
}

// ---------- data access
const M = () => S.data.metrics;
function inRange(d, from = S.from, to = S.to) { return d >= from && d <= to; }
function msum(source, metric, f = () => true, from, to) {
  return M().filter((r) => r.source === source && r.metric === metric && inRange(r.date, from, to) && f(r)).reduce((s, r) => s + r.value, 0);
}
function has(source, metric) { return M().some((r) => r.source === source && r.metric === metric); }
function byDay(source, metric, from = S.from, to = S.to, dimKey = null) {
  const out = {};
  for (const d of days(from, to)) out[d] = dimKey ? {} : 0;
  for (const r of M()) {
    if (r.source !== source || r.metric !== metric || !inRange(r.date, from, to)) continue;
    if (dimKey) out[r.date][r.dim_value || 'Other'] = (out[r.date][r.dim_value || 'Other'] || 0) + r.value;
    else out[r.date] += r.value;
  }
  return out;
}
function byDim(source, metric, from, to) {
  const out = {};
  for (const r of M()) if (r.source === source && r.metric === metric && inRange(r.date, from, to)) out[r.dim_value || 'Total'] = (out[r.dim_value || 'Total'] || 0) + r.value;
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
}
// Snapshot for a window: exact match first, then the one that best overlaps the period.
function snap(source, key, prefer) {
  const list = S.data.snapshots.filter((s) => s.source === source && s.key === key);
  if (!list.length) return null;
  if (prefer) { const exact = list.find((s) => s.from === prefer.from && s.to === prefer.to); if (exact) return exact; }
  const exact = list.find((s) => s.from === S.from && s.to === S.to);
  if (exact) return exact;
  const ov = (s) => Math.max(0, diffDays(s.from > S.from ? s.from : S.from, s.to < S.to ? s.to : S.to) + 1);
  return list.slice().sort((a, b) => ov(b) - ov(a) || (b.to > a.to ? 1 : -1) || diffDays(b.from, b.to) - diffDays(a.from, a.to))[0];
}
const snapLabel = (s) => (s ? win(s.from, s.to) : '');
function signups(f = () => true) { return S.data.events.filter((e) => e.kind === 'form_signup' && inRange(e.date) && f(e)); }
function source(key) { return S.data.sources.find((s) => s.key === key) || { state: 'pending' }; }
function phAccounts(ext) {
  if (!has('posthog', 'ph_new_persons')) return null;
  return msum('posthog', 'ph_new_persons', (r) => !ext || r.dim_value !== 'Internal');
}
function ga4Event(name) {
  if (has('ga4', 'ga_event')) return { count: msum('ga4', 'ga_event', (r) => r.dim_value === name), users: null, label: win(S.from, S.to) };
  const s = snap('ga4', 'events');
  if (!s) return null;
  const row = s.rows.find((r) => r.event === name) || { count: 0, users: 0 };
  return { count: row.count, users: row.users, label: snapLabel(s) };
}

// ---------- small renderers
const srcTag = (key, extra = '') => { const s = source(key); return `<span class="src ${s.state === 'connected' ? '' : 'pending'}">${esc(s.name || key)}${extra ? ' · ' + esc(extra) : ''}</span>`; };
const STATE = { connected: ['ok', 'Connected'], pending: ['warn', 'Access pending'], not_started: ['mute', 'Not started'] };
const pill = (state) => { const [c, t] = STATE[state] || ['mute', state]; return `<span class="pill ${c}">${t}</span>`; };
function head(title, sub, right = '') { return `<div class="card-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${right}</div>`; }
function hbars(rows, total) {
  const top = Math.max(1, ...rows.map((r) => r[1]));
  return `<div class="hbars">${rows.map(([k, v]) => `<div class="hbar"><span>${esc(k)}</span><span class="track"><i style="width:${(v / top) * 100}%"></i></span><span class="n">${fmt(v)}${total ? `<small style="color:var(--muted);font-weight:400"> ${pct(v / total)}</small>` : ''}</span></div>`).join('')}</div>`;
}
function table(cols, rows, cls = () => '') {
  return `<div class="tbl-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.t)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr class="${cls(r, i)}">${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function emptyState(key, what) {
  const s = source(key);
  return `<div class="empty"><b>${esc(s.name)}: ${(STATE[s.state] || ['', ''])[1].toLowerCase()}.</b> ${esc(what || s.provides)}. ${esc(s.note || '')}</div>`;
}
function spark(series) {
  const v = Object.values(series), w = 120, h = 26, max = Math.max(1, ...v);
  if (v.length < 2) return '';
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * w},${h - 2 - (y / max) * (h - 4)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,${h} ${pts} ${w},${h}" style="fill:var(--info-soft);stroke:none"/><polyline points="${pts}" style="fill:none;stroke:var(--navy-2);stroke-width:1.5"/></svg>`;
}
function delta(cur, prev) {
  if (prev == null) return '';
  if (!prev && !cur) return '<span class="delta flat">no change vs previous period</span>';
  if (!prev) return '<span class="delta up">new vs previous period</span>';
  const d = (cur - prev) / prev;
  return `<span class="delta ${d > 0.005 ? 'up' : d < -0.005 ? 'down' : 'flat'}">${d > 0 ? '▲' : d < 0 ? '▼' : '•'} ${pct(Math.abs(d))} vs previous ${diffDays(S.from, S.to) + 1} days</span>`;
}

const PALETTE = ['var(--navy-2)', 'var(--orange)', 'var(--navy-3)', 'var(--ok)', 'var(--warn)', 'var(--navy-4)', 'var(--grey-bar)', 'var(--bad)'];
function stackedChart(series, notes) {
  const ds = Object.keys(series);
  const keys = [...new Set(ds.flatMap((d) => Object.keys(series[d])))];
  const totals = ds.map((d) => Object.values(series[d]).reduce((a, b) => a + b, 0));
  keys.sort((a, b) => ds.reduce((s, d) => s + (series[d][b] || 0), 0) - ds.reduce((s, d) => s + (series[d][a] || 0), 0));
  const rawMax = Math.max(4, ...totals);
  const stepT = Math.pow(10, Math.floor(Math.log10(rawMax))) * (rawMax / Math.pow(10, Math.floor(Math.log10(rawMax))) > 5 ? 2 : rawMax / Math.pow(10, Math.floor(Math.log10(rawMax))) > 2 ? 1 : 0.5);
  const max = Math.ceil(rawMax / stepT) * stepT;
  const W = 900, H = 250, L = 34, R = 10, T = 26, B = 206;
  const y = (v) => B - (v / max) * (B - T);
  const step = (W - L - R) / ds.length, bw = Math.max(3, step * 0.64);
  let g = '';
  for (let t = 0; t <= max + 1e-9; t += stepT) g += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
  const color = Object.fromEntries(keys.map((k, i) => [k, PALETTE[i % PALETTE.length]]));
  const every = Math.ceil(ds.length / 16);
  ds.forEach((d, i) => {
    const x = L + i * step + (step - bw) / 2;
    let acc = 0;
    for (const k of keys) {
      const v = series[d][k] || 0; if (!v) continue;
      g += `<rect x="${x}" y="${y(acc + v)}" width="${bw}" height="${y(acc) - y(acc + v)}" style="fill:${color[k]}"><title>${esc(dshort(d))} · ${esc(k)}: ${v}</title></rect>`;
      acc += v;
    }
    if (totals[i]) g += `<text x="${x + bw / 2}" y="${y(totals[i]) - 4}" text-anchor="middle" style="fill:var(--text)">${totals[i]}</text>`;
    if (i % every === 0) g += `<text x="${x + bw / 2}" y="${B + 15}" text-anchor="middle">${dshort(d)}</text>`;
  });
  notes.forEach((n, j) => {
    const i = ds.indexOf(n.date); if (i < 0) return;
    const x = L + i * step + step / 2;
    g += `<line x1="${x}" x2="${x}" y1="${T - 12}" y2="${B}" style="stroke:var(--orange);stroke-dasharray:3 3"/><circle cx="${x}" cy="${T - 14}" r="8" style="fill:var(--orange)"/><text x="${x}" y="${T - 10}" text-anchor="middle" style="fill:#fff;font-weight:700">${j + 1}</text>`;
  });
  return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily sessions by source">${g}</svg></div>
    <div class="legend">${keys.map((k) => `<span><i style="background:${color[k]}"></i>${esc(k)}</span>`).join('')}<span><i style="background:var(--orange);border-radius:50%"></i>Timeline note</span></div>`;
}

// ---------- views
function kpis() {
  const len = diffDays(S.from, S.to) + 1, pf = addDays(S.from, -len), pt = addDays(S.from, -1);
  const sess = msum('hubspot', 'sessions'), prevSess = S.from > LAUNCH ? msum('hubspot', 'sessions', undefined, pf, pt) : null;
  const ga = snap('ga4', 'totals'); const gt = ga && ga.rows[0];
  const su = ga4Event('sign_up');
  const all = signups(), ext = all.filter((e) => !e.internal);
  const ph = has('posthog', 'ph_new_persons');
  const tiles = [
    `<div class="kpi"><span class="lbl">Landing sessions</span><span class="val">${fmt(sess)}</span>${spark(byDay('hubspot', 'sessions'))}<span class="ctx">${srcTag('hubspot', win(S.from, S.to))}</span>${delta(sess, prevSess)}</div>`,
    gt ? `<div class="kpi"><span class="lbl">Visitors</span><span class="val">${fmt(gt.users)}</span><span class="ctx">${fmt(gt.new_users)} new · ${fmt(gt.sessions)} sessions</span><span class="ctx">${srcTag('ga4', snapLabel(ga))}</span></div>` : `<div class="kpi pending"><span class="lbl">Visitors</span><span class="val">Awaiting data</span><span class="ctx">${srcTag('ga4')}</span></div>`,
    gt ? `<div class="kpi"><span class="lbl">Engagement rate</span><span class="val">${pct(gt.engagement_rate)}</span><span class="ctx">${fmt(gt.engaged_sessions)} engaged sessions${gt.avg_engagement_sec ? ` · ${gt.avg_engagement_sec}s avg` : ''}</span><span class="ctx">${srcTag('ga4', snapLabel(ga))}</span></div>` : '',
    su ? `<div class="kpi"><span class="lbl">Sign-up submits</span><span class="val">${fmt(su.count)}</span><span class="ctx">${su.users != null ? `${fmt(su.users)} users · ` : ''}includes internal tests</span><span class="ctx">${srcTag('ga4', su.label)}</span></div>` : '',
    `<div class="kpi ${S.exInt && !ext.length ? 'alert' : ''}"><span class="lbl">${S.exInt ? 'External sign-ups' : 'Form sign-ups'}</span><span class="val">${fmt(S.exInt ? ext.length : all.length)}</span><span class="ctx">${S.exInt ? `${all.length - ext.length} internal tests excluded` : `${all.length - ext.length} internal, ${ext.length} external`}</span><span class="ctx">${srcTag('hubspot', 'form')}</span></div>`,
    ph ? `<div class="kpi"><span class="lbl">${S.exInt ? 'External platform sign-ups' : 'Platform sign-ups'}</span><span class="val">${fmt(phAccounts(S.exInt))}</span><span class="ctx">${S.exInt ? `${fmt(phAccounts(false) - phAccounts(true))} internal excluded` : 'internal and external'} · new people with an email</span><span class="ctx">${srcTag('posthog', win(S.from, S.to))}</span></div>`
       : `<div class="kpi pending"><span class="lbl">Platform accounts</span><span class="val">Awaiting PostHog</span><span class="ctx">${srcTag('posthog')}</span><span class="ctx">Sign-ups made directly in the platform</span></div>`,
  ];
  return `<section class="kpis" aria-label="Summary">${tiles.filter(Boolean).join('')}</section>`;
}

function funnel() {
  const ga = snap('ga4', 'totals'), gt = ga && ga.rows[0];
  const fs = ga4Event('form_start'), su = ga4Event('sign_up');
  const ext = signups((e) => !S.exInt || !e.internal).length;
  const ph = phAccounts(S.exInt);
  const steps = [
    { name: 'Landing sessions', src: 'HubSpot', n: msum('hubspot', 'sessions') },
    { name: 'Engaged sessions', src: `Google Analytics · ${snapLabel(ga)}`, n: gt ? gt.engaged_sessions : null },
    { name: 'Started the sign-up form', src: `Google Analytics · users`, n: fs ? (fs.users != null ? fs.users : fs.count) : null },
    { name: 'Submitted the sign-up', src: `Google Analytics · users`, n: su ? (su.users != null ? su.users : su.count) : null },
    { name: S.exInt ? 'External sign-ups' : 'Form sign-ups', src: 'HubSpot form', n: ext },
    { name: S.exInt ? 'External platform sign-ups' : 'Platform sign-ups', src: 'PostHog · any entry point', n: ph, pending: ph == null },
    { name: 'Activated (first project)', src: 'PostHog · event not tracked yet', n: null, pending: true },
  ];
  const top = Math.max(1, steps[0].n || 1);
  let prev = null;
  const rows = steps.map((s) => {
    const conv = prev && s.n != null && prev.n ? `${pct(s.n / prev.n)} of previous step` : '';
    if (s.n != null) prev = s;
    return `<div class="fstep ${s.pending ? 'pending' : ''}"><span class="name">${esc(s.name)}<small>${esc(s.src)}</small></span><span class="fbar">${s.pending ? '' : `<i style="width:${Math.max(0.5, ((s.n || 0) / top) * 100)}%"></i>`}</span><span class="n">${s.pending ? 'pending' : fmt(s.n)}</span>${conv ? `<span class="conv">${conv}</span>` : ''}</div>`;
  });
  return `<section class="card">${head('Funnel', 'From a visit to an active account. Each step shows the tool it comes from; Google Analytics steps include internal tests.')}<div class="funnel">${rows.join('')}</div></section>`;
}

function readings() {
  const s = snap('research', 'readings');
  if (!s) return '';
  return `<section class="card">${head('What the data says', `Research reading · ${snapLabel(s)}`)}<div class="readings">${s.rows.map((r) => `<div class="reading ${esc(r.tone)}"><h3>${esc(r.title)}</h3><p>${esc(r.text)}</p></div>`).join('')}</div></section>`;
}

function dailyCard() {
  const notes = S.data.notes.filter((n) => inRange(n.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
  return `<section class="card">${head('Daily landing sessions by source', `HubSpot · ${win(S.from, S.to)}. Numbered marks are timeline notes.`)}
    ${stackedChart(byDay('hubspot', 'sessions', S.from, S.to, 'source'), notes)}
    <div class="notes-list">${notes.map((n, i) => `<div><span class="pill info">${i + 1}</span><span>${dshort(n.date)}</span><span>${esc(n.label)}</span><button type="button" data-del-note="${esc(n.id)}" aria-label="Delete note">✕</button></div>`).join('')}</div>
    <form id="note-form" class="form-row" style="margin-top:12px">
      <input type="date" id="note-date" value="${S.to}" aria-label="Note date" required>
      <select id="note-kind" aria-label="Note type"><option value="launch">Campaign launch</option><option value="content">Content published</option><option value="fix">Fix</option><option value="test">Test</option><option value="other">Other</option></select>
      <input type="text" id="note-label" placeholder="Add a note to the timeline, e.g. First Medium article published" aria-label="Note text" required>
      <button class="btn">Add note</button>
    </form></section>`;
}

function viewOverview() {
  return `${kpis()}<div class="grid g32">${funnel()}${readings()}</div>${dailyCard()}`;
}

function viewAcquisition() {
  const src = byDim('hubspot', 'sessions', S.from, S.to);
  const total = src.reduce((s, r) => s + r[1], 0);
  const rows = src.map(([k, v]) => ({ k, s: v, pv: msum('hubspot', 'pageviews', (r) => r.dim_value === k), b: msum('hubspot', 'bounces', (r) => r.dim_value === k), c: msum('hubspot', 'contacts', (r) => r.dim_value === k) }));
  const ch = snap('ga4', 'channels'), utm = snap('hubspot', 'utm_campaigns');
  const hc = snap('hubspot', 'countries'), gc = snap('ga4', 'countries');
  const countries = {};
  (hc ? hc.rows : []).forEach((r) => { countries[r.country] = { ...(countries[r.country] || {}), s: r.sessions }; });
  (gc ? gc.rows : []).forEach((r) => { countries[r.country] = { ...(countries[r.country] || {}), u: r.users, k: r.key_events }; });
  const crow = Object.entries(countries).map(([c, v]) => ({ c, ...v })).sort((a, b) => (b.s || 0) - (a.s || 0));
  return `<div class="grid g2">
    <section class="card">${head('Sessions by source', `HubSpot · ${win(S.from, S.to)} · ${fmt(total)} sessions`)}${hbars(src, total)}
      ${table([{ t: 'Source', k: 'k' }, { t: 'Sessions', num: 1, f: (r) => fmt(r.s) }, { t: 'Page views', num: 1, f: (r) => fmt(r.pv) }, { t: 'Bounce rate', num: 1, f: (r) => pct(r.s ? r.b / r.s : null) }, { t: 'Contacts', num: 1, f: (r) => fmt(r.c) }], rows)}
      <p class="note">Contacts by source are the internal tracking tests; each one landed on the source it was sent from.</p></section>
    <section class="card">${head('Channels', `Google Analytics · ${esc((ch && ch.note) || '')}`, srcTag('ga4', snapLabel(ch)))}
      ${ch ? table([{ t: 'Channel', k: 'channel' }, { t: 'Sessions', num: 1, f: (r) => fmt(r.sessions) }, { t: 'Engaged', num: 1, f: (r) => fmt(r.engaged_sessions) }, { t: 'Engagement', num: 1, f: (r) => pct(r.engagement_rate) }, { t: 'Key events', num: 1, f: (r) => fmt(r.key_events) }], ch.rows) : emptyState('ga4')}
      <p class="note">"Unassigned" holds the 4 key events, all from the test sign-ups. Unassigned means the campaign tags did not match a channel rule; the tag naming is worth reviewing before campaigns start.</p></section>
  </div>
  <div class="grid g2">
    <section class="card">${head('UTM campaigns', 'Every ad, post and email should carry utm_source, utm_medium and utm_campaign so each sign-up traces back to the piece that produced it.', srcTag('hubspot', snapLabel(utm)))}
      ${utm ? table([{ t: 'utm_campaign', f: (r) => `<code>${esc(r.campaign)}</code>` }, { t: 'Sessions', num: 1, f: (r) => fmt(r.sessions) }, { t: 'Visitors', num: 1, f: (r) => fmt(r.visitors) }, { t: 'Contacts', num: 1, f: (r) => fmt(r.contacts) }, { t: '', f: (r) => (r.test ? '<span class="pill info">Test link</span>' : '<span class="pill ok">Live</span>') }], utm.rows) : emptyState('hubspot')}</section>
    <section class="card">${head('Countries', 'Sessions in HubSpot and users in Google Analytics', `${srcTag('hubspot', snapLabel(hc))} ${srcTag('ga4', snapLabel(gc))}`)}
      ${table([{ t: 'Country', k: 'c' }, { t: 'Sessions (HubSpot)', num: 1, f: (r) => fmt(r.s) }, { t: 'Users (GA4)', num: 1, f: (r) => fmt(r.u) }, { t: 'Key events', num: 1, f: (r) => fmt(r.k) }], crow)}
      <p class="note">Colombia, the United States and Canada match where the team works today. Market traffic will show up here once campaigns run.</p></section>
  </div>`;
}

const EVENT_INFO = {
  form_start: 'Started the sign-up form on the landing', sign_up: 'Submitted the sign-up form', login: 'Clicked log in', generate_lead: 'Lead sent to HubSpot',
  page_view: 'Page view', session_start: 'Session started', user_engagement: 'Page in focus for 1s or more', first_visit: 'First visit of a user', scroll: 'Scrolled 90% of the page',
};
function viewConversion() {
  const all = snap('ga4', 'events', { from: LAUNCH, to: '2026-10-14' }) || snap('ga4', 'events');
  const late = S.data.snapshots.find((s) => s.source === 'ga4' && s.key === 'events' && all && s.from > all.from && s.to === all.to);
  const lateMap = late ? Object.fromEntries(late.rows.map((r) => [r.event, r.count])) : {};
  const KEY = ['form_start', 'sign_up', 'login', 'generate_lead'];
  const evRows = all ? all.rows.slice().sort((a, b) => (KEY.includes(b.event) - KEY.includes(a.event)) || b.count - a.count) : [];
  const list = signups(), shown = list.filter((e) => !S.exInt || !e.internal);
  const forms = snap('hubspot', 'forms'), hp = snap('hubspot', 'pages'), gp = snap('ga4', 'pages');
  const PST = { live: ['ok', 'Live'], broken: ['crit', 'Check links'], preview: ['info', 'Preview'] };
  return `<div class="grid g2">
    <section class="card">${head('Landing events', 'Defined in Tag Manager, recorded by Google Analytics', srcTag('ga4', all ? snapLabel(all) : ''))}
      ${all ? table([{ t: 'Event', f: (r) => `<code>${esc(r.event)}</code>${KEY.includes(r.event) ? ' <span class="pill info">key</span>' : ''}<br><small style="color:var(--muted)">${esc(EVENT_INFO[r.event] || '')}</small>` }, { t: 'Events', num: 1, f: (r) => fmt(r.count) }, { t: 'Users', num: 1, f: (r) => fmt(r.users) }, ...(late ? [{ t: `Since ${dshort(late.from)}`, num: 1, f: (r) => fmt(lateMap[r.event] || 0) }] : [])], evRows) : emptyState('ga4')}
      ${late ? `<p class="note">Every sign_up, login and form_start happened before ${dshort(late.from)}, on the tracking test days.</p>` : ''}</section>
    <section class="card">${head('Sign-up log', `${shown.length} shown${S.exInt && list.length > shown.length ? `, ${list.length - shown.length} internal tests hidden` : ''} · ${win(S.from, S.to)}`, srcTag('hubspot', 'form'))}
      ${shown.length ? table([{ t: 'Date', f: (r) => dshort(r.date) }, { t: 'Form', k: 'form' }, { t: 'Source', k: 'source' }, { t: 'Country', k: 'country' }, { t: 'Type', f: (r) => (r.internal ? '<span class="pill mute">Internal test</span>' : '<span class="pill ok">External</span>') }], shown.slice().sort((a, b) => (a.date < b.date ? 1 : -1)), (r) => (r.internal ? 'internal' : ''))
        : `<div class="empty"><b>No external sign-ups in this period.</b> Turn off "Exclude internal tests" to see the ${list.length} test entries.</div>`}</section>
  </div>
  <div class="grid g2">
    ${platformCard()}
    <section class="card">${head('Pages', 'Views of each landing address', `${srcTag('hubspot', snapLabel(hp))} ${srcTag('ga4', snapLabel(gp))}`)}
      ${hp ? table([{ t: 'Page', f: (r) => `<code>${esc(r.page)}</code>` }, { t: 'Views (HubSpot)', num: 1, f: (r) => fmt(r.views) }, { t: 'Status', f: (r) => { const p = PST[r.status] || ['mute', r.status]; return `<span class="pill ${p[0]}">${p[1]}</span>`; } }], hp.rows) : ''}
      ${gp ? `<p class="note">Google Analytics records only <code>/latam</code>: ${fmt(gp.rows[0].views)} views from ${fmt(gp.rows[0].users)} users, ${Math.round((gp.rows[0].avg_engagement_sec || 0) / 60)}m ${(gp.rows[0].avg_engagement_sec || 0) % 60}s engagement per user.</p>` : ''}
      ${hp && hp.rows.some((r) => r.status === 'broken') ? '<p class="note"><b>Action:</b> links that lead to the "page not found" address should be fixed before paid traffic starts.</p>' : ''}</section>
  </div>
  ${(() => { const g = snap('gtm', 'tags'); return g ? `<section class="card">${head('How the landing events are measured', `Tag Manager container ${esc(g.note || '')}`, srcTag('gtm', snapLabel(g)))}${table([{ t: 'Tag', k: 'tag' }, { t: 'Type', k: 'type' }, { t: 'Fires on', f: (r) => `<code>${esc(r.trigger)}</code>` }, { t: 'Sends to', k: 'destination' }], g.rows)}<p class="note">Sign-ups through "Sign up with Google" go straight to the platform: they skip the landing form, so HubSpot and Google Analytics do not see them. Only PostHog does.</p></section>` : ''; })()}
  <section class="card">${head('Forms', 'Every form HubSpot records, including the platform forms it captures', srcTag('hubspot', forms ? snapLabel(forms) : ''))}
    ${forms ? table([{ t: 'Form', k: 'form' }, { t: 'Type', k: 'type' }, { t: 'Entries', num: 1, f: (r) => fmt(r.submissions) }, { t: 'External', num: 1, f: (r) => fmt(r.external) }, { t: 'When', k: 'dates' }], forms.rows) : emptyState('hubspot')}</section>`;
}

function platformCard() {
  if (!has('posthog', 'ph_new_persons')) return `<section class="card">${head('Platform sign-ups and activation', 'Accounts created directly in the product do not pass through the landing form', srcTag('posthog'))}${emptyState('posthog', 'Accounts created, first project, first build and returning users will appear here')}</section>`;
  const days_ = byDay('posthog', 'ph_new_persons', S.from, S.to, 'type');
  const rows = Object.entries(days_).map(([d, v]) => ({ d, ext: v.External || 0, int: v.Internal || 0, site: msum('posthog', 'ph_site_users', () => true, d, d), cta: msum('posthog', 'ph_cta_users', () => true, d, d), reg: msum('posthog', 'ph_registration_users', () => true, d, d) })).filter((r) => r.ext || r.int || r.site || r.reg).reverse();
  const ref = snap('posthog', 'new_people_by_source'), ctry = snap('posthog', 'countries');
  return `<section class="card span-all">${head('Platform sign-ups', 'New people identified with an email in the platform, from any entry point (site, landing, Google sign-up)', srcTag('posthog', win(S.from, S.to)))}
    ${table([{ t: 'Date', f: (r) => dshort(r.d) }, { t: 'Site visitors', num: 1, f: (r) => fmt(r.site) }, { t: 'Clicked a CTA', num: 1, f: (r) => fmt(r.cta) }, { t: 'Started sign-up', num: 1, f: (r) => fmt(r.reg) }, { t: 'External sign-ups', num: 1, f: (r) => (r.ext ? `<b>${fmt(r.ext)}</b>` : '0') }, { t: 'Internal', num: 1, f: (r) => fmt(r.int) }], rows)}
    <p class="note">Site visitors are people who viewed think4ever.com that day; visitors, clicks and sign-ups are counted per person and per day.</p></section>
  ${ref ? `<section class="card">${head('Where external sign-ups came from', 'First referrer of each new external person', srcTag('posthog', snapLabel(ref)))}${table([{ t: 'Came from', k: 'source' }, { t: 'People', num: 1, f: (r) => fmt(r.people) }, { t: 'Countries', k: 'countries' }], ref.rows)}<p class="note">${esc(ref.note || '')}</p></section>` : ''}
  ${ctry ? `<section class="card">${head('Platform interest by country', 'think4ever.com visitors, CTA clicks and sign-up starts per person', srcTag('posthog', snapLabel(ctry)))}${table([{ t: 'Country', k: 'country' }, { t: 'Site visitors', num: 1, f: (r) => fmt(r.site_users) }, { t: 'Clicked a CTA', num: 1, f: (r) => fmt(r.cta) }, { t: 'Started sign-up', num: 1, f: (r) => fmt(r.reg) }, { t: 'External sign-ups', num: 1, f: (r) => fmt(r.ext_signups) }], ctry.rows)}</section>` : ''}`;
}
function channelCard(key, title, metricsHint) {
  const rows = byDim(key, 'ad_spend', S.from, S.to);
  if (rows.length) {
    const r = rows.map(([c, spend]) => {
      const f = (m) => msum(key, m, (x) => x.dim_value === c);
      const imp = f('ad_impressions'), clk = f('ad_clicks'), res = f('ad_results');
      return { c, spend, imp, clk, res, ctr: imp ? clk / imp : null, cpc: clk ? spend / clk : null, cpr: res ? spend / res : null };
    });
    return `<section class="card">${head(title, `Paid results by campaign · ${win(S.from, S.to)}`, srcTag(key))}${table([{ t: 'Campaign', k: 'c' }, { t: 'Spend', num: 1, f: (x) => money(x.spend) }, { t: 'Impressions', num: 1, f: (x) => fmt(x.imp) }, { t: 'Clicks', num: 1, f: (x) => fmt(x.clk) }, { t: 'CTR', num: 1, f: (x) => pct(x.ctr) }, { t: 'CPC', num: 1, f: (x) => money(x.cpc) }, { t: 'Results', num: 1, f: (x) => fmt(x.res) }, { t: 'Cost per result', num: 1, f: (x) => money(x.cpr) }], r)}</section>`;
  }
  const other = [...new Set(M().filter((x) => x.source === key).map((x) => x.metric))];
  if (other.length) {
    return `<section class="card">${head(title, win(S.from, S.to), srcTag(key))}${table([{ t: 'Metric', k: 'm' }, { t: 'Total', num: 1, f: (x) => fmt(x.v) }], other.map((m) => ({ m: m.replace(/_/g, ' '), v: msum(key, m) })))}</section>`;
  }
  const s = source(key);
  return `<section class="card">${head(title, '', pill(s.state))}<div class="empty"><b>What will appear:</b> ${esc(metricsHint)}.<br><br><b>How to connect:</b> ${esc(s.connect || '')}<br><small>${esc(s.note || '')}</small></div></section>`;
}
function linkedinCard() {
  const posts = snap('linkedin', 'posts');
  if (!posts) return channelCard('linkedin', 'LinkedIn', 'page followers, post impressions and engagement; ad spend and clicks once campaigns run');
  const fol = M().filter((r) => r.source === 'linkedin' && r.metric === 'followers').sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = fol[fol.length - 1];
  const tot = snap('linkedin', 'page_totals'), loc = snap('linkedin', 'follower_locations');
  const t = tot && tot.rows[0];
  const hasAdmin = posts.rows.some((r) => r.impressions != null);
  const tile = (v, l, d) => `<div><div style="font:700 22px var(--font-head)">${fmt(v)}</div><div class="note" style="margin:0">${esc(l)}${d ? ` · <span class="delta up">${esc(d)}</span>` : ''}</div></div>`;
  return `<section class="card">${head('LinkedIn: Think4Ever Global page', esc(posts.note || ''), srcTag('linkedin', snapLabel(posts)))}
    ${t ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:12px">${tile(last ? last.value : t.followers, 'followers')}${tile(t.new_followers, 'new followers, 30 days', t.new_followers_change)}${tile(t.impressions, 'post impressions, 30 days', t.impressions_change)}${tile(t.page_views, 'page views, 30 days', t.page_views_change)}${tile(t.unique_visitors, 'unique visitors, 30 days', t.unique_visitors_change)}</div><p class="note" style="margin:0 0 10px">${esc(snapLabel(tot))}. All organic: sponsored impressions and sponsored followers are 0. ${t.mobile_views != null ? `${fmt(t.mobile_views)} of the page views come from mobile.` : ''}</p>` : (last ? `<p style="margin:0 0 10px"><span style="font:700 26px var(--font-head)">${fmt(last.value)}</span> <span class="note" style="margin:0">followers on ${dshort(last.date)}</span></p>` : '')}
    ${hasAdmin
      ? table([{ t: 'Date', f: (r) => dshort(r.date) }, { t: 'Post', f: (r) => esc(r.title) }, { t: 'Impressions', num: 1, f: (r) => fmt(r.impressions) }, { t: 'Clicks', num: 1, f: (r) => fmt(r.clicks) }, { t: 'CTR', num: 1, f: (r) => pct(r.ctr) }, { t: 'Reactions', num: 1, f: (r) => fmt(r.reactions) }, { t: 'Reposts', num: 1, f: (r) => fmt(r.reposts) }, { t: 'Engagement', num: 1, f: (r) => pct(r.engagement_rate) }], posts.rows)
      : table([{ t: 'Date', f: (r) => dshort(r.date) }, { t: 'Post', f: (r) => esc(r.title) }, { t: 'Reactions', num: 1, f: (r) => fmt(r.reactions) }, { t: 'Comments', num: 1, f: (r) => fmt(r.comments) }, { t: 'Reposts', num: 1, f: (r) => fmt(r.reposts) }], posts.rows)}
    ${loc ? `<p class="note"><b>Where followers are:</b> ${loc.rows.map((r) => `${esc(r.location)} ${fmt(r.followers)}`).join(' · ')}</p>` : ''}
    <p class="note">${hasAdmin ? 'From the page admin analytics.' : 'Public counts read from the page.'}</p></section>`;
}
function viewChannels() {
  const cl = snap('clarity', 'live_insights');
  const ads = snap('research', 'ad_libraries');
  return `${ads ? `<section class="card">${head('Paid activity check', 'Public ad libraries, searched for "think4ever"', `<span class="src">${snapLabel(ads)}</span>`)}${table([{ t: 'Library', k: 'library' }, { t: 'Ads found', num: 1, f: (r) => fmt(r.ads) }, { t: 'Reading', k: 'note' }], ads.rows)}</section>` : ''}
  <div class="grid g2">
    ${channelCard('meta', 'Meta: Facebook and Instagram', 'organic reach and followers; ad spend, impressions, clicks, cost per click and cost per sign-up by campaign and ad')}
    ${linkedinCard()}
    ${channelCard('google_ads', 'Google Ads', 'spend, clicks and cost per sign-up by campaign, through Google Analytics')}
    ${cl ? `<section class="card">${head('Microsoft Clarity', snapLabel(cl), srcTag('clarity'))}${table([{ t: 'Metric', k: 'metric' }, { t: 'Detail', f: (r) => esc(Object.entries(r).filter(([k]) => k !== 'metric').map(([k, v]) => `${k}: ${v}`).join(' · ')) }], cl.rows.slice(0, 20))}</section>` : channelCard('clarity', 'Microsoft Clarity', 'heatmaps, scroll depth, rage and dead clicks on the landing, and where visitors come from')}
  </div>
  <section class="card">${head('Cost per sign-up', 'Joins spend by campaign (Meta, LinkedIn, Google Ads) with sign-ups by utm_campaign (HubSpot) once campaigns run')}
    <div class="empty">No paid campaign has sent traffic yet, so there is no spend to divide. The view switches on with the first campaign that carries UTM tags.</div></section>`;
}

function viewSources() {
  const ss = S.data.sources;
  return `<section class="card">${head('Data sources', 'Every number in this dashboard comes from one of these tools')}
    ${table([{ t: 'Source', f: (r) => `<b>${esc(r.name)}</b><br><small style="color:var(--muted)">${esc(r.area)}</small>` }, { t: 'Status', f: (r) => pill(r.state) }, { t: 'Provides', k: 'provides' }, { t: 'Last load', f: (r) => (r.last_sync ? `${esc(r.last_sync.slice(0, 10))}<br><small style="color:var(--muted)">${esc(r.window)}</small>` : '–') }, { t: 'Automatic', f: (r) => (r.auto ? `<button type="button" class="btn secondary" data-sync="${esc(r.key)}">Sync now</button>` : '<span class="pill mute">Manual</span>') }], ss)}
  </section>
  <div class="grid g2">
    <section class="card">${head('Load a CSV export', 'For tools without an automatic connection yet (LinkedIn, Meta, Clarity). Columns: date, metric, value; optional dim and dim_value.')}
      <form id="csv-form" class="form-row">
        <select id="csv-source" aria-label="Source">${ss.map((s) => `<option value="${esc(s.key)}">${esc(s.name)}</option>`).join('')}</select>
        <input type="file" id="csv-file" accept=".csv,text/csv" aria-label="CSV file" required>
        <button class="btn">Load</button>
      </form>
      <p class="note">Example: <code>2026-10-20,ad_spend,35.5,campaign,LATAM launch</code>. Paid metrics: ad_spend, ad_impressions, ad_clicks, ad_results. Loading the same date and metric again replaces the value.</p>
      <p class="note"><a href="#" id="dl-csv">Download all daily data (CSV)</a></p></section>
    <section class="card">${head('How each source connects', 'Credentials go in the service variables of this app, never in files')}
      <dl class="defs">${ss.map((s) => `<div><dt>${esc(s.name)}</dt><dd>${esc(s.connect)}${s.env && s.env.length ? `<br><small>Variables: ${s.env.map((v) => `<code>${esc(v)}</code>`).join(' ')}</small>` : ''}</dd></div>`).join('')}</dl></section>
  </div>
  <section class="card">${head('Definitions', 'Why the same idea can show different numbers in two tools')}
    <dl class="defs">
      <div><dt>Landing sessions (HubSpot)</dt><dd>Visits to every go.think4ever.com page HubSpot tracks, including the "page not found" page and preview pages. Counts the team's own visits.</dd></div>
      <div><dt>Sessions (Google Analytics)</dt><dd>Visits to /latam only, after cookie consent. Lower than HubSpot because it skips other pages and visitors who block tracking.</dd></div>
      <div><dt>Engaged session</dt><dd>Lasted more than 10 seconds, viewed 2 or more pages, or triggered a key event.</dd></div>
      <div><dt>Sign-up submit</dt><dd>The <code>sign_up</code> event set up in Tag Manager when the landing sign-up form is sent. It cannot tell internal tests from real visitors.</dd></div>
      <div><dt>Form sign-up (HubSpot)</dt><dd>A contact created from a landing form. Internal means a think4ever.com address; "External sign-ups" leaves those out.</dd></div>
      <div><dt>Platform account (PostHog)</dt><dd>A new person in the product, whether they came from the landing or signed up directly.</dd></div>
      <div><dt>Cost per sign-up</dt><dd>Campaign spend divided by external sign-ups with that campaign's utm_campaign.</dd></div>
    </dl></section>
  <section class="card">${head('Load history', 'Last 30 loads')}
    ${table([{ t: 'When', f: (r) => esc(String(r.at).slice(0, 16).replace('T', ' ')) }, { t: 'Source', k: 'source' }, { t: 'How', k: 'how' }, { t: 'Rows', num: 1, f: (r) => (r.error ? `<span class="pill crit">Error</span>` : fmt((r.metrics || 0) + (r.snapshots || 0) + (r.events || 0))) }, { t: 'Detail', f: (r) => esc(r.error || '') }], S.data.synclog)}</section>`;
}

// ---------- Ad loader (task 124)
const PLAT = { google: 'Google Ads', meta: 'Meta', linkedin: 'LinkedIn' };
const SIGN = { community: 'Community Manager', advertising: 'Advertising', management: 'Leadership' };
const AD = { data: null, sel: null, edit: null, payload: null, arch: false };
async function loadAds(keepSel = true) {
  try {
    AD.data = await api('api/ads');
    if (!keepSel || !AD.data.pieces.some((p) => p.id === AD.sel)) { AD.sel = null; AD.payload = null; }
    if (AD.sel) AD.payload = await api(`api/ads/${encodeURIComponent(AD.sel)}/payload`);
  } catch (e) { if (e.message !== 'code') toast(e.message); }
  if (S.tab === 'ads') render();
}
const checkPill = (c) => `<span class="pill ${c.ok ? 'ok' : c.passed >= c.total - 2 ? 'warn' : 'crit'}">${c.ok ? 'Ready' : `${c.total - c.passed} to fix`}</span>`;
function adForm(p) {
  const A = AD.data, L = A.limits[p.platform || 'linkedin'] || {};
  const f = (k, label, o = {}) => {
    const v = p[k] == null ? '' : p[k];
    const max = o.max ? ` data-max="${o.max}"` : '';
    const cnt = o.max ? `<small class="counter" data-count="${k}">${String(v).length} / ${o.max}</small>` : '';
    const input = o.area ? `<textarea name="${k}" rows="${o.rows || 3}"${max}>${esc(v)}</textarea>`
      : o.opts ? `<select name="${k}">${o.opts.map(([val, t]) => `<option value="${esc(val)}"${String(v) === val ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`
      : `<input name="${k}" type="${o.type || 'text'}" value="${esc(v)}"${max}${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}>`;
    return `<label class="${o.wide ? 'wide' : ''}"><span>${esc(label)} ${cnt}</span>${input}${o.hint ? `<small>${o.hint}</small>` : ''}</label>`;
  };
  const isG = p.platform === 'google';
  return `<section class="card">${head(p.id ? 'Edit piece' : 'New piece', 'Fill what Advertising approved. The checklist updates when you save.')}
  <form id="ad-form" class="ad-form" data-id="${esc(p.id || '')}">
    ${f('name', 'Piece name', { wide: 1, ph: 'Developers · "Tu IA no vuelve a perder el objetivo"' })}
    ${f('platform', 'Platform', { opts: Object.entries(PLAT) })}
    ${f('language', 'Language', { opts: [['', 'Choose…'], ['es', 'Spanish'], ['en', 'English']] })}
    ${f('persona', 'Persona', { opts: [['', 'Choose…'], ...Object.entries(A.personas).map(([k, n]) => [k, `${k} · ${n}`])] })}
    ${f('format', 'Format', { ph: isG ? 'responsive search ad' : 'single image, video, carousel' })}
    ${isG ? '' : f('cta', 'Call to action', { opts: [['', 'Choose…'], ...['SIGN_UP', 'LEARN_MORE', 'GET_STARTED', 'REGISTER', 'DOWNLOAD', 'TRY_NOW'].map((c) => [c, c])] })}
    ${f('headline', 'Headline', { wide: 1, max: L.headline })}
    ${isG ? '' : f('primary_text', 'Primary text', { wide: 1, area: 1, max: L.primary_text })}
    ${f('description', isG ? 'Description' : 'Description (optional)', { wide: 1, max: L.description })}
    ${isG ? '' : f('creative_url', 'Creative link (image or video)', { wide: 1, ph: 'https://…' })}
    ${f('landing_url', 'Landing page', { wide: 1, ph: 'https://go.think4ever.com/latam' })}
    ${f('utm_source', 'utm_source', { ph: p.platform || 'linkedin' })}
    ${f('utm_medium', 'utm_medium', { ph: isG ? 'cpc' : 'paid_social' })}
    ${f('utm_campaign', 'utm_campaign', { ph: 'latam_co_launch' })}
    ${f('utm_content', 'utm_content', { ph: 'p01', hint: 'Must be the persona code.' })}
    ${isG ? f('keywords', 'Keywords (one per line or comma)', { wide: 1, area: 1 }) : ''}
    ${p.platform === 'meta' ? f('interests', 'Interests (comma separated)', { wide: 1 }) : ''}
    ${f('countries', 'Countries', { ph: 'CO' })}
    ${f('cities', 'Cities (optional)', { ph: 'Bogotá, Medellín' })}
    ${p.platform === 'meta' ? f('age_min', 'Age from', { type: 'number' }) + f('age_max', 'Age to', { type: 'number' }) : ''}
    ${f('budget_daily_usd', `Daily budget USD (cap ${A.budget_cap})`, { type: 'number' })}
    ${f('start', 'Start', { type: 'date' })}
    ${f('end', 'End', { type: 'date' })}
    <p class="wide note" style="margin:0">Approvals are given from the piece, after saving, by people other than the one who loaded it. Changing the copy, creative, targeting, budget, dates or links clears them.</p>
    ${f('notes', 'Notes', { wide: 1, area: 1, rows: 2 })}
    <div class="wide form-row"><button class="btn">${p.id ? 'Save' : 'Add piece'}</button><button type="button" class="btn secondary" data-ad-cancel>Cancel</button></div>
  </form></section>`;
}
function adDetail() {
  const p = AD.data.pieces.find((x) => x.id === AD.sel); if (!p) return '';
  const P = AD.payload;
  const json = P ? JSON.stringify(P.payload, null, 2) : '';
  return `<section class="card">${head(p.name, `${esc(PLAT[p.platform] || p.platform)} · ${esc(p.persona || 'no persona')}${p.example ? ' · example, never sent' : ''}`, checkPill(p.check))}
    <div class="grid g2">
      <div><h3 class="sub">Checklist (${p.check.passed} of ${p.check.total})</h3>
        <ul class="checklist">${p.check.checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}"><b>${c.ok ? '✓' : '✗'}</b><span>${esc(c.item)}${c.ok ? '' : `<small>${esc(c.fix)}</small>`}</span></li>`).join('')}</ul>
        <h3 class="sub">Final URL</h3><p class="mono-line"><code>${esc(P ? P.final_url : '')}</code> <button type="button" class="ghost" data-copy="url">Copy</button></p>
        <h3 class="sub">Approvals</h3>${p.example ? '<p class="note" style="margin-top:0">Examples are not approved.</p>' : `<div class="approvals">${Object.entries(SIGN).map(([k, t]) => (p.signoffs || {})[k] ? `<div class="appr on"><b>✓ ${t}</b><small>${esc((p.signed_by || {})[k] || '')}</small><button type="button" class="ghost" data-ad-unsign="${k}">Withdraw</button></div>` : `<div class="appr"><b>${t}</b><small>pending</small><button type="button" class="btn secondary" data-ad-sign="${k}">Approve</button></div>`).join('')}</div><p class="note">Loaded by ${esc(p.created_by || '–')}. That person cannot approve, and each approval comes from a different person.</p>`}
        <h3 class="sub">Sending</h3><p class="note" style="margin-top:0">${esc(P ? (P.live.ready ? 'Platform access is set. Sending stays manual until the connector is tested with the real account.' : P.live.why) : '')}</p>
        <div class="form-row">${p.example ? `<button type="button" class="btn secondary" data-ad-dup="${esc(p.id)}">Use as a starting point</button>` : `<button type="button" class="btn secondary" data-ad-edit="${esc(p.id)}">Edit</button><button type="button" class="btn secondary" data-ad-arch="${esc(p.id)}">${p.status === 'archived' ? 'Restore' : 'Archive'}</button>`}
          <button type="button" class="btn" data-ad-send="${esc(p.id)}"${!p.check.ok || p.example || !(P && P.live.ready) ? ' disabled' : ''}>Send to ${esc(PLAT[p.platform] || '')} (paused)</button></div></div>
      <div><h3 class="sub">API payload <button type="button" class="ghost" data-copy="payload">Copy</button></h3>
        <p class="note" style="margin-top:0">${esc(P ? P.payload.api : '')}. ${esc(P ? P.payload.note : '')}</p>
        <pre class="payload" id="ad-payload">${esc(json)}</pre>
        ${(p.log || []).length ? `<h3 class="sub">History</h3><ul class="history">${p.log.slice().reverse().map((l) => `<li><span>${esc(String(l.at).slice(0, 16).replace('T', ' '))}</span> <b>${esc(l.user)}</b> ${esc(l.action)}</li>`).join('')}</ul>` : ''}</div>
    </div></section>`;
}
function viewAds() {
  if (!AD.data) { loadAds(); return '<p class="loading">Loading the ad loader…</p>'; }
  const A = AD.data;
  const list = A.pieces.filter((p) => AD.arch || p.status !== 'archived');
  const real = A.pieces.filter((p) => !p.example && p.status !== 'archived');
  const byPlat = Object.keys(PLAT).map((k) => { const r = real.filter((p) => p.platform === k); return [k, r.length, r.filter((p) => p.check.ok).length]; });
  return `<section class="card">${head('Ad loader', 'Approved pieces from Advertising, checked and turned into the Google Ads, Meta and LinkedIn API calls', `<span class="pill ${A.mode === 'live' ? 'crit' : 'info'}">${A.mode === 'live' ? 'Live mode' : 'Test mode: nothing is sent'}</span>`)}
    <div class="stats">${byPlat.map(([k, n, ok]) => `<div class="stat"><span>${PLAT[k]}</span><b>${ok} / ${n}</b><small>pieces ready · ${esc(A.live[k].ready ? 'access set' : 'access pending')}</small></div>`).join('')}</div>
    <p class="note">Every campaign is created paused, with a daily budget at or under USD ${A.budget_cap}. A piece goes out only with the three sign-offs and a full checklist. Whatever the loader cannot send yet is loaded by hand from the payload or the export.</p>
    <div class="form-row" style="margin-top:12px"><button type="button" class="btn" data-ad-new>New piece</button><button type="button" class="btn secondary" data-ad-export>Download all payloads (JSON)</button>
      <label class="switch"><input type="checkbox" id="ad-arch"${AD.arch ? ' checked' : ''}> Show archived</label></div></section>
  ${AD.edit ? adForm(AD.edit) : ''}
  <section class="card">${head('Pieces', `${real.length} active · examples show how a piece looks and are never sent`)}
    ${list.length ? table([
      { t: 'Piece', f: (r) => `<button type="button" class="linkish" data-ad-sel="${esc(r.id)}">${esc(r.name)}</button>${r.example ? ' <span class="pill mute">Example</span>' : ''}${r.status === 'archived' ? ' <span class="pill mute">Archived</span>' : ''}` },
      { t: 'Platform', f: (r) => esc(PLAT[r.platform] || r.platform || '–') },
      { t: 'Persona', f: (r) => `<span title="${esc(A.personas[r.persona] || '')}">${esc(r.persona || '–')}</span>` },
      { t: 'Sign-offs', f: (r) => Object.keys(SIGN).map((k) => `<span class="dot ${(r.signoffs || {})[k] ? 'on' : ''}" title="${SIGN[k]}"></span>`).join('') },
      { t: 'Budget/day', num: 1, f: (r) => money(r.budget_daily_usd) },
      { t: 'Checklist', f: (r) => checkPill(r.check) },
    ], list, (r) => (r.id === AD.sel ? 'sel' : '')) : '<div class="empty">No pieces yet. Add the first one with <b>New piece</b>.</div>'}</section>
  ${AD.sel ? adDetail() : ''}`;
}
function adFromForm(form) {
  const fd = new FormData(form), o = {};
  for (const [k, v] of fd.entries()) if (!k.startsWith('so_')) o[k] = typeof v === 'string' ? v.trim() : v;
  for (const k of ['budget_daily_usd', 'age_min', 'age_max']) if (o[k] !== undefined && o[k] !== '') o[k] = Number(o[k]);
  return o;
}

// ---------- CSV
function parseCSV(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',' || c === ';') { cells.push(cur); cur = ''; } else cur += c;
    }
    cells.push(cur); rows.push(cells.map((x) => x.trim()));
  }
  return rows;
}
function toCSV() {
  const lines = ['source,metric,date,dim,dim_value,value'];
  for (const r of M()) lines.push([r.source, r.metric, r.date, r.dim, `"${String(r.dim_value).replace(/"/g, '""')}"`, r.value].join(','));
  return lines.join('\n');
}

// ---------- render and events
const VIEWS = { overview: viewOverview, acquisition: viewAcquisition, conversion: viewConversion, channels: viewChannels, ads: viewAds, sources: viewSources };
function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.tab));
  main.innerHTML = VIEWS[S.tab]();
  const last = S.data.sources.filter((s) => s.last_sync).map((s) => s.last_sync).sort().pop();
  document.getElementById('foot').textContent = `Period ${win(S.from, S.to)} · last data load ${last ? last.slice(0, 16).replace('T', ' ') : 'none'} · Research, Think4Ever LATAM`;
}

async function load() {
  try { S.data = await api('api/data'); render(); }
  catch (e) { if (e.message !== 'code') main.innerHTML = `<section class="card"><h2>Could not load the data</h2><p class="note">${esc(e.message)}. Reload the page; if it persists, check the app logs.</p></section>`; }
}

function setPeriod(v) {
  S.period = v;
  document.getElementById('custom-range').hidden = v !== 'custom';
  const t = today();
  if (v === 'launch') { S.from = LAUNCH; S.to = t; }
  else if (v !== 'custom') { S.to = t; S.from = addDays(t, -(Number(v) - 1)); }
  else { S.from = document.getElementById('from').value || S.from; S.to = document.getElementById('to').value || S.to; }
  if (S.from > S.to) [S.from, S.to] = [S.to, S.from];
  store('t4e-growth-period', v);
  if (S.data) render();
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  S.tab = b.dataset.tab; store('t4e-growth-tab', S.tab); if (S.data) render();
  if (history.replaceState) history.replaceState(null, '', '#' + S.tab);
});
document.getElementById('period').addEventListener('change', (e) => setPeriod(e.target.value));
['from', 'to'].forEach((id) => document.getElementById(id).addEventListener('change', () => setPeriod('custom')));
document.getElementById('ex-int').addEventListener('change', (e) => { S.exInt = e.target.checked; if (S.data) render(); });
document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await fetch('api/logout', { method: 'POST' }); } catch (e) { /* the session cookie expires anyway */ }
  location.href = 'login.html';
});
document.getElementById('theme-btn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark'; store('t4e-growth-theme', document.documentElement.dataset.theme);
});

main.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'note-form') {
    try {
      await api('api/notes', { method: 'POST', body: JSON.stringify({ date: document.getElementById('note-date').value, kind: document.getElementById('note-kind').value, label: document.getElementById('note-label').value }) });
      toast('Note added'); await load();
    } catch (err) { toast(err.message); }
  }
  if (e.target.id === 'csv-form') {
    const file = document.getElementById('csv-file').files[0]; if (!file) return;
    const rows = parseCSV(await file.text());
    const hdr = rows[0].map((h) => h.toLowerCase());
    const hasHeader = hdr.includes('date') && hdr.includes('value');
    const idx = (n, d) => (hasHeader ? hdr.indexOf(n) : d);
    const iD = idx('date', 0), iM = idx('metric', 1), iV = idx('value', 2), iDim = idx('dim', 3), iDv = idx('dim_value', 4);
    const metrics = (hasHeader ? rows.slice(1) : rows).map((r) => ({ date: r[iD], metric: r[iM], value: Number(String(r[iV]).replace(/[$\s]/g, '')), dim: iDim >= 0 ? r[iDim] || '' : '', dim_value: iDv >= 0 ? r[iDv] || '' : '' }))
      .filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.date) && m.metric && Number.isFinite(m.value));
    if (!metrics.length) return toast('No valid rows: use date (YYYY-MM-DD), metric and value');
    const src = document.getElementById('csv-source').value;
    try {
      const r = await api('api/ingest', { method: 'POST', headers: { 'x-load-how': 'csv' }, body: JSON.stringify({ source: src, from: metrics.map((m) => m.date).sort()[0], to: metrics.map((m) => m.date).sort().pop(), metrics }) });
      toast(`${r.metrics} rows loaded`); await load();
    } catch (err) { toast(err.message); }
  }
});
main.addEventListener('submit', async (e) => {
  if (e.target.id !== 'ad-form') return;
  const id = e.target.dataset.id, body = adFromForm(e.target);
  try {
    const r = await api(id ? `api/ads/${encodeURIComponent(id)}` : 'api/ads', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    const cleared = (r.log || []).slice(-1).some((l) => /approvals cleared/.test(l.action));
    toast(cleared ? 'Saved. The approvals were cleared because the piece changed.' : r.check.ok ? 'Saved: ready to load' : `Saved: ${r.check.total - r.check.passed} item(s) to fix`);
    AD.edit = null; AD.sel = r.id; await loadAds();
  } catch (err) { toast(err.message); }
});
main.addEventListener('input', (e) => {
  const t = e.target; if (!t.dataset || !t.dataset.max) return;
  const c = main.querySelector(`[data-count="${t.name}"]`);
  if (c) { c.textContent = `${t.value.length} / ${t.dataset.max}`; c.classList.toggle('over', t.value.length > Number(t.dataset.max)); }
});
main.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'ad-arch') { AD.arch = t.checked; render(); return; }
  const form = t.closest && t.closest('#ad-form'); if (!form) return;
  if (t.name === 'persona') { const u = form.elements.utm_content; if (u && (!u.value || /^p\d\d$/.test(u.value))) u.value = t.value; }
  if (t.name === 'platform') {
    // The fields change with the platform: keep what was typed and draw the form again.
    const cur = adFromForm(form); const src = form.elements.utm_source;
    if (src && (!src.value || PLAT[src.value])) cur.utm_source = t.value;
    if (!cur.utm_medium || ['cpc', 'paid_social'].includes(cur.utm_medium)) cur.utm_medium = t.value === 'google' ? 'cpc' : 'paid_social';
    AD.edit = { ...AD.edit, ...cur, id: form.dataset.id || undefined }; render();
  }
});
main.addEventListener('click', async (e) => {
  const a = (k) => e.target.closest(`[data-${k}]`);
  let el;
  if ((el = a('ad-new'))) { AD.edit = { platform: 'linkedin', utm_source: 'linkedin', utm_medium: 'paid_social', countries: 'CO', utm_campaign: 'latam_co_launch', landing_url: 'https://go.think4ever.com/latam' }; render(); main.querySelector('#ad-form input').focus(); return; }
  if ((el = a('ad-cancel'))) { AD.edit = null; render(); return; }
  if ((el = a('ad-sel'))) { AD.sel = el.dataset.adSel; AD.edit = null; await loadAds(); main.querySelector('#ad-payload')?.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if ((el = a('ad-edit'))) { AD.edit = { ...AD.data.pieces.find((p) => p.id === el.dataset.adEdit) }; render(); main.querySelector('#ad-form')?.scrollIntoView({ behavior: 'smooth' }); return; }
  if ((el = a('ad-dup'))) {
    const { id, check, example, signoffs, signed_by, status, created_by, created_at, updated, updated_by, log, ...rest } = AD.data.pieces.find((p) => p.id === el.dataset.adDup);
    AD.edit = { ...rest, name: rest.name.replace(/^EXAMPLE · /, '') }; render(); main.querySelector('#ad-form')?.scrollIntoView({ behavior: 'smooth' }); return;
  }
  if ((el = a('ad-arch'))) {
    const p = AD.data.pieces.find((x) => x.id === el.dataset.adArch);
    try { await api(`api/ads/${encodeURIComponent(p.id)}`, { method: 'PUT', body: JSON.stringify({ status: p.status === 'archived' ? 'draft' : 'archived' }) }); toast(p.status === 'archived' ? 'Restored' : 'Archived'); await loadAds(); } catch (err) { toast(err.message); }
    return;
  }
  if ((el = a('ad-sign')) || (el = a('ad-unsign'))) {
    const p = AD.data.pieces.find((x) => x.id === AD.sel); const k = el.dataset.adSign || el.dataset.adUnsign;
    try { await api(`api/ads/${encodeURIComponent(p.id)}`, { method: 'PUT', body: JSON.stringify({ signoffs: { ...p.signoffs, [k]: !!el.dataset.adSign } }) }); toast(el.dataset.adSign ? `Approved as ${SIGN[k]}` : 'Approval withdrawn'); await loadAds(); } catch (err) { toast(err.message); }
    return;
  }
  if ((el = a('ad-send'))) { try { await api(`api/ads/${encodeURIComponent(el.dataset.adSend)}/send`, { method: 'POST' }); toast('Sent, paused'); } catch (err) { toast(err.message); } return; }
  if ((el = a('copy'))) {
    const txt = el.dataset.copy === 'url' ? AD.payload.final_url : JSON.stringify(AD.payload.payload, null, 2);
    try { await navigator.clipboard.writeText(txt); toast('Copied'); } catch (err) { toast('Select the text and copy it by hand'); }
    return;
  }
  if ((el = a('ad-export'))) {
    try {
      const j = await api('api/ads/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' }));
      const l = Object.assign(document.createElement('a'), { href: url, download: `ad-loader-payloads-${today()}.json` });
      document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { toast(err.message); }
  }
});
main.addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del-note]');
  if (del) { try { await api('api/notes/' + encodeURIComponent(del.dataset.delNote), { method: 'DELETE' }); toast('Note removed'); await load(); } catch (err) { toast(err.message); } return; }
  const sync = e.target.closest('[data-sync]');
  if (sync) { sync.disabled = true; sync.textContent = 'Syncing…'; try { const r = await api('api/sync/' + sync.dataset.sync, { method: 'POST' }); toast(`Synced: ${r.metrics} rows`); await load(); } catch (err) { toast(err.message); sync.disabled = false; sync.textContent = 'Sync now'; } return; }
  if (e.target.id === 'dl-csv') {
    e.preventDefault();
    const url = URL.createObjectURL(new Blob([toCSV()], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `latam-growth-${today()}.csv` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});

// boot
(() => {
  const th = store('t4e-growth-theme'); if (th) document.documentElement.dataset.theme = th;
  const hash = location.hash.slice(1);
  if (VIEWS[hash]) S.tab = hash; else { const t = store('t4e-growth-tab'); if (VIEWS[t]) S.tab = t; }
  const p = store('t4e-growth-period'); if (p && p !== 'custom') { document.getElementById('period').value = p; setPeriod(p); }
  load();
  // The role decides which controls show; the server enforces the same rule on every write.
  api('api/me').then((me) => { document.body.dataset.role = me.role || 'admin'; }).catch(() => {});
})();
