/* Motor da viabilidade — tradução fiel de backend/app/services/math_engine.py do ML Órion (calculate_viability_results).
 * Mesmas premissas, curvas, impostos, plano de pagamento (Price/SAC/sem juros, entrada, correção), INCC nas obras,
 * permuta, funding (CRI/CRA/Banco com custos CVM/ANBIMA/B3/securitizadora e gross-up), TIR, VPL, MTIR, exposição,
 * payback e as visões por parceiro (regra de 09/11/2026).
 * Conferido contra a saída do próprio Órion em tests/orion/viabilidade.test.js.
 * Valores em reais (número de ponto flutuante), como no Órion: os indicadores são comparados com tolerância de centavos.
 * Roda no navegador (window.OrionViabilidadeCalc) e no node (testes). */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.OrionViabilidadeCalc = api;
})(typeof self !== "undefined" ? self : this, function () {
  /* ---------- utilidades com a mesma semântica do Python ---------- */

  /** getattr(obj, chave, padrao): o padrão só vale se o campo não existir (null continua null). */
  function ga(o, k, padrao) {
    if (!o || !Object.prototype.hasOwnProperty.call(o, k)) return padrao;
    return o[k];
  }
  /** "x or padrao" do Python (0, null, "", [], {} contam como vazio). */
  function ou(v, padrao) {
    if (v === null || v === undefined || v === 0 || v === false || v === "") return padrao;
    if (Array.isArray(v) && !v.length) return padrao;
    if (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length) return padrao;
    return v;
  }
  function verdade(v) { return ou(v, null) !== null; }
  function soma(a) { let s = 0; for (const x of a || []) s += x; return s; }
  /** round() do Python 3: metade vai para o par. */
  function pyRound(x) {
    const f = Math.floor(x), d = x - f;
    if (Math.abs(d - 0.5) < 1e-12) return f % 2 === 0 ? f : f + 1;
    return Math.round(x);
  }
  function jsonDe(v) {
    if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return null; } }
    return v;
  }

  /* ---------- funding ---------- */

  function calcularCustosFunding(funding, custoObrasTotal, vgvTotal, rates) {
    if (!funding) return [0, 0, 0];
    let volume = 0;
    if (funding.modo_volume === "fixo") volume = funding.volume_fixo;
    else volume = custoObrasTotal * (funding.percentual_obra_financiado / 100);
    if (volume <= 0 || funding.tipo_funding === "Plano Empresarial (Banco)") return [volume, 0, 0];
    const r = rates || {};
    const g = (o, k, d) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : d);
    const cvm = g(r, "CVM", {}), anb = g(r, "ANBIMA", {}), b3 = g(r, "B3", {});
    const sec = g(g(r, "Securitizadoras", {}), funding.securitizadora, {}) || {};
    const txCvm = funding.icvm === "ICVM 476" ? g(cvm, "ICVM_476", 0.0003) : g(cvm, "ICVM_400", 0.0005);
    const custoCvm = Math.max(volume * txCvm, g(cvm, "Mínimo", 809.16));
    let custoAnb = volume * g(anb, "Taxa_Registro", 0.000044);
    if (funding.icvm === "ICVM 476") custoAnb = Math.max(Math.min(custoAnb, g(anb, "Max_476", 3136)), g(anb, "Min_476", 1568));
    else custoAnb = Math.max(Math.min(custoAnb, g(anb, "Max_400", 109910)), g(anb, "Min_400", 15700));
    const faixa = (lista) => {
      for (const x of lista || []) { const max = x.max == null ? Infinity : x.max; if (volume <= max) return x.rate; }
      return 0;
    };
    const custoB3Reg = volume * faixa(g(b3, "Registro", []));
    const secUp = g(sec, "Agente_Fiduciario_Implantacao", 0) + g(sec, "Instituicao_Custodiante", 0) + g(sec, "Registro_Lastro", 0);
    let estrut = custoCvm + custoAnb + custoB3Reg + secUp;
    if (funding.taxa_estruturacao > 0) estrut += volume * (funding.taxa_estruturacao / 100);
    const custoB3Cust = volume * faixa(g(b3, "Custodia", []));
    let recorrenteAnual = custoB3Cust + g(sec, "Agente_Fiduciario_Recorrente", 0) + g(sec, "Liquidante", 0);
    const grossUp = funding.gross_up ? funding.gross_up / 100 : 0;
    if (grossUp < 1) { estrut = estrut / (1 - grossUp); recorrenteAnual = recorrenteAnual / (1 - grossUp); }
    const recorrenteTotal = (recorrenteAnual / 12) * funding.prazo_meses;
    return [volume, estrut, recorrenteTotal];
  }

  const TIPOS_FUNDING_COM_CRONOGRAMA = ["Plano Empresarial (Banco)", "CRI", "CRA"];

  function taxaMensalFunding(funding) {
    const taxa = (ou(ga(funding, "taxa_juros", 0), 0)) / 100;
    const per = String(ou(ga(funding, "taxa_juros_periodicidade", null), "a.a.")).trim().toLowerCase();
    if (taxa <= 0) return 0;
    if (per === "a.m." || per === "am" || per === "mensal") return taxa;
    return Math.pow(1 + taxa, 1 / 12) - 1;
  }

  function cronogramaFunding(volume, taxa, prazo, sistema) {
    if (volume <= 0 || prazo <= 0) return [];
    sistema = sistema || "SAC";
    const l = [];
    if (sistema === "Bullet") { for (let j = 0; j < prazo; j++) l.push([volume * taxa, j === prazo - 1 ? volume : 0]); return l; }
    if (taxa <= 0) { for (let j = 0; j < prazo; j++) l.push([0, volume / prazo]); return l; }
    let saldo = volume;
    if (sistema === "Price") {
      const pmt = volume * (taxa / (1 - Math.pow(1 + taxa, -prazo)));
      for (let j = 0; j < prazo; j++) { const ju = saldo * taxa; const am = j === prazo - 1 ? saldo : pmt - ju; l.push([ju, am]); saldo -= am; }
      return l;
    }
    const am = volume / prazo;
    for (let j = 0; j < prazo; j++) { l.push([saldo * taxa, am]); saldo -= am; }
    return l;
  }

  /* ---------- curvas ---------- */

  function extrairCurva(j) {
    j = jsonDe(j);
    if (!j || typeof j !== "object" || Array.isArray(j) || !Object.keys(j).length) return [[], 1];
    let meses = ga(j, "meses", []) || [];
    const ini = ga(j, "mes_inicio", 1);
    const total = soma(meses);
    if (total > 0 && Math.abs(total - 100) > 0.001) meses = meses.map((m) => (m * 100) / total);
    return [meses.slice(), ini];
  }

  function acelerarCurva(meses, fator) {
    if (!meses || !meses.length || !fator || fator <= 0 || Math.abs(fator - 1) < 1e-9) return (meses || []).slice();
    const n = meses.length;
    const ac = [0];
    for (const v of meses) ac.push(ac[ac.length - 1] + v);
    const ate = (t) => { if (t >= n) return ac[n]; const i = Math.floor(t); return ac[i] + (t - i) * meses[i]; };
    const novo = Math.max(1, Math.trunc(pyRound(n / fator)));
    const out = [];
    for (let k = 0; k < novo; k++) out.push(ate(Math.min(n, (k + 1) * fator)) - ate(Math.min(n, k * fator)));
    return out;
  }

  function aplicarOffset(dist, ini, prazo) {
    const off = Math.max(0, ini - 1);
    const r = new Array(prazo).fill(0);
    (dist || []).forEach((v, i) => { if (off + i < prazo) r[off + i] = v; });
    return r;
  }

  function parseCondicoes(cj) {
    cj = jsonDe(cj);
    const padrao = [{ nome: "A VISTA", perc: 100, inst: 1, aplica_juros: true, aplica_correcao: true }];
    if (!Array.isArray(cj) || !cj.length) return padrao;
    const flat = [];
    cj.forEach((it) => { if (it && Array.isArray(it.condicoes)) flat.push(...it.condicoes); else flat.push(it); });
    if (!flat.length) return padrao;
    return flat.map((c) => {
      const nome = String(ga(c, "nome", "1")).toUpperCase().replace(/A VISTA/g, "1");
      const m = nome.match(/\d+/);
      let inst = m ? parseInt(m[0], 10) : 1;
      if (inst <= 0) inst = 1;
      return { nome, perc: ga(c, "perc", 0), inst, aplica_juros: ga(c, "aplica_juros", true), aplica_correcao: ga(c, "aplica_correcao", true),
        perc_entrada: ga(c, "perc_entrada", 0), parcelas_entrada: ga(c, "parcelas_entrada", 1), curve_json: ga(c, "curve_json", null) };
    });
  }

  /* ---------- matemática financeira (numpy_financial 1.0) ---------- */

  function npv(taxa, v) { let s = 0; for (let t = 0; t < v.length; t++) s += v[t] / Math.pow(1 + taxa, t); return s; }

  /** npf.irr: entre as raízes reais com 1+r > 0, a mais próxima de zero. Procura troca de sinal numa grade e refina por bisseção. */
  function irr(v) {
    if (!v.some((x) => x > 0) || !v.some((x) => x < 0)) return null;
    const f = (r) => npv(r, v);
    const pontos = [];
    for (let r = -0.99; r < 0; r += 0.001) pontos.push(r);
    for (let r = 0; r <= 1; r += 0.0005) pontos.push(r);
    for (let r = 1.01; r <= 20; r += 0.01) pontos.push(r);
    const raizes = [];
    let ra = pontos[0], fa = f(ra);
    for (let k = 1; k < pontos.length; k++) {
      const rb = pontos[k], fb = f(rb);
      if (!isFinite(fa) || !isFinite(fb)) { ra = rb; fa = fb; continue; }
      if (fa === 0) raizes.push(ra);
      else if (fa * fb < 0) {
        let a = ra, b = rb, fA = fa;
        for (let it = 0; it < 200; it++) { const m = (a + b) / 2, fm = f(m); if (fA * fm <= 0) b = m; else { a = m; fA = fm; } if (b - a < 1e-15) break; }
        raizes.push((a + b) / 2);
      }
      ra = rb; fa = fb;
    }
    if (!raizes.length) return null;
    return raizes.reduce((x, y) => (Math.abs(y) < Math.abs(x) ? y : x));
  }

  function mirr(v, fin, reinv) {
    const n = v.length;
    const pos = v.map((x) => (x > 0 ? x : 0)), neg = v.map((x) => (x < 0 ? x : 0));
    if (!v.some((x) => x > 0) || !v.some((x) => x < 0)) return NaN;
    const numer = Math.abs(npv(reinv, pos)), denom = Math.abs(npv(fin, neg));
    return Math.pow(numer / denom, 1 / (n - 1)) * (1 + reinv) - 1;
  }

  /* ---------- motor ---------- */

  /**
   * fase: { viability, revenue, construction, expenses, taxes, exchanges, funding } com os mesmos campos das tabelas do Órion.
   * cenario: { vgv_multiplier, construction_cost_multiplier, sales_speed_multiplier } ou null.
   * fundingRates: o mesmo objeto de "Taxas de funding" (Premissas da viabilidade).
   */
  function calcular(fase, cenario, fundingRates) {
    const rev = fase.revenue || null, con = fase.construction || null, exp = fase.expenses || null;
    const tax = fase.taxes || null, exc = fase.exchanges || null, viab = fase.viability || null;
    let vgvMult = 1, costMult = 1, speedMult = 1;
    if (cenario) { vgvMult = ou(cenario.vgv_multiplier, 1); costMult = ou(cenario.construction_cost_multiplier, 1); speedMult = ou(cenario.sales_speed_multiplier, 1); }

    const vgvBase = rev && verdade(rev.vgv_total) ? rev.vgv_total : 0;
    let vgvTotal = vgvBase * vgvMult;

    let custoObras = 0, custoProjetos = 0, aquisicaoArea = 0, admObras = 0, custoObrasTotal = 0;
    if (con) {
      const val = (k, kt) => { const v = ou(con[k], 0); return (ga(con, kt, "R$") === "R$" ? v : vgvTotal * (v / 100)) * costMult; };
      custoObras = val("custo_obras", "custo_obras_tipo");
      custoProjetos = val("custo_projetos", "custo_projetos_tipo");
      aquisicaoArea = val("aquisicao_area", "aquisicao_area_tipo");
      admObras = val("adm_obras", "adm_obras_tipo");
      custoObrasTotal = custoObras + custoProjetos + aquisicaoArea + admObras;
    }

    let marketing = 0, comercial = 0, adm = 0, comissao = 0;
    if (exp) {
      const val = (k, kt) => { const v = ou(exp[k], 0); return ga(exp, kt, "%") === "R$" ? v : vgvTotal * (v / 100); };
      marketing = val("marketing_valor", "marketing_tipo");
      comercial = val("comercial_valor", "comercial_tipo");
      adm = val("adm_valor", "adm_tipo");
      comissao = vgvTotal * (ou(ga(exp, "comissao_corretagem_valor", 0), 0) / 100);
    }
    const vgvBruto = vgvTotal;
    vgvTotal = vgvBruto - comissao;

    let valorTerreno = 0;
    const mod = exc && verdade(exc.modalidade) ? exc.modalidade : "";
    if (mod.indexOf("Dinheiro") >= 0) valorTerreno += verdade(exc.valor_terreno_fixo) ? exc.valor_terreno_fixo : 0;
    if (mod.indexOf("Permuta Financeira") >= 0) {
      const rt = exc && verdade(ga(exc, "rateios_config_json", null)) ? jsonDe(exc.rateios_config_json) : {};
      let percPerm;
      if (ga(rt, "vincular_permuta_parceria", true)) percPerm = exc && verdade(ga(exc, "perc_parceria_terrenista", null)) ? exc.perc_parceria_terrenista : 0;
      else percPerm = verdade(exc.perc_permuta_financeira) ? exc.perc_permuta_financeira : 0;
      valorTerreno += vgvTotal * (percPerm / 100);
    }
    if (mod.indexOf("Permuta Física") >= 0) {
      const un = exc && verdade(ga(exc, "permuta_fisica_unidades", null)) ? exc.permuta_fisica_unidades : 0;
      const vu = exc && verdade(ga(exc, "permuta_fisica_valor_unidade", null)) ? exc.permuta_fisica_valor_unidade : 0;
      valorTerreno += un * vu;
    }
    const rateios = exc && verdade(ga(exc, "rateios_config_json", null)) ? jsonDe(exc.rateios_config_json) || {} : {};
    const percTerr = exc && verdade(ga(exc, "perc_parceria_terrenista", null)) ? exc.perc_parceria_terrenista : 0;
    custoObrasTotal = custoObras + custoProjetos + aquisicaoArea + admObras;

    const extraCons = [];
    const ecj = con ? jsonDe(ga(con, "extra_constructions_json", null)) : null;
    if (con && verdade(ecj)) {
      ecj.forEach((ec) => {
        const v = ga(ec, "valor", 0), t = ga(ec, "tipo", "R$");
        let fv = t === "R$" ? v : vgvTotal * (v / 100);
        fv *= costMult;
        custoObrasTotal += fv;
        extraCons.push({ valor: fv, curva_json: ga(ec, "curva_json", null) });
      });
    }
    let totalDespesas = marketing + comercial + adm;
    const extraExp = [];
    const eej = exp ? jsonDe(ga(exp, "extra_expenses_json", null)) : null;
    if (exp && verdade(eej)) {
      eej.forEach((ee) => {
        const v = ga(ee, "valor", 0), t = ga(ee, "tipo", "R$");
        const fv = t === "R$" ? v : vgvTotal * (v / 100);
        totalDespesas += fv;
        extraExp.push({ valor: fv, curva_json: ga(ee, "curva_json", null) });
      });
    }

    const regime = tax && verdade(tax.regime_tributario) ? tax.regime_tributario : "RET";
    const incid = tax ? ga(tax, "incidencia_sobre", "Recebimento") : "Recebimento";
    let pPis = 0, pCof = 0, pIr = 0, pOut = 0, aliq;
    if (regime === "Lucro Presumido") {
      const aP = ou(tax.aliquota_pis, 0.65), aC = ou(tax.aliquota_cofins, 3.0), aI = ou(tax.aliquota_irpj, 1.2), aS = ou(tax.aliquota_csll, 1.08), aO = ou(tax.aliquota_outros, 0);
      aliq = aP + aC + aI + aS + aO;
      if (aliq > 0) { pPis = aP / aliq; pCof = aC / aliq; pIr = (aI + aS) / aliq; pOut = aO / aliq; }
    } else {
      aliq = tax && ga(tax, "aliquota_total", null) !== null ? tax.aliquota_total : 4.0;
      const base = 4.0;
      pPis = 0.37 / base; pCof = 1.71 / base; pIr = 1.92 / base;
      pOut = aliq > base ? Math.max(0, (aliq - base) / aliq) : 0;
      const ps = pPis + pCof + pIr + pOut;
      if (ps > 0 && Math.abs(ps - 1) > 0.001) { pPis /= ps; pCof /= ps; pIr /= ps; pOut /= ps; }
    }
    const totalImpostos = vgvTotal * (aliq / 100);

    const condicoes = parseCondicoes(rev ? rev.condicoes_pagamento_json : []);
    const maxInst = condicoes.length ? Math.max(...condicoes.map((c) => c.inst)) : 1;
    const sistema = rev && verdade(ga(rev, "sistema_amortizacao", null)) ? rev.sistema_amortizacao : "Sem Juros";
    const taxaJuros = rev && verdade(ga(rev, "taxa_juros_vendas", null)) ? Number(rev.taxa_juros_vendas) : 0;
    const taxaJurosDec = Math.pow(1 + taxaJuros / 100, 1 / 12) - 1;
    const taxaInf = rev && verdade(ga(rev, "taxa_correcao_projetada", null)) ? Number(rev.taxa_correcao_projetada) : 0;
    const tipoInf = rev && verdade(ga(rev, "tipo_correcao_projetada", null)) ? rev.tipo_correcao_projetada : "% a.a.";
    let taxaInfM = taxaInf / 100;
    if (tipoInf === "% a.a.") taxaInfM = Math.pow(1 + taxaInfM, 1 / 12) - 1;
    let taxaIncc = 0;
    if (viab && verdade(ga(viab, "aplicar_incc_obras", false))) {
      const ti = ou(ga(viab, "incc_projetado_valor", 0), 0) / 100;
      const tt = ou(ga(viab, "incc_projetado_tipo", "% a.a."), "% a.a.");
      taxaIncc = tt === "% a.a." ? Math.pow(1 + ti, 1 / 12) - 1 : ti;
    }

    const curvaVendas = (j) => { const [raw, off] = extrairCurva(j); return [acelerarCurva(raw, speedMult), off]; };
    const [vendasRaw, vendasOff] = curvaVendas(rev ? rev.velocidade_vendas_json : null);
    const [obrasRaw, obrasOff] = extrairCurva(con ? con.curva_obras_json : null);
    const [projRaw, projOff] = extrairCurva(con ? con.curva_projetos_json : null);
    const [aqRaw, aqOff] = extrairCurva(con ? con.curva_aquisicao_json : null);
    const [admORaw, admOOff] = extrairCurva(con ? con.curva_adm_obras_json : null);
    const [mktRaw, mktOff] = extrairCurva(exp ? exp.curva_marketing_json : null);
    const [comRaw, comOff] = extrairCurva(exp ? exp.curva_comercial_json : null);
    const [admDRaw, admDOff] = extrairCurva(exp ? exp.curva_adm_json : null);
    const extraMkt = extraExp.map((e) => { const [raw, off] = extrairCurva(e.curva_json); return { raw, off, valor: e.valor }; });
    const extraObr = extraCons.map((e) => { const [raw, off] = extrairCurva(e.curva_json); return { raw, off, valor: e.valor }; });

    const curvaDaCond = (c) => {
      if (verdade(c.curve_json)) { const [r, o] = curvaVendas(c.curve_json); return [r, vendasOff + Math.max(0, o - 1)]; }
      return [vendasRaw, vendasOff];
    };
    let maxLen = 36;
    condicoes.forEach((c) => { const [r, o] = curvaDaCond(c); const t = r.length + Math.max(0, o - 1); if (t > maxLen) maxLen = t; });
    [[obrasRaw, obrasOff], [mktRaw, mktOff]].forEach(([d, o]) => { const t = d.length + Math.max(0, o - 1); if (t > maxLen) maxLen = t; });
    extraMkt.concat(extraObr).forEach((d) => { const t = d.raw.length + Math.max(0, d.off - 1); if (t > maxLen) maxLen = t; });
    const prazo = Math.max(maxLen + 1, maxLen + maxInst);

    const vendasDist = aplicarOffset(vendasRaw, vendasOff, prazo);
    const obrasDist = aplicarOffset(obrasRaw, obrasOff, prazo);
    const projDist = aplicarOffset(projRaw, projOff, prazo);
    const aqDist = aplicarOffset(aqRaw, aqOff, prazo);
    const admODist = aplicarOffset(admORaw, admOOff, prazo);
    const mktDist = aplicarOffset(mktRaw, mktOff, prazo);
    const comDist = aplicarOffset(comRaw, comOff, prazo);
    const admDDist = aplicarOffset(admDRaw, admDOff, prazo);
    extraMkt.forEach((d) => { d.dist = aplicarOffset(d.raw, d.off, prazo); });
    extraObr.forEach((d) => { d.dist = aplicarOffset(d.raw, d.off, prazo); });

    const z = () => new Array(prazo).fill(0);
    const rec = z(), recV = z(), recE = z(), recP = z(), recJ = z();
    const imp = z(), impPis = z(), impCof = z(), impIr = z(), impOut = z();
    const obr = [], obrC = [], obrP = [], obrA = [], obrAd = [], obrX = extraObr.map(() => []);
    const desp = [], dMkt = [], dCom = [], dAdm = [], dX = extraMkt.map(() => []);

    const addImp = (idx, v) => { imp[idx] += v; impPis[idx] += v * pPis; impCof[idx] += v * pCof; impIr[idx] += v * pIr; impOut[idx] += v * pOut; };

    condicoes.forEach((c) => {
      if (c.perc <= 0) return;
      const [cr, co] = curvaDaCond(c);
      const cd = aplicarOffset(cr, co, prazo);
      if (soma(cd) === 0 && vgvTotal > 0) {
        const nm = Math.max(36, prazo - maxInst);
        const ppm = 100 / nm;
        for (let i = 0; i < Math.min(nm, prazo); i++) cd[i] = ppm;
      }
      const valPlano = vgvTotal * (c.perc / 100), impPlano = totalImpostos * (c.perc / 100);
      for (let i = 0; i < cd.length; i++) {
        if (!(cd[i] > 0)) continue;
        const valCond = valPlano * (cd[i] / 100), impCond = impPlano * (cd[i] / 100);
        if (incid === "Venda" && i < prazo) addImp(i, impCond);
        const percEnt = c.perc_entrada, parcEnt = Math.max(1, c.parcelas_entrada);
        const valEnt = valCond * (percEnt / 100), impEnt = impCond * (percEnt / 100);
        const valFin = valCond - valEnt, impFin = impCond - impEnt;
        if (valEnt > 0) {
          const vm = valEnt / parcEnt, im = impEnt / parcEnt;
          for (let p = 0; p < parcEnt; p++) {
            const k = i + p;
            if (k < prazo) { rec[k] += vm; recV[k] += vm; recE[k] += vm; if (incid !== "Venda") addImp(k, im); }
          }
        }
        let inst = c.inst;
        if (valEnt > 0 && inst > parcEnt) inst = inst - parcEnt;
        if (inst <= 0) continue;
        const offFin = inst === 1 && valEnt === 0 ? 0 : (valEnt > 0 ? parcEnt : 1);
        const tj = c.aplica_juros ? taxaJurosDec : 0;
        const ti = c.aplica_correcao ? taxaInfM : 0;
        if (sistema === "Price" && tj > 0) {
          const pm = valFin * (tj / (1 - Math.pow(1 + tj, -inst)));
          const ip = impFin * (tj / (1 - Math.pow(1 + tj, -inst)));
          let saldo = valFin, iSaldo = impFin;
          for (let j = 0; j < inst; j++) {
            const k = i + offFin + j;
            if (k < prazo) {
              const ju = saldo * tj, am = pm - ju; saldo -= am;
              const iju = iSaldo * tj, iam = ip - iju; iSaldo -= iam;
              const fi = Math.pow(1 + ti, offFin + j);
              const pt = pm * fi;
              rec[k] += pt; recV[k] += am; recP[k] += am; recJ[k] += pt - am;
              if (incid !== "Venda") addImp(k, ip * fi);
            }
          }
        } else if (sistema === "SAC" && tj > 0) {
          const am = valFin / inst, iam = impFin / inst;
          for (let j = 0; j < inst; j++) {
            const k = i + offFin + j;
            if (k < prazo) {
              const saldo = valFin - am * j, iSaldo = impFin - iam * j;
              const ju = saldo * tj, iju = iSaldo * tj;
              const fi = Math.pow(1 + ti, offFin + j);
              const pt = (am + ju) * fi;
              rec[k] += pt; recV[k] += am; recP[k] += am; recJ[k] += pt - am;
              if (incid !== "Venda") addImp(k, (iam + iju) * fi);
            }
          }
        } else {
          const pm = valFin / inst, ip = impFin / inst;
          for (let j = 0; j < inst; j++) {
            const k = i + offFin + j;
            if (k < prazo) {
              const fi = Math.pow(1 + ti, offFin + j);
              const pt = pm * fi;
              rec[k] += pt; recV[k] += pm; recP[k] += pm; recJ[k] += pt - pm;
              if (incid !== "Venda") addImp(k, ip * fi);
            }
          }
        }
      }
    });

    const hasMkt = soma(mktDist) > 0, hasCom = soma(comDist) > 0, hasAdm = soma(admDDist) > 0;
    const hasProj = soma(projDist) > 0, hasAq = soma(aqDist) > 0, hasAdmO = soma(admODist) > 0;
    for (let i = 0; i < prazo; i++) {
      let m = 0, cm = 0, ad = 0;
      if (hasMkt) m += marketing * (mktDist[i] / 100); else if (vendasDist[i] > 0) m += marketing * (vendasDist[i] / 100);
      if (hasCom) cm += comercial * (comDist[i] / 100); else if (vendasDist[i] > 0) cm += comercial * (vendasDist[i] / 100);
      if (hasAdm) ad += adm * (admDDist[i] / 100); else if (vendasDist[i] > 0) ad += adm * (vendasDist[i] / 100);
      dMkt.push(m); dCom.push(cm); dAdm.push(ad);
      let td = m + cm + ad;
      extraMkt.forEach((d, x) => {
        let v = 0;
        if (soma(d.dist) > 0) v = d.valor * (d.dist[i] / 100); else if (vendasDist[i] > 0) v = d.valor * (vendasDist[i] / 100);
        dX[x].push(v); td += v;
      });
      desp.push(td);

      let oc = 0, op = 0, oa = 0, oad = 0;
      if (obrasDist[i] > 0) oc += custoObras * (obrasDist[i] / 100);
      if (hasProj) op += custoProjetos * (projDist[i] / 100); else if (obrasDist[i] > 0) op += custoProjetos * (obrasDist[i] / 100);
      if (hasAq) oa += aquisicaoArea * (aqDist[i] / 100); else if (obrasDist[i] > 0) oa += aquisicaoArea * (obrasDist[i] / 100);
      if (hasAdmO) oad += admObras * (admODist[i] / 100); else if (obrasDist[i] > 0) oad += admObras * (obrasDist[i] / 100);
      const fi = Math.pow(1 + taxaIncc, i);
      obrC.push(oc * fi); obrP.push(op * fi); obrA.push(oa * fi); obrAd.push(oad * fi);
      let to = (oc + op + oa + oad) * fi;
      extraObr.forEach((d, x) => {
        let v = 0;
        if (soma(d.dist) > 0) v = d.valor * (d.dist[i] / 100); else if (obrasDist[i] > 0) v = d.valor * (obrasDist[i] / 100);
        v *= fi; obrX[x].push(v); to += v;
      });
      obr.push(to);
    }

    if (soma(rec) === 0 && vgvTotal > 0) {
      const lp = prazo - 1;
      for (let i = 0; i < lp; i++) {
        const rv = vgvTotal / lp, iv = totalImpostos / lp;
        rec[i] = rv; recV[i] = rv; recE[i] = rv; recP[i] = 0; recJ[i] = 0;
        imp[i] = iv; impPis[i] = iv * pPis; impCof[i] = iv * pCof; impIr[i] = iv * pIr; impOut[i] = iv * pOut;
        desp[i] = totalDespesas / lp;
        dMkt[i] = marketing / lp; dCom[i] = comercial / lp; dAdm[i] = adm / lp;
        extraMkt.forEach((d, x) => { dX[x][i] = d.valor / lp; });
      }
    }
    if (soma(obr) === 0 && custoObrasTotal > 0) {
      const lp = prazo - 1;
      for (let i = 0; i < lp; i++) {
        const fi = Math.pow(1 + taxaIncc, i);
        obr[i] = (custoObrasTotal / lp) * fi;
        obrC[i] = (custoObras / lp) * fi; obrP[i] = (custoProjetos / lp) * fi; obrA[i] = (aquisicaoArea / lp) * fi; obrAd[i] = (admObras / lp) * fi;
        extraObr.forEach((d, x) => { obrX[x][i] = (d.valor / lp) * fi; });
      }
    }

    /* Tabela mês a mês (as mesmas colunas do Órion) */
    let df = [];
    for (let i = 0; i < prazo; i++) {
      const row = { Mes: i + 1, Receitas: rec[i], Receitas_Vendas: recV[i], Receitas_Entrada: recE[i], Receitas_Parcelas: recP[i], Receitas_Juros: recJ[i],
        Obras: obr[i], Obras_Custo: obrC[i], Obras_Proj: obrP[i], Obras_Aq: obrA[i], Obras_Adm: obrAd[i],
        Despesas: desp[i], Despesas_Mkt: dMkt[i], Despesas_Com: dCom[i], Despesas_Adm: dAdm[i],
        Impostos: imp[i], Impostos_PIS: impPis[i], Impostos_COFINS: impCof[i], Impostos_IRPJ_CSLL: impIr[i], Impostos_Outros: impOut[i],
        Terreno: i === 0 ? valorTerreno : 0, Funding_Entrada: 0, Funding_Despesas: 0, Funding_Amortizacao: 0 };
      extraObr.forEach((d, x) => { row["Obras_Extra_" + x] = obrX[x][i]; });
      extraMkt.forEach((d, x) => { row["Despesas_Extra_" + x] = dX[x][i]; });
      df.push(row);
    }

    const funding = fase.funding || null;
    if (funding && String(funding.tipo_funding || "") !== "Nenhum") {
      const [volume, estrut, recorr] = calcularCustosFunding(funding, custoObrasTotal, vgvTotal, fundingRates);
      if (volume > 0) df[0].Funding_Entrada = volume;
      if (TIPOS_FUNDING_COM_CRONOGRAMA.indexOf(funding.tipo_funding) >= 0 && volume > 0 && (funding.prazo_meses || 0) > 0) {
        const sis = ou(ga(funding, "sistema_amortizacao_banco", "SAC"), "SAC");
        const parc = cronogramaFunding(volume, taxaMensalFunding(funding), funding.prazo_meses, sis);
        if (parc.length + 1 > df.length) {
          const cols = Object.keys(df[0]);
          for (let i = df.length; i < parc.length + 1; i++) { const r = {}; cols.forEach((c) => { r[c] = 0; }); df.push(r); }
          df.forEach((r, i) => { r.Mes = i + 1; });
        }
        parc.forEach(([ju, am], j) => { df[1 + j].Funding_Despesas += ju + am; df[1 + j].Funding_Amortizacao += am; });
      }
      const custoFund = estrut + recorr;
      if (custoFund > 0) {
        if (ga(funding, "diluir_custos", false)) {
          let tot = 0;
          for (let i = 0; i < prazo; i++) if (obrasDist[i] > 0) tot += obrasDist[i];
          if (tot > 0) { for (let i = 0; i < prazo; i++) if (obrasDist[i] > 0) df[i].Funding_Despesas += custoFund * (obrasDist[i] / tot); }
          else df[0].Funding_Despesas += custoFund;
        } else df[0].Funding_Despesas += custoFund;
      }
    }
    const fluxo = (r) => r.Receitas - r.Obras - r.Despesas - r.Impostos - r.Terreno + r.Funding_Entrada - r.Funding_Despesas;
    df.forEach((r) => { r.Fluxo_de_Caixa = fluxo(r); });

    const tmaAnual = viab && verdade(viab.taxa_desconto_vpl) ? viab.taxa_desconto_vpl / 100 : 0.12;
    const tmaMensal = Math.pow(1 + tmaAnual, 1 / 12) - 1;

    function indicadores(d) {
      const cf = d.map((r) => r.Fluxo_de_Caixa);
      const S = (c) => d.reduce((s, r) => s + (r[c] || 0), 0);
      let tirM = irr(cf), tirA = null;
      if (tirM === null || !isFinite(tirM) || tirM <= -1) tirM = null; else tirA = (Math.pow(1 + tirM, 12) - 1) * 100;
      const vpl = cf.length ? npv(tmaMensal, cf) : 0;
      let mtirM = 0, mtirA = 0;
      const mv = mirr(cf, tmaMensal, tmaMensal);
      if (mv && !isNaN(mv)) { mtirA = (Math.pow(1 + mv, 12) - 1) * 100; mtirM = mv * 100; }
      let acc = 0;
      const acum = cf.map((v) => (acc += v));
      d.forEach((r, i) => { r.Caixa_Acumulado = acum[i]; });
      let idx = 0, mn = acum.length ? acum[0] : 0;
      acum.forEach((v, i) => { if (v < mn) { mn = v; idx = i; } });
      let expo = acum.length ? mn : 0;
      if (expo > 0) expo = 0;
      const periodo = acum.length ? idx + 1 : 0;
      const vida = cf.length;
      let payback = null;
      for (let j = Math.max(0, periodo - 1); j < vida; j++) if (acum[j] >= 0) { payback = j + 1; break; }
      const custoFin = S("Funding_Despesas") - S("Funding_Amortizacao");
      const lucro = S("Receitas") - S("Obras") - S("Despesas") - S("Impostos") - S("Terreno") - custoFin;
      const vgvCalc = S("Receitas");
      const margem = vgvCalc > 0 ? (lucro / vgvCalc) * 100 : 0;
      const invest = S("Obras") + S("Despesas") + S("Terreno");
      const expoInv = invest > 0 ? (Math.abs(expo) / invest) * 100 : 0;
      const expoVgv = vgvBruto > 0 ? (Math.abs(expo) / vgvBruto) * 100 : 0;
      const retCom = invest > 0 ? (lucro / invest) * 100 : 0;
      const recTot = S("Receitas"), recVend = S("Receitas_Vendas");
      const propV = recTot > 0 ? recVend / recTot : 1;
      const impV = S("Impostos") * propV;
      const lucroSem = recVend - invest - impV - custoFin;
      const retSem = invest > 0 ? (lucroSem / invest) * 100 : 0;
      return {
        vgv_total: vgvCalc, custo_obras: S("Obras"),
        dre_obras_infraestrutura: S("Obras_Custo"), dre_obras_projetos: S("Obras_Proj"), dre_obras_aquisicao: S("Obras_Aq"), dre_obras_adm: S("Obras_Adm"),
        dre_obras_extras: S("Obras") - S("Obras_Custo") - S("Obras_Proj") - S("Obras_Aq") - S("Obras_Adm"),
        custo_financeiro_funding: custoFin,
        dre_despesas_marketing: S("Despesas_Mkt"), dre_despesas_comercial: S("Despesas_Com"), dre_despesas_adm: S("Despesas_Adm"),
        dre_despesas_extras: S("Despesas") - S("Despesas_Mkt") - S("Despesas_Com") - S("Despesas_Adm"),
        custo_projetos: custoProjetos, aquisicao_area: aquisicaoArea, adm_obras: admObras, marketing, comercial, comissao: 0, adm_despesas: adm,
        valor_terreno: S("Terreno"), impostos: S("Impostos"),
        extra_constructions_total: soma(extraCons.map((e) => e.valor)), extra_expenses_total: soma(extraExp.map((e) => e.valor)),
        lucro_liquido: lucro, margem_perc: margem, tir_aa: tirA, tir_am: tirM !== null ? tirM * 100 : null,
        mtir_am: mtirM, mtir_aa: mtirA, vpl: isNaN(vpl) ? 0 : vpl, tma_aa: tmaAnual * 100,
        exposicao_maxima: expo, expo_inv: expoInv, expo_vgv: expoVgv, retorno_com_juros: retCom, retorno_sem_juros: retSem,
        periodo_exposicao: periodo, payback, vida
      };
    }

    const indGlobal = indicadores(df);

    /* Visões por parceiro */
    const abertura = (exc && jsonDe(ga(exc, "abertura_terrenistas_json", null))) || [];
    const percInv = ou(exc ? ga(exc, "perc_parceria_investidor", 0) : 0, 0);
    const parceiros = (abertura || []).map((p, i) => {
      const base = String(ou(p.nome, "") || `Parceiro ${i + 1}`).trim() || `Parceiro ${i + 1}`;
      const tipo = ou(p.tipo, "Proprietário");
      return { nome: `${base} (${tipo})`, tipo, perc: ou(p.percentual, 0) / 100 };
    });
    const somaEmp = soma(parceiros.filter((p) => p.tipo === "Empreendedor").map((p) => p.perc));
    const somaTot = soma(parceiros.map((p) => p.perc));
    const COLS_REC = ["Receitas", "Receitas_Vendas", "Receitas_Entrada", "Receitas_Parcelas", "Receitas_Juros", "Impostos", "Impostos_PIS", "Impostos_COFINS", "Impostos_IRPJ_CSLL", "Impostos_Outros", "Funding_Entrada", "Funding_Despesas", "Funding_Amortizacao"];
    const obrasRat = [["Obras_Custo", "custo_obras"], ["Obras_Proj", "custo_projetos"], ["Obras_Aq", "aquisicao_area"], ["Obras_Adm", "adm_obras"]].concat(extraObr.map((d, i) => [`Obras_Extra_${i}`, `extra_obra_${i}`]));
    const despRat = [["Despesas_Mkt", "marketing"], ["Despesas_Com", "comercial"], ["Despesas_Adm", "adm"]].concat(extraMkt.map((d, i) => [`Despesas_Extra_${i}`, `extra_despesa_${i}`]));
    function visao(fator, fatorNao) {
      const f = (k) => (ga(rateios, k, false) ? fator : fatorNao);
      return df.map((r) => {
        const v = Object.assign({}, r);
        COLS_REC.forEach((c) => { if (c in v) v[c] = r[c] * fator; });
        const agrupa = (tot, partes, resto) => {
          let s = 0, base = 0;
          partes.forEach(([c, k]) => { if (c in r) { v[c] = r[c] * f(k); s += v[c]; base += r[c]; } });
          v[tot] = s + (r[tot] - base) * f(resto);
        };
        agrupa("Obras", obrasRat, "custo_obras");
        agrupa("Despesas", despRat, "marketing");
        v.Terreno = r.Terreno * f("aquisicao_area");
        v.Fluxo_de_Caixa = fluxo(v);
        return v;
      });
    }
    const fatorEmp = parceiros.length && somaEmp > 0 ? somaEmp : Math.max(0, 1 - (percTerr + percInv) / 100);
    const dfEmp = visao(fatorEmp, 1);
    const indEmp = indicadores(dfEmp);
    const indParc = {}, fluxoParc = {};
    parceiros.forEach((p) => {
      const nao = p.tipo === "Empreendedor" && somaEmp > 0 ? p.perc / somaEmp : 0;
      const dp = visao(p.perc, nao);
      indParc[p.nome] = indicadores(dp);
      fluxoParc[p.nome] = dp;
    });
    let aviso = null;
    if (parceiros.length && Math.abs(somaTot - 1) > 1e-6) aviso = `A abertura de parceiros soma ${(somaTot * 100).toFixed(2)}% do projeto (deveria somar 100%).`;
    else if (parceiros.length && somaEmp <= 0) aviso = "Não há empreendedor na abertura: os custos não rateados não ficam com nenhum parceiro.";

    return { indicators: indGlobal, indicators_empreendedor: indEmp, monthly_cashflow: df, monthly_cashflow_empreendedor: dfEmp,
      monthly_cashflow_parceiros: fluxoParc, indicators_parceiros: indParc, aviso_parceiros: aviso, prazo };
  }

  /** Junta as tabelas exportadas do Órion (uma lista de linhas por tabela) numa fase pronta para calcular(). */
  function montarFases(t) {
    const porFase = (nome) => { const m = {}; (t[nome] || []).forEach((r) => { m[r.phase_id] = r; }); return m; };
    const rev = porFase("viability_revenues"), con = porFase("viability_constructions"), exp = porFase("viability_expenses");
    const tax = porFase("phase_taxes"), exc = porFase("phase_exchanges"), fun = porFase("phase_fundings");
    const viab = {}; (t.viabilities || []).forEach((v) => { viab[v.id] = v; });
    return (t.phases || []).map((p) => ({ id: p.id, nome: p.name, viabilidadeId: p.viability_id,
      viability: viab[p.viability_id] || null, revenue: rev[p.id] || null, construction: con[p.id] || null,
      expenses: exp[p.id] || null, taxes: tax[p.id] || null, exchanges: exc[p.id] || null, funding: fun[p.id] || null }));
  }

  const STATUS = ["Em Andamento", "Em Aprovação", "Aprovado"];

  /** Arquivos exportados ({tabela, linhas}) → um documento por viabilidade, com as fases e todas as abas dentro (dados agregados, sem mês a mês). */
  function prepararViabilidades(arquivos) {
    const t = {};
    (arquivos || []).forEach((a) => { if (a && a.tabela && Array.isArray(a.linhas)) t[a.tabela] = a.linhas; });
    if (!t.viabilities || !t.phases) return null;
    const porFase = (nome) => { const m = {}; (t[nome] || []).forEach((r) => { m[r.phase_id] = r; }); return m; };
    const extras = { physical_data: porFase("phase_physical_data"), dates: porFase("phase_dates") };
    const fases = montarFases(t);
    const limpa = (r) => { if (!r) return null; const o = Object.assign({}, r); delete o.id; delete o.phase_id; return o; };
    const docs = t.viabilities.map((v) => {
      const { id, parecer_original_ia, ...capa } = v;
      const fs = fases.filter((f) => f.viabilidadeId === id).sort((a, b) => a.id - b.id).map((f) => ({
        orion_id: f.id, nome: f.nome || "Fase", revenue: limpa(f.revenue), construction: limpa(f.construction), expenses: limpa(f.expenses),
        taxes: limpa(f.taxes), exchanges: limpa(f.exchanges), funding: limpa(f.funding),
        physical_data: limpa(extras.physical_data[f.id]), dates: limpa(extras.dates[f.id]) }));
      return Object.assign(capa, { _id: `orion_${id}`, orion_id: id, versao_de: v.version_of_id ? `orion_${v.version_of_id}` : null, fases: fs });
    });
    const semFase = docs.filter((d) => !d.fases.length).map((d) => d.project_name);
    const faltam = ["viability_revenues", "viability_constructions", "viability_expenses", "phase_taxes", "phase_exchanges", "phase_fundings"].filter((x) => !t[x]);
    return { docs, semFase, faltam };
  }

  /** Doc gravado no Integra → fase no formato do motor. */
  function faseDoDoc(doc, i) {
    const f = (doc.fases || [])[i];
    if (!f) return null;
    return { viability: doc, revenue: f.revenue, construction: f.construction, expenses: f.expenses, taxes: f.taxes, exchanges: f.exchanges, funding: f.funding };
  }

  /** Soma o fluxo de várias fases (mesmo mês 1) e calcula TIR, VPL, exposição e payback do conjunto. */
  function consolidar(resultados, tmaAnual) {
    const n = Math.max(0, ...resultados.map((r) => r.monthly_cashflow.length));
    const cf = new Array(n).fill(0);
    resultados.forEach((r) => r.monthly_cashflow.forEach((m, i) => { cf[i] += m.Fluxo_de_Caixa; }));
    const tma = Math.pow(1 + (tmaAnual == null ? 0.12 : tmaAnual), 1 / 12) - 1;
    const tir = irr(cf);
    let acc = 0, mn = 0, idx = 0;
    const acum = cf.map((v, i) => { acc += v; if (i === 0 || acc < mn) { mn = acc; idx = i; } return acc; });
    let payback = null;
    for (let j = idx; j < n; j++) if (acum[j] >= 0) { payback = j + 1; break; }
    const S = (k) => soma(resultados.map((r) => r.indicators[k] || 0));
    const vgv = S("vgv_total"), lucro = S("lucro_liquido");
    return { vgv_total: vgv, lucro_liquido: lucro, margem_perc: vgv > 0 ? (lucro / vgv) * 100 : 0,
      tir_aa: tir === null || tir <= -1 ? null : (Math.pow(1 + tir, 12) - 1) * 100, vpl: npv(tma, cf),
      exposicao_maxima: Math.min(0, mn), payback, fluxo: cf, acumulado: acum };
  }

  /** DRE do resumo do Órion (SummaryTab), a partir do fluxo mensal de uma visão. */
  function dre(fluxo) {
    const S = (c) => (fluxo || []).reduce((s, m) => s + (m[c] || 0), 0);
    const rec = S("Receitas"), pis = S("Impostos_PIS"), cof = S("Impostos_COFINS"), out = S("Impostos_Outros"), ir = S("Impostos_IRPJ_CSLL");
    const obras = S("Obras"), terreno = S("Terreno"), desp = S("Despesas");
    const fin = S("Funding_Despesas") - S("Funding_Amortizacao");
    const liq = rec - (pis + cof + out);
    const mb = liq - (obras + terreno);
    const lo = mb - (desp + fin);
    const ll = rec - S("Impostos") - obras - terreno - desp - fin;
    const p = (v) => (liq > 0 ? (v / liq) * 100 : 0);
    const L = (nome, valor, nivel, extra) => Object.assign({ nome, valor, nivel }, extra || {});
    return [
      L("Receita bruta", rec, 1), L("Receita de vendas", S("Receitas_Vendas"), 2), L("Receita de juros e correção", S("Receitas_Juros"), 2),
      L("Redutor da receita", -(pis + cof + out), 1), L("PIS", -pis, 2), L("COFINS", -cof, 2), L("Outros impostos", -out, 2),
      L("Receita líquida", liq, 0),
      L("Custo", -(obras + terreno), 1), L("Terreno / permuta financeira", -terreno, 2), L("Aquisição de área", -S("Obras_Aq"), 2),
      L("Projetos", -S("Obras_Proj"), 2), L("Obras de infraestrutura", -S("Obras_Custo"), 2), L("Administração da obra", -S("Obras_Adm"), 2),
      L("Custos extras de obras", -(obras - S("Obras_Custo") - S("Obras_Proj") - S("Obras_Aq") - S("Obras_Adm")), 2),
      L("Margem bruta", mb, 0, { perc: p(mb) }),
      L("Despesas operacionais", -desp, 1), L("Marketing", -S("Despesas_Mkt"), 2), L("Comercial", -S("Despesas_Com"), 2), L("Administrativas", -S("Despesas_Adm"), 2),
      L("Despesas extras", -(desp - S("Despesas_Mkt") - S("Despesas_Com") - S("Despesas_Adm")), 2),
      L("Funding (juros e estruturação)", -fin, 1),
      L("Lucro operacional", lo, 0, { perc: p(lo) }),
      L("IRPJ / CSLL", -ir, 1),
      L("Lucro líquido", ll, 0, { perc: p(ll) })
    ];
  }

  return { STATUS, prepararViabilidades, dre, faseDoDoc, consolidar, calcular, montarFases, irr, npv, mirr, acelerarCurva, extrairCurva, aplicarOffset, parseCondicoes, calcularCustosFunding, cronogramaFunding, taxaMensalFunding, pyRound };
});
