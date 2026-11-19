// Gera a chave ES256 que /api/supabase-token usa para assinar os tokens do Supabase.
// Uso: node ferramentas/migracao/gerar-chave-jwt.js [pasta-de-saida]
// Grava a chave privada em <pasta>/chave-jwt-supabase.json (padrão: ..\integra-export, fora do Git).
// A chave não é mostrada na tela. Depois:
//   1. Supabase > Project Settings > JWT Keys > Create standby key > Import: colar o conteúdo do arquivo.
//      Em seguida "Rotate keys" para ela virar a chave em uso.
//   2. Vercel (time mouraleite, projeto integra) > Settings > Environment Variables:
//      SUPABASE_JWT_PRIVATE_KEY = o mesmo conteúdo, em uma linha.
//   3. Apagar o arquivo ou guardá-lo num cofre de senhas.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const pasta = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "..", "integra-export"));
fs.mkdirSync(pasta, { recursive: true });
const arquivo = path.join(pasta, "chave-jwt-supabase.json");
if (fs.existsSync(arquivo)) {
  console.error("Já existe " + arquivo + ". Apague antes de gerar outra.");
  process.exit(1);
}

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = privateKey.export({ format: "jwk" });
const chave = { kty: jwk.kty, kid: crypto.randomUUID(), use: "sig", key_ops: ["sign", "verify"], alg: "ES256", ext: true, d: jwk.d, crv: jwk.crv, x: jwk.x, y: jwk.y };
fs.writeFileSync(arquivo, JSON.stringify(chave), { mode: 0o600 });
console.log("Chave gravada em " + arquivo + " (kid " + chave.kid + ").");
console.log("Importe no Supabase (JWT Keys) e cadastre na Vercel como SUPABASE_JWT_PRIVATE_KEY.");
