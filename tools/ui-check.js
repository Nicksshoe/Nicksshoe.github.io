// Screen walkthrough for Potential Damage: plays a Free Play run on its own and checks every screen.
// Run on the game page (local server or live), in the browser console:
//   (await import('/tools/ui-check.js')).run()
// Resize the window (or use a phone viewport) to check phone widths; tap-target sizes are only checked under 560px.
// It starts a new Free Play run, so use it on the local server, or accept that it replaces your current run.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => document.querySelector(s);
const visible = el => !!(el.offsetParent || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';

// ---- colour helpers (WCAG relative luminance) ----
const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
const lum = ({ r, g, b }) => [r, g, b].map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
function backgroundOf(el) { // nearest ancestor with an opaque background colour; null if a gradient or image is in the way
  for (let n = el; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    const c = parse(cs.backgroundColor); if (c && c.a > 0.9) return c;
    if (cs.backgroundImage && cs.backgroundImage !== 'none' && n !== document.body) return null; // can't measure a gradient: skip
  }
  return parse(getComputedStyle(document.body).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
}

export function checkScreen(name) {
  const issues = [];
  const phone = innerWidth < 560;
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) issues.push('sideways scroll');
  if (phone) for (const el of document.querySelectorAll('button, a[href], select, input, textarea')) {
    if (!visible(el)) continue;
    const h = el.getBoundingClientRect().height, inPill = el.closest('.pill');
    if (h < 40 && !(inPill && inPill.getBoundingClientRect().height >= 40)) issues.push(`small tap target (${Math.round(h)}px): ${el.id || el.textContent.trim().slice(0, 24)}`);
  }
  // Text contrast: every element that directly holds text, against its real background.
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || ['SCRIPT', 'STYLE', 'OPTION'].includes(el.tagName)) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el), fg = parse(cs.color); if (!fg || fg.a < 0.5 || +cs.opacity < 0.5) continue;
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700, large = size >= 24 || (bold && size >= 18.66);
    const bg = backgroundOf(el); if (!bg) continue;
    const r = ratio(fg, bg), need = large ? 3 : 4.5;
    const key = `${cs.color}|${r.toFixed(1)}`;
    if (r < need && !seen.has(key)) { seen.add(key); issues.push(`contrast ${r.toFixed(2)} < ${need}: "${el.textContent.trim().slice(0, 30)}"`); }
    if (size < 11 && !seen.has('tiny' + el.textContent)) { seen.add('tiny' + el.textContent); issues.push(`text under 11px (${size}px): "${el.textContent.trim().slice(0, 30)}"`); }
  }
  // Headings: exactly one h1, no skipped levels.
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map(h => +h.tagName[1]);
  if (hs.filter(l => l === 1).length !== 1) issues.push(`${hs.filter(l => l === 1).length} h1 headings (want 1)`);
  hs.forEach((l, i) => { if (i && l > hs[i - 1] + 1) issues.push(`heading jumps h${hs[i - 1]} -> h${l}`); });
  // Form fields need a label (aria-label, aria-labelledby, <label for>, or a wrapping <label>).
  for (const f of document.querySelectorAll('input, select, textarea')) {
    if (!visible(f)) continue;
    const ok = f.getAttribute('aria-label') || f.getAttribute('aria-labelledby') || f.closest('label') || (f.id && document.querySelector(`label[for="${f.id}"]`));
    if (!ok) issues.push(`unlabelled field: ${f.id || f.tagName.toLowerCase()}`);
  }
  for (const img of document.querySelectorAll('img')) if (visible(img) && !img.hasAttribute('alt')) issues.push(`image without alt: ${img.src.split('/').pop()}`);
  return { screen: name, width: innerWidth, theme: document.documentElement.dataset.theme || 'classic', issues: [...new Set(issues)] };
}

async function waitFor(fn, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(150); } return null; }

export async function run() {
  const report = [];
  const realConfirm = window.confirm; window.confirm = () => true; // "Start over" asks first
  try {
    const back = $('#lbBack'); if (back) { back.click(); await sleep(800); }
    $('[data-mode=free]').click(); await sleep(1200);
    if (!$('.cards.champs')) { const r = $('#resetBtn'); if (r) { r.click(); await waitFor(() => $('.cards.champs')); } }
    await waitFor(() => $('.cards.champs .card')); await sleep(600);
    report.push(checkScreen('champion pick'));
    $('.cards.champs .card').click(); await waitFor(() => $('.cards.items .card')); await sleep(500);
    report.push(checkScreen('item pick'));
    for (let i = 0; i < 6; i++) { const c = $('.cards.items .card'); if (!c) break; c.click(); await sleep(500); }
    await waitFor(() => $('#hpfill')); await sleep(800);
    report.push(checkScreen('fight'));
    const skip = [...document.querySelectorAll('button')].find(b => /skip/i.test(b.textContent)); if (skip) skip.click();
    await waitFor(() => $('.result-hero')); await sleep(800);
    report.push(checkScreen('results'));
    $('#howBtn').click(); await sleep(600); report.push(checkScreen('how to play'));
    $('#reportLink').click(); await sleep(600); report.push(checkScreen('report a bug'));
    if (getComputedStyle($('#lbBtn')).visibility !== 'hidden') {
      $('#lbBtn').click(); await sleep(600); const all = $('[data-b=all]'); if (all) all.click();
      await waitFor(() => $('.lb-row') || $('.lb-lock'), 6000); await sleep(400);
      report.push(checkScreen('leaderboard'));
      const b = $('#lbBack'); if (b) b.click();
    }
  } finally { window.confirm = realConfirm; }
  const total = report.reduce((s, r) => s + r.issues.length, 0);
  console.table(report.map(r => ({ screen: r.screen, issues: r.issues.length })));
  for (const r of report) if (r.issues.length) console.warn(r.screen, r.issues);
  return { total, report };
}
