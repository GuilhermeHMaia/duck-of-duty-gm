import type { CareerStore } from '../career/careerStore';
import { WEAPONS } from '../game/weapons';
import type { DebugConfig } from '../types';
import { ButtonScene, drawText, type UiButton } from './menuScene';

/** Arsenal: comprar armas com penas e equipar. */
export class ArsenalScene extends ButtonScene {
  private returnTo: () => void = () => {};
  private message: { text: string; at: number } | null = null;

  constructor(
    config: DebugConfig,
    private readonly career: CareerStore,
  ) {
    super(config);
  }

  show(returnTo: () => void): void {
    this.returnTo = returnTo;
    this.message = null;
  }

  private cards(w: number, h: number): { x: number; y: number; w: number; h: number }[] {
    const cw = Math.min(360, (w - 72) / WEAPONS.length);
    const total = cw * WEAPONS.length + 24 * (WEAPONS.length - 1);
    return WEAPONS.map((_, i) => ({ x: w / 2 - total / 2 + i * (cw + 24), y: h * 0.24, w: cw, h: Math.min(300, h * 0.46) }));
  }

  protected layout(w: number, h: number): UiButton[] {
    const cards = this.cards(w, h);
    const buttons: UiButton[] = WEAPONS.map((weapon, i) => {
      const c = cards[i];
      const owned = this.career.owns(weapon.id);
      const equipped = this.career.state.equipped === weapon.id;
      const base = { id: weapon.id, x: c.x + 16, y: c.y + c.h - 76, w: c.w - 32, h: 60 };
      if (!owned) {
        const affordable = this.career.state.penas >= weapon.price;
        return {
          ...base,
          label: `Comprar · ${weapon.price} penas`,
          sub: affordable ? undefined : 'penas insuficientes',
          enabled: affordable,
          primary: true,
          onSelect: () => {
            if (this.career.buy(weapon.id)) this.message = { text: `${weapon.name} comprada e equipada!`, at: performance.now() };
          },
        };
      }
      return {
        ...base,
        label: equipped ? 'Equipada' : 'Equipar',
        enabled: !equipped,
        onSelect: () => this.career.equip(weapon.id),
      };
    });
    buttons.push({ id: 'back', x: w / 2 - 110, y: h - 104, w: 220, h: 58, label: 'Voltar', onSelect: () => this.returnTo() });
    return buttons;
  }

  protected drawContent(ctx: CanvasRenderingContext2D, now: number, w: number, h: number): void {
    drawText(ctx, w / 2, h * 0.08, 'Arsenal', 40, '#f8fafc');
    drawText(ctx, w / 2, h * 0.08 + 38, `${this.career.state.penas} penas`, 20, '#facc15');
    const cards = this.cards(w, h);
    WEAPONS.forEach((weapon, i) => {
      const c = cards[i];
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = this.career.state.equipped === weapon.id ? '#4ade80' : 'rgba(148, 163, 184, 0.4)';
      ctx.lineWidth = 2;
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.strokeRect(c.x, c.y, c.w, c.h);
      ctx.restore();
      drawText(ctx, c.x + c.w / 2, c.y + 34, weapon.name, 22, '#f8fafc');
      const parts = weapon.description.split(' · ');
      parts.forEach((p, k) => drawText(ctx, c.x + c.w / 2, c.y + 76 + k * 26, p, 15, '#cbd5e1'));
    });
    if (this.message && now - this.message.at < 2500) drawText(ctx, w / 2, h * 0.24 - 26, this.message.text, 20, '#4ade80');
  }
}
