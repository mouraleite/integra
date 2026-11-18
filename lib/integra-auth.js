/* Confere se quem chama a API está logado no Integra com a conta Microsoft da empresa.
   O navegador manda o token de login (ID token do Entra ID) no cabeçalho X-Integra-Token.
   Modo padrão: só registra quem chega sem login. Para bloquear, criar na Vercel
   PROXY_AUTH_MODE=bloquear e fazer um novo deploy. */
const crypto = require("crypto");
const https = require("https");

const TENANT_ID = "34bf99e3-12de-4814-ab19-0d0f90fab15b";
const CLIENT_ID = "643259b4-6f72-4f25-8a2d-ac131a34f169";
const JWKS_URL = "https://login.microsoftonline.com/" + TENANT_ID + "/discovery/v2.0/keys";
const EMISSORES = [
  "https://login.microsoftonline.com/" + TENANT_ID + "/v2.0",
  "https://sts.windows.net/" + TENANT_ID + "/"
];
const FOLGA_RELOGIO_S = 120;

let chaves = {};
let chavesEm = 0;
let buscando = null;

function baixarJson(url, ms) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: ms }, (res) => {
      const partes = [];
      res.on("data", (c) => partes.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(partes).toString("utf8"))); } catch (e) { reject(e); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("tempo esgotado")));
    req.on("error", reject);
  });
}

async function atualizarChaves() {
  if (buscando) return buscando;
  buscando = baixarJson(JWKS_URL, 4000).then((json) => {
    const novas = {};
    ((json && json.keys) || []).forEach((k) => {
      if (k && k.kid && k.kty === "RSA") {
        try { novas[k.kid] = crypto.createPublicKey({ key: k, format: "jwk" }); } catch (e) {}
      }
    });
    if (Object.keys(novas).length) {
      chaves = novas;
      chavesEm = Date.now();
    }
  }).finally(() => { buscando = null; });
  return buscando;
}

async function chavePublica(kid) {
  const velha = Date.now() - chavesEm > 6 * 3600 * 1000;
  // Chave desconhecida: a Microsoft pode ter trocado; busca de novo, no máximo a cada 5 minutos.
  const desconhecida = !chaves[kid] && Date.now() - chavesEm > 5 * 60 * 1000;
  if (velha || desconhecida) await atualizarChaves();
  return chaves[kid] || null;
}

function b64url(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function dominioOk(email) {
  const d = String(email || "").toLowerCase().split("@")[1] || "";
  return d === "mouraleite.com.br" || d === "mouraleite.com";
}

async function verificarToken(token) {
  const partes = String(token || "").split(".");
  if (partes.length !== 3) return { ok: false, motivo: "formato" };
  let cab, dados;
  try {
    cab = JSON.parse(b64url(partes[0]).toString("utf8"));
    dados = JSON.parse(b64url(partes[1]).toString("utf8"));
  } catch (e) {
    return { ok: false, motivo: "formato" };
  }
  if (cab.alg !== "RS256" || !cab.kid) return { ok: false, motivo: "algoritmo" };
  const chave = await chavePublica(cab.kid);
  if (!chave) return { ok: false, motivo: "chave-desconhecida" };
  const valido = crypto.verify("RSA-SHA256", Buffer.from(partes[0] + "." + partes[1]), chave, b64url(partes[2]));
  if (!valido) return { ok: false, motivo: "assinatura" };
  const agora = Math.floor(Date.now() / 1000);
  const email = String(dados.preferred_username || dados.email || dados.upn || "").toLowerCase();
  if (dados.aud !== CLIENT_ID) return { ok: false, motivo: "aplicativo", email };
  if (dados.tid !== TENANT_ID || EMISSORES.indexOf(dados.iss) < 0) return { ok: false, motivo: "empresa", email };
  if (!dados.exp || dados.exp + FOLGA_RELOGIO_S < agora) return { ok: false, motivo: "vencido", email };
  if (dados.nbf && dados.nbf - FOLGA_RELOGIO_S > agora) return { ok: false, motivo: "ainda-nao-vale", email };
  if (!dominioOk(email)) return { ok: false, motivo: "dominio", email };
  return { ok: true, motivo: "ok", email };
}

function cronAutorizado(req) {
  const segredo = process.env.CRON_SECRET || "";
  if (!segredo) return false;
  const h = String((req.headers && req.headers.authorization) || "");
  const esperado = "Bearer " + segredo;
  if (h.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(esperado));
}

function modoBloqueio() {
  return String(process.env.PROXY_AUTH_MODE || "").trim().toLowerCase() === "bloquear";
}

/* Nunca lança erro. Devolve { ok, motivo, email }. Remove o token do pedido
   para ele não seguir para o Sienge nem para outros serviços. */
async function conferirAcesso(req) {
  const headers = req.headers || {};
  let token = "";
  Object.keys(headers).forEach((k) => {
    if (k.toLowerCase() === "x-integra-token") {
      token = String(headers[k] || "");
      delete headers[k];
    }
  });
  try {
    if (cronAutorizado(req)) return { ok: true, motivo: "cron" };
    if (!token) return { ok: false, motivo: "sem-login" };
    return await verificarToken(token);
  } catch (e) {
    return { ok: false, motivo: "erro-verificacao" };
  }
}

/* Usuário cadastrado e ativo no Integra (Configurações > Usuários, documento config/crm_users).
   Lista guardada por 5 minutos. Se o banco não responder e não houver lista guardada, não barra
   (devolve null) para uma falha do banco não derrubar o Integra inteiro. */
const FIRESTORE_USERS = "https://firestore.googleapis.com/v1/projects/crm-gestao-mldu/databases/(default)/documents/config/crm_users";
let usuariosCache = null;
let usuariosEm = 0;

function valorFs(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return ((v.arrayValue && v.arrayValue.values) || []).map(valorFs);
  if ("mapValue" in v) {
    const o = {};
    const f = (v.mapValue && v.mapValue.fields) || {};
    Object.keys(f).forEach((k) => { o[k] = valorFs(f[k]); });
    return o;
  }
  return null;
}

async function listaUsuarios() {
  if (usuariosCache && Date.now() - usuariosEm < 5 * 60 * 1000) return usuariosCache;
  try {
    const doc = await baixarJson(FIRESTORE_USERS, 4000);
    const campos = valorFs({ mapValue: { fields: (doc && doc.fields) || {} } }) || {};
    let lista = campos.list || campos.crm_users || "[]";
    if (typeof lista === "string") lista = JSON.parse(lista);
    if (Array.isArray(lista) && lista.length) {
      usuariosCache = lista;
      usuariosEm = Date.now();
    }
  } catch (e) {}
  return usuariosCache;
}

function normal(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

/** true = cadastrado e ativo; false = não cadastrado ou inativo; null = não deu para conferir. */
async function usuarioAtivoIntegra(email) {
  const alvo = String(email || "").toLowerCase().trim();
  if (!alvo) return false;
  const lista = await listaUsuarios();
  if (!lista) return null;
  const u = lista.find((x) => x && (String(x.email || "").toLowerCase().trim() === alvo
    || String(x.login_email || "").toLowerCase().trim() === alvo));
  if (!u) return false;
  return normal(u.status || "ATIVO") !== "INATIVO";
}

module.exports = { conferirAcesso, modoBloqueio, verificarToken, usuarioAtivoIntegra };
