import Link from "next/link";
import { workReturnTo } from "./types";

export function WorkReturnLink({ target }: { target?: unknown }) {
  const href = workReturnTo(target);
  if (!href) return null;
  return (
    <Link className="ghost-button" href={href}>
      ← {href === "/admin" ? "Wróć do pulpitu" : "Wróć do spraw"}
    </Link>
  );
}
