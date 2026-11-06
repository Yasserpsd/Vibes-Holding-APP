import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { PhoneConfirmAlert } from '@/components/PhoneConfirmAlert';
import { setWhatsappGateOpener, setWhatsappRequired } from '@/lib/whatsappGate';

/**
 * M204: the popup behind `lib/whatsappGate`. It opens only on the member's own tap on a new dealing (so it is not an
 * automatic popup and takes no M128 slot); after the code the member taps his action again.
 */
export function WhatsappGateHost() {
  const { status, me } = useAuth();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const due = status === 'signedIn' && Boolean(me?.phoneRequired);
  const hasNumber = Boolean(me?.phone?.trim());

  useEffect(() => {
    setWhatsappRequired(due);
    // No number at all: the number field comes first, and saving it there sends the code.
    setWhatsappGateOpener(due ? () => (hasNumber ? setVisible(true) : router.push('/profile-edit?fixPhone=1' as Href)) : null);
    return () => {
      setWhatsappRequired(false);
      setWhatsappGateOpener(null);
    };
  }, [due, hasNumber, router]);

  if (!visible || !due) return null;
  return (
    <PhoneConfirmAlert
      required
      onLater={() => setVisible(false)}
      onDone={() => setVisible(false)}
      onWrongNumber={() => {
        setVisible(false);
        router.push('/profile-edit?fixPhone=1' as Href);
      }}
    />
  );
}
