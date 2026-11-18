/* Leitura do repositório mouraleite/integra para a faixa de ambientes de teste (aviso-develop.js).
   Usa a chave GITHUB_LEITURA_TOKEN da Vercel (token "Contents: Read-only" só no repositório integra),
   para o repositório poder ficar privado. Só aceita as três leituras que a faixa faz:
   lista de branches, comparação entre dois commits e um commit.
   Sem a chave cadastrada, responde 503 { semToken: true } e a faixa lê direto do GitHub (repositório público). */
const https = require("https");

const REPO = "mouraleite/integra";
const PERMITIDO = /^(branches\?per_page=\d{1,3}|compare\/[0-9a-f]{7,40}\.\.\.[0-9a-f]{7,40}|commits\/[0-9a-f]{7,40})$/;

function responder(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (String(req.method || "").toUpperCase() !== "GET") return responder(res, 405, { error: "Use GET." });
  const token = String(process.env.GITHUB_LEITURA_TOKEN || "").trim();
  if (!token) return responder(res, 503, { semToken: true, error: "Leitura do GitHub com chave ainda não configurada." });

  let caminho = "";
  try { caminho = new URL(req.url, "http://x").searchParams.get("c") || ""; } catch (e) { caminho = ""; }
  if (!PERMITIDO.test(caminho)) return responder(res, 400, { error: "Leitura não permitida." });

  const headers = {
    "User-Agent": "integra-moura-leite",
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + token,
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const etag = req.headers["if-none-match"];
  if (etag) headers["If-None-Match"] = String(etag);

  const gh = https.request({ hostname: "api.github.com", path: "/repos/" + REPO + "/" + caminho, method: "GET", headers, timeout: 20000 }, (r) => {
    res.statusCode = r.statusCode;
    res.setHeader("Content-Type", r.headers["content-type"] || "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (r.headers.etag) res.setHeader("ETag", r.headers.etag);
    r.pipe(res);
  });
  gh.on("timeout", () => gh.destroy(new Error("tempo esgotado")));
  gh.on("error", () => { if (!res.headersSent) responder(res, 502, { error: "O GitHub não respondeu." }); });
  gh.end();
};
