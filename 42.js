/*
  Character ability module for export_id "42" (Ellen)
  Exports:
    - getParsedAbility(ability, actor, battle)
    - decideAction(actor, enemies, allies, battle)
    - executeAction(battle, actor, decision, parsed)
    - updatePassives(actor, dt)
  Notes: Implements Basic Attack (Ice), Searing Strike (Electric + shield utility),
         Glacial Scythe Strike (dash AOE consuming Flash Freeze charges), passive Icy Veins,
         Ultimate Sharknami behavior, and Quick Charge signature interactions.
*/

function pickRandom(arr){ return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

export async function getParsedAbility(ability, actor, battle){
  const name = (ability && ability.name || '').toLowerCase();
  if(name.includes('basic attack')){
    return {
      typeCategory: 'basic',
      baseDmg: 18,
      scalePct: 0.28,
      scaleStat: 'atk',
      element: 'ice',
      targeting: 'single',
      multiHitCount: 1,
      visualKeyword: 'vfx_ice',
      cooldown: 1.4
    };
  }
  if(name.includes('searing strike')){
    return {
      typeCategory: 'skill',
      baseDmg: 110,
      scalePct: 0.7,
      scaleStat: 'atk',
      element: 'electric',
      targeting: 'single',
      visualKeyword: 'vfx_lightning',
      cooldown: 10,
      mechanics: { grantsShieldPct: 0.12 } // support utility
    };
  }
  if(name.includes('glacial scythe')){
    return {
      typeCategory: 'skill',
      baseDmg: 140,
      scalePct: 0.9,
      scaleStat: 'atk',
      element: 'ice',
      targeting: 'aoe',
      multiHitCount: 1,
      radius: 160,
      visualKeyword: 'vfx_slash_heavy',
      cooldown: 12,
      mechanics: { isDash: true, consumesFlashPerStackPct: 0.15, applyIceVulnPct: 0.10, flashPerConsumeHealPct: 0.05 }
    };
  }
  if(name.includes('icy veins') || name.includes('thiren resilience')){
    return {
      typeCategory: 'passive',
      mechanics: {
        ccReductionPct: 0.20,
        gainPerIceHitPctAtk: 0.02,
        maxStacks: 10,
        stackDuration: 5
      }
    };
  }
  if(name.includes('sharknami') || name.includes('endless winter')){
    return {
      typeCategory: 'ultimate',
      duration: 10,
      atkSpeedPct: 0.50,
      moveSpeedPct: 0.30,
      extraIceDmgPct: 0.20,
      flashRegenMultiplier: 2,
      flashConsumeHealPct: 0.05,
      visualKeyword: 'vfx_fire_storm',
      cooldown: 90
    };
  }
  if(name.includes('quick charge')){
    return {
      typeCategory: 'signature',
      mechanics: {
        duration: 5,
        tenacityAdd: 20,
        evasionAdd: 15,
        instantArcticReady: true,
        grantFlashOnExpire: 2,
        shieldOnActivatePct: 0.10
      }
    };
  }
  return null;
}

export async function decideAction(actor, enemies, allies, battle){
  const liveEnemies = (enemies||[]).filter(e=>!e.isDead);
  if (!liveEnemies.length) return { ability: { name: 'Basic Attack' }, targets: [] };

  const find = q => (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes(q));
  const ult = find('sharknami') || find('endless winter');
  const scythe = find('glacial scythe');
  const sear = find('searing strike');
  const basic = (actor.data.abilities||[]).find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };

  // Use ultimate when energy full or when multiple enemies alive and flash charges available
  if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
    if (liveEnemies.length >= 3) return { ability: ult, type: 'ultimate', targets: liveEnemies.slice(0,6) };
  }

  // Glacial Scythe: prefer when you can engage (dash) and hit 2+ enemies or to consume flashes on low HP group
  if (scythe && !actor.cooldownTimers?.[scythe.name]) {
    let best=null, bestCount=0;
    for (const e of liveEnemies){
      const cnt = liveEnemies.filter(o=>Math.hypot(o.x-e.x,o.y-e.y)<=160).length;
      if (cnt > bestCount){ bestCount = cnt; best = e; }
    }
    if (bestCount >= 2) return { ability: scythe, type: 'skill', targets: [best] };
    // if single enemy low hp, use scythe as finisher
    const low = liveEnemies.sort((a,b)=>(a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
    if (low && (low.currentHp/low.maxHp) < 0.35) return { ability: scythe, type: 'skill', targets: [low] };
  }

  // Searing Strike: reliable single-target to finish or grant shield to self
  if (sear && !actor.cooldownTimers?.[sear.name]) {
    const target = liveEnemies.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
    if (target && (target.currentHp/target.maxHp) < 0.6) return { ability: sear, type: 'skill', targets: [target] };
  }

  // Fallback basic nearest or ranged priority
  const nearest = liveEnemies.sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
  return { ability: basic, type: 'basic', targets: [nearest] };
}

export async function executeAction(battle, actor, decision, parsed) {
  if (!decision || !decision.ability) return;
  const ui = battle.uiManager;
  const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
  const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
  const liveEnemies = enemies.filter(e=>!e.isDead);
  const name = (decision.ability.name||'').toLowerCase();

  // Windup
  await new Promise(r => setTimeout(r, (decision.type === 'ultimate') ? 360 : 160));

  // BASIC
  if (name.includes('basic attack')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 48;
    const dmg = Math.floor((parsed.baseDmg || 18) + atk * (parsed.scalePct || 0.28));
    const res = t.receiveAction({ amount: dmg, type: 'physical', element: 'ice', attackerAccuracy: 20 });
    ui.showFloatingText(t, res.amount, 'damage-number');
    ui.playVfx(t, parsed.visualKeyword || 'vfx_ice');
    // grant Icy Veins stack on dealing Ice damage
    actor.applyStatus && actor.applyStatus({ type: 'IcyVeinsStack', duration: parsed.mechanics?.stackDuration || 5, value: parsed.mechanics?.gainPerIceHitPctAtk || 0.02 });
    return;
  }

  // SEARING STRIKE
  if (name.includes('searing strike')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 48;
    const base = parsed.baseDmg || 110;
    const dmg = Math.floor(base + atk * (parsed.scalePct || 0.7));
    const res = t.receiveAction({ amount: dmg, type: 'magic', element: 'electric', attackerAccuracy: 22 });
    ui.showFloatingText(t, res.amount, 'damage-number');
    // grant shield to Ellen based on mechanics.grantsShieldPct
    const shPct = (parsed.mechanics && parsed.mechanics.grantsShieldPct) || 0.12;
    const shieldAmt = Math.floor((actor.maxHp || actor.stats["max hp"] || 449) * shPct);
    actor.receiveAction && actor.receiveAction({ amount: shieldAmt, effectType: 'shield' });
    ui.showFloatingText(actor, `SHIELD ${shieldAmt}`, 'status-text buff');
    ui.playVfx(t, parsed.visualKeyword || 'vfx_lightning');
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 10;
    return;
  }

  // GLACIAL SCYTHE STRIKE (dash + aoe + consume Flash Freeze charges)
  if (name.includes('glacial scythe')) {
    const center = decision.targets && decision.targets[0] ? decision.targets[0] : liveEnemies[0];
    if (!center) return;
    // dash pseudo: reposition actor near center
    try {
      const dx = center.x - actor.x; const dy = center.y - actor.y; const dist = Math.hypot(dx, dy) || 1;
      const dashDist = Math.min(180, Math.max(60, dist - 20));
      actor.x += (dx / dist) * dashDist;
      actor.y += (dy / dist) * Math.max(0.1, dashDist * 0.12);
    } catch (e){}
    ui.playVfx(actor, parsed.visualKeyword || 'vfx_slash_heavy');
    await new Promise(r=>setTimeout(r, 120));
    const flashCharges = actor.getResource ? actor.getResource('Flash Freeze') : (actor.customResources?.['Flash Freeze'] || 0);
    // damage scales with consumed charges
    const consume = Math.min( Math.floor(flashCharges), 5 );
    if (consume > 0 && actor.consumeResource) actor.consumeResource('Flash Freeze', consume); else if (consume>0) actor.customResources['Flash Freeze'] = Math.max(0, (actor.customResources['Flash Freeze']||0) - consume);
    const atk = actor.effectiveAtk || actor.stats.atk || 48;
    const base = parsed.baseDmg || 140;
    const bonusPct = (parsed.mechanics && parsed.mechanics.consumesFlashPerStackPct) || 0.15;
    const totalDmg = Math.floor((base + atk * (parsed.scalePct || 0.9)) * (1 + consume * bonusPct));
    const radius = parsed.radius || 160;
    const targets = liveEnemies.filter(e => Math.hypot(e.x - actor.x, e.y - actor.y) <= radius);
    for (const t of targets) {
      const res = t.receiveAction({ amount: totalDmg, type: 'magic', element: 'ice', attackerAccuracy: 20 });
      ui.showFloatingText(t, res.amount, 'damage-number');
      // apply Ice Vulnerability (reduces ice resistance represented as vulnerability_stack)
      t.applyStatus({ type: 'vulnerability_stack', stacks: 1, value: parsed.mechanics?.applyIceVulnPct || 0.10, duration: 4 });
      // if consumed charges -> heal Ellen per spec: each consumed heals 5% max HP (mechanic in description for ultimate/consume, also apply small here)
      if (consume > 0) {
        const healAmt = Math.floor((actor.maxHp || actor.stats["max hp"] || 449) * (parsed.mechanics?.flashPerConsumeHealPct || 0.05) * consume);
        actor.receiveAction && actor.receiveAction({ amount: healAmt, effectType: 'heal' });
        ui.showFloatingText(actor, `+${healAmt}`, 'damage-number heal');
      }
      ui.playVfx(t, 'vfx_ice_shatter');
    }
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 12;
    return;
  }

  // SHARKNAMI: ULTIMATE
  if (name.includes('sharknami') || decision.type === 'ultimate') {
    ui.showAbilityName(actor, decision.ability.name || 'Sharknami');
    ui.playVfx(actor, parsed.visualKeyword || 'vfx_fire_storm');
    // Apply temporary buffs: attack speed & move speed, extra ice damage percent, faster flash regen
    actor.applyStatus({ type: 'buff_atk_speed', value: parsed.atkSpeedPct || 0.50, duration: parsed.duration || 10 });
    actor.applyStatus({ type: 'buff_speed', value: parsed.moveSpeedPct || 0.30, duration: parsed.duration || 10 });
    actor.applyStatus({ type: 'buff_ice_extra', value: parsed.extraIceDmgPct || 0.20, duration: parsed.duration || 10 });
    // accelerate Flash Freeze regen: emulate by adding resources over time
    const regenMult = parsed.flashRegenMultiplier || 2;
    const ticks = Math.max(1, parsed.duration || 10);
    let tick = 0;
    const freq = 1000 / Math.max(0.2, (battle.battleSpeed || 1));
    const regenLoop = setInterval(() => {
      tick++;
      // grant 1 Flash Freeze per tick * regenMult (rounded)
      const grant = Math.max(1, Math.floor(1 * regenMult));
      actor.addResource && actor.addResource('Flash Freeze', grant, 99);
      // healing on consume will be handled during consumption, here we just regen
      if (tick >= ticks) clearInterval(regenLoop);
    }, freq);
    // Optionally reduce enemy defenses during ultimate if parsed upgrades indicate
    if (parsed.mechanics && parsed.mechanics.reduceEnemyDefDuring) {
      const radius = parsed.radius || 300;
      const enemiesIn = liveEnemies.filter(e => Math.hypot(e.x - actor.x, e.y - actor.y) <= radius);
      for (const e of enemiesIn) {
        e.applyStatus({ type: 'debuff_def', duration: parsed.duration || 10, value: -(parsed.mechanics.reduceEnemyDefDuring || 0.15) });
      }
    }
    // final behavior on end (if highest upgrades consumed) is left to BattleSystem timers or parsed.flags; reduce energy and set cooldown
    actor.energy = 0;
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 90;
    return;
  }

  // Signature Quick Charge not directly castable; fallback does nothing
  return;
}

export function updatePassives(actor, dt){
  actor.customResources = actor.customResources || {};
  actor.resourceDecayTimers = actor.resourceDecayTimers || {};
  actor.passiveModifiers = actor.passiveModifiers || {};

  // Icy Veins stacks: track IcyVeinsStack activeEffects and compute attack buff
  const stacks = (actor.activeEffects || []).reduce((s,e)=>{
    if ((e.type||'').toLowerCase() === 'icyveinsstack' || (e.type||'').toLowerCase() === 'icyveinsstack') return s + (e.value || 1);
    // support passive name variation
    if ((e.type||'').toLowerCase() === 'icyveinsstack' || e.name === 'IcyVeinsStack') return s + (e.value || 1);
    return s;
  }, 0);
  const parsedPassive = actor.data.abilities?.find(a => (a.name||'').toLowerCase().includes('icy veins') || (a.name||'').toLowerCase().includes('thiren'));
  const per = parsedPassive?.mechanics?.gainPerIceHitPctAtk || 0.02;
  const maxStacks = parsedPassive?.mechanics?.maxStacks || 10;
  const effective = Math.min(maxStacks, stacks);
  actor.passiveModifiers.icyVeinsAtkPct = effective * per;
  // CC reduction
  actor.passiveModifiers.ccReductionPct = parsedPassive?.mechanics?.ccReductionPct || 0.20;

  // Quick Charge tracking: maintain resource timer and apply base tenacity/evasion bonuses while active
  const qc = (actor.customResources && actor.customResources['QuickChargeActive']) || 0;
  if (qc > 0) {
    actor.passiveModifiers.quickChargeTenacity = 20;
    actor.passiveModifiers.quickChargeEvasion = 15;
    // decay timer
    actor.customResources['QuickChargeActive'] = Math.max(0, qc - dt);
  } else {
    delete actor.passiveModifiers.quickChargeTenacity;
    delete actor.passiveModifiers.quickChargeEvasion;
  }

  // Expire customResources timers
  for (const k in actor.resourceDecayTimers) {
    actor.resourceDecayTimers[k] = Math.max(0, (actor.resourceDecayTimers[k] || 0) - dt);
  }

  // Clean up stacked effects older than their duration is handled by Character.update()
}