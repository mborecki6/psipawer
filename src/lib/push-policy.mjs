// Shared validation: the browser and the worker cannot choose arbitrary hosts.
export function allowedPushEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      !url.search &&
      url.pathname.length > 1 &&
      [
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function validPushSubscription(value) {
  return Boolean(
    value &&
    allowedPushEndpoint(value.endpoint) &&
    /^[A-Za-z0-9_-]{87}$/.test(value.keys?.p256dh || "") &&
    /^[A-Za-z0-9_-]{22}$/.test(value.keys?.auth || ""),
  );
}

export function pushConfiguration(values) {
  const publicKey = values.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = values.VAPID_PRIVATE_KEY;
  const subject = values.VAPID_SUBJECT;
  if (
    !/^[A-Za-z0-9_-]{87}$/.test(publicKey || "") ||
    !/^[A-Za-z0-9_-]{43}$/.test(privateKey || "")
  )
    return null;
  try {
    const url = new URL(subject || "");
    if (url.protocol === "mailto:") {
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url.pathname) ||
        url.search ||
        url.hash
      )
        return null;
    } else if (
      url.protocol !== "https:" ||
      !url.hostname.includes(".") ||
      url.hostname.endsWith(".localhost") ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return null;
  } catch {
    return null;
  }
  return { publicKey, privateKey, subject };
}

export function pushOutcome(statusCode) {
  if (statusCode >= 200 && statusCode < 300) return "accepted";
  if (statusCode === 404 || statusCode === 410) return "expired";
  if (
    !statusCode ||
    [408, 409, 425, 429].includes(statusCode) ||
    statusCode >= 500
  )
    return "retry";
  return "failed";
}

export function privatePushPayload(role, notificationId) {
  return JSON.stringify({
    title: "Psi Pawer",
    body: "Masz nową wiadomość w aplikacji.",
    url: role === "admin" ? "/admin/notifications" : "/app/notifications",
    // Stable tag coalesces delivery retries; no private domain identifiers.
    tag: `psi-${notificationId}`,
  });
}
