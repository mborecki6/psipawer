import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("@/lib/finance", async () => import("../src/lib/finance"));
import {
  issueGiftCard,
  changeGiftCard,
  redeemGiftCard,
  refundGiftCardSale,
  claimGiftCard,
  bindGiftService,
} from "../src/modules/gifts/actions";
const id = "d4000000-0000-4000-8000-000000000001",
  key = "d4000000-0000-4000-8000-000000000002",
  target = "d4000000-0000-4000-8000-000000000003",
  person = "d4000000-0000-4000-8000-000000000004";
function form(overrides: Partial<Record<string, string>> = {}) {
  const result = new FormData();
  for (const [name, value] of Object.entries({
    id,
    card_id: id,
    request_id: key,
    expected_version: "1",
    service_id: "",
    service_version: "",
    beneficiary_id: "",
    purchased_on: "2026-10-03",
    sender: " Darczyńca ",
    recipient: " Obdarowany ",
    message: " Dobrego czasu ",
    method: "transfer",
    note: " Potwierdzona operacja ",
    confirmed: "on",
    amount: "100,00",
    intent: "cancel",
    target_kind: "fitness",
    target_id: target,
    code: "ABCDEF01-ABCDEF01-ABCDEF01-ABCDEF01-ABCDEF01",
    ...overrides,
  }))
    if (value !== undefined) result.set(name, value);
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc, from: mocks.from } });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.lookup });
  mocks.lookup.mockResolvedValue({ data: null, error: null });
});
it("generates the private issue code on the server and accepts neither a forged caller code nor actor", async () => {
  mocks.rpc.mockResolvedValue({ data: id, error: null });
  const result = await issueGiftCard(
    {},
    form({ p_code: "FORGED", actor_id: person, value_cents: "1" }),
  );
  expect(result.id).toBe(id);
  expect(mocks.session).toHaveBeenCalledWith("admin");
  const [name, args] = mocks.rpc.mock.calls[0];
  expect(name).toBe("issue_gift_card");
  expect(args).toMatchObject({
    p_id: id,
    p_value_cents: 10000,
    p_sender: "Darczyńca",
    p_recipient: "Obdarowany",
    p_beneficiary: null,
  });
  expect(args.p_code).toMatch(/^[A-F0-9]{40}$/);
  expect(JSON.stringify(result)).not.toContain(args.p_code);
  expect(args).not.toHaveProperty("actor_id");
});
it("reuses the first private issue code on a retry after an uncertain response", async () => {
  const code = "AB".repeat(20);
  mocks.lookup.mockResolvedValue({ data: { code }, error: null });
  mocks.rpc.mockResolvedValue({ data: id, error: null });
  expect((await issueGiftCard({}, form())).id).toBe(id);
  expect(mocks.eq).toHaveBeenCalledWith("card_id", id);
  expect(mocks.rpc.mock.calls[0][1].p_code).toBe(code);
});
it("requires staff before any private lookup or financial command", async () => {
  mocks.session.mockRejectedValue(new Error("FORBIDDEN"));
  for (const action of [
    issueGiftCard,
    changeGiftCard,
    redeemGiftCard,
    refundGiftCardSale,
    bindGiftService,
  ])
    await expect(action({}, form())).rejects.toThrow("FORBIDDEN");
  expect(mocks.session.mock.calls.every((args) => args[0] === "admin")).toBe(
    true,
  );
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("requires a client session for claiming and sends only the normalized code", async () => {
  mocks.rpc.mockResolvedValue({ data: { id }, error: null });
  expect((await claimGiftCard({}, form({ beneficiary_id: person }))).id).toBe(
    id,
  );
  expect(mocks.session).toHaveBeenCalledWith("client");
  expect(mocks.rpc).toHaveBeenCalledWith("claim_gift_card", {
    p_code: "ABCDEF01".repeat(5),
  });
});
it("validates a real calendar date, service snapshot and explicit cash confirmation before issuance", async () => {
  for (const values of [
    { purchased_on: "2026-02-30" },
    { purchased_on: "infinity" },
    { purchased_on: "1999-01-01" },
    { service_id: person },
    { service_version: "1" },
    { confirmed: "" },
    { sender: " " },
    { amount: "100.001" },
  ])
    expect((await issueGiftCard({}, form(values))).error).toBeTruthy();
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("passes service terms and an optional guardian without allowing a caller to replace the confirmed face value", async () => {
  mocks.rpc.mockResolvedValue({ data: id, error: null });
  await issueGiftCard(
    {},
    form({ service_id: target, service_version: "3", beneficiary_id: person }),
  );
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
    p_service: target,
    p_expected_service_version: 3,
    p_beneficiary: person,
    p_value_cents: 10000,
  });
});
it("does not create a second code or call issuance when the private retry lookup fails", async () => {
  mocks.lookup.mockResolvedValue({
    data: null,
    error: { message: "private failure" },
  });
  expect((await issueGiftCard({}, form())).error).not.toContain("private");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("sends one deliberate card assignment and preserves its original version and request key", async () => {
  mocks.rpc.mockResolvedValue({ data: 2, error: null });
  expect(
    (
      await changeGiftCard(
        {},
        form({ intent: "assign", beneficiary_id: person }),
      )
    ).version,
  ).toBe(2);
  expect(mocks.rpc).toHaveBeenCalledWith("change_gift_card", {
    p_id: id,
    p_expected_version: 1,
    p_action: "assign",
    p_beneficiary: person,
    p_note: "Potwierdzona operacja",
    p_request_id: key,
  });
});
it("rejects missing assignment recipients and a forged recipient on another card action", async () => {
  for (const values of [
    { intent: "assign" },
    { intent: "cancel", beneficiary_id: person },
    { expected_version: "0" },
    { note: " " },
  ])
    expect((await changeGiftCard({}, form(values))).error).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("records a decimal service credit without accepting a client-supplied guardian or payment method", async () => {
  mocks.rpc.mockResolvedValue({ data: key, error: null });
  expect(
    (
      await redeemGiftCard(
        {},
        form({ amount: "40,50", guardian_id: person, method: "cash" }),
      )
    ).success,
  ).toContain("nie zapisano nowego wpływu");
  expect(mocks.rpc).toHaveBeenCalledWith("redeem_gift_card", {
    p_card: id,
    p_expected_version: 1,
    p_kind: "fitness",
    p_target: target,
    p_amount_cents: 4050,
    p_note: "Potwierdzona operacja",
    p_request_id: key,
  });
});
it("requires an explicit acknowledgement that a card-sale cash refund happened outside the app", async () => {
  expect(
    (await refundGiftCardSale({}, form({ confirmed: "" }))).error,
  ).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ data: target, error: null });
  expect(
    (await refundGiftCardSale({}, form({ amount: "12,34" }))).success,
  ).toContain("nie wykonuje przelewu");
  expect(mocks.rpc).toHaveBeenCalledWith("refund_gift_card_sale", {
    p_card: id,
    p_expected_version: 1,
    p_amount_cents: 1234,
    p_note: "Potwierdzona operacja",
    p_request_id: key,
  });
});
it("rejects malformed values, commands and keys before redeeming or returning cash", async () => {
  for (const values of [
    { amount: "0" },
    { amount: "10000,01" },
    { amount: "1.001" },
    { amount: "1e2" },
    { expected_version: "0" },
    { request_id: "x" },
  ]) {
    expect((await redeemGiftCard({}, form(values))).error).toBeTruthy();
    expect((await refundGiftCardSale({}, form(values))).error).toBeTruthy();
  }
  expect(
    (await redeemGiftCard({}, form({ target_kind: "card" }))).error,
  ).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("does not claim malformed codes or reveal foreign data from an unexpected database reply", async () => {
  for (const code of ["BAD", "A".repeat(61), "Z".repeat(40)])
    expect((await claimGiftCard({}, form({ code }))).error).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({
    data: { id: "-".repeat(36), private_owner: person },
    error: null,
  });
  expect(JSON.stringify(await claimGiftCard({}, form()))).not.toContain(person);
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it.each([
  "Nie można przypisać tej karty. Sprawdź kod lub skontaktuj się z prowadzącą.",
  "Zbyt wiele prób. Spróbuj ponownie za 15 minut.",
])("keeps a committed claim refusal visible: %s", async (message) => {
  mocks.rpc.mockResolvedValue({ data: { error: message }, error: null });
  expect((await claimGiftCard({}, form())).error).toBe(message);
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("preserves safe conflict messages and hides unknown SQL, network and code details", async () => {
  const message = "Karta zmieniła się. Odśwież widok przed zapisem.";
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
  expect((await redeemGiftCard({}, form())).error).toBe(message);
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "private code/SQL" },
  });
  expect((await refundGiftCardSale({}, form())).error).not.toContain("private");
  mocks.rpc.mockRejectedValue(new Error("private network"));
  expect((await changeGiftCard({}, form())).error).not.toContain("private");
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("does not acknowledge an unchanged version or an invalid command result", async () => {
  for (const data of [null, 1, "2", 1.5]) {
    mocks.rpc.mockResolvedValueOnce({ data, error: null });
    expect((await changeGiftCard({}, form())).error).toBeTruthy();
  }
  for (const data of [null, "-".repeat(36), 2]) {
    mocks.rpc.mockResolvedValueOnce({ data, error: null });
    expect((await redeemGiftCard({}, form())).error).toBeTruthy();
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("links only one free-form source to a catalogue service with its explicit previous version", async () => {
  mocks.rpc.mockResolvedValue({ data: key, error: null });
  expect(
    (
      await bindGiftService(
        {},
        form({
          target_kind: "package",
          service_id: person,
          expected_version: "0",
        }),
      )
    ).id,
  ).toBe(key);
  expect(mocks.rpc).toHaveBeenCalledWith("bind_gift_card_service", {
    p_registration: null,
    p_package: target,
    p_service: person,
    p_expected_version: 0,
    p_note: "Potwierdzona operacja",
  });
});
