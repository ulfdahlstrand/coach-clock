import { useMutation } from '@tanstack/react-query';
import { useNavigate, createFileRoute } from '@tanstack/react-router';
import { QrCodeIcon, UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import { formatJoinCode, normalizeJoinCode } from '@/lib/sharing';

function JoinPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const code = normalizeJoinCode(token);
  const isCode = code.length === 6 && token.length <= 7;
  const join = useMutation({
    mutationFn: () =>
      apiClient.matches.join(
        isCode
          ? { displayName: displayName.trim(), code }
          : { displayName: displayName.trim(), linkToken: token },
      ),
    onSuccess: (joined) =>
      navigate({ to: '/titta/$token', params: { token }, search: { matchId: joined.matchId } }),
  });

  return (
    <section className="space-y-6 pt-4">
      <div className="bg-primary text-primary-foreground rounded-3xl p-6 shadow-sm">
        <QrCodeIcon aria-hidden="true" className="mb-5 size-7" />
        <p className="text-primary-foreground/75 text-sm font-medium tracking-wide">
          DELADE MATCHEN
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Gå med vid sidlinjen</h1>
        <p className="text-primary-foreground/75 mt-3 text-sm">
          {isCode ? `Kod ${formatJoinCode(code)}` : 'Du har fått en säker matchlänk.'}
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (displayName.trim().length > 0) join.mutate();
        }}
      >
        <label className="block space-y-2">
          <span className="text-sm font-medium">Vad vill du kallas?</span>
          <input
            autoComplete="name"
            autoFocus
            maxLength={100}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Till exempel Alex"
            className="border-input bg-background min-h-touch w-full rounded-xl border px-4 text-base"
          />
        </label>
        {join.error ? (
          <p role="alert" className="text-destructive text-sm">
            Kunde inte gå med. Kontrollera länken eller koden och försök igen.
          </p>
        ) : null}
        <Button
          type="submit"
          size="lg"
          className="min-h-touch w-full rounded-xl"
          disabled={join.isPending || displayName.trim().length === 0}
        >
          <UsersIcon aria-hidden="true" />
          {join.isPending ? 'Går med…' : 'Gå med i matchen'}
        </Button>
      </form>
    </section>
  );
}

export const Route = createFileRoute('/join_/$token')({ component: JoinPage });
