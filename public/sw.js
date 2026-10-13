/* Psi Pawer notifications only. No fetch interception or private page cache. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data?.json();
  } catch {
    return;
  }
  if (
    !data ||
    !["/app/notifications", "/admin/notifications"].includes(data.url)
  )
    return;
  event.waitUntil(
    self.registration.showNotification("Psi Pawer", {
      body: "Masz nową wiadomość w aplikacji.",
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      tag:
        typeof data.tag === "string" && /^psi-[0-9a-f-]{36}$/i.test(data.tag)
          ? data.tag
          : "psi-inbox",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = ["/app/notifications", "/admin/notifications"].includes(
    event.notification.data?.url,
  )
    ? event.notification.data.url
    : "/";
  event.waitUntil(
    self.clients.openWindow(new URL(path, self.location.origin).href),
  );
});
