/*
  Local custom ability module for export_id 27 (Princess Leia).
  Implements: decideAction, getParsedAbility, executeAction, updatePassives
  Abilities implemented:
   - Basic Attack (ranged, fire, grants extra magic damage during ultimate)
   - Rebel Tactics: Cover Fire (shield/buff, consumes Diplomatic Influence for stronger effect)
   - Rebel Command: Blaster Barrage (damage + Suppressed debuff, synergy with Rebel Coordination)
   - Hope for the Rebellion: Inspiring Presence (passive aura + Diplomatic Influence generation)
   - Force of Leadership: Rebellion's Resolve (ultimate buff/damage reduction + optional full-Influence amplification)
   - Signature Passive: Tenacity of Hope (aura, evasion on DI consume, Last Stand emergency)
*/

export async function decideAction(actor, enemies = [], allies = [], battle) {
  const liveEnemies = enemies.filter(e => !e.isDead);
  const liveAllies = allies.filter(a => !a.isDead && a !== actor);

  if (liveEnemies.length === 0) return { ability: { name: 'Basic Attack' }, type: 'basic', targets: [] };

  // prioritize ultimate when ready and will meaningfully buff allies (use on multi-ally situations)
  const ult = (actor.data?.abilities || []).find(a => String(a.type || '').toLowerCase() === 'ultimate');
  const diplomatic = Math.floor(actor.getResource ? actor.getResource('Diplomatic Influence') : (actor.customResources?.['Diplomatic Influence']||0));
  if (ult && actor.energy >= actor.maxEnergy && !actor.cooldownTimers?.[ult.name]) {
    // prefer using ultimate if at least 2 allies alive or DI >= 50 for extended duration
    if (liveAllies.length >= 2 || diplomatic >= 50) {
      return { ability: ult, type: 'ultimate', targets: liveAllies.slice(0, 5) };
    }
  }

  // Support logic: if ally below threshold, shield them with Cover Fire if off cooldown
  const cover = (actor.data?.abilities || []).find(a => (a.name||'').toLowerCase().includes('cover fire'));
  if (cover && !actor.cooldownTimers?.[cover.name]) {
    const lowAlly = [actor, ...liveAllies].sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
    if (lowAlly && (lowAlly.currentHp / lowAlly.maxHp) < 0.6) {
      return { ability: cover, type: 'skill', targets: [lowAlly] };
    }
  }

  // Offensive: use Blaster Barrage on closest/highest-threat enemy when available
  const barrage = (actor.data?.abilities || []).find(a => (a.name||'').toLowerCase().includes('blaster barrage'));
  if (barrage && !actor.cooldownTimers?.[barrage.name]) {
    const priority = liveEnemies.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
    if (priority) return { ability: barrage, type: 'skill', targets: [priority] };
  }

  // Otherwise basic attack on nearest enemy
  const basic = (actor.data?.abilities || []).find(a => (a.tags||[]).includes('atk')) || { name: 'Basic Attack' };
  const tgt = liveEnemies.sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
  return { ability: basic, type: 'basic', targets: [tgt] };
}

export function updatePassives(actor, dt) {
  if (actor.isDead) return;
  if (!actor.customResources) actor.customResources = {};
  // Diplomatic Influence passive generation (Hope for the Rebellion)
  if (typeof actor._diTick === 'undefined') actor._diTick = 0;
  actor._diTick += dt;
  if (actor._diTick >= 8.0) {
    actor._diTick = 0;
    const gain = 20;
    actor.addResource && actor.addResource('Diplomatic Influence', gain, actor._diMax || 100);
  }

  // Ensure DI max from upgrades may be stored; default 100
  actor._diMax = actor._diMax || 100;

  // Signature: persistent tenacity aura (expose for UI)
  actor.customResources['TenacityAura'] = Math.max(0, actor.customResources['TenacityAura'] || 30);

  // Last Stand cooldown tracked
  if (!actor._lastStandCd) actor._lastStandCd = 0;
  actor._lastStandCd = Math.max(0, actor._lastStandCd - dt);
}

export async function getParsedAbility(ability, actor) {
  const name = String(ability.name || '').toLowerCase();

  if (name.includes('basic attack')) {
    return { typeCategory: 'basic', baseDmg: 0, scalePct: 1.0, scaleStat: 'atk', element: 'fire', multiHitCount: 1, cooldown: 2.0, visualKeyword: 'proj_sword' };
  }

  if (name.includes('cover fire')) {
    return {
      typeCategory: 'skill',
      isShield: true,
      shieldPct: 0.15, // 15% max HP
      altShieldPct: 0.30, // if DI consumed
      cooldown: 12,
      duration: 4,
      statuses: [
        { type: 'buff_speed', value: 0.20, duration: 4, name: 'Covered_Speed' },
        { type: 'buff_atk', value: 0.20, duration: 4, name: 'Covered_Atk' }
      ],
      mechanics: { resource: 'Diplomatic Influence', cost: 50, grantsCritOnConsume: 0.10 },
      visualKeyword: 'vfx_shield'
    };
  }

  if (name.includes('blaster barrage')) {
    return {
      typeCategory: 'skill',
      baseDmg: 0,
      scalePct: 0.70,
      scaleStat: 'atk',
      cooldown: 8,
      statuses: [
        { type: 'debuff_def', value: -0.25, duration: 4, name: 'Suppressed' }
      ],
      mechanics: { resource: 'Rebel Coordination', cost: 50, altScalePct: 1.10, altDuration: 7, reduceMagicRes: -0.15 },
      visualKeyword: 'vfx_spark'
    };
  }

  if (name.includes('inspiring presence') || name.includes('hope for the rebellion')) {
    return {
      typeCategory: 'passive',
      statuses: [{ type: 'buff_atk_percent', value: 0.10, duration: Infinity }],
      mechanics: { diGain: 20, diInterval: 8, diMax: 100, extraOnAllyLowHp: 30 }
    };
  }

  if (name.includes("rebelion's resolve".toLowerCase()) || name.includes("rebellion's resolve") || name.includes('rebel') && name.includes('resolve') || (ability.type || '').toLowerCase() === 'ultimate') {
    return {
      typeCategory: 'ultimate',
      isAoE: true,
      cooldown: 75,
      duration: 8,
      enhancedDuration: 12,
      mechanics: { resource: 'Diplomatic Influence', minConsume: 50, consumeAllForExtend: true, extraMagicOnBasicPct: 0.40 },
      statuses: [
        { type: 'buff_attack_speed', value: 0.30, duration: 8 },
        { type: 'buff_def_percent', value: 0.20, duration: 8 }
      ],
      visualKeyword: 'vfx_fire_storm'
    };
  }

  if (name.includes('tenacity of hope') || name.includes('last stand') || (ability.type || '').toLowerCase() === 'signature passive') {
    return {
      typeCategory: 'passive',
      statuses: [{ type: 'buff_tenacity', value: 30, duration: Infinity }],
      mechanics: { onConsumeGrantEvasionPct: 0.15, lastStandShieldPct: 0.20, lastStandCd: 90, auraRadius: 500 }
    };
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

  if (name.includes('cover fire')) {
    if (!primary) return;
    ui.showAbilityName(actor, 'REBEL TACTICS: COVER FIRE');
    // Determine DI and whether to consume for enhanced shield
    const di = Math.floor(actor.getResource ? actor.getResource('Diplomatic Influence') : (actor.customResources?.['Diplomatic Influence']||0));
    const cost = parsed?.mechanics?.cost || 50;
    let shieldPct = parsed?.shieldPct || 0.15;
    if (di >= cost && actor.consumeResource && actor.consumeResource('Diplomatic Influence', cost)) {
      shieldPct = parsed?.altShieldPct || 0.30;
      // grant crit if specified
      primary.applyStatus({ type: 'buff_crit', value: parsed?.mechanics?.grantsCritOnConsume || 0.10, duration: parsed?.duration || 4, name: 'Strategic Advantage' });
      ui.showFloatingText(primary, 'STRATEGIC ADV.', 'status-text buff');
    }
    // Apply shield
    const shieldVal = Math.floor(actor.maxHp * shieldPct);
    primary.applyStatus({ type: 'shield', value: shieldVal, duration: parsed?.duration || 4, name: 'Cover_Shield' });
    // Apply Covered buffs
    parsed?.statuses?.forEach(s => primary.applyStatus({ ...s }));
    ui.playVfx(primary, 'vfx_shield');
    ui.showFloatingText(primary, `SHIELD ${shieldVal}`, 'status-text buff');
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 12;
    return;
  }

  if (name.includes('blaster barrage')) {
    if (!primary) return;
    ui.showAbilityName(actor, 'REBEL COMMAND: BLASTER BARRAGE');
    ui.playVfx(primary, 'vfx-spark');
    await wait(220);
    // Base damage
    const basePct = parsed?.scalePct || 0.7;
    let dmg = Math.floor(actor.effectiveAtk * basePct);
    // Check Rebel Coordination resource
    const coord = Math.floor(actor.getResource ? actor.getResource('Rebel Coordination') : (actor.customResources?.['Rebel Coordination']||0));
    if (coord >= (parsed?.mechanics?.cost || 50) && actor.consumeResource) {
      actor.consumeResource('Rebel Coordination', parsed.mechanics.cost || 50);
      dmg = Math.floor(actor.effectiveAtk * (parsed?.mechanics?.altScalePct || parsed.scalePct || 1.10));
      // extend debuff
      primary.applyStatus({ type: 'debuff_def', value: parsed?.mechanics?.reduceMagicRes ? 0 : -0.25, duration: parsed?.mechanics?.altDuration || 7, name: 'Suppressed' });
      // optionally reduce magic res
      if (parsed?.mechanics?.reduceMagicRes) primary.applyStatus({ type: 'debuff_matk', value: parsed.mechanics.reduceMagicRes, duration: parsed.mechanics.altDuration || 7, name: 'Suppressed_MR' });
    } else {
      primary.applyStatus({ type: 'debuff_def', value: -0.25, duration: parsed?.statuses?.[0]?.duration || 4, name: 'Suppressed' });
    }
    const res = primary.receiveAction({ amount: dmg, type: 'physical', attackerElement: 'physical' });
    ui.showFloatingText(primary, res.amount, 'damage-number');
    ui.playVfx(primary, 'vfx-explosion');
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 8;
    return;
  }

  if (name.includes("rebelion's resolve".toLowerCase()) || name.includes('rebel') && name.includes('resolve') || (ability.type || '').toLowerCase() === 'ultimate') {
    ui.showAbilityName(actor, "REBELLION'S RESOLVE");
    ui.playVfx(actor, 'vfx_fire_storm');
    // Determine if actor will expend all DI for extended duration
    const di = Math.floor(actor.getResource ? actor.getResource('Diplomatic Influence') : (actor.customResources?.['Diplomatic Influence']||0));
    const consumeAll = di >= (parsed?.mechanics?.minConsume || 50) && parsed?.mechanics?.consumeAllForExtend;
    let duration = parsed?.duration || 8;
    if (consumeAll) {
      // consume all DI for extension
      if (actor.consumeResource) actor.consumeResource('Diplomatic Influence', di);
      else actor.customResources['Diplomatic Influence'] = 0;
      duration = parsed?.enhancedDuration || 12;
      // grant CC immunity flag via status
      (decision.targets || []).forEach(t => t.applyStatus({ type: 'buff_cc_immunity', duration, name: "Resolve_Immunity" }));
    } else {
      // if DI present but not full consume scenario, optionally consume minimum
      if (di >= (parsed?.mechanics?.minConsume || 50) && actor.consumeResource) actor.consumeResource('Diplomatic Influence', parsed.mechanics.minConsume || 50);
    }

    // Apply global buffs to allies
    (decision.targets || []).forEach(ally => {
      if (!ally || ally.isDead) return;
      ally.applyStatus({ type: 'buff_attack_speed', value: parsed?.statuses?.[0]?.value || 0.30, duration });
      ally.applyStatus({ type: 'buff_def_percent', value: -(parsed?.statuses?.[1]?.value || -0.20) ? parsed.statuses[1].value : parsed.statuses[1].value, duration });
      // Visual and floating text
      ui.showFloatingText(ally, 'RESOLVE!', 'status-text buff');
    });

    // For the duration, Leia's basics deal extra magic damage equal to parsed.mechanics.extraMagicOnBasicPct * magicAtk
    // Implement by adding a temporary effect on actor
    actor.applyStatus({ type: 'rebels_resolve_basic_bonus', duration, value: parsed?.mechanics?.extraMagicOnBasicPct || 0.40, name: 'Resolve_BasicBonus' });

    actor.energy = 0;
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 75;
    return;
  }

  // Basic attack fallback; if ultimate active bonus present apply extra magic damage
  if (name.includes('basic attack') || decision.type === 'basic') {
    if (!primary) return;
    ui.showAbilityName(actor, 'Basic Attack');
    ui.showProjectile(actor, primary, 'proj_fire');
    await wait(180);
    const parsedBasic = parsed || { scalePct: 1.0, scaleStat: 'atk' };
    const physDmg = Math.floor(actor.effectiveAtk * (parsedBasic.scalePct || 1.0));
    const res = primary.receiveAction({ amount: physDmg, type: 'physical', attackerElement: 'fire' });
    ui.showFloatingText(primary, res.amount, 'damage-number');
    ui.playVfx(primary, 'vfx-slash');

    // Check for Resolve basic bonus (magic extra)
    if (actor.activeEffects.some(e => e.name === 'Resolve_BasicBonus')) {
      const eff = actor.activeEffects.find(e => e.name === 'Resolve_BasicBonus');
      const magicExtra = Math.floor(actor.effectiveMagicAtk * (eff?.value || 0.4));
      if (magicExtra > 0) {
        const r2 = primary.receiveAction({ amount: magicExtra, type: 'magic', attackerElement: 'magic' });
        ui.showFloatingText(primary, r2.amount, 'damage-number magic');
        ui.playVfx(primary, 'vfx-magic');
      }
    }
    // small energy gain
    actor.energy = Math.min(actor.maxEnergy, actor.energy + 10);
    return;
  }

  // Fallback: do nothing
  return;
}