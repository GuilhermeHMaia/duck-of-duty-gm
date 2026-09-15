import type { DebugConfig } from '../types';

export type WeaponId = 'espingarda' | 'escopeta';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  description: string;
  /** Cartuchos por pente. */
  ammo: number;
  /** Foco mínimo para o tiro derrubar. A Espingarda usa o slider focusToShoot. */
  focusToShoot(config: DebugConfig): number;
  /** 0 = acerta um pato (o grudado ou o mais perto da mira); > 0 = derruba todos neste raio (px). */
  areaRadius: number;
  /** Preço em penas (0 = arma inicial). */
  price: number;
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'espingarda',
    name: 'Espingarda do Vovô',
    description: '3 cartuchos · um pato por tiro · pede foco de 60%',
    ammo: 3,
    focusToShoot: (config) => config.focusToShoot,
    areaRadius: 0,
    price: 0,
  },
  {
    id: 'escopeta',
    name: 'Escopeta',
    description: '2 cartuchos · derruba todos numa área de 130 px · pede só 25% de foco · não fura blindagem',
    ammo: 2,
    focusToShoot: () => 0.25,
    areaRadius: 130,
    price: 150,
  },
];

export function weaponById(id: string): WeaponDef {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
}
