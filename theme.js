/* Theme for the Terms and Privacy pages: same choice as the game (index.html has the same check inline). Arcade is the
   default; ?theme=classic switches this browser back to the original look (remembered). */
(() => {
  const q = new URLSearchParams(location.search).get('theme');
  let saved = null;
  try { if (q === 'arcade' || q === 'classic') localStorage.setItem('potenshall:theme', q); saved = localStorage.getItem('potenshall:theme'); } catch {}
  if ((q || saved) !== 'classic') document.documentElement.dataset.theme = 'arcade';
})();
