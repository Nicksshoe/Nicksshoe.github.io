/* Theme for the Terms and Privacy pages: same choice as the game (index.html has the same check inline). Arcade is the
   default; ?theme=classic switches this browser back to the original look (remembered). */
(() => {
  const q = new URLSearchParams(location.search).get('theme');
  let saved = null;
  try { if (q === 'arcade' || q === 'classic') localStorage.setItem('potenshall:theme', q); saved = localStorage.getItem('potenshall:theme'); } catch {}
  const classic = (q || saved) === 'classic';
  if (!classic) document.documentElement.dataset.theme = 'arcade';
  // Light or dark, same setting and default as the game.
  const DEFAULT_MODE = 'dark';
  const qm = new URLSearchParams(location.search).get('mode'); let savedMode = null;
  try { if (qm === 'light' || qm === 'dark') localStorage.setItem('potenshall:mode', qm); savedMode = localStorage.getItem('potenshall:mode'); } catch {}
  if (!classic && ((qm || savedMode || DEFAULT_MODE) === 'light')) document.documentElement.dataset.mode = 'light';
})();
