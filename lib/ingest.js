'use strict';
// Applies a data load to the store. Same format for the seed files, the CSV import, the connectors
// and POST api/ingest:
// { source, pulled_at, from, to,
//   metrics:   [{ metric, date, dim?, dim_value?, value }]       daily facts, upserted
//   snapshots: [{ key, from, to, rows: [...], note? }]           tables for a fixed window, upserted
//   events:    [{ kind, date, ... }]                             replaces this source's events in [from, to]
//   notes:     [{ date, label, kind }]                           timeline notes, upserted
//   status?:   { state, note } }

const store = require('./store');

const SOURCE = /^[a-z0-9_]{2,30}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, n = 120) => String(v == null ? '' : v).slice(0, n);

async function ingest(p, how = 'api') {
  if (!p || !SOURCE.test(p.source || '')) throw Object.assign(new Error('source missing or invalid'), { status: 400 });
  const src = p.source;
  let m = 0, s = 0, e = 0;

  for (const r of p.metrics || []) {
    if (!DATE.test(r.date || '') || !r.metric || !Number.isFinite(Number(r.value))) continue;
    const row = { source: src, metric: str(r.metric, 60), date: r.date, dim: str(r.dim, 40), dim_value: str(r.dim_value), value: Number(r.value) };
    await store.upsert('metric', [src, row.metric, row.date, row.dim, row.dim_value].join('|'), row);
    m++;
  }
  for (const sn of p.snapshots || []) {
    if (!sn.key || !DATE.test(sn.from || '') || !DATE.test(sn.to || '')) continue;
    const row = { source: src, key: str(sn.key, 40), from: sn.from, to: sn.to, note: str(sn.note, 300), rows: (sn.rows || []).slice(0, 500), pulled_at: p.pulled_at || new Date().toISOString() };
    await store.upsert('snapshot', [src, row.key, row.from, row.to].join('|'), row);
    s++;
  }
  if (Array.isArray(p.events) && DATE.test(p.from || '') && DATE.test(p.to || '')) {
    const old = (await store.list('event')).filter((x) => x.source === src && x.date >= p.from && x.date <= p.to);
    for (const x of old) await store.remove('event', x._k);
    let i = 0;
    for (const ev of p.events.slice(0, 5000)) {
      if (!DATE.test(ev.date || '')) continue;
      // The event's attribution (traffic source, channel) travels in `channel`; `source` is the load
      // source (which tool the event came from), so the two never overwrite each other again.
      await store.upsert('event', `${src}|${ev.date}|${Date.now()}|${i++}`, { ...ev, source: src, channel: str(ev.channel || ev.source || '', 60) });
      e++;
    }
  }
  for (const n of p.notes || []) {
    if (!DATE.test(n.date || '') || !n.label) continue;
    const id = n.id || `${n.date}-${src}-${str(n.label, 30).replace(/\W+/g, '-')}`;
    await store.upsert('note', id, { id, date: n.date, label: str(n.label, 140), kind: n.kind || 'other' });
  }
  const prev = (await store.list('source')).find((x) => x._k === src) || {};
  const status = {
    ...prev,
    state: (p.status && p.status.state) || 'connected',
    note: (p.status && p.status.note) || prev.note || '',
    last_sync: p.pulled_at || new Date().toISOString(),
    window: p.from && p.to ? `${p.from} to ${p.to}` : prev.window || '',
  };
  delete status._k; delete status._at;
  await store.upsert('source', src, status);
  const log = { source: src, at: new Date().toISOString(), how, metrics: m, snapshots: s, events: e };
  await store.upsert('synclog', `${log.at}|${src}`, log);
  return log;
}

module.exports = ingest;
