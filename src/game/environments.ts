export type EnvironmentId = 'lake' | 'forest';

/** Floresta Noturna: raio do círculo de luz em volta da mira. */
export const LIGHT_RADIUS = 180;
const DARKNESS = 'rgba(2, 6, 15, 0.97)';

/** Só a Floresta tem escuridão; no Lago tudo está sempre visível. */
export function isDark(env: EnvironmentId): boolean {
  return env === 'forest';
}

/** Um ponto está iluminado (visível e mirável)? */
export function isLit(env: EnvironmentId, x: number, y: number, light: { x: number; y: number } | null): boolean {
  if (!isDark(env)) return true;
  if (!light) return false;
  return Math.hypot(x - light.x, y - light.y) <= LIGHT_RADIUS;
}

/** Céu e fundo, desenhados ANTES dos patos. */
export function drawEnvironmentBack(ctx: CanvasRenderingContext2D, env: EnvironmentId, w: number, h: number, groundY: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  if (env === 'forest') {
    sky.addColorStop(0, '#02060f');
    sky.addColorStop(1, '#0b1a2b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    // lua
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.16, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#02060f';
    ctx.beginPath();
    ctx.arc(w * 0.82 + 14, h * 0.16 - 8, 30, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  sky.addColorStop(0, '#0f1b33');
  sky.addColorStop(1, '#27456b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
}

/** Chão e vegetação, desenhados DEPOIS dos patos (eles nascem "de trás" da grama). */
export function drawEnvironmentFront(ctx: CanvasRenderingContext2D, env: EnvironmentId, w: number, h: number, groundY: number): void {
  if (env === 'forest') {
    // pinheiros em silhueta
    ctx.fillStyle = '#030a07';
    for (let x = -20; x < w + 60; x += 70) {
      const treeH = 90 + ((x * 37) % 60);
      ctx.beginPath();
      ctx.moveTo(x, groundY + 4);
      ctx.lineTo(x + 30, groundY - treeH);
      ctx.lineTo(x + 60, groundY + 4);
      ctx.fill();
    }
    ctx.fillStyle = '#06140c';
    ctx.fillRect(0, groundY, w, h - groundY);
    return;
  }
  ctx.fillStyle = '#1f4d2b';
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.fillStyle = '#2d6a3a';
  for (let x = 0; x < w; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, groundY + 2);
    ctx.lineTo(x + 9, groundY - 16);
    ctx.lineTo(x + 18, groundY + 2);
    ctx.fill();
  }
}

/**
 * Escuridão com um círculo de luz na mira: tudo fora dele fica quase preto.
 * A borda do círculo é suave (gradiente) para parecer uma lanterna.
 */
export function drawDarkness(ctx: CanvasRenderingContext2D, env: EnvironmentId, w: number, h: number, light: { x: number; y: number } | null): void {
  if (!isDark(env)) return;
  ctx.save();
  ctx.fillStyle = DARKNESS;
  if (!light) {
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.arc(light.x, light.y, LIGHT_RADIUS, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  const edge = ctx.createRadialGradient(light.x, light.y, LIGHT_RADIUS * 0.55, light.x, light.y, LIGHT_RADIUS);
  edge.addColorStop(0, 'rgba(2, 6, 15, 0)');
  edge.addColorStop(1, DARKNESS);
  ctx.fillStyle = edge;
  ctx.beginPath();
  ctx.arc(light.x, light.y, LIGHT_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  // Brilho quente da lanterna: o céu noturno é tão escuro que, sem isso, não dá para ver onde a luz está.
  const glow = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, LIGHT_RADIUS);
  glow.addColorStop(0, 'rgba(255, 236, 179, 0.22)');
  glow.addColorStop(0.7, 'rgba(255, 236, 179, 0.08)');
  glow.addColorStop(1, 'rgba(255, 236, 179, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(light.x, light.y, LIGHT_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
