/* Tamnun Signs – core logic (no UI).
   Works in the app (browser) and in node tests. Dependencies are passed in:
   { pdfjs, PDFLib, ExcelJS, makeCanvas(w,h) }
   Rule of thumb: THE TABLE DECIDES. Files are only a source of artwork. */
(function (root) {
'use strict';

const CORE_VERSION = 1;

/* ---------------------------------------------------------------- text utils */
const BIDI = /[‎‏‪-‮⁦-⁩]/g;
const norm = s => String(s == null ? '' : s)
  .replace(BIDI, '')
  .replace(/[’`׳´‘]/g, "'")
  .replace(/₪|ש"ח|שח/g, ' ')
  .replace(/[*_\-–—/\\|,.:;!?()"”“#]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();
const clean = s => String(s == null ? '' : s).replace(BIDI, '').replace(/\s+/g, ' ').trim();
const numsOf = s => (norm(s).match(/\d+(?:\.\d+)?/g) || []).map(Number);
const STOP = new Set(['לבן', 'אדום', 'כחול', 'שחור', 'צבעוני', 'פס', 'collection', 'הזדמנות', 'אחרונה', 'by', 'tamnoon']);
const wordsOf = s => norm(s).split(' ').filter(w => w && !/^\d+(\.\d+)?$/.test(w));
const matchWords = s => wordsOf(s).filter(w => !STOP.has(w));

// table words that the artwork writes differently
const SYN = {
  'אקטיב': ['active'],
  "פיג'מות": ['pajamas', 'pajama'],
  'בייבי': ['baby', 'nb', 'years', 'tamnoon'],
  'ניו': ['new'], 'קולקשן': ['collection'],
  'סייל': ['sale'],
  'מכנס': ['מכנסי'],
};

function tokMatch(a, b) {
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  return (SYN[a] || []).includes(b) || (SYN[b] || []).includes(a);
}
// 0..1 – how well the row words match the page words
function textScore(rowText, pageText) {
  const r = matchWords(rowText), p = matchWords(pageText);
  if (!r.length) return null;            // row has no words (e.g. only a number)
  if (!p.length) return 0;
  // both sides must be covered: "חולצות" is not "חולצות מכופתרות"; "בייבי" covers "nb years"
  const rowCov = r.filter(w => p.some(x => tokMatch(w, x))).length / r.length;
  const pageCov = p.filter(x => r.some(w => tokMatch(w, x))).length / p.length;
  return Math.min(rowCov, pageCov);
}

/* ---------------------------------------------------------------- colors */
// table colour words -> class
function rowColor(c) {
  const s = norm(c);
  if (!s) return '';
  if (s.includes('אדום')) return 'red';
  if (s.includes('לבן')) return 'white';
  if (s.includes('כחול')) return 'blue';
  if (s.includes('שחור')) return 'white';
  return 'color';   // צבעוני, בייבי, anything else
}
const COLOR_HE = { red: 'אדום', white: 'לבן', blue: 'כחול', color: 'צבעוני', '': '' };

function colorScore(rc, pc) {
  if (!rc) return 0;
  if (rc === pc) return 2;
  if ((rc === 'white' || rc === 'red' || rc === 'blue') && (pc === 'white' || pc === 'red' || pc === 'blue')) return -4;
  return -1;
}

// classify an RGBA pixel buffer
function classifyPixels(data) {
  let n = 0, white = 0, red = 0, pink = 0, blue = 0, dark = 0, other = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 10) { white++; n++; continue; }
    n++;
    if (r > 222 && g > 222 && b > 222) white++;
    else if (r > 150 && g < 90 && b < 90) red++;
    else if (r > 180 && g < 140 && b > 90) pink++;
    else if (b > 120 && r < 90 && b > g) blue++;
    else if (r < 90 && g < 90 && b < 90) dark++;
    else other++;
  }
  const f = x => x / n;
  let cls;
  if (f(red) > 0.3) cls = 'red';
  else if (f(pink) > 0.3) cls = 'color';
  else if (f(blue) > 0.3) cls = 'blue';
  else if (f(white) > 0.45 && f(red) > 0.08) cls = 'red';      // white page with a red strip (SALE)
  else if (f(white) > 0.45 && f(blue) > 0.08) cls = 'blue';
  else if (f(white) > 0.55 || (f(white) + f(dark)) > 0.85) cls = 'white';  // incl. black strip NEW COLLECTION
  else cls = 'color';
  return { cls, white: f(white), red: f(red), pink: f(pink), blue: f(blue), dark: f(dark), other: f(other) };
}

/* ---------------------------------------------------------------- sizes */
const A = { A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148] };
// "21 רוחב על 19.8 גובה"
const SIZE_WORDS = /(\d+(?:\.\d+)?)\s*(?:ס"?מ\s*)?רוחב\s*(?:על|x|X|×)?\s*(\d+(?:\.\d+)?)\s*(?:ס"?מ\s*)?גובה/;
// find a size (in cm, sorted small->big) in a piece of text
function sizeFromText(s) {
  const t = clean(s).replace(BIDI, '');
  const w = t.match(SIZE_WORDS);
  if (w) return [+w[1], +w[2]].sort((a, b) => a - b);
  const m = t.match(/(\d+(?:\.\d+)?)\s*[xX×*\/]\s*(\d+(?:\.\d+)?)/);
  if (m) return [+m[1], +m[2]].sort((a, b) => a - b);
  const a = t.match(/\bA\s?([0-6])\b/i) || t.match(/איי\s*([0-6])/);
  if (a) return A['A' + a[1]].map(x => x / 10).sort((x, y) => x - y);
  return null;
}
const sameSize = (a, b, tol = 0.4) => a && b && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

/* ---------------------------------------------------------------- machine */
function machineOf(text) {
  const t = norm(text);
  if (/pvc|פי וי סי|דורסט|durst/.test(t)) return 'דורסט';
  if (/מתכתי|מגנט/.test(t)) return 'אפי מגנטי';
  return 'דיגיטל';
}
const MACHINES = ['דיגיטל', 'אפי מגנטי', 'דורסט'];

/* ================================================================ TABLE (xlsx) */
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if ('result' in v) return cellText(v.result);
    if (v.text) return String(v.text);
    if (v.error) return '';
    return '';
  }
  return String(v);
}
function cellNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'result' in v) return cellNum(v.result);
  if (typeof v === 'object') return null;
  const s = String(v).replace(BIDI, '').trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? +s : null;
}

async function readTableXlsx(buf, ExcelJS) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const tabs = [];
  wb.eachSheet(ws => {
    if (ws.state && ws.state !== 'visible') return;
    // grid of values
    const grid = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const arr = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => { arr[c - 1] = cell.value; });
      grid[r - 1] = arr;
    });
    // header row = first row with a "צבע" cell
    let h = grid.findIndex(r => r && r.some(v => /צבע/.test(cellText(v))));
    if (h < 0) return;
    const hdr = grid[h].map(v => clean(cellText(v)));
    const col = re => hdr.findIndex(x => re.test(x));
    const cFmt = col(/פורמט|גודל/), cColor = col(/צבע/), cText = col(/שילוט|תאור|תיאור/), cImg = col(/תמונה/);
    const after = Math.max(cImg, cText, cColor);
    // quantity columns: any titled column after the picture column that holds numbers
    const qtyCols = [];
    for (let c = after + 1; c < hdr.length; c++) {
      if (!hdr[c]) continue;
      if (/סה"?כ|סך הכל|total|sum/i.test(hdr[c])) continue;     // a total column must not be added again
      let nums = 0, texts = 0;
      for (let r = h + 1; r < grid.length; r++) {
        const v = grid[r] && grid[r][c];
        if (v == null || cellText(v) === '') continue;
        if (cellNum(v) != null) nums++; else texts++;
      }
      if (nums && nums >= texts) qtyCols.push({ c, name: hdr[c] });
    }
    // everything written on the sheet (for size / material hints)
    const allText = grid.flat().map(cellText).join(' ');
    // a sheet can hold several sets (e.g. "כובע A5" and then "A5"), each closed by a סה"כ row
    // or recognised by a different format/size → every set becomes its own type
    const blocks = [];
    let cur = null;
    const fmtKey = f => { const z = sizeFromText(f); return z ? z.join('x') : norm(f); };
    for (let r = h + 1; r < grid.length; r++) {
      const g = grid[r] || [];
      const fmt = clean(cellText(g[cFmt]));
      const line = g.map(cellText).join(' ');
      if (/סה"?כ/.test(line)) {
        const st = line.match(/סה"?כ\s*[-–]?\s*(\d+)/) || (() => { const n = g.map(cellNum).filter(x => x != null); return n.length ? [0, n[n.length - 1]] : null; })();
        if (cur) { if (st && cur.stated == null) cur.stated = +st[1]; cur.closed = true; }
        else if (blocks.length && st && blocks[blocks.length - 1].stated == null) blocks[blocks.length - 1].stated = +st[1];
        continue;
      }
      if (!fmt) continue;
      if (!cur || cur.closed || fmtKey(fmt) !== cur.key) { cur = { key: fmtKey(fmt), rows: [], stated: null }; blocks.push(cur); }
      const q = {}; let qty = 0;
      for (const qc of qtyCols) { const n = cellNum(g[qc.c]) || 0; q[qc.name] = n; qty += n; }
      const notes = g.map((v, c) => (c === cFmt || c === cColor || c === cText || c === cImg || qtyCols.some(x => x.c === c)) ? '' : clean(cellText(v))).filter(Boolean).join(' ');
      let colorText = clean(cellText(g[cColor])), text = cText >= 0 ? clean(cellText(g[cText])) : '';
      // "בייבי" written in the colour column (tabs without a text column)
      if (!text && colorText && !/לבן|אדום|כחול|שחור|צבעוני/.test(colorText)) { text = colorText; colorText = ''; }
      cur.rows.push({ no: cur.rows.length + 1, sheetRow: r + 1, format: fmt, colorText, color: rowColor(colorText) || (/בייבי/.test(text) ? 'color' : ''), text, notes, q, qty });
    }
    const real = blocks.filter(b => b.rows.length);
    real.forEach((b, bi) => {
      const rows = b.rows;
      const fmt0 = rows[0].format;
      const short = clean(fmt0.replace(SIZE_WORDS, '').replace(/ס"?מ/g, ''));
      // name: the sheet name, or – when a sheet has several sets – the set's own format if it says more
      let name = clean(ws.name);
      if (real.length > 1) {
        const extra = wordsOf(short).filter(w => !wordsOf(ws.name).includes(w));
        if (extra.length) name = short;
      }
      const blockText = rows.map(r => r.format + ' ' + r.notes).join(' ');
      const hints = ws.name + ' ' + blockText + (real.length === 1 ? ' ' + allText : '');
      const size = sizeFromText(fmt0) || sizeFromText(blockText) || (real.length === 1 ? (sizeFromText(ws.name) || sizeFromText(allText)) : sizeFromText(ws.name));
      tabs.push({
        name, sheet: clean(ws.name), format: fmt0, size,
        machine: machineOf(hints),
        // duplex: the row notes decide; only if there are no notes – the tab name
        duplex: (() => { const dup = x => /דו\s*צדדי|דו"צ|דוצ/.test(x); const nt = rows.map(r => r.notes).filter(Boolean); return nt.length ? nt.some(dup) : dup(ws.name); })(),
        qtyHeaders: qtyCols.map(x => x.name), stated: b.stated, rows,
      });
    });
  });
  return tabs;
}

/* ================================================================ PDF helpers */
async function pdfText(page, W, H) {
  const tc = await page.getTextContent();
  // keep only text that is really on the page (artboards leave stray text outside)
  return tc.items.filter(it => {
    if (!it.str || !it.str.trim()) return false;
    const x = it.transform[4], y = it.transform[5];
    return x > -5 && x < W + 5 && y > -5 && y < H + 5;
  }).map(it => it.str);
}

/* ================================================================ WORK ORDER (SO) */
async function readSO(buf, pdfjs) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  const lines = [];
  let soNumber = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.map(it => ({ x: it.transform[4], y: Math.round(it.transform[5]), s: it.str.replace(BIDI, '').trim() })).filter(i => i.s);
    const all = items.map(i => i.s).join(' ');
    const so = all.match(/SO\s*(\d{6,})/) || (() => { const i = items.findIndex(t => t.s === 'SO'); return i >= 0 && items[i + 1] && /^\d{6,}$/.test(items[i + 1].s) ? [0, items[i + 1].s] : null; })();
    if (so && !soNumber) soNumber = 'SO' + so[1];
    // column positions from the header row
    const hDesc = items.find(i => /^תיאור$/.test(i.s)), hQty = items.find(i => /^כמות$/.test(i.s)), hSku = items.find(i => /מק"ט/.test(i.s));
    if (!hDesc || !hQty) continue;
    const rows = new Map();
    for (const it of items) {
      if (it.y >= hDesc.y - 2) continue;
      const k = [...rows.keys()].find(y => Math.abs(y - it.y) <= 3);
      const key = k != null ? k : it.y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(it);
    }
    const descMin = hQty.x + 60, descMax = hSku ? hSku.x - 8 : hDesc.x + 120;
    for (const [, its] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      const qItem = its.filter(i => Math.abs(i.x - hQty.x) < 45 && /^\d[\d,]*$/.test(i.s))[0];
      if (!qItem) continue;
      const desc = its.filter(i => i.x > descMin && i.x < descMax).sort((a, b) => b.x - a.x).map(i => i.s).join(' ');
      if (!desc) continue;
      const d2 = desc.replace(/איי\s*(\d)/, 'A$1');
      lines.push({ desc: clean(desc), qty: +qItem.s.replace(/,/g, ''), size: sizeFromText(d2), machine: machineOf(desc) });
    }
  }
  await doc.destroy();
  return { soNumber, lines };
}

/* ================================================================ ARTWORK */
async function analyzeArtwork(buf, fileName, deps, opts = {}) {
  const { pdfjs, makeCanvas } = deps;
  const data = new Uint8Array(buf);
  const doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false }).promise;
  let title = '';
  try { const md = await doc.getMetadata(); title = clean((md.info && md.info.Title) || ''); } catch (e) {}
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp1 = page.getViewport({ scale: 1 });
    const W = vp1.width, H = vp1.height;
    const strs = await pdfText(page, W, H);
    // small render for colour (and thumbnail)
    const scale = Math.min(1, (opts.thumb || 90) / Math.max(W, H));
    const vp = page.getViewport({ scale });
    const cv = makeCanvas(Math.max(1, Math.round(vp.width)), Math.max(1, Math.round(vp.height)));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const col = classifyPixels(px);
    const text = clean(strs.join(' '));
    pages.push({
      index: p - 1, w: W / 72 * 2.54, h: H / 72 * 2.54,
      size: [W / 72 * 2.54, H / 72 * 2.54].sort((a, b) => a - b),
      text, nums: numsOf(text), color: col.cls, colorStats: col,
      thumb: opts.keepThumb ? (cv.toDataURL ? cv.toDataURL('image/png') : null) : null,
    });
    page.cleanup();
  }
  await doc.destroy();
  const size = pages.length ? pages[0].size : null;
  return { name: fileName, title, hasText: pages.some(p => p.text), bytes: data, pages, size };
}

/* ================================================================ MATCHING */
function pairScore(row, page, ri, pi) {
  let s = 0;
  const ts = textScore(row.text, page.text);
  const rn = numsOf(row.text), pn = page.nums;
  if (ts != null) s += ts * 6;
  if (rn.length) {
    const eq = rn.length === pn.length && rn.every(n => pn.includes(n));
    if (eq) s += 5; else if (pn.length) s -= 6; else s -= 3;
  } else if (pn.length && ts != null) {
    // page has a price, row has none
    s -= 1;
  }
  const cs = colorScore(row.color, page.color);
  s += cs;
  if (ri === pi) s += 0.6;     // same position in table and file
  return { s, ts, cs, numsOk: rn.length ? (rn.length === pn.length && rn.every(n => pn.includes(n))) : null };
}

// one tab ↔ one artwork file
function matchTab(tab, art, mo = {}) {
  const rows = tab.rows, pages = art ? art.pages : [];
  const res = rows.map(() => null);
  const pageUse = pages.map(() => null);
  const pairs = [];
  rows.forEach((r, ri) => pages.forEach((p, pi) => pairs.push({ ri, pi, ...pairScore(r, p, ri, pi) })));
  const okText = x => {
    const r = rows[x.ri];
    const hasWords = matchWords(r.text).length > 0, hasNums = numsOf(r.text).length > 0;
    if (!hasWords && !hasNums) return true;                // colour-only rows (21X…)
    if (hasNums && !x.numsOk) return false;
    if (hasWords && (x.ts || 0) <= 0.5) return false;
    return true;
  };
  // pass 1 – text and colour agree
  pairs.filter(x => okText(x) && x.cs > -2).sort((a, b) => b.s - a.s).forEach(x => {
    if (res[x.ri] || pageUse[x.pi] != null) return;
    if (!matchWords(rows[x.ri].text).length && !numsOf(rows[x.ri].text).length && x.cs < 0) return;
    res[x.ri] = { kind: 'ok', page: x.pi }; pageUse[x.pi] = x.ri;
  });
  // pass 1b – artwork written as outlines (no readable text): same position, colour fits
  if (!mo.noGuess) rows.forEach((r, ri) => {
    if (res[ri] || ri >= pages.length || pageUse[ri] != null) return;
    const p = pages[ri];
    if (matchWords(p.text).length || p.nums.length) return;
    if (colorScore(r.color, p.color) < -1) return;
    res[ri] = { kind: 'ok', page: ri, byPosition: true }; pageUse[ri] = ri;
  });
  // pass 1c – what is left: rows with words ↔ pages without readable text (outlines), in order.
  // A guess – shown in yellow for checking.
  if (!mo.noGuess) {
    const rLeft = rows.map((r, ri) => ri).filter(ri => !res[ri] && rows[ri].qty && matchWords(rows[ri].text).length && !numsOf(rows[ri].text).length);
    const pLeft = pages.map((p, pi) => pi).filter(pi => pageUse[pi] == null && !matchWords(pages[pi].text).length && !pages[pi].nums.length);
    rLeft.forEach(ri => {
      const k = pLeft.findIndex(pi => colorScore(rows[ri].color, pages[pi].color) > -2);
      if (k < 0) return;
      const pi = pLeft.splice(k, 1)[0];
      res[ri] = { kind: 'ok', page: pi, guess: true }; pageUse[pi] = ri;
    });
  }
  // pass 2 – right text, wrong colour → recolour a copy (the table decides)
  rows.forEach((r, ri) => {
    if (res[ri]) return;
    const cand = pairs.filter(x => x.ri === ri && okText(x) && x.cs <= -2 && (matchWords(r.text).length || numsOf(r.text).length))
      .sort((a, b) => b.s - a.s)[0];
    if (cand && canSwap(r.color, pages[cand.pi].color)) {
      res[ri] = { kind: 'swap', page: cand.pi, from: pages[cand.pi].color, to: r.color };
      if (pageUse[cand.pi] == null) pageUse[cand.pi] = 'src';
    }
  });
  // pass 3 – a price that is missing: take another price page in the same colour (or the other one) and change the number
  rows.forEach((r, ri) => {
    if (res[ri]) return;
    const rn = numsOf(r.text);
    if (rn.length !== 1 || matchWords(r.text).length) return;
    const isPrice = p => p.nums.length === 1 && !matchWords(p.text).length;
    let src = pages.findIndex(p => isPrice(p) && p.color === r.color);
    let swap = false;
    if (src < 0) { src = pages.findIndex(p => isPrice(p) && canSwap(r.color, p.color)); swap = src >= 0; }
    if (src >= 0) {
      res[ri] = { kind: 'number', page: src, fromNum: pages[src].nums[0], toNum: rn[0], from: pages[src].color, to: swap ? r.color : null };
      if (pageUse[src] == null) pageUse[src] = 'src';
    }
  });
  // extra pages
  const extras = [];
  pages.forEach((p, pi) => {
    if (pageUse[pi] != null) return;
    // a near copy of a used page?
    const twin = pages.findIndex((q, qi) => qi !== pi && pageUse[qi] != null && norm(q.text) === norm(p.text) && q.color === p.color);
    extras.push({ page: pi, text: p.text, color: p.color, twin: twin >= 0 ? twin : null });
  });
  return { res, extras };
}
const SWAP = ['white', 'red', 'blue'];
const canSwap = (to, from) => SWAP.includes(to) && SWAP.includes(from) && to !== from;

/* ================================================================ PLAN */
function fileSafe(s) { return clean(s).replace(/[\\/:*?"<>|]/g, m => (m === '*' ? 'x' : m === '"' ? "''" : '-')).replace(/\s+/g, ' ').trim(); }

// format for the file name: Hebrew first ("A3 מתכתי" → "מתכתי A3"), ס"מ dropped, * → x
/* ---------------------------------------------------------------- English file names */
// whole phrases first, then single words. The user can add/override in the app (saved in settings).
const EN_PHRASES = {
  "חולצות טי שרוול קצר": 't-shirts short sleeve', 'חולצות שרוול ארוך': 'shirts long sleeve', 'חולצות מכופתרות': 'button shirts',
  'מכנס פוטר': 'sweatpants', 'מכנסי פוטר': 'sweatpants', 'טופ פוטר': 'sweat top', 'בגד ים שלם': 'swimsuit one-piece',
  'טופ תחתון ביקיני': 'bikini top-bottom', "פיג'מות ילדים": 'pajamas kids', "פיג'מות מבוגרים": 'pajamas adults',
  'סוף עונה על אמת': 'end of season', 'פס מתכתי': 'magneti strip', 'דו צדדי': '2-sided', 'מבצע כמותי': 'deal',
  'הזדמנות אחרונה': 'last chance',
};
const EN_WORDS = {
  'לבן': 'white', 'אדום': 'red', 'כחול': 'blue', 'שחור': 'black', 'צבעוני': '', 'מתכתי': 'magneti', 'פס': 'strip',
  "ג'ינסים": 'jeans', 'חולצות': 'shirts', 'סריגים': 'knitwear', 'מכנסיים': 'pants', 'גופיות': 'tank tops', 'שמלות': 'dresses',
  "פיג'מות": 'pajamas', "ג'קטים": 'jackets', 'מעילים': 'coats', 'נעליים': 'shoes', 'אקטיב': 'active', 'בייבי': 'baby',
  'פריטים': 'items', 'כובע': 'cap', 'כובעים': 'caps', 'קולקציית': 'collection', 'קולציית': 'collection', 'קיץ': 'summer', 'חורף': 'winter', 'כל': 'all', 'עד': 'up to', 'הקולציית': 'collection', 'הקולקציה': 'collection', 'ב': 'for', 'ילדים': 'kids', 'מבוגרים': 'adults', 'נייר': 'paper', 'כרום': 'chrome', 'גרם': 'g',
};
const HEB = /[֐-׿]/;
// returns { text, missing:[hebrew words without a translation] }
function toEnglish(str, user) {
  user = user || {};
  let t = norm(str);                                          // no ₪, no punctuation, lower case
  t = t.replace(/(\d)\s*ב\s*(\d)/g, '$1 for $2').replace(/\bב(\d)/g, 'for $1');   // "2 ב-100" → "2 for 100"
  const dict = { ...EN_PHRASES, ...EN_WORDS, ...user };
  // longest phrases first
  const keys = Object.keys(dict).map(k => norm(k)).filter(Boolean).sort((a, b) => b.length - a.length);
  const nd = {}; for (const k of Object.keys(dict)) nd[norm(k)] = dict[k];
  for (const k of keys) {
    if (!HEB.test(k)) continue;
    const re = new RegExp('(^|\\s)' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'g');
    t = t.replace(re, (all, pre) => pre + nd[k]);
  }
  const missing = (t.match(/[֐-׿'"]+/g) || []).filter(w => HEB.test(w));
  return { text: t.replace(/\s+/g, ' ').trim(), missing };
}

// format for the file name ("A3 מתכתי" → "A3 metal"), ס"מ dropped, * → x
function formatLabel(f, user) {
  let t = clean(f).replace(SIZE_WORDS, '').replace(/ס"?מ/g, '').replace(/[*×]/g, 'x').replace(/[’`׳´‘]/g, "'");
  const dict = { ...EN_PHRASES, ...EN_WORDS, ...(user || {}) };
  for (const k of Object.keys(dict).sort((a, b) => b.length - a.length)) if (HEB.test(k) && t.includes(k)) t = t.split(k).join(dict[k]);
  return fileSafe(t.replace(/\s+/g, ' ').trim());
}
function rowLabel(tab, row, page) {
  let t = row.text;
  if (!t && page) t = page.text;                         // 21X tabs have no text column
  return clean(t);
}
// <no> - [!!!!!!!!!! ]<format> - <colour> <text>[ - 2-sided] x<qty>.pdf  – all English
function makeName(tab, row, page, gen, user) {
  const miss = [];
  const tr = s => { const r = toEnglish(s, user); miss.push(...r.missing); return r.text; };
  const fmt = formatLabel(row.format || tab.format, user);
  miss.push(...toEnglish(clean(row.format || tab.format).replace(SIZE_WORDS, '').replace(/ס"?מ/g, ''), user).missing);
  let label = tr(rowLabel(tab, row, page));

  const color = row.colorText && !/צבעוני/.test(row.colorText) ? tr(row.colorText) : '';
  if (color) label = label.split(' ').filter(w => w !== color).join(' ');
  let name = `${fmt} - ${[color, label].filter(Boolean).join(' ')}${tab.duplex ? ' - 2-sided' : ''} x${row.qty}`;
  name = `${row.no} - ${gen ? '!!!!!!!!!! ' : ''}${fileSafe(name)}`.toLowerCase();   // file names: small letters only
  return { name: name + '.pdf', missing: [...new Set(miss)] };
}

function buildPlan(tabs, arts, so, opts = {}) {
  // which artwork belongs to which type: page size (exact, or close – magnets come a bit smaller),
  // the file's name/title (כובע, פס, A3…) and how many pages it has
  const used = new Set();
  const KEYS = ['כובע', 'כובעים', 'פס', 'פסים', 'מתכתי', 'pvc'];
  const keyOf = t => { const n = norm(t).replace(/כובעים/g, 'כובע').replace(/פסים/g, 'פס'); return KEYS.filter(k => n.split(' ').includes(k)); };
  const aOf = t => (String(t).match(/\bA\s?([0-6])\b/i) || [])[1] || null;
  const pairs = [];
  tabs.forEach((tab, ti) => arts.forEach((a, ai) => {
    if (!tab.size || !a.size) return;
    const d = Math.max(Math.abs(tab.size[0] - a.size[0]), Math.abs(tab.size[1] - a.size[1]));
    let sc = d <= 0.4 ? 10 : d <= 1.5 ? 6 : -99;
    const tName = tab.name + ' ' + tab.format + ' ' + (tab.sheet || ''), aName = a.name + ' ' + (a.title || '');
    const tk = keyOf(tName), ak = keyOf(aName);
    for (const k of ['כובע', 'פס']) { if (tk.includes(k) && ak.includes(k)) sc += 4; else if (tk.includes(k) !== ak.includes(k)) sc -= 4; }
    const ta = aOf(tab.format) || aOf(tab.name), aa = aOf(aName);
    if (ta && aa) sc += ta === aa ? 2 : -2;
    if (!a.hasText) sc -= 3;                                        // a scan / picture with no text at all
    sc -= Math.min(3, Math.abs(a.pages.length - tab.rows.length) / 4);
    pairs.push({ ti, ai, sc });
  }));
  const tabArt = tabs.map(() => -1);
  pairs.filter(p => p.sc >= 3).sort((x, y) => y.sc - x.sc).forEach(p => {
    if (tabArt[p.ti] >= 0 || used.has(p.ai)) return;
    tabArt[p.ti] = p.ai; used.add(p.ai);
  });
  const unusedArts = arts.map((a, i) => i).filter(i => !used.has(i));

  const items = [], missing = [], fixed = [], extras = [], zero = [], checks = [];
  tabs.forEach((tab, ti) => {
    const ai = tabArt[ti], art = ai >= 0 ? arts[ai] : null;
    const { res, extras: ex } = matchTab(tab, art);
    // still missing → the graphics bank (pages approved in earlier orders, same size)
    // order of trust: client page as is > bank page as is > made from a client page > made from a bank page
    (opts.bankArts || []).forEach((ba, bi) => {
      const left = tab.rows.map((r, ri) => ri).filter(ri => tab.rows[ri].qty && (!res[ri] || res[ri].kind !== 'ok' || res[ri].guess || res[ri].bank));
      if (!left.length || !sameSize(tab.size, ba.size, 1.5)) return;
      const r2 = matchTab({ rows: left.map(ri => tab.rows[ri]) }, ba, { noGuess: true }).res;
      r2.forEach((m, k) => {
        if (!m) return;
        const cur = res[left[k]];
        if (!cur || (m.kind === 'ok' && !(cur.bank && cur.kind === 'ok'))) res[left[k]] = { ...m, bank: true, artIdx: arts.length + bi };
      });
    });
    tab.rows.forEach((row, ri) => {
      const m = res[ri];
      if (!row.qty) { zero.push({ tab: tab.name, row, match: m }); return; }
      if (!m) { missing.push({ tab: tab.name, ti, row, reason: art ? 'אין עמוד מתאים בקובץ' : 'אין קובץ בגודל ' + (tab.size ? tab.size.join('×') : '?') }); return; }
      const artI = m.artIdx != null ? m.artIdx : ai;
      const srcArt = artI < arts.length ? arts[artI] : opts.bankArts[artI - arts.length];
      const page = srcArt.pages[m.page];
      const gen = m.kind !== 'ok' || !!m.bank;
      const nm = makeName(tab, row, page, gen, opts.en);
      const it = { ti, tab: tab.name, machine: tab.machine, row, art: artI, page: m.page, kind: m.bank && m.kind === 'ok' ? 'bank' : m.kind, m, name: nm.name, noEn: nm.missing, qty: row.qty };
      // a bank page from another order may be a little bigger/smaller – fit it to this order's size
      if (m.bank && art && art.pages[0]) it.target = [art.pages[0].w / 2.54 * 72, art.pages[0].h / 2.54 * 72];
      items.push(it);
      if (gen || m.guess) fixed.push(it);
    });
    if (art) ex.forEach(e => extras.push({ tab: tab.name, file: art.name, ...e }));
    // totals
    const sum = tab.rows.reduce((a, r) => a + r.qty, 0);
    const soLine = so && so.lines.find(l => sameSize(l.size, tab.size) && (l.machine === tab.machine || !l.machine));
    checks.push({ tab: tab.name, sum, stated: tab.stated, so: soLine ? soLine.qty : null, soDesc: soLine ? soLine.desc : null, file: art ? art.name : null, pages: art ? art.pages.length : 0, rows: tab.rows.length });
  });
  // same file name twice → (2)
  const seen = {};
  items.forEach(it => { const k = it.machine + '/' + it.name; if (seen[k]) { seen[k]++; it.name = it.name.replace(/\.pdf$/, ` (${seen[k]}).pdf`); } else seen[k] = 1; });
  return { items, missing, fixed, extras, zero, checks, tabArt, unusedArts };
}

/* ================================================================ PDF OUTPUT */
// decode/encode page content with pdf-lib
function getContent(PDFLib, doc, page) {
  const { PDFArray, PDFRawStream, decodePDFRawStream, PDFRef } = PDFLib;
  let c = page.node.Contents();
  const parts = [];
  const one = obj => {
    if (obj instanceof PDFRef) obj = doc.context.lookup(obj);
    if (obj instanceof PDFRawStream) parts.push(decodePDFRawStream(obj).decode());
    else if (obj && obj.getContents) parts.push(obj.getContents());
  };
  if (c instanceof PDFArray) { for (let i = 0; i < c.size(); i++) one(c.get(i)); } else one(c);
  let s = '';
  for (const u8 of parts) { for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); s += '\n'; }
  return s;
}
function setContent(PDFLib, doc, page, str) {
  const u8 = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) u8[i] = str.charCodeAt(i) & 255;
  const stream = doc.context.flateStream(u8);
  const ref = doc.context.register(stream);
  page.node.set(PDFLib.PDFName.of('Contents'), ref);
}

const CMYK_RE = /(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(k|K)\b/g;
const cmykClass = (c, m, y, k) => {
  if (c < 0.05 && m < 0.05 && y < 0.05 && k < 0.05) return 'white';
  if (m > 0.8 && y > 0.7 && c < 0.25 && k < 0.25) return 'red';
  if (c > 0.55 && m < 0.5 && y < 0.25 && k < 0.25) return 'blue';
  if (k > 0.6 || (c > 0.5 && m > 0.5 && y > 0.5)) return 'black';
  return 'other';
};
// learn the client's red and black from the file itself
function learnColors(PDFLib, doc) {
  let red = null, black = null, blue = null;
  for (const pg of doc.getPages()) {
    const s = getContent(PDFLib, doc, pg);
    let m; CMYK_RE.lastIndex = 0;
    while ((m = CMYK_RE.exec(s))) {
      const v = [+m[1], +m[2], +m[3], +m[4]], cl = cmykClass(...v);
      if (cl === 'red' && !red) red = m.slice(1, 5).join(' ');
      if (cl === 'black' && !black) black = m.slice(1, 5).join(' ');
      if (cl === 'blue' && !blue) blue = m.slice(1, 5).join(' ');
    }
    if (red && black && blue) break;
  }
  return { red: red || '0.072 0.996 0.93 0.008', black: black || '0.719 0.668 0.586 0.789', blue: blue || '0.763 0.235 0.04 0' };
}

// how the client lays out a price: distance ₪→number and the centre of the group,
// learned per background colour / font size / "starts with 1" (the 1 is narrow, so ₪ sits closer)
const TM_RE = /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm/g;
function priceParts(s, W) {
  // number: (digits)Tj after a Tm ; shekel: <0154>Tj (or any hex glyph run) after a Tm
  const toks = [];
  const re = /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm\s*(\((\d+)\)\s*Tj|<[0-9A-Fa-f]+>\s*Tj)/g;
  let m;
  while ((m = re.exec(s))) {
    const e = +m[5], a = +m[1];
    if (e < -5 || e > W + 5) continue;           // stray text outside the artboard
    toks.push({ idx: m.index, len: m[0].length, a, e, f: +m[6], num: m[8] || null, hex: !m[8] });
  }
  const num = toks.filter(t => t.num);
  const sh = toks.filter(t => t.hex);
  if (num.length !== 1 || sh.length !== 1) return null;
  return { num: num[0], sh: sh[0] };
}
function learnPriceLayout(PDFLib, doc, pal) {
  const L = {};
  for (const pg of doc.getPages()) {
    const W = pg.getSize().width;
    const s = getContent(PDFLib, doc, pg);
    const pp = priceParts(s, W); if (!pp) continue;
    const bg = /re\s*\n?\s*f/.test(s.slice(0, 200)) && s.slice(0, 60).includes(pal.red.split(' ')[1]) ? 'red' : 'white';
    const adv = 502 / 1000 * pp.num.a;   // refined below if widths known
    const cls = pp.num.num[0] === '1' ? '1' : 'n';
    const key = `${bg}|${Math.round(pp.num.a)}|${cls}`;
    const off = pp.num.e - pp.sh.e;
    const end = pp.num.e + pp.num.num.length * adv;
    (L[key] = L[key] || []).push({ off, centre: (pp.sh.e + end) / 2 });
  }
  const out = {};
  for (const [k, v] of Object.entries(L)) out[k] = { off: v.reduce((a, x) => a + x.off, 0) / v.length, centre: v.reduce((a, x) => a + x.centre, 0) / v.length };
  return out;
}

// recolour a simple sign (background + text). Returns false if the page is not simple enough.
function swapColors(PDFLib, doc, page, from, to, pal) {
  let s = getContent(PDFLib, doc, page);
  if (/\bDo\b|\bsh\b|\bscn?\b|\brg\b|\bRG\b/.test(s)) return false;     // images / shadings / rgb – too risky
  const classes = new Set();
  s.replace(CMYK_RE, (all, c, m, y, k) => { classes.add(cmykClass(+c, +m, +y, +k)); return all; });
  // other colours (logos, stray text outside the page) stay as they are – the file is marked for checking anyway
  const { width, height } = page.getSize();
  const mb = page.getMediaBox();
  if ((from === 'red' || from === 'blue') && to === 'white') {
    s = s.replace(CMYK_RE, (all, c, m, y, k, op) => {
      const cl = cmykClass(+c, +m, +y, +k);
      if (cl === from) return `0 0 0 0 ${op}`;
      if (cl === 'white') return `${pal.black} ${op}`;
      return all;
    });
  } else if ((from === 'red' || from === 'blue') && (to === 'red' || to === 'blue')) {
    s = s.replace(CMYK_RE, (all, c, m, y, k, op) => cmykClass(+c, +m, +y, +k) === from ? `${pal[to]} ${op}` : all);
  } else if (from === 'white' && (to === 'red' || to === 'blue')) {
    if (classes.has('red') || classes.has('blue')) return false;
    // white background (painted or just paper) → colour, black text → white
    s = s.replace(CMYK_RE, (all, c, m, y, k, op) => { const cl = cmykClass(+c, +m, +y, +k); return cl === 'black' ? `0 0 0 0 ${op}` : cl === 'white' ? `${pal[to]} ${op}` : all; });
    s = `q ${pal[to]} k ${mb.x} ${mb.y} ${width} ${height} re f Q\n` + s;
  } else return false;
  setContent(PDFLib, doc, page, s);
  return true;
}

// change a price number written as one literal string, e.g. (30)Tj → (25)Tj.
// The ₪ and the number are placed like the client's own signs with the same colour and size.
function changeNumber(PDFLib, doc, page, fromNum, toNum, lay, bg) {
  let s = getContent(PDFLib, doc, page);
  const from = String(fromNum), to = String(toNum);
  const W = page.getSize().width;
  const pp = priceParts(s, W);
  if (!pp || pp.num.num !== from) return false;
  // digits must exist in the font
  const before = s.slice(0, pp.num.idx);
  const tf = [...before.matchAll(/\/(\S+)\s+([\d.]+)\s+Tf/g)].pop();
  if (!tf) return false;
  const fontDict = page.node.Resources().lookup(PDFLib.PDFName.of('Font')).lookup(PDFLib.PDFName.of(tf[1]));
  const widths = fontDict && fontDict.lookup(PDFLib.PDFName.of('Widths'));
  const first = fontDict && fontDict.lookup(PDFLib.PDFName.of('FirstChar'));
  if (!widths || !first) return false;
  const fc = first.asNumber();
  const w = ch => { const i = ch.charCodeAt(0) - fc; return i >= 0 && i < widths.size() ? widths.lookup(i).asNumber() : 0; };
  for (const ch of to) if (!w(ch)) return false;
  const fs = pp.num.a;
  const wid = str => [...str].reduce((a, ch) => a + w(ch), 0) / 1000 * fs;
  // where to put things
  const key = c => `${bg}|${Math.round(fs)}|${c}`;
  const cls = to[0] === '1' ? '1' : 'n';
  const L = lay && (lay[key(cls)] || lay[`${bg === 'red' ? 'white' : 'red'}|${Math.round(fs)}|${cls}`]);
  let numX, shX;
  if (L) {
    const groupW = L.off + wid(to);
    shX = L.centre - groupW / 2;
    numX = shX + L.off;
  } else {
    // no example of this kind: keep the old centre and the old ₪ distance
    const oldEnd = pp.num.e + wid(from), centre = (pp.sh.e + oldEnd) / 2, off = pp.num.e - pp.sh.e;
    shX = centre - (off + wid(to)) / 2; numX = shX + off;
  }
  const dNum = numX - pp.num.e, dSh = shX - pp.sh.e;
  const setE = (str, d) => str.replace(/^([-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+)([-\d.]+)/, (all, head, e) => head + (+e + d).toFixed(4));
  // rewrite from the end so indexes stay valid
  const edits = [{ t: pp.num, d: dNum, rep: x => setE(x, dNum).replace(`(${from})`, `(${to})`) }, { t: pp.sh, d: dSh, rep: x => setE(x, dSh) }]
    .sort((a, b) => b.t.idx - a.t.idx);
  for (const ed of edits) {
    const seg = s.slice(ed.t.idx, ed.t.idx + ed.t.len);
    s = s.slice(0, ed.t.idx) + ed.rep(seg) + s.slice(ed.t.idx + ed.t.len);
  }
  // other Tm in the number's text block (e.g. the space after it) move with the number
  const btStart = s.lastIndexOf('BT', pp.num.idx), etEnd = s.indexOf('ET', pp.num.idx);
  if (btStart >= 0 && etEnd > 0) {
    let block = s.slice(btStart, etEnd), seen = 0;
    block = block.replace(/([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm(\s*\(\s\)\s*Tj)/g, (all, a, b, c, d, e, f, rest) => `${a} ${b} ${c} ${d} ${(+e + dNum).toFixed(4)} ${f} Tm${rest}`);
    s = s.slice(0, btStart) + block + s.slice(etEnd);
  }
  setContent(PDFLib, doc, page, s);
  return true;
}

// one output PDF for an item
async function buildItemPdf(item, arts, PDFLib, cache) {
  const art = arts[item.art];
  const key = item.art;
  if (!cache[key]) cache[key] = { src: await PDFLib.PDFDocument.load(art.bytes, { updateMetadata: false }) };
  const src = cache[key].src;
  if (!cache[key].pal) cache[key].pal = learnColors(PDFLib, src);
  if (!cache[key].lay) cache[key].lay = learnPriceLayout(PDFLib, src, cache[key].pal);
  const out = await PDFLib.PDFDocument.create({ updateMetadata: false });
  const [pg] = await out.copyPages(src, [item.page]);
  out.addPage(pg);
  const m = item.m;
  let ok = true;
  if (m.kind === 'swap') ok = swapColors(PDFLib, out, pg, m.from, m.to, cache[key].pal);
  if (m.kind === 'number') {
    ok = changeNumber(PDFLib, out, pg, m.fromNum, m.toNum, cache[key].lay, m.to || m.from);
    if (ok && m.to) ok = swapColors(PDFLib, out, pg, m.from, m.to, cache[key].pal);
  }
  if (!ok) return null;
  // Illustrator shares one big resource list between all artboards – keep only what this page uses
  try {
    const content = getContent(PDFLib, out, pg);
    // Illustrator private data (the whole .ai file!) – not needed for printing
    for (const k of ['PieceInfo', 'LastModified', 'Metadata']) pg.node.delete(PDFLib.PDFName.of(k));
    const res = pg.node.Resources();
    if (res) for (const cat of ['Font', 'XObject', 'ExtGState', 'ColorSpace', 'Pattern', 'Shading', 'Properties']) {
      const d = res.lookup(PDFLib.PDFName.of(cat));
      if (!d || !d.keys) continue;
      for (const k of d.keys()) {
        const nm = k.asString().slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp('/' + nm + '(?![A-Za-z0-9_.+-])').test(content)) d.delete(k);
      }
    }
    const lean = await PDFLib.PDFDocument.create({ updateMetadata: false });
    const [p2] = await lean.copyPages(out, [0]);
    lean.addPage(p2);
    const leanBytes = await lean.save({ useObjectStreams: false });
    const t = item.target, cur = p2.getSize();
    if (t && (Math.abs(t[0] - cur.width) > 2 || Math.abs(t[1] - cur.height) > 2)) {
      // fill the target page (background reaches the edges), centred; at most a few mm are cut
      const fit = await PDFLib.PDFDocument.create({ updateMetadata: false });
      const [ep] = await fit.embedPdf(leanBytes, [0]);
      const sc = Math.max(t[0] / cur.width, t[1] / cur.height);
      const w = cur.width * sc, h = cur.height * sc;
      const np = fit.addPage([t[0], t[1]]);
      np.drawPage(ep, { x: (t[0] - w) / 2, y: (t[1] - h) / 2, width: w, height: h });
      return fit.save({ useObjectStreams: false });
    }
    return leanBytes;
  } catch (e) {
    return out.save({ useObjectStreams: false });
  }
}

/* ================================================================ REPORT (xlsx) */
async function buildReport(plan, tabs, so, ExcelJS) {
  const wb = new ExcelJS.Workbook();
  const rtl = { views: [{ rightToLeft: true }] };
  const head = ws => { ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' } }; };

  const s1 = wb.addWorksheet('קבצים', rtl);
  s1.columns = [{ header: 'מכונה', width: 12 }, { header: 'סוג', width: 22 }, { header: 'שם קובץ', width: 55 }, { header: 'כמות', width: 8 }, { header: 'הערה', width: 30 }];
  MACHINES.forEach(mc => plan.items.filter(i => i.machine === mc).forEach(i => s1.addRow([mc, i.tab, i.name, i.qty, i.kind === 'ok' ? '' : (i.kind === 'swap' ? 'צבע הוחלף – לבדוק' : 'מספר שונה – לבדוק')])));
  head(s1);

  const s2 = wb.addWorksheet('חוסרים', rtl);
  s2.columns = [{ header: 'סוג', width: 22 }, { header: 'שורה', width: 6 }, { header: 'צבע', width: 10 }, { header: 'שילוט', width: 28 }, { header: 'כמות', width: 8 }, { header: 'בעיה', width: 40 }];
  plan.missing.forEach(m => s2.addRow([m.tab, m.row.no, m.row.colorText, m.row.text, m.row.qty, m.reason]));
  plan.extras.forEach(e => s2.addRow([e.tab, e.label || '', COLOR_HE[e.color], e.text, '', `עמוד ${e.page + 1} בקובץ – לא בהזמנה${e.twinRow ? ` (כפול של שורה ${e.twinRow})` : e.twin != null ? ' (כפול)' : ''}`]));
  (plan.removed || []).forEach(r => s2.addRow([r.tab, r.row.no, r.row.colorText, r.row.text, r.row.qty, 'בוטל ידנית – לא יצא קובץ']));
  plan.checks.forEach(c => { if (c.so != null && c.so !== c.sum) s2.addRow([c.tab, '', '', '', c.sum, `סה"כ בטבלה ${c.sum} – בהזמנה ${c.so}`]); });
  head(s2);

  // per branch – for sorting & packing
  const s3 = wb.addWorksheet('לפי סניף', rtl);
  const branches = [...new Set(tabs.flatMap(t => t.qtyHeaders))];
  s3.columns = [{ header: 'סוג', width: 22 }, { header: 'צבע', width: 10 }, { header: 'שילוט', width: 28 }, ...branches.map(b => ({ header: b, width: 13 })), { header: 'סה"כ', width: 9 }];
  tabs.forEach(t => t.rows.filter(r => r.qty).forEach(r => s3.addRow([t.name, r.colorText, r.text || '', ...branches.map(b => r.q[b] || ''), r.qty])));
  const tot = s3.addRow(['סה"כ', '', '', ...branches.map(b => tabs.reduce((a, t) => a + t.rows.reduce((x, r) => x + (r.q[b] || 0), 0), 0)), tabs.reduce((a, t) => a + t.rows.reduce((x, r) => x + r.qty, 0), 0)]);
  tot.font = { bold: true };
  head(s3);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const api = { CORE_VERSION, norm, numsOf, wordsOf, textScore, classifyPixels, sizeFromText, machineOf, MACHINES, COLOR_HE,
  formatLabel, makeName, toEnglish, EN_PHRASES, EN_WORDS, readTableXlsx, readSO, analyzeArtwork, matchTab, buildPlan, sameSize, matchWords, buildItemPdf, buildReport, fileSafe };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TamnunCore = api;
})(typeof self !== 'undefined' ? self : this);
