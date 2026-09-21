import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { CheckCircle2Icon, Share2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import { createMatchSummary, formatMatchDuration, roleLabel } from '@/lib/match-summary';

function signedDuration(milliseconds: number): string {
  const prefix = milliseconds > 0 ? '+' : milliseconds < 0 ? '−' : '±';
  return `${prefix}${formatMatchDuration(Math.abs(milliseconds))}`;
}

function SummaryPage() {
  const { matchId } = Route.useParams();
  const match = useQuery({
    queryKey: ['match', matchId],
    queryFn: () => apiClient.matches.get({ matchId }),
  });
  const events = useQuery({
    queryKey: ['match-events', matchId],
    queryFn: () => apiClient.matches.listEvents({ matchId, sinceSeq: 0 }),
  });
  const eventLog = events.data?.map((item) => item.event) ?? [];
  const finishedAt = match.data?.endedAt ?? new Date().toISOString();
  const summary = createMatchSummary(eventLog, new Date(finishedAt));
  const title = match.data ? `Match mot ${match.data.opponent}` : 'Matchsammanfattning';

  return (
    <section className="space-y-5 pb-4">
      <div className="rounded-3xl bg-[oklch(0.97_0.02_95)] p-6 text-center shadow-sm ring-1 ring-black/5">
        <p className="text-xs font-semibold tracking-[0.16em] text-[oklch(0.43_0.07_145)] uppercase">
          Matchklar
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-stone-900">{title}</h1>
        <p className="mt-3 text-5xl font-bold tabular-nums text-stone-900">
          {formatMatchDuration(summary.runningMs)}
        </p>
        <p className="mt-1 text-sm text-stone-600">speltid</p>
      </div>

      {match.isPending || events.isPending ? <p role="status">Bygger sammanfattningen…</p> : null}
      {match.error || events.error ? (
        <p className="text-destructive text-sm" role="alert">
          Kunde inte hämta matchens sammanfattning.
        </p>
      ) : null}

      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <CheckCircle2Icon
            className={
              summary.playerTimeIsBalanced
                ? 'mt-0.5 size-5 text-emerald-600'
                : 'mt-0.5 size-5 text-amber-600'
            }
            aria-hidden="true"
          />
          <div>
            <h2 className="font-semibold text-stone-900">Speltiden stämmer av</h2>
            <p className="mt-1 text-sm text-stone-600">
              {summary.playerTimeIsBalanced
                ? 'Alla spelaminuter motsvarar antalet spelare på planen under matchen.'
                : 'Spelaminuterna avviker från antalet spelare på planen. Kontrollera matchloggen.'}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-stone-500 uppercase">
            Speltid
          </p>
          <h2 className="text-lg font-bold text-stone-900">Alla spelare</h2>
        </div>
        <ol className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          {summary.players.map((player, index) => (
            <li
              key={player.playerId}
              className="border-stone-100 flex gap-3 border-b p-4 last:border-0"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-bold text-stone-600">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate font-semibold text-stone-900">
                    {player.number === null ? '' : `${player.number} · `}
                    {player.name}
                  </p>
                  <p className="shrink-0 font-bold tabular-nums text-stone-900">
                    {formatMatchDuration(player.playedMs)}
                  </p>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
                  <span>Rättvis andel {formatMatchDuration(player.fairShareMs)}</span>
                  <span
                    className={
                      player.differenceMs > 0
                        ? 'font-medium text-amber-700'
                        : 'font-medium text-emerald-700'
                    }
                  >
                    {signedDuration(player.differenceMs)}
                  </span>
                  {player.roles.map((role) => (
                    <span key={role.role}>
                      {roleLabel(role.role)} {formatMatchDuration(role.playedMs)}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-stone-500 uppercase">
            Matchlogg
          </p>
          <h2 className="text-lg font-bold text-stone-900">Perioder och byten</h2>
        </div>
        <ol className="border-stone-200 space-y-3 border-l-2 pl-4">
          {summary.timeline.map((item) => (
            <li key={item.id} className="relative text-sm text-stone-700">
              <span className="absolute top-1.5 -left-[1.35rem] size-2 rounded-full bg-[oklch(0.55_0.12_145)]" />
              <time className="mr-2 font-semibold tabular-nums text-stone-900">
                {new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit' }).format(
                  new Date(item.at),
                )}
              </time>
              {item.label}
            </li>
          ))}
        </ol>
      </div>

      <Button
        className="min-h-touch w-full"
        size="lg"
        onClick={() =>
          void navigator.share?.({
            title,
            text: `${title} · ${formatMatchDuration(summary.runningMs)} speltid`,
          })
        }
      >
        <Share2Icon aria-hidden="true" /> Dela sammanfattning
      </Button>
      <Link
        to="/"
        className="block text-center text-sm text-stone-600 underline underline-offset-4"
      >
        Till startsidan
      </Link>
    </section>
  );
}

export const Route = createFileRoute('/matches_/$matchId/summary')({ component: SummaryPage });
