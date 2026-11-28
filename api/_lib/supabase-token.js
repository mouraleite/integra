/* Troca o login Microsoft por um token do Supabase.
   O navegador manda o ID token do Entra ID em X-Integra-Token (o mesmo das outras rotas).
   A rota confere o token, procura o usuário em public.usuarios (cadastrado e ATIVO) e devolve
   um JWT curto, com role "authenticated" e sub = usuarios.id. As regras (RLS) do banco usam esse sub.

   Chave de assinatura, uma das duas (variáveis na Vercel):
   - SUPABASE_JWT_PRIVATE_KEY: chave privada ES256 em JWK (JSON), importada no Supabase em
     Project Settings > JWT Keys. Gerar com: node ferramentas/migracao/gerar-chave-jwt.js
   - SUPABASE_JWT_SECRET: o "Legacy JWT secret" do projeto (HS256). Só enquanto ele não for revogado.
   Esta rota sempre bloqueia quem não tem login; não depende de PROXY_AUTH_MODE. */
const { verificarToken } = require("../../lib/integra-auth");
const { supabaseAdmin } = require("../../lib/supabase-admin");
const { assinar } = require("../../lib/supabase-jwt");

const DURACAO_S = 60 * 60;

function responder(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function lerCabecalho(req, nome) {
  const h = req.headers || {};
  const k = Object.keys(h).find((n) => n.toLowerCase() === nome);
  return k ? String(h[k] || "") : "";
}

module.exports = async function handler(req, res) {
  const metodo = String(req.method || "").toUpperCase();
  if (metodo === "OPTIONS") return responder(res, 204, {});
  if (metodo !== "POST" && metodo !== "GET") return responder(res, 405, { error: "Método não permitido." });

  let acesso;
  try {
    acesso = await verificarToken(lerCabecalho(req, "x-integra-token"));
  } catch (e) {
    acesso = { ok: false, motivo: "erro-verificacao" };
  }
  if (!acesso.ok && acesso.motivo === "acesso-restrito") {
    console.warn("[supabase-token] " + JSON.stringify({ motivo: acesso.motivo, email: acesso.email || "" }));
    return responder(res, 403, {
      error: "O Integra novo ainda está em teste. Continue usando https://crm-gestao.vercel.app até 30/11/2026.",
      motivo: acesso.motivo
    });
  }
  if (!acesso.ok) {
    console.warn("[supabase-token] " + JSON.stringify({ motivo: acesso.motivo, email: acesso.email || "" }));
    return responder(res, 401, { error: "Faça login no Integra.", motivo: acesso.motivo });
  }

  // A conta Microsoft pode ser o e-mail do usuário ou um login compartilhado (login_email, ex.: colenci@
  // para os advogados). No compartilhado, o navegador diz qual usuário escolheu em X-Integra-Usuario.
  let usuario;
  try {
    const { data, error } = await supabaseAdmin()
      .from("usuarios")
      .select("id, nome, email, login_email, perfil, status")
      .or('email.eq."' + acesso.email + '",login_email.eq."' + acesso.email + '"');
    if (error) throw error;
    const lista = data || [];
    const escolhido = lerCabecalho(req, "x-integra-usuario").toLowerCase().trim();
    usuario = lista.find((u) => u.email === acesso.email)
      || (lista.length === 1 ? lista[0] : lista.find((u) => escolhido && u.email === escolhido));
    if (!usuario && lista.length > 1) {
      return responder(res, 409, { error: "Login compartilhado: informe o usuário em X-Integra-Usuario.", opcoes: lista.map((u) => u.email) });
    }
  } catch (e) {
    console.error("[supabase-token] erro ao ler usuarios: " + (e && e.message));
    return responder(res, 503, { error: "Não foi possível conferir o usuário agora." });
  }
  if (!usuario || String(usuario.status || "").toUpperCase() === "INATIVO") {
    console.warn("[supabase-token] " + JSON.stringify({ motivo: "nao-cadastrado-ou-inativo", email: acesso.email }));
    return responder(res, 403, { error: "Seu usuário não está cadastrado ou está inativo no Integra." });
  }

  const agora = Math.floor(Date.now() / 1000);
  const exp = agora + DURACAO_S;
  let token;
  try {
    token = assinar({
      iss: String(process.env.SUPABASE_URL || "").replace(/\/+$/, "") + "/auth/v1",
      aud: "authenticated",
      role: "authenticated",
      sub: usuario.id,
      email: usuario.email,
      iat: agora,
      exp,
      app_metadata: { provider: "entra-id", perfil: usuario.perfil },
      user_metadata: { nome: usuario.nome }
    });
  } catch (e) {
    console.error("[supabase-token] " + (e && e.message));
    return responder(res, 500, { error: "Token do banco não configurado no servidor." });
  }
  return responder(res, 200, { token, expira_em: exp, usuario: { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil } });
};
