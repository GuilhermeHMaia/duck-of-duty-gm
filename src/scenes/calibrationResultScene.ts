import { stars, type CalibrationOutcome } from '../calibration/calibrationScene';
import type { DebugConfig } from '../types';
import { ButtonScene, drawText, wrapText, type UiButton } from './menuScene';

export interface CalibrationResultHooks {
  /** Seguir para o jogo (menu, ou tutorial na primeira vez). */
  continue(): void;
  /** Mira livre, para testar e recentralizar antes de jogar. */
  testAim(): void;
  /** Refazer só o alvo que ficou impreciso. */
  repeatWorst(): void;
  /** Refazer o Estande inteiro. */
  retryAll(): void;
  /** Desistir da calibração e jogar com a mira guiada só pela cabeça. */
  headOnly(): void;
}

/**
 * Resultado do Estande, com botões (olhar + piscar, ou mouse). Existe principalmente para quem
 * NÃO conseguiu calibrar: em vez de uma mensagem de erro sem saída, dá para repetir o pior alvo,
 * refazer tudo ou jogar só com a cabeça.
 */
export class CalibrationResultScene extends ButtonScene {
  private outcome: CalibrationOutcome | null = null;

  constructor(
    config: DebugConfig,
    private readonly hooks: CalibrationResultHooks,
  ) {
    super(config);
  }

  show(outcome: CalibrationOutcome): void {
    this.outcome = outcome;
  }

  private get failed(): boolean {
    return !this.outcome || this.outcome.error !== null || this.outcome.meanResidual === null;
  }

  protected layout(w: number, h: number): UiButton[] {
    const o = this.outcome;
    const items: Omit<UiButton, 'x' | 'y' | 'w' | 'h'>[] = this.failed
      ? [
          { id: 'retry', label: 'Tentar de novo', sub: 'Refazer o Estande inteiro', primary: true, onSelect: () => this.hooks.retryAll() },
          { id: 'head', label: 'Jogar só com a cabeça', sub: 'Sem calibração, mira pela cabeça', onSelect: () => this.hooks.headOnly() },
        ]
      : [
          { id: 'continue', label: 'Continuar', sub: 'Seguir para o jogo', primary: true, onSelect: () => this.hooks.continue() },
          { id: 'test', label: 'Testar a mira', sub: 'Mira livre e recentralizar', onSelect: () => this.hooks.testAim() },
          ...(o?.worstPoint != null
            ? [{ id: 'worst', label: `Repetir o alvo ${o.worstPoint + 1}`, sub: 'Só o alvo impreciso', onSelect: () => this.hooks.repeatWorst() }]
            : []),
          { id: 'retry', label: 'Refazer tudo', sub: 'Estande do começo', onSelect: () => this.hooks.retryAll() },
        ];

    const gap = 14;
    const cols = w >= 760 ? 2 : 1;
    const rows = Math.ceil(items.length / cols);
    const bw = Math.min(330, (w - 48 - gap * (cols - 1)) / cols);
    const bh = 72;
    const x0 = w / 2 - (cols * bw + (cols - 1) * gap) / 2;
    const y0 = h - 40 - rows * bh - (rows - 1) * gap;
    return items.map((it, i) => ({
      ...it,
      x: x0 + (i % cols) * (bw + gap),
      y: y0 + Math.floor(i / cols) * (bh + gap),
      w: bw,
      h: bh,
    }));
  }

  protected drawContent(ctx: CanvasRenderingContext2D, _now: number, w: number, h: number): void {
    const o = this.outcome;
    const top = h * 0.14;
    if (this.failed) {
      drawText(ctx, w / 2, top, 'Não foi possível calibrar', 40, '#fca5a5');
      const lines = [
        'Nenhuma amostra foi aceita. Costuma ser luz fraca, câmera lenta ou a cabeça se mexendo.',
        'Dá para tentar de novo com mais luz no rosto, ou jogar agora mesmo só com a cabeça e calibrar depois pelo menu.',
      ];
      let y = top + 52;
      for (const line of lines.flatMap((l) => wrapText(ctx, l, Math.min(760, w - 48), 17))) {
        drawText(ctx, w / 2, y, line, 17, '#cbd5e1');
        y += 26;
      }
      if (o?.error) drawText(ctx, w / 2, y + 12, o.error, 14, '#64748b');
      return;
    }

    const mean = o!.meanResidual!;
    drawText(ctx, w / 2, top, 'Estande concluído', 40, '#f8fafc');
    drawText(ctx, w / 2, top + 56, `Precisão: ${stars(mean)}`, 36, '#facc15');
    drawText(ctx, w / 2, top + 100, `Erro médio: ${Math.round(mean)} px`, 20, '#cbd5e1');

    let y = top + 140;
    if (o!.worstPoint != null) {
      drawText(ctx, w / 2, y, `O alvo ${o!.worstPoint + 1} ficou impreciso (${Math.round(o!.worstResidual ?? 0)} px)`, 19, '#fca5a5');
      y += 30;
    }
    if (mean > 150) {
      drawText(ctx, w / 2, y, 'Com esse erro a mira fica solta: mais luz e a cabeça parada melhoram bastante', 17, '#fbbf24');
      y += 28;
    }
    if (o!.toleranceLevel > 0) {
      drawText(ctx, w / 2, y, 'A coleta precisou de mais folga, então a precisão pode ter caído', 15, '#94a3b8');
    }
  }
}
