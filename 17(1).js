/**
 * 17.js — Ben Tennyson (Ben 10) ability module
 * 
 * Implements:
 *  - Omnitrix Pulse (Physical + Temporal Debuff + Anomaly)
 *  - Swampfire Transformation (Magic basic + Burn + HP Regen)
 *  - Shocking Refined (Physical Heavy Blow + Shield)
 *  - Omnitrix Overdrive (Passive Speed/Dmg surge after cooldown)
 *  - Hero Time (Ultimate: Rapid swaps + Speed/Atk buff + Shield)
 *  - Signature Passive: Reactive Shift (Evasion + Speed Burst + Tenacity)
 */

import { clamp, pickRandom } from './Systems.js';

export function getParsedAbility(charName, abilityName, description = "", skillLevel = 1, tags = []) {
    const key = (abilityName || '').toLowerCase();
    const lvlMult = 1 + ((skillLevel - 1) * 0.1);

    if (key.includes('pulse')) {
        return {
            typeCategory: 'basic',
            baseDmg: Math.floor(18 * lvlMult),
            scalePct: 0.25 * lvlMult,
            scaleStat: 'atk',
            element: 'physical',
            cooldown: 1.2,
            visualKeyword: 'vfx-magic',
            mechanics: {
                evasionDebuffPct: 0.10,
                debuffDur: 3,
                anomalyChance: 0.15
            }
        };
    }

    if (key.includes('swampfire')) {
        return {
            typeCategory: 'skill',
            duration: 8,
            regenPct: 0.02,
            burnDmg: 10,
            burnDur: 2,
            omnitrixCd: 15,
            visualKeyword: 'vfx-fire',
            mechanics: {
                magicAtkBuff: 0.0, // Level 125 upgrade
                basicScale: 0.20,
                basicBase: 40
            }
        };
    }

    if (key.includes('shocking refined')) {
        return {
            typeCategory: 'skill',
            baseDmg: Math.floor(45 * lvlMult),
            scalePct: 0.40 * lvlMult,
            scaleStat: 'atk',
            element: 'electric',
            cooldown: 10,
            visualKeyword: 'vfx-electric',
            mechanics: {
                shieldOnLv50: 0.10,
                finisherBonus: 1.25 // vs low HP
            }
        };
    }

    if (key.includes('overdrive')) {
        return {
            typeCategory: 'passive',
            duration: 4,
            speedBuff: 0.10,
            dmgBuff: 0.10,
            ccReduction: 0.15
        };
    }

    if (key.includes('hero time')) {
        return {
            typeCategory: 'ultimate',
            duration: 10,
            speedAtkBuff: 0.20,
            reducedCd: 3,
            shieldPct: 0.15,
            visualKeyword: 'vfx-holy-light'
        };
    }

    if (key.includes('dodge') || key.includes('reactive shift')) {
        return {
            typeCategory: 'passive',
            evadeChance: 0.15,
            speedBoost: 0.25,
            tenacity: 20,
            allyTenacity: 10
        };
    }

    return null;
}

export function updatePassives(actor, dt) {
    actor.customResources = actor.customResources || {};
    actor.resourceDecayTimers = actor.resourceDecayTimers || {};
    const lvl = actor.level || 1;

    // 1. Omnitrix Cooldown Logic
    if (actor.customResources.omnitrix_cd > 0) {
        actor.customResources.omnitrix_cd -= dt;
        if (actor.customResources.omnitrix_cd <= 0) {
            actor.customResources.omnitrix_cd = 0;
            // Trigger Overdrive
            const odDur = lvl >= 40 ? 6 : 4;
            actor.customResources.overdrive_timer = odDur;
            actor.battleSystem?.uiManager.showFloatingText(actor, "OVERDRIVE!", "status-text buff");
        }
    }

    // 2. Transformation Active Timer
    if (actor.customResources.transform_timer > 0) {
        actor.customResources.transform_timer -= dt;
        if (actor.customResources.transform_timer <= 0) {
            actor.customResources.transform_timer = 0;
            actor.customResources.form = 'human';
            actor.battleSystem?.uiManager.showFloatingText(actor, "TIMEOUT", "status-text");
            // Level 175: Reduce cooldown by 3s
            if (lvl >= 175) actor.customResources.omnitrix_cd = Math.max(0, actor.customResources.omnitrix_cd - 3);
        }
    }

    // 3. Overdrive Active Logic
    if (actor.customResources.overdrive_timer > 0) {
        actor.customResources.overdrive_timer -= dt;
        actor.passiveModifiers.overdrive_dmg = 0.10;
        actor.passiveModifiers.overdrive_speed = 0.10;
        // Level 140: +5% Evasion
        if (lvl >= 140) actor.passiveModifiers.overdrive_evasion = 0.05;
        else delete actor.passiveModifiers.overdrive_evasion;
    } else {
        delete actor.passiveModifiers.overdrive_dmg;
        delete actor.passiveModifiers.overdrive_speed;
        delete actor.passiveModifiers.overdrive_evasion;
    }

    // 4. Hero Time Duration
    if (actor.customResources.hero_time_timer > 0) {
        actor.customResources.hero_time_timer -= dt;
        actor.passiveModifiers.hero_time_buff = 0.20;
    } else {
        delete actor.passiveModifiers.hero_time_buff;
    }

    // 5. Swampfire Passive Regen
    if (actor.customResources.form === 'swampfire') {
        const regenRate = lvl >= 75 ? 0.03 : 0.02;
        const heal = actor.maxHp * regenRate * dt;
        actor.currentHp = Math.min(actor.maxHp, actor.currentHp + heal);
        
        // Level 125: 15% Magic Atk
        if (lvl >= 125) actor.passiveModifiers.swampfire_matk = 0.15;
    } else {
        delete actor.passiveModifiers.swampfire_matk;
    }

    // 6. Signature Tenacity
    const baseTen = lvl >= 200 ? 30 : 20;
    actor.passiveModifiers.signature_tenacity = baseTen;
}

export async function decideAction(actor, enemies, allies, battle) {
    const liveEnemies = enemies.filter(e => !e.isDead);
    if (!liveEnemies.length) return { ability: { name: 'Basic Attack' }, targets: [] };

    // 1. Ultimate: Hero Time
    const ult = (actor.data.abilities || []).find(a => a.type === 'Ultimate');
    if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
        return { ability: ult, type: 'ultimate', targets: [] };
    }

    // 2. Transformation Strategy
    const isTransformed = actor.customResources.form === 'swampfire';
    const canTransform = (actor.customResources.omnitrix_cd || 0) <= 0 || actor.customResources.hero_time_timer > 0;
    
    if (!isTransformed && canTransform) {
        const swamp = (actor.data.abilities || []).find(a => a.name.includes('Swampfire'));
        if (swamp && !actor.cooldownTimers?.[swamp.name]) {
            return { ability: swamp, type: 'skill', targets: [actor] };
        }
    }

    // 3. Shocking Refined (decisive blow)
    const shock = (actor.data.abilities || []).find(a => a.name.includes('Shocking'));
    if (shock && !actor.cooldownTimers?.[shock.name]) {
        const lowHp = liveEnemies.find(e => (e.currentHp / e.maxHp) < 0.4);
        if (lowHp) return { ability: shock, type: 'skill', targets: [lowHp] };
    }

    // 4. Default: Pulse
    const pulse = (actor.data.abilities || []).find(a => a.name.includes('Pulse')) || { name: 'Omnitrix Pulse' };
    const nearest = liveEnemies.sort((a,b) => Math.hypot(a.x-actor.x, a.y-actor.y) - Math.hypot(b.x-actor.x, b.y-actor.y))[0];
    return { ability: pulse, type: 'basic', targets: [nearest] };
}

export async function executeAction(battle, actor, decision, parsed) {
    if (!decision || !decision.ability) return;
    const ui = battle.uiManager;
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const liveEnemies = enemies.filter(e => !e.isDead);
    const lvl = actor.level || 1;

    const ability = decision.ability;
    const name = ability.name.toLowerCase();

    // 1. OMNITRIX PULSE
    if (name.includes('pulse')) {
        const t = decision.targets[0] || liveEnemies[0];
        if (!t) return;
        
        let dmgMult = 1.0;
        let anomalyText = "";
        
        // Level 50 Anomaly logic
        if (lvl >= 50 && Math.random() < 0.15) {
            const roll = Math.random();
            if (roll < 0.33) {
                dmgMult = 1.4;
                anomalyText = "TIMESHIFT: CRITICAL";
            } else if (roll < 0.66) {
                t.applyStatus({ type: 'stun', duration: 1.0 });
                anomalyText = "TIMESHIFT: STALL";
            } else {
                t.applyStatus({ type: 'burn', duration: 3, value: 15 });
                anomalyText = "TIMESHIFT: FRICTION";
            }
            if (anomalyText) ui.showFloatingText(t, anomalyText, "status-text weakness");
        }

        const atk = actor.effectiveAtk || actor.stats.atk || 30;
        const dmg = Math.floor((18 + atk * 0.25) * dmgMult);
        const res = t.receiveAction({ amount: dmg, type: 'physical', attackerAccuracy: 25 });
        
        ui.showFloatingText(t, res.amount, "damage-number");
        ui.playVfx(t, "vfx-magic");

        // Debuff: evasion/interrupt
        t.applyStatus({ type: 'debuff_evasion', duration: (lvl >= 10 ? 4 : 3), value: 0.15 });
        
        // Level 190 Overdrive effect: 5% Max HP True Damage
        if (actor.customResources.overdrive_timer > 0 && lvl >= 190) {
            const trueDmg = Math.floor(t.maxHp * 0.05);
            t.receiveAction({ amount: trueDmg, type: 'true' });
            ui.showFloatingText(t, trueDmg, "damage-number crit true");
        }

        actor.energy = Math.min(actor.maxEnergy, actor.energy + 10);
        return;
    }

    // 2. SWAMPFIRE TRANSFORMATION
    if (name.includes('swampfire')) {
        actor.customResources.form = 'swampfire';
        actor.customResources.transform_timer = 8;
        
        // Trigger Omnitrix Cooldown
        const cd = actor.customResources.hero_time_timer > 0 ? 3 : 15;
        actor.customResources.omnitrix_cd = cd;
        
        ui.showFloatingText(actor, "SWAMPFIRE!", "status-text buff");
        ui.playVfx(actor, "vfx-fire");

        // Hero Time Shield Logic
        if (actor.customResources.hero_time_timer > 0 && !actor.customResources.hero_time_shield_used) {
            const shieldPct = lvl >= 100 ? 0.20 : 0.15;
            const shieldAmt = Math.floor(actor.maxHp * shieldPct);
            actor.receiveAction({ amount: shieldAmt, effectType: 'shield' });
            actor.customResources.hero_time_shield_used = true;
            ui.showFloatingText(actor, `SHIELD ${shieldAmt}`, "status-text buff");
        }

        actor.energy = Math.min(actor.maxEnergy, actor.energy + 5);
        return;
    }

    // 3. SHOCKING REFINED
    if (name.includes('shocking refined')) {
        const t = decision.targets[0] || liveEnemies[0];
        if (!t) return;

        const atk = actor.effectiveAtk || actor.stats.atk || 30;
        let dmg = Math.floor(45 + atk * 0.40);
        
        // Strategic Finisher Logic
        if ((t.currentHp / t.maxHp) < 0.35) dmg *= 1.25;

        const res = t.receiveAction({ amount: dmg, type: 'physical', element: 'electric', attackerAccuracy: 35 });
        ui.showFloatingText(t, res.amount, "damage-number electric");
        ui.playVfx(t, "vfx-electric");

        // Level 50 secondary effect: Shield conversion
        if (lvl >= 50) {
            const shieldAmt = Math.floor(res.amount * 0.15);
            actor.receiveAction({ amount: shieldAmt, effectType: 'shield' });
            ui.showFloatingText(actor, "SHIELD", "status-text buff");
        }

        actor.energy = Math.min(actor.maxEnergy, actor.energy + 15);
        actor.cooldownTimers[ability.name] = (lvl >= 10 ? 8 : 10);
        return;
    }

    // 4. HERO TIME (ULTIMATE)
    if (decision.type === 'ultimate') {
        const dur = lvl >= 150 ? 12 : 10;
        actor.customResources.hero_time_timer = dur;
        actor.customResources.hero_time_shield_used = false;
        
        ui.showAbilityName(actor, "HERO TIME!");
        ui.playVfx(actor, "vfx-holy-light");
        
        actor.energy = 0;
        return;
    }
}