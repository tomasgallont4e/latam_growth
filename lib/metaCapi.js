'use strict';
// Meta Conversions API: one CompleteRegistration per new external account.
//
// The portal creates accounts on the server (account_created in PostHog, since 2026-10-29), so the
// Meta Pixel in the browser never sees the sign-up. This job reads those accounts from PostHog and
// sends them to the company dataset, so paid campaigns can optimize for accounts instead of clicks.
//
// - event_id = reg_<portal_user_id>: the same id a pixel on the portal would use, so Meta drops the
//   duplicate if both ever arrive.
// - Matching: email, first and last name and the account id, hashed with SHA-256 as Meta requires.
//   When the same person has browser events in PostHog, their user agent and IP are added (the
//   server event carries the server's IP, which is never sent). fbc comes from an fbclid URL, if any.
// - Internal and test accounts are never sent (lib/internal.js, channels.isTest, is_test, qa_probe).
// - Meta only accepts website events up to 7 days old, so the window is the last 7 days.
// - Each account is sent once: live sends are recorded in the store (kind 'capi_sent').
//
// Modes, from the service variables:
//   no META_CAPI_LIVE and no META_CAPI_TEST_CODE -> dry: builds the events, sends nothing
//   META_CAPI_TEST_CODE set                       -> test: sends to Events Manager > Test events only
//   META_CAPI_LIVE=1 (and no test code)            -> live: real events, recorded as sent
// Needs META_PIXEL_ID, META_CAPI_TOKEN and the PostHog variables. No email ever leaves this module
// except hashed inside the request to Meta; summaries carry counts and event ids only.
const crypto = require('crypto');
const internal = require('./internal');
const channels = require('../public/js/channels');

const GRAPH_VERSION = /^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION || '') ? process.env.META_GRAPH_VERSION : 'v23.0';
const WINDOW_DAYS = 7;
const SOURCE_URL = 'https://portal.think4ever.com/';
const STORE_KIND = 'capi_sent';
const REQUIRED = ['META_PIXEL_ID', 'META_CAPI_TOKEN', 'POSTHOG_HOST', 'POSTHOG_PROJECT_ID', 'POSTHOG_API_KEY'];

const env = (k) => String(process.env[k] || '').trim();
const configured = () => REQUIRED.every((k) => env(k));
const mode = () => (env('META_CAPI_TEST_CODE') ? 'test' : env('META_CAPI_LIVE') === '1' ? 'live' : 'dry');

const sha = (v) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');
// PostHog returns '' , 'null' or 'None' for a missing property depending on the path.
const clean = (v) => { const s = String(v == null ? '' : v).trim(); return ['null', 'none', 'undefined'].includes(s.toLowerCase()) ? '' : s; };
const normEmail = (v) => clean(v).toLowerCase();
// Names: lower case, no punctuation or spaces (Meta's normalization); accents stay as UTF-8.
const normName = (v) => clean(v).toLowerCase().replace(/[\s'".,\-_()]/g, '');

function splitName(row) {
  let fn = clean(row.fn), ln = clean(row.ln);
  const full = clean(row.name);
  if (!fn && full) fn = full.split(/\s+/)[0];
  if (!ln && full && full.split(/\s+/).length > 1) ln = full.split(/\s+/).slice(1).join(' ');
  return { fn, ln };
}

// fbc = fb.1.<ms>.<fbclid>, built from the first URL that carried fbclid.
function fbcFrom(url, tsSeconds) {
  const m = /[?&#]fbclid=([^&#\s]+)/.exec(clean(url));
  return m ? `fb.1.${tsSeconds * 1000}.${m[1]}` : '';
}

const isTrue = (v) => ['true', '1'].includes(clean(v).toLowerCase());

// Why a row is left out ('' when it is sent).
function skipReason(row, nowSeconds) {
  const email = normEmail(row.email);
  if (!clean(row.uid)) return 'no_account_id';
  if (!email.includes('@')) return 'no_email';
  if (isTrue(row.is_test) || isTrue(row.qa)) return 'test';
  if (internal.isInternal({ email, company: row.company, name: row.name })) return 'internal';
  if (channels.isTest({ source: clean(row.src), medium: clean(row.med), campaign: clean(row.camp) })) return 'test';
  const ts = Number(row.ts);
  if (!ts || nowSeconds - ts > WINDOW_DAYS * 86400 - 300) return 'older_than_7_days';
  if (ts > nowSeconds + 60) return 'future';
  return '';
}

function buildEvent(row) {
  const ts = Number(row.ts);
  const { fn, ln } = splitName(row);
  const user_data = { em: [sha(normEmail(row.email))], external_id: [sha(clean(row.uid))] };
  if (normName(fn)) user_data.fn = [sha(normName(fn))];
  if (normName(ln)) user_data.ln = [sha(normName(ln))];
  const ua = clean(row.ua), ip = clean(row.ip);
  if (ua.length > 20) {
    user_data.client_user_agent = ua;
    if (ip) user_data.client_ip_address = ip;
  }
  const fbc = fbcFrom(row.fburl, ts);
  if (fbc) user_data.fbc = fbc;
  const custom_data = { status: 'created', content_name: 'account_created' };
  if (clean(row.method)) custom_data.method = clean(row.method);
  if (clean(row.build_mode)) custom_data.build_mode = clean(row.build_mode);
  return {
    event_name: 'CompleteRegistration',
    event_time: ts,
    event_id: `reg_${clean(row.uid)}`,
    action_source: 'website',
    event_source_url: SOURCE_URL,
    user_data,
    custom_data,
  };
}

// One row per person whose FIRST account_created falls in the last 7 days. Browser user agent and IP
// come from the same person's latest browser event in the last 30 days.
const s = (x) => `coalesce(toString(${x}), '')`;
// Person property, or the $set that account_created carries when the person record lacks it.
const fromPersonOrSet = (k) => `coalesce(nullIf(any(${s(`person.properties.${k}`)}), ''), argMinIf(${s(`properties.$set.${k}`)}, timestamp, event = 'account_created'))`;
const ACCOUNTS_SQL = `SELECT uid, ts, email, fname, lname, name, company, method, build_mode, is_test, qa, src, med, camp, ua, ip, fburl FROM (
  SELECT person_id,
    argMinIf(${s('properties.portal_user_id')}, timestamp, event = 'account_created') AS uid,
    toUnixTimestamp(minIf(timestamp, event = 'account_created')) AS ts,
    ${fromPersonOrSet('email')} AS email,
    ${fromPersonOrSet('first_name')} AS fname,
    ${fromPersonOrSet('last_name')} AS lname,
    ${fromPersonOrSet('name')} AS name,
    any(${s('person.properties.company')}) AS company,
    argMinIf(${s('properties.signup_source')}, timestamp, event = 'account_created') AS method,
    argMinIf(${s('properties.build_mode')}, timestamp, event = 'account_created') AS build_mode,
    any(${s('person.properties.is_test')}) AS is_test,
    maxIf(1, event = 'account_created' AND ${s('properties.qa_probe')} IN ('true', '1')) AS qa,
    any(${s('person.properties.utm_source_first')}) AS src,
    any(${s('person.properties.utm_medium_first')}) AS med,
    any(${s('person.properties.utm_campaign_first')}) AS camp,
    argMaxIf(${s('properties.$raw_user_agent')}, timestamp, length(${s('properties.$raw_user_agent')}) > 20) AS ua,
    argMaxIf(${s('properties.$ip')}, timestamp, length(${s('properties.$raw_user_agent')}) > 20) AS ip,
    maxIf(${s('properties.$current_url')}, position(${s('properties.$current_url')}, 'fbclid=') > 0) AS fburl,
    countIf(event = 'account_created') AS created
  FROM events
  WHERE timestamp >= now() - INTERVAL 30 DAY
  GROUP BY person_id
  HAVING created > 0 AND minIf(timestamp, event = 'account_created') >= now() - INTERVAL ${WINDOW_DAYS} DAY
) ORDER BY ts LIMIT 2000`;
const COLS = ['uid', 'ts', 'email', 'fn', 'ln', 'name', 'company', 'method', 'build_mode', 'is_test', 'qa', 'src', 'med', 'camp', 'ua', 'ip', 'fburl'];

async function posthogRows() {
  const host = env('POSTHOG_HOST').replace(/\/$/, '');
  const r = await fetch(`${host}/api/projects/${env('POSTHOG_PROJECT_ID')}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('POSTHOG_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: ACCOUNTS_SQL } }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`PostHog ${r.status} ${text.slice(0, 200)}`);
  const j = text ? JSON.parse(text) : {};
  return (j.results || []).map((vals) => Object.fromEntries(COLS.map((c, i) => [c, vals[i]])));
}

// The token goes in the body, never in the URL, so it stays out of proxy and access logs.
async function sendToMeta(events, testCode) {
  const body = { data: events, access_token: env('META_CAPI_TOKEN') };
  if (testCode) body.test_event_code = testCode;
  const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(env('META_PIXEL_ID'))}/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text.slice(0, 200) }; }
  if (!r.ok) throw new Error(`Meta ${r.status} ${(j.error && (j.error.error_user_msg || j.error.message)) || text.slice(0, 200)}`);
  return j;
}

// rows/send/now are injectable for tests. forceDry turns any mode into a dry run (admin preview).
async function run({ store, forceDry = false, rows: rowsIn, send = sendToMeta, now = Date.now() } = {}) {
  const m = forceDry ? 'dry' : mode();
  const nowSeconds = Math.floor(now / 1000);
  const rows = rowsIn || await posthogRows();
  const sent = new Set((await store.list(STORE_KIND)).map((r) => r._k));
  const skipped = {};
  const seen = new Set();
  const events = [];
  for (const row of rows) {
    const uid = clean(row.uid);
    if (uid && seen.has(uid)) continue;
    if (uid) seen.add(uid);
    let why = skipReason(row, nowSeconds);
    if (!why && sent.has(uid)) why = 'already_sent';
    if (why) { skipped[why] = (skipped[why] || 0) + 1; continue; }
    events.push(buildEvent(row));
  }
  const summary = {
    mode: m, at: new Date(now).toISOString(), found: rows.length, eligible: events.length, skipped,
    with_browser_match: events.filter((e) => e.user_data.client_user_agent).length,
    event_ids: events.map((e) => e.event_id),
  };
  if (m === 'dry' || !events.length) return { ...summary, sent: 0 };

  const testCode = m === 'test' ? env('META_CAPI_TEST_CODE') : '';
  let received = 0;
  const messages = [];
  for (let i = 0; i < events.length; i += 500) {
    const batch = events.slice(i, i + 500);
    const res = await send(batch, testCode);
    received += Number(res.events_received || 0);
    if (Array.isArray(res.messages)) messages.push(...res.messages.map(String).slice(0, 5));
    if (m === 'live') {
      for (const e of batch) await store.upsert(STORE_KIND, e.event_id.slice(4), { event_id: e.event_id, event_time: e.event_time, sent_at: new Date().toISOString() });
    }
  }
  return { ...summary, sent: events.length, events_received: received, messages };
}

module.exports = { run, configured, mode, buildEvent, skipReason, fbcFrom, REQUIRED, ACCOUNTS_SQL, STORE_KIND };
