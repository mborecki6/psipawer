import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth/session";
import { startOnlinePayment } from "@/modules/payments/actions";
import {
  getOnlinePaymentCharge,
  getOnlinePaymentContext,
} from "@/modules/payments/server";
import {
  NewOnlinePaymentView,
  OnlinePaymentPreviewView,
  OnlinePaymentUnavailable,
} from "@/modules/payments/views";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; target?: string }>;
}) {
  await requireSession("client");
  const { kind, target } = await searchParams;
  let context;
  let charge;
  try {
    context = await getOnlinePaymentContext();
    if (kind && target) {
      charge = await getOnlinePaymentCharge(kind, target);
    }
  } catch {
    return (
      <OnlinePaymentUnavailable
        title="Nie udało się odczytać należności"
        copy="Spróbuj ponownie za chwilę. Nie zmieniliśmy rozliczeń."
        error
      />
    );
  }
  const preview = !context.enabled || !context.environment;
  if (
    !charge ||
    !charge.canPay ||
    charge.reviewReason ||
    charge.kind === "package" ||
    charge.dueCents <= 0 ||
    (preview && !charge.onlinePaymentEligible) ||
    (!preview &&
      charge.kind === "registration" &&
      context.walkGate !== "accepted")
  ) {
    return (
      <OnlinePaymentUnavailable
        title={
          preview
            ? "Ta należność nie jest dostępna w podglądzie płatności"
            : "Ta należność nie jest dostępna do płatności BLIK"
        }
        copy="Mogła zostać rozliczona albo wymagać decyzji prowadzącej. W rozliczeniach znajdziesz aktualny stan swoich usług."
      />
    );
  }
  if (!context.enabled || !context.environment) {
    return (
      <OnlinePaymentPreviewView
        charge={charge}
        unresolvedAttempt={context.attempts.find(
          (attempt) =>
            attempt.target_kind === charge.kind &&
            attempt.target_id === charge.id &&
            ["creating", "pending", "uncertain", "requires_review"].includes(
              attempt.status,
            ),
        )}
      />
    );
  }
  return (
    <NewOnlinePaymentView
      charge={charge}
      environment={context.environment}
      requestId={randomUUID()}
      action={startOnlinePayment}
    />
  );
}
