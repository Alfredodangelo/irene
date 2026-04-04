// =============================================
//  CONSENSO INFORMATO - Irene Gipsy Tattoo
//  Form singola pagina + firma canvas + n8n webhook
// =============================================

const CONSENSO_CONFIG = {
    N8N_WEBHOOK_URL: 'https://n8n.srv1204993.hstgr.cloud/webhook/eee51628-cd89-4ecd-9546-ee10f341ca00',
};

// ── Stato firma ──────────────────────────────
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

    // Telefono con bandiera paese
    if (window.intlTelInput) {
        iti = window.intlTelInput(document.getElementById('telefono'), {
            initialCountry: 'it',
            preferredCountries: ['it'],
            utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@18.2.1/build/js/utils.js',
        });
    }

    // Autocomplete città e indirizzo
    if (window.setupCittaAutocomplete) {
        window.setupCittaAutocomplete('cittaNascita', 'citta');
        window.setupCittaAutocomplete('indirizzo', 'indirizzo');
    }

    // Precompila data firma con oggi
    const today = new Date().toISOString().split('T')[0];
    const dataFirmaEl = document.getElementById('dataFirma');
    if (dataFirmaEl) dataFirmaEl.value = today;

    // Precompila campi dal profilo Supabase
    await prefillFromProfile();
});

async function prefillFromProfile() {
    try {
        const { data: { session } } = await db.auth.getSession();
        if (!session) return;

        // Il consenso si firma alla prima seduta di ogni tatuaggio.
        // Se già firmato per il tatuaggio corrente, blocca il form.
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
                consentStillValid = true; // firmato e nessuna seduta completata → ancora valido
            }
        }
        if (consentStillValid) {
            const formContainer = document.getElementById('formContainer');
            if (formContainer) {
                formContainer.innerHTML = `
                    <div style="text-align:center;padding:60px 20px;">
                        <i class="fas fa-check-circle" style="font-size:3rem;color:var(--secondary-color,#D4AF37);margin-bottom:16px;display:block;"></i>
                        <h2 style="color:var(--secondary-color,#D4AF37);margin-bottom:12px;">Consenso già firmato</h2>
                        <p style="color:#ccc;font-size:0.95rem;line-height:1.6;">Hai già firmato il consenso informato. Non è necessario firmarlo di nuovo.</p>
                        <a href="dashboard.html" style="display:inline-block;margin-top:24px;padding:12px 28px;background:var(--secondary-color,#D4AF37);color:#000;border-radius:8px;text-decoration:none;font-weight:600;">Torna alla Dashboard</a>
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
        console.warn('[consenso] prefill error:', e);
    }
}

// =============================================
//  SIGNATURE PAD
// =============================================
function initSignaturePad() {
    canvas = document.getElementById('signatureCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    // Canvas visibile subito — ridimensiona al prossimo frame di rendering
    requestAnimationFrame(resizeCanvas);

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
    if (rect.width === 0) return;
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
    // Nessun sfondo → trasparente
    tmpCtx.drawImage(canvas, 0, 0, 400, 150);
    // Converti ogni pixel visibile in nero, mantenendo l'alpha (anti-aliasing)
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
//  VALIDAZIONE
// =============================================
function validateAll() {
    const fields = [
        { id: 'nomeCognome', label: 'Nome e cognome' },
        { id: 'dataNascita', label: 'Data di nascita' },
        { id: 'cittaNascita', label: 'Città di nascita' },
        { id: 'indirizzo', label: 'Indirizzo' },
        { id: 'telefono', label: 'Telefono' },
        { id: 'email', label: 'E-mail' },
        { id: 'numeroDocumento', label: 'Numero documento' },
        { id: 'codiceFiscale', label: 'Codice fiscale' },
        { id: 'parteCorpo', label: 'Parte del corpo' },
        { id: 'dataFirma', label: 'Data' },
    ];

    const msg = document.getElementById('formMsg');

    for (const field of fields) {
        const el = document.getElementById(field.id);
        if (!el || !el.value.trim()) {
            msg.textContent = `Compila il campo: ${field.label}`;
            msg.className = 'form-message error';
            el && el.focus();
            return false;
        }
    }

    const email = document.getElementById('email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg.textContent = 'Inserisci un indirizzo e-mail valido.';
        msg.className = 'form-message error';
        return false;
    }

    const cf = document.getElementById('codiceFiscale').value.trim();
    if (cf.length !== 16) {
        msg.textContent = 'Il codice fiscale deve essere di 16 caratteri.';
        msg.className = 'form-message error';
        document.getElementById('codiceFiscale').focus();
        return false;
    }

    const tipoDoc = document.querySelector('input[name="tipoDocumento"]:checked');
    if (!tipoDoc) {
        msg.textContent = 'Seleziona il tipo di documento.';
        msg.className = 'form-message error';
        return false;
    }

    if (signatureEmpty) {
        msg.textContent = 'Apponi la tua firma prima di inviare.';
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
    if (!validateAll()) return;

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Invio in corso...';

    const data = {
        source: 'website_consenso',
        lang: 'it',
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
        autorizza_immagini: 'Si',
        data_firma: document.getElementById('dataFirma').value,
        firma_base64: getSignatureDataURL(),
    };

    try {
        console.log('[consenso] Invio a:', CONSENSO_CONFIG.N8N_WEBHOOK_URL);
        await fetch(CONSENSO_CONFIG.N8N_WEBHOOK_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(data),
        });
        console.log('[consenso] Richiesta inviata');
    } catch (err) {
        console.error('[consenso] Errore fetch:', err);
    }

    // Salva indirizzo e CF nella tabella clients (per export fiscale)
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
        console.warn('[consenso] Salvataggio dati fiscali:', e);
    }

    showSuccess(data);
}

// =============================================
//  SUCCESS STATE
// =============================================
function showSuccess(data) {
    document.getElementById('formContainer').classList.add('hidden');
    const success = document.getElementById('successState');
    success.classList.remove('hidden');

    document.getElementById('consentoDetails').innerHTML = `
        <div class="booking-detail-item"><i class="far fa-user"></i><span>${data.nome_cognome}</span></div>
        <div class="booking-detail-item"><i class="far fa-envelope"></i><span>${data.email}</span></div>
        <div class="booking-detail-item"><i class="fas fa-pen-nib"></i><span>${data.tipo_servizio} — ${data.parte_corpo}</span></div>
        <div class="booking-detail-item"><i class="far fa-calendar"></i><span>Data firma: ${formatDate(data.data_firma)}</span></div>
        <div class="booking-detail-item"><i class="fas fa-check-circle" style="color:var(--secondary-color)"></i><span>Consenso informato registrato con successo</span></div>
    `;

    success.scrollIntoView({ behavior: 'smooth' });
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}
