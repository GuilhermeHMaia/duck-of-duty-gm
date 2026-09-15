import type { DebugConfig } from '../types';

/**
 * Ajustes do menu Configurações: cada um tem 5 níveis com nomes simples, e cada nível define
 * um ou mais campos técnicos do DebugConfig. O nível do meio (2) é o padrão do jogo, exceto
 * quando o padrão está numa ponta (Peso dos olhos começa no máximo).
 *
 * O painel de debug (tecla D) continua mexendo nos mesmos campos com precisão; aqui o nível
 * mostrado é o mais próximo do valor atual.
 */
export interface FriendlySetting {
  id: string;
  label: string;
  hint: string;
  levelNames: readonly [string, string, string, string, string];
  levels: readonly [Partial<DebugConfig>, Partial<DebugConfig>, Partial<DebugConfig>, Partial<DebugConfig>, Partial<DebugConfig>];
}

const INTENSITY = ['Muito baixa', 'Baixa', 'Normal', 'Alta', 'Muito alta'] as const;

export const FRIENDLY_SETTINGS: readonly FriendlySetting[] = [
  {
    id: 'head',
    label: 'Sensibilidade da cabeça',
    hint: 'Quanto a mira anda quando você vira ou inclina a cabeça',
    levelNames: INTENSITY,
    levels: [{ headGain: 25 }, { headGain: 35 }, { headGain: 45 }, { headGain: 60 }, { headGain: 80 }],
  },
  {
    id: 'eyes',
    label: 'Peso dos olhos',
    hint: 'Quanto o olhar move a mira. Mais baixo: mira mais firme, guiada pela cabeça',
    levelNames: ['Desligado', 'Baixo', 'Médio', 'Alto', 'Máximo'],
    levels: [{ eyeMaxOffset: 0 }, { eyeMaxOffset: 250 }, { eyeMaxOffset: 500 }, { eyeMaxOffset: 800 }, { eyeMaxOffset: 1200 }],
  },
  {
    id: 'stability',
    label: 'Estabilidade da mira',
    hint: 'Mais estável treme menos, mas segue os movimentos um pouco mais devagar',
    levelNames: ['Muito rápida', 'Rápida', 'Normal', 'Estável', 'Muito estável'],
    levels: [
      { eyeMinCutoff: 1.2, headMinCutoff: 3 },
      { eyeMinCutoff: 0.8, headMinCutoff: 2.2 },
      { eyeMinCutoff: 0.5, headMinCutoff: 1.5 },
      { eyeMinCutoff: 0.3, headMinCutoff: 1.0 },
      { eyeMinCutoff: 0.15, headMinCutoff: 0.6 },
    ],
  },
  {
    id: 'blink',
    label: 'Sensibilidade do piscar',
    hint: 'Se o tiro não sai ao fechar os olhos, aumente. Se atira sozinho, diminua',
    levelNames: INTENSITY,
    levels: [
      { blinkRise: 0.55, doubleBlinkThreshold: 0.9 },
      { blinkRise: 0.45, doubleBlinkThreshold: 0.85 },
      { blinkRise: 0.35, doubleBlinkThreshold: 0.8 },
      { blinkRise: 0.27, doubleBlinkThreshold: 0.72 },
      { blinkRise: 0.2, doubleBlinkThreshold: 0.65 },
    ],
  },
  {
    id: 'wink',
    label: 'Sensibilidade do wink',
    hint: 'Fechar um olho só: esquerdo recarrega, direito troca de arma',
    levelNames: INTENSITY,
    levels: [{ winkThreshold: 0.7 }, { winkThreshold: 0.6 }, { winkThreshold: 0.5 }, { winkThreshold: 0.4 }, { winkThreshold: 0.3 }],
  },
  {
    id: 'magnet',
    label: 'Ímã da mira',
    hint: 'Quanto a mira gruda nos patos quando chega perto deles',
    levelNames: ['Fraco', 'Leve', 'Normal', 'Forte', 'Muito forte'],
    levels: [{ snapRadius: 60 }, { snapRadius: 85 }, { snapRadius: 110 }, { snapRadius: 140 }, { snapRadius: 170 }],
  },
];

export const LEVEL_COUNT = 5;

/** Nível (0–4) mais próximo dos valores atuais do config. */
export function levelOf(config: DebugConfig, setting: FriendlySetting): number {
  const keys = Object.keys(setting.levels[0]) as (keyof DebugConfig)[];
  let best = 0;
  let bestDist = Infinity;
  setting.levels.forEach((level, i) => {
    let dist = 0;
    for (const k of keys) {
      const values = setting.levels.map((l) => l[k]!);
      const spread = Math.max(...values) - Math.min(...values) || 1;
      dist += Math.abs(config[k] - level[k]!) / spread;
    }
    if (dist < bestDist - 1e-9) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}

/** O config está exatamente num nível, ou foi ajustado fino no painel de debug? */
export function isExactLevel(config: DebugConfig, setting: FriendlySetting): boolean {
  const level = setting.levels[levelOf(config, setting)];
  return (Object.keys(level) as (keyof DebugConfig)[]).every((k) => Math.abs(config[k] - level[k]!) < 1e-9);
}

/** Aplica o nível (limitado a 0–4) no config e devolve o nível aplicado. */
export function applyLevel(config: DebugConfig, setting: FriendlySetting, level: number): number {
  const clamped = Math.max(0, Math.min(LEVEL_COUNT - 1, Math.round(level)));
  Object.assign(config, setting.levels[clamped]);
  return clamped;
}
