import { sfx } from '../game/sound';
import { applyLevel, FRIENDLY_SETTINGS, isExactLevel, LEVEL_COUNT, levelOf } from '../settings/friendlySettings';
import type { DebugConfig } from '../types';
import { ButtonScene, drawText, fitSize, roundRect, type Nav, type UiButton } from './menuScene';

export interface SettingsHooks {
  /** Um ajuste mudou o config: salvar e atualizar o painel de debug. */
  onChanged(): void;
  /** Voltar tudo aos padrões do jogo. */
  onRestoreDefaults(): void;
}

const MAX_ROW_W = 920;

/**
 * Configurações para quem não conhece o painel de debug: 6 ajustes em 5 níveis cada, com
 * botões − e +. A mira continua visível, então dá para sentir a mudança na hora.
 */
export class SettingsScene extends ButtonScene {
  constructor(
    config: DebugConfig,
    private readonly nav: Nav,
    private readonly hooks: SettingsHooks,
  ) {
    super(config);
  }

  private rows(w: number, h: number) {
    const top = h * 0.06 + 70;
    const bottomReserve = 120;
    const rowH = Math.max(52, Math.min(84, (h - top - bottomReserve) / FRIENDLY_SETTINGS.length));
    const rowW = Math.min(MAX_ROW_W, w - 48);
    const x = w / 2 - rowW / 2;
    return FRIENDLY_SETTINGS.map((setting, i) => ({ setting, x, y: top + i * rowH, w: rowW, h: rowH - 10 }));
  }

  /** Área do indicador de nível dentro da linha (entre os botões − e +). */
  private controlBox(row: { x: number; y: number; w: number; h: number }) {
    const btn = Math.min(52, row.h - 12);
    const indicatorW = Math.min(190, row.w * 0.24);
    const right = row.x + row.w - 12;
    const plusX = right - btn;
    const indicatorX = plusX - 10 - indicatorW;
    const minusX = indicatorX - 10 - btn;
    return { btn, btnY: row.y + (row.h - btn) / 2, minusX, plusX, indicatorX, indicatorW };
  }

  protected layout(w: number, h: number): UiButton[] {
    const buttons: UiButton[] = [];
    for (const row of this.rows(w, h)) {
      const level = levelOf(this.config, row.setting);
      const box = this.controlBox(row);
      const change = (delta: number) => () => {
        applyLevel(this.config, row.setting, levelOf(this.config, row.setting) + delta);
        this.hooks.onChanged();
      };
      buttons.push(
        { id: `${row.setting.id}-minus`, x: box.minusX, y: box.btnY, w: box.btn, h: box.btn, label: '−', enabled: level > 0, onSelect: change(-1) },
        { id: `${row.setting.id}-plus`, x: box.plusX, y: box.btnY, w: box.btn, h: box.btn, label: '+', enabled: level < LEVEL_COUNT - 1, onSelect: change(1) },
      );
    }

    const bottom = [
      { id: 'sound', label: sfx.muted ? 'Som: desligado' : 'Som: ligado', onSelect: () => sfx.toggleMute() },
      { id: 'free', label: 'Testar a mira', onSelect: () => this.nav.freeAim() },
      { id: 'recalibrate', label: 'Recalibrar', onSelect: () => this.nav.recalibrate() },
      { id: 'defaults', label: 'Padrões', onSelect: () => this.hooks.onRestoreDefaults() },
      { id: 'back', label: 'Voltar', primary: true, onSelect: () => this.nav.menu() },
    ];
    const gap = 12;
    const bw = Math.min(180, (Math.min(MAX_ROW_W, w - 48) - gap * (bottom.length - 1)) / bottom.length);
    const x0 = w / 2 - (bw * bottom.length + gap * (bottom.length - 1)) / 2;
    const by = h - 100;
    bottom.forEach((b, i) => buttons.push({ ...b, x: x0 + i * (bw + gap), y: by, w: bw, h: 56 }));
    return buttons;
  }

  protected drawContent(ctx: CanvasRenderingContext2D, _now: number, w: number, h: number): void {
    drawText(ctx, w / 2, h * 0.06, 'Configurações', 36, '#f8fafc');
    drawText(ctx, w / 2, h * 0.06 + 36, 'Os ajustes valem na hora e ficam salvos · painel técnico: tecla D', 15, '#94a3b8');

    for (const row of this.rows(w, h)) {
      const { setting } = row;
      ctx.save();
      roundRect(ctx, row.x, row.y, row.w, row.h, 12);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      const box = this.controlBox(row);
      const textW = box.minusX - row.x - 32;
      drawText(ctx, row.x + 18, row.y + row.h * 0.36, setting.label, fitSize(ctx, setting.label, textW, 19), '#f8fafc', 'left');
      drawText(ctx, row.x + 18, row.y + row.h * 0.72, setting.hint, fitSize(ctx, setting.hint, textW, 14), '#94a3b8', 'left');

      // Indicador: 5 barrinhas e o nome do nível.
      const level = levelOf(this.config, setting);
      const exact = isExactLevel(this.config, setting);
      const pipGap = 6;
      const pipW = (box.indicatorW - pipGap * (LEVEL_COUNT - 1)) / LEVEL_COUNT;
      const pipY = row.y + row.h * 0.22;
      for (let i = 0; i < LEVEL_COUNT; i++) {
        ctx.fillStyle = i <= level ? '#4ade80' : 'rgba(71, 85, 105, 0.7)';
        roundRect(ctx, box.indicatorX + i * (pipW + pipGap), pipY, pipW, 10, 4);
        ctx.fill();
      }
      const name = exact ? setting.levelNames[level] : `≈ ${setting.levelNames[level]} (ajuste fino)`;
      drawText(ctx, box.indicatorX + box.indicatorW / 2, row.y + row.h * 0.66, name, fitSize(ctx, name, box.indicatorW, 16), '#e2e8f0');
    }
  }
}
