/* Follow-up do gestor (cobrança).
   O administrador, na ficha do cliente, pede ao operador responsável uma atualização detalhada do título.
   - Pedido gravado na coleção followup_gestor (Firestore), com o resumo do contrato do momento do pedido.
   - Nas Ocorrências e Promessas entra uma nota "Follow up do Gestor"; a resposta do operador fica como resposta dessa nota.
   - O operador recebe o pop-up (no login e quando chega um pedido novo), vê os títulos nos Insights da home
     e responde por lá. Contas a Receber > Follow-up Cobrança lista os pedidos e as respostas.
   Regra descrita também em alertas-popup.js (id "followup-gestor"). */
(function() {
  const COL = "followup_gestor";
  const CANAL = "Follow up do Gestor";
  const MAX_TEXTO = 2000;

  const FG = {
    pendentes: [],       // pedidos aguardando resposta (escuta em tempo real)
    lista: null,         // todos os pedidos (tela Follow-up Cobrança)
    carregandoLista: false,
    filtroSituacao: "aguardando",
    filtroOperador: "__todos",
    adiados: {},         // pedidos que o operador deixou para depois nesta sessão
    popupAtual: null,

    /* ---------- utilidades ---------- */
    esc(v) {
      return String(v == null ? "" : v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    },
    moeda(n) {
      return (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    },
    dataHora(iso) {
      const d = new Date(iso || "");
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    },
    dia(iso) {
      const d = new Date(iso || "");
      return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
    },
    norm(s) {
      return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\./g, " ").replace(/\s+/g, " ").trim().toUpperCase();
    },
    titulo(v) {
      return String(v == null ? "" : v).replace(/^B-/i, "").split("-")[0].trim();
    },
    novoId() {
      return (window.crypto && typeof window.crypto.randomUUID === "function")
        ? window.crypto.randomUUID()
        : Date.now() + "-" + Math.random().toString(36).slice(2);
    },
    // Supabase: tabela followup_gestor (mapa em js/nucleo/mapas-nucleo.js).
    fb() {
      return window.DadosNucleo && typeof window.DadosNucleo.tabela === "function" ? window.DadosNucleo.tabela(COL) : null;
    },
    aviso(msg, tipo) {
      let el = document.getElementById("fg-toast");
      if (!el) {
        el = document.createElement("div");
        el.id = "fg-toast";
        el.style.cssText = "position:fixed;bottom:22px;right:22px;z-index:100002;max-width:420px;padding:12px 16px;border-radius:8px;font-size:0.86rem;font-weight:600;box-shadow:0 10px 24px rgba(15,23,42,.18);";
        document.body.appendChild(el);
      }
      const erro = tipo === "erro";
      el.style.background = erro ? "#fef2f2" : "#ecfdf5";
      el.style.color = erro ? "#991b1b" : "#065f46";
      el.style.border = "1px solid " + (erro ? "#fecaca" : "#a7f3d0");
      el.textContent = msg;
      el.style.display = "block";
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => { el.style.display = "none"; }, 5000);
    },
    icones(root) {
      if (!window.lucide) return;
      try { window.lucide.createIcons(root ? { root: root } : undefined); } catch (e) { try { window.lucide.createIcons(); } catch (e2) {} }
    },

    /* ---------- quem é quem ---------- */
    souAdmin() {
      return typeof window.isCrmSuperAdmin === "function" && window.isCrmSuperAdmin();
    },
    usuario() {
      return (typeof window.crmUsuarioEfetivo === "function" && window.crmUsuarioEfetivo())
        || (window.AppState && AppState.currentUser) || null;
    },
    nomeReal() {
      if (typeof window.crmNomeReal === "function" && window.crmNomeReal()) return window.crmNomeReal();
      const u = window.AppState && AppState.currentUser;
      return (u && u.name) || "Administrador";
    },
    /** O nome do operador gravado no pedido (como aparece na fila) é deste usuário? */
    operadorEh(nomeOperador, user) {
      if (!user || !nomeOperador) return false;
      const chaves = [user.sienge_user, user.name];
      if (user.sienge_user) chaves.push(String(user.sienge_user).replace(/\./g, " "));
      return chaves.filter(Boolean).some((k) => {
        if (this.norm(k) === this.norm(nomeOperador)) return true;
        return typeof window.occurrenceAuthorMatchesOperator === "function"
          && window.occurrenceAuthorMatchesOperator(nomeOperador, k);
      });
    },
    pedidosDoUsuario(user) {
      return (this.pendentes || []).filter((p) => p && p.status === "aguardando" && this.operadorEh(p.operador, user));
    },
    acharCliente(customerId, titulo) {
      const cid = String(customerId || "");
      const t = this.titulo(titulo);
      const listas = [window.rawClientList || [], window.clientList || []];
      for (const lista of listas) {
        const achou = lista.find((c) => c && String(c.customerId) === cid && (
          this.titulo(c.saleId) === t || (c.billIds || []).some((b) => this.titulo(b) === t)
        ));
        if (achou) return achou;
      }
      return null;
    },
    operadores() {
      const hd = window.HomeDashboard;
      const lista = hd && typeof hd.getOperatorUsers === "function" ? hd.getOperatorUsers() : [];
      const vistos = new Set();
      const out = [];
      lista.forEach((u) => {
        const nome = String((u && (u.name || u.sienge_user)) || "").trim();
        if (!nome || vistos.has(this.norm(nome))) return;
        vistos.add(this.norm(nome));
        out.push({ id: nome, label: nome });
      });
      return out.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    },

    /* ---------- resumo do contrato (lido da ficha aberta) ---------- */
    texto(id) {
      const el = document.getElementById(id);
      return el ? String(el.textContent || "").trim() : "";
    },
    fichaAtual() {
      const cid = String((window.AppState && AppState.selectedCustomerId) || "");
      const saleId = String((window.AppState && (AppState.selectedSaleId || AppState.currentReceivableBillId)) || "");
      const titulo = this.titulo(this.texto("det-bill-id") || saleId);
      let unidade = "";
      const span = document.getElementById("det-block-lot-span");
      if (span && span.childNodes.length) unidade = String(span.childNodes[0].textContent || "").trim();
      if (!unidade) unidade = this.texto("det-block-lot");
      return {
        customerId: cid,
        saleId: saleId,
        titulo: titulo,
        cliente: this.texto("det-name"),
        unidade: unidade,
        empreendimento: this.texto("det-project-name")
      };
    },
    nexResumo(customerId, titulo) {
      try {
        if (typeof window.nexEnsureLookups === "function") window.nexEnsureLookups();
        const todas = typeof window.nexCollectAll === "function" ? window.nexCollectAll() : [];
        const minhas = todas.filter((it) => it && String(it.customerId) === String(customerId) && this.titulo(it.titulo || it.saleId) === this.titulo(titulo));
        if (!minhas.length) return { tem: false, texto: "Nenhuma Nex enviada para este título." };
        minhas.sort((a, b) => String(b.date || b.createdAt || "").localeCompare(String(a.date || a.createdAt || "")));
        const n = minhas[0];
        const valida = typeof window.nexIsLegallyValid === "function" && window.nexIsLegallyValid(n).ok;
        const partes = ["Nex enviada em " + (typeof window.nexFmtBr === "function" ? window.nexFmtBr(n.date || n.createdAt) : this.dia(n.date || n.createdAt))];
        if (n.status) partes.push("situação " + String(n.status).toLowerCase());
        if (n.deliveredAt && typeof window.nexFmtBr === "function") partes.push("entregue em " + window.nexFmtBr(n.deliveredAt));
        if (valida) partes.push("com validade jurídica");
        if (minhas.length > 1) partes.push(minhas.length + " Nex no total");
        return { tem: true, texto: partes.join(" · ") + "." };
      } catch (e) {
        return { tem: false, texto: "Não foi possível ler as Nex deste título." };
      }
    },
    ultimoContato(customerId) {
      const n = typeof window.getLatestCustomerContact === "function" ? window.getLatestCustomerContact(customerId) : null;
      if (!n) return null;
      return {
        data: n.date || "",
        canal: n.canal || n.fase || (n.type === "Judicial" ? "Judicial" : "Ocorrência"),
        autor: n.author || "",
        texto: String(n.text || "").trim().slice(0, 800)
      };
    },
    async montarResumo(ficha) {
      const cid = String(ficha.customerId);
      const k = (window.AppState && AppState.currentContractKpis) || null;
      const kOk = k && String(k._customerId || "") === cid;
      const perfil = (window.AppState && AppState.currentFichaPerfil) || null;
      const pOk = perfil && String(perfil._customerId || "") === cid;
      const cliente = this.acharCliente(cid, ficha.titulo);
      let construcao = null;
      if (typeof window.cancelamentoLerConstrucao === "function") {
        try {
          const ref = cliente || { customerId: cid, saleId: ficha.saleId || ficha.titulo, billIds: [ficha.titulo] };
          // A consulta espera o índice da fila, que pode demorar (Sienge com 429): no máximo 8 s.
          const obra = await Promise.race([
            window.cancelamentoLerConstrucao(ref),
            new Promise((resolve) => setTimeout(() => resolve(null), 8000))
          ]);
          construcao = obra
            ? { tem: !!obra.temConstrucao, incerta: !!obra.incerta, texto: obra.texto || "" }
            : { tem: false, incerta: true, texto: "A consulta de construção não respondeu a tempo. Confira na aba Construção da ficha." };
        } catch (e) {}
      }
      const lote = window._fichaLoteAtual && String(window._fichaLoteAtual.customerId || "") === cid ? window._fichaLoteAtual : null;
      return {
        geradoEm: new Date().toISOString(),
        valores: kOk ? {
          pagosQtd: k.kpiQtdPagas || 0, pagos: k.kpiLiquido || 0,
          vencidosQtd: k.kpiQtdVencidas || 0, vencidos: k.kpiVencidas || 0,
          aVencerQtd: k.kpiQtdAVencer || 0, aVencer: k.kpiAVencer || 0,
          totalQtd: k.kpiTotalQtd || 0, total: k.kpiTotalContrato || 0
        } : null,
        pctPago: kOk && k.kpiPctPago != null ? Math.max(0, Math.min(1, Number(k.kpiPctPago) || 0)) : null,
        pmp: pOk ? perfil.pmp : null,
        renegociacoes: pOk ? perfil.renegociacoes : null,
        pctEmDia: pOk ? perfil.pctEmDia : null,
        perfil: pOk ? perfil.perfil : "",
        diasAtraso: cliente ? (Number(cliente.maxDaysDelay) || 0) : null,
        acordoQuebrado: !!(cliente && (cliente.isInternalBrokenAgreement || cliente.isAcordoJudicialQuebrado || cliente.hasOverdueAgreement)),
        construcao: construcao,
        lote: lote ? { nome: lote.lotName || "", coords: String(lote.coords || "").slice(0, 20000), empId: lote.empId || "" } : null,
        nex: this.nexResumo(cid, ficha.titulo),
        ultimoContato: this.ultimoContato(cid)
      };
    },

    /* ---------- HTML do resumo (pop-up do operador, conferência do gestor e olhinho) ---------- */
    resumoHtml(p, idBase) {
      const r = p.resumo || {};
      const v = r.valores;
      const cartao = (rotulo, qtd, valor, cor, fundo) => `<div style="min-width:0;border:1px solid #e2e8f0;border-left:4px solid ${cor};border-radius:8px;padding:10px 12px;background:${fundo || "#fff"};">
          <div style="font-size:0.66rem;font-weight:800;color:${cor};text-transform:uppercase;letter-spacing:.02em;">${rotulo}</div>
          <div style="font-size:0.78rem;font-weight:700;color:#475569;margin-top:4px;">${qtd} ${Number(qtd) === 1 ? "parcela" : "parcelas"}</div>
          <div style="font-size:1.02rem;font-weight:800;color:${cor};white-space:nowrap;font-variant-numeric:tabular-nums;">${this.moeda(valor)}</div>
        </div>`;
      const valoresHtml = v
        ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;flex:1;min-width:0;">
            ${cartao("Valores pagos", v.pagosQtd, v.pagos, "#15803d")}
            ${cartao("Valores vencidos", v.vencidosQtd, v.vencidos, "#c2410c", "#fff7ed")}
            ${cartao("Valores a vencer", v.aVencerQtd, v.aVencer, "#1d4ed8")}
            ${cartao("Total do contrato", v.totalQtd, v.total, "#105436")}
          </div>`
        : `<div style="flex:1;padding:12px;border:1px dashed #cbd5e1;border-radius:8px;color:#64748b;font-size:0.84rem;">Os valores do contrato não estavam carregados na ficha quando o pedido foi feito. Use Visualizar Extrato.</div>`;
      const gauge = r.pctPago != null
        ? `<div style="width:160px;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;border:1px solid #e2e8f0;border-radius:8px;padding:6px 4px;background:#fff;">
            <canvas id="${idBase}-gauge" width="150" height="85" data-pct="${r.pctPago}" data-resta="${v ? (Number(v.vencidos) || 0) + (Number(v.aVencer) || 0) : 0}"></canvas>
            <span style="font-size:0.68rem;font-weight:700;color:#64748b;">Pago do contrato</span>
          </div>`
        : "";
      const linha = (icone, rotulo, conteudo, largo) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;min-width:0;${largo ? "grid-column:1 / -1;" : ""}">
          <i data-lucide="${icone}" style="width:16px;height:16px;color:#105436;flex-shrink:0;margin-top:1px;"></i>
          <div style="min-width:0;flex:1;"><div style="font-size:0.66rem;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.02em;margin-bottom:3px;">${rotulo}</div><div style="font-size:0.84rem;color:#0f172a;line-height:1.45;">${conteudo}</div></div>
        </div>`;
      const c = r.construcao;
      const construcaoTxt = c ? this.esc(c.texto || (c.tem ? "Lote com construção." : "Sem registro de construção.")) : "Não consultado.";
      const loteBtn = r.lote && r.lote.coords
        ? `<div style="margin-top:6px;"><button type="button" class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:0.75rem;" onclick="FollowupGestor.abrirLote('${this.esc(p.id)}')"><i data-lucide="globe" style="width:12px;height:12px;"></i> Ver lote no KMZ</button></div>`
        : "";
      const pmp = r.pmp != null ? this.esc(r.pmp) + " dias" + (r.pctEmDia != null ? " · pagou em dia " + this.esc(r.pctEmDia) + "% das vezes" : "") : "—";
      const reneg = r.renegociacoes != null ? this.esc(r.renegociacoes) + (Number(r.renegociacoes) === 1 ? " renegociação" : " renegociações") : "—";
      const atraso = r.diasAtraso != null ? this.esc(r.diasAtraso) + " dias de atraso" + (r.acordoQuebrado ? " · acordo quebrado" : "") : "";
      const u = r.ultimoContato;
      const contato = u
        ? `<strong>${this.esc(this.dataHora(u.data))}</strong> · ${this.esc(u.canal)}${u.autor ? " · " + this.esc(u.autor) : ""}<div style="margin-top:6px;padding:8px 10px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;white-space:pre-wrap;font-size:0.8rem;color:#334155;">${this.esc(u.texto || "(sem texto)")}</div>`
        : "Nenhum contato registrado.";
      const acordos = reneg + (atraso ? `<div style="color:#64748b;font-size:0.78rem;margin-top:2px;">${atraso}</div>` : "");
      const pmpTxt = pmp + (r.perfil ? `<div style="color:#64748b;font-size:0.78rem;margin-top:2px;">${this.esc(r.perfil)}</div>` : "");
      return `<div style="display:flex;gap:10px;align-items:stretch;flex-wrap:wrap;">${valoresHtml}${gauge}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;margin-top:10px;">
          ${linha("house", "Construção", construcaoTxt + loteBtn)}
          ${linha("mail", "Nex", this.esc((r.nex && r.nex.texto) || "—"))}
          ${linha("handshake", "Acordos", acordos)}
          ${linha("timer", "PMP", pmpTxt)}
          ${linha("message-square", "Último contato", contato, true)}
        </div>
        <div style="font-size:0.72rem;color:#94a3b8;margin-top:6px;">Resumo da ficha em ${this.esc(this.dataHora(r.geradoEm))}, quando o pedido foi feito.</div>`;
    },
    desenharGauge(idBase) {
      const cv = document.getElementById(idBase + "-gauge");
      if (!cv || typeof window.drawFuturisticSpeedometer !== "function") return;
      try { window.drawFuturisticSpeedometer(cv, Number(cv.getAttribute("data-pct")) || 0, Number(cv.getAttribute("data-resta")) || 0); } catch (e) {}
    },
    cabecalhoCliente(p) {
      return `<div style="font-size:0.95rem;font-weight:800;color:#0f172a;">${this.esc(p.cliente || ("Cliente " + p.customerId))}</div>
        <div style="font-size:0.8rem;color:#64748b;margin-top:2px;">Título ${this.esc(p.titulo)}${p.unidade ? " · " + this.esc(p.unidade) : ""}${p.empreendimento ? " · " + this.esc(p.empreendimento) : ""}</div>`;
    },
    modal(id, largura, html) {
      let m = document.getElementById(id);
      if (!m) {
        m = document.createElement("div");
        m.id = id;
        m.style.cssText = "display:none;position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:100001;align-items:flex-start;justify-content:center;overflow:auto;padding:28px 16px;";
        document.body.appendChild(m);
      }
      m.innerHTML = `<div style="background:#fff;width:min(${largura}px,96vw);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.28);padding:18px;">${html}</div>`;
      m.style.display = "flex";
      this.icones(m);
      return m;
    },
    fecharModal(id) {
      const m = document.getElementById(id);
      if (m) m.style.display = "none";
    },
    acharPedido(id) {
      const todos = [].concat(this.pendentes || [], this.lista || []);
      return todos.find((p) => p && String(p.id) === String(id)) || null;
    },

    /* ---------- botões de apoio (extrato, lote, ficha) ---------- */
    async verExtrato(id, btn) {
      const p = this.acharPedido(id);
      if (!p || !window.SiengeApiService || typeof SiengeApiService.getCustomerFinancialStatementsPdf !== "function") return;
      const janela = window.open("", "_blank");
      const rotulo = btn ? btn.innerHTML : "";
      if (btn) { btn.disabled = true; btn.textContent = "Gerando extrato…"; }
      try {
        const res = await SiengeApiService.getCustomerFinancialStatementsPdf(p.customerId, p.titulo);
        let url = null;
        if (res && res.results && res.results.length) url = res.results[0].urlReport || res.results[0].value;
        else if (Array.isArray(res) && res.length) url = res[0].urlReport || res[0].value || (typeof res[0] === "string" ? res[0] : null);
        else if (res && (res.urlReport || res.value)) url = res.urlReport || res.value;
        else if (typeof res === "string" && res.startsWith("http")) url = res;
        if (!url) {
          if (janela) janela.close();
          this.aviso("Extrato em PDF não disponível para este título.", "erro");
          return;
        }
        const nome = typeof window.buildFichaPdfFilename === "function"
          ? window.buildFichaPdfFilename("Extrato", { contrato: p.unidade || "", titulo: p.titulo, nome: p.cliente || "Cliente" })
          : "Extrato " + p.titulo + ".pdf";
        if (typeof window.openNamedSiengePdf === "function") window.openNamedSiengePdf(url, nome, janela);
        else if (janela) janela.location.href = url;
      } catch (e) {
        if (janela) janela.close();
        this.aviso("Ocorreu um erro ao gerar o extrato.", "erro");
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = rotulo; this.icones(btn.parentNode); }
      }
    },
    abrirLote(id) {
      const p = this.acharPedido(id);
      const l = p && p.resumo && p.resumo.lote;
      if (!l || !l.coords) return;
      if (typeof window.abrirLoteGoogleEarth === "function") window.abrirLoteGoogleEarth(l.nome, l.coords, l.empId || null);
    },
    async abrirFicha(id) {
      const p = this.acharPedido(id);
      if (!p) return;
      this.fecharModal("fg-popup");
      this.fecharModal("fg-olho");
      const abrir = window.viewCustomerCard;
      if (typeof abrir === "function") await abrir(p.customerId, p.saleId || p.titulo, p.titulo);
    },

    /* ---------- gestor: pedir a atualização pela ficha ---------- */
    atualizarBotaoFicha() {
      const btn = document.getElementById("btn-followup-gestor");
      if (!btn) return;
      btn.style.display = this.souAdmin() ? "" : "none";
    },
    async abrirPedido() {
      if (!this.souAdmin()) return;
      const fb = this.fb();
      if (!fb) { this.aviso("O banco do Integra não está disponível agora. Tente de novo em instantes.", "erro"); return; }
      const ficha = this.fichaAtual();
      if (!ficha.customerId || !ficha.titulo) { this.aviso("Abra a ficha do cliente antes de pedir a atualização.", "erro"); return; }
      const m = this.modal("fg-pedido", 900, `<div style="padding:30px;text-align:center;color:#64748b;">Montando o resumo do contrato…
          <div style="margin-top:14px;"><button type="button" class="btn btn-fechar" onclick="FollowupGestor.fecharModal('fg-pedido')">Fechar</button></div></div>`);
      let resumo;
      try {
        resumo = await this.montarResumo(ficha);
      } catch (e) {
        console.error("[followup-gestor] resumo", e);
        this.fecharModal("fg-pedido");
        this.aviso("Não foi possível montar o resumo do contrato. Tente de novo.", "erro");
        return;
      }
      if (m.style.display === "none") return;
      const cliente = this.acharCliente(ficha.customerId, ficha.titulo);
      const opFila = cliente && cliente.assignedOperator && this.norm(cliente.assignedOperator) !== this.norm("NÃO ATRIBUÍDO") ? String(cliente.assignedOperator) : "";
      const itensOp = this.operadores();
      if (opFila && !itensOp.some((o) => this.norm(o.id) === this.norm(opFila))) itensOp.unshift({ id: opFila, label: opFila });
      const aberto = (this.pendentes || []).find((p) => p.status === "aguardando" && String(p.customerId) === ficha.customerId && this.titulo(p.titulo) === ficha.titulo);
      this._rascunho = Object.assign({ id: "rascunho" }, ficha, { resumo: resumo });
      const seletor = window.MlSelectUnico
        ? MlSelectUnico.html({ id: "fg-operador", label: "Operador responsável", items: itensOp, selectedId: opFila || "", semId: true, largura: "100%" })
        : `<label style="font-size:0.72rem;font-weight:700;color:#475569;text-transform:uppercase;">Operador responsável</label>
           <select id="fg-operador-sel" style="height:40px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;">${itensOp.map((o) => `<option value="${this.esc(o.id)}" ${this.norm(o.id) === this.norm(opFila) ? "selected" : ""}>${this.esc(o.label)}</option>`).join("")}</select>`;
      this._operadorEscolhido = opFila;
      this.modal("fg-pedido", 1000, `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;">
          <div>
            <h2 style="margin:0;color:#105436;font-size:1.15rem;">Pedir atualização ao operador</h2>
            <div style="margin-top:6px;">${this.cabecalhoCliente(ficha)}</div>
          </div>
          <button type="button" class="btn btn-fechar" onclick="FollowupGestor.fecharModal('fg-pedido')">Fechar</button>
        </div>
        ${aberto ? `<div style="background:#fff7ed;border:1px solid #fdba74;color:#9a3412;border-radius:8px;padding:10px 12px;font-size:0.84rem;margin-bottom:12px;">Já há um pedido aguardando resposta de ${this.esc(aberto.operador)} desde ${this.esc(this.dataHora(aberto.criadoEm))}. Enviar outro cria um segundo pedido.</div>` : ""}
        <div style="font-size:0.78rem;color:#64748b;margin-bottom:8px;">O operador recebe este resumo no pop-up.</div>
        ${this.resumoHtml(this._rascunho, "fg-ped")}
        <div style="display:grid;grid-template-columns:minmax(220px,320px) 1fr;gap:14px;margin-top:14px;align-items:start;">
          <div>${seletor}${opFila ? "" : `<div style="font-size:0.75rem;color:#b45309;margin-top:6px;">Este título não está na fila de cobrança. Escolha o operador.</div>`}</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <label for="fg-mensagem" style="font-size:0.72rem;font-weight:700;color:#475569;text-transform:uppercase;">Considerações para o operador</label>
            <textarea id="fg-mensagem" rows="4" maxlength="${MAX_TEXTO}" style="width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:0.88rem;resize:vertical;" placeholder="O que você quer saber sobre este caso?"></textarea>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
          <button type="button" class="btn btn-cancel" onclick="FollowupGestor.fecharModal('fg-pedido')">Cancelar</button>
          <button type="button" class="btn btn-primary" id="fg-enviar" onclick="FollowupGestor.enviarPedido()"><i data-lucide="send" style="width:14px;height:14px;"></i> Enviar ao operador</button>
        </div>`);
      this.desenharGauge("fg-ped");
      if (window.MlSelectUnico && document.getElementById("fg-operador")) {
        MlSelectUnico.bind("fg-operador", { onSelect: (v) => { this._operadorEscolhido = v; } });
      }
    },
    async enviarPedido() {
      const fb = this.fb();
      const r = this._rascunho;
      if (!fb || !r || !this.souAdmin()) return;
      const sel = document.getElementById("fg-operador-sel");
      const operador = String((sel ? sel.value : this._operadorEscolhido) || "").trim();
      const msgEl = document.getElementById("fg-mensagem");
      const mensagem = String((msgEl && msgEl.value) || "").trim().slice(0, MAX_TEXTO);
      if (!operador) { this.aviso("Escolha o operador responsável.", "erro"); return; }
      if (!mensagem) { this.aviso("Escreva as considerações para o operador.", "erro"); if (msgEl) msgEl.focus(); return; }
      const btn = document.getElementById("fg-enviar");
      if (btn) { btn.disabled = true; btn.textContent = "Enviando…"; }
      const agora = new Date().toISOString();
      const autor = this.nomeReal();
      const ref = { id: this.novoId() };
      const nota = {
        id: this.novoId(),
        date: agora,
        author: autor,
        saleId: r.titulo,
        receivableBillId: r.titulo,
        contractId: null,
        unitId: null,
        // A tela de ocorrências mostra o texto sem escapar: tira < e > para não virar HTML.
        text: ("FOLLOW UP DO GESTOR PARA " + operador + ": " + mensagem).toUpperCase().replace(/[<>]/g, ""),
        promiseDate: null,
        promiseStatus: null,
        reminder: null,
        canal: CANAL,
        iniciativa: null,
        promisedInstallments: [],
        pinned: false,
        followupGestorId: ref.id,
        replies: [],
        origem: "followup-gestor",
        updatedAt: agora,
        attachments: []
      };
      const pedido = {
        customerId: String(r.customerId),
        saleId: String(r.saleId || r.titulo),
        titulo: r.titulo,
        cliente: r.cliente || "",
        unidade: r.unidade || "",
        empreendimento: r.empreendimento || "",
        operador: operador,
        pedidoPor: autor,
        pedidoPorEmail: String((window.AppState && AppState.currentUser && AppState.currentUser.email) || "").toLowerCase(),
        mensagem: mensagem,
        resumo: r.resumo || {},
        status: "aguardando",
        criadoEm: agora,
        vistoEm: null,
        resposta: "",
        respondidoEm: null,
        respondidoPor: "",
        notaId: nota.id,
        nota: nota
      };
      try {
        await fb.gravar(ref.id, pedido);
      } catch (e) {
        console.error("[followup-gestor] pedido", e);
        if (btn) { btn.disabled = false; btn.textContent = "Enviar ao operador"; }
        this.aviso("Não foi possível gravar o pedido. Tente de novo.", "erro");
        return;
      }
      await this.gravarNota(r.customerId, nota);
      this.fecharModal("fg-pedido");
      this.aviso("Pedido enviado para " + operador + ".");
      if (this.lista) { this.lista.unshift(Object.assign({ id: ref.id }, pedido)); this.render(); }
    },
    /** Põe (ou atualiza) a nota do follow-up nas Ocorrências e Promessas do cliente. */
    async gravarNota(customerId, nota) {
      const w = window;
      if (!w.AppState || typeof w.saveNotesToFirebase !== "function" || typeof w.mergeOccurrenceLists !== "function"
        || typeof w.getCustomerNotesList !== "function" || typeof w.normalizeCustomerNotesKey !== "function") {
        console.warn("[followup-gestor] ocorrências indisponíveis; nota não gravada");
        return false;
      }
      try {
        if (!w.AppState.notes) w.AppState.notes = {};
        const chave = w.normalizeCustomerNotesKey(customerId);
        const atual = w.getCustomerNotesList(w.AppState.notes, chave) || [];
        w.AppState.notes[chave] = w.mergeOccurrenceLists(atual, [nota]);
        await w.saveNotesToFirebase(customerId);
        return true;
      } catch (e) {
        console.error("[followup-gestor] nota", e);
        return false;
      }
    },

    /* ---------- operador: pop-up e resposta ---------- */
    iniciar() {
      if (this._escuta) return;
      const fb = this.fb();
      if (!fb || typeof fb.ouvir !== "function") return;
      try {
        this._escuta = fb.ouvir((r) => {
          const lista = (r.docs || []).slice();
          lista.sort((a, b) => String(a.criadoEm || "").localeCompare(String(b.criadoEm || "")));
          this.pendentes = lista;
          this.avisarOperador();
          this.atualizarHome();
        }, { filtros: [["status", "eq", "aguardando"]], aoErro: (err) => console.warn("[followup-gestor] escuta", err) });
      } catch (e) {
        console.warn("[followup-gestor] início", e);
      }
    },
    atualizarHome() {
      const hd = window.HomeDashboard;
      const box = document.getElementById("home-op-insights-container");
      if (hd && box && box.style.display !== "none" && typeof hd.renderInsights === "function") {
        try { hd.renderInsights(); } catch (e) {}
      }
    },
    /** Pedidos deste usuário para a home (Insights). */
    itensInsight(user) {
      return this.pedidosDoUsuario(user).map((p) => ({
        customerId: p.customerId,
        saleId: p.saleId || p.titulo,
        customerName: p.cliente || ("Cliente " + p.customerId),
        hint: "Pedido em " + this.dia(p.criadoEm) + " por " + (p.pedidoPor || "gestor"),
        followupId: p.id
      }));
    },
    /** Clique no Insights da home: abre o pedido daquele cliente/título. */
    abrirPorCliente(customerId, saleId, user) {
      const lista = this.pedidosDoUsuario(user || this.usuario());
      const p = lista.find((x) => String(x.customerId) === String(customerId) && this.titulo(x.saleId || x.titulo) === this.titulo(saleId))
        || lista.find((x) => String(x.customerId) === String(customerId));
      if (!p) return false;
      this.abrirPopup(p.id);
      return true;
    },
    avisarOperador() {
      if (this.souAdmin()) return;
      const meus = this.pedidosDoUsuario(this.usuario()).filter((p) => !this.adiados[p.id]);
      if (!meus.length) return;
      const aberto = document.getElementById("fg-popup");
      if (aberto && aberto.style.display !== "none") return;
      this.abrirPopup(meus[0].id);
    },
    abrirPopup(id) {
      const p = this.acharPedido(id);
      if (!p) return;
      const user = this.usuario();
      const meus = this.pedidosDoUsuario(user);
      const pos = meus.findIndex((x) => x.id === p.id);
      const podeResponder = p.status === "aguardando" && !this.souAdmin() && this.operadorEh(p.operador, user);
      this.popupAtual = p.id;
      this.montarPopup(p, { total: meus.length, pos: pos, podeResponder: podeResponder });
      if (podeResponder && !p.vistoEm) this.marcarVisto(p);
    },
    /** Monta o pop-up do operador. O caminho real usa o modal "fg-popup"; a prévia (o.previa) usa "fg-popup-previa",
        com os mesmos textos e campos, mas os botões só fecham ou ficam desabilitados (nada é gravado). */
    montarPopup(p, o) {
      const previa = !!o.previa;
      const idModal = previa ? "fg-popup-previa" : "fg-popup";
      const idBase = previa ? "fg-prev" : "fg-pop";
      const podeResponder = o.podeResponder;
      const id = this.esc(p.id);
      const acaoDepois = previa ? "FollowupGestor.fecharModal('fg-popup-previa')" : `FollowupGestor.depois('${id}')`;
      const desab = previa ? ` disabled title="Prévia: nada é gravado"` : "";
      this.modal(idModal, 1000, `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div>
            <div style="display:inline-flex;align-items:center;gap:6px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:999px;padding:3px 10px;font-size:0.75rem;font-weight:800;"><i data-lucide="bell-ring" style="width:13px;height:13px;"></i> Follow-up do gestor${o.total > 1 && o.pos >= 0 ? " · " + (o.pos + 1) + " de " + o.total : ""}</div>
            <h2 style="margin:8px 0 0;color:#105436;font-size:1.15rem;">O gestor gostaria de uma atualização detalhada deste caso</h2>
            <div style="margin-top:6px;">${this.cabecalhoCliente(p)}</div>
          </div>
          <button type="button" class="btn btn-fechar" onclick="${acaoDepois}">${podeResponder ? "Responder depois" : "Fechar"}</button>
        </div>
        <div style="margin:12px 0;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px;">
          <div style="font-size:0.72rem;font-weight:800;color:#166534;text-transform:uppercase;">${this.esc(p.pedidoPor || "Gestor")} · ${this.esc(this.dataHora(p.criadoEm))}</div>
          <div style="margin-top:4px;font-size:0.9rem;color:#0f172a;white-space:pre-wrap;">${this.esc(p.mensagem)}</div>
        </div>
        ${this.resumoHtml(p, idBase)}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
          <button type="button" class="btn btn-outline btn-sm" onclick="FollowupGestor.verExtrato('${id}', this)"${desab}><i data-lucide="file-text" style="width:14px;height:14px;"></i> Visualizar Extrato</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="FollowupGestor.abrirFicha('${id}')"${desab}><i data-lucide="user-round" style="width:14px;height:14px;"></i> Abrir ficha</button>
        </div>
        ${p.status === "respondido" ? `
          <div style="margin-top:14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 12px;">
            <div style="font-size:0.72rem;font-weight:800;color:#1e40af;text-transform:uppercase;">Resposta de ${this.esc(p.respondidoPor)} · ${this.esc(this.dataHora(p.respondidoEm))}</div>
            <div style="margin-top:4px;font-size:0.9rem;white-space:pre-wrap;">${this.esc(p.resposta)}</div>
          </div>` : ""}
        ${podeResponder ? `
          <div style="margin-top:14px;display:flex;flex-direction:column;gap:6px;">
            <label for="${previa ? "fg-resposta-previa" : "fg-resposta"}" style="font-size:0.72rem;font-weight:700;color:#475569;text-transform:uppercase;">Sua resposta ao gestor</label>
            <textarea id="${previa ? "fg-resposta-previa" : "fg-resposta"}" rows="5" maxlength="${MAX_TEXTO}" style="width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:0.88rem;resize:vertical;" placeholder="Conte como está o caso: contatos feitos, o que o cliente disse e o próximo passo."></textarea>
            <div style="display:flex;justify-content:flex-end;gap:8px;">
              <button type="button" class="btn btn-cancel" onclick="${acaoDepois}">Responder depois</button>
              <button type="button" class="btn btn-primary" id="${previa ? "fg-responder-previa" : "fg-responder"}" onclick="${previa ? "" : `FollowupGestor.responder('${id}')`}"${desab}><i data-lucide="send" style="width:14px;height:14px;"></i> Enviar resposta</button>
            </div>
          </div>` : ""}`);
      this.desenharGauge(idBase);
    },
    /** Prévia para a gestão de pop-ups: usa um pedido já em memória (cópia) ou um exemplo; nada é gravado. */
    previa() {
      const agora = new Date();
      const diasAtras = (n) => { const d = new Date(agora); d.setDate(d.getDate() - n); return d.toISOString(); };
      const real = (this.pendentes || []).find((p) => p && p.status === "aguardando");
      const p = real ? Object.assign({}, real, { id: "previa", status: "aguardando" }) : {
        id: "previa",
        customerId: "0000",
        saleId: "12345",
        titulo: "12345",
        cliente: "Cliente exemplo",
        unidade: "Quadra 12 Lote 08",
        empreendimento: "Residencial Exemplo",
        operador: "Operador exemplo",
        pedidoPor: "Gestor exemplo",
        mensagem: "Preciso entender a situação deste contrato: houve contato recente? O cliente sinalizou acordo?",
        status: "aguardando",
        criadoEm: diasAtras(0),
        vistoEm: null,
        resumo: {
          geradoEm: diasAtras(0),
          valores: { pagosQtd: 38, pagos: 41250.4, vencidosQtd: 4, vencidos: 4820.75, aVencerQtd: 78, aVencer: 96310.2, totalQtd: 120, total: 142381.35 },
          pctPago: 0.29,
          pmp: 12,
          renegociacoes: 1,
          pctEmDia: 64,
          perfil: "Paga com atraso eventual",
          diasAtraso: 95,
          acordoQuebrado: false,
          construcao: { tem: true, incerta: false, texto: "Lote com construção (vistoria de " + this.dia(diasAtras(40)) + ")." },
          lote: null,
          nex: { tem: true, texto: "Nex enviada em " + this.dia(diasAtras(20)) + " · situação entregue." },
          ultimoContato: { data: diasAtras(6), canal: "WhatsApp", autor: "Operador exemplo", texto: "CLIENTE INFORMOU QUE VAI PAGAR DUAS PARCELAS ATÉ O FIM DO MÊS." }
        }
      };
      if (p.resumo) p.resumo = Object.assign({}, p.resumo, { lote: null });
      this.montarPopup(p, { previa: true, total: 1, pos: 0, podeResponder: true });
    },
    async marcarVisto(p) {
      const fb = this.fb();
      if (!fb) return;
      try {
        await fb.gravar(p.id, { vistoEm: new Date().toISOString() }, { merge: true });
      } catch (e) {}
    },
    depois(id) {
      this.adiados[id] = true;
      this.fecharModal("fg-popup");
      const proximo = this.pedidosDoUsuario(this.usuario()).find((p) => !this.adiados[p.id]);
      if (proximo && !this.souAdmin()) setTimeout(() => this.abrirPopup(proximo.id), 300);
    },
    async responder(id) {
      const fb = this.fb();
      const p = this.acharPedido(id);
      if (!fb || !p) return;
      const el = document.getElementById("fg-resposta");
      const texto = String((el && el.value) || "").trim().slice(0, MAX_TEXTO);
      if (!texto) { this.aviso("Escreva a resposta antes de enviar.", "erro"); if (el) el.focus(); return; }
      const btn = document.getElementById("fg-responder");
      if (btn) { btn.disabled = true; btn.textContent = "Enviando…"; }
      const agora = new Date().toISOString();
      const user = this.usuario();
      const autor = (user && user.name) || "Operador";
      try {
        await fb.gravar(p.id, {
          status: "respondido",
          resposta: texto,
          respondidoEm: agora,
          respondidoPor: autor
        }, { merge: true });
      } catch (e) {
        console.error("[followup-gestor] resposta", e);
        if (btn) { btn.disabled = false; btn.textContent = "Enviar resposta"; }
        this.aviso("Não foi possível gravar a resposta. Tente de novo.", "erro");
        return;
      }
      // Resposta pendurada na nota do gestor (Ocorrências e Promessas).
      const base = this.notaDoPedido(p);
      if (base) {
        const nota = Object.assign({}, base, {
          replies: [].concat(base.replies || [], [{ text: texto.toUpperCase().replace(/[<>]/g, ""), author: String(autor).replace(/[<>]/g, ""), date: agora, tipo: "resposta" }]),
          updatedAt: agora
        });
        await this.gravarNota(p.customerId, nota);
      }
      p.status = "respondido";
      p.resposta = texto;
      p.respondidoEm = agora;
      p.respondidoPor = autor;
      this.pendentes = (this.pendentes || []).filter((x) => x.id !== p.id);
      this.fecharModal("fg-popup");
      this.aviso("Resposta enviada ao gestor.");
      this.atualizarHome();
      if (this.lista) this.render();
      const proximo = this.pedidosDoUsuario(user).find((x) => !this.adiados[x.id]);
      if (proximo && !this.souAdmin()) setTimeout(() => this.abrirPopup(proximo.id), 300);
    },
    /** A nota do gestor como está nas ocorrências deste navegador; se ainda não chegou, a cópia gravada no pedido. */
    notaDoPedido(p) {
      const w = window;
      let local = null;
      try {
        if (w.AppState && typeof w.getCustomerNotesList === "function" && typeof w.normalizeCustomerNotesKey === "function") {
          const lista = w.getCustomerNotesList(w.AppState.notes || {}, w.normalizeCustomerNotesKey(p.customerId)) || [];
          local = lista.find((n) => n && (String(n.id) === String(p.notaId) || String(n.followupGestorId || "") === String(p.id))) || null;
        }
      } catch (e) {}
      return local || p.nota || null;
    },
    /** Botão "Responder" da nota nas Ocorrências e Promessas. */
    responderPelaNota(followupId) {
      const p = this.acharPedido(followupId);
      if (p) { this.abrirPopup(p.id); return; }
      this.carregarLista().then(() => {
        const q = this.acharPedido(followupId);
        if (q) this.abrirPopup(q.id);
        else this.aviso("Não achei este pedido do gestor.", "erro");
      });
    },

    /* ---------- Contas a Receber > Follow-up Cobrança ---------- */
    async carregarLista() {
      const fb = this.fb();
      if (!fb) { this.lista = []; return; }
      this.carregandoLista = true;
      try {
        const lista = await fb.listar();
        lista.sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));
        this.lista = lista;
      } catch (e) {
        console.error("[followup-gestor] lista", e);
        this.lista = this.lista || [];
        this.aviso("Não foi possível carregar os pedidos.", "erro");
      } finally {
        this.carregandoLista = false;
      }
    },
    async abrir() {
      const root = document.getElementById("followup-cobranca-root");
      if (root) root.innerHTML = `<div class="cc-page"><div style="text-align:center;padding:40px;color:#64748b;"><div class="spinner" style="margin-bottom:15px;"></div><p>Carregando os pedidos…</p></div></div>`;
      await this.carregarLista();
      this.render();
    },
    visiveis() {
      const lista = this.lista || [];
      if (this.souAdmin()) return lista;
      const user = this.usuario();
      return lista.filter((p) => this.operadorEh(p.operador, user));
    },
    render() {
      const root = document.getElementById("followup-cobranca-root");
      if (!root) return;
      const base = this.visiveis();
      const ops = [];
      const vistos = new Set();
      base.forEach((p) => { const k = this.norm(p.operador); if (p.operador && !vistos.has(k)) { vistos.add(k); ops.push({ id: p.operador, label: p.operador }); } });
      ops.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
      const linhas = base.filter((p) => {
        if (this.filtroSituacao !== "__todos" && p.status !== this.filtroSituacao) return false;
        if (this.filtroOperador !== "__todos" && this.norm(p.operador) !== this.norm(this.filtroOperador)) return false;
        return true;
      });
      const aguardando = base.filter((p) => p.status === "aguardando").length;
      const sel = (id, rotulo, itens, valor, todos) => window.MlSelectUnico
        ? MlSelectUnico.html({ id: id, label: rotulo, items: itens, selectedId: valor, todos: todos ? { id: "__todos", label: todos } : null, semId: true, largura: "240px" })
        : "";
      const situacoes = [{ id: "aguardando", label: "Aguardando resposta" }, { id: "respondido", label: "Respondidos" }];
      const corpo = linhas.length ? linhas.map((p) => {
        const resp = p.status === "respondido";
        const sit = resp
          ? `<span style="color:#166534;font-weight:700;">Respondido em ${this.esc(this.dia(p.respondidoEm))}</span>`
          : `<span style="color:#b45309;font-weight:700;">Aguardando${p.vistoEm ? " · visto" : ""}</span>`;
        return `<tr>
          <td>${this.esc(this.dataHora(p.criadoEm))}</td>
          <td>${this.esc(p.titulo)}</td>
          <td class="fg-cliente" title="${this.esc(p.cliente)}">${this.esc(p.cliente || ("Cliente " + p.customerId))}</td>
          <td title="${this.esc(p.unidade)}">${this.esc(p.unidade || "—")}</td>
          <td title="${this.esc(p.operador)}">${this.esc(p.operador)}</td>
          <td title="${this.esc(p.pedidoPor)}">${this.esc(p.pedidoPor || "—")}</td>
          <td>${sit}</td>
          <td class="is-center">
            <button type="button" class="btn-icon-ge" title="Ver a observação do gestor${resp ? " e a resposta" : ""}" style="background:none;border:none;cursor:pointer;color:#105436;padding:2px;" onclick="FollowupGestor.olho('${this.esc(p.id)}')"><i data-lucide="eye" style="width:16px;height:16px;"></i></button>
            ${!resp && (this.operadorEh(p.operador, this.usuario()) && !this.souAdmin()) ? `<button type="button" class="btn btn-primary btn-sm" style="padding:2px 8px;font-size:0.72rem;margin-left:4px;" onclick="FollowupGestor.abrirPopup('${this.esc(p.id)}')">Responder</button>` : ""}
          </td>
        </tr>`;
      }).join("") : `<tr><td colspan="8" style="text-align:center;padding:30px;">Nenhum pedido para exibir.</td></tr>`;
      root.innerHTML = `<div class="cc-page">
        <p style="margin:0 0 12px;font-size:0.85rem;color:#64748b;line-height:1.45;">Títulos em que o gestor pediu ao operador uma atualização detalhada do caso. O olho mostra a observação do gestor e, depois da resposta, o que o operador escreveu. ${aguardando ? "<strong>" + aguardando + " aguardando resposta.</strong>" : ""}</p>
        <div class="cc-toolbar">
          <div class="cc-filters">
            ${sel("fg-f-sit", "Situação", situacoes, this.filtroSituacao, "Todos")}
            ${this.souAdmin() ? sel("fg-f-op", "Operador", ops, this.filtroOperador, "Todos os operadores") : ""}
          </div>
          <div class="cc-toolbar-actions">
            <button type="button" class="btn btn-primary cc-atualizar" onclick="FollowupGestor.abrir()"><i data-lucide="refresh-cw" style="width:14px;height:14px;"></i> Atualizar</button>
          </div>
        </div>
        <div class="cc-scroll">
          <table class="cc-table fg-table">
            <colgroup><col style="width:130px"><col style="width:80px"><col><col style="width:150px"><col style="width:170px"><col style="width:170px"><col style="width:170px"><col style="width:120px"></colgroup>
            <thead><tr><th>Pedido em</th><th>Título</th><th>Cliente</th><th>Unidade</th><th>Operador</th><th>Pedido por</th><th>Situação</th><th class="is-center"></th></tr></thead>
            <tbody>${corpo}</tbody>
          </table>
        </div>
      </div>`;
      if (window.MlSelectUnico) {
        if (document.getElementById("fg-f-sit")) MlSelectUnico.bind("fg-f-sit", { onSelect: (v) => { this.filtroSituacao = v || "__todos"; this.render(); } });
        if (document.getElementById("fg-f-op")) MlSelectUnico.bind("fg-f-op", { onSelect: (v) => { this.filtroOperador = v || "__todos"; this.render(); } });
      }
      this.icones(root);
    },
    olho(id) {
      const p = this.acharPedido(id);
      if (!p) return;
      const resp = p.status === "respondido";
      this.modal("fg-olho", 1000, `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div>
            <h2 style="margin:0;color:#105436;font-size:1.1rem;">Follow-up do gestor</h2>
            <div style="margin-top:6px;">${this.cabecalhoCliente(p)}</div>
          </div>
          <button type="button" class="btn btn-fechar" onclick="FollowupGestor.fecharModal('fg-olho')">Fechar</button>
        </div>
        <div style="margin:12px 0;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px;">
          <div style="font-size:0.72rem;font-weight:800;color:#166534;text-transform:uppercase;">Observação de ${this.esc(p.pedidoPor || "Gestor")} para ${this.esc(p.operador)} · ${this.esc(this.dataHora(p.criadoEm))}</div>
          <div style="margin-top:4px;font-size:0.9rem;white-space:pre-wrap;">${this.esc(p.mensagem)}</div>
        </div>
        <div style="margin-bottom:12px;background:${resp ? "#eff6ff" : "#fffbeb"};border:1px solid ${resp ? "#bfdbfe" : "#fde68a"};border-radius:10px;padding:10px 12px;">
          ${resp
            ? `<div style="font-size:0.72rem;font-weight:800;color:#1e40af;text-transform:uppercase;">Resposta de ${this.esc(p.respondidoPor)} · ${this.esc(this.dataHora(p.respondidoEm))}</div><div style="margin-top:4px;font-size:0.9rem;white-space:pre-wrap;">${this.esc(p.resposta)}</div>`
            : `<div style="font-size:0.86rem;color:#92400e;font-weight:600;">Aguardando a resposta do operador${p.vistoEm ? " (visto em " + this.esc(this.dataHora(p.vistoEm)) + ")" : ""}.</div>`}
        </div>
        ${this.resumoHtml(p, "fg-olho")}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
          <button type="button" class="btn btn-outline btn-sm" onclick="FollowupGestor.verExtrato('${this.esc(p.id)}', this)"><i data-lucide="file-text" style="width:14px;height:14px;"></i> Visualizar Extrato</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="FollowupGestor.abrirFicha('${this.esc(p.id)}')"><i data-lucide="user-round" style="width:14px;height:14px;"></i> Abrir ficha</button>
        </div>`);
      this.desenharGauge("fg-olho");
    }
  };

  /** Canal das notas deste fluxo: não conta como contato com o cliente. */
  window.isFollowUpGestorCanal = function(canal) {
    return FG.norm(canal) === FG.norm(CANAL);
  };

  window.FollowupGestor = FG;

  // Prévia na gestão de pop-ups (alertas-popup.js): o pop-up real, sem gravar nada.
  window.PopupPrevias = window.PopupPrevias || {};
  window.PopupPrevias["followup-gestor"] = function() { FG.previa(); };
})();
