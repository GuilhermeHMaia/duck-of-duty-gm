import { BLINK_TRIGGER_MS } from '../calibration/calibrationScene';
import type { CareerStore } from '../career/careerStore';
import { dailyChallenge, todayKey } from '../career/daily';
import { sfx } from '../game/sound';
import type { AimState, AimTarget } from '../game/aiming';
import type { DebugConfig, FaceFrame } from '../types';

/** Navegação entre as telas; implementada em main.ts. */
export interface Nav {
  menu(): void;
  map(): void;
  briefing(missionId: string): void;
  arsenal(returnTo: () => void): void;
  startMission(missionId: string): void;
  startArcade(): void;
  startDaily(): void;
  achievements(): void;
  freeAim(): void;
  recalibrate(): void;
}

/**
 * Piscada deliberada (dois olhos fechados por ≥ BLINK_TRIGGER_MS): dispara uma vez por
 * piscada e devolve o timestamp em que os olhos começaram a fechar.
 */
export class DeliberateBlink {
  private closedSince: number | null = null;
  private handled = false;

  update(frame: FaceFrame): number | null {
    if (frame.faceDetected && frame.eyeState.bothClosed) {
      if (this.closedSince === null) {
        this.closedSince = frame.timestamp;
        this.handled = false;
      }
      if (!this.handled && frame.timestamp - this.closedSince >= BLINK_TRIGGER_MS) {
        this.handled = true;
        return this.closedSince;
      }
      return null;
    }
    this.closedSince = null;
    this.handled = false;
    return null;
  }

  /** Ignora uma piscada que já está em curso (a que abriu esta tela, por exemplo). */
  ignoreCurrent(): void {
    this.handled = true;
  }
}

export interface UiButton {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  enabled?: boolean;
  primary?: boolean;
  onSelect: () => void;
}

/** Folga em volta do botão para contar como "olhando para ele" (a mira do olho não é precisa). */
const HOVER_PADDING = 18;
const HOVER_HISTORY_MS = 1500;

/**
 * Tela feita de botões. Olhar para um botão o destaca; piscar devagar escolhe. O botão
 * escolhido é o que estava destacado preBlinkBufferMs antes de os olhos começarem a fechar
 * (fechar os olhos move a mira). O mouse também funciona.
 *
 * Os botões não entram no snap magnético: vários botões perto um do outro fariam a mira
 * grudar no errado. O destaque usa a mira livre, com folga.
 */
export abstract class ButtonScene {
  private readonly blink = new DeliberateBlink();
  private hoverHistory: { t: number; id: string | null }[] = [];
  private hoveredId: string | null = null;

  constructor(protected readonly config: DebugConfig) {}

  /** Chamado ao entrar na tela. */
  enter(): void {
    this.blink.ignoreCurrent();
    this.hoverHistory = [];
    this.hoveredId = null;
  }

  protected abstract layout(w: number, h: number): UiButton[];
  protected abstract drawContent(ctx: CanvasRenderingContext2D, now: number, w: number, h: number): void;

  getTargets(): AimTarget[] {
    return [];
  }

  onFrame(frame: FaceFrame, aim: AimState | null, w: number, h: number): void {
    const buttons = this.layout(w, h);
    const hovered = aim ? hitTest(buttons, aim.unsnapped.x, aim.unsnapped.y, HOVER_PADDING) : null;
    this.hoveredId = hovered?.id ?? null;
    this.hoverHistory.push({ t: frame.timestamp, id: this.hoveredId });
    while (this.hoverHistory.length > 0 && this.hoverHistory[0].t < frame.timestamp - HOVER_HISTORY_MS) this.hoverHistory.shift();

    const closureStart = this.blink.update(frame);
    if (closureStart === null) return;
    const want = closureStart - this.config.preBlinkBufferMs;
    let past: { t: number; id: string | null } | null = null;
    for (const h of this.hoverHistory) if (!past || Math.abs(h.t - want) < Math.abs(past.t - want)) past = h;
    buttons.find((b) => b.id === past?.id && b.enabled !== false)?.onSelect();
  }

  onClick(x: number, y: number, w: number, h: number): void {
    hitTest(this.layout(w, h), x, y, 0)?.onSelect();
  }

  render(ctx: CanvasRenderingContext2D, now: number, w: number, h: number): void {
    drawMenuBackground(ctx, w, h);
    this.drawContent(ctx, now, w, h);
    for (const b of this.layout(w, h)) drawButton(ctx, b, b.id === this.hoveredId && b.enabled !== false);
    drawText(ctx, w / 2, h - 18, 'Olhe um botão e feche os olhos por um instante para escolher · ou clique', 13, '#64748b');
  }
}

function hitTest(buttons: UiButton[], x: number, y: number, pad: number): UiButton | null {
  return (
    buttons.find((b) => b.enabled !== false && x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) ?? null
  );
}

// ---------- Menu principal ----------

export class MenuScene extends ButtonScene {
  constructor(
    config: DebugConfig,
    private readonly career: CareerStore,
    private readonly nav: Nav,
  ) {
    super(config);
  }

  protected layout(w: number, h: number): UiButton[] {
    const daily = dailyChallenge();
    const best = this.career.dailyBest(todayKey());
    const items: Omit<UiButton, 'x' | 'y' | 'w' | 'h'>[] = [
      { id: 'career', label: 'Carreira', sub: 'Operações da Divisão Olho de Águia', primary: true, onSelect: () => this.nav.map() },
      { id: 'daily', label: 'Desafio Diário', sub: `${daily.environmentName} · melhor hoje: ${Math.round(best)}`, primary: true, onSelect: () => this.nav.startDaily() },
      { id: 'arcade', label: 'Treino Livre', sub: '5 rodadas · recorde', onSelect: () => this.nav.startArcade() },
      { id: 'arsenal', label: 'Arsenal', sub: 'Armas e melhorias', onSelect: () => this.nav.arsenal(() => this.nav.menu()) },
      { id: 'achievements', label: 'Conquistas', sub: `${this.career.state.achievements.length} desbloqueadas`, onSelect: () => this.nav.achievements() },
      { id: 'free', label: 'Mira livre', sub: 'Testar e recentralizar a mira', onSelect: () => this.nav.freeAim() },
      { id: 'recalibrate', label: 'Recalibrar', sub: 'Refazer o Estande de Treino', onSelect: () => this.nav.recalibrate() },
    ];
    return gridButtons(items, w, h, h * 0.3);
  }

  protected drawContent(ctx: CanvasRenderingContext2D, _now: number, w: number, h: number): void {
    drawText(ctx, w / 2, h * 0.12, 'DUCK OF DUTY', 52, '#f8fafc');
    drawText(ctx, w / 2, h * 0.12 + 44, 'Divisão Olho de Águia', 20, '#94a3b8');
    drawText(ctx, w / 2, h * 0.12 + 80, `★ ${this.career.totalStars()}   ·   ${this.career.state.penas} penas`, 18, '#facc15');
    if (!sfx.ready) drawText(ctx, w / 2, h - 40, 'Clique em qualquer lugar ou aperte uma tecla para ativar o som · M silencia', 13, '#94a3b8');
  }
}

/** Grade de 2 colunas centralizada (1 coluna em tela estreita). */
export function gridButtons(items: Omit<UiButton, 'x' | 'y' | 'w' | 'h'>[], w: number, h: number, top: number): UiButton[] {
  const cols = w >= 700 ? 2 : 1;
  const gap = 14;
  const rows = Math.ceil(items.length / cols);
  const bw = Math.min(380, (w - 48 - gap * (cols - 1)) / cols);
  const bh = Math.max(46, Math.min(70, (h - 60 - top - gap * (rows - 1)) / rows));
  const x0 = w / 2 - (cols * bw + (cols - 1) * gap) / 2;
  return items.map((it, i) => ({ ...it, x: x0 + (i % cols) * (bw + gap), y: top + Math.floor(i / cols) * (bh + gap), w: bw, h: bh }));
}

/** Empilha botões centralizados, encolhendo a altura se a tela for baixa. */
export function stackButtons(items: Omit<UiButton, 'x' | 'y' | 'w' | 'h'>[], w: number, h: number, top: number): UiButton[] {
  const gap = 16;
  const bw = Math.min(420, w - 48);
  const bh = Math.max(48, Math.min(72, (h - 40 - top - gap * (items.length - 1)) / items.length));
  return items.map((it, i) => ({ ...it, x: w / 2 - bw / 2, y: top + i * (bh + gap), w: bw, h: bh }));
}

// ---------- Desenho compartilhado ----------

export function drawMenuBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0b1324');
  g.addColorStop(1, '#10251a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export function drawButton(ctx: CanvasRenderingContext2D, b: UiButton, hovered: boolean): void {
  const enabled = b.enabled !== false;
  ctx.save();
  roundRect(ctx, b.x, b.y, b.w, b.h, 12);
  ctx.fillStyle = !enabled ? 'rgba(30, 41, 59, 0.5)' : b.primary ? 'rgba(22, 101, 52, 0.85)' : 'rgba(30, 41, 59, 0.9)';
  ctx.fill();
  ctx.lineWidth = hovered ? 4 : 1.5;
  ctx.strokeStyle = hovered ? '#4ade80' : enabled ? 'rgba(148, 163, 184, 0.5)' : 'rgba(71, 85, 105, 0.5)';
  ctx.stroke();
  const color = enabled ? '#f8fafc' : '#64748b';
  const labelSize = fitSize(ctx, b.label, b.w - 20, b.sub ? Math.min(22, b.h * 0.36) : Math.min(22, b.h * 0.45));
  if (b.sub) {
    drawText(ctx, b.x + b.w / 2, b.y + b.h * 0.38, b.label, labelSize, color);
    drawText(ctx, b.x + b.w / 2, b.y + b.h * 0.74, b.sub, fitSize(ctx, b.sub, b.w - 20, 14), enabled ? '#cbd5e1' : '#64748b');
  } else {
    drawText(ctx, b.x + b.w / 2, b.y + b.h / 2, b.label, labelSize, color);
  }
  ctx.restore();
}

/** Maior tamanho de fonte (até `max`) em que o texto cabe em `maxWidth`. */
export function fitSize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, max: number): number {
  ctx.font = `600 ${max}px system-ui, 'Segoe UI', sans-serif`;
  const width = ctx.measureText(text).width;
  return width <= maxWidth ? max : Math.max(10, Math.floor((max * maxWidth) / width));
}

export function drawText(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, size: number, color: string, align: CanvasTextAlign = 'center'): void {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px system-ui, 'Segoe UI', sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

export function starsText(count: number, total = 3): string {
  return '★'.repeat(count) + '☆'.repeat(Math.max(0, total - count));
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Quebra um texto em linhas que caibam em maxWidth. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number): string[] {
  ctx.font = `600 ${size}px system-ui, 'Segoe UI', sans-serif`;
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
