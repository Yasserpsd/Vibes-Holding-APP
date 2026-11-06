/**
 * M168: the profile-completion fields THIS bundle can draw. Every request carries them in `x-app-gate`,
 * and the server lists only these in `profileMissing` — a bundle must never be walled behind a field it
 * cannot show (that locked members out on older bundles when M156 added the job, the real name and the
 * contact e-mail). Add a key here only together with its field in ProfileCompletionGate.
 * M203: `phoneCode` is no field: it tells the server this bundle draws the WhatsApp code step. The bio,
 * interests, member type and company moved to the profile (owner, 2026-11-06).
 * M204: `waCodes` is no field either: this bundle can say that the persona-change and deletion codes went on WhatsApp.
 * M209: `code6` is no field: this bundle's WhatsApp code step takes SIX digits (older bundles are sent four).
 */
export const GATE_FIELDS = ['name', 'phone', 'persona', 'jobTitle', 'contactEmail', 'phoneCode', 'waCodes', 'code6'] as const;

export type GateField = (typeof GATE_FIELDS)[number];
