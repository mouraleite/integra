/* Uma única função da Vercel. /api/sienge-proxy, /api/scod-proxy e as demais
   continuam no mesmo endereço; o rewrite manda tudo para cá. O código fica em api/_lib. */
const rotas = {
  "sienge-proxy": require("./_lib/sienge-proxy"),
  "sienge-builder-proxy": require("./_lib/sienge-builder-proxy"),
  "sync-customers": require("./_lib/sync-customers"),
  "sync-creditors": require("./_lib/sync-creditors"),
  "cvcrm-proxy": require("./_lib/cvcrm-proxy"),
  "scod-proxy": require("./_lib/scod-proxy"),
  "clicksign": require("./_lib/clicksign"),
  "proxy-download": require("./_lib/proxy-download"),
  "bcb-sgs": require("./_lib/bcb-sgs"),
  "cnpj": require("./_lib/bcb-sgs"),
  "controle-comissao": require("./_lib/controle-comissao"),
  "participacoes": require("./_lib/participacoes"),
  "morning-warmup": require("./_lib/morning-warmup"),
  "caucao-batimento": require("./_lib/morning-warmup"),
  "distrato-followup": require("./_lib/morning-warmup"),
  "valor-receber": require("./_lib/morning-warmup"),
  "titulos-incompletos-batimento": require("./_lib/morning-warmup"),
  "estoque-batimento": require("./_lib/estoque-batimento"),
  "rydoo-email": require("./_lib/rydoo-email")
};

const { conferirAcesso, modoBloqueio } = require("../lib/integra-auth");

// Rotas usadas pelas telas do Integra que acessam sistemas com senha (Sienge, SCOD, CV, Clicksign...).
// As rotinas automáticas (morning-warmup, estoque-batimento...) seguem protegidas pelo CRON_SECRET.
const ROTAS_COM_LOGIN = new Set([
  "sienge-proxy", "sienge-builder-proxy", "sync-customers", "sync-creditors",
  "cvcrm-proxy", "scod-proxy", "clicksign", "proxy-download",
  "controle-comissao", "participacoes", "rydoo-email"
]);

module.exports.config = {
  api: { bodyParser: false }
};

function ler(req) {
  const raw = String(req.url || "");
  const q = raw.indexOf("?");
  const itens = q < 0 ? [] : raw.slice(q + 1).split("&").filter(Boolean);
  let caminho = "";
  const resto = [];
  itens.forEach((item) => {
    const eq = item.indexOf("=");
    const key = decodeURIComponent((eq < 0 ? item : item.slice(0, eq)).replace(/\+/g, " "));
    const val = eq < 0 ? "" : item.slice(eq + 1);
    if (key === "path" && !caminho) caminho = decodeURIComponent(val.replace(/\+/g, " "));
    else resto.push(item);
  });
  if (!caminho && req.query && req.query.path) {
    caminho = Array.isArray(req.query.path) ? req.query.path.join("/") : String(req.query.path);
  }
  return { caminho, busca: resto.length ? "?" + resto.join("&") : "" };
}

module.exports = async function handler(req, res) {
  const { caminho, busca } = ler(req);
  const pedacos = String(caminho || "").split("/").filter(Boolean);
  const nome = pedacos[0] || "";
  const fn = rotas[nome];
  if (!fn) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Rota não encontrada." }));
    return;
  }
  const sub = pedacos.slice(1).join("/");
  req.url = "/api/" + nome + (sub ? "/" + sub : "") + busca;

  if (ROTAS_COM_LOGIN.has(nome) && String(req.method || "").toUpperCase() !== "OPTIONS") {
    const acesso = await conferirAcesso(req);
    try { res.setHeader("X-Integra-Auth", acesso.motivo); } catch (e) {}
    if (!acesso.ok) {
      const bloquear = modoBloqueio();
      console.warn("[integra-auth] " + JSON.stringify({
        acao: bloquear ? "bloqueado" : "so-registro",
        motivo: acesso.motivo,
        email: acesso.email || "",
        rota: nome,
        metodo: req.method,
        caminho: ("/" + sub).slice(0, 120),
        origem: req.headers.origin || req.headers.referer || "",
        ip: String(req.headers["x-forwarded-for"] || "").split(",")[0].trim(),
        navegador: String(req.headers["user-agent"] || "").slice(0, 120)
      }));
      if (bloquear) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "Faça login no Integra para acessar este recurso." }));
        return;
      }
    }
  }
  return fn(req, res);
};
