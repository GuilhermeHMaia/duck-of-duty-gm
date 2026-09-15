import type { DebugConfig } from '../types';
import { ButtonScene, drawText, fitSize, roundRect, wrapText, type UiButton } from './menuScene';

export type WelcomeState = 'intro' | 'loading' | 'error';

const CONTROLS: [string, string][] = [
  ['Mirar', 'olhos + cabeça'],
  ['Atirar', 'fechar os dois olhos por um instante'],
  ['Recarregar', 'fechar só o olho esquerdo'],
  ['Trocar de arma', 'fechar só o olho direito'],
  ['Carregar a Rajada', 'abrir a boca'],
];

/**
 * Tela antes da câmera: boas-vindas na primeira vez (o botão Começar precisa de clique, porque
 * ainda não há rosto para escolher com o olhar), carregamento e erros de câmera com instruções.
 */
export class WelcomeScene extends ButtonScene {
  state: WelcomeState = 'loading';
  private message = '';
  private detail = '';

  constructor(
    config: DebugConfig,
    private readonly onStart: () => void,
  ) {
    super(config);
  }

  showIntro(): void {
    this.state = 'intro';
  }

  showLoading(message: string): void {
    this.state = 'loading';
    this.message = message;
  }

  showError(err: unknown): void {
    this.state = 'error';
    const { message, detail } = describeError(err);
    this.message = message;
    this.detail = detail;
  }

  protected layout(w: number, h: number): UiButton[] {
    if (this.state === 'loading') return [];
    const label = this.state === 'intro' ? 'Começar' : 'Tentar de novo';
    return [{ id: 'start', x: w / 2 - 140, y: h - 120, w: 280, h: 64, label, primary: true, onSelect: this.onStart }];
  }

  protected footerHint(): string | null {
    return this.state === 'loading' ? null : 'Clique no botão para continuar';
  }

  protected drawContent(ctx: CanvasRenderingContext2D, now: number, w: number, h: number): void {
    drawText(ctx, w / 2, h * 0.12, 'DUCK OF DUTY', 56, '#f8fafc');
    drawText(ctx, w / 2, h * 0.12 + 46, 'Caça aos patos controlada pelo seu rosto', 20, '#94a3b8');

    if (this.state === 'loading') {
      const dots = '.'.repeat(1 + (Math.floor(now / 400) % 3));
      drawText(ctx, w / 2, h / 2, `${this.message}${dots}`, 24, '#e2e8f0');
      drawText(ctx, w / 2, h / 2 + 40, 'Se o navegador perguntar, permita o uso da câmera', 16, '#94a3b8');
      return;
    }

    if (this.state === 'error') {
      drawText(ctx, w / 2, h * 0.42, this.message, 28, '#fca5a5');
      this.detail.split('\n').forEach((line, i) => drawText(ctx, w / 2, h * 0.42 + 44 + i * 28, line, 17, '#cbd5e1'));
      return;
    }

    // Intro: controles e privacidade.
    const boxW = Math.min(640, w - 48);
    const boxX = w / 2 - boxW / 2;
    const boxY = h * 0.12 + 90;
    const lineH = 34;
    const boxH = 60 + CONTROLS.length * lineH;
    ctx.save();
    roundRect(ctx, boxX, boxY, boxW, boxH, 14);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.35)';
    ctx.stroke();
    ctx.restore();
    drawText(ctx, w / 2, boxY + 30, 'Como se joga', 20, '#4ade80');
    const split = boxX + boxW * 0.4;
    CONTROLS.forEach(([action, how], i) => {
      const y = boxY + 72 + i * lineH;
      drawText(ctx, split - 8, y, action, fitSize(ctx, action, boxW * 0.4 - 24, 18), '#f8fafc', 'right');
      drawText(ctx, split + 8, y, how, fitSize(ctx, how, boxW * 0.6 - 24, 18), '#cbd5e1', 'left');
    });

    let y = boxY + boxH + 36;
    const lines = [
      'Antes de jogar você calibra a mira no Estande de Treino (cerca de 1 minuto).',
      'Dica: aperte F11 para tela cheia AGORA. Mudar o tamanho da janela depois apaga a calibração.',
      'A imagem da câmera é processada só no seu computador; nada é gravado nem enviado.',
    ];
    for (const line of lines.flatMap((l) => wrapText(ctx, l, Math.min(760, w - 48), 16))) {
      drawText(ctx, w / 2, y, line, 16, '#94a3b8');
      y += 26;
    }
  }
}

function describeError(err: unknown): { message: string; detail: string } {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      message: 'O acesso à câmera foi bloqueado',
      detail: 'Clique no ícone de câmera (ou cadeado) na barra de endereço, permita a câmera\ne depois clique em Tentar de novo.',
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { message: 'Nenhuma câmera encontrada', detail: 'Conecte uma webcam e clique em Tentar de novo.' };
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return {
      message: 'A câmera está ocupada',
      detail: 'Feche outros programas que usam a câmera (Teams, Zoom, OBS, outra aba)\ne clique em Tentar de novo.',
    };
  }
  const text = err instanceof Error ? err.message : String(err);
  return {
    message: 'Não foi possível iniciar',
    detail: `${text}\nConfira a conexão com a internet (o modelo de rosto é baixado na primeira vez).`,
  };
}
