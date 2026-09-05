import Link from "next/link";
import { PawPrint, ArrowUpRight, CalendarDays } from "lucide-react";
import { dateLabel, labels, money } from "@/lib/domain";
import type { Walk } from "@/lib/data/types";
export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`badge ${["accepted", "approved", "open", "paid", "present"].includes(status) ? "green" : ["pending", "needs_review", "waitlisted", "due"].includes(status) ? "amber" : ["rejected", "suspended", "not_eligible"].includes(status) ? "red" : "neutral"}`}
    >
      {labels[status] || status}
    </span>
  );
}
export function Empty({
  title,
  copy,
  href,
  action,
}: {
  title: string;
  copy: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty-state">
      <PawPrint size={34} />
      <h3>{title}</h3>
      <p>{copy}</p>
      {href && (
        <Link className="primary-button" href={href}>
          {action}
        </Link>
      )}
    </div>
  );
}
export function Kpi({
  label,
  value,
  copy,
  href,
  icon,
}: {
  label: string;
  value: string | number;
  copy: string;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Link className="card kpi-card kpi-card--clickable" href={href}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon">{icon}</span>
      </div>
      <strong className="kpi-value">{value}</strong>
      <span className="kpi-note">{copy}</span>
      <span className="kpi-link">
        Otwórz <ArrowUpRight size={16} />
      </span>
    </Link>
  );
}
export function WalkRow({
  walk,
  base,
  accepted,
  pending,
}: {
  walk: Walk;
  base: string;
  accepted?: number;
  pending?: number;
}) {
  const date = new Date(walk.starts_at);
  return (
    <Link className="list-row" href={`${base}/walks/${walk.id}`}>
      <div className="date-tile">
        <b>
          {new Intl.DateTimeFormat("pl-PL", {
            timeZone: "Europe/Warsaw",
            day: "numeric",
          }).format(date)}
        </b>
        <span>
          {new Intl.DateTimeFormat("pl-PL", {
            timeZone: "Europe/Warsaw",
            month: "short",
          }).format(date)}
        </span>
      </div>
      <div className="list-main">
        <strong>{walk.public_location}</strong>
        <span>
          {dateLabel(walk.starts_at)} · {walk.type}
          {pending ? ` · ${pending} do decyzji` : ""}
        </span>
      </div>
      <span className="small-button">
        {accepted === undefined
          ? money(walk.price_cents)
          : `${accepted}/${walk.capacity}`}{" "}
        <CalendarDays size={14} />
      </span>
    </Link>
  );
}
