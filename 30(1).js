/*
  Local custom ability module for export_id 30 (Azula).
  Implements: decideAction, getParsedAbility, executeAction, updatePassives
*/

export async function decideAction(actor, enemies = [], allies = [], battle) {
  const liveEnemies = enemies.filter(e => !e.isDead);
  const liveAllies = allies.filter(a => !a.isDead && a !== actor);
  if (liveEnemies.length === 0) return { ability: { name: 'Basic Attack' }, type: 'basic', targets: [] };

  // Prefer ultimate if ready and will affect multiple enemies
  const ult = (actor.data?.abilities || []).find(a => String(a.type || '').toLowerCase() === 'ultimate');
  if (ult && actor.energy >= actor.maxEnergy && !actor.cooldownTimers?.[ult.name]) {
    const clustered = liveEnemies.filter(e => Math.hypot(e.x - actor.x, e.y - actor.y) < 220).length;
    if (clustered >= 2) return { ability: ult, type: 'ultimate', targets: liveEnemies.slice(0, 8) };
  }

  // If low ally HP or self-low, use Dazzling Fire Jet Propulsion defensively (dash + shield)
  const dash = (actor.data?.abilities || []).find(a => (a.name || '').toLowerCase().includes('dazzling fire'));
  if (dash && !actor.cooldownTimers?.[dash.name]) {
    const lowAlly = [actor, ...liveAllies].find(a => (a.currentHp / a.maxHp) < 0.55);
    if (lowAlly) {
      // target a nearby enemy to dash through if possible, otherwise dash forward
      const close = liveEnemies.sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
      return { ability: dash, type: 'skill', targets: close ? [close] : [liveEnemies[0]] };
    }
  }

  // If have Combustion stacks, use Lightning Flick Disruption to consume them for amplified effect
  const lightning = (actor.data?.abilities || []).find(a => (a.name || '').toLowerCase().includes('lightning flick'));
  const combustion = Math.floor(actor.getResource ? actor.getResource('Combustion') : (actor.customResources?.['Combustion']||0));
  if (lightning && !actor.cooldownTimers?.[lightning.name]) {
    // prioritize highest threat enemy
    const target = liveEnemies.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
    if (target && combustion > 0) return { ability: lightning, type: 'skill', targets: [target] };
  }

  // Default: basic attack nearest enemy
  const basic = (actor.data?.abilities || []).find(a => (a.tags || []).includes('atk')) || { name: 'Basic Attack' };
  const tgt = liveEnemies.sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
  return { ability: basic, type: 'basic', targets: [tgt] };
}

export function updatePassives(actor, dt) {
  if (actor.isDead) return;
  if (!actor.customResources) actor.customResources = {};
  // Blue Fire stacks logic: decay 1 every 5s if not refreshed
  if (typeof actor._blueFireTick === 'undefined') actor._blueFireTick = 0;
  actor._blueFireTick += dt;
  if (actor._blueFireTick >= 1.0) {
    actor._blueFireTick = 0;
    if (!actor._blueFireRefreshed) {
      actor._blueFireAge = (actor._blueFireAge || 0) + 1;
      if ((actor._blueFireAge || 0) >= 5) {
        actor.customResources['BlueFire'] = Math.max(0, (actor.customResources['BlueFire'] || 0) - 1);
        actor._blueFireAge = 0;
      }
    } else {
      actor._blueFireRefreshed = false;
      actor._blueFireAge = 0;
    }
  }

  // Cap BlueFire at 5
  actor.customResources['BlueFire'] = Math.min(5, actor.customResources['BlueFire'] || 0);

  // Combustion stacks tracked separately; ensure non-negative
  actor.customResources['Combustion'] = Math.max(0, Math.floor(actor.customResources['Combustion'] || 0));
}

export async function getParsedAbility(ability, actor) {
  const name = String(ability.name || '').toLowerCase();
  if (name.includes('basic attack')) {
    return { typeCategory: 'basic', baseDmg: 0, scalePct: 1.0, scaleStat: 'atk', element: 'fire', multiHitCount: 1, cooldown: 1.8, visualKeyword: 'proj_fire' };
  }
  if (name.includes('dazzling fire')) {
    return {
      typeCategory: 'skill',
      isDash: true,
      baseDmg: 60,
      scalePct: 0.6,
      scaleStat: 'magicAtk',
      isShield: true,
      shieldValue: 50,
      shieldDuration: 2,
      mechanics: { grantCombustion: 1 },
      cooldown: 10,
      visualKeyword: 'vfx_dash'
    };
  }
  if (name.includes('lightning flick') || name.includes('disruption')) {
    return {
      typeCategory: 'skill',
      baseDmg: 70,
      scalePct: 0.7,
      scaleStat: 'magicAtk',
      statuses: [{ type: 'static_charge', duration: 4, value: 0.20 }],
      mechanics: { consumesCombustionAll: true },
      cooldown: 12,
      visualKeyword: 'vfx_lightning'
    };
  }
  if (name.includes('sozin') || name.includes('ultimate')) {
    return {
      typeCategory: 'ultimate',
      isAoE: true,
      baseDmg: 150,
      scalePct: 1.5,
      scaleStat: 'magicAtk',
      mechanics: { preventCombustionDecay: true, damageReductionPct: 0.30 },
      duration: 5,
      cooldown: 90,
      visualKeyword: 'vfx_fire_storm'
    };
  }
  if (name.includes('controlled fury') || name.includes('intimidation')) {
    return { typeCategory: 'passive', statuses: [{ type: 'buff_matk_percent', duration: Infinity, value: 0.04 }], mechanics: { blueFirePerHit:1, blueFireMax:5 } };
  }
  return null;
}

export async function executeAction(battle, actor, decision, parsed) {
  const ui = battle.uiManager;
  const ability = decision.ability;
  const name = String(ability.name || '').toLowerCase();
  const targets = (decision.targets && Array.isArray(decision.targets)) ? decision.targets : (decision.targets ? [decision.targets] : []);
  const primary = targets[0];
  const wait = (ms)=> new Promise(r=>setTimeout(r,ms));

  // Dazzling Fire Jet Propulsion (dash)
  if (name.includes('dazzling fire')) {
    ui.showAbilityName(actor, 'DAZZLING FIRE JET');
    ui.playVfx(actor, 'vfx_dash');
    // dash visual and damage to passed-through target(s)
    if (primary) {
      const dmg = Math.floor((parsed.baseDmg || 60) + (actor.effectiveMagicAtk * (parsed.scalePct || 0.6)));
      const res = primary.receiveAction({ amount: dmg, type: 'magic', attackerElement: 'fire' });
      ui.showFloatingText(primary, res.amount, 'damage-number magic');
      ui.playVfx(primary, parsed.visualKeyword || 'fire');
    }
    // grant shield (clamped) and mark Combustion
    const shieldVal = Math.floor(parsed.shieldValue || parsed.shieldValue === 0 ? parsed.shieldValue : parsed.shieldValue || 50);
    actor.applyStatus({ type: 'shield', value: shieldVal, duration: parsed.shieldDuration || 2, name: 'Dazzle_Shield' });
    actor.addResource && actor.addResource('Combustion', parsed.mechanics?.grantCombustion || 1, 999);
    // also grant BlueFire stack on hit
    actor.addResource && actor.addResource('BlueFire', 1, 5);
    actor._blueFireRefreshed = true;
    actor.cooldownTimers[ability.name] = parsed.cooldown || 10;
    return;
  }

  // Lightning Flick Disruption (single target, consumes combustion)
  if (name.includes('lightning flick') || name.includes('disruption')) {
    if (!primary) return;
    ui.showAbilityName(actor, 'LIGHTNING FLICK');
    ui.playVfx(primary, 'vfx_lightning');
    // consume all Combustion stacks for possible amplify & stun if threshold met
    const combustion = Math.floor(actor.getResource ? actor.getResource('Combustion') : (actor.customResources?.['Combustion']||0));
    const base = Math.floor((parsed.baseDmg || 70) + (actor.effectiveMagicAtk * (parsed.scalePct || 0.7)));
    const extraMult = combustion > 0 ? (1 + 0.12 * combustion) : 1;
    const dmg = Math.floor(base * extraMult);
    const res = primary.receiveAction({ amount: dmg, type: 'magic', attackerElement: 'electric', isCrit: false });
    ui.showFloatingText(primary, res.amount, 'damage-number magic');
    // apply Static Charge status
    primary.applyStatus({ type: 'static_charge', duration: parsed.statuses?.[0]?.duration || 4, value: parsed.statuses?.[0]?.value || 0.2, name: 'Static_Charge' });
    // if combustion >=5, apply 1s stun (upgrade)
    if (combustion >= 5) primary.applyStatus({ type: 'stun', duration: 1.0, name: 'Overload_Stun' });
    // consume all combustion
    if (actor.consumeResource) actor.consumeResource('Combustion', combustion);
    else actor.customResources['Combustion'] = 0;
    // grant BlueFire stack on use
    actor.addResource && actor.addResource('BlueFire', 1, 5);
    actor._blueFireRefreshed = true;
    actor.cooldownTimers[ability.name] = parsed.cooldown || 12;
    return;
  }

  // Ultimate: Sozin's Comet Enhanced Inferno
  if (name.includes('sozin') || decision.type === 'ultimate') {
    ui.showAbilityName(actor, "SOZIN'S COMET: INFERNO");
    ui.playVfx(actor, 'vfx_fire_storm');
    // Prevent Combustion decay during duration and apply damage reduction
    const dur = parsed.duration || 5;
    actor.applyStatus({ type: 'buff_def_percent', value: parsed.mechanics?.damageReductionPct || 0.30, duration: dur, name: 'Sozin_DefRed' });
    actor.applyStatus({ type: 'prevent_combustion_decay', duration: dur, name: 'Sozin_CombustionLock' });
    // channel then nova at end
    actor.channeling = true;
    await wait(dur * 1000);
    actor.channeling = false;
    // nova damage to enemies in radius (use simple distance filter)
    const enemiesPool = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);
    enemiesPool.forEach(e => {
      const dist = Math.hypot(e.x - actor.x, e.y - actor.y);
      if (dist <= 300) {
        const dmg = Math.floor((parsed.baseDmg || 150) + (actor.effectiveMagicAtk * (parsed.scalePct || 1.5)));
        const r = e.receiveAction({ amount: dmg, type: 'magic', attackerElement: 'fire' });
        ui.showFloatingText(e, r.amount, 'damage-number magic');
        ui.playVfx(e, 'vfx_explosion');
      }
    });
    // optionally grant Combustion stacks on activation if upgrades present
    if (parsed.mechanics && parsed.mechanics.grantOnCast) actor.addResource && actor.addResource('Combustion', parsed.mechanics.grantOnCast, 999);
    actor.energy = 0;
    actor.cooldownTimers[ability.name] = parsed.cooldown || 90;
    return;
  }

  // Basic fallback handled by engine; however grant BlueFire on hit when basic used
  if (decision.type === 'basic' || name.includes('basic attack')) {
    // engine likely applied damage; just award stack
    actor.addResource && actor.addResource('BlueFire', 1, 5);
    actor._blueFireRefreshed = true;
    return;
  }

  return;
}