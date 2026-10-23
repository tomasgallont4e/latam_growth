'use strict';
const path = require('path');
// The process manager can start Node from another working directory. Load the
// service's .env beside this file rather than resolving it from process.cwd().
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const store = require('./lib/store');
const seed = require('./lib/seed');
const ingest = require('./lib/ingest');
const CATALOG = require('./lib/sources');
const { connectors, configured, REQUIRED } = require('./lib/connectors');
const auth = require('./lib/auth');
const ads = require('./lib/adloader');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));

app.get(['/health', '/api/health'], async (req, res) => {
  try { await store.ping(); res.json({ status: 'ok', store: store.kind }); }
  catch (e) { res.status(503).json({ status: 'error', error: e.message }); }
});

// Login: every page and API route below needs a session (DASH_USERS in the service variables).
auth.mount(app);
app.use(express.static(path.join(__dirname, 'public')));

// Optional team code: when TEAM_CODE is set, the API asks for it.
app.use('/api', (req, res, next) => {
  const code = process.env.TEAM_CODE;
  if (!code || req.get('x-team-code') === code) return next();
  res.status(401).json({ error: 'code' });
});

async function sourcesView() {
  const live = Object.fromEntries((await store.list('source')).map((s) => [s._k, s]));
  return CATALOG.map((c) => {
    const l = live[c.key] || {};
    return {
      key: c.key, name: c.name, area: c.area, provides: c.provides, connect: c.connect, env: c.env,
      state: l.state || c.state, note: l.note || c.note, last_sync: l.last_sync || '', window: l.window || '',
      auto: configured(c.key),
    };
  });
}

app.get('/api/data', async (req, res, next) => {
  try {
    const clean = (rows) => rows.map(({ _at, ...r }) => r);
    res.json({
      generated_at: new Date().toISOString(),
      metrics: clean(await store.list('metric')),
      snapshots: clean(await store.list('snapshot')),
      events: clean(await store.list('event')),
      notes: clean(await store.list('note')),
      sources: await sourcesView(),
      synclog: clean(await store.list('synclog')).slice(-30).reverse(),
    });
  } catch (e) { next(e); }
});

// Data loads (Research, CSV import, connectors). INGEST_KEY, when set, protects this route.
app.post('/api/ingest', async (req, res, next) => {
  try {
    const key = process.env.INGEST_KEY;
    if (key && req.get('x-ingest-key') !== key) return res.status(401).json({ error: 'ingest key' });
    res.json(await ingest(req.body, req.get('x-load-how') === 'csv' ? 'csv' : 'api'));
  } catch (e) { e.status ? res.status(e.status).json({ error: e.message }) : next(e); }
});

app.post('/api/sync/:source', async (req, res) => {
  const k = req.params.source;
  if (!connectors[k]) return res.status(404).json({ error: 'No automatic connector for this source' });
  if (!configured(k)) return res.status(409).json({ error: 'Service variables for this source are not set yet' });
  try { res.json(await ingest(await connectors[k](), 'connector')); }
  catch (e) {
    console.error('sync', k, e.message);
    await store.upsert('synclog', `${new Date().toISOString()}|${k}`, { source: k, at: new Date().toISOString(), how: 'connector', error: e.message.slice(0, 300) });
    res.status(502).json({ error: e.message.slice(0, 300) });
  }
});

app.put('/api/sources/:key', async (req, res, next) => {
  try {
    if (!CATALOG.some((c) => c.key === req.params.key)) return res.status(404).json({ error: 'source' });
    const prev = (await store.list('source')).find((s) => s._k === req.params.key) || {};
    const { _k, _at, ...rest } = prev;
    const next_ = { ...rest };
    if (['connected', 'pending', 'not_started'].includes(req.body.state)) next_.state = req.body.state;
    if (typeof req.body.note === 'string') next_.note = req.body.note.slice(0, 300);
    await store.upsert('source', req.params.key, next_);
    res.json(next_);
  } catch (e) { next(e); }
});

// Notes on the timeline (campaign launches, posts, fixes).
app.post('/api/notes', async (req, res, next) => {
  try {
    const { date, label, kind } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !label) return res.status(400).json({ error: 'date and label are required' });
    const note = { date, label: String(label).slice(0, 140), kind: ['launch', 'content', 'fix', 'test', 'other'].includes(kind) ? kind : 'other', id: `${date}-${Date.now()}` };
    await store.upsert('note', note.id, note);
    res.status(201).json(note);
  } catch (e) { next(e); }
});
app.delete('/api/notes/:id', async (req, res, next) => {
  try { (await store.remove('note', req.params.id)) ? res.json({ ok: true }) : res.status(404).json({ error: 'not found' }); }
  catch (e) { next(e); }
});

// Ad loader (task 124): pieces, checklist and API payloads. Test mode unless AD_LOADER_LIVE=1.
const view = (a) => { const { _at, ...p } = a; return { ...p, id: a._k, updated: _at, check: ads.validate(p) }; };
async function adList() {
  if (!(await store.count('adseed'))) {
    for (const [i, ex] of ads.EXAMPLES.entries()) await store.upsert('ad', `ex-${i + 1}`, { ...ex, status: 'draft', created_by: 'example', created_at: new Date().toISOString() });
    await store.upsert('adseed', 'done', { at: new Date().toISOString() });
  }
  return (await store.list('ad')).map(view);
}
async function adGet(id) { return (await store.list('ad')).find((a) => a._k === id); }

app.get('/api/ads', async (req, res, next) => {
  try {
    res.json({
      pieces: await adList(), personas: ads.PERSONAS, limits: ads.LIMITS, budget_cap: Number(process.env.AD_BUDGET_CAP_USD || 50),
      live: Object.fromEntries(ads.PLATFORMS.map((p) => [p, ads.liveReady(p)])), mode: process.env.AD_LOADER_LIVE === '1' ? 'live' : 'test',
    });
  } catch (e) { next(e); }
});
app.post('/api/ads', async (req, res, next) => {
  try {
    const p = ads.clean(req.body || {});
    if (!p.name) return res.status(400).json({ error: 'The piece needs a name' });
    const id = `ad-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    // A new piece starts without approvals: whoever loads it does not approve it.
    const signoffs = Object.fromEntries(ads.SIGNOFFS.map((s) => [s, false]));
    await store.upsert('ad', id, { ...p, signoffs, signed_by: {}, example: false, status: 'draft', created_by: req.user, created_at: now, log: [{ at: now, user: req.user, action: 'loaded' }] });
    res.status(201).json(view({ ...(await adGet(id)) }));
  } catch (e) { next(e); }
});
app.put('/api/ads/:id', async (req, res, next) => {
  try {
    const prev = await adGet(req.params.id);
    if (!prev) return res.status(404).json({ error: 'not found' });
    const { _k, _at, ...rest } = prev;
    const { signoffs: asked, ...p } = ads.clean(req.body || {});
    const now = new Date().toISOString();
    const log = [...(rest.log || [])];
    const norm = (v) => (v == null ? '' : String(v));
    const changed = ads.CONTENT.filter((k) => k in p && norm(p[k]) !== norm(rest[k]));
    let signoffs = { ...(rest.signoffs || {}) }, signed_by = { ...(rest.signed_by || {}) };
    if (changed.length) {
      // Anything that changes what goes out clears the approvals, so they always refer to the final version.
      if (ads.SIGNOFFS.some((s) => signoffs[s])) log.push({ at: now, user: req.user, action: `edited ${changed.join(', ')}; approvals cleared` });
      else log.push({ at: now, user: req.user, action: `edited ${changed.join(', ')}` });
      signoffs = Object.fromEntries(ads.SIGNOFFS.map((s) => [s, false])); signed_by = {};
    } else if (asked) {
      for (const s of ads.SIGNOFFS) {
        if (asked[s] && !signoffs[s]) {
          if (req.user === rest.created_by) return res.status(403).json({ error: 'Whoever loads a piece does not approve it. Ask another person.' });
          if (Object.values(signed_by).includes(req.user)) return res.status(403).json({ error: 'You already gave one approval on this piece; each approval comes from a different person.' });
          signoffs[s] = true; signed_by[s] = req.user; log.push({ at: now, user: req.user, action: `approved as ${ads.SIGNOFF_NAMES[s]}` });
        } else if (!asked[s] && signoffs[s]) {
          signoffs[s] = false; delete signed_by[s]; log.push({ at: now, user: req.user, action: `withdrew the ${ads.SIGNOFF_NAMES[s]} approval` });
        }
      }
    }
    const status = ['draft', 'archived'].includes(req.body.status) ? req.body.status : rest.status;
    if (status !== rest.status) log.push({ at: now, user: req.user, action: status === 'archived' ? 'archived' : 'restored' });
    if (!changed.length && p.notes !== undefined && norm(p.notes) !== norm(rest.notes)) log.push({ at: now, user: req.user, action: 'edited notes' });
    await store.upsert('ad', req.params.id, { ...rest, ...p, signoffs, signed_by, status, example: !!rest.example, updated_by: req.user, log: log.slice(-100) });
    res.json(view(await adGet(req.params.id)));
  } catch (e) { next(e); }
});
// Every active piece with its checklist and payload, for loading by hand while the API access is pending.
app.get('/api/ads/export', async (req, res, next) => {
  try {
    const out = (await adList()).filter((v) => v.status !== 'archived' && !v.example)
      .map((v) => ({ name: v.name, persona: v.persona, platform: v.platform, ready: v.check.ok, to_fix: v.check.checks.filter((c) => !c.ok).map((c) => c.fix), final_url: ads.finalUrl(v), payload: ads.payloads(v) }));
    res.json({ exported_at: new Date().toISOString(), mode: 'test', pieces: out });
  } catch (e) { next(e); }
});
app.get('/api/ads/:id/payload', async (req, res, next) => {
  try {
    const a = await adGet(req.params.id);
    if (!a) return res.status(404).json({ error: 'not found' });
    const v = view(a);
    res.json({ id: v.id, name: v.name, platform: v.platform, final_url: ads.finalUrl(v), check: v.check, live: ads.liveReady(v.platform), payload: ads.payloads(v) });
  } catch (e) { next(e); }
});
// Sending: refused in test mode, refused for examples and for pieces that fail the checklist. Live connectors are
// switched on when the platform access and tokens exist; until then this route only explains what is missing.
app.post('/api/ads/:id/send', async (req, res, next) => {
  try {
    const a = await adGet(req.params.id);
    if (!a) return res.status(404).json({ error: 'not found' });
    const v = view(a);
    if (v.example) return res.status(409).json({ error: 'Example pieces are never sent.' });
    if (!v.check.ok) return res.status(409).json({ error: `Checklist incomplete: ${v.check.total - v.check.passed} item(s) to fix.` });
    const live = ads.liveReady(v.platform);
    if (!live.ready) return res.status(409).json({ error: live.why });
    res.status(501).json({ error: 'Live sending for this platform is enabled once the connector is tested with the real account. Load it by hand with the payload meanwhile.' });
  } catch (e) { next(e); }
});

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'internal error' }); });

const PORT = process.env.PORT;
if (!PORT) { console.error('PORT env var not set; the runtime must inject it.'); process.exit(1); }

async function autoSync() {
  for (const k of Object.keys(connectors)) {
    if (!configured(k)) continue;
    try { const r = await ingest(await connectors[k](), 'connector'); console.log('sync', k, r.metrics, r.events); }
    catch (e) { console.error('sync', k, e.message); }
  }
}

(async () => {
  await store.init();
  const liveSources = new Set(Object.keys(connectors).filter(configured));
  console.log('connector configuration:', Object.fromEntries(
    Object.keys(connectors).map((key) => [key, configured(key)])
  ));
  // Safe setup diagnostic: names only, never the values of tokens or secrets.
  // This makes a missing service variable actionable in deployment logs.
  for (const key of Object.keys(connectors)) {
    const missing = (REQUIRED[key] || []).filter((name) => !String(process.env[name] || '').trim());
    if (missing.length) console.warn(`connector ${key} missing variables: ${missing.join(', ')}`);
  }
  const n = await seed(liveSources);
  if (n) console.log(`Seed loaded for ${n} source(s)`);
  app.listen(PORT, () => console.log(`Growth dashboard (${store.kind}) listening on ${PORT}${auth.configured() ? '' : ' (locked: DASH_USERS not set)'}`));
  if (process.env.AUTO_SYNC === '0') {
    console.log('Automatic connector sync disabled; use Sync now to refresh data.');
    return;
  }
  void autoSync();
  setInterval(autoSync, Math.max(1, Number(process.env.SYNC_EVERY_HOURS || 6)) * 3600e3);
})().catch((e) => { console.error('Boot failed:', e); process.exit(1); });
