/* Órion (transição) › Acompanhamento de empreendimentos — cálculo do ML Órion (backend/app/api/routes/tracking.py), sem alteração:
 * _calc_actuals_for_cc (realizado + a realizar por centro de custo: DRE, fluxo de caixa por ano, velocidade de vendas,
 * planos contratados, projeção do estoque com tributos do Lucro Presumido), _calculate_financial_indicators
 * (TIR, MTIR, exposição, payback, vida), _kpis_do_consolidado (lista) e a soma do detalhe (vários centros da mesma obra).
 * Funções puras: recebem os dados já lidos do Sienge/Integra e devolvem os números. Valores em reais (como o Órion).
 *
 * Entrada de calcularCentro(o):
 *  vendas:   [{ mes "AAAA-MM", valor, categoria "VGV Vendido"|"Distrato", parcelas, area }]
 *  real:     [{ tipo "INCOME"|"OUTCOME", categoria (nome do plano), grupo (grupo da visão DFC, MAIÚSCULO), mes "AAAA-MM", valor }]
 *  previsto: idem (contas a pagar e a receber em aberto, inclusive vencidas)
 *  unidades: { total, estoque: [{ area }] }   (estoque = situação D, R, C, P, G)
 *  aliquotas: { pis, cofins, irpj, csll, outros } do regime "Lucro Presumido" (opcional)
 *  terrenoManual: { valor, curva: [% por mês], inicio "AAAA-MM" } (custo de terreno informado na obra, opcional)
 *  tmaAnual (decimal; padrão 0,12), hoje "AAAA-MM" (mês corrente), regras (parceria) / multApportioned / multDefault, kpisOnly
 *  rateada(linha) / vendasRateadas: no Integra, a regra da parceria vem da Parametrização de Parceiro (conta a conta), no lugar das regras por grupo do Órion */
(function (raiz) {
  const V = raiz.OrionViabilidadeCalc || (typeof require === "function" ? require("./orion-viabilidade-calc.js") : null);
  const TMA_PADRAO = 0.12;
  const RECEITA_MINIMA_RENTABILIDADE = 10000;
  const CATEGORIAS_EXCLUIDAS_RECEITA = new Set(["afac"]);
  const ESTOQUE = ["D", "R", "C", "P", "G"];

  const novoAno = () => ({ Entradas: 0, Tributos: 0, Terreno: 0, Obras: 0, Projetos: 0, Marketing: 0, Comercial: 0, Administrativas: 0, Saidas: 0, Devolucao_Distratos: 0 });
  const mapa = (fab) => { const m = new Map(); return { get: (k) => { if (!m.has(k)) m.set(k, fab()); return m.get(k); }, has: (k) => m.has(k), keys: () => [...m.keys()], m }; };
  const somaMes = () => { const o = {}; return { add: (k, v) => { o[k] = (o[k] || 0) + v; }, o }; };
  const proxMes = (a, m) => (m === 12 ? [a + 1, 1] : [a, m + 1]);
  /** round(x, n) do Python (empate exato vai para o par). */
  const pyR = (x, n) => { const k = Math.pow(10, n), r = x * k; if (Number.isInteger(r * 2) && !Number.isInteger(r)) { const f = Math.floor(r); return (f % 2 === 0 ? f : f + 1) / k; } return Math.round(r) / k; };
  const chave = (a, m) => `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}`;

  /** Série mensal contínua do primeiro ao último mês (meses vazios = 0), como o Órion monta o cf_array. */
  function serieMensal(dic) {
    const ms = Object.keys(dic).filter((k) => /^\d{4}-\d{2}$/.test(k) && Number(k.slice(5)) >= 1 && Number(k.slice(5)) <= 12).sort();
    if (!ms.length) return [];
    let [a, m] = ms[0].split("-").map(Number);
    const [af, mf] = ms[ms.length - 1].split("-").map(Number);
    const out = [];
    while (a < af || (a === af && m <= mf)) { out.push(dic[chave(a, m)] || 0); [a, m] = proxMes(a, m); }
    return out;
  }

  /** TIR mensal por Newton (Órion: _irr_mensal_newton, usado na lista). */
  function irrNewton(cf) {
    if (!cf.some((c) => c > 0) || !cf.some((c) => c < 0)) return null;
    const nd = (r) => {
      if (r <= -0.999999) return null;
      let npv = 0, d = 0, b = 1;
      const um = 1 + r;
      for (let t = 0; t < cf.length; t++) {
        if (t === 0) { npv += cf[t]; continue; }
        b *= um;
        if (b === 0) return null;
        npv += cf[t] / b;
        d -= (t * cf[t]) / (b * um);
      }
      return [npv, d];
    };
    for (const g of [0.01, 0.05, 0.1, -0.01, 0.2, -0.05]) {
      let r = g;
      for (let i = 0; i < 80; i++) {
        const x = nd(r);
        if (!x) break;
        if (Math.abs(x[1]) < 1e-18) break;
        const passo = x[0] / x[1];
        r -= passo;
        if (r <= -0.999999 || r > 10) break;
        if (Math.abs(passo) < 1e-8 && r > -1) return r;
      }
    }
    return null;
  }

  /** Órion: _calculate_financial_indicators. metodo "numpy" (detalhe) ou "newton" (lista). */
  function indicadores(cfDict, tmaAnual, metodo) {
    const cf = serieMensal(cfDict || {});
    const out = { tir_anual: null, tir_mensal: null, mtir_anual: null, mtir_mensal: null, payback: null, exposicao_maxima: 0, periodo_exposicao: 0, vida: cf.length };
    if (!cf.length) return out;
    const tm = metodo === "newton" ? irrNewton(cf) : V.irr(cf);
    if (tm != null && !isNaN(tm) && tm > -1) { out.tir_mensal = tm * 100; out.tir_anual = (Math.pow(1 + tm, 12) - 1) * 100; }
    const tma = tmaAnual || TMA_PADRAO, tmaM = Math.pow(1 + tma, 1 / 12) - 1;
    const mt = V.mirr(cf, tmaM, tmaM);
    if (mt && !isNaN(mt)) { out.mtir_mensal = mt * 100; out.mtir_anual = (Math.pow(1 + mt, 12) - 1) * 100; }
    let acum = 0;
    const ac = cf.map((v) => { acum += v; if (acum < out.exposicao_maxima) out.exposicao_maxima = acum; return acum; });
    const idx = ac.indexOf(out.exposicao_maxima);
    out.periodo_exposicao = idx >= 0 ? idx + 1 : 0;
    for (let i = Math.max(0, out.periodo_exposicao - 1); i < ac.length; i++) if (ac[i] >= 0) { out.payback = i + 1; break; }
    return out;
  }

  /* Grupos da visão DFC: no Integra o nome vem com o código e sem acento ("04.05 AQUISICAO DE NOVAS AREAS");
   * o Órion usa a descrição do Sienge ("AQUISIÇÃO DE NOVAS ÁREAS"). Pelo código, volta para o nome do Órion. */
  const GRUPO_ORION = { "01": "RECEITAS", "01.01": "VENDA DE IMÓVEIS", "01.02": "RECEITA DE SERVIÇOS", "01.03": "RECEITAS NÃO OPERACIONAIS", "01.04": "CANCELAMENTOS DE VENDAS",
    "02": "IMPOSTOS", "02.01": "IMPOSTOS SOBRE VENDAS", "02.02": "IMPOSTOS TRIMESTRAIS", "04": "CUSTOS", "04.01": "REPASSES TERRENISTAS", "04.02": "PROJETOS E APROVAÇÕES", "04.03": "OBRAS",
    "04.04": "CUSTO ADM DE EMPREENDIMENTOS", "04.05": "AQUISIÇÃO DE NOVAS ÁREAS", "05": "DESPESAS", "05.01": "DESPESAS COMERCIAIS", "05.02": "MARKETING", "05.03": "ADMINISTRATIVAS", "05.04": "PESSOAL",
    "05.05": "DESPESAS COM ESTOQUE", "05.06": "DESPESAS NAO OPERACIONAIS", "05.07": "DONATIVOS E CONTRIBUIÇÕES", "05.08": "ADIANTAMENTO A FORNECEDORES", "05.09": "RETENÇÕES", "05.10": "OUTROS MOVIMENTOS",
    "05.11": "DESPESAS COM MANUTENÇÃO DE EMPREENDIMENTO", "07": "CAPEX", "09": "RESULTADO FINANCEIRO", "09.01": "RECEITAS FINANCEIRAS", "09.02": "DESPESAS FINANCEIRAS", "09.03": "FUNDO DE INVESTIMENTO",
    "09.05": "AMORTIZAÇÕES", "11": "DIVIDENDOS E APORTES", "11.01": "(-) DIVIDENDOS", "11.02": "(+) DIVIDENDOS", "11.03": "APORTES" };
  function codigoGrupo(nome) { const m = /^\s*(\d{2}(?:\.\d{2})*)\s+/.exec(String(nome || "")); return m ? m[1] : ""; }
  function grupoOrion(nome) {
    const c = codigoGrupo(nome);
    if (c && GRUPO_ORION[c]) return GRUPO_ORION[c];
    return String(nome || "").replace(/^\s*\d{2}(?:\.\d{2})*\s+/, "").trim().toUpperCase();
  }

  /** Classificação das saídas (contas a pagar) nos grupos da DRE e do fluxo — mesma ordem de testes do Órion. */
  function classificarSaida(grupoRaw, catRaw) {
    const grupo = String(grupoRaw || "").toUpperCase(), cat = String(catRaw || "").toLowerCase().trim();
    const tem = (lista) => lista.some((k) => cat.indexOf(k) >= 0);
    if (["IMPOSTOS SOBRE VENDAS", "RETENÇÕES", "IMPOSTOS"].indexOf(grupo) >= 0) return ["impostos", "Tributos"];
    if (["AQUISIÇÃO DE NOVAS ÁREAS", "REPASSES TERRENISTAS"].indexOf(grupo) >= 0) return ["terreno", "Terreno"];
    if (["PROJETOS E APROVAÇOES", "PROJETOS E APROVAÇÕES"].indexOf(grupo) >= 0) return ["projetos", "Projetos"];
    if (grupo === "MARKETING") return ["marketing", "Marketing"];
    if (grupo === "DESPESAS COMERCIAIS") return ["comercial", "Comercial"];
    if (["OBRAS", "DESPESAS COM MANUTENÇÃO DE EMPREENDIMENTO"].indexOf(grupo) >= 0) return ["obras", "Obras"];
    if (grupo === "ADMINISTRAÇÃO DA OBRA") return ["adm_obra", "Obras"];
    if (grupo === "CUSTOS EXTRAS DE OBRAS") return ["custo_extra_obra", "Obras"];
    if (["ADMINISTRATIVAS", "PESSOAL", "DESPESAS COM ESTOQUE", "ADIANTAMENTO A FORNECEDORES"].indexOf(grupo) >= 0) return ["administrativas", "Administrativas"];
    if (["DESPESAS NAO OPERACIONAIS", "DESPESAS EXTRAS"].indexOf(grupo) >= 0) return ["despesas_extras", "Administrativas"];
    if (["FUNDING", "JUROS", "EMPRESTIMOS", "ESTRUTURAÇÃO"].indexOf(grupo) >= 0) return ["funding", "Administrativas"];
    if (grupo.indexOf("IMPOSTOS") >= 0 || grupo.indexOf("RETEN") >= 0 || tem(["imposto", "tributo", "irpj", "csll", "pis", "cofins", "iss", "inss", "fgts", "recolh"])) return ["impostos", "Tributos"];
    if (grupo.indexOf("TERRENO") >= 0 || cat.indexOf("terreno") >= 0) return ["terreno", "Terreno"];
    if (grupo.indexOf("PROJETOS") >= 0 || tem(["projeto", "aprova"])) return ["projetos", "Projetos"];
    if (grupo.indexOf("MARKETING") >= 0 || tem(["agência", "mídia", "ooh", "panflet", "decora", "evento", "maquete"])) return ["marketing", "Marketing"];
    if (grupo.indexOf("COMERCIAIS") >= 0 || grupo.indexOf("VENDAS") >= 0 || tem(["comercial", "venda", "comiss", "stand", "corretagem"])) return ["comercial", "Comercial"];
    if (grupo.indexOf("ADMINISTRATIVA") >= 0 || grupo.indexOf("PESSOAL") >= 0 || tem(["cobrança", "jurídica", "viagem", "refeição", "cartório"])) return ["administrativas", "Administrativas"];
    if (grupo.indexOf("OBRA") >= 0 || grupo.indexOf("CUSTO") >= 0 || grupo.indexOf("REPASSES") >= 0 || tem(["construç", " obra", "obras", "(obra)", "material", "equipament"])) return ["obras", "Obras"];
    return ["administrativas", "Administrativas"];
  }

  /** Regra da parceria (Órion: rules por grupo) para uma linha: true = a linha é rateada pelo % da parceria. */
  function linhaRateada(regras, tipo, cat, grupoRaw) {
    const g = String(grupoRaw || "").toLowerCase();
    if (g.indexOf("receita") >= 0 || tipo === "INCOME" || cat.indexOf("venda") >= 0) return !!regras.receitas;
    if (g.indexOf("imposto") >= 0 || g.indexOf("reten") >= 0 || cat.indexOf("tributo") >= 0) return !!regras.impostos;
    if (g.indexOf("terreno") >= 0 || cat.indexOf("terreno") >= 0) return !!regras.terreno;
    if (g.indexOf("obra") >= 0 || g.indexOf("custo") >= 0) return !!regras.obras;
    if (g.indexOf("projeto") >= 0) return !!regras.projetos;
    if (g.indexOf("marketing") >= 0) return !!regras.marketing;
    if (g.indexOf("comercial") >= 0 || cat.indexOf("corretagem") >= 0 || cat.indexOf("comiss") >= 0) return !!regras.comerciais;
    if (g.indexOf("distrato") >= 0 || g.indexOf("cancelamento") >= 0 || cat.indexOf("distrat") >= 0) return !!regras.distratos;
    return !!regras.administrativas;
  }

  /** Recebimentos projetados do estoque (Órion: _projetar_vgv_estoque_no_fluxo). */
  function projetarEstoque(estoque, mediaVendas, vgvUnidade, pesos, mesIni, anoIni) {
    if (!(estoque > 0 && mediaVendas > 0)) return {};
    const serie = [];
    let resta = estoque;
    while (resta > 1e-9 && serie.length < 600) { const v = Math.min(mediaVendas, resta); resta -= v; serie.push(v * vgvUnidade); }
    const insts = Object.entries(pesos).map(([k, w]) => [parseInt(k, 10), Number(w)]).filter(([i, w]) => i > 0 && w);
    if (!serie.length || !insts.length) return {};
    const maxI = Math.max(...insts.map(([i]) => i));
    const diff = new Array(serie.length + maxI + 1).fill(0);
    insts.forEach(([i, w]) => serie.forEach((vgv, s) => { const p = (vgv * w) / i; if (p > 0) { diff[s] += p; diff[s + i] -= p; } }));
    const rec = {};
    let run = 0;
    diff.forEach((d, idx) => {
      run += d;
      if (Math.abs(run) < 1e-6) { run = 0; return; }
      const a = anoIni + Math.floor((mesIni - 1 + idx) / 12), m = ((mesIni - 1 + idx) % 12) + 1;
      const k = chave(a, m);
      rec[k] = (rec[k] || 0) + run;
    });
    return rec;
  }

  /** Tributos do Lucro Presumido sobre os recebimentos do estoque, no mês da DARF (Órion: tracking_impostos.py). */
  function tributosPresumido(recebimentos, aliq) {
    if (!aliq) return {};
    const pc = ((Number(aliq.pis) || 0) + (Number(aliq.cofins) || 0) + (Number(aliq.outros) || 0)) / 100;
    const ic = ((Number(aliq.irpj) || 0) + (Number(aliq.csll) || 0)) / 100;
    if (pc <= 0 && ic <= 0) return {};
    const s = {};
    Object.entries(recebimentos || {}).forEach(([k, v]) => {
      const r = Number(v) || 0;
      if (r <= 0 || !/^\d{4}-\d{2}$/.test(k)) return;
      const [a, m] = k.split("-").map(Number);
      if (pc > 0) { const [a2, m2] = proxMes(a, m); s[chave(a2, m2)] = (s[chave(a2, m2)] || 0) + r * pc; }
      if (ic > 0) { const [a3, m3] = m <= 3 ? [a, 4] : m <= 6 ? [a, 7] : m <= 9 ? [a, 10] : [a + 1, 1]; s[chave(a3, m3)] = (s[chave(a3, m3)] || 0) + r * ic; }
    });
    Object.keys(s).forEach((k) => { if (Math.abs(s[k]) <= 1e-9) delete s[k]; });
    return s;
  }

  const ALVOS_PLANOS = ["Até 6X", "Até 12x", "Até 24x", "Até 36x", "Até 48x", "Até 60x", "Até 120x", "Até 156x", "Até 180x"];
  const CURTOS = new Set(["Até 6X", "Até 12x", "Até 24x", "Até 36x", "Até 48x"]);
  function faixaParcelas(n) { return n <= 6 ? "Até 6X" : n <= 12 ? "Até 12x" : n <= 24 ? "Até 24x" : n <= 36 ? "Até 36x" : n <= 48 ? "Até 48x" : n <= 60 ? "Até 60x" : n <= 120 ? "Até 120x" : n <= 156 ? "Até 156x" : "Até 180x"; }
  function planosDasVendas(bins) {
    const tot = ALVOS_PLANOS.reduce((s, k) => s + (bins[k] || 0), 0);
    let c = 0, l = 0;
    const distribuicao = ALVOS_PLANOS.map((k) => { const v = bins[k] || 0, p = tot > 0 ? (v / tot) * 100 : 0; if (CURTOS.has(k)) { c += v; return { name: k, curto: pyR(p, 1), longo: 0 }; } l += v; return { name: k, curto: 0, longo: pyR(p, 1) }; });
    return { curto_longo: [{ name: "Plano Curto", value: pyR(tot > 0 ? (c / tot) * 100 : 0, 1) }, { name: "Plano Longo", value: pyR(tot > 0 ? (l / tot) * 100 : 0, 1) }], distribuicao, bins };
  }

  /** Órion: _calc_actuals_for_cc. */
  function calcularCentro(o) {
    const regras = o.regras || null, mA = o.multApportioned == null ? 1 : o.multApportioned, mD = o.multDefault == null ? 1 : o.multDefault;
    const temRegraReceita = o.vendasRateadas != null ? !!o.vendasRateadas : !!(regras && Object.keys(regras).some((k) => regras[k] && /receita|venda|entrada|recebimento/i.test(k)));
    const anualReal = mapa(novoAno), anualFc = mapa(novoAno);
    const cfReal = somaMes(), cfFc = somaMes(), revReal = somaMes(), revFc = somaMes();
    const t = { vgv_vendido: 0, distratos: 0, impostos: 0, recebimentos: 0, terreno: 0, projetos: 0, obras: 0, adm_obra: 0, custo_extra_obra: 0, marketing: 0, comercial: 0, administrativas: 0, despesas_extras: 0, funding: 0 };
    const vendasMes = {}, distratosMes = {};
    (o.vendas || []).forEach((v) => {
      const mes = v.mes || "N/A";
      let val = Number(v.valor) || 0;
      if (regras) val *= temRegraReceita ? mA : mD;
      if (v.categoria === "VGV Vendido") { t.vgv_vendido += val; (vendasMes[mes] = vendasMes[mes] || []).push(v); }
      else if (v.categoria === "Distrato") { t.distratos += Math.abs(val); if (mes !== "N/A") (distratosMes[mes] = distratosMes[mes] || []).push(v); }
    });
    const linha = (r, anual, cf, rev) => {
      if (r.tipo === "INCOME" && CATEGORIAS_EXCLUIDAS_RECEITA.has(String(r.categoria || "").trim().toLowerCase())) return;
      const mes = r.mes || "N/A", ano = mes !== "N/A" ? mes.slice(0, 4) : "N/A";
      const cat = String(r.categoria || "").toLowerCase().trim();
      let val = Math.abs(Number(r.valor) || 0);
      if (String(r.categoria || "").trim().indexOf("(-)") === 0) val = -val;
      if (regras) val *= (typeof o.rateada === "function" ? o.rateada(r) : linhaRateada(regras, r.tipo, cat, r.grupo)) ? mA : mD;
      if (r.tipo === "INCOME") {
        t.recebimentos += val;
        if (ano !== "N/A") anual.get(ano).Entradas += val;
        if (mes !== "N/A") { cf.add(mes, val); rev.add(mes, val); }
        return;
      }
      const g = String(r.grupo || "").toUpperCase();
      if (g.indexOf("DISTRATO") >= 0 || g.indexOf("CANCELAMENTO") >= 0 || cat.indexOf("distrat") >= 0) {
        if (ano !== "N/A") anual.get(ano).Devolucao_Distratos += val;
        if (mes !== "N/A") cf.add(mes, -val);
        return;
      }
      if (ano !== "N/A") anual.get(ano).Saidas += val;
      if (mes !== "N/A") cf.add(mes, -val);
      const [campo, col] = classificarSaida(g, cat);
      t[campo] += val;
      if (ano !== "N/A") anual.get(ano)[col] += val;
    };
    (o.real || []).forEach((r) => linha(r, anualReal, cfReal, revReal));
    (o.previsto || []).forEach((r) => linha(r, anualFc, cfFc, revFc));

    // preço médio (R$/m²) das vendas dos 6 meses mais recentes; VGV do estoque
    const mesesVenda = Object.keys(vendasMes).sort().reverse();
    let vSoma = 0, aSoma = 0;
    mesesVenda.slice(0, 6).forEach((m) => vendasMes[m].forEach((s) => { if (Number(s.area) > 0) { vSoma += Number(s.valor) || 0; aSoma += Number(s.area); } }));
    const precoMedio = aSoma > 0 ? vSoma / aSoma : 0;
    const est = (o.unidades && o.unidades.estoque) || [];
    const areaDisp = est.reduce((s, u) => s + (Number(u.area) || 0), 0);
    const vgvEstoque = areaDisp * precoMedio;
    const nEst = est.length;
    // terreno informado na obra (Órion: cost_center.manual_land_cost) — 1ª parte: entra no realizado, no primeiro mês do caixa
    const tm = o.terrenoManual || null, tmValor = tm ? Number(tm.valor) || 0 : 0;
    if (tmValor > 0) {
      const mlc = tmValor * mA;
      const ms = Object.keys(cfReal.o).filter((k) => k !== "N/A").sort();
      const pm = ms.length ? ms[0] : String(o.hoje || "");
      cfReal.add(pm, -mlc);
      const l = anualReal.get(pm.slice(0, 4)); l.Saidas += mlc; l.Terreno += mlc;
      t.terreno += mlc;
    }
    if (!o.kpisOnly && nEst > 0) {
      const ativos = Object.keys(vendasMes).filter((m) => m !== "N/A" && vendasMes[m].length).sort().reverse().slice(0, 6);
      if (ativos.length) {
        let n = 0, vgv6 = 0;
        const pesos = {};
        ativos.forEach((m) => vendasMes[m].forEach((s) => { n++; const vv = Math.abs(Number(s.valor) || 0); vgv6 += vv; let i = Number(s.parcelas) || 1; if (i <= 0) i = 1; pesos[i] = (pesos[i] || 0) + vv; }));
        const media = n / ativos.length;
        if (vgv6 > 0) Object.keys(pesos).forEach((k) => { pesos[k] /= vgv6; }); else pesos[1] = 1;
        if (media > 0) {
          const [ah, mh] = String(o.hoje || "").split("-").map(Number);
          const [ap, mp] = proxMes(ah, mh);
          const rec = projetarEstoque(nEst, media, vgvEstoque / nEst, pesos, mp, ap);
          Object.entries(rec).forEach(([k, v]) => { anualFc.get(k.slice(0, 4)).Entradas += v; cfFc.add(k, v); });
          const trib = tributosPresumido(rec, o.aliquotas);
          Object.entries(trib).forEach(([k, v]) => { if (v <= 0) return; t.impostos += v; cfFc.add(k, -v); const l = anualFc.get(k.slice(0, 4)); l.Tributos += v; l.Saidas += v; });
        }
      }
    }

    // terreno informado na obra — 2ª parte (como no Órion): soma de novo no custo e, no detalhe, entra no previsto pela curva de pagamento
    if (tmValor) {
      t.terreno += tmValor;
      if (!o.kpisOnly) {
        const ini = /^\d{4}-\d{2}$/.test(String(tm.inicio || "")) ? tm.inicio : String(o.hoje || "");
        let [ay, am] = ini.split("-").map(Number);
        const curva = Array.isArray(tm.curva) && tm.curva.length ? tm.curva.map(Number) : null;
        if (curva) curva.forEach((p) => { const v = (p / 100) * tmValor; if (v > 0) { anualFc.get(String(ay)).Terreno += v; cfFc.add(chave(ay, am), -v); } [ay, am] = proxMes(ay, am); });
        else { anualFc.get(String(ay)).Terreno += tmValor; cfFc.add(chave(ay, am), -tmValor); }
      }
    }

    // fluxo por ano (realizado + previsto quando há os dois)
    const anosR = new Set(anualReal.keys().filter((k) => k !== "N/A")), anosF = new Set(anualFc.keys().filter((k) => k !== "N/A"));
    const fluxo_caixa = [...new Set([...anosR, ...anosF])].sort().map((ano) => {
      let d, prev = !anosR.has(ano);
      if (anosR.has(ano) && anosF.has(ano)) { const r = anualReal.get(ano), f = anualFc.get(ano); d = {}; Object.keys(novoAno()).forEach((k) => { d[k] = r[k] + f[k]; }); prev = false; }
      else d = prev ? anualFc.get(ano) : anualReal.get(ano);
      return { Ano: ano, Entradas: d.Entradas, Tributos: d.Tributos, Terreno: d.Terreno, Obras: d.Obras, Projetos: d.Projetos, Marketing: d.Marketing, Comercial: d.Comercial, Administrativas: d.Administrativas,
        Total_Saidas: d.Saidas + (d.Devolucao_Distratos || 0) + (d.Terreno || 0), Devolucao_Distratos: d.Devolucao_Distratos || 0, is_forecast: prev };
    });

    const lucroOperacional = t.recebimentos - t.impostos - t.terreno - t.projetos - t.obras - t.adm_obra - t.custo_extra_obra - t.marketing - t.comercial - t.administrativas - t.despesas_extras - t.funding;
    const vgvLiq = fluxo_caixa.reduce((s, x) => s + x.Entradas, 0);
    const recLiq = vgvLiq - t.impostos;
    const custo = t.terreno + t.projetos + t.obras + t.adm_obra + t.custo_extra_obra;
    const mb = recLiq - custo;
    const despOp = t.marketing + t.comercial + t.administrativas + t.despesas_extras + t.funding;
    const llo = mb - despOp;
    const pc = (v) => (recLiq > 0 ? ((v / recLiq) * 100).toFixed(2) + "%" : "0.00%");
    const dre = [
      { item: "RECEITA BRUTA", valor: vgvLiq, bold: true }, { item: "REDUTOR DE RECEITA (Impostos)", valor: -t.impostos },
      { item: "RECEITA LÍQUIDA", valor: recLiq, bold: true }, { item: "CUSTO", valor: -custo, bold: true },
      { item: "Aquisição Área / Permuta Financeira", valor: -t.terreno, indent: true }, { item: "Projetos", valor: -t.projetos, indent: true },
      { item: "Obras de Infraestrutura", valor: -t.obras, indent: true }, { item: "Administração da Obra", valor: -t.adm_obra, indent: true },
      { item: "Custos Extras de Obras", valor: -t.custo_extra_obra, indent: true }, { item: "MARGEM BRUTA", valor: mb, bold: true },
      { item: "Margem Bruta %", valor: pc(mb), is_percentage: true, bold: true }, { item: "DV&A (Despesas Operacionais)", valor: -despOp, bold: true },
      { item: "Marketing", valor: -t.marketing, indent: true }, { item: "Comercial / Comissões", valor: -t.comercial, indent: true },
      { item: "Administrativas", valor: -t.administrativas, indent: true }, { item: "Despesas Extras", valor: -t.despesas_extras, indent: true },
      { item: "Funding (Juros / Estruturação)", valor: -t.funding, indent: true }, { item: "LUCRO LÍQUIDO OPERACIONAL", valor: llo, bold: true },
      { item: "Margem Operacional %", valor: pc(llo), is_percentage: true, bold: true }
    ];

    // fluxo mensal combinado; sem nenhum mês, o Órion usa vendas − saídas
    const comb = {};
    Object.entries(cfReal.o).forEach(([k, v]) => { comb[k] = (comb[k] || 0) + v; });
    Object.entries(cfFc.o).forEach(([k, v]) => { comb[k] = (comb[k] || 0) + v; });
    let final = comb;
    if (!Object.keys(comb).some((k) => k !== "N/A")) {
      const fb = {};
      Object.entries(vendasMes).forEach(([m, l]) => { if (m !== "N/A") l.forEach((s) => { fb[m] = (fb[m] || 0) + Math.abs(Number(s.valor) || 0); }); });
      [cfReal.o, cfFc.o].forEach((d) => Object.entries(d).forEach(([m, v]) => { if (m !== "N/A" && v < 0) fb[m] = (fb[m] || 0) + v; }));
      final = fb;
    }
    const ind = o.kpisOnly ? { tir_anual: null, tir_mensal: null, mtir_anual: 0, mtir_mensal: 0, payback: 0, exposicao_maxima: 0, periodo_exposicao: 0, vida: serieMensal(final).length } : indicadores(final, o.tmaAnual, "numpy");
    const rent = vgvLiq < RECEITA_MINIMA_RENTABILIDADE ? null : (llo / vgvLiq) * 100;
    const base = Object.assign({}, t, { vgv_estoque: vgvEstoque, estoque_area: areaDisp, estoque_unidades: nEst, preco_medio: precoMedio, lucro_operacional: lucroOperacional, lucro_liq_operacional: llo,
      receita_bruta: vgvLiq, dre, fluxo_caixa, final_cf_dict: final, monthly_net_cf_real: cfReal.o, monthly_net_cf_fcst: cfFc.o, monthly_revenues_real: revReal.o, monthly_revenues_fcst: revFc.o,
      tir_anual: ind.tir_anual, tir_mensal: ind.tir_mensal, mtir_anual: ind.mtir_anual || 0, mtir_mensal: ind.mtir_mensal || 0, payback: ind.payback || 0, periodo_exposicao: ind.periodo_exposicao, vida: ind.vida, exposicao_maxima: ind.exposicao_maxima, rent_inv: rent,
      saidas_totais: t.impostos + t.terreno + t.projetos + t.obras + t.adm_obra + t.custo_extra_obra + t.marketing + t.comercial + t.administrativas + t.despesas_extras + t.funding });
    if (o.kpisOnly) return base;

    // velocidade de vendas (contagem de contratos e distratos por mês e por ano)
    const total = Number(o.unidades && o.unidades.total) || 0;
    const meses = [...new Set([...Object.keys(vendasMes), ...Object.keys(distratosMes)])].filter((m) => m !== "N/A").sort();
    const totV = Object.keys(vendasMes).filter((m) => m !== "N/A").reduce((s, m) => s + vendasMes[m].length, 0);
    const totD = Object.keys(distratosMes).filter((m) => m !== "N/A").reduce((s, m) => s + distratosMes[m].length, 0);
    const saldoT = totV - totD;
    const anos = {};
    meses.forEach((m) => {
      const v = (vendasMes[m] || []).length, d = (distratosMes[m] || []).length, a = m.slice(0, 4);
      const x = anos[a] || (anos[a] = { vendas: 0, distratos: 0, meses: [] });
      x.vendas += v; x.distratos += d;
      x.meses.push({ mes: m, vendas: v, distratos: d, saldo: v - d, perc: pyR(saldoT > 0 ? ((v - d) / saldoT) * 100 : 0, 2), vel: pyR(total > 0 ? (v / total) * 100 : 0, 2) });
    });
    const velocidade_vendas = Object.keys(anos).sort().map((a) => { const x = anos[a]; return { ano: a, vendas: x.vendas, distratos: x.distratos, saldo: x.vendas - x.distratos, perc: pyR(saldoT > 0 ? ((x.vendas - x.distratos) / saldoT) * 100 : 0, 2), vel: pyR(total > 0 ? (x.vendas / total) * 100 : 0, 2), meses: x.meses }; });
    const bins = {};
    (o.vendas || []).forEach((s) => { if (s.categoria !== "VGV Vendido" && s.categoria !== "Distrato") return; const k = faixaParcelas(Number(s.parcelas) || 0); bins[k] = (bins[k] || 0) + Math.abs(Number(s.valor) || 0); });
    return Object.assign(base, { velocidade_vendas, planos_vendas: planosDasVendas(bins), total_units: total, total_sold: totV, total_returned: totD, total_balance: saldoT });
  }

  /** Órion: _kpis_do_consolidado (linha da lista para um grupo de centros da mesma obra). */
  function kpisGrupo(acts, tmaAnual) {
    let vv = 0, ve = 0, dis = 0, lucro = 0;
    const cf = {};
    acts.forEach((a) => { vv += a.vgv_vendido || 0; ve += a.vgv_estoque || 0; dis += a.distratos || 0; lucro += a.lucro_liq_operacional || 0; Object.entries(a.final_cf_dict || {}).forEach(([m, v]) => { cf[m] = (cf[m] || 0) + v; }); });
    const ind = indicadores(Object.keys(cf).length ? cf : {}, tmaAnual, "newton");
    const ativas = vv - dis, tot = ativas + ve, ex = ind.exposicao_maxima || 0;
    return { vgv_total: tot, vendas_acumuladas: ativas, perc_vendido: tot > 0 ? (ativas / tot) * 100 : 0, lucro, tir_anual: ind.tir_anual, mtir_anual: ind.mtir_anual || 0, payback: ind.payback || 0,
      exposicao_max_caixa: ex, exposicao_caixa_vgv: tot > 0 ? (Math.abs(ex) / tot) * 100 : 0, vso: 0, distrato_venda: vv > 0 ? (dis / vv) * 100 : 0 };
  }

  /** Detalhe de um grupo (soma dos centros, como _get_tracking_details_logic). */
  function detalheGrupo(acts, tmaAnual) {
    const s = (k) => acts.reduce((x, a) => x + (Number(a[k]) || 0), 0);
    const cf = {};
    acts.forEach((a) => Object.entries(a.final_cf_dict || {}).forEach(([m, v]) => { cf[m] = (cf[m] || 0) + v; }));
    const ind = indicadores(cf, tmaAnual, "numpy");
    const dreM = new Map();
    acts.forEach((a) => (a.dre || []).forEach((r) => { if (r.is_percentage || typeof r.valor === "string") return; if (!dreM.has(r.item)) dreM.set(r.item, { item: r.item, valor: 0, bold: !!r.bold, indent: !!r.indent }); dreM.get(r.item).valor += r.valor; }));
    const ordem = (acts[0] && acts[0].dre ? acts[0].dre.map((r) => r.item) : []);
    const recLiq = (dreM.get("RECEITA LÍQUIDA") || {}).valor || 0;
    const pc = (it) => (recLiq > 0 ? ((((dreM.get(it) || {}).valor || 0) / recLiq) * 100).toFixed(2) + "%" : "0.00%");
    const dre = ordem.map((it) => (it === "Margem Bruta %" ? { item: it, valor: pc("MARGEM BRUTA"), is_percentage: true, bold: true } : it === "Margem Operacional %" ? { item: it, valor: pc("LUCRO LÍQUIDO OPERACIONAL"), is_percentage: true, bold: true } : dreM.get(it))).filter(Boolean);
    const fc = new Map();
    acts.forEach((a) => (a.fluxo_caixa || []).forEach((r) => {
      if (!fc.has(r.Ano)) fc.set(r.Ano, { Ano: r.Ano, Entradas: 0, Devolucao_Distratos: 0, Tributos: 0, Terreno: 0, Obras: 0, Projetos: 0, Marketing: 0, Comercial: 0, Administrativas: 0, is_forecast: !!r.is_forecast });
      const x = fc.get(r.Ano); if (r.is_forecast) x.is_forecast = true;
      ["Entradas", "Devolucao_Distratos", "Tributos", "Terreno", "Obras", "Projetos", "Marketing", "Comercial", "Administrativas"].forEach((k) => { x[k] += r[k] || 0; });
    }));
    let acum = 0;
    const fluxo_caixa = [...fc.values()].sort((a, b) => String(a.Ano).localeCompare(String(b.Ano))).map((x) => {
      x.Saidas = x.Tributos + x.Terreno + x.Obras + x.Projetos + x.Marketing + x.Comercial + x.Administrativas;
      x.Total_Saidas = x.Saidas + x.Devolucao_Distratos; x.Saldo_Mes = x.Entradas - x.Total_Saidas; acum += x.Saldo_Mes; x.Saldo_Acumulado = acum; return x;
    });
    const vel = {};
    acts.forEach((a) => (a.velocidade_vendas || []).forEach((y) => { const v = vel[y.ano] || (vel[y.ano] = { vendas: 0, distratos: 0, meses: {} }); v.vendas += y.vendas; v.distratos += y.distratos; (y.meses || []).forEach((m) => { const z = v.meses[m.mes] || (v.meses[m.mes] = { vendas: 0, distratos: 0 }); z.vendas += m.vendas; z.distratos += m.distratos; }); }));
    const total = s("total_units"), saldoT = s("total_sold") - s("total_returned");
    const r2 = (x) => pyR(x, 2);
    const velocidade_vendas = Object.keys(vel).sort().map((ano) => { const v = vel[ano]; return { ano, vendas: v.vendas, distratos: v.distratos, saldo: v.vendas - v.distratos, perc: r2(saldoT > 0 ? ((v.vendas - v.distratos) / saldoT) * 100 : 0), vel: r2(total > 0 ? (v.vendas / total) * 100 : 0),
      meses: Object.keys(v.meses).sort().map((m) => { const z = v.meses[m]; return { mes: m, vendas: z.vendas, distratos: z.distratos, saldo: z.vendas - z.distratos, perc: r2(saldoT > 0 ? ((z.vendas - z.distratos) / saldoT) * 100 : 0), vel: r2(total > 0 ? (z.vendas / total) * 100 : 0) }; }) }; });
    const bins = {};
    acts.forEach((a) => Object.entries((a.planos_vendas && a.planos_vendas.bins) || {}).forEach(([k, v]) => { bins[k] = (bins[k] || 0) + v; }));
    const vv = s("vgv_vendido"), dis = s("distratos"), ativas = vv - dis, tot = ativas + s("vgv_estoque"), ex = ind.exposicao_maxima || 0, rb = s("receita_bruta"), llo = s("lucro_liq_operacional");
    return { vgv_vendido: vv, distratos: dis, vgv_estoque: s("vgv_estoque"), estoque_unidades: s("estoque_unidades"), lucro_operacional: s("lucro_operacional"), lucro_liq_operacional: llo, receita_bruta: rb,
      vgv_total: tot, vendas_acumuladas: ativas, perc_vendido: tot > 0 ? (ativas / tot) * 100 : 0, distrato_venda: vv > 0 ? (dis / vv) * 100 : 0, exposicao_caixa_vgv: tot > 0 ? (Math.abs(ex) / tot) * 100 : 0,
      tir_anual: ind.tir_anual, tir_mensal: ind.tir_mensal, mtir_anual: ind.mtir_anual || 0, mtir_mensal: ind.mtir_mensal || 0, payback: ind.payback || 0, periodo_exposicao: ind.periodo_exposicao, vida: ind.vida, exposicao_maxima: ex,
      rent_inv: rb < RECEITA_MINIMA_RENTABILIDADE ? null : (llo / rb) * 100, dre, fluxo_caixa, velocidade_vendas, planos_vendas: planosDasVendas(bins),
      total_units: total, total_sold: s("total_sold"), total_returned: s("total_returned"), total_balance: saldoT };
  }

  /** Cidade e produto pelo nome do centro de custo (Órion: parse_project_name). */
  function nomeProjeto(nome) {
    let cidade = "Centro de Custo", p = String(nome || "");
    if (p.toLowerCase().indexOf("frota") >= 0) return { cidade: "FROTA", produto: "FROTA" };
    if (p.indexOf(" - ") >= 0) { const i = p.indexOf(" - "); cidade = p.slice(0, i).trim(); p = p.slice(i + 3).trim(); }
    return { cidade, produto: p.replace(" - PARCERIA GAP", "").replace(" - PARCERIA", "").replace(" - MLDU", "").trim() };
  }
  /** Mesma obra: nome igual ou sufixo (" - OBRAS", " (…)"), sem confundir "II" com "I" (Órion: _mesmo_produto_obra). */
  function mesmaObra(produto, candidato) {
    const a = String(produto || "").trim(), b = String(candidato || "").trim();
    if (!a || !b) return false;
    return b === a || b.indexOf(a + " - ") === 0 || b.indexOf(a + " (") === 0;
  }


  /**
   * DFC da vida do empreendimento (Órion: tracking_dfc.montar_dfc_vida): realizado + a realizar de todos os centros da obra
   * na visão DFC, por grupo e por plano, mês a mês; pais somam os filhos pelo código e as linhas de fórmula do Órion
   * (03 = 04 + 05, 06 = 01 + 02 + 03, 08 = 06 + 07, 10 = 08 + 09, 12 = 10 + 11). Conferência: lucro da DFC (sem cancelamentos)
   * contra o lucro líquido operacional da lista.
   * o: { centros: [{ entrada: { real, previsto }, terreno }], grupos: [{ id, name }], hoje, lucroLista }
   */
  function dfcVida(o) {
    const nos = (o.grupos || []).map((g) => ({ id: g.id, codigo: codigoGrupo(g.name || g.nome), descricao: String(g.name || g.nome || "").replace(/^\s*\d{2}(?:\.\d{2})*\s+/, "").trim() }))
      .filter((n) => n.codigo).sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0));
    const porCod = (c) => (nos.find((n) => n.codigo === c) || {}).id || null;
    const porPref = (p) => (nos.find((n) => n.codigo.indexOf(p) === 0) || {}).id || null;
    const venda = porCod("01.01") || porPref("01."), admin = porCod("05.03") || porPref("05."), cancel = porCod("01.04"), terrenoNo = porCod("04.01") || porCod("04.05") || porPref("04.");
    const ids = new Set(nos.map((n) => n.id));
    const folha = {}, planos = {};
    let lucro = 0;
    const lancar = (nid, plano, mes, v) => {
      (folha[nid] = folha[nid] || {})[mes] = (folha[nid][mes] || 0) + v;
      const k = nid + "|" + plano;
      const p = planos[k] || (planos[k] = { nid, descricao: plano, valores_mes: {} });
      p.valores_mes[mes] = (p.valores_mes[mes] || 0) + v;
    };
    const acumular = (r) => {
      const mes = r.mes;
      if (!/^\d{4}-\d{2}$/.test(String(mes || ""))) return;
      const g = String(r.grupo || "").toUpperCase(), cat = String(r.categoria || "").toLowerCase();
      let nid = r.gid && ids.has(r.gid) ? r.gid : null;
      if (!nid) nid = r.tipo === "INCOME" ? venda : (g.indexOf("DISTRATO") >= 0 || g.indexOf("CANCELAMENTO") >= 0 || cat.indexOf("distrat") >= 0) ? cancel : admin;
      if (!nid) return;
      const val = Math.abs(Number(r.valor) || 0);
      const v = r.tipo === "INCOME" || String(r.categoria || "").trim().indexOf("(-)") === 0 ? val : -val;
      lancar(nid, String(r.categoria || "").trim() || "Sem plano", mes, v);
      if (nid !== cancel) lucro += v;
    };
    (o.centros || []).forEach((c) => { ((c.entrada && c.entrada.real) || []).forEach(acumular); ((c.entrada && c.entrada.previsto) || []).forEach(acumular); });
    (o.centros || []).forEach((c) => {
      const mlc = c.terreno ? Number(c.terreno.valor) || 0 : 0;
      if (mlc <= 0 || !terrenoNo) return;
      const ms = [...new Set(((c.entrada && c.entrada.real) || []).map((r) => r.mes).filter((m) => /^\d{4}-\d{2}$/.test(String(m || ""))))].sort();
      const pm = ms[0] || String(o.hoje || "");
      lancar(terrenoNo, "Terreno (custo manual)", pm, -mlc);
      lucro -= mlc;
    });
    const valores = (vm) => { const anos = {}; Object.entries(vm).forEach(([m, v]) => { anos[m.slice(0, 4)] = (anos[m.slice(0, 4)] || 0) + v; }); return { valores: anos, valores_mes: vm, total: Object.values(vm).reduce((a, b) => a + b, 0) }; };
    const linhas = nos.map((n) => Object.assign({ kind: "categoria", id: n.id, codigo: n.codigo, descricao: n.descricao, nivel: (n.codigo.match(/\./g) || []).length,
      planos: Object.values(planos).filter((p) => p.nid === n.id).map((p) => Object.assign({ kind: "plano", descricao: p.descricao }, valores(p.valores_mes))).sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR")) }, valores(Object.assign({}, folha[n.id] || {}))));
    linhas.slice().sort((a, b) => b.nivel - a.nivel).forEach((filho) => {
      let pai = null, best = -1;
      linhas.forEach((c) => { if (c.codigo && c.codigo !== filho.codigo && filho.codigo.indexOf(c.codigo + ".") === 0 && c.codigo.length > best) { pai = c; best = c.codigo.length; } });
      if (!pai) return;
      Object.entries(filho.valores_mes).forEach(([m, v]) => { pai.valores_mes[m] = (pai.valores_mes[m] || 0) + v; });
      Object.assign(pai, valores(pai.valores_mes));
    });
    [["03", ["04", "05"]], ["06", ["01", "02", "03"]], ["08", ["06", "07"]], ["10", ["08", "09"]], ["12", ["10", "11"]]].forEach(([d, orig]) => {
      const dest = linhas.find((l) => l.codigo === d);
      if (!dest) return;
      const vm = Object.assign({}, dest.valores_mes);
      orig.forEach((c) => { const src = linhas.find((l) => l.codigo === c); if (src) Object.entries(src.valores_mes).forEach(([m, v]) => { vm[m] = (vm[m] || 0) + v; }); });
      Object.assign(dest, valores(vm));
    });
    const anos = [...new Set([].concat(...linhas.map((l) => Object.keys(l.valores).filter((a) => Math.abs(l.valores[a]) > 0.005))))].sort();
    const meses = [...new Set([].concat(...linhas.map((l) => Object.keys(l.valores_mes).filter((m) => Math.abs(l.valores_mes[m]) > 0.005))))].sort();
    const ll = Number(o.lucroLista) || 0;
    return { anos, meses, linhas, conferencia: { lucro_dfc: lucro, lucro_lista: ll, desvio: lucro - ll, ok: Math.abs(lucro - ll) < 1 } };
  }

  const api = { dfcVida, grupoOrion, codigoGrupo, GRUPO_ORION, calcularCentro, indicadores, kpisGrupo, detalheGrupo, classificarSaida, projetarEstoque, tributosPresumido, irrNewton, serieMensal, nomeProjeto, mesmaObra, faixaParcelas, ESTOQUE, TMA_PADRAO };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  raiz.OrionAcompanhamentoCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
