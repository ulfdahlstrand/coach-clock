import { describe, expect, it } from 'vitest';
import {
  FORMATION_ROLES,
  FORMATIONS,
  formations,
  outfieldSlotCount,
  slotsByRole,
} from './index.js';

const expectedCatalog = [
  { id: '5v5-1-2-1', format: 5, name: '1-2-1' },
  { id: '7v7-2-3-1', format: 7, name: '2-3-1' },
  { id: '7v7-3-2-1', format: 7, name: '3-2-1' },
  { id: '9v9-3-3-2', format: 9, name: '3-3-2' },
  { id: '9v9-3-2-3', format: 9, name: '3-2-3' },
  { id: '11v11-4-4-2', format: 11, name: '4-4-2' },
  { id: '11v11-4-3-3', format: 11, name: '4-3-3' },
] as const;

describe('formationskatalogen', () => {
  it('innehåller exakt formationerna i omfattningen', () => {
    expect(formations.map(({ id, format, name }) => ({ id, format, name }))).toEqual(
      expectedCatalog,
    );
    expect(FORMATIONS).toBe(formations);
  });

  it.each(formations)('$id har en plats per spelare i formatet', (formation) => {
    expect(formation.slots).toHaveLength(formation.format);
    expect(outfieldSlotCount(formation)).toBe(formation.format - 1);
  });

  it.each(formations)('$id har exakt en målvakt', (formation) => {
    expect(formation.slots.filter((slot) => slot.role === 'goalkeeper')).toHaveLength(1);
  });

  it.each(formations)('$id har rollfördelningen som namnet anger', (formation) => {
    const grouped = slotsByRole(formation);

    expect([grouped.defender.length, grouped.midfielder.length, grouped.forward.length]).toEqual(
      formation.name.split('-').map(Number),
    );
  });

  it.each(formations)('$id har unika och namngivna platser', (formation) => {
    const ids = formation.slots.map((slot) => slot.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(formation.slots.every((slot) => slot.id.length > 0 && slot.label.length > 0)).toBe(true);
  });

  it.each(formations)('$id har normaliserade koordinater', (formation) => {
    for (const slot of formation.slots) {
      expect(slot.x).toBeGreaterThanOrEqual(0);
      expect(slot.x).toBeLessThanOrEqual(1);
      expect(slot.y).toBeGreaterThanOrEqual(0);
      expect(slot.y).toBeLessThanOrEqual(1);
    }
  });
});

describe('slotsByRole', () => {
  it.each(formations)('grupperar alla platser i $id utan att tappa ordningen', (formation) => {
    const grouped = slotsByRole(formation);
    const flattened = FORMATION_ROLES.flatMap((role) => grouped[role]);

    expect(Object.keys(grouped)).toEqual(FORMATION_ROLES);
    expect(flattened).toHaveLength(formation.slots.length);

    for (const role of FORMATION_ROLES) {
      expect(grouped[role]).toEqual(formation.slots.filter((slot) => slot.role === role));
    }
  });

  it('returnerar nya listor och inte katalogens ursprungliga slots-lista', () => {
    const formation = formations[0];
    const grouped = slotsByRole(formation);

    expect(grouped.forward).not.toBe(formation.slots);
    expect(grouped.forward).toEqual(formation.slots.filter((slot) => slot.role === 'forward'));
  });
});
