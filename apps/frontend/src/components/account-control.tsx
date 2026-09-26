import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { LogInIcon, LogOutIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { logout, meQueryOptions } from '@/lib/auth';

const itemClass =
  'text-muted-foreground hover:text-foreground flex min-h-touch items-center gap-2 rounded-xl px-3 text-sm font-medium';

/**
 * Inloggad tränare eller en inloggningslänk. Visar ingenting medan svaret är
 * okänt (laddar, eller offline) — hellre tomt än fel.
 */
export function AccountControl() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useQuery(meQueryOptions);
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => navigate({ to: '/' }),
  });

  if (me.data === undefined) return null;

  if (me.data.user === null) {
    return (
      <Link to="/logga-in" className={itemClass}>
        <LogInIcon className="size-4" aria-hidden="true" />
        {t('nav.signIn')}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={itemClass}
      title={t('nav.signedInAs', { name: me.data.user.name })}
      disabled={signOut.isPending}
      onClick={() => signOut.mutate()}
    >
      <LogOutIcon className="size-4" aria-hidden="true" />
      {t('nav.signOut')}
    </button>
  );
}
