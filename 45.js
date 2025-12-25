/*
  Character ability module for export_id "45" (Kyle Broflovski)
  Exports:
    - getParsedAbility(ability, actor, battle)
    - decideAction(actor, enemies, allies, battle)
    - executeAction(battle, actor, decision, parsed)
    - updatePassives(actor, dt)
  Implements: Basic Attack (Ice), Fiery Rebuke, Eloquent Plea, Voice of Reason passive, Ultimate Argument, Outraged Rebuke signature.
*/

function pickRandom(arr){ return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

export async function getParsedAbility(ability, actor, battle){
  const name = (ability && ability.name || '').toLowerCase();

  if (name.includes('basic attack')) {
    return {
      typeCategory: 'basic',
      baseDmg: 12,
      scalePct: 0.22,
      scaleStat: 'atk',
      element: 'ice',
      targeting: 'single',
      visualKeyword: 'vfx_ice',
      cooldown: 1.4
    };
  }

  if (name.includes('fiery rebuke') || name.includes('you bastards')) {
    return {
      typeCategory: 'skill',
      baseDmg: 0,
      scalePct: 0.7, // multiplied by magic atk
      scaleStat: 'magicAtk',
      element: 'magic',
      targeting: 'single',
      appliesStatus: [{ type: 'Accusation', stacks: 1, value: 0.10, duration: 3 }],
      maxStacks: 3,
      aoeIfMoral: true,
      visualKeyword: 'vfx_dark_bloom',
      cooldown: 8
    };
  }

  if (name.includes('eloquent plea') || name.includes('finding common ground')) {
    return {
      typeCategory: 'skill',
      baseShield: 0,
      shieldScalePct: 0.6, // * magic atk
      scaleStat: 'magicAtk',
      element: 'magic',
      targeting: 'single',
      grantsAtkPct: 0.15,
      grantsAtkPctLowHp: 0.30,
      visualKeyword: 'vfx_heal',
      cooldown: 10
    };
  }

  if (name.includes('voice of reason')) {
    return {
      typeCategory: 'passive',
      tenacityAura: 15,
      moralDuration: 10,
      moralCooldownPerAlly: 30,
      visualKeyword: 'vfx_buff'
    };
  }

  if (name.includes('ultimate argument') || name.includes('dismantling')) {
    return {
      typeCategory: 'ultimate',
      baseDmg: 0,
      scalePct: 1.0,
      scaleStat: 'magicAtk',
      element: 'magic',
      targeting: 'single',
      appliesStatus: [{ type: 'Doubt', stacks: 1, value: 0.30, duration: 8 }],
      interruptOnUltWhileDoubt: true,
      visualKeyword: 'vfx_arcane_circle',
      cooldown: 90
    };
  }

  if (name.includes('outraged rebuke') || name.includes('signature')) {
    return {
      typeCategory: 'passive',
      tenacityGain: 30,
      damagePct: 0.10,
      evasion: 10,
      duration: 6,
      cooldownPerAlly: 10,
      visualKeyword: 'vfx_buff'
    };
  }

  return null;
}

export async function decideAction(actor, enemies, allies, battle){
  const liveEnemies = (enemies||[]).filter(e=>!e.isDead);
  const liveAllies = (allies||[]).filter(a=>!a.isDead && a !== actor);
  if (!liveEnemies.length) return { ability: { name: 'Basic Attack' }, targets: [] };

  const find = q => (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes(q));
  const ult = find('ultimate argument');
  const rebuke = find('fiery rebuke');
  const plea = find('eloquent plea');
  const basic = (actor.data.abilities||[]).find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };

  // If ally below 25% HP and moral high ground not on cooldown, try to trigger passive by waiting (passive manages state), otherwise shield/plea
  const lowAlly = liveAllies.find(a => (a.currentHp / a.maxHp) < 0.5);
  if (lowAlly && plea && !actor.cooldownTimers?.[plea.name]) {
    // prioritize lowest def ally
    const lowDefAlly = liveAllies.sort((a,b)=> (a.stats.def || 0) - (b.stats.def || 0))[0] || lowAlly;
    return { ability: plea, type: 'skill', targets: [lowDefAlly] };
  }

  // Use Ultimate when ready against highest-ATK enemy or when that enemy is casting or high threat
  if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
    const target = liveEnemies.sort((a,b)=> (b.stats && b.stats.atk || 0) - (a.stats && a.stats.atk || 0))[0];
    if (target) return { ability: ult, type: 'ultimate', targets: [target] };
  }

  // Fiery Rebuke: prioritize enemy with highest atk, prefer to stack Accusation
  if (rebuke && !actor.cooldownTimers?.[rebuke.name]) {
    const priority = liveEnemies.sort((a,b)=> (b.stats && b.stats.atk || 0) - (a.stats && a.stats.atk || 0))[0];
    if (priority) return { ability: rebuke, type: 'skill', targets: [priority] };
  }

  // Fallback basic on closest
  const nearest = liveEnemies.sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
  return { ability: basic, type: 'basic', targets: [nearest] };
}

export async function executeAction(battle, actor, decision, parsed){
  if (!decision || !decision.ability) return;
  const ui = battle.uiManager;
  const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
  const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
  const liveEnemies = enemies.filter(e=>!e.isDead);
  const name = (decision.ability.name||'').toLowerCase();

  // short windup
  await new Promise(r => setTimeout(r, (decision.type === 'ultimate') ? 420 : 160));

  // BASIC ATTACK (Ice)
  if (name.includes('basic attack')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 13;
    const dmg = Math.floor((parsed.baseDmg || 12) + atk * (parsed.scalePct || 0.22));
    const res = t.receiveAction({ amount: dmg, type:'physical', element:'ice', attackerAccuracy: 18 });
    ui.showFloatingText(t, res.amount, 'damage-number');
    ui.playVfx(t, parsed.visualKeyword || 'vfx_ice');
    actor.energy = Math.min(actor.maxEnergy, (actor.energy || 0) + 8);
    return;
  }

  // FIERY REBUKE - 'You Bastards!'
  if (name.includes('fiery rebuke')) {
    const target = decision.targets && decision.targets[0] ? decision.targets[0] : liveEnemies[0];
    if (!target) return;
    ui.showAbilityName(actor, "Fiery Rebuke: 'You Bastards!'");
    ui.playVfx(target, parsed.visualKeyword || 'vfx_arcane_circle');
    const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 13;
    const dmg = Math.floor(matk * (parsed.scalePct || 0.7));
    // Single-target or AoE if moral high ground active (engine passive sets customResources)
    const moral = actor.customResources && actor.customResources['MoralHighGroundActive'];
    const targets = (moral && parsed.aoeIfMoral) ? liveEnemies.filter(e => Math.hypot(e.x - target.x, e.y - target.y) <= 220) : [target];
    for (const t of targets) {
      const res = t.receiveAction({ amount: dmg, type:'magic', element:'magic', attackerAccuracy: 18 });
      ui.showFloatingText(t, res.amount, 'damage-number magic');
      // apply Accusation: reduce def and magic def by 10% per stack up to 3
      const existing = t.activeEffects.find(e => String(e.type).toLowerCase() === 'accusation');
      if (existing) {
        existing.stacks = Math.min(3, (existing.stacks || 1) + 1);
        existing.duration = 3;
      } else {
        t.applyStatus({ type: 'Accusation', stacks: 1, value: 0.10, duration: 3, name: 'Accusation' });
      }
      ui.playVfx(t, 'vfx_dark_bloom');
      await new Promise(r=>setTimeout(r, 80));
    }
    // consume Moral High Ground if used
    if (moral && parsed.aoeIfMoral && actor.customResources) {
      actor.customResources['MoralHighGroundActive'] = 0;
    }
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 8;
    return;
  }

  // ELOQUENT PLEA: Shield + ATK buff (heal interaction with Moral High Ground)
  if (name.includes('eloquent plea')) {
    const ally = decision.targets && decision.targets[0] ? decision.targets[0] : (friends.find(a=>!a.isDead) || actor);
    if (!ally) return;
    ui.showAbilityName(actor, 'Eloquent Plea: Finding Common Ground');
    ui.playVfx(ally, parsed.visualKeyword || 'vfx_heal');
    const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 13;
    const shield = Math.floor((parsed.baseShield || 0) + matk * (parsed.shieldScalePct || parsed.shieldScalePct === 0 ? parsed.shieldScalePct : 0.6));
    ally.receiveAction && ally.receiveAction({ amount: shield, effectType: 'shield' });
    // atk buff
    const hpPct = (ally.currentHp || ally.maxHp || 1) / (ally.maxHp || ally.stats['max hp'] || 1);
    const atkPct = (hpPct < 0.5) ? (parsed.grantsAtkPctLowHp || 0.30) : (parsed.grantsAtkPct || 0.15);
    ally.applyStatus({ type: 'buff_atk', value: atkPct, duration: 4, name: 'Eloquent ATK' });
    ui.showFloatingText(ally, `SHIELD ${shield}`, 'status-text buff');
    ui.showFloatingText(ally, `ATK +${Math.round(atkPct*100)}%`, 'status-text buff');
    // if Moral High Ground active, heal portion equal to 10% of shield (handled here)
    const moral = actor.customResources && actor.customResources['MoralHighGroundActive'];
    if (moral && parsed.healWithMoral) {
      const heal = Math.floor(shield * 0.10);
      ally.receiveAction && ally.receiveAction({ amount: heal, effectType: 'heal' });
      ui.showFloatingText(ally, `+${heal}`, 'damage-number heal');
      if (actor.customResources) actor.customResources['MoralHighGroundActive'] = 0;
    }
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 10;
    return;
  }

  // ULTIMATE: Ultimate Argument
  if (name.includes('ultimate argument')) {
    const primary = decision.targets && decision.targets[0] ? decision.targets[0] : liveEnemies.sort((a,b)=>(b.stats?.atk||0)-(a.stats?.atk||0))[0];
    if (!primary) return;
    ui.showAbilityName(actor, 'Ultimate Argument: Dismantling the Opposition');
    ui.playVfx(primary, parsed.visualKeyword || 'vfx_arcane_circle');
    const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 13;
    const baseDmg = Math.floor(matk * (parsed.scalePct || 1.0));
    // apply Doubt to primary: reduce atk by 30% and crit damage by 40%
    primary.applyStatus({ type: 'Doubt', stacks: 1, value: 0.30, duration: 8, name: 'Doubt' });
    primary.applyStatus({ type: 'debuff_crit_mult', value: -0.40, duration: 8, name: 'DoubtCrit' });
    ui.showFloatingText(primary, 'DOUBT', 'status-text');
    // If primary tries to cast ultimate while Doubt active, engine will request presence update; we implement interrupt hook here by marking presence flag.
    // Deal immediate damage now
    const res = primary.receiveAction({ amount: baseDmg, type:'magic', element:'magic', attackerAccuracy: 20 });
    ui.showFloatingText(primary, res.amount, 'damage-number crit');
    // If primary is attempting an ultimate (a simple heuristic: energy >= maxEnergy), interrupt and deal extra
    if ((primary.energy || 0) >= (primary.maxEnergy || 100)) {
      // interrupt: apply stun + extra damage
      primary.applyStatus({ type: 'stun', duration: 1.0 });
      const extra = Math.floor(matk * 1.0);
      const r2 = primary.receiveAction({ amount: extra, type:'magic', element:'magic', attackerAccuracy: 22 });
      ui.showFloatingText(primary, r2.amount, 'damage-number crit');
      ui.showFloatingText(primary, 'INTERRUPTED', 'status-text');
    }
    actor.energy = 0;
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 90;
    return;
  }

  // Signature passive trigger handled in updatePassives; fallback no-op
  return;
}

export function updatePassives(actor, dt){
  actor.customResources = actor.customResources || {};
  actor.resourceDecayTimers = actor.resourceDecayTimers || {};
  actor.passiveModifiers = actor.passiveModifiers || {};

  // Voice of Reason: provide aura tenacity to allies
  const passive = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('voice of reason'));
  if (passive) {
    actor.passiveModifiers.voiceTenacity = passive.tenacityAura || 15;
    // Moral High Ground logic: if any ally drops below 25% and per-ally cooldown allows, grant MoralHighGroundActive to actor
    const allies = actor.battleSystem ? (actor.team === 'ally' ? actor.battleSystem.allies : actor.battleSystem.enemies) : [];
    (allies||[]).forEach(al => {
      if (al === actor) return;
      if ((al.currentHp || 0) / (al.maxHp || 1) <= 0.25) {
        // check per-ally cooldown stored in actor.customResources['_moral_cd_{allyId}']
        const key = `_moral_cd_${al.id}`;
        actor.customResources[key] = actor.customResources[key] || 0;
        if (actor.customResources[key] <= 0) {
          // grant Moral High Ground
          actor.customResources['MoralHighGroundActive'] = passive.moralDuration || 10;
          actor.resourceDecayTimers['MoralHighGroundActive'] = actor.customResources['MoralHighGroundActive'];
          // set cooldown for that ally
          actor.customResources[key] = passive.moralCooldownPerAlly || 30;
          actor.resourceDecayTimers[key] = actor.customResources[key];
          // visual cue
          actor.applyStatus && actor.applyStatus({ type: 'MoralHighGround', duration: actor.customResources['MoralHighGroundActive'], name: 'Moral High Ground' });
        }
      }
    });
  }

  // Outraged Rebuke signature: triggered when any ally is crowd-controlled; grant temp buff to Kyle
  const sig = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('outraged rebuke'));
  if (sig) {
    const allies = actor.battleSystem ? (actor.team === 'ally' ? actor.battleSystem.allies : actor.battleSystem.enemies) : [];
    for (const al of allies) {
      if (al === actor) continue;
      const cc = al.activeEffects && al.activeEffects.some(e => ['stun','silence','root','freeze','charm'].includes(e.type));
      if (cc) {
        // per-ally cooldown key
        const k = `_outraged_cd_${al.id}`;
        actor.customResources[k] = actor.customResources[k] || 0;
        if (actor.customResources[k] <= 0) {
          // apply buff to Kyle (and allies in range if Moral High Ground active)
          actor.applyStatus({ type: 'buff_tenacity', value: sig.tenacityGain || 30, duration: sig.duration || 6, name: 'Outraged Tenacity' });
          actor.applyStatus({ type: 'buff_atk', value: sig.damagePct || 0.10, duration: sig.duration || 6, name: 'Outraged Damage' });
          actor.applyStatus({ type: 'buff_evasion', value: (sig.evasion || 10) / 100, duration: sig.duration || 6, name: 'Outraged Evasion' });
          // If Moral High Ground active, apply to nearby allies
          if (actor.customResources['MoralHighGroundActive']) {
            const radius = 400;
            const friends = actor.battleSystem ? (actor.team === 'ally' ? actor.battleSystem.allies : actor.battleSystem.enemies) : [];
            friends.filter(f => !f.isDead && Math.hypot(f.x - actor.x, f.y - actor.y) <= radius).forEach(f => {
              f.applyStatus({ type: 'buff_tenacity', value: sig.tenacityGain || 30, duration: sig.duration || 6, name: 'Outraged Tenacity' });
              f.applyStatus({ type: 'buff_atk', value: 0.05, duration: sig.duration || 6, name: 'Moral Damage' });
            });
          }
          actor.customResources[k] = sig.cooldownPerAlly || 10;
          actor.resourceDecayTimers[k] = actor.customResources[k];
        }
      }
    }
  }

  // Decay timers
  for (const k in actor.resourceDecayTimers) {
    actor.resourceDecayTimers[k] = Math.max(0, (actor.resourceDecayTimers[k] || 0) - dt);
    if (actor.customResources[k] && actor.resourceDecayTimers[k] <= 0 && k.startsWith('_moral_cd_')) actor.customResources[k] = 0;
  }

  // Decay MoralHighGroundActive
  if (actor.customResources['MoralHighGroundActive'] > 0) {
    actor.customResources['MoralHighGroundActive'] = Math.max(0, actor.customResources['MoralHighGroundActive'] - dt);
    actor.resourceDecayTimers['MoralHighGroundActive'] = actor.customResources['MoralHighGroundActive'];
    if (actor.customResources['MoralHighGroundActive'] <= 0) {
      // remove status
      actor.activeEffects = (actor.activeEffects || []).filter(e => e.type !== 'MoralHighGround');
    }
  }
}