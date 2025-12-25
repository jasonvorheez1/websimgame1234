/**
 * 135.js — Aang (Avatar: The Last Airbender) ability module
 * 
 * Implements:
 *  - Fire Basic Strike (Basic melee/ranged hybrid)
 *  - Airbending Swiftness (Skill: Dash, Evasion buff, Air Scooter visual)
 *  - Elemental Shift (Skill: Toggle between Air/Water/Earth/Fire stances)
 *  - Avatar's Resilience (Passive: HP Regen & Spirit Water emergency heal)
 *  - Tornado Strike (Ultimate: AOE Pull + High Damage)
 *  - Nomad's Light Footwork (Signature Passive: Massive Evasion & Speed)
 */

const STANCES = ["Air", "Water", "Earth", "Fire"];

export function getParsedAbility(charName, abilityName, description = "", skillLevel = 1, tags = []) {
    const key = (abilityName || '').toLowerCase();
    const lvlMult = 1 + ((skillLevel - 1) * 0.1);

    if (key.includes('basic')) {
        return {
            typeCategory: 'basic',
            baseDmg: Math.floor(16 * lvlMult),
            scalePct: 0.25 * lvlMult,
            scaleStat: 'atk',
            element: 'fire',
            cooldown: 1.0,
            visualKeyword: 'fire'
        };
    }

    if (key.includes('swiftness') || key.includes('scooter')) {
        return {
            typeCategory: 'skill',
            cooldown: 10,
            duration: 5,
            speedBuff: 0.35,
            evasionBuff: 0.20,
            visualKeyword: 'vfx-wind',
            mechanics: {
                shieldAt175: 0.10,
                dashDist: 160
            }
        };
    }

    if (key.includes('shift') || key.includes('stance')) {
        return {
            typeCategory: 'skill',
            cooldown: 1,
            duration: 8,
            visualKeyword: 'vfx-magic',
            mechanics: {
                air: { evasion: 0.10, speed: 0.15 },
                water: { regen: 0.03 },
                earth: { def: 0.20 },
                fire: { atk: 0.20 }
            }
        };
    }

    if (key.includes('resilience') || key.includes('avatar')) {
        return {
            typeCategory: 'passive',
            regenPct: 0.02,
            threshold: 0.30,
            emergencyHeal: 0.15,
            drOnHeal: 0.25,
            cooldown: 60
        };
    }

    if (key.includes('tornado') || key.includes('avalanche') || key.includes('ultimate')) {
        return {
            typeCategory: 'ultimate',
            baseDmg: Math.floor(180 * lvlMult),
            scalePct: 1.4 * lvlMult,
            scaleStat: 'magicAtk',
            element: 'wind',
            cooldown: 100,
            visualKeyword: 'vfx-fire-storm',
            mechanics: {
                pullRadius: 300,
                stunDur: 1.5,
                avatarStateBuff: 0.30
            }
        };
    }

    if (key.includes('footwork') || key.includes('nomad')) {
        return {
            typeCategory: 'passive',
            evasion: 0.10,
            speed: 0.10,
            tenacity: 15
        };
    }

    return null;
}

export function updatePassives(actor, dt) {
    actor.customResources = actor.customResources || {};
    const lvl = actor.level || 1;

    // 1. Stance Management
    if (actor.customResources.stance_timer > 0) {
        actor.customResources.stance_timer -= dt;
        const s = actor.customResources.stance || "Air";
        if (s === "Air") {
            actor.passiveModifiers.stance_evasion = 0.10;
            actor.passiveModifiers.stance_speed = 0.15;
        } else if (s === "Water") {
            const heal = actor.maxHp * 0.03 * dt;
            actor.currentHp = Math.min(actor.maxHp, actor.currentHp + heal);
        } else if (s === "Earth") {
            actor.passiveModifiers.stance_def = 0.20;
        } else if (s === "Fire") {
            actor.passiveModifiers.stance_atk = 0.20;
        }
    } else {
        delete actor.passiveModifiers.stance_evasion;
        delete actor.passiveModifiers.stance_speed;
        delete actor.passiveModifiers.stance_def;
        delete actor.passiveModifiers.stance_atk;
    }

    // 2. Avatar's Resilience (Regen & Emergency Heal)
    const regenRate = lvl >= 40 ? 0.03 : 0.02;
    actor.currentHp = Math.min(actor.maxHp, actor.currentHp + (actor.maxHp * regenRate * dt * 0.2));

    if (actor.currentHp / actor.maxHp < 0.30 && (!actor.customResources.resilience_cd || actor.customResources.resilience_cd <= 0)) {
        const heal = actor.maxHp * 0.15;
        actor.currentHp = Math.min(actor.maxHp, actor.currentHp + heal);
        actor.customResources.resilience_cd = lvl >= 140 ? 45 : 60;
        actor.applyStatus({ type: 'buff_def', duration: 5, value: 0.25 });
        actor.battleSystem?.uiManager.showFloatingText(actor, "SPIRIT WATER!", "status-text heal");
        actor.battleSystem?.uiManager.playVfx(actor, 'vfx-heal');
    }
    if (actor.customResources.resilience_cd > 0) actor.customResources.resilience_cd -= dt;

    // 3. Nomad's Light Footwork
    actor.passiveModifiers.footwork_evasion = (lvl >= 70 ? 0.10 : 0.05) + (lvl >= 125 ? 0.05 : 0);
    actor.passiveModifiers.footwork_tenacity = 15;
}

export async function decideAction(actor, enemies, allies, battle) {
    const liveEnemies = enemies.filter(e => !e.isDead);
    if (!liveEnemies.length) return { ability: { name: 'Basic Attack' }, targets: [] };

    // 1. Ultimate: Tornado Strike
    if (actor.energy >= actor.maxEnergy && !actor.isSilenced) {
        const ult = (actor.data.abilities || []).find(a => a.type === 'Ultimate' || a.name.includes('Tornado'));
        if (ult && !actor.cooldownTimers?.[ult.name]) return { ability: ult, type: 'ultimate', targets: [] };
    }

    // 2. Stance Shift (Buff Maintenance)
    if (!actor.customResources.stance_timer || actor.customResources.stance_timer <= 0) {
        const shift = (actor.data.abilities || []).find(a => a.name.includes('Shift') || a.name.includes('Stance'));
        if (shift && !actor.cooldownTimers?.[shift.name]) return { ability: shift, type: 'skill', targets: [actor] };
    }

    // 3. Swiftness (Mobility/Survival)
    if (actor.currentHp / actor.maxHp < 0.6) {
        const swift = (actor.data.abilities || []).find(a => a.name.includes('Swiftness'));
        if (swift && !actor.cooldownTimers?.[swift.name]) return { ability: swift, type: 'skill', targets: [actor] };
    }

    // 4. Default: Basic
    const nearest = liveEnemies.sort((a,b) => Math.hypot(a.x-actor.x, a.y-actor.y) - Math.hypot(b.x-actor.x, b.y-actor.y))[0];
    return { ability: { name: 'Basic Attack' }, type: 'basic', targets: [nearest] };
}

export async function executeAction(battle, actor, decision, parsed) {
    if (!decision || !decision.ability) return;
    const ui = battle.uiManager;
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const liveEnemies = enemies.filter(e => !e.isDead);
    const lvl = actor.level || 1;

    const name = decision.ability.name.toLowerCase();

    if (name.includes('basic')) {
        const t = decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const atk = actor.effectiveAtk || 30;
        const dmg = Math.floor(16 + atk * 0.25);
        const res = t.receiveAction({ amount: dmg, type: 'physical', element: 'fire', attackerAccuracy: 25 });
        ui.showFloatingText(t, res.amount, "damage-number fire");
        ui.playVfx(t, "vfx-fire");
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 10);
        return;
    }

    if (name.includes('swiftness')) {
        ui.showFloatingText(actor, "AIR SCOOTER!", "status-text buff");
        ui.playVfx(actor, "vfx-wind");
        actor.applyStatus({ type: 'buff_speed', duration: 5, value: 0.35 });
        actor.applyStatus({ type: 'buff_evasion', duration: 5, value: 0.20 });
        if (lvl >= 175) {
            actor.receiveAction({ amount: actor.maxHp * 0.10, effectType: 'shield' });
        }
        actor.cooldownTimers[decision.ability.name] = 10;
        return;
    }

    if (name.includes('shift') || name.includes('stance')) {
        const nextIdx = (STANCES.indexOf(actor.customResources.stance || "Air") + 1) % STANCES.length;
        actor.customResources.stance = STANCES[nextIdx];
        actor.customResources.stance_timer = 8;
        ui.showFloatingText(actor, `${actor.customResources.stance.toUpperCase()} STANCE`, "status-text buff");
        ui.playVfx(actor, 'vfx-magic');
        actor.cooldownTimers[decision.ability.name] = 1;
        return;
    }

    if (name.includes('tornado') || decision.type === 'ultimate') {
        ui.announce("AVATAR STATE!");
        ui.playVfx(actor, "vfx-fire-storm");
        
        // Avatar State Transformation
        actor.applyStatus({ type: 'buff_atk', duration: 10, value: 0.30 });
        actor.applyStatus({ type: 'buff_matk', duration: 10, value: 0.30 });
        actor.applyStatus({ type: 'stun_immune', duration: 10 });

        // Pull & Damage
        liveEnemies.forEach(e => {
            const dx = actor.x - e.x;
            const dy = actor.y - e.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 300) {
                e.x += dx * 0.5;
                e.y += dy * 0.5;
                const dmg = Math.floor(180 + actor.effectiveMagicAtk * 1.4);
                const res = e.receiveAction({ amount: dmg, type: 'magic', element: 'wind', attackerAccuracy: 40 });
                ui.showFloatingText(e, res.amount, "damage-number wind");
                e.applyStatus({ type: 'stun', duration: 1.5 });
            }
        });
        actor.energy = 0;
        return;
    }
}