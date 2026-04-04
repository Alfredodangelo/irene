// =============================================
//  CONSULTATION BOOKING PAGE - English version
//  Same CONFIG as consulenza.js — edit that file
// =============================================

// Reads CONFIG from consulenza.js if already loaded, otherwise re-declares
// (Both files share the same Cal.com + n8n settings)
if (typeof CONFIG === 'undefined') {
    var CONFIG = {
        CAL_EVENT_TYPE_ID: '4496804',
        CAL_EVENT_DURATION_MINUTES: 20,
        N8N_WEBHOOK_URL: 'https://n8n.srv1204993.hstgr.cloud/webhook/dc4275f9-bee2-427e-96ef-7cbf9c92b5a9',
        N8N_CAL_SLOTS_URL:    'https://n8n.srv1204993.hstgr.cloud/webhook/cal-slots',
        N8N_CAL_BOOKINGS_URL: 'https://n8n.srv1204993.hstgr.cloud/webhook/cal-bookings',
        TIMEZONE: 'Europe/Rome',
    };
}

const MONTHS_EN = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

// intl-tel-input instance
let iti;

const state = {
    currentYear: null,
    currentMonth: null,
    availableSlots: {},
    selectedDate: null,
    selectedTime: null,
    loadingMonths: new Set(),
    loadedMonths: new Set(),
    photos: [],
    isSubmitting: false
};

document.addEventListener('DOMContentLoaded', async () => {
    const today = new Date();
    state.currentYear = today.getFullYear();
    state.currentMonth = today.getMonth();

    // Init phone input with country flag
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

    // Back button + pre-fill if from dashboard
    const fromDash = new URLSearchParams(location.search).get('from') === 'dashboard';
    if (fromDash) {
        const bl = document.querySelector('.back-link');
        if (bl) { bl.href = 'dashboard.html'; bl.innerHTML = '<i class="fas fa-arrow-left"></i> Back to dashboard'; }
    }
    if (fromDash && typeof db !== 'undefined') {
        try {
            const { data: { session } } = await db.auth.getSession();
            const user = session?.user;
            if (user) {
                const { data: profile } = await db.from('clients')
                    .select('first_name, last_name, phone')
                    .eq('id', user.id).single();
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
                        const dn = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || user.email;
                        booking.innerHTML = `<i class="fas fa-user-check" style="color:#D4AF37;margin-right:6px;"></i>Booking as: <strong style="color:#e8e8e8;">${dn}</strong> (${user.email})`;
                        booking.style.display = 'block';
                    }
                }
            }
        } catch(e) { /* silent */ }
    }

    checkConfig();
    renderCalendar();
    fetchMonthSlots(state.currentYear, state.currentMonth);

    document.getElementById('prevMonth').addEventListener('click', handlePrevMonth);
    document.getElementById('nextMonth').addEventListener('click', handleNextMonth);
    document.getElementById('changeDateTime').addEventListener('click', () => {
        state.selectedTime = null;
        updateSelectedInfo();
        if (state.selectedDate) {
            renderTimeSlots(state.selectedDate, state.availableSlots[state.selectedDate] || []);
        }
    });

    document.getElementById('consulenzaForm').addEventListener('submit', handleSubmit);
    initFileUpload();
});

function checkConfig() {}

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

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Cal.com API error: ${response.status}`);

        const data = await response.json();
        if (data.slots) {
            for (const [date, slotArray] of Object.entries(data.slots)) {
                state.availableSlots[date] = slotArray.map(s => s.time).filter(Boolean);
            }
        }

        state.loadedMonths.add(key);
        state.loadingMonths.delete(key);
        showCalLoading(false);
        renderCalendar();

    } catch (error) {
        console.error('Error fetching slots:', error);
        state.loadingMonths.delete(key);
        showCalLoading(false);
        document.getElementById('calLoading').innerHTML =
            `<span style="color:#ff6666;"><i class="fas fa-exclamation-circle"></i> Error loading availability. ${error.message}</span>`;
        document.getElementById('calLoading').classList.remove('hidden');
    }
}

function showCalLoading(show) {
    const el = document.getElementById('calLoading');
    if (show) {
        el.innerHTML = '<span class="loading-spinner"></span> Loading availability...';
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

function renderCalendar() {
    const { currentYear, currentMonth, availableSlots, selectedDate } = state;

    document.getElementById('monthYearLabel').textContent = `${MONTHS_EN[currentMonth]} ${currentYear}`;

    const today = new Date();
    const prevBtn = document.getElementById('prevMonth');
    const isCurrentOrPast =
        currentYear < today.getFullYear() ||
        (currentYear === today.getFullYear() && currentMonth <= today.getMonth());
    prevBtn.disabled = isCurrentOrPast;
    prevBtn.classList.toggle('disabled', isCurrentOrPast);

    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    const firstDayRaw = new Date(currentYear, currentMonth, 1).getDay();
    const firstDayMon = firstDayRaw === 0 ? 6 : firstDayRaw - 1;
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const todayStr = formatDate(today);

    for (let i = 0; i < firstDayMon; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-day empty';
        grid.appendChild(empty);
    }

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
        if (isSelected) classes.push('selected');
        else if (isPast) classes.push('past');
        else if (isToday) classes.push(hasSlots ? 'today available' : 'today unavailable');
        else if (hasSlots) classes.push('available');
        else classes.push('unavailable');

        cell.className = classes.join(' ');

        if (!isPast && hasSlots) {
            cell.addEventListener('click', () => selectDate(dateStr));
            const count = availableSlots[dateStr].length;
            cell.title = `${count} slot${count > 1 ? 's' : ''} available`;
        }

        grid.appendChild(cell);
    }
}

function handlePrevMonth() {
    if (state.currentMonth === 0) { state.currentMonth = 11; state.currentYear--; }
    else state.currentMonth--;
    renderCalendar();
    fetchMonthSlots(state.currentYear, state.currentMonth);
}

function handleNextMonth() {
    if (state.currentMonth === 11) { state.currentMonth = 0; state.currentYear++; }
    else state.currentMonth++;
    renderCalendar();
    fetchMonthSlots(state.currentYear, state.currentMonth);
}

function selectDate(dateStr) {
    state.selectedDate = dateStr;
    state.selectedTime = null;
    renderCalendar();
    updateSelectedInfo();

    const slots = state.availableSlots[dateStr] || [];
    renderTimeSlots(dateStr, slots);
    document.getElementById('timeSlotsCard').classList.remove('hidden');

    if (window.innerWidth <= 768) {
        setTimeout(() => {
            document.getElementById('timeSlotsCard').scrollIntoView({ behavior: 'smooth' });
        }, 200);
    }
}

function renderTimeSlots(dateStr, slots) {
    const grid = document.getElementById('timeSlotsGrid');
    const title = document.getElementById('timeSlotsTitle');
    grid.innerHTML = '';

    const dateObj = new Date(dateStr + 'T12:00:00');
    const dateLabel = dateObj.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long'
    });
    title.innerHTML = `<i class="far fa-clock"></i> Times · <span style="color:#D4AF37;">${dateLabel}</span>`;

    if (slots.length === 0) {
        grid.innerHTML = '<p class="no-slots-msg">No times available for this date.</p>';
        return;
    }

    slots.forEach(isoTime => {
        const timeObj = new Date(isoTime);
        const timeLabel = timeObj.toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE
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

    if (window.innerWidth <= 768) {
        setTimeout(() => {
            document.getElementById('formCard').scrollIntoView({ behavior: 'smooth' });
        }, 300);
    }
}

function updateSelectedInfo() {
    const infoBar = document.getElementById('selectedInfo');
    const infoText = document.getElementById('selectedInfoText');

    if (state.selectedDate && state.selectedTime) {
        const dateObj = new Date(state.selectedDate + 'T12:00:00');
        const timeObj = new Date(state.selectedTime);

        const dateLabel = dateObj.toLocaleDateString('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
        const timeLabel = timeObj.toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE
        });

        infoText.textContent = `${dateLabel} at ${timeLabel}`;
        infoBar.classList.remove('hidden');
    } else {
        infoBar.classList.add('hidden');
    }
}

// ── File Upload ──
function initFileUpload() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fotoInput');

    uploadArea.addEventListener('click', (e) => {
        if (e.target.closest('.remove-photo') || e.target.closest('.add-more-btn')) return;
        fileInput.click();
    });

    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        addFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
    });

    fileInput.addEventListener('change', (e) => {
        addFiles(Array.from(e.target.files));
        fileInput.value = '';
    });
}

function addFiles(newFiles) {
    newFiles.forEach(file => {
        if (state.photos.length >= 4) return;
        if (!file.type.startsWith('image/')) { showToast(`"${file.name}" is not a valid image.`); return; }
        if (file.size > 10 * 1024 * 1024) { showToast(`"${file.name}" exceeds the 10 MB limit.`); return; }
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
            <img src="${url}" alt="Photo ${idx + 1}">
            <button type="button" class="remove-photo" data-idx="${idx}" aria-label="Remove photo">
                <i class="fas fa-times"></i>
            </button>`;
        thumb.querySelector('.remove-photo').addEventListener('click', (e) => {
            e.stopPropagation();
            state.photos.splice(parseInt(e.currentTarget.dataset.idx), 1);
            renderPhotoPreview();
        });
        preview.appendChild(thumb);
    });

    if (state.photos.length < 4) {
        const addBtn = document.createElement('div');
        addBtn.className = 'photo-thumb add-more-btn';
        addBtn.innerHTML = '<i class="fas fa-plus"></i><span>Add</span>';
        addBtn.addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('fotoInput').click(); });
        preview.appendChild(addBtn);
    }
}

function filesToBase64(files) {
    return Promise.all(files.map(file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ nome: file.name, tipo: file.type, data_base64: reader.result });
        reader.onerror = reject;
        reader.readAsDataURL(file);
    })));
}

// ── Form Submit ──
async function handleSubmit(e) {
    e.preventDefault();
    if (state.isSubmitting) return;

    if (!state.selectedDate || !state.selectedTime) {
        const warning = document.getElementById('noDateWarning');
        warning.classList.remove('hidden');
        warning.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    if (state.photos.length === 1) {
        showToast('If you upload photos, please add at least 2 (minimum 2, maximum 4).');
        document.getElementById('uploadArea').scrollIntoView({ behavior: 'smooth' });
        return;
    }

    const formMsg = document.getElementById('formMsg');
    const nome = document.getElementById('nome').value.trim();
    const cognome = document.getElementById('cognome').value.trim();
    const email = document.getElementById('email').value.trim();
    const telefonoRaw = iti ? iti.getNumber() : document.getElementById('telefono').value.trim();
    const descrizione = document.getElementById('descrizione').value.trim();
    const luogo = document.querySelector('input[name="luogo"]:checked')?.value || '';
    const pagamento = document.querySelector('input[name="pagamento"]:checked')?.value || '';
    const gdpr = document.getElementById('gdprCheckbox')?.checked;
    const newsletter = document.querySelector('input[name="newsletter"]:checked')?.value || 'No';

    const missing = [];
    if (!nome)       missing.push('Name');
    if (!cognome)    missing.push('Surname');
    if (!email)      missing.push('Email');
    if (!telefonoRaw) missing.push('Phone number');
    if (!luogo)      missing.push('Consultation preference');
    if (!descrizione) missing.push('Description of your idea');
    if (!pagamento)  missing.push('Payment preference');
    if (!gdpr)       missing.push('Privacy consent (GDPR)');

    if (missing.length > 0) {
        formMsg.textContent = 'Required fields missing: ' + missing.join(', ');
        formMsg.className = 'form-message error';
        formMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    if (iti && !iti.isValidNumber()) {
        formMsg.textContent = 'Please enter a valid phone number (with international prefix).';
        formMsg.className = 'form-message error';
        document.getElementById('telefono').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    const telefono = telefonoRaw;

    // Validate WhatsApp reason
    const motivoVideo = (document.getElementById('motivoVideo')?.value || '').trim();
    if (luogo === 'integrations:whatsapp_video' && !motivoVideo) {
        formMsg.textContent = 'Please explain why you cannot come to the studio.';
        formMsg.className = 'form-message error';
        document.getElementById('motivoVideo').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    const submitBtn = document.getElementById('submitBtn');

    state.isSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading-spinner small"></span> Booking in progress...';
    formMsg.textContent = '';

    try {
        const bookingResult = await createCalBooking({ nome, cognome, email, telefono, descrizione, pagamento, luogo, motivoVideo });
        const fotosBase64 = await filesToBase64(state.photos);
        await sendToN8n({ nome, cognome, email, telefono, descrizione, pagamento, luogo, newsletter }, fotosBase64, bookingResult);
        showSuccessState(bookingResult, { nome, cognome, email });

    } catch (error) {
        console.error('Booking error:', error);
        formMsg.textContent = error.message && error.message !== 'Failed to fetch'
            ? `Error: ${error.message}`
            : 'An error occurred. Please try again or contact me directly.';
        formMsg.className = 'form-message error';
        state.isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-check"></i> Confirm Booking';
    }
}

async function createCalBooking({ nome, cognome, email, telefono, descrizione, pagamento, luogo, motivoVideo }) {
    const startISO = state.selectedTime;
    const endDate = new Date(new Date(startISO).getTime() + CONFIG.CAL_EVENT_DURATION_MINUTES * 60 * 1000);

    const noteParts = [
        `Tattoo idea: ${descrizione}`,
        `Payment preference: ${pagamento}`,
        `Phone: ${telefono}`
    ];
    if (motivoVideo) noteParts.push(`Video reason: ${motivoVideo}`);
    const notes = noteParts.join('\n');

    const responses = {
        name: `${nome} ${cognome}`,
        email: email,
        location: { value: luogo, optionValue: '' },
        notes: notes
    };
    if (telefono && /^\+\d{7,15}$/.test(telefono)) {
        responses.attendeePhoneNumber = telefono;
    }

    const body = {
        eventTypeId: parseInt(CONFIG.CAL_EVENT_TYPE_ID),
        start: startISO,
        end: endDate.toISOString(),
        responses,
        metadata: { source: 'website_consultation_en', tattoo_idea: descrizione, payment: pagamento },
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

async function sendToN8n(formData, fotosBase64, bookingResult) {
    if (!CONFIG.N8N_WEBHOOK_URL || CONFIG.N8N_WEBHOOK_URL === 'YOUR_N8N_WEBHOOK_URL') return;

    const dateObj = new Date(state.selectedDate + 'T12:00:00');
    const timeObj = new Date(state.selectedTime);

    const payload = {
        source: 'website_consultation_en',
        timestamp: new Date().toISOString(),
        cal_booking_uid: bookingResult.uid || '',
        cal_booking_id: String(bookingResult.id || ''),
        cal_booking_status: bookingResult.status || 'ACCEPTED',
        nome: formData.nome,
        cognome: formData.cognome,
        email: formData.email,
        telefono: formData.telefono || '',
        data_appuntamento: dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        ora_appuntamento: timeObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE }),
        datetime_iso: state.selectedTime,
        descrizione_idea: formData.descrizione,
        preferenza_pagamento: formData.pagamento,
        luogo: formData.luogo || '',
        gdpr_consent: 'true',
        newsletter: formData.newsletter,
        foto_count: String(fotosBase64.length),
        fotos: fotosBase64,
    };

    const response = await fetch(CONFIG.N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response.ok) console.warn(`n8n webhook: ${response.status}`);
}

function showSuccessState(_bookingResult, userData) {
    document.getElementById('bookingGrid').classList.add('hidden');
    const success = document.getElementById('successState');
    success.classList.remove('hidden');

    const dateObj = new Date(state.selectedDate + 'T12:00:00');
    const timeObj = new Date(state.selectedTime);

    const dateLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeLabel = timeObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE });

    document.getElementById('bookingDetails').innerHTML = `
        <div class="booking-detail-item"><i class="far fa-user"></i><span>${userData.nome} ${userData.cognome}</span></div>
        <div class="booking-detail-item"><i class="far fa-envelope"></i><span>${userData.email.replace('@', '<wbr>@')}</span></div>
        <div class="booking-detail-item"><i class="far fa-calendar-alt"></i><span>${dateLabel}</span></div>
        <div class="booking-detail-item"><i class="far fa-clock"></i><span>${timeLabel}</span></div>
    `;

    success.scrollIntoView({ behavior: 'smooth' });
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
