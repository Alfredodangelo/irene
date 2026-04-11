// =============================================
//  PWA - Service Worker + Install + Push Notifications
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

        // Tenta sottoscrizione push se gia' autorizzata
        if (typeof VAPID_PUBLIC_KEY !== 'undefined' && VAPID_PUBLIC_KEY !== 'INSERISCI_QUI_LA_VAPID_PUBLIC_KEY') {
          initPushSubscription(reg);
        }
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
    document.querySelectorAll('.pwa-install-section').forEach((el) => {
      el.style.display = '';
    });
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    document.querySelectorAll('.pwa-install-section').forEach((el) => {
      el.style.display = 'none';
    });
  });

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

  // 3. iOS: mostra istruzioni
  window.addEventListener('load', () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;

    if (isIOS && !isStandalone) {
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

    if (isStandalone) {
      document.querySelectorAll('.pwa-install-section').forEach((el) => {
        el.style.display = 'none';
      });
    }

    // Aggiorna UI notifiche in base allo stato attuale
    updateNotificationUI();
  });

  // 4. Banner aggiornamento disponibile
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

  // =============================================
  //  5. PUSH NOTIFICATIONS
  // =============================================

  // Converte VAPID base64 URL-safe in Uint8Array
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // Init push: se il permesso e' gia' "granted", sottoscrivi automaticamente
  async function initPushSubscription(reg) {
    if (!('PushManager' in window)) return;

    const permission = Notification.permission;
    if (permission === 'granted') {
      await subscribeToPush(reg);
    }
    // Se "default" (mai chiesto), la UI fara' il prompt
    // Se "denied", non fare nulla
  }

  // Sottoscrivi al push e salva su Supabase
  async function subscribeToPush(reg) {
    try {
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      let subscription = await reg.pushManager.getSubscription();

      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey
        });
        console.log('[Push] Nuova sottoscrizione creata');
      }

      // Salva su Supabase
      await savePushSubscription(subscription);
      updateNotificationUI();
      return subscription;
    } catch (err) {
      console.error('[Push] Errore sottoscrizione:', err);
      return null;
    }
  }

  // Salva la subscription nel DB
  async function savePushSubscription(subscription) {
    if (typeof db === 'undefined') return;

    const { data: { user } } = await db.auth.getUser();
    if (!user) return;

    const subJSON = subscription.toJSON();
    const payload = {
      user_id: user.id,
      endpoint: subJSON.endpoint,
      p256dh: subJSON.keys.p256dh,
      auth: subJSON.keys.auth,
      user_agent: navigator.userAgent
    };

    const { error } = await db
      .from('push_subscriptions')
      .upsert(payload, { onConflict: 'user_id,endpoint' });

    if (error) {
      console.error('[Push] Errore salvataggio subscription:', error);
    } else {
      console.log('[Push] Subscription salvata su Supabase');
    }
  }

  // Rimuovi subscription
  async function unsubscribeFromPush() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();

        // Rimuovi da Supabase
        if (typeof db !== 'undefined') {
          const { data: { user } } = await db.auth.getUser();
          if (user) {
            await db.from('push_subscriptions')
              .delete()
              .eq('user_id', user.id)
              .eq('endpoint', endpoint);
          }
        }
        console.log('[Push] Disattivate');
      }
      updateNotificationUI();
    } catch (err) {
      console.error('[Push] Errore disattivazione:', err);
    }
  }

  // Aggiorna la UI dei pulsanti notifica
  function updateNotificationUI() {
    const enableBtns = document.querySelectorAll('.push-enable-btn');
    const disableBtns = document.querySelectorAll('.push-disable-btn');
    const statusEls = document.querySelectorAll('.push-status');

    if (!('PushManager' in window) || !('Notification' in window)) {
      // Push non supportato
      enableBtns.forEach(b => { b.style.display = 'none'; });
      disableBtns.forEach(b => { b.style.display = 'none'; });
      statusEls.forEach(el => {
        el.textContent = 'Notifiche push non supportate su questo browser';
        el.style.color = '#888';
      });
      return;
    }

    const permission = Notification.permission;

    if (permission === 'granted') {
      enableBtns.forEach(b => { b.style.display = 'none'; });
      disableBtns.forEach(b => { b.style.display = ''; });
      statusEls.forEach(el => {
        el.innerHTML = '<i class="fas fa-check-circle" style="color:var(--green,#55c97a);margin-right:6px;"></i>Notifiche attive';
        el.style.color = 'var(--green, #55c97a)';
      });
    } else if (permission === 'denied') {
      enableBtns.forEach(b => { b.style.display = 'none'; });
      disableBtns.forEach(b => { b.style.display = 'none'; });
      statusEls.forEach(el => {
        el.textContent = 'Notifiche bloccate. Riattivale dalle impostazioni del browser.';
        el.style.color = 'var(--red, #e05555)';
      });
    } else {
      // "default" - mai chiesto
      enableBtns.forEach(b => { b.style.display = ''; });
      disableBtns.forEach(b => { b.style.display = 'none'; });
      statusEls.forEach(el => {
        el.textContent = '';
      });
    }
  }

  // Funzione globale: richiedi permesso e sottoscrivi
  window.pushNotificationsEnable = async function () {
    if (!('PushManager' in window)) {
      alert('Il tuo browser non supporta le notifiche push.');
      return;
    }

    // Verifica VAPID key configurata
    if (typeof VAPID_PUBLIC_KEY === 'undefined' || VAPID_PUBLIC_KEY === 'INSERISCI_QUI_LA_VAPID_PUBLIC_KEY') {
      console.error('[Push] VAPID_PUBLIC_KEY non configurata in push-config.js');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const reg = await navigator.serviceWorker.ready;
      await subscribeToPush(reg);
      // Feedback
      if (typeof showToast === 'function') {
        showToast('Notifiche attivate!');
      }
    } else if (permission === 'denied') {
      if (typeof showToast === 'function') {
        showToast('Notifiche bloccate dal browser.', true);
      }
    }
    updateNotificationUI();
  };

  // Funzione globale: disattiva notifiche
  window.pushNotificationsDisable = async function () {
    await unsubscribeFromPush();
    if (typeof showToast === 'function') {
      showToast('Notifiche disattivate.');
    }
  };

})();
