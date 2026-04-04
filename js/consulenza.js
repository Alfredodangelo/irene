// =============================================
//  CONSULENZA BOOKING PAGE - Irene Gipsy Tattoo
//  Integrazione: Cal.com API + n8n webhook
// =============================================

// =============================================
//  ⚙️  CONFIGURAZIONE  ⚙️
//  Sostituisci i placeholder con i tuoi valori
// =============================================
const CONFIG = {

    // Cal.com Event Type ID (consulenza)
    CAL_EVENT_TYPE_ID: '4496804',

    // Durata consulenza in minuti
    CAL_EVENT_DURATION_MINUTES: 20,

    // n8n Webhook per i dati della consulenza
    N8N_WEBHOOK_URL: 'https://n8n.srv1204993.hstgr.cloud/webhook/dc4275f9-bee2-427e-96ef-7cbf9c92b5a9',

    // Proxy n8n — nasconde l'API Key Cal.com
    N8N_CAL_SLOTS_URL:    'https://n8n.srv1204993.hstgr.cloud/webhook/cal-slots',
    N8N_CAL_BOOKINGS_URL: 'https://n8n.srv1204993.hstgr.cloud/webhook/cal-bookings',

    // Timezone
    TIMEZONE: 'Europe/Rome',
};
// =============================================

// Nomi dei mesi in italiano
const MESI = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

// Istanza intl-tel-input (telefono con bandiera)
let iti;

// Stato dell'applicazione
const state = {
    currentYear: null,
    currentMonth: null,
    availableSlots: {},   // { 'YYYY-MM-DD': ['ISO_datetime', ...] }
    selectedDate: null,   // 'YYYY-MM-DD'
    selectedTime: null,   // ISO datetime string
    loadingMonths: new Set(),
    loadedMonths: new Set(),
    photos: [],           // File[] - max 4
    isSubmitting: false
};

// =============================================
//  INIT
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
    const today = new Date();
    state.currentYear = today.getFullYear();
    state.currentMonth = today.getMonth();

    // Inizializza telefono con bandiera paese
    iti = window.intlTelInput(document.getElementById('telefono'), {
        initialCountry: 'it',
        preferredCountries: ['it'],
        utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@18.2.1/build/js/utils.js'
    });

    // Toggle campo motivazione video WhatsApp
    document.querySelectorAll('input[name="luogo"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const box = document.getElementById('whatsappMotivo');
            if (box) box.style.display = radio.value === 'integrations:whatsapp_video' && radio.checked ? 'block' : 'none';
        });
    });

    // Back button dinamico
    const fromDash = new URLSearchParams(location.search).get('from') === 'dashboard';
    if (fromDash) {
        const bl = document.querySelector('.back-link');
        if (bl) { bl.href = 'dashboard.html'; bl.innerHTML = '<i class="fas fa-arrow-left"></i> Torna alla dashboard'; }
    }

    // Se aperta dalla dashboard: pre-compila dati utente e nascondi il form
    if (fromDash && typeof db !== 'undefined') {
        try {
            const { data: { session } } = await db.auth.getSession();
            const user = session?.user;
            if (user) {
                const { data: profile } = await db.from('clients')
                    .select('first_name, last_name, phone')
                    .eq('id', user.id)
                    .single();
                if (profile) {
                    const _nEl = document.getElementById('nome');
                    const _cEl = document.getElementById('cognome');
                    const _eEl = document.getElementById('email');
                    _nEl.value = profile.first_name || ''; _nEl.readOnly = true;
                    _cEl.value = profile.last_name  || ''; _cEl.readOnly = true;
                    _eEl.value = user.email || '';          _eEl.readOnly = true;
                    if (profile.phone) iti.setNumber(profile.phone);
                    const section = document.getElementById('personalDataSection');
                    const title   = document.getElementById('personalDataTitle');
                    const booking = document.getElementById('bookingAsText');
                    if (section) section.style.display = 'none';
                    if (title)   title.style.display   = 'none';
                    if (booking) {
                        const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || user.email;
                        booking.innerHTML = `<i class="fas fa-user-check" style="color:#D4AF37;margin-right:6px;"></i>Stai prenotando come: <strong style="color:#e8e8e8;">${displayName}</strong> (${user.email})`;
                        booking.style.display = 'block';
                    }
                }
            }
        } catch(e) { /* silenzioso — lascia il form visibile */ }
    }

    checkConfig();
    renderCalendar();
    fetchMonthSlots(state.currentYear, state.currentMonth);

    // Calendar navigation
    document.getElementById('prevMonth').addEventListener('click', handlePrevMonth);
    document.getElementById('nextMonth').addEventListener('click', handleNextMonth);

    // Change date/time link
    document.getElementById('changeDateTime').addEventListener('click', () => {
        state.selectedTime = null;
        updateSelectedInfo();
        // Re-render time slots if date is still selected
        if (state.selectedDate) {
            const slots = state.availableSlots[state.selectedDate] || [];
            renderTimeSlots(state.selectedDate, slots);
        }
    });

    // Form submit
    document.getElementById('consulenzaForm').addEventListener('submit', handleSubmit);

    // File upload
    initFileUpload();
});

// =============================================
//  UTILITY
// =============================================
function showToast(msg, duration) {
    duration = duration || 4000;
    let t = document.getElementById('consulenzaToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'consulenzaToast';
        t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2a2a2a;color:#fff;padding:12px 20px;border-radius:10px;font-size:0.88rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.5);pointer-events:none;opacity:0;transition:opacity 0.2s;max-width:90vw;text-align:center;';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, duration);
}

// =============================================
//  CONFIG CHECK
// =============================================
function checkConfig() {
    // Proxy n8n attivo — nessun controllo API key necessario
}

// =============================================
//  CALENDAR - FETCH SLOTS
// =============================================
async function fetchMonthSlots(year, month) {
    const key = `${year}-${month}`;
    if (state.loadedMonths.has(key) || state.loadingMonths.has(key)) return;

    state.loadingMonths.add(key);
    showCalLoading(true);

    const startTime = new Date(year, month, 1, 0, 0, 0).toISOString();
    const endTime = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

    try {
        const url = `${CONFIG.N8N_CAL_SLOTS_URL}` +
            `?eventTypeId=${encodeURIComponent(CONFIG.CAL_EVENT_TYPE_ID)}` +
            `&startTime=${encodeURIComponent(startTime)}` +
            `&endTime=${encodeURIComponent(endTime)}` +
            `&timeZone=${encodeURIComponent(CONFIG.TIMEZONE)}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || `Errore API Cal.com: ${response.status}`);
        }

        const data = await response.json();

        // data.slots = { "2026-03-01": [{time: "ISO", ...}, ...], ... }
        if (data.slots) {
            for (const [date, slotArray] of Object.entries(data.slots)) {
                // Mantieni solo i datetime ISO
                state.availableSlots[date] = slotArray.map(s => s.time).filter(Boolean);
            }
        }

        state.loadedMonths.add(key);
        state.loadingMonths.delete(key);
        showCalLoading(false);
        renderCalendar();

    } catch (error) {
        console.error('Errore fetch slots Cal.com:', error);
        state.loadingMonths.delete(key);
        showCalLoading(false);
        document.getElementById('calLoading').innerHTML =
            `<span style="color:#ff6666;"><i class="fas fa-exclamation-circle"></i> Errore caricamento disponibilità. ${error.message}</span>`;
        document.getElementById('calLoading').classList.remove('hidden');
    }
}

function showCalLoading(show) {
    const el = document.getElementById('calLoading');
    if (show) {
        el.innerHTML = '<span class="loading-spinner"></span> Caricamento disponibilità...';
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

// =============================================
//  CALENDAR - RENDER
// =============================================
function renderCalendar() {
    const { currentYear, currentMonth, availableSlots, selectedDate } = state;

    document.getElementById('monthYearLabel').textContent = `${MESI[currentMonth]} ${currentYear}`;

    // Disabilita "mese precedente" se siamo nel mese corrente o prima
    const today = new Date();
    const prevBtn = document.getElementById('prevMonth');
    const isCurrentOrPast =
        currentYear < today.getFullYear() ||
        (currentYear === today.getFullYear() && currentMonth <= today.getMonth());
    prevBtn.disabled = isCurrentOrPast;
    prevBtn.classList.toggle('disabled', isCurrentOrPast);

    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    // Primo giorno del mese (0=Dom → converti a lunedì=0)
    const firstDayRaw = new Date(currentYear, currentMonth, 1).getDay();
    const firstDayMon = firstDayRaw === 0 ? 6 : firstDayRaw - 1;

    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const todayStr = formatDate(today);

    // Celle vuote prima del mese
    for (let i = 0; i < firstDayMon; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-day empty';
        grid.appendChild(empty);
    }

    // Celle dei giorni
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(currentYear, currentMonth, day);
        const dateStr = formatDate(date);

        const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const isToday = dateStr === todayStr;
        const isSelected = dateStr === selectedDate;
        const hasSlots = availableSlots[dateStr] && availableSlots[dateStr].length > 0;

        const cell = document.createElement('div');
        cell.textContent = day;

        let classes = ['cal-day'];

        if (isSelected) {
            classes.push('selected');
        } else if (isPast) {
            classes.push('past');
        } else if (isToday) {
            classes.push(hasSlots ? 'today available' : 'today unavailable');
        } else if (hasSlots) {
            classes.push('available');
        } else {
            classes.push('unavailable');
        }

        cell.className = classes.join(' ');

        // Aggiungi click solo per giorni con slot disponibili
        if (!isPast && hasSlots) {
            cell.addEventListener('click', () => selectDate(dateStr));
        }

        // Tooltip con numero slot
        if (!isPast && hasSlots) {
            const count = availableSlots[dateStr].length;
            cell.title = `${count} orario${count > 1 ? 'i' : ''} disponibile${count > 1 ? 'i' : ''}`;
        }

        grid.appendChild(cell);
    }
}

function handlePrevMonth() {
    if (state.currentMonth === 0) {
        state.currentMonth = 11;
        state.currentYear--;
    } else {
        state.currentMonth--;
    }
    renderCalendar();
    fetchMonthSlots(state.currentYear, state.currentMonth);
}

function handleNextMonth() {
    if (state.currentMonth === 11) {
        state.currentMonth = 0;
        state.currentYear++;
    } else {
        state.currentMonth++;
    }
    renderCalendar();
    fetchMonthSlots(state.currentYear, state.currentMonth);
}

// =============================================
//  DATE / TIME SELECTION
// =============================================
function selectDate(dateStr) {
    state.selectedDate = dateStr;
    state.selectedTime = null;

    renderCalendar();
    updateSelectedInfo();

    const slots = state.availableSlots[dateStr] || [];
    renderTimeSlots(dateStr, slots);

    const timeSlotsCard = document.getElementById('timeSlotsCard');
    timeSlotsCard.classList.remove('hidden');

    // Su mobile scroll agli orari
    if (window.innerWidth <= 768) {
        setTimeout(() => {
            timeSlotsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
    }
}

function renderTimeSlots(dateStr, slots) {
    const grid = document.getElementById('timeSlotsGrid');
    const title = document.getElementById('timeSlotsTitle');
    grid.innerHTML = '';

    // Titolo con la data selezionata
    const dateObj = new Date(dateStr + 'T12:00:00');
    const dateLabel = dateObj.toLocaleDateString('it-IT', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    });
    title.innerHTML = `<i class="far fa-clock"></i> Orari · <span style="color:#D4AF37;">${dateLabel}</span>`;

    if (slots.length === 0) {
        grid.innerHTML = '<p class="no-slots-msg">Nessun orario disponibile per questa data.</p>';
        return;
    }

    slots.forEach(isoTime => {
        const timeObj = new Date(isoTime);
        const timeLabel = timeObj.toLocaleTimeString('it-IT', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: CONFIG.TIMEZONE
        });

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'time-slot' + (state.selectedTime === isoTime ? ' selected' : '');
        btn.textContent = timeLabel;
        btn.dataset.isoTime = isoTime;

        btn.addEventListener('click', () => selectTime(isoTime, btn));
        grid.appendChild(btn);
    });
}

function selectTime(isoTime, clickedBtn) {
    state.selectedTime = isoTime;

    document.querySelectorAll('.time-slot').forEach(b => b.classList.remove('selected'));
    clickedBtn.classList.add('selected');

    updateSelectedInfo();
    document.getElementById('noDateWarning').classList.add('hidden');

    // Su mobile scroll al form
    if (window.innerWidth <= 768) {
        setTimeout(() => {
            document.getElementById('formCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
    }
}

function updateSelectedInfo() {
    const infoBar = document.getElementById('selectedInfo');
    const infoText = document.getElementById('selectedInfoText');

    if (state.selectedDate && state.selectedTime) {
        const dateObj = new Date(state.selectedDate + 'T12:00:00');
        const timeObj = new Date(state.selectedTime);

        const dateLabel = dateObj.toLocaleDateString('it-IT', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
        const timeLabel = timeObj.toLocaleTimeString('it-IT', {
            hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE
        });

        infoText.textContent = `${dateLabel} alle ${timeLabel}`;
        infoBar.classList.remove('hidden');
    } else {
        infoBar.classList.add('hidden');
    }
}

// =============================================
//  FILE UPLOAD
// =============================================
function initFileUpload() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fotoInput');

    // Click sull'area → apri dialog
    uploadArea.addEventListener('click', (e) => {
        if (e.target.closest('.remove-photo') || e.target.closest('.add-more-btn')) return;
        fileInput.click();
    });

    // Drag & Drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        addFiles(files);
    });

    // Selezione da dialog
    fileInput.addEventListener('change', (e) => {
        addFiles(Array.from(e.target.files));
        // Reset input per permettere la ri-selezione dello stesso file
        fileInput.value = '';
    });
}

function addFiles(newFiles) {
    newFiles.forEach(file => {
        if (state.photos.length >= 4) return;
        if (!file.type.startsWith('image/')) {
            showToast(`"${file.name}" non è un'immagine valida.`);
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            showToast(`"${file.name}" supera il limite di 10 MB.`);
            return;
        }
        state.photos.push(file);
    });

    renderPhotoPreview();
}

function renderPhotoPreview() {
    const preview = document.getElementById('photoPreview');
    const placeholder = document.getElementById('uploadPlaceholder');

    if (state.photos.length === 0) {
        preview.innerHTML = '';
        preview.classList.add('hidden');
        placeholder.style.display = '';
        return;
    }

    placeholder.style.display = 'none';
    preview.classList.remove('hidden');
    preview.innerHTML = '';

    state.photos.forEach((file, idx) => {
        const url = URL.createObjectURL(file);
        const thumb = document.createElement('div');
        thumb.className = 'photo-thumb';
        thumb.innerHTML = `
            <img src="${url}" alt="Foto ${idx + 1}">
            <button type="button" class="remove-photo" data-idx="${idx}" aria-label="Rimuovi foto">
                <i class="fas fa-times"></i>
            </button>
        `;

        thumb.querySelector('.remove-photo').addEventListener('click', (e) => {
            e.stopPropagation();
            const i = parseInt(e.currentTarget.dataset.idx);
            state.photos.splice(i, 1);
            renderPhotoPreview();
        });

        preview.appendChild(thumb);
    });

    // Pulsante "aggiungi altra" se < 4 foto
    if (state.photos.length < 4) {
        const addBtn = document.createElement('div');
        addBtn.className = 'photo-thumb add-more-btn';
        addBtn.innerHTML = '<i class="fas fa-plus"></i><span>Aggiungi</span>';
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('fotoInput').click();
        });
        preview.appendChild(addBtn);
    }
}

// Converte i File in base64 per inviarli a n8n via POST
function filesToBase64(files) {
    return Promise.all(files.map(file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
            nome: file.name,
            tipo: file.type,
            data_base64: reader.result
        });
        reader.onerror = reject;
        reader.readAsDataURL(file);
    })));
}

// =============================================
//  FORM SUBMIT
// =============================================
async function handleSubmit(e) {
    e.preventDefault();

    if (state.isSubmitting) return;

    // Validazione data/orario
    if (!state.selectedDate || !state.selectedTime) {
        const warning = document.getElementById('noDateWarning');
        warning.classList.remove('hidden');
        warning.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    // Validazione foto: facoltative, ma se ne caricate almeno una ne servono almeno 2
    if (state.photos.length === 1) {
        showToast('Se carichi delle foto, ne servono almeno 2 (minimo 2, massimo 4).');
        document.getElementById('uploadArea').scrollIntoView({ behavior: 'smooth' });
        return;
    }

    // Validazione campi obbligatori con messaggi specifici
    const formMsg = document.getElementById('formMsg');
    const nome = document.getElementById('nome').value.trim();
    const cognome = document.getElementById('cognome').value.trim();
    const email = document.getElementById('email').value.trim();
    const telefonoRaw = iti ? iti.getNumber() : document.getElementById('telefono').value.trim();
    const descrizione = document.getElementById('descrizione').value.trim();
    const luogo = document.querySelector('input[name="luogo"]:checked')?.value || '';
    const pagamento = document.querySelector('input[name="pagamento"]:checked')?.value || '';
    const gdpr = document.getElementById('gdpr')?.checked;
    const newsletter = document.querySelector('input[name="newsletter"]:checked')?.value || 'No';

    const missing = [];
    if (!nome)       missing.push('Nome');
    if (!cognome)    missing.push('Cognome');
    if (!email)      missing.push('Email');
    if (!telefonoRaw) missing.push('Numero di cellulare');
    if (!luogo)      missing.push('Dove preferisci la consulenza');
    if (!descrizione) missing.push('Descrizione della tua idea');
    if (!pagamento)  missing.push('Preferenza pagamento');
    if (!gdpr)       missing.push('Consenso privacy (GDPR)');

    if (missing.length > 0) {
        formMsg.textContent = 'Campi obbligatori mancanti: ' + missing.join(', ');
        formMsg.className = 'form-message error';
        formMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    if (iti && !iti.isValidNumber()) {
        formMsg.textContent = 'Inserisci un numero di telefono valido (con prefisso internazionale).';
        formMsg.className = 'form-message error';
        document.getElementById('telefono').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    const telefono = telefonoRaw;

    // Validazione motivazione video WhatsApp
    const motivoVideo = (document.getElementById('motivoVideo')?.value || '').trim();
    if (luogo === 'integrations:whatsapp_video' && !motivoVideo) {
        formMsg.textContent = 'Indica il motivo per cui non puoi venire in studio.';
        formMsg.className = 'form-message error';
        document.getElementById('motivoVideo').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    const submitBtn = document.getElementById('submitBtn');

    // Stato loading
    state.isSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading-spinner small"></span> Prenotazione in corso...';
    formMsg.textContent = '';
    formMsg.className = 'form-message';

    try {
        // ── STEP 1: Crea prenotazione su Cal.com ──────────────────────────
        // Questo triggera automaticamente il webhook Cal.com → n8n
        const bookingResult = await createCalBooking({ nome, cognome, email, telefono, descrizione, pagamento, luogo, motivoVideo });

        // ── STEP 2: Converti foto in base64 ──────────────────────────────
        const fotosBase64 = await filesToBase64(state.photos);

        // ── STEP 3: Invia dati completi + foto a n8n ──────────────────────
        // Salva scelta newsletter in localStorage — la dashboard la leggerà al primo accesso
        localStorage.setItem('pendingNewsletterConsent', (newsletter === 'Si' || newsletter === 'Yes') ? 'true' : 'false');

        let magicLink = null;
        try {
            magicLink = await sendToN8n({ nome, cognome, email, telefono, descrizione, pagamento, luogo, newsletter }, fotosBase64, bookingResult);
        } catch (n8nError) {
            // Non blocca: la prenotazione Cal.com è già confermata
            console.warn('[consulenza.js] sendToN8n fallito:', n8nError.message);
        }

        // ── STEP 4: Mostra schermata di successo ──────────────────────────
        showSuccessState(bookingResult, { nome, cognome, email }, magicLink);

    } catch (error) {
        console.error('Errore prenotazione:', error);

        let msg = 'Si è verificato un errore. Riprova oppure contattami direttamente.';
        if (error.message && error.message !== 'Failed to fetch') {
            msg = `Errore: ${error.message}`;
        }

        formMsg.textContent = msg;
        formMsg.className = 'form-message error';

        state.isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-check"></i> Conferma Prenotazione';
    }
}

// =============================================
//  CAL.COM API - CREA PRENOTAZIONE
// =============================================
async function createCalBooking({ nome, cognome, email, telefono, descrizione, pagamento, luogo, motivoVideo }) {
    const startISO = state.selectedTime;
    const startDate = new Date(startISO);
    const endDate = new Date(startDate.getTime() + CONFIG.CAL_EVENT_DURATION_MINUTES * 60 * 1000);

    const noteParts = [
        `Descrizione idea tattoo: ${descrizione}`,
        `Preferenza pagamento: ${pagamento}`,
        `Telefono: ${telefono}`
    ];
    if (motivoVideo) noteParts.push(`Motivo video: ${motivoVideo}`);
    const notes = noteParts.join('\n');

    const responses = {
        name: `${nome} ${cognome}`,
        email: email,
        location: { value: luogo, optionValue: '' },
        notes: notes,
    };
    // Includi il telefono solo se è un numero E.164 valido (evita errore 400 da Cal.com)
    if (telefono && /^\+\d{7,15}$/.test(telefono)) {
        responses.attendeePhoneNumber = telefono;
    }

    const body = {
        eventTypeId: parseInt(CONFIG.CAL_EVENT_TYPE_ID),
        start: startISO,
        end: endDate.toISOString(),
        responses,
        metadata: {
            source: 'website_consulenza',
            descrizione_idea: descrizione,
            pagamento: pagamento
        },
        timeZone: CONFIG.TIMEZONE,
        language: 'it'
    };

    const response = await fetch(
        CONFIG.N8N_CAL_BOOKINGS_URL,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }
    );

    const result = await response.json().catch(() => null);

    // Controlla prima se la risposta HTTP è un errore (anche se il body non è JSON)
    if (!response.ok) {
        const msg = result?.message || result?.error || `Errore prenotazione Cal.com (${response.status}). Riprova o contattami direttamente.`;
        throw new Error(msg);
    }

    if (result === null) {
        // Risposta HTTP ok ma body non-JSON: raro, ma trattalo come errore per sicurezza
        throw new Error('Risposta non valida dal server di prenotazione. Riprova.');
    }

    // Cal.com v2 restituisce errori anche con HTTP 200 (proxy n8n)
    if (result.status === 'error' || result.error) {
        const msg = result.message || result.error?.message || result.error || 'Errore prenotazione Cal.com.';
        throw new Error(msg);
    }

    // Cal.com v2 wrappa la risposta in { status: "success", data: { uid, id } }
    const booking = result.data || result;
    return { uid: booking.uid || null, id: booking.id || null, status: booking.status || 'ACCEPTED' };
}

// =============================================
//  N8N WEBHOOK - INVIA DATI COMPLETI (POST)
//  I dati testo vengono inviati come query params.
//  Le foto (base64) vengono inviate nel body JSON.
//  n8n le carica su Google Drive, identico al flusso Tally.
// =============================================
async function sendToN8n(formData, fotosBase64, bookingResult) {
    if (!CONFIG.N8N_WEBHOOK_URL || CONFIG.N8N_WEBHOOK_URL === 'YOUR_N8N_WEBHOOK_URL') {
        console.warn('[consulenza.js] N8N_WEBHOOK_URL non configurato, salto invio dati extra.');
        return;
    }

    const dateObj = new Date(state.selectedDate + 'T12:00:00');
    const timeObj = new Date(state.selectedTime);

    const params = new URLSearchParams({
        source: 'website_consulenza',
        timestamp: new Date().toISOString(),
        cal_booking_uid: bookingResult.uid || '',
        cal_booking_id: String(bookingResult.id || ''),
        cal_booking_status: bookingResult.status || 'ACCEPTED',
        nome: formData.nome,
        cognome: formData.cognome,
        email: formData.email,
        telefono: formData.telefono || '',
        data_appuntamento: dateObj.toLocaleDateString('it-IT', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        }),
        ora_appuntamento: timeObj.toLocaleTimeString('it-IT', {
            hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE
        }),
        datetime_iso: state.selectedTime,
        descrizione_idea: formData.descrizione,
        preferenza_pagamento: formData.pagamento,
        luogo: formData.luogo,
        gdpr_consent: 'true',
        newsletter: formData.newsletter
    });

    const response = await fetch(`${CONFIG.N8N_WEBHOOK_URL}?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foto: fotosBase64 })
    });

    // Non blocchiamo se n8n fallisce: la prenotazione Cal.com è già confermata
    if (!response.ok) {
        console.warn(`[consulenza.js] n8n webhook risposta: ${response.status}. Prenotazione Cal.com comunque confermata.`);
        return null;
    }

    try {
        const json = await response.json();
        return json.magic_link || null;
    } catch {
        return null;
    }
}

// =============================================
//  SUCCESS STATE
// =============================================
function showSuccessState(_bookingResult, userData, magicLink) {
    document.getElementById('bookingGrid').classList.add('hidden');

    const success = document.getElementById('successState');
    success.classList.remove('hidden');

    const dateObj = new Date(state.selectedDate + 'T12:00:00');
    const timeObj = new Date(state.selectedTime);

    const dateLabel = dateObj.toLocaleDateString('it-IT', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    const timeLabel = timeObj.toLocaleTimeString('it-IT', {
        hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE
    });

    document.getElementById('bookingDetails').innerHTML = `
        <div class="booking-detail-item">
            <i class="far fa-user"></i>
            <span>${userData.nome} ${userData.cognome}</span>
        </div>
        <div class="booking-detail-item">
            <i class="far fa-envelope"></i>
            <span>${userData.email.replace('@', '<wbr>@')}</span>
        </div>
        <div class="booking-detail-item">
            <i class="far fa-calendar-alt"></i>
            <span>${dateLabel}</span>
        </div>
        <div class="booking-detail-item">
            <i class="far fa-clock"></i>
            <span>${timeLabel}</span>
        </div>
    `;

    // Imposta il link del pulsante "Accedi alla tua Area Personale"
    const btnDashboard = document.getElementById('btnDashboard');
    if (btnDashboard) {
        // magic_link = accesso diretto già autenticato; fallback = login con email pre-compilata
        btnDashboard.href = magicLink || `login.html?email=${encodeURIComponent(userData.email)}`;
    }

    success.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// =============================================
function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
