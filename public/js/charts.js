
'use strict';
/* Charts drawn as SVG: stacked daily bars with timeline notes, channel mix strip, horizontal bars, funnel.
   Channel colors are fixed (CSS tokens --ch-*), so a channel has the same color on every screen. */
(function (A) {
  const U = A.ui;
  const C = A.charts = {};
  C.CHANNELS = [
    ['Organic Search', 'organic-search'], ['Direct', 'direct'], ['Paid Search', 'paid-search'], ['Paid Social', 'paid-social'],
    ['Organic Social', 'organic-social'], ['Referral', 'referral'], ['Email', 'email'], ['Other', 'other'],
  ].map(([name, cls]) => ({ name, cls, color: `var(--ch-${cls})` }));
  // HubSpot / GA4 source names onto the 8 fixed channels.
  C.channelOf = (raw) => {
    const s = String(raw || '').toLowerCase();
    if (/paid.?search|cpc|google ads/.test(s)) return 2;
    if (/paid.?social|paid_social/.test(s)) return 3;
    if (/organic.?search|^search/.test(s)) return 0;
    if (/direct/.test(s)) return 1;
    if (/social/.test(s)) return 4;
    if (/referr/.test(s)) return 5;
    if (/email/.test(s)) return 6;
    return 7;
  };
  C.PLATFORMS = [
    { key: 'meta', name: 'Meta', color: 'var(--pf-meta)' },
    { key: 'linkedin', name: 'LinkedIn', color: 'var(--pf-linkedin)' },
    { key: 'google_ads', name: 'Google Ads', color: 'var(--pf-google)' },
  ];
  function niceMax(v) {
    if (!(v > 0)) return 4;
    const e = Math.pow(10, Math.floor(Math.log10(v))), m = v / e;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
  }
  C.legend = (keys, withNotes) => `<div class="channel-legend">${keys.map((k) => `<span style="--ch:${k.color}">${U.esc(k.name)}</span>`).join('')}${withNotes ? '<span class="legend-note">Timeline note</span>' : ''}</div>`;

  C.stacked = ({ dates, keys, value, notes = [], label = 'Chart', fmt = U.fmt }) => {
    const totals = dates.map((d) => keys.reduce((s, k, i) => s + (Number(value(d, i)) || 0), 0));
    if (!dates.length || !totals.some(Boolean)) return U.empty('No data in this period', 'Try a longer period, or check Data Sources.', 'chart-column');
    const W = 1000, H = 300, L = 54, R = 12, T = 30, B = 270;
    const max = niceMax(Math.max(...totals));
    const y = (v) => B - (v / max) * (B - T);
    const step = (W - L - R) / dates.length, bw = Math.max(1.5, step * (dates.length > 45 ? 0.74 : 0.62));
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const v = (max * k) / 4, yy = y(v).toFixed(1);
      g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${U.esc(fmt(v))}</text>`;
    }
    dates.forEach((d, j) => {
      const x = L + j * step + (step - bw) / 2;
      const lines = keys.map((k, i) => [k.name, Number(value(d, i)) || 0]).filter((p) => p[1]).map((p) => `${p[0]}: ${fmt(p[1])}`);
      g += `<rect class="day-hit" x="${(L + j * step).toFixed(2)}" y="${T}" width="${step.toFixed(2)}" height="${B - T}"><title>${U.esc(U.dshort(d))} · total ${U.esc(fmt(totals[j]))}${lines.length ? '\n' + U.esc(lines.join('\n')) : ''}</title></rect>`;
      let acc = 0;
      keys.forEach((k, i) => {
        const v = Number(value(d, i)) || 0; if (!v) return;
        g += `<rect class="seg" x="${x.toFixed(2)}" y="${y(acc + v).toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(0.5, y(acc) - y(acc + v)).toFixed(2)}" style="fill:${k.color}"><title>${U.esc(U.dshort(d))} · ${U.esc(k.name)}: ${U.esc(fmt(v))}</title></rect>`;
        acc += v;
      });
    });
    const every = Math.ceil(dates.length / 8);
    dates.forEach((d, j) => { if (j % every === 0) g += `<text x="${(L + j * step + step / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle">${U.esc(U.dshort(d))}</text>`; });
    notes.forEach((n, k) => {
      const j = dates.indexOf(n.date); if (j < 0) return;
      const x = (L + j * step + step / 2).toFixed(1);
      g += `<g class="note-mark"><line x1="${x}" x2="${x}" y1="${T - 7}" y2="${B}"/><circle cx="${x}" cy="${T - 16}" r="9"/><text x="${x}" y="${T - 12.5}" text-anchor="middle">${k + 1}</text><title>${U.esc(U.dshort(n.date))} · ${U.esc(n.label)}</title></g>`;
    });
    return `<div class="chart-scroll"><svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${U.esc(label)}">${g}</svg></div>${C.legend(keys, notes.some((n) => dates.includes(n.date)))}`;
  };

  // Accounts created per day (bars, left axis) and the running total since launch (line, right axis).
  // The two axes are independent on purpose: against a 500K goal the running total would read as a flat line.
  C.accountsTrend = ({ dates, daily }) => {
    if (!dates.length || !daily.some(Boolean)) return U.empty('No accounts yet', 'The curve starts with the first account created.', 'chart-line');
    let run = 0; const cum = daily.map((v) => (run += v));
    const W = 1000, H = 240, L = 54, R = 58, T = 16, B = 206;
    const maxD = niceMax(Math.max(...daily)), maxC = niceMax(cum[cum.length - 1]);
    const yd = (v) => B - (v / maxD) * (B - T), yc = (v) => B - (v / maxC) * (B - T);
    const step = (W - L - R) / dates.length, bw = Math.max(1.5, step * 0.62), cx = (j) => L + j * step + step / 2;
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const yy = yd((maxD * k) / 4).toFixed(1);
      g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 8}" y="${(+yy + 4).toFixed(1)}" text-anchor="end">${U.esc(U.fmt((maxD * k) / 4))}</text><text x="${W - R + 8}" y="${(+yy + 4).toFixed(1)}" text-anchor="start" class="trend-axis-r">${U.esc(U.fmt((maxC * k) / 4))}</text>`;
    }
    dates.forEach((d, j) => {
      g += `<rect class="day-hit" x="${(L + j * step).toFixed(2)}" y="${T}" width="${step.toFixed(2)}" height="${B - T}"><title>${U.esc(U.dshort(d))} · ${U.esc(U.fmt(daily[j]))} new · ${U.esc(U.fmt(cum[j]))} total</title></rect>`;
      if (daily[j]) g += `<rect class="trend-bar" x="${(cx(j) - bw / 2).toFixed(2)}" y="${yd(daily[j]).toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(0.5, B - yd(daily[j])).toFixed(2)}"/>`;
    });
    const pts = cum.map((v, j) => `${cx(j).toFixed(1)},${yc(v).toFixed(1)}`);
    g += `<polygon class="trend-area" points="${cx(0).toFixed(1)},${B} ${pts.join(' ')} ${cx(dates.length - 1).toFixed(1)},${B}"/><polyline class="trend-line" points="${pts.join(' ')}"/><circle class="trend-dot" cx="${cx(dates.length - 1).toFixed(1)}" cy="${yc(cum[cum.length - 1]).toFixed(1)}" r="4"/>`;
    const every = Math.ceil(dates.length / 8);
    dates.forEach((d, j) => { if (j % every === 0) g += `<text x="${cx(j).toFixed(1)}" y="${H - 8}" text-anchor="middle">${U.esc(U.dshort(d))}</text>`; });
    return `<div class="chart-scroll"><svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Accounts created per day and running total since launch">${g}</svg></div>
      <div class="channel-legend trend-legend"><span class="lg-bar">New accounts per day (left axis)</span><span class="lg-line">Running total since launch (right axis)</span></div>`;
  };

  C.mix = (values, keys = C.CHANNELS, unit = 'sessions') => {
    const total = values.reduce((a, b) => a + b, 0);
    if (!total) return U.empty('No sessions in this period', '', 'chart-pie');
    const strip = keys.map((k, i) => (values[i] ? `<i style="width:${((values[i] / total) * 100).toFixed(2)}%;--ch:${k.color}" title="${U.esc(k.name)}: ${U.fmt(values[i])} ${unit} (${U.pct(values[i] / total)})"></i>` : '')).join('');
    const labels = keys.map((k, i) => `<div class="mix-cell" style="--ch:${k.color}"><div class="mix-name">${U.esc(k.name)}</div><div class="mix-val">${U.fmt(values[i])}</div><span class="share">${U.pct(values[i] / total)}</span></div>`).join('');
    return `<div class="mix-strip" role="img" aria-label="Share of ${unit} by channel">${strip}</div><div class="mix-labels">${labels}</div>`;
  };

  C.hbars = (rows, total) => {
    if (!rows.length) return U.empty('Nothing to show yet');
    const top = Math.max(1e-9, ...rows.map((r) => r.value || 0));
    return `<div class="hbar-list">${rows.map((r) => `<div class="hbar"><span class="hbar-name"><span class="ch-dot" style="--ch:${r.color}"></span>${U.esc(r.name)}</span><span class="hbar-track"><span class="hbar-fill" style="width:${(((r.value || 0) / top) * 100).toFixed(1)}%;--ch:${r.color}"></span></span><span class="hbar-val">${r.label != null ? r.label : U.fmt(r.value)}${total ? `<small>${U.pct((r.value || 0) / total)}</small>` : ''}${r.extra || ''}</span></div>`).join('')}</div>`;
  };

  C.weakest = (steps) => {
    let worst = -1, wv = Infinity;
    for (let k = 1; k < steps.length; k++) {
      const a = steps[k - 1].n, b = steps[k].n;
      if (a == null || b == null || !a) continue;
      if (b / a < wv) { wv = b / a; worst = k; }
    }
    return worst;
  };
  C.funnel = (steps) => {
    const base = steps[0].n || 0, weak = C.weakest(steps);
    let h = '';
    steps.forEach((s, k) => {
      if (k > 0) {
        const a = steps[k - 1].n, b = s.n;
        if (a == null || b == null) h += `<div class="funnel-conn pending"><span class="keep">${U.icon('arrow-down')} –</span><span class="conn-note">Step-to-step % appears once ${U.esc(b == null ? s.src : steps[k - 1].src)} sends data</span></div>`;
        else {
          const kp = a ? b / a : 0;
          h += `<div class="funnel-conn${k === weak ? ' weakest' : ''}"><span class="keep">${U.icon('arrow-down')} ${U.pct(kp)} continue</span><span class="drop">${U.pct(Math.max(0, 1 - kp))} drop-off</span>${k === weak ? `<span class="weak-badge">${U.icon('triangle-exclamation')} Weakest step</span>` : ''}</div>`;
        }
      }
      const pend = s.n == null, w = !pend && base ? Math.min(100, Math.max(0.8, (s.n / base) * 100)) : 0;
      h += `<div class="funnel-step" role="listitem"><span class="funnel-idx">${k + 1}</span><span class="funnel-name">${U.esc(s.name)}<small>${U.esc(s.src)}</small></span><div class="funnel-track${pend ? ' pending' : ''}">${pend ? '' : `<div class="funnel-fill" style="width:${w.toFixed(2)}%"></div>`}</div><span class="funnel-count">${pend ? `<span class="awaiting-chip">${U.esc(s.note || `Awaiting ${s.src}`)}</span>` : `${U.fmt(s.n)}<em>${base ? U.pct(s.n / base) : ''}</em>`}</span></div>`;
    });
    return `<div class="funnel" role="list" aria-label="Visit to active account funnel">${h}</div>`;
  };
})(window.App);
