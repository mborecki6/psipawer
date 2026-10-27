import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Dog, Registration, Walk } from "../src/lib/data/types";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  snapshot: vi.fn(),
  allRows: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/data/queries", () => ({
  getSnapshot: mocks.snapshot,
  allRows: mocks.allRows,
}));
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock(
  "@/lib/validation/schemas",
  async () => import("../src/lib/validation/schemas"),
);
vi.mock("@/lib/time", async () => import("../src/lib/time"));
vi.mock("@/lib/walk-filters", async () => import("../src/lib/walk-filters"));
vi.mock(
  "@/lib/walk-relations",
  async () => import("../src/lib/walk-relations"),
);
vi.mock("@/lib/qualification", async () => import("../src/lib/qualification"));
vi.mock("@/modules/services/selection", () => ({
  WalkServiceFields: () => null,
}));
vi.mock("@/modules/calendar/booking-choice", () => ({
  BookingChoice: () => null,
}));
vi.mock("@/modules/calendar/warning", () => ({ CalendarWarning: () => null }));
vi.mock("@/lib/data/actions", () => ({
  saveDog: vi.fn(),
  saveBehavior: vi.fn(),
  addNote: vi.fn(),
  registerDog: vi.fn(),
  decideRegistration: vi.fn(),
  cancelRegistration: vi.fn(),
  cancelWalk: vi.fn(),
  markAttendance: vi.fn(),
  createWalk: vi.fn(),
  updateWalk: vi.fn(),
  inviteDog: vi.fn(),
}));
vi.mock("@/lib/data/registration-actions", () => ({
  reopenRegistration: vi.fn(),
}));
vi.mock(
  "@/components/action-form",
  async () => import("../src/components/action-form"),
);
vi.mock("../src/components/avatar-editor", () => ({
  AvatarEditor: () =>
    createElement("form", { "data-photo-editor": true }, "Zapisz zdjęcie"),
}));
vi.mock("../src/components/dog-qualification-form", () => ({
  DogQualificationForm: () =>
    createElement(
      "form",
      { "data-qualification": true },
      "Zapisz kwalifikację",
    ),
}));
import { DogDetail } from "../src/components/dogs";
import { WalkDetail } from "../src/components/walks";

const dogId = "a1000000-0000-4000-8000-000000000001";
const walkId = "a2000000-0000-4000-8000-000000000001";
const at = "2030-01-01T10:00:00Z";
const answerNames = [
  "comfort_distance",
  "reactions",
  "triggers",
  "helps",
  "health",
  "medications",
  "allergies",
  "muzzle",
  "bite_history",
  "goals",
];
let role: "admin" | "client";
let behavior: Record<string, string> | null;
let location: Record<string, string> | null;
let notes: {
  id: string;
  body: string;
  visibility: string;
  created_at: string;
}[];
let dogs: Dog[];
let registrations: Registration[];
let walk: Walk;
let queried: string[];
const makeDog = (id = dogId, name = "Figa"): Dog => ({
  id,
  guardian_id: "guardian",
  name,
  birth_date: null,
  approximate_age: "4 lata",
  breed: "Mieszaniec",
  sex: "female",
  weight_kg: 12,
  color: "Rudy",
  status: "approved",
  qualification_version: 2,
  avatar_path: null,
  created_at: at,
});
const makeRegistration = (
  id: string,
  status: Registration["status"],
  dog = dogId,
  payment_status = "none",
): Registration => ({
  id,
  walk_id: walkId,
  dog_id: dog,
  status,
  payment_status,
  package_id: null,
  attendance: "pending",
  decision_note: null,
  cancellation_free_until: null,
  created_at: at,
});
function setupDb() {
  return {
    from: (table: string) => {
      queried.push(table);
      const result = () => ({
        data:
          table === "dogs"
            ? dogs[0]
            : table === "dog_behavior_profiles"
              ? behavior
              : table === "profiles"
                ? { full_name: "Opiekun", area: "Warszawa", phone: "123456789" }
                : table === "walk_private_details"
                  ? location
                  : notes,
        error: null,
      });
      const query = {
        select: () => query,
        eq: () => query,
        order: () => Promise.resolve(result()),
        maybeSingle: () => Promise.resolve(result()),
      };
      return query;
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T12:00:00Z"));
  role = "admin";
  behavior = null;
  notes = [];
  queried = [];
  location = {
    exact_location: "Prywatna zbiórka przy bramie",
    instructions: "Wejdź boczną furtką.",
    map_url: "https://example.com/map",
  };
  dogs = [makeDog()];
  registrations = [];
  walk = {
    id: walkId,
    starts_at: "2030-01-02T12:00:00Z",
    duration_minutes: 60,
    public_location: "Park",
    type: "Spacer",
    price_cents: 6000,
    capacity: 4,
    booking_mode: "approval",
    status: "open",
    info: "Weź wodę dla psa.",
    tags: [],
    cancellation_deadline_hours: 24,
    cancellation_reason: null,
    change_note: null,
    updated_at: at,
  };
  mocks.session.mockImplementation(async () => ({ role, db: setupDb() }));
  mocks.snapshot.mockImplementation(async () => ({
    role,
    dogs,
    walks: [walk],
    registrations,
  }));
  mocks.allRows.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

it.each(["admin", "client"] as const)(
  "shows the dog profile and missing questionnaire before closed editors for %s",
  async (selectedRole) => {
    role = selectedRole;
    const html = renderToStaticMarkup(await DogDetail({ id: dogId }));
    expect(html).toContain("Informacje o potrzebach: 0 / 10");
    expect(html).toContain(
      "Kwestionariusz psa nie został jeszcze uzupełniony.",
    );
    expect(html.indexOf("Potrzeby i bezpieczeństwo</h2>")).toBeLessThan(
      html.indexOf("Edytuj profil</summary>"),
    );
    expect(html).toMatch(/<dt>Waga<\/dt><dd>12 kg<\/dd>/);
    expect(html).toContain('name="name"');
    expect(html).toContain('value="Figa"');
    expect(html).toMatch(
      /<details[^>]*><summary>Edytuj profil<\/summary><div><form/,
    );
    expect(html).toMatch(
      /<details[^>]*><summary>Uzupełnij informacje o psie<\/summary>/,
    );
    expect(html).toMatch(
      /<details[^>]*><summary>Zmień zdjęcie<\/summary><div><form/,
    );
    expect(html).not.toMatch(/<details[^>]*\sopen=/);
    for (const name of answerNames) expect(html).toContain(`name="${name}"`);
    expect(queried).not.toContain("guardian_onboarding");
    if (role === "client") {
      expect(html).not.toContain("Zapisz kwalifikację");
      expect(html).not.toContain('name="visibility"');
    } else {
      expect(html.indexOf("Zapisz kwalifikację")).toBeLessThan(
        html.indexOf("Edytuj profil</summary>"),
      );
      expect(html.indexOf("Notatki behawiorysty")).toBeLessThan(
        html.indexOf("Edytuj profil</summary>"),
      );
      expect(html).toContain('<option value="admin_only" selected="">');
    }
  },
);
it("keeps safety answers readable and existing values in the closed questionnaire", async () => {
  behavior = {
    bite_history: "Ugryzienie po zaskoczeniu.",
    medications: "Lek zalecony przez weterynarza.",
    helps: "Spokojny dystans.",
  };
  const html = renderToStaticMarkup(await DogDetail({ id: dogId }));
  const reading = html.slice(
    html.indexOf('id="dog-needs"'),
    html.indexOf("Notatki behawiorysty"),
  );
  expect(html).toContain("Informacje o potrzebach: 3 / 10");
  expect(reading).toContain("Ugryzienie po zaskoczeniu.");
  expect(reading).toContain("Lek zalecony przez weterynarza.");
  expect(html).toContain(
    '<textarea name="bite_history" maxLength="4000">Ugryzienie po zaskoczeniu.</textarea>',
  );
  expect(html).toContain(
    "Zmiana reakcji lub historii pogryzień może wymagać ponownej oceny.",
  );
});
it("shows complete questionnaire status and preserves shared notes for the guardian", async () => {
  role = "client";
  behavior = Object.fromEntries(
    answerNames.map((name) => [name, `Odpowiedź ${name}`]),
  );
  notes = [
    {
      id: "note",
      body: "Udostępniona wskazówka",
      visibility: "client_visible",
      created_at: at,
    },
  ];
  const html = renderToStaticMarkup(await DogDetail({ id: dogId }));
  expect(html).toContain("Informacje o potrzebach: 10 / 10");
  expect(html).toContain("Wszystkie pola są uzupełnione.");
  expect(html).toContain("Udostępniona wskazówka");
  expect(html).toContain("Wiadomości od behawiorysty");
  expect(html).not.toContain("Tylko behawiorysta");
});
it("places pending decisions, accepted dogs and reserve before adding and closed registrations", async () => {
  dogs = [
    makeDog(),
    makeDog("dog2", "Mika"),
    makeDog("dog3", "Borys"),
    makeDog("dog4", "Luna"),
    makeDog("dog5", "Sara"),
  ];
  registrations = [
    makeRegistration("pending", "pending"),
    makeRegistration("accepted", "accepted", "dog2", "due"),
    makeRegistration("reserve", "waitlisted", "dog3"),
    makeRegistration("withdrawn", "withdrawn", "dog4", "paid"),
  ];
  const html = renderToStaticMarkup(await WalkDetail({ id: walkId }));
  expect(html.indexOf("Oczekujące decyzje")).toBeLessThan(
    html.indexOf("Bieżący skład"),
  );
  expect(html.indexOf("Bieżący skład")).toBeLessThan(
    html.indexOf("Dodaj psa do spaceru"),
  );
  expect(html.indexOf("Lista rezerwowa")).toBeLessThan(
    html.indexOf("Dodaj psa do spaceru"),
  );
  expect(
    html.indexOf("Zakończone zgłoszenia: sprawdź rozliczenie"),
  ).toBeLessThan(html.indexOf("Zakończone zgłoszenia (1)"));
  expect(html).toContain('href="#registration-withdrawn"');
  expect(html).toContain('id="registration-withdrawn"');
  expect(html).toContain("Przywróć zgłoszenie do decyzji");
  expect(html).toContain('aria-label="Przyjmij: Figa"');
  expect(html).toContain('aria-label="Nie przyjmuj: Figa"');
  expect(html).not.toContain("Przejdź do decyzji");
  expect(html).toContain('name="id" value="pending"');
  expect(html).not.toContain("Zapisz obecność");
  expect(html.indexOf("Bieżący skład")).toBeLessThan(
    html.indexOf("Weź wodę dla psa."),
  );
});
it("keeps qualification and relation warnings visible before the admin roster", async () => {
  dogs = [makeDog(), { ...makeDog("dog2", "Mika"), status: "needs_review" }];
  registrations = [
    makeRegistration("pending", "pending"),
    makeRegistration("accepted", "accepted", "dog2"),
  ];
  mocks.allRows.mockResolvedValue([
    {
      id: "conflict",
      dog_a: dogId,
      dog_b: "dog2",
      level: "block",
      note: "Nie łączyć tej pary.",
    },
  ]);
  const html = renderToStaticMarkup(await WalkDetail({ id: walkId }));
  expect(html.indexOf("Kwalifikacja wymaga ponownej decyzji")).toBeLessThan(
    html.indexOf("Zgłoszenia i skład"),
  );
  expect(html.indexOf("Uwaga na skład")).toBeLessThan(
    html.indexOf("Zgłoszenia i skład"),
  );
  expect(html).toContain("Nie łączyć tej pary.");
  expect(html).toContain(`#registration-accepted`);
});
it("shows ordinary attendance directly for each accepted dog after the start", async () => {
  walk.starts_at = "2029-12-31T12:00:00Z";
  registrations = [makeRegistration("accepted", "accepted", dogId, "due")];
  const html = renderToStaticMarkup(await WalkDetail({ id: walkId }));
  expect(html).toContain('aria-label="Był: Figa"');
  expect(html).toContain('aria-label="Nie był · płatne: Figa"');
  expect(html).toContain("Nieoznaczono");
  expect(html).not.toContain("Oznacz obecność");
  expect(html).toContain('name="attendance"');
  expect(html).toContain('value="no_show"');
  expect(html).not.toContain("Zapisz decyzję");
  expect(html).not.toContain("wszyscy obecni");
});
it("keeps a closed due registration visible for settlement and omits settled refunds", async () => {
  dogs = [makeDog(), makeDog("dog2", "Mika")];
  registrations = [
    makeRegistration("late", "cancelled_late", dogId, "due"),
    makeRegistration("refunded", "cancelled_on_time", "dog2", "refunded"),
  ];
  const html = renderToStaticMarkup(await WalkDetail({ id: walkId }));
  expect(html).toContain('href="#registration-late"');
  expect(html).not.toContain('href="#registration-refunded"');
  expect(html).toContain('id="registration-refunded"');
  expect(html).toContain("Zwrot / korekta");
});
it("keeps cancellation visible before the roster and flags received payment for review", async () => {
  walk.status = "cancelled";
  walk.cancellation_reason = "Niebezpieczna pogoda.";
  registrations = [makeRegistration("accepted", "accepted", dogId, "paid")];
  const html = renderToStaticMarkup(await WalkDetail({ id: walkId }));
  expect(
    html.indexOf("Spacer został odwołany przez organizatora."),
  ).toBeLessThan(html.indexOf("Zgłoszenia i skład"));
  expect(html).toContain('href="#registration-accepted"');
  expect(html).not.toContain("Zapisz decyzję");
});
it("preserves the guardian actions and withholds exact location when access-filtered data is empty", async () => {
  role = "client";
  location = null;
  registrations = [makeRegistration("reserve", "waitlisted")];
  const html = renderToStaticMarkup(await WalkDetail({ id: walkId }));
  expect(html).toContain("Twój pies jest na liście rezerwowej.");
  expect(html).toContain("Odwołaj zgłoszenie");
  expect(html).toContain(
    "Dokładną lokalizację zobaczysz po zaakceptowaniu Twojego psa.",
  );
  expect(html).not.toContain("Prywatna zbiórka przy bramie");
  expect(html).not.toContain("Zapisz decyzję");
  expect(html).not.toContain("Dodaj psa do spaceru");
});
