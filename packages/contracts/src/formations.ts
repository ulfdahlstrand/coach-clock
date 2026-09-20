import type { MatchFormat } from './events.js';

/** Roller som planvyn och speltidsfolden grupperar platser efter. */
export const FORMATION_ROLES = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const;

export type FormationRole = (typeof FORMATION_ROLES)[number];

/** En fast plats på den normaliserade planen. */
export type FormationSlot = {
  readonly id: string;
  readonly label: string;
  readonly role: FormationRole;
  /** Vågrät position: vänster 0, höger 1. */
  readonly x: number;
  /** Lodrät position: motståndarmål 0, eget mål 1. */
  readonly y: number;
};

/** En formation för ett av Svenska Fotbollförbundets ungdomsformat. */
export type Formation = {
  readonly id: string;
  readonly format: MatchFormat;
  readonly name: string;
  readonly slots: readonly FormationSlot[];
};

/**
 * Den fasta formationskatalogen. Koordinaterna är direkt användbara av en
 * planvy och varje rad läses från vänster till höger.
 */
export const formations = [
  {
    id: '5v5-1-2-1',
    format: 5,
    name: '1-2-1',
    slots: [
      { id: 'gk', label: 'MV', role: 'goalkeeper', x: 0.5, y: 0.94 },
      { id: 'cb', label: 'MB', role: 'defender', x: 0.5, y: 0.72 },
      { id: 'lm', label: 'VM', role: 'midfielder', x: 0.28, y: 0.48 },
      { id: 'rm', label: 'HM', role: 'midfielder', x: 0.72, y: 0.48 },
      { id: 'st', label: 'CA', role: 'forward', x: 0.5, y: 0.2 },
    ],
  },
  {
    id: '7v7-2-3-1',
    format: 7,
    name: '2-3-1',
    slots: [
      { id: 'gk', label: 'MV', role: 'goalkeeper', x: 0.5, y: 0.94 },
      { id: 'cb-left', label: 'VMB', role: 'defender', x: 0.32, y: 0.72 },
      { id: 'cb-right', label: 'HMB', role: 'defender', x: 0.68, y: 0.72 },
      { id: 'lm', label: 'VM', role: 'midfielder', x: 0.18, y: 0.48 },
      { id: 'cm', label: 'CM', role: 'midfielder', x: 0.5, y: 0.48 },
      { id: 'rm', label: 'HM', role: 'midfielder', x: 0.82, y: 0.48 },
      { id: 'st', label: 'CA', role: 'forward', x: 0.5, y: 0.2 },
    ],
  },
  {
    id: '7v7-3-2-1',
    format: 7,
    name: '3-2-1',
    slots: [
      { id: 'gk', label: 'MV', role: 'goalkeeper', x: 0.5, y: 0.94 },
      { id: 'lb', label: 'VB', role: 'defender', x: 0.18, y: 0.72 },
      { id: 'cb', label: 'MB', role: 'defender', x: 0.5, y: 0.72 },
      { id: 'rb', label: 'HB', role: 'defender', x: 0.82, y: 0.72 },
      { id: 'cm-left', label: 'VCM', role: 'midfielder', x: 0.35, y: 0.48 },
      { id: 'cm-right', label: 'HCM', role: 'midfielder', x: 0.65, y: 0.48 },
      { id: 'st', label: 'CA', role: 'forward', x: 0.5, y: 0.2 },
    ],
  },
  {
    id: '9v9-3-3-2',
    format: 9,
    name: '3-3-2',
    slots: [
      { id: 'gk', label: 'MV', role: 'goalkeeper', x: 0.5, y: 0.94 },
      { id: 'lb', label: 'VB', role: 'defender', x: 0.18, y: 0.72 },
      { id: 'cb', label: 'MB', role: 'defender', x: 0.5, y: 0.72 },
      { id: 'rb', label: 'HB', role: 'defender', x: 0.82, y: 0.72 },
      { id: 'lm', label: 'VM', role: 'midfielder', x: 0.18, y: 0.48 },
      { id: 'cm', label: 'CM', role: 'midfielder', x: 0.5, y: 0.48 },
      { id: 'rm', label: 'HM', role: 'midfielder', x: 0.82, y: 0.48 },
      { id: 'st-left', label: 'VA', role: 'forward', x: 0.35, y: 0.2 },
      { id: 'st-right', label: 'HA', role: 'forward', x: 0.65, y: 0.2 },
    ],
  },
  {
    id: '9v9-3-2-3',
    format: 9,
    name: '3-2-3',
    slots: [
      { id: 'gk', label: 'MV', role: 'goalkeeper', x: 0.5, y: 0.94 },
      { id: 'lb', label: 'VB', role: 'defender', x: 0.18, y: 0.72 },
      { id: 'cb', label: 'MB', role: 'defender', x: 0.5, y: 0.72 },
      { id: 'rb', label: 'HB', role: 'defender', x: 0.82, y: 0.72 },
      { id: 'cm-left', label: 'VCM', role: 'midfielder', x: 0.35, y: 0.48 },
      { id: 'cm-right', label: 'HCM', role: 'midfielder', x: 0.65, y: 0.48 },
      { id: 'lw', label: 'VA', role: 'forward', x: 0.18, y: 0.2 },
      { id: 'st', label: 'CA', role: 'forward', x: 0.5, y: 0.2 },
      { id: 'rw', label: 'HA', role: 'forward', x: 0.82, y: 0.2 },
    ],
  },
  {
    id: '11v11-4-4-2',
    format: 11,
    name: '4-4-2',
    slots: [
      { id: 'gk', label: 'MV', role: 'goalkeeper', x: 0.5, y: 0.94 },
      { id: 'lb', label: 'VB', role: 'defender', x: 0.12, y: 0.74 },
      { id: 'cb-left', label: 'VMB', role: 'defender', x: 0.37, y: 0.74 },
      { id: 'cb-right', label: 'HMB', role: 'defender', x: 0.63, y: 0.74 },
      { id: 'rb', label: 'HB', role: 'defender', x: 0.88, y: 0.74 },
      { id: 'lm', label: 'VM', role: 'midfielder', x: 0.12, y: 0.48 },
      { id: 'cm-left', label: 'VCM', role: 'midfielder', x: 0.37, y: 0.48 },
      { id: 'cm-right', label: 'HCM', role: 'midfielder', x: 0.63, y: 0.48 },
      { id: 'rm', label: 'HM', role: 'midfielder', x: 0.88, y: 0.48 },
      { id: 'st-left', label: 'VA', role: 'forward', x: 0.38, y: 0.18 },
      { id: 'st-right', label: 'HA', role: 'forward', x: 0.62, y: 0.18 },
    ],
  },
  {
    id: '11v11-4-3-3',
    format: 11,
    name: '4-3-3',
    slots: [
      { id: 'gk', label: 'MV', role: 'goalkeeper', x: 0.5, y: 0.94 },
      { id: 'lb', label: 'VB', role: 'defender', x: 0.12, y: 0.74 },
      { id: 'cb-left', label: 'VMB', role: 'defender', x: 0.37, y: 0.74 },
      { id: 'cb-right', label: 'HMB', role: 'defender', x: 0.63, y: 0.74 },
      { id: 'rb', label: 'HB', role: 'defender', x: 0.88, y: 0.74 },
      { id: 'cm-left', label: 'VCM', role: 'midfielder', x: 0.22, y: 0.48 },
      { id: 'cm', label: 'CM', role: 'midfielder', x: 0.5, y: 0.48 },
      { id: 'cm-right', label: 'HCM', role: 'midfielder', x: 0.78, y: 0.48 },
      { id: 'lw', label: 'VA', role: 'forward', x: 0.16, y: 0.18 },
      { id: 'st', label: 'CA', role: 'forward', x: 0.5, y: 0.18 },
      { id: 'rw', label: 'HA', role: 'forward', x: 0.84, y: 0.18 },
    ],
  },
] as const satisfies readonly Formation[];

/** Alias i samma stil som övriga katalogkonstanter i paketet. */
export const FORMATIONS: readonly Formation[] = formations;

export type FormationId = (typeof formations)[number]['id'];

/** Antalet platser utöver målvakten. */
export function outfieldSlotCount(formation: Formation): number {
  return formation.slots.filter((slot) => slot.role !== 'goalkeeper').length;
}

/** Grupperar platserna per roll och bevarar katalogens ordning inom varje roll. */
export function slotsByRole(
  formation: Formation,
): Readonly<Record<FormationRole, readonly FormationSlot[]>> {
  const grouped: Record<FormationRole, FormationSlot[]> = {
    goalkeeper: [],
    defender: [],
    midfielder: [],
    forward: [],
  };

  for (const slot of formation.slots) grouped[slot.role].push(slot);

  return grouped;
}
