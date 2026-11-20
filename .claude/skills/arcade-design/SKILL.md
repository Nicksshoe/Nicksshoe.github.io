---
name: arcade-design
description: Design rules and procedure for Potential Damage (potentialdamage.gg). Use for any visual or UI change to the game, its Terms and Privacy pages, or the link preview image - new screens, restyles, components, colours, fonts, motion, layout - and before reviewing the design with other tools (Impeccable, audits). Covers the arcade theme tokens, the classic fallback, accessibility and layout-shift checks, and how to preview and ship safely.
---

# Arcade design for Potential Damage

The design system is written down in `DESIGN.md` at the project root. Read it first, every time: it has the tokens,
components, motion, accessibility and legal rules. This skill is the procedure for applying them.

## 1. Before changing anything

- Read `DESIGN.md`, then the parts of `index.html` you'll touch. Game CSS is one `<style>` block: base (classic) rules
  first, then the `html[data-theme=arcade]` block, then focus and reduced-motion rules at the end.
- Decide which theme the change is for. Arcade is the default; classic (`?theme=classic`) must keep working. A new
  component gets a neutral base style plus an arcade override, never arcade-only markup.
- Keep the hooks the script relies on: element ids (`#stage`, `#champSlot`, `#hpfill`, `#lbBtn`...), `data-*`
  attributes (`data-pick`, `data-mode`, `data-tier`) and class names used in templates. Restyle, don't rename.
- Move inline styles from script templates into classes before restyling them (see `.lb-row` for the pattern).

## 2. Build with the system

- Colours only from the tokens. A new colour needs a contrast check (see `references/checks.md`) and a line in `DESIGN.md`.
- Shadows: only `var(--e1)`, `var(--e2)`, `var(--e3)`. Corners: square.
- Fonts: Bungee (weight 400) for display text, Chakra Petch for everything else. No third family. No pixel fonts.
- Text: every visible string goes in `i18n.js` in all 7 languages, through `t('key')`. Check German and Russian lengths.
- Motion: `transform` and `opacity` only, under 300ms for UI, hover only inside
  `@media (hover:hover) and (pointer:fine)`, and a reduced-motion version (fade, no movement). JavaScript motion checks
  `reduceMotion()`.
- Layout: no horizontal scroll at 375px wide; reserve space for anything that loads late (no layout shift).
- Images: champion and item art from Data Dragon via the `img` helper in `index.html` (it handles arcade skins).
- Never imitate the League client look; keep the Riot notice in footers. See `DESIGN.md`, Assets and legal.

## 3. Check it (every change)

Run the local server (`.claude/serve.ps1` on port 5174) and use the browser checks in `references/checks.md`:

1. Desktop and phone (375x812): pick, items, fight, results, leaderboard, How to play, report form.
2. Both themes: `?theme=arcade` and `?theme=classic`.
3. Layout shift on a fresh load: 0 (or under 0.05).
4. Contrast of any new colour pair: 4.5:1 for text, 3:1 for large text and controls.
5. No horizontal scroll at 375px; tap targets at least 40px tall on phones.
6. Console: no new errors.

## 4. Ship

- Design-only changes don't touch the leaderboard Worker. If a script file changed, run `tools/stamp-assets.ps1`
  (`tools/build-worker.ps1` runs it too) so browsers fetch the new version.
- For a large redesign, add it behind a `?theme=` value first so the owner can preview it live, then make it the default.
- Commit with a message that says what changed visually; update `DESIGN.md` in the same commit when a rule or token changes.
- After pushing, GitHub Pages is live in about a minute; browsers may keep the old page up to 10 minutes.

## 5. Reviews with other tools

`DESIGN.md` is the shared source for outside reviewers (Impeccable reads `DESIGN.md` and writes `PRODUCT.md`). When a
review flags something:
- Fix it if it breaks a rule here or in `DESIGN.md`.
- If it conflicts with a deliberate choice (square corners, hard offset shadows, Bungee, bright accents on near-black),
  keep the choice and note why in the review's ignore list instead of changing the design.
- If the review finds a real gap in the system, update `DESIGN.md` first, then the code.
