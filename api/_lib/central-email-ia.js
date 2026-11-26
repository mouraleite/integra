/* Central de e-mail: sugestões de texto do template com IA (Claude).
   POST { modo: "tons" | "nova", tag, tagNome, diasVencido, diasRetorno, assunto, texto, tom, anteriores: [texto] }
   - "tons": 5 sugestões curtas, uma para cada tom de voz.
   - "nova": mais uma sugestão no tom escolhido, diferente das anteriores.
   O texto usa só as variáveis do template ({{primeiro_nome}} etc.); o envio troca pelos dados do contrato.
   A chave fica na Vercel (ANTHROPIC_API_KEY). Nada do cliente real é enviado: só a tag, os dias e o rascunho. */
const sdk = require("@anthropic-ai/sdk");

const Anthropic = sdk.Anthropic || sdk.default || sdk;
const MODELO = "claude-opus-5-5";

const TONS = [
  { id: "cordial", nome: "Cordial", guia: "gentil e próximo, como um lembrete amigável" },
  { id: "direto", nome: "Direto", guia: "objetivo, poucas frases, vai direto ao ponto" },
  { id: "empatico", nome: "Empático", guia: "mostra compreensão e oferece ajuda para negociar" },
  { id: "formal", nome: "Formal", guia: "institucional, linguagem de empresa, sem intimidade" },
  { id: "firme", nome: "Firme", guia: "sério, deixa claras as consequências do atraso, sem ameaçar" }
];

const VARIAVEIS = [
  ["{{saudacao}}", "Bom dia / Boa tarde"],
  ["{{primeiro_nome}}", "primeiro nome do cliente"],
  ["{{nome}}", "nome completo"],
  ["{{unidade}}", "unidade (lote)"],
  ["{{empreendimento}}", "empreendimento"],
  ["{{cidade}}", "cidade"],
  ["{{titulo}}", "número do título"],
  ["{{vencimento}}", "vencimento da parcela mais antiga em atraso"],
  ["{{texto_abertas}}", "frase com a quantidade de parcelas em aberto"],
  ["{{ordinal_proxima}}", "número da próxima parcela (ex.: 12ª)"],
  ["{{vencimento_proxima}}", "vencimento da próxima parcela"],
  ["{{quadro_parcelas}}", "quadro com as parcelas vencidas (ocupa várias linhas; use no máximo uma vez, em linha própria)"],
  ["{{extrato}}", "anexa o extrato em PDF (use só se fizer sentido citar o anexo)"],
  ["{{retorno:N}}", "data N dias depois do envio, para o cliente responder ou pagar"]
];

// O racional de cada tag da Fila de cobrança, para o texto conversar com a situação do cliente.
const RACIONAL = {
  "-3": "Cliente aceitou proposta de acordo; falta emitir e assinar o termo de confissão de dívida.",
  "-2": "Cliente tem proposta de acordo aprovada aguardando o pagamento do sinal para valer.",
  "-1": "Notificação extrajudicial (NEX) já cumprida; o cliente foi notificado formalmente do atraso.",
  "0": "Cliente fez acordo interno com a cobrança e deixou de pagar parcela do acordo (acordo quebrado).",
  "1": "Cliente comprou o lote e ainda não pagou nenhuma parcela (0% pago). Risco de distrato; o objetivo é o primeiro pagamento.",
  "2": "Cliente com pagamento de entrada pela Webro pendente; precisa quitar a entrada para seguir com o contrato.",
  "3": "Contrato sub judice (processo judicial em andamento). Texto formal e cuidadoso, sem pressão e sem tratar do processo.",
  "4": "Contrato marcado como sub judice no Integra. Texto formal e cuidadoso, sem pressão e sem tratar do processo.",
  "5": "Acordo feito no jurídico com parcela vencida (acordo judicial quebrado).",
  "6": "Acordo quebrado que já pode ser executado; última chance de regularizar antes da execução.",
  "7": "Cliente voltou recentemente do jurídico para a cobrança interna.",
  "8": "Caso em análise interna do jurídico.",
  "8.5": "Acordo judicial quebrado há mais de 30 dias; o caso volta para o jurídico se não houver regularização.",
  "8.75": "Caso já comunicado ao jurídico, aguardando a mudança para sub judice no Sienge.",
  "9": "Atraso alto: o caso será enviado ao jurídico se não houver regularização. Deixe claro que é a oportunidade de resolver antes disso.",
  "10": "Parcelas vencidas e nenhum pagamento nos últimos 30 dias.",
  "11": "Cliente pagou algo nos últimos 30 dias, mas ainda tem parcela vencida. Reconheça o pagamento recente e lembre do que falta."
};

const ESQUEMA = {
  type: "object",
  properties: {
    sugestoes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tom: { type: "string" },
          assunto: { type: "string" },
          texto: { type: "string" }
        },
        required: ["tom", "assunto", "texto"],
        additionalProperties: false
      }
    }
  },
  required: ["sugestoes"],
  additionalProperties: false
};

const SISTEMA = [
  "Você escreve e-mails de cobrança para a Moura Leite, loteadora, enviados automaticamente a clientes com parcelas em atraso.",
  "Português do Brasil, frases curtas, sem jargão jurídico, sem ameaças e sem termos que constranjam o cliente (o Código de Defesa do Consumidor proíbe expor ou ameaçar o devedor).",
  "Cada texto tem no máximo 90 palavras, em 2 a 4 parágrafos curtos. O assunto tem no máximo 60 caracteres.",
  "Use apenas as variáveis listadas, escritas exatamente como aparecem (com chaves duplas). Não invente variáveis, valores, datas, telefones, links ou nomes de pessoas.",
  "Comece com {{saudacao}}, {{primeiro_nome}}. Cite o imóvel com {{unidade}} e {{empreendimento}}. Termine convidando o cliente a responder este e-mail para regularizar ou negociar, e assine \"Equipe de Cobrança Moura Leite\".",
  "Não use markdown, listas ou emojis: é texto simples de e-mail."
].join("\n");

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
      if (total > 64 * 1024) { reject(new Error("Pedido grande demais.")); req.destroy(); return; }
      partes.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(partes).toString("utf8") || "{}")); } catch (e) { reject(new Error("JSON inválido.")); }
    });
    req.on("error", reject);
  });
}

const curto = (v, n) => String(v == null ? "" : v).slice(0, n);

function montarPedido(p) {
  const tag = String(p.tag == null ? "" : p.tag);
  const linhas = [
    "Situação do cliente (tag da fila): " + curto(p.tagNome || tag, 120),
    "O que essa tag significa: " + (RACIONAL[tag] || "Cliente com parcelas vencidas."),
    "O e-mail sai quando o atraso chega a " + Math.max(0, Number(p.diasVencido) || 0) + " dia(s).",
    "Variáveis disponíveis:",
    VARIAVEIS.map((v) => "- " + v[0] + ": " + v[1]).join("\n")
  ];
  const ret = Number(p.diasRetorno);
  if (ret > 0) linhas.push("Peça retorno até {{retorno:" + Math.round(ret) + "}} (data " + Math.round(ret) + " dias depois do envio).");
  if (p.assunto || p.texto) {
    linhas.push("Rascunho atual do usuário (pode aproveitar a ideia, sem copiar):");
    if (p.assunto) linhas.push("Assunto: " + curto(p.assunto, 200));
    if (p.texto) linhas.push(curto(p.texto, 3000));
  }
  if (p.modo === "nova") {
    const tom = TONS.find((t) => t.id === p.tom) || TONS[0];
    linhas.push("Escreva 1 sugestão no tom " + tom.nome + " (" + tom.guia + "). No campo tom, escreva \"" + tom.nome + "\".");
    const ant = (Array.isArray(p.anteriores) ? p.anteriores : []).slice(-6).map((t) => curto(t, 1500));
    if (ant.length) linhas.push("Já foram mostradas estas versões; faça uma bem diferente delas (outra abertura, outra estrutura):\n" + ant.map((t, i) => "--- versão " + (i + 1) + " ---\n" + t).join("\n"));
  } else {
    linhas.push("Escreva 5 sugestões, uma para cada tom, nesta ordem, com o nome do tom no campo tom:");
    linhas.push(TONS.map((t) => "- " + t.nome + ": " + t.guia).join("\n"));
  }
  return linhas.join("\n");
}

module.exports = async function handler(req, res) {
  const metodo = String(req.method || "").toUpperCase();
  if (metodo === "OPTIONS") return responder(res, 204, {});
  if (metodo !== "POST") return responder(res, 405, { error: "Método não permitido." });
  if (!process.env.ANTHROPIC_API_KEY) {
    return responder(res, 503, { error: "A IA ainda não está ligada: falta cadastrar a chave ANTHROPIC_API_KEY na Vercel." });
  }
  let p;
  try { p = await lerCorpo(req); } catch (e) { return responder(res, 400, { error: e.message }); }
  const client = new Anthropic();
  try {
    const resposta = await client.beta.messages.create({
      model: MODELO,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SISTEMA,
      output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
      messages: [{ role: "user", content: montarPedido(p) }]
    });
    if (resposta.stop_reason === "refusal") return responder(res, 422, { error: "A IA não gerou sugestão para este pedido. Ajuste o rascunho e tente de novo." });
    const bloco = (resposta.content || []).find((b) => b.type === "text");
    let dados = null;
    try { dados = JSON.parse(bloco ? bloco.text : ""); } catch (e) { dados = null; }
    const sugestoes = ((dados && dados.sugestoes) || []).map((s) => ({
      tom: curto(s.tom, 40),
      assunto: curto(s.assunto, 120),
      texto: curto(s.texto, 3000)
    })).filter((s) => s.texto);
    if (!sugestoes.length) return responder(res, 502, { error: "A IA não devolveu sugestões. Tente de novo." });
    return responder(res, 200, { sugestoes, tons: TONS.map((t) => ({ id: t.id, nome: t.nome })) });
  } catch (e) {
    const status = Number(e && e.status) || 0;
    console.error("[central-email-ia] " + status + " " + ((e && e.message) || e));
    if (status === 429) return responder(res, 429, { error: "Muitos pedidos à IA agora. Espere um minuto e tente de novo." });
    if (status === 401) return responder(res, 503, { error: "A chave da IA cadastrada na Vercel não foi aceita." });
    return responder(res, 502, { error: "Não consegui falar com a IA agora. Tente de novo." });
  }
};

module.exports.TONS = TONS;
module.exports.montarPedido = montarPedido;
