'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ads = require('../lib/adloader');

test('finalUrl appends the utm fields', () => {
  const u = ads.finalUrl({ landing_url: 'https://go.think4ever.com/latam', utm_source: 'linkedin', utm_medium: 'paid_social', utm_campaign: 'latam_co_launch', utm_content: 'p01' });
  assert.strictEqual(u, 'https://go.think4ever.com/latam?utm_source=linkedin&utm_medium=paid_social&utm_campaign=latam_co_launch&utm_content=p01');
});

test('validate fails an empty piece with a fix for every failed item', () => {
  const v = ads.validate(ads.clean({}));
  assert.strictEqual(v.ok, false);
  assert.ok(v.checks.length >= 5);
  assert.ok(v.checks.every((c) => typeof c.item === 'string' && (c.ok || c.fix.length > 0)));
});

test('validate passes a complete piece with three distinct approvals', () => {
  const p = {
    name: 'Test piece', platform: 'linkedin', persona: 'p01', language: 'es',
    headline: 'Tu IA no vuelve a perder el objetivo', primary_text: 'Primary text', cta: 'SIGN_UP',
    creative_url: 'https://example.com/a.png', landing_url: 'https://go.think4ever.com/latam',
    utm_source: 'linkedin', utm_medium: 'paid_social', utm_campaign: 'latam_co_launch', utm_content: 'p01',
    countries: 'CO', budget_daily_usd: 20, start: '2026-10-20', end: '2026-11-03',
    signoffs: { community: true, advertising: true, management: true },
    signed_by: { community: 'ana', advertising: 'beto', management: 'carla' }, created_by: 'leader',
  };
  const v = ads.validate(ads.clean(p));
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.passed, v.total);
});
