import { ACHIEVEMENTS } from '../career/achievements';
import type { CareerStore } from '../career/careerStore';
import type { DebugConfig } from '../types';
import { ButtonScene, drawText, roundRect, type Nav, type UiButton } from './menuScene';

/** Lista de conquistas: desbloqueadas em dourado, as outras apagadas. */
export class AchievementsScene extends ButtonScene {
  constructor(
    config: DebugConfig,
    private readonly career: CareerStore,
    private readonly nav: Nav,
  ) {
    super(config);
  }

  protected layout(w: number, h: number): UiButton[] {
    return [{ id: 'back', x: w / 2 - 110, y: h - 90, w: 220, h: 56, label: 'Voltar', onSelect: () => this.nav.menu() }];
  }

  protected drawContent(ctx: CanvasRenderingContext2D, _now: number, w: number, h: number): void {
    const unlocked = new Set(this.career.state.achievements);
    drawText(ctx, w / 2, h * 0.07, 'Conquistas', 36, '#f8fafc');
    drawText(ctx, w / 2, h * 0.07 + 34, `${unlocked.size} de ${ACHIEVEMENTS.length}`, 18, '#facc15');
    const cols = w > 900 ? 2 : 1;
    const cardW = Math.min(440, (w - 48 - (cols - 1) * 16) / cols);
    const top = h * 0.07 + 62;
    const rows = Math.ceil(ACHIEVEMENTS.length / cols);
    const cardH = Math.max(40, Math.min(58, (h - 110 - top - (rows - 1) * 8) / rows));
    const x0 = w / 2 - (cols * cardW + (cols - 1) * 16) / 2;
    ACHIEVEMENTS.forEach((a, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = x0 + col * (cardW + 16);
      const y = top + row * (cardH + 8);
      const done = unlocked.has(a.id);
      ctx.save();
      roundRect(ctx, x, y, cardW, cardH, 10);
      ctx.fillStyle = done ? 'rgba(120, 83, 10, 0.55)' : 'rgba(30, 41, 59, 0.6)';
      ctx.fill();
      ctx.strokeStyle = done ? '#fbbf24' : 'rgba(71, 85, 105, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      drawText(ctx, x + 16, y + cardH * 0.36, `${done ? '🏆' : '🔒'}  ${a.name}`, 17, done ? '#fde68a' : '#94a3b8', 'left');
      drawText(ctx, x + 16, y + cardH * 0.72, a.description, 13, done ? '#fef3c7' : '#64748b', 'left');
    });
  }
}
