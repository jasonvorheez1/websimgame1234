/**
 * Dandy (Export ID: 20) - Support/Bruiser
 * Franchise: Dandy's World
 * Special Mechanic: Ichor Reserves
 */

export async function decideAction(actor, enemies = [], allies = [], battle) {
    const liveEnemies = enemies.filter(e => !e.isDead);
    const liveAllies = allies.filter(a => !a.isDead);
    const hpPct = actor.currentHp / actor.maxHp;
    const ichor = actor.getResource('Ichor Reserves');

    // 1. Ultimate: Prismatic Bloom (Requires 50 Ichor)
    const ult = (actor.data?.abilities || []).find(a => a.type === 'Ultimate');
    if (ult && ichor >= 50 && !actor.cooldownTimers[ult.name] && !actor._isTransformed) {
        return { ability: ult, type: 'ultimate', targets: liveEnemies };
    }

    // 2. Inventory Management (Skill): Restore Mana/Energy & Heal
    const inventory = (actor.data?.abilities || []).find(a => a.name.includes('Inventory Management'));
    if (inventory && !actor.cooldownTimers[inventory.name]) {
        const allyNeedsResource = liveAllies.some(a => (a.energy < 50));
        const allyNeedsHeal = liveAllies.some(a => (a.currentHp / a.maxHp) < 0.7);
        if (allyNeedsResource || allyNeedsHeal) {
            return { ability: inventory, type: 'skill', targets: [actor] };
        }
    }

    // 3. Dandy's Bargain: Buff/Shield Ally
    const bargain = (actor.data?.abilities || []).find(a => a.name.includes("Dandy's Bargain"));
    if (bargain && !actor.cooldownTimers[bargain.name]) {
        const weakest = [...liveAllies].sort((a, b) => (a.currentHp / a.maxHp) - (b.currentHp / b.maxHp))[0];
        if (weakest) return { ability: bargain, type: 'skill', targets: [weakest] };
    }

    // 4. Chromatic Burst: Channeling Debuff
    const burst = (actor.data?.abilities || []).find(a => a.name.includes('Chromatic Burst'));
    if (burst && !actor.cooldownTimers[burst.name] && !actor._isTransformed) {
        const target = liveEnemies.sort((a, b) => b.pwr - a.pwr)[0]; // Focus highest pwr
        if (target) return { ability: burst, type: 'skill', targets: [target] };
    }

    // 5. Cheerful Zephyr (Buffing Strike)
    const zephyr = (actor.data?.abilities || []).find(a => a.name.includes('Cheerful Zephyr'));
    if (zephyr && !actor.cooldownTimers[zephyr.name]) {
        const target = liveEnemies[0];
        if (target) return { ability: zephyr, type: 'skill', targets: [target] };
    }

    // Default: Basic Attack
    const basic = (actor.data?.abilities || []).find(a => a.tags?.includes('atk')) || { name: 'Basic Attack' };
    return { ability: basic, type: 'basic', targets: [liveEnemies[0]] };
}

export async function getParsedAbility(ability, actor, battle) {
    const n = ability.name.toLowerCase();
    if (n.includes('zephyr')) return { element: 'wind', visualKeyword: 'vfx_wind' };
    if (n.includes('bargain')) return { visualKeyword: 'buff', isShield: true };
    if (n.includes('inventory')) return { visualKeyword: 'vfx_heal', isHeal: true, targeting: 'aoe' };
    if (n.includes('burst')) return { channelDuration: 1.2, visualKeyword: 'beam' };
    if (n.includes('bloom')) return { typeCategory: 'ultimate', visualKeyword: 'vfx_explosion' };
    return null;
}

export async function updatePassives(actor, dt) {
    // Ichor Dividend Logic
    if (!actor._lastEnemyCount) actor._lastEnemyCount = 0;
    const enemies = (actor.team === 'ally' ? actor.battleSystem?.enemies : actor.battleSystem?.allies) || [];
    const currentAlive = enemies.filter(e => !e.isDead).length;
    
    // Detect if an ally killed an enemy
    if (currentAlive < actor._lastEnemyCount) {
        actor.addResource('Ichor Reserves', 15, 200);
        // Passive stat gains (5 tenacity/evasion)
        actor.passiveModifiers.tenacity = (actor.passiveModifiers.tenacity || 0) + 0.05;
        actor.passiveModifiers.evasion = (actor.passiveModifiers.evasion || 0) + 0.05;
        
        // Atk buff to killer (approximated to closest ally near victim or random live ally)
        const liveAllies = (actor.team === 'ally' ? actor.battleSystem?.allies : actor.battleSystem?.enemies).filter(a => !a.isDead);
        const killer = liveAllies[Math.floor(Math.random() * liveAllies.length)];
        if (killer) {
            killer.applyStatus({ 
                type: 'buff_atk', 
                value: (actor.effectiveAtk * 0.05) / (killer.stats.atk || 1), 
                duration: 5,
                name: "Petals for Profit"
            });
            actor.battleSystem?.uiManager.showFloatingText(killer, "PROFIT!", "status-text buff");
        }
    }
    actor._lastEnemyCount = currentAlive;

    // Transformation maintenance
    if (actor._isTransformed) {
        actor._transformationTimer -= dt;
        if (actor._transformationTimer <= 0) {
            actor._isTransformed = false;
            // Instability debuff: -20% ATK/MATK for 5s
            actor.applyStatus({ type: 'debuff_atk', value: -0.2, duration: 5 });
            actor.applyStatus({ type: 'debuff_matk', value: -0.2, duration: 5 });
            actor.battleSystem?.uiManager.showFloatingText(actor, "INSTABILITY", "status-text");
        }
    }
}

export async function executeAction(battle, actor, decision, parsed) {
    const ui = battle.uiManager;
    const ability = decision.ability;
    const name = ability.name.toLowerCase();
    const ichorName = 'Ichor Reserves';

    if (name.includes('zephyr')) {
        const target = decision.targets[0];
        if (!target) return;
        ui.showAbilityName(actor, ability.name);
        ui.playVfx(target, 'vfx_wind');
        
        // Damage target
        const dmg = Math.floor(actor.effectiveAtk * 0.2);
        target.receiveAction({ amount: dmg, type: 'physical', element: 'wind' });
        ui.showFloatingText(target, dmg, 'damage-number wind');

        // Buff weakest ally
        const allies = (actor.team === 'ally' ? battle.allies : battle.enemies).filter(a => !a.isDead);
        const weakest = allies.sort((a,b) => a.currentHp - b.currentHp)[0];
        if (weakest) {
            weakest.applyStatus({ type: 'shield', value: Math.floor(actor.maxHp * 0.05), duration: 2 });
            weakest.applyStatus({ type: 'buff_speed', value: 0.1, duration: 2 });
            ui.showFloatingText(weakest, "ZEPHYR SHIELD", "status-text buff");
        }
        actor.cooldownTimers[ability.name] = 6;
    }

    else if (name.includes('bargain')) {
        const target = decision.targets[0];
        if (!target) return;
        ui.showAbilityName(actor, ability.name);
        ui.playVfx(target, 'buff');
        
        target.applyStatus({ type: 'shield', value: Math.floor(actor.maxHp * 0.1), duration: 3 });
        // Cost reduction (25%) simulated as an 8s energy-regen buff since cost manipulation is engine-deep
        target.applyStatus({ type: 'regen_energy', value: 5, duration: 8 }); 
        
        actor.addResource(ichorName, 5, 200);
        actor.cooldownTimers[ability.name] = 12;
    }

    else if (name.includes('inventory management')) {
        ui.showAbilityName(actor, ability.name);
        ui.playVfx(actor, 'vfx_magic');
        
        const allies = (actor.team === 'ally' ? battle.allies : battle.enemies).filter(a => !a.isDead);
        allies.forEach(a => {
            const dist = Math.hypot(a.x - actor.x, a.y - actor.y);
            if (dist < 200) {
                const heal = Math.floor(actor.effectiveMagicAtk * 0.3);
                a.receiveAction({ amount: heal, effectType: 'heal' });
                a.energy = Math.min(a.maxEnergy, a.energy + 15);
                ui.showFloatingText(a, `+${heal}`, 'damage-number heal');
            }
        });
        
        actor.addResource(ichorName, 10, 200);
        actor.cooldownTimers[ability.name] = 15;
    }

    else if (name.includes('chromatic burst')) {
        const target = decision.targets[0];
        if (!target) return;
        ui.showAbilityName(actor, ability.name);
        
        // Channeling 1.2s
        actor.channeling = true;
        await new Promise(r => setTimeout(r, 1200 / battle.battleSpeed));
        actor.channeling = false;
        
        if (target.isDead) return;
        
        ui.playVfx(target, 'beam');
        const elements = ['fire', 'earth', 'electric', 'nature', 'water', 'dark'];
        elements.forEach((el, i) => {
            setTimeout(() => {
                if (target.isDead) return;
                target.receiveAction({ amount: 15, type: 'magic', element: el });
                ui.showFloatingText(target, 15, `damage-number ${el}`);
            }, i * 100);
        });
        
        target.applyStatus({ type: 'vulnerability_stack', value: 0.07, duration: 8, name: 'Prismatic Resonance', stackLimit: 1 });
        actor.cooldownTimers[ability.name] = 10;
    }

    else if (name.includes('bloom') || name.includes('ultimate')) {
        ui.showAbilityName(actor, "PRISMATIC BLOOM");
        actor.consumeResource(ichorName, 50);
        
        // Transformation state
        actor._isTransformed = true;
        actor._transformationTimer = 15;
        
        // Burst to all
        ui.playVfx(actor, 'vfx_explosion');
        const enemies = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);
        enemies.forEach(e => {
            const dmg = Math.floor(actor.effectiveMagicAtk * 0.6);
            e.receiveAction({ amount: dmg, type: 'magic' });
            e.applyStatus({ type: 'debuff_atk', value: -0.05, duration: 10, name: "Discord Seed", stackLimit: 3 });
            ui.showFloatingText(e, "SEED PLANTED", "status-text");
        });

        actor.cooldownTimers[ability.name] = 75;
    }

    else if (decision.type === 'basic') {
        const target = decision.targets[0];
        if (!target) return;
        ui.showProjectile(actor, target, 'wind');
        await new Promise(r => setTimeout(r, 250));
        const res = target.receiveAction({ amount: actor.effectiveAtk, type: 'physical', element: 'wind' });
        ui.showFloatingText(target, res.amount, 'damage-number wind');
        
        if (actor._isTransformed) {
            target.applyStatus({ type: 'debuff_atk', value: -0.05, duration: 10, name: "Discord Seed", stackLimit: 3 });
        }
    }
}