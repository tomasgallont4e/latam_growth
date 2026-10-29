'use strict';
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else window.App.measurement = factory();
})(function () {
  const ratio = (n, d) => n != null && d != null && Number(d) > 0 ? Number(n) / Number(d) : null;
  function planCheck(p) {
    const derived = {
      visit_to_signup: ratio(p.verified_users, p.landing_sessions),
      impression_to_visit: ratio(p.landing_sessions, p.impressions),
      paid_cps: ratio(p.paid_budget, p.verified_users),
    };
    const labels = { visit_to_signup: 'Visit to sign-up', impression_to_visit: 'Impression to landing visit', paid_cps: 'Cost per sign-up' };
    const issues = Object.entries(derived).filter(([key, value]) => value != null && Math.abs(Number(p[key]) - value) > Math.max(key === 'paid_cps' ? 0.02 : 0.00005, value * 0.01))
      .map(([key, implied]) => ({ key, label: labels[key], saved: Number(p[key]), implied }));
    const countryTotal = Object.values(p.countries || {}).reduce((sum, n) => sum + Number(n || 0), 0);
    return { derived, issues, countryTotal, allocationMatches: countryTotal === Number(p.verified_users) };
  }
  return { ratio, planCheck };
});
