import type { DebugConfig } from '../types';

/** Onde os ajustes (painel de debug e menu Configurações) ficam salvos entre recargas. */
const CONFIG_STORAGE_KEY = 'duck-of-duty.config.v1';

export const DEFAULT_CONFIG: Readonly<DebugConfig> = {
  winkThreshold: 0.5,
  winkMinFrames: 2,
  doubleBlinkThreshold: 0.8,
  blinkRise: 0.35,
  minCutoff: 1.0,
  beta: 0.007,
  dCutoff: 1.0,
  preBlinkBufferMs: 180,
  snapRadius: 110,
  snapHysteresis: 60,
  headGain: 45,
  headDeadzone: 0,
  eyeMaxOffset: 1200,
  ridgeLambda: 1,
  eyeMinCutoff: 0.5,
  eyeBeta: 0.005,
  headMinCutoff: 1.5,
  headBeta: 0.02,
  duckSpeed: 130,
  duckEscapeMs: 9000,
  focusFillPerSec: 1.25,
  focusDecayPerSec: 0.3,
  focusToShoot: 0.6,
};

/** Aplica no config os valores salvos (só chaves conhecidas e numéricas; ignora campos antigos). */
export function loadSavedConfig(config: DebugConfig): void {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_CONFIG) as (keyof DebugConfig)[]) {
      const v = saved[key];
      if (typeof v === 'number' && Number.isFinite(v)) config[key] = v;
    }
  } catch (err) {
    console.warn('[config] não foi possível ler a configuração salva', err);
  }
}

export function saveConfig(config: DebugConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('[config] não foi possível salvar a configuração', err);
  }
}

/** Volta o config aos padrões e apaga o que estava salvo. */
export function restoreDefaultConfig(config: DebugConfig): void {
  Object.assign(config, DEFAULT_CONFIG);
  try {
    localStorage.removeItem(CONFIG_STORAGE_KEY);
  } catch {
    // sem localStorage: os padrões valem só nesta sessão
  }
}
