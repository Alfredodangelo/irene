// =============================================
//  SEDUTA BOOKING PAGE - Irene Gipsy Tattoo
//  Integrazione: Cal.com API + PayPal + n8n
// =============================================
function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// =============================================
//  ⚙️  CONFIGURAZIONE
// =============================================
const CONFIG = {
    CAL_EVENT_TYPE_ID: '4496802',
    CAL_EVENT_DURATION_MINUTES: 90,
    N8N_WEBHOOK_URL: 'https://n8n.srv1204993.hstgr.cloud/webhook/dc4275f9-bee2-427e-96ef-7cbf9c92b5a9',
    N8N_CAL_SLOTS_URL:    'https://n8n.srv1204993.hstgr.cloud/webhook/cal-slots',
    N8N_CAL_BOOKINGS_URL: 'https://n8n.srv1204993.hstgr.cloud/webhook/cal-bookings',
    TIMEZONE: 'Europe/Rome',

    // PayPal — inserisci il Client ID dal tuo account PayPal Developer
    // https://developer.paypal.com → My Apps & Credentials → Create App → Client ID
    // Usa il Client ID LIVE (non sandbox) per ricevere pagamenti reali
    PAYPAL_CLIENT_ID: 'YOUR_PAYPAL_CLIENT_ID',
    DEPOSIT_PER_SESSION: 50, // euro per seduta
};
// =============================================

// ⚠️ WIP: impostare false prima del lancio ufficiale
const WIP_MODE = true;

// true = prima seduta, false = seduta successiva (auto-rilevato da Supabase)
let isFirstSession = true;
// Date (YYYY-MM-DD) di sedute già prenotate — per bloccare doppioni
let existingSedutaDates = [];
// true = prenotazione via QR / sblocco temporaneo (acconto in contanti, no PayPal)
let isTokenBooking = false;
let _bookingToken  = null;

const MESI = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

// intl-tel-input instance
let iti;

// Stato
const state = {
    currentYear: null,
    currentMonth: null,
    availableSlots: {},      // { 'YYYY-MM-DD': ['ISO_TIME', ...] }
    selectedDates: [],       // array di 'YYYY-MM-DD' (ordinato)
    selectedTimes: {},       // { 'YYYY-MM-DD': 'ISO_TIME' }
    focusedDate: null,       // data per cui si mostrano gli slot
    loadingMonths: new Set(),
    loadedMonths: new Set(),
    isSubmitting: false,
    paymentComplete: false,
    paymentOrderId: null,
    paypalRendered: false,
};

// =============================================
//  ACCESS GUARD
// =============================================
async function checkAccess() {
    if (WIP_MODE) return true;
    if (!window.__authUser) {
        window.location.href = 'login.html?redirect=session.html';
        return false;
    }

    // Controlla se è una prenotazione via token (QR / sblocco temporaneo)
    const bt = new URLSearchParams(window.location.search).get('bt');
    if (bt) {
        try {
            const { data: tokenRow } = await db.from('booking_tokens')
                .select('client_id, expires_at, used_at')
                .eq('token', bt)
                .maybeSingle();
            const uid = window.__authUser.id;
            const clientRow = await db.from('clients').select('id').eq('id', uid).maybeSingle();
            const clientId  = clientRow?.data?.id;
            if (
                tokenRow &&
                tokenRow.client_id === clientId &&
                !tokenRow.used_at &&
                new Date(tokenRow.expires_at) >= new Date()
            ) {
                isTokenBooking = true;
                _bookingToken  = bt;
                return true;
            }
        } catch(e) {
            console.warn('[seduta] token validation error:', e);
        }
    }

    try {
        const { data: client } = await db
            .from('clients')
            .select('seduta_booking_enabled')
            .eq('id', window.__authUser.id)
            .single();
        if (!client?.seduta_booking_enabled) {
            document.getElementById('bookingGrid').style.display = 'none';
            document.getElementById('lockedState').style.display = 'block';
            return false;
        }
    } catch(e) {
        console.warn('[seduta] checkAccess error:', e);
    }
    return true;
}

// =============================================
//  INIT
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
    // Back button dinamico
    if (new URLSearchParams(location.search).get('from') === 'dashboard') {
        const bl = document.querySelector('.back-link');
        if (bl) { bl.href = 'dashboard.html'; bl.innerHTML = '<i class="fas fa-arrow-left"></i> Torna alla dashboard'; }
    }

    const allowed = await checkAccess();
    if (!allowed) return;

    const today = new Date();
    state.currentYear = today.getFullYear();
    state.currentMonth = today.getMonth();

    // Telefono con bandiera
    iti = window.intlTelInput(document.getElementById('telefono'), {
        initialCountry: 'it',
        preferredCountries: ['it'],
        utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@18.2.1/build/js/utils.js'
    });

    checkConfig();
    renderCalendar();
    fetchMonthSlots(state.currentYear, state.currentMonth);
    detectFirstSession();
    prefillUserData();

    document.getElementById('prevMonth').addEventListener('click', handlePrevMonth);
    document.getElementById('nextMonth').addEventListener('click', handleNextMonth);

    // Carica PayPal SDK se configurato
    if (CONFIG.PAYPAL_CLIENT_ID !== 'YOUR_PAYPAL_CLIENT_ID') {
        loadPayPalSDK();
    }

    // Aggiorna PayPal button quando cambiano i campi del form
    const formFields = ['nome', 'cognome', 'email', 'telefono', 'gdpr'];
    formFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', checkFormAndUpdatePayPal);
        if (el && el.tagName === 'INPUT') el.addEventListener('input', checkFormAndUpdatePayPal);
    });
});

// =============================================
//  CONFIG CHECK
// =============================================
function checkConfig() {}

// =============================================
//  AUTO-RILEVA PRIMA SEDUTA
// =============================================
async function detectFirstSession() {
    try {
        if (!window.__authUser) return;
        const { data, error } = await db
            .from('appointments')
            .select('id, scheduled_at')
            .eq('client_id', window.__authUser.id)
            .eq('type', 'seduta')
            .neq('status', 'cancelled');
        if (!error && data) {
            isFirstSession = data.length === 0;
            existingSedutaDates = data.map(a => a.scheduled_at.split('T')[0]);
        }
    } catch (e) {
        console.warn('[seduta] detectFirstSession error:', e);
    }
}

// =============================================
//  PRE-RIEMPIMENTO DATI UTENTE LOGGATO
// =============================================
async function prefillUserData() {
    try {
        // Se __authUser non è ancora pronto (race condition con auth async nel <head>), recupera la sessione
        let authUser = window.__authUser;
        if (!authUser) {
            const { data: { session } } = await db.auth.getSession();
            if (!session) return;
            authUser = session.user;
            window.__authUser = authUser;
        }
        const { data, error } = await db
            .from('clients')
            .select('first_name, last_name, phone')
            .eq('id', authUser.id)
            .single();
        if (error || !data) return;

        // Pre-compila i campi (nascosti)
        const nomeEl    = document.getElementById('nome');
        const cognomeEl = document.getElementById('cognome');
        const emailEl   = document.getElementById('email');
        if (nomeEl)    { nomeEl.value    = data.first_name || '';  nomeEl.readOnly = true; }
        if (cognomeEl) { cognomeEl.value = data.last_name  || '';  cognomeEl.readOnly = true; }
        if (emailEl)   { emailEl.value   = authUser.email || '';   emailEl.readOnly = true; }
        if (data.phone) {
            if (iti) iti.setNumber(data.phone);
            else { const t = document.getElementById('telefono'); if (t) t.value = data.phone; }
        }
        // Nascondi sezione dati personali e mostra riepilogo
        const section = document.getElementById('personalDataSection');
        const title   = document.getElementById('personalDataTitle');
        const booking = document.getElementById('bookingAsText');
        if (section) section.style.display = 'none';
        if (title)   title.style.display   = 'none';
        if (booking) {
            const displayName = [data.first_name, data.last_name].filter(Boolean).join(' ') || authUser.email;
            booking.innerHTML = `<i class="fas fa-user-check" style="color:#D4AF37;margin-right:6px;"></i>Stai prenotando come: <strong style="color:#e8e8e8;">${escHtml(displayName)}</strong> (${escHtml(authUser.email)})`;
            booking.style.display = 'block';
        }
        checkFormAndUpdatePayPal();
    } catch (e) {
        console.warn('[seduta] prefillUserData error:', e);
    }
}

// =============================================
//  CALENDAR — FETCH SLOTS
// =============================================
async function fetchMonthSlots(year, month) {
    const key = `${year}-${month}`;
    if (state.loadingMonths.has(key) || state.loadedMonths.has(key)) return;

    state.loadingMonths.add(key);
    document.getElementById('calLoading').classList.remove('hidden');

    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);

    const today = new Date();
    const startTime = startOfMonth < today ? today : startOfMonth;

    const url = `${CONFIG.N8N_CAL_SLOTS_URL}`
        + `?eventTypeId=${CONFIG.CAL_EVENT_TYPE_ID}`
        + `&startTime=${encodeURIComponent(startTime.toISOString())}`
        + `&endTime=${encodeURIComponent(endOfMonth.toISOString())}`
        + `&timeZone=${encodeURIComponent(CONFIG.TIMEZONE)}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.slots) {
            Object.entries(data.slots).forEach(([dateStr, slots]) => {
                state.availableSlots[dateStr] = slots.map(s => s.time);
            });
        }
    } catch (err) {
        console.error('Errore fetch slot:', err);
    } finally {
        state.loadingMonths.delete(key);
        state.loadedMonths.add(key);
        document.getElementById('calLoading').classList.add('hidden');
        renderCalendar();
    }
}

// =============================================
//  CALENDAR — RENDER
// =============================================
function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    document.getElementById('monthYearLabel').textContent =
        `${MESI[state.currentMonth]} ${state.currentYear}`;

    const firstDay = new Date(state.currentYear, state.currentMonth, 1);
    const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Offset lunedì=0
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    for (let i = 0; i < startOffset; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-day empty';
        grid.appendChild(empty);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(state.currentYear, state.currentMonth, d);
        dateObj.setHours(0, 0, 0, 0);
        const dateStr = toDateStr(dateObj);

        const cell = document.createElement('div');
        cell.className = 'cal-day';
        cell.textContent = d;

        const isPast = dateObj < today;
        const isHoliday = typeof isItalianHoliday === 'function' && isItalianHoliday(dateStr);
        const isToday = dateObj.getTime() === today.getTime();
        const hasSlots = !isHoliday && state.availableSlots[dateStr] && state.availableSlots[dateStr].length > 0;
        const isSelected = state.selectedDates.includes(dateStr);
        const isFocused = state.focusedDate === dateStr;

        if (isToday) cell.classList.add('today');

        if (isPast) {
            cell.classList.add('past');
        } else if (isHoliday) {
            cell.classList.add('unavailable', 'holiday');
            cell.title = 'Giorno festivo — studio chiuso';
        } else if (isSelected) {
            cell.classList.add('selected');
            if (isFocused) cell.classList.add('focused');
            cell.addEventListener('click', () => removeDate(dateStr));
        } else if (hasSlots) {
            cell.classList.add('available');
            cell.addEventListener('click', () => selectDate(dateStr));
        } else {
            cell.classList.add('unavailable');
        }

        grid.appendChild(cell);
    }
}

function handlePrevMonth() {
    state.currentMonth--;
    if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
    renderCalendar();
    fetchMonthSlots(state.currentYear, state.currentMonth);
}

function handleNextMonth() {
    state.currentMonth++;
    if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
    renderCalendar();
    fetchMonthSlots(state.currentYear, state.currentMonth);
}

function toDateStr(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// =============================================
//  DATE SELECTION — MULTI-SELECT CON VALIDAZIONE
// =============================================
function selectDate(dateStr) {
    // Blocca se il cliente ha già una seduta in questa data
    if (existingSedutaDates.includes(dateStr)) {
        showDateError('already_booked');
        return;
    }

    // Testa l'aggiunta
    const testDates = [...state.selectedDates, dateStr].sort();
    const validation = validateDateSelection(testDates);

    if (!validation.valid) {
        showDateError(validation.reason);
        return;
    }

    hideDateError();
    state.selectedDates.push(dateStr);
    state.selectedDates.sort();
    state.focusedDate = dateStr;

    renderCalendar();
    renderAppointmentChips();
    updateDepositUI();

    // Mostra time slots per questa data
    const slots = state.availableSlots[dateStr] || [];
    showTimeSlotsCard(dateStr, slots);

    // Auto-seleziona se slot unico
    if (slots.length === 1) {
        selectTime(dateStr, slots[0]);
    }

    // Scroll su mobile
    if (window.innerWidth <= 1024) {
        document.getElementById('timeSlotsCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function removeDate(dateStr) {
    const idx = state.selectedDates.indexOf(dateStr);
    if (idx === -1) return;

    state.selectedDates.splice(idx, 1);
    delete state.selectedTimes[dateStr];

    if (state.focusedDate === dateStr) {
        state.focusedDate = null;
        document.getElementById('timeSlotsCard').classList.add('hidden');
    }

    hideDateError();
    renderCalendar();
    renderAppointmentChips();
    updateDepositUI();
    checkFormAndUpdatePayPal();
}

/**
 * Valida l'array di date (già ordinate).
 * Regole:
 * - 2 date consecutive è OK
 * - 3+ consecutive NON OK
 * - Date non consecutive devono essere distanti ≥ 14 giorni
 */
function validateDateSelection(sortedDates) {
    for (let i = 1; i < sortedDates.length; i++) {
        const prev = new Date(sortedDates[i - 1] + 'T12:00:00');
        const curr = new Date(sortedDates[i] + 'T12:00:00');
        const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return { valid: false, reason: 'duplicate' };
        }

        if (diffDays > 1 && diffDays < 14) {
            return { valid: false, reason: 'too_close' };
        }

        // Controlla 3+ consecutivi
        if (diffDays === 1 && i >= 2) {
            const prevPrev = new Date(sortedDates[i - 2] + 'T12:00:00');
            const prevDiff = Math.round((prev - prevPrev) / (1000 * 60 * 60 * 24));
            if (prevDiff === 1) {
                return { valid: false, reason: 'triple_consecutive' };
            }
        }
    }
    return { valid: true };
}

function showDateError(reason) {
    const messages = {
        duplicate: 'Questa data è già selezionata.',
        too_close: 'Le date devono essere distanti almeno 14 giorni, oppure consecutive (massimo 2 giorni di fila).',
        triple_consecutive: 'Non puoi selezionare più di 2 giorni consecutivi di fila. Dopo 2 giorni consecutivi la prossima data deve essere distante almeno 14 giorni.',
        already_booked: 'Hai già una seduta prenotata in questa data. Non è possibile avere due sedute nello stesso giorno.',
    };
    const el = document.getElementById('dateError');
    document.getElementById('dateErrorText').textContent = messages[reason] || 'Data non valida.';
    el.classList.remove('hidden');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => el.classList.add('hidden'), 6000);
}

function hideDateError() {
    document.getElementById('dateError').classList.add('hidden');
}

// =============================================
//  TIME SLOTS
// =============================================
function showTimeSlotsCard(dateStr, slots) {
    const card = document.getElementById('timeSlotsCard');
    const grid = document.getElementById('timeSlotsGrid');
    const title = document.getElementById('timeSlotsTitle');

    const dateObj = new Date(dateStr + 'T12:00:00');
    const dateLabel = dateObj.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    title.innerHTML = `<i class="far fa-clock"></i> Orari per ${dateLabel}`;

    grid.innerHTML = '';
    card.classList.remove('hidden');

    if (slots.length === 0) {
        grid.innerHTML = '<p class="no-slots-msg">Nessun orario disponibile per questa data.</p>';
        return;
    }

    slots.forEach(isoTime => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'time-slot';

        const timeObj = new Date(isoTime);
        btn.textContent = timeObj.toLocaleTimeString('it-IT', {
            hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE
        });

        if (state.selectedTimes[dateStr] === isoTime) btn.classList.add('selected');

        btn.addEventListener('click', () => selectTime(dateStr, isoTime, btn));
        grid.appendChild(btn);
    });
}

function selectTime(dateStr, isoTime, btn) {
    state.selectedTimes[dateStr] = isoTime;
    state.focusedDate = null;

    // Aggiorna UI slot
    document.querySelectorAll('#timeSlotsGrid .time-slot').forEach(b => b.classList.remove('selected'));
    if (btn) btn.classList.add('selected');

    // Nascondi card dopo breve pausa
    setTimeout(() => {
        document.getElementById('timeSlotsCard').classList.add('hidden');
    }, 400);

    renderAppointmentChips();
    checkFormAndUpdatePayPal();

    if (window.innerWidth <= 1024) {
        document.getElementById('formCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// =============================================
//  APPOINTMENT CHIPS
// =============================================
function renderAppointmentChips() {
    const section = document.getElementById('appointmentsSection');
    const container = document.getElementById('appointmentChips');
    if (state.selectedDates.length === 0) {
        section.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    section.classList.remove('hidden');
    container.innerHTML = '';

    state.selectedDates.forEach((dateStr, idx) => {
        const sessionLabel = getSessionLabel(idx);
        const timeISO = state.selectedTimes[dateStr];
        const dateObj = new Date(dateStr + 'T12:00:00');
        const dateLabel = dateObj.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        const timeLabel = timeISO
            ? new Date(timeISO).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE })
            : '—';

        const chip = document.createElement('div');
        chip.className = `appointment-chip ${timeISO ? '' : 'chip-no-time'}`;
        chip.innerHTML = `
            <div class="chip-info">
                <span class="chip-session">${sessionLabel}</span>
                <span class="chip-date"><i class="far fa-calendar-alt"></i> ${dateLabel}</span>
                <span class="chip-time"><i class="far fa-clock"></i> ${timeLabel}</span>
            </div>
            <button type="button" class="chip-remove" aria-label="Rimuovi data" data-date="${dateStr}">
                <i class="fas fa-times"></i>
            </button>
        `;
        chip.querySelector('.chip-remove').addEventListener('click', () => removeDate(dateStr));
        container.appendChild(chip);
    });
}

function getSessionLabel(index) {
    if (index === 0) return isFirstSession ? 'Prima seduta' : 'Seduta successiva';
    return 'Seduta successiva';
}

// =============================================
//  DEPOSIT UI
// =============================================
function updateDepositUI() {
    const count = state.selectedDates.length;
    const total = count * CONFIG.DEPOSIT_PER_SESSION;
    const section = document.getElementById('depositSection');

    document.getElementById('depositCount').textContent = count;
    document.getElementById('depositTotal').textContent = `€${total}`;

    if (count > 0) {
        section.classList.remove('hidden');
    } else {
        section.classList.add('hidden');
    }
}

// =============================================
//  FORM VALIDATION
// =============================================
// Silent check — returns true/false without showing error messages (used by PayPal button logic)
function isFormComplete() {
    const nome = document.getElementById('nome').value.trim();
    const cognome = document.getElementById('cognome').value.trim();
    const email = document.getElementById('email').value.trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const telefono = iti ? iti.getNumber() : document.getElementById('telefono').value.trim();
    const gdpr = document.getElementById('gdpr').checked;
    const datesOk = state.selectedDates.length > 0 && state.selectedDates.every(d => state.selectedTimes[d]);
    if (!datesOk || !nome || !cognome || !email || !emailValid || !telefono || !gdpr) return false;
    if (iti && !iti.isValidNumber()) return false;
    return true;
}

// Full validation with visible error messages (used on form submit)
function isFormValid() {
    const nome = document.getElementById('nome').value.trim();
    const cognome = document.getElementById('cognome').value.trim();
    const email = document.getElementById('email').value.trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const telefono = iti ? iti.getNumber() : document.getElementById('telefono').value.trim();
    const gdpr = document.getElementById('gdpr').checked;
    const datesOk = state.selectedDates.length > 0 && state.selectedDates.every(d => state.selectedTimes[d]);

    const missing = [];
    if (!datesOk)    missing.push('Seleziona data e orario');
    if (!nome)       missing.push('Nome');
    if (!cognome)    missing.push('Cognome');
    if (!email || !emailValid) missing.push('Email valida');
    if (!telefono)   missing.push('Numero di cellulare');
    if (!gdpr)       missing.push('Consenso privacy (GDPR)');

    if (missing.length > 0) {
        const formMsg = document.getElementById('formMsg');
        formMsg.textContent = 'Campi obbligatori mancanti: ' + missing.join(', ');
        formMsg.className = 'form-message error';
        formMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
    }

    if (iti && !iti.isValidNumber()) {
        const formMsg = document.getElementById('formMsg');
        formMsg.textContent = 'Inserisci un numero di telefono valido (con prefisso internazionale).';
        formMsg.className = 'form-message error';
        document.getElementById('telefono').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
    }

    return true;
}

// =============================================
//  PAYPAL
// =============================================
function loadPayPalSDK() {
    return new Promise((resolve, reject) => {
        if (window.paypal) { resolve(); return; }
        const script = document.createElement('script');
        script.src = `https://www.paypal.com/sdk/js?client-id=${CONFIG.PAYPAL_CLIENT_ID}&currency=EUR`;
        script.onload = resolve;
        script.onerror = () => reject(new Error('PayPal SDK non caricato'));
        document.body.appendChild(script);
    });
}

async function checkFormAndUpdatePayPal() {
    // Aggiorna chip labels se cambia il numero seduta
    if (state.selectedDates.length > 0) {
        renderAppointmentChips();
    }

    const depositSection = document.getElementById('depositSection');
    if (state.selectedDates.length === 0) {
        depositSection.classList.add('hidden');
        return;
    }
    depositSection.classList.remove('hidden');
    updateDepositUI();

    if (state.paymentComplete) return;

    const noDateWarning = document.getElementById('noDateWarning');
    const allTimesSelected = state.selectedDates.every(d => state.selectedTimes[d]);

    if (!allTimesSelected) {
        noDateWarning.classList.remove('hidden');
        document.getElementById('paypalButtonContainer').innerHTML = '';
        state.paypalRendered = false;
        return;
    }
    noDateWarning.classList.add('hidden');

    if (!isFormComplete()) {
        document.getElementById('paypalButtonContainer').innerHTML = '';
        state.paypalRendered = false;
        return;
    }

    // Prenotazione via token (QR/sblocco) → bottone cash, no PayPal
    if (isTokenBooking) {
        document.getElementById('paypalButtonContainer').innerHTML = '';
        document.getElementById('paypalNotConfigured').classList.add('hidden');
        document.getElementById('testSubmitBtn').classList.add('hidden');
        document.getElementById('cashBookingBtn').classList.remove('hidden');
        return;
    }

    document.getElementById('cashBookingBtn').classList.add('hidden');

    // Form valido e date selezionate → mostra PayPal
    if (CONFIG.PAYPAL_CLIENT_ID === 'YOUR_PAYPAL_CLIENT_ID') {
        document.getElementById('paypalNotConfigured').classList.remove('hidden');
        document.getElementById('testSubmitBtn').classList.remove('hidden');
        return;
    }

    document.getElementById('testSubmitBtn').classList.add('hidden');
    await renderPayPalButton();
}

async function renderPayPalButton() {
    if (state.paymentComplete) return;

    try {
        if (!window.paypal) await loadPayPalSDK();
    } catch {
        document.getElementById('paypalNotConfigured').classList.remove('hidden');
        return;
    }

    const container = document.getElementById('paypalButtonContainer');
    container.innerHTML = ''; // Clear previous render
    state.paypalRendered = false;

    const amount = (state.selectedDates.length * CONFIG.DEPOSIT_PER_SESSION).toFixed(2);
    const description = `Acconto ${state.selectedDates.length} seduta/e tatuaggio - Irene Gipsy Tattoo`;

    paypal.Buttons({
        style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay' },
        createOrder: (data, actions) => {
            return actions.order.create({
                purchase_units: [{
                    amount: { value: amount, currency_code: 'EUR' },
                    description: description
                }]
            });
        },
        onApprove: async (data, actions) => {
            const order = await actions.order.capture();
            await handlePaymentSuccess(order);
        },
        onError: (err) => {
            console.error('PayPal error:', err);
            const msg = document.getElementById('formMsg');
            msg.textContent = 'Errore durante il pagamento. Riprova o contattami direttamente.';
            msg.className = 'form-message error';
        }
    }).render('#paypalButtonContainer');

    state.paypalRendered = true;
}

// =============================================
//  PAYMENT SUCCESS → CREA PRENOTAZIONI
// =============================================
async function handlePaymentSuccess(order) {
    state.paymentComplete = true;
    state.paymentOrderId = order.id;

    // Aggiorna UI
    document.getElementById('paypalButtonContainer').innerHTML = '';
    document.getElementById('paymentSuccess').classList.remove('hidden');

    const formMsg = document.getElementById('formMsg');
    formMsg.textContent = 'Pagamento ricevuto. Creazione prenotazioni in corso...';
    formMsg.className = 'form-message';

    // Raccogli dati form
    const nome = document.getElementById('nome').value.trim();
    const cognome = document.getElementById('cognome').value.trim();
    const email = document.getElementById('email').value.trim();
    const telefono = iti ? iti.getNumber() : document.getElementById('telefono').value.trim();
    const formData = { nome, cognome, email, telefono };

    try {
        const bookingResults = await createAllCalBookings(formData);

        // Cal.com OK — salva su Supabase e notifica n8n (errori non bloccanti)
        try {
            await saveSessionsToSupabase(bookingResults, formData);
        } catch (dbErr) {
            console.warn('[seduta.js] Supabase save failed (non-blocking):', dbErr);
        }
        try {
            await sendToN8n(formData, bookingResults, { orderId: order.id, amount: state.selectedDates.length * CONFIG.DEPOSIT_PER_SESSION });
        } catch (n8nErr) {
            console.warn('[seduta.js] n8n notify failed (non-blocking):', n8nErr);
        }

        showSuccessState(bookingResults, formData);
    } catch (error) {
        console.error('[seduta.js] Errore creazione booking Cal.com:', error);
        formMsg.textContent = `Pagamento ricevuto (ordine: ${order.id}), ma errore prenotazione: ${error.message || 'errore sconosciuto'}. Contatta Irene.`;
        formMsg.className = 'form-message error';
    }
}

// =============================================
//  CAL.COM — CREA TUTTE LE PRENOTAZIONI
// =============================================
async function createAllCalBookings(formData) {
    const results = [];
    for (let i = 0; i < state.selectedDates.length; i++) {
        const dateStr = state.selectedDates[i];
        const timeISO = state.selectedTimes[dateStr];
        const sessionLabel = getSessionLabel(i);
        const result = await createCalBooking(formData, timeISO, sessionLabel);
        results.push({ dateStr, timeISO, sessionLabel, uid: result.uid, id: result.id });
    }
    return results;
}

async function createCalBooking(formData, startISO, sessionLabel) {
    const startDate = new Date(startISO);
    const endDate = new Date(startDate.getTime() + CONFIG.CAL_EVENT_DURATION_MINUTES * 60 * 1000);

    const notes = `Acconto PayPal: ${state.paymentOrderId}`;

    const responses = {
        name: `${formData.nome} ${formData.cognome}`,
        email: formData.email,
        numeroseduta: isFirstSession ? 'Prima seduta' : 'Seduta successiva',
        notes: notes
    };
    // Includi il telefono solo se è un numero E.164 valido (evita errore 400 da Cal.com)
    if (formData.telefono && /^\+\d{7,15}$/.test(formData.telefono)) {
        responses.attendeePhoneNumber = formData.telefono;
    }
    const body = {
        eventTypeId: parseInt(CONFIG.CAL_EVENT_TYPE_ID),
        start: startISO,
        end: endDate.toISOString(),
        responses,
        metadata: {
            source: 'website_seduta',
            paypal_order_id: state.paymentOrderId
        },
        timeZone: CONFIG.TIMEZONE,
        language: 'it'
    };

    const bookingCtrl = new AbortController();
    const bookingTimeout = setTimeout(() => bookingCtrl.abort(), 20000);
    const response = await fetch(
        CONFIG.N8N_CAL_BOOKINGS_URL,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: bookingCtrl.signal }
    );
    clearTimeout(bookingTimeout);

    const result = await response.json().catch(() => null);

    if (!response.ok) {
        const msg = result?.message || result?.error?.message || result?.error || `Errore prenotazione Cal.com (${response.status}).`;
        throw new Error(msg);
    }

    if (result === null) {
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
//  N8N WEBHOOK
// =============================================
async function sendToN8n(formData, bookingResults, paymentInfo) {
    if (!CONFIG.N8N_WEBHOOK_URL || CONFIG.N8N_WEBHOOK_URL === 'YOUR_N8N_WEBHOOK_URL') return;

    const datesLabel = state.selectedDates.map((d, i) => {
        const timeISO = state.selectedTimes[d];
        const dateObj = new Date(d + 'T12:00:00');
        const timeObj = new Date(timeISO);
        return `${getSessionLabel(i)}: ${dateObj.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} ore ${timeObj.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE })}`;
    }).join(' | ');

    const params = new URLSearchParams({
        source: 'website_seduta',
        timestamp: new Date().toISOString(),
        nome: formData.nome,
        cognome: formData.cognome,
        email: formData.email,
        telefono: formData.telefono,
        prima_seduta: isFirstSession ? 'Si' : 'No',
        date_sedute: datesLabel,
        numero_sedute: String(state.selectedDates.length),
        paypal_order_id: paymentInfo.orderId,
        acconto_totale: String(paymentInfo.amount),
        cal_booking_ids: bookingResults.map(r => r.id).join(', '),
    });

    try {
        await fetch(`${CONFIG.N8N_WEBHOOK_URL}?${params.toString()}`, { method: 'GET' });
    } catch (err) {
        console.warn('n8n webhook error:', err);
    }
}

// =============================================
//  SUPABASE — SALVA PRENOTAZIONI
// =============================================
async function saveSessionsToSupabase(bookingResults, formData) {
    // Fallback: se __authUser non è pronto, prova a recuperare la sessione
    if (!window.__authUser) {
        try {
            const { data: { session } } = await db.auth.getSession();
            if (session) window.__authUser = session.user;
        } catch (e) {}
    }
    if (!window.__authUser) {
        console.warn('[seduta.js] Nessun utente autenticato — impossibile salvare su Supabase');
        return;
    }
    try {
        // Controllo server-side: nessuna seduta già esistente nella stessa data
        for (const r of bookingResults) {
            const dateOnly = r.timeISO.split('T')[0];
            const { data: dup } = await db.from('appointments')
                .select('id')
                .eq('client_id', window.__authUser.id)
                .eq('type', 'seduta')
                .neq('status', 'cancelled')
                .gte('scheduled_at', dateOnly + 'T00:00:00Z')
                .lt('scheduled_at', dateOnly + 'T23:59:59Z');
            if (dup && dup.length > 0) {
                throw new Error(`Hai già una seduta il ${dateOnly}. Non è possibile prenotarne due nello stesso giorno.`);
            }
        }

        const rows = bookingResults.map(r => ({
            client_id:              window.__authUser.id,
            type:                   'seduta',
            status:                 'confirmed',
            scheduled_at:           r.timeISO,
            cal_booking_uid:        r.uid || null,
            amount:                 CONFIG.DEPOSIT_PER_SESSION,
            amount_paid:            CONFIG.DEPOSIT_PER_SESSION,
            acconto_payment_method: isTokenBooking ? 'contanti' : 'paypal',
            notes:                  r.sessionLabel,
        }));
        const { error } = await db.from('appointments').insert(rows);
        if (error) throw new Error('Supabase insert error: ' + error.message);
    } catch (err) {
        console.warn('[seduta.js] Supabase save failed:', err);
        throw err;
    }
}

// =============================================
//  TEST MODE — submit senza PayPal
// =============================================
function testSubmitWithoutPayment() {
    if (!isFormValid()) return;
    const fakeOrder = { id: 'TEST-' + Date.now() };
    handlePaymentSuccess(fakeOrder);
}

// =============================================
//  TOKEN BOOKING — acconto in contanti
// =============================================
async function handleCashBooking() {
    if (!isFormValid()) return;
    if (state.isSubmitting) return;
    state.isSubmitting = true;

    const btn = document.getElementById('cashBookingBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Prenotazione in corso...';

    const formMsg = document.getElementById('formMsg');
    formMsg.textContent = 'Creazione prenotazione in corso...';
    formMsg.className = 'form-message';

    const nome     = document.getElementById('nome').value.trim();
    const cognome  = document.getElementById('cognome').value.trim();
    const email    = document.getElementById('email').value.trim();
    const telefono = iti ? iti.getNumber() : document.getElementById('telefono').value.trim();
    const formData = { nome, cognome, email, telefono };

    try {
        const bookingResults = await createAllCalBookings(formData);

        // Cal.com OK — salva su Supabase e notifica n8n (errori non bloccanti)
        try {
            await saveSessionsToSupabase(bookingResults, formData);
        } catch (dbErr) {
            console.warn('[seduta.js] Supabase save failed (non-blocking):', dbErr);
        }
        if (_bookingToken) {
            try { await db.from('booking_tokens').delete().eq('token', _bookingToken); } catch (e) {}
        }
        try {
            await sendToN8n(formData, bookingResults, { orderId: null, amount: 0, paymentMethod: 'contanti' });
        } catch (n8nErr) {
            console.warn('[seduta.js] n8n notify failed (non-blocking):', n8nErr);
        }

        document.getElementById('cashBookingBtn').classList.add('hidden');
        document.getElementById('paymentSuccess').classList.remove('hidden');
        document.getElementById('paymentSuccess').innerHTML = '<i class="fas fa-check-circle"></i> Prenotazione confermata — acconto €50 in contanti';
        showSuccessState(bookingResults, formData);
    } catch (error) {
        console.error('[seduta.js] Errore creazione booking Cal.com:', error);
        formMsg.textContent = `Errore prenotazione: ${error.message || 'errore sconosciuto'}. Contatta Irene.`;
        formMsg.className = 'form-message error';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-money-bill-wave"></i> Prenota — acconto €50 in contanti';
        state.isSubmitting = false;
    }
}

// =============================================
//  SUCCESS STATE
// =============================================
function showSuccessState(bookingResults, userData) {
    document.getElementById('bookingGrid').classList.add('hidden');
    const success = document.getElementById('successState');
    success.classList.remove('hidden');

    let detailsHTML = `
        <div class="booking-detail-item"><i class="far fa-user"></i><span>${escHtml(userData.nome)} ${escHtml(userData.cognome)}</span></div>
        <div class="booking-detail-item"><i class="far fa-envelope"></i><span>${escHtml(userData.email).replace('@', '<wbr>@')}</span></div>
    `;

    bookingResults.forEach(r => {
        const dateObj = new Date(r.dateStr + 'T12:00:00');
        const timeObj = new Date(r.timeISO);
        const dateLabel = dateObj.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const timeLabel = timeObj.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE });
        detailsHTML += `
            <div class="booking-detail-item">
                <i class="far fa-calendar-alt"></i>
                <span><strong>${r.sessionLabel}</strong> — ${dateLabel} ore ${timeLabel}</span>
            </div>
        `;
    });

    detailsHTML += `<div class="booking-detail-item"><i class="fab fa-paypal"></i><span>Acconto €${bookingResults.length * CONFIG.DEPOSIT_PER_SESSION} versato</span></div>`;

    document.getElementById('bookingDetails').innerHTML = detailsHTML;

    // Bottone pre-seduta: solo se è la PRIMA seduta
    const firstDate = bookingResults[0].dateStr;

    let actionsHTML = `
        <a href="index.html" class="btn btn-primary">
            <i class="fas fa-home"></i> Torna al Sito
        </a>
    `;

    if (isFirstSession) {
        actionsHTML = `
        <a href="pre-session.html?firstSessionDate=${firstDate}" class="btn btn-secondary">
            <i class="fas fa-calendar-plus"></i> Prenota Pre-Seduta
        </a>
        ` + actionsHTML;
    }

    success.querySelector('.success-actions').innerHTML = actionsHTML;

    success.scrollIntoView({ behavior: 'smooth' });
}
