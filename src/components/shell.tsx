"use client";
import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  PawPrint,
  LayoutDashboard,
  CalendarDays,
  Dog,
  Wallet,
  Heart,
  LogOut,
  Menu,
  X,
  Plus,
  Network,
} from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import type { Role } from "@/lib/auth/session";
export function Shell({
  role,
  name,
  children,
}: {
  role: Role;
  name: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const router = useRouter();
  const base = role === "admin" ? "/admin" : "/app";
  const nav = [
    {
      href: base,
      label: role === "admin" ? "Pulpit" : "Mój start",
      icon: LayoutDashboard,
    },
    { href: `${base}/walks`, label: "Spacery", icon: CalendarDays },
    {
      href: `${base}/dogs`,
      label: role === "admin" ? "Psy i opiekunowie" : "Moje psy",
      icon: Dog,
    },
    ...(role === "admin"
      ? [{ href: "/admin/relations", label: "Relacje psów", icon: Network }]
      : []),
    {
      href: `${base}/finance`,
      label: role === "admin" ? "Pakiety i płatności" : "Moje rozliczenia",
      icon: Wallet,
    },
    { href: `${base}/community`, label: "Psiutki", icon: Heart },
  ];
  useEffect(() => {
    const views = [
      "dashboard",
      "walks",
      "dogs",
      "finance",
      "community",
      ...(role === "admin" ? ["relations"] : []),
    ];
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: object,
            options: { signal: AbortSignal },
          ) => Promise<void>;
        };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: "navigate_psi_pawer",
          description:
            "Otwiera wybrany widok panelu Psi Pawer. Nie zmienia danych.",
          inputSchema: {
            type: "object",
            properties: {
              view: {
                type: "string",
                enum: views,
              },
            },
            required: ["view"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
          execute(input: unknown) {
            const view = (input as { view?: string })?.view;
            if (!view || !views.includes(view))
              throw new Error("Nieprawidłowy widok");
            const href = view === "dashboard" ? base : `${base}/${view}`;
            router.push(href);
            return { destination: href, status: "navigation_requested" };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, [base, router, role]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        Przejdź do treści
      </a>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <PawPrint />
          </div>
          <div className="brand-copy">
            <strong>Psi Pawer</strong>
            <span>zamieniam problemy w wyzwania</span>
          </div>
        </div>
        <div className="role-pill">
          <div className="role-avatar">{name.slice(0, 2).toUpperCase()}</div>
          <div className="role-copy">
            <strong>{name}</strong>
            <span>
              {role === "admin" ? "Panel behawiorysty" : "Panel opiekuna"}
            </span>
          </div>
        </div>
        <div className="nav-label">Panel</div>
        <nav className="sidebar-nav" aria-label="Główna nawigacja">
          {nav.map((n) => (
            <Link
              onClick={() => setOpen(false)}
              className={`nav-item ${path === n.href || (n.href !== base && path.startsWith(n.href)) ? "active" : ""}`}
              key={n.href}
              href={n.href}
            >
              <n.icon />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <Link className="nav-item" href="/complete-profile">
            Moje dane
          </Link>
          <Link className="nav-item" href="/account/security">
            Hasło do konta
          </Link>
          <form action={signOut}>
            <button className="nav-item">
              <LogOut />
              <span>Wyloguj się</span>
            </button>
          </form>
        </div>
      </aside>
      {open && (
        <button
          className="drawer-backdrop"
          onClick={() => setOpen(false)}
          aria-label="Zamknij menu"
        />
      )}
      <main className="main" id="content">
        <header className="topbar">
          <button
            className="mobile-menu-button"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Zamknij menu" : "Otwórz menu"}
          >
            {open ? <X /> : <Menu />}
          </button>
          <div className="page-heading">
            <h1>
              {nav.find((n) => n.href === path)?.label ||
                (path.includes("/dogs/")
                  ? "Profil psa"
                  : path.includes("/walks/")
                    ? "Szczegóły spaceru"
                    : "Psi Pawer")}
            </h1>
            <p>
              {role === "admin"
                ? "Dobry plan. Spokojniejszy spacer."
                : "Małe kroki, wielkie postępy."}
            </p>
          </div>
          <div className="topbar-actions">
            <Link
              className="primary-button"
              href={role === "admin" ? "/admin/walks/new" : "/app/walks"}
              aria-label={role === "admin" ? "Nowy spacer" : "Znajdź spacer"}
            >
              {role === "admin" ? <Plus /> : <CalendarDays />}
              <span>{role === "admin" ? "Nowy spacer" : "Znajdź spacer"}</span>
            </Link>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
