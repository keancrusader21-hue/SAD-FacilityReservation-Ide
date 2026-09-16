const SUPABASE_URL = "https://bfmxmhjywmtabjeqeclo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_nXOIDwnWGmw70R3f45dX9Q_oZ35EuKk";


const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
