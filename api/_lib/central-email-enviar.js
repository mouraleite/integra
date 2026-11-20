/* Central de e-mail: envio automático das réguas ligadas.
   O navegador (quando a fila do dia fica pronta) manda, por cliente da régua, só os DADOS:
   id do template, cliente, título, valores das variáveis e parcelas vencidas.
   O servidor:
   - lê o template no banco e só envia se estiver aprovado e com a régua ligada;
   - monta o assunto e o texto a partir do template aprovado (o navegador não manda texto pronto);
   - descobre o destinatário: e-mail do cliente no Sienge ou o e-mail fixo do template, e a cópia do template;
   - anexa o extrato em PDF do Sienge quando o template tem {{extrato}};
   - envia pela caixa do Microsoft 365 configurada (GRAPH_MAILBOX, a mesma do Rydoo);
   - registra em central_email_envios: no máximo um e-mail por régua, por cliente e título, por dia. */
const https = require("https");
const { graphMailConfigured, sendMail } = require("../../lib/graph-mail");
const { dados, tabela } = require("../../lib/dados-servidor");

const SIENGE = "https://api.sienge.com.br/mouraleite/public/api/v1";
const MAX_ITENS = 8;
const EMAIL_OK = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

function responder(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > 400 * 1024) { reject(new Error("Pedido grande demais.")); req.destroy(); return; }
      partes.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(partes).toString("utf8") || "{}")); } catch (e) { reject(new Error("JSON inválido.")); }
    });
    req.on("error", reject);
  });
}

function http(url, opts, corpo, saltos) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: (opts && opts.method) || "GET", headers: (opts && opts.headers) || {}, timeout: 25000 }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && (saltos || 0) < 4) {
        r.resume();
        resolve(http(new URL(r.headers.location, url).toString(), { headers: {} }, null, (saltos || 0) + 1));
        return;
      }
      const partes = [];
      r.on("data", (c) => partes.push(c));
      r.on("end", () => resolve({ status: r.statusCode, headers: r.headers, buffer: Buffer.concat(partes) }));
    });
    req.on("timeout", () => req.destroy(new Error("tempo esgotado")));
    req.on("error", reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}

/* ---------- banco (Supabase, service role) ---------- */
async function lerTemplates() {
  const snap = await dados().DadosNucleo.lerConfig("central_email");
  const cfg = snap.exists() ? snap.data() : null;
  return (cfg && Array.isArray(cfg.templates)) ? cfg.templates : [];
}

function lerEnvio(id) {
  return tabela("central_email_envios").obter(id);
}

function gravarEnvio(id, obj) {
  return tabela("central_email_envios").gravar(id, obj);
}

/* ---------- Sienge ---------- */
function siengeAuth() {
  return "Basic " + Buffer.from((process.env.SIENGE_API_USER || "") + ":" + (process.env.SIENGE_API_PASSWORD || "")).toString("base64");
}

async function siengeJson(caminho) {
  const r = await http(SIENGE + caminho, { headers: { Authorization: siengeAuth(), Accept: "application/json" } });
  if (r.status !== 200) throw new Error("Sienge respondeu " + r.status + " em " + caminho.split("?")[0]);
  return JSON.parse(r.buffer.toString("utf8"));
}

async function emailDoCliente(customerId) {
  const c = await siengeJson("/customers/" + encodeURIComponent(customerId));
  return String((c && c.email) || "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_OK.test(e));
}

async function extratoPdf(customerId, titulo) {
  const j = await siengeJson("/customer-financial-statements/pdf?customerId=" + encodeURIComponent(customerId)
    + "&billReceivableId=" + encodeURIComponent(titulo) + "&includeSubJudice=true&includeRemadeInstallments=N&includeRenegotiation=N");
  const url = j && j.results && j.results[0] && (j.results[0].urlReport || j.results[0].value);
  if (!url || !/^https:\/\/[a-z0-9.-]+\.sienge\.com\.br\//i.test(url)) throw new Error("O Sienge não gerou o extrato.");
  const r = await http(url, {});
  if (r.status !== 200 || r.buffer.slice(0, 5).toString() !== "%PDF-") throw new Error("Não foi possível baixar o extrato.");
  if (r.buffer.length > 8 * 1024 * 1024) throw new Error("O extrato passa de 8 MB.");
  return r.buffer;
}

/* ---------- texto ---------- */
function agoraBrasil() {
  const p = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false })
    .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
  return { dia: p.year + "-" + p.month + "-" + p.day, hora: Number(p.hour) % 24 };
}

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function dataBr(iso) {
  const p = String(iso || "").slice(0, 10).split("-");
  return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : "";
}

function dataMais(dias) {
  const d = new Date(Date.now() + (Number(dias) || 0) * 86400000);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function money(n) {
  return "R$ " + (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CAMPOS = ["primeiro_nome", "nome", "unidade", "empreendimento", "cidade", "vencimento", "texto_abertas", "ordinal_proxima", "vencimento_proxima", "titulo"];
const TEXTO_EXTRATO = "Segue em anexo o extrato financeiro atualizado.";

function quadroHtml(parcelas) {
  const lista = (Array.isArray(parcelas) ? parcelas : []).slice(0, 60);
  if (!lista.length) return "";
  const td = "padding:6px 10px;border:1px solid #d1d5db;font-size:13px;";
  const th = td + "background:#105436;color:#ffffff;text-align:left;";
  let tSem = 0;
  let tCor = 0;
  const linhas = lista.map((p) => {
    const sem = Number(p.semJuros) || 0;
    const cor = Number(p.corrigido) || sem;
    tSem += sem;
    tCor += cor;
    return "<tr><td style=\"" + td + "\">" + esc(String(p.numero || "") + (p.tipo ? " (" + p.tipo + ")" : "")) + "</td>"
      + "<td style=\"" + td + "\">" + esc(dataBr(p.vencimento)) + "</td>"
      + "<td style=\"" + td + "text-align:right;\">" + esc(String(Math.max(0, Math.round(Number(p.dias) || 0)))) + "</td>"
      + "<td style=\"" + td + "text-align:right;\">" + esc(money(sem)) + "</td>"
      + "<td style=\"" + td + "text-align:right;\">" + esc(money(cor)) + "</td></tr>";
  }).join("");
  return "<table style=\"border-collapse:collapse;margin:8px 0;\"><thead><tr>"
    + "<th style=\"" + th + "\">Parcela</th><th style=\"" + th + "\">Vencimento</th><th style=\"" + th + "\">Dias em atraso</th>"
    + "<th style=\"" + th + "\">Valor sem juros</th><th style=\"" + th + "\">Valor corrigido</th></tr></thead><tbody>" + linhas
    + "<tr><td colspan=\"3\" style=\"" + td + "font-weight:bold;\">Total</td><td style=\"" + td + "text-align:right;font-weight:bold;\">" + esc(money(tSem))
    + "</td><td style=\"" + td + "text-align:right;font-weight:bold;\">" + esc(money(tCor)) + "</td></tr></tbody></table>";
}

function valores(ctx, hora) {
  const v = {};
  CAMPOS.forEach((k) => { v[k] = String((ctx && ctx[k]) == null || (ctx && ctx[k]) === "" ? "—" : ctx[k]).slice(0, 300); });
  v.saudacao = hora < 12 ? "Bom dia" : (hora < 18 ? "Boa tarde" : "Boa noite");
  return v;
}

function montarAssunto(texto, v) {
  let s = String(texto || "").replace(/\{\{retorno:(\d+)\}\}/g, (_, n) => dataMais(n));
  s = s.split("{{quadro_parcelas}}").join("").split("{{extrato}}").join("");
  Object.keys(v).forEach((k) => { s = s.split("{{" + k + "}}").join(v[k]); });
  return s.replace(/[\r\n]+/g, " ").trim().slice(0, 250);
}

function montarHtml(texto, v, parcelas) {
  let s = esc(String(texto || "").replace(/\{\{retorno:(\d+)\}\}/g, (_, n) => dataMais(n)));
  Object.keys(v).forEach((k) => { s = s.split("{{" + k + "}}").join(esc(v[k])); });
  s = s.split("{{extrato}}").join(esc(TEXTO_EXTRATO));
  const quadro = quadroHtml(parcelas);
  s = s.split("{{quadro_parcelas}}").join("\u0000Q\u0000");
  s = s.replace(/\r?\n/g, "<br>");
  s = s.split("\u0000Q\u0000").join(quadro);
  return "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.5;\">" + s + "</div>";
}

function idEnvio(dia, templateId, customerId, titulo) {
  return (dia + "_" + templateId + "_" + customerId + "_" + titulo).replace(/[^\w-]/g, "_").slice(0, 300);
}

/* ---------- rota ---------- */
module.exports = async function handler(req, res) {
  if (String(req.method || "").toUpperCase() !== "POST") return responder(res, 405, { error: "Use POST." });
  if (!graphMailConfigured()) return responder(res, 503, { error: "O envio de e-mail do Microsoft 365 não está configurado na Vercel." });
  if (!process.env.SIENGE_API_USER || !process.env.SIENGE_API_PASSWORD) return responder(res, 503, { error: "Credenciais do Sienge não configuradas." });

  let corpo;
  try { corpo = await lerCorpo(req); } catch (e) { return responder(res, 400, { error: e.message }); }
  const itens = Array.isArray(corpo.itens) ? corpo.itens.slice(0, MAX_ITENS) : [];
  if (!itens.length) return responder(res, 400, { error: "Nada para enviar." });

  let templates;
  try { templates = await lerTemplates(); } catch (e) { return responder(res, 502, { error: "Não consegui ler os templates no banco." }); }
  const { dia, hora } = agoraBrasil();
  const resultados = [];

  for (const it of itens) {
    const templateId = String((it && it.templateId) || "");
    const customerId = String((it && it.customerId) || "").replace(/\D/g, "");
    const titulo = String((it && it.titulo) || "").replace(/\D/g, "");
    const r = { templateId, customerId, titulo };
    try {
      if (!templateId || !customerId || !titulo) throw new Error("Dados do cliente incompletos.");
      const t = templates.find((x) => x && String(x.id) === templateId);
      if (!t || t.status !== "aprovado" || !t.ativo) throw new Error("Template não aprovado ou régua desligada.");
      const id = idEnvio(dia, templateId, customerId, titulo);
      const ja = await lerEnvio(id);
      if (ja && ja.status === "enviado") { r.status = "ja-enviado"; resultados.push(r); continue; }

      const para = t.destino === "fixo"
        ? String(t.para || "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_OK.test(e))
        : await emailDoCliente(customerId);
      if (!para.length) throw new Error("Cliente sem e-mail no Sienge.");
      const cc = String(t.cc || "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_OK.test(e));

      const v = valores(Object.assign({}, it.ctx || {}, { titulo }), hora);
      const assunto = montarAssunto(t.assunto, v);
      const html = montarHtml(t.corpo, v, it.parcelas);
      const anexos = [];
      if (/\{\{extrato\}\}/.test(String(t.corpo || "") + String(t.assunto || ""))) {
        const pdf = await extratoPdf(customerId, titulo);
        anexos.push({ name: "Extrato " + titulo + ".pdf", contentType: "application/pdf", contentBytes: pdf.toString("base64") });
      }
      await sendMail({ to: para.join(","), cc: cc.join(","), subject: assunto, html, attachments: anexos });
      r.status = "enviado";
      r.para = para.length;
      await gravarEnvio(id, {
        dia, templateId, customerId, titulo, status: "enviado", em: new Date().toISOString(),
        para: para.join(", "), cc: cc.join(", "), extrato: anexos.length > 0
      });
    } catch (e) {
      r.status = "erro";
      r.erro = String((e && e.message) || e).slice(0, 200);
      try {
        if (templateId && customerId && titulo) {
          await gravarEnvio(idEnvio(dia, templateId, customerId, titulo), {
            dia, templateId, customerId, titulo, status: "erro", em: new Date().toISOString(), erro: r.erro
          });
        }
      } catch (e2) {}
    }
    resultados.push(r);
  }
  return responder(res, 200, { dia, resultados });
};

// Para a tela montar a mesma prévia que vai no e-mail.
module.exports.montarHtml = montarHtml;
module.exports.montarAssunto = montarAssunto;
module.exports.quadroHtml = quadroHtml;
