export type OfferCategory = "all" | "individual" | "group";
export const offerCategories: Record<OfferCategory, string> = {
  all: "Wszystkie",
  individual: "Indywidualne",
  group: "Grupowe",
};
export type OfferItem = {
  id: string;
  source_id: string;
  kind: "walk" | "course";
  category: Exclude<OfferCategory, "all">;
  title: string;
  starts_at: string;
  ends_at: string;
  public_location: string;
  availability: "available" | "full" | "closed" | "cancelled" | "past";
  booking_mode: "approval" | "automatic" | "invite";
  eligibility:
    | "eligible"
    | "needs_dog"
    | "qualification_required"
    | "registered"
    | "invitation_only";
  session_ordinal: number | null;
  sessions_count: number | null;
};
export type OfferSearch = {
  date?: string | string[];
  day?: string | string[];
  category?: string | string[];
};
