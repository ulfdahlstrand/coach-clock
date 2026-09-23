import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { PlayIcon } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import {
  DEFAULT_IDEAL_SHIFT_SECONDS,
  FORMATIONS,
  type Formation,
  type MatchFormat,
} from '@coach-clock/contracts';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import {
  type CreateMatchFormValues,
  createMatchResolver,
  loadMatchSetupDefaults,
  saveMatchSetupDefaults,
} from '@/lib/match-forms';

const initial: CreateMatchFormValues = {
  teamId: '',
  opponent: '',
  format: 7,
  formationId: '7v7-2-3-1',
  periodCount: 3,
  periodLengthSeconds: 900,
  idealShiftSeconds: DEFAULT_IDEAL_SHIFT_SECONDS,
  presentPlayerIds: [],
  assignments: [],
};

function formationsFor(format: MatchFormat): readonly Formation[] {
  return FORMATIONS.filter((formation) => formation.format === format);
}

function assignFirstPlayers(formation: Formation, playerIds: readonly string[]) {
  return formation.slots.map((slot, index) => ({
    slotId: slot.id,
    playerId: playerIds[index] ?? '',
  }));
}

function MatchSetupPage() {
  const navigate = useNavigate();
  const form = useForm<CreateMatchFormValues>({
    resolver: createMatchResolver,
    defaultValues: initial,
  });
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => apiClient.listTeams({}) });
  const teamId = form.watch('teamId');
  const format = form.watch('format');
  const formationId = form.watch('formationId');
  const presentPlayerIds = form.watch('presentPlayerIds');
  const assignments = form.watch('assignments');
  const players = useQuery({
    queryKey: ['players', teamId],
    queryFn: () => apiClient.listPlayers({ teamId }),
    enabled: teamId.length > 0,
  });
  const activePlayers = useMemo(
    () => players.data?.filter((player) => !player.archived) ?? [],
    [players.data],
  );
  const formation =
    FORMATIONS.find((candidate) => candidate.id === formationId) ?? formationsFor(format)[0];
  const create = useMutation({
    mutationFn: (values: CreateMatchFormValues) => apiClient.matches.create(values),
    onSuccess: async (match, values) => {
      saveMatchSetupDefaults(values.teamId, values);
      await navigate({ to: '/matches/$matchId/share', params: { matchId: match.id } });
    },
  });

  useEffect(() => {
    if (teams.data !== undefined && teamId === '' && teams.data[0] !== undefined) {
      const selected = teams.data[0];
      const defaults = loadMatchSetupDefaults(selected.id);
      form.reset({ ...initial, teamId: selected.id, ...defaults });
    }
  }, [form, teamId, teams.data]);

  useEffect(() => {
    if (players.data === undefined) return;
    const ids = activePlayers.map((player) => player.id);
    form.setValue('presentPlayerIds', ids);
    const selectedFormation = FORMATIONS.find(
      (candidate) => candidate.id === form.getValues('formationId'),
    );
    if (selectedFormation !== undefined)
      form.setValue('assignments', assignFirstPlayers(selectedFormation, ids));
  }, [activePlayers, form, players.data]);

  function chooseTeam(nextTeamId: string): void {
    const defaults = loadMatchSetupDefaults(nextTeamId);
    form.reset({ ...initial, teamId: nextTeamId, ...defaults });
  }

  function chooseFormat(nextFormat: MatchFormat): void {
    const nextFormation = formationsFor(nextFormat)[0];
    if (nextFormation === undefined) return;
    form.setValue('format', nextFormat);
    form.setValue('formationId', nextFormation.id);
    form.setValue('assignments', assignFirstPlayers(nextFormation, presentPlayerIds));
  }

  function togglePresent(id: string): void {
    const next = presentPlayerIds.includes(id)
      ? presentPlayerIds.filter((playerId) => playerId !== id)
      : [...presentPlayerIds, id];
    form.setValue('presentPlayerIds', next, { shouldValidate: true });
    if (formation !== undefined) {
      const kept = assignments.map((assignment) =>
        next.includes(assignment.playerId) ? assignment : { ...assignment, playerId: '' },
      );
      form.setValue('assignments', kept, { shouldValidate: true });
    }
  }

  return (
    <section className="space-y-6 pb-8">
      <div className="space-y-2">
        <Link to="/lag" className="text-muted-foreground text-sm underline underline-offset-4">
          Till lag
        </Link>
        <p className="text-muted-foreground text-sm">MATCHSTART</p>
        <h1 className="text-3xl font-semibold tracking-tight">Ny match</h1>
        <p className="text-muted-foreground text-sm">Ställ upp laget, sedan är ni igång.</p>
      </div>
      <form
        className="space-y-6"
        onSubmit={(event) => void form.handleSubmit((values) => create.mutate(values))(event)}
      >
        <div className="bg-card space-y-4 rounded-2xl border p-4 shadow-sm">
          <label className="block space-y-2">
            <span className="text-sm font-medium">Lag</span>
            <select
              aria-label="Lag"
              className="border-input bg-background min-h-touch w-full rounded-lg border px-3"
              value={teamId}
              onChange={(event) => chooseTeam(event.target.value)}
            >
              <option value="">Välj lag</option>
              {teams.data?.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Motståndare</span>
            <input
              className="border-input bg-background min-h-touch w-full rounded-lg border px-3"
              placeholder="Till exempel Grön IF"
              {...form.register('opponent')}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-2">
              <span className="text-sm font-medium">Format</span>
              <select
                aria-label="Format"
                className="border-input bg-background min-h-touch w-full rounded-lg border px-3"
                value={format}
                onChange={(event) => chooseFormat(Number(event.target.value) as MatchFormat)}
              >
                {[5, 7, 9, 11].map((value) => (
                  <option key={value} value={value}>
                    {value} mot {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium">Formation</span>
              <select
                aria-label="Formation"
                className="border-input bg-background min-h-touch w-full rounded-lg border px-3"
                {...form.register('formationId')}
                onChange={(event) => {
                  form.setValue('formationId', event.target.value);
                  const next = FORMATIONS.find((item) => item.id === event.target.value);
                  if (next !== undefined)
                    form.setValue('assignments', assignFirstPlayers(next, presentPlayerIds));
                }}
              >
                {formationsFor(format).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-2">
              <span className="text-sm font-medium">Perioder</span>
              <input
                type="number"
                min="1"
                max="10"
                className="border-input bg-background min-h-touch w-full rounded-lg border px-3"
                {...form.register('periodCount', { valueAsNumber: true })}
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium">Minuter/period</span>
              <input
                type="number"
                min="1"
                max="120"
                className="border-input bg-background min-h-touch w-full rounded-lg border px-3"
                value={Math.round((form.watch('periodLengthSeconds') || 0) / 60)}
                onChange={(event) =>
                  form.setValue('periodLengthSeconds', Number(event.target.value) * 60, {
                    shouldValidate: true,
                  })
                }
              />
            </label>
          </div>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Bytestid</span>
            <select
              aria-label="Bytestid"
              className="border-input bg-background min-h-touch w-full rounded-lg border px-3"
              value={form.watch('idealShiftSeconds') ?? DEFAULT_IDEAL_SHIFT_SECONDS}
              onChange={(event) =>
                form.setValue('idealShiftSeconds', Number(event.target.value), {
                  shouldValidate: true,
                })
              }
            >
              {[3, 4, 5, 6].map((minutes) => (
                <option key={minutes} value={minutes * 60}>
                  {minutes} minuter
                </option>
              ))}
            </select>
            <span className="text-muted-foreground block text-xs">
              Hur länge en spelare är inne innan appen föreslår byte. Du kan alltid byta tidigare.
            </span>
          </label>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Närvarande</h2>
            <span className="text-muted-foreground text-sm">{presentPlayerIds.length} spelare</span>
          </div>
          {players.isPending ? <p role="status">Hämtar trupp…</p> : null}
          <div className="grid grid-cols-2 gap-2">
            {activePlayers.map((player) => (
              <label
                key={player.id}
                className="bg-card flex min-h-touch items-center gap-3 rounded-xl border px-3 py-2"
              >
                <input
                  type="checkbox"
                  className="size-5"
                  checked={presentPlayerIds.includes(player.id)}
                  onChange={() => togglePresent(player.id)}
                />
                <span className="min-w-0 font-medium">
                  {player.number !== null ? `${player.number} · ` : ''}
                  {player.name}
                </span>
                {player.isGoalkeeper ? (
                  <span className="text-muted-foreground ml-auto text-xs">MV</span>
                ) : null}
              </label>
            ))}
          </div>
        </div>
        {formation !== undefined ? (
          <div className="bg-card space-y-4 rounded-2xl border p-4">
            <div>
              <h2 className="text-lg font-semibold">Startuppställning</h2>
              <p className="text-muted-foreground text-sm">
                Välj spelare för varje plats. Övriga hamnar på bänken.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {formation.slots.map((slot, index) => (
                <label key={slot.id} className="space-y-1">
                  <span className="text-muted-foreground text-xs font-medium">{slot.label}</span>
                  <select
                    aria-label={slot.label}
                    className="border-input bg-background min-h-touch w-full rounded-lg border px-3"
                    value={assignments[index]?.playerId ?? ''}
                    onChange={(event) => {
                      const next = assignFirstPlayers(formation, []);
                      formation.slots.forEach((_, current) => {
                        const assignment = assignments[current];
                        const fallback = next[current];
                        if (assignment !== undefined && fallback !== undefined)
                          next[current] = assignment;
                      });
                      next[index] = { slotId: slot.id, playerId: event.target.value };
                      form.setValue('assignments', next, { shouldValidate: true });
                    }}
                  >
                    {presentPlayerIds.map((id) => {
                      const player = activePlayers.find((candidate) => candidate.id === id);
                      return player === undefined ? null : (
                        <option key={id} value={id}>
                          {player.name}
                        </option>
                      );
                    })}
                  </select>
                </label>
              ))}
            </div>
          </div>
        ) : null}
        {form.formState.errors.opponent ? (
          <p className="text-destructive text-sm">{form.formState.errors.opponent.message}</p>
        ) : null}
        {form.formState.errors.assignments ? (
          <p className="text-destructive text-sm">Fyll alla platser med olika spelare.</p>
        ) : null}
        {create.error ? (
          <p role="alert" className="text-destructive text-sm">
            Kunde inte starta matchen. Kontrollera uppställningen och försök igen.
          </p>
        ) : null}
        {create.data ? (
          <p role="status" className="rounded-xl bg-secondary p-3 text-sm">
            Matchen mot {create.data.opponent} är igång.
          </p>
        ) : null}
        <Button
          type="submit"
          size="lg"
          className="min-h-touch w-full rounded-xl text-base"
          disabled={create.isPending || presentPlayerIds.length < (formation?.slots.length ?? 1)}
        >
          <PlayIcon aria-hidden="true" />
          {create.isPending ? 'Startar…' : 'Starta match'}
        </Button>
      </form>
    </section>
  );
}

export const Route = createFileRoute('/matches/new')({ component: MatchSetupPage });
