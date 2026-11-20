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

Tier colours (results badge, `data-tier`): Iron `#b8aca4`, Bronze `#e8945a`, Silver `#d4dde6`, Gold `#ffd23f`,
Platinum `#4fe6d0`, Emerald `#3ddc84`, Diamond `#7aa2ff`, Master `#c77dff`, Grandmaster `#ff5468`, Challenger `#fff0a0` (glow).

## Typography

- Two families only. **Bungee** (display): logo, stage headings, champion names, the score, dummy stats, ranks, tier,
  timer, KO flash. One weight (400); never fake bold. **Chakra Petch** (everything else): body 400/500, labels and
  buttons 700 in capitals with 0.04em tracking.
- No pixel fonts: they were tried and rejected as hard to read.
- Light text on dark: body line height 1.55, long text 1.6, letter spacing 0.005em.
- Line length: long text stops near 90 characters (footer), How to play cards stay around 45 to 75.
- Numbers use tabular figures where they update live (clock, totals, leaderboard scores).
- Only the active theme's two fonts are downloaded (the theme script adds the Google Fonts link).

## Components

- **Main panels** (`.panel`: sidebar, stage): 3px gold frame, `--e3` pink shadow.
- **Inner panels** (inside the stage: results sections, How to play cards): 2px cyan frame, no shadow (busy screens stay calm).
- **Cards** (champion and item choices): 2px cyan frame, `--e1` faint cyan shadow at rest; on hover (mouse only) gold frame,
  lift 2px, `--e2` pink shadow. Champion portraits have a 2px white frame. 3 cards per row on desktop, 2 on phones.
- **Buttons**: square, 2px gold frame, Chakra Petch 700 capitals, `--e1` pink shadow; primary is gold fill with dark text.
  Hover lifts with `--e2`; pressed sinks to a 1px shadow.
- **Pills and mode tabs** (header): 2px cyan frame, cyan capitals; the active mode is gold fill with a pink shadow.
- **Tags** (roles, melee/ranged): 2px pink frame, pink capitals, 11px.
- **Skin label**: champions with an Arcade, Battle Boss or Final Boss skin show that skin's art and a label in `#c8146e`
  with white text (5.5:1). The list comes from `arcade-skins.json` (`tools/update-arcade-skins.ps1`).
- **Bars**: square ends. Stat bars use the damage-type colours; empty track `#2a1f3a`.
- **Leaderboard rows**: 2px cyan frame, rank and score in Bungee; top 3 ranks gold with a pink text shadow; your own row
  gold-framed with a pink `--e1` shadow.
- **Tier badge**: tier colour for text and frame, `--e2` pink shadow.
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
- No layout shift while loading: the loading panel holds about a screen of height, and the header reserves space for the
  Leaderboard button, patch and best score. Target cumulative layout shift 0.

## Assets and legal

- Champion and item art comes from Riot's Data Dragon CDN; never re-host or alter it beyond cropping.
- Keep Riot's "isn't endorsed by Riot Games" notice in every page footer.
- Don't imitate the League client (gold filigree frames, Beaufort-style serif, hex patterns): fan content must not look
  official.
- Link preview image: `og.png` (1200x630, drawn by `tools/make-og-image.ps1`); bump `?v=` in the meta tags when it changes.

## Don'ts (the generic-AI look we moved away from)

- No gold-on-navy gradients, glassy blur panels, soft drop shadows, rounded pill everything, or purple-to-blue gradients.
- No Inter as the arcade font, no gradient text, no emoji as decoration (the existing ❓🏆🔒 icons are functional).
- No cards inside cards, no numbered section labels, no "eyebrow" chips above headings.
- No invented numbers: every figure shown comes from the game engine or the leaderboard.

## Where things live

- `index.html`: all game CSS (base/classic first, then the `html[data-theme=arcade]` block, then focus and reduced motion)
  and the page script. `legal.css` + `theme.js`: Terms and Privacy. `i18n.js`: all text.
- Script tags carry content fingerprints (`tools/stamp-assets.ps1`, run by `tools/build-worker.ps1`).
- Design-only changes never need the leaderboard Worker redeployed.
