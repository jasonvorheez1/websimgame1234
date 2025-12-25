/*
 Character ability module for export_id "40" (Renji Abarai)
 Exports:
  - getParsedAbility(ability, actor, battle)
  - decideAction(actor, enemies, allies, battle)
  - executeAction(battle, actor, decision, parsed)
  - updatePassives(actor, dt)
*/

function pickRandom(arr){ return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

export async function getParsedAbility(ability, actor, battle){
  const name = (ability && ability.name || '').toLowerCase();
  if (name.includes('zabimaru: roar')) {
    return {
      typeCategory:'skill',
      baseDmgPct: 0.60,
      scaleStat: 'atk',
      element: 'physical',
      targeting: 'single',
      stunDur: 0.75,
      appliesStatus: [{ type:'suppressed', value: -0.10, duration: 3, decayPerSec: 0.0333 }],
      rageGain: 5,
      visualKeyword: 'vfx_sword',
      cooldown: 2.4
    };
  }
  if (name.includes('segmented strike') || name.includes('howl')) {
    return {
      typeCategory:'skill',
      baseDmg: 0, // X handled by engine/overrides
      scalePct: 0.4,
      scaleStat: 'atk',
      element: 'physical',
      targeting: 'cone',
      coneAngleDeg: 180,
      rangeBase: 100,
      rangePerDefPct: 0.2,
      appliesStatus: [{ type:'segmented', stacks:1, duration: 6, description: "next damage causes bleed 3% max HP over 3s" }],
      cooldown: 10,
      visualKeyword: 'vfx_slash'
    };
  }
  if (name.includes('baboon fang bite') || name.includes('higa zekkō')) {
    return {
      typeCategory:'skill',
      baseDmg: 0,
      scalePct: 0.4,
      scaleStat: 'magicAtk',
      element: 'magic',
      targeting: 'area',
      radius: 50,
      stunBase: 1,
      stunIfSegmented: 2,
      enhanceCooldownOnHit: { targetAbility: 'Howl, Zabimaru: Segmented Strike', reduceBy: 1 },
      cooldown: 12,
      visualKeyword: 'vfx_explosion'
    };
  }
  if (name.includes("serpent's resilience")) {
    return {
      typeCategory:'passive',
      mechanics: {
        loyaltyPerAllyHit: 1,
        loyaltyRange: 300,
        loyaltyDuration: 5,
        loyaltyPerStackPct: 0.02,
        loyaltyMaxStacks: 5,
        suppressedOnBasic: { type:'suppressed', value: -0.01, duration: 3, maxStacks:5 }
      }
    };
  }
  if (name.includes('baboon king rampage') || name.includes('hihiō zabimaru') || name.includes('ultimate')) {
    return {
      typeCategory:'ultimate',
      duration: 12,
      basicAsRanged: true,
      basicRange: 400,
      basicScalePct: 0.6,
      applySegmentedOnHit: true,
      damageReductionPct: 0.30,
      endShockwave: { enabled:true, scalePct: 0.4, type:'magic', stun:1.5 },
      visualKeyword: 'vfx_fire_storm',
      cooldown: 90
    };
  }
  if (name.includes('bankai') || name.includes('signature passive')) {
    return {
      typeCategory:'passive',
      mechanics: {
        flatTenacity: 25,
        flatEvasion: 12,
        onStatusBuff: { dmgPct: 0.12, movePct: 0.12, duration: 4.5, cd: 7 }
      }
    };
  }
  return null;
}

export async function decideAction(actor, enemies, allies, battle){
  const liveEnemies = (enemies||[]).filter(e=>!e.isDead);
  const liveAllies = (allies||[]).filter(a=>!a.isDead && a !== actor);
  if (!liveEnemies.length) return { ability: { name: 'Basic Attack' }, targets: [] };

  const find = q => (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes(q));
  const ult = find('baboon king rampage') || find('hihiō zabimaru') || find('ultimate');
  const roar = find('zabimaru: roar');
  const segStrike = find('segmented strike') || find('howl');
  const baboon = find('baboon fang') || find('higa zekkō');
  const basic = (actor.data.abilities||[]).find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };

  // Use ultimate when energy full or multiple enemies clustered
  if (actor.energy >= (actor.maxEnergy || 100) && ult && !actor.cooldownTimers?.[ult.name]) {
    if (liveEnemies.length >= 3) return { ability: ult, type: 'ultimate', targets: liveEnemies.slice(0,6) };
  }

  // If allies take damage recently (Serpent's Resilience stacks), prefer Segmented Strike to mark
  const loyalty = actor.customResources && actor.customResources['Loyalty'] ? actor.customResources['Loyalty'] : 0;
  if (segStrike && !actor.cooldownTimers?.[segStrike.name]) {
    // choose densest cluster center
    let best=null, bestCount=0;
    for (const e of liveEnemies){
      const cnt = liveEnemies.filter(o=>Math.hypot(o.x-e.x,o.y-e.y)<=120).length;
      if (cnt > bestCount){ bestCount = cnt; best = e; }
    }
    if (bestCount >= 2 || loyalty >= 2) return { ability: segStrike, type: 'skill', targets: [best || liveEnemies[0]] };
  }

  // Use Higa Zekkō when primary target is segmented or to stun clustered enemies
  if (baboon && !actor.cooldownTimers?.[baboon.name]) {
    const target = liveEnemies.slice().sort((a,b)=>(a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
    const isSegmented = target && target.activeEffects && target.activeEffects.some(s => s.type === 'segmented');
    if (isSegmented || liveEnemies.length >= 3) return { ability: baboon, type: 'skill', targets: [target] };
  }

  // Use Roar for single-target control or to generate Rage when needing resource
  if (roar && !actor.cooldownTimers?.[roar.name]) {
    const lowAlly = liveAllies.find(a => (a.currentHp / a.maxHp) < 0.45);
    const primary = liveEnemies.slice().sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
    if (lowAlly || actor.getResource && (actor.getResource('Rage') || 0) < 10) return { ability: roar, type: 'skill', targets: [primary] };
  }

  // Fallback: basic attack nearest
  const nearest = liveEnemies.slice().sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
  return { ability: basic, type: 'basic', targets: [nearest] };
}

export async function executeAction(battle, actor, decision, parsed){
  if (!decision || !decision.ability) return;
  const ui = battle.uiManager;
  const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
  const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
  const liveEnemies = enemies.filter(e=>!e.isDead);
  const name = (decision.ability.name||'').toLowerCase();

  // short windup (longer for ultimate)
  await new Promise(r=>setTimeout(r, decision.type === 'ultimate' ? 420 : 160));

  // ZABIMARU: ROAR
  if (name.includes('zabimaru: roar')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 23;
    const dmg = Math.floor(atk * (parsed.baseDmgPct || parsed.baseDmgPct === 0 ? parsed.baseDmgPct : 0.6));
    const res = t.receiveAction({ amount: dmg, type:'physical', element: parsed.element || 'physical', attackerAccuracy: 20 });
    ui.showFloatingText(t, res.amount, 'damage-number');
    // apply stun
    t.applyStatus({ type:'stun', duration: parsed.stunDur || 0.75 });
    // apply suppressed (physical resistance reduction) as vulnerability-like status with decay mechanic
    t.applyStatus({ type:'vulnerability_stack', stacks:1, value: parsed.appliesStatus && parsed.appliesStatus[0] ? Math.abs(parsed.appliesStatus[0].value) : 0.10, duration: parsed.appliesStatus && parsed.appliesStatus[0] ? parsed.appliesStatus[0].duration : 3 });
    // generate Rage
    actor.addResource && actor.addResource('Rage', parsed.rageGain || 5, 999);
    ui.playVfx(t, parsed.visualKeyword || 'vfx_sword');
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 2.4;
    return;
  }

  // HOWL: Zabimaru Segmented Strike (cone AOE)
  if (name.includes('segmented strike') || name.includes('howl')) {
    const center = decision.targets && decision.targets[0] ? decision.targets[0] : actor;
    const def = actor.stats && (actor.stats.def || actor.stats.Def) ? Number(actor.stats.def || actor.stats.Def) : 10;
    const range = Math.floor((parsed.rangeBase || 100) + (def * (parsed.rangePerDefPct || 0.2)));
    const atk = actor.effectiveAtk || actor.stats.atk || 23;
    const dmg = Math.floor((parsed.baseDmg || 0) + atk * (parsed.scalePct || 0.4));
    const hitTargets = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= range);
    hitTargets.forEach(e => {
      const res = e.receiveAction({ amount: dmg, type:'physical', element:'physical', attackerAccuracy: 18 });
      ui.showFloatingText(e, res.amount, 'damage-number');
      // apply "segmented" marker (next damage causes bleed)
      e.applyStatus({ type:'segmented', stacks:1, duration: 6, name: 'Segmented' });
      ui.playVfx(e, parsed.visualKeyword || 'vfx_slash');
    });
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 10;
    return;
  }

  // HIGA ZEKKŌ: Baboon Fang Bite (magic AoE + stun, extended if segmented)
  if (name.includes('baboon fang') || name.includes('higa zekk')) {
    const center = decision.targets && decision.targets[0] ? decision.targets[0] : liveEnemies[0];
    if (!center) return;
    const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 16;
    const dmg = Math.floor((parsed.baseDmg || 0) + matk * (parsed.scalePct || 0.4));
    const radius = parsed.radius || 50;
    const inArea = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= radius);
    inArea.forEach(e => {
      const res = e.receiveAction({ amount: dmg, type:'magic', element:'magic', attackerAccuracy: 18 });
      ui.showFloatingText(e, res.amount, 'damage-number');
      // stun; if primary target segmented, primary stun longer
      const isPrimary = e === center;
      const seg = center.activeEffects && center.activeEffects.some(s => s.type === 'segmented');
      const dur = (isPrimary && seg) ? (parsed.stunIfSegmented || 2) : (parsed.stunBase || 1);
      e.applyStatus({ type:'stun', duration: dur });
      ui.playVfx(e, parsed.visualKeyword || 'vfx_explosion');
    });
    // reduce cooldown of Segmented Strike per enemy hit if upgrade present
    if (parsed.enhanceCooldownOnHit && parsed.enhanceCooldownOnHit.targetAbility) {
      const reduce = parsed.enhanceCooldownOnHit.reduceBy || 0;
      const hits = inArea.length;
      const targetName = parsed.enhanceCooldownOnHit.targetAbility;
      if (hits > 0) {
        if (!actor.cooldownTimers) actor.cooldownTimers = {};
        // find ally ability or self ability and reduce if present (BattleSystem will read cooldownTimers)
        // Here we search actor.cooldownTimers entry and reduce
        if (actor.cooldownTimers && actor.cooldownTimers[targetName]) {
          actor.cooldownTimers[targetName] = Math.max(0, actor.cooldownTimers[targetName] - (reduce * hits));
        }
      }
    }
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 12;
    return;
  }

  // Hihio Zabimaru: Baboon King's Rampage (Ultimate transformation)
  if (name.includes('baboon king rampage') || decision.type === 'ultimate') {
    ui.showAbilityName(actor, decision.ability.name || 'Baboon King Rampage');
    ui.playVfx(actor, parsed.visualKeyword || 'vfx_fire_storm');
    // apply transformation flags: set customResources for engine to interpret basics as ranged
    actor.customResources = actor.customResources || {};
    actor.customResources['BankaiActive'] = parsed.duration || 12;
    // damage reduction
    actor.applyStatus({ type:'buff_def', value: parsed.damageReductionPct || 0.30, duration: parsed.duration || 12 });
    // During duration basic attacks handled by BattleSystem as ranged; here we also apply segmented when basics hit via passive hooking.
    actor.energy = 0;
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 90;

    // schedule end shockwave
    setTimeout(() => {
      if (parsed.endShockwave && parsed.endShockwave.enabled) {
        const center = actor;
        const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 16;
        const dmg = Math.floor((parsed.endShockwave.base || 0) + matk * (parsed.endShockwave.scalePct || 0.4));
        liveEnemies.forEach(e => {
          const dist = Math.hypot(e.x - center.x, e.y - center.y);
          if (dist <= (parsed.endShockwave.radius || 220)) {
            const res = e.receiveAction({ amount: dmg, type: parsed.endShockwave.type || 'magic', element: 'magic', attackerAccuracy: 14 });
            ui.showFloatingText(e, res.amount, 'damage-number crit');
            e.applyStatus({ type:'stun', duration: parsed.endShockwave.stun || 1.5 });
            ui.playVfx(e, 'vfx_explosion');
          }
        });
      }
      // clear bankai flag
      if (actor.customResources) delete actor.customResources['BankaiActive'];
    }, (parsed.duration || 12) * 1000 / Math.max(0.2, (battle.battleSpeed || 1)));

    return;
  }

  // Signature passive activation handled in updatePassives (buff on status affliction) - no explicit executeAction required.

  // Fallback: basic single/nearby hit
  {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 23;
    const dmg = Math.floor(12 + atk * 0.4);
    const res = t.receiveAction({ amount: dmg, type:'physical', element:'physical', attackerAccuracy: 18 });
    ui.showFloatingText(t, res.amount, 'damage-number');
    ui.playVfx(t, 'slash');
    // apply suppressed stack from basic attack passive
    t.applyStatus({ type:'suppressed', value: -0.01, duration: 3, name: 'Suppressed' });
    // On basic hit, generate tiny Loyalty maybe? (main Loyalty gained by nearby ally damage in passives)
    return;
  }
}

export function updatePassives(actor, dt){
  actor.customResources = actor.customResources || {};
  actor.resourceDecayTimers = actor.resourceDecayTimers || {};
  actor.passiveModifiers = actor.passiveModifiers || {};

  // Serpent's Resilience: gain Loyalty when allies nearby take damage
  // This hook expects BattleSystem or receiving logic to call addResource('Loyalty') when ally damaged; as a safety, decay and clamp here
  actor.customResources['Loyalty'] = actor.customResources['Loyalty'] || 0;
  actor.resourceDecayTimers['Loyalty'] = actor.resourceDecayTimers['Loyalty'] || 0;
  // decay timer reduces stacks over time
  if (actor.resourceDecayTimers['Loyalty'] > 0) {
    actor.resourceDecayTimers['Loyalty'] = Math.max(0, actor.resourceDecayTimers['Loyalty'] - dt);
  } else if (actor.customResources['Loyalty'] > 0) {
    // natural decay of 1 stack per second after duration
    actor.customResources['Loyalty'] = Math.max(0, actor.customResources['Loyalty'] - (1 * dt));
  }

  // Translate Loyalty stacks into Armor/MagicResist buffs
  const loyaltyStacks = Math.floor(actor.customResources['Loyalty'] || 0);
  const mech = (actor.data.abilities||[]).find(a=> (a.name||'').toLowerCase().includes("serpent's resilience"));
  const perStack = mech && mech.mechanics ? (mech.mechanics.loyaltyPerStackPct || 0.02) : 0.02;
  const maxStacks = mech && mech.mechanics ? (mech.mechanics.loyaltyMaxStacks || 5) : 5;
  const stacksClamped = Math.min(maxStacks, loyaltyStacks);
  actor.passiveModifiers.armorFromLoyalty = stacksClamped * perStack;
  actor.passiveModifiers.magicResFromLoyalty = stacksClamped * perStack;

  // Signature: when afflicted by a status, grant temporary buff (12% dmg & 12% move) once per cooldown
  actor.customResources['BankaiSigCd'] = actor.customResources['BankaiSigCd'] || 0;
  if (actor.customResources['BankaiSigCd'] > 0) {
    actor.customResources['BankaiSigCd'] = Math.max(0, actor.customResources['BankaiSigCd'] - dt);
  }
  // detect new negative status presence
  const hasNeg = actor.activeEffects && actor.activeEffects.some(e => ['stun','freeze','burn','poison','silence','root','blind','charm'].includes(e.type));
  if (hasNeg && (!actor._sigRecentlyTriggered) && (actor.customResources['BankaiSigCd'] <= 0)) {
    // apply buff
    actor.applyStatus({ type:'buff_atk', value: 0.12, duration: 4.5, name: 'Bankai Fury' });
    actor.applyStatus({ type:'buff_speed', value: 0.12, duration: 4.5, name: 'Bankai Haste' });
    actor.customResources['BankaiSigCd'] = 7.0;
    actor._sigRecentlyTriggered = true;
    setTimeout(()=>{ actor._sigRecentlyTriggered = false; }, 4500);
  }

  // Ensure clip bounds for Loyalty
  actor.customResources['Loyalty'] = Math.max(0, Math.min( (mech && mech.mechanics && mech.mechanics.loyaltyMaxStacks) || 5, Math.floor(actor.customResources['Loyalty'] || 0) ));
}