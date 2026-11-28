/* Tokens do Supabase emitidos pelo próprio Integra (api/_lib/supabase-token.js) e conferidos pelo servidor
   (api/_lib/arquivo.js). Chave, uma das duas (variáveis na Vercel):
   - SUPABASE_JWT_PRIVATE_KEY: chave privada ES256 em JWK (JSON), importada no Supabase em Project Settings > JWT Keys.
   - SUPABASE_JWT_SECRET: o "Legacy JWT secret" do projeto (HS256). Só enquanto ele não for revogado. */
const crypto = require("crypto");

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function deB64url(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

let chaveCache = null;
function chaveAssinatura() {
  if (chaveCache) return chaveCache;
  const jwk = String(process.env.SUPABASE_JWT_PRIVATE_KEY || "").trim();
  if (jwk) {
    const k = JSON.parse(jwk);
    if (!k.kid || !k.d) throw new Error("SUPABASE_JWT_PRIVATE_KEY precisa ser a chave privada em JWK, com kid.");
    const privada = crypto.createPrivateKey({ key: k, format: "jwk" });
    chaveCache = { alg: "ES256", kid: k.kid, key: privada, publica: crypto.createPublicKey(privada) };
    return chaveCache;
  }
  const segredo = String(process.env.SUPABASE_JWT_SECRET || "");
  if (segredo) {
    chaveCache = { alg: "HS256", key: segredo };
    return chaveCache;
  }
  throw new Error("Falta SUPABASE_JWT_PRIVATE_KEY (ou SUPABASE_JWT_SECRET) nas variáveis de ambiente.");
}

function assinar(payload) {
  const c = chaveAssinatura();
  const cab = { alg: c.alg, typ: "JWT" };
  if (c.kid) cab.kid = c.kid;
  const corpo = b64url(JSON.stringify(cab)) + "." + b64url(JSON.stringify(payload));
  const assinatura = c.alg === "ES256"
    ? crypto.sign("sha256", Buffer.from(corpo), { key: c.key, dsaEncoding: "ieee-p1363" })
    : crypto.createHmac("sha256", c.key).update(corpo).digest();
  return corpo + "." + b64url(assinatura);
}

/** Confere assinatura, validade e papel. Devolve o payload ou null. */
function verificar(token) {
  const partes = String(token || "").split(".");
  if (partes.length !== 3) return null;
  let cab;
  let payload;
  try {
    cab = JSON.parse(deB64url(partes[0]).toString("utf8"));
    payload = JSON.parse(deB64url(partes[1]).toString("utf8"));
  } catch (e) {
    return null;
  }
  let c;
  try { c = chaveAssinatura(); } catch (e) { return null; }
  if (!cab || cab.alg !== c.alg) return null;
  const corpo = Buffer.from(partes[0] + "." + partes[1]);
  const assinatura = deB64url(partes[2]);
  let ok = false;
  try {
    if (c.alg === "ES256") {
      ok = crypto.verify("sha256", corpo, { key: c.publica, dsaEncoding: "ieee-p1363" }, assinatura);
    } else {
      const esperada = crypto.createHmac("sha256", c.key).update(corpo).digest();
      ok = esperada.length === assinatura.length && crypto.timingSafeEqual(esperada, assinatura);
    }
  } catch (e) {
    ok = false;
  }
  if (!ok) return null;
  const agora = Math.floor(Date.now() / 1000);
  if (!payload || typeof payload.exp !== "number" || payload.exp <= agora) return null;
  if (payload.role !== "authenticated" || !payload.sub) return null;
  return payload;
}

module.exports = { assinar, verificar, b64url };
