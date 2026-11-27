/* Remessa avulsa: envio do boleto por e-mail.
   Depois que o back office gera o boleto avulso no Sienge, a tela manda aqui as parcelas escolhidas. Para cada uma:
   - busca a 2ª via no Sienge (/payment-slip-notification, a mesma do botão Boleto da Fila) e baixa o PDF;
   - pega o e-mail do cliente no cadastro do Sienge;
   - monta título e texto com a configuração da aba Configurações (config/remessa_avulsa_email), com as
     variáveis do Sienge (<nmCliente>, <dtCobranca>, <nmEmpreend>, <nuUnidade>);
   - envia pela caixa configurada (padrão recebimentos@mouraleite.com.br), com o boleto em anexo;
   - grava o envio em remessa_avulsa_envios/<título>_<parcela>. A mesma parcela não sai duas vezes, salvo "reenviar". */

const { graphMailConfigured, sendMail } = require("../../lib/graph-mail");
const { dados } = require("../../lib/dados-servidor");

/* Supabase: a configuração (config/remessa_avulsa_email) e cada envio (remessa_avulsa_envios/<título>_<parcela>)
   ficam em configuracoes, pela mesma camada da tela (DadosNucleo.lerConfig/gravarConfig, service role). */
async function lerDoc(caminho) {
  const [colecao, id] = String(caminho).split("/");
  const snap = await dados().DadosNucleo.lerConfig(id, colecao, { fresco: true });
  return snap && snap.exists() ? snap.data() : null;
}

async function gravarDoc(caminho, obj) {
  const [colecao, id] = String(caminho).split("/");
  await dados().DadosNucleo.gravarConfig(id, obj, null, colecao);
  return true;
}

const SIENGE = "https://api.sienge.com.br/mouraleite/public/api/v1";
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ITENS = 25;

const PADRAO = {
  remetente: "recebimentos@mouraleite.com.br",
  cc: "",
  assunto: "Boleto Mensal: <dtCobranca> | Moura Leite Loteamentos",
  corpo: [
    "Olá, <nmCliente>.",
    "",
    "Seu boleto referente a parcela de <dtCobranca> já está disponível em anexo.",
    "Cidade e loteamento: <nmEmpreend> | Quadra/Lote: <nuUnidade>",
    "",
    "🔑 Como acessar o boleto:",
    "1. Abra o arquivo do boleto;",
    "2. Insira a senha solicitada (seu CPF ou CNPJ completo, sem pontos e traços);",
    "3. O pagamento pode ser realizado a partir de 1 hora após o recebimento deste e-mail.",
    "⚠️ Antes de concluir o pagamento, confira se os dados do beneficiário correspondem às informações do boleto.",
    "",
    "📲 Canais de atendimento Moura Leite:",
    "Telefone/WhatsApp: 4020-2109",
    "E-mail: relacionamento@mouraleite.com.br",
    "Portal do Cliente: https://www.mouraleite.com.br/portaldocliente/",
    "",
    "✨ Indique e Ganhe:",
    "Agora que você já conquistou seu lote, que tal indicar amigos e familiares? Seus indicados compram com desconto, e você recebe R$ 500 por venda concretizada.",
    "Saiba mais em mouraleite.com.br/indique-e-ganhe",
    "",
    "Atenciosamente,",
    "",
    "Moura Leite Loteamentos"
  ].join("\n")
};

function responder(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1024 * 1024) reject(new Error("Pedido grande demais."));
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new Error("JSON inválido.")); }
    });
    req.on("error", reject);
  });
}

function siengeAuth() {
  return "Basic " + Buffer.from((process.env.SIENGE_API_USER || "") + ":" + (process.env.SIENGE_API_PASSWORD || "")).toString("base64");
}

async function siengeJson(caminho) {
  const r = await fetch(SIENGE + caminho, { headers: { Authorization: siengeAuth(), Accept: "application/json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("Sienge respondeu " + r.status + " em " + caminho.split("?")[0]);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function emailsDoCliente(customerId) {
  const c = await siengeJson("/customers/" + encodeURIComponent(customerId));
  return String((c && c.email) || "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_OK.test(e));
}

/** 2ª via do boleto no Sienge. Sem boleto gerado o Sienge não devolve o link. */
async function boletoPdf(titulo, parcela) {
  const j = await siengeJson("/payment-slip-notification?billReceivableId=" + encodeURIComponent(titulo) + "&installmentId=" + encodeURIComponent(parcela));
  const item = j && Array.isArray(j.results) && j.results[0];
  const url = item && (item.urlReport || item.url);
  if (!url) throw new Error("O boleto desta parcela ainda não foi gerado no Sienge.");
  if (!/^https:\/\//i.test(String(url))) throw new Error("Link do boleto inválido.");
  const r = await fetch(url);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!r.ok || buf.slice(0, 5).toString() !== "%PDF-") throw new Error("Não foi possível baixar o PDF do boleto.");
  if (buf.length > 8 * 1024 * 1024) throw new Error("O boleto passa de 8 MB.");
  return { buf, linha: String(item.digitableLine || item.digitableNumber || "") };
}

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function dataBr(iso) {
  const p = String(iso || "").slice(0, 10).split("-");
  return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : "";
}

/** Variáveis no formato do Sienge. O valor sai do pedido da tela (a linha do batimento). */
function aplicar(texto, it) {
  const nome = String(it.cliente || "").trim();
  const v = {
    "<nmCliente>": nome
      ? nome.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && /^(de|da|do|das|dos|e)$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ")
      : "cliente",
    "<dtCobranca>": dataBr(it.vencimento) || String(it.vencimento || ""),
    "<nmEmpreend>": String(it.empreendimento || "").trim() || "—",
    "<nuUnidade>": String(it.unidade || "").trim() || "—"
  };
  let s = String(texto || "");
  Object.keys(v).forEach((k) => { s = s.split(k).join(v[k]); });
  return s;
}

function htmlDe(corpo) {
  return "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.5;\">"
    + esc(corpo).replace(/\*\*([^*\r\n]+?)\*\*/g, "<strong>$1</strong>").replace(/\r?\n/g, "<br>") + "</div>";
}

function agoraDia() {
  const p = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
  return p.year + "-" + p.month + "-" + p.day;
}

module.exports = async function handler(req, res) {
  if (String(req.method || "").toUpperCase() !== "POST") return responder(res, 405, { error: "Use POST." });
  if (!graphMailConfigured()) return responder(res, 503, { error: "O envio de e-mail do Microsoft 365 não está configurado na Vercel." });
  if (!process.env.SIENGE_API_USER || !process.env.SIENGE_API_PASSWORD) return responder(res, 503, { error: "Credenciais do Sienge não configuradas." });

  let corpo;
  try { corpo = await lerCorpo(req); } catch (e) { return responder(res, 400, { error: e.message }); }
  const itens = Array.isArray(corpo.itens) ? corpo.itens.slice(0, MAX_ITENS) : [];
  if (!itens.length) return responder(res, 400, { error: "Nada para enviar." });
  const reenviar = corpo.reenviar === true;

  const salvo = (await lerDoc("config/remessa_avulsa_email")) || {};
  const cfg = {
    // Vazio = caixa padrão do Integra (GRAPH_MAILBOX); sem configuração gravada, recebimentos@.
    remetente: String(salvo.remetente != null ? salvo.remetente : PADRAO.remetente).trim().toLowerCase(),
    cc: String(salvo.cc || ""),
    assunto: String(salvo.assunto || PADRAO.assunto),
    corpo: String(salvo.corpo || PADRAO.corpo)
  };
  const cc = cfg.cc.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_OK.test(e));
  const dia = agoraDia();
  const por = String(req.integraEmail || "").toLowerCase();
  const resultados = [];

  for (const bruto of itens) {
    const it = {
      titulo: String((bruto && bruto.titulo) || "").replace(/\D/g, ""),
      parcela: String((bruto && bruto.parcela) || "").replace(/\D/g, ""),
      clienteId: String((bruto && bruto.clienteId) || "").replace(/\D/g, ""),
      cliente: String((bruto && bruto.cliente) || "").slice(0, 200),
      empreendimento: String((bruto && bruto.empreendimento) || "").slice(0, 200),
      unidade: String((bruto && bruto.unidade) || "").slice(0, 120),
      vencimento: String((bruto && bruto.vencimento) || "").slice(0, 10)
    };
    const r = { titulo: it.titulo, parcela: it.parcela };
    const id = it.titulo + "_" + it.parcela;
    let ja = null;
    try {
      if (!it.titulo || !it.parcela || !it.clienteId) throw new Error("Título, parcela ou cliente faltando.");
      ja = await lerDoc("remessa_avulsa_envios/" + id);
      if (ja && ja.status === "enviado" && !reenviar) {
        r.status = "ja-enviado";
        r.em = ja.em || "";
        resultados.push(r);
        continue;
      }
      const para = await emailsDoCliente(it.clienteId);
      if (!para.length) throw new Error("Cliente sem e-mail no cadastro do Sienge.");
      const boleto = await boletoPdf(it.titulo, it.parcela);
      const assunto = aplicar(cfg.assunto, it).replace(/[\r\n]+/g, " ").trim().slice(0, 250);
      const texto = aplicar(cfg.corpo, it);
      await sendMail({
        from: cfg.remetente,
        to: para.join(","),
        cc: cc.join(","),
        subject: assunto,
        html: htmlDe(texto),
        attachments: [{ name: "Boleto " + it.titulo + "-" + it.parcela + ".pdf", contentType: "application/pdf", contentBytes: boleto.buf.toString("base64") }],
        confirmarEntrega: true
      });
      r.status = "enviado";
      r.para = para.join(", ");
      await gravarDoc("remessa_avulsa_envios/" + id, {
        dia, titulo: it.titulo, parcela: it.parcela, clienteId: it.clienteId, cliente: it.cliente,
        vencimento: it.vencimento, status: "enviado", em: new Date().toISOString(), por,
        de: cfg.remetente, para: para.join(", "), cc: cc.join(", "), assunto, erro: ""
      });
    } catch (e) {
      r.status = "erro";
      r.erro = String((e && e.message) || e).slice(0, 240);
      console.warn("[remessa-avulsa-email] " + JSON.stringify({ titulo: it.titulo, parcela: it.parcela, erro: r.erro }));
      try {
        // Falha num reenvio não apaga o registro do envio que já tinha dado certo.
        if (it.titulo && it.parcela && !(ja && ja.status === "enviado")) {
          await gravarDoc("remessa_avulsa_envios/" + id, {
            dia, titulo: it.titulo, parcela: it.parcela, status: "erro", erro: r.erro, em: new Date().toISOString(), por
          });
        }
      } catch (e2) {}
    }
    resultados.push(r);
  }
  return responder(res, 200, { dia, resultados });
};

module.exports.PADRAO = PADRAO;
module.exports.aplicar = aplicar;
module.exports.htmlDe = htmlDe;
