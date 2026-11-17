'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { convertSpendToUsd, rateOn, fixedRates } = require('../lib/fx');

const rows = [
  { metric: 'ad_spend', date: '2026-11-13', dim: 'campaign', dim_value: 'Gmail', value: 185 },
  { metric: 'ad_spend', date: '2026-11-15', dim: 'campaign', dim_value: 'Gmail', value: 10 },
  { metric: 'ad_spend_geo', date: '2026-11-13', dim: 'country', dim_value: 'Colombia', value: 185 },
  { metric: 'ad_clicks', date: '2026-11-13', dim: 'campaign', dim_value: 'Gmail', value: 275 },
];
const ecb = { rates: { '2026-11-12': { USD: 0.71 }, '2026-11-13': { USD: 0.72 }, '2026-11-14': { USD: 0.73 } } };

test('CAD spend is stored in USD at the rate of each day; clicks are untouched', async () => {
  let asked = '';
  const http = async (url) => { asked = url; return ecb; };
  const out = await convertSpendToUsd({ metrics: rows, currency: 'cad', from: '2026-11-10', to: '2026-11-17', http, env: {} });
  assert.match(asked, /^https:\/\/api\.frankfurter\.dev\/v1\/2026-11-03\.\.2026-11-17\?from=CAD&to=USD$/);
  assert.equal(out.metrics[0].value, 133.2); // 185 x 0.72
  assert.equal(out.metrics[1].value, 7.3); // Sunday 15-nov uses Friday 14-nov
  assert.equal(out.metrics[2].value, 133.2); // country rows too
  assert.equal(out.metrics[3].value, 275);
  assert.equal(out.snapshot.key, 'spend_currency');
  assert.equal(out.snapshot.rows[0].currency, 'CAD');
  assert.equal(out.snapshot.rows[0].method, 'ecb_daily');
  assert.equal(rows[0].value, 185, 'input rows are not mutated');
});

test('USD accounts pass through without calling the rate API', async () => {
  const http = async () => { throw new Error('should not be called'); };
  const out = await convertSpendToUsd({ metrics: rows, currency: 'USD', from: '2026-11-10', to: '2026-11-17', http, env: {} });
  assert.equal(out.metrics, rows);
  assert.equal(out.snapshot.rows[0].method, 'none');
});

test('When the rate API fails, FX_RATES_USD is used; without it the sync fails instead of mislabelling', async () => {
  const http = async () => { throw new Error('503 down'); };
  const out = await convertSpendToUsd({ metrics: rows, currency: 'CAD', from: '2026-11-10', to: '2026-11-17', http, env: { FX_RATES_USD: 'CAD:0.7, EUR:1.1' } });
  assert.equal(out.metrics[0].value, 129.5);
  assert.equal(out.snapshot.rows[0].method, 'fixed_env');
  await assert.rejects(
    convertSpendToUsd({ metrics: rows, currency: 'CAD', from: '2026-11-10', to: '2026-11-17', http, env: {} }),
    /no CAD to USD rate/,
  );
  await assert.rejects(
    convertSpendToUsd({ metrics: rows, currency: '', from: '2026-11-10', to: '2026-11-17', http, env: {} }),
    /currency unknown/,
  );
});

test('rateOn and fixedRates helpers', () => {
  const s = [['2026-11-12', 0.71], ['2026-11-13', 0.72]];
  assert.equal(rateOn(s, '2026-11-01'), 0.71);
  assert.equal(rateOn(s, '2026-11-13'), 0.72);
  assert.equal(rateOn(s, '2026-11-30'), 0.72);
  assert.deepEqual(fixedRates({ FX_RATES_USD: 'cad:0.7,bad,COP:x' }), { CAD: 0.7 });
});

test('Google Ads and Meta connectors convert spend before returning it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'connectors.js'), 'utf8');
  assert.match(src, /customer\.currency_code/);
  assert.match(src, /fields=currency/);
  assert.equal((src.match(/fx\.convertSpendToUsd\(/g) || []).length, 2);
  assert.match(src, /source: 'google_ads', from, to, metrics: usd\.metrics/);
  assert.match(src, /source: 'meta', from, to, metrics: usd\.metrics/);
});
