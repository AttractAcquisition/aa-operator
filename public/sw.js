self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || 'AA Operator';
  const options = {
    body: data.body || '',
    icon: data.icon || '/favicon.svg',
    badge: data.badge || '/favicon.svg',
    tag: data.tag || 'aa-operator',
    data: { url: data.url || '/' },
    requireInteraction: data.requireInteraction || false,
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
