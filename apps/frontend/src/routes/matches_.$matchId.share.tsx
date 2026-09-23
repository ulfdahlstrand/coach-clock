import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { CopyIcon, QrCodeIcon, TimerIcon, UsersIcon } from 'lucide-react';
import { toDataURL } from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import { formatJoinCode, lastSeenLabel, roleLabel } from '@/lib/sharing';

type ShareDetails = { joinCode: string; linkToken: string };
type RefereeLink = { linkToken: string };

function shareStorageKey(matchId: string): string {
  return `coach-clock.share.${matchId}`;
}

function refereeStorageKey(matchId: string): string {
  return `coach-clock.referee.${matchId}`;
}

function loadShare(matchId: string): ShareDetails | undefined {
  const saved = window.sessionStorage.getItem(shareStorageKey(matchId));
  if (saved === null) return undefined;
  try {
    return JSON.parse(saved) as ShareDetails;
  } catch {
    return undefined;
  }
}

function loadRefereeLink(matchId: string): RefereeLink | undefined {
  const saved = window.sessionStorage.getItem(refereeStorageKey(matchId));
  if (saved === null) return undefined;
  try {
    return JSON.parse(saved) as RefereeLink;
  } catch {
    return undefined;
  }
}

function MatchSharePage() {
  const { matchId } = Route.useParams();
  const [createdShare, setCreatedShare] = useState<ShareDetails | undefined>(() =>
    loadShare(matchId),
  );
  const [qrImage, setQrImage] = useState<string | undefined>();
  const [refereeLink, setRefereeLink] = useState<RefereeLink | undefined>(() =>
    loadRefereeLink(matchId),
  );
  const match = useQuery({
    queryKey: ['match', matchId],
    queryFn: () => apiClient.matches.get({ matchId }),
  });
  const participants = useQuery({
    queryKey: ['match-participants', matchId],
    queryFn: () => apiClient.matches.participants({ matchId }),
    refetchInterval: 15_000,
  });
  const createShare = useMutation({
    mutationFn: () => apiClient.matches.share({ matchId }),
    onSuccess: (share) => {
      window.sessionStorage.setItem(shareStorageKey(matchId), JSON.stringify(share));
      setCreatedShare(share);
    },
  });
  const createRefereeLink = useMutation({
    mutationFn: () => apiClient.matches.refereeLink({ matchId }),
    onSuccess: (link) => {
      window.sessionStorage.setItem(refereeStorageKey(matchId), JSON.stringify(link));
      setRefereeLink(link);
    },
  });
  const joinCode = createdShare?.joinCode ?? match.data?.joinCode ?? undefined;
  const shareLink = useMemo(
    () =>
      createdShare === undefined
        ? undefined
        : `${window.location.origin}/titta/${createdShare.linkToken}`,
    [createdShare],
  );

  useEffect(() => {
    if (
      createdShare === undefined &&
      match.data?.joinCode === null &&
      !createShare.isPending &&
      !createShare.isSuccess
    ) {
      createShare.mutate();
    }
  }, [createShare, createdShare, match.data?.joinCode]);

  useEffect(() => {
    if (shareLink === undefined) return;
    void toDataURL(shareLink, { errorCorrectionLevel: 'M', margin: 1, width: 260 }).then(
      setQrImage,
    );
  }, [shareLink]);

  async function copyShareLink(): Promise<void> {
    if (shareLink === undefined) return;
    await navigator.clipboard.writeText(shareLink);
  }

  async function copyRefereeLink(): Promise<void> {
    if (refereeLink === undefined) return;
    await navigator.clipboard.writeText(
      `${window.location.origin}/domare/${refereeLink.linkToken}`,
    );
  }

  return (
    <section className="space-y-6 pb-8">
      <div className="space-y-2">
        {/*
         * Matchen är redan igång när den här sidan visas, så vägen in i den är
         * sidans viktigaste utgång — inte startsidan, som ändå ligger i menyn.
         * Länken här räcker när deltagarlistan gjort sidan lång att scrolla.
         */}
        <Link
          to="/matches/$matchId"
          params={{ matchId }}
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          Till matchen
        </Link>
        <p className="text-muted-foreground text-sm font-medium tracking-wide">DELA MATCH</p>
        <h1 className="text-3xl font-semibold tracking-tight">Bjud in föräldrar</h1>
        <p className="text-muted-foreground text-sm">
          Skanna koden eller skriv in den på en annan telefon. Länken kan bara följa matchen.
        </p>
      </div>

      <div className="bg-primary text-primary-foreground rounded-3xl p-6 text-center shadow-sm">
        <p className="text-primary-foreground/75 text-xs font-medium tracking-[0.16em]">
          ANSLUTNINGSKOD
        </p>
        <output
          aria-label="Anslutningskod"
          className="mt-3 block font-mono text-4xl font-bold tracking-[0.14em]"
        >
          {joinCode === undefined ? '···-···' : formatJoinCode(joinCode)}
        </output>
        <p className="text-primary-foreground/75 mt-3 text-sm">Gäller medan matchen pågår</p>
      </div>

      <div className="bg-card rounded-3xl border p-5 text-center shadow-sm">
        <QrCodeIcon aria-hidden="true" className="text-muted-foreground mx-auto mb-3 size-5" />
        {qrImage === undefined ? (
          <div
            role="status"
            className="bg-muted mx-auto grid size-52 place-items-center rounded-2xl text-sm"
          >
            Skapar QR-kod…
          </div>
        ) : (
          <img
            src={qrImage}
            alt="QR-kod för att följa matchen"
            className="mx-auto size-52 rounded-2xl"
          />
        )}
        {shareLink === undefined ? (
          <p className="text-muted-foreground mt-4 text-sm">
            Öppna den här vyn på den telefon där matchen startades för att visa QR-koden igen.
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-touch mt-4 w-full rounded-xl"
            onClick={() => void copyShareLink()}
          >
            <CopyIcon aria-hidden="true" /> Kopiera länk
          </Button>
        )}
      </div>

      <div className="bg-card rounded-3xl border p-5">
        <p className="text-muted-foreground text-xs font-medium tracking-[0.16em]">DOMARE</p>
        <h2 className="mt-2 text-lg font-semibold">Separat domarlänk</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Ger bara tillgång till period- och klockkontroller, aldrig byten eller trupp.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="secondary"
            className="min-h-touch rounded-xl"
            disabled={createRefereeLink.isPending}
            onClick={() => createRefereeLink.mutate()}
          >
            {refereeLink === undefined ? 'Skapa länk' : 'Rotera länk'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-touch rounded-xl"
            disabled={refereeLink === undefined}
            onClick={() => void copyRefereeLink()}
          >
            <CopyIcon aria-hidden="true" /> Kopiera
          </Button>
        </div>
        {createRefereeLink.error ? (
          <p role="alert" className="text-destructive mt-3 text-sm">
            Bara matchägaren kan skapa en domarlänk.
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <UsersIcon aria-hidden="true" className="size-5" /> Deltagare
          </h2>
          <span className="text-muted-foreground text-sm">
            {participants.data?.length ?? 0} med
          </span>
        </div>
        {participants.isPending ? (
          <p role="status" className="text-muted-foreground text-sm">
            Hämtar deltagare…
          </p>
        ) : null}
        {participants.error ? (
          <p role="alert" className="text-muted-foreground text-sm">
            Gå med i matchen för att se deltagarlistan.
          </p>
        ) : null}
        <ul className="space-y-2" aria-label="Deltagare i matchen">
          {participants.data?.map((participant) => (
            <li
              key={participant.id}
              className="bg-card flex min-h-touch items-center justify-between rounded-xl border px-4 py-3"
            >
              <div>
                <p className="font-medium">{participant.displayName}</p>
                <p className="text-muted-foreground text-sm">{roleLabel(participant.role)}</p>
              </div>
              <time dateTime={participant.lastSeenAt} className="text-muted-foreground text-xs">
                {lastSeenLabel(participant.lastSeenAt)}
              </time>
            </li>
          ))}
        </ul>
      </div>

      {/* Delningen är ett sidospår — det här är vad tränaren ska göra härnäst. */}
      <Button asChild size="lg" className="min-h-touch w-full rounded-xl text-base">
        <Link to="/matches/$matchId" params={{ matchId }}>
          <TimerIcon aria-hidden="true" />
          Till matchen
        </Link>
      </Button>
    </section>
  );
}

export const Route = createFileRoute('/matches_/$matchId/share')({ component: MatchSharePage });
