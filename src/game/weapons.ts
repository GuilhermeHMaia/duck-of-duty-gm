import type { DebugConfig } from '../types';

export type WeaponId = 'espingarda' | 'escopeta' | 'rifle';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  description: string;
  /** Cartuchos por pente. */
  ammo: number;
  /** Foco mínimo para o tiro derrubar. A Espingarda usa o slider focusToShoot. */
  focusToShoot(config: DebugConfig): number;
  /** Multiplica a velocidade com que o foco enche (Rifle é mais lento; melhoria "Foco rápido" aumenta). */
  focusFill: number;
  /** 0 = acerta um pato (o grudado ou o mais perto da mira); > 0 = derruba todos neste raio (px). */
  areaRadius: number;
  /** Derruba blindados com tiro normal. */
  piercesArmor: boolean;
  /** Mostra uma lupa de zoom em volta da mira quando ela gruda num alvo. */
  lens: boolean;
  /** Dano no chefe por tiro. */
  bossDamage: number;
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
    focusFill: 1,
    areaRadius: 0,
    piercesArmor: false,
    lens: false,
    bossDamage: 1,
    price: 0,
  },
  {
    id: 'escopeta',
    name: 'Escopeta',
    description: '2 cartuchos · área de 130 px · pede só 25% de foco · não fura blindagem',
    ammo: 2,
    focusToShoot: () => 0.25,
    focusFill: 1,
    areaRadius: 130,
    piercesArmor: false,
    lens: false,
    bossDamage: 1,
    price: 150,
  },
  {
    id: 'rifle',
    name: 'Rifle de Precisão',
    description: '4 cartuchos · foco cheio e lento · atravessa blindagem · lupa de zoom · 2 de dano no chefe',
    ammo: 4,
    focusToShoot: () => 1,
    focusFill: 0.55,
    areaRadius: 0,
    piercesArmor: true,
    lens: true,
    bossDamage: 2,
    price: 300,
  },
];

export function weaponById(id: string): WeaponDef {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
}

// ---------- Melhorias ----------

export type UpgradeKind = 'ammo' | 'focus';
export const UPGRADE_MAX_LEVEL = 2;
export const UPGRADE_PRICES = [100, 200] as const;
export const UPGRADE_NAMES: Record<UpgradeKind, string> = { ammo: '+1 cartucho', focus: 'Foco rápido' };

export interface WeaponUpgrades {
  ammo: number;
  focus: number;
}

/** Arma com as melhorias aplicadas: +1 cartucho por nível; foco enche 25% mais rápido por nível. */
export function applyUpgrades(weapon: WeaponDef, upgrades: WeaponUpgrades | undefined): WeaponDef {
  const up = upgrades ?? { ammo: 0, focus: 0 };
  return { ...weapon, ammo: weapon.ammo + up.ammo, focusFill: weapon.focusFill * (1 + 0.25 * up.focus) };
}
