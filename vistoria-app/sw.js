// Service worker do app de vistorias: só permite instalar o app na tela inicial.
// Não guarda nada em cache (o app funciona só com internet, como o link de vistoria).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
