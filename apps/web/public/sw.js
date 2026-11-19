// Riptide Alerts: shows pushed margin warnings and opens the Lifeline on click.
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "OMNITIDE Riptide", {
      body: data.body || "Your margin is approaching the sea wall.",
      icon: "/icon.png",
      badge: "/icon.png",
      data: { url: data.url || "/terminal/portfolio#lifeline" },
      tag: "riptide",
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data.url));
});
