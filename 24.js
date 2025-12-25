/*
  Local custom ability module for export_id 24 (Darth Vader).
  Implements: decideAction, getParsedAbility, executeAction, updatePassives
*/

export async function decideAction(actor, enemies = [], allies = [], battle) {
  const liveEnemies = enemies.filter(e => !e.isDead);
  const liveAllies = allies.filter(a => !a.isDead && a !== actor);
  if (liveEnemies.length === 0) return { ability: { name: 'Basic Attack' }, type: 'basic', targets: [] };

  // If ultimate ready and clustered, use ultimate
  const ult = (actor.data?.abilities || []).find(a => String(a.type || '').toLowerCase() === 'ultimate' || (a.name||'').toLowerCase().includes('ultimate'));
  if (ult && actor.energy >= actor.maxEnergy && !actor.cooldownTimers?.[ult.name]) {
    // choose cluster center
    const center = liveEnemies.sort((a,b)=> {
      const ca = liveEnemies.reduce((s,e)=> s + (Math.hypot(e.x-a.x,e.y-a.y) < 160 ? 1:0),0);
      const cb = liveEnemies.reduce((s,e)=> s + (Math.hypot(e.x-b.x,e.y-b.y) < 160 ? 1:0),0);
      return cb - ca;
    })[0] || liveEnemies[0];
    return { ability: ult, type: 'ultimate', targets: center ? [center] : liveEnemies.slice(0,3) };
  }

  // If Deflecting Strikes available and actor is low HP or facing many melee threats, use defensively
  const shieldSkill = (actor.data?.abilities || []).find(a => (a.name||'').toLowerCase().includes('deflecting'));
  if (shieldSkill && !actor.cooldownTimers?.[shieldSkill.name]) {
    const meleeThreats = liveEnemies.filter(e => e.isRanged !== true && Math.hypot(e.x-actor.x,e.y-actor.y) < 200);
    if ((actor.currentHp / actor.maxHp) < 0.7 || meleeThreats.length >= 2) return { ability: shieldSkill, type: 'skill', targets: [actor] };
  }

  // If Crush (channel) available and a high-value target exists, use it to control casters or heavy hitters
  const crush = (actor.data?.abilities || []).find(a => (a.name||'').toLowerCase().includes('crush: unyielding power') || (a.name||'').toLowerCase().includes('crush'));
  if (crush && !actor.cooldownTimers?.[crush.name]) {
    // prefer highest atk enemy
    const priority = liveEnemies.sort((a,b)=> (b.stats?.atk||0) - (a.stats?.atk||0))[0];
    if (priority) return { ability: crush, type: 'skill', targets: [priority] };
  }

  // If Boundless Rage passive ready to convert hatred (module passive handles consume), try to bait hits (no action)

  // Fallback: use Crushing Blow if available and in melee range, else basic
  const crushBlow = (actor.data?.abilities || []).find(a => (a.name||'').toLowerCase().includes('crushing blow'));
  const basic = (actor.data?.abilities || []).find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };
  if (crushBlow && !actor.cooldownTimers?.[crushBlow.name]) {
    // prefer nearest enemy
    const nearest = liveEnemies.sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
    return { ability: crushBlow, type: 'skill', targets: [nearest] };
  }

  return { ability: basic, type: 'basic', targets: [ liveEnemies[0] ] };
}

export function updatePassives(actor, dt) {
  if (actor.isDead) return;
  // Boundless Rage: grant Hatred when taking large hits (engine apply will call addResource elsewhere)
  // Ensure customResources Hatred exists and clamp
  if (!actor.customResources) actor.customResources = {};
  actor.customResources['Hatred'] = Math.max(0, Math.min(10, actor.customResources['Hatred'] || 0));
  // Small decay safeguard: if not recently changed, slowly decay 0.5 per 2s
  if (!actor._hatredDecayTimer) actor._hatredDecayTimer = 0;
  actor._hatredDecayTimer += dt;
  if (actor._hatredDecayTimer >= 2.0) {
    actor._hatredDecayTimer = 0;
    if ((actor.customResources['Hatred'] || 0) > 0) actor.customResources['Hatred'] = Math.max(0, actor.customResources['Hatred'] - 0.5);
  }

  // Dark Resilience: cooldown tracker for CC reduction
  if (!actor._darkResCooldown) actor._darkResCooldown = 0;
  actor._darkResCooldown = Math.max(0, actor._darkResCooldown - dt);
}

export async function getParsedAbility(ability, actor) {
  const name = String(ability.name || '').toLowerCase();
  if (name.includes('crushing blow')) {
    return { typeCategory: 'skill', baseDmg: 0, scalePct: 1.0, scaleStat: 'atk', element: 'physical', multiHitCount:1, cooldown:3, isCleave:true, cleavePct:0.4, statuses:[{type:'buff_def', value: -0, duration:2, name:'Crushing_Reduction'}], visualKeyword:'sword' };
  }
  if (name.includes('crush: unyielding power') || name.includes('crush:')) {
    return { typeCategory:'skill', isChannel:true, channelDuration:3, baseDmg:0, scalePct:0.9, scaleStat:'magicAtk', element:'dark', cooldown:10, statuses:[{type:'debuff_speed', value:0.30, duration:3}], mechanics:{generateHatredPerSec:2, consumeHatredStun:5}, visualKeyword:'vfx_dark_void' };
  }
  if (name.includes('deflecting strikes')) {
    return { typeCategory:'skill', isShield:true, baseDmg:0, scalePct:0, scaleStat:'def', element:'light', cooldown:18, statuses:[{type:'shield', duration:5, value:'def_scale'}, {type:'reflect_melee_pct', value:0.5, duration:5}], visualKeyword:'vfx_shield' };
  }
  if (name.includes('boundless rage')) {
    return { typeCategory:'passive', statuses:[{type:'buff_def_percent', duration:Infinity, value:0.10}, {type:'buff_matk_percent', duration:Infinity, value:0.10}], mechanics:{hatredGainThresholdPct:0.05, hatredMax:10, fullConsumeShieldPct:0.25}, visualKeyword:'vfx_dark_bloom' };
  }
  if (name.includes('i find your lack of faith') || (ability.type && String(ability.type).toLowerCase() === 'ultimate')) {
    return { typeCategory:'ultimate', isAoE:true, channelDuration:1.0, baseDmg:0, scalePct:1.0, scaleStat:'magicAtk', element:'dark', cooldown:75, auraRadius:200, dotDuration:4, mechanics:{damagePerHatredPct:0.05, postBuffDamageReduction:0.5, pullPerHatred:0.2}, visualKeyword:'vfx_dark_void' };
  }
  if (name.includes('dark resilience')) {
    return { typeCategory:'passive', statuses:[{type:'buff_def', duration:Infinity, value:0.0}], mechanics:{onCCGainGiveHatred:3, ccReducePct:0.25, ccReduceCd:3}, visualKeyword:'vfx_buff' };
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

  // BASIC fallback handled by engine; provide small themed effects if necessary
  if (name.includes('crushing blow')) {
    if (!primary) return;
    ui.showAbilityName(actor, 'CRUSHING BLOW');
    ui.playVfx(actor, 'vfx_sword');
    ui.showProjectile(actor, primary, 'proj_sword');
    await wait(220);
    const dmg = Math.floor(actor.effectiveAtk * (parsed?.scalePct || 1.0));
    // apply primary hit
    const res = primary.receiveAction({ amount: dmg, type: 'physical', attackerElement: 'physical' });
    ui.showFloatingText(primary, res.amount, 'damage-number');
    // cleave nearby enemies
    const allEnemies = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead && e.id !== primary.id);
    allEnemies.forEach(e => {
      const dist = Math.hypot(e.x - primary.x, e.y - primary.y);
      if (dist < 120) {
        const cleaveDmg = Math.floor(dmg * (parsed?.cleavePct || 0.4));
        const r2 = e.receiveAction({ amount: cleaveDmg, type: 'physical', attackerElement: 'physical' });
        ui.showFloatingText(e, r2.amount, 'damage-number');
      }
    });
    // grant self damage reduction buff
    actor.applyStatus({ type: 'buff_def_percent', value: 0.15, duration: 2, name: 'Crushing_Reduce' });
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 3;
    return;
  }

  if (name.includes('crush:') || name.includes('crush')) {
    if (!primary) return;
    ui.showAbilityName(actor, 'CRUSH: UNYIELDING POWER');
    ui.playVfx(primary, 'vfx_dark_void');
    // channel
    actor.channeling = true;
    const channelDur = parsed?.channelDuration || 3;
    const hatredPerSec = parsed?.mechanics?.generateHatredPerSec || 2;
    // generate hatred while channeling
    let elapsed = 0;
    while (elapsed < channelDur*1000) {
      await wait(1000);
      elapsed += 1000;
      if (actor.isDead || primary.isDead) break;
      actor.addResource && actor.addResource('Hatred', hatredPerSec, 10);
      // small visual tick
      ui.showFloatingText(actor, '+H', 'status-text');
    }
    actor.channeling = false;
    if (actor.isDead || primary.isDead) return;
    // consume hatred to apply stun/silence if >= threshold
    const hatred = Math.floor(actor.getResource ? actor.getResource('Hatred') : (actor.customResources?.['Hatred']||0));
    if (hatred >= (parsed?.mechanics?.consumeHatredStun || 5)) {
      // consume all hatred
      actor.consumeResource ? actor.consumeResource('Hatred', hatred) : (actor.customResources['Hatred'] = 0);
      primary.applyStatus({ type: 'stun', duration: 1.0, name: 'Crush_Stun' });
      primary.applyStatus({ type: 'silence', duration: 3.0, name: 'Crush_Silence' });
      ui.showFloatingText(primary, 'STUNNED', 'status-text');
    }
    // apply DoT + slow
    const totalMagic = Math.floor(actor.effectiveMagicAtk * (parsed?.scalePct || 0.9));
    const perSec = Math.floor(totalMagic / (parsed?.channelDuration || 3));
    primary.applyStatus({ type: 'burn', duration: parsed?.channelDuration || 3, value: perSec, name: 'Crush_DoT', tickInterval:1.0 });
    primary.applyStatus({ type: 'debuff_speed', value: parsed?.statuses?.find(s=>s.type==='debuff_speed')?.value || 0.30, duration: parsed?.statuses?.find(s=>s.type==='debuff_speed')?.duration || 3, name: 'Crush_Slow' });
    ui.showFloatingText(primary, 'CRUSHED', 'status-text');
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 10;
    return;
  }

  if (name.includes('deflecting strikes')) {
    ui.showAbilityName(actor, 'DEFLECTING STRIKES');
    // compute shield value based on actor.def
    const defVal = Math.max(0, actor.effectiveDef || actor.stats.def || 10);
    const shieldAmount = Math.floor(defVal * 3 + (actor.maxHp || actor.stats["max hp"] || 1000) * 0.10);
    actor.applyStatus({ type: 'shield', value: shieldAmount, duration: 5, name: 'Deflect_Shield' });
    actor.applyStatus({ type: 'buff_def_percent', value: 0.30, duration: 5, name: 'Deflect_Reduce' });
    // set reflection metadata (engine uses reflect_melee_pct)
    actor.applyStatus({ type: 'reflect_melee_pct', value: 0.5, duration: 5, name: 'Deflect_Reflect' });
    ui.playVfx(actor, 'vfx_shield');
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 18;
    return;
  }

  if (name.includes('i find your lack of faith') || decision.type === 'ultimate') {
    ui.showAbilityName(actor, 'I FIND YOUR LACK OF FAITH DISTURBING');
    ui.playVfx(actor, 'vfx_dark_void');
    // channel briefly
    actor.channeling = true;
    await wait(parsed?.channelDuration ? parsed.channelDuration * 1000 : 1000);
    actor.channeling = false;
    const radius = parsed?.auraRadius || 200;
    const enemiesPool = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);
    const hatred = Math.floor(actor.getResource ? actor.getResource('Hatred') : (actor.customResources?.['Hatred']||0));
    const bonusPct = hatred * (parsed?.mechanics?.damagePerHatredPct || 0.05);
    enemiesPool.forEach(e => {
      const dist = Math.hypot(e.x - actor.x, e.y - actor.y);
      if (dist <= radius) {
        const base = Math.floor(actor.effectiveMagicAtk * (parsed?.scalePct || 1.0));
        const total = Math.floor(base * (1 + bonusPct));
        const r = e.receiveAction({ amount: total, type: 'magic', attackerElement: 'dark' });
        ui.showFloatingText(e, r.amount, 'damage-number magic');
        // apply DOT over duration
        e.applyStatus({ type: 'burn', duration: parsed?.dotDuration || 4, value: Math.floor(total / (parsed?.dotDuration || 4)), name: 'Ultimate_DOT', tickInterval:1.0 });
        // pull effect: naive reposition towards center
        const dx = actor.x - e.x;
        const dy = actor.y - e.y;
        const distVec = Math.hypot(dx, dy) || 1;
        const pullStrength = 20 + (hatred * 10);
        e.x += Math.round((dx / distVec) * pullStrength * (1 + hatred*0.2));
        e.y += Math.round((dy / distVec) * pullStrength * (1 + hatred*0.2) * 0.2);
      }
    });
    // consume hatred (optional: keep or consume depending design) — here we do not force consume
    // grant post-ultimate damage reduction buff
    actor.applyStatus({ type: 'buff_def_percent', value: parsed?.mechanics?.postBuffDamageReduction || 0.5, duration: 2, name: 'Ultimate_Reduce' });
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 75;
    return;
  }

  // Signature passives and other passives are handled in updatePassives & applyStatus when appropriate
}