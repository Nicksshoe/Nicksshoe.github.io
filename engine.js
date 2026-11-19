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
  // Boots: tier-2 boots and their upgraded tier-3 versions (built from tier-2 boots; Gunmetal Greaves
  // isn't tagged Boots, so the recipe is checked too). Plain Boots and unbuyable boots are left out.
  function isBoots(id, v, json) {
    if (id === '1001') return false;
    if ((v.tags || []).includes('Boots')) return true;
    return (v.from || []).some(f => json.data[f] && (json.data[f].tags || []).includes('Boots'));
  }

  function buildItemPool(json) {
    const seen = new Set();
    const out = [];
    for (const [id, v] of Object.entries(json.data)) {
      const g = v.gold || {};
      if (!v.maps || !v.maps['11'] || !g.purchasable) continue;
      const tags = v.tags || [];
      const boots = Number(id) < 10000 && isBoots(id, v, json);
      if (!boots) {
        if ((v.into && v.into.length) || Number(id) >= 10000 || g.total < 2000) continue;
        if (tags.includes('Boots') || tags.includes('Consumable') || tags.includes('Trinket')) continue;
      }
      if (v.requiredAlly || v.requiredChampion || v.inStore === false) continue;
      if (seen.has(v.name)) continue;
      seen.add(v.name);
      const parsed = parseStats(v.description || '');
      const passives = [...(v.description || '').matchAll(/<(passive|active)>(.*?)<\/\1>/g)].map(m => m[2].trim()).filter(Boolean);
      out.push({ id, name: v.name, gold: g.total, tags, boots, stats: parsed.stats, statLines: parsed.lines, passives,
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
    "overlord's bloodmail": { adPerBonusHp: 0.025, retribution: 0.1, tip: 'Tyranny: 2.5% bonus HP as AD; Retribution: up to +10% AD from missing health (max at 70% missing)' },
    "riftmaker": { apPerBonusHp: 0.02, ramp: { per: 2, cap: 8 }, tip: 'Void Corruption: +8% damage (assumed fully stacked)' },
    "archangel's staff": { apPerBonusMana: 0.01, tip: 'Awe: AP from bonus mana' },
    "manamune": { muramana: true, tip: 'Assumed stacked into Muramana' },
    "liandry's torment": { burn: 'liandry', ramp: { per: 2, cap: 6 }, tip: 'Torment: 2% max HP burn; Suffering +6% damage (fully stacked)' },
    "blackfire torch": { burn: 'blackfire', apMultAdd: 0.04, tip: 'Baleful Blaze burn' },
    "sunfire aegis": { immolate: { base: 20, bhp: 0.015 }, tip: 'Immolate: 20 + 1.5% bonus HP per second' },
    "hollow radiance": { immolate: { base: 10, bhp: 0.0175 }, tip: 'Immolate: 10 + 1.75% bonus HP per second' },
    "unending despair": { despair: true, tip: 'Anguish pulse every 4s' },
    "heartsteel": { heartsteel: true, maxStacks: { hp: 600 }, tip: 'Colossal Consumption: 6% max HP hit; assumes +600 HP from stacks' },
    "nashor's tooth": { onHit: { magic: 15, ap: 0.15 }, tip: 'On-hit 15 + 15% AP' },
    "wit's end": { onHit: { magic: 45 }, tip: 'On-hit magic' },
    "guinsoo's rageblade": { onHit: { magic: 30 }, asBonus: 32, guinsoo: true, tip: 'Fully stacked (+32% AS): every 3rd attack applies on-hit twice' },
    "terminus": { onHit: { magic: 30 }, pen: 0.30, tip: 'On-hit + 30% pen (fully stacked)' },
    "blade of the ruined king": { onHit: { curHpMelee: 0.09, curHpRanged: 0.06 }, tip: '% current HP on-hit' },
    "titanic hydra": { onHit: { ownHpMelee: 0.01, ownHpRanged: 0.005 }, titanic: true, tip: '1% max HP on-hit; active 4% max HP' },
    "kraken slayer": { everyN: { n: 3, phys: 200, missingAmp: 0.75, rangedMult: 0.8 }, tip: 'Every 3rd attack: 200 at level 18, up to +75% vs missing health (80% ranged)' },
    "statikk shiv": { everyN: { n: 3, magic: 60, onHit: true }, tip: 'Energized lightning: 60 magic, applies on-hit effects again' },
    "rapid firecannon": { everyN: { n: 3, magic: 40 }, tip: 'Energized attack' },
    "stormrazor": { everyN: { n: 3, magic: 100 }, tip: 'Energized bolt: 100 magic damage' },
    "hullbreaker": { everyN: { n: 5, hull: true }, tip: 'Skipper: every 5th attack, 120% base AD + 5% max HP' },
    "voltaic cyclosword": { everyN: { n: 4, curHp: 0.08, curHpRanged: 0.06 }, tip: 'Energized: 8% current HP (6% ranged)' },
    "trinity force": { spellblade: { baseAd: 2.0, type: 'physical' }, tip: 'Spellblade 200% base AD' },
    "lich bane": { spellblade: { baseAd: 0.75, ap: 0.45, type: 'magic' }, tip: 'Spellblade AP burst' },
    "iceborn gauntlet": { spellblade: { baseAd: 1.5, type: 'physical' }, tip: 'Spellblade 150% base AD' },
    "essence reaver": { spellblade: { baseAd: 1.25, critFlat: 50, type: 'physical' }, tip: 'Spellblade 125% base AD (+50 x crit chance)' },
    "dusk and dawn": { spellblade: { baseAd: 0.75, ap: 0.1, type: 'magic', doubleOnHit: true }, tip: 'Spellblade: 75% base AD + 10% AP, applies on-hit twice' },
    "infinity edge": { tip: 'Crit damage amp' },
    "the collector": { execute: 0.05, tip: 'Executes below 5% HP' },
    "black cleaver": { cleaver: true, tip: 'Shreds up to 30% armor (half for ranged)' },
    "bloodletter's curse": { bloodletter: true, tip: 'Shreds up to 30% MR' },
    "abyssal mask": { magicAmp: 0.12, tip: '+12% magic damage taken' },
    "shadowflame": { shadowflame: true, tip: '+20% magic/true dmg under 40% HP' },
    "luden's echo": { luden: true, tip: 'Echo: 75 + 5% AP, extra bolts at 20%, every 12s' },
    "stormsurge": { stormsurge: true, tip: 'Squall after big burst' },
    "hextech rocketbelt": { rocketbelt: true, tip: 'Opening missile volley' },
    "malignance": { malignance: true, ultHaste: 20, tip: 'Hatefog burn on ult; +20 ultimate haste' },
    "bastionbreaker": { bastion: true, tip: 'Shaped Charge: 40 + 150% lethality true damage on an ability hit, 20s cooldown (half for ranged)' },
    "spear of shojin": { ahBonus: 25, abilityRamp: 0.03, tip: 'Focused Will: +12% ability and passive damage (fully stacked)' },
    "actualizer": { ahBonus: 20, abilityAmp: 0.15, actualizer: true, tip: 'Empowered for the first 8s: more ability damage, basic cooldowns tick 30% faster' },
    "navori flickerblade": { navori: true, tip: 'Transcendence: attacks cut remaining Q/W/E cooldowns by 15%' },
    "endless hunger": { ahPerBonusAd: 0.12, tip: 'Haste from bonus AD' },
    "yun tal wildarrows": { critBonus: 25, asBonus: 18, tip: '+25% crit (fully stacked) + Flurry' },
    "experimental hexplate": { hexplate: true, ultHaste: 30, tip: 'Overdrive: +50% AS (25% ranged) for 8s after your ultimate, 30s cooldown; +30 ultimate haste' },
    "fiendhunter bolts": { fiendhunter: true, ultHaste: 30, tip: 'After your ultimate (45s cooldown): 3 attacks +50% AS that crit for 80% (real crits +15% true); +30 ultimate haste' },
    "imperial mandate": { mandate: true, tip: 'Immobilizing abilities: +20 haste and mark the target 7% Vulnerable for 4s' },
    "horizon focus": { horizon: true, tip: 'Hypershot (ranged champions): +10% damage for 6s after an ability hit, 30s cooldown' },
    "lord dominik's regards": { giantSlayer: 0.15, tip: 'Giant Slayer: up to +15% damage vs bonus health (full at 1500)' },
    "sterak's gage": { adPerBaseAd: 0.5, tip: 'The Claws that Catch: +50% base AD' },
    "dawncore": { maxStacks: { ap: 15 }, tip: 'First Light: +15 AP from its 100% base mana regen' },
    "rod of ages": { maxStacks: { hp: 100, mana: 300, ap: 30 }, tip: 'Timeless: fully stacked (+100 HP, +300 mana, +30 AP)' },
    "hexoptics c44": { attackAmpRanged: 0.10, attackAmpMelee: 0.04, tip: 'Long-range attack amp' },
    "swiftmarch": { adaptive: 21, tip: 'Noxian Fervor: 5% of move speed as adaptive force' },
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
      if (p && p.maxStacks) for (const [k, v] of Object.entries(p.maxStacks)) b[k] += v; // stacking items start fully stacked
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

    let bonusAD = b.ad + sum('adPerBonusHp') * bonusHP + (muramana ? 0.02 * maxMana : 0) + sum('adPerBaseAd') * baseAD;
    // Overlord's Bloodmail Retribution: up to +10% AD, full at 70% missing health (the fight is at 40% health).
    if (sum('retribution')) bonusAD += sum('retribution') * Math.min(1, (1 - SELF_HP) / 0.7) * (baseAD + bonusAD);
    // Adaptive force: AP if the build has more AP than bonus AD, otherwise 0.6 AD per point.
    const adaptive = sum('adaptive');
    const apLean = b.ap > b.ad || (b.ap === b.ad && ch.info.magic > ch.info.attack); // ties go to the champion's own damage type
    if (adaptive && apLean) b.ap += adaptive; else if (adaptive) bonusAD += 0.6 * adaptive;
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
    // Stat-buff abilities: cast at the start; a buff shorter than the fight counts for its share of the 10s.
    for (const s of mechOf('buff')) for (const [k, v] of Object.entries(s.mech.stats)) extraStats[k] = (extraStats[k] || 0) + v * Math.min(1, (s.mech.duration || T) / T);
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
    } else if (P && P.ownKit) {
      pr.uptime = 1; pr.autoAmp = 1; pr.onHitAp = 0; // the passive table models this champion's whole kit
    } else if (P) {
      // Estimated kit: the archetype amp also stands in for abilities, so only half of it is passive.
      pr.autoAmp = 1 + (pr.autoAmp - 1) / 2; pr.onHitAp = 0;
    }
    const disabled = new Set((P && P.disable) || []);
    // ownKit: the passive table models the whole kit (form swaps, weapon/awaken rotations), so the raw slots don't cast.
    const castable = spells ? (P && P.ownKit ? [] : spells.filter(s => !disabled.has(s.slot))) : null;
    const everyN = mechOf('everyN');
    let empowered = null; // armed by an empowerAuto ability, spent on the next attack
    const { has, sum } = st;
    const hasAny = k => has(k).length > 0;

    const hits = []; const bySource = {}; const byType = { physical: 0, magic: 0, true: 0 };
    let dummyHp = DUMMY.hp, kills = 0, firstKill = null, total = 0;
    let cleaverStacks = 0, bloodStacks = 0, malignanceShred = 0;
    // Armor / magic resist taken from the dummy by abilities (Jarvan Q, Kog'Maw Q, Trundle R steal, Mordekaiser R...).
    // Each source refreshes itself; % reductions multiply, flat ones subtract first (game order: flat reduction,
    // % reduction, % penetration, flat penetration).
    const resDebuffs = [];
    const addDebuff = (t, d, key) => {
      if (!d) return;
      const from = t + (d.delay || 0);
      const o = { key, from, until: from + (d.dur || 4), armor: d.armor || 0, mr: d.mr || 0, armorFlat: d.armorFlat || 0, mrFlat: d.mrFlat || 0 };
      const i = resDebuffs.findIndex(x => x.key === key);
      if (i >= 0) resDebuffs[i] = o; else resDebuffs.push(o);
    };
    const debuffMult = (t, k) => resDebuffs.reduce((m, d) => t >= d.from && t < d.until ? m * (1 - d[k]) : m, 1);
    const debuffFlat = (t, k) => resDebuffs.reduce((s, d) => t >= d.from && t < d.until ? s + d[k] : s, 0);
    const armorAt = t => Math.max(0, Math.max(0, DUMMY.armor - debuffFlat(t, 'armorFlat')) * (1 - 0.06 * cleaverStacks * (ch.ranged ? 0.5 : 1))
      * (t < shredUntil ? 1 - shredPct : 1) * debuffMult(t, 'armor') * st.arpenKeep - st.leth);
    const mrAt = t => Math.max(0, Math.max(0, DUMMY.mr - debuffFlat(t, 'mrFlat')) * (1 - 0.075 * bloodStacks) * debuffMult(t, 'mr')
      * st.mpenKeep - st.mpenFlat - malignanceShred);
    // Imperial Mandate: +20 haste on immobilizing abilities; immobilizing marks the target 7% Vulnerable for 4s.
    // Which abilities immobilize comes from Riot's ability text (cc.js).
    const immob = new Set((((root.Potenshall.Immobilize || {})[ch.id]) || '').split(''));
    const cdOf = (slot, base) => base * 100 / (100 + st.ah + (slot === 'R' ? sum('ultHaste') : 0) + (hasAny('mandate') && immob.has(slot) ? 20 : 0));
    let mandateUntil = -1, horizonUntil = -1, horizonReady = 0;
    const castDebuff = (t, slot) => {
      if (P && P.castDebuff && P.castDebuff[slot]) addDebuff(t, P.castDebuff[slot], slot);
      if (hasAny('mandate') && immob.has(slot)) mandateUntil = t + 4;
    };

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
      const ramp = has('ramp').reduce((acc, f) => acc + f.ramp.cap, 0); // in-combat ramps assumed fully stacked
      amt *= 1 + ramp / 100;
      if (kind === 'ability') amt *= 1 + sum('abilityAmp') * (t < 8 ? 1 : 0);
      if (kind === 'ability' || kind === 'passive') amt *= 1 + sum('abilityRamp') * 4 * (ch.ranged ? 0.5 : 1); // Spear of Shojin, fully stacked (half for ranged)
      // Lord Dominik's Giant Slayer: up to +15% damage, full against 1500+ bonus health (the dummy has far more).
      if (hasAny('giantSlayer')) amt *= 1 + sum('giantSlayer') * Math.min(1, (DUMMY.hp - DUMMY.baseHp) / 1500);
      if (t <= mandateUntil) amt *= 1.07;  // Imperial Mandate: Vulnerable
      if (t <= horizonUntil) amt *= 1.10;  // Horizon Focus: Hypershot
      if (kind === 'attack' || kind === 'split') amt *= 1 + (ch.ranged ? sum('attackAmpRanged') : sum('attackAmpMelee'));
      if (type === 'magic') amt *= 1 + sum('magicAmp');
      if ((type === 'magic' || type === 'true') && hasAny('shadowflame') && dummyHp < 0.4 * DUMMY.hp) amt *= 1.2;

      if (type === 'physical') {
        const armor = armorAt(t);
        amt *= 100 / (100 + armor);
        if (hasAny('cleaver') && kind !== 'split') cleaverStacks = Math.min(5, cleaverStacks + 1);
      } else if (type === 'magic') {
        const mr = mrAt(t);
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
    const fireP = (t, spec, kind) => {
      // Debuffs ride on the effect: its own (spec.debuff) or its ability slot's (castDebuff, from a 'Q · ...' label).
      if (spec.debuff) addDebuff(t, spec.debuff, spec.label || 'passive');
      const sl = /^([QWER]) · /.exec(spec.label || ''); if (sl) castDebuff(t, sl[1]);
      return spec.dot ? addDot(t, spec, spec.dmg) : dealP(t, spec, spec.dmg, kind || spec.kind);
    };
    let pHits = 0, pAbilities = 0, pArmed = 0, pTimedArmed = false, pTimedReady = P && P.timedAuto ? (P.timedAuto.start || 0) : Infinity;
    let pAbilityReady = 0, pAfterReady = 0, pHitsReady = 0, pNReady = 0, pAutoNReady = 0, pStack = { n: 0, until: -1 };
    let pAuras = P && P.aura ? -1 : null;
    let pOnHits = 0;
    const phantomHit = t => { // a repeated on-hit (Guinsoo) adds on-hit stacks but isn't a new action
      pOnHits++;
      if (P.everyNHits && pOnHits % P.everyNHits.n === 0 && t >= pHitsReady) { fireP(t, P.everyNHits); pHitsReady = t + (P.everyNHits.cd || 0); }
    };
    const countHit = t => {
      pHits++; pOnHits++;
      if (P && P.aura && pHits >= (P.aura.hits || 1)) pAuras = t + (P.aura.linger || 4);
      if (P && P.everyNHits && pOnHits % P.everyNHits.n === 0 && t >= pHitsReady) {
        fireP(t, P.everyNHits); pHitsReady = t + (P.everyNHits.cd || 0);
      }
      if (P && P.stackDot) { pStack.n = Math.min(P.stackDot.max, pStack.n + 1); pStack.until = t + P.stackDot.dur; }
    };

    function record(t, amt, type, src) {
      if (markState && t <= markState.until && src !== markState.label) markState.sum += amt;
      total += amt; byType[type] += amt; bySource[src] = (bySource[src] || 0) + amt;
      dummyHp -= amt;
      const killed = dummyHp <= 0;
      if (killed) { kills++; if (firstKill === null) firstKill = t; dummyHp = DUMMY.hp; }
      hits.push({ t, amt, type, src, hp: dummyHp, killed });
    }

    // Spellblade: unique, take strongest owned.
    const sbList = has('spellblade').map(f => ({ ...f.spellblade, item: f.item }));
    const spellbladeValue = sb => (sb.flat || 0) + (sb.critFlat || 0) * st.crit + (sb.baseAd || 0) * st.baseAD + (sb.bonusAd || 0) * st.bonusAD + (sb.ap || 0) * st.ap;
    const spellblade = sbList.sort((x, y) => spellbladeValue(y) - spellbladeValue(x))[0];
    let sbReadyAt = 0, sbArmed = false;

    let burnUntil = { liandry: -1, blackfire: -1 }, lastBurnTick = -1, ludenReady = 0;
    let bastionItemReady = 0, malignanceUntil = -1, empoweredAutos = 0, sunderedReady = 0, sunderedShare = 0, autoCount = 0, zekeUntil = -1;
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
      // Horizon Focus Hypershot: ability damage from 600+ range (assumed for ranged champions) makes you deal 10% more
      // damage to the target for 6s, 30s cooldown.
      if (hasAny('horizon') && ch.ranged && !(cast && cast.noDamage) && t >= horizonReady) { horizonUntil = t + 6; horizonReady = t + 30; }
      if (hasAny('luden') && t >= ludenReady) { ludenReady = t + 12; deal(t, (75 + 0.05 * st.ap) * 2, 'magic', "Luden's Echo", 'item'); } // 1 bolt + 5 repeats at 20%
      eclipseHit(t);
      // Shaped Charge (game data): a damaging ability adds 40 + 150% lethality true damage (ranged 50%), 20s cooldown.
      if (hasAny('bastion') && !(cast && cast.noDamage) && t >= bastionItemReady && (bastionItemReady = t + 20)) deal(t, (40 + 1.5 * st.leth) * (ch.ranged ? 0.5 : 1), 'true', 'Bastionbreaker', 'item');
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

    let onHitCount = 0; const onHitCharges = new Map();
    const basicAttack = (t) => {
      autoCount++;
      const pN = P && P.everyN && autoCount % P.everyN.n === 0 && t >= pAutoNReady ? P.everyN : null;
      let mult = P && P.noCrit ? 1 : 1 + st.crit * (st.critMult - 1);
      let trueBonus = 0, fiendShare = 0;
      if (pN && pN.crit) mult = Math.max(st.critMult, pN.minCrit || 0); // e.g. Jhin's 4th shot always crits
      else if (hasAny('sundered') && t >= sunderedReady) { sunderedReady = t + 10; sunderedShare = 1 - mult / st.critMult; mult = st.critMult; }
      else if (empoweredAutos > 0) {
        // Fiendhunter Bolts Opening Barrage (game data): attacks that wouldn't crit crit for 75% of crit damage; ones that
        // would crit deal full crit damage plus 10% bonus true damage. Expected value over your crit chance:
        empoweredAutos--;
        const emp = (1 - st.crit) * (1 + 0.8 * (st.critMult - 1)) + st.crit * st.critMult;
        fiendShare = 1 - mult / emp; mult = emp; // the part above an average attack is shown as Fiendhunter Bolts
        trueBonus = st.crit * 0.15 * st.totalAD * st.critMult;
      }
      let autoDmg = st.totalAD * mult * pr.autoAmp;
      if (P && P.autoMult != null) autoDmg *= typeof P.autoMult === 'function' ? P.autoMult(pctx(t)) : P.autoMult;
      if (P && P.autoSplit) {
        for (const [ty, share] of Object.entries(P.autoSplit)) deal(t, autoDmg * share, ty, 'Basic Attacks', 'attack');
        autoDmg *= 1 - Object.values(P.autoSplit).reduce((a, b) => a + b, 0);
      }
      // Show Sundered Sky's guaranteed crit as its own line: the part above an average attack.
      if (sunderedShare > 0) { deal(t, autoDmg * sunderedShare, 'physical', 'Sundered Sky', 'split'); autoDmg *= 1 - sunderedShare; sunderedShare = 0; }
      if (fiendShare > 0) { deal(t, autoDmg * fiendShare, 'physical', 'Fiendhunter Bolts', 'split'); autoDmg *= 1 - fiendShare; }
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
      let empRaw = 0;
      if (empowered) {
        const e = empowered; empowered = null;
        if (e.shred) { shredPct = e.shred; shredUntil = t + (e.shredDur || 3); } // armor shred lands with the hit
        empRaw = (e.adRatio || 0) * st.totalAD + (e.bonusAdRatio || 0) * st.bonusAD + (e.apRatio || 0) * st.ap + (e.flat || 0);
        deal(t, empRaw, e.type, e.label, 'ability');
        if (t <= cloneUntil) deal(t, empRaw * cloneMult, e.type, e.label + ' (clone)', 'ability'); // the clone's next attack is empowered too
      }
      // Wukong's clone attacks alongside him at reduced damage. It's a separate attacker, so item on-hits aren't repeated.
      const cloneHit = t <= cloneUntil;
      if (cloneHit) deal(t, st.totalAD * (1 + st.crit * (st.critMult - 1)) * cloneMult, 'physical', 'W · Clone attacks', 'attack');
      // Abilities whose cooldown drops on every hit (Wukong Q: 0.5s per hit from him or the clone).
      for (const sp of castable || []) if (sp.mech && sp.mech.cdPerHit && ready[sp.slot] > t) ready[sp.slot] -= sp.mech.cdPerHit * (cloneHit ? 2 : 1);
      // Navori Flickerblade: attacks cut the remaining cooldown of Q, W and E by 15%.
      if (hasAny('navori')) for (const s of ['Q', 'W', 'E']) if (ready[s] > t && ready[s] !== Infinity) ready[s] = t + (ready[s] - t) * 0.85;
      let onHitTimes = 1 + pExtraOnHit;
      // Guinsoo's Rageblade (fully stacked): every 3rd attack applies on-hit effects twice, including on-hit
      // stacks like Vayne's Silver Bolts and Kai'Sa's plasma.
      const phantom = hasAny('guinsoo') && autoCount % 3 === 0 ? 1 : 0;
      onHitTimes += phantom;
      if (sbArmed) {
        sbArmed = false;
        const v = spellbladeValue(spellblade);
        deal(t, v, spellblade.type, spellblade.item, 'onhit');
        if (spellblade.doubleOnHit) onHitTimes++;
      }
      onHitEffects(t, onHitTimes);
      // Ability-empowered attacks whose bonus is on-hit (Udyr Q claws): repeated by Guinsoo / Dusk and Dawn.
      for (const [pe, left] of onHitCharges) {
        if (left <= 0) continue;
        onHitCharges.set(pe, left - 1);
        for (let k = 0; k < onHitTimes; k++) dealP(t, pe, pe.dmg, pe.kind || 'ability');
      }
      for (let k = 0; k <= phantom; k++) {
        onHitCount++;
        if (k > 0 && P) phantomHit(t);
        for (const sp of everyN) {
          const m = sp.mech;
          if (onHitCount % m.n !== 0) continue;
          const raw = Math.max(m.floor || 0, (m.pctTargetMaxHp || 0) * DUMMY.hp + (m.flat || 0));
          deal(t, raw, m.type, `${sp.slot} · ${labels[sp.slot] || sp.name}`, 'onhit');
        }
      }

      for (const f of has('everyN')) {
        const e = f.everyN;
        if (autoCount % e.n !== 0) continue;
        if (e.phys) deal(t, e.phys * (1 + (e.missingAmp || 0) * (1 - dummyHp / DUMMY.hp)) * (ch.ranged ? (e.rangedMult || 1) : 1), 'physical', f.item, 'onhit');
        if (e.magic) deal(t, e.magic, 'magic', f.item, 'onhit');
        if (e.onHit) onHitEffects(t, 1); // Statikk Shiv's lightning applies on-hit effects again
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
    const SPELL_MECHS = new Set(['cast', 'channel', 'hits', 'multi', 'execute', 'mark', 'clone']);
    let markState = null; // Zed-style mark: stores damage dealt until it pops
    const recastLeft = {}; // recasts still available per slot
    let channelUntil = -1; // a channel that keeps the champion from attacking or casting (Aurelion Sol Q)
    let cloneUntil = -1, cloneMult = 0; // Wukong's clone copies attacks and his R
    let tempAS = 0, tempASUntil = -1;    // attack speed from a cast (Wukong E)
    let shredPct = 0, shredUntil = -1;   // % armor removed by an ability (Wukong Q)
    const spellQueue = []; // scheduled ability hits/ticks: { at, raw(), type, label }
    // Expected share of a hit that gets through the dummy's resists right now (used to time executes).
    const mitigation = (type, t) => type === 'true' ? 1
      : type === 'magic' ? 100 / (100 + mrAt(t))
      : 100 / (100 + armorAt(t));
    let lastUltAt = null; const summons = []; let empLastHits = 0, fiendReady = 0, hexReady = 0, hexUntil = -1;
    const onUltimate = t => {
      lastUltAt = t;
      if (hasAny('malignance')) { malignanceUntil = t + 3; malignanceShred = 10; }
      if (hasAny('zeke')) zekeUntil = t + 5;
      if (hasAny('fiendhunter') && t >= fiendReady) { empoweredAutos = 3; fiendReady = t + 45; }
      if (hasAny('hexplate') && t >= hexReady) { hexUntil = t + 8; hexReady = t + 30; }
    };
    // Abilities flagged 'first' (e.g. Zed R) are cast before anything else.
    // and abilities flagged 'last' (channels like Aurelion Sol Q) after everything else.
    const castRank = s => s.mech && s.mech.first ? 0 : s.mech && s.mech.last ? 2 : 1;
    const castOrder = castable ? [...castable].sort((a, b) => castRank(a) - castRank(b)) : [];
    const tryCastRealSpell = (t) => {
      if (t < castLock || t < channelUntil) return;
      for (const sp of castOrder) {
        if ((ready[sp.slot] || 0) > t + 1e-9) continue;
        if (sp.mech && sp.mech.kind === 'empowerAuto') {
          if (empowered) continue; // don't waste it before the armed attack lands
          empowered = { ...sp.mech, label: `${sp.slot} · ${labels[sp.slot] || sp.name}` };
          onAbilityHit(t, false); castDebuff(t, sp.slot);
          ready[sp.slot] = t + cdOf(sp.slot, sp.cooldown);
          castLock = t + sp.castTime;
          if (sp.mech.resetsAttack) nextAuto = Math.min(nextAuto, castLock);
          return;
        }
        if (sp.mech && SPELL_MECHS.has(sp.mech.kind)) {
          const m = sp.mech, label = `${sp.slot} · ${labels[sp.slot] || sp.name}`;
          const ev = name => { const v = root.Potenshall.Abilities.evalCalc(name, sp.sp, { ...spellCtx(), rank: sp.rank }); return Number.isFinite(v) && v > 0 ? Math.min(v, 6000) : 0; };
          let first = 0;
          let resetNow = false;
          if (m.kind === 'clone') { cloneUntil = t + (m.duration || 4); cloneMult = m.mult || 0.5; }
          else if (m.kind === 'mark') {
            const base = root.Potenshall.Abilities.evalCalc(sp.calc, sp.sp, { ...spellCtx(), rank: sp.rank });
            markState = { until: t + (m.duration || 3), sum: 0, base: Number.isFinite(base) ? base : 0, pct: m.pct || 0, type: m.type, label };
          } else if (m.kind === 'execute') {
            // Held until it executes or kills (a real player waits for the moment), fired anyway at 'latest'.
            const evx = c => root.Potenshall.Abilities.evalCalc(c, sp.sp, { ...spellCtx(), rank: sp.rank });
            const miss = DUMMY.hp - dummyHp;
            const thrHp = m.thresholdCalc ? evx(m.thresholdCalc) : m.threshold ? (m.threshold > 1 ? m.threshold / 100 : m.threshold) * DUMMY.hp : 0;
            let raw = m.flat != null ? m.flat * (m.flatMult || 1) : evx(m.calc || sp.calc);
            if (m.missAmp) raw *= 1 + m.missAmp.max * Math.min(1, miss / DUMMY.hp / (m.missAmp.at || 1));
            if (m.missPct) raw += m.missPct * miss;
            if (m.aboveMult && dummyHp > thrHp) raw *= m.aboveMult;
            raw = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 6000) : 0;
            const est = raw * mitigation(m.type, t);
            const go = m.noHold || t >= (m.latest ?? 0) || (thrHp > 0 && dummyHp - est < thrHp) || (m.holdKill && est >= dummyHp);
            if (!go) continue;
            const killsBefore = kills;
            first = deal(t, raw, m.type, label, 'ability');
            if (thrHp > 0 && dummyHp > 0 && dummyHp < thrHp) record(t, dummyHp, 'true', label.replace(/ · .*/, ' · Execute'));
            resetNow = !!m.resetOnKill && kills > killsBefore;
          } else if (m.kind === 'cast') first = deal(t, ev(m.calc) * (m.pctOfMissing ? DUMMY.hp - dummyHp : m.pctOfMax ? DUMMY.hp : 1), m.type, label, 'ability');
          // Temporary attack speed from a cast (Wukong E); game data stores 60% as 0.6.
          if (m.asBonus) { tempAS = m.asBonus < 5 ? m.asBonus * 100 : m.asBonus; tempASUntil = t + (m.asDur || 5); }
          else if (m.kind === 'multi') for (const p of m.parts) // a part is a formula, a flat data value, or a share of max HP
            first += deal(t, (p.calc ? ev(p.calc) * (p.pctOfMax ? DUMMY.hp : 1) : 0) + (p.flat || 0), p.type, label, 'ability');
          else if (m.kind === 'hits') {
            for (let i = 0; i < m.n; i++) spellQueue.push({ at: t + (m.n > 1 ? i * m.over / (m.n - 1) : 0), label, type: m.type,
              raw: () => { const b = ev(m.calc); return m.critCalc ? b + st.crit * (ev(m.critCalc) - b) : b; } });
          } else if (m.kind === 'channel') {
            const dur = Math.min(m.duration || 99, T);
            // Zones that execute (Aurelion Sol E): threshold in % of max HP, checked on every tick.
            const exec = m.executeCalc ? () => { const v = ev(m.executeCalc); return v > 1 ? v / 100 : v; } : null;
            for (let k = 0.5; k <= dur + 1e-9; k += 0.5) spellQueue.push({ at: t + k, label, type: m.type, exec, clone: !!m.cloneEcho,
              raw: () => ((m.empCalc && k > m.empAfter ? ev(m.empCalc) : ev(m.perSec)) + (m.perSecPctMaxHp || 0) * DUMMY.hp) / 2 });
            // Repeating bursts while channeling (Aurelion Sol Q: every 1s, magic + % max HP true per stack).
            if (m.burstEvery) for (let k = m.burstEvery; k <= dur + 1e-9; k += m.burstEvery) for (const p of m.bursts)
              spellQueue.push({ at: t + k, label, type: p.type, raw: () => ev(p.calc) * (p.pctMaxHp ? DUMMY.hp : 1) });
            if (m.blocksAttacks) channelUntil = t + dur;
          }
          onAbilityHit(t, t >= bastionReady, { raw: first, type: m.type, label, noDamage: m.kind === 'clone' });
          if (t >= bastionReady) bastionReady = t + 3;
          // Recastable abilities (Ahri R): each recast is its own cast; the cooldown starts after the last one.
          const opening = !m.recasts || !(recastLeft[sp.slot] > 0);
          if (m.recasts) recastLeft[sp.slot] = (opening ? m.recasts : recastLeft[sp.slot]) - 1;
          if (sp.slot === 'R' && opening) onUltimate(t);
          if (opening) castDebuff(t, sp.slot);
          ready[sp.slot] = m.once ? Infinity : resetNow ? t + 1 : m.recasts && recastLeft[sp.slot] > 0 ? t + (m.recastGap || 1)
            : t + cdOf(sp.slot, sp.cooldown);
          castLock = t + sp.castTime;
          return;
        }
        if (!sp.damaging) continue;
        let dmg = root.Potenshall.Abilities.evalSpellDamage(sp, spellCtx());
        // Empowered ability after N actions (Pantheon's Mortal Will).
        let empTag = '';
        if (P && P.empowerAfter && sp.slot === P.empowerAfter.slot && pHits - empLastHits >= P.empowerAfter.actions) { dmg *= P.empowerAfter.mult; empLastHits = pHits; empTag = ' (empowered)'; }
        const label = `${sp.slot} · ${sp.lastVariant || labels[sp.slot] || sp.name}${empTag}`;
        deal(t, dmg, sp.type, label, 'ability');
        // Shadows (Zed): every active shadow repeats this ability on the target with its own formula.
        if (P && P.shadows && sp.slot === P.shadows.slot) {
          const sh = P.shadows, cdW = (sh.w.every || 16) * 100 / (100 + st.ah);
          const n = (t >= sh.w.start && (t - sh.w.start) % cdW <= sh.w.dur ? 1 : 0) + (lastUltAt !== null && t - lastUltAt <= sh.rDur ? 1 : 0);
          const per = root.Potenshall.Abilities.evalCalc(sh.calc, sp.sp, { ...spellCtx(), rank: sp.rank });
          if (n && per > 0) deal(t, n * Math.min(per, 6000), sp.type, `${sp.slot} · Shadow shurikens`, 'ability');
        }
        // Summons (Zyra plants): some abilities grow plants that attack for a while.
        if (P && P.summon && P.summon.from[sp.slot]) for (let i = 0; i < P.summon.from[sp.slot]; i++) summons.push(t + P.summon.dur);
        onAbilityHit(t, t >= bastionReady, { raw: dmg, type: sp.type, label });
        // Abilities that apply on-hit effects (Ezreal Q, Gangplank Q, Irelia Q...); some also trigger Spellblade right away.
        const ohA = P && P.onHitAbility && P.onHitAbility[sp.slot];
        if (ohA) {
          if (ohA.spellblade && sbArmed) { sbArmed = false; deal(t, spellbladeValue(spellblade), spellblade.type, spellblade.item, 'onhit'); }
          onHitEffects(t, 1);
        }
        if (t >= bastionReady) bastionReady = t + 3;
        if (sp.slot === 'R') onUltimate(t);
        castDebuff(t, sp.slot);
        ready[sp.slot] = t + cdOf(sp.slot, sp.cooldown);
        castLock = t + sp.castTime;
        return;
      }
    };

    // Event schedule
    // Temporary bonus attack speed, scaled by the champion's AS ratio: Warwick W below 50% HP, Experimental Hexplate's
    // Overdrive, Fiendhunter Bolts' empowered attacks.
    const lowHp = P && P.lowHpAS;
    const asRatioNow = (kit && kit.asRatio) ?? ch.stats.attackspeed;
    const gapAt = t => {
      let bonus = 0;
      if (lowHp && dummyHp < lowHp.below * DUMMY.hp) bonus += lowHp.as;
      if (t <= hexUntil) bonus += ch.ranged ? 25 : 50;
      if (t <= tempASUntil) bonus += tempAS;
      if (empoweredAutos > 0) bonus += 50;
      const as = P && P.fixedAS ? st.as : Math.min(2.5, st.as + asRatioNow * bonus / 100);
      return 1 / (as * pr.uptime);
    };
    let nextAuto = 0.1, nextCombo = 0, comboQueue = [], ultDone = false, nextDespair = 0;
    // periodic may be one timer or a list (e.g. a passive plus an ability modeled as a timer). No 'every' = fires once.
    const pPeriodics = P ? [].concat(P.periodic || []).map(pe => ({ pe, at: pe.start || 0 })) : [];
    let pTimedOnceDone = false;
    if (hasAny('rocketbelt')) deal(0, 135 + 0.15 * st.ap, 'magic', 'Hextech Rocketbelt', 'item');
    const actives = has('active').map(f => ({ ...f.active, item: f.item, at: f.active.delay || 0 }));
    if (spells || (P && P.ownKit)) nextCombo = Infinity;
    // Ultimates that are pure buffs or utility are never 'cast' for damage; they're used at the start of the fight,
    // so post-ultimate item effects (Fiendhunter Bolts, Malignance, Zeke's) still trigger.
    const ultCast = castOrder.some(s => s.slot === 'R' && (s.damaging || (s.mech && SPELL_MECHS.has(s.mech.kind))));
    // Recast whenever the ultimate comes off cooldown (ultimate haste from items included).
    const rSpell = spells ? spells.find(s => s.slot === 'R') : null;
    let ultBuffAt = !!spells && !(P && P.ownKit) && !ultCast ? 0.1 : Infinity;

    // Utility abilities whose only damage effect is a debuff (Karthus W wall, Mordekaiser R): used on cooldown.
    const autoDebuffs = P && P.castDebuff ? Object.entries(P.castDebuff).filter(([, d]) => d.auto)
      .map(([slot, d]) => ({ slot, d, at: d.start ?? 0.1, cd: ((spells || []).find(s => s.slot === slot) || {}).cooldown || Infinity })) : [];
    for (let t = 0; t < T - 1e-9; t = +(t + DT).toFixed(4)) {
      // Actualizer: while empowered (first 8s), basic ability cooldowns progress 30% faster.
      if (hasAny('actualizer') && t < 8) for (const s of ['Q', 'W', 'E']) if (ready[s] > t && ready[s] !== Infinity) ready[s] -= 0.3 * DT;
      for (const a of autoDebuffs) if (t >= a.at) {
        addDebuff(t, a.d, a.slot);
        a.at = t + cdOf(a.slot, a.cd);
      }
      if (markState && t >= markState.until) { const mk = markState; markState = null; deal(t, mk.base + mk.pct * mk.sum, mk.type, mk.label, 'ability'); }
      if (t >= ultBuffAt) {
        onUltimate(t);
        ultBuffAt = rSpell && rSpell.cooldown > 0 ? t + cdOf('R', rSpell.cooldown) : Infinity;
      }
      if (spells) tryCastRealSpell(t);
      // Channels and multi-hit abilities: each tick is real ability damage (item amps apply, burns stay lit).
      for (let i = spellQueue.length - 1; i >= 0; i--) {
        const q = spellQueue[i];
        if (q.at > t + 1e-9) continue;
        spellQueue.splice(i, 1);
        const qv = q.raw();
        deal(t, qv, q.type, q.label, 'ability');
        if (q.clone && t <= cloneUntil) deal(t, qv * cloneMult, q.type, 'W · Clone (mimics R)', 'ability'); // Wukong's clone copies his R
        if (q.exec) { const thr = q.exec(); if (dummyHp > 0 && dummyHp < thr * DUMMY.hp) record(t, dummyHp, 'true', q.label.replace(/ · .*/, ' · Execute')); }
        for (const f of has('burn')) burnUntil[f.burn] = t + 3;
      }
      if (spells && t < castLock && t >= nextAuto) nextAuto = castLock; // can't attack mid-cast
      if (t < channelUntil && t >= nextAuto) nextAuto = channelUntil;  // or while channeling
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
        if (!ta.cond || ta.cond(pctx(t))) {
          pTimedArmed = true; pTimedOnceDone = true;
          // Ability-based empowered attacks: cooldown shrinks with haste, and an attack reset fires it right away.
          pTimedReady = t + (ta.every || Infinity) * (ta.kind === 'ability' ? 100 / (100 + st.ah) : 1);
          if (ta.resetsAttack) nextAuto = Math.min(nextAuto, t + 0.1);
        }
      }
      for (const x of pPeriodics) {
        if (t < x.at) continue;
        x.at = t + (x.pe.every || Infinity) * (x.pe.ability ? 100 / (100 + st.ah) : 1); // ability cooldowns shrink with haste
        if (!x.pe.cond || x.pe.cond(pctx(t))) {
          if (x.pe.charges) { onHitCharges.set(x.pe, x.pe.charges); nextAuto = Math.min(nextAuto, t + 0.1); } // empowers the next attacks
          else fireP(t, x.pe);
          if (x.pe.ability) { onAbilityHit(t, true, x.pe.noDamage ? { noDamage: true } : null); if (x.pe.ult) onUltimate(t); }
        }
      }
      if (t >= nextAuto) {
        basicAttack(t);
        let gap = gapAt(t);
        if (P && P.magazine && autoCount % P.magazine.size === 0) {
          const rl = typeof P.magazine.reload === 'function' ? P.magazine.reload(pctx(t)) : P.magazine.reload;
          gap = Math.max(gap, rl);
        }
        nextAuto = t + gap;
      }
      // Half-second damage-over-time ticks
      if (Math.floor(t * 2) !== lastBurnTick) {
        lastBurnTick = Math.floor(t * 2);
        if (P && P.summon) {
          for (let i = summons.length - 1; i >= 0; i--) if (t > summons[i]) summons.splice(i, 1);
          // Extra summons on the same target deal reduced damage (Zyra: plants after the first deal 50%).
          const eff = summons.length ? 1 + (summons.length - 1) * (P.summon.extraMult ?? 1) : 0;
          if (eff) dealP(t, P.summon, c => eff * P.summon.dmg(c) / 2, 'ability', P.summon.label);
        }
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
      profile: pr, realKit: !!spells || !!(P && P.ownKit), passive: P ? { name: P.name, note: P.note || '' } : null,
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
      if (it.boots) return false; // everyone buys boots
      const f = itemFlavor(it);
      if (f === 'tank') return !isTank;
      return f !== natural;
    }).length;
  }

  // ---------- Draft (shared by the game and the leaderboard server) ----------
  // Every offer comes from a seeded RNG, so a draft can be replayed exactly from its seed and
  // its action log ('r' = reroll, a number = pick that offer). The server uses this to verify
  // leaderboard submissions.
  const DRAFT = { CHAMP_CHOICES: 5, ITEM_CHOICES: 6, ITEM_SLOTS: 6, REROLLS: 3 };
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
    // Unique item groups (itemgroups.js, from the game files): once a group is full, e.g. one Last Whisper item or one
    // pair of boots, the other items in it are no longer offered.
    const itemOffers = (extra = []) => {
      const groups = root.Potenshall.ItemGroups || {}, owned = {};
      for (const it of d.items) for (const [g] of groups[it.id] || []) owned[g] = (owned[g] || 0) + 1;
      const allowed = data.items.filter(it => !(groups[it.id] || []).some(([g, max]) => (owned[g] || 0) >= max));
      return sample(rng, allowed, DRAFT.ITEM_CHOICES, new Set([...extra, ...d.items.map(i => i.id)]));
    };
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
