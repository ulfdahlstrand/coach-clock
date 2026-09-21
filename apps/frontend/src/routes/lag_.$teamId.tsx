import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { ArchiveIcon, SaveIcon, ShieldIcon, UserPlusIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { Player } from '@coach-clock/contracts';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import {
  type CreatePlayerFormValues,
  createPlayerResolver,
  type UpdatePlayerFormValues,
  updatePlayerResolver,
} from '@/lib/team-forms';

function PlayerEditor({ player, teamId }: { player: Player; teamId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const form = useForm<UpdatePlayerFormValues>({
    resolver: updatePlayerResolver,
    values: {
      name: player.name,
      number: player.number,
      isGoalkeeper: player.isGoalkeeper,
      archived: player.archived,
    },
  });
  const update = useMutation({
    mutationFn: (values: UpdatePlayerFormValues) =>
      apiClient.updatePlayer({ teamId, playerId: player.id, ...values }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['players', teamId] }),
  });
  const archived = form.watch('archived');

  return (
    <li className="bg-card rounded-xl border p-4">
      <form
        className="space-y-3"
        onSubmit={(event) => void form.handleSubmit((values) => update.mutate(values))(event)}
      >
        <div className="grid grid-cols-[1fr_5.5rem] gap-3">
          <label className="space-y-1" htmlFor={`player-${player.id}-name`}>
            <span className="text-muted-foreground text-xs font-medium">
              {t('team.playerName')}
            </span>
            <input
              id={`player-${player.id}-name`}
              className="border-input bg-background min-h-touch w-full rounded-md border px-3"
              {...form.register('name')}
            />
          </label>
          <label className="space-y-1" htmlFor={`player-${player.id}-number`}>
            <span className="text-muted-foreground text-xs font-medium">{t('team.number')}</span>
            <input
              id={`player-${player.id}-number`}
              type="number"
              min="1"
              inputMode="numeric"
              className="border-input bg-background min-h-touch w-full rounded-md border px-3"
              value={form.watch('number') ?? ''}
              onChange={(event) =>
                form.setValue(
                  'number',
                  event.target.value === '' ? null : Number(event.target.value),
                  { shouldDirty: true },
                )
              }
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <label className="flex min-h-touch items-center gap-2">
            <input type="checkbox" className="size-5" {...form.register('isGoalkeeper')} />
            <ShieldIcon className="size-4" aria-hidden="true" />
            {t('team.goalkeeper')}
          </label>
          <label className="flex min-h-touch items-center gap-2">
            <input type="checkbox" className="size-5" {...form.register('archived')} />
            {t('team.archived')}
          </label>
        </div>
        {form.formState.errors.name ? (
          <p className="text-destructive text-sm">{form.formState.errors.name.message}</p>
        ) : null}
        {update.error ? (
          <p className="text-destructive text-sm" role="alert">
            {t('team.updateError')}
          </p>
        ) : null}
        <Button
          type="submit"
          variant={archived ? 'outline' : 'secondary'}
          size="lg"
          className="min-h-touch w-full"
          disabled={update.isPending}
        >
          {archived ? <ArchiveIcon aria-hidden="true" /> : <SaveIcon aria-hidden="true" />}
          {archived ? t('team.saveArchived') : t('team.save')}
        </Button>
      </form>
    </li>
  );
}

function TeamPage() {
  const { teamId } = Route.useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const players = useQuery({
    queryKey: ['players', teamId],
    queryFn: () => apiClient.listPlayers({ teamId }),
  });
  const form = useForm<CreatePlayerFormValues>({
    resolver: createPlayerResolver,
    defaultValues: { name: '', number: null, isGoalkeeper: false },
  });
  const create = useMutation({
    mutationFn: (values: CreatePlayerFormValues) => apiClient.createPlayer({ teamId, ...values }),
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ['players', teamId] });
    },
  });
  const active = players.data?.filter((player) => !player.archived) ?? [];
  const archived = players.data?.filter((player) => player.archived) ?? [];

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link to="/lag" className="text-muted-foreground text-sm underline underline-offset-4">
          {t('team.back')}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t('team.heading')}</h1>
        <p className="text-muted-foreground text-sm">{t('team.body')}</p>
      </div>
      <form
        className="bg-card space-y-3 rounded-xl border p-4 shadow-sm"
        onSubmit={(event) => void form.handleSubmit((values) => create.mutate(values))(event)}
      >
        <h2 className="font-semibold">{t('team.addPlayer')}</h2>
        <label className="block space-y-1" htmlFor="new-player-name">
          <span className="text-sm font-medium">{t('team.playerName')}</span>
          <input
            id="new-player-name"
            className="border-input bg-background min-h-touch w-full rounded-md border px-3"
            {...form.register('name')}
          />
        </label>
        <div className="grid grid-cols-[7rem_1fr] items-end gap-3">
          <label className="space-y-1" htmlFor="new-player-number">
            <span className="text-sm font-medium">{t('team.number')}</span>
            <input
              id="new-player-number"
              type="number"
              min="1"
              inputMode="numeric"
              className="border-input bg-background min-h-touch w-full rounded-md border px-3"
              value={form.watch('number') ?? ''}
              onChange={(event) =>
                form.setValue(
                  'number',
                  event.target.value === '' ? null : Number(event.target.value),
                )
              }
            />
          </label>
          <label className="flex min-h-touch items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" {...form.register('isGoalkeeper')} />
            <ShieldIcon className="size-4" aria-hidden="true" />
            {t('team.goalkeeper')}
          </label>
        </div>
        {form.formState.errors.name ? (
          <p className="text-destructive text-sm">{form.formState.errors.name.message}</p>
        ) : null}
        {create.error ? (
          <p className="text-destructive text-sm" role="alert">
            {t('team.createError')}
          </p>
        ) : null}
        <Button type="submit" size="lg" className="min-h-touch w-full" disabled={create.isPending}>
          <UserPlusIcon aria-hidden="true" />
          {t('team.addPlayer')}
        </Button>
      </form>
      {players.isPending ? <p role="status">{t('team.loading')}</p> : null}
      {players.error ? (
        <p className="text-destructive text-sm" role="alert">
          {t('team.loadError')}
        </p>
      ) : null}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t('team.roster', { count: active.length })}</h2>
        <ul className="space-y-3">
          {active.map((player) => (
            <PlayerEditor key={player.id} player={player} teamId={teamId} />
          ))}
        </ul>
      </div>
      {archived.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-muted-foreground text-lg font-semibold">
            {t('team.archivedHeading')}
          </h2>
          <ul className="space-y-3">
            {archived.map((player) => (
              <PlayerEditor key={player.id} player={player} teamId={teamId} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export const Route = createFileRoute('/lag_/$teamId')({ component: TeamPage });
