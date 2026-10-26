import type {
  OnboardingAnswers,
  OnboardingRecord,
  OnboardingStep,
} from "./types";

export function onboardingEditorStep(record: OnboardingRecord): OnboardingStep {
  if (record.current_step !== "plan") return record.current_step;
  if (record.completed_at) return "dog";
  if (!record.answers.age) return "dog";
  if (!record.answers.goal) return "goal";
  return "style";
}

export const onboardingLabels = {
  age: {
    puppy: "Szczeniak",
    adult: "Dorosły pies",
    senior: "Senior",
    unknown: "Wiek do ustalenia",
  },
  goal: {
    walks: "Spokojniejsze spacery",
    home: "Codzienność w domu",
    puppy: "Start ze szczeniakiem",
    activity: "Wspólna aktywność",
    relationship: "Lepsze porozumienie",
    unknown: "Odkrywanie możliwości",
  },
  format: {
    individual: "Indywidualnie",
    group: "W grupie",
    unknown: "Forma do ustalenia",
  },
} as const;

export function onboardingStepError(
  step: OnboardingStep,
  answers: OnboardingAnswers,
): { field: "age" | "goal" | "format"; message: string } | null {
  if (step === "dog" && !answers.age)
    return {
      field: "age",
      message:
        "Wybierz etap życia psa. „Jeszcze nie wiem” też jest dobrą odpowiedzią.",
    };
  if (step === "goal" && !answers.goal)
    return {
      field: "goal",
      message:
        "Wybierz to, co dziś jest najważniejsze — albo „Pomóżcie mi wybrać”.",
    };
  if (step === "style" && !answers.format)
    return {
      field: "format",
      message: "Wybierz formę spotkań albo „Jeszcze nie wiem”.",
    };
  return null;
}

export function onboardingStart(answers: OnboardingAnswers) {
  const dog = answers.dogName.trim();
  const goal = answers.goal
    ? onboardingLabels.goal[answers.goal]
    : onboardingLabels.goal.unknown;
  const ageCopy = {
    puppy: "Na starcie warto opowiedzieć Asi, jak poznajecie razem świat.",
    adult:
      "Punktem wyjścia będzie Wasza codzienność i to, co chcesz w niej ułatwić.",
    senior: "Na spotkaniu opowiedz Asi o Waszym obecnym tempie i potrzebach.",
    unknown: "Wiek i pozostałe szczegóły możecie uzupełnić później.",
  }[answers.age || "unknown"];

  let title = "Poznaj możliwości współpracy";
  let action = "Zobacz ofertę";
  let href = "/app/services";
  let copy = "Poznaj formy współpracy i wybierz kolejny krok z Asią.";
  if (answers.format === "individual") {
    title = "Poznaj zajęcia indywidualne";
    action = "Zobacz indywidualne";
    href = "/app/services?category=individual";
    copy = "W ofercie najpierw pokażemy spotkania indywidualne.";
  } else if (answers.format === "group") {
    title = "Poznaj zajęcia grupowe";
    action = "Zobacz grupowe";
    href = "/app/services?category=group";
    copy =
      "W ofercie najpierw pokażemy zajęcia grupowe. Formę pracy dobierzecie z Asią.";
  }
  const purpose = {
    walks: [
      "Znajdź wsparcie na spacery",
      "Opowiedz Asi, co jest trudne na spacerach.",
    ],
    home: [
      "Zacznij od Waszej codzienności",
      "Przy zgłoszeniu opisz jedną sytuację w domu.",
    ],
    puppy: [
      "Dobry początek ze szczeniakiem",
      "Opowiedz Asi, czego potrzebujecie na Waszym starcie.",
    ],
    activity: [
      "Znajdź pomysł na wspólną aktywność",
      "Przejrzyj opisy zajęć i wybierz, o które chcesz zapytać Asię.",
    ],
    relationship: [
      "Zacznij od lepszego porozumienia",
      "Opisz Asi sytuację, w której najtrudniej Wam się zrozumieć.",
    ],
    unknown: null,
  }[answers.goal || "unknown"];
  if (purpose) {
    title = purpose[0];
    copy = `${purpose[1]} ${copy}`;
  }
  if (answers.collaboration === "after") {
    title = "Zajrzyj do wskazówek od Asi";
    action = "Otwórz plany i postępy";
    href = "/app/care";
    copy =
      "Sprawdź wskazówki przy swoim psie i spotkaniu, jeśli Asia już je udostępniła.";
  }
  const lead =
    !answers.goal || answers.goal === "unknown"
      ? `Nie musisz jeszcze wiedzieć, od czego zacząć. Poznaj możliwości i wybierz kolejny krok z Asią. ${ageCopy}`
      : `Wasz kierunek: ${goal.toLocaleLowerCase("pl")}. ${ageCopy}`;
  const rhythm = {
    short: "Na teraz wystarczy jeden krok.",
    more: "Dalej możesz uzupełnić kartę psa.",
    unknown: "Kolejne kroki zrobicie w swoim tempie.",
  }[answers.rhythm];

  return {
    title,
    action,
    href,
    copy,
    rhythm,
    lead,
    goal,
    heading: dog ? `Wasz start, ${dog}.` : "Wasz spokojny start.",
    tags: [
      answers.age && onboardingLabels.age[answers.age],
      answers.goal && onboardingLabels.goal[answers.goal],
      answers.format && onboardingLabels.format[answers.format],
      answers.collaboration === "after" ? "Po spotkaniu" : null,
    ].filter((tag): tag is string => Boolean(tag)),
  };
}
