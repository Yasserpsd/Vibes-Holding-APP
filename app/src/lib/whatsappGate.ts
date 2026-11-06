/**
 * M204 (owner, 2026-11-06: «اللي تعامل جديد اجباري ياكد رقم واتس اب… واحدة واحدة كله يتحول واتس اب»): an account whose
 * number is still unproven (`me.phoneRequired`) keeps using the app as it always did, but a NEW dealing waits for the
 * number: the call is held back here, in one place, and the confirmation popup opens instead. Reading, browsing, the
 * advisor and the store purchase of the membership are never held back.
 */
const NEW_DEALINGS: RegExp[] = [
  /^\/api\/agenda\/[^/]+\/register$/,
  /^\/api\/hq\/visits$/,
  /^\/api\/payments$/,
  /^\/api\/card\/print$/,
  /^\/api\/workshops\/register$/,
  /^\/api\/golden\/offer\/[^/]+\/interest$/,
  /^\/api\/forms\/[^/]+$/,
  /^\/api\/projects\/[^/]+\/unlock$/,
  /^\/api\/affiliate\/apply$/,
];

let required = false;
let open: (() => void) | null = null;

/** Set by the host from the account the server last sent. */
export function setWhatsappRequired(value: boolean): void {
  required = value;
}

export function setWhatsappGateOpener(opener: (() => void) | null): void {
  open = opener;
}

/** True = this call is a new dealing of an account with an unproven number: the popup was opened, do not send it. */
export function whatsappGateHolds(method: string, path: string): boolean {
  if (!required || !open || method !== 'POST' || !NEW_DEALINGS.some((pattern) => pattern.test(path))) return false;
  open();
  return true;
}
