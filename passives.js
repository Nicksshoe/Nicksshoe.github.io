/* Potenshall Damage — champion passives at level 18.
   Each champion's innate passive (plus a few ability passives that change attacks, like Vi's Denting
   Blows or Twisted Fate's Stacked Deck) described with a small set of building blocks the engine
   understands. Numbers are level-18 values; where Riot's game data gives the formula it's used.

   Formula functions get c = { ad, bad (bonus AD), base (base AD), ap, hp, bhp (bonus HP), arm, barm, mr, bmr,
   crit (0-1), cm (crit multiplier), as, bas (bonus AS fraction), mana, bmana, leth, ranged,
   shp / smiss (your own health / missing health share: the fight assumes 40% health),
   thp (dummy current HP), tmax (10,000), tmiss (missing HP), tbase / tbhp (dummy base / bonus HP), t (seconds) }.

   Building blocks:
     stats(c)        -> extra stats { ad, ap, as (bonus %), crit (%), critDmg (%), armor, mr, hp, ah, leth, arpen (%), mpen (%) }
     fixedAS         bonus attack speed doesn't raise attack speed (Jhin)
     critChanceMult / critScale / noCrit      crit changes
     autoMult (num or fn) / autoSplit { magic: share }   change basic attack damage
     onHit           { dmg, type } every basic attack (dot: seconds to spread it as a burn)
     everyN          { n, dmg, type, crit, minCrit, extraOnHit, cd } every Nth basic attack
     magazine        { size, reload } reload pause after every `size` attacks
     afterAbility    { dmg, type, charges, max, cd, extraAttack } next attack(s) after an ability
     onAbility       { dmg, type, cd, dot } on each ability hit
     everyNAbility   { n, dmg, type, echo, cd, dot } every Nth ability (echo: repeat that ability x echo)
     everyNHits      { n, dmg, type, cd, dot } every Nth hit, attacks and abilities both count
     timedAuto       { every, start, once, cond, dmg, type, abilityCdr } empowered attack on a timer
     periodic        { every, start, cond, dmg, type } damage on a timer (pets, plants, procs)
     aura            { hits, linger, dmg (per second), type } active after `hits` hits, refreshed by hitting
     stackDot        { max, dur, perStack (per second), type } stacking bleed / poison
     magicEcho       extra true damage = share of raw magic damage (Amumu)
     amp(kind, type, c) -> damage multiplier
     execute         executes the dummy below this share of max HP
     disable         ability slots that are passives, not casts (their effect is modeled here instead)
*/
(function (root) {
  'use strict';
  const none = (name, note) => ({ name, note: note || 'No damage effect' });
  const avgCrit = c => 1 + c.crit * (c.cm - 1);
  // Average of Aphelios's five weapon Qs at level 18 (Calibrum, Severum, Gravitum, Infernum, Crescendum).
  const apheliosQ = c => {
    const calibrum = 170 + 0.6 * c.bad + c.ap + (15 + 0.15 * c.bad);         // Moonshot + mark detonation
    const severum = 2.4 * c.ad;                                              // Onslaught
    const infernum = 110 + 0.21 * c.bad + 0.7 * c.ap + 1.1 * c.ad;           // Duskwave + follow-up attack
    const crescendum = Math.round(4 * c.as) * (125 + 0.52 * c.bad + 0.5 * c.ap); // Sentry shoots for 4s
    const gravitum = 140 + 0.5 * c.bad + 0.7 * c.ap;                         // Binding Eclipse (magic)
    return { physical: (calibrum + severum + infernum + crescendum) / 5, magic: gravitum / 5 };
  };

  const P = {
    // World Ender (R) is cast at the start: +40% total AD for 10s, the whole fight (game data: RTotalADAmp 0.4).
    Aatrox: { name: 'Deathbringer Stance + World Ender', note: 'Empowered attack: 12% max HP; R: +40% total AD for the whole fight', stats: c => ({ ad: 0.4 * c.ad }),
      timedAuto: { every: 16, abilityCdr: 2, type: 'physical', dmg: c => 0.12 * c.tmax } },
    Ahri: none('Essence Theft', 'Healing only'),
    // Assassin's Mark at level 18: 182 + 60% bonus AD + 55% AP magic (game files).
    Akali: { name: "Assassin's Mark", note: 'Next attack after an ability', afterAbility: { type: 'magic', dmg: c => 182 + 0.6 * c.bad + 0.55 * c.ap } },
    Akshan: { name: 'Dirty Fighting', note: 'Double-shot attacks + every 3rd hit', autoMult: 1.5, everyNHits: { n: 3, type: 'magic', dmg: c => 150 + 0.6 * c.ap } },
    Alistar: none('Triumphant Roar', 'Healing only'),
    Ambessa: { name: "Drakehound's Step", note: 'Dash-empowered attack after abilities', afterAbility: { type: 'physical', dmg: c => 0.03 * c.tmax + 0.2 * c.bad } },
    Amumu: { name: 'Cursed Touch', note: '10% of magic damage dealt again as true damage', magicEcho: 0.10 },
    Anivia: none('Rebirth'),
    // Pyromania: every 4th ability cast stuns, whichever ability it is (R included), so it counts as crowd control.
    Annie: { ...none('Pyromania', 'Stun on every 4th ability'), ccEveryNAbility: 4 },
    // Aphelios's real damage lives in five weapon-specific Qs that aren't in his normal ability slots, so his kit is
    // modeled here from the game files (level-18 formulas). He holds two weapons: each Q is cast at the start and
    // again off its 9s cooldown, averaged over the five weapons since the pair depends on his rotation.
    Aphelios: { name: 'The Hitman and the Seer', note: 'Weapon Qs (average of the 5 guns) + Moonlight Vigil, from game data', ownKit: true,
      stats: () => ({ ad: 24, as: 18, leth: 12 }),
      periodic: [
        { every: 9, start: 0.3, ability: true, label: 'Q · Weapon abilities', kind: 'ability', dmg: c => apheliosQ(c) },
        { every: 9, start: 0.9, ability: true, label: 'Q · Weapon abilities', kind: 'ability', dmg: c => apheliosQ(c) },
        { start: 1.5, ability: true, ult: true, label: 'R · Moonlight Vigil', kind: 'ability', type: 'physical',
          dmg: c => 225 + 0.2 * c.bad + c.ap + (150 + 0.25 * c.bad) / 5 },
      ] },
    Ashe: { name: 'Frost Shot', note: 'Crits become bonus damage on slowed targets', noCrit: true, autoMult: c => 1.1 + c.crit * 0.75 * (c.cm / 1.75) },
    AurelionSol: none('Cosmic Creator', 'Stardust stacks are counted in his abilities'),
    Aurora: { name: 'Spirit Abjuration', note: 'Every 3rd hit, % max HP', everyNHits: { n: 3, cd: 5, type: 'magic', dmg: c => (0.01 + 0.015 * c.ap / 100) * c.tmax } },
    // Sand soldiers (W) do Azir's attacking: each attack is a soldier stab (game data: 174 + 65% AP magic at rank 5),
    // with a second soldier adding 25%. W itself isn't cast for damage.
    Azir: { name: 'Arise! (W) soldiers', note: 'Attacks are sand soldier stabs (magic, AP); two soldiers out', disable: ['W'], autoMult: 0,
      onHit: { label: 'W · Soldier stabs', kind: 'ability', type: 'magic', dmg: c => (174 + 0.65 * c.ap) * 1.25 } },
    Bard: { name: "Traveler's Call", note: 'Meeps on attacks (40 chimes assumed)', onHit: { type: 'magic', dmg: c => 0.6 * (147 + 0.3 * c.ap) } },
    // E (Royal Maelstrom): strikes of 18 + 12% AD (up to double on a low target), can crit, on-hit at 12-24%. It replaces 1.5s
    // of her attacks, so the fight is run with and without it and the better one is kept (optional).
    // Lavender: +70% attack speed stands in for about 38 stacks at level 18 (1.85% each) plus post-ability attack speed.
    Belveth: { name: 'Death in Lavender', note: 'Lavender stacks + post-ability attack speed; E used only when it adds damage', stats: () => ({ as: 70 }), optional: ['E'] },
    Blitzcrank: none('Mana Barrier', 'Shield only'),
    Brand: { name: 'Blaze', note: 'Burns, then detonates at 3 stacks', onAbility: { type: 'magic', dot: 4, dmg: c => 0.03 * c.tmax },
      everyNAbility: { n: 3, cd: 4, type: 'magic', dmg: c => (0.12 + 0.02 * c.ap / 100) * c.tmax } },
    Braum: { name: 'Concussive Blows', note: '4th hit stuns and deals damage', everyN: { n: 4, cd: 8, type: 'magic', dmg: () => 196 } },
    Briar: { castDebuff: { Q: { armor: 0.2, mr: 0.2, dur: 5 } }, name: 'Crimson Curse', note: 'Stacking bleed from attacks and abilities', stackDot: { max: 5, dur: 5, type: 'physical', perStack: c => (25 + 0.05 * c.bad) / 5 } },
    Caitlyn: { name: 'Headshot', note: 'Every 6th attack, and after a net/trap hit', everyN: { n: 6, type: 'physical', dmg: c => c.ad * (1.2 + c.crit * 1.3125 * (c.cm / 1.75)) },
      afterAbility: { cd: 10, type: 'physical', dmg: c => c.ad * (1.2 + c.crit * 1.3125 * (c.cm / 1.75)) } },
    Camille: { name: 'Adaptive Defenses', note: 'Q empowered attacks, the second part true damage', timedAuto: { every: 4, label: 'Q · Precision Protocol', kind: 'ability', dmg: c => ({ physical: 0.3 * c.ad, true: 0.5 * c.ad }) },
      // R (Hextech Ultimatum) cast at the start: attacks deal 15 + 8% current HP magic for 4s.
      onHit: { cond: c => c.t >= 0.5 && c.t <= 4.5, label: 'R · Hextech Ultimatum', kind: 'ability', type: 'magic', dmg: c => 15 + 0.08 * c.thp } },
    Cassiopeia: none('Serpentine Grace'),
    Chogath: none('Carnivore', 'Healing only'),
    Corki: { castDebuff: { E: { armorFlat: 20, mrFlat: 20, dur: 4 } }, name: 'Hextech Munitions', note: 'Attacks deal 80% magic damage', autoSplit: { magic: 0.8 } },
    Darius: { name: 'Hemorrhage', note: 'Stacking bleed; Noxian Might at 5 stacks', stackDot: { max: 5, dur: 5, type: 'physical', perStack: c => (30 + 0.3 * c.bad) / 5 },
      stats: () => ({ ad: 160 }) },
    Diana: { name: 'Moonsilver Blade', note: 'Every 3rd attack + attack speed', stats: () => ({ as: 20 }), everyN: { n: 3, type: 'magic', dmg: c => 250 + 0.5 * c.ap } },
    Draven: { name: 'Spinning Axe (Q)', note: 'Juggled axes empower every attack; Q is modeled here', disable: ['Q'],
      everyN: { n: 1, type: 'physical', dmg: c => (60 + 1.15 * c.bad) * avgCrit(c) } },
    DrMundo: { name: 'Blunt Force Trauma (E)', note: 'E passive: +3.2% max HP as AD; empowered attack every 6s, up to +40% at low health',
      stats: c => ({ ad: 0.032 * c.hp }), timedAuto: { every: 6, resetsAttack: true, label: 'E · Blunt Force Trauma', kind: 'ability', type: 'physical', dmg: c => (45 + 0.05 * c.bhp) * (1 + 0.4 * Math.min(1, c.smiss / 0.7)) } },
    Ekko: { name: 'Z-Drive Resonance + Parallel Convergence (W)', note: 'Every 3rd hit; W passive: attacks on targets below 30% HP deal 3% (+3% per 100 AP) missing HP', everyNHits: { n: 3, cd: 5, type: 'magic', dmg: c => 85 + 0.8 * c.ap },
      onHit: { cond: c => c.thp < 0.3 * c.tmax, label: 'W · Parallel Convergence', type: 'magic', dmg: c => (0.03 + 0.03 * c.ap / 100) * c.tmiss } },
    // Game files, level 18 (R rank 4, basics rank 5). Human Q, W and E hits each give a dormant spiderling (up to 5),
    // which attack in Spider Form. Skittering Frenzy (spider W): +130% attack speed for Elise and her spiderlings for 3s
    // (cooldown 6s in the files). Rappel (spider E): Spider Queen's bonus damage +100% for 5s after landing (cooldown 18s).
    // She swaps forms (R, 3s cooldown) to keep both Qs on cooldown, so the spider bonus applies to every attack after 1s.
    Elise: (() => {
      const ling = ps => { ps.lings = Math.min(5, (ps.lings || 0) + 1); };
      const frenzy = c => c.t < (c.ps.frenzyUntil || 0);
      return { name: 'Spider Queen', note: 'Human Q, W and Cocoon each add a spiderling (up to 5); Spider form: Venomous Bite, Skittering Frenzy, Rappel, empowered attacks', ownKit: true,
        asBuffNow: c => frenzy(c) ? 130 : 0,
        onHit: { cond: c => c.t >= 1, label: 'Spider form attacks', kind: 'ability', type: 'magic', dmg: c => (44 + 0.15 * c.ap) * (c.t < (c.ps.rappelUntil || 0) ? 2 : 1) },
        periodic: [
          { every: 6, start: 0.3, ability: true, onFire: ling, label: 'Q · Neurotoxin', kind: 'ability', type: 'magic', dmg: c => 160 + (0.04 + 0.03 * c.ap / 100) * c.thp },
          { every: 12, start: 0.6, ability: true, onFire: ling, label: 'W · Volatile Spiderling', kind: 'ability', type: 'magic', dmg: c => 220 + 0.75 * c.ap },
          { every: 10, start: 0.8, ability: true, noDamage: true, onFire: ling, label: 'E · Cocoon', kind: 'ability', dmg: () => 0 },
          { every: 18, start: 1.0, ability: true, noDamage: true, onFire: (ps, t) => { ps.rappelUntil = t + 5; }, label: 'Spider E · Rappel', kind: 'ability', dmg: () => 0 },
          { every: 6, start: 1.1, ability: true, label: 'Spider Q · Venomous Bite', kind: 'ability', type: 'magic', dmg: c => 170 + (0.08 + 0.03 * c.ap / 100) * c.tmiss },
          { every: 6, start: 1.2, ability: true, noDamage: true, onFire: (ps, t) => { ps.frenzyUntil = t + 3; }, label: 'Spider W · Skittering Frenzy', kind: 'ability', dmg: () => 0 },
          // Spiderlings: about 1 attack per second each with Spider W's +25% passive; Frenzy's +130% roughly doubles that.
          { every: 0.5, start: 1.2, label: 'Spiderlings', kind: 'ability', type: 'magic', cond: c => c.ps.lings > 0,
            dmg: c => c.ps.lings * (40 + 0.15 * c.ap) / 2 * (frenzy(c) ? 2.04 : 1) },
        ] };
    })(),
    Evelynn: { castDebuff: { W: { mr: 0.45, dur: 4 } }, name: 'Demon Shade', note: 'E deals % max HP', periodic: { every: 8, start: 0.3, ability: true, label: 'E · Whiplash', kind: 'ability', type: 'magic', dmg: c => 180 + (0.03 + 0.015 * c.ap / 100) * c.tmax } },
    Ezreal: { name: 'Rising Spell Force', note: 'Attack speed from ability hits; Q applies on-hit and Spellblade', stats: () => ({ as: 45 }), onHitAbility: { Q: { spellblade: true } } },
    Fiddlesticks: { name: 'A Harmless Scarecrow', note: 'Q deals % current HP (min 120)', periodic: { every: 13, start: 0.5, ability: true, label: 'Q · Terrify', kind: 'ability', type: 'magic', dmg: c => Math.max(120, (0.06 + 0.03 * c.ap / 100) * c.thp) } },
    // R (Grand Challenge) marks all four vitals at once: four extra vital hits, used right away.
    Fiora: { name: "Duelist's Dance", note: 'Vitals: % max HP true damage; R reveals 4 more', periodic: [{ every: 4, start: 0.5, type: 'true', dmg: c => (0.03 + 0.045 * c.bad / 100) * c.tmax },
      ...[1, 1.8, 2.6, 3.4].map(s => ({ start: s, label: 'R · Grand Challenge', kind: 'ability', ult: s === 1, ability: s === 1, type: 'true', dmg: c => (0.03 + 0.045 * c.bad / 100) * c.tmax }))] },
    Fizz: none('Nimble Fighter'),
    Galio: { name: 'Colossal Smash', note: 'Empowered attack every few seconds', timedAuto: { every: 5, type: 'magic', dmg: c => 200 + c.ad + 0.5 * c.ap + 0.6 * c.bmr } },
    Gangplank: { name: 'Trial by Fire', note: 'Burning true-damage attack; Q applies on-hit and Spellblade', onHitAbility: { Q: { spellblade: true } }, timedAuto: { every: 12, type: 'true', dot: 2.5, dmg: c => 310 + c.bad } },
    Garen: { ...none('Perseverance', 'Regeneration only'), castDebuff: { E: { armor: 0.25, dur: 6, delay: 1.5 } } },
    // Mini Gnar's W (Hyper) is passive: every 3rd hit on the same target deals 40 + 100% AP + 14% of its max health (magic).
    // A 10s fight starting at no Rage stays in Mini form, so Mega Gnar's abilities and his R (Mega only) aren't used.
    // Mega line (like K'Sante's All Out): enough Rage to land one Mini W proc, then transform and use Mega Q, W, E and R
    // (shared cooldowns, so no Mini abilities first). The fight is run both ways and the better line is kept.
    Gnar: { name: 'Rage Gene + Hyper (W)', note: 'Every 3rd hit: 40 + 100% AP + 14% max health; Mega Gnar when it deals more', disable: ['W', 'R'],
      allOut: { slot: 'R', label: 'Mega Gnar', enable: ['W', 'R'], nHitsMax: 1, waitProc: true },
      everyNHits: { n: 3, label: 'W · Hyper', kind: 'ability', type: 'magic', dmg: c => 40 + c.ap + 0.14 * c.tmax } },
    Gragas: none('Happy Hour', 'Healing only'),
    Graves: { name: 'New Destiny', note: 'Shotgun pellets all hit; 2 shells then reload', autoMult: 1.99, magazine: { size: 2, reload: c => 1.6 / c.as } },
    Gwen: { name: 'A Thousand Cuts', note: '% max HP on attacks and abilities', onHit: { type: 'magic', dmg: c => (0.01 + 0.006 * c.ap / 100) * c.tmax },
      onAbility: { type: 'magic', dmg: c => (0.01 + 0.006 * c.ap / 100) * c.tmax } },
    Hecarim: { name: 'Warpath', note: 'AD from bonus move speed', stats: () => ({ ad: 17 }) },
    Heimerdinger: none('Hextech Affinity'),
    Hwei: { name: 'Signature of the Visionary', note: 'Second spell detonates his mark', everyNAbility: { n: 2, type: 'magic', dmg: c => 285 + 0.35 * c.ap } }, // game files: 285 + 35% AP at 18
    // Tentacles (game files, level 18): a slam deals 180 + 110% AD + 40% AP, +30% from Q's passive. They never attack on
    // their own: every W makes all of them slam, E makes them slam the spirit every 3s for 7s (77% echoes to the target),
    // and R adds one. She starts with 3 already placed around the fight before her ultimate (her passive places one per
    // stretch of nearby terrain, so there's no fixed cap; 3 is a full setup).
    Illaoi: { name: 'Prophet of an Elder God', note: 'Starts with 3 Tentacles; they slam with every W and at the spirit during E; R adds one',
      tentacles: { start: 3, slam: c => (180 + 1.1 * c.ad + 0.4 * c.ap) * 1.3, wSlot: 'W', eSlot: 'E', eEvery: 3, eDur: 7, eEcho: 0.77, rSlot: 'R', rAdd: 1, rDur: 8 } },
    Irelia: { name: 'Ionian Fervor', note: 'Max stacks: attack speed + on-hit; Q applies on-hit', onHitAbility: { Q: {} }, stats: () => ({ as: 40 }), onHit: { type: 'magic', dmg: c => 61 + 0.2 * c.bad } },
    Ivern: none('Friend of the Forest'),
    Janna: { name: 'Tailwind', note: 'Bonus damage from move speed', onHit: { type: 'magic', dmg: () => 25 } },
    JarvanIV: { castDebuff: { Q: { armor: 0.26, dur: 3 } }, name: 'Martial Cadence', note: '8% current HP on the first attack', timedAuto: { every: 6, type: 'physical', dmg: c => 0.08 * c.thp } },
    Jax: { name: 'Relentless Assault', note: 'Attack speed stacks', stats: () => ({ as: 70 }) },
    Jayce: { name: 'Hextech Capacitor', note: 'Cannon: Shock Blast through the gate + Hyper Charge; Hammer: To the Skies!, Lightning Field, Thundering Blow', ownKit: true,
      periodic: [
        { every: 8, start: 0.3, ability: true, label: 'Cannon Q · Shock Blast (gate)', kind: 'ability', type: 'physical', dmg: c => 341.6 + 1.82 * c.bad },
        { every: 6.6, start: 0.6, ability: true, label: 'Cannon W · Hyper Charge', kind: 'ability', type: 'physical', dmg: c => 1.5 * c.ad },
        { every: 6, start: 1.0, ability: true, label: 'R · Transform', kind: 'ability', type: 'magic', dmg: () => 169 },
        { every: 8, start: 1.3, ability: true, label: 'Hammer Q · To the Skies!', kind: 'ability', type: 'physical', dmg: c => 260 + 1.35 * c.bad },
        { every: 10, start: 1.6, ability: true, key: 'jayW', dot: 4, label: 'Hammer W · Lightning Field', kind: 'ability', type: 'magic', dmg: c => 380 + c.ap },
        { every: 12, start: 1.9, ability: true, label: 'Hammer E · Thundering Blow', kind: 'ability', type: 'magic', dmg: c => 0.192 * c.tmax + c.bad },
      ] },
    Jhin: { name: 'Whisper', note: 'Locked attack speed; bonus AS and crit become AD; 4th shot always crits + 25% missing HP',
      fixedAS: true, critScale: 0.75,
      // TotalADPercent from the game files: 44% at level 18 + 0.35 x crit chance + 0.3 x bonus attack speed.
      // Jhin's 3%-per-level attack speed growth also counts as bonus attack speed.
      stats: c => ({ ad: c.ad * (0.44 + 0.35 * c.crit + 0.3 * (c.bas + 0.51)) }),
      magazine: { size: 4, reload: 2.5 },
      everyN: { n: 4, crit: true, minCrit: 1.5, type: 'physical', dmg: c => 0.25 * c.tmiss } },
    Jinx: { name: 'Get Excited!', note: 'Minigun attack speed stacks (Q)', stats: () => ({ as: 50 }) },
    Kaisa: { name: 'Caustic Wounds', note: 'Plasma on-hit; ruptures at 5 stacks', onHit: { type: 'magic', dmg: c => 46 + 0.18 * c.ap },
      everyNHits: { n: 5, type: 'magic', dmg: c => (0.15 + 0.06 * c.ap / 100) * c.tmiss + 50 } },
    // Rend (game files, rank 5): first spear 45 + 70% AD + 65% AP, each extra spear 35 + 50% AD + 50% AP; 8s cooldown.
    // Spears come from every attack, Guinsoo's extra hits and Pierce (Q); the timing is handled in the engine.
    Kalista: { name: 'Martial Poise + Rend (E)', note: 'Attacks deal 90% AD; Rend rips out every spear, timed for the most damage', autoMult: 0.9, disable: ['E'],
      rend: { label: 'E · Rend', cd: 8, fromSlot: 'Q', first: c => 45 + 0.7 * c.ad + 0.65 * c.ap, extra: c => 35 + 0.5 * c.ad + 0.5 * c.ap } },
    Karma: none('Gathering Fire'),
    Karthus: { ...none('Death Defied'), castDebuff: { W: { mr: 0.25, dur: 5, auto: true } } },
    Kassadin: none('Void Stone'),
    // Katarina: Q and W drop daggers that she picks up (Q's lands behind the target about 1.1s later, W's about 1.25s).
    // Voracity at level 18: 240 + 60% bonus AD + 100% AP magic, applies on-hit effects, and cuts E's cooldown by 96% of
    // its base (8s at rank 5 = 7.68s). Takedowns (dummy kills) take 15s off her ability cooldowns.
    Katarina: { name: 'Voracity', note: 'Dagger pickups (on-hit) reset Shunpo; kills reset cooldowns',
      daggers: { from: { Q: 1.1, W: 1.25 }, type: 'magic', dmg: c => 240 + 0.6 * c.bad + c.ap, onHit: true, eReduce: 7.68 },
      killReset: { cd: 15, slots: ['Q', 'W', 'E'] } },
    Kayle: { castDebuff: { Q: { armor: 0.15, mr: 0.15, dur: 4 } }, name: 'Divine Ascent', note: 'Exalted at 16: attack waves + attack speed', stats: () => ({ as: 30 }), onHit: { type: 'magic', dmg: c => 50 + 0.25 * c.ap + 0.1 * c.bad } },
    Kayn: none('The Darkin Scythe'),
    Kennen: none('Mark of the Storm'),
    Khazix: { name: 'Unseen Threat', note: 'Attack out of stealth', timedAuto: { every: 10, type: 'magic', dmg: c => 150 + 0.5 * c.bad } }, // game data: 50% bonus AD
    Kindred: none('Mark of the Kindred', 'Marks are counted in her abilities'),
    Kled: none('Skaarl the Cowardly Lizard'),
    KogMaw: { castDebuff: { Q: { armor: 0.32, mr: 0.32, dur: 4 } }, name: 'Bio-Arcane Barrage (W)', note: 'W on-hit % max HP (8s of the fight) + Q attack speed; W is modeled here', disable: ['W'],
      stats: () => ({ as: 26 }), onHit: { type: 'magic', dmg: c => 0.8 * (0.06 + 0.01 * c.ap / 100) * c.tmax } },
    // Game files: the mark deals 12 + 1-2% (by level: 2% at 18) of the target's max health; it doesn't scale with resists.
    // All Out (R, rank 3, game files): for its 15s (the whole fight) +80% attack speed, 50% bonus armor penetration (the
    // dummy's armor is bonus armor, as in Practice Tool), and attacks, abilities and the passive deal +1% max health; it costs
    // 35% max health and 85% of his bonus armor and magic resist. The engine runs the fight with and without it and keeps
    // the better one (a full tank usually does more without it).
    KSante: { name: 'Dauntless Instinct', note: 'Abilities mark: next attack 12 + 2% max HP; W deals % max HP; All Out when it deals more',
      allOut: { slot: 'R', label: 'R · All Out', as: 80, bonusArpen: 50, extraPct: 0.01, healthLost: 0.35, defensesLost: 0.85 },
      afterAbility: { type: 'physical', dmg: c => 12 + 0.02 * c.tmax + (c.ps.allOut ? 0.01 * c.tmax : 0) },
      periodic: { every: 10, start: 0.5, ability: true, label: 'W · Path Maker', kind: 'ability', type: 'physical', dmg: c => 205 + 0.08 * c.tmax } },
    Leblanc: none('Mirror Image'),
    LeeSin: { name: 'Flurry', note: 'Attack speed after abilities', stats: () => ({ as: 25 }) },
    Leona: none('Sunlight', 'Procs for allies'),
    Lillia: { name: 'Dream-Laden Bough', note: 'Abilities burn % max HP', onAbility: { type: 'magic', dot: 3, dmg: c => (0.05 + 0.012 * c.ap / 100) * c.tmax } }, // game data: 5% + 1.2% per 100 AP over 3s
    Lissandra: none('Iceborn Subjugation'),
    // Game files, level 18: attacks add 40 magic damage on-hit, rising to 80 as the target's health drops.
    Locke: { name: 'Silver Stake', note: 'On-hit, more vs low HP', onHit: { type: 'magic', dmg: c => 40 * (1 + c.tmiss / c.tmax) } },
    Lucian: { name: 'Lightslinger', note: 'Double shot after abilities', afterAbility: { extraAttack: 1.0 } },
    Lulu: { name: 'Pix, Faerie Companion', note: 'Pix bolts on attacks', onHit: { type: 'magic', dmg: c => 117 + 0.15 * c.ap } },
    Lux: { name: 'Illumination', note: 'Ability marks detonate', onAbility: { type: 'magic', dmg: c => 190 + 0.2 * c.ap } },
    Malphite: none('Granite Shield', 'Shield only'),
    Malzahar: none('Void Shift'),
    Maokai: none('Sap Magic', 'Healing only'),
    // Highlander (R) passive: a kill cuts Q, W and E's remaining cooldowns by 70% and extends the ultimate by 7s.
    MasterYi: { name: 'Double Strike', note: 'Every 4th attack strikes twice; kills extend Highlander and refresh abilities',
      killReset: { pct: 0.7, slots: ['Q', 'W', 'E'], extendAS: 7 }, everyN: { n: 4, extraOnHit: true, type: 'physical', dmg: c => 0.5 * c.ad * avgCrit(c) } },
    // Game files, level 18: after an ability her next attack fires 3 missiles of 30 + 4% AP. Overwhelm: her abilities and
    // missiles stack it (Q's 10 projectiles, E's hits; 5s, refreshed); the dummy is executed below 80 + 10% AP plus
    // 5 + 0.75% AP per stack. W only reflects incoming attacks, so it does nothing to the dummy.
    Mel: { name: 'Searing Brilliance + Overwhelm', note: 'Missiles after abilities; Overwhelm stacks execute and power up R', disable: ['W'],
      afterAbility: { type: 'magic', dmg: c => 3 * (30 + 0.04 * c.ap) },
      overwhelm: { per: { Q: 13, E: 7, A: 1 }, dur: 5 }, // A: each basic attack
      executeHp: c => { const n = c.ps.ow && c.t <= c.ps.ow.until ? c.ps.ow.n : 0; return n ? 80 + 0.1 * c.ap + n * (5 + 0.0075 * c.ap) : 0; } },
    Milio: none('Fired Up!', 'Buffs allies'),
    MissFortune: { name: 'Love Tap', note: 'First attack on a new target', timedAuto: { once: true, type: 'physical', dmg: c => c.ad } },
    MonkeyKing: none('Stone Skin'),
    Mordekaiser: { castDebuff: { R: { armor: 0.1, mr: 0.1, dur: 7, auto: true } }, name: 'Darkness Rise', note: 'Damage aura after 3 hits', aura: { hits: 3, linger: 4, type: 'magic', dmg: c => 5 + 0.3 * c.ap + 0.05 * c.tmax } },
    Morgana: none('Soul Siphon', 'Healing only'),
    Naafiri: { name: 'We Are More', note: 'Packmates attack with her', periodic: { every: 1, start: 0.5, type: 'physical', dmg: c => 2 * (15 + 0.06 * c.bad) } }, // 2 packmates, about 29 per hit at 230 bonus AD (game data)
    Nami: none('Surging Tides'),
    Nasus: { castDebuff: { E: { armor: 0.5, dur: 5 } }, name: 'Soul Eater', note: 'Q stacks are counted in his Q; R burns % max HP every second', periodic: { every: 1, start: 0.5, label: 'R · Fury of the Sands', kind: 'ability', type: 'magic', dmg: c => (0.05 + 0.01 * c.ap / 100) * c.tmax } },
    Nautilus: { name: 'Staggering Blow', note: 'First attack on a target', timedAuto: { every: 10, type: 'physical', dmg: () => 122 } },
    Neeko: { name: 'Inherent Glamour', note: '20% magic pen for 4s after her disguise breaks (opening)', stats: () => ({ mpen: 20 * 4 / 10 }) },
    // Form champions: both forms are used every rotation (cast, swap, cast again), from game-file formulas at 18.
    Nidalee: { name: 'Prowl + Aspect of the Cougar', note: 'Javelin at max range, then Cougar Takedown, Pounce (reset on hunted) and Swipe', ownKit: true,
      periodic: [
        { every: 6, start: 0.3, ability: true, label: 'Q · Javelin Toss (max range)', kind: 'ability', type: 'magic', dmg: c => 487.5 + 1.625 * c.ap },
        { every: 9, start: 0.6, ability: true, key: 'nidW', dot: 4, label: 'W · Bushwhack', kind: 'ability', type: 'magic', dmg: c => 200 + 0.2 * c.ap },
        { every: 6, start: 1.0, ability: true, label: 'Cougar Q · Takedown', kind: 'ability', type: 'magic', dmg: c => (155 + 0.75 * c.bad + 0.4 * c.ap) * 1.4 * (1 + 0.75 * c.tmiss / c.tmax) },
        { every: 6, start: 1.3, ability: true, label: 'Cougar W · Pounce (x2, hunted)', kind: 'ability', type: 'magic', dmg: c => 2 * (170 + 0.5 * c.bad + 0.3 * c.ap) },
        { every: 6, start: 1.6, ability: true, label: 'Cougar E · Swipe', kind: 'ability', type: 'magic', dmg: c => 250 + 0.7 * c.bad + 0.55 * c.ap },
      ] },
    Nilah: none('Joy Unending'),
    Nocturne: { name: 'Umbra Blades', note: 'Empowered cleave', timedAuto: { every: 8, type: 'physical', dmg: c => 0.2 * c.ad } },
    Nunu: { name: 'Call of the Freljord', note: '+20% attack speed (game data)', stats: () => ({ as: 20 }) },
    // Olaf: attack speed from missing health (maxes at 30% health). R (Ragnarok) active: +30 AD + 25% of total AD (rank 3),
    // kept up all fight because every attack or E on a champion extends it by 2.5s; it deals no damage itself.
    Olaf: { castDebuff: { Q: { armor: 0.2, dur: 4 } }, name: 'Berserker Rage + Ragnarok', note: 'Attack speed from missing health; R: +30 AD + 25% AD',
      stats: c => ({ as: 100 * Math.min(1, c.smiss / 0.7), ad: 30 + 0.25 * c.ad }) },
    Orianna: { name: 'Clockwork Windup', note: 'On-hit, stacking on repeated attacks', onHit: { type: 'magic', dmg: c => (59 + 0.15 * c.ap) * 1.4 } },
    Ornn: none('Living Forge'),
    // Mortal Will: every 5 actions (attacks and abilities) empower his next Q: +70% on the close-range stab (game data).
    // Standard rotation: Mortal Will starts full (it builds out of combat) and goes on W: stun plus 3 extra strikes. Those
    // strikes and W count toward the next Mortal Will, so after one attack Q goes out empowered (+70% on the thrust); then
    // every 5 attacks/abilities. R isn't used mid-fight (2.5s leap) but its passive gives 30% armor penetration.
    // E (1.5s shield channel) is used only when it adds damage.
    Pantheon: { name: 'Mortal Will', note: 'Empowered W opener, empowered Q right after, then every 5 actions; R passive 30% armor pen',
      empowerAfter: { actions: 5, slot: 'Q', mult: 1.7, start: true, open: 'W', waitOne: true },
      stats: () => ({ arpen: 30 }), disable: ['R'], optional: ['E'] },
    Poppy: { name: 'Iron Ambassador', note: 'Thrown buckler attack', timedAuto: { every: 7, type: 'magic', dmg: () => 180 } },
    Pyke: { name: 'Gift of the Drowned Ones', note: 'Bonus HP turns into AD', stats: c => ({ ad: c.bhp / 14, hp: -c.bhp }) },
    // W (Terrashape) enchants her for the fight: +35% attack speed and every attack deals 40 + 20% bonus AD + 45% AP magic.
    Qiyana: { name: 'Royal Privilege + Terrashape (W)', note: 'First hit on a new target; W enchant: attack speed and on-hit damage', disable: ['W'],
      stats: () => ({ as: 35 }), onHit: { label: 'W · Terrashape', kind: 'ability', type: 'magic', dmg: c => 40 + 0.2 * c.bad + 0.45 * c.ap },
      timedAuto: { once: true, type: 'physical', dmg: c => 117 + 0.55 * c.bad + 0.45 * c.ap } },
    Quinn: { name: 'Harrier', note: 'Valor marks the target', timedAuto: { every: 6, type: 'physical', dmg: c => 100 + 0.5 * c.ad } },
    Rakan: { name: 'Fey Feathers', note: 'R damage', periodic: { start: 0.5, label: 'R · The Quickness', kind: 'ability', type: 'magic', dmg: c => 300 + 0.5 * c.ap } },
    Rammus: { name: 'Spiked Shell', note: 'On-hit from armor', onHit: { type: 'magic', dmg: c => 30 + 0.1 * c.barm } },
    RekSai: { name: 'Fury of the Xer', note: 'Q empowers 3 attacks', timedAuto: { every: 4, label: "Q · Queen's Wrath", kind: 'ability', type: 'physical', dmg: c => 3 * (45 + 0.5 * c.bad) } },
    Rell: { name: 'Break the Mold', note: 'E deals % max HP', periodic: { every: 12, start: 0.5, label: 'E · Attract and Repel', kind: 'ability', type: 'magic', dmg: c => 0.03 * c.tmax } },
    Renata: { name: 'Leverage', note: '% max HP on attacks', onHit: { type: 'magic', dmg: c => 0.01 * c.tmax } },
    // Reign of Anger: attacks build 5 Fury and each ability hit 10 (R: 20 on cast, then 5 a second), +50% below half health
    // (he fights at 40%). At 50 Fury his next ability is the Fury version (no Fury gained); W gets it first.
    Renekton: { name: 'Reign of Anger', note: 'Fury from attacks and abilities (+50% at low health); 50 Fury empowers an ability, W first',
      fury: { start: 0, perAttack: 5, lowHpMult: 1.5, perSlot: { Q: 10, W: 10, E: 10 }, prefer: 'W', rSlot: 'R', rOnCast: 20, rPerSec: 5 } },
    // Rengar: Bonetooth Necklace fully stacked (5 trophies = +25% bonus AD). Ferocity: +1 per ability cast, max 4; at max
    // his next ability is empowered. He opens at max Ferocity (from brush or R) and always spends it on empowered Q,
    // which ignores Q's cooldown: next attack deals the empowered bonus and grants attack speed for 5s.
    Rengar: { name: 'Unseen Predator', note: '5 trophies (+25% bonus AD); Ferocity empowers Q', stats: c => ({ ad: 0.25 * c.bad }),
      ferocity: { max: 4, start: 4, slot: 'Q', calc: '{d4a43abe}', asCalc: 'EmpoweredQAS', asDur: 5 },
      castDebuff: { R: { armorFlat: 25, dur: 4, auto: true } } },
    // R (Blade of the Exile) is used at the start: +20% attack damage for 15s, the whole fight (Wind Slash is in abilities.js).
    Riven: { name: 'Runic Blade + Blade of the Exile', note: 'Charged attacks after abilities; R +20% AD', stats: c => ({ ad: 0.2 * c.ad }),
      afterAbility: { charges: 1, max: 3, type: 'physical', dmg: c => 0.6 * c.ad } },
    Rumble: { name: 'Junkyard Titan', note: 'Overheated attacks (part-time)', onHit: { type: 'magic', dmg: c => 0.4 * (50 + 0.3 * c.ap + 0.06 * c.tmax) } },
    Ryze: none('Arcane Mastery'),
    Samira: { name: 'Daredevil Impulse', note: 'Melee attacks: % missing HP', onHit: { type: 'magic', dmg: c => 20 + 0.1 * c.bad + 0.08 * c.tmiss } },
    Sejuani: none('Fury of the North'),
    Senna: { name: 'Absolution', note: 'Mist stacks counted; souls on attacks', everyN: { n: 3, type: 'physical', dmg: c => 0.04 * c.thp } },
    Seraphine: { name: 'Stage Presence', note: 'Every 3rd ability echoes; notes on attacks', everyNAbility: { n: 3, echo: 1 },
      onHit: { type: 'magic', dmg: c => 25 + 0.04 * c.ap } },
    Sett: { name: 'Pit Grit', note: 'Every other punch is stronger; Q empowers 2 punches with % max HP', everyN: { n: 2, type: 'physical', dmg: c => 90 + 0.5 * c.bad },
      timedAuto: { every: 5, label: 'Q · Knuckle Down', kind: 'ability', type: 'physical', dmg: c => 2 * (50 + (0.01 + 0.0003 * c.ad) * c.tmax) } },
    Shaco: { name: 'Backstab', note: 'Always attacking from behind: 35 + 20% bonus AD bonus damage, once every 3s per target (game data)', timedAuto: { every: 3, type: 'physical', dmg: c => 35 + 0.2 * c.bad } },
    Shen: none('Ki Barrier', 'Shield only'),
    Shyvana: none('Fury of the Dragonborn'),
    Singed: none('Noxious Slipstream'),
    Sion: { ...none('Glory in Death'), castDebuff: { E: { armor: 0.25, dur: 4 } } },
    Sivir: none('Fleet of Foot'),
    // Quaking: 3 stacks burn 9% max health (at level 18) as magic damage over 4s.
    Skarner: { name: 'Threads of Vibration', note: '3 hits: 9% max HP burn over 4s', everyNHits: { n: 3, cd: 4, dot: 4, type: 'magic', dmg: c => 0.09 * c.tmax } },
    Smolder: none('Dragon Practice', 'Stacks are counted in his abilities'),
    // Power Chord: every 3rd ability empowers her next attack. She casts W and E (no damage of their own: heal/shield and
    // speed) so it comes up, and Q last, so the chord is Staccato (+50% damage: 330 + 30% AP).
    Sona: { name: 'Power Chord', note: 'Every 3rd ability (W and E count) empowers an attack; Q last for Staccato (+50%)', everyNAbility: { n: 3, type: 'magic', label: 'Passive · Power Chord (Staccato)', dmg: c => 1.5 * (220 + 0.2 * c.ap) } },
    Soraka: none('Salvation'),
    Swain: none('Ravenous Flock', 'Soul fragments are counted in his stats'),
    Sylas: { name: 'Petricite Burst', note: 'Next attack after an ability', afterAbility: { type: 'magic', dmg: c => 0.3 * c.ad + 0.25 * c.ap } },
    Syndra: none('Transcendent'),
    TahmKench: { name: 'An Acquired Taste', note: 'Bonus damage from bonus HP', onHit: { type: 'magic', dmg: c => 60 + 0.04 * c.bhp },
      onAbility: { type: 'magic', dmg: c => 60 + 0.04 * c.bhp },
      periodic: { start: 1, label: 'R · Devour', kind: 'ability', type: 'magic', dmg: c => 400 + (0.15 + 0.07 * c.ap / 100) * c.tmax } },
    Taliyah: none('Rock Surfing'),
    Talon: { name: "Blade's End", note: '3 ability hits: bleed', everyNAbility: { n: 3, cd: 6, dot: 2, type: 'physical', dmg: c => 245 + 2 * c.bad } },
    Taric: { name: 'Bravado', note: 'Two empowered attacks after abilities', afterAbility: { charges: 2, type: 'magic', dmg: c => 100 + 0.15 * c.barm } },
    Teemo: { name: 'Toxic Shot (E)', note: 'On-hit poison; E is passive', disable: ['E'],
      onHit: { type: 'magic', dmg: c => 50 + 0.3 * c.ap } , everyN: { n: 1, dot: 4, type: 'magic', dmg: c => 96 + 0.4 * c.ap } },
    Thresh: { name: 'Flay (E)', note: 'Charged attack damage + souls', onHit: { type: 'magic', dmg: c => 63 + 0.5 * c.ad } },
    Tristana: none('Draw a Bead'),
    Trundle: { castDebuff: { R: { armor: 0.4, mr: 0.4, dur: 8, delay: 1 } }, name: "King's Tribute", note: 'R drains 30% max HP over 4s; W zone: +110% attack speed for 8s', stats: () => ({ as: 110 * 0.8 }), periodic: { start: 0.5, dot: 4, label: 'R · Subjugate', kind: 'ability', type: 'magic', dmg: c => (0.30 + 0.02 * c.ap / 100) * c.tmax } },
    Tryndamere: { name: 'Battle Fury + Bloodlust (Q)', note: 'Crit chance from fury; Q passive AD from missing health', stats: c => ({ crit: 30, ad: 80 * c.smiss }) }, // game files: up to 80 AD at rank 5, scaling with missing health
    // E (Stacked Deck) is passive (game files, rank 5): +55% attack speed, and every 4th attack deals 165 + 40% AP + 20% bonus AD.
    TwistedFate: { name: 'Stacked Deck (E)', note: 'Every 4th attack; E is passive', disable: ['E'], stats: () => ({ as: 55 }),
      everyN: { n: 4, label: 'E · Stacked Deck', kind: 'ability', type: 'magic', dmg: c => 165 + 0.4 * c.ap + 0.2 * c.bad } },
    Twitch: { name: 'Deadly Venom', note: 'Stacking true-damage poison', stackDot: { max: 6, dur: 6, type: 'true', perStack: c => 6 + 0.03 * c.ap } },
    // Udyr rotates all four stances every 6s (1.5s apart): every cast triggers Bridge Between's attack speed, and Q adds
    // +68% for 4s (game data, rank 5). One stance is awakened every other rotation: Q for AD builds, R for AP builds.
    Udyr: { name: 'Bridge Between (Awaken)', note: 'Rotates Q, E, W, R every 6s (each cast grants attack speed); awakens Q (AD) or R (AP) every other rotation', ownKit: true,
      // Q: +68% for 4 of every 6s; passive after each of 4 casts per rotation: about +40% kept up; awakened Q: +70% for 4 of 12s.
      stats: c => ({ as: 68 * 4 / 6 + 40 + (c.ap > c.bad ? 0 : 70 * 4 / 12) }),
      periodic: [
        // Q empowers the next 2 attacks (on-hit claws), so Guinsoo phantom hits and Dusk and Dawn repeat them.
        { every: 6, start: 0.3, ability: true, charges: 2, label: 'Q · Wilding Claw', kind: 'ability', type: 'physical', dmg: c => (30 + 0.2 * c.bad) + (0.035 + 0.0002 * c.bad) * c.tmax }, // per claw: 3.5% (+2% per 100 bonus AD) max HP
        { every: 12, start: 0.3, label: 'Q · Awakened lightning', kind: 'ability', type: 'magic', dmg: c => c.ap > c.bad ? 0 : 6 * 0.03 * c.tmax },
        { every: 6, start: 1.8, ability: true, noDamage: true, label: 'E · Blazing Stampede', kind: 'ability', dmg: () => 0 },
        { every: 6, start: 3.3, ability: true, noDamage: true, label: 'W · Iron Mantle', kind: 'ability', dmg: () => 0 },
        { every: 6, start: 4.8, ability: true, key: 'udR', dot: 4, label: 'R · Wingborne Storm', kind: 'ability', type: 'magic', dmg: c => 4 * (68 + 0.35 * c.ap) },
        { every: 12, start: 4.8, key: 'udR2', dot: 4, label: 'R · Awakened storm', kind: 'ability', type: 'magic', dmg: c => c.ap > c.bad ? 4 * (68 + 0.35 * c.ap) : 0 },
      ] },
    Urgot: { name: 'Echoing Flames', note: 'Leg shotguns; W machine gun', periodic: [{ every: 2.5, start: 0.5, type: 'physical', dmg: c => 0.4 * c.ad + 0.06 * c.tmax },
      { every: 1, start: 1, label: 'W · Purge', kind: 'ability', type: 'physical', dmg: c => 3 * (12 + 0.34 * c.ad) }] },
    Varus: { name: 'Blighted Quiver (W)', note: 'On-hit + blight detonated by abilities', disable: ['W'],
      onHit: { type: 'magic', dmg: c => 27 + 0.35 * c.ap }, onAbility: { cd: 6, type: 'magic', dmg: c => (0.10 + 0.02 * c.ap / 100) * c.tmax } },
    Vayne: none('Night Hunter', 'Move speed only (Silver Bolts is her W)'),
    Veigar: none('Phenomenal Evil Power', 'AP stacks are counted in his stats'),
    Velkoz: { name: 'Organic Deconstruction', note: '3 hits: true damage', everyNHits: { n: 3, type: 'true', dmg: c => 205 + 0.65 * c.ap } },
    Vex: { name: "Doom 'n Gloom", note: 'Empowered ability marks + detonates', onAbility: { cd: 12, type: 'magic', dmg: c => 140 + 0.2 * c.ap } },
    Vi: { name: 'Denting Blows (W)', note: 'Every 3rd attack % max HP; W is passive', disable: ['W'],
      everyN: { n: 3, debuff: { armor: 0.2, dur: 4 }, type: 'physical', dmg: c => (0.08 + c.bad / 3500) * c.tmax },
      timedAuto: { every: 5, label: 'E · Relentless Force', kind: 'ability', type: 'physical', dmg: c => 110 + 1.1 * c.ad + c.ap } },
    Viego: { name: 'Blade of the Ruined King (Q)', note: '% current HP on-hit', onHit: { type: 'physical', dmg: c => 0.08 * c.thp } },
    Viktor: none('Glorious Evolution'),
    Vladimir: { name: 'Crimson Pact', note: 'AP from bonus HP and HP from AP', stats: c => ({ ap: 0.033 * c.bhp, hp: 1.6 * c.ap }) },
    Volibear: { name: 'The Relentless Storm', note: 'Attack speed + chain lightning; R slam', stats: () => ({ as: 30 }), onHit: { type: 'magic', dmg: c => 50 + 0.4 * c.ap },
      periodic: { start: 0.5, label: 'R · Stormbringer', kind: 'ability', type: 'physical', dmg: c => 700 + 2.5 * c.bad + 1.25 * c.ap } },
    // Eternal Hunger on-hit, plus Blood Hunt (W) passive: +110% attack speed against targets below 50% health (game data, rank 5).
    Warwick: { name: 'Eternal Hunger + Blood Hunt', note: 'On-hit magic; +110% attack speed while the dummy is below 50% health', lowHpAS: { below: 0.5, as: 110 }, onHit: { type: 'magic', dmg: c => 46 + 0.15 * c.bad } },
    // Clean Cuts: after each ability her next 3 attacks (up to 5 stored) leave a feather; Q drops 2 and R 5. Feathers last 6s
    // and E (Bladecaller) pulls them all back through the target, each after the first dealing 5% less.
    Xayah: { name: 'Clean Cuts', note: 'Attacks after abilities, Q and R leave feathers; E recalls them all', feathers: { perCast: 3, max: 5, dur: 6, from: { Q: 2, R: 5 } } },
    Xerath: none('Mana Surge'),
    XinZhao: { name: 'Determination', note: 'Every 3rd attack', everyN: { n: 3, type: 'physical', dmg: c => 0.45 * c.ad } },
    Yasuo: { name: 'Way of the Wanderer', note: 'Double crit chance, crits deal 10% less; Q applies on-hit', onHitAbility: { Q: {} }, critChanceMult: 2, critScale: 0.9 },
    Yone: { name: 'Way of the Hunter', note: 'Double crit chance, crits deal 10% less; Q applies on-hit', onHitAbility: { Q: {} }, critChanceMult: 2, critScale: 0.9 },
    Yorick: { castDebuff: { E: { armor: 0.25, dur: 4 } }, name: 'Shepherd of Souls', note: 'Mist Walkers attack', periodic: { every: 1, start: 3, type: 'physical', dmg: c => 2 * (25 + 0.15 * c.ad) } },
    Yunara: { name: 'Vow of the First Lands', note: 'Crits deal bonus magic damage', onHit: { type: 'magic', dmg: c => c.crit * 0.3 * c.ad } },
    Yuumi: { name: "Bop 'n' Block", note: 'Empowered attack', timedAuto: { every: 8, type: 'magic', dmg: c => 100 + 0.15 * c.ap } },
    Zaahen: { name: 'Cultivation of War', note: 'Determination stacks: AD', stats: () => ({ ad: 35 }) },
    Zac: { name: 'Cell Division', note: 'W deals % max HP', periodic: { every: 4, start: 0.3, label: 'W · Unstable Matter', kind: 'ability', type: 'magic', dmg: c => 80 + (0.08 + 0.03 * c.ap / 100) * c.tmax } },
    // Living Shadow: the W shadow (5.25s, 16s cooldown) and the R shadow (7.5s) each throw their own Razor Shuriken at the
    // target for the reduced pass-through amount (game data: 144 + 60% bonus AD). Shadow E slashes don't stack damage.
    Zed: { name: 'Contempt for the Weak + shadows', note: 'Below 50% HP: 10% max HP; W and R shadows repeat Q', shadows: { slot: 'Q', calc: 'PassThroughDamage', w: { start: 0.1, every: 16, dur: 5.25 }, rDur: 7.5 },
      timedAuto: { every: 10, cond: c => c.thp < 0.5 * c.tmax, type: 'magic', dmg: c => 0.1 * c.tmax } },
    // Zeri attacks with Q (Burst Fire, game files rank 5): each shot deals 38 + 110% AD (can crit, applies on-hit) instead of
    // a normal attack, on her attack timer. Her attack speed is capped at 1.5; every 1% of bonus attack speed past it gives
    // 0.6 AD (about 128% bonus attack speed reaches the cap).
    Zeri: { name: 'Living Battery + Burst Fire (Q)', note: 'Attacks are Q shots (38 + 110% AD); attack speed capped at 1.5, extra turns into AD', disable: ['Q'],
      asCap: 1.5, autoMult: c => (38 + 1.1 * c.ad) / c.ad, stats: c => ({ ad: 0.6 * Math.max(0, c.bas * 100 - 128) }) },
    Ziggs: { name: 'Short Fuse', note: 'Empowered attack after abilities', timedAuto: { every: 12, abilityCdr: 4, type: 'magic', dmg: c => 128 + 0.5 * c.ap } },
    Zilean: none('Time in a Bottle'),
    Zoe: { name: 'More Sparkles!', note: 'Next attack after an ability', disable: ['W'], afterAbility: { type: 'magic', dmg: c => 130 + 0.2 * c.ap } },
    // Plants: every Q grows 2 seeds and every E 1 into plants that attack once a second for 8s (game data: 75 + 20% AP).
    Zyra: { name: 'Garden of Thorns', note: 'Q grows 2 plants, E grows 1; plants attack for 8s (extra plants on one target deal 50%)', summon: { from: { Q: 2, E: 1 }, dur: 8, extraMult: 0.5, label: 'Plants', type: 'magic', dmg: c => 75 + 0.2 * c.ap } },
  };

  root.Potenshall = root.Potenshall || {};
  root.Potenshall.ChampPassives = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
