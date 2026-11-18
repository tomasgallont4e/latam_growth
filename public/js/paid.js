'use strict';
// Shared by API connectors and the dashboard so paid UTM matching is identical.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else window.App.paid = factory();
})(function () {
  const norm = (v) => String(v || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  const aliases = {
    meta: ['meta', 'facebook', 'fb', 'instagram', 'ig', 'facebook.com', 'instagram.com'],
    linkedin: ['linkedin', 'linked-in', 'linkedin.com'],
    google_ads: ['google', 'googleads', 'google-ads', 'adwords'],
  };
  // A paid medium, whatever the platform (the goals spec: cpc, paid_social, paid, display...).
  const paidMedium = (medium) => /^(paid|paid-social|paid-search|cpc|ppc|display|cpm)$/.test(norm(medium));
  const platform = (source, medium) => {
    if (!paidMedium(medium)) return null;
    return Object.keys(aliases).find((key) => aliases[key].includes(norm(source))) || null;
  };
  const cost = (spend, count, factor = 1) => spend != null && Number.isFinite(Number(spend)) && Number(count) > 0 ? Number(spend) / Number(count) * factor : null;
  return { platform, paidMedium, cost };
});
