// =============================================
//  PRESEDUTA BOOKING PAGE (EN) - Irene Gipsy Tattoo
//  Integration: Cal.com API + n8n
// =============================================

// =============================================
//  HELPER
// =============================================
function showToast(msg, duration) {
    duration = duration || 4000;
    let t = document.getElementById('presedutaToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'presedutaToast';
        t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2a2a2a;color:#fff;padding:12px 20px;border-radius:10px;font-size:0.88rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.5);pointer-events:none;opacity:0;transition:opacity 0.2s;max-width:90vw;text-align:center;';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, duration);
}

// =============================================
//  ⚙️  CONFIG
// =============================================
const CONFIG = {
    CAL_EVENT_TYPE_ID: '4496803',
    CAL_EVENT_DURATION_MINUTES: 60,
    N8N_WEBHOOK_URL: 'https://n8n.srv1204993.hstgr.cloud/webhook/610beb79-7884-40da-bd29-daf2dbb53ffc',
    N8N_CAL_SLOTS_URL:    'https://n8n.srv1204993.hstgr.cloud/webhook/cal-slots',
    N8N_CAL_BOOKINGS_URL: 'https://n8n.srv1204993.hstgr.cloud/webhook/cal-bookings',
    TIMEZONE: 'Europe/Rome',
    MIN_DAYS_BEFORE_SESSION: 20,
};
// =============================================

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

let iti;
let firstSessionDateStr = null;
let maxBookingDateStr = null;

const state = {
    currentYear: null,
    currentMonth: null,
    availableSlots: {},
    selectedDate: null,
    selectedTime: null,
    loadingMonths: new Set(),
    loadedMonths: new Set(),
    isSubmitting: false,
};

// =============================================
//  INIT
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
    const today = new Date();
    state.currentYear = today.getFullYear();
    state.currentMonth = today.getMonth();

    iti = window.intlTelInput(document.getElementById('telefono'), {
        initialCountry: 'it',
        preferredCountries: ['it'],
        utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@18.2.1/build/js/utils.js'
    });

    // Toggle WhatsApp reason field
    document.querySelectorAll('input[name="luogo"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const box = document.getElementById('whatsappMotivo');
            if (box) box.style.display = radio.value === 'integrations:whatsapp_video' && radio.checked ? 'block' : 'none';
        });
    });

    const params = new URLSearchParams(window.location.search);
    const fsParam = params.get('firstSessionDate');

    if (fsParam) {
        initFirstSessionDate(fsParam);
        renderFirstSessionBanner(fsParam);
    } else {
        // Auto-detect first session + profile from Supabase if logged in
        let autoDetected = false;
        try {
            const { data: sessionData } = await db.auth.getSession();
            const user = sessionData?.session?.user || window.__authUser;
            const userId = user?.id;
            if (userId) {
                const [sedutaRes, profileRes] = await Promise.all([
                    db.from('appointments').select('scheduled_at').eq('client_id', userId).eq('type', 'seduta').in('status', ['confirmed', 'pending']).order('scheduled_at', { ascending: true }).limit(1).maybeSingle(),
                    db.from('clients').select('first_name, last_name, phone').eq('id', userId).single()
                ]);

                if (sedutaRes.data?.scheduled_at) {
                    const dateStr = sedutaRes.data.scheduled_at.substring(0, 10);
                    initFirstSessionDate(dateStr);
                    renderFirstSessionBanner(dateStr);
                    autoDetected = true;
                }

                // Pre-fill and hide personal data fields
                const profile = profileRes.data;
                const firstName = profile?.first_name || '';
                const lastName  = profile?.last_name  || '';
                const email     = user?.email         || '';
                const phone     = profile?.phone      || '';
                if (firstName || email) {
                    const _nEl = document.getElementById('nome');
                    const _cEl = document.getElementById('cognome');
                    const _eEl = document.getElementById('email');
                    _nEl.value = firstName; _nEl.readOnly = true;
                    _cEl.value = lastName;  _cEl.readOnly = true;
                    _eEl.value = email;     _eEl.readOnly = true;
                    if (phone) iti.setNumber(phone);
                    document.getElementById('personalDataSection').style.display = 'none';
                    document.getElementById('personalDataTitle').style.display   = 'none';
                    const displayName = [firstName, lastName].filter(Boolean).join(' ') || email;
                    document.getElementById('bookingAsText').textContent = `Booking as: ${displayName} (${email})`;
                    document.getElementById('bookingAsInfo').style.display = 'flex';
                }
            }
        } catch (e) {
            console.warn('[preseduta-en] auto-detect:', e);
        }
        if (!autoDetected) {
            renderFirstSessionInput();
        }
    }

    checkConfig();
    renderCalendar();
    fetchMonthSlots(state.currentYear, state.currentMonth);

    document.getElementById('prevMonth').addEventListener('click', handlePrevMonth);
    document.getElementById('nextMonth').addEventListener('click', handleNextMonth);
    document.getElementById('changeDateTime').addEventListener('click', deselectDate);
    document.getElementById('presedutaForm').addEventListener('submit', handleSubmit);
});

// =============================================
//  FIRST SESSION DATE LOGIC
// =============================================
function initFirstSessionDate(dateStr) {
    firstSessionDateStr = dateStr;
    const d = new Date(dateStr + 'T12:00:00');
    const max = new Date(d.getTime() - CONFIG.MIN_DAYS_BEFORE_SESSION * 24 * 60 * 60 * 1000);
    maxBookingDateStr = toDateStr(max);
}

function renderFirstSessionBanner(dateStr) {
    const section = document.getElementById('firstSessionSection');
    const dateObj = new Date(dateStr + 'T12:00:00');
    const dateLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const maxObj = new Date(dateObj.getTime() - CONFIG.MIN_DAYS_BEFORE_SESSION * 24 * 60 * 60 * 1000);
    const maxLabel = maxObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    section.innerHTML = `
        <div class="first-session-banner">
            <i class="fas fa-calendar-check"></i>
            <div>
                <strong>First session: ${dateLabel}</strong>
                <p>The pre-session must be booked at least ${CONFIG.MIN_DAYS_BEFORE_SESSION} days before — by <strong>${maxLabel}</strong>.</p>
            </div>
        </div>
    `;
}

function renderFirstSessionInput() {
    const section = document.getElementById('firstSessionSection');
    const minSession = new Date();
    minSession.setDate(minSession.getDate() + CONFIG.MIN_DAYS_BEFORE_SESSION + 1);
    const minSessionStr = toDateStr(minSession);

    section.innerHTML = `
        <h3 class="booking-card-title">
            <i class="far fa-calendar-alt"></i> First Session Date
        </h3>
        <p style="font-size:0.9rem; color:#aaa; margin-bottom:14px;">
            Enter your first session date to see available dates for the pre-session (at least ${CONFIG.MIN_DAYS_BEFORE_SESSION} days before).
        </p>
        <div class="form-group">
            <label for="firstSessionInput">First session date *</label>
            <input type="date" id="firstSessionInput" class="first-session-date-input" min="${minSessionStr}">
        </div>
    `;

    document.getElementById('firstSessionInput').addEventListener('change', function () {
        if (this.value) {
            initFirstSessionDate(this.value);
            renderFirstSessionBanner(this.value);
            renderCalendar();
        }
    });
}

// =============================================
//  CONFIG CHECK
// =============================================
function checkConfig() {}

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
        const isAfterDeadline = maxBookingDateStr !== null && dateStr > maxBookingDateStr;
        const isLocked = maxBookingDateStr === null;
        const hasSlots = !isHoliday && state.availableSlots[dateStr] && state.availableSlots[dateStr].length > 0;
        const isSelected = state.selectedDate === dateStr;

        if (isToday) cell.classList.add('today');

        if (isPast) {
            cell.classList.add('past');
        } else if (isHoliday) {
            cell.classList.add('unavailable', 'holiday');
            cell.title = 'Public holiday — studio closed';
        } else if (isLocked || isAfterDeadline) {
            cell.classList.add('unavailable');
        } else if (isSelected) {
            cell.classList.add('selected');
            cell.addEventListener('click', deselectDate);
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
//  DATE SELECTION
// =============================================
function selectDate(dateStr) {
    state.selectedDate = dateStr;
    state.selectedTime = null;

    renderCalendar();

    const slots = state.availableSlots[dateStr] || [];
    showTimeSlotsCard(dateStr, slots);

    if (slots.length === 1) {
        selectTime(slots[0]);
    }

    if (window.innerWidth <= 1024) {
        document.getElementById('timeSlotsCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function deselectDate() {
    state.selectedDate = null;
    state.selectedTime = null;
    document.getElementById('timeSlotsCard').classList.add('hidden');
    document.getElementById('selectedInfo').classList.add('hidden');
    renderCalendar();
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

        if (state.selectedTime === isoTime) btn.classList.add('selected');
        btn.addEventListener('click', () => selectTime(isoTime, btn));
        grid.appendChild(btn);
    });
}

function selectTime(isoTime, btn) {
    state.selectedTime = isoTime;

    document.querySelectorAll('#timeSlotsGrid .time-slot').forEach(b => b.classList.remove('selected'));
    if (btn) btn.classList.add('selected');

    setTimeout(() => {
        document.getElementById('timeSlotsCard').classList.add('hidden');
    }, 400);

    const dateObj = new Date(state.selectedDate + 'T12:00:00');
    const timeObj = new Date(isoTime);
    const dateLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeLabel = timeObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE });
    const infoEl = document.getElementById('selectedInfo');
    document.getElementById('selectedInfoText').textContent = `${dateLabel} at ${timeLabel}`;
    infoEl.classList.remove('hidden');

    document.getElementById('noDateWarning').classList.add('hidden');

    if (window.innerWidth <= 1024) {
        document.getElementById('formCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    const luogo = document.querySelector('input[name="luogo"]:checked');
    const gdpr = document.getElementById('gdpr').checked;
    const dateTimeOk = state.selectedDate && state.selectedTime;
    const telefonoOk = window.__authUser ? true : !!telefono;

    const missing = [];
    if (!dateTimeOk)  missing.push('Select date and time');
    if (!nome)        missing.push('Name');
    if (!cognome)     missing.push('Surname');
    if (!email || !emailValid) missing.push('Valid email');
    if (!telefonoOk)  missing.push('Phone number');
    if (!luogo)       missing.push('Pre-session location preference');
    if (!gdpr)        missing.push('Privacy consent (GDPR)');

    if (missing.length > 0) {
        const formMsg = document.getElementById('formMsg');
        formMsg.textContent = 'Required fields missing: ' + missing.join(', ');
        formMsg.className = 'form-message error';
        formMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
    }

    if (iti && !iti.isValidNumber()) {
        const formMsg = document.getElementById('formMsg');
        formMsg.textContent = 'Please enter a valid phone number (with international prefix).';
        formMsg.className = 'form-message error';
        document.getElementById('telefono').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
    }

    return true;
}

// =============================================
//  FORM SUBMIT
// =============================================
async function handleSubmit(e) {
    e.preventDefault();
    if (state.isSubmitting) return;

    if (!state.selectedDate || !state.selectedTime) {
        document.getElementById('noDateWarning').classList.remove('hidden');
        document.getElementById('noDateWarning').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
    }

    if (!isFormValid()) {
        const formMsg = document.getElementById('formMsg');
        formMsg.textContent = 'Please fill in all required fields before proceeding.';
        formMsg.className = 'form-message error';
        return;
    }

    // Check: only one active pre-session per client
    if (window.__authUser) {
        const { data: existingPreseduta } = await db.from('appointments')
            .select('id')
            .eq('client_id', window.__authUser.id)
            .eq('type', 'pre-seduta')
            .in('status', ['pending', 'confirmed'])
            .maybeSingle();
        if (existingPreseduta) {
            const formMsg = document.getElementById('formMsg');
            formMsg.textContent = 'You already have a pre-session booked. You can only have one active at a time.';
            formMsg.className = 'form-message error';
            formMsg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
        }
    }

    state.isSubmitting = true;
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading-spinner"></span> Booking in progress...';

    const nome = document.getElementById('nome').value.trim();
    const cognome = document.getElementById('cognome').value.trim();
    const email = document.getElementById('email').value.trim();
    const telefono = iti ? iti.getNumber() : document.getElementById('telefono').value.trim();
    const luogo = document.querySelector('input[name="luogo"]:checked').value;
    const note = document.getElementById('note').value.trim();

    // Validate WhatsApp reason
    const motivoVideo = (document.getElementById('motivoVideo')?.value || '').trim();
    if (luogo === 'integrations:whatsapp_video' && !motivoVideo) {
        showToast('Please explain why you cannot come to the studio.');
        document.getElementById('motivoVideo').scrollIntoView({ behavior: 'smooth', block: 'center' });
        state.isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-check"></i> Confirm Pre-Session';
        return;
    }

    const formData = { nome, cognome, email, telefono, luogo, note, motivoVideo };

    try {
        const bookingResult = await createCalBooking(formData);
        await savePresedutaToSupabase(bookingResult, formData);
        await sendToN8n(formData, bookingResult);
        showSuccessState(bookingResult, formData);
    } catch (error) {
        console.error('Booking error:', error);
        const formMsg = document.getElementById('formMsg');
        formMsg.textContent = 'An error occurred. Please try again or contact Irene directly.';
        formMsg.className = 'form-message error';
        state.isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-check"></i> Confirm Pre-Session';
    }
}

// =============================================
//  CAL.COM — CREATE BOOKING
// =============================================
async function createCalBooking(formData) {
    const startISO = state.selectedTime;
    const startDate = new Date(startISO);
    const endDate = new Date(startDate.getTime() + CONFIG.CAL_EVENT_DURATION_MINUTES * 60 * 1000);

    const notes = [
        formData.note || '',
        firstSessionDateStr ? `First session: ${firstSessionDateStr}` : '',
        formData.motivoVideo ? `Video reason: ${formData.motivoVideo}` : '',
    ].filter(Boolean).join('\n');

    const responses = {
        name: `${formData.nome} ${formData.cognome}`,
        email: formData.email,
        location: { value: formData.luogo, optionValue: '' },
        notes: notes,
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
            source: 'website_preseduta_en',
            first_session_date: firstSessionDateStr || '',
        },
        timeZone: CONFIG.TIMEZONE,
        language: 'en'
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
async function sendToN8n(formData, bookingResult) {
    if (!CONFIG.N8N_WEBHOOK_URL || CONFIG.N8N_WEBHOOK_URL === 'YOUR_N8N_WEBHOOK_URL') return;

    const dateObj = new Date(state.selectedDate + 'T12:00:00');
    const timeObj = new Date(state.selectedTime);
    const dateLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeLabel = timeObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE });

    const params = new URLSearchParams({
        source: 'website_preseduta_en',
        timestamp: new Date().toISOString(),
        nome: formData.nome,
        cognome: formData.cognome,
        email: formData.email,
        telefono: formData.telefono,
        luogo: formData.luogo,
        note: formData.note || '',
        data_preseduta: `${dateLabel} at ${timeLabel}`,
        data_prima_seduta: firstSessionDateStr || '',
        cal_booking_id: String(bookingResult.id || ''),
    });

    try {
        await fetch(`${CONFIG.N8N_WEBHOOK_URL}?${params.toString()}`, { method: 'GET' });
    } catch (err) {
        console.warn('n8n webhook error:', err);
    }
}

// =============================================
//  SUPABASE — SAVE BOOKING
// =============================================
async function savePresedutaToSupabase(bookingResult, formData) {
    if (!window.__authUser) return;
    try {
        const { error } = await db.from('appointments').insert({
            client_id:         window.__authUser.id,
            type:              'pre-seduta',
            status:            'confirmed',
            scheduled_at:      state.selectedTime,
            cal_booking_uid:   bookingResult.uid || null,
            consultation_mode: formData.luogo,
            notes:             formData.note || null,
        });
        if (error) console.warn('[preseduta-en.js] Supabase insert error:', error.message);
    } catch (err) {
        console.warn('[preseduta-en.js] Supabase save failed:', err);
    }
}

// =============================================
//  SUCCESS STATE
// =============================================
function showSuccessState(bookingResult, userData) {
    document.getElementById('bookingGrid').classList.add('hidden');
    const success = document.getElementById('successState');
    success.classList.remove('hidden');

    const dateObj = new Date(state.selectedDate + 'T12:00:00');
    const timeObj = new Date(state.selectedTime);
    const dateLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeLabel = timeObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE });
    const luogoLabel = userData.luogo === 'integrations:whatsapp_video' ? 'WhatsApp Video' : 'In Studio (Rome)';

    const detailsHTML = `
        <div class="booking-detail-item"><i class="far fa-user"></i><span>${userData.nome} ${userData.cognome}</span></div>
        <div class="booking-detail-item"><i class="far fa-envelope"></i><span>${userData.email.replace('@', '<wbr>@')}</span></div>
        <div class="booking-detail-item"><i class="far fa-calendar-alt"></i><span>${dateLabel} at ${timeLabel}</span></div>
        <div class="booking-detail-item"><i class="fas fa-map-marker-alt"></i><span>${luogoLabel}</span></div>
    `;

    document.getElementById('bookingDetails').innerHTML = detailsHTML;
    success.scrollIntoView({ behavior: 'smooth' });
}
