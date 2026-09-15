import type { GameSetup, GameStats } from '../game/duckGame';
import {
  applyUpgrades,
  UPGRADE_MAX_LEVEL,
  UPGRADE_PRICES,
  weaponById,
  type UpgradeKind,
  type WeaponDef,
  type WeaponId,
  type WeaponUpgrades,
} from '../game/weapons';
import { ACHIEVEMENTS, type AchievementDef } from './achievements';
import { DAILY_REWARD } from './daily';
import { missionsOf, REGIONS, type MissionDef, type RegionDef, type RegionId } from './missions';

const STORAGE_KEY = 'duck-of-duty.career.v1';
export const PENAS_PER_DUCK = 10;
export const PENAS_PER_NEW_STAR = 25;

export interface CareerState {
  /** Por missão: quais dos 3 objetivos (estrelas) já foram conquistados alguma vez. */
  objectives: Record<string, boolean[]>;
  penas: number;
  owned: WeaponId[];
  equipped: WeaponId;
  upgrades: Partial<Record<WeaponId, WeaponUpgrades>>;
  /** Conquistas desbloqueadas (ids). */
  achievements: string[];
  /** Acumulados de todas as partidas (para conquistas). */
  totals: { ducks: number; armored: number; ghosts: number };
  /** Desafio Diário: melhor pontuação do dia e se a recompensa já foi paga. */
  daily: { date: string; best: number; rewarded: boolean };
}

export interface MissionReward {
  newStars: number;
  penas: number;
  /** Regiões que este resultado acabou de desbloquear. */
  unlockedRegions: RegionDef[];
}

/** Progresso da carreira, salvo no localStorage. */
export class CareerStore {
  state: CareerState = defaultState();

  load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<CareerState>;
      const base = defaultState();
      this.state = {
        objectives: saved.objectives ?? base.objectives,
        penas: typeof saved.penas === 'number' ? saved.penas : 0,
        owned: Array.isArray(saved.owned) && saved.owned.length ? saved.owned : base.owned,
        equipped: saved.equipped ?? base.equipped,
        upgrades: saved.upgrades ?? base.upgrades,
        achievements: saved.achievements ?? base.achievements,
        totals: { ...base.totals, ...saved.totals },
        daily: saved.daily ?? base.daily,
      };
    } catch (err) {
      console.warn('[carreira] não foi possível ler o progresso salvo', err);
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (err) {
      console.warn('[carreira] não foi possível salvar o progresso', err);
    }
  }

  // ---------- Estrelas e regiões ----------

  starsOf(missionId: string): number {
    return (this.state.objectives[missionId] ?? []).filter(Boolean).length;
  }

  objectivesOf(missionId: string): boolean[] {
    return this.state.objectives[missionId] ?? [false, false, false];
  }

  regionStars(region: RegionId): number {
    return missionsOf(region).reduce((sum, m) => sum + this.starsOf(m.id), 0);
  }

  totalStars(): number {
    return REGIONS.reduce((sum, r) => sum + this.regionStars(r.id), 0);
  }

  isRegionUnlocked(region: RegionDef): boolean {
    return !region.unlock || this.regionStars(region.unlock.region) >= region.unlock.stars;
  }

  /** Dentro da região, as missões abrem em sequência (a anterior precisa de pelo menos 1 estrela). */
  isMissionUnlocked(mission: MissionDef): boolean {
    const region = REGIONS.find((r) => r.id === mission.region)!;
    if (!this.isRegionUnlocked(region)) return false;
    if (mission.index === 0) return true;
    const previous = missionsOf(mission.region)[mission.index - 1];
    return this.starsOf(previous.id) >= 1;
  }

  /** Registra o resultado: só estrelas novas rendem penas de estrela; patos sempre rendem. */
  recordResult(mission: MissionDef, achieved: boolean[], ducksKilled: number): MissionReward {
    const lockedBefore = REGIONS.filter((r) => !this.isRegionUnlocked(r));
    const previous = this.objectivesOf(mission.id);
    const merged = previous.map((had, i) => had || !!achieved[i]);
    const newStars = merged.filter(Boolean).length - previous.filter(Boolean).length;
    const penas = ducksKilled * PENAS_PER_DUCK + newStars * PENAS_PER_NEW_STAR;
    this.state.objectives[mission.id] = merged;
    this.state.penas += penas;
    this.save();
    return { newStars, penas, unlockedRegions: lockedBefore.filter((r) => this.isRegionUnlocked(r)) };
  }

  // ---------- Desafio Diário ----------

  /** Registra a pontuação do dia; devolve as penas ganhas (recompensa só na primeira vez no dia). */
  recordDaily(date: string, score: number, ducksKilled: number): { penas: number; best: number; newBest: boolean } {
    if (this.state.daily.date !== date) this.state.daily = { date, best: 0, rewarded: false };
    const newBest = score > this.state.daily.best;
    if (newBest) this.state.daily.best = score;
    let penas = ducksKilled * PENAS_PER_DUCK;
    if (!this.state.daily.rewarded) {
      penas += DAILY_REWARD;
      this.state.daily.rewarded = true;
    }
    this.state.penas += penas;
    this.save();
    return { penas, best: this.state.daily.best, newBest };
  }

  dailyBest(date: string): number {
    return this.state.daily.date === date ? this.state.daily.best : 0;
  }

  // ---------- Conquistas ----------

  /**
   * Soma os acumulados da partida e desbloqueia conquistas. Devolve as recém-desbloqueadas.
   * Chamar DEPOIS de recordResult/recordDaily, para as conquistas enxergarem as estrelas novas.
   */
  recordGame(stats: GameStats, setup: GameSetup, achieved?: boolean[]): AchievementDef[] {
    this.state.totals.ducks += stats.hits;
    this.state.totals.armored += stats.armoredKills;
    this.state.totals.ghosts += stats.ghostKills;
    const unlocked = ACHIEVEMENTS.filter(
      (a) => !this.state.achievements.includes(a.id) && a.check({ stats, setup, achieved, career: this }),
    );
    this.state.achievements.push(...unlocked.map((a) => a.id));
    this.save();
    return unlocked;
  }

  // ---------- Armas e melhorias ----------

  owns(id: WeaponId): boolean {
    return this.state.owned.includes(id);
  }

  buy(id: WeaponId): boolean {
    const weapon = weaponById(id);
    if (this.owns(id) || this.state.penas < weapon.price) return false;
    this.state.penas -= weapon.price;
    this.state.owned.push(id);
    this.state.equipped = id;
    this.save();
    return true;
  }

  equip(id: WeaponId): void {
    if (!this.owns(id)) return;
    this.state.equipped = id;
    this.save();
  }

  upgradeLevel(id: WeaponId, kind: UpgradeKind): number {
    return this.state.upgrades[id]?.[kind] ?? 0;
  }

  /** Preço do próximo nível, ou null se já está no máximo. */
  upgradePrice(id: WeaponId, kind: UpgradeKind): number | null {
    const level = this.upgradeLevel(id, kind);
    return level >= UPGRADE_MAX_LEVEL ? null : UPGRADE_PRICES[level];
  }

  buyUpgrade(id: WeaponId, kind: UpgradeKind): boolean {
    const price = this.upgradePrice(id, kind);
    if (!this.owns(id) || price === null || this.state.penas < price) return false;
    this.state.penas -= price;
    const current = this.state.upgrades[id] ?? { ammo: 0, focus: 0 };
    this.state.upgrades[id] = { ...current, [kind]: current[kind] + 1 };
    this.save();
    return true;
  }

  /** Armas compradas, com melhorias aplicadas e a equipada primeiro (é a que começa na mão). */
  loadout(): WeaponDef[] {
    const owned = this.state.owned.map((id) => applyUpgrades(weaponById(id), this.state.upgrades[id]));
    return [...owned.filter((w) => w.id === this.state.equipped), ...owned.filter((w) => w.id !== this.state.equipped)];
  }
}

function defaultState(): CareerState {
  return {
    objectives: {},
    penas: 0,
    owned: ['espingarda'],
    equipped: 'espingarda',
    upgrades: {},
    achievements: [],
    totals: { ducks: 0, armored: 0, ghosts: 0 },
    daily: { date: '', best: 0, rewarded: false },
  };
}
