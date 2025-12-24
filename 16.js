/**
 * 16.js — Vivian (ATLYSS) ability module
 *
 * Exports:
 *  - getParsedAbility(charName, abilityName, description, skillLevel, tags)
 *  - decideAction(actor, enemies, allies, battle)
 *  - executeAction(battle, actor, decision, parsed)
 *  - updatePassives(actor, dt)
 *
 * Implements:
 *  - Basic Attack (melee earth)
 *  - Quick Enchant: Fortuitous Strike (buff ally: next basic deals extra magic dmg; applies Fortuitous Strike stacks to enemy)
 *  - Weapon Scaling: Agility Shift (buff ally depending on weapon scaling)
 *  - Passive Stone Resonance (stacks when allies damage enemies under Fortuitous Strike)
 *  - Stone Infusion: Overload Enchant (ultimate; consumes Stone Resonance stacks and applies one of three stone effects)
 *  - Signature Passive Unstable Aegis / Magic Misfire (evade stacks, channel extra magic on 3 stacks and stun; debuff enemy healing)
 */

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function pickRandom(arr){ return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }
function dist(a,b){ return Math.hypot((a.x||0)-(b.x||0),(a.y||0)-(b.y||0)); }

export function getParsedAbility(charName, abilityName, description = "", skillLevel = 1, tags = []) {
    const key = (abilityName||'').toLowerCase();

    if (key.includes('basic')) {
        return {
            typeCategory: 'basic',
            baseDmg: 12,
            scalePct: 0.25,
            scaleStat: 'atk',
            element: 'earth',
            cooldown: 1.0,
            visualKeyword: 'vfx-slash'
        };
    }

    if (key.includes('quick enchant') || key.includes('fortuitous strike')) {
        return {
            typeCategory: 'skill',
            baseDmg: 0,
            scalePct: 0.5, // additional damage = 50% MA baseline; upgrades modify externally
            scaleStat: 'magicAtk',
            element: 'magic',
            cooldown: 8,
            mechanics: {
                buffDuration: 5,
                basePct: 0.5,
                enhancedPctIfWeaponEnchanted: 0.75,
                stackOnEnemyDuration: 3,
                fortuitousStackPctIncreasePerStack: 0.05,
                maxStacks: 5,
                subsequentCastReductionWindow: 10,
                subsequentReductionPct: 0.25,
                minPct: 0.25
            },
            visualKeyword: 'vfx-magic'
        };
    }

    if (key.includes('weapon scaling') || key.includes('agility shift')) {
        return {
            typeCategory: 'skill',
            baseDmg: 0,
            cooldown: 15,
            mechanics: {
                duration: 6,
                dexterityAtkSpeedPct: 0.20,
                strengthAtkDefPct: 0.15,
                mindMatkMdefPct: 0.25,
                perAllyCooldown: 15
            },
            visualKeyword: 'vfx-buff'
        };
    }

    if (key.includes("stone resonance") || key.includes("mystic's intuition")) {
        return {
            typeCategory: 'passive',
            description: "Stone Resonance: gain stacks when an ally damages an enemy affected by Fortuitous Strike; stacks increase Stone Infusion potency.",
            mechanics: {
                perStackPct: 0.03,
                maxStacks: 10,
                decayDelay: 5, // seconds before decay begins
                decayPerSec: 1 // stacks per second after delay
            }
        };
    }

    if (key.includes('stone infusion') || key.includes('overload enchant')) {
        return {
            typeCategory: 'ultimate',
            baseDmg: 0,
            cooldown: 60,
            mechanics: {
                duration: 8,
                // Stone behaviors defined in executeAction: Might, Flux, Agility
                shieldOnMaxStacksPct: 0.10
            },
            visualKeyword: 'vfx-explosion'
        };
    }

    if (key.includes('magic misfire') || key.includes('unstable aegis')) {
        return {
            typeCategory: 'passive',
            description: 'Magic Misfire: evasion chances and accumulation; at 3 stacks next basic deals extra magic dmg and stuns; reduces enemy healing after evasion.',
            mechanics: {
                evadeChanceBasic: 0.30,
                evadeChanceSpell: 0.15,
                stacksPerEvasion: 1,
                triggerStacks: 3,
                extraMagicPct: 1.0, // 100% of ATK as magic damage on trigger
                stunDur: 0.75,
                enemyHealingReductionPct: 0.10,
                enemyHealingReductionDur: 4
            }
        };
    }

    return null;
}

export function updatePassives(actor, dt) {
    actor.customResources = actor.customResources || {};
    actor.resourceDecayTimers = actor.resourceDecayTimers || {};

    // Stone Resonance decay logic
    const decayDelay = 5;
    if (actor.resourceDecayTimers._stone_res_delay == null) actor.resourceDecayTimers._stone_res_delay = decayDelay;
    if (actor.resourceDecayTimers._stone_res_delay > 0) {
        actor.resourceDecayTimers._stone_res_delay -= dt;
    } else {
        // decay stacks per second
        if (actor.customResources['StoneResonance'] > 0) {
            actor.customResources['StoneResonance'] = Math.max(0, actor.customResources['StoneResonance'] - (actor.resourceDecayTimers._stone_res_rate ? actor.resourceDecayTimers._stone_res_rate * dt : 1 * dt));
        }
    }

    // Truncate to integer for stack logic
    if (actor.customResources['StoneResonance']) actor.customResources['StoneResonance'] = Math.floor(actor.customResources['StoneResonance']);

    // Drama misc: decay MagicMisfire small timer (no automatic decay specified)
    // Cap stacks/sanity
    actor.customResources['StoneResonance'] = Math.max(0, Math.min(999, Math.floor(actor.customResources['StoneResonance'] || 0)));
    actor.customResources['MagicMisfire'] = Math.max(0, Math.min(99, Math.floor(actor.customResources['MagicMisfire'] || 0)));
}

export async function decideAction(actor, enemies, allies, battle) {
    const liveEnemies = enemies.filter(e => !e.isDead);
    const liveAllies = allies.filter(a => !a.isDead && a !== actor);
    if (!liveEnemies.length) return { ability: { name: 'Basic Attack' }, targets: [] };

    // Use Stone Infusion (ultimate) if stacks >0 and enemy threats or ally to empower
    const infusion = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('stone infusion'));
    const quick = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('quick enchant'));
    const scaling = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('weapon scaling'));
    const stacks = Math.floor(actor.customResources['StoneResonance'] || 0);

    if (infusion && !actor.cooldownTimers?.[infusion.name] && stacks > 0) {
        // choose the ally with highest pwr (best recipient) or self if none
        const ally = liveAllies.sort((a,b)=> (b.pwr||0)-(a.pwr||0))[0] || actor;
        return { ability: infusion, targets: [ally], type: 'ultimate' };
    }

    // If an ally is low HP, prioritize Quick Enchant to boost their next basic (or buff highest-damage ally)
    if (quick && !actor.cooldownTimers?.[quick.name]) {
        const lowAlly = allies.filter(a=>!a.isDead).sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0] || null;
        if (lowAlly && (lowAlly.currentHp / lowAlly.maxHp) < 0.75) {
            return { ability: quick, targets: [lowAlly], type: 'skill' };
        }
        // else buff highest pwr ally to increase impact
        const high = liveAllies.sort((a,b)=> (b.pwr||0)-(a.pwr||0))[0];
        if (high) return { ability: quick, targets: [high], type: 'skill' };
    }

    // Use Weapon Scaling to buff allies who look "weapon-scaling" (fallback to highest speed/atk)
    if (scaling && !actor.cooldownTimers?.[scaling.name]) {
        const candidate = liveAllies.sort((a,b)=> (b.stats.speed||0)-(a.stats.speed||0))[0];
        if (candidate) return { ability: scaling, targets: [candidate], type: 'skill' };
    }

    // Fallback: basic attack nearest enemy
    const basic = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('basic')) || { name: 'Basic Attack' };
    const nearest = liveEnemies.sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y) - Math.hypot(b.x-actor.x,b.y-actor.y))[0];
    return { ability: basic, targets: [nearest], type: 'basic' };
}

export async function executeAction(battle, actor, decision, parsed) {
    if (!decision || !decision.ability) return;
    const ui = battle.uiManager;
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const allies = actor.team === 'ally' ? battle.allies : battle.enemies;
    const liveEnemies = enemies.filter(e=>!e.isDead);
    if (!liveEnemies.length) return;

    const ability = decision.ability;
    const name = (ability.name||'').toLowerCase();
    const lvl = actor.data.level || actor.level || 1;

    // ensure parsed meta
    parsed = parsed || getParsedAbility(actor.data.name, ability.name, ability.description, (actor.data.skills && actor.data.skills[ability.name]) || 1, ability.tags || []);

    // small windup
    await new Promise(r => setTimeout(r, (decision.type === 'ultimate') ? 320 : 120));

    // BASIC ATTACK
    if (parsed.typeCategory === 'basic' || name.includes('basic attack')) {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 8;
        const base = parsed.baseDmg || 12;
        const dmg = Math.max(1, Math.floor(base + atk * (parsed.scalePct || 0.25)));
        const res = t.receiveAction({ amount: dmg, type: 'physical', element: parsed.element || 'earth', attackerAccuracy: 18 });
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, parsed.visualKeyword || 'vfx-slash');

        // Check Unstable Aegis / MagicMisfire trigger: if MagicMisfire stacks >= trigger and this is Vivian's basic, release extra magic damage + stun
        const mm = actor.customResources['MagicMisfire'] || 0;
        const misfireCfg = getParsedAbility(actor.data.name, 'Unstable Aegis')?.mechanics || {};
        if (mm >= (misfireCfg.triggerStacks || 3)) {
            // extra: 100% of Vivian's ATK as magic damage
            const extra = Math.floor((actor.stats.atk || 0) * (misfireCfg.extraMagicPct || 1.0));
            const extraRes = t.receiveAction({ amount: extra, type: 'magic', element: 'magic', attackerAccuracy: 25 });
            ui.showFloatingText(t, extraRes.amount, 'damage-number');
            // stun
            t.applyStatus({ type: 'stun', duration: misfireCfg.stunDur || 0.75 });
            ui.showFloatingText(t, 'STUNNED', 'status-text');
            ui.playVfx(t, 'vfx-explosion');

            // dissipate stacks
            actor.customResources['MagicMisfire'] = 0;
            // apply enemy healing reduction
            t.applyStatus({ type: 'debuff_heal', duration: misfireCfg.enemyHealingReductionDur || 4, value: misfireCfg.enemyHealingReductionPct || 0.10 });
        }

        // energy gain
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 10);
        return;
    }

    // QUICK ENCHANT: FORTUITOUS STRIKE
    if (name.includes('quick enchant') || name.includes('fortuitous')) {
        const targetAlly = decision.targets && decision.targets[0] ? decision.targets[0] : actor;
        if (!targetAlly) return;
        const mech = parsed.mechanics || {};
        // compute extraPct: base may be reduced if repeated recently on same ally
        const lastCastKey = `_last_quickenchant_${targetAlly.id || 'self'}`;
        const now = Date.now();
        let extraPct = mech.basePct || 0.5;
        if (actor._quickTimestamps && actor._quickTimestamps[lastCastKey]) {
            const diff = (now - actor._quickTimestamps[lastCastKey]) / 1000;
            if (diff <= mech.subsequentCastReductionWindow) {
                extraPct = Math.max(mech.minPct || 0.25, extraPct * (1 - (mech.subsequentReductionPct || 0.25)));
            }
        }
        actor._quickTimestamps = actor._quickTimestamps || {};
        actor._quickTimestamps[lastCastKey] = now;

        // Apply a transient status on ally that marks their next basic to deal extra magic damage
        targetAlly.applyStatus({
            type: 'enchant_next_basic',
            duration: mech.buffDuration || 5,
            value: extraPct,
            sourceId: actor.id,
            // also store for UI/execute: which caster and magnitude
            enchantMeta: { casterId: actor.id, pct: extraPct }
        });
        ui.showFloatingText(targetAlly, `ENCHANTED +${Math.round(extraPct*100)}%MA`, 'status-text buff');
        ui.playVfx(targetAlly, 'vfx-magic');

        // Also apply Fortuitous Strike to a target enemy when the enchanted ally next hits: that logic is implemented in BattleSystem's receive/ability flow by checking statuses; but to ensure it, we attach a listener-like flag by setting a marker on the ally referencing caster.
        // We'll track expected behavior via actor._enchanted map for when allies land hits.
        actor._enchanted = actor._enchanted || {};
        actor._enchanted[targetAlly.id || 'self'] = { expiresAt: now + (mech.buffDuration||5)*1000, pct: extraPct, caster: actor.id };

        // small energy gain
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 12);
        return;
    }

    // WEAPON SCALING: AGILITY SHIFT
    if (name.includes('weapon scaling') || name.includes('agility shift')) {
        const target = decision.targets && decision.targets[0] ? decision.targets[0] : actor;
        if (!target) return;
        const mech = parsed.mechanics || {};
        // Detect weapon scaling via tags on target.data.weaponScaling or fallback heuristics
        const weaponScale = (target.data && target.data.weaponScaling) || ''; // optional metadata
        let applied = null;
        if (weaponScale.toLowerCase().includes('dex') || weaponScale.toLowerCase().includes('dexterity') || (target.stats && (target.stats.speed || 0) > (target.stats.atk || 0))) {
            // Dexterity -> attack speed
            target.applyStatus({ type: 'buff_speed', duration: mech.duration || 6, value: mech.dexterityAtkSpeedPct || 0.20 });
            applied = `SPD +${Math.round((mech.dexterityAtkSpeedPct||0.20)*100)}%`;
        } else if (weaponScale.toLowerCase().includes('str') || weaponScale.toLowerCase().includes('strength') || (target.stats && (target.stats.atk || 0) > (target.stats.magicAtk || 0))) {
            target.applyStatus({ type: 'buff_atk', duration: mech.duration || 6, value: mech.strengthAtkDefPct || 0.15 });
            target.applyStatus({ type: 'buff_def', duration: mech.duration || 6, value: mech.strengthAtkDefPct || 0.15 });
            applied = `ATK/DEF +${Math.round((mech.strengthAtkDefPct||0.15)*100)}%`;
        } else {
            // Mind scaling
            target.applyStatus({ type: 'buff_matk', duration: mech.duration || 6, value: mech.mindMatkMdefPct || 0.25 });
            target.applyStatus({ type: 'buff_mdef', duration: mech.duration || 6, value: mech.mindMatkMdefPct || 0.25 });
            applied = `M.ATK/M.DEF +${Math.round((mech.mindMatkMdefPct||0.25)*100)}%`;
        }

        ui.showFloatingText(target, applied || 'BUFFED', 'status-text buff');
        ui.playVfx(target, 'vfx-buff');
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 10);
        // apply per-ally cooldown enforcement by setting timestamp
        actor._weaponScalingTimestamps = actor._weaponScalingTimestamps || {};
        actor._weaponScalingTimestamps[target.id || 'self'] = Date.now();
        return;
    }

    // STONE INFUSION: OVERLOAD ENCHANT (Ultimate)
    if (name.includes('stone infusion') || name.includes('overload enchant') || decision.type === 'ultimate') {
        const target = decision.targets && decision.targets[0] ? decision.targets[0] : actor;
        if (!target) return;
        const mech = parsed.mechanics || {};
        // consume stacks
        const stacks = Math.floor(actor.customResources['StoneResonance'] || 0);
        actor.customResources['StoneResonance'] = 0;
        actor.resourceDecayTimers._stone_res_delay = mech.decayDelay || 5;

        // Choose stone type: actor.customResources['SelectedStone'] or default Might
        const choice = (actor.customResources && actor.customResources['SelectedStone']) || 'Might';
        // Duration and apply effects
        const duration = mech.duration || 8;
        if (choice.toLowerCase() === 'might') {
            // Might Stone: attack damage + lifesteal
            const atkBuff = 0.30 + (stacks * 0.03); // base 30% + per-stack scaling (matches passive)
            const lifesteal = 0.15 + Math.min(0.35, stacks * 0.01); // scale modestly
            target.applyStatus({ type: 'buff_atk', duration, value: atkBuff });
            target.customResources = target.customResources || {};
            target.customResources['TemporaryLifesteal'] = (target.customResources['TemporaryLifesteal'] || 0) + lifesteal;
            target.resourceDecayTimers['TemporaryLifesteal'] = duration;
            ui.showFloatingText(target, `MIGHT: ATK +${Math.round(atkBuff*100)}% LS ${Math.round(lifesteal*100)}%`, 'status-text buff');
        } else if (choice.toLowerCase() === 'flux') {
            // Flux Stone: magic attack + reduce target's magic resistance (modeled as debuff_matk or magicDef)
            const matkBuff = 0.40 + (stacks * 0.03);
            const reduceRes = 0.20 + Math.min(0.3, stacks * 0.01);
            target.applyStatus({ type: 'buff_matk', duration, value: matkBuff });
            // mark debuff on enemies via aura-like status on target that will be applied when target attacks enemies or on next hit; here we push a global passive marker to battle
            // for simplicity, apply immediate debuff to nearest enemy target
            const enemy = liveEnemies.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
            if (enemy) {
                enemy.applyStatus({ type: 'debuff_matk', duration, value: -reduceRes, modifiers: { magicDef: -reduceRes } });
                ui.showFloatingText(enemy, `M.RES -${Math.round(reduceRes*100)}%`, 'status-text');
            }
            ui.showFloatingText(target, `FLUX: M.ATK +${Math.round(matkBuff*100)}%`, 'status-text buff');
        } else {
            // Agility Stone: attack speed + evasion
            const asBuff = 0.35 + (stacks * 0.02);
            const evasion = 0.20 + Math.min(0.25, stacks * 0.01);
            target.applyStatus({ type: 'buff_speed', duration, value: asBuff });
            target.applyStatus({ type: 'buff_evasion', duration, value: evasion });
            ui.showFloatingText(target, `AGILITY: SPD +${Math.round(asBuff*100)}% EVA +${Math.round(evasion*100)}%`, 'status-text buff');
        }

        // If max stacks reached prior to cast (we'll treat 10 as described), grant shield
        if (stacks >= 10) {
            const shieldAmt = Math.floor((actor.maxHp || actor.stats.maxHp || 1000) * (mech.shieldOnMaxStacksPct || 0.10));
            target.receiveAction({ amount: shieldAmt, effectType: 'shield' });
            ui.showFloatingText(target, `SHIELD ${shieldAmt}`, 'status-text buff');
            ui.playVfx(target, 'shield');
        }

        // set cooldown
        actor.cooldownTimers = actor.cooldownTimers || {};
        actor.cooldownTimers[ability.name] = parsed.cooldown || 60;
        actor.energy = 0;
        ui.playVfx(target, parsed.visualKeyword || 'vfx-explosion');
        return;
    }

    // Signature Passive reactive hook (manual cast rarely used) or fallback
    if (name.includes('magic misfire') || parsed.typeCategory === 'passive') {
        // passive is applied reactively; as active we grant small tenacity or evasion ping
        const mech = parsed.mechanics || {};
        actor.applyStatus({ type: 'buff_tenacity', duration: 6, value: 0.10 });
        ui.showFloatingText(actor, 'Aegis Hardened', 'status-text buff');
        return;
    }

    // Fallback: no-op
}