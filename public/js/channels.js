'use strict';
// Channel of a form submission or an account, from its first-touch UTMs. Shared by the browser
// (App.channels) and Node (lib/connectors.js), like paid.js.
// Same rule as the Early Builders dashboard (think4ever project 290, lib/campaigns.js): the three official
// links match on utm_source + utm_medium + utm_campaign, case-insensitive; utm_content is the piece and never
// decides the channel; qa / test / prueba values are Tests. One difference, decided on 2026-11-17: the
// Developer Network emails sent from HubSpot (hs_email, hs_automation, hubspot with medium email) count with
// Referrals · Developer Network. The Early Builders dashboard still files them under Other UTM.
(function (root) {
  const LINKS = [
    { key: 'referral', source: 'equipo', medium: 'referral', campaign: 'developer-network' },
    { key: 'gmail', source: 'google', medium: 'cpc', campaign: 'early_builders_co_202611' },
    { key: 'linkedin', source: 'linkedin', medium: 'paid_social', campaign: 'early_builders_co_202611' },
  ];
  const DN_EMAIL_SOURCES = new Set(['hs_email', 'hs_automation', 'hubspot']);
  // group: 'campaign' = the official links of the program, 'general' = everything else, 'test' = left out.
  const CHANNELS = [
    { key: 'referral', label: 'Referrals · Developer Network', rule: 'equipo / referral / developer-network, and HubSpot emails (hs_email, hs_automation, hubspot / email)', group: 'campaign' },
    { key: 'gmail', label: 'Gmail ads', rule: 'google / cpc / early_builders_co_202611', group: 'campaign' },
    { key: 'linkedin', label: 'LinkedIn paid', rule: 'linkedin / paid_social / early_builders_co_202611', group: 'campaign' },
    { key: 'other', label: 'Other UTM', rule: 'a UTM that matches none of the three links', group: 'general' },
    { key: 'none', label: 'No UTM', rule: 'no utm_source, utm_medium or utm_campaign', group: 'general' },
    { key: 'test', label: 'Tests', rule: 'qa, test or prueba in any UTM value', group: 'test' },
  ];
  const EMPTY = new Set(['', '(not set)', '(none)', 'null', 'undefined']);
  const TEST_RE = /(^|[^a-z])(qa|test|tests|testing|prueba|pruebas)([^a-z]|$)/;
  const norm = (v) => { const s = String(v == null ? '' : v).trim().toLowerCase(); return EMPTY.has(s) ? '' : s; };

  function classify({ source, medium, campaign, content } = {}) {
    const s = norm(source), m = norm(medium), c = norm(campaign), p = norm(content);
    if (!s && !m && !c) return 'none';
    if ([s, m, c, p].some((v) => TEST_RE.test(v))) return 'test';
    const hit = LINKS.find((l) => l.source === s && l.medium === m && l.campaign === c);
    if (hit) return hit.key;
    if (m === 'email' && DN_EMAIL_SOURCES.has(s)) return 'referral';
    return 'other';
  }
  // A HubSpot form row: its first-touch UTMs when it has any, otherwise the UTMs of the submission.
  function formUtm(e = {}) {
    const first = { source: e.first_utm_source, medium: e.first_utm_medium, campaign: e.first_utm_campaign, content: e.first_utm_content };
    return norm(first.source) || norm(first.medium) || norm(first.campaign)
      ? first : { source: e.utm_source, medium: e.utm_medium, campaign: e.utm_campaign, content: e.utm_content };
  }
  const byKey = Object.fromEntries(CHANNELS.map((c) => [c.key, c]));
  const api = { CHANNELS, classify, formUtm, label: (k) => (byKey[k] ? byKey[k].label : k), group: (k) => (byKey[k] ? byKey[k].group : 'general') };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root && root.App) root.App.channels = api;
})(typeof window !== 'undefined' ? window : this);
