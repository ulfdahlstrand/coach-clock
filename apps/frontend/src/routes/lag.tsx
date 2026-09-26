import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { PlusIcon, UsersIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import { requireSignedIn } from '@/lib/auth';
import { type CreateTeamFormValues, createTeamResolver } from '@/lib/team-forms';

const teamsQueryKey = ['teams'] as const;

function TeamsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const teams = useQuery({ queryKey: teamsQueryKey, queryFn: () => apiClient.listTeams({}) });
  const form = useForm<CreateTeamFormValues>({
    resolver: createTeamResolver,
    defaultValues: { name: '' },
  });
  const createTeam = useMutation({
    mutationFn: (values: CreateTeamFormValues) => apiClient.createTeam(values),
    onSuccess: async (team) => {
      await queryClient.invalidateQueries({ queryKey: teamsQueryKey });
      await navigate({ to: '/lag/$teamId', params: { teamId: team.id } });
    },
  });

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">{t('teams.eyebrow')}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t('teams.heading')}</h1>
        <p className="text-muted-foreground text-sm">{t('teams.body')}</p>
      </div>

      <form
        className="bg-card space-y-3 rounded-xl border p-4 shadow-sm"
        onSubmit={(event) => void form.handleSubmit((values) => createTeam.mutate(values))(event)}
      >
        <label className="block space-y-2" htmlFor="team-name">
          <span className="text-sm font-medium">{t('teams.newTeamLabel')}</span>
          <input
            id="team-name"
            className="border-input bg-background min-h-touch w-full rounded-md border px-3 text-base"
            placeholder={t('teams.newTeamPlaceholder')}
            aria-invalid={Boolean(form.formState.errors.name)}
            {...form.register('name')}
          />
        </label>
        {form.formState.errors.name ? (
          <p className="text-destructive text-sm">{form.formState.errors.name.message}</p>
        ) : null}
        {createTeam.error ? (
          <p className="text-destructive text-sm" role="alert">
            {t('teams.createError')}
          </p>
        ) : null}
        <Button
          type="submit"
          size="lg"
          className="min-h-touch w-full"
          disabled={createTeam.isPending}
        >
          <PlusIcon aria-hidden="true" />
          {t('teams.create')}
        </Button>
      </form>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t('teams.savedHeading')}</h2>
        {teams.isPending ? <p role="status">{t('teams.loading')}</p> : null}
        {teams.error ? (
          <p className="text-destructive text-sm" role="alert">
            {t('teams.loadError')}
          </p>
        ) : null}
        {teams.data?.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('teams.empty')}</p>
        ) : null}
        <ul className="space-y-2">
          {teams.data?.map((team) => (
            <li key={team.id}>
              <Link
                to="/lag/$teamId"
                params={{ teamId: team.id }}
                className="bg-card hover:bg-accent flex min-h-touch items-center justify-between rounded-xl border p-4 transition-colors"
              >
                <span className="font-medium">{team.name}</span>
                <UsersIcon className="text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export const Route = createFileRoute('/lag')({
  // Tränarens sida: kräver inloggning (ADR-001).
  beforeLoad: ({ location }) => requireSignedIn(location),
  component: TeamsPage,
});
