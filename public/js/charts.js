
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
    if (!dates.length || !totals.some(Boolean)) return U.empty('No data since launch', 'Check Data Sources if this should already be sending rows.', 'chart-column');
    const W = 1000, H = 300, L = 54, R = 12, T = 30, B = 270;
    const max = niceMax(Math.max(...totals));
    const y = (v) => B - (v / max) * (B - T);
    const step = (W - L - R) / dates.length;
    const slot = dates.length > 45 ? 0.74 : 0.62;
    const bw = Math.max(1.5, Math.min(step * slot, dates.length <= 8 ? 96 : step));
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const v = (max * k) / 4, yy = y(v).toFixed(1);
      g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${U.esc(fmt(v))}</text>`;
    }
    const grain = U.grainOf(dates[0]);
    const keyOf = (iso) => U.bucketKey(iso, grain, A.LAUNCH);
    dates.forEach((d, j) => {
      const x = L + j * step + (step - bw) / 2;
      const lines = keys.map((k, i) => [k.name, Number(value(d, i)) || 0]).filter((p) => p[1]).map((p) => `${p[0]}: ${fmt(p[1])}`);
      g += `<rect class="day-hit" x="${(L + j * step).toFixed(2)}" y="${T}" width="${step.toFixed(2)}" height="${B - T}"><title>${U.esc(U.axis(d))} · total ${U.esc(fmt(totals[j]))}${lines.length ? '\n' + U.esc(lines.join('\n')) : ''}</title></rect>`;
      let acc = 0;
      keys.forEach((k, i) => {
        const v = Number(value(d, i)) || 0; if (!v) return;
        g += `<rect class="seg" x="${x.toFixed(2)}" y="${y(acc + v).toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(0.5, y(acc) - y(acc + v)).toFixed(2)}" style="fill:${k.color}"><title>${U.esc(U.axis(d))} · ${U.esc(k.name)}: ${U.esc(fmt(v))}</title></rect>`;
        acc += v;
      });
    });
    const every = Math.ceil(dates.length / 8);
    dates.forEach((d, j) => { if (j % every === 0) g += `<text x="${(L + j * step + step / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle">${U.esc(U.axis(d))}</text>`; });
    const groups = new Map();
    notes.forEach((n, k) => {
      const j = dates.indexOf(keyOf(n.date));
      if (j < 0) return;
      if (!groups.has(j)) groups.set(j, []);
      groups.get(j).push({ n, k });
    });
    groups.forEach((list, j) => {
      list.forEach(({ n, k }, slot) => {
        const shift = (slot - (list.length - 1) / 2) * 18;
        const x = (L + j * step + step / 2 + shift).toFixed(1);
        g += `<g class="note-mark"><line x1="${x}" x2="${x}" y1="${T - 7}" y2="${B}"/><circle cx="${x}" cy="${T - 16}" r="9"/><text x="${x}" y="${T - 12.5}" text-anchor="middle">${k + 1}</text><title>${U.esc(U.dshort(n.date))} · ${U.esc(n.label)}</title></g>`;
      });
    });
    return `<div class="chart-scroll"><svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${U.esc(label)}">${g}</svg></div>${C.legend(keys, notes.some((n) => dates.includes(keyOf(n.date))))}`;
  };

  // Cumulative month-to-date sign-ups (bars, left) and the same series as a share of the scale goal (line, right).
  // The two axes share a scale, so a bar top and its line point are the same value.
  C.goalProgress = ({ dates, values, goal, label = 'LATAM 500K goal' }) => {
    if (!dates.length || !(goal > 0)) return U.empty('No goal to chart yet', 'The 500K plan sets the line this chart measures against.', 'chart-column');
    const W = 1000, H = 292, L = 54, R = 68, T = 18, B = 256;
    const maxLeft = niceMax(Math.max(1, ...values));
    const maxRight = maxLeft / goal;
    const y = (v) => B - (v / maxLeft) * (B - T);
    const step = (W - L - R) / dates.length;
    const bw = Math.max(2, step * 0.62);
    const digits = (() => {
      const maxP = maxRight * 100;
      return maxP !== 0 && maxP < 0.1 ? 3 : maxP < 1 ? 2 : maxP < 10 ? 1 : 0;
    })();
    const pctAxis = (ratio) => `${(ratio * 100).toFixed(digits)}%`;
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const v = (maxLeft * k) / 4, yy = y(v).toFixed(1);
      g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`;
      g += `<text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${U.esc(U.fmt(v))}</text>`;
      g += `<text class="axis-pct" x="${W - R + 10}" y="${(y(v) + 4).toFixed(1)}" text-anchor="start">${U.esc(pctAxis((maxRight * k) / 4))}</text>`;
    }
    const pts = [];
    dates.forEach((d, j) => {
      const v = Number(values[j]) || 0;
      const x = L + j * step + (step - bw) / 2;
      const cx = (L + j * step + step / 2).toFixed(2);
      const yy = y(v).toFixed(2);
      const tip = `${U.dshort(d)} · ${U.fmt(v)} sign-ups · ${pctAxis(v / goal)} of goal`;
      g += `<rect class="day-hit" x="${(L + j * step).toFixed(2)}" y="${T}" width="${step.toFixed(2)}" height="${B - T}"><title>${U.esc(tip)}</title></rect>`;
      if (v > 0) g += `<rect class="goal-col" x="${x.toFixed(2)}" y="${yy}" width="${bw.toFixed(2)}" height="${Math.max(0.6, (B - y(v)).toFixed(2))}"><title>${U.esc(tip)}</title></rect>`;
      pts.push(`${cx},${yy}`);
    });
    g += `<polyline class="goal-line" points="${pts.join(' ')}"/>`;
    dates.forEach((d, j) => {
      const v = Number(values[j]) || 0;
      const cx = (L + j * step + step / 2).toFixed(2);
      g += `<circle class="goal-dot" cx="${cx}" cy="${y(v).toFixed(2)}" r="3.2"><title>${U.esc(`${U.dshort(d)} · ${U.fmt(v)} sign-ups · ${pctAxis(v / goal)} of goal`)}</title></circle>`;
    });
    const every = dates.length > 16 ? 4 : Math.max(1, Math.ceil(dates.length / 8));
    dates.forEach((d, j) => {
      if (j % every === 0) g += `<text x="${(L + j * step + step / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${U.esc(U.dshort(d))}</text>`;
    });
    const legend = `<div class="goal-legend"><span class="swatch-bar">Month-to-date sign-ups (left axis)</span><span class="swatch-line">% of ${U.esc(U.fmt(goal))} goal (right axis)</span></div>`;
    return `<div class="chart-scroll"><svg class="chart-svg goal-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${U.esc(label)}">${g}</svg></div>${legend}`;
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
      if (steps[k].kind === 'rate' || steps[k].separate || steps[k - 1].kind === 'rate') continue;
      const a = steps[k - 1].n, b = steps[k].n;
      if (a == null || b == null || !a) continue;
      if (b / a < wv) { wv = b / a; worst = k; }
    }
    return worst;
  };
  C.funnel = (steps, label = 'Visit to active account funnel') => {
    const baseStep = steps.find((s) => s.kind !== 'rate' && s.n != null);
    const base = baseStep ? baseStep.n : 0;
    const weak = C.weakest(steps);
    let h = '';
    let pathBase = null;
    steps.forEach((s, k) => {
      if (s.separate && s.n != null) pathBase = s.n;
      const denom = pathBase != null ? pathBase : base;
      if (k > 0) {
        if (s.kind === 'rate' || s.separate) h += `<div class="funnel-conn"><span class="conn-note">${U.icon('arrow-down')} ${U.esc(s.bridge || (s.kind === 'rate' ? 'Rate for the step above' : 'Separate path'))}</span></div>`;
        else {
          const a = steps[k - 1].n, b = s.n;
          if (a == null || b == null) h += `<div class="funnel-conn pending"><span class="keep">${U.icon('arrow-down')} –</span><span class="conn-note">Step-to-step % appears once ${U.esc(b == null ? s.src : steps[k - 1].src)} sends data</span></div>`;
          else {
            const kp = a ? b / a : 0;
            h += `<div class="funnel-conn${k === weak ? ' weakest' : ''}"><span class="keep">${U.icon('arrow-down')} ${U.pct(kp)} continue</span><span class="drop">${U.pct(Math.max(0, 1 - kp))} drop-off</span>${k === weak ? `<span class="weak-badge">${U.icon('triangle-exclamation')} Weakest step</span>` : ''}</div>`;
          }
        }
      }
      const pend = s.n == null;
      const rate = s.kind === 'rate';
      const restarted = s.separate && s.n != null && s.n === pathBase;
      const w = pend ? 0 : rate ? Math.min(100, Math.max(0, Number(s.n) * 100)) : (denom ? Math.min(100, Math.max(0.8, (s.n / denom) * 100)) : 0);
      const count = pend
        ? `<span class="awaiting-chip">${U.esc(s.note || `Awaiting ${s.src}`)}</span>`
        : rate
          ? `${U.pct(s.n)}${s.em ? `<em>${U.esc(s.em)}</em>` : ''}`
          : `${U.fmt(s.n)}${!restarted && denom ? `<em>${U.pct(s.n / denom)}</em>` : ''}`;
      h += `<div class="funnel-step" role="listitem"><span class="funnel-idx">${k + 1}</span><span class="funnel-name">${U.esc(s.name)}<small>${U.esc(s.src)}</small></span><div class="funnel-track${pend ? ' pending' : ''}">${pend ? '' : `<div class="funnel-fill" style="width:${w.toFixed(2)}%"></div>`}</div><span class="funnel-count">${count}</span></div>`;
    });
    return `<div class="funnel" role="list" aria-label="${U.esc(label)}">${h}</div>`;
  };
})(window.App);
