/* Squash League HQ: reads results (Google Sheet if connected, else the offline snapshot) and draws the page. */
(function () {
  'use strict';

  const CFG = window.CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) n.append(k);
    return n;
  };

  // ───────────────────────── Data loading ─────────────────────────
  async function gviz(sheetName) {
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(CFG.SHEET_ID)}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(sheetName)}&_=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${sheetName}: HTTP ${res.status}`);
    const text = await res.text();
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (json.status === 'error') throw new Error(`${sheetName}: ${json.errors?.[0]?.detailed_message || 'error'}`);
    const labels = json.table.cols.map((c) => (c.label || '').trim().toLowerCase());
    return json.table.rows.map((r) => {
      const o = {};
      labels.forEach((l, i) => { const c = r.c[i]; o[l || `col${i}`] = c ? (c.v ?? c.f ?? null) : null; });
      return o;
    });
  }

  function pick(o, test) {
    for (const [k, v] of Object.entries(o)) if (test(k) && v !== null && v !== '') return v;
    return null;
  }
  function toISO(v) {
    if (v == null || v === '') return null;
    const s = String(v);
    let m = s.match(/^Date\((\d+),(\d+),(\d+)/);
    if (m) return `${m[1]}-${String(+m[2] + 1).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    return null;
  }
  // "Date(2026,10,15,14,3,2)" → sortable "2026-10-15T14:03:02"
  function tsKey(v) {
    const m = String(v || '').match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?/);
    if (!m) return String(v || '');
    const p = (x) => String(+(x || 0)).padStart(2, '0');
    return `${m[1]}-${p(+m[2] + 1)}-${p(m[3])}T${p(m[4])}:${p(m[5])}:${p(m[6])}`;
  }
  const num = (v) => (v === null || v === '' || isNaN(+v) ? null : +v);

  // One sheet row → one result, or null if it doesn't make sense (bad rows are simply ignored)
  function normalise(o, source) {
    const isNotes = (k) => k.includes('notes');
    const field = (name) => num(pick(o, (k) => !isNotes(k) && k.includes(name)));
    const rivalry = /mic/i.test(String(pick(o, (k) => k.includes('rivalry')) || '')) ? 'jm' : 'jl';
    const r = {
      rivalry,
      date: toISO(pick(o, (k) => k.includes('date'))),
      ts: tsKey(pick(o, (k) => k.includes('timestamp'))),
      james: field('james'), mic: field('mic'), jigs: field('jigs'), lah: field('lah'),
      caveat: /^yes/i.test(String(pick(o, (k) => k.includes('asterisk')) || '')),
      notes: String(pick(o, isNotes) || '').trim(),
      reporter: String(pick(o, (k) => k.includes('reporting')) || ''),
      source,
    };
    if (rivalry === 'jm') {
      if (r.james == null || r.mic == null || (r.james === 0 && r.mic === 0)) return null;
    } else {
      const ok = (x) => Number.isInteger(x) && x >= 0 && x <= 3;
      if (!ok(r.jigs) || !ok(r.lah) || (r.jigs === 3 && r.lah === 3) || (r.jigs === 0 && r.lah === 0)) return null;
    }
    return r;
  }

  async function loadResults() {
    const snapshot = (window.SNAPSHOT || []).map((r) => ({ ...r }));
    if (!CFG.SHEET_ID) return { rows: snapshot, status: 'Showing the offline copy of the results (the Google Sheet isn’t connected yet).' };
    try {
      const [hist, resp] = await Promise.all([gviz('History'), gviz('Responses').catch(() => [])]);
      const history = hist.map((o) => normalise(o, 'history')).filter(Boolean);
      const fresh = resp.map((o) => normalise(o, 'form')).filter(Boolean)
        .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.ts.localeCompare(b.ts));
      const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      return { rows: history.concat(fresh), status: `Live from the league records. Last checked at ${now}. ${fresh.length} result${fresh.length === 1 ? '' : 's'} reported through the form so far.` };
    } catch (e) {
      console.warn('Sheet unavailable, using snapshot', e);
      return { rows: snapshot, status: 'Couldn’t reach the league records just now, so this is the offline copy. Recent results may be missing.' };
    }
  }

  // ───────────────────────── Helpers ─────────────────────────
  const fmtDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
    iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', opts) : null;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

  function setSeg(node, text) { if (node) node.querySelector('b').textContent = text; }

  function powerOn(board) {
    board.classList.remove('power-on');
    void board.offsetWidth;
    board.classList.add('power-on');
  }

  // ───────────────────────── Main event ─────────────────────────
  function renderMainEvent(rows) {
    const s = rows.filter((r) => r.rivalry === 'jm');
    const jw = s.filter((r) => r.james > r.mic).length;
    const mw = s.filter((r) => r.mic > r.james).length;
    const d = s.length - jw - mw;
    const jg = s.reduce((a, r) => a + r.james, 0);
    const mg = s.reduce((a, r) => a + r.mic, 0);

    const board = $('#me-board');
    setSeg(board.querySelector('[data-score="0"]'), String(jw));
    setSeg(board.querySelector('[data-score="1"]'), String(mw));
    setSeg($('#me-draws'), String(d));
    setSeg($('#me-games'), `${jg}-${mg}`);
    board.setAttribute('aria-label', `Scoreboard: James ${jw} sessions, Mic ${mw} sessions, ${d} drawn. Games: James ${jg}, Mic ${mg}.`);
    powerOn(board);

    // headline
    const last = s[s.length - 1];
    let deck;
    if (!s.length) deck = 'No sessions yet. Both men remain technically undefeated.';
    else {
      const lead = jw - mw;
      const leader = lead > 0 ? 'James' : 'Mic';
      const trailer = lead > 0 ? 'Mic' : 'James';
      const lastLine = last.james === last.mic
        ? `Last time out it finished ${last.james}–${last.mic}. Nobody won. Everybody lost.`
        : `Last time out ${last.james > last.mic ? 'James' : 'Mic'} took it ${Math.max(last.james, last.mic)}–${Math.min(last.james, last.mic)}.`;
      if (lead === 0) deck = `All square at ${jw}–${mw}. ${lastLine}`;
      else if ((lead > 0 ? mw : jw) === 0) deck = `${leader} leads ${Math.max(jw, mw)}–0${d ? `, with ${plural(d, 'draw')}` : ''}. ${trailer} has yet to win a session and has asked for the lighting to be reviewed. ${lastLine}`;
      else deck = `${leader} leads ${Math.max(jw, mw)}–${Math.min(jw, mw)}. ${lastLine}`;
    }
    $('#me-deck').textContent = deck;

    // tale of the tape
    const tape = (me, them) => {
      const mine = s.map((r) => [r[me], r[them]]);
      const wins = mine.filter(([a, b]) => a > b);
      const best = wins.sort((x, y) => (y[0] - y[1]) - (x[0] - x[1]))[0];
      const form = s.slice(-5).map((r) => (r[me] > r[them] ? 'W' : r[me] < r[them] ? 'L' : 'D'));
      return [
        ['Sessions won', String(mine.filter(([a, b]) => a > b).length)],
        ['Games won', `${mine.reduce((a, [x]) => a + x, 0)} (${pct(mine.reduce((a, [x]) => a + x, 0), jg + mg)}%)`],
        ['Biggest session win', best ? `${best[0]}–${best[1]}` : 'Pending'],
        ['Recent form', form.length ? form.join(' ') : '–'],
      ];
    };
    fillFacts($('#me-james'), tape('james', 'mic'));
    fillFacts($('#me-mic'), tape('mic', 'james'));

    // sessions list
    const list = $('#me-sessions');
    list.replaceChildren();
    if (!s.length) list.append(el('li', { class: 'empty', text: 'No sessions yet. Get on court.' }));
    s.forEach((r, i) => {
      const verdict = r.james === r.mic ? ['d', 'Draw'] : r.james > r.mic ? ['w', 'James'] : ['w', 'Mic'];
      const when = fmtDate(r.date) || 'Date not recorded';
      list.append(el('li', {},
        el('span', { class: 'num', text: String(i + 1) }),
        el('span', {},
          el('span', { class: 'score', text: `James ${r.james}–${r.mic} Mic` }),
          el('br'),
          el('span', { class: 'when', text: when + (r.notes ? `. ${r.notes}` : '') })),
        el('span', { class: `pill ${verdict[0]}`, text: verdict[0] === 'd' ? 'Draw' : `${verdict[1]} wins` })));
    });
  }

  function fillFacts(dl, pairs) {
    dl.replaceChildren();
    for (const [k, v] of pairs) {
      dl.append(el('dt', { text: k }));
      dl.append(v instanceof Node ? el('dd', {}, v) : el('dd', { text: v }));
    }
  }

  // ───────────────────────── Lower leagues ─────────────────────────
  const state = { season: null, caveats: false, showAll: false };
  let JL = [];

  function seasonOf(r) { return r.date ? r.date.slice(0, 4) : 'Unknown'; }

  function renderSeasonButtons() {
    const seasons = [...new Set(JL.map(seasonOf))].filter((x) => x !== 'Unknown').sort().reverse();
    if (!state.season) state.season = seasons[0] || 'all';
    const wrap = $('#ll-seasons');
    wrap.replaceChildren();
    for (const s of seasons.concat('all')) {
      const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(state.season === s), text: s === 'all' ? 'All time' : s });
      b.addEventListener('click', () => { state.season = s; state.showAll = false; renderSeasonButtons(); renderLower(); });
      wrap.append(b);
    }
  }

  function renderLower() {
    const inSeason = JL.filter((r) => state.season === 'all' || seasonOf(r) === state.season);
    const rows = inSeason.filter((r) => state.caveats || !r.caveat);
    const done = rows.filter((r) => r.lah === 3 || r.jigs === 3);
    const lw = done.filter((r) => r.lah === 3).length;
    const jw = done.length - lw;
    const lg = rows.reduce((a, r) => a + r.lah, 0);
    const jg = rows.reduce((a, r) => a + r.jigs, 0);
    const unfinished = rows.length - done.length;
    const label = state.season === 'all' ? 'all time' : `in ${state.season}`;

    const board = $('#ll-board');
    setSeg(board.querySelector('[data-ll="lah"]'), String(lw));
    setSeg(board.querySelector('[data-ll="jigs"]'), String(jw));
    setSeg($('#ll-games'), `${lg}-${jg}`);
    setSeg($('#ll-unfinished'), String(unfinished));
    board.setAttribute('aria-label', `Scoreboard ${label}: Lah ${lw} match wins, Jigs ${jw}. Games ${lg} to ${jg}. ${unfinished} unfinished.`);
    powerOn(board);

    const jp = pct(jw, done.length);
    $('#ll-deck').textContent = !done.length
      ? `No finished matches ${label} yet.`
      : jw > lw
        ? `Jigs leads ${jw}–${lw} ${label}. This is not a drill.`
        : `Lah leads ${lw}–${jw} ${label}. Jigs has won ${jp}% of finished matches, which the Jigs camp is calling momentum.`;

    // player cards
    const streaks = (who) => {
      let best = 0, cur = 0;
      for (const r of done) { if (r[who] === 3) { cur++; best = Math.max(best, cur); } else cur = 0; }
      return { best, cur };
    };
    const formGuide = (who) => {
      const g = el('span', { class: 'form-guide', 'aria-label': 'Last five finished matches, oldest first' });
      done.slice(-5).forEach((r) => {
        const w = r[who] === 3 ? 'W' : 'L';
        g.append(el('span', { class: w, title: `${fmtDate(r.date)}: ${r.lah}–${r.jigs}`, text: w }));
      });
      return g;
    };
    const card = (who, other, wins, games) => {
      const st = streaks(who);
      const whitewashes = done.filter((r) => r[who] === 3 && r[other] === 0).length;
      return [
        ['Match wins', `${wins} (${pct(wins, done.length)}%)`],
        ['Games won', String(games)],
        ['Longest winning run', plural(st.best, 'match', 'matches')],
        ['3–0 wins', String(whitewashes)],
        ['Last five', formGuide(who)],
      ];
    };
    fillFacts($('#ll-lah'), card('lah', 'jigs', lw, lg));
    fillFacts($('#ll-jigs'), card('jigs', 'lah', jw, jg));

    renderChart(done);
    renderOddities(rows, inSeason);
    renderPlaques(rows);
    renderDispatches(rows);
  }

  function renderOddities(rows, inSeason) {
    const wrap = $('#ll-oddities');
    const has = (re) => rows.filter((r) => re.test(r.notes)).length;
    const items = [
      [inSeason.filter((r) => r.caveat).length, 'matches played under an asterisk (counted only when the box above is ticked)', true],
      [rows.filter((r) => r.lah < 3 && r.jigs < 3).length, 'matches abandoned before anyone reached three games'],
      [has(/lights went out/i), 'matches stopped because the lights went out', true],
      [has(/\bstrokes?\b|\blet'?s?\b|controvers|contentious/i), 'notes mentioning a disputed call. Nobody has ever been wrong.'],
    ];
    wrap.replaceChildren(...items.map(([n, text, red]) =>
      el('div', { class: 'oddity' }, el('div', { class: 'n' + (red ? ' red' : ''), text: String(n) }), el('p', { text }))));
  }

  function renderPlaques(rows) {
    const wins = rows.filter((r) => r.jigs === 3);
    const ol = $('#ll-plaques');
    ol.replaceChildren();
    if (!wins.length) { ol.append(el('li', { class: 'empty', text: 'No Jigs wins in this period. The plaque engraver is on standby.' })); return; }
    wins.slice().reverse().forEach((r) => {
      ol.append(el('li', {},
        el('span', { class: 'p-date', text: fmtDate(r.date) || '' }),
        el('span', { class: 'p-score', text: `Jigs ${r.jigs}–${r.lah}` }),
        r.notes ? el('p', { class: 'p-note', text: r.notes }) : null));
    });
  }

  function renderDispatches(rows) {
    const withNotes = rows.filter((r) => r.notes).slice().reverse();
    const ol = $('#ll-dispatches');
    const shown = state.showAll ? withNotes : withNotes.slice(0, 8);
    ol.replaceChildren();
    if (!withNotes.length) ol.append(el('li', { class: 'empty', text: 'No notes filed for this period.' }));
    shown.forEach((r) => {
      const winner = r.lah === 3 ? 'lah' : r.jigs === 3 ? 'jigs' : null;
      const scoreText = winner === 'lah' ? `Lah won ${r.lah}–${r.jigs}` : winner === 'jigs' ? `Jigs won ${r.jigs}–${r.lah}` : `Unfinished at ${r.lah}–${r.jigs}`;
      const strong = el('strong', { class: winner ? `who-${winner}` : '', text: scoreText });
      const meta = el('div', { class: 'd-meta' }, strong, fmtDate(r.date) || '');
      if (r.caveat) meta.append(el('span', { class: 'star', title: 'Asterisk match', text: '*' }));
      ol.append(el('li', {}, meta, el('p', { class: 'd-text', text: r.notes })));
    });
    const more = $('#ll-more');
    more.hidden = state.showAll || withNotes.length <= 8;
    more.textContent = `Show all ${withNotes.length} dispatches`;
  }

  // ───────────────────────── Chart ─────────────────────────
  let lastDone = null, lastW = 0;
  window.addEventListener('resize', () => {
    const w = $('#ll-chart').clientWidth;
    if (lastDone && Math.abs(w - lastW) > 40) { lastW = w; renderChart(lastDone); }
  });
  function renderChart(done) {
    const host = $('#ll-chart');
    host.replaceChildren();
    if (!done.length) { host.append(el('p', { class: 'empty', text: 'No finished matches to plot.' })); return; }
    lastDone = done;
    const W = Math.max(300, Math.round(host.clientWidth || 860)), H = W < 560 ? 240 : 300, m = { t: 14, r: 64, b: 34, l: 36 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    let L = 0, J = 0;
    const pts = done.map((r, i) => { if (r.lah === 3) L++; else J++; return { i: i + 1, L, J, r }; });
    const maxY = Math.max(L, J, 1);
    const n = pts.length;
    const x = (i) => m.l + (n === 1 ? iw / 2 : ((i - 1) / (n - 1)) * iw);
    const y = (v) => m.t + ih - (v / maxY) * ih;
    const NS = 'http://www.w3.org/2000/svg';
    const s = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Running match wins: Lah ends on ${L}, Jigs on ${J}, over ${n} finished matches.` });
    const grid = s('g', { class: 'grid' }), axis = s('g', { class: 'axis' });
    const step = maxY <= 10 ? 2 : maxY <= 40 ? 10 : 20;
    for (let v = 0; v <= maxY; v += step) {
      grid.append(s('line', { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v) }));
      const t = s('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }); t.textContent = v; axis.append(t);
    }
    const xt = s('text', { x: m.l, y: H - 8 }); xt.textContent = 'First match'; axis.append(xt);
    const xt2 = s('text', { x: m.l + iw, y: H - 8, 'text-anchor': 'end' }); xt2.textContent = `Match ${n}`; axis.append(xt2);
    svg.append(grid, axis);

    const path = (key) => pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
    svg.append(s('path', { d: path('J'), fill: 'none', stroke: 'var(--jigs)', 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    svg.append(s('path', { d: path('L'), fill: 'none', stroke: 'var(--lah)', 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    // direct labels at the line ends (nudged apart if close)
    let yl = y(L), yj = y(J);
    if (Math.abs(yl - yj) < 16) { if (yl <= yj) yj = yl + 16; else yl = yj + 16; }
    const lab = (txt, yy) => { const t = s('text', { x: m.l + iw + 8, y: yy + 4, class: 'end-label' }); t.textContent = txt; svg.append(t); };
    lab(`Lah ${L}`, yl); lab(`Jigs ${J}`, yj);

    // hover layer
    const cross = s('line', { class: 'cross', y1: m.t, y2: m.t + ih, x1: 0, x2: 0, visibility: 'hidden' });
    const dotL = s('circle', { r: 5, fill: 'var(--lah)', stroke: 'var(--paper)', 'stroke-width': 2, visibility: 'hidden' });
    const dotJ = s('circle', { r: 5, fill: 'var(--jigs)', stroke: 'var(--paper)', 'stroke-width': 2, visibility: 'hidden' });
    const hit = s('rect', { class: 'hit', x: m.l - 6, y: m.t, width: iw + 12, height: ih });
    svg.append(cross, dotL, dotJ, hit);
    host.append(svg);
    const tip = el('div', { class: 'tooltip', hidden: '' });
    host.append(tip);

    const show = (clientX) => {
      const box = svg.getBoundingClientRect();
      const sx = ((clientX - box.left) / box.width) * W;
      const i = Math.min(n, Math.max(1, Math.round(n === 1 ? 1 : ((sx - m.l) / iw) * (n - 1) + 1)));
      const p = pts[i - 1];
      const px = x(p.i);
      for (const [node, v] of [[cross, null], [dotL, p.L], [dotJ, p.J]]) {
        node.setAttribute('visibility', 'visible');
        if (v === null) { node.setAttribute('x1', px); node.setAttribute('x2', px); }
        else { node.setAttribute('cx', px); node.setAttribute('cy', y(v)); }
      }
      const r = p.r;
      tip.hidden = false;
      tip.replaceChildren(
        el('b', { text: `Match ${p.i}: ${r.lah === 3 ? 'Lah' : 'Jigs'} won ${Math.max(r.lah, r.jigs)}–${Math.min(r.lah, r.jigs)}` }), el('br'),
        `${fmtDate(r.date) || ''}`, el('br'),
        `Running total: Lah ${p.L}, Jigs ${p.J}`);
      tip.style.left = `${(px / W) * box.width}px`;
      tip.style.top = `${(Math.min(y(p.L), y(p.J)) / H) * box.height}px`;
    };
    const hide = () => { tip.hidden = true; [cross, dotL, dotJ].forEach((nd) => nd.setAttribute('visibility', 'hidden')); };
    hit.addEventListener('pointermove', (e) => show(e.clientX));
    hit.addEventListener('pointerleave', hide);

    // table view for screen readers / the curious
    const det = el('details', { class: 'chart-table' }, el('summary', { text: 'See the numbers as a table' }));
    const tbl = el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Match' }), el('th', { text: 'Date' }), el('th', { text: 'Score (Lah–Jigs)' }), el('th', { text: 'Lah total' }), el('th', { text: 'Jigs total' }))));
    const tb = el('tbody');
    pts.forEach((p) => tb.append(el('tr', {}, el('td', { text: String(p.i) }), el('td', { text: fmtDate(p.r.date, { day: 'numeric', month: 'short', year: 'numeric' }) || '' }), el('td', { text: `${p.r.lah}–${p.r.jigs}` }), el('td', { text: String(p.L) }), el('td', { text: String(p.J) }))));
    tbl.append(tb);
    det.append(el('div', { class: 'scroll' }, tbl));
    host.append(det);
  }

  // ───────────────────────── Boot ─────────────────────────
  function wireForm() {
    const links = document.querySelectorAll('[data-form-link]');
    if (CFG.FORM_URL) links.forEach((a) => { a.href = CFG.FORM_URL; a.target = '_blank'; a.rel = 'noopener'; });
    else $('#rp-missing').hidden = false;
  }

  async function boot() {
    wireForm();
    $('#ll-asterisk').addEventListener('change', (e) => { state.caveats = e.target.checked; renderLower(); });
    $('#ll-more').addEventListener('click', () => { state.showAll = true; renderLower(); });

    const draw = ({ rows, status }) => {
      JL = rows.filter((r) => r.rivalry === 'jl');
      renderMainEvent(rows);
      renderSeasonButtons();
      renderLower();
      $('#data-status').textContent = status;
    };

    // Draw the offline copy instantly, then swap in live data when it arrives.
    if (CFG.SHEET_ID && window.SNAPSHOT) draw({ rows: window.SNAPSHOT, status: 'Checking the league records for new results…' });
    draw(await loadResults());
  }
  boot();
})();
