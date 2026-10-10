import Link from "next/link";
import { careDate } from "@/modules/care/types";
import { followUpStates, type FollowUp } from "./types";
export function ContactCard({
  item,
  admin,
}: {
  item: FollowUp;
  admin: boolean;
}) {
  return (
    <article className="card pad">
      <h3>Kontakt kontrolny</h3>
      <p>
        {followUpStates[item.status]}
        {item.status === "open" && (
          <>
            {" "}
            · <strong>{careDate(item.due_on)}</strong>
          </>
        )}
      </p>
      <p className="muted">
        {admin
          ? "Zadanie dla prowadzącej: skontaktuj się z opiekunem i sprawdź postępy. Termin nie rezerwuje wizyty w kalendarzu."
          : item.status === "open"
            ? "Prowadząca wróci do Waszych postępów. To planowany kontakt, nie rezerwacja wizyty o określonej godzinie."
            : "Aktualny status kontaktu z prowadzącą. Wasze zalecenia i odpowiedzi pozostają poniżej."}
      </p>
      {admin && (
        <Link
          className="ghost-button"
          href={`/admin/work/follow-ups/${item.id}`}
        >
          Obsłuż kontakt i historię →
        </Link>
      )}
    </article>
  );
}
