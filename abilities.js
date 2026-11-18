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
  async function loadKit(champId) {
    if (cache.has(champId)) return cache.get(champId);
    const p = (async () => {
      const id = champId.toLowerCase();
      const res = await fetch(`${CDRAGON}/${id}/${id}.bin.json`);
      if (!res.ok) throw new Error(`CommunityDragon ${res.status} for ${champId}`);
      return parseKit(await res.json());
    })();
    cache.set(champId, p);
    p.catch(() => cache.delete(champId));
    return p;
  }

  function parseKit(bin) {
    const rec = Object.values(bin).find(v => v && v.__type === 'CharacterRecord');
    if (!rec || !rec.spellNames) return null;
    const byPath = {};
    for (const [k, v] of Object.entries(bin)) if (v && v.__type === 'SpellObject') byPath[k] = v;
    const find = name => Object.entries(byPath).find(([k]) => k.endsWith('/' + name));

    const spells = rec.spellNames.slice(0, 4).map((name, i) => {
      const hit = find(name);
      if (!hit) return null;
      const obj = hit[1], sp = obj.mSpell || {};
      const dv = {};
      for (const d of sp.DataValues || []) if (d.name && d.values) dv[d.name] = d.values;
      const bot = obj.BotData || {};
      let cds = sp.cooldownTime || [];
      return {
        slot: SLOTS[i], name: sp.mAlternateName || name.split('/').pop(),
        cds, dv, calcs: sp.mSpellCalculations || {},
        bot: bot[BOT_DAMAGE] && (bot[BOT_DAMAGE].mFormulaParts || []).length ? bot[BOT_DAMAGE] : null,
        damageTag: bot.DamageTag, castTime: sp.spellCastTime || 0.25,
      };
    }).filter(Boolean);

    const num = f => (f && typeof f === 'object' ? f.baseValue : f);
    return {
      spells,
      asBase: num(rec.attackSpeedModifiable),
      asRatio: num(rec.attackSpeedRatioModifiable) || num(rec.attackSpeedModifiable),
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
      case 3: return pick(s.as, s.baseAS, s.bonusAS);
      case 5: return pick(s.mr, s.baseMR, s.bonusMR);
      case 6: return s.ms || 0;
      case 7: return s.crit || 0;
      case 9: return s.critMult || 1.75;
      case 11: return pick(s.maxHp, s.baseHp, s.bonusHp);  // health (some kits)
      case 12: return pick(s.maxHp, s.baseHp, s.bonusHp);
      case 13: return s.curHp ?? s.maxHp;
      case 14: return s.missingHp || 0;
      case 15: return s.missingHp || 0;
      case 16: return s.lethality || 0;
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
    const dvAt = name => { const v = sp.dv[name]; return v ? +(v[ctx.rank] ?? v[v.length - 1]) || 0 : 0; };
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
        let v = +part.mLevel1Value || 0, per = 0, lvl = 1;
        const bps = (part.mBreakpoints || []).slice().sort((x, y) => (x.mLevel || 0) - (y.mLevel || 0));
        for (const bp of bps) {
          if ((bp.mLevel || 0) > ctx.self.level) break;
          v += per * ((bp.mLevel || 0) - lvl); lvl = bp.mLevel || lvl;
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
      case 'EffectValueCalculationPart': return 0;
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
  const PROBE_SELF = { level: 18, ap: 300, ad: 300, baseAD: 100, bonusAD: 200, as: 1.5, baseAS: 0.65, bonusAS: 1,
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
    if (!(cd > 0.5)) cd = sp.slot === 'R' ? 60 : 6;
    // Some kits list ammo/recharge timers as 1s cooldowns; keep the rotation sane.
    return Math.max(cd, sp.slot === 'R' ? 20 : 1.5);
  }

  // Build a compact, ready-to-simulate view of the kit.
  function describeKit(kit, kitHint) {
    if (!kit) return null;
    const spells = kit.spells.map(sp => {
      const rank = sp.slot === 'R' ? 3 : 5;
      const calc = damageCalcFor(sp);
      const probe = calc ? evalCalc(calc, sp, { self: PROBE_SELF, target: PROBE_TARGET, stacks: 5, rank }) : 0;
      return {
        slot: sp.slot, name: sp.name, rank, calc, sp,
        damaging: Number.isFinite(probe) && probe > 1, type: damageTypeFor(sp, calc, rank, kitHint),
        cooldown: cooldownFor(sp, rank), castTime: Math.min(0.75, sp.castTime || 0.25),
      };
    });
    spells.usable = spells.filter(s => s.damaging).length >= 2;
    return spells;
  }

  function evalSpellDamage(spell, ctx) {
    if (!spell.calc) return 0;
    const v = evalCalc(spell.calc, spell.sp, { ...ctx, rank: spell.rank });
    // Safety cap against data glitches: no single cast deals more than 6,000 before resistances.
    return Number.isFinite(v) && v > 0 ? Math.min(v, 6000) : 0;
  }

  const api = { loadKit, parseKit, describeKit, evalSpellDamage, evalCalc, damageCalcFor };
  root.Potenshall = root.Potenshall || {};
  root.Potenshall.Abilities = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
