/* 
  Character ability module for export_id "38" (Mega Man)
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

  if (name.includes('basic attack')) {
    return {
      typeCategory:'basic',
      baseDmg: 22,
      scalePct: 0.28,
      scaleStat: 'atk',
      element: 'fire',
      targeting: 'single',
      visualKeyword: 'mega_buster_shot',
      cooldown: 1.6
    };
  }

  if (name.includes('flame buster')) {
    return {
      typeCategory:'skill',
      baseDmg: 90,
      scalePct: 0.45,
      scaleStat: 'atk',
      element: 'fire',
      targeting: 'cone',
      auraRadius: 160,
      duration: 3,
      burnPerSecPct: 0.06,
      visualKeyword: 'mega_buster',
      cooldown: 10
    };
  }

  if (name.includes('solar bullet barrage')) {
    return {
      typeCategory:'skill',
      baseDmg: 0,
      scalePct: 0.7,
      scaleStat: 'atk',
      element: 'physical',
      targeting: 'single',
      multiHitCount: 6,
      vulnerabilityPerHitPct: 0.02,
      vulnerabilityDur: 5,
      visualKeyword: 'solar_burst',
      cooldown: 6
    };
  }

  if (name.includes('weapon archive') || name.includes('copy and adapt')) {
    return {
      typeCategory:'skill',
      analysisTime: 3,
      shieldPct: 0.10,
      shieldDuration: 5,
      visualKeyword: 'weapon_archive_vfx',
      cooldown: 24
    };
  }

  if (name.includes('double gear') || name.includes('overdrive barrage')) {
    return {
      typeCategory:'ultimate',
      duration: 10,
      powerGear:+0.5, // +50% damage
      speedGear:+0.5, // +50% speed
      overheatDuration: 15,
      visualKeyword: 'double_gear_vfx',
      cooldown: 120
    };
  }

  if (name.includes('heroic resolve')) {
    return {
      typeCategory:'passive',
      mechanics: {
        above75: { tenacity: 10 },
        below50: { tenacity: 20 },
        below25: { tenacity: 30, evasion: 0.10 }
      }
    };
  }

  if (name.includes('rapid fire') || name.includes('passive')) {
    return {
      typeCategory: 'passive',
      mechanics: { rampPerSecondPct: 0.05 }
    };
  }

  return null;
}

export async function decideAction(actor, enemies, allies, battle){
  const liveEnemies = (enemies||[]).filter(e=>!e.isDead);
  if (!liveEnemies.length) return { ability: { name: 'Basic Attack' }, targets: [] };

  const find = q => (actor.data.abilities||[]).find(a=> (a.name||'').toLowerCase().includes(q));
  const ult = find('double gear');
  const weapon = find('weapon archive');
  const solar = find('solar bullet barrage');
  const flame = find('flame buster');
  const basic = (actor.data.abilities||[]).find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };

  // Use ultimate when energy full and multiple enemies or when need burst
  if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
    if (liveEnemies.length >= 2) return { ability: ult, type: 'ultimate', targets: liveEnemies.slice(0,6) };
  }

  // Weapon Archive: use defensively when low HP or to copy high-threat enemy
  if (weapon && !actor.cooldownTimers?.[weapon.name]) {
    const lowAlly = allies.filter(a=>!a.isDead && (a.currentHp/a.maxHp) < 0.6)[0];
    if (lowAlly || liveEnemies.length >= 3) {
      return { ability: weapon, type: 'skill', targets: [ liveEnemies[0] ] };
    }
  }

  // Solar Bullet: single-target execute priority
  if (solar && !actor.cooldownTimers?.[solar.name]) {
    const low = liveEnemies.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
    if (low) return { ability: solar, type: 'skill', targets: [low] };
  }

  // Flame Buster: use for clustering and burn uptime
  if (flame && !actor.cooldownTimers?.[flame.name]) {
    const densest = liveEnemies.reduce((best,e)=>{
      const cnt = liveEnemies.filter(o=>Math.hypot(o.x-e.x,o.y-e.y)<=140).length;
      return cnt > best.c ? { e, c: cnt } : best;
    }, { e:null, c:0 });
    if (densest.c >= 2) return { ability: flame, type: 'skill', targets: [densest.e] };
  }

  return { ability: basic, type: 'basic', targets: [liveEnemies[0]] };
}

export async function executeAction(battle, actor, decision, parsed){
  if (!decision || !decision.ability) return;
  const ui = battle.uiManager;
  const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
  const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
  const liveEnemies = enemies.filter(e=>!e.isDead);
  const name = (decision.ability.name||'').toLowerCase();

  // small windup
  await new Promise(r=>setTimeout(r, (decision.type==='ultimate')?420:160));

  if (name.includes('basic attack')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 26;
    const dmg = Math.floor((parsed.baseDmg || 22) + atk * (parsed.scalePct || 0.28));
    const res = t.receiveAction({ amount: dmg, type:'physical', element: parsed.element || 'fire', attackerAccuracy: 20 });
    ui.showFloatingText(t, res.amount, 'damage-number');
    ui.playVfx(t, parsed.visualKeyword || 'mega_buster_shot');
    ui.playSound('mega_buster_shot');
    actor.energy = Math.min(actor.maxEnergy, actor.energy + 10);
    return;
  }

  if (name.includes('flame buster')) {
    const center = decision.targets && decision.targets[0] ? decision.targets[0] : actor;
    ui.playVfx(center, parsed.visualKeyword || 'mega_buster');
    ui.playSound('solar_burst');
    const atk = actor.effectiveAtk || actor.stats.atk || 26;
    const base = Math.floor((parsed.baseDmg || 90) + atk * (parsed.scalePct || 0.45));
    const inArea = liveEnemies.filter(e=>Math.hypot(e.x - center.x, e.y - center.y) <= (parsed.auraRadius || 160));
    inArea.forEach(e=>{
      const res = e.receiveAction({ amount: base, type:'magic', element:'fire', attackerAccuracy: 18 });
      ui.showFloatingText(e, res.amount, 'damage-number');
      // apply burn as regen-style DoT using applyStatus
      e.applyStatus({ type:'burn', duration: parsed.duration || 3, value: Math.max(1, Math.floor((actor.maxHp||actor.stats['max hp']||463) * (parsed.burnPerSecPct || 0.06))) });
    });
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 10;
    return;
  }

  if (name.includes('solar bullet barrage')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    ui.playVfx(t, parsed.visualKeyword || 'solar_burst');
    ui.playSound('mega_charge');
    const atk = actor.effectiveAtk || actor.stats.atk || 26;
    const hits = parsed.multiHitCount || 6;
    for (let i=0;i<hits;i++){
      await new Promise(r=>setTimeout(r, 110));
      const dmg = Math.floor((parsed.baseDmg || 0) + atk * (parsed.scalePct || 0.7));
      const res = t.receiveAction({ amount: dmg, type:'physical', element: parsed.element || 'physical', attackerAccuracy: 20 });
      ui.showFloatingText(t, res.amount, 'damage-number');
      // apply vulnerability stack
      t.applyStatus({ type:'vulnerability_stack', stacks:1, value: parsed.vulnerabilityPerHitPct || 0.02, duration: parsed.vulnerabilityDur || 5 });
    }
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 6;
    return;
  }

  if (name.includes('weapon archive') || name.includes('copy and adapt')) {
    const target = decision.targets && decision.targets[0] ? decision.targets[0] : liveEnemies[0];
    ui.playVfx(actor, parsed.visualKeyword || 'weapon_archive_vfx');
    ui.playSound('weapon_archive');
    // Simulate analysis time
    await new Promise(r=>setTimeout(r, (parsed.analysisTime || 3) * 1000));
    // Find a random active ability from target and copy minimal representation
    if (target && target.data && Array.isArray(target.data.abilities)) {
      const pick = pickRandom(target.data.abilities.filter(a => (a.type||'').toLowerCase() !== 'passive'));
      if (pick) {
        // store as custom temporary ability in actor.customResources
        actor.customResources = actor.customResources || {};
        actor.customResources['WeaponArchive'] = { name: pick.name, expiresAt: Date.now() + (20 * 1000) };
        // grant shield
        const shieldAmt = Math.floor((actor.maxHp || actor.stats['max hp'] || 463) * (parsed.shieldPct || 0.10));
        actor.receiveAction({ amount: shieldAmt, effectType: 'shield' });
        ui.showFloatingText(actor, `SHIELD ${shieldAmt}`, 'status-text buff');
      }
    }
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 24;
    return;
  }

  if (name.includes('double gear') || decision.type === 'ultimate') {
    ui.playVfx(actor, parsed.visualKeyword || 'double_gear_vfx');
    ui.playSound('double_gear');
    // Apply Power Gear and Speed Gear flags in customResources
    actor.customResources = actor.customResources || {};
    actor.customResources['PowerGear'] = parsed.powerGear || 0.5;
    actor.customResources['SpeedGear'] = parsed.speedGear || 0.5;
    // Apply immediate buffs
    actor.applyStatus({ type: 'buff_atk', value: parsed.powerGear || 0.5, duration: parsed.duration || 10 });
    actor.applyStatus({ type: 'buff_speed', value: parsed.speedGear || 0.5, duration: parsed.duration || 10 });
    // schedule overheat
    setTimeout(()=>{
      actor.applyStatus({ type:'overheat', duration: parsed.overheatDuration || 15 });
      ui.showFloatingText(actor, 'OVERHEAT', 'status-text');
      ui.playSound('overheat');
      delete actor.customResources['PowerGear'];
      delete actor.customResources['SpeedGear'];
    }, (parsed.duration || 10) * 1000 / Math.max(0.2, (battle.battleSpeed || 1)));
    actor.energy = 0;
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 120;
    return;
  }
}

export function updatePassives(actor, dt){
  actor.customResources = actor.customResources || {};
  actor.resourceDecayTimers = actor.resourceDecayTimers || {};

  // Heroic Resolve: apply tenacity/evasion based on HP thresholds
  const hpPct = (actor.currentHp || actor.maxHp || actor.stats['max hp'] || 1) / (actor.maxHp || actor.stats['max hp'] || 1);
  actor.passiveModifiers = actor.passiveModifiers || {};
  if (hpPct > 0.75) {
    actor.passiveModifiers.heroTenacity = 10;
    delete actor.passiveModifiers.heroEvasion;
  } else if (hpPct > 0.25) {
    actor.passiveModifiers.heroTenacity = 20;
    delete actor.passiveModifiers.heroEvasion;
  } else {
    actor.passiveModifiers.heroTenacity = 30;
    actor.passiveModifiers.heroEvasion = 0.10;
  }

  // Decay archive temporary ability
  if (actor.customResources && actor.customResources['WeaponArchive']) {
    const now = Date.now();
    if (actor.customResources['WeaponArchive'].expiresAt && actor.customResources['WeaponArchive'].expiresAt < now) {
      delete actor.customResources['WeaponArchive'];
    }
  }
}