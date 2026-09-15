import type { CareerStore } from '../career/careerStore';
import { missionsOf, REGIONS } from '../career/missions';
import type { DebugConfig } from '../types';
import { ButtonScene, drawText, starsText, type Nav, type UiButton } from './menuScene';

/** Mapa da campanha: uma coluna por região, com as missões em sequência. */
export class MapScene extends ButtonScene {
  constructor(
    config: DebugConfig,
    private readonly career: CareerStore,
    private readonly nav: Nav,
  ) {
    super(config);
  }

  private columns(w: number): { x: number; width: number }[] {
    const width = Math.min(400, (w - 72) / REGIONS.length);
    const total = width * REGIONS.length + 24 * (REGIONS.length - 1);
    return REGIONS.map((_, i) => ({ x: w / 2 - total / 2 + i * (width + 24), width }));
  }

  protected layout(w: number, h: number): UiButton[] {
    const buttons: UiButton[] = [];
    const cols = this.columns(w);
    const top = h * 0.26;
    const gap = 14;
    const bh = Math.max(50, Math.min(70, (h * 0.86 - top - 90 - gap * 3) / 4));
    REGIONS.forEach((region, c) => {
      missionsOf(region.id).forEach((m, i) => {
        const unlocked = this.career.isMissionUnlocked(m);
        buttons.push({
          id: m.id,
          x: cols[c].x,
          y: top + i * (bh + gap),
          w: cols[c].width,
          h: bh,
          label: `${i + 1}. ${m.name}`,
          sub: unlocked ? starsText(this.career.starsOf(m.id)) : 'bloqueada',
          enabled: unlocked,
          onSelect: () => this.nav.briefing(m.id),
        });
      });
    });
    const by = top + 4 * (bh + gap) + 20;
    const bw = 200;
    buttons.push(
      { id: 'arsenal', x: w / 2 - bw - 12, y: by, w: bw, h: 56, label: 'Arsenal', onSelect: () => this.nav.arsenal(() => this.nav.map()) },
      { id: 'menu', x: w / 2 + 12, y: by, w: bw, h: 56, label: 'Menu', onSelect: () => this.nav.menu() },
    );
    return buttons;
  }

  protected drawContent(ctx: CanvasRenderingContext2D, _now: number, w: number, h: number): void {
    drawText(ctx, w / 2, h * 0.07, 'Mapa de Operações', 36, '#f8fafc');
    drawText(ctx, w / 2, h * 0.07 + 36, `★ ${this.career.totalStars()}   ·   ${this.career.state.penas} penas`, 18, '#facc15');
    const cols = this.columns(w);
    REGIONS.forEach((region, c) => {
      const x = cols[c].x + cols[c].width / 2;
      const unlocked = this.career.isRegionUnlocked(region);
      const total = missionsOf(region.id).length * 3;
      drawText(ctx, x, h * 0.26 - 44, region.name, 24, unlocked ? '#f8fafc' : '#64748b');
      const detail = unlocked
        ? `${this.career.regionStars(region.id)} / ${total} ★`
        : `precisa de ${region.unlock!.stars} ★ em ${REGIONS.find((r) => r.id === region.unlock!.region)!.name}`;
      drawText(ctx, x, h * 0.26 - 18, detail, 15, unlocked ? '#facc15' : '#94a3b8');
    });
  }
}
