const FinanciamentoState = {
  view: "busca",
  painel: "dashboard",
  dashboardPeriodo: "",
  dashboardDetalhe: null,
  dashboardMostrarVazias: false,
  customer: null,
  contracts: [],
  selected: null,
  process: null
};

const FIN_PROC_KEY = "crm_moura_financiamentos_proc";
const FIN_TERMO_STAGE_ID = "fin-01";
const FIN_DECLARACAO_STAGE_ID = "fin-05";
const FIN_TERMO_TEMPLATE_URL = "assets/termos/termo-simulacao-saldo-devedor.docx?v=2176";
const FIN_DECLARACAO_TEMPLATE_URL = "assets/termos/declaracao-saldo-devedor-interveniente-quitante.docx?v=2183";
const FIN_TERMO_SIENGE_TAG = "TERMO DE SIMULAÇÃO DO SALDO DEVEDOR";
const FIN_DECLARACAO_SIENGE_TAG = "DECLARAÇÃO DE SALDO DEVEDOR PARA EFEITOS DE INTERVENIENTE QUITANTE";

const FinanciamentoApp = {
  esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  },

  fmtDate(raw) {
    if (!raw) return "—";
    const s = String(raw).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [y, m, d] = s.split("-");
      return `${d}/${m}/${y}`;
    }
    return s;
  },

  fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  },

  formatUnidade(raw) {
    let s = String(raw == null ? "" : raw).trim();
    if (!s || s === "—" || s === "N/D") return s || "—";
    s = s.replace(/^quadra-lote:\s*/i, "").trim();
    s = s.replace(/^u[\.\s\-]+/i, "").trim();
    return s || "—";
  },

  init() {
    if (!FinanciamentoState.dashboardPeriodo) {
      const agora = new Date();
      FinanciamentoState.dashboardPeriodo = agora.getFullYear() + "-" + String(agora.getMonth() + 1).padStart(2, "0");
    }
    this.render();
    this.populateEmpreendimentos();
    this.puxarNuvem();
  },

  /* A lista de financiamentos só vinha da nuvem no login. Quem abriu o sistema antes de outra pessoa incluir
   * um financiamento não via o cliente na esteira. Agora, ao abrir a tela, junta com a nuvem (sem apagar nada)
   * e, se este navegador tiver algum que a nuvem ainda não tem, envia. */
  async puxarNuvem(forcar) {
    const agora = Date.now();
    if (!forcar && this._nuvemEm && agora - this._nuvemEm < 20000) return;
    if (this._nuvemLendo) return;
    const fc = window.firebaseCollections;
    if (!fc || !window.firebaseDb || typeof fc.getDoc !== "function" || typeof window.crmFinanciamentosMesclar !== "function") return;
    this._nuvemLendo = true;
    this._nuvemEm = agora;
    try {
      const snap = await fc.getDoc(fc.doc(window.firebaseDb, "config", "global"));
      const existe = snap && (typeof snap.exists === "function" ? snap.exists() : snap.exists);
      const nuvem = existe ? String((snap.data() || {})[FIN_PROC_KEY] || "{}") : "{}";
      let local = "{}";
      try { local = localStorage.getItem(FIN_PROC_KEY) || "{}"; } catch (e) {}
      const junto = window.crmFinanciamentosMesclar(local, nuvem);
      const mapaJunto = this.lerMapaProc(junto);
      const mapaNuvem = this.lerMapaProc(nuvem);
      const mapaLocal = this.lerMapaProc(local);
      const chegouNovo = Object.keys(mapaJunto).some((k) => !mapaLocal[k]
        || String(mapaJunto[k].updatedAt || "") !== String(mapaLocal[k].updatedAt || ""));
      const faltaNaNuvem = Object.keys(mapaJunto).some((k) => !mapaNuvem[k]
        || String(mapaJunto[k].updatedAt || "") > String(mapaNuvem[k].updatedAt || ""));
      if (junto !== local) {
        const gravar = window._originalSetItem || localStorage.setItem.bind(localStorage);
        try { gravar.call(localStorage, FIN_PROC_KEY, junto); } catch (e) {}
        try { sessionStorage.setItem(FIN_PROC_KEY, junto); } catch (e) {}
        window._finProcMem = mapaJunto;
      }
      if (faltaNaNuvem && window.forceUploadLocalConfig) window.forceUploadLocalConfig(true).catch(() => {});
      if (chegouNovo && FinanciamentoState.view !== "fluxo" && document.getElementById("financiamento-root")) this.render();
    } catch (e) {
      console.warn("[Financiamento] leitura da nuvem", e);
    } finally {
      this._nuvemLendo = false;
    }
  },

  render() {
    const root = document.getElementById("financiamento-root");
    if (!root) return;
    const noFluxo = FinanciamentoState.view === "fluxo";
    const painel = ["dashboard", "esteira", "concluidos", "pesquisa"].indexOf(FinanciamentoState.painel) >= 0
      ? FinanciamentoState.painel : "dashboard";
    const corpo = painel === "dashboard" ? this.dashboardHtml()
      : (painel === "esteira" ? this.esteiraHtml()
        : (painel === "concluidos" ? this.concluidosHtml() : this.buscaHtml()));
    if (noFluxo) {
      this.carregarSaldoQuitacao(FinanciamentoState.process);
      this.carregarMetragemLote(FinanciamentoState.process);
    }
    root.innerHTML = noFluxo ? this.fluxoHtml() : (this.abasHtml(painel) + corpo);
    if (window.lucide) lucide.createIcons();
    if (!noFluxo && painel === "pesquisa") this.restoreBuscaUi();
    if (noFluxo) {
      this.prepararTagsUnidade();
      this.ligarEtapa();
    }
  },

  setPainel(id) {
    if (FinanciamentoState.process) this.saveProcess(FinanciamentoState.process);
    FinanciamentoState.painel = ["dashboard", "esteira", "concluidos", "pesquisa"].indexOf(id) >= 0 ? id : "dashboard";
    FinanciamentoState.view = "busca";
    this.render();
    this.puxarNuvem();
  },

  listEsteiraProcesses() {
    return this.listOpenProcesses().filter((row) => row && row.proc && row.proc.currentStageId);
  },

  abasHtml(painel) {
    const n = this.listEsteiraProcesses().length;
    const concluidos = this.listCompletedProcesses().length;
    return `<div class="ml-tabs fin-abas" role="tablist">
      <button type="button" role="tab" aria-selected="${painel === "dashboard"}" class="ml-tab ${painel === "dashboard" ? "is-active" : ""}" onclick="FinanciamentoApp.setPainel('dashboard')"><i data-lucide="chart-no-axes-combined"></i> Dashboard</button>
      <button type="button" role="tab" aria-selected="${painel === "pesquisa"}" class="ml-tab ${painel === "pesquisa" ? "is-active" : ""}" onclick="FinanciamentoApp.setPainel('pesquisa')"><i data-lucide="search"></i> Pesquisar</button>
      <button type="button" role="tab" aria-selected="${painel === "esteira"}" class="ml-tab ${painel === "esteira" ? "is-active" : ""}" onclick="FinanciamentoApp.setPainel('esteira')"><i data-lucide="columns-3"></i> Esteira <span class="ml-tab-count">${n}</span></button>
      <button type="button" role="tab" aria-selected="${painel === "concluidos"}" class="ml-tab ${painel === "concluidos" ? "is-active" : ""}" onclick="FinanciamentoApp.setPainel('concluidos')"><i data-lucide="circle-check-big"></i> Concluídos <span class="ml-tab-count">${concluidos}</span></button>
    </div>`;
  },

  dataInicioDashboard(proc) {
    if (!proc) return "";
    if (proc.startedAt || proc.createdAt) return String(proc.startedAt || proc.createdAt).slice(0, 10);
    const datasEtapa = Object.values(proc.done || {}).map((data) => String(data || "").slice(0, 10))
      .filter((data) => /^\d{4}-\d{2}-\d{2}$/.test(data)).sort();
    return datasEtapa[0] || String(proc.updatedAt || "").slice(0, 10);
  },

  saldoDeclaradoDashboard(proc) {
    if (!proc || proc.saldoDevedorDeclarado == null || String(proc.saldoDevedorDeclarado).trim() === "") return null;
    const valor = typeof proc.saldoDevedorDeclarado === "number"
      ? proc.saldoDevedorDeclarado : this.parseValorComercialTermo(proc.saldoDevedorDeclarado);
    return Number.isFinite(valor) && valor >= 0 ? valor : null;
  },

  calcularValorComercialPorMetragem(proc) {
    if (!proc) return null;
    const metragem = Number(proc.metragemLote);
    if (!(Number.isFinite(metragem) && metragem > 0)) return null;
    const obra = this.obraDoProc(proc);
    const m2 = this.obterValorM2Comercial(
      proc.costCenterId || proc.empId,
      obra.empreendimento || proc.enterpriseName || ""
    );
    if (m2 == null) return null;
    return {
      metragem: metragem,
      valorM2: m2,
      valorComercial: Math.round(metragem * m2 * 100) / 100,
      fonte: "metragem-x-m2-2026"
    };
  },

  sincronizarValorComercialCalculado(proc) {
    const calc = this.calcularValorComercialPorMetragem(proc);
    if (!calc || !proc) return null;
    const atual = Number(proc.valorComercial);
    const m2Atual = Number(proc.valorM2Comercial);
    if (atual === calc.valorComercial
      && m2Atual === calc.valorM2
      && proc.valorComercialFonte === calc.fonte) {
      return calc.valorComercial;
    }
    proc.valorComercial = calc.valorComercial;
    proc.valorM2Comercial = calc.valorM2;
    proc.valorComercialFonte = calc.fonte;
    proc.valorComercialEm = this.hojeIso();
    this.saveProcess(proc);
    return calc.valorComercial;
  },

  valorComercialFicha(proc) {
    if (!proc) return null;
    const calc = this.calcularValorComercialPorMetragem(proc);
    if (calc) return calc.valorComercial;
    if (proc.valorComercialFonte === "metragem-x-m2-2026" || proc.valorComercialFonte === "boituva-manual") {
      const direto = Number(proc.valorComercial);
      if (Number.isFinite(direto) && direto > 0) return direto;
    }
    return null;
  },

  cidadeDoProc(proc) {
    const obra = this.obraDoProc(proc);
    const ccs = (window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || [];
    const id = String((proc && (proc.costCenterId || proc.empId)) || "");
    const cc = id ? ccs.find((c) => String(c.id) === id) : null;
    const direta = String((cc && (cc.city || cc.cidade || cc.cityName)) || (proc && proc.cidade) || "").trim();
    if (direta) return direta;
    const emp = String(obra.empreendimento || "").trim();
    const partes = emp.split(/\s+-\s+/);
    if (partes.length >= 2 && partes[0]) return partes[0].trim();
    return "Sem cidade";
  },

  agruparDashboard(lista, rotuloDe) {
    const mapa = new Map();
    (lista || []).forEach((row) => {
      const proc = row && row.proc ? row.proc : row;
      const key = row && row.key != null ? String(row.key) : this.procKey(proc.customerId, proc.contractId);
      const nome = String(rotuloDe(proc) || "—").trim() || "—";
      const atual = mapa.get(nome) || { nome: nome, quantidade: 0, itens: [] };
      atual.quantidade += 1;
      atual.itens.push({ key: key, proc: proc });
      mapa.set(nome, atual);
    });
    return Array.from(mapa.values()).sort((a, b) => b.quantidade - a.quantidade
      || String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  },

  nomeCurtoEtapaDash(nome) {
    let s = String(nome || "").replace(/^\d+(\.\d+)*\.?\s*/, "").trim();
    if (/aguardando defini/i.test(s)) return "Aguardando definição";
    if (/declara/i.test(s) && /saldo/i.test(s)) return "Declaração de saldo devedor";
    if (/aguardando minuta/i.test(s)) return "Aguardando minuta";
    if (/assinatura/i.test(s)) return "Assinatura do contrato";
    if (/desbloqueio/i.test(s)) return "Desbloqueio do crédito";
    if (/termo de quita/i.test(s)) return "Termo de quitação bancária";
    if (/termo de simula/i.test(s)) return "Termo de simulação";
    if (/carta siopi/i.test(s)) return "Carta SIOPI";
    if (/interveniente/i.test(s)) return "Interveniente quitante";
    if (s.length > 44) s = s.slice(0, 42) + "…";
    return s || "Etapa";
  },

  opcoesPeriodoDashboard(periodoAtual) {
    const opcoes = [];
    const base = new Date();
    for (let i = 0; i < 18; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const valor = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      const texto = label.charAt(0).toUpperCase() + label.slice(1);
      opcoes.push(`<option value="${this.esc(valor)}"${valor === periodoAtual ? " selected" : ""}>${this.esc(texto)}</option>`);
    }
    if (periodoAtual && !opcoes.some((o) => o.indexOf('value="' + periodoAtual + '"') >= 0)) {
      const [y, m] = String(periodoAtual).split("-");
      const d = new Date(Number(y), Number(m) - 1, 1);
      const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      const texto = label.charAt(0).toUpperCase() + label.slice(1);
      opcoes.unshift(`<option value="${this.esc(periodoAtual)}" selected>${this.esc(texto)}</option>`);
    }
    return opcoes.join("");
  },

  dadosDashboard(periodo) {
    const abertosRows = this.listOpenProcesses().filter(({ proc }) => this.dataInicioDashboard(proc).slice(0, 7) === periodo);
    const concluidosRows = this.listCompletedProcesses().filter(({ proc }) => this.dataInicioDashboard(proc).slice(0, 7) === periodo);
    const abertos = abertosRows.map((row) => row.proc);
    const concluidos = concluidosRows.map((row) => row.proc);
    const processos = abertos.concat(concluidos);
    const etapas = this.folhasEtapa(this.catalogoEtapas());
    const etapasComContagem = etapas.map((etapa) => {
      const itens = abertosRows.filter(({ proc }) => String(proc.currentStageId || "") === String(etapa.id));
      return {
        id: String(etapa.id),
        nome: etapa.label || etapa.nome || String(etapa.id),
        nomeCurto: this.nomeCurtoEtapaDash(etapa.label || etapa.nome || String(etapa.id)),
        quantidade: itens.length,
        itens: itens
      };
    });
    const semEtapaItens = abertosRows.filter(({ proc }) => !proc.currentStageId
      || !etapas.some((etapa) => String(etapa.id) === String(proc.currentStageId)));
    if (semEtapaItens.length) {
      etapasComContagem.unshift({
        id: "",
        nome: "Aguardando definição da etapa",
        nomeCurto: "Aguardando definição",
        quantidade: semEtapaItens.length,
        itens: semEtapaItens
      });
    }
    const valores = processos.map((proc) => this.valorComercialFicha(proc))
      .filter((v) => v != null && Number.isFinite(v) && v > 0);
    const valorTotal = valores.reduce((total, item) => total + item, 0);
    const porCidade = this.agruparDashboard(abertosRows, (proc) => {
      const cidade = String(this.cidadeDoProc(proc) || "").trim();
      if (!cidade || /^sem cidade$/i.test(cidade) || cidade === "—") return "Sem cidade";
      return cidade;
    });
    const porEmpreendimento = this.agruparDashboard(abertosRows, (proc) => this.obraDoProc(proc).empreendimento);
    const semCidade = porCidade.find((item) => this.foldTextoFin(item.nome) === "SEM CIDADE");
    const cidadesComNome = porCidade.filter((item) => this.foldTextoFin(item.nome) !== "SEM CIDADE");
    const ano = Number(String(periodo || "").slice(0, 4));
    const mes = Number(String(periodo || "").slice(5, 7));
    const periodoLabel = Number.isInteger(ano) && Number.isInteger(mes) && mes >= 1 && mes <= 12
      ? new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
      : "Período inválido";
    return {
      periodoLabel: periodoLabel.charAt(0).toUpperCase() + periodoLabel.slice(1),
      processos: processos,
      abertos: abertos,
      concluidos: concluidos,
      etapas: etapasComContagem,
      valoresInformados: valores.length,
      valoresPendentes: processos.length - valores.length,
      valorTotal: valorTotal,
      porCidade: porCidade,
      cidadesComNome: cidadesComNome,
      semCidadeQtd: semCidade ? semCidade.quantidade : 0,
      porEmpreendimento: porEmpreendimento
    };
  },

  barraDashboardHtml(itens, tipo, totalAbertos, opcoes) {
    const opt = opcoes || {};
    const detalhe = FinanciamentoState.dashboardDetalhe;
    const maxQtd = Math.max.apply(null, [1].concat((itens || []).map((item) => Number(item.quantidade) || 0)));
    const maior = opt.marcarMaior
      ? (itens || []).reduce((acc, item) => ((item.quantidade || 0) > (acc && acc.quantidade || 0) ? item : acc), null)
      : null;
    return (itens || []).map((item) => {
      const id = item.id != null ? String(item.id) : String(item.nome || "");
      const ativo = detalhe && detalhe.tipo === tipo && String(detalhe.id) === id;
      const qtd = item.quantidade || 0;
      const percentual = totalAbertos ? Math.round(qtd / totalAbertos * 1000) / 10 : 0;
      const largura = Math.max(qtd ? 8 : 0, Math.round((qtd / maxQtd) * 100));
      const enc = encodeURIComponent(id);
      const rotulo = opt.usarCurto ? (item.nomeCurto || this.nomeCurtoEtapaDash(item.nome)) : item.nome;
      const meta = opt.mostrarPercentual
        ? (`${qtd} · ${percentual.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`)
        : String(qtd);
      const badge = (maior && String(maior.id != null ? maior.id : maior.nome) === id && qtd > 0)
        ? '<em class="fin-dash-badge">Maior volume</em>'
        : "";
      return `<button type="button" class="fin-dash-barra-item${ativo ? " is-aberto" : ""}${badge ? " is-destaque" : ""}" onclick="FinanciamentoApp.abrirDetalheDashboard('${tipo}','${enc}')" aria-pressed="${ativo ? "true" : "false"}" title="Ver clientes">
        <div class="fin-dash-barra-topo">
          <strong>${this.esc(rotulo)}</strong>
          <span>${this.esc(meta)}</span>
        </div>
        ${badge}
        <div class="fin-dash-barra"><i style="width:${largura}%;"></i></div>
      </button>`;
    }).join("");
  },

  listaEmpreendimentosDashHtml(itens) {
    const detalhe = FinanciamentoState.dashboardDetalhe;
    const lista = (itens || []).slice(0, 8);
    if (!lista.length) return '<p class="fin-dash-vazio">Nenhum empreendimento no período.</p>';
    return `<div class="fin-dash-emp-lista">${lista.map((item) => {
      const id = String(item.nome || "");
      const ativo = detalhe && detalhe.tipo === "empreendimento" && String(detalhe.id) === id;
      const enc = encodeURIComponent(id);
      return `<button type="button" class="fin-dash-emp-item${ativo ? " is-aberto" : ""}" onclick="FinanciamentoApp.abrirDetalheDashboard('empreendimento','${enc}')" title="Ver clientes">
        <span>${this.esc(item.nome)}</span>
        <b>${item.quantidade || 0}</b>
      </button>`;
    }).join("")}</div>`;
  },

  detalheDashboardHtml(dados) {
    const detalhe = FinanciamentoState.dashboardDetalhe;
    if (!detalhe) return "";
    let grupo = null;
    let rotuloTipo = "grupo";
    if (detalhe.tipo === "etapa") {
      grupo = (dados.etapas || []).find((item) => String(item.id) === String(detalhe.id));
      rotuloTipo = "etapa";
    } else if (detalhe.tipo === "cidade") {
      grupo = (dados.porCidade || []).find((item) => String(item.nome) === String(detalhe.id));
      rotuloTipo = "cidade";
    } else if (detalhe.tipo === "empreendimento") {
      grupo = (dados.porEmpreendimento || []).find((item) => String(item.nome) === String(detalhe.id));
      rotuloTipo = "empreendimento";
    }
    const titulo = grupo ? (grupo.nomeCurto || grupo.nome) : detalhe.id;
    const itens = (grupo && grupo.itens) || [];
    const linhas = itens.length ? itens.map(({ key, proc }) => {
      const obra = this.obraDoProc(proc);
      const unidade = this.formatUnidade(proc.unit || proc.unitName || "—");
      const safeKey = String(key).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      return `<button type="button" class="fin-dash-cliente" onclick="FinanciamentoApp.abrirAberto('${safeKey}')">
        <strong title="${this.esc(proc.customerName || "")}">${this.esc(proc.customerName || proc.customerId || "—")}</strong>
        <span>${this.esc(obra.empreendimento)} · ${this.esc(unidade)}</span>
        <span>Contrato ${this.esc(proc.contractNumber || proc.contractId || "—")} · Título ${this.esc(proc.titulo || "—")} · ${this.esc(this.etapaLabel(proc))}</span>
      </button>`;
    }).join("") : `<p class="fin-dash-vazio">Nenhum cliente neste ${rotuloTipo}.</p>`;
    return `<section class="fin-dash-detalhe" aria-label="Clientes do ${rotuloTipo} selecionado">
      <div class="fin-dash-detalhe-topo">
        <div>
          <h3>${this.esc(titulo)}</h3>
          <p>${itens.length} cliente${itens.length === 1 ? "" : "s"} · clique para abrir o financiamento</p>
        </div>
        <button type="button" class="btn btn-outline btn-sm" onclick="FinanciamentoApp.fecharDetalheDashboard()">Fechar</button>
      </div>
      <div class="fin-dash-clientes">${linhas}</div>
    </section>`;
  },

  dashboardHtml() {
    const periodo = /^\d{4}-\d{2}$/.test(FinanciamentoState.dashboardPeriodo)
      ? FinanciamentoState.dashboardPeriodo
      : (new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0"));
    FinanciamentoState.dashboardPeriodo = periodo;
    const dados = this.dadosDashboard(periodo);
    const totalAbertos = dados.abertos.length;
    const mostrarVazias = !!FinanciamentoState.dashboardMostrarVazias;
    const etapasVisiveis = mostrarVazias
      ? dados.etapas
      : (dados.etapas || []).filter((item) => (item.quantidade || 0) > 0);
    const estagios = this.barraDashboardHtml(etapasVisiveis, "etapa", totalAbertos, {
      usarCurto: true,
      marcarMaior: true
    });
    const cidades = this.barraDashboardHtml(dados.porCidade, "cidade", totalAbertos, {
      mostrarPercentual: true
    });
    const empreendimentos = this.listaEmpreendimentosDashHtml(dados.porEmpreendimento);
    const valorTxt = dados.valoresInformados > 0 ? this.fmtMoney(dados.valorTotal) : "Não informado";
    const valorSub = dados.valoresInformados > 0
      ? (dados.valoresInformados + " com valor comercial · " + dados.valoresPendentes + " pendente" + (dados.valoresPendentes === 1 ? "" : "s"))
      : (dados.processos.length + " contrato" + (dados.processos.length === 1 ? "" : "s") + " sem valor comercial registrado");
    const avisoCidade = dados.semCidadeQtd > 0
      ? `<p class="fin-dash-aviso">${dados.semCidadeQtd} contrato${dados.semCidadeQtd === 1 ? "" : "s"} precisam de cidade cadastrada.</p>`
      : "";
    return `<section class="fin-dashboard">
      <div id="fin-dashboard-conteudo" class="fin-dash-conteudo">
        <header class="fin-dash-cabecalho">
          <div>
            <h2>Dashboard de financiamentos</h2>
            <p>Acompanhe a carteira e a evolução dos contratos.</p>
          </div>
          <div class="fin-dash-acoes">
            <label class="fin-dash-periodo" for="fin-dashboard-periodo">
              <span class="fin-dash-sr">Período</span>
              <select id="fin-dashboard-periodo" onchange="FinanciamentoApp.atualizarDashboard(this.value)">${this.opcoesPeriodoDashboard(periodo)}</select>
            </label>
            <button type="button" class="btn btn-primary" id="fin-dashboard-botao-pdf" onclick="FinanciamentoApp.exportarDashboardPdf()"><i data-lucide="file-down" style="width:16px;height:16px;"></i> Exportar PDF</button>
            <span id="fin-dashboard-pdf-status" role="status"></span>
          </div>
        </header>
        <div class="fin-dash-indicadores">
          <article class="fin-dash-kpi">
            <span>Em andamento</span>
            <strong>${totalAbertos}</strong>
            <small>Contratos ativos</small>
          </article>
          <article class="fin-dash-kpi">
            <span>Concluídos</span>
            <strong>${dados.concluidos.length}</strong>
            <small>No período selecionado</small>
          </article>
          <article class="fin-dash-kpi">
            <span>Cidades atendidas</span>
            <strong>${dados.cidadesComNome.length}</strong>
            <small>${dados.semCidadeQtd ? (dados.semCidadeQtd + " contrato" + (dados.semCidadeQtd === 1 ? "" : "s") + " sem cidade") : "Com cidade identificada"}</small>
          </article>
          <article class="fin-dash-kpi">
            <span>Valor de financiamento</span>
            <strong>${this.esc(valorTxt)}</strong>
            <small>${this.esc(valorSub)}</small>
          </article>
        </div>
        <div class="fin-dash-grade">
          <section class="fin-dash-bloco fin-dash-bloco-etapas">
            <div class="fin-dash-titulo">
              <h3>Por etapa</h3>
              <button type="button" class="fin-dash-link" onclick="FinanciamentoApp.setPainel('esteira')">Ver todos os contratos →</button>
            </div>
            <div class="fin-dash-barras fin-dash-barras-etapa">${estagios || '<p class="fin-dash-vazio">Nenhuma etapa com contratos no período.</p>'}</div>
            <label class="fin-dash-toggle">
              <input type="checkbox" ${mostrarVazias ? "checked" : ""} onchange="FinanciamentoApp.alternarEtapasVaziasDashboard(this.checked)">
              <span>Mostrar etapas sem contratos</span>
            </label>
          </section>
          <div class="fin-dash-coluna-direita">
            <section class="fin-dash-bloco">
              <div class="fin-dash-titulo"><h3>Por cidade</h3></div>
              <div class="fin-dash-barras">${cidades || '<p class="fin-dash-vazio">Nenhum financiamento em andamento neste período.</p>'}</div>
              ${avisoCidade}
            </section>
            <section class="fin-dash-bloco">
              <div class="fin-dash-titulo"><h3>Empreendimentos</h3></div>
              ${empreendimentos}
            </section>
          </div>
        </div>
        ${this.detalheDashboardHtml(dados)}
        <p class="fin-dash-rodape">Clique em uma etapa, cidade ou empreendimento para visualizar os contratos.</p>
      </div>
      <style>
        #financiamento-root .fin-dashboard { --fin-dash-verde:#105436; --fin-dash-verde-2:#1b8253; --fin-dash-fundo:#f4f7f5; }
        #financiamento-root .fin-dash-conteudo { display:flex; flex-direction:column; gap:16px; padding:4px 2px 8px; }
        #financiamento-root .fin-dash-cabecalho { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
        #financiamento-root .fin-dash-cabecalho h2 { margin:0; color:#0f172a; font-size:1.45rem; letter-spacing:-0.02em; }
        #financiamento-root .fin-dash-cabecalho > div > p { margin:6px 0 0; color:#64748b; font-size:0.88rem; }
        #financiamento-root .fin-dash-acoes { display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
        #financiamento-root .fin-dash-periodo select { min-width:190px; height:40px; box-sizing:border-box; border:1px solid #cbd5e1; border-radius:8px; padding:0 12px; font:inherit; color:#0f172a; background:#fff; }
        #financiamento-root .fin-dash-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }
        #financiamento-root .fin-dash-acoes .btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; height:40px; box-sizing:border-box; padding:0 14px; margin:0; line-height:1; white-space:nowrap; }
        #financiamento-root #fin-dashboard-pdf-status { color:#64748b; font-size:0.78rem; font-weight:700; max-width:220px; }
        #financiamento-root .fin-dash-indicadores { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
        #financiamento-root .fin-dash-kpi { min-width:0; display:flex; flex-direction:column; gap:6px; padding:16px; border:1px solid #e2e8f0; border-radius:14px; background:#fff; box-shadow:0 1px 2px rgba(15,23,42,.04); }
        #financiamento-root .fin-dash-kpi > span { color:#64748b; font-size:0.74rem; font-weight:700; }
        #financiamento-root .fin-dash-kpi > strong { color:#0f172a; font-size:1.55rem; line-height:1.15; overflow-wrap:anywhere; }
        #financiamento-root .fin-dash-kpi > small { color:#94a3b8; font-size:0.7rem; line-height:1.35; }
        #financiamento-root .fin-dash-grade { display:grid; grid-template-columns:minmax(0,1.15fr) minmax(0,0.85fr); gap:14px; align-items:start; }
        #financiamento-root .fin-dash-coluna-direita { display:flex; flex-direction:column; gap:14px; min-width:0; }
        #financiamento-root .fin-dash-bloco { padding:16px; border:1px solid #e2e8f0; border-radius:14px; background:#fff; box-shadow:0 1px 2px rgba(15,23,42,.04); }
        #financiamento-root .fin-dash-titulo { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:12px; }
        #financiamento-root .fin-dash-titulo h3 { margin:0; color:#0f172a; font-size:0.98rem; }
        #financiamento-root .fin-dash-link { border:0; background:transparent; color:var(--fin-dash-verde); font:inherit; font-size:0.76rem; font-weight:700; cursor:pointer; padding:0; }
        #financiamento-root .fin-dash-link:hover { text-decoration:underline; }
        #financiamento-root .fin-dash-barras { display:flex; flex-direction:column; gap:10px; }
        #financiamento-root .fin-dash-barra-item { position:relative; width:100%; min-width:0; padding:10px 12px; border:1px solid transparent; border-radius:10px; background:#f8fafc; text-align:left; font:inherit; cursor:pointer; transition:border-color .15s, background .15s, box-shadow .15s; }
        #financiamento-root .fin-dash-barra-item:hover { border-color:#bbf7d0; background:#f0fdf4; }
        #financiamento-root .fin-dash-barra-item.is-aberto { border-color:#86efac; background:#ecfdf5; box-shadow:inset 3px 0 0 #16a34a; }
        #financiamento-root .fin-dash-barra-item.is-destaque { background:#fff7ed; border-color:#fed7aa; }
        #financiamento-root .fin-dash-barra-item.is-destaque.is-aberto { background:#ffedd5; }
        #financiamento-root .fin-dash-barra-topo { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; color:#334155; font-size:0.8rem; }
        #financiamento-root .fin-dash-barra-topo strong { font-weight:700; line-height:1.35; }
        #financiamento-root .fin-dash-barra-topo span { flex:0 0 auto; color:#0f172a; font-weight:800; font-variant-numeric:tabular-nums; }
        #financiamento-root .fin-dash-badge { display:inline-block; margin:6px 0 0; padding:2px 8px; border-radius:999px; background:#fff7ed; color:#c2410c; font-size:0.65rem; font-style:normal; font-weight:800; }
        #financiamento-root .fin-dash-barra { height:8px; margin-top:8px; overflow:hidden; border-radius:99px; background:#e2e8f0; }
        #financiamento-root .fin-dash-barra i { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,var(--fin-dash-verde),var(--fin-dash-verde-2)); }
        #financiamento-root .fin-dash-barra-item.is-destaque .fin-dash-barra i { background:linear-gradient(90deg,#ea580c,#f59e0b); }
        #financiamento-root .fin-dash-toggle { display:inline-flex; align-items:center; gap:8px; margin-top:14px; color:#64748b; font-size:0.76rem; cursor:pointer; user-select:none; }
        #financiamento-root .fin-dash-toggle input { accent-color:var(--fin-dash-verde); }
        #financiamento-root .fin-dash-aviso { margin:12px 0 0; padding:10px 12px; border:1px solid #fde68a; border-radius:10px; background:#fffbeb; color:#92400e; font-size:0.74rem; line-height:1.4; }
        #financiamento-root .fin-dash-emp-lista { display:flex; flex-direction:column; gap:2px; }
        #financiamento-root .fin-dash-emp-item { display:flex; justify-content:space-between; align-items:center; gap:12px; width:100%; padding:10px 4px; border:0; border-bottom:1px solid #f1f5f9; background:transparent; text-align:left; font:inherit; cursor:pointer; }
        #financiamento-root .fin-dash-emp-item:last-child { border-bottom:0; }
        #financiamento-root .fin-dash-emp-item:hover, #financiamento-root .fin-dash-emp-item.is-aberto { background:#f8fafc; }
        #financiamento-root .fin-dash-emp-item span { color:#334155; font-size:0.8rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        #financiamento-root .fin-dash-emp-item b { color:#0f172a; font-size:0.82rem; font-variant-numeric:tabular-nums; }
        #financiamento-root .fin-dash-vazio { margin:6px 0; color:#64748b; font-size:0.8rem; }
        #financiamento-root .fin-dash-rodape { margin:0; color:#94a3b8; font-size:0.74rem; }
        #financiamento-root .fin-dash-detalhe { padding:14px; border:1px solid #bbf7d0; border-radius:14px; background:#f0fdf4; }
        #financiamento-root .fin-dash-detalhe-topo { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:10px; }
        #financiamento-root .fin-dash-detalhe-topo h3 { margin:0; color:#14532d; font-size:0.95rem; }
        #financiamento-root .fin-dash-detalhe-topo p { margin:4px 0 0; color:#166534; font-size:0.75rem; }
        #financiamento-root .fin-dash-clientes { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
        #financiamento-root .fin-dash-cliente { display:flex; flex-direction:column; gap:3px; min-width:0; padding:10px 12px; border:1px solid #dcfce7; border-radius:8px; background:#fff; text-align:left; font:inherit; cursor:pointer; }
        #financiamento-root .fin-dash-cliente:hover { border-color:#86efac; background:#f8fafc; }
        #financiamento-root .fin-dash-cliente strong { color:#0f172a; font-size:0.82rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        #financiamento-root .fin-dash-cliente span { color:#64748b; font-size:0.72rem; line-height:1.35; overflow-wrap:anywhere; }
        @media (max-width:1100px) {
          #financiamento-root .fin-dash-indicadores { grid-template-columns:repeat(2,minmax(0,1fr)); }
          #financiamento-root .fin-dash-grade { grid-template-columns:1fr; }
        }
        @media (max-width:700px) {
          #financiamento-root .fin-dash-indicadores, #financiamento-root .fin-dash-clientes { grid-template-columns:1fr; }
          #financiamento-root .fin-dash-cabecalho { align-items:stretch; flex-direction:column; }
          #financiamento-root .fin-dash-acoes { justify-content:flex-start; }
        }
      </style>
    </section>`;
  },

  atualizarDashboard(periodo) {
    if (periodo && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(periodo))) return;
    FinanciamentoState.dashboardPeriodo = String(periodo || "");
    FinanciamentoState.dashboardDetalhe = null;
    this.render();
  },

  alternarEtapasVaziasDashboard(mostrar) {
    FinanciamentoState.dashboardMostrarVazias = !!mostrar;
    this.render();
  },

  abrirDetalheDashboard(tipo, idEnc) {
    const id = decodeURIComponent(String(idEnc == null ? "" : idEnc));
    const atual = FinanciamentoState.dashboardDetalhe;
    if (atual && atual.tipo === tipo && String(atual.id) === String(id)) {
      FinanciamentoState.dashboardDetalhe = null;
    } else {
      FinanciamentoState.dashboardDetalhe = { tipo: tipo, id: id };
    }
    this.render();
    const painel = document.querySelector("#financiamento-root .fin-dash-detalhe");
    if (painel && typeof painel.scrollIntoView === "function") {
      setTimeout(() => painel.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
    }
  },

  fecharDetalheDashboard() {
    FinanciamentoState.dashboardDetalhe = null;
    this.render();
  },

  async exportarDashboardPdf() {
    const conteudo = document.getElementById("fin-dashboard-conteudo");
    const btn = document.getElementById("fin-dashboard-botao-pdf");
    const status = document.getElementById("fin-dashboard-pdf-status");
    if (!conteudo) return false;
    if (typeof window.html2canvas !== "function" || !window.jspdf || typeof window.jspdf.jsPDF !== "function") {
      if (status) status.textContent = "Exportação em PDF indisponível nesta página.";
      return false;
    }
    if (btn) { btn.disabled = true; btn.textContent = "Preparando PDF…"; }
    if (status) status.textContent = "Preparando o dashboard para exportação…";
    try {
      const canvas = await window.html2canvas(conteudo, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false });
      if (!canvas.width || !canvas.height) throw new Error("O dashboard não pôde ser convertido para PDF.");
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF("l", "mm", "a4");
      const margem = 10;
      const largura = pdf.internal.pageSize.getWidth() - margem * 2;
      const alturaPagina = pdf.internal.pageSize.getHeight() - margem * 2;
      const alturaImagem = canvas.height * largura / canvas.width;
      const imagem = canvas.toDataURL("image/jpeg", 0.95);
      let deslocamento = 0;
      let restante = alturaImagem;
      while (restante > 0) {
        if (deslocamento) pdf.addPage();
        pdf.addImage(imagem, "JPEG", margem, margem - deslocamento, largura, alturaImagem);
        restante -= alturaPagina;
        deslocamento += alturaPagina;
      }
      const periodo = FinanciamentoState.dashboardPeriodo || "periodo";
      pdf.save("dashboard-financiamento-" + periodo + ".pdf");
      if (status) status.textContent = "PDF exportado.";
      return true;
    } catch (e) {
      console.error("[Financiamento] exportação do dashboard", e);
      if (status) status.textContent = (e && e.message) || "Não foi possível exportar o dashboard.";
      return false;
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="file-down" style="width:16px;height:16px;"></i> Exportar PDF'; }
      if (window.lucide) window.lucide.createIcons();
    }
  },

  buscaHtml() {
    return `
      <style>
        #fin-filter-titulo, #fin-filter-contrato, #fin-filter-doc,
        #fin-filter-emp, #fin-filter-unidade, #fin-filter-nome,
        #fin-filter-telefone, #fin-filter-email { border-color:#94a3b8 !important; }
      </style>
      <div class="crm-card" style="margin-bottom:20px;">
        <div class="crm-card-header" style="background-color:#f3f4f6;padding:12px 20px;border-bottom:1px solid #e5e7eb;border-radius:8px 8px 0 0;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:1.1rem;color:var(--color-primary);">Pesquisar</h3>
          <div style="display:flex;gap:15px;align-items:center;">
            <button type="button" class="btn btn-outline btn-sm" onclick="window.startCustomerBackgroundSync && window.startCustomerBackgroundSync(true)" style="display:flex;align-items:center;gap:6px;padding:4px 8px;">
              <i data-lucide="refresh-cw" style="width:14px;height:14px;"></i> Atualizar Base
            </button>
          </div>
        </div>
        <div class="crm-card-content" style="padding-bottom:0;">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 160px;gap:16px;align-items:end;margin-bottom:20px;">
            <div class="form-group" style="grid-column:1 / 2;margin:0;">
              <label>Título (Contas a Receber)</label>
              <input type="text" class="form-control" id="fin-filter-titulo" placeholder="" onkeydown="if((event.key==='Enter'||event.key==='Tab')&&this.value){event.preventDefault();FinanciamentoApp.buscar();}" oninput="this.value=this.value.replace(/[^0-9]/g,'');FinanciamentoApp.toggleFilters()">
            </div>
            <div class="form-group" style="grid-column:2 / 3;margin:0;">
              <label>Contrato</label>
              <input type="text" class="form-control" id="fin-filter-contrato" placeholder="" onkeydown="if((event.key==='Enter'||event.key==='Tab')&&this.value){event.preventDefault();FinanciamentoApp.buscar();}" oninput="FinanciamentoApp.toggleFilters()">
            </div>
            <div class="form-group" style="grid-column:3 / 4;margin:0;">
              <label>CPF/CNPJ</label>
              <input type="text" class="form-control" id="fin-filter-doc" placeholder="000.000.000-00" onkeydown="if((event.key==='Enter'||event.key==='Tab')&&this.value){event.preventDefault();FinanciamentoApp.buscar();}" oninput="if(typeof maskCpfCnpj==='function') maskCpfCnpj(this); FinanciamentoApp.toggleFilters()">
            </div>
            <div class="form-group" style="grid-column:1 / 3;margin:0;">
              <label>Empreendimento</label>
              <select class="form-control" id="fin-filter-emp" onchange="FinanciamentoApp.loadUnidades(this.value); FinanciamentoApp.toggleFilters();">
                <option value="">Selecione...</option>
              </select>
            </div>
            <div class="form-group" style="grid-column:3 / 4;margin:0;">
              <label>Unidade</label>
              <select class="form-control" id="fin-filter-unidade" onchange="if(this.value) FinanciamentoApp.buscar();" disabled>
                <option value="">Selecione o emp...</option>
              </select>
            </div>
            <div class="form-group" style="grid-column:4 / 5;margin:0;display:flex;align-items:flex-end;">
              <button type="button" class="btn btn-primary" style="height:38px;width:100%;display:flex;align-items:center;justify-content:center;font-size:0.85rem;padding:0;" onclick="FinanciamentoApp.limparBusca()" title="Nova Busca / Limpar">
                <i data-lucide="eraser" style="width:14px;margin-right:6px;"></i> Limpar
              </button>
            </div>
            <div class="form-group" style="grid-column:1 / 2;margin:0;position:relative;">
              <label>Nome do Cliente</label>
              <input type="text" class="form-control" id="fin-filter-nome" placeholder="Digite para buscar..." onkeydown="if((event.key==='Enter'||event.key==='Tab')&&this.value){event.preventDefault();FinanciamentoApp.buscar();}" oninput="handleDynamicCustomerSearch(this.value,'nome','fin'); FinanciamentoApp.toggleFilters()" autocomplete="off">
            </div>
            <div class="form-group" style="grid-column:2 / 3;margin:0;position:relative;">
              <label>Telefone</label>
              <input type="text" class="form-control" id="fin-filter-telefone" placeholder="Digite para buscar..." onkeydown="if((event.key==='Enter'||event.key==='Tab')&&this.value){event.preventDefault();FinanciamentoApp.buscar();}" oninput="handleDynamicCustomerSearch(this.value,'telefone','fin'); FinanciamentoApp.toggleFilters()" autocomplete="off">
            </div>
            <div class="form-group" style="grid-column:3 / 4;margin:0;position:relative;">
              <label>E-mail</label>
              <input type="text" class="form-control" id="fin-filter-email" placeholder="Digite para buscar..." onkeydown="if((event.key==='Enter'||event.key==='Tab')&&this.value){event.preventDefault();FinanciamentoApp.buscar();}" oninput="handleDynamicCustomerSearch(this.value,'email','fin'); FinanciamentoApp.toggleFilters()" autocomplete="off">
            </div>
          </div>
        </div>
      </div>

      <div class="crm-card" id="fin-abertos-card" style="margin-bottom:24px;">
        <div class="crm-card-header" style="background-color:#f3f4f6;padding:12px 20px;border-bottom:1px solid #e5e7eb;border-radius:8px 8px 0 0;margin-bottom:0;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:1.1rem;color:var(--color-primary);">Financiamentos em aberto</h3>
          <span id="fin-abertos-count" style="font-size:0.75rem;color:#64748b;font-weight:700;"></span>
        </div>
        <div class="crm-card-content" style="padding:0;">
          <div style="overflow:auto;max-height:280px;border-bottom-left-radius:8px;border-bottom-right-radius:8px;">
            <table class="crm-table" style="width:100%;border-collapse:separate;border-spacing:0;">
              <thead style="position:sticky;top:0;background:#f3f4f6;z-index:10;">
                <tr>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Cliente</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Contrato</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Título</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Unidade</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Etapa</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Atualizado</th>
                </tr>
              </thead>
              <tbody id="fin-abertos-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="crm-card" id="fin-results-card" style="display:none;">
        <div class="crm-card-header" style="background-color:#f3f4f6;padding:12px 20px;border-bottom:1px solid #e5e7eb;border-radius:8px 8px 0 0;margin-bottom:20px;">
          <h3 style="margin:0;font-size:1.1rem;color:var(--color-primary);">Contratos do cliente</h3>
        </div>
        <div class="crm-card-content" style="padding:0;">
          <div style="overflow:auto;max-height:480px;border-bottom-left-radius:8px;border-bottom-right-radius:8px;">
            <table class="crm-table" style="width:100%;border-collapse:separate;border-spacing:0;">
              <thead style="position:sticky;top:0;background:#f3f4f6;z-index:10;">
                <tr>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Contrato</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Título</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Empreendimento</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Unidade</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Data Venda</th>
                  <th style="text-align:center;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Status</th>
                  <th style="text-align:center;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Ações</th>
                </tr>
              </thead>
              <tbody id="fin-results-tbody">
                <tr><td colspan="7" style="text-align:center;padding:28px;color:#94a3b8;">Faça uma busca para encontrar clientes.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  },

  restoreBuscaUi() {
    if (FinanciamentoState.contracts && FinanciamentoState.contracts.length) {
      this.renderContractsTable(FinanciamentoState.contracts);
    }
    this.populateEmpreendimentos();
    this.renderAbertos();
  },

  limparBusca() {
    ["fin-filter-titulo", "fin-filter-contrato", "fin-filter-doc", "fin-filter-nome", "fin-filter-telefone", "fin-filter-email"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) { el.value = ""; el.disabled = false; }
    });
    const emp = document.getElementById("fin-filter-emp");
    const uni = document.getElementById("fin-filter-unidade");
    if (emp) { emp.value = ""; emp.disabled = false; }
    if (uni) {
      uni.innerHTML = '<option value="">Selecione o emp...</option>';
      uni.disabled = true;
    }
    window.FinanciamentoSelectedCustomerId = null;
    FinanciamentoState.customer = null;
    FinanciamentoState.contracts = [];
    ["nome", "telefone", "email"].forEach((t) => {
      const dd = document.getElementById("custom-dropdown-fin-" + t);
      if (dd) dd.style.display = "none";
    });
    const rc = document.getElementById("fin-results-card");
    if (rc) rc.style.display = "none";
    this.toggleFilters();
    this.renderAbertos();
  },

  toggleFilters() {
    const nome = document.getElementById("fin-filter-nome");
    const tel = document.getElementById("fin-filter-telefone");
    const email = document.getElementById("fin-filter-email");
    const doc = document.getElementById("fin-filter-doc");
    const titulo = document.getElementById("fin-filter-titulo");
    const contrato = document.getElementById("fin-filter-contrato");
    const emp = document.getElementById("fin-filter-emp");
    const uni = document.getElementById("fin-filter-unidade");
    const hasNome = nome && nome.value.trim() !== "";
    const hasTel = tel && tel.value.trim() !== "";
    const hasEmail = email && email.value.trim() !== "";
    const hasDoc = doc && doc.value.trim() !== "";
    const hasTitulo = titulo && titulo.value.trim() !== "";
    const hasContrato = contrato && contrato.value.trim() !== "";
    const hasEmp = emp && emp.value !== "";
    if (nome) nome.disabled = hasTel || hasEmail || hasDoc || hasTitulo || hasContrato || hasEmp;
    if (tel) tel.disabled = hasNome || hasEmail || hasDoc || hasTitulo || hasContrato || hasEmp;
    if (email) email.disabled = hasNome || hasTel || hasDoc || hasTitulo || hasContrato || hasEmp;
    if (doc) doc.disabled = hasNome || hasTel || hasEmail || hasTitulo || hasContrato || hasEmp;
    if (titulo) titulo.disabled = hasNome || hasTel || hasEmail || hasDoc || hasContrato || hasEmp;
    if (contrato) contrato.disabled = hasNome || hasTel || hasEmail || hasDoc || hasTitulo || hasEmp;
    if (emp) emp.disabled = hasNome || hasTel || hasEmail || hasDoc || hasTitulo || hasContrato;
    if (uni) uni.disabled = !hasEmp || hasNome || hasTel || hasEmail || hasDoc || hasTitulo || hasContrato;
  },

  async populateEmpreendimentos() {
    const empSelect = document.getElementById("fin-filter-emp");
    if (!empSelect || !window.SiengeApiService) return;
    try {
      const keep = empSelect.value;
      let ccs = await SiengeApiService.getCostCenters();
      let customFields = {};
      try { customFields = JSON.parse(localStorage.getItem("crm_centros_custo_custom") || "{}") || {}; } catch (e) {}
      if (window.EstoqueComercialApp && typeof EstoqueComercialApp.filterEmpreendimentosLikeRelacionamento === "function") {
        ccs = EstoqueComercialApp.filterEmpreendimentosLikeRelacionamento(ccs);
      } else {
        ccs = (ccs || []).filter((c) => {
          const custom = customFields[c.id] || customFields[String(c.id)] || {};
          const tipo = custom.tipo_cc || "";
          return tipo === "Loteamento Aberto" || tipo === "Loteamento Fechado" || tipo === "Incorporação";
        });
      }
      ccs.sort((a, b) => a.id - b.id);
      empSelect.innerHTML = '<option value="">Selecione...</option>' + ccs.map((c) =>
        `<option value="${c.id}">${c.id} - ${this.esc(c.name)}</option>`
      ).join("");
      if (keep && Array.from(empSelect.options).some((o) => String(o.value) === String(keep))) empSelect.value = keep;
    } catch (e) {}
  },

  async loadUnidades(cc) {
    const selectUnidade = document.getElementById("fin-filter-unidade");
    if (!selectUnidade) return;
    selectUnidade.innerHTML = '<option value="">Carregando unidades...</option>';
    selectUnidade.disabled = true;
    if (!cc) {
      selectUnidade.innerHTML = '<option value="">Selecione o emp...</option>';
      return;
    }
    try {
      let allUnits = [];
      let offset = 0;
      const limit = 200;
      while (true) {
        const data = await window.siengeFetchWithRetry(`/units?limit=${limit}&offset=${offset}&enterpriseId=${cc}&additionalData=NONE`);
        const results = data.results || [];
        allUnits = allUnits.concat(results);
        if (!results.length) break;
        offset += results.length;
      }
      allUnits = allUnits.filter((u) => u.commercialStock !== "T");
      allUnits.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", { numeric: true }));
      selectUnidade.innerHTML = '<option value="">Selecione...</option>' + allUnits.map((u) => {
        const label = this.formatUnidade(u.name || u.id);
        return `<option value="${u.id}" data-contract="${this.esc(u.contractId || "")}">${this.esc(label)}</option>`;
      }).join("");
      selectUnidade.disabled = false;
    } catch (e) {
      selectUnidade.innerHTML = '<option value="">Erro ao carregar unidades</option>';
    }
  },

  norm(str) {
    return String(str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  },

  sugerirCliente(val, tipo) {
    if (typeof window.handleDynamicCustomerSearch === "function") {
      window.handleDynamicCustomerSearch(val, tipo, "fin");
    }
  },

  escolherSugestao(id) {
    window.FinanciamentoSelectedCustomerId = id;
    const cache = (window.GlobalCustomerCache && window.GlobalCustomerCache.data) || [];
    const hit = cache.find((c) => String(c.id) === String(id));
    if (hit) {
      const nome = document.getElementById("fin-filter-nome");
      const doc = document.getElementById("fin-filter-doc");
      if (nome) nome.value = hit.name || "";
      if (doc) doc.value = hit.cpf || hit.cnpj || hit.cpfCnpj || String(hit.id);
    }
    const sug = document.getElementById("fin-sugestoes");
    if (sug) sug.style.display = "none";
    this.buscar();
  },

  proxyBase() {
    const port = (window.location.port === "5500" || !window.location.port) ? "3000" : window.location.port;
    const host = (window.location.hostname === "" || window.location.hostname === "127.0.0.1") ? "localhost" : window.location.hostname;
    return `http://${host}:${port}/sienge-proxy`;
  },

  authHeader() {
    return window.getBasicAuthHeader ? getBasicAuthHeader() : "";
  },

  async resolveCustomerId() {
    if (window.FinanciamentoSelectedCustomerId) return String(window.FinanciamentoSelectedCustomerId);
    const titulo = ((document.getElementById("fin-filter-titulo") || {}).value || "").trim();
    const contrato = ((document.getElementById("fin-filter-contrato") || {}).value || "").trim();
    const emp = ((document.getElementById("fin-filter-emp") || {}).value || "").trim();
    const unidadeSel = document.getElementById("fin-filter-unidade");
    const unidadeId = unidadeSel && unidadeSel.value ? unidadeSel.value : "";
    const nome = ((document.getElementById("fin-filter-nome") || {}).value || "").trim();
    const docRaw = ((document.getElementById("fin-filter-doc") || {}).value || "").trim();
    const tel = (((document.getElementById("fin-filter-telefone") || {}).value || "").replace(/\D/g, ""));
    const email = ((document.getElementById("fin-filter-email") || {}).value || "").trim();
    const docDigits = String(docRaw).replace(/\D/g, "");
    const cache = (window.GlobalCustomerCache && window.GlobalCustomerCache.data) || [];
    const base = this.proxyBase();
    const headers = { Authorization: this.authHeader() };

    if (titulo) {
      const res = await fetch(`${base}/accounts-receivable/receivable-bills/${encodeURIComponent(titulo)}`, { headers });
      if (!res.ok) throw new Error(`Título não encontrado: ${titulo}`);
      const bill = await res.json();
      if (!bill.customerId) throw new Error("Título sem cliente associado.");
      return String(bill.customerId);
    }

    if (contrato) {
      const c = await window.findSalesContractExact(contrato, async (path) => {
        const res = await fetch(`${base}${path}`, { headers });
        if (!res.ok) throw new Error(`Contrato não encontrado: ${contrato}`);
        return res.json();
      });
      if (!c) throw new Error(`Contrato não encontrado: ${contrato}`);
      let cid = c.customerId || (c.customer && c.customer.id) || (c.customers && c.customers[0] && (c.customers[0].id || c.customers[0].customerId));
      if (!cid && c.receivableBillId) {
        const bRes = await fetch(`${base}/accounts-receivable/receivable-bills/${c.receivableBillId}`, { headers });
        if (bRes.ok) {
          const bill = await bRes.json();
          cid = bill.customerId;
        }
      }
      if (!cid) throw new Error("Cliente não encontrado no contrato.");
      return String(cid);
    }

    if (emp && unidadeId) {
      const res = await fetch(`${base}/sales-contracts?enterpriseId=${encodeURIComponent(emp)}&unitId=${encodeURIComponent(unidadeId)}`, { headers });
      if (res.ok) {
        const data = await res.json();
        const list = data.results || [];
        const pick = list.find((c) => String(c.status).toUpperCase() === "ACTIVE") || list[0];
        if (pick) {
          const cid = pick.customerId || (pick.customer && pick.customer.id);
          if (cid) return String(cid);
        }
      }
      const opt = unidadeSel.options[unidadeSel.selectedIndex];
      const contractId = opt && opt.getAttribute("data-contract");
      if (contractId) {
        const scRes = await fetch(`${base}/sales-contracts/${contractId}`, { headers });
        if (scRes.ok) {
          const sc = await scRes.json();
          const cid = sc.customerId || (sc.customer && sc.customer.id);
          if (cid) return String(cid);
        }
      }
    }

    if (docDigits.length >= 11 && cache.length) {
      const byDoc = cache.find((c) => String(c.cpf || c.cnpj || c.cpfCnpj || "").replace(/\D/g, "") === docDigits);
      if (byDoc) return String(byDoc.id);
    }
    if (/^\d+$/.test(docRaw) && docRaw.length <= 8) return docRaw;
    let match = null;
    if (nome && cache.length) {
      const terms = this.norm(nome).split(/\s+/).filter(Boolean);
      match = cache.find((c) => terms.every((t) => this.norm(c.name).includes(t)));
    } else if (tel.length >= 4 && cache.length) {
      match = cache.find((c) => (c.phones || []).some((p) => {
        const full = String(p.areaCode || "") + String(p.number || p.phoneNumber || "");
        return full.replace(/\D/g, "").includes(tel);
      }));
    } else if (email && cache.length) {
      match = cache.find((c) => this.norm(c.email).includes(this.norm(email)));
    }
    return match ? String(match.id) : null;
  },

  customerCardHtml(c) {
    const doc = c.cpfCnpj || c.cpf || c.cnpj || "";
    const docLabel = String(doc).replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF";
    let age = "Não informado";
    if (c.birthDate && String(doc).replace(/\D/g, "").length <= 11) {
      const birth = new Date(String(c.birthDate).slice(0, 10) + "T12:00:00");
      if (!isNaN(birth.getTime())) {
        const today = new Date();
        let diff = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) diff--;
        age = diff + " anos";
      }
    }
    const prof = c.profession || c.occupation || "N/D";
    let addr = "Não informado";
    if (c.addresses && c.addresses[0]) {
      const a = c.addresses[0];
      addr = [a.street || a.streetName, a.number, a.complement, a.neighborhood, [a.cityName || a.city, a.stateName || a.state].filter(Boolean).join("/"), a.postalCode || a.zipCode ? "CEP: " + (a.postalCode || a.zipCode) : ""]
        .filter(Boolean).join(", ");
    }
    let phone = "Não informado";
    const phones = c.phones || [];
    if (phones[0]) {
      const p = phones[0];
      const d = (String(p.areaCode || "") + String(p.number || p.phoneNumber || "")).replace(/\D/g, "");
      phone = d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : (d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d);
    }
    const email = c.email || "Não informado";
    const fmtDoc = typeof formatCpfCnpj === "function" ? formatCpfCnpj(doc) : doc;
    return `
      <div class="cessao-customer-grid">
        <div class="cessao-customer-field cessao-customer-field--wide"><span class="cessao-lbl">Nome</span><span class="cessao-val">${this.esc(c.name || "—")}</span></div>
        <div class="cessao-customer-field"><span class="cessao-lbl">${docLabel}</span><span class="cessao-val">${this.esc(fmtDoc || "—")}</span></div>
        <div class="cessao-customer-field"><span class="cessao-lbl">Idade</span><span class="cessao-val">${this.esc(age)}</span></div>
        <div class="cessao-customer-field"><span class="cessao-lbl">Profissão</span><span class="cessao-val">${this.esc(prof)}</span></div>
        <div class="cessao-customer-field"><span class="cessao-lbl">Telefones</span><span class="cessao-val">${this.esc(phone)}</span></div>
        <div class="cessao-customer-field"><span class="cessao-lbl">E-mail</span><span class="cessao-val">${this.esc(email)}</span></div>
        <div class="cessao-customer-field cessao-customer-field--full"><span class="cessao-lbl">Endereço</span><span class="cessao-val">${this.esc(addr)}</span></div>
      </div>`;
  },

  statusPill(status) {
    const st = String(status || "").toUpperCase();
    if (st.includes("QUIT")) return '<span style="background:#eff6ff;border:1px solid #93c5fd;color:#1d4ed8;padding:4px 10px;border-radius:12px;font-size:0.72rem;font-weight:700;">Quitado</span>';
    if (st.includes("CANCEL") || st.includes("DISTRAT")) return '<span style="background:#f1f5f9;border:1px solid #cbd5e1;color:#475569;padding:4px 10px;border-radius:12px;font-size:0.72rem;font-weight:700;">Distratado/Cancelado</span>';
    if (st.includes("ACTIVE") || st.includes("ATIVO") || !st) {
      return '<span style="background:#ecfdf5;border:1px solid #86efac;color:#166534;padding:4px 10px;border-radius:12px;font-size:0.72rem;font-weight:700;">Adimplente</span>';
    }
    return `<span style="background:#f8fafc;border:1px solid #e2e8f0;color:#334155;padding:4px 10px;border-radius:12px;font-size:0.72rem;font-weight:700;">${this.esc(status)}</span>`;
  },

  async buscar() {
    const tbody = document.getElementById("fin-results-tbody");
    const results = document.getElementById("fin-results-card");
    const sug = document.getElementById("fin-sugestoes");
    if (sug) sug.style.display = "none";
    let customerId;
    try {
      customerId = await this.resolveCustomerId();
    } catch (e) {
      alert(e.message || "Não foi possível localizar o cliente.");
      return;
    }
    if (!customerId) {
      alert("Preencha pelo menos um campo para pesquisar.");
      return;
    }
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:#64748b;">
        <div class="loading-spinner" style="width:28px;height:28px;border:3px solid rgba(16,84,54,0.15);border-top-color:var(--color-primary);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 10px;"></div>
        Buscando contratos do cliente…
      </td></tr>`;
    }
    if (results) results.style.display = "block";
    try {
      const svc = window.SiengeApiService;
      if (!svc) throw new Error("API Sienge indisponível");
      const customer = await svc.getCustomer(customerId);
      if (!customer) throw new Error("Cliente não encontrado");
      FinanciamentoState.customer = customer;
      let contracts = [];
      if (typeof svc.getSales === "function") contracts = await svc.getSales(customerId);
      if (!Array.isArray(contracts)) contracts = [];
      FinanciamentoState.contracts = contracts;
      this.renderContractsTable(contracts);
    } catch (e) {
      console.error("[Financiamento] busca", e);
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--color-danger);">${this.esc(e.message || "Falha na busca")}</td></tr>`;
    }
  },

  renderContractsTable(contracts) {
    const tbody = document.getElementById("fin-results-tbody");
    const results = document.getElementById("fin-results-card");
    if (results) results.style.display = "block";
    if (!tbody) return;
    if (!contracts.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:#94a3b8;">Nenhum contrato encontrado para este cliente.</td></tr>';
      return;
    }
    const ccs = (window.AppState && AppState.cachedCostCenters) || [];
    const ccMap = {};
    ccs.forEach((cc) => { ccMap[String(cc.id)] = cc.name; });
    const customer = FinanciamentoState.customer || {};
    tbody.innerHTML = contracts.map((c) => {
      const cid = c.id || c.contractId || "";
      const num = c.contractNumber || c.number || cid;
      const titulo = c.receivableBillId || c.billReceivableId || "—";
      const empId = c.enterpriseId || c.costCenterId || "";
      const empName = ccMap[String(empId)] || c.enterpriseName || empId || "—";
      const unitLabel = this.formatUnidade(c.unitName || c.unityName || c.unitId || "—");
      const dataVenda = this.fmtDate(c.saleDate || c.contractDate || c.issueDate);
      const proc = this.getProcess(customer.id, cid);
      const btnLabel = proc ? "Continuar financiamento" : "Iniciar financiamento";
      return `<tr>
        <td style="padding:10px;font-weight:700;font-size:0.75rem;">${this.esc(num)}</td>
        <td style="padding:10px;font-weight:800;font-size:0.75rem;">${this.esc(titulo)}</td>
        <td style="padding:10px;font-size:0.75rem;">${this.esc(empName)}</td>
        <td style="padding:10px;font-size:0.75rem;">${this.esc(unitLabel)}</td>
        <td style="padding:10px;font-size:0.75rem;">${this.esc(dataVenda)}</td>
        <td style="padding:10px;text-align:center;">${this.statusPill(c.status)}</td>
        <td style="padding:10px;text-align:center;white-space:nowrap;">
          <button type="button" class="btn btn-primary btn-sm"
            onclick="FinanciamentoApp.iniciar('${String(customer.id).replace(/'/g, "")}','${String(cid).replace(/'/g, "")}','${String(titulo).replace(/'/g, "")}','${String(num).replace(/'/g, "")}')"
            style="padding:6px 12px;font-size:0.75rem;font-weight:700;">
            <i data-lucide="landmark" style="width:14px;height:14px;margin-right:4px;"></i> ${btnLabel}
          </button>
        </td>
      </tr>`;
    }).join("");
    if (window.lucide) lucide.createIcons();
  },

  lerMapaProc(raw) {
    try {
      const obj = JSON.parse(raw || "{}") || {};
      return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
    } catch (e) {
      return {};
    }
  },

  /* Disco, aba e memória. A nuvem às vezes devolve a lista antiga e apagava o financiamento recém-incluído. */
  loadAllProcesses() {
    let disco = "{}";
    let sessao = "{}";
    try { disco = localStorage.getItem(FIN_PROC_KEY) || "{}"; } catch (e) {}
    try { sessao = sessionStorage.getItem(FIN_PROC_KEY) || "{}"; } catch (e) {}
    let merged = disco;
    if (typeof window.mergeFinanciamentosProc === "function") {
      merged = window.mergeFinanciamentosProc(disco, sessao);
      merged = window.mergeFinanciamentosProc(merged, JSON.stringify(window._finProcMem || {}));
    }
    return this.lerMapaProc(merged);
  },

  digitosProc(valor) {
    return String(valor == null ? "" : valor).replace(/\D/g, "");
  },

  nomeClienteProc(proc) {
    return String(proc && proc.customerName || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  },

  assinaturaTituloProc(proc) {
    const titulo = this.digitosProc(proc && proc.titulo);
    if (!titulo) return "";
    const cliente = String(proc && proc.customerId || "").trim();
    if (cliente) return "c:" + cliente + ":t:" + titulo;
    const nome = this.nomeClienteProc(proc);
    if (nome) return "n:" + nome + ":t:" + titulo;
    return "t:" + titulo;
  },

  indiceEtapaProc(proc) {
    const folhas = this.folhasEtapa(this.catalogoEtapas());
    if (!proc || !proc.currentStageId) return -1;
    return folhas.findIndex((s) => String(s.id) === String(proc.currentStageId));
  },

  pontuacaoProcessoAberto(proc) {
    let pts = this.indiceEtapaProc(proc);
    if (pts < 0) pts = proc && proc.currentStageId ? 0 : -1;
    if (proc && (proc.enterpriseName || proc.empId || proc.costCenterId)) pts += 0.2;
    if (proc && (proc.companyName || proc.companyId)) pts += 0.1;
    if (proc && String(proc.unit || proc.unitName || "").trim()) pts += 0.05;
    if (proc && proc.concluidas) pts += Object.keys(proc.concluidas).length * 0.01;
    if (proc && proc.anexos) pts += Object.keys(proc.anexos).length * 0.02;
    if (proc && proc.notas) pts += Object.keys(proc.notas).length * 0.01;
    return pts;
  },

  ehCascaAberta(proc) {
    if (!this.isProcessoAberto(proc) || (proc && proc.currentStageId)) return false;
    const tem = (obj) => !!(obj && typeof obj === "object" && Object.keys(obj).length);
    return !tem(proc.done) && !tem(proc.concluidas) && !tem(proc.anexos) && !tem(proc.notas);
  },

  ehProcessoIncompletoObra(proc) {
    if (!proc) return true;
    const obra = this.obraDoProc(proc);
    const emp = String(obra.empreendimento || proc.enterpriseName || "").trim();
    const cidade = String(this.cidadeDoProc(proc) || "").trim();
    const semEmp = !emp || emp === "—" || emp === "N/D" || emp === "-";
    const semCc = !String(proc.empId || proc.costCenterId || "").trim();
    const semCidade = !cidade || cidade === "—" || /^sem cidade$/i.test(cidade);
    return (semEmp && semCc) || (semCidade && semEmp);
  },

  processosMesmoTitulo(a, b) {
    if (!a || !b) return false;
    const ta = this.digitosProc(a.titulo);
    const tb = this.digitosProc(b.titulo);
    if (!ta || !tb || ta !== tb) return false;
    const ca = String(a.customerId || "").trim();
    const cb = String(b.customerId || "").trim();
    if (ca && cb) return ca === cb;
    const na = this.nomeClienteProc(a);
    const nb = this.nomeClienteProc(b);
    if (na && nb) return na === nb || na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0;
    return !!(ca || cb || na || nb);
  },

  preferirProcessoAberto(a, b) {
    const pa = this.pontuacaoProcessoAberto(a.proc);
    const pb = this.pontuacaoProcessoAberto(b.proc);
    if (pb !== pa) return pb > pa ? b : a;
    const ta = Date.parse((a.proc && a.proc.updatedAt) || 0) || 0;
    const tb = Date.parse((b.proc && b.proc.updatedAt) || 0) || 0;
    return tb >= ta ? b : a;
  },

  marcarProcessoDescartado(proc, motivo) {
    const agora = new Date().toISOString();
    proc.status = "cancelado";
    proc.closedAt = agora;
    proc.finishedAt = "";
    proc.descartadoComoDuplicata = true;
    proc.descartadoEm = agora;
    proc.descartadoMotivo = motivo || "duplicata";
    proc.updatedAt = agora;
    return proc;
  },

  persistirMapaProcessos(all) {
    window._finProcMem = all || {};
    const raw = JSON.stringify(window._finProcMem);
    try { sessionStorage.setItem(FIN_PROC_KEY, raw); } catch (e) {}
    try { localStorage.setItem(FIN_PROC_KEY, raw); } catch (e) {}
    if (window.forceUploadLocalConfig) window.forceUploadLocalConfig(true).catch(() => {});
  },

  deduplicarAbertosPorTitulo(rows) {
    const escolhidos = new Map();
    const semTitulo = [];
    (rows || []).forEach((row) => {
      if (!row || !row.proc) return;
      const sig = this.assinaturaTituloProc(row.proc);
      if (!sig) {
        semTitulo.push(row);
        return;
      }
      const atual = escolhidos.get(sig);
      if (!atual) {
        escolhidos.set(sig, row);
        return;
      }
      escolhidos.set(sig, this.preferirProcessoAberto(atual, row));
    });
    return Array.from(escolhidos.values()).concat(semTitulo).sort((a, b) =>
      String(b.proc.updatedAt || b.proc.startedAt || "").localeCompare(String(a.proc.updatedAt || a.proc.startedAt || ""))
    );
  },

  /* Descarta duplicatas (não apaga a chave): a nuvem não recria o registro antigo. */
  sanearDuplicadosProcessos() {
    const all = this.loadAllProcesses();
    const abertos = [];
    const concluidos = [];
    Object.keys(all).forEach((key) => {
      const proc = all[key];
      if (!proc || typeof proc !== "object") return;
      if (this.isProcessoConcluido(proc)) concluidos.push({ key: key, proc: proc });
      else if (this.isProcessoAberto(proc)) abertos.push({ key: key, proc: proc });
    });
    const descartar = new Set();
    const motivos = {};
    abertos.forEach((row) => {
      if (concluidos.some((c) => this.processosMesmoTitulo(row.proc, c.proc))) {
        descartar.add(row.key);
        motivos[row.key] = "duplicata-mesmo-titulo-concluido";
        return;
      }
      if (this.ehCascaAberta(row.proc)
        && concluidos.some((c) => this.processosMesmoTitulo(row.proc, c.proc)
          || String(c.proc.customerId || "") === String(row.proc.customerId || ""))) {
        descartar.add(row.key);
        motivos[row.key] = "casca-com-concluido";
      }
    });
    const porTitulo = new Map();
    abertos.forEach((row) => {
      if (descartar.has(row.key)) return;
      const sig = this.assinaturaTituloProc(row.proc);
      if (!sig) return;
      const atual = porTitulo.get(sig);
      if (!atual) {
        porTitulo.set(sig, row);
        return;
      }
      const melhor = this.preferirProcessoAberto(atual, row);
      const pior = melhor.key === atual.key ? row : atual;
      porTitulo.set(sig, melhor);
      descartar.add(pior.key);
      motivos[pior.key] = "duplicata-mesmo-titulo";
    });
    /* Fichas sem cidade/empreendimento quando existe outra do mesmo título mais completa. */
    const vivos = abertos.concat(concluidos);
    abertos.forEach((row) => {
      if (descartar.has(row.key) || !this.ehProcessoIncompletoObra(row.proc)) return;
      const titulo = this.digitosProc(row.proc.titulo);
      const nome = this.nomeClienteProc(row.proc);
      const temMelhor = vivos.some((outro) => {
        if (outro.key === row.key || descartar.has(outro.key)) return false;
        if (this.ehProcessoIncompletoObra(outro.proc)) return false;
        if (this.processosMesmoTitulo(row.proc, outro.proc)) return true;
        if (titulo && this.digitosProc(outro.proc.titulo) === titulo) {
          const outroNome = this.nomeClienteProc(outro.proc);
          if (nome && outroNome && (nome === outroNome || nome.indexOf(outroNome) >= 0 || outroNome.indexOf(nome) >= 0)) {
            return true;
          }
        }
        return false;
      });
      if (temMelhor) {
        descartar.add(row.key);
        motivos[row.key] = "duplicata-sem-cidade";
      }
    });
    /* Títulos incompletos em destaque (Rodolpho 13048 e Pedro 11333). */
    abertos.forEach((row) => {
      if (descartar.has(row.key) || !this.ehProcessoIncompletoObra(row.proc)) return;
      const titulo = this.digitosProc(row.proc.titulo);
      const nome = this.nomeClienteProc(row.proc);
      const alvo = (titulo === "13048" && (!nome || nome.indexOf("rodolpho") >= 0))
        || (titulo === "11333" && (!nome || nome.indexOf("pedro") >= 0));
      if (alvo) {
        descartar.add(row.key);
        motivos[row.key] = "ficha-incompleta-duplicata";
      }
    });
    if (!descartar.size) return false;
    descartar.forEach((key) => {
      if (!all[key]) return;
      this.marcarProcessoDescartado(all[key], motivos[key] || "duplicata-mesmo-titulo");
    });
    this.persistirMapaProcessos(all);
    if (FinanciamentoState.process) {
      const atualKey = this.procKey(FinanciamentoState.process.customerId, FinanciamentoState.process.contractId);
      if (descartar.has(atualKey)) FinanciamentoState.process = null;
    }
    return true;
  },

  isProcessoAberto(proc) {
    if (!proc) return false;
    const st = String(proc.status || "").toLowerCase();
    if (st === "concluido" || st === "concluída" || st === "completed" || st === "complete"
      || st === "encerrado" || st === "cancelado" || st === "cancelada" || st === "closed") return false;
    if (proc.closedAt || proc.finishedAt || proc.descartadoComoDuplicata) return false;
    return true;
  },

  listOpenProcesses() {
    this.sanearDuplicadosProcessos();
    const all = this.loadAllProcesses();
    const mem = FinanciamentoState.process;
    if (mem && mem.customerId && mem.contractId) {
      const key = this.procKey(mem.customerId, mem.contractId);
      const saved = all[key];
      const tm = Date.parse(mem.updatedAt || mem.startedAt || 0) || 0;
      const ts = Date.parse((saved && (saved.updatedAt || saved.startedAt)) || 0) || 0;
      if (!saved || tm >= ts) all[key] = mem;
    }
    const rows = Object.keys(all).map((key) => {
      const proc = all[key];
      if (!proc || typeof proc !== "object") return null;
      if (!this.isProcessoAberto(proc)) return null;
      return { key, proc };
    }).filter(Boolean);
    return this.deduplicarAbertosPorTitulo(rows);
  },

  isProcessoConcluido(proc) {
    if (!proc) return false;
    const status = String(proc.status || "").toLowerCase();
    if (status === "cancelado" || status === "cancelada" || status === "closed" || status === "encerrado") return false;
    return status === "concluido" || status === "concluída" || status === "completed" || status === "complete"
      || (!!proc.finishedAt && !proc.closedAt);
  },

  listCompletedProcesses() {
    const all = this.loadAllProcesses();
    const mem = FinanciamentoState.process;
    if (mem && mem.customerId && mem.contractId) {
      const key = this.procKey(mem.customerId, mem.contractId);
      const saved = all[key];
      const tm = Date.parse(mem.updatedAt || mem.finishedAt || 0) || 0;
      const ts = Date.parse((saved && (saved.updatedAt || saved.finishedAt)) || 0) || 0;
      if (!saved || tm >= ts) all[key] = mem;
    }
    return Object.keys(all).map((key) => {
      const proc = all[key];
      if (!proc || typeof proc !== "object" || !this.isProcessoConcluido(proc)) return null;
      return { key, proc };
    }).filter(Boolean).sort((a, b) =>
      String((b.proc.finishedAt || b.proc.updatedAt) || "").localeCompare(String((a.proc.finishedAt || a.proc.updatedAt) || ""))
    );
  },

  etapaLabel(proc) {
    const catalog = typeof window.buildFinanciamentoStageCatalog === "function"
      ? window.buildFinanciamentoStageCatalog()
      : (window.EtapasFinanciamentoState || []);
    const id = proc && proc.currentStageId;
    if (!id) return "Aguardando primeira etapa";
    const hit = (catalog || []).find((s) => s && String(s.id) === String(id));
    return (hit && (hit.label || hit.nome)) || String(id);
  },

  renderAbertos() {
    const tbody = document.getElementById("fin-abertos-tbody");
    const countEl = document.getElementById("fin-abertos-count");
    if (!tbody) return;
    const rows = this.listOpenProcesses();
    const atrasos = this.atrasadosEsteira();
    const ordem = new Map();
    atrasos.forEach((item, i) => ordem.set(String(item.row.key), i));
    const nVenc = atrasos.length;
    if (countEl) {
      countEl.style.color = nVenc ? "#b91c1c" : "#64748b";
      countEl.textContent = rows.length
        ? (rows.length + " em andamento" + (nVenc ? (" · " + nVenc + (nVenc === 1 ? " vencida" : " vencidas")) : ""))
        : "";
    }
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:22px;color:#94a3b8;">Nenhum financiamento em aberto. Pesquise um cliente e clique em Iniciar financiamento.</td></tr>';
      return;
    }
    const lista = rows.slice().sort((a, b) => {
      const ia = ordem.has(String(a.key)) ? ordem.get(String(a.key)) : 100000;
      const ib = ordem.has(String(b.key)) ? ordem.get(String(b.key)) : 100000;
      return ia - ib;
    });
    tbody.innerHTML = lista.map(({ key, proc }) => {
      const safeKey = String(key).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const vencida = ordem.has(String(key));
      const fundo = vencida ? "#fef2f2" : "";
      const hover = vencida ? "#fee2e2" : "#f0fdf4";
      return `<tr tabindex="0" role="button" onclick="FinanciamentoApp.abrirAberto('${safeKey}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();FinanciamentoApp.abrirAberto('${safeKey}')}" style="cursor:pointer;background:${fundo};${vencida ? "box-shadow:inset 4px 0 0 #b91c1c;" : ""}" onmouseover="this.style.background='${hover}'" onmouseout="this.style.background='${fundo}'">
        <td style="padding:10px;font-weight:700;font-size:0.75rem;color:${vencida ? "#991b1b" : "#0f172a"};">${this.esc(proc.customerName || proc.customerId || "—")}</td>
        <td style="padding:10px;font-size:0.75rem;">${this.esc(proc.contractNumber || proc.contractId || "—")}</td>
        <td style="padding:10px;font-size:0.75rem;font-weight:800;">${this.esc(proc.titulo || "—")}</td>
        <td style="padding:10px;font-size:0.75rem;">${this.esc(this.formatUnidade(proc.unit || "—"))}</td>
        <td style="padding:10px;font-size:0.75rem;color:${vencida ? "#b91c1c" : "#105436"};font-weight:700;">${this.esc(this.etapaLabel(proc))}${vencida ? ' <span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;background:#fee2e2;color:#991b1b;font-size:0.65rem;font-weight:800;letter-spacing:0.02em;">VENCIDA</span>' : ""}</td>
        <td style="padding:10px;font-size:0.75rem;color:#64748b;">${this.esc(this.fmtDate(proc.updatedAt || proc.startedAt))}</td>
      </tr>`;
    }).join("");
  },

  async abrirAberto(key) {
    const all = this.loadAllProcesses();
    const proc = all[String(key)];
    if (!proc) return;
    FinanciamentoState.process = proc;
    let customer = FinanciamentoState.customer;
    if (!customer || String(customer.id) !== String(proc.customerId)) {
      try {
        if (window.SiengeApiService && typeof SiengeApiService.getCustomer === "function") {
          customer = await SiengeApiService.getCustomer(proc.customerId);
        }
      } catch (e) {
        customer = { id: proc.customerId, name: proc.customerName };
      }
    }
    FinanciamentoState.customer = customer || { id: proc.customerId, name: proc.customerName };
    FinanciamentoState.selected = {
      customerId: proc.customerId,
      contractId: proc.contractId,
      titulo: proc.titulo,
      contractNumber: proc.contractNumber,
      contract: { unitName: proc.unit, enterpriseId: proc.empId },
      customer: FinanciamentoState.customer
    };
    FinanciamentoState.view = "fluxo";
    this.render();
  },

  procKey(customerId, contractId) {
    return String(customerId) + ":" + String(contractId);
  },

  getProcess(customerId, contractId) {
    const all = this.loadAllProcesses();
    return all[this.procKey(customerId, contractId)] || null;
  },

  saveProcess(proc) {
    if (!proc || proc.customerId == null || proc.contractId == null) return;
    const key = this.procKey(proc.customerId, proc.contractId);
    window._finProcMem = window._finProcMem || {};
    window._finProcMem[key] = proc;
    const all = this.loadAllProcesses();
    all[key] = proc;
    window._finProcMem = all;
    const raw = JSON.stringify(all);
    try { sessionStorage.setItem(FIN_PROC_KEY, raw); } catch (e) {}
    try { localStorage.setItem(FIN_PROC_KEY, raw); } catch (e) {}
    if (window.forceUploadLocalConfig) window.forceUploadLocalConfig(true).catch(() => {});
    if (FinanciamentoState.view === "busca") this.renderAbertos();
  },

  iniciar(customerId, contractId, titulo, contractNumber) {
    const customer = FinanciamentoState.customer || {};
    const contract = (FinanciamentoState.contracts || []).find((c) => String(c.id || c.contractId) === String(contractId)) || {};
    let proc = this.getProcess(customerId, contractId);
    if (!proc) {
      proc = {
        id: "fin-" + Date.now(),
        customerId: String(customerId),
        contractId: String(contractId),
        titulo: titulo || "",
        contractNumber: contractNumber || "",
        customerName: customer.name || "",
        unit: this.formatUnidade(contract.unitName || contract.unityName || contract.unitId || ""),
        empId: contract.enterpriseId || contract.costCenterId || "",
        costCenterId: String(contract.costCenterId || contract.enterpriseId || ""),
        enterpriseName: String(contract.enterpriseName || ""),
        companyId: contract.companyId || contract.idCompany || "",
        unitName: String(contract.unitName || contract.unityName || contract.unitId || ""),
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currentStageId: null,
        done: {}
      };
      const obra = this.obraDoProc(proc);
      if (obra.empreendimento !== "—") proc.enterpriseName = obra.empreendimento;
      if (obra.empresa !== "—") proc.companyName = obra.empresa;
      this.saveProcess(proc);
    }
    FinanciamentoState.selected = { customerId, contractId, titulo, contractNumber, contract, customer };
    FinanciamentoState.process = proc;
    FinanciamentoState.view = "fluxo";
    this.render();
  },

  voltarBusca() {
    const proc = FinanciamentoState.process;
    if (proc && proc.currentStageId) this.persistirRascunho(proc.currentStageId);
    else if (proc) this.saveProcess(proc);
    FinanciamentoState.view = "busca";
    FinanciamentoState.process = null;
    this.render();
  },

  hojeIso() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  },

  somarDias(iso, dias) {
    const base = String(iso || "").slice(0, 10);
    if (!base) return "";
    if (typeof window.addDaysIso === "function") return window.addDaysIso(base, dias);
    const d = new Date(base + "T12:00:00");
    if (isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + (Number(dias) || 0));
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  },

  diasEntre(de, ate) {
    const a = new Date(String(de || "").slice(0, 10) + "T12:00:00");
    const b = new Date(String(ate || "").slice(0, 10) + "T12:00:00");
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  },

  catalogoEtapas() {
    if (typeof window.buildFinanciamentoStageCatalog === "function") return window.buildFinanciamentoStageCatalog();
    return (window.EtapasFinanciamentoState || []).map((e, i) => ({
      id: e.id, nome: e.nome, label: (i + 1) + ". " + e.nome, dias: parseInt(e.dias, 10) || 0, selectable: true, hasChildren: false
    }));
  },

  /* O prazo corre a partir do dia em que o financiamento entrou na etapa atual. */
  prazoEtapa(proc, etapa) {
    const entrada = String((proc && proc.done && etapa && proc.done[etapa.id]) || (proc && (proc.updatedAt || proc.startedAt)) || "").slice(0, 10);
    const dias = etapa ? (parseInt(etapa.dias, 10) || 0) : 0;
    if (!etapa) return { entrada: entrada, limite: "", dias: 0, status: "sem-etapa", restantes: null };
    if (!dias) return { entrada: entrada, limite: "", dias: 0, status: "sem-prazo", restantes: null };
    if (!entrada) return { entrada: "", limite: "", dias: dias, status: "sem-prazo", restantes: null };
    const limite = this.somarDias(entrada, dias);
    const restantes = this.diasEntre(this.hojeIso(), limite);
    return { entrada: entrada, limite: limite, dias: dias, status: restantes < 0 ? "atrasado" : "no-prazo", restantes: restantes };
  },

  esteiraHtml() {
    const catalogo = this.catalogoEtapas();
    const colunasEtapa = catalogo.filter((s) => s.selectable !== false && !s.hasChildren);
    const abertos = this.listEsteiraProcesses();
    const porId = {};
    colunasEtapa.forEach((s) => { porId[String(s.id)] = []; });
    const fora = [];
    abertos.forEach((row) => {
      const id = row.proc && row.proc.currentStageId;
      if (porId[String(id)]) porId[String(id)].push(row);
      else fora.push(row);
    });
    const ordenar = (lista, etapa) => lista.slice().sort((a, b) => {
      const pa = this.prazoEtapa(a.proc, etapa);
      const pb = this.prazoEtapa(b.proc, etapa);
      const peso = (p) => p.status === "atrasado" ? -10000 + (p.restantes || 0) : (p.status === "no-prazo" ? (p.restantes || 0) : 10000);
      return peso(pa) - peso(pb);
    });
    const colunas = colunasEtapa.map((s) => ({ ...s, itens: ordenar(porId[String(s.id)] || [], s) }));
    if (fora.length) colunas.push({ id: "__fora", nome: "Etapa removida", label: "Etapa removida", dias: 0, itens: fora });
    const atrasados = abertos.filter((row) => {
      const etapa = colunasEtapa.find((s) => String(s.id) === String(row.proc.currentStageId));
      return etapa && this.prazoEtapa(row.proc, etapa).status === "atrasado";
    }).length;
    const noPrazo = abertos.filter((row) => {
      const etapa = colunasEtapa.find((s) => String(s.id) === String(row.proc.currentStageId));
      return etapa && this.prazoEtapa(row.proc, etapa).status === "no-prazo";
    }).length;
    const resumo = abertos.length
      ? `<p class="fin-esteira-resumo">${abertos.length} em andamento · ${noPrazo} no prazo · ${atrasados} atrasado${atrasados === 1 ? "" : "s"}.</p>`
      : `<p class="fin-esteira-resumo">Nenhum financiamento em aberto. Pesquise um cliente e clique em Iniciar financiamento.</p>`;
    const vazioEtapas = colunasEtapa.length ? "" : `<p class="fin-esteira-resumo">Nenhuma etapa cadastrada. Cadastre em Financiamento → Configurações.</p>`;
    return `<style>
      #financiamento-root .fin-abas { margin: 0 0 14px; }
      #financiamento-root .fin-esteira-resumo { margin: 0 0 12px; color: #64748b; font-size: 0.84rem; }
      #financiamento-root .fin-esteira { display: flex; gap: 12px; overflow-x: auto; align-items: flex-start; padding-bottom: 8px; }
      #financiamento-root .fin-col { flex: 0 0 300px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; min-height: 180px; display: flex; flex-direction: column; max-height: calc(100vh - 220px); }
      #financiamento-root .fin-col-h { padding: 12px 12px 8px; border-bottom: 1px solid #e2e8f0; }
      #financiamento-root .fin-col-h strong { display: block; color: #0f172a; font-size: 0.84rem; line-height: 1.3; }
      #financiamento-root .fin-col-h span { color: #64748b; font-size: 0.75rem; }
      #financiamento-root .fin-col-lista { padding: 10px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
      #financiamento-root .fin-card { text-align: left; width: 100%; min-width: 0; border: 1px solid #e2e8f0; border-left: 4px solid #105436; background: #fff; border-radius: 10px; padding: 10px 12px; cursor: pointer; }
      #financiamento-root .fin-card.is-atrasado { background: #fef2f2; border-color: #fecaca; border-left-color: #b91c1c; }
      #financiamento-root .fin-card.is-vence { border-left-color: #f37021; }
      #financiamento-root .fin-card.is-sem { border-left-color: #94a3b8; }
      #financiamento-root .fin-card-nome { font-weight: 800; color: #0f172a; font-size: 0.84rem; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      #financiamento-root .fin-card-linha { display: flex; flex-direction: column; min-width: 0; margin-top: 6px; }
      #financiamento-root .fin-card-linha span { font-size: 0.68rem; font-weight: 700; color: #64748b; }
      #financiamento-root .fin-card-linha b { font-size: 0.78rem; font-weight: 700; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #financiamento-root .fin-card-meta { color: #64748b; font-size: 0.75rem; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #financiamento-root .fin-pill { display: inline-block; margin-top: 8px; font-size: 0.72rem; font-weight: 800; border-radius: 999px; padding: 2px 8px; }
      #financiamento-root .fin-pill.is-ok { background: #dcfce7; color: #166534; }
      #financiamento-root .fin-pill.is-atrasado { background: #fee2e2; color: #991b1b; }
      #financiamento-root .fin-pill.is-vence { background: #ffedd5; color: #9a3412; }
      #financiamento-root .fin-pill.is-sem { background: #f1f5f9; color: #475569; }
      #financiamento-root .fin-col-vazia { color: #94a3b8; font-size: 0.78rem; padding: 8px 2px; }
      #financiamento-root .fin-card-nota { color: #334155; font-size: 0.75rem; margin-top: 6px; line-height: 1.35; }
    </style>
    ${resumo}${vazioEtapas}
    <div class="fin-esteira">${colunas.map((col) => this.colunaHtml(col)).join("")}</div>`;
  },

  concluidosHtml() {
    const processos = this.listCompletedProcesses();
    const linhas = processos.length ? processos.map(({ key, proc }) => {
      const chave = String(key).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const saldo = proc.saldoQuitacaoSistema != null && String(proc.saldoQuitacaoSistema).trim() !== "" && Number.isFinite(Number(proc.saldoQuitacaoSistema))
        ? Number(proc.saldoQuitacaoSistema) : null;
      const credito = proc.valorLiberadoCaixa != null && String(proc.valorLiberadoCaixa).trim() !== "" && Number.isFinite(Number(proc.valorLiberadoCaixa))
        ? Number(proc.valorLiberadoCaixa) : null;
      const diferenca = saldo != null && credito != null ? saldo - credito : null;
      const unidade = this.formatUnidade(proc.unit || proc.unitName || "—");
      const obra = this.obraDoProc(proc);
      return `<tr>
        <td title="${this.esc(proc.customerName || "—")}">${this.esc(proc.customerName || "—")}</td>
        <td title="${this.esc(proc.contractNumber || proc.contractId || "—")}">${this.esc(proc.contractNumber || proc.contractId || "—")}</td>
        <td title="${this.esc(obra.empreendimento + " · " + unidade)}" class="fin-concluido-unidade">${this.esc(obra.empreendimento)} · ${this.esc(unidade)}</td>
        <td class="is-right fin-concluido-valor">${saldo == null ? "—" : this.esc(this.fmtMoney(saldo))}</td>
        <td class="is-right fin-concluido-valor">${credito == null ? "—" : this.esc(this.fmtMoney(credito))}</td>
        <td class="is-right fin-concluido-valor">${diferenca == null ? "—" : this.esc(this.fmtMoney(diferenca))}</td>
        <td class="is-center">${this.esc(this.fmtDate(proc.finishedAt || proc.updatedAt))}</td>
        <td class="is-center"><button type="button" class="btn btn-outline btn-sm" onclick="FinanciamentoApp.abrirAberto('${chave}')">Abrir</button></td>
      </tr>`;
    }).join("") : '<tr><td colspan="8" style="text-align:center;padding:30px;">Nenhum financiamento concluído para exibir.</td></tr>';
    return `<section class="fin-concluidos" aria-label="Financiamentos concluídos">
      <p class="fin-esteira-resumo">${processos.length} financiamento${processos.length === 1 ? "" : "s"} concluído${processos.length === 1 ? "" : "s"}.</p>
      <div class="cc-scroll">
        <table class="cc-table fin-concluidos-table" aria-label="Lista de financiamentos concluídos">
          <colgroup>
            <col style="width:190px"><col style="width:115px"><col>
            <col style="width:125px"><col style="width:125px"><col style="width:125px">
            <col style="width:95px"><col style="width:75px">
          </colgroup>
          <thead><tr>
            <th>Cliente</th><th>Contrato</th><th>Empreendimento / unidade</th>
            <th class="is-right">Saldo quitação</th><th class="is-right">Crédito CAIXA</th>
            <th class="is-right">Diferença</th><th class="is-center">Concluído</th><th class="is-center">Ação</th>
          </tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
    </section>
    <style>
      #financiamento-root .fin-concluidos-table { min-width: 900px; }
      #financiamento-root .fin-concluidos-table .fin-concluido-valor { font-variant-numeric: tabular-nums; }
      #financiamento-root .fin-concluidos-table .fin-concluido-unidade { white-space: normal; }
      #financiamento-root .fin-concluidos-table tbody tr { cursor: default; }
    </style>`;
  },

  colunaHtml(col) {
    const etapa = col.id && col.id !== "__fora" ? col : null;
    const prazoTxt = !col.id ? "Entrada na esteira" : (col.id === "__fora" ? "Etapa que saiu do cadastro" : (etapa && etapa.dias ? (etapa.dias + (etapa.dias === 1 ? " dia" : " dias")) : "Sem prazo definido"));
    const cards = (col.itens || []).map((row) => this.cardEsteiraHtml(row, etapa)).join("");
    return `<section class="fin-col">
      <header class="fin-col-h">
        <strong>${this.esc(col.label || col.nome)}</strong>
        <span>${(col.itens || []).length} · ${this.esc(prazoTxt)}</span>
      </header>
      <div class="fin-col-lista">${cards || '<div class="fin-col-vazia">Nenhum financiamento</div>'}</div>
    </section>`;
  },

  obraDoProc(proc) {
    const ccs = (window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || [];
    const id = String((proc && (proc.costCenterId || proc.empId)) || "");
    const cc = id ? ccs.find((c) => String(c.id) === id) : null;
    const empreendimento = String((cc && cc.name) || (proc && proc.enterpriseName) || "").trim();
    const companyId = (cc && (cc.idCompany != null ? cc.idCompany : cc.companyId)) || (proc && proc.companyId) || "";
    let empresa = String((proc && proc.companyName) || "").trim();
    if (!empresa && companyId && typeof window.getCompanyName === "function") empresa = String(window.getCompanyName(companyId, true) || "").trim();
    return { empresa: empresa || "—", empreendimento: empreendimento || "—" };
  },

  cardEsteiraHtml(row, etapa) {
    const proc = row.proc || {};
    const obra = this.obraDoProc(proc);
    const prazo = this.prazoEtapa(proc, etapa);
    let cls = "is-sem";
    let pill = "Sem prazo";
    if (prazo.status === "atrasado") {
      cls = "is-atrasado";
      const n = Math.abs(prazo.restantes || 0);
      pill = "Atrasado " + n + (n === 1 ? " dia" : " dias");
    } else if (prazo.status === "no-prazo") {
      const n = prazo.restantes || 0;
      if (n <= 2) {
        cls = "is-vence";
        pill = n === 0 ? "Vence hoje" : ("Vence em " + n + (n === 1 ? " dia" : " dias"));
      } else {
        cls = "is-ok";
        pill = "No prazo · " + n + " dias";
      }
    }
    const quando = prazo.entrada ? ("Entrou em " + this.fmtDate(prazo.entrada)) : "Sem data de entrada";
    const limite = prazo.limite ? (" · prazo " + this.fmtDate(prazo.limite)) : "";
    const safeKey = String(row.key).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return `<button type="button" class="fin-card ${cls}" onclick="FinanciamentoApp.abrirAberto('${safeKey}')">
      <div class="fin-card-nome" title="${this.esc(proc.customerName || "")}">${this.esc(proc.customerName || proc.customerId || "—")}</div>
      <div class="fin-card-linha" title="${this.esc(obra.empresa)}"><span>Empresa</span><b>${this.esc(obra.empresa)}</b></div>
      <div class="fin-card-linha" title="${this.esc(obra.empreendimento)}"><span>Empreendimento</span><b>${this.esc(obra.empreendimento)}</b></div>
      <div class="fin-card-meta" title="${this.esc("Contrato " + (proc.contractNumber || proc.contractId || "—") + " · Título " + (proc.titulo || "—"))}">Contrato ${this.esc(proc.contractNumber || proc.contractId || "—")} · Título ${this.esc(proc.titulo || "—")}</div>
      <div class="fin-card-meta">${this.esc(this.formatUnidade(proc.unit || "—"))}</div>
      <div class="fin-card-meta" title="${this.esc(quando + limite)}">${this.esc(quando + limite)}</div>
      ${this.notaCardHtml(proc, etapa)}
      <span class="fin-pill ${cls}">${this.esc(pill)}</span>
    </button>`;
  },

  ehFeriado(iso) {
    if (window.EscalaHomeOffice && typeof window.EscalaHomeOffice.ehFeriado === "function") {
      return window.EscalaHomeOffice.ehFeriado(iso);
    }
    const ano = Number(String(iso).slice(0, 4));
    const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
    if (fixos.some((md) => iso === ano + "-" + md)) return true;
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31);
    const dia = ((h + l - 7 * m + 114) % 31) + 1;
    const pascoa = ano + "-" + String(mes).padStart(2, "0") + "-" + String(dia).padStart(2, "0");
    return [this.somarDias(pascoa, -48), this.somarDias(pascoa, -47), this.somarDias(pascoa, -2), this.somarDias(pascoa, 60)].indexOf(iso) >= 0;
  },

  ehDiaUtil(iso) {
    const dia = new Date(String(iso).slice(0, 10) + "T12:00:00").getDay();
    if (dia === 0 || dia === 6) return false;
    return !this.ehFeriado(iso);
  },

  segundaDaSemana(iso) {
    const dia = new Date(String(iso).slice(0, 10) + "T12:00:00").getDay();
    const volta = dia === 0 ? 6 : dia - 1;
    return this.somarDias(iso, -volta);
  },

  /* Segunda, ou o próximo dia útil se a segunda não for dia útil. */
  diaAlertaEsteira(hoje) {
    let d = this.segundaDaSemana(hoje);
    let guarda = 0;
    while (!this.ehDiaUtil(d) && guarda < 12) {
      d = this.somarDias(d, 1);
      guarda += 1;
    }
    return d;
  },

  usuarioVeAlertaEsteira() {
    let u = window.AppState && window.AppState.currentUser;
    if (!u) {
      try { u = JSON.parse(localStorage.getItem("crm_logged_user") || "null"); } catch (e) { u = null; }
    }
    if (!u) return false;
    const imp = typeof window.crmImpersonacaoAtual === "function" ? window.crmImpersonacaoAtual() : null;
    const efetivo = imp || u;
    if (!imp && typeof window.isCrmAdministrator === "function" && window.isCrmAdministrator(u)) return true;
    if (typeof window.isCrmAdminProfileName === "function" && window.isCrmAdminProfileName(efetivo.profile_name || efetivo.profile || efetivo.role || "")) return true;
    return typeof window.isCobrancaBackOfficeUser === "function" && window.isCobrancaBackOfficeUser(efetivo);
  },

  chaveAlertaEsteira(dia) {
    let u = window.AppState && window.AppState.currentUser;
    if (!u || !(u.email || u.name)) {
      try { u = JSON.parse(localStorage.getItem("crm_logged_user") || "null"); } catch (e) { u = null; }
    }
    const imp = typeof window.crmImpersonacaoAtual === "function" ? window.crmImpersonacaoAtual() : null;
    const quem = imp || u || {};
    return "crm_fin_esteira_" + String(quem.email || quem.name || "op").toLowerCase() + "_" + dia;
  },

  atrasadosEsteira() {
    const etapas = this.catalogoEtapas().filter((s) => s && s.selectable !== false && !s.hasChildren);
    return this.listOpenProcesses().map((row) => {
      const etapa = etapas.find((s) => String(s.id) === String(row.proc && row.proc.currentStageId));
      if (!etapa) return null;
      const prazo = this.prazoEtapa(row.proc, etapa);
      if (prazo.status !== "atrasado") return null;
      return { row, etapa, prazo };
    }).filter(Boolean).sort((a, b) => (a.prazo.restantes || 0) - (b.prazo.restantes || 0));
  },

  agendarAlertaEsteira() {
    if (this._finAlertaTimer) {
      clearTimeout(this._finAlertaTimer);
      this._finAlertaTimer = null;
    }
    if (!this.usuarioVeAlertaEsteira()) return;
    const hoje = this.hojeIso();
    const oito = new Date(hoje + "T08:00:00");
    if (Date.now() < oito.getTime()) {
      this._finAlertaTimer = setTimeout(() => this.agendarAlertaEsteira(), Math.max(1000, oito.getTime() - Date.now()));
      return;
    }
    this.abrirAlertaEsteira();
    const amanha = new Date(this.somarDias(hoje, 1) + "T08:00:00");
    this._finAlertaTimer = setTimeout(() => this.agendarAlertaEsteira(), Math.max(1000, amanha.getTime() - Date.now()));
  },

  abrirAlertaEsteira() {
    if (!this.usuarioVeAlertaEsteira()) return;
    const hoje = this.hojeIso();
    if (Date.now() < new Date(hoje + "T08:00:00").getTime()) return;
    const chave = this.chaveAlertaEsteira(hoje);
    try { if (localStorage.getItem(chave) === "ciente") return; } catch (e) {}
    const lista = this.atrasadosEsteira();
    if (!lista.length || document.getElementById("fin-alerta")) return;
    const linhas = lista.map((item) => {
      const proc = item.row.proc || {};
      const n = Math.abs(item.prazo.restantes || 0);
      const safe = String(item.row.key).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      return `<button type="button" class="fin-alerta-item" onclick="FinanciamentoApp.abrirDoAlerta('${safe}')">
        <strong>${this.esc(proc.customerName || "—")}</strong>
        <span>Contrato ${this.esc(proc.contractNumber || proc.contractId || "—")} · ${this.esc(this.formatUnidade(proc.unit || "—"))}</span>
        <span>${this.esc(item.etapa.label || item.etapa.nome)} · venceu em ${this.esc(this.fmtDate(item.prazo.limite))} · ${n} dia${n === 1 ? "" : "s"}</span>
      </button>`;
    }).join("");
    const overlay = document.createElement("div");
    overlay.id = "fin-alerta";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-labelledby", "fin-alerta-titulo");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483004;display:flex;align-items:center;justify-content:center;background:rgba(12,41,29,0.55);padding:16px;";
    overlay.innerHTML = `<div style="background:#fff;border-radius:12px;width:100%;max-width:640px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 18px 40px rgba(0,0,0,0.22);border:1px solid rgba(16,84,54,0.12);font-family:inherit;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px 0;">
        <h2 id="fin-alerta-titulo" style="margin:0;font-size:1.05rem;color:#105436;">Etapas vencidas na esteira</h2>
        <button type="button" class="btn btn-fechar" id="fin-alerta-fechar">Fechar</button>
      </div>
      <div style="padding:12px 18px 18px;overflow:auto;">
        <p style="margin:0 0 12px;color:#1e293b;font-size:0.92rem;line-height:1.45;">${lista.length} financiamento${lista.length === 1 ? "" : "s"} na esteira com a etapa atual fora do prazo.</p>
        <div style="display:flex;flex-direction:column;gap:8px;">${linhas}</div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const estilo = document.createElement("style");
    estilo.textContent = "#fin-alerta .fin-alerta-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;width:100%;border:1px solid #fecaca;border-left:4px solid #b91c1c;background:#fff;border-radius:10px;padding:10px 12px;cursor:pointer;}#fin-alerta .fin-alerta-item strong{color:#0f172a;font-size:0.9rem;}#fin-alerta .fin-alerta-item span{color:#64748b;font-size:0.78rem;}";
    overlay.appendChild(estilo);
    overlay.querySelector("#fin-alerta-fechar").addEventListener("click", () => this.fecharAlertaEsteira(chave));
  },

  fecharAlertaEsteira(chave) {
    try { localStorage.setItem(chave, "ciente"); } catch (e) {}
    const pop = document.getElementById("fin-alerta");
    if (pop) pop.remove();
  },

  async abrirDoAlerta(key) {
    const hoje = this.hojeIso();
    this.fecharAlertaEsteira(this.chaveAlertaEsteira(hoje));
    if (typeof window.switchTab === "function") window.switchTab("financiamento", "Financiamento");
    await this.abrirAberto(key);
  },

  async prepararTagsUnidade() {
    const atual = FinanciamentoState.process && FinanciamentoState.process.currentStageId;
    if (atual) this.pintarTag(atual);
    if (window.AnexosApp && typeof window.AnexosApp.loadTagsAtivas === "function") {
      try { await window.AnexosApp.loadTagsAtivas(); } catch (e) {}
    }
    const todas = (window.AnexosState && window.AnexosState.tagsAtivas) || [];
    this._tagsUnidade = todas.filter((t) => {
      if (window.AnexosApp && typeof window.AnexosApp.tagDestino === "function") return window.AnexosApp.tagDestino(t) === "Unidade";
      return true;
    });
    this._tagsProntas = true;
    const proc = FinanciamentoState.process;
    if (proc && proc.currentStageId) this.pintarTag(proc.currentStageId);
  },

  tagUi(stageId) {
    this._tagUi = this._tagUi || {};
    if (!this._tagUi[stageId]) this._tagUi[stageId] = { open: false, query: "", value: "" };
    return this._tagUi[stageId];
  },

  tagEscolhida(stageId) {
    return String((this.tagUi(stageId).value) || "");
  },

  itensTag() {
    return (this._tagsUnidade || []).map((t) => ({ id: t.name, label: t.name }));
  },

  opcoesTag(stageId) {
    const ui = this.tagUi(stageId);
    const items = this.itensTag();
    return {
      id: "fin-tag-" + stageId,
      label: "Tag",
      items: items,
      selectedIds: ui.value ? [ui.value] : [],
      open: !!ui.open,
      query: ui.query || "",
      single: true,
      emptyMeansAll: false,
      emptyLabel: "Escolha a tag",
      keepOrder: true,
      extraClass: "ml-emp-filter--corte",
      nouns: {
        singular: "tag",
        plural: "tags",
        none: this._tagsProntas ? "Nenhuma tag de unidade" : "Carregando tags…",
        noMatch: "Nenhuma tag com esse nome."
      }
    };
  },

  ligarTag(stageId) {
    if (!window.MlEmpresaFilter) return;
    const ui = this.tagUi(stageId);
    window.MlEmpresaFilter.bind("fin-tag-" + stageId, {
      toggleOpen: () => { ui.open = !ui.open; this.pintarTag(stageId); },
      close: () => { ui.open = false; this.pintarTag(stageId); },
      setQuery: (q) => { ui.query = q; this.pintarTagLista(stageId); },
      toggleId: (itemId, on) => {
        ui.value = on ? String(itemId) : "";
        ui.open = true;
        this.pintarTag(stageId);
      }
    });
  },

  pintarTag(stageId) {
    const box = document.getElementById("fin-tag-box-" + stageId);
    if (!box || !window.MlEmpresaFilter) return;
    this.ligarTag(stageId);
    box.innerHTML = window.MlEmpresaFilter.html(this.opcoesTag(stageId));
    if (window.lucide) {
      const root = box.querySelector(".ml-emp-filter") || box;
      lucide.createIcons({ root: root });
    }
  },

  pintarTagLista(stageId) {
    const list = document.getElementById("fin-tag-" + stageId + "-list");
    if (!list || !window.MlEmpresaFilter) {
      this.pintarTag(stageId);
      return;
    }
    list.innerHTML = window.MlEmpresaFilter.listHtml(this.opcoesTag(stageId));
  },

  arquivosDaArea(data) {
    if (!data) return [];
    const vistos = [];
    const por = (f) => {
      if (!f) return;
      if (vistos.some((x) => x === f || (x.name === f.name && x.size === f.size && x.lastModified === f.lastModified))) return;
      vistos.push(f);
    };
    if (data.files) Array.from(data.files).forEach(por);
    if (data.items) {
      Array.from(data.items).forEach((item) => {
        if (item.kind === "file" && typeof item.getAsFile === "function") por(item.getAsFile());
      });
    }
    return vistos.map((f, i) => {
      if (f.name) return f;
      const ext = (f.type && f.type.split("/")[1]) || "png";
      return new File([f], "colado-" + Date.now() + "-" + i + "." + ext, { type: f.type || "image/png" });
    });
  },

  pendentesDe(stageId) {
    this._pendentes = this._pendentes || {};
    return this._pendentes[stageId] || [];
  },

  guardarPendentes(stageId, files) {
    this._pendentes = this._pendentes || {};
    const atual = this._pendentes[stageId] || [];
    const novos = [];
    (files || []).forEach((file) => {
      const duplicado = atual.concat(novos).some((pendente) =>
        pendente === file || (
          pendente.name === file.name
          && pendente.size === file.size
          && pendente.lastModified === file.lastModified
          && pendente.type === file.type
        )
      );
      if (!duplicado) novos.push(file);
    });
    this._pendentes[stageId] = atual.concat(novos);
    this.pintarPendentes(stageId);
  },

  pintarPendentes(stageId) {
    const st = document.getElementById("fin-st-" + stageId);
    const nomes = this.pendentesDe(stageId).map((f) => f.name).filter(Boolean);
    if (!st || !nomes.length) return;
    st.textContent = nomes.join(", ") + " — clique em Enviar para a unidade.";
  },

  ehCartaSiopi(file, tag, quantidade) {
    const nomeSiopi = /siopi/i.test(String(file && file.name || ""));
    const tagSiopi = /siopi/i.test(String(tag || ""));
    const pdf = !!(file && (file.type === "application/pdf" || /\.pdf$/i.test(String(file.name || ""))));
    return nomeSiopi || (tagSiopi && pdf && quantidade === 1);
  },

  async extrairValorCaixaCartaSiopi(file) {
    const pdfjs = window["pdfjs-dist/build/pdf"] || window.pdfjsLib;
    if (!pdfjs || typeof pdfjs.getDocument !== "function") throw new Error("O leitor de PDF não está disponível nesta página.");
    if (!file || !(file.type === "application/pdf" || /\.pdf$/i.test(String(file.name || "")))) {
      throw new Error("A Carta SIOPI precisa estar em PDF para leitura automática.");
    }
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    try {
      let texto = "";
      for (let pagina = 1; pagina <= pdf.numPages; pagina++) {
        const conteudo = await pdf.getPage(pagina);
        const itens = await conteudo.getTextContent();
        texto += (itens.items || []).map((item) => String(item.str || "")).join(" ") + " ";
      }
      const normalizado = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toUpperCase().replace(/\s+([.,])/g, "$1").replace(/([.,])\s+/g, "$1").replace(/\s+/g, " ");
      const valorRegex = "((?:\\d{1,3}(?:\\.\\d{3})+|\\d+),\\d{2})";
      const rotulos = [
        /VALOR\s+LIBERADO(?:\s+PELA\s+CAIXA)?/,
        /VALOR\s+(?:TOTAL\s+)?DO\s+FINANCIAMENTO/,
        /VALOR\s+DE\s+FINANCIAMENTO/,
        /VALOR\s+(?:TOTAL\s+)?DO\s+CREDITO/,
        /VALOR\s+DE\s+CREDITO/,
        /CREDITO\s+CONCEDIDO/
      ];
      for (let i = 0; i < rotulos.length; i++) {
        const regex = new RegExp("\\b" + rotulos[i].source + "\\b\\s*(?:[:=\\-]\\s*)?(?:R\\$\\s*)?" + valorRegex, "g");
        const valores = [];
        let match;
        while ((match = regex.exec(normalizado)) !== null) {
          const valor = Number(match[1].replace(/\./g, "").replace(",", "."));
          if (Number.isFinite(valor) && valor > 0) valores.push(valor);
        }
        const unicos = Array.from(new Set(valores));
        if (unicos.length > 1) throw new Error("A Carta SIOPI contém mais de um valor possível de financiamento; confira o documento.");
        if (unicos.length === 1) return unicos[0];
      }
      if (!normalizado.trim()) throw new Error("Não foi possível ler texto no PDF da Carta SIOPI; o arquivo pode ser digitalizado como imagem.");
      throw new Error("Não identifiquei o valor liberado/financiado na Carta SIOPI.");
    } finally {
      if (typeof pdf.destroy === "function") await pdf.destroy();
    }
  },

  ligarEtapa() {
    const root = document.getElementById("financiamento-root");
    if (!root || root.dataset.finLigado === "1") return;
    root.dataset.finLigado = "1";
    root.addEventListener("input", (e) => {
      const id = (e.target && e.target.id) || "";
      if (id.indexOf("fin-nota-data-") === 0 || id.indexOf("fin-nota-st-") === 0) return;
      if (id.indexOf("fin-nota-") === 0) this.agendarNota(id.slice("fin-nota-".length));
    });
    root.addEventListener("change", (e) => {
      const id = (e.target && e.target.id) || "";
      if (id.indexOf("fin-nota-data-") === 0) this.persistirRascunho(id.slice("fin-nota-data-".length));
      if (id.indexOf("fin-arq-") === 0) this.aoEscolherArquivo(id.slice("fin-arq-".length));
    });
    root.addEventListener("focusout", (e) => {
      const id = (e.target && e.target.id) || "";
      if (id.indexOf("fin-nota-data-") === 0) this.persistirRascunho(id.slice("fin-nota-data-".length));
      else if (id.indexOf("fin-nota-") === 0 && id.indexOf("fin-nota-st-") !== 0) this.persistirRascunho(id.slice("fin-nota-".length));
    });
    root.addEventListener("paste", (e) => this.aoColar(e));
  },

  agendarNota(stageId) {
    if (this._notaTimer) clearTimeout(this._notaTimer);
    this._notaTimer = setTimeout(() => this.persistirRascunho(stageId), 700);
  },

  aoEscolherArquivo(stageId) {
    const arq = document.getElementById("fin-arq-" + stageId);
    const files = arq && arq.files ? Array.from(arq.files) : [];
    if (!files.length) return;
    this.guardarPendentes(stageId, files);
    if (arq) arq.value = "";
  },

  aoColar(e) {
    const files = this.arquivosDaArea(e.clipboardData);
    if (!files.length) return;
    const proc = FinanciamentoState.process;
    const stageId = proc && proc.currentStageId;
    if (!stageId) return;
    e.preventDefault();
    this.guardarPendentes(stageId, files);
  },

  async enviarAnexo(stageId, listaForcada) {
    const proc = FinanciamentoState.process;
    const btn = document.getElementById("fin-env-" + stageId);
    const st = document.getElementById("fin-st-" + stageId);
    const tag = this.tagEscolhida(stageId);
    const files = listaForcada && listaForcada.length ? listaForcada : this.pendentesDe(stageId).slice();
    if (!proc) return false;
    if (String(proc.currentStageId || "") !== String(stageId)) return false;
    this._enviosAnexo = this._enviosAnexo || new Set();
    const stageKey = String(stageId);
    if (this._enviosAnexo.has(stageKey)) return false;
    if (!files.length || !tag) {
      if (st) st.textContent = files.length ? "Escolha a tag da unidade para gravar o anexo." : "Escolha o arquivo, ou cole com Ctrl+V, e a tag da unidade.";
      return false;
    }
    if (typeof window.anexosUploadUnitAttachment !== "function") {
      if (st) st.textContent = "O envio de anexos da unidade não está disponível.";
      return false;
    }
    this._enviosAnexo.add(stageKey);
    if (btn) { btn.disabled = true; btn.textContent = "Enviando…"; }
    if (st) st.textContent = "";
    const restam = [];
    let falha = "";
    const pdfs = files.filter((file) => file && (file.type === "application/pdf" || /\.pdf$/i.test(String(file.name || ""))));
    const cartaSiopi = files.find((file) => /siopi/i.test(String(file && file.name || "")))
      || pdfs.find((file) => this.ehCartaSiopi(file, tag, pdfs.length));
    let creditoCaixaCarta = null;
    let erroLeituraCarta = "";
    if (cartaSiopi) {
      if (st) st.textContent = "Lendo a Carta SIOPI para identificar o valor liberado pela CAIXA…";
      try {
        creditoCaixaCarta = await this.extrairValorCaixaCartaSiopi(cartaSiopi);
      } catch (e) {
        erroLeituraCarta = (e && e.message) || "Não consegui identificar o valor na Carta SIOPI.";
      }
    }
    let cartaSiopiEnviada = false;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const resp = await window.anexosUploadUnitAttachment({
            file: file,
            tagLabel: tag,
            costCenterId: proc.costCenterId || proc.empId,
            unitName: proc.unitName || proc.unit,
            sale: {
              customerId: proc.customerId,
              id: proc.contractId,
              contractId: proc.contractId,
              contractNumber: proc.contractNumber,
              receivableBillId: proc.titulo,
              costCenterId: proc.costCenterId || proc.empId,
              unitName: proc.unitName || proc.unit
            },
            context: "financiamento"
          });
          proc.anexos = proc.anexos || {};
          const lista = Array.isArray(proc.anexos[stageId]) ? proc.anexos[stageId] : [];
          lista.push({
            id: "a-" + Date.now() + "-" + i,
            tag: tag,
            fileName: resp.fileName || file.name,
            em: new Date().toISOString(),
            unitId: resp.unitId || ""
          });
          proc.anexos[stageId] = lista;
          if (file === cartaSiopi) {
            cartaSiopiEnviada = true;
            if (creditoCaixaCarta != null) {
              proc.valorLiberadoCaixa = creditoCaixaCarta;
              proc.valorLiberadoCaixaAtualizadoEm = new Date().toISOString();
              proc.valorLiberadoCaixaArquivo = file.name || resp.fileName || "";
              proc.valorLiberadoCaixaErro = "";
            } else {
              proc.valorLiberadoCaixaErro = erroLeituraCarta || "Não consegui identificar o valor na Carta SIOPI.";
            }
          }
        } catch (e) {
          restam.push(file);
          falha = (e && e.message) ? e.message : "Não consegui enviar o anexo para a unidade.";
        }
      }
      this._pendentes = this._pendentes || {};
      this._pendentes[stageId] = restam;
      proc.updatedAt = new Date().toISOString();
      this.saveProcess(proc);
      FinanciamentoState.process = proc;
      this.render();
      const st2 = document.getElementById("fin-st-" + stageId);
      const btn2 = document.getElementById("fin-env-" + stageId);
      if (cartaSiopiEnviada && st2) {
        st2.textContent = creditoCaixaCarta != null
          ? "Carta SIOPI anexada; crédito CAIXA atualizado para " + this.fmtMoney(creditoCaixaCarta) + "."
          : "Carta SIOPI anexada, mas " + (erroLeituraCarta || "não consegui identificar o valor liberado pela CAIXA.");
      } else if (falha && st2) st2.textContent = falha;
      if (btn2 && restam.length) { btn2.disabled = false; btn2.textContent = "Enviar para a unidade"; }
      return !restam.length;
    } finally {
      this._enviosAnexo.delete(stageKey);
      const btnAtual = document.getElementById("fin-env-" + stageId);
      if (btnAtual && btnAtual.textContent === "Enviando…") {
        btnAtual.disabled = false;
        btnAtual.textContent = "Enviar para a unidade";
      }
    }
  },

  folhasEtapa(etapas) {
    return (etapas || []).filter((s) => s && s.hasChildren !== true && s.selectable !== false);
  },

  mesmoDiaLocal(iso) {
    const em = Date.parse(iso || 0) || 0;
    if (!em) return false;
    const a = new Date(em);
    const b = new Date();
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  },

  concluidaEm(proc, stageId) {
    if (!proc || stageId == null) return "";
    const mapa = proc.concluidas || {};
    const marca = mapa[stageId] || mapa[String(stageId)] || "";
    if (!marca) return "";
    const desfeitos = proc.desfeitos || {};
    const desfeito = desfeitos[stageId] || desfeitos[String(stageId)];
    if (desfeito && (Date.parse(desfeito.em || 0) || 0) >= (Date.parse(marca) || 0)) return "";
    return marca;
  },

  indiceAtivo(proc, folhas) {
    if (!folhas.length) return -1;
    if (proc && proc.currentStageId) {
      const i = folhas.findIndex((s) => String(s.id) === String(proc.currentStageId));
      if (i >= 0 && !this.concluidaEm(proc, folhas[i].id)) return i;
    }
    return folhas.findIndex((s) => !this.concluidaEm(proc, s.id));
  },

  operadorAtual() {
    let u = window.AppState && window.AppState.currentUser;
    if (!u) {
      try { u = JSON.parse(localStorage.getItem("crm_logged_user") || "null"); } catch (e) { u = null; }
    }
    const imp = typeof window.crmImpersonacaoAtual === "function" ? window.crmImpersonacaoAtual() : null;
    const efetivo = imp || u || {};
    const id = String(efetivo.email || efetivo.id || efetivo.username || efetivo.name || "").trim().toLowerCase();
    const nome = String(efetivo.name || efetivo.email || "").trim();
    return { id: id, nome: nome };
  },

  ultimoAvanco(proc) {
    const lista = proc && Array.isArray(proc.avancos) ? proc.avancos : [];
    return lista.length ? lista[lista.length - 1] : null;
  },

  avancoDentroDoPrazo(av) {
    return this.mesmoDiaLocal(av && av.em);
  },

  avancoEhMeu(av) {
    const eu = this.operadorAtual();
    return !!(eu.id && av && String(av.por || "") === eu.id);
  },

  alvoDesfazer(proc) {
    if (!proc) return null;
    const av = this.ultimoAvanco(proc);
    if (av) {
      if (!this.avancoDentroDoPrazo(av) || !this.avancoEhMeu(av)) return null;
      return { stageId: String(av.stageId), nome: av.nome || "etapa anterior", legado: false, av: av, em: av.em };
    }
    const folhas = this.folhasEtapa(this.catalogoEtapas());
    const idx = this.indiceAtivo(proc, folhas);
    const anterior = idx > 0 ? folhas[idx - 1] : (idx < 0 && folhas.length ? folhas[folhas.length - 1] : null);
    if (!anterior) return null;
    const em = this.concluidaEm(proc, anterior.id);
    if (!em || !this.mesmoDiaLocal(em)) return null;
    if (!this.operadorAtual().id) return null;
    return { stageId: String(anterior.id), nome: anterior.nome || anterior.label || "etapa anterior", legado: true, em: em };
  },

  podeDesfazer(proc) {
    return !!this.alvoDesfazer(proc);
  },

  iniciarEtapa(stageId) {
    const proc = FinanciamentoState.process;
    if (!proc) return;
    const folhas = this.folhasEtapa(this.catalogoEtapas());
    const idx = folhas.findIndex((s) => String(s.id) === String(stageId));
    if (idx < 0 || this.indiceAtivo(proc, folhas) !== idx) return;
    if (String(proc.currentStageId || "") === String(stageId)) return;
    proc.currentStageId = stageId;
    proc.done = proc.done || {};
    if (!proc.done[stageId]) proc.done[stageId] = new Date().toISOString();
    proc.updatedAt = new Date().toISOString();
    this.saveProcess(proc);
    FinanciamentoState.process = proc;
    this.render();
  },

  listaNotas(proc, stageId) {
    const bruto = this.notaDe(proc, stageId);
    if (!bruto) return [];
    const lista = Array.isArray(bruto) ? bruto : [bruto];
    const fechadas = proc && proc.notasFechadas;
    const corte = Date.parse((fechadas && (fechadas[stageId] || fechadas[String(stageId)])) || 0) || 0;
    return lista.filter((n) => {
      if (!n || (!n.texto && !n.data)) return false;
      if (n.rascunho && corte && (Date.parse(n.em || 0) || 0) <= corte) return false;
      return true;
    }).map((n) => Object.assign({}, n));
  },

  garantirNotas(proc, stageId) {
    proc.notas = proc.notas || {};
    const bruto = proc.notas[stageId] || proc.notas[String(stageId)] || [];
    const lista = (Array.isArray(bruto) ? bruto : [bruto]).filter((n) => n && typeof n === "object").map((n) => Object.assign({}, n));
    lista.forEach((n, i) => {
      if (!n.id) n.id = n.rascunho ? ("n-rascunho-" + stageId) : ("n-legado-" + stageId + (i ? "-" + i : ""));
    });
    proc.notas[stageId] = lista;
    const chaveStr = String(stageId);
    if (chaveStr !== stageId) delete proc.notas[chaveStr];
    return lista;
  },

  lerNotaDaTela(stageId) {
    const textoEl = document.getElementById("fin-nota-" + stageId);
    const dataEl = document.getElementById("fin-nota-data-" + stageId);
    if (!textoEl && !dataEl) return null;
    return {
      texto: textoEl ? String(textoEl.value || "").trim() : "",
      data: dataEl ? String(dataEl.value || "").slice(0, 10) : ""
    };
  },

  persistirRascunho(stageId) {
    const proc = FinanciamentoState.process;
    const lido = this.lerNotaDaTela(stageId);
    if (!proc || !lido || String(proc.currentStageId || "") !== String(stageId)) return;
    const assinatura = (bruto) => {
      const base = !bruto ? [] : (Array.isArray(bruto) ? bruto : [bruto]);
      return JSON.stringify(base.filter((n) => n && (n.texto || n.data)).map((n) => ({
        rascunho: !!n.rascunho,
        texto: String(n.texto || ""),
        data: String(n.data || "")
      })));
    };
    const antes = assinatura(proc.notas && (proc.notas[stageId] || proc.notas[String(stageId)]));
    const lista = this.garantirNotas(proc, stageId).filter((n) => !n.rascunho);
    if (!lido.texto && !lido.data) {
      proc.notas[stageId] = lista;
    } else {
      lista.push({
        id: "n-rascunho-" + stageId,
        rascunho: true,
        texto: lido.texto,
        data: lido.data,
        em: new Date().toISOString()
      });
      proc.notas[stageId] = lista;
    }
    if (assinatura(proc.notas[stageId]) === antes) return;
    proc.updatedAt = new Date().toISOString();
    this.saveProcess(proc);
    FinanciamentoState.process = proc;
    const st = document.getElementById("fin-nota-st-" + stageId);
    if (st && (lido.texto || lido.data)) st.textContent = "Salvo nesta etapa.";
    else if (st && st.textContent === "Salvo nesta etapa.") st.textContent = "";
  },

  fixarNota(stageId) {
    const proc = FinanciamentoState.process;
    const lido = this.lerNotaDaTela(stageId);
    if (!proc || String(proc.currentStageId || "") !== String(stageId)) return false;
    const texto = lido ? lido.texto : "";
    const data = lido && lido.data ? lido.data : (texto ? this.hojeIso() : "");
    const lista = this.garantirNotas(proc, stageId).filter((n) => !n.rascunho);
    if (!texto && !data) {
      proc.notas[stageId] = lista;
      return false;
    }
    const agora = new Date().toISOString();
    lista.push({
      id: "n-" + Date.now(),
      texto: texto,
      data: data,
      em: agora
    });
    proc.notas[stageId] = lista;
    proc.notasFechadas = proc.notasFechadas || {};
    proc.notasFechadas[stageId] = agora;
    proc.updatedAt = new Date().toISOString();
    this.saveProcess(proc);
    FinanciamentoState.process = proc;
    return true;
  },

  async concluirEtapa(stageId) {
    let proc = FinanciamentoState.process;
    if (!proc || String(proc.currentStageId || "") !== String(stageId)) return;
    const folhas = this.folhasEtapa(this.catalogoEtapas());
    const idx = folhas.findIndex((s) => String(s.id) === String(stageId));
    if (idx < 0 || this.indiceAtivo(proc, folhas) !== idx) return;
    const btn = document.getElementById("fin-concluir-" + stageId);
    if (btn) btn.disabled = true;
    if (this._notaTimer) clearTimeout(this._notaTimer);
    this.fixarNota(stageId);
    proc = FinanciamentoState.process;
    if (this.pendentesDe(stageId).length) {
      const st = document.getElementById("fin-st-" + stageId);
      if (st) st.textContent = "Clique em Enviar para a unidade antes de concluir a etapa.";
      if (btn) btn.disabled = false;
      return;
    }
    const proxima = folhas[idx + 1];
    const tinhaDone = !!(proxima && proc.done && (proc.done[proxima.id] || proc.done[String(proxima.id)]));
    const eu = this.operadorAtual();
    const quando = new Date().toISOString();
    proc.concluidas = proc.concluidas || {};
    proc.concluidas[stageId] = quando;
    if (proc.desfeitos) {
      delete proc.desfeitos[stageId];
      delete proc.desfeitos[String(stageId)];
    }
    proc.avancos = Array.isArray(proc.avancos) ? proc.avancos : [];
    proc.avancos.push({
      stageId: String(stageId),
      nome: (folhas[idx] && (folhas[idx].nome || folhas[idx].label)) || "etapa",
      em: quando,
      por: eu.id,
      nomeOperador: eu.nome,
      proximaId: proxima ? String(proxima.id) : "",
      criouDoneProxima: !!(proxima && !tinhaDone),
      statusAntes: proc.status || "",
      finishedAtAntes: proc.finishedAt || ""
    });
    if (proxima) {
      proc.currentStageId = proxima.id;
      proc.done = proc.done || {};
      if (!proc.done[proxima.id]) proc.done[proxima.id] = quando;
      if (String(proc.status || "") === "concluido") proc.status = "";
      proc.finishedAt = "";
    } else {
      proc.status = "concluido";
      proc.finishedAt = quando;
    }
    proc.updatedAt = quando;
    this.saveProcess(proc);
    FinanciamentoState.process = proc;
    if (proxima) this.render();
    else this.setPainel("concluidos");
  },

  async desfazerAvanco() {
    const proc = FinanciamentoState.process;
    const alvo = proc && this.alvoDesfazer(proc);
    if (!alvo) return;
    const msg = `Desfazer a conclusão de "${alvo.nome}"? O financiamento volta para essa etapa. A nota e o anexo gravados permanecem.`;
    const ok = typeof window.mouraConfirm === "function" ? await window.mouraConfirm(msg) : confirm(msg);
    if (!ok) return;
    const agora = new Date().toISOString();
    const eu = this.operadorAtual();
    proc.desfeitos = proc.desfeitos || {};
    proc.desfeitos[alvo.stageId] = { em: agora, por: eu.id, nome: eu.nome };
    proc.concluidas = proc.concluidas || {};
    delete proc.concluidas[alvo.stageId];
    delete proc.concluidas[String(alvo.stageId)];
    if (alvo.legado) {
      const deixando = proc.currentStageId;
      if (deixando && proc.done && proc.done[deixando]) {
        const td = Date.parse(proc.done[deixando]) || 0;
        const tc = Date.parse(alvo.em) || 0;
        if (td && tc && Math.abs(td - tc) < 15000) {
          proc.doneRevogados = proc.doneRevogados || {};
          proc.doneRevogados[deixando] = agora;
          delete proc.done[deixando];
        }
      }
      if (String(proc.status || "") === "concluido") {
        proc.status = "";
        proc.finishedAt = "";
      }
    } else {
      const av = alvo.av || {};
      if (av.criouDoneProxima && av.proximaId && proc.done) {
        proc.doneRevogados = proc.doneRevogados || {};
        proc.doneRevogados[av.proximaId] = agora;
        delete proc.done[av.proximaId];
      }
      proc.status = av.statusAntes || "";
      proc.finishedAt = av.finishedAtAntes || "";
      if (Array.isArray(proc.avancos) && proc.avancos.length) proc.avancos.pop();
    }
    proc.currentStageId = alvo.stageId;
    if (!proc.done) proc.done = {};
    if (!proc.done[alvo.stageId]) proc.done[alvo.stageId] = alvo.em || agora;
    proc.updatedAt = agora;
    this.saveProcess(proc);
    FinanciamentoState.process = proc;
    this.render();
  },

  notaDe(proc, stageId) {
    const notas = proc && proc.notas;
    if (!notas || !stageId) return null;
    return notas[stageId] || notas[String(stageId)] || null;
  },

  notaCardHtml(proc, etapa) {
    const lista = this.listaNotas(proc, etapa && etapa.id);
    const nota = lista[lista.length - 1];
    if (!nota || (!nota.texto && !nota.data)) return "";
    const quando = nota.data ? this.fmtDate(nota.data) : "";
    const texto = String(nota.texto || "").replace(/\s+/g, " ").trim();
    const linha = quando && texto ? (quando + " · " + texto) : (quando || texto);
    return `<div class="fin-card-nota">${this.esc(linha)}</div>`;
  },

  linhaHistorico(data, texto) {
    const quando = data ? this.fmtDate(String(data).slice(0, 10)) : "";
    const corpo = String(texto || "").trim();
    const linha = quando && corpo ? (quando + " · " + corpo) : (quando || corpo);
    if (!linha) return "";
    return `<p class="fin-etapa-nota">${this.esc(linha)}</p>`;
  },

  historicoHtml(proc, stageId) {
    const notas = this.listaNotas(proc, stageId).filter((n) => !n.rascunho);
    const anexos = (proc && proc.anexos && (proc.anexos[stageId] || proc.anexos[String(stageId)])) || [];
    const linhas = notas.map((n) => this.linhaHistorico(n.data || n.em, n.texto)).join("");
    const arquivos = (Array.isArray(anexos) ? anexos : []).map((a) => this.linhaHistorico(a.em, a.fileName)).join("");
    return linhas + arquivos;
  },

  notasEtapaHtml(proc, stageId) {
    const notas = this.listaNotas(proc, stageId).filter((nota) => !nota.rascunho).slice().reverse();
    if (!notas.length) return "";
    const itens = notas.map((nota) => `
      <article class="fin-nota-historico-item">
        <time>${this.esc(nota.data ? this.fmtDate(nota.data) : this.fmtDate(nota.em))}</time>
        <p>${this.esc(nota.texto || "Anotação sem texto.")}</p>
      </article>`).join("");
    return `<section class="fin-nota-historico" aria-label="Histórico das anotações desta etapa">
      <strong>Histórico das anotações</strong>${itens}
    </section>`;
  },

  historicoProcessoHtml(proc, folhas, etapaAtualId) {
    const eventos = [];
    (folhas || []).forEach((etapa) => {
      const stageId = String(etapa.id);
      const nomeEtapa = etapa.label || etapa.nome || stageId;
      this.listaNotas(proc, stageId)
        .filter((nota) => !nota.rascunho && String(stageId) !== String(etapaAtualId || ""))
        .forEach((nota) => {
          const texto = String(nota.texto || "").trim();
          if (!texto && !nota.data) return;
          const data = nota.data || nota.em || "";
          eventos.push({ data: data, horario: Date.parse(data) || 0, etapa: nomeEtapa, tipo: "Nota", texto: texto });
        });
      const anexos = proc && proc.anexos && (proc.anexos[stageId] || proc.anexos[String(stageId)]);
      (Array.isArray(anexos) ? anexos : []).forEach((anexo) => {
        const texto = String(anexo && anexo.fileName || "").trim();
        if (!texto) return;
        const data = anexo.em || "";
        eventos.push({ data: data, horario: Date.parse(data) || 0, etapa: nomeEtapa, tipo: "Documento anexado", texto: texto });
      });
    });
    const linhas = eventos.sort((a, b) => b.horario - a.horario).map((evento) => `
      <article class="fin-historico-item">
        <div class="fin-historico-data">${this.esc(evento.data ? this.fmtDate(evento.data) : "Data não informada")}</div>
        <div>
          <div class="fin-historico-meta">${this.esc(evento.etapa)} · ${this.esc(evento.tipo)}</div>
          <p>${this.esc(evento.texto)}</p>
        </div>
      </article>`).join("");
    const termos = (folhas || []).filter((etapa) => String(etapa.id) !== String(etapaAtualId || ""))
      .map((etapa) => this.termosEtapaHtml(proc, etapa.id))
      .filter(Boolean)
      .map((html) => `<div class="fin-historico-termos">${html}</div>`)
      .join("");
    if (!linhas && !termos) return "";
    return `<section class="fin-historico" aria-label="Histórico do financiamento">
      <h4>Histórico</h4>
      ${linhas}
      ${termos}
    </section>`;
  },

  ehEtapaTermoSaldo(stageId, index) {
    if (String(stageId) === FIN_TERMO_STAGE_ID) return true;
    if (Number.isInteger(index)) return index === 0;
    const folhas = this.folhasEtapa(this.catalogoEtapas());
    return folhas.findIndex((etapa) => String(etapa.id) === String(stageId)) === 0;
  },

  termoGerarHtml(stageId, tipo) {
    const sid = String(stageId).replace(/[^a-zA-Z0-9_-]/g, "");
    const declaracao = tipo === "declaracao";
    const botao = declaracao ? "Gerar declaração" : "Gerar termo";
    const acao = declaracao ? "gerarDeclaracaoSaldo" : "gerarTermoSaldoDevedor";
    const ajuda = declaracao
      ? "Selecione as parcelas que ficarão abrangidas pelo congelamento temporário."
      : "O PDF será salvo nesta etapa e poderá ser aberto sem sair da tela.";
    return `<div class="fin-termo-gerar">
      <button type="button" class="btn btn-outline btn-sm" id="fin-termo-gerar-${sid}" onclick="FinanciamentoApp.${acao}('${sid}')">${botao}</button>
      <span id="fin-termo-st-${sid}" class="fin-termo-st" role="status">${ajuda}</span>
    </div>`;
  },

  ehEtapaDeclaracaoSaldo(stageId, index) {
    if (String(stageId) === FIN_DECLARACAO_STAGE_ID) return true;
    if (Number.isInteger(index)) return index === 3;
    return this.folhasEtapa(this.catalogoEtapas())
      .findIndex((etapa) => String(etapa.id) === String(stageId)) === 3;
  },

  ehEtapaGeradoraDocumento(stageId) {
    return this.ehEtapaTermoSaldo(stageId) || this.ehEtapaDeclaracaoSaldo(stageId);
  },

  foldTextoFin(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  },

  parseAreaMetragem(raw) {
    if (typeof window.parseAreaNumber === "function") {
      const n = window.parseAreaNumber(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (raw == null || String(raw).trim() === "") return null;
    let s = String(raw).trim().replace(/\s/g, "").replace(/m²|m2/gi, "");
    if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  },

  obterLinhasValorM2Comercial() {
    try {
      if (window.TabelasVigentesApp && typeof TabelasVigentesApp.loadM2 === "function") {
        TabelasVigentesApp.loadM2();
        const linhas = TabelasVigentesApp.state && TabelasVigentesApp.state.m2 && TabelasVigentesApp.state.m2.linhas;
        if (Array.isArray(linhas) && linhas.length) return linhas;
      }
    } catch (e) {}
    try {
      const o = JSON.parse(localStorage.getItem("crm_moura_valor_padrao_m2") || "null");
      if (o && Array.isArray(o.linhas) && o.linhas.length) return o.linhas;
    } catch (e) {}
    try {
      if (window.TabelasVigentesApp && typeof TabelasVigentesApp.m2Seed === "function") {
        return (TabelasVigentesApp.m2Seed().linhas) || [];
      }
    } catch (e) {}
    return [];
  },

  obterValorM2Comercial(costCenterId, empreendimento) {
    const linhas = this.obterLinhasValorM2Comercial();
    if (!linhas.length) return null;
    const cc = String(costCenterId || "").trim();
    let hit = cc ? linhas.find((l) => String(l.cc) === cc) : null;
    if (!hit) {
      const emp = this.foldTextoFin(empreendimento);
      if (emp) {
        const candidatos = linhas.map((l) => {
          const nome = this.foldTextoFin(l.empreendimento);
          if (!nome) return null;
          const bate = emp.indexOf(nome) >= 0 || nome.indexOf(emp) >= 0;
          return bate ? { linha: l, len: nome.length } : null;
        }).filter(Boolean).sort((a, b) => b.len - a.len);
        hit = candidatos[0] ? candidatos[0].linha : null;
      }
    }
    if (!hit || !hit.valores) return null;
    // Financiamento usa o m² de 2026 da tabela vigente do Comercial.
    const candidatos = [hit.valores["2026"], hit.valores[String(new Date().getFullYear())], hit.valores["2025"]];
    const anos = Object.keys(hit.valores).sort();
    if (anos.length) candidatos.push(hit.valores[anos[anos.length - 1]]);
    for (let i = 0; i < candidatos.length; i++) {
      const n = Number(candidatos[i]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  },

  cidadeDoContratoFin(dados, proc) {
    const unit = (dados && dados.unit) || {};
    const sale = (dados && dados.sale) || {};
    const ccId = String(unit.costCenterId || sale.enterpriseId || sale.costCenterId
      || (proc && (proc.costCenterId || proc.empId)) || "").trim();
    const ccs = (window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || [];
    const cc = ccId ? ccs.find((c) => String(c.id) === ccId) : null;
    const direta = String((cc && (cc.city || cc.cidade || cc.cityName)) || (proc && proc.cidade) || "").trim();
    if (direta) return direta;
    if (typeof window.extractCityDisplayName === "function" && ccId) {
      const extra = String(window.extractCityDisplayName(ccId, (cc && cc.name) || (dados && dados.empreendimento) || "") || "").trim();
      if (extra) return extra;
    }
    const emp = String((dados && dados.empreendimento) || (proc && this.obraDoProc(proc).empreendimento) || "").trim();
    const partes = emp.split(/\s+-\s+/);
    if (partes.length >= 2 && partes[0]) return partes[0].trim();
    return this.cidadeDoProc(proc || FinanciamentoState.process || {});
  },

  ehEmpreendimentoBoituvaSemTabela(dados, proc, valorM2) {
    if (valorM2 != null) return false;
    const cidade = this.foldTextoFin(this.cidadeDoContratoFin(dados, proc));
    const emp = this.foldTextoFin(dados && dados.empreendimento);
    return cidade.indexOf("BOITUVA") >= 0 || emp.indexOf("BOITUVA") >= 0;
  },

  async obterMetragemLoteContrato(dados) {
    const unit = (dados && dados.unit) || {};
    const sale = (dados && dados.sale) || {};
    const tentar = (obj) => {
      if (!obj || typeof obj !== "object") return null;
      return this.parseAreaMetragem(
        obj.privateArea || obj.Privatearea || obj.terrainArea || obj.totalArea
        || obj.indexedPrivateArea || obj.landArea || obj.area
      );
    };
    let area = tentar(unit) || tentar(sale);
    const unitId = unit.id || sale.siengeUnitId || sale.unitId || "";
    if (area == null && unitId && typeof window.siengeFetchWithRetry === "function") {
      try {
        const det = await window.siengeFetchWithRetry("/units/" + encodeURIComponent(unitId));
        area = tentar(det);
      } catch (e) {}
    }
    if (area == null && window.SiengeApiService && typeof SiengeApiService.getUnitDetails === "function") {
      try {
        const det = await SiengeApiService.getUnitDetails(unit.costCenterId || sale.enterpriseId, unit.name || unit.unitName);
        const lista = (det && det.results) || (Array.isArray(det) ? det : det ? [det] : []);
        for (let i = 0; i < lista.length; i++) {
          area = tentar(lista[i]);
          if (area != null) break;
        }
      } catch (e) {}
    }
    const unidades = Array.isArray(sale.salesContractUnits) ? sale.salesContractUnits : [];
    if (area == null) {
      for (let i = 0; i < unidades.length; i++) {
        area = tentar(unidades[i]);
        if (area != null) break;
      }
    }
    return area;
  },

  async listarProximasParcelasAVencer(billId, qtd) {
    const limite = Number.isInteger(qtd) && qtd > 0 ? qtd : 3;
    if (typeof window.siengeFetchWithRetry !== "function") {
      throw new Error("A consulta de parcelas no Sienge não está disponível.");
    }
    const response = await window.siengeFetchWithRetry(
      "/accounts-receivable/receivable-bills/" + encodeURIComponent(billId) + "/installments?limit=200"
    );
    const rows = Array.isArray(response) ? response : ((response && (response.results || response.data)) || []);
    const hoje = this.hojeIso();
    const todas = rows.map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const situacao = String(item.situation || item.status || item.installmentSituation || "").toLowerCase();
      if (/cancel|revog|baixad|inativ|paid|pago|quitad/.test(situacao)) return null;
      const vencimento = this.normalizarVencimentoParcela(item.dueDate || item.originalDueDate || item.due);
      if (!vencimento) return null;
      return {
        numero: item.installmentNumber || item.number || item.installmentId || index + 1,
        id: item.installmentId || item.id || item.installmentNumber || String(index + 1),
        vencimento: vencimento,
        saldo: this.saldoAbertoParcela(item),
        indice: index
      };
    }).filter(Boolean).sort((a, b) => a.vencimento.localeCompare(b.vencimento)
      || String(a.numero).localeCompare(String(b.numero), "pt-BR", { numeric: true }));
    const futuras = todas.filter((p) => p.vencimento >= hoje);
    const base = futuras.length ? futuras : todas;
    const escolhidas = base.slice(0, limite);
    escolhidas.forEach((parcela, index) => { parcela.indice = index; });
    return {
      parcelas: escolhidas,
      inicio: escolhidas[0] ? escolhidas[0].vencimento : "",
      fim: escolhidas.length ? escolhidas[escolhidas.length - 1].vencimento : "",
      quantidade: escolhidas.length
    };
  },

  fmtMetragemFin(n) {
    return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  atualizarCalculoBoituvaM2() {
    const metragem = Number((document.getElementById("fin-boituva-metragem") || {}).dataset.metragem || "");
    const input = document.getElementById("fin-boituva-m2");
    const out = document.getElementById("fin-boituva-total");
    const status = document.getElementById("fin-boituva-status");
    const botao = document.getElementById("fin-boituva-confirmar");
    const m2 = this.parseValorComercialTermo(input && input.value);
    const ok = Number.isFinite(metragem) && metragem > 0 && m2 != null;
    if (out) {
      out.textContent = ok
        ? ("R$ " + Number(metragem * m2).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
        : "—";
    }
    if (status && !(this._boituvaModal && this._boituvaModal.fechando)) {
      status.textContent = ok ? "" : "Informe o valor do metro quadrado para calcular o valor comercial.";
    }
    if (botao) botao.disabled = !ok;
  },

  fecharModalBoituvaM2(resultado) {
    const state = this._boituvaModal;
    if (!state) return;
    state.fechando = true;
    if (state.onKeyDown) document.removeEventListener("keydown", state.onKeyDown);
    const modal = document.getElementById("fin-boituva-modal");
    if (modal) modal.remove();
    this._boituvaModal = null;
    if (typeof state.resolve === "function") state.resolve(resultado == null ? null : resultado);
  },

  confirmarModalBoituvaM2() {
    const state = this._boituvaModal;
    if (!state) return;
    const metragem = Number(state.metragem);
    const input = document.getElementById("fin-boituva-m2");
    const m2 = this.parseValorComercialTermo(input && input.value);
    if (!(Number.isFinite(metragem) && metragem > 0) || m2 == null) {
      this.atualizarCalculoBoituvaM2();
      return;
    }
    this.fecharModalBoituvaM2({
      metragem: metragem,
      valorM2: m2,
      valorComercial: Math.round(metragem * m2 * 100) / 100,
      fonte: "boituva-manual"
    });
  },

  promptValorM2Boituva(metragem, empreendimento) {
    return new Promise((resolve) => {
      this.fecharModalBoituvaM2(null);
      const state = {
        metragem: metragem,
        resolve: resolve,
        fechando: false
      };
      state.onKeyDown = (event) => {
        if (event.key === "Escape") this.fecharModalBoituvaM2(null);
      };
      this._boituvaModal = state;
      const emp = this.esc(empreendimento || "Boituva");
      const metTxt = this.esc(this.fmtMetragemFin(metragem));
      document.body.insertAdjacentHTML("beforeend", `<div class="fin-declaracao-overlay" id="fin-boituva-modal">
        <section class="fin-declaracao-dialog" role="dialog" aria-modal="true" aria-labelledby="fin-boituva-titulo" style="width:min(480px,100%)">
          <header><div><span>BOITUVA · VALOR COMERCIAL</span><h2 id="fin-boituva-titulo">Informe o valor do m²</h2></div>
            <button type="button" class="fin-declaracao-fechar" aria-label="Fechar" onclick="FinanciamentoApp.fecharModalBoituvaM2(null)">×</button></header>
          <div class="fin-declaracao-conteudo">
            <p>Este empreendimento de Boituva ainda não consta na planilha de valor padrão m². Informe o valor do metro quadrado para calcular o valor comercial.</p>
            <p class="fin-declaracao-ajuda" style="margin:0 0 12px">Empreendimento: <strong>${emp}</strong></p>
            <label class="fin-declaracao-valor">Metragem do lote (m²)
              <input id="fin-boituva-metragem" type="text" value="${metTxt}" readonly data-metragem="${this.esc(String(metragem))}">
            </label>
            <label class="fin-declaracao-valor" for="fin-boituva-m2" style="margin-top:12px">Valor do metro quadrado (R$)
              <input id="fin-boituva-m2" type="text" inputmode="decimal" autocomplete="off" placeholder="Ex.: 350,00" oninput="FinanciamentoApp.atualizarCalculoBoituvaM2()">
            </label>
            <div class="fin-declaracao-resumo" style="margin-top:14px">Valor comercial: <span id="fin-boituva-total">—</span></div>
            <p class="fin-declaracao-status" id="fin-boituva-status" role="status"></p>
          </div>
          <footer>
            <button type="button" class="btn btn-outline" onclick="FinanciamentoApp.fecharModalBoituvaM2(null)">Cancelar</button>
            <button type="button" class="btn btn-primary" id="fin-boituva-confirmar" onclick="FinanciamentoApp.confirmarModalBoituvaM2()" disabled>Usar valor comercial</button>
          </footer>
        </section>
        <style>
          .fin-declaracao-overlay { position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(15,23,42,.58); }
          .fin-declaracao-dialog { width:min(680px,100%); max-height:calc(100vh - 32px); display:flex; flex-direction:column; overflow:hidden; border-radius:14px; background:#fff; box-shadow:0 20px 60px rgba(15,23,42,.3); }
          .fin-declaracao-dialog > header { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; padding:18px 20px; color:#fff; background:linear-gradient(115deg,#0b3f2a,#1b8253); }
          .fin-declaracao-dialog > header span { font-size:.68rem; font-weight:800; letter-spacing:.08em; opacity:.85; }
          .fin-declaracao-dialog > header h2 { margin:5px 0 0; font-size:1.05rem; }
          .fin-declaracao-fechar { border:0; padding:0 4px; color:#fff; background:transparent; font-size:1.65rem; line-height:1; cursor:pointer; }
          .fin-declaracao-conteudo { overflow:auto; padding:18px 20px; }
          .fin-declaracao-conteudo > p:first-child { margin:0 0 14px; color:#475569; font-size:.82rem; }
          .fin-declaracao-valor { display:flex; flex-direction:column; gap:6px; color:#334155; font-size:.76rem; font-weight:700; }
          .fin-declaracao-valor input { height:40px; box-sizing:border-box; padding:0 10px; border:1px solid #cbd5e1; border-radius:6px; font:inherit; }
          .fin-declaracao-valor input[readonly] { background:#f8fafc; color:#0f172a; }
          .fin-declaracao-ajuda { margin:6px 0 10px; color:#64748b; font-size:.72rem; }
          .fin-declaracao-resumo { margin-top:12px; padding:10px; border-radius:7px; color:#105436; background:#e7f6ee; font-size:.76rem; font-weight:700; }
          .fin-declaracao-status { min-height:18px; margin:8px 0 0; color:#b45309; font-size:.75rem; }
          .fin-declaracao-dialog > footer { display:flex; justify-content:flex-end; gap:8px; padding:14px 20px; border-top:1px solid #e2e8f0; }
          .fin-declaracao-dialog > footer .btn { display:inline-flex; align-items:center; justify-content:center; height:40px; box-sizing:border-box; padding:0 14px; margin:0; line-height:1; }
        </style>
      </div>`);
      const overlay = document.getElementById("fin-boituva-modal");
      if (overlay) {
        overlay.addEventListener("click", (event) => {
          if (event.target === overlay) this.fecharModalBoituvaM2(null);
        });
        document.addEventListener("keydown", state.onKeyDown);
      }
      this.atualizarCalculoBoituvaM2();
      const input = document.getElementById("fin-boituva-m2");
      if (input) input.focus();
    });
  },

  async resolverValorComercialLote(dados, proc) {
    const processo = proc || FinanciamentoState.process || {};
    const metragem = await this.obterMetragemLoteContrato(dados);
    if (metragem == null) {
      throw new Error("Não encontrei a metragem do lote na ficha/contrato do cliente.");
    }
    const cc = String((dados.unit && dados.unit.costCenterId) || (dados.sale && (dados.sale.enterpriseId || dados.sale.costCenterId))
      || processo.costCenterId || processo.empId || "").trim();
    const valorM2Tabela = this.obterValorM2Comercial(cc, dados.empreendimento);
    if (valorM2Tabela != null) {
      return {
        metragem: metragem,
        valorM2: valorM2Tabela,
        valorComercial: Math.round(metragem * valorM2Tabela * 100) / 100,
        fonte: "tabela-comercial"
      };
    }
    if (this.ehEmpreendimentoBoituvaSemTabela(dados, processo, valorM2Tabela)) {
      const manual = await this.promptValorM2Boituva(metragem, dados.empreendimento);
      if (!manual) return null;
      return manual;
    }
    throw new Error("Não há valor de m² cadastrado para este empreendimento no módulo Comercial (Tabelas vigentes). Cadastre o valor padrão m² ou, se for Boituva, use o cálculo manual.");
  },

  declaracaoModalHtml(dados, parcelas, avisoParcelas, opcoes) {
    const opt = opcoes || {};
    const auto = !!opt.auto;
    const periodo = opt.periodo || {};
    const valorInicial = dados.valorComercial == null
      ? ""
      : Number(dados.valorComercial).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const lista = (!auto && Array.isArray(parcelas)) ? parcelas : [];
    const itens = lista.map((parcela, index) => `
      <label class="fin-declaracao-parcela">
        <input type="checkbox" value="${index}" onchange="FinanciamentoApp.atualizarSelecaoDeclaracao()">
        <span><strong>Parcela ${this.esc(parcela.numero)}</strong><small>Vencimento ${this.esc(this.fmtDate(parcela.vencimento))}</small></span>
        <b>${this.esc(this.fmtMoney(parcela.saldo))}</b>
      </label>`).join("");
    const readonlyAttr = auto ? " readonly" : "";
    const periodoCampos = (auto || !lista.length) ? `
      <div class="fin-declaracao-periodo-manual">
        <p class="fin-declaracao-ajuda">${auto
          ? "Período das próximas 3 parcelas a vencer (preenchido automaticamente)."
          : "Informe o período de congelamento que entrará no texto da declaração."}</p>
        <div class="fin-declaracao-periodo-campos">
          <label for="fin-declaracao-inicio">Data inicial
            <input id="fin-declaracao-inicio" type="date" value="${this.esc(periodo.inicio || "")}"${readonlyAttr} onchange="FinanciamentoApp.atualizarSelecaoDeclaracao()">
          </label>
          <label for="fin-declaracao-fim">Data final
            <input id="fin-declaracao-fim" type="date" value="${this.esc(periodo.fim || "")}"${readonlyAttr} onchange="FinanciamentoApp.atualizarSelecaoDeclaracao()">
          </label>
          <label for="fin-declaracao-qtd">Quantidade de parcelas
            <input id="fin-declaracao-qtd" type="number" min="1" step="1" inputmode="numeric" value="${this.esc(String(periodo.quantidade || (auto ? 3 : "")))}"${readonlyAttr} oninput="FinanciamentoApp.atualizarSelecaoDeclaracao()">
          </label>
        </div>
      </div>` : "";
    const aviso = avisoParcelas
      ? `<p class="fin-declaracao-aviso">${this.esc(avisoParcelas)}</p>`
      : "";
    const detalheCalc = opt.detalheCalc
      ? `<p class="fin-declaracao-ajuda" style="margin:0 0 12px">${this.esc(opt.detalheCalc)}</p>`
      : "";
    const intro = auto
      ? "Revise o valor comercial e o período das próximas 3 parcelas e gere a declaração."
      : ("Confirme o valor comercial e " + (lista.length
        ? "selecione as parcelas que ficarão abrangidas pelo congelamento temporário."
        : "informe o período de congelamento temporário."));
    return `<div class="fin-declaracao-overlay" id="fin-declaracao-modal">
      <section class="fin-declaracao-dialog" role="dialog" aria-modal="true" aria-labelledby="fin-declaracao-titulo">
        <header><div><span>ETAPA 4 · FINANCIAMENTO</span><h2 id="fin-declaracao-titulo">Gerar declaração de saldo devedor</h2></div>
          <button type="button" class="fin-declaracao-fechar" aria-label="Fechar" onclick="FinanciamentoApp.fecharModalDeclaracaoSaldo()">×</button></header>
        <div class="fin-declaracao-conteudo">
          <p>${intro}</p>
          ${aviso}
          ${detalheCalc}
          <label class="fin-declaracao-valor" for="fin-declaracao-valor">Valor comercial de compra e venda (R$)
            <input id="fin-declaracao-valor" type="text" inputmode="decimal" autocomplete="off" value="${this.esc(valorInicial)}"${readonlyAttr} oninput="FinanciamentoApp.atualizarSelecaoDeclaracao()">
          </label>
          <div class="fin-declaracao-selecao">
            <div class="fin-declaracao-lista-titulo"><strong>${auto ? "Período de congelamento" : "Parcelas em aberto no Sienge"}</strong><span>${auto ? (periodo.quantidade || 0) + " parcela(s)" : lista.length + " disponíveis"}</span></div>
            ${lista.length
              ? `<p class="fin-declaracao-ajuda">A seleção precisa formar um intervalo contínuo de vencimentos para corresponder ao texto da declaração.</p>
                 <div class="fin-declaracao-lista">${itens}</div>`
              : periodoCampos}
          </div>
          <div class="fin-declaracao-resumo" id="fin-declaracao-resumo" aria-live="polite"></div>
          <p class="fin-declaracao-status" id="fin-declaracao-status" role="status"></p>
        </div>
        <footer>
          <button type="button" class="btn btn-outline" onclick="FinanciamentoApp.fecharModalDeclaracaoSaldo()">Cancelar</button>
          <button type="button" class="btn btn-primary" id="fin-declaracao-confirmar" onclick="FinanciamentoApp.confirmarDeclaracaoSaldo()" disabled>Gerar declaração</button>
        </footer>
      </section>
      <style>
        .fin-declaracao-overlay { position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(15,23,42,.58); }
        .fin-declaracao-dialog { width:min(680px,100%); max-height:calc(100vh - 32px); display:flex; flex-direction:column; overflow:hidden; border-radius:14px; background:#fff; box-shadow:0 20px 60px rgba(15,23,42,.3); }
        .fin-declaracao-dialog > header { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; padding:18px 20px; color:#fff; background:linear-gradient(115deg,#0b3f2a,#1b8253); }
        .fin-declaracao-dialog > header span { font-size:.68rem; font-weight:800; letter-spacing:.08em; opacity:.85; }
        .fin-declaracao-dialog > header h2 { margin:5px 0 0; font-size:1.05rem; }
        .fin-declaracao-fechar { border:0; padding:0 4px; color:#fff; background:transparent; font-size:1.65rem; line-height:1; cursor:pointer; }
        .fin-declaracao-conteudo { overflow:auto; padding:18px 20px; }
        .fin-declaracao-conteudo > p:first-child { margin:0 0 14px; color:#475569; font-size:.82rem; }
        .fin-declaracao-aviso { margin:0 0 14px; padding:10px 12px; border:1px solid #fde68a; border-radius:8px; background:#fffbeb; color:#92400e; font-size:.78rem; line-height:1.4; }
        .fin-declaracao-valor { display:flex; flex-direction:column; gap:6px; color:#334155; font-size:.76rem; font-weight:700; }
        .fin-declaracao-valor input { height:40px; box-sizing:border-box; padding:0 10px; border:1px solid #cbd5e1; border-radius:6px; font:inherit; }
        .fin-declaracao-valor input[readonly] { background:#f8fafc; color:#0f172a; }
        .fin-declaracao-selecao { margin-top:18px; }
        .fin-declaracao-lista-titulo { display:flex; justify-content:space-between; gap:10px; color:#105436; font-size:.8rem; }
        .fin-declaracao-lista-titulo span { color:#64748b; font-weight:500; }
        .fin-declaracao-ajuda { margin:6px 0 10px; color:#64748b; font-size:.72rem; }
        .fin-declaracao-lista { max-height:280px; overflow:auto; border:1px solid #e2e8f0; border-radius:8px; }
        .fin-declaracao-parcela { display:flex; align-items:center; gap:10px; min-height:48px; padding:7px 10px; border-bottom:1px solid #edf2ef; cursor:pointer; }
        .fin-declaracao-parcela:last-child { border-bottom:0; }
        .fin-declaracao-parcela:nth-child(even) { background:#f7faf8; }
        .fin-declaracao-parcela input { accent-color:#1b8253; }
        .fin-declaracao-parcela span { display:flex; flex:1; flex-direction:column; gap:3px; font-size:.76rem; }
        .fin-declaracao-parcela small { color:#64748b; font-size:.7rem; }
        .fin-declaracao-parcela > b { color:#105436; font-size:.76rem; font-variant-numeric:tabular-nums; }
        .fin-declaracao-periodo-campos { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
        .fin-declaracao-periodo-campos label { display:flex; flex-direction:column; gap:6px; color:#334155; font-size:.76rem; font-weight:700; }
        .fin-declaracao-periodo-campos input { height:40px; box-sizing:border-box; padding:0 10px; border:1px solid #cbd5e1; border-radius:6px; font:inherit; }
        .fin-declaracao-periodo-campos input[readonly] { background:#f8fafc; color:#0f172a; }
        .fin-declaracao-resumo { margin-top:12px; padding:10px; border-radius:7px; color:#105436; background:#e7f6ee; font-size:.76rem; font-weight:700; }
        .fin-declaracao-status { min-height:18px; margin:8px 0 0; color:#b45309; font-size:.75rem; }
        .fin-declaracao-dialog > footer { display:flex; justify-content:flex-end; gap:8px; padding:14px 20px; border-top:1px solid #e2e8f0; }
        .fin-declaracao-dialog > footer .btn { display:inline-flex; align-items:center; justify-content:center; height:40px; box-sizing:border-box; padding:0 14px; margin:0; line-height:1; }
        @media (max-width:560px) {
          .fin-declaracao-dialog > footer { flex-direction:column-reverse; }
          .fin-declaracao-periodo-campos { grid-template-columns:1fr; }
        }
      </style>
    </div>`;
  },

  abrirModalDeclaracaoSaldo(stageId, dados, parcelas, avisoParcelas, opcoes) {
    this.fecharModalDeclaracaoSaldo();
    const opt = opcoes || {};
    const state = {
      stageId: String(stageId),
      dados: dados,
      parcelas: Array.isArray(parcelas) ? parcelas : [],
      avisoParcelas: String(avisoParcelas || ""),
      auto: !!opt.auto,
      periodo: opt.periodo || null,
      gerando: false
    };
    state.onKeyDown = (event) => {
      if (event.key === "Escape" && !state.gerando) this.fecharModalDeclaracaoSaldo();
    };
    this._declaracaoModal = state;
    document.body.insertAdjacentHTML("beforeend", this.declaracaoModalHtml(dados, state.auto ? [] : state.parcelas, state.avisoParcelas, {
      auto: state.auto,
      periodo: state.periodo || {},
      detalheCalc: opt.detalheCalc || ""
    }));
    const overlay = document.getElementById("fin-declaracao-modal");
    if (overlay) {
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay && !state.gerando) this.fecharModalDeclaracaoSaldo();
      });
      document.addEventListener("keydown", state.onKeyDown);
    }
    this.atualizarSelecaoDeclaracao();
    const input = document.getElementById(state.auto ? "fin-declaracao-confirmar" : "fin-declaracao-valor");
    if (input) input.focus();
  },

  fecharModalDeclaracaoSaldo() {
    const state = this._declaracaoModal;
    if (state && state.gerando) return false;
    if (state && state.onKeyDown) document.removeEventListener("keydown", state.onKeyDown);
    const modal = document.getElementById("fin-declaracao-modal");
    if (modal) modal.remove();
    this._declaracaoModal = null;
    return true;
  },

  normalizarVencimentoParcela(raw) {
    const s = String(raw == null ? "" : raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (br) {
      return br[3] + "-" + String(Number(br[2])).padStart(2, "0") + "-" + String(Number(br[1])).padStart(2, "0");
    }
    return "";
  },

  saldoAbertoParcela(item) {
    if (!item || typeof item !== "object") return null;
    const candidatos = [
      item.currentBalance,
      item.currentBalanceWithAddition,
      item.balanceDue,
      item.remainingBalance,
      item.openBalance,
      item.balance
    ];
    for (let i = 0; i < candidatos.length; i++) {
      const raw = candidatos[i];
      if (raw == null || String(raw).trim() === "") continue;
      const numerico = Number(raw);
      const saldo = Number.isFinite(numerico) ? numerico : this.parseValorComercialTermo(raw);
      if (Number.isFinite(saldo) && saldo > 0.009) return saldo;
    }
    return null;
  },

  dadosSelecaoDeclaracao() {
    const state = this._declaracaoModal;
    const modal = document.getElementById("fin-declaracao-modal");
    if (!state || !modal) return { selecionadas: [], intervalo: [], continuo: false, manual: false };
    const usaPeriodoCampos = !!(state.auto || document.getElementById("fin-declaracao-inicio") || !(state.parcelas && state.parcelas.length));
    if (usaPeriodoCampos) {
      const inicio = String((document.getElementById("fin-declaracao-inicio") || {}).value || (state.periodo && state.periodo.inicio) || "").slice(0, 10);
      const fim = String((document.getElementById("fin-declaracao-fim") || {}).value || (state.periodo && state.periodo.fim) || "").slice(0, 10);
      const qtdRaw = String((document.getElementById("fin-declaracao-qtd") || {}).value
        || (state.periodo && state.periodo.quantidade) || "").trim();
      const quantidade = Number(qtdRaw);
      const datasOk = /^\d{4}-\d{2}-\d{2}$/.test(inicio) && /^\d{4}-\d{2}-\d{2}$/.test(fim) && inicio <= fim;
      const qtdOk = Number.isInteger(quantidade) && quantidade > 0;
      const selecionadas = state.auto && Array.isArray(state.parcelas) ? state.parcelas : [];
      return {
        selecionadas: selecionadas,
        intervalo: selecionadas,
        inicio: inicio,
        fim: fim,
        quantidade: qtdOk ? quantidade : 0,
        continuo: datasOk && qtdOk,
        manual: true
      };
    }
    const selecionados = Array.from(modal.querySelectorAll(".fin-declaracao-parcela input:checked"))
      .map((input) => state.parcelas[Number(input.value)])
      .filter(Boolean)
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.indice - b.indice);
    if (!selecionados.length) return { selecionadas: [], intervalo: [], continuo: false, manual: false };
    const inicio = selecionados[0].vencimento;
    const fim = selecionados[selecionados.length - 1].vencimento;
    const intervalo = state.parcelas.filter((parcela) => parcela.vencimento >= inicio && parcela.vencimento <= fim);
    const ids = new Set(selecionados.map((parcela) => parcela.indice));
    return {
      selecionadas: selecionados,
      intervalo: intervalo,
      inicio: inicio,
      fim: fim,
      quantidade: selecionados.length,
      continuo: intervalo.length === selecionados.length && intervalo.every((parcela) => ids.has(parcela.indice)),
      manual: false
    };
  },

  atualizarSelecaoDeclaracao() {
    const state = this._declaracaoModal;
    const modal = document.getElementById("fin-declaracao-modal");
    if (!state || !modal) return;
    const selecao = this.dadosSelecaoDeclaracao();
    const resumo = document.getElementById("fin-declaracao-resumo");
    const status = document.getElementById("fin-declaracao-status");
    const botao = document.getElementById("fin-declaracao-confirmar");
    const inputValor = document.getElementById("fin-declaracao-valor");
    const valor = this.parseValorComercialTermo(inputValor && inputValor.value);
    if (resumo) {
      resumo.textContent = selecao.continuo
        ? ("Período: " + this.fmtDate(selecao.inicio) + " a " + this.fmtDate(selecao.fim)
          + " · " + selecao.quantidade + " parcela(s)"
          + (state.auto ? " · próximas a vencer" : (selecao.manual ? " · informado manualmente" : "")))
        : (selecao.manual
          ? "Informe data inicial, data final e a quantidade de parcelas."
          : "Selecione um intervalo contínuo de parcelas em aberto.");
    }
    if (status && !state.gerando) {
      status.textContent = !valor
        ? "Informe um valor comercial válido, maior que zero."
        : (!selecao.manual && selecao.selecionadas.length && !selecao.continuo
          ? "Inclua todas as parcelas em aberto entre o primeiro e o último vencimento selecionado."
          : "");
    }
    if (botao) botao.disabled = state.gerando || !valor || !selecao.continuo;
  },

  async listarParcelasParaCongelamento(billId) {
    if (typeof window.siengeFetchWithRetry !== "function") {
      throw new Error("A consulta de parcelas no Sienge não está disponível.");
    }
    const response = await window.siengeFetchWithRetry(
      "/accounts-receivable/receivable-bills/" + encodeURIComponent(billId) + "/installments?limit=200"
    );
    const rows = Array.isArray(response) ? response : ((response && (response.results || response.data)) || []);
    const parcelas = rows.map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const situacao = String(item.situation || item.status || item.installmentSituation || "").toLowerCase();
      if (/cancel|revog|baixad|inativ|paid|pago|quitad/.test(situacao)) return null;
      const saldo = this.saldoAbertoParcela(item);
      const vencimento = this.normalizarVencimentoParcela(item.dueDate || item.originalDueDate || item.due);
      if (saldo == null || !vencimento) return null;
      return {
        numero: item.installmentNumber || item.number || item.installmentId || index + 1,
        id: item.installmentId || item.id || item.installmentNumber || String(index + 1),
        vencimento: vencimento,
        saldo: saldo,
        indice: index
      };
    }).filter(Boolean).sort((a, b) => a.vencimento.localeCompare(b.vencimento) || String(a.numero).localeCompare(String(b.numero), "pt-BR", { numeric: true }));
    parcelas.forEach((parcela, index) => { parcela.indice = index; });
    return parcelas;
  },

  async gerarDeclaracaoSaldo(stageId) {
    const proc = FinanciamentoState.process;
    const btn = document.getElementById("fin-termo-gerar-" + stageId);
    const status = document.getElementById("fin-termo-st-" + stageId);
    if (!proc || String(proc.currentStageId || "") !== String(stageId) || !this.ehEtapaDeclaracaoSaldo(stageId)) return false;
    if (this._gerandoDeclaracao || this._declaracaoModal || this._boituvaModal) return false;
    this._gerandoDeclaracao = true;
    if (btn) { btn.disabled = true; btn.textContent = "Carregando…"; }
    if (status) status.textContent = "Buscando contrato, metragem, valor m² e próximas parcelas…";
    try {
      const dados = await this.obterDadosTermoSaldo(proc);
      if (status) status.textContent = "Calculando o valor comercial (metragem × m²)…";
      const resolucao = await this.resolverValorComercialLote(dados, proc);
      if (!resolucao) {
        if (status) status.textContent = "Geração da declaração cancelada.";
        return false;
      }
      dados.valorComercial = resolucao.valorComercial;
      dados.metragemLote = resolucao.metragem;
      dados.valorM2 = resolucao.valorM2;
      dados.fonteValorComercial = resolucao.fonte || "metragem-x-m2-2026";
      let periodo = { inicio: "", fim: "", quantidade: 0, parcelas: [] };
      let avisoParcelas = "";
      try {
        periodo = await this.listarProximasParcelasAVencer(dados.billId, 3);
      } catch (erroParcelas) {
        avisoParcelas = (erroParcelas && erroParcelas.message)
          || "Não foi possível consultar as parcelas no Sienge.";
        console.warn("[Financiamento] parcelas da declaração", erroParcelas);
      }
      if (!(periodo.parcelas && periodo.parcelas.length) && !avisoParcelas) {
        avisoParcelas = "Não encontrei as próximas parcelas a vencer neste título. Informe o período manualmente para gerar a declaração.";
      }
      const auto = !!(periodo.inicio && periodo.fim && periodo.quantidade);
      const detalheCalc = "Metragem " + this.fmtMetragemFin(resolucao.metragem) + " m² × R$ "
        + Number(resolucao.valorM2).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        + "/m² (" + (resolucao.fonte === "boituva-manual" ? "Boituva, valor informado" : "tabela Comercial") + ").";
      this.abrirModalDeclaracaoSaldo(stageId, dados, periodo.parcelas || [], avisoParcelas, {
        auto: auto,
        periodo: {
          inicio: periodo.inicio || "",
          fim: periodo.fim || "",
          quantidade: periodo.quantidade || 3
        },
        detalheCalc: detalheCalc
      });
      if (status) {
        status.textContent = auto
          ? "Revise o valor comercial e o período das próximas 3 parcelas."
          : "Confirme o valor comercial e informe o período das parcelas.";
      }
      return true;
    } catch (e) {
      if (status) status.textContent = (e && e.message) || "Não foi possível carregar os dados da declaração.";
      console.error("[Financiamento] preparação da declaração", e);
      return false;
    } finally {
      this._gerandoDeclaracao = false;
      const atual = document.getElementById("fin-termo-gerar-" + stageId);
      if (atual) { atual.disabled = false; atual.textContent = "Gerar declaração"; }
    }
  },

  async confirmarDeclaracaoSaldo() {
    const state = this._declaracaoModal;
    const proc = FinanciamentoState.process;
    const modal = document.getElementById("fin-declaracao-modal");
    if (!state || !modal || !proc || state.gerando) return false;
    const selecao = this.dadosSelecaoDeclaracao();
    const inputValor = document.getElementById("fin-declaracao-valor");
    const valorComercial = this.parseValorComercialTermo(inputValor && inputValor.value);
    const status = document.getElementById("fin-declaracao-status");
    const botao = document.getElementById("fin-declaracao-confirmar");
    if (!valorComercial || !selecao.continuo) {
      this.atualizarSelecaoDeclaracao();
      return false;
    }
    state.gerando = true;
    if (botao) { botao.disabled = true; botao.textContent = "Gerando…"; }
    if (status) status.textContent = "Preenchendo o modelo da declaração…";
    try {
      const dados = state.dados;
      dados.valorComercial = valorComercial;
      dados.valorComercialTexto = Number(valorComercial).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }) + " (" + window.valorPorExtensoBRL(valorComercial) + ")";
      dados.parcelasCongeladas = (selecao.selecionadas && selecao.selecionadas.length)
        ? selecao.selecionadas.map((parcela) => ({
          id: parcela.id,
          numero: parcela.numero,
          vencimento: parcela.vencimento,
          saldo: parcela.saldo
        }))
        : [];
      dados.periodoCongelamento = {
        inicio: selecao.inicio,
        fim: selecao.fim,
        quantidade: selecao.quantidade
      };
      const validade = new Date(dados.emissao + "T12:00:00");
      validade.setDate(validade.getDate() + 90);
      dados.validade = validade.getFullYear() + "-" + String(validade.getMonth() + 1).padStart(2, "0") + "-" + String(validade.getDate()).padStart(2, "0");
      if (status) status.textContent = "Gerando o PDF da declaração…";
      const docxBuffer = await this.montarDocxDeclaracaoSaldo(dados);
      const arquivoPdf = await this.converterDocxTermoParaPdf(docxBuffer);
      if (status) status.textContent = "Salvando a declaração nesta etapa…";
      const numero = String(proc.contractNumber || proc.contractId).replace(/[^\w.-]+/g, "-");
      const nome = "declaracao-saldo-devedor-interveniente-quitante-" + numero + "-" + dados.emissao + ".pdf";
      await this.guardarTermoSaldo(proc, state.stageId, arquivoPdf.blob, dados, {
        tipo: "declaracao-saldo-devedor",
        fileName: nome,
        siengeTag: FIN_DECLARACAO_SIENGE_TAG,
        saldoDevedorDeclarado: dados.saldoPresente,
        parcelasCongeladas: dados.parcelasCongeladas,
        periodoCongelamento: dados.periodoCongelamento
      });
      this.atualizarTermosEtapa(state.stageId);
      const stageStatus = document.getElementById("fin-termo-st-" + state.stageId);
      if (stageStatus) stageStatus.textContent = "Declaração salva nesta etapa. Você pode abrir o PDF abaixo.";
      state.gerando = false;
      this.fecharModalDeclaracaoSaldo();
      return true;
    } catch (e) {
      console.error("[Financiamento] geração da declaração", e);
      if (status) status.textContent = (e && e.message) || "Não foi possível gerar e salvar a declaração.";
      state.gerando = false;
      if (botao) { botao.disabled = false; botao.textContent = "Gerar declaração"; }
      this.atualizarSelecaoDeclaracao();
      return false;
    }
  },

  parseValorComercialTermo(raw) {
    let valor = String(raw == null ? "" : raw).trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
    if (!valor || !/^[\d.,]+$/.test(valor)) return null;
    if (valor.indexOf(",") >= 0) {
      if (!/^\d+(?:\.\d{3})*(?:,\d{1,2})?$/.test(valor)) return null;
      valor = valor.replace(/\./g, "").replace(",", ".");
    } else if (/^\d{1,3}(?:\.\d{3})+$/.test(valor)) {
      valor = valor.replace(/\./g, "");
    } else if (!/^\d+(?:\.\d{1,2})?$/.test(valor)) {
      return null;
    }
    const numero = Number(valor);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  },

  justificarParagrafosTermo(xmlDoc) {
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const titulos = /^(TERMO DE SIMULAÇÃO|DECLARAÇÃO DE SALDO DEVEDOR|IDENTIFICAÇÃO DO CONTRATO|VALORES DE REFERÊNCIA|FINALIDADE DA DECLARAÇÃO|CONGELAMENTO TEMPORÁRIO DAS PARCELAS|QUITAÇÃO E REPASSE|RELAÇÃO COM A INSTITUIÇÃO FINANCEIRA|FINALIDADE E LIMITES|DISPOSIÇÕES FINAIS|BOTUCATU,|MOURA LEITE|📞 CANAIS DE ATENDIMENTO)/i;
    const normalizar = (valor) => String(valor || "").replace(/\s+/g, " ").trim();
    Array.from(xmlDoc.getElementsByTagNameNS(ns, "p")).forEach((paragrafo) => {
      const texto = normalizar(paragrafo.textContent);
      if (!texto || titulos.test(texto)) return;
      let propriedades = Array.from(paragrafo.childNodes).find((no) => no.namespaceURI === ns && no.localName === "pPr");
      if (!propriedades) {
        propriedades = xmlDoc.createElementNS(ns, "w:pPr");
        paragrafo.insertBefore(propriedades, paragrafo.firstChild);
      }
      let alinhamento = propriedades.getElementsByTagNameNS(ns, "jc")[0];
      if (!alinhamento) {
        alinhamento = xmlDoc.createElementNS(ns, "w:jc");
        propriedades.appendChild(alinhamento);
      }
      alinhamento.setAttributeNS(ns, "w:val", "both");
    });
  },

  numerarDisposicoesFinaisTermo(xmlDoc) {
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const paragrafos = Array.from(xmlDoc.getElementsByTagNameNS(ns, "p"));
    const indiceTitulo = paragrafos.findIndex((paragrafo) =>
      /^DISPOSIÇÕES FINAIS\b/i.test(String(paragrafo.textContent || "").replace(/\s+/g, " ").trim())
    );
    if (indiceTitulo < 0) throw new Error("O modelo Word não contém o item de disposições finais.");
    const titulo = paragrafos[indiceTitulo];
    const tituloProps = Array.from(titulo.childNodes).find((no) => no.namespaceURI === ns && no.localName === "pPr");
    const numTitulo = tituloProps && tituloProps.getElementsByTagNameNS(ns, "numId")[0];
    const numId = numTitulo && numTitulo.getAttributeNS(ns, "val");
    if (!numId) throw new Error("Não foi possível identificar a numeração das disposições finais.");
    let item = 0;
    for (let i = indiceTitulo + 1; i < paragrafos.length; i++) {
      const paragrafo = paragrafos[i];
      const texto = String(paragrafo.textContent || "").replace(/\s+/g, " ").trim();
      if (!texto) continue;
      const propriedades = Array.from(paragrafo.childNodes).find((no) => no.namespaceURI === ns && no.localName === "pPr");
      const numPr = propriedades && propriedades.getElementsByTagNameNS(ns, "numPr")[0];
      const nivel = numPr && numPr.getElementsByTagNameNS(ns, "ilvl")[0];
      const id = numPr && numPr.getElementsByTagNameNS(ns, "numId")[0];
      if (!numPr || !nivel || nivel.getAttributeNS(ns, "val") !== "1"
        || !id || id.getAttributeNS(ns, "val") !== numId) break;
      const primeiroTexto = paragrafo.getElementsByTagNameNS(ns, "t")[0];
      if (!primeiroTexto) throw new Error("Uma disposição final não contém texto para numerar.");
      item += 1;
      primeiroTexto.textContent = "4." + item + ". " + primeiroTexto.textContent;
      primeiroTexto.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
      propriedades.removeChild(numPr);
    }
    if (!item) throw new Error("Não foram encontradas disposições para numerar no item 4.");
  },

  destacarAlertaTermo(xmlDoc) {
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const paragrafos = Array.from(xmlDoc.getElementsByTagNameNS(ns, "p"));
    const alerta = paragrafos.find((paragrafo) =>
      /^ATEN[ÇC]ÃO:/i.test(String(paragrafo.textContent || "").replace(/\s+/g, " ").trim())
    );
    if (!alerta) throw new Error("O modelo Word não contém a frase de alerta em vermelho.");
    let propriedades = Array.from(alerta.childNodes).find((no) => no.namespaceURI === ns && no.localName === "pPr");
    if (!propriedades) {
      propriedades = xmlDoc.createElementNS(ns, "w:pPr");
      alerta.insertBefore(propriedades, alerta.firstChild);
    }
    let alinhamento = propriedades.getElementsByTagNameNS(ns, "jc")[0];
    if (!alinhamento) {
      alinhamento = xmlDoc.createElementNS(ns, "w:jc");
      propriedades.appendChild(alinhamento);
    }
    alinhamento.setAttributeNS(ns, "w:val", "center");
    Array.from(alerta.getElementsByTagNameNS(ns, "r")).forEach((trecho) => {
      let formatacao = Array.from(trecho.childNodes).find((no) => no.namespaceURI === ns && no.localName === "rPr");
      if (!formatacao) {
        formatacao = xmlDoc.createElementNS(ns, "w:rPr");
        trecho.insertBefore(formatacao, trecho.firstChild);
      }
      let negrito = formatacao.getElementsByTagNameNS(ns, "b")[0];
      if (!negrito) {
        negrito = xmlDoc.createElementNS(ns, "w:b");
        formatacao.appendChild(negrito);
      }
      negrito.setAttributeNS(ns, "w:val", "1");
      let cor = formatacao.getElementsByTagNameNS(ns, "color")[0];
      if (!cor) {
        cor = xmlDoc.createElementNS(ns, "w:color");
        formatacao.appendChild(cor);
      }
      cor.setAttributeNS(ns, "w:val", "EE0000");
    });
  },

  termosEtapaHtml(proc, stageId) {
    if (!this.ehEtapaGeradoraDocumento(stageId)) return "";
    const lista = proc && proc.termos && proc.termos[stageId];
    if (!Array.isArray(lista) || !lista.length) return "";
    const itens = lista.slice().reverse().map((termo) => {
      if (!termo || !/^[a-zA-Z0-9_-]+$/.test(String(termo.id || ""))) return "";
      const url = this.urlStorageTermo(termo.url);
      const baixar = url
        ? `<a class="btn btn-outline btn-sm" href="${this.esc(url)}" target="_blank" rel="noopener noreferrer">Abrir PDF</a>`
        : `<span class="fin-termo-st">PDF salvo no armazenamento.</span>`;
      const envio = termo.siengeSentAt
        ? `<span class="fin-termo-enviado">Enviado ao Sienge em ${this.esc(this.fmtDate(termo.siengeSentAt))}</span>`
        : `<button type="button" class="btn btn-primary btn-sm" id="fin-termo-env-${this.esc(termo.id)}" onclick="FinanciamentoApp.enviarTermoSienge('${String(stageId).replace(/[^a-zA-Z0-9_-]/g, "")}','${this.esc(termo.id)}')">Enviar para o Sienge</button>`;
      const excluir = `<button type="button" class="btn btn-outline btn-sm fin-termo-excluir" id="fin-termo-del-${this.esc(termo.id)}" title="Excluir termo" aria-label="Excluir termo ${this.esc(termo.fileName || "")}" onclick="FinanciamentoApp.removerTermoSaldo('${String(stageId).replace(/[^a-zA-Z0-9_-]/g, "")}','${this.esc(termo.id)}')"><i data-lucide="trash-2" style="width:15px;height:15px;"></i></button>`;
      return `<div class="fin-termo-item">
        <div><strong>${this.esc(termo.fileName || "Documento de financiamento.pdf")}</strong><span>Gerado em ${this.esc(this.fmtDate(termo.documentDate || termo.generatedAt))} · validade até ${this.esc(this.fmtDate(termo.validUntil))}</span></div>
        <div class="fin-termo-acoes">${baixar}${envio}${excluir}<span id="fin-termo-send-st-${this.esc(termo.id)}" class="fin-termo-st" role="status"></span></div>
      </div>`;
    }).join("");
    const sid = String(stageId).replace(/[^a-zA-Z0-9_-]/g, "");
    return itens ? `<div class="fin-termos-lista" id="fin-termos-lista-${sid}"><strong>Documentos gerados nesta etapa</strong>${itens}</div>` : "";
  },

  atualizarTermosEtapa(stageId) {
    const proc = FinanciamentoState.process;
    const sid = String(stageId).replace(/[^a-zA-Z0-9_-]/g, "");
    const listaAtual = document.getElementById("fin-termos-lista-" + sid);
    const html = this.termosEtapaHtml(proc, stageId);
    if (listaAtual) {
      listaAtual.outerHTML = html;
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    const botaoGerar = document.getElementById("fin-termo-gerar-" + sid);
    const gerador = botaoGerar && botaoGerar.closest(".fin-termo-gerar");
    if (gerador && html) {
      gerador.insertAdjacentHTML("afterend", html);
      if (window.lucide) window.lucide.createIcons();
    }
  },

  async removerTermoSaldo(stageId, termoId) {
    const proc = FinanciamentoState.process;
    const lista = proc && proc.termos && proc.termos[stageId];
    const termo = Array.isArray(lista) ? lista.find((item) => String(item && item.id) === String(termoId)) : null;
    const btn = document.getElementById("fin-termo-del-" + termoId);
    if (!proc || !termo) return false;
    this._removendoTermo = this._removendoTermo || new Set();
    if (this._removendoTermo.has(String(termoId))) return false;
    this._removendoTermo.add(String(termoId));
    if (btn) { btn.disabled = true; btn.setAttribute("aria-label", "Excluindo termo"); }
    const status = document.getElementById("fin-termo-send-st-" + termoId);
    try {
      const msg = termo.siengeSentAt
        ? "Este termo já foi enviado ao Sienge. A exclusão removerá o termo e o PDF do armazenamento do CRM, mas não apagará o anexo no Sienge. Deseja continuar?"
        : "Excluir este termo e apagar o PDF salvo no armazenamento do CRM? Esta ação não pode ser desfeita.";
      const ok = typeof window.mouraConfirm === "function" ? await window.mouraConfirm(msg) : window.confirm(msg);
      if (!ok) return false;
      const fc = window.firebaseCollections;
      const storageLocation = termo.storagePath || termo.url;
      if (!window.firebaseStorage || !fc || !fc.ref || !fc.deleteObject || !storageLocation) {
        throw new Error("Não foi possível localizar o PDF para excluí-lo do armazenamento.");
      }
      const storageRef = fc.ref(window.firebaseStorage, storageLocation);
      await fc.deleteObject(storageRef);
      proc.termos[stageId] = lista.filter((item) => String(item && item.id) !== String(termoId));
      if (!proc.termos[stageId].length) delete proc.termos[stageId];
      proc.updatedAt = new Date().toISOString();
      this.saveProcess(proc);
      FinanciamentoState.process = proc;
      this.atualizarTermosEtapa(stageId);
      const status = document.getElementById("fin-termo-st-" + String(stageId).replace(/[^a-zA-Z0-9_-]/g, ""));
      if (status) status.textContent = "Termo e PDF removidos desta ficha.";
      return true;
    } catch (e) {
      console.error("[Financiamento] exclusão do termo", e);
      if (status) status.textContent = (e && e.message) || "Não foi possível excluir o termo.";
      return false;
    } finally {
      this._removendoTermo.delete(String(termoId));
      const atual = document.getElementById("fin-termo-del-" + termoId);
      if (atual) { atual.disabled = false; atual.setAttribute("aria-label", "Excluir termo"); }
    }
  },

  urlStorageTermo(raw) {
    try {
      const url = new URL(String(raw || ""), window.location.href);
      if (url.protocol !== "https:" && url.origin !== window.location.origin) return "";
      if (url.origin !== window.location.origin
        && url.hostname !== "firebasestorage.googleapis.com"
        && url.hostname !== "storage.googleapis.com") return "";
      return url.href;
    } catch (e) {
      return "";
    }
  },

  carregarScriptTermo(src, disponivel, nome) {
    if (disponivel()) return Promise.resolve();
    this._scriptsTermo = this._scriptsTermo || {};
    if (!this._scriptsTermo[src]) {
      this._scriptsTermo[src] = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = () => disponivel()
          ? resolve()
          : reject(new Error("A biblioteca " + nome + " carregou sem disponibilizar sua API."));
        script.onerror = () => reject(new Error("Não foi possível carregar a biblioteca " + nome + "."));
        document.head.appendChild(script);
      }).catch((e) => {
        delete this._scriptsTermo[src];
        throw e;
      });
    }
    return this._scriptsTermo[src];
  },

  substituirTextoTermo(xmlDoc, procurado, valor) {
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const textos = Array.from(xmlDoc.getElementsByTagNameNS(ns, "t"));
    let encontrados = 0;
    textos.forEach((no) => {
      const atual = no.textContent || "";
      if (atual.indexOf(procurado) < 0) return;
      no.textContent = atual.replace(procurado, String(valor == null ? "" : valor));
      encontrados += 1;
    });
    if (!encontrados) throw new Error("O modelo Word não contém o campo esperado: " + procurado);
  },

  substituirPreambuloTermo(xmlDoc, preambulo, token) {
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const campo = token || "[Preambulo]";
    const paragrafo = Array.from(xmlDoc.getElementsByTagNameNS(ns, "p"))
      .find((p) => (p.textContent || "").indexOf(campo) >= 0);
    if (!paragrafo || !paragrafo.parentNode) throw new Error("O modelo Word não contém o campo do preâmbulo.");
    const blocos = String(preambulo || "").split(/\n+/).map((texto) => texto.trim()).filter(Boolean);
    if (!blocos.length) throw new Error("O preâmbulo cadastrado para o empreendimento está vazio.");
    const pai = paragrafo.parentNode;
    blocos.forEach((bloco) => {
      const copia = paragrafo.cloneNode(true);
      const texto = Array.from(copia.getElementsByTagNameNS(ns, "t"))
        .find((no) => (no.textContent || "").indexOf(campo) >= 0);
      if (!texto) throw new Error("Não foi possível preencher o preâmbulo no modelo Word.");
      texto.textContent = texto.textContent.replace(campo, bloco);
      pai.insertBefore(copia, paragrafo);
    });
    pai.removeChild(paragrafo);
  },

  async montarDocxTermoSaldo(dados) {
    await this.carregarScriptTermo(
      "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
      () => !!window.JSZip,
      "JSZip"
    );
    const response = await fetch(FIN_TERMO_TEMPLATE_URL);
    if (!response.ok) throw new Error("Não foi possível abrir o modelo Word do termo (HTTP " + response.status + ").");
    const zip = await window.JSZip.loadAsync(await response.arrayBuffer());
    const arquivoXml = zip.file("word/document.xml");
    if (!arquivoXml) throw new Error("O modelo Word está incompleto: documento principal não encontrado.");
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(await arquivoXml.async("string"), "application/xml");
    if (xmlDoc.getElementsByTagName("parsererror").length) throw new Error("Não foi possível interpretar o modelo Word.");
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    this.substituirPreambuloTermo(xmlDoc, dados.preambulo);
    const paragrafos = Array.from(xmlDoc.getElementsByTagNameNS(ns, "p"));
    const holders = dados.titulares || [];
    if (holders.length < 2) {
      const segundo = paragrafos.find((p) => (p.textContent || "").indexOf("2º TITULAR") >= 0);
      if (segundo && segundo.parentNode) segundo.parentNode.removeChild(segundo);
    }
    if (holders.length < 3) {
      const adicionais = Array.from(xmlDoc.getElementsByTagNameNS(ns, "p"))
        .find((p) => (p.textContent || "").indexOf("[INCLUIR TODOS OS TITULARES DO CONTRATO]") >= 0);
      if (adicionais && adicionais.parentNode) adicionais.parentNode.removeChild(adicionais);
    }
    const extras = holders.slice(2).map((pessoa, i) =>
      (i + 3) + "º TITULAR - " + pessoa.nome + " - CPF/CNPJ: " + pessoa.documento
    ).join("; ");
    const campos = [
      ["[NOME DO EMPREENDIMENTO]", dados.empreendimento],
      ["QUADRA/LOTE", dados.unidade],
      ["1º TITULAR", holders[0].nome],
      ["Nº CPF TITULAR", holders[0].documento],
      ["VALOR COMERCIAL (POR EXTENSO)", dados.valorComercialTexto],
      ["SALDO DEVEDOR PRESENTE (POR EXTENSO)", dados.saldoPresenteTexto],
      ["ÚLTIMO", dados.validadeExtenso + " - "],
      [" DIA DO MÊS VIGENTE)", dados.validadeNumerica + ")"],
      ["XXXXXXXXX", dados.mesEmissao],
      ["XXXX", dados.anoEmissao],
      ["XX", dados.diaEmissao]
    ];
    if (holders.length >= 2) {
      campos.push(["2º TITULAR - ", holders[1].nome + " - "]);
      campos.push(["Nº CPF 2º TITULAR", holders[1].documento]);
    }
    if (holders.length >= 3) campos.push(["[INCLUIR TODOS OS TITULARES DO CONTRATO]", extras]);
    campos.forEach(([campo, valor]) => this.substituirTextoTermo(xmlDoc, campo, valor));
    const destaques = Array.from(xmlDoc.getElementsByTagNameNS(ns, "highlight"));
    destaques.forEach((no) => { if (no.parentNode) no.parentNode.removeChild(no); });
    const textoFinal = Array.from(xmlDoc.getElementsByTagNameNS(ns, "t")).map((no) => no.textContent || "").join("");
    const pendentes = [
      "[Preambulo]", "[NOME DO EMPREENDIMENTO]", "QUADRA/LOTE", "1º TITULAR", "Nº CPF TITULAR",
      "2º TITULAR", "Nº CPF 2º TITULAR", "[INCLUIR TODOS OS TITULARES DO CONTRATO]",
      "VALOR COMERCIAL (POR EXTENSO)", "SALDO DEVEDOR PRESENTE (POR EXTENSO)",
      "DIA DO MÊS VIGENTE", "XXXXXXXXX"
    ].filter((campo) => textoFinal.indexOf(campo) >= 0);
    if (pendentes.length) throw new Error("Há campos sem preenchimento no modelo: " + pendentes.join(", "));
    this.numerarDisposicoesFinaisTermo(xmlDoc);
    this.justificarParagrafosTermo(xmlDoc);
    this.destacarAlertaTermo(xmlDoc);
    zip.file("word/document.xml", new XMLSerializer().serializeToString(xmlDoc));
    return zip.generateAsync({
      type: "arraybuffer",
      compression: "DEFLATE",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
  },

  async montarDocxDeclaracaoSaldo(dados) {
    await this.carregarScriptTermo(
      "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
      () => !!window.JSZip,
      "JSZip"
    );
    const response = await fetch(FIN_DECLARACAO_TEMPLATE_URL);
    if (!response.ok) throw new Error("Não foi possível abrir o modelo Word da declaração (HTTP " + response.status + ").");
    const zip = await window.JSZip.loadAsync(await response.arrayBuffer());
    const arquivoXml = zip.file("word/document.xml");
    if (!arquivoXml) throw new Error("O modelo Word da declaração está incompleto: documento principal não encontrado.");
    const xmlDoc = new DOMParser().parseFromString(await arquivoXml.async("string"), "application/xml");
    if (xmlDoc.getElementsByTagName("parsererror").length) throw new Error("Não foi possível interpretar o modelo Word da declaração.");
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const holders = dados.titulares || [];
    if (!holders.length) throw new Error("Não encontrei titulares para preencher a declaração.");
    this.substituirPreambuloTermo(xmlDoc, dados.preambulo, "[PREAMBULO]");
    const paragrafos = Array.from(xmlDoc.getElementsByTagNameNS(ns, "p"));
    if (holders.length < 2) {
      const segundo = paragrafos.find((p) => (p.textContent || "").indexOf("2º TITULAR") >= 0);
      if (segundo && segundo.parentNode) segundo.parentNode.removeChild(segundo);
    }
    if (holders.length < 3) {
      const adicionais = Array.from(xmlDoc.getElementsByTagNameNS(ns, "p"))
        .find((p) => (p.textContent || "").indexOf("[INCLUIR TODOS OS TITULARES DO CONTRATO]") >= 0);
      if (adicionais && adicionais.parentNode) adicionais.parentNode.removeChild(adicionais);
    }
    const extras = holders.slice(2).map((pessoa, index) =>
      (index + 3) + "º TITULAR - " + pessoa.nome + " - CPF/CNPJ: " + pessoa.documento
    ).join("; ");
    const periodo = dados.periodoCongelamento || {};
    const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    const [ano, mes, dia] = String(dados.emissao || "").split("-").map(Number);
    if (!ano || !mes || !dia) throw new Error("A data de emissão da declaração é inválida.");
    const campos = [
      ["[NOME DO EMPREENDIMENTO]", dados.empreendimento],
      ["QUADRA/LOTE", dados.unidade],
      ["1º TITULAR", holders[0].nome],
      ["Nº CPF TITULAR", holders[0].documento],
      ["VALOR COMERCIAL (POR EXTENSO)", dados.valorComercialTexto],
      ["SALDO DEVEDOR PRESENTE (POR EXTENSO)", dados.saldoPresenteTexto],
      ["[data inicial]", this.fmtDate(periodo.inicio)],
      ["[data final]", this.fmtDate(periodo.fim)],
      ["[quantidade]", periodo.quantidade],
      ["XXXXXXXX", meses[mes - 1]],
      ["XXXX", ano],
      ["XX", dia]
    ];
    if (holders.length >= 2) {
      campos.push(["2º TITULAR - ", holders[1].nome + " - "]);
      campos.push(["Nº CPF 2º TITULAR", holders[1].documento]);
    }
    if (holders.length >= 3) campos.push(["[INCLUIR TODOS OS TITULARES DO CONTRATO]", extras]);
    campos.forEach(([campo, valor]) => this.substituirTextoTermo(xmlDoc, campo, valor));
    const textoFinal = Array.from(xmlDoc.getElementsByTagNameNS(ns, "t")).map((no) => no.textContent || "").join("");
    const pendentes = [
      "[PREAMBULO]", "[NOME DO EMPREENDIMENTO]", "QUADRA/LOTE", "1º TITULAR", "Nº CPF TITULAR",
      "2º TITULAR", "Nº CPF 2º TITULAR", "[INCLUIR TODOS OS TITULARES DO CONTRATO]",
      "VALOR COMERCIAL (POR EXTENSO)", "SALDO DEVEDOR PRESENTE (POR EXTENSO)",
      "[data inicial]", "[data final]", "[quantidade]", "XXXXXXXX"
    ].filter((campo) => textoFinal.indexOf(campo) >= 0);
    if (pendentes.length) throw new Error("Há campos sem preenchimento no modelo da declaração: " + pendentes.join(", "));
    this.justificarParagrafosTermo(xmlDoc);
    zip.file("word/document.xml", new XMLSerializer().serializeToString(xmlDoc));
    return zip.generateAsync({
      type: "arraybuffer",
      compression: "DEFLATE",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
  },

  async converterDocxTermoParaPdf(buffer) {
    await this.carregarScriptTermo(
      "https://cdn.jsdelivr.net/npm/docx-preview@0.3.6/dist/docx-preview.min.js",
      () => !!(window.docx && typeof window.docx.renderAsync === "function"),
      "visualizador do Word"
    );
    if (typeof window.html2canvas !== "function" || !window.jspdf || typeof window.jspdf.jsPDF !== "function") {
      throw new Error("O gerador de PDF não está disponível. Atualize a página e tente novamente.");
    }
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;left:-12000px;top:0;z-index:-1;background:#fff;";
    document.body.appendChild(container);
    try {
      await window.docx.renderAsync(buffer, container, document.head, {
        className: "docx",
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        renderHeaders: true,
        renderFooters: true
      });
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const paginas = Array.from(container.querySelectorAll(".docx-wrapper > section.docx"));
      if (!paginas.length) throw new Error("O modelo Word não gerou páginas para o PDF.");
      const { jsPDF } = window.jspdf;
      let pdf = null;
      for (let i = 0; i < paginas.length; i++) {
        const pagina = paginas[i];
        const rect = pagina.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) throw new Error("Uma página do termo ficou sem dimensões.");
        const canvas = await window.html2canvas(pagina, {
          backgroundColor: "#ffffff",
          scale: 2,
          useCORS: true,
          logging: false,
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height)
        });
        const larguraMm = rect.width * 25.4 / 96;
        const alturaMm = rect.height * 25.4 / 96;
        if (!pdf) {
          pdf = new jsPDF({
            orientation: larguraMm > alturaMm ? "landscape" : "portrait",
            unit: "mm",
            format: [larguraMm, alturaMm],
            compress: true
          });
        } else {
          pdf.addPage([larguraMm, alturaMm], larguraMm > alturaMm ? "landscape" : "portrait");
        }
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, larguraMm, alturaMm);
      }
      const blob = pdf.output("blob");
      if (!blob || !blob.size) throw new Error("O PDF gerado está vazio.");
      return { pdf: pdf, blob: blob };
    } finally {
      container.remove();
    }
  },

  async obterTitularesTermo(sale, customerFallback) {
    const svc = window.SiengeApiService;
    const raw = Array.isArray(sale.salesContractCustomers) ? sale.salesContractCustomers
      : (Array.isArray(sale.customers) ? sale.customers : []);
    const lista = [];
    const vistos = new Set();
    const adicionar = async (item, fallback) => {
      if (!item || typeof item !== "object") return;
      const nested = item.customer && typeof item.customer === "object" ? item.customer : item;
      const id = item.customerId || nested.customerId || nested.id || item.id || "";
      let pessoa = Object.assign({}, nested);
      if (id && svc && typeof svc.getCustomer === "function") {
        const detalhe = await svc.getCustomer(id);
        if (detalhe) pessoa = Object.assign({}, pessoa, detalhe);
      }
      if (!pessoa.name && fallback && fallback.name) pessoa.name = fallback.name;
      if (!(pessoa.cpfCnpj || pessoa.cpf || pessoa.cnpj) && fallback) {
        pessoa.cpfCnpj = fallback.cpfCnpj || fallback.cpf || fallback.cnpj || "";
      }
      const nome = String(pessoa.name || pessoa.customerName || "").trim();
      const documentoRaw = String(pessoa.cpfCnpj || pessoa.cpf || pessoa.cnpj || "").trim();
      const documento = typeof window.formatCpfCnpj === "function" ? window.formatCpfCnpj(documentoRaw) : documentoRaw;
      const chave = String(documentoRaw.replace(/\D/g, "") || id || nome).toLowerCase();
      if (nome && documentoRaw && !vistos.has(chave)) {
        vistos.add(chave);
        lista.push({ nome: nome, documento: documento });
      }
    };
    const principal = (item) => item && (item.main === true || item.main === "true" || item.main === 1);
    const ordenados = raw.slice().sort((a, b) => Number(principal(b)) - Number(principal(a)));
    for (let i = 0; i < ordenados.length; i++) {
      const item = ordenados[i];
      const fallback = String(item.customerId || (item.customer && item.customer.id) || item.id || "") === String(customerFallback && customerFallback.id || "")
        ? customerFallback : null;
      await adicionar(item, fallback);
    }
    if (customerFallback && customerFallback.id && !vistos.has(String(customerFallback.id).toLowerCase())) {
      await adicionar(customerFallback, customerFallback);
    }
    if (!lista.length && customerFallback) await adicionar(customerFallback, customerFallback);
    if (!lista.length) throw new Error("Não encontrei titulares com nome e CPF/CNPJ no contrato do Sienge.");
    return lista;
  },

  async consultarSaldoDevedorPresente(svc, documento, billId, companyId) {
    const doc = String(documento || "").replace(/\D/g, "");
    let saldo = null;
    if (svc && typeof svc.getTotalCurrentDebitBalance === "function" && doc.length >= 11) {
      const resposta = await svc.getTotalCurrentDebitBalance(doc, billId);
      if (resposta) {
        const total = resposta.results && resposta.results[0] && resposta.results[0].totalCurrentDebitBalanceValue;
        const valor = total != null ? total : (resposta.totalCurrentDebitBalanceValue != null
          ? resposta.totalCurrentDebitBalanceValue : resposta.presentValue);
        if (valor != null && String(valor).trim() !== "") {
          saldo = typeof window.mapaJuridicoParseQuitacao === "function"
            ? window.mapaJuridicoParseQuitacao(resposta) : Number(valor);
        }
      }
    }
    if (!Number.isFinite(saldo) && svc && typeof svc.getCustomerDebtBalance === "function") {
      const resposta = await svc.getCustomerDebtBalance(billId, { companyId: companyId });
      const rows = resposta && (Array.isArray(resposta.data) ? resposta.data : (Array.isArray(resposta.results) ? resposta.results : []));
      const valores = rows.map((r) => {
        const valor = r && r.presentValue;
        return valor == null || String(valor).trim() === "" ? NaN : Number(valor);
      }).filter(Number.isFinite);
      if (rows.length && valores.length === rows.length) saldo = valores.reduce((total, valor) => total + valor, 0);
    }
    if (!Number.isFinite(saldo)) throw new Error("Não foi possível obter o saldo devedor presente do título no Sienge.");
    return saldo;
  },

  async obterSaldoQuitacaoSistema(proc) {
    const svc = window.SiengeApiService;
    if (!svc) throw new Error("A conexão com o Sienge não está disponível.");
    const selecionado = FinanciamentoState.selected || {};
    let sale = String(selecionado.contractId || "") === String(proc.contractId)
      ? Object.assign({}, selecionado.contract || {})
      : {};
    if (typeof svc.getSales === "function") {
      const vendas = await svc.getSales(proc.customerId);
      const encontrada = (Array.isArray(vendas) ? vendas : []).find((c) =>
        String(c.id || c.contractId || "") === String(proc.contractId)
      );
      if (encontrada) sale = Object.assign({}, sale, encontrada);
    }
    let customer = String((FinanciamentoState.customer && FinanciamentoState.customer.id) || "") === String(proc.customerId)
      ? FinanciamentoState.customer : (selecionado.customer || null);
    const docDe = (pessoa) => String(pessoa && (pessoa.cpfCnpj || pessoa.cpf || pessoa.cnpj || pessoa.document) || "");
    if (!docDe(customer) && typeof svc.getCustomer === "function") customer = await svc.getCustomer(proc.customerId);
    let documento = docDe(customer);
    if (!documento && (sale.salesContractCustomers || sale.customers)) {
      const titulares = await this.obterTitularesTermo(sale, customer);
      documento = titulares[0] && titulares[0].documento;
    }
    const billId = String(proc.titulo || sale.receivableBillId || sale.billReceivableId || "").trim();
    if (!billId || billId === "—" || billId === "N/D") throw new Error("O título a receber associado ao contrato não foi encontrado.");
    if (String(documento || "").replace(/\D/g, "").length < 11) {
      throw new Error("Não encontrei o CPF/CNPJ do titular para consultar o saldo no Sienge.");
    }
    return this.consultarSaldoDevedorPresente(svc, documento, billId, sale.companyId || proc.companyId);
  },

  carregarSaldoQuitacao(proc, forcar) {
    if (!proc || !proc.customerId || !proc.contractId) return Promise.resolve(null);
    const key = this.procKey(proc.customerId, proc.contractId);
    this._saldoQuitacaoPromises = this._saldoQuitacaoPromises || {};
    if (this._saldoQuitacaoPromises[key]) return this._saldoQuitacaoPromises[key];
    const atualizado = Date.parse(proc.saldoQuitacaoAtualizadoEm || "") || 0;
    const tentado = Number(proc.saldoQuitacaoTentadoEm) || 0;
    if (!forcar && proc.saldoQuitacaoSistema != null && String(proc.saldoQuitacaoSistema).trim() !== ""
      && Number.isFinite(Number(proc.saldoQuitacaoSistema))
      && atualizado && Date.now() - atualizado < 5 * 60 * 1000) return Promise.resolve(proc.saldoQuitacaoSistema);
    if (!forcar && tentado && Date.now() - tentado < 60 * 1000) return Promise.resolve(null);
    proc.saldoQuitacaoCarregando = true;
    const promise = (async () => {
      try {
        const valor = await this.obterSaldoQuitacaoSistema(proc);
        const salvo = this.getProcess(proc.customerId, proc.contractId) || proc;
        salvo.saldoQuitacaoSistema = valor;
        salvo.saldoQuitacaoAtualizadoEm = new Date().toISOString();
        salvo.saldoQuitacaoTentadoEm = Date.now();
        salvo.saldoQuitacaoErro = "";
        salvo.updatedAt = new Date().toISOString();
        this.saveProcess(salvo);
        if (FinanciamentoState.process && this.procKey(FinanciamentoState.process.customerId, FinanciamentoState.process.contractId) === key) {
          FinanciamentoState.process = salvo;
        }
        return valor;
      } catch (e) {
        const salvo = this.getProcess(proc.customerId, proc.contractId) || proc;
        salvo.saldoQuitacaoErro = (e && e.message) || "Não foi possível consultar o saldo de quitação.";
        salvo.saldoQuitacaoTentadoEm = Date.now();
        this.saveProcess(salvo);
        if (FinanciamentoState.process && this.procKey(FinanciamentoState.process.customerId, FinanciamentoState.process.contractId) === key) {
          FinanciamentoState.process = salvo;
        }
        console.error("[Financiamento] consulta do saldo de quitação", e);
        return null;
      } finally {
        const atual = this.getProcess(proc.customerId, proc.contractId) || proc;
        atual.saldoQuitacaoCarregando = false;
        if (FinanciamentoState.process && this.procKey(FinanciamentoState.process.customerId, FinanciamentoState.process.contractId) === key) {
          FinanciamentoState.process = atual;
          this.render();
        }
      }
    })();
    this._saldoQuitacaoPromises[key] = promise;
    return promise.finally(() => {
      if (this._saldoQuitacaoPromises[key] === promise) delete this._saldoQuitacaoPromises[key];
    });
  },

  atualizarSaldoQuitacao() {
    return this.carregarSaldoQuitacao(FinanciamentoState.process, true);
  },

  async obterMetragemLoteDoProcesso(proc) {
    if (!proc || !proc.contractId) throw new Error("Contrato não informado para consultar a metragem.");
    let sale = {};
    const selecionado = FinanciamentoState.selected || {};
    if (String(selecionado.contractId || "") === String(proc.contractId)) {
      sale = Object.assign({}, selecionado.contract || {});
    }
    const svc = window.SiengeApiService;
    if (svc && typeof svc.getSales === "function" && proc.customerId) {
      try {
        const vendas = await svc.getSales(proc.customerId);
        const encontrada = (Array.isArray(vendas) ? vendas : []).find((c) =>
          String(c.id || c.contractId || "") === String(proc.contractId)
        );
        if (encontrada) sale = Object.assign({}, sale, encontrada);
      } catch (e) {}
    }
    if (typeof window.siengeFetchWithRetry === "function") {
      try {
        const detalhe = await window.siengeFetchWithRetry("/sales-contracts/" + encodeURIComponent(proc.contractId));
        if (detalhe && typeof detalhe === "object") sale = Object.assign({}, sale, detalhe);
      } catch (e) {}
    }
    const unidades = Array.isArray(sale.salesContractUnits) ? sale.salesContractUnits : [];
    const unidadeRaw = unidades.find((u) => u && (u.main === true || u.main === "true")) || unidades[0] || {};
    const unidadeNome = String(unidadeRaw.name || sale.unitName || sale.unityName || proc.unitName || proc.unit || "").trim();
    const centroCusto = String(sale.enterpriseId || sale.costCenterId || proc.costCenterId || proc.empId || "").trim();
    const unit = {
      id: unidadeRaw.id || sale.siengeUnitId || proc.siengeUnitId || "",
      name: unidadeNome,
      unitName: unidadeNome,
      costCenterId: centroCusto,
      enterpriseId: centroCusto,
      privateArea: unidadeRaw.privateArea || unidadeRaw.Privatearea || sale.privateArea,
      terrainArea: unidadeRaw.terrainArea || sale.terrainArea,
      totalArea: unidadeRaw.totalArea || sale.totalArea
    };
    const area = await this.obterMetragemLoteContrato({
      sale: sale,
      unit: unit,
      empreendimento: this.obraDoProc(proc).empreendimento
    });
    if (area == null) throw new Error("Metragem do lote não encontrada na ficha da unidade no Sienge.");
    return area;
  },

  carregarMetragemLote(proc, forcar) {
    if (!proc || !proc.customerId || !proc.contractId) return Promise.resolve(null);
    const key = this.procKey(proc.customerId, proc.contractId);
    this._metragemLotePromises = this._metragemLotePromises || {};
    if (this._metragemLotePromises[key]) return this._metragemLotePromises[key];
    const atualizado = Date.parse(proc.metragemLoteAtualizadoEm || "") || 0;
    const tentado = Number(proc.metragemLoteTentadoEm) || 0;
    if (!forcar && proc.metragemLote != null && String(proc.metragemLote).trim() !== ""
      && Number.isFinite(Number(proc.metragemLote))
      && atualizado && Date.now() - atualizado < 30 * 60 * 1000) {
      this.sincronizarValorComercialCalculado(proc);
      return Promise.resolve(Number(proc.metragemLote));
    }
    if (!forcar && tentado && Date.now() - tentado < 60 * 1000) return Promise.resolve(null);
    proc.metragemLoteCarregando = true;
    const promise = (async () => {
      try {
        const valor = await this.obterMetragemLoteDoProcesso(proc);
        const salvo = this.getProcess(proc.customerId, proc.contractId) || proc;
        salvo.metragemLote = valor;
        salvo.metragemLoteAtualizadoEm = new Date().toISOString();
        salvo.metragemLoteTentadoEm = Date.now();
        salvo.metragemLoteErro = "";
        this.sincronizarValorComercialCalculado(salvo);
        salvo.updatedAt = new Date().toISOString();
        this.saveProcess(salvo);
        if (FinanciamentoState.process && this.procKey(FinanciamentoState.process.customerId, FinanciamentoState.process.contractId) === key) {
          FinanciamentoState.process = salvo;
        }
        return valor;
      } catch (e) {
        const salvo = this.getProcess(proc.customerId, proc.contractId) || proc;
        salvo.metragemLoteErro = (e && e.message) || "Não foi possível consultar a metragem do lote.";
        salvo.metragemLoteTentadoEm = Date.now();
        this.saveProcess(salvo);
        if (FinanciamentoState.process && this.procKey(FinanciamentoState.process.customerId, FinanciamentoState.process.contractId) === key) {
          FinanciamentoState.process = salvo;
        }
        console.warn("[Financiamento] consulta da metragem do lote", e);
        return null;
      } finally {
        const atual = this.getProcess(proc.customerId, proc.contractId) || proc;
        atual.metragemLoteCarregando = false;
        if (FinanciamentoState.process && this.procKey(FinanciamentoState.process.customerId, FinanciamentoState.process.contractId) === key) {
          FinanciamentoState.process = atual;
          this.render();
        }
      }
    })();
    this._metragemLotePromises[key] = promise;
    return promise.finally(() => {
      if (this._metragemLotePromises[key] === promise) delete this._metragemLotePromises[key];
    });
  },

  async obterDadosTermoSaldo(proc) {
    const selecionado = FinanciamentoState.selected || {};
    let sale = String(selecionado.contractId || "") === String(proc.contractId)
      ? Object.assign({}, selecionado.contract || {})
      : {};
    const svc = window.SiengeApiService;
    if (svc && typeof svc.getSales === "function") {
      const vendas = await svc.getSales(proc.customerId);
      const encontrada = (Array.isArray(vendas) ? vendas : []).find((c) =>
        String(c.id || c.contractId || "") === String(proc.contractId)
      );
      if (encontrada) sale = Object.assign({}, sale, encontrada);
    }
    if (typeof window.siengeFetchWithRetry === "function") {
      const detalhe = await window.siengeFetchWithRetry("/sales-contracts/" + encodeURIComponent(proc.contractId));
      if (detalhe && typeof detalhe === "object") sale = Object.assign({}, sale, detalhe);
    }
    const unidades = Array.isArray(sale.salesContractUnits) ? sale.salesContractUnits : [];
    const unidadeRaw = unidades.find((u) => u && (u.main === true || u.main === "true")) || unidades[0] || {};
    const unidadeNome = String(unidadeRaw.name || sale.unitName || sale.unityName || proc.unitName || proc.unit || "").trim();
    const centroCusto = String(sale.enterpriseId || sale.costCenterId || proc.costCenterId || proc.empId || "").trim();
    if (!unidadeNome) throw new Error("Não encontrei a unidade do contrato para preencher o termo.");
    if (!centroCusto) throw new Error("Não encontrei o empreendimento/centro de custo do contrato.");
    const unit = {
      id: unidadeRaw.id || sale.siengeUnitId || "",
      name: unidadeNome,
      unitName: unidadeNome,
      costCenterId: centroCusto,
      enterpriseId: centroCusto,
      companyId: sale.companyId || proc.companyId || ""
    };
    const empreendimento = typeof window.resolveLoteamentoName === "function"
      ? String(window.resolveLoteamentoName(unit, sale) || "").trim()
      : String(this.obraDoProc(proc).empreendimento || "").trim();
    if (!empreendimento || empreendimento === "—" || empreendimento === "____") throw new Error("Não encontrei o nome do empreendimento para preencher o termo.");
    if (typeof window.getPreambleForContract !== "function") throw new Error("A busca de preâmbulos por empreendimento não está disponível.");
    const preambuloRaw = String(window.getPreambleForContract(unit, sale) || "");
    if (!preambuloRaw || /PREÂMBULO NÃO CADASTRADO/i.test(preambuloRaw)) {
      throw new Error("Não há preâmbulo cadastrado para o empreendimento deste contrato.");
    }
    const divTexto = document.createElement("div");
    const preambuloHtml = preambuloRaw
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "");
    divTexto.innerHTML = preambuloHtml;
    const preambulo = String(divTexto.textContent || "")
      .replace(/\r/g, "")
      .replace(/[ \t\u00a0]*\n[ \t\u00a0]*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!preambulo) throw new Error("O preâmbulo cadastrado para o empreendimento está vazio.");
    const contratoValor = [sale.totalSellingValue, sale.contractValue, sale.value, sale.updatedContractValue]
      .map((v) => this.parseValorComercialTermo(v))
      .find((v) => v != null);
    const titulares = await this.obterTitularesTermo(sale, FinanciamentoState.customer || selecionado.customer);
    const billId = String(proc.titulo || sale.receivableBillId || sale.billReceivableId || "").trim();
    if (!billId || billId === "—" || billId === "N/D") throw new Error("O título a receber associado ao contrato não foi encontrado.");
    const saldoPresente = await this.consultarSaldoDevedorPresente(
      svc, titulares[0].documento, billId, sale.companyId || proc.companyId
    );
    if (typeof window.valorPorExtensoBRL !== "function") throw new Error("A conversão dos valores por extenso não está disponível.");
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = agora.getMonth() + 1;
    const dia = agora.getDate();
    const emissao = ano + "-" + String(mes).padStart(2, "0") + "-" + String(dia).padStart(2, "0");
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const validade = ano + "-" + String(mes).padStart(2, "0") + "-" + String(ultimoDia).padStart(2, "0");
    const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    const validadeExtenso = ultimoDia + " de " + meses[mes - 1] + " de " + ano;
    const emReais = (valor) => Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const valorComercialTexto = contratoValor == null
      ? ""
      : emReais(contratoValor) + " (" + window.valorPorExtensoBRL(contratoValor) + ")";
    const saldoPresenteTexto = emReais(saldoPresente) + " (" + window.valorPorExtensoBRL(saldoPresente) + ")";
    return {
      sale: sale,
      unit: unit,
      empreendimento: empreendimento,
      unidade: this.formatUnidade(unidadeNome),
      preambulo: preambulo,
      titulares: titulares,
      billId: billId,
      valorComercial: contratoValor,
      saldoPresente: saldoPresente,
      valorComercialTexto: valorComercialTexto,
      saldoPresenteTexto: saldoPresenteTexto,
      emissao: emissao,
      validade: validade,
      validadeExtenso: validadeExtenso,
      validadeNumerica: this.fmtDate(validade),
      diaEmissao: String(dia),
      mesEmissao: meses[mes - 1],
      anoEmissao: String(ano)
    };
  },

  async guardarTermoSaldo(proc, stageId, blob, dados, opcoes) {
    const options = opcoes || {};
    const fc = window.firebaseCollections;
    if (!window.firebaseStorage || !fc || !fc.ref || !fc.uploadBytes || !fc.getDownloadURL) {
      throw new Error("O armazenamento do PDF não está disponível.");
    }
    const numero = String(proc.contractNumber || proc.contractId).replace(/[^\w.-]+/g, "-");
    const nome = options.fileName || ("termo-simulacao-saldo-devedor-" + numero + "-" + dados.emissao + ".pdf");
    const id = "termo-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const path = "financiamentos/" + encodeURIComponent(String(proc.customerId))
      + "/" + encodeURIComponent(String(proc.contractId))
      + "/etapas/" + encodeURIComponent(String(stageId)) + "/" + id + ".pdf";
    const storageRef = fc.ref(window.firebaseStorage, path);
    let uploaded = false;
    try {
      await fc.uploadBytes(storageRef, blob, { contentType: "application/pdf" });
      uploaded = true;
      const url = await fc.getDownloadURL(storageRef);
      const termo = {
        id: id,
        tipo: options.tipo || "simulacao-saldo-devedor",
        fileName: nome,
        storagePath: path,
        url: url,
        documentDate: dados.emissao,
        validUntil: dados.validade,
        generatedAt: new Date().toISOString(),
        valorComercial: dados.valorComercial,
        saldoPresente: dados.saldoPresente,
        siengeUnitId: dados.unit && dados.unit.id ? String(dados.unit.id) : "",
        costCenterId: dados.unit && dados.unit.costCenterId ? String(dados.unit.costCenterId) : "",
        unitName: dados.unit && dados.unit.name ? String(dados.unit.name) : "",
        siengeTag: options.siengeTag || FIN_TERMO_SIENGE_TAG
      };
      if (Array.isArray(options.parcelasCongeladas)) termo.parcelasCongeladas = options.parcelasCongeladas;
      if (options.periodoCongelamento) termo.periodoCongelamento = options.periodoCongelamento;
      proc.termos = proc.termos || {};
      proc.termos[stageId] = (Array.isArray(proc.termos[stageId]) ? proc.termos[stageId] : []).concat(termo);
      if (Number.isFinite(Number(options.saldoDevedorDeclarado))) {
        proc.saldoDevedorDeclarado = Number(options.saldoDevedorDeclarado);
        proc.saldoDevedorDeclaradoEm = dados.emissao;
      }
      if (Number.isFinite(Number(dados.valorComercial)) && Number(dados.valorComercial) > 0) {
        proc.valorComercial = Number(dados.valorComercial);
        proc.valorComercialEm = dados.emissao || termo.generatedAt;
        proc.valorComercialFonte = dados.fonteValorComercial
          || (dados.valorM2 != null ? "metragem-x-m2-2026" : "documento");
        if (dados.metragemLote != null && Number.isFinite(Number(dados.metragemLote))) {
          proc.metragemLote = Number(dados.metragemLote);
        }
        if (dados.valorM2 != null && Number.isFinite(Number(dados.valorM2))) {
          proc.valorM2Comercial = Number(dados.valorM2);
        }
      }
      proc.updatedAt = termo.generatedAt;
      this.saveProcess(proc);
      FinanciamentoState.process = proc;
      return termo;
    } catch (e) {
      if (uploaded && fc.deleteObject) {
        try { await fc.deleteObject(storageRef); } catch (cleanupError) {
          console.warn("[Financiamento] limpeza do termo incompleto", cleanupError);
        }
      }
      throw e;
    }
  },

  async gerarTermoSaldoDevedor(stageId) {
    const proc = FinanciamentoState.process;
    const btn = document.getElementById("fin-termo-gerar-" + stageId);
    const status = document.getElementById("fin-termo-st-" + stageId);
    if (!proc || String(proc.currentStageId || "") !== String(stageId) || !this.ehEtapaTermoSaldo(stageId)) return false;
    if (this._gerandoTermo || this._boituvaModal) return false;
    this._gerandoTermo = true;
    if (btn) { btn.disabled = true; btn.textContent = "Gerando…"; }
    if (status) status.textContent = "Buscando os dados do contrato…";
    try {
      const dados = await this.obterDadosTermoSaldo(proc);
      if (status) status.textContent = "Calculando o valor comercial (metragem × m²)…";
      const resolucao = await this.resolverValorComercialLote(dados, proc);
      if (!resolucao) {
        if (status) status.textContent = "Geração do termo cancelada.";
        return false;
      }
      const valorComercial = resolucao.valorComercial;
      if (!(Number.isFinite(valorComercial) && valorComercial > 0)) {
        throw new Error("Não foi possível calcular um valor comercial válido.");
      }
      if (typeof window.valorPorExtensoBRL !== "function") throw new Error("A conversão dos valores por extenso não está disponível.");
      dados.valorComercial = valorComercial;
      dados.metragemLote = resolucao.metragem;
      dados.valorM2 = resolucao.valorM2;
      dados.fonteValorComercial = resolucao.fonte || "metragem-x-m2-2026";
      dados.valorComercialTexto = Number(valorComercial).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }) + " (" + window.valorPorExtensoBRL(valorComercial) + ")";
      if (status) {
        status.textContent = "Valor comercial: metragem " + this.fmtMetragemFin(resolucao.metragem)
          + " m² × R$ " + Number(resolucao.valorM2).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          + "/m² (tabela 2026). Preenchendo o modelo Word…";
      }
      const docxBuffer = await this.montarDocxTermoSaldo(dados);
      if (status) status.textContent = "Gerando o PDF…";
      const arquivoPdf = await this.converterDocxTermoParaPdf(docxBuffer);
      if (status) status.textContent = "Salvando o PDF nesta etapa…";
      await this.guardarTermoSaldo(proc, stageId, arquivoPdf.blob, dados);
      this.atualizarTermosEtapa(stageId);
      if (status) status.textContent = "Termo salvo nesta etapa. Você pode continuar o processo ou abrir o PDF abaixo.";
      return true;
    } catch (e) {
      if (status) status.textContent = (e && e.message) || "Não foi possível gerar e salvar o termo.";
      console.error("[Financiamento] geração do termo", e);
      return false;
    } finally {
      this._gerandoTermo = false;
      const atual = document.getElementById("fin-termo-gerar-" + stageId);
      if (atual) { atual.disabled = false; atual.textContent = "Gerar termo"; }
    }
  },

  async enviarTermoSienge(stageId, termoId) {
    const proc = FinanciamentoState.process;
    const lista = proc && proc.termos && proc.termos[stageId];
    const termo = Array.isArray(lista) ? lista.find((item) => String(item && item.id) === String(termoId)) : null;
    const btn = document.getElementById("fin-termo-env-" + termoId);
    if (!proc || !termo || termo.siengeSentAt) return false;
    this._enviosTermo = this._enviosTermo || new Set();
    if (this._enviosTermo.has(String(termoId))) return false;
    if (typeof window.anexosUploadUnitAttachment !== "function") {
      const status = document.getElementById("fin-termo-send-st-" + termoId);
      if (status) status.textContent = "O envio de anexos para o Sienge não está disponível.";
      return false;
    }
    this._enviosTermo.add(String(termoId));
    if (btn) { btn.disabled = true; btn.textContent = "Enviando…"; }
    try {
      const fc = window.firebaseCollections;
      let url = this.urlStorageTermo(termo.url);
      if (!url && termo.storagePath && fc && fc.ref && fc.getDownloadURL) {
        url = this.urlStorageTermo(await fc.getDownloadURL(fc.ref(window.firebaseStorage, termo.storagePath)));
      }
      if (!url) throw new Error("Não encontrei o PDF salvo para enviar ao Sienge.");
      const response = await fetch(url);
      if (!response.ok) throw new Error("Não foi possível ler o PDF salvo (HTTP " + response.status + ").");
      const blob = await response.blob();
      if (!blob.size) throw new Error("O PDF salvo está vazio.");
      const file = new File([blob], termo.fileName, { type: "application/pdf", lastModified: Date.now() });
      const costCenterId = termo.costCenterId || proc.costCenterId || proc.empId;
      const unitName = termo.unitName || proc.unitName || proc.unit;
      const sale = {
        customerId: proc.customerId,
        id: proc.contractId,
        contractId: proc.contractId,
        contractNumber: proc.contractNumber,
        receivableBillId: proc.titulo,
        unitId: termo.siengeUnitId || "",
        costCenterId: costCenterId,
        enterpriseId: costCenterId,
        unitName: unitName
      };
      const siengeTag = termo.siengeTag || FIN_TERMO_SIENGE_TAG;
      const resultado = await window.anexosUploadUnitAttachment({
        file: file,
        tagLabel: siengeTag,
        dateIso: termo.documentDate,
        costCenterId: costCenterId,
        unitName: unitName,
        sale: sale,
        context: "financiamento"
      });
      termo.siengeSentAt = new Date().toISOString();
      termo.siengeFileName = resultado.fileName || file.name;
      termo.siengeUnitId = resultado.unitId || "";
      termo.siengeTag = siengeTag;
      proc.updatedAt = termo.siengeSentAt;
      this.saveProcess(proc);
      FinanciamentoState.process = proc;
      this.render();
      return true;
    } catch (e) {
      const status = document.getElementById("fin-termo-send-st-" + termoId);
      if (status) status.textContent = (e && e.message) || "Não foi possível enviar o termo ao Sienge.";
      console.error("[Financiamento] envio do termo ao Sienge", e);
      return false;
    } finally {
      this._enviosTermo.delete(String(termoId));
      const atual = document.getElementById("fin-termo-env-" + termoId);
      if (atual && atual.textContent === "Enviando…") { atual.disabled = false; atual.textContent = "Enviar para o Sienge"; }
    }
  },

  salvarNota(stageId) {
    if (this._notaTimer) clearTimeout(this._notaTimer);
    const gravou = this.fixarNota(stageId);
    if (!gravou) {
      const st = document.getElementById("fin-nota-st-" + stageId);
      if (st) st.textContent = "Escreva uma anotação antes de salvar.";
      return;
    }
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    this.render();
    const st = document.getElementById("fin-nota-st-" + stageId);
    if (st) st.textContent = "Anotação salva no histórico. Você pode registrar outra.";
    window.requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
  },

  etapaFluxoHtml(proc, etapa, indice, encerrada) {
    if (!etapa) return '<p style="color:#64748b;">Nenhuma etapa cadastrada. Cadastre em Financiamento → Configurações.</p>';
    const stageId = String(etapa.id);
    const sid = stageId.replace(/[^a-zA-Z0-9_-]/g, "");
    const atual = !encerrada && String(proc.currentStageId || "") === stageId;
    const numero = etapa.prefix || String(indice + 1);
    const nome = etapa.nome || etapa.label || "Etapa";
    const config = (window.EtapasFinanciamentoState || []).find((item) => String(item.id) === stageId) || {};
    const descricao = String(config.descricao || config.explicacao || etapa.descricao || "").trim();
    const orientacao = `<div class="fin-etapa-orientacao">
      <strong>Informações desta etapa</strong>
      <p>${this.esc(descricao || "Registre as informações na nota interna e anexe os documentos necessários para esta etapa.")}</p>
    </div>`;
    const status = encerrada ? "Financiamento concluído" : (atual ? "Etapa atual" : "A iniciar");
    const statusClasse = encerrada ? "is-feita" : (atual ? "is-atual" : "is-espera");
    const dataConclusao = this.concluidaEm(proc, stageId) || (proc.done && proc.done[stageId]) || "";
    const desde = atual && proc.done && proc.done[stageId] ? " · desde " + this.fmtDate(proc.done[stageId]) : "";
    const desfazer = (atual || encerrada) && this.podeDesfazer(proc)
      ? `<button type="button" class="btn btn-outline btn-sm" onclick="FinanciamentoApp.desfazerAvanco()">Desfazer avanço</button>`
      : "";
    const acao = atual
      ? `<button type="button" class="btn btn-primary btn-sm" id="fin-concluir-${sid}" onclick="FinanciamentoApp.concluirEtapa('${sid}')">Concluir etapa</button>`
      : (encerrada ? "" : `<button type="button" class="btn btn-primary btn-sm" onclick="FinanciamentoApp.iniciarEtapa('${sid}')">Iniciar etapa</button>`);
    const classe = encerrada ? "is-feita" : (atual ? "is-atual" : "is-espera");
    const cabecalho = `<div class="fin-etapa-linha">
      <div class="fin-etapa-titulo">
        <span class="fin-etapa-sinal" aria-label="Etapa ${this.esc(numero)}">${this.esc(numero)}</span>
        <div>
          <div class="fin-etapa-nome">${this.esc(nome)}</div>
          <div class="fin-etapa-meta">${encerrada
            ? this.esc(dataConclusao ? "Concluída em " + this.fmtDate(dataConclusao) : "Etapa concluída")
            : this.esc((etapa.dias || 0) + " dias" + desde)}</div>
        </div>
      </div>
      <span class="fin-etapa-status ${statusClasse}">${status}</span>
      <div class="fin-etapa-acoes">${desfazer}${acao}</div>
    </div>`;
    if (!atual) {
      const historico = this.historicoHtml(proc, stageId);
      return `<div class="fin-etapa ${classe}">
        ${cabecalho}
        <div class="fin-etapa-corpo">
          ${orientacao}
          ${historico
            ? `<section class="fin-nota-historico" aria-label="Histórico desta etapa (somente leitura)"><strong>Histórico desta etapa</strong>${historico}</section>`
            : (encerrada ? "" : '<p class="fin-etapa-aguardando">Inicie esta etapa para registrar notas e anexar documentos.</p>')}
        </div>
      </div>`;
    }
    const notasEtapa = this.listaNotas(proc, stageId);
    const rascunho = notasEtapa.filter((nota) => nota.rascunho).pop() || {};
    const historicoNotas = this.notasEtapaHtml(proc, stageId);
    const tipoGerador = this.ehEtapaDeclaracaoSaldo(stageId, indice) ? "declaracao"
      : (this.ehEtapaTermoSaldo(stageId, indice) ? "termo" : "");
    const termoGerar = tipoGerador ? this.termoGerarHtml(sid, tipoGerador) : "";
    const termoGerado = this.termosEtapaHtml(proc, stageId);
    return `<div class="fin-etapa ${classe}">
      ${cabecalho}
      <div class="fin-etapa-corpo">
        ${orientacao}
        ${termoGerar}
        ${termoGerado}
        <div class="fin-nota">
          <label for="fin-nota-${sid}">Nota interna</label>
          <textarea id="fin-nota-${sid}" rows="2" placeholder="Registre a informação desta etapa">${this.esc(rascunho.texto || "")}</textarea>
          <div class="fin-nota-linha">
            <div>
              <label for="fin-nota-data-${sid}">Data</label>
              <input type="date" id="fin-nota-data-${sid}" value="${this.esc(String(rascunho.data || "").slice(0, 10))}">
            </div>
            <button type="button" class="btn btn-primary btn-sm" onclick="FinanciamentoApp.salvarNota('${sid}')">Salvar nota</button>
            <p id="fin-nota-st-${sid}" class="fin-nota-st"></p>
          </div>
          ${historicoNotas}
        </div>
        <div class="fin-anexo">
          <div class="fin-anexo-arquivo">
            <label class="fin-anexo-label" for="fin-arq-${sid}">Anexar arquivo</label>
            <input type="file" id="fin-arq-${sid}" multiple>
          </div>
          <div id="fin-tag-box-${sid}" class="fin-tag-box"></div>
          <button type="button" class="btn btn-primary btn-sm" id="fin-env-${sid}" onclick="FinanciamentoApp.enviarAnexo('${sid}')">Enviar para a unidade</button>
          <p style="margin:0;flex-basis:100%;color:#64748b;font-size:0.75rem;">É possível anexar vários documentos nesta etapa. Escolha os arquivos ou cole com Ctrl+V.</p>
          <p id="fin-st-${sid}" style="margin:0;flex-basis:100%;color:#b45309;font-size:0.78rem;"></p>
        </div>
      </div>
    </div>`;
  },

  fluxoHtml() {
    const proc = FinanciamentoState.process || {};
    const customer = (FinanciamentoState.selected && FinanciamentoState.selected.customer) || FinanciamentoState.customer || {};
    const obra = this.obraDoProc(proc);
    const catalog = typeof window.buildFinanciamentoStageCatalog === "function"
      ? window.buildFinanciamentoStageCatalog()
      : [];
    const etapas = catalog.length ? catalog : (window.EtapasFinanciamentoState || []).map((e, i) => ({
      id: e.id, label: (i + 1) + ". " + e.nome, nome: e.nome, dias: e.dias, hasChildren: false
    }));
    const folhas = this.folhasEtapa(etapas);
    const ativoIdx = this.indiceAtivo(proc, folhas);
    const saldo = proc.saldoQuitacaoSistema != null && String(proc.saldoQuitacaoSistema).trim() !== "" && Number.isFinite(Number(proc.saldoQuitacaoSistema))
      ? Number(proc.saldoQuitacaoSistema) : null;
    const credito = proc.valorLiberadoCaixa != null && String(proc.valorLiberadoCaixa).trim() !== "" && Number.isFinite(Number(proc.valorLiberadoCaixa))
      ? Number(proc.valorLiberadoCaixa) : null;
    this.sincronizarValorComercialCalculado(proc);
    const calcComercial = this.calcularValorComercialPorMetragem(proc);
    const valorComercial = this.valorComercialFicha(proc);
    const metragem = proc.metragemLote != null && String(proc.metragemLote).trim() !== "" && Number.isFinite(Number(proc.metragemLote))
      ? Number(proc.metragemLote) : null;
    const detalheValorComercial = calcComercial
      ? ("Metragem " + this.fmtMetragemFin(calcComercial.metragem) + " m² × R$ "
        + Number(calcComercial.valorM2).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        + "/m² (tabela 2026)")
      : (valorComercial != null
        ? "Informado no termo de simulação / declaração"
        : "Será calculado com a metragem × m² 2026 da tabela Comercial");
    const metragemTexto = metragem != null
      ? (this.fmtMetragemFin(metragem) + " m²")
      : (proc.metragemLoteCarregando ? "Consultando…" : "—");
    const metragemTitulo = metragem != null
      ? (this.fmtMetragemFin(metragem) + " m²")
      : (proc.metragemLoteErro || "Metragem cadastrada na unidade no Sienge");
    const concluidas = ativoIdx < 0 ? folhas.length : ativoIdx;
    const etapaAtual = ativoIdx >= 0 ? (folhas[ativoIdx].label || folhas[ativoIdx].nome) : (this.isProcessoConcluido(proc) ? "Financiamento concluído" : "Aguardando primeira etapa");
    const etapaExibidaIdx = ativoIdx >= 0 ? ativoIdx : folhas.length - 1;
    const etapaExibida = etapaExibidaIdx >= 0 ? folhas[etapaExibidaIdx] : null;
    const etapaAtualId = ativoIdx >= 0 && etapaExibida
      && String(proc.currentStageId || "") === String(etapaExibida.id) ? etapaExibida.id : "";
    const etapaHtml = this.etapaFluxoHtml(proc, etapaExibida, etapaExibidaIdx, ativoIdx < 0);
    const historicoProcesso = this.historicoProcessoHtml(proc, folhas, etapaAtualId);
    const progresso = folhas.map((etapa, idx) => {
      const estado = ativoIdx < 0 || idx < ativoIdx ? "is-feita" : (idx === ativoIdx ? "is-atual" : "is-espera");
      const numero = etapa.prefix || String(idx + 1);
      const estadoTexto = estado === "is-feita" ? "concluída" : (estado === "is-atual" ? "atual" : "aguardando");
      return `<span class="fin-stage-chip ${estado}" title="Etapa ${this.esc(numero)} · ${estadoTexto}" aria-label="Etapa ${this.esc(numero)} ${estadoTexto}">
        <span class="fin-stage-chip-num" aria-hidden="true">${this.esc(numero)}</span>
        ${this.esc(etapa.nome || etapa.label)}
      </span>`;
    }).join("");
    const clienteNome = customer.name || customer.nome || proc.customerName || "—";
    const unidade = this.formatUnidade(proc.unit || proc.unitName || "—");
    const responsavel = proc.responsavelNome || proc.responsavel || proc.assignedToName || proc.assignedTo || "Não informado";
    return `
      <div style="margin-bottom:16px;">
        <button type="button" class="btn btn-outline" onclick="FinanciamentoApp.voltarBusca()">
          <i data-lucide="arrow-left" style="width:14px;height:14px;"></i> ${FinanciamentoState.painel === "esteira" ? "Voltar à esteira" : "Voltar à pesquisa"}
        </button>
      </div>
      <section class="fin-visao-geral" aria-label="Resumo do financiamento">
        <div class="fin-visao-identificacao">
          <div>
            <h2>${this.esc(clienteNome)}</h2>
            <p>${this.esc(obra.empreendimento)} · Unidade ${this.esc(unidade)}</p>
            <span class="fin-visao-contrato">Título ${this.esc(proc.titulo || "—")}</span>
          </div>
          <span class="fin-visao-status ${this.isProcessoConcluido(proc) ? "is-concluido" : "is-andamento"}">${this.isProcessoConcluido(proc) ? "Concluído" : "Em andamento"}</span>
        </div>
        <div class="fin-visao-valores">
          <article class="fin-visao-kpi">
            <span>Saldo de quitação</span>
            <strong>${saldo == null ? (proc.saldoQuitacaoCarregando ? "Consultando…" : "—") : this.esc(this.fmtMoney(saldo))}</strong>
            <small>${saldo != null ? "Consultado no Sienge" : this.esc(proc.saldoQuitacaoErro || "Valor presente do título")}</small>
            ${proc.saldoQuitacaoErro ? '<button type="button" class="btn btn-outline btn-sm" onclick="FinanciamentoApp.atualizarSaldoQuitacao()">Tentar novamente</button>' : ""}
          </article>
          <article class="fin-visao-kpi">
            <span>Valor comercial</span>
            <strong>${valorComercial == null ? "—" : this.esc(this.fmtMoney(valorComercial))}</strong>
            <small>${this.esc(detalheValorComercial)}</small>
          </article>
          <article class="fin-visao-kpi">
            <span>Crédito liberado pela CAIXA</span>
            <strong>${credito == null ? "Aguardando Carta SIOPI" : this.esc(this.fmtMoney(credito))}</strong>
            <small>${credito != null ? "Identificado na Carta SIOPI" : this.esc(proc.valorLiberadoCaixaErro || "Será preenchido ao anexar a Carta SIOPI")}</small>
          </article>
          <article class="fin-visao-kpi fin-visao-etapa">
            <span>Etapa atual</span>
            <strong>${this.esc(etapaAtual)}</strong>
            <small>Responsável: ${this.esc(responsavel)}</small>
          </article>
        </div>
        <div class="fin-visao-fluxo">
          <div class="fin-visao-fluxo-titulo"><strong>Progresso das etapas</strong><span>${concluidas} de ${folhas.length} concluídas</span></div>
          <div class="fin-stage-chips">${progresso || '<span class="fin-stage-chip is-espera">Etapas não cadastradas</span>'}</div>
        </div>
      </section>
      <details class="fin-dados-completos">
        <summary>Ver dados completos do contrato e do cliente</summary>
        <div class="fin-dados-completos-conteudo">
          <div class="crm-card" style="margin-bottom:16px;">
            <div class="crm-card-header" style="background:#f3f4f6;padding:12px 20px;border-bottom:1px solid #e5e7eb;border-radius:8px 8px 0 0;">
              <h3 style="margin:0;font-size:1.1rem;color:var(--color-primary);">Dados do contrato</h3>
            </div>
            <div class="crm-card-content">
              <div class="cessao-customer-grid">
                <div class="cessao-customer-field cessao-customer-field--wide" title="${this.esc(obra.empresa)}"><span class="cessao-lbl">Empresa</span><span class="cessao-val">${this.esc(obra.empresa)}</span></div>
                <div class="cessao-customer-field cessao-customer-field--wide" title="${this.esc(obra.empreendimento)}"><span class="cessao-lbl">Empreendimento</span><span class="cessao-val">${this.esc(obra.empreendimento)}</span></div>
                <div class="cessao-customer-field" title="${this.esc(proc.contractNumber || "—")}"><span class="cessao-lbl">Contrato</span><span class="cessao-val">${this.esc(proc.contractNumber || "—")}</span></div>
                <div class="cessao-customer-field" title="${this.esc(proc.titulo || "—")}"><span class="cessao-lbl">Título</span><span class="cessao-val">${this.esc(proc.titulo || "—")}</span></div>
                <div class="cessao-customer-field" title="${this.esc(unidade)}"><span class="cessao-lbl">Unidade</span><span class="cessao-val">${this.esc(unidade)}</span></div>
                <div class="cessao-customer-field" title="${this.esc(metragemTitulo)}"><span class="cessao-lbl">Metragem do lote</span><span class="cessao-val">${this.esc(metragemTexto)}</span></div>
              </div>
            </div>
          </div>
          <div class="crm-card">
            <div class="crm-card-header" style="background:#f3f4f6;padding:12px 20px;border-bottom:1px solid #e5e7eb;border-radius:8px 8px 0 0;">
              <h3 style="margin:0;font-size:1.1rem;color:var(--color-primary);">Dados do cliente</h3>
            </div>
            <div class="crm-card-content">${this.customerCardHtml(customer)}</div>
          </div>
        </div>
      </details>
      <div class="crm-card">
        <div class="crm-card-header" style="background:#f3f4f6;padding:12px 20px;border-bottom:1px solid #e5e7eb;border-radius:8px 8px 0 0;">
          <h3 style="margin:0;font-size:1.05rem;color:var(--color-primary);">Etapa atual do financiamento</h3>
        </div>
        <div class="crm-card-content">
          <style>
            #financiamento-root .fin-visao-geral { background: #f1f5f4; border: 1px solid #e2e8f0; border-radius: 16px; padding: 14px; margin-bottom: 16px; }
            #financiamento-root .fin-visao-identificacao { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 4px 4px 14px; }
            #financiamento-root .fin-visao-identificacao h2 { margin: 0; color: #0f172a; font-size: 1.15rem; }
            #financiamento-root .fin-visao-identificacao p { margin: 4px 0; color: #334155; font-size: 0.88rem; font-weight: 700; }
            #financiamento-root .fin-visao-contrato { color: #64748b; font-size: 0.75rem; }
            #financiamento-root .fin-visao-status { flex: 0 0 auto; border-radius: 999px; padding: 5px 10px; font-size: 0.72rem; font-weight: 800; }
            #financiamento-root .fin-visao-status.is-andamento { background: #fef3c7; color: #92400e; }
            #financiamento-root .fin-visao-status.is-concluido { background: #dcfce7; color: #166534; }
            #financiamento-root .fin-visao-valores { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
            #financiamento-root .fin-visao-kpi { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; min-width: 0; min-height: 88px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; }
            #financiamento-root .fin-visao-kpi > span { color: #64748b; font-size: 0.72rem; font-weight: 700; }
            #financiamento-root .fin-visao-kpi > strong { color: #0f172a; font-size: 1rem; line-height: 1.25; overflow-wrap: anywhere; }
            #financiamento-root .fin-visao-kpi > small { color: #64748b; font-size: 0.69rem; line-height: 1.35; overflow-wrap: anywhere; }
            #financiamento-root .fin-visao-kpi > .btn { margin-top: 3px; }
            #financiamento-root .fin-visao-etapa > strong { color: #a16207; }
            #financiamento-root .fin-visao-fluxo { margin-top: 12px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; }
            #financiamento-root .fin-visao-fluxo-titulo { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 10px; color: #334155; font-size: 0.75rem; }
            #financiamento-root .fin-visao-fluxo-titulo span { color: #64748b; }
            #financiamento-root .fin-stage-chips { display: flex; flex-wrap: wrap; gap: 7px; }
            #financiamento-root .fin-stage-chip { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; padding: 5px 9px 5px 6px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; line-height: 1.2; }
            #financiamento-root .fin-stage-chip-num { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; min-width: 22px; height: 22px; padding: 0 4px; box-sizing: border-box; border-radius: 999px; background: rgba(255,255,255,.82); font-size: 0.68rem; font-variant-numeric: tabular-nums; }
            #financiamento-root .fin-stage-chip.is-feita { background: #dcfce7; color: #166534; }
            #financiamento-root .fin-stage-chip.is-atual { background: #fef3c7; color: #92400e; box-shadow: inset 0 0 0 1px #f59e0b; }
            #financiamento-root .fin-stage-chip.is-espera { background: #e2e8f0; color: #475569; }
            #financiamento-root .fin-etapa-orientacao { margin: 0 0 12px; padding: 11px 13px; border: 1px solid #dbeafe; border-left: 4px solid #0ea5e9; border-radius: 8px; background: #f8fbff; }
            #financiamento-root .fin-etapa-orientacao strong { display: block; margin-bottom: 4px; color: #0f3d5e; font-size: 0.78rem; }
            #financiamento-root .fin-etapa-orientacao p, #financiamento-root .fin-etapa-aguardando { margin: 0; color: #475569; font-size: 0.8rem; line-height: 1.45; }
            #financiamento-root .fin-etapa-aguardando { margin-top: 10px; }
            #financiamento-root .fin-historico { margin-top: 14px; padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; }
            #financiamento-root .fin-historico h4 { margin: 0 0 6px; color: var(--color-primary); font-size: 0.95rem; }
            #financiamento-root .fin-historico-item { display: grid; grid-template-columns: minmax(100px, 140px) minmax(0, 1fr); gap: 5px 12px; padding: 10px 0; border-bottom: 1px solid #eef2f7; }
            #financiamento-root .fin-historico-item:last-child { border-bottom: 0; }
            #financiamento-root .fin-historico-data { color: #0f172a; font-size: 0.8rem; font-weight: 800; }
            #financiamento-root .fin-historico-meta { color: #64748b; font-size: 0.72rem; font-weight: 700; }
            #financiamento-root .fin-historico-item p { margin: 4px 0 0; color: #334155; font-size: 0.8rem; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
            #financiamento-root .fin-historico-termos { padding-top: 10px; border-top: 1px solid #eef2f7; }
            #financiamento-root .fin-dados-completos { margin-bottom: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; }
            #financiamento-root .fin-dados-completos > summary { padding: 11px 14px; color: #334155; font-size: 0.82rem; font-weight: 700; cursor: pointer; }
            #financiamento-root .fin-dados-completos-conteudo { padding: 0 12px 12px; }
            #financiamento-root .fin-etapa { border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 6px; background: #fff; }
            #financiamento-root .fin-etapa.is-atual { border-color: #f59e0b; background: #fffbeb; box-shadow: inset 4px 0 0 #f59e0b; }
            #financiamento-root .fin-etapa.is-feita { border-color: #86efac; background: #f0fdf4; box-shadow: inset 4px 0 0 #22c55e; }
            #financiamento-root .fin-etapa.is-espera { background: #f8fafc; }
            #financiamento-root .fin-etapa-linha { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; }
            #financiamento-root .fin-etapa-titulo { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
            #financiamento-root .fin-etapa-sinal { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; min-width: 26px; height: 26px; padding: 0 4px; box-sizing: border-box; margin-top: 1px; border-radius: 999px; background: #e2e8f0; color: #475569; font-size: 0.68rem; font-weight: 800; font-variant-numeric: tabular-nums; }
            #financiamento-root .fin-etapa.is-feita .fin-etapa-sinal { background: #22c55e; color: #fff; }
            #financiamento-root .fin-etapa.is-atual .fin-etapa-sinal { background: #f59e0b; color: #fff; }
            #financiamento-root .fin-etapa-nome { font-weight: 700; color: #0f172a; font-size: 0.9rem; }
            #financiamento-root .fin-etapa-meta { font-size: 0.75rem; color: #64748b; margin-top: 2px; }
            #financiamento-root .fin-etapa-status { flex: 0 0 auto; border-radius: 999px; padding: 3px 8px; font-size: 0.65rem; font-weight: 800; }
            #financiamento-root .fin-etapa-status.is-feita { background: #dcfce7; color: #166534; }
            #financiamento-root .fin-etapa-status.is-atual { background: #fef3c7; color: #92400e; }
            #financiamento-root .fin-etapa-status.is-espera { background: #e2e8f0; color: #475569; }
            #financiamento-root .fin-etapa-acoes { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
            #financiamento-root .fin-etapa-acoes .btn,
            #financiamento-root .fin-nota-linha .btn,
            #financiamento-root .fin-anexo > .btn { display: inline-flex; align-items: center; justify-content: center; height: 40px; box-sizing: border-box; padding: 0 12px; margin: 0; line-height: 1; white-space: nowrap; }
            #financiamento-root .fin-nota-linha input[type="date"],
            #financiamento-root .fin-anexo-arquivo input[type="file"] { height: 40px; box-sizing: border-box; }
            #financiamento-root .fin-etapa-nota { margin: 0; padding: 0 12px 6px; color: #334155; font-size: 0.78rem; white-space: pre-wrap; line-height: 1.4; }
            #financiamento-root .fin-etapa-corpo { padding: 0 12px 12px; }
            #financiamento-root .fin-grupo { margin: 14px 0 6px; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: #64748b; }
            #financiamento-root .fin-nota label { display: block; font-size: 0.72rem; font-weight: 700; color: #64748b; margin-bottom: 4px; }
            #financiamento-root .fin-nota textarea { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; font: inherit; background: #fff; min-height: 52px; resize: vertical; }
            #financiamento-root .fin-nota-linha { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin-top: 8px; }
            #financiamento-root .fin-anexo { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin-top: 10px; }
            #financiamento-root .fin-anexo-arquivo { display:flex; flex:0 1 260px; flex-direction:column; min-width:220px; max-width:260px; }
            #financiamento-root .fin-anexo-label { display:block; margin-bottom:6px; color:#64748b; font-size:0.7rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; }
            #financiamento-root .fin-anexo-arquivo input[type="file"] { width:100%; max-width:none; padding:0; font-size:0.8rem; }
            #financiamento-root .fin-tag-box { flex: 1 1 260px; min-width: 240px; max-width: 420px; }
            #financiamento-root .fin-tag-box .ml-emp-filter { width: 100%; }
            #financiamento-root .fin-tag-box .ml-emp-filter-btn { height:40px; min-height:40px; box-sizing:border-box; }
            #financiamento-root .fin-nota input[type="date"] { height: 40px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0 8px; background: #fff; font: inherit; }
            #financiamento-root .fin-nota-st { margin: 0; color: #105436; font-size: 0.78rem; font-weight: 700; }
            #financiamento-root .fin-nota-historico { display:flex; flex-direction:column; gap:8px; margin-top:12px; padding:10px 12px; border:1px solid #e2e8f0; border-radius:8px; background:#fff; }
            #financiamento-root .fin-nota-historico > strong { color:#334155; font-size:0.78rem; }
            #financiamento-root .fin-nota-historico-item { display:grid; grid-template-columns:minmax(90px,120px) minmax(0,1fr); gap:8px; padding:8px 0; border-top:1px solid #eef2f7; }
            #financiamento-root .fin-nota-historico-item time { color:#64748b; font-size:0.75rem; font-weight:700; }
            #financiamento-root .fin-nota-historico-item p { margin:0; color:#334155; font-size:0.8rem; line-height:1.4; white-space:pre-wrap; overflow-wrap:anywhere; }
            #financiamento-root .fin-termo-gerar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:10px 0; }
            #financiamento-root .fin-termo-st { color:#64748b; font-size:0.78rem; }
            #financiamento-root .fin-termos-lista { display:flex; flex-direction:column; gap:8px; margin:10px 0; }
            #financiamento-root .fin-termos-lista > strong { color:#334155; font-size:0.78rem; }
            #financiamento-root .fin-termo-item { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:9px 10px; border:1px solid #e2e8f0; border-radius:8px; background:#fff; }
            #financiamento-root .fin-termo-item > div:first-child { display:flex; flex-direction:column; gap:3px; min-width:180px; }
            #financiamento-root .fin-termo-item strong { color:#0f172a; font-size:0.8rem; }
            #financiamento-root .fin-termo-item span { color:#64748b; font-size:0.73rem; }
            #financiamento-root .fin-termo-acoes { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
            #financiamento-root .fin-termo-enviado { color:#166534 !important; font-weight:700; }
            #financiamento-root .fin-termo-excluir { color:#b91c1c; border-color:#fecaca; }
            #financiamento-root .fin-termo-excluir:hover { color:#991b1b; border-color:#fca5a5; background:#fef2f2; }
            @media (max-width: 900px) { #financiamento-root .fin-visao-valores { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
            @media (max-width: 560px) {
              #financiamento-root .fin-visao-geral { padding: 10px; }
              #financiamento-root .fin-visao-identificacao { flex-direction: column; }
              #financiamento-root .fin-visao-valores { grid-template-columns: 1fr; }
              #financiamento-root .fin-etapa-linha { align-items: flex-start; flex-direction: column; }
              #financiamento-root .fin-etapa-linha > div:last-child { flex-wrap: wrap; }
              #financiamento-root .fin-historico-item { grid-template-columns: 1fr; gap: 3px; }
            }
          </style>
          <p style="margin:0 0 12px;color:#64748b;font-size:0.82rem;">Somente a etapa atual fica aberta para edição. Etapas concluídas ficam em somente leitura, com o histórico de notas e anexos. Quem concluiu pode desfazer o avanço no mesmo dia. O histórico do processo aparece abaixo, quando houver registros.</p>
          ${etapaHtml}
          ${historicoProcesso}
        </div>
      </div>`;
  }
};

window.FinanciamentoApp = FinanciamentoApp;

/* Junta os financiamentos deste navegador com os da nuvem. Fica o registro mais novo de cada contrato, sem apagar o outro. */
window.mergeFinanciamentosProc = function(localRaw, cloudRaw) {
  const ler = (raw) => {
    try {
      const o = JSON.parse(raw || "{}");
      return o && typeof o === "object" && !Array.isArray(o) ? o : {};
    } catch (e) {
      return {};
    }
  };
  const unirLista = (a, b) => {
    const itens = (lista) => {
      if (Array.isArray(lista)) return lista;
      if (lista && typeof lista === "object") return [lista];
      return [];
    };
    const chave = (item) => {
      if (item.id) return "id:" + String(item.id);
      if (item.fileName) return "arq:" + String(item.fileName) + "|" + String(item.em || "");
      if (item.texto) return "txt:" + String(item.texto).slice(0, 180) + "|" + String(item.data || "");
      return "em:" + String(item.em || "");
    };
    const out = [];
    const pos = {};
    [a, b].forEach((lista) => {
      itens(lista).forEach((item) => {
        if (!item || typeof item !== "object") return;
        const k = chave(item);
        if (pos[k] == null) {
          pos[k] = out.length;
          out.push(item);
          return;
        }
        const prev = out[pos[k]];
        const tp = Date.parse(prev.em || 0) || 0;
        const tn = Date.parse(item.em || 0) || 0;
        if (tn >= tp) out[pos[k]] = item;
      });
    });
    return out;
  };
  const unirMapa = (antigo, novo, porData) => {
    const out = Object.assign({}, antigo || {});
    Object.keys(novo || {}).forEach((id) => {
      const a = out[id];
      const b = novo[id];
      if (Array.isArray(a) || Array.isArray(b)) {
        out[id] = unirLista(a, b);
        return;
      }
      if (porData && a && b && typeof a === "object" && typeof b === "object") {
        const ta = Date.parse(a.em || 0) || 0;
        const tb = Date.parse(b.em || 0) || 0;
        out[id] = tb >= ta ? b : a;
        return;
      }
      if (porData && a && b && typeof a !== "object") {
        out[id] = String(a) <= String(b) ? a : b;
        return;
      }
      out[id] = b;
    });
    return out;
  };
  const local = ler(localRaw);
  const cloud = ler(cloudRaw);
  const chaves = {};
  Object.keys(local).forEach((k) => { chaves[k] = true; });
  Object.keys(cloud).forEach((k) => { chaves[k] = true; });
  const out = {};
  Object.keys(chaves).sort().forEach((k) => {
    const a = local[k];
    const b = cloud[k];
    if (!a || typeof a !== "object") { if (b) out[k] = b; return; }
    if (!b || typeof b !== "object") { out[k] = a; return; }
    const ta = Date.parse(a.updatedAt || a.startedAt || 0) || 0;
    const tb = Date.parse(b.updatedAt || b.startedAt || 0) || 0;
    const recente = tb > ta ? b : a;
    const antigo = recente === a ? b : a;
    const junto = Object.assign({}, antigo, recente);
    junto.done = unirMapa(antigo.done, recente.done, true);
    junto.concluidas = unirMapa(antigo.concluidas, recente.concluidas, true);
    junto.desfeitos = unirMapa(antigo.desfeitos, recente.desfeitos, true);
    junto.doneRevogados = unirMapa(antigo.doneRevogados, recente.doneRevogados, false);
    junto.anexos = unirMapa(antigo.anexos, recente.anexos, false);
    junto.notas = unirMapa(antigo.notas, recente.notas, true);
    const fechadas = Object.assign({}, (antigo && antigo.notasFechadas) || {});
    Object.keys((recente && recente.notasFechadas) || {}).forEach((id) => {
      const a = fechadas[id];
      const b = recente.notasFechadas[id];
      fechadas[id] = String(b || "") >= String(a || "") ? b : a;
    });
    junto.notasFechadas = fechadas;
    Object.keys(junto.notas || {}).forEach((id) => {
      const corte = Date.parse(fechadas[id] || 0) || 0;
      if (!corte) return;
      const lista = Array.isArray(junto.notas[id]) ? junto.notas[id] : [junto.notas[id]];
      junto.notas[id] = lista.filter((n) => n && (!n.rascunho || (Date.parse(n.em || 0) || 0) > corte));
    });
    const horaFin = (v) => Date.parse(v || 0) || 0;
    Object.keys(junto.desfeitos || {}).forEach((id) => {
      const d = junto.desfeitos[id];
      const maisNova = Math.max(
        horaFin(antigo.concluidas && antigo.concluidas[id]),
        horaFin(recente.concluidas && recente.concluidas[id])
      );
      if (maisNova > horaFin(d && d.em)) {
        delete junto.desfeitos[id];
        return;
      }
      if (junto.concluidas && junto.concluidas[id] && horaFin(d && d.em) >= horaFin(junto.concluidas[id])) {
        delete junto.concluidas[id];
      }
    });
    Object.keys(junto.doneRevogados || {}).forEach((id) => {
      const rev = horaFin(junto.doneRevogados[id]);
      const feitoAntigo = horaFin(antigo.done && antigo.done[id]);
      const feitoRecente = horaFin(recente.done && recente.done[id]);
      const maisNova = Math.max(feitoAntigo, feitoRecente);
      if (maisNova > rev) {
        delete junto.doneRevogados[id];
        junto.done = junto.done || {};
        junto.done[id] = maisNova === feitoRecente ? recente.done[id] : antigo.done[id];
        return;
      }
      if (junto.done && junto.done[id] && rev >= horaFin(junto.done[id])) delete junto.done[id];
    });
    const statusConcluido = (p) => {
      const s = String((p && p.status) || "").toLowerCase();
      return s === "concluido" || s === "concluída" || s === "completed" || s === "complete";
    };
    const antigoConcluido = statusConcluido(antigo) || !!(antigo.finishedAt && !antigo.closedAt);
    const recenteConcluido = statusConcluido(recente) || !!(recente.finishedAt && !recente.closedAt);
    if (recenteConcluido) {
      junto.status = recente.status || "concluido";
      junto.finishedAt = recente.finishedAt || antigo.finishedAt || "";
      delete junto.closedAt;
      delete junto.descartadoComoDuplicata;
    } else if (antigoConcluido) {
      const fin = Date.parse(antigo.finishedAt || antigo.updatedAt || 0) || 0;
      const undo = Object.keys(recente.desfeitos || {}).some((id) => {
        const em = recente.desfeitos[id] && recente.desfeitos[id].em;
        return (Date.parse(em || 0) || 0) >= fin;
      });
      if (undo && !recente.finishedAt && !statusConcluido(recente)) {
        delete junto.finishedAt;
        if (statusConcluido(junto)) junto.status = "";
      } else {
        junto.status = antigo.status || "concluido";
        junto.finishedAt = antigo.finishedAt || "";
        delete junto.closedAt;
        delete junto.descartadoComoDuplicata;
      }
    } else {
      delete junto.finishedAt;
    }
    const descartadoDe = (p) => !!(p && (p.descartadoComoDuplicata || (String(p.status || "").toLowerCase() === "cancelado" && p.closedAt)));
    if (descartadoDe(recente) || descartadoDe(antigo)) {
      const origem = descartadoDe(recente) && (!descartadoDe(antigo)
        || (Date.parse(recente.descartadoEm || recente.updatedAt || 0) || 0)
          >= (Date.parse(antigo.descartadoEm || antigo.updatedAt || 0) || 0))
        ? recente : antigo;
      junto.status = "cancelado";
      junto.closedAt = origem.closedAt || origem.descartadoEm || origem.updatedAt || new Date().toISOString();
      junto.descartadoComoDuplicata = true;
      junto.descartadoEm = origem.descartadoEm || junto.closedAt;
      junto.descartadoMotivo = origem.descartadoMotivo || "duplicata";
      junto.finishedAt = "";
    }
    if (!junto.currentStageId) junto.currentStageId = antigo.currentStageId || recente.currentStageId || null;
    if (!junto.customerName) junto.customerName = antigo.customerName || recente.customerName || "";
    if (!junto.titulo) junto.titulo = antigo.titulo || recente.titulo || "";
    if (!junto.contractNumber) junto.contractNumber = antigo.contractNumber || recente.contractNumber || "";
    out[k] = junto;
  });
  return JSON.stringify(out);
};

/* O que está neste navegador agora, inclusive o financiamento aberto que o disco ainda não segurou. */
window.financiamentosProcAtual = function () {
  if (window.FinanciamentoApp && typeof window.FinanciamentoApp.loadAllProcesses === "function") {
    try { return JSON.stringify(window.FinanciamentoApp.loadAllProcesses() || {}); }
    catch (e) {}
  }
  try { return localStorage.getItem(FIN_PROC_KEY) || "{}"; }
  catch (e2) { return "{}"; }
};

window.addEventListener("beforeunload", function () {
  const proc = FinanciamentoState.process;
  const app = window.FinanciamentoApp;
  if (!proc || !app) return;
  if (proc.currentStageId && typeof app.persistirRascunho === "function") app.persistirRascunho(proc.currentStageId);
  else app.saveProcess(proc);
});

document.addEventListener("tabChanged", (e) => {
  if (e.detail === "financiamento") FinanciamentoApp.init();
});

document.addEventListener("DOMContentLoaded", function () {
  let tentativas = 0;
  const tentar = function () {
    tentativas += 1;
    const app = window.FinanciamentoApp;
    if (!app || typeof app.agendarAlertaEsteira !== "function" || !app.usuarioVeAlertaEsteira()) {
      if (tentativas < 20) setTimeout(tentar, 1000);
      return;
    }
    app.agendarAlertaEsteira();
  };
  setTimeout(tentar, 2000);
});
