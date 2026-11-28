/* Documentos do interveniente quitante no financiamento.
   Etapa 1: termo de simulação do saldo devedor.
   Etapa 4: declaração de saldo devedor.
   Etapa 10: termo de quitação por financiamento.
   Os textos ficam em Configurações gerais → Documentos padrões. */
(function () {
  const CFG = {
    simiq: {
      titleId: "doc-simiq-title",
      corpoId: "doc-simiq-corpo",
      storage: "crm_docpadrao_simiq",
      defaultTitle: "TERMO DE SIMULAÇÃO DO SALDO DEVEDOR PARA EFEITOS DE INTERVENIENTE QUITANTE",
      arquivo: "Termo de simulação do saldo devedor",
      botao: "Gerar termo de simulação",
      dica: "Etapa 1. O saldo e as parcelas saem do Sienge. O PDF baixa aqui e fica pronto para enviar à unidade."
    },
    deciq: {
      titleId: "doc-deciq-title",
      corpoId: "doc-deciq-corpo",
      storage: "crm_docpadrao_deciq",
      defaultTitle: "DECLARAÇÃO DE SALDO DEVEDOR PARA EFEITOS DE INTERVENIENTE QUITANTE",
      arquivo: "Declaração de saldo devedor",
      botao: "Gerar declaração de saldo devedor",
      dica: "Etapa 4. Declara o saldo para a instituição financeira. A quitação sai na etapa 10."
    },
    quifin: {
      titleId: "doc-quifin-title",
      corpoId: "doc-quifin-corpo",
      storage: "crm_docpadrao_quifin",
      defaultTitle: "TERMO DE QUITAÇÃO POR FINANCIAMENTO",
      arquivo: "Termo de quitação por financiamento",
      botao: "Gerar termo de quitação por financiamento",
      dica: "Etapa 10. Usa o saldo declarado neste financiamento, ou o total recebido no título se o saldo já estiver zerado."
    }
  };

  function dinheiro(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "R$ 0,00";
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function extenso(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "";
    return typeof valorPorExtensoBRL === "function" ? valorPorExtensoBRL(v) : "";
  }

  function dataBr(raw) {
    const s = String(raw || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const p = s.split("-");
      return p[2] + "/" + p[1] + "/" + p[0];
    }
    return s || "—";
  }

  function numero(row, campo) {
    if (!row || row[campo] == null || row[campo] === "") return NaN;
    return Number(row[campo]);
  }

  function linhasSaldo(res) {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (Array.isArray(res.data)) return res.data;
    if (Array.isArray(res.results)) return res.results;
    return [];
  }

  function emAberto(row) {
    const atual = numero(row, "currentBalance");
    const saldo = Number.isFinite(atual) ? atual : numero(row, "balance");
    const vp = numero(row, "presentValue");
    return (Number.isFinite(saldo) && saldo > 0.009) || (Number.isFinite(vp) && vp > 0.009);
  }

  function tabelaParcelas(linhas) {
    if (!linhas.length) return "Não há parcelas em aberto neste título na data da consulta.";
    const cel = "border:1px solid #cbd5e1;padding:4px 6px;";
    const cab = "<tr>"
      + "<th style=\"" + cel + "text-align:left;\">Parcela</th>"
      + "<th style=\"" + cel + "text-align:left;\">Vencimento</th>"
      + "<th style=\"" + cel + "text-align:right;\">Valor original</th>"
      + "<th style=\"" + cel + "text-align:right;\">Saldo corrigido</th>"
      + "<th style=\"" + cel + "text-align:right;\">Valor presente</th>"
      + "</tr>";
    const corpo = linhas.map((row) => {
      const parc = row.installmentNumber || row.installmentId || "—";
      const orig = numero(row, "originalValue");
      const atual = numero(row, "currentBalance");
      const vp = numero(row, "presentValue");
      return "<tr>"
        + "<td style=\"" + cel + "\">" + parc + "</td>"
        + "<td style=\"" + cel + "\">" + dataBr(row.dueDate) + "</td>"
        + "<td style=\"" + cel + "text-align:right;\">" + (Number.isFinite(orig) ? dinheiro(orig) : "—") + "</td>"
        + "<td style=\"" + cel + "text-align:right;\">" + (Number.isFinite(atual) ? dinheiro(atual) : "—") + "</td>"
        + "<td style=\"" + cel + "text-align:right;\">" + (Number.isFinite(vp) ? dinheiro(vp) : "—") + "</td>"
        + "</tr>";
    }).join("");
    return "<table style=\"width:100%;border-collapse:collapse;font-size:10pt;margin:8px 0 12px;\">" + cab + corpo + "</table>";
  }

  function modelo(kind) {
    const cfg = CFG[kind];
    let salvo = {};
    try { salvo = JSON.parse(localStorage.getItem(cfg.storage) || "{}"); } catch (e) { salvo = {}; }
    const titleEl = document.getElementById(cfg.titleId);
    const corpoEl = document.getElementById(cfg.corpoId);
    const titulo = (titleEl && titleEl.value) || salvo[cfg.titleId] || cfg.defaultTitle;
    let corpo = (corpoEl && String(corpoEl.value || "").trim()) || salvo[cfg.corpoId] || (corpoEl && corpoEl.defaultValue) || "";
    return { cfg: cfg, titulo: titulo, corpo: String(corpo || "") };
  }

  const api = {
    numeroEtapa(etapa, indiceFolha) {
      const label = String((etapa && etapa.label) || "");
      const m = label.match(/^(\d+)\.\s+(\S)/);
      if (m && !/^\d/.test(m[2])) return parseInt(m[1], 10);
      return indiceFolha + 1;
    },

    docDaEtapa(etapa, indiceFolha) {
      if (indiceFolha < 0 || !etapa) return "";
      const n = this.numeroEtapa(etapa, indiceFolha);
      if (n === 1) return "simiq";
      if (n === 4) return "deciq";
      if (n === 10) return "quifin";
      return "";
    },

    botaoDocumentoEtapa(stageId, kind) {
      const cfg = CFG[kind];
      if (!cfg) return "";
      const sid = String(stageId).replace(/'/g, "");
      return `<div class="fin-doc">
        <button type="button" class="btn btn-primary btn-sm" id="fin-doc-${sid}" onclick="FinanciamentoApp.gerarDocumentoEtapa('${sid}')">${this.esc(cfg.botao)}</button>
        <p id="fin-doc-st-${sid}">${this.esc(cfg.dica)}</p>
      </div>`;
    },

    async contratoDoProc(proc) {
      const sel = FinanciamentoState.selected;
      if (sel && sel.contract && String(sel.contractId) === String(proc.contractId)) return sel.contract;
      const lista = FinanciamentoState.contracts || [];
      const local = lista.find((c) => String(c.id || c.contractId) === String(proc.contractId));
      if (local) return local;
      const svc = window.SiengeApiService;
      if (svc && typeof svc.getSales === "function" && proc.customerId) {
        try {
          const sales = await svc.getSales(proc.customerId);
          if (Array.isArray(sales)) {
            return sales.find((c) => String(c.id || c.contractId) === String(proc.contractId))
              || sales.find((c) => String(c.receivableBillId || c.billReceivableId) === String(proc.titulo))
              || null;
          }
        } catch (e) {
          console.warn("[Financiamento] contrato", e);
        }
      }
      return {
        id: proc.contractId,
        contractNumber: proc.contractNumber,
        receivableBillId: proc.titulo,
        customerId: proc.customerId,
        costCenterId: proc.costCenterId,
        enterpriseId: proc.empId,
        companyId: proc.companyId,
        unitName: proc.unitName || proc.unit,
        unitId: proc.unitId || ""
      };
    },

    async clienteDoProc(proc) {
      const sel = FinanciamentoState.selected;
      let c = (sel && String(sel.customerId) === String(proc.customerId) && sel.customer) || null;
      if (!c && FinanciamentoState.customer && String(FinanciamentoState.customer.id) === String(proc.customerId)) {
        c = FinanciamentoState.customer;
      }
      const svc = window.SiengeApiService;
      if ((!c || !c.name) && svc && typeof svc.getCustomer === "function") {
        try { c = await svc.getCustomer(proc.customerId); } catch (e) { c = c || null; }
      }
      if (!c) c = { id: proc.customerId, name: proc.customerName || "" };
      if (typeof window.enrichCustomerForLegalDocs === "function") {
        try { c = await window.enrichCustomerForLegalDocs(c); } catch (e) {}
      }
      if (!c.cpfCnpj) c.cpfCnpj = c.cpf || c.cnpj || "";
      return c;
    },

    async saldoDoTitulo(proc, sale, customer) {
      const svc = window.SiengeApiService;
      const billId = String(proc.titulo || sale.receivableBillId || sale.billReceivableId || "").trim();
      let linhas = [];
      if (svc && typeof svc.getCustomerDebtBalance === "function" && billId && billId !== "—") {
        try {
          const res = await svc.getCustomerDebtBalance(billId, { companyId: proc.companyId || sale.companyId });
          linhas = linhasSaldo(res).filter((row) => !row.billReceivableId || String(row.billReceivableId) === billId);
        } catch (e) {
          console.warn("[Financiamento] saldo", e);
        }
      }
      linhas = linhas.filter(emAberto);
      linhas.sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")));
      let presente = 0;
      let corrigido = 0;
      linhas.forEach((row) => {
        const vp = numero(row, "presentValue");
        const atual = numero(row, "currentBalance");
        const saldo = Number.isFinite(atual) ? atual : numero(row, "balance");
        if (Number.isFinite(vp)) presente += vp;
        if (Number.isFinite(saldo)) corrigido += saldo;
        else if (Number.isFinite(vp)) corrigido += vp;
      });
      if (!(presente > 0) && !(corrigido > 0) && svc && typeof svc.getTotalCurrentDebitBalance === "function") {
        const doc = String((customer && (customer.cpfCnpj || customer.cpf || customer.cnpj)) || "").replace(/\D/g, "");
        if (doc.length >= 11) {
          try {
            const tot = await svc.getTotalCurrentDebitBalance(doc, billId);
            presente = Number(tot && tot.presentValue) || 0;
            corrigido = Number(tot && (tot.totalBalance != null ? tot.totalBalance : tot.currentBalance)) || presente;
          } catch (e) {}
        }
      }
      return {
        linhas: linhas,
        presente: Math.round(presente * 100) / 100,
        corrigido: Math.round(corrigido * 100) / 100,
        billId: billId
      };
    },

    async valorPago(customer, sale) {
      const rel = window.RelacionamentoApp;
      if (!rel || typeof rel._valorPagoTitulo !== "function") return 0;
      try {
        const pago = await rel._valorPagoTitulo({ sale: sale, customer: customer, bill: null, adimplencia: null });
        return Number(pago) || 0;
      } catch (e) {
        return 0;
      }
    },

    async unidadeDoContrato(proc, sale) {
      const svc = window.SiengeApiService;
      const emp = proc.costCenterId || proc.empId || sale.enterpriseId || sale.costCenterId || "";
      const nome = String(sale.unitName || sale.unityName || proc.unitName || proc.unit || "").trim();
      let block = "";
      let lot = "";
      let area = "";
      let matricula = "";
      let unitId = sale.unitId || "";
      if (svc && unitId && typeof svc.getUnit === "function") {
        try {
          const u = await svc.getUnit(unitId);
          if (u) {
            if (u.block && u.block !== "N/D") block = u.block;
            if (u.lot && u.lot !== "N/D") lot = u.lot;
            area = u.privateArea || u.area || area;
          }
        } catch (e) {}
      }
      if (svc && typeof svc.getUnitDetails === "function" && emp && nome) {
        try {
          const det = await svc.getUnitDetails(emp, nome);
          const u = det && det.results && det.results[0];
          if (u) {
            matricula = u.legalRegistrationNumber || u.legalregistrationnumber || matricula;
            area = u.privateArea || u.Privatearea || area;
            unitId = unitId || u.id || "";
          }
        } catch (e) {}
      }
      if (!block || !lot) {
        const partes = nome.split("-").map((p) => p.trim()).filter(Boolean);
        if (partes.length >= 2) {
          block = block || partes[0];
          lot = lot || partes.slice(1).join("-");
        }
      }
      let areaLabel = "";
      if (area !== "" && area != null) {
        const n = Number(area);
        areaLabel = Number.isFinite(n) && !String(area).match(/m/)
          ? (n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " m²")
          : String(area);
      }
      return { emp: emp, nome: nome, block: block, lot: lot, area: area, areaLabel: areaLabel || "____", matricula: String(matricula || "").trim() || "____", unitId: unitId };
    },

    async gerarDocumentoEtapa(stageId) {
      const proc = FinanciamentoState.process;
      if (!proc) return;
      const folhas = this.folhasEtapa(this.catalogoEtapas());
      const idx = folhas.findIndex((f) => String(f.id) === String(stageId));
      const etapa = idx >= 0 ? folhas[idx] : null;
      const kind = this.docDaEtapa(etapa, idx);
      const cfg = CFG[kind];
      const st = document.getElementById("fin-doc-st-" + stageId);
      const btn = document.getElementById("fin-doc-" + stageId);
      if (!cfg) return;
      if (this._docBusy) return;
      this._docBusy = true;
      const btnHtml = btn ? btn.innerHTML : "";
      if (btn) { btn.disabled = true; btn.textContent = "Gerando…"; }
      if (st) st.textContent = "Consultando o saldo no Sienge…";
      try {
        const doc = modelo(kind);
        if (!doc.corpo.trim()) {
          alert("O modelo não está preenchido. Abra Configurações gerais → Documentos padrões e salve o texto.");
          return;
        }
        const customer = await this.clienteDoProc(proc);
        const sale = await this.contratoDoProc(proc) || {};
        const saldo = await this.saldoDoTitulo(proc, sale, customer);
        const pago = await this.valorPago(customer, sale);
        const saldoUsado = saldo.presente > 0 ? saldo.presente : saldo.corrigido;
        let valorQuitacao = saldoUsado;
        if (kind === "quifin") {
          if (!(valorQuitacao > 0) && proc.saldoIq && Number(proc.saldoIq.valor) > 0) valorQuitacao = Number(proc.saldoIq.valor);
          if (!(valorQuitacao > 0)) valorQuitacao = pago;
        }
        if (kind !== "quifin" && !(saldoUsado > 0)) {
          alert("Não há saldo em aberto neste título no Sienge. A simulação e a declaração não foram geradas.");
          if (st) st.textContent = "Sem saldo em aberto para este título.";
          return;
        }
        if (kind === "quifin" && !(valorQuitacao > 0)) {
          alert("Não foi possível apurar o valor da quitação. Gere antes a declaração na etapa 4 ou confira o título no Sienge.");
          if (st) st.textContent = "Sem valor de quitação para este título.";
          return;
        }
        const un = await this.unidadeDoContrato(proc, sale);
        const unit = {
          id: un.unitId,
          costCenterId: un.emp,
          block: un.block,
          lot: un.lot,
          area: un.area,
          name: un.nome
        };
        const saleDoc = Object.assign({}, sale, {
          id: sale.id || proc.contractId,
          customerId: proc.customerId,
          receivableBillId: saldo.billId || proc.titulo,
          costCenterId: un.emp,
          companyId: proc.companyId || sale.companyId,
          contractNumber: sale.contractNumber || proc.contractNumber,
          unitName: un.nome,
          block: un.block,
          lot: un.lot
        });
        let preamble = "";
        if (typeof window.getPreambleForContract === "function") {
          try { preamble = window.getPreambleForContract(unit, saleDoc) || ""; } catch (e) { preamble = ""; }
        }
        if (!preamble || /NÃO CADASTRADO/i.test(String(preamble))) {
          alert("Preâmbulo não cadastrado para o centro de custo deste contrato. Cadastre-o antes de gerar o documento.");
          if (st) st.textContent = "Falta o preâmbulo deste centro de custo.";
          return;
        }
        const valorContrato = Number(sale.totalSellingValue || sale.value || sale.contractValue || sale.updatedContractValue || 0);
        const hoje = new Date().toLocaleDateString("pt-BR");
        const extras = {
          SALDO_DEVEDOR: dinheiro(saldoUsado),
          SALDO_DEVEDOR_EXTENSO: extenso(saldoUsado),
          SALDO_CORRIGIDO: dinheiro(saldo.corrigido || saldoUsado),
          SALDO_CORRIGIDO_EXTENSO: extenso(saldo.corrigido || saldoUsado),
          VALOR_QUITACAO: dinheiro(valorQuitacao),
          VALOR_QUITACAO_EXTENSO: extenso(valorQuitacao),
          VALOR_PAGO: dinheiro(pago),
          VALOR_PAGO_EXTENSO: extenso(pago),
          VALOR_CONTRATO: valorContrato > 0 ? dinheiro(valorContrato) : "____",
          VALOR_CONTRATO_EXTENSO: valorContrato > 0 ? extenso(valorContrato) : "",
          QTD_PARCELAS_ABERTAS: String(saldo.linhas.length || 0),
          TABELA_PARCELAS: tabelaParcelas(saldo.linhas),
          DATA_BASE_SALDO: hoje,
          MATRICULA: un.matricula,
          AREA_LOTE: un.areaLabel,
          NUM_CONTRATO: String(saleDoc.contractNumber || proc.contractNumber || "____"),
          NUMERO_CONTRATO: String(saleDoc.contractNumber || proc.contractNumber || "____")
        };
        const map = window.buildLegalDocVarMap
          ? window.buildLegalDocVarMap(customer, saleDoc, unit, { preambleText: preamble, map: extras, titulo: saldo.billId || proc.titulo })
          : Object.assign({ PREAMBULO: preamble, NOME_CLIENTE: customer.name || "" }, extras);
        Object.keys(extras).forEach((k) => { map[k] = extras[k]; });
        let corpo = doc.corpo;
        if (typeof applyDistratoConditionals === "function") {
          corpo = applyDistratoConditionals(corpo, { hasConjuge: !!map._HAS_CONJUGE });
        }
        const markup = typeof window.formatDocPadraoMarkup === "function" ? window.formatDocPadraoMarkup(corpo) : corpo;
        const rel = window.RelacionamentoApp;
        const preencher = rel && typeof rel._fillDocVars === "function"
          ? rel._fillDocVars(markup, map)
          : (typeof window.applyDistratoTemplateVars === "function" ? window.applyDistratoTemplateVars(markup, map) : markup);
        let filled = String(preencher || "");
        if (typeof window.centerSimpleDocSignature === "function") filled = window.centerSimpleDocSignature(filled);
        const codEmp = map.CODIGO_EMPREENDIMENTO && map.CODIGO_EMPREENDIMENTO !== "____" ? map.CODIGO_EMPREENDIMENTO : (un.emp || "");
        const quadraLote = [un.block, un.lot].filter(Boolean).join(" - ");
        const unidade = [codEmp, quadraLote || un.nome].filter(Boolean).join(" - ");
        const topo = `<div style="font-family:'Times New Roman',serif;font-size:11pt;color:#111;margin:0 0 28px;">Título: ${this.esc(saldo.billId || proc.titulo || "—")} | Unidade: ${this.esc(unidade || "—")}</div>
          <h2 style="text-align:center;color:#111;font-size:13pt;font-weight:bold;letter-spacing:0.02em;margin:0 0 22px;">${this.esc(doc.titulo)}</h2>`;
        const corpoCss = "font-family:'Times New Roman',serif;font-size:11pt;line-height:1.5;text-align:justify;white-space:pre-wrap;color:#111;";
        const visivel = (s) => String(s || "").replace(/<[^>]+>/g, "").trim();
        const blocos = [];
        filled.split(/\n[ \t]*\n/).map((b) => b.replace(/^\n+|\s+$/g, "")).filter((b) => visivel(b) || /<table/i.test(b)).forEach((b) => {
          const txt = visivel(b);
          if (blocos.length && /^_{5,}/.test(txt)) blocos[blocos.length - 1] += "\n\n" + b;
          else blocos.push(b);
        });
        if (!rel || typeof rel._paginarDoc !== "function" || typeof rel._baixarPaginasPdf !== "function") {
          throw new Error("Gerador de PDF indisponível.");
        }
        const paginas = rel._paginarDoc(topo, blocos.length ? blocos : [filled], corpoCss);
        const nomeCli = customer.name || proc.customerName || "";
        const fileName = typeof window.buildFichaPdfFilename === "function"
          ? window.buildFichaPdfFilename(cfg.arquivo, { contrato: unidade, costCenterId: codEmp, titulo: saldo.billId || proc.titulo, nome: nomeCli })
          : cfg.arquivo + " | Título " + (saldo.billId || proc.titulo || "") + ".pdf";
        const pdf = await rel._baixarPaginasPdf(paginas, fileName, { retornar: true });
        if (pdf && typeof pdf.save === "function") pdf.save(fileName);
        if (kind !== "quifin" && saldoUsado > 0) {
          proc.saldoIq = { valor: saldoUsado, em: new Date().toISOString(), origem: kind, titulo: saldo.billId || "" };
          proc.updatedAt = new Date().toISOString();
          this.saveProcess(proc);
        }
        try {
          const bytes = pdf && pdf.output ? pdf.output("arraybuffer") : null;
          if (bytes) {
            const arquivo = new File([bytes], fileName, { type: "application/pdf" });
            this.guardarPendentes(stageId, [arquivo]);
          }
        } catch (e) {}
        if (st) st.textContent = "PDF gerado. Escolha a tag e clique em Enviar para a unidade, se quiser arquivar.";
      } catch (err) {
        console.error("[Financiamento] documento", err);
        alert((err && err.message) || "Não foi possível gerar o documento. Confira o modelo em Documentos padrões.");
        if (st) st.textContent = "Não foi possível gerar o documento.";
      } finally {
        this._docBusy = false;
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = btnHtml;
        }
        if (window.lucide) lucide.createIcons();
      }
    }
  };

  Object.keys(api).forEach((nome) => {
    FinanciamentoApp[nome] = api[nome];
  });
})();
