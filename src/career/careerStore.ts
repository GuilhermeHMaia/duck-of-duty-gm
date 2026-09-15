import { weaponById, type WeaponId } from '../game/weapons';
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
      this.state = {
        objectives: saved.objectives ?? {},
        penas: typeof saved.penas === 'number' ? saved.penas : 0,
        owned: Array.isArray(saved.owned) && saved.owned.length ? saved.owned : ['espingarda'],
        equipped: saved.equipped ?? 'espingarda',
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
}

function defaultState(): CareerState {
  return { objectives: {}, penas: 0, owned: ['espingarda'], equipped: 'espingarda' };
}
