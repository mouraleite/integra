// Cliente do Supabase no navegador (window.sb). Usado pelas camadas js/<area>/dados-*.js e pelos arquivos
// (js/nucleo/storage-supabase.js; o cookie integra_sb abre os links /arquivo?p=...).
// A chave abaixo é a "publishable": é pública por natureza. Quem protege os dados são as regras (RLS) do banco,
// que só liberam o acesso com o token emitido por /api/supabase-token depois do login Microsoft.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://ujtdtezymcyjnbqkelgp.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7MS57phgmJKJmUsO-8IjDQ_QuBGsYNu";
const FOLGA_MS = 2 * 60 * 1000;

let atual = { token: "", exp: 0, usuario: null };
let buscando = null;
let sb = null;

// Os links de arquivo (/arquivo?p=..., ver api/_lib/arquivo.js) abrem em <img>, <a> e abas novas, que não levam
// cabeçalho: o token vai num cookie que só vale para o caminho /arquivo.
function gravarCookieArquivo(token, expMs) {
  try {
    const seg = token ? Math.max(0, Math.floor((expMs - Date.now()) / 1000)) : 0;
    document.cookie = "integra_sb=" + encodeURIComponent(token || "") + "; Path=/arquivo; Max-Age=" + seg
      + "; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
  } catch (e) {}
}

// Fase de teste do site novo: quem não está liberado vê este aviso e o link do endereço atual (não dá para fechar).
function avisarAcessoRestrito(texto) {
  if (document.getElementById("acesso-restrito")) return;
  const ov = document.createElement("div");
  ov.id = "acesso-restrito";
  ov.setAttribute("role", "alertdialog");
  ov.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Outfit,Segoe UI,sans-serif;";
  const caixa = document.createElement("div");
  caixa.style.cssText = "width:500px;max-width:100%;background:#fff;border-radius:10px;border-top:5px solid #105436;box-shadow:0 18px 40px rgba(0,0,0,.25);padding:22px 24px;";
  const h = document.createElement("h3");
  h.style.cssText = "margin:0 0 10px;color:#105436;font-size:1.15rem;";
  h.textContent = "Acesso ainda não liberado";
  const p = document.createElement("p");
  p.style.cssText = "margin:0 0 16px;color:#1c2e24;font-size:0.92rem;line-height:1.45;";
  p.textContent = texto || "Seu acesso ao Integra ainda não foi liberado. Fale com o administrador.";
  const a = document.createElement("a");
  a.href = "https://integra-mouraleite.vercel.app/";
  a.textContent = "Voltar ao início";
  a.style.cssText = "display:inline-flex;align-items:center;height:38px;padding:0 16px;border-radius:8px;background:#105436;color:#fff;font-weight:700;text-decoration:none;";
  caixa.appendChild(h); caixa.appendChild(p); caixa.appendChild(a);
  ov.appendChild(caixa);
  (document.body || document.documentElement).appendChild(ov);
}

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
    if (r.status === 403) {
      let corpo = {};
      try { corpo = await r.json(); } catch (e) {}
      if (corpo && corpo.motivo === "acesso-restrito") avisarAcessoRestrito(corpo.error);
    }
    return null;
  }
  const dados = await r.json();
  atual = { token: dados.token, exp: Number(dados.expira_em) * 1000, usuario: dados.usuario || null };
  gravarCookieArquivo(atual.token, atual.exp);
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
window.sbLimparToken = () => { atual = { token: "", exp: 0, usuario: null }; gravarCookieArquivo("", 0); };
// Mantém o cookie dos arquivos válido mesmo numa tela parada (só renova quando falta pouco para vencer).
setInterval(() => { if (atual.token) tokenSupabase(); }, 5 * 60 * 1000);
window.dispatchEvent(new Event("supabase-pronto"));
