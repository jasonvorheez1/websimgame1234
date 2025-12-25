/*
  Local custom ability module for export_id 26 (Han Solo).
  Provides: decideAction, getParsedAbility, executeAction, updatePassives
*/

export async function decideAction(actor, enemies = [], allies = [], battle) {
  const liveEnemies = enemies.filter(e => !e.isDead);
  const liveAllies = allies.filter(a => !a.isDead && a !== actor);
  if (liveEnemies.length === 0) return { ability: { name: 'Basic Attack' }, type: 'basic', targets: [] };

  // Prefer ultimate when full energy and has viable targets
  const ult = (actor.data?.abilities || []).find(a => String(a.type || '').toLowerCase() === 'ultimate');
  if (ult && actor.energy >= actor.maxEnergy && !actor.cooldownTimers?.[ult.name]) {
    // choose clustered center
    const center = liveEnemies.sort((a,b)=> {
      const ca = liveEnemies.reduce((s,e)=> s + (Math.hypot(e.x-a.x,e.y-a.y) < 160 ? 1:0),0);
      const cb = liveEnemies.reduce((s,e)=> s + (Math.hypot(e.x-b.x,e.y-b.y) < 160 ? 1:0),0);
      return cb - ca;
    })[0] || liveEnemies[0];
    return { ability: ult, type: 'ultimate', targets: center ? [center] : liveEnemies.slice(0,3) };
  }

  // If a high-value enemy has status effects, use Lucky Shot to capitalize
  const lucky = (actor.data?.abilities || []).find(a => (a.name||'').toLowerCase().includes('lucky shot'));
  if (lucky && !actor.cooldownTimers?.[lucky.name]) {
    const priority = liveEnemies.sort((a,b)=> (a.currentHp / a.maxHp) - (b.currentHp / b.maxHp))[0];
    if (priority) return { ability: lucky, type: 'skill', targets: [priority] };
  }

  // Defensive / mobility: Evade and Outmaneuver if surrounded or low HP
  const evade = (actor.data?.abilities || []).find(a => (a.name||'').toLowerCase().includes('evade and outmaneuver'));
  if (evade && !actor.cooldownTimers?.[evade.name]) {
    const nearby = liveEnemies.filter(e => Math.hypot(e.x-actor.x,e.y-actor.y) < 160).length;
    if ((actor.currentHp / actor.maxHp) < 0.6 || nearby >= 2) return { ability: evade, type: 'skill', targets: [actor] };
  }

  // Fallback: basic attack on nearest/lowest hp target
  const basic = (actor.data?.abilities || []).find(a => (a.tags||[]).map(t=>String(t).toLowerCase()).includes('atk')) || { name: 'Basic Attack' };
  const primary = liveEnemies.sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
  return { ability: basic, type: 'basic', targets: [primary] };
}

export function updatePassives(actor, dt) {
  if (actor.isDead) return;
  if (!actor.customResources) actor.customResources = {};
  if (typeof actor._smugglerTick === 'undefined') actor._smugglerTick = 0;
  actor._smugglerTick += dt;
  // Passive: small chance per second to generate Smuggler's Luck over time (baseline regen)
  if (actor._smugglerTick >= 1.0) {
    actor._smugglerTick = 0;
    actor.customResources['Smugglers Luck'] = Math.min(999, (actor.customResources['Smugglers Luck'] || 0) + 0.25);
  }

  // Ensure signature passive baseline stats are represented for UI
  actor.customResources['PassiveTenacity'] = Math.max(0, actor.customResources['PassiveTenacity'] || 25);
  actor.customResources['PassiveEvasion'] = Math.max(0, actor.customResources['PassiveEvasion'] || 10);
}

export async function getParsedAbility(ability, actor) {
  const name = String(ability.name || '').toLowerCase();

  if (name.includes('basic attack')) {
    return { typeCategory: 'basic', baseDmg: 0, scalePct: 1.0, scaleStat: 'atk', element: 'fire', multiHitCount: 1, cooldown: 1.6, visualKeyword: 'proj_sword' };
  }

  if (name.includes('lucky shot')) {
    return {
      typeCategory: 'skill',
      baseDmg: 0,
      scalePct: 1.35,
      scaleStat: 'atk',
      element: 'physical',
      cooldown: 8,
      statuses: [{ type: 'exposed', duration: 4, value: 0.07 }],
      mechanics: { critIfTargetHasStatusBonus: 0.10 },
      visualKeyword: 'vfx_slash'
    };
  }

  if (name.includes('evade and outmaneuver')) {
    return {
      typeCategory: 'skill',
      isBuff: true,
      cooldown: 12,
      mechanics: { speedPct: 0.30, evasionFlat: 10, consumeLuckStacks: 3, staggerRadius: 5 * 40, staggerSlow: 0.20, staggerDuration: 2 },
      visualKeyword: 'vfx_dash'
    };
  }

  if (name.includes('never tell me the odds')) {
    return {
      typeCategory: 'passive',
      statuses: [{ type: 'buff_crit_dmg', duration: Infinity, value: 0.05 }, { type: 'buff_tenacity', duration: Infinity, value: 25 }, { type: 'buff_evasion', duration: Infinity, value: 10 }],
      mechanics: { critNegateChance: 0.20, gainLuckOnNegate: 2, additionalLuckChance: 0.15 }
    };
  }

  if (name.includes('dl-44 barrage') || ability.type && String(ability.type).toLowerCase() === 'ultimate') {
    return {
      typeCategory: 'ultimate',
      isAoE: true,
      multiHitCount: 3,
      cooldown: 75,
      baseDmg: 0,
      scalePct: 0.9,
      scaleStat: 'atk',
      statuses: [{ type: 'debuff_matk', duration: 4, value: -0.05, stackLimit: 3 }],
      mechanics: { consumeLuckForCritAndExtend: 5 },
      visualKeyword: 'vfx_fire_storm'
    };
  }

  if (name.includes('smuggler')) {
    return { typeCategory: 'passive', mechanics: { luckStackGainChance: 0.15, consumeStacksForTrueDamagePct: 0.05, consumeStacksThreshold: 10 } };
  }

  return null;
}

export async function executeAction(battle, actor, decision, parsed) {
  const ui = battle.uiManager;
  const ability = decision.ability;
  const name = String(ability.name || '').toLowerCase();
  const targets = (decision.targets && Array.isArray(decision.targets)) ? decision.targets : (decision.targets ? [decision.targets] : []);
  const primary = targets[0];
  const wait = (ms) => new Promise(r=>setTimeout(r, ms));

  // Basic: standard ranged shot (engine fallback handles damage, but we add visuals & Smuggler's Luck interactions)
  if (name.includes('basic attack')) {
    if (!primary) return;
    ui.showProjectile(actor, primary, 'proj_fire');
    await wait(180);
    // award tiny Smuggler's Luck per basic hit
    actor.addResource && actor.addResource('Smugglers Luck', 0.2);
    return; // engine default damage will be applied
  }

  // Lucky Shot
  if (name.includes('lucky shot')) {
    if (!primary) return;
    ui.showAbilityName(actor, 'LUCKY SHOT');
    ui.playVfx(actor, 'vfx_sword');
    await wait(250);
    // calculate damage roughly if engine doesn't: use effectiveAtk * scalePct
    const scale = parsed?.scalePct || 1.35;
    const dmg = Math.floor(actor.effectiveAtk * scale);
    const res = primary.receiveAction({ amount: dmg, type: 'physical', attackerElement: 'physical' });
    ui.showFloatingText(primary, res.amount, 'damage-number');
    ui.playVfx(primary, 'vfx_spark');
    // apply Exposed debuff
    primary.applyStatus({ type: 'vulnerability_stack', stacks: 1, duration: parsed?.statuses?.[0]?.duration || 4, value: parsed?.statuses?.[0]?.value || 0.07, name: 'Exposed' });
    // if target had status effects, grant temporary crit chance (mechanic emulated via small energy or resource)
    const hadStatus = primary.activeEffects && primary.activeEffects.length > 0;
    if (hadStatus) {
      actor.addResource && actor.addResource('Smugglers Luck', 1);
      // also small instant crit chance visual reward
      ui.showFloatingText(actor, 'CRIT+', 'status-text buff');
    }
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 8;
    return;
  }

  // Evade and Outmaneuver
  if (name.includes('evade and outmaneuver')) {
    ui.showAbilityName(actor, 'EVADE & OUTMANEUVER');
    ui.playVfx(actor, 'vfx_dash');
    // Grant speed & evasion
    actor.applyStatus({ type: 'buff_speed', value: parsed?.mechanics?.speedPct || 0.30, duration: 2, name: 'EvadeSpeed' });
    actor.applyStatus({ type: 'buff_evasion', value: (parsed?.mechanics?.evasionFlat || 10), duration: 2, name: 'EvadeEvasion' });
    // If enough Smuggler's Luck, consume stacks to apply Stagger to nearby enemies
    const luck = Math.floor(actor.getResource ? actor.getResource('Smugglers Luck') : (actor.customResources?.['Smugglers Luck']||0));
    if (luck >= (parsed?.mechanics?.consumeLuckStacks || 3)) {
      if (actor.consumeResource) actor.consumeResource('Smugglers Luck', parsed.mechanics.consumeLuckStacks || 3);
      else actor.customResources['Smugglers Luck'] = Math.max(0, (actor.customResources['Smugglers Luck'] || 0) - (parsed.mechanics.consumeLuckStacks || 3));
      const radius = parsed?.mechanics?.staggerRadius || 5 * 40;
      const pool = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);
      pool.forEach(e => {
        const dist = Math.hypot(e.x - actor.x, e.y - actor.y);
        if (dist <= radius) {
          e.applyStatus({ type: 'debuff_speed', value: parsed?.mechanics?.staggerSlow || 0.20, duration: parsed?.mechanics?.staggerDuration || 2, name: 'Stagger' });
          ui.showFloatingText(e, 'STAGGERED', 'status-text');
        }
      });
    }
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 12;
    return;
  }

  // Ultimate: DL-44 Barrage
  if (name.includes('dl-44 barrage') || decision.type === 'ultimate') {
    ui.showAbilityName(actor, 'DL-44 BARRAGE!');
    ui.playVfx(actor, 'vfx_fire_storm');
    actor.channeling = true;
    await wait(parsed?.channelDuration ? parsed.channelDuration * 1000 : 700);
    actor.channeling = false;
    const pool = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);
    const shots = Math.min(parsed?.multiHitCount || 3, pool.length || 3);
    const luck = Math.floor(actor.getResource ? actor.getResource('Smugglers Luck') : (actor.customResources?.['Smugglers Luck']||0));
    const consumeForCrit = parsed?.mechanics?.consumeLuckForCritAndExtend || 5;
    const guaranteeCrit = luck >= consumeForCrit;
    if (guaranteeCrit && actor.consumeResource) actor.consumeResource('Smugglers Luck', luck);
    else if (guaranteeCrit) actor.customResources['Smugglers Luck'] = 0;

    for (let i = 0; i < shots; i++) {
      const target = pool[i % pool.length];
      if (!target) continue;
      ui.showProjectile(actor, target, 'proj_fire');
      await wait(180 + i * 60);
      const dmg = Math.floor(actor.effectiveAtk * (parsed?.scalePct || 0.9));
      const res = target.receiveAction({ amount: dmg, type: 'physical', isCrit: guaranteeCrit, attackerElement: 'fire' });
      ui.showFloatingText(target, res.amount, `damage-number ${guaranteeCrit ? 'crit' : ''}`);
      // apply Disrupt stacks (reduce magic def)
      target.applyStatus({ type: 'debuff_magicdef', duration: guaranteeCrit ? 6 : 4, value: -0.05, stackLimit: 3, name: 'Disrupt' });
      ui.playVfx(target, 'vfx_explosion');
    }
    actor.energy = 0;
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 75;
    return;
  }

  // Fallback: let engine handle basic / default
  return;
}