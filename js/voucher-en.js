// =============================================
//  VOUCHER PAGE (EN) - Irene Gipsy Tattoo
//  Gift voucher: PayPal + n8n
// =============================================

const CONFIG = {
    // PayPal — insert your Client ID from PayPal Developer account
    PAYPAL_CLIENT_ID: 'YOUR_PAYPAL_CLIENT_ID',
    // n8n webhook to send voucher data
    N8N_WEBHOOK_URL: 'https://n8n.srv1204993.hstgr.cloud/webhook/fd670029-1c46-4dd7-a623-492716b01fee',
    MIN_AMOUNT: 50,
    MAX_AMOUNT: 800,
};

let selectedAmount = null;
let paypalRendered = false;
let paymentComplete = false;

// =============================================
//  AMOUNT SELECTION
// =============================================
function selectAmount(amount) {
    selectedAmount = amount;

    // Update preset buttons
    document.querySelectorAll('.voucher-preset-btn').forEach(btn => {
        btn.classList.toggle('selected', parseInt(btn.dataset.amount) === amount);
    });

    // Clear custom input
    document.getElementById('customAmount').value = '';

    updateAmountDisplay(amount);
    checkFormAndUpdatePayPal();
}

function onCustomAmountInput(value) {
    const amount = parseInt(value);

    // Deselect presets
    document.querySelectorAll('.voucher-preset-btn').forEach(btn => btn.classList.remove('selected'));

    if (!value || isNaN(amount)) {
        selectedAmount = null;
        document.getElementById('selectedAmountDisplay').classList.add('hidden');
        clearPayPal();
        return;
    }

    if (amount < CONFIG.MIN_AMOUNT || amount > CONFIG.MAX_AMOUNT) {
        selectedAmount = null;
        document.getElementById('selectedAmountDisplay').classList.add('hidden');
        clearPayPal();
        return;
    }

    selectedAmount = amount;
    updateAmountDisplay(amount);
    checkFormAndUpdatePayPal();
}

function updateAmountDisplay(amount) {
    const display = document.getElementById('selectedAmountDisplay');
    document.getElementById('selectedAmountText').textContent = `€${amount}`;
    display.classList.remove('hidden');
    document.getElementById('noAmountWarning').classList.add('hidden');
}

// =============================================
//  FORM VALIDATION
// =============================================
function isFormValid() {
    const nome = document.getElementById('nome').value.trim();
    const cognome = document.getElementById('cognome').value.trim();
    const email = document.getElementById('email').value.trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const gdpr = document.getElementById('gdpr').checked;

    return !!(nome && cognome && email && emailValid && gdpr && selectedAmount);
}

// =============================================
//  FORM LISTENERS
// =============================================
document.addEventListener('DOMContentLoaded', () => {
    ['nome', 'cognome', 'email', 'gdpr'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', checkFormAndUpdatePayPal);
            if (el.tagName === 'INPUT') el.addEventListener('input', checkFormAndUpdatePayPal);
        }
    });
});

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

function clearPayPal() {
    document.getElementById('paypalButtonContainer').innerHTML = '';
    document.getElementById('paypalSection').classList.add('hidden');
    paypalRendered = false;
}

async function checkFormAndUpdatePayPal() {
    if (paymentComplete) return;

    if (!selectedAmount) {
        clearPayPal();
        return;
    }

    // Update amount label
    document.getElementById('paypalAmountLabel').textContent = `€${selectedAmount}`;
    document.getElementById('paypalSection').classList.remove('hidden');

    if (!isFormValid()) {
        document.getElementById('paypalButtonContainer').innerHTML = '';
        paypalRendered = false;
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
    if (paymentComplete) return;

    try {
        if (!window.paypal) await loadPayPalSDK();
    } catch {
        document.getElementById('paypalNotConfigured').classList.remove('hidden');
        return;
    }

    const container = document.getElementById('paypalButtonContainer');
    container.innerHTML = '';
    paypalRendered = false;

    const amount = selectedAmount.toFixed(2);
    const description = `Tattoo gift voucher €${selectedAmount} - Irene Gipsy Tattoo`;

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
            msg.textContent = 'An error occurred during payment. Please try again or contact me directly.';
            msg.className = 'form-message error';
        }
    }).render('#paypalButtonContainer');

    paypalRendered = true;
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
//  PAYMENT SUCCESS
// =============================================
async function handlePaymentSuccess(order) {
    paymentComplete = true;

    document.getElementById('paypalButtonContainer').innerHTML = '';
    document.getElementById('paymentSuccess').classList.remove('hidden');

    const formMsg = document.getElementById('formMsg');
    formMsg.textContent = 'Payment received. Generating voucher...';
    formMsg.className = 'form-message';

    const nome = document.getElementById('nome').value.trim();
    const cognome = document.getElementById('cognome').value.trim();
    const email = document.getElementById('email').value.trim();
    const nomeDestinatario = document.getElementById('nomeDestinatario').value.trim();
    const messaggio = document.getElementById('messaggio').value.trim();

    const voucherCode = generateVoucherCode();
    const formData = { nome, cognome, email, nomeDestinatario, messaggio };

    try {
        await sendToN8n(formData, order.id, selectedAmount, voucherCode);
        showSuccessState(voucherCode, formData, selectedAmount);
    } catch (error) {
        console.error('Post-payment error:', error);
        // Show code anyway — payment was successful
        showSuccessState(voucherCode, formData, selectedAmount);
    }
}

// =============================================
//  VOUCHER CODE
// =============================================
function generateVoucherCode() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `IGT-${y}${m}${d}-${random}`;
}

// =============================================
//  N8N WEBHOOK
// =============================================
async function sendToN8n(formData, paypalOrderId, amount, voucherCode) {
    if (!CONFIG.N8N_WEBHOOK_URL || CONFIG.N8N_WEBHOOK_URL === 'YOUR_N8N_WEBHOOK_URL') return;

    const params = new URLSearchParams({
        source: 'website_voucher_en',
        timestamp: new Date().toISOString(),
        nome: formData.nome,
        cognome: formData.cognome,
        email: formData.email,
        nome_destinatario: formData.nomeDestinatario || '',
        messaggio: formData.messaggio || '',
        importo: String(amount),
        codice_voucher: voucherCode,
        paypal_order_id: paypalOrderId,
    });

    await fetch(`${CONFIG.N8N_WEBHOOK_URL}?${params.toString()}`, { method: 'GET' });
}

// =============================================
//  SUCCESS STATE
// =============================================
function showSuccessState(voucherCode, userData, amount) {
    document.getElementById('voucherGrid').classList.add('hidden');
    const success = document.getElementById('successState');
    success.classList.remove('hidden');

    // Prominent voucher code
    document.getElementById('voucherCodeDisplay').innerHTML = `
        <div class="voucher-code-box">
            <p class="voucher-code-label">Your voucher code</p>
            <p class="voucher-code-value">${voucherCode}</p>
            <p class="voucher-code-amount">Value: €${amount}</p>
        </div>
    `;

    let detailsHTML = `
        <div class="booking-detail-item"><i class="far fa-user"></i><span>${userData.nome} ${userData.cognome}</span></div>
        <div class="booking-detail-item"><i class="far fa-envelope"></i><span>${userData.email.replace('@', '<wbr>@')}</span></div>
        <div class="booking-detail-item"><i class="fab fa-paypal"></i><span>Payment €${amount} confirmed</span></div>
    `;

    if (userData.nomeDestinatario) {
        detailsHTML += `<div class="booking-detail-item"><i class="fas fa-user-friends"></i><span>Recipient: ${userData.nomeDestinatario}</span></div>`;
    }

    detailsHTML += `<div class="booking-detail-item"><i class="fas fa-info-circle"></i><span>The voucher is valid for 12 months from the date of purchase</span></div>`;

    document.getElementById('bookingDetails').innerHTML = detailsHTML;
    success.scrollIntoView({ behavior: 'smooth' });
}
