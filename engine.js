/* Potenshall Damage — data loading + damage simulation engine.
   Pulls the newest patch from Riot's Data Dragon and simulates a 10 second
   level-18 all-in against a 10,000 HP / 200 Armor / 100 MR training dummy. */
(function (root) {
  'use strict';

  const DDRAGON = 'https://ddragon.leagueoflegends.com';
  // baseHp: the average level-18 base health of all champions (set when the patch loads); the rest of the
  // dummy's 10,000 counts as bonus health for effects that scale with the target's bonus health.
  const DUMMY = { hp: 10000, armor: 200, mr: 100, baseHp: 2400 };
  const FIGHT_SECONDS = 10;
  const SELF_HP = 0.4; // your champion fights at 40% health (matters for missing-health scaling)
  const DT = 0.05;

  // ---------- Data loading ----------
  async function loadPatchData() {
    const versions = await (await fetch(`${DDRAGON}/api/versions.json`)).json();
    const patch = versions[0];
    const [champJson, itemJson] = await Promise.all([
      fetch(`${DDRAGON}/cdn/${patch}/data/en_US/champion.json`).then(r => r.json()),
      fetch(`${DDRAGON}/cdn/${patch}/data/en_US/item.json`).then(r => r.json()),
    ]);
    return { patch, champions: buildChampionPool(champJson), items: buildItemPool(itemJson) };
  }

  function buildChampionPool(json) {
    const champs = Object.values(json.data).map(c => ({
      id: c.id, name: c.name, title: c.title, tags: c.tags, info: { ...c.info },
      partype: c.partype, stats: c.stats, ranged: c.stats.attackrange > 300,
    }));
    fillMissingRatings(champs);
    DUMMY.baseHp = Math.round(champs.reduce((a, c) => a + c.stats.hp + 17 * c.stats.hpperlevel, 0) / champs.length);
    return champs.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Riot leaves attack/magic/defense at 0 for a few newer champions (e.g. Akshan, Rell,
  // Seraphine, Vex). Fill them with the average of champions that share the same roles.
  function fillMissingRatings(champs) {
    const rated = champs.filter(c => c.info.attack + c.info.magic + c.info.defense > 0);
    for (const c of champs) {
      if (c.info.attack + c.info.magic + c.info.defense > 0) continue;
      let peers = rated.filter(p => p.tags[0] === c.tags[0] && p.tags[1] === c.tags[1]);
      if (peers.length < 3) peers = rated.filter(p => p.tags[0] === c.tags[0]);
      if (!peers.length) peers = rated;
      for (const k of ['attack', 'magic', 'defense']) {
        c.info[k] = Math.round(peers.reduce((s, p) => s + p.info[k], 0) / peers.length);
      }
      c.ratingsEstimated = true;
    }
  }

  // Legendary = completed (builds into nothing), Summoner's Rift, purchasable,
  // 2000g+, not boots / consumables / Ornn upgrades / champion-specific.
  function buildItemPool(json) {
    const seen = new Set();
    const out = [];
    for (const [id, v] of Object.entries(json.data)) {
      const g = v.gold || {};
      if (!v.maps || !v.maps['11'] || !g.purchasable) continue;
      if ((v.into && v.into.length) || Number(id) >= 10000 || g.total < 2000) continue;
      const tags = v.tags || [];
      if (tags.includes('Boots') || tags.includes('Consumable') || tags.includes('Trinket')) continue;
      if (v.requiredAlly || v.requiredChampion || v.inStore === false) continue;
      if (seen.has(v.name)) continue;
      seen.add(v.name);
      const parsed = parseStats(v.description || '');
      const passives = [...(v.description || '').matchAll(/<(passive|active)>(.*?)<\/\1>/g)].map(m => m[2].trim()).filter(Boolean);
      out.push({ id, name: v.name, gold: g.total, tags, stats: parsed.stats, statLines: parsed.lines, passives,
        known: !!PASSIVES[v.name.toLowerCase()] });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  const STAT_KEYS = {
    'attack damage': 'ad', 'ability power': 'ap', 'attack speed': 'as',
    'critical strike chance': 'crit', 'critical strike damage': 'critDmg',
    'lethality': 'leth', 'armor penetration': 'arpen', 'ability haste': 'ah',
    'health': 'hp', 'mana': 'mana', 'armor': 'armor', 'magic resist': 'mr',
    'move speed': 'ms', 'omnivamp': 'omnivamp', 'life steal': 'lifesteal',
  };

  function parseStats(desc) {
    const stats = {}; const lines = [];
    const block = (desc.match(/<stats>(.*?)<\/stats>/) || [])[1];
    if (!block) return { stats, lines };
    for (const raw of block.split(/<br\s*\/?>/i)) {
      const text = raw.replace(/<[^>]+>/g, '').trim();
      const m = text.match(/^([\d.]+)(%?)\s+(.+)$/);
      if (!m) continue;
      const val = parseFloat(m[1]); if (!val) continue;
      lines.push(text);
      const label = m[3].toLowerCase();
      let key = STAT_KEYS[label];
      if (label === 'magic penetration') key = m[2] ? 'mpenPct' : 'mpenFlat';
      if (key) stats[key] = (stats[key] || 0) + val;
    }
    return { stats, lines };
  }

  // ---------- Item passive models (best-effort approximations) ----------
  // Unknown items still count their raw stats.
  const PASSIVES = {
    "rabadon's deathcap": { apMult: 1.30, tip: 'Magical Opus: +30% total AP' },
    "overlord's bloodmail": { adPerBonusHp: 0.025, tip: 'Tyranny: AD from bonus HP' },
    "riftmaker": { apPerBonusHp: 0.02, ramp: { per: 2, cap: 8 }, tip: 'Void Corruption: ramps up to +8% damage' },
    "archangel's staff": { apPerBonusMana: 0.01, tip: 'Awe: AP from bonus mana' },
    "manamune": { muramana: true, tip: 'Assumed stacked into Muramana' },
    "liandry's torment": { burn: 'liandry', ramp: { per: 2, cap: 6 }, tip: 'Torment: 2% max HP burn' },
    "blackfire torch": { burn: 'blackfire', apMultAdd: 0.04, tip: 'Baleful Blaze burn' },
    "sunfire aegis": { immolate: { base: 20, bhp: 0.015 }, tip: 'Immolate: 20 + 1.5% bonus HP per second' },
    "hollow radiance": { immolate: { base: 10, bhp: 0.0175 }, tip: 'Immolate: 10 + 1.75% bonus HP per second' },
    "unending despair": { despair: true, tip: 'Anguish pulse every 4s' },
    "heartsteel": { heartsteel: true, tip: 'Colossal Consumption: 6% max HP hit' },
    "nashor's tooth": { onHit: { magic: 15, ap: 0.15 }, tip: 'On-hit 15 + 15% AP' },
    "wit's end": { onHit: { magic: 45 }, tip: 'On-hit magic' },
    "guinsoo's rageblade": { onHit: { magic: 30 }, asBonus: 32, guinsoo: true, tip: 'Phantom hits double on-hit' },
    "terminus": { onHit: { magic: 30 }, pen: 0.25, tip: 'On-hit + pen building to 30%' },
    "blade of the ruined king": { onHit: { curHpMelee: 0.09, curHpRanged: 0.06 }, tip: '% current HP on-hit' },
    "titanic hydra": { onHit: { ownHpMelee: 0.01, ownHpRanged: 0.005 }, titanic: true, tip: '1% max HP on-hit; active 4% max HP' },
    "kraken slayer": { everyN: { n: 3, phys: 150, missingAmp: 0.75, rangedMult: 0.8 }, tip: 'Every 3rd attack (80% ranged)' },
    "statikk shiv": { everyN: { n: 3, magic: 60 }, tip: 'Energized lightning' },
    "rapid firecannon": { everyN: { n: 3, magic: 40 }, tip: 'Energized attack' },
    "stormrazor": { everyN: { n: 3, magic: 90 }, tip: 'Energized bolt' },
    "hullbreaker": { everyN: { n: 5, hull: true }, tip: 'Skipper: every 5th attack, 120% base AD + 5% max HP' },
    "voltaic cyclosword": { everyN: { n: 4, curHp: 0.08, curHpRanged: 0.06 }, tip: 'Energized: 8% current HP (6% ranged)' },
    "trinity force": { spellblade: { baseAd: 2.0, type: 'physical' }, tip: 'Spellblade 200% base AD' },
    "lich bane": { spellblade: { baseAd: 0.75, ap: 0.45, type: 'magic' }, tip: 'Spellblade AP burst' },
    "iceborn gauntlet": { spellblade: { baseAd: 1.5, type: 'physical' }, tip: 'Spellblade 150% base AD' },
    "essence reaver": { spellblade: { baseAd: 1.25, type: 'physical' }, tip: 'Spellblade 125% base AD' },
    "dusk and dawn": { spellblade: { flat: 40, ap: 0.12, type: 'magic', doubleOnHit: true }, tip: 'Spellblade double on-hit' },
    "infinity edge": { tip: 'Crit damage amp' },
    "the collector": { execute: 0.05, tip: 'Executes below 5% HP' },
    "black cleaver": { cleaver: true, tip: 'Shreds up to 30% armor' },
    "bloodletter's curse": { bloodletter: true, tip: 'Shreds up to 30% MR' },
    "abyssal mask": { magicAmp: 0.12, tip: '+12% magic damage taken' },
    "shadowflame": { shadowflame: true, tip: '+20% magic/true dmg under 40% HP' },
    "luden's echo": { luden: true, tip: 'Echo: 75 + 5% AP, extra bolts at 20%, every 12s' },
    "stormsurge": { stormsurge: true, tip: 'Squall after big burst' },
    "hextech rocketbelt": { rocketbelt: true, tip: 'Opening missile volley' },
    "malignance": { malignance: true, tip: 'Hatefog burn on ult' },
    "bastionbreaker": { bastion: true, tip: 'True damage on abilities' },
    "spear of shojin": { ahBonus: 25, abilityRamp: 0.03, tip: 'Ability dmg ramps to +12%' },
    "actualizer": { ahBonus: 20, abilityAmp: 0.15, tip: 'Empowered ability damage' },
    "navori flickerblade": { ahBonus: 20, tip: 'Attacks shorten cooldowns' },
    "endless hunger": { ahPerBonusAd: 0.12, tip: 'Haste from bonus AD' },
    "yun tal wildarrows": { critBonus: 20, asBonus: 18, tip: 'Builds crit + Flurry' },
    "experimental hexplate": { asBonus: 24, tip: 'Overdrive attack speed' },
    "fiendhunter bolts": { fiendhunter: true, tip: 'Post-ult crit barrage' },
    "hexoptics c44": { attackAmpRanged: 0.10, attackAmpMelee: 0.04, tip: 'Long-range attack amp' },
    "sundered sky": { sundered: true, tip: 'Guaranteed crit every 10s' },
    "eclipse": { eclipse: true, tip: '2 hits in 2s: 8% max HP (5% ranged), every 6s' },
    "dead man's plate": { dmp: true, tip: 'Opening charged attack: 40 + 100% base AD' },
    "umbral glaive": { umbral: true, tip: 'Opening attack from the dark: true damage' },
    "zeke's convergence": { zeke: true, tip: 'Storm after your ultimate: 30/s for 5s' },
    // Item actives: used at the start of the fight and again whenever off cooldown.
    "ravenous hydra": { active: { cd: 10, type: 'physical', dmg: (st) => 0.8 * st.totalAD }, tip: 'Active: 80% AD, every 10s' },
    "stridebreaker": { active: { cd: 15, type: 'physical', dmg: (st) => 0.8 * st.totalAD }, tip: 'Active: 80% AD, every 15s' },
    "profane hydra": { active: { cd: 10, type: 'physical', dmg: (st, hp) => 0.8 * st.totalAD * (hp < 0.5 * DUMMY.hp ? 1.3 : 1) }, tip: 'Active: 80% AD (more below 50% HP), every 10s' },
    "hextech gunblade": { active: { cd: 60, type: 'magic', dmg: (st) => 253 + 0.3 * st.ap }, tip: 'Active: 253 + 30% AP' },
    "redemption": { active: { cd: 90, delay: 2.5, type: 'true', dmg: () => 0.1 * DUMMY.hp }, tip: 'Active: 10% max HP true damage' },
  };

  // ---------- Champion damage profile ----------
  const ARCHETYPE = {
    Mage: { kit: 0.9, cd: 7, uptime: 0.4, autoAmp: 1.0 }, Assassin: { kit: 1.0, cd: 7, uptime: 0.6, autoAmp: 1.05 },
    Fighter: { kit: 0.85, cd: 6, uptime: 0.8, autoAmp: 1.15 }, Tank: { kit: 0.75, cd: 7, uptime: 0.7, autoAmp: 1.1 },
    Support: { kit: 0.7, cd: 8, uptime: 0.5, autoAmp: 1.0 }, Marksman: { kit: 0.6, cd: 8, uptime: 1.0, autoAmp: 1.5 },
  };
  // With real ability data, autos only get a small stand-in for passives the data can't express
  // (e.g. marksman passives like Jinx rockets or Caitlyn headshots).
  const AUTO_AMP_REAL = { Marksman: 1.2, Fighter: 1.05, Assassin: 1.0, Tank: 1.0, Mage: 1.0, Support: 1.0 };
  const ON_HIT_CHAMPS =new Set(['Kayle', 'Varus', 'KogMaw', 'Kaisa', 'Teemo', 'Kalista', 'Gwen', 'Vayne', 'MasterYi', 'Jax']);
  const HP_CHAMPS = new Set(['Sion', 'Chogath', 'DrMundo', 'Sett', 'Vladimir', 'TahmKench', 'Volibear', 'Mordekaiser', 'Zac', 'KSante', 'Ornn', 'Maokai', 'Gragas', 'Malphite', 'Nautilus', 'Warwick']);

  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
  }

  function profile(ch) {
    const { attack: a, magic: m, defense: d } = ch.info;
    const tag = ch.tags[0];
    const arch = ARCHETYPE[tag] || ARCHETYPE.Fighter;
    const variance = 0.9 + 0.2 * hash01(ch.id);
    return {
      arch: tag, ...arch,
      base: (450 + 110 * Math.max(a, m)) * arch.kit * variance,
      apRatio: (0.4 + 0.3 * m) * arch.kit,
      adRatio: (0.4 + 0.25 * a) * arch.kit,
      hpRatio: (tag === 'Tank' || tag === 'Fighter' ? 0.02 * d : 0) + (HP_CHAMPS.has(ch.id) ? 0.45 : 0),
      magicShare: a + m ? m / (a + m) : 0.5,
      onHitAp: ON_HIT_CHAMPS.has(ch.id) ? 0.25 : 0,
    };
  }

  // ---------- Final level-18 stats ----------
  function computeStats(ch, items, kit, extra, passive) {
    extra = extra || {}; passive = passive || {};
    const s = ch.stats, L = 17; // stat growth at level 18 is exactly 17x per-level
    const b = { ad: 0, ap: 0, as: 0, crit: 0, critDmg: 0, leth: 0, ah: 0, hp: 0, mana: 0, mpenFlat: 0, armor: 0, mr: 0 };
    // Average stacks from live games and champion passives show up as extra stats (e.g. Veigar AP, Sion HP).
    for (const k of Object.keys(b)) b[k] += extra[k] || 0;
    let arpenKeep = 1 - (extra.arpen || 0) / 100, mpenKeep = 1 - (extra.mpen || 0) / 100;
    const fx = [];
    for (const it of items) {
      for (const [k, v] of Object.entries(it.stats)) {
        if (k === 'arpen') arpenKeep *= 1 - v / 100;
        else if (k === 'mpenPct') mpenKeep *= 1 - v / 100;
        else if (k in b) b[k] += v;
      }
      const p = PASSIVES[it.name.toLowerCase()];
      if (p) fx.push({ ...p, item: it.name });
    }
    const has = key => fx.filter(f => f[key] !== undefined && f[key] !== false);
    const sum = key => has(key).reduce((acc, f) => acc + f[key], 0);

    const baseAD = s.attackdamage + s.attackdamageperlevel * L;
    const baseHP = s.hp + s.hpperlevel * L;
    const bonusHP = b.hp;
    const maxHP = baseHP + bonusHP;
    const champMana = ch.partype === 'Mana' ? s.mp + s.mpperlevel * L : 0;
    const muramana = has('muramana').length > 0;
    const maxMana = champMana + b.mana + (muramana ? 360 : 0);

    let bonusAD = b.ad + sum('adPerBonusHp') * bonusHP + (muramana ? 0.02 * maxMana : 0);
    let ap = b.ap + sum('apPerBonusHp') * bonusHP + sum('apPerBonusMana') * (b.mana + 360);
    ap *= has('apMult').reduce((acc, f) => acc * f.apMult, 1) * (1 + sum('apMultAdd'));

    const crit = Math.min(1, (b.crit + sum('critBonus')) / 100 * (passive.critChanceMult || 1));
    const critMult = (1.75 + b.critDmg / 100) * (passive.critScale || 1);
    const bonusASPct = s.attackspeedperlevel * L + b.as + sum('asBonus');
    // Real formula: base AS + bonus AS% x the champion's attack speed ratio (from game files when available).
    const asBase = (kit && kit.asBase) || s.attackspeed, asRatio = (kit && kit.asRatio) ?? s.attackspeed;
    // Some champions (Jhin) have a locked attack speed: bonus attack speed is converted by their passive instead.
    const as = passive.fixedAS ? asBase : Math.min(2.5, asBase + asRatio * bonusASPct / 100);
    const baseArmor = s.armor + s.armorperlevel * L, baseMR = s.spellblock + s.spellblockperlevel * L;
    const ah = b.ah + sum('ahBonus') + sum('ahPerBonusAd') * bonusAD;
    const pen = sum('pen');
    arpenKeep *= 1 - pen; mpenKeep *= 1 - pen;

    return { baseAD, bonusAD, totalAD: baseAD + bonusAD, ap, as, asBase, bonusASPct, baseArmor, bonusArmor: b.armor, baseMR, bonusMR: b.mr, champMana, crit, critMult, ah, baseHP, bonusHP, maxHP,
      maxMana, leth: b.leth, mpenFlat: b.mpenFlat, arpenKeep, mpenKeep, fx, has, sum, muramana };
  }

  // Values a champion passive formula can read (all level 18). bas = bonus attack speed as a fraction.
  function passiveCtx(st, dummyHp, t, ch) {
    return { lvl: 18, t, ad: st.totalAD, bad: st.bonusAD, base: st.baseAD, ap: st.ap, hp: st.maxHP, bhp: st.bonusHP,
      arm: st.baseArmor + st.bonusArmor, barm: st.bonusArmor, mr: st.baseMR + st.bonusMR, bmr: st.bonusMR,
      crit: st.crit, cm: st.critMult, as: st.as, bas: st.bonusASPct / 100, mana: st.maxMana, bmana: st.maxMana - st.champMana,
      leth: st.leth, ranged: ch.ranged, shp: SELF_HP, smiss: 1 - SELF_HP, thp: dummyHp, tmax: DUMMY.hp, tmiss: DUMMY.hp - dummyHp, tbase: DUMMY.baseHp, tbhp: DUMMY.hp - DUMMY.baseHp };
  }

  // ---------- Simulation ----------
  function simulate(ch, items, opts = {}) {
    const T = opts.seconds || FIGHT_SECONDS;
    const kit = opts.kit || null;                 // raw kit (attack speed data) from abilities.js
    const spells = opts.spells && opts.spells.usable ? opts.spells : null; // described Q/W/E/R
    const stackInfo = (opts.stacks && opts.stacks[ch.id]) || {};
    // Stat-buff abilities (e.g. Vayne R) are cast at the start and last the whole fight.
    const extraStats = { ...(stackInfo.stats || {}) };
    const mechOf = kind => spells ? spells.filter(s => s.mech && s.mech.kind === kind) : [];
    for (const s of mechOf('buff')) for (const [k, v] of Object.entries(s.mech.stats)) extraStats[k] = (extraStats[k] || 0) + v;
    // Champion passive (passives.js). Stat passives are applied in a second pass because many scale with
    // the champion's own stats (e.g. Jhin turns bonus attack speed and crit into AD).
    const P = opts.noPassive ? null : ((root.Potenshall.ChampPassives || {})[ch.id] || null);
    let st = computeStats(ch, items, kit, extraStats, P);
    if (P && P.stats) {
      const add = P.stats(passiveCtx(st, DUMMY.hp, 0, ch));
      const merged = { ...extraStats };
      for (const [k, v] of Object.entries(add)) merged[k] = (merged[k] || 0) + (v || 0);
      st = computeStats(ch, items, kit, merged, P);
    }
    const pr = profile(ch);
    if (spells) {
      pr.uptime = 1;
      pr.autoAmp = (P || spells.passiveCovered) ? 1 : (AUTO_AMP_REAL[pr.arch] || 1);
      if (P || spells.passiveCovered) pr.onHitAp = 0; // real passive modeled instead of the generic on-hit stand-in
    } else if (P) {
      // Estimated kit: the archetype amp also stands in for abilities, so only half of it is passive.
      pr.autoAmp = 1 + (pr.autoAmp - 1) / 2; pr.onHitAp = 0;
    }
    const disabled = new Set((P && P.disable) || []);
    const castable = spells ? spells.filter(s => !disabled.has(s.slot)) : null;
    const everyN = mechOf('everyN');
    let empowered = null; // armed by an empowerAuto ability, spent on the next attack
    const { has, sum } = st;
    const hasAny = k => has(k).length > 0;

    const hits = []; const bySource = {}; const byType = { physical: 0, magic: 0, true: 0 };
    let dummyHp = DUMMY.hp, kills = 0, firstKill = null, total = 0;
    let cleaverStacks = 0, bloodStacks = 0, shojinStacks = 0, malignanceShred = 0;

    const comboCD = pr.cd * 100 / (100 + st.ah);
    const comboDamage = () => {
      const base = pr.base + pr.hpRatio * st.bonusHP;
      return {
        magic: base * pr.magicShare + pr.apRatio * st.ap,
        physical: base * (1 - pr.magicShare) + pr.adRatio * st.bonusAD,
      };
    };

    function deal(t, raw, type, src, kind) {
      if (!(raw > 0)) return 0;
      let amt = raw;
      if (P && P.amp) amt *= P.amp(kind, type, pctx(t));
      if (P && P.magicEcho && type === 'magic') record(t, P.magicEcho * raw, 'true', PSRC);
      const ramp = has('ramp').reduce((acc, f) => acc + Math.min(f.ramp.cap, f.ramp.per * Math.floor(t + 1)), 0);
      amt *= 1 + ramp / 100;
      if (kind === 'ability') amt *= (1 + sum('abilityAmp') * (t < 8 ? 1 : 0)) * (1 + 0.03 * shojinStacks * (hasAny('abilityRamp') ? 1 : 0));
      if (kind === 'attack') amt *= 1 + (ch.ranged ? sum('attackAmpRanged') : sum('attackAmpMelee'));
      if (type === 'magic') amt *= 1 + sum('magicAmp');
      if ((type === 'magic' || type === 'true') && hasAny('shadowflame') && dummyHp < 0.4 * DUMMY.hp) amt *= 1.2;

      if (type === 'physical') {
        const armor = Math.max(0, DUMMY.armor * (1 - 0.06 * cleaverStacks) * st.arpenKeep - st.leth);
        amt *= 100 / (100 + armor);
        if (hasAny('cleaver')) cleaverStacks = Math.min(5, cleaverStacks + 1);
      } else if (type === 'magic') {
        const mr = Math.max(0, DUMMY.mr * (1 - 0.075 * bloodStacks) * st.mpenKeep - st.mpenFlat - malignanceShred);
        amt *= 100 / (100 + mr);
        if (hasAny('bloodletter') && kind !== 'attack') bloodStacks = Math.min(4, bloodStacks + 1);
      }
      record(t, amt, type, src);
      const exec = sum('execute');
      if (exec && dummyHp > 0 && dummyHp < exec * DUMMY.hp) record(t, dummyHp, 'true', 'The Collector');
      if (P && P.execute && dummyHp > 0 && dummyHp < P.execute * DUMMY.hp) record(t, dummyHp, 'true', PSRC);
      return amt;
    }

    // ---- Champion passive helpers ----
    const PSRC = P ? `Passive · ${P.name}` : 'Passive';
    const pctx = t => passiveCtx(st, dummyHp, t, ch);
    // A passive damage spec returns a number (of spec.type) or { physical, magic, true }.
    const dealP = (t, spec, fn, kind, label) => {
      const out = fn(pctx(t));
      const src = label || spec.label || PSRC;
      if (typeof out === 'number') deal(t, out, spec.type || 'physical', src, kind || 'passive');
      else if (out) for (const ty of ['physical', 'magic', 'true']) if (out[ty]) deal(t, out[ty], ty, src, kind || 'passive');
    };
    const dots = []; // { until, perTick, type, key }
    const addDot = (t, spec, fn) => {
      const c = pctx(t), out = fn(c), dur = spec.dot;
      const parts = typeof out === 'number' ? { [spec.type || 'magic']: out } : out;
      for (const [ty, v] of Object.entries(parts || {})) {
        if (!v) continue;
        const key = (spec.key || 'p') + ty;
        const i = dots.findIndex(d => d.key === key && !spec.stacks);
        const d = { until: t + dur, perTick: v / (dur * 2), type: ty, key, src: spec.label || PSRC };
        if (i >= 0) dots[i] = d; else dots.push(d);
      }
    };
    const fireP = (t, spec, kind) => spec.dot ? addDot(t, spec, spec.dmg) : dealP(t, spec, spec.dmg, kind || spec.kind);
    let pHits = 0, pAbilities = 0, pArmed = 0, pTimedArmed = false, pTimedReady = P && P.timedAuto ? (P.timedAuto.start || 0) : Infinity;
    let pAbilityReady = 0, pAfterReady = 0, pHitsReady = 0, pNReady = 0, pAutoNReady = 0, pStack = { n: 0, until: -1 };
    let pAuras = P && P.aura ? -1 : null;
    const countHit = t => {
      pHits++;
      if (P && P.aura && pHits >= (P.aura.hits || 1)) pAuras = t + (P.aura.linger || 4);
      if (P && P.everyNHits && pHits % P.everyNHits.n === 0 && t >= pHitsReady) {
        fireP(t, P.everyNHits); pHitsReady = t + (P.everyNHits.cd || 0);
      }
      if (P && P.stackDot) { pStack.n = Math.min(P.stackDot.max, pStack.n + 1); pStack.until = t + P.stackDot.dur; }
    };

    function record(t, amt, type, src) {
      total += amt; byType[type] += amt; bySource[src] = (bySource[src] || 0) + amt;
      dummyHp -= amt;
      const killed = dummyHp <= 0;
      if (killed) { kills++; if (firstKill === null) firstKill = t; dummyHp = DUMMY.hp; }
      hits.push({ t, amt, type, src, hp: dummyHp, killed });
    }

    // Spellblade: unique, take strongest owned.
    const sbList = has('spellblade').map(f => ({ ...f.spellblade, item: f.item }));
    const spellbladeValue = sb => (sb.flat || 0) + (sb.baseAd || 0) * st.baseAD + (sb.bonusAd || 0) * st.bonusAD + (sb.ap || 0) * st.ap;
    const spellblade = sbList.sort((x, y) => spellbladeValue(y) - spellbladeValue(x))[0];
    let sbReadyAt = 0, sbArmed = false;

    let burnUntil = { liandry: -1, blackfire: -1 }, lastBurnTick = -1, ludenReady = 0;
    let malignanceUntil = -1, empoweredAutos = 0, sunderedReady = 0, autoCount = 0, zekeUntil = -1;
    // Eclipse: two separate attacks/abilities within 2s deal 8% max HP (ranged 62.5% of that), 6s cooldown.
    let eclipseLast = -Infinity, eclipseReady = 0;
    const eclipseHit = t => {
      if (!hasAny('eclipse')) return;
      if (t >= eclipseReady && t - eclipseLast <= 2 && t > eclipseLast) {
        eclipseReady = t + 6; eclipseLast = -Infinity;
        deal(t, 0.08 * DUMMY.hp * (ch.ranged ? 0.625 : 1), 'physical', 'Eclipse', 'item');
      } else eclipseLast = t;
    };
    let openerDone = false;
    let heartsteelDone = false, stormsurgeAt = null, stormsurgeDone = false, titanicReady = 0;

    const onAbilityHit = (t, first, cast) => {
      if (P) {
        pAbilities++;
        if (P.afterAbility && t >= pAfterReady) {
          pArmed = Math.min(P.afterAbility.max || P.afterAbility.charges || 1, pArmed + (P.afterAbility.charges || 1));
          pAfterReady = t + (P.afterAbility.cd || 0);
        }
        if (P.onAbility && t >= pAbilityReady) { fireP(t, P.onAbility); pAbilityReady = t + (P.onAbility.cd || 0); }
        if (P.everyNAbility && pAbilities % P.everyNAbility.n === 0 && t >= pNReady) {
          const e = P.everyNAbility; pNReady = t + (e.cd || 0);
          if (e.echo && cast) deal(t, cast.raw * e.echo, cast.type, `${cast.label} (echo)`, 'ability');
          if (e.dmg) fireP(t, e);
        }
        if (P.timedAuto && P.timedAuto.abilityCdr) pTimedReady -= P.timedAuto.abilityCdr;
        countHit(t);
      }
      if (spellblade && t >= sbReadyAt) { sbArmed = true; sbReadyAt = t + 1.5; }
      for (const f of has('burn')) burnUntil[f.burn] = t + 3;
      if (hasAny('abilityRamp')) shojinStacks = Math.min(4, shojinStacks + 1);
      if (hasAny('luden') && t >= ludenReady) { ludenReady = t + 12; deal(t, (75 + 0.05 * st.ap) * 2, 'magic', "Luden's Echo", 'item'); } // 1 bolt + 5 repeats at 20%
      eclipseHit(t);
      if (first && hasAny('bastion')) deal(t, 60 + 0.05 * st.bonusAD, 'true', 'Bastionbreaker', 'item');
      if (first && st.muramana) deal(t, 0.035 * st.maxMana, 'physical', 'Manamune', 'item');
    };

    const castAbility = (t, mult, src, first) => {
      const d = comboDamage();
      deal(t, d.physical * mult, 'physical', src, 'ability');
      deal(t, d.magic * mult, 'magic', src, 'ability');
      const big = d.magic > d.physical ? 'magic' : 'physical';
      onAbilityHit(t, first, { raw: (d.physical + d.magic) * mult, type: big, label: src });
    };

    const onHitEffects = (t, times) => {
      for (let i = 0; i < times; i++) {
        for (const f of has('onHit')) {
          const o = f.onHit;
          if (o.magic || o.ap) deal(t, (o.magic || 0) + (o.ap || 0) * st.ap, 'magic', f.item, 'onhit');
          if (o.curHpMelee) deal(t, dummyHp * (ch.ranged ? o.curHpRanged : o.curHpMelee), 'physical', f.item, 'onhit');
          if (o.ownHpMelee) deal(t, st.maxHP * (ch.ranged ? o.ownHpRanged : o.ownHpMelee), 'physical', f.item, 'onhit');
        }
        if (pr.onHitAp) deal(t, pr.onHitAp * st.ap + 20, 'magic', 'Champion on-hit', 'onhit');
        if (P && P.onHit && (!P.onHit.cond || P.onHit.cond(pctx(t)))) { if (P.onHit.dot) addDot(t, P.onHit, P.onHit.dmg); else dealP(t, P.onHit, P.onHit.dmg, 'onhit'); }
        if (st.muramana) deal(t, 0.012 * st.maxMana, 'physical', 'Manamune', 'onhit');
      }
    };

    const basicAttack = (t) => {
      autoCount++;
      const pN = P && P.everyN && autoCount % P.everyN.n === 0 && t >= pAutoNReady ? P.everyN : null;
      let mult = P && P.noCrit ? 1 : 1 + st.crit * (st.critMult - 1);
      let trueBonus = 0;
      if (pN && pN.crit) mult = Math.max(st.critMult, pN.minCrit || 0); // e.g. Jhin's 4th shot always crits
      else if (hasAny('sundered') && t >= sunderedReady) { sunderedReady = t + 10; mult = st.critMult; }
      else if (empoweredAutos > 0) {
        empoweredAutos--;
        mult = Math.max(mult, 1 + 0.8 * (st.critMult - 1));
        trueBonus = 0.15 * st.totalAD * st.critMult * st.crit;
      }
      let autoDmg = st.totalAD * mult * pr.autoAmp;
      if (P && P.autoMult) autoDmg *= typeof P.autoMult === 'function' ? P.autoMult(pctx(t)) : P.autoMult;
      if (P && P.autoSplit) {
        for (const [ty, share] of Object.entries(P.autoSplit)) deal(t, autoDmg * share, ty, 'Basic Attacks', 'attack');
        autoDmg *= 1 - Object.values(P.autoSplit).reduce((a, b) => a + b, 0);
      }
      deal(t, autoDmg, 'physical', 'Basic Attacks', 'attack');
      if (!openerDone) {
        openerDone = true;
        if (hasAny('dmp')) deal(t, 40 + st.baseAD, 'physical', "Dead Man's Plate", 'onhit');
        if (hasAny('umbral')) deal(t, (ch.ranged ? 2 : 3) * st.leth, 'true', 'Umbral Glaive', 'onhit');
      }
      eclipseHit(t);
      let pExtraOnHit = 0;
      if (P) {
        if (pN) { if (pN.dmg) fireP(t, pN); if (pN.extraOnHit) pExtraOnHit++; pAutoNReady = t + (pN.cd || 0); }
        if (pArmed > 0) {
          pArmed--;
          const a = P.afterAbility;
          if (a.dmg) fireP(t, a);
          if (a.extraAttack) { deal(t, st.totalAD * a.extraAttack * (1 + st.crit * (st.critMult - 1)), 'physical', PSRC, 'attack'); pExtraOnHit++; }
        }
        if (pTimedArmed) { pTimedArmed = false; fireP(t, P.timedAuto); }
        countHit(t);
      }
      if (trueBonus) deal(t, trueBonus, 'true', 'Fiendhunter Bolts', 'attack');
      if (empowered) {
        const e = empowered; empowered = null;
        deal(t, (e.adRatio || 0) * st.totalAD + (e.bonusAdRatio || 0) * st.bonusAD + (e.apRatio || 0) * st.ap + (e.flat || 0), e.type, e.label, 'ability');
      }
      for (const sp of everyN) {
        const m = sp.mech;
        if (autoCount % m.n !== 0) continue;
        const raw = Math.max(m.floor || 0, (m.pctTargetMaxHp || 0) * DUMMY.hp + (m.flat || 0));
        deal(t, raw, m.type, `${sp.slot} · ${labels[sp.slot] || sp.name}`, 'onhit');
      }

      let onHitTimes = 1 + pExtraOnHit;
      if (hasAny('guinsoo') && autoCount % 3 === 0) onHitTimes++;
      if (sbArmed) {
        sbArmed = false;
        const v = spellbladeValue(spellblade);
        deal(t, v, spellblade.type, spellblade.item, 'onhit');
        if (spellblade.doubleOnHit) onHitTimes++;
      }
      onHitEffects(t, onHitTimes);

      for (const f of has('everyN')) {
        const e = f.everyN;
        if (autoCount % e.n !== 0) continue;
        if (e.phys) deal(t, e.phys * (1 + (e.missingAmp || 0) * (1 - dummyHp / DUMMY.hp)) * (ch.ranged ? (e.rangedMult || 1) : 1), 'physical', f.item, 'onhit');
        if (e.magic) deal(t, e.magic, 'magic', f.item, 'onhit');
        if (e.curHp) deal(t, (ch.ranged && e.curHpRanged ? e.curHpRanged : e.curHp) * dummyHp, 'physical', f.item, 'onhit');
        // Hullbreaker Skipper (game files): 120% base AD + 5% max HP; ranged champions deal 70%.
        if (e.hull) deal(t, (1.2 * st.baseAD + 0.05 * st.maxHP) * (ch.ranged ? 0.7 : 1), 'physical', f.item, 'onhit');
      }
      if (hasAny('titanic') && t >= titanicReady) { titanicReady = t + 10; deal(t, 0.04 * st.maxHP, 'physical', 'Titanic Hydra', 'onhit'); }
      if (hasAny('heartsteel') && !heartsteelDone && t >= 2.5) { heartsteelDone = true; deal(t, 70 + 0.06 * st.maxHP, 'physical', 'Heartsteel', 'onhit'); }
    };

    // ---- Real abilities: cast each damaging Q/W/E/R off cooldown with its game formula ----
    const labels = opts.spellNames || {};
    const ready = {}; let castLock = 0, bastionReady = 0;
    const spellCtx = () => ({
      self: { level: 18, ap: st.ap, ad: st.totalAD, baseAD: st.baseAD, bonusAD: st.bonusAD,
        as: st.as, baseAS: st.asBase, bonusAS: st.as - st.asBase,
        armor: st.baseArmor + st.bonusArmor, baseArmor: st.baseArmor, bonusArmor: st.bonusArmor,
        mr: st.baseMR + st.bonusMR, baseMR: st.baseMR, bonusMR: st.bonusMR,
        maxHp: st.maxHP, baseHp: st.baseHP, bonusHp: st.bonusHP, curHp: SELF_HP * st.maxHP, missingHp: (1 - SELF_HP) * st.maxHP,
        crit: st.crit, critMult: st.critMult, mana: st.maxMana, baseMana: st.champMana, bonusMana: st.maxMana - st.champMana,
        lethality: st.leth, ms: 400 },
      target: { maxHp: DUMMY.hp, curHp: dummyHp, missingHp: DUMMY.hp - dummyHp, armor: DUMMY.armor, mr: DUMMY.mr,
        baseHp: DUMMY.baseHp, bonusHp: DUMMY.hp - DUMMY.baseHp },
      stacks: stackInfo.counter ?? 0,
    });
    const SPELL_MECHS = new Set(['cast', 'channel', 'hits', 'multi']);
    const spellQueue = []; // scheduled ability hits/ticks: { at, raw(), type, label }
    const onUltimate = t => {
      if (hasAny('malignance')) { malignanceUntil = t + 3; malignanceShred = 10; }
      if (hasAny('zeke')) zekeUntil = t + 5;
      if (hasAny('fiendhunter')) empoweredAutos = 3;
    };
    const tryCastRealSpell = (t) => {
      if (t < castLock) return;
      for (const sp of castable) {
        if ((ready[sp.slot] || 0) > t + 1e-9) continue;
        if (sp.mech && sp.mech.kind === 'empowerAuto') {
          if (empowered) continue; // don't waste it before the armed attack lands
          empowered = { ...sp.mech, label: `${sp.slot} · ${labels[sp.slot] || sp.name}` };
          onAbilityHit(t, false);
          ready[sp.slot] = t + sp.cooldown * 100 / (100 + st.ah);
          castLock = t + sp.castTime;
          if (sp.mech.resetsAttack) nextAuto = Math.min(nextAuto, castLock);
          return;
        }
        if (sp.mech && SPELL_MECHS.has(sp.mech.kind)) {
          const m = sp.mech, label = `${sp.slot} · ${labels[sp.slot] || sp.name}`;
          const ev = name => { const v = root.Potenshall.Abilities.evalCalc(name, sp.sp, { ...spellCtx(), rank: sp.rank }); return Number.isFinite(v) && v > 0 ? Math.min(v, 6000) : 0; };
          let first = 0;
          if (m.kind === 'cast') first = deal(t, ev(m.calc) * (m.pctOfMissing ? DUMMY.hp - dummyHp : 1), m.type, label, 'ability');
          else if (m.kind === 'multi') for (const p of m.parts) first += deal(t, ev(p.calc), p.type, label, 'ability');
          else if (m.kind === 'hits') {
            for (let i = 0; i < m.n; i++) spellQueue.push({ at: t + (m.n > 1 ? i * m.over / (m.n - 1) : 0), label, type: m.type,
              raw: () => { const b = ev(m.calc); return m.critCalc ? b + st.crit * (ev(m.critCalc) - b) : b; } });
          } else if (m.kind === 'channel') {
            const dur = Math.min(m.duration || 99, T);
            for (let k = 0.5; k <= dur + 1e-9; k += 0.5) spellQueue.push({ at: t + k, label, type: m.type,
              raw: () => (m.empCalc && k > m.empAfter ? ev(m.empCalc) : ev(m.perSec)) / 2 });
          }
          onAbilityHit(t, t >= bastionReady, { raw: first, type: m.type, label });
          if (t >= bastionReady) bastionReady = t + 3;
          if (sp.slot === 'R') onUltimate(t);
          ready[sp.slot] = m.once ? Infinity : t + sp.cooldown * 100 / (100 + st.ah);
          castLock = t + sp.castTime;
          return;
        }
        if (!sp.damaging) continue;
        const dmg = root.Potenshall.Abilities.evalSpellDamage(sp, spellCtx());
        const label = `${sp.slot} · ${labels[sp.slot] || sp.name}`;
        deal(t, dmg, sp.type, label, 'ability');
        onAbilityHit(t, t >= bastionReady, { raw: dmg, type: sp.type, label });
        if (t >= bastionReady) bastionReady = t + 3;
        if (sp.slot === 'R') onUltimate(t);
        ready[sp.slot] = t + sp.cooldown * 100 / (100 + st.ah);
        castLock = t + sp.castTime;
        return;
      }
    };

    // Event schedule
    const attackInterval = 1 / (st.as * pr.uptime);
    let nextAuto = 0.1, nextCombo = 0, comboQueue = [], ultDone = false, nextDespair = 0;
    // periodic may be one timer or a list (e.g. a passive plus an ability modeled as a timer). No 'every' = fires once.
    const pPeriodics = P ? [].concat(P.periodic || []).map(pe => ({ pe, at: pe.start || 0 })) : [];
    let pTimedOnceDone = false;
    if (hasAny('rocketbelt')) deal(0, 135 + 0.15 * st.ap, 'magic', 'Hextech Rocketbelt', 'item');
    const actives = has('active').map(f => ({ ...f.active, item: f.item, at: f.active.delay || 0 }));
    if (spells) nextCombo = Infinity;

    for (let t = 0; t < T - 1e-9; t = +(t + DT).toFixed(4)) {
      if (spells) tryCastRealSpell(t);
      // Channels and multi-hit abilities: each tick is real ability damage (item amps apply, burns stay lit).
      for (let i = spellQueue.length - 1; i >= 0; i--) {
        const q = spellQueue[i];
        if (q.at > t + 1e-9) continue;
        spellQueue.splice(i, 1);
        deal(t, q.raw(), q.type, q.label, 'ability');
        for (const f of has('burn')) burnUntil[f.burn] = t + 3;
      }
      if (spells && t < castLock && t >= nextAuto) nextAuto = castLock; // can't attack mid-cast
      if (t >= nextCombo) {
        comboQueue.push({ at: t, mult: 1 / 3, src: 'Abilities', first: true },
          { at: t + 0.3, mult: 1 / 3, src: 'Abilities' }, { at: t + 0.6, mult: 1 / 3, src: 'Abilities' });
        if (!ultDone) { ultDone = true; comboQueue.push({ at: t + 0.9, mult: 0.5, src: 'Ultimate', ult: true }); }
        nextCombo = t + comboCD;
      }
      comboQueue = comboQueue.filter(c => {
        if (c.at > t + 1e-9) return true;
        castAbility(t, c.mult, c.src, c.first);
        if (c.ult) onUltimate(t);
        return false;
      });
      // Passive timers: empowered attack coming off cooldown, periodic effects, auras.
      if (P && P.timedAuto && !pTimedArmed && t >= pTimedReady && !(P.timedAuto.once && pTimedOnceDone)) {
        const ta = P.timedAuto;
        if (!ta.cond || ta.cond(pctx(t))) { pTimedArmed = true; pTimedOnceDone = true; pTimedReady = t + (ta.every || Infinity); }
      }
      for (const x of pPeriodics) {
        if (t < x.at) continue;
        x.at = t + (x.pe.every || Infinity);
        if (!x.pe.cond || x.pe.cond(pctx(t))) fireP(t, x.pe);
      }
      if (t >= nextAuto) {
        basicAttack(t);
        let gap = empoweredAutos > 0 ? attackInterval / 1.5 : attackInterval;
        if (P && P.magazine && autoCount % P.magazine.size === 0) {
          const rl = typeof P.magazine.reload === 'function' ? P.magazine.reload(pctx(t)) : P.magazine.reload;
          gap = Math.max(gap, rl);
        }
        nextAuto = t + gap;
      }
      // Half-second damage-over-time ticks
      if (Math.floor(t * 2) !== lastBurnTick) {
        lastBurnTick = Math.floor(t * 2);
        for (let i = dots.length - 1; i >= 0; i--) {
          const d = dots[i];
          if (t > d.until) { dots.splice(i, 1); continue; }
          deal(t, d.perTick, d.type, d.src, 'dot');
        }
        if (P && P.stackDot && pStack.n > 0) {
          if (t > pStack.until) pStack.n = 0;
          else deal(t, pStack.n * P.stackDot.perStack(pctx(t)) / 2, P.stackDot.type || 'physical', PSRC, 'dot');
        }
        if (P && P.aura && pAuras !== null && t <= pAuras) dealP(t, P.aura, c => {
          const v = P.aura.dmg(c); return typeof v === 'number' ? v / 2 : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x / 2]));
        }, 'dot');
        if (t <= burnUntil.liandry) deal(t, 0.01 * DUMMY.hp, 'magic', "Liandry's Torment", 'dot');
        if (t <= burnUntil.blackfire) deal(t, (20 + 0.02 * st.ap) / 2, 'magic', 'Blackfire Torch', 'dot');
        if (t <= zekeUntil) deal(t, 30 / 2, 'magic', "Zeke's Convergence", 'dot');
        if (t <= malignanceUntil) deal(t, (60 + 0.05 * st.ap) / 2, 'magic', 'Malignance', 'dot');
        for (const f of has('immolate')) deal(t, (f.immolate.base + f.immolate.bhp * st.bonusHP) / 2, 'magic', f.item, 'dot');
      }
      if (hasAny('despair') && t >= nextDespair) { nextDespair = t + 4; deal(t, 0.03 * st.bonusHP, 'magic', 'Unending Despair', 'dot'); }
      for (const a of actives) if (t >= a.at) { a.at = t + a.cd; deal(t, a.dmg(st, dummyHp), a.type, a.item + ' (active)', 'item'); }
      if (hasAny('stormsurge') && !stormsurgeDone) {
        if (stormsurgeAt === null && total >= 0.25 * DUMMY.hp && t <= 2.5) stormsurgeAt = t + 2;
        if (stormsurgeAt !== null && t >= stormsurgeAt) { stormsurgeDone = true; deal(t, 125 + 0.1 * st.ap, 'magic', 'Stormsurge', 'item'); }
      }
    }

    return {
      total, byType, bySource, hits, kills, firstKill, seconds: T,
      stats: { ad: st.totalAD, bonusAD: st.bonusAD, ap: st.ap, as: st.as, crit: st.crit, critMult: st.critMult,
        ah: st.ah, hp: st.maxHP, mana: st.maxMana, leth: st.leth,
        armorPen: 1 - st.arpenKeep, magicPen: 1 - st.mpenKeep, mpenFlat: st.mpenFlat },
      profile: pr, realKit: !!spells, passive: P ? { name: P.name, note: P.note || '' } : null,
    };
  }

  // ---------- Ranking ----------
  const TIERS = [
    // Calibrated against simulated drafts on 16.23: a strong drafter's median is ~7.2K; killing the dummy is top ~1%.
    { name: 'Iron', min: 0, color: '#6b5d55' }, { name: 'Bronze', min: 3000, color: '#a0663e' },
    { name: 'Silver', min: 4500, color: '#9aa7b1' }, { name: 'Gold', min: 5750, color: '#d6a74a' },
    { name: 'Platinum', min: 6750, color: '#3fb6a8' }, { name: 'Emerald', min: 7750, color: '#2fbf71' },
    { name: 'Diamond', min: 8750, color: '#6c8cff' }, { name: 'Master', min: 10000, color: '#b05ce6' },
    { name: 'Grandmaster', min: 11500, color: '#e2463f' }, { name: 'Challenger', min: 13000, color: '#f4d675' },
  ];
  function tierFor(total) { let t = TIERS[0]; for (const x of TIERS) if (total >= x.min) t = x; return t; }

  // How "Bausffs" is the build? Counts items that don't match the champ's natural damage type.
  function itemFlavor(it) {
    const s = it.stats;
    const off = (s.ad || 0) + (s.crit || 0) + (s.leth || 0) * 2 + (s.as || 0) * 0.8;
    const mag = (s.ap || 0);
    if (off === 0 && mag === 0) return 'tank';
    return mag > off ? 'ap' : 'ad';
  }
  function abstractness(ch, items) {
    const natural = ch.info.magic > ch.info.attack ? 'ap' : 'ad';
    const isTank = ch.tags[0] === 'Tank';
    return items.filter(it => {
      const f = itemFlavor(it);
      if (f === 'tank') return !isTank;
      return f !== natural;
    }).length;
  }

  // ---------- Draft (shared by the game and the leaderboard server) ----------
  // Every offer comes from a seeded RNG, so a draft can be replayed exactly from its seed and
  // its action log ('r' = reroll, a number = pick that offer). The server uses this to verify
  // leaderboard submissions.
  const DRAFT = { CHAMP_CHOICES: 5, ITEM_CHOICES: 4, ITEM_SLOTS: 6, REROLLS: 3 };
  function hashStr(str) { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return h >>> 0; }
  function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function sample(rng, arr, n, exclude = new Set()) {
    const pool = arr.filter(x => !exclude.has(x.id)); const out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return out;
  }

  function createDraft(data, seed) {
    const rng = mulberry32(hashStr(seed));
    const d = { seed, rerolls: DRAFT.REROLLS, champ: null, items: [], offers: [], log: [] };
    const itemOffers = (extra = []) => sample(rng, data.items, DRAFT.ITEM_CHOICES, new Set([...extra, ...d.items.map(i => i.id)]));
    d.offers = sample(rng, data.champions, DRAFT.CHAMP_CHOICES);
    d.done = () => d.items.length >= DRAFT.ITEM_SLOTS;
    d.reroll = () => {
      if (d.rerolls <= 0 || d.done()) throw new Error('No rerolls left');
      d.rerolls--; d.log.push('r');
      const shown = d.offers.map(o => o.id);
      d.offers = d.champ ? itemOffers(shown) : sample(rng, data.champions, DRAFT.CHAMP_CHOICES, new Set(shown));
    };
    d.pick = (i) => {
      const choice = d.offers[i];
      if (!choice || d.done()) throw new Error('Invalid pick');
      d.log.push(i);
      if (!d.champ) d.champ = choice; else d.items.push(choice);
      d.offers = d.done() ? [] : itemOffers();
    };
    return d;
  }

  function replayDraft(data, seed, log) {
    if (!Array.isArray(log) || log.length > 20) throw new Error('Bad draft log');
    const d = createDraft(data, seed);
    for (const a of log) { if (a === 'r') d.reroll(); else if (Number.isInteger(a)) d.pick(a); else throw new Error('Bad draft action'); }
    if (!d.champ || !d.done()) throw new Error('Draft not finished');
    return d;
  }

  const api = { DDRAGON, DUMMY, FIGHT_SECONDS, SELF_HP, TIERS, PASSIVES, DRAFT, loadPatchData, buildChampionPool, buildItemPool,
    parseStats, computeStats, simulate, tierFor, abstractness, itemFlavor, createDraft, replayDraft };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Potenshall = api;
})(typeof window !== 'undefined' ? window : globalThis);
