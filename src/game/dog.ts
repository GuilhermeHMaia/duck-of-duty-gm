/**
 * O cachorro do Estande: sobe da grama no fim de cada rodada. Se você não derrubou nada ele ri;
 * se derrubou, aparece segurando os patos. É só desenho (nenhum arquivo de imagem).
 */
export type DogMood = 'laugh' | 'hold';

const RISE_MS = 450;
const STAY_MS = 1250;
const SINK_MS = 400;
const TOTAL_MS = RISE_MS + STAY_MS + SINK_MS;

export class Dog {
  private startedAt = -Infinity;
  private mood: DogMood = 'laugh';
  /** Quantos patos ele levanta (0–2), quando mood = 'hold'. */
  private ducks = 0;

  /** Aparece com o resultado da rodada. `hits` = patos derrubados nela. */
  show(now: number, hits: number): void {
    this.startedAt = now;
    this.mood = hits > 0 ? 'hold' : 'laugh';
    this.ducks = Math.min(2, hits);
  }

  hide(): void {
    this.startedAt = -Infinity;
  }

  isVisible(now: number): boolean {
    return now - this.startedAt < TOTAL_MS;
  }

  /** 0 escondido, 1 totalmente para fora da grama. */
  private progress(now: number): number {
    const t = now - this.startedAt;
    if (t < 0 || t >= TOTAL_MS) return 0;
    if (t < RISE_MS) return easeOut(t / RISE_MS);
    if (t < RISE_MS + STAY_MS) return 1;
    return 1 - easeIn((t - RISE_MS - STAY_MS) / SINK_MS);
  }

  /** `grassY` é a linha da vegetação da frente: é de lá que ele sobe. */
  draw(ctx: CanvasRenderingContext2D, now: number, screenW: number, grassY: number): void {
    const p = this.progress(now);
    if (p <= 0) return;
    const scale = Math.max(1.15, screenW / 1150);
    const h = 190 * scale;
    const x = screenW * 0.42;
    // Sobe "de dentro" da grama: recorta tudo que estiver abaixo da linha da vegetação.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, screenW, grassY + 8);
    ctx.clip();
    ctx.translate(x, grassY + 8 + h * (1 - p));
    ctx.scale(scale, scale);
    if (this.mood === 'laugh') this.drawLaughing(ctx, now);
    else this.drawHolding(ctx);
    ctx.restore();
  }

  /** Rindo da sua cara: tronco inclinado para trás, boca aberta e "HÁ HÁ HÁ". */
  private drawLaughing(ctx: CanvasRenderingContext2D, now: number): void {
    const shake = Math.sin(now / 90) * 3;
    ctx.save();
    ctx.translate(0, shake);
    body(ctx);
    ctx.save();
    ctx.translate(0, -78);
    ctx.rotate(-0.25);
    head(ctx, true);
    ctx.restore();
    ctx.restore();
    ctx.fillStyle = '#fde68a';
    ctx.font = "700 26px system-ui, 'Segoe UI', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HÁ HÁ HÁ!', 96, -118 + shake);
  }

  /** Orgulhoso, segurando os patos abatidos. */
  private drawHolding(ctx: CanvasRenderingContext2D): void {
    body(ctx);
    ctx.save();
    ctx.translate(0, -78);
    head(ctx, false);
    ctx.restore();
    // Patos pendurados nas patas.
    for (let i = 0; i < Math.max(1, this.ducks); i++) {
      const dx = i === 0 ? -66 : 66;
      ctx.save();
      ctx.translate(dx, -92);
      ctx.rotate(i === 0 ? 0.35 : -0.35);
      ctx.fillStyle = '#6b4f2a';
      ctx.beginPath();
      ctx.ellipse(0, 0, 30, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#166534';
      ctx.beginPath();
      ctx.arc(24, -10, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(33, -8);
      ctx.lineTo(48, -4);
      ctx.lineTo(33, 0);
      ctx.fill();
      // asa caída
      ctx.fillStyle = '#4a3720';
      ctx.beginPath();
      ctx.ellipse(-6, 10, 16, 8, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function body(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#8a5a2b';
  ctx.beginPath();
  ctx.ellipse(0, -20, 56, 46, 0, 0, Math.PI * 2);
  ctx.fill();
  // peito branco
  ctx.fillStyle = '#e7d3b3';
  ctx.beginPath();
  ctx.ellipse(0, -6, 34, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  // patas
  ctx.fillStyle = '#e7d3b3';
  for (const px of [-30, 30]) {
    ctx.beginPath();
    ctx.ellipse(px, -46, 15, 11, px < 0 ? 0.4 : -0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function head(ctx: CanvasRenderingContext2D, laughing: boolean): void {
  // orelhas caídas
  ctx.fillStyle = '#5f3c1c';
  ctx.beginPath();
  ctx.ellipse(-40, 6, 16, 32, 0.25, 0, Math.PI * 2);
  ctx.ellipse(40, 6, 16, 32, -0.25, 0, Math.PI * 2);
  ctx.fill();
  // crânio
  ctx.fillStyle = '#8a5a2b';
  ctx.beginPath();
  ctx.ellipse(0, 0, 42, 38, 0, 0, Math.PI * 2);
  ctx.fill();
  // focinho
  ctx.fillStyle = '#e7d3b3';
  ctx.beginPath();
  ctx.ellipse(8, 16, 28, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1f2937';
  ctx.beginPath();
  ctx.ellipse(20, 10, 8, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // olhos: rindo = fechados em arco; orgulhoso = abertos
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 3;
  if (laughing) {
    for (const ex of [-16, 14]) {
      ctx.beginPath();
      ctx.arc(ex, -8, 8, Math.PI, 0);
      ctx.stroke();
    }
    // boca aberta
    ctx.fillStyle = '#7f1d1d';
    ctx.beginPath();
    ctx.ellipse(10, 26, 16, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.ellipse(12, 30, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#1f2937';
    for (const ex of [-16, 14]) {
      ctx.beginPath();
      ctx.arc(ex, -8, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(10, 22, 9, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }
}

function easeOut(k: number): number {
  return 1 - (1 - k) * (1 - k);
}

function easeIn(k: number): number {
  return k * k;
}
