# Potential Damage design system

The visual system of potentialdamage.gg, as built. Read this before any visual change; the `arcade-design` skill
(`.claude/skills/arcade-design/`) is the procedure that applies it. Tools like Impeccable read this file too.

## Product context

- A free, no-sign-up browser game for League of Legends players: draft a random champion and 6 random items, then watch
  10 seconds of damage against a training dummy. Daily challenge, Free Play, leaderboards.
- Audience: League players, mostly arriving from Reddit and Discord links, often on phones. Sessions are short and
  repeated; the results screen is what gets screenshotted and shared.
- One page app (`index.html`) plus Terms and Privacy pages. No build step: plain HTML, CSS and JavaScript on GitHub Pages.
- Seven interface languages (English, German, Russian, Spanish, Portuguese, Dutch, French). Every visible string lives
  in `i18n.js`; layouts must survive German and Russian lengths.
- Design mode: **product** (an app UI), not brand/marketing. Judge it by game-UI rules: fast to scan, one action at a
  time, states (loading, empty, error) covered. Marketing-page advice (hero sections, scroll storytelling, long copy)
  doesn't apply.
- One visual anchor per screen: champion pick = the cards, item pick = the item choices, fight = the dummy and health
  bar, results = the score, leaderboard = the rows. Nothing else on a screen competes with its anchor.

## Direction: arcade

Arcade cabinet energy, not a Riot-client imitation. Bright yellow, cyan and magenta on near-black, square corners, hard
offset shadows like a sticker or a cabinet bezel. Bold and playful, but every number must stay instantly readable.

The original gold-and-navy look stays available as `classic` (`?theme=classic`, remembered per browser). Arcade is the
default. All arcade rules are scoped to `html[data-theme=arcade]`; classic styles are the unscoped base.

## Tokens (arcade)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0c0614` | Page and panel background. Never pure black. |
| `--line` | `#3a2a52` | Hairlines, empty bar tracks, dividers |
| `--gold` | `#ffd23f` | Primary accent: logo, headings, main frames, primary button fill, scores |
| `--cyan` | `#3ef0ff` | Secondary accent: cards, inner panels, pills, subtitles, stat labels |
| `--pink` | `#ff3ea5` | Shadow colour, tags, health bar, Meta Meter |
| `--lime` | `#b6ff3e` | Success text only (report sent, defence bars) |
| `--text` | `#f4f0ff` | Body text |
| `--muted` | `#a99cc4` | Secondary text (tinted, not grey) |
| `--phys` / `--magic` / `--true` | `#ff8a2a` / `#3ef0ff` / `#ffffff` | Damage types everywhere (bars, numbers, legend) |
| `--e1` / `--e2` / `--e3` | `3px 3px 0` / `5px 5px 0` / `8px 8px 0` | The only three shadow offsets: small (tags, buttons, cards at rest), medium (hover, tier box, phone panels), large (main panels) |
| `--radius` | `0` | Everything is square |
| `--hi` | `#ffffff` | Pure white highlights: portrait frames, health bar and split-bar borders, champion names |
| `--on-gold` | `#120a00` | Text on gold fills (primary buttons, active mode, toast) |
| `--cyan-soft` | `#3ef0ff55` | Faint cyan shadow on cards at rest |
| `--gold-wash` | `#ffd23f14` | Background tint of your own leaderboard row |
| `--skin` | `#c8146e` | Arcade-skin label background (white text, 5.5:1) |
| `--track` / `--floor` | `#2a1f3a` / `#1a0f2a` | Empty bar tracks / arena floor (a flat band, no scanlines) |
| `--ink-shadow` | `#000000` | Text shadow on floating damage numbers |

No raw hex values in component rules: every colour in the arcade block is a token (tier colours are the one table of
their own). `tools/ui-check.js` and a search for `#` in the arcade block catch strays.

High contrast (`prefers-contrast: more`): `--muted` brightens to `#e2dbf5`, `--line` to `#8a78b0`, tracks and card
shadows get stronger, and tags and card subtitles go bold.

Tier colours (results badge, `data-tier`): Iron `#b8aca4`, Bronze `#e8945a`, Silver `#d4dde6`, Gold `#ffd23f`,
Platinum `#4fe6d0`, Emerald `#3ddc84`, Diamond `#7aa2ff`, Master `#c77dff`, Grandmaster `#ff5468`, Challenger `#fff0a0` (2px pink offset, no glow).

Gold has three jobs, each its own token so light mode can treat them differently: `--fill` (primary button and active
tab fills, top stripe), `--frame` (main panel and button frames), `--title` (logo, headings, scores, champion names).
In dark mode all three are `#ffd23f`. `--on-skin` (`#ffffff`) is the skin label text in both modes.

## Light and dark mode (arcade)

`data-mode=light` on `<html>` switches arcade to light ("arcade on paper"); no attribute is dark. Set by the theme
script from `?mode=light|dark` or the header button, remembered as `potenshall:mode`; `DEFAULT_MODE` in `index.html`
and `theme.js` decides what new visitors get. Classic has one look and hides the button.

| Token | Light value | Note |
|---|---|---|
| `--bg` | `#fff8ec` | Warm cream paper, never pure white |
| `--text` / `--hi` / `--frame` / `--title` | `#1b1030` | Ink: body text, frames, headlines |
| `--muted` | `#5a4a6e` | 7.5:1 on cream (ink is 17.1:1) |
| `--fill` | `#ffd23f` | Same yellow as dark; ink text on it (`--on-gold`) |
| `--cyan` / `--magic` | `#006b7a` | Teal, 5.9:1 |
| `--pink` | `#d1006a` | Shadows, tags, health bar; 5.0:1 as text |
| `--lime` / `--good` | `#2a7a00` | 5.1:1 |
| `--phys` / `--true` | `#b84a00` / `#1b1030` | Damage types |
| `--line` / `--track` / `--floor` | `#d9cbe3` / `#efe5f5` / `#f3e6cc` | Hairlines, bar tracks, arena floor |

Light tier colours are darker versions of the dark ones (Iron `#6b5f57` ... Grandmaster `#c2002c`, Challenger `#7a5900`
with a 2px yellow offset).  High-contrast tweaks apply to dark mode only. `tools/ui-check.js` must report 0 in both modes.

## Typography

- Two families only. **Bungee** (display): logo, stage headings, champion names, the score, dummy stats, ranks, tier,
  timer, KO flash. One weight (400); never fake bold. **Chakra Petch** (everything else): body 400/500, labels and
  buttons 700 in capitals with 0.04em tracking.
- No pixel fonts: they were tried and rejected as hard to read.
- Not in the arcade theme: Inter, Roboto, Arial, Space Grotesk (the "AI default" faces). Classic keeps Inter as the
  preserved original. The link preview image uses the same two fonts.
- Light text on dark: body line height 1.55, long text 1.6, letter spacing 0.005em.
- Line length: long text stops near 90 characters (footer), How to play cards stay around 45 to 75.
- Numbers use tabular figures where they update live (clock, totals, leaderboard scores).
- Smallest text is 11px (tags, skin label); functional labels are 12px or more (dummy stat labels: 12px Chakra Petch under
  the Bungee numbers). Long translations (German "Magieresistenz", Dutch "Magische weerstand") wrap instead of shrinking.
- Only the active theme's two fonts are downloaded (the theme script adds the Google Fonts link).

## Components

- **Main panels** (`.panel`: sidebar, stage): 3px gold frame, `--e3` pink shadow. Marked
  `data-impeccable-ignore="hard-offset-shadow"`: Impeccable flags hard offset shadows as an advisory, and here it is the design.
- **Inner panels** (inside the stage: results sections, How to play cards): 2px cyan frame, no shadow (busy screens stay calm).
- **Cards** (champion and item choices): 2px cyan frame, `--e1` faint cyan shadow at rest; on hover (mouse only) gold frame,
  lift 2px, `--e2` pink shadow. Champion portraits have a 2px white frame. 3 cards per row on desktop, 2 on phones.
- **Buttons**: square, 2px gold frame, Chakra Petch 700 capitals, `--e1` pink shadow; primary is gold fill with dark text.
  Hover lifts with `--e2`; pressed sinks to a 1px shadow.
- **Pills and mode tabs** (header): 2px cyan frame, cyan capitals; the active mode is gold fill with a pink shadow.
  Patch and Best are information, not controls: no frame or shadow, muted label, gold number (`.pill.stat`).
- **Tags** (roles, melee/ranged): 2px pink frame, pink capitals, 11px.
- **Skin label**: champions with an Arcade, Battle Boss or Final Boss skin show that skin's art and a label in `--skin`
  with white text (5.5:1). The list comes from `arcade-skins.json` (`tools/update-arcade-skins.ps1`).
- **Bars**: square ends. Stat bars use the damage-type colours; empty track `--track`.
- **Leaderboard rows**: 2px cyan frame, rank and score in Bungee; top 3 ranks gold with a pink text shadow; your own row
  gold-framed with a pink `--e1` shadow.
- **Tier badge**: tier colour for text and frame, `--e2` pink shadow.
- **Results screen** (top to bottom): tier badge and score (Bungee 64px, 44px on phones) with the facts line; Play again
  (the one primary button) and Copy result; the leaderboard submit row between two hairlines, unframed, with outline
  buttons; then two framed panels: damage breakdown, and one panel holding the Meta Meter and level 18 stats split by a line.
- **Inputs**: square, 2px cyan frame, cyan focus outline.

## Motion

- Purposeful and short: UI transitions under 300ms, never `ease-in` on UI, cards pop in with a 30 to 80ms stagger.
- Animate `transform` and `opacity` only (never width, height, top or left). The health bar shrinks with `scaleX`.
- Hover effects only for `(hover: hover) and (pointer: fine)`.
- Reduced motion (`prefers-reduced-motion`): fades stay, movement goes. No shake, no floating numbers, no pop, no smooth
  scrolling; `reduceMotion()` in the script covers JavaScript-driven motion.

## Accessibility

- Contrast on `--bg`: body 4.5:1 or more, large text and controls 3:1. Current: text 17.8:1, gold 13.8:1, cyan 14.4:1,
  lime 16.5:1, muted 7.8:1, pink 6.2:1, dark text on gold buttons 13.6:1,
  skin label 5.5:1. Measure new colour pairs before shipping.
- Visible keyboard focus everywhere (`:focus-visible`): 3px cyan outline in arcade, gold in classic.
- Tap targets at least 40px tall on phones (header pills, small buttons, footer links get extra height under 560px wide);
  nothing important on hover only.
- No layout shift while loading: the loading panel and the stage hold at least about a screen of height (so a short
  screen, like a resumed result, can't pull the footer up), the scrollbar gutter is always reserved, and the header
  reserves space for the Leaderboard button, patch and best score. Target cumulative layout shift 0.
- Structure: one `h1` (the logo), `h2` for the sidebar sections and the stage heading, `h3` inside. No skipped levels.
- Every form field has a label (`aria-label` or `<label>`); placeholders are hints, not labels.
- No emoji anywhere in the interface or in translations. Icons are drawn inline SVG in `currentColor` with
  `aria-hidden` (the padlock `LOCK_SVG`, the logo mark); controls say what they do in words.
- Never colour alone: your leaderboard row also says "You", tiers show their name, damage types have text labels.
- Checked automatically by `tools/ui-check.js` (walkthrough of every screen; see the skill).

## Assets and legal

- Champion and item art comes from Riot's Data Dragon CDN; never re-host or alter it beyond cropping.
- Keep Riot's "isn't endorsed by Riot Games" notice in every page footer.
- Don't imitate the League client (gold filigree frames, Beaufort-style serif, hex patterns): fan content must not look
  official.
- Link preview image: `og.png` (1200x630, drawn in the browser by `tools/og-image.html` with the site fonts; Save writes it through the local server); bump `?v=` in the meta tags when it changes.
- Brand mark: `favicon.svg` (a gold damage burst in a gold frame with a pink offset shadow), also inline in the header
  logo and drawn at 180px as `icon-180.png` for phone home screens. Change all three together.
- Every image has alt text: the champion, skin or item name. Structured data (`VideoGame` JSON-LD) sits in the page head.

## Don'ts (the generic-AI look we moved away from)

- No textures and no soft glows or blurs in arcade: no scanlines, grain, noise or `0 0 Npx` shadows. Every shadow is a hard
  offset. Texture and blur on flat shapes is what makes a page read as AI-generated art. The only gradient left is the hard-stop
  arena floor band (no blending).
- The classic theme's gradients live in `classic.css`, loaded only for classic players, so the default page ships flat colours.
- No gold-on-navy gradients, glassy blur panels, soft drop shadows, rounded pill everything, or purple-to-blue gradients.
- No Inter as the arcade font, no gradient text, no emoji (not even in buttons or labels).
  Kept on purpose: the arrows on Skip and Back, and the ■□ Meta Meter squares in the copied result text.
- No cards inside cards, no numbered section labels, no "eyebrow" chips above headings.
- No invented numbers: every figure shown comes from the game engine or the leaderboard.

## Where things live

- `index.html`: all game CSS (base/classic first, then the `html[data-theme=arcade]` block, then focus and reduced motion)
  and the page script. `legal.css` + `theme.js`: Terms and Privacy. `i18n.js`: all text.
- Script tags carry content fingerprints (`tools/stamp-assets.ps1`, run by `tools/build-worker.ps1`).
- Design-only changes never need the leaderboard Worker redeployed.
