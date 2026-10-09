import {
  LayoutDashboard,
  CalendarDays,
  Dog,
  Wallet,
  Heart,
  Network,
  ClipboardList,
  MessageCircle,
  Tags,
  Bell,
  GraduationCap,
  Activity,
  Gift,
} from "lucide-react";
import type { Role } from "@/lib/auth/session";

export function getShellNavigation(role: Role, path: string) {
  const base = role === "admin" ? "/admin" : "/app";
  const careView =
    path.startsWith(`${base}/care`) ||
    /^\/(admin|app)\/dogs\/[^/]+\/care$/.test(path);
  const sections = [
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
  const nav =
    role === "admin"
      ? [
          { href: "/admin", label: "Pulpit", icon: LayoutDashboard },
          { href: "/admin/calendar", label: "Kalendarz", icon: CalendarDays },
          { href: "/admin/activities", label: "Zajęcia", icon: GraduationCap },
          { href: "/admin/dogs", label: "Psy i opiekunowie", icon: Dog },
          {
            href: "/admin/care",
            label: "Plany i postępy",
            icon: ClipboardList,
          },
          { href: "/admin/finance", label: "Rozliczenia", icon: Wallet },
        ]
      : sections;
  const extraNav = sections.filter((item) =>
    ["/admin/gifts", "/admin/community", "/admin/relations"].includes(
      item.href,
    ),
  );
  const within = (href: string) => path === href || path.startsWith(`${href}/`);
  const settingsView =
    role === "admin" &&
    [
      "/admin/settings",
      "/admin/services",
      "/admin/invitations",
      "/admin/reminders",
    ].some(within);
  const activitiesView =
    role === "admin" &&
    [
      "/admin/activities",
      "/admin/walks",
      "/admin/consultations",
      "/admin/courses",
      "/admin/fitness",
    ].some(within);
  const extraView =
    role === "admin" && extraNav.some((item) => within(item.href));
  const active = (href: string) =>
    careView
      ? href === `${base}/care`
      : href === "/admin/activities"
        ? activitiesView
        : href === base
          ? path === base
          : within(href);
  return {
    base,
    careView,
    sections,
    nav,
    extraNav,
    settingsView,
    activitiesView,
    extraView,
    active,
  };
}
