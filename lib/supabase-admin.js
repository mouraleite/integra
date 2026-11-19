// Cliente do Supabase para as funções do servidor (api/, lib/) e scripts de migração.
// Usa a chave de serviço (service role), que ignora as regras de acesso: nunca mandar para o navegador.
// Variáveis na Vercel: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
const { createClient } = require("@supabase/supabase-js");

let cliente = null;

function supabaseAdmin() {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    throw new Error("Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente.");
  }
  cliente = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  return cliente;
}

module.exports = { supabaseAdmin };
