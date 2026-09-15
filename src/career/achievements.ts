import type { GameSetup, GameStats } from '../game/duckGame';
import type { CareerStore } from './careerStore';
import { missionById, missionsOf } from './missions';

export interface AchievementContext {
  stats: GameStats;
  setup: GameSetup;
  /** Objetivos cumpridos nesta partida (só em missões). */
  achieved?: boolean[];
  career: CareerStore;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  check(ctx: AchievementContext): boolean;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'primeiro-sangue', name: 'Primeiro Grasnado', description: 'Derrube seu primeiro pato', check: ({ career }) => career.state.totals.ducks >= 1 },
  { id: 'mira-certeira', name: 'Mira Certeira', description: 'Faça um combo de 10 tiros certeiros', check: ({ stats }) => stats.maxCombo >= 10 },
  { id: 'rajada-tripla', name: 'Rajada Tripla', description: 'Derrube 3 patos com uma única Rajada', check: ({ stats }) => stats.maxSuperKills >= 3 },
  { id: 'abridor-de-latas', name: 'Abridor de Latas', description: 'Derrube 10 patos blindados no total', check: ({ career }) => career.state.totals.armored >= 10 },
  { id: 'caca-fantasmas', name: 'Caça-Fantasmas', description: 'Derrube 10 patos fantasmas no total', check: ({ career }) => career.state.totals.ghosts >= 10 },
  {
    id: 'luz-nos-olhos', name: 'Luz nos Olhos', description: 'Complete todas as missões da Floresta Noturna',
    check: ({ career }) => missionsOf('floresta').every((m) => career.starsOf(m.id) >= 1),
  },
  {
    id: 'no-escuro-sem-super', name: 'No Escuro, Sem Super', description: 'Vença uma missão da Floresta sem usar o super',
    check: ({ setup, stats, achieved }) =>
      setup.mode === 'mission' && missionById(setup.missionId ?? '')?.region === 'floresta' && !!achieved?.[0] && stats.supers === 0,
  },
  { id: 'olho-no-olho', name: 'Olho no Olho', description: 'Derrote o General Grasnado', check: ({ stats }) => stats.bossDefeated },
  { id: 'arsenal-completo', name: 'Arsenal Completo', description: 'Tenha todas as armas', check: ({ career }) => career.state.owned.length >= 3 },
  { id: 'constelacao', name: 'Constelação', description: 'Junte 30 estrelas na carreira', check: ({ career }) => career.totalStars() >= 30 },
  { id: 'diario-de-bordo', name: 'Diário de Bordo', description: 'Complete um Desafio Diário', check: ({ setup }) => setup.mode === 'daily' },
];
