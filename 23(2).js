/*
  Remote custom ability module for export_id 23 (Jesse Pinkman).
  Provides: decideAction, getParsedAbility, executeAction, updatePassives
*/

export async function decideAction(actor, enemies = [], allies = [], battle) {
  const liveEnemies = enemies.filter(e => !e.isDead);
  const liveAllies = allies.filter(a => !a.isDead && a !== actor);

  // Prefer ultimate when full energy and grouped enemies
  const ult = (actor.data?.abilities || []).find(a => String(a.type||'').toLowerCase() === 'ultimate');
  if (ult && actor.energy >= actor.maxEnergy && !actor.cooldownTimers?.[ult.name]) {
    const cluster = liveEnemies.sort((a,b)=>{
      const ca = liveEnemies.reduce((s,e)=> s + (Math.hypot(e.x-a.x,e.y-a.y) < 160 ? 1:0),0);
      const cb = liveEnemies.reduce((s,e)=> s + (Math.hypot(e.x-b.x,e.y-b.y) < 160 ? 1:0),0);
      return cb - ca;
    })[0] || liveEnemies[0];
    return { ability: ult, type: 'ultimate', targets: cluster ? [cluster] : liveEnemies.slice(0,3) };
  }

  // If AoE cloud available and there are at least 2 enemies or allies to buff, cast it at cluster center
  const cloud = (actor.data?.abilities || []).find(a => (a.name||'').toLowerCase().includes('methylamine'));
  if (cloud && !actor.cooldownTimers?.[cloud.name]) {
    const enemyCluster = liveEnemies.filter(e => Math.hypot(e.x - actor.x, e.y - actor.y) < 320);
    const allyCluster = liveAllies.filter(a => Math.hypot(a.x - actor.x, a.y - actor.y) < 320);
    if (enemyCluster.length + allyCluster.length >= 2) {
      // target approximate center of nearest cluster (use first enemy if exists)
      const target = enemyCluster[0] || allyCluster[0] || liveEnemies[0] || actor;
      return { ability: cloud, type: 'skill', targets: [target] };
    }
  }

  // Prefer Blue Sky Blitz when single high-value enemy present and off cooldown
  const blitz = (actor.data?.abilities || []).find(a => (a.name||'').toLowerCase().includes('blue sky blitz'));
  if (blitz && !actor.cooldownTimers?.[blitz.name]) {
    const priority = liveEnemies.sort((a,b)=>(a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
    if (priority) return { ability: blitz, type: 'skill', targets: [priority] };
  }

  // Otherwise use basic / incendiary round
  const basic = (actor.data?.abilities || []).find(a => (a.name||'').toLowerCase().includes('incendiary')) || { name: 'Basic Attack' };
  const tgt = liveEnemies.sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
  return { ability: basic, type: 'basic', targets: tgt ? [tgt] : [] };
}

export function updatePassives(actor, dt) {
  if (actor.isDead) return;
  // Wire! - Rock Bottom: when hit by negative status, once per 5s gain Chemistry stack and reduce incoming duration
  if (!actor._lastWireTick) actor._lastWireTick = 0;
  actor._lastWireTick -= dt;
  // Scan activeEffects for newly applied negative statuses and apply reaction if cooldown elapsed
  const negTypes = ['stun','silence','slow','freeze','root','blind','charm','mind_control'];
  const hasNeg = actor.activeEffects.some(e => negTypes.includes(String(e.type || '').toLowerCase()));
  if (hasNeg && actor._lastWireTick <= 0) {
    actor._lastWireTick = 5.0;
    actor.addResource && actor.addResource('Chemistry', 1, 999);
    // reduce durations of existing negative effects by 10%
    actor.activeEffects.forEach(e => {
      if (negTypes.includes(String(e.type || '').toLowerCase()) && e.duration !== Infinity) {
        e.duration = Math.max(0, e.duration * 0.9);
      }
    });
  }

  // Signature passive: Clarity HUD tick every 15s displayed externally by engine hooks; ensure customResources bounded
  if (!actor.customResources) actor.customResources = {};
  actor.customResources['Clarity'] = Math.max(-5, Math.min(5, actor.customResources['Clarity'] || 0));
}

export async function getParsedAbility(ability, actor) {
  const name = String(ability.name || '').toLowerCase();
  if (name.includes('incendiary')) {
    return {
      typeCategory: 'skill',
      baseDmg: 0,
      scalePct: 1.1,
      scaleStat: 'atk',
      element: 'fire',
      multiHitCount: 1,
      cooldown: 2.2,
      statuses: [{ type: 'cooked', duration: 3, value: 0.10, name: 'Cooked' }],
      visualKeyword: 'proj_sword'
    };
  }
  if (name.includes('methylamine') || name.includes('catalyst')) {
    return {
      typeCategory: 'skill',
      isAoE: true,
      targeting: 'area',
      auraRadius: 160,
      channelDuration: 0,
      cooldown: 14,
      isHeal: false,
      statuses: [
        { type: 'buff_speed', duration: 3, value: 0.10, name: 'Meth_Speed' },
        { type: 'buff_atk', duration: 3, value: 0.10, name: 'Meth_Atk' },
        { type: 'debuff_speed', duration: 5, value: 0.15, name: 'Meth_Slow', auraRadius: 0 }
      ],
      damagePerSecond: 30,
      visualKeyword: 'vfx_poison_cloud'
    };
  }
  if (name.includes('blue sky blitz')) {
    return {
      typeCategory: 'skill',
      baseDmg: 60,
      scalePct: 0,
      scaleStat: 'magicAtk',
      element: 'fire',
      multiHitCount: 1,
      cooldown: 10,
      isBurn: true,
      statuses: [
        { type: 'burn', duration: 4, value: 20, name: 'BlueSky_Burn' },
        { type: 'debuff_heal_received', duration: 4, value: -0.20, name: 'BlueSky_HealRed' }
      ],
      visualKeyword: 'vfx_fire'
    };
  }
  if (name.includes('chemical firestorm') || ability.type && String(ability.type).toLowerCase() === 'ultimate') {
    return {
      typeCategory: 'ultimate',
      isTransformation: false,
      cooldown: 75,
      channelDuration: 1.0,
      auraRadius: 200,
      baseDmg: 250,
      scalePct: 0.0, // handled in executeAction using Chemistry stacks
      statuses: [
        { type: 'buff_speed', duration: 6, value: 0.15, name: 'Firestorm_Surge' }
      ],
      visualKeyword: 'vfx_fire_storm'
    };
  }
  if (name.includes('wire!') || name.includes('rock bottom')) {
    return {
      typeCategory: 'passive',
      statuses: [
        { type: 'buff_tenacity', duration: Infinity, value: 10, name: 'Wire_Ten' },
        { type: 'buff_evasion', duration: Infinity, value: 5, name: 'Wire_Eva' }
      ],
      mechanics: { onNegativeStatusGainChemistry: true }
    };
  }
  if (name.includes('clarity')) {
    return {
      typeCategory: 'passive',
      mechanics: { clarityInterval: 15 },
      statuses: []
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
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // BASIC / Incendiary Round
  if (name.includes('incendiary')) {
    if (!primary) return;
    ui.showProjectile(actor, primary, 'proj_sword');
    await wait(200);
    const phys = Math.floor(actor.effectiveAtk * 1.1);
    const fire = Math.floor(actor.effectiveAtk * 0.5);
    const res1 = primary.receiveAction({ amount: phys, type: 'physical', attackerElement: 'physical' });
    const res2 = primary.receiveAction({ amount: fire, type: 'magic', attackerElement: 'fire' });
    ui.showFloatingText(primary, res1.amount + res2.amount, 'damage-number fire');
    primary.applyStatus({ type: 'cooked', duration: 3, value: 0.10, name: 'Cooked' });
    ui.playVfx(primary, 'vfx_sword');
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 2.2;
    return;
  }

  // Methylamine Catalyst (AoE Cloud)
  if (name.includes('methylamine')) {
    const target = primary && typeof primary.x === 'number' ? primary : actor;
    ui.showAbilityName(actor, 'METHYLAMINE CATALYST');
    ui.playVfx({ id: null, x: target.x || actor.x, y: target.y || actor.y }, 'vfx_poison_cloud');

    // Mastery Milestone: Lv.10 Cooldown
    actor.cooldownTimers[ability.name] = (actor.level >= 10) ? 12 : 14;

    // spawn AoE: apply immediate effects to entities inside radius for duration
    const radius = parsed?.auraRadius || 160;
    const duration = 5 * 1000;
    const start = Date.now();
    // immediate shield if Chemistry >=3: applied to allies entering cloud (we apply now)
    const chem = Math.floor(actor.getResource ? actor.getResource('Chemistry') : (actor.customResources?.['Chemistry']||0));
    const allies = (actor.team === 'ally' ? battle.allies : battle.enemies).filter(a => !a.isDead);
    const enemies = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);

    // periodic tick every 1s for damage
    let elapsed = 0;
    const tick = async () => {
      if (Date.now() - start >= duration) return;
      // damage enemies inside
      enemies.forEach(e => {
        const dist = Math.hypot((e.x||0) - (target.x||actor.x), (e.y||0) - (target.y||actor.y));
        if (dist <= radius) {
          const dps = parsed?.damagePerSecond || 30;
          const res = e.receiveAction({ amount: dps, type: 'magic', attackerElement: 'magic' });
          ui.showFloatingText(e, res.amount, 'damage-number magic');
          e.applyStatus({ type: 'debuff_speed', duration: 3, value: 0.15, name: 'Meth_Slow' });
          // Revamped Blind logic: gas cloud applies accuracy penalty
          e.applyStatus({ type: 'blind', duration: 2, value: 0.40, name: 'Methylamine Gas' });
        }
      });
      // buff allies inside
      allies.forEach(a => {
        const dist = Math.hypot((a.x||0) - (target.x||actor.x), (a.y||0) - (target.y||actor.y));
        if (dist <= radius) {
          a.applyStatus({ type: 'buff_speed', duration: 3, value: 0.10, name: 'Meth_Speed' });
          a.applyStatus({ type: 'buff_atk', duration: 3, value: 0.10, name: 'Meth_Atk' });
          if (chem >= 3) {
            const shieldVal = Math.floor(a.maxHp * 0.10);
            a.applyStatus({ type: 'shield', duration: 3, value: shieldVal, name: 'Meth_Shield' });
          }
        }
      });
      await wait(1000);
      elapsed += 1;
      if (elapsed * 1000 < duration) await tick();
    };
    tick().catch(()=>{});
    return;
  }

  // Blue Sky Blitz (single target burn + heal reduction / conditional behavior)
  if (name.includes('blue sky blitz')) {
    if (!primary) return;
    ui.showAbilityName(actor, 'BLUE SKY BLITZ');
    ui.playVfx(primary, 'vfx_fire');
    // initial hit
    const base = parsed?.baseDmg || 60;
    const res = primary.receiveAction({ amount: base, type: 'magic', attackerElement: 'fire' });
    ui.showFloatingText(primary, res.amount, 'damage-number magic');
    // apply burn
    primary.applyStatus({ type: 'burn', duration: 4, value: parsed?.statuses?.find(s=>s.type==='burn')?.value || 20, name: 'BlueSky_Burn' });
    primary.applyStatus({ type: 'debuff_heal_received', duration: 4, value: -0.20, name: 'BlueSky_HealRed' });

    // Chemistry conditional effects
    const chem = Math.floor(actor.getResource ? actor.getResource('Chemistry') : (actor.customResources?.['Chemistry']||0));
    if (chem >= 3) {
      // make burn grant vulnerability: +10% damage taken from all sources
      primary.applyStatus({ type: 'vulnerability_stack', duration: 4, stacks: 1, value: 0.10, name: 'BlueSky_Vuln' });
    } else if (chem < 0) {
      // weakened: initial damage halved and target healed over time instead of burning
      primary.receiveAction({ amount: -Math.floor(base * 0.5), effectType: 'heal' }); // immediate partial heal to simulate reversal
      // replace burn with small heal-over-time
      primary.applyStatus({ type: 'regen', duration: 4, percent: 0.01, name: 'BlueSky_ReverseHeal' });
    }
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 10;
    return;
  }

  // Ultimate: Chemical Firestorm
  if (name.includes('chemical firestorm') || decision.type === 'ultimate') {
    ui.showAbilityName(actor, 'CHEMICAL FIRESTORM!');
    ui.playVfx(actor, 'vfx_fire_storm');
    // channel
    actor.channeling = true;
    await wait(1000);
    actor.channeling = false;

    const radius = parsed?.auraRadius || 200;
    const enemiesPool = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);
    const alliesPool = (actor.team === 'ally' ? battle.allies : battle.enemies).filter(a => !a.isDead);

    const chem = Math.floor(actor.getResource ? actor.getResource('Chemistry') : (actor.customResources?.['Chemistry']||0));
    const bonusPct = chem > 0 ? Math.min(0.5, chem * 0.125) : 0; // scale up to 50% at high stacks
    enemiesPool.forEach(e => {
      const dist = Math.hypot(e.x - actor.x, e.y - actor.y);
      if (dist <= radius) {
        if (chem >= 0) {
          const dmg = Math.floor((parsed?.baseDmg || 250) * (1 + bonusPct));
          const r = e.receiveAction({ amount: dmg, type: 'magic', attackerElement: 'magic' });
          ui.showFloatingText(e, r.amount, 'damage-number magic');
        } else {
          // negative chemistry: apply burn DoT (flat)
          e.applyStatus({ type: 'burn', duration: 3, value: 50, name: 'Firestorm_NegBurn' });
        }
      }
    });

    // allies receive speed/attack speed buff (we model as buff_speed + buff_atk)
    alliesPool.forEach(a => {
      const dist = Math.hypot(a.x - actor.x, a.y - actor.y);
      if (dist <= radius) {
        a.applyStatus({ type: 'buff_speed', duration: 6, value: 0.15, name: 'Firestorm_Speed' });
        a.applyStatus({ type: 'buff_atk', duration: 6, value: 0.15, name: 'Firestorm_Atk' });
        // if upgraded positive chemistry, also grant damage reduction
        if (chem >= 1) a.applyStatus({ type: 'buff_def', duration: 6, value: 0.10, name: 'Firestorm_DamageRed' });
      }
    });

    // reset energy & set cooldown
    actor.energy = 0;
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 75;
    return;
  }

  // Fallback basic: do nothing special
  return;
}