import type { MissionReward } from '../career/careerStore';
import { accuracyOf, objectiveLabel, type MissionDef } from '../career/missions';
import { CAMPAIGN_HOOK } from '../career/story';
import type { GameStats } from '../game/duckGame';
import type { DebugConfig } from '../types';
import { ButtonScene, drawText, starsText, type Nav, type UiButton } from './menuScene';

export type ResultData =
  | { kind: 'mission'; mission: MissionDef; stats: GameStats; achieved: boolean[]; reward: MissionReward; showHook: boolean }
  | { kind: 'arcade'; stats: GameStats; record: number };

/** Resultado de uma missão (estrelas e penas) ou do Treino Livre (pontos e recorde). */
export class ResultScene extends ButtonScene {
  private data: ResultData | null = null;

  constructor(
    config: DebugConfig,
    private readonly nav: Nav,
  ) {
    super(config);
  }

  show(data: ResultData): void {
    this.data = data;
  }

  protected layout(w: number, h: number): UiButton[] {
    const bw = 240;
    const by = h - 110;
    const d = this.data;
    if (!d) return [];
    const left = { x: w / 2 - bw - 12, y: by, w: bw, h: 64 };
    const right = { x: w / 2 + 12, y: by, w: bw, h: 64 };
    if (d.kind === 'mission') {
      return [
        { id: 'continue', ...left, label: 'Continuar', primary: true, onSelect: () => this.nav.map() },
        { id: 'retry', ...right, label: 'Repetir missão', onSelect: () => this.nav.startMission(d.mission.id) },
      ];
    }
    return [
      { id: 'again', ...left, label: 'Jogar de novo', primary: true, onSelect: () => this.nav.startArcade() },
      { id: 'menu', ...right, label: 'Menu', onSelect: () => this.nav.menu() },
    ];
  }

  protected drawContent(ctx: CanvasRenderingContext2D, _now: number, w: number, h: number): void {
    const d = this.data;
    if (!d) return;
    const cx = w / 2;
    let y = h * 0.1;

    if (d.kind === 'arcade') {
      drawText(ctx, cx, y, 'Treino Livre', 22, '#94a3b8');
      drawText(ctx, cx, (y += 60), `${d.stats.score} pontos`, 48, '#f8fafc');
      drawText(ctx, cx, (y += 56), `${d.stats.hits} de ${d.stats.ducks} patos · precisão ${Math.round(accuracyOf(d.stats) * 100)}%`, 20, '#cbd5e1');
      drawText(ctx, cx, (y += 44), d.stats.newRecord ? 'Novo recorde!' : `Recorde: ${d.record}`, 24, d.stats.newRecord ? '#facc15' : '#94a3b8');
      return;
    }

    const success = d.achieved[0];
    const stars = d.achieved.filter(Boolean).length;
    drawText(ctx, cx, y, d.mission.name, 22, '#94a3b8');
    drawText(ctx, cx, (y += 54), success ? 'Missão cumprida!' : 'Missão falhou', 42, success ? '#4ade80' : '#fca5a5');
    drawText(ctx, cx, (y += 60), starsText(stars), 52, '#facc15');
    d.mission.objectives.forEach((o, i) => {
      y += i === 0 ? 50 : 30;
      drawText(ctx, cx, y, `${d.achieved[i] ? '✓' : '✗'}  ${objectiveLabel(o)}`, 18, d.achieved[i] ? '#bbf7d0' : '#94a3b8');
    });
    drawText(ctx, cx, (y += 46), `${d.stats.hits} de ${d.stats.ducks} patos · precisão ${Math.round(accuracyOf(d.stats) * 100)}% · ${d.stats.escaped} fugiram`, 17, '#cbd5e1');
    const starNote = d.reward.newStars > 0 ? ` (${d.reward.newStars} estrela${d.reward.newStars > 1 ? 's' : ''} nova${d.reward.newStars > 1 ? 's' : ''})` : '';
    drawText(ctx, cx, (y += 34), `+${d.reward.penas} penas${starNote}`, 22, '#facc15');
    for (const region of d.reward.unlockedRegions) {
      drawText(ctx, cx, (y += 38), `Nova região desbloqueada: ${region.name}!`, 22, '#7dd3fc');
    }
    if (d.showHook) {
      y += 20;
      for (const line of CAMPAIGN_HOOK) drawText(ctx, cx, (y += 26), line, 16, '#fde68a');
    }
  }
}
