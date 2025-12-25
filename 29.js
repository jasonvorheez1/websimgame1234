/*
  Local custom ability module for export_id 29 (Ridley).
  Implements: decideAction, getParsedAbility, executeAction, updatePassives
*/

export async function decideAction(actor, enemies = [], allies = [], battle) {
  const liveEnemies = enemies.filter(e => !e.isDead);
  const liveAllies = allies.filter(a => !a.isDead && a !== actor);
  if (liveEnemies.length === 0) return { ability: { name: 'Basic Attack' }, type: 'basic', targets: [] };

  // Ensure customResources exist
  if (!actor.customResources) actor.customResources = {};

  const fury = Math.floor(actor.getResource ? actor.getResource('Fury') : (actor.customResources['Fury']||0));
  const inMeta = fury >= 100;
  const inOmega = fury >= 250;

  // Prefer ultimate if available and in proper form
  const ult = (actor.data?.abilities||[]).find(a => String(a.type||'').toLowerCase() === 'ultimate' || (a.name||'').toLowerCase().includes('divebomb'));
  if (ult && actor.energy >= actor.maxEnergy && !actor.cooldownTimers?.[ult.name] && (inMeta || inOmega)) {
    // target clustered area center
    const center = liveEnemies.sort((a,b)=> {
      const ca = liveEnemies.reduce((s,e)=> s + (Math.hypot(e.x-a.x,e.y-a.y) < 200 ? 1:0),0);
      const cb = liveEnemies.reduce((s,e)=> s + (Math.hypot(e.x-b.x,e.y-b.y) < 200 ? 1:0),0);
      return cb - ca;
    })[0] || liveEnemies[0];
    return { ability: ult, type: 'ultimate', targets: center ? [center] : liveEnemies.slice(0,3) };
  }

  // Defensive: if low HP use Wing Buffet to dash/knockback (may grant shield in upgrades)
  const dash = (actor.data?.abilities||[]).find(a => (a.name||'').toLowerCase().includes('wing buffet'));
  if (dash && !actor.cooldownTimers?.[dash.name]) {
    if ((actor.currentHp / actor.maxHp) < 0.55) return { ability: dash, type: 'skill', targets: [ liveEnemies.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0] ] };
  }

  // Offensive AoE: Plasma Breath Volley when multiple enemies nearby
  const cone = (actor.data?.abilities||[]).find(a => (a.name||'').toLowerCase().includes('plasma breath'));
  if (cone && !actor.cooldownTimers?.[cone.name]) {
    const clusterCount = liveEnemies.reduce((s,e)=> s + (Math.hypot(e.x - actor.x, e.y - actor.y) < 220 ? 1:0), 0);
    if (clusterCount >= 2) return { ability: cone, type: 'skill', targets: [ liveEnemies.sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0] ] };
  }

  // If nothing else, basic attack on highest threat
  const basic = (actor.data?.abilities||[]).find(a => (a.tags||[]).includes('atk')) || { name: 'Basic Attack' };
  const primary = liveEnemies.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
  return { ability: basic, type: 'basic', targets: [ primary ] };
}

export function updatePassives(actor, dt) {
  if (actor.isDead) return;
  if (!actor.customResources) actor.customResources = {};
  if (typeof actor._furyTick === 'undefined') actor._furyTick = 0;
  actor._furyTick += dt;

  // Fury: gain from damage taken (1 Fury per 1% max hp lost) — accumulate in small ticks
  if (actor._lastHp === undefined) actor._lastHp = actor.currentHp;
  const hpLost = Math.max(0, (actor._lastHp || actor.maxHp) - actor.currentHp);
  if (hpLost > 0) {
    const gained = Math.floor((hpLost / (actor.maxHp || 1)) * 100); // 1% -> 1 Fury
    if (gained > 0) {
      actor.addResource && actor.addResource('Fury', gained, 9999);
      actor._lastHp = actor.currentHp;
    }
  } else {
    actor._lastHp = actor.currentHp;
  }

  // Passive: on ally death gain fixed Fury (handled via battle events sometimes; provide periodic scan)
  if (actor._furyTick >= 1.0) {
    actor._furyTick = 0;
    const battle = actor.battleSystem;
    if (battle && battle._lastDeadCount !== undefined) {
      const deadCount = (battle.allies.concat(battle.enemies)).filter(e => e.isDead).length;
      if (deadCount > (battle._lastDeadCount || 0)) {
        const delta = deadCount - (battle._lastDeadCount || 0);
        actor.addResource && actor.addResource('Fury', 25 * delta, 9999);
      }
      battle._lastDeadCount = deadCount;
    }
  }

  // Expose form flags
  const fury = Math.floor(actor.customResources['Fury'] || 0);
  actor.customResources['IsMeta'] = fury >= 100;
  actor.customResources['IsOmega'] = fury >= 250;
}

export async function getParsedAbility(ability, actor) {
  const name = String(ability.name || '').toLowerCase();
  if (name.includes('basic attack')) {
    return { typeCategory: 'basic', baseDmg: 0, scalePct: 1.0, scaleStat: 'atk', element: 'fire', multiHitCount: 1, cooldown: 1.8, visualKeyword: 'proj_sword' };
  }
  if (name.includes('plasma breath')) {
    return {
      typeCategory: 'skill',
      isAoE: true,
      targeting: 'cone',
      baseDmg: 30,
      scalePct: 0.2,
      scaleStat: 'magicAtk',
      multiHitCount: 3,
      cooldown: 8,
      statuses: [{ type: 'burn', duration: 3, value: 5, name: 'Minor Burn', tickInterval: 1 }],
      mechanics: { igniteChancePerHit: 0.0 } ,
      visualKeyword: 'vfx_fire_storm'
    };
  }
  if (name.includes('wing buffet')) {
    return {
      typeCategory: 'skill',
      baseDmg: 40,
      scalePct: 0.3,
      scaleStat: 'atk',
      isDash: true,
      cooldown: 10,
      statuses: [{ type: 'knockback', distance: 80 }],
      mechanics: { grantShieldOnBurnHit: true, shieldPct: 0.10 },
      visualKeyword: 'vfx_slash'
    };
  }
  if (name.includes('plasma divebomb') || (ability.type || '').toLowerCase() === 'ultimate') {
    return {
      typeCategory: 'ultimate',
      isAoE: true,
      baseDmg: 100,
      scalePct: 0.5,
      scaleStat: 'atk',
      baseMagicDmg: 80,
      magicScalePct: 0.4,
      cooldown: 90,
      channelDuration: 0.8,
      statuses: [{ type: 'heatwave', duration: 5, value: 30, tickInterval: 1, name: 'Heatwave' }, { type: 'debuff_speed', duration:3, value: -0.40 }],
      mechanics: { costResource: 'Fury', requiredForms: ['Meta Ridley','Omega Ridley'] },
      visualKeyword: 'vfx_explosion'
    };
  }
  if (name.includes('adaptive resilience') || name.includes('signature passive')) {
    return {
      typeCategory: 'passive',
      statuses: [{ type: 'buff_tenacity', value: 30, duration: Infinity }, { type: 'buff_evasion', value: 20, duration: Infinity }],
      mechanics: { onStatusGainGrantStacks: { atkPct: 0.05, matkPct:0.05, duration:5, maxStacks:5 } },
      visualKeyword: 'vfx_buff'
    };
  }
  if (name.includes('adaptive fury') || name.includes('passive')) {
    return {
      typeCategory: 'passive',
      mechanics: { furyGainOnDamagePercent: 1, furyOnAllyDeath: 25, transformThresholds: [100,250] }
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

  if (name.includes('plasma breath')) {
    if (!primary) return;
    ui.showAbilityName(actor, 'PLASMA BREATH VOLLEY');
    ui.playVfx(actor, 'vfx_fire_storm');
    // fire multiple projectiles in cone, apply burn per hit
    const hits = parsed?.multiHitCount || 3;
    for (let i=0;i<hits;i++) {
      // affect all enemies within cone heuristic (distance <=220)
      const enemiesPool = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);
      enemiesPool.forEach(e => {
        const dx = e.x - actor.x;
        const dy = e.y - actor.y;
        const dist = Math.hypot(dx,dy);
        if (dist <= 220) {
          const dmg = Math.floor((parsed.baseDmg || 30) + ((actor.effectiveMagicAtk || actor.stats["magic atk"]||0) * (parsed.scalePct || 0.2)));
          const res = e.receiveAction({ amount: dmg, type: 'magic', attackerElement: 'fire' });
          ui.showFloatingText(e, res.amount, 'damage-number magic');
          e.applyStatus({ type: 'burn', duration: 3, value: parsed?.statuses?.[0]?.value || 5, tickInterval:1, name: 'Minor Burn' });
          ui.playVfx(e, 'vfx_fire');
        }
      });
      await wait(160);
    }
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 8;
    return;
  }

  if (name.includes('wing buffet')) {
    if (!primary) return;
    ui.showAbilityName(actor, 'WING BUFFET');
    ui.playVfx(actor, 'vfx_slash');
    // Dash forward, damage enemies in path
    const enemiesPool = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);
    enemiesPool.forEach(e => {
      const dx = e.x - actor.x;
      const dy = e.y - actor.y;
      const dist = Math.hypot(dx,dy);
      // simple path check: within 80px of actor x-range
      if (Math.abs(dx) < 120 && Math.abs(dy) < 60) {
        const dmg = Math.floor((parsed.baseDmg || 40) + ((actor.effectiveAtk || actor.stats.atk||0) * (parsed.scalePct || 0.3)));
        const res = e.receiveAction({ amount: dmg, type: 'physical', attackerElement: 'physical' });
        ui.showFloatingText(e, res.amount, 'damage-number');
        // knockback
        e.applyStatus({ type: 'knockback', distance: parsed?.statuses?.[0]?.distance || 80, duration: 0.3 });
      }
    });
    // optional shield grant on upgraded form: handled by parsed.mechanics check at caller if actor has burn interactions (engine-level will check)
    if (actor.customResources && actor.customResources['IsOmega']) {
      const shieldVal = Math.floor(actor.maxHp * (parsed?.mechanics?.shieldPct || 0.10));
      actor.applyStatus && actor.applyStatus({ type: 'shield', value: shieldVal, duration: 4, name: 'WingShield' });
      ui.showFloatingText(actor, `SHIELD ${shieldVal}`, 'status-text buff');
    }
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 10;
    return;
  }

  if (name.includes('plasma divebomb') || (decision.type === 'ultimate')) {
    // Require form
    const fury = Math.floor(actor.getResource ? actor.getResource('Fury') : (actor.customResources?.['Fury']||0));
    if (fury < 100) {
      // not enough fury, abort
      return;
    }
    ui.showAbilityName(actor, 'PLASMA DIVEBOMB');
    ui.playVfx(actor, 'vfx_explosion');
    // Channel briefly
    actor.channeling = true;
    await wait(parsed?.channelDuration ? parsed.channelDuration * 1000 : 800);
    actor.channeling = false;
    const enemiesPool = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);
    enemiesPool.forEach(e => {
      const dist = Math.hypot(e.x - primary.x, e.y - primary.y);
      if (dist <= 220) {
        const phys = Math.floor((parsed.baseDmg || 100) + ((actor.effectiveAtk || actor.stats.atk||0) * (parsed.scalePct || 0.5)));
        const mag = Math.floor((parsed.baseMagicDmg || 80) + ((actor.effectiveMagicAtk || actor.stats["magic atk"]||0) * (parsed.magicScalePct || 0.4)));
        const res1 = e.receiveAction({ amount: phys, type: 'physical', attackerElement: 'physical' });
        const res2 = e.receiveAction({ amount: mag, type: 'magic', attackerElement: 'fire' });
        ui.showFloatingText(e, res1.amount + res2.amount, 'damage-number');
        ui.playVfx(e, 'vfx_explosion');
        // apply heatwave DoT
        e.applyStatus({ type: 'burn', duration: parsed?.statuses?.[0]?.duration || 5, value: parsed?.statuses?.[0]?.value || 30, tickInterval: 1, name: 'Heatwave' });
        // apply slow
        e.applyStatus({ type: 'debuff_speed', duration: parsed?.statuses?.[1]?.duration || 3, value: parsed?.statuses?.[1]?.value || -0.40 });
      }
    });
    // consume Fury optionally (reset to 0)
    if (actor.consumeResource) actor.consumeResource('Fury', fury);
    else actor.customResources['Fury'] = 0;
    actor.energy = 0;
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 90;
    return;
  }

  // Basic fallback (engine can handle, but give small VFX/energy)
  return;
}