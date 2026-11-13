/* Órion (transição) › Acompanhamento de empreendimentos › bloco "Viabilidade × realizado" no detalhe de cada obra.
 * Antes era uma tela à parte (Viabilidade × realizado). Agora a comparação vive no detalhe do empreendimento e usa o mesmo caixa
 * do Acompanhamento (realizado + contas em aberto + cronograma de obra + terreno informado + projeção do estoque), na visão
 * consolidada, contra a viabilidade aprovada ligada à obra (campo "obra_cc" da viabilidade, o mesmo da tela Viabilidades):
 *  - por categoria, na mesma separação do DRE do Acompanhamento (receita, impostos, terreno, projetos, obras, adm. da obra, extras,
 *    marketing, comercial, administrativas, despesas extras, funding e lucro), com diferença, % e semáforo;
 *  - por ano: fluxo de caixa da viabilidade (alinhado ao mês 1) × fluxo do Acompanhamento;
 *  - sem viabilidade ligada: escolher uma viabilidade aprovada numa lista e vincular (grava só obra_cc / obra_cc_nome nela).
 * Só leitura, menos o vínculo. */
(function () {
  const A = window.OrionObrasApp;
  if (!A) return;
  const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  Object.assign(A, {
    vvMemo: {}, vvTaxas: null, vvLendoTaxas: false, vvEscolha: "", vvGravando: false, vvMsg: "", vvAberto: true,

    vvPodeVincular() { return (typeof window.isCrmSuperAdmin === "function" && window.isCrmSuperAdmin()) || (typeof window.hasCrmPerm === "function" && window.hasCrmPerm("sub_orion_geral_viabilidades_editar")); },
    vvLista() { const VA = window.OrionViabilidadesApp; return ((VA && VA.lista) || []).filter((d) => !d.excluido); },
    /** Viabilidade aprovada ligada a algum centro da obra (a versão aprovada da família; sem aprovada, nenhuma). */
    vvDaObra(item) {
      const ccs = new Set((item.membros || []).map((m) => String(m.cc)));
      const l = this.vvLista().filter((d) => d.status === "Aprovado" && d.obra_cc && ccs.has(String(d.obra_cc)));
      return l.sort((a, b) => (a.versao_de ? 1 : 0) - (b.versao_de ? 1 : 0))[0] || null;
    },
    vvFases(doc) { if (Array.isArray(doc.fases)) return doc.fases; try { return JSON.parse(doc.fases_json || "[]"); } catch (e) { return []; } },
    vvInicio(doc) {
      if (doc.mes1_acompanhamento) return doc.mes1_acompanhamento;
      const dt = (this.vvFases(doc)[0] || {}).dates || {};
      const d = dt.data_lancamento || dt.data_inicio_obras || dt.data_registro || dt.data_inicio_comercial || "";
      return /^\d{4}-\d{2}/.test(String(d)) ? String(d).slice(0, 7) : "";
    },
    async vvLerTaxas() {
      if (this.vvTaxas || this.vvLendoTaxas || !window.OrionStore) return;
      this.vvLendoTaxas = true;
      try {
        const padrao = window.OrionPremissasApp ? JSON.parse(JSON.stringify(window.OrionPremissasApp.FUNDING_PADRAO || {})) : {};
        this.vvTaxas = (await window.OrionStore.ler("taxas_funding", padrao)).itens || {};
      } catch (e) { this.vvTaxas = {}; }
      this.vvLendoTaxas = false;
      this.render();
    },
    /** Viabilidade: totais por categoria (todas as fases) e fluxo por mês (índice 0 = mês 1). */
    vvPrevisto(doc) {
      const V = window.OrionViabilidadeCalc;
      if (!V || !this.vvTaxas) return null;
      const k = doc._id + "|" + (doc.versao || 0) + "|" + (doc.atualizado_em || "");
      if (this.vvMemo[k]) return this.vvMemo[k];
      const fases = this.vvFases(doc);
      const d = Object.assign({}, doc, { fases });
      const rs = fases.map((f, i) => V.calcular(V.faseDoDoc(d, i), null, this.vvTaxas));
      const S = (c) => rs.reduce((s, r) => s + (r.monthly_cashflow || []).reduce((x, m) => x + (Number(m[c]) || 0), 0), 0);
      const obras = S("Obras"), desp = S("Despesas");
      const cat = {
        receita: S("Receitas"), impostos: S("Impostos"), terreno: S("Terreno") + S("Obras_Aq"), projetos: S("Obras_Proj"), obras: S("Obras_Custo"), adm_obra: S("Obras_Adm"),
        custo_extra_obra: obras - S("Obras_Custo") - S("Obras_Proj") - S("Obras_Aq") - S("Obras_Adm"),
        marketing: S("Despesas_Mkt"), comercial: S("Despesas_Com"), administrativas: S("Despesas_Adm"), despesas_extras: desp - S("Despesas_Mkt") - S("Despesas_Com") - S("Despesas_Adm"),
        funding: S("Funding_Despesas") - S("Funding_Amortizacao")
      };
      cat.lucro = cat.receita - cat.impostos - obras - S("Terreno") - desp - cat.funding;
      const n = Math.max(0, ...rs.map((r) => (r.monthly_cashflow || []).length));
      const fluxo = [];
      for (let i = 0; i < n; i++) fluxo.push(rs.reduce((s, r) => s + (((r.monthly_cashflow || [])[i] || {}).Fluxo_de_Caixa || 0), 0));
      const ind = rs.length === 1 ? rs[0].indicators : V.consolidar(rs, (doc.taxa_desconto_vpl || 12) / 100);
      return (this.vvMemo[k] = { cat, fluxo, ind });
    },
    /** Acompanhamento (visão consolidada, com projeção): os mesmos totais por categoria. */
    vvAcomp(item) {
      const acts = this.actsDe(item, "consolidado", false);
      if (!acts) return null;
      const s = (k) => acts.reduce((x, a) => x + (Number(a[k]) || 0), 0);
      const det = this.C().detalheGrupo(acts, this.tmaDe(item.membros.map((m) => m.cc)));
      return { det, cat: { receita: s("receita_bruta"), impostos: s("impostos"), terreno: s("terreno"), projetos: s("projetos"), obras: s("obras"), adm_obra: s("adm_obra"), custo_extra_obra: s("custo_extra_obra"),
        marketing: s("marketing"), comercial: s("comercial"), administrativas: s("administrativas"), despesas_extras: s("despesas_extras"), funding: s("funding"), lucro: s("lucro_liq_operacional") } };
    },
    vvFarol(n, ref, tipo) {
      const C = window.OrionOrcamentoCalc;
      if (!C || !C.semaforo) return "";
      const s = C.semaforo(Math.round(n * 100), Math.round(ref * 100), tipo);
      const cores = { azul: "#0ea5e9", cinza: "#cbd5e1", verde: "#10b981", amarelo: "#fbbf24", vermelho: "#ef4444" };
      return `<span title="${this.esc(s.titulo)}" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${cores[s.cor]};margin-right:6px;vertical-align:middle"></span>`;
    },

    /* ---------- vínculo ---------- */
    vvEscolher(id) { this.vvEscolha = id; this.vvMsg = ""; },
    /** Vai ao bloco: abre o empreendimento (o atual ou o primeiro da lista) e rola até "Viabilidade × realizado". */
    irViab() {
      this.vvAberto = true;
      if (!this.aberto) { const l = this.filtrada().filter((r) => r.tipo === "obra"); if (!l.length) return; this.abrir(l[0].id); }
      else this.render();
      setTimeout(() => { const el = document.getElementById("oob-vv"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80);
    },
    async vvVincular(item) {
      const id = this.vvEscolha;
      const doc = this.vvLista().find((d) => d._id === id);
      if (!doc || !this.vvPodeVincular()) return;
      const cc = String((item.membros[0] || {}).cc || "");
      const nome = (item.membros[0] || {}).nome || item.nome;
      if (doc.obra_cc && String(doc.obra_cc) !== cc && !window.confirm(`A viabilidade ${doc.project_name} já está ligada ao centro ${doc.obra_cc}. Trocar para ${cc}?`)) return;
      const fx = window.firebaseCollections;
      this.vvGravando = true; this.render();
      try {
        const ref = fx.doc(window.firebaseDb, "orion_viabilidades", doc._id);
        await fx.runTransaction(window.firebaseDb, async (tx) => {
          const s = await tx.get(ref);
          if (!s.exists()) throw new Error("Viabilidade não encontrada.");
          const atual = s.data();
          tx.set(ref, Object.assign({}, atual, { obra_cc: cc, obra_cc_nome: nome, versao: (Number(atual.versao) || 0) + 1, atualizado_por: window.OrionStore ? window.OrionStore.usuario() : "", atualizado_em: new Date().toISOString() }));
        });
        doc.obra_cc = cc; doc.obra_cc_nome = nome;
        this.vvMsg = `Viabilidade ${doc.project_name} ligada ao centro ${cc}.`;
      } catch (e) { this.vvMsg = "Não consegui gravar: " + (e.message || e); }
      this.vvGravando = false; this.render();
    },

    /* ---------- bloco ---------- */
    htmlViabRealizado(item) {
      const VA = window.OrionViabilidadesApp;
      if (VA && !VA.lista && typeof VA.carregar === "function" && !this._vvCarregandoViab) { this._vvCarregandoViab = true; Promise.resolve(VA.carregar()).then(() => this.render()).catch(() => {}); }
      if (!this.vvTaxas) this.vvLerTaxas();
      const titulo = `<h3 style="display:flex;align-items:center;gap:10px;cursor:pointer" onclick="OrionObrasApp.vvAberto=!OrionObrasApp.vvAberto;OrionObrasApp.render()">${this.vvAberto ? "▾" : "▸"} Viabilidade × realizado <span style="font-size:0.7rem;font-weight:600;color:#6b8474;text-transform:none;letter-spacing:0">o que a viabilidade aprovada previu × o caixa do Acompanhamento (realizado + em aberto + projeção)</span></h3>`;
      if (!this.vvAberto) return `<div id="oob-vv" class="oac-card oac-nao-imprime" style="margin-top:16px">${titulo}</div>`;
      const doc = this.vvDaObra(item);
      if (!doc) {
        const lista = this.vvLista().filter((d) => d.status === "Aprovado").sort((a, b) => String(a.project_name).localeCompare(String(b.project_name), "pt-BR"));
        const sel = window.MlSelectUnico && lista.length ? MlSelectUnico.html({ id: "oob-vv-sel", label: "Viabilidade aprovada", items: lista.map((d) => ({ id: d._id, label: `${d.project_name}${d.city ? " · " + d.city : ""}${d.obra_cc ? " (ligada ao centro " + d.obra_cc + ")" : ""}` })), selectedId: this.vvEscolha, semId: true, placeholder: "Digite o nome da viabilidade..." }) : "";
        return `<div id="oob-vv" class="oac-card" style="margin-top:16px;scroll-margin-top:16px">${titulo}<div style="padding:14px 16px;font-size:0.82rem;color:#4a6355">
            <p style="margin:0 0 10px">Nenhuma viabilidade <b>aprovada</b> está ligada aos centros desta obra (${item.membros.map((m) => this.esc(m.cc)).join(", ")}). ${lista.length ? "Escolha a viabilidade desta obra para comparar:" : "Não há viabilidade aprovada no Integra. Aprove a viabilidade em Órion (transição) › Viabilidades para comparar aqui."}</p>
            ${lista.length && this.vvPodeVincular() ? window.OrionFiltros.grade([{ campos: [`<div class="ofg-f ofg-span3">${sel}</div>`] }], `<button type="button" class="btn btn-primary" ${this.vvGravando ? "disabled" : ""} onclick="OrionObrasApp.vvVincular(OrionObrasApp.linhasLista().find((r) => r.id === OrionObrasApp.aberto))">${this.vvGravando ? "Gravando…" : "Vincular à obra"}</button>`, { cls: "ofg-plano" }) : lista.length ? `<p style="margin:0;color:#92400e">Só quem edita viabilidades pode fazer o vínculo.</p>` : ""}
            ${this.vvMsg ? `<p style="margin:8px 0 0;color:#105436">${this.esc(this.vvMsg)}</p>` : ""}</div></div>`;
      }
      const prev = this.vvPrevisto(doc);
      const ac = this.vvAcomp(item);
      if (!ac) return `<div id="oob-vv" class="oac-card" style="margin-top:16px">${titulo}<div style="padding:16px;color:#64748b;font-size:0.82rem">Viabilidade ligada: <b>${this.esc(doc.project_name)}</b>. Clique em <b>Atualizar com o Sienge</b> para ler o caixa da obra e montar a comparação.</div></div>`;
      if (!prev || !ac) return `<div id="oob-vv" class="oac-card" style="margin-top:16px;scroll-margin-top:16px">${titulo}<div style="padding:20px;text-align:center;color:#64748b"><div class="spinner" style="margin:0 auto 8px"></div>Calculando a viabilidade…</div></div>`;
      const R = (v) => this.R$(Math.abs(v || 0) < 0.5 ? 0 : v);
      const N0 = (v) => (Math.abs(v || 0) < 0.5 ? "—" : Math.round(v).toLocaleString("pt-BR"));
      const pc = (a, b) => (Math.abs(b) > 0.5 ? (((a - b) / Math.abs(b)) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%" : "—");
      const linhas = [
        ["Receita bruta", "receita", "RECEITAS", 0], ["Impostos", "impostos", "DESPESAS", 1],
        ["Custo", null, null, 0], ["Terreno / aquisição de área", "terreno", "DESPESAS", 1], ["Projetos", "projetos", "DESPESAS", 1], ["Obras de infraestrutura", "obras", "DESPESAS", 1], ["Administração da obra", "adm_obra", "DESPESAS", 1], ["Custos extras de obras", "custo_extra_obra", "DESPESAS", 1],
        ["Despesas operacionais", null, null, 0], ["Marketing", "marketing", "DESPESAS", 1], ["Comercial / comissões", "comercial", "DESPESAS", 1], ["Administrativas", "administrativas", "DESPESAS", 1], ["Despesas extras", "despesas_extras", "DESPESAS", 1],
        ["Funding (juros e estruturação)", "funding", "DESPESAS", 0], ["Lucro líquido operacional", "lucro", "RECEITAS", 0]
      ];
      const somaG = (o, ks) => ks.reduce((s, k) => s + (o[k] || 0), 0);
      const grupos = { "Custo": ["terreno", "projetos", "obras", "adm_obra", "custo_extra_obra"], "Despesas operacionais": ["marketing", "comercial", "administrativas", "despesas_extras"] };
      const corpo = linhas.map(([nome, k, tipo, nivel]) => {
        const v = k ? prev.cat[k] : somaG(prev.cat, grupos[nome]), a = k ? ac.cat[k] : somaG(ac.cat, grupos[nome]), t = tipo || "DESPESAS";
        const ruim = t === "DESPESAS" ? a - v > 0.5 : v - a > 0.5;
        const forte = !k || k === "lucro" || k === "receita";
        return `<tr style="${k === "lucro" ? "background:#105436;color:#fff;font-weight:800" : forte ? "font-weight:800;background:#f7faf8" : ""}"><td style="padding-left:${10 + nivel * 18}px;${k === "lucro" ? "background:#105436;color:#fff" : ""}">${this.esc(nome)}</td>
          <td class="is-right" style="${k === "lucro" ? "background:#105436;color:#fff" : ""}">${R(v)}</td><td class="is-right" style="${k === "lucro" ? "background:#105436;color:#fff" : ""}">${R(a)}</td>
          <td class="is-right" style="${k === "lucro" ? "background:#105436;color:#fff" : ruim ? "color:#b91c1c" : ""}">${this.vvFarol(a, v, t)}${R(a - v)}</td><td class="is-right" style="${k === "lucro" ? "background:#105436;color:#fff" : ruim ? "color:#b91c1c" : ""}">${pc(a, v)}</td></tr>`;
      }).join("");
      // por ano: viabilidade alinhada ao mês 1 × fluxo do Acompanhamento
      const ini = this.vvInicio(doc);
      const porAnoV = {};
      if (/^\d{4}-\d{2}$/.test(ini)) { const [ai, mi] = ini.split("-").map(Number); prev.fluxo.forEach((v, i) => { const ano = ai + Math.floor((mi - 1 + i) / 12); porAnoV[ano] = (porAnoV[ano] || 0) + v; }); }
      const porAnoA = {};
      (ac.det.fluxo_caixa || []).forEach((r) => { porAnoA[r.Ano] = (porAnoA[r.Ano] || 0) + (r.Saldo_Mes || 0); });
      const anos = [...new Set(Object.keys(porAnoV).concat(Object.keys(porAnoA)))].sort();
      let acV = 0, acA = 0;
      const anosT = anos.map((y) => { const v = porAnoV[y] || 0, a = porAnoA[y] || 0; acV += v; acA += a; return `<tr><td style="font-weight:700">${y}</td><td class="is-right">${N0(v)}</td><td class="is-right">${N0(a)}</td><td class="is-right" style="${a - v < -0.5 ? "color:#b91c1c" : ""}">${N0(a - v)}</td><td class="is-right">${N0(acV)}</td><td class="is-right">${N0(acA)}</td></tr>`; }).join("");
      const ind = prev.ind || {}, d = ac.det;
      const P = (v) => (v == null || isNaN(v) ? "n/d" : this.P(v));
      const kp = (t, v, a) => `<div style="border:1px solid #dfe9e3;border-radius:8px;padding:8px 10px;background:#fff"><div style="font-size:0.64rem;color:#64748b;font-weight:700;text-transform:uppercase">${t}</div><div style="font-size:0.85rem;font-weight:800;color:#1c2e24">${v} <span style="color:#94a3b8;font-weight:600">→</span> ${a}</div><div style="font-size:0.64rem;color:#64748b">viabilidade → acompanhamento</div></div>`;
      return `<div id="oob-vv" class="oac-card" style="margin-top:16px;scroll-margin-top:16px">${titulo}
        <div style="padding:0 16px 6px;font-size:0.72rem;color:#6b8474">Viabilidade <b>${this.esc(doc.project_name)}</b> (aprovada${doc.versao_de ? ", cenário" : ""}) · ${this.vvFases(doc).length} fase(s) · mês 1 = ${ini ? this.esc(ini.split("-").reverse().join("/")) : "sem data (o por ano fica vazio)"} · ligada ao centro ${this.esc(doc.obra_cc)}. Acompanhamento na visão consolidada, com a projeção do estoque. Semáforo: custo acima do previsto ou receita/lucro abaixo ficam em vermelho.</div>
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:6px 16px 10px">
          ${kp("Lucro", R(prev.cat.lucro), R(ac.cat.lucro))}${kp("TIR (a.a.)", P(ind.tir_aa), P(d.tir_anual))}${kp("Exposição máxima", R(ind.exposicao_maxima), R(d.exposicao_maxima))}${kp("Payback", (ind.payback || "—") + "º mês", (d.payback || "—") + "º mês")}</div>
        <div style="display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:16px;padding:0 16px 14px;align-items:start">
          <div><div style="font-size:0.72rem;font-weight:800;color:#105436;text-transform:uppercase;margin-bottom:4px">Por categoria (vida do empreendimento)</div>
            <div class="cc-scroll"><table class="cc-table" style="font-size:0.78rem"><colgroup><col><col style="width:120px"><col style="width:120px"><col style="width:120px"><col style="width:70px"></colgroup>
            <thead><tr><th>Categoria</th><th class="is-right">Viabilidade</th><th class="is-right">Acompanhamento</th><th class="is-right">Diferença</th><th class="is-right">%</th></tr></thead><tbody>${corpo}</tbody></table></div></div>
          <div><div style="font-size:0.72rem;font-weight:800;color:#105436;text-transform:uppercase;margin-bottom:4px">Fluxo de caixa por ano <span style="font-weight:600;color:#6b8474;text-transform:none">(R$)</span></div>
            <div class="cc-scroll" style="max-height:420px"><table class="cc-table" style="font-size:0.78rem"><thead><tr><th>Ano</th><th class="is-right">Viabilidade</th><th class="is-right">Acompanh.</th><th class="is-right">Diferença</th><th class="is-right">Acum. viab.</th><th class="is-right">Acum. acomp.</th></tr></thead>
            <tbody>${anosT || `<tr><td colspan="6" style="text-align:center;padding:14px">Sem mês 1 na viabilidade.</td></tr>`}${anos.length ? `<tr class="oob-total"><td>Total</td><td class="is-right">${N0(acV)}</td><td class="is-right">${N0(acA)}</td><td class="is-right">${N0(acA - acV)}</td><td></td><td></td></tr>` : ""}</tbody></table></div></div></div></div>`;
    }
  });

  // liga o seletor de viabilidade depois de cada render do detalhe
  const renderAntes = A.render;
  A.render = function () {
    renderAntes.apply(this, arguments);
    if (this.aberto && window.MlSelectUnico && document.getElementById("oob-vv-sel")) MlSelectUnico.bind("oob-vv-sel", { onSelect: (id) => this.vvEscolher(id) });
  };
})();
