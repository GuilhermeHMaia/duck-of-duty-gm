/** Guarda se o jogador já passou pela primeira vez guiada (boas-vindas → posição → Estande → tutorial). */
const ONBOARDING_KEY = 'duck-of-duty.onboarding.v1';

export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'done';
  } catch {
    return false;
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, 'done');
  } catch {
    // sem localStorage: a primeira vez guiada volta a aparecer na próxima sessão
  }
}
