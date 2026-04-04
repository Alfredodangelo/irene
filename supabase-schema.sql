-- =============================================
--  IRENE GIPSY TATTOO - Supabase Schema
--  Esegui le 4 query SEPARATAMENTE nel SQL Editor
--  (New query per ognuna, in ordine da 1 a 4)
-- =============================================


-- ============================================================
--  QUERY 1 — TABELLE
--  Copia tutto da qui fino a "FINE QUERY 1" e clicca Run
-- ============================================================

CREATE TABLE IF NOT EXISTS public.clients (
    id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email       TEXT,
    full_name   TEXT,
    phone       TEXT,
    avatar_url  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.appointments (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id    UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    type         TEXT NOT NULL,
    scheduled_at TIMESTAMPTZ,
    status       TEXT DEFAULT 'pending',
    notes        TEXT,
    amount       NUMERIC(10,2),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vouchers (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id       UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    code            TEXT UNIQUE NOT NULL,
    amount          NUMERIC(10,2) NOT NULL,
    status          TEXT DEFAULT 'active',
    recipient_name  TEXT,
    recipient_email TEXT,
    message         TEXT,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tattoo_gallery (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id    UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    title        TEXT,
    session_date DATE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.consent_documents (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id    UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    storage_path TEXT,
    session_date DATE,
    signed_at    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- FINE QUERY 1


-- ============================================================
--  QUERY 2 — SICUREZZA (RLS + POLICY)
--  Copia tutto da qui fino a "FINE QUERY 2" e clicca Run
-- ============================================================

ALTER TABLE public.clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tattoo_gallery    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view_own_profile"   ON public.clients FOR SELECT USING (auth.uid() = id);
CREATE POLICY "insert_own_profile" ON public.clients FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "update_own_profile" ON public.clients FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "view_own_appointments" ON public.appointments FOR SELECT USING (auth.uid() = client_id);

CREATE POLICY "view_own_vouchers" ON public.vouchers FOR SELECT USING (auth.uid() = client_id);

CREATE POLICY "view_own_gallery"   ON public.tattoo_gallery FOR SELECT  USING     (auth.uid() = client_id);
CREATE POLICY "insert_own_gallery" ON public.tattoo_gallery FOR INSERT  WITH CHECK (auth.uid() = client_id);
CREATE POLICY "delete_own_gallery" ON public.tattoo_gallery FOR DELETE  USING     (auth.uid() = client_id);

CREATE POLICY "view_own_documents"  ON public.consent_documents FOR SELECT USING (auth.uid() = client_id);
CREATE POLICY "admin_all_documents" ON public.consent_documents FOR ALL TO authenticated
    USING (auth.email() = 'irenegipsytattoo@gmail.com')
    WITH CHECK (auth.email() = 'irenegipsytattoo@gmail.com');

CREATE POLICY "service_insert_appointments" ON public.appointments FOR INSERT WITH CHECK (true);
CREATE POLICY "service_insert_vouchers"     ON public.vouchers     FOR INSERT WITH CHECK (true);
CREATE POLICY "service_insert_consent"      ON public.consent_documents FOR INSERT WITH CHECK (true);

-- FINE QUERY 2


-- ============================================================
--  QUERY 3 — FUNZIONE + TRIGGER (auto-crea profilo al signup)
--  Copia tutto da qui fino a "FINE QUERY 3" e clicca Run
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.clients (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
        NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- FINE QUERY 3


-- ============================================================
--  QUERY 4 — POLICY STORAGE
--  Esegui SOLO DOPO aver creato i bucket "client-gallery"
--  e "consent-docs" in Supabase > Storage
--  Copia tutto da qui fino a "FINE QUERY 4" e clicca Run
-- ============================================================

CREATE POLICY "upload_own_gallery" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'client-gallery'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "view_own_gallery_files" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'client-gallery'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "delete_own_gallery_files" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'client-gallery'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "view_own_consent_docs" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'consent-docs'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- FINE QUERY 4


-- ============================================================
--  QUERY 5 — LISTA PRIORITÀ (WAITLIST)
--  Copia tutto da qui fino a "FINE QUERY 5" e clicca Run
-- ============================================================

CREATE TABLE IF NOT EXISTS public.waitlist (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE UNIQUE,
    priority    INTEGER NOT NULL DEFAULT 3,
    -- 1 = Urgente (prima possibile)
    -- 2 = Presto (entro 1-2 mesi)
    -- 3 = Flessibile (quando capita)
    active      BOOLEAN DEFAULT true,
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view_own_waitlist"   ON public.waitlist FOR SELECT USING (auth.uid() = client_id);
CREATE POLICY "insert_own_waitlist" ON public.waitlist FOR INSERT WITH CHECK (auth.uid() = client_id);
CREATE POLICY "update_own_waitlist" ON public.waitlist FOR UPDATE USING (auth.uid() = client_id);
CREATE POLICY "delete_own_waitlist" ON public.waitlist FOR DELETE USING (auth.uid() = client_id);

-- FINE QUERY 5


-- ============================================================
--  QUERY 6 — CAMPI PROFILO (nome, cognome, telefono separati)
--  Copia tutto da qui fino a "FINE QUERY 6" e clicca Run
--  (Solo se la tabella clients è già stata creata con Query 1)
-- ============================================================

ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name  TEXT;

-- Aggiorna update_own_profile per includere i nuovi campi
-- (La policy UPDATE già esiste dalla Query 2, nessuna modifica necessaria)

-- FINE QUERY 6


-- ============================================================
--  QUERY 7 — TABELLE RESCHEDULE + NOTIFICATIONS + POLICY
--  Copia tutto da qui fino a "FINE QUERY 7" e clicca Run
-- ============================================================

-- Aggiunge cal_booking_uid agli appuntamenti (per riprogrammare via Cal.com API)
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cal_booking_uid TEXT;

-- Tabella richieste cambio data
CREATE TABLE IF NOT EXISTS public.reschedule_requests (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    appointment_id  UUID REFERENCES public.appointments(id) ON DELETE CASCADE,
    client_id       UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    requested_date  DATE NOT NULL,
    requested_time  TEXT NOT NULL,
    reason          TEXT,
    status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
    irene_notes     TEXT,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.reschedule_requests ENABLE ROW LEVEL SECURITY;

-- Cliente: può creare e leggere solo le sue richieste
CREATE POLICY "client_view_own_reschedule"   ON public.reschedule_requests FOR SELECT USING (auth.uid() = client_id);
CREATE POLICY "client_insert_own_reschedule" ON public.reschedule_requests FOR INSERT WITH CHECK (auth.uid() = client_id);

-- Admin (Irene): accesso completo
CREATE POLICY "admin_reschedule_requests" ON public.reschedule_requests
    FOR ALL TO authenticated
    USING     (auth.email() = 'irenegipsytattoo@gmail.com')
    WITH CHECK (auth.email() = 'irenegipsytattoo@gmail.com');

-- Tabella notifiche
CREATE TABLE IF NOT EXISTS public.notifications (
    id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT,
    client_id  UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    read       BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Admin (Irene): accesso completo
CREATE POLICY "admin_notifications" ON public.notifications
    FOR ALL TO authenticated
    USING     (auth.email() = 'irenegipsytattoo@gmail.com')
    WITH CHECK (auth.email() = 'irenegipsytattoo@gmail.com');

-- Clienti: possono inserire notifiche (per inviarle ad Irene)
CREATE POLICY "client_insert_notifications" ON public.notifications
    FOR INSERT WITH CHECK (auth.uid() = client_id);

-- FINE QUERY 7


-- ============================================================
--  QUERY 8 — NEWSLETTER CONSENT
--  Copia tutto da qui fino a "FINE QUERY 8" e clicca Run
-- ============================================================

ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS newsletter_consent BOOLEAN DEFAULT NULL;

-- FINE QUERY 8


-- ============================================================
--  QUERY 9 — CODICE FISCALE SU CLIENTS
--  Copia tutto da qui fino a "FINE QUERY 9" e clicca Run
-- ============================================================

ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS codice_fiscale TEXT;

-- FINE QUERY 9


-- ============================================================
--  QUERY 10 — POLICY ADMIN SU consent_documents (se non già creata)
--  Esegui SOLO se non hai rieseguito Query 2 sopra
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'consent_documents' AND policyname = 'admin_all_documents'
    ) THEN
        EXECUTE $policy$
            CREATE POLICY "admin_all_documents" ON public.consent_documents FOR ALL TO authenticated
                USING (auth.email() = 'irenegipsytattoo@gmail.com')
                WITH CHECK (auth.email() = 'irenegipsytattoo@gmail.com');
        $policy$;
    END IF;
END $$;

-- FINE QUERY 10


-- ============================================================
--  QUERY 11 — AGGIUNGI EMAIL A consent_documents
--  Copia tutto da qui fino a "FINE QUERY 11" e clicca Run
-- ============================================================

ALTER TABLE public.consent_documents
    ADD COLUMN IF NOT EXISTS email TEXT;

-- FINE QUERY 11


-- ============================================================
--  QUERY 12 — POLICY SELECT su Storage "consent-docs" per admin
--  Permette a Irene di generare signed URL dalla dashboard
--  Copia tutto da qui fino a "FINE QUERY 12" e clicca Run
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'admin_read_consent_docs'
    ) THEN
        EXECUTE $policy$
            CREATE POLICY "admin_read_consent_docs"
            ON storage.objects FOR SELECT TO authenticated
            USING (
                bucket_id = 'consent-docs'
                AND auth.jwt() ->> 'email' = 'irenegipsytattoo@gmail.com'
            );
        $policy$;
    END IF;
END $$;

-- FINE QUERY 12


-- ============================================================
--  QUERY 13 — Colonna session_price in appointments
--  Prezzo effettivo della seduta tatuaggio (distinto dall'acconto)
--  Copia tutto da qui fino a "FINE QUERY 13" e clicca Run
-- ============================================================

ALTER TABLE public.appointments
    ADD COLUMN IF NOT EXISTS session_price INTEGER;

-- FINE QUERY 13


-- ============================================================
--  QUERY 14 — Colonna session_payment_method in appointments
--  Modalità di pagamento della seduta: 'pos' o 'contanti'
--  Copia tutto da qui fino a "FINE QUERY 14" e clicca Run
-- ============================================================

ALTER TABLE public.appointments
    ADD COLUMN IF NOT EXISTS session_payment_method TEXT
    CHECK (session_payment_method IN ('pos', 'contanti'));

-- FINE QUERY 14


-- ============================================================
--  QUERY 15 — Colonna consultation_mode in reschedule_requests
--  Permette a Irene di cambiare modalità (WhatsApp/in studio)
--  quando propone una nuova data
--  Copia tutto da qui fino a "FINE QUERY 15" e clicca Run
-- ============================================================

ALTER TABLE public.reschedule_requests
    ADD COLUMN IF NOT EXISTS consultation_mode TEXT;

-- FINE QUERY 15
