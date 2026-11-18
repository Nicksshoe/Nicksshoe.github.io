# Potenshall Damage

A League of Legends mini game inspired by Bausffs-style abstract builds. Draft one champion from 5 random picks, then 6 random legendary items (3 rerolls total), and see how much damage you deal to a training dummy (10,000 HP, 200 armor, 100 MR) in 10 seconds at level 18.

## How the damage works

- **Champions and items** load live from Riot's Data Dragon, always on the newest patch.
- **Abilities** use real formulas from Riot's game files via CommunityDragon: base damage at max rank (5/5/5/3), AP/AD/HP ratios, real cooldowns with ability haste, and each champion's attack speed ratio. A handful of unusual kits (Aphelios, Hwei, Bard, Milio, Taric, Trundle, Tryndamere, Zilean) fall back to a class-based estimate.
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

Potenshall Damage isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
