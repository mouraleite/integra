/* Realizado pela regra do Integra, para as telas vindas do ML Órion.
 * É a mesma regra da DFC do Integra (orcamento-dfc.js / fluxo-caixa.js): caixa e bancos do Sienge pela data do
 * movimento, rateado pelos planos do movimento, só as contas da visão DFC, com o sinal da DFC (entradas +, saídas -).
 * Diferença: aqui cada empresa entra 100% (sem o % de consolidação MLDU), porque o orçamento é por empresa/centro de custo.
 * Só leitura: busca no Sienge pelo proxy do Integra; não grava nada. */
const OrionRealizado = {
  _cache: {},

  modulos() {
    const fluxo = window.FluxoCaixaApp || (typeof FluxoCaixaApp !== "undefined" ? FluxoCaixaApp : null);
    const dfc = window.OrcamentoDfcApp || (typeof OrcamentoDfcApp !== "undefined" ? OrcamentoDfcApp : null);
    if (!fluxo || typeof fluxo.buscarMovimentos !== "function" || typeof fluxo.allocate !== "function" || typeof fluxo.signedAmount !== "function" || !dfc || typeof dfc.grupoDaConta !== "function") {
      throw new Error("A consulta de caixa e banco do Integra não está disponível nesta página.");
    }
    return { fluxo, dfc };
  },

  /** Último mês completo do ano (1..12), ou 0 se o ano ainda não começou. */
  ateMes(ano) {
    const hoje = new Date();
    if (Number(ano) < hoje.getFullYear()) return 12;
    if (Number(ano) > hoje.getFullYear()) return 0;
    return hoje.getMonth();
  },

  grupos() {
    const { fluxo, dfc } = this.modulos();
    return (fluxo.visao && fluxo.visao() && fluxo.visao().groups) || (dfc.visaoDfc && dfc.visaoDfc().groups) || [];
  },

  /** Grupo da DFC do Integra para um plano (código do Sienge), ou null se a conta está fora da visão. */
  grupoDe(plano) {
    const { dfc } = this.modulos();
    return dfc.grupoDaConta(String(plano || ""), "") || null;
  },

  /** Empresas dos centros de custo informados (cadastro de Centros de Custo do Integra). */
  empresasDosCcs(ccs) {
    const set = new Set((ccs || []).map((c) => String(c).replace(/\D/g, "")));
    const catalogo = (window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || [];
    return [...new Set(catalogo.filter((c) => set.has(String(c.id).replace(/\D/g, ""))).map((c) => String(c.idCompany != null ? c.idCompany : c.companyId || "")).filter(Boolean))];
  },

  /**
   * Alocações do realizado de jan até "ate" do ano: [{ cc, plano, gid, mes, valor (R$ com o sinal da DFC), empresa }].
   * Guarda em memória por (ano, ate, empresas) durante a sessão; forcar = true busca de novo.
   */
  async buscar(ano, ate, empresas, forcar) {
    const { fluxo, dfc } = this.modulos();
    const emp = [...new Set((empresas || []).map(String).filter(Boolean))].sort();
    if (!emp.length) throw new Error("Nenhuma empresa para consultar o realizado.");
    if (!(ate >= 1)) return { alocacoes: [], movimentos: 0, empresas: emp, ate: 0 };
    const chave = `${ano}|${ate}|${emp.join(",")}`;
    if (!forcar && this._cache[chave]) return this._cache[chave];
    if (typeof fluxo.ensureCategories === "function") await fluxo.ensureCategories();
    const byId = {};
    this.grupos().forEach((g) => { if (g && g.id) byId[g.id] = g; });
    const ultimo = new Date(Number(ano), ate, 0).getDate();
    const movs = await fluxo.buscarMovimentos(`${ano}-01-01`, `${ano}-${String(ate).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`, emp);
    const alocacoes = [];
    for (let n = 0; n < (movs || []).length; n++) {
      const mov = movs[n];
      (fluxo.allocate(mov, 1) || []).forEach((x) => {
        if (!x) return;
        const gid = dfc.grupoDaConta(x.categoryId, x.categoryName);
        const node = gid && byId[gid];
        if (!node) return; // conta fora da visão DFC (ex.: transferência): mesma regra da DFC do Integra
        const valor = fluxo.signedAmount(node, x.categoryId, x.categoryName, x.amount, x.reducer, x.categoryType, x.mov);
        if (!valor) return;
        alocacoes.push({
          cc: String(typeof fluxo.ccIdOf === "function" ? fluxo.ccIdOf(x.costCenterId) : x.costCenterId || "").replace(/\D/g, ""),
          plano: String(x.categoryId || "").replace(/\D/g, ""),
          gid, mes: Number(String(x.month || "").slice(5, 7)), valor, empresa: String(mov.companyId || ""), i: n
        });
      });
      if (n && n % 250 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    const out = { alocacoes, movimentos: (movs || []).length, empresas: emp, ate, lista: movs || [] };
    this._cache[chave] = out;
    return out;
  }
};

/** Linhas do realizado (pagamentos e recebimentos do caixa) de um resultado de buscar(), para o detalhe das telas.
 * filtro(alocacao) escolhe as alocações; sinal -1 mostra saídas como positivas. Só lê o que já está em memória. */
OrionRealizado.detalhe = function (res, filtro, sinal) {
  const s = sinal == null ? 1 : sinal;
  const lista = (res && res.lista) || [];
  return ((res && res.alocacoes) || []).filter(filtro).map((a) => {
    const m = lista[a.i] || {};
    return {
      data: String(m.bankMovementDate || m.paymentDate || m.date || "").slice(0, 10),
      credor: m.creditorName || (m.creditor && m.creditor.name) || m.customerName || "",
      documento: [m.documentIdentificationId || m.documentId, m.documentIdentificationNumber || m.documentNumber].filter(Boolean).join(" "),
      titulo: m.billId || "",
      parcela: m.installmentNumber || m.installmentId || "",
      empresa: a.empresa, cc: a.cc, plano: a.plano, mes: a.mes, valor: a.valor * s
    };
  }).sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : 0));
};
window.OrionRealizado = OrionRealizado;
