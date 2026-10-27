import { createRoot } from "react-dom/client";
import { ProgressForm } from "../../../src/modules/care/progress-form";
import { PaymentEntryForm } from "../../../src/components/finance/payment-entry-form";
import { DetailsNavigation, ProgressiveDetails } from "../../../src/components/progressive-details";

type Result = "reject" | "defer" | { error: string } | { success: string };
type Props =
  Parameters<typeof ProgressForm>[0] | Parameters<typeof PaymentEntryForm>[0];
declare global {
  interface Window {
    draftResults: Result[];
    draftCalls: { kind: string; data: Record<string, FormDataEntryValue> }[];
    resolveDraftAction?: (result: Exclude<Result, "defer">) => void;
    runDraftAction: (
      kind: string,
      data: FormData,
    ) => Promise<Exclude<Result, string>>;
    renderDraft: (kind: "care" | "payment", props: Props) => void;
  }
}

// about:blank has no server or database. Only action replies are fixtures;
// React, ReactDOM, the form components and their input/reset behavior are real.
window.draftResults = [];
window.draftCalls = [];
window.runDraftAction = async (kind, data) => {
  window.draftCalls.push({ kind, data: Object.fromEntries(data) });
  const result = window.draftResults.shift();
  if (!result) throw new Error("Missing explicit action fixture");
  if (result === "defer")
    return new Promise((resolve, reject) => {
      window.resolveDraftAction = (reply) =>
        reply === "reject"
          ? reject(new TypeError("Failed to fetch"))
          : resolve(reply);
    });
  if (result === "reject") throw new TypeError("Failed to fetch");
  return result;
};
if (!crypto.randomUUID) {
  let uuid = 0;
  crypto.randomUUID = () =>
    `70000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`;
}
const root = createRoot(document.getElementById("root")!);
window.renderDraft = (kind, props) => {
  root.render(
    <DetailsNavigation navigationKey={kind}>
    <ProgressiveDetails key={kind} id="draft-editor" initiallyOpen label="Otwórz formularz">
    {kind === "care" ? (
      <ProgressForm {...(props as Parameters<typeof ProgressForm>[0])} />
    ) : (
      <PaymentEntryForm
        {...(props as Parameters<typeof PaymentEntryForm>[0])}
      />
    )}
    </ProgressiveDetails>
    </DetailsNavigation>,
  );
};
