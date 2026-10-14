import { MessageCircle } from "lucide-react";
import styles from "./whatsapp-contact.module.css";

// Contact supplied by the owner in Psi Pawer.vcf. A click opens WhatsApp;
// the app does not send a message or attach any account details.
export const psiPawerWhatsAppUrl = "https://wa.me/48695351796";

export function WhatsAppContact() {
  return (
    <a
      className={styles.contact}
      href={psiPawerWhatsAppUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Napisz do Psi Pawer na WhatsApp (otwiera nową kartę)"
    >
      <MessageCircle aria-hidden="true" />
      <span>WhatsApp</span>
    </a>
  );
}
