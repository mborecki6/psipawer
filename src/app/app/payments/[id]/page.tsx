import { requireSession } from "@/lib/auth/session";
import {
  checkOnlinePayment,
  continueOnlinePayment,
  simulateOnlinePayment,
  recoverOnlinePayment,
} from "@/modules/payments/actions";
import {
  getOnlinePaymentAttempt,
  getOnlinePaymentContext,
} from "@/modules/payments/server";
import {
  OnlinePaymentAttemptView,
  OnlinePaymentUnavailable,
} from "@/modules/payments/views";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession("client");
  const { id } = await params;
  let context;
  let attempt;
  try {
    context = await getOnlinePaymentContext();
    attempt = await getOnlinePaymentAttempt(id);
  } catch {
    return (
      <OnlinePaymentUnavailable
        title="Nie udało się odczytać płatności"
        copy="Spróbuj ponownie za chwilę. Nie oznacza to niepowodzenia płatności — sprawdź tę samą próbę przed ponowną zapłatą."
        error
      />
    );
  }
  if (!attempt)
    return (
      <OnlinePaymentUnavailable
        title="Ta próba płatności jest niedostępna"
        copy="W rozliczeniach znajdziesz próby dostępne na Twoim koncie. Nie rozpoczynaj kolejnej płatności, jeśli wynik poprzedniej jest nieustalony."
      />
    );
  return (
    <OnlinePaymentAttemptView
      attempt={attempt}
      controlsEnabled={
        Boolean(context.canProcess) &&
        context.environment === attempt.environment
      }
      canStart={context.enabled}
      recoverAction={recoverOnlinePayment}
      checkAction={checkOnlinePayment}
      continueAction={continueOnlinePayment}
      simulateAction={simulateOnlinePayment}
    />
  );
}
