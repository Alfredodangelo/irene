// =============================================
//  SUPABASE CLIENT - Irene Gipsy Tattoo
//  Inizializzazione condivisa tra tutte le pagine
// =============================================

const SUPABASE_URL = 'https://ptoerfxyydlcjstiqqwb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pu-zRMgXcQu1XbItGWWQIg_g_re7rji';

// Istanza globale del client Supabase
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
