import type { EnvironmentId } from '../game/environments';
import type { GameStats, RoundSpec } from '../game/duckGame';

export type RegionId = 'lago' | 'floresta' | 'pantano';

export interface RegionDef {
  id: RegionId;
  name: string;
  environment: EnvironmentId;
  /** Região anterior e estrelas necessárias nela para desbloquear esta. */
  unlock?: { region: RegionId; stars: number };
}

export type ObjectiveDef =
  | { kind: 'hits'; value: number }
  | { kind: 'accuracy'; value: number }
  | { kind: 'noEscape' }
  | { kind: 'noSuper' }
  | { kind: 'armoredKills'; value: number }
  | { kind: 'shyKills'; value: number }
  | { kind: 'ghostKills'; value: number }
  | { kind: 'boss' };

export interface MissionDef {
  id: string;
  region: RegionId;
  /** Posição na região (0–3). */
  index: number;
  name: string;
  round: RoundSpec;
  /** [principal, bônus, bônus] — cada um vale uma estrela. */
  objectives: readonly [ObjectiveDef, ObjectiveDef, ObjectiveDef];
  tutorial?: boolean;
}

export const REGIONS: readonly RegionDef[] = [
  { id: 'lago', name: 'Lago do Vovô', environment: 'lake' },
  { id: 'floresta', name: 'Floresta Noturna', environment: 'forest', unlock: { region: 'lago', stars: 6 } },
  { id: 'pantano', name: 'Pântano da Neblina', environment: 'swamp', unlock: { region: 'floresta', stars: 6 } },
];

export const MISSIONS: readonly MissionDef[] = [
  // ---------- Lago do Vovô: treinamento ----------
  {
    id: 'lago-1', region: 'lago', index: 0, name: 'Primeiro Voo', tutorial: true,
    round: { ducks: 6, speed: 0.8, escape: 1.25, turn: [2600, 3600], armored: 0, shy: 0, ghost: 0 },
    objectives: [{ kind: 'hits', value: 3 }, { kind: 'accuracy', value: 0.5 }, { kind: 'noEscape' }],
  },
  {
    id: 'lago-2', region: 'lago', index: 1, name: 'Revoada',
    round: { ducks: 8, speed: 1.0, escape: 1.0, turn: [2400, 3400], armored: 0, shy: 0, ghost: 0 },
    objectives: [{ kind: 'hits', value: 5 }, { kind: 'accuracy', value: 0.6 }, { kind: 'noSuper' }],
  },
  {
    id: 'lago-3', region: 'lago', index: 2, name: 'Pressão no Lago',
    round: { ducks: 10, speed: 1.2, escape: 0.95, turn: [2000, 3000], armored: 0, shy: 0, ghost: 0 },
    objectives: [{ kind: 'hits', value: 6 }, { kind: 'noEscape' }, { kind: 'accuracy', value: 0.7 }],
  },
  {
    id: 'lago-4', region: 'lago', index: 3, name: 'Blindagem',
    round: { ducks: 10, speed: 1.25, escape: 0.95, turn: [2000, 3000], armored: 2, shy: 0, ghost: 0 },
    objectives: [{ kind: 'hits', value: 6 }, { kind: 'armoredKills', value: 2 }, { kind: 'accuracy', value: 0.6 }],
  },
  // ---------- Floresta Noturna: a mira é a lanterna ----------
  {
    id: 'floresta-1', region: 'floresta', index: 0, name: 'Olhos na Escuridão',
    round: { ducks: 8, speed: 1.0, escape: 1.1, turn: [2400, 3400], armored: 0, shy: 0, ghost: 0 },
    objectives: [{ kind: 'hits', value: 5 }, { kind: 'accuracy', value: 0.6 }, { kind: 'noSuper' }],
  },
  {
    id: 'floresta-2', region: 'floresta', index: 1, name: 'Sombras Rápidas',
    round: { ducks: 10, speed: 1.3, escape: 1.0, turn: [1900, 2800], armored: 0, shy: 0, ghost: 0 },
    objectives: [{ kind: 'hits', value: 6 }, { kind: 'noEscape' }, { kind: 'accuracy', value: 0.65 }],
  },
  {
    id: 'floresta-3', region: 'floresta', index: 2, name: 'Os Tímidos',
    round: { ducks: 10, speed: 1.2, escape: 1.0, turn: [2000, 3000], armored: 0, shy: 4, ghost: 0 },
    objectives: [{ kind: 'hits', value: 6 }, { kind: 'shyKills', value: 3 }, { kind: 'accuracy', value: 0.6 }],
  },
  {
    id: 'floresta-4', region: 'floresta', index: 3, name: 'Emboscada Noturna',
    round: { ducks: 12, speed: 1.45, escape: 0.95, turn: [1500, 2400], armored: 2, shy: 3, ghost: 0 },
    objectives: [{ kind: 'hits', value: 8 }, { kind: 'armoredKills', value: 2 }, { kind: 'noEscape' }],
  },
  // ---------- Pântano da Neblina: o olhar abre a neblina; fantasmas somem ----------
  {
    id: 'pantano-1', region: 'pantano', index: 0, name: 'Névoa Espessa',
    round: { ducks: 8, speed: 1.1, escape: 1.1, turn: [2200, 3200], armored: 0, shy: 0, ghost: 0 },
    objectives: [{ kind: 'hits', value: 5 }, { kind: 'accuracy', value: 0.6 }, { kind: 'noSuper' }],
  },
  {
    id: 'pantano-2', region: 'pantano', index: 1, name: 'Fantasmas do Brejo',
    round: { ducks: 10, speed: 1.2, escape: 1.05, turn: [2000, 3000], armored: 0, shy: 0, ghost: 4 },
    objectives: [{ kind: 'hits', value: 6 }, { kind: 'ghostKills', value: 3 }, { kind: 'accuracy', value: 0.65 }],
  },
  {
    id: 'pantano-3', region: 'pantano', index: 2, name: 'Armadura na Lama',
    round: { ducks: 12, speed: 1.35, escape: 1.0, turn: [1700, 2600], armored: 2, shy: 0, ghost: 3 },
    objectives: [{ kind: 'hits', value: 8 }, { kind: 'armoredKills', value: 2 }, { kind: 'noEscape' }],
  },
  {
    id: 'pantano-4', region: 'pantano', index: 3, name: 'Chefe: General Grasnado',
    round: { ducks: 6, speed: 1.2, escape: 1.1, turn: [2000, 3000], armored: 1, shy: 0, ghost: 0, boss: { hp: 6, timeLimitMs: 150000 } },
    objectives: [{ kind: 'boss' }, { kind: 'noSuper' }, { kind: 'accuracy', value: 0.5 }],
  },
];

export function missionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

export function regionById(id: RegionId): RegionDef {
  return REGIONS.find((r) => r.id === id)!;
}

export function missionsOf(region: RegionId): MissionDef[] {
  return MISSIONS.filter((m) => m.region === region).sort((a, b) => a.index - b.index);
}

export function objectiveLabel(o: ObjectiveDef): string {
  switch (o.kind) {
    case 'hits': return `Derrube ${o.value} patos`;
    case 'accuracy': return `Precisão de ${Math.round(o.value * 100)}% ou mais`;
    case 'noEscape': return 'Nenhum pato pode fugir';
    case 'noSuper': return 'Vença sem usar o super';
    case 'armoredKills': return `Derrube ${o.value} patos blindados`;
    case 'shyKills': return `Derrube ${o.value} patos tímidos`;
    case 'ghostKills': return `Derrube ${o.value} patos fantasmas`;
    case 'boss': return 'Derrote o General Grasnado';
  }
}

/** Precisão = cartuchos que derrubaram algo / cartuchos disparados (0 se não atirou). */
export function accuracyOf(stats: GameStats): number {
  return stats.shots > 0 ? stats.shotsHit / stats.shots : 0;
}

/**
 * Objetivo cumprido? Os bônus só contam se o principal (hits) também foi cumprido — senão dava
 * para ganhar "nenhum pato fugiu" sem jogar direito.
 */
export function objectiveMet(o: ObjectiveDef, stats: GameStats): boolean {
  switch (o.kind) {
    case 'hits': return stats.hits >= o.value;
    case 'accuracy': return accuracyOf(stats) >= o.value;
    case 'noEscape': return stats.escaped === 0;
    case 'noSuper': return stats.supers === 0;
    case 'armoredKills': return stats.armoredKills >= o.value;
    case 'shyKills': return stats.shyKills >= o.value;
    case 'ghostKills': return stats.ghostKills >= o.value;
    case 'boss': return stats.bossDefeated;
  }
}

export function evaluateMission(mission: MissionDef, stats: GameStats): boolean[] {
  const main = objectiveMet(mission.objectives[0], stats);
  return mission.objectives.map((o, i) => (i === 0 ? main : main && objectiveMet(o, stats)));
}
