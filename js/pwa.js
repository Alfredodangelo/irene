// =============================================
//  PWA - Registrazione Service Worker + Install Banner
//  Irene Gipsy Tattoo
// =============================================

(function () {
  // 1. Registra Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('/service-worker.js');
        console.log('[PWA] SW registrato, scope:', reg.scope);

        // Controlla aggiornamenti ogni 60 minuti
        setInterval(() => reg.update(), 60 * 60 * 1000);

        // Notifica aggiornamento disponibile
        reg.addEventListener('updatefound', () => {
          const newSW = reg.installing;
          if (!newSW) return;
          newSW.addEventListener('statechange', () => {
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner();
            }
          });
        });
      } catch (err) {
        console.warn('[PWA] SW registrazione fallita:', err);
      }
    });
  }

  // 2. Install Banner (A2HS - Add to Home Screen)
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Mostra il banner solo se non e' gia' installata come PWA
    if (!isStandalone()) {
      setTimeout(showInstallBanner, 3000); // Aspetta 3s prima di mostrare
    }
  });

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  function showInstallBanner() {
    // Non mostrare se utente ha gia' detto "no" nelle ultime 7 giorni
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.innerHTML = `
      <div class="pwa-banner-content">
        <img src="/icons/icon-192x192.png" alt="IGT" class="pwa-banner-icon">
        <div class="pwa-banner-text">
          <strong>Installa l'app</strong>
          <span>Accesso rapido dalla home del telefono</span>
        </div>
        <button class="pwa-banner-install" id="pwa-btn-install">Installa</button>
        <button class="pwa-banner-close" id="pwa-btn-close" aria-label="Chiudi">&times;</button>
      </div>
    `;
    document.body.appendChild(banner);

    // Forza reflow per animazione
    requestAnimationFrame(() => {
      requestAnimationFrame(() => banner.classList.add('pwa-banner-show'));
    });

    document.getElementById('pwa-btn-install').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      console.log('[PWA] Install choice:', result.outcome);
      deferredPrompt = null;
      banner.remove();
    });

    document.getElementById('pwa-btn-close').addEventListener('click', () => {
      localStorage.setItem('pwa-install-dismissed', Date.now().toString());
      banner.classList.remove('pwa-banner-show');
      setTimeout(() => banner.remove(), 400);
    });
  }

  // 3. Banner aggiornamento disponibile
  function showUpdateBanner() {
    const banner = document.createElement('div');
    banner.id = 'pwa-update-banner';
    banner.innerHTML = `
      <div class="pwa-banner-content">
        <div class="pwa-banner-text">
          <strong>Aggiornamento disponibile</strong>
          <span>Tocca per aggiornare l'app</span>
        </div>
        <button class="pwa-banner-install" id="pwa-btn-update">Aggiorna</button>
      </div>
    `;
    document.body.appendChild(banner);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => banner.classList.add('pwa-banner-show'));
    });

    document.getElementById('pwa-btn-update').addEventListener('click', () => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage('skipWaiting');
      }
      window.location.reload();
    });
  }

  // 4. iOS: mostra istruzioni manuali (Safari non supporta beforeinstallprompt)
  window.addEventListener('load', () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS && !isStandalone()) {
      const dismissed = localStorage.getItem('pwa-ios-dismissed');
      if (dismissed && Date.now() - parseInt(dismissed) < 14 * 24 * 60 * 60 * 1000) return;

      setTimeout(() => {
        const banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.innerHTML = `
          <div class="pwa-banner-content">
            <img src="/icons/icon-192x192.png" alt="IGT" class="pwa-banner-icon">
            <div class="pwa-banner-text">
              <strong>Installa l'app</strong>
              <span>Tocca <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="2" style="vertical-align:middle;margin:0 2px"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> poi <em>"Aggiungi alla schermata Home"</em></span>
            </div>
            <button class="pwa-banner-close" id="pwa-btn-close-ios" aria-label="Chiudi">&times;</button>
          </div>
        `;
        document.body.appendChild(banner);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => banner.classList.add('pwa-banner-show'));
        });

        document.getElementById('pwa-btn-close-ios').addEventListener('click', () => {
          localStorage.setItem('pwa-ios-dismissed', Date.now().toString());
          banner.classList.remove('pwa-banner-show');
          setTimeout(() => banner.remove(), 400);
        });
      }, 5000);
    }
  });
})();
