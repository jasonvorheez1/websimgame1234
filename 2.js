/*
  Custom ability module for character export_id "2" (Tao)
  Exports:
    - decideAction(actor, enemies, allies, battle) => decision object
    - getParsedAbility(ability, actor, battle) => optional parsed overrides
    - executeAction(battle, actor, decision, parsed) => performs ability effects
*/

import { pickRandom } from './src/utils.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Helper: ensure Blade Heart stacks stored on actor.customResources['Blade Heart']
function getBladeHeart(actor) {
    return Math.floor(actor.getResource ? actor.getResource('Blade Heart') : (actor.customResources?.['Blade Heart'] || 0));
}
function addBladeHeart(actor, amt) {
    actor.addResource ? actor.addResource('Blade Heart', amt, 999) : (actor.customResources['Blade Heart'] = (actor.customResources['Blade Heart']||0)+amt);
}
function consumeBladeHeart(actor, amt) {
    const cur = getBladeHeart(actor);
    const used = Math.min(cur, amt);
    if (actor.consumeResource) actor.consumeResource('Blade Heart', used);
    else actor.customResources['Blade Heart'] = Math.max(0, cur - used);
    return used;
}

// Provide parsing overrides to help BattleSystem detect mechanics & vfx
export async function getParsedAbility(ability, actor, battle) {
    const name = (ability && ability.name || '').toLowerCase();
    if (name.includes('swords out')) {
        return {
            baseDmg: 125,
            multiHitCount: 3,
            scalePct: 1.0,
            scaleStat: 'atk',
            element: 'physical',
            targeting: 'single',
            visualKeyword: 'slash_heavy',
            mechanics: { isBurst: false, isTeleport: false },
            cooldown: 8,
            isShield: false
        };
    }
    if (name.includes('fatal bloom')) {
        return {
            baseDmg: 142,
            scalePct: 0.8,
            scaleStat: 'magicAtk',
            element: 'magic',
            targeting: 'single',
            visualKeyword: 'magic',
            mechanics: { isHeal: false },
            cooldown: 6,
            statuses: [{ type: 'vulnerability_stack', stacks: 1, value: 0.03, duration: 5 }]
        };
    }
    if (name.includes('blade heart tempest')) {
        return {
            baseDmg: 0,
            element: 'magic',
            typeCategory: 'ultimate',
            visualKeyword: 'explosion',
            mechanics: { isUltimate: true },
            cooldown: 120
        };
    }
    // default no override
    return null;
}

// Simple decision override: prefer Ultimate if energy full; prefer Swords Out when Blade Heart stacks present; otherwise Fatal Bloom to mark
export async function decideAction(actor, enemies, allies, battle) {
    // Find abilities by name
    const get = (q) => (actor.data.abilities||[]).find(a => a.name && a.name.toLowerCase().includes(q));
    const swords = get('swords out') || null;
    const fatal = get('fatal bloom') || null;
    const ult = get('blade heart tempest') || null;
    const basic = (actor.data.abilities||[]).find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };

    // If ultimate ready and there is at least one enemy, use it
    if (actor.energy >= actor.maxEnergy && ult) {
        return { ability: ult, type: 'ultimate', targets: enemies.filter(e => !e.isDead) };
    }

    // If Swords Out off cooldown and there are enemies, prefer it if you have ammo or Blade Heart stacks
    const bh = getBladeHeart(actor);
    if (swords && !actor.cooldownTimers?.[swords.name]) {
        // Use swords when multiple enemies or high stacks
        if (enemies.filter(e => !e.isDead).length >= 2 || bh >= 5) {
            return { ability: swords, type: 'skill', targets: enemies.filter(e => !e.isDead) };
        }
    }

    // Otherwise, try to apply Fatal Bloom to mark priority targets (lowest hp or highest threat)
    if (fatal && !actor.cooldownTimers?.[fatal.name]) {
        const tgt = enemies.filter(e => !e.isDead).sort((a,b) => (a.currentHp/a.maxHp) - (b.currentHp/b.maxHp))[0];
        if (tgt) return { ability: fatal, type: 'skill', targets: [tgt] };
    }

    // fallback to basic
    return { ability: basic, type: 'basic', targets: [enemies.find(e => !e.isDead)] };
}

// ExecuteAction: lightweight deterministic implementation following the described kit
export async function executeAction(battle, actor, decision, parsed) {
    if (!decision || !decision.ability) return;
    const ability = decision.ability;
    const name = (ability.name||'').toLowerCase();
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const friends = actor.team === 'ally' ? battle.allies : battle.enemies;

    // helper to play VFX + floating text
    const ui = battle.uiManager;
    const targets = (decision.targets && decision.targets.length) ? decision.targets : enemies.filter(e=>!e.isDead);
    // small windup depends on type
    await new Promise(r => setTimeout(r, (ability.type && ability.type.toLowerCase()==='ultimate') ? 300 : 180));

    if (name.includes('swords out')) {
        // Calculate ammo consumption: actor.customResources['Ammo'] or default 100
        const ammo = Math.max(1, Math.floor(actor.getResource ? actor.getResource('Ammo') : (actor.customResources?.Ammo||100)));
        // consume 10% of current ammo unless modified by level (BattleSystem parsed may adjust)
        let consumePct = 0.10;
        // dynamic: if actor has 'Blade Heart Tempest' active reduce cost when ultimate active - but keep simple here
        const consumeAmt = Math.max(1, Math.floor(ammo * consumePct));
        // reduce Ammo resource if available
        if (actor.consumeResource) actor.consumeResource('Ammo', consumeAmt);
        else actor.customResources.Ammo = Math.max(0, (actor.customResources.Ammo||100) - consumeAmt);

        // number of swords: base 3
        let swordCount = 3;
        // scale by Blade Heart stacks (each stack increases damage by 5% up to 50 stacks)
        const bh = getBladeHeart(actor);
        const perStackBonus = 0.05;
        const stackBonus = clamp(bh, 0, 50) * perStackBonus;

        // If no enemies in range, grant a shield instead
        if (!targets || targets.length === 0) {
            const shieldAmount = Math.floor((actor.maxHp || actor.maxHp) * 0.10);
            actor.receiveAction({ amount: shieldAmount, effectType: 'shield' });
            ui.showFloatingText(actor, `SHIELD ${shieldAmount}`, 'status-text buff');
            ui.playVfx(actor, 'shield');
            // shield decays: we simply apply a status that BattleCharacter update will not damage but UI shows it
            addBladeHeart(actor, Math.floor(shieldAmount / Math.max(1, (actor.maxHp||100))*10)); // convert some absorption into stacks (approx)
            return;
        }

        // For each sword, pick nearest target and hit 3 times rapidly
        for (let s = 0; s < swordCount; s++) {
            const t = targets.slice().sort((a,b) => Math.hypot(a.x-actor.x,a.y-actor.y) - Math.hypot(b.x-actor.x,b.y-actor.y))[0];
            if (!t) continue;
            for (let hit = 0; hit < 3; hit++) {
                // small delay between hits
                await new Promise(r => setTimeout(r, 60));
                // compute damage: base + scaled by actor.effectiveAtk
                const atk = actor.effectiveAtk || (actor.stats && actor.stats.atk) || 50;
                let dmg = Math.floor(125 + atk * 1.0 * (1 + stackBonus));
                // fatal bloom bonus if target has vulnerability_stack
                const vuln = t.activeEffects.find(e => e.type === 'vulnerability_stack' || e.type === 'Lingering Wound');
                if (vuln) dmg = Math.floor(dmg * 1.2);
                // fire through battleSystem default flow using receiveAction
                const res = t.receiveAction({ amount: dmg, type: 'physical', isCrit: false, element: 'physical', attackerAccuracy: 20 });
                ui.showFloatingText(t, res.amount, 'damage-number');
                ui.playVfx(t, 'slash_heavy');
                ui.triggerHitAnim(t);
            }
        }

        // Cooldown handling: handled by BattleSystem based on parsed cooldown; grant Blade Heart stacks from ammo consumed
        // Give Blade Heart stacks proportional to ammo consumed (every 5% ammo = 1 stack)
        const stacksFromConsume = Math.max(0, Math.floor((consumeAmt / Math.max(1, ammo)) * 20)); // 20 * pct -> stacks
        if (stacksFromConsume > 0) addBladeHeart(actor, stacksFromConsume);

        return;
    }

    if (name.includes('fatal bloom')) {
        const target = targets && targets[0];
        if (!target) return;
        // base damage + magic atk scaling
        const matk = actor.effectiveMagicAtk || (actor.stats && actor.stats.magicAtk) || 50;
        let dmg = Math.floor(142 + matk * 0.8);
        const res = target.receiveAction({ amount: dmg, type: 'magic', isCrit: false, element: 'magic', attackerAccuracy: 18 });
        ui.showFloatingText(target, res.amount, 'damage-number');
        ui.playVfx(target, 'magic');

        // apply Lingering Wound: represented as vulnerability_stack effect with max 5
        const existing = target.activeEffects.find(e => e.type === 'vulnerability_stack');
        if (existing) {
            existing.stacks = Math.min(5, (existing.stacks || 1) + 1);
            existing.duration = 5;
        } else {
            target.applyStatus({ type: 'vulnerability_stack', stacks: 1, value: 0.03, duration: 5 });
        }

        // consume Blade Heart stacks (cost 5 stacks) and grant movement speed buff to Tao
        const consumed = consumeBladeHeart(actor, 5);
        if (consumed > 0) actor.applyStatus({ type: 'buff_speed', value: 0.10, duration: 3 });

        // apply heal to Tao for triggering on unmarked target: we approximate by giving 5% max HP (kit states on unmarked)
        const hadMark = !!existing;
        if (!hadMark) {
            const healAmt = Math.floor((actor.maxHp || 1000) * 0.05);
            actor.receiveAction({ amount: healAmt, effectType: 'heal' });
            ui.showFloatingText(actor, `+${healAmt}`, 'damage-number heal');
        }

        return;
    }

    if (name.includes('blade heart tempest')) {
        // consume all Blade Heart and grant shield + temporary bonuses, then schedule final explosion on end
        const stacks = getBladeHeart(actor);
        if (stacks <= 0) {
            // minimal behavior: grant short buff
            actor.applyStatus({ type: 'buff_atk', value: 0.20, duration: 10 });
            actor.applyStatus({ type: 'buff_speed', value: 0.15, duration: 10 });
            ui.showFloatingText(actor, 'TEMP VIGOR', 'status-text buff');
            return;
        }
        const consumed = consumeBladeHeart(actor, stacks);
        // shield = 2% max HP per stack
        const shieldAmt = Math.floor((actor.maxHp || 1000) * 0.02 * consumed);
        actor.receiveAction({ amount: shieldAmt, effectType: 'shield' });
        actor.applyStatus({ type: 'buff_atk', value: 0.20, duration: 10 });
        actor.applyStatus({ type: 'buff_magicAtk', value: 0.20, duration: 10 });
        ui.showFloatingText(actor, `SHIELD ${shieldAmt}`, 'status-text buff');
        ui.playVfx(actor, 'holy_light');

        // schedule final surge after duration (10s real-time -> scale by battle.battleSpeed)
        const delayMs = Math.max(800, 10000 / (battle.battleSpeed || 1));
        setTimeout(() => {
            // final surge damage to all enemies within large radius
            const dmg = 6499 + Math.floor((actor.effectiveMagicAtk || 0) * Math.max(1, consumed * 0.02));
            enemies.filter(e => !e.isDead).forEach(e => {
                const res = e.receiveAction({ amount: dmg, type: 'magic', isCrit: false, element: 'magic', attackerAccuracy: 10 });
                battle.uiManager.showFloatingText(e, res.amount, 'damage-number crit');
                battle.uiManager.playVfx(e, 'explosion');
                battle.uiManager.triggerHitAnim(e);
            });
        }, delayMs);

        return;
    }

    // Fallback basic: simple physical hit to nearest target
    {
        const t = targets && targets[0];
        if (!t) return;
        const atk = actor.effectiveAtk || (actor.stats && actor.stats.atk) || 50;
        const dmg = Math.floor(30 + atk * 0.6);
        const res = t.receiveAction({ amount: dmg, type: 'physical', isCrit: false, element: 'physical', attackerAccuracy: 22 });
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, 'slash');
    }
}