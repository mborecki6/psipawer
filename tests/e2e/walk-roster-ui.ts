import { expect, type Locator } from "@playwright/test";
import { revealFor } from "./details-ui";

export type WalkDecision =
  | "accepted"
  | "waitlisted"
  | "rejected"
  | "pending"
  | "cancelled_on_time"
  | "cancelled_late";
export type WalkAttendance = "pending" | "present" | "absent" | "no_show";

const decisionNames: Record<WalkDecision, RegExp> = {
  accepted: /^Przyjmij:/,
  waitlisted: /^Przenieś do rezerwy:/,
  rejected: /^(?:Nie przyjmuj|Cofnij przyjęcie i odmów):/,
  pending: /^Wróć do decyzji:/,
  cancelled_on_time: /^Rezygnacja bez opłaty:/,
  cancelled_late: /^Rezygnacja płatna:/,
};
const attendanceNames: Record<WalkAttendance, RegExp> = {
  present: /^Był:/,
  no_show: /^Nie był · płatne:/,
  absent: /^Usprawiedliw:/,
  pending: /^Wyczyść oznaczenie:/,
};

/** Prepare the real UI operation without saving, so error tests can inspect it. */
export async function prepareWalkDecision(
  card: Locator,
  status: WalkDecision,
  note = "",
): Promise<Locator> {
  const cancel = card.getByRole("button", {
    name: "Anuluj zmianę",
    exact: true,
  });
  if (await cancel.count()) await cancel.click();

  const choice = card.getByRole("button", {
    name: decisionNames[status],
    includeHidden: true,
  });
  await revealFor(choice);
  if (status === "accepted") {
    const form = card.getByRole("form", { name: /^Przyjęcie:/ });
    const message = form.getByLabel("Wiadomość dla opiekuna (opcjonalna)", {
      exact: true,
    });
    await revealFor(message);
    await message.fill(note);
    return choice;
  }

  await choice.click();
  const form = card.getByRole("form", { name: /^Zmiana zgłoszenia:/ });
  await expect(form.locator('input[name="status"]')).toHaveValue(status);
  await form
    .getByLabel("Wiadomość dla opiekuna (opcjonalna)", { exact: true })
    .fill(note);
  return form.getByRole("button", { name: /^Zapisz zmianę:/ });
}

export async function submitWalkDecision(
  card: Locator,
  status: WalkDecision,
  note = "",
) {
  await (await prepareWalkDecision(card, status, note)).click();
}

/** First ordinary attendance submits directly; all corrections stay explicit. */
export async function prepareWalkAttendance(
  card: Locator,
  value: WalkAttendance,
): Promise<Locator> {
  const choice = card.getByRole("button", {
    name: attendanceNames[value],
    includeHidden: true,
  });
  await revealFor(choice);
  await expect(choice).toBeEnabled();
  if ((await choice.getAttribute("type")) === "submit") return choice;

  await choice.click();
  const form = card.getByRole("form", { name: /^Korekta obecności:/ });
  await expect(form.locator('input[name="attendance"]')).toHaveValue(value);
  return form.getByRole("button", {
    name:
      value === "absent" ? /^Potwierdź usprawiedliwienie:/ : /^Zapisz korektę:/,
  });
}

export async function submitWalkAttendance(
  card: Locator,
  value: WalkAttendance,
) {
  await (await prepareWalkAttendance(card, value)).click();
}
