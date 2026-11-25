/* Confirmações de entrega e de leitura dos e-mails da Central.
   Os e-mails saem pedindo confirmação (isDeliveryReceiptRequested / isReadReceiptRequested). As respostas chegam
   como e-mails na própria caixa de envio ("Entregue:", "Lida:", "Retransmitido:", "Não lida:", "Não é possível
   entregar:" ou em inglês). Esta rota lê a caixa de entrada de cada caixa liberada (GRAPH_MAILBOX e
   GRAPH_MAILBOXES_EXTRAS), casa cada confirmação com o envio (mesma caixa, mesmo assunto, mesmo destinatário,
   enviado antes) e grava no registro do envio. Só grava a primeira de cada tipo.
   Precisa da permissão "Application Mail.Read" no escopo das caixas (Exchange, RBAC para aplicativos).
   POST { dias } (padrão 30, máximo 60). Rota com login (está em ROTAS_COM_LOGIN do gateway). */
const { graphMailConfigured, caixasPermitidas, listarMensagens } = require("../../lib/graph-mail");
const { gravarCampos, enviosDoPeriodo } = require("./central-email-enviar");

const TIPOS = [
  { tipo: "leitura", re: /^\s*(lida|lido|read)\s*:\s*/i },
  { tipo: "nao_lida", re: /^\s*(n[ãa]o lida|n[ãa]o lido|not read)\s*:\s*/i },
  { tipo: "entregue", re: /^\s*(entregue|delivered)\s*:\s*/i },
  { tipo: "retransmitido", re: /^\s*(retransmitid[oa]|relayed)\s*:\s*/i },
  { tipo: "nao_entregue", re: /^\s*(n[ãa]o [ée] poss[íi]vel entregar|undeliverable|falha na entrega|mensagem n[ãa]o entregue|n[ãa]o entregue)\s*:\s*/i }
];

function responder(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function norm(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function diaIso(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function classificar(assunto) {
  for (const t of TIPOS) {
    if (t.re.test(assunto)) return { tipo: t.tipo, original: String(assunto).replace(t.re, "") };
  }
  return null;
}

// "em" pode vir em ISO (Firestore) ou em milissegundos (Supabase, mapa "ms").
function ms(v) {
  return typeof v === "number" ? v : Date.parse(v) || 0;
}

// Campo que cada tipo de confirmação grava (só a primeira de cada tipo).
const CAMPO = { leitura: "leituraConfirmadaEm", nao_lida: "naoLidaEm", entregue: "entregaEm", retransmitido: "entregaEm", nao_entregue: "naoEntregueEm" };

function emails(texto) {
  return String(texto || "").toLowerCase().split(/[\s,;]+/).filter((e) => e.indexOf("@") > 0);
}

module.exports = async function handler(req, res) {
  if (String(req.method || "").toUpperCase() !== "POST") return responder(res, 405, { error: "Use POST." });
  if (!graphMailConfigured()) return responder(res, 503, { error: "O e-mail do Microsoft 365 não está configurado na Vercel." });
  let dias = 30;
  try {
    const partes = [];
    for await (const c of req) partes.push(c);
    const corpo = JSON.parse(Buffer.concat(partes).toString("utf8") || "{}");
    if (Number(corpo.dias) > 0) dias = Math.min(60, Math.round(Number(corpo.dias)));
  } catch (e) {}

  const agora = new Date();
  const inicio = new Date(agora.getTime() - dias * 86400000);
  let envios;
  try {
    envios = (await enviosDoPeriodo(diaIso(inicio), diaIso(agora), 5000)).filter((x) => x.status === "enviado" && x.assunto);
  } catch (e) {
    return responder(res, 502, { error: String((e && e.message) || e) });
  }

  const resumo = { leitura: 0, nao_lida: 0, entregue: 0, retransmitido: 0, nao_entregue: 0, semPar: 0 };
  const erros = [];
  for (const caixa of caixasPermitidas()) {
    let msgs = [];
    try {
      msgs = await listarMensagens(caixa, inicio.toISOString(), 1500);
    } catch (e) {
      erros.push(String((e && e.message) || e).slice(0, 240));
      continue;
    }
    const daCaixa = envios.filter((x) => String(x.caixa || "").toLowerCase() === caixa);
    // Da mais antiga para a mais nova: com e-mails iguais (mesmo assunto e destinatário), cada confirmação vai para um
    // envio que ainda não tem aquele tipo, em vez de cair sempre no mesmo e ser descartada.
    msgs.sort((a, b) => ms(a && a.receivedDateTime) - ms(b && b.receivedDateTime));
    for (const m of msgs) {
      const c = classificar(m && m.subject);
      if (!c) continue;
      const recebida = String(m.receivedDateTime || "");
      const remetente = String((m.from && m.from.emailAddress && m.from.emailAddress.address) || "").toLowerCase();
      const corpo = String(m.bodyPreview || "").toLowerCase();
      let candidatos = daCaixa.filter((x) => norm(x.assunto) === norm(c.original) && ms(x.em) <= ms(recebida));
      if (c.tipo === "leitura" || c.tipo === "nao_lida") {
        const comLeitor = candidatos.filter((x) => emails(x.para + "," + (x.cc || "")).indexOf(remetente) >= 0);
        if (comLeitor.length) candidatos = comLeitor;
      } else {
        const noCorpo = candidatos.filter((x) => emails(x.para).some((e) => corpo.indexOf(e) >= 0));
        if (noCorpo.length) candidatos = noCorpo;
      }
      if (!candidatos.length) { resumo.semPar++; continue; }
      const livres = candidatos.filter((x) => !x[CAMPO[c.tipo]]);
      if (livres.length) candidatos = livres;
      candidatos.sort((a, b) => ms(b.em) - ms(a.em));
      const alvo = candidatos[0];
      const campos = {};
      if (c.tipo === "leitura" && !alvo.leituraConfirmadaEm) campos.leituraConfirmadaEm = recebida;
      if (c.tipo === "nao_lida" && !alvo.naoLidaEm) campos.naoLidaEm = recebida;
      if ((c.tipo === "entregue" || c.tipo === "retransmitido") && !alvo.entregaEm) {
        campos.entregaEm = recebida;
        campos.entregaTipo = c.tipo;
      }
      if (c.tipo === "nao_entregue" && !alvo.naoEntregueEm) {
        campos.naoEntregueEm = recebida;
        campos.naoEntregueMotivo = String(m.bodyPreview || "").replace(/[\w.+-]+@[\w.-]+/g, "<e-mail>").replace(/\s+/g, " ").slice(0, 300);
      }
      if (!Object.keys(campos).length) continue;
      await gravarCampos("central_email_envios/" + alvo.id, campos);
      Object.assign(alvo, campos);
      resumo[c.tipo]++;
    }
  }
  return responder(res, 200, { ok: !erros.length, dias, resumo, erros });
};
