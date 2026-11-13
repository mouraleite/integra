/* Órion (transição) › Viabilidades › Parecer Executivo — gera o texto com o Google Gemini, como o ML Órion fazia.
 * A tela manda os números já calculados (indicadores, DRE e premissas de cada cenário da família).
 * A chave fica só na Vercel (variável GEMINI_API_KEY); nunca no código nem no navegador.
 * Não grava nada: quem grava o texto na viabilidade é a própria tela. */
function enviar(res, status, dados) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(dados));
}

function lerCorpo(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((ok, erro) => {
    const partes = [];
    let tam = 0;
    req.on("data", (c) => { tam += c.length; if (tam > 2 * 1024 * 1024) { erro(new Error("Pedido grande demais.")); req.destroy(); return; } partes.push(c); });
    req.on("end", () => { const t = Buffer.concat(partes).toString("utf8"); if (!t) return ok({}); try { ok(JSON.parse(t)); } catch (e) { erro(new Error("Pedido inválido.")); } });
    req.on("error", erro);
  });
}

function montarPrompt(dados) {
  const nome = String(dados.projeto || "").slice(0, 200);
  const cens = Array.isArray(dados.cenarios) ? dados.cenarios.slice(0, 12) : [];
  let texto = "";
  cens.forEach((c, i) => {
    texto += `\n--- Cenário ${i + 1}: ${String(c.nome || "").slice(0, 200)}${c.atual ? " (cenário aberto na tela)" : ""} ---\n`;
    if (!c.indicadores) { texto += "Resumo financeiro não encontrado para esta fase/cenário.\n"; return; }
    texto += `Indicadores Financeiros da Visão Global (TIR, Payback, Margem, etc): ${JSON.stringify(c.indicadores)}\n`;
    if (Array.isArray(c.dre) && c.dre.length) texto += `DRE do cenário: ${JSON.stringify(c.dre)}\n`;
    texto += `Premissas: ${JSON.stringify({ cidade: c.cidade, status: c.status, fisico: c.fisico, datas: c.datas, impostos: c.impostos, permuta: c.permuta, funding: c.funding })}\n`;
  });
  return `Você é um diretor financeiro especialista em loteamentos urbanos (como a Moura Leite Loteamentos).
O usuário precisa de um Parecer Técnico / Resumo Executivo para abrir o Relatório de Viabilidade do projeto ${nome}.

O estudo possui múltiplos cenários (fases). Analise os dados fornecidos (os totais de obras, despesas, VGV e os indicadores financeiros como TIR, Payback) e crie um texto contendo exatamente a seguinte ordem:

1. Resumo executivo (Análise dos Números): Inicie fazendo uma análise comparativa e detalhada dos grandes números (VGV, Custo de Obras, Despesas e Margem) e avaliando a Exposição de Caixa e o Payback. Indique as principais diferenças entre os cenários.
2. Tabela de Leitura sugerida (Visão Global) comparando os totais e indicadores de cada cenário.
3. Racional de cada cenário e Riscos qualitativos.
4. Análise das Visões (Empreendedor e Parceiros): Apenas se houver dados de parceiros/terrenistas, adicione no final do parecer uma nova tabela (nos mesmos moldes da tabela Global) exibindo exclusivamente os indicadores da ótica de cada participante no negócio, seguida de uma breve análise sobre o equilíbrio da parceria.
5. Sugestões de Melhoria e Recomendação Final: Com base na análise numérica e qualitativa acima, identifique a melhor estratégia de execução e comercialização, ponderando rentabilidade, necessidade de capital e mitigação de riscos operacionais. Forneça sugestões práticas de como melhorar o cenário escolhido.

Seja extremamente profissional, use formatação Markdown (com headers h3 e tabelas se necessário).
Não escreva saudações nem encerramentos, apenas o texto do relatório.

Dados de Entrada:
${texto}
`;
}

module.exports = async function (req, res) {
  if (String(req.method || "").toUpperCase() !== "POST") return enviar(res, 405, { detail: "Use POST." });
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) return enviar(res, 400, { detail: "A chave do Gemini ainda não foi cadastrada no Integra. Peça ao administrador para criar a variável GEMINI_API_KEY nas configurações da Vercel." });
  let dados;
  try { dados = await lerCorpo(req); } catch (e) { return enviar(res, 400, { detail: e.message }); }
  const prompt = montarPrompt(dados || {});
  const base = "https://generativelanguage.googleapis.com/v1beta";
  const cab = { "Content-Type": "application/json", "x-goog-api-key": chave };
  // como no Órion: tenta primeiro os modelos "flash" (mais rápidos), depois "pro", depois os demais
  let modelos = [];
  try {
    const r = await fetch(`${base}/models?pageSize=100`, { headers: cab });
    const j = await r.json();
    if (!r.ok) return enviar(res, 400, { detail: "Erro ao listar modelos do Gemini: " + ((j.error && j.error.message) || r.status) });
    modelos = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).indexOf("generateContent") >= 0).map((m) => String(m.name || "").replace("models/", ""));
  } catch (e) { return enviar(res, 502, { detail: "Não foi possível falar com o Gemini agora. Tente de novo em instantes." }); }
  if (!modelos.length) return enviar(res, 400, { detail: "Nenhum modelo de geração de texto disponível para esta chave de API." });
  const flash = modelos.filter((m) => /flash/i.test(m)), pro = modelos.filter((m) => /pro/i.test(m) && flash.indexOf(m) < 0);
  const ordem = flash.concat(pro, modelos.filter((m) => flash.indexOf(m) < 0 && pro.indexOf(m) < 0)).slice(0, 4);
  const falhas = [];
  const inicio = Date.now();
  for (const m of ordem) {
    if (Date.now() - inicio > 45000) break; // a função da Vercel tem 60 segundos
    try {
      const r = await fetch(`${base}/models/${encodeURIComponent(m)}:generateContent`, { method: "POST", headers: cab, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }) });
      const j = await r.json();
      const txt = j && j.candidates && j.candidates[0] && j.candidates[0].content && (j.candidates[0].content.parts || []).map((p) => p.text || "").join("");
      if (r.ok && txt) return enviar(res, 200, { summary: txt, modelo: m });
      falhas.push(`[${m}: ${(j.error && j.error.message) || r.status}]`);
    } catch (e) { falhas.push(`[${m}: ${e.message}]`); }
  }
  return enviar(res, 400, { detail: "Falha ao gerar o resumo. Todos os modelos tentados falharam. Detalhes: " + falhas.join(" ") });
};
