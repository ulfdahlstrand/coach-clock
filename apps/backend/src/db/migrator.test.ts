import { describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, reportMigrationResults } from './migrator.js';

describe('MIGRATIONS_FOLDER', () => {
  it('pekar på mappen bredvid migrator-modulen', () => {
    expect(MIGRATIONS_FOLDER).toMatch(/db[/\\]migrations$/);
  });
});

describe('reportMigrationResults', () => {
  it('säger ifrån när ingenting fanns att köra', () => {
    const lines: string[] = [];

    expect(reportMigrationResults({ results: [] }, (line) => lines.push(line))).toBe(true);
    expect(lines).toEqual(['Inga migrationer att köra — databasen är redan i fas.']);
  });

  it('listar körda migrationer åt båda hållen', () => {
    const lines: string[] = [];

    reportMigrationResults(
      {
        results: [
          { migrationName: '20260920120000_teams', direction: 'Up', status: 'Success' },
          { migrationName: '20260920120001_players', direction: 'Down', status: 'Success' },
        ],
      },
      (line) => lines.push(line),
    );

    expect(lines).toEqual([
      '✓ 20260920120000_teams kördes',
      '✓ 20260920120001_players rullades tillbaka',
    ]);
  });

  it('returnerar false när migreringen felade', () => {
    const lines: string[] = [];
    const resultSet = {
      error: new Error('kolumnen finns redan'),
      results: [
        { migrationName: '20260920120000_teams', direction: 'Up', status: 'Error' } as const,
      ],
    };

    expect(reportMigrationResults(resultSet, (line) => lines.push(line))).toBe(false);
    expect(lines).toEqual(['✗ 20260920120000_teams misslyckades']);
  });
});
