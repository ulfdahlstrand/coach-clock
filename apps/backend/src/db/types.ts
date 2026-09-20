/**
 * Handskrivna tabelltyper — ingen kodgenerering.
 *
 * Konventionen är att databasen får behålla sitt snake_case hela vägen in i
 * `Database`-interfacet, och att varje tabell har en `toX(row)`-funktion som
 * översätter till camelCase för resten av koden. Översättningen sker på ett
 * ställe, så ingen rad snake_case läcker ut i domänen:
 *
 * ```ts
 * export interface TeamTable {
 *   id: Generated<string>;
 *   name: string;
 *   created_at: Generated<Date>;
 * }
 *
 * export interface Team {
 *   id: string;
 *   name: string;
 *   createdAt: Date;
 * }
 *
 * export function toTeam(row: Selectable<TeamTable>): Team {
 *   return { id: row.id, name: row.name, createdAt: row.created_at };
 * }
 * ```
 *
 * Tabellerna själva landar i #12 tillsammans med migrationerna för matchdomänen.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- tabeller kommer i #12
export interface Database {}
