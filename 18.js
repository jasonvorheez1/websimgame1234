/**
 * 18.js — Bruce Wayne (Batman: The Animated Series) ability module
 *
 * Exports:
 *  - getParsedAbility(charName, abilityName, description, skillLevel, tags)
 *  - decideAction(actor, enemies, allies, battle)
 *  - executeAction(battle, actor, decision, parsed)
 *  - updatePassives(actor, dt)
 *
 * Implements:
 *  - Preparedness: Resource generated over time (1 stack / 2s) and via Ult usage.
 *  - Basic Attack: Ranged Ice physical attack.
 *  - Calculated Evasion: Defensive repositioning and stealth.
 *  - Batarang Barrage: Multi-hit debuffing skill (consumes Preparedness).
 *  - Underestimated Intellect: Passive resource generation.
 *  - The Knight Falls: Ultimate counter-attack buff.
 *  - World's Greatest Detective: Signature threat-marking passive.
 */

const CLAMP = (v, a, b) => Math.max(a, Math.min(b, v));

export function getParsedAbility(charName, abilityName, description = "", skillLevel = 1, tags = []) {
    const key = (abilityName || '').toLowerCase();
    const lvlMult = 1 + ((skillLevel - 1) * 0.1);

    if (key.includes('basic attack')) {
        return {
            typeCategory: 'basic',
            baseDmg: Math.floor(12 * lvlMult),
            scalePct: 0.3 * lvlMult,
            scaleStat: 'atk',
            element: 'ice',
            cooldown: 1.1,
            visualKeyword: 'proj-ice'
        };
    }

    if (key.includes('calculated evasion')) {
        return {
            typeCategory: 'skill',
            cooldown: 10,
            mechanics: {
                duration: 3,
                stealthDuration: 1.5,
                preparednessGain: 5,
                repositionDist: 15 * 40, // 15 units = 600px
                shieldPct: 0.102,
                evadeDelay: 0.1
            },
            visualKeyword: 'teleport'
        };
    }

    if (key.includes('batarang barrage')) {
        return {
            typeCategory: 'skill',
            baseDmg: 0,
            scalePct: 0.40, // 40% ATK per batarang
            multiHitCount: 3,
            cooldown: 8,
            mechanics: {
                preparednessCost: 10,
                debuffChance: 0.30,
                debuffDuration: 2,
                debuffs: ['blind', 'slow', 'silence']
            },
            visualKeyword: 'vfx-slash'
        };
    }

    if (key.includes('underestimated intellect')) {
        return {
            typeCategory: 'passive',
            mechanics: {
                genRate: 2.0, // 1 stack every 2s
                ultGenAmount: 3,
                maxStacks: 20
            }
        };
    }

    if (key.includes('the knight falls')) {
        return {
            typeCategory: 'ultimate',
            baseDmg: 0,
            scalePct: 0.80, // 80% ATK
            hpScalePct: 0.05, // 5% Target Max HP
            cooldown: 90,
            mechanics: {
                duration: 8,
                radius: 500,
                maxCounters: 5,
                preparednessCostPerCounter: 3,
                speedBuffPct: 0.15
            },
            visualKeyword: 'vfx-dark-void'
        };
    }

    if (key.includes('world\'s greatest detective')) {
        return {
            typeCategory: 'passive',
            mechanics: {
                tenacity: 30,
                evasion: 15,
                critReduce: 0.10,
                dmgBonus: 0.05
            }
        };
    }

    return null;
}

export function updatePassives(actor, dt) {
    actor.customResources = actor.customResources || {};
    const intellect = getParsedAbility(actor.data.name, 'Underestimated Intellect')?.mechanics || { genRate: 2, maxStacks: 20 };
    
    // Preparedness Generation
    actor._prepTimer = (actor._prepTimer || 0) + dt;
    if (actor._prepTimer >= intellect.genRate) {
        actor._prepTimer = 0;
        actor.customResources['Preparedness'] = Math.min(intellect.maxStacks, (actor.customResources['Preparedness'] || 0) + 1);
    }

    // World's Greatest Detective: Mark 'Targeted' highest threat
    const enemies = (actor.team === 'ally' ? actor.battleSystem?.enemies : actor.battleSystem?.allies) || [];
    const targeted = enemies.find(e => e.activeEffects.some(ef => ef.type === 'targeted_mark'));
    
    if (!targeted) {
        const liveEnemies = enemies.filter(e => !e.isDead);
        if (liveEnemies.length > 0) {
            // Priority: atk + magicAtk + speed
            const best = liveEnemies.sort((a,b) => {
                const scoreA = (a.stats.atk || 0) + (a.stats.magicAtk || 0) + (a.stats.speed || 0);
                const scoreB = (b.stats.atk || 0) + (b.stats.magicAtk || 0) + (b.stats.speed || 0);
                return scoreB - scoreA;
            })[0];
            
            const sig = getParsedAbility(actor.data.name, 'World\'s Greatest Detective')?.mechanics || {};
            best.applyStatus({
                type: 'targeted_mark',
                name: 'Targeted',
                duration: Infinity,
                modifiers: {
                    critChance: -sig.critReduce,
                    dmgTaken: sig.dmgBonus
                }
            });
        }
    }

    // Passive Modifiers from Detective
    const sig = getParsedAbility(actor.data.name, 'World\'s Greatest Detective')?.mechanics || {};
    actor.passiveModifiers = actor.passiveModifiers || {};
    actor.passiveModifiers.tenacity = sig.tenacity;
    actor.passiveModifiers.evasion = sig.evasion / 100;

    // Handle Ultimate "Knight Falls" Counter-Logic
    // We check if allies took damage while Bruce has the buff
    const kfBuff = actor.activeEffects.find(e => e.type === 'knight_falls_aura');
    if (kfBuff && kfBuff.countersRemaining > 0) {
        const allies = actor.team === 'ally' ? actor.battleSystem.allies : actor.battleSystem.enemies;
        const enemies = actor.team === 'ally' ? actor.battleSystem.enemies : actor.battleSystem.allies;
        
        allies.forEach(a => {
            // Simple heuristic: if an ally was hit and Bruce has Prep, trigger counter
            // In this sim, we check if ally is "acting target" of any enemy
            const attackers = enemies.filter(e => e.currentActionTarget === a && e.isActing);
            if (attackers.length > 0 && actor.customResources['Preparedness'] >= 3) {
                attackers.forEach(attacker => {
                    if (kfBuff.countersRemaining <= 0) return;
                    
                    const dist = Math.hypot(a.x - actor.x, a.y - actor.y);
                    if (dist <= 500) {
                        actor.customResources['Preparedness'] -= 3;
                        kfBuff.countersRemaining--;
                        
                        // Execute strike
                        const atk = actor.effectiveAtk || 50;
                        const dmg = Math.floor(atk * 0.80 + attacker.maxHp * 0.05);
                        attacker.receiveAction({ amount: dmg, type: 'physical', element: 'physical' });
                        actor.battleSystem.uiManager.showFloatingText(attacker, dmg, 'damage-number crit');
                        actor.battleSystem.uiManager.playVfx(attacker, 'slash_heavy');
                    }
                });
            }
        });
    }
}

export async function decideAction(actor, enemies, allies, battle) {
    const liveEnemies = enemies.filter(e => !e.isDead);
    if (!liveEnemies.length) return { ability: { name: 'Basic Attack' }, targets: [] };

    // Ultimate priority
    const ult = actor.data.abilities.find(a => a.type === 'Ultimate');
    if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
        return { ability: ult, targets: liveEnemies.slice(0, 5), type: 'ultimate' };
    }

    // Calculated Evasion - use if health low or strategic
    const evas = actor.data.abilities.find(a => a.name.includes('Calculated Evasion'));
    if (evas && !actor.cooldownTimers?.[evas.name] && (actor.currentHp / actor.maxHp < 0.8)) {
        return { ability: evas, targets: [actor], type: 'skill' };
    }

    // Batarang Barrage - use on highest atk enemy
    const bat = actor.data.abilities.find(a => a.name.includes('Batarang'));
    if (bat && !actor.cooldownTimers?.[bat.name]) {
        const target = liveEnemies.sort((a,b) => b.stats.atk - a.stats.atk)[0];
        return { ability: bat, targets: [target], type: 'skill' };
    }

    // Basic Attack fallback
    const basic = actor.data.abilities.find(a => a.type === 'Active') || { name: 'Basic Attack' };
    return { ability: basic, targets: [actor.currentActionTarget || liveEnemies[0]], type: 'basic' };
}

export async function executeAction(battle, actor, decision, parsed) {
    if (!decision || !decision.ability) return;
    const ui = battle.uiManager;
    const name = (decision.ability.name || '').toLowerCase();
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
    const liveEnemies = enemies.filter(e => !e.isDead);

    parsed = parsed || getParsedAbility(actor.data.name, decision.ability.name);

    if (name.includes('basic attack')) {
        const t = decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const dmg = Math.floor((parsed.baseDmg || 12) + (actor.effectiveAtk * (parsed.scalePct || 0.3)));
        t.receiveAction({ amount: dmg, type: 'physical', element: 'ice' });
        ui.showProjectile(actor, t, 'ice');
        ui.showFloatingText(t, dmg, 'damage-number');
        ui.playVfx(t, 'proj-ice');
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 10);
        return;
    }

    if (name.includes('calculated evasion')) {
        const mech = parsed.mechanics;
        ui.showFloatingText(actor, "CALCULATING...", "status-text");
        
        // Vanish / Invuln
        actor.applyStatus({ type: 'invulnerability', duration: 0.5 });
        ui.playVfx(actor, 'teleport');
        
        // Reposition toward backline
        const backTarget = liveEnemies.sort((a,b) => Math.abs(b.x - actor.x) - Math.abs(a.x - actor.x))[0];
        if (backTarget) {
            const dx = backTarget.x - actor.x;
            const nx = dx / (Math.abs(dx) || 1);
            actor.x += nx * 200; // Move toward enemy backline
        }

        // Stealth and Preparedness
        actor.applyStatus({ type: 'stealth', duration: mech.stealthDuration });
        actor.customResources['Preparedness'] = Math.min(20, (actor.customResources['Preparedness'] || 0) + mech.preparednessGain);
        
        // Shield
        const shieldAmt = Math.floor(actor.maxHp * mech.shieldPct);
        actor.receiveAction({ amount: shieldAmt, effectType: 'shield' });
        
        actor.cooldownTimers[decision.ability.name] = 10;
        return;
    }

    if (name.includes('batarang barrage')) {
        const t = decision.targets[0] || liveEnemies[0];
        if (!t) return;
        
        const mech = parsed.mechanics;
        const usePrep = (actor.customResources['Preparedness'] || 0) >= mech.preparednessCost;
        if (usePrep) actor.customResources['Preparedness'] -= mech.preparednessCost;

        for (let i = 0; i < 3; i++) {
            const dmg = Math.floor(actor.effectiveAtk * parsed.scalePct);
            t.receiveAction({ amount: dmg, type: 'physical', element: 'physical' });
            ui.showFloatingText(t, dmg, 'damage-number');
            ui.playVfx(t, 'slash');
            
            if (usePrep && Math.random() < mech.debuffChance) {
                const debuffType = mech.debuffs[Math.floor(Math.random() * mech.debuffs.length)];
                t.applyStatus({ type: debuffType, duration: mech.debuffDuration });
                ui.showFloatingText(t, debuffType.toUpperCase(), 'status-text');
            }
            await new Promise(r => setTimeout(r, 100));
        }
        
        actor.cooldownTimers[decision.ability.name] = 8;
        return;
    }

    if (name.includes('knight falls')) {
        const mech = parsed.mechanics;
        ui.showFloatingText(actor, "THE KNIGHT FALLS", "status-text buff");
        ui.playVfx(actor, 'vfx-dark-void');
        
        // Buff for Bruce
        actor.applyStatus({
            type: 'knight_falls_aura',
            duration: mech.duration,
            countersRemaining: mech.maxCounters,
            sourceId: actor.id
        });

        // Speed buff for allies
        friends.forEach(f => {
            if (!f.isDead) {
                f.applyStatus({ type: 'buff_speed', value: mech.speedBuffPct, duration: mech.duration });
                ui.playVfx(f, 'vfx-buff');
            }
        });

        actor.energy = 0;
        actor.cooldownTimers[decision.ability.name] = 90;
        return;
    }
}