self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(clients.openWindow(new URL('./web-notifications.html?notification=clicked', self.location.href).href));
});
