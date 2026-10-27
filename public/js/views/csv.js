'use strict';
/* CSV Import: load exports for tools without an automatic connection, through the same api/ingest call as before. */
(function (A) {
  const CV = { metrics: null, bad: 0, name: '', source: '' };
  function parseCSV(text) {
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const cells = []; let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
        else if (c === '"') q = true; else if (c === ',' || c === ';') { cells.push(cur); cur = ''; } else cur += c;
      }
      cells.push(cur); rows.push(cells.map((x) => x.trim()));
    }
    return rows;
  }
  function toCSV() {
    const lines = ['source,metric,date,dim,dim_value,value'];
    for (const r of A.D.M()) lines.push([r.source, r.metric, r.date, r.dim, `"${String(r.dim_value == null ? '' : r.dim_value).replace(/"/g, '""')}"`, r.value].join(','));
    return lines.join('\n');
  }
  function toMetrics(text) {
    const rows = parseCSV(text);
    if (!rows.length) return { metrics: [], bad: 0 };
    const hdr = rows[0].map((h) => h.toLowerCase());
    const hasHeader = hdr.includes('date') && hdr.includes('value');
    const idx = (n, d) => (hasHeader ? hdr.indexOf(n) : d);
    const iD = idx('date', 0), iM = idx('metric', 1), iV = idx('value', 2), iDim = idx('dim', 3), iDv = idx('dim_value', 4);
    const all = (hasHeader ? rows.slice(1) : rows).map((r) => ({ date: r[iD], metric: r[iM], value: Number(String(r[iV]).replace(/[$\s]/g, '')), dim: iDim >= 0 ? r[iDim] || '' : '', dim_value: iDv >= 0 ? r[iDv] || '' : '' }));
    const metrics = all.filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.date) && m.metric && Number.isFinite(m.value));
    return { metrics, bad: all.length - metrics.length };
  }
  function previewHtml() {
    const U = A.ui;
    if (!CV.metrics) return '';
    if (!CV.metrics.length) return `<div class="preview-box">${U.empty('No valid rows', 'Use date (YYYY-MM-DD), metric and value; optional dim and dim_value.', 'triangle-exclamation')}</div>`;
    const dates = CV.metrics.map((m) => m.date).sort();
    return `<div class="preview-box"><div class="preview-summary">${U.pill('success', `${CV.metrics.length} valid rows`)}${CV.bad ? U.pill('error', `${CV.bad} invalid rows left out`) : ''}<span class="mono">${U.esc(CV.name)} · ${U.win(dates[0], dates[dates.length - 1])}</span></div>
      ${U.table([{ t: 'Date', k: 'date' }, { t: 'Metric', f: (r) => `<code>${U.esc(r.metric)}</code>` }, { t: 'Dimension', f: (r) => U.esc([r.dim, r.dim_value].filter(Boolean).join(': ') || '–') }, { t: 'Value', num: 1, f: (r) => U.fmt(r.value) }], CV.metrics.slice(0, 8))}
      ${CV.metrics.length > 8 ? `<p class="card-note">…and ${CV.metrics.length - 8} more rows.</p>` : ''}</div>`;
  }
  function render() {
    const U = A.ui, ss = A.S.data.sources || [];
    const def = CV.source || (ss.find((s) => !s.auto) || ss[0] || {}).key;
    const form = U.card({
      title: 'Load a CSV export', sub: 'For tools without an automatic connection yet (LinkedIn, Meta, Clarity). Loading the same date and metric again replaces the value.',
      body: `<form id="csv-form">
        <div class="form-row"><label class="field" for="csv-source"><span>Source</span><select id="csv-source" style="width:240px">${ss.map((s) => `<option value="${U.esc(s.key)}"${s.key === def ? ' selected' : ''}>${U.esc(s.name)}</option>`).join('')}</select></label></div>
        <label class="dropzone mt-16" id="csv-drop" for="csv-file">${U.icon('cloud-arrow-up')}<b>${CV.name ? U.esc(CV.name) : 'Drop a CSV here or click to choose'}</b><span>Columns: date, metric, value · optional dim, dim_value</span><input type="file" id="csv-file" accept=".csv,text/csv"></label>
        <div id="csv-preview">${previewHtml()}</div>
        <div class="form-row mt-16"><button class="btn btn-primary" id="csv-load"${CV.metrics && CV.metrics.length ? '' : ' disabled'}>${U.icon('upload')} Load rows</button>${CV.metrics ? `<button type="button" class="btn btn-ghost" data-csv-clear>Clear</button>` : ''}</div>
      </form>`,
    });
    const help = U.card({
      title: 'Format', sub: 'One row per date and metric',
      body: `<pre class="code-block">date,metric,value,dim,dim_value
2026-10-20,ad_spend,35.5,campaign,LATAM launch
2026-10-20,ad_clicks,120,campaign,LATAM launch
2026-10-20,followers,842,,</pre>
        <p class="card-note">Paid metrics: <code>ad_spend</code>, <code>ad_impressions</code>, <code>ad_clicks</code>, <code>ad_results</code>. They feed Social and Paid and the ad spend, clicks and CTR goals.</p>
        <p class="card-note">Monthly targets are not loaded here: use the upload on the Targets screen.</p>
        <div class="form-row mt-16"><button type="button" class="btn btn-secondary" data-dl-csv>${U.icon('file-arrow-down')} Download all daily data (CSV)</button><button type="button" class="btn btn-ghost" data-go="targets">${U.icon('bullseye')} Targets</button></div>`,
    });
    return U.section('CSV import', 'Manual loads go through the same ingestion as the connectors and show up in the load history.', `<div class="grid-2-1">${form}${help}</div>`);
  }
  function mount(el) {
    const U = A.ui;
    const take = async (file) => {
      if (!file) return;
      const r = toMetrics(await file.text());
      CV.metrics = r.metrics; CV.bad = r.bad; CV.name = file.name; CV.source = el.querySelector('#csv-source').value;
      A.render();
    };
    el.querySelector('#csv-file').addEventListener('change', (e) => take(e.target.files[0]));
    el.querySelector('#csv-source').addEventListener('change', (e) => { CV.source = e.target.value; });
    const drop = el.querySelector('#csv-drop');
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('drag')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); take(e.dataTransfer.files[0]); });
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-csv-clear]')) { CV.metrics = null; CV.name = ''; CV.bad = 0; A.render(); return; }
      if (e.target.closest('[data-dl-csv]')) U.download(`latam-growth-${U.today()}.csv`, toCSV());
    });
    el.querySelector('#csv-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!CV.metrics || !CV.metrics.length) return U.toast('No valid rows: use date (YYYY-MM-DD), metric and value', 'error');
      const src = el.querySelector('#csv-source').value;
      const btn = el.querySelector('#csv-load'); btn.disabled = true;
      try {
        const dates = CV.metrics.map((m) => m.date).sort();
        const r = await A.api('api/ingest', { method: 'POST', headers: { 'x-load-how': 'csv' }, body: JSON.stringify({ source: src, from: dates[0], to: dates[dates.length - 1], metrics: CV.metrics }) });
        U.toast(`${r.metrics} rows loaded`);
        CV.metrics = null; CV.name = ''; CV.bad = 0;
        await A.load();
      } catch (err) { btn.disabled = false; if (err.message !== 'code') U.toast(err.message, 'error'); }
    });
  }
  A.views.csv = { title: 'CSV Import', render, mount };
})(window.App);
