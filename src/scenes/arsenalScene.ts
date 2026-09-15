import type { CareerStore } from '../career/careerStore';
import { UPGRADE_MAX_LEVEL, UPGRADE_NAMES, WEAPONS, type UpgradeKind } from '../game/weapons';
import type { DebugConfig } from '../types';
import { ButtonScene, drawText, roundRect, type UiButton } from './menuScene';

const UPGRADE_KINDS: UpgradeKind[] = ['ammo', 'focus'];

/** Arsenal: comprar armas, equipar e comprar melhorias com penas. */
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
    const cw = Math.min(330, (w - 48 - 16 * (WEAPONS.length - 1)) / WEAPONS.length);
    const total = cw * WEAPONS.length + 16 * (WEAPONS.length - 1);
    const top = h * 0.17;
    return WEAPONS.map((_, i) => ({ x: w / 2 - total / 2 + i * (cw + 16), y: top, w: cw, h: h - top - 110 }));
  }

  protected layout(w: number, h: number): UiButton[] {
    const buttons: UiButton[] = [];
    this.cards(w, h).forEach((c, i) => {
      const weapon = WEAPONS[i];
      const owned = this.career.owns(weapon.id);
      const equipped = this.career.state.equipped === weapon.id;
      const bh = Math.max(40, Math.min(50, (c.h - 150) / 3 - 8));
      const bx = c.x + 12;
      const bw = c.w - 24;
      let by = c.y + c.h - 12 - bh;
      // botões de baixo para cima: equipar/comprar embaixo, melhorias acima
      if (!owned) {
        const affordable = this.career.state.penas >= weapon.price;
        buttons.push({
          id: `buy-${weapon.id}`, x: bx, y: by, w: bw, h: bh,
          label: `Comprar · ${weapon.price} penas`, enabled: affordable, primary: true,
          onSelect: () => {
            if (this.career.buy(weapon.id)) this.flash(`${weapon.name} comprada e equipada!`);
          },
        });
        return;
      }
      buttons.push({
        id: `equip-${weapon.id}`, x: bx, y: by, w: bw, h: bh,
        label: equipped ? 'Equipada' : 'Equipar', enabled: !equipped,
        onSelect: () => this.career.equip(weapon.id),
      });
      for (const kind of [...UPGRADE_KINDS].reverse()) {
        by -= bh + 8;
        const level = this.career.upgradeLevel(weapon.id, kind);
        const price = this.career.upgradePrice(weapon.id, kind);
        buttons.push({
          id: `up-${weapon.id}-${kind}`, x: bx, y: by, w: bw, h: bh,
          label: price === null ? `${UPGRADE_NAMES[kind]} · máx.` : `${UPGRADE_NAMES[kind]} · ${price}`,
          sub: `nível ${level}/${UPGRADE_MAX_LEVEL}`,
          enabled: price !== null && this.career.state.penas >= price,
          onSelect: () => {
            if (this.career.buyUpgrade(weapon.id, kind)) this.flash(`${weapon.name}: ${UPGRADE_NAMES[kind]} nível ${level + 1}`);
          },
        });
      }
    });
    buttons.push({ id: 'back', x: w / 2 - 110, y: h - 84, w: 220, h: 54, label: 'Voltar', onSelect: () => this.returnTo() });
    return buttons;
  }

  private flash(text: string): void {
    this.message = { text, at: performance.now() };
  }

  protected drawContent(ctx: CanvasRenderingContext2D, now: number, w: number, h: number): void {
    drawText(ctx, w / 2, h * 0.06, 'Arsenal', 34, '#f8fafc');
    drawText(ctx, w / 2, h * 0.06 + 32, `${this.career.state.penas} penas`, 18, '#facc15');
    this.cards(w, h).forEach((c, i) => {
      const weapon = WEAPONS[i];
      ctx.save();
      roundRect(ctx, c.x, c.y, c.w, c.h, 12);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fill();
      ctx.strokeStyle = this.career.state.equipped === weapon.id ? '#4ade80' : 'rgba(148, 163, 184, 0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      drawText(ctx, c.x + c.w / 2, c.y + 26, weapon.name, 19, '#f8fafc');
      weapon.description.split(' · ').forEach((p, k) => drawText(ctx, c.x + c.w / 2, c.y + 54 + k * 20, p, 13, '#cbd5e1'));
    });
    if (this.message && now - this.message.at < 2500) drawText(ctx, w / 2, h * 0.17 - 14, this.message.text, 17, '#4ade80');
  }
}
