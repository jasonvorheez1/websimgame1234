/*
  Character ability module for export_id "43" (Pulchra)
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

  if (name.includes('basic attack')) {
    return {
      typeCategory: 'basic',
      baseDmg: 0,
      scalePct: 1.0,
      scaleStat: 'atk',
      element: 'electric',
      targeting: 'single',
      multiHit: true,
      visualKeyword: 'vfx_sword',
      cooldown: 1.4
    };
  }

  if (name.includes('flashstep') || name.includes('prey restraint')) {
    return {
      typeCategory: 'skill',
      baseDmgPct: 1.20, // 120% of atk
      scaleStat: 'atk',
      element: 'physical',
      targeting: 'line',
      aoeRadius: 120,
      multiHit: true,
      preyChance: 0.30,
      preyDuration: 8,
      preyAftershockIncreasePct: 0.15,
      prioritizeNotPreyed: true,
      visualKeyword: 'vfx_dash',
      cooldown: 10
    };
  }

  if (name.includes('first strike advantage') || name.includes('swift pursuit')) {
    return {
      typeCategory: 'skill',
      baseDmgPct: 0.80,
      scaleStat: 'atk',
      element: 'physical',
      targeting: 'single',
      splashRadius: 80,
      stunChanceIfBinding: 0.20,
      stunDur: 1.5,
      grantsShieldWhileHunter: { pctMaxHp: 0.10, dur: 4 },
      visualKeyword: 'vfx_slash_heavy',
      cooldown: 12
    };
  }

  if (name.includes('hunter\'s instinct') || name.includes('calculated aggression')) {
    return {
      typeCategory: 'passive',
      huntersGaitDuration: 8,
      dazeIncreasePct: 0.10,
      quickAssistPct: 0.50,
      quickAssistAftershockPct: 0.50,
      visualKeyword: 'vfx_buff'
    };
  }

  if (name.includes('oh, time to play') || name.includes('calydon\'s barrage')) {
    return {
      typeCategory: 'ultimate',
      baseDmgPct: 2.00,
      scaleStat: 'atk',
      element: 'physical',
      targeting: 'aoe',
      vulnerablePct: 0.15,
      vulnerableDur: 10,
      entersHuntersGait: true,
      visualKeyword: 'vfx_fire_storm',
      cooldown: 90
    };
  }

  if (name.includes('evasive maneuvers') || name.includes('anticipation')) {
    return {
      typeCategory: 'signature',
      evasionPct: 0.30,
      anticipationMax: 3,
      anticipationDur: 15,
      perStackAftershockPct: 0.10,
      visualKeyword: 'vfx_wind'
    };
  }

  return null;
}

export async function decideAction(actor, enemies, allies, battle){
  const live = (enemies||[]).filter(e=>!e.isDead);
  if (!live.length) return { ability: { name: 'Basic Attack' }, targets: [] };

  const find = q => (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes(q));
  const ult = find('oh, time to play') || find('calydon');
  const flash = find('flashstep');
  const first = find('first strike') || find('swift pursuit');
  const basic = (actor.data.abilities||[]).find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };

  // Use ultimate when ready and multiple enemies present or many prey stacks to consume
  const preyStacks = (live.reduce((s,e)=> s + ((e.activeEffects||[]).reduce((ss,ef)=> ss + ((ef.type==='Prey Restraint' || String(ef.type).toLowerCase().includes('prey')) ? (ef.stacks||1) : 0),0)),0));
  if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
    if (live.length >= 3 || preyStacks >= 2) return { ability: ult, type: 'ultimate', targets: live.slice(0,6) };
  }

  // Flashstep: prioritize enemies not already preyed and in a line / cluster
  if (flash && !actor.cooldownTimers?.[flash.name]) {
    const candidates = live.filter(e => !(e.activeEffects||[]).some(s => String(s.type).toLowerCase().includes('prey')));
    if (candidates.length) {
      const center = candidates.sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
      return { ability: flash, type: 'skill', targets: [center] };
    }
  }

  // First Strike: use against a single high-value target or to trigger stun synergy if target has Binding Trap
  if (first && !actor.cooldownTimers?.[first.name]) {
    const priority = live.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
    if (priority) return { ability: first, type: 'skill', targets: [priority] };
  }

  // If signature stacks and heavy attack available, prefer heavy (handled in skill triggers); fallback basic
  return { ability: basic, type: 'basic', targets: [live[0]] };
}

export async function executeAction(battle, actor, decision, parsed){
  if (!decision || !decision.ability) return;
  const ui = battle.uiManager;
  const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
  const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
  const live = enemies.filter(e=>!e.isDead);
  const name = (decision.ability.name||'').toLowerCase();

  // small windup
  await new Promise(r=>setTimeout(r, (decision.type==='ultimate')?380:160));

  // BASIC
  if (name.includes('basic attack')) {
    const t = decision.targets && decision.targets[0] || live[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 60;
    // multi-hit / aoe flavor: two quick strikes
    for (let i=0;i<2;i++){
      const dmg = Math.floor(atk * (parsed.scalePct || 1.0) * (i===0?0.6:0.4));
      const res = t.receiveAction({ amount: dmg, type:'physical', element: 'electric', attackerAccuracy: 22 });
      ui.showFloatingText(t, res.amount, 'damage-number');
      ui.playVfx(t, 'vfx_spark');
      await new Promise(r=>setTimeout(r, 90));
    }
    actor.energy = Math.min(actor.maxEnergy, (actor.energy || 0) + 8);
    return;
  }

  // FLASHSTEP: Prey Restraint
  if (name.includes('flashstep')) {
    const center = decision.targets && decision.targets[0] ? decision.targets[0] : live[0];
    if (!center) return;
    ui.showAbilityName(actor, 'Flashstep: Prey Restraint');
    ui.playVfx(actor, 'vfx_dash');
    // dash through enemies in a short line; simplified: hit up to 4 closest enemies near line center
    const hits = live.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= (parsed.aoeRadius || 120)).slice(0,4);
    for (const t of hits) {
      const dmg = Math.floor((actor.effectiveAtk || actor.stats.atk || 60) * (parsed.baseDmgPct || 1.2));
      const res = t.receiveAction({ amount: dmg, type:'physical', element:'physical', attackerAccuracy: 20 });
      ui.showFloatingText(t, res.amount, 'damage-number');
      // roll Prey Restraint
      if (Math.random() < (parsed.preyChance || 0.30)) {
        t.applyStatus({ type: 'Prey Restraint', duration: parsed.preyDuration || 8, value: parsed.preyAftershockIncreasePct || 0.15, name: 'Prey Restraint' });
        ui.showFloatingText(t, 'PREY', 'status-text');
      }
      ui.playVfx(t, 'vfx_slash');
      await new Promise(r=>setTimeout(r, 60));
    }
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 10;
    return;
  }

  // FIRST STRIKE ADVANTAGE
  if (name.includes('first strike') || name.includes('swift pursuit')) {
    const t = decision.targets && decision.targets[0] ? decision.targets[0] : live[0];
    if (!t) return;
    // dash to target and deal primary hit
    try {
      const dx = t.x - actor.x; const dy = t.y - actor.y; const dist = Math.hypot(dx,dy) || 1;
      const move = Math.min(160, Math.max(40, dist - 20));
      actor.x += (dx/dist) * move;
      actor.y += (dy/dist) * Math.max(0.1, move * 0.12);
    } catch(e){}
    ui.playVfx(actor, 'vfx_slash_heavy');
    const baseDmg = Math.floor((actor.effectiveAtk || actor.stats.atk || 60) * (parsed.baseDmgPct || 0.80));
    // splash to nearby
    const targets = live.filter(e => Math.hypot(e.x - t.x, e.y - t.y) <= (parsed.splashRadius || 80));
    for (const target of targets){
      const res = target.receiveAction({ amount: baseDmg, type:'physical', element: 'physical', attackerAccuracy: 20 });
      ui.showFloatingText(target, res.amount, 'damage-number');
      // if target has Binding Trap, roll stun
      const hasBinding = (target.activeEffects || []).some(s => String(s.type).toLowerCase().includes('binding trap'));
      if (hasBinding && Math.random() < (parsed.stunChanceIfBinding || 0.20)) {
        target.applyStatus({ type: 'stun', duration: parsed.stunDur || 1.5 });
        ui.showFloatingText(target, 'STUN', 'status-text');
      }
    }

    // If Hunter's Gait active and level upgrades would grant shield, grant shield (we approximate by checking a custom flag)
    const inGait = actor.customResources && actor.customResources['HuntersGaitActive'];
    if (inGait && parsed.grantsShieldWhileHunter) {
      const shieldAmt = Math.floor((actor.maxHp || actor.stats['max hp'] || 568) * (parsed.grantsShieldWhileHunter.pctMaxHp || parsed.grantsShieldWhileHunter || 0.10));
      actor.receiveAction && actor.receiveAction({ amount: shieldAmt, effectType: 'shield' });
      ui.showFloatingText(actor, `SHIELD ${shieldAmt}`, 'status-text buff');
    }

    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 12;
    return;
  }

  // HUNTER'S INSTINCT PASSIVE Quick Assist is handled via updatePassives trigger when heavy attack lands; fallback do nothing
  if (name.includes('hunter\'s instinct')) return;

  // ULTIMATE: Calydon's Barrage
  if (name.includes('oh, time to play') || name.includes('calydon')) {
    const center = { x: actor.x, y: actor.y };
    ui.showAbilityName(actor, 'Oh, Time to Play?: Calydon\'s Barrage');
    ui.playVfx(actor, 'vfx_fire_storm');
    const atk = actor.effectiveAtk || actor.stats.atk || 60;
    const dmg = Math.floor(atk * (parsed.baseDmgPct || 2.0));
    const targets = live.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= 300);
    for (const t of targets) {
      const res = t.receiveAction({ amount: dmg, type:'physical', element:'physical', attackerAccuracy: 18 });
      ui.showFloatingText(t, res.amount, 'damage-number crit');
      // apply Vulnerable
      t.applyStatus({ type: 'Vulnerable', duration: parsed.vulnerableDur || 10, value: parsed.vulnerablePct || 0.15, name: 'Vulnerable' });
      ui.playVfx(t, 'vfx_explosion');
      await new Promise(r=>setTimeout(r, 60));
    }
    // Enter Hunter's Gait
    actor.customResources = actor.customResources || {};
    actor.customResources['HuntersGaitActive'] = parsed.entersHuntersGait ? (parsed.huntersGaitDuration || 8) : (parsed.huntersGaitDuration || 8);
    actor.resourceDecayTimers = actor.resourceDecayTimers || {};
    actor.resourceDecayTimers['HuntersGaitActive'] = actor.customResources['HuntersGaitActive'];
    actor.applyStatus({ type: 'buff_atk', value: 0.0, duration: parsed.huntersGaitDuration || 8, name: "Hunter's Gait" }); // marker for UI/engine
    actor.energy = 0;
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 90;
    return;
  }

  // SIGNATURE: Evasive Maneuvers (passive) - no direct execute
  return;
}

export function updatePassives(actor, dt){
  actor.customResources = actor.customResources || {};
  actor.resourceDecayTimers = actor.resourceDecayTimers || {};
  actor.passiveModifiers = actor.passiveModifiers || {};

  // Evasive Maneuvers: base evasion buff provided by signature
  const sig = actor.data.abilities?.find(a => (a.name||'').toLowerCase().includes('evasive maneuvers'));
  if (sig) {
    const parsedSig = {
      evasionPct: 0.30,
      anticipationMax: 3,
      anticipationDur: 15,
      perStackAftershockPct: 0.10
    };
    actor.passiveModifiers.signatureEvasion = parsedSig.evasionPct;
    // Manage Anticipation stacks on dodge: Character.receiveAction should call actor.addResource on dodge; here we decay timers
    if (!actor.customResources['Anticipation']) actor.customResources['Anticipation'] = actor.customResources['Anticipation'] || 0;
    if (!actor.resourceDecayTimers['Anticipation']) actor.resourceDecayTimers['Anticipation'] = 0;
    // simulate decay
    if (actor.resourceDecayTimers['Anticipation'] > 0) {
      actor.resourceDecayTimers['Anticipation'] = Math.max(0, actor.resourceDecayTimers['Anticipation'] - dt);
    } else if (actor.customResources['Anticipation'] > 0) {
      actor.customResources['Anticipation'] = Math.max(0, actor.customResources['Anticipation'] - (1 * dt));
    }
    // clamp stacks
    actor.customResources['Anticipation'] = Math.max(0, Math.min(parsedSig.anticipationMax, Math.floor(actor.customResources['Anticipation'] || 0)));
  }

  // Hunter's Gait timer decay
  if (actor.customResources['HuntersGaitActive'] > 0) {
    actor.resourceDecayTimers['HuntersGaitActive'] = Math.max(0, (actor.resourceDecayTimers['HuntersGaitActive'] || 0) - dt);
    actor.customResources['HuntersGaitActive'] = Math.max(0, actor.customResources['HuntersGaitActive'] - dt);
    // while in gait, increase daze dealt (represented as passiveModifiers)
    actor.passiveModifiers.huntersGaitDaze = 0.10;
    // also lifesteal if higher-level flag set (approx detection via a saved flag)
    if (actor.customResources['HuntersGaitLifesteal']) actor.passiveModifiers.huntersGaitLifesteal = 0.10;
  } else {
    delete actor.passiveModifiers.huntersGaitDaze;
    delete actor.passiveModifiers.huntersGaitLifesteal;
  }

  // Quick Assist: when Pulchra lands a heavy attack (handled in executeAction), we should trigger assist from previous ally via a small resource flag.
  // Decay any QuickAssist window flags
  if (actor.customResources['QuickAssistWindow'] > 0) {
    actor.customResources['QuickAssistWindow'] = Math.max(0, actor.customResources['QuickAssistWindow'] - dt);
  }

  // Ensure numbers stay sane
  for (const k in actor.customResources) {
    if (!Number.isFinite(actor.customResources[k])) actor.customResources[k] = 0;
  }
}