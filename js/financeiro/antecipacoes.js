// FINANCEIRO > CONTAS A RECEBER > ANTECIPAÇÕES
// Títulos em que o cliente pagou parcela antes do vencimento (jan/2024 em diante).
// A tela lê só o Supabase (antecipacoes_mes); quem consulta o Sienge é o batimento das 7h
// (últimos 7 dias) e a carga do histórico. Um evento = título + data do pagamento.
// Desconto de juros = VF - VP (VP = VF / (1+taxa)^meses até o vencimento); desconto comercial = VP - recebido.

(function () {
  const INICIO = "2024-01";
  const MESES_NOME = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  function mesAtual() {
    const h = new Date();
    return h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0");
  }
  function hojeIso() {
    const h = new Date();
    return h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0") + "-" + String(h.getDate()).padStart(2, "0");
  }
  function isoMenosDias(iso, n) {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() - n);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
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
      de: hojeIso().slice(0, 4) + "-01-01",
      ate: hojeIso(),
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
      titAbertos: new Set(),
      nivel: 1,
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

    // antecipacoes_mes (+ antecipacoes_mes_eventos) está no Supabase (window.DadosFinanceiro): as partes __pN com o
    // texto JSON viraram uma linha por evento.
    async lerMes(mes, forcar) {
      if (!forcar && this._cache[mes]) return this._cache[mes];
      if (!window.DadosFinanceiro) throw new Error("Supabase não inicializado. Recarregue a página (Ctrl+F5).");
      // { eventos, atualizadoEm, fonte } ou { eventos: [], atualizadoEm: "", vazio: true } se o mês não existe.
      const r = await window.DadosFinanceiro.lerMesAntecipacoes(mes);
      this._cache[mes] = r.vazio ? r : { eventos: Array.isArray(r.eventos) ? r.eventos : [], atualizadoEm: r.atualizadoEm || "" };
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
        if (ev.emp != null && !this._empresas[ev.emp]) this._empresas[ev.emp] = String(ev.empNome || ("Empresa " + ev.emp)).trim();
        const cc = String(ev.cc || "");
        if (cc && !this._ccs[cc]) this._ccs[cc] = { nome: ev.ccNome || ("Centro de custo " + cc), emp: String(ev.emp) };
      }));
      this.render();
    },

    /** Período + empresas + empreendimentos + busca (sem a faixa de dias). */
    eventosDoPeriodo() {
      const meses = this.mesesAtivos();
      const emp = new Set(this.state.empresas.map(String));
      const ccs = new Set(this.state.ccs.map(String));
      const q = norm(this.state.busca).trim();
      const out = [];
      meses.forEach((mes) => {
        const c = this._cache[mes];
        if (!c) return;
        c.eventos.forEach((ev) => {
          if (ev.data < this.state.de || ev.data > this.state.ate) return;
          if (emp.size && !emp.has(String(ev.emp))) return;
          if (ccs.size && !ccs.has(String(ev.cc || ""))) return;
          if (q && norm(`${ev.tit} ${ev.cli} ${ev.unid} ${ev.ccNome} ${ev.doc}`).indexOf(q) < 0) return;
          out.push(ev);
        });
      });
      return out;
    },

    /**
     * Recorte da antecipação na faixa de dias, parcela a parcela (mesma regra do controle antigo
     * no Power BI): "31+" soma só as parcelas pagas 31 dias ou mais antes do vencimento; "até 30"
     * só as demais. A parcela do mês paga junto com uma quitação fica em "até 30".
     */
    recorte(ev, faixa) {
      if (!ev) return null;
      if (faixa === "todas") return ev;
      const parcelas = (ev.parcelas || []).filter((p) => (faixa === "31+" ? Number(p[3]) >= 31 : Number(p[3]) < 31));
      if (!parcelas.length) return null;
      if (parcelas.length === (ev.parcelas || []).length) return ev;
      const soma = (i) => Math.round(parcelas.reduce((s, p) => s + (Number(p[i]) || 0), 0) * 100) / 100;
      const vf = soma(4);
      const vp = soma(5);
      const pago = soma(6);
      const dias = parcelas.map((p) => Number(p[3]) || 0);
      return Object.assign({}, ev, {
        parcelas, np: parcelas.length, vf, vp, pago,
        juros: Math.round((vf - vp) * 100) / 100,
        comercial: Math.round((vp - pago) * 100) / 100,
        descTotal: Math.round((vf - pago) * 100) / 100,
        minDias: Math.min.apply(null, dias),
        maxDias: Math.max.apply(null, dias),
        recortada: true
      });
    },

    eventosNaFaixa(faixa, base) {
      return (base || this.eventosDoPeriodo()).map((e) => this.recorte(e, faixa)).filter(Boolean);
    },

    /** Com a faixa escolhida (31+ / até 30 / todas). */
    eventosFiltrados() {
      return this.eventosNaFaixa(this.state.faixa);
    },

    /* ---------- Ano anterior (comparação nos Indicadores) ----------
       O mesmo período um ano antes, com os mesmos filtros (empresas, centros de custo, busca e antecedência).
       Os meses que ainda não estão em memória são lidos uma vez; enquanto isso, devolve null. */
    umAnoAntes(iso) {
      const s = String(iso || "");
      const y = Number(s.slice(0, 4)) - 1;
      let resto = s.slice(4);
      if (resto === "-02-29") resto = "-02-28";
      return y + resto;
    },

    eventosAnoAnterior() {
      const de = this.umAnoAntes(this.state.de);
      const ate = this.umAnoAntes(this.state.ate);
      if (ate < INICIO + "-01") return [];
      const meses = mesesDoPeriodo(de < INICIO + "-01" ? INICIO + "-01" : de, ate);
      const faltam = meses.filter((m) => !this._cache[m]);
      if (faltam.length) {
        this.carregarAnoAnterior(faltam);
        return null;
      }
      const emp = new Set(this.state.empresas.map(String));
      const ccs = new Set(this.state.ccs.map(String));
      const q = norm(this.state.busca).trim();
      const base = [];
      meses.forEach((mes) => {
        (this._cache[mes].eventos || []).forEach((ev) => {
          if (ev.data < de || ev.data > ate) return;
          if (emp.size && !emp.has(String(ev.emp))) return;
          if (ccs.size && !ccs.has(String(ev.cc || ""))) return;
          if (q && norm(`${ev.tit} ${ev.cli} ${ev.unid} ${ev.ccNome} ${ev.doc}`).indexOf(q) < 0) return;
          base.push(ev);
        });
      });
      return this.eventosNaFaixa(this.state.faixa, base);
    },

    async carregarAnoAnterior(meses) {
      if (this._lendoAnoAnterior) return;
      this._lendoAnoAnterior = true;
      try {
        for (const m of meses) {
          try { await this.lerMes(m, false); } catch (e) { this._cache[m] = this._cache[m] || { eventos: [], atualizadoEm: "", vazio: true }; }
        }
      } finally {
        this._lendoAnoAnterior = false;
      }
      if (this.state.aba === "indicadores") this.render();
    },

    /** Meses do período (início e fim das datas). */
    mesesAtivos() {
      return mesesDoPeriodo(this.state.de, this.state.ate);
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
        id: "antc-cc", label: "CENTROS DE CUSTO", items: ccItens, selectedIds: this.state.ccs,
        open: this.state.ccOpen, query: this.state.ccQuery, emptyMeansAll: true, countMode: true,
        nouns: { singular: "centro de custo", plural: "centros de custo" }
      }) : "";
      const abaBtn = (id, rot, icone) => `<button type="button" class="antc-sub${this.state.aba === id ? " is-on" : ""}" onclick="AntecipacoesApp.trocarAba('${id}')"><i data-lucide="${icone}" style="width:15px;height:15px;"></i> ${rot}</button>`;
      const atualizado = this.atualizadoEm();
      root.innerHTML = `
        <div class="cc-page antc-page">
          <div class="antc-cab">
            <div class="antc-subs">
              ${abaBtn("analitico", "Analítico", "table-2")}
              ${abaBtn("indicadores", "Indicadores", "bar-chart-3")}
              ${abaBtn("origem", "Financiamento × próprios", "landmark")}
            </div>
            <div class="antc-cab-acoes">
              <span class="antc-atualizado" title="Base salva no Integra. O batimento das 7h relê no Sienge os últimos 7 dias; o histórico desde jan/2024 não muda.">${atualizado ? "Base de " + esc(atualizado) : ""}</span>
              <button type="button" class="btn btn-primary cc-atualizar" onclick="AntecipacoesApp.carregar(true)"><i data-lucide="refresh-cw" style="width:16px;"></i> Atualizar</button>
              <button type="button" class="btn btn-excel" onclick="AntecipacoesApp.exportar()"><i data-lucide="download" style="width:16px;"></i> Excel</button>
            </div>
          </div>
          <div class="antc-filtros">
            <div class="antc-periodo">
              <span class="antc-lbl">PERÍODO</span>
              <div class="antc-datas">
                <input type="date" id="antc-de" min="${INICIO}-01" max="${hojeIso()}" value="${esc(this.state.de)}" onchange="AntecipacoesApp.datasMudaram()" title="Data inicial">
                <span>até</span>
                <input type="date" id="antc-ate" min="${INICIO}-01" max="${hojeIso()}" value="${esc(this.state.ate)}" onchange="AntecipacoesApp.datasMudaram()" title="Data final">
              </div>
            </div>
            <div class="antc-f antc-f-emp">${empHtml}</div>
            <div class="antc-f antc-f-cc">${ccHtml}</div>
            <label class="antc-f-busca"><span class="antc-lbl">BUSCAR</span><input type="search" id="antc-busca" placeholder="Título, cliente ou unidade" value="${esc(this.state.busca)}" oninput="AntecipacoesApp.buscar(this.value)"></label>
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
          const abrir = !self.state[abertoKey];
          self.state.empOpen = false;
          self.state.ccOpen = false;
          self.state[abertoKey] = abrir;
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
      this.state.nivel = 0;
      this.paintCorpo();
    },

    abrirCc(id) {
      if (this.state.ccAbertos.has(id)) this.state.ccAbertos.delete(id); else this.state.ccAbertos.add(id);
      this.state.nivel = 0;
      this.paintCorpo();
    },

    abrirTitulo(chave) {
      if (this.state.titAbertos.has(chave)) this.state.titAbertos.delete(chave); else this.state.titAbertos.add(chave);
      this.paintCorpo();
    },

    /** Abre a matriz até o nível: 1 = empresas, 2 = centros de custo, 3 = títulos. */
    nivel(n) {
      const lista = this.eventosFiltrados();
      this.state.empAbertas.clear();
      this.state.ccAbertos.clear();
      this.state.titAbertos.clear();
      if (n >= 2) lista.forEach((e) => this.state.empAbertas.add(String(e.emp)));
      if (n >= 3) lista.forEach((e) => this.state.ccAbertos.add(String(e.emp) + "|" + String(e.cc || "")));
      this.state.nivel = n;
      this.paintCorpo();
    },

    /** As datas filtram sozinhas; espera a pessoa terminar de digitar para não perder o foco. */
    datasMudaram() {
      clearTimeout(this._tDatas);
      this._tDatas = setTimeout(() => this.mudarPeriodo(), 700);
    },

    mudarPeriodo() {
      const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && v >= "2000-01-01";
      const vDe = (document.getElementById("antc-de") || {}).value;
      const vAte = (document.getElementById("antc-ate") || {}).value;
      if (!ok(vDe) || !ok(vAte)) return; // data incompleta: espera completar
      let de = vDe;
      let ate = vAte;
      if (de < INICIO + "-01") de = INICIO + "-01";
      if (ate > hojeIso()) ate = hojeIso();
      if (ate < de) ate = de;
      if (de === this.state.de && ate === this.state.ate) return;
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
      const brutos = this.eventosDoPeriodo();
      const todos = this.eventosNaFaixa("todas", brutos);
      const ate30 = this.eventosNaFaixa("ate30", brutos);
      const mais31 = this.eventosNaFaixa("31+", brutos);
      const lista = (this.state.faixa === "31+" ? mais31 : (this.state.faixa === "ate30" ? ate30 : todos))
        .slice().sort((a, b) => String(b.data).localeCompare(String(a.data)) || (Number(b.vf) || 0) - (Number(a.vf) || 0));
      const semBase = mesesDoPeriodo(this.state.de, this.state.ate).filter((m) => this._cache[m] && this._cache[m].vazio);
      const seg = (id, rot, n) => `<button type="button" class="${this.state.faixa === id ? "is-on" : ""}" onclick="AntecipacoesApp.faixa('${id}')">${rot} <small>${n.toLocaleString("pt-BR")}</small></button>`;
      const opcoes = Object.keys(METRICAS).map((k) => `<option value="${k}"${k === this.state.metrica ? " selected" : ""}>${esc(METRICAS[k].rot)}</option>`).join("");
      const niv = (n, rot) => `<button type="button" class="${this.state.nivel === n ? "is-on" : ""}" onclick="AntecipacoesApp.nivel(${n})">${rot}</button>`;
      const topo = `
        <div class="antc-barra-opc">
          <div class="antc-grupo"><span class="antc-lbl">ANTECEDÊNCIA</span>
            <div class="antc-seg">
              ${seg("31+", "31 dias ou mais", mais31.length)}
              ${seg("ate30", "Até 30 dias", ate30.length)}
              ${seg("todas", "Todas", todos.length)}
            </div>
          </div>
          ${this.state.aba === "analitico" ? `
          <div class="antc-grupo"><span class="antc-lbl">VALOR</span>
            <select class="antc-sel" onchange="AntecipacoesApp.mudarMetrica(this.value)">${opcoes}</select>
          </div>
          <div class="antc-grupo"><span class="antc-lbl">ABRIR ATÉ</span>
            <div class="antc-seg">${niv(1, "Empresa")}${niv(2, "Centro de custo")}${niv(3, "Título")}</div>
          </div>` : ""}
        </div>
        ${semBase.length ? `<div class="antc-aviso">Sem base salva para: ${semBase.map(esc).join(", ")}. Clique em Atualizar; se continuar, esses meses entram no próximo batimento.</div>` : ""}`;
      if (this.state.aba === "indicadores") {
        box.innerHTML = topo + this.indicadoresHtml(lista);
        if (window.lucide) lucide.createIcons();
        return;
      }
      if (this.state.aba === "origem") {
        box.innerHTML = topo + this.origemHtml(lista);
        if (window.lucide) lucide.createIcons();
        return;
      }
      box.innerHTML = topo + this.analiticoHtml(lista);
      if (window.lucide) lucide.createIcons();
    },

    // ---------- Aba Analítico: empresa > empreendimento > título, meses agrupados por ano ----------
    analiticoHtml(lista) {
      const m = METRICAS[this.state.metrica] || METRICAS.pago;
      const fmt = (v) => (m.moeda ? moeda(v) : (Number(v) || 0).toLocaleString("pt-BR"));
      const meses = this.mesesAtivos();
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
        const t = c.tits[ev.tit] = c.tits[ev.tit] || Object.assign(novo(), { cli: ev.cli, unid: ev.unid, eventos: [] });
        t.eventos.push(ev);
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
          <td class="antc-rot"><i data-lucide="${aberta ? "minus-square" : "plus-square"}" class="antc-ic"></i>${esc(this._empresas[emp] || ("Empresa " + emp))}</td>${celulas(e)}</tr>`;
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
            const chaveT = chave + "|" + tit;
            const titAberto = this.state.titAbertos.has(chaveT);
            const rot = `${tit} - ${t.cli}${t.unid ? " (" + t.unid + ")" : ""}`;
            corpo += `<tr class="antc-n3" onclick="AntecipacoesApp.abrirTitulo('${esc(chaveT)}')" title="Clique para ver as antecipações do título">
              <td class="antc-rot" title="${esc(rot)}"><i data-lucide="${titAberto ? "minus-square" : "plus-square"}" class="antc-ic"></i>${esc(rot)}</td>${celulas(t)}</tr>`;
            if (titAberto) corpo += `<tr class="antc-ev"><td colspan="${colunas.length + 2}">${this.eventosTituloHtml(t.eventos)}</td></tr>`;
          });
        });
      });
      if (!corpo) corpo = `<tr><td colspan="${colunas.length + 2}" style="text-align:center;padding:30px;">Nenhuma antecipação para exibir.</td></tr>`;
      // Cabeçalho em duas linhas: ano (clicável para abrir/fechar os meses) e, embaixo, os meses.
      // Ano fechado ocupa as duas linhas, sem repetir o rótulo.
      let h1 = `<th rowspan="2" class="antc-rot">Empresa / Centro de custo / Título</th>`;
      anos.forEach((ano) => {
        const aberto = this.state.anosAbertos.has(ano);
        const icone = `<i data-lucide="${aberto ? "minus-square" : "plus-square"}" class="antc-ic"></i>`;
        if (aberto) {
          const n = meses.filter((x) => x.slice(0, 4) === ano).length + 1;
          h1 += `<th colspan="${n}" class="is-center antc-th-ano" onclick="AntecipacoesApp.abrirAno('${ano}')" title="Agrupar o ano">${icone}${ano}</th>`;
        } else {
          h1 += `<th rowspan="2" class="is-right antc-th-ano antc-col-ano" onclick="AntecipacoesApp.abrirAno('${ano}')" title="Abrir os meses">${icone}${ano}</th>`;
        }
      });
      h1 += `<th rowspan="2" class="is-right">Total</th>`;
      const h2 = colunas.filter((col) => col.tipo === "mes" || col.aberto).map((col) => col.tipo === "mes"
        ? `<th class="is-right">${MESES_NOME[Number(col.mes.slice(5, 7)) - 1]}</th>`
        : `<th class="is-right antc-col-ano">Total ${col.ano}</th>`).join("");
      const largura = 440 + colunas.length * 104 + 110;
      return `
        <div class="cc-scroll antc-scroll antc-analit-scroll">
          <table class="cc-table antc-analit" style="width:${largura}px;">
            <colgroup><col style="width:440px">${colunas.map(() => `<col style="width:104px">`).join("")}<col style="width:110px"></colgroup>
            <thead><tr>${h1}</tr><tr>${h2}</tr></thead>
            <tbody>${corpo}
              <tr class="antc-total"><td class="antc-rot">Total</td>${celulas(geral)}</tr>
            </tbody>
          </table>
        </div>
        <p class="antc-nota">Clique no ano para abrir ou agrupar os meses; na empresa, no centro de custo e no título para descer de nível. Mês = data do pagamento antecipado.
          <span class="antc-ajuda" title="VF = valor da parcela na baixa (com correção). Sem juros (VP) = VF ÷ (1 + taxa do contrato) elevado aos meses até o vencimento. Desconto de juros = VF − VP (retirada obrigatória). Desconto comercial = VP − recebido; negativo = o cliente pagou acima do valor sem juros. Antecipações do mesmo título no mesmo dia formam uma linha.">Como os descontos são calculados?</span></p>`;
    },

    /** Antecipações de um título (abre dentro da matriz, no lugar da antiga aba de lista). */
    eventosTituloHtml(eventos) {
      const linhas = eventos.slice().sort((a, b) => String(b.data).localeCompare(String(a.data))).map((e) => {
        const aberto = this.state.abertos.has(e.k);
        const com = Number(e.comercial) || 0;
        const tol = 0.05 + (Number(e.vf) || 0) * 0.0005;
        const cls = com > tol ? "antc-com" : (com < -tol ? "antc-neg" : "");
        const antec = e.minDias === e.maxDias ? `${e.maxDias} d` : `${e.minDias}–${e.maxDias} d`;
        const kJs = esc(JSON.stringify(e.k));
        let h = `<tr class="antc-linha${aberto ? " is-aberto" : ""}" onclick='event.stopPropagation();AntecipacoesApp.alternar(${kJs})' title="Clique para ver as parcelas">
          <td>${dataBr(e.data)}</td><td class="is-center">${e.np}</td><td class="is-center">${antec}</td>
          <td class="is-right">${moeda(e.vf)}</td><td class="is-right">${moeda(e.vp)}</td><td class="is-right">${moeda(e.pago)}</td>
          <td class="is-right">${moeda(e.juros)}</td><td class="is-right ${cls}">${moeda(com)}</td>
          <td class="is-right ${cls}">${Math.abs(com) > tol && e.vf ? pct((com / e.vf) * 100) : "—"}</td></tr>`;
        if (aberto) {
          const parc = (e.parcelas || []).map((p) => `<tr>
              <td>${esc(p[0])} ${esc(p[1])}</td><td>${dataBr(p[2])}</td><td class="is-center">${p[3]} d</td>
              <td class="is-right">${moeda(p[4])}</td><td class="is-right">${moeda(p[5])}</td><td class="is-right">${moeda(p[6])}</td>
              <td class="is-right">${moeda((Number(p[4]) || 0) - (Number(p[5]) || 0))}</td><td class="is-right" colspan="2">Sienge: ${moeda(p[7])}</td></tr>`).join("");
          h += `<tr class="antc-detalhe"><td colspan="9">
            <div class="antc-det-info">Taxa ${String(e.taxa || 0).replace(".", ",")}% a.m. (${e.tipoJuros === "P" ? "Price" : esc(e.tipoJuros || "—")}) · Documento ${esc(e.doc || "—")} · No Sienge o desconto de várias parcelas é dividido por igual; a separação juros × comercial vale para a linha toda.</div>
            <table class="cc-table antc-det">
              <colgroup><col style="width:90px"><col style="width:96px"><col style="width:84px"><col><col><col><col><col style="width:140px"></colgroup>
              <thead><tr><th>Parcela</th><th>Vencimento</th><th class="is-center">Antes</th><th class="is-right">VF</th><th class="is-right">Sem juros</th><th class="is-right">Recebido</th><th class="is-right">Juros retirados</th><th class="is-right" colspan="2">Desconto lançado</th></tr></thead>
              <tbody>${parc}</tbody>
            </table></td></tr>`;
        }
        return h;
      }).join("");
      return `<div class="antc-ev-box">
        <table class="cc-table antc-ev-tab">
          <colgroup><col style="width:92px"><col style="width:56px"><col style="width:96px"><col><col><col><col><col><col style="width:64px"></colgroup>
          <thead><tr><th>Pagamento</th><th class="is-center">Parc.</th><th class="is-center">Antecedência</th><th class="is-right">VF</th><th class="is-right">Sem juros (VP)</th><th class="is-right">Recebido</th><th class="is-right">Desc. juros</th><th class="is-right">Desc. comercial</th><th class="is-right">% com.</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table></div>`;
    },

    // ---------- Aba Financiamento × recursos próprios ----------
    /* Cruza cada antecipação com o Registro (cadastro das unidades + Posição de estoque):
       financiamento = lote quitado com financiamento (letra F e volume na baixa) e antecipação na data da quitação
       (até 5 dias de diferença); conferir = lote com F sem volume na baixa, na data da quitação; o resto é recurso próprio. */
    DIAS_QUITACAO: 5,

    origemDe(ev, mapa) {
      const info = mapa.get(String(ev.tit || "").replace(/\D/g, ""));
      if (!info || !info.data || info.origem === "prop") return "prop";
      const d = Math.abs((new Date(ev.data + "T12:00:00") - new Date(info.data + "T12:00:00")) / 86400000);
      if (!(d <= this.DIAS_QUITACAO)) return "prop";
      return info.origem;
    },

    origemHtml(lista) {
      const R = window.RegistroApp;
      if (!R || typeof R.origemPorTitulo !== "function") return `<div class="antc-aviso">O Registro não está disponível nesta página. Atualize (Ctrl+F5).</div>`;
      const o = R.origemPorTitulo();
      if (!o.temRegistro || !o.temPosicao) {
        if (!this._lendoRegistro) {
          this._lendoRegistro = true;
          R.garantirDados().catch(() => {}).finally(() => {
            this._lendoRegistro = false;
            this._registroTentado = true;
            if (this.state.aba === "origem") this.render();
          });
        }
        if (!this._registroTentado || this._lendoRegistro) return `<div class="ml-load"><div class="loading-spinner" aria-hidden="true"></div><div class="loading-status-text">Lendo o Registro (cadastro das unidades) e a Posição de estoque…</div></div>`;
        return `<div class="antc-aviso">${!o.temRegistro ? "O Registro ainda não tem o relatório Unidades por Empreendimento. Suba o arquivo em Relacionamento > Registro." : "A Posição de estoque ainda não está disponível. Abra Comercial > Posição de estoque e conclua o batimento."}</div>`;
      }
      const ROT = { fin: "Financiamento", prop: "Recursos próprios", conf: "Conferir" };
      const tot = { fin: { v: 0, n: 0, t: new Set() }, prop: { v: 0, n: 0, t: new Set() }, conf: { v: 0, n: 0, t: new Set() } };
      const porMes = {};
      const porEmp = {};
      const porCc = {};
      const somar = (alvo, chave, nome, org, v) => {
        const x = alvo[chave] = alvo[chave] || { nome, fin: 0, prop: 0, conf: 0 };
        x[org] += v;
      };
      lista.forEach((ev) => {
        const org = this.origemDe(ev, o.mapa);
        const v = Number(ev.pago) || 0;
        tot[org].v += v;
        tot[org].n += 1;
        tot[org].t.add(String(ev.tit));
        const mes = String(ev.data).slice(0, 7);
        porMes[mes] = porMes[mes] || { fin: 0, prop: 0, conf: 0 };
        porMes[mes][org] += v;
        somar(porEmp, String(ev.emp), this._empresas[ev.emp] || ev.empNome || ("Empresa " + ev.emp), org, v);
        somar(porCc, String(ev.cc || ""), ev.cc ? `${ev.cc} - ${ev.ccNome || ""}` : "Sem centro de custo", org, v);
      });
      const total = tot.fin.v + tot.prop.v + tot.conf.v;
      const pctDe = (v) => (total > 0 ? (v / total) * 100 : 0);
      const card = (org, cls) => `<div class="antc-kpi ${cls}"><span>${ROT[org]}</span><b>${moeda(tot[org].v)}</b><small>${pct(pctDe(tot[org].v))} do recebido · ${tot[org].n.toLocaleString("pt-BR")} antecipações · ${tot[org].t.size.toLocaleString("pt-BR")} contrato(s)</small></div>`;
      const meses = this.mesesAtivos().slice(-12);
      const maxMes = Math.max(1, ...meses.map((m) => { const x = porMes[m] || {}; return (x.fin || 0) + (x.prop || 0) + (x.conf || 0); }));
      const mi = (n) => (Math.abs(n) >= 1e6 ? (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " Mi" : (n / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil");
      const barras = meses.map((m) => {
        const x = porMes[m] || { fin: 0, prop: 0, conf: 0 };
        const soma = x.fin + x.prop + x.conf;
        const h = (v) => Math.round((v / maxMes) * 140);
        return `<div class="antc-barra" title="${esc(MESES_NOME[Number(m.slice(5, 7)) - 1] + "/" + m.slice(2, 4))}: financiamento ${moeda(x.fin)} · recursos próprios ${moeda(x.prop)}${x.conf ? " · conferir " + moeda(x.conf) : ""}">
          <span class="antc-barra-val">${soma ? mi(soma) : ""}</span>
          <div class="antc-pilha" style="height:${Math.max(2, h(soma))}px">
            ${x.conf ? `<div class="antc-pilha-conf" style="flex:${x.conf}"></div>` : ""}
            ${x.fin ? `<div class="antc-pilha-fin" style="flex:${x.fin}"></div>` : ""}
            ${x.prop ? `<div class="antc-pilha-prop" style="flex:${x.prop}"></div>` : ""}
          </div>
          <span class="antc-barra-rot">${esc(MESES_NOME[Number(m.slice(5, 7)) - 1] + "/" + m.slice(2, 4))}</span>
          <span class="antc-barra-var">${soma ? pct((x.fin / soma) * 100) + " fin." : ""}</span>
        </div>`;
      }).join("");
      const tabela = (titulo, grupos) => {
        const linhas = Object.values(grupos).map((x) => Object.assign(x, { total: x.fin + x.prop + x.conf })).sort((a, b) => b.total - a.total);
        return `<div class="antc-ind-tab"><div class="antc-ind-tit">${esc(titulo)}</div>
          <div class="cc-scroll" style="max-height:300px;"><table class="cc-table">
            <colgroup><col><col style="width:108px"><col style="width:108px"><col style="width:90px"><col style="width:108px"><col style="width:62px"></colgroup>
            <thead><tr><th>Nome</th><th class="is-right">Financiamento</th><th class="is-right">Rec. próprios</th><th class="is-right">Conferir</th><th class="is-right">Total</th><th class="is-right">% fin.</th></tr></thead>
            <tbody>${linhas.map((x) => `<tr><td title="${esc(x.nome)}">${esc(x.nome)}</td><td class="is-right">${moeda(x.fin)}</td><td class="is-right">${moeda(x.prop)}</td><td class="is-right">${x.conf ? moeda(x.conf) : "—"}</td><td class="is-right">${moeda(x.total)}</td><td class="is-right">${x.total ? pct((x.fin / x.total) * 100) : "—"}</td></tr>`).join("")
              || `<tr><td colspan="6" style="text-align:center;padding:30px;">Nenhuma antecipação para exibir.</td></tr>`}</tbody>
          </table></div></div>`;
      };
      const reg = R.state || {};
      const dReg = reg.quando ? new Date(reg.quando).toLocaleDateString("pt-BR") : "—";
      return `
        <div class="antc-kpis antc-kpis-4">
          <div class="antc-kpi"><span>Antecipação recebida</span><b>${moeda(total)}</b><small>${lista.length.toLocaleString("pt-BR")} antecipações no filtro</small></div>
          ${card("fin", "antc-org-fin")}
          ${card("prop", "antc-org-prop")}
          ${card("conf", tot.conf.v > 0.009 ? "is-alerta" : "")}
        </div>
        <div class="antc-graficos sem-ano">
          <div class="antc-graf" style="grid-column:1 / -1;"><div class="antc-ind-tit antc-tit-linha">Mês a mês · origem dos recursos
            <div class="antc-legenda"><span><i class="antc-leg-cor"></i> Financiamento</span><span><i class="antc-leg-cor is-prop"></i> Recursos próprios</span><span><i class="antc-leg-cor is-conf"></i> Conferir</span></div></div>
            <div class="antc-barras">${barras}</div></div>
        </div>
        <div class="antc-ind-tabs">${tabela("Por empresa", porEmp)}${tabela("Por centro de custo", porCc)}</div>
        <p class="antc-nota">Financiamento = antecipação do lote quitado com financiamento (letra <b>F</b> no Registro e volume recebido na data da quitação), feita até ${this.DIAS_QUITACAO} dias da data da quitação. Conferir = lote com <b>F</b> sem volume na baixa. O resto é recurso próprio. Registro: ${esc(reg.arquivo || "—")} de ${esc(dReg)}.</p>`;
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
      const meses = this.mesesAtivos().slice(-12);
      const anos = [...new Set(this.mesesAtivos().map((x) => x.slice(0, 4)))];
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
      // Ranking enxuto: recebido, contratos e média; a barra mostra o peso no total.
      const tabela = (titulo, linhas) => {
        const max = Math.max(1, ...linhas.map((x) => x.pago));
        return `
        <div class="antc-ind-tab">
          <div class="antc-ind-tit">${esc(titulo)}</div>
          <div class="cc-scroll" style="max-height:300px;">
            <table class="cc-table">
              <colgroup><col><col style="width:120px"><col style="width:70px"><col style="width:110px"></colgroup>
              <thead><tr><th>Nome</th><th class="is-right">Recebido</th><th class="is-right">Contratos</th><th class="is-right">Média</th></tr></thead>
              <tbody>${linhas.map((x) => `<tr>
                <td title="${esc(x.nome)}">${esc(x.nome)}</td>
                <td class="is-right">${moeda(x.pago)}</td><td class="is-right">${x.tits.size}</td>
                <td class="is-right">${moeda(x.tits.size ? x.pago / x.tits.size : 0)}</td></tr>`).join("")
                || `<tr><td colspan="4" style="text-align:center;padding:30px;">Nenhuma antecipação para exibir.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>`;
      };
      const porEmpresa = agrupar((e) => String(e.emp), (e) => this._empresas[e.emp] || e.empNome || ("Empresa " + e.emp));
      const porCc = agrupar((e) => String(e.cc || ""), (e) => (e.cc ? `${e.cc} - ${e.ccNome || ""}` : "Sem centro de custo"));
      // Ano anterior: mesmo mês um ano antes, com os mesmos filtros (barra cinza ao lado da do ano).
      const anterior = this.eventosAnoAnterior();
      const porMesAnt = {};
      let totalAnt = 0;
      (anterior || []).forEach((e) => {
        const m = String(e.data).slice(0, 7);
        const chave = (Number(m.slice(0, 4)) + 1) + m.slice(4);
        porMesAnt[chave] = (porMesAnt[chave] || 0) + (Number(e.pago) || 0);
        totalAnt += Number(e.pago) || 0;
      });
      const variacao = (v, v0) => (v0 > 0 ? ((v - v0) / v0) * 100 : null);
      const sinal = (p) => (p == null ? "" : (p > 0 ? "+" : "") + p.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%");
      const colunasComp = (pares) => {
        const max = Math.max(1, ...pares.map((p) => Math.max(p.v, p.v0 || 0)));
        return `<div class="antc-barras">${pares.map((p) => {
          const pv = variacao(p.v, p.v0);
          return `<div class="antc-barra" title="${esc(p.rot)}: ${moeda(p.v)}${anterior ? " · ano anterior: " + moeda(p.v0 || 0) + (pv == null ? "" : " (" + sinal(pv) + ")") : ""}">
            <span class="antc-barra-val">${p.v ? mi(p.v) : ""}</span>
            <div class="antc-barra-par">
              ${anterior ? `<div class="antc-barra-col is-ant" style="height:${Math.max(2, Math.round(((p.v0 || 0) / max) * 140))}px"></div>` : ""}
              <div class="antc-barra-col" style="height:${Math.max(2, Math.round((p.v / max) * 140))}px"></div>
            </div>
            <span class="antc-barra-rot">${esc(p.rot)}</span>
            ${anterior && pv != null ? `<span class="antc-barra-var ${pv >= 0 ? "is-mais" : "is-menos"}">${sinal(pv)}</span>` : (anterior ? `<span class="antc-barra-var">—</span>` : "")}
          </div>`;
        }).join("")}</div>`;
      };
      const graficoMeses = colunasComp(meses.map((x) => ({ rot: MESES_NOME[Number(x.slice(5, 7)) - 1] + "/" + x.slice(2, 4), v: porMes[x] || 0, v0: porMesAnt[x] || 0 })));
      const legendaAnt = anterior
        ? `<div class="antc-legenda"><span><i class="antc-leg-cor"></i> ${esc(this.state.de.slice(0, 4) === this.state.ate.slice(0, 4) ? this.state.de.slice(0, 4) : "Período")}</span><span><i class="antc-leg-cor is-ant"></i> Ano anterior</span></div>`
        : `<div class="antc-legenda"><span>Carregando o ano anterior…</span></div>`;
      const pvTotal = anterior ? variacao(t.pago, totalAnt) : null;
      return `
        <div class="antc-kpis antc-kpis-4">
          <div class="antc-kpi"><span>Antecipação recebida</span><b>${moeda(t.pago)}</b><small>${t.n.toLocaleString("pt-BR")} antecipações${anterior ? ` · ano anterior ${moeda(totalAnt)}${pvTotal == null ? "" : ` <em class="${pvTotal >= 0 ? "antc-mais" : "antc-menos"}">(${sinal(pvTotal)})</em>`}` : ""}</small></div>
          <div class="antc-kpi"><span>Contratos</span><b>${contratos.toLocaleString("pt-BR")}</b><small>média de ${moeda(mediaCt)} por contrato</small></div>
          <div class="antc-kpi"><span>Parcelas antecipadas</span><b>${t.parc.toLocaleString("pt-BR")}</b><small>média de ${mediaParc.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por contrato</small></div>
          <div class="antc-kpi ${t.comercial > 0.009 ? "is-alerta" : ""}"><span>Descontos</span><b>${moeda(t.juros + t.comercial)}</b>
            <small>juros ${moeda(t.juros)} (${pct(pctJur)}) · comercial ${moeda(t.comercial)} (${pct(pctCom)}, ${t.comCom} título(s))</small></div>
        </div>
        <div class="antc-graficos ${anos.length > 1 ? "" : "sem-ano"}">
          ${anos.length > 1 ? `<div class="antc-graf"><div class="antc-ind-tit">Por ano</div>${colunas(anos.map((a) => ({ rot: a, v: porAno[a] || 0 })))}</div>` : ""}
          <div class="antc-graf"><div class="antc-ind-tit antc-tit-linha">Mês a mês${this.mesesAtivos().length > 12 ? " (últimos 12)" : ""} · comparado ao ano anterior${legendaAnt}</div>${graficoMeses}</div>
          <div class="antc-graf"><div class="antc-ind-tit">Por faixa de valor</div>${faixasHtml}</div>
        </div>
        <div class="antc-ind-tabs">
          ${tabela("Por empresa", porEmpresa)}
          ${tabela("Por centro de custo", porCc)}
        </div>`;
    },

    exportar() {
      if (typeof XLSX === "undefined") { alert("Exportação indisponível nesta página."); return; }
      const lista = this.eventosFiltrados().slice().sort((a, b) => String(a.data).localeCompare(String(b.data)));
      if (!lista.length) { alert("Nenhuma antecipação para exportar."); return; }
      const ev = lista.map((e) => ({
        "Pagamento": dataBr(e.data), "Título": e.tit, "Cliente": e.cli, "Empresa": e.empNome, "Unidade": e.unid,
        "Centro de custo": e.cc, "Nome do centro de custo": e.ccNome, "Documento": e.doc,
        "Faixa": this.state.faixa === "31+" ? "31 dias ou mais" : (this.state.faixa === "ate30" ? "Até 30 dias" : (e.faixa === "31+" ? "Tem parcela com 31+ dias" : "Até 30 dias")),
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
      .antc-emp.antc-mes { min-width:170px; }
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
      .antc-cab { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; border-bottom:1px solid #e2e8f0; margin-bottom:12px; flex-wrap:wrap; }
      .antc-cab .antc-subs { border-bottom:0; margin-bottom:0; }
      .antc-cab-acoes { display:flex; align-items:center; gap:8px; padding-bottom:6px; }
      .antc-cab-acoes .btn { height:36px; display:inline-flex; align-items:center; gap:6px; }
      .antc-atualizado { font-size:0.72rem; color:#64748b; cursor:help; }
      .antc-lbl { display:block; font-size:0.68rem; font-weight:700; color:#6d8c7c; letter-spacing:.02em; margin-bottom:4px; }
      .antc-filtros { display:flex; flex-wrap:wrap; align-items:flex-end; gap:10px; margin-bottom:12px; padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; }
      .antc-periodo { position:relative; }
      .antc-per-btn { height:34px; min-width:230px; display:flex; align-items:center; gap:8px; padding:0 10px; border:1px solid #334155; border-radius:6px; background:#fff; font-size:0.85rem; font-weight:700; color:#0f172a; cursor:pointer; white-space:nowrap; }
      .antc-per-btn span { flex:1; text-align:left; }
      .antc-per-pop { position:absolute; top:calc(100% + 4px); left:0; z-index:240; background:#fff; border:1px solid #cbd5e1; border-radius:8px; box-shadow:0 12px 28px rgba(15,23,42,0.14); padding:12px; width:max-content; }
      .antc-per-campos { display:flex; gap:10px; margin-bottom:10px; }
      .antc-per-campos label { display:flex; flex-direction:column; gap:4px; font-size:0.7rem; font-weight:700; color:#6d8c7c; text-transform:uppercase; }
      .antc-per-campos input { height:34px; padding:0 8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.85rem; }
      .antc-per-atalhos { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
      .antc-per-atalhos button { height:30px; padding:0 10px; border:1px solid #cfe3d7; border-radius:99px; background:#f7faf8; color:#105436; font-size:0.75rem; font-weight:700; cursor:pointer; white-space:nowrap; }
      .antc-per-acoes { display:flex; justify-content:flex-end; gap:8px; }
      .antc-per-acoes .btn { height:34px; white-space:nowrap; }
      /* Listas dos filtros: largura do maior nome, sem quebrar texto nem botão. */
      .antc-page .ml-emp-filter-panel { width:max-content; min-width:100%; max-width:min(640px, 72vw); }
      .antc-page .ml-emp-filter-item { align-items:center; }
      .antc-page .ml-emp-filter-item span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .antc-page .ml-emp-filter-btn span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .antc-page .ml-emp-filter-all, .antc-page .ml-emp-filter-none { white-space:nowrap; padding:0 12px; }
      .antc-page .cc-table td, .antc-page .cc-table th { white-space:nowrap; }
      .antc-f { min-width:190px; }
      .antc-f-emp { flex:1 1 300px; }
      .antc-f-cc { flex:1.4 1 360px; }
      .antc-periodo { flex:0 0 auto; }
      .antc-datas { display:flex; align-items:center; gap:8px; }
      .antc-datas span { font-size:0.8rem; color:#475569; font-weight:600; }
      .antc-datas input { height:38px; padding:0 8px; border:1px solid #e0e5e0; border-radius:6px; font-size:0.85rem; background:#fff; color:#0f172a; }
      .antc-f-busca { flex:1 1 100%; display:flex; flex-direction:column; }
      .antc-f-busca input { height:38px; padding:0 10px; border:1px solid #e0e5e0; border-radius:6px; font-size:0.85rem; background:#fff; }
      .antc-barra-opc .antc-seg { display:inline-grid; grid-template-columns:repeat(3, 160px); }
      .antc-barra-opc .antc-seg button { width:100%; padding:0 8px; display:inline-flex; align-items:center; justify-content:center; gap:4px; }
      .antc-barra-opc { display:flex; flex-wrap:wrap; align-items:flex-end; gap:18px; margin-bottom:10px; }
      .antc-seg { display:inline-flex; border:1px solid #cfe3d7; border-radius:8px; overflow:hidden; background:#fff; }
      .antc-seg button { height:34px; padding:0 12px; border:0; border-right:1px solid #cfe3d7; background:#fff; color:#105436; font-weight:700; font-size:0.78rem; cursor:pointer; white-space:nowrap; }
      .antc-seg button:last-child { border-right:0; }
      .antc-seg button small { margin-left:4px; padding:1px 6px; border-radius:99px; background:#e7f6ee; font-size:0.68rem; }
      .antc-seg button.is-on { background:#1b8253; color:#fff; }
      .antc-seg button.is-on small { background:rgba(255,255,255,.2); color:#fff; }
      .antc-sel { height:36px; padding:0 10px; border:1px solid #cfe3d7; border-radius:8px; font-size:0.8rem; background:#fff; color:#105436; font-weight:600; }
      .antc-resumo { display:flex; flex-wrap:wrap; gap:6px 22px; padding:8px 12px; margin-bottom:8px; background:#f7faf8; border:1px solid #e2e8f0; border-radius:8px; font-size:0.8rem; color:#334155; }
      .antc-resumo b { color:#105436; font-variant-numeric:tabular-nums; }
      .antc-resumo .antc-com b { color:#b45309; }
      .antc-ev > td { background:#f8fafc !important; padding:6px 10px 10px 46px !important; white-space:normal !important; }
      .antc-ev-box { position:sticky; left:46px; max-width:min(1100px, calc(100vw - 260px)); }
      .antc-ev-tab { margin:2px 0; }
      .antc-ajuda { text-decoration:underline dotted; cursor:help; color:#105436; margin-left:6px; }
      .antc-kpis-4 { grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); }
      .antc-graficos.sem-ano { grid-template-columns:minmax(320px,2fr) minmax(260px,1fr); }
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
      .antc-barra-par { width:80%; display:flex; align-items:flex-end; justify-content:center; gap:2px; }
      .antc-barra-par .antc-barra-col { width:50%; }
      .antc-barra-col.is-ant { background:#cbd5e1; }
      .antc-barra-var { font-size:0.6rem; font-weight:700; color:#94a3b8; white-space:nowrap; }
      .antc-barra-var.is-mais, .antc-mais { color:#15803d; font-style:normal; }
      .antc-barra-var.is-menos, .antc-menos { color:#b91c1c; font-style:normal; }
      .antc-tit-linha { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
      .antc-legenda { display:inline-flex; gap:12px; font-size:0.65rem; font-weight:600; color:#64748b; text-transform:none; }
      .antc-legenda span { display:inline-flex; align-items:center; gap:4px; }
      .antc-leg-cor { display:inline-block; width:10px; height:10px; border-radius:2px; background:#1b8253; }
      .antc-leg-cor.is-ant { background:#cbd5e1; }
      .antc-leg-cor.is-prop { background:#60a5fa; }
      .antc-leg-cor.is-conf { background:#f59e0b; }
      .antc-pilha { width:60%; display:flex; flex-direction:column; border-radius:3px 3px 0 0; overflow:hidden; }
      .antc-pilha-fin { background:#1b8253; }
      .antc-pilha-prop { background:#60a5fa; }
      .antc-pilha-conf { background:#f59e0b; }
      .antc-kpi.antc-org-fin b { color:#105436; }
      .antc-kpi.antc-org-prop b { color:#1d4ed8; }
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
