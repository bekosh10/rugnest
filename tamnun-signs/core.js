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
const STOP = new Set(['לבן', 'אדום', 'כחול', 'שחור', 'צבעוני', 'פס', 'collection', 'הזדמנות', 'אחרונה', 'by', 'tamnon']);
const wordsOf = s => norm(s).split(' ').filter(w => w && !/^\d+(\.\d+)?$/.test(w));
const matchWords = s => wordsOf(s).filter(w => !STOP.has(w));

// table words that the artwork writes differently
const SYN = {
  'אקטיב': ['active'],
  "פיג'מות": ['pajamas', 'pajama'],
  'בייבי': ['baby', 'nb', 'years', 'tamnon'],
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
  if (/מתכתי|מגנט/.test(t)) return 'מגנטי';
  return 'דיגיטל';
}
const MACHINES = ['דיגיטל', 'מגנטי', 'דורסט'];

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
      // "כובע A5" / "פס מתכתי" are not A5/A3 paper – only a written size counts for them
      const special = /כובע|פס\b|פסים|פס /.test(fmt0 + ' ');
      const explicit = z => (z && /\d+(\.\d+)?\s*([xX×*\/]|רוחב)/.test(z)) ? sizeFromText(z) : null;
      const size = special
        ? (explicit(fmt0) || explicit(blockText) || (real.length === 1 ? explicit(allText) : null))
        : (sizeFromText(fmt0) || sizeFromText(blockText) || (real.length === 1 ? (sizeFromText(ws.name) || sizeFromText(allText)) : sizeFromText(ws.name)));
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
  const lines = [], meta = {};
  let soNumber = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.map(it => ({ x: it.transform[4], y: Math.round(it.transform[5]), s: it.str.replace(BIDI, '').trim() })).filter(i => i.s);
    const all = items.map(i => i.s).join(' ');
    const so = all.match(/SO\s*(\d{6,})/) || (() => { const i = items.findIndex(t => t.s === 'SO'); return i >= 0 && items[i + 1] && /^\d{6,}$/.test(items[i + 1].s) ? [0, items[i + 1].s] : null; })();
    if (so && !soNumber) soNumber = 'SO' + so[1];
    // header fields (label above value): customer, dates, contact…
    if (p === 1) for (const lab of ['לקוח', 'תאריך הזמנה', 'תאריך סיום נדרש', 'איש קשר', 'סוג הובלה', 'נפתחה ע"י', 'טלפון איש קשר']) {
      const L = items.find(i => i.s === lab); if (!L) continue;
      const v = items.filter(i => i !== L && i.y < L.y && L.y - i.y < 30 && Math.abs(i.x - L.x) < 140).sort((a, b) => (L.y - a.y) - (L.y - b.y))[0];
      if (v) meta[lab] = clean(items.filter(i => Math.abs(i.y - v.y) <= 2 && Math.abs(i.x - L.x) < 160).sort((a, b) => b.x - a.x).map(i => i.s).join(' '));
    }
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
  return { soNumber, lines, meta };
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
  let s = page.supp ? 0.7 : 0;      // a "השלמה" (completion) file sent later wins over the first file
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
  // pass 4 – a sign whose words are part of another sign ("חולצות" ← "חולצות מכופתרות"): drop the extra words
  rows.forEach((r, ri) => {
    if (res[ri]) return;
    const rw = matchWords(r.text);
    if (!rw.length || numsOf(r.text).length) return;
    const cand = pages.map((p, pi) => {
      const pw = wordsOf(p.text);
      if (p.nums.length || !rw.every(w => pw.includes(w)) || pw.length <= rw.length) return null;
      const okColor = p.color === r.color || canSwap(r.color, p.color);
      return okColor ? { pi, extra: pw.length - rw.length, same: p.color === r.color } : null;
    }).filter(Boolean).sort((a, b) => a.extra - b.extra || b.same - a.same)[0];
    if (cand) {
      res[ri] = { kind: 'trim', page: cand.pi, keep: r.text, from: pages[cand.pi].color, to: cand.same ? null : r.color };
      if (pageUse[cand.pi] == null) pageUse[cand.pi] = 'src';
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
  'הזדמנות אחרונה': 'last chance', 'כל הקולציית קיץ עד': 'summer collection up to', 'כל הקולקציית קיץ עד': 'summer collection up to',
  'כל הקולציית חורף עד': 'winter collection up to', 'כל הקולקציית חורף עד': 'winter collection up to',
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
    if (!a.size) return;
    let sc;
    if (tab.size) {
      const d = Math.max(Math.abs(tab.size[0] - a.size[0]), Math.abs(tab.size[1] - a.size[1]));
      sc = d <= 0.4 ? 10 : d <= 1.5 ? 6 : -99;
    } else sc = 4;                                                  // size not written in the table – the name decides
    const tName = tab.name + ' ' + tab.format + ' ' + (tab.sheet || ''), aName = a.name + ' ' + (a.title || '');
    const tk = keyOf(tab.format + ' ' + tab.name), ak = keyOf(aName);
    for (const k of ['כובע', 'פס']) { if (tk.includes(k) && ak.includes(k)) sc += 4; else if (tk.includes(k) !== ak.includes(k)) sc -= 4; }
    const ta = aOf(tab.format) || aOf(tab.name), aa = aOf(aName);
    if (ta && aa) sc += ta === aa ? 2 : -2;
    if (!tab.size && !(tk.includes('כובע') || tk.includes('פס')) && !(ta && aa && ta === aa)) sc = -99;
    if (!a.hasText) sc -= 3;
    sc -= Math.min(3, Math.abs(a.pages.length - tab.rows.length) / 4);
    pairs.push({ ti, ai, sc });
  }));
  const tabArt = tabs.map(() => -1);
  pairs.filter(p => p.sc >= 3).sort((x, y) => y.sc - x.sc).forEach(p => {
    if (tabArt[p.ti] >= 0 || used.has(p.ai)) return;
    tabArt[p.ti] = p.ai; used.add(p.ai);
  });
  // a type without a written size takes the size of its file
  tabs.forEach((t, ti) => { if (!t.size && tabArt[ti] >= 0) t.size = arts[tabArt[ti]].size; });
  // more files for the same type (e.g. "A3 מתכתי השלמה"): same size + same kind of name → added to that type
  const extraArts = tabs.map(() => []);
  arts.forEach((a, ai) => {
    if (used.has(ai) || !a.hasText) return;
    let best = -1, bs = 2;
    tabs.forEach((t, ti) => {
      const ba = tabArt[ti]; if (ba < 0) return;
      if (!sameSize(a.size, arts[ba].size, 0.4)) return;
      const p = pairs.find(x => x.ti === ti && x.ai === ai);
      const sc = p ? p.sc + Math.min(3, Math.abs(a.pages.length - t.rows.length) / 4) : 0;   // page count does not matter here
      if (sc > bs) { bs = sc; best = ti; }
    });
    if (best >= 0) { extraArts[best].push(ai); used.add(ai); }
  });
  // one "virtual" artwork per type: main file pages, then the extra files' pages (marked supp)
  const virt = tabs.map((t, ti) => {
    const ai = tabArt[ti]; if (ai < 0) return null;
    if (!extraArts[ti].length) return arts[ai];
    const pages = [];
    [ai, ...extraArts[ti]].forEach((x, k) => arts[x].pages.forEach(p => pages.push({ ...p, index: pages.length, src: x, srcPage: p.index, supp: k > 0, file: arts[x].name })));
    return { name: [ai, ...extraArts[ti]].map(x => arts[x].name).join(' + '), pages, size: arts[ai].size, virtual: true };
  });
  const unusedArts = arts.map((a, i) => i).filter(i => !used.has(i));

  const items = [], missing = [], fixed = [], extras = [], zero = [], checks = [];
  tabs.forEach((tab, ti) => {
    const ai = tabArt[ti], art = virt[ti];
    const { res, extras: ex } = matchTab(tab, art);
    // still missing → the graphics bank (pages approved in earlier orders, same size)
    // order of trust: client page as is > made from this order's own files (same font/size/design)
    // > bank page as is > made from a bank page. The bank is only for what this order cannot make itself.
    (opts.bankArts || []).forEach((ba, bi) => {
      const left = tab.rows.map((r, ri) => ri).filter(ri => tab.rows[ri].qty && (!res[ri] || (res[ri].bank && res[ri].kind !== 'ok')));
      if (!left.length || !sameSize(tab.size, ba.size, 1.5)) return;
      const r2 = matchTab({ rows: left.map(ri => tab.rows[ri]) }, ba, { noGuess: true }).res;
      r2.forEach((m, k) => {
        if (!m) return;
        const cur = res[left[k]];
        if (!cur || m.kind === 'ok') res[left[k]] = { ...m, bank: true, artIdx: arts.length + bi };
      });
    });
    tab.rows.forEach((row, ri) => {
      const m = res[ri];
      if (!row.qty) { zero.push({ tab: tab.name, row, match: m }); return; }
      if (!m) { missing.push({ tab: tab.name, ti, row, reason: art ? 'אין עמוד מתאים בקובץ' : 'אין קובץ בגודל ' + (tab.size ? tab.size.join('×') : '?') }); return; }
      let artI = m.artIdx != null ? m.artIdx : ai, pageI = m.page;
      if (m.artIdx == null && art && art.virtual) { const vp = art.pages[m.page]; artI = vp.src; pageI = vp.srcPage; }
      const srcArt = artI < arts.length ? arts[artI] : opts.bankArts[artI - arts.length];
      const page = srcArt.pages[pageI];
      const gen = m.kind !== 'ok' || !!m.bank;
      const nm = makeName(tab, row, page, gen, opts.en);
      const it = { ti, tab: tab.name, machine: tab.machine, row, art: artI, page: pageI, vpage: m.page, kind: m.bank && m.kind === 'ok' ? 'bank' : m.kind, m, name: nm.name, noEn: nm.missing, qty: row.qty };
      // a bank page from another order may be a little bigger/smaller – fit it to this order's size
      if (m.bank && art && art.pages[0]) it.target = [art.pages[0].w / 2.54 * 72, art.pages[0].h / 2.54 * 72];
      items.push(it);
      if (gen || m.guess) fixed.push(it);
    });
    if (art) ex.forEach(e => extras.push({ tab: tab.name, file: art.pages[e.page].file || art.name, filePage: art.pages[e.page].srcPage != null ? art.pages[e.page].srcPage : e.page, ...e }));
    // totals
    const sum = tab.rows.reduce((a, r) => a + r.qty, 0);
    const soLine = so && so.lines.find(l => sameSize(l.size, tab.size) && (l.machine === tab.machine || !l.machine));
    checks.push({ tab: tab.name, sum, stated: tab.stated, so: soLine ? soLine.qty : null, soDesc: soLine ? soLine.desc : null, file: art ? art.name : null, pages: art ? art.pages.length : 0, rows: tab.rows.length });
  });
  // same file name twice → (2)
  const seen = {};
  items.forEach(it => { const k = it.machine + '/' + it.name; if (seen[k]) { seen[k]++; it.name = it.name.replace(/\.pdf$/, ` (${seen[k]}).pdf`); } else seen[k] = 1; });
  return { items, missing, fixed, extras, zero, checks, tabArt, unusedArts, virt };
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

// ---- remove words from a one-line sign and centre what is left (glyphs already in the font)
function pdfStr(src, i) {               // parse (literal) or <hex> at src[i]; returns {bytes, end}
  const out = [];
  if (src[i] === '<') {
    let j = i + 1, hex = '';
    while (src[j] !== '>') { if (/[0-9a-fA-F]/.test(src[j])) hex += src[j]; j++; }
    if (hex.length % 2) hex += '0';
    for (let k = 0; k < hex.length; k += 2) out.push(parseInt(hex.slice(k, k + 2), 16));
    return { bytes: out, end: j + 1 };
  }
  let j = i + 1, depth = 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      const n = src[j + 1];
      const map = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
      if (n in map) { out.push(map[n]); j += 2; continue; }
      if (/[0-7]/.test(n)) { let o = ''; let k = j + 1; while (k < j + 4 && /[0-7]/.test(src[k])) o += src[k++]; out.push(parseInt(o, 8) & 255); j = k; continue; }
      if (n === '\r' || n === '\n') { j += 2; if (n === '\r' && src[j] === '\n') j++; continue; }
      out.push(n.charCodeAt(0)); j += 2; continue;
    }
    if (c === '(') depth++;
    if (c === ')') { depth--; if (!depth) break; }
    out.push(c.charCodeAt(0) & 255); j++;
  }
  return { bytes: out, end: j + 1 };
}
function toUniMap(PDFLib, font) {
  const tu = font.lookup(PDFLib.PDFName.of('ToUnicode'));
  if (!tu) return null;
  const u8 = PDFLib.decodePDFRawStream(tu).decode();
  let t = ''; for (let i = 0; i < u8.length; i++) t += String.fromCharCode(u8[i]);
  const map = {}, hx = h => parseInt(h, 16), uni = h => { let r = ''; for (let k = 0; k < h.length; k += 4) r += String.fromCharCode(parseInt(h.slice(k, k + 4), 16)); return r; };
  for (const blk of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map[hx(m[1])] = uni(m[2]);
  for (const blk of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
    const a = hx(m[1]), b = hx(m[2]);
    if (m[3][0] === '<') { const base = hx(m[3].slice(1, -1)); for (let c = a; c <= b; c++) map[c] = String.fromCharCode(base + c - a); }
    else { const arr = [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].map(x => uni(x[1])); for (let c = a; c <= b; c++) map[c] = arr[c - a] || ''; }
  }
  return map;
}
function trimWords(PDFLib, doc, page, keepText) {
  const N = PDFLib.PDFName.of;
  let s = getContent(PDFLib, doc, page);
  // exactly one text-showing operator on the page
  const shows = [...s.matchAll(/(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]*>)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ/g)];
  if (shows.length !== 1) return false;
  const sh = shows[0], before = s.slice(0, sh.index);
  const tf = [...before.matchAll(/\/(\S+)\s+([-\d.]+)\s+Tf/g)].pop();
  const tm = [...before.matchAll(/([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm/g)].pop();
  if (!tf || !tm) return false;
  const font = page.node.Resources().lookup(N('Font')).lookup(N(tf[1]));
  if (!font) return false;
  const uniMap = toUniMap(PDFLib, font); if (!uniMap) return false;
  const two = font.lookup(N('Subtype')).asString() === '/Type0';
  let wOf;
  if (two) {
    const df = font.lookup(N('DescendantFonts')).lookup(0), W = df.lookup(N('W')), dwO = df.lookup(N('DW')), dw = dwO ? dwO.asNumber() : 1000;
    const wm = {};
    if (W) for (let i = 0; i < W.size();) {
      const a = W.lookup(i).asNumber(), nx = W.lookup(i + 1);
      if (nx instanceof PDFLib.PDFArray) { for (let k = 0; k < nx.size(); k++) wm[a + k] = nx.lookup(k).asNumber(); i += 2; }
      else { const b = nx.asNumber(), w = W.lookup(i + 2).asNumber(); for (let c = a; c <= b; c++) wm[c] = w; i += 3; }
    }
    wOf = c => (wm[c] != null ? wm[c] : dw);
  } else {
    const Wd = font.lookup(N('Widths')), fc = font.lookup(N('FirstChar')).asNumber();
    wOf = c => { const i = c - fc; return Wd && i >= 0 && i < Wd.size() ? Wd.lookup(i).asNumber() : 0; };
  }
  // glyphs in drawing order, with the TJ kerning after each
  const glyphs = [];
  const addStr = bytes => { for (let i = 0; i < bytes.length; i += two ? 2 : 1) { const c = two ? (bytes[i] << 8) | bytes[i + 1] : bytes[i]; glyphs.push({ c, u: uniMap[c] || '', adj: 0 }); } };
  if (sh[1]) addStr(pdfStr(sh[1], 0).bytes);
  else {
    const src = sh[2]; let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '(' || ch === '<') { const r = pdfStr(src, i); addStr(r.bytes); i = r.end; }
      else if (/[-\d.]/.test(ch)) { const m = src.slice(i).match(/^[-\d.]+/); if (glyphs.length) glyphs[glyphs.length - 1].adj += +m[0]; i += m[0].length; }
      else i++;
    }
  }
  // words = runs between spaces; Hebrew is stored in visual order (reversed)
  const words = []; let cur = [];
  glyphs.forEach((g, gi) => { if (g.u === ' ') { if (cur.length) words.push(cur); cur = []; } else cur.push(gi); });
  if (cur.length) words.push(cur);
  const keep = wordsOf(keepText);
  const txt = w => w.map(gi => glyphs[gi].u).join('');
  const rev = w => [...txt(w)].reverse().join('');
  const kept = words.filter(w => keep.includes(norm(txt(w))) || keep.includes(norm(rev(w))));
  if (!kept.length || kept.length !== keep.length || kept.length === words.length) return false;
  const fsz = +tf[2], a = +tm[1];
  const width = list => list.reduce((acc, g, k) => acc + wOf(g.c) - (k < list.length - 1 ? g.adj : 0), 0) / 1000 * fsz * a;
  const oldW = width(glyphs);
  const spaceG = glyphs.find(g => g.u === ' ');
  const newList = [];
  kept.forEach((w, k) => { if (k) newList.push({ ...spaceG, adj: 0 }); w.forEach(gi => newList.push({ ...glyphs[gi] })); });
  newList[newList.length - 1] = { ...newList[newList.length - 1], adj: 0 };
  const newW = width(newList);
  const centre = +tm[5] + oldW / 2, newE = centre - newW / 2;
  const hex = c => c.toString(16).padStart(two ? 4 : 2, '0');
  const tj = '[' + newList.map(g => `<${hex(g.c)}>${g.adj ? ' ' + g.adj : ''}`).join(' ') + '] TJ';
  const tmNew = `${tm[1]} ${tm[2]} ${tm[3]} ${tm[4]} ${newE.toFixed(4)} ${tm[6]} Tm`;
  s = s.slice(0, sh.index) + tj + s.slice(sh.index + sh[0].length);
  s = s.slice(0, tm.index) + tmNew + s.slice(tm.index + tm[0].length);
  setContent(PDFLib, doc, page, s);
  return true;
}

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
  if (m.kind === 'trim') {
    ok = trimWords(PDFLib, out, pg, m.keep);
    if (ok && m.to) ok = swapColors(PDFLib, out, pg, m.from, m.to, cache[key].pal);
  }
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


/* ================================================================ EFI LAYOUT (print + cut, like Griffin) */
const CM = 72 / 2.54;
const LAYOUT_DEF = { width: 124, maxLen: 295, gap: 2.5, top: 1.3, bottom: 2, side: 0.8, bleed: 0.3, collect: false, collectTop: 3.2 };
// A3 or strip – by the tab name; "פס"/"פסים"/"פסי מדף" wins ("שילוט A3 פסים" is strips)
function layoutKind(tabName) { const t = tabName || ''; return /פס|strip/i.test(t) ? 'strip' : /a3/i.test(t) ? 'a3' : 'strip'; }
// kind by the sign's size (cm) – strips are long and narrow, A-sizes by their paper size
function layoutKindOfSize(w, h) {
  const a = Math.min(w, h), b = Math.max(w, h), near = (x, y) => Math.abs(a - x) < 1.2 && Math.abs(b - y) < 1.2;
  if (b / a >= 3) return 'strip';
  if (near(29.7, 42)) return 'a3';
  if (near(21, 29.7)) return 'a4';
  if (near(14.8, 21)) return 'a5';
  return `${Math.round(a * 10) / 10}x${Math.round(b * 10) / 10}`;
}
function layoutCollectFor(tabName) { return layoutKind(tabName) === 'a3'; }
function layoutWidthFor(tabName) { return layoutKind(tabName) === 'a3' ? 122 : 124; }
const COLOR_ORDER = ['red', 'white', 'blue', 'black'];
// groups: [{w,h (pt), qty, color}] in table order → sheets [{W,H, cells:[{g,x,y}]}] (pt, origin bottom-left)
function planLayout(groups, o) {
  o = { ...LAYOUT_DEF, ...(o || {}) };
  const W = o.width * CM, maxH = o.maxLen * CM, top = o.top * CM, bot = o.bottom * CM, gap = o.gap * CM;
  const order = [...groups.keys()].sort((a, b) => {
    const ca = COLOR_ORDER.indexOf(groups[a].color), cb = COLOR_ORDER.indexOf(groups[b].color);
    return ((ca < 0 ? 9 : ca) - (cb < 0 ? 9 : cb)) || a - b;
  });
  // Types stay whole. A type bigger than a sheet gets full sheets of its own (they become ×N);
  // what is left of it – and every small type – goes whole into the first sheet that still has room
  // (first-fit), otherwise a new sheet. Sheet height is not important, keeping types together is.
  const sheets = [], avail = maxH - top - bot;
  const place = (sh, gi, n, cols, cw, ch, rot) => {
    let cy = sh.used + (sh.cells.length ? gap : 0);
    const x0 = (W - cols * cw) / 2;
    for (let left = n; left > 0; left -= cols, cy += ch)
      for (let c = 0; c < Math.min(cols, left); c++) sh.cells.push({ g: gi, x: x0 + c * cw, top: cy, w: cw, h: ch, rot });
    sh.used = cy;
  };
  const aw = W - 2 * o.side * CM + 0.5, fill = w => Math.floor(aw / w) * w;
  const geo = g => {
    // turn the sign 90° when that fills the width better (A3 42×29.7 → 4 standing across)
    const rot = fill(g.h) > fill(g.w) * 1.01;
    const cw = rot ? g.h : g.w, ch = rot ? g.w : g.h;
    return { rot, cw, ch, cols: Math.max(1, Math.floor(aw / cw)) };
  };
  // completions ("hashlamot"): a last row with only a few signs (2 or less of 4) leaves the type
  // and goes to completion sheets at the end, packed tight by colour
  const collected = [], qtyOf = {};
  for (const gi of order) {
    const g = groups[gi], { cols } = geo(g); qtyOf[gi] = g.qty || 0;
    const rem = qtyOf[gi] % cols;
    if (o.collect && cols >= 3 && rem > 0 && rem <= cols - 2) { collected.push({ gi, n: rem }); qtyOf[gi] -= rem; }
  }
  for (const gi of order) {
    const g = groups[gi]; if (!qtyOf[gi]) continue;
    const { rot, cw, ch, cols } = geo(g);
    const rps = Math.max(1, Math.floor((avail + 0.5) / ch)), perSheet = cols * rps;
    let left = qtyOf[gi];
    while (left > perSheet) { const sh = { cells: [], used: 0 }; sheets.push(sh); place(sh, gi, perSheet, cols, cw, ch, rot); left -= perSheet; }
    const hNeed = Math.ceil(left / cols) * ch;
    let sh = sheets.find(z => z.used + (z.cells.length ? gap : 0) + hNeed <= avail + 0.5);
    if (!sh) { sh = { cells: [], used: 0 }; sheets.push(sh); }
    place(sh, gi, left, cols, cw, ch, rot);
  }
  if (collected.length) {
    // completion sheets: one tight layout – colours one after the other (red, white…), no empty rows;
    // where the colour changes inside a row a small gap (= bleed) is added if the row still fits
    const ctop = o.collectTop * CM, cav = maxH - ctop - bot, cg = (o.bleed != null ? o.bleed : LAYOUT_DEF.bleed) * CM;
    let sh = null, cy = 0, row = [], rowH = 0, rowCols = 0;
    const newSheet = () => { sh = { cells: [], used: 0, collect: true }; sheets.push(sh); cy = 0; };
    const flush = () => {
      if (!row.length) return;
      if (!sh || cy + rowH > cav + 0.5) newSheet();
      const breaks = row.filter((c, i) => i && c.color !== row[i - 1].color).length;
      const base = row.reduce((a, c) => a + c.cw, 0), useGap = breaks && base + breaks * cg <= aw;
      const full = rowCols * row[0].cw;           // keep rows aligned with the full-row grid
      let x = (W - Math.max(full, base + (useGap ? breaks * cg : 0))) / 2;
      row.forEach((c, i) => {
        if (i && useGap && c.color !== row[i - 1].color) x += cg;
        sh.cells.push({ g: c.gi, x, top: cy, w: c.cw, h: c.ch, rot: c.rot }); x += c.cw;
      });
      cy += rowH; sh.used = cy; row = []; rowH = 0;
    };
    for (const { gi, n } of collected) {
      const g = groups[gi], { rot, cw, ch, cols } = geo(g);
      if (row.length && (cols !== rowCols || Math.abs(ch - rowH) > 0.5)) flush();   // other sign size → new row
      rowCols = cols;
      for (let k = 0; k < n; k++) {
        row.push({ gi, cw, ch, rot, color: g.color }); rowH = Math.max(rowH, ch);
        if (row.length === cols) flush();
      }
    }
    flush();
  }
  for (const s of sheets) {
    const tp = s.collect ? o.collectTop * CM : top;
    s.W = W; s.H = tp + s.used + bot;
    for (const c of s.cells) c.y = s.H - tp - c.top - c.h;
  }
  // identical sheets → one sheet printed N times
  const uniq = [], seen = {};
  for (const s of sheets) {
    const sig = (s.collect ? 'C' : '') + s.H.toFixed(1) + '|' + s.cells.map(c => `${c.g}@${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(';');
    if (seen[sig]) seen[sig].copies++; else { s.copies = 1; seen[sig] = s; uniq.push(s); }
  }
  return uniq;
}
function regMarks(W, H) {
  const s = 0.2 * CM, d = 0.6 * CM, r = d / 2, k = 0.5523 * r;
  const pts = [[s, s], [W - s - d, s], [W - s - d - 5.08 * CM, s], [s, H - s - d], [W - s - d, H - s - d]];
  return pts.map(([x, y]) => { const cx = x + r, cy = y + r, f = v => v.toFixed(3);
    return `${f(cx + r)} ${f(cy)} m ${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c ` +
      `${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c ${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c ` +
      `${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c h f`; }).join('\n');
}
function layerKit(PDFLib, doc) {
  const ctx = doc.context, N = PDFLib.PDFName, S = PDFLib.PDFString;
  const cut = ctx.register(ctx.obj({ Type: 'OCG', Name: S.of('Thru-cut') }));
  const reg = ctx.register(ctx.obj({ Type: 'OCG', Name: S.of('Register') }));
  doc.catalog.set(N.of('OCProperties'), ctx.obj({ OCGs: [cut, reg], D: { Order: [cut, reg], ON: [cut, reg] } }));
  const sep = (name, c1) => ctx.register(ctx.obj([N.of('Separation'), N.of(name), N.of('DeviceCMYK'),
    ctx.obj({ FunctionType: 2, Domain: [0, 1], Range: [0, 1, 0, 1, 0, 1, 0, 1], C0: [0, 0, 0, 0], C1: c1, N: 1 })]));
  const csAll = sep('All', [1, 1, 1, 1]), csCut = sep('Thru-cut', [0.7, 0.85, 0, 0]);
  return (page, body) => {
    const res = page.node.normalizedEntries().Resources;
    const add = (cat, k, v) => { let d = res.lookup(N.of(cat)); if (!d) { d = ctx.obj({}); res.set(N.of(cat), d); } d.set(N.of(k), v); };
    add('Properties', 'Pr1', reg); add('Properties', 'Pr2', cut);
    add('ColorSpace', 'CSall', csAll); add('ColorSpace', 'CScut', csCut);
    page.node.addContentStream(ctx.register(ctx.stream(body)));
  };
}

// ---- text as vector outlines (no font in the PDF – RIPs like Caldera choke on non-embedded Helvetica)
// glyph outlines from Arimo (Apache 2.0, Helvetica metrics), font units, y up
const OUTLINE_FONT = {"r":{"upm":2048,"g":{"0":[556,"M1059 705Q1059 352 934.5 166.0Q810 -20 567 -20Q324 -20 202.0 165.0Q80 350 80 705Q80 1068 198.5 1249.0Q317 1430 573 1430Q822 1430 940.5 1247.0Q1059 1064 1059 705ZM876 705Q876 909 845.5 1036.5Q815 1164 748.0 1224.0Q681 1284 573 1284Q463 1284 394.0 1225.0Q325 1166 293.5 1038.5Q262 911 262 705Q262 505 294.5 377.0Q327 249 395.0 188.0Q463 127 569 127Q728 127 802.0 269.0Q876 411 876 705Z"],"1":[556,"M1039 153V0H156V153H515V1237L197 1010V1180L530 1409H696V153Z"],"2":[556,"M1036 153V0H103V127Q154 244 226.5 334.0Q299 424 381.0 496.0Q463 568 543 630Q583 661 618.5 692.0Q654 723 686 754Q750 816 789.5 884.0Q829 952 829 1038Q829 1154 761.0 1218.0Q693 1282 572 1282Q457 1282 382.5 1219.5Q308 1157 295 1044L111 1061Q131 1230 254.5 1330.0Q378 1430 572 1430Q785 1430 899.5 1329.5Q1014 1229 1014 1044Q1014 962 976.5 881.0Q939 800 865 719Q828 679 757.0 616.0Q686 553 582 468Q467 374 399.0 298.5Q331 223 301 153Z"],"3":[556,"M1049 389Q1049 194 925.0 87.0Q801 -20 571 -20Q357 -20 229.5 76.5Q102 173 78 362L264 379Q300 129 571 129Q707 129 784.5 196.0Q862 263 862 395Q862 510 773.5 574.5Q685 639 518 639H416V795H514Q662 795 743.5 859.5Q825 924 825 1038Q825 1151 758.5 1216.5Q692 1282 561 1282Q442 1282 368.5 1221.0Q295 1160 283 1049L102 1063Q122 1236 245.5 1333.0Q369 1430 563 1430Q775 1430 892.5 1331.5Q1010 1233 1010 1057Q1010 922 934.5 837.5Q859 753 715 723V719Q873 702 961.0 613.0Q1049 524 1049 389Z"],"4":[556,"M881 319V0H711V319H47V459L692 1409H881V461H1079V319ZM213 461H711V1023Q711 1069 711.5 1114.5Q712 1160 715 1206Q692 1162 675.0 1134.5Q658 1107 644 1087Z"],"5":[556,"M1053 459Q1053 236 920.5 108.0Q788 -20 553 -20Q356 -20 235.0 66.0Q114 152 82 315L264 336Q293 232 366.0 179.5Q439 127 557 127Q702 127 784.0 214.5Q866 302 866 455Q866 588 783.5 670.0Q701 752 561 752Q488 752 425.0 729.0Q362 706 299 651H123L170 1409H971V1256H334L307 809Q424 899 598 899Q737 899 839.0 843.5Q941 788 997.0 689.0Q1053 590 1053 459Z"],"6":[556,"M1049 461Q1049 238 928.0 109.0Q807 -20 594 -20Q356 -20 230.0 157.0Q104 334 104 672Q104 1038 235.0 1234.0Q366 1430 608 1430Q768 1430 868.5 1358.0Q969 1286 1010 1143L838 1112Q786 1284 606 1284Q452 1284 367.5 1140.5Q283 997 283 725Q332 816 421.0 863.5Q510 911 625 911Q820 911 934.5 789.0Q1049 667 1049 461ZM866 453Q866 606 791.0 689.0Q716 772 582 772Q456 772 378.5 698.5Q301 625 301 496Q301 388 338.0 304.0Q375 220 439.5 172.5Q504 125 588 125Q718 125 792.0 212.5Q866 300 866 453Z"],"7":[556,"M1036 1263Q928 1098 851.5 969.0Q775 840 731 746Q642 559 597.5 377.0Q553 195 553 0H365Q365 140 394.0 284.5Q423 429 487 588Q547 737 639.5 902.5Q732 1068 862 1256H105V1409H1036Z"],"8":[556,"M1050 393Q1050 198 926.0 89.0Q802 -20 570 -20Q344 -20 216.5 87.0Q89 194 89 391Q89 529 168.0 623.0Q247 717 370 737V741Q255 768 188.5 858.0Q122 948 122 1069Q122 1230 242.5 1330.0Q363 1430 566 1430Q774 1430 894.5 1332.0Q1015 1234 1015 1067Q1015 946 948.0 856.0Q881 766 765 743V739Q900 717 975.0 624.5Q1050 532 1050 393ZM828 1057Q828 1296 566 1296Q306 1296 306 1057Q306 936 374.5 872.5Q443 809 568 809Q695 809 761.5 867.5Q828 926 828 1057ZM863 410Q863 541 785.0 607.5Q707 674 566 674Q429 674 352.0 602.5Q275 531 275 406Q275 261 349.5 188.0Q424 115 572 115Q719 115 791.0 185.5Q863 256 863 410Z"],"9":[556,"M1042 733Q1042 370 909.5 175.0Q777 -20 532 -20Q367 -20 267.5 49.5Q168 119 125 274L297 301Q351 125 535 125Q690 125 775.0 269.0Q860 413 864 680Q824 590 727.0 535.5Q630 481 514 481Q388 481 294.0 540.0Q200 599 148.0 706.0Q96 813 96 956Q96 1177 220.0 1303.5Q344 1430 565 1430Q800 1430 921.0 1256.0Q1042 1082 1042 733ZM846 907Q846 1077 768.0 1180.5Q690 1284 559 1284Q429 1284 354.0 1195.5Q279 1107 279 956Q279 802 354.0 712.5Q429 623 557 623Q635 623 700.5 659.0Q766 695 806.0 759.5Q846 824 846 907Z"],"a":[556,"M414 -20Q251 -20 169.0 66.0Q87 152 87 302Q87 470 197.5 560.0Q308 650 554 656L797 660V719Q797 851 741.0 908.0Q685 965 565 965Q444 965 389.0 924.0Q334 883 323 793L135 810Q181 1102 569 1102Q773 1102 876.0 1008.5Q979 915 979 738V272Q979 192 1000.0 151.5Q1021 111 1080 111Q1108 111 1139 118V6Q1105 -2 1070.0 -6.0Q1035 -10 1000 -10Q900 -10 854.5 42.5Q809 95 803 207H797Q728 83 636.5 31.5Q545 -20 414 -20ZM797 534 600 530Q474 529 408 504Q342 480 307.0 430.0Q272 380 272 299Q272 211 319.5 163.0Q367 115 455 115Q555 115 631 160Q708 205 752.5 283.5Q797 362 797 445Z"],"b":[556,"M1053 546Q1053 263 953.5 121.5Q854 -20 655 -20Q532 -20 450.5 24.5Q369 69 318 168H316Q316 148 314.0 110.0Q312 72 310.0 39.5Q308 7 306 0H132Q135 27 136.5 82.5Q138 138 138 223V1484H318V1061Q318 1029 317.0 990.5Q316 952 314 908H318Q368 1012 450.5 1057.0Q533 1102 655 1102Q860 1102 956.5 964.0Q1053 826 1053 546ZM864 540Q864 767 804.0 865.0Q744 963 609 963Q457 963 387.5 859.0Q318 755 318 529Q318 316 386.0 214.5Q454 113 607 113Q743 113 803.5 213.5Q864 314 864 540Z"],"c":[500,"M553 -20Q326 -20 206.5 123.5Q87 267 87 542Q87 815 207.0 958.5Q327 1102 551 1102Q717 1102 826.5 1016.0Q936 930 964 779L779 765Q765 855 708.0 908.0Q651 961 546 961Q403 961 339.0 866.0Q275 771 275 546Q275 330 343.0 226.0Q411 122 548 122Q644 122 708.5 174.0Q773 226 788 334L970 322Q956 218 900.5 141.0Q845 64 756.5 22.0Q668 -20 553 -20Z"],"d":[556,"M835 0Q833 11 830.5 41.5Q828 72 826.5 109.0Q825 146 825 174H821Q771 70 688.5 25.0Q606 -20 484 -20Q279 -20 182.5 118.0Q86 256 86 536Q86 819 185.5 960.5Q285 1102 484 1102Q607 1102 689.0 1057.0Q771 1012 821 914H823L821 1035V1484H1001V223Q1001 138 1002.5 82.5Q1004 27 1007 0ZM275 542Q275 315 335.0 217.0Q395 119 530 119Q683 119 752.0 225.0Q821 331 821 554Q821 769 752.0 869.0Q683 969 532 969Q396 969 335.5 868.5Q275 768 275 542Z"],"e":[556,"M276 503Q276 317 353.0 216.0Q430 115 578 115Q695 115 765.5 162.0Q836 209 861 281L1019 236Q922 -20 578 -20Q338 -20 212.5 123.0Q87 266 87 548Q87 816 212.5 959.0Q338 1102 571 1102Q810 1102 929.0 958.0Q1048 814 1048 527V503ZM862 641Q847 812 775.0 890.5Q703 969 568 969Q437 969 360.5 881.5Q284 794 278 641Z"],"f":[278,"M361 951V0H181V951H29V1082H181V1204Q181 1352 246.0 1417.0Q311 1482 445 1482Q520 1482 572 1470V1333Q524 1341 492 1341Q423 1341 392.0 1306.0Q361 1271 361 1179V1082H572V951Z"],"g":[556,"M548 -425Q371 -425 266.0 -355.5Q161 -286 131 -158L312 -132Q330 -207 391.5 -247.5Q453 -288 553 -288Q687 -288 754.5 -209.0Q822 -130 822 27V201H820Q769 97 680.0 44.5Q591 -8 472 -8Q273 -8 179.5 124.0Q86 256 86 539Q86 826 186.5 962.5Q287 1099 492 1099Q607 1099 691.5 1046.5Q776 994 822 897H824Q824 917 826.0 959.5Q828 1002 831.0 1040.0Q834 1078 836 1082H1007Q1001 1028 1001 858V31Q1001 -197 888.0 -311.0Q775 -425 548 -425ZM822 541Q822 738 741.5 851.5Q661 965 536 965Q398 965 335.0 865.0Q272 765 272 541Q272 319 331.0 222.0Q390 125 533 125Q661 125 741.5 236.5Q822 348 822 541Z"],"h":[556,"M317 897Q375 1003 456.5 1052.5Q538 1102 663 1102Q839 1102 922.5 1010.5Q1006 919 1006 721V0H825V686Q825 833 773.5 898.0Q722 963 602 963Q475 963 398.5 875.0Q322 787 322 638V0H142V1484H322V1098Q322 1058 320.0 1013.5Q318 969 316.5 936.5Q315 904 314 897Z"],"i":[222,"M317 1484V1312H137V1484ZM317 1082V0H137V1082Z"],"j":[222,"M317 1484V1312H137V1484ZM77 -425Q-1 -425 -50 -416V-277Q-34 -279 -19.0 -281.0Q-4 -283 12 -283Q81 -283 109.0 -247.0Q137 -211 137 -107V1082H317V-134Q317 -287 257.0 -356.0Q197 -425 77 -425Z"],"k":[500,"M318 385V0H138V1484H318V557L793 1082H1004L565 617L1027 0H816L450 494Z"],"l":[222,"M318 1484V0H138V1484Z"],"m":[833,"M321 627V0H142V851Q142 946 140.5 1003.5Q139 1061 136 1082H306Q308 1060 310.0 1028.0Q312 996 313.0 961.5Q314 927 314 897H317Q375 1012 450.0 1057.0Q525 1102 633 1102Q756 1102 827.5 1053.0Q899 1004 927 897H930Q986 1006 1065.5 1054.0Q1145 1102 1258 1102Q1422 1102 1496.5 1013.0Q1571 924 1571 721V0H1393V686Q1393 843 1350.0 903.0Q1307 963 1195 963Q1077 963 1011.5 875.5Q946 788 946 627V0H768V686Q768 843 725.0 903.0Q682 963 570 963Q455 963 388.0 875.0Q321 787 321 627Z"],"n":[556,"M322 627V0H142V851Q142 946 140.5 1003.5Q139 1061 136 1082H306Q308 1063 309.5 1034.0Q311 1005 312.0 970.0Q313 935 314 897H317Q379 1009 460.5 1055.5Q542 1102 663 1102Q841 1102 923.5 1011.0Q1006 920 1006 721V0H825V686Q825 841 775.0 902.0Q725 963 602 963Q472 963 397.0 874.0Q322 785 322 627Z"],"o":[556,"M1053 542Q1053 258 928.0 119.0Q803 -20 565 -20Q328 -20 207.0 124.5Q86 269 86 542Q86 822 207.5 962.0Q329 1102 571 1102Q819 1102 936.0 965.5Q1053 829 1053 542ZM864 542Q864 766 797.5 867.5Q731 969 574 969Q416 969 345.5 865.5Q275 762 275 542Q275 328 344.5 220.5Q414 113 563 113Q725 113 794.5 217.0Q864 321 864 542Z"],"p":[556,"M1053 546Q1053 263 953.5 121.5Q854 -20 655 -20Q405 -20 319 168H314Q318 161 318 -2V-425H138V861Q138 944 136.5 999.5Q135 1055 132 1082H306Q307 1078 309.5 1043.0Q312 1008 314.0 967.5Q316 927 316 908H320Q368 1008 447.0 1054.5Q526 1101 655 1101Q855 1101 954.0 967.0Q1053 833 1053 546ZM864 542Q864 768 803.0 865.0Q742 962 609 962Q461 962 389.5 859.5Q318 757 318 528Q318 315 386.0 214.0Q454 113 607 113Q741 113 802.5 211.5Q864 310 864 542Z"],"q":[556,"M86 536Q86 819 185.5 960.5Q285 1102 484 1102Q607 1102 688.0 1058.5Q769 1015 823 914Q823 934 825.0 976.5Q827 1019 830.0 1056.0Q833 1093 835 1096H1008Q1004 1067 1002.5 993.0Q1001 919 1001 801V-425H821V14L825 178H823Q769 71 690.0 25.5Q611 -20 484 -20Q278 -20 182.0 119.0Q86 258 86 536ZM821 554Q821 765 752.0 867.0Q683 969 532 969Q395 969 335.0 867.0Q275 765 275 542Q275 315 335.5 217.0Q396 119 530 119Q683 119 752.0 228.0Q821 337 821 554Z"],"r":[333,"M322 564V0H142V830Q142 887 140.5 950.0Q139 1013 136 1082H306Q308 1036 309.5 999.0Q311 962 312.0 934.5Q313 907 313.5 888.5Q314 870 314 861H318Q348 959 384 1013Q419 1063 464.0 1082.5Q509 1102 575 1102Q612 1102 648 1092V927Q614 937 552 937Q440 937 381.0 840.5Q322 744 322 564Z"],"s":[500,"M950 299Q950 146 834.5 63.0Q719 -20 511 -20Q309 -20 199.5 46.5Q90 113 57 254L216 285Q239 198 311.0 157.5Q383 117 511 117Q648 117 711.5 159.0Q775 201 775 285Q775 349 731.0 389.0Q687 429 589 455Q473 486 404.5 506.0Q336 526 299.0 540.5Q262 555 240 568Q174 606 137.0 661.0Q100 716 100 796Q100 944 205.5 1021.5Q311 1099 513 1099Q692 1099 797.5 1036.0Q903 973 931 834L769 814Q754 886 688.5 924.5Q623 963 513 963Q391 963 333.0 926.0Q275 889 275 814Q275 759 308.0 723.5Q341 688 434 665Q559 635 672.0 599.5Q785 564 834 529Q891 488 920.5 432.5Q950 377 950 299Z"],"t":[278,"M554 8Q466 -16 372 -16Q264 -16 210.0 45.5Q156 107 156 229V951H31V1082H163L216 1324H336V1082H536V951H336V268Q336 190 361.5 158.5Q387 127 450 127Q484 127 554 141Z"],"u":[556,"M822 185Q760 73 678.5 26.5Q597 -20 476 -20Q298 -20 215.5 68.5Q133 157 133 361V1082H314V396Q314 234 364.5 176.5Q415 119 537 119Q667 119 742.0 208.0Q817 297 817 455V1082H997V231Q997 137 998.5 79.0Q1000 21 1003 0H833Q832 5 829.5 47.0Q827 89 825 185Z"],"v":[500,"M1017 1082 613 0H400L7 1082H199L437 378Q444 358 461 299L506 141Q519 180 531.5 222.5Q544 265 556.5 305.0Q569 345 580 376L826 1082Z"],"w":[722,"M704 765 508 0H300L-3 1082H175L361 333Q369 301 380.0 252.0Q391 203 401 149Q412 196 423.5 243.0Q435 290 447 336L644 1082H837L1026 339Q1038 292 1049.5 244.0Q1061 196 1072 149Q1083 197 1094.5 249.5Q1106 302 1116 342L1308 1082H1484L1174 0H965L776 765Q766 807 757.5 849.5Q749 892 740 934Q736 912 725.5 859.5Q715 807 704 765Z"],"x":[500,"M510 444 217 0H23L408 556L41 1082H240L510 661L778 1082H979L612 558L1002 0H801Z"],"y":[500,"M191 -425Q119 -425 67 -414V-279Q105 -285 151 -285Q235 -285 306.5 -222.5Q378 -160 434 5L5 1082H197L425 484Q450 420 478.5 339.0Q507 258 523 196Q548 267 573.5 337.0Q599 407 623 477L830 1082H1020L604 0Q570 -86 539.0 -150.5Q508 -215 479 -257Q421 -342 350.5 -383.5Q280 -425 191 -425Z"],"z":[500,"M922 139V0H83V137L688 943H117V1082H901V945L295 139Z"],"A":[667,"M364 412 202 0H4L579 1409H796L1362 0H1167L1006 412ZM685 1265Q668 1209 644.5 1140.5Q621 1072 601 1020L422 561H949L768 1026Q754 1061 731.0 1125.0Q708 1189 685 1265Z"],"B":[667,"M1258 397Q1258 209 1121.0 104.5Q984 0 740 0H168V1409H680Q928 1409 1052.0 1323.5Q1176 1238 1176 1067Q1176 942 1106.0 857.0Q1036 772 908 743Q1076 723 1167.0 630.5Q1258 538 1258 397ZM984 1044Q984 1158 906.0 1207.0Q828 1256 680 1256H359V810H680Q833 810 908.5 867.5Q984 925 984 1044ZM1065 412Q1065 661 715 661H359V153H730Q905 153 985.0 218.0Q1065 283 1065 412Z"],"C":[722,"M800 137Q1096 137 1245 430L1401 352Q1314 170 1156.5 75.0Q999 -20 791 -20Q577 -20 423.0 69.0Q269 158 186.5 322.5Q104 487 104 711Q104 936 186.0 1097.0Q268 1258 422.0 1344.0Q576 1430 790 1430Q1015 1430 1166.0 1342.0Q1317 1254 1388 1081L1207 1021Q1158 1144 1049.5 1209.0Q941 1274 792 1274Q558 1274 428.0 1123.5Q298 973 298 711Q298 539 359.5 409.5Q421 280 533.5 208.5Q646 137 800 137Z"],"D":[722,"M1381 719Q1381 496 1294.5 335.0Q1208 174 1053.5 87.0Q899 0 695 0H168V1409H634Q992 1409 1186.5 1229.5Q1381 1050 1381 719ZM1189 719Q1189 981 1045.5 1118.5Q902 1256 630 1256H359V153H673Q830 153 945.5 222.0Q1061 291 1125.0 418.0Q1189 545 1189 719Z"],"E":[667,"M1278 156V0H168V1409H1237V1253H359V801H1177V647H359V156Z"],"F":[611,"M359 571V0H168V1409H1169V1253H359V729H1145V571Z"],"G":[778,"M813 135Q951 135 1070.5 177.0Q1190 219 1264 291V545H843V705H1440V219Q1328 105 1165.5 42.5Q1003 -20 813 -20Q593 -20 434.0 69.0Q275 158 189.0 322.5Q103 487 103 711Q103 1054 287.0 1242.0Q471 1430 804 1430Q1038 1430 1184.0 1351.0Q1330 1272 1409 1098L1227 1044Q1167 1164 1061.5 1219.0Q956 1274 799 1274Q555 1274 426.0 1126.5Q297 979 297 711Q297 444 434.0 289.5Q571 135 813 135Z"],"H":[722,"M359 653V0H168V1409H359V813H1121V1409H1312V0H1121V653Z"],"I":[278,"M380 1409V0H189V1409Z"],"J":[500,"M457 -20Q278 -20 172.0 72.5Q66 165 32 350L219 381Q237 265 300.0 200.0Q363 135 458 135Q562 135 622.0 206.5Q682 278 682 416V1253H411V1409H872V420Q872 215 761.0 97.5Q650 -20 457 -20Z"],"K":[667,"M359 540V0H168V1409H359V703L1038 1409H1263L663 797L1343 0H1106L543 680Z"],"L":[556,"M1071 156V0H168V1409H359V156Z"],"M":[833,"M338 940V0H168V1409H419L794 432Q814 373 832.5 305.5Q851 238 857 208Q863 235 877.0 282.5Q891 330 905.0 374.0Q919 418 925 432L1293 1409H1538V0H1366V940Q1366 1018 1368.5 1093.0Q1371 1168 1375 1240Q1350 1151 1328.5 1080.5Q1307 1010 1287 960L923 0H789L420 960L331 1240Q333 1165 335.5 1090.0Q338 1015 338 940Z"],"N":[722,"M338 936V0H168V1409H390L1152 201Q1140 398 1140 485V1409H1312V0H1082L328 1200Q330 1134 334.0 1068.0Q338 1002 338 936Z"],"O":[778,"M1495 711Q1495 485 1409.5 321.0Q1324 157 1167.0 68.5Q1010 -20 795 -20Q579 -20 422.5 68.0Q266 156 181.5 320.0Q97 484 97 711Q97 937 180.5 1097.5Q264 1258 420.5 1344.0Q577 1430 797 1430Q1013 1430 1169.5 1345.0Q1326 1260 1410.5 1099.5Q1495 939 1495 711ZM1300 711Q1300 974 1168.5 1124.0Q1037 1274 797 1274Q555 1274 423.0 1126.0Q291 978 291 711Q291 535 351.0 405.5Q411 276 524.0 205.5Q637 135 795 135Q1039 135 1169.5 285.5Q1300 436 1300 711Z"],"P":[667,"M1258 985Q1258 852 1199.0 754.0Q1140 656 1031.5 602.5Q923 549 773 549H359V0H168V1409H761Q998 1409 1128.0 1298.0Q1258 1187 1258 985ZM1066 983Q1066 1256 738 1256H359V700H746Q906 700 986.0 770.5Q1066 841 1066 983Z"],"Q":[778,"M1495 711Q1495 513 1427.5 360.0Q1360 207 1233.0 112.5Q1106 18 928 -6Q969 -132 1035.5 -188.0Q1102 -244 1204 -244Q1261 -244 1319 -231V-365Q1228 -387 1141 -387Q990 -387 892.5 -301.5Q795 -216 733 -16Q531 -6 389.0 86.0Q247 178 172.0 338.0Q97 498 97 711Q97 937 180.5 1097.5Q264 1258 420.5 1344.0Q577 1430 797 1430Q1019 1430 1175.0 1342.5Q1331 1255 1413.0 1094.0Q1495 933 1495 711ZM1300 711Q1300 974 1168.5 1124.0Q1037 1274 797 1274Q555 1274 423.0 1126.0Q291 978 291 711Q291 535 351.0 405.5Q411 276 524.0 205.5Q637 135 795 135Q1039 135 1169.5 285.5Q1300 436 1300 711Z"],"R":[722,"M359 585V0H168V1409H831Q1069 1409 1198.5 1302.5Q1328 1196 1328 1006Q1328 849 1236.5 742.0Q1145 635 984 607L1384 0H1164L798 585ZM1136 1004Q1136 1127 1052.5 1191.5Q969 1256 812 1256H359V736H820Q971 736 1053.5 806.5Q1136 877 1136 1004Z"],"S":[667,"M1272 389Q1272 194 1119.5 87.0Q967 -20 690 -20Q175 -20 93 338L278 375Q310 248 414.0 188.5Q518 129 697 129Q882 129 982.5 192.5Q1083 256 1083 379Q1083 448 1051.5 491.0Q1020 534 963 562Q906 590 827.0 609.0Q748 628 652 650Q541 675 466.5 699.0Q392 723 344.0 749.5Q296 776 262 806Q212 852 185.5 913.0Q159 974 159 1053Q159 1234 297.5 1332.0Q436 1430 694 1430Q934 1430 1061.0 1356.5Q1188 1283 1239 1106L1051 1073Q1020 1185 933.0 1235.5Q846 1286 692 1286Q523 1286 434.0 1230.0Q345 1174 345 1063Q345 998 379.5 955.5Q414 913 479 884Q540 855 738 811Q819 792 898.0 771.5Q977 751 1047 720Q1088 703 1125.5 678.5Q1163 654 1191 622Q1229 580 1250.5 523.0Q1272 466 1272 389Z"],"T":[611,"M720 1253V0H530V1253H46V1409H1204V1253Z"],"U":[722,"M731 -20Q558 -20 429.0 44.0Q300 108 229.0 227.0Q158 346 158 512V1409H349V528Q349 335 447.0 235.0Q545 135 730 135Q920 135 1025.5 238.5Q1131 342 1131 541V1409H1321V530Q1321 359 1248.5 236.0Q1176 113 1043.5 46.5Q911 -20 731 -20Z"],"V":[667,"M1357 1409 782 0H584L9 1409H210L600 417Q624 356 643.5 293.0Q663 230 684 168Q704 230 726.0 298.0Q748 366 768 417L1156 1409Z"],"W":[944,"M897 890 652 0H424L9 1409H208L461 514Q484 430 504.5 343.5Q525 257 544 168Q552 205 565.5 265.5Q579 326 594.0 389.0Q609 452 621 495L877 1409H1060L1305 532Q1333 425 1355.0 333.5Q1377 242 1393 168Q1408 227 1424.5 295.5Q1441 364 1455.5 420.5Q1470 477 1476 501L1727 1409H1926L1511 0H1283L1039 895Q1027 937 1009.5 1012.0Q992 1087 969 1196Q960 1143 945.5 1081.5Q931 1020 917.5 968.0Q904 916 897 890Z"],"X":[667,"M689 616 257 0H46L582 732L87 1409H298L690 856L1071 1409H1282L800 739L1323 0H1112Z"],"Y":[667,"M777 584V0H587V584L45 1409H255L684 738L1111 1409H1321Z"],"Z":[611,"M1187 156V0H65V143L923 1253H138V1409H1140V1270L282 156Z"]," ":[278,""],"/":[278,"M569 1484 162 -20H0L411 1484Z"],".":[278,"M382 219V0H187V219Z"],"-":[333,"M591 624V464H91V624Z"],"_":[556,"M1162 -277V-407H-31V-277Z"],"(":[333,"M496 -424Q370 -288 288.0 -141.0Q206 6 166.5 171.5Q127 337 127 528Q127 723 167.0 889.0Q207 1055 289.0 1202.0Q371 1349 496 1484H670Q483 1276 395.5 1042.0Q308 808 308 530Q308 346 346.0 181.0Q384 16 464.0 -133.5Q544 -283 670 -424Z"],")":[333,"M12 -424Q138 -284 218.0 -134.5Q298 15 336.0 179.5Q374 344 374 530Q374 809 286.5 1042.0Q199 1275 12 1484H186Q312 1348 393.5 1201.0Q475 1054 515.0 889.0Q555 724 555 532Q555 338 515.0 171.5Q475 5 393.5 -141.5Q312 -288 186 -424Z"],"#":[556,"M320 408 236 0H126L210 408H9V516H234L312 885H60V993H334L423 1401H533L445 993H808L896 1401H1006L918 993H1129V885H896L818 516H1078V408H795L707 0H597L683 408ZM345 516H707L785 885H425Z"],":":[278,"M382 1082V875H187V1082ZM382 207V0H187V207Z"]}},"b":{"upm":2048,"g":{"0":[556,"M1055 705Q1055 348 932.5 164.0Q810 -20 565 -20Q323 -20 202.0 161.5Q81 343 81 705Q81 1076 196.5 1253.0Q312 1430 573 1430Q823 1430 939.0 1249.0Q1055 1068 1055 705ZM773 705Q773 895 756.0 1005.5Q739 1116 695.0 1163.0Q651 1210 571 1210Q486 1210 440.5 1162.5Q395 1115 378.5 1004.5Q362 894 362 705Q362 516 379.5 405.5Q397 295 441.5 248.0Q486 201 567 201Q687 201 730.0 317.0Q773 433 773 705Z"],"1":[556,"M1082 209V0H129V209H478V1170L140 959V1180L493 1409H759V209Z"],"2":[556,"M1057 231V0H71V195Q108 276 165.0 353.5Q222 431 301.5 509.5Q381 588 483 671Q557 731 609.0 780.5Q661 830 690 869Q720 908 735.0 946.5Q750 985 750 1022Q750 1114 703.5 1160.0Q657 1206 565 1206Q475 1206 427.5 1157.5Q380 1109 366 1012L83 1028Q107 1224 229.5 1327.0Q352 1430 563 1430Q791 1430 913.0 1326.0Q1035 1222 1035 1034Q1035 928 991.0 844.0Q947 760 879 689Q823 628 752.5 573.0Q682 518 616 466Q546 410 488.5 353.0Q431 296 403 231Z"],"3":[556,"M1065 391Q1065 193 935.0 85.0Q805 -23 565 -23Q338 -23 204.0 81.5Q70 186 47 383L333 408Q360 205 564 205Q665 205 721.0 255.0Q777 305 777 408Q777 502 709.0 552.0Q641 602 507 602H409V829H501Q622 829 683.0 878.5Q744 928 744 1020Q744 1107 695.5 1156.5Q647 1206 554 1206Q467 1206 413.5 1158.0Q360 1110 352 1022L71 1042Q93 1224 222.0 1327.0Q351 1430 559 1430Q780 1430 904.5 1330.5Q1029 1231 1029 1055Q1029 923 951.5 838.0Q874 753 728 725V721Q890 702 977.5 614.5Q1065 527 1065 391Z"],"4":[556,"M940 287V0H672V287H31V498L626 1409H940V496H1128V287ZM260 496H672V957Q672 1011 675.5 1074.0Q679 1137 681 1155Q668 1127 644.5 1086.5Q621 1046 587 993Z"],"5":[556,"M1082 469Q1082 245 942.5 112.5Q803 -20 560 -20Q348 -20 220.5 75.5Q93 171 63 352L344 375Q366 285 422.0 244.0Q478 203 563 203Q668 203 730.5 270.0Q793 337 793 463Q793 574 734.0 640.5Q675 707 569 707Q511 707 463.0 684.5Q415 662 378 616H104L153 1409H1000V1200H408L385 844Q487 934 640 934Q774 934 873.5 877.5Q973 821 1027.5 717.0Q1082 613 1082 469Z"],"6":[556,"M1065 461Q1065 236 939.0 108.0Q813 -20 591 -20Q342 -20 208.5 154.5Q75 329 75 672Q75 1049 210.5 1239.5Q346 1430 598 1430Q777 1430 880.5 1351.0Q984 1272 1027 1106L762 1069Q725 1208 592 1208Q479 1208 414.5 1095.0Q350 982 350 752Q395 827 475.0 867.0Q555 907 656 907Q845 907 955.0 787.0Q1065 667 1065 461ZM783 453Q783 573 727.5 636.5Q672 700 575 700Q482 700 426.0 640.5Q370 581 370 483Q370 401 396.5 337.0Q423 273 471.0 236.0Q519 199 582 199Q677 199 730.0 266.5Q783 334 783 453Z"],"7":[556,"M1049 1186Q954 1036 869.5 895.5Q785 755 722 612Q659 470 622.5 319.0Q586 168 586 0H293Q293 161 328.0 305.5Q363 450 439 610Q489 714 571.0 848.0Q653 982 788 1178H88V1409H1049Z"],"8":[556,"M1076 397Q1076 199 945.0 89.5Q814 -20 571 -20Q330 -20 197.5 89.0Q65 198 65 395Q65 530 143.0 622.5Q221 715 352 737V741Q238 766 168.0 854.0Q98 942 98 1057Q98 1230 220.5 1330.0Q343 1430 567 1430Q796 1430 918.5 1332.5Q1041 1235 1041 1055Q1041 940 971.5 853.0Q902 766 785 743V739Q921 717 998.5 627.5Q1076 538 1076 397ZM752 1040Q752 1233 567 1233Q385 1233 385 1040Q385 939 431.0 888.5Q477 838 569 838Q661 838 706.5 885.0Q752 932 752 1040ZM785 420Q785 530 730.0 585.5Q675 641 565 641Q463 641 408.5 583.0Q354 525 354 416Q354 292 408.0 235.0Q462 178 573 178Q682 178 733.5 235.0Q785 292 785 420Z"],"9":[556,"M1063 727Q1063 352 926.0 166.0Q789 -20 537 -20Q351 -20 245.5 59.5Q140 139 96 311L360 348Q399 201 540 201Q658 201 721.5 314.0Q785 427 787 649Q749 574 662.5 531.5Q576 489 476 489Q352 489 261.0 546.5Q170 604 120.5 709.0Q71 814 71 958Q71 1180 199.5 1305.0Q328 1430 563 1430Q816 1430 939.5 1254.5Q1063 1079 1063 727ZM766 924Q766 1055 708.5 1132.5Q651 1210 556 1210Q463 1210 409.5 1142.5Q356 1075 356 956Q356 839 409.0 768.5Q462 698 557 698Q617 698 664.0 726.0Q711 754 738.5 805.0Q766 856 766 924Z"],"a":[556,"M393 -20Q236 -20 148.0 65.5Q60 151 60 306Q60 474 169.5 561.0Q279 648 487 652L720 656V711Q720 817 683.0 868.5Q646 920 562 920Q484 920 447.5 884.5Q411 849 402 767L109 781Q164 1102 574 1102Q779 1102 890.0 1001.0Q1001 900 1001 714V320Q1001 229 1021.5 194.5Q1042 160 1090 160Q1122 160 1152 166V14Q1100 1 1063.0 -5.5Q1026 -12 972 -12Q866 -12 815.5 40.0Q765 92 755 193H749Q690 87 601.0 33.5Q512 -20 393 -20ZM720 501 576 499Q477 494 437 478Q396 460 374.5 424.0Q353 388 353 328Q353 251 388.5 213.5Q424 176 483 176Q549 176 604 212Q658 248 689.0 311.5Q720 375 720 446Z"],"b":[611,"M1167 545Q1167 277 1059.5 128.5Q952 -20 752 -20Q637 -20 553.0 30.0Q469 80 424 174H422Q422 151 420.0 114.0Q418 77 415.0 44.5Q412 12 408 0H135Q139 47 141.0 108.5Q143 170 143 247V1484H424V1070Q424 1026 422.5 982.0Q421 938 420 894H424Q471 998 558.0 1050.0Q645 1102 770 1102Q962 1102 1064.5 956.5Q1167 811 1167 545ZM874 545Q874 729 820.0 818.0Q766 907 653 907Q539 907 479.5 811.5Q420 716 420 536Q420 364 478.5 268.0Q537 172 651 172Q763 172 818.5 265.0Q874 358 874 545Z"],"c":[556,"M594 -20Q348 -20 214.0 126.5Q80 273 80 535Q80 803 215.0 952.5Q350 1102 598 1102Q789 1102 914.0 1006.0Q1039 910 1071 741L788 727Q776 810 728.0 859.5Q680 909 592 909Q483 909 429.0 818.5Q375 728 375 546Q375 359 430.5 265.5Q486 172 596 172Q676 172 730.0 222.5Q784 273 797 373L1079 360Q1064 246 998.5 160.5Q933 75 829.0 27.5Q725 -20 594 -20Z"],"d":[611,"M844 0Q842 10 838.0 42.0Q834 74 831.5 112.0Q829 150 829 176H825Q779 78 693.0 29.0Q607 -20 479 -20Q290 -20 187.0 127.5Q84 275 84 540Q84 809 192.5 955.5Q301 1102 500 1102Q615 1102 698.5 1054.0Q782 1006 827 911H829L827 1089V1484H1108V236Q1108 186 1110.0 127.0Q1112 68 1116 0ZM377 540Q377 356 432.5 264.0Q488 172 598 172Q709 172 770.0 269.5Q831 367 831 547Q831 722 772.5 816.5Q714 911 600 911Q487 911 432.0 819.5Q377 728 377 540Z"],"e":[556,"M375 487Q375 329 433.5 248.5Q492 168 600 168Q674 168 721.5 200.5Q769 233 788 297L1053 274Q938 -20 586 -20Q342 -20 211.0 124.5Q80 269 80 546Q80 814 213.0 958.0Q346 1102 590 1102Q823 1102 946.0 947.5Q1069 793 1069 495V487ZM797 663Q789 794 734.0 859.5Q679 925 586 925Q487 925 433.5 856.0Q380 787 377 663Z"],"f":[333,"M473 892V0H193V892H35V1082H193V1195Q193 1342 271.0 1413.0Q349 1484 508 1484Q590 1484 686 1468V1287Q646 1296 604 1296Q532 1296 502.5 1267.5Q473 1239 473 1167V1082H686V892Z"],"g":[611,"M596 -434Q398 -434 277.5 -358.5Q157 -283 129 -143L410 -110Q425 -175 474.5 -212.0Q524 -249 604 -249Q721 -249 775.0 -177.0Q829 -105 829 37L831 201H829Q783 101 696.0 51.5Q609 2 481 2Q292 2 188.0 144.0Q84 286 84 550Q84 815 191.0 959.0Q298 1103 502 1103Q620 1103 701.5 1054.5Q783 1006 829 908H834Q834 932 836.0 968.0Q838 1004 841.5 1037.0Q845 1070 848 1082H1114Q1108 974 1108 832V33Q1108 -198 977.0 -316.0Q846 -434 596 -434ZM831 556Q831 723 771.5 816.5Q712 910 602 910Q490 910 433.5 820.0Q377 730 377 550Q377 374 432.5 285.5Q488 197 600 197Q712 197 771.5 290.5Q831 384 831 556Z"],"h":[611,"M420 866Q477 990 563.0 1046.0Q649 1102 768 1102Q940 1102 1032.0 996.0Q1124 890 1124 686V0H844V606Q844 749 796.0 820.0Q748 891 651 891Q549 891 486.5 803.5Q424 716 424 579V0H143V1484H424V1079Q424 1043 423.0 1007.0Q422 971 420.5 936.0Q419 901 416 866Z"],"i":[278,"M424 1484V1277H143V1484ZM424 1082V0H143V1082Z"],"j":[278,"M425 1484V1277H144V1484ZM138 -425Q39 -425 -32 -416V-218Q-19 -219 -6.5 -220.5Q6 -222 19 -222Q91 -222 117.5 -190.5Q144 -159 144 -60V1082H425V-128Q425 -271 352.5 -348.0Q280 -425 138 -425Z"],"k":[556,"M424 406V0H143V1484H424V634L810 1082H1112L732 660L1141 0H834L545 490Z"],"l":[278,"M424 1484V0H143V1484Z"],"m":[889,"M424 580V0H143V840Q143 927 140.5 982.5Q138 1038 135 1082H403Q405 1070 408.0 1025.5Q411 981 413.5 934.5Q416 888 416 867H420Q472 991 549.5 1047.0Q627 1103 735 1103Q859 1103 934.5 1044.0Q1010 985 1036 867H1042Q1097 993 1174.0 1048.0Q1251 1103 1370 1103Q1528 1103 1611.0 995.5Q1694 888 1694 687V0H1415V607Q1415 750 1374.0 821.0Q1333 892 1251 892Q1169 892 1114.0 812.5Q1059 733 1059 593V0H780V607Q780 750 739.0 821.0Q698 892 616 892Q531 892 477.5 805.0Q424 718 424 580Z"],"n":[611,"M424 580V0H143V840Q143 927 140.5 982.5Q138 1038 135 1082H403Q405 1070 408.0 1025.5Q411 981 413.5 934.5Q416 888 416 867H420Q477 991 563.0 1047.0Q649 1103 768 1103Q940 1103 1032.0 997.0Q1124 891 1124 687V0H844V607Q844 750 796.0 821.0Q748 892 651 892Q549 892 486.5 804.5Q424 717 424 580Z"],"o":[611,"M1171 542Q1171 279 1025.0 129.5Q879 -20 621 -20Q368 -20 224.0 130.0Q80 280 80 542Q80 803 224.0 952.5Q368 1102 627 1102Q892 1102 1031.5 957.5Q1171 813 1171 542ZM877 542Q877 735 814.0 822.0Q751 909 631 909Q503 909 439.0 817.5Q375 726 375 542Q375 361 437.5 266.5Q500 172 618 172Q748 172 812.5 264.5Q877 357 877 542Z"],"p":[611,"M1167 546Q1167 275 1058.5 127.5Q950 -20 752 -20Q517 -20 424 172H418Q424 142 424 -10V-425H143V833Q143 910 141.0 972.0Q139 1034 135 1082H408Q412 1070 414.5 1041.5Q417 1013 418.5 977.0Q420 941 420 906H424Q471 1006 558.0 1055.5Q645 1105 770 1105Q959 1105 1063.0 959.5Q1167 814 1167 546ZM874 546Q874 728 818.5 819.0Q763 910 651 910Q539 910 479.5 812.0Q420 714 420 538Q420 363 479.5 267.5Q539 172 649 172Q762 172 818.0 265.5Q874 359 874 546Z"],"q":[611,"M84 540Q84 808 193.5 955.5Q303 1103 502 1103Q620 1103 701.5 1054.5Q783 1006 829 908Q829 939 831.5 975.5Q834 1012 838.0 1042.0Q842 1072 844 1082H1114Q1111 1028 1109.5 966.0Q1108 904 1108 833V-425H829V25L834 180H832Q786 80 697.5 30.0Q609 -20 479 -20Q290 -20 187.0 127.5Q84 275 84 540ZM831 546Q831 719 773.0 814.5Q715 910 602 910Q490 910 433.5 817.5Q377 725 377 540Q377 356 432.5 264.0Q488 172 600 172Q710 172 770.5 269.5Q831 367 831 546Z"],"r":[389,"M424 531V0H143V828Q143 917 140.5 976.5Q138 1036 135 1082H403Q405 1073 407.0 1042.0Q409 1011 411.0 972.5Q413 934 414.5 900.0Q416 866 416 851H420Q460 963 493 1012Q525 1059 569.0 1081.0Q613 1103 679 1103Q733 1103 766 1088V853Q699 868 646 868Q541 868 482.5 783.0Q424 698 424 531Z"],"s":[556,"M1055 316Q1055 159 926.5 69.5Q798 -20 571 -20Q348 -20 229.5 50.5Q111 121 72 270L319 307Q340 230 391.5 198.0Q443 166 571 166Q689 166 743.0 196.0Q797 226 797 290Q797 342 753.5 372.5Q710 403 606 424Q527 440 464.5 455.0Q402 470 357.5 484.5Q313 499 285 512Q202 553 158.5 617.0Q115 681 115 775Q115 930 234.5 1016.5Q354 1103 573 1103Q766 1103 883.5 1028.0Q1001 953 1030 811L781 785Q769 851 722.0 883.5Q675 916 573 916Q473 916 423.0 890.5Q373 865 373 805Q373 758 411.5 730.5Q450 703 541 685Q668 659 766.5 631.5Q865 604 925 566Q984 528 1019.5 468.5Q1055 409 1055 316Z"],"t":[333,"M657 16Q555 -18 420 -18Q296 -18 229.0 49.5Q162 117 162 254V892H25V1082H176L264 1336H440V1082H645V892H440V330Q440 251 470.0 213.5Q500 176 563 176Q593 176 657 190Z"],"u":[611,"M831 215Q775 92 688.5 36.0Q602 -20 483 -20Q311 -20 219.0 85.5Q127 191 127 395V1082H408V475Q408 333 456.0 261.5Q504 190 600 190Q702 190 764.5 277.5Q827 365 827 502V1082H1108V242Q1108 173 1110.0 112.5Q1112 52 1116 0H848Q842 72 839.0 126.0Q836 180 836 215Z"],"v":[556,"M1130 1082 731 0H395L8 1082H305L494 477Q502 452 520 390L565 227Q569 241 581.5 283.0Q594 325 609.0 375.0Q624 425 635 459L836 1082Z"],"w":[778,"M745 658 571 0H274L-6 1082H258L396 442Q406 396 416 349L436 255Q446 303 454.0 351.0Q462 399 475 446L645 1082H946L1112 446Q1119 420 1129.5 372.5Q1140 325 1153 255Q1164 303 1174.5 350.5Q1185 398 1195 446L1337 1082H1597L1313 0H1016L844 660Q838 683 826.0 738.5Q814 794 797 882Q784 826 772.0 770.0Q760 714 745 658Z"],"x":[556,"M567 392 313 0H14L410 559L33 1082H336L567 728L797 1082H1102L725 562L1124 0H819Z"],"y":[556,"M283 -425Q180 -425 106 -412V-212Q162 -220 203 -220Q301 -220 349.5 -167.0Q398 -114 444 11L16 1082H313L483 575Q503 520 528.0 437.0Q553 354 584 241Q607 333 628.0 411.0Q649 489 674 571L834 1082H1128L700 -57Q674 -126 645.0 -179.0Q616 -232 586 -273Q525 -356 453.0 -390.5Q381 -425 283 -425Z"],"z":[500,"M950 205V0H82V199L591 879H123V1082H901V881L395 205Z"],"A":[722,"M471 360 346 0H51L565 1409H913L1425 0H1133L1008 360ZM739 1192Q729 1152 711.0 1096.0Q693 1040 685 1017L537 582H942L790 1026Q776 1067 764.0 1109.0Q752 1151 739 1192Z"],"B":[722,"M1386 402Q1386 210 1242.0 105.0Q1098 0 842 0H137V1409H782Q1040 1409 1172.5 1319.5Q1305 1230 1305 1055Q1305 935 1238.5 852.5Q1172 770 1036 741Q1207 721 1296.5 633.5Q1386 546 1386 402ZM1008 1015Q1008 1110 947.5 1150.0Q887 1190 768 1190H432V841H770Q895 841 951.5 884.5Q1008 928 1008 1015ZM1090 425Q1090 623 806 623H432V219H817Q959 219 1024.5 270.5Q1090 322 1090 425Z"],"C":[722,"M795 212Q1063 212 1166 480L1423 383Q1340 179 1179.5 79.5Q1019 -20 795 -20Q569 -20 410.0 66.5Q251 153 167.5 317.0Q84 481 84 711Q84 943 164.0 1103.0Q244 1263 400.0 1346.5Q556 1430 782 1430Q1030 1430 1186.0 1330.5Q1342 1231 1405 1038L1145 967Q1112 1073 1015.5 1135.5Q919 1198 788 1198Q588 1198 484.5 1074.0Q381 950 381 711Q381 549 428.5 438.0Q476 327 568.5 269.5Q661 212 795 212Z"],"D":[722,"M1393 715Q1393 489 1305.5 329.0Q1218 169 1063.5 84.5Q909 0 707 0H137V1409H647Q1003 1409 1198.0 1229.5Q1393 1050 1393 715ZM1096 715Q1096 942 978.0 1061.5Q860 1181 641 1181H432V228H682Q809 228 901.5 287.5Q994 347 1045.0 456.0Q1096 565 1096 715Z"],"E":[667,"M1286 228V0H137V1409H1245V1181H432V827H1184V599H432V228Z"],"F":[611,"M432 517V0H137V1409H1176V1181H432V745H1153V517Z"],"G":[778,"M806 211Q921 211 1029.0 244.5Q1137 278 1196 330V525H852V743H1466V225Q1354 110 1174.5 45.0Q995 -20 798 -20Q569 -20 409.5 65.5Q250 151 167.0 314.5Q84 478 84 711Q84 1059 270.0 1244.5Q456 1430 805 1430Q1053 1430 1211.0 1338.5Q1369 1247 1436 1063L1164 981Q1120 1088 1026.0 1143.0Q932 1198 805 1198Q597 1198 489.0 1072.0Q381 946 381 711Q381 472 492.5 341.5Q604 211 806 211Z"],"H":[722,"M432 604V0H137V1409H432V848H1046V1409H1341V0H1046V604Z"],"I":[278,"M432 1409V0H137V1409Z"],"J":[556,"M524 -20Q305 -20 187.5 75.0Q70 170 31 382L324 425Q342 316 391.0 263.5Q440 211 526 211Q614 211 659.5 270.0Q705 329 705 439V1178H424V1409H999V446Q999 226 874.0 103.0Q749 -20 524 -20Z"],"K":[722,"M432 514V0H137V1409H432V770L1067 1409H1411L809 813L1460 0H1112L606 647Z"],"L":[611,"M1188 228V0H137V1409H432V228Z"],"M":[833,"M399 854V0H137V1409H532L784 621Q801 555 819.0 488.5Q837 422 854 356Q865 394 875.0 431.5Q885 469 895.5 507.0Q906 545 917 582L1176 1409H1569V0H1307V854Q1307 883 1309.5 970.5Q1312 1058 1317 1161Q1282 1027 1255.5 933.0Q1229 839 1212 786L958 0H748L494 786L387 1161Q393 1045 396.0 968.5Q399 892 399 854Z"],"N":[722,"M399 831V0H137V1409H474L1097 315Q1079 467 1079 590V1409H1341V0H995L381 1085Q390 1006 394.5 942.5Q399 879 399 831Z"],"O":[778,"M1507 711Q1507 491 1418.5 326.5Q1330 162 1169.5 71.0Q1009 -20 793 -20Q572 -20 413.0 68.5Q254 157 169.0 321.0Q84 485 84 711Q84 937 168.5 1098.0Q253 1259 412.5 1344.5Q572 1430 795 1430Q1019 1430 1178.0 1343.5Q1337 1257 1422.0 1096.0Q1507 935 1507 711ZM1206 711Q1206 939 1098.0 1068.5Q990 1198 795 1198Q597 1198 489.0 1069.5Q381 941 381 711Q381 557 431.0 445.0Q481 333 573.5 272.5Q666 212 793 212Q991 212 1098.5 342.0Q1206 472 1206 711Z"],"P":[667,"M1296 963Q1296 826 1233.5 720.5Q1171 615 1056.0 555.5Q941 496 782 496H432V0H137V1409H770Q1023 1409 1159.5 1292.5Q1296 1176 1296 963ZM999 958Q999 1180 737 1180H432V723H745Q867 723 933.0 783.5Q999 844 999 958Z"],"Q":[778,"M1507 711Q1507 523 1444.5 376.0Q1382 229 1265.0 133.5Q1148 38 983 4Q1017 -95 1078.5 -139.0Q1140 -183 1251 -183Q1313 -183 1370 -173L1368 -375Q1244 -403 1126 -403Q963 -403 856.0 -312.0Q749 -221 684 -10Q494 8 360.0 100.0Q226 192 155.0 347.5Q84 503 84 711Q84 937 168.5 1098.0Q253 1259 412.5 1344.5Q572 1430 795 1430Q1019 1430 1178.0 1343.5Q1337 1257 1422.0 1096.0Q1507 935 1507 711ZM1206 711Q1206 939 1098.0 1068.5Q990 1198 795 1198Q597 1198 489.0 1069.5Q381 941 381 711Q381 557 430.5 444.5Q480 332 572.5 271.5Q665 211 793 211Q991 211 1098.5 341.0Q1206 471 1206 711Z"],"R":[722,"M432 535V0H137V1409H841Q1093 1409 1230.0 1300.5Q1367 1192 1367 989Q1367 841 1283.0 733.5Q1199 626 1056 592L1437 0H1105L778 535ZM1070 977Q1070 1078 1005.0 1129.0Q940 1180 810 1180H432V764H818Q942 764 1006.0 820.0Q1070 876 1070 977Z"],"S":[667,"M1286 406Q1286 199 1132.5 89.5Q979 -20 682 -20Q147 -20 59 367L344 414Q373 302 457.0 251.5Q541 201 690 201Q845 201 922.0 248.0Q999 295 999 389Q999 449 964.0 488.0Q929 527 864 553Q832 566 770.0 581.5Q708 597 616 616Q510 641 450.0 658.5Q390 676 354.0 692.5Q318 709 284 729Q209 774 167.0 849.0Q125 924 125 1036Q125 1227 268.5 1328.5Q412 1430 686 1430Q948 1430 1079.5 1348.0Q1211 1266 1249 1077L963 1038Q941 1129 873.5 1175.0Q806 1221 680 1221Q546 1221 479.0 1179.0Q412 1137 412 1053Q412 998 440.5 963.0Q469 928 525 903Q578 879 752 842Q853 820 926.0 800.5Q999 781 1043 763Q1087 744 1121.5 723.0Q1156 702 1181 678Q1232 629 1259.0 561.5Q1286 494 1286 406Z"],"T":[611,"M773 1181V0H478V1181H23V1409H1229V1181Z"],"U":[722,"M723 -20Q529 -20 395.0 43.5Q261 107 192.0 229.5Q123 352 123 528V1409H418V551Q418 384 497.5 297.5Q577 211 731 211Q889 211 974.0 301.5Q1059 392 1059 561V1409H1354V543Q1354 365 1279.5 239.0Q1205 113 1064.0 46.5Q923 -20 723 -20Z"],"V":[667,"M1352 1409 834 0H535L14 1409H322L612 504Q626 460 644.5 393.5Q663 327 686 238Q719 363 733.5 419.0Q748 475 758 504L1047 1409Z"],"W":[944,"M909 834 715 0H365L2 1409H301L497 546Q510 491 525.5 419.0Q541 347 551 279Q561 326 569.5 370.5Q578 415 587.0 458.5Q596 502 606 545L805 1409H1135L1332 576Q1342 534 1356.5 454.0Q1371 374 1384 279Q1397 337 1408 382L1429 471Q1439 515 1451 572L1632 1409H1931L1567 0H1217L1026 815Q1009 887 994.0 962.0Q979 1037 967 1116Q959 1073 947.0 1015.0Q935 957 924.5 907.0Q914 857 909 834Z"],"X":[667,"M684 561 330 0H18L506 741L59 1409H371L684 911L997 1409H1307L879 741L1348 0H1038Z"],"Y":[667,"M831 578V0H537V578L35 1409H344L682 813L1024 1409H1333Z"],"Z":[611,"M1192 231V0H61V209L823 1178H137V1409H1151V1204L389 231Z"]," ":[278,""],"/":[278,"M549 1484 263 -41H20L311 1484Z"],".":[278,"M428 305V0H139V305Z"],"-":[333,"M600 653V409H80V653Z"],"_":[556,"M1157 -172V-250H-20V-172Z"],"(":[333,"M399 -425Q295 -274 229.0 -125.5Q163 23 132.5 184.0Q102 345 102 531Q102 717 132.5 877.5Q163 1038 229.0 1186.0Q295 1334 399 1484H680Q522 1256 450.5 1030.0Q379 804 379 530Q379 348 410.0 189.0Q441 30 507.5 -119.5Q574 -269 680 -425Z"],")":[333,"M2 -425Q109 -269 175.0 -119.5Q241 30 272.0 189.0Q303 348 303 530Q303 805 231.0 1031.5Q159 1258 2 1484H283Q389 1333 454.0 1184.0Q519 1035 549.5 875.0Q580 715 580 531Q580 346 549.5 185.5Q519 25 454.0 -124.0Q389 -273 283 -425Z"],"#":[556,"M344 381 264 0H111L190 381H35V530H223L293 862H86V1010H324L408 1395H561L479 1010H786L870 1395H1026L942 1010H1106V862H909L840 530H1055V381H809L727 0H571L651 381ZM377 530H686L756 862H449Z"],":":[333,"M485 1034V752H197V1034ZM485 281V0H197V281Z"]}}};
function outlineWidth(str, size, wt) {
  const F = OUTLINE_FONT[wt || 'r'];
  return [...str].reduce((a, ch) => a + ((F.g[ch] || F.g[' '] || [500])[0]), 0) / 1000 * size;
}
function outlineText(str, x, y, size, wt) {
  const F = OUTLINE_FONT[wt || 'r'], k = size / F.upm, sc = F.upm / 1000;
  let ox = 0, out = '';
  const f = v => +v.toFixed(1);
  for (const ch of str) {
    const gl = F.g[ch] || F.g[' ']; if (!gl) continue;
    const toks = (gl[1] || '').match(/[MLHVQCZ]|-?[\d.]+/g) || [];
    let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0;
    const num = () => +toks[i++];
    while (i < toks.length) {
      if (/[MLHVQCZ]/.test(toks[i])) cmd = toks[i++];
      if (cmd === 'M') { cx = num(); cy = num(); sx = cx; sy = cy; out += `${f(cx + ox)} ${f(cy)} m `; cmd = 'L'; }
      else if (cmd === 'L') { cx = num(); cy = num(); out += `${f(cx + ox)} ${f(cy)} l `; }
      else if (cmd === 'H') { cx = num(); out += `${f(cx + ox)} ${f(cy)} l `; }
      else if (cmd === 'V') { cy = num(); out += `${f(cx + ox)} ${f(cy)} l `; }
      else if (cmd === 'Q') { const qx = num(), qy = num(), x2 = num(), y2 = num();
        out += `${f(cx + 2 / 3 * (qx - cx) + ox)} ${f(cy + 2 / 3 * (qy - cy))} ${f(x2 + 2 / 3 * (qx - x2) + ox)} ${f(y2 + 2 / 3 * (qy - y2))} ${f(x2 + ox)} ${f(y2)} c `; cx = x2; cy = y2; }
      else if (cmd === 'C') { const a = [num(), num(), num(), num(), num(), num()];
        out += `${f(a[0] + ox)} ${f(a[1])} ${f(a[2] + ox)} ${f(a[3])} ${f(a[4] + ox)} ${f(a[5])} c `; cx = a[4]; cy = a[5]; }
      else if (cmd === 'Z') { out += 'h '; cx = sx; cy = sy; cmd = ''; }
      else i++;
    }
    ox += gl[0] * sc;
  }
  return out ? `q 0 0 0 1 k ${k.toFixed(6)} 0 0 ${k.toFixed(6)} ${x.toFixed(3)} ${y.toFixed(3)} cm\n${out}f\nQ\n` : '';
}

// groups[i].bytes = single-page pdf of the sign
// label: e.g. "26006897 tamnon magneti A3" – goes 5 cm left of the 2nd bottom dot (print file only)
async function buildLayoutPdfs(groups, o, label, PDFLib) {
  for (const g of groups) if (!g.w) { const d = await PDFLib.PDFDocument.load(g.bytes); const { width, height } = d.getPage(0).getSize(); g.w = width; g.h = height; }
  const sheets = planLayout(groups, o);
  const pr = await PDFLib.PDFDocument.create(), cu = await PDFLib.PDFDocument.create(), pf = await PDFLib.PDFDocument.create();
  const prL = layerKit(PDFLib, pr), cuL = layerKit(PDFLib, cu), pfL = layerKit(PDFLib, pf);
  const emb = {}, embP = {};
  for (let si = 0; si < sheets.length; si++) {
    const s = sheets[si];
    const p = pr.addPage([s.W, s.H]), c = cu.addPage([s.W, s.H]), f = pf.addPage([s.W, s.H]);
    const put = (pg, e, c) => c.rot
      ? pg.drawPage(e, { x: c.x + c.w, y: c.y, width: c.h, height: c.w, rotate: PDFLib.degrees(90) })
      : pg.drawPage(e, { x: c.x, y: c.y, width: c.w, height: c.h });
    for (const cell of s.cells) {
      if (!emb[cell.g]) [emb[cell.g]] = await pr.embedPdf(groups[cell.g].bytes, [0]);
      if (!embP[cell.g]) [embP[cell.g]] = await pf.embedPdf(groups[cell.g].bytes, [0]);
    }
    // bleed: on every side that has no neighbour, a slightly enlarged copy under the sign, clipped to b
    const b = (o.bleed != null ? o.bleed : LAYOUT_DEF.bleed) * CM;
    if (b > 0) {
      // free room on a side = distance to the nearest sign there; bleed = min(b, half of it)
      const room = (c, dx, dy) => {
        let m = Infinity;
        for (const z of s.cells) {
          if (z === c) continue;
          if (dx && z.y < c.y + c.h - 0.5 && z.y + z.h > c.y + 0.5) { const dd = dx > 0 ? z.x - (c.x + c.w) : c.x - (z.x + z.w); if (dd > -0.5) m = Math.min(m, Math.max(0, dd)); }
          if (dy && z.x < c.x + c.w - 0.5 && z.x + z.w > c.x + 0.5) { const dd = dy > 0 ? z.y - (c.y + c.h) : c.y - (z.y + z.h); if (dd > -0.5) m = Math.min(m, Math.max(0, dd)); }
        }
        return m < 0.5 ? 0 : Math.min(b, m / 2);
      };
      for (const c of s.cells) {
        const l = room(c, -1, 0), r = room(c, 1, 0), d = room(c, 0, -1), u = room(c, 0, 1);
        if (!l && !r && !d && !u) continue;
        const big = { ...c, x: c.x - b, y: c.y - b, w: c.w + 2 * b, h: c.h + 2 * b };
        for (const [pg, e] of [[p, emb[c.g]], [f, embP[c.g]]]) {
          pg.pushOperators(PDFLib.pushGraphicsState(), PDFLib.rectangle(c.x - l, c.y - d, c.w + l + r, c.h + d + u), PDFLib.clip(), PDFLib.endPath());
          put(pg, e, big);
          pg.pushOperators(PDFLib.popGraphicsState());
        }
      }
    }
    for (const cell of s.cells) { put(p, emb[cell.g], cell); put(f, embP[cell.g], cell); }
    const txt = `${String(label).replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim()}${s.collect ? ' hashlamot' : ''}   sheet ${si + 1}/${sheets.length} x ${s.copies}`;
    let texts = '';
    if (s.collect) { const big = 'HASHLAMOT', bs = 40; texts += outlineText(big, (s.W - outlineWidth(big, bs, 'b')) / 2, s.H - 1.0 * CM - bs * 0.72, bs, 'b'); }
    const size = 16, dot2 = s.W - 0.2 * CM - 0.6 * CM - 5.08 * CM;           // left edge of the 2nd bottom dot
    texts += outlineText(txt, Math.max(1.2 * CM, dot2 - 5 * CM - outlineWidth(txt, size)), 0.5 * CM - size * 0.35, size);
    const marks = `q /OC /Pr1 BDC /CSall cs 1 scn\n${regMarks(s.W, s.H)}\nEMC Q\n`;
    prL(p, texts + marks);
    const rects = s.cells.map(z => `${z.x.toFixed(3)} ${z.y.toFixed(3)} ${z.w.toFixed(3)} ${z.h.toFixed(3)} re S`).join('\n');
    cuL(c, `${marks}q /OC /Pr2 BDC /CScut CS 1 SCN 1 w 0 J 0 j\n${rects}\nEMC Q\n`);
    // proof: graphics + cut lines on top – for checking only, not for the machine
    pfL(f, `${texts}${marks}q /OC /Pr2 BDC /CScut CS 1 SCN 2 w 0 J 0 j\n${rects}\nEMC Q\n`);
  }
  // one print file per sheet (for the RIP): same page, its own layers
  const printSheets = [];
  if (o.splitPrint) for (let i = 0; i < sheets.length; i++) {
    const d = await PDFLib.PDFDocument.create();
    const [pg] = await d.copyPages(pr, [i]); d.addPage(pg);
    const props = pg.node.normalizedEntries().Resources.lookup(PDFLib.PDFName.of('Properties'));
    if (props) {
      const reg = props.get(PDFLib.PDFName.of('Pr1')), cut = props.get(PDFLib.PDFName.of('Pr2'));
      d.catalog.set(PDFLib.PDFName.of('OCProperties'), d.context.obj({ OCGs: [cut, reg], D: { Order: [cut, reg], ON: [cut, reg] } }));
    }
    printSheets.push({ bytes: await d.save(), copies: sheets[i].copies, no: i + 1, collect: !!sheets[i].collect });
  }
  return { print: await pr.save(), printSheets, cut: await cu.save(), proof: await pf.save(), sheets: sheets.map(s => ({ w: s.W / CM, h: s.H / CM, n: s.cells.length, copies: s.copies, collect: !!s.collect })) };
}

/* ================================================================ REPORT (xlsx) */
async function buildReport(plan, tabs, so, ExcelJS) {
  const wb = new ExcelJS.Workbook();
  const rtl = { views: [{ rightToLeft: true }] };
  const head = ws => { ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' } }; };

  const s1 = wb.addWorksheet('קבצים', rtl);
  s1.columns = [{ header: 'מכונה', width: 12 }, { header: 'סוג', width: 22 }, { header: 'שם קובץ', width: 55 }, { header: 'כמות', width: 8 }, { header: 'הערה', width: 30 }];
  MACHINES.forEach(mc => plan.items.filter(i => i.machine === mc).forEach(i => s1.addRow([mc, i.tab, i.name, i.qty, i.kind === 'ok' ? '' : (i.kind === 'swap' ? 'צבע הוחלף – לבדוק' : i.kind === 'trim' ? 'מילים הוסרו – לבדוק' : 'מספר שונה – לבדוק')])));
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
  formatLabel, makeName, toEnglish, EN_PHRASES, EN_WORDS, readTableXlsx, readSO, analyzeArtwork, matchTab, buildPlan, sameSize, matchWords, buildItemPdf, buildReport, fileSafe, planLayout, buildLayoutPdfs, layoutWidthFor, layoutCollectFor, layoutKind, layoutKindOfSize, LAYOUT_DEF };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TamnunCore = api;
})(typeof self !== 'undefined' ? self : this);
