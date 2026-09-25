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

/**
 * Ruído determinístico 0–1 a partir de um inteiro: nuvens, estrelas e árvores ficam sempre no
 * mesmo lugar entre frames (e entre partidas) sem guardar estado.
 */
function noise(i: number): number {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Céu e fundo, desenhados ANTES dos patos. `now` (ms) anima nuvens, ondas e neblina. */
export function drawEnvironmentBack(
  ctx: CanvasRenderingContext2D,
  env: EnvironmentId,
  w: number,
  h: number,
  groundY: number,
  now = 0,
): void {
  if (env === 'forest') {
    drawForestBack(ctx, w, h, groundY, now);
    return;
  }
  if (env === 'swamp') {
    drawSwampBack(ctx, w, h, groundY, now);
    return;
  }
  drawLakeBack(ctx, w, h, groundY, now);
}

// ---------- Lago do Vovô: fim de tarde ----------

function drawLakeBack(ctx: CanvasRenderingContext2D, w: number, h: number, groundY: number, now: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, '#102a4c');
  sky.addColorStop(0.45, '#2d5c8a');
  sky.addColorStop(0.8, '#6b87a3');
  sky.addColorStop(1, '#d9a273');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, groundY);

  // Sol baixo com brilho.
  const sunX = w * 0.76;
  const sunY = groundY * 0.72;
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 190);
  glow.addColorStop(0, 'rgba(255, 214, 153, 0.55)');
  glow.addColorStop(1, 'rgba(255, 214, 153, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(sunX - 190, sunY - 190, 380, 380);
  ctx.fillStyle = '#ffe2b0';
  ctx.beginPath();
  ctx.arc(sunX, sunY, 40, 0, Math.PI * 2);
  ctx.fill();

  drawClouds(ctx, w, groundY, now, 'rgba(238, 232, 224, 0.75)', 6, 0.012);

  // Morros ao fundo, dois planos.
  drawHills(ctx, w, groundY, groundY * 0.22, '#2b4c62', 0);
  drawHills(ctx, w, groundY, groundY * 0.14, '#274434', 7);

  // Linha de árvores logo acima da margem.
  ctx.fillStyle = '#1b3324';
  for (let i = 0; x(i) < w + 40; i++) {
    const tx = x(i);
    const th = 26 + noise(i * 3) * 30;
    ctx.beginPath();
    ctx.moveTo(tx - 16, groundY + 2);
    ctx.quadraticCurveTo(tx, groundY - th, tx + 16, groundY + 2);
    ctx.fill();
  }
  function x(i: number): number {
    return i * 34 - 20;
  }

  // Água: da linha do horizonte até a margem de grama.
  const waterBottom = groundY + (h - groundY) * 0.42;
  const water = ctx.createLinearGradient(0, groundY, 0, waterBottom);
  water.addColorStop(0, '#2f6188');
  water.addColorStop(1, '#17384f');
  ctx.fillStyle = water;
  ctx.fillRect(0, groundY, w, waterBottom - groundY);

  // Reflexo do sol e ondas.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#ffd9a0';
  for (let i = 0; i < 9; i++) {
    const y = groundY + 6 + i * ((waterBottom - groundY - 8) / 9);
    const ww = 70 - i * 5 + Math.sin(now / 420 + i) * 14;
    ctx.fillRect(sunX - ww / 2, y, Math.max(8, ww), 3);
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(226, 240, 255, 0.22)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const y = groundY + 10 + i * ((waterBottom - groundY) / 14);
    const off = Math.sin(now / 900 + i * 1.7) * 30;
    ctx.beginPath();
    ctx.moveTo((i * 137) % w, y);
    ctx.lineTo(((i * 137) % w) + 60 + off, y);
    ctx.stroke();
  }
}

// ---------- Floresta Noturna ----------

function drawForestBack(ctx: CanvasRenderingContext2D, w: number, h: number, groundY: number, now: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, '#01040c');
  sky.addColorStop(1, '#0c1d2e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Estrelas piscando.
  for (let i = 0; i < 90; i++) {
    const sx = noise(i) * w;
    const sy = noise(i + 500) * groundY * 0.8;
    const tw = 0.45 + 0.55 * Math.abs(Math.sin(now / 900 + i));
    ctx.fillStyle = `rgba(226, 232, 240, ${tw * 0.8})`;
    ctx.fillRect(sx, sy, 2, 2);
  }

  // Lua com halo.
  const mx = w * 0.82;
  const my = h * 0.16;
  const halo = ctx.createRadialGradient(mx, my, 0, mx, my, 150);
  halo.addColorStop(0, 'rgba(226, 232, 240, 0.22)');
  halo.addColorStop(1, 'rgba(226, 232, 240, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(mx - 150, my - 150, 300, 300);
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.arc(mx, my, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#01040c';
  ctx.beginPath();
  ctx.arc(mx + 14, my - 8, 30, 0, Math.PI * 2);
  ctx.fill();

  drawClouds(ctx, w, groundY, now, 'rgba(30, 41, 59, 0.75)', 4, 0.008);
  // Mata ao fundo (mais clara que a da frente, para dar profundidade).
  drawTreeLine(ctx, w, groundY, 150, 96, '#071a12', 11);
}

// ---------- Pântano da Neblina ----------

function drawSwampBack(ctx: CanvasRenderingContext2D, w: number, h: number, groundY: number, now: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, '#39493f');
  sky.addColorStop(0.6, '#5c7166');
  sky.addColorStop(1, '#8b9c8e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Árvores mortas ao fundo.
  drawTreeLine(ctx, w, groundY, 210, 130, 'rgba(38, 51, 44, 0.75)', 23);

  // Faixas de névoa deslizando.
  for (let i = 0; i < 6; i++) {
    const y = groundY * (0.35 + i * 0.1);
    const drift = ((now * 0.01 * (0.4 + noise(i) * 0.6)) % (w + 400)) - 200;
    ctx.fillStyle = `rgba(214, 226, 218, ${0.06 + noise(i + 9) * 0.06})`;
    ctx.beginPath();
    ctx.ellipse(drift, y, 260 + noise(i + 3) * 160, 26 + noise(i + 5) * 16, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Água parada e escura.
  const water = ctx.createLinearGradient(0, groundY, 0, h);
  water.addColorStop(0, '#31453d');
  water.addColorStop(1, '#1d2b26');
  ctx.fillStyle = water;
  ctx.fillRect(0, groundY, w, h - groundY);
}

// ---------- Primeiro plano ----------

/** Chão e vegetação, desenhados DEPOIS dos patos (eles nascem "de trás" da grama). */
export function drawEnvironmentFront(
  ctx: CanvasRenderingContext2D,
  env: EnvironmentId,
  w: number,
  h: number,
  groundY: number,
  now = 0,
): void {
  if (env === 'forest') {
    drawTreeLine(ctx, w, groundY, 110, 130, '#020a06', 3);
    ctx.fillStyle = '#05120b';
    ctx.fillRect(0, groundY, w, h - groundY);
    drawGrassTufts(ctx, w, groundY, now, '#0a2416', 22);
    return;
  }
  if (env === 'swamp') {
    // Troncos secos em primeiro plano.
    ctx.strokeStyle = '#1b2521';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    for (let i = 0; i * 190 < w + 100; i++) {
      const tx = 40 + i * 190;
      const top = groundY - 130 - noise(i) * 60;
      ctx.beginPath();
      ctx.moveTo(tx, groundY + 10);
      ctx.lineTo(tx + 6, top);
      ctx.lineTo(tx + 42, top - 34);
      ctx.moveTo(tx + 5, top + 42);
      ctx.lineTo(tx - 30, top + 12);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    // Vitórias-régias e reflexos na água escura.
    for (let i = 0; i * 120 < w + 60; i++) {
      const lx = 30 + i * 120 + Math.sin(now / 2600 + i) * 8;
      const ly = groundY + 30 + ((i * 53) % Math.max(20, h - groundY - 50));
      ctx.fillStyle = '#2f5044';
      ctx.beginPath();
      ctx.ellipse(lx, ly, 26, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1d2b26';
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + 12, ly - 6);
      ctx.lineTo(lx + 12, ly + 6);
      ctx.fill();
    }
    drawReeds(ctx, w, groundY, now, '#24382f');
    return;
  }

  // Lago: margem de grama com tufos e juncos, abaixo da água.
  const bankY = groundY + (h - groundY) * 0.42;
  const bank = ctx.createLinearGradient(0, bankY, 0, h);
  bank.addColorStop(0, '#2c6b3c');
  bank.addColorStop(1, '#17401f');
  ctx.fillStyle = bank;
  ctx.beginPath();
  ctx.moveTo(0, bankY + 10);
  for (let x = 0; x <= w; x += 40) ctx.lineTo(x, bankY + 4 + Math.sin(x / 90) * 8);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.fill();
  drawGrassTufts(ctx, w, bankY + 6, now, '#3d8a4c', 18);
  drawReeds(ctx, w, bankY + 4, now, '#1f5a2c');
}

// ---------- Peças reutilizadas ----------

function drawClouds(ctx: CanvasRenderingContext2D, w: number, groundY: number, now: number, color: string, count: number, speed: number): void {
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const span = w + 420;
    const cx = ((noise(i) * span + now * speed * (0.5 + noise(i + 20))) % span) - 210;
    const cy = groundY * (0.1 + noise(i + 40) * 0.42);
    const s = 0.7 + noise(i + 60) * 0.8;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 70 * s, 22 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 50 * s, cy + 6 * s, 46 * s, 17 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(cx - 46 * s, cy + 8 * s, 40 * s, 15 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Morros arredondados atrás do horizonte. */
function drawHills(ctx: CanvasRenderingContext2D, w: number, groundY: number, height: number, color: string, seed: number): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, groundY + 2);
  for (let i = 0; i * 180 <= w + 180; i++) {
    const cx = i * 180;
    const peak = height * (0.6 + noise(i + seed) * 0.7);
    ctx.quadraticCurveTo(cx + 90, groundY - peak, cx + 180, groundY + 2);
  }
  ctx.lineTo(w, groundY + 2);
  ctx.fill();
}

/** Silhueta de mata: triângulos de alturas variadas. */
function drawTreeLine(ctx: CanvasRenderingContext2D, w: number, groundY: number, height: number, step: number, color: string, seed: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i * step < w + step * 2; i++) {
    const tx = i * step - step;
    const th = height * (0.6 + noise(i + seed) * 0.7);
    const half = step * 0.62;
    ctx.beginPath();
    ctx.moveTo(tx - half, groundY + 6);
    ctx.lineTo(tx, groundY - th);
    ctx.lineTo(tx + half, groundY + 6);
    ctx.fill();
    // galhos laterais, para não ficar um triângulo liso
    ctx.beginPath();
    ctx.moveTo(tx - half * 1.25, groundY + 6);
    ctx.lineTo(tx, groundY - th * 0.55);
    ctx.lineTo(tx + half * 1.25, groundY + 6);
    ctx.fill();
  }
}

/** Tufos de grama balançando devagar. */
function drawGrassTufts(ctx: CanvasRenderingContext2D, w: number, y: number, now: number, color: string, step: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i * step < w + step; i++) {
    const gx = i * step;
    const sway = Math.sin(now / 1100 + i * 0.7) * 4;
    const gh = 12 + noise(i + 77) * 14;
    ctx.beginPath();
    ctx.moveTo(gx, y + 4);
    ctx.quadraticCurveTo(gx + step * 0.35 + sway, y - gh, gx + step * 0.7, y + 4);
    ctx.fill();
  }
}

/** Juncos altos e finos na margem. */
function drawReeds(ctx: CanvasRenderingContext2D, w: number, y: number, now: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  for (let i = 0; i * 46 < w + 46; i++) {
    const rx = 12 + i * 46;
    const rh = 34 + noise(i + 13) * 34;
    const sway = Math.sin(now / 1300 + i) * 7;
    ctx.beginPath();
    ctx.moveTo(rx, y + 6);
    ctx.quadraticCurveTo(rx + sway * 0.5, y - rh * 0.6, rx + sway, y - rh);
    ctx.stroke();
  }
}

/** Escurecimento suave nas bordas da tela: dá foco ao centro e disfarça as emendas do cenário. */
export function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0, 0, 0, 0)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
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
