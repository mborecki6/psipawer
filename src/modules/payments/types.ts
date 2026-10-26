export type OnlinePaymentKind =
  "registration" | "consultation" | "course" | "fitness";
export type OnlinePaymentEnvironment = "sandbox" | "simulator" | "live";
export type OnlinePaymentStatus =
  "creating" | "pending" | "uncertain" | "failed" | "paid" | "requires_review";

/** A durable local-test attempt. Guardian/dog/amount are immutable DB snapshots. */
export type OnlinePaymentAttempt = {
  id: string;
  request_id: string;
  target_kind: OnlinePaymentKind;
  target_id: string;
  guardian_id: string;
  dog_id: string;
  dog_name?: string | null;
  guardian_name?: string | null;
  service_name?: string | null;
  service_at?: string | null;
  amount_cents: number;
  currency: "PLN";
  environment: OnlinePaymentEnvironment;
  status: OnlinePaymentStatus;
  transaction_id: string | null;
  transaction_title: string | null;
  merchant_id: string | null;
  checkout_url: string | null;
  payment_id: string | null;
  confirmed_amount_cents: number | null;
  confirmed_at: string | null;
  review_reason: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

/** Server-only start: identity/environment are trusted; expected money is comparison only. */
export type BeginOnlinePaymentResult = {
  attempt: OnlinePaymentAttempt;
  created: boolean;
};

/** Only the server may call bind_online_payment and record_online_payment_outcome. */
export type OnlinePaymentOutcome =
  "pending" | "uncertain" | "failed" | "paid" | "chargeback";

export type OnlinePaymentReviewReason =
  | "owner_changed"
  | "no_longer_payable"
  | "balance_changed"
  | "unbound_transaction"
  | "amount_mismatch"
  | "chargeback";
