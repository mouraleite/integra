// Cliente do Supabase no navegador (migração Firebase -> Supabase, branch migracao-supabase).
// Por enquanto só cria o cliente e o deixa em window.sb; as telas ainda usam o Firebase.
// A chave abaixo é a "publishable": é pública por natureza, quem protege os dados são as regras (RLS) do banco.
// Na Fase 1 o cliente passa a usar um token emitido por /api/supabase-token depois do login Microsoft.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://ujtdtezymcyjnbqkelgp.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7MS57phgmJKJmUsO-8IjDQ_QuBGsYNu";

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

window.sb = sb;
window.dispatchEvent(new Event("supabase-pronto"));
