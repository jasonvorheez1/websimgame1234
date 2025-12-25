export default {
  id: "23",
  export_id: 23,
  name: "Jesse Pinkman",
  role: "Support",
  franchise: "Breaking Bad",
  imageUrl: "https://api.websim.com/blobs/019b44bb-8845-723b-8f7f-33dc2caaa98f.webp",
  rarity: 4,
  stats: {
    hp: 601,
    maxHp: 737,
    atk: 27,
    def: 28,
    magicAtk: 48,
    magicDef: 45,
    speed: 31,
    luck: 19,
    evasion: 13,
    tenacity: 16
  },
  level: 1,
  stars: 1,
  quality: 1,
  playstyle: "Jesse is a volatile support who buffs allies and applies chemistry-driven debuffs and DoTs to control fights.",
  suggestedTier: "D-",
  appearanceTags: ["Shaved Head", "Hoodie", "Cook Outfit", "Scars", "Meth lab gear"],
  abilities: [
    {
      name: "Bitch! Incendiary Round",
      type: "Active",
      tags: ["atk","fire","single target","debuff","ranged","bugfix","buff"],
      description: "Jesse fires a modified round dealing 1.1 * ATK physical damage plus 50% ATK fire damage to the first enemy hit and applies 'Cooked' for 3s which increases damage taken from Jesse by 10%.",
      cooldown: 6,
      travelTime: 300,
      mechanics: { projectile: true, targets: "single" },
      baseDmg: 0,
      scalePct: 1.1,
      scaleStat: "atk",
      statuses: [
        { type: "debuff_vulnerability", name: "Cooked", duration: 3, value: 0.10, applyTo: "target" }
      ]
    },
    {
      name: "Yo, Science! Methylamine Catalyst",
      type: "Active",
      tags: ["buff","slow","aoe","utility","magic atk","chemistry","status","shield","bugfix","nerf"],
      description: "Throws a vial creating a cloud for 5s: allies inside gain +10% move speed and +10% ATK for 3s; enemies inside are slowed 15% and take 30 magic ATK DPS. Effects change based on Chemistry stacks.",
      cooldown: 18,
      channelDuration: 0,
      typeCategory: "active",
      targeting: "area",
      areaRadius: 160,
      duration: 5,
      statuses: [
        { type: "buff_speed", name: "Catalyst Speed", duration: 3, value: 0.10, applyTo: "all_allies_in_area" },
        { type: "buff_atk", name: "Catalyst ATK", duration: 3, value: 0.10, applyTo: "all_allies_in_area" },
        { type: "debuff_speed", name: "Catalyst Slow", duration: 3, value: 0.15, applyTo: "all_enemies_in_area" },
        { type: "dot_magic", name: "Catalyst Burn", duration: 5, value: 30, applyTo: "all_enemies_in_area" }
      ],
      extra: {
        chemistrySynergy: {
          stacksRequired: 3,
          alliesShieldPct: 0.10,
          enemyMagicResReduce: 0.10,
          altEffectIfNegative: { defReducePct: 0.10 }
        }
      }
    },
    {
      name: "Blue Sky Blitz",
      type: "Active",
      tags: ["single target","damage","magic atk","debuff","burn","chemistry","fire","status","heal","nerf"],
      description: "Hurls blue crystals at a single enemy dealing 60 magic ATK on hit and applies 'Blue Sky Burn' for 4s dealing 20 magic ATK DPS and reducing incoming healing by 20%. Modified by Chemistry stacks.",
      cooldown: 12,
      channelDuration: 0,
      typeCategory: "active",
      targeting: "single",
      baseDmg: 60,
      scalePct: 0.0,
      scaleStat: "magicAtk",
      statuses: [
        { type: "burn", name: "Blue Sky Burn", duration: 4, value: 20 },
        { type: "debuff_healing_received", name: "Reduced Healing", duration: 4, value: 0.20, applyTo: "target" }
      ],
      extra: {
        chemistry: {
          positive: { addAllSourceDamageTakenPct: 0.10 },
          negative: { initialBurstMultiplier: 0.5, burnBecomesHealPct: 0.01 }
        }
      }
    },
    {
      name: "Wire! - Rock Bottom",
      type: "Passive",
      tags: ["passive","tenacity","evasion","utility","reaction","chemistry","science","status","buff"],
      description: "Grants +10 Tenacity and +5 Evasion. When receiving a negative status, gains 1 Chemistry stack and reduces that effect's duration by 10% (internal 5s ICD).",
      typeCategory: "passive",
      cooldown: 0,
      statuses: [
        { type: "stat_flat", name: "Wire Ten/Eva", duration: Infinity, modifiers: { tenacity: 10, evasion: 5 } }
      ],
      mechanics: {
        chemistryOnDebuff: 1,
        debuffDurationReductionPct: 0.10,
        internalCooldown: 5
      }
    },
    {
      name: "Yeah, Bitch! Chemical Firestorm",
      type: "Ultimate",
      tags: ["ultimate","aoe","damage","buff","chemistry","magic","burn","speed","controller"],
      description: "After 1s arming, erupts in a 5m radius dealing 250 magic damage scaling with Chemistry; with positive Chemistry deals up to +50% bonus, with negative Chemistry applies 50 DPS burn for 3s. Grants allies in radius +15% move and attack speed for 6s.",
      cooldown: 60,
      channelDuration: 1.0,
      typeCategory: "ultimate",
      targeting: "self",
      areaRadius: 200,
      baseDmg: 250,
      scalePct: 0.0,
      scaleStat: "chemistry",
      statuses: [
        { type: "buff_speed", name: "Adrenaline", duration: 6, value: 0.15, applyTo: "all_allies_in_area" },
        { type: "buff_atk_speed", name: "Adrenaline Attack", duration: 6, value: 0.15, applyTo: "all_allies_in_area" }
      ],
      extra: {
        chemistryScaling: {
          maxBonusPct: 0.50,
          perStackBonus: 0.125
        },
        negativeChemistry: { dotPerSec: 50, dotDuration: 3, dotUnmodified: true }
      }
    },
    {
      name: "Bitch! - Crystal Clarity",
      type: "Signature Passive",
      tags: ["signature passive","intuition","scaling","utility","random","buff"],
      description: "Every 15s Jesse is presented a 'reading' (Hot/Cold/Neutral). Correct prediction grants +1 Clarity stack, incorrect -1; stacks range -5..5 and modify tenacity/evasion and other bonuses.",
      typeCategory: "passive",
      cooldown: 0,
      statuses: [],
      mechanics: {
        clarityInterval: 15,
        maxStacks: 5,
        stackEffects: { tenacityPerStackPct: 0.01, evasionPerStackPct: 0.005 },
        negativeStackEffects: { cooldownReductionPctAtMin: 0.10 }
      }
    }
  ],
  flavor: "\"Yeah, bitch! Science.\"",
  notes: "Jesse Pinkman (23.js) - chemistry-driven support with mixed AoE buffs, DoTs and stateful mechanics (Chemistry/Clarity stacks) for synergy and disruption."
}