/**
 * The member's numeric id may reach AppsFlyer only once tracking is allowed and the SDK is about to
 * start. Refused, undecided or unknown consent sends nothing; events and installs are not gated here.
 * Pure on purpose, so the consent paths can be tested without the native SDK.
 */
export type CustomerIdGate = {
  setConsent(allowed: boolean): void;
  markReady(): void;
  setCustomerId(id: string): void;
};

export function createCustomerIdGate(send: (id: string) => void): CustomerIdGate {
  let consent: boolean | null = null;
  let ready = false;
  let pending: string | null = null;
  let sent: string | null = null;

  const flush = () => {
    if (consent !== true || !ready || pending === null || pending === sent) return;
    sent = pending;
    send(pending);
  };

  return {
    setConsent(allowed) {
      consent = allowed;
      flush();
    },
    markReady() {
      ready = true;
      flush();
    },
    setCustomerId(id) {
      pending = id;
      flush();
    },
  };
}
