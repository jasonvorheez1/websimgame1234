/*
  Character ability module for export_id "9" (Sasuke Uchiha)
  Exports:
    - decideAction(actor, enemies, allies, battle) => decision object
    - getParsedAbility(ability, actor, battle) => parsed overrides
    - executeAction(battle, actor, decision, parsed) => performs ability effects
*/

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

export async function getParsedAbility(ability, actor, battle){
    const name = (ability && ability.name || '').toLowerCase();
    if (name.includes('basic attack')) {
        return { baseDmg: 20, scalePct: 0.25, scaleStat:'atk', element:'fire', targeting:'single', visualKeyword:'slash', typeCategory:'basic', cooldown:1.0 };
    }
    if (name.includes('chidori')) {
        return {
            typeCategory:'skill',
            visualKeyword:'vfx-electric',
            targeting:'single',
            baseDmg: 0,
            scalePct: 0.8,
            scaleStat:'atk',
            element:'electric',
            cooldown:8,
            mechanics:{ grantsInsight:1, electrifiedDur:3, trueDamageIfAlreadyElectrified:true, cooldownReducedAt3Insight:1, dashDistance:140 }
        };
    }
    if (name.includes('gōkakyū') || name.includes('great fireball') || name.includes('gokakyu')) {
        return {
            typeCategory:'skill',
            visualKeyword:'vfx-fire-storm',
            targeting:'aoe',
            baseDmg: 0,
            scalePct: 0.7,
            scaleStat:'magicAtk',
            element:'fire',
            cooldown:10,
            mechanics:{ lingerSeconds:4, perSecPct:0.1, electrifiedBonusPct:0.20, grantsInsightOnHit:true }
        };
    }
    if (name.includes('sharingan insight')) {
        return {
            typeCategory:'passive',
            description:'Stacks on hit up to 3; each stack grants crit chance and conditional damage/evasion bonuses',
            mechanics:{ maxStacks:3, critPerStackPct:0.05, dmgVsStatusPctPerStack:0.03, evasionOnStatusPct:0.03, stackDuration:5 }
        };
    }
    if (name.includes('kirin')) {
        return {
            typeCategory:'ultimate',
            visualKeyword:'vfx-beam',
            targeting:'aoe',
            baseDmg: 0,
            scalePct: 1.2,
            scaleStat:'magicAtk',
            element:'electric',
            cooldown:90,
            mechanics:{ stunDur:1.5, electrifiedAmplify:0.5, resetNextAbilityCooldown:true, grantsElectrifiedAt200:true }
        };
    }
    if (name.includes('indra') || name.includes("signature")) {
        return {
            typeCategory:'signature',
            description:'Indra\'s Charge: Tenacity & Evasion baseline and powerful crit burst while active',
            mechanics:{ tenacityPct:0.15, evasionPct:0.10, chargeDuration:7, critBonusMult:0.5, critCapBonusMult:1.0, requiredStacks:3 }
        };
    }
    return null;
}

function getInsightStacks(actor){
    return Math.floor(actor.getResource ? actor.getResource('Sharingan Insight') : (actor.customResources?.['Sharingan Insight'] || 0));
}
function addInsight(actor, amt=1, max=3){
    if (actor.addResource) actor.addResource('Sharingan Insight', amt, max);
    else actor.customResources['Sharingan Insight'] = Math.min(max, (actor.customResources['Sharingan Insight']||0)+amt);
    return getInsightStacks(actor);
}
function consumeAllInsight(actor){
    const cur = getInsightStacks(actor);
    if (actor.consumeResource) actor.consumeResource('Sharingan Insight', cur);
    else actor.customResources['Sharingan Insight'] = 0;
    return cur;
}

export async function decideAction(actor, enemies, allies, battle){
    const live = enemies.filter(e=>!e.isDead);
    if (live.length===0) return { ability:{ name:'Basic Attack' }, targets:[], type:'basic' };

    const find = q=> (actor.data.abilities||[]).find(a=> (a.name||'').toLowerCase().includes(q));
    const basic = (actor.data.abilities||[]).find(a=> (a.tags||[]).includes('atk')) || { name:'Basic Attack' };
    const chidori = find('chidori');
    const fireball = find('fireball') || find('gōkakyū') || find('gokakyu');
    const kirin = find('kirin');
    const insightStacks = getInsightStacks(actor);

    // Use Kirin if energy full and there are enemies
    if (actor.energy >= actor.maxEnergy && kirin && !actor.cooldownTimers?.[kirin.name]) {
        return { ability: kirin, targets: live.slice(0,6), type:'ultimate' };
    }

    // Prefer Chidori for single high-value / low-count targets or to secure executes
    if (chidori && !actor.cooldownTimers?.[chidori.name]) {
        if (live.length <= 2) return { ability: chidori, targets:[live.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0] ], type:'skill' };
        // if have 3 insight stacks, prefer chidori to consume reduced cd effect
        if (insightStacks >= 3) return { ability: chidori, targets:[live[0]], type:'skill' };
    }

    // Use Fireball when 2+ enemies clustered or when can apply lingering area
    if (fireball && !actor.cooldownTimers?.[fireball.name]) {
        let best=null, bestCount=0;
        for (const e of live){
            const cnt = live.filter(o=>Math.hypot(o.x-e.x,o.y-e.y)<=140).length;
            if (cnt>bestCount){ bestCount=cnt; best=e; }
        }
        if (bestCount>=2) return { ability: fireball, targets:[best], type:'skill' };
    }

    // If low HP or under pressure, basic attack / reposition
    // Default: basic to nearest
    return { ability: basic, targets:[ live.sort((a,b)=>Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0] ], type:'basic' };
}

export async function executeAction(battle, actor, decision, parsed){
    if (!decision || !decision.ability) return;
    const name = (decision.ability.name||'').toLowerCase();
    const ui = battle.uiManager;
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
    const liveEnemies = enemies.filter(e=>!e.isDead);

    // small windup
    await new Promise(r=>setTimeout(r, (decision.type==='ultimate')?360:140));

    const lvl = actor.data.level || actor.level || 1;

    // BASIC
    if (name.includes('basic')) {
        const tgt = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!tgt) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 40;
        // scaling upgrades: small increases at milestones handled externally; keep base
        const dmg = Math.floor((parsed.baseDmg || 20) + atk * (parsed.scalePct || 0.25));
        const res = tgt.receiveAction({ amount:dmg, type:'physical', isCrit:false, element: parsed.element||'fire', attackerAccuracy:20 });
        ui.showFloatingText(tgt, res.amount, 'damage-number');
        ui.playVfx(tgt, 'slash');

        // Passive: if at 3 insight stacks, next basic should crit once & apply Electrified (handled via resource flag here)
        const stacks = getInsightStacks(actor);
        if (stacks >= 3) {
            // force a crit-ish effect and Electrified application
            try {
                tgt.applyStatus({ type:'electrified', duration:2, value:0.10 });
                ui.showFloatingText(tgt, 'ELECTRIFIED', 'status-text');
                // emulate crit: extra true-ish damage
                const extra = Math.floor((actor.effectiveMagicAtk||actor.stats.magicAtk||0) * 0.2) + Math.floor(dmg * 0.25);
                tgt.receiveAction({ amount: extra, type:'true', effectType:'damage' });
                ui.showFloatingText(tgt, extra, 'damage-number crit');
            } catch(e){}
            // consume stacks for the guaranteed crit behavior
            consumeAllInsight(actor);
        } else {
            // small chance to grant insight on any hit (passive spec: stacks on abilities; we grant on skill/hit generally)
        }

        // small energy gain
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 12);
        return;
    }

    // CHIDORI
    if (name.includes('chidori')) {
        const tgt = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!tgt) return;
        // dash visual: reposition slightly toward target
        try {
            const dx = tgt.x - actor.x; const dy = tgt.y - actor.y; const dist = Math.hypot(dx,dy)||1;
            const moveDist = Math.min(parsed.mechanics?.dashDistance || 140, dist - Math.max(0, tgt.hitbox||24));
            actor.x += (dx/dist) * moveDist;
            actor.y += (dy/dist) * Math.max(0.1, moveDist*0.12);
        } catch(e){}
        ui.playVfx(actor, 'vfx-electric');

        // Damage calculation: X + 0.8 * atk -> use parsed.scalePct
        const atk = actor.effectiveAtk || actor.stats.atk || 50;
        const base = parsed.baseDmg || 0;
        let dmg = Math.floor(base + atk * (parsed.scalePct || 0.8));
        // If target already Electrified -> deal additional true damage = 0.3 * magic atk instead (per spec)
        const already = tgt.activeEffects.find(e => e.type === 'electrified');
        if (already && (parsed.mechanics && parsed.mechanics.trueDamageIfAlreadyElectrified)) {
            const matk = actor.effectiveMagicAtk || actor.stats.magicAtk || 0;
            const extraTrue = Math.floor((matk) * 0.3);
            tgt.receiveAction({ amount: extraTrue, type:'true', effectType:'damage' });
            ui.showFloatingText(tgt, extraTrue, 'damage-number crit');
            ui.playVfx(tgt, 'vfx-explosion');
        }
        // apply main hit
        const res = tgt.receiveAction({ amount:dmg, type:'physical', isCrit:false, element:'electric', attackerAccuracy:28, ignoreDef: false });
        ui.showFloatingText(tgt, res.amount, 'damage-number');
        ui.playVfx(tgt, 'vfx-electric');
        // Apply Electrified for 3 seconds (increase damage from Sasuke's lightning)
        tgt.applyStatus({ type:'electrified', duration: parsed.mechanics?.electrifiedDur || 3, value: 0.10 });
        ui.showFloatingText(tgt, 'ELECTRIFIED', 'status-text');
        // Grant Sharingan Insight stack
        addInsight(actor, parsed.mechanics?.grantsInsight || 1, 3);

        // Cooldown reduction if stacks >=3
        if (getInsightStacks(actor) >= 3) {
            actor.cooldownTimers[decision.ability.name] = Math.max(0, (parsed.cooldown || 8) - (parsed.mechanics?.cooldownReducedAt3Insight || 1));
        } else {
            actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 8;
        }

        return;
    }

    // GREAT FIREBALL
    if (name.includes('gōkakyū') || name.includes('great fireball') || name.includes('gokakyu')) {
        const center = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!center) return;
        ui.playVfx(center, 'vfx-fire-storm');
        const matk = actor.effectiveMagicAtk || actor.stats.magicAtk || 50;
        // instant explosion damage
        const initial = Math.floor((parsed.baseDmg || 0) + matk * (parsed.scalePct || 0.7));
        const radius = 140;
        const targets = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= radius);
        let hitAtLeastOne = false;
        for (const t of targets){
            const res = t.receiveAction({ amount: initial, type:'magic', isCrit:false, element:'fire', attackerAccuracy:18 });
            ui.showFloatingText(t, res.amount, 'damage-number');
            ui.playVfx(t, 'explosion');
            hitAtLeastOne = true;
            // If Electrified, apply additional burn/increased damage per spec (handled as extra flat or percent)
            if (t.activeEffects.find(e=>e.type==='electrified')) {
                const extra = Math.floor(initial * (parsed.mechanics?.electrifiedBonusPct || 0.20));
                const r2 = t.receiveAction({ amount: extra, type:'magic', isCrit:false, effectType:'damage', element:'fire' });
                ui.showFloatingText(t, r2.amount, 'damage-number');
                // also apply lingering burn if level thresholds mention it in upgrades; we approximate generic burn
                t.applyStatus({ type:'burning', duration: (lvl >= 100 ? 6 : 3), value: Math.floor((matk * ((lvl>=100)?0.05:0.025))) });
            }
        }
        // Lingering flames: ticks per second for parsed.mechanics.lingerSeconds
        if (hitAtLeastOne && parsed.mechanics?.grantsInsightOnHit) addInsight(actor, 1, 3);
        const linger = parsed.mechanics?.lingerSeconds || 4;
        const tickDmg = Math.floor(matk * (parsed.mechanics?.perSecPct || 0.1));
        // spawn simple non-blocking loop
        (async ()=>{
            const end = Date.now() + linger*1000;
            while(Date.now() < end){
                for (const t of liveEnemies.filter(e=>!e.isDead && Math.hypot(e.x-center.x,e.y-center.y)<=radius)){
                    const r = t.receiveAction({ amount: tickDmg, type:'magic', isCrit:false, element:'fire', attackerAccuracy:14 });
                    ui.showFloatingText(t, r.amount, 'damage-number');
                }
                await new Promise(r=>setTimeout(r, 1000));
            }
        })();
        actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 10;
        return;
    }

    // KIRIN (ULTIMATE)
    if (name.includes('kirin')) {
        const center = decision.targets && decision.targets[0] ? decision.targets[0] : liveEnemies[0];
        if (!center) return;
        ui.playVfx(center, 'vfx-beam');
        await new Promise(r=>setTimeout(r, 220));
        const matk = actor.effectiveMagicAtk || actor.stats.magicAtk || 100;
        const base = Math.floor((parsed.baseDmg || 0) + matk * (parsed.scalePct || 1.2));
        const radius = 180;
        const targets = liveEnemies.filter(e=>Math.hypot(e.x-center.x,e.y-center.y)<=radius);
        for (const t of targets) {
            let dmg = base;
            if (t.activeEffects.find(e=>e.type==='electrified')) {
                dmg = Math.floor(dmg * (1 + (parsed.mechanics?.electrifiedAmplify || 0.5)));
                t.applyStatus({ type:'stun', duration: parsed.mechanics?.stunDur || 1.5 });
                ui.showFloatingText(t, 'STUNNED', 'status-text');
            }
            const res = t.receiveAction({ amount:dmg, type:'magic', isCrit:false, element:'electric', attackerAccuracy:24 });
            ui.showFloatingText(t, res.amount, 'damage-number crit');
            ui.playVfx(t, 'vfx-explosion');
        }
        // Per spec: After Kirin, next ability has no cooldown -> implement by setting a temporary flag
        actor.customResources = actor.customResources || {};
        actor.customResources._kirin_followup_free = true;
        // At level 200 grant Electrified to all
        if (lvl >= 200 && parsed.mechanics?.grantsElectrifiedAt200) {
            for (const t of targets) {
                t.applyStatus({ type:'electrified', duration:3, value:0.10 });
            }
        }
        // Reset insight stacks after cast if upgrade applies at high levels (we approximate only if lvl>=200 per upgrades)
        if (lvl >= 200) consumeAllInsight(actor);
        actor.energy = 0;
        actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 90;
        return;
    }

    // Signature Passive/Indra's Charge handled reactively via updatePassives or getParsedAbility consumer; we provide a small manual trigger in case it's used as an active
    if (name.includes('indra') || name.includes('signature')) {
        // Grant Indra's Charge buff if stacks >= required
        const stacks = getInsightStacks(actor);
        if (stacks >= (parsed.mechanics?.requiredStacks || 3)) {
            actor.applyStatus({ type:'buff_indra_charge', duration: parsed.mechanics?.chargeDuration || 7, value:1 });
            actor.applyStatus({ type:'buff_tenacity', duration: parsed.mechanics?.chargeDuration || 7, value: parsed.mechanics?.tenacityPct || 0.15 });
            actor.applyStatus({ type:'buff_evasion', duration: parsed.mechanics?.chargeDuration || 7, value: parsed.mechanics?.evasionPct || 0.10 });
            ui.showFloatingText(actor, "INDRA'S CHARGE", 'status-text buff');
            consumeAllInsight(actor);
        }
        return;
    }

    // Fallback - minimal basic strike
    {
        const tgt = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!tgt) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 40;
        const dmg = Math.floor(18 + atk * 0.4);
        const res = tgt.receiveAction({ amount:dmg, type:'physical', isCrit:false, element:'physical', attackerAccuracy:18 });
        ui.showFloatingText(tgt, res.amount, 'damage-number');
        ui.playVfx(tgt, 'slash');
    }
}