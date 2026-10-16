"use client";

import { unstable_rethrow } from "next/navigation";
import type { ActionState } from "./action-form";

export const unconfirmedFormMessage =
  "Nie udało się potwierdzić zapisu. Twoje wpisy pozostają w formularzu. Sprawdź aktualny stan przed ponowieniem.";

type RecoverableState = ActionState & { version?: number };
type RecoverableAction = (
  previous: RecoverableState,
  data: FormData,
) => Promise<RecoverableState>;

export function withFormActionRecovery(
  action: RecoverableAction,
  failureMessage = unconfirmedFormMessage,
): RecoverableAction {
  return async (previous, data) => {
    try {
      return await action(previous, data);
    } catch (error) {
      // Redirects and auth/navigation interrupts still belong to Next.js.
      unstable_rethrow(error);
      // A lost response may follow a committed write. Keep the draft's version,
      // but never carry a previous success or calendar override into this error.
      return {
        error: failureMessage,
        ...(previous.version === undefined
          ? {}
          : { version: previous.version }),
      };
    }
  };
}
