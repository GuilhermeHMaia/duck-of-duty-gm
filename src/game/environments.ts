export type EnvironmentId = 'lake' | 'forest' | 'swamp';

/** Floresta Noturna: raio do círculo de luz em volta da mira. */
export const LIGHT_RADIUS = 180;
/** Pântano da Neblina: raio da clareira que o olhar abre na neblina. */
export const FOG_RADIUS = 230;
const DARKNESS = 'rgba(2, 6, 15, 0.97)';
const FOG = 'rgba(148, 168, 158, 0.93)';

/** Até que distância da mira as coisas ficam visíveis (Infinity = tudo visível). */
export function visibilityRadius(env: EnvironmentId): number {
  return env === 'forest' ? LIGHT_RADIUS : env === 'swamp' ? FOG_RADIUS : Infinity;
}

/** O ambiente esconde o que está longe da mira? */
export function isDark(env: EnvironmentId): boolean {
  return visibilityRadius(env) !== Infinity;
}

/** Um ponto está visível (e mirável)? */
export function isLit(env: EnvironmentId, x: number, y: number, light: { x: number; y: number } | null): boolean {
  const radius = visibilityRadius(env);
  if (radius === Infinity) return true;
  if (!light) return false;
  return Math.hypot(x - light.x, y - light.y) <= radius;
}

/** Céu e fundo, desenhados ANTES dos patos. */
export function drawEnvironmentBack(ctx: CanvasRenderingContext2D, env: EnvironmentId, w: number, h: number, groundY: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  if (env === 'forest') {
    sky.addColorStop(0, '#02060f');
    sky.addColorStop(1, '#0b1a2b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
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
  if (env === 'swamp') {
    sky.addColorStop(0, '#3f4f48');
    sky.addColorStop(1, '#6b7f73');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
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
  if (env === 'swamp') {
    // árvores secas e juncos sobre a água parada
    ctx.strokeStyle = '#1f2a24';
    ctx.lineWidth = 6;
    for (let x = 40; x < w; x += 190) {
      const top = groundY - 120 - ((x * 13) % 50);
      ctx.beginPath();
      ctx.moveTo(x, groundY + 4);
      ctx.lineTo(x + 6, top);
      ctx.lineTo(x + 40, top - 30);
      ctx.moveTo(x + 5, top + 40);
      ctx.lineTo(x - 28, top + 10);
      ctx.stroke();
    }
    ctx.fillStyle = '#2f4a45';
    ctx.fillRect(0, groundY, w, h - groundY);
    ctx.fillStyle = '#3d5c55';
    for (let x = 0; x < w; x += 26) ctx.fillRect(x, groundY + 10 + ((x * 7) % 18), 14, 2);
    ctx.strokeStyle = '#27403a';
    ctx.lineWidth = 2;
    for (let x = 8; x < w; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, groundY + 2);
      ctx.lineTo(x + 3, groundY - 20 - ((x * 11) % 14));
      ctx.stroke();
    }
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
 * Cobre tudo que está longe da mira: escuridão com lanterna na Floresta, neblina com clareira
 * no Pântano. A borda do círculo é suave (gradiente).
 */
export function drawDarkness(ctx: CanvasRenderingContext2D, env: EnvironmentId, w: number, h: number, light: { x: number; y: number } | null): void {
  if (!isDark(env)) return;
  const radius = visibilityRadius(env);
  const cover = env === 'forest' ? DARKNESS : FOG;
  const clear = env === 'forest' ? 'rgba(2, 6, 15, 0)' : 'rgba(148, 168, 158, 0)';
  ctx.save();
  ctx.fillStyle = cover;
  if (!light) {
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.arc(light.x, light.y, radius, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  const edge = ctx.createRadialGradient(light.x, light.y, radius * 0.55, light.x, light.y, radius);
  edge.addColorStop(0, clear);
  edge.addColorStop(1, cover);
  ctx.fillStyle = edge;
  ctx.beginPath();
  ctx.arc(light.x, light.y, radius, 0, Math.PI * 2);
  ctx.fill();
  if (env === 'forest') {
    // Brilho quente da lanterna: o céu noturno é tão escuro que, sem isso, não dá para ver onde a luz está.
    const glow = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, radius);
    glow.addColorStop(0, 'rgba(255, 236, 179, 0.22)');
    glow.addColorStop(0.7, 'rgba(255, 236, 179, 0.08)');
    glow.addColorStop(1, 'rgba(255, 236, 179, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(light.x, light.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
