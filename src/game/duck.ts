/** flying: voando · escaping: fugindo pelo topo · falling: abatido, caindo · gone: fora de cena. */
export type DuckState = 'flying' | 'escaping' | 'falling' | 'gone';

const RADIUS = 34;
const TOP_MARGIN = 70;
const TURN_MIN_MS = 900;
const TURN_MAX_MS = 1600;
const ESCAPE_SPEED_FACTOR = 1.4;
const HIT_FREEZE_MS = 220;      // o pato "trava" no ar antes de cair, como no Duck Hunt
const GRAVITY = 1600;           // px/s²

/**
 * Um pato estilo Duck Hunt: nasce na linha da grama, voa em linha reta quicando nas
 * bordas e muda de direção de tempos em tempos. Depois de `escapeMs` foge pelo topo.
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
  ) {
    this.x = screenW * (0.15 + Math.random() * 0.7);
    this.y = groundY - RADIUS;
    this.setHeading(Math.PI * (0.2 + Math.random() * 0.6)); // sempre para cima ao nascer
    this.nextTurn = randomBetween(TURN_MIN_MS, TURN_MAX_MS);
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
          // Nova direção, com viés para cima para o pato não ficar colado na grama.
          this.setHeading(Math.PI * (0.05 + Math.random() * 0.9) * (Math.random() < 0.8 ? 1 : -1));
          this.nextTurn = randomBetween(TURN_MIN_MS, TURN_MAX_MS);
        }
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (this.x < RADIUS) { this.x = RADIUS; this.vx = Math.abs(this.vx); }
        if (this.x > screenW - RADIUS) { this.x = screenW - RADIUS; this.vx = -Math.abs(this.vx); }
        if (this.y < TOP_MARGIN) { this.y = TOP_MARGIN; this.vy = Math.abs(this.vy); }
        if (this.y > groundY - RADIUS) { this.y = groundY - RADIUS; this.vy = -Math.abs(this.vy); }
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

  private setHeading(angle: number): void {
    // Ângulo medido com y para cima: 0 = direita, π/2 = cima. Na tela, y cresce para baixo.
    this.vx = Math.cos(angle) * this.speed;
    this.vy = -Math.sin(angle) * this.speed;
  }
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
