// =============================================
//  SEDUTA BOOKING PAGE (EN) - Irene Gipsy Tattoo
//  Integration: Cal.com API + PayPal + n8n
// =============================================

// =============================================
//  ⚙️  CONFIG
// =============================================
const CONFIG = {
    CAL_EVENT_TYPE_ID: '4496802',
    CAL_EVENT_DURATION_MINUTES: 90,
    N8N_WEBHOOK_URL: 'https://n8n.srv1204993.hstgr.cloud/webhook/dc4275f9-bee2-427e-96ef-7cbf9c92b5a9',
    N8N_CAL_SLOTS_URL:    'https://n8n.srv1204993.hstgr.cloud/webhook/cal-slots',
    N8N_CAL_BOOKINGS_URL: 'https://n8n.srv1204993.hstgr.cloud/webhook/cal-bookings',
    TIMEZONE: 'Europe/Rome',

    // PayPal — insert Client ID from your PayPal Developer account
    // https://developer.paypal.com → My Apps & Credentials → Create App → Client ID
    // Use the LIVE Client ID (not sandbox) for real payments
    PAYPAL_CLIENT_ID: 'YOUR_PAYPAL_CLIENT_ID',
    DEPOSIT_PER_SESSION: 50, // euros per session
};
// =============================================

const SESSION_OPTIONS = [
    'Prima seduta', 'Seconda seduta', 'Terza seduta',
    'Quarta seduta', 'Quinta seduta', 'Oltre la quinta seduta'
];

const SESSION_LABELS_EN = [
    'First session', 'Second session', 'Third session',
    'Fourth session', 'Fifth session', 'Beyond the fifth session'
];

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

// intl-tel-input instance
let iti;

// State
const state = {
    currentYear: null,
    currentMonth: null,
    availableSlots: {},      // { 'YYYY-MM-DD': ['ISO_TIME', ...] }
    selectedDates: [],       // array of 'YYYY-MM-DD' (sorted)
    selectedTimes: {},       // { 'YYYY-MM-DD': 'ISO_TIME' }
    focusedDate: null,       // date for which time slots are shown
    loadingMonths: new Set(),
    loadedMonths: new Set(),
    isSubmitting: false,
    paymentComplete: false,
    paymentOrderId: null,
    paypalRendered: false,
};

// =============================================
//  INIT
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
    const today = new Date();
    state.currentYear = today.getFullYear();
    state.currentMonth = today.getMonth();

    // Phone with country flag
    iti = window.intlTelInput(document.getElementById('telefono'), {
        initialCountry: 'it',
        preferredCountries: ['it'],
        utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@18.2.1/build/js/utils.js'
    });

    checkConfig();
    renderCalendar();
    fetchMonthSlots(state.currentYear, state.currentMonth);
    prefillUserData();

    document.getElementById('prevMonth').addEventListener('click', handlePrevMonth);
    document.getElementById('nextMonth').addEventListener('click', handleNextMonth);

    // Load PayPal SDK if configured
    if (CONFIG.PAYPAL_CLIENT_ID !== 'YOUR_PAYPAL_CLIENT_ID') {
        loadPayPalSDK();
    }

    // Update PayPal button when form fields change
    const formFields = ['nome', 'cognome', 'email', 'telefono', 'numeroSeduta', 'gdpr'];
    formFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', checkFormAndUpdatePayPal);
        if (el && el.tagName === 'INPUT') el.addEventListener('input', checkFormAndUpdatePayPal);
    });
    ['accompagnatore'].forEach(name => {
        document.querySelectorAll(`input[name="${name}"]`).forEach(el => {
            el.addEventListener('change', checkFormAndUpdatePayPal);
        });
    });
});

// =============================================
//  CONFIG CHECK
// =============================================
function checkConfig() {}

// =============================================
//  PRE-FILL USER DATA (logged-in)
// =============================================
async function prefillUserData() {
    try {
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
        const section = document.getElementById('personalDataSection');
        const title   = document.getElementById('personalDataTitle');
        const booking = document.getElementById('bookingAsText');
        if (section) section.style.display = 'none';
        if (title)   title.style.display   = 'none';
        if (booking) {
            const dn = [data.first_name, data.last_name].filter(Boolean).join(' ') || authUser.email;
            booking.innerHTML = `<i class="fas fa-user-check" style="color:#D4AF37;margin-right:6px;"></i>Booking as: <strong style="color:#e8e8e8;">${dn}</strong> (${authUser.email})`;
            booking.style.display = 'block';
        }
        checkFormAndUpdatePayPal();
    } catch (e) {
        console.warn('[seduta-en] prefillUserData error:', e);
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
        console.error('Error fetching slots:', err);
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
        `${MONTHS[state.currentMonth]} ${state.currentYear}`;

    const firstDay = new Date(state.currentYear, state.currentMonth, 1);
    const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Monday offset
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
        const isToday = dateObj.getTime() === today.getTime();
        const hasSlots = state.availableSlots[dateStr] && state.availableSlots[dateStr].length > 0;
        const isSelected = state.selectedDates.includes(dateStr);
        const isFocused = state.focusedDate === dateStr;

        if (isToday) cell.classList.add('today');

        if (isPast) {
            cell.classList.add('past');
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
//  DATE SELECTION — MULTI-SELECT WITH VALIDATION
// =============================================
function selectDate(dateStr) {
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

    const slots = state.availableSlots[dateStr] || [];
    showTimeSlotsCard(dateStr, slots);

    if (slots.length === 1) {
        selectTime(dateStr, slots[0]);
    }

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
 * Validates the date array (already sorted).
 * Rules:
 * - 2 consecutive dates is OK
 * - 3+ consecutive NOT OK
 * - Non-consecutive dates must be at least 14 days apart
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
        duplicate: 'This date is already selected.',
        too_close: 'Dates must be at least 14 days apart, or consecutive (maximum 2 days in a row).',
        triple_consecutive: 'You cannot select more than 2 consecutive days in a row. After 2 consecutive days, the next date must be at least 14 days later.',
    };
    const el = document.getElementById('dateError');
    document.getElementById('dateErrorText').textContent = messages[reason] || 'Invalid date.';
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
    const dateLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    title.innerHTML = `<i class="far fa-clock"></i> Times for ${dateLabel}`;

    grid.innerHTML = '';
    card.classList.remove('hidden');

    if (slots.length === 0) {
        grid.innerHTML = '<p class="no-slots-msg">No times available for this date.</p>';
        return;
    }

    slots.forEach(isoTime => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'time-slot';

        const timeObj = new Date(isoTime);
        btn.textContent = timeObj.toLocaleTimeString('en-GB', {
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

    document.querySelectorAll('#timeSlotsGrid .time-slot').forEach(b => b.classList.remove('selected'));
    if (btn) btn.classList.add('selected');

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
    const startingOption = document.getElementById('numeroSeduta').value;

    if (state.selectedDates.length === 0) {
        section.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    section.classList.remove('hidden');
    container.innerHTML = '';

    state.selectedDates.forEach((dateStr, idx) => {
        const sessionLabel = getSessionLabel(startingOption, idx);
        const timeISO = state.selectedTimes[dateStr];
        const dateObj = new Date(dateStr + 'T12:00:00');
        const dateLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        const timeLabel = timeISO
            ? new Date(timeISO).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE })
            : '—';

        const chip = document.createElement('div');
        chip.className = `appointment-chip ${timeISO ? '' : 'chip-no-time'}`;
        chip.innerHTML = `
            <div class="chip-info">
                <span class="chip-session">${sessionLabel}</span>
                <span class="chip-date"><i class="far fa-calendar-alt"></i> ${dateLabel}</span>
                <span class="chip-time"><i class="far fa-clock"></i> ${timeLabel}</span>
            </div>
            <button type="button" class="chip-remove" aria-label="Remove date" data-date="${dateStr}">
                <i class="fas fa-times"></i>
            </button>
        `;
        chip.querySelector('.chip-remove').addEventListener('click', () => removeDate(dateStr));
        container.appendChild(chip);
    });
}

function getSessionLabel(startingOption, index) {
    if (!startingOption) return `Session ${index + 1}`;
    const startIdx = SESSION_OPTIONS.indexOf(startingOption);
    if (startIdx === -1) return startingOption;
    const targetIdx = Math.min(startIdx + index, SESSION_OPTIONS.length - 1);
    return SESSION_LABELS_EN[targetIdx];
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
function isFormValid() {
    const nome = document.getElementById('nome').value.trim();
    const cognome = document.getElementById('cognome').value.trim();
    const email = document.getElementById('email').value.trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const telefono = iti ? iti.getNumber() : document.getElementById('telefono').value.trim();
    const numeroSeduta = document.getElementById('numeroSeduta').value;
    const accompagnatore = document.querySelector('input[name="accompagnatore"]:checked');
    const gdpr = document.getElementById('gdpr').checked;
    const datesOk = state.selectedDates.length > 0 && state.selectedDates.every(d => state.selectedTimes[d]);

    return !!(nome && cognome && email && emailValid && telefono && numeroSeduta &&
              accompagnatore && gdpr && datesOk);
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
        script.onerror = () => reject(new Error('PayPal SDK failed to load'));
        document.body.appendChild(script);
    });
}

async function checkFormAndUpdatePayPal() {
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

    if (!isFormValid()) {
        document.getElementById('paypalButtonContainer').innerHTML = '';
        state.paypalRendered = false;
        return;
    }

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
    container.innerHTML = '';
    state.paypalRendered = false;

    const amount = (state.selectedDates.length * CONFIG.DEPOSIT_PER_SESSION).toFixed(2);
    const description = `Deposit ${state.selectedDates.length} tattoo session(s) - Irene Gipsy Tattoo`;

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
            msg.textContent = 'Payment error. Please try again or contact Irene directly.';
            msg.className = 'form-message error';
        }
    }).render('#paypalButtonContainer');

    state.paypalRendered = true;
}

// =============================================
//  PAYMENT SUCCESS → CREATE BOOKINGS
// =============================================
async function handlePaymentSuccess(order) {
    state.paymentComplete = true;
    state.paymentOrderId = order.id;

    document.getElementById('paypalButtonContainer').innerHTML = '';
    document.getElementById('paymentSuccess').classList.remove('hidden');

    const formMsg = document.getElementById('formMsg');
    formMsg.textContent = 'Payment received. Creating bookings...';
    formMsg.className = 'form-message';

    const nome = document.getElementById('nome').value.trim();
    const cognome = document.getElementById('cognome').value.trim();
    const email = document.getElementById('email').value.trim();
    const telefono = iti ? iti.getNumber() : document.getElementById('telefono').value.trim();
    const numeroSeduta = document.getElementById('numeroSeduta').value;
    const accompagnatore = document.querySelector('input[name="accompagnatore"]:checked').value;

    const formData = { nome, cognome, email, telefono, numeroSeduta, accompagnatore };

    try {
        const bookingResults = await createAllCalBookings(formData);
        await sendToN8n(formData, bookingResults, { orderId: order.id, amount: state.selectedDates.length * CONFIG.DEPOSIT_PER_SESSION });
        showSuccessState(bookingResults, formData);
    } catch (error) {
        console.error('Booking error after payment:', error);
        formMsg.textContent = `Payment received (order: ${order.id}), but an error occurred creating the booking. Contact Irene with this order number.`;
        formMsg.className = 'form-message error';
    }
}

// =============================================
//  CAL.COM — CREATE ALL BOOKINGS
// =============================================
async function createAllCalBookings(formData) {
    const results = [];
    for (let i = 0; i < state.selectedDates.length; i++) {
        const dateStr = state.selectedDates[i];
        const timeISO = state.selectedTimes[dateStr];
        const sessionLabel = getSessionLabel(formData.numeroSeduta, i);
        const result = await createCalBooking(formData, timeISO, sessionLabel);
        results.push({ dateStr, timeISO, sessionLabel, uid: result.uid, id: result.id });
    }
    return results;
}

async function createCalBooking(formData, startISO, sessionLabel) {
    const startDate = new Date(startISO);
    const endDate = new Date(startDate.getTime() + CONFIG.CAL_EVENT_DURATION_MINUTES * 60 * 1000);

    // sessionLabel is already in English; map back to Italian for Cal.com
    const sessionLabelIT = SESSION_OPTIONS[SESSION_LABELS_EN.indexOf(sessionLabel)] || sessionLabel;

    const notes = [
        `Companion: ${formData.accompagnatore}`,
        `PayPal deposit: ${state.paymentOrderId}`,
    ].join('\n');

    const responses = {
        name: `${formData.nome} ${formData.cognome}`,
        email: formData.email,
        numeroseduta: sessionLabelIT,
        accompagnatore: [formData.accompagnatore],
        notes: notes
    };
    if (formData.telefono && /^\+\d{7,15}$/.test(formData.telefono)) {
        responses.attendeePhoneNumber = formData.telefono;
    }
    const body = {
        eventTypeId: parseInt(CONFIG.CAL_EVENT_TYPE_ID),
        start: startISO,
        end: endDate.toISOString(),
        responses,
        metadata: {
            source: 'website_seduta_en',
            paypal_order_id: state.paymentOrderId
        },
        timeZone: CONFIG.TIMEZONE,
        language: 'en'
    };

    const response = await fetch(
        CONFIG.N8N_CAL_BOOKINGS_URL,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );

    const result = await response.json().catch(() => null);

    if (!response.ok) {
        const msg = result?.message || result?.error?.message || result?.error || `Cal.com booking error (${response.status}).`;
        throw new Error(msg);
    }

    if (result === null) {
        throw new Error('Invalid response from booking server. Please retry.');
    }

    // Cal.com v2 returns errors even with HTTP 200 (n8n proxy)
    if (result.status === 'error' || result.error) {
        const msg = result.message || result.error?.message || result.error || 'Cal.com booking error.';
        throw new Error(msg);
    }

    // Cal.com v2 wraps response in { status: "success", data: { uid, id } }
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
        return `${getSessionLabel(formData.numeroSeduta, i)}: ${dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} at ${timeObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE })}`;
    }).join(' | ');

    const params = new URLSearchParams({
        source: 'website_seduta_en',
        timestamp: new Date().toISOString(),
        nome: formData.nome,
        cognome: formData.cognome,
        email: formData.email,
        telefono: formData.telefono,
        numero_seduta_partenza: formData.numeroSeduta,
        accompagnatore: formData.accompagnatore,
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
//  TEST MODE — submit without PayPal
// =============================================
function testSubmitWithoutPayment() {
    if (!isFormValid()) return;
    const fakeOrder = { id: 'TEST-' + Date.now() };
    handlePaymentSuccess(fakeOrder);
}

// =============================================
//  SUCCESS STATE
// =============================================
function showSuccessState(bookingResults, userData) {
    document.getElementById('bookingGrid').classList.add('hidden');
    const success = document.getElementById('successState');
    success.classList.remove('hidden');

    let detailsHTML = `
        <div class="booking-detail-item"><i class="far fa-user"></i><span>${userData.nome} ${userData.cognome}</span></div>
        <div class="booking-detail-item"><i class="far fa-envelope"></i><span>${userData.email.replace('@', '<wbr>@')}</span></div>
    `;

    bookingResults.forEach(r => {
        const dateObj = new Date(r.dateStr + 'T12:00:00');
        const timeObj = new Date(r.timeISO);
        const dateLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const timeLabel = timeObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE });
        detailsHTML += `
            <div class="booking-detail-item">
                <i class="far fa-calendar-alt"></i>
                <span><strong>${r.sessionLabel}</strong> — ${dateLabel} at ${timeLabel}</span>
            </div>
        `;
    });

    detailsHTML += `<div class="booking-detail-item"><i class="fab fa-paypal"></i><span>Deposit €${bookingResults.length * CONFIG.DEPOSIT_PER_SESSION} paid</span></div>`;

    document.getElementById('bookingDetails').innerHTML = detailsHTML;

    // Pre-session button: only if this is the FIRST session
    const firstDate = bookingResults[0].dateStr;
    const isFirstSession = document.getElementById('numeroSeduta').value === 'Prima seduta';

    let actionsHTML = `
        <a href="index.html" class="btn btn-primary">
            <i class="fas fa-home"></i> Back to Site
        </a>
    `;

    if (isFirstSession) {
        actionsHTML = `
        <a href="pre-session.html?firstSessionDate=${firstDate}" class="btn btn-secondary">
            <i class="fas fa-calendar-plus"></i> Book Pre-Session
        </a>
        ` + actionsHTML;
    }

    success.querySelector('.success-actions').innerHTML = actionsHTML;

    success.scrollIntoView({ behavior: 'smooth' });
}
