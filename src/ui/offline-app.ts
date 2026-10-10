function cacheReady(worker: ServiceWorker): Promise<boolean> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = (ready: boolean): void => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), 5000);
    channel.port1.onmessage = event => finish(event.data?.ready === true);
    worker.postMessage({ type: 'OFFLINE_STATUS' }, [channel.port2]);
  });
}

export function setupOfflineApp(): void {
  const status = document.getElementById('offline-status');
  const guide = document.getElementById('install-guide');
  if (!status) return;
  const standalone = window.matchMedia('(display-mode: standalone)');
  const refreshGuide = (): void => {
    if (guide) guide.hidden = standalone.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  };
  refreshGuide();
  standalone.addEventListener('change', refreshGuide);

  if (!window.isSecureContext) {
    status.textContent = 'Über diesen WLAN-Testlink ist Offlinebetrieb noch nicht verfügbar. Dafür brauchst du einen HTTPS-Link.';
    return;
  }
  if (!('serviceWorker' in navigator)) {
    status.textContent = 'Dieser Browser unterstützt den Offlinebetrieb nicht.';
    return;
  }

  let registration: ServiceWorkerRegistration | null = null;
  let checking = false;
  const refreshStatus = async (): Promise<void> => {
    const worker = navigator.serviceWorker.controller ?? registration?.active;
    if (!worker || checking) return;
    checking = true;
    try {
      const ready = await cacheReady(worker);
      status.textContent = ready
        ? `${navigator.onLine ? 'Offline bereit.' : 'Du spielst offline.'}${registration?.waiting ? ' Ein Update ist beim nächsten vollständigen Öffnen bereit.' : ''}`
        : 'Das Spiel ist noch nicht vollständig offline gespeichert. Bitte einmal mit Internet erneut öffnen.';
    } catch {
      status.textContent = 'Offlinebetrieb konnte nicht geprüft werden. Bitte öffne die App erneut.';
    } finally {
      checking = false;
    }
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => { void refreshStatus(); });
  window.addEventListener('online', () => { void refreshStatus(); });
  window.addEventListener('offline', () => { void refreshStatus(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshStatus(); });

  void navigator.serviceWorker.register(new URL('./sw.js', document.baseURI), {
    scope: new URL('./', document.baseURI).href,
    updateViaCache: 'none',
  }).then(async result => {
    registration = result;
    const watch = (worker: ServiceWorker | null): void => {
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' || worker.state === 'activated') void refreshStatus();
        if (worker.state === 'redundant' && !result.active) status.textContent = 'Offline speichern hat nicht geklappt. Bitte mit Internet erneut öffnen.';
      });
    };
    watch(result.installing);
    result.addEventListener('updatefound', () => watch(result.installing));
    await navigator.serviceWorker.ready;
    await refreshStatus();
  }).catch(() => {
    status.textContent = 'Offline speichern hat nicht geklappt. Bitte mit Internet erneut öffnen.';
  });
}
