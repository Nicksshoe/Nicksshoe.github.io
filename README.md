# Potential Damage

A League of Legends mini game inspired by Bausffs-style abstract builds. Draft one champion from 6 random picks (5 before 2026-11-21), then 6 items, each picked from 6 random legendary items or boots (3 rerolls total), and see how much damage you deal to a training dummy (10,000 HP, 200 armor, 100 MR) in 10 seconds at level 18.

## How the damage works

- **Champions and items** load live from Riot's Data Dragon, always on the newest patch.
- **Abilities** use real formulas from Riot's game files (via CommunityDragon, saved in `kits/` each patch): base damage at max rank (5/5/5/3), AP/AD/HP ratios, real cooldowns with ability haste, and each champion's attack speed ratio. A handful of unusual kits (Aphelios, Hwei, Bard, Milio, Taric, Trundle, Tryndamere, Zilean) fall back to a class-based estimate.
- **Item passives** are modeled by hand for about 50 items (Spellblade, on-hit, burns, Heartsteel...). Other items count their stats.
- **Stacks** (Veigar, Sion, Cho'Gath, Swain, Senna, Thresh) come from `stacks.json`: the median stat gain no item or rune explains, at minute 30 of high-elo ranked games on the previous patch. Stacks the API can't see (Nasus, Smolder, Aurelion Sol, Kindred...) are hand-set estimates.

Known simplifications: recast and multi-hit abilities (Riven Q, Syndra R spheres) count one hit per cast, and most champion passives aren't modeled.

## Updating stacks each patch

Needs a Riot API key saved in `%USERPROFILE%\.riot\api-key.txt` (never commit it).

```powershell
pwsh -File tools/update-stacks.ps1
```

Then commit the new `stacks.json`.

## Running locally

Any static file server works, e.g. `npx serve .` — opening `index.html` directly from disk won't load data.

---

Potential Damage isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

## Leaderboard

A Cloudflare Worker (`potenshall-leaderboard`) with a D1 database stores scores. It never trusts the browser's score: it replays the draft from its seed and re-runs the fight with the same engine. Daily seeds come from the date; Free Play seeds are issued and signed by the Worker.

After changing `engine.js` or `abilities.js`, rebuild and redeploy so server scores keep matching the game:

```powershell
pwsh -File tools/build-worker.ps1
```

Then paste `worker/dist/worker.js` into the Worker's code editor in the Cloudflare dashboard and deploy. Table setup is in `worker/schema.sql`.


## Each patch: checklist

**Check first:** `pwsh -File tools/check-patch.ps1` compares every data file with the live patch on Data Dragon and prints the commands for anything stale. A GitHub workflow (`.github/workflows/patch-check.yml`) runs the same check every day and opens an issue titled "New League patch: update the game data files" when something is behind. The test bench also shows a red banner when `kits/` is out of date.

1. `pwsh -File tools/update-kits.ps1`: ability data for every champion, saved to `kits/` (trimmed copies of the game files). The game and the Worker load abilities from here; if `kits/manifest.json` is for an older patch, they fall back to CommunityDragon (slower, but scores still match).
2. `pwsh -File tools/update-growth.ps1`: `growth.js` (attack damage per level; Data Dragon reports 0 for every champion since 16.1).
3. `pwsh -File tools/update-cc.ps1`: `cc.js` (which abilities immobilize, for Imperial Mandate).
4. `pwsh -File tools/update-itemgroups.ps1`: `itemgroups.js` (which items can't be owned together, e.g. one Last Whisper item, one Spellblade item, one pair of boots).
5. `pwsh -File tools/update-stacks.ps1`: `stacks.json` (needs the Riot API key; see above).
6. Commit and push, then `pwsh -File tools/build-worker.ps1` and redeploy the Worker. Run `tools/check-patch.ps1` again: it should say everything matches. Close the reminder issue.


## Leaderboard boards

Daily (per date), Free Play (per patch; past patches stay browsable from the patch picker) and All-time (each player's best ever, with its patch). The `patch` column on `scores` was added with `ALTER TABLE scores ADD COLUMN patch TEXT;` (already applied; `worker/schema.sql` has it for fresh databases).


## Languages

The ⚙ menu switches the interface between English, German, Russian, Spanish, Portuguese, Dutch and French (English by default; the choice is remembered per browser, and a saved language that is no longer offered falls back to English). UI text lives in `i18n.js`; champion, item and ability names come from Data Dragon in the chosen language where Riot publishes it (all but Dutch), otherwise English. Game logic always uses the English data, so drafts and leaderboard verification are the same in every language.
