"use client";
import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { saveDevicePush, disableDevicePush, devicePushStatus } from "./actions";
import {
  applicationServerKey,
  clearBrowserPush,
  inspectDevicePush,
  reconcilePushOwner,
  setPushOwner,
  type PushSettingsStatus,
} from "./browser";

const labels: Record<PushSettingsStatus, string> = {
  checking: "Sprawdzam ustawienia tego urządzenia…",
  unsupported: "Ta przeglądarka nie obsługuje powiadomień na urządzeniu.",
  unconfigured: "Powiadomienia na urządzeniu nie są jeszcze skonfigurowane.",
  enabled_unconfigured:
    "Powiadomienia są wstrzymane z powodu braku konfiguracji usługi. To urządzenie nadal jest zapisane.",
  denied:
    "Powiadomienia są zablokowane w przeglądarce. Zmień jej ustawienia dla tej strony, aby je włączyć.",
  disabled: "Powiadomienia na tym urządzeniu są wyłączone.",
  enabled: "Powiadomienia na tym urządzeniu są włączone.",
  expired: "Subskrypcja tego urządzenia wygasła. Włącz powiadomienia ponownie.",
  error: "Nie udało się sprawdzić ustawień urządzenia. Spróbuj ponownie.",
};

export function PushSettings({
  userId,
  publicKey,
}: {
  userId: string;
  publicKey: string | null;
}) {
  const [status, setStatus] = useState<PushSettingsStatus>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [iosHint, setIosHint] = useState(false);
  async function inspect() {
    return inspectDevicePush(userId, publicKey, devicePushStatus);
  }
  useEffect(() => {
    let active = true;
    const isiOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const showInstallHint =
      isiOS && !window.matchMedia("(display-mode: standalone)").matches;
    void inspect()
      .then((value) => {
        if (active) {
          setStatus(value);
          setIosHint(showInstallHint);
        }
      })
      .catch(() => {
        if (active) {
          setStatus("error");
          setIosHint(showInstallHint);
        }
      });
    return () => {
      active = false;
    };
    // The browser's permission is deliberately read only on mount or user action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, publicKey]);

  async function enable() {
    setBusy(true);
    setMessage("");
    let subscription: PushSubscription | null = null;
    try {
      if (!publicKey) {
        setStatus("unconfigured");
        return;
      }
      // Permission is requested directly in the user's click gesture (Safari).
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "disabled");
        return;
      }
      await reconcilePushOwner(userId);
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;
      subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      });
      const serial = subscription.toJSON();
      if (!serial.endpoint || !serial.keys?.p256dh || !serial.keys.auth)
        throw new Error("Invalid device subscription");
      const result = await saveDevicePush({
        endpoint: serial.endpoint,
        keys: { p256dh: serial.keys.p256dh, auth: serial.keys.auth },
      });
      if ("error" in result) {
        await subscription.unsubscribe();
        setMessage(result.error);
        setStatus("disabled");
        return;
      }
      setPushOwner(userId);
      setStatus("enabled");
      setMessage(
        "Włączone. Nowe wiadomości mogą od teraz pojawiać się na tym urządzeniu.",
      );
    } catch {
      if (subscription) await subscription.unsubscribe().catch(() => {});
      setStatus("error");
      setMessage(
        "Nie udało się włączyć powiadomień. Sprawdź połączenie i ustawienia przeglądarki.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const result = await disableDevicePush(subscription.endpoint);
        if ("error" in result) {
          setMessage(result.error);
          return;
        }
      }
      await clearBrowserPush();
      setStatus(publicKey ? "disabled" : "unconfigured");
      setMessage(
        "Wyłączone na tym urządzeniu. Wiadomości pozostają w skrzynce aplikacji.",
      );
    } catch {
      setMessage("Nie udało się dokończyć zmiany. Spróbuj ponownie.");
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    setMessage("");
    try {
      setStatus(await inspect());
    } catch {
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card pad stack" aria-labelledby="device-push-title">
      <div>
        <h3 id="device-push-title">
          <BellRing size={18} aria-hidden="true" /> Powiadomienia na urządzeniu
        </h3>
        <p className="muted">
          Dobrowolne, tylko na tym urządzeniu. Na ekranie pojawi się ogólny
          komunikat; szczegóły otworzysz po zalogowaniu.
        </p>
      </div>
      <p role="status">{labels[status]}</p>
      {iosHint && (
        <p className="muted">
          Na iPhonie lub iPadzie dodaj Psi Pawer do ekranu początkowego w menu
          udostępniania Safari, a następnie otwórz aplikację z tej ikony.
        </p>
      )}
      <div className="actions">
        {["enabled", "enabled_unconfigured"].includes(status) && (
          <button
            type="button"
            className="ghost-button"
            disabled={busy}
            onClick={disable}
          >
            {busy ? "Zapisuję…" : "Wyłącz na tym urządzeniu"}
          </button>
        )}
        {["disabled", "expired"].includes(status) && publicKey && (
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={enable}
          >
            {busy ? "Włączam…" : "Włącz na tym urządzeniu"}
          </button>
        )}
        {["error", "denied", "expired"].includes(status) && (
          <button
            type="button"
            className="ghost-button"
            disabled={busy}
            onClick={refresh}
          >
            Sprawdź ponownie
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      <p className="muted">
        Skrzynka działa niezależnie od push. System urządzenia może opóźnić
        dostarczenie; przyjęcie wiadomości przez dostawcę nie oznacza jej
        przeczytania.
      </p>
    </section>
  );
}
