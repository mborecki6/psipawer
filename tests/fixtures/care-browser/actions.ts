// Browser-only fixtures. Never imported by a production route.
// Database authorization and the real Server Actions have separate tests.
type FixtureWindow = Window & {
  careCalls?: Record<string, unknown>[];
  careFail?: boolean;
};
async function record(kind: string, form: FormData) {
  const host = window as FixtureWindow;
  const payload = Object.fromEntries(form);
  host.careCalls ||= [];
  host.careCalls.push({ kind, ...payload });
  if (host.careFail)
    return {
      error: "Nie udało się zapisać zmian. Twoja treść pozostaje w formularzu.",
    };
  return {
    success: "Zapisano w lokalnym teście.",
    version: Number(payload.expected_version || 0) + 1,
  };
}
export async function savePlan(_: unknown, form: FormData) {
  return record("plan", form);
}
export async function saveTemplate(_: unknown, form: FormData) {
  return record("template", form);
}
export async function submitProgress(_: unknown, form: FormData) {
  return record("progress", form);
}
export async function reviewProgress(_: unknown, form: FormData) {
  return record("review", form);
}
export async function signOut() {}
