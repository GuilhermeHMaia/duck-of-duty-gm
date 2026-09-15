import type { RoundSpec } from '../game/duckGame';
import type { EnvironmentId } from '../game/environments';

/** Penas pela primeira conclusão do desafio no dia. */
export const DAILY_REWARD = 50;

export interface DailyChallenge {
  /** Data no formato AAAA-MM-DD (hora local). */
  date: string;
  environment: EnvironmentId;
  environmentName: string;
  round: RoundSpec;
}

const ENVIRONMENTS: { id: EnvironmentId; name: string }[] = [
  { id: 'lake', name: 'Lago do Vovô' },
  { id: 'forest', name: 'Floresta Noturna' },
  { id: 'swamp', name: 'Pântano da Neblina' },
];

export function todayKey(date = new Date()): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * Desafio do dia, sorteado de forma determinística pela data: todo mundo que jogar no mesmo dia
 * pega o mesmo lugar e o mesmo tipo de pato (o voo de cada pato continua aleatório).
 */
export function dailyChallenge(dateKey = todayKey()): DailyChallenge {
  const rand = mulberry32(hashString(dateKey));
  const env = ENVIRONMENTS[Math.floor(rand() * ENVIRONMENTS.length)];
  const ducks = 12;
  const round: RoundSpec = {
    ducks,
    speed: 1.1 + rand() * 0.5,
    escape: 0.9 + rand() * 0.2,
    turn: [1600 + Math.round(rand() * 600), 2600 + Math.round(rand() * 600)],
    armored: Math.floor(rand() * 3),
    shy: env.id === 'forest' ? Math.floor(rand() * 4) : 0,
    ghost: env.id === 'swamp' ? Math.floor(rand() * 4) : 0,
  };
  return { date: dateKey, environment: env.id, environmentName: env.name, round };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Gerador pseudoaleatório pequeno e determinístico (mesma semente → mesma sequência). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
