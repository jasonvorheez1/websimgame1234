/*
  Character ability module for export_id "8" (Kakashi)
  Exports:
    - decideAction(actor, enemies, allies, battle) => decision object
    - getParsedAbility(ability, actor, battle) => parsed overrides
    - executeAction(battle, actor, decision, parsed) => performs ability effects
*/

import { pickRandom } from './src/utils.js';

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function getCopyCharges(actor){ return Math.floor(actor.getResource ? actor.getResource('Copy Charges') : (actor.customResources?.['Copy Charges']||0)); }
function addCopyCharges(actor, amt, max=5){ if(actor.addResource) return actor.addResource('Copy Charges', amt, max); actor.customResources['Copy Charges'] = Math.min(max,(actor.customResources['Copy Charges']||0)+amt); return actor.customResources['Copy Charges']; }
function consumeCopyCharges(actor, amt){ const cur = getCopyCharges(actor); const used = Math.min(cur, amt); if(actor.consumeResource) actor.consumeResource('Copy Charges', used); else actor.customResources['Copy Charges'] = Math.max(0, cur - used); return used; }

export async function getParsedAbility(ability, actor, battle){
    const name = (ability && ability.name||'').toLowerCase();
    if(name.includes('basic attack')){
        return { baseDmg:41, scalePct:0.45, scaleStat:'atk', element:'physical', targeting:'single', visualKeyword:'slash', typeCategory:'basic' };
    }
    if(name.includes('lightning blade') || name.includes('chidori')){
        return {
            typeCategory:'skill',
            visualKeyword:'proj-electric',
            targeting:'single',
            baseDmg:41,
            scalePct:0.8,
            scaleStat:'atk',
            element:'electric',
            ignoreDefPct:0.20,
            cooldown:6,
            mechanics:{ consumesCopyCharges:3, enhancedMultiplier:1.5, stunOnEnhance:1.5 },
            dashDistance: 140
        };
    }
    if(name.includes('water style') || name.includes('great waterfall')){
        return {
            typeCategory:'skill',
            visualKeyword:'vfx-water',
            targeting:'aoe',
            baseDmg:111,
            scalePct:0.7,
            scaleStat:'magicAtk',
            element:'water',
            slowPct:0.30,
            slowDur:3,
            cooldown:12,
            mechanics:{ consumesCopyCharge:1, enhancedSlowPct:0.50, reduceMDefPct:0.15 },
            areaRadius: 200
        };
    }
    if(name.includes('copy wheel eye') ){
        return {
            typeCategory:'passive',
            mechanics:{ maxCharges:5, scanInterval:30, chargeOnEnemyAbility:1, bonusPerUnique:0.05 },
            description: 'Gain Copy Charges when enemies use abilities and bonus ATK/M.ATK per unique enemy type.'
        };
    }
    if(name.includes('thousand jutsu master') || name.includes('signature')){
        return {
            typeCategory:'passive',
            mechanics:{ evasionPerTypePct:0.03, maxEvasionPct:0.15, consumeToReduceDebuff:1 },
            description: 'Signature: grants evasion per unique jutsu type and consumes charges to reduce debuff durations.'
        };
    }
    if(name.includes('mangekyo') || name.includes('kamui')){
        return {
            typeCategory:'ultimate',
            visualKeyword:'vfx-beam',
            targeting:'single',
            baseDmg:2750,
            scalePct:1.0,
            scaleStat:'magicAtk',
            element:'dark',
            cooldown:120,
            mechanics:{ hpCostPct:0.10, speedPct:0.20, evasionPct:0.30, sealDur:7, kamuiDuration:8, chargeGainWhileActive:{amount:2, every:3} },
            description: 'Mangekyo Sharingan: grants speed/evasion, teleport strike that applies Kamui Seal.'
        };
    }
    return null;
}

export async function decideAction(actor, enemies, allies, battle){
    const abilities = actor.data.abilities || [];
    const liveEnemies = enemies.filter(e=>!e.isDead);
    const basic = abilities.find(a => (a.tags||[]).includes('basic')) || { name:'Basic Attack' };
    const chidori = abilities.find(a => (a.name||'').toLowerCase().includes('lightning blade'));
    const water = abilities.find(a => (a.name||'').toLowerCase().includes('water style'));
    const ult = abilities.find(a => (a.name||'').toLowerCase().includes('mangekyo') || (a.name||'').toLowerCase().includes('kamui'));
    const copy = getCopyCharges(actor);

    // Use ultimate if ready and there are enemies
    if(actor.energy >= actor.maxEnergy && ult) return { ability: ult, type:'ultimate', targets: liveEnemies.slice(0,5) };

    // If low HP and signature can shield (handled in passives) prefer defensive play: use Water (aoe slow) if multiple enemies
    if(water && !actor.cooldownTimers?.[water.name]){
        if(liveEnemies.length >= 2) return { ability: water, type:'skill', targets: [ pickRandom(liveEnemies) ] };
    }

    // Use Chidori when single target in range or if copy charges >=3 for enhanced stun
    if(chidori && !actor.cooldownTimers?.[chidori.name]){
        if(copy >= 3 || liveEnemies.length === 1){
            return { ability: chidori, type:'skill', targets: [ liveEnemies.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0] ] };
        }
    }

    // Default: basic on closest
    return { ability: basic, type:'basic', targets: [ liveEnemies[0] ] };
}

export async function executeAction(battle, actor, decision, parsed){
    if(!decision || !decision.ability) return;
    const ui = battle.uiManager;
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
    const liveEnemies = enemies.filter(e=>!e.isDead);
    const name = (decision.ability.name||'').toLowerCase();

    // windup
    await new Promise(r=>setTimeout(r, (decision.type==='ultimate')?360:160));

    // BASIC
    if(name.includes('basic attack')){
        const tgt = decision.targets && decision.targets[0] || liveEnemies[0];
        if(!tgt) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 40;
        const dmg = Math.floor((parsed.baseDmg || 41) + atk * (parsed.scalePct || 0.45));
        const res = tgt.receiveAction({ amount:dmg, type:'physical', isCrit:false, element: parsed.element||'physical', attackerAccuracy:18 });
        ui.showFloatingText(tgt, res.amount, 'damage-number');
        ui.playVfx(tgt, parsed.visualKeyword || 'slash');
        return;
    }

    // CHIDORI / LIGHTNING BLADE
    if(name.includes('lightning blade') || name.includes('chidori')){
        const tgt = decision.targets && decision.targets[0] || liveEnemies[0];
        if(!tgt) return;
        // dash: reposition actor near target
        try {
            const dx = tgt.x - actor.x; const dy = tgt.y - actor.y; const dist = Math.hypot(dx,dy)||1;
            const moveDist = Math.min(parsed.dashDistance || 140, dist - Math.max(0, tgt.hitbox || 24));
            actor.x += (dx/dist) * moveDist;
            actor.y += (dy/dist) * Math.max(0.1, moveDist*0.12);
        } catch(e){}

        // compute base damage
        const atk = actor.effectiveAtk || actor.stats.atk || 50;
        let base = Math.floor((parsed.baseDmg || 41) + atk * (parsed.scalePct || 0.8));

        // ignore portion of def by temporarily toggling ignoreDef flag in receiveAction
        const ignoreDef = (parsed.ignoreDefPct || 0.2) > 0;

        // check copy charges
        const charges = getCopyCharges(actor);
        let consumed = 0;
        if(charges >= 3 && parsed.mechanics && parsed.mechanics.consumesCopyCharges){
            consumed = consumeCopyCharges(actor, parsed.mechanics.consumesCopyCharges);
        }

        if(consumed >= 3){
            // enhanced damage & stun
            base = Math.floor((parsed.baseDmg || 41) + atk * (parsed.scalePct || 0.8) * (parsed.mechanics.enhancedMultiplier || 1.5));
            const res = tgt.receiveAction({ amount: base, type:'physical', isCrit:false, element: parsed.element||'electric', attackerAccuracy:20, ignoreDef: true });
            ui.showFloatingText(tgt, res.amount, 'damage-number');
            ui.playVfx(tgt, 'vfx-electric');
            tgt.applyStatus({ type:'stun', duration: (parsed.mechanics && parsed.mechanics.stunOnEnhance) || 1.5 });
            ui.showFloatingText(tgt, 'STUN', 'status-text');
        } else {
            // normal hit with partial def ignore (we emulate by temporarily reducing def via ignoreDef flag)
            const res = tgt.receiveAction({ amount: base, type:'physical', isCrit:false, element: parsed.element||'electric', attackerAccuracy:18, ignoreDef: ignoreDef });
            ui.showFloatingText(tgt, res.amount, 'damage-number');
            ui.playVfx(tgt, 'vfx-electric');
        }

        actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 6;
        return;
    }

    // WATER STYLE: GREAT WATERFALL TECHNIQUE
    if(name.includes('water style') || name.includes('great waterfall')){
        const center = decision.targets && decision.targets[0] || liveEnemies[0];
        if(!center) return;
        const matk = actor.effectiveMagicAtk || actor.stats.magicAtk || 50;
        let dmg = Math.floor((parsed.baseDmg || 111) + matk * (parsed.scalePct || 0.7));
        const radius = parsed.areaRadius || 200;
        ui.playVfx(center, parsed.visualKeyword || 'vfx-water');
        const targets = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= radius);
        for(const t of targets){
            const res = t.receiveAction({ amount: dmg, type:'magic', isCrit:false, element: parsed.element||'water', attackerAccuracy:16 });
            ui.showFloatingText(t, res.amount, 'damage-number');
            ui.triggerHitAnim(t);
            // apply slow
            let slowVal = parsed.slowPct || 0.30;
            if(getCopyCharges(actor) >= 1 && parsed.mechanics && parsed.mechanics.consumesCopyCharge){
                // consume one charge to enhance
                consumeCopyCharges(actor, 1);
                slowVal = parsed.mechanics.enhancedSlowPct || 0.50;
                t.applyStatus({ type:'debuff_matk', value:(parsed.mechanics.reduceMDefPct || 0.15), duration:5 });
                ui.showFloatingText(t, 'M.DEF -15%', 'status-text');
            }
            t.applyStatus({ type:'debuff_speed', value: slowVal, duration: parsed.slowDur || 3 });
            ui.showFloatingText(t, 'SLOWED', 'status-text');
        }
        actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 12;
        return;
    }

    // ULTIMATE: MANGEKYO SHARINGAN - KAMUI RAID
    if(name.includes('mangekyo') || name.includes('kamui')){
        // HP cost on activation
        try {
            const hpCost = Math.max(1, Math.floor(actor.maxHp * (parsed.mechanics.hpCostPct || 0.10)));
            actor.currentHp = Math.max(1, actor.currentHp - hpCost);
            ui.showFloatingText(actor, `-${hpCost}`, 'damage-number');
        } catch(e){}

        // apply global buff (speed & evasion)
        actor.applyStatus({ type:'buff_speed', value: parsed.mechanics.speedPct || 0.20, duration: parsed.mechanics.kamuiDuration || 8 });
        actor.applyStatus({ type:'buff_evasion', value: parsed.mechanics.evasionPct || 0.30, duration: parsed.mechanics.kamuiDuration || 8 });
        ui.showFloatingText(actor, 'MANGEKYO: ON', 'status-text buff');
        ui.playVfx(actor, 'vfx-beam');

        // During duration allow Kamui Teleport strike - we simulate by doing an immediate teleport strike on primary target then grant periodic charge gain while active
        const primary = decision.targets && decision.targets[0] || liveEnemies[0];
        if(primary){
            // teleport behind target
            try {
                const dx = primary.x - actor.x; const dy = primary.y - actor.y; const dist = Math.hypot(dx,dy)||1;
                actor.x = primary.x - (dx/dist)*60;
                actor.y = primary.y - (dy/dist)*8;
                ui.playVfx(actor, 'teleport');
            } catch(e){}
            // deal heavy magic damage and apply Kamui Seal (speed & evasion reduction)
            const matk = actor.effectiveMagicAtk || actor.stats.magicAtk || 100;
            const dmg = Math.floor((parsed.baseDmg || 2750) + matk * (parsed.scalePct || 1.0));
            const res = primary.receiveAction({ amount: dmg, type:'magic', isCrit:false, element: parsed.element||'dark', attackerAccuracy:18 });
            ui.showFloatingText(primary, res.amount, 'damage-number crit');
            ui.playVfx(primary, 'vfx-explosion');
            primary.applyStatus({ type:'debuff_speed', value: 0.20, duration: parsed.mechanics.sealDur || 7 });
            primary.applyStatus({ type:'debuff_evasion', value: 0.20, duration: parsed.mechanics.sealDur || 7 });
            ui.showFloatingText(primary, 'KAMUI SEAL', 'status-text');
        }

        // During active duration, optionally gain charges every X seconds (handled in a small loop)
        const dur = parsed.mechanics.kamuiDuration || 8;
        const gainEvery = parsed.mechanics.chargeGainWhileActive?.every || 3;
        const gainAmt = parsed.mechanics.chargeGainWhileActive?.amount || 2;
        const end = Date.now() + dur*1000;
        (async ()=>{
            while(Date.now() < end){
                addCopyCharges(actor, gainAmt, 999);
                await new Promise(r=>setTimeout(r, gainEvery*1000 / Math.max(0.2, (battle.battleSpeed || 1))));
            }
        })();

        actor.energy = 0;
        actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 120;
        return;
    }

    // Fallback basic strike
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