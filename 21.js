/*
  Remote custom ability module for export_id 21 (Kyle Reese).
  Supports: decideAction, getParsedAbility, executeAction, updatePassives
*/

export async function decideAction(actor, enemies = [], allies = [], battle) {
  const liveEnemies = enemies.filter(e => !e.isDead);
  const liveAllies = allies.filter(a => !a.isDead && a !== actor);
  const lowestAlly = ([actor, ...liveAllies].filter(a=>!a.isDead).sort((a,b)=>(a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0]) || actor;
  const guardian = (actor.customResources && actor.customResources['WardTargetId']) ? (battle.allies.concat(battle.enemies).find(x=>x && x.id===actor.customResources['WardTargetId'])) : null;

  // Prefer Guardian Protocol (passive target assignment) if not set or if ward is dead - cast as quick cast to assign to lowest ally
  const guardianSkill = (actor.data?.abilities||[]).find(a => (a.name || '').toLowerCase().includes('guardian protocol'));
  if (guardianSkill && (!guardian || guardian.isDead) && !actor.cooldownTimers?.[guardianSkill.name]) {
    return { ability: guardianSkill, type: 'skill', targets: [lowestAlly] };
  }

  // If ultimate ready try to use in cluster
  const ult = (actor.data?.abilities||[]).find(a => String(a.type||'').toLowerCase() === 'ultimate');
  if (ult && actor.energy >= actor.maxEnergy && !actor.cooldownTimers?.[ult.name]) {
    // pick cluster center (highest density)
    const center = liveEnemies.sort((a,b)=> {
      const ca = liveEnemies.reduce((s,e)=> s + (Math.hypot(e.x-a.x, e.y-a.y) < 140 ? 1:0),0);
      const cb = liveEnemies.reduce((s,e)=> s + (Math.hypot(e.x-b.x, e.y-b.y) < 140 ? 1:0),0);
      return cb - ca;
    })[0] || liveEnemies[0];
    return { ability: ult, type: 'ultimate', targets: center ? [center] : liveEnemies.slice(0,3) };
  }

  // Use Flashbang to protect allies if enemies cluster near lowest ally or to interrupt casters
  const flash = (actor.data?.abilities||[]).find(a => (a.name||'').toLowerCase().includes('flashbang'));
  if (flash && !actor.cooldownTimers?.[flash.name]) {
    // if any enemy within 160px of lowest ally, throw there
    const threatNear = liveEnemies.find(e => Math.hypot(e.x - lowestAlly.x, e.y - lowestAlly.y) <= 160);
    if (threatNear) return { ability: flash, type: 'skill', targets: [{ x: lowestAlly.x, y: lowestAlly.y }] };
    // also use if an enemy caster (magicAtk high) exists
    const caster = liveEnemies.find(e => (e.stats?.magicAtk || 0) > (e.stats?.atk || 0) * 0.8);
    if (caster) return { ability: flash, type: 'skill', targets: [caster] };
  }

  // Steel Resolve: Shield lowest ally when they drop below threshold or when actor is safe to cast
  const steel = (actor.data?.abilities||[]).find(a => (a.name||'').toLowerCase().includes('steel resolve'));
  if (steel && !actor.cooldownTimers?.[steel.name]) {
    const low = lowestAlly;
    if ((low.currentHp / Math.max(1, low.maxHp)) < 0.75) {
      return { ability: steel, type: 'skill', targets: [low] };
    }
  }

  // Fallback: basic attack on highest threat (lowest HP or nearest)
  const basic = (actor.data?.abilities||[]).find(a => (a.name||'').toLowerCase().includes('basic')) || { name: 'Basic Attack' };
  const primary = liveEnemies.sort((a,b)=> (a.currentHp/a.maxHp) - (b.currentHp/b.maxHp))[0] || liveEnemies[0];
  return { ability: basic, type: 'basic', targets: primary ? [primary] : [] };
}

export function updatePassives(actor, dt) {
  if (actor.isDead) return;
  // signature passive: grant surge when ward low -> implemented as resource with cooldown
  if (!actor._signatureCooldown) actor._signatureCooldown = 0;
  if (actor._signatureCooldown > 0) actor._signatureCooldown = Math.max(0, actor._signatureCooldown - dt);

  const wardId = actor.customResources && actor.customResources['WardTargetId'];
  if (wardId && actor.battleSystem) {
    const ward = [...actor.battleSystem.allies, ...actor.battleSystem.enemies].find(e=>e && e.id===wardId);
    if (ward && (ward.currentHp / Math.max(1, ward.maxHp)) < 0.30 && actor._signatureCooldown === 0) {
      // give speed burst to actor for 3s and set cooldown 15s
      actor.applyStatus({ type: 'buff_speed', value: 0.3, duration: 3, name: 'WardSprint' });
      actor._signatureCooldown = 15;
    }
  }
}

export async function getParsedAbility(ability, actor) {
  const name = String(ability.name || '').toLowerCase();
  if (name.includes('basic attack')) {
    return { typeCategory: 'basic', baseDmg: 0, scalePct: 0.9, scaleStat: 'atk', element: 'fire', multiHitCount: 1, cooldown: 1.6, visualKeyword: 'slash' };
  }
  if (name.includes('steel resolve')) {
    return {
      typeCategory: 'skill',
      isShield: true,
      shielding: true,
      cooldown: 12,
      targeting: 'single',
      visualKeyword: 'vfx_shield',
      statuses: [
        { type: 'shield', duration: 3, value: 0 }, // value computed at runtime
        { type: 'buff_tenacity', duration: 5, value: 0.20, name: 'SteelTen' },
        { type: 'buff_speed', duration: 3, value: 0.12, name: 'SteelSpeed' }
      ]
    };
  }
  if (name.includes('flashbang')) {
    return {
      typeCategory: 'skill',
      isDisrupt: true,
      channelDuration: 0.5,
      cooldown: 10,
      targeting: 'area',
      visualKeyword: 'vfx_meteor',
      statuses: [
        { type: 'blind', duration: 2.5, value: 0.75 },
        { type: 'debuff_matk', duration: 2.5, value: -0.25 }
      ]
    };
  }
  if (name.includes('guardian protocol')) {
    return {
      typeCategory: 'passive',
      statuses: [
        { type: 'buff_def', duration: Infinity, value: 0.10, name: 'Ward_DAMAGE_REDUCTION' }
      ],
      mechanics: { redirectPct: 0.20, assignCastTime: 5 }
    };
  }
  if (name.includes('pipe bomb') || ability.type && ability.type.toLowerCase().includes('ultimate')) {
    return {
      typeCategory: 'ultimate',
      baseDmg: 0,
      scalePct: 1.1,
      element: 'physical',
      cooldown: 55,
      channelDuration: 1.5,
      targeting: 'area',
      visualKeyword: 'meteor',
      mechanics: { stunDuration: 1.75, radius: 140 }
    };
  }
  if (name.includes('tech-com evasion') || ability.type && ability.type.toLowerCase().includes('signature')) {
    return {
      typeCategory: 'passive',
      statuses: [
        { type: 'buff_tenacity', duration: Infinity, value: 30, name: 'SigTen' },
        { type: 'buff_evasion', duration: Infinity, value: 15, name: 'SigEva' }
      ],
      mechanics: { wardTriggerSpeedBurst: true, speedPct: 0.30, speedCooldown: 15 }
    };
  }
  return null;
}

export async function executeAction(battle, actor, decision, parsed) {
  const ui = battle.uiManager;
  const ability = decision.ability;
  const name = String(ability.name || '');
  const targets = (decision.targets && Array.isArray(decision.targets)) ? decision.targets : (decision.targets ? [decision.targets] : []);
  const primary = targets[0];

  function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }

  // BASIC
  if (name.toLowerCase().includes('basic')) {
    if (!primary) return;
    ui.showProjectile(actor, primary, 'fire');
    await wait(180);
    const dmg = Math.floor(actor.effectiveAtk * (parsed?.scalePct || 1.0));
    const res = primary.receiveAction({ amount: dmg, type: 'physical', attackerElement: 'fire' });
    ui.showFloatingText(primary, res.amount, 'damage-number fire');
    ui.playVfx(primary, 'vfx_sword');
    return;
  }

  // STEEL RESOLVE: Shield + CC resist + speed buff applied to lowest ally (target)
  if (name.toLowerCase().includes('steel resolve')) {
    const target = primary || actor;
    ui.showAbilityName(actor, 'STEEL RESOLVE');
    ui.playVfx(actor, 'vfx_shield');
    // Shield scales with actor.def and resistance to 'temporal' - approximate: shield = def * 3 + 0.06 * maxHp
    const defVal = Math.max(0, actor.effectiveDef || actor.stats.def || 10);
    const shieldAmt = Math.floor(defVal * 3 + (actor.maxHp || actor.stats.maxHp || 400) * 0.06);
    target.applyStatus({ type: 'shield', value: shieldAmt, duration: 4, name: 'SteelResolve_Shield' });
    // CC reduction buff: reduce duration via a buff tag interpreted by engine (store as debuff reduction value)
    target.applyStatus({ type: 'buff_tenacity', value: 0.18, duration: 5, name: 'SteelResolve_Ten' });
    // Action speed buff to all allies for a short duration
    const allies = (actor.team === 'ally' ? battle.allies : battle.enemies).filter(a=>!a.isDead);
    allies.forEach(a => a.applyStatus({ type: 'buff_speed', value: 0.12, duration: 3 }));
    ui.showFloatingText(target, 'STEEL SHIELD', 'status-text buff');
    // minor resource gain to actor
    actor.addResource && actor.addResource('TacticalCharge', 5, 999);
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 12;
    return;
  }

  // FLASHBANG: area blind + reduce magic atk; supports coordinate target {x,y} or entity
  if (name.toLowerCase().includes('flashbang')) {
    let tx = primary && typeof primary.x === 'number' ? primary.x : (primary && primary.targetX) || (actor.currentActionTarget && actor.currentActionTarget.x) || actor.x;
    let ty = primary && typeof primary.y === 'number' ? primary.y : (primary && primary.targetY) || (actor.currentActionTarget && actor.currentActionTarget.y) || actor.y;
    // travel time
    ui.showProjectile(actor, { x: tx, y: ty }, 'proj_fire');
    await wait(500);
    ui.playVfx({ id: null, x: tx, y: ty }, 'vfx_poison_cloud'); // reuse cloud as flash bloom
    // apply blind & magic atk debuff to enemies in radius (15 units -> map to ~60-160 px; use 140)
    const radius = 140;
    const pool = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);
    pool.forEach(e => {
      const dist = Math.hypot(e.x - tx, e.y - ty);
      if (dist <= radius) {
        e.applyStatus({ type: 'blind', duration: 2.5, value: 0.75, name: 'Flashblind' });
        e.applyStatus({ type: 'debuff_matk', duration: 2.5, value: -0.25, name: 'Flash_MatkDown' });
        ui.showFloatingText(e, 'BLINDED', 'status-text');
        ui.playVfx(e, 'vfx_starlight');
      }
    });
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 10;
    return;
  }

  // GUARDIAN PROTOCOL: Passive cast to assign Ward - when explicitly cast, store ward target id and apply ward buff
  if (name.toLowerCase().includes('guardian protocol')) {
    const target = primary || actor;
    // Cast time 5s simulated as small delay (but keep it responsive)
    ui.showAbilityName(actor, 'GUARDIAN PROTOCOL');
    await wait(350);
    // store ward target in customResources so updatePassives and signature read it
    if (!actor.customResources) actor.customResources = {};
    actor.customResources['WardTargetId'] = target.id;
    // apply the 10% damage reduction buff to selected ally (engine reads buff_def)
    target.applyStatus({ type: 'buff_def', value: 0.10, duration: Infinity, name: 'Guardian_Ward' });
    ui.showFloatingText(target, 'WARD ESTABLISHED', 'status-text buff');
    // also indicate redirect mechanic by storing mechanic value
    actor.customResources['WardRedirectPct'] = 0.20;
    // small personal redirect representation: keep as passive (handled in getParsedAbility / engine mechanics)
    actor.cooldownTimers[ability.name] = 1; // allow reassign quickly but engine semantics control castTime elsewhere
    return;
  }

  // PIPE BOMB ULTIMATE
  if (name.toLowerCase().includes('pipe bomb') || decision.type === 'ultimate') {
    const cx = primary && primary.x || actor.currentActionTarget && actor.currentActionTarget.x || actor.x + 200;
    const cy = primary && primary.y || actor.currentActionTarget && actor.currentActionTarget.y || actor.y;
    ui.showAbilityName(actor, 'PIPE BOMB TAKEDOWN!');
    ui.playVfx(actor, 'vfx_explosion');
    // channel
    actor.channeling = true;
    await wait(1500);
    actor.channeling = false;
    // explosion: damage to enemies within radius (25 units -> ~140 px)
    const radius = 140;
    const pool = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e=>!e.isDead);
    pool.forEach(e => {
      const dist = Math.hypot(e.x - cx, e.y - cy);
      if (dist <= radius) {
        const base = Math.max(10, actor.stats.atk || 15);
        const dmg = Math.floor(base + (1.1 * actor.effectiveAtk));
        const res = e.receiveAction({ amount: dmg, type: 'physical' });
        ui.showFloatingText(e, res.amount, 'damage-number');
        e.applyStatus({ type: 'stun', duration: 1.75, name: 'PipeStun' });
        ui.playVfx(e, 'vfx_explosion');
      }
    });
    // ultimate cooldown & energy reset
    actor.energy = 0;
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 55;
    return;
  }

  // Default fallback: do nothing
  return;
}