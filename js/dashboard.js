// =============================================
//  DASHBOARD - Irene Gipsy Tattoo
//  Area personale cliente
// =============================================

// ⚠️ WIP: impostare false prima del lancio ufficiale
const WIP_MODE = true;

let currentUser = null;
let profileIti  = null; // intl-tel-input per il campo cellulare del profilo
let currentProfile = null;
let allVouchers           = [];
let allReschedules        = [];
let currentWaitlist       = null;
let allAdvanceOffers      = [];
let allClientAppointments        = []; // usato da openRebookModal
let currentClientSedutaEnabled       = false; // permesso per-cliente prenotazione seduta
let currentClientDeletionRequestedAt = null;  // timestamp richiesta cancellazione account
let currentBookingTokenValid         = false; // token temporaneo QR/30min valido
let currentBookingToken              = null;  // token string corrente
let clientHasSignedConsent           = false; // true se ha già firmato almeno un consenso

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
(async function init() {
    // 1. Prova sessione già esistente (utente già loggato)
    const { data: { session } } = await db.auth.getSession();

    if (session) {
        await setupDashboard(session.user);
        return;
    }

    // 2. Nessuna sessione immediata: potrebbe essere il ritorno da
    //    magic link / OAuth (token ancora da scambiare nell'URL).
    //    Aspetta l'evento SIGNED_IN dal client Supabase.
    let resolved = false;

    const { data: { subscription } } = db.auth.onAuthStateChange(async (event, s) => {
        if (resolved) return;

        if (event === 'SIGNED_IN' && s) {
            resolved = true;
            subscription.unsubscribe();
            await setupDashboard(s.user);
        }
    });

    // 3. Se dopo 4 secondi ancora nessuna sessione → login
    setTimeout(() => {
        if (!resolved) {
            subscription.unsubscribe();
            window.location.href = 'login.html';
        }
    }, 4000);
})();

async function setupDashboard(user) {
    currentUser = user;
    renderUserInfo(user);
    checkFirstLogin(user);

    // Controlla token prenotazione (?bt=...) prima del resto
    await validateBookingToken(user.id);

    await loadAllData();
    await loadProfile();
    initTabs();
    initGalleryUpload();
    initProfilePhone();
    initProfileSave();
    initPasswordChange();

    // Realtime: aggiorna automaticamente quando cambiano i dati del cliente
    const uid = user.id;
    db.channel('client-dashboard-' + uid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments',
            filter: `client_id=eq.${uid}` }, () => loadAllData())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reschedule_requests',
            filter: `client_id=eq.${uid}` }, () => loadAllData())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications',
            filter: `client_id=eq.${uid}` }, () => loadAllData())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'waitlist',
            filter: `client_id=eq.${uid}` }, () => loadAllData())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'waitlist_requests',
            filter: `client_id=eq.${uid}` }, () => loadAllData())
        .subscribe();

    // Ascolta logout da altre schede
    db.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') window.location.href = 'login.html';
    });
}

// ─────────────────────────────────────────────
//  BOOKING TOKEN – validazione QR / 30 min
// ─────────────────────────────────────────────
async function validateBookingToken(uid) {
    const params = new URLSearchParams(window.location.search);
    const bt = params.get('bt');
    if (!bt) return;

    const { data: tokenRow } = await db.from('booking_tokens')
        .select('client_id, expires_at, used_at')
        .eq('token', bt)
        .maybeSingle();

    if (!tokenRow) return; // token non trovato
    if (tokenRow.client_id !== uid) return; // token di un altro cliente
    if (tokenRow.used_at) return; // già usato
    if (new Date(tokenRow.expires_at) < new Date()) {
        // Scaduto: pulizia e uscita
        await db.from('booking_tokens').delete().eq('token', bt);
        return;
    }

    // Token valido
    currentBookingTokenValid = true;
    currentBookingToken      = bt;

    window._bookingTokenExpiresAt = new Date(tokenRow.expires_at);
}

// ─────────────────────────────────────────────
//  CAMBIO PASSWORD – PRIMO ACCESSO
// ─────────────────────────────────────────────
function checkFirstLogin(user) {
    if (!user.user_metadata?.must_change_password) return;

    const overlay = document.getElementById('chpwdOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';

    document.getElementById('chpwdBtn').addEventListener('click', async () => {
        const pwd1 = document.getElementById('chpwd1').value;
        const pwd2 = document.getElementById('chpwd2').value;
        const msg  = document.getElementById('chpwdMsg');
        const btn  = document.getElementById('chpwdBtn');

        msg.className = 'chpwd-msg';
        msg.textContent = '';

        if (pwd1.length < 8) {
            msg.textContent = 'La password deve avere almeno 8 caratteri.';
            return;
        }
        if (pwd1 !== pwd2) {
            msg.textContent = 'Le password non coincidono.';
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvataggio...';

        const { error } = await db.auth.updateUser({
            password: pwd1,
            data: { must_change_password: false },
        });

        if (error) {
            msg.textContent = 'Errore: ' + error.message;
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-lock"></i> Salva password';
        } else {
            msg.className = 'chpwd-msg ok';
            msg.textContent = 'Password aggiornata! Accedi al tuo profilo.';
            setTimeout(() => { overlay.style.display = 'none'; }, 1500);
        }
    });

    // Invia con Enter dal secondo campo
    document.getElementById('chpwd2').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('chpwdBtn').click();
    });
}

// ─────────────────────────────────────────────
//  PROFILO
// ─────────────────────────────────────────────
async function loadProfile() {
    const { data } = await db.from('clients')
        .select('first_name, last_name, phone, email, newsletter_consent')
        .eq('id', currentUser.id)
        .single();

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el && val) el.value = val;
    };

    if (data) {
        set('profileNome',    data.first_name);
        set('profileCognome', data.last_name);
        if (data.phone) {
            if (profileIti) profileIti.setNumber(data.phone);
            else set('profilePhone', data.phone);
        }

        // Aggiorna nome in topbar con i dati più aggiornati dalla tabella clients
        const fullName = [data.first_name, data.last_name].filter(Boolean).join(' ');
        if (fullName) updateTopbarName(fullName, null);

        // Newsletter: aggiorna UI con valore corrente
        renderNewsletterButtons(data.newsletter_consent);

        // Se newsletter_consent è null, controlla localStorage (set da consulenza.js)
        if (data.newsletter_consent === null || data.newsletter_consent === undefined) {
            const pending = localStorage.getItem('pendingNewsletterConsent');
            if (pending !== null) {
                const consent = pending === 'true';
                localStorage.removeItem('pendingNewsletterConsent');
                await saveNewsletterConsent(consent, false); // false = no email al primo caricamento
            }
        }
    }

    // Email è sempre da auth (read-only)
    const emailEl = document.getElementById('profileEmail');
    if (emailEl) emailEl.value = currentUser.email || '';

    // Se nome mancante → modal completamento profilo (Google OAuth o qualsiasi caso edge)
    if (!data?.first_name) {
        showCompleteProfileModal();
    }
}

function showCompleteProfileModal() {
    const meta     = currentUser.user_metadata || {};
    const fullName = (meta.full_name || meta.name || '').trim();
    const parts    = fullName.split(' ');
    const nome     = parts[0] || '';
    const cognome  = parts.slice(1).join(' ') || '';

    const nomeEl    = document.getElementById('cpNome');
    const cognomeEl = document.getElementById('cpCognome');
    const emailEl   = document.getElementById('cpEmail');
    if (nomeEl && nome)       nomeEl.value    = nome;
    if (cognomeEl && cognome) cognomeEl.value = cognome;
    if (emailEl)              emailEl.value   = currentUser.email || '';

    // Inizializza intl-tel-input sul campo cellulare
    let cpIti = null;
    const phoneInput = document.getElementById('cpPhone');
    if (phoneInput && window.intlTelInput) {
        // Distruggi eventuale istanza precedente
        if (phoneInput._cpItiInstance) {
            phoneInput._cpItiInstance.destroy();
        }
        cpIti = window.intlTelInput(phoneInput, {
            initialCountry: 'it',
            preferredCountries: ['it'],
            utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@18.2.1/build/js/utils.js',
        });
        phoneInput._cpItiInstance = cpIti;
    }

    document.getElementById('completeProfileOverlay').style.display = 'flex';

    document.getElementById('cpSaveBtn').onclick = async () => {
        const n   = document.getElementById('cpNome').value.trim();
        const c   = document.getElementById('cpCognome').value.trim();
        const msg = document.getElementById('cpMsg');
        const btn = document.getElementById('cpSaveBtn');

        msg.textContent = '';
        msg.className   = 'chpwd-msg';

        if (!n) {
            msg.textContent = 'Il nome è obbligatorio.';
            msg.className = 'chpwd-msg err';
            return;
        }
        if (!c) {
            msg.textContent = 'Il cognome è obbligatorio.';
            msg.className = 'chpwd-msg err';
            return;
        }

        // Validazione cellulare
        const phoneRaw = cpIti ? cpIti.getNumber() : (document.getElementById('cpPhone').value.trim());
        if (!phoneRaw || phoneRaw.length < 5) {
            msg.textContent = 'Il cellulare è obbligatorio.';
            msg.className = 'chpwd-msg err';
            return;
        }
        if (cpIti && !cpIti.isValidNumber()) {
            msg.textContent = 'Numero di telefono non valido.';
            msg.className = 'chpwd-msg err';
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Salvataggio...';

        const { error } = await db.from('clients').upsert({
            id:         currentUser.id,
            email:      currentUser.email,
            first_name: n,
            last_name:  c,
            phone:      phoneRaw,
        }, { onConflict: 'id' });

        if (error) {
            msg.textContent = 'Errore: ' + error.message;
            msg.className = 'chpwd-msg err';
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Salva e continua';
            return;
        }

        document.getElementById('completeProfileOverlay').style.display = 'none';
        updateTopbarName(`${n} ${c}`, null);
        document.getElementById('profileNome').value    = n;
        document.getElementById('profileCognome').value = c;
        if (profileIti) profileIti.setNumber(phoneRaw);
    };
}

function renderNewsletterButtons(consent) {
    const yesBtn = document.getElementById('nlYesBtn');
    const noBtn  = document.getElementById('nlNoBtn');
    if (!yesBtn || !noBtn) return;
    // Reset
    yesBtn.style.background = 'transparent';
    yesBtn.style.color = '#aaa';
    yesBtn.style.borderColor = 'rgba(212,175,55,0.35)';
    noBtn.style.background = 'transparent';
    noBtn.style.color = '#aaa';
    noBtn.style.borderColor = 'rgba(255,255,255,0.1)';
    if (consent === true) {
        yesBtn.style.background = 'rgba(212,175,55,0.15)';
        yesBtn.style.color = '#D4AF37';
        yesBtn.style.borderColor = '#D4AF37';
    } else if (consent === false) {
        noBtn.style.background = 'rgba(255,255,255,0.06)';
        noBtn.style.color = '#ccc';
        noBtn.style.borderColor = 'rgba(255,255,255,0.25)';
    }
}

const NEWSLETTER_CONSENT_EMAIL_URL = 'https://n8n.srv1204993.hstgr.cloud/webhook/newsletter-consent';

async function saveNewsletterConsent(consent, sendEmail = true) {
    const msg = document.getElementById('nlMsg');
    if (msg) { msg.className = 'profile-msg'; msg.textContent = ''; }

    const { error } = await db.from('clients')
        .update({ newsletter_consent: consent, updated_at: new Date().toISOString() })
        .eq('id', currentUser.id);

    if (error) {
        if (msg) { msg.textContent = 'Errore: ' + error.message; msg.className = 'profile-msg show err'; }
        return;
    }

    renderNewsletterButtons(consent);

    if (msg) {
        msg.textContent = consent
            ? 'Iscritto alla newsletter!'
            : 'Disiscritto dalla newsletter.';
        msg.className = 'profile-msg show ok';
        setTimeout(() => { msg.className = 'profile-msg'; }, 4000);
    }

    // Invia email conferma (fire-and-forget)
    if (sendEmail) {
        fetch(NEWSLETTER_CONSENT_EMAIL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                consent,
                client_email: currentUser.email,
                client_name:  currentUser.user_metadata?.full_name || currentUser.email,
            }),
        }).catch(e => console.warn('[newsletter-consent]', e));
    }
}

function initPasswordChange() {
    document.getElementById('savePwdBtn').addEventListener('click', async () => {
        const btn     = document.getElementById('savePwdBtn');
        const msg     = document.getElementById('pwdMsg');
        const pwdNew  = document.getElementById('pwdNew').value;
        const pwdConf = document.getElementById('pwdConfirm').value;

        msg.className = 'profile-msg';
        msg.textContent = '';

        if (pwdNew.length < 8) {
            msg.textContent = 'La password deve avere almeno 8 caratteri.';
            msg.className = 'profile-msg show err';
            return;
        }
        if (pwdNew !== pwdConf) {
            msg.textContent = 'Le password non coincidono.';
            msg.className = 'profile-msg show err';
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvataggio...';

        const { error } = await db.auth.updateUser({ password: pwdNew });

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-lock"></i> Aggiorna password';

        if (error) {
            msg.textContent = 'Errore: ' + error.message;
            msg.className = 'profile-msg show err';
        } else {
            document.getElementById('pwdNew').value = '';
            document.getElementById('pwdConfirm').value = '';
            msg.textContent = 'Password aggiornata con successo!';
            msg.className = 'profile-msg show ok';
            setTimeout(() => { msg.className = 'profile-msg'; }, 4000);
        }
    });
}

function initProfilePhone() {
    const el = document.getElementById('profilePhone');
    if (!el || !window.intlTelInput) return;
    profileIti = window.intlTelInput(el, {
        initialCountry: 'it',
        preferredCountries: ['it'],
        utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@18.2.1/build/js/utils.js',
    });
}

function initProfileSave() {
    document.getElementById('saveProfileBtn').addEventListener('click', async () => {
        const btn = document.getElementById('saveProfileBtn');
        const msg = document.getElementById('profileMsg');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvataggio...';

        const first_name = document.getElementById('profileNome').value.trim();
        const last_name  = document.getElementById('profileCognome').value.trim();
        const phone      = profileIti ? profileIti.getNumber() : document.getElementById('profilePhone').value.trim();

        const { error } = await db.from('clients').upsert({
            id: currentUser.id,
            email: currentUser.email,
            first_name,
            last_name,
            full_name: [first_name, last_name].filter(Boolean).join(' '),
            phone,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Salva dati';

        if (error) {
            msg.textContent = 'Errore: ' + error.message;
            msg.className = 'profile-msg show err';
        } else {
            msg.textContent = 'Dati salvati! Saranno pre-compilati nelle prenotazioni.';
            msg.className = 'profile-msg show ok';
            setTimeout(() => { msg.className = 'profile-msg'; }, 4000);
        }
    });
}

// ─────────────────────────────────────────────
//  USER INFO
// ─────────────────────────────────────────────
function renderUserInfo(user) {
    const meta = user.user_metadata || {};
    const fromMeta = [meta.first_name, meta.last_name].filter(Boolean).join(' ');
    const name = meta.full_name || meta.name || fromMeta || user.email.split('@')[0];
    const avatar = meta.avatar_url || meta.picture || null;

    updateTopbarName(name, avatar);
    document.getElementById('dashSubtitle').textContent =
        'Bentornato, ' + name + ' · ' + user.email;
}

function updateTopbarName(name, avatar) {
    document.getElementById('userName').textContent = name;
    const avatarEl = document.getElementById('userAvatar');
    if (avatar) {
        const img = document.createElement('img');
        img.src = avatar;
        img.alt = name;
        avatarEl.textContent = '';
        avatarEl.appendChild(img);
    } else {
        avatarEl.textContent = name.charAt(0).toUpperCase();
    }
}

// Logout
document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
        localStorage.removeItem('pendingNewsletterConsent');
        await db.auth.signOut();
        window.location.href = 'index.html';
    } catch (e) {
        showToast('Errore nel logout. Riprova.', 3000, true);
    }
});

// ─────────────────────────────────────────────
//  CARICA TUTTI I DATI
// ─────────────────────────────────────────────
async function loadAllData() {
    const uid = currentUser.id;

    const [apptRes, galleryRes, vouchersRes] = await Promise.all([
        db.from('appointments').select('*').eq('client_id', uid).order('scheduled_at', { ascending: false }),
        db.from('tattoo_gallery').select('*').eq('client_id', uid).order('created_at', { ascending: false }),
        db.from('vouchers').select('*')
            .or(`recipient_email.eq.${currentUser.email},claimed_by_user_id.eq.${uid}`)
            .order('created_at', { ascending: false }),
    ]);

    if (apptRes.error || galleryRes.error || vouchersRes.error) {
        const errMsg = apptRes.error?.message || galleryRes.error?.message || vouchersRes.error?.message;
        showToast('Errore nel caricamento dati: ' + errMsg, true);
    }

    const appointments = apptRes.data || [];
    allClientAppointments = appointments;
    const gallery = galleryRes.data || [];
    allVouchers = vouchersRes.data || [];

    // Carica reschedule_requests filtrate per appointment_id (evita ambiguità RLS su client_id)
    const apptIds = appointments.map(a => a.id);
    if (apptIds.length > 0) {
        const _48hAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { data: rschData } = await db.from('reschedule_requests')
            .select('*')
            .in('appointment_id', apptIds)
            .or(`status.eq.pending,and(status.eq.rejected,resolved_at.gte.${_48hAgo})`)
            .order('created_at', { ascending: false });
        allReschedules = rschData || [];
    } else {
        allReschedules = [];
    }

    // Carica anche waitlist, offerte anticipa pending, permesso prenotazione seduta, notifiche unlock
    const [{ data: waitlistData }, { data: advanceOffersData }, { data: clientRow }, { data: unlockNotif }, { data: lastConsent }] = await Promise.all([
        db.from('waitlist').select('*').eq('client_id', uid).maybeSingle(),
        db.from('seduta_advance_offers').select('*').eq('offered_to_client_id', uid).eq('status', 'pending').order('created_at', { ascending: false }),
        db.from('clients').select('seduta_booking_enabled, deletion_requested_at').eq('id', uid).maybeSingle(),
        db.from('notifications').select('meta,created_at').eq('client_id', uid).eq('type', 'booking_unlock').eq('is_read', false).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        db.from('consent_documents').select('signed_at').eq('client_id', uid).order('signed_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    // Logica consenso: si firma alla prima seduta di OGNI tatuaggio.
    // Se l'ultima seduta completata è più recente dell'ultimo consenso → nuovo tatuaggio → serve firma.
    if (lastConsent?.signed_at) {
        const lastConsentDate = new Date(lastConsent.signed_at);
        const completedSedute = appointments.filter(a => a.type === 'seduta' && a.status === 'completed');
        if (completedSedute.length > 0) {
            const lastCompleted = new Date(completedSedute[0].scheduled_at); // già ordinati desc
            clientHasSignedConsent = lastConsentDate > lastCompleted;
        } else {
            clientHasSignedConsent = true; // ha firmato e nessuna seduta completata → ancora valido
        }
    } else {
        clientHasSignedConsent = false; // mai firmato
    }
    currentWaitlist  = waitlistData;
    allAdvanceOffers = advanceOffersData || [];
    currentClientSedutaEnabled = clientRow ? !!clientRow.seduta_booking_enabled : false;
    currentClientDeletionRequestedAt = clientRow?.deletion_requested_at || null;

    // Se c'è una notifica unlock non letta, verifica se il token è ancora valido e imposta il banner
    if (!currentBookingTokenValid && unlockNotif?.meta) {
        try {
            const meta = JSON.parse(unlockNotif.meta);
            if (meta?.token) {
                const { data: tokenRow } = await db.from('booking_tokens')
                    .select('client_id, expires_at, used_at')
                    .eq('token', meta.token)
                    .maybeSingle();
                if (tokenRow && tokenRow.client_id === uid && !tokenRow.used_at
                    && new Date(tokenRow.expires_at) > new Date()) {
                    currentBookingTokenValid     = true;
                    currentBookingToken          = meta.token;
                    window._bookingTokenExpiresAt = new Date(tokenRow.expires_at);
                }
            }
        } catch(e) { /* ignora errori JSON */ }
    }

    renderAppointments(appointments, waitlistData);
    await renderGallery(gallery);
    renderVouchers(allVouchers);
    renderDeleteAccountStatus();
}

// ─────────────────────────────────────────────
//  HELPER — bottone consenso informato
// ─────────────────────────────────────────────
function getConsentBtnHtml(appt) {
    // Il consenso informato si firma solo alla PRIMA seduta
    if (clientHasSignedConsent) return '';
    if (!appt || appt.type !== 'seduta') return '';
    if (!['pending', 'confirmed'].includes(appt.status)) return '';
    if (!appt.scheduled_at) return '';
    const now      = new Date();
    const apptDate = new Date(appt.scheduled_at);
    const todayStr = now.toLocaleDateString('sv-SE');           // YYYY-MM-DD locale-safe
    const apptStr  = apptDate.toLocaleDateString('sv-SE');
    if (todayStr !== apptStr) return '';                        // solo oggi
    if (now.getHours() < 10) return '';                        // solo dalle 10:00
    return `<a href="consent.html" class="btn-consent"><i class="fas fa-file-signature"></i> Firma Consenso</a>`;
}

// ─────────────────────────────────────────────
//  APPUNTAMENTI – Vista percorso (journey)
// ─────────────────────────────────────────────
function renderAppointments(list, waitlist) {
    const container = document.getElementById('listAppointments');

    // Group by type (list is already sorted desc by scheduled_at)
    const byType = {};
    list.forEach(a => {
        if (!byType[a.type]) byType[a.type] = [];
        byType[a.type].push(a);
    });

    // Appuntamento attivo = il più recente con status pending/confirmed
    // Quelli cancelled/completed vanno tutti nello storico
    const ACTIVE_STATUSES = ['pending', 'confirmed'];
    const consulenza = byType['consulenza']?.find(a => ACTIVE_STATUSES.includes(a.status)) || null;
    const preseduta  = byType['pre-seduta']?.find(a => ACTIVE_STATUSES.includes(a.status))  || null;
    // Tutte le sedute attive, ordinate per data crescente (prima seduta per prima)
    const allActiveSedute = (byType['seduta']?.filter(a => ACTIVE_STATUSES.includes(a.status)) || [])
        .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    const seduta = allActiveSedute[0] || null;

    const hasConsulenza = consulenza !== null;
    const hasSeduta     = seduta     !== null;

    // Seduta prenotabile solo dal giorno della consulenza in poi
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const consulenzaDay = consulenza ? new Date(consulenza.scheduled_at) : null;
    if (consulenzaDay) consulenzaDay.setHours(0, 0, 0, 0);
    const dateOk = hasConsulenza && consulenzaDay && todayStart >= consulenzaDay;
    const canBookSeduta = dateOk && (currentClientSedutaEnabled || currentBookingTokenValid);
    const sedutaLockedMsg = !hasConsulenza
        ? 'Disponibile dopo la consulenza.'
        : !dateOk
            ? `Disponibile dal giorno della consulenza (${formatDate(consulenza.scheduled_at, true)}).`
            : (!currentClientSedutaEnabled && !currentBookingTokenValid)
                ? 'Irene ti contatterà per sbloccare la prenotazione della tua seduta.'
                : '';

    // Proposta Irene per la seduta principale (se presente)
    let sedutaIreneProposalHtml = '';
    if (seduta && ['pending','confirmed'].includes(seduta.status)) {
        const sedutaProposal = allReschedules.find(r =>
            r.appointment_id === seduta.id &&
            r.initiated_by   === 'irene' &&
            r.status         === 'pending'
        );
        if (sedutaProposal) {
            const propDate   = new Date(sedutaProposal.requested_date).toLocaleDateString('it-IT', { weekday:'long', day:'2-digit', month:'long' });
            const safeReason = (sedutaProposal.reason || '').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/`/g, '\\`');
            sedutaIreneProposalHtml = `
            <div class="irene-proposal-banner">
                <div class="ipb-content">
                    <div class="ipb-header"><i class="fas fa-calendar-alt"></i> Irene propone una nuova data per la tua seduta</div>
                    <div class="ipb-detail"><strong>${propDate}</strong> alle <strong>${sedutaProposal.requested_time}</strong></div>
                    ${safeReason && sedutaProposal.reason !== 'Proposta di Irene' ? `<div class="ipb-reason">${safeReason}</div>` : ''}
                </div>
                <div class="ipb-btns">
                    <button style="display:inline-flex;align-items:center;gap:5px;background:rgba(251,191,36,0.18);border:1px solid #fbbf24;color:#fbbf24;padding:5px 14px;border-radius:6px;font-size:0.8rem;font-weight:700;cursor:pointer;font-family:inherit;"
                        onclick="acceptIreneProposal('${sedutaProposal.id}','${seduta.id}','${sedutaProposal.requested_date}','${sedutaProposal.requested_time}')">
                        <i class="fas fa-check"></i> Accetta
                    </button>
                    <button style="display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid rgba(251,191,36,0.3);color:#a07820;padding:5px 14px;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:pointer;font-family:inherit;"
                        onclick="rejectIreneProposal('${sedutaProposal.id}')">
                        <i class="fas fa-times"></i> Rifiuta
                    </button>
                </div>
            </div>`;
        } else {
            // Banner richiesta cliente (quando non c'è proposta Irene)
            const clientSedutaRr = allReschedules.find(r =>
                r.appointment_id === seduta.id && r.initiated_by !== 'irene' && r.status === 'pending');
            if (clientSedutaRr) {
                const reqDate = new Date(clientSedutaRr.requested_date).toLocaleDateString('it-IT');
                sedutaIreneProposalHtml = `<div class="reschedule-banner reschedule-pending"><i class="fas fa-clock"></i> Cambio data in attesa — richiesta per il ${reqDate} alle ${fmtReqTime(clientSedutaRr.requested_time)}</div>`;
            } else {
                const rejSedutaRr = allReschedules.find(r =>
                    r.appointment_id === seduta.id && r.initiated_by !== 'irene' && r.status === 'rejected' && r.resolved_at);
                if (rejSedutaRr) {
                    sedutaIreneProposalHtml = `<div class="reschedule-banner reschedule-rejected"><i class="fas fa-times-circle"></i> Cambio data non accettato${rejSedutaRr.irene_notes ? ': ' + rejSedutaRr.irene_notes : '.'}</div>`;
                }
            }
        }
    }

    // Righe sedute extra (dalla seconda in poi, ordinate per data crescente)
    let sedutaExtraHtml = '';
    if (allActiveSedute.length > 1) {
        sedutaExtraHtml = allActiveSedute.slice(1).map((a, idx) => {
            const date    = a.scheduled_at ? formatDate(a.scheduled_at) : 'Data da definire';
            const _payMethodA = a.acconto_payment_method || a.payment_method || a.session_payment_method || '';
            const payIconA = _payMethodA === 'contanti'
                ? `<i class="fas fa-money-bill-wave" style="font-size:0.72rem;color:#4ade80;" title="Contanti"></i>`
                : _payMethodA === 'pos'
                ? `<i class="fas fa-credit-card" style="font-size:0.72rem;color:#60a5fa;" title="POS"></i>`
                : _payMethodA === 'paypal'
                ? `<i class="fab fa-paypal" style="font-size:0.72rem;color:#0070ba;" title="PayPal"></i>`
                : '';
            const amountRightA = a.amount
                ? `<div style="font-size:0.78rem;color:#ccc;display:flex;align-items:center;gap:5px;">€${Number(a.amount).toFixed(0)}${payIconA}</div>`
                : '';
            // Label calcolato da posizione cronologica (idx+1 perché slice(1))
            const sessionLabelA = getSedutaLabel(idx + 1);
            const notes = `<div class="journey-notes"><i class="fas fa-comment-dots"></i> ${sessionLabelA}</div>`;
            // Bottone reschedule per questa seduta extra
            let extraBtnHtml = '';
            if (['pending','confirmed'].includes(a.status)) {
                const daysToA = a.scheduled_at ? (new Date(a.scheduled_at) - new Date()) / (1000 * 60 * 60 * 24) : -1;
                const hasPendingA = allReschedules.some(r => r.appointment_id === a.id && r.status === 'pending');
                if (daysToA > 14) {
                    const safeUidA = (a.cal_booking_uid || '').replace(/'/g, "\\'");
                    const safeAtA  = (a.scheduled_at || '').replace(/'/g, "\\'");
                    extraBtnHtml = `<button class="btn-reschedule" style="margin-top:0;" onclick="openFreeRescheduleModal('${a.id}','${safeUidA}','${safeAtA}')"><i class="fas fa-calendar-alt"></i> Cambia data</button>`;
                } else if (daysToA > 0 && !hasPendingA) {
                    extraBtnHtml = `<button class="btn-reschedule" style="margin-top:0;" onclick="openRescheduleModal('${a.id}')"><i class="fas fa-clock"></i> Cambia data</button>`;
                }
            }
            const extraConsentBtn = getConsentBtnHtml(a);
            const extraBtns = [extraBtnHtml, extraConsentBtn].filter(Boolean).join('');
            return `
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:4px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <div class="journey-date"><i class="fas fa-calendar-check"></i> ${date}</div>
                    ${amountRightA}
                </div>
                ${notes}
                <div>${badgeHtml(a.status)}</div>
                ${extraBtns ? `<div style="display:flex;justify-content:flex-end;gap:8px;">${extraBtns}</div>` : ''}
            </div>`;
        }).join('');
    }

    // Waitlist block (interattivo — solo se seduta è prenotata e attiva)
    const waitlistHtml = (seduta && ['pending','confirmed'].includes(seduta.status))
        ? buildWaitlistBlock(waitlist)
        : '';

    // Advance offer banner (se c'è un'offerta anticipa pending)
    const pendingOffer = allAdvanceOffers?.[0] || null;
    const advanceOfferHtml = pendingOffer ? buildAdvanceOfferBanner(pendingOffer) : '';

    // Build a single journey step
    function makeStep(num, title, icon, appt, ctaHref, ctaLabel, canBook, isLast, extraHtml, lockedMsg, rebookOnClick, badgeLast, actionsHtml) {
        extraHtml = extraHtml || '';
        lockedMsg = lockedMsg || 'Disponibile dopo la consulenza.';
        const done       = appt !== null;
        const numClass   = done ? 'journey-num done' : 'journey-num';
        const numContent = done ? '<i class="fas fa-check"></i>' : num;

        // Show "riprenota" CTA only when current appt is completed/cancelled
        const showRebook = done && ['completed', 'cancelled'].includes(appt.status);

        let inner = '';
        if (appt) {
            const date    = appt.scheduled_at ? formatDate(appt.scheduled_at) : 'Data da definire';
            const _payMethod = appt.acconto_payment_method || appt.payment_method || appt.session_payment_method || '';
            const payIcon = _payMethod === 'contanti'
                ? `<i class="fas fa-money-bill-wave" style="font-size:0.72rem;color:#4ade80;" title="Contanti"></i>`
                : _payMethod === 'pos'
                ? `<i class="fas fa-credit-card" style="font-size:0.72rem;color:#60a5fa;" title="POS"></i>`
                : _payMethod === 'paypal'
                ? `<i class="fab fa-paypal" style="font-size:0.72rem;color:#0070ba;" title="PayPal"></i>`
                : '';
            const amountRight = appt.amount
                ? `<div style="font-size:0.78rem;color:#ccc;display:flex;align-items:center;gap:5px;">€${Number(appt.amount).toFixed(0)}${payIcon}</div>`
                : '';
            const _notesClean = cleanNotes(appt.notes);
            const notes = _notesClean
                ? `<div class="journey-notes"><i class="fas fa-comment-dots"></i> ${_notesClean}</div>` : '';
            const _apptPast = appt.scheduled_at && new Date(appt.scheduled_at) < new Date() && ['confirmed','pending'].includes(appt.status);
            const _rr = allReschedules.find(r => r.appointment_id === appt.id && r.status === 'pending');
            const _stepBadgeBase = _rr
                ? (_rr.initiated_by === 'irene'
                    ? `<span class="badge badge-reschedule">⏳ al ${new Date(_rr.requested_date).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'})}</span>`
                    : `<span class="badge badge-reschedule">⏳ In attesa conferma</span>`)
                : badgeHtml(appt.status);
            const _stepBadge = _apptPast
                ? `<span class="badge" style="background:rgba(120,120,120,0.12);color:#888;border:1px solid rgba(120,120,120,0.25);">✓ Avvenuto</span>`
                : _stepBadgeBase;
            inner = `
                <div style="display:flex;flex-direction:column;gap:4px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <div class="journey-date"><i class="fas fa-calendar-check"></i> ${date}</div>
                        ${amountRight}
                    </div>
                    ${notes}
                    ${badgeLast ? '' : `<div>${_stepBadge}</div>`}
                </div>
                ${extraHtml}
                ${badgeLast ? `<div style="margin-top:4px;">${_stepBadge}</div>` : ''}
                ${actionsHtml ? `<div style="margin-top:8px;display:flex;justify-content:flex-end;">${actionsHtml}</div>` : ''}
                ${showRebook ? `<div style="margin-top:12px;">${rebookOnClick
                    ? `<button class="btn-reschedule" onclick="${rebookOnClick}"><i class="fas fa-redo"></i> Riprenota</button>`
                    : `<a href="${ctaHref}" class="journey-cta"><i class="fas fa-redo"></i> Riprenota</a>`
                }</div>` : ''}`;
        } else if (canBook) {
            inner = `
                <p class="journey-empty">Nessun appuntamento ancora.</p>
                <div style="margin-top:12px;display:flex;justify-content:flex-end;">
                    ${rebookOnClick
                        ? `<button class="btn-reschedule" onclick="${rebookOnClick}" style="margin-top:0;"><i class="fas fa-redo"></i> ${ctaLabel}</button>`
                        : `<a href="${ctaHref}" class="journey-cta"><i class="fas fa-arrow-right"></i> ${ctaLabel}</a>`
                    }
                </div>
                ${extraHtml}`;
        } else {
            const wipBtn = WIP_MODE && ctaHref ? `
                <div style="margin-top:10px;display:flex;flex-direction:column;align-items:flex-end;">
                    <a href="${ctaHref}" class="journey-cta" style="opacity:0.75;font-size:0.8rem;">
                        <i class="fas fa-flask" style="margin-right:5px;color:#fbbf24;"></i>${ctaLabel}
                        <span style="font-size:0.68rem;color:#fbbf24;margin-left:5px;">[TEST]</span>
                    </a>
                    <p style="font-size:0.68rem;color:#555;margin-top:5px;font-style:italic;">⚠️ Visibile solo in modalità test.</p>
                </div>` : '';
            inner = `<p class="journey-empty">${lockedMsg}</p>${wipBtn}${extraHtml}`;
        }

        return `
        <div class="journey-step">
            <div class="journey-connector">
                <div class="${numClass}">${numContent}</div>
                ${isLast ? '' : '<div class="journey-line"></div>'}
            </div>
            <div class="journey-body">
                <div class="journey-step-title"><i class="${icon}" style="margin-right:6px;"></i>${title}</div>
                ${inner}
            </div>
        </div>`;
    }

    // Calcola extraHtml per la consulenza (cambio data)
    let consulenzaExtra = '';
    let consulenzaActions = '';
    // Mostra modalità consulenza (whatsapp/in studio) se disponibile
    const _cmode = consulenza?.consultation_mode;
    if (_cmode && _cmode !== 'undefined' && _cmode !== 'null') {
        const modeLabel = /whatsapp/i.test(_cmode) ? 'Video WhatsApp' : /inPerson|studio/i.test(_cmode) ? 'In Studio' : _cmode;
        const modeIcon  = /whatsapp/i.test(_cmode) ? 'fab fa-whatsapp' : 'fas fa-map-marker-alt';
        consulenzaExtra += `<div style="margin-top:8px;font-size:0.78rem;color:#D4AF37;display:flex;align-items:center;gap:5px;"><i class="${modeIcon}"></i> ${modeLabel}</div>`;
    }
    if (consulenza && ['pending', 'confirmed'].includes(consulenza.status)) {
        // Cerca prima proposta Irene pending
        const ireneProposal = allReschedules.find(r =>
            r.appointment_id === consulenza.id &&
            r.initiated_by === 'irene' &&
            r.status === 'pending'
        );
        // Cerca richiesta cliente (solo quelle avviate dal cliente, non da Irene)
        const clientRr = allReschedules.find(r =>
            r.appointment_id === consulenza.id &&
            r.initiated_by !== 'irene'
        );

        if (ireneProposal) {
            // Banner proposta Irene con pulsanti accetta/rifiuta
            const propDate = new Date(ireneProposal.requested_date).toLocaleDateString('it-IT', { weekday:'long', day:'2-digit', month:'long' });
            const safeReason = (ireneProposal.reason || '').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/`/g, '\\`');
            consulenzaExtra = `
                <div class="irene-proposal-banner">
                    <div class="ipb-content">
                        <div class="ipb-header"><i class="fas fa-calendar-alt"></i> Irene propone una nuova data per la tua consulenza</div>
                        <div class="ipb-detail"><strong>${propDate}</strong> alle <strong>${ireneProposal.requested_time}</strong></div>
                        ${safeReason && ireneProposal.reason !== 'Proposta di Irene' ? `<div class="ipb-reason">${safeReason}</div>` : ''}
                    </div>
                    <div class="ipb-btns">
                        <button style="display:inline-flex;align-items:center;gap:5px;background:rgba(251,191,36,0.18);border:1px solid #fbbf24;color:#fbbf24;padding:5px 14px;border-radius:6px;font-size:0.8rem;font-weight:700;cursor:pointer;font-family:inherit;" onclick="acceptIreneProposal('${ireneProposal.id}','${consulenza.id}','${ireneProposal.requested_date}','${ireneProposal.requested_time}','${ireneProposal.consultation_mode||''}')"><i class="fas fa-check"></i> Accetta</button>
                        <button style="display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid rgba(251,191,36,0.3);color:#a07820;padding:5px 14px;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:pointer;font-family:inherit;" onclick="rejectIreneProposal('${ireneProposal.id}')"><i class="fas fa-times"></i> Rifiuta</button>
                    </div>
                </div>`;
        } else if (clientRr && clientRr.status === 'pending') {
            const reqDate = new Date(clientRr.requested_date).toLocaleDateString('it-IT');
            consulenzaExtra = `<div class="reschedule-banner reschedule-pending"><i class="fas fa-clock"></i> Cambio data in attesa — richiesta per il ${reqDate} alle ${fmtReqTime(clientRr.requested_time)}</div>`;
        } else if (clientRr && clientRr.status === 'rejected' && clientRr.resolved_at) {
            const diff = (Date.now() - new Date(clientRr.resolved_at)) / 3600000;
            if (diff < 48) {
                consulenzaExtra = `<div class="reschedule-banner reschedule-rejected"><i class="fas fa-times-circle"></i> Cambio data non accettato${clientRr.irene_notes ? ': ' + clientRr.irene_notes : '.'}</div>`;
            }
        }

        // Bottone richiedi cambio data (solo se non c'è proposta Irene, richiesta client pending, o appuntamento già passato)
        const isConsulenzaPast = consulenza.scheduled_at && new Date(consulenza.scheduled_at) < new Date() && ['confirmed','pending'].includes(consulenza.status);
        const hasBlocker = isConsulenzaPast || ireneProposal || (clientRr && clientRr.status === 'pending');
        if (!hasBlocker) {
            consulenzaActions = `<button class="btn-reschedule" onclick="openRescheduleModal('${consulenza.id}')"><i class="fas fa-calendar-alt"></i> Cambia data</button>`;
        }
    }
    // Nel dashboard il cliente è sempre registrato: usa sempre il modal interno
    const hasPastConsulenza = !!(byType['consulenza']?.length);
    const s1CtaLabel = hasPastConsulenza ? 'Riprenota Consulenza' : 'Prenota la tua Consulenza';
    const s1 = makeStep(1, 'Consulenza',      'far fa-calendar-alt',   consulenza, 'consultation.html?from=dashboard', s1CtaLabel, true, false, consulenzaExtra, 'Prenota prima la Consulenza.', 'openRebookModal()', true, consulenzaActions);
    // Proposta Irene per la pre-seduta (se presente)
    let presedutaIreneProposalHtml = '';
    if (preseduta && ['pending','confirmed'].includes(preseduta.status)) {
        const presedutaProposal = allReschedules.find(r =>
            r.appointment_id === preseduta.id &&
            r.initiated_by   === 'irene' &&
            r.status         === 'pending'
        );
        if (presedutaProposal) {
            const propDate   = new Date(presedutaProposal.requested_date).toLocaleDateString('it-IT', { weekday:'long', day:'2-digit', month:'long' });
            const safeReason = (presedutaProposal.reason || '').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/`/g, '\\`');
            presedutaIreneProposalHtml = `
            <div class="irene-proposal-banner">
                <div class="ipb-content">
                    <div class="ipb-header"><i class="fas fa-calendar-alt"></i> Irene propone una nuova data per la pre-seduta</div>
                    <div class="ipb-detail"><strong>${propDate}</strong> alle <strong>${presedutaProposal.requested_time}</strong></div>
                    ${safeReason && presedutaProposal.reason !== 'Proposta di Irene' ? `<div class="ipb-reason">${safeReason}</div>` : ''}
                </div>
                <div class="ipb-btns">
                    <button style="display:inline-flex;align-items:center;gap:5px;background:rgba(251,191,36,0.18);border:1px solid #fbbf24;color:#fbbf24;padding:5px 14px;border-radius:6px;font-size:0.8rem;font-weight:700;cursor:pointer;font-family:inherit;"
                        onclick="acceptIreneProposal('${presedutaProposal.id}','${preseduta.id}','${presedutaProposal.requested_date}','${presedutaProposal.requested_time}','${presedutaProposal.consultation_mode||''}')">
                        <i class="fas fa-check"></i> Accetta
                    </button>
                    <button style="display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid rgba(251,191,36,0.3);color:#a07820;padding:5px 14px;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:pointer;font-family:inherit;"
                        onclick="rejectIreneProposal('${presedutaProposal.id}')">
                        <i class="fas fa-times"></i> Rifiuta
                    </button>
                </div>
            </div>`;
        }
    }

    // Banner richiesta cliente per pre-seduta (se non c'è proposta Irene)
    if (preseduta && !presedutaIreneProposalHtml) {
        const clientPresedutaRr = allReschedules.find(r =>
            r.appointment_id === preseduta.id && r.initiated_by !== 'irene' && r.status === 'pending');
        if (clientPresedutaRr) {
            const reqDate = new Date(clientPresedutaRr.requested_date).toLocaleDateString('it-IT');
            presedutaIreneProposalHtml += `<div class="reschedule-banner reschedule-pending"><i class="fas fa-clock"></i> Cambio data in attesa — richiesta per il ${reqDate} alle ${fmtReqTime(clientPresedutaRr.requested_time)}</div>`;
        } else {
            const rejPresedutaRr = allReschedules.find(r =>
                r.appointment_id === preseduta.id && r.initiated_by !== 'irene' && r.status === 'rejected' && r.resolved_at);
            if (rejPresedutaRr) {
                presedutaIreneProposalHtml += `<div class="reschedule-banner reschedule-rejected"><i class="fas fa-times-circle"></i> Cambio data non accettato${rejPresedutaRr.irene_notes ? ': ' + rejPresedutaRr.irene_notes : '.'}</div>`;
            }
        }
    }

    const _pmodeRaw = preseduta?.consultation_mode;
    let presedutaModeHtml = '';
    if (_pmodeRaw && _pmodeRaw !== 'undefined' && _pmodeRaw !== 'null') {
        const pmodeLabel = /whatsapp/i.test(_pmodeRaw) ? 'Video WhatsApp' : /inPerson|studio/i.test(_pmodeRaw) ? 'In Studio' : _pmodeRaw;
        const pmodeIcon  = /whatsapp/i.test(_pmodeRaw) ? 'fab fa-whatsapp' : 'fas fa-map-marker-alt';
        presedutaModeHtml = `<div style="margin-top:8px;font-size:0.78rem;color:#D4AF37;display:flex;align-items:center;gap:5px;"><i class="${pmodeIcon}"></i> ${pmodeLabel}</div>`;
    }

    // Bottone cambio data pre-seduta
    let presedutaActionsHtml = '';
    if (preseduta && ['pending','confirmed'].includes(preseduta.status)) {
        const daysToPreseduta = preseduta.scheduled_at
            ? (new Date(preseduta.scheduled_at) - new Date()) / (1000 * 60 * 60 * 24)
            : -1;
        const hasPendingPresedutaRsch = allReschedules.some(r => r.appointment_id === preseduta.id && r.status === 'pending');
        if (!hasPendingPresedutaRsch) {
            if (daysToPreseduta > 3) {
                const safeUid = (preseduta.cal_booking_uid || '').replace(/'/g, "\\'");
                const safeAt  = (preseduta.scheduled_at || '').replace(/'/g, "\\'");
                presedutaActionsHtml = `<button class="btn-reschedule" onclick="openFreeRescheduleModal('${preseduta.id}','${safeUid}','${safeAt}')"><i class="fas fa-calendar-alt"></i> Cambia data</button>`;
            } else if (daysToPreseduta > 0) {
                presedutaActionsHtml = `<button class="btn-reschedule" onclick="openRescheduleModal('${preseduta.id}')"><i class="fas fa-clock"></i> Cambia data</button>`;
            }
        }
    }

    const s2 = makeStep(2, 'Pre-Seduta',       'fas fa-clipboard-list', preseduta,  'pre-session.html?from=dashboard',  'Prenota la Pre-Seduta',     hasSeduta,     false, presedutaModeHtml + presedutaIreneProposalHtml, 'Disponibile dopo aver prenotato la Seduta Tatuaggio.', null, true, presedutaActionsHtml);

    // Bottoni azione per la seduta: cambio data libero (>14gg) o richiesta (<14gg)
    let sedutaActionsHtml = '';
    if (seduta && ['pending','confirmed'].includes(seduta.status)) {
        const daysToAppt = seduta.scheduled_at
            ? (new Date(seduta.scheduled_at) - new Date()) / (1000 * 60 * 60 * 24)
            : -1;
        const hasPendingRsch = allReschedules.some(r => r.appointment_id === seduta.id && r.status === 'pending');
        if (daysToAppt > 14) {
            const safeUid = (seduta.cal_booking_uid || '').replace(/'/g, "\\'");
            const safeAt  = (seduta.scheduled_at || '').replace(/'/g, "\\'");
            sedutaActionsHtml = `<button class="btn-reschedule" onclick="openFreeRescheduleModal('${seduta.id}','${safeUid}','${safeAt}')"><i class="fas fa-calendar-alt"></i> Cambia data</button>`;
        } else if (daysToAppt > 0 && !hasPendingRsch) {
            sedutaActionsHtml = `<button class="btn-reschedule" onclick="openRescheduleModal('${seduta.id}')"><i class="fas fa-clock"></i> Cambia data</button>`;
        }
    }

    // Bottone consenso per la seduta principale (solo oggi dalle 10:00)
    const sedutaConsentBtn = seduta ? getConsentBtnHtml(seduta) : '';
    const sedutaConsentHtml = sedutaConsentBtn
        ? `<div style="display:flex;justify-content:flex-end;">${sedutaConsentBtn}</div>`
        : '';

    // Il bottone della prima seduta va subito dopo la prima seduta, prima delle extra
    const sedutaActionsWrapper = (sedutaActionsHtml || sedutaConsentBtn)
        ? `<div style="display:flex;justify-content:flex-end;gap:8px;">${sedutaActionsHtml}${sedutaConsentBtn}</div>`
        : '';
    // Label sessione calcolato da posizione cronologica (non da Cal.com)
    const sedutaDisplay = seduta ? { ...seduta, notes: getSedutaLabel(0) } : seduta;
    const sedutaBookUrl = (currentBookingToken && !currentClientSedutaEnabled)
        ? `session.html?from=dashboard&bt=${encodeURIComponent(currentBookingToken)}`
        : 'session.html?from=dashboard';
    const s3 = makeStep(3, 'Seduta Tatuaggio', 'fas fa-paint-brush',    sedutaDisplay, sedutaBookUrl,                        'Prenota la Seduta',         canBookSeduta, true,  sedutaIreneProposalHtml + advanceOfferHtml + sedutaActionsWrapper + sedutaExtraHtml, sedutaLockedMsg, null, false, '');

    // History: tutti gli appuntamenti NON attivi (cancelled, completed, o duplicati)
    const activeIds = new Set([consulenza?.id, preseduta?.id, ...allActiveSedute.map(s => s.id)].filter(Boolean));
    const historyRows = list.filter(a => !activeIds.has(a.id)).map(a => {
        const typeLabels = { consulenza: 'Consulenza', 'pre-seduta': 'Pre-seduta', seduta: 'Seduta Tatuaggio' };
        const typeIcons  = { consulenza: 'far fa-calendar-alt', 'pre-seduta': 'fas fa-clipboard-list', seduta: 'fas fa-paint-brush' };
        const label  = typeLabels[a.type] || a.type;
        const icon   = typeIcons[a.type]  || 'far fa-calendar-alt';
        const date    = a.scheduled_at ? formatDate(a.scheduled_at) : 'Data da definire';
        const amount  = a.amount ? ` · €${Number(a.amount).toFixed(0)}` : '';
        const _payMethodH = a.acconto_payment_method || a.payment_method || a.session_payment_method || '';
        const payIcon = _payMethodH === 'contanti'
            ? `<i class="fas fa-money-bill-wave" style="font-size:0.72rem;color:#4ade80;margin-left:5px;" title="Contanti"></i>`
            : _payMethodH === 'pos'
            ? `<i class="fas fa-credit-card" style="font-size:0.72rem;color:#60a5fa;margin-left:5px;" title="POS"></i>`
            : _payMethodH === 'paypal'
            ? `<i class="fab fa-paypal" style="font-size:0.72rem;color:#0070ba;margin-left:5px;" title="PayPal"></i>`
            : '';
        return `
        <div class="data-row">
            <div class="data-row-left">
                <div class="data-icon"><i class="${icon}"></i></div>
                <div class="data-info">
                    <div class="data-title">${label}</div>
                    <div class="data-meta">${date}${amount}${payIcon}${cleanNotes(a.notes) ? ' · ' + cleanNotes(a.notes) : ''}</div>
                </div>
            </div>
            ${badgeHtml(a.status)}
        </div>`;
    }).join('');

    const historySection = historyRows
        ? `<p class="section-label" style="margin-top:28px;">Storico precedente</p><div class="data-list">${historyRows}</div>`
        : '';

    // Banner sblocco temporaneo prenotazione
    let tokenBannerHtml = '';
    if (currentBookingTokenValid && window._bookingTokenExpiresAt) {
        tokenBannerHtml = `
        <div id="bookingTokenBanner" style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:14px;background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.35);border-radius:10px;font-size:0.82rem;color:#D4AF37;">
            <i class="fas fa-lock-open"></i>
            <span>Prenotazione sbloccata da Irene — tempo rimasto: <strong id="btCountdown">--:--</strong></span>
        </div>`;
        // Avvia countdown dopo il render
        requestAnimationFrame(() => {
            if (window._btCountdownInterval) clearInterval(window._btCountdownInterval);
            window._btCountdownInterval = setInterval(() => {
                const secsLeft = Math.max(0, Math.round((window._bookingTokenExpiresAt - new Date()) / 1000));
                const m = Math.floor(secsLeft / 60);
                const s = secsLeft % 60;
                const el = document.getElementById('btCountdown');
                if (el) el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
                if (secsLeft <= 0) {
                    clearInterval(window._btCountdownInterval);
                    currentBookingTokenValid = false;
                    loadAllData(); // re-render per nascondere il bottone prenota
                }
            }, 1000);
        });
    }

    container.innerHTML = `
        ${tokenBannerHtml}
        <p class="section-label">Il tuo percorso</p>
        <div class="journey-wrap">${s1}${s2}${s3}</div>
        ${waitlistHtml}
        ${historySection}`;
}

// ─────────────────────────────────────────────
//  GALLERIA
// ─────────────────────────────────────────────
async function renderGallery(list) {
    const grid = document.getElementById('galleryGrid');

    if (!list.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
            <i class="fas fa-images"></i>
            <p>Nessuna foto ancora.<br>Carica le foto del tuo tatuaggio!</p>
        </div>`;
        return;
    }

    // Genera URL firmati per le immagini private
    const thumbs = await Promise.all(list.map(async item => {
        const { data } = await db.storage.from('client-gallery').createSignedUrl(item.storage_path, 3600);
        return { ...item, signedUrl: data?.signedUrl || '' };
    }));

    grid.innerHTML = thumbs.map(item => `
        <div class="gallery-thumb" data-id="${item.id}" data-path="${item.storage_path}">
            ${item.signedUrl ? `<img src="${item.signedUrl}" alt="${item.title || 'Tatuaggio'}">` : ''}
            <button class="gallery-thumb-del" onclick="deleteGalleryItem('${item.id}', '${item.storage_path}', this)" title="Rimuovi">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');
}

// Upload foto
function initGalleryUpload() {
    document.getElementById('uploadBtn').addEventListener('click', () => {
        document.getElementById('uploadInput').click();
    });

    document.getElementById('uploadInput').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;

        const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
        const MAX_SIZE_MB = 10;
        const invalid = files.filter(f => !ALLOWED_TYPES.includes(f.type));
        if (invalid.length) { showToast('Formato non supportato. Usa JPG, PNG o WebP.', true); e.target.value = ''; return; }
        const tooBig = files.filter(f => f.size > MAX_SIZE_MB * 1024 * 1024);
        if (tooBig.length) { showToast(`File troppo grande (max ${MAX_SIZE_MB} MB).`, true); e.target.value = ''; return; }

        const progress = document.getElementById('uploadProgress');
        progress.textContent = `Caricamento ${files.length} foto...`;
        progress.classList.add('show');

        let uploaded = 0;
        for (const file of files) {
            const ext  = file.name.split('.').pop();
            const path = `${currentUser.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

            const { error: storageErr } = await db.storage.from('client-gallery').upload(path, file, { contentType: file.type });
            if (storageErr) { showToast('Errore upload: ' + storageErr.message, true); continue; }

            const { error: dbErr } = await db.from('tattoo_gallery').insert({
                client_id:    currentUser.id,
                storage_path: path,
                title:        file.name.replace(/\.[^.]+$/, ''),
            });
            if (dbErr) { showToast('Errore DB: ' + dbErr.message, true); continue; }

            uploaded++;
            progress.textContent = `Caricamento... ${uploaded}/${files.length}`;
        }

        progress.classList.remove('show');
        e.target.value = '';

        if (uploaded > 0) {
            showToast(`${uploaded} foto aggiunta/e con successo!`);
            // Ricarica galleria
            const { data } = await db.from('tattoo_gallery').select('*').eq('client_id', currentUser.id).order('created_at', { ascending: false });
            await renderGallery(data || []);
        }
    });
}

// Elimina foto
async function deleteGalleryItem(id, storagePath, btn) {
    if (!await customConfirm('Rimuovere questa foto?')) return;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    await db.storage.from('client-gallery').remove([storagePath]);
    await db.from('tattoo_gallery').delete().eq('id', id);

    const thumb = btn.closest('.gallery-thumb');
    thumb.style.opacity = '0';
    setTimeout(() => thumb.remove(), 300);
    showToast('Foto rimossa.');
}

// ─────────────────────────────────────────────
//  TAB SWITCHING
// ─────────────────────────────────────────────
function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
        });
    });
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
// Ritorna il label di sessione in ordine cronologico (indice 0-based)
function getSedutaLabel(i) {
    const labels = ['Prima seduta', 'Seconda seduta', 'Terza seduta', 'Quarta seduta', 'Quinta seduta',
                    'Sesta seduta', 'Settima seduta', 'Ottava seduta', 'Nona seduta', 'Decima seduta'];
    return labels[i] || `Seduta ${i + 1}`;
}

function cleanNotes(notes) {
    if (!notes) return '';
    return notes
        .replace(/\s*[·\-–—]\s*[Aa]ccompagnatore:\s*(Sì|Si|No)\s*/g, '')
        .replace(/\s*[Aa]ccompagnatore:\s*(Sì|Si|No)\s*/g, '')
        .replace(/\s*[·\-–—]\s*$/, '')
        .trim();
}

function formatDate(iso, dateOnly = false) {
    try {
        const d = new Date(iso);
        if (dateOnly) return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
        return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
    } catch { return iso; }
}

function badgeHtml(status) {
    const map = {
        pending:   ['badge-pending',   'In attesa'],
        confirmed: ['badge-confirmed', 'Confermato'],
        completed: ['badge-completed', 'Completato'],
        cancelled: ['badge-cancelled', 'Annullato'],
        active:    ['badge-active',    'Attivo'],
        used:      ['badge-used',      'Utilizzato'],
        expired:   ['badge-expired',   'Scaduto'],
    };
    const [cls, label] = map[status] || ['badge-pending', status];
    return `<span class="badge ${cls}">${label}</span>`;
}

function emptyState(icon, text) {
    return `<div class="empty-state"><i class="${icon}"></i><p>${text}</p></div>`;
}

let toastTimer;

function customConfirm(message) {
    return new Promise(resolve => {
        const overlay = document.getElementById('dashConfirmOverlay');
        const msg     = document.getElementById('dashConfirmMsg');
        const okBtn   = document.getElementById('dashConfirmOk');
        const cancelBtn = document.getElementById('dashConfirmCancel');
        if (!overlay) { resolve(false); return; } // fallback sicuro — non usare native confirm()
        msg.textContent = message;
        overlay.style.display = 'flex';
        const cleanup = () => { overlay.style.display = 'none'; okBtn.onclick = null; cancelBtn.onclick = null; };
        okBtn.onclick     = () => { cleanup(); resolve(true); };
        cancelBtn.onclick = () => { cleanup(); resolve(false); };
    });
}
function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 3500);
}

// ─────────────────────────────────────────────
//  VOUCHER
// ─────────────────────────────────────────────
function voucherStatus(v) {
    if (v.status === 'used' || v.used_at) return 'used';
    if (v.status === 'expired' || (v.expires_at && new Date(v.expires_at) < new Date())) return 'expired';
    return 'active';
}

function formatDateShort(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return iso; }
}

// Formatta requested_time per visualizzazione: accetta ISO completo o etichetta "HH:MM"
function fmtReqTime(t) {
    if (!t) return '';
    if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
        return new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
    }
    return t;
}

function renderVouchers(list) {
    const el = document.getElementById('vouchersList');
    if (!el) return;

    if (!list.length) {
        el.innerHTML = emptyState('fas fa-gift', 'Nessun voucher disponibile.<br>Se hai ricevuto un codice, inseriscilo qui sopra.');
        return;
    }

    el.innerHTML = list.map(v => {
        const status = voucherStatus(v);
        const badgeMap = { active: ['badge-active', 'Attivo'], used: ['badge-used', 'Utilizzato'], expired: ['badge-expired', 'Scaduto'] };
        const [badgeCls, badgeLabel] = badgeMap[status];

        let statusLine = '';
        if (status === 'used') {
            statusLine = `<div class="data-meta" style="margin-top:4px;color:var(--text-muted);">Utilizzato il ${formatDateShort(v.used_at)}${v.irene_notes ? ' · ' + v.irene_notes : ''}</div>`;
        } else if (status === 'expired') {
            statusLine = `<div class="data-meta" style="margin-top:4px;color:var(--red);">Scaduto il ${formatDateShort(v.expires_at)}</div>`;
        } else if (v.expires_at) {
            statusLine = `<div class="data-meta" style="margin-top:4px;">Valido fino al ${formatDateShort(v.expires_at)}</div>`;
        }

        const msgText = v.message || v.gift_message || '';
        const giftLine = v.sender_name
            ? `<div class="data-meta" style="margin-top:2px;"><i class="fas fa-gift" style="font-size:0.7rem;margin-right:4px;color:var(--gold);"></i>Regalato da ${v.sender_name}${msgText ? ': "' + msgText + '"' : ''}</div>`
            : '';

        return `
        <div class="data-row" style="border-radius:10px;background:var(--bg-card);border:1px solid var(--border);margin-bottom:8px;">
            <div class="data-row-left">
                <div class="data-icon"><i class="fas fa-gift"></i></div>
                <div class="data-info">
                    <div class="data-title" style="font-family:monospace;color:var(--gold);letter-spacing:0.05em;">${v.code || v.id}</div>
                    <div class="data-meta">€${v.amount ?? v.value_eur ?? 0} · ${v.service_type || 'Tatuaggio'}</div>
                    ${statusLine}
                    ${giftLine}
                </div>
            </div>
            <span class="badge ${badgeCls}">${badgeLabel}</span>
        </div>`;
    }).join('');
}

async function claimVoucherByCode() {
    const input = document.getElementById('voucherCodeInput');
    const msg = document.getElementById('voucherClaimMsg');
    const btn = document.getElementById('claimVoucherBtn');
    const code = (input.value || '').trim().toUpperCase();

    msg.style.color = 'var(--text-muted)';
    msg.textContent = '';

    if (!code || !/^IGT-\d{8}-[A-Z0-9]{4}$/.test(code)) {
        msg.style.color = 'var(--red)';
        msg.textContent = 'Formato codice non valido. Es: IGT-20260310-A4B2';
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:5px;"></i>Attendere…';

    const { data: v, error } = await db.from('vouchers').select('*').eq('code', code).maybeSingle();

    if (!v || error) {
        msg.style.color = 'var(--red)';
        msg.textContent = 'Codice non trovato.';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus"></i> Aggiungi';
        return;
    }

    // Già in lista (per email o claimed)
    if (v.recipient_email === currentUser.email || v.claimed_by_user_id === currentUser.id) {
        msg.style.color = 'var(--gold)';
        msg.textContent = 'Questo voucher è già presente nella tua lista.';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus"></i> Aggiungi';
        return;
    }

    if (v.used_at) {
        msg.style.color = 'var(--red)';
        msg.textContent = 'Questo voucher è già stato utilizzato.';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus"></i> Aggiungi';
        return;
    }

    if (v.claimed_by_user_id) {
        msg.style.color = 'var(--red)';
        msg.textContent = 'Questo voucher è già stato riscattato da qualcun altro.';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus"></i> Aggiungi';
        return;
    }

    if (v.expires_at && new Date(v.expires_at) < new Date()) {
        msg.style.color = 'var(--red)';
        msg.textContent = 'Questo voucher è scaduto.';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus"></i> Aggiungi';
        return;
    }

    const { error: updateErr } = await db.from('vouchers')
        .update({ claimed_by_user_id: currentUser.id })
        .eq('code', code);

    if (updateErr) {
        msg.style.color = 'var(--red)';
        msg.textContent = 'Errore: ' + updateErr.message;
    } else {
        input.value = '';
        msg.style.color = 'var(--green)';
        msg.textContent = 'Voucher aggiunto con successo!';
        // Ricarica
        const { data: updated } = await db.from('vouchers').select('*')
            .or(`recipient_email.eq.${currentUser.email},claimed_by_user_id.eq.${currentUser.id}`)
            .order('created_at', { ascending: false });
        allVouchers = updated || [];
        renderVouchers(allVouchers);
        setTimeout(() => { msg.textContent = ''; }, 4000);
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-plus"></i> Aggiungi';
}

// ─────────────────────────────────────────────
//  RESCHEDULE — Calendario cambio data consulenza
//  Disponibilità reale da Cal.com via proxy n8n
// ─────────────────────────────────────────────

const RSCH_SLOTS_URL = 'https://n8n.srv1204993.hstgr.cloud/webhook/cal-slots';
const RSCH_TIMEZONE  = 'Europe/Rome';
const APPT_TYPE_EVENT_IDS = { consulenza: '4496804', 'pre-seduta': '4496803', seduta: '4496802' };
const RSCH_EVENT_ID  = '4496804'; // usato da rbFetchMonthSlots e submitRebook
let rschCurrentEventId = '4496804'; // aggiornato dinamicamente all'apertura del modal
const RSCH_MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                   'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

let rschState = {
    year: null, month: null,
    slots: {},
    loadedMonths: new Set(),
    loadingMonths: new Set(),
    selectedDate: null,
    selectedTime: null,       // ISO string
    selectedTimeLabel: null,  // HH:MM string
};

function openRescheduleModal(apptId) {
    // Imposta eventTypeId corretto in base al tipo di appuntamento
    const appt = allClientAppointments.find(a => a.id === apptId);
    rschCurrentEventId = APPT_TYPE_EVENT_IDS[appt?.type] || '4496804';

    document.getElementById('rescheduleApptId').value = apptId;
    document.getElementById('rescheduleReason').value = '';
    const msg = document.getElementById('rescheduleMsg');
    msg.textContent = '';
    msg.style.color = '';

    // Reset state
    const today = new Date();
    rschState = {
        year:  today.getFullYear(),
        month: today.getMonth(),
        slots: {},
        loadedMonths: new Set(),
        loadingMonths: new Set(),
        selectedDate: null,
        selectedTime: null,
        selectedTimeLabel: null,
    };

    document.getElementById('rschTimesWrap').classList.add('hidden');
    document.getElementById('rschSummary').classList.add('hidden');
    const btn = document.getElementById('rescheduleSubmitBtn');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Invia richiesta';

    // Riallega listener nav (clona per evitare duplicati)
    ['rschPrevMonth', 'rschNextMonth'].forEach(id => {
        const old = document.getElementById(id);
        if (!old) return;
        const clone = old.cloneNode(true);
        old.parentNode.replaceChild(clone, old);
    });
    document.getElementById('rschPrevMonth').addEventListener('click', rschPrevMonth);
    document.getElementById('rschNextMonth').addEventListener('click', rschNextMonth);

    document.getElementById('rescheduleModal').style.display = 'flex';
    rschRenderCalendar();
    rschFetchMonthSlots(rschState.year, rschState.month);
}

function rschFmtDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function rschFetchMonthSlots(year, month) {
    const key = `${year}-${month}`;
    if (rschState.loadedMonths.has(key) || rschState.loadingMonths.has(key)) return;
    rschState.loadingMonths.add(key);

    const loadEl = document.getElementById('rschCalLoading');
    loadEl.innerHTML = '<span class="rsch-spinner"></span> Caricamento disponibilità...';
    loadEl.classList.remove('hidden');

    const startTime = new Date(year, month, 1, 0, 0, 0).toISOString();
    const endTime   = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

    try {
        const url = `${RSCH_SLOTS_URL}?eventTypeId=${rschCurrentEventId}` +
            `&startTime=${encodeURIComponent(startTime)}` +
            `&endTime=${encodeURIComponent(endTime)}` +
            `&timeZone=${encodeURIComponent(RSCH_TIMEZONE)}`;

        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (data.slots) {
            for (const [date, arr] of Object.entries(data.slots)) {
                rschState.slots[date] = arr.map(s => s.time).filter(Boolean);
            }
        }

        rschState.loadedMonths.add(key);
        rschState.loadingMonths.delete(key);
        loadEl.classList.add('hidden');
        rschRenderCalendar();
    } catch(e) {
        rschState.loadingMonths.delete(key);
        loadEl.innerHTML = '<span style="color:var(--red);font-size:0.76rem;"><i class="fas fa-exclamation-circle"></i> Errore caricamento disponibilità</span>';
    }
}

function rschRenderCalendar() {
    const { year, month, slots, selectedDate } = rschState;
    const labelEl = document.getElementById('rschMonthLabel');
    if (labelEl) labelEl.textContent = `${RSCH_MESI[month]} ${year}`;

    const today = new Date();
    const prevBtn = document.getElementById('rschPrevMonth');
    if (prevBtn) {
        const isPast = year < today.getFullYear() ||
            (year === today.getFullYear() && month <= today.getMonth());
        prevBtn.disabled = isPast;
    }

    const grid = document.getElementById('rschCalGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const firstDayRaw = new Date(year, month, 1).getDay();
    const firstDayMon = firstDayRaw === 0 ? 6 : firstDayRaw - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Min selectable: domani
    const minDate = new Date(today);
    minDate.setDate(minDate.getDate() + 1);
    const minStr   = rschFmtDate(minDate);
    const todayStr = rschFmtDate(today);

    // Celle vuote (padding inizio mese)
    for (let i = 0; i < firstDayMon; i++) {
        const el = document.createElement('div');
        el.className = 'rsch-day empty';
        grid.appendChild(el);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const d    = new Date(year, month, day);
        const dStr = rschFmtDate(d);
        const isPast     = dStr < minStr;
        const isSelected = dStr === selectedDate;
        const isHoliday  = typeof isItalianHoliday === 'function' && isItalianHoliday(dStr);
        const hasSlots   = !isHoliday && slots[dStr] && slots[dStr].length > 0;

        const cell = document.createElement('div');
        cell.textContent = day;

        if (isSelected && !isHoliday) {
            cell.className = 'rsch-day selected';
        } else if (isPast) {
            cell.className = 'rsch-day past';
        } else if (isHoliday) {
            cell.className = 'rsch-day unavail holiday';
            cell.title = 'Giorno festivo — studio chiuso';
        } else if (hasSlots) {
            cell.className = 'rsch-day avail' + (dStr === todayStr ? ' today-avail' : '');
            cell.title = `${slots[dStr].length} orari disponibili`;
            cell.addEventListener('click', () => rschSelectDate(dStr));
        } else {
            cell.className = 'rsch-day unavail';
        }

        grid.appendChild(cell);
    }
}

function rschPrevMonth() {
    if (rschState.month === 0) { rschState.month = 11; rschState.year--; }
    else rschState.month--;
    rschRenderCalendar();
    rschFetchMonthSlots(rschState.year, rschState.month);
}

function rschNextMonth() {
    if (rschState.month === 11) { rschState.month = 0; rschState.year++; }
    else rschState.month++;
    rschRenderCalendar();
    rschFetchMonthSlots(rschState.year, rschState.month);
}

function rschSelectDate(dateStr) {
    rschState.selectedDate = dateStr;
    rschState.selectedTime = null;
    rschState.selectedTimeLabel = null;
    document.getElementById('rschSummary').classList.add('hidden');
    rschRenderCalendar();
    rschRenderTimeSlots(dateStr, rschState.slots[dateStr] || []);
    document.getElementById('rschTimesWrap').classList.remove('hidden');
}

function rschRenderTimeSlots(dateStr, slots) {
    const grid  = document.getElementById('rschTimesGrid');
    const title = document.getElementById('rschTimesTitle');
    grid.innerHTML = '';

    const d = new Date(dateStr + 'T12:00:00');
    const dateLabel = d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long' });
    title.innerHTML = `<i class="far fa-clock"></i> Orari · <span style="color:var(--gold)">${dateLabel}</span>`;

    if (!slots.length) {
        grid.innerHTML = '<p style="font-size:0.78rem;color:var(--text-muted);grid-column:1/-1;padding:4px 0;">Nessun orario disponibile per questa data.</p>';
        return;
    }

    slots.forEach(iso => {
        const t   = new Date(iso);
        const lbl = t.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: RSCH_TIMEZONE });
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rsch-time-btn';
        btn.textContent = lbl;
        btn.addEventListener('click', () => rschSelectTime(iso, lbl, btn));
        grid.appendChild(btn);
    });
}

function rschSelectTime(iso, label, btn) {
    rschState.selectedTime      = iso;
    rschState.selectedTimeLabel = label;

    document.querySelectorAll('.rsch-time-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    const d = new Date(rschState.selectedDate + 'T12:00:00');
    const dateLabel = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    document.getElementById('rschSummaryText').textContent = `${dateLabel} alle ${label}`;
    document.getElementById('rschSummary').classList.remove('hidden');
    document.getElementById('rschTimesWrap').classList.add('hidden');
}

function rschClearSelection() {
    rschState.selectedTime      = null;
    rschState.selectedTimeLabel = null;
    document.getElementById('rschSummary').classList.add('hidden');
    if (rschState.selectedDate) {
        rschRenderTimeSlots(rschState.selectedDate, rschState.slots[rschState.selectedDate] || []);
        document.getElementById('rschTimesWrap').classList.remove('hidden');
    }
}

async function submitRescheduleRequest() {
    // Se siamo in modalità reschedule libero, delega
    if (_freeRschCtx?.apptId) { submitFreeReschedule(); return; }

    const apptId = document.getElementById('rescheduleApptId').value;
    const reason = document.getElementById('rescheduleReason').value.trim();
    const msg    = document.getElementById('rescheduleMsg');
    const btn    = document.getElementById('rescheduleSubmitBtn');

    if (btn.disabled) return; // double-click guard

    msg.style.color = 'var(--red)';
    if (!rschState.selectedDate) {
        msg.textContent = 'Seleziona una data dal calendario.'; return;
    }
    if (!rschState.selectedTime) {
        msg.textContent = 'Seleziona un orario disponibile.'; return;
    }
    if (!reason || reason.length < 10) {
        msg.textContent = 'Inserisci una motivazione (min. 10 caratteri).'; return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="margin-right:5px;font-size:0.85em;"></i>Attendere…';
    msg.style.color = 'var(--text-muted)';
    msg.textContent = 'Invio in corso...';

    const timeLabel = rschState.selectedTimeLabel;

    try {
        const clientId = currentUser.id; // currentProfile potrebbe essere null

        const { error: insErr } = await db.from('reschedule_requests').insert({
            appointment_id: apptId,
            client_id:      clientId,
            requested_date: rschState.selectedDate,
            requested_time: rschState.selectedTime,  // ISO completo da Cal.com (evita ricostruzione timezone)
            reason:         reason,
        });

        if (insErr) throw new Error(insErr.message);

        // Notifica per Irene (non blocca se fallisce)
        const meta = currentUser.user_metadata || {};
        const clientName = [meta.first_name, meta.last_name].filter(Boolean).join(' ') || currentUser.email;
        (async () => {
            try {
                await db.from('notifications').insert({
                    type:      'reschedule_request',
                    title:     'Richiesta cambio data consulenza',
                    body:      `${clientName} chiede di spostare la consulenza al ${new Date(rschState.selectedDate).toLocaleDateString('it-IT')} alle ${timeLabel}. Motivo: ${reason}`,
                    client_id: clientId,
                    is_read:   false,
                });
            } catch(e) { console.warn('[reschedule notify]', e); }
        })();

        // Chiudi modal e ricarica
        closeRescheduleModal();
        loadAllData();

    } catch (e) {
        msg.style.color = 'var(--red)';
        msg.textContent = 'Errore: ' + (e.message || 'riprova.');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Invia richiesta';
    }
}

// ─────────────────────────────────────────────
//  SEDUTA — Reschedule libero (> 14 giorni)
// ─────────────────────────────────────────────
const FREE_RSCH_URL = 'https://n8n.srv1204993.hstgr.cloud/webhook/seduta-free-reschedule';

let _freeRschCtx = { apptId: null, calBookingUid: null, oldScheduledAt: null };

function openFreeRescheduleModal(apptId, calBookingUid, oldScheduledAt) {
    _freeRschCtx = { apptId, calBookingUid, oldScheduledAt };
    // Imposta eventTypeId corretto in base al tipo di appuntamento
    const appt = allClientAppointments.find(a => a.id === apptId);
    rschCurrentEventId = APPT_TYPE_EVENT_IDS[appt?.type] || '4496802';

    // Modifica il modal reschedule esistente per la modalità "libero"
    const titleEl    = document.getElementById('rschModalTitle');
    const subtitleEl = document.getElementById('rschModalSubtitle');
    const reasonEl   = document.getElementById('rschReasonField');
    const btnEl      = document.getElementById('rescheduleSubmitBtn');

    const apptTypeLabel = { consulenza: 'consulenza', 'pre-seduta': 'pre-seduta', seduta: 'seduta' };
    const typeLabel = apptTypeLabel[appt?.type] || 'appuntamento';
    if (titleEl)    titleEl.innerHTML  = `<i class="fas fa-calendar-alt"></i> Cambia data ${typeLabel}`;
    if (subtitleEl) subtitleEl.textContent = `Scegli la nuova data. Il cambio è immediato.`;
    if (reasonEl)   reasonEl.style.display = 'none';
    if (btnEl) {
        btnEl.innerHTML = '<i class="fas fa-check"></i> Conferma cambio data';
        btnEl.onclick   = submitFreeReschedule;
    }

    document.getElementById('rescheduleApptId').value = apptId;
    document.getElementById('rescheduleReason').value = 'reschedule-libero';  // sentinel
    const msg = document.getElementById('rescheduleMsg');
    msg.textContent = ''; msg.style.color = '';
    const today = new Date();
    rschState = {
        year: today.getFullYear(), month: today.getMonth(),
        slots: {}, loadedMonths: new Set(), loadingMonths: new Set(),
        selectedDate: null, selectedTime: null, selectedTimeLabel: null,
    };
    document.getElementById('rschTimesWrap').classList.add('hidden');
    document.getElementById('rschSummary').classList.add('hidden');

    ['rschPrevMonth', 'rschNextMonth'].forEach(id => {
        const old = document.getElementById(id);
        if (!old) return;
        const clone = old.cloneNode(true);
        old.parentNode.replaceChild(clone, old);
    });
    document.getElementById('rschPrevMonth').addEventListener('click', rschPrevMonth);
    document.getElementById('rschNextMonth').addEventListener('click', rschNextMonth);

    document.getElementById('rescheduleModal').style.display = 'flex';
    rschRenderCalendar();
    rschFetchMonthSlots(rschState.year, rschState.month);
}

function _resetRescheduleModalToRequestMode() {
    const titleEl    = document.getElementById('rschModalTitle');
    const subtitleEl = document.getElementById('rschModalSubtitle');
    const reasonEl   = document.getElementById('rschReasonField');
    const btnEl      = document.getElementById('rescheduleSubmitBtn');
    if (titleEl)    titleEl.innerHTML  = '<i class="fas fa-calendar-alt"></i> Cambia data';
    if (subtitleEl) subtitleEl.textContent = 'Scegli una data disponibile. La richiesta sarà inviata a Irene — la data attuale resterà invariata fino alla conferma.';
    if (reasonEl)   reasonEl.style.display = '';
    if (btnEl) {
        btnEl.innerHTML = '<i class="fas fa-paper-plane"></i> Invia richiesta';
        btnEl.onclick   = submitRescheduleRequest;
    }
    _freeRschCtx = { apptId: null, calBookingUid: null, oldScheduledAt: null };
}

// Override closeRescheduleModal to also reset free-reschedule mode
const _origCloseRescheduleModal = typeof closeRescheduleModal !== 'undefined' ? closeRescheduleModal : null;
function closeRescheduleModal() {
    document.getElementById('rescheduleModal').style.display = 'none';
    _resetRescheduleModalToRequestMode();
}

async function submitFreeReschedule() {
    const msg = document.getElementById('rescheduleMsg');
    const btn = document.getElementById('rescheduleSubmitBtn');
    if (btn.disabled) return; // double-click guard
    msg.style.color = 'var(--red)';
    if (!rschState.selectedDate) { msg.textContent = 'Seleziona una data dal calendario.'; return; }
    if (!rschState.selectedTime) { msg.textContent = 'Seleziona un orario disponibile.'; return; }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="margin-right:5px;font-size:0.85em;"></i>Attendere…';
    msg.style.color = 'var(--text-muted)';
    msg.textContent = 'Cambio in corso...';

    try {
        const meta = currentUser.user_metadata || {};
        const clientName  = [meta.first_name, meta.last_name].filter(Boolean).join(' ') || currentUser.email;
        const clientEmail = currentUser.email;

        const res = await fetch(FREE_RSCH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appointment_id:   _freeRschCtx.apptId,
                new_start_iso:    rschState.selectedTime,
                client_id:        currentUser.id,
                client_email:     clientEmail,
                client_name:      clientName,
                old_cal_booking_uid: _freeRschCtx.calBookingUid || null,
                freed_slot_at:    _freeRschCtx.oldScheduledAt || null,
            }),
        });
        if (!res.ok) throw new Error('Errore ' + res.status);
        closeRescheduleModal();
        await loadAllData();
    } catch (e) {
        msg.style.color = 'var(--red)';
        msg.textContent = 'Errore: ' + (e.message || 'riprova.');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> Conferma cambio data';
    }
}

// ─────────────────────────────────────────────
//  RIPRENOTA CONSULENZA — Modal interno
// ─────────────────────────────────────────────

const RB_CAL_BOOKINGS_URL = 'https://n8n.srv1204993.hstgr.cloud/webhook/cal-bookings';
const RB_N8N_WEBHOOK_URL  = 'https://n8n.srv1204993.hstgr.cloud/webhook/dc4275f9-bee2-427e-96ef-7cbf9c92b5a9';
const RB_EVENT_DURATION   = 20; // minuti

let rbState = {
    year: null, month: null,
    slots: {},
    loadedMonths: new Set(),
    loadingMonths: new Set(),
    selectedDate: null,
    selectedTime: null,
    selectedTimeLabel: null,
    isSubmitting: false,
};
let rbClientProfile = null; // { first_name, last_name, phone, email }

async function openRebookModal() {
    // Reset state
    const today = new Date();
    rbState = {
        year: today.getFullYear(), month: today.getMonth(),
        slots: {}, loadedMonths: new Set(), loadingMonths: new Set(),
        selectedDate: null, selectedTime: null, selectedTimeLabel: null,
        isSubmitting: false,
    };

    // Carica profilo cliente se non già in cache
    if (!rbClientProfile) {
        const { data } = await db.from('clients')
            .select('first_name, last_name, phone')
            .eq('id', currentUser.id).single();
        rbClientProfile = { ...(data || {}), email: currentUser.email };
    }

    // Reset default: Studio + Contanti, motivazione nascosta, idea vuota
    const studioRadio = document.getElementById('rbLuogoStudio');
    const waRadio     = document.getElementById('rbLuogoWa');
    const contantiRadio = document.getElementById('rbPagContanti');
    const posRadio      = document.getElementById('rbPagPOS');
    const motivoBox   = document.getElementById('rbWhatsappMotivo');
    const motivoInput = document.getElementById('rbMotivoVideo');
    const ideaEl      = document.getElementById('rbIdea');
    if (studioRadio) studioRadio.checked = true;
    if (waRadio) waRadio.checked = false;
    if (contantiRadio) contantiRadio.checked = true;
    if (posRadio) posRadio.checked = false;
    if (motivoBox) motivoBox.style.display = 'none';
    if (motivoInput) motivoInput.value = '';
    if (ideaEl) ideaEl.value = '';

    // Reset UI
    document.getElementById('rbTimesWrap').classList.add('hidden');
    document.getElementById('rbSummary').classList.add('hidden');
    const btn = document.getElementById('rbSubmitBtn');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-calendar-check"></i> Conferma prenotazione';
    const msg = document.getElementById('rbMsg');
    msg.textContent = '';

    // Nav buttons (clona per evitare listener duplicati)
    ['rbPrevMonth', 'rbNextMonth'].forEach(id => {
        const old = document.getElementById(id);
        if (!old) return;
        const clone = old.cloneNode(true);
        old.parentNode.replaceChild(clone, old);
    });
    document.getElementById('rbPrevMonth').addEventListener('click', rbPrevMonth);
    document.getElementById('rbNextMonth').addEventListener('click', rbNextMonth);

    document.getElementById('rebookModal').style.display = 'flex';
    rbRenderCalendar();
    rbFetchMonthSlots(rbState.year, rbState.month);
}

function closeRebookModal() {
    document.getElementById('rebookModal').style.display = 'none';
}

// Toggle motivazione WhatsApp Video nel rebook modal
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('input[name="rbLuogo"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const box = document.getElementById('rbWhatsappMotivo');
            if (box) box.style.display = radio.value === 'integrations:whatsapp_video' && radio.checked ? 'block' : 'none';
        });
    });
});

function rbFmtDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function rbFetchMonthSlots(year, month) {
    const key = `${year}-${month}`;
    if (rbState.loadedMonths.has(key) || rbState.loadingMonths.has(key)) return;
    rbState.loadingMonths.add(key);

    const loadEl = document.getElementById('rbCalLoading');
    loadEl.innerHTML = '<span class="rsch-spinner"></span> Caricamento disponibilità...';
    loadEl.classList.remove('hidden');

    const startTime = new Date(year, month, 1, 0, 0, 0).toISOString();
    const endTime   = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

    try {
        const url = `${RSCH_SLOTS_URL}?eventTypeId=${RSCH_EVENT_ID}` +
            `&startTime=${encodeURIComponent(startTime)}` +
            `&endTime=${encodeURIComponent(endTime)}` +
            `&timeZone=${encodeURIComponent(RSCH_TIMEZONE)}`;

        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (data.slots) {
            for (const [date, arr] of Object.entries(data.slots)) {
                rbState.slots[date] = arr.map(s => s.time).filter(Boolean);
            }
        }

        rbState.loadedMonths.add(key);
        rbState.loadingMonths.delete(key);
        loadEl.classList.add('hidden');
        rbRenderCalendar();
    } catch(e) {
        rbState.loadingMonths.delete(key);
        loadEl.innerHTML = '<span style="color:var(--red);font-size:0.76rem;"><i class="fas fa-exclamation-circle"></i> Errore caricamento disponibilità</span>';
    }
}

function rbRenderCalendar() {
    const { year, month, slots, selectedDate } = rbState;
    const labelEl = document.getElementById('rbMonthLabel');
    if (labelEl) labelEl.textContent = `${RSCH_MESI[month]} ${year}`;

    const today = new Date();
    const prevBtn = document.getElementById('rbPrevMonth');
    if (prevBtn) {
        prevBtn.disabled = year < today.getFullYear() ||
            (year === today.getFullYear() && month <= today.getMonth());
    }

    const grid = document.getElementById('rbCalGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const firstDayRaw = new Date(year, month, 1).getDay();
    const firstDayMon = firstDayRaw === 0 ? 6 : firstDayRaw - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const minDate = new Date(today);
    minDate.setDate(minDate.getDate() + 1);
    const minStr   = rbFmtDate(minDate);
    const todayStr = rbFmtDate(today);

    for (let i = 0; i < firstDayMon; i++) {
        const el = document.createElement('div');
        el.className = 'rsch-day empty';
        grid.appendChild(el);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const d    = new Date(year, month, day);
        const dStr = rbFmtDate(d);
        const isPast     = dStr < minStr;
        const isSelected = dStr === selectedDate;
        const hasSlots   = slots[dStr] && slots[dStr].length > 0;

        const cell = document.createElement('div');
        cell.textContent = day;

        if (isSelected) {
            cell.className = 'rsch-day selected';
        } else if (isPast) {
            cell.className = 'rsch-day past';
        } else if (hasSlots) {
            cell.className = 'rsch-day avail' + (dStr === todayStr ? ' today-avail' : '');
            cell.title = `${slots[dStr].length} orari disponibili`;
            cell.addEventListener('click', () => rbSelectDate(dStr));
        } else {
            cell.className = 'rsch-day unavail';
        }
        grid.appendChild(cell);
    }
}

function rbPrevMonth() {
    if (rbState.month === 0) { rbState.month = 11; rbState.year--; }
    else rbState.month--;
    rbRenderCalendar();
    rbFetchMonthSlots(rbState.year, rbState.month);
}

function rbNextMonth() {
    if (rbState.month === 11) { rbState.month = 0; rbState.year++; }
    else rbState.month++;
    rbRenderCalendar();
    rbFetchMonthSlots(rbState.year, rbState.month);
}

function rbSelectDate(dateStr) {
    rbState.selectedDate = dateStr;
    rbState.selectedTime = null;
    rbState.selectedTimeLabel = null;
    document.getElementById('rbSummary').classList.add('hidden');
    rbRenderCalendar();
    rbRenderTimeSlots(dateStr, rbState.slots[dateStr] || []);
    document.getElementById('rbTimesWrap').classList.remove('hidden');
}

function rbRenderTimeSlots(dateStr, slots) {
    const grid  = document.getElementById('rbTimesGrid');
    const title = document.getElementById('rbTimesTitle');
    grid.innerHTML = '';

    const d = new Date(dateStr + 'T12:00:00');
    const dateLabel = d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long' });
    title.innerHTML = `<i class="far fa-clock"></i> Orari · <span style="color:var(--gold)">${dateLabel}</span>`;

    if (!slots.length) {
        grid.innerHTML = '<p style="font-size:0.78rem;color:var(--text-muted);grid-column:1/-1;padding:4px 0;">Nessun orario disponibile per questa data.</p>';
        return;
    }

    slots.forEach(iso => {
        const t   = new Date(iso);
        const lbl = t.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: RSCH_TIMEZONE });
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rsch-time-btn';
        btn.textContent = lbl;
        btn.addEventListener('click', () => rbSelectTime(iso, lbl, btn));
        grid.appendChild(btn);
    });
}

function rbSelectTime(iso, label, btn) {
    rbState.selectedTime      = iso;
    rbState.selectedTimeLabel = label;

    document.querySelectorAll('#rbTimesGrid .rsch-time-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    const d = new Date(rbState.selectedDate + 'T12:00:00');
    const dateLabel = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    document.getElementById('rbSummaryText').textContent = `${dateLabel} alle ${label}`;
    document.getElementById('rbSummary').classList.remove('hidden');
    document.getElementById('rbTimesWrap').classList.add('hidden');
}

function rbClearSelection() {
    rbState.selectedTime      = null;
    rbState.selectedTimeLabel = null;
    document.getElementById('rbSummary').classList.add('hidden');
    if (rbState.selectedDate) {
        rbRenderTimeSlots(rbState.selectedDate, rbState.slots[rbState.selectedDate] || []);
        document.getElementById('rbTimesWrap').classList.remove('hidden');
    }
}

async function submitRebook() {
    if (rbState.isSubmitting) return;

    const msg = document.getElementById('rbMsg');
    const btn = document.getElementById('rbSubmitBtn');
    msg.style.color = 'var(--red)';

    if (!rbState.selectedDate || !rbState.selectedTime) {
        msg.textContent = 'Seleziona una data e un orario dal calendario.';
        return;
    }

    const luogoRadio = document.querySelector('input[name="rbLuogo"]:checked');
    const pagRadio   = document.querySelector('input[name="rbPagamento"]:checked');
    const luogo      = luogoRadio ? luogoRadio.value : 'inPerson';
    const pagamento  = pagRadio ? pagRadio.value : 'Contanti';
    const idea       = (document.getElementById('rbIdea').value || '').trim();
    const motivoVideo = (document.getElementById('rbMotivoVideo')?.value || '').trim();

    // Motivazione obbligatoria per WhatsApp Video
    if (luogo === 'integrations:whatsapp_video' && !motivoVideo) {
        msg.textContent = 'Indica il motivo per cui non puoi venire in studio.';
        return;
    }

    rbState.isSubmitting = true;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="margin-right:5px;font-size:0.85em;"></i>Attendere…';
    msg.style.color = 'var(--text-muted)';
    msg.textContent = 'Creazione prenotazione in corso...';

    try {
        const profile = rbClientProfile || {};
        const nome    = profile.first_name || '';
        const cognome = profile.last_name  || '';
        const email   = profile.email || currentUser.email || '';
        const telefono = profile.phone || '';

        // 1. Crea booking su Cal.com
        const startISO = rbState.selectedTime;
        const endDate  = new Date(new Date(startISO).getTime() + RB_EVENT_DURATION * 60000);

        const responses = {
            name:  `${nome} ${cognome}`.trim(),
            email: email,
            location: { value: luogo, optionValue: '' },
            notes: [
                idea ? `Descrizione idea tattoo: ${idea}` : null,
                `Preferenza pagamento: ${pagamento}`,
                motivoVideo ? `Motivo video: ${motivoVideo}` : null,
            ].filter(Boolean).join('\n'),
        };
        if (telefono && /^\+\d{7,15}$/.test(telefono)) {
            responses.attendeePhoneNumber = telefono;
        }

        const calBody = {
            eventTypeId: parseInt(RSCH_EVENT_ID),
            start: startISO,
            end: endDate.toISOString(),
            responses,
            metadata: { source: 'dashboard_rebook', descrizione_idea: idea, pagamento, motivo_video: motivoVideo || undefined },
            timeZone: RSCH_TIMEZONE,
            language: 'it',
        };

        const calResp = await fetch(RB_CAL_BOOKINGS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(calBody),
        });
        const calResult = await calResp.json().catch(() => null);

        if (!calResp.ok || calResult?.status === 'error' || calResult?.error) {
            const errMsg = calResult?.message || calResult?.error?.message || calResult?.error || `Errore prenotazione (${calResp.status}).`;
            throw new Error(errMsg);
        }

        // Cal.com v2 wraps response in { status: "success", data: { uid, id } }
        const calBooking = calResult?.data || calResult || {};

        // 2. Notifica n8n per salvare appuntamento in Supabase
        const timeObj = new Date(startISO);
        const dateObj = new Date(rbState.selectedDate + 'T12:00:00');
        const params  = new URLSearchParams({
            source: 'dashboard_rebook',
            timestamp: new Date().toISOString(),
            cal_booking_uid:    calBooking.uid    || '',
            cal_booking_id:     String(calBooking.id || ''),
            cal_booking_status: calBooking.status || 'ACCEPTED',
            nome, cognome, email,
            telefono: telefono || '',
            data_appuntamento: dateObj.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
            ora_appuntamento:  timeObj.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: RSCH_TIMEZONE }),
            datetime_iso: startISO,
            descrizione_idea: idea,
            preferenza_pagamento: pagamento,
            luogo,
            motivo_video: motivoVideo || '',
            gdpr_consent: 'true',
        });

        // Non blocchiamo se n8n fallisce: la prenotazione Cal.com è confermata
        fetch(`${RB_N8N_WEBHOOK_URL}?${params.toString()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ foto: [] }),
        }).catch(() => {});

        // Successo
        msg.style.color = 'var(--green, #6dc07c)';
        msg.textContent = '✓ Consulenza prenotata con successo!';
        btn.innerHTML = '<i class="fas fa-check"></i> Prenotato';

        setTimeout(() => {
            closeRebookModal();
            loadAllData();
        }, 2000);

    } catch(e) {
        rbState.isSubmitting = false;
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-calendar-check"></i> Conferma prenotazione';
        msg.style.color = 'var(--red)';
        msg.textContent = e.message || 'Errore durante la prenotazione. Riprova.';
    }
}

// ─────────────────────────────────────────────
//  PROPOSTA IRENE — Accetta / Rifiuta
// ─────────────────────────────────────────────
const DASHBOARD_CAL_RESCHEDULE_URL = 'https://n8n.srv1204993.hstgr.cloud/webhook/cal-reschedule';

async function acceptIreneProposal(requestId, apptId, newDate, newTime, newConsultationMode) {
    try {
        // Se newTime è già un ISO completo (da Cal.com), usalo direttamente
        const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
        let newScheduledAt;
        if (isoPattern.test(newTime)) {
            newScheduledAt = newTime;
        } else {
            const [h, m] = newTime.split(':');
            const d = new Date(newDate);
            d.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
            newScheduledAt = d.toISOString();
        }
        const now = new Date().toISOString();

        // Controlla duplicati: nessun altro appuntamento dello stesso cliente al nuovo orario
        const clientId = currentUser?.id;
        const { data: existing } = await db.from('appointments')
            .select('id')
            .eq('client_id', clientId)
            .eq('scheduled_at', newScheduledAt)
            .neq('id', apptId)
            .neq('status', 'cancelled')
            .maybeSingle();
        if (existing) {
            showToast('Hai già un appuntamento in quell\'orario.', true);
            return;
        }

        // 1a. Leggi vecchio scheduled_at + tipo PRIMA di aggiornare
        const { data: oldAppt } = await db.from('appointments')
            .select('scheduled_at, type, cal_booking_uid, consultation_mode, payment_method, notes')
            .eq('id', apptId).single();
        const oldScheduledAt = oldAppt?.scheduled_at || null;

        // 1b. Aggiorna scheduled_at (e consultation_mode se fornita) dell'appuntamento
        const apptUpdate = { scheduled_at: newScheduledAt };
        if (newConsultationMode) apptUpdate.consultation_mode = newConsultationMode;
        const { error: apptErr } = await db
            .from('appointments')
            .update(apptUpdate)
            .eq('id', apptId);
        if (apptErr) throw apptErr;

        // 2. Segna la richiesta come accettata
        const { error: rrErr } = await db
            .from('reschedule_requests')
            .update({ status: 'accepted', resolved_at: now })
            .eq('id', requestId);
        if (rrErr) throw rrErr;

        // 3. Sincronizza con Cal.com (usa dati già letti al punto 1a)
        const apptData = oldAppt;
        const _evtIds = { 'consulenza': 5147645, 'pre-seduta': 5147653, 'seduta': 5147823 };
        const _eventTypeId = _evtIds[apptData?.type] || 5147645;
        const _clientName  = currentUser?.user_metadata?.full_name || currentUser?.email || '';
        const _endIso      = new Date(new Date(newScheduledAt).getTime() + 60 * 60 * 1000).toISOString();
        try {
            const _calResp = await fetch(DASHBOARD_CAL_RESCHEDULE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appointment_id:  apptId,
                    new_start_iso:   newScheduledAt,
                    cal_booking_uid: apptData?.cal_booking_uid || null,
                    client_email:    currentUser?.email || null,
                    reason:          'Proposta di Irene accettata dal cliente',
                    fallback_new_booking: {
                        eventTypeId: _eventTypeId,
                        start:       newScheduledAt,
                        end:         _endIso,
                        responses: {
                            name:     _clientName,
                            email:    currentUser?.email || '',
                            location: { value: newConsultationMode || apptData?.consultation_mode || 'integrations:whatsapp_video', optionValue: '' },
                            notes:    apptData?.notes || '',
                        },
                        metadata:  { pagamento: apptData?.payment_method || '' },
                        timeZone:  'Europe/Rome',
                        language:  'it',
                    },
                }),
            });
            if (!_calResp.ok) {
                const _calErr = await _calResp.json().catch(() => null);
                console.warn('[Cal reschedule] risposta non OK:', _calErr);
                showToast('⚠️ Data confermata, ma la sincronizzazione del calendario non è riuscita. Contatta Irene.', true);
            }
        } catch (_calNetErr) {
            console.warn('[Cal reschedule] errore rete:', _calNetErr);
        }

        // 4. Notifica a Irene: posto liberato (solo se seduta)
        if (apptData?.type === 'seduta' && oldScheduledAt) {
            const meta = currentUser?.user_metadata || {};
            const clientName = [meta.first_name, meta.last_name].filter(Boolean).join(' ') || currentUser?.email || 'Un cliente';
            const oldDateStr = new Date(oldScheduledAt).toLocaleDateString('it-IT',
                { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
            db.from('notifications').insert({
                type:      'seduta_free_reschedule',
                title:     'Posto liberato',
                body:      `${clientName} ha accettato la nuova data. Il vecchio posto (${oldDateStr}) è ora libero.`,
                client_id: currentUser?.id || null,
                is_read:   false,
                meta:      JSON.stringify({ freed_slot_at: oldScheduledAt }),
            }).then(({ error: nErr }) => {
                if (nErr) console.warn('[freed-slot notify]', nErr);
            });
        }

        // 5. Ricarica dashboard
        await loadAllData();
    } catch (e) {
        showToast('Errore: ' + (e.message || 'riprova.'), true);
    }
}

async function rejectIreneProposal(requestId) {
    try {
        const now = new Date().toISOString();

        // 1. Segna la proposta come rifiutata
        const { error } = await db
            .from('reschedule_requests')
            .update({ status: 'rejected', resolved_at: now })
            .eq('id', requestId);
        if (error) throw error;

        // 2. Rimuovi dalla memoria locale
        const idx = allReschedules.findIndex(r => r.id === requestId);
        if (idx !== -1) allReschedules.splice(idx, 1);

        // 3. Notifica per Irene (fire-and-forget — non blocca se fallisce)
        const meta = currentUser?.user_metadata || {};
        const clientName = [meta.first_name, meta.last_name].filter(Boolean).join(' ') || 'Il cliente';
        (async () => {
            try {
                await db.from('notifications').insert({
                    type:      'irene_proposal_rejected',
                    title:     'Proposta rifiutata dal cliente',
                    body:      `${clientName} ha rifiutato la proposta di cambio data.`,
                    client_id: currentUser?.id || null,
                    is_read:   false,
                });
            } catch(e) { console.warn('[notify reject]', e); }
        })();

        // 4. Ricarica dashboard
        await loadAllData();
    } catch (e) {
        showToast('Errore: ' + (e.message || 'riprova.'), true);
    }
}

// ─────────────────────────────────────────────
//  WAITLIST — Gestione anticipa seduta
// ─────────────────────────────────────────────
const WL_REQUEST_URL = 'https://n8n.srv1204993.hstgr.cloud/webhook/waitlist-request';

function buildWaitlistBlock(waitlist) {
    if (waitlist?.active) {
        return `
        <div style="margin-top:16px;background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.2);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;">
            <div>
                <div style="font-size:0.8rem;font-weight:600;color:#D4AF37;margin-bottom:5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span><i class="fas fa-star" style="margin-right:5px;"></i>Lista d'attesa</span>
                    <span style="background:rgba(212,175,55,0.15);border:1px solid rgba(212,175,55,0.3);border-radius:20px;padding:2px 9px;font-size:0.66rem;font-weight:500;letter-spacing:0.3px;">Attiva</span>
                </div>
                <div style="font-size:0.74rem;color:#888;line-height:1.5;">
                    Sei in lista. Se si libera un posto prima della tua data, riceverai una notifica.<br>Hai <strong style="color:#bbb;">24 ore</strong> per accettare. Se rifiuti o non rispondi in tempo, resti in lista ma in ultima posizione.
                </div>
            </div>
            <div style="display:flex;justify-content:flex-end;">
                <button class="btn-reschedule" style="margin-top:0;" onclick="openWlLeaveModal()">
                    <i class="fas fa-sign-out-alt"></i> Esci dalla lista
                </button>
            </div>
        </div>`;
    }
    return `
    <div style="margin-top:16px;background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.2);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;">
        <div>
            <div style="font-size:0.8rem;font-weight:600;color:#D4AF37;margin-bottom:5px;">
                <i class="fas fa-star" style="margin-right:5px;"></i>Lista d'attesa
            </div>
            <div style="font-size:0.74rem;color:#888;line-height:1.5;">
                Vuoi un posto anticipato? Entra in lista e ricevi una notifica se si libera una data prima della tua.<br>Hai <strong style="color:#bbb;">24 ore</strong> per rispondere.
            </div>
        </div>
        <div style="display:flex;justify-content:flex-end;">
            <button class="btn-reschedule" style="margin-top:0;" onclick="requestWaitlistChange('join')">
                <i class="fas fa-star"></i> Entra in lista
            </button>
        </div>
    </div>`;
}

async function requestWaitlistChange(type) {
    if (type === 'leave') {
        openWlLeaveModal();
    } else {
        openWlJoinModal();
    }
}

function openWlLeaveModal() {
    document.getElementById('wlLeaveModal').style.display = 'flex';
}
function closeWlLeaveModal() {
    document.getElementById('wlLeaveModal').style.display = 'none';
}
async function confirmWlLeave() {
    if (!currentWaitlist?.active) { showToast('Non sei in lista.', 3000, true); closeWlLeaveModal(); return; }
    closeWlLeaveModal();
    const { data, error } = await db.from('waitlist_requests').insert({
        client_id: currentUser.id,
        request_type: 'leave',
    }).select().single();
    if (error) { showToast('Errore: ' + error.message, 3500, true); return; }
    fetch(WL_REQUEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: data.id, client_id: currentUser.id, request_type: 'leave' }),
    }).catch(() => showToast('Richiesta salvata ma notifica non inviata.', 4000, true));
    showToast('Richiesta inviata. Irene risponderà a breve.');
}

function openWlJoinModal() {
    document.getElementById('wlJoinMsg').textContent = '';
    document.getElementById('wlJoinModal').style.display = 'flex';
}

function closeWlJoinModal() {
    document.getElementById('wlJoinModal').style.display = 'none';
}

async function submitWlJoinRequest() {
    const msg = document.getElementById('wlJoinMsg');
    // Prevenzione doppia richiesta
    const { data: existing } = await db.from('waitlist_requests')
        .select('id').eq('client_id', currentUser.id).eq('request_type', 'join').eq('status', 'pending').maybeSingle();
    if (existing) { msg.textContent = 'Hai già una richiesta in attesa.'; return; }
    const { data, error } = await db.from('waitlist_requests').insert({
        client_id: currentUser.id,
        request_type: 'join',
    }).select().single();
    if (error) { msg.textContent = 'Errore: ' + error.message; return; }
    fetch(WL_REQUEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: data.id, client_id: currentUser.id, request_type: 'join' }),
    }).catch(() => showToast('Richiesta salvata ma notifica non inviata.', 4000, true));
    closeWlJoinModal();
    showToast('Richiesta inviata. Irene risponderà a breve.');
}

// ─────────────────────────────────────────────
//  ADVANCE OFFER (offerta posto anticipato)
// ─────────────────────────────────────────────

function escAttr(s) { return String(s).replace(/[&"'<>]/g, c => ({'&':'&amp;','"':'&quot;',"'":'&#39;','<':'&lt;','>':'&gt;'}[c])); }

function buildAdvanceOfferBanner(offer) {
    const date = new Date(offer.freed_slot_at).toLocaleDateString('it-IT', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
    });
    const expiresAt = new Date(offer.expires_at).toLocaleDateString('it-IT', {
        day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
    });
    return `
    <div style="margin-bottom:14px;background:rgba(109,192,124,0.08);border:1px solid rgba(109,192,124,0.35);
        border-radius:10px;padding:14px 16px;">
        <div style="font-size:0.85rem;color:#6dc07c;font-weight:600;margin-bottom:6px;">
            <i class="fas fa-bell" style="margin-right:5px;"></i>Posto disponibile!
        </div>
        <div style="font-size:0.82rem;color:#ccc;margin-bottom:10px;">
            Puoi anticipare una seduta al <strong style="color:#fff;">${date}</strong>.
            <div style="margin-top:4px;color:#666;font-size:0.78rem;">Offerta valida fino al ${expiresAt}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button onclick="acceptAdvanceOffer('${escAttr(offer.id)}','${escAttr(offer.freed_slot_at)}')"
                style="font-size:0.78rem;padding:6px 14px;border-radius:7px;cursor:pointer;
                background:rgba(109,192,124,0.2);border:1px solid rgba(109,192,124,0.5);color:#6dc07c;font-family:inherit;">
                <i class="fas fa-check"></i> Accetta
            </button>
            <button onclick="declineAdvanceOffer('${escAttr(offer.id)}','${escAttr(offer.freed_slot_at)}')"
                style="font-size:0.78rem;padding:6px 14px;border-radius:7px;cursor:pointer;
                background:transparent;border:1px solid rgba(248,113,113,0.35);color:#f87171;font-family:inherit;">
                <i class="fas fa-times"></i> Rifiuta
            </button>
        </div>
    </div>`;
}

const ADVANCE_OFFER_ACCEPTED_URL = 'https://n8n.srv1204993.hstgr.cloud/webhook/advance-offer-accepted';
const ADVANCE_OFFER_DECLINED_URL = 'https://n8n.srv1204993.hstgr.cloud/webhook/advance-offer-declined';

// PayPal — stesso Client ID usato per le prenotazioni seduta
// ⚠️ RICORDATI: va cambiato con il Client ID LIVE prima del lancio
const PAYPAL_CLIENT_ID = 'YOUR_PAYPAL_CLIENT_ID';
const EXTRA_SESSION_DEPOSIT = 50; // euro

function loadPayPalSDK() {
    return new Promise((resolve, reject) => {
        if (window.paypal) { resolve(); return; }
        const script = document.createElement('script');
        script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=EUR`;
        script.onload = resolve;
        script.onerror = () => reject(new Error('PayPal SDK non caricato'));
        document.body.appendChild(script);
    });
}

// Mostra modal PayPal per pagamento sessione extra.
// Restituisce orderId se pagato, null se annullato.
function showExtraSessionPayment() {
    return new Promise(async (resolve) => {
        const overlay = document.getElementById('paypalExtraOverlay');
        const container = document.getElementById('paypalExtraBtnContainer');
        const testBtn = document.getElementById('paypalExtraTestBtn');
        const cancelBtn = document.getElementById('paypalExtraCancelBtn');
        if (!overlay) { resolve(null); return; }

        container.innerHTML = '';
        overlay.style.display = 'flex';

        const cleanup = () => { overlay.style.display = 'none'; container.innerHTML = ''; };

        cancelBtn.onclick = () => { cleanup(); resolve(null); };

        // Test mode: mostra bottone test
        if (PAYPAL_CLIENT_ID === 'YOUR_PAYPAL_CLIENT_ID') {
            testBtn.style.display = '';
            testBtn.onclick = () => { cleanup(); resolve('TEST_ORDER_' + Date.now()); };
        } else {
            testBtn.style.display = 'none';
            try {
                await loadPayPalSDK();
                paypal.Buttons({
                    style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay' },
                    createOrder: (data, actions) => actions.order.create({
                        purchase_units: [{
                            amount: { value: EXTRA_SESSION_DEPOSIT.toFixed(2), currency_code: 'EUR' },
                            description: 'Acconto seduta extra - Irene Gipsy Tattoo'
                        }]
                    }),
                    onApprove: async (data, actions) => {
                        const order = await actions.order.capture();
                        cleanup();
                        resolve(order.id);
                    },
                    onError: () => {
                        showToast('Errore durante il pagamento. Riprova.', true);
                        cleanup();
                        resolve(null);
                    }
                }).render('#paypalExtraBtnContainer');
            } catch {
                showToast('PayPal non disponibile. Riprova più tardi.', true);
                cleanup();
                resolve(null);
            }
        }
    });
}

let _acceptingOffer = false;
async function acceptAdvanceOffer(offerId, freedSlotAt) {
    if (_acceptingOffer) return;
    _acceptingOffer = true;
    try { await _doAcceptAdvanceOffer(offerId, freedSlotAt); } finally { _acceptingOffer = false; }
}
async function _doAcceptAdvanceOffer(offerId, freedSlotAt) {
    // Recupera in parallelo: ultime sedute + dati cliente dalla tabella clients
    const [{ data: sedute }, { data: clientRec }] = await Promise.all([
        db.from('appointments')
            .select('*')
            .eq('client_id', currentUser.id)
            .eq('type', 'seduta')
            .in('status', ['confirmed', 'pending'])
            .order('scheduled_at', { ascending: false }),
        db.from('clients')
            .select('first_name, last_name')
            .eq('id', currentUser.id)
            .single(),
    ]);
    const lastSeduta = sedute?.[0] || null;
    const clientName = clientRec
        ? `${clientRec.first_name || ''} ${clientRec.last_name || ''}`.trim()
        : (currentUser.user_metadata?.full_name || currentUser.email);

    let keepLast = null;
    let extraPaypalOrderId = null;
    if (lastSeduta) {
        const lastDate = new Date(lastSeduta.scheduled_at).toLocaleDateString('it-IT',
            { day: '2-digit', month: 'long', year: 'numeric' });
        keepLast = await customConfirm(
            `Vuoi mantenere la tua seduta del ${lastDate} come sessione extra?\nPremi Conferma per mantenerla (acconto €${EXTRA_SESSION_DEPOSIT}), Annulla per cancellarla.`
        );

        // Se vuole tenerla → pagamento PayPal obbligatorio
        if (keepLast === true) {
            extraPaypalOrderId = await showExtraSessionPayment();
            if (!extraPaypalOrderId) {
                showToast('Pagamento annullato. L\'offerta è ancora attiva, riprova quando vuoi.');
                return;
            }
        }
    }

    const now = new Date().toISOString();

    // Segna offerta come accettata
    const { error: updateErr } = await db.from('seduta_advance_offers')
        .update({ status: 'accepted', keep_last_date: keepLast, resolved_at: now })
        .eq('id', offerId);
    if (updateErr) { showToast('Errore: ' + updateErr.message, true); return; }

    // Inserisci nuova seduta sulla data offerta
    const { data: newAppt, error: insertErr } = await db.from('appointments').insert({
        client_id:    currentUser.id,
        type:         'seduta',
        status:       'confirmed',
        scheduled_at: freedSlotAt,
        amount:       50,
        amount_paid:  0,
        notes:        'Anticipo via lista priorità',
    }).select().single();
    if (insertErr) { showToast('Errore inserimento seduta: ' + insertErr.message, true); return; }

    // Se non vuole tenere l'ultima, cancellala
    let cancelledApptId = null;
    if (keepLast === false && lastSeduta) {
        const { error: cancelErr } = await db.from('appointments').update({ status: 'cancelled' }).eq('id', lastSeduta.id);
        if (cancelErr) { showToast('Errore cancellazione seduta: ' + cancelErr.message, true); return; }
        cancelledApptId = lastSeduta.id;
    }

    // Rimuovi dalla waitlist
    const { error: wlErr } = await db.from('waitlist').update({ active: false }).eq('client_id', currentUser.id);
    if (wlErr) console.warn('[waitlist remove]', wlErr.message);

    // Inserisci notifica di conferma nella dashboard del cliente
    const freedDateStr = new Date(freedSlotAt).toLocaleDateString('it-IT',
        { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
    const { error: notifErr } = await db.from('notifications').insert({
        type:      'advance_offer_accepted',
        title:     'Seduta anticipata confermata!',
        body:      `La tua seduta è confermata per ${freedDateStr}. Riceverai un invito nel calendario.`,
        client_id: currentUser.id,
        is_read:   false,
    });
    if (notifErr) console.warn('[notif advance]', notifErr.message);

    // Se ha tenuto l'ultima seduta extra: segna pagamento PayPal + notifica Irene
    if (keepLast === true && lastSeduta) {
        await db.from('appointments').update({ acconto_payment_method: 'paypal' }).eq('id', lastSeduta.id);
        const lastDateStr = new Date(lastSeduta.scheduled_at).toLocaleDateString('it-IT',
            { day: '2-digit', month: 'long', year: 'numeric' });
        const { error: notifErr2 } = await db.from('notifications').insert({
            type:      'extra_seduta_payment',
            title:     `✅ ${clientName} ha pagato l'acconto seduta extra`,
            body:      `Ha accettato il posto del ${new Date(freedSlotAt).toLocaleDateString('it-IT',{day:'2-digit',month:'long'})} e ha mantenuto la seduta del ${lastDateStr}. Acconto €${EXTRA_SESSION_DEPOSIT} pagato (PayPal: ${extraPaypalOrderId}).`,
            client_id: lastSeduta.client_id,
            is_read:   false,
        });
        if (notifErr2) console.warn('[notif extra payment]', notifErr2.message);
    }

    // fire-and-forget n8n: crea booking Cal.com + email al cliente
    // NOTA: cal_booking_uid_old inviato SOLO se keepLast=false (altrimenti n8n cancellerebbe il booking ancora valido)
    fetch(ADVANCE_OFFER_ACCEPTED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            offer_id:                 offerId,
            new_appointment_id:       newAppt?.id || null,
            cancelled_appointment_id: cancelledApptId,
            freed_slot_at:            freedSlotAt,
            cal_booking_uid_old:      keepLast === false ? (lastSeduta?.cal_booking_uid || null) : null,
            client_email:             currentUser.email,
            client_name:              clientName,
            extra_session_paypal_id:  extraPaypalOrderId || null,
        }),
    }).catch(e => console.warn('[advance-offer-accepted]', e));

    await loadAllData();
}

async function declineAdvanceOffer(offerId, freedSlotAt) {
    const ok = await customConfirm('Sei sicuro/a di voler rifiutare? Verrai spostato/a in fondo alla lista d\'attesa.');
    if (!ok) return;
    const now = new Date().toISOString();
    const { error } = await db.from('seduta_advance_offers')
        .update({ status: 'declined', resolved_at: now })
        .eq('id', offerId);
    if (error) { showToast('Errore: ' + error.message, true); return; }

    // Sposta il cliente in fondo alla lista d'attesa
    const { data: allWl } = await db.from('waitlist')
        .select('position')
        .eq('active', true)
        .order('position', { ascending: false })
        .limit(1);
    const maxPos = allWl?.[0]?.position || 0;
    await db.from('waitlist')
        .update({ position: maxPos + 1 })
        .eq('client_id', currentUser.id)
        .eq('active', true);

    // fire-and-forget n8n per notificare Irene
    fetch(ADVANCE_OFFER_DECLINED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offer_id: offerId, freed_slot_at: freedSlotAt }),
    }).catch(e => console.warn('[advance-offer-declined]', e));

    showToast('Offerta rifiutata. Sei stato/a spostato/a in fondo alla lista d\'attesa.');
    await loadAllData();
}

// ─────────────────────────────────────────────
//  ELIMINA ACCOUNT (richiesta dal cliente)
// ─────────────────────────────────────────────
function renderDeleteAccountStatus() {
    const statusEl = document.getElementById('deleteAccountStatus');
    const btn      = document.getElementById('deleteAccountBtn');
    if (!statusEl || !btn) return;
    if (currentClientDeletionRequestedAt) {
        const d = new Date(currentClientDeletionRequestedAt).toLocaleDateString('it-IT',
            { day: '2-digit', month: 'long', year: 'numeric' });
        statusEl.innerHTML = `
            <div style="background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.25);
                border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:0.82rem;color:#f87171;line-height:1.5;">
                <i class="fas fa-hourglass-half" style="margin-right:6px;"></i>
                Richiesta inviata il <strong>${d}</strong>. In attesa della conferma di Irene.
            </div>`;
        btn.style.display = 'none';
    } else {
        statusEl.innerHTML = '';
        btn.style.display  = '';
    }
}

function openDeleteAccountModal() {
    document.getElementById('deleteAccountMsg').textContent = '';
    const btn = document.getElementById('deleteAccountConfirmBtn');
    btn.disabled  = false;
    btn.innerHTML = '<i class="fas fa-user-slash" style="margin-right:6px;"></i>Sì, invia la richiesta';
    document.getElementById('deleteAccountModal').style.display = 'flex';
}

function closeDeleteAccountModal() {
    document.getElementById('deleteAccountModal').style.display = 'none';
}

async function confirmRequestDeletion() {
    const btn = document.getElementById('deleteAccountConfirmBtn');
    const msg = document.getElementById('deleteAccountMsg');
    btn.disabled  = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="margin-right:6px;"></i>Invio…';

    const now = new Date().toISOString();
    const { error } = await db.from('clients')
        .update({ deletion_requested_at: now })
        .eq('id', currentUser.id);

    if (error) {
        msg.textContent = 'Errore: ' + error.message;
        btn.disabled  = false;
        btn.innerHTML = '<i class="fas fa-user-slash" style="margin-right:6px;"></i>Sì, invia la richiesta';
        return;
    }

    // Notifica per Irene in Supabase
    const meta = currentUser.user_metadata || {};
    const name = meta.full_name || [meta.first_name, meta.last_name].filter(Boolean).join(' ') || currentUser.email;
    db.from('notifications').insert({
        type:      'account_deletion_request',
        title:     'Richiesta cancellazione account',
        body:      `${name} (${currentUser.email}) ha richiesto la cancellazione del proprio account.`,
        client_id: currentUser.id,
        is_read:   false,
    }).catch(e => console.warn('[delete-notif]', e));

    closeDeleteAccountModal();
    currentClientDeletionRequestedAt = now;
    renderDeleteAccountStatus();
}
