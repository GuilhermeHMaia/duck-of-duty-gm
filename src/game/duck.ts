/** flying: voando · escaping: fugindo pelo topo · falling: abatido, caindo · gone: fora de cena. */
export type DuckState = 'flying' | 'escaping' | 'falling' | 'gone';

const RADIUS = 34;
const TOP_MARGIN = 70;
/** Velocidade máxima de curva: o pato gira aos poucos até a nova direção, sem viradas bruscas. */
const TURN_RATE_RAD_PER_S = Math.PI * 0.75; // 135°/s
const ESCAPE_SPEED_FACTOR = 1.4;
const HIT_FREEZE_MS = 220;      // o pato "trava" no ar antes de cair, como no Duck Hunt
const GRAVITY = 1600;           // px/s²
/** Pato Tímido: depois deste tempo na luz, foge dela por SHY_FLEE_MS, mais rápido. */
const SHY_TRIGGER_MS = 1000;
const SHY_FLEE_MS = 1500;
const SHY_FLEE_BOOST = 1.8;
/** Pato Fantasma (Pântano): ciclo visível → some → invisível → aparece. */
const GHOST_VISIBLE_MS = 2500;
const GHOST_FADE_MS = 400;
const GHOST_HIDDEN_MS = 1200;
/** O pato grasna este tempo antes de fugir, avisando o jogador. */
const QUACK_WARNING_MS = 900;

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
  private lightMs = 0;
  private fleeMs = 0;
  private boost = 1;
  private ghostPhase = Math.random() * (GHOST_VISIBLE_MS + GHOST_HIDDEN_MS + 2 * GHOST_FADE_MS);
  private quackPending = false;
  private quacked = false;

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
    /** Tímido: foge da luz (Floresta Noturna). */
    readonly shy = false,
    /** Fantasma: some e reaparece de tempos em tempos (Pântano). */
    readonly ghost = false,
  ) {
    this.x = screenW * (0.15 + Math.random() * 0.7);
    this.y = groundY - RADIUS;
    this.heading = Math.PI * (0.25 + Math.random() * 0.5); // sempre para cima ao nascer
    this.desiredHeading = this.heading;
    this.applyHeading();
    this.nextTurn = randomBetween(...turnIntervalMs);
  }

  /** Pode ser mirado e atingido (fantasma só enquanto está visível). */
  isTargetable(): boolean {
    return (this.state === 'flying' || this.state === 'escaping') && this.opacity > 0.5;
  }

  /** Opacidade para desenhar: 1 normal; o fantasma some e reaparece em ciclo. */
  get opacity(): number {
    if (!this.ghost || this.state === 'falling') return 1;
    const cycle = GHOST_VISIBLE_MS + GHOST_HIDDEN_MS + 2 * GHOST_FADE_MS;
    const p = this.ghostPhase % cycle;
    if (p < GHOST_VISIBLE_MS) return 1;
    if (p < GHOST_VISIBLE_MS + GHOST_FADE_MS) return 1 - (p - GHOST_VISIBLE_MS) / GHOST_FADE_MS;
    if (p < GHOST_VISIBLE_MS + GHOST_FADE_MS + GHOST_HIDDEN_MS) return 0;
    return (p - GHOST_VISIBLE_MS - GHOST_FADE_MS - GHOST_HIDDEN_MS) / GHOST_FADE_MS;
  }

  /** true uma única vez, quando o pato grasna avisando que vai fugir. */
  consumeQuack(): boolean {
    if (!this.quackPending) return false;
    this.quackPending = false;
    return true;
  }

  /** Está no intervalo de aviso antes de fugir (para desenhar o balão "QUACK!"). */
  get warning(): boolean {
    return this.quacked && this.state === 'flying';
  }

  /** Direção visual: +1 voando para a direita, −1 para a esquerda. */
  get facing(): number {
    return this.vx >= 0 ? 1 : -1;
  }

  get wingPhase(): number {
    return this.wing;
  }

  /** Pato Tímido: acumula tempo na luz e, passado SHY_TRIGGER_MS, dispara para longe dela. */
  updateLight(dtMs: number, lit: boolean, light: { x: number; y: number } | null): void {
    if (!this.shy || this.state !== 'flying') return;
    if (this.fleeMs > 0) {
      this.fleeMs -= dtMs;
      if (this.fleeMs <= 0) this.boost = 1;
      return;
    }
    if (!lit || !light) {
      this.lightMs = Math.max(0, this.lightMs - dtMs);
      return;
    }
    this.lightMs += dtMs;
    if (this.lightMs < SHY_TRIGGER_MS) return;
    // Direção para longe da luz (ângulo com y para cima).
    const away = Math.atan2(-(this.y - light.y), this.x - light.x);
    this.heading = away;
    this.desiredHeading = away;
    this.boost = SHY_FLEE_BOOST;
    this.fleeMs = SHY_FLEE_MS;
    this.lightMs = 0;
    this.applyHeading();
  }

  get fleeing(): boolean {
    return this.fleeMs > 0;
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
    this.ghostPhase += dtMs;
    this.wing += dt * (this.state === 'falling' ? 0 : 18);
    if (!this.quacked && this.state === 'flying' && this.age >= escapeMs - QUACK_WARNING_MS) {
      this.quacked = true;
      this.quackPending = true;
    }

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
    this.vx = Math.cos(this.heading) * this.speed * this.boost;
    this.vy = -Math.sin(this.heading) * this.speed * this.boost;
  }
}

/** Normaliza um ângulo para (−π, π]. */
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
