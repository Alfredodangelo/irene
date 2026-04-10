// =============================================
//  PWA - Registrazione Service Worker + Install
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

  // 2. Cattura evento install (Android Chrome)
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Mostra i pulsanti "Installa App" nelle dashboard
    document.querySelectorAll('.pwa-install-section').forEach((el) => {
      el.style.display = '';
    });
  });

  // Nascondi se gia' installata
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    document.querySelectorAll('.pwa-install-section').forEach((el) => {
      el.style.display = 'none';
    });
  });

  // Funzione globale chiamata dal pulsante
  window.pwaInstall = async function () {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      console.log('[PWA] Install choice:', result.outcome);
      if (result.outcome === 'accepted') {
        deferredPrompt = null;
        document.querySelectorAll('.pwa-install-section').forEach((el) => {
          el.style.display = 'none';
        });
      }
    }
  };

  // 3. iOS: mostra istruzioni (Safari non supporta beforeinstallprompt)
  window.addEventListener('load', () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;

    if (isIOS && !isStandalone) {
      // Su iOS mostra la sezione con le istruzioni manuali
      document.querySelectorAll('.pwa-install-section').forEach((el) => {
        el.style.display = '';
      });
      document.querySelectorAll('.pwa-install-btn').forEach((el) => {
        el.style.display = 'none';
      });
      document.querySelectorAll('.pwa-ios-instructions').forEach((el) => {
        el.style.display = '';
      });
    }

    // Se gia' installata come PWA, nascondi tutto
    if (isStandalone) {
      document.querySelectorAll('.pwa-install-section').forEach((el) => {
        el.style.display = 'none';
      });
    }
  });

  // 4. Banner aggiornamento disponibile (questo resta come overlay minimale)
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
})();
