// Cliente do Supabase no navegador (migração Firebase -> Supabase, branch migracao-supabase).
// As telas ainda usam o Firebase; este cliente fica em window.sb para as áreas já migradas.
// A chave abaixo é a "publishable": é pública por natureza. Quem protege os dados são as regras (RLS) do banco,
// que só liberam o acesso com o token emitido por /api/supabase-token depois do login Microsoft.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://ujtdtezymcyjnbqkelgp.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7MS57phgmJKJmUsO-8IjDQ_QuBGsYNu";
const FOLGA_MS = 2 * 60 * 1000;

let atual = { token: "", exp: 0, usuario: null };
let buscando = null;
let sb = null;

async function pedirToken() {
  const auth = window.MouraAuth;
  if (!auth || typeof auth.getIntegraToken !== "function") return null;
  const tokenMicrosoft = await auth.getIntegraToken();
  if (!tokenMicrosoft) return null;
  // Login compartilhado (uma conta Microsoft para vários usuários): o servidor usa o usuário escolhido na sessão.
  const sessao = typeof auth.getCurrentUser === "function" ? auth.getCurrentUser() : null;
  const headers = { "X-Integra-Token": tokenMicrosoft };
  if (sessao && sessao.email) headers["X-Integra-Usuario"] = String(sessao.email).toLowerCase();
  const r = await fetch("/api/supabase-token", { method: "POST", headers, cache: "no-store" });
  if (!r.ok) {
    console.warn("[supabase] token recusado: " + r.status);
    return null;
  }
  const dados = await r.json();
  atual = { token: dados.token, exp: Number(dados.expira_em) * 1000, usuario: dados.usuario || null };
  // Nesta versão do supabase-js o Realtime não lê o accessToken sozinho.
  try { if (sb) sb.realtime.setAuth(atual.token); } catch (e) {}
  return atual.token;
}

// Devolve o token do Supabase, renovando antes de vencer. Sem login devolve null, e o banco nega tudo.
async function tokenSupabase() {
  if (atual.token && atual.exp - Date.now() > FOLGA_MS) return atual.token;
  if (!buscando) {
    buscando = pedirToken()
      .catch((e) => { console.warn("[supabase] " + (e && e.message)); return null; })
      .finally(() => { buscando = null; });
  }
  return buscando;
}

sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { accessToken: tokenSupabase });

window.sb = sb;
window.sbToken = tokenSupabase;
window.sbUsuario = () => atual.usuario;
window.sbLimparToken = () => { atual = { token: "", exp: 0, usuario: null }; };
window.dispatchEvent(new Event("supabase-pronto"));
