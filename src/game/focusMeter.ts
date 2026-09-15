/** Perder o snap por menos que isso não esvazia nem troca o alvo do foco. */
const GRACE_MS = 300;

/**
 * Medidor de foco (0–1): a "carga" do tiro.
 *
 * - Enche a `fillPerSec` enquanto a mira está grudada (snap) num pato.
 * - Trocar de pato recomeça do zero: o foco é no pato, não na mira.
 * - Escapadas curtas (< GRACE_MS) congelam o foco em vez de esvaziá-lo.
 * - Fora dos patos por mais tempo, esvazia a `decayPerSec`.
 * - Cada tiro consome todo o foco, acertando ou não.
 * O tiro só derruba o pato se o foco no momento do disparo for ≥ focusToShoot.
 */
export class FocusMeter {
  value = 0;
  private targetId: string | null = null;
  private unsnappedMs = 0;

  update(dtMs: number, snappedDuckId: string | null, fillPerSec: number, decayPerSec: number): void {
    const dt = dtMs / 1000;
    if (snappedDuckId !== null) {
      if (snappedDuckId !== this.targetId) {
        this.targetId = snappedDuckId;
        this.value = 0;
      }
      this.unsnappedMs = 0;
      this.value = Math.min(1, this.value + fillPerSec * dt);
      return;
    }
    this.unsnappedMs += dtMs;
    if (this.unsnappedMs < GRACE_MS) return; // escapada curta: segura o foco e o alvo
    this.targetId = null;
    this.value = Math.max(0, this.value - decayPerSec * dt);
  }

  consume(): void {
    this.value = 0;
  }

  reset(): void {
    this.value = 0;
    this.targetId = null;
    this.unsnappedMs = 0;
  }
}
