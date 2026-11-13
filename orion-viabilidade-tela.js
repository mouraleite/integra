/* Órion (transição) › Viabilidades — tela igual à do ML Órion (dashboard/viabilities e dashboard/viabilities/[id]).
 * Lista em cartões (projeto + cenários), cabeçalho do projeto (cenário, status, obra no acompanhamento, Gerar novo cenário,
 * fluxo de aprovação, Tem múltiplas fases?, Taxa VPL/AVP) e as 13 abas do Órion na mesma ordem:
 * Dados Físicos, Datas, Permutas, Receitas, Obras, Despesas, Curvas, Impostos, Funding, Documentos, Parecer Executivo, Resumo e Comparativo.
 * Cada aba tem o próprio botão Salvar, como no Órion; o que muda no topo (status, taxa, índices) grava na hora.
 * Banco: orion_viabilidades (um documento por viabilidade, fases dentro de fases_json). Cadastros (curvas, planos de pagamento,
 * regimes, índices projetados, cenários, taxas de funding) vêm de Configurações gerais › Premissas da viabilidade.
 * Este arquivo: base da tela, lista, cabeçalho e as abas Dados Físicos, Datas, Permutas e Receitas.
 * Continua em orion-viabilidade-tela2.js (Obras, Despesas, Curvas, Impostos, Funding, Documentos, Parecer, Resumo, Comparativo). */
(function () {
  const A = window.OrionViabilidadesApp;
  if (!A) return;

  const ABAS = ["Dados Físicos", "Datas", "Permutas", "Receitas", "Obras", "Despesas", "Curvas", "Impostos", "Funding", "Documentos", "Parecer Executivo", "Resumo", "Comparativo"];
  const PARTE_DA_ABA = { "Dados Físicos": ["physical_data"], "Datas": ["dates"], "Permutas": ["exchanges"], "Receitas": ["revenue"], "Obras": ["construction"], "Despesas": ["expenses"], "Impostos": ["taxes"], "Funding": ["funding"] };
  const PADRAO = {
    physical_data: { codigo_projeto: "", tipo_projeto: "", cenario: "Neutro", area_total: 0, area_lotes_residenciais: 0, area_lotes_comerciais: 0, area_lotes_mistos: 0, area_sistema_viario: 0, area_institucional: 0, area_verde: 0, sistema_lazer: 0, area_associacao: 0, qtde_lotes_residenciais: 0, qtde_lotes_comerciais: 0, qtde_lotes_mistos: 0, valor_venda_residencial_m2: 0, valor_venda_comercial_m2: 0, valor_venda_misto_m2: 0 },
    dates: { data_registro: "", data_lancamento: "", data_inicio_obras: "", data_inicio_projetos: "", data_inicio_aquisicao: "", data_inicio_comercial: "", data_inicio_mkt: "" },
    exchanges: { modalidade: "Dinheiro", perc_permuta_financeira: 0, valor_terreno_fixo: 0, perc_area_terrenista: 100, perc_area_investidor: 0, perc_area_empreendedor: 0, perc_parceria_terrenista: 38.5, perc_parceria_investidor: 0, perc_parceria_empreendedor: 61.5, permuta_fisica_unidades: 0, permuta_fisica_valor_unidade: 0, abertura_terrenistas_json: [], rateios_config_json: {} },
    revenue: { vgv_total: 0, velocidade_vendas_json: { meses: [] }, plano_ativo: "", condicoes_pagamento_json: [], sistema_amortizacao: "Sem Juros", taxa_juros_vendas: 0, indice_correcao_id: null, taxa_correcao_projetada: null, tipo_correcao_projetada: "% a.a." },
    construction: { custo_obras: 0, custo_obras_tipo: "R$", custo_projetos: 0, custo_projetos_tipo: "%", aquisicao_area: 0, aquisicao_area_tipo: "R$", adm_obras: 0, adm_obras_tipo: "%", curva_obras_json: { meses: [] }, curva_projetos_json: { meses: [] }, curva_aquisicao_json: { meses: [] }, curva_adm_obras_json: { meses: [] }, extra_constructions_json: [] },
    expenses: { marketing_valor: 5, marketing_tipo: "%", comercial_valor: 4, comercial_tipo: "%", comissao_corretagem_valor: 0, adm_valor: 3, adm_tipo: "%", curva_marketing_json: { meses: [] }, curva_comercial_json: { meses: [] }, curva_adm_json: { meses: [] }, extra_expenses_json: [] },
    taxes: { regime_tributario: "RET", aliquota_pis: 0.65, aliquota_cofins: 3, aliquota_irpj: 0, aliquota_csll: 0, aliquota_outros: 0, aliquota_total: 3.65, incidencia_sobre: "Recebimento" },
    funding: { tipo_funding: "Plano Empresarial (Banco)", percentual_obra_financiado: 0, modo_volume: "percentual", volume_fixo: 0, taxa_juros: 0, indexador: "CDI", prazo_meses: 36, securitizadora: "Opea", estrutura_cri: "Guarda-Chuva", icvm: "ICVM 400", gross_up: 9.65, taxa_estruturacao: 0, diluir_custos: false, sistema_amortizacao_banco: "SAC", taxa_juros_periodicidade: "a.a." }
  };
  /* Número digitado no padrão brasileiro (1.234,56) ou com ponto decimal (1234.56). */
  const NUM = (v) => {
    if (typeof v === "number") return v;
    const t = String(v == null ? "" : v).trim().replace(/\s/g, "").replace("%", "").replace("R$", "");
    if (!t) return 0;
    const n = Number(t.indexOf(",") >= 0 ? t.replace(/\./g, "").replace(",", ".") : ((t.match(/\./g) || []).length > 1 || /^-?\d{1,3}\.\d{3}$/.test(t) ? t.replace(/\./g, "") : t));
    return Number.isFinite(n) ? n : 0;
  };
  const clone = (o) => JSON.parse(JSON.stringify(o == null ? null : o));
  const jsonDe = (v, padrao) => { if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return padrao; } } return v == null ? padrao : v; };
  const BRL = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const vgvDe = (p) => (Number(p.area_lotes_residenciais) || 0) * (Number(p.valor_venda_residencial_m2) || 0) + (Number(p.area_lotes_comerciais) || 0) * (Number(p.valor_venda_comercial_m2) || 0) + (Number(p.area_lotes_mistos) || 0) * (Number(p.valor_venda_misto_m2) || 0);
  const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  A.TELA_ORION = { ABAS, PADRAO, NUM, clone, jsonDe, BRL, vgvDe, semAcento };

  Object.assign(A, {
    ov: null, // estado da tela: { aba, rasc, modal, colunas, metodo, msg, parecerEditando, ... }

    estilosTela() {
      if (document.getElementById("ovt-estilos")) return;
      const st = document.createElement("style");
      st.id = "ovt-estilos";
      st.textContent = `
        #orion-viabilidades-root { --ovt-verde:#2E864D; --ovt-escuro:#255742; --ovt-borda:#e2e8f0; --ovt-texto:#0f172a; --ovt-cinza:#64748b; }
        .ovt-cab { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; border-bottom:1px solid var(--ovt-borda); padding-bottom:16px; margin-bottom:16px; }
        .ovt-voltar { border:none; background:none; color:#64748b; border-radius:999px; width:36px; height:36px; cursor:pointer; font-size:20px; }
        .ovt-voltar:hover { background:#f1f5f9; }
        .ovt-titulo { font-size:1.5rem; font-weight:700; color:var(--ovt-texto); letter-spacing:-0.01em; }
        select.ovt-titulo { border:none; background:transparent; cursor:pointer; padding:2px 28px 2px 6px; margin-left:-6px; appearance:none; -webkit-appearance:none; outline:none; max-width:720px; }
        .ovt-pill { padding:2px 8px; border-radius:999px; font-size:0.75rem; font-weight:600; border:0; }
        .ovt-pill.ap { background:#dcfce7; color:#15803d; } .ovt-pill.ea { background:#fef3c7; color:#b45309; } .ovt-pill.ou { background:#f1f5f9; color:#334155; } .ovt-pill.nv { background:#e7f3ec; color:#255742; }
        .ovt-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:34px; padding:0 12px; border-radius:6px; font-size:0.82rem; font-weight:600; cursor:pointer; border:1px solid transparent; white-space:nowrap; background:#fff; }
        .ovt-btn:disabled { opacity:.5; cursor:not-allowed; }
        .ovt-btn.prim { background:var(--ovt-verde); color:#fff; } .ovt-btn.prim:hover:not(:disabled) { background:var(--ovt-escuro); }
        .ovt-btn.out { border-color:#cbd5e1; color:#334155; } .ovt-btn.out:hover:not(:disabled) { background:#f8fafc; }
        .ovt-btn.outv { border-color:var(--ovt-verde); color:var(--ovt-escuro); } .ovt-btn.outv:hover { background:#e7f3ec; }
        .ovt-btn.red { border-color:#fecaca; color:#dc2626; } .ovt-btn.red:hover { background:#fef2f2; }
        .ovt-btn.azul { background:#2563eb; color:#fff; } .ovt-btn.ambar { background:#f59e0b; color:#fff; } .ovt-btn.verde { background:#16a34a; color:#fff; }
        .ovt-btn.big { height:40px; padding:0 22px; font-size:0.88rem; }
        .ovt-abas { display:flex; overflow-x:auto; border-bottom:1px solid var(--ovt-borda); margin-bottom:16px; }
        .ovt-aba { white-space:nowrap; padding:12px 22px; font-weight:500; font-size:0.88rem; border:none; border-bottom:2px solid transparent; background:none; color:#64748b; cursor:pointer; }
        .ovt-aba:hover { color:#334155; border-bottom-color:#cbd5e1; } .ovt-aba.on { color:var(--ovt-verde); border-bottom-color:var(--ovt-verde); }
        .ovt-corpo { background:#fff; border:1px solid #f1f5f9; border-radius:12px; box-shadow:0 1px 2px rgba(15,23,42,.06); min-height:500px; }
        .ovt-pad { padding:28px 32px; }
        .ovt-h2 { font-size:1.25rem; font-weight:700; color:var(--ovt-texto); margin:0; }
        .ovt-sub { font-size:0.85rem; color:var(--ovt-cinza); margin:2px 0 0; }
        .ovt-h3 { font-size:0.8rem; font-weight:700; color:var(--ovt-texto); text-transform:uppercase; letter-spacing:.05em; border-bottom:1px solid var(--ovt-borda); padding-bottom:8px; margin:0 0 14px; }
        .ovt-h3n { font-size:1.1rem; font-weight:600; color:#1e293b; border-bottom:1px solid var(--ovt-borda); padding-bottom:8px; margin:0 0 16px; }
        .ovt-lbl { display:block; font-size:0.85rem; font-weight:500; color:#334155; margin-bottom:4px; }
        .ovt-lbl.xs { font-size:0.75rem; }
        .ovt-in { width:100%; height:40px; box-sizing:border-box; border:1px solid #cbd5e1; border-radius:6px; padding:0 12px; font-size:0.88rem; color:var(--ovt-texto); background:#fff; }
        .ovt-in:focus { outline:none; border-color:var(--ovt-verde); box-shadow:0 0 0 1px var(--ovt-verde); }
        .ovt-in:disabled { background:#f8fafc; color:#64748b; }
        .ovt-in.sm { height:32px; font-size:0.8rem; padding:0 8px; }
        .ovt-g { display:grid; gap:16px; } .ovt-g2 { grid-template-columns:repeat(2,minmax(0,1fr)); } .ovt-g3 { grid-template-columns:repeat(3,minmax(0,1fr)); } .ovt-g4 { grid-template-columns:repeat(4,minmax(0,1fr)); }
        .ovt-c2 { grid-column:span 2; }
        @media (max-width:900px) { .ovt-g2,.ovt-g3,.ovt-g4 { grid-template-columns:1fr; } .ovt-c2 { grid-column:auto; } }
        .ovt-badge { position:absolute; right:8px; top:50%; transform:translateY(-50%); font-size:0.72rem; font-weight:600; color:#64748b; background:#f1f5f9; border:1px solid var(--ovt-borda); border-radius:4px; padding:1px 6px; }
        .ovt-info { padding:8px; background:rgba(255,247,237,.6); border:1px solid rgba(255,237,213,.8); border-radius:8px; }
        .ovt-box { background:#f8fafc; border:1px solid var(--ovt-borda); border-radius:8px; padding:20px; }
        .ovt-verdebox { background:rgba(46,134,77,.1); border:1px solid rgba(46,134,77,.25); border-radius:8px; padding:12px; }
        .ovt-msg { font-size:0.85rem; color:#16a34a; font-weight:500; }
        .ovt-sw { position:relative; display:inline-flex; width:44px; height:24px; border-radius:999px; background:#cbd5e1; border:none; cursor:pointer; padding:0; flex-shrink:0; }
        .ovt-sw::after { content:""; position:absolute; top:4px; left:4px; width:16px; height:16px; border-radius:999px; background:#fff; transition:transform .15s; box-shadow:0 1px 2px rgba(0,0,0,.2); }
        .ovt-sw.on { background:var(--ovt-verde); } .ovt-sw.on::after { transform:translateX(20px); }
        .ovt-sw:disabled { opacity:.5; cursor:not-allowed; }
        .ovt-tab { width:100%; border-collapse:collapse; font-size:0.85rem; }
        .ovt-tab th { background:#f8fafc; color:#64748b; font-size:0.72rem; text-transform:uppercase; font-weight:500; padding:10px 16px; text-align:left; }
        .ovt-tab td { padding:10px 16px; border-top:1px solid #f1f5f9; color:#334155; }
        .ovt-tab tr:hover td { background:#f8fafc; }
        .ovt-r { text-align:right !important; } .ovt-ct { text-align:center !important; }
        .ovt-modal-fundo { position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:9000; display:flex; align-items:center; justify-content:center; padding:16px; }
        .ovt-modal { background:#fff; border-radius:12px; box-shadow:0 20px 50px rgba(0,0,0,.25); width:100%; max-width:960px; max-height:90vh; display:flex; flex-direction:column; overflow:hidden; }
        .ovt-modal-cab { padding:16px 24px; border-bottom:1px solid var(--ovt-borda); background:#f8fafc; display:flex; justify-content:space-between; align-items:center; }
        .ovt-cards { display:grid; gap:24px; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); }
        .ovt-card { background:#fff; border:1px solid var(--ovt-borda); border-radius:10px; padding:24px; cursor:pointer; display:flex; flex-direction:column; transition:all .15s; }
        .ovt-card:hover { border-color:#22c55e; box-shadow:0 4px 12px rgba(15,23,42,.08); }
        .ovt-cen { font-size:0.85rem; color:#475569; background:#f8fafc; padding:8px; border-radius:4px; display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; cursor:pointer; }
        .ovt-cen:hover { background:#f1f5f9; color:#15803d; }
        .ovt-fases { display:flex; align-items:center; gap:8px; padding:12px; background:#f8fafc; border:1px solid var(--ovt-borda); border-radius:8px; margin-bottom:16px; flex-wrap:wrap; }
      `;
      document.head.appendChild(st);
    },

    /* ---------- dados de apoio (Premissas da viabilidade e Índices de mercado do Integra) ---------- */
    async carregarApoio() {
      if (this.apoio) return this.apoio;
      const ler = async (k, p) => { try { return (await window.OrionStore.ler(k, p)).itens || p; } catch (e) { return p; } };
      const [curvas, planos, regimes, indices, obras] = await Promise.all([ler("curvas", []), ler("planos_pagamento", []), ler("regimes", []), ler("indices_projetados", []), ler("acompanhamento_obras", [])]);
      this.apoio = { curvas, planos, regimes, indices, obras, real: {}, focus: [] };
      this.carregarMercado();
      return this.apoio;
    },
    /** Índices reais do Banco Central (último mês de IPCA e INCC) e projeção Focus do ano (IPCA e IGP-M), como o Órion mostra. */
    async carregarMercado() {
      const C = window.IndicesMercadoCalc, ap = this.apoio;
      const get = async (u) => { try { const r = await fetch(u); if (!r.ok) return null; const j = await r.json(); return Array.isArray(j) && j.length ? j : null; } catch (e) { return null; } };
      const ini = encodeURIComponent("01/01/" + (new Date().getFullYear() - 1));
      const [ipca, incc, fIpca, fIgpm] = await Promise.all([get(`/api/bcb-sgs?code=433&dataInicial=${ini}`), get(`/api/bcb-sgs?code=7456&dataInicial=${ini}`), get("/api/bcb-sgs?focus=IPCA"), get("/api/bcb-sgs?focus=IGP-M")]);
      const ult = (j) => { if (!j) return null; const u = j[j.length - 1]; return { mensal: NUM(u.valor), data: String(u.data || "") }; };
      ap.real = { ipca: ult(ipca), incc: ult(incc) };
      const ano = new Date().getFullYear();
      const foc = [];
      [["IPCA", fIpca], ["IGP-M", fIgpm]].forEach(([n, j]) => { const f = j && C ? C.focusDoAno(j, ano) : null; if (f) foc.push({ index_type: n, valor: f.mediana }); });
      ap.focus = foc;
      if (this.aberto && this.apoio === ap) this.render();
    },
    curvaId(c) { return c && c.orion_id != null ? c.orion_id : c ? c.nome : ""; },
    indiceId(x, i) { return x && x.orion_id != null ? x.orion_id : "i" + i; },

    /* ---------- estado da tela ---------- */
    iniciarTela() { this.ov = { aba: this.ov && this.ov.docId === (this.aberto && this.aberto.doc._id) ? this.ov.aba : 0, rasc: {}, docId: this.aberto ? this.aberto.doc._id : null, colunas: 36, metodo: "proporcional", msg: {}, modal: null, parecerEditando: false, ocultas: {}, comparar: true }; },
    faseAtual() { return this.fasesDe(this.aberto.doc)[this.aberto.fase] || {}; },
    chaveR(parte) { return `${this.aberto.doc._id}|${this.aberto.fase}|${parte}`; },
    /** Cópia editável de uma parte da fase (como o estado "data" de cada aba do Órion). */
    r(parte) {
      const k = this.chaveR(parte);
      if (!this.ov.rasc[k]) {
        const f = this.faseAtual();
        const d = Object.assign(clone(PADRAO[parte] || {}), clone(f[parte] || {}) || {});
        Object.keys(d).forEach((c) => { if (/_json$/.test(c) && typeof d[c] === "string") d[c] = jsonDe(d[c], null); });
        if (parte === "physical_data") { d._nome = this.aberto.doc.project_name || ""; d._cidade = this.aberto.doc.city || ""; }
        if (parte === "revenue") { d.vgv_total = vgvDe(f.physical_data || {}) || Number(d.vgv_total) || 0; if (!d.velocidade_vendas_json) d.velocidade_vendas_json = { meses: [] }; }
        if (parte === "construction") ["curva_obras_json", "curva_projetos_json", "curva_aquisicao_json", "curva_adm_obras_json"].forEach((c) => { if (!d[c]) d[c] = { meses: [] }; });
        if (parte === "expenses") ["curva_marketing_json", "curva_comercial_json", "curva_adm_json"].forEach((c) => { if (!d[c]) d[c] = { meses: [] }; });
        if (parte === "exchanges") { if (!Array.isArray(d.abertura_terrenistas_json)) d.abertura_terrenistas_json = []; if (!d.rateios_config_json || typeof d.rateios_config_json !== "object") d.rateios_config_json = {}; }
        this.ov.rasc[k] = { d, o: JSON.stringify(d) };
      }
      return this.ov.rasc[k].d;
    },
    sujoParte(parte) { const x = this.ov.rasc[this.chaveR(parte)]; return !!x && JSON.stringify(x.d) !== x.o; },
    sujo() { const p = PARTE_DA_ABA[ABAS[this.ov.aba]] || []; return p.some((x) => this.sujoParte(x)) || (ABAS[this.ov.aba] === "Parecer Executivo" && this.ov.parecer != null && this.ov.parecer !== (this.aberto.doc.parecer_executivo || "")); },
    descartar() { const p = PARTE_DA_ABA[ABAS[this.ov.aba]] || []; p.forEach((x) => delete this.ov.rasc[this.chaveR(x)]); this.ov.parecer = null; },
    podeSair(msg) { if (!this.sujo()) return true; if (!window.confirm(msg || "Você tem alterações não salvas nesta aba. Deseja sair sem salvar?")) return false; this.descartar(); return true; },
    irAba(i) { if (i === this.ov.aba || !this.podeSair()) return; this.ov.aba = i; this.ov.msg = {}; this.render(); },
    irFase(i) { if (i === this.aberto.fase || !this.podeSair()) return; this.aberto.fase = i; this.ov.msg = {}; this.render(); },
    voltarLista() { if (!this.podeSair("Você tem alterações não salvas. Deseja sair sem salvar?")) return; this.ov = null; this.aberto = null; this.aviso = ""; this.render(); },
    abrirCenario(id) { if (!this.podeSair("Alterações não salvas serão perdidas. Continuar?")) return; this.abrir(id); },
    /** Muda um campo da cópia; tipo: num, int, txt, bool, numnull. Recalcula a tela mantendo o cursor no campo. */
    vs(parte, campo, valor, tipo) {
      const d = this.r(parte);
      d[campo] = tipo === "num" ? NUM(valor) : tipo === "int" ? Math.trunc(NUM(valor)) : tipo === "bool" ? !!valor : tipo === "numnull" ? (String(valor).trim() === "" ? null : NUM(valor)) : String(valor == null ? "" : valor);
      this.rr();
    },
    rr() {
      const el = document.activeElement;
      const k = el && el.getAttribute && el.getAttribute("data-k");
      this.render();
      if (k) { const n = document.querySelector(`#orion-viabilidades-root [data-k="${k}"]`); if (n) { n.focus(); try { if (n.setSelectionRange && n.type === "text") n.setSelectionRange(n.value.length, n.value.length); } catch (e) { /* campo sem cursor */ } } }
    },
    msg(parte, t) { this.ov.msg[parte] = t; this.render(); setTimeout(() => { if (this.ov && this.ov.msg[parte] === t) { this.ov.msg[parte] = ""; this.render(); } }, 3000); },
    leitura() { return !this.podeEditar(); },

    /* ---------- gravação (em transação; cada aba grava só a parte dela, como no Órion) ---------- */
    async gravarDoc(fn) {
      const fc = this.fc();
      const id = this.aberto.doc._id;
      const ref = fc.doc(window.firebaseDb, this.COL, id);
      const quem = window.OrionStore ? window.OrionStore.usuario() : "";
      let novo = null;
      await fc.runTransaction(window.firebaseDb, async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists()) throw new Error("Esta viabilidade não existe mais. Volte para a lista e clique em Atualizar.");
        const atual = s.data();
        let fases = [];
        try { fases = JSON.parse(atual.fases_json || "[]"); } catch (e) { fases = []; }
        const capa = fn(fases, atual) || {};
        novo = Object.assign({}, atual, capa, { fases_json: JSON.stringify(fases), qtd_fases: fases.length, versao: (Number(atual.versao) || 0) + 1, atualizado_por: quem, atualizado_em: new Date().toISOString() });
        tx.set(ref, novo);
      });
      novo._id = id;
      const i = (this.lista || []).findIndex((x) => x._id === id);
      if (i >= 0) this.lista[i] = novo;
      this.aberto.doc = novo;
      this.cache = {};
      return novo;
    },
    async salvarPartes(partes, rotulo) {
      if (this.leitura()) return;
      const fi = this.aberto.fase;
      const dados = {};
      partes.forEach((p) => { const d = clone(this.r(p)); delete d._nome; delete d._cidade; dados[p] = d; });
      const fisico = this.r("physical_data");
      this.ov.salvando = rotulo;
      this.render();
      try {
        await this.gravarDoc((fases) => {
          const f = fases[fi];
          if (!f) throw new Error("Fase não encontrada. Volte para a lista e clique em Atualizar.");
          Object.keys(dados).forEach((p) => { f[p] = dados[p]; });
          if (dados.physical_data) f.revenue = Object.assign({}, f.revenue || {}, { vgv_total: vgvDe(dados.physical_data) });
          if (dados.taxes) f.taxes.aliquota_total = ["aliquota_pis", "aliquota_cofins", "aliquota_irpj", "aliquota_csll", "aliquota_outros"].reduce((s, k) => s + (Number(f.taxes[k]) || 0), 0);
          if (dados.physical_data) return { project_name: fisico._nome, city: fisico._cidade };
          return null;
        });
        partes.forEach((p) => delete this.ov.rasc[this.chaveR(p)]);
        if (partes.indexOf("physical_data") >= 0) delete this.ov.rasc[this.chaveR("revenue")];
        this.ov.salvando = "";
        return true;
      } catch (e) {
        this.ov.salvando = "";
        window.alert("Erro ao salvar: " + (e.message || String(e)));
        this.render();
        return false;
      }
    },
    async gravarCapa(campos, aviso) {
      if (this.leitura()) return;
      try { await this.gravarDoc(() => campos); } catch (e) { window.alert((aviso || "Erro ao salvar campo global.") + " " + (e.message || "")); }
      this.render();
    },

    /* ---------- cabeçalho do projeto ---------- */
    async mudarStatusOrion(novo) {
      if (this.leitura()) return;
      const quem = window.OrionStore ? window.OrionStore.usuario() : "";
      try {
        await this.gravarDoc((fases, atual) => ({ status: novo, historico_status: (atual.historico_status || []).concat([{ de: atual.status, para: novo, por: quem, em: new Date().toISOString() }]) }));
      } catch (e) { window.alert("Erro ao alterar o status do projeto. " + (e.message || "")); }
      this.render();
    },
    familiaToda(doc) {
      const raiz = doc.versao_de || doc._id;
      return (this.lista || []).filter((x) => !x.excluido && (x._id === raiz || x.versao_de === raiz)).sort((a, b) => String(a.created_at || a.criado_em || a.importado_em || "").localeCompare(String(b.created_at || b.criado_em || b.importado_em || "")) || (a._id === raiz ? -1 : 1));
    },
    async gerarNovoCenario() {
      if (this.leitura()) return;
      if (this.sujo() && !window.confirm("Você tem alterações não salvas na aba atual que não serão incluídas no novo cenário. Deseja continuar?")) return;
      const nome = window.prompt("Digite um nome para o novo cenário (ou deixe em branco para o padrão):");
      if (nome === null) return;
      await this.clonarDoc(this.aberto.doc, nome);
    },
    /** Igual ao Órion: "dd/mm/aaaa - nome", status Em Andamento, versão da viabilidade de origem. */
    async clonarDoc(d, nome) {
      const base = String(nome || "").trim() || d.project_name;
      const capa = clone(d);
      ["_id", "fases", "fases_json", "versao", "historico_status", "atualizado_por", "atualizado_em", "importado_em", "importado_por", "orion_id", "fotos", "excluido", "excluido_em", "excluido_por"].forEach((k) => delete capa[k]);
      Object.assign(capa, { project_name: `${new Date().toLocaleDateString("pt-BR")} - ${base}`, status: "Em Andamento", versao_de: d.versao_de || d._id, created_at: new Date().toISOString() });
      const fases = clone(this.fasesDe(d)).map((f) => { delete f.orion_id; return f; });
      try {
        this.ov = null;
        await this.criarDoc(capa, fases);
      } catch (e) { window.alert("Erro ao gerar novo cenário. " + (e.message || "")); }
    },
    async excluirCenario() {
      if (this.leitura() || !this.aberto.doc.versao_de) return;
      if (!window.confirm("Tem certeza que deseja excluir este cenário? Ele sai das listas e do comparativo.")) return;
      const quem = window.OrionStore ? window.OrionStore.usuario() : "";
      const volta = this.aberto.doc.versao_de;
      try {
        // o documento fica guardado marcado como excluído (não apaga do banco), só some das telas
        await this.gravarDoc(() => ({ excluido: true, excluido_em: new Date().toISOString(), excluido_por: quem }));
        this.ov = null;
        if ((this.lista || []).some((x) => x._id === volta && !x.excluido)) this.abrir(volta); else { this.aberto = null; this.render(); }
      } catch (e) { window.alert("Erro ao excluir cenário. " + (e.message || "")); }
    },
    async excluirViabilidade(id) {
      if (this.leitura()) return;
      if (!window.confirm("Tem certeza que deseja excluir esta viabilidade? Ela sai das listas e do comparativo.")) return;
      const d = (this.lista || []).find((x) => x._id === id);
      if (!d) return;
      const quem = window.OrionStore ? window.OrionStore.usuario() : "";
      const fc = this.fc();
      try {
        await fc.runTransaction(window.firebaseDb, async (tx) => {
          const ref = fc.doc(window.firebaseDb, this.COL, id);
          const s = await tx.get(ref);
          if (!s.exists()) return;
          tx.set(ref, Object.assign({}, s.data(), { excluido: true, excluido_em: new Date().toISOString(), excluido_por: quem, versao: (Number(s.data().versao) || 0) + 1 }));
        });
        await this.carregar();
      } catch (e) { window.alert("Erro ao excluir viabilidade. " + (e.message || "")); }
    },
    async duplicarDaLista(id) {
      const d = (this.lista || []).find((x) => x._id === id);
      if (!d || this.leitura()) return;
      const nome = window.prompt("Digite um nome para o novo cenário (ou deixe em branco para o padrão):");
      if (nome === null) return;
      const atual = this.aberto;
      await this.clonarDoc(d, nome);
      if (!atual) { this.aberto = null; this.ov = null; this.render(); }
    },
    async alternarMultiplasFases() {
      if (this.leitura()) return;
      await this.gravarCapa({ tem_multiplas_fases: !this.aberto.doc.tem_multiplas_fases }, "Erro ao salvar configuração.");
    },
    async adicionarFase() {
      if (this.leitura() || !this.podeSair()) return;
      const n = this.fasesDe(this.aberto.doc).length + 1;
      const nome = (window.prompt("Nome da nova fase:", `Fase ${n}`) || "").trim();
      if (!nome) return;
      try {
        await this.gravarDoc((fases) => { fases.push({ nome, revenue: clone(PADRAO.revenue), construction: clone(PADRAO.construction), expenses: clone(PADRAO.expenses), taxes: clone(PADRAO.taxes), exchanges: clone(PADRAO.exchanges), funding: Object.assign(clone(PADRAO.funding), { tipo_funding: "Nenhum" }), physical_data: clone(PADRAO.physical_data), dates: {} }); return null; });
        this.aberto.fase = this.fasesDe(this.aberto.doc).length - 1;
      } catch (e) { window.alert("Erro ao adicionar fase. " + (e.message || "")); }
      this.render();
    },
    async salvarTaxaVpl(v) {
      const n = NUM(v) || 12;
      if (n === Number(this.aberto.doc.taxa_desconto_vpl)) return;
      await this.gravarCapa({ taxa_desconto_vpl: n }, "Erro ao salvar campo global.");
    },
    async salvarObra(cc) {
      const o = ((this.apoio && this.apoio.obras) || []).find((x) => String(x.cc) === String(cc));
      await this.gravarCapa({ obra_cc: cc || "", obra_cc_nome: o ? o.nome || "" : "" }, "Erro ao salvar campo global.");
    },

    htmlCabecalho() {
      const d = this.aberto.doc, e = (s) => this.esc(s), ro = this.leitura();
      const fam = this.familiaToda(d);
      const raiz = d.versao_de || d._id;
      const titulo = fam.length > 1
        ? `<div style="display:flex;align-items:center"><select class="ovt-titulo" onchange="OrionViabilidadesApp.abrirCenario(this.value)">${fam.map((s) => `<option value="${e(s._id)}" ${s._id === d._id ? "selected" : ""} style="font-size:1rem;font-weight:400">${e(s.project_name)} ${s._id === raiz ? "(Cenário Original)" : ""}</option>`).join("")}</select><span style="margin-left:-24px;pointer-events:none;color:#94a3b8">▾</span></div>`
        : `<div class="ovt-titulo">${e(d.project_name)}</div>`;
      const cls = d.status === "Aprovado" ? "ap" : d.status === "Em Aprovação" ? "ea" : "ou";
      const status = ro ? `<span class="ovt-pill ${cls}">${e(d.status)}</span>`
        : `<select class="ovt-pill ${cls}" style="cursor:pointer" onchange="OrionViabilidadesApp.mudarStatusOrion(this.value)">${["Rascunho", "Em Andamento", "Em Aprovação", "Aprovado"].map((s) => `<option ${s === d.status ? "selected" : ""}>${s}</option>`).join("")}</select>`;
      const obras = (this.apoio && this.apoio.obras) || [];
      const sel = obras.find((o) => String(o.cc) === String(d.obra_cc || ""));
      const rotObra = (o) => `${o.cc} - ${o.nome || ""}`;
      const lista = obras.filter((o) => o.cc && (!o.acompanhar || String(o.cc) === String(d.obra_cc || ""))).sort((a, b) => String(a.cc).localeCompare(String(b.cc)));
      if (d.obra_cc && !sel) lista.unshift({ cc: d.obra_cc, nome: d.obra_cc_nome || "" });
      const obra = `<div style="display:flex;flex-direction:column;gap:2px;margin-top:8px"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:0.85rem;color:#64748b;white-space:nowrap">Obra no acompanhamento:</span>
          ${ro ? `<span style="font-size:0.75rem;color:#334155">${sel || d.obra_cc ? e(rotObra(sel || { cc: d.obra_cc, nome: d.obra_cc_nome })) : "Nenhuma"}</span>`
            : `<select class="ovt-in sm" style="min-width:280px;max-width:560px;width:auto" onchange="OrionViabilidadesApp.salvarObra(this.value)"><option value="">Nenhuma — continua como Land Bank</option>${lista.map((o) => `<option value="${e(o.cc)}" ${String(o.cc) === String(d.obra_cc || "") ? "selected" : ""}>${e(rotObra(o))}${o.acompanhar ? " (já acompanha)" : ""}</option>`).join("")}</select>`}</div>
          <div style="font-size:11px;color:${sel && sel.acompanhar ? "#64748b" : "#94a3b8"}">${sel && sel.acompanhar ? "Esta obra já está no acompanhamento. O Land Bank não aparece na lista." : "Quando esta obra for marcada para acompanhar, o Land Bank sai da lista."}</div></div>`;
      const fluxo = ro ? "" : d.status === "Rascunho" ? `<button type="button" class="ovt-btn azul" onclick="OrionViabilidadesApp.mudarStatusOrion('Em Andamento')">🕒 Iniciar Análise</button>`
        : d.status === "Em Andamento" ? `<button type="button" class="ovt-btn ambar" onclick="OrionViabilidadesApp.mudarStatusOrion('Em Aprovação')">🕒 Solicitar Aprovação</button>`
        : d.status === "Em Aprovação" ? `<button type="button" class="ovt-btn out" onclick="OrionViabilidadesApp.mudarStatusOrion('Em Andamento')">↺ Retornar</button><button type="button" class="ovt-btn verde" onclick="OrionViabilidadesApp.mudarStatusOrion('Aprovado')">✔ Aprovar Projeto</button>`
        : d.status === "Aprovado" ? `<button type="button" class="ovt-btn red" onclick="OrionViabilidadesApp.mudarStatusOrion('Em Andamento')">↺ Reabrir Projeto</button>` : "";
      const fases = this.fasesDe(d);
      return `<div class="ovt-cab">
          <div style="display:flex;align-items:flex-start;gap:14px">
            <button type="button" class="ovt-voltar" title="Voltar" onclick="OrionViabilidadesApp.voltarLista()">←</button>
            <div>${titulo}
              <div style="display:flex;align-items:center;gap:10px;margin-top:4px"><span style="font-size:0.85rem;color:#64748b">Status:</span>${status}${d.versao_de ? `<span class="ovt-pill nv">Nova Versão</span>` : ""}</div>
              ${obra}</div></div>
          <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
            ${ro ? "" : `<button type="button" class="ovt-btn outv" onclick="OrionViabilidadesApp.gerarNovoCenario()">⧉ Gerar Novo Cenário</button>${d.versao_de ? `<button type="button" class="ovt-btn red" onclick="OrionViabilidadesApp.excluirCenario()">🗑 Excluir Cenário</button>` : ""}`}
            ${fluxo}
            <label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer"><input type="checkbox" style="width:16px;height:16px;accent-color:#2E864D" ${d.tem_multiplas_fases ? "checked" : ""} ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.alternarMultiplasFases()"><span style="font-weight:500;color:#334155">Tem Múltiplas Fases?</span></label>
            <div style="width:1px;height:32px;background:#e2e8f0;margin:0 4px"></div>
            <div style="display:flex;align-items:center;gap:8px"><span style="font-size:0.85rem;font-weight:500;color:#334155">Taxa VPL/AVP (% a.a.):</span><input class="ovt-in sm" style="width:80px" value="${e(String(d.taxa_desconto_vpl || 12).replace(".", ","))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.salvarTaxaVpl(this.value)"></div>
          </div></div>
        ${d.tem_multiplas_fases ? `<div class="ovt-fases"><span style="font-size:0.85rem;font-weight:600;color:#334155;margin-left:6px">Fase Atual:</span>${fases.map((f, i) => `<button type="button" class="ovt-btn ${i === this.aberto.fase ? "prim" : "out"}" onclick="OrionViabilidadesApp.irFase(${i})">${e(f.nome || "Fase " + (i + 1))}</button>`).join("")}${ro ? "" : `<button type="button" class="ovt-btn" style="margin-left:auto;color:#334155" onclick="OrionViabilidadesApp.adicionarFase()">+ Adicionar Fase</button>`}</div>` : ""}`;
    },

    /* ---------- lista em cartões (Projetos de Viabilidade) ---------- */
    htmlListaOrion() {
      const e = (s) => this.esc(s), ro = this.leitura();
      const vivos = (this.lista || []).filter((x) => !x.excluido);
      const ids = new Set(vivos.map((x) => x._id));
      const raizes = vivos.filter((x) => !x.versao_de || !ids.has(x.versao_de));
      const dt = (x) => { const v = x.created_at || x.criado_em || x.importado_em; const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleDateString("pt-BR") : "—"; };
      const cab = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;gap:12px;flex-wrap:wrap">
          <div><div style="font-size:1.85rem;font-weight:700;color:#0f172a;letter-spacing:-0.02em">Projetos de Viabilidade</div><div style="color:#64748b;margin-top:4px">Gerencie e consolide os cálculos de seus empreendimentos.</div></div>
          ${ro ? "" : `<button type="button" class="ovt-btn prim big" onclick="OrionViabilidadesApp.novaViabilidadeOrion()">＋ Nova Viabilidade</button>`}</div>`;
      if (!raizes.length) return cab + `<div style="border:1px dashed #cbd5e1;border-radius:10px;padding:48px;text-align:center"><div style="font-size:1.1rem;font-weight:500;color:#0f172a">Nenhum projeto encontrado</div><p style="color:#64748b">Você ainda não tem nenhuma viabilidade cadastrada. Comece criando o seu primeiro projeto.</p></div>`;
      const pill = (s) => `<span style="padding:4px 10px;border-radius:4px;font-size:0.75rem;font-weight:600;${s === "Aprovado" ? "background:#dcfce7;color:#166534;border:1px solid #bbf7d0" : s === "Em Aprovação" ? "background:#fef3c7;color:#92400e;border:1px solid #fde68a" : "background:#f1f5f9;color:#334155;border:1px solid #e2e8f0"}">${e(s)}</span>`;
      return cab + `<div class="ovt-cards">${raizes.map((v) => {
        const todos = [v].concat(vivos.filter((x) => x.versao_de === v._id));
        return `<div class="ovt-card" onclick="OrionViabilidadesApp.abrir('${e(v._id)}')">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
            <div style="padding:10px;background:#f0fdf4;color:#15803d;border-radius:8px">📁</div>
            <div style="display:flex;gap:8px;align-items:center">${pill(v.status)}
              ${ro ? "" : `<span onclick="event.stopPropagation()" style="display:flex;gap:2px"><button type="button" title="Duplicar viabilidade" style="border:none;background:none;color:#94a3b8;cursor:pointer;padding:6px;border-radius:4px" onclick="OrionViabilidadesApp.duplicarDaLista('${e(v._id)}')">⧉</button><button type="button" title="Excluir viabilidade" style="border:none;background:none;color:#94a3b8;cursor:pointer;padding:6px;border-radius:4px" onclick="OrionViabilidadesApp.excluirViabilidade('${e(v._id)}')">🗑</button></span>`}</div></div>
          <div style="font-size:1.1rem;font-weight:700;color:#1e293b">${e(v.project_name)}</div>
          <div style="font-size:0.85rem;color:#64748b;margin:4px 0 16px">Criado em: ${dt(v)}</div>
          <div style="flex:1;margin-bottom:16px"><div style="font-size:0.72rem;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Cenários (${todos.length})</div>
            ${todos.map((s) => `<div class="ovt-cen" onclick="event.stopPropagation();OrionViabilidadesApp.abrir('${e(s._id)}')"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px">${e(s.project_name)}</span><span style="opacity:.5">→</span></div>`).join("")}</div>
          <div style="display:flex;justify-content:space-between;border-top:1px solid #f1f5f9;padding-top:16px;font-size:0.85rem;font-weight:500;color:#475569"><span>Acessar Projeto</span><span style="color:#16a34a">→</span></div></div>`;
      }).join("")}</div>`;
    },
    async novaViabilidadeOrion() {
      if (this.leitura()) return;
      const nome = window.prompt("Digite o nome do novo projeto de Viabilidade:");
      if (!nome) return;
      const fase = { nome: "Fase Única", revenue: clone(PADRAO.revenue), construction: clone(PADRAO.construction), expenses: clone(PADRAO.expenses), taxes: clone(PADRAO.taxes), exchanges: clone(PADRAO.exchanges), funding: Object.assign(clone(PADRAO.funding), { tipo_funding: "Nenhum" }), physical_data: clone(PADRAO.physical_data), dates: {} };
      try {
        this.ov = null;
        await this.criarDoc({ project_name: nome.trim(), city: "", status: "Rascunho", taxa_desconto_vpl: 12, tem_multiplas_fases: false, aplicar_incc_obras: false, incc_projetado_valor: null, incc_projetado_tipo: "% a.a.", ipca_projetado_valor: null, ipca_projetado_tipo: "% a.a.", versao_de: null, created_at: new Date().toISOString() }, [fase]);
      } catch (e) { window.alert("Erro ao criar viabilidade. " + (e.message || "")); }
    },

    /* ---------- aba Dados Físicos ---------- */
    htmlFisico() {
      const p = this.r("physical_data"), ro = this.leitura(), e = (s) => this.esc(s);
      const fm = (v) => (v ? Number(v).toLocaleString("pt-BR") : "");
      const area = (campo, rot, total, info) => {
        const v = Number(p[campo]) || 0;
        const pc = total && v ? ((v / total) * 100).toFixed(1) + "%" : "";
        return `<div class="${info ? "ovt-info" : ""}"><label class="ovt-lbl">${rot}</label><div style="position:relative"><input class="ovt-in" data-k="pd.${campo}" style="${pc ? "padding-right:64px" : ""}" value="${e(fm(v))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('physical_data','${campo}',this.value,'num')">${pc ? `<span class="ovt-badge">${pc}</span>` : ""}</div></div>`;
      };
      const tot = Number(p.area_total) || 0;
      const soma = ["area_lotes_residenciais", "area_lotes_comerciais", "area_lotes_mistos", "area_sistema_viario", "area_institucional", "area_verde", "sistema_lazer", "area_associacao"].reduce((s, k) => s + (Number(p[k]) || 0), 0);
      const dif = tot - soma, ok = Math.abs(dif) < 0.1;
      const m2 = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const qR = Number(p.qtde_lotes_residenciais) || 0, qC = Number(p.qtde_lotes_comerciais) || 0, qM = Number(p.qtde_lotes_mistos) || 0, qT = qR + qC + qM;
      const vR = (Number(p.area_lotes_residenciais) || 0) * (Number(p.valor_venda_residencial_m2) || 0), vC = (Number(p.area_lotes_comerciais) || 0) * (Number(p.valor_venda_comercial_m2) || 0), vM = (Number(p.area_lotes_mistos) || 0) * (Number(p.valor_venda_misto_m2) || 0);
      const med = (a, q) => (q > 0 ? ((Number(a) || 0) / q).toFixed(2) : 0);
      const linha = (r, v, forte) => `<div style="display:flex;justify-content:space-between;font-size:${forte ? "1rem;font-weight:700;margin-top:8px;padding-top:8px;border-top:1px solid rgba(46,134,77,.2)" : "0.85rem;margin-bottom:4px"}"><span style="color:${forte ? "#1e293b" : "#334155"}">${r}</span><span style="font-weight:${forte ? 700 : 600};color:#2E864D">${v}</span></div>`;
      const inp = (campo, rot, tipo) => `<div><label class="ovt-lbl">${rot}</label><input class="ovt-in" data-k="pd.${campo}" value="${e(p[campo] ? String(p[campo]).replace(".", ",") : "")}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('physical_data','${campo}',this.value,'${tipo}')"></div>`;
      const tipos = ["Aberto", "Aberto Popular", "Loteamento Fechado"];
      const cens = (this.cenarios || []).map((c) => c.nome);
      return `<div class="ovt-pad" style="display:flex;flex-direction:column;gap:32px">
        <section><h3 class="ovt-h3n">Configurações Gerais</h3>
          <div class="ovt-g ovt-g3" style="margin-bottom:16px"><div class="ovt-c2"><label class="ovt-lbl">Nome do Empreendimento</label><input class="ovt-in" data-k="pd._nome" value="${e(p._nome)}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('physical_data','_nome',this.value)"></div>
            <div><label class="ovt-lbl">Cidade</label><input class="ovt-in" data-k="pd._cidade" value="${e(p._cidade)}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('physical_data','_cidade',this.value)"></div></div>
          <div class="ovt-g ovt-g3"><div><label class="ovt-lbl">Código do Projeto</label><input class="ovt-in" data-k="pd.codigo_projeto" value="${e(p.codigo_projeto || "")}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('physical_data','codigo_projeto',this.value)"></div>
            <div><label class="ovt-lbl">Tipo de Projeto</label><select class="ovt-in" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.setTipoProjeto(this.value)"><option value="">Selecione...</option>${tipos.map((t) => `<option ${p.tipo_projeto === t ? "selected" : ""}>${t}</option>`).join("")}${p.tipo_projeto && tipos.indexOf(p.tipo_projeto) < 0 ? `<option selected>${e(p.tipo_projeto)}</option>` : ""}<option value="NOVO">+ Adicionar Novo Tipo...</option></select></div>
            <div><label class="ovt-lbl">Cenário</label><select class="ovt-in" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.setCenarioFisico(this.value)">${cens.map((c) => `<option ${(p.cenario || "Neutro") === c ? "selected" : ""}>${e(c)}</option>`).join("")}${cens.indexOf(p.cenario || "Neutro") < 0 ? `<option selected>${e(p.cenario || "Neutro")}</option>` : ""}<option value="NOVO">+ Adicionar Novo Cenário...</option></select></div></div></section>
        <section><h3 class="ovt-h3n">Projeto Urbanístico (m²)</h3>
          <div class="ovt-g ovt-g4">${area("area_total", "Área Total (m²)")}${area("area_lotes_residenciais", "Lotes Residenciais (m²)", tot)}${area("area_lotes_comerciais", "Lotes Comerciais (m²)", tot)}${area("area_lotes_mistos", "Lotes Mistos (m²)", tot)}
            ${area("area_sistema_viario", "Sistema Viário (m²)", tot, 1)}${area("area_institucional", "Área Institucional (m²)", tot, 1)}${area("area_verde", "Área Verde / APP (m²)", tot, 1)}${area("sistema_lazer", "Sistema de Lazer (m²)", tot, 1)}${area("area_associacao", "Associação / Não Vendável (m²)", tot, 1)}</div>
          <p style="font-size:0.75rem;color:#64748b;margin-top:8px">* Áreas em laranja são apenas informativas e não entram no cálculo do VGV.</p>
          <div style="margin-top:16px;padding:16px;border-radius:8px;border:1px solid ${ok ? "#a7f3d0" : "#fde68a"};background:${ok ? "rgba(236,253,245,.5)" : "rgba(255,251,235,.5)"}">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:0.85rem;font-weight:600;color:${ok ? "#047857" : "#b45309"}">Validação do Projeto Urbanístico</span><span style="font-size:0.85rem;font-weight:700;color:${ok ? "#059669" : "#d97706"}">${ok ? "✓ Áreas distribuídas corretamente" : "⚠️ Atenção na distribuição"}</span></div>
            <div style="display:flex;justify-content:space-between;align-items:flex-end"><div style="display:flex;gap:32px;font-size:0.85rem"><div><span style="display:block;font-size:0.7rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Área Total</span><span style="font-weight:600;color:#334155">${m2(tot)} m²</span></div><div><span style="display:block;font-size:0.7rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Soma Distribuída</span><span style="font-weight:600;color:#334155">${m2(soma)} m²</span></div></div>
              ${ok ? "" : `<div style="text-align:right"><span style="display:block;font-size:0.7rem;color:#d97706;text-transform:uppercase;letter-spacing:.05em">Diferença</span><span style="font-weight:700;color:#d97706">${m2(Math.abs(dif))} m² ${dif > 0 ? "Faltando" : "Sobrando"}</span></div>`}</div></div></section>
        <div class="ovt-g ovt-g2" style="gap:32px">
          <section><h3 class="ovt-h3n">Dados Físicos (Unidades)</h3><div style="display:flex;flex-direction:column;gap:16px">
            ${inp("qtde_lotes_residenciais", "Número de Lotes Residenciais", "int")}${inp("qtde_lotes_comerciais", "Número de Lotes Comerciais", "int")}${inp("qtde_lotes_mistos", "Número de Lotes Mistos", "int")}
            <div class="ovt-verdebox"><div style="display:flex;justify-content:space-between;font-size:0.85rem"><span style="color:#334155">Total de Lotes:</span><span style="font-weight:600;color:#2E864D">${qT}</span></div>
              <div class="ovt-g ovt-g2" style="padding-top:8px;margin-top:8px;border-top:1px solid rgba(46,134,77,.1)">
                <div style="font-size:0.75rem"><span style="font-weight:600;color:#64748b;text-transform:uppercase;display:block;margin-bottom:4px">Área Média</span>${[["Residencial", med(p.area_lotes_residenciais, qR)], ["Comercial", med(p.area_lotes_comerciais, qC)], ["Misto", med(p.area_lotes_mistos, qM)]].map(([r, v]) => `<div style="display:flex;justify-content:space-between"><span style="color:#475569">${r}:</span><b>${v} m²</b></div>`).join("")}</div>
                <div style="font-size:0.75rem"><span style="font-weight:600;color:#64748b;text-transform:uppercase;display:block;margin-bottom:4px">Ticket Médio</span>${[["Residencial", qR ? vR / qR : 0], ["Comercial", qC ? vC / qC : 0], ["Misto", qM ? vM / qM : 0]].map(([r, v]) => `<div style="display:flex;justify-content:space-between"><span style="color:#475569">${r}:</span><b>${BRL(v)}</b></div>`).join("")}</div></div>
              <div style="display:flex;justify-content:space-between;font-size:0.85rem;font-weight:700;padding-top:8px;margin-top:8px;border-top:1px solid rgba(46,134,77,.2)"><span style="color:#1e293b">Ticket Médio Geral:</span><span style="color:#2E864D">${BRL(qT ? (vR + vC + vM) / qT : 0)}</span></div></div></div></section>
          <section><h3 class="ovt-h3n">Dados Financeiros (Premissas)</h3><div style="display:flex;flex-direction:column;gap:16px">
            ${inp("valor_venda_residencial_m2", "Valor Venda Residencial (R$/m²)", "num")}${inp("valor_venda_comercial_m2", "Valor Venda Comercial (R$/m²)", "num")}${inp("valor_venda_misto_m2", "Valor Venda Misto (R$/m²)", "num")}
            <div class="ovt-verdebox">${linha("VGV Residencial Base:", BRL(vR))}${linha("VGV Comercial Base:", BRL(vC))}${linha("VGV Misto Base:", BRL(vM))}${linha("VGV Total Base:", BRL(vR + vC + vM), 1)}</div></div></section></div>
        ${ro ? "" : `<div style="display:flex;justify-content:flex-end;padding-top:16px;border-top:1px solid #e2e8f0"><button type="button" class="ovt-btn prim big" ${this.ov.salvando ? "disabled" : ""} onclick="OrionViabilidadesApp.salvarFisico()">${this.ov.salvando === "fisico" ? "Salvando..." : "Salvar Dados Físicos"}</button></div>`}
      </div>`;
    },
    setTipoProjeto(v) {
      if (v === "NOVO") { const n = (window.prompt("Digite o novo tipo de projeto:") || "").trim(); if (n) this.vs("physical_data", "tipo_projeto", n); else this.render(); return; }
      this.vs("physical_data", "tipo_projeto", v);
    },
    async setCenarioFisico(v) {
      if (v !== "NOVO") return this.vs("physical_data", "cenario", v);
      const n = (window.prompt("Digite o novo cenário:") || "").trim();
      if (!n) return this.render();
      try { // como no Órion, o cenário novo entra no cadastro de cenários (Premissas da viabilidade)
        const atual = await window.OrionStore.ler("cenarios", []);
        const itens = (atual.itens || []).slice();
        if (!itens.some((c) => c.nome === n)) { itens.push({ nome: n, vgv_multiplier: 1, construction_cost_multiplier: 1, sales_speed_multiplier: 1 }); await window.OrionStore.gravar("cenarios", itens, atual.versao); this.cenarios = itens; }
      } catch (e) { console.error("Erro ao criar cenário global", e); }
      this.vs("physical_data", "cenario", n);
    },
    async salvarFisico() { if (await this.salvarPartes(["physical_data"], "fisico")) { window.alert("Dados físicos salvos com sucesso!"); this.render(); } },

    /* ---------- aba Datas ---------- */
    htmlDatas() {
      const d = this.r("dates"), ro = this.leitura(), e = (s) => this.esc(s);
      const c = (k, t) => `<div><label class="ovt-lbl">${t}</label><input type="date" class="ovt-in" data-k="dt.${k}" value="${e(String(d[k] || "").slice(0, 10))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('dates','${k}',this.value)"></div>`;
      const sujo = this.sujoParte("dates");
      return `<div class="ovt-pad"><div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0;padding-bottom:16px;margin-bottom:24px">
          <div><h2 class="ovt-h2">Datas e Cronograma</h2><p class="ovt-sub">Defina as datas chave para o deslocamento das curvas financeiras.</p></div>
          <div style="display:flex;align-items:center;gap:16px">${this.ov.msg.dates ? `<span class="ovt-msg">${this.ov.msg.dates}</span>` : ""}${ro ? "" : `<button type="button" class="ovt-btn prim" ${!sujo || this.ov.salvando ? "disabled" : ""} onclick="OrionViabilidadesApp.salvarSimples(['dates'],'dates','Cronograma salvo com sucesso!')">💾 ${this.ov.salvando === "dates" ? "Salvando..." : "Salvar Datas"}</button>`}</div></div>
        <div style="max-width:900px;margin:0 auto;padding:24px;box-shadow:0 1px 2px rgba(15,23,42,.06);border-radius:10px"><div class="ovt-g ovt-g2" style="gap:32px">
          <div style="display:flex;flex-direction:column;gap:16px"><h3 style="font-weight:700;color:#334155;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin:0">📅 Marcos Principais</h3>${c("data_registro", "Registro (RI)")}${c("data_lancamento", "Lançamento")}${c("data_inicio_obras", "Início das Obras")}</div>
          <div style="display:flex;flex-direction:column;gap:16px"><h3 style="font-weight:700;color:#334155;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin:0">📅 Serviços e Comercial</h3>${c("data_inicio_projetos", "Início dos Projetos")}${c("data_inicio_aquisicao", "Início Aquisição de Área")}${c("data_inicio_comercial", "Início do Comercial")}${c("data_inicio_mkt", "Início do Marketing")}</div>
        </div></div></div>`;
    },
    async salvarSimples(partes, chave, texto) { if (await this.salvarPartes(partes, chave)) this.msg(chave, texto); },

    /* ---------- aba Permutas ---------- */
    htmlPermutas() {
      const x = this.r("exchanges"), ro = this.leitura() || this.aberto.doc.status === "Aprovado", e = (s) => this.esc(s);
      const rat = x.rateios_config_json || {};
      const f = this.faseAtual();
      const cons = jsonDe((f.construction || {}).extra_constructions_json, []) || [], desp = jsonDe((f.expenses || {}).extra_expenses_json, []) || [];
      const pct = (campo, rot) => `<div><label class="ovt-lbl xs">${rot}</label><div style="position:relative"><input class="ovt-in" data-k="ex.${campo}" value="${e(x[campo] === "" || x[campo] == null ? "" : String(x[campo]).replace(".", ","))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('exchanges','${campo}',this.value,'num')"><span style="position:absolute;right:12px;top:11px;font-size:0.75rem;color:#64748b">%</span></div></div>`;
      const sw = (k) => `<button type="button" class="ovt-sw ${rat[k] ? "on" : ""}" ${ro ? "disabled" : ""} onclick="OrionViabilidadesApp.setRateioOrion('${k}', ${!rat[k]})"></button>`;
      const lin = (k, rot) => `<tr><td style="font-weight:500">${e(rot)}</td><td class="ovt-ct">${sw(k)}</td><td class="ovt-r" style="color:#64748b">${rat[k] ? x.perc_parceria_terrenista : 0}%</td><td class="ovt-r" style="color:#64748b">${rat[k] ? x.perc_parceria_investidor : 0}%</td><td class="ovt-r" style="color:#64748b">${rat[k] ? x.perc_parceria_empreendedor : 100}%</td></tr>`;
      const mods = String(x.modalidade || "");
      const tem = (m) => mods.indexOf(m) >= 0;
      const chk = (m, rot) => `<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" style="width:16px;height:16px" ${tem(m) ? "checked" : ""} ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.toggleModalidade('${m}')"><span style="font-size:0.85rem;color:#334155">${rot}</span></label>`;
      const vinc = rat.vincular_permuta_parceria !== false;
      const num = (campo, w, tipo) => `<input class="ovt-in" data-k="ex.${campo}" style="width:${w}" value="${e(x[campo] == null ? "" : String(x[campo]).replace(".", ","))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('exchanges','${campo}',this.value,'${tipo || "num"}')">`;
      const ab = x.abertura_terrenistas_json || [];
      return `<div class="ovt-pad" style="padding-bottom:120px;display:flex;flex-direction:column;gap:32px">
        <div style="display:flex;justify-content:space-between;align-items:center"><div><h2 class="ovt-h2">Permutas e Parcerias</h2><p class="ovt-sub">Defina a estrutura societária e rateio de verbas do empreendimento.</p></div>
          <div style="display:flex;align-items:center;gap:16px">${this.ov.msg.exchanges ? `<span class="ovt-msg">${this.ov.msg.exchanges}</span>` : ""}<button type="button" class="ovt-btn prim" ${ro || this.ov.salvando ? "disabled" : ""} onclick="OrionViabilidadesApp.salvarSimples(['exchanges'],'exchanges','Permutas salvas com sucesso!')">💾 ${this.ov.salvando === "exchanges" ? "Salvando..." : "Salvar Permutas"}</button></div></div>
        <div><h3 class="ovt-h3">Composição na Área</h3><div class="ovt-box ovt-g ovt-g3">${pct("perc_area_terrenista", "Proprietários Originais")}${pct("perc_area_investidor", "Investido")}${pct("perc_area_empreendedor", "Loteador")}</div></div>
        <div><h3 class="ovt-h3">Percentual Parceria (VGV Ponderada)</h3><div class="ovt-box ovt-g ovt-g3">${pct("perc_parceria_terrenista", "Proprietário (Terrenista)")}${pct("perc_parceria_investidor", "Investidor")}${pct("perc_parceria_empreendedor", "Empreendedor")}</div></div>
        <div><h3 class="ovt-h3">Rateio de Verbas</h3><div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.05)"><table class="ovt-tab">
          <thead><tr><th>Custos</th><th class="ovt-ct">Rateio</th><th class="ovt-r">Proprietário</th><th class="ovt-r">Investidor</th><th class="ovt-r">Empreendedor</th></tr></thead><tbody>
          ${lin("aquisicao_area", "Aquisição de Área")}${lin("custo_projetos", "Projetos")}${lin("custo_obras", "Obras de Infraestrutura")}${lin("adm_obras", "Administração de Obras")}
          ${cons.map((c, i) => lin(`extra_obra_${i}`, c.nome || c.descricao || `Extra Obras ${i + 1}`)).join("")}
          <tr><th colspan="5" style="background:#f1f5f9;color:#475569;font-weight:700">Despesas</th></tr>
          ${lin("adm", "Despesas Administrativas")}${lin("comercial", "Comercial")}${lin("marketing", "Marketing")}
          ${desp.map((c, i) => lin(`extra_despesa_${i}`, c.nome || c.descricao || `Extra Despesa ${i + 1}`)).join("")}</tbody></table></div></div>
        <div><div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin-bottom:14px"><h3 class="ovt-h3" style="border:none;padding:0;margin:0">Abertura de Parceiros</h3><button type="button" class="ovt-btn out" style="height:28px;font-size:0.75rem" ${ro ? "disabled" : ""} onclick="OrionViabilidadesApp.parceiroAcao('mais')">＋ Adicionar</button></div>
          <div style="display:flex;flex-direction:column;gap:8px">${ab.length ? ab.map((t, i) => `<div style="display:flex;gap:8px;align-items:center">
              <input class="ovt-in" style="flex:1" placeholder="Nome (ex: Tadeu)" data-k="ab.${i}.n" value="${e(t.nome || "")}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.parceiroAcao('set',${i},'nome',this.value)">
              <select class="ovt-in" style="width:140px" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.parceiroAcao('set',${i},'tipo',this.value)">${["Proprietário", "Investidor", "Empreendedor"].map((o) => `<option ${(t.tipo || "Proprietário") === o ? "selected" : ""}>${o}</option>`).join("")}</select>
              <div style="position:relative;width:144px"><input class="ovt-in" data-k="ab.${i}.p" value="${e(t.percentual === "" || t.percentual == null ? "" : String(t.percentual).replace(".", ","))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.parceiroAcao('set',${i},'percentual',this.value,'num')"><span style="position:absolute;right:12px;top:11px;font-size:0.75rem;color:#64748b">%</span></div>
              ${ro ? "" : `<button type="button" title="Remover" style="border:none;background:none;color:#ef4444;cursor:pointer;padding:8px" onclick="OrionViabilidadesApp.parceiroAcao('menos',${i})">🗑</button>`}</div>`).join("") : `<p style="font-size:0.85rem;color:#64748b;font-style:italic;margin:0">Nenhum parceiro detalhado.</p>`}</div></div>
        <div><h3 class="ovt-h3">Modalidade do Terreno</h3><div class="ovt-box" style="display:flex;flex-direction:column;gap:16px">
          ${chk("Dinheiro", "Compra em Dinheiro (Fixo)")}${tem("Dinheiro") ? `<div style="margin-left:24px;display:flex;align-items:center;gap:8px"><span style="font-size:0.85rem;color:#64748b">Valor (R$):</span>${num("valor_terreno_fixo", "160px")}</div>` : ""}
          ${chk("Permuta Financeira", "Permuta Financeira (% VGV)")}${tem("Permuta Financeira") ? `<div style="margin-left:24px;display:flex;flex-direction:column;gap:12px"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" style="width:16px;height:16px" ${vinc ? "checked" : ""} ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.setRateioOrion('vincular_permuta_parceria', ${!vinc})"><span style="font-size:0.85rem;color:#334155">Usar percentual definido na Parceria (Proprietário)</span></label>
              <div style="display:flex;align-items:center;gap:8px"><span style="font-size:0.85rem;color:#64748b">Percentual (%):</span><input class="ovt-in" style="width:128px" data-k="ex.perc_permuta_financeira" value="${e(String(vinc ? x.perc_parceria_terrenista : x.perc_permuta_financeira).replace(".", ","))}" ${ro || vinc ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('exchanges','perc_permuta_financeira',this.value,'num')"></div></div>` : ""}
          ${chk("Permuta Física", "Permuta Física (Unidades)")}${tem("Permuta Física") ? `<div style="margin-left:24px;display:flex;align-items:center;gap:16px"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:0.85rem;color:#64748b">Qtd. Unidades:</span>${num("permuta_fisica_unidades", "96px", "int")}</div><div style="display:flex;align-items:center;gap:8px"><span style="font-size:0.85rem;color:#64748b">Valor Médio (R$):</span>${num("permuta_fisica_valor_unidade", "128px")}</div></div>` : ""}
        </div></div></div>`;
    },
    setRateioOrion(k, v) { const x = this.r("exchanges"); x.rateios_config_json = Object.assign({}, x.rateios_config_json || {}, { [k]: !!v }); this.rr(); },
    toggleModalidade(m) {
      const x = this.r("exchanges");
      let l = x.modalidade ? String(x.modalidade).split(/,|\+/).map((s) => s.trim()).filter(Boolean) : [];
      l = l.indexOf(m) >= 0 ? l.filter((y) => y !== m) : l.concat([m]);
      x.modalidade = l.join(", ");
      this.rr();
    },
    parceiroAcao(acao, i, k, v, tipo) {
      const x = this.r("exchanges");
      const l = (x.abertura_terrenistas_json || []).slice();
      if (acao === "mais") l.push({ nome: "", percentual: 0 });
      else if (acao === "menos") l.splice(i, 1);
      else if (l[i]) l[i] = Object.assign({}, l[i], { [k]: tipo === "num" ? (String(v).trim() === "" ? "" : NUM(v)) : v });
      x.abertura_terrenistas_json = l;
      this.rr();
    },

    /* ---------- aba Receitas ---------- */
    planoAtivo(r) { return (r.condicoes_pagamento_json || []).find((p) => p && p.nome === r.plano_ativo) || null; },
    htmlReceitas() {
      const r = this.r("revenue"), ro = this.leitura(), e = (s) => this.esc(s), ap = this.apoio || { indices: [], focus: [], curvas: [] };
      const f = this.faseAtual();
      const ph = f.physical_data || {};
      const lotesTot = (Number(ph.qtde_lotes_residenciais) || 0) + (Number(ph.qtde_lotes_comerciais) || 0) + (Number(ph.qtde_lotes_mistos) || 0);
      const plano = this.planoAtivo(r);
      const totPerc = plano ? (plano.condicoes || []).reduce((s, c) => s + (Number(c.perc) || 0), 0) : 0;
      const valido = Math.abs(totPerc - 100) < 0.01;
      const correcao = r.taxa_correcao_projetada != null;
      const merc = r.origem_correcao === "MERCADO";
      const inds = ap.indices || [];
      const idx = `<div style="display:flex;align-items:center;gap:16px"><label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer"><button type="button" class="ovt-sw ${correcao ? "on" : ""}" ${ro ? "disabled" : ""} onclick="OrionViabilidadesApp.receitaCorrecao()"></button><span style="font-weight:600;color:#334155">Correção Monetária (Inflação)</span></label>
          ${correcao ? `<div style="display:flex;align-items:center;gap:8px;padding-left:16px;border-left:1px solid #e2e8f0">
            <select class="ovt-in sm" style="width:144px" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.receitaOrigem(this.value)"><option value="PROJETADO" ${!merc ? "selected" : ""}>Cadastro</option><option value="MERCADO" ${merc ? "selected" : ""}>Mercado (BCB)</option></select>
            ${merc ? `<select class="ovt-in sm" style="min-width:12rem;width:auto" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.receitaFocus(this.value)">${(ap.focus || []).map((x) => `<option value="${e(x.index_type)}" ${r.nome_indice_mercado === x.index_type ? "selected" : ""}>${e(x.index_type)} - Focus (${String(x.valor).replace(".", ",")}% a.a.)</option>`).join("") || `<option value="">Sem dados</option>`}</select>`
              : `<select class="ovt-in sm" style="min-width:12rem;width:auto;max-width:22rem" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.receitaIndice(this.value)"><option value="">Selecione o Índice...</option>${inds.map((x, i) => `<option value="${e(this.indiceId(x, i))}" ${String(r.indice_correcao_id) === String(this.indiceId(x, i)) ? "selected" : ""}>${x.index_type ? e(x.index_type) + " - " : ""}${e(x.nome)} (${String(x.valor).replace(".", ",")}${e(x.tipo_unidade)})</option>`).join("")}</select>`}
            <input class="ovt-in sm" style="width:80px" data-k="rv.tcp" value="${e(r.taxa_correcao_projetada == null ? "" : String(r.taxa_correcao_projetada).replace(".", ","))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('revenue','taxa_correcao_projetada',this.value,'numnull')">
            <select class="ovt-in sm" style="width:96px" ${ro || merc ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('revenue','tipo_correcao_projetada',this.value)"><option ${(r.tipo_correcao_projetada || "% a.a.") === "% a.a." ? "selected" : ""}>% a.a.</option><option ${r.tipo_correcao_projetada === "% a.m." ? "selected" : ""}>% a.m.</option></select></div>` : ""}</div>
        <div style="display:flex;align-items:center;gap:16px;margin-top:8px"><span style="font-size:0.85rem;font-weight:600;color:#334155">Sistema de Amortização:</span>
          <select class="ovt-in sm" style="width:144px" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('revenue','sistema_amortizacao',this.value)">${[["Sem Juros", "Sem Juros"], ["Price", "Tabela Price"], ["SAC", "Tabela SAC"]].map(([v, t]) => `<option value="${v}" ${(r.sistema_amortizacao || "Sem Juros") === v ? "selected" : ""}>${t}</option>`).join("")}</select>
          ${r.sistema_amortizacao && r.sistema_amortizacao !== "Sem Juros" ? `<div style="display:flex;align-items:center;gap:8px;padding-left:16px;border-left:1px solid #e2e8f0"><span style="font-size:0.85rem;color:#475569">Taxa:</span><input class="ovt-in sm" style="width:80px" data-k="rv.tjv" value="${e(r.taxa_juros_vendas == null ? "" : String(r.taxa_juros_vendas).replace(".", ","))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('revenue','taxa_juros_vendas',this.value,'numnull')"><span style="font-size:0.85rem;color:#64748b">% a.a.</span></div>` : ""}</div>`;
      const conds = plano ? (plano.condicoes || []).map((c, i) => `<div style="display:flex;flex-direction:column;gap:4px;border-bottom:1px solid #f1f5f9;padding-bottom:8px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.85rem"><span style="color:#475569;font-weight:500">${e(c.nome)}</span><span style="display:flex;align-items:center;gap:4px"><input class="ovt-in sm" style="width:64px;height:28px;text-align:right;font-weight:600" data-k="cd.${i}.p" value="${e(c.perc === 0 ? "0" : String(c.perc || "").replace(".", ","))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.condicaoSet(${i},'perc',this.value,'num')"><b style="color:#64748b">%</b></span></div>
          <div style="display:flex;gap:16px;font-size:0.75rem;color:#64748b"><label style="display:flex;gap:4px;align-items:center;cursor:pointer"><input type="checkbox" ${c.aplica_juros !== false ? "checked" : ""} ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.condicaoSet(${i},'aplica_juros',this.checked,'bool')"> Aplica Juros</label><label style="display:flex;gap:4px;align-items:center;cursor:pointer"><input type="checkbox" ${c.aplica_correcao !== false ? "checked" : ""} ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.condicaoSet(${i},'aplica_correcao',this.checked,'bool')"> Aplica Correção</label></div>
          ${String(c.nome || "").toUpperCase() !== "A VISTA" ? `<div style="display:flex;gap:16px;align-items:center;font-size:0.75rem;color:#475569;margin-top:4px;background:#f8fafc;padding:8px;border-radius:4px"><span style="display:flex;align-items:center;gap:8px"><b style="font-weight:500">Entrada (%):</b><input class="ovt-in sm" style="width:64px;height:24px;text-align:right" placeholder="0" data-k="cd.${i}.pe" value="${e(c.perc_entrada ? String(c.perc_entrada).replace(".", ",") : "")}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.condicaoSet(${i},'perc_entrada',this.value,'num')"></span><span style="display:flex;align-items:center;gap:8px"><b style="font-weight:500">Parcelas Entrada:</b><input class="ovt-in sm" style="width:48px;height:24px;text-align:right" placeholder="1" data-k="cd.${i}.pa" value="${e(c.parcelas_entrada || "")}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.condicaoSet(${i},'parcelas_entrada',this.value,'int1')"></span></div>` : ""}</div>`).join("") : "";
      const nCol = Math.max(this.ov.colunas, ...(plano ? plano.condicoes.map((c) => ((c.curve_json || {}).meses || []).length) : [0]));
      const somaLotes = plano ? plano.condicoes.reduce((s, c) => s + ((c.curve_json || {}).meses || []).reduce((a, b) => a + (Number(b) || 0), 0), 0) : 0;
      const curvasRec = (ap.curvas || []).filter((c) => c.classificacao === "Receita");
      const matriz = plano ? `<div style="margin-top:48px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 1px 2px rgba(15,23,42,.05);overflow:hidden">
          <div style="padding:16px 24px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;background:#f8fafc;flex-wrap:wrap;gap:16px">
            <div><div style="font-size:1.1rem;font-weight:700;color:#1e293b">Velocidade de Vendas (Matriz de Lotes)</div><div style="font-size:0.85rem;color:#64748b">Distribua os lotes no tempo ou aplique uma curva padrão automaticamente.</div></div>
            <div style="display:flex;align-items:center;gap:12px;background:#fff;padding:8px;border:1px solid #e2e8f0;border-radius:8px">
              <select class="ovt-in sm" style="min-width:200px;width:auto;height:36px" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.receitaCurvaSel(this.value)"><option value="">Selecione uma curva padrão...</option>${curvasRec.map((c) => `<option value="${e(this.curvaId(c))}" ${String((r.velocidade_vendas_json || {}).curve_id || "") === String(this.curvaId(c)) ? "selected" : ""}>${e(c.nome)}</option>`).join("")}</select>
              <select class="ovt-in sm" style="width:auto;height:36px;background:#f8fafc" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.ov.metodo=this.value"><option value="proporcional" ${this.ov.metodo === "proporcional" ? "selected" : ""}>Método Proporcional</option><option value="cascata" ${this.ov.metodo === "cascata" ? "selected" : ""}>Acelerar Curtos (Cascata)</option></select>
              <button type="button" class="ovt-btn prim" ${ro || !(r.velocidade_vendas_json || {}).curve_id ? "disabled" : ""} onclick="OrionViabilidadesApp.aplicarCurvaMatriz()">Aplicar Curva</button></div></div>
          <div style="padding:24px;overflow:auto;max-height:calc(100vh - 300px)"><table style="border-collapse:collapse;font-size:0.85rem;width:100%">
            <thead><tr><th style="position:sticky;left:0;z-index:2;background:#fff;border-bottom:1px solid #e2e8f0;padding:8px;min-width:150px;text-align:left;color:#334155">Condição</th><th style="position:sticky;left:150px;z-index:2;background:#fff;border-bottom:1px solid #e2e8f0;padding:8px;min-width:100px;color:#334155;box-shadow:2px 0 5px -2px rgba(0,0,0,.1)">Total Lotes</th>
              ${Array.from({ length: nCol }).map((_, i) => `<th style="border-bottom:1px solid #e2e8f0;padding:8px;min-width:60px;color:#334155;white-space:nowrap">Mês ${i + 1}</th>`).join("")}
              <th style="position:sticky;right:0;background:#fff;border-bottom:1px solid #e2e8f0;padding:8px;min-width:120px"><button type="button" class="ovt-btn out" onclick="OrionViabilidadesApp.ov.colunas=${nCol + 12};OrionViabilidadesApp.render()">+ 12 Meses</button></th></tr></thead>
            <tbody>${plano.condicoes.map((c, ci) => { const ms = (c.curve_json || {}).meses || []; const s = ms.reduce((a, b) => a + (Number(b) || 0), 0); return `<tr><td style="position:sticky;left:0;z-index:1;background:#fff;border-bottom:1px solid #e2e8f0;padding:8px;font-weight:500;color:#475569">${e(c.nome)}</td><td style="position:sticky;left:150px;z-index:1;background:#fff;border-bottom:1px solid #e2e8f0;padding:8px;text-align:center;font-weight:700;font-size:0.75rem;box-shadow:2px 0 5px -2px rgba(0,0,0,.1)">${s}</td>
                ${Array.from({ length: nCol }).map((_, mi) => `<td style="border-bottom:1px solid #e2e8f0;padding:4px"><input data-k="mx.${ci}.${mi}" style="width:100%;min-width:52px;height:32px;text-align:center;border:1px solid #e2e8f0;border-radius:4px;font-size:0.75rem;box-sizing:border-box" value="${ms[mi] ? e(ms[mi]) : ""}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.matrizSet(${ci},${mi},this.value)"></td>`).join("")}<td style="position:sticky;right:0;background:#fff;border-bottom:1px solid #e2e8f0"></td></tr>`; }).join("")}</tbody>
            <tfoot><tr style="background:#f8fafc;font-weight:700"><td style="position:sticky;left:0;z-index:1;background:#f8fafc;border-top:1px solid #e2e8f0;padding:8px;text-align:right;color:#334155">Total Geral:</td><td style="position:sticky;left:150px;z-index:1;background:#f8fafc;border-top:1px solid #e2e8f0;padding:8px;text-align:center;font-size:0.75rem;box-shadow:2px 0 5px -2px rgba(0,0,0,.1)"><span style="color:${somaLotes !== lotesTot ? "#dc2626" : "#059669"}">${somaLotes} / ${lotesTot}</span></td>
              <td colspan="${nCol + 1}" style="border-top:1px solid #e2e8f0;padding:8px;font-size:0.75rem">${somaLotes !== lotesTot ? `<span style="color:#ef4444;background:#fef2f2;padding:4px 8px;border-radius:4px">A soma total de lotes deve ser exatamente igual a ${lotesTot}</span>` : ""}</td></tr></tfoot></table></div>
          <div style="padding:16px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;align-items:center;gap:12px">
            <button type="button" class="ovt-btn out" ${ro ? "disabled" : ""} onclick="OrionViabilidadesApp.matrizModelo()">⬇ Baixar Modelo</button>
            <button type="button" class="ovt-btn out" ${ro ? "disabled" : ""} onclick="document.getElementById('ovt-matriz-arq').click()">⬆ Importar Planilha</button>
            <input id="ovt-matriz-arq" type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="OrionViabilidadesApp.matrizImportar(this)"></div></div>`
        : `<div style="margin-top:48px;padding:48px;border:2px dashed #e2e8f0;border-radius:12px;text-align:center;background:#f8fafc;color:#64748b">Selecione um plano de pagamento para configurar a Velocidade de Vendas.</div>`;
      return `<div class="ovt-pad" style="display:flex;flex-direction:column;gap:32px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap"><div><h2 class="ovt-h2">Premissas de Receita</h2><p class="ovt-sub">Defina o VGV e a distribuição do fluxo de recebimento.</p></div>
          <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap"><div style="display:flex;flex-direction:column;gap:8px;background:#f8fafc;padding:16px;border:1px solid #e2e8f0;border-radius:6px">${idx}</div>
            <div style="display:flex;align-items:center;gap:8px">${this.ov.msg.revenue ? `<span class="ovt-msg">${this.ov.msg.revenue}</span>` : ""}<button type="button" class="ovt-btn prim" ${ro || this.ov.salvando ? "disabled" : ""} onclick="OrionViabilidadesApp.salvarSimples(['revenue'],'revenue','Dados salvos com sucesso!')">💾 ${this.ov.salvando === "revenue" ? "Salvando..." : "Salvar Receitas"}</button></div></div></div>
        <div class="ovt-g ovt-g2" style="gap:32px">
          <div><h3 class="ovt-h3">Volume Geral de Vendas (VGV)</h3><label class="ovt-lbl">VGV Total Projetado (R$)</label><div style="padding:12px 16px;font-weight:600;font-size:1.1rem;color:#334155;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px">${BRL(r.vgv_total)}</div><p style="font-size:0.75rem;color:#64748b;margin-top:4px">Calculado automaticamente pelos Dados Físicos.</p></div>
          <div><div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin-bottom:14px"><h3 class="ovt-h3" style="border:none;padding:0;margin:0">Condição de Pagamento (%)</h3><button type="button" class="ovt-btn out" ${ro ? "disabled" : ""} onclick="OrionViabilidadesApp.ov.modal='planos';OrionViabilidadesApp.render()">Selecionar Planos</button></div>
            ${plano ? `<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden"><div style="background:#f8fafc;padding:8px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-weight:600;color:#334155">Plano Ativo: ${e(r.plano_ativo)}</span><span style="font-size:0.75rem;font-weight:700;padding:4px 8px;border-radius:4px;${valido ? "background:#dcfce7;color:#15803d" : "background:#fee2e2;color:#b91c1c"}">Total: ${totPerc.toFixed(1)}%</span></div><div style="padding:16px">${conds}</div></div>`
              : `<div style="padding:24px;border:2px dashed #e2e8f0;border-radius:8px;text-align:center;color:#64748b">Nenhum plano ativo. Clique em "Gerenciar Planos" para configurar.</div>`}</div></div>
        ${matriz}
        ${this.ov.modal === "planos" ? this.htmlModalPlanos(r) : ""}</div>`;
    },
    htmlModalPlanos(r) {
      const e = (s) => this.esc(s), planos = (this.apoio && this.apoio.planos) || [];
      return `<div class="ovt-modal-fundo" onclick="if(event.target===this){OrionViabilidadesApp.ov.modal=null;OrionViabilidadesApp.render()}"><div class="ovt-modal">
        <div class="ovt-modal-cab"><div style="font-size:1.25rem;font-weight:700;color:#1e293b">Selecionar Plano de Pagamento</div><button type="button" style="border:none;background:none;font-size:1.4rem;color:#94a3b8;cursor:pointer" onclick="OrionViabilidadesApp.ov.modal=null;OrionViabilidadesApp.render()">×</button></div>
        <div style="padding:24px;overflow-y:auto;flex:1;background:rgba(248,250,252,.5)">${!planos.length ? `<div style="text-align:center;padding:48px;color:#64748b"><p>Nenhum plano cadastrado no módulo de Apoio.</p><p style="font-size:0.85rem">Acesse Configurações gerais &gt; Premissas da viabilidade &gt; Planos de pagamento para cadastrar novos planos.</p></div>`
          : `<div style="display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${planos.map((p, i) => { const at = r.plano_ativo === p.nome; const t = (p.condicoes || []).reduce((s, c) => s + (Number(c.perc) || 0), 0); const ok = Math.abs(t - 100) < 0.01; return `<div style="background:#fff;border:1px solid ${at ? "#2E864D" : "#e2e8f0"};${at ? "box-shadow:0 0 0 1px #2E864D;" : ""}border-radius:8px;overflow:hidden;display:flex;flex-direction:column">
              <div style="background:#f8fafc;padding:12px 16px;border-bottom:1px solid #e2e8f0;min-height:64px;display:flex;align-items:center"><span style="font-weight:700;color:#334155;font-size:0.85rem" title="${e(p.nome)}">${e(p.nome)}</span></div>
              <div style="padding:16px;flex:1;max-height:200px;overflow-y:auto">${(p.condicoes || []).map((c) => `<div style="border-bottom:1px solid #f8fafc;padding-bottom:4px;margin-bottom:4px"><div style="display:flex;justify-content:space-between;font-size:0.75rem"><span style="color:#475569;font-weight:500">${e(c.nome)}</span><b>${Number(c.perc || 0).toFixed(1)}%</b></div><div style="display:flex;gap:8px;font-size:10px;color:#94a3b8">${c.aplica_juros !== false ? `<span style="color:#3b82f6;background:#eff6ff;padding:0 4px;border-radius:3px">Juros</span>` : `<span style="text-decoration:line-through">Juros</span>`}${c.aplica_correcao !== false ? `<span style="color:#f97316;background:#fff7ed;padding:0 4px;border-radius:3px">Correção</span>` : `<span style="text-decoration:line-through">Correção</span>`}</div></div>`).join("")}</div>
              <div style="padding:16px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;flex-direction:column;gap:12px"><div style="display:flex;justify-content:space-between;font-size:0.75rem"><b style="color:#64748b">Total:</b><b style="color:${ok ? "#16a34a" : "#ef4444"}">${t.toFixed(1)}%</b></div><button type="button" class="ovt-btn ${at ? "prim" : "out"}" style="width:100%" onclick="OrionViabilidadesApp.selecionarPlano(${i})">${at ? "Plano Atual" : "Selecionar"}</button></div></div>`; }).join("")}</div>`}</div>
        <div style="padding:16px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end"><button type="button" class="ovt-btn out" onclick="OrionViabilidadesApp.ov.modal=null;OrionViabilidadesApp.render()">Fechar</button></div></div></div>`;
    },
    selecionarPlano(i) {
      const p = ((this.apoio && this.apoio.planos) || [])[i];
      if (!p) return;
      const r = this.r("revenue");
      r.condicoes_pagamento_json = [clone({ nome: p.nome, condicoes: p.condicoes || [] })];
      r.plano_ativo = p.nome;
      this.ov.modal = null;
      this.render();
    },
    condicaoSet(i, k, v, tipo) {
      const r = this.r("revenue"), p = this.planoAtivo(r);
      if (!p || !p.condicoes[i]) return;
      p.condicoes[i][k] = tipo === "num" ? (String(v).trim() === "" ? 0 : NUM(v)) : tipo === "int1" ? (String(v).trim() === "" ? 1 : Math.trunc(NUM(v))) : tipo === "bool" ? !!v : v;
      this.rr();
    },
    receitaCorrecao() {
      const r = this.r("revenue"), inds = (this.apoio && this.apoio.indices) || [];
      if (r.taxa_correcao_projetada == null && inds.length) {
        const i = Math.max(0, inds.findIndex((x) => x.index_type === "INCC"));
        const ind = inds[i];
        Object.assign(r, { origem_correcao: "PROJETADO", indice_correcao_id: this.indiceId(ind, i), taxa_correcao_projetada: ind.valor, tipo_correcao_projetada: ind.tipo_unidade, nome_indice_mercado: null });
      } else Object.assign(r, { indice_correcao_id: null, taxa_correcao_projetada: null, origem_correcao: null, nome_indice_mercado: null });
      this.render();
    },
    receitaOrigem(v) {
      const r = this.r("revenue"), ap = this.apoio || {};
      if (v === "PROJETADO") { const inds = ap.indices || []; const i = Math.max(0, inds.findIndex((x) => x.index_type === "INCC")); const ind = inds[i]; Object.assign(r, { origem_correcao: v, indice_correcao_id: ind ? this.indiceId(ind, i) : null, taxa_correcao_projetada: ind ? ind.valor : null, tipo_correcao_projetada: ind ? ind.tipo_unidade : "% a.a.", nome_indice_mercado: null }); }
      else { const ind = (ap.focus || []).find((x) => x.index_type === "INCC") || (ap.focus || [])[0]; Object.assign(r, { origem_correcao: v, indice_correcao_id: null, taxa_correcao_projetada: ind ? ind.valor : null, tipo_correcao_projetada: "% a.a.", nome_indice_mercado: ind ? ind.index_type : null }); }
      this.render();
    },
    receitaFocus(v) { const r = this.r("revenue"), ind = ((this.apoio || {}).focus || []).find((x) => x.index_type === v); if (ind) Object.assign(r, { nome_indice_mercado: ind.index_type, taxa_correcao_projetada: ind.valor, tipo_correcao_projetada: "% a.a." }); this.render(); },
    receitaIndice(v) { const r = this.r("revenue"), inds = (this.apoio || {}).indices || []; const i = inds.findIndex((x, k) => String(this.indiceId(x, k)) === String(v)); if (i >= 0) Object.assign(r, { indice_correcao_id: this.indiceId(inds[i], i), taxa_correcao_projetada: inds[i].valor, tipo_correcao_projetada: inds[i].tipo_unidade }); this.render(); },
    receitaCurvaSel(v) { const r = this.r("revenue"); r.velocidade_vendas_json = Object.assign({}, r.velocidade_vendas_json || {}, { curve_id: v }); this.render(); },
    matrizSet(ci, mi, v) {
      const r = this.r("revenue"), p = this.planoAtivo(r);
      if (!p || !p.condicoes[ci]) return;
      const ms = ((p.condicoes[ci].curve_json || {}).meses || []).slice();
      while (ms.length <= mi) ms.push(0);
      ms[mi] = String(v).trim() === "" ? 0 : NUM(v);
      p.condicoes[ci].curve_json = { meses: ms, mes_inicio: 1, is_raw_lots: true };
      this.rr();
    },
    /** Igual ao Órion: lotes por condição pelo método dos maiores restos; proporcional (cada condição segue a curva) ou cascata. */
    aplicarCurvaMatriz() {
      const r = this.r("revenue"), p = this.planoAtivo(r);
      const cid = (r.velocidade_vendas_json || {}).curve_id;
      const curva = ((this.apoio || {}).curvas || []).find((c) => String(this.curvaId(c)) === String(cid));
      if (!p || !curva) return;
      const cm = (curva.meses || []).map((m) => Number(m) || 0);
      if (!cm.length) return;
      const f = this.faseAtual(), ph = f.physical_data || {};
      const total = (Number(ph.qtde_lotes_residenciais) || 0) + (Number(ph.qtde_lotes_comerciais) || 0) + (Number(ph.qtde_lotes_mistos) || 0);
      const dist = (n, pesos) => { const tp = pesos.reduce((s, w) => s + w, 0); if (!tp) return pesos.map(() => 0); const ex = pesos.map((w) => (n * w) / tp); const al = ex.map((v) => Math.floor(v)); const rest = ex.map((v, i) => ({ i, r: v - Math.floor(v) })); const falta = n - al.reduce((s, v) => s + v, 0); rest.sort((a, b) => b.r - a.r); for (let i = 0; i < falta && i < rest.length; i++) al[rest[i].i] += 1; return al; };
      const alvo = dist(total, p.condicoes.map((c) => Number(c.perc) || 0));
      if (this.ov.metodo === "cascata") {
        const porMes = dist(total, cm);
        p.condicoes.forEach((c) => { c.curve_json = { meses: new Array(cm.length).fill(0), mes_inicio: 1, is_raw_lots: true }; });
        let ci = 0, resta = alvo[0] || 0;
        for (let m = 0; m < cm.length; m++) {
          let noMes = porMes[m];
          while (noMes > 0 && ci < p.condicoes.length) {
            const q = Math.min(noMes, resta);
            p.condicoes[ci].curve_json.meses[m] += q;
            noMes -= q; resta -= q;
            if (resta === 0) { ci++; if (ci < p.condicoes.length) resta = alvo[ci]; }
          }
        }
      } else p.condicoes.forEach((c, i) => { c.curve_json = { meses: dist(alvo[i], cm), mes_inicio: 1, is_raw_lots: true }; });
      if (cm.length > this.ov.colunas) this.ov.colunas = cm.length;
      this.render();
    },
    matrizModelo() {
      const r = this.r("revenue"), p = this.planoAtivo(r);
      if (!p || !window.XLSX) return;
      const n = this.ov.colunas;
      const ws = [["Condição"].concat(Array.from({ length: n }).map((_, i) => `Mês ${i + 1}`))].concat(p.condicoes.map((c) => [c.nome].concat(Array.from({ length: n }).map((_, i) => ((c.curve_json || {}).meses || [])[i] || 0))));
      const wb = window.XLSX.utils.book_new();
      const sh = window.XLSX.utils.aoa_to_sheet(ws);
      sh["!cols"] = [{ wch: 20 }].concat(Array(n).fill({ wch: 10 }));
      window.XLSX.utils.book_append_sheet(wb, sh, "MatrizVendas");
      window.XLSX.writeFile(wb, `matriz_vendas_${String(r.plano_ativo || "plano").replace(/\s+/g, "_")}.xlsx`);
    },
    matrizImportar(input) {
      const arq = input.files && input.files[0];
      input.value = "";
      if (!arq || !window.XLSX) return;
      const rd = new FileReader();
      rd.onload = (ev) => {
        try {
          const wb = window.XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
          const linhas = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
          const r = this.r("revenue"), p = this.planoAtivo(r);
          if (!p) return;
          let n = 0, maior = this.ov.colunas;
          linhas.slice(1).filter((l) => l.length >= 1 && l[0]).forEach((l) => {
            const i = p.condicoes.findIndex((c) => String(c.nome).trim() === String(l[0]).trim());
            if (i < 0) return;
            const ms = l.slice(1).map((v) => { const x = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(x) ? 0 : Math.max(0, x); });
            if (ms.length > maior) maior = ms.length;
            p.condicoes[i].curve_json = { meses: ms, mes_inicio: 1, is_raw_lots: true };
            n++;
          });
          this.ov.colunas = maior;
          this.render();
          window.alert(`✅ ${n} condições atualizadas com sucesso!`);
        } catch (e) { window.alert("Erro ao ler a planilha. Verifique o formato do arquivo."); }
      };
      rd.readAsArrayBuffer(arq);
    }
  });
})();
