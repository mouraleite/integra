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

  const App = {
    state: {
      de: mesAtual().slice(0, 4) + "-01",
      ate: mesAtual(),
      empresas: [],
      faixa: "31+",
      busca: "",
      limite: 300,
      empOpen: false,
      empQuery: "",
      abertos: new Set(),
      carregando: false,
      erro: ""
    },
    _cache: {},      // mes -> { eventos, atualizadoEm }
    _empresas: {},   // id -> nome

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
        if (ev && ev.emp != null && !this._empresas[ev.emp]) this._empresas[ev.emp] = ev.empNome || ("Empresa " + ev.emp);
      }));
      this.render();
    },

    eventosDoPeriodo() {
      const meses = mesesDoPeriodo(this.state.de, this.state.ate);
      const emp = new Set(this.state.empresas.map(String));
      const q = norm(this.state.busca).trim();
      const out = [];
      meses.forEach((mes) => {
        const c = this._cache[mes];
        if (!c) return;
        c.eventos.forEach((ev) => {
          if (emp.size && !emp.has(String(ev.emp))) return;
          if (q && norm(`${ev.tit} ${ev.cli} ${ev.unid} ${ev.ccNome} ${ev.doc}`).indexOf(q) < 0) return;
          out.push(ev);
        });
      });
      return out;
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
      const empHtml = window.MlEmpresaFilter ? window.MlEmpresaFilter.html({
        id: "antc-emp",
        label: "EMPRESAS",
        items: empItens,
        selectedIds: this.state.empresas,
        open: this.state.empOpen,
        query: this.state.empQuery,
        emptyMeansAll: true,
        countMode: true
      }) : "";
      root.innerHTML = `
        <div class="cc-page antc-page">
          <div class="antc-toolbar">
            <label class="antc-campo"><span>DE</span><input type="month" id="antc-de" min="${INICIO}" max="${mesAtual()}" value="${esc(this.state.de)}" onchange="AntecipacoesApp.mudarPeriodo()"></label>
            <label class="antc-campo"><span>ATÉ</span><input type="month" id="antc-ate" min="${INICIO}" max="${mesAtual()}" value="${esc(this.state.ate)}" onchange="AntecipacoesApp.mudarPeriodo()"></label>
            <div class="antc-emp">${empHtml}</div>
            <label class="antc-campo antc-busca"><span>BUSCAR</span><input type="search" id="antc-busca" placeholder="Título, cliente, unidade..." value="${esc(this.state.busca)}" oninput="AntecipacoesApp.buscar(this.value)"></label>
            <button type="button" class="btn btn-primary cc-atualizar" onclick="AntecipacoesApp.carregar(true)"><i data-lucide="refresh-cw" style="width:16px;"></i> Atualizar</button>
            <button type="button" class="btn btn-excel" onclick="AntecipacoesApp.exportar()"><i data-lucide="download" style="width:16px;"></i> Excel</button>
          </div>
          <div id="antc-corpo"></div>
        </div>`;
      if (window.MlEmpresaFilter) this.bindEmpresas(empItens);
      this.paintCorpo();
    },

    bindEmpresas(itens) {
      const self = this;
      window.MlEmpresaFilter.bind("antc-emp", {
        toggleOpen() { self.state.empOpen = !self.state.empOpen; self.render(); },
        close() { if (!self.state.empOpen) return; self.state.empOpen = false; self.render(); },
        setQuery(q) {
          self.state.empQuery = q;
          const list = document.getElementById("antc-emp-list");
          if (list) list.innerHTML = window.MlEmpresaFilter.listHtml({ items: itens, selectedIds: self.state.empresas, query: q });
        },
        toggleId(id, on) {
          const set = new Set(self.state.empresas.map(String));
          if (on) set.add(String(id)); else set.delete(String(id));
          self.state.empresas = [...set];
          window.MlEmpresaFilter.manterRolagem("antc-emp", () => self.render());
        },
        selectAll() { self.state.empresas = itens.map((x) => String(x.id)); self.render(); },
        selectNone() { self.state.empresas = []; self.render(); }
      });
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
      const t = this.totais(lista);
      const semBase = mesesDoPeriodo(this.state.de, this.state.ate).filter((m) => this._cache[m] && this._cache[m].vazio);
      const aba = (id, rot, n) => `<button type="button" class="antc-aba${this.state.faixa === id ? " is-on" : ""}" onclick="AntecipacoesApp.faixa('${id}')">${rot} <small>${n}</small></button>`;
      const linhas = lista.slice(0, this.state.limite).map((e) => this.linhaHtml(e)).join("")
        || `<tr><td colspan="13" style="text-align:center;padding:30px;">Nenhuma antecipação para exibir.</td></tr>`;
      const pctCom = t.vf > 0 ? (t.comercial / t.vf) * 100 : 0;
      const pctJur = t.vf > 0 ? (t.juros / t.vf) * 100 : 0;
      box.innerHTML = `
        <div class="antc-abas">
          ${aba("31+", "31 dias ou mais antes do vencimento", mais31.length)}
          ${aba("ate30", "Até 30 dias antes", ate30.length)}
          ${aba("todas", "Todas", todos.length)}
          <span class="antc-info">Base salva no Integra · atualizada pelo batimento das 7h (últimos 7 dias)${this.atualizadoEm() ? " · último: " + esc(this.atualizadoEm()) : ""}</span>
        </div>
        ${semBase.length ? `<div class="antc-aviso">Sem base salva para: ${semBase.map(esc).join(", ")}. Esses meses entram no próximo batimento ou na carga do histórico.</div>` : ""}
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
        <td title="${esc(e.empNome)}">${esc(e.empNome)}</td>
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
    `;
    document.head.appendChild(st);
  })();

  // Carga sob demanda: depois que o arquivo baixa, o switchTab roda de novo e dispara o tabChanged.
  document.addEventListener("tabChanged", (e) => {
    if (e.detail === "antecipacoes") App.init();
  });
})();
