/*
  Character ability module for export_id "37" (Ice King)
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
      typeCategory: 'basic',
      baseDmg: 14,
      scalePct: 0.22,
      scaleStat: 'atk',
      element: 'fire',
      targeting: 'single',
      visualKeyword: 'proj_fire',
      cooldown: 1.6
    };
  }

  if (name.includes('ice lightning barrage')) {
    return {
      typeCategory: 'skill',
      baseDmg: 50,
      scalePct: 0.20,
      scaleStat: 'magicAtk',
      element: 'magic',
      targeting: 'cone',
      multiProj: 3,
      coneAngleDeg: 45,
      freezeChance: 0.30,
      freezeDur: 0.5,
      visualKeyword: 'lightning',
      cooldown: 8
    };
  }

  if (name.includes('summon ice-o-pede') || name.includes('ice-o-pede')) {
    return {
      typeCategory: 'summon',
      summonName: 'Ice-o-pede',
      duration: 15,
      summonHp: 300,
      summonHpScalePct: 0.5, // 300 + 0.5 * X handled in execute
      attackDmgBase: 40,
      attackScalePct: 0.15,
      shieldOnFrozenFortressPct: 0.20,
      explodeDmgBase: 50,
      explodeScalePct: 0.2,
      visualKeyword: 'ice_o_pede',
      cooldown: 20
    };
  }

  if (name.includes('wizard eyes') || name.includes('wizard eyes of')) {
    return {
      typeCategory: 'passive',
      stackInterval: 10,
      maxStacks: 3,
      buffs: [
        { type: 'buff_def', value: 0.20, name: 'Wizard_Def' },
        { type: 'buff_matk', value: 0.20, name: 'Wizard_MAtK' },
        { type: 'buff_speed', value: 0.15, name: 'Wizard_Speed' }
      ],
      duration: 5,
      visualKeyword: 'starlight'
    };
  }

  if (name.includes('icy squall') || name.includes('iocy squall') || name.includes('icy squall of friendship') || name.includes('squall') || name.includes('ultimate')) {
    return {
      typeCategory: 'ultimate',
      duration: 8,
      radius: 300,
      damagePerSecondBase: 80,
      damagePctMagicAtk: 0.30,
      allyShieldPctPerSec: 0.10,
      slowPct: 0.50,
      visualKeyword: 'ice_king_blizzard',
      cooldown: 90
    };
  }

  if (name.includes('crown of endless winter') || name.includes('signature')) {
    return {
      typeCategory: 'passive',
      baseDef: 20,
      tenacity: 15,
      procBasicBonusPctOfMaxHp: 0.05, // 5% of max HP extra magic damage on next basic
      slowOnFrozenPct: 0.20,
      procWindow: 3
    };
  }

  return null;
}

export async function decideAction(actor, enemies, allies, battle){
  const liveEnemies = (enemies||[]).filter(e=>!e.isDead);
  const liveAllies = (allies||[]).filter(a=>!a.isDead && a !== actor);

  if (!liveEnemies.length) return { ability: { name: 'Basic Attack' }, targets: [] };

  const find = q => (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes(q));
  const ult = find('icy squall') || find('iсy squall') || find('ultimate');
  const summon = find('summon ice') || find('ice-o-pede');
  const barrage = find('ice lightning barrage');
  const basic = (actor.data.abilities||[]).find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };

  // Ultimate: use when full energy or when 3+ enemies clustered
  if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
    const clustered = liveEnemies.filter(e => Math.hypot(e.x - actor.x, e.y - actor.y) <= 320).length;
    if (clustered >= 2 || liveEnemies.length >= 3) return { ability: ult, type: 'ultimate', targets: liveEnemies.slice(0,6) };
  }

  // Summon if allies need tanking or when off cooldown
  if (summon && !actor.cooldownTimers?.[summon.name]) {
    const lowAlly = liveAllies.find(a => (a.currentHp / a.maxHp) < 0.6);
    if (lowAlly || liveEnemies.length >= 3) {
      return { ability: summon, type: 'skill', targets: [actor] };
    }
  }

  // Barrage for multi target; prefer if multiple enemies or need CC
  if (barrage && !actor.cooldownTimers?.[barrage.name]) {
    if (liveEnemies.length >= 2) {
      // choose enemy nearest to actor as cone center
      const center = liveEnemies.sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y) - Math.hypot(b.x-actor.x,b.y-actor.y))[0];
      return { ability: barrage, type: 'skill', targets: [center] };
    }
  }

  // Fallback basic nearest
  const nearest = liveEnemies.sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y) - Math.hypot(b.x-actor.x,b.y-actor.y))[0];
  return { ability: basic, type: 'basic', targets: [nearest] };
}

export async function executeAction(battle, actor, decision, parsed){
  if (!decision || !decision.ability) return;
  const ui = battle.uiManager;
  const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
  const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
  const liveEnemies = enemies.filter(e=>!e.isDead);
  const name = (decision.ability.name||'').toLowerCase();

  // windup
  await new Promise(r=>setTimeout(r, (decision.type==='ultimate')?420:140));

  // BASIC
  if (name.includes('basic attack')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 21;
    const dmg = Math.floor((parsed.baseDmg || 14) + atk * (parsed.scalePct || 0.22));
    const res = t.receiveAction({ amount: dmg, type:'physical', element: 'fire', attackerAccuracy: 18 });
    ui.showFloatingText(t, res.amount, 'damage-number');
    ui.showProjectile(actor, t, 'proj_fire');
    ui.playVfx(t, 'proj_fire');
    actor.energy = Math.min(actor.maxEnergy, (actor.energy||0) + 8);
    return;
  }

  // ICE LIGHTNING BARRAGE
  if (name.includes('ice lightning barrage')) {
    const center = decision.targets && decision.targets[0] ? decision.targets[0] : actor;
    const projCount = parsed.multiProj || 3;
    const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 19;
    for (let i=0;i<projCount;i++){
      // small spread delay
      await new Promise(r=>setTimeout(r, 140));
      // pick target in cone: approximate by nearest among first 3
      const target = liveEnemies && liveEnemies.length ? liveEnemies[Math.min(i, liveEnemies.length-1)] : null;
      if (!target) continue;
      const dmg = Math.floor((parsed.baseDmg || 50) + matk * (parsed.scalePct || 0.20));
      const res = target.receiveAction({ amount: dmg, type: 'magic', element: 'electric', attackerAccuracy: 18 });
      ui.showFloatingText(target, res.amount, 'damage-number magic');
      ui.playVfx(target, 'vfx_lightning');
      // Freeze chance (increased if terrain frozen fortress)
      const terrainBoost = (battle && battle.room && battle.room.roomState && battle.room.roomState.terrain === 'frozen_fortress') ? 2.0 : 1.0;
      const chance = (parsed.freezeChance || 0.30) * (terrainBoost === 2.0 ? 2.0 : 1.0);
      if (Math.random() < chance) {
        target.applyStatus({ type: 'freeze', duration: parsed.freezeDur || 0.5 });
        ui.showFloatingText(target, 'FREEZE', 'status-text');
        ui.playSound('frost_crackle');
      }
    }
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 8;
    return;
  }

  // SUMMON ICE-O-PEDE
  if (name.includes('summon ice') || name.includes('ice-o-pede')) {
    const mech = parsed || {};
    // Build summon object simplified for engine: reuse BattleSystem.createEnemy-like template
    const X = actor.level || actor.data.level || 1;
    const hp = Math.floor((mech.summonHp || 300) + (mech.summonHpScalePct || 0.5) * X);
    const attack = Math.floor((mech.attackDmgBase || 40) + (mech.attackScalePct || 0.15) * X);
    const summon = {
      id: `summon_iceopede_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
      name: 'Ice-o-pede',
      stats: { 'max hp': hp, hp: hp, atk: attack, def: 12, 'magic atk': 0, speed: 80 },
      isSummon: true,
      ownerId: actor.id,
      formationSlot: null,
      _templateId: 'ice-o-pede'
    };
    // Place summon near actor
    const spawnX = actor.x + (actor.team === 'ally' ? 60 : -60);
    const spawnY = actor.y;
    const bc = battle.createEnemy ? battle.createEnemy(summon, actor.level || 1, 1.0, false) : summon;
    // If engine supports adding enemies directly, push; otherwise attach to actor.customResources for engine to pick up
    try {
      // Ideally BattleSystem exposes method to add transient entity; attempt push to battle.enemies
      if (battle && Array.isArray(battle.enemies)) {
        const newSummon = new (require ? require('./Character.js').BattleCharacter : battle.allies[0].constructor)(summon, actor.team);
        newSummon.x = spawnX;
        newSummon.y = spawnY + 20;
        newSummon.battleSystem = battle;
        newSummon.isSummon = true;
        newSummon.stats['max hp'] = hp;
        newSummon.currentHp = hp;
        newSummon.stats.atk = attack;
        newSummon.ownerId = actor.id;
        // Add to allies side
        if (actor.team === 'ally') {
           battle.allies.push(newSummon);
        } else {
           battle.enemies.push(newSummon);
        }
        ui.showFloatingText(actor, 'ICE-O-PEDE SUMMONED', 'status-text buff');
        ui.playVfx(newSummon, 'ice_o_pede');
        ui.playSound('ice_summon');
      } else {
        // Fallback: record on actor to let BattleSystem reconcile later
        actor.customResources = actor.customResources || {};
        actor.customResources['PendingSummon'] = summon;
        ui.showFloatingText(actor, 'SUMMON QUEUED', 'status-text');
        ui.playVfx(actor, 'ice_o_pede');
        ui.playSound('ice_summon');
      }
    } catch (e) {
      // safe fallback message
      ui.showFloatingText(actor, 'SUMMON FAILED', 'status-text');
    }

    // If Frozen Fortress terrain, grant shield to summon (engine responsibility simplified here)
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 20;
    return;
  }

  // ULTIMATE: ICY SQUALL OF FRIENDSHIP
  if (name.includes('icy squall') || decision.type === 'ultimate') {
    const mech = parsed || {};
    ui.playAbilityName && ui.playAbilityName(actor, decision.ability.name || 'Icy Squall of Friendship!');
    ui.playVfx(actor, mech.visualKeyword || 'ice_king_blizzard');
    ui.playSound && ui.playSound('frost_crackle');
    const center = actor;
    const radius = mech.radius || 300;
    const duration = mech.duration || 8;
    const ticks = Math.max(1, duration);
    const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 19;
    // apply periodic pulses
    let tickCount = 0;
    const pulse = async () => {
      if (tickCount >= ticks) return;
      tickCount++;
      // damage enemies in radius
      const dmgPer = Math.floor((mech.damagePerSecondBase || 80) + matk * (mech.damagePctMagicAtk || 0.30));
      enemies.filter(e => !e.isDead).forEach(e => {
        const dist = Math.hypot(e.x - center.x, e.y - center.y);
        if (dist <= radius) {
          const res = e.receiveAction({ amount: dmgPer, type: 'magic', element: 'ice', attackerAccuracy: 14 });
          ui.showFloatingText(e, res.amount, 'damage-number magic');
          e.applyStatus({ type: 'debuff_speed', value: mech.slowPct || 0.5, duration: 1.2 });
          ui.playVfx(e, 'vfx_ice_shatter');
        }
      });
      // shield allies (small per second, stacks)
      friends.filter(a => !a.isDead).forEach(a => {
        const dist = Math.hypot(a.x - center.x, a.y - center.y);
        if (dist <= radius) {
          const shieldVal = Math.floor((actor.maxHp || actor.stats['max hp'] || 575) * (mech.allyShieldPctPerSec || 0.10));
          a.receiveAction({ amount: shieldVal, effectType: 'shield' });
          ui.showFloatingText(a, `SHIELD ${shieldVal}`, 'status-text buff');
        }
      });
      await new Promise(r=>setTimeout(r, 1000 / Math.max(0.2, (battle.battleSpeed || 1))));
      if (tickCount < ticks) await pulse();
      else {
        // On end: if upgraded freeze final gust: attempt freeze on remaining enemies
        if (mech.endFreezeChance) {
          enemies.filter(e => !e.isDead && Math.hypot(e.x - center.x, e.y - center.y) <= radius).forEach(e => {
            if (Math.random() < (mech.endFreezeChance || 0.15)) {
              e.applyStatus({ type: 'freeze', duration: mech.endFreezeDur || 1.5 });
              ui.showFloatingText(e, 'FINAL FREEZE', 'status-text');
            }
          });
        }
      }
    };
    pulse().catch(()=>{});
    actor.energy = 0;
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 90;
    return;
  }
}

export function updatePassives(actor, dt){
  actor.customResources = actor.customResources || {};
  actor.resourceDecayTimers = actor.resourceDecayTimers || {};

  // Wizard Eyes passive generation
  const parsed = (actor.data && Array.isArray(actor.data.abilities)) ? (actor.data.abilities.find(a=> (a.name||'').toLowerCase().includes('wizard eyes'))) : null;
  const interval = parsed?.stackInterval || 10;
  actor._wizardTimer = (actor._wizardTimer || 0) + dt;
  if (actor._wizardTimer >= interval) {
    actor._wizardTimer = 0;
    actor.customResources['WizardEyes'] = Math.min(parsed?.maxStacks || 3, (actor.customResources['WizardEyes']||0) + 1);
  }

  // Crown of Endless Winter: next-basic proc window management
  if (actor.customResources['CrownProcWindow'] > 0) {
    actor.customResources['CrownProcWindow'] = Math.max(0, actor.customResources['CrownProcWindow'] - dt);
  }

  // Decay resource timers
  for (const k in actor.resourceDecayTimers) {
    if (actor.resourceDecayTimers[k] > 0) actor.resourceDecayTimers[k] = Math.max(0, actor.resourceDecayTimers[k] - dt);
  }
}