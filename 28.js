/*
  Local custom ability module for export_id 28 (Lop).
  Implements: decideAction, getParsedAbility, executeAction, updatePassives
*/

export async function decideAction(actor, enemies = [], allies = [], battle) {
  const liveEnemies = enemies.filter(e => !e.isDead);
  const liveAllies = allies.filter(a => !a.isDead && a !== actor);
  if (liveEnemies.length === 0) return { ability: { name: 'Quarren Quickstep' }, type: 'basic', targets: [] };

  // Prefer ultimate when ready and multiple allies present
  const ult = (actor.data?.abilities || []).find(a => String(a.type || '').toLowerCase() === 'ultimate');
  if (ult && actor.energy >= actor.maxEnergy && !actor.cooldownTimers?.[ult.name]) {
    if (liveAllies.length >= 2) return { ability: ult, type: 'ultimate', targets: liveAllies.slice(0, 6) };
  }

  // Use Caravan's Cover to save low ally or to proactively shield a key ally
  const shield = (actor.data?.abilities || []).find(a => (a.name||'').toLowerCase().includes("caravan"));
  if (shield && !actor.cooldownTimers?.[shield.name]) {
    const lowAlly = [actor, ...liveAllies].sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
    if (lowAlly && (lowAlly.currentHp / lowAlly.maxHp) < 0.65) return { ability: shield, type: 'skill', targets: [lowAlly] };
  }

  // Stance toggling: if signature off cooldown, decide based on team state
  const stance = (actor.data?.abilities || []).find(a => (a.type || '').toLowerCase() === 'signature' || (a.name||'').toLowerCase().includes('adaptable anomaly'));
  if (stance && !actor.cooldownTimers?.[stance.name]) {
    // If allies need magic resist or healing, go Resonance; else Kinetic
    const alliesNeedMagRes = liveAllies.some(a => a.activeEffects.some(e => e.type === 'burn' || e.type === 'poison'));
    const decisionStance = alliesNeedMagRes ? 'resonance' : 'kinetic';
    return { ability: stance, type: 'skill', targets: [ { stance: decisionStance } ] };
  }

  // If a high-priority clustered enemy and signature not used, prefer AoE-ish behavior via ultimate fallback
  const clustered = liveEnemies.map(e => {
    const near = liveEnemies.reduce((s,x)=> s + (Math.hypot(e.x-x.x,e.y-x.y) < 140 ? 1:0),0);
    return { e, near };
  }).sort((a,b)=> b.near - a.near)[0];
  if (clustered && clustered.near >= 2 && !actor.cooldownTimers?.[ult?.name]) {
    // if ult not ready but signature available, try signature; otherwise basic to cluster center
    return { ability: (stance || { name:'Quarren Quickstep' }), type: 'skill', targets: [clustered.e] };
  }

  // Default: use Quarren Quickstep on lowest HP enemy
  const basic = (actor.data?.abilities || []).find(a => (a.name||'').toLowerCase().includes('quarren')) || { name: 'Quarren Quickstep' };
  const primary = liveEnemies.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
  return { ability: basic, type: 'basic', targets: [primary] };
}

export function updatePassives(actor, dt) {
  if (actor.isDead) return;
  if (!actor.customResources) actor.customResources = {};
  // Prepared stacks: ensure bounded and decay slowly when not refreshed
  if (typeof actor._preparedTick === 'undefined') actor._preparedTick = 0;
  actor._preparedTick += dt;
  if (actor._preparedTick >= 1.0) {
    actor._preparedTick = 0;
    if (actor._preparedPending) {
      actor.customResources['Prepared'] = Math.min(3, (actor.customResources['Prepared'] || 0) + 1);
      actor._preparedPending = false;
    }
    // gentle decay of prepared stacks out of combat
    if (!actor.battleSystem || !actor.battleSystem.enemies.some(e => !e.isDead)) {
      actor.customResources['Prepared'] = Math.max(0, (actor.customResources['Prepared'] || 0) - 0.02);
    }
  }

  // Expose current passive bonuses as customResources for UI consumption
  const stacks = Math.floor(actor.customResources['Prepared'] || 0);
  actor.customResources['Kyuzo_MagicDef'] = stacks * 3;
  actor.customResources['Kyuzo_TenacityPct'] = stacks * 0.03;
}

export async function getParsedAbility(ability, actor) {
  const name = String(ability.name || '').toLowerCase();
  if (name.includes('quarren quickstep') || name.includes('basic attack')) {
    return { typeCategory: 'basic', baseDmg: 7, scalePct: 0.0, scaleStat: 'atk', element: 'physical', multiHitCount:1, cooldown: 1.8, statuses: [{ type:'wound', duration: 2, value:0.10 }], mechanics: { grantEvasionPct: 0.05 }, visualKeyword: 'vfx_sword' };
  }
  if (name.includes('kyuzo clothweave') || name.includes('passive')) {
    return { typeCategory: 'passive', mechanics: { onAllyDamagedGrantPrepared: true, maxStacks:3, perStackMagicDef:3, perStackTenacityPct:0.03, onConsumeChanceCCResist:0.20 }, statuses: [] };
  }
  if (name.includes('caravan') || name.includes('cover')) {
    return { typeCategory: 'skill', isShield: true, shieldValue: 15, duration: 3, cooldown: 10, statuses: [{ type:'buff_tenacity', value:0.10, duration:3 }], mechanics: { onFullConsumeGrantSpeed:7 }, visualKeyword: 'vfx_shield' };
  }
  if (name.includes('adaptable anomaly') || name.includes('signature')) {
    return { typeCategory: 'signature', mechanics: { duration:6, cooldown:1, kineticBonusPctOfSpeed:0.10, kineticMovePct:0.10, resonanceRangePct:0.10, resonanceAuraMagicResPct:0.05, resonanceHealBurst:8 }, statuses: [] };
  }
  if (name.includes("elders' vigilance") || name.includes('ultimate')) {
    return { typeCategory: 'ultimate', isAoE: true, duration:5, radius: 15 * 40, cooldown:75, statuses: [{ type:'buff_crit', value:0.15, duration:5 }, { type:'buff_heal_received_pct', value:0.10, duration:5 }, { type:'debuff_accuracy', value:-0.10, duration:5 }, { type:'debuff_speed', value:-0.05, duration:5 }], mechanics: { explosionDamage:15 }, visualKeyword: 'vfx_arcane_circle' };
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

  if (name.includes('quarren quickstep') || ability.type && String(ability.type).toLowerCase().includes('basic')) {
    if (!primary) return;
    ui.showAbilityName(actor, 'QUARREN QUICKSTEP');
    ui.playVfx(actor, 'vfx_sword');
    await wait(140);
    const dmg = Math.max(1, Math.floor(parsed?.baseDmg || 7));
    const res = primary.receiveAction({ amount: dmg, type: 'physical', attackerElement: 'physical' });
    ui.showFloatingText(primary, res.amount, 'damage-number');
    // Wound application chance
    if (Math.random() < 0.30) {
      primary.applyStatus({ type: 'wound', duration: 2, value: 0.10, name: 'WOUND' });
      ui.showFloatingText(primary, 'WOUND', 'status-text');
    }
    // Grant Lop evasion buff for next turn
    actor.applyStatus({ type: 'buff_evasion', value: parsed?.mechanics?.grantEvasionPct || 0.05, duration: 1, name: 'Quickstep_Evasion' });
    return;
  }

  if (name.includes('caravan') || name.includes('cover')) {
    if (!primary) return;
    ui.showAbilityName(actor, "CARAVAN'S COVER");
    ui.playVfx(primary, 'vfx_shield');
    const shieldVal = Math.floor(parsed?.shieldValue || 15);
    primary.applyStatus({ type: 'shield', value: shieldVal, duration: parsed?.duration || 3, name: 'Caravan_Shield' });
    primary.applyStatus({ type: 'buff_tenacity', value: parsed?.statuses?.find(s=>s.type==='buff_tenacity')?.value || 0.10, duration: parsed?.duration || 3, name: 'Caravan_Ten' });
    ui.showFloatingText(primary, `SHIELD ${shieldVal}`, 'status-text buff');

    // Monitor shield consumption: spawn a small listener flag on the ally to apply speed when shield broken
    // We'll implement via a transient activeEffect that listens for shield <=0 by tick in BattleCharacter.update
    primary.applyStatus({ type: 'caravan_shield_watch', duration: parsed?.duration || 3, value: parsed?.mechanics?.onFullConsumeGrantSpeed || 7, name: 'Caravan_Watch' });

    actor.cooldownTimers[ability.name] = parsed?.cooldown || 10;
    return;
  }

  if (name.includes('adaptable anomaly') || (ability.type || '').toLowerCase() === 'signature') {
    // Expect decision.targets[0] to be an object like { stance: 'kinetic' } when chosen by decideAction
    const st = (targets && targets[0] && targets[0].stance) ? targets[0].stance : 'kinetic';
    ui.showAbilityName(actor, `ADAPTABLE ANOMALY: ${st.toUpperCase()}`);
    if (st === 'kinetic') {
      actor.applyStatus({ type: 'stance_kinetic', duration: parsed?.mechanics?.duration || 6, name: 'Kinetic_Stance', value: parsed?.mechanics?.kineticBonusPctOfSpeed || 0.10 });
      actor.applyStatus({ type: 'buff_speed', value: parsed?.mechanics?.kineticMovePct || 0.10, duration: parsed?.mechanics?.duration || 6, name: 'Kinetic_Speed' });
      ui.showFloatingText(actor, 'Kinetic Stance', 'status-text buff');
    } else {
      // resonance
      actor.applyStatus({ type: 'stance_resonance', duration: parsed?.mechanics?.duration || 6, name: 'Resonance_Stance' });
      // apply aura: allies within 10 units get magic damage resistance
      actor.applyStatus({ type: 'aura_magic_res', auraRadius: 10 * 40, auraEffect: { type: 'buff_magicdef_pct', value: parsed?.mechanics?.resonanceAuraMagicResPct || 0.05, duration: 2 }, auraTarget: 'ally', duration: parsed?.mechanics?.duration || 6, name: 'Resonance_Aura' });
      // burst heal
      const allies = (actor.team === 'ally' ? battle.allies : battle.enemies).filter(a => !a.isDead);
      allies.forEach(a => {
        const dist = Math.hypot(a.x - actor.x, a.y - actor.y);
        if (dist <= 10 * 40) {
          a.receiveAction({ amount: parsed?.mechanics?.resonanceHealBurst || 8, effectType: 'heal' });
          ui.showFloatingText(a, `+${parsed?.mechanics?.resonanceHealBurst || 8}`, 'damage-number heal');
        }
      });
      ui.showFloatingText(actor, 'Resonance Stance', 'status-text buff');
    }
    actor.cooldownTimers[ability.name] = 1; // 1 turn cooldown as described
    return;
  }

  if (name.includes("elders' vigilance") || (ability.type || '').toLowerCase() === 'ultimate') {
    ui.showAbilityName(actor, "ELDERS' VIGILANCE");
    ui.playVfx(actor, 'vfx_arcane_circle');
    const radiusPx = (parsed?.radius) || (15 * 40);
    const alliesPool = (actor.team === 'ally' ? battle.allies : battle.enemies).filter(a => !a.isDead);
    alliesPool.forEach(a => {
      const dist = Math.hypot(a.x - actor.x, a.y - actor.y);
      if (dist <= radiusPx) {
        a.applyStatus({ type: 'buff_crit', value: parsed?.statuses?.find(s=>s.type==='buff_crit')?.value || 0.15, duration: parsed?.duration || 5, name: "Vigil_Crit" });
        a.applyStatus({ type: 'buff_heal_received_pct', value: parsed?.statuses?.find(s=>s.type==='buff_heal_received_pct')?.value || 0.10, duration: parsed?.duration || 5, name: "Vigil_HealRec" });
      }
    });
    // debuff enemies in field
    const enemiesPool = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);
    enemiesPool.forEach(e => {
      const dist = Math.hypot(e.x - actor.x, e.y - actor.y);
      if (dist <= radiusPx) {
        e.applyStatus({ type: 'debuff_accuracy', value: parsed?.statuses?.find(s=>s.type==='debuff_accuracy')?.value || -0.10, duration: parsed?.duration || 5, name: "Vigil_AccDown" });
        e.applyStatus({ type: 'debuff_speed', value: parsed?.statuses?.find(s=>s.type==='debuff_speed')?.value || -0.05, duration: parsed?.duration || 5, name: "Vigil_SpdDown" });
      }
    });

    // schedule explosion at end of duration using setTimeout (non-blocking)
    const explosionDmg = parsed?.mechanics?.explosionDamage || 15;
    setTimeout(() => {
      enemiesPool.forEach(e => {
        const dist = Math.hypot(e.x - actor.x, e.y - actor.y);
        if (dist <= radiusPx && !e.isDead) {
          const r = e.receiveAction({ amount: explosionDmg, type: 'magic', attackerElement: 'magic' });
          ui.showFloatingText(e, r.amount, 'damage-number magic');
          ui.playVfx(e, 'vfx_explosion');
        }
      });
    }, (parsed?.duration || 5) * 1000);

    actor.energy = 0;
    actor.cooldownTimers[ability.name] = parsed?.cooldown || 75;
    return;
  }

  // Fallback: no-op so engine handles basic default
  return;
}