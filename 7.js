/*
  Character ability module for export_id "7" (Jerry)
  Exports:
    - decideAction(actor, enemies, allies, battle) => decision object
    - getParsedAbility(ability, actor, battle) => parsed overrides
    - executeAction(battle, actor, decision, parsed) => performs ability effects
*/

import { pickRandom } from './src/utils.js';

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function getItems(actor){ return Math.floor(actor.getResource ? actor.getResource('Acquired Items') : (actor.customResources?.['Acquired Items']||0)); }
function addItem(actor, amt, max=3){ if(actor.addResource) return actor.addResource('Acquired Items', amt, max); actor.customResources['Acquired Items'] = Math.min(max,(actor.customResources['Acquired Items']||0)+amt); return actor.customResources['Acquired Items']; }
function consumeItem(actor, amt=1){ const cur = getItems(actor); const used = Math.min(cur, amt); if(actor.consumeResource) actor.consumeResource('Acquired Items', used); else actor.customResources['Acquired Items'] = Math.max(0, cur - used); return used; }

export async function getParsedAbility(ability, actor, battle){
    const name = (ability && ability.name||'').toLowerCase();
    if(name.includes('basic attack')){
        return { baseDmg:45, scalePct:0.45, scaleStat:'atk', element:'fire', targeting:'single', visualKeyword:'proj-fire', typeCategory:'basic' };
    }
    if(name.includes('spring-loaded surprise') || name.includes('trap')){
        return {
            typeCategory:'skill',
            visualKeyword:'vfx-beam',
            targeting:'position',
            mechanics:{ isTrap:true, maxActive:2, launchDamageBase:60, launchScalePct:0.4, stun:1.5 },
            radius:80,
            cooldown:10
        };
    }
    if(name.includes('pocket full of tricks') || name.includes('acquired item toss')){
        return {
            typeCategory:'skill',
            visualKeyword:'proj-magic',
            targeting:'single',
            mechanics:{ usesAcquiredItem:true },
            cooldown:8
        };
    }
    if(name.includes('nimble escapist')){
        return { typeCategory:'passive', speedPct:0.15, evasionPct:0.10, itemOnTrap:true, maxItems:3 };
    }
    if(name.includes('mouse mayhem') || name.includes('ultimate')){
        return {
            typeCategory:'ultimate',
            visualKeyword:'vfx-fire-storm',
            radius:300,
            duration:8,
            cooldown:90,
            mechanics:{ charmPct:0.4, slowPct:0.5, slowDur:2, blindPct:0.3, blindDur:1, allySpeed:0.2, allyDmg:0.1 }
        };
    }
    if(name.includes('unseen agility') || name.includes('signature')){
        return { typeCategory:'passive', evasionFlat:25, tenacityAdd:15, freeTrapOnEvade:true, freeTrapDuration:5, maxItemsIncreaseAtLevel:4 };
    }
    return null;
}

export async function decideAction(actor, enemies, allies, battle){
    const abilities = actor.data.abilities || [];
    const liveEnemies = enemies.filter(e=>!e.isDead);
    const find = q => abilities.find(a=>a.name && a.name.toLowerCase().includes(q));
    const basic = abilities.find(a => (a.tags||[]).includes('basic')) || { name:'Basic Attack' };
    const trap = find('spring-loaded surprise');
    const toss = find('pocket full of tricks');
    const ult = find('mouse mayhem') || find('ultimate');

    // Use ultimate when ready and multiple enemies
    if(actor.energy >= actor.maxEnergy && ult && liveEnemies.length >= 2) return { ability: ult, type:'ultimate', targets: liveEnemies.slice(0,6) };

    // If has items and ally low -> use toss for heal
    if(toss && !actor.cooldownTimers?.[toss.name]){
        const lowAlly = allies.filter(a=>!a.isDead && (a.currentHp/a.maxHp) < 0.6)[0];
        if(lowAlly && getItems(actor) > 0) return { ability: toss, type:'skill', targets:[lowAlly] };
    }

    // Place trap when enemies cluster or simple pressure
    if(trap && !actor.cooldownTimers?.[trap.name]){
        // place near densest enemy
        let best=null, bestCount=0;
        for(const e of liveEnemies){
            const cnt = liveEnemies.filter(o=>Math.hypot(o.x-e.x,o.y-e.y)<=120).length;
            if(cnt>bestCount){ bestCount=cnt; best=e; }
        }
        if(bestCount>=2 || getItems(actor) < 1) return { ability: trap, type:'skill', targets:[best || liveEnemies[0]] };
    }

    // Otherwise basic on closest
    return { ability: basic, type:'basic', targets: [ liveEnemies[0] ] };
}

export async function executeAction(battle, actor, decision, parsed){
    if(!decision || !decision.ability) return;
    const name = (decision.ability.name||'').toLowerCase();
    const ui = battle.uiManager;
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
    const liveEnemies = enemies.filter(e=>!e.isDead);

    // small windup
    await new Promise(r=>setTimeout(r, (decision.type==='ultimate')?320:160));

    // BASIC
    if(name.includes('basic attack')){
        const tgt = decision.targets && decision.targets[0] || liveEnemies[0];
        if(!tgt) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 40;
        const dmg = Math.floor((parsed.baseDmg || 45) + atk * (parsed.scalePct || 0.45));
        const res = tgt.receiveAction({ amount:dmg, type:'physical', isCrit:false, element:parsed.element||'fire', attackerAccuracy:18 });
        ui.showFloatingText(tgt, res.amount, 'damage-number');
        ui.playVfx(tgt, parsed.visualKeyword || 'proj-fire');
        return;
    }

    // SPRING-LOADED SURPRISE (Trap placement)
    if(name.includes('spring-loaded surprise') || name.includes('trap')){
        // Determine placement center
        const centerTarget = decision.targets && decision.targets[0] || liveEnemies[0];
        if(!centerTarget) return;
        // Maintain trap list on actor.customResources['Traps'] as array of {id,x,y,expire,placedAt}
        if(!actor.customResources) actor.customResources = actor.customResources || {};
        const traps = actor.customResources['Traps'] = actor.customResources['Traps'] || [];
        // If more than maxActive, remove oldest
        const maxActive = parsed.mechanics?.maxActive || 2;
        while(traps.length >= maxActive) traps.shift();
        // Create trap object
        const trap = {
            id: `trap_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
            x: Math.round((centerTarget.x || centerTarget?.x || actor.x) + (Math.random()-0.5)*30),
            y: Math.round((centerTarget.y || centerTarget?.y || actor.y) + (Math.random()-0.5)*20),
            radius: parsed.radius || 80,
            expireAt: Date.now() + ((parsed.duration || 15) * 1000),
            baseDamage: parsed.mechanics?.launchDamageBase || 60,
            scalePct: parsed.mechanics?.launchScalePct || 0.4,
            stun: parsed.mechanics?.stun || 1.5,
            ownerId: actor.id
        };
        traps.push(trap);
        ui.showFloatingText(actor, 'TRAP PLACED', 'status-text');
        ui.playVfx(actor, 'vfx-beam');
        // register simple collision check loop for trap lifetime (non-blocking)
        const checkTrap = async () => {
            while(Date.now() < trap.expireAt && !actor.isDead){
                // scan enemies for trigger
                for(const e of battle.enemies.filter(en=>!en.isDead)){
                    const dist = Math.hypot(e.x - trap.x, e.y - trap.y);
                    if(dist <= trap.radius){
                        // Trigger: launch enemy away and apply damage + stun
                        const atk = actor.effectiveMagicAtk || actor.stats.magicAtk || 6;
                        const dmg = Math.floor(trap.baseDamage + atk * trap.scalePct);
                        const res = e.receiveAction({ amount: dmg, type: 'physical', isCrit:false, element:'physical', attackerAccuracy:18 });
                        ui.showFloatingText(e, res.amount, 'damage-number');
                        ui.playVfx(e, 'vfx-explosion');
                        e.applyStatus({ type:'stun', duration: trap.stun });
                        ui.showFloatingText(e, 'STUN', 'status-text');
                        // knock-launch away from actor
                        try{
                            const dx = e.x - actor.x; const dy = e.y - actor.y; const distv = Math.hypot(dx,dy)||1;
                            const nx = dx/distv; const ny = dy/distv;
                            e.x += Math.round(nx * 140);
                            e.y += Math.round(ny * 60);
                            e.x = Math.max(40, Math.min(860, e.x));
                            e.y = Math.max(battle.minY || 80, Math.min(battle.maxY || 520, e.y));
                        }catch(e){}
                        // Grant an acquired item to owner per passive (if owner still alive)
                        if(actor && !actor.isDead){
                            addItem(actor, 1, (actor.getParsedAbility && actor.getParsedAbility('spring-loaded surprise')?.mechanics?.maxItems) || 3);
                        } else {
                            addItem(actor, 1, 3);
                        }
                        // Remove this trap
                        const idx = (actor.customResources['Traps']||[]).findIndex(t=>t.id===trap.id);
                        if(idx!==-1) actor.customResources['Traps'].splice(idx,1);
                        return;
                    }
                }
                await new Promise(r=>setTimeout(r, 350));
            }
            // expire if time up
            const idx = (actor.customResources['Traps']||[]).findIndex(t=>t.id===trap.id);
            if(idx!==-1) actor.customResources['Traps'].splice(idx,1);
        };
        checkTrap();
        actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 10;
        return;
    }

    // POCKET FULL OF TRICKS (Item toss)
    if(name.includes('pocket full of tricks') || name.includes('acquired item toss')){
        const target = decision.targets && decision.targets[0];
        if(!target) return;
        const items = getItems(actor);
        if(items <= 0){
            ui.showFloatingText(actor, 'NO ITEMS', 'status-text');
            return;
        }
        // Consume one item and randomly pick effect from pool: Cheese, Mallet, Miracle-Gro, (chance for Firecracker unlocks later)
        const pool = ['Cheese','Mallet','Miracle-Gro'];
        const pick = pickRandom(pool);
        consumeItem(actor, 1);
        ui.showProjectile(actor, target, 'magic');
        await new Promise(r=>setTimeout(r, 220)); // travel time
        if(pick === 'Cheese'){
            // Charm enemies near target for 2s
            target.applyStatus({ type:'charm', duration:2 });
            ui.showFloatingText(target, 'CHARMED', 'status-text');
            ui.playVfx(target, 'vfx-magic');
        } else if(pick === 'Mallet'){
            // Damage + stun
            const atk = actor.effectiveAtk || actor.stats.atk || 141;
            const dmg = Math.floor(80 + atk * 0.5);
            const res = target.receiveAction({ amount:dmg, type:'physical', isCrit:false, element:'physical', attackerAccuracy:20 });
            ui.showFloatingText(target, res.amount, 'damage-number');
            target.applyStatus({ type:'stun', duration:1 });
            ui.playVfx(target, 'vfx-slash-heavy');
        } else if(pick === 'Miracle-Gro'){
            // Heal ally (target might be ally)
            const healBase = 100;
            const matk = actor.effectiveMagicAtk || actor.stats.magicAtk || 141;
            const heal = Math.floor(healBase + matk * 0.4);
            target.receiveAction({ amount: heal, effectType:'heal' });
            ui.showFloatingText(target, `+${heal}`, 'damage-number heal');
            ui.playVfx(target, 'vfx-heal');
        }
        actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 8;
        return;
    }

    // ULTIMATE: MOUSE MAYHEM
    if(name.includes('mouse mayhem') || name.includes('ultimate')){
        const mech = parsed.mechanics || {};
        const dur = parsed.duration || 8;
        const radius = parsed.radius || 300;
        ui.showFloatingText(actor, 'MOUSE MAYHEM!', 'status-text buff');
        ui.playVfx(actor, parsed.visualKeyword || 'vfx-fire-storm');

        // Apply periodic random debuffs to enemies and buffs to allies in radius
        const endAt = Date.now() + dur*1000;
        const interval = 800;
        while(Date.now() < endAt){
            // Enemies: for each enemy in radius, roll independent chances
            for(const e of battle.enemies.filter(en=>!en.isDead && Math.hypot(en.x-actor.x,en.y-actor.y)<=radius)){
                const r = Math.random();
                if(r < (mech.charmPct || 0.4)){
                    e.applyStatus({ type:'charm', duration:1 });
                    ui.showFloatingText(e, 'CHARM', 'status-text');
                } else if(r < (mech.charmPct || 0.4) + (mech.slowPct || 0.3)){
                    e.applyStatus({ type:'debuff_speed', value:(mech.slowPct || 0.5), duration:(mech.slowDur || 2) });
                    ui.showFloatingText(e, 'SLOWED', 'status-text');
                } else if(r < (mech.charmPct || 0.4) + (mech.slowPct || 0.3) + (mech.blindPct || 0.3)){
                    e.applyStatus({ type:'blind', duration:(mech.blindDur || 1) });
                    ui.showFloatingText(e, 'BLIND', 'status-text');
                }
            }
            // Allies: buff speed and damage
            for(const a of battle.allies.filter(al=>!al.isDead && Math.hypot(al.x-actor.x,al.y-actor.y)<=radius)){
                a.applyStatus({ type:'buff_speed', value:(mech.allySpeed || 0.2), duration:2.2 });
                a.applyStatus({ type:'buff_atk', value:(mech.allyDmg || 0.1), duration:2.2 });
                ui.showFloatingText(a, 'SPD+ / DMG+', 'status-text buff');
            }
            await new Promise(r=>setTimeout(r, interval));
        }
        actor.energy = 0;
        actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 90;
        return;
    }

    // Fallback minimal basic strike
    {
        const tgt = decision.targets && decision.targets[0] || liveEnemies[0];
        if(!tgt) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 40;
        const dmg = Math.floor(18 + atk * 0.4);
        const res = tgt.receiveAction({ amount:dmg, type:'physical', isCrit:false, element:'physical', attackerAccuracy:16 });
        ui.showFloatingText(tgt, res.amount, 'damage-number');
        ui.playVfx(tgt, 'slash');
    }
}