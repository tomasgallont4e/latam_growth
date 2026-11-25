'use strict';
// Channel of a form submission or an account, from its first-touch UTMs. Shared by the browser
// (App.channels) and Node (lib/connectors.js), like paid.js.
// Same rule as the Early Builders dashboard (think4ever project 290, lib/campaigns.js): the official
// links match on utm_source + utm_medium + utm_campaign, case-insensitive; utm_content is the piece and never
// decides the channel; Tests follow isTest() below (explicit markers, 2026-11-18). One difference, decided on 2026-11-17: the
// Developer Network emails sent from HubSpot (hs_email, hs_automation, hubspot with medium email) count with
// Referrals · Developer Network. Each builder's own referral link (any network, medium influencer, campaign
// early_builders_co_202611; utm_content = the builder's public user) is its own channel, Influencers.
// One difference from project 290, decided on 2026-11-23: the Meta Ads (boosted Instagram posts) land with
// instagram or facebook / paid_social and their own campaign (launch_latam_202611), so any campaign with that
// source and a paid medium is its own channel, Meta Ads, instead of Other UTM.
(function (root) {
  const LINKS = [
    { key: 'referral', source: 'equipo', medium: 'referral', campaign: 'developer-network' },
    { key: 'gmail', source: 'google', medium: 'cpc', campaign: 'early_builders_co_202611' },
    { key: 'linkedin', source: 'linkedin', medium: 'paid_social', campaign: 'early_builders_co_202611' },
  ];
  const DN_EMAIL_SOURCES = new Set(['hs_email', 'hs_automation', 'hubspot']);
  const PROGRAM_CAMPAIGN = 'early_builders_co_202611';
  const META_SOURCES = new Set(['instagram', 'facebook', 'ig', 'fb', 'meta']);
  const META_MEDIUMS = new Set(['paid_social', 'paid-social', 'paid', 'cpc', 'ppc']);
  // group: 'program' = the official links of the Developer Network (Early Builders) program, 'general' = everything
  // else, 'test' = left out.
  const CHANNELS = [
    { key: 'referral', label: 'Referrals · Developer Network', rule: 'equipo / referral / developer-network, and HubSpot emails (hs_email, hs_automation, hubspot / email)', group: 'program' },
    { key: 'gmail', label: 'Gmail ads · Google Ads', rule: 'google / cpc / early_builders_co_202611 · piece gmail_promo_01', group: 'program', platform: 'Google Ads' },
    { key: 'linkedin', label: 'LinkedIn paid', rule: 'linkedin / paid_social / early_builders_co_202611', group: 'program', platform: 'LinkedIn Ads' },
    { key: 'influencer', label: 'Influencers · builder links', rule: 'linkedin, instagram… / influencer / early_builders_co_202611 (each builder shares their own link)', group: 'program' },
    { key: 'meta', label: 'Meta Ads · Instagram and Facebook', rule: 'instagram or facebook / paid_social (paid-social, paid, cpc) / any campaign', group: 'general', platform: 'Meta Ads' },
    { key: 'other', label: 'Other UTM', rule: 'a UTM that matches none of the program links or Meta Ads', group: 'general' },
    { key: 'none', label: 'No UTM', rule: 'no utm_source, utm_medium or utm_campaign', group: 'general' },
    { key: 'test', label: 'Tests', rule: 'utm_medium qa, test or prueba; source or campaign starting qa-, test- or prueba- (or _); known probes (posthog_prodcheck…)', group: 'test' },
  ];
  const EMPTY = new Set(['', '(not set)', '(none)', 'null', 'undefined']);
  const norm = (v) => { const s = String(v == null ? '' : v).trim().toLowerCase(); return EMPTY.has(s) ? '' : s; };

  // THE test rule (agreed 2026-11-18), the one place every tab and the PostHog connector read: explicit markers
  // only, so a real campaign or an A/B piece that happens to contain "test" is never dropped.
  //   utm_medium exactly qa, test or prueba;
  //   utm_source or utm_campaign starting qa, test or prueba followed by - or _ (qa-sync-1106, qa_dn);
  //   known probes: utm_source or utm_campaign starting posthog_prodcheck (also posthog-prodcheck, posthogprodcheck).
  // utm_content never decides. The qa_probe event property is applied separately in the PostHog queries.
  // The Early Builders dashboard (project 290) adopts the same rule.
  const TEST_MEDIUMS = ['qa', 'test', 'prueba'];
  const TEST_PREFIX = '^(qa|test|prueba)[-_]';
  const TEST_PROBE = '^posthog[-_]?prodcheck';
  const PREFIX_RE = new RegExp(TEST_PREFIX), PROBE_RE = new RegExp(TEST_PROBE);
  function isTest({ source, medium, campaign } = {}) {
    const s = norm(source), m = norm(medium), c = norm(campaign);
    return TEST_MEDIUMS.includes(m) || [s, c].some((v) => PREFIX_RE.test(v) || PROBE_RE.test(v));
  }
  // The same rule as a HogQL condition over three SQL expressions (lower-cased here; '(not set)' never matches).
  function testSql(source, medium, campaign) {
    const low = (x) => `lower(toString(${x}))`;
    return `(${low(medium)} IN (${TEST_MEDIUMS.map((v) => `'${v}'`).join(', ')})`
      + [source, campaign].map((x) => ` OR match(${low(x)}, '${TEST_PREFIX}') OR match(${low(x)}, '${TEST_PROBE}')`).join('') + ')';
  }

  function classify({ source, medium, campaign, content } = {}) {
    const s = norm(source), m = norm(medium), c = norm(campaign);
    if (!s && !m && !c) return 'none';
    if (isTest({ source, medium, campaign })) return 'test';
    const hit = LINKS.find((l) => l.source === s && l.medium === m && l.campaign === c);
    if (hit) return hit.key;
    if (m === 'email' && DN_EMAIL_SOURCES.has(s)) return 'referral';
    if (m === 'influencer' && c === PROGRAM_CAMPAIGN) return 'influencer';
    if (META_SOURCES.has(s) && META_MEDIUMS.has(m)) return 'meta';
    return 'other';
  }
  // A HubSpot form row: its first-touch UTMs when it has any, otherwise the UTMs of the submission.
  function formUtm(e = {}) {
    const first = { source: e.first_utm_source, medium: e.first_utm_medium, campaign: e.first_utm_campaign, content: e.first_utm_content };
    return norm(first.source) || norm(first.medium) || norm(first.campaign)
      ? first : { source: e.utm_source, medium: e.utm_medium, campaign: e.utm_campaign, content: e.utm_content };
  }
  const byKey = Object.fromEntries(CHANNELS.map((c) => [c.key, c]));
  const api = { CHANNELS, classify, isTest, testSql, TEST_RULE: { mediums: TEST_MEDIUMS, prefix: TEST_PREFIX, probe: TEST_PROBE }, formUtm, isMetaPaid: ({ source, medium } = {}) => META_SOURCES.has(norm(source)) && META_MEDIUMS.has(norm(medium)), label: (k) => (byKey[k] ? byKey[k].label : k), group: (k) => (byKey[k] ? byKey[k].group : 'general') };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root && root.App) root.App.channels = api;
})(typeof window !== 'undefined' ? window : this);
