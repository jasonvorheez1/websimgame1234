/**
 * Custom ability module for character 133 (Tails).
 *
 * Exports:
 *  - decideAction(actor, enemies, allies, battle): returns { ability, targets, type }
 *  - getParsedAbility(ability, actor, battle): returns a parsed ability object used by BattleSystem
 *  - executeAction(battle, actor, decision, parsed): performs the ability including visuals/effects
 *  - updatePassives(actor, dt): optional per-tick passive updates
 *
 * Abilities implemented:
 *  - Basic Attack / Fox Tail Swipe (multi-hit style)
 *  - Whirlwind Kick (linear multi-hit with knockback + ally speed trail)
 *  - Propeller Flight (untargetable flight then landing AOE slow + optional shield)
 *  - Tailwind Assistance (ultimate: channel heal+speed + shield burst)
 *
 * Note: integrates with BattleSystem UI helpers (showProjectile, playVfx, showFloatingText, triggerHitAnim).
 */

const NAMES = {
  BASIC: "Basic Attack",
  WHIRLWIND: "Whirlwind Kick",
  FLIGHT: "Propeller Flight",
  TAIL_SWIPE: "Fox Tail Swipe",
  ULTIMATE: "Tailwind Assistance",
  PASSIVE: "Swift Tactics"
};

import { pickRandom } from './src/utils.js';

// Helper: pick primary target by priority
function pickPrimary(pool, priority, self) {
  if (!pool || pool.length === 0) return null;
  if (priority === 'weakest') return pool.slice().sort((a,b) => (a.currentHp/a.maxHp) - (b.currentHp/b.maxHp))[0];
  if (priority === 'strongest') return pool.slice().sort((a,b) => b.pwr - a.pwr)[0];
  if (priority === 'closest') return pool.slice().sort((a,b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y))[0];
  return pool[0];
}

export async function decideAction(actor, enemies, allies, battle) {
  const liveEnemies = enemies.filter(e => !e.isDead && !e.isStealthed);
  const liveAllies = allies.filter(a => !a.isDead);

  // Ultimate if energy full and an ally exists
  const ult = actor.data.abilities.find(a => a.name === NAMES.ULTIMATE);
  if (actor.energy >= actor.maxEnergy && ult) {
    // Prefer healing low ally, else self
    const targetAlly = liveAllies.sort((a,b) => (a.currentHp/a.maxHp) - (b.currentHp/b.maxHp))[0] || actor;
    return { ability: ult, targets: [targetAlly], type: 'ultimate' };
  }

  // If in flight (custom flag), prefer to land/finish
  if (actor.customState && actor.customState.inFlight && actor.customState.canLandEarly) {
    const flightAbility = actor.data.abilities.find(a => a.name === NAMES.FLIGHT);
    if (flightAbility) return { ability: flightAbility, targets: [pickPrimary(liveEnemies, 'closest', actor)], type: 'skill' };
  }

  // If enemies grouped, prefer Whirlwind Kick for AoE/knockback (if off-cooldown)
  const whirl = actor.data.abilities.find(a => a.name === NAMES.WHIRLWIND);
  if (whirl && !actor.cooldownTimers[whirl.name]) {
    if (liveEnemies.length >= 2) {
      const primary = pickPrimary(liveEnemies, 'closest', actor);
      return { ability: whirl, targets: [primary], type: 'skill' };
    }
  }

  // If volley / swipe (Fox Tail Swipe) is ready and target vulnerable, use it
  const swipe = actor.data.abilities.find(a => a.name === NAMES.TAIL_SWIPE);
  if (swipe && !actor.cooldownTimers[swipe.name]) {
    const primary = pickPrimary(liveEnemies, 'closest', actor);
    return { ability: swipe, targets: [primary], type: 'skill' };
  }

  // Flight as mobility / reposition if far from main fight or to avoid CC (use occasionally)
  const flight = actor.data.abilities.find(a => a.name === NAMES.FLIGHT);
  if (flight && !actor.cooldownTimers[flight.name] && Math.random() < 0.12) {
    return { ability: flight, targets: [pickPrimary(liveEnemies, 'closest', actor)], type: 'skill' };
  }

  // Default: basic attack
  const basic = actor.data.abilities.find(a => a.name === NAMES.BASIC) || { name: NAMES.BASIC, type: 'Active', description: 'Basic hit' };
  const target = pickPrimary(liveEnemies, 'closest', actor);
  return { ability: basic, targets: target ? [target] : [], type: 'basic' };
}

export function getParsedAbility(ability, actor, battle) {
  const name = (ability && ability.name) || String(ability);

  if (name === NAMES.WHIRLWIND) {
    return {
      baseDmg: 25,
      scalePct: 0.6,
      scaleStat: 'atk',
      multiHitCount: 1,
      element: 'physical',
      statuses: [],
      targeting: 'line',
      typeCategory: 'skill',
      cooldown: 8,
      visualKeyword: 'wind_gust',
      mechanics: { knockback: 1.0, createsTrail: true, trailDuration: 2, trailSpeedBuff: 0.10 }
    };
  }

  if (name === NAMES.FLIGHT) {
    return {
      baseDmg: 10,
      scalePct: 0.3,
      scaleStat: 'magicAtk',
      isTeleport: false,
      isUntargetableDuring: true,
      channelDuration: 2.5,
      element: 'magic',
      statuses: [{ type: 'slow', value: 0.20, duration: 1.5, auraRadius: 80, auraTarget: 'enemy' }],
      targeting: 'self',
      typeCategory: 'skill',
      cooldown: 20,
      visualKeyword: 'wind_gust',
      mechanics: { grantsShieldOnLand: true, shieldPct: 0.10 }
    };
  }

  if (name === NAMES.TAIL_SWIPE) {
    return {
      baseDmg: 12,
      scalePct: 0.4,
      scaleStat: 'atk',
      multiHitCount: 1,
      element: 'physical',
      statuses: [{ type: 'dust', duration: 4, value: 0.03, name: 'Dust', stackLimit: 5 }],
      targeting: 'single',
      typeCategory: 'skill',
      cooldown: 4,
      visualKeyword: 'slash',
      mechanics: { applyDustStacks: 1 }
    };
  }

  if (name === NAMES.ULTIMATE) {
    return {
      baseDmg: 0,
      scalePct: 0.4,
      scaleStat: 'magicAtk',
      isHeal: true,
      channelDuration: 3.0,
      healTickInterval: 0.5,
      healPerTickBase: 15,
      statuses: [{ type: 'shield', duration: 5, value: 50 + (1.0 * (actor.stats ? actor.stats.magicAtk : 0)), name: 'Tailwind Shield' }],
      targeting: 'ally',
      typeCategory: 'ultimate',
      cooldown: 60,
      visualKeyword: 'holy_light',
      mechanics: { grantsSpeedBurstToSpeedBased: 0.5, speedBurstDuration: 1.0 }
    };
  }

  if (name === NAMES.BASIC) {
    return {
      baseDmg: 1,
      scalePct: 0,
      scaleStat: 'atk',
      multiHitCount: 1,
      element: 'physical',
      typeCategory: 'basic',
      cooldown: 1.0,
      visualKeyword: 'slash'
    };
  }

  return null;
}

export async function executeAction(battle, actor, decision, parsed) {
  if (!decision || !decision.ability) {
    actor.isActing = false;
    return;
  }
  const ability = decision.ability;
  const ui = battle.uiManager;
  parsed = parsed || getParsedAbility(ability, actor, battle) || {};

  // Set cooldowns / energy usage
  if (decision.type === 'ultimate') actor.energy = 0;
  else if (parsed.cooldown) actor.cooldownTimers[ability.name] = parsed.cooldown;

  // Basic name popup
  if (ability.name !== NAMES.BASIC) ui.showAbilityName(actor, ability.name);

  // Windup
  await new Promise(r => setTimeout(r, (ability.name === NAMES.BASIC ? 50 : 240)));

  // Helpers
  const computeAmount = (base, pct, statName) => {
    let statVal = actor.stats.atk;
    if ((statName || '').includes('magic')) statVal = actor.effectiveMagicAtk || actor.stats.magicAtk || 0;
    if ((statName || '').includes('hp')) statVal = actor.maxHp || actor.stats.maxHp || 0;
    return Math.max(1, Math.floor((base || 0) + (statVal * (pct || 0))));
  };

  // Implementations
  if (ability.name === NAMES.WHIRLWIND) {
    const primary = decision.targets && decision.targets[0];
    const amount = computeAmount(parsed.baseDmg || 25, parsed.scalePct || 0.6, parsed.scaleStat || 'atk');
    // Simulate hitting enemies in a short line: pick enemies within 80px of a line from actor to primary
    const enemies = battle.enemies.filter(e => !e.isDead);
    ui.playVfx(actor, 'wind_gust');
    for (const target of enemies) {
      // simple distance check to primary direction: approximate by closeness to primary y/x band
      const d = Math.hypot(target.x - primary.x, target.y - primary.y);
      if (d <= 90) {
        ui.showProjectile(actor, target, 'physical');
        await new Promise(r => setTimeout(r, 60));
        const res = target.receiveAction({ amount, type: 'physical', isCrit: Math.random() * 100 < (actor.stats.luck || 0), element: 'physical', attackerAccuracy: 18 });
        if (res.type !== 'miss') {
          ui.showFloatingText(target, res.amount, `damage-number ${res.isCrit ? 'crit' : ''}`);
          ui.triggerHitAnim(target);
          // knockback small distance and short stun if upgraded later: apply simple displacement
          target.x += (target.x > actor.x ? 1 : -1) * 60;
          target.applyStatus({ type: 'root', duration: 0.0 }); // placeholder for knockback effect (visual displacement done)
        }
      }
    }
    // Create trail object: we just show VFX on allies who pass through for the duration by applying a short buff to allies near actor now
    battle.allies.forEach(a => {
      if (!a.isDead) {
        const dist = Math.hypot(a.x - actor.x, a.y - actor.y);
        if (dist <= 120) a.applyStatus({ type: 'buff_speed', value: parsed.mechanics?.trailSpeedBuff || 0.10, duration: parsed.mechanics?.trailDuration || 2, name: 'Wind Trail' });
      }
    });
  }
  else if (ability.name === NAMES.FLIGHT) {
    // Become untargetable for channelDuration, reposition, then land and deal AOE slow and optional shield
    actor.customState = actor.customState || {};
    actor.customState.inFlight = true;
    actor.customState.canLandEarly = true;
    ui.showAbilityName(actor, ability.name);
    ui.playVfx(actor, 'vfx-wind');
    // Mark untargetable
    actor.applyStatus({ type: 'invulnerability', duration: parsed.channelDuration });
    // Increase movement speed temporarily
    actor.applyStatus({ type: 'buff_speed', value: 0.6, duration: parsed.channelDuration, name: 'Propeller Flight Speed' });

    // Wait for channel (simulate flight)
    await new Promise(r => setTimeout(r, parsed.channelDuration * 1000 / (battle.battleSpeed || 1)));

    // Land: AOE damage + slow
    const enemies = battle.enemies.filter(e => !e.isDead);
    ui.playVfx(actor, 'vfx-explosion');
    for (const t of enemies) {
      const dist = Math.hypot(t.x - actor.x, t.y - actor.y);
      if (dist <= 120) {
        const dmg = computeAmount(parsed.baseDmg || 10, parsed.scalePct || 0.3, parsed.scaleStat || 'magicAtk');
        const res = t.receiveAction({ amount: dmg, type: 'magic', isCrit: false, element: 'magic', attackerAccuracy: 10 });
        if (res.type !== 'miss') {
          ui.showFloatingText(t, res.amount, 'damage-number');
          ui.playVfx(t, 'vfx-ice');
          t.applyStatus({ type: 'slow', duration: parsed.statuses?.[0]?.duration || 1.5, value: parsed.statuses?.[0]?.value || 0.2 });
        } else ui.showFloatingText(t, 'DODGE', 'status-text');
      }
    }

    // Shield on land if mechanic set
    if (parsed.mechanics && parsed.mechanics.grantsShieldOnLand) {
      const shieldVal = Math.floor((actor.maxHp || actor.stats.maxHp || 1000) * (parsed.mechanics.shieldPct || 0.10));
      actor.applyStatus({ type: 'shield', duration: 5, value: shieldVal, name: 'Propeller Shield' });
      ui.showFloatingText(actor, `SHIELD +${shieldVal}`, 'status-text buff');
      ui.playVfx(actor, 'vfx-light');
    }

    actor.customState.inFlight = false;
    actor.customState.canLandEarly = false;
  }
  else if (ability.name === NAMES.TAIL_SWIPE) {
    const target = decision.targets && decision.targets[0];
    if (!target || target.isDead) { actor.isActing = false; return; }
    const amount = computeAmount(parsed.baseDmg || 12, parsed.scalePct || 0.4, parsed.scaleStat || 'atk');
    // Fast multi-swipe: 3 quick hits simulated by small waits
    for (let i = 0; i < 3; i++) {
      if (target.isDead) break;
      ui.showProjectile(actor, target, 'physical');
      await new Promise(r => setTimeout(r, 60));
      const res = target.receiveAction({ amount, type: 'physical', isCrit: Math.random() * 100 < (actor.stats.luck || 0), element: 'physical', attackerAccuracy: 18 });
      if (res.type !== 'miss') {
        ui.showFloatingText(target, res.amount, `damage-number ${res.isCrit ? 'crit' : ''}`);
        ui.triggerHitAnim(target);
      } else ui.showFloatingText(target, 'DODGE', 'status-text');
    }
    // Apply Dust stacks on final hit
    target.applyStatus({ type: 'dust', duration: parsed.statuses?.[0]?.duration || 4, value: parsed.statuses?.[0]?.value || 0.03, stacks: parsed.mechanics?.applyDustStacks || 1, name: 'Dust' });
    ui.showFloatingText(target, 'DUST', 'status-text');
  }
  else if (ability.name === NAMES.ULTIMATE) {
    // Channel over parsed.channelDuration: heal ticks every healTickInterval and grant movement speed to ally; end with shield
    const ally = decision.targets && decision.targets[0] ? decision.targets[0] : actor;
    const duration = parsed.channelDuration || 3.0;
    const tick = parsed.healTickInterval || 0.5;
    const ticks = Math.floor(duration / tick);
    ui.showAbilityName(actor, ability.name);
    actor.applyStatus({ type: 'invulnerability', duration: duration }); // immune to CC while channeling
    // Channel visually
    ui.playVfx(actor, 'vfx-holy_light');
    for (let i = 0; i < ticks; i++) {
      if (ally.isDead) break;
      const healAmt = Math.floor((parsed.healPerTickBase || 15) + ( (actor.stats.magicAtk || 0) * (parsed.scalePct || 0.4) ));
      const res = ally.receiveAction({ amount: healAmt, effectType: 'heal' });
      ui.showFloatingText(ally, `+${res.amount}`, 'damage-number heal');
      await new Promise(r => setTimeout(r, tick * 1000 / (battle.battleSpeed || 1)));
    }

    // End burst: shield
    const shieldBase = Math.floor((parsed.statuses && parsed.statuses[0] && parsed.statuses[0].value) || (50 + (1.0 * (actor.stats ? actor.stats.magicAtk : 0))));
    ally.applyStatus({ type: 'shield', duration: parsed.statuses?.[0]?.duration || 5, value: shieldBase, name: 'Tailwind Shield' });
    ui.showFloatingText(ally, `SHIELD +${shieldBase}`, 'status-text buff');
    ui.playVfx(ally, 'vfx-heal');

    // If ally relies on speed-based damage, grant short burst of movement speed
    if ((ally.data && ally.data.tags && ally.data.tags.includes('SpeedBased')) || (ally.data && (ally.data.role || '').toLowerCase().includes('ranger'))) {
      ally.applyStatus({ type: 'buff_speed', value: parsed.mechanics?.grantsSpeedBurstToSpeedBased || 0.5, duration: parsed.mechanics?.speedBurstDuration || 1.0, name: 'Tailwind Burst' });
      ui.showFloatingText(ally, 'SPD+50%', 'status-text buff');
    }

    // Optional cleanse upgrade behavior (handled by parser upgrades elsewhere) - not auto-applied here.
  }
  else {
    // Basic single hit
    const target = (decision.targets && decision.targets[0]) || null;
    if (target && !target.isDead) {
      const dmg = computeAmount(parsed.baseDmg || 1, parsed.scalePct || 0, parsed.scaleStat || 'atk');
      ui.showProjectile(actor, target, 'physical');
      await new Promise(r => setTimeout(r, 60));
      const res = target.receiveAction({ amount: dmg, type: 'physical', isCrit: Math.random() * 100 < (actor.stats.luck || 0), element: 'physical', attackerAccuracy: 18 });
      if (res.type !== 'miss') {
        ui.showFloatingText(target, res.amount, `damage-number ${res.isCrit ? 'crit' : ''}`);
        ui.triggerHitAnim(target);
      } else ui.showFloatingText(target, 'DODGE', 'status-text');
    }
  }

  actor.isActing = false;
}

export function updatePassives(actor, dt) {
  if (!actor || actor.isDead) return;
  // Lightweight passive: small regen of a 'momentum' resource when moving at high speed (simulated)
  actor.passiveModifiers = actor.passiveModifiers || {};
  // If actor has Wind Trail buff active, grant tiny speed stacking bonus persistence handled by statuses; nothing heavy here.
  // Maintain a small internal fast-heal if below 20% HP (tiny survival trait)
  if ((actor.currentHp / actor.maxHp) < 0.2 && !actor.isDead) {
    actor.currentHp = Math.min(actor.maxHp, actor.currentHp + (5 * dt)); // 5 HP/sec regen emergency
  }
}

export default {
  decideAction,
  getParsedAbility,
  executeAction,
  updatePassives
};