// FINANCEIRO > CONTAS A RECEBER > ANTECIPAÇÕES
// Títulos em que o cliente pagou parcela antes do vencimento (jan/2024 em diante).
// A tela lê só o Firebase (antecipacoes_mes); quem consulta o Sienge é o batimento das 7h
// (últimos 7 dias) e a carga do histórico. Um evento = título + data do pagamento.
// Desconto de juros = VF - VP (VP = VF / (1+taxa)^meses até o vencimento); desconto comercial = VP - recebido.

(function () {
  const COL = "antecipacoes_mes";
  const INICIO = "2024-01";
  const MESES_NOME = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  function mesAtual() {
    const h = new Date();
    return h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function moeda(v) {
    return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0);
  }
  function pct(v) {
    return (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
  }
  function dataBr(iso) {
    const s = String(iso || "");
    return s.length >= 10 ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : s;
  }
  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  }
  function mesesDoPeriodo(de, ate) {
    const out = [];
    let [y, m] = String(de).split("-").map(Number);
    const [yf, mf] = String(ate).split("-").map(Number);
    while (y < yf || (y === yf && m <= mf)) {
      out.push(y + "-" + String(m).padStart(2, "0"));
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      if (out.length > 120) break;
    }
    return out;
  }

  /** Nome curto da empresa (Configurações > Empresas: nome usual), igual aos relatórios. */
  let _custom = null;
  function nomeEmpresa(id, fallback) {
    if (_custom === null) {
      try { _custom = JSON.parse(localStorage.getItem("crm_empresas_custom") || "{}") || {}; } catch (e) { _custom = {}; }
      if (window.EmpresasState && window.EmpresasState.customFields) _custom = Object.assign({}, _custom, window.EmpresasState.customFields);
    }
    const c = _custom[id] || _custom[String(id)] || {};
    return String(c.nome_usual || c.nome || fallback || ("Empresa " + id)).trim();
  }

  const METRICAS = {
    pago: { rot: "Recebido (R$)", moeda: true, val: (e) => Number(e.pago) || 0 },
    vf: { rot: "Valor das parcelas - VF (R$)", moeda: true, val: (e) => Number(e.vf) || 0 },
    juros: { rot: "Desconto de juros (R$)", moeda: true, val: (e) => Number(e.juros) || 0 },
    comercial: { rot: "Desconto comercial (R$)", moeda: true, val: (e) => Number(e.comercial) || 0 },
    qtd: { rot: "Antecipações (quantidade)", moeda: false, val: () => 1 },
    parcelas: { rot: "Parcelas antecipadas (quantidade)", moeda: false, val: (e) => Number(e.np) || 0 }
  };

  const App = {
    state: {
      de: mesAtual().slice(0, 4) + "-01",
      ate: mesAtual(),
      aba: "analitico",
      empresas: [],
      ccs: [],
      faixa: "31+",
      busca: "",
      limite: 300,
      empOpen: false,
      empQuery: "",
      ccOpen: false,
      ccQuery: "",
      metrica: "pago",
      anosAbertos: new Set([mesAtual().slice(0, 4)]),
      empAbertas: new Set(),
      ccAbertos: new Set(),
      abertos: new Set(),
      carregando: false,
      erro: ""
    },
    _cache: {},      // mes -> { eventos, atualizadoEm }
    _empresas: {},   // id -> nome
    _ccs: {},        // cc -> { nome, emp }

    root() { return document.getElementById("antecipacoes-root"); },

    async init() {
      this.render();
      await this.carregar(false);
    },

    fb() {
      const fx = window.firebaseCollections;
      const db = window.firebaseDb;
      return fx && db && typeof fx.getDoc === "function" ? { fx, db } : null;
    },

    async lerMes(mes, forcar) {
      if (!forcar && this._cache[mes]) return this._cache[mes];
      const f = this.fb();
      if (!f) throw new Error("Firebase não inicializado. Recarregue a página (Ctrl+F5).");
      const meta = await f.fx.getDoc(f.fx.doc(f.db, COL, mes));
      if (!meta.exists()) {
        this._cache[mes] = { eventos: [], atualizadoEm: "", vazio: true };
        return this._cache[mes];
      }
      const md = meta.data() || {};
      const n = Number(md.partes) || 0;
      let texto = "";
      for (let i = 0; i < n; i++) {
        const p = await f.fx.getDoc(f.fx.doc(f.db, COL, mes + "__p" + i));
        if (p.exists()) texto += String((p.data() || {}).texto || "");
      }
      let eventos = [];
      try { eventos = JSON.parse(texto || "[]"); } catch (e) { eventos = []; }
      this._cache[mes] = { eventos: Array.isArray(eventos) ? eventos : [], atualizadoEm: md.atualizadoEm || "" };
      return this._cache[mes];
    },

    async carregar(forcar) {
      const meses = mesesDoPeriodo(this.state.de < INICIO ? INICIO : this.state.de, this.state.ate);
      this.state.carregando = true;
      this.state.erro = "";
      this.paintCorpo();
      try {
        let feito = 0;
        const fila = meses.slice();
        const worker = async () => {
          while (fila.length) {
            const mes = fila.shift();
            await this.lerMes(mes, forcar);
            feito += 1;
            const el = document.getElementById("antc-progresso");
            if (el) el.textContent = `Lendo ${feito} de ${meses.length} mês(es)…`;
          }
        };
        await Promise.all([worker(), worker(), worker()]);
      } catch (e) {
        this.state.erro = (e && e.message) || String(e);
      }
      this.state.carregando = false;
      Object.values(this._cache).forEach((c) => (c.eventos || []).forEach((ev) => {
        if (!ev) return;
        if (ev.emp != null && !this._empresas[ev.emp]) this._empresas[ev.emp] = nomeEmpresa(ev.emp, ev.empNome);
        const cc = String(ev.cc || "");
        if (cc && !this._ccs[cc]) this._ccs[cc] = { nome: ev.ccNome || ("Centro de custo " + cc), emp: String(ev.emp) };
      }));
      this.render();
    },

    /** Período + empresas + empreendimentos + busca (sem a faixa de dias). */
    eventosDoPeriodo() {
      const meses = mesesDoPeriodo(this.state.de, this.state.ate);
      const emp = new Set(this.state.empresas.map(String));
      const ccs = new Set(this.state.ccs.map(String));
      const q = norm(this.state.busca).trim();
      const out = [];
      meses.forEach((mes) => {
        const c = this._cache[mes];
        if (!c) return;
        c.eventos.forEach((ev) => {
          if (emp.size && !emp.has(String(ev.emp))) return;
          if (ccs.size && !ccs.has(String(ev.cc || ""))) return;
          if (q && norm(`${ev.tit} ${ev.cli} ${ev.unid} ${ev.ccNome} ${ev.doc}`).indexOf(q) < 0) return;
          out.push(ev);
        });
      });
      return out;
    },

    /** Com a faixa escolhida (31+ / até 30 / todas). */
    eventosFiltrados() {
      const todos = this.eventosDoPeriodo();
      if (this.state.faixa === "31+") return todos.filter((e) => e.faixa === "31+");
      if (this.state.faixa === "ate30") return todos.filter((e) => e.faixa !== "31+");
      return todos;
    },

    ccItens() {
      const emp = new Set(this.state.empresas.map(String));
      return Object.keys(this._ccs)
        .filter((cc) => !emp.size || emp.has(this._ccs[cc].emp))
        .map((cc) => ({ id: cc, name: this._ccs[cc].nome }));
    },

    totais(lista) {
      const t = { n: lista.length, parc: 0, vf: 0, vp: 0, pago: 0, juros: 0, comercial: 0, comCom: 0 };
      lista.forEach((e) => {
        t.parc += Number(e.np) || 0;
        t.vf += Number(e.vf) || 0;
        t.vp += Number(e.vp) || 0;
        t.pago += Number(e.pago) || 0;
        t.juros += Number(e.juros) || 0;
        t.comercial += Number(e.comercial) || 0;
        if ((Number(e.comercial) || 0) > 0.05 + (Number(e.vf) || 0) * 0.0005) t.comCom += 1;
      });
      return t;
    },

    atualizadoEm() {
      const datas = mesesDoPeriodo(this.state.de, this.state.ate).map((m) => (this._cache[m] || {}).atualizadoEm).filter(Boolean).sort();
      const u = datas[datas.length - 1];
      return u ? new Date(u).toLocaleString("pt-BR") : "";
    },

    render() {
      const root = this.root();
      if (!root) return;
      const empItens = Object.keys(this._empresas).map((id) => ({ id, name: this._empresas[id] }));
      const ccItens = this.ccItens();
      const F = window.MlEmpresaFilter;
      const empHtml = F ? F.html({
        id: "antc-emp", label: "EMPRESAS", items: empItens, selectedIds: this.state.empresas,
        open: this.state.empOpen, query: this.state.empQuery, emptyMeansAll: true, countMode: true
      }) : "";
      const ccHtml = F ? F.html({
        id: "antc-cc", label: "EMPREENDIMENTOS", items: ccItens, selectedIds: this.state.ccs,
        open: this.state.ccOpen, query: this.state.ccQuery, emptyMeansAll: true, countMode: true,
        nouns: { singular: "empreendimento", plural: "empreendimentos" }
      }) : "";
      const abaBtn = (id, rot, icone) => `<button type="button" class="antc-sub${this.state.aba === id ? " is-on" : ""}" onclick="AntecipacoesApp.trocarAba('${id}')"><i data-lucide="${icone}" style="width:15px;height:15px;"></i> ${rot}</button>`;
      root.innerHTML = `
        <div class="cc-page antc-page">
          <div class="antc-subs">
            ${abaBtn("analitico", "Analítico", "table-2")}
            ${abaBtn("indicadores", "Indicadores", "bar-chart-3")}
            ${abaBtn("lista", "Antecipações", "list")}
          </div>
          <div class="antc-toolbar">
            <label class="antc-campo"><span>DE</span><input type="month" id="antc-de" min="${INICIO}" max="${mesAtual()}" value="${esc(this.state.de)}" onchange="AntecipacoesApp.mudarPeriodo()"></label>
            <label class="antc-campo"><span>ATÉ</span><input type="month" id="antc-ate" min="${INICIO}" max="${mesAtual()}" value="${esc(this.state.ate)}" onchange="AntecipacoesApp.mudarPeriodo()"></label>
            <div class="antc-emp">${empHtml}</div>
            <div class="antc-emp">${ccHtml}</div>
            <label class="antc-campo antc-busca"><span>BUSCAR</span><input type="search" id="antc-busca" placeholder="Título, cliente, unidade..." value="${esc(this.state.busca)}" oninput="AntecipacoesApp.buscar(this.value)"></label>
            <button type="button" class="btn btn-primary cc-atualizar" onclick="AntecipacoesApp.carregar(true)"><i data-lucide="refresh-cw" style="width:16px;"></i> Atualizar</button>
            <button type="button" class="btn btn-excel" onclick="AntecipacoesApp.exportar()"><i data-lucide="download" style="width:16px;"></i> Excel</button>
          </div>
          <div id="antc-corpo"></div>
        </div>`;
      if (F) {
        this.bindFiltro("antc-emp", "empresas", "empOpen", "empQuery", empItens, true);
        this.bindFiltro("antc-cc", "ccs", "ccOpen", "ccQuery", ccItens, false);
      }
      this.paintCorpo();
    },

    /** Filtros de múltipla escolha. Mudar a empresa limpa os empreendimentos que não são dela. */
    bindFiltro(id, chave, abertoKey, queryKey, itens, ehEmpresa) {
      const self = this;
      const F = window.MlEmpresaFilter;
      const depois = () => {
        if (ehEmpresa) {
          const permitidos = new Set(self.ccItens().map((x) => String(x.id)));
          self.state.ccs = self.state.ccs.filter((c) => permitidos.has(String(c)));
        }
        self.state.limite = 300;
      };
      F.bind(id, {
        toggleOpen() {
          self.state[abertoKey] = !self.state[abertoKey];
          if (self.state[abertoKey]) { if (ehEmpresa) self.state.ccOpen = false; else self.state.empOpen = false; }
          self.render();
        },
        close() { if (!self.state[abertoKey]) return; self.state[abertoKey] = false; self.render(); },
        setQuery(q) {
          self.state[queryKey] = q;
          const list = document.getElementById(id + "-list");
          if (list) list.innerHTML = F.listHtml({ items: itens, selectedIds: self.state[chave], query: q });
        },
        toggleId(item, on) {
          const set = new Set(self.state[chave].map(String));
          if (on) set.add(String(item)); else set.delete(String(item));
          self.state[chave] = [...set];
          depois();
          F.manterRolagem(id, () => self.render());
        },
        selectAll() { self.state[chave] = itens.map((x) => String(x.id)); depois(); self.render(); },
        selectNone() { self.state[chave] = []; depois(); self.render(); }
      });
    },

    trocarAba(a) {
      this.state.aba = a;
      this.render();
    },

    mudarMetrica(v) {
      this.state.metrica = METRICAS[v] ? v : "pago";
      this.paintCorpo();
    },

    abrirAno(ano) {
      if (this.state.anosAbertos.has(ano)) this.state.anosAbertos.delete(ano); else this.state.anosAbertos.add(ano);
      this.paintCorpo();
    },

    abrirEmpresa(id) {
      if (this.state.empAbertas.has(id)) this.state.empAbertas.delete(id); else this.state.empAbertas.add(id);
      this.paintCorpo();
    },

    abrirCc(id) {
      if (this.state.ccAbertos.has(id)) this.state.ccAbertos.delete(id); else this.state.ccAbertos.add(id);
      this.paintCorpo();
    },

    abrirTudo(abrir) {
      const lista = this.eventosFiltrados();
      if (abrir) {
        lista.forEach((e) => { this.state.empAbertas.add(String(e.emp)); this.state.ccAbertos.add(String(e.emp) + "|" + String(e.cc || "")); });
      } else {
        this.state.empAbertas.clear();
        this.state.ccAbertos.clear();
      }
      this.paintCorpo();
    },

    mudarPeriodo() {
      let de = (document.getElementById("antc-de") || {}).value || this.state.de;
      let ate = (document.getElementById("antc-ate") || {}).value || this.state.ate;
      if (de < INICIO) de = INICIO;
      if (ate < de) ate = de;
      this.state.de = de;
      this.state.ate = ate;
      this.state.limite = 300;
      this.carregar(false);
    },

    buscar(v) {
      this.state.busca = v;
      this.state.limite = 300;
      clearTimeout(this._tBusca);
      this._tBusca = setTimeout(() => this.paintCorpo(), 200);
    },

    faixa(f) {
      this.state.faixa = f;
      this.state.limite = 300;
      this.paintCorpo();
    },

    alternar(k) {
      if (this.state.abertos.has(k)) this.state.abertos.delete(k); else this.state.abertos.add(k);
      this.paintCorpo();
    },

    mais() {
      this.state.limite += 300;
      this.paintCorpo();
    },

    paintCorpo() {
      const box = document.getElementById("antc-corpo");
      if (!box) return;
      if (this.state.carregando) {
        box.innerHTML = `<div class="ml-load"><div class="loading-spinner" aria-hidden="true"></div><span class="loading-status-text" id="antc-progresso">Lendo as antecipações salvas…</span></div>`;
        return;
      }
      if (this.state.erro) {
        box.innerHTML = `<div class="antc-erro">Não foi possível ler as antecipações: ${esc(this.state.erro)}</div>`;
        return;
      }
      const todos = this.eventosDoPeriodo();
      const ate30 = todos.filter((e) => e.faixa !== "31+");
      const mais31 = todos.filter((e) => e.faixa === "31+");
      const lista = (this.state.faixa === "31+" ? mais31 : (this.state.faixa === "ate30" ? ate30 : todos))
        .slice().sort((a, b) => String(b.data).localeCompare(String(a.data)) || (Number(b.vf) || 0) - (Number(a.vf) || 0));
      const semBase = mesesDoPeriodo(this.state.de, this.state.ate).filter((m) => this._cache[m] && this._cache[m].vazio);
      const aba = (id, rot, n) => `<button type="button" class="antc-aba${this.state.faixa === id ? " is-on" : ""}" onclick="AntecipacoesApp.faixa('${id}')">${rot} <small>${n.toLocaleString("pt-BR")}</small></button>`;
      const topo = `
        <div class="antc-abas">
          ${aba("31+", "31 dias ou mais antes do vencimento", mais31.length)}
          ${aba("ate30", "Até 30 dias antes", ate30.length)}
          ${aba("todas", "Todas", todos.length)}
          <span class="antc-info">Base salva no Integra · atualizada pelo batimento das 7h (últimos 7 dias)${this.atualizadoEm() ? " · último: " + esc(this.atualizadoEm()) : ""}</span>
        </div>
        ${semBase.length ? `<div class="antc-aviso">Sem base salva para: ${semBase.map(esc).join(", ")}. Clique em Atualizar; se continuar, esses meses entram no próximo batimento.</div>` : ""}`;
      if (this.state.aba === "analitico") {
        box.innerHTML = topo + this.analiticoHtml(lista);
        if (window.lucide) lucide.createIcons();
        return;
      }
      if (this.state.aba === "indicadores") {
        box.innerHTML = topo + this.indicadoresHtml(lista);
        if (window.lucide) lucide.createIcons();
        return;
      }
      const t = this.totais(lista);
      const linhas = lista.slice(0, this.state.limite).map((e) => this.linhaHtml(e)).join("")
        || `<tr><td colspan="13" style="text-align:center;padding:30px;">Nenhuma antecipação para exibir.</td></tr>`;
      const pctCom = t.vf > 0 ? (t.comercial / t.vf) * 100 : 0;
      const pctJur = t.vf > 0 ? (t.juros / t.vf) * 100 : 0;
      box.innerHTML = `
        ${topo}
        <div class="antc-kpis">
          <div class="antc-kpi"><span>Antecipações</span><b>${t.n.toLocaleString("pt-BR")}</b><small>${t.parc.toLocaleString("pt-BR")} parcela(s)</small></div>
          <div class="antc-kpi"><span>Valor das parcelas (VF)</span><b>${moeda(t.vf)}</b><small>com os juros do parcelamento</small></div>
          <div class="antc-kpi"><span>Recebido</span><b>${moeda(t.pago)}</b><small>valor líquido baixado</small></div>
          <div class="antc-kpi"><span>Desconto de juros</span><b>${moeda(t.juros)}</b><small>${pct(pctJur)} do VF · retirada obrigatória</small></div>
          <div class="antc-kpi ${t.comercial > 0.009 ? "is-alerta" : ""}"><span>Desconto comercial</span><b>${moeda(t.comercial)}</b><small>${pct(pctCom)} do VF · ${t.comCom} título(s) com desconto além dos juros</small></div>
        </div>
        <div class="cc-scroll antc-scroll">
          <table class="cc-table antc-table">
            <colgroup>
              <col style="width:86px"><col style="width:66px"><col><col style="width:150px"><col style="width:70px"><col style="width:58px">
              <col style="width:96px"><col style="width:104px"><col style="width:104px"><col style="width:104px"><col style="width:100px"><col style="width:104px"><col style="width:70px">
            </colgroup>
            <thead><tr>
              <th>Pagamento</th><th>Título</th><th>Cliente</th><th>Empresa</th><th>Unidade</th><th class="is-center">Parc.</th>
              <th class="is-center">Antecedência</th><th class="is-right">VF</th><th class="is-right">Sem juros (VP)</th><th class="is-right">Recebido</th>
              <th class="is-right">Desc. juros</th><th class="is-right">Desc. comercial</th><th class="is-right">% com.</th>
            </tr></thead>
            <tbody>${linhas}</tbody>
          </table>
        </div>
        ${lista.length > this.state.limite ? `<div class="antc-mais"><button type="button" class="btn btn-outline" onclick="AntecipacoesApp.mais()">Mostrar mais (${lista.length - this.state.limite} restantes)</button></div>` : ""}
        <p class="antc-nota">VF = valor da parcela na baixa (com correção). Sem juros (VP) = VF ÷ (1 + taxa do contrato)<sup>meses até o vencimento</sup>. Desconto de juros = VF − VP. Desconto comercial = VP − recebido (negativo: o cliente pagou acima do valor sem juros). Antecipações do mesmo título no mesmo dia formam uma linha. Clique na linha para ver as parcelas.</p>`;
      if (window.lucide) lucide.createIcons();
    },

    // ---------- Aba Analítico: empresa > empreendimento > título, meses agrupados por ano ----------
    analiticoHtml(lista) {
      const m = METRICAS[this.state.metrica] || METRICAS.pago;
      const fmt = (v) => (m.moeda ? moeda(v) : (Number(v) || 0).toLocaleString("pt-BR"));
      const meses = mesesDoPeriodo(this.state.de, this.state.ate);
      const anos = [...new Set(meses.map((x) => x.slice(0, 4)))];
      // Colunas: ano aberto = meses do ano + total do ano; ano fechado = só o total do ano.
      const colunas = [];
      anos.forEach((ano) => {
        const doAno = meses.filter((x) => x.slice(0, 4) === ano);
        if (this.state.anosAbertos.has(ano)) doAno.forEach((mes) => colunas.push({ tipo: "mes", mes, ano }));
        colunas.push({ tipo: "ano", ano, aberto: this.state.anosAbertos.has(ano) });
      });
      const novo = () => ({ meses: {}, total: 0 });
      const somar = (no, ev) => {
        const v = m.val(ev);
        const mes = String(ev.data).slice(0, 7);
        no.meses[mes] = (no.meses[mes] || 0) + v;
        no.total += v;
      };
      const arvore = {};
      const geral = novo();
      lista.forEach((ev) => {
        const emp = String(ev.emp);
        const cc = String(ev.cc || "");
        const e = arvore[emp] = arvore[emp] || Object.assign(novo(), { ccs: {} });
        const c = e.ccs[cc] = e.ccs[cc] || Object.assign(novo(), { tits: {} });
        const t = c.tits[ev.tit] = c.tits[ev.tit] || Object.assign(novo(), { cli: ev.cli, unid: ev.unid });
        [e, c, t, geral].forEach((no) => somar(no, ev));
      });
      const celulas = (no) => colunas.map((col) => {
        let v = 0;
        if (col.tipo === "mes") v = no.meses[col.mes] || 0;
        else Object.keys(no.meses).forEach((k) => { if (k.slice(0, 4) === col.ano) v += no.meses[k]; });
        return `<td class="is-right${col.tipo === "ano" ? " antc-col-ano" : ""}">${v ? fmt(v) : ""}</td>`;
      }).join("") + `<td class="is-right antc-col-total">${fmt(no.total)}</td>`;
      const porTotal = (obj) => Object.keys(obj).sort((a, b) => obj[b].total - obj[a].total);
      let corpo = "";
      porTotal(arvore).forEach((emp) => {
        const e = arvore[emp];
        const aberta = this.state.empAbertas.has(emp);
        corpo += `<tr class="antc-n1" onclick="AntecipacoesApp.abrirEmpresa('${esc(emp)}')">
          <td class="antc-rot"><i data-lucide="${aberta ? "minus-square" : "plus-square"}" class="antc-ic"></i>${esc(this._empresas[emp] || nomeEmpresa(emp))}</td>${celulas(e)}</tr>`;
        if (!aberta) return;
        porTotal(e.ccs).forEach((cc) => {
          const c = e.ccs[cc];
          const chave = emp + "|" + cc;
          const ccAberto = this.state.ccAbertos.has(chave);
          const nomeCc = cc ? `${cc} - ${(this._ccs[cc] || {}).nome || ""}` : "Sem centro de custo";
          corpo += `<tr class="antc-n2" onclick="AntecipacoesApp.abrirCc('${esc(chave)}')">
            <td class="antc-rot" title="${esc(nomeCc)}"><i data-lucide="${ccAberto ? "minus-square" : "plus-square"}" class="antc-ic"></i>${esc(nomeCc)}</td>${celulas(c)}</tr>`;
          if (!ccAberto) return;
          porTotal(c.tits).forEach((tit) => {
            const t = c.tits[tit];
            const rot = `${tit} - ${t.cli}${t.unid ? " (" + t.unid + ")" : ""}`;
            corpo += `<tr class="antc-n3"><td class="antc-rot" title="${esc(rot)}">${esc(rot)}</td>${celulas(t)}</tr>`;
          });
        });
      });
      if (!corpo) corpo = `<tr><td colspan="${colunas.length + 2}" style="text-align:center;padding:30px;">Nenhuma antecipação para exibir.</td></tr>`;
      // Cabeçalho em duas linhas: ano (clicável para abrir/fechar os meses) e, embaixo, os meses.
      let h1 = `<th rowspan="2" class="antc-rot">Empresa / Empreendimento / Título</th>`;
      anos.forEach((ano) => {
        const aberto = this.state.anosAbertos.has(ano);
        const n = aberto ? meses.filter((x) => x.slice(0, 4) === ano).length + 1 : 1;
        h1 += `<th colspan="${n}" class="is-center antc-th-ano" onclick="AntecipacoesApp.abrirAno('${ano}')" title="${aberto ? "Agrupar o ano" : "Abrir os meses"}"><i data-lucide="${aberto ? "minus-square" : "plus-square"}" class="antc-ic"></i>${ano}</th>`;
      });
      h1 += `<th rowspan="2" class="is-right">Total</th>`;
      const h2 = colunas.map((col) => col.tipo === "mes"
        ? `<th class="is-right">${MESES_NOME[Number(col.mes.slice(5, 7)) - 1]}</th>`
        : `<th class="is-right antc-col-ano">${col.aberto ? "Total " + col.ano : col.ano}</th>`).join("");
      const largura = 340 + (colunas.length + 1) * 104;
      const opcoes = Object.keys(METRICAS).map((k) => `<option value="${k}"${k === this.state.metrica ? " selected" : ""}>${esc(METRICAS[k].rot)}</option>`).join("");
      return `
        <div class="antc-analit-bar">
          <label class="antc-campo"><span>VALOR EXIBIDO</span><select onchange="AntecipacoesApp.mudarMetrica(this.value)">${opcoes}</select></label>
          <button type="button" class="btn btn-outline" onclick="AntecipacoesApp.abrirTudo(true)"><i data-lucide="chevrons-down" style="width:15px;"></i> Expandir empresas e empreendimentos</button>
          <button type="button" class="btn btn-outline" onclick="AntecipacoesApp.abrirTudo(false)"><i data-lucide="chevrons-up" style="width:15px;"></i> Recolher</button>
          <span class="antc-info">Clique no ano para abrir ou agrupar os meses. Clique na empresa e no empreendimento para descer de nível.</span>
        </div>
        <div class="cc-scroll antc-scroll antc-analit-scroll">
          <table class="cc-table antc-analit" style="width:${largura}px;min-width:100%;">
            <colgroup><col style="width:340px">${colunas.map(() => `<col style="width:104px">`).join("")}<col style="width:110px"></colgroup>
            <thead><tr>${h1}</tr><tr>${h2}</tr></thead>
            <tbody>${corpo}
              <tr class="antc-total"><td class="antc-rot">Total</td>${celulas(geral)}</tr>
            </tbody>
          </table>
        </div>
        <p class="antc-nota">Mês = data do pagamento antecipado. ${esc(m.rot)}. Empreendimento = centro de custo do recebimento no Sienge.</p>`;
    },

    // ---------- Aba Indicadores ----------
    indicadoresHtml(lista) {
      const t = this.totais(lista);
      const contratos = new Set(lista.map((e) => String(e.tit))).size;
      const mediaCt = contratos ? t.pago / contratos : 0;
      const mediaParc = contratos ? t.parc / contratos : 0;
      const pctCom = t.vf > 0 ? (t.comercial / t.vf) * 100 : 0;
      const pctJur = t.vf > 0 ? (t.juros / t.vf) * 100 : 0;
      const mi = (v) => {
        const n = Number(v) || 0;
        if (Math.abs(n) >= 1e6) return (n / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " Mi";
        if (Math.abs(n) >= 1e3) return (n / 1e3).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " mil";
        return moeda(n);
      };
      // Barras verticais (ano e mês)
      const colunas = (pares) => {
        const max = Math.max(1, ...pares.map((p) => p.v));
        return `<div class="antc-barras">${pares.map((p) => `
          <div class="antc-barra" title="${esc(p.rot)}: ${moeda(p.v)}">
            <span class="antc-barra-val">${p.v ? mi(p.v) : ""}</span>
            <div class="antc-barra-col" style="height:${Math.max(2, Math.round((p.v / max) * 140))}px"></div>
            <span class="antc-barra-rot">${esc(p.rot)}</span>
          </div>`).join("")}</div>`;
      };
      const porAno = {};
      const porMes = {};
      lista.forEach((e) => {
        const ano = String(e.data).slice(0, 4);
        const mes = String(e.data).slice(0, 7);
        porAno[ano] = (porAno[ano] || 0) + (Number(e.pago) || 0);
        porMes[mes] = (porMes[mes] || 0) + (Number(e.pago) || 0);
      });
      const meses = mesesDoPeriodo(this.state.de, this.state.ate).slice(-12);
      const anos = [...new Set(mesesDoPeriodo(this.state.de, this.state.ate).map((x) => x.slice(0, 4)))];
      // Faixas de valor por antecipação (recebido)
      const faixas = [
        ["Até 1 mil", 0, 1000], ["1 a 5 mil", 1000, 5000], ["5 a 10 mil", 5000, 10000],
        ["10 a 30 mil", 10000, 30000], ["30 a 50 mil", 30000, 50000], ["Acima de 50 mil", 50000, Infinity]
      ].map(([rot, de, ate]) => {
        const l = lista.filter((e) => (Number(e.pago) || 0) > de - (de ? 0 : 1) && (Number(e.pago) || 0) <= ate);
        return { rot, v: l.reduce((s, e) => s + (Number(e.pago) || 0), 0), n: l.length };
      });
      const maxF = Math.max(1, ...faixas.map((f) => f.v));
      const faixasHtml = faixas.map((f) => `
        <div class="antc-hbar">
          <span class="antc-hbar-rot">${esc(f.rot)}</span>
          <div class="antc-hbar-trilho"><div class="antc-hbar-col" style="width:${Math.max(1, Math.round((f.v / maxF) * 100))}%"></div></div>
          <span class="antc-hbar-val">${mi(f.v)} <small>${f.n.toLocaleString("pt-BR")}</small></span>
        </div>`).join("");
      // Tabelas por empresa e por empreendimento
      const agrupar = (chaveFn, nomeFn) => {
        const g = {};
        lista.forEach((e) => {
          const k = chaveFn(e);
          const x = g[k] = g[k] || { nome: nomeFn(e), pago: 0, tits: new Set(), parc: 0, comercial: 0 };
          x.pago += Number(e.pago) || 0;
          x.tits.add(String(e.tit));
          x.parc += Number(e.np) || 0;
          x.comercial += Number(e.comercial) || 0;
        });
        return Object.values(g).sort((a, b) => b.pago - a.pago);
      };
      const tabela = (titulo, linhas) => `
        <div class="antc-ind-tab">
          <div class="antc-ind-tit">${esc(titulo)}</div>
          <div class="cc-scroll" style="max-height:340px;">
            <table class="cc-table">
              <colgroup><col><col style="width:110px"><col style="width:64px"><col style="width:96px"><col style="width:70px"><col style="width:100px"></colgroup>
              <thead><tr><th>Nome</th><th class="is-right">Recebido</th><th class="is-right">Qtde. CT</th><th class="is-right">Média por CT</th><th class="is-right">Méd. parc.</th><th class="is-right">Desc. comercial</th></tr></thead>
              <tbody>${linhas.map((x) => `<tr>
                <td title="${esc(x.nome)}">${esc(x.nome)}</td><td class="is-right">${moeda(x.pago)}</td><td class="is-right">${x.tits.size}</td>
                <td class="is-right">${moeda(x.tits.size ? x.pago / x.tits.size : 0)}</td>
                <td class="is-right">${x.tits.size ? Math.round(x.parc / x.tits.size) : 0}</td><td class="is-right">${moeda(x.comercial)}</td></tr>`).join("")
                || `<tr><td colspan="6" style="text-align:center;padding:30px;">Nenhuma antecipação para exibir.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>`;
      const porEmpresa = agrupar((e) => String(e.emp), (e) => this._empresas[e.emp] || nomeEmpresa(e.emp, e.empNome));
      const porCc = agrupar((e) => String(e.cc || ""), (e) => (e.cc ? `${e.cc} - ${e.ccNome || ""}` : "Sem centro de custo"));
      return `
        <div class="antc-kpis">
          <div class="antc-kpi"><span>Antecipação (recebido)</span><b>${moeda(t.pago)}</b><small>${t.n.toLocaleString("pt-BR")} antecipação(ões)</small></div>
          <div class="antc-kpi"><span>Contratos com antecipação</span><b>${contratos.toLocaleString("pt-BR")}</b><small>títulos distintos no período</small></div>
          <div class="antc-kpi"><span>Média por contrato</span><b>${moeda(mediaCt)}</b><small>recebido ÷ contratos</small></div>
          <div class="antc-kpi"><span>Média de parcelas antecipadas</span><b>${mediaParc.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</b><small>parcelas ÷ contratos (${t.parc.toLocaleString("pt-BR")} parcelas)</small></div>
          <div class="antc-kpi"><span>Desconto de juros</span><b>${moeda(t.juros)}</b><small>${pct(pctJur)} do valor das parcelas</small></div>
          <div class="antc-kpi ${t.comercial > 0.009 ? "is-alerta" : ""}"><span>Desconto comercial</span><b>${moeda(t.comercial)}</b><small>${pct(pctCom)} do VF · ${t.comCom} título(s)</small></div>
        </div>
        <div class="antc-graficos">
          <div class="antc-graf"><div class="antc-ind-tit">Total por ano</div>${colunas(anos.map((a) => ({ rot: a, v: porAno[a] || 0 })))}</div>
          <div class="antc-graf antc-graf-larga"><div class="antc-ind-tit">Últimos ${meses.length} meses do período</div>${colunas(meses.map((x) => ({ rot: MESES_NOME[Number(x.slice(5, 7)) - 1] + "/" + x.slice(2, 4), v: porMes[x] || 0 })))}</div>
          <div class="antc-graf"><div class="antc-ind-tit">Por faixa de valor da antecipação</div>${faixasHtml}</div>
        </div>
        <div class="antc-ind-tabs">
          ${tabela("Por empresa", porEmpresa)}
          ${tabela("Por empreendimento", porCc)}
        </div>
        <p class="antc-nota">Valores pelo recebido (valor líquido baixado) e pela data do pagamento. Use as faixas acima (31+ / até 30 / todas) e os filtros de empresa e empreendimento.</p>`;
    },

    linhaHtml(e) {
      const aberto = this.state.abertos.has(e.k);
      const com = Number(e.comercial) || 0;
      const pctCom = e.vf > 0 ? (com / e.vf) * 100 : 0;
      const tolerancia = 0.05 + (Number(e.vf) || 0) * 0.0005;
      const clsCom = com > tolerancia ? "antc-com" : (com < -tolerancia ? "antc-neg" : "");
      const antec = e.minDias === e.maxDias ? `${e.maxDias} d` : `${e.minDias}–${e.maxDias} d`;
      const kJs = esc(JSON.stringify(e.k));
      let html = `<tr class="antc-linha${aberto ? " is-aberto" : ""}" onclick='AntecipacoesApp.alternar(${kJs})' title="Clique para ver as parcelas">
        <td>${dataBr(e.data)}</td>
        <td>${esc(e.tit)}</td>
        <td title="${esc(e.cli)}">${esc(e.cli)}</td>
        <td title="${esc(e.empNome)}">${esc(this._empresas[e.emp] || e.empNome)}</td>
        <td>${esc(e.unid)}</td>
        <td class="is-center">${e.np}</td>
        <td class="is-center">${antec}</td>
        <td class="is-right">${moeda(e.vf)}</td>
        <td class="is-right">${moeda(e.vp)}</td>
        <td class="is-right">${moeda(e.pago)}</td>
        <td class="is-right">${moeda(e.juros)}</td>
        <td class="is-right ${clsCom}">${moeda(com)}</td>
        <td class="is-right ${clsCom}">${Math.abs(com) > tolerancia ? pct(pctCom) : "—"}</td>
      </tr>`;
      if (aberto) {
        const parc = (e.parcelas || []).map((p) => `<tr>
            <td>${esc(p[0])}</td><td>${esc(p[1])}</td><td>${dataBr(p[2])}</td><td class="is-center">${p[3]}</td>
            <td class="is-right">${moeda(p[4])}</td><td class="is-right">${moeda(p[5])}</td><td class="is-right">${moeda(p[6])}</td>
            <td class="is-right">${moeda((Number(p[4]) || 0) - (Number(p[5]) || 0))}</td><td class="is-right">${moeda(p[7])}</td>
          </tr>`).join("");
        html += `<tr class="antc-detalhe"><td colspan="13">
          <div class="antc-det-info">Taxa do contrato: ${String(e.taxa || 0).replace(".", ",")}% a.m. (${e.tipoJuros === "P" ? "Price" : esc(e.tipoJuros || "—")}) · Documento ${esc(e.doc || "—")} · Centro de custo ${esc(e.cc)} ${esc(e.ccNome || "")}</div>
          <table class="cc-table antc-det">
            <colgroup><col style="width:70px"><col style="width:60px"><col style="width:96px"><col style="width:90px"><col><col><col><col><col></colgroup>
            <thead><tr><th>Parcela</th><th>Cond.</th><th>Vencimento</th><th class="is-center">Dias antes</th><th class="is-right">VF</th><th class="is-right">Sem juros (VP)</th><th class="is-right">Recebido</th><th class="is-right">Juros retirados</th><th class="is-right">Desconto no Sienge</th></tr></thead>
            <tbody>${parc}</tbody>
          </table>
          <div class="antc-det-info">No Sienge o desconto de uma antecipação com várias parcelas é dividido por igual entre elas; por isso a separação juros × comercial é feita no total da linha.</div>
        </td></tr>`;
      }
      return html;
    },

    exportar() {
      if (typeof XLSX === "undefined") { alert("Exportação indisponível nesta página."); return; }
      const todos = this.eventosDoPeriodo();
      const lista = (this.state.faixa === "31+" ? todos.filter((e) => e.faixa === "31+")
        : (this.state.faixa === "ate30" ? todos.filter((e) => e.faixa !== "31+") : todos))
        .slice().sort((a, b) => String(a.data).localeCompare(String(b.data)));
      if (!lista.length) { alert("Nenhuma antecipação para exportar."); return; }
      const ev = lista.map((e) => ({
        "Pagamento": dataBr(e.data), "Título": e.tit, "Cliente": e.cli, "Empresa": e.empNome, "Unidade": e.unid,
        "Centro de custo": e.cc, "Nome do centro de custo": e.ccNome, "Documento": e.doc,
        "Faixa": e.faixa === "31+" ? "31 dias ou mais" : "Até 30 dias",
        "Parcelas": e.np, "Dias antes (menor)": e.minDias, "Dias antes (maior)": e.maxDias,
        "Taxa a.m. (%)": e.taxa, "VF": e.vf, "Sem juros (VP)": e.vp, "Recebido": e.pago,
        "Desconto de juros": e.juros, "Desconto comercial": e.comercial, "Desconto total": e.descTotal,
        "% comercial s/ VF": e.vf ? Math.round((e.comercial / e.vf) * 10000) / 100 : 0
      }));
      const pa = [];
      lista.forEach((e) => (e.parcelas || []).forEach((p) => pa.push({
        "Pagamento": dataBr(e.data), "Título": e.tit, "Cliente": e.cli, "Parcela": p[0], "Condição": p[1],
        "Vencimento": dataBr(p[2]), "Dias antes": p[3], "VF": p[4], "Sem juros (VP)": p[5], "Recebido": p[6],
        "Juros retirados": Math.round(((Number(p[4]) || 0) - (Number(p[5]) || 0)) * 100) / 100, "Desconto no Sienge": p[7]
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ev), "Antecipações");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pa), "Parcelas");
      const rot = this.state.faixa === "31+" ? "31-dias-ou-mais" : (this.state.faixa === "ate30" ? "ate-30-dias" : "todas");
      XLSX.writeFile(wb, `antecipacoes_${rot}_${this.state.de}_a_${this.state.ate}.xlsx`);
    }
  };

  window.AntecipacoesApp = App;

  (function css() {
    if (document.getElementById("antc-css")) return;
    const st = document.createElement("style");
    st.id = "antc-css";
    st.textContent = `
      .antc-toolbar { display:flex; flex-wrap:wrap; align-items:flex-end; gap:10px; margin-bottom:12px; }
      .antc-campo { display:flex; flex-direction:column; gap:4px; font-size:0.7rem; font-weight:700; color:#6d8c7c; }
      .antc-campo input { height:38px; padding:0 10px; border:1px solid #e0e5e0; border-radius:6px; font-size:0.85rem; background:#fff; }
      .antc-busca { flex:1 1 220px; }
      .antc-emp { min-width:220px; }
      .antc-toolbar .btn { height:38px; display:inline-flex; align-items:center; gap:6px; }
      .antc-abas { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-bottom:10px; }
      .antc-aba { height:34px; padding:0 12px; border:1px solid #cfe3d7; background:#fff; color:#105436; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer; }
      .antc-aba small { margin-left:4px; padding:1px 7px; border-radius:99px; background:#e7f6ee; font-size:0.7rem; }
      .antc-aba.is-on { background:#1b8253; color:#fff; border-color:#1b8253; }
      .antc-aba.is-on small { background:rgba(255,255,255,0.2); color:#fff; }
      .antc-info { margin-left:auto; font-size:0.72rem; color:#64748b; }
      .antc-aviso { background:#fef3c7; color:#92400e; border-radius:6px; padding:8px 10px; font-size:0.8rem; margin-bottom:10px; }
      .antc-erro { background:#fee2e2; color:#991b1b; border-radius:6px; padding:12px; }
      .antc-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin-bottom:12px; }
      .antc-kpi { border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; background:#fff; display:flex; flex-direction:column; gap:2px; }
      .antc-kpi span { font-size:0.7rem; font-weight:700; color:#6d8c7c; text-transform:uppercase; }
      .antc-kpi b { font-size:1.15rem; color:#105436; font-variant-numeric:tabular-nums; }
      .antc-kpi small { font-size:0.72rem; color:#64748b; }
      .antc-kpi.is-alerta b { color:#b45309; }
      .antc-scroll { max-height:62vh; }
      .antc-table td.is-right, .antc-det td.is-right { font-variant-numeric:tabular-nums; }
      .antc-linha { cursor:pointer; }
      .antc-linha.is-aberto td { background:#e7f6ee; color:#105436; font-weight:700; }
      .antc-com { color:#b45309 !important; font-weight:700; }
      .antc-neg { color:#64748b !important; }
      .antc-detalhe > td { background:#f8fafc !important; padding:8px 10px !important; white-space:normal !important; }
      .antc-det { margin:6px 0; }
      .antc-det-info { font-size:0.72rem; color:#475569; margin:2px 0; }
      .antc-mais { text-align:center; margin:10px 0; }
      .antc-nota { font-size:0.72rem; color:#64748b; margin-top:8px; line-height:1.45; }
      .antc-subs { display:flex; gap:6px; margin-bottom:12px; border-bottom:1px solid #e2e8f0; }
      .antc-sub { display:inline-flex; align-items:center; gap:6px; height:36px; padding:0 14px; border:0; border-bottom:3px solid transparent; background:transparent; color:#475569; font-weight:700; font-size:0.85rem; cursor:pointer; }
      .antc-sub.is-on { color:#105436; border-bottom-color:#1b8253; }
      .antc-analit-bar { display:flex; flex-wrap:wrap; align-items:flex-end; gap:10px; margin-bottom:10px; }
      .antc-analit-bar select { height:36px; padding:0 10px; border:1px solid #e0e5e0; border-radius:6px; font-size:0.85rem; background:#fff; }
      .antc-analit-bar .btn { height:36px; display:inline-flex; align-items:center; gap:6px; }
      .antc-analit-bar .antc-info { margin-left:0; }
      .antc-analit-scroll { max-height:68vh; overflow:auto; }
      .antc-analit td, .antc-analit th { font-variant-numeric:tabular-nums; }
      .antc-analit thead tr:nth-child(2) th { top:24px; }
      .antc-analit .antc-rot { position:sticky; left:0; z-index:1; background:inherit; }
      .antc-analit thead th.antc-rot { z-index:3; background:#1b8253; }
      .antc-analit tbody td.antc-rot { background:#fff; }
      .antc-analit tbody tr:nth-child(even) td.antc-rot { background:#f7faf8; }
      .antc-th-ano { cursor:pointer; }
      .antc-ic { width:13px; height:13px; vertical-align:-2px; margin-right:6px; }
      .antc-n1, .antc-n2 { cursor:pointer; }
      .antc-n1 td, .antc-n1 td.antc-rot { background:#e7f6ee !important; color:#105436; font-weight:700; }
      .antc-n2 td.antc-rot { padding-left:24px !important; font-weight:600; }
      .antc-n3 td.antc-rot { padding-left:46px !important; color:#334155; }
      .antc-col-ano { font-weight:700; background-color:rgba(16,84,54,0.04); }
      .antc-col-total { font-weight:700; }
      .antc-total td, .antc-total td.antc-rot { background:#105436 !important; color:#fff !important; font-weight:700; }
      .antc-graficos { display:grid; grid-template-columns: minmax(200px,1fr) minmax(320px,2fr) minmax(260px,1.3fr); gap:12px; margin-bottom:12px; }
      .antc-graf { border:1px solid #e2e8f0; border-radius:8px; background:#fff; padding:10px 12px; min-width:0; }
      .antc-ind-tit { font-size:0.75rem; font-weight:700; color:#105436; text-transform:uppercase; margin-bottom:8px; }
      .antc-barras { display:flex; align-items:flex-end; gap:6px; height:190px; overflow-x:auto; }
      .antc-barra { flex:1 1 0; min-width:34px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; }
      .antc-barra-col { width:70%; background:#1b8253; border-radius:3px 3px 0 0; }
      .antc-barra-val { font-size:0.62rem; color:#334155; margin-bottom:2px; white-space:nowrap; }
      .antc-barra-rot { font-size:0.65rem; color:#64748b; margin-top:4px; white-space:nowrap; }
      .antc-hbar { display:grid; grid-template-columns:96px 1fr auto; align-items:center; gap:8px; margin-bottom:8px; font-size:0.75rem; }
      .antc-hbar-rot { color:#475569; }
      .antc-hbar-trilho { background:#f1f5f9; border-radius:3px; height:16px; }
      .antc-hbar-col { background:#1b8253; height:100%; border-radius:3px; }
      .antc-hbar-val { font-weight:700; color:#105436; white-space:nowrap; font-variant-numeric:tabular-nums; }
      .antc-hbar-val small { font-weight:400; color:#64748b; margin-left:4px; }
      .antc-ind-tabs { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
      @media (max-width: 1100px) { .antc-graficos, .antc-ind-tabs { grid-template-columns:1fr; } }
    `;
    document.head.appendChild(st);
  })();

  // Carga sob demanda: depois que o arquivo baixa, o switchTab roda de novo e dispara o tabChanged.
  document.addEventListener("tabChanged", (e) => {
    if (e.detail === "antecipacoes") App.init();
  });
})();
