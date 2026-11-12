/* Órion (transição) › Carga SharePoint — regra do ML Órion (backend/app/services/carga_forecast_sharepoint.py), sem alteração:
 * lê o relatório do Sienge "2653 - Comparativo Orçamento Empresarial X Realizado Agrupado" salvo nas pastas
 * "Forecast - N+M" do SharePoint e monta o forecast de despesas e o de receitas (plano que começa com 1 = receita).
 * - Centro de custo: linha "Centro de custo" → próximo valor ("13300 - BOTUCATU - LIVIA"); o código do Sienge é o número do início.
 * - Meses: linha com "jan/2026", "fev/2026"…; na linha de baixo, a coluna "Orçado" (procurada de 2 colunas antes a 2 depois).
 * - Linhas de valor: coluna E (5ª) = "R"; coluna A = código da conta, B = nome da conta.
 * - Só entram os meses do ano do forecast; valor zero não entra. Arquivo sem meses ou sem "Orçado" é recusado (a pasta inteira é cancelada).
 * - Mês de corte = N + 1; descrição = "Forecast - N+M".
 * Funções puras: recebem as linhas da planilha (matriz) e devolvem dados; não gravam nada. */
(function (raiz) {
  const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
  const NOMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const txt = (v) => (v == null ? "" : String(v).trim());
  const dig = (v) => txt(v).replace(/\D/g, "");
  const vazio = (v) => v == null || txt(v) === "" || (typeof v === "number" && isNaN(v));

  /** "fev/2026" (ou data do Excel) → { mes, ano } */
  function mesAno(v) {
    if (v instanceof Date && !isNaN(v)) return { mes: v.getMonth() + 1, ano: v.getFullYear() };
    const s = txt(v).toLowerCase();
    if (s.indexOf("/") < 0) return null;
    const [m, a] = s.split("/");
    if (!MESES[m.trim()]) return null;
    const ano = parseInt(a, 10);
    return isNaN(ano) ? null : { mes: MESES[m.trim()], ano };
  }

  function numero(v) {
    if (typeof v === "number") return isNaN(v) ? 0 : v;
    if (vazio(v)) return 0;
    let s = txt(v);
    if (/,\d{1,2}$/.test(s) || /\.\d{3},/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return isNaN(n) ? 0 : n;
  }

  /** Lê um relatório 2653 (matriz de linhas). Devolve [{ cc_raw, cc_nome, cc_id_sienge, conta_codigo, conta_nome, mes, ano, orcado (R$) }]. */
  function lerRelatorio(linhas, nomeArquivo) {
    let ccRaw = null, ccNome = null, ccId = null;
    let meses = null; // [{ mes, ano, col }]
    const out = [];
    const L = linhas || [];
    for (let idx = 0; idx < L.length; idx++) {
      const row = L[idx] || [];
      // 1. Centro de custo
      let achou = false;
      for (let i = 0; i < row.length; i++) {
        if (txt(row[i]).toLowerCase() === "centro de custo") {
          for (let j = i + 1; j < row.length; j++) {
            if (!vazio(row[j])) {
              ccRaw = txt(row[j]);
              ccNome = ccRaw.indexOf("-") >= 0 ? ccRaw.split("-").slice(1).join("-").trim() : ccRaw;
              const m = /^(\d+)/.exec(ccRaw);
              ccId = m ? m[1] : null;
              achou = true;
              break;
            }
          }
          break;
        }
      }
      if (achou) continue;
      if (!ccRaw) continue;
      // 2. Cabeçalho de meses
      const enc = [];
      for (let i = 0; i < row.length; i++) { const ma = vazio(row[i]) ? null : mesAno(row[i]); if (ma) enc.push(Object.assign({ col: i }, ma)); }
      if (enc.length) {
        const prox = L[idx + 1] || [];
        meses = enc.map((e) => {
          let or = null;
          for (let j = Math.max(0, e.col - 2); j < e.col + 3; j++) { const v = txt(prox[j]).toLowerCase(); if (v.indexOf("orçado") >= 0 || v.indexOf("orcado") >= 0) { or = j; break; } }
          return { mes: e.mes, ano: e.ano, orcado: or };
        });
        continue;
      }
      // 3. Linhas analíticas
      if (txt(row[4]) === "R" && meses) {
        const cod = txt(row[0]), nome = txt(row[1]);
        meses.forEach((m) => {
          if (m.orcado == null) return;
          const v = numero(row[m.orcado]);
          if (v !== 0) out.push({ cc_raw: ccRaw, cc_nome: ccNome, cc_id_sienge: ccId, conta_codigo: cod, conta_nome: nome, mes: m.mes, ano: m.ano, orcado: v });
        });
      }
    }
    const nome = nomeArquivo || "arquivo";
    if (!meses) throw new Error(`Arquivo «${nome}» não tem a tabela padrão de meses e colunas «Orçado» do relatório 2653.`);
    const semOrc = meses.find((m) => m.orcado == null);
    if (semOrc) throw new Error(`Arquivo «${nome}» tem o mês ${NOMES[semOrc.mes - 1]}/${semOrc.ano}, mas não tem a subcoluna «Orçado».`);
    return out;
  }

  /** "Forecast - 8+4" (nome da pasta, em qualquer parte do caminho) → { descricao, realizados, mes_corte } */
  function pastaForecast(caminho) {
    const partes = String(caminho || "").split(/[\\/]/);
    for (let i = partes.length - 1; i >= 0; i--) {
      const p = partes[i];
      if (p.indexOf("Forecast -") < 0 && p.indexOf("Forecast-") < 0) continue;
      const m = /(\d+)\s*\+\s*(\d+)/.exec(p);
      if (!m) continue;
      const anoPasta = partes.slice(0, i).reverse().find((x) => /^\d{4}$/.test(x.trim()));
      return { pasta: p, descricao: `Forecast - ${m[1]}+${m[2]}`, realizados: Number(m[1]), mes_corte: Number(m[1]) + 1, ano_pasta: anoPasta ? Number(anoPasta) : null };
    }
    return null;
  }

  /** Separa os arquivos escolhidos por pasta "Forecast - N+M" (ignora temporários do Excel "~$"). */
  function agruparArquivos(arqs) {
    const g = new Map(), fora = [];
    (arqs || []).forEach((a) => {
      const caminho = a.caminho || a.nome || "";
      const nome = String(a.nome || caminho.split(/[\\/]/).pop());
      if (nome.indexOf("~$") === 0 || !/\.xls[xm]?$/i.test(nome)) return;
      const p = pastaForecast(caminho);
      if (!p) { fora.push(nome); return; }
      if (!g.has(p.descricao)) g.set(p.descricao, Object.assign({}, p, { arquivos: [] }));
      g.get(p.descricao).arquivos.push(a);
    });
    return { pastas: [...g.values()].sort((a, b) => a.realizados - b.realizados), fora };
  }

  /**
   * De-para: centro de custo pelo código do Sienge (o Integra usa o próprio código), senão pelo nome; plano pelo código, senão pelo nome.
   * ccs: [{ id, nome }]; planos: [{ id, nome }]; depara: { cc: { origem: destino }, plano: { origem: destino } }.
   */
  function mapear(dados, ccs, planos, depara) {
    const dp = depara || {};
    const ccPorId = new Map((ccs || []).map((c) => [dig(c.id), c]));
    const ccPorNome = new Map((ccs || []).map((c) => [txt(c.nome).toLowerCase(), c]));
    const plPorId = new Map((planos || []).map((p) => [dig(p.id), p]));
    const plPorNome = new Map();
    (planos || []).forEach((p) => { const k = txt(p.nome).toLowerCase(); if (k && !plPorNome.has(k)) plPorNome.set(k, p); });
    const pend = new Map();
    const linhas = (dados || []).map((r) => {
      const chaveCc = r.cc_id_sienge || r.cc_nome;
      let cc = null;
      const dCc = (dp.cc || {})[chaveCc];
      if (dCc) cc = ccPorId.get(dig(dCc)) || { id: dig(dCc), nome: r.cc_nome };
      else cc = (r.cc_id_sienge && ccPorId.get(dig(r.cc_id_sienge))) || ccPorNome.get(txt(r.cc_nome).toLowerCase()) || null;
      const chavePl = r.conta_nome;
      let pl = null;
      const dPl = (dp.plano || {})[chavePl];
      if (dPl) pl = plPorId.get(dig(dPl)) || { id: dig(dPl), nome: r.conta_nome };
      else pl = (dig(r.conta_codigo) && plPorId.get(dig(r.conta_codigo))) || plPorNome.get(txt(r.conta_nome).toLowerCase()) || null;
      if (!cc) pend.set("cc|" + chaveCc, { tipo: "CENTRO_CUSTO", origem: chaveCc, descricao: r.cc_raw });
      if (!pl) pend.set("pl|" + chavePl, { tipo: "PLANO_FINANCEIRO", origem: chavePl, descricao: `${r.conta_codigo} - ${r.conta_nome}` });
      return Object.assign({}, r, { cc: cc ? dig(cc.id) : "", cc_nome_integra: cc ? cc.nome : "", plano: pl ? dig(pl.id) : "", plano_nome: pl ? pl.nome : r.conta_nome });
    });
    return { linhas, pendencias: [...pend.values()].sort((a, b) => (a.tipo + a.origem).localeCompare(b.tipo + b.origem, "pt-BR", { numeric: true })) };
  }

  /** Itens do forecast (centavos), por tipo; só o ano do forecast. Mesmo formato das linhas do Integra (cc, plano, m[12], total). */
  function montarForecast(linhas, ano) {
    const tipos = { DESPESAS: new Map(), RECEITAS: new Map() };
    let foraDoAno = 0;
    (linhas || []).forEach((r) => {
      if (!r.cc || !r.plano) return;
      if (Number(r.ano) !== Number(ano)) { foraDoAno++; return; }
      const tipo = String(r.plano).charAt(0) === "1" ? "RECEITAS" : "DESPESAS";
      const k = r.cc + "|" + r.plano;
      const mp = tipos[tipo];
      if (!mp.has(k)) mp.set(k, { cc: r.cc, cc_nome: r.cc_nome_integra || r.cc_nome || "", plano: r.plano, plano_nome: r.plano_nome || "", m: new Array(12).fill(0), obs: "Importado do Sienge (SharePoint)", origem: "sharepoint" });
      mp.get(k).m[r.mes - 1] += Math.round(Number(r.orcado) * 100);
    });
    const fim = (mp) => [...mp.values()].map((l) => Object.assign(l, { total: l.m.reduce((s, v) => s + v, 0) })).filter((l) => l.total !== 0)
      .sort((a, b) => a.cc.localeCompare(b.cc, "pt-BR", { numeric: true }) || a.plano.localeCompare(b.plano, "pt-BR", { numeric: true }));
    return { DESPESAS: fim(tipos.DESPESAS), RECEITAS: fim(tipos.RECEITAS), foraDoAno };
  }

  const api = { lerRelatorio, pastaForecast, agruparArquivos, mapear, montarForecast, mesAno, numero };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  raiz.OrionSharepointCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
