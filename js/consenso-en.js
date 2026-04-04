// =============================================
//  INFORMED CONSENT - Irene Gipsy Tattoo (EN)
//  Multi-step form + canvas signature + n8n webhook
// =============================================

const CONSENSO_CONFIG = {
    N8N_WEBHOOK_URL: 'https://n8n.srv1204993.hstgr.cloud/webhook/eee51628-cd89-4ecd-9546-ee10f341ca00',
};

// ── Signature state ───────────────────────────
let isDrawing = false;
let signatureEmpty = true;
let canvas, ctx;

// ── intl-tel-input ────────────────────────────
let iti = null;

// =============================================
//  INIT
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
    initSignaturePad();

    // Phone with country flag
    if (window.intlTelInput) {
        iti = window.intlTelInput(document.getElementById('telefono'), {
            initialCountry: 'it',
            preferredCountries: ['it'],
            utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@18.2.1/build/js/utils.js',
        });
    }

    // City & address autocomplete
    if (window.setupCittaAutocomplete) {
        window.setupCittaAutocomplete('cittaNascita', 'citta');
        window.setupCittaAutocomplete('indirizzo', 'indirizzo');
    }

    // Pre-fill today's date
    const today = new Date().toISOString().split('T')[0];
    const dataFirmaEl = document.getElementById('dataFirma');
    if (dataFirmaEl) dataFirmaEl.value = today;

    // Pre-fill from Supabase profile
    await prefillFromProfile();
});

async function prefillFromProfile() {
    try {
        if (typeof db === 'undefined') return;
        const { data: { session } } = await db.auth.getSession();
        if (!session) return;

        // Consent is signed at the first session of each tattoo.
        const { data: lastConsent } = await db.from('consent_documents')
            .select('signed_at')
            .eq('client_id', session.user.id)
            .order('signed_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        let consentStillValid = false;
        if (lastConsent?.signed_at) {
            const lastConsentDate = new Date(lastConsent.signed_at);
            const { data: completedSedute } = await db.from('appointments')
                .select('scheduled_at')
                .eq('client_id', session.user.id)
                .eq('type', 'seduta')
                .eq('status', 'completed')
                .order('scheduled_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (completedSedute?.scheduled_at) {
                consentStillValid = lastConsentDate > new Date(completedSedute.scheduled_at);
            } else {
                consentStillValid = true;
            }
        }
        if (consentStillValid) {
            const formContainer = document.getElementById('formContainer');
            if (formContainer) {
                formContainer.innerHTML = `
                    <div style="text-align:center;padding:60px 20px;">
                        <i class="fas fa-check-circle" style="font-size:3rem;color:var(--secondary-color,#D4AF37);margin-bottom:16px;display:block;"></i>
                        <h2 style="color:var(--secondary-color,#D4AF37);margin-bottom:12px;">Consent Already Signed</h2>
                        <p style="color:#ccc;font-size:0.95rem;line-height:1.6;">You have already signed the informed consent form. You don't need to sign it again.</p>
                        <a href="dashboard.html" style="display:inline-block;margin-top:24px;padding:12px 28px;background:var(--secondary-color,#D4AF37);color:#000;border-radius:8px;text-decoration:none;font-weight:600;">Back to Dashboard</a>
                    </div>`;
            }
            return;
        }

        const { data: client } = await db
            .from('clients')
            .select('first_name, last_name, email, phone, codice_fiscale, indirizzo')
            .eq('id', session.user.id)
            .single();
        if (!client) return;

        const set = (id, val) => {
            if (!val) return;
            const el = document.getElementById(id);
            if (el && !el.value) el.value = val;
        };

        const fullName = [client.first_name, client.last_name].filter(Boolean).join(' ');
        set('nomeCognome', fullName);
        set('email', client.email);
        set('codiceFiscale', client.codice_fiscale);
        set('indirizzo', client.indirizzo);

        if (client.phone && iti) {
            iti.setNumber(client.phone);
        } else {
            set('telefono', client.phone);
        }
    } catch (e) {
        console.warn('[consenso-en] prefill error:', e);
    }
}

// =============================================
//  SIGNATURE PAD
// =============================================
function initSignaturePad() {
    canvas = document.getElementById('signatureCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    // Don't resize here — canvas is inside hidden step2.
    // resizeCanvas() is called from goToStep2() once it becomes visible.
    window.addEventListener('resize', () => {
        if (canvas && canvas.getBoundingClientRect().width > 0) resizeCanvas();
    });

    // Mouse events
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseleave', stopDraw);

    // Touch events
    canvas.addEventListener('touchstart', e => { e.preventDefault(); startDraw(e.touches[0]); }, { passive: false });
    canvas.addEventListener('touchmove', e => { e.preventDefault(); draw(e.touches[0]); }, { passive: false });
    canvas.addEventListener('touchend', stopDraw);
}

function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return; // canvas not visible yet
    const imgData = (signatureEmpty || canvas.width === 0) ? null : ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width = rect.width;
    canvas.height = rect.height;
    styleCtx();
    if (imgData) ctx.putImageData(imgData, 0, 0);
}

function styleCtx() {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX ?? e.pageX) - rect.left,
        y: (e.clientY ?? e.pageY) - rect.top,
    };
}

function startDraw(e) {
    isDrawing = true;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
}

function draw(e) {
    if (!isDrawing) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    signatureEmpty = false;
}

function stopDraw() {
    isDrawing = false;
}

function clearSignature() {
    if (!canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    signatureEmpty = true;
}

function getSignatureDataURL() {
    if (!canvas || signatureEmpty) return null;
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = 400;
    tmpCanvas.height = 150;
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.drawImage(canvas, 0, 0, 400, 150);
    const imgData = tmpCtx.getImageData(0, 0, 400, 150);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 0) {
            d[i] = 0; d[i + 1] = 0; d[i + 2] = 0;
        }
    }
    tmpCtx.putImageData(imgData, 0, 0);
    return tmpCanvas.toDataURL('image/png');
}

// =============================================
//  STEP NAVIGATION
// =============================================
function goToStep2() {
    if (!validateStep1()) return;

    document.getElementById('step1').classList.add('hidden');
    document.getElementById('step2').classList.remove('hidden');

    // Canvas is now visible — set real dimensions
    resizeCanvas();

    document.getElementById('stepDot1').classList.remove('active');
    document.getElementById('stepDot1').classList.add('done');
    document.getElementById('stepDot2').classList.add('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToStep1() {
    document.getElementById('step2').classList.add('hidden');
    document.getElementById('step1').classList.remove('hidden');

    document.getElementById('stepDot2').classList.remove('active');
    document.getElementById('stepDot1').classList.remove('done');
    document.getElementById('stepDot1').classList.add('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =============================================
//  VALIDATION
// =============================================
function validateStep1() {
    const fields = [
        { id: 'nomeCognome', label: 'Full name' },
        { id: 'dataNascita', label: 'Date of birth' },
        { id: 'cittaNascita', label: 'City of birth' },
        { id: 'indirizzo', label: 'Address' },
        { id: 'telefono', label: 'Phone' },
        { id: 'email', label: 'E-mail' },
        { id: 'numeroDocumento', label: 'Document number' },
        { id: 'codiceFiscale', label: 'Tax code / National ID' },
    ];

    const msg = document.getElementById('step1Msg');

    for (const field of fields) {
        const el = document.getElementById(field.id);
        if (!el || !el.value.trim()) {
            msg.textContent = `Please fill in: ${field.label}`;
            msg.className = 'form-message error';
            el && el.focus();
            return false;
        }
    }

    // Email
    const email = document.getElementById('email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg.textContent = 'Please enter a valid e-mail address.';
        msg.className = 'form-message error';
        return false;
    }

    // ID code length
    const cf = document.getElementById('codiceFiscale').value.trim();
    if (cf.length < 8) {
        msg.textContent = 'Please enter a valid tax code / national ID number.';
        msg.className = 'form-message error';
        document.getElementById('codiceFiscale').focus();
        return false;
    }

    // Document type
    const tipoDoc = document.querySelector('input[name="tipoDocumento"]:checked');
    if (!tipoDoc) {
        msg.textContent = 'Please select a document type.';
        msg.className = 'form-message error';
        return false;
    }

    msg.textContent = '';
    msg.className = 'form-message';
    return true;
}

function validateStep2() {
    const msg = document.getElementById('step2Msg');

    const tipoServizio = document.querySelector('input[name="tipoServizio"]');

    const parteCorpo = document.getElementById('parteCorpo').value.trim();
    if (!parteCorpo) {
        msg.textContent = 'Please indicate the body part.';
        msg.className = 'form-message error';
        document.getElementById('parteCorpo').focus();
        return false;
    }

    const dataFirma = document.getElementById('dataFirma').value;
    if (!dataFirma) {
        msg.textContent = 'Please enter the date.';
        msg.className = 'form-message error';
        return false;
    }

    if (signatureEmpty) {
        msg.textContent = 'Please sign before submitting.';
        msg.className = 'form-message error';
        return false;
    }

    msg.textContent = '';
    msg.className = 'form-message';
    return true;
}

// =============================================
//  SUBMIT
// =============================================
async function submitConsenso() {
    if (!validateStep2()) return;

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

    const data = {
        source: 'website_consenso_en',
        lang: 'en',
        timestamp: new Date().toISOString(),
        nome_cognome: document.getElementById('nomeCognome').value.trim(),
        data_nascita: document.getElementById('dataNascita').value,
        citta_nascita: document.getElementById('cittaNascita').value.trim(),
        indirizzo: document.getElementById('indirizzo').value.trim(),
        telefono: iti ? iti.getNumber() : document.getElementById('telefono').value.trim(),
        email: document.getElementById('email').value.trim(),
        tipo_documento: document.querySelector('input[name="tipoDocumento"]:checked').value,
        numero_documento: document.getElementById('numeroDocumento').value.trim(),
        codice_fiscale: document.getElementById('codiceFiscale').value.trim().toUpperCase(),
        tipo_servizio: document.querySelector('input[name="tipoServizio"]').value,
        parte_corpo: document.getElementById('parteCorpo').value.trim(),
        autorizza_immagini: 'Yes',
        data_firma: document.getElementById('dataFirma').value,
        firma_base64: getSignatureDataURL(),
    };

    try {
        console.log('[consenso-en] Sending to:', CONSENSO_CONFIG.N8N_WEBHOOK_URL);
        await fetch(CONSENSO_CONFIG.N8N_WEBHOOK_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(data),
        });
        console.log('[consenso-en] Request sent (no-cors)');
    } catch (err) {
        console.error('[consenso-en] Fetch error:', err);
    }

    // Save address and fiscal code to clients table (for fiscal export)
    try {
        const { data: { session } } = await db.auth.getSession();
        if (session) {
            await db.from('clients')
                .update({
                    codice_fiscale: data.codice_fiscale || null,
                    indirizzo: data.indirizzo || null,
                })
                .eq('id', session.user.id);
        }
    } catch (e) {
        console.warn('[consenso-en] Fiscal data save:', e);
    }

    showSuccess(data);
}

// =============================================
//  SUCCESS STATE
// =============================================
function showSuccess(data) {
    document.getElementById('step2').classList.add('hidden');
    const success = document.getElementById('successState');
    success.classList.remove('hidden');

    document.getElementById('consentoDetails').innerHTML = `
        <div class="booking-detail-item"><i class="far fa-user"></i><span>${data.nome_cognome}</span></div>
        <div class="booking-detail-item"><i class="far fa-envelope"></i><span>${data.email}</span></div>
        <div class="booking-detail-item"><i class="fas fa-pen-nib"></i><span>${data.tipo_servizio} — ${data.parte_corpo}</span></div>
        <div class="booking-detail-item"><i class="far fa-calendar"></i><span>Signed on: ${formatDate(data.data_firma)}</span></div>
        <div class="booking-detail-item"><i class="fas fa-check-circle" style="color:var(--secondary-color)"></i><span>Informed consent successfully submitted</span></div>
    `;

    success.scrollIntoView({ behavior: 'smooth' });
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}
