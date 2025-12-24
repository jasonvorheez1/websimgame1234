/**
 * Custom ability module for character 134 (Katniss / "Mockingjay" set).
 *
 * Exports:
 *  - decideAction(actor, enemies, allies, battle): returns { ability, targets, type }
 *  - getParsedAbility(ability, actor, battle): returns a parsed ability object used by BattleSystem
 *  - executeAction(battle, actor, decision, parsed): performs the ability including visuals/effects
 *  - updatePassives(actor, dt): optional per-tick passive updates
 *
 * This module intentionally merges with BattleSystem's parsing results; it focuses on behavior matching
 * the textual ability descriptions (multi-hit volley, heals, regen buff, ultimate applying stacking crippled).
 */

const NAMES = {
  BASIC: "Basic Attack",
  VOLLEY: "Hunter's Volley",
  MOCKINGJAY_ARROW: "Mockingjay's Arrow",
  RESURGENCE: "Mockingjay's Resurgence",
  ULTIMATE: "Crippling Shot",
  PASSIVE: "District 12 Grit"
};

// Helper: pick primary target by priority
function pickPrimary(pool, priority, self) {
  if (!pool || pool.length === 0) return null;
  if (priority === 'weakest') return pool.slice().sort((a,b) => (a.currentHp/a.maxHp) - (b.currentHp/b.maxHp))[0];
  if (priority === 'strongest') return pool.slice().sort((a,b) => b.pwr - a.pwr)[0];
  if (priority === 'closest') return pool.slice().sort((a,b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y))[0];
  return pool[0];
}

// Exposed AI decision: simple priority ordering with energy/health checks
export async function decideAction(actor, enemies, allies, battle) {
  const liveEnemies = enemies.filter(e => !e.isDead && !e.isStealthed);
  const liveAllies = allies.filter(a => !a.isDead);

  // Ultimate if energy full
  const ult = actor.data.abilities.find(a => a.name === NAMES.ULTIMATE);
  if (actor.energy >= actor.maxEnergy && ult) {
    const target = pickPrimary(liveEnemies, 'weakest', actor) || liveEnemies[0];
    if (target) return { ability: ult, targets: [target], type: 'ultimate' };
  }

  // If an ally is very low, prefer Resurgence (heavier heal) if available and not on cooldown
  const res = actor.data.abilities.find(a => a.name === NAMES.RESURGENCE);
  const injured = liveAllies.filter(a => (a.currentHp / a.maxHp) < 0.5);
  if (injured.length > 0 && res && !actor.cooldownTimers[res.name]) {
    // target most injured ally
    const allyTarget = injured.sort((a,b) => (a.currentHp/a.maxHp) - (b.currentHp/b.maxHp))[0];
    return { ability: res, targets: [allyTarget], type: 'skill' };
  }

  // If primary enemy exists, prefer volley if ready (multi-hit)
  const volley = actor.data.abilities.find(a => a.name === NAMES.VOLLEY);
  if (volley && !actor.cooldownTimers[volley.name]) {
    const enemyTarget = pickPrimary(liveEnemies, 'weakest', actor);
    if (enemyTarget) return { ability: volley, targets: [enemyTarget], type: 'skill' };
  }

  // Supportive Mockingjay's Arrow: single-target damage + heal to most injured ally
  const mj = actor.data.abilities.find(a => a.name === NAMES.MOCKINGJAY_ARROW);
  if (mj && !actor.cooldownTimers[mj.name]) {
    const enemyTarget = pickPrimary(liveEnemies, 'weakest', actor);
    const healTarget = pickPrimary(liveAllies, 'weakest', actor);
    return { ability: mj, targets: [enemyTarget, healTarget], type: 'skill' };
  }

  // Default: basic attack
  const basic = actor.data.abilities.find(a => a.name === NAMES.BASIC) || { name: NAMES.BASIC, type: 'Active', description: 'Melee basic attack' };
  const target = pickPrimary(liveEnemies, 'closest', actor);
  return { ability: basic, targets: target ? [target] : [], type: 'basic' };
}

// Provide a parsed ability descriptor so BattleSystem can get cooldowns/effects if it asks
export function getParsedAbility(ability, actor, battle) {
  const name = (ability && ability.name) || String(ability);
  const lower = name.toLowerCase();

  if (name === NAMES.VOLLEY) {
    return {
      baseDmg: 48,
      scalePct: 0.0, // we'll compute with ATK below in executeAction
      scaleStat: 'atk',
      multiHitCount: 3,
      element: 'physical',
      statuses: [
        { type: 'bleed', duration: 3, value: 0.05, name: 'Bleed', applyOnLastHitOnly: false }
      ],
      targeting: 'single',
      typeCategory: 'active',
      cooldown: 6,
      visualKeyword: 'arrow',
      mechanics: { isBurst: false, isPierce: false }
    };
  }

  if (name === NAMES.MOCKINGJAY_ARROW) {
    return {
      baseDmg: 0,
      scalePct: 1.10, // 110% ATK as damage
      scaleStat: 'atk',
      element: 'physical',
      statuses: [],
      isHeal: false,
      cooldown: 6,
      typeCategory: 'active',
      visualKeyword: 'arrow'
    };
  }

  if (name === NAMES.RESURGENCE) {
    return {
      baseDmg: 75, // additional flat heal (applied as 75)
      scalePct: 1.6, // 160% ATK initial heal
      scaleStat: 'atk',
      isHeal: true,
      cooldown: 18,
      statuses: [
        { type: 'regen', percent: 0.06, duration: 4, name: 'Resurgence Regen' }
      ],
      buffOnTarget: { critChance: 0.20, duration: 6 },
      typeCategory: 'skill',
      visualKeyword: 'holy_light'
    };
  }

  if (name === NAMES.ULTIMATE) {
    return {
      baseDmg: 981,
      scalePct: 2.5, // 2.5 * ATK
      scaleStat: 'atk',
      element: 'physical',
      statuses: [
        { type: 'crippled', duration: 10, value: 0.10, name: 'Crippled', stacksAllowed: 3 }
      ],
      multiApplyStacks: 1,
      cooldown: 45,
      typeCategory: 'ultimate',
      visualKeyword: 'beam'
    };
  }

  // Basic attack descriptor
  if (name === NAMES.BASIC) {
    return {
      baseDmg: 48,
      scalePct: 0.0,
      scaleStat: 'atk',
      multiHitCount: 1,
      element: 'physical',
      typeCategory: 'basic',
      cooldown: 1.2,
      visualKeyword: 'slash'
    };
  }

  // Passive descriptor (District 12 Grit) - used by updatePassives
  if (name === NAMES.PASSIVE) {
    return {
      typeCategory: 'passive',
      description: 'Increases tenacity/evasion based on missing HP; grants movement speed on hitting with arrows.'
    };
  }

  return null;
}

// Execute the selected action; uses BattleSystem APIs to show vfx, apply damage/heals and statuses.
export async function executeAction(battle, actor, decision, parsed) {
  if (!decision || !decision.ability) {
    actor.isActing = false;
    return;
  }

  const ability = decision.ability;
  const name = ability.name;
  const ui = battle.uiManager;

  // ensure parsed object exists
  parsed = parsed || getParsedAbility(ability, actor, battle) || {};

  // set cooldowns / energy
  if (decision.type === 'ultimate') actor.energy = 0;
  else if (parsed.cooldown) actor.cooldownTimers[ability.name] = parsed.cooldown;

  // Visual name
  if (ability.name !== NAMES.BASIC) ui.showAbilityName(actor, ability.name);

  // Windup
  await new Promise(r => setTimeout(r, (name === NAMES.BASIC ? 50 : 260)));

  // Helpers for damage calculation
  const computeAmount = (base, pct, statName, target) => {
    let statVal = actor.stats.atk;
    if ((statName || '').includes('magic')) statVal = actor.effectiveMagicAtk;
    if ((statName || '').includes('def')) statVal = actor.effectiveDef;
    if ((statName || '').includes('hp')) statVal = actor.maxHp;
    const amount = Math.floor((base || 0) + (statVal * (pct || 0)));
    return Math.max(1, amount);
  };

  // IMPLEMENTATIONS:

  if (name === NAMES.VOLLEY) {
    // Fires 3 arrows at single target, each deals 48 + atk; applies Bleed stack per arrow (we'll apply once overall as spec)
    const target = decision.targets && decision.targets[0];
    if (!target || target.isDead) { actor.isActing = false; return; }
    const perArrow = computeAmount(parsed.baseDmg || 48, parsed.scalePct || 0, parsed.scaleStat || 'atk', target) || 48;
    for (let i = 0; i < (parsed.multiHitCount || 3); i++) {
      if (target.isDead) break;
      ui.showProjectile(actor, target, 'physical');
      await new Promise(r => setTimeout(r, 60));
      const res = target.receiveAction({ amount: perArrow, type: 'physical', isCrit: Math.random() * 100 < (actor.stats.luck || 0), element: 'physical', attackerAccuracy: 20 });
      if (res.type !== 'miss') {
        ui.showFloatingText(target, res.amount, `damage-number ${res.isCrit ? 'crit' : ''}`);
        ui.playVfx(target, 'slash');
        ui.triggerHitAnim(target);
      } else {
        ui.showFloatingText(target, 'DODGE', 'status-text');
      }
    }
    // Apply bleed as one stack of bleed for 3s (description: stack of bleed for 3 turns)
    target.applyStatus({ type: 'bleed', duration: 3, value: 0.05, name: 'Bleed' });
    ui.showFloatingText(target, 'BLEED', 'status-text');
  }
  else if (name === NAMES.MOCKINGJAY_ARROW) {
    // Deals 110% ATK to enemy target and heals most injured ally for 75% ATK
    const enemy = decision.targets && decision.targets[0];
    const ally = decision.targets && decision.targets[1];
    if (enemy && !enemy.isDead) {
      ui.showProjectile(actor, enemy, 'physical');
      await new Promise(r => setTimeout(r, 120));
      const dmg = computeAmount(0, 1.10, 'atk', enemy);
      const res = enemy.receiveAction({ amount: dmg, type: 'physical', isCrit: Math.random() * 100 < (actor.stats.luck || 0), element: 'physical', attackerAccuracy: 20 });
      if (res.type !== 'miss') {
        ui.showFloatingText(enemy, res.amount, `damage-number ${res.isCrit ? 'crit' : ''}`);
        ui.playVfx(enemy, 'slash');
        ui.triggerHitAnim(enemy);
      } else ui.showFloatingText(enemy, 'DODGE', 'status-text');
    }

    // Heal ally (if none provided, heal self)
    const healTarget = (ally && !ally.isDead) ? ally : actor;
    const healAmt = computeAmount(parsed.baseDmg || 0, 0.75, 'atk', healTarget);
    const hres = healTarget.receiveAction({ amount: healAmt, effectType: 'heal' });
    ui.showFloatingText(healTarget, `+${hres.amount}`, 'damage-number heal');
    ui.playVfx(healTarget, 'heal');

    // On heal, small temporary buff if level scaling unlocked could be added by game progression; here we optionally apply small attack buff for 3s.
    if (healTarget && !healTarget.isDead && (actor.level || 1) >= 50) {
      healTarget.applyStatus({ type: 'buff_atk', value: 0.10, duration: 3, name: 'Mockingjay Aid' });
      ui.showFloatingText(healTarget, 'ATK +10%', 'status-text buff');
    }
  }
  else if (name === NAMES.RESURGENCE) {
    // Big initial heal: 160% ATK + 75 flat, then regen 6% max HP per sec for 4s; also give 20% crit chance for 6s
    const target = decision.targets && decision.targets[0];
    if (!target || target.isDead) { actor.isActing = false; return; }
    ui.playVfx(target, 'holy_light');
    await new Promise(r => setTimeout(r, 140));
    const initHeal = computeAmount(parsed.baseDmg || 75, parsed.scalePct || 1.6, 'atk', target);
    const res = target.receiveAction({ amount: initHeal, effectType: 'heal' });
    ui.showFloatingText(target, `+${res.amount}`, 'damage-number heal');
    // Apply regen status (6% max HP per sec for 4s)
    target.applyStatus({ type: 'regen', percent: 0.06, duration: 4, name: 'Resurgence Regen' });
    // Crit buff
    target.applyStatus({ type: 'buff_crit', value: 0.20, duration: 6, name: 'Resurgence Crit' });
    ui.showFloatingText(target, 'REGEN & CRIT+20%', 'status-text buff');
  }
  else if (name === NAMES.ULTIMATE) {
    // Huge damage: 981 + 2.5 * ATK, applies 'Crippled' which increases incoming damage by 10% per stack (stacks up to 3)
    const target = decision.targets && decision.targets[0];
    if (!target || target.isDead) { actor.isActing = false; return; }
    ui.playVfx(target, 'beam');
    await new Promise(r => setTimeout(r, 200));
    const statAtk = actor.stats.atk || 0;
    const dmg = Math.floor((parsed.baseDmg || 981) + (2.5 * statAtk));
    const res = target.receiveAction({ amount: dmg, type: 'physical', isCrit: Math.random() * 100 < (actor.stats.luck || 0), element: 'physical', attackerAccuracy: 20 });
    if (res.type !== 'miss') {
      ui.showFloatingText(target, res.amount, `damage-number ${res.isCrit ? 'crit' : ''}`);
      ui.triggerHitAnim(target);
    } else ui.showFloatingText(target, 'DODGE', 'status-text');

    // Apply Crippled stacking (each application +10% damage taken, up to 3 stacks)
    // We encode stacks as an activeEffect with stacks count and value (value = 0.10)
    let existing = target.activeEffects.find(e => e.type === 'crippled' || e.name === 'Crippled');
    if (!existing) {
      target.applyStatus({ type: 'crippled', duration: parsed.statuses && parsed.statuses[0] ? parsed.statuses[0].duration : 10, stacks: 1, value: 0.10, name: 'Crippled' });
    } else {
      existing.stacks = Math.min(3, (existing.stacks || 1) + 1);
      existing.duration = Math.max(existing.duration || 0, parsed.statuses && parsed.statuses[0] ? parsed.statuses[0].duration : 10);
      // ensure value matches stacks multiplier indirectly used in BattleCharacter.receiveAction
      existing.value = 0.10;
    }
    ui.showFloatingText(target, 'CRIPPLED', 'status-text buff');
  }
  else {
    // Basic or fallback single hit using basic numbers
    const target = (decision.targets && decision.targets[0]) || null;
    if (target && !target.isDead) {
      ui.showProjectile(actor, target, 'physical');
      await new Promise(r => setTimeout(r, 60));
      const dmg = computeAmount(parsed.baseDmg || 48, parsed.scalePct || 0, parsed.scaleStat || 'atk', target);
      const res = target.receiveAction({ amount: dmg, type: 'physical', isCrit: Math.random() * 100 < (actor.stats.luck || 0), element: 'physical', attackerAccuracy: 18 });
      if (res.type !== 'miss') {
        ui.showFloatingText(target, res.amount, `damage-number ${res.isCrit ? 'crit' : ''}`);
        ui.triggerHitAnim(target);
      } else ui.showFloatingText(target, 'DODGE', 'status-text');
    }
  }

  // PASSIVE TRIGGERS: District 12 Grit - handle speed buff on successful arrow hit and tenacity/evasion scaling
  // If we hit with an "arrow ability" (name contains 'Arrow' or 'Volley' or 'Crippling'), grant movement speed buff
  const arrowKeywords = ['arrow','volley','crippling','mockingjay'];
  if (arrowKeywords.some(k => (ability.name || '').toLowerCase().includes(k))) {
    // Grant 15% movement speed for 3s (as per spec)
    actor.applyStatus({ type: 'buff_speed', value: 0.15, duration: 3, name: 'D12 Speed' });
    ui.showFloatingText(actor, 'SPD+15%', 'status-text buff');
  }

  actor.isActing = false;
}

// Optional passive tick to apply District 12 Grit scaling to tenacity / evasion based on missing HP
export function updatePassives(actor, dt) {
  // compute missing HP pct
  if (!actor || actor.isDead) return;
  const missingPct = 1 - (actor.currentHp / Math.max(1, actor.maxHp));
  // per spec: 0.2% tenacity and 0.1% evasion per 1% missing HP => convert to decimals
  const tenacityBonus = Math.min(0.20, missingPct * 0.20); // cap at 20% (0.20 decimal)
  const evasionBonus = Math.min(0.10, missingPct * 0.10); // cap at 10% (0.10 decimal)

  // apply as passiveModifiers for the character (BattleCharacter.getModifierSum will include these)
  actor.passiveModifiers = actor.passiveModifiers || {};
  actor.passiveModifiers.d12_tenacity = tenacityBonus;
  actor.passiveModifiers.d12_evasion = evasionBonus;

  // Expose these as generic modifiers for other getters
  actor.passiveModifiers.tenacity = (actor.passiveModifiers.tenacity || 0) + 0; // preserve existing
  actor.passiveModifiers.evasion = (actor.passiveModifiers.evasion || 0) + 0;
}

// Provide a small compatibility wrapper in case BattleSystem imports default
export default {
  decideAction,
  getParsedAbility,
  executeAction,
  updatePassives
};