'use strict';
(() => {
/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
/* Local-date keys only. Never toISOString() for dates — that converts to UTC and can shift the day. */
const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && keyOf(parseKey(k)) === k;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const todayKey = () => keyOf(new Date());
const mondayOf = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const fmtLong = (k) => parseKey(k).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = (k) => parseKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtShortY = (k) => parseKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const kg = (n) => (Math.round(n * 10) / 10).toFixed(1);
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);
const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2400); };

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
/* traditional Japanese month names + a seasonal note */
const WAFU = [['睦月','Mutsuki','deep winter'],['如月','Kisaragi','late winter'],['弥生','Yayoi','early spring'],['卯月','Uzuki','cherry blossom season'],['皐月','Satsuki','fresh green'],['水無月','Minazuki','early summer rain'],['文月','Fumizuki','midsummer'],['葉月','Hazuki','late summer'],['長月','Nagatsuki','early autumn'],['神無月','Kannazuki','autumn leaves'],['霜月','Shimotsuki','first frost'],['師走','Shiwasu','year’s end']];
const greet = (h) => h < 5 ? ['こんばんは', 'Good evening'] : h < 11 ? ['おはようございます', 'Good morning'] : h < 17 ? ['こんにちは', 'Good afternoon'] : ['こんばんは', 'Good evening'];

const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';
const FUJI = `<svg class="fuji" viewBox="0 0 240 120" aria-hidden="true"><circle cx="176" cy="38" r="22" fill="#f6cdd6" opacity=".75"/><path d="M0 120 L82 44 Q96 32 110 44 L196 120Z" fill="#e9dfe3"/><path d="M82 44 Q96 32 110 44 L122 55 L112 52 L104 60 L96 51 L88 59 L80 51 L70 55Z" fill="#fffdfa"/><path d="M120 120 L178 76 Q186 70 194 76 L240 110 L240 120Z" fill="#efe6e8"/><path d="M0 112 Q60 100 120 110 T240 106 L240 120 L0 120Z" fill="#f4ece6"/></svg>`;

/* ---------- state ---------- */
let recs = new Map();            // mirror of IndexedDB "days" store (IDB is the source of truth)
let tab = 'today', calY, calM, sheetDate = null;
let wRange = '90', wMode = 'daily';
let petals = null, dbReady = false, lastToday = todayKey();

const blank = (date) => ({ date, protein: null, calorie: null, weight: null });
const isEmpty = (r) => r.protein == null && r.calorie == null && r.weight == null;
const tracked = (r) => !!r && (r.protein != null || r.calorie != null);
const both = (r) => !!r && r.protein === true && r.calorie === true;
function norm(x) {
  if (!x || !isKey(x.date)) return null;
  const b = (v) => (v === true || v === 'yes' || v === 1 || v === '1' || v === 'true') ? true : (v === false || v === 'no' || v === 0 || v === '0' || v === 'false') ? false : null;
  let w = x.weight ?? x.weight_kg;
  w = w === '' || w == null ? null : Number(w);
  if (w != null && !(isFinite(w) && w >= 20 && w <= 400)) w = null;
  const r = { date: x.date, protein: b(x.protein ?? x.protein_met), calorie: b(x.calorie ?? x.calorie_met), weight: w == null ? null : Math.round(w * 100) / 100 };
  r.updatedAt = typeof x.updatedAt === 'string' ? x.updatedAt : new Date().toISOString();
  return isEmpty(r) ? null : r;
}

/* ---------- persistence ---------- */
function dbFail(e, what) {
  console.error(e);
  const b = $('#banner');
  b.hidden = false;
  b.textContent = (what || 'Storage problem') + ': ' + (e && e.message ? e.message : e) + '. Your entries may not be saved in this browser (private mode blocks storage).';
}
async function update(date, patch) {
  const prev = recs.get(date) || blank(date);
  const next = { ...prev, ...patch, date, updatedAt: new Date().toISOString() };
  try {
    if (isEmpty(next)) { await DB.del(date); recs.delete(date); }
    else { await DB.put(next); recs.set(date, next); }
    askPersist();
  } catch (e) { dbFail(e, 'Could not save'); toast('Not saved — see the message at the top'); }
  render(); if (sheetDate) renderSheet();
}
let persistAsked = false;
async function askPersist() {
  if (persistAsked || !navigator.storage || !navigator.storage.persist) return;
  persistAsked = true;
  try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}

/* ---------- statistics (never count future or empty days as failures) ---------- */
function rangeKeys(from, to) { const out = []; for (let d = from; keyOf(d) <= keyOf(to); d = addDays(d, 1)) out.push(keyOf(d)); return out; }
function adherence(from, to) {
  const ks = rangeKeys(from, to).filter((k) => tracked(recs.get(k)));
  const ok = ks.filter((k) => both(recs.get(k))).length;
  return { ok, n: ks.length, p: pct(ok, ks.length) };
}
function stats() {
  const t = todayKey(), now = new Date();
  const days = [...recs.values()].filter((r) => tracked(r) && r.date <= t);
  const pSet = days.filter((r) => r.protein != null), cSet = days.filter((r) => r.calorie != null);
  let d = now; if (!both(recs.get(keyOf(d)))) d = addDays(d, -1);
  let cur = 0; while (both(recs.get(keyOf(d)))) { cur++; d = addDays(d, -1); }
  const bk = days.filter(both).map((r) => r.date).sort();
  let best = 0, run = 0, prev = null;
  bk.forEach((k) => { run = prev && keyOf(addDays(parseKey(prev), 1)) === k ? run + 1 : 1; best = Math.max(best, run); prev = k; });
  return {
    total: days.length,
    protein: pct(pSet.filter((r) => r.protein).length, pSet.length),
    calorie: pct(cSet.filter((r) => r.calorie).length, cSet.length),
    both: bk.length, cur, best,
    week: adherence(mondayOf(now), now),
    month: adherence(new Date(now.getFullYear(), now.getMonth(), 1), now),
  };
}
function weekAvg(mon) {
  const ws = rangeKeys(mon, addDays(mon, 6)).map((k) => recs.get(k)?.weight).filter((w) => typeof w === 'number');
  return ws.length ? { avg: ws.reduce((a, b) => a + b, 0) / ws.length, n: ws.length } : null;
}
const weighIns = () => [...recs.values()].filter((r) => typeof r.weight === 'number').sort((a, b) => (a.date < b.date ? -1 : 1));
function weeklySeries() {
  const w = weighIns(); if (!w.length) return [];
  const out = []; let m = mondayOf(parseKey(w[0].date)); const end = mondayOf(new Date());
  for (; keyOf(m) <= keyOf(end); m = addDays(m, 7)) { const a = weekAvg(m); if (a) out.push({ mon: keyOf(m), ...a }); }
  return out;
}
const trend = (a, b) => { const d = a - b; return Math.abs(d) < 0.05 ? ['flat', '=', '0.0'] : d > 0 ? ['up', '▲', '+' + kg(d)] : ['down', '▼', '−' + kg(-d)]; };

/* ---------- views ---------- */
function goalCard(g, label, jp, r, date) {
  const v = r ? r[g] : null;
  return `<section class="goal ${g} ${v === true ? 'met' : v === false ? 'miss' : ''}">
    <div class="jp">${jp}</div><h2>${label}</h2>
    <div class="gs">${v === true ? 'Goal met' : v === false ? 'Not met today' : 'Not logged yet'}</div>
    <div class="gbtns">
      <button class="gb yes ${v === true ? 'on' : ''}" data-a="goal" data-d="${date}" data-g="${g}" data-v="1" aria-pressed="${v === true}">${ICON_CHECK}Met</button>
      <button class="gb no ${v === false ? 'on' : ''}" data-a="goal" data-d="${date}" data-g="${g}" data-v="0" aria-pressed="${v === false}">${ICON_X}Not met</button>
    </div></section>`;
}
function weightSummary(t) {
  const r = recs.get(t), w = r?.weight, all = weighIns(), latest = all[all.length - 1];
  const mon = mondayOf(new Date()), a = weekAvg(mon), b = weekAvg(addDays(mon, -7));
  const n = (x) => x ? `${x.n} weigh-in${x.n > 1 ? 's' : ''}` : 'no weigh-ins';
  let diff = '<b class="flat">—</b><small>needs both weeks</small>';
  if (a && b) { const [c, ar, txt] = trend(a.avg, b.avg); diff = `<b class="${c}">${ar} ${txt}</b><small>kg vs last week</small>`; }
  return `<section class="card wcard">
    <div class="wtop"><div><label for="w-${t}">Morning weight</label><div class="mu xs">${latest ? 'Latest: ' + kg(latest.weight) + ' kg · ' + (latest.date === t ? 'today' : fmtShort(latest.date)) : 'Optional · kg'}</div></div>
    <div class="winput"><input id="w-${t}" data-w="${t}" type="number" inputmode="decimal" step="0.1" min="20" max="400" placeholder="—" value="${w ?? ''}" aria-label="Weight in kilograms for today"><span class="mu">kg</span>${w != null ? `<button class="x" data-a="delw" data-d="${t}" aria-label="Delete today's weight">×</button>` : ''}</div></div>
    <div class="wk">
      <div><span>This week avg</span><b>${a ? kg(a.avg) : '—'}</b><small>${n(a)}</small></div>
      <div><span>Last week avg</span><b>${b ? kg(b.avg) : '—'}</b><small>${n(b)}</small></div>
      <div><span>Change</span>${diff}</div>
    </div></section>`;
}
function vToday() {
  const t = todayKey(), r = recs.get(t), s = stats(), now = new Date(), [jp, en] = greet(now.getHours()), wf = WAFU[now.getMonth()];
  const met = (r?.protein === true) + (r?.calorie === true), logged = (r?.protein != null) + (r?.calorie != null);
  const st = met === 2 ? ['done', 'Both goals met today. Well done 🌸'] : logged === 0 ? ['', 'Nothing logged yet today — two taps and you’re done.'] : met === 1 ? ['half', (logged === 2 ? '1 of 2 goals met today.' : '1 goal met — log the other one too.')] : ['', logged === 2 ? 'Neither goal met today. Tomorrow is a new day.' : 'One goal logged — log the other one too.'];
  return `<header class="hero"><p class="kana">${jp}</p><h1>${en}</h1><p class="date">${esc(fmtLong(t))}</p><p class="season">${wf[0]} · ${wf[1]} — ${wf[2]}</p>${FUJI}</header>
  <div class="status ${st[0]}"><span class="dot"></span><span>${st[1]}</span></div>
  <div class="goals">${goalCard('protein', 'Protein', 'タンパク質', r, t)}${goalCard('calorie', 'Calories', 'カロリー', r, t)}</div>
  <div class="strip">
    <div class="tile"><b>${s.cur}</b><span>day streak</span></div>
    <div class="tile"><b>${s.week.p == null ? '—' : s.week.p + '%'}</b><span>this week${s.week.n ? ' · ' + s.week.ok + '/' + s.week.n : ''}</span></div>
    <div class="tile"><b>${s.month.p == null ? '—' : s.month.p + '%'}</b><span>this month${s.month.n ? ' · ' + s.month.ok + '/' + s.month.n : ''}</span></div>
  </div>
  ${weightSummary(t)}`;
}
function dayStatus(k, t) {
  if (k > t) return 'future';
  const r = recs.get(k); if (!tracked(r)) return '';
  return both(r) ? 'both' : r.protein === true ? 'p' : r.calorie === true ? 'c' : 'none';
}
function vCal() {
  const t = todayKey(), first = new Date(calY, calM, 1), dim = new Date(calY, calM + 1, 0).getDate(), lead = (first.getDay() + 6) % 7;
  const isCur = calY === new Date().getFullYear() && calM === new Date().getMonth(), wf = WAFU[calM];
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<div class="day blank"></div>';
  let mb = 0, mp = 0, mc = 0, mt = 0;
  for (let d = 1; d <= dim; d++) {
    const k = keyOf(new Date(calY, calM, d)), r = recs.get(k), s = dayStatus(k, t), fut = s === 'future';
    if (tracked(r) && !fut) { mt++; if (both(r)) mb++; if (r.protein) mp++; if (r.calorie) mc++; }
    const dot = (v) => (v === true ? 'y' : v === false ? 'n' : '');
    const lab = `${fmtLong(k)}: ${!tracked(r) ? 'no entry' : 'protein ' + (r.protein === true ? 'met' : r.protein === false ? 'not met' : 'not logged') + ', calories ' + (r.calorie === true ? 'met' : r.calorie === false ? 'not met' : 'not logged')}${r?.weight != null ? ', weight ' + kg(r.weight) + ' kg' : ''}`;
    cells += `<button class="day ${s ? 's-' + s : ''} ${fut ? 'future' : ''} ${k === t ? 'today' : ''}" data-a="open" data-d="${k}" ${fut ? 'disabled' : ''} aria-label="${esc(lab)}"><span class="n">${d}</span><span class="dots"><i class="p ${dot(r?.protein)}"></i><i class="c ${dot(r?.calorie)}"></i></span>${r?.weight != null ? `<span class="wt">${kg(r.weight)}</span>` : ''}</button>`;
  }
  const s = stats();
  const tile = (v, l) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`;
  return `<div class="card fade-in">
    <div class="calh"><button class="nav-b" data-a="mon" data-v="-1" aria-label="Previous month">‹</button>
      <div class="t"><h2>${MONTHS[calM]} ${calY}</h2><p>${wf[0]} · ${wf[1]} — ${wf[2]}</p></div>
      <button class="nav-b" data-a="mon" data-v="1" aria-label="Next month">›</button></div>
    ${isCur ? '' : '<div style="text-align:center;margin:-4px 0 10px"><button class="chip" data-a="mon" data-v="0">Back to today</button></div>'}
    <div class="grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => `<div class="wd">${w}</div>`).join('')}${cells}</div>
    <div class="legend"><span><i class="sw both"></i>Both met</span><span><i class="sw p"></i>Protein only</span><span><i class="sw c"></i>Calories only</span><span><i class="sw none"></i>Neither</span><span><i class="sw fut"></i>Future</span><span class="lgk"><b class="lg-p">●</b> protein · <b class="lg-c">●</b> calories · ○ not met · small number = weight</span></div>
    <div class="msum"><div><b>${mb}</b><span>both met</span></div><div><b>${mp}</b><span>protein</span></div><div><b>${mc}</b><span>calories</span></div><div><b>${mt}</b><span>days logged</span></div></div>
  </div>
  <div class="sec-h"><h2>Overview</h2><span class="mu sm">all time</span></div>
  <div class="tiles">
    ${tile(s.total, 'days tracked')}${tile(s.both, 'both goals met')}
    ${tile(s.protein == null ? '—' : s.protein + '%', 'protein met')}${tile(s.calorie == null ? '—' : s.calorie + '%', 'calories met')}
    ${tile(s.cur, 'current streak')}${tile(s.best, 'best streak')}
    ${tile(s.week.p == null ? '—' : s.week.p + '%', 'weekly adherence')}${tile(s.month.p == null ? '—' : s.month.p + '%', 'monthly adherence')}
  </div>
  <p class="mu xs" style="margin:10px 2px">Adherence = days with both goals met ÷ days you logged. Days with no entry are not counted as failures. Weeks run Monday–Sunday.</p>`;
}
function chart(points) {
  if (!points.length) return '<div class="empty">No weigh-ins in this range yet.</div>';
  const W = 640, H = 260, L = 56, R = 14, T = 16, B = 34;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x0 === x1) { x0 -= 86400000 * 3; x1 += 86400000 * 3; }
  let y0 = Math.floor(Math.min(...ys) - 0.5), y1 = Math.ceil(Math.max(...ys) + 0.5); if (y1 - y0 < 2) { y0 -= 1; y1 += 1; }
  const X = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R), Y = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = y0 + ((y1 - y0) * i) / 4, y = Y(v); g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#efe5df"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${v.toFixed(1)}</text>`; }
  const lab = (x) => new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  g += `<text x="${L}" y="${H - 8}">${lab(x0)}</text><text x="${W - R}" y="${H - 8}" text-anchor="end">${lab(x1)}</text>`;
  const pts = points.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const col = wMode === 'weekly' ? '#8fa57a' : '#c96f8a';
  const area = `M${X(points[0].x)},${H - B} L${pts.replace(/ /g, ' L')} L${X(points[points.length - 1].x)},${H - B}Z`;
  const dots = points.length <= 120 ? points.map((p) => `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${wMode === 'weekly' ? 4 : 3}" fill="#fff" stroke="${col}" stroke-width="2"><title>${esc(p.t)}</title></circle>`).join('') : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight trend chart">${g}<path d="${area}" fill="${col}" opacity=".08"/><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`;
}
function vWeight() {
  const all = weighIns(), now = new Date(), from = wRange === 'all' ? '0000' : keyOf(addDays(now, -Number(wRange) + 1));
  let pts;
  if (wMode === 'weekly') pts = weeklySeries().filter((w) => keyOf(addDays(parseKey(w.mon), 6)) >= from).map((w) => ({ x: addDays(parseKey(w.mon), 3).getTime(), y: w.avg, t: 'Week of ' + fmtShort(w.mon) + ': ' + kg(w.avg) + ' kg (' + w.n + ')' }));
  else pts = all.filter((r) => r.date >= from).map((r) => ({ x: parseKey(r.date).getTime(), y: r.weight, t: fmtShort(r.date) + ': ' + kg(r.weight) + ' kg' }));
  const chip = (a, v, cur, l) => `<button class="chip ${v === cur ? 'on' : ''}" data-a="${a}" data-v="${v}">${l}</button>`;
  const ws = weeklySeries().reverse();
  const rows = ws.slice(0, 26).map((w, i) => { const p = ws[i + 1]; let d = '<span class="mu">—</span>'; if (p) { const [c, ar, txt] = trend(w.avg, p.avg); d = `<span class="${c}">${ar} ${txt}</span>`; } return `<tr><td>${fmtShortY(w.mon)}</td><td><b>${kg(w.avg)}</b></td><td class="mu">${w.n}</td><td>${d}</td></tr>`; }).join('');
  const recent = all.slice().reverse().slice(0, 14).map((r) => `<button class="row-btn" data-a="open" data-d="${r.date}"><span>${esc(fmtShortY(r.date))}</span><b>${kg(r.weight)} kg</b></button>`).join('');
  return `<h1 class="serif" style="font-size:28px;margin:14px 2px 4px">Weight</h1><p class="mu sm" style="margin:0 2px 14px">体重 · morning weigh-ins, kilograms</p>
  <div class="card"><div class="ctl"><div class="chips">${chip('mode', 'daily', wMode, 'Daily')}${chip('mode', 'weekly', wMode, 'Weekly avg')}</div><div class="chips">${chip('range', '30', wRange, '30d')}${chip('range', '90', wRange, '90d')}${chip('range', '365', wRange, '1y')}${chip('range', 'all', wRange, 'All')}</div></div>${chart(pts)}</div>
  <div class="sec-h"><h2>Weekly averages</h2><span class="mu sm">Mon–Sun</span></div>
  <div class="card">${rows ? `<table><thead><tr><th>Week of</th><th>Avg kg</th><th>Weigh-ins</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">Your weekly averages will appear after your first weigh-in.</div>'}</div>
  <div class="sec-h"><h2>Recent weigh-ins</h2><span class="mu sm">tap to edit</span></div>
  <div class="card">${recent || '<div class="empty">No weigh-ins yet. Add today’s on the Today tab, or any day from the calendar.</div>'}</div>`;
}
function vSettings() {
  const keys = [...recs.keys()].sort(), latest = keys[keys.length - 1], wn = weighIns().length;
  return `<h1 class="serif" style="font-size:28px;margin:14px 2px 14px">Settings</h1>
  <div class="card"><h2>Appearance</h2>
    <label class="set-row"><span>Falling petals<br><span class="mu sm">Gentle animation in the background</span></span><span class="toggle"><input type="checkbox" data-s="petals" ${petalsOn() ? 'checked' : ''}><i></i></span></label></div>
  <div class="card"><h2>Your data</h2>
    <div class="kv"><span class="mu">Days with entries</span><b>${recs.size}</b></div>
    <div class="kv"><span class="mu">Weigh-ins</span><b>${wn}</b></div>
    <div class="kv"><span class="mu">Latest recorded entry</span><b>${latest ? esc(fmtShortY(latest)) : '—'}</b></div>
    <div class="kv"><span class="mu">Storage</span><b id="persist">checking…</b></div>
    <div class="g2" style="margin-top:12px"><button class="btn" data-a="export">Export JSON</button><button class="btn" data-a="csv">Download CSV</button></div>
    <button class="btn full" style="margin-top:10px" data-a="import">Import backup (JSON or CSV)</button>
    <button class="btn dng full" style="margin-top:10px" data-a="wipe">Delete all data…</button></div>
  <div class="card help"><h2>Keeping your records safe</h2>
    <p>Everything is stored on this device in your browser’s database (IndexedDB). It survives refreshes, closing the app and website updates.</p>
    <p>It is <b>not</b> synced anywhere. Clearing this site’s browser data, uninstalling the browser or changing phones will remove it — so <b>export a JSON backup now and then</b> (once a month is plenty) and keep it in Google Drive or email.</p>
    <p>To restore, tap <b>Import backup</b> and choose the file. You’ll be asked whether to merge or replace before anything changes.</p></div>
  <p class="mu xs" style="text-align:center;margin:18px 0">Sakura · v1 · works offline</p>`;
}

/* ---------- day sheet ---------- */
function renderSheet() {
  const k = sheetDate, r = recs.get(k) || blank(k), p = $('#sheet .panel');
  const row = (g, l) => `<div class="prow ${g}"><b>${l}</b><div class="chips"><button class="chip y ${r[g] === true ? 'on' : ''}" data-a="goal" data-d="${k}" data-g="${g}" data-v="1" aria-pressed="${r[g] === true}">Met</button><button class="chip n ${r[g] === false ? 'on' : ''}" data-a="goal" data-d="${k}" data-g="${g}" data-v="0" aria-pressed="${r[g] === false}">Not met</button></div></div>`;
  p.innerHTML = `<h2 id="sheet-title" class="serif">${esc(fmtLong(k))}</h2><p class="sub">${k === todayKey() ? 'Today' : 'Edit this day — tap a selected option again to clear it.'}</p>
    ${row('protein', 'Protein')}${row('calorie', 'Calories')}
    <div class="prow"><label for="w-${k}"><b>Weight</b> <span class="mu sm">optional</span></label><div class="winput"><input id="w-${k}" data-w="${k}" type="number" inputmode="decimal" step="0.1" min="20" max="400" placeholder="—" value="${r.weight ?? ''}"><span class="mu">kg</span>${r.weight != null ? `<button class="x" data-a="delw" data-d="${k}" aria-label="Delete weight for this day">×</button>` : ''}</div></div>
    <div class="acts"><button class="btn pri" data-a="close">Done</button>${recs.has(k) ? `<button class="btn dng" data-a="clearday" data-d="${k}">Clear this day</button>` : ''}</div>`;
}
let lastFocus = null;
function openSheet(k) { lastFocus = document.activeElement; sheetDate = k; renderSheet(); $('#sheet').hidden = false; $('#sheet .chip')?.focus(); }
function closeSheet() { const w = $('#sheet input[data-w]'); if (w) saveWeight(w); sheetDate = null; $('#sheet').hidden = true; lastFocus?.focus?.(); }

/* generic dialog → Promise of chosen value */
function ask(title, html, buttons) {
  return new Promise((res) => {
    const m = $('#modal'), p = $('.panel', m);
    p.innerHTML = `<h2 id="modal-title" class="serif">${esc(title)}</h2><div class="sub" style="color:var(--ink)">${html}</div><div class="acts">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`;
    m.hidden = false; $('button', p).focus();
    const done = (v) => { m.hidden = true; p.onclick = null; m.onclick = null; document.removeEventListener('keydown', kd); res(v); };
    const kd = (e) => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', kd);
    p.onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) done(buttons[+b.dataset.i].value); };
    m.onclick = (e) => { if (e.target === m) done(null); };
  });
}

/* ---------- render ---------- */
const petalsOn = () => (petals == null ? !matchMedia('(prefers-reduced-motion: reduce)').matches : petals);
function applyPetals() {
  document.body.classList.toggle('calm', !petalsOn());
  const box = $('#petals');
  if (petalsOn() && !box.children.length) {
    for (let i = 0; i < 9; i++) { const e = document.createElement('i'); e.style.left = (5 + Math.random() * 90) + '%'; e.style.animationDuration = (14 + Math.random() * 14) + 's'; e.style.animationDelay = (-Math.random() * 25) + 's'; e.style.transform = `scale(${0.6 + Math.random() * 0.6})`; box.append(e); }
  }
}
function render() {
  const v = $('#view'), y = window.scrollY;
  v.innerHTML = ({ today: vToday, calendar: vCal, weight: vWeight, settings: vSettings })[tab]();
  document.querySelectorAll('#nav button').forEach((b) => { const on = b.dataset.v === tab; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  window.scrollTo(0, y);
  if (tab === 'settings') showPersist();
}
async function showPersist() {
  const el = $('#persist'); if (!el) return;
  let s = 'Saved on this device';
  try { if (navigator.storage?.persisted) s = (await navigator.storage.persisted()) ? 'Protected from automatic cleanup' : 'Saved on this device'; } catch {}
  if (!dbReady) s = 'Unavailable';
  el.textContent = s;
}

/* ---------- weight input ---------- */
function saveWeight(el) {
  const k = el.dataset.w, raw = el.value.trim().replace(',', '.'), cur = recs.get(k)?.weight ?? null;
  if (raw === '') { if (cur != null) update(k, { weight: null }); return; }
  const v = Math.round(Number(raw) * 100) / 100;
  if (!isFinite(v) || v < 20 || v > 400) { toast('Enter a weight between 20 and 400 kg'); el.value = cur ?? ''; return; }
  if (v !== cur) { update(k, { weight: v }).then(() => toast('Weight saved')); }
}

/* ---------- import / export ---------- */
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const sorted = () => [...recs.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
function exportJSON() {
  const data = { app: 'sakura-tracker', format: 1, exportedAt: new Date().toISOString(), count: recs.size, entries: sorted() };
  download(`sakura-backup-${todayKey()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast(`Backup exported · ${recs.size} days`);
}
function toCSV() {
  const yn = (v) => (v === true ? 'yes' : v === false ? 'no' : '');
  return 'date,protein_met,calorie_met,weight_kg\n' + sorted().map((r) => [r.date, yn(r.protein), yn(r.calorie), r.weight ?? ''].join(',')).join('\n') + '\n';
}
function parseFile(text, name) {
  const t = text.replace(/^﻿/, '').trim();
  let rows;
  if (/\.json$/i.test(name) || t.startsWith('{') || t.startsWith('[')) {
    const j = JSON.parse(t);
    rows = Array.isArray(j) ? j : Array.isArray(j.entries) ? j.entries : null;
    if (!rows) throw new Error('This JSON file is not a Sakura backup');
  } else {
    const lines = t.split(/\r?\n/).filter(Boolean), head = lines.shift().split(',').map((s) => s.trim().toLowerCase());
    if (!head.includes('date')) throw new Error('CSV needs a "date" column');
    rows = lines.map((l) => { const c = l.split(','); const o = {}; head.forEach((h, i) => (o[h] = (c[i] ?? '').trim())); return o; });
  }
  const ok = [], seen = new Map(); let bad = 0;
  rows.forEach((x) => { const r = norm(x); if (r) seen.set(r.date, r); else bad++; });
  seen.forEach((r) => ok.push(r));
  return { ok, bad };
}
async function importFile(file) {
  let res;
  try { res = parseFile(await file.text(), file.name); } catch (e) { return ask('Could not read that file', esc(e.message || 'Unknown error'), [{ label: 'OK', value: 0, cls: 'pri' }]); }
  if (!res.ok.length) return ask('Nothing to import', 'No valid entries were found in this file.', [{ label: 'OK', value: 0, cls: 'pri' }]);
  const ks = res.ok.map((r) => r.date).sort(), overlap = res.ok.filter((r) => recs.has(r.date)).length;
  const html = `<p>The file has <b>${res.ok.length}</b> day${res.ok.length > 1 ? 's' : ''} (${esc(fmtShortY(ks[0]))} – ${esc(fmtShortY(ks[ks.length - 1]))})${res.bad ? `; ${res.bad} invalid row${res.bad > 1 ? 's' : ''} will be skipped` : ''}. This device has <b>${recs.size}</b>.</p>
    <p style="margin-top:8px"><b>Merge</b> — adds the file’s days; for the ${overlap} date${overlap === 1 ? '' : 's'} that exist in both, the file’s version replaces this device’s. Other days here are kept.</p>
    <p style="margin-top:8px"><b>Replace all</b> — deletes everything on this device first, then restores the file exactly.</p>`;
  const choice = await ask('Import backup?', html, [{ label: 'Merge', value: 'merge', cls: 'pri' }, { label: 'Replace all', value: 'replace', cls: 'dng' }, { label: 'Cancel', value: null }]);
  if (!choice) return;
  try {
    if (choice === 'replace') { await DB.replaceAll(res.ok); } else { await DB.merge(res.ok); }
    recs = new Map((await DB.all()).map((r) => [r.date, r]));
    toast(`Imported ${res.ok.length} days`); render();
  } catch (e) { dbFail(e, 'Import failed — nothing was changed'); }
}
async function wipe() {
  const c = await ask('Delete all data?', `<p>This permanently deletes <b>${recs.size}</b> day${recs.size === 1 ? '' : 's'} of goals and weigh-ins from this device. It cannot be undone.</p><p style="margin-top:8px">Export a backup first if you might want them back.</p>`, [{ label: 'Export backup first', value: 'export', cls: 'pri' }, { label: 'Delete everything', value: 'del', cls: 'dng fill' }, { label: 'Cancel', value: null }]);
  if (c === 'export') { exportJSON(); return; }
  if (c !== 'del') return;
  const c2 = await ask('Are you absolutely sure?', 'All records will be erased now.', [{ label: 'Yes, delete everything', value: 1, cls: 'dng fill' }, { label: 'Cancel', value: 0 }]);
  if (!c2) return;
  try { await DB.clear(); recs.clear(); toast('All data deleted'); render(); } catch (e) { dbFail(e, 'Could not delete'); }
}

/* ---------- events ---------- */
const A = {
  tab: (el) => { tab = el.dataset.v; if (tab === 'calendar' && calY == null) { const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); } render(); window.scrollTo(0, 0); $('#view').focus({ preventScroll: true }); },
  goal: (el) => { const k = el.dataset.d, g = el.dataset.g, v = el.dataset.v === '1', cur = recs.get(k)?.[g] ?? null; update(k, { [g]: cur === v ? null : v }); },
  open: (el) => openSheet(el.dataset.d),
  close: () => closeSheet(),
  delw: (el) => { const i = document.querySelector(`input[data-w="${el.dataset.d}"]`); if (i) i.value = ''; update(el.dataset.d, { weight: null }).then(() => toast('Weight deleted')); },
  clearday: async (el) => { const k = el.dataset.d; const c = await ask('Clear this day?', `Removes both goals and the weight for ${esc(fmtShortY(k))}.`, [{ label: 'Clear day', value: 1, cls: 'dng fill' }, { label: 'Cancel', value: 0 }]); if (c) { await update(k, { protein: null, calorie: null, weight: null }); closeSheet(); } },
  mon: (el) => { const d = +el.dataset.v; if (d === 0) { const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); } else { const n = new Date(calY, calM + d, 1); calY = n.getFullYear(); calM = n.getMonth(); } render(); },
  mode: (el) => { wMode = el.dataset.v; render(); },
  range: (el) => { wRange = el.dataset.v; render(); },
  export: () => exportJSON(),
  csv: () => { download(`sakura-history-${todayKey()}.csv`, toCSV(), 'text/csv'); toast('CSV downloaded'); },
  import: () => $('#file').click(),
  wipe: () => wipe(),
};
document.addEventListener('click', (e) => { const el = e.target.closest('[data-a]'); if (el && A[el.dataset.a] && !el.disabled) A[el.dataset.a](el); });
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetDate && $('#modal').hidden) closeSheet(); if (e.key === 'Enter' && e.target.matches('input[data-w]')) e.target.blur(); });
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.matches('input[data-w]')) saveWeight(el);
  if (el.dataset.s === 'petals') { petals = el.checked; DB.setMeta('petals', petals).catch(() => {}); applyPetals(); }
});
$('#file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
/* roll over to the new day if the app stays open past midnight */
const refresh = () => { const t = todayKey(); if (t !== lastToday) { lastToday = t; if (!sheetDate) render(); } };
setInterval(refresh, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

/* ---------- boot ---------- */
(async () => {
  const n = new Date(); calY = n.getFullYear(); calM = n.getMonth();
  try {
    const all = await DB.all();
    recs = new Map(all.map((r) => [r.date, r]));
    petals = (await DB.getMeta('petals')) ?? null;
    dbReady = true;
  } catch (e) { dbFail(e, 'Could not open your saved data'); }
  applyPetals(); render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch((e) => console.warn('SW', e));
})();
})();
