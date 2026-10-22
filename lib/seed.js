'use strict';
// First boot: loads the seed files in seed/ for every source that has no data yet.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const ingest = require('./ingest');

// Configured API connectors are authoritative. Do not briefly show their sample
// data on a fresh deployment while the first connector sync is running.
module.exports = async function seed(liveSources = new Set()) {
  const dir = path.join(__dirname, '..', 'seed');
  if (!fs.existsSync(dir)) return 0;
  const have = new Set((await store.list('synclog')).map((l) => l.source));
  let n = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (have.has(p.source) || liveSources.has(p.source)) continue;
    await ingest(p, 'seed');
    n++;
  }
  return n;
};
