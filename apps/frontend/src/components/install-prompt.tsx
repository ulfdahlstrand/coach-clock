import { useEffect, useState } from 'react';
import {
  REQUIRED_VISITS_BEFORE_PROMPT,
  canShowInstallPrompt,
  dismissInstallPrompt,
  isAppleMobileBrowser,
  isStandaloneDisplayMode,
  nextVisitCount,
} from '@/lib/install-prompt';
import { Button } from '@/components/ui/button';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isBeforeInstallPromptEvent(event: Event): event is BeforeInstallPromptEvent {
  return 'prompt' in event && 'userChoice' in event;
}

/**
 * A deliberately quiet install nudge. It is withheld on the first visit and
 * never replaces a match action; browsers retain control of the actual prompt.
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent>();
  const [showIosInstructions, setShowIosInstructions] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandaloneDisplayMode(window)) {
      return;
    }

    const visits = nextVisitCount(window.localStorage);
    const canPrompt =
      visits >= REQUIRED_VISITS_BEFORE_PROMPT &&
      canShowInstallPrompt(window.localStorage, Date.now());

    if (!canPrompt) {
      return;
    }

    if (isAppleMobileBrowser(window.navigator)) {
      setShowIosInstructions(true);
      setVisible(true);
      return;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      if (!isBeforeInstallPromptEvent(event)) {
        return;
      }
      event.preventDefault();
      setDeferredPrompt(event);
      setVisible(true);
    };
    const onAppInstalled = () => setVisible(false);

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const dismiss = () => {
    dismissInstallPrompt(window.localStorage, Date.now());
    setVisible(false);
  };

  const install = async () => {
    if (!deferredPrompt) {
      return;
    }
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setVisible(false);
      return;
    }
    dismiss();
  };

  if (!visible) {
    return null;
  }

  return (
    <aside className="install-prompt" aria-label="Installera Coach Clock">
      <div>
        <p className="install-prompt-title">Ha Coach Clock nära till hands</p>
        <p className="install-prompt-copy">
          {showIosInstructions
            ? 'Tryck på Dela och välj Lägg till på hemskärmen.'
            : 'Installera appen för snabbare åtkomst vid sidlinjen.'}
        </p>
      </div>
      <div className="install-prompt-actions">
        {!showIosInstructions ? <Button onClick={() => void install()}>Installera</Button> : null}
        <Button variant="ghost" onClick={dismiss}>
          Inte nu
        </Button>
      </div>
    </aside>
  );
}
