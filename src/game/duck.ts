/** flying: voando · escaping: fugindo pelo topo · falling: abatido, caindo · gone: fora de cena. */
export type DuckState = 'flying' | 'escaping' | 'falling' | 'gone';

const RADIUS = 34;
const TOP_MARGIN = 70;
/** Velocidade máxima de curva: o pato gira aos poucos até a nova direção, sem viradas bruscas. */
const TURN_RATE_RAD_PER_S = Math.PI * 0.75; // 135°/s
const ESCAPE_SPEED_FACTOR = 1.4;
const HIT_FREEZE_MS = 220;      // o pato "trava" no ar antes de cair, como no Duck Hunt
const GRAVITY = 1600;           // px/s²

/**
 * Um pato estilo Duck Hunt: nasce na linha da grama e voa quicando nas bordas. De tempos
 * em tempos (turnIntervalMs) escolhe uma nova direção e faz uma CURVA suave até ela, para
 * a mira conseguir acompanhar. Depois de `escapeMs` foge pelo topo.
 */
export class Duck {
  static readonly RADIUS = RADIUS;

  x: number;
  y: number;
  state: DuckState = 'flying';
  /** true se saiu pelo topo sem ser abatido. */
  escaped = false;

  private vx = 0;
  private vy = 0;
  /** Direção atual e desejada, em radianos com y para cima (0 = direita, π/2 = cima). */
  private heading = 0;
  private desiredHeading = 0;
  private age = 0;
  private nextTurn: number;
  private hitAge = 0;
  private wing = Math.random() * Math.PI * 2;

  constructor(
    readonly id: string,
    /** Índice 0–9 do pato dentro da rodada (para o placar de baixo). */
    readonly slot: number,
    screenW: number,
    groundY: number,
    private readonly speed: number,
    /** Intervalo [mín, máx] entre mudanças de direção; maior = voo mais previsível. */
    private readonly turnIntervalMs: readonly [number, number],
    /** Blindado: tiro normal ricocheteia; só o super derruba. */
    readonly armored = false,
  ) {
    this.x = screenW * (0.15 + Math.random() * 0.7);
    this.y = groundY - RADIUS;
    this.heading = Math.PI * (0.25 + Math.random() * 0.5); // sempre para cima ao nascer
    this.desiredHeading = this.heading;
    this.applyHeading();
    this.nextTurn = randomBetween(...turnIntervalMs);
  }

  /** Pode ser mirado e atingido. */
  isTargetable(): boolean {
    return this.state === 'flying' || this.state === 'escaping';
  }

  /** Direção visual: +1 voando para a direita, −1 para a esquerda. */
  get facing(): number {
    return this.vx >= 0 ? 1 : -1;
  }

  get wingPhase(): number {
    return this.wing;
  }

  hit(): void {
    if (!this.isTargetable()) return;
    this.state = 'falling';
    this.hitAge = 0;
    this.vx = 0;
    this.vy = 0;
  }

  update(dtMs: number, screenW: number, groundY: number, escapeMs: number): void {
    const dt = dtMs / 1000;
    this.age += dtMs;
    this.wing += dt * (this.state === 'falling' ? 0 : 18);

    switch (this.state) {
      case 'flying': {
        this.nextTurn -= dtMs;
        if (this.nextTurn <= 0) {
          // Nova direção desejada, com viés para cima para o pato não ficar colado na grama.
          this.desiredHeading = Math.PI * (0.1 + Math.random() * 0.8) * (Math.random() < 0.75 ? 1 : -1);
          this.nextTurn = randomBetween(...this.turnIntervalMs);
        }
        // Curva suave: gira no máximo TURN_RATE por segundo, pelo lado mais curto.
        const diff = wrapAngle(this.desiredHeading - this.heading);
        const maxTurn = TURN_RATE_RAD_PER_S * dt;
        this.heading = wrapAngle(this.heading + Math.max(-maxTurn, Math.min(maxTurn, diff)));
        this.applyHeading();

        this.x += this.vx * dt;
        this.y += this.vy * dt;
        // Quique nas bordas: espelha a direção atual e a desejada (senão a curva o levaria de volta à parede).
        // Só espelha se a direção aponta PARA a parede, para não oscilar na borda durante uma curva.
        const hitLeft = this.x < RADIUS && Math.cos(this.heading) < 0;
        const hitRight = this.x > screenW - RADIUS && Math.cos(this.heading) > 0;
        if (hitLeft || hitRight) {
          this.heading = wrapAngle(Math.PI - this.heading);
          this.desiredHeading = wrapAngle(Math.PI - this.desiredHeading);
        }
        const hitTop = this.y < TOP_MARGIN && Math.sin(this.heading) > 0;
        const hitGround = this.y > groundY - RADIUS && Math.sin(this.heading) < 0;
        if (hitTop || hitGround) {
          this.heading = wrapAngle(-this.heading);
          this.desiredHeading = wrapAngle(-this.desiredHeading);
        }
        this.x = Math.max(RADIUS, Math.min(screenW - RADIUS, this.x));
        this.y = Math.max(TOP_MARGIN, Math.min(groundY - RADIUS, this.y));
        this.applyHeading();
        if (this.age >= escapeMs) {
          this.state = 'escaping';
          this.vx = 0;
          this.vy = -this.speed * ESCAPE_SPEED_FACTOR;
        }
        break;
      }
      case 'escaping':
        this.y += this.vy * dt;
        if (this.y < -RADIUS * 2) {
          this.state = 'gone';
          this.escaped = true;
        }
        break;
      case 'falling':
        this.hitAge += dtMs;
        if (this.hitAge > HIT_FREEZE_MS) {
          this.vy += GRAVITY * dt;
          this.y += this.vy * dt;
        }
        if (this.y > groundY + RADIUS) this.state = 'gone';
        break;
      case 'gone':
        break;
    }
  }

  /** true se o tiro abatido já passou do "travamento" e está caindo (para desenhar de cabeça para baixo). */
  get tumbling(): boolean {
    return this.state === 'falling' && this.hitAge > HIT_FREEZE_MS;
  }

  private applyHeading(): void {
    // Ângulo medido com y para cima: 0 = direita, π/2 = cima. Na tela, y cresce para baixo.
    this.vx = Math.cos(this.heading) * this.speed;
    this.vy = -Math.sin(this.heading) * this.speed;
  }
}

/** Normaliza um ângulo para (−π, π]. */
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
