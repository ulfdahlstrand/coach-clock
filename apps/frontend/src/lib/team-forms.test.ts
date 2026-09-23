import { expect, test } from 'vitest';
import { createPlayerFormSchema, createTeamFormSchema, updatePlayerFormSchema } from './team-forms';

test('lagformuläret delar kontraktets krav på ett namn', () => {
  expect(createTeamFormSchema.safeParse({ name: ' F11 Blå ' }).success).toBe(true);
  expect(createTeamFormSchema.safeParse({ name: ' ' }).success).toBe(false);
});

test('ett tomt namn ger ett svenskt meddelande, inte Zods engelska standardtext', () => {
  // Formulären visar meddelandet rakt av, så det måste gå att läsa för en tränare.
  expect(createTeamFormSchema.safeParse({ name: '' }).error?.issues[0]?.message).toBe(
    'Ange ett namn',
  );
});

test('spelarformuläret accepterar frivilligt nummer och målvaktsroll', () => {
  expect(
    createPlayerFormSchema.safeParse({ name: 'Alva', number: null, isGoalkeeper: true }).success,
  ).toBe(true);
  expect(createPlayerFormSchema.safeParse({ name: 'Alva', number: 0 }).success).toBe(false);
});

test('redigering kräver minst ett skrivbart spelarfält', () => {
  expect(updatePlayerFormSchema.safeParse({}).success).toBe(false);
  expect(updatePlayerFormSchema.safeParse({ archived: true }).success).toBe(true);
});
