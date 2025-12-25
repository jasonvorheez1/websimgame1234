export default {
  id: "22",
  name: "Itachi Uchiha",
  role: "Assassin",
  franchise: "Naruto",
  imageUrl: "https://api.websim.com/blobs/019b44bb-59bd-70ba-8642-205d1281f521.webp",
  rarity: 5,
  stats: {
    hp: 291,
    maxHp: 291,
    atk: 8,
    def: 11,
    magicAtk: 7,
    magicDef: 10,
    speed: 12,
    luck: 6,
    evasion: 5,
    tenacity: 6
  },
  level: 1,
  stars: 1,
  quality: 1,
  abilities: [
    {
      name: "Rapid Bind",
      type: "Active",
      tags: ["earth","burst","atk","single target","assassin"],
      description: "Rapid Bind — a short-range heavy-impact earth strike that deals a single, high-impact hit scaling primarily with ATK and secondarily with Luck; best used as a finisher after gap-closes. Applies minor earth interaction.",
      cooldown: 6,
      baseDmg: 28,
      scalePct: 1.0,
      scaleStat: "atk",
      mechanics: {
        typeCategory: "active",
        multiHitCount: 1,
        executeOnLowHp: true
      },
      extra: {
        levelEffects: {
          10: { baseDmgBonus: 6, cooldownReduction: 0.5 },
          50: { applySlowOnHit: true, slowPct: 0.12, slowDuration: 2 },
          100: { teamSupportOnKill: { healPct: 0.04 } }
        }
      }
    },
    {
      name: "Crow Clone Technique: Deception",
      type: "Active",
      tags: ["mobility","magic atk","status","assassin","dark","untargetable"],
      description: "Itachi disperses into crows, becoming untargetable for 1.75s while moving to a target location; upon reforming his next basic attack within 4s deals bonus magic damage and applies reduced healing received (30%) for 3s and grants 1 Mangekyō Resonance stack.",
      cooldown: 12,
      channelDuration: 0,
      travelTime: 1750,
      typeCategory: "active",
      targeting: "self",
      baseDmg: 0,
      isTeleport: true,
      statuses: [
        { type: "stealth", name: "Untargetable Crow Form", duration: 1.75, value: 1, applyTo: "self" },
        { type: "debuff_healing_received", name: "Reduced Healing Received", duration: 3, value: 0.30, applyTo: "target_on_reform" }
      ],
      extra: {
        grantsResonance: 1,
        onReform: {
          nextBasicBonusMagic: { base: 18, scalePct: 0.6, scaleStat: "magicAtk", window: 4 }
        },
        levelEffects: {
          25: { untargetableDuration: 2.25 },
          75: { increaseReducedHealingTo: 0.50 },
          125: { grantsResonanceStacks: 2 },
          175: { nextBasicAlsoSilences: true }
        }
      }
    },
    {
      name: "Tsukuyomi",
      type: "Skill",
      tags: ["single target","stun","magic resist debuff","control","assassin","status"],
      description: "Focuses Mangekyō Sharingan to stun a single enemy for 1s and reduce their Magic Resistance by 15% for 4s; consumes Mangekyō Resonance stacks — consuming 3 stacks increases stun to 2s and adds Silence for the duration.",
      cooldown: 10,
      channelDuration: 0,
      typeCategory: "active",
      targeting: "single",
      areaRadius: 0,
      baseDmg: 0,
      statuses: [
        { type: "stun", name: "Tsukuyomi Stun", duration: 1.0 },
        { type: "debuff_magicRes", name: "Magic Resistance Reduced", duration: 4.0, value: 0.15 }
      ],
      mechanics: {
        consumesResonance: true,
        resonanceConsumeThreshold: 3,
        enhancedOnFullConsume: { extraStunDuration: 1.0, addSilence: true }
      },
      extra: {
        levelEffects: {
          40: { magicResReduction: 0.20 },
          90: { baseStunDuration: 1.25 },
          140: { grantResonanceOnCast: 1 },
          190: { cooldownReduction: 2 }
        }
      }
    },
    {
      name: "Eternal Mangekyō: Clarity of Purpose",
      type: "Passive",
      tags: ["signature passive","magic atk","speed","resonance","buff"],
      description: "Itachi gains Magic Attack and Speed; each ability use grants a Mangekyō Resonance stack (max 3). Basic attacks consume 1 stack to deal bonus magic damage. Provides fixed tenacity and evasion buffs.",
      typeCategory: "passive",
      cooldown: 0,
      statuses: [
        { type: "stat_flat", name: "Signature Tenacity/Evasion", duration: Infinity, modifiers: { tenacity: 12, evasion: 10 } }
      ],
      mechanics: {
        resonance: { maxStacks: 3, perAbilityGain: 1, basicConsume: 1, basicBonusMagicBase: 12, basicBonusMagicScalePct: 0.5 }
      },
      extra: {
        levelEffects: {
          30: { magicAtkBonus: 12, speedBonus: 8 },
          80: { basicConsumeAddsDebuff: { reduceHealingPerStackPct: 0.10, maxStacks: 3 } },
          130: { maxResonanceStacks: 4 },
          180: { fullStackCooldownReductionPct: 0.15 }
        }
      }
    },
    {
      name: "Susanoo: Spirit of Vengeance",
      type: "Ultimate",
      tags: ["shield","magic atk","aoe","buff","assassin","burst"],
      description: "Summons Susanoo for 12s granting a large shield to Itachi and increasing Magic Attack; while active abilities are enhanced (Crow Clone makes two clones and Amaterasu gains area effect). Long cooldown.",
      cooldown: 80,
      channelDuration: 0,
      typeCategory: "ultimate",
      targeting: "self",
      baseDmg: 0,
      isShield: true,
      shield: {
        scaleStat: "magicAtk",
        shieldMultiplier: 3.0,
        capPctOfMaxHp: 0.40,
        duration: 12
      },
      statuses: [
        { type: "buff_magicAtk", name: "Susanoo Magic Attack Bonus", duration: 12, value: 0.30, applyTo: "self" },
        { type: "buff_susanoo", name: "Susanoo Active", duration: 12, value: 1, applyTo: "self" }
      ],
      mechanics: {
        enhanceAbilitiesWhileActive: true,
        crowCloneCreatesTwo: true,
        amaterasuAoEOnActive: true
      },
      extra: {
        levelEffects: {
          150: { duration: 15 },
          200: { crowdControlImmunity: true }
        }
      }
    },
    {
      name: "Amaterasu: Flames of Eternal Anguish",
      type: "Signature Passive",
      tags: ["burn","magic atk","dot","single target","assassin"],
      description: "Ignites target with black flames for 5s, dealing magic DoT each second; deals increased damage if target has Tsukuyomi and grants 1 Mangekyō Resonance on landing.",
      cooldown: 0,
      typeCategory: "passive",
      statuses: [
        { type: "burn", name: "Amaterasu Burn", duration: 5.0, value: 12 } // value interpreted as damage per second base
      ],
      mechanics: {
        dotTicksPerSecond: 1,
        synergyWithTsukuyomi: { extraDmgPct: 0.25 },
        grantsResonanceOnLand: 1
      },
      extra: {
        levelEffects: {
          110: { burnDuration: 6 },
          160: { reduceTargetMagicResOnBurn: 0.10 },
          200: { aoeOnFullResonance: true }
        }
      }
    }
  ],
  playstyle: "Itachi excels at quickly eliminating high-priority targets through Genjutsu and Mangekyō Sharingan play—managing Resonance stacks for burst and control.",
  flavor: "\"Those who turn their hands against their comrades are sure to die alone.\"",
  suggestedTier: "A-",
  appearanceTags: ["Akatsuki Cloak", "Mangekyō Sharingan", "Konoha Headband (slashed)"],
  export_id: 22,
  notes: "Engine-friendly Itachi Uchiha implementation: includes Resonance stack mechanics, untargetable mobility, Tsukuyomi control-consume behavior, Susanoo shield/amp, and Amaterasu DoT synergy; parsed-friendly fields provided for ability parser and BattleSystem integration."
}