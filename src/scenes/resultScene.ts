import type { AchievementDef } from '../career/achievements';
import type { MissionReward } from '../career/careerStore';
import { accuracyOf, objectiveLabel, type MissionDef } from '../career/missions';
import type { GameStats } from '../game/duckGame';
import type { DebugConfig } from '../types';
import { ButtonScene, drawText, starsText, type Nav, type UiButton } from './menuScene';

export type ResultData =
  | {
      kind: 'mission';
      mission: MissionDef;
      stats: GameStats;
      achieved: boolean[];
      reward: MissionReward;
      /** Falas de história ao completar esta missão pela primeira vez (vazio se não houver). */
      hook: readonly string[];
      achievements: AchievementDef[];
    }
  | { kind: 'arcade'; stats: GameStats; record: number; achievements: AchievementDef[] }
  | { kind: 'daily'; stats: GameStats; best: number; newBest: boolean; penas: number; placeName: string; achievements: AchievementDef[] };

/** Resultado de uma missão (estrelas e penas), do Treino Livre (recorde) ou do Desafio Diário. */
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
    const by = h - 96;
    const d = this.data;
    if (!d) return [];
    const left = { x: w / 2 - bw - 12, y: by, w: bw, h: 60 };
    const right = { x: w / 2 + 12, y: by, w: bw, h: 60 };
    if (d.kind === 'mission') {
      return [
        { id: 'continue', ...left, label: 'Continuar', primary: true, onSelect: () => this.nav.map() },
        { id: 'retry', ...right, label: 'Repetir missão', onSelect: () => this.nav.startMission(d.mission.id) },
      ];
    }
    if (d.kind === 'daily') {
      return [
        { id: 'again', ...left, label: 'Tentar de novo', primary: true, onSelect: () => this.nav.startDaily() },
        { id: 'menu', ...right, label: 'Menu', onSelect: () => this.nav.menu() },
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
    let y = h * 0.08;
    const statsLine = (s: GameStats) =>
      `${s.hits} de ${s.ducks} patos · precisão ${Math.round(accuracyOf(s) * 100)}% · combo máx. ${s.maxCombo}`;

    if (d.kind === 'arcade') {
      drawText(ctx, cx, y, 'Treino Livre', 22, '#94a3b8');
      drawText(ctx, cx, (y += 58), `${Math.round(d.stats.score)} pontos`, 46, '#f8fafc');
      drawText(ctx, cx, (y += 52), statsLine(d.stats), 19, '#cbd5e1');
      drawText(ctx, cx, (y += 42), d.stats.newRecord ? 'Novo recorde!' : `Recorde: ${d.record}`, 24, d.stats.newRecord ? '#facc15' : '#94a3b8');
      this.drawAchievements(ctx, cx, y + 20, d.achievements);
      return;
    }

    if (d.kind === 'daily') {
      drawText(ctx, cx, y, `Desafio Diário · ${d.placeName}`, 22, '#94a3b8');
      drawText(ctx, cx, (y += 58), `${Math.round(d.stats.score)} pontos`, 46, '#f8fafc');
      drawText(ctx, cx, (y += 52), statsLine(d.stats), 19, '#cbd5e1');
      drawText(ctx, cx, (y += 42), d.newBest ? 'Melhor pontuação de hoje!' : `Melhor de hoje: ${Math.round(d.best)}`, 24, d.newBest ? '#facc15' : '#94a3b8');
      drawText(ctx, cx, (y += 36), `+${d.penas} penas`, 22, '#facc15');
      this.drawAchievements(ctx, cx, y + 20, d.achievements);
      return;
    }

    const success = d.achieved[0];
    const stars = d.achieved.filter(Boolean).length;
    drawText(ctx, cx, y, d.mission.name, 22, '#94a3b8');
    drawText(ctx, cx, (y += 50), success ? 'Missão cumprida!' : 'Missão falhou', 40, success ? '#4ade80' : '#fca5a5');
    drawText(ctx, cx, (y += 54), starsText(stars), 48, '#facc15');
    d.mission.objectives.forEach((o, i) => {
      y += i === 0 ? 44 : 28;
      drawText(ctx, cx, y, `${d.achieved[i] ? '✓' : '✗'}  ${objectiveLabel(o)}`, 18, d.achieved[i] ? '#bbf7d0' : '#94a3b8');
    });
    drawText(ctx, cx, (y += 40), `${statsLine(d.stats)} · ${d.stats.escaped} fugiram`, 16, '#cbd5e1');
    const n = d.reward.newStars;
    const starNote = n > 0 ? ` (${n} estrela${n > 1 ? 's' : ''} nova${n > 1 ? 's' : ''})` : '';
    drawText(ctx, cx, (y += 30), `+${d.reward.penas} penas${starNote}`, 21, '#facc15');
    for (const region of d.reward.unlockedRegions) {
      drawText(ctx, cx, (y += 32), `Nova região desbloqueada: ${region.name}!`, 21, '#7dd3fc');
    }
    for (const line of d.hook) drawText(ctx, cx, (y += 24), line, 16, '#fde68a');
    this.drawAchievements(ctx, cx, y + 16, d.achievements);
  }

  private drawAchievements(ctx: CanvasRenderingContext2D, cx: number, y: number, list: AchievementDef[]): void {
    for (const a of list) {
      y += 28;
      drawText(ctx, cx, y, `🏆 Conquista: ${a.name} — ${a.description}`, 17, '#fbbf24');
    }
  }
}
