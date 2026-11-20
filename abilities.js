/* Potenshall Damage — real ability data from CommunityDragon (Riot's raw game files).
   Loads a champion's Q/W/E/R formulas and evaluates them with level-18 stats. */
(function (root) {
  'use strict';

  const CDRAGON = 'https://raw.communitydragon.org/latest/game/data/characters';
  const REF = '{f3cbe7b2}';          // "use another spell calculation" part
  const BOT_DAMAGE = '{6d548702}';   // BotData: the bot AI's estimate of a cast's total damage
  const OF_TARGET = '{a8cb9c14}';    // flag: stat belongs to the target, not the caster
  const SLOTS = ['Q', 'W', 'E', 'R'];
  const cache = new Map();

  // ---------- Loading ----------
  // Ability data is hosted with the site in kits/ (tools/update-kits.ps1, once per patch). It's used only while
  // kits/manifest.json is for the current patch (setPatch); otherwise, or if a file is missing, CommunityDragon is used.
  // kitBase: 'kits' on the site; the leaderboard Worker sets the site's full address.
  let kitBase = 'kits', currentPatch = null, manifestP = null;
  const minor = p => String(p || '').split('.').slice(0, 2).join('.');
  const getJson = async (url, ms) => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
    try {
      const res = await fetch(url, ctl ? { signal: ctl.signal } : {});
      if (!res.ok) throw new Error(`${res.status} for ${url}`);
      return await res.json();
    } finally { if (timer) clearTimeout(timer); }
  };
  const hostedManifest = () => manifestP || (manifestP = getJson(`${kitBase}/manifest.json`, 8000).catch(() => null));
  async function hostedKitUsable(champId) {
    const m = await hostedManifest();
    if (!m || !Array.isArray(m.champions) || !m.champions.includes(champId)) return false;
    if (currentPatch && minor(m.patch) !== minor(currentPatch)) {
      if (!hostedKitUsable.warned) { hostedKitUsable.warned = true; console.warn(`kits/ is for patch ${m.patch}, game is on ${currentPatch}: using CommunityDragon. Run tools/update-kits.ps1.`); }
      return false;
    }
    return true;
  }

  async function loadKit(champId) {
    if (cache.has(champId)) return cache.get(champId);
    const p = (async () => {
      const id = champId.toLowerCase();
      let bin = null, lastErr = null;
      if (await hostedKitUsable(champId)) {
        try { bin = await getJson(`${kitBase}/${id}.json`, 10000); } catch (e) { lastErr = e; }
      }
      // CommunityDragon is sometimes slow or stalls: each try gets a time limit, and a failed try is retried twice.
      for (let attempt = 0; attempt < 3 && !bin; attempt++) {
        if (attempt) await new Promise(r => setTimeout(r, 1000 * attempt));
        try { bin = await getJson(`${CDRAGON}/${id}/${id}.bin.json`, 12000); } catch (e) { lastErr = e; }
      }
      if (!bin) throw lastErr || new Error(`Ability data unavailable for ${champId}`);
      const kit = parseKit(bin, champId);
      if (kit) kit.id = champId;
      return kit;
    })();
    cache.set(champId, p);
    p.catch(() => cache.delete(champId));
    return p;
  }

  // Champions whose real spells live outside their four ability slots. Each slot lists the game-file spells it can
  // cast and which formula is that spell's damage; at cast time the strongest one is used, as a player would.
  const VARIANTS = {
    Hwei: {
      Q: [['HweiQQ', 'Damage'], ['HweiQW', 'Damage'], ['HweiQE', 'Damage']],   // Devastating Fire / Severing Bolt / Molten Fissure
      W: [['HweiWE', 'TotalOnHitDamage']],                                     // Pulse of Visionary: empowered attacks
      E: [['HweiEQ', 'Damage'], ['HweiEW', 'Damage'], ['HweiEE', 'Damage']],   // Grim Visage / Gaze of the Abyss / Stirring Torrent
    },
  };
  // A few champions list their spells out of Q/W/E/R order in the game data.
  const SLOT_ORDER = { Naafiri: ['Q', 'R', 'E', 'W'] };
  const effects = sp => (sp.mEffectAmount || []).map(e => e.value || []);
  // Data value names are matched exactly first, then ignoring case (Lissandra's formula asks for 'Damage', data has 'damage').
  const dvGet = (dv, name) => dv[name] || (name && dv[Object.keys(dv).find(k => k.toLowerCase() === name.toLowerCase())]);
  const readSpell = obj => {
    const sp = obj.mSpell || {}, dv = {};
    for (const d of sp.DataValues || []) if (d.name && d.values) dv[d.name] = d.values;
    return { sp, dv, eff: effects(sp), calcs: sp.mSpellCalculations || {} };
  };

  function parseKit(bin, champId) {
    const rec = Object.values(bin).find(v => v && v.__type === 'CharacterRecord');
    if (!rec || !rec.spellNames) return null;
    const byPath = {};
    for (const [k, v] of Object.entries(bin)) if (v && v.__type === 'SpellObject') byPath[k] = v;
    // Spell paths are matched case-insensitively (Naafiri's W is listed as 'Naafiriw').
    const find = name => Object.entries(byPath).find(([k]) => k.toLowerCase().endsWith('/' + name.toLowerCase()));
    const order = SLOT_ORDER[champId] || SLOTS;

    const spells = rec.spellNames.slice(0, 4).map((name, i) => {
      const hit = find(name);
      if (!hit) return null;
      const obj = hit[1], sp = obj.mSpell || {};
      const dv = {};
      for (const d of sp.DataValues || []) if (d.name && d.values) dv[d.name] = d.values;
      const bot = obj.BotData || {};
      let cds = sp.cooldownTime || [];
      return {
        champ: champId, slot: order[i], name: sp.mAlternateName || name.split('/').pop(),
        cds, ammo: sp.mAmmoRechargeTime || [], maxAmmo: sp.mMaxAmmo || [], cost: sp.mana || [], dv, eff: effects(sp), calcs: sp.mSpellCalculations || {},
        bot: bot[BOT_DAMAGE] && (bot[BOT_DAMAGE].mFormulaParts || []).length ? bot[BOT_DAMAGE] : null,
        damageTag: bot.DamageTag, castTime: sp.spellCastTime || 0.25,
        variants: ((VARIANTS[champId] || {})[order[i]] || []).map(([vname, calc]) => {
          const h = find(vname); if (!h) return null;
          const r = readSpell(h[1]);
          return { name: vname, dv: r.dv, eff: r.eff, calcs: r.calcs, calc };
        }).filter(Boolean),
      };
    }).filter(Boolean);

    const num = f => (f && typeof f === 'object' ? f.baseValue : f);
    return {
      spells,
      asBase: num(rec.attackSpeedModifiable),
      // An explicit 0 ratio is real (bonus attack speed does nothing), so only fall back when it's missing.
      asRatio: num(rec.attackSpeedRatioModifiable) ?? num(rec.attackSpeedModifiable),
      critMult: rec.critDamageMultiplier,
    };
  }

  // ---------- Formula evaluation ----------
  // Stat codes observed in the game data (mStat). mStatFormula: absent = total, 1 = base, 2 = bonus.
  function statValue(code, formula, ofTarget, ctx) {
    const s = ofTarget ? ctx.target : ctx.self;
    const pick = (total, base, bonus) => formula === 1 ? base : formula === 2 ? bonus : total;
    switch (code || 0) {
      case 0: return ofTarget ? 0 : s.ap;
      case 1: return pick(s.armor, s.baseArmor, s.bonusArmor);
      case 2: return pick(s.ad, s.baseAD, s.bonusAD);
      // Codes checked against what Riot's formulas use them for across every champion (patch 16.23):
      // 4 attack speed (Bel'Veth E strikes, Aphelios, Akshan; bonus = % bonus attack speed as a fraction),
      // 6 magic resist (Galio, Rammus, Sejuani, K'Sante), 7 move speed (dash speeds, Hecarim), 8 crit chance
      // (Caitlyn headshots, Ashe), 9 crit damage. 3 and 5 aren't used by damage formulas.
      case 3: return pick(s.as, s.baseAS, s.bonusAS);
      case 4: return formula === 2 ? (s.bonusASRatio ?? s.bonusAS ?? 0) : formula === 1 ? s.baseAS : s.as;
      case 5: return pick(s.mr, s.baseMR, s.bonusMR);
      case 6: return pick(s.mr, s.baseMR, s.bonusMR);
      case 7: return formula === 2 ? (s.bonusMs || 0) : (s.ms || 0);
      case 8: return s.crit || 0;
      case 9: return s.critMult || 1.75;
      case 11: return pick(s.maxHp, s.baseHp, s.bonusHp);  // health (some kits)
      case 12: return pick(s.maxHp, s.baseHp, s.bonusHp);
      case 13: return s.curHp ?? s.maxHp;
      case 14: return s.missingHp || 0;
      case 15: return s.missingHp || 0;
      case 16: return s.lethality || 0;
      case 29: return s.lethality || 0;   // lethality (e.g. Pyke R)
      case 18: return pick(s.mana || 0, s.baseMana || 0, s.bonusMana || 0);
      case 19: return s.mana || 0;
      case 20: return s.level || 18;
      default: ctx.unknown && ctx.unknown.add('stat' + code); return 0;
    }
  }

  // "X% of the target's health" is sometimes stored as a whole number (16 instead of 0.16).
  // A share of the target's health can never exceed 100%, so normalise it.
  const TARGET_HEALTH_STATS = new Set([11, 12, 13, 14, 15]);
  function byStat(part, coeff, ctx) {
    if (part[OF_TARGET] && TARGET_HEALTH_STATS.has(part.mStat)) while (Math.abs(coeff) > 1) coeff /= 100;
    return coeff * statValue(part.mStat, part.mStatFormula, part[OF_TARGET], ctx);
  }

  function evalPart(part, sp, ctx, depth) {
    if (!part || depth > 12) return 0;
    const dvAt = name => { const v = dvGet(sp.dv, name); return v ? +(v[ctx.rank] ?? v[v.length - 1]) || 0 : 0; };
    const sub = p => evalPart(p, sp, ctx, depth + 1);
    switch (part.__type) {
      case 'NamedDataValueCalculationPart': return dvAt(part.mDataValue);
      case 'NumberCalculationPart': return +part.mNumber || 0;
      case 'StatByNamedDataValueCalculationPart':
        return byStat(part, dvAt(part.mDataValue), ctx);
      case 'StatByCoefficientCalculationPart':
        return byStat(part, +part.mCoefficient || 0, ctx);
      case 'StatBySubPartCalculationPart':
        return byStat(part, sub(part.mSubpart), ctx);
      case 'ProductOfSubPartsCalculationPart': return sub(part.mPart1) * sub(part.mPart2);
      case 'SumOfSubPartsCalculationPart': return (part.mSubparts || []).reduce((a, p) => a + sub(p), 0);
      case 'ClampSubPartsCalculationPart': {
        const v = (part.mSubparts || []).reduce((a, p) => a + sub(p), 0);
        return Math.min(part.mCeiling ?? Infinity, Math.max(part.mFloor ?? -Infinity, v));
      }
      case 'ByCharLevelInterpolationCalculationPart': {
        const a = +part.mStartValue || 0, b = +part.mEndValue || 0;
        return a + (b - a) * (ctx.self.level - 1) / 17;
      }
      case 'ByCharLevelBreakpointsCalculationPart': {
        // Level 1 value, +mInitialBonusPerLevel per level; a breakpoint's new per-level rate applies from that level on
        // (checked against Pyke R: 250 -> 550 at level 18). `lvl` = the last level already counted.
        let v = +part.mLevel1Value || 0, per = +part.mInitialBonusPerLevel || 0, lvl = 1;
        const bps = (part.mBreakpoints || []).slice().sort((x, y) => (x.mLevel || 0) - (y.mLevel || 0));
        for (const bp of bps) {
          if ((bp.mLevel || 0) > ctx.self.level) break;
          const at = bp.mLevel || lvl + 1;
          v += per * Math.max(0, at - 1 - lvl); lvl = Math.max(lvl, at - 1);
          if (bp.mAdditionalBonusAtThisLevel) v += +bp.mAdditionalBonusAtThisLevel;
          if (bp['{d5fd07ed}'] !== undefined) per = +bp['{d5fd07ed}'];
          if (bp.mBonusPerLevelAtAndAfter !== undefined) per = +bp.mBonusPerLevelAtAndAfter;
        }
        return v + per * (ctx.self.level - lvl);
      }
      case 'ByCharLevelFormulaCalculationPart': {
        const vals = part.mValues || [];
        return +(vals[ctx.self.level - 1] ?? vals[vals.length - 1] ?? 0);
      }
      case 'BuffCounterByNamedDataValueCalculationPart':
        return dvAt(part.mDataValue) * ctx.stacks;
      case 'BuffCounterByCoefficientCalculationPart':
        return (+part.mCoefficient || 0) * ctx.stacks;
      case 'AbilityResourceByCoefficientCalculationPart':
        return (+part.mCoefficient || 0) * (ctx.self.mana || 0);
      case 'EffectValueCalculationPart': { // older spells keep base values in an effect table (1-based index)
        const e = sp.eff && sp.eff[(part.mEffectIndex || 1) - 1];
        return e && e.length ? +(e[ctx.rank] ?? e[e.length - 1]) || 0 : 0;
      }
      case '{8a96ea3c}': return Math.max(...(part.mSubparts || []).map(sub), 0);  // max of sub-parts
      case '{ba007871}': { const v = (part.mSubparts || []).map(sub); return v.length ? Math.min(...v) : 0; } // min of sub-parts
      case REF: return evalCalc(part.mSpellCalculationKey, sp, ctx, depth + 1);
      default:
        if (part.mSpellCalculationKey) return evalCalc(part.mSpellCalculationKey, sp, ctx, depth + 1);
        ctx.unknown && ctx.unknown.add(part.__type);
        return 0;
    }
  }

  function evalCalc(calcOrKey, sp, ctx, depth = 0) {
    const calc = typeof calcOrKey === 'string' ? sp.calcs[calcOrKey] : calcOrKey;
    if (!calc || depth > 12) return 0;
    if (calc.__type === 'GameCalculationModified') {
      return evalCalc(calc.mModifiedGameCalculation, sp, ctx, depth + 1) * evalPart(calc.mMultiplier, sp, ctx, depth + 1);
    }
    let v = (calc.mFormulaParts || []).reduce((a, p) => a + evalPart(p, sp, ctx, depth + 1), 0);
    if (calc.mMultiplier) v *= evalPart(calc.mMultiplier, sp, ctx, depth + 1);
    return v;
  }

  // Pick the formula that represents "damage of one cast".
  const BAD_NAME = /heal|shield|minion|monster|tooltip|slow|duration|cost|range|radius|speed|percent$|ratio$|cooldown|mana|stun|armor|resist|tenacity|haste|movement|width|count/i;
  function damageCalcFor(sp) {
    if (sp.bot) return sp.bot;
    const names = Object.keys(sp.calcs).filter(n => /damage|dmg/i.test(n) && !BAD_NAME.test(n.replace(/damage/ig, '')));
    const ranked = names.sort((a, b) => score(b) - score(a));
    return ranked.length ? ranked[0] : null;
    function score(n) { return (/total/i.test(n) ? 4 : 0) + (/max/i.test(n) ? 2 : 0) + (/^damage$/i.test(n) ? 3 : 0) - (/min|per|tick/i.test(n) ? 2 : 0); }
  }

  // A neutral level-18 test character, used to probe formulas.
  const PROBE_SELF = { level: 18, ap: 300, ad: 300, baseAD: 100, bonusAD: 200, as: 1.5, baseAS: 0.65, bonusAS: 1, bonusASRatio: 1,
    armor: 150, baseArmor: 100, bonusArmor: 50, mr: 100, baseMR: 50, bonusMR: 50, maxHp: 4000, baseHp: 2500, bonusHp: 1500,
    crit: 0.5, critMult: 1.75, mana: 1500, baseMana: 1200, bonusMana: 300, ms: 400, lethality: 20 };
  const PROBE_TARGET = { maxHp: 10000, curHp: 10000, missingHp: 0, armor: 200, mr: 100 };

  // Damage type: game tag first (0 physical, 1 magic, 2 true), else see whether the
  // formula moves with AD or with AP.
  function damageTypeFor(sp, calc, rank, kitHint) {
    if (sp.damageTag === 0) return 'physical';
    if (sp.damageTag === 1) return 'magic';
    if (sp.damageTag === 2) return 'true';
    if (!calc) return kitHint;
    const at = self => evalCalc(calc, sp, { self, target: PROBE_TARGET, stacks: 1, rank });
    const base = at(PROBE_SELF);
    const adPart = Math.abs(base - at({ ...PROBE_SELF, ad: 0, bonusAD: 0, baseAD: 0 }));
    const apPart = Math.abs(base - at({ ...PROBE_SELF, ap: 0 }));
    if (adPart > apPart) return 'physical';
    if (apPart > adPart) return 'magic';
    return kitHint;
  }

  function cooldownFor(sp, rank) {
    let cd = +(sp.cds[rank] ?? 0);
    if (!(cd > 0.5)) {
      const key = Object.keys(sp.dv).find(k => /cooldown|recharge|ammo/i.test(k) && !/refund|reduction|per/i.test(k));
      cd = key ? +(sp.dv[key][rank] || 0) : 0;
    }
    // Single-charge abilities that store their cooldown as an ammo recharge timer (Rengar Q/W/E). Multi-charge ones
    // (Caitlyn traps, Gangplank barrels) aren't simple cooldowns, so they keep the fallback below.
    if (!(cd > 0.5) && +(sp.ammo && sp.ammo[rank]) > 0.5 && +((sp.maxAmmo && sp.maxAmmo[rank]) ?? 1) <= 1) cd = +sp.ammo[rank];
    if (!(cd > 0.5)) cd = sp.slot === 'R' ? 60 : 6;
    // Some kits list ammo/recharge timers as 1s cooldowns; keep the rotation sane.
    return Math.max(cd, sp.slot === 'R' ? 20 : 1.5);
  }

  function chargesFor(sp, rank) {
    const max = +((sp.maxAmmo && sp.maxAmmo[rank]) || 0), rech = +((sp.ammo && sp.ammo[rank]) || 0);
    if (!(max > 1 && rech > 0.5) || NO_CHARGES.has(sp.champ + ' ' + sp.slot)) return {};
    return { charges: max, recharge: rech, lockout: Math.max(+(sp.cds[rank] || 0), 0.25) };
  }
  // Charges that can't be stacked on one target: Caitlyn's traps can't re-trap a trapped target, Teemo's shroom
  // poison refreshes instead of stacking, and a Gangplank barrel chain hits a target only once. These keep a normal cooldown.
  const NO_CHARGES = new Set(['Caitlyn W', 'Teemo R', 'Gangplank E', 'Leblanc R']); // LeBlanc's 2nd "charge" is the RW return

  // ---------- Mechanic overrides ----------
  // Some abilities aren't "cast for damage": passive on-hit procs, empowered next attacks, or
  // stat buffs. The generic reader can't tell, so these entries describe the mechanic while every
  // number is still read from the game data by name, so values stay current each patch.
  //   everyN:      every Nth basic attack deals bonus damage (pctTargetMaxHp / flat / floor)
  //   empowerAuto: casting arms the next attack with bonus damage (adRatio = x total AD, bonusAdRatio, apRatio, or a
  //                calc); charges: n attacks (asBonus while armed, finalPctMaxHp on the last, cdAfterCharges)
  //   buff:        cast at the start of the fight for bonus stats lasting the whole 10s
  //   cast:        a normal cast, but damage comes from a named formula the generic reader misses (calc)
  //   channel:     damage every tick for a duration (perSec formula; duration in seconds or a data value;
  //                empCalc/empAfter: stronger per-second damage after a delay; once: cast a single time)
  //   hits:        n hits spread over over seconds (calc per hit, critCalc blended by crit chance)
  //   multi:       several formulas in one cast (parts: [{ calc, type }])
  // passiveCovered: the champion's damage passive is modeled here, so skip the generic marksman stand-in.
  const MECHANICS = {
    Vayne: {
      passiveCovered: true, // Night Hunter is movement speed only
      Q: { kind: 'empowerAuto', type: 'physical', adRatio: 'TotalADRatio', apRatio: 'APRatio', resetsAttack: true },
      W: { kind: 'everyN', n: 3, type: 'true', pctTargetMaxHp: 'MaxHealthRatio', floor: 'DamageFloor' },
      R: { kind: 'buff', stats: { ad: 'BonusAttackDamage' } },
    },
    // Self-buffs (attack speed steroids, armor pen): applied for their duration's share of the 10s fight.
    Darius: { E: { kind: 'buff', stats: { arpen: 'PassivePercentArmorPen' } }, R: { kind: 'execute', type: 'true', calc: 'MaximumDamage', holdKill: true, resetOnKill: true, latest: 9.5 } },
    Blitzcrank: { W: { kind: 'buff', stats: { as: ['AttackSpeedMod', 100] }, duration: 5 } },
    Draven: { W: { kind: 'buff', stats: { as: ['AttackSpeed', 100] }, duration: 10 } }, // refreshed by catching axes
    Lulu: { W: { kind: 'buff', stats: { as: ['ASBonus', 100] }, duration: 4 } },
    // Master Yi: Highlander first (attack speed for 7s, extended by kills: see passives.js), then Wuju Style (true damage
    // on every attack for 5s), then Alpha Strike: on one target all 4 strikes hit it (1.75x), it can crit, applies on-hit
    // effects at 75%, and each basic attack cuts its cooldown by 1s.
    MasterYi: {
      R: { kind: 'cast', noDamage: true, asBonus: 'RASBonus', asDur: 'RDuration', order: 0.4 },
      E: { kind: 'cast', noDamage: true, onHitBuff: 'TotalDamage', onHitType: 'true', duration: 'Duration', order: 0.5 },
      Q: { kind: 'cast', type: 'physical', calc: 'SingleTotalDamage', critAvg: true, onHitMult: 'BaseOnHitMultiplier', cdPerHit: 'BasicAttackCDR', order: 0.6 },
    },
    // Olaf: W attack speed for 5s. Q: he walks about 2s to pick the axe up, which drops its cooldown to 2.5s from the
    // throw. E: true damage; each attack cuts its cooldown by 1s. (R's attack damage is in passives.js.)
    Olaf: {
      W: { kind: 'buff', stats: { as: ['Attackspeed', 100] }, duration: 'Duration' },
      Q: { kind: 'cast', type: 'physical', calc: 'TotalDamage', pickup: 2, pickupCd: 'MinimumCooldown' },
      E: { kind: 'cast', type: 'true', calc: 'TotalDamage', cdPerHit: 'ChampionRefresh' },
      R: { kind: 'cast', noDamage: true, type: 'physical' }, // still cast, so ultimate-triggered items fire
    },
    Quinn: { W: { kind: 'buff', stats: { as: ['AttackSpeedBonus', 100] }, duration: 3.3 } }, // after each Harrier proc
    Tristana: { Q: { kind: 'buff', stats: { as: ['AttackSpeedMod', 100] }, duration: 7 } },
    Viego: { E: { kind: 'buff', stats: { as: ['AttackSpeed', 100] }, duration: 8 } },
    Xayah: { W: { kind: 'buff', stats: { as: 'WAttackSpeedAmount' }, duration: 'WAttackSpeedDuration' } },
    Samira: { R: { kind: 'hits', type: 'physical', calc: 'DamageCalc', critCalc: 'CriticalDamageCalc', n: 10, over: 2 } },
    Twitch: { E: { kind: 'multi', parts: [{ calc: 'MaxPhysicalDamage', type: 'physical' }, { calc: 'MaxMagicDamage', type: 'magic' }] }, // 6 stacks
      R: { kind: 'buff', stats: { ad: 'BonusAD' }, duration: 'Duration' }, // Spray and Pray: +AD for 6s
      Q: { kind: 'buff', stats: { as: ['AttackSpeedMod', 100] }, duration: 'AttackSpeedDuration' } }, // Ambush: +AS for 6s
    Anivia: { R: { kind: 'channel', type: 'magic', perSec: 'TotalDamagePerSecond', empCalc: 'EmpoweredDamagePerSecondTooltipOnly', empAfter: 1.5, duration: 99, once: true } },
    Renekton: { R: { kind: 'channel', type: 'magic', perSec: 'TotalDamagePerSecond', duration: 'BuffDuration' } },
    Rumble: { R: { kind: 'channel', type: 'magic', perSec: 'DamagePerSecond', duration: 'TrailDuration' } },
    Singed: { Q: { kind: 'channel', type: 'magic', perSec: 'DamagePerSecond', duration: 99, once: true } },
    Kennen: { R: { kind: 'hits', type: 'magic', calc: 'PerTickDamageCalculated', n: 6, over: 3 } },
    // Execute ultimates: held until the hit leaves the target under the threshold, then the execute kills it.
    // If the dummy never gets that low, it's fired near the end of the fight for its damage.
    //   execute: threshold (share of max HP or a data value) / thresholdCalc (absolute HP from a formula); calc: damage
    //   formula (default: the cast's own); missAmp {max, at}: up to +max x damage as missing HP reaches 'at';
    //   missPct: + share of missing HP; aboveMult: damage when above the threshold; holdKill: wait until it kills;
    //   resetOnKill: recast right away after a kill; noHold: cast on cooldown but still execute; latest: fire anyway.
    // Death Mark: opened with first so the 3s mark stores the whole burst, then pops for 100% AD + 55% of it.
    Zed: { R: { kind: 'mark', type: 'physical', first: true, pct: 'RDamageAmp', duration: 'RDeathMarkDuration' } },
    // LeBlanc: Q, then R copying it (Mimic: RQ), then W and E. Each Sigil (Q, RQ) pops for its mark damage when the next
    // ability hits; E's chain deals its second hit after the 1.5s tether. order: cast priority (lower first).
    //   sigil: mark formula, popped by the next ability hit within sigilDur; delayCalc/delayAfter: a later second hit.
    // Mel R (Golden Eclipse): flat damage plus more per Overwhelm stack on the target, so it's held until it kills
    // (counting Overwhelm's execute line) or fired at the end with every stack built up.
    Mel: { R: { kind: 'execute', type: 'magic', calc: 'UltFlatDamage', perStack: 'UltStackDamage', holdKill: true, latest: 9.5 } },
    // Zilean: Time Bomb explodes after 3s, or at once (both bombs) when a second one lands; Rewind takes 10s off Q's
    // cooldown, so he throws Q, Rewinds and throws a second Q to set both off.
    Zilean: {
      Q: { kind: 'bomb', type: 'magic', calc: 'TotalDamage', fuse: 'FuseDuration' },
      W: { kind: 'cast', noDamage: true, cdReduce: 'CooldownReduction', whenNotReady: 'Q' },
    },
    // Bel'Veth E (Royal Maelstrom): 1.5s of strikes (6, +40% more per 100% bonus attack speed), each up to double damage
    // as the target's health drops and applying 12% of on-hit effects; held until the dummy is at half health or 8.3s.
    Belveth: { E: { kind: 'flurry', type: 'physical', calc: 'DamagePerStrike', strikesCalc: 'TotalStrikes', duration: 'TotalDuration',
      missAmpMax: 'MissingHealthMult', onHitRatio: 'OnHitRatio', holdMissing: 0.5, latest: 8.3 } },
    // K'Sante Q: cooldown 3.5s, down to 2s as his bonus armor + magic resist reach 120 (game data).
    // R (All Out, see passives.js): cast first for its hit (rank 3: 150 physical); while All Out, Q's cooldown is a third shorter.
    KSante: {
      Q: { kind: 'cast', type: 'physical', calc: 'BaseDamage', resistCdMin: 'MinCD', resistCdCap: 'DefenseCapforCooldown', allOutCdCut: 'RCooldownReduction' },
      R: { kind: 'multi', parts: [{ flat: 'BaseDamage', type: 'physical' }], type: 'physical', order: 0.1 },
    },
    Leblanc: {
      Q: { kind: 'cast', type: 'magic', calc: 'Damage', sigil: 'MarkDamage', sigilDur: 'MarkDuration', order: 0.5 },
      R: { kind: 'cast', type: 'magic', calc: 'RQ1Damage', sigil: 'RQ2Damage', sigilDur: 'RQMarkDuration', order: 0.6 },
      W: { kind: 'cast', type: 'magic', calc: 'TotalDamage' },
      E: { kind: 'cast', type: 'magic', calc: 'InitialDamage', delayCalc: 'DelayedDamage', delayAfter: 'TetherDuration' },
    },
    Urgot: { R: { kind: 'execute', type: 'physical', threshold: 'RHealthThreshold', latest: 9.5 } },
    Syndra: { R: { kind: 'execute', type: 'magic', calc: 'MaxDamageCalc', threshold: 'UpgradeExecuteThreshold', latest: 9.5 } }, // all 7 spheres
    Pyke: { R: { kind: 'execute', type: 'physical', thresholdCalc: 'RDamage', calc: 'RDamage', aboveMult: 0.5, resetOnKill: true, latest: 9.5 } },
    Garen: { R: { kind: 'execute', type: 'true', flat: 'BaseDamage', missPct: 0.35, holdKill: true, latest: 9.5 } },
    Fiddlesticks: { W: { kind: 'execute', type: 'magic', flat: 'DamagePerSecond', flatMult: 2, missPct: 0.22, noHold: true } }, // 2s drain + 22% missing HP
    Veigar: { R: { kind: 'execute', type: 'magic', calc: 'MinDamage', missAmp: { max: 1, at: 0.667 }, holdKill: true, latest: 9.5 } },
    Jinx: { R: { kind: 'execute', type: 'physical', calc: 'DamageMax', missPct: 0.35, holdKill: true, latest: 9.5 } },
    Akshan: { R: { kind: 'execute', type: 'physical', missAmp: { max: 3, at: 1 }, holdKill: true, latest: 9.5 } },
    Smolder: { Q: { kind: 'execute', type: 'physical', threshold: 'Tier3_ExecuteThresholdStart', noHold: true } }, // 225 stacks
    // Darkin Daggers: first dagger + bleed + second dagger (minimum), all physical.
    // Ahri: Q hits going out (magic) and coming back (true); all three W flames hit the one target (repeats deal 40%);
    // R is three dashes 1s apart, each firing a bolt and counting as its own cast.
    Ahri: {
      Q: { kind: 'multi', parts: [{ calc: 'TotalDamage', type: 'magic' }, { calc: 'TotalDamage', type: 'true' }] },
      W: { kind: 'multi', parts: [{ calc: 'SingleFireDamage', type: 'magic' }, { calc: 'MultiFireDamage', type: 'magic' }, { calc: 'MultiFireDamage', type: 'magic' }] },
      R: { kind: 'cast', type: 'magic', calc: 'RCalculatedDamage', recasts: 3, recastGap: 1 },
    },
    // Aurelion Sol: E (5s singularity, executes below 5% + 0.026% per stack) and R first, then Q channels for the rest
    // of the fight (no channel limit at max rank): damage per second plus a burst every second of magic + 0.03% max HP
    // true damage per stack. With 75+ stacks R is Heavens Descend (125% damage).
    AurelionSol: {
      Q: { kind: 'channel', type: 'magic', perSec: 'DamagePerSecond', duration: 'MaxChannelDuration', last: true, blocksAttacks: true,
        burstEvery: 1, bursts: [{ calc: 'BurstDamage', type: 'magic' }, { calc: 'BurstBonusTrueDamageToChamps', type: 'true', pctMaxHp: true }] },
      E: { kind: 'channel', type: 'magic', perSec: 'DamagePerSecond', duration: 'Duration', executeCalc: 'CurrentExecutionThreshold', first: true },
      R: { kind: 'cast', type: 'magic', calc: 'R2Damage', first: true },
    },
    // Wukong: W leaves a clone (4s) that copies his attacks and his R at 60%; Q empowers the next attack (his and the
    // clone's), shreds 30% armor for 3s and loses 0.5s cooldown per hit; E grants 60% attack speed for 5s; R is two
    // 2s spins (AD + % max HP per second) and he can't attack while spinning.
    MonkeyKing: {
      Q: { kind: 'empowerAuto', type: 'physical', flat: 'BaseDamage', bonusAdRatio: 'ADRatio', resetsAttack: true,
        shred: 'ArmorShredPercent', shredDur: 'ShredDuration', cdPerHit: 'CooldownDecrease' },
      W: { kind: 'clone', duration: 'CloneDuration', mult: 'CloneDamageMod', first: true },
      E: { kind: 'cast', type: 'magic', calc: 'TotalDamage', asBonus: 'AttackSpeed', asDur: 'AttackSpeedDuration' },
      R: { kind: 'channel', type: 'physical', perSec: 'DamagePerSecondTotal', perSecPctMaxHp: 'BasePercentMaxHPDmgPerSec', duration: 'SpinDuration',
        recasts: 2, recastGap: 3, blocksAttacks: true, cloneEcho: true, first: true },
    },
    // Pantheon W: damage is a share of the target's max health (game data stores 0.08 = 8%).
    Pantheon: { W: { kind: 'cast', type: 'physical', calc: 'MaxHealthDamageCalc', pctOfMax: true } },
    Naafiri: { Q: { kind: 'multi', parts: [{ calc: 'TotalDamageFirstCast', type: 'physical' }, { calc: 'TotalBleedDamage', type: 'physical' }, { calc: 'TotalMinDamageSecondCast', type: 'physical' }] } },
    Kayle: { E: { kind: 'cast', type: 'magic', calc: 'ActiveTotalExecuteDamage', pctOfMissing: true } }, // formula is a share of missing HP
    // Skarner Q: rip up a boulder that empowers his next 3 attacks with attack speed and the ability damage; the 3rd
    // also deals 11% of the target's max health. The cooldown starts once the 3rd attack lands.
    Skarner: { Q: { kind: 'empowerAuto', type: 'physical', calc: 'AbilityDamage', charges: 3, asBonus: 'AttackSpeed',
      finalPctMaxHp: 'MaxHPPercent', cdAfterCharges: true } },
    // Kindred W: Wolf bites for the whole zone (stats from the KindredWolf game file: 0.558 attack speed, +2.7% per level,
    // plus 25% of her bonus attack speed); each bite is flat + (1.5% + 1% per mark) current health. W goes first so Q
    // gets its shorter cooldown inside the zone. Q: arrow + attack speed (35% + 5% per mark). E: Wolf pounces on her 3rd
    // attack for flat + (5% + 0.5% per mark) missing health, increased by crit chance.
    Kindred: {
      W: { kind: 'pet', type: 'magic', calc: 'BaseWolfDamage', pctCalc: 'PercentWolfDamage', duration: 'ZoneDuration',
        share: 'LambToWolfAttackSpeedConversionPercent', petAS: 0.558, petASPerLevel: 2.7, first: true },
      Q: { kind: 'cast', type: 'physical', calc: 'TotalDamage', asCalc: 'TotalQAttackSpeed', asDur: 'BaseASDuration', zoneCd: 'CDNewValue' },
      E: { kind: 'afterHits', type: 'physical', hits: 3, window: 'TotalDuration', calc: 'BaseBiteDamage', pctMissingCalc: 'PercentBiteDamage' },
    },
    // Akali: E is two casts (30% + 70% of the total). R1 vaults; R2 recast 2.5s later scales up to 3x with missing health
    // (max at 30% health left). W restores 100 energy and raises her max energy by 100 while the shroud lasts.
    Akali: {
      W: { kind: 'cast', noDamage: true, type: 'magic', energyMax: 'EnergyRestore', duration: 'BaseDuration', whenEnergyBelow: 70 },
      E: { kind: 'multi', parts: [{ calc: 'E1Damage', type: 'magic' }, { calc: 'E2DamageCalc', type: 'magic' }] },
      R: { kind: 'cast', type: 'magic', calc: 'Cast1Damage', recasts: 2, recastGap: 'CooldownBetweenCasts', recastCalc: 'Cast2DamageMin',
        recastMaxMult: 3, recastFullAt: 'MaxExecuteThreshold' },
    },
    // Katarina: W only drops a dagger (passives.js: daggers). R: Death Lotus, 15 knives over 2.5s, each magic + physical
    // (bonus AD, grows with bonus attack speed) with on-hit effects at 35% (rank 3).
    Katarina: {
      W: { kind: 'cast', noDamage: true, type: 'magic' },
      R: { kind: 'knives', type: 'magic', calc: 'DamageCalc', physCalc: 'ADDamageCalc', rate: 'TicksPerSecond', duration: 'Duration', onHitRatio: 'OnHitRatio' },
    },
    // Xin Zhao Q: next 3 attacks deal bonus damage and each cuts his other cooldowns by 1s; Q's cooldown starts after the
    // 3rd. E: damage + attack speed (70% at rank 5, +1% per 4% bonus attack speed, +10% per 100 AP) for 5s.
    // R: flat + 15% of current health.
    XinZhao: {
      Q: { kind: 'empowerAuto', type: 'physical', calc: 'BonusDamage', charges: 3, cdAfterCharges: true, cdOthersPerHit: 1, resetsAttack: true },
      E: { kind: 'cast', type: 'magic', calc: 'ChargeDamage', asBonus: 'ASMod', asPerBonusAS: 'PermanentASToASRatio', apToAS: 'APToASRatio', asDur: 'ASDuration' },
      R: { kind: 'multi', parts: [{ calc: 'TotalDamage', type: 'physical' }, { pctCurHp: 'PercentCurrentHealthDamage', type: 'physical' }] },
    },
    // Rengar Q: resets his attack; the next 2 attacks gain attack speed and the first deals bonus damage.
    // At max Ferocity it's empowered instead (passives.js: ferocity).
    Rengar: { Q: { kind: 'empowerAuto', type: 'physical', calc: 'QBonusDamage', charges: 2, firstOnly: true, asBonus: 'ASBonus',
      resetsAttack: true } },
  };

  function resolveMechanic(spec, sp, rank) {
    const dv = name => { const v = name && sp.dv[name]; return v ? +(v[rank] ?? v[v.length - 1]) || 0 : 0; };
    const m = { ...spec };
    for (const k of ['adRatio', 'bonusAdRatio', 'apRatio', 'pctTargetMaxHp', 'floor', 'flat', 'duration', 'threshold', 'pct',
      'mult', 'asBonus', 'asDur', 'shred', 'shredDur', 'cdPerHit', 'perSecPctMaxHp', 'finalPctMaxHp', 'zoneCd', 'share', 'window', 'rate', 'onHitRatio', 'asPerBonusAS', 'apToAS', 'recastGap', 'recastFullAt', 'energyMax', 'pickupCd', 'sigilDur', 'delayAfter', 'onHitMult', 'fuse', 'cdReduce', 'missAmpMax', 'resistCdMin', 'resistCdCap', 'allOutCdCut']) if (typeof spec[k] === 'string') m[k] = dv(spec[k]);
    if (spec.parts) m.parts = spec.parts.map(p => ({ ...p, ...(typeof p.flat === 'string' ? { flat: dv(p.flat) } : {}),
      ...(typeof p.pctMaxHp === 'string' ? { pctMaxHp: dv(p.pctMaxHp) } : {}),
      ...(typeof p.pctCurHp === 'string' ? { pctCurHp: dv(p.pctCurHp) } : {}) }));
    // Buff stats: a data value name, or [name, multiplier] (e.g. attack speed stored as 0.7 -> 70%), or a number.
    if (spec.stats) m.stats = Object.fromEntries(Object.entries(spec.stats).map(([k, v]) => [k, typeof v === 'number' ? v : Array.isArray(v) ? dv(v[0]) * v[1] : dv(v)]));
    return m;
  }

  // Build a compact, ready-to-simulate view of the kit.
  function describeKit(kit, kitHint) {
    if (!kit) return null;
    const mech = MECHANICS[kit.id] || {};
    const spells = kit.spells.map(sp => {
      const rank = sp.slot === 'R' ? 3 : 5;
      const calc = damageCalcFor(sp);
      const probe = calc ? evalCalc(calc, sp, { self: PROBE_SELF, target: PROBE_TARGET, stacks: 5, rank }) : 0;
      const m = mech[sp.slot] ? resolveMechanic(mech[sp.slot], sp, rank) : null;
      return {
        slot: sp.slot, name: sp.name, rank, calc, sp, mech: m,
        damaging: !m && ((Number.isFinite(probe) && probe > 1) || sp.variants.length > 0), type: (m && m.type) || damageTypeFor(sp, calc, rank, kitHint),
        cooldown: cooldownFor(sp, rank), castTime: Math.min(0.75, sp.castTime || 0.25),
        // Multi-charge abilities: charges, the recharge time per charge, and the short lockout between casts.
        ...chargesFor(sp, rank),
        // Energy/mana cost at this rank (the game lists costs from rank 1, unlike cooldowns).
        cost: +((sp.cost && sp.cost[rank - 1]) || 0),
      };
    });
    spells.passiveCovered = !!mech.passiveCovered;
    // One real damaging ability is enough: supports and utility kits (Bard, Taric, Zilean...) really only have one.
    spells.usable = spells.filter(s => s.damaging || s.mech).length >= 1;
    return spells;
  }

  function evalSpellDamage(spell, ctx) {
    if (spell.sp.variants && spell.sp.variants.length) {
      let best = 0;
      for (const v of spell.sp.variants) {
        const x = evalCalc(v.calc, v, { ...ctx, rank: spell.rank });
        if (Number.isFinite(x) && x > best) { best = x; spell.lastVariant = v.name; }
      }
      return Math.min(best, 6000);
    }
    if (!spell.calc) return 0;
    const v = evalCalc(spell.calc, spell.sp, { ...ctx, rank: spell.rank });
    // Safety cap against data glitches: no single cast deals more than 6,000 before resistances.
    return Number.isFinite(v) && v > 0 ? Math.min(v, 6000) : 0;
  }

  const setPatch = p => { currentPatch = p; };
  const setKitBase = b => { kitBase = String(b).replace(/\/+$/, ''); manifestP = null; };
  const hostedInfo = () => hostedManifest().then(m => m && { patch: m.patch, built: m.built, champions: (m.champions || []).length, current: currentPatch,
    fresh: !currentPatch || minor(m.patch) === minor(currentPatch) });
  const api = { loadKit, parseKit, describeKit, evalSpellDamage, evalCalc, damageCalcFor, setPatch, setKitBase, hostedInfo };
  root.Potenshall = root.Potenshall || {};
  root.Potenshall.Abilities = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
