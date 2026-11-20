# Impeccable proposal for the live homepage

Status: proposal only. No production code in this pull request. Nothing here should be merged into the game until the owner has had it reviewed.

Reviewed page: `index.html` on `main` at `090dd28` (the page GitHub Pages is serving at https://potentialdamage.gg). Arcade is already the default. `?theme=classic` is the original gold-and-navy page, remembered in `localStorage` under `potenshall:theme`.

`DESIGN.md` and `.claude/skills/arcade-design/` are the design system. They say arcade is the direction, the 8px pink offset is one of three allowed shadows, and the page must not be restyled to look like the League client. This proposal follows that. It does not recommend replacing the homepage with the Freljord or Hextech previews.

## How this was scanned

Commands actually run, after `npx impeccable telemetry off`:

- `npx impeccable detect --json --viewport 1280x800 https://potentialdamage.gg` (rendered default, which is arcade). Exit 2.
- `npx impeccable detect --json index.html` (static file, so it also sees the classic rules). Exit 2.

`npx impeccable critique` and `npx impeccable audit` are not CLI commands. Both returned `Unknown command`. In `npx impeccable help` they appear only as harness skills (`/critique`, `/audit`) that `npx impeccable install` would copy into an agent. That install can also write hook manifests. Hooks were not installed, live mode was not started, and no agent was run with approvals off. There are therefore no critique or audit findings to add. The lists below are the detect output, plus a reading of `DESIGN.md` and `index.html`.

Detect counts advisories separately. They do not fail the command. The URL scan had 4 primary findings and 2 advisories. The file scan had 5 primary findings and 1 advisory.

## 1. Detect findings

### Rendered homepage (https://potentialdamage.gg, arcade default)

| | Rule | Where | What detect said |
|---|---|---|---|
| Primary | `undersized-ui-text` | `div.dummy-card > div:nth-of-type(1) > span` | 10px functional text "Health" |
| Primary | `undersized-ui-text` | `div.dummy-card > div:nth-of-type(2) > span` | 10px functional text "Armor" |
| Primary | `undersized-ui-text` | `div.dummy-card > div:nth-of-type(3) > span` | 10px functional text "Magic Res" |
| Primary | `gradient-text` | `body` | `background-clip: text` plus a gradient |
| Advisory | `hard-offset-shadow` | `aside.panel` | `box-shadow: rgb(255, 62, 165) 8px 8px 0` |
| Advisory | `hard-offset-shadow` | `#stage` | same pink 8px offset |

`rgb(255, 62, 165)` is `--pink` (`#ff3ea5`).

### Static `index.html` (classic rules are still in the file)

| | Rule | Snippet detect printed |
|---|---|---|
| Primary | `gradient-text` | `background-clip: text + gradient` (reported twice; the logo sets both `background-clip` and `-webkit-background-clip`) |
| Primary | `overused-font` | Primary font: Inter |
| Primary | `dark-glow` | Zero-offset box-shadow glow (`#c8aa6e`) |
| Primary | `radial-halo` | radial-gradient halo (`#2c3a22` to transparent) on a dark page |
| Advisory | `repeating-stripes-gradient` | repeating-gradient decorative stripes |

The rendered arcade page did not report Inter, the gold glow, or the green radial halo, because those rules are overridden while `data-theme="arcade"`. A static scan still sees them in the classic half of the stylesheet.

## 2. Proposed change for each finding

Do not apply these until they are accepted. Selectors are the ones in `index.html` today.

### 2.1 Health / Armor / Magic Res at 10px

Primary. Real on the default theme.

File: `index.html`, arcade block.

Current:

```css
html[data-theme=arcade] .dummy-card span{color:var(--gold);font-size:10px}
```

Proposed:

```css
html[data-theme=arcade] .dummy-card span{color:var(--gold);font-size:12px}
```

The unscoped classic rule is already 11px, which is on the detector's floor, not under it:

```css
.dummy-card span{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
```

Leave classic at 11px unless a later scan of `?theme=classic` flags it. 12px on arcade clears the 11px floor with a little room. Also add one line to `DESIGN.md` under Typography: dummy stat labels are 12px Chakra Petch, not 10px. The numbers above them stay Bungee.

The strings are not all as short as English. From `i18n.js`: German `Magieresistenz`, Dutch `Magische weerstand`, Russian `Сопр. магии`. At 12px those will wrap inside the three-column dummy card. That wrap is preferable to 10px type. Do not narrow the sidebar to "fix" the wrap.

### 2.2 Gradient text

Primary on both scans. The logo is the only `background-clip: text` in the file.

Current classic rule:

```css
.logo{font-family:Cinzel,serif;font-weight:800;font-size:28px;letter-spacing:.06em;line-height:1;
  background:linear-gradient(180deg,var(--gold2),var(--gold) 55%,var(--gold-dim));-webkit-background-clip:text;background-clip:text;color:transparent}
```

`color` is `transparent`, so the glyphs only show because they are clipped to the gradient. Arcade then does this:

```css
html[data-theme=arcade] .logo{font:400 26px var(--pix);letter-spacing:.02em;background:none;color:var(--gold);-webkit-text-fill-color:var(--gold);
  text-shadow:3px 3px 0 var(--pink)}
```

`background: none` clears the gradient image. It does not clear `background-clip` / `-webkit-background-clip`. The rendered page can still be `background-clip: text`, which is why detect reports gradient text on the arcade page.

Proposed classic rule, solid colour, no clip:

```css
.logo{font-family:Cinzel,serif;font-weight:800;font-size:28px;letter-spacing:.06em;line-height:1;
  color:var(--gold2)}
```

Proposed arcade rule, explicit reset so a later edit cannot leave the clip in place:

```css
html[data-theme=arcade] .logo{font:400 26px var(--pix);letter-spacing:.02em;
  background-image:none;background-clip:border-box;-webkit-background-clip:border-box;
  color:var(--gold);-webkit-text-fill-color:var(--gold);
  text-shadow:3px 3px 0 var(--pink)}
```

Classic "POTENTIAL DAMAGE" becomes solid `--gold2` (`#f0e6d2`) instead of a gold gradient. Arcade stays solid `--gold` (`#ffd23f`) with the existing pink text shadow. Do not ship the classic change without the colour line. If `color: transparent` is left behind, the logo disappears.

### 2.3 Hard-offset pink shadows (advisory)

Keep them. Do not shrink them.

`DESIGN.md` defines the only three shadows: `--e1: 3px 3px 0`, `--e2: 5px 5px 0`, `--e3: 8px 8px 0`, and says main panels use a 3px gold frame and an `--e3` pink shadow. The arcade skill says if a review flags that shadow, keep it and record the waiver. Detect's own text says the same: waive an intentional use with `data-impeccable-ignore="hard-offset-shadow"`. It is not counted as a failure.

Current:

```css
html[data-theme=arcade] .panel{background:var(--bg);border:3px solid var(--gold);border-radius:0;box-shadow:var(--e3) var(--pink)}
```

Under 560px the same panels use the medium offset, which is still at least 4px, so a phone scan would flag it too:

```css
html[data-theme=arcade] .panel{box-shadow:var(--e2) var(--pink)}
```

Proposed HTML only, no visual change:

```html
<aside class="panel" data-impeccable-ignore="hard-offset-shadow">
<main class="panel" id="stage" data-impeccable-ignore="hard-offset-shadow">
```

Do not add a global ignore for the rule. Cards, buttons, and the tier badge also use `--e1` or `--e2`. Those were not in this scan. If a later scan flags one, decide that instance on its own. `--e1` is 3px, under the 4px line the rule describes, so it should stay quiet.

### 2.4 Static-file findings that the live arcade page did not show

These are classic-theme rules. Recommended action is to leave the default page alone and only change classic if a clean scan of the whole file is required.

**`overused-font` (Inter).** Classic body:

```css
body{background:radial-gradient(1200px 600px at 50% -200px,#1a2747 0%,var(--bg) 60%) fixed,var(--bg);color:var(--text);
  font:15px/1.45 Inter,system-ui,sans-serif;min-height:100vh}
```

The theme boot script loads Inter only when classic is active:

```js
fonts.href = 'https://fonts.googleapis.com/css2?' + (classic ? 'family=Cinzel:wght@600;800&family=Inter:wght@400;500;600;700'
  : 'family=Bungee&family=Chakra+Petch:wght@400;500;600;700') + '&display=swap';
```

Arcade already uses Chakra Petch and Bungee. Recommendation: do not change the default. If the file scan must go to zero, classic body becomes a face that is not on detect's overused list, and Inter is removed from that font URL. That is a visible change to the preserved fallback, so it should be a separate yes.

**`dark-glow` (`#c8aa6e`).** Classic button hover:

```css
@media (hover:hover) and (pointer:fine){.btn:hover:not(:disabled){box-shadow:0 0 16px #c8aa6e55}}
```

Arcade already replaces that with `box-shadow: var(--e2) var(--pink)` and a 1px nudge, and only on a fine pointer. Recommendation: leave classic. A clean-file version would drop the blurred gold glow and darken the border on hover instead.

**`radial-halo` (`#2c3a22`).** Classic arena floor:

```css
.arena{position:relative;height:340px;border-radius:var(--radius);overflow:hidden;border:1px solid var(--line);
  background:radial-gradient(400px 200px at 50% 95%,#2c3a22 0%,transparent 70%),linear-gradient(180deg,#0b1222,#121c30 70%,#1a2414)}
```

Arcade already replaces the arena background. Recommendation: leave classic.

**`repeating-stripes-gradient` (advisory).** Two candidates in the file:

```css
.hpbar .ticks{position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0 calc(10% - 1px),#0007 calc(10% - 1px) 10%)}
```

```css
html[data-theme=arcade] .arena{border:3px solid var(--cyan);border-radius:0;
  background:linear-gradient(transparent 0 calc(100% - 60px),#1a0f2a calc(100% - 60px)),
    repeating-linear-gradient(0deg,#ffffff06 0 2px,transparent 2px 4px),var(--bg)}
```

The health-bar ticks are a scale, not decoration. Keep them. The arena scanline is a 6%-white stripe. If an advisory-free file is required, delete only that middle layer:

```css
html[data-theme=arcade] .arena{border:3px solid var(--cyan);border-radius:0;
  background:linear-gradient(transparent 0 calc(100% - 60px),#1a0f2a calc(100% - 60px)),var(--bg)}
```

Recommendation: keep the scanline unless a zero-advisory scan is the goal. It did not show up on the rendered-page scan.

## 3. Earlier AI-tell list, against the current default

These were the tells on the old single theme. Arcade, which is what players get now, already replaces most of them. Classic still contains them, on purpose, behind `?theme=classic`.

### Inter

Default already uses Chakra Petch (body) and Bungee (logo, headings, score, dummy numbers, tier, timer). Inter is loaded only for classic. Recommendation: no change to the default. See 2.4 if a file scan must not contain the name Inter.

### Pill toggles

Classic:

```css
.pill{border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:6px 12px;font-size:13px;color:var(--muted)}
.modes{display:flex;border:1px solid var(--line);border-radius:999px;overflow:hidden}
```

Arcade already overrides both to square cyan frames, and the active mode is a gold fill with a pink `--e1` shadow. That matches `DESIGN.md`. Recommendation: no further change.

### Rounded cards that lift on hover

Classic:

```css
.card{background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius); ...}
@media (hover:hover) and (pointer:fine){.card:hover{border-color:var(--gold);transform:translateY(-3px);box-shadow:0 10px 24px #0008,0 0 0 1px var(--gold-dim)}}
```

`--radius` is 10px. Arcade already sets `border-radius: 0` and, on a fine pointer only:

```css
html[data-theme=arcade] .card{background:var(--bg);border:2px solid var(--cyan);border-radius:0;box-shadow:var(--e1) #3ef0ff55}
@media (hover:hover) and (pointer:fine){html[data-theme=arcade] .card:hover{border-color:var(--gold);transform:translate(-2px,-2px);box-shadow:var(--e2) var(--pink)}}
```

That 2px nudge is the cabinet sticker, not the old soft lift. `DESIGN.md` specifies it, and reduced-motion already forces `transform: none`. Recommendation: keep it.

### Blue glow

Classic page background:

```css
body{background:radial-gradient(1200px 600px at 50% -200px,#1a2747 0%,var(--bg) 60%) fixed,var(--bg); ...}
```

Arcade:

```css
html[data-theme=arcade] body{background:var(--bg);font-family:'Chakra Petch',system-ui,sans-serif;
  border-top:6px solid var(--gold);box-shadow:inset 0 3px 0 var(--pink)}
```

The default page is a flat `#0c0614` with a gold/pink cabinet edge. Recommendation: no change.

### Emoji icons

Still in the markup and one script template:

```html
<button class="pill" id="howBtn" style="cursor:pointer">❓ <b data-i18n="howTo">How to play</b></button>
<button class="pill" id="lbBtn" style="cursor:pointer;visibility:hidden">🏆 <b data-i18n="leaderboard">Leaderboard</b></button>
<label class="pill settings" id="settings" title="Settings">⚙
```

```js
<div style="font-size:28px">🔒</div>
<div class="lb-face lb-masked" title="...">🔒</div>
```

`DESIGN.md` says emoji are not decoration and then names these as functional. Recommendation: leave them until the owner says otherwise. If they should go, delete the characters and add square marks that do not depend on an emoji font. Buttons keep their `data-i18n` labels. Example for the header buttons:

```html
<button class="pill" id="howBtn" style="cursor:pointer"><b data-i18n="howTo">How to play</b></button>
<button class="pill" id="lbBtn" style="cursor:pointer;visibility:hidden"><b data-i18n="leaderboard">Leaderboard</b></button>
<label class="pill settings" id="settings" title="Settings">
```

```css
#howBtn::before,#lbBtn::before,#settings::before{content:"";width:14px;height:14px;flex:0 0 14px;background:currentColor}
#howBtn,#lbBtn,#settings{display:inline-flex;align-items:center;gap:6px}
```

Use a mask image for the question mark and the trophy, and a 2px inset box for settings, so classic and arcade both pick up `currentColor`. The lock placeholders become a `<span class="lb-lock-icon" aria-hidden="true">` drawn with borders, not the character U+1F512. The share string that uses purple and black squares (`🟪` / `⬛` in `share()`) is pasted text, not a button icon. Leave it unless the owner wants the copied result changed too.

### Purple-to-pink meter

Classic:

```css
.meter i.on{background:linear-gradient(90deg,#b05ce6,#ff5ab4)}
```

Arcade already replaces it:

```css
html[data-theme=arcade] .meter i{border-radius:0;height:14px;background:transparent;border:2px solid var(--gold)}
html[data-theme=arcade] .meter i.on{background:var(--pink);border-color:var(--pink)}
```

Recommendation: keep the solid pink blocks. Only if classic must also lose the gradient:

```css
.meter i.on{background:var(--gold)}
```

## 4. Recommended direction

Keep arcade as the live default. Do not reskin the homepage as Freljord or Hextech.

Those two previews are the stronger League-flavoured directions, and they are already on pull request #1 for comparison. `DESIGN.md` was written after that and is explicit: arcade cabinet, not a Riot-client imitation, no gold filigree, no Beaufort-style serif, no hex pattern. Shipping Freljord or Hextech as the default would throw out the token table, the Bungee / Chakra Petch pair, the three shadow levels, and the classic fallback.

The work that is actually worth doing, in this order:

1. Raise the arcade dummy labels from 10px to 12px.
2. Remove gradient text clipping from `.logo`, and set a solid colour on both themes so the classic logo cannot vanish.
3. Leave the 8px pink panel shadows, and mark `aside.panel` and `#stage` with `data-impeccable-ignore="hard-offset-shadow"`.
4. Leave classic's Inter, pills, rounded hover, blue page glow, and purple meter in place unless a file-wide zero is required. The default page does not show them.
5. Leave the emoji until the owner overrides the line in `DESIGN.md` that calls them functional.

After that, the rendered default should have no primary detect findings. The two shadow advisories go away because of the waiver, not because the shadow changed. A static scan of `index.html` will still report Inter, the classic gold glow, and the classic arena radial until classic itself is edited.

## 5. Risks

Nothing in this proposal should be implemented in the same change as a rules or engine edit.

- Storage keys stay `potenshall:` including `potenshall:theme`, `potenshall:lang`, daily snapshots, and the client id. Do not rename them and do not reuse the preview prefix `pd-preview:`.
- Do not rename ids (`#stage`, `#champSlot`, `#hpfill`, `#lbBtn`, `#modes`, …), `data-mode`, `data-pick`, `data-tier`, or the classes the script builds (`.card`, `.dummy-card`, `.lb-row`, …).
- The theme boot script must keep running before paint. It is what sets `data-theme` and which font stylesheet loads. Breaking it flashes the classic page or leaves Bungee unloaded.
- Removing `background-clip` without setting `color` makes the logo invisible, because classic currently uses `color: transparent`.
- 12px dummy labels will wrap German, Dutch, and possibly Russian in the three narrow stat cells. The number above the label should stay on one line. Check those three languages at 375px and at the 300px sidebar.
- `data-impeccable-ignore` does not change layout. It only tells a later detect run to skip that element.
- Do not redeploy the leaderboard Worker. This is CSS, a few attributes, and a `DESIGN.md` sentence.
- Do not merge pull request #1 as part of this. Those pages are previews. They are not the homepage, and their localStorage prefix is separate on purpose.
- Footer copy stays, including the Riot disclaimer. `legal.css` / Terms / Privacy only need a matching logo colour if classic `.logo` changes and those pages share it. Check `theme.js` before assuming they do.
- Hover, focus, and reduced-motion rules already exist. A label-size change does not require new motion. Do not add a hover effect that runs on touch.

## 6. What was deliberately not done

No edit to `index.html`, `DESIGN.md`, theme JavaScript, or the design-preview branch. Detect was run for evidence. Critique and audit could not be run as commands without installing the skill pack.
