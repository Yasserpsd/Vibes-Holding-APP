/**
 * M168: the profile-completion fields THIS bundle can draw. Every request carries them in `x-app-gate`,
 * and the server lists only these in `profileMissing` — a bundle must never be walled behind a field it
 * cannot show (that locked members out on older bundles when M156 added the job, the real name and the
 * contact e-mail). Add a key here only together with its field in ProfileCompletionGate.
 */
export const GATE_FIELDS = ['name', 'memberType', 'phone', 'persona', 'bio', 'jobTitle', 'interests', 'company', 'contactEmail'] as const;

export type GateField = (typeof GATE_FIELDS)[number];
