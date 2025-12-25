/*
  Character ability module for export_id "33" (Scarecrow)
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
  if(name.includes('basic attack')){
    return {
      typeCategory:'basic',
      baseDmg: 18,
      scalePct: 0.22,
      scaleStat: 'atk',
      element: 'physical',
      targeting: 'single',
      multiHitCount: 1,
      cooldown: 2.4,
      visualKeyword: 'proj_sword'
    };
  }

  if(name.includes('fear toxin burst')){
    return {
      typeCategory:'skill',
      baseDmg: 80,
      scalePct: 0.4,
      scaleStat: 'magicAtk',
      element: 'magic',
      targeting: 'area',
      auraRadius: 160,
      duration: 3,
      tickInterval: 1,
      maxStacksPerTarget: 3,
      appliesStatus: { type: 'phobia', perTick: 1, maxStacks: 3 },
      visualKeyword: 'vfx_poison_cloud',
      cooldown: 10
    };
  }

  if(name.includes('psychotoxic spike')){
    return {
      typeCategory:'skill',
      baseDmg: 100,
      scalePct: 0.60,
      scaleStat: 'magicAtk',
      element: 'magic',
      targeting: 'single',
      appliesStatus: { type: 'phobia', stacks: 2 },
      consumesStatus: { type: 'phobia', scalePerStack: 0.20 }, // 20% extra damage per stack consumed
      visualKeyword: 'vfx_sword',
      cooldown: 8,
      unlockLevel: 40
    };
  }

  if(name.includes('reign of terror') || name.includes('ultimate')){
    return {
      typeCategory:'ultimate',
      baseDmg: 150,
      scalePct: 0.80,
      scaleStat: 'magicAtk',
      element: 'magic',
      targeting: 'aoe_all',
      appliesStatus: { type: 'phobia', stacks: 3 },
      nightmareDuration: 5,
      mechanics: {
        perRoleDebuff: true,
        horror_crit_down: 0.30,
        paranoia_shield_reduction: 0.25,
        delusion_heal_received_reduction: 0.25,
        panic_speed_down: 0.30
      },
      visualKeyword: 'vfx_fire_storm',
      cooldown: 90
    };
  }

  if(name.includes('master of psychological warfare') || name.includes('passive')){
    return {
      typeCategory:'passive',
      mechanics: {
        phobiaDamageReductionPerStackPct: 0.03,
        phobiaTenacityPerEnemy: 5,
        phobiaMaxTenacityBonus: 50
      }
    };
  }

  if(name.includes('harvest of nightmares') || name.includes('signature')){
    return {
      typeCategory:'passive',
      mechanics: {
        baseTenacity: 20,
        baseEvasion: 10,
        harvestStacksThreshold: 4,
        harvestWindow: 5,
        harvestCooldown: 12,
        harvestShieldPct: 0.05,
        harvestDamageAmpPct: 0.15,
        harvestCooldownResource: 'HarvestCooldown'
      }
    };
  }

  return null;
}

export async function decideAction(actor, enemies, allies, battle){
  const liveEnemies = (enemies||[]).filter(e=>!e.isDead);
  if (!liveEnemies.length) return { ability: { name: 'Basic Attack' }, targets: [] };

  const find = q => (actor.data.abilities||[]).find(a=> (a.name||'').toLowerCase().includes(q));
  const ult = find('reign of terror');
  const burst = find('fear toxin burst');
  const spike = find('psychotoxic spike');
  const basic = (actor.data.abilities||[]).find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };

  // Ultimate: use when energy full or when 3+ enemies alive / many phobia stacks on field
  const totalPhobiaStacks = liveEnemies.reduce((s,e)=>(s + (e.activeEffects.filter(x=>x.type==='phobia').reduce((ss,st)=>ss + (st.stacks||st.value||1),0))),0);
  if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
    if (liveEnemies.length >= 3 || totalPhobiaStacks >= 6) return { ability: ult, type: 'ultimate', targets: liveEnemies.slice(0,6) };
  }

  // Fear Toxin Burst: prefer clusters or to apply initial cloud early
  if (burst && !actor.cooldownTimers?.[burst.name]) {
    // find densest enemy to center cloud
    let best = null, bestCount = 0;
    for (const e of liveEnemies){
      const cnt = liveEnemies.filter(o=>Math.hypot(o.x - e.x, o.y - e.y) <= 160).length;
      if (cnt > bestCount){ bestCount = cnt; best = e; }
    }
    if (bestCount >= 2) return { ability: burst, type: 'skill', targets: [best] };
  }

  // Psychotoxic Spike: prefer single target finishing or to consume phobia stacks on a high-value target
  if (spike && !actor.cooldownTimers?.[spike.name]) {
    // target that has phobia stacks or lowest %HP
    const withPhobia = liveEnemies.filter(e => e.activeEffects.some(s => s.type === 'phobia' && (s.stacks||s.value)>0));
    if (withPhobia.length) return { ability: spike, type: 'skill', targets: [withPhobia.sort((a,b)=>((b.activeEffects.find(x=>x.type==='phobia')?.stacks||0)-(a.activeEffects.find(x=>x.type==='phobia')?.stacks||0)))[0]] };
    // otherwise use on lowest HP
    const low = liveEnemies.sort((a,b)=>(a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
    if (low) return { ability: spike, type: 'skill', targets: [low] };
  }

  // Fallback basic nearest
  const nearest = liveEnemies.sort((a,b)=>Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
  return { ability: basic, type: 'basic', targets: [nearest] };
}

export async function executeAction(battle, actor, decision, parsed){
  if (!decision || !decision.ability) return;
  const ui = battle.uiManager;
  const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
  const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
  const liveEnemies = enemies.filter(e=>!e.isDead);
  const name = (decision.ability.name||'').toLowerCase();

  // small windup
  await new Promise(r=>setTimeout(r, decision.type==='ultimate'?420:180));

  // BASIC
  if (name.includes('basic attack')){
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 14;
    const dmg = Math.floor((parsed.baseDmg || 18) + atk * (parsed.scalePct || 0.22));
    const res = t.receiveAction({ amount: dmg, type: 'physical', element: parsed.element, attackerAccuracy: 18 });
    ui.showFloatingText(t, res.amount, 'damage-number');
    ui.showProjectile(actor, t, parsed.element || 'physical');
    ui.playVfx(t, parsed.visualKeyword || 'proj_fire');
    actor.energy = Math.min(actor.maxEnergy, actor.energy + 8);
    return;
  }

  // FEAR TOXIN BURST
  if (name.includes('fear toxin burst')){
    const center = decision.targets && decision.targets[0] ? decision.targets[0] : { x: actor.x, y: actor.y };
    ui.playVfx(center, parsed.visualKeyword || 'vfx_poison_cloud');
    // initial wave
    const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 14;
    const initial = Math.floor((parsed.baseDmg || 80) + matk * (parsed.scalePct || 0.4));
    const inArea = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= (parsed.auraRadius || 160));
    for (const t of inArea){
      const res = t.receiveAction({ amount: initial, type: 'magic', element: 'magic', attackerAccuracy: 16 });
      ui.showFloatingText(t, res.amount, 'damage-number');
      // apply 1 phobia stack (use .applyStatus with stacks)
      t.applyStatus({ type: 'phobia', stacks: 1, duration: (parsed.duration || 3)+1 });
    }

    // cloud ticks each second for duration; each tick deals (base/tick) and grants one phobia stack up to maxStacksPerTarget
    const ticks = Math.max(1, Math.floor(parsed.duration || 3));
    let tickCount = 0;
    const tickLoop = setInterval(()=>{
      tickCount++;
      const matk2 = actor.effectiveMagicAtk || actor.stats['magic atk'] || 14;
      const tickDmg = Math.floor((parsed.baseDmg || 80) * 0.25 + matk2 * ((parsed.scalePct||0.4) * 0.25));
      for (const t of liveEnemies.filter(e => !e.isDead && Math.hypot(e.x - center.x, e.y - center.y) <= (parsed.auraRadius || 160))){
        // apply damage per second
        const res = t.receiveAction({ amount: tickDmg, type: 'magic', element: 'magic', attackerAccuracy: 14 });
        ui.showFloatingText(t, res.amount, 'damage-number');
        // add phobia stack but cap by maxStacksPerTarget
        const existing = t.activeEffects.find(eff => eff.type === 'phobia');
        const currentStacks = existing ? (existing.stacks || existing.value || 0) : 0;
        if (currentStacks < (parsed.maxStacksPerTarget || 3)){
          t.applyStatus({ type: 'phobia', stacks: 1, duration: Math.max(3, parsed.duration||3) });
        }
      }
      if (tickCount >= ticks) clearInterval(tickLoop);
    }, 1000 / Math.max(0.2, (battle.battleSpeed || 1)));
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 10;
    return;
  }

  // PSYCHOTOXIC SPIKE
  if (name.includes('psychotoxic spike')){
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    ui.playVfx(t, parsed.visualKeyword || 'vfx_sword');
    const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 14;
    let base = Math.floor((parsed.baseDmg || 100) + matk * (parsed.scalePct || 0.6));
    // apply 2 phobia stacks
    const existing = t.activeEffects.find(e => e.type === 'phobia');
    const existingStacks = existing ? (existing.stacks || existing.value || 0) : 0;
    // damage amplification by consuming stacks
    let consumed = 0;
    if (existingStacks > 0){
      consumed = existingStacks;
      // remove phobia stacks fully
      if (t.consumeResource) { /* no-op: consistent API not always present */ }
      // emulate consumption by reducing stacks explicitly
      if (existing) {
        existing.stacks = 0;
        existing.duration = 0;
      }
      base = Math.floor(base * (1 + (parsed.consumesStatus ? (parsed.consumesStatus.scalePerStack || 0.2) * consumed : 0.2 * consumed)));
    }
    const res = t.receiveAction({ amount: base, type: 'magic', element: 'magic', attackerAccuracy: 18 });
    ui.showFloatingText(t, res.amount, 'damage-number');
    t.applyStatus({ type: 'phobia', stacks: 2, duration: 6 });
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 8;
    return;
  }

  // REIGN OF TERROR (ULTIMATE)
  if (name.includes('reign of terror') || decision.type === 'ultimate'){
    ui.playAbilityName(actor, decision.ability.name || 'Reign of Terror');
    ui.playVfx(actor, parsed.visualKeyword || 'vfx_fire_storm');
    const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 14;
    const base = Math.floor((parsed.baseDmg || 150) + matk * (parsed.scalePct || 0.8));
    // initial strike to all enemies
    for (const t of liveEnemies){
      const res = t.receiveAction({ amount: base, type: 'magic', element: 'magic', attackerAccuracy: 16 });
      ui.showFloatingText(t, res.amount, 'damage-number crit');
      // apply 3 phobia stacks (cap handled by applyStatus logic)
      t.applyStatus({ type: 'phobia', stacks: 3, duration: parsed.nightmareDuration || 5 });
      // apply role-specific nightmare debuffs
      const role = (t.data.role||'').toLowerCase();
      if (role.includes('damage') || (t.stats && t.stats.atk >= Math.max(t.stats.def || 0, t.stats['magic atk'] || 0))) {
        // Horror: crit chance -30%
        t.applyStatus({ type: 'debuff_crit', duration: parsed.nightmareDuration || 5, value: -0.30, name: 'Horror' });
      } else if (role.includes('tank') || (t.stats && t.stats.def >= Math.max(t.stats.atk || 0, t.stats['magic def'] || 0))) {
        t.applyStatus({ type: 'debuff_shield_eff', duration: parsed.nightmareDuration || 5, value: -0.25, name: 'Paranoia' });
      } else if (role.includes('mage') || (t.stats && t.stats['magic atk'] >= Math.max(t.stats.atk || 0, t.stats.def || 0))) {
        t.applyStatus({ type: 'debuff_heal_received', duration: parsed.nightmareDuration || 5, value: -0.25, name: 'Delusion' });
      } else if (role.includes('speed') || (t.stats && t.stats.speed >= 1)) {
        t.applyStatus({ type: 'debuff_speed', duration: parsed.nightmareDuration || 5, value: -0.30, name: 'Panic' });
      }
    }

    // ultimate side-effects e.g., target-based silence if upgraded - handled by parsed/mechanics in higher-level systems
    actor.energy = 0;
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 90;
    return;
  }

  // PASSIVE/OTHER fallback - no-op
  return;
}

export function updatePassives(actor, dt){
  // Master of Psychological Warfare passive upkeep:
  // Count enemies with phobia stacks and update actor passive modifiers (tenacity + enemy damage reduction handled via statuses on enemies)
  try {
    const battle = actor.battleSystem;
    if (!battle) return;
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const live = (enemies||[]).filter(e => !e.isDead);
    let enemiesWithPhobia = 0;
    live.forEach(e => {
      const ph = e.activeEffects.find(s => s.type === 'phobia');
      if (ph && (ph.stacks || ph.value || 0) > 0) enemiesWithPhobia++;
      // also apply per-enemy damage reduction based on stacks: 3% per stack up to specified cap
      if (ph && (ph.stacks || ph.value)) {
        const stacks = Math.min(3, (ph.stacks||ph.value||0));
        // Apply a debuff on enemy that reduces outgoing damage; store as effect to be read by damage resolution
        e.applyStatus({ type: 'debuff_outgoing_damage', duration: 1.5, value: -(stacks * 0.03), name: 'Phobia_Drain' });
      }
    });

    // Tenacity gained per enemy with phobia (5 per enemy default)
    const parsedPassive = actor.data.abilities?.find(a=> (a.name||'').toLowerCase().includes('master of psychological warfare'));
    const tenPer = parsedPassive ? (parsedPassive.mechanics?.tenacityPerEnemy || 5) : 5;
    const totalTen = Math.min((parsedPassive?.mechanics?.phobiaTenacityCap) || 50, enemiesWithPhobia * tenPer);
    actor.passiveModifiers = actor.passiveModifiers || {};
    actor.passiveModifiers.masterPhobiaTenacity = totalTen;

    // Signature passive: Harvest of Nightmares - track when any enemy reaches threshold stacks and grant temporary buff if available
    const signature = actor.data.abilities?.find(a=> (a.name||'').toLowerCase().includes('harvest of nightmares'));
    if (signature) {
      const thresh = signature.mechanics?.harvestStacksThreshold || 4;
      const existsHarvest = live.some(e => {
        const ph = e.activeEffects.find(s => s.type === 'phobia');
        return ph && (ph.stacks || ph.value || 0) >= thresh;
      });
      if (existsHarvest && !(actor.customResources && actor.customResources['HarvestCooldown'] > 0)) {
        // grant harvest window buffs
        actor.applyStatus({ type: 'buff_magic', value: signature.mechanics?.harvestDamageAmpPct || 0.15, duration: signature.mechanics?.harvestWindow || 5, name: 'Harvest_Buff' });
        actor.applyStatus({ type: 'shield', value: Math.max(1, Math.floor(actor.maxHp * (signature.mechanics?.harvestShieldPct || 0.05))), duration: signature.mechanics?.harvestWindow || 5, name: 'Harvest_Shield' });
        // set cooldown resource so it can't proc repeatedly
        actor.customResources = actor.customResources || {};
        actor.customResources['HarvestCooldown'] = signature.mechanics?.harvestCooldown || 12;
        actor.resourceDecayTimers = actor.resourceDecayTimers || {};
        actor.resourceDecayTimers['HarvestCooldown'] = actor.customResources['HarvestCooldown'];
      }
      // decay harvest cooldown resource
      if (actor.customResources && actor.customResources['HarvestCooldown'] > 0) {
        actor.resourceDecayTimers['HarvestCooldown'] = Math.max(0, (actor.resourceDecayTimers['HarvestCooldown'] || 0) - dt);
        actor.customResources['HarvestCooldown'] = Math.max(0, actor.customResources['HarvestCooldown'] - dt);
      }
    }
  } catch (e) {
    // silent fail to avoid breaking battle loop
  }
}