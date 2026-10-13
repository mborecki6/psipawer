export type ChatState = {
  id: string;
  state:
    | "active"
    | "waiting_me"
    | "waiting_other"
    | "withdrawn"
    | "blocked"
    | "access_lost"
    | "unavailable";
  ownDog?: string;
  otherDog?: string;
  canUnblock?: boolean;
  canStart?: boolean;
};
export type ChatMessage = {
  id: string;
  body: string;
  own: boolean;
  created_at: string;
};
export type ChatSnapshot = {
  chat: ChatState;
  messages: ChatMessage[];
  more: boolean;
};
export const chatStates: Record<ChatState["state"], string> = {
  active: "Rozmowa jest otwarta.",
  waiting_me: "Drugi opiekun chce porozmawiać. Dołączenie wymaga Twojej zgody.",
  waiting_other:
    "Czekamy na zgodę drugiego opiekuna. Możesz wrócić tu później.",
  withdrawn: "Zgoda na tę rozmowę została wycofana. Wiadomości są niedostępne.",
  blocked: "Rozmowa jest zablokowana. Wiadomości są niedostępne.",
  access_lost:
    "Dostęp do rozmowy wygasł po zmianie wizytówki, zainteresowania lub opiekuna psa.",
  unavailable: "Ta rozmowa jest niedostępna.",
};
