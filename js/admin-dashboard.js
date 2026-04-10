// ============================================
// ADMIN DASHBOARD — Irene Gipsy Tattoo
// ============================================
//
// ⚠️ SUPABASE: eseguire queste policy SQL nel pannello Supabase
// (SQL Editor) prima di usare questa dashboard:
//
// CREATE POLICY "admin_clients" ON public.clients
//   FOR ALL TO authenticated
//   USING (auth.email() = 'irenegipsytattoo@gmail.com')
//   WITH CHECK (auth.email() = 'irenegipsytattoo@gmail.com');
//
// CREATE POLICY "admin_appointments" ON public.appointments
//   FOR ALL TO authenticated
//   USING (auth.email() = 'irenegipsytattoo@gmail.com')
//   WITH CHECK (auth.email() = 'irenegipsytattoo@gmail.com');
//
// CREATE POLICY "admin_gallery" ON public.tattoo_gallery
//   FOR ALL TO authenticated
//   USING (auth.email() = 'irenegipsytattoo@gmail.com')
//   WITH CHECK (auth.email() = 'irenegipsytattoo@gmail.com');
//
// CREATE POLICY "admin_waitlist" ON public.waitlist
//   FOR ALL TO authenticated
//   USING (auth.email() = 'irenegipsytattoo@gmail.com')
//   WITH CHECK (auth.email() = 'irenegipsytattoo@gmail.com');
//
// ============================================

const ADMIN_EMAIL = 'irenegipsytattoo@gmail.com';

// ─── Custom confirm (sostituisce confirm() nativo) ───────────────────────────
function customConfirm(message) {
    return new Promise(resolve => {
        const overlay = document.getElementById('customConfirmOverlay');
        const msg     = document.getElementById('customConfirmMsg');
        const okBtn   = document.getElementById('customConfirmOk');
        const cancelBtn = document.getElementById('customConfirmCancel');
        if (!overlay) { resolve(false); return; } // fallback sicuro — non usare native confirm()
        msg.textContent = message;
        overlay.style.display = 'flex';
        const cleanup = () => { overlay.style.display = 'none'; okBtn.onclick = null; cancelBtn.onclick = null; };
        okBtn.onclick     = () => { cleanup(); resolve(true); };
        cancelBtn.onclick = () => { cleanup(); resolve(false); };
    });
}
// ─────────────────────────────────────────────────────────────────────────────

// Stato globale
let allClients           = [];
let allAppointments      = [];
let allWaitlist          = [];
let allWaitlistRequests  = [];
let allNotifications     = [];
let calDate              = new Date();
let selectedCalDay    = null;
let allVouchersAdmin  = [];
let _currentDetailClientId = null;  // client aperto in dettaglio (per btn "Crea appuntamento")

// ============================================
// INIT
// ============================================
function showToast(msg, duration = 3000, isError = false) {
    let t = document.getElementById('adminToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'adminToast';
        t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 22px;border-radius:8px;font-size:0.9rem;font-weight:600;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity .3s;';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = isError ? '#c0392b' : '#D4AF37';
    t.style.color      = isError ? '#fff'    : '#000';
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, duration);
}

document.addEventListener('DOMContentLoaded', async () => {
    // Auth check
    const { data: { session } } = await db.auth.getSession();

    if (!session || session.user.email?.toLowerCase() !== ADMIN_EMAIL) {
        window.location.href = 'login.html';
        return;
    }

    // Mostra app
    document.getElementById('authOverlay').style.display = 'none';
    document.getElementById('app').style.display = 'flex';

    // Setup UI
    setupNavigation();
    setupSearch();
    setupCalendarControls();
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('closeDetail').addEventListener('click', closeClientDetail);

    // Campanella topbar → apre sezione notifiche
    document.getElementById('notifBell').addEventListener('click', () => navigateTo('notifiche'));

    // Carica dati
    await loadAllData();
    setupComunicazioni();
    setupImpostazioni();
    setupPortfolio();
    await loadNotifications();
    setupNotifRealtime();
});

// ============================================
// DATA LOADING
// ============================================
async function loadAllData() {
    await Promise.all([loadClients(), loadAppointments(), loadWaitlist(), loadWaitlistRequests()]);
    renderOverview();
    renderClientsTable(allClients);
    renderCalendar();
}

async function loadPendingReschedules() {
    const { data } = await db.from('reschedule_requests')
        .select('id, appointment_id, initiated_by, status, requested_date, requested_time')
        .eq('status', 'pending');
    allRescheduleRequests = data || [];
}

async function loadClients() {
    const { data, error } = await db
        .from('clients')
        .select('*')
        .neq('email', ADMIN_EMAIL)
        .order('last_name', { ascending: true })
        .order('first_name', { ascending: true });
    if (!error) allClients = data || [];
}

async function loadAppointments() {
    const { data, error } = await db
        .from('appointments')
        .select('*, clients(id, first_name, last_name, email, phone)')
        .order('scheduled_at', { ascending: true });
    if (!error) allAppointments = data || [];
}

async function loadWaitlist() {
    const { data, error } = await db
        .from('waitlist')
        .select('*, clients(id, first_name, last_name, email)')
        .eq('active', true)
        .order('position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
    if (!error) allWaitlist = data || [];
}

async function loadWaitlistRequests() {
    const { data } = await db
        .from('waitlist_requests')
        .select('*, clients(id, first_name, last_name, email)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
    allWaitlistRequests = data || [];
}

// ============================================
// LISTA D'ATTESA — render & azioni
// ============================================
const WL_NOTIFY_URL = 'https://n8n.srv1204993.hstgr.cloud/webhook/waitlist-request-response';

function renderWaitlist() {
    const container = document.getElementById('waitlistContainer');
    if (!container) return;

    if (allWaitlist.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:32px 0;">Nessun cliente in lista d\'attesa</div>';
        return;
    }

    container.innerHTML = allWaitlist.map((w, idx) => {
        const client  = w.clients || {};
        const name    = `${client.first_name || ''} ${client.last_name || ''}`.trim() || '—';
        const pos     = w.position != null ? w.position : (idx + 1);
        const isFirst = idx === 0;
        const isLast  = idx === allWaitlist.length - 1;
        const cid     = client.id || '';
        return `
        <div class="wl-item">
            <div class="wl-pos">#${pos}</div>
            <div class="wl-client-name wl-client-link" onclick="if('${cid}')openClientDetail('${cid}')">${name}</div>
            <div class="wl-actions">
                <button class="wl-action-btn" title="Sposta su" onclick="wlMoveUp('${cid}')" ${isFirst ? 'disabled' : ''}><i class="fas fa-chevron-up"></i></button>
                <button class="wl-action-btn" title="Sposta giù" onclick="wlMoveDown('${cid}')" ${isLast ? 'disabled' : ''}><i class="fas fa-chevron-down"></i></button>
                <button class="wl-action-btn danger" title="Rimuovi" onclick="wlRemove('${cid}')"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>`;
    }).join('');
}

async function wlMoveUp(clientId) {
    const idx = allWaitlist.findIndex(w => w.clients?.id === clientId);
    if (idx <= 0) return;
    const curr = allWaitlist[idx];
    const prev = allWaitlist[idx - 1];
    const posA = curr.position ?? idx + 1;
    const posB = prev.position ?? idx;
    await Promise.all([
        db.from('waitlist').update({ position: posB }).eq('client_id', curr.client_id),
        db.from('waitlist').update({ position: posA }).eq('client_id', prev.client_id),
    ]);
    await loadWaitlist();
    renderWaitlist();
}

async function wlMoveDown(clientId) {
    const idx = allWaitlist.findIndex(w => w.clients?.id === clientId);
    if (idx < 0 || idx >= allWaitlist.length - 1) return;
    const curr = allWaitlist[idx];
    const next = allWaitlist[idx + 1];
    const posA = curr.position ?? idx + 1;
    const posB = next.position ?? idx + 2;
    await Promise.all([
        db.from('waitlist').update({ position: posB }).eq('client_id', curr.client_id),
        db.from('waitlist').update({ position: posA }).eq('client_id', next.client_id),
    ]);
    await loadWaitlist();
    renderWaitlist();
}

async function wlRemove(clientId) {
    const entry = allWaitlist.find(w => w.clients?.id === clientId);
    if (!entry) return;
    const name = `${entry.clients?.first_name || ''} ${entry.clients?.last_name || ''}`.trim();
    if (!await customConfirm(`Rimuovere ${name} dalla lista d'attesa?`)) return;
    await db.from('waitlist').update({ active: false }).eq('client_id', entry.client_id);
    await loadWaitlist();
    renderWaitlist();
    showToast('Cliente rimosso dalla lista d\'attesa.');
}

// ── Modal "Aggiungi a lista attesa" ──────────────────────────────────────────
function openAddToWaitlistModal() {
    document.getElementById('wlModalSearch').value = '';
    document.getElementById('wlModalClientList').innerHTML = '';
    document.getElementById('wlModalMsg').textContent = '';
    document.getElementById('wlModalSelectedClient').textContent = '';
    document.getElementById('addToWaitlistModal').style.display = 'flex';
    setTimeout(() => document.getElementById('wlModalSearch').focus(), 50);
}

function closeAddToWaitlistModal() {
    document.getElementById('addToWaitlistModal').style.display = 'none';
}

let _wlSelectedClientId = null;

function filterWlClients() {
    const q = (document.getElementById('wlModalSearch').value || '').toLowerCase().trim();
    const inWl = new Set(allWaitlist.map(w => w.client_id));
    const filtered = allClients.filter(c => {
        if (inWl.has(c.id)) return false;
        if (!q) return true;
        return (`${c.first_name} ${c.last_name} ${c.last_name} ${c.first_name}`).toLowerCase().includes(q);
    }).sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''));
    const list = document.getElementById('wlModalClientList');
    if (filtered.length === 0) {
        list.innerHTML = '<div style="padding:8px;color:#666;font-size:0.82rem;">Nessun risultato</div>';
        return;
    }
    list.innerHTML = filtered.slice(0, 8).map(c => {
        const displayName = `${c.last_name || ''} ${c.first_name || ''}`.trim();
        return `
        <div class="wl-modal-client-row" onclick="selectWlClient('${c.id}','${displayName.replace(/'/g,"\\'")}')">
            ${displayName}
        </div>`;
    }).join('');
}

function selectWlClient(id, name) {
    _wlSelectedClientId = id;
    document.getElementById('wlModalSelectedClient').textContent = name;
    document.getElementById('wlModalClientList').innerHTML = '';
    document.getElementById('wlModalSearch').value = name;
}

async function saveAddToWaitlist() {
    const clientId = _wlSelectedClientId;
    const msg = document.getElementById('wlModalMsg');
    if (!clientId) { msg.textContent = 'Seleziona un cliente.'; return; }

    const maxPos = allWaitlist.reduce((m, w) => Math.max(m, w.position ?? 0), 0);
    const { error } = await db.from('waitlist').upsert(
        { client_id: clientId, active: true, position: maxPos + 1 },
        { onConflict: 'client_id' }
    );
    if (error) { msg.textContent = 'Errore: ' + error.message; return; }
    closeAddToWaitlistModal();
    await loadWaitlist();
    renderWaitlist();
    showToast('Cliente aggiunto alla lista d\'attesa.');
}

// ── Richieste da clienti ──────────────────────────────────────────────────────
function renderWlRequests() {
    const banner = document.getElementById('wlRequestsBanner');
    if (!banner) return;
    if (!allWaitlistRequests || allWaitlistRequests.length === 0) {
        banner.innerHTML = '';
        return;
    }
    banner.innerHTML = `
        <div class="wl-requests-banner">
            <div style="font-size:0.82rem;font-weight:600;color:#D4AF37;margin-bottom:8px;">
                <i class="fas fa-bell" style="margin-right:6px;"></i>Richieste in attesa (${allWaitlistRequests.length})
            </div>
            ${allWaitlistRequests.map(r => {
                const client = r.clients || {};
                const name = `${client.first_name || ''} ${client.last_name || ''}`.trim() || '—';
                const typeLabel = r.request_type === 'join' ? 'entrare in lista' : 'uscire dalla lista';
                return `
                <div class="wl-req-item">
                    <div style="flex:1;">
                        <span style="font-size:0.85rem;font-weight:500;color:#eee;">${name}</span>
                        <span style="font-size:0.78rem;color:#999;margin-left:8px;">vuole ${typeLabel}</span>
                    </div>
                    <div style="display:flex;gap:6px;">
                        <button class="wl-action-btn" style="font-size:0.78rem;padding:0 10px;width:auto;" onclick="approveWlRequest('${r.id}')">✓ Approva</button>
                        <button class="wl-action-btn danger" style="font-size:0.78rem;padding:0 10px;width:auto;" onclick="denyWlRequest('${r.id}')">✗ Nega</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
}

async function approveWlRequest(requestId) {
    const req = allWaitlistRequests.find(r => r.id === requestId);
    if (!req) return;
    const clientId = req.client_id;
    if (req.request_type === 'join') {
        const { error: e1 } = await db.from('waitlist').upsert(
            { client_id: clientId, active: true, position: 0 },
            { onConflict: 'client_id' }
        );
        if (e1) { showToast('Errore nell\'approvazione: ' + e1.message, 4000, true); return; }
    } else {
        const { error: e1 } = await db.from('waitlist').update({ active: false }).eq('client_id', clientId);
        if (e1) { showToast('Errore nell\'approvazione: ' + e1.message, 4000, true); return; }
    }
    const { error: e2 } = await db.from('waitlist_requests').update({ status: 'approved', resolved_at: new Date().toISOString() }).eq('id', requestId);
    if (e2) { showToast('Errore aggiornamento richiesta: ' + e2.message, 4000, true); return; }
    // notifica cliente via n8n
    fetch(WL_NOTIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, action: 'approved', client_id: clientId, request_type: req.request_type }),
    }).catch(() => showToast('Approvata, ma notifica email non inviata.', 4000, true));
    allWaitlistRequests = allWaitlistRequests.filter(r => r.id !== requestId);
    updateNotifBadge();
    await loadWaitlist();
    renderWaitlist();
    renderWlRequests();
    showToast('Richiesta approvata.');
}

async function denyWlRequest(requestId) {
    const req = allWaitlistRequests.find(r => r.id === requestId);
    if (!req) return;
    const { error } = await db.from('waitlist_requests').update({ status: 'denied', resolved_at: new Date().toISOString() }).eq('id', requestId);
    if (error) { showToast('Errore: ' + error.message, 4000, true); return; }
    fetch(WL_NOTIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, action: 'denied', client_id: req.client_id, request_type: req.request_type }),
    }).catch(() => showToast('Negata, ma notifica email non inviata.', 4000, true));
    allWaitlistRequests = allWaitlistRequests.filter(r => r.id !== requestId);
    updateNotifBadge();
    renderWlRequests();
    showToast('Richiesta negata.');
}

// ============================================
// NAVIGATION
// ============================================
function navigateTo(section) {
    document.querySelectorAll('.admin-nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    const btn = document.querySelector(`.admin-nav-item[data-section="${section}"]`);
    if (btn) btn.classList.add('active');
    const sec = document.getElementById('section-' + section);
    if (sec) sec.classList.add('active');
    // Lock admin-main scroll when assistente is active (input bar must stay fixed)
    const main = document.querySelector('.admin-main');
    if (main) main.classList.toggle('aa-lock', section === 'assistente');
    if (section === 'calendar')     renderCalendar();
    if (section === 'analytics')    renderAnalytics();
    if (section === 'portfolio')    loadPortfolioAdmin();
    if (section === 'vouchers')     loadAllVouchersAdmin();
    if (section === 'lista-attesa') { renderWaitlist(); renderWlRequests(); }
}

function setupNavigation() {
    document.querySelectorAll('.admin-nav-item').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.section));
    });
}

// ============================================
// OVERVIEW
// ============================================
function renderOverview() {
    document.getElementById('statTotalClients').textContent = allClients.length;

    const now = new Date();
    const thisMonth = allAppointments.filter(a => {
        const d = new Date(a.scheduled_at);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    document.getElementById('statThisMonth').textContent = thisMonth.length;

    const pending = allAppointments.filter(a => a.status === 'pending');
    document.getElementById('statPending').textContent = pending.length;
    document.getElementById('statWaitlist').textContent = allWaitlist.length;

    // Prossimi appuntamenti (futuri, non cancellati)
    const upcoming = allAppointments
        .filter(a => new Date(a.scheduled_at) >= now && a.status !== 'cancelled')
        .slice(0, 8);

    const list = document.getElementById('upcomingList');
    if (upcoming.length === 0) {
        list.innerHTML = '<div class="empty-state">Nessun appuntamento futuro</div>';
        return;
    }

    const BTN_BASE = 'display:inline-flex;align-items:center;justify-content:center;width:46px;height:32px;border-radius:7px;cursor:pointer;font-size:1.04rem;border:1px solid;transition:opacity .15s;';
    const BTN_GOLD = BTN_BASE + 'background:rgba(212,175,55,0.12);border-color:rgba(212,175,55,0.4);color:#D4AF37;';
    const BTN_RED  = BTN_BASE + 'background:rgba(248,113,113,0.1);border-color:rgba(248,113,113,0.35);color:#f87171;';

    list.innerHTML = upcoming.map(a => {
        const client    = a.clients;
        const name      = client ? `${client.first_name} ${client.last_name}` : '—';
        const date      = formatDate(a.scheduled_at);
        const time      = formatTime(a.scheduled_at);
        const safeEmail    = (client?.email || '').replace(/'/g, "\\'");
        const safeName     = name.replace(/'/g, "\\'");
        const safeDate     = (a.scheduled_at || '').replace(/'/g, "\\'");
        const safeClientId = (client?.id || '').replace(/'/g, "\\'");
        return `
        <div class="upcoming-item" onclick="openClientDetail('${safeClientId}')" style="cursor:pointer;">
            <div style="min-width:80px;text-align:center;flex-shrink:0;">
                <div style="font-size:0.78rem;font-weight:600;color:var(--gold);">${date}</div>
                <div style="font-size:0.72rem;color:#fff;font-weight:500;margin-top:3px;text-transform:uppercase;">${typeLabel(a.type)}</div>
                <div style="font-size:0.72rem;color:#888;margin-top:2px;">${time}</div>
            </div>
            <div style="flex:1;text-align:center;min-width:0;">
                <div class="upcoming-name" style="flex:unset;">${name}</div>
                ${a.type === 'seduta' ? sedutaOrderChip(a.id, a.client_id) : ''}
                ${(() => { const cm = cmodLabel(a.consultation_mode); const pm = a.payment_method && a.payment_method !== 'undefined' && a.payment_method !== 'null' ? a.payment_method : null; return ['consulenza','pre-seduta'].includes(a.type) && (cm || pm) ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px;justify-content:center;">${cm ? `<span style="font-size:0.72rem;background:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.3);color:#D4AF37;padding:0 6px;height:26px;display:inline-flex;align-items:center;box-sizing:border-box;border-radius:4px;white-space:nowrap;"><i class="${cm.icon}" style="margin-right:4px;"></i>${cm.label}</span>` : ''}${pm ? `<span style="font-size:0.72rem;background:rgba(255,255,255,0.05);border:1px solid #333;color:#aaa;padding:0 6px;height:26px;display:inline-flex;align-items:center;box-sizing:border-box;border-radius:4px;white-space:nowrap;"><i class="fas fa-credit-card" style="margin-right:4px;"></i>${pm}</span>` : ''}</div>` : ''; })()}
                ${a.type === 'pre-seduta' && a.notes ? `<div style="font-size:0.72rem;color:#aaa;margin-top:3px;font-style:italic;text-align:center;">"${a.notes}"</div>` : ''}
            </div>
            <div style="margin-left:auto;display:flex;flex-direction:column;align-items:center;gap:5px;">
                ${badgeHtmlWithRsch(a.id, a.status, a.scheduled_at)}
                <div style="display:flex;gap:4px;">
                    <button title="Proponi nuova data" onclick="event.stopPropagation();openIreneRescheduleModal('${a.id}','${client?.id || ''}','${safeEmail}','${safeName}','${a.type}')" style="${BTN_GOLD}"><i class="fas fa-clock"></i></button>
                    <button title="Annulla" onclick="event.stopPropagation();openCancelModal('${a.id}','${safeEmail}','${safeName}','${safeDate}')" style="${BTN_RED}"><i class="fas fa-times"></i></button>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ============================================
// CLIENTS TABLE
// ============================================
function setupSearch() {
    const input   = document.getElementById('clientSearch');
    const clearBtn = document.getElementById('clearSearch');

    input.addEventListener('input', () => {
        const q = input.value.trim();
        clearBtn.style.display = q ? 'block' : 'none';
        const filtered = filterClients(q);
        renderClientsTable(filtered);
    });

    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.style.display = 'none';
        renderClientsTable(allClients);
    });
}

function filterClients(query) {
    if (!query) return allClients;
    const q = query.toLowerCase();
    return allClients.filter(c =>
        (`${c.first_name} ${c.last_name}`).toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q)
    );
}

function renderClientsTable(clients) {
    const container = document.getElementById('clientsTable');

    // Ordine alfabetico per cognome, poi nome
    clients = [...clients].sort((a, b) => {
        const la = (a.last_name || '').toLowerCase();
        const lb = (b.last_name || '').toLowerCase();
        if (la !== lb) return la.localeCompare(lb, 'it');
        return (a.first_name || '').toLowerCase().localeCompare((b.first_name || '').toLowerCase(), 'it');
    });

    if (clients.length === 0) {
        container.innerHTML = '<div class="empty-state">Nessun cliente trovato</div>';
        return;
    }

    // Conta appuntamenti per cliente
    const apptCount = {};
    allAppointments.forEach(a => {
        apptCount[a.client_id] = (apptCount[a.client_id] || 0) + 1;
    });

    container.innerHTML = `
    <table class="clients-table">
        <thead>
            <tr>
                <th>Cognome e Nome</th>
                <th></th>
            </tr>
        </thead>
        <tbody>
            ${clients.map(c => `
            <tr data-id="${c.id}">
                <td class="client-name-cell">${c.last_name || ''} ${c.first_name || ''}</td>
                <td><button class="btn-view" data-id="${c.id}">Dettaglio</button></td>
            </tr>`).join('')}
        </tbody>
    </table>`;

    container.querySelectorAll('.btn-view').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            openClientDetail(btn.dataset.id);
        });
    });

    container.querySelectorAll('tbody tr').forEach(row => {
        row.addEventListener('click', () => openClientDetail(row.dataset.id));
    });
}

// ============================================
// NUOVO CLIENTE
// ============================================
function openNewClientModal() {
    ['ncFirstName','ncLastName','ncEmail','ncPhone'].forEach(id => document.getElementById(id).value = '');
    const prefixEl = document.getElementById('ncPhonePrefix');
    if (prefixEl) prefixEl.value = '+39';
    document.getElementById('ncMsg').textContent = '';
    const btn = document.getElementById('ncSaveBtn');
    btn.disabled = false; btn.textContent = 'Crea cliente';
    document.getElementById('newClientModal').style.display = 'flex';
    setTimeout(() => document.getElementById('ncFirstName').focus(), 50);
}
function closeNewClientModal() {
    document.getElementById('newClientModal').style.display = 'none';
}
async function saveNewClient() {
    const first  = document.getElementById('ncFirstName').value.trim();
    const last   = document.getElementById('ncLastName').value.trim();
    const email  = document.getElementById('ncEmail').value.trim();
    const prefix = document.getElementById('ncPhonePrefix')?.value || '+39';
    const num    = document.getElementById('ncPhone').value.trim();
    const phone  = num ? (prefix + num.replace(/\s/g, '')) : '';
    const msg    = document.getElementById('ncMsg');
    const btn    = document.getElementById('ncSaveBtn');
    if (!first || !last || !email || !num) { msg.textContent = 'Compila tutti i campi obbligatori.'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'Inserisci un\'email valida.'; return; }
    btn.disabled = true; btn.textContent = 'Creazione account…';
    try {
        const resp = await fetch(ADMIN_CREATE_CLIENT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ first_name: first, last_name: last, email, phone }),
        });
        const result = await resp.json().catch(() => ({}));
        if (!resp.ok || result.error) {
            throw new Error(result.message || result.error || `Errore ${resp.status}`);
        }
        closeNewClientModal();
        await loadClients();
        renderClientsTable(allClients);
        showToast('Cliente creato! Email di benvenuto inviata.');
    } catch (err) {
        msg.textContent = 'Errore: ' + err.message;
        btn.disabled = false; btn.textContent = 'Crea cliente';
    }
}

// ============================================
// CREA APPUNTAMENTO
// ============================================
const ADMIN_CREATE_CLIENT_URL = 'https://n8n.srv1204993.hstgr.cloud/webhook/admin-crea-cliente';
const ADMIN_CREATE_APPT_URL   = 'https://n8n.srv1204993.hstgr.cloud/webhook/admin-create-appointment';
const ADMIN_CAL_EVENT_IDS   = { 'consulenza': 5147645, 'pre-seduta': 5147653, 'seduta': 5147823 };
const CAL_API_TOKEN         = 'cal_live_c63016ee51343f3492c2759c4a0d5c93';

let _caCtx = {
    clientId: null, clientName: null, clientEmail: null, clientPhone: null,
    type: null, accontoMethod: null,
    date: null, time: null, slotISO: null, consultPaymentMethod: null,
    location: null, isFirstSession: null,
};
let _caCal = { year: new Date().getFullYear(), month: new Date().getMonth() };

function openCreateApptModal(prefillClientId = null) {
    _caCtx = { clientId: null, clientName: null, clientEmail: null, clientPhone: null, type: null, accontoMethod: null, date: null, time: null, slotISO: null, consultPaymentMethod: null, location: null, isFirstSession: null };
    _caCal = { year: new Date().getFullYear(), month: new Date().getMonth() };
    // reset form
    document.getElementById('caClientSearch').value = '';
    document.getElementById('caClientChip').style.display = 'none';
    document.getElementById('caSearchWrap').style.display = 'block';
    document.getElementById('caClientDropdown').style.display = 'none';
    document.getElementById('caWarning').style.display = 'none';
    document.getElementById('caAccontoSection').style.display      = 'none';
    document.getElementById('caConsulenzaPayment').style.display   = 'none';
    document.getElementById('caLocationSection').style.display     = 'none';
    document.getElementById('caFirstSessionSection').style.display = 'none';
    document.getElementById('caSlotSection').style.display         = 'none';
    document.getElementById('caSlotGrid').innerHTML              = '';
    document.getElementById('caNote').value = '';
    document.getElementById('caIdea').value = '';
    document.getElementById('caIdeaSection').style.display = 'none';
    document.getElementById('caMsg').textContent = '';
    document.getElementById('caAccontoAmount').value = '50';
    setAccontoMethod(null);
    ['consulenza','preseduta','seduta'].forEach(t => {
        const el = document.getElementById('caType' + (t === 'preseduta' ? 'Preseduta' : t.charAt(0).toUpperCase() + t.slice(1)));
        if (el) { el.style.background = 'transparent'; el.style.borderColor = '#333'; el.style.color = '#888'; }
    });
    const btn = document.getElementById('caSubmitBtn');
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-calendar-check" style="margin-right:6px;"></i>Crea Appuntamento';
    // pre-compila cliente se fornito
    if (prefillClientId) {
        const c = allClients.find(cl => cl.id === prefillClientId);
        if (c) {
            _caCtx.clientId    = c.id;
            _caCtx.clientName  = `${c.first_name} ${c.last_name}`;
            _caCtx.clientEmail = c.email || '';
            _caCtx.clientPhone = c.phone || '';
            document.getElementById('caClientChipName').textContent = _caCtx.clientName;
            document.getElementById('caClientChip').style.display = 'block';
            document.getElementById('caSearchWrap').style.display = 'none';
        }
    }
    renderCaCalendar();
    document.getElementById('createApptModal').style.display = 'flex';
}

function closeCreateApptModal() {
    document.getElementById('createApptModal').style.display = 'none';
    document.getElementById('caClientDropdown').style.display = 'none';
}

function filterCreateApptClients() {
    const q = document.getElementById('caClientSearch').value.trim().toLowerCase();
    const dd = document.getElementById('caClientDropdown');
    _caCtx.clientId = null;
    if (!q) { dd.style.display = 'none'; return; }
    const matches = allClients.filter(c =>
        (`${c.first_name} ${c.last_name} ${c.last_name} ${c.first_name}`).toLowerCase().includes(q)
    ).sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '')).slice(0, 8);
    if (!matches.length) { dd.style.display = 'none'; return; }
    dd.innerHTML = matches.map(c => `
        <div onclick="selectCreateApptClient('${c.id}')"
            style="padding:8px 12px;cursor:pointer;font-size:0.85rem;border-bottom:1px solid #2a2a2a;"
            onmouseover="this.style.background='#2a2a2a'" onmouseout="this.style.background=''">
            <strong style="color:#fff;">${c.last_name || ''} ${c.first_name || ''}</strong>
        </div>`).join('');
    dd.style.display = 'block';
}

function selectCreateApptClient(clientId) {
    const c = allClients.find(cl => cl.id === clientId);
    if (!c) return;
    _caCtx.clientId    = c.id;
    _caCtx.clientName  = `${c.first_name} ${c.last_name}`;
    _caCtx.clientEmail = c.email || '';
    _caCtx.clientPhone = c.phone || '';
    document.getElementById('caClientDropdown').style.display = 'none';
    document.getElementById('caSearchWrap').style.display = 'none';
    document.getElementById('caClientChipName').textContent = _caCtx.clientName;
    document.getElementById('caClientChip').style.display = 'block';
    updateCreateApptWarning();
}

function selectCreateApptType(type) {
    _caCtx.type = type;
    // stile bottoni
    const map = { consulenza: 'caTypeConsulenza', 'pre-seduta': 'caTypePreseduta', seduta: 'caTypeSeduta' };
    Object.entries(map).forEach(([t, id]) => {
        const el = document.getElementById(id);
        if (!el) return;
        const active = t === type;
        el.style.background     = active ? 'rgba(212,175,55,0.15)' : 'transparent';
        el.style.borderColor    = active ? 'rgba(212,175,55,0.6)'  : '#333';
        el.style.color          = active ? '#D4AF37'               : '#888';
    });
    document.getElementById('caAccontoSection').style.display       = type === 'seduta'                          ? 'block' : 'none';
    document.getElementById('caFirstSessionSection').style.display  = type === 'seduta'                          ? 'block' : 'none';
    document.getElementById('caConsulenzaPayment').style.display    = type === 'consulenza'                      ? 'block' : 'none';
    document.getElementById('caLocationSection').style.display      = ['consulenza','pre-seduta'].includes(type) ? 'block' : 'none';
    document.getElementById('caIdeaSection').style.display          = type === 'consulenza'                      ? 'block' : 'none';
    if (document.getElementById('caIdea')) document.getElementById('caIdea').value = '';
    // reset campi tipo-specifici se cambia tipo
    _caCtx.time = null; _caCtx.slotISO = null; _caCtx.location = null; _caCtx.isFirstSession = null;
    // reset UI location
    ['caLocWhatsapp','caLocInPerson'].forEach(id => {
        const el = document.getElementById(id); if (!el) return;
        el.style.background = 'transparent'; el.style.borderColor = '#333'; el.style.color = '#888';
    });
    // Auto-detect prima seduta dal DB
    if (type === 'seduta' && _caCtx.clientId) {
        const existingSedute = allAppointments.filter(a =>
            a.client_id === _caCtx.clientId && a.type === 'seduta' && a.status !== 'cancelled'
        );
        setCaFirstSession(existingSedute.length === 0);
    }
    fetchAdminSlots();
    updateCreateApptWarning();
}

function updateCreateApptWarning() {
    const warn = document.getElementById('caWarning');
    if (!_caCtx.clientId || !_caCtx.type) { warn.style.display = 'none'; return; }
    const clientAppts = allAppointments.filter(a => a.client_id === _caCtx.clientId && a.status !== 'cancelled');
    let msg = '';
    let isWarn = false;
    if (_caCtx.type === 'consulenza') {
        if (clientAppts.some(a => a.type === 'consulenza')) {
            msg = '⚠️ Questo cliente ha già una consulenza registrata.'; isWarn = true;
        }
    } else if (_caCtx.type === 'pre-seduta') {
        if (clientAppts.some(a => a.type === 'pre-seduta')) {
            msg = '⚠️ Questo cliente ha già una pre-seduta registrata.'; isWarn = true;
        }
        const firstSeduta = clientAppts.filter(a => a.type === 'seduta')
            .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0];
        if (firstSeduta) {
            const ds = new Date(firstSeduta.scheduled_at).toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' });
            msg += (msg ? '\n' : '') + `ℹ️ Prima seduta il ${ds} — consigliato prenotare almeno 20 giorni prima.`;
        }
    }
    if (msg) {
        warn.style.display = 'block';
        warn.style.background = isWarn ? 'rgba(248,113,113,0.08)' : 'rgba(212,175,55,0.06)';
        warn.style.border = `1px solid ${isWarn ? 'rgba(248,113,113,0.3)' : 'rgba(212,175,55,0.25)'}`;
        warn.style.color = isWarn ? '#f87171' : '#D4AF37';
        warn.style.whiteSpace = 'pre-line';
        warn.textContent = msg;
    } else {
        warn.style.display = 'none';
    }
}

function setAccontoMethod(method) {
    // method: 'pos' | 'contanti' | null
    _caCtx.accontoMethod = method;
    const btnPos      = document.getElementById('caBtnPos');
    const btnContanti = document.getElementById('caBtnContanti');
    const btnNone     = document.getElementById('caBtnAccNone');
    const amountRow   = document.getElementById('caAccontoAmountRow');

    const styles = {
        pos:      { bg: 'rgba(99,179,237,0.15)', border: 'rgba(99,179,237,0.5)',  color: '#63b3ed' },
        contanti: { bg: 'rgba(109,192,124,0.15)', border: 'rgba(109,192,124,0.5)', color: '#6dc07c' },
        none:     { bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.4)', color: '#f87171' },
        off:      { bg: 'transparent', border: '#444', color: '#888' },
    };
    const applyStyle = (btn, s) => { btn.style.background = s.bg; btn.style.borderColor = s.border; btn.style.color = s.color; };

    applyStyle(btnPos,      method === 'pos'      ? styles.pos      : styles.off);
    applyStyle(btnContanti, method === 'contanti' ? styles.contanti : styles.off);
    applyStyle(btnNone,     method === null        ? styles.none     : styles.off);
    amountRow.style.display = method ? 'flex' : 'none';
}


function changeCreateApptClient() {
    _caCtx.clientId = null; _caCtx.clientName = null; _caCtx.clientEmail = null; _caCtx.clientPhone = null;
    document.getElementById('caClientChip').style.display = 'none';
    document.getElementById('caSearchWrap').style.display = 'block';
    document.getElementById('caClientSearch').value = '';
    document.getElementById('caClientSearch').focus();
    document.getElementById('caWarning').style.display = 'none';
}

// ── CA DATE PICKER ────────────────────────────────────────
function toggleCaDatePicker() { /* calendario sempre visibile */ }

function renderCaCalendar() {
    const { year: y, month: m } = _caCal;
    const today = new Date(); today.setHours(0,0,0,0);
    const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    document.getElementById('caCalMonthLabel').textContent = `${monthNames[m]} ${y}`;
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const offset = firstDay === 0 ? 6 : firstDay - 1;
    let html = ['L','M','M','G','V','S','D'].map(d =>
        `<div style="text-align:center;font-size:0.7rem;color:#555;padding:4px 0;">${d}</div>`).join('');
    for (let i = 0; i < offset; i++) html += '<div></div>';
    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(y, m, d); date.setHours(0,0,0,0);
        const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const past = date < today;
        const sel  = _caCtx && _caCtx.date === ds;
        if (past) {
            html += `<div style="text-align:center;padding:6px 2px;font-size:0.8rem;color:#333;border-radius:6px;">${d}</div>`;
        } else if (sel) {
            html += `<div onclick="selectCaDate('${ds}')" style="text-align:center;padding:6px 2px;font-size:0.8rem;background:#D4AF37;color:#000;border-radius:6px;font-weight:700;cursor:pointer;">${d}</div>`;
        } else {
            html += `<div onclick="selectCaDate('${ds}')" onmouseover="this.style.background='rgba(212,175,55,0.12)';this.style.color='#D4AF37'" onmouseout="this.style.background='';this.style.color='#ccc'" style="text-align:center;padding:6px 2px;font-size:0.8rem;color:#ccc;border-radius:6px;cursor:pointer;">${d}</div>`;
        }
    }
    document.getElementById('caCalGrid').innerHTML = html;
}

function caMoveMonth(dir) {
    _caCal.month += dir;
    if (_caCal.month > 11) { _caCal.month = 0; _caCal.year++; }
    if (_caCal.month < 0)  { _caCal.month = 11; _caCal.year--; }
    renderCaCalendar();
}

function selectCaDate(ds) {
    if (!_caCtx) return;
    _caCtx.date = ds;
    _caCtx.time = null; _caCtx.slotISO = null;
    renderCaCalendar();
    fetchAdminSlots();
}

// ── CA TIME WHEEL (non più usato, slot da Cal.com) ────────
function toggleCaTimePicker() { /* sostituito da fetchAdminSlots */ }

function buildCaWheels() {
    const hours = [];
    for (let h = 8; h <= 20; h++) hours.push(String(h).padStart(2,'0'));
    const mins = ['00','15','30','45'];
    const ITEM_H = 36;
    const hourCol = document.getElementById('caWheelHour');
    const minCol  = document.getElementById('caWheelMin');
    const makeItems = items =>
        `<div style="height:${ITEM_H}px;"></div>` +
        items.map(v => `<div class="ca-wheel-item">${v}</div>`).join('') +
        `<div style="height:${ITEM_H}px;"></div>`;
    hourCol.innerHTML = makeItems(hours);
    minCol.innerHTML  = makeItems(mins);

    // Evidenzia visivamente l'item centrato
    const highlightItems = (col, idx) => {
        const items = col.querySelectorAll('.ca-wheel-item');
        items.forEach((el, i) => {
            el.style.color      = i === idx ? '#D4AF37' : '#555';
            el.style.fontWeight = i === idx ? '700'     : '500';
            el.style.fontSize   = i === idx ? '1.25rem' : '1.2rem';
        });
    };

    const update = () => {
        const hIdx = Math.min(Math.round(hourCol.scrollTop / ITEM_H), hours.length - 1);
        const mIdx = Math.min(Math.round(minCol.scrollTop  / ITEM_H), mins.length  - 1);
        const h  = hours[hIdx] || '10';
        const mm = mins[mIdx]  || '00';
        if (!_caCtx) return;
        _caCtx.time = `${h}:${mm}`;
        document.getElementById('caTimeText').textContent = `${h}:${mm}`;
        document.getElementById('caTimeDisplay').style.color = '#fff';
        highlightItems(hourCol, hIdx);
        highlightItems(minCol,  mIdx);
    };

    hourCol.onscroll = update;
    minCol.onscroll  = update;

    // posizione iniziale — requestAnimationFrame per aspettare il layout
    let hIdx = hours.indexOf('10'), mIdx = 0;
    if (_caCtx && _caCtx.time) {
        const [hh, mm] = _caCtx.time.split(':');
        const hi = hours.indexOf(hh.padStart(2,'0'));
        const mi = mins.indexOf(mm);
        if (hi >= 0) hIdx = hi;
        if (mi >= 0) mIdx = mi;
    }
    requestAnimationFrame(() => {
        hourCol.scrollTop = hIdx * ITEM_H;
        minCol.scrollTop  = mIdx * ITEM_H;
        update();
    });
}

// ── SLOT FETCHING ──────────────────────────────────────────
async function fetchAdminSlots() {
    if (!_caCtx.date || !_caCtx.type) return;
    const eventTypeId = ADMIN_CAL_EVENT_IDS[_caCtx.type];
    if (!eventTypeId) return;

    const slotSection = document.getElementById('caSlotSection');
    const slotStatus  = document.getElementById('caSlotStatus');
    const slotGrid    = document.getElementById('caSlotGrid');
    slotSection.style.display = 'block';
    slotStatus.textContent    = 'Caricamento disponibilità...';
    slotGrid.innerHTML        = '';

    const date     = _caCtx.date;
    const startISO = date + 'T00:00:00.000Z';
    const nextDate = new Date(date + 'T00:00:00'); nextDate.setDate(nextDate.getDate() + 1);
    const endISO   = nextDate.toISOString().slice(0, 10) + 'T23:59:59.000Z';
    // usa proxy n8n (evita CORS) — risposta v1: { slots: { "YYYY-MM-DD": [{time},...] } }
    const proxyUrl = `https://n8n.srv1204993.hstgr.cloud/webhook/cal-slots?eventTypeId=${eventTypeId}&startTime=${encodeURIComponent(startISO)}&endTime=${encodeURIComponent(endISO)}&timeZone=Europe%2FRome`;

    try {
        const res  = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const slotsObj = json?.slots || {};
        const allSlots = Object.values(slotsObj).flat();

        if (!allSlots.length) {
            slotStatus.textContent = 'Nessuna disponibilità per questa data.';
            return;
        }

        slotStatus.textContent = 'Seleziona un orario:';
        slotGrid.innerHTML = allSlots.map(s => {
            const localTime = new Date(s.time).toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Rome' });
            return `<button onclick="selectAdminSlot('${localTime}','${s.time}')"
                style="padding:6px 14px;border-radius:6px;cursor:pointer;font-size:0.82rem;border:1px solid #333;background:transparent;color:#aaa;transition:.12s;"
                onmouseover="this.style.borderColor='rgba(212,175,55,0.5)';this.style.color='#D4AF37'"
                onmouseout="if(!this.dataset.sel){this.style.borderColor='#333';this.style.color='#aaa';}"
                >${localTime}</button>`;
        }).join('');
    } catch(e) {
        slotStatus.textContent = 'Errore caricamento slot. Verifica connessione.';
        console.error('[fetchAdminSlots]', e);
    }
}

function selectAdminSlot(localTime, isoTime) {
    _caCtx.time    = localTime;
    _caCtx.slotISO = isoTime;
    // evidenzia slot selezionato
    document.querySelectorAll('#caSlotGrid button').forEach(btn => {
        const sel = btn.textContent.trim() === localTime;
        btn.dataset.sel        = sel ? '1' : '';
        btn.style.background   = sel ? 'rgba(212,175,55,0.15)' : 'transparent';
        btn.style.borderColor  = sel ? 'rgba(212,175,55,0.6)'  : '#333';
        btn.style.color        = sel ? '#D4AF37'               : '#aaa';
    });
}

function setCaPaymentMethod(method) {
    _caCtx.consultPaymentMethod = method;
    const map = { contanti: 'caPayContanti', pos: 'caPayPos', gratuita: 'caPayGratuita' };
    Object.entries(map).forEach(([m, id]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const active = m === method;
        btn.style.background  = active ? 'rgba(212,175,55,0.15)' : 'transparent';
        btn.style.borderColor = active ? 'rgba(212,175,55,0.6)'  : '#333';
        btn.style.color       = active ? '#D4AF37'               : '#888';
    });
}

function setCaLocation(val) {
    _caCtx.location = val;
    const isWhatsapp = val === 'integrations:whatsapp_video';
    const wEl = document.getElementById('caLocWhatsapp');
    const pEl = document.getElementById('caLocInPerson');
    wEl.style.background  = isWhatsapp ? 'rgba(212,175,55,0.15)' : 'transparent';
    wEl.style.borderColor = isWhatsapp ? 'rgba(212,175,55,0.6)'  : '#333';
    wEl.style.color       = isWhatsapp ? '#D4AF37'               : '#888';
    pEl.style.background  = !isWhatsapp ? 'rgba(212,175,55,0.15)' : 'transparent';
    pEl.style.borderColor = !isWhatsapp ? 'rgba(212,175,55,0.6)'  : '#333';
    pEl.style.color       = !isWhatsapp ? '#D4AF37'               : '#888';
}

function setCaFirstSession(isFirst) {
    _caCtx.isFirstSession = isFirst;
    const btnPrima = document.getElementById('caBtnPrimaSeduta');
    const btnSucc  = document.getElementById('caBtnSedutaSucc');
    if (!btnPrima || !btnSucc) return;

    const goldOn  = { bg: 'rgba(212,175,55,0.15)', border: 'rgba(212,175,55,0.6)', color: '#D4AF37' };
    const greyOff = { bg: 'transparent', border: '#333', color: '#888' };

    const applyStyle = (btn, s) => {
        btn.style.background = s.bg; btn.style.borderColor = s.border; btn.style.color = s.color;
    };
    applyStyle(btnPrima, isFirst  ? goldOn : greyOff);
    applyStyle(btnSucc,  !isFirst ? goldOn : greyOff);
}

// ── SUBMIT ─────────────────────────────────────────────────
async function submitCreateAppt() {
    const msg = document.getElementById('caMsg');
    const btn = document.getElementById('caSubmitBtn');
    msg.textContent = '';
    if (!_caCtx.clientId)  { msg.textContent = 'Seleziona un cliente.'; return; }
    if (!_caCtx.type)      { msg.textContent = 'Seleziona il tipo di appuntamento.'; return; }
    if (['consulenza','pre-seduta'].includes(_caCtx.type) && !_caCtx.location) {
        msg.textContent = 'Seleziona la modalità (WhatsApp o In persona).'; return;
    }
    if (_caCtx.type === 'seduta' && _caCtx.isFirstSession === null) {
        msg.textContent = 'Indica se è prima seduta o seduta successiva.'; return;
    }
    const date = _caCtx.date;
    const time = _caCtx.time;
    if (!date) { msg.textContent = 'Seleziona una data.'; return; }
    if (!time) { msg.textContent = 'Seleziona un orario.'; return; }

    // Blocco unicità: consulenza e pre-seduta (max 1 per cliente)
    const _existingAppts = allAppointments.filter(a => a.client_id === _caCtx.clientId && a.status !== 'cancelled');
    if (_caCtx.type === 'consulenza' && _existingAppts.some(a => a.type === 'consulenza')) {
        msg.textContent = '⚠️ Questo cliente ha già una consulenza. Non è possibile crearne un\'altra.'; return;
    }
    if (_caCtx.type === 'pre-seduta' && _existingAppts.some(a => a.type === 'pre-seduta')) {
        msg.textContent = '⚠️ Questo cliente ha già una pre-seduta. Non è possibile crearne un\'altra.'; return;
    }
    if (_caCtx.type === 'seduta' && date) {
        const sameDaySeduta = _existingAppts.find(a =>
            a.type === 'seduta' && a.scheduled_at && a.scheduled_at.split('T')[0] === date
        );
        if (sameDaySeduta) {
            msg.textContent = `⚠️ Questo cliente ha già una seduta il ${date}. Non è possibile crearne due nello stesso giorno.`;
            return;
        }
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="margin-right:6px;"></i>Creazione…';

    // usa ISO dallo slot Cal.com se disponibile, altrimenti ricostruisce
    const scheduledAt = _caCtx.slotISO || new Date(`${date}T${time}:00`).toISOString();
    const ideaTatuaggio = (_caCtx.type === 'consulenza') ? document.getElementById('caIdea').value.trim() : '';
    if (_caCtx.type === 'consulenza' && !ideaTatuaggio) {
        msg.textContent = "Inserisci l'idea del tatuaggio.";
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus" style="margin-right:6px;"></i>Crea Appuntamento';
        return;
    }
    const notes = ideaTatuaggio || document.getElementById('caNote').value.trim();

    // acconto per seduta
    const accontoAmount = _caCtx.accontoMethod ? (parseInt(document.getElementById('caAccontoAmount').value) || 50) : 0;

    const insertData = {
        client_id:    _caCtx.clientId,
        type:         _caCtx.type,
        status:       'confirmed',
        scheduled_at: scheduledAt,
        ...(notes ? { notes } : {}),
        ...(_caCtx.type === 'seduta' ? {
            amount:                   50,
            amount_paid:              accontoAmount,
            acconto_payment_method:   _caCtx.accontoMethod || null,
        } : {}),
        ...(_caCtx.type === 'consulenza' && _caCtx.consultPaymentMethod ? {
            payment_method: _caCtx.consultPaymentMethod,
        } : {}),
        ...(['consulenza','pre-seduta'].includes(_caCtx.type) && _caCtx.location ? {
            consultation_mode: _caCtx.location,
        } : {}),
    };

    const { data: newAppt, error } = await db.from('appointments').insert(insertData).select('*, clients(id,first_name,last_name,email,phone)').single();
    if (error) { msg.textContent = 'Errore: ' + error.message; btn.disabled = false; btn.innerHTML = '<i class="fas fa-calendar-check" style="margin-right:6px;"></i>Crea Appuntamento'; return; }

    // aggiorna memoria
    allAppointments.push(newAppt);

    // fire-and-forget n8n: Cal.com + email
    fetch(ADMIN_CREATE_APPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            appointment_id:   newAppt.id,
            client_id:        _caCtx.clientId,
            client_email:     _caCtx.clientEmail,
            client_name:      _caCtx.clientName,
            client_phone:     _caCtx.clientPhone,
            appointment_type:  _caCtx.type,
            scheduled_at:      scheduledAt,
            notes,
            is_first_session:  _caCtx.isFirstSession,
            location:          _caCtx.location,
        }),
    }).catch(e => console.warn('[admin-create-appt]', e));

    closeCreateApptModal();
    renderOverview();
    renderCalendar();
    // se siamo nel dettaglio di quel cliente, aggiorna la timeline
    if (_currentDetailClientId === _caCtx.clientId) {
        refreshClientDetailPayments(_caCtx.clientId);
    }
    showToast('Appuntamento creato!');
}

// ============================================
// CLIENT DETAIL
// ============================================
async function openClientDetail(clientId) {
    const client = allClients.find(c => c.id === clientId);
    if (!client) return;
    _currentDetailClientId = clientId;

    navigateTo('clients');
    document.getElementById('clientsView').style.display      = 'none';
    document.getElementById('clientDetail').style.display     = 'block';
    document.getElementById('clientsHeaderBtns').style.display = 'none';
    document.getElementById('clientDetailName').textContent =
        `${client.first_name || ''} ${client.last_name || ''}`;

    // Banner richiesta cancellazione account
    const deletionBanner = document.getElementById('clientDeletionBanner');
    if (deletionBanner) {
        if (client.deletion_requested_at) {
            const d = new Date(client.deletion_requested_at).toLocaleDateString('it-IT',
                { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            document.getElementById('clientDeletionBannerDate').textContent = `Richiesta il ${d}`;
            deletionBanner.style.display = 'block';
        } else {
            deletionBanner.style.display = 'none';
        }
    }

    // Info personali
    const waPhone = (client.phone || '').replace(/\D/g, '');
    document.getElementById('clientDetailInfo').innerHTML = `
        <div class="detail-info-row">
            <span class="detail-info-label">Nome</span>
            <span class="detail-info-value">${client.first_name || ''} ${client.last_name || ''}</span>
        </div>
        <div class="detail-info-row">
            <span class="detail-info-label">Email</span>
            <span class="detail-info-value">${client.email
                ? `<a href="mailto:${client.email}" class="detail-contact-link"><i class="fas fa-envelope"></i> ${client.email}</a>`
                : '—'}</span>
        </div>
        <div class="detail-info-row">
            <span class="detail-info-label">WhatsApp</span>
            <span class="detail-info-value">${client.phone
                ? `<a href="https://wa.me/${waPhone}" target="_blank" class="detail-contact-link detail-contact-wa"><i class="fab fa-whatsapp"></i> ${client.phone}</a>`
                : '—'}</span>
        </div>
        <div class="detail-info-row">
            <span class="detail-info-label">Cod. Fiscale</span>
            <span class="detail-info-value">${client.codice_fiscale
                ? `<span style="font-family:monospace; letter-spacing:1px; color:#D4AF37;">${client.codice_fiscale}</span>`
                : `<span style="color:var(--text-muted); font-style:italic;">Non ancora acquisito</span>`
            }</span>
        </div>`;

    // Lista d'attesa
    const wl = allWaitlist.find(w => w.client_id === clientId);
    const wlEl = document.getElementById('clientDetailWaitlist');
    if (wl?.active) {
        const pos = allWaitlist.findIndex(w => w.client_id === clientId) + 1;
        wlEl.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                <div style="display:flex;align-items:center;gap:8px;font-size:0.82rem;color:#e8e8e8;">
                    Lista d'attesa — Posizione <strong style="color:#D4AF37;">#${pos}</strong>
                </div>
                <button onclick="adminWlRemoveFromDetail('${clientId}')"
                    title="Rimuovi dalla lista"
                    style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:transparent;border:1px solid rgba(248,113,113,0.3);color:#f87171;border-radius:6px;cursor:pointer;font-size:0.72rem;flex-shrink:0;">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>`;
    } else {
        wlEl.innerHTML = '<div style="font-size:0.8rem;color:var(--text-muted);font-style:italic;">Non in lista prioritaria</div>';
    }

    refreshClientDetailPayments(clientId);

    // appts serve per la sezione "Idea tatuaggio" più sotto
    const appts = allAppointments.filter(a => a.client_id === clientId)
        .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));

    // Galleria
    const galleryEl = document.getElementById('clientDetailGallery');
    galleryEl.innerHTML = '<div class="admin-loading"><i class="fas fa-circle-notch fa-spin"></i></div>';

    const { data: photos } = await db
        .from('tattoo_gallery')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

    if (!photos || photos.length === 0) {
        galleryEl.innerHTML = '<div class="gallery-empty">Nessuna foto caricata</div>';
    } else {
        const imgTags = await Promise.all(photos.map(async p => {
            const { data: urlData } = await db.storage
                .from('client-gallery')
                .createSignedUrl(p.storage_path, 3600);
            const src = urlData?.signedUrl || '';
            const title = p.title || 'foto';
            return `
                <div class="admin-gallery-item">
                    <img src="${src}" alt="${title}" onclick="window.open(this.src)">
                    <a class="admin-gallery-download" href="${src}" download="${title}" title="Scarica foto">
                        <i class="fas fa-download"></i>
                    </a>
                </div>`;
        }));
        galleryEl.innerHTML = imgTags.join('');
    }

    // Idea tatuaggio (dall'ultima consulenza con notes)
    const ideaCard = document.getElementById('clientIdeaCard');
    const ideaEl   = document.getElementById('clientDetailIdea');
    if (ideaCard && ideaEl) {
        const latestIdea = appts
            .filter(a => a.type === 'consulenza' && a.notes)
            .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at))[0];
        if (latestIdea) {
            ideaCard.style.display = '';
            const d = new Date(latestIdea.scheduled_at);
            const dateStr = d.toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' });
            ideaEl.innerHTML = `
                <div style="background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.2);border-radius:10px;padding:14px 16px;">
                    <p style="margin:0;font-size:0.9rem;color:#e8e8e8;line-height:1.6;white-space:pre-wrap;">${latestIdea.notes}</p>
                    <p style="margin:8px 0 0;font-size:0.75rem;color:var(--text-muted);">Consulenza del ${dateStr}</p>
                </div>`;
        } else {
            ideaCard.style.display = 'none';
        }
    }

    // Voucher del cliente
    const vouchersEl = document.getElementById('clientDetailVouchers');
    if (vouchersEl) {
        vouchersEl.innerHTML = '<div class="admin-loading"><i class="fas fa-circle-notch fa-spin"></i></div>';
        const { data: clientVouchers } = await db
            .from('vouchers')
            .select('*')
            .or(`recipient_email.eq.${client.email},claimed_by_user_id.eq.${client.id}`)
            .order('created_at', { ascending: false });
        renderClientVouchers(clientVouchers || [], client);
    }

    const consensiEl = document.getElementById('clientDetailConsensi');
    if (consensiEl) {
        consensiEl.innerHTML = '<div class="admin-loading"><i class="fas fa-circle-notch fa-spin"></i></div>';
        const { data: consensi } = await db
            .from('consent_documents')
            .select('*')
            .or(`client_id.eq.${client.id},email.eq.${client.email}`)
            .order('created_at', { ascending: false });
        renderClientConsensi(consensi || []);
    }
}

async function renderClientConsensi(list) {
    const el = document.getElementById('clientDetailConsensi');
    if (!el) return;
    if (!list.length) {
        el.innerHTML = '<div class="empty-state" style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.85rem;">Nessun consenso</div>';
        return;
    }

    const rows = await Promise.all(list.map(async doc => {
        const date = doc.session_date
            ? new Date(doc.session_date + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })
            : new Date(doc.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });

        let linkHtml = `<span style="font-size:0.75rem;color:#555;">Nessun file</span>`;
        if (doc.storage_path) {
            const isDirectUrl = doc.storage_path.startsWith('http');
            if (isDirectUrl) {
                // Legacy: URL Google Drive salvato direttamente
                linkHtml = `<a href="${doc.storage_path}" target="_blank" rel="noopener"
                    style="font-size:0.78rem;padding:5px 12px;border-radius:6px;background:rgba(212,175,55,0.1);
                    border:1px solid rgba(212,175,55,0.35);color:var(--gold);text-decoration:none;white-space:nowrap;">
                    <i class="fas fa-file-pdf" style="margin-right:4px;"></i>Apri PDF
                   </a>`;
            } else {
                // Supabase Storage: genera signed URL valido 24h
                const { data: signed } = await db.storage
                    .from('consent-docs')
                    .createSignedUrl(doc.storage_path, 86400);
                const url = signed?.signedUrl || null;
                linkHtml = url
                    ? `<div style="display:flex;gap:6px;align-items:center;">
                        <a href="${url}" target="_blank" rel="noopener"
                            style="font-size:0.78rem;padding:5px 12px;border-radius:6px;background:rgba(212,175,55,0.1);
                            border:1px solid rgba(212,175,55,0.35);color:var(--gold);text-decoration:none;white-space:nowrap;">
                            <i class="fas fa-file-pdf" style="margin-right:4px;"></i>Apri PDF
                        </a>
                        <a href="${url}&download=" target="_blank" rel="noopener" title="Scarica PDF"
                            style="font-size:0.78rem;padding:5px 10px;border-radius:6px;background:rgba(212,175,55,0.1);
                            border:1px solid rgba(212,175,55,0.35);color:var(--gold);text-decoration:none;">
                            <i class="fas fa-download"></i>
                        </a>
                       </div>`
                    : `<span style="font-size:0.75rem;color:#555;">File non trovato</span>`;
            }
        }

        return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1e1e1e;">
            <div style="display:flex;align-items:center;gap:10px;">
                <i class="fas fa-file-signature" style="color:#D4AF37;font-size:1.1rem;"></i>
                <div style="font-size:0.85rem;color:#e0e0e0;font-weight:500;">Consenso del ${date}</div>
            </div>
            ${linkHtml}
        </div>`;
    }));

    el.innerHTML = rows.join('');
}

function closeClientDetail() {
    document.getElementById('clientDetail').style.display      = 'none';
    document.getElementById('clientsView').style.display       = 'block';
    document.getElementById('clientsHeaderBtns').style.display = 'flex';
}

// ============================================
// CALENDAR
// ============================================
let _calAnimating = false;

function animateCalendarMonth(direction) {
    if (_calAnimating) return;
    const grid  = document.getElementById('calGrid');
    const label = document.getElementById('calMonthYear');
    _calAnimating = true;
    const exitX  = direction > 0 ? '-60px' : '60px';
    const enterX = direction > 0 ? '60px'  : '-60px';
    // Slide out
    grid.style.transition  = 'transform 0.2s ease, opacity 0.2s ease';
    label.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
    grid.style.transform   = `translateX(${exitX})`;
    label.style.transform  = `translateX(${exitX})`;
    grid.style.opacity     = '0';
    label.style.opacity    = '0';
    setTimeout(() => {
        calDate.setMonth(calDate.getMonth() + direction);
        renderCalendar();
        // Posiziona dall'altro lato senza transizione
        grid.style.transition  = 'none';
        label.style.transition = 'none';
        grid.style.transform   = `translateX(${enterX})`;
        label.style.transform  = `translateX(${enterX})`;
        grid.style.opacity     = '0';
        label.style.opacity    = '0';
        // Forza reflow poi slide in
        grid.offsetHeight;
        grid.style.transition  = 'transform 0.22s ease, opacity 0.22s ease';
        label.style.transition = 'transform 0.22s ease, opacity 0.22s ease';
        grid.style.transform   = 'translateX(0)';
        label.style.transform  = 'translateX(0)';
        grid.style.opacity     = '1';
        label.style.opacity    = '1';
        setTimeout(() => {
            grid.style.transition  = '';
            grid.style.transform   = '';
            grid.style.opacity     = '';
            label.style.transition = '';
            label.style.transform  = '';
            label.style.opacity    = '';
            _calAnimating = false;
        }, 230);
    }, 200);
}

function setupCalendarControls() {
    document.getElementById('calPrev').addEventListener('click', () => animateCalendarMonth(-1));
    document.getElementById('calNext').addEventListener('click', () => animateCalendarMonth(1));

    // Swipe sul calendario per cambiare mese
    const calSection = document.getElementById('section-calendar');
    let _swipeStartX = 0;
    let _swipeStartY = 0;
    calSection.addEventListener('touchstart', e => {
        _swipeStartX = e.touches[0].clientX;
        _swipeStartY = e.touches[0].clientY;
    }, { passive: true });
    calSection.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - _swipeStartX;
        const dy = e.changedTouches[0].clientY - _swipeStartY;
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        animateCalendarMonth(dx < 0 ? 1 : -1);
    }, { passive: true });
}

function renderCalendar() {
    const year  = calDate.getFullYear();
    const month = calDate.getMonth();

    // Intestazione mese
    document.getElementById('calMonthYear').textContent =
        new Date(year, month, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

    // Appuntamenti del mese corrente (non cancellati)
    const monthAppts = allAppointments.filter(a => {
        const d = new Date(a.scheduled_at);
        return d.getFullYear() === year && d.getMonth() === month && a.status !== 'cancelled';
    });

    // Raggruppa per giorno
    const byDay = {};
    monthAppts.forEach(a => {
        const day = new Date(a.scheduled_at).getDate();
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(a);
    });

    // Calcola primo giorno del mese (lun=0)
    const firstDay = new Date(year, month, 1).getDay();
    const offset   = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth    = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const today = new Date();
    const grid  = document.getElementById('calGrid');
    grid.innerHTML = '';

    // Giorni del mese precedente
    for (let i = offset - 1; i >= 0; i--) {
        const day = document.createElement('div');
        day.className = 'cal-day other-month';
        day.textContent = daysInPrevMonth - i;
        grid.appendChild(day);
    }

    // Giorni del mese corrente
    for (let d = 1; d <= daysInMonth; d++) {
        const day  = document.createElement('div');
        const appts = byDay[d] || [];
        const isToday = today.getDate() === d && today.getMonth() === month && today.getFullYear() === year;
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isBlocked = isDateBlocked(dateStr);

        const isHoliday = typeof isItalianHoliday === 'function' && isItalianHoliday(dateStr);

        day.className = 'cal-day' +
            (isToday ? ' today' : '') +
            (isBlocked ? ' blocked-day' : '') +
            (isHoliday ? ' holiday' : '') +
            (appts.length > 0 ? ' has-appointments' : '') +
            (selectedCalDay === d ? ' selected' : '');

        day.innerHTML = `<span>${d}</span>
            ${appts.length > 0 ? `<div class="cal-dots">${appts.slice(0,4).map(() => '<div class="cal-dot"></div>').join('')}</div>` : ''}`;

        if (isHoliday) day.title = 'Giorno festivo';

        if (appts.length > 0) {
            day.addEventListener('click', () => showCalDayDetail(d, appts));
        }

        grid.appendChild(day);
    }

    // Giorni del mese successivo
    const totalCells = offset + daysInMonth;
    const remaining  = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remaining; d++) {
        const day = document.createElement('div');
        day.className = 'cal-day other-month';
        day.textContent = d;
        grid.appendChild(day);
    }

    // Nascondi dettaglio giorno quando si cambia mese
    document.getElementById('calDayDetail').style.display = 'none';
    selectedCalDay = null;
}

function showCalDayDetail(day, appts) {
    selectedCalDay = day;
    renderCalendar(); // aggiorna selected

    const detailEl = document.getElementById('calDayDetail');
    const year  = calDate.getFullYear();
    const month = calDate.getMonth();
    const dateStr = new Date(year, month, day).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    document.getElementById('calDayTitle').innerHTML =
        `<i class="fas fa-calendar-day"></i> ${dateStr}`;

    const sorted = [...appts].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

    document.getElementById('calDayAppointments').innerHTML = sorted.map(a => {
        const client    = a.clients;
        const name      = client ? `${client.first_name} ${client.last_name}` : '—';
        const safeEmail    = (client?.email || '').replace(/'/g, "\\'");
        const safeName     = name.replace(/'/g, "\\'");
        const safeDate     = (a.scheduled_at || '').replace(/'/g, "\\'");
        const safeClientId = (client?.id || '').replace(/'/g, "\\'");
        const isCancelled  = a.status === 'cancelled';
        return `
        <div class="cal-day-appt" onclick="openClientDetail('${safeClientId}')" style="cursor:pointer;">
            <div style="min-width:55px;flex-shrink:0;text-align:center;">
                <div class="cal-day-appt-time">${formatTime(a.scheduled_at)}</div>
                <div class="cal-day-appt-type" style="margin-top:3px;">${typeLabel(a.type)}</div>
            </div>
            <div style="flex:1;text-align:center;min-width:0;">
                <div class="cal-day-appt-name">${name}</div>
                ${a.type === 'seduta' ? sedutaOrderChip(a.id, a.client_id) : ''}
                ${(() => { const cm = cmodLabel(a.consultation_mode); const pm = a.payment_method && a.payment_method !== 'undefined' && a.payment_method !== 'null' ? a.payment_method : null; return ['consulenza','pre-seduta'].includes(a.type) && (cm || pm) ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px;justify-content:center;">${cm ? `<span style="font-size:0.72rem;background:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.3);color:#D4AF37;padding:0 6px;height:26px;display:inline-flex;align-items:center;box-sizing:border-box;border-radius:4px;white-space:nowrap;"><i class="${cm.icon}" style="margin-right:4px;"></i>${cm.label}</span>` : ''}${pm ? `<span style="font-size:0.72rem;background:rgba(255,255,255,0.05);border:1px solid #333;color:#aaa;padding:0 6px;height:26px;display:inline-flex;align-items:center;box-sizing:border-box;border-radius:4px;white-space:nowrap;"><i class="fas fa-credit-card" style="margin-right:4px;"></i>${pm}</span>` : ''}</div>` : ''; })()}
                ${a.type === 'pre-seduta' && a.notes ? `<div style="font-size:0.72rem;color:#aaa;margin-top:3px;font-style:italic;text-align:center;">"${a.notes}"</div>` : ''}
            </div>
            <div style="margin-left:auto;display:flex;flex-direction:column;align-items:center;gap:5px;">
                <div style="display:flex;align-items:center;gap:5px;">
                    ${badgeHtmlWithRsch(a.id, a.status, a.scheduled_at)}
                </div>
                ${!isCancelled ? `<div style="display:flex;gap:4px;">
                    <button title="Proponi nuova data" onclick="event.stopPropagation();openIreneRescheduleModal('${a.id}','${client?.id || ''}','${safeEmail}','${safeName}','${a.type}')" style="display:inline-flex;align-items:center;justify-content:center;width:46px;height:32px;border-radius:7px;cursor:pointer;font-size:1.04rem;border:1px solid rgba(212,175,55,0.4);background:rgba(212,175,55,0.12);color:#D4AF37;"><i class="fas fa-clock"></i></button>
                    <button title="Annulla" onclick="event.stopPropagation();openCancelModal('${a.id}','${safeEmail}','${safeName}','${safeDate}')" style="display:inline-flex;align-items:center;justify-content:center;width:46px;height:32px;border-radius:7px;cursor:pointer;font-size:1.04rem;border:1px solid rgba(248,113,113,0.35);background:rgba(248,113,113,0.1);color:#f87171;"><i class="fas fa-times"></i></button>
                </div>` : ''}
            </div>
        </div>`;
    }).join('');

    detailEl.style.display = 'block';
    detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============================================
// GIORNI DI RIPOSO — MINI CALENDAR PICKER
// ============================================
let allBlockedDates = [];
let _bcalDate = new Date();
let _bcalFrom = null;
let _bcalTo   = null;

function renderBlockCal() {
    const grid  = document.getElementById('blockCalGrid');
    const label = document.getElementById('blockCalLabel');
    if (!grid || !label) return;

    const year  = _bcalDate.getFullYear();
    const month = _bcalDate.getMonth();

    label.textContent = new Date(year, month, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

    const byDay = {};
    (allAppointments || []).forEach(a => {
        if (a.status === 'cancelled') return;
        const d = new Date(a.scheduled_at);
        if (d.getFullYear() === year && d.getMonth() === month) byDay[d.getDate()] = true;
    });

    const firstDay = new Date(year, month, 1).getDay();
    const offset   = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth     = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    grid.innerHTML = '';

    for (let i = offset - 1; i >= 0; i--) {
        const el = document.createElement('div');
        el.className = 'bcal-day other-month';
        el.textContent = daysInPrevMonth - i;
        grid.appendChild(el);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr   = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const hasAppt   = !!byDay[d];
        const isToday   = dateStr === todayStr;
        const isBlocked = isDateBlocked(dateStr);
        const isFrom    = dateStr === _bcalFrom;
        const isTo      = dateStr === _bcalTo;
        const inRange   = _bcalFrom && _bcalTo && dateStr > _bcalFrom && dateStr < _bcalTo;

        let cls = 'bcal-day';
        if (isToday)   cls += ' bcal-today';
        if (hasAppt)   cls += ' bcal-has-appt';
        if (isBlocked) cls += ' bcal-already-blocked';
        if (isFrom)    cls += ' bcal-sel-from';
        if (isTo)      cls += ' bcal-sel-to';
        if (inRange)   cls += ' bcal-in-range';

        const el = document.createElement('div');
        el.className = cls;
        el.innerHTML = `<span>${d}</span>${hasAppt ? '<div class="bcal-dots"><div class="bcal-dot"></div></div>' : ''}`;
        el.addEventListener('click', () => blockCalSelectDay(dateStr));
        grid.appendChild(el);
    }

    const total = offset + daysInMonth;
    const rem   = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let d = 1; d <= rem; d++) {
        const el = document.createElement('div');
        el.className = 'bcal-day other-month';
        el.textContent = d;
        grid.appendChild(el);
    }

    const disp = document.getElementById('blockSelDisplay');
    if (disp) {
        if (_bcalFrom && _bcalTo && _bcalFrom !== _bcalTo) {
            const f = new Date(_bcalFrom + 'T12:00:00').toLocaleDateString('it-IT', { day:'2-digit', month:'long' });
            const t = new Date(_bcalTo   + 'T12:00:00').toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' });
            disp.innerHTML = `<i class="fas fa-ban" style="color:#f87171; margin-right:6px;"></i><span style="color:#f87171;">Blocco: ${f} → ${t}</span>`;
        } else if (_bcalFrom) {
            const f = new Date(_bcalFrom + 'T12:00:00').toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' });
            disp.innerHTML = `<i class="fas fa-ban" style="color:#f87171; margin-right:6px;"></i><span style="color:#f87171;">Giorno: ${f}</span> <span style="color:var(--text-muted); font-size:0.8rem;">(tocca un secondo giorno per un range)</span>`;
        } else {
            disp.innerHTML = '<span style="color:var(--text-muted);">Tocca un giorno per selezionarlo.</span>';
        }
    }

    const hFrom = document.getElementById('blockDateFrom');
    const hTo   = document.getElementById('blockDateTo');
    if (hFrom) hFrom.value = _bcalFrom || '';
    if (hTo)   hTo.value   = _bcalTo || _bcalFrom || '';
}

function blockCalSelectDay(dateStr) {
    if (!_bcalFrom || (_bcalFrom && _bcalTo)) {
        _bcalFrom = dateStr;
        _bcalTo   = null;
    } else {
        if (dateStr < _bcalFrom) { _bcalTo = _bcalFrom; _bcalFrom = dateStr; }
        else                     { _bcalTo = dateStr; }
    }
    renderBlockCal();
}

function blockCalPrev() { _bcalDate.setMonth(_bcalDate.getMonth() - 1); renderBlockCal(); }
function blockCalNext() { _bcalDate.setMonth(_bcalDate.getMonth() + 1); renderBlockCal(); }
function blockCalClearSel() { _bcalFrom = null; _bcalTo = null; renderBlockCal(); }

async function loadBlockedDates() {
    const { data, error } = await db.from('blocked_dates').select('*').order('date_from', { ascending: true });
    if (!error) allBlockedDates = data || [];
    renderBlockedDates();
    renderBlockCal();
}

function renderBlockedDates() {
    const list = document.getElementById('blockedDatesList');
    if (!list) return;
    if (allBlockedDates.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Nessun giorno di riposo impostato.</p>';
        return;
    }
    list.innerHTML = allBlockedDates.map(b => {
        const from = new Date(b.date_from + 'T12:00:00').toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' });
        const to   = b.date_to !== b.date_from
            ? ' → ' + new Date(b.date_to + 'T12:00:00').toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' })
            : '';
        return `<div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:rgba(248,113,113,0.06); border:1px solid rgba(248,113,113,0.2); border-radius:8px; margin-bottom:8px;">
            <div>
                <span style="color:#f87171; font-weight:600; font-size:0.9rem;"><i class="fas fa-ban" style="margin-right:6px; font-size:0.8rem;"></i>${from}${to}</span>
                ${b.reason ? `<span style="color:var(--text-muted); font-size:0.8rem; margin-left:10px;">${b.reason}</span>` : ''}
            </div>
            <button onclick="deleteBlockedDate('${b.id}')" style="background:transparent; border:none; color:#f87171; cursor:pointer; padding:4px 8px; font-size:1rem;" title="Elimina">
                <i class="fas fa-times"></i>
            </button>
        </div>`;
    }).join('');
}

async function addBlockedDate() {
    const dateFrom = document.getElementById('blockDateFrom').value;
    const dateTo   = document.getElementById('blockDateTo').value || dateFrom;
    const reason   = document.getElementById('blockReason').value.trim();
    const btn      = document.getElementById('blockAddBtn');

    if (!dateFrom) { showBlockMsg('Seleziona almeno la data di inizio.', false); return; }
    if (dateTo < dateFrom) { showBlockMsg('La data fine deve essere uguale o successiva alla data inizio.', false); return; }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="margin-right:5px;"></i>Attendere…';

    const { error } = await db.from('blocked_dates').insert({ date_from: dateFrom, date_to: dateTo, reason: reason || null });

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-plus" style="margin-right:5px;"></i>Aggiungi';

    if (error) { showBlockMsg('Errore: ' + error.message, false); return; }

    document.getElementById('blockDateFrom').value = '';
    document.getElementById('blockDateTo').value   = '';
    document.getElementById('blockReason').value   = '';
    showBlockMsg('Giorno di riposo aggiunto.', true);
    await loadBlockedDates();
    renderCalendar();
}

async function deleteBlockedDate(id) {
    const { error } = await db.from('blocked_dates').delete().eq('id', id);
    if (error) { showToast('Errore eliminazione'); return; }
    await loadBlockedDates();
    renderCalendar();
}

function showBlockMsg(text, ok) {
    const el = document.getElementById('blockMsg');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
    el.style.background = ok ? 'rgba(16,185,129,0.1)' : 'rgba(248,113,113,0.1)';
    el.style.color = ok ? '#10b981' : '#f87171';
    el.style.border = `1px solid ${ok ? 'rgba(16,185,129,0.3)' : 'rgba(248,113,113,0.3)'}`;
    setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function isDateBlocked(dateStr) {
    return allBlockedDates.some(b => dateStr >= b.date_from && dateStr <= b.date_to);
}

// ============================================
// IMPOSTAZIONI
// ============================================
function setupImpostazioni() {
    document.getElementById('settingsSaveBtn').addEventListener('click', changePassword);
    loadBlockedDates();
    renderBlockCal();
}

// ─── BOOKING UNLOCK (QR + 30 MIN) ──────────────────────────────────────────

let _bookingUnlockClientId = null;
let _qrCountdownInterval   = null;

function openBookingUnlockModal(clientId) {
    _bookingUnlockClientId = clientId;
    const client = allClients.find(c => c.id === clientId);
    document.getElementById('bookingUnlockClientName').textContent =
        client ? `${client.first_name || ''} ${client.last_name || ''}`.trim() : '';

    // Reset UI
    document.getElementById('qrDisplayArea').style.display = 'none';
    document.getElementById('qrExpiredMsg').style.display  = 'none';
    document.getElementById('qrCodeCanvas').innerHTML      = '';
    document.getElementById('btnGenQR').disabled           = false;
    document.getElementById('btnUnlock30').disabled        = false;
    if (_qrCountdownInterval) { clearInterval(_qrCountdownInterval); _qrCountdownInterval = null; }

    document.getElementById('bookingUnlockModal').style.display = 'flex';
}

function closeBookingUnlockModal() {
    document.getElementById('bookingUnlockModal').style.display = 'none';
    if (_qrCountdownInterval) { clearInterval(_qrCountdownInterval); _qrCountdownInterval = null; }
}

async function _createBookingToken(clientId, minutes) {
    // Elimina tutti i token scaduti (qualsiasi cliente) + quelli del cliente corrente
    const now = new Date().toISOString();
    await Promise.all([
        db.from('booking_tokens').delete().lt('expires_at', now),      // scaduti globali
        db.from('booking_tokens').delete().eq('client_id', clientId),  // cliente corrente
    ]);

    // Genera token lato JS (32 caratteri hex)
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0')).join('');

    const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    const { data, error } = await db.from('booking_tokens')
        .insert({ token, client_id: clientId, expires_at: expiresAt })
        .select('token')
        .single();

    if (error || !data) throw new Error(error?.message || 'Token non creato');
    return data.token;
}

async function generateQRToken() {
    const clientId = _bookingUnlockClientId;
    if (!clientId) return;

    const btn = document.getElementById('btnGenQR');
    btn.disabled = true;

    try {
        const token = await _createBookingToken(clientId, 20);
        const url   = `${window.location.origin}/dashboard.html?bt=${token}`;

        document.getElementById('qrDisplayArea').style.display = 'block';
        document.getElementById('qrExpiredMsg').style.display  = 'none';

        // Genera QR
        const canvas = document.createElement('canvas');
        document.getElementById('qrCodeCanvas').innerHTML = '';
        document.getElementById('qrCodeCanvas').appendChild(canvas);
        await QRCode.toCanvas(canvas, url, {
            width: 200,
            color: { dark: '#FFFFFF', light: '#161616' }
        });

        // Countdown 20 min
        let secondsLeft = 20 * 60;
        const countdownEl = document.getElementById('qrCountdown');
        if (_qrCountdownInterval) clearInterval(_qrCountdownInterval);
        _qrCountdownInterval = setInterval(async () => {
            secondsLeft--;
            const m = Math.floor(secondsLeft / 60);
            const s = secondsLeft % 60;
            countdownEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
            if (secondsLeft <= 0) {
                clearInterval(_qrCountdownInterval);
                _qrCountdownInterval = null;
                countdownEl.textContent = '0:00';
                document.getElementById('qrExpiredMsg').style.display = 'block';
                // Pulizia automatica token scaduto
                await db.from('booking_tokens').delete().eq('client_id', clientId);
                btn.disabled = false;
            }
        }, 1000);

    } catch (e) {
        showToast('Errore: ' + e.message);
        btn.disabled = false;
    }
}

async function unlock30min() {
    const clientId = _bookingUnlockClientId;
    if (!clientId) return;

    const btn = document.getElementById('btnUnlock30');
    btn.disabled = true;

    try {
        const token  = await _createBookingToken(clientId, 30);
        const url    = `${window.location.origin}/dashboard.html?bt=${token}`;
        const client = allClients.find(c => c.id === clientId);

        // Notifica nella dashboard del cliente
        await db.from('notifications').insert({
            type:      'booking_unlock',
            title:     '🔓 Prenotazione sbloccata!',
            body:      'Irene ti ha sbloccato la prenotazione della seduta. Hai 30 minuti per prenotare.',
            client_id: clientId,
            meta:      JSON.stringify({ token, url }),
            is_read:   false,
        });

        // Pulizia automatica: elimina token dopo 30 min (best-effort via setTimeout)
        setTimeout(async () => {
            await db.from('booking_tokens').delete().eq('client_id', clientId);
        }, 30 * 60 * 1000);

        showToast(`✅ Notifica inviata a ${client?.first_name || 'cliente'}. Sblocco valido 30 min.`);
        closeBookingUnlockModal();

    } catch (e) {
        showToast('Errore: ' + e.message);
        btn.disabled = false;
    }
}


async function changePassword() {
    const currentPwd = document.getElementById('settingsCurrentPwd').value.trim();
    const newPwd     = document.getElementById('settingsNewPwd').value.trim();
    const confirmPwd = document.getElementById('settingsConfirmPwd').value.trim();
    const msgEl      = document.getElementById('settingsMsg');
    const btn        = document.getElementById('settingsSaveBtn');

    function showMsg(text, ok) {
        msgEl.textContent = text;
        msgEl.style.display = 'block';
        msgEl.style.background = ok ? '#d1fae5' : '#fee2e2';
        msgEl.style.color      = ok ? '#065f46' : '#991b1b';
    }

    if (!currentPwd || !newPwd || !confirmPwd) { showMsg('Compila tutti i campi.', false); return; }
    if (newPwd.length < 8)                      { showMsg('La nuova password deve avere almeno 8 caratteri.', false); return; }
    if (newPwd !== confirmPwd)                  { showMsg('Le password non coincidono.', false); return; }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Aggiornamento...';

    // Verifica password attuale
    const { error: signInErr } = await db.auth.signInWithPassword({ email: ADMIN_EMAIL, password: currentPwd });
    if (signInErr) {
        showMsg('Password attuale non corretta.', false);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Aggiorna password';
        return;
    }

    // Aggiorna password
    const { error: updateErr } = await db.auth.updateUser({ password: newPwd });
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Aggiorna password';

    if (updateErr) {
        showMsg('Errore: ' + updateErr.message, false);
    } else {
        showMsg('Password aggiornata con successo!', true);
        document.getElementById('settingsCurrentPwd').value = '';
        document.getElementById('settingsNewPwd').value = '';
        document.getElementById('settingsConfirmPwd').value = '';
    }
}

// ============================================
// LOGOUT
// ============================================
async function logout() {
    await db.auth.signOut();
    window.location.href = 'login.html';
}

// ============================================
// HELPERS
// ============================================
function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('it-IT', {
        weekday: 'short', day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function typeLabel(type) {
    const labels = {
        consulenza:  'Consulenza',
        'pre-seduta': 'Pre-Seduta',
        seduta:      'Seduta'
    };
    return labels[type] || type || '—';
}

function cmodLabel(mode) {
    if (!mode || mode === 'undefined' || mode === 'null') return null;
    if (/whatsapp|video/i.test(mode)) return { label: 'WhatsApp', icon: 'fab fa-whatsapp' };
    if (/inPerson|in_person|studio/i.test(mode)) return { label: 'In Studio', icon: 'fas fa-map-marker-alt' };
    return { label: mode, icon: 'fas fa-map-marker-alt' };
}

function sedutaOrderChip(apptId, clientId) {
    if (!clientId) return '';
    const sedute = allAppointments
        .filter(a => a.client_id === clientId && a.type === 'seduta' && a.status !== 'cancelled')
        .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    const idx = sedute.findIndex(a => a.id === apptId);
    if (idx === -1) return '';
    const isFirst = idx === 0;
    const ordinals = ['Prima', 'Seconda', 'Terza', 'Quarta', 'Quinta',
                      'Sesta', 'Settima', 'Ottava', 'Nona', 'Decima'];
    const label = ordinals[idx] || `#${idx + 1}`;
    return `<span style="font-size:0.72rem;padding:1px 6px;border-radius:4px;display:inline-block;margin-top:3px;
        background:${isFirst ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.04)'};
        border:1px solid ${isFirst ? 'rgba(212,175,55,0.35)' : 'rgba(255,255,255,0.1)'};
        color:${isFirst ? '#D4AF37' : '#666'};">${label}</span>`;
}

function badgeHtml(status) {
    const map = {
        pending:   ['badge-pending',   'In attesa'],
        confirmed: ['badge-confirmed', 'Confermato'],
        completed: ['badge-completed', 'Completato'],
        cancelled: ['badge-cancelled', 'Cancellato']
    };
    const [cls, label] = map[status] || ['', status];
    return `<span class="badge ${cls}">${label}</span>`;
}
function badgeHtmlWithRsch(apptId, status, scheduledAt) {
    const isPast = scheduledAt && new Date(scheduledAt) < new Date() && ['confirmed','pending'].includes(status);
    if (isPast) return `<span class="badge" style="background:rgba(120,120,120,0.12);color:#888;border:1px solid rgba(120,120,120,0.25);">✓ Avvenuto</span>`;
    if (!apptId) return badgeHtml(status);
    const rr = (allRescheduleRequests || []).find(r => r.appointment_id === apptId && r.status === 'pending');
    if (!rr) return badgeHtml(status);
    if (rr.initiated_by === 'irene') {
        const d = new Date(rr.requested_date).toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit' });
        return `<span class="badge badge-reschedule" title="Irene ha proposto cambio al ${d}">⏳ al ${d}</span>`;
    }
    return `<span class="badge badge-reschedule" title="Cliente ha richiesto un cambio data">⏳ Richiesta cambio</span>`;
}

// ============================================
// ANALYTICS
// ============================================
function renderAnalytics() {
    const consulenze = allAppointments.filter(a => a.type === 'consulenza');
    const sedute     = allAppointments.filter(a => a.type === 'seduta' && a.status !== 'cancelled');
    const completati = allAppointments.filter(a => a.type === 'seduta' && a.status === 'completed');

    const clientsWithConsulenza = new Set(consulenze.map(a => a.client_id));
    const clientsWithSeduta     = new Set(sedute.map(a => a.client_id));

    const converted = [...clientsWithConsulenza].filter(id => clientsWithSeduta.has(id)).length;
    const convRate  = clientsWithConsulenza.size > 0
        ? Math.round((converted / clientsWithConsulenza.size) * 100)
        : 0;

    const revenue = allAppointments
        .filter(a => a.status === 'completed' && a.amount)
        .reduce((sum, a) => sum + parseFloat(a.amount || 0), 0);

    // Statistiche session_price
    const seduteConPrezzo = sedute.filter(a => a.session_price);
    const avgSession = seduteConPrezzo.length > 0
        ? Math.round(seduteConPrezzo.reduce((s, a) => s + a.session_price, 0) / seduteConPrezzo.length)
        : 0;
    const maxSession = seduteConPrezzo.length > 0
        ? Math.max(...seduteConPrezzo.map(a => a.session_price))
        : 0;

    // Incassi POS vs Contanti
    const incassoPos      = sedute.filter(a => a.session_payment_method === 'pos').reduce((s, a) => s + (a.session_price || 0), 0);
    const incassoContanti = sedute.filter(a => a.session_payment_method === 'contanti').reduce((s, a) => s + (a.session_price || 0), 0);
    const incassoTotale   = seduteConPrezzo.reduce((s, a) => s + a.session_price, 0);

    document.getElementById('statConsulenze').textContent = consulenze.length;
    document.getElementById('statSedute').textContent     = sedute.length;
    document.getElementById('statConvRate').textContent   = convRate + '%';
    document.getElementById('statRevenue').textContent    = '€' + revenue.toFixed(0);
    const avgEl = document.getElementById('statAvgSession');
    const maxEl = document.getElementById('statMaxSession');
    const posEl = document.getElementById('statIncassoPos');
    const conEl = document.getElementById('statIncassoContanti');
    const totEl = document.getElementById('statIncassoTotale');
    if (avgEl) avgEl.textContent = avgSession > 0 ? '€' + avgSession : '—';
    if (maxEl) maxEl.textContent = maxSession > 0 ? '€' + maxSession : '—';
    if (posEl) posEl.textContent = incassoPos > 0 ? '€' + incassoPos.toLocaleString('it-IT') : '€0';
    if (conEl) conEl.textContent = incassoContanti > 0 ? '€' + incassoContanti.toLocaleString('it-IT') : '€0';
    if (totEl) totEl.textContent = incassoTotale > 0 ? '€' + incassoTotale.toLocaleString('it-IT') : '€0';

    renderFunnel(clientsWithConsulenza.size, clientsWithSeduta.size, completati.length);
    renderMonthlyBars();
    renderTopClients();
}

function renderFunnel(consulenzaClients, seduteClients, completatiClients) {
    const totale = allClients.length + allWaitlist.length || 1;
    const steps = [
        { label: 'Contatti totali',          val: allClients.length + allWaitlist.length },
        { label: 'Clienti registrati',        val: allClients.length },
        { label: 'Con consulenza prenotata',  val: consulenzaClients },
        { label: 'Con seduta tatuaggio',      val: seduteClients },
        { label: 'Tatuaggi completati',       val: completatiClients },
    ];

    document.getElementById('funnelContainer').innerHTML = steps.map(s => {
        const pct = Math.round((s.val / totale) * 100);
        return `
        <div class="funnel-step">
            <div class="funnel-label">${s.label}</div>
            <div class="funnel-bar-wrap">
                <div class="funnel-bar" style="width:${Math.max(pct, 2)}%">
                    <span class="funnel-bar-val">${s.val}</span>
                </div>
            </div>
            <div class="funnel-pct">${pct}%</div>
        </div>`;
    }).join('');
}

function renderMonthlyBars() {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const appts = allAppointments.filter(a => {
            const ad = new Date(a.scheduled_at);
            return ad.getFullYear() === d.getFullYear() &&
                   ad.getMonth() === d.getMonth() &&
                   a.status !== 'cancelled';
        });
        const income = appts.reduce((s, a) => s + (a.session_price || 0) + (a.amount_paid || 0), 0);
        months.push({
            label: d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }),
            count: appts.length,
            income
        });
    }

    const maxIncome = Math.max(...months.map(m => m.income), 1);
    document.getElementById('monthlyBars').innerHTML = months.map(m => {
        const pct = Math.round((m.income / maxIncome) * 100);
        const incomeLabel = m.income > 0 ? '€' + m.income.toLocaleString('it-IT') : m.count + ' app.';
        return `
        <div class="month-row">
            <div class="month-label">${m.label}</div>
            <div class="month-bar-wrap">
                <div class="month-bar" style="width:${Math.max(pct, m.income > 0 ? 2 : 0)}%"></div>
            </div>
            <div class="month-count">${incomeLabel}</div>
        </div>`;
    }).join('');
}

function renderTopClients() {
    const apptCount = {};
    allAppointments.forEach(a => {
        apptCount[a.client_id] = (apptCount[a.client_id] || 0) + 1;
    });

    const sorted = [...allClients]
        .filter(c => apptCount[c.id])
        .sort((a, b) => (apptCount[b.id] || 0) - (apptCount[a.id] || 0))
        .slice(0, 5);

    const el = document.getElementById('topClientsList');
    if (sorted.length === 0) {
        el.innerHTML = '<div class="empty-state">Nessun dato disponibile</div>';
        return;
    }

    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    el.innerHTML = sorted.map((c, i) => `
    <div class="top-client-row">
        <div class="top-client-rank">${medals[i]}</div>
        <div class="top-client-name">${c.first_name || ''} ${c.last_name || ''}</div>
        <div class="top-client-count">${apptCount[c.id]} appuntament${apptCount[c.id] === 1 ? 'o' : 'i'}</div>
    </div>`).join('');
}

// ============================================
// COMUNICAZIONI
// ============================================
const TEMPLATES = {
    promemoria:    'Ciao [Nome]! Ti ricordo il tuo prossimo appuntamento con Irene Gipsy Tattoo. Per qualsiasi modifica o informazione scrivimi pure. Ci vediamo presto! 🖤',
    followup:      'Ciao [Nome]! Come sta andando la guarigione del tuo tatuaggio? Ricorda di seguire la scheda di cura e di evitare il sole nelle prime settimane. Per qualsiasi dubbio sono qui! 🖤',
    disponibilita: 'Ciao [Nome]! Si sono liberate nuove date in agenda. Se sei interessata/o a prenotare una seduta o una consulenza, scrivimi per scegliere il giorno migliore per te! 🖤',
    acconto:       'Ciao [Nome]! Per confermare il tuo appuntamento ti chiedo di versare l\'acconto di €50 tramite PayPal (irenegipsytattoo@gmail.com). Causale: tuo nome e data appuntamento. Grazie! 🖤'
};

let currentChannel = 'whatsapp';
let currentBulkCh  = 'whatsapp';

function setupComunicazioni() {
    // Popola select clienti (ordinati per cognome)
    const sel = document.getElementById('commRecipient');
    if (!sel) return;
    [...allClients].sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '')).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.last_name || ''} ${c.first_name || ''}`.trim();
        sel.appendChild(opt);
    });

    // Channel (individuale)
    document.querySelectorAll('.comm-ch-btn[data-ch]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.comm-ch-btn[data-ch]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentChannel = btn.dataset.ch;
            document.getElementById('commSubjectWrap').style.display =
                currentChannel === 'email' ? 'block' : 'none';
        });
    });

    // Channel (bulk)
    document.querySelectorAll('.comm-ch-btn[data-bulk-ch]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.comm-ch-btn[data-bulk-ch]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentBulkCh = btn.dataset.bulkCh;
            updateBulkPreview();
        });
    });

    // Templates
    document.querySelectorAll('.comm-tpl').forEach(btn => {
        btn.addEventListener('click', () => {
            const clientId = document.getElementById('commRecipient').value;
            const client   = allClients.find(c => c.id === clientId);
            const nome     = client ? (client.first_name || 'cliente') : 'cliente';
            document.getElementById('commMessage').value =
                (TEMPLATES[btn.dataset.tpl] || '').replace('[Nome]', nome);
            updateCharCount();
        });
    });

    // Char count
    document.getElementById('commMessage').addEventListener('input', updateCharCount);

    // Send individuale
    document.getElementById('commSendBtn').addEventListener('click', sendIndividual);

    // Bulk target
    document.querySelectorAll('input[name="bulkTarget"]').forEach(r => {
        r.addEventListener('change', updateBulkPreview);
    });

    // Bulk copy
    document.getElementById('bulkCopyBtn').addEventListener('click', copyBulkContacts);

    updateBulkPreview();
}

function updateCharCount() {
    const len = document.getElementById('commMessage').value.length;
    document.getElementById('commChars').textContent = len + ' caratteri';
}

function sendIndividual() {
    const clientId = document.getElementById('commRecipient').value;
    const message  = document.getElementById('commMessage').value.trim();

    if (!clientId) { showToast('Seleziona un cliente.', 3000, true); return; }
    if (!message)  { showToast('Scrivi un messaggio.', 3000, true); return; }

    const client = allClients.find(c => c.id === clientId);
    if (!client) return;

    if (currentChannel === 'whatsapp') {
        const phone = (client.phone || '').replace(/\D/g, '');
        if (!phone) { showToast('Questo cliente non ha un numero di telefono.', 3500, true); return; }
        const num = phone.startsWith('39') ? phone : '39' + phone;
        window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(message), '_blank');

    } else if (currentChannel === 'email') {
        if (!client.email) { showToast('Questo cliente non ha un indirizzo email.', 3500, true); return; }
        const subject = document.getElementById('commSubject').value || 'Messaggio da Irene Gipsy Tattoo';
        const clientName = (client.first_name || 'Cliente');
        const btn = document.getElementById('commSendBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Invio in corso...';
        const ctrl = new AbortController();
        const tout = setTimeout(() => ctrl.abort(), 15000);
        fetch('https://n8n.srv1204993.hstgr.cloud/webhook/send-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: 'email', to_email: client.email, subject: subject, message: message, client_name: clientName }),
            signal: ctrl.signal
        })
        .then(r => { if (!r.ok) throw new Error('Errore server'); return r.json(); })
        .then(() => {
            showToast('Email inviata a ' + client.email + '!');
            document.getElementById('commMessage').value = '';
            updateCharCount();
        })
        .catch(() => showToast('Errore nell\'invio dell\'email. Riprova.', 4000, true))
        .finally(() => {
            clearTimeout(tout);
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> Invia';
        });
        return;

    } else if (currentChannel === 'sms') {
        const phone = (client.phone || '').replace(/\D/g, '');
        if (!phone) { showToast('Questo cliente non ha un numero di telefono.', 3500, true); return; }
        const num = phone.startsWith('39') ? '+' + phone : '+39' + phone;
        window.location.href = 'sms:' + num + '?body=' + encodeURIComponent(message);
    }
}

function getBulkRecipients() {
    const checked = document.querySelector('input[name="bulkTarget"]:checked');
    if (!checked) return [];
    const target = checked.value;
    if (target === 'all') return allClients;

    if (target === 'pending') {
        const ids = new Set(allAppointments.filter(a => a.status === 'pending').map(a => a.client_id));
        return allClients.filter(c => ids.has(c.id));
    }
    if (target === 'waitlist') {
        const ids = new Set(allWaitlist.map(w => w.client_id));
        return allClients.filter(c => ids.has(c.id));
    }
    if (target === 'completed') {
        const ids = new Set(allAppointments.filter(a => a.status === 'completed').map(a => a.client_id));
        return allClients.filter(c => ids.has(c.id));
    }
    return [];
}

function updateBulkPreview() {
    const recipients = getBulkRecipients();
    const el = document.getElementById('bulkPreview');
    const field = currentBulkCh === 'email' ? 'email' : 'phone';

    if (recipients.length === 0) {
        el.innerHTML = '<div class="empty-state">Nessun destinatario per questo gruppo</div>';
        return;
    }

    el.innerHTML =
        `<div class="bulk-count">${recipients.length} destinatar${recipients.length === 1 ? 'io' : 'i'}</div>` +
        recipients.map(c => `
        <div class="bulk-item">
            <div class="bulk-item-name">${c.first_name || ''} ${c.last_name || ''}</div>
            <div class="bulk-item-contact">${c[field] || '—'}</div>
        </div>`).join('');
}

function copyBulkContacts() {
    const recipients = getBulkRecipients();
    const field = currentBulkCh === 'email' ? 'email' : 'phone';
    const contacts = recipients.map(c => c[field]).filter(Boolean).join('\n');

    if (!contacts) { showToast('Nessun contatto disponibile per questo gruppo.', 3500, true); return; }

    navigator.clipboard.writeText(contacts).then(() => {
        const btn = document.getElementById('bulkCopyBtn');
        btn.innerHTML = '<i class="fas fa-check"></i> Copiati negli appunti!';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-copy"></i> Copia contatti negli appunti';
        }, 2500);
    });
}

// ============================================
// PORTFOLIO
// ============================================

// ============================================
// NOTIFICHE
// ============================================

let allRescheduleRequests = [];

async function loadNotifications() {
    const [notifRes, reschedRes] = await Promise.all([
        db.from('notifications')
            .select('*, clients(first_name, last_name)')
            .order('created_at', { ascending: false })
            .limit(100),
        db.from('reschedule_requests')
            .select('*, clients(first_name, last_name, email), appointments(scheduled_at)')
            .eq('status', 'pending')
            .order('created_at', { ascending: false }),
    ]);
    if (!notifRes.error) {
        allNotifications = notifRes.data || [];
    }
    allRescheduleRequests = reschedRes.data || [];
    updateNotifBadge();
    renderRescheduleRequests();
    renderNotifications();
    renderOverview();
    renderCalendar();
    // Bottone "segna tutte lette"
    document.getElementById('markAllReadBtn')?.addEventListener('click', markAllRead);
}

function updateNotifBadge() {
    const actionCount = allRescheduleRequests.length + (allWaitlistRequests || []).length;
    const infoCount   = allNotifications.filter(n => !n.is_read).length;

    // Badge rosso (sx) — richieste che aspettano azione
    const badgeAction = document.getElementById('notifBadgeAction');
    if (badgeAction) {
        badgeAction.textContent = actionCount > 99 ? '99+' : actionCount;
        badgeAction.style.display = actionCount > 0 ? 'flex' : 'none';
    }

    // Badge oro (dx) — notifiche informative non lette
    const badgeInfo = document.getElementById('notifBadge');
    if (badgeInfo) {
        badgeInfo.textContent = infoCount > 99 ? '99+' : infoCount;
        badgeInfo.style.display = infoCount > 0 ? 'flex' : 'none';
    }

    // Nav badge (totale)
    const nav = document.getElementById('notifNavBadge');
    if (nav) {
        const total = actionCount + infoCount;
        nav.textContent = total > 99 ? '99+' : total;
        nav.style.display = total > 0 ? 'flex' : 'none';
    }

    // Campanella: highlight se c'è qualcosa
    const bellBtn = document.getElementById('notifBell');
    if (bellBtn) bellBtn.classList.toggle('has-unread', actionCount + infoCount > 0);
}

function renderNotifications() {
    const list = document.getElementById('notifList');
    if (!list) return;

    if (allNotifications.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:40px">Nessuna notifica</div>';
        return;
    }

    list.innerHTML = allNotifications.map(n => {
        const time = formatTimeAgo(n.created_at);

        // ── Notifica posto liberato: render speciale con 3 azioni ──
        if (n.type === 'seduta_free_reschedule') {
            const freedSlotAt = n.meta?.freed_slot_at || '';
            const freedDateStr = freedSlotAt
                ? new Date(freedSlotAt).toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
                : '';
            const encodedBody = encodeURIComponent(n.body || '');
            const actionsHtml = freedSlotAt ? `
                <div class="freed-slot-actions">
                    <button class="freed-btn freed-btn-auto" onclick="event.stopPropagation();openFreedSlotModal('${freedSlotAt}',null,'${n.id}','${encodedBody}')">📆 Gestisci posto</button>
                </div>` : '';
            return `<div class="notif-item freed-slot-card ${n.is_read ? '' : 'notif-unread'}" data-id="${n.id}" data-client="${n.client_id || ''}">
                <div class="notif-icon" style="color:#D4AF37"><i class="fas fa-calendar-minus"></i></div>
                <div class="notif-body" style="flex:1;min-width:0;">
                    <div class="notif-title">📆 Posto liberato${freedDateStr ? ' — ' + freedDateStr : ''}</div>
                    <div class="notif-text">${n.body || ''}</div>
                    ${actionsHtml}
                    <div class="notif-time">${time}</div>
                </div>
                ${!n.is_read ? '<div class="notif-dot"></div>' : ''}
            </div>`;
        }

        // ── Notifiche standard ──
        const iconMap  = { new_appointment: 'fa-calendar-check', new_client: 'fa-user-plus', reschedule_request: 'fa-calendar-times' };
        const colorMap = { new_appointment: 'var(--gold)', new_client: 'var(--green)', reschedule_request: 'var(--orange, #f97316)' };
        const icon  = iconMap[n.type]  || 'fa-bell';
        const color = colorMap[n.type] || 'var(--blue)';
        const clientName = n.clients
            ? (n.clients.first_name + ' ' + n.clients.last_name).trim()
            : '';
        return `<div class="notif-item ${n.is_read ? '' : 'notif-unread'}"
                     data-id="${n.id}" data-client="${n.client_id || ''}">
            <div class="notif-icon" style="color:${color}">
                <i class="fas ${icon}"></i>
            </div>
            <div class="notif-body">
                <div class="notif-title">${n.title}</div>
                <div class="notif-text">${n.body || clientName}</div>
                <div class="notif-time">${time}</div>
            </div>
            ${!n.is_read ? '<div class="notif-dot"></div>' : ''}
        </div>`;
    }).join('');

    list.querySelectorAll('.notif-item').forEach(item => {
        item.addEventListener('click', () => {
            const id       = item.dataset.id;
            const clientId = item.dataset.client;
            markAsRead(id);
            if (clientId) {
                navigateTo('clients');
                openClientDetail(clientId);
            }
        });
    });
}

async function markAsRead(id) {
    const notif = allNotifications.find(n => n.id === id);
    if (!notif || notif.is_read) return;
    notif.is_read = true;
    updateNotifBadge();
    renderNotifications();
    await db.from('notifications').update({ is_read: true }).eq('id', id);
}

async function markAllRead() {
    const unread = allNotifications.filter(n => !n.is_read);
    if (unread.length === 0) return;
    unread.forEach(n => n.is_read = true);
    updateNotifBadge();
    renderNotifications();
    await db.from('notifications').update({ is_read: true })
        .in('id', unread.map(n => n.id));
}

const INFO_NOTIF_TYPES = [
    'new_appointment', 'new_client',
    'advance_offer_accepted', 'advance_offer_declined', 'irene_proposal_rejected',
];

async function clearInfoNotifications() {
    const toDelete = allNotifications.filter(n => INFO_NOTIF_TYPES.includes(n.type));
    if (toDelete.length === 0) { showToast('Nessuna notifica informativa da cancellare.'); return; }
    if (!await customConfirm(`Cancellare ${toDelete.length} notifiche informative?\nL'operazione è irreversibile.`)) return;

    const ids = toDelete.map(n => n.id);
    const { error } = await db.from('notifications').delete().in('id', ids);
    if (error) { showToast('Errore durante la cancellazione.', true); return; }

    allNotifications = allNotifications.filter(n => !INFO_NOTIF_TYPES.includes(n.type));
    updateNotifBadge();
    renderNotifications();
    showToast(`${toDelete.length} notifiche cancellate.`);
}

function setupNotifRealtime() {
    db.channel('admin-notifications')
        .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'notifications'
        }, payload => {
            allNotifications.unshift(payload.new);
            updateNotifBadge();
            renderNotifications();
        })
        .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'reschedule_requests'
        }, async () => {
            await loadNotifications();
        })
        .subscribe();

    // Realtime su appuntamenti, clienti, waitlist
    db.channel('admin-data')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, async () => {
            await loadAppointments();
            renderOverview();
            renderCalendar();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, async () => {
            await loadClients();
            renderOverview();
            renderClientsTable(allClients);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'waitlist' }, async () => {
            await loadWaitlist();
            renderOverview();
        })
        .subscribe();
}

// ============================================
// RESCHEDULE REQUESTS — ADMIN
// ============================================
const RESCHEDULE_N8N_URL           = 'https://n8n.srv1204993.hstgr.cloud/webhook/reschedule-notify';
const CAL_RESCHEDULE_N8N_URL       = 'https://n8n.srv1204993.hstgr.cloud/webhook/cal-reschedule';
const CAL_BOOKINGS_URL             = 'https://n8n.srv1204993.hstgr.cloud/webhook/cal-bookings';
const CANCEL_N8N_URL               = 'https://n8n.srv1204993.hstgr.cloud/webhook/cancel-appointment';
const IRENE_RESCHEDULE_NOTIFY_URL           = 'https://n8n.srv1204993.hstgr.cloud/webhook/irene-proposal-notify';
const IRENE_PRESEDUTA_NOTIFY_URL            = 'https://n8n.srv1204993.hstgr.cloud/webhook/irene-proposal-notify-preseduta';
const RSCH_SLOTS_URL               = 'https://n8n.srv1204993.hstgr.cloud/webhook/cal-slots';

function renderRescheduleRequests() {
    const card = document.getElementById('rescheduleRequestsCard');
    const list = document.getElementById('rescheduleRequestsList');
    if (!card || !list) return;

    // Dividi: richieste dal cliente (Irene deve decidere) vs proposte di Irene (cliente deve decidere)
    const clientRequests = allRescheduleRequests.filter(r => r.initiated_by !== 'irene');
    const ireneProposals = allRescheduleRequests.filter(r => r.initiated_by === 'irene');

    if (!clientRequests.length && !ireneProposals.length) {
        card.style.display = 'none';
        return;
    }
    card.style.display = 'block';

    const buildClientRow = r => {
        const client    = r.clients;
        const name      = client ? `${client.first_name} ${client.last_name}` : '—';
        const safeName  = name.replace(/'/g, "\\'");
        const safeEmail = (client?.email || '').replace(/'/g, "\\'");
        const oldDate   = r.appointments?.scheduled_at
            ? new Date(r.appointments.scheduled_at).toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
            : '—';
        const newDate   = new Date(r.requested_date).toLocaleDateString('it-IT');
        return `
        <div class="reschedule-request-item" id="rri-${r.id}">
            <div class="rri-header">
                <span class="rri-client"><i class="fas fa-user"></i> ${name}</span>
                <span class="rri-time">${formatTimeAgo(r.created_at)}</span>
            </div>
            <div class="rri-dates">
                <span class="rri-old"><i class="fas fa-calendar-minus"></i> Attuale: <strong>${oldDate}</strong></span>
                <i class="fas fa-arrow-right" style="color:var(--text-muted);margin:0 6px;"></i>
                <span class="rri-new"><i class="fas fa-calendar-plus"></i> Richiesta: <strong>${newDate} ore ${fmtReqTime(r.requested_time)}</strong></span>
            </div>
            <div class="rri-reason"><i class="fas fa-comment-dots"></i> "${r.reason}"</div>
            <div class="rri-actions" id="rri-actions-${r.id}">
                <button class="btn-accept-reschedule" onclick="acceptReschedule('${r.id}','${r.appointment_id}','${r.requested_date}','${r.requested_time}','${r.client_id}','${safeEmail}','${safeName}')">
                    <i class="fas fa-check"></i> Accetta
                </button>
                <button class="btn-reject-reschedule" onclick="openRejectForm('${r.id}','${safeEmail}','${safeName}')">
                    <i class="fas fa-times"></i> Rifiuta
                </button>
            </div>
            <div class="reject-inline-form" id="rejectForm-${r.id}" style="display:none;">
                <input type="text" id="rejectNote-${r.id}" placeholder="Motivo del rifiuto (opzionale)" class="reject-note-input">
                <div style="display:flex;gap:6px;margin-top:6px;">
                    <button class="btn-accept-reschedule" onclick="confirmReject('${r.id}','${r.client_id}','${safeEmail}','${safeName}')">
                        <i class="fas fa-check"></i> Conferma rifiuto
                    </button>
                    <button class="btn-reject-reschedule" onclick="document.getElementById('rejectForm-${r.id}').style.display='none'">Annulla</button>
                </div>
            </div>
        </div>`;
    };

    const buildIreneRow = r => {
        const client  = r.clients;
        const name    = client ? `${client.first_name} ${client.last_name}` : '—';
        const newDate = new Date(r.requested_date).toLocaleDateString('it-IT', { weekday:'long', day:'2-digit', month:'long' });
        return `
        <div class="reschedule-request-item" id="rri-${r.id}" style="border-left-color:var(--gold);">
            <div class="rri-header">
                <span class="rri-client"><i class="fas fa-user"></i> ${name}</span>
                <span class="rri-time" style="color:var(--gold);">In attesa cliente</span>
            </div>
            <div class="rri-dates">
                <span class="rri-new"><i class="fas fa-calendar-plus"></i> Proposta: <strong>${newDate} ore ${fmtReqTime(r.requested_time)}</strong></span>
            </div>
            ${r.reason && r.reason !== 'Proposta di Irene' ? `<div class="rri-reason"><i class="fas fa-comment-dots"></i> "${r.reason}"</div>` : ''}
            <div style="margin-top:8px;">
                <button class="btn-reject-reschedule" onclick="cancelIreneProposal('${r.id}')">
                    <i class="fas fa-times"></i> Annulla proposta
                </button>
            </div>
        </div>`;
    };

    let html = '';
    if (clientRequests.length) {
        html += `<div style="font-size:0.75rem;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Richieste dai clienti</div>`;
        html += clientRequests.map(buildClientRow).join('<hr style="border-color:#1e1e1e;margin:10px 0;">');
    }
    if (ireneProposals.length) {
        if (clientRequests.length) html += '<hr style="border-color:#1e1e1e;margin:14px 0;">';
        html += `<div style="font-size:0.75rem;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Proposte inviate ai clienti</div>`;
        html += ireneProposals.map(buildIreneRow).join('<hr style="border-color:#1e1e1e;margin:10px 0;">');
    }
    list.innerHTML = html;
}

async function cancelIreneProposal(requestId) {
    if (!await customConfirm('Vuoi annullare questa proposta?\nIl cliente non potrà più accettarla.')) return;
    await db.from('reschedule_requests').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', requestId);
    allRescheduleRequests = allRescheduleRequests.filter(r => r.id !== requestId);
    updateNotifBadge();
    renderRescheduleRequests();
}

function openRejectForm(requestId, clientEmail, clientName) {
    document.getElementById('rri-actions-' + requestId).style.display = 'none';
    document.getElementById('rejectForm-' + requestId).style.display  = 'block';
}

async function acceptReschedule(requestId, apptId, newDate, newTime, clientId, clientEmail, clientName) {
    const item = document.getElementById('rri-' + requestId);
    const acceptBtn = item ? item.querySelector('.btn-accept-reschedule') : null;
    if (acceptBtn) { acceptBtn.disabled = true; acceptBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="margin-right:5px;"></i>Attendere…'; }
    if (item) item.style.opacity = '0.5';

    try {
        // Costruisce nuovo scheduled_at in modo robusto
        // newTime può essere: ISO completo "2026-03-26T09:00:00.000Z" (da Cal.com) → usalo direttamente
        // oppure label "10:00" / "10.00" (vecchio formato) → ricostruisci con timezone locale
        const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
        const newScheduledAt = isoPattern.test(newTime)
            ? newTime
            : new Date(`${newDate}T${newTime.replace('.', ':')}:00`).toISOString();

        // Controlla duplicati: nessun altro appuntamento dello stesso cliente al nuovo orario
        const { data: existing } = await db.from('appointments')
            .select('id')
            .eq('client_id', clientId)
            .eq('scheduled_at', newScheduledAt)
            .neq('id', apptId)
            .neq('status', 'cancelled')
            .maybeSingle();
        if (existing) {
            if (item) item.style.opacity = '1';
            showToast('Esiste già un appuntamento per questo cliente in quell\'orario.', 4000, true);
            return;
        }

        // Per le sedute: controlla anche doppioni nella stessa giornata (orari diversi)
        const reschApptType = allAppointments.find(a => a.id === apptId)?.type;
        if (reschApptType === 'seduta') {
            const dateOnly = newScheduledAt.split('T')[0];
            const { data: sameDayData } = await db.from('appointments')
                .select('id')
                .eq('client_id', clientId)
                .eq('type', 'seduta')
                .neq('id', apptId)
                .neq('status', 'cancelled')
                .gte('scheduled_at', dateOnly + 'T00:00:00Z')
                .lt('scheduled_at', dateOnly + 'T23:59:59Z');
            if (sameDayData && sameDayData.length > 0) {
                if (item) item.style.opacity = '1';
                if (acceptBtn) { acceptBtn.disabled = false; acceptBtn.innerHTML = '<i class="fas fa-check" style="margin-right:5px;"></i>Accetta'; }
                showToast('⚠️ Il cliente ha già una seduta in questa data. Non è possibile spostarne due nello stesso giorno.', 4000, true);
                return;
            }
        }

        const [apptErr, rrErr] = await Promise.all([
            db.from('appointments').update({ scheduled_at: newScheduledAt }).eq('id', apptId).then(r => r.error),
            db.from('reschedule_requests').delete().eq('id', requestId).then(r => r.error),
        ]);

        if (apptErr || rrErr) {
            throw new Error(apptErr?.message || rrErr?.message);
        }

        // Sincronizza con Cal.com
        const appt    = allAppointments.find(a => a.id === apptId);
        const calUid  = appt?.cal_booking_uid || null;
        const client  = allClients.find(c => c.id === clientId);
        const EVENT_TYPE_IDS = { 'consulenza': 5147645, 'pre-seduta': 5147653, 'seduta': 5147823 };
        const eventTypeId = EVENT_TYPE_IDS[appt?.type] || 5147645;
        const endIso  = new Date(new Date(newScheduledAt).getTime() + 60 * 60 * 1000).toISOString();

        try {
            const calResp = await fetch(CAL_RESCHEDULE_N8N_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appointment_id:  apptId,
                    new_start_iso:   newScheduledAt,
                    reason:          'Richiesta cambio data approvata da Irene',
                    cal_booking_uid: calUid,
                    client_email:    clientEmail,
                    fallback_new_booking: {
                        eventTypeId,
                        start: newScheduledAt,
                        end:   endIso,
                        responses: {
                            name:                clientName,
                            email:               clientEmail,
                            location:            { value: appt?.consultation_mode || 'inPerson', optionValue: '' },
                            notes:               appt?.notes || '',
                            attendeePhoneNumber: client?.phone || '',
                        },
                        metadata: {
                            pagamento:        appt?.payment_method || '',
                            descrizione_idea: appt?.notes || '',
                        },
                        timeZone: 'Europe/Rome',
                        language: 'it',
                    },
                }),
            });
            if (!calResp.ok) {
                const calErrBody = await calResp.json().catch(() => null);
                console.warn('[Cal.com reschedule] risposta non OK:', calErrBody);
                showToast('⚠️ Approvato nel gestionale, ma la sincronizzazione del calendario non è riuscita.', 5000);
            }
        } catch (calNetErr) {
            console.warn('[Cal.com reschedule] errore rete:', calNetErr);
        }

        // Email personalizzata al cliente via Gmail (RescheduleNotify workflow)
        const formattedDate = new Date(newScheduledAt).toLocaleDateString('it-IT', { weekday:'long', day:'2-digit', month:'long', year:'numeric', timeZone: 'Europe/Rome' });
        fetch(RESCHEDULE_N8N_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_email: clientEmail,
                client_name:  clientName,
                esito:        'accepted',
                new_date:     formattedDate,
                new_time:     newTime,
                irene_notes:  '',
            }),
        }).catch(e => console.warn('[RescheduleNotify] email non inviata:', e));

        // Ricarica
        await loadNotifications();
        allAppointments = allAppointments.map(a => a.id === apptId ? { ...a, scheduled_at: newScheduledAt } : a);

    } catch(e) {
        console.error('[acceptReschedule]', e);
        showToast('Errore nell\'accettare la richiesta: ' + e.message, 4000, true);
        if (item) item.style.opacity = '1';
    }
}

async function confirmReject(requestId, clientId, clientEmail, clientName) {
    const notes = (document.getElementById('rejectNote-' + requestId)?.value || '').trim();
    const item  = document.getElementById('rri-' + requestId);
    if (item) item.style.opacity = '0.5';

    try {
        const { error } = await db.from('reschedule_requests')
            .delete()
            .eq('id', requestId);

        if (error) throw new Error(error.message);

        // Email al cliente via n8n
        try {
            await fetch(RESCHEDULE_N8N_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_email: clientEmail,
                    client_name:  clientName,
                    esito:        'rejected',
                    new_date:     '',
                    new_time:     '',
                    irene_notes:  notes,
                }),
            });
        } catch(e) { console.warn('n8n email non inviata', e); }

        await loadNotifications();

    } catch(e) {
        console.error('[confirmReject]', e);
        showToast('Errore nel rifiutare la richiesta: ' + e.message, 4000, true);
        if (item) item.style.opacity = '1';
    }
}

// Formatta requested_time per la visualizzazione: accetta ISO completo o etichetta "HH:MM"
function fmtReqTime(t) {
    if (!t) return '';
    if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
        return new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
    }
    return t;
}

function formatTimeAgo(dateStr) {
    const diff  = Date.now() - new Date(dateStr).getTime();
    const mins  = Math.floor(diff / 60000);
    if (mins < 1)   return 'adesso';
    if (mins < 60)  return `${mins} min fa`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ore fa`;
    const days  = Math.floor(hours / 24);
    if (days < 7)   return `${days} giorni fa`;
    return new Date(dateStr).toLocaleDateString('it-IT');
}

// ============================================
const PORTFOLIO_BUCKET = 'portfolio-gallery';
let portfolioLoaded    = false;  // evita doppio caricamento
let portfolioItems     = [];     // cache locale

function setupPortfolio() {
    const dropZone   = document.getElementById('portfolioDropZone');
    const fileInput  = document.getElementById('portfolioFileInput');
    const uploadBtn  = document.getElementById('portfolioUploadBtn');

    if (!dropZone) return;

    // Toggle tipo foto (Tatuaggio / Al Lavoro)
    document.querySelectorAll('.portfolio-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.portfolio-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const type = btn.dataset.type;
            document.getElementById('portfolioType').value = type;
            const catsField = document.getElementById('portfolioCatsField');
            if (catsField) catsField.style.display = type === 'al_lavoro' ? 'none' : '';
        });
    });

    // Apertura file picker al click sulla drop zone
    dropZone.addEventListener('click', () => fileInput.click());

    // Anteprima dopo selezione file
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;
        showPortfolioPreview(file);
        uploadBtn.disabled = false;
    });

    // Drag & drop (desktop)
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (!file || !file.type.startsWith('image/')) return;
        fileInput.files = e.dataTransfer.files;  // sincronizzo per la lettura in upload
        showPortfolioPreview(file);
        uploadBtn.disabled = false;
    });

    // Upload
    uploadBtn.addEventListener('click', uploadPortfolioPhoto);
}

function showPortfolioPreview(file) {
    const preview = document.getElementById('portfolioPreview');
    const wrap    = document.getElementById('portfolioPreviewWrap');
    if (!preview || !wrap) return;
    const reader = new FileReader();
    reader.onload = e => {
        preview.src = e.target.result;
        wrap.style.display = 'block';
    };
    reader.readAsDataURL(file);
}

async function uploadPortfolioPhoto() {
    const fileInput   = document.getElementById('portfolioFileInput');
    const title       = document.getElementById('portfolioTitle').value.trim();
    const desc        = document.getElementById('portfolioDesc').value.trim();
    const galleryType = document.getElementById('portfolioType')?.value || 'tatuaggio';
    const cats        = galleryType === 'tatuaggio'
        ? Array.from(document.querySelectorAll('.portfolio-cats input:checked')).map(cb => cb.value)
        : [];
    const file        = fileInput.files[0];
    const btn         = document.getElementById('portfolioUploadBtn');

    // Validazione
    if (!file) { showPortfolioMsg('Seleziona una foto.', 'error'); return; }
    if (file.size > 10 * 1024 * 1024) { showPortfolioMsg('File troppo grande (max 10 MB).', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Caricamento...';

    try {
        // 1. Carica immagine su Storage
        const folder = galleryType === 'al_lavoro' ? 'al-lavoro' : 'portfolio';
        const ext    = file.name.split('.').pop().toLowerCase() || 'jpg';
        const path   = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

        const { error: storageErr } = await db.storage
            .from(PORTFOLIO_BUCKET)
            .upload(path, file, { contentType: file.type, upsert: false });

        if (storageErr) throw storageErr;

        // 2. Inserisce record in DB
        const { data: inserted, error: dbErr } = await db
            .from('portfolio_gallery')
            .insert({
                storage_path: path,
                title:        title || '',
                description:  desc || (galleryType === 'tatuaggio' ? 'Realismo fotografico' : ''),
                categories:   cats,
                gallery_type: galleryType,
                sort_order:   portfolioItems.length
            })
            .select()
            .single();

        if (dbErr) throw dbErr;

        // 3. Aggiorna UI
        portfolioItems.push(inserted);
        renderPortfolioAdmin();
        resetPortfolioForm();
        showPortfolioMsg('Foto caricata con successo!', 'success');

    } catch (err) {
        console.error('Portfolio upload error:', err);
        showPortfolioMsg('Errore durante il caricamento: ' + (err.message || 'riprova'), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-upload"></i> Carica nel Portfolio';
    }
}

async function loadPortfolioAdmin() {
    if (portfolioLoaded) { renderPortfolioAdmin(); return; }

    const grid = document.getElementById('portfolioAdminGrid');
    if (!grid) return;

    grid.innerHTML = '<div class="admin-loading"><i class="fas fa-spinner fa-spin"></i></div>';

    const { data, error } = await db
        .from('portfolio_gallery')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });

    if (error) {
        grid.innerHTML = '<div class="empty-state">Errore nel caricamento del portfolio.</div>';
        return;
    }

    portfolioItems  = data || [];
    portfolioLoaded = true;
    renderPortfolioAdmin();
}

function renderPortfolioAdmin() {
    const grid  = document.getElementById('portfolioAdminGrid');
    const count = document.getElementById('portfolioCount');
    if (!grid) return;

    if (count) count.textContent = `(${portfolioItems.length} foto)`;

    if (portfolioItems.length === 0) {
        grid.innerHTML = '<div class="empty-state">Nessuna foto nel portfolio. Carica la prima!</div>';
        return;
    }

    grid.innerHTML = portfolioItems.map((item, idx) => {
        const { data: urlData } = db.storage.from(PORTFOLIO_BUCKET).getPublicUrl(item.storage_path);
        const url        = urlData.publicUrl;
        const cats       = (item.categories || []).join(', ');
        const isAlLavoro = item.gallery_type === 'al_lavoro';
        const badgeLabel = isAlLavoro ? 'Al Lavoro' : (cats || 'Tatuaggio');
        const isFirst    = idx === 0;
        const isLast     = idx === portfolioItems.length - 1;
        return `<div class="portfolio-admin-item" data-id="${item.id}">
            <img src="${url}" alt="${item.title || ''}" loading="lazy">
            <div class="portfolio-admin-info">
                <div class="portfolio-admin-title">${item.title || '—'}</div>
                <div class="portfolio-admin-cats">${badgeLabel}</div>
            </div>
            <div class="portfolio-sort-btns">
                <button class="portfolio-sort-btn" data-id="${item.id}" data-dir="up"
                    title="Sposta su" ${isFirst ? 'disabled' : ''}>
                    <i class="fas fa-chevron-up"></i>
                </button>
                <button class="portfolio-sort-btn" data-id="${item.id}" data-dir="down"
                    title="Sposta giù" ${isLast ? 'disabled' : ''}>
                    <i class="fas fa-chevron-down"></i>
                </button>
            </div>
            <button class="portfolio-delete-btn" data-id="${item.id}" data-path="${item.storage_path}" title="Elimina foto">
                <i class="fas fa-trash-alt"></i>
            </button>
        </div>`;
    }).join('');

    // Bind delete buttons
    grid.querySelectorAll('.portfolio-delete-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            deletePortfolioPhoto(btn.dataset.id, btn.dataset.path);
        });
    });

    // Bind sort buttons
    grid.querySelectorAll('.portfolio-sort-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            movePortfolioItem(btn.dataset.id, btn.dataset.dir);
        });
    });
}

async function deletePortfolioPhoto(id, storagePath) {
    if (!await customConfirm('Eliminare questa foto dal portfolio?')) return;

    const btn = document.querySelector(`.portfolio-delete-btn[data-id="${id}"]`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

    try {
        // 1. Elimina da Storage
        const { error: storageErr } = await db.storage
            .from(PORTFOLIO_BUCKET)
            .remove([storagePath]);
        if (storageErr) throw storageErr;

        // 2. Elimina da DB
        const { error: dbErr } = await db
            .from('portfolio_gallery')
            .delete()
            .eq('id', id);
        if (dbErr) throw dbErr;

        // 3. Aggiorna cache locale e UI
        portfolioItems = portfolioItems.filter(item => item.id !== id);
        renderPortfolioAdmin();

    } catch (err) {
        console.error('Portfolio delete error:', err);
        showToast('Errore durante l\'eliminazione: ' + (err.message || 'riprova'), 4000, true);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash-alt"></i>'; }
    }
}

async function movePortfolioItem(id, direction) {
    const idx = portfolioItems.findIndex(i => i.id === id);
    if (idx === -1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= portfolioItems.length) return;

    // Scambia posizioni nell'array locale
    [portfolioItems[idx], portfolioItems[targetIdx]] = [portfolioItems[targetIdx], portfolioItems[idx]];

    // Aggiorna sort_order dei due elementi basandosi sulla nuova posizione
    portfolioItems[idx].sort_order      = idx;
    portfolioItems[targetIdx].sort_order = targetIdx;

    // Aggiorna UI subito (ottimistico)
    renderPortfolioAdmin();

    try {
        await Promise.all([
            db.from('portfolio_gallery').update({ sort_order: idx }).eq('id', portfolioItems[idx].id),
            db.from('portfolio_gallery').update({ sort_order: targetIdx }).eq('id', portfolioItems[targetIdx].id),
        ]);
    } catch (err) {
        // Rollback in caso di errore
        [portfolioItems[idx], portfolioItems[targetIdx]] = [portfolioItems[targetIdx], portfolioItems[idx]];
        renderPortfolioAdmin();
        console.error('Move error:', err);
    }
}

function showPortfolioMsg(text, type) {
    const msg = document.getElementById('portfolioUploadMsg');
    if (!msg) return;
    msg.textContent = text;
    msg.style.display = 'block';
    msg.style.background = type === 'success' ? 'rgba(85,201,122,0.15)' : 'rgba(224,85,85,0.15)';
    msg.style.color       = type === 'success' ? 'var(--green)' : 'var(--red)';
    msg.style.border      = `1px solid ${type === 'success' ? 'var(--green)' : 'var(--red)'}`;
    msg.style.borderRadius = '8px';
    msg.style.padding      = '10px 14px';
    msg.style.fontSize     = '0.875rem';
    msg.style.marginBottom = '14px';
    setTimeout(() => { msg.style.display = 'none'; }, 4000);
}

function resetPortfolioForm() {
    document.getElementById('portfolioFileInput').value = '';
    document.getElementById('portfolioTitle').value     = '';
    document.getElementById('portfolioDesc').value      = '';
    document.querySelectorAll('.portfolio-cats input').forEach(cb => cb.checked = false);
    document.getElementById('portfolioPreviewWrap').style.display = 'none';
    document.getElementById('portfolioUploadBtn').disabled = true;
    // Reset tipo → Tatuaggio
    document.getElementById('portfolioType').value = 'tatuaggio';
    document.querySelectorAll('.portfolio-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === 'tatuaggio'));
    const catsField = document.getElementById('portfolioCatsField');
    if (catsField) catsField.style.display = '';
}

// ============================================
// VOUCHER — CLIENT DETAIL
// ============================================
function voucherStatusAdmin(v) {
    if (v.status === 'used' || v.used_at) return 'used';
    if (v.status === 'expired' || (v.expires_at && new Date(v.expires_at) < new Date())) return 'expired';
    return 'active';
}

function renderClientVouchers(list, client) {
    const el = document.getElementById('clientDetailVouchers');
    if (!el) return;
    if (!list || list.length === 0) {
        el.innerHTML = '<div class="empty-state">Nessun voucher</div>';
        return;
    }
    el.innerHTML = list.map(v => {
        const status = voucherStatusAdmin(v);
        const badgeMap = { active: 'badge-active', expired: 'badge-expired', used: 'badge-used' };
        const labelMap = { active: 'ATTIVO', expired: 'SCADUTO', used: 'USATO' };
        const exp = v.expires_at ? new Date(v.expires_at).toLocaleDateString('it-IT') : '—';
        const usedOn = v.used_at ? new Date(v.used_at).toLocaleDateString('it-IT') : null;
        const msgText = v.message || v.gift_message || '';
        return `
        <div class="voucher-detail-card" id="vcard-${v.id}">
            <div class="vdc-header">
                <span class="vdc-code">${v.code || v.id}</span>
                <span class="badge ${badgeMap[status]}">${labelMap[status]}</span>
            </div>
            <div class="vdc-info">
                <div class="vdc-info-item">
                    <span class="vdc-label">Valore</span>
                    <span class="vdc-value">€${v.amount ?? v.value_eur ?? 0}</span>
                </div>
                <div class="vdc-info-item">
                    <span class="vdc-label">Scadenza</span>
                    <span class="vdc-value">${exp}</span>
                </div>
                ${v.sender_name ? `
                <div class="vdc-info-item">
                    <span class="vdc-label">Da</span>
                    <span class="vdc-value">${v.sender_name}</span>
                </div>` : ''}
                ${msgText ? `
                <div class="vdc-info-item vdc-full">
                    <span class="vdc-label">Messaggio</span>
                    <span class="vdc-value" style="font-style:italic;">"${msgText}"</span>
                </div>` : ''}
                ${usedOn ? `
                <div class="vdc-info-item vdc-full">
                    <span class="vdc-label">Usato il</span>
                    <span class="vdc-value">${usedOn}${v.irene_notes ? ' · ' + v.irene_notes : ''}</span>
                </div>` : ''}
            </div>
            ${status === 'active' ? `
            <div id="markUsedForm-${v.id}" class="mark-used-form vdc-form">
                <input type="text" id="markUsedNote-${v.id}" placeholder="Note (opzionale)" class="vdc-note-input">
                <div class="vdc-form-btns">
                    <button onclick="confirmMarkUsed('${v.id}')" class="vdc-btn-confirm"><i class="fas fa-check"></i> Conferma</button>
                    <button onclick="document.getElementById('markUsedForm-${v.id}').style.display='none'" class="vdc-btn-cancel">Annulla</button>
                </div>
            </div>
            <button class="btn-mark-used" onclick="markVoucherUsed('${v.id}')" style="margin-top:10px;width:100%;">
                <i class="fas fa-check-circle"></i> Segna come usato
            </button>` : ''}
        </div>`;
    }).join('');
}

function markVoucherUsed(voucherId) {
    const form = document.getElementById('markUsedForm-' + voucherId);
    if (form) {
        form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    }
}

async function confirmMarkUsed(voucherId) {
    const noteInput = document.getElementById('markUsedNote-' + voucherId);
    const notes = noteInput ? noteInput.value.trim() : '';
    const { error } = await db
        .from('vouchers')
        .update({ used_at: new Date().toISOString(), irene_notes: notes || null })
        .eq('id', voucherId);
    if (error) {
        showToast('Errore: ' + error.message, 4000, true);
        return;
    }
    // Ricarica sezione voucher del cliente corrente
    const vcard = document.getElementById('vcard-' + voucherId);
    if (vcard) {
        const usedDate = new Date().toLocaleDateString('it-IT');
        vcard.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span style="font-family:monospace;color:var(--gold);font-size:0.9rem;">${voucherId}</span>
            <span class="badge badge-used">USATO</span>
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">Usato il ${usedDate}${notes ? ' — ' + notes : ''}</div>`;
    }
    // Aggiorna anche tabella admin se aperta
    if (allVouchersAdmin.length) {
        const idx = allVouchersAdmin.findIndex(v => v.id === voucherId);
        if (idx >= 0) {
            allVouchersAdmin[idx].used_at = new Date().toISOString();
            allVouchersAdmin[idx].irene_notes = notes || null;
            renderVouchersAdminTable(allVouchersAdmin);
        }
    }
}

// ============================================
// VOUCHER — SEZIONE ADMIN
// ============================================
async function loadAllVouchersAdmin() {
    const { data, error } = await db
        .from('vouchers')
        .select('*')
        .order('created_at', { ascending: false });
    if (!error) {
        allVouchersAdmin = data || [];
        const countEl = document.getElementById('vouchersCount');
        if (countEl) countEl.textContent = allVouchersAdmin.length;
        renderVouchersAdminTable(allVouchersAdmin);
    }
    // Pre-popola data scadenza (+1 anno)
    const expInput = document.getElementById('newVoucherExpiry');
    if (expInput && !expInput.value) {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        expInput.value = d.toISOString().split('T')[0];
    }
}

function renderVouchersAdminTable(list) {
    const el = document.getElementById('vouchersAdminTable');
    if (!el) return;
    if (!list || list.length === 0) {
        el.innerHTML = '<div class="empty-state">Nessun voucher</div>';
        return;
    }
    const header = `
    <div class="voucher-admin-row voucher-admin-header" style="font-size:0.75rem;color:var(--text-muted);font-weight:600;border-bottom:1px solid #333;">
        <span>CODICE</span><span>EMAIL</span><span>VALORE</span><span>STATO</span><span>CREATO</span><span></span>
    </div>`;
    const rows = list.map(v => {
        const status = voucherStatusAdmin(v);
        const badgeMap = { active: 'badge-active', expired: 'badge-expired', used: 'badge-used' };
        const labelMap = { active: 'ATTIVO', expired: 'SCADUTO', used: 'USATO' };
        const created = v.created_at ? new Date(v.created_at).toLocaleDateString('it-IT') : '—';
        const email = v.recipient_email || '—';
        return `
        <div class="voucher-admin-row">
            <span style="font-family:monospace;color:var(--gold);font-size:0.82rem;">${v.code || v.id}</span>
            <span style="font-size:0.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${email}">${email}</span>
            <span style="font-size:0.85rem;">€${v.amount ?? v.value_eur ?? 0}</span>
            <span><span class="badge ${badgeMap[status]}">${labelMap[status]}</span></span>
            <span style="font-size:0.8rem;color:var(--text-muted);">${created}</span>
            <span>
                ${status === 'active' ? `<button class="btn-mark-used" onclick="markVoucherUsedAdmin('${v.id}')"><i class="fas fa-check"></i> Usato</button>` : ''}
            </span>
        </div>`;
    }).join('');
    el.innerHTML = header + rows;
}

async function markVoucherUsedAdmin(voucherId) {
    if (!await customConfirm('Segnare il voucher ' + voucherId + ' come usato?')) return;
    _pendingVoucherId = voucherId;
    document.getElementById('voucherNotesInput').value = '';
    document.getElementById('voucherNotesModal').style.display = 'flex';
}

let _pendingVoucherId = null;
function closeVoucherNotesModal() {
    document.getElementById('voucherNotesModal').style.display = 'none';
    _pendingVoucherId = null;
}
async function confirmVoucherNotes() {
    const notes = document.getElementById('voucherNotesInput').value.trim() || null;
    const voucherId = _pendingVoucherId;
    closeVoucherNotesModal();
    const { error } = await db
        .from('vouchers')
        .update({ used_at: new Date().toISOString(), irene_notes: notes })
        .eq('id', voucherId);
    if (error) { showToast('Errore: ' + error.message, 4000, true); return; }
    await loadAllVouchersAdmin();
    showToast('Voucher segnato come usato.');
}

function filterVouchersAdmin(filter) {
    document.querySelectorAll('.voucher-filter-tabs .filter-chip').forEach(b => {
        b.classList.toggle('active', b.getAttribute('onclick').includes("'" + filter + "'"));
    });
    if (filter === 'all') {
        renderVouchersAdminTable(allVouchersAdmin);
        return;
    }
    const filtered = allVouchersAdmin.filter(v => voucherStatusAdmin(v) === filter);
    renderVouchersAdminTable(filtered);
}

function generateVoucherCode() {
    const now = new Date();
    const d = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const r = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `IGT-${d}-${r}`;
}

async function createVoucherManual() {
    const emailVal  = (document.getElementById('newVoucherEmail')?.value || '').trim().toLowerCase();
    const valueVal  = parseInt(document.getElementById('newVoucherValue')?.value || '0', 10);
    const msgVal    = (document.getElementById('newVoucherMsg')?.value || '').trim();
    const expiryVal = document.getElementById('newVoucherExpiry')?.value || '';
    const msgEl     = document.getElementById('createVoucherMsg');
    const btn       = document.getElementById('createVoucherBtn');

    if (!valueVal || valueVal < 1) {
        if (msgEl) { msgEl.textContent = 'Inserisci un valore valido.'; msgEl.style.color = 'var(--red)'; }
        return;
    }

    if (btn) btn.disabled = true;
    if (msgEl) { msgEl.textContent = 'Creazione...'; msgEl.style.color = 'var(--text-muted)'; }

    const code = generateVoucherCode();
    const expires = expiryVal ? new Date(expiryVal).toISOString() : (() => {
        const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString();
    })();

    const { error } = await db.from('vouchers').insert({
        id:              code,
        code:            code,
        amount:          valueVal,
        value_eur:       valueVal,
        status:          'active',
        recipient_email: emailVal || null,
        sender_name:     'Irene Gipsy Tattoo',
        message:         msgVal || null,
        gift_message:    msgVal || null,
        service_type:    'Tatuaggio',
        expires_at:      expires,
        created_at:      new Date().toISOString()
    });

    if (btn) btn.disabled = false;

    if (error) {
        if (msgEl) { msgEl.textContent = 'Errore: ' + error.message; msgEl.style.color = 'var(--red)'; }
        return;
    }

    if (msgEl) {
        msgEl.innerHTML = `<i class="fas fa-check-circle" style="color:var(--green)"></i> Voucher creato: <strong style="color:var(--gold);font-family:monospace;">${code}</strong>`;
        msgEl.style.color = 'var(--green)';
    }

    // Reset form
    if (document.getElementById('newVoucherEmail'))  document.getElementById('newVoucherEmail').value  = '';
    if (document.getElementById('newVoucherValue'))  document.getElementById('newVoucherValue').value  = '';
    if (document.getElementById('newVoucherMsg'))    document.getElementById('newVoucherMsg').value    = '';

    await loadAllVouchersAdmin();
}

// ============================================
// CANCELLAZIONE APPUNTAMENTO (Irene)
// ============================================
let _cancelApptData = null; // { id, clientEmail, clientName, scheduledAt }

function openCancelModal(apptId, clientEmail, clientName, scheduledAt) {
    _cancelApptData = { id: apptId, clientEmail, clientName, scheduledAt };
    const dt = scheduledAt
        ? new Date(scheduledAt).toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
        : '—';
    document.getElementById('cancelApptInfo').textContent =
        `${clientName} — ${dt}`;
    document.getElementById('cancelApptConfirmBtn').disabled = false;
    document.getElementById('cancelApptModal').style.display = 'flex';
}

function closeCancelModal() {
    document.getElementById('cancelApptModal').style.display = 'none';
    _cancelApptData = null;
}

async function confirmCancelAppointment() {
    if (!_cancelApptData) return;
    const btn = document.getElementById('cancelApptConfirmBtn');
    btn.disabled = true;
    btn.textContent = 'Annullamento…';

    const { id: apptId, clientEmail, clientName, scheduledAt } = _cancelApptData;

    // 1. Leggi cal_booking_uid FRESCO da Supabase (potrebbe essere stato salvato da n8n in modo asincrono)
    const appt = allAppointments.find(a => a.id === apptId) || {};
    const { data: freshApptData } = await db.from('appointments').select('cal_booking_uid').eq('id', apptId).single();
    const calUid = freshApptData?.cal_booking_uid || appt.cal_booking_uid || null;

    // 2. Elimina da Supabase
    const { error } = await db
        .from('appointments')
        .delete()
        .eq('id', apptId);

    if (error) {
        btn.disabled = false;
        btn.textContent = 'Conferma annullamento';
        showToast('Errore durante l\'eliminazione: ' + error.message, 4000, true);
        return;
    }

    // 3. Rimuovi dalla memoria
    const idx = allAppointments.findIndex(a => a.id === apptId);
    if (idx !== -1) allAppointments.splice(idx, 1);

    // 4. Chiama n8n (fire-and-forget)
    fetch(CANCEL_N8N_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            appointment_id:   apptId,
            cal_booking_uid:  calUid,
            appointment_type: appt.type || null,
            client_email:     clientEmail,
            client_name:      clientName,
            scheduled_at:     scheduledAt,
        }),
    }).catch(e => console.warn('[Cancel n8n] non inviato:', e));

    // 4. Re-render UI
    renderOverview();
    const detailEl = document.getElementById('clientDetail');
    if (detailEl && detailEl.style.display !== 'none') {
        const titleEl = document.getElementById('clientDetailName');
        const c = allClients.find(cl =>
            `${cl.first_name || ''} ${cl.last_name || ''}`.trim() === (titleEl?.textContent || '').trim()
        );
        if (c) openClientDetail(c.id);
    }

    // 5. Hole detection: se era una seduta, offri il posto
    if (appt.type === 'seduta' && appt.scheduled_at) {
        closeCancelModal();
        const cancelReason = encodeURIComponent(`Seduta di ${clientName} cancellata da te.`);
        openFreedSlotModal(appt.scheduled_at, apptId, null, cancelReason);
    } else {
        closeCancelModal();
    }
}

// ─── FREED SLOT MODAL ───────────────────────────────────────────────────────

let _freedSlotScheduledAt = null;
let _freedSlotApptId      = null;
let _freedSlotNotifId     = null;

function openFreedSlotModal(scheduledAt, apptId, notifId, reason) {
    _freedSlotScheduledAt = scheduledAt;
    _freedSlotApptId      = apptId || null;
    _freedSlotNotifId     = notifId || null;
    const label = new Date(scheduledAt).toLocaleDateString('it-IT',
        { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    document.getElementById('freedSlotDateLabel').textContent = label;
    const reasonEl = document.getElementById('freedSlotReasonLabel');
    const decodedReason = reason ? decodeURIComponent(reason) : '';
    if (decodedReason) {
        reasonEl.textContent = decodedReason;
        reasonEl.style.display = 'block';
    } else {
        reasonEl.style.display = 'none';
    }
    document.getElementById('freedSlotChoices').style.display      = 'flex';
    document.getElementById('freedSlotClientPicker').style.display = 'none';
    document.getElementById('freedSlotModal').style.display         = 'flex';
}

function closeFreedSlotModal() {
    document.getElementById('freedSlotModal').style.display = 'none';
}

async function freedSlotTappabuchi() {
    closeFreedSlotModal();
    if (_freedSlotNotifId) await markAsRead(_freedSlotNotifId);
    await triggerAutoOffer(_freedSlotScheduledAt, _freedSlotApptId);
}

// Manuale: apre il picker clienti (step 2)
function freedSlotManuale() {
    document.getElementById('freedSlotChoices').style.display      = 'none';
    document.getElementById('freedSlotClientPicker').style.display = 'block';
    document.getElementById('freedSlotClientSearch').value         = '';
    renderFreedSlotClientList('');
}

function freedSlotBackToChoices() {
    document.getElementById('freedSlotClientPicker').style.display = 'none';
    document.getElementById('freedSlotChoices').style.display      = 'flex';
}

function renderFreedSlotClientList(query) {
    const q = (query || '').toLowerCase();
    const filtered = allClients
        .filter(c => `${c.first_name || ''} ${c.last_name || ''} ${c.last_name || ''} ${c.first_name || ''}`.toLowerCase().includes(q))
        .sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''))
        .slice(0, 10);
    document.getElementById('freedSlotClientList').innerHTML = filtered.length
        ? filtered.map(c => {
            const displayName = `${c.last_name || ''} ${c.first_name || ''}`.trim();
            return `
            <div onclick="freedSlotSelectClient('${c.id}','${displayName.replace(/'/g,"\\'")}')"
                style="padding:9px 12px;border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);font-size:0.85rem;color:#ddd;transition:background 0.15s;"
                onmouseover="this.style.background='rgba(212,175,55,0.08)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
                ${displayName}
            </div>`;
        }).join('')
        : '<p style="font-size:0.82rem;color:#555;text-align:center;padding:12px 0;">Nessun cliente trovato</p>';
}

async function freedSlotSelectClient(clientId, clientName) {
    const name = clientName || 'questo cliente';
    if (!await customConfirm(`Inviare offerta di posto anticipato a ${name}?`)) return;
    closeFreedSlotModal();
    if (_freedSlotNotifId) await markAsRead(_freedSlotNotifId);
    await triggerAutoOffer(_freedSlotScheduledAt, _freedSlotApptId, false, clientId);
}

// Libera: non fare nulla (segna notifica come letta se presente)
async function freedSlotLibera() {
    if (_freedSlotNotifId) await markAsRead(_freedSlotNotifId);
    closeFreedSlotModal();
}

// Ferie: usa freedSlotSetRiposo con i dati del modal (si chiude solo su successo)
async function freedSlotFerie() {
    const done = await freedSlotSetRiposo(_freedSlotScheduledAt, _freedSlotNotifId);
    if (done) closeFreedSlotModal();
}

// ============================================
// IRENE PROPONE NUOVA DATA
// ============================================
let irschState = {
    apptId: null, clientId: null, clientEmail: null, clientName: null,
    year: null, month: null,      // 0-indexed month
    availableDates: [],           // array di stringhe 'YYYY-MM-DD'
    slotsByDate: {},              // { 'YYYY-MM-DD': ['HH:MM', ...] }
    loadedMonths: new Set(),      // mesi già caricati
    isLoading: false,
    selectedDate: null,
    selectedTime: null,
};

function openIreneRescheduleModal(apptId, clientId, clientEmail, clientName, apptType = 'consulenza') {
    const now = new Date();
    const appt = allAppointments.find(a => a.id === apptId);
    irschState = {
        apptId, clientId, clientEmail, clientName, apptType,
        scheduledAt: appt?.scheduled_at || null,
        consultationMode: appt?.consultation_mode || 'integrations:whatsapp_video',
        freeMode: false, // Irene usa sempre slot Cal.com (admin event types, tutti i giorni disponibili)
        year: now.getFullYear(), month: now.getMonth(),
        availableDates: [], slotsByDate: {}, loadedMonths: new Set(), isLoading: false,
        selectedDate: null, selectedTime: null,
    };
    if (apptType === 'seduta') {
        document.getElementById('irschChoiceModal').style.display = 'flex';
    } else {
        openIrschCalendarModal();
    }
}

function openIrschCalendarModal() {
    document.getElementById('ireneRschApptId').value      = irschState.apptId;
    document.getElementById('ireneRschClientId').value    = irschState.clientId;
    document.getElementById('ireneRschClientEmail').value = irschState.clientEmail;
    document.getElementById('ireneRschClientName').value  = irschState.clientName;
    document.getElementById('ireneRschReason').value      = '';
    document.getElementById('ireneRschMsg').textContent   = '';
    document.getElementById('ireneRschSubmitBtn').disabled = true;
    document.getElementById('irschSlots').style.display    = 'none';
    document.getElementById('irschReasonField').style.display = 'none';
    document.getElementById('irschFreeTimeField').style.display = 'none';
    // Mostra/nasconde campo modalità (solo per consulenza e pre-seduta)
    const showMode = ['consulenza', 'pre-seduta'].includes(irschState.apptType);
    const modeField = document.getElementById('irschModeField');
    if (modeField) {
        modeField.style.display = showMode ? 'block' : 'none';
        if (showMode) irschSetMode(irschState.consultationMode || 'integrations:whatsapp_video');
    }
    document.getElementById('ireneRescheduleModal').style.display = 'flex';
    irschRenderCalendar();
    if (!irschState.freeMode) irschFetchMonthSlots();
}

function irschSetMode(mode) {
    irschState.consultationMode = mode;
    const isWhatsapp = mode === 'integrations:whatsapp_video';
    const wBtn = document.getElementById('irschModeWhatsapp');
    const sBtn = document.getElementById('irschModeStudio');
    const activeStyle  = 'background:rgba(212,175,55,0.18);border-color:rgba(212,175,55,0.7);color:#D4AF37;';
    const inactiveStyle = 'background:transparent;border-color:#333;color:#555;';
    if (wBtn) wBtn.style.cssText = wBtn.style.cssText.replace(/background[^;]+;|border-color[^;]+;|color[^;]+;/g, '') + (isWhatsapp ? activeStyle : inactiveStyle);
    if (sBtn) sBtn.style.cssText = sBtn.style.cssText.replace(/background[^;]+;|border-color[^;]+;|color[^;]+;/g, '') + (!isWhatsapp ? activeStyle : inactiveStyle);
}

function irschChooseManual() {
    document.getElementById('irschChoiceModal').style.display = 'none';
    openIrschCalendarModal();
}

async function irschChooseAuto() {
    document.getElementById('irschChoiceModal').style.display = 'none';
    triggerAutoOffer();
}

function irschChooseSblocca() {
    document.getElementById('irschChoiceModal').style.display = 'none';
    if (irschState.clientId) {
        openBookingUnlockModal(irschState.clientId);
    }
}

async function saveAmountPaid(apptId, clientId) {
    const input = document.getElementById(`paid_${apptId}`);
    if (!input) return;
    const val = parseInt(input.value) || 0;
    const { error } = await db.from('appointments').update({ amount_paid: val }).eq('id', apptId);
    if (error) { showToast('Errore: ' + error.message, 4000, true); return; }
    const appt = allAppointments.find(a => a.id === apptId);
    if (appt) appt.amount_paid = val;
    refreshClientDetailPayments(clientId);
}

async function togglePagato(apptId, amount, amountPaid, clientId) {
    const appt = allAppointments.find(a => a.id === apptId);
    const alreadyPaid = amountPaid >= amount;
    const hasMethod = appt && appt.acconto_payment_method;

    // Se già pagato → chiedi sempre conferma prima di azzerare
    if (alreadyPaid) {
        const method = appt && appt.acconto_payment_method
            ? (appt.acconto_payment_method === 'contanti' ? 'Contanti' : appt.acconto_payment_method === 'pos' ? 'POS' : 'Online (PayPal)')
            : 'importo registrato';
        const ok = await customConfirm(`⚠️ Acconto già pagato (${method}).\nVuoi davvero azzerarlo?\nQuesta operazione modifica un dato contabile.`);
        if (!ok) return;
    }

    const newPaid = alreadyPaid ? 0 : amount;
    const { error } = await db.from('appointments').update({ amount_paid: newPaid }).eq('id', apptId);
    if (error) { showToast('Errore: ' + error.message, 4000, true); return; }
    if (appt) appt.amount_paid = newPaid;
    refreshClientDetailPayments(clientId);
}

let _customPriceCtx = null;

// Aggiorna solo pagamenti + timeline senza ricaricare gallery/voucher/consensi
function refreshClientDetailPayments(clientId) {
    const client = allClients.find(c => c.id === clientId);
    if (!client) return;

    // Riepilogo pagamenti sedute
    const sedutePagate = allAppointments.filter(a =>
        a.client_id === clientId && a.type === 'seduta' && a.status !== 'cancelled'
    );
    const payEl = document.getElementById('clientDetailPayments');
    if (payEl) {
        if (sedutePagate.length > 0) {
            const totaleAcconti = sedutePagate.reduce((s, a) => s + (a.amount_paid || 0), 0);
            const totaleSedute  = sedutePagate.reduce((s, a) => s + (a.session_price || 0), 0);
            const totaleCliente = totaleAcconti + totaleSedute;
            const totPos        = sedutePagate.filter(a => a.session_payment_method === 'pos').reduce((s, a) => s + (a.session_price || 0), 0);
            const totContanti   = sedutePagate.filter(a => a.session_payment_method === 'contanti').reduce((s, a) => s + (a.session_price || 0), 0);
            const pagamRow = (totPos > 0 || totContanti > 0) ? `
                <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:0.78rem;padding:4px 0;color:#888;justify-content:center;">
                    ${totPos > 0 ? `<span>💳 POS: <strong style="color:#63b3ed;">€${totPos}</strong></span>` : ''}
                    ${totContanti > 0 ? `<span>💵 Contanti: <strong style="color:#6dc07c;">€${totContanti}</strong></span>` : ''}
                </div>` : '';
            payEl.innerHTML = `
            <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.82rem;padding:10px 0;">
                <span>Acconti: <strong style="color:#6dc07c;">€${totaleAcconti}</strong></span>
                <span>Sedute: <strong style="color:var(--gold);">€${totaleSedute}</strong></span>
                <span style="border-left:1px solid #333;padding-left:16px;">Totale: <strong style="color:#fff;font-size:0.9rem;">€${totaleCliente}</strong></span>
            </div>
            ${pagamRow}`;
        } else {
            payEl.innerHTML = '';
        }
    }

    // Appuntamenti del ciclo attivo (tattoo_cycle IS NULL = tatuaggio in corso)
    const appts = allAppointments.filter(a => a.client_id === clientId && a.tattoo_cycle == null)
        .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));

    // Mostra "Sblocca prenotazione" solo se non ha sedute attive
    const hasActiveSeduta = appts.some(a => a.type === 'seduta' && ['pending','confirmed'].includes(a.status));
    const unlockBtn = document.getElementById('bookingUnlockBtn');
    if (unlockBtn) unlockBtn.style.display = hasActiveSeduta ? 'none' : 'inline-flex';

    // Aggiorna storico tatuaggi completati
    renderTattooStorico(clientId);
    const apptEl = document.getElementById('clientDetailAppointments');
    if (!apptEl) return;
    if (appts.length === 0) {
        apptEl.innerHTML = '<div class="empty-state">Nessun appuntamento</div>';
        return;
    }
    apptEl.innerHTML = `<div class="appt-timeline">${appts.map(a => {
        const dotColor = { pending: 'var(--orange)', confirmed: 'var(--green)', completed: 'var(--blue)', cancelled: 'var(--red)' }[a.status] || 'var(--text-muted)';
        const isActionable = ['consulenza','seduta','pre-seduta'].includes(a.type) && (a.status === 'confirmed' || a.status === 'pending');
        const safeEmail = (client.email || '').replace(/'/g, "\\'");
        const safeName  = (`${client.first_name || ''} ${client.last_name || ''}`).replace(/'/g, "\\'");
        const safeDate  = (a.scheduled_at || '').replace(/'/g, "\\'");
        const BTN_S = 'display:inline-flex;align-items:center;justify-content:center;width:46px;height:32px;border-radius:7px;cursor:pointer;font-size:1.04rem;border:1px solid;transition:opacity .15s;';
        const stdPrices = Array.from({length:15},(_,i)=>300+i*50);
        const isCustomPrice = a.session_price && !stdPrices.includes(Number(a.session_price));
        return `
        <div class="appt-row" style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;">
            <div style="text-align:center;">
                <div style="font-size:0.88rem;font-weight:600;color:var(--gold);">${formatDate(a.scheduled_at)}</div>
                <div style="font-size:0.78rem;color:#fff;font-weight:500;margin-top:3px;text-transform:uppercase;">${typeLabel(a.type)}</div>
                <div style="font-size:0.78rem;color:#888;margin-top:2px;">${formatTime(a.scheduled_at)}</div>
                ${a.type === 'seduta' ? sedutaOrderChip(a.id, clientId) : ''}
            </div>
            <div class="appt-row-content" style="min-width:0;flex:0 0 88px;width:88px;text-align:center;">
                ${a.type === 'seduta' && a.status !== 'cancelled' ? `
                <div style="display:flex;flex-direction:column;gap:4px;align-items:stretch;width:100%;">
                    ${a.amount ? (() => {
                        const accMethod = a.acconto_payment_method || (((a.amount_paid||0) >= a.amount) ? 'paypal' : '');
                        const paid = (a.amount_paid||0) >= a.amount;
                        const accLabel = accMethod === 'contanti' ? 'Contanti' : (accMethod === 'pos' || accMethod === 'paypal') ? 'POS' : '';
                        const isCard = accMethod === 'pos' || accMethod === 'paypal';
                        const bg = !paid ? 'rgba(248,113,113,0.1)' : accMethod === 'contanti' ? 'rgba(109,192,124,0.15)' : isCard ? 'rgba(99,179,237,0.12)' : 'transparent';
                        const bc = !paid ? '#f87171' : accMethod === 'contanti' ? '#6dc07c' : isCard ? 'rgba(99,179,237,0.5)' : '#333';
                        const col = !paid ? '#f87171' : accMethod === 'contanti' ? '#6dc07c' : isCard ? '#63b3ed' : '#555';
                        const accIcon = !paid ? '<i class="fas fa-coins"></i>' : accMethod === 'contanti' ? '💵' : isCard ? '💳' : '<i class="fas fa-coins"></i>';
                        return `<button onclick="togglePagato('${a.id}',${a.amount},${a.amount_paid||0},'${clientId}')"
                            style="font-size:0.7rem;padding:0 8px;height:32px;box-sizing:border-box;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px;width:100%;
                            background:${bg};border:1px solid ${bc};color:${col};">
                            ${accIcon}${paid?' ✓':' ✗'}${accLabel ? `<span style="font-size:0.6rem;opacity:0.85;">${accLabel}</span>` : ''}
                        </button>`;
                    })() : ''}
                    <select onchange="handlePriceSelect('${a.id}','${clientId}',this.value)"
                        id="price-sel-${a.id}"
                        style="font-size:0.7rem;padding:0 5px;height:32px;box-sizing:border-box;border-radius:6px;background:#1a1a1a;
                        border:1px solid ${a.session_price?'rgba(212,175,55,0.5)':'#333'};
                        color:${a.session_price?'#D4AF37':'#666'};cursor:pointer;width:100%;">
                        <option value="" ${!a.session_price?'selected':''} style="color:#666;">Seduta €</option>
                        ${Array.from({length:15},(_,i)=>300+i*50).map(p=>`<option value="${p}" ${a.session_price==p?'selected':''} style="color:#fff;">€${p}</option>`).join('')}
                        ${isCustomPrice ? `<option value="${a.session_price}" selected style="color:#D4AF37;">€${a.session_price}</option>` : ''}
                        <option value="custom" style="color:#888;">✏ Altro…</option>
                    </select>
                    <button onclick="toggleSessionPaymentMethod('${a.id}','${clientId}','${a.session_payment_method||''}')"
                        style="font-size:0.7rem;padding:0 8px;height:32px;box-sizing:border-box;border-radius:6px;cursor:pointer;white-space:nowrap;width:100%;
                        background:${a.session_payment_method==='pos'?'rgba(99,179,237,0.12)':a.session_payment_method==='contanti'?'rgba(109,192,124,0.12)':'transparent'};
                        border:1px solid ${a.session_payment_method==='pos'?'rgba(99,179,237,0.5)':a.session_payment_method==='contanti'?'rgba(109,192,124,0.5)':'#333'};
                        color:${a.session_payment_method==='pos'?'#63b3ed':a.session_payment_method==='contanti'?'#6dc07c':'#555'};">
                        ${a.session_payment_method==='pos'?'💳 POS':a.session_payment_method==='contanti'?'💵 Contanti':'— Saldo'}
                    </button>
                </div>` : a.type === 'seduta' && a.amount ? `<div class="appt-row-amount">€${a.amount}</div>` : `
                ${(() => { const cm = cmodLabel(a.consultation_mode); const pm = a.payment_method && a.payment_method !== 'undefined' && a.payment_method !== 'null' ? a.payment_method : null; return ['consulenza','pre-seduta'].includes(a.type) && (cm || pm) ? `<div class="appt-row-meta" style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;">${cm ? `<span style="font-size:0.68rem;background:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.3);color:#D4AF37;padding:0 6px;height:26px;display:inline-flex;align-items:center;box-sizing:border-box;border-radius:4px;white-space:nowrap;"><i class="${cm.icon}" style="margin-right:4px;"></i>${cm.label}</span>` : ''}${pm ? `<span style="font-size:0.68rem;background:rgba(255,255,255,0.05);border:1px solid #333;color:#aaa;padding:0 6px;height:26px;display:inline-flex;align-items:center;box-sizing:border-box;border-radius:4px;white-space:nowrap;"><i class="fas fa-credit-card" style="margin-right:4px;"></i>${pm}</span>` : ''}</div>` : ''; })()}
                ${a.type === 'pre-seduta' && a.notes ? `<div style="font-size:0.68rem;color:#aaa;margin-top:3px;font-style:italic;text-align:center;">"${a.notes}"</div>` : ''}
                `}
            </div>
            <div class="appt-row-right" style="text-align:right;">
                ${badgeHtmlWithRsch(a.id, a.status, a.scheduled_at)}
                ${isActionable ? `<div style="display:flex;gap:4px;margin-top:6px;justify-content:center;">
                    <button title="Cambia data" onclick="openIreneRescheduleModal('${a.id}','${client.id}','${safeEmail}','${safeName}','${a.type}')" style="${BTN_S}border-color:rgba(212,175,55,0.4);background:rgba(212,175,55,0.12);color:#D4AF37;"><i class="fas fa-clock"></i></button>
                    <button title="Annulla" onclick="openCancelModal('${a.id}','${safeEmail}','${safeName}','${safeDate}')" style="${BTN_S}border-color:rgba(248,113,113,0.35);background:rgba(248,113,113,0.1);color:#f87171;"><i class="fas fa-times"></i></button>
                </div>` : ''}
            </div>
        </div>`;
    }).join('')}</div>`;
}

// ============================================
// STORICO TATUAGGI + COMPLETAMENTO CICLO
// ============================================

function renderTattooStorico(clientId) {
    const card = document.getElementById('clientTattooStoricoCard');
    const el   = document.getElementById('clientTattooStorico');
    if (!card || !el) return;

    // Prendi tutti gli appuntamenti con tattoo_cycle valorizzato
    const completed = allAppointments.filter(a => a.client_id === clientId && a.tattoo_cycle != null);
    if (completed.length === 0) { card.style.display = 'none'; return; }

    // Raggruppa per ciclo
    const cycles = {};
    completed.forEach(a => {
        const c = a.tattoo_cycle;
        if (!cycles[c]) cycles[c] = [];
        cycles[c].push(a);
    });

    const html = Object.keys(cycles).sort((a, b) => a - b).map(cycle => {
        const appts = cycles[cycle].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
        const sedute = appts.filter(a => a.type === 'seduta');
        const ordinals = ['Prima', 'Seconda', 'Terza', 'Quarta', 'Quinta', 'Sesta', 'Settima', 'Ottava', 'Nona', 'Decima'];

        // Range date del tatuaggio
        const allDates = appts.filter(a => a.scheduled_at).map(a => new Date(a.scheduled_at));
        const minDate = allDates.length ? new Date(Math.min(...allDates)) : null;
        const maxDate = allDates.length ? new Date(Math.max(...allDates)) : null;
        const rangeStr = minDate && maxDate
            ? (minDate.getFullYear() === maxDate.getFullYear()
                ? `${minDate.toLocaleDateString('it-IT',{month:'long',year:'numeric'})}`
                : `${minDate.toLocaleDateString('it-IT',{month:'short',year:'numeric'})} – ${maxDate.toLocaleDateString('it-IT',{month:'short',year:'numeric'})}`)
            : '—';

        const dateRows = sedute.map((s, i) => {
            const label = ordinals[i] || `Seduta ${i+1}`;
            const d = s.scheduled_at ? new Date(s.scheduled_at).toLocaleDateString('it-IT',{day:'2-digit',month:'long',year:'numeric'}) : '—';
            return `<div style="font-size:0.78rem;color:#888;display:flex;gap:8px;align-items:center;">
                <span style="color:#555;min-width:90px;">${label}</span>
                <span style="color:#ccc;">${d}</span>
            </div>`;
        }).join('');

        return `
        <div style="border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:rgba(255,255,255,0.02);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:0.85rem;font-weight:600;color:#D4AF37;">Tatuaggio #${cycle}</span>
                    <span style="font-size:0.72rem;color:#555;">${rangeStr}</span>
                </div>
                <span style="font-size:0.72rem;color:#555;">${sedute.length} sedut${sedute.length === 1 ? 'a' : 'e'}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;">${dateRows || '<span style="font-size:0.78rem;color:#555;font-style:italic;">Nessuna seduta</span>'}</div>
        </div>`;
    }).join('');

    el.innerHTML = html;
    card.style.display = '';
}

async function completeTattoo(clientId) {
    const client = allClients.find(c => c.id === clientId);
    if (!client) return;
    const name = `${client.first_name || ''} ${client.last_name || ''}`.trim();

    // Appuntamenti del ciclo attivo (tattoo_cycle IS NULL, non cancellati)
    const activeAppts = allAppointments.filter(a =>
        a.client_id === clientId && a.tattoo_cycle == null && a.status !== 'cancelled'
    );
    if (activeAppts.length === 0) {
        showToast('Nessun appuntamento attivo da archiviare.', 3000, true);
        return;
    }

    const sedute = activeAppts.filter(a => a.type === 'seduta');
    const confirmed = await customConfirm(
        `Segna tatuaggio di ${name} come completato?\n${sedute.length} sedut${sedute.length===1?'a':'e'} verranno archiviate. Il cliente potrà prenotare un nuovo ciclo.`
    );
    if (!confirmed) return;

    // Calcola prossimo numero di ciclo
    const existingCycles = allAppointments
        .filter(a => a.client_id === clientId && a.tattoo_cycle != null)
        .map(a => a.tattoo_cycle);
    const nextCycle = existingCycles.length > 0 ? Math.max(...existingCycles) + 1 : 1;

    const ids = activeAppts.map(a => a.id);

    // Aggiorna tutti in Supabase: tattoo_cycle = nextCycle, pending/confirmed → completed
    const { error } = await db.from('appointments')
        .update({ tattoo_cycle: nextCycle, status: 'completed' })
        .in('id', ids)
        .in('status', ['pending', 'confirmed']);

    // Per quelli già completed/altri stati: aggiorna solo tattoo_cycle
    await db.from('appointments')
        .update({ tattoo_cycle: nextCycle })
        .in('id', ids)
        .not('status', 'in', '("pending","confirmed")');

    if (error) { showToast('Errore durante l\'archiviazione.', 4000, true); return; }

    // Aggiorna allAppointments in memoria
    allAppointments.forEach(a => {
        if (ids.includes(a.id)) {
            a.tattoo_cycle = nextCycle;
            if (['pending','confirmed'].includes(a.status)) a.status = 'completed';
        }
    });

    showToast(`Tatuaggio #${nextCycle} archiviato. Il cliente può prenotare un nuovo ciclo.`);
    refreshClientDetailPayments(clientId);
}

function handlePriceSelect(apptId, clientId, value) {
    if (value === 'custom') {
        _customPriceCtx = { apptId, clientId };
        const input = document.getElementById('customPriceInput');
        input.value = '';
        document.getElementById('customPriceModal').style.display = 'flex';
        setTimeout(() => input.focus(), 50);
    } else {
        saveSessionPrice(apptId, clientId, value);
    }
}

function confirmCustomPrice() {
    const input = document.getElementById('customPriceInput');
    const price = parseInt(input.value);
    if (!price || price <= 0) { input.focus(); return; }
    const ctx = _customPriceCtx;
    closeCustomPriceModal();
    if (ctx) saveSessionPrice(ctx.apptId, ctx.clientId, String(price));
}

function closeCustomPriceModal() {
    document.getElementById('customPriceModal').style.display = 'none';
    if (_customPriceCtx) {
        const sel = document.getElementById('price-sel-' + _customPriceCtx.apptId);
        if (sel) { const prev = sel.querySelector('option[selected]'); if (prev) sel.value = prev.value; }
        _customPriceCtx = null;
    }
}

async function saveSessionPrice(apptId, clientId, priceStr) {
    const price = priceStr ? parseInt(priceStr) : null;
    const { error } = await db.from('appointments').update({ session_price: price }).eq('id', apptId);
    if (error) { showToast('Errore: ' + error.message, 4000, true); return; }
    const appt = allAppointments.find(a => a.id === apptId);
    if (appt) appt.session_price = price;
    refreshClientDetailPayments(clientId);
}

async function toggleSessionPaymentMethod(apptId, clientId, current) {
    // Ciclo: null → 'pos' → 'contanti' → null
    const next = !current ? 'pos' : current === 'pos' ? 'contanti' : null;
    const { error } = await db.from('appointments').update({ session_payment_method: next }).eq('id', apptId);
    if (error) { showToast('Errore: ' + error.message, 4000, true); return; }
    const appt = allAppointments.find(a => a.id === apptId);
    if (appt) appt.session_payment_method = next;
    refreshClientDetailPayments(clientId);
}

async function adminSetWaitlistPriority(clientId, priority) {
    const { error } = await db.from('waitlist')
        .update({ priority })
        .eq('client_id', clientId);
    if (error) { showToast('Errore: ' + error.message, 4000, true); return; }
    // Ricarica waitlist in memoria e ri-apri il dettaglio
    const { data } = await db.from('waitlist').select('*').eq('active', true);
    allWaitlist = data || [];
    openClientDetail(clientId);
}

async function adminWlRemoveFromDetail(clientId) {
    const name = allClients.find(c => c.id === clientId)?.full_name || 'questo cliente';
    if (!await customConfirm(`Rimuovere ${name} dalla lista prioritaria?`)) return;
    await db.from('waitlist').update({ active: false }).eq('client_id', clientId);
    await loadWaitlist();
    renderWaitlist();
    openClientDetail(clientId);
    showToast('Cliente rimosso dalla lista prioritaria.');
}

function closeIrschChoiceModal() {
    document.getElementById('irschChoiceModal').style.display = 'none';
    irschState = null;
}

function closeIreneRscheduleModal() {
    document.getElementById('ireneRescheduleModal').style.display = 'none';
}

const START_ADVANCE_OFFER_URL = 'https://n8n.srv1204993.hstgr.cloud/webhook/start-advance-offer';

// isAutomatic = true → sistema sceglie il prossimo in lista (da notifica "posto liberato")
// isAutomatic = false → Irene ha scelto manualmente quale cliente contattare
// overrideClientId → se specificato, bypassa la selezione automatica e usa quel cliente
async function triggerAutoOffer(overrideFreedSlotAt = null, overrideApptId = null, isAutomatic = true, overrideClientId = null) {
    const freedSlotAt = overrideFreedSlotAt || irschState?.scheduledAt;
    const freedApptId = overrideApptId      || irschState?.apptId || null;
    if (!freedSlotAt) { showToast('Nessuna data disponibile.', 3000, true); return; }

    try {
        let targetClientId;

        if (overrideClientId) {
            // Selezione manuale da parte di Irene
            targetClientId = overrideClientId;
        } else {
            // Selezione automatica: prossimo cliente idoneo in lista
            const { data: prevOffers } = await db.from('seduta_advance_offers')
                .select('offered_to_client_id')
                .eq('freed_slot_at', freedSlotAt)
                .in('status', ['pending', 'declined', 'expired', 'accepted']);
            const skipIds = (prevOffers || []).map(r => r.offered_to_client_id);

            const { data: waitlistEntries } = await db.from('waitlist')
                .select('client_id, priority, created_at')
                .eq('active', true)
                .order('priority', { ascending: true })
                .order('created_at', { ascending: true });

            const freedDate        = new Date(freedSlotAt);
            const threeMonthsLater = new Date(freedDate);
            threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);

            const eligibleIds = (waitlistEntries || [])
                .filter(w => !skipIds.includes(w.client_id))
                .map(w => w.client_id);

            let clientsInWindow = new Set();
            if (eligibleIds.length > 0) {
                const { data: upcoming } = await db.from('appointments')
                    .select('client_id, scheduled_at')
                    .in('client_id', eligibleIds)
                    .eq('type', 'seduta')
                    .in('status', ['confirmed', 'pending'])
                    .gt('scheduled_at', freedSlotAt)
                    .lte('scheduled_at', threeMonthsLater.toISOString())
                    .order('scheduled_at', { ascending: true });
                (upcoming || []).forEach(s => clientsInWindow.add(s.client_id));
            }

            const next = (waitlistEntries || []).find(w =>
                !skipIds.includes(w.client_id) && clientsInWindow.has(w.client_id)
            );
            if (!next) { showToast("Nessun cliente disponibile in lista d'attesa."); return; }
            targetClientId = next.client_id;
        }

        // Recupera dati del cliente (email + nome)
        const { data: clientData } = await db.from('clients')
            .select('id, email, first_name, last_name')
            .eq('id', targetClientId)
            .single();

        if (!clientData?.email) {
            showToast('Email del cliente non trovata.');
            return;
        }

        // 4. Inserisci offerta in seduta_advance_offers
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        const { error: insertErr } = await db.from('seduta_advance_offers').insert({
            freed_slot_at:           freedSlotAt,
            offered_to_client_id:    targetClientId,
            freed_by_appointment_id: freedApptId,
            status:                  'pending',
            expires_at:              expiresAt,
            is_automatic:            isAutomatic,
        });
        if (insertErr) throw new Error('DB insert: ' + insertErr.message);

        // 5. Inserisci notifica per il cliente
        const freedDateStr = new Date(freedSlotAt).toLocaleDateString('it-IT',
            { day: '2-digit', month: 'long', year: 'numeric' });
        await db.from('notifications').insert({
            type:      'advance_offer',
            title:     'Posto disponibile!',
            body:      `Puoi anticipare una seduta al ${freedDateStr}. Accetta o rifiuta dalla tua area personale.`,
            client_id: targetClientId,
            is_read:   false,
        });

        // 6. fire-and-forget: email al cliente tramite n8n
        const clientName = `${clientData.first_name || ''} ${clientData.last_name || ''}`.trim() || clientData.email;
        fetch(START_ADVANCE_OFFER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_email:  clientData.email,
                client_name:   clientName,
                freed_slot_at: freedSlotAt,
            }),
        }).catch(e => console.warn('[start-advance-offer email]', e));

        showToast(`Offerta inviata a ${clientData.first_name || 'cliente'}!`);
    } catch (e) {
        showToast("Errore nell'avvio dell'offerta: " + e.message, 4000, true);
    }
}

// ─── AZIONI POSTO LIBERATO (usate da freedSlotFerie via modal) ───────────────
async function freedSlotSetRiposo(freedSlotAt, notifId) {
    const dateOnly = freedSlotAt.split('T')[0];
    const dateStr  = new Date(freedSlotAt).toLocaleDateString('it-IT',
        { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    if (!await customConfirm(`Aggiungere ${dateStr} ai giorni di ferie?`)) return false;

    const { error } = await db.from('blocked_dates').insert({
        date_from: dateOnly,
        date_to:   dateOnly,
        reason:    'Posto liberato — ferie',
    });
    if (error) { showToast('Errore: ' + error.message, true); return false; }

    if (notifId) await markAsRead(notifId);
    await loadBlockedDates();
    renderCalendar();
    showToast(`${dateStr} aggiunto alle ferie.`);
    return true;
}

const IRSCH_EVENT_IDS = { 'consulenza': '5147645', 'pre-seduta': '5147653', 'seduta': '5147823' };
const IRSCH_TIMEZONE = 'Europe/Rome';
function getIrschEventId() { return IRSCH_EVENT_IDS[irschState?.apptType] || '4496804'; }

// Render sincrono — usa dati già in cache (irschState)
function irschRenderCalendar() {
    const { year, month } = irschState;
    const grid  = document.getElementById('irschCalendarGrid');
    const label = document.getElementById('irschMonthLabel');
    const months = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                    'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    label.textContent = `${months[month]} ${year}`;

    if (irschState.isLoading) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:10px;color:var(--text-muted);font-size:0.8rem;"><i class="fas fa-circle-notch fa-spin"></i> Caricamento slot…</div>';
        return;
    }

    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);

    const days = ['Lu','Ma','Me','Gi','Ve','Sa','Do'];
    let html = days.map(d => `<div class="irsch-day-header">${d}</div>`).join('');

    let startDow = firstDay.getDay();
    startDow = (startDow + 6) % 7;
    for (let i = 0; i < startDow; i++) html += '<div class="irsch-day empty"></div>';

    const today = new Date(); today.setHours(0,0,0,0);
    const totalDays = lastDay.getDate();
    for (let d = 1; d <= totalDays; d++) {
        const dateStr   = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const cellDate  = new Date(year, month, d);
        const isPast      = cellDate < today;
        const isAvailable = irschState.availableDates.includes(dateStr);
        const isSelected  = irschState.selectedDate === dateStr;
        let cls = 'irsch-day';
        if (isPast)                                         cls += ' disabled';
        else if (isSelected)                                cls += ' selected';
        else if (irschState.freeMode || isAvailable)        cls += ' available';
        else                                                cls += ' disabled';
        const clickable = (!isPast && (irschState.freeMode || isAvailable)) ? `onclick="irschSelectDate('${dateStr}')"` : '';
        html += `<div class="${cls}" ${clickable}>${d}</div>`;
    }
    grid.innerHTML = html;
}

// Fetch asincrono — scarica gli slot del mese poi fa re-render
async function irschFetchMonthSlots() {
    const { year, month } = irschState;
    const key = `${year}-${month}`;
    if (irschState.loadedMonths.has(key) || irschState.isLoading) return;

    irschState.isLoading = true;
    irschRenderCalendar(); // mostra spinner

    const startTime = new Date(year, month, 1, 0, 0, 0).toISOString();
    const endTime   = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
    const url = `${RSCH_SLOTS_URL}?eventTypeId=${getIrschEventId()}` +
                `&startTime=${encodeURIComponent(startTime)}` +
                `&endTime=${encodeURIComponent(endTime)}` +
                `&timeZone=${encodeURIComponent(IRSCH_TIMEZONE)}`;

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res  = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        const data = await res.json();

        const slotsByDate = {};
        if (data && data.slots && typeof data.slots === 'object') {
            for (const [date, arr] of Object.entries(data.slots)) {
                slotsByDate[date] = arr.map(s => {
                    const iso = s.time || s;
                    if (typeof iso !== 'string') return null;
                    try {
                        return new Date(iso).toLocaleTimeString('it-IT', {
                            hour: '2-digit', minute: '2-digit', timeZone: IRSCH_TIMEZONE
                        });
                    } catch { return iso.slice(11, 16); }
                }).filter(Boolean);
            }
        }
        Object.assign(irschState.slotsByDate, slotsByDate);
        irschState.availableDates = Object.keys(irschState.slotsByDate)
            .filter(d => irschState.slotsByDate[d].length > 0);
        irschState.loadedMonths.add(key);
    } catch(e) {
        console.warn('[irschFetchMonthSlots] errore:', e);
        const grid = document.getElementById('irschCalendarGrid');
        if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:10px;color:#f87171;font-size:0.8rem;"><i class="fas fa-exclamation-circle"></i> Impossibile caricare le disponibilità. Riprova.</div>';
        irschState.isLoading = false;
        return;
    }
    irschState.isLoading = false;
    irschRenderCalendar();
}

function irschPrevMonth() {
    irschState.month--;
    if (irschState.month < 0) { irschState.month = 11; irschState.year--; }
    irschState.selectedDate = null;
    irschState.selectedTime = null;
    document.getElementById('irschSlots').style.display    = 'none';
    document.getElementById('irschFreeTimeField').style.display = 'none';
    document.getElementById('irschReasonField').style.display = 'none';
    document.getElementById('ireneRschSubmitBtn').disabled = true;
    if (!irschState.freeMode) irschFetchMonthSlots(); else irschRenderCalendar();
}

function irschNextMonth() {
    irschState.month++;
    if (irschState.month > 11) { irschState.month = 0; irschState.year++; }
    irschState.selectedDate = null;
    irschState.selectedTime = null;
    document.getElementById('irschSlots').style.display    = 'none';
    document.getElementById('irschFreeTimeField').style.display = 'none';
    document.getElementById('irschReasonField').style.display = 'none';
    document.getElementById('ireneRschSubmitBtn').disabled = true;
    if (!irschState.freeMode) irschFetchMonthSlots(); else irschRenderCalendar();
}

function irschSelectDate(dateStr) {
    irschState.selectedDate = dateStr;
    irschState.selectedTime = null;
    document.getElementById('ireneRschSubmitBtn').disabled = true;
    irschRenderCalendar(); // sync — nessun refetch

    if (irschState.freeMode) {
        document.getElementById('irschSlots').style.display = 'none';
        document.getElementById('irschFreeTimeField').style.display = 'block';
        document.getElementById('irschFreeTime').value = '';
        document.getElementById('irschReasonField').style.display = 'block';
    } else {
        document.getElementById('irschFreeTimeField').style.display = 'none';
        const slots = irschState.slotsByDate[dateStr] || [];
        const slotsEl = document.getElementById('irschSlots');
        if (slots.length === 0) {
            slotsEl.style.display = 'none';
            return;
        }
        slotsEl.style.display = 'flex';
        slotsEl.innerHTML = slots.map(t =>
            `<div class="irsch-slot" onclick="irschSelectTime('${t}')">${t}</div>`
        ).join('');
        document.getElementById('irschReasonField').style.display = 'none';
    }
}

function irschSelectTime(time) {
    irschState.selectedTime = time;
    // Evidenzia slot selezionato
    document.querySelectorAll('.irsch-slot').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.irsch-slot').forEach(el => {
        if (el.textContent.trim() === time) el.classList.add('selected');
    });
    document.getElementById('irschReasonField').style.display = 'block';
    document.getElementById('ireneRschSubmitBtn').disabled = false;
}

async function submitIreneRescheduleProposal() {
    const { apptId, clientId, clientEmail, clientName, selectedDate, selectedTime } = irschState;
    if (!selectedDate || !selectedTime) return;

    const btn = document.getElementById('ireneRschSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Invio…';
    const msgEl = document.getElementById('ireneRschMsg');
    msgEl.textContent = '';

    const reason = (document.getElementById('ireneRschReason').value || '').trim();

    // 1. INSERT reschedule_requests
    const insertData = {
        appointment_id:  apptId,
        client_id:       clientId,
        requested_date:  selectedDate,
        requested_time:  selectedTime,
        reason:          reason || 'Proposta di Irene',
        initiated_by:    'irene',
        status:          'pending',
    };
    // Salva modalità solo per consulenza e pre-seduta
    if (['consulenza', 'pre-seduta'].includes(irschState.apptType) && irschState.consultationMode) {
        insertData.consultation_mode = irschState.consultationMode;
    }
    const { error: rrErr } = await db.from('reschedule_requests').insert(insertData);
    if (rrErr) {
        msgEl.textContent = 'Errore: ' + rrErr.message;
        btn.disabled = false; btn.textContent = 'Invia proposta';
        return;
    }

    // 2. INSERT notifica per il cliente
    await db.from('notifications').insert({
        type:      'irene_reschedule_proposal',
        title:     'Irene propone una nuova data',
        body:      `Irene vorrebbe spostare il tuo appuntamento al ${selectedDate} alle ${selectedTime}${reason ? ': ' + reason : ''}.`,
        client_id: clientId,
        is_read:   false,
    });

    // 3. fire-and-forget email (workflow separato per consulenza vs pre-seduta)
    const notifyUrl = irschState.apptType === 'pre-seduta'
        ? IRENE_PRESEDUTA_NOTIFY_URL
        : IRENE_RESCHEDULE_NOTIFY_URL;
    fetch(notifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_email:  clientEmail,
            client_name:   clientName,
            proposed_date: selectedDate,
            proposed_time: selectedTime,
            reason,
        }),
    }).catch(e => console.warn('[IreneProposalNotify] non inviato:', e));

    // 4. Aggiorna allRescheduleRequests in memoria e re-render badge
    allRescheduleRequests.push({ ...insertData, id: '_tmp_' + Date.now() });
    renderOverview();
    renderCalendar();

    // 5. Chiudi modal + feedback
    closeIreneRscheduleModal();
    showToast('Proposta inviata al cliente!');
}

function irschHandleFreeTime() {
    const val = document.getElementById('irschFreeTime').value;
    if (val) {
        irschState.selectedTime = val;
        document.getElementById('ireneRschSubmitBtn').disabled = false;
    } else {
        irschState.selectedTime = null;
        document.getElementById('ireneRschSubmitBtn').disabled = true;
    }
}

// ─── ANALYTICS: ESPORTA REGISTRO SEDUTE ────────────────────────────────────

const EXPORT_DRIVE_URL = 'https://n8n.srv1204993.hstgr.cloud/webhook/export-sedute-drive';

// Export calendar state
let _exCalDate = new Date();
let _exCalFrom = null;
let _exCalTo   = null;

function openExportCalModal() {
    _exCalDate = new Date();
    _exCalFrom = null;
    _exCalTo   = null;
    document.getElementById('exCalMsg').textContent = '';
    document.getElementById('exportCalModal').style.display = 'flex';
    renderExportCal();
}

function closeExportCalModal() {
    document.getElementById('exportCalModal').style.display = 'none';
}

function renderExportCal() {
    const grid  = document.getElementById('exCalGrid');
    const label = document.getElementById('exCalLabel');
    const selDisp = document.getElementById('exCalSelDisplay');
    if (!grid || !label) return;

    const year  = _exCalDate.getFullYear();
    const month = _exCalDate.getMonth();

    label.textContent = new Date(year, month, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

    // Appointment dots
    const byDay = {};
    (allAppointments || []).forEach(a => {
        if (a.status === 'cancelled' || a.type !== 'seduta') return;
        const d = new Date(a.scheduled_at);
        if (d.getFullYear() === year && d.getMonth() === month) byDay[d.getDate()] = true;
    });

    const firstDay = new Date(year, month, 1).getDay();
    const offset   = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth     = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    grid.innerHTML = '';

    for (let i = offset - 1; i >= 0; i--) {
        const el = document.createElement('div');
        el.className = 'bcal-day other-month';
        el.textContent = daysInPrevMonth - i;
        grid.appendChild(el);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr  = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const hasAppt  = !!byDay[d];
        const isToday  = dateStr === todayStr;
        const isFrom   = dateStr === _exCalFrom;
        const isTo     = dateStr === _exCalTo;
        const inRange  = _exCalFrom && _exCalTo && dateStr > _exCalFrom && dateStr < _exCalTo;

        let cls = 'bcal-day';
        if (isToday)  cls += ' bcal-today';
        if (hasAppt)  cls += ' bcal-has-appt';
        if (isFrom)   cls += ' excal-sel-from';
        if (isTo)     cls += ' excal-sel-to';
        if (inRange)  cls += ' excal-in-range';

        const el = document.createElement('div');
        el.className = cls;
        el.innerHTML = `<span>${d}</span>${hasAppt ? '<div class="bcal-dots"><div class="bcal-dot"></div></div>' : ''}`;
        el.addEventListener('click', () => exCalSelectDay(dateStr));
        grid.appendChild(el);
    }

    const total = offset + daysInMonth;
    const rem   = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let d = 1; d <= rem; d++) {
        const el = document.createElement('div');
        el.className = 'bcal-day other-month';
        el.textContent = d;
        grid.appendChild(el);
    }

    // Selection display
    if (selDisp) {
        if (_exCalFrom && _exCalTo && _exCalFrom !== _exCalTo) {
            const f = new Date(_exCalFrom + 'T12:00:00').toLocaleDateString('it-IT', { day:'2-digit', month:'long' });
            const t = new Date(_exCalTo   + 'T12:00:00').toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' });
            selDisp.innerHTML = `<i class="fas fa-calendar-check" style="color:#D4AF37;margin-right:6px;"></i><span style="color:#D4AF37;">Periodo: ${f} → ${t}</span>`;
        } else if (_exCalFrom) {
            const f = new Date(_exCalFrom + 'T12:00:00').toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' });
            selDisp.innerHTML = `<i class="fas fa-calendar-check" style="color:#D4AF37;margin-right:6px;"></i><span style="color:#D4AF37;">${f}</span> <span style="color:var(--text-muted);font-size:0.78rem;">(tocca una seconda data per un range)</span>`;
        } else {
            selDisp.innerHTML = '<span style="color:var(--text-muted);">Tocca il primo giorno del periodo.</span>';
        }
    }

    const confirmBtn = document.getElementById('exCalConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = !_exCalFrom;
}

function exCalSelectDay(dateStr) {
    if (!_exCalFrom || (_exCalFrom && _exCalTo)) {
        _exCalFrom = dateStr;
        _exCalTo   = null;
    } else {
        if (dateStr < _exCalFrom) { _exCalTo = _exCalFrom; _exCalFrom = dateStr; }
        else if (dateStr === _exCalFrom) { _exCalTo = dateStr; }
        else { _exCalTo = dateStr; }
    }
    renderExportCal();
}

function exCalPrev() { _exCalDate.setMonth(_exCalDate.getMonth() - 1); renderExportCal(); }
function exCalNext() { _exCalDate.setMonth(_exCalDate.getMonth() + 1); renderExportCal(); }

async function exportSedute() {
    const dateFrom = _exCalFrom;
    const dateTo   = _exCalTo || _exCalFrom;
    const btn      = document.getElementById('exCalConfirmBtn');
    const msgEl    = document.getElementById('exCalMsg');

    if (!dateFrom) {
        if (msgEl) msgEl.textContent = 'Seleziona almeno un giorno.';
        return;
    }

    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="margin-right:6px;"></i>Attendere…';
    if (msgEl) msgEl.textContent = '';

    try {
        const { data: sedute, error } = await db
            .from('appointments')
            .select('id, scheduled_at, created_at, session_price, amount_paid, session_payment_method, acconto_payment_method, clients(first_name, last_name, codice_fiscale, indirizzo)')
            .eq('type', 'seduta')
            .neq('status', 'cancelled')
            .gte('scheduled_at', dateFrom + 'T00:00:00')
            .lte('scheduled_at', dateTo + 'T23:59:59')
            .order('scheduled_at', { ascending: true });

        if (error) throw new Error(error.message);
        if (!sedute || sedute.length === 0) {
            const mEl = document.getElementById('exCalMsg');
            if (mEl) { mEl.textContent = 'Nessuna seduta trovata nel periodo selezionato.'; mEl.style.color = '#D4AF37'; }
            btn.disabled = false;
            btn.innerHTML = origHtml;
            return;
        }

        // Funzioni helper
        const fmtDate = iso => iso
            ? new Date(iso).toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric' })
            : '';
        const fmtEur = v => v != null && v !== '' ? String(Number(v)).replace('.', ',') : '';
        const esc    = s => (s || '').replace(/;/g, ',');
        const fmtMetodo = m => m === 'pos' ? 'POS' : m === 'contanti' ? 'Contanti' : '';

        // Build CSV — una riga per evento di pagamento (acconto + saldo separati)
        // Colonne: Data | CF | Cognome | Nome | Indirizzo | Tipo | Importo (€) | Metodo
        const csvRows = [
            ['Data', 'CF', 'Cognome', 'Nome', 'Indirizzo', 'Tipo', 'Importo (€)', 'Metodo'].join(';')
        ];

        // Raccoglie tutti gli eventi di pagamento, poi li ordina per data
        const events = [];

        for (const s of sedute) {
            const cliente = s.clients || {};
            const cf        = esc((cliente.codice_fiscale || '').toUpperCase());
            const cognome   = esc(cliente.last_name  || '');
            const nome      = esc(cliente.first_name || '');
            const indirizzo = esc(cliente.indirizzo  || '');

            // — Riga acconto (se amount_paid > 0)
            const accPaid = s.amount_paid != null ? Number(s.amount_paid) : 0;
            if (accPaid > 0) {
                const accMetodo = s.acconto_payment_method || 'paypal'; // fallback paypal: prenotazioni dal sito usano PayPal
                events.push({
                    date: s.created_at || s.scheduled_at,
                    row: [fmtDate(s.created_at || s.scheduled_at), cf, cognome, nome, indirizzo, 'Acconto', fmtEur(accPaid), fmtMetodo(accMetodo)].join(';'),
                });
            }

            // — Riga saldo (se session_price registrato)
            const price = s.session_price != null ? Number(s.session_price) : null;
            if (price != null && price > 0) {
                const saldo = Math.max(0, price - accPaid);
                events.push({
                    date: s.scheduled_at,
                    row: [fmtDate(s.scheduled_at), cf, cognome, nome, indirizzo, 'Saldo seduta', fmtEur(saldo), fmtMetodo(s.session_payment_method)].join(';'),
                });
            }
        }

        // Ordina per data crescente
        events.sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1);
        events.forEach(e => csvRows.push(e.row));

        const csvContent = '\uFEFF' + csvRows.join('\r\n'); // BOM for Excel UTF-8
        const today = new Date().toISOString().substring(0, 10).replace(/-/g, '');
        const filename = `registro_sedute_${today}.csv`;

        // Trigger download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Close modal and show success in the card
        closeExportCalModal();
        showExportMsg(`✓ CSV scaricato (${sedute.length} sedute, ${events.length} righe). Caricamento su Drive in corso…`, 'ok');

        // Fire-and-forget: upload to Google Drive via n8n
        fetch(EXPORT_DRIVE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename,
                csv_content: csvContent,
                date_from: dateFrom,
                date_to: dateTo,
                total_rows: sedute.length,
            }),
        })
        .then(r => {
            if (r.ok) showExportMsg(`✓ CSV scaricato (${sedute.length} sedute) e caricato su Drive.`, 'ok');
        })
        .catch(() => {
            showExportMsg(`✓ CSV scaricato (${sedute.length} sedute). Drive non raggiungibile.`, 'warn');
        });

    } catch (e) {
        // Show error inside modal
        const mEl = document.getElementById('exCalMsg');
        if (mEl) mEl.textContent = 'Errore: ' + e.message;
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
    }
}

function showExportMsg(text, type) {
    const el = document.getElementById('exportMsg');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
    el.style.background = type === 'ok'    ? 'rgba(109,192,124,0.12)' :
                          type === 'warn'  ? 'rgba(212,175,55,0.12)'  :
                                             'rgba(248,113,113,0.12)';
    el.style.color = type === 'ok'    ? '#6dc07c' :
                     type === 'warn'  ? '#D4AF37'  :
                                        '#f87171';
    el.style.border = `1px solid ${
        type === 'ok'   ? 'rgba(109,192,124,0.3)' :
        type === 'warn' ? 'rgba(212,175,55,0.3)'  :
                          'rgba(248,113,113,0.3)'
    }`;
}

// ============================================
// ELIMINA ACCESSO CLIENTE (Irene)
// ============================================
const ADMIN_DELETE_CLIENT_AUTH_URL = 'https://n8n.srv1204993.hstgr.cloud/webhook/admin-delete-client-auth';

let _adminDeleteClientData = null;

function openAdminDeleteClientModal() {
    if (!_currentDetailClientId) return;
    const client = allClients.find(c => c.id === _currentDetailClientId);
    if (!client) return;
    _adminDeleteClientData = {
        id:     client.id,
        userId: client.id,
        email:  client.email,
        name:   `${client.first_name || ''} ${client.last_name || ''}`.trim(),
    };
    document.getElementById('adminDeleteClientName').textContent =
        _adminDeleteClientData.name || _adminDeleteClientData.email;
    const btn = document.getElementById('adminDeleteClientConfirmBtn');
    btn.disabled  = false;
    btn.innerHTML = '<i class="fas fa-user-slash" style="margin-right:6px;"></i>Conferma eliminazione';
    document.getElementById('adminDeleteClientModal').style.display = 'flex';
}

function closeAdminDeleteClientModal() {
    document.getElementById('adminDeleteClientModal').style.display = 'none';
    _adminDeleteClientData = null;
}

async function confirmAdminDeleteClient() {
    if (!_adminDeleteClientData) return;
    const btn = document.getElementById('adminDeleteClientConfirmBtn');
    btn.disabled  = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="margin-right:6px;"></i>Eliminazione…';

    try {
        const res = await fetch(ADMIN_DELETE_CLIENT_AUTH_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id:    _adminDeleteClientData.id,
                user_id:      _adminDeleteClientData.userId,
                client_email: _adminDeleteClientData.email,
                client_name:  _adminDeleteClientData.name,
            }),
        });
        if (!res.ok) throw new Error(await res.text());
    } catch (e) {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fas fa-user-slash" style="margin-right:6px;"></i>Conferma eliminazione';
        showToast('Errore durante l\'eliminazione: ' + e.message, 4000, true);
        return;
    }

    // Aggiorna in memoria
    const idx = allClients.findIndex(c => c.id === _adminDeleteClientData.id);
    if (idx !== -1) {
        allClients[idx].deletion_requested_at = null;
    }

    closeAdminDeleteClientModal();
    closeClientDetail();
    renderClientsTable(allClients);
    showToast('Accesso cliente eliminato.');
}

// Approva richiesta del cliente → stessa logica di eliminazione diretta
function approveClientDeletion() {
    document.getElementById('clientDeletionBanner').style.display = 'none';
    openAdminDeleteClientModal();
}

// Rifiuta richiesta → azzera deletion_requested_at, nessuna notifica al cliente
async function rejectClientDeletion() {
    if (!_currentDetailClientId) return;
    const { error } = await db.from('clients')
        .update({ deletion_requested_at: null })
        .eq('id', _currentDetailClientId);
    if (error) { showToast('Errore: ' + error.message, 4000, true); return; }

    const idx = allClients.findIndex(c => c.id === _currentDetailClientId);
    if (idx !== -1) allClients[idx].deletion_requested_at = null;

    document.getElementById('clientDeletionBanner').style.display = 'none';
    showToast('Richiesta rifiutata — account mantenuto.');
}

// ============================================
// ADMIN AI ASSISTANT
// ============================================
const AA_CHAT_URL = 'https://n8n.srv1204993.hstgr.cloud/webhook/chat-admin';
const AA_STORAGE_KEY = 'aa_chat_state';
const AA_MAX_AGE_MS  = 24 * 60 * 60 * 1000; // 24h

// Restore session from localStorage (persists up to 24h)
function aaLoadState() {
    try {
        const raw = localStorage.getItem(AA_STORAGE_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (Date.now() - s.ts > AA_MAX_AGE_MS) { localStorage.removeItem(AA_STORAGE_KEY); return null; }
        return s;
    } catch { return null; }
}
function aaSaveState() {
    try {
        localStorage.setItem(AA_STORAGE_KEY, JSON.stringify({
            ts: Date.now(), sessionId: AA_SESSION, history: aaHistory, messages: aaSavedMessages()
        }));
    } catch {}
}
function aaSavedMessages() {
    const box = document.getElementById('aaMessages');
    if (!box) return [];
    const msgs = [];
    box.querySelectorAll('.aa-msg').forEach(el => {
        const isUser = el.classList.contains('aa-msg-user');
        const bubble = el.querySelector('.aa-msg-bubble');
        if (bubble) msgs.push({ role: isUser ? 'user' : 'bot', html: bubble.innerHTML });
    });
    return msgs;
}
function aaRestoreMessages(saved) {
    const box = document.getElementById('aaMessages');
    if (!box || !saved.messages || saved.messages.length === 0) return;
    // Remove welcome screen and render saved messages
    box.innerHTML = '';
    saved.messages.forEach(m => {
        const div = document.createElement('div');
        div.className = 'aa-msg aa-msg-' + (m.role === 'user' ? 'user' : 'bot');
        const avatarIcon = m.role === 'user' ? 'fa-user' : 'fa-robot';
        div.innerHTML = '<div class="aa-msg-avatar"><i class="fas ' + avatarIcon + '"></i></div>'
            + '<div class="aa-msg-bubble">' + m.html + '</div>';
        box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
}

const saved = aaLoadState();
const AA_SESSION  = saved ? saved.sessionId : crypto.randomUUID();
let aaHistory = saved ? (saved.history || []) : [];
let aaPendingAction = null;
let aaBusy = false;

// Restore chat UI — try after short delay (DOM ready), retry on first navigateTo('assistente')
if (saved && saved.messages && saved.messages.length > 0) {
    let _aaRestored = false;
    function _aaTryRestore() {
        if (_aaRestored) return;
        const box = document.getElementById('aaMessages');
        if (box) { _aaRestored = true; aaRestoreMessages(saved); }
    }
    setTimeout(_aaTryRestore, 300);
    // Also hook navigateTo for deferred restore
    document.addEventListener('click', function _aaNavClick(e) {
        const btn = e.target.closest('[data-section="assistente"]');
        if (btn) { setTimeout(_aaTryRestore, 50); document.removeEventListener('click', _aaNavClick); }
    });
}

// ─── Context builders ────────────────────────────────────────
function aaBuildContext() {
    const today = new Date().toISOString().slice(0, 10);
    const todayAppts = (allAppointments || [])
        .filter(a => a.scheduled_at && a.scheduled_at.startsWith(today) && a.status !== 'cancelled')
        .map(a => ({
            type: a.type, time: a.scheduled_at.slice(11, 16), status: a.status,
            client: a.clients ? [a.clients.first_name, a.clients.last_name].filter(Boolean).join(' ') : '?',
        }));
    const clients = (allClients || []).slice(0, 300).map(c => ({
        id: c.id,
        n: [c.first_name, c.last_name].filter(Boolean).join(' '),
        e: c.email || '', p: c.phone || '',
    }));
    const wl = (allWaitlist || []).filter(w => w.active).map(w => ({
        n: w.clients ? [w.clients.first_name, w.clients.last_name].filter(Boolean).join(' ') : '?',
        pos: w.position, pri: w.priority,
    }));
    const wlReqs = (allRescheduleRequests || []).length;
    const pendingWl = (allWaitlistRequests || []).length;
    return { date: today, today_appts: todayAppts, clients, waitlist: wl, pending_wl_requests: pendingWl, pending_rsch_requests: wlReqs };
}

// ─── Quick actions ───────────────────────────────────────────
function aaQuick(text) {
    const inp = document.getElementById('aaInput');
    if (inp) { inp.value = text; sendAdminMsg(); }
}

// ─── Send text message ──────────────────────────────────────
async function sendAdminMsg() {
    const inp = document.getElementById('aaInput');
    if (!inp) return;
    const text = (inp.value || '').trim();
    if (!text || aaBusy) return;
    inp.value = ''; aaAutoResize();

    // Remove welcome screen
    const wel = document.querySelector('.aa-welcome');
    if (wel) wel.remove();

    addAaMsg('user', text);
    aaHistory.push({ role: 'user', content: text });

    // Check confirmation of pending action
    if (aaPendingAction) {
        if (/^(s[iì]|ok|conferma|confermo|vai|procedi|esatto)/i.test(text)) {
            await aaExecAction(aaPendingAction);
            aaPendingAction = null;
            return;
        }
        if (/^(no|annulla|cancel|lascia)/i.test(text)) {
            aaPendingAction = null;
            addAaMsg('bot', 'OK, operazione annullata.');
            aaHistory.push({ role: 'assistant', content: 'Operazione annullata.' });
            return;
        }
        // If user says something else, clear pending and continue chat
        aaPendingAction = null;
    }

    await aaSendToBackend({ message: text });
}

// ─── Core fetch to n8n ──────────────────────────────────────
async function aaSendToBackend(payload) {
    showAaTyping(true);
    aaBusy = true;
    try {
        const ctrl = new AbortController();
        const tout = setTimeout(() => ctrl.abort(), payload.audio ? 45000 : 30000);
        const res = await fetch(AA_CHAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...payload,
                history: aaHistory.slice(-20),
                sessionId: AA_SESSION,
                context: aaBuildContext(),
            }),
            signal: ctrl.signal,
        });
        clearTimeout(tout);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        // Voice: update transcription in last user bubble
        if (data.transcription) {
            const msgs = document.querySelectorAll('.aa-msg-user');
            const last = msgs[msgs.length - 1];
            if (last) last.innerHTML = data.transcription + '<div class="aa-msg-voice-badge"><i class="fas fa-microphone"></i> Vocale</div>';
            aaHistory.push({ role: 'user', content: data.transcription });
        }

        const reply = data.reply || data.output || data.text || 'Errore nella risposta.';
        if (data.action) aaPendingAction = data.action;

        addAaMsg('bot', reply);
        aaHistory.push({ role: 'assistant', content: reply });
    } catch (e) {
        addAaMsg('bot', e.name === 'AbortError'
            ? 'Timeout — riprova.' : 'Errore di connessione. Riprova.');
    } finally {
        showAaTyping(false);
        aaBusy = false;
    }
}

// ─── Action execution ───────────────────────────────────────
async function aaExecAction(action) {
    showAaTyping(true);
    aaBusy = true;
    try {
        let msg = '';
        const d = action.data || {};
        switch (action.type) {
            case 'create_appointment': {
                // 1. Insert into Supabase
                const insertData = {
                    client_id: d.client_id,
                    type: d.appointment_type,
                    status: 'confirmed',
                    scheduled_at: d.scheduled_at,
                    ...(d.notes ? { notes: d.notes } : {}),
                    ...(d.appointment_type === 'seduta' ? { amount: 50, amount_paid: 0 } : {}),
                    ...(['consulenza', 'pre-seduta'].includes(d.appointment_type) && d.location ? { consultation_mode: d.location } : {}),
                };
                const { data: newAppt, error } = await db.from('appointments')
                    .insert(insertData).select('*, clients(id,first_name,last_name,email,phone)').single();
                if (error) throw new Error(error.message);
                allAppointments.push(newAppt);
                // 2. Fire-and-forget n8n: Cal.com + email
                fetch(ADMIN_CREATE_APPT_URL, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        appointment_id: newAppt.id, client_id: d.client_id,
                        client_email: d.client_email, client_name: d.client_name,
                        client_phone: d.client_phone, appointment_type: d.appointment_type,
                        scheduled_at: d.scheduled_at, notes: d.notes || '',
                        is_first_session: d.is_first_session || false,
                        location: d.location || null,
                    }),
                }).catch(() => {});
                msg = '\u2705 Appuntamento creato per ' + (d.client_name || 'il cliente') + '! Email di conferma inviata.';
                renderOverview(); renderCalendar();
                break;
            }
            case 'send_message': {
                const ctrl = new AbortController();
                const tout = setTimeout(() => ctrl.abort(), 15000);
                const res = await fetch('https://n8n.srv1204993.hstgr.cloud/webhook/send-message', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(d), signal: ctrl.signal,
                });
                clearTimeout(tout);
                if (!res.ok) throw new Error('Errore server');
                const chLabel = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS' };
                msg = '\u2705 ' + (chLabel[d.channel] || 'Messaggio') + ' inviato a ' + (d.client_name || d.to_email || 'il cliente') + '!';
                break;
            }
            case 'approve_waitlist': {
                await approveWlRequest(d.request_id);
                msg = '\u2705 Richiesta lista d\'attesa approvata!';
                break;
            }
            case 'deny_waitlist': {
                await denyWlRequest(d.request_id);
                msg = '\u2705 Richiesta lista d\'attesa rifiutata.';
                break;
            }
            default:
                msg = 'Azione non supportata.';
        }
        addAaMsg('bot', msg);
        aaHistory.push({ role: 'assistant', content: msg });
    } catch (e) {
        const errMsg = '\u274c Errore: ' + (e.message || 'Riprova.');
        addAaMsg('bot', errMsg);
        aaHistory.push({ role: 'assistant', content: errMsg });
    } finally {
        showAaTyping(false);
        aaBusy = false;
    }
}

// ─── Render helpers ─────────────────────────────────────────
function addAaMsg(role, text, isVoice) {
    const box = document.getElementById('aaMessages');
    const div = document.createElement('div');
    const isUser = role === 'user';
    div.className = 'aa-msg aa-msg-' + (isUser ? 'user' : 'bot');
    let bubbleHtml = '';
    if (!isUser) bubbleHtml += '<div class="aa-msg-label">Assistente</div>';
    bubbleHtml += aaFmt(text);
    if (isVoice) bubbleHtml += '<div class="aa-msg-voice-badge"><i class="fas fa-microphone"></i> Vocale</div>';
    const avatarIcon = isUser ? 'fa-user' : 'fa-robot';
    div.innerHTML = '<div class="aa-msg-avatar"><i class="fas ' + avatarIcon + '"></i></div>'
        + '<div class="aa-msg-bubble">' + bubbleHtml + '</div>';
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    aaSaveState();
}
function aaFmt(t) {
    return t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
}
function showAaTyping(show) {
    const box = document.getElementById('aaMessages');
    let el = document.getElementById('aaTyping');
    if (show && !el) {
        el = document.createElement('div');
        el.id = 'aaTyping'; el.className = 'aa-typing';
        el.innerHTML = '<div class="aa-msg-avatar"><i class="fas fa-robot"></i></div>'
            + '<div class="aa-typing-dots"><span></span><span></span><span></span></div>';
        box.appendChild(el); box.scrollTop = box.scrollHeight;
    } else if (!show && el) { el.remove(); }
}
function clearAdminChat() {
    aaHistory = []; aaPendingAction = null;
    try { localStorage.removeItem(AA_STORAGE_KEY); } catch {}
    document.getElementById('aaMessages').innerHTML = `
        <div class="aa-welcome">
            <div class="aa-welcome-icon"><i class="fas fa-robot"></i></div>
            <p class="aa-welcome-title">Ciao Irene!</p>
            <p class="aa-welcome-text">Sono il tuo assistente. Posso aiutarti a creare appuntamenti, cercare clienti, gestire la lista d'attesa e molto altro. Scrivi o usa il microfono.</p>
            <div class="aa-quick-actions">
                <button class="aa-quick-btn" onclick="aaQuick('Crea un appuntamento')"><i class="fas fa-calendar-plus"></i> Crea appuntamento</button>
                <button class="aa-quick-btn" onclick="aaQuick('Mostra la lista d\\'attesa')"><i class="fas fa-list-ol"></i> Lista d'attesa</button>
                <button class="aa-quick-btn" onclick="aaQuick('Cerca un cliente')"><i class="fas fa-search"></i> Cerca cliente</button>
                <button class="aa-quick-btn" onclick="aaQuick('Appuntamenti di oggi')"><i class="fas fa-clock"></i> Oggi</button>
            </div>
        </div>`;
}
function aaAutoResize() {
    const el = document.getElementById('aaInput');
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ─── Voice Recording (MediaRecorder → base64 → n8n Whisper) ─
let _aaRec = null, _aaChunks = [], _aaTimer = null, _aaSecs = 0;

async function toggleAdminVoice() {
    if (_aaRec && _aaRec.state === 'recording') { stopAdminVoice(true); return; }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        _aaChunks = []; _aaSecs = 0;
        // Try opus first, fall back to default
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
        _aaRec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        _aaRec.ondataavailable = e => { if (e.data.size > 0) _aaChunks.push(e.data); };
        _aaRec.onstop = () => stream.getTracks().forEach(t => t.stop());
        _aaRec.start(250);
        // UI
        document.getElementById('aaMicBtn').classList.add('recording');
        document.getElementById('aaMicRecording').style.display = 'flex';
        document.getElementById('aaInput').style.display = 'none';
        document.getElementById('aaSendBtn').style.display = 'none';
        _aaTimer = setInterval(() => {
            _aaSecs++;
            const m = Math.floor(_aaSecs / 60), s = _aaSecs % 60;
            document.getElementById('aaMicTimer').textContent = m + ':' + String(s).padStart(2, '0');
        }, 1000);
    } catch (_) {
        showToast('Microfono non disponibile. Controlla i permessi.', 4000, true);
    }
}

async function stopAdminVoice(send) {
    if (!_aaRec) return;
    const rec = _aaRec; _aaRec = null;
    clearInterval(_aaTimer);
    // Reset UI
    document.getElementById('aaMicBtn').classList.remove('recording');
    document.getElementById('aaMicRecording').style.display = 'none';
    document.getElementById('aaInput').style.display = '';
    document.getElementById('aaSendBtn').style.display = '';
    if (!send) { rec.stop(); return; }
    // Wait for stop
    await new Promise(r => { const orig = rec.onstop; rec.onstop = () => { if (orig) orig(); r(); }; rec.stop(); });
    if (!_aaChunks.length) return;
    const blob = new Blob(_aaChunks, { type: rec.mimeType || 'audio/webm' });
    // base64
    const b64 = await new Promise(r => { const fr = new FileReader(); fr.onloadend = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
    // Remove welcome
    const wel = document.querySelector('.aa-welcome');
    if (wel) wel.remove();
    addAaMsg('user', '\uD83C\uDFA4 Nota vocale...', true);
    await aaSendToBackend({ audio: b64, audio_format: rec.mimeType || 'audio/webm' });
}

// Auto-resize on input
document.addEventListener('DOMContentLoaded', () => {
    const inp = document.getElementById('aaInput');
    if (inp) inp.addEventListener('input', aaAutoResize);
});
