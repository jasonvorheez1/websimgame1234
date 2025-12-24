/**
 * 1.js
 * Character: Knuckles (export_id: 1)
 */

export async function decideAction(actor, enemies, allies, battleSystem) {
    const hpPct = actor.currentHp / actor.maxHp;
    const isSilenced = actor.isSilenced;

    // 1. Ultimate: Angel Island Avalanche
    if (actor.energy >= actor.maxEnergy && !isSilenced) {
        return { 
            ability: actor.data.abilities.find(a => a.type === 'Ultimate'),
            targets: enemies, // AoE
            type: 'ultimate'
        };
    }

    // 2. Skills
    if (!isSilenced) {
        // Drill Claw Excavation: Priority highest HP
        if (!actor.cooldownTimers['Drill Claw Excavation']) {
            const targets = [...enemies].sort((a, b) => b.currentHp - a.currentHp);
            return {
                ability: actor.data.abilities.find(a => a.name === 'Drill Claw Excavation'),
                targets: [targets[0]],
                type: 'skill'
            };
        }

        // Maximum Heat Knuckles: Priority lowest Def
        if (!actor.cooldownTimers['Maximum Heat Knuckles Attack']) {
            const targets = [...enemies].sort((a, b) => a.effectiveDef - b.effectiveDef);
            return {
                ability: actor.data.abilities.find(a => a.name === 'Maximum Heat Knuckles Attack'),
                targets: [targets[0]],
                type: 'skill'
            };
        }
    }

    // 3. Basic Attack
    const basic = actor.data.abilities.find(a => a.name.includes('Basic')) || actor.data.abilities[0];
    return {
        ability: basic,
        targets: [enemies[0]],
        type: 'basic'
    };
}

export async function executeAction(battleSystem, actor, decision, parsed) {
    const { ability } = decision;
    const { uiManager } = battleSystem;
    const level = actor.level || 1;

    // Apply Cooldowns
    if (decision.type === 'ultimate') {
        actor.energy = 0;
    } else if (decision.type === 'skill') {
        let cd = parsed.cooldown || 6;
        if (ability.name === 'Maximum Heat Knuckles Attack' && level >= 120) cd = 5;
        if (ability.name === 'Drill Claw Excavation' && level >= 130) cd = 7;
        actor.cooldownTimers[ability.name] = cd;
    }

    uiManager.showAbilityName(actor, ability.name);
    uiManager.animateAction(actor, ability.name);

    if (ability.name === 'Angel Island Avalanche') {
        // Ultimate Logic
        uiManager.playVfx(actor, 'earth');
        actor.applyStatus({ type: 'invulnerability', duration: 3, name: 'CC Immunity' });
        
        const hits = level >= 200 ? 10 : 6; // 3s total, every 0.3s or 0.5s
        const interval = (level >= 200 ? 300 : 500) / battleSystem.battleSpeed;
        
        for (let i = 0; i < hits; i++) {
            if (actor.isDead) break;
            const enemies = (actor.team === 'ally' ? battleSystem.enemies : battleSystem.allies).filter(e => !e.isDead);
            enemies.forEach(target => {
                let dmg = 37 + (actor.effectiveAtk * 0.2);
                if (level >= 50) dmg *= 1.2;
                
                const res = target.receiveAction({ amount: dmg, type: 'physical', element: 'earth' });
                if (res.type !== 'miss') {
                    uiManager.showFloatingText(target, res.amount, 'damage-number earth');
                    uiManager.playVfx(target, 'earth');
                    target.applyStatus({ type: 'slow', value: 0.3, duration: level >= 90 ? 1.5 : 1 });
                }
            });
            await new Promise(r => setTimeout(r, interval));
        }
    } 
    else if (ability.name === 'Drill Claw Excavation') {
        // Skill 2 Logic
        const target = decision.targets[0];
        uiManager.playVfx(actor, 'teleport'); // Digging effect
        actor.x = target.x;
        actor.y = target.y + 20;
        
        let dmg = 19 + (actor.effectiveAtk * 0.4);
        if (level >= 30) dmg *= 1.2;
        
        const enemies = (actor.team === 'ally' ? battleSystem.enemies : battleSystem.allies).filter(e => !e.isDead);
        enemies.forEach(e => {
            const dist = Math.hypot(e.x - actor.x, e.y - actor.y);
            if (dist < 100) {
                const res = e.receiveAction({ amount: dmg, type: 'physical', element: 'earth' });
                if (res.type !== 'miss') {
                    uiManager.showFloatingText(e, res.amount, 'damage-number earth');
                    uiManager.playVfx(e, 'earth');
                    e.applyStatus({ type: 'stun', duration: level >= 70 ? 1.5 : 1 });
                    const defRed = 19 + (level >= 190 ? 19 : 0);
                    e.applyStatus({ type: 'debuff_def', value: defRed / (e.stats.def + 1), duration: 4 });
                }
            }
        });
    }
    else if (ability.name === 'Maximum Heat Knuckles Attack') {
        // Skill 1 Logic
        const target = decision.targets[0];
        let dmg = 24 + (actor.effectiveAtk * 0.6);
        if (level >= 20) dmg *= 1.15;
        if (level >= 180) dmg *= 1.25;

        const res = target.receiveAction({ amount: dmg, type: 'physical', element: 'fire' });
        if (res.type !== 'miss') {
            uiManager.showFloatingText(target, res.amount, 'damage-number fire');
            uiManager.playVfx(target, 'explosion');
            
            // Knockback
            const dir = target.x > actor.x ? 1 : -1;
            target.x += dir * 40;

            // Burn chance
            let burnChance = (actor.currentHp / actor.maxHp < 0.5) ? 0.2 : 0.1;
            if (Math.random() < burnChance) {
                target.applyStatus({ 
                    type: 'burn', 
                    value: 24 + (actor.effectiveAtk * 0.1), 
                    duration: level >= 60 ? 5 : 3 
                });
            }
        }
    }
    else {
        // Basic Attack Logic
        const target = decision.targets[0];
        let dmg = 9 + (actor.effectiveAtk * 0.1);
        if (level >= 10) dmg *= 1.1;
        
        uiManager.showProjectile(actor, target, 'fire');
        await new Promise(r => setTimeout(r, 300 / battleSystem.battleSpeed));
        
        const res = target.receiveAction({ amount: dmg, type: 'physical', element: 'fire' });
        if (res.type !== 'miss') {
            uiManager.showFloatingText(target, res.amount, 'damage-number fire');
            uiManager.playVfx(target, 'fire');
        }
    }
}

// Special updates for Passives (Guardian's Resolve & Echidna Resilience)
export function updatePassives(actor, dt) {
    const level = actor.level || 1;
    const hpPct = actor.currentHp / actor.maxHp;

    // 1. Guardian's Resolve
    let baseDR = 0.05;
    if (level >= 40) baseDR = 0.07;
    if (level >= 200) baseDR = 0.10;
    
    let missingPct = 1 - hpPct;
    let scalingDR = Math.floor(missingPct / 0.25) * (level >= 80 ? 0.06 : 0.05);
    
    // Total DR applied as a modifier (clamped as per skill description)
    const totalDR = Math.min(0.20 + (level >= 200 ? 0.05 : 0), baseDR + scalingDR);
    actor.passiveModifiers.damageReduction = totalDR;

    if (hpPct < 0.5) {
        const tenacityVal = 115 + (level >= 140 ? 115 : 0);
        actor.applyStatus({ type: 'buff_tenacity', value: tenacityVal / 100, duration: 5, name: "Guardian's Resolve" });
    }

    // 2. Echidna Resilience
    let flatTenacity = 218;
    let flatEvasion = 218;
    if (level >= 40) { flatTenacity += 218; flatEvasion += 218; }
    if (level >= 180) { flatTenacity += 218; flatEvasion += 218; }
    
    actor.passiveModifiers.tenacity = (actor.passiveModifiers.tenacity || 0) + (flatTenacity / 1000);
    actor.passiveModifiers.evasion = (actor.passiveModifiers.evasion || 0) + (flatEvasion / 1000);

    if (hpPct > 0.75) {
        const atkBonus = 218 + (level >= 140 ? 218 : 0);
        actor.passiveModifiers.atk = (actor.passiveModifiers.atk || 0) + (atkBonus / actor.stats.atk);
    }
}