self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "Rio Movil", {
      body: data.body || "Tenes una novedad en la app.",
      icon: "/rio-movil-logo.png",
      badge: "/rio-movil-logo.png",
      data: data.url || "/"
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data || "/"));
});
