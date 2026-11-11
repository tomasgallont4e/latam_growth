'use strict';
// Read-only PostHog reader for the Product usage view (user-approved exception to memory #111,
// same pattern as lib/ga4Range.js). It reuses POSTHOG_HOST / POSTHOG_PROJECT_ID / POSTHOG_API_KEY
// and the internal-account rule in lib/internal.js. Queries run one after another per load, at most
// maxConcurrent loads at once, cached in memory per cutoff. Nothing is written to the database,
// no person id or email leaves PostHog, and lib/connectors.js plus the PostHog sync are untouched.
// Days are calendar days in America/Bogota; data runs from LAUNCH_DATE through the cutoff (yesterday).
const internal = require('./internal');
const P = require('./productUsage');

const TZ = 'America/Bogota';
const ROW_LIMIT = 50000;
const CACHE_MAX = 50;
const SAFE_EVENT = /^[A-Za-z0-9_.$:-]{1,120}$/;
const SAFE_PROP = /^[A-Za-z0-9_]{1,80}$/;

function validDay(d) {
  const s = String(d || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';
const day = (v) => (validDay(v) ? String(v) : null);
const list = (v) => (Array.isArray(v) ? v.map(String).filter(validDay) : []);

// Logical event key -> PostHog event name. project_created follows the connector's variable.
function eventNames(env) {
  const configured = String(env.POSTHOG_PROJECT_CREATED_EVENT || 'project_created');
  return {
    identify: '$identify',
    signed_in: 'signed_in',
    project_created: SAFE_EVENT.test(configured) ? configured : 'project_created',
    credits_consumed: 'credits_consumed',
    subscription_started: 'subscription_started',
    subscription_cancelled: 'subscription_cancelled',
  };
}

function createReader(opts = {}) {
  const env = opts.env || process.env;
  const fetchImpl = opts.fetch || ((...args) => fetch(...args));
  const nowMs = opts.now || (() => Date.now());
  const yesterday = opts.yesterday || (() => P.bogotaYesterday(new Date(nowMs())));
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : 30 * 60 * 1000;
  const maxConcurrent = Math.max(1, opts.maxConcurrent || 2);
  const launch = () => env.LAUNCH_DATE || '2026-10-01';

  const cache = new Map();
  const inflight = new Map();
  const waiting = [];
  let active = 0;

  async function slot(fn) {
    if (active >= maxConcurrent) await new Promise((resolve) => waiting.push(resolve));
    else active++;
    try { return await fn(); }
    finally {
      const next = waiting.shift();
      if (next) next(); else active--;
    }
  }

  async function q(sql) {
    const host = String(env.POSTHOG_HOST || '').replace(/\/$/, '');
    const r = await fetchImpl(`${host}/api/projects/${encodeURIComponent(env.POSTHOG_PROJECT_ID)}/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.POSTHOG_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql } }),
    });
    const text = await r.text();
    if (!r.ok) throw fail(502, `PostHog request failed (${r.status}) ${String(text || '').slice(0, 200)}`);
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { throw fail(502, 'PostHog returned an invalid response'); }
    return { rows: Array.isArray(body.results) ? body.results : [], hasMore: body.hasMore === true };
  }

  async function load(cutoff) {
    const from = launch();
    const ev = eventNames(env);
    const dayExpr = `toDate(toTimeZone(timestamp, '${TZ}'))`;
    // Coarse UTC bound for the scan, exact Bogota calendar days for the result.
    const window = `timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${cutoff}'), 2) AND ${dayExpr} >= toDate('${from}') AND ${dayExpr} <= toDate('${cutoff}')`;
    const qa = `coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1')`;
    const internalSql = internal.hogql({
      email: `coalesce(toString(person.properties.email), '')`,
      company: `coalesce(toString(person.properties.company), '')`,
      name: `coalesce(toString(person.properties.name), '')`,
    });
    // Account created = first $identify since launch for people created on or after launch (as ph_accounts).
    const createdExpr = `toString(if(any(person.created_at) >= toDate('${from}'), minIf(${dayExpr}, event = '$identify'), toDate('1970-01-01')))`;
    const inList = (names) => names.map((n) => `'${n}'`).join(', ');
    // PostHog returns 1970-01-01 for "no matching event"; anything before launch is no date.
    const since = (v) => { const d = day(v); return d && d >= from ? d : null; };

    const out = {
      from, cutoff, timezone: TZ, internal_patterns: internal.PATTERNS,
      events: {}, accounts: null, projectDays: null, credits: null, subscriptions: null,
      truncated: {}, warnings: [], pulled_at: new Date(nowMs()).toISOString(), cached: false,
    };

    // 1. Inventory: which events exist in the window. A missing event is "waiting", never zero.
    const inv = await q(`SELECT event, count() AS inventory_n FROM events WHERE event IN (${inList(Object.values(ev))}) AND ${window} GROUP BY event`);
    const counts = {};
    for (const [name, n] of inv.rows) counts[String(name)] = Number(n) || 0;
    for (const [key, name] of Object.entries(ev)) out.events[key] = { name, count: counts[name] || 0, available: (counts[name] || 0) > 0 };
    const has = (k) => out.events[k].available;

    async function section(name, fn) {
      try { await fn(); }
      catch (e) {
        const msg = String((e && e.message) || 'query failed').slice(0, 200);
        out.warnings.push(`${name}: ${msg}`);
        console.warn(`product metrics ${name} skipped:`, msg);
      }
    }

    // 2. One row per person: account created, first project, sign-in days, internal flag. No ids.
    await section('accounts', async () => {
      const r = await q(`SELECT ${createdExpr} AS created,
          toString(minIf(${dayExpr}, event = '${ev.project_created}')) AS first_project,
          groupUniqArrayIf(toString(${dayExpr}), event = '${ev.signed_in}') AS signin_days,
          any(${internalSql}) AS internal
        FROM events WHERE event IN (${inList([ev.identify, ev.signed_in, ev.project_created])}) AND ${window} AND ${qa}
        GROUP BY person_id LIMIT ${ROW_LIMIT + 1}`);
      out.truncated.accounts = r.hasMore || r.rows.length > ROW_LIMIT;
      out.accounts = r.rows.slice(0, ROW_LIMIT).map(([created, firstProject, signins, isInternal]) => ({
        created: since(created), first_project: since(firstProject), signin_days: list(signins).filter((x) => x >= from), internal: bool(isInternal),
      }));
    });

    // 3. Distinct projects per day.
    if (has('project_created')) await section('projects', async () => {
      const r = await q(`SELECT toString(${dayExpr}) AS d, ${internalSql} AS internal,
          count(DISTINCT coalesce(nullIf(toString(properties.project_id), ''), toString(uuid))) AS projects
        FROM events WHERE event = '${ev.project_created}' AND ${window} AND ${qa}
        GROUP BY d, internal ORDER BY d LIMIT 5001`);
      out.projectDays = r.rows.map(([d, isInternal, n]) => ({ date: day(d), internal: bool(isInternal), projects: Number(n) || 0 }));
    });

    // 4. Credits: amount per day, and each account's first use (for time to first use).
    if (has('credits_consumed')) await section('credits', async () => {
      const configured = String(env.POSTHOG_CREDITS_PROPERTY || 'amount');
      const prop = SAFE_PROP.test(configured) ? configured : 'amount';
      const daily = await q(`SELECT toString(${dayExpr}) AS d, ${internalSql} AS internal,
          sum(coalesce(toFloat(properties.${prop}), 0)) AS credits,
          countIf(toFloat(properties.${prop}) IS NULL) AS missing_amount
        FROM events WHERE event = '${ev.credits_consumed}' AND ${window} AND ${qa}
        GROUP BY d, internal ORDER BY d LIMIT 5001`);
      const people = await q(`SELECT ${createdExpr} AS created,
          toString(minIf(${dayExpr}, event = '${ev.credits_consumed}')) AS first_credit,
          any(${internalSql}) AS internal
        FROM events WHERE event IN (${inList([ev.identify, ev.credits_consumed])}) AND ${window} AND ${qa}
        GROUP BY person_id HAVING countIf(event = '${ev.credits_consumed}') > 0 LIMIT ${ROW_LIMIT + 1}`);
      out.truncated.credits = people.hasMore || people.rows.length > ROW_LIMIT;
      out.credits = {
        property: prop,
        days: daily.rows.map(([d, isInternal, credits, missing]) => ({ date: day(d), internal: bool(isInternal), credits: Number(credits) || 0, missing_amount: Number(missing) || 0 })),
        people: people.rows.slice(0, ROW_LIMIT).map(([created, first, isInternal]) => ({ created: since(created), first_credit: since(first), internal: bool(isInternal) })),
      };
    });

    // 5. Subscriptions: each account's start and cancel days (churn is computed in productUsage).
    if (has('subscription_started') || has('subscription_cancelled')) await section('subscriptions', async () => {
      const r = await q(`SELECT groupArrayIf(toString(${dayExpr}), event = '${ev.subscription_started}') AS starts,
          groupArrayIf(toString(${dayExpr}), event = '${ev.subscription_cancelled}') AS cancels,
          any(${internalSql}) AS internal
        FROM events WHERE event IN (${inList([ev.subscription_started, ev.subscription_cancelled])}) AND ${window} AND ${qa}
        GROUP BY person_id LIMIT ${ROW_LIMIT + 1}`);
      out.truncated.subscriptions = r.hasMore || r.rows.length > ROW_LIMIT;
      out.subscriptions = r.rows.slice(0, ROW_LIMIT).map(([starts, cancels, isInternal]) => ({ starts: list(starts), cancels: list(cancels), internal: bool(isInternal) }));
    });

    return out;
  }

  async function metrics(cutoffIn) {
    const cutoff = cutoffIn == null || cutoffIn === '' ? yesterday() : String(cutoffIn);
    if (!validDay(cutoff)) throw fail(400, 'cutoff must be a date in YYYY-MM-DD format');
    if (cutoff < launch()) throw fail(400, `cutoff must be on or after ${launch()}`);
    if (cutoff > yesterday()) throw fail(400, 'cutoff cannot be after yesterday (America/Bogota)');
    if (!['POSTHOG_HOST', 'POSTHOG_PROJECT_ID', 'POSTHOG_API_KEY'].every((k) => String(env[k] || '').trim())) throw fail(409, 'PostHog is not configured.');
    const hit = cache.get(cutoff);
    if (hit && nowMs() - hit.at < ttlMs) return { ...hit.data, cached: true };
    if (inflight.has(cutoff)) return inflight.get(cutoff);
    const p = slot(() => load(cutoff)).then((data) => {
      cache.delete(cutoff);
      cache.set(cutoff, { at: nowMs(), data });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return data;
    }).finally(() => inflight.delete(cutoff));
    inflight.set(cutoff, p);
    return p;
  }

  return { metrics };
}

const reader = createReader();
module.exports = { createReader, eventNames, validDay, TZ, ROW_LIMIT, metrics: (cutoff) => reader.metrics(cutoff) };
