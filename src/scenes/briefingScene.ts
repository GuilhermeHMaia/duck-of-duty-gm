import type { CareerStore } from '../career/careerStore';
import { missionById, objectiveLabel, regionById } from '../career/missions';
import { BRIEFINGS, REGION_INTRO, SERGEANT } from '../career/story';
import { weaponById } from '../game/weapons';
import type { DebugConfig } from '../types';
import { ButtonScene, drawText, roundRect, wrapText, type Nav, type UiButton } from './menuScene';

/** Briefing do Sargento antes da missão: falas, objetivos e arma equipada. */
export class BriefingScene extends ButtonScene {
  private missionId = '';

  constructor(
    config: DebugConfig,
    private readonly career: CareerStore,
    private readonly nav: Nav,
  ) {
    super(config);
  }

  show(missionId: string): void {
    this.missionId = missionId;
  }

  protected layout(w: number, h: number): UiButton[] {
    const bw = Math.min(260, (w - 96) / 3);
    const by = h - 110;
    const total = bw * 3 + 24 * 2;
    const x0 = w / 2 - total / 2;
    return [
      { id: 'start', x: x0, y: by, w: bw, h: 64, label: 'Começar missão', primary: true, onSelect: () => this.nav.startMission(this.missionId) },
      { id: 'arsenal', x: x0 + bw + 24, y: by, w: bw, h: 64, label: 'Arsenal', onSelect: () => this.nav.arsenal(() => this.nav.briefing(this.missionId)) },
      { id: 'back', x: x0 + 2 * (bw + 24), y: by, w: bw, h: 64, label: 'Voltar ao mapa', onSelect: () => this.nav.map() },
    ];
  }

  protected drawContent(ctx: CanvasRenderingContext2D, _now: number, w: number, h: number): void {
    const mission = missionById(this.missionId);
    if (!mission) return;
    const region = regionById(mission.region);
    drawText(ctx, w / 2, h * 0.07, `${region.name} · Missão ${mission.index + 1}`, 18, '#94a3b8');
    drawText(ctx, w / 2, h * 0.07 + 36, mission.name, 38, '#f8fafc');

    // Fala do sargento (com a introdução da região na primeira missão).
    const lines = [...(mission.index === 0 ? REGION_INTRO[mission.region] : []), ...(BRIEFINGS[mission.id] ?? [])];
    const boxW = Math.min(760, w - 64);
    const boxX = w / 2 - boxW / 2;
    const boxY = h * 0.19;
    const wrapped = lines.flatMap((l) => wrapText(ctx, `“${l}”`, boxW - 40, 17));
    const lineH = 25;
    const boxH = 56 + wrapped.length * lineH;
    ctx.save();
    roundRect(ctx, boxX, boxY, boxW, boxH, 14);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    drawText(ctx, boxX + 20, boxY + 24, SERGEANT, 16, '#facc15', 'left');
    wrapped.forEach((l, i) => drawText(ctx, boxX + 20, boxY + 54 + i * lineH, l, 17, '#e2e8f0', 'left'));

    // Objetivos e arma.
    let y = boxY + boxH + 36;
    drawText(ctx, w / 2, y, 'Objetivos', 20, '#f8fafc');
    const done = this.career.objectivesOf(mission.id);
    mission.objectives.forEach((o, i) => {
      y += 30;
      const prefix = i === 0 ? 'Principal' : 'Bônus';
      drawText(ctx, w / 2, y, `${done[i] ? '★' : '☆'}  ${prefix}: ${objectiveLabel(o)}`, 17, done[i] ? '#facc15' : '#cbd5e1');
    });
    y += 42;
    const weapon = weaponById(this.career.state.equipped);
    drawText(ctx, w / 2, y, `Arma equipada: ${weapon.name}`, 16, '#94a3b8');
  }
}
