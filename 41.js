/*
  Character ability module for export_id "41" (Goku)
  Exports:
    - getParsedAbility(ability, actor, battle)
    - decideAction(actor, enemies, allies, battle)
    - executeAction(battle, actor, decision, parsed)
    - updatePassives(actor, dt)
*/

function pickRandom(arr){ return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

export async function getParsedAbility(ability, actor, battle){
  const name = (ability && ability.name||'').toLowerCase();
  const lvl = (actor.data.skills && actor.data.skills[ability.name]) || 1;

  if (name.includes('basic attack')) {
    return {
      typeCategory: 'basic',
      baseDmg: 20,
      scalePct: 0.35 + (lvl >= 100 ? 0.15 : 0),
      scaleStat: 'atk',
      element: 'fire',
      targeting: 'single',
      visualKeyword: 'vfx_fire',
      cooldown: 1.4
    };
  }

  if (name.includes('kamehameha')) {
    const isSSJ3 = actor.customResources?.['SSJ_Tier'] >= 3;
    return {
      typeCategory: 'skill',
      baseDmg: 0,
      scalePct: 1.8,
      scaleStat: 'magicAtk',
      element: 'fire',
      targeting: 'single',
      chargeTimeMax: lvl >= 25 ? 4.0 : 3.0,
      kiBurnDmgPct: lvl >= 25 ? 0.15 : 0.10,
      stunChance: lvl >= 75 ? 0.20 : 0,
      weakenedDefPct: lvl >= 175 ? 0.15 : 0,
      isInstant: isSSJ3 && lvl >= 200,
      visualKeyword: 'vfx_beam',
      cooldown: 12
    };
  }

  if (name.includes('afterimage')) {
    return {
      typeCategory: 'skill',
      baseDmg: 0,
      scalePct: 1.0,
      scaleStat: 'atk',
      element: 'physical',
      targeting: 'single',
      afterimageCount: 3,
      afterimageDmgPct: lvl >= 30 ? 0.25 : 0.20,
      bleedChance: lvl >= 80 ? 0.25 : 0.15,
      bleedDmgPct: lvl >= 80 ? 0.07 : 0.05,
      slowPct: lvl >= 130 ? 0.10 : 0,
      dashDistMult: lvl >= 180 ? 1.2 : 1.0,
      isSSJ2GuaranteedCrit: (actor.customResources?.['SSJ_Tier'] >= 2 && lvl >= 200),
      visualKeyword: 'vfx_dash',
      cooldown: 8
    };
  }

  if (name.includes('super saiyan transformation')) {
    const tier = actor.customResources?.['SSJ_Tier'] || 0;
    return {
      typeCategory: 'ultimate',
      tier: tier + 1,
      cost: tier === 0 ? 100 : 150,
      duration: lvl >= 150 ? 30 : 15,
      atkBonus: tier === 0 ? (lvl >= 50 ? 0.25 : 0.20) : (lvl >= 50 ? 0.40 : 0.35),
      speedBonus: tier === 0 ? (lvl >= 50 ? 0.20 : 0.15) : (lvl >= 50 ? 0.35 : 0.30),
      defBonus: tier === 0 ? (lvl >= 50 ? 0.12 : 0.10) : (lvl >= 50 ? 0.27 : 0.25),
      healPct: lvl >= 100 ? 0.05 : 0,
      visualKeyword: 'vfx_holy_light',
      cooldown: 5
    };
  }

  if (name.includes('unbreakable will')) {
    return {
      typeCategory: 'passive',
      tenacityBonus: lvl >= 60 ? 0.25 : 0.20,
      lastStandThreshold: 0.30,
      lastStandDef: 0.30,
      lastStandDur: 3,
      lastStandCooldown: lvl >= 110 ? 40 : 45,
      lastStandHealMissing: lvl >= 160 ? 0.08 : 0,
      lastStandSaiyanPower: lvl >= 200 ? 50 : 0
    };
  }

  return null;
}

export async function decideAction(actor, enemies, allies, battle){
  const liveEnemies = (enemies||[]).filter(e=>!e.isDead);
  if (!liveEnemies.length) return { ability: { name: 'Basic Attack' }, targets: [] };

  const find = q => (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes(q));
  const ult = find('super saiyan');
  const kame = find('kamehameha');
  const dash = find('afterimage');
  const basic = (actor.data.abilities||[]).find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };

  const saiyanPower = actor.getResource ? actor.getResource('Saiyan Power') : (actor.customResources?.['Saiyan Power']||0);
  const ssjTier = actor.customResources?.['SSJ_Tier'] || 0;

  // Ultimate: Transform if we have enough power
  if (ult && saiyanPower >= 100 && ssjTier < 3) {
      return { ability: ult, type: 'ultimate', targets: [actor] };
  }

  // Kamehameha: prefer if SSJ3 (instant) or high magic potential
  if (kame && !actor.cooldownTimers?.[kame.name]) {
      const target = liveEnemies.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
      if (target) return { ability: kame, type: 'skill', targets: [target] };
  }

  // Afterimage: prioritize distance closing or finishers
  if (dash && !actor.cooldownTimers?.[dash.name]) {
      const target = liveEnemies[0];
      return { ability: dash, type: 'skill', targets: [target] };
  }

  return { ability: basic, type: 'basic', targets: [liveEnemies[0]] };
}

export async function executeAction(battle, actor, decision, parsed){
  if (!decision || !decision.ability) return;
  const ui = battle.uiManager;
  const name = (decision.ability.name||'').toLowerCase();
  const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
  const liveEnemies = enemies.filter(e=>!e.isDead);

  // Small pause for timing
  await new Promise(r=>setTimeout(r, decision.type === 'ultimate' ? 500 : 120));

  if (name.includes('basic attack')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 82;
    const dmg = Math.floor((parsed.baseDmg || 20) + atk * (parsed.scalePct || 0.35));
    const res = t.receiveAction({ amount: dmg, type: 'physical', element: 'fire', attackerAccuracy: 22 });
    ui.showFloatingText(t, res.amount, 'damage-number fire');
    ui.playVfx(t, 'vfx_fire');
    ui.playSound('hit');
    // Generate Saiyan Power during SSJ
    if (actor.customResources?.['SSJ_Tier'] > 0) actor.addResource?.('Saiyan Power', 5);
    return;
  }

  if (name.includes('kamehameha')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    
    const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 23;
    let chargeTime = parsed.isInstant ? parsed.chargeTimeMax : 0;
    
    if (!parsed.isInstant) {
        ui.showFloatingText(actor, "CHARGING...", "status-text buff");
        ui.playSound('beam_charge');
        ui.playVfx(actor, 'vfx_arcane_circle');
        // Simple charge wait
        await new Promise(r => setTimeout(r, (parsed.chargeTimeMax || 3) * 500)); // Half-time for game feel
        chargeTime = parsed.chargeTimeMax;
    } else {
        // Instant consume
        actor.consumeResource?.('Saiyan Power', Math.floor(actor.getResource('Saiyan Power') * 0.1));
    }

    const chargeMult = chargeTime / (parsed.chargeTimeMax || 3);
    const baseDmg = Math.floor(matk * (parsed.scalePct || 1.8) * chargeMult);
    
    ui.playSound('beam_fire');
    ui.playVfx(actor, { key: 'vfx_beam', scale: 1.5 });
    
    const res = t.receiveAction({ amount: baseDmg, type: 'magic', element: 'fire', attackerAccuracy: 25 });
    ui.showFloatingText(t, res.amount, 'damage-number fire crit');
    ui.playVfx(t, 'vfx_explosion');

    if (chargeTime >= (parsed.chargeTimeMax || 3)) {
        t.applyStatus({ type: 'burn', duration: 3, value: Math.floor(res.amount * (parsed.kiBurnDmgPct || 0.10)), name: 'Ki Burn' });
        if (parsed.stunChance > 0 && Math.random() < parsed.stunChance) t.applyStatus({ type: 'stun', duration: 0.5 });
        if (parsed.weakenedDefPct > 0) t.applyStatus({ type: 'debuff_def', duration: 5, value: -parsed.weakenedDefPct });
        actor.addResource?.('Saiyan Power', 20); // Passive LV200
    }

    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 12;
    return;
  }

  if (name.includes('afterimage')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;

    ui.playSound('wind_whirl');
    ui.playVfx(actor, 'vfx_dash');
    
    const atk = actor.effectiveAtk || actor.stats.atk || 82;
    const images = parsed.afterimageCount || 3;
    const imgDmg = Math.floor(atk * (parsed.afterimageDmgPct || 0.20));

    // Afterimage strikes
    for (let i = 0; i < images; i++) {
        await new Promise(r => setTimeout(r, 100));
        ui.playVfx(t, 'vfx_slash');
        ui.playSound('slash');
        const res = t.receiveAction({ amount: imgDmg, type: 'physical', attackerAccuracy: 20 });
        ui.showFloatingText(t, res.amount, 'damage-number');
        if (parsed.slowPct > 0) t.applyStatus({ type: 'debuff_speed', duration: 2, value: parsed.slowPct });
    }

    // Main Strike
    await new Promise(r => setTimeout(r, 150));
    const mainDmg = Math.floor(atk * (parsed.scalePct || 1.0));
    const isCrit = parsed.isSSJ2GuaranteedCrit || Math.random() < (actor.stats.luck / 100);
    const res = t.receiveAction({ amount: mainDmg, type: 'physical', isCrit, attackerAccuracy: 30 });
    ui.showFloatingText(t, res.amount, 'damage-number crit');
    ui.playVfx(t, 'vfx_slash_heavy');
    ui.playSound('crit');

    if (Math.random() < (parsed.bleedChance || 0.15)) {
        t.applyStatus({ type: 'bleed', duration: 3, value: Math.floor(res.amount * (parsed.bleedDmgPct || 0.05)) });
    }
    
    // Deep Wound from SSJ2
    if (actor.customResources?.['SSJ_Tier'] >= 2 && actor.level >= 200) {
        t.applyStatus({ type: 'silence', duration: 3, name: 'Deep Wound' }); // using silence to represent anti-heal/utility
    }

    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 8;
    return;
  }

  if (name.includes('super saiyan')) {
      const tier = actor.customResources?.['SSJ_Tier'] || 0;
      actor.customResources['SSJ_Tier'] = tier + 1;
      
      ui.playSound('ultimate');
      ui.announce(`SUPER SAIYAN ${tier + 1}!`);
      ui.playVfx(actor, 'vfx_holy_light');
      
      const dur = parsed.duration || 15;
      actor.applyStatus({ type: 'buff_atk', value: parsed.atkBonus, duration: dur, name: 'SSJ Atk' });
      actor.applyStatus({ type: 'buff_speed', value: parsed.speedBonus, duration: dur, name: 'SSJ Speed' });
      actor.applyStatus({ type: 'buff_def', value: parsed.defBonus, duration: dur, name: 'SSJ Def' });
      
      if (parsed.healPct > 0) {
          const heal = Math.floor(actor.maxHp * parsed.healPct);
          actor.receiveAction({ amount: heal, effectType: 'heal' });
          ui.showFloatingText(actor, `+${heal}`, 'damage-number heal');
      }

      actor.consumeResource?.('Saiyan Power', parsed.cost);
      actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 5;
      return;
  }
}

export function updatePassives(actor, dt){
  actor.customResources = actor.customResources || {};
  actor.passiveModifiers = actor.passiveModifiers || {};
  
  // Unbreakable Will
  const lvl = actor.level || 1;
  actor.passiveModifiers.saiyanTenacity = lvl >= 60 ? 0.25 : 0.20;
  
  const hpPct = actor.currentHp / actor.maxHp;
  if (hpPct < 0.30 && !actor.cooldownTimers?.['_lastStand']) {
      ui.playSound('shield');
      actor.applyStatus({ type: 'buff_def', value: 0.30, duration: 3, name: 'Last Stand' });
      actor.applyStatus({ type: 'invulnerability', duration: 3 }); // CC immunity
      actor.cooldownTimers['_lastStand'] = lvl >= 110 ? 40 : 45;
      
      if (lvl >= 160) {
          const missing = actor.maxHp - actor.currentHp;
          actor.receiveAction({ amount: Math.floor(missing * 0.08), effectType: 'heal' });
      }
      if (lvl >= 200) actor.addResource?.('Saiyan Power', 50);
  }

  // Saiyan Body Adaptation (Resource Management)
  // Logic handled partially by BattleSystem (resourceGain), here we handle decay.
  if (!actor._combatTimer) actor._combatTimer = 0;
  actor._combatTimer += dt;
  
  if (actor._combatTimer > 5.0) {
      const decay = lvl >= 90 ? 1.5 : 2.0;
      actor.customResources['Saiyan Power'] = Math.max(0, (actor.customResources['Saiyan Power'] || 0) - decay * dt);
  }
  
  // LV 140 Bonus
  if (lvl >= 140 && (actor.customResources['Saiyan Power'] > 50)) {
      actor.passiveModifiers.saiyanAtk = 0.05;
      actor.passiveModifiers.saiyanMatk = 0.05;
  } else {
      delete actor.passiveModifiers.saiyanAtk;
      delete actor.passiveModifiers.saiyanMatk;
  }
}