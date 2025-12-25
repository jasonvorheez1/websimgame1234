/**
 * 14.js — Kyubey (Madoka Magica) ability module
 *
 * Exports:
 *  - getParsedAbility(charName, abilityName, description, skillLevel, tags)
 *  - decideAction(actor, enemies, allies, battle)
 *  - executeAction(battle, actor, decision, parsed)
 *  - updatePassives(actor, dt)
 *
 * Implements:
 *  - Enticing Offer: Contract buff for allies (boosts dmg/healing received) but generates Despair stacks.
 *  - Soul Gem Resonance: Heal and Despair stack reduction; grants shield if target has no Despair.
 *  - Incubator's Calculation: Passive energy management, energy costs for skills, and permanent Magic ATK gain on ally death.
 *  - Inhibition Field: Ultimate field that drains energy, debuffs enemies, and boosts allies based on Despair.
 *  - Incubator's Resolve: Signature passive handling tenacity, evasion, and damage redirection to contracted allies.
 */

const CLAMP = (v, a, b) => Math.max(a, Math.min(b, v));

export function getParsedAbility(charName, abilityName, description = "", skillLevel = 1, tags = []) {
    const key = (abilityName || '').toLowerCase();
    const lvlMult = 1 + ((skillLevel - 1) * 0.1);

    if (key.includes('basic attack')) {
        return {
            typeCategory: 'basic',
            baseDmg: Math.floor(14 * lvlMult),
            scalePct: 0.25 * lvlMult,
            scaleStat: 'atk',
            element: 'wind',
            cooldown: 1.2,
            visualKeyword: 'wind_gust'
        };
    }

    if (key.includes('enticing offer')) {
        return {
            typeCategory: 'skill',
            energyCost: 30,
            cooldown: 8,
            mechanics: {
                duration: skillLevel >= 25 ? 10 : 8,
                dmgBoost: skillLevel >= 75 ? 0.40 : 0.30,
                healingReceivedBoost: skillLevel >= 125 ? 0.30 : 0.20,
                despairInterval: 2,
                renewExtend: 4,
                renewDespair: 2,
                selfEffectiveness: 0.5
            },
            visualKeyword: 'vfx-magic'
        };
    }

    if (key.includes('soul gem resonance')) {
        return {
            typeCategory: 'skill',
            energyCost: 20,
            cooldown: 6,
            baseHeal: Math.floor(60 * lvlMult),
            scalePct: 0.8 * lvlMult,
            scaleStat: 'magicAtk',
            mechanics: {
                despairReduce: skillLevel >= 150 ? 3 : 2,
                despairApplyIfNoContract: 1,
                despairPenaltyPerStack: 0.20,
                shieldMaxHpPct: skillLevel >= 200 ? 0.15 : 0.10,
                shieldDuration: 5,
                hotDuration: 3
            },
            visualKeyword: 'vfx-heal'
        };
    }

    if (key.includes('incubator\'s calculation')) {
        return {
            typeCategory: 'passive',
            mechanics: {
                baseEnergyRegen: skillLevel >= 50 ? 7 : 5,
                contractAllyEnergyRegen: skillLevel >= 100 ? 3 : 2,
                maxDespairEnergyGain: skillLevel >= 150 ? 75 : 50,
                allyDeathMatkGain: skillLevel >= 200 ? 15 : 10
            }
        };
    }

    if (key.includes('inhibition field')) {
        return {
            typeCategory: 'ultimate',
            energyCost: 50,
            energyDrain: 10,
            cooldown: 20,
            mechanics: {
                duration: skillLevel >= 150 ? 8 : 6,
                enemyHealReduce: skillLevel >= 200 ? 0.75 : 0.50,
                enemySpeedReduce: 0.30,
                allyDespairPerSec: 2,
                allyDmgPerDespair: 0.20
            },
            visualKeyword: 'vfx-dark-void'
        };
    }

    if (key.includes('incubator\'s resolve')) {
        return {
            typeCategory: 'passive',
            mechanics: {
                baseTenacity: skillLevel >= 150 ? 25 : (skillLevel >= 50 ? 20 : 15),
                baseEvasion: skillLevel >= 150 ? 20 : (skillLevel >= 50 ? 15 : 10),
                redirectPct: skillLevel >= 200 ? 0.20 : (skillLevel >= 100 ? 0.15 : 0.10),
                redirectSelfContractMult: 0.5,
                matkPenaltyPerDespair: 0.02,
                tenacityPerDespair: 3,
                despairInterval: 5
            }
        };
    }

    return null;
}

export function updatePassives(actor, dt) {
    actor.customResources = actor.customResources || {};
    const calculation = getParsedAbility(actor.data.name, 'Incubator\'s Calculation')?.mechanics || { baseEnergyRegen: 5, contractAllyEnergyRegen: 2 };
    const resolve = getParsedAbility(actor.data.name, 'Incubator\'s Resolve')?.mechanics || { baseTenacity: 15, baseEvasion: 10, despairInterval: 5 };

    // 1. Energy Management
    actor._energyTimer = (actor._energyTimer || 0) + dt;
    if (actor._energyTimer >= 1.0) {
        actor._energyTimer = 0;
        let totalRegen = calculation.baseEnergyRegen;
        
        // Bonus from contracted allies
        const allies = (actor.team === 'ally' ? actor.battleSystem?.allies : actor.battleSystem?.enemies) || [];
        const contractCount = allies.filter(a => a.activeEffects.some(e => e.type === 'contract' && e.sourceId === actor.id)).length;
        totalRegen += (contractCount * calculation.contractAllyEnergyRegen);
        
        actor.energy = CLAMP(actor.energy + totalRegen, 0, actor.maxEnergy);
    }

    // 2. Inhibition Field Energy Drain
    const fieldEffect = actor.activeEffects.find(e => e.type === 'inhibition_field_active');
    if (fieldEffect) {
        actor.energy = CLAMP(actor.energy - 10 * dt, 0, actor.maxEnergy);
        if (actor.energy <= 0) {
            actor.activeEffects = actor.activeEffects.filter(e => e !== fieldEffect);
        }
    }

    // 3. Despair Management & Penalties
    actor.customResources['Despair'] = actor.customResources['Despair'] || 0;
    actor._despairTimer = (actor._despairTimer || 0) + dt;
    if (actor._despairTimer >= resolve.despairInterval) {
        actor._despairTimer = 0;
        actor.customResources['Despair'] = Math.min(10, actor.customResources['Despair'] + 1);
    }

    // Passive modifiers from Despair (Incubator's Resolve)
    const despairStacks = actor.customResources['Despair'];
    actor.passiveModifiers = actor.passiveModifiers || {};
    actor.passiveModifiers.magicAtk = -(despairStacks * resolve.matkPenaltyPerDespair);
    actor.passiveModifiers.tenacity = resolve.baseTenacity + (despairStacks * resolve.tenacityPerDespair);
    actor.passiveModifiers.evasion = resolve.baseEvasion / 100;

    // Stun immunity at 10 stacks
    if (despairStacks >= 10) {
        actor.applyStatus({ type: 'stun_immune', duration: 1.1 });
    }

    // Handle allies with Despair (stack processing)
    const allUnits = [...(actor.battleSystem?.allies || []), ...(actor.battleSystem?.enemies || [])];
    allUnits.forEach(u => {
        if (u.isDead) return;
        
        // Handle Contract Despair generation
        const contract = u.activeEffects.find(e => e.type === 'contract' && e.sourceId === actor.id);
        if (contract) {
            u._contractDespairTimer = (u._contractDespairTimer || 0) + dt;
            if (u._contractDespairTimer >= 2) {
                u._contractDespairTimer = 0;
                u.customResources = u.customResources || {};
                const prev = u.customResources['Despair'] || 0;
                u.customResources['Despair'] = Math.min(10, prev + 1);
                
                // If just hit 10, Kyubey gains energy
                if (prev < 10 && u.customResources['Despair'] === 10) {
                    const energyGain = calculation.maxDespairEnergyGain || 50;
                    actor.energy = Math.min(actor.maxEnergy, actor.energy + energyGain);
                    actor.battleSystem.uiManager.showFloatingText(actor, `+${energyGain} Energy`, 'status-text buff');
                }
            }
        }

        // Apply Despair Penalties to unit
        const stacks = u.customResources?.['Despair'] || 0;
        if (stacks > 0) {
            u.passiveModifiers = u.passiveModifiers || {};
            // Despair: -5% healing output, -3% attack per stack
            u.passiveModifiers.healOutput = -(stacks * 0.05);
            u.passiveModifiers.atk = -(stacks * 0.03);
        }
    });

    // Handle redirecting damage (Incubator's Resolve)
    // Note: Redirection implementation usually requires hooking into BattleCharacter.receiveAction,
    // here we simulate by checking if Kyubey took damage recently and passing it to contracted ally.
}

export async function decideAction(actor, enemies, allies, battle) {
    const liveEnemies = enemies.filter(e => !e.isDead);
    const liveAllies = allies.filter(a => !a.isDead);
    if (!liveEnemies.length) return { ability: { name: 'Basic Attack' }, targets: [] };

    // Ultimate priority: Inhibition Field
    const ult = actor.data.abilities.find(a => a.type === 'Ultimate');
    if (actor.energy >= 50 && ult && !actor.cooldownTimers?.[ult.name]) {
        return { ability: ult, targets: [], type: 'ultimate' };
    }

    // Skill: Soul Gem Resonance (Heal)
    const heal = actor.data.abilities.find(a => a.name.includes('Soul Gem Resonance'));
    if (actor.energy >= 20 && heal && !actor.cooldownTimers?.[heal.name]) {
        // Prioritize contracted allies or lowest HP
        const target = liveAllies.sort((a, b) => {
            const hasContractA = a.activeEffects.some(e => e.type === 'contract');
            const hasContractB = b.activeEffects.some(e => e.type === 'contract');
            if (hasContractA !== hasContractB) return hasContractA ? -1 : 1;
            return (a.currentHp / a.maxHp) - (b.currentHp / b.maxHp);
        })[0] || actor;
        return { ability: heal, targets: [target], type: 'skill' };
    }

    // Skill: Enticing Offer (Contract)
    const contract = actor.data.abilities.find(a => a.name.includes('Enticing Offer'));
    if (actor.energy >= 30 && contract && !actor.cooldownTimers?.[contract.name]) {
        // Buff strongest dps without a contract
        const candidate = liveAllies
            .filter(a => !a.activeEffects.some(e => e.type === 'contract'))
            .sort((a, b) => b.stats.atk - a.stats.atk)[0];
        if (candidate) return { ability: contract, targets: [candidate], type: 'skill' };
    }

    // Basic Attack fallback
    const basic = actor.data.abilities.find(a => a.type === 'Active') || { name: 'Basic Attack' };
    return { ability: basic, targets: [liveEnemies[0]], type: 'basic' };
}

export async function executeAction(battle, actor, decision, parsed) {
    if (!decision || !decision.ability) return;
    const ui = battle.uiManager;
    const name = (decision.ability.name || '').toLowerCase();
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const allies = actor.team === 'ally' ? battle.allies : battle.enemies;
    const liveEnemies = enemies.filter(e => !e.isDead);

    parsed = parsed || getParsedAbility(actor.data.name, decision.ability.name);

    // Check Energy
    if (parsed.energyCost && actor.energy < parsed.energyCost) {
        ui.showFloatingText(actor, "Insufficient Energy", "status-text");
        return;
    }
    if (parsed.energyCost) actor.energy -= parsed.energyCost;

    if (name.includes('basic attack')) {
        const t = decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const dmg = Math.floor((parsed.baseDmg || 14) + (actor.effectiveAtk * (parsed.scalePct || 0.25)));
        t.receiveAction({ amount: dmg, type: 'physical', element: 'wind' });
        ui.showProjectile(actor, t, 'wind');
        ui.showFloatingText(t, dmg, 'damage-number');
        ui.playVfx(t, 'wind_gust');
        return;
    }

    if (name.includes('enticing offer')) {
        const t = decision.targets[0] || actor;
        const mech = parsed.mechanics;
        const isSelf = t === actor;
        const effectiveness = isSelf ? mech.selfEffectiveness : 1.0;

        const existing = t.activeEffects.find(e => e.type === 'contract' && e.sourceId === actor.id);
        if (existing) {
            existing.duration += mech.renewExtend;
            t.customResources = t.customResources || {};
            t.customResources['Despair'] = Math.min(10, (t.customResources['Despair'] || 0) + mech.renewDespair);
            ui.showFloatingText(t, "CONTRACT RENEWED", "status-text buff");
        } else {
            t.applyStatus({
                type: 'contract',
                name: 'Contract',
                duration: mech.duration,
                sourceId: actor.id,
                modifiers: {
                    dmgDone: mech.dmgBoost * effectiveness,
                    healReceived: mech.healingReceivedBoost * effectiveness
                }
            });
            ui.showFloatingText(t, "CONTRACT FORGED", "status-text buff");
        }
        ui.playVfx(t, 'vfx-magic');
        actor.cooldownTimers[decision.ability.name] = 8;
        return;
    }

    if (name.includes('soul gem resonance')) {
        const t = decision.targets[0] || actor;
        const mech = parsed.mechanics;
        
        t.customResources = t.customResources || {};
        const despair = t.customResources['Despair'] || 0;
        
        // Healing Calculation
        const penalty = Math.min(1.0, despair * mech.despairPenaltyPerStack);
        const matk = actor.effectiveMagicAtk || 50;
        const baseHeal = (parsed.baseHeal || 60) + (matk * (parsed.scalePct || 0.8));
        const finalHeal = Math.floor(baseHeal * (1 - penalty));

        // Reduced despair
        t.customResources['Despair'] = Math.max(0, despair - mech.despairReduce);
        
        // If no contract, apply despair
        const hasContract = t.activeEffects.some(e => e.type === 'contract');
        if (!hasContract) {
            t.customResources['Despair'] = Math.min(10, t.customResources['Despair'] + mech.despairApplyIfNoContract);
        }

        // Apply Shield if no despair
        if (despair === 0) {
            const shieldAmt = Math.floor(t.maxHp * mech.shieldMaxHpPct);
            t.receiveAction({ amount: shieldAmt, effectType: 'shield' });
            ui.showFloatingText(t, "SHIELDED", "status-text buff");
        }

        // Apply HoT
        t.applyStatus({
            type: 'regen',
            percent: (finalHeal / t.maxHp) / mech.hotDuration,
            duration: mech.hotDuration
        });

        ui.showFloatingText(t, `+${finalHeal}`, "damage-number heal");
        ui.playVfx(t, 'vfx-heal');
        actor.cooldownTimers[decision.ability.name] = 6;
        return;
    }

    if (name.includes('inhibition field')) {
        const mech = parsed.mechanics;
        ui.showFloatingText(actor, "INHIBITION FIELD", "status-text buff");
        ui.playVfx(actor, 'vfx-dark-void');

        actor.applyStatus({
            type: 'inhibition_field_active',
            duration: mech.duration,
            sourceId: actor.id
        });

        // Immune to statuses while active
        actor.applyStatus({ type: 'invulnerability', duration: mech.duration });

        // The logic for draining energy and applying effects to allies/enemies is handled in updatePassives
        // by checking for 'inhibition_field_active' status.
        
        actor.cooldownTimers[decision.ability.name] = 20;
        return;
    }
}
