"use client";
import { useState, useEffect, useRef } from "react";
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
  ClipboardList,
  MessageCircle,
  Tags,
  Bell,
  GraduationCap,
  Activity,
  Gift,
} from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import type { Role } from "@/lib/auth/session";
import { notificationCountLabel } from "@/modules/notifications/types";
import { useHydrated } from "./use-hydrated";
export function Shell({
  role,
  name,
  children,
  unreadNotifications = null,
}: {
  role: Role;
  name: string;
  children: React.ReactNode;
  unreadNotifications?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const hydrated = useHydrated();
  const menu = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const path = usePathname();
  const router = useRouter();
  const base = role === "admin" ? "/admin" : "/app";
  const careView =
    path.startsWith(`${base}/care`) ||
    /^\/(admin|app)\/dogs\/[^/]+\/care$/.test(path);
  const nav = [
    {
      href: base,
      label: role === "admin" ? "Pulpit" : "Mój start",
      icon: LayoutDashboard,
    },
    ...(role === "admin"
      ? [{ href: "/admin/work", label: "Do zrobienia", icon: ClipboardList }]
      : []),
    { href: `${base}/notifications`, label: "Powiadomienia", icon: Bell },
    { href: `${base}/walks`, label: "Spacery", icon: CalendarDays },
    { href: `${base}/calendar`, label: "Kalendarz", icon: CalendarDays },
    { href: `${base}/courses`, label: "Kursy", icon: GraduationCap },
    { href: `${base}/fitness`, label: "PSI FITNESS", icon: Activity },
    { href: `${base}/gifts`, label: "Karty podarunkowe", icon: Gift },
    {
      href: `${base}/consultations`,
      label: "Konsultacje",
      icon: MessageCircle,
    },
    { href: `${base}/care`, label: "Plany i postępy", icon: ClipboardList },
    {
      href: `${base}/services`,
      label: role === "admin" ? "Usługi i cennik" : "Oferta",
      icon: Tags,
    },
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
    if (!open) return;
    const panel = menu.current;
    const trigger = menuButton.current;
    const mobile = window.matchMedia("(max-width: 760px)");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex="0"]',
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const resize = () => {
      if (!mobile.matches) setOpen(false);
    };
    document.addEventListener("keydown", keyboard);
    mobile.addEventListener("change", resize);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keyboard);
      mobile.removeEventListener("change", resize);
      if (mobile.matches) trigger?.focus();
    };
  }, [open]);
  useEffect(() => {
    const views = [
      "dashboard",
      "notifications",
      "walks",
      "calendar",
      "courses",
      "fitness",
      "gifts",
      "consultations",
      "care",
      "services",
      "dogs",
      "finance",
      "community",
      ...(role === "admin" ? ["relations", "work"] : []),
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
      <aside
        id="app-navigation"
        ref={menu}
        className={`sidebar ${open ? "open" : ""}`}
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        aria-label={open ? "Menu główne" : undefined}
      >
        <div className="sidebar-mobile-heading">
          <span>Menu</span>
          <button
            type="button"
            className="mobile-menu-button"
            aria-label="Zamknij menu"
            onClick={() => setOpen(false)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
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
              className={`nav-item ${(careView ? n.href === `${base}/care` : path === n.href || (n.href !== base && path.startsWith(n.href))) ? "active" : ""}`}
              key={n.href}
              href={n.href}
              aria-label={
                n.href === `${base}/notifications`
                  ? notificationCountLabel(unreadNotifications)
                  : undefined
              }
            >
              <n.icon />
              <span>{n.label}</span>
              {n.href === `${base}/notifications` &&
                (unreadNotifications === null || unreadNotifications > 0) && (
                  <b className="notification-count" aria-hidden="true">
                    {unreadNotifications === null
                      ? "!"
                      : unreadNotifications > 99
                        ? "99+"
                        : unreadNotifications}
                  </b>
                )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <Link
            className="nav-item"
            href="/complete-profile"
            onClick={() => setOpen(false)}
          >
            Moje dane
          </Link>
          <Link
            className="nav-item"
            href="/account/security"
            onClick={() => setOpen(false)}
          >
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
          tabIndex={-1}
          aria-hidden="true"
        />
      )}
      <main className="main" id="content" inert={open}>
        <header className="topbar">
          <button
            ref={menuButton}
            className="mobile-menu-button"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Zamknij menu" : "Otwórz menu"}
            aria-expanded={open}
            aria-controls="app-navigation"
            disabled={!hydrated}
          >
            {open ? <X /> : <Menu />}
          </button>
          <div className="page-heading">
            <h1>
              {(careView
                ? path.endsWith("/library")
                  ? "Biblioteka zaleceń"
                  : "Plany i postępy"
                : nav.find((n) => n.href === path)?.label) ||
                (path.startsWith("/admin/work/")
                  ? path.includes("/progress/")
                    ? "Odpowiedź opiekuna"
                    : "Kontakty kontrolne"
                  : path.startsWith("/admin/invitations")
                    ? "Zaproszenia opiekunów"
                    : path.startsWith("/admin/reminders")
                      ? "Przypomnienia"
                      : path.includes("/gifts/")
                        ? path.endsWith("/new")
                          ? "Wystaw kartę"
                          : "Karta podarunkowa"
                        : path.includes("/services/")
                          ? "Usługa i cena"
                          : path.includes("/consultations/")
                            ? path.endsWith("/new")
                              ? "Nowa konsultacja"
                              : "Szczegóły konsultacji"
                            : path.includes("/courses/")
                              ? path.endsWith("/new")
                                ? "Nowy cykl kursu"
                                : "Szczegóły kursu"
                              : path.includes("/dogs/")
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
              href={`${base}/notifications`}
              className="notification-button"
              aria-label={notificationCountLabel(unreadNotifications)}
            >
              <Bell size={21} aria-hidden="true" />
              {(unreadNotifications === null || unreadNotifications > 0) && (
                <b className="notification-count" aria-hidden="true">
                  {unreadNotifications === null
                    ? "!"
                    : unreadNotifications > 99
                      ? "99+"
                      : unreadNotifications}
                </b>
              )}
            </Link>
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
