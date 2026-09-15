/**
 * General Grasnado, chefe do Pântano.
 *
 * Voa devagar pela parte de cima da tela protegido por um escudo. O escudo só abre quando o
 * jogador ENCARA O OLHO dele por STARE_MS sem piscar (a mira livre perto do olho, olhos abertos).
 * Aberto, fica OPEN_MS vulnerável: tiros com foco tiram vida. Com o escudo fechado, tiro e super
 * não fazem nada. Piscar no meio da encarada zera a contagem.
 */
export const BOSS_ID = 'boss';
const RADIUS = 72;
export const STARE_MS = 2000;
const OPEN_MS = 3000;
/** Distância máxima da mira até o olho para contar como encarar (tolerante: a mira do olho não é precisa). */
export const STARE_RADIUS = 120;
const HIT_FLASH_MS = 250;
const GRAVITY = 900;

export type BossState = 'fighting' | 'falling' | 'gone';

export class Boss {
  static readonly RADIUS = RADIUS;
  readonly id = BOSS_ID;
  x: number;
  y: number;
  hp: number;
  state: BossState = 'fighting';
  private t = 0;
  private prevX: number;
  private openMs = 0;
  private stareMs = 0;
  private hitFlashMs = 0;
  private fallVy = 0;

  constructor(
    screenW: number,
    private readonly groundY: number,
    readonly maxHp: number,
  ) {
    this.hp = maxHp;
    this.x = screenW / 2;
    this.prevX = this.x;
    this.y = groundY * 0.32;
  }

  get shielded(): boolean {
    return this.openMs <= 0;
  }

  /** 0–1: progresso da encarada que abre o escudo. */
  get stareProgress(): number {
    return this.stareMs / STARE_MS;
  }

  get openProgress(): number {
    return this.openMs / OPEN_MS;
  }

  get flashing(): boolean {
    return this.hitFlashMs > 0;
  }

  get facing(): number {
    return this.x >= this.prevX ? 1 : -1;
  }

  /** Posição do olho, o ponto que precisa ser encarado. */
  get eye(): { x: number; y: number } {
    return { x: this.x + this.facing * RADIUS * 0.95, y: this.y - RADIUS * 0.55 };
  }

  isTargetable(): boolean {
    return this.state === 'fighting';
  }

  /**
   * O ponto (x, y) está encarando o olho? Aceita o olho dos dois lados da cabeça: quando o General
   * vira no fim da tela o olho troca de lado, e isso não deve zerar a encarada de quem olha certo.
   */
  isStaringAt(x: number, y: number): boolean {
    const ey = this.y - RADIUS * 0.55;
    const dRight = Math.hypot(x - (this.x + RADIUS * 0.95), y - ey);
    const dLeft = Math.hypot(x - (this.x - RADIUS * 0.95), y - ey);
    return Math.min(dRight, dLeft) <= STARE_RADIUS;
  }

  update(dtMs: number, screenW: number): void {
    this.hitFlashMs = Math.max(0, this.hitFlashMs - dtMs);
    if (this.state === 'falling') {
      this.fallVy += GRAVITY * (dtMs / 1000);
      this.y += this.fallVy * (dtMs / 1000);
      if (this.y > this.groundY + RADIUS) this.state = 'gone';
      return;
    }
    if (this.state !== 'fighting') return;
    this.t += dtMs / 1000;
    this.prevX = this.x;
    this.x = screenW / 2 + Math.sin(this.t * 0.35) * screenW * 0.3;
    this.y = this.groundY * 0.32 + Math.sin(this.t * 0.8) * 40;
    this.openMs = Math.max(0, this.openMs - dtMs);
  }

  /**
   * Atualiza a encarada. `looking`: mira perto do olho E olhos abertos. Devolve true no momento
   * em que o escudo abre.
   */
  stare(dtMs: number, looking: boolean): boolean {
    if (this.state !== 'fighting' || !this.shielded) {
      this.stareMs = 0;
      return false;
    }
    this.stareMs = looking ? this.stareMs + dtMs : 0;
    if (this.stareMs < STARE_MS) return false;
    this.stareMs = 0;
    this.openMs = OPEN_MS;
    return true;
  }

  /** Aplica dano (só com o escudo aberto). Devolve true se derrotou o chefe. */
  hit(damage: number): boolean {
    if (this.state !== 'fighting' || this.shielded) return false;
    this.hp = Math.max(0, this.hp - damage);
    this.hitFlashMs = HIT_FLASH_MS;
    if (this.hp > 0) return false;
    this.state = 'falling';
    this.openMs = 0;
    return true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.state === 'gone') return;
    const r = RADIUS;
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.state === 'falling') ctx.rotate(Math.PI * 0.8);
    ctx.scale(this.facing, 1);
    // corpo
    ctx.fillStyle = this.flashing ? '#fef3c7' : '#4d3a1f';
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    // asa
    ctx.fillStyle = '#3a2b16';
    ctx.beginPath();
    ctx.ellipse(-r * 0.15, -r * 0.1, r * 0.55, r * 0.28, -Math.sin(this.t * 9) * 0.6, 0, Math.PI * 2);
    ctx.fill();
    // medalhas
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i === 1 ? '#facc15' : '#dc2626';
      ctx.beginPath();
      ctx.arc(r * 0.15 + i * r * 0.18, r * 0.15, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
    // cabeça, quepe, olho e bico
    ctx.fillStyle = '#14532d';
    ctx.beginPath();
    ctx.arc(r * 0.85, -r * 0.45, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(r * 0.45, -r * 0.95, r * 0.8, r * 0.22);
    ctx.fillRect(r * 0.95, -r * 0.78, r * 0.45, r * 0.08);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(r * 0.75, -r * 0.9, r * 0.14, r * 0.12);
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(r * 0.95, -r * 0.55, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b91c1c';
    ctx.beginPath();
    ctx.arc(r * 0.97, -r * 0.55, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(r * 1.18, -r * 0.5);
    ctx.lineTo(r * 1.7, -r * 0.36);
    ctx.lineTo(r * 1.18, -r * 0.24);
    ctx.fill();
    ctx.restore();

    if (this.state !== 'fighting') return;
    // escudo
    if (this.shielded) {
      ctx.save();
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.85)';
      ctx.fillStyle = 'rgba(125, 211, 252, 0.12)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r * 1.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // anel de encarada em volta do olho
      const eye = this.eye;
      ctx.save();
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(eye.x, eye.y, 22, 0, Math.PI * 2);
      ctx.stroke();
      if (this.stareProgress > 0) {
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(eye.x, eye.y, 22, -Math.PI / 2, -Math.PI / 2 + this.stareProgress * Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
