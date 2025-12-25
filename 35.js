/*
  Character ability module for export_id "35" (GIR)
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
  if(name.includes('basic attack')){
    return {
      typeCategory:'basic',
      baseDmg: 24,
      scalePct: 0.28,
      scaleStat: 'atk',
      element: 'ice',
      targeting: 'single',
      visualKeyword: 'proj-ice',
      cooldown: 2.2
    };
  }

  if(name.includes('minimoose mayhem')){
    return {
      typeCategory:'skill',
      isSummon: true,
      summonName: 'Minimoose',
      duration: 5,
      auraRadius: 300,
      allyBuffs: { buff_speed: 0.10, buff_atk: 0.05 },
      enemyDebuff: { type: 'blind', value: 0.15, duration: 5 },
      selfBuff: { type: 'buff_evasion', value: 0.05, duration: 8 },
      visualKeyword: 'vfx_starlight',
      cooldown: 16
    };
  }

  if(name.includes('delicious distraction') || name.includes('taco barrage')){
    return {
      typeCategory:'skill',
      baseDmg: 40,
      scalePct: 0.22,
      scaleStat: 'atk',
      multiProj: 5,
      procChance: 0.30,
      greased: { defReducePct: 0.05, duration: 4, maxStacks: 3 },
      selfBuff: { type: 'buff_speed', value: 0.10, duration: 5 },
      visualKeyword: 'proj_fire',
      cooldown: 10
    };
  }

  if(name.includes('i need more sugar') || name.includes('erratic energy boost')){
    return {
      typeCategory:'passive',
      poolBuffs: [
        { type: 'buff_atk', value: 0.15 },
        { type: 'buff_matk', value: 0.15 },
        { type: 'buff_def', value: 0.10 },
        { type: 'buff_mdef', value: 0.10 },
        { type: 'buff_speed_flat', value: 20 }
      ],
      duration: 6,
      mechanic: { disguiseRoulette: true }
    };
  }

  if(name.includes('doom song') || name.includes('ultimate')){
    return {
      typeCategory:'ultimate',
      baseDmg: 120,
      scalePct: 0.9,
      scaleStat: 'magicAtk',
      targeting: 'aoe',
      radius: 500,
      hypnotizeDur: 3,
      shieldPct: 0.20,
      shieldDur: 6,
      visualKeyword: 'vfx_fire_storm',
      cooldown: 90
    };
  }

  if(name.includes('hyperactive hysteria')){
    return {
      typeCategory:'passive',
      signature: true,
      buffDuration: 5,
      actionSpeedScaling: { luckFactor: 0.002 },
      postDebuff: { type: 'debuff_def', value: -0.12, duration: 3 }
    };
  }

  return null;
}

export async function decideAction(actor, enemies = [], allies = [], battle){
  const liveEnemies = enemies.filter(e=>!e.isDead);
  const liveAllies = allies.filter(a=>!a.isDead && a !== actor);
  const abilities = actor.data.abilities || [];

  const find = q => abilities.find(a => (a.name||'').toLowerCase().includes(q));
  const ult = find('doom song');
  const summon = find('minimoose');
  const taco = find('taco barrage') || find('delicious distraction');
  const basic = abilities.find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };

  // Ultimate when energy full or many enemies clustered
  if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
    if (liveEnemies.length >= 3) return { ability: ult, type: 'ultimate', targets: liveEnemies.slice(0,6) };
  }

  // Use Minimoose to buff allies when allies present and not active
  if (summon && !actor.cooldownTimers?.[summon.name]) {
    if (liveAllies.length >= 1) {
      // target center of allies cluster or actor position
      const center = liveAllies.sort((a,b)=> (a.x||0)-(b.x||0))[0] || actor;
      return { ability: summon, type: 'skill', targets: [center] };
    }
  }

  // Use Taco Barrage on high-value or low-HP targets
  if (taco && !actor.cooldownTimers?.[taco.name]) {
    const low = liveEnemies.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
    if (low) return { ability: taco, type: 'skill', targets: [low] };
  }

  // Hyperactive Hysteria signature passive acts automatically; fallback basic
  return { ability: basic, type: 'basic', targets: [liveEnemies[0]] };
}

export async function executeAction(battle, actor, decision, parsed){
  if(!decision || !decision.ability) return;
  const ui = battle.uiManager;
  const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
  const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
  const liveEnemies = enemies.filter(e=>!e.isDead);
  const name = (decision.ability.name||'').toLowerCase();

  // windup
  await new Promise(r=>setTimeout(r, decision.type==='ultimate'?420:160));

  if (name.includes('basic attack')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 30;
    const dmg = Math.floor((parsed.baseDmg || 24) + atk * (parsed.scalePct || 0.28));
    const res = t.receiveAction({ amount: dmg, type:'physical', element: parsed.element || 'ice', attackerAccuracy: 18 });
    ui.showFloatingText(t, res.amount, 'damage-number');
    ui.showProjectile(actor, t, parsed.element || 'ice');
    ui.playVfx(t, 'vfx_ice');
    actor.energy = Math.min(actor.maxEnergy, (actor.energy || 0) + 8);
    return;
  }

  if (name.includes('minimoose')) {
    const center = decision.targets && decision.targets[0] ? decision.targets[0] : actor;
    ui.playVfx(center, parsed.visualKeyword || 'vfx_starlight');
    // Apply aura buff to allies and confuse enemies within radius
    const alliesIn = friends.filter(a => !a.isDead && Math.hypot(a.x - center.x, a.y - center.y) <= (parsed.auraRadius || 300));
    const enemiesIn = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= (parsed.auraRadius || 300));
    alliesIn.forEach(a => {
      a.applyStatus({ type:'buff_speed', value: parsed.allyBuffs?.buff_speed || 0.10, duration: parsed.duration || 5 });
      a.applyStatus({ type:'buff_atk', value: parsed.allyBuffs?.buff_atk || 0.05, duration: parsed.duration || 5 });
      ui.showFloatingText(a, 'MINIMOOSE AURA', 'status-text buff');
    });
    enemiesIn.forEach(e => {
      e.applyStatus({ type:'blind', value: parsed.enemyDebuff?.value || 0.15, duration: parsed.enemyDebuff?.duration || 5 });
      ui.showFloatingText(e, 'CONFUSED', 'status-text');
    });
    // Apply self disguise evasion
    actor.applyStatus({ type:'buff_evasion', value: parsed.selfBuff?.value || 0.05, duration: parsed.selfBuff?.duration || 8 });
    // Award a temporary summon marker (engine may use this)
    actor.customResources = actor.customResources || {};
    actor.customResources['MinimooseActive'] = parsed.duration || 5;
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 16;
    return;
  }

  if (name.includes('taco') || name.includes('delicious distraction')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const projCount = parsed.multiProj || parsed.multiProj === 0 ? parsed.multiProj : 5;
    const atk = actor.effectiveAtk || actor.stats.atk || 35;
    for (let i=0;i<projCount;i++){
      await new Promise(r=>setTimeout(r, 90));
      const dmg = Math.floor((parsed.baseDmg || 40) + atk * (parsed.scalePct || 0.22));
      const res = t.receiveAction({ amount: dmg, type:'physical', element:'physical', attackerAccuracy: 18 });
      ui.showFloatingText(t, res.amount, 'damage-number');
      ui.playVfx(t, 'proj_fire');
      // proc Greased
      if (Math.random() < (parsed.procChance || 0.30)) {
        // apply def reduction as debuff on target
        t.applyStatus({ type:'debuff_def', duration: parsed.greased?.duration || 4, modifiers: { def: -(parsed.greased?.defReducePct || 0.05) } });
        ui.showFloatingText(t, 'GREASED', 'status-text');
      }
    }
    // self speed disguise
    actor.applyStatus({ type:'buff_speed', value: parsed.selfBuff?.value || 0.10, duration: parsed.selfBuff?.duration || 5 });
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 10;
    return;
  }

  if (name.includes('doom song') || decision.type === 'ultimate') {
    ui.playVfx(actor, parsed.visualKeyword || 'vfx_fire_storm');
    // damage all enemies in radius
    const radius = parsed.radius || 500;
    const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 35;
    const dmg = Math.floor((parsed.baseDmg || 120) + matk * (parsed.scalePct || 0.9));
    liveEnemies.forEach(e => {
      const dist = Math.hypot(e.x - actor.x, e.y - actor.y);
      if (dist <= radius) {
        const res = e.receiveAction({ amount: dmg, type:'magic', element: parsed.element || 'magic', attackerAccuracy: 14 });
        ui.showFloatingText(e, res.amount, 'damage-number');
        // apply Hypnotized: force attack each other (engine must interpret)
        e.applyStatus({ type:'hypnotized', duration: parsed.hypnotizeDur || 3 });
      }
    });
    // apply shield to self
    const shieldAmt = Math.floor((actor.maxHp || actor.stats['max hp'] || 1000) * (parsed.shieldPct || 0.20));
    actor.receiveAction({ amount: shieldAmt, effectType: 'shield' });
    ui.showFloatingText(actor, `SHIELD ${shieldAmt}`, 'status-text buff');
    actor.energy = 0;
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 90;
    return;
  }

  // Signature Hyperactive Hysteria manual invocation (rare)
  if (name.includes('hyperactive hysteria')) {
    // pick nearest ally to buff
    const ally = (friends && friends.length) ? friends.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0] : actor;
    if (ally) {
      const speedBonus = 0.12 + ((actor.stats && actor.stats.luck) ? (actor.stats.luck * 0.002) : 0);
      ally.applyStatus({ type:'buff_action_speed', value: speedBonus, duration: parsed.buffDuration || 5 });
      // schedule post-debuff
      setTimeout(()=>{ ally.applyStatus({ type: parsed.postDebuff.type, value: parsed.postDebuff.value, duration: parsed.postDebuff.duration }); }, (parsed.buffDuration || 5)*1000);
      ui.showFloatingText(ally, 'HYPER BOOST', 'status-text buff');
    }
    return;
  }

  // fallback nothing
}

export function updatePassives(actor, dt){
  actor.customResources = actor.customResources || {};
  actor.resourceDecayTimers = actor.resourceDecayTimers || {};

  // Disguise Roulette: when disguise timer expires, randomly apply a passive buff from pool
  if (actor.customResources['DisguiseTimer'] > 0) {
    actor.customResources['DisguiseTimer'] = Math.max(0, actor.customResources['DisguiseTimer'] - dt);
  } else {
    // small chance to auto-roll a disguise buff every 8-12s if none active
    if (!actor._disguiseCooldown) actor._disguiseCooldown = 0;
    actor._disguiseCooldown -= dt;
    if (actor._disguiseCooldown <= 0) {
      actor._disguiseCooldown = 8 + Math.random() * 4;
      // pick a random buff from passive pool
      const parsedSig = (actor.abilityCache && actor.abilityCache['I Need More Sugar: Erratic Energy Boost']) || {};
      const pool = parsedSig.poolBuffs || [
        { type:'buff_atk', value:0.15 }, { type:'buff_matk', value:0.15 },
        { type:'buff_def', value:0.10 }, { type:'buff_mdef', value:0.10 }, { type:'buff_speed_flat', value:20 }
      ];
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const dur = parsedSig.duration || 6;
      if (pick.type === 'buff_speed_flat') actor.applyStatus({ type:'buff_speed', value: (pick.value/100) || 0.20, duration: dur });
      else actor.applyStatus({ type: pick.type, value: pick.value, duration: dur });
      // set disguise timer so this doesn't immediately re-roll
      actor.customResources['DisguiseTimer'] = dur;
    }
  }

  // Decay any active MinimooseActive timer
  if (actor.customResources['MinimooseActive'] > 0) {
    actor.customResources['MinimooseActive'] = Math.max(0, actor.customResources['MinimooseActive'] - dt);
  }

  // Signature passive might grant small shields on buff end; handle resource decay
  for (const k in actor.resourceDecayTimers) {
    actor.resourceDecayTimers[k] = Math.max(0, actor.resourceDecayTimers[k] - dt);
  }
}