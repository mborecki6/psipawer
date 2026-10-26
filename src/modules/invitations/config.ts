import "server-only";
import { authEmailDelivery } from "../../lib/auth/email-config";

// External invitations require both the verified deployment's Auth configuration
// and a separate sending switch. Preparation never sends a message.
export function invitationDeliveryConfig() {
  if (process.env.CLIENT_INVITATIONS_ENABLED !== "true") return null;
  const delivery = authEmailDelivery();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  return delivery && key
    ? {
        origin: delivery.origin,
        url: delivery.databaseOrigin,
        mode: delivery.mode,
        key,
      }
    : null;
}
