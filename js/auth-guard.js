// =============================================
//  AUTH GUARD - Irene Gipsy Tattoo
//  Protegge le pagine da utenti non autenticati
//  e pre-compila i campi del form con i dati
//  del profilo Supabase.
//
//  Deve essere caricato DOPO supabase-client.js
//  nell'<head> della pagina protetta.
// =============================================

(function () {
    // Nasconde immediatamente la pagina per evitare flash di contenuto
    document.documentElement.style.visibility = 'hidden';

    async function checkAuth() {
        try {
            let session = null;

            // 1. Cerca sessione già attiva
            const { data } = await db.auth.getSession();
            session = data.session;

            if (!session) {
                // 2. Nessuna sessione: aspetta l'evento SIGNED_IN
                //    (ritorno da magic link / OAuth — token nell'URL)
                session = await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('timeout')), 3000);
                    db.auth.onAuthStateChange((event, s) => {
                        if (event === 'SIGNED_IN' && s) {
                            clearTimeout(timer);
                            resolve(s);
                        }
                    });
                });
            }

            // Autenticato — mostra la pagina
            window.__authUser = session.user;
            document.documentElement.style.visibility = '';
            prefillForm(session.user);

        } catch {
            // Non autenticato — redirect al login con ?next= per tornare qui dopo
            const isEn = window.location.pathname.includes('/en/');
            const loginBase = isEn ? '../login.html' : 'login.html';
            window.location.replace(loginBase + '?next=' + encodeURIComponent(window.location.href));
        }
    }

    function prefillForm(user) {
        const fill = async () => {
            const set = (id, val) => {
                const el = document.getElementById(id);
                if (el && !el.value && val) el.value = val;
            };

            // Email è sempre disponibile dall'oggetto auth
            set('email', user.email || '');

            // Legge first_name, last_name, phone direttamente dalla tabella clients
            // (dati salvati dall'utente nel tab Profilo della dashboard)
            const { data: profile } = await db.from('clients')
                .select('first_name, last_name, phone')
                .eq('id', user.id)
                .single();

            if (profile?.first_name || profile?.last_name) {
                // Profilo compilato dall'utente: usa i campi separati
                set('nome',    profile.first_name || '');
                set('cognome', profile.last_name  || '');
            } else {
                // Fallback: dividi full_name da user_metadata (es. accesso Google)
                const meta     = user.user_metadata || {};
                const fullName = (meta.full_name || meta.name || '').trim();
                const parts    = fullName.split(' ');
                set('nome',    parts[0] || '');
                set('cognome', parts.slice(1).join(' ') || '');
            }

            if (profile?.phone) set('telefono', profile.phone);
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fill);
        } else {
            fill();
        }
    }

    checkAuth();
})();
