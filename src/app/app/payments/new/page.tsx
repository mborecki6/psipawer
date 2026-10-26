import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth/session";
import { startOnlinePayment } from "@/modules/payments/actions";
import {
  getOnlinePaymentCharge,
  getOnlinePaymentContext,
} from "@/modules/payments/server";
import {
  NewOnlinePaymentView,
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
    if (context.enabled && kind && target) {
      charge = await getOnlinePaymentCharge(kind, target);
    }
  } catch {
    return (
      <OnlinePaymentUnavailable
        title="Nie udało się odczytać należności"
        copy="Spróbuj ponownie za chwilę. Nie rozpoczęto nowej płatności."
        error
      />
    );
  }
  if (!context.enabled || !context.environment) {
    return (
      <OnlinePaymentUnavailable
        title="Płatności BLIK są wyłączone"
        copy={
          context.notice ||
          "Testowe płatności BLIK nie są skonfigurowane w tym środowisku."
        }
      />
    );
  }
  if (
    !charge ||
    !charge.canPay ||
    charge.reviewReason ||
    charge.kind === "package" ||
    charge.dueCents <= 0 ||
    (charge.kind === "registration" && context.walkGate !== "accepted")
  ) {
    return (
      <OnlinePaymentUnavailable
        title="Ta należność nie jest dostępna do płatności BLIK"
        copy="Mogła zostać rozliczona albo wymagać decyzji prowadzącej. W rozliczeniach znajdziesz aktualny stan swoich usług."
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
