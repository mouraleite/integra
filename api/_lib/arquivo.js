/* Abre um arquivo do bucket privado "arquivos" (Supabase Storage).
   GET /arquivo?p=<caminho>[&download=1]   (vercel.json: /arquivo -> /api/gateway?path=arquivo)

   As telas usam este link em <img>, <a href>, window.open e fetch, que não levam cabeçalho de login. Por isso o
   token do Supabase vem no cookie "integra_sb" (gravado por js/nucleo/supabase-client.js, só para o caminho /arquivo),
   ou em Authorization: Bearer. O servidor confere a assinatura e a validade (lib/supabase-jwt.js), confere que o
   usuário segue ativo e redireciona para um link assinado de 5 minutos.

   Reserva até a virada: se o objeto ainda não estiver no Supabase, redireciona para o Firebase Storage (que hoje
   abre sem login). Desligar com STORAGE_FIREBASE_RESERVA=0 depois da cópia dos arquivos (Fase 4). */
const { supabaseAdmin } = require("../../lib/supabase-admin");
const { verificar } = require("../../lib/supabase-jwt");
const DadosBase = require("../../js/nucleo/dados-base.js");

const BUCKET = "arquivos";
const VALIDADE_S = 300;
const FIREBASE = "https://firebasestorage.googleapis.com/v0/b/crm-gestao-mldu.firebasestorage.app/o/";

function responder(res, status, texto) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(texto);
}

function cookie(req, nome) {
  const bruto = String((req.headers && req.headers.cookie) || "");
  const achado = bruto.split(";").map((s) => s.trim()).find((s) => s.indexOf(nome + "=") === 0);
  return achado ? decodeURIComponent(achado.slice(nome.length + 1)) : "";
}

function tokenDe(req) {
  const auth = String((req.headers && req.headers.authorization) || "");
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return cookie(req, "integra_sb");
}

// Usuário ativo (cache de 2 minutos por id): o token vale 1 hora, mas quem foi desativado para de abrir arquivos logo.
const ativos = new Map();
async function usuarioAtivo(id) {
  const c = ativos.get(id);
  if (c && Date.now() - c.em < 2 * 60 * 1000) return c.ok;
  const r = await supabaseAdmin().from("usuarios").select("status").eq("id", id).maybeSingle();
  if (r.error) throw r.error;
  const ok = !!(r.data && String(r.data.status || "").toUpperCase() === "ATIVO");
  ativos.set(id, { ok, em: Date.now() });
  return ok;
}

module.exports = async function handler(req, res) {
  const metodo = String(req.method || "").toUpperCase();
  if (metodo !== "GET" && metodo !== "HEAD") return responder(res, 405, "Método não permitido.");

  const url = new URL(String(req.url || ""), "http://integra.local");
  const caminho = DadosBase.caminhoStorage(url.searchParams.get("p") || "");
  if (!caminho || caminho.split("/").some((p) => p === ".." || p === ".") || caminho.length > 1024) {
    return responder(res, 400, "Arquivo inválido.");
  }

  const payload = verificar(tokenDe(req));
  if (!payload) return responder(res, 401, "Faça login no Integra para abrir este arquivo.");
  try {
    if (!(await usuarioAtivo(payload.sub))) return responder(res, 403, "Seu usuário está inativo no Integra.");
  } catch (e) {
    return responder(res, 503, "Não foi possível conferir o usuário agora.");
  }

  const chave = DadosBase.chaveStorage(caminho);
  const baixar = url.searchParams.get("download") === "1";
  const nome = caminho.split("/").pop();
  let destino = "";
  try {
    const r = await supabaseAdmin().storage.from(BUCKET)
      .createSignedUrl(chave, VALIDADE_S, baixar ? { download: nome } : undefined);
    if (!r.error && r.data && r.data.signedUrl) destino = r.data.signedUrl;
  } catch (e) {}
  if (!destino) {
    if (process.env.STORAGE_FIREBASE_RESERVA === "0") return responder(res, 404, "Arquivo não encontrado.");
    destino = FIREBASE + encodeURIComponent(caminho) + "?alt=media";
  }
  res.statusCode = 302;
  res.setHeader("Location", destino);
  // O link assinado vale 5 minutos: o navegador pode reaproveitar o redirecionamento por 4.
  res.setHeader("Cache-Control", "private, max-age=240");
  res.end();
};
