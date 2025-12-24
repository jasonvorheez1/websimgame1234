/**
 * aang.js
 * Character: Aang (The Last Airbender)
 * Ability Track (1 -> 200)
 */

class Aang {
    constructor(level = 1) {
        this.name = "Aang";
        this.level = level;
        
        // Base Stats (Scaling with level)
        this.stats = {
            maxHp: 500 + (level * 15),
            currentHp: 500 + (level * 15),
            atk: 20 + (level * 2),
            airbending: 10 + (level * 1.5),
            luck: 5 + (level * 0.1),
            evasion: 0.05, // 5% base
            moveSpeed: 100
        };

        this.stance = "Neutral";
        this.resilienceCooldown = 0;
        
        // Apply Signature Passive: Nomad's Light Footwork (Lv 70+)
        if (this.level >= 70) {
            this.stats.evasion += 0.05;
            if (this.level >= 125) this.stats.evasion += 0.025;
        }
    }

    // --- ACTIVE ABILITIES ---

    /** Basic Attack: Fire Melee Strike */
    basicAttack(target) {
        let dmg = this.stats.atk * 0.8; 
        if (this.level >= 10) dmg *= 1.1;
        if (this.level >= 100) dmg += 20;

        console.log(`${this.name} performs a Fire Basic Attack! Deals ${Math.floor(dmg)} damage.`);
        return Math.floor(dmg);
    }

    /** Active: Airbending Jab */
    airbendingJab() {
        let dmg = (this.stats.atk * 0.5) + (this.stats.airbending * 0.5);
        let staggerChance = this.level >= 10 ? 0.25 : 0.15;
        let hits = this.level >= 100 ? 2 : 1;

        console.log(`${this.name} uses Airbending Jab! (${hits} hits)`);
        if (Math.random() < staggerChance) console.log("Target STAGGERED!");
        
        return Math.floor(dmg * hits);
    }

    /** Active: Airbending Swiftness */
    useSwiftness() {
        let duration = this.level >= 125 ? 7 : 5;
        let speedBuff = this.level >= 25 ? 0.40 : 0.30;
        let dashDmg = 50 + (0.3 * this.stats.atk);

        console.log(`${this.name} summons an Air Scooter! Speed +${speedBuff * 100}% for ${duration}s.`);
        
        if (this.level >= 175) {
            let shield = this.stats.maxHp * 0.10;
            console.log(`Air Scooter Shield active: ${Math.floor(shield)} HP`);
        }
        
        return Math.floor(dashDmg);
    }

    /** Skill: Elemental Shift */
    shiftStance(newElement) {
        this.stance = newElement;
        let duration = this.level >= 30 ? 10 : 8;
        
        const buffs = {
            "Air":   (this.level >= 80 ? "15% Evasion" : "10% Evasion"),
            "Water": (this.level >= 80 ? "4% HP Regen/sec" : "3% HP Regen/sec"),
            "Earth": (this.level >= 80 ? "20% Defense" : "15% Defense"),
            "Fire":  (this.level >= 80 ? "20% ATK" : "15% ATK")
        };

        console.log(`Stance Shift: ${newElement} Stance active for ${duration}s. Buff: ${buffs[newElement]}`);
        
        if (this.level >= 180) {
            console.log("Speed Burst triggered from Stance Switch!");
        }
    }

    // --- PASSIVE LOGIC ---

    /** Passive: Avatar's Resilience (Check every update/hit) */
    updateResilience() {
        // Natural Regen
        let regenPct = this.level >= 40 ? 0.03 : 0.02;
        this.stats.currentHp = Math.min(this.stats.maxHp, this.stats.currentHp + (this.stats.maxHp * regenPct / 5));

        // Emergency Burst Heal
        if (this.resilienceCooldown === 0 && this.stats.currentHp < (this.stats.maxHp * 0.30)) {
            let heal = this.stats.maxHp * 0.15;
            let dr = this.level >= 90 ? 0.30 : 0.20;
            let cd = this.level >= 140 ? 45 : 60;

            this.stats.currentHp += heal;
            this.resilienceCooldown = cd;

            console.log(`!!! SPIRIT WATER INFUSION !!! Healed ${Math.floor(heal)} HP. DR: ${dr * 100}%`);
            if (this.level >= 190) console.log("Nearby allies healed by 5% Max HP!");
        }
    }

    /** Ultimate: Tornado Strike */
    useUltimate() {
        if (this.level < 112) return console.log("Ultimate not yet unlocked.");
        
        let dmg = (this.stats.atk *