# Browser checks

Run these in the browser pane on the local server (http://localhost:5174/). Paste each block into the page's
JavaScript console (or the browser tool's JavaScript runner).

## Layout shift on load (target 0)

Load the page fresh (new URL so nothing is cached), wait about 5 seconds, then:

```js
const entries = await new Promise(res => { const out = []; new PerformanceObserver(l => out.push(...l.getEntries()))
  .observe({ type: 'layout-shift', buffered: true }); setTimeout(() => res(out), 300); });
const name = n => !n ? '?' : n.id ? '#' + n.id : (n.tagName || '').toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.split(' ')[0] : '');
({ total: entries.reduce((a, e) => a + (e.hadRecentInput ? 0 : e.value), 0).toFixed(3),
   shifts: entries.map(e => `${Math.round(e.startTime)}ms ${e.value.toFixed(3)} ` + (e.sources || []).map(s => `${name(s.node)} y${Math.round(s.previousRect.y)}->${Math.round(s.currentRect.y)}`).join(' | ')) })
```

The `shifts` list names what moved. Fix by reserving space for the late-loading thing, not by hiding it.

## Contrast of a colour pair

```js
const lum = h => { const c = [1,3,5].map(i => parseInt(h.slice(i,i+2),16)/255).map(v => v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4); return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return +((x+0.05)/(y+0.05)).toFixed(2); };
ratio('#a99cc4', '#0c0614')   // text needs 4.5, large text and controls 3
```

## Horizontal scroll and tap targets (phone, 375x812)

```js
({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
   small: [...document.querySelectorAll('button, a, select, input, textarea')].filter(e => e.offsetParent)
     .map(e => [e.id || e.textContent.trim().slice(0, 20), Math.round(e.getBoundingClientRect().height)])
     .filter(([, h]) => h < 40) })
```

## Theme and fonts actually loaded

```js
({ theme: document.documentElement.dataset.theme || 'classic',
   fontCss: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href.split('?')[1]),
   bungee: document.fonts.check('16px Bungee'), chakra: document.fonts.check('16px "Chakra Petch"') })
```

## Reduced motion

The browser pane can't switch the operating-system setting. Check that the rules exist, then ask the owner to test on a
phone (iPhone: Settings > Accessibility > Motion > Reduce Motion):

```js
[...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
  .filter(r => r.media && /reduced-motion/.test(r.media.mediaText)).length   // expect 1 or more
```
