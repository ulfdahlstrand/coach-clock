import { useEffect, useState } from 'react';

/** The app intentionally has one compact layout breakpoint: a phone is 700px or narrower. */
export const PHONE_MEDIA_QUERY = '(max-width: 700px)';

function readPhoneMediaQuery(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(PHONE_MEDIA_QUERY).matches
  );
}

/**
 * Use this only when the information architecture changes (for example, moving
 * navigation from the header to the thumb zone). Layout and visual changes
 * belong in CSS so a resized desktop never gets a stale component tree.
 */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(readPhoneMediaQuery);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(PHONE_MEDIA_QUERY);
    const update = () => setIsPhone(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  return isPhone;
}
