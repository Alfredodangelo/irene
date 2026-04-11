// =============================================
//  PUSH NOTIFICATIONS CONFIG - Irene Gipsy Tattoo
//
//  ⚠️  SETUP OBBLIGATORIO:
//  1. Apri /generate-vapid-keys.html nel browser
//  2. Copia la Public Key qui sotto
//  3. Copia la Private Key nelle variabili ambiente n8n
//  4. Crea la tabella push_subscriptions in Supabase (vedi SQL sotto)
//
//  SQL per Supabase:
//  CREATE TABLE push_subscriptions (
//    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
//    endpoint text NOT NULL,
//    p256dh text NOT NULL,
//    auth text NOT NULL,
//    user_agent text,
//    created_at timestamptz DEFAULT now(),
//    updated_at timestamptz DEFAULT now(),
//    UNIQUE(user_id, endpoint)
//  );
//  ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
//  CREATE POLICY "Users manage own subscriptions"
//    ON push_subscriptions FOR ALL
//    USING (auth.uid() = user_id)
//    WITH CHECK (auth.uid() = user_id);
//
// =============================================

const VAPID_PUBLIC_KEY = 'BAzB1_7H9MmyZGn2VeTLmfYdKHgekj3ZY7ElmD93ODlxvBChvKN-43VH-BLAepBnSMr8D3XyLua_DpS56Jp7soE';
