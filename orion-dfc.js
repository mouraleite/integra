/* Órion (transição) › DFC gerencial — a tela do ML Órion (Orçamento › DFC gerencial) com a identidade do Integra.
 * Mesmos números do DFC (motor comum em orion-dfc-visao.js), por empresa, visão, plano e centro de custo; Cheio e MLDU lado a lado.
 * Topo: Diretoria, Departamento, ID da empresa, Empresa, Meses, Ano, Comparar com Orçado / Forecast (com a versão) e Calcular.
 * Cartões Entradas, Saídas, Líquido e Geração de caixa, cada um com Cheio e MLDU (ano × LY e variação, semáforo).
 * Tabela: Agrupar Empresa → Visão (empresa › grupos da visão DFC › planos › centros de custo) ou Empresa → CC (empresa ›
 * centro de custo › grupos › planos); séries Real cheio (sempre), Real MLDU, LY, LY MLDU, Orçado (ou Forecast) cheio e MLDU;
 * AH/AV mensal, Total do ano, AH %, AV %, Expandir, Recolher e Excel. MLDU = % de consolidação da empresa (cadastro de
 * Empresas). Saídas negativas. Só leitura. */
(function () {
  const B = window.OrionDfcBase;
  if (!B) return;
  const MES = B.MES;
  const SER = [["real", "Real cheio", "Real"], ["real_mldu", "Real MLDU", "MLDU"], ["n1", "LY", "LY"], ["n1_mldu", "LY MLDU", "LY MLDU"], ["ref", "Orçado cheio", "Orç"], ["ref_mldu", "Orçado MLDU", "Orç MLDU"]];

  const App = Object.assign(B.criar("OrionDfcApp", "orion-dfc-root"), {
    modo: "orcado", agrupar: "visao",
    series: { real_mldu: true, n1: true, n1_mldu: true, ref: true, ref_mldu: true },

    rotSerie(k) {
      const fc = this.modo === "forecast";
      if (k === "ref") return fc ? ["Forecast cheio", "FCST"] : ["Orçado cheio", "Orç"];
      if (k === "ref_mldu") return fc ? ["Forecast MLDU", "FCST MLDU"] : ["Orçado MLDU", "Orç MLDU"];
      const s = SER.find((x) => x[0] === k);
      return [s[1], s[2]];
    },
    ativas() { return SER.map((s) => s[0]).filter((k) => k === "real" || this.series[k]); },
    /** valor de uma série (mês i ou total quando i == null) de uma linha */
    val(x, k, i) {
      const base = k.replace("_mldu", ""), src = base === "ref" ? (this.modo === "forecast" ? "fc" : "orc") : base;
      const v = i == null ? x.t[src] : x[src][i];
      return k.indexOf("_mldu") > 0 ? Math.round(v * (x.fator || 0)) : v;
    },
    setModo(m) {
      this.modo = m;
      if (m === "forecast" && this.calc && !this.fcLinhas[this.versaoAtual()]) { this.passo = "Lendo o forecast…"; this.render(); this.garantirFc(this.versaoAtual()).then(() => { this.passo = ""; this.render(); }); return; }
      this.render();
    },
    setAgrupar(v) { this.agrupar = v; this.abertos = this.abertosIniciais(); this.render(); },
    alternarSerie(k) { this.series[k] = !this.series[k]; this.render(); },

    /** Árvore gerencial (regra do Órion: montar_dfc_gerencial). */
    montar() {
      const fol = this.folhas(this.modo === "forecast");
      const porEmp = new Map();
      fol.forEach((f) => { if (!porEmp.has(f.emp)) porEmp.set(f.emp, []); porEmp.get(f.emp).push(f); });
      const empresas = [...porEmp.entries()].map(([emp, fs]) => {
        const fator = this.fatorMldu(emp), nome = emp === "_sem" ? "SEM EMPRESA NO CADASTRO" : (this.nomeEmpresa(emp) || "Empresa " + emp).toUpperCase();
        const marca = (x) => { x.fator = fator; (x.filhos || []).forEach(marca); return x; };
        let filhos;
        if (this.agrupar === "centro") {
          const porCc = new Map();
          fs.forEach((f) => { if (!porCc.has(f.cc)) porCc.set(f.cc, []); porCc.get(f.cc).push(f); });
          filhos = [...porCc.entries()].map(([cc, l]) => {
            const A = this.arvoreVisao(l, "e|" + emp + "|c|" + cc, false);
            const cats = A.lista.filter((c) => c.t && (c.planos.length || c.sub.length)).filter((c) => this.temValor(c));
            const x = Object.assign({ kind: "centro", id: "e|" + emp + "|c|" + cc, codigo: cc, nome: l[0].ccNome || ((this.ccInfo(cc) || {}).name) || "CC " + cc, filhos: cats }, this.somar(A.topo));
            return this.tot(x);
          }).sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
        } else {
          const A = this.arvoreVisao(fs, "e|" + emp, true);
          filhos = A.lista;
          filhos.forEach((c) => { c.filhos = c.planos; });
          const x = Object.assign({ kind: "empresa", id: "e|" + emp, codigo: emp === "_sem" ? "" : emp, nome, filhos }, this.somar(A.topo));
          return marca(this.tot(x));
        }
        const x = Object.assign({ kind: "empresa", id: "e|" + emp, codigo: emp === "_sem" ? "" : emp, nome, filhos }, this.somar(filhos));
        return marca(this.tot(x));
      }).sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR") || String(a.codigo).localeCompare(String(b.codigo)));
      const ms = this.ms(), entM = this.entradasMes(fol);
      return { empresas, fol, entM, ent: ms.reduce((s, i) => s + entM[i], 0),
        cheio: this.cartoes(fol), mldu: this.cartoes(fol, (f) => this.fatorMldu(f.emp)) };
    },
    temValor(c) { return ["real", "n1", "orc", "fc"].some((k) => c[k].some((v) => v)); },
    abertosIniciais() {
      const a = {};
      if (this.calc) { try { this.montar().empresas.forEach((e) => { a[e.id] = true; }); } catch (e) { /* nada */ } }
      return a;
    },
    expandir(on) {
      const M = this.calc && this.montar();
      this.abertos = {};
      if (!M) return this.render();
      const marca = (l) => l.forEach((x) => { if (x.filhos && x.filhos.length) { this.abertos[x.id] = true; if (on) marca(x.filhos); } });
      if (on) marca(M.empresas); else M.empresas.forEach((e) => { this.abertos[e.id] = true; });
      this.render();
    },
    /** Linhas visíveis (empresa, categoria/centro, plano, centro) com a profundidade. */
    plano(lista, todas) {
      const out = [];
      const vai = (l, nivel) => l.forEach((x) => {
        const tem = !!(x.filhos && x.filhos.length);
        out.push({ x, nivel: nivel + (x.kind === "categoria" ? x.nivel || 0 : 0), tem });
        if (tem && (todas || this.abertos[x.id])) vai(x.filhos, nivel + 1);
      });
      vai(lista, 0);
      return out;
    },
    excel() {
      const M = this.calc && this.montar();
      if (!M) return;
      const at = this.ativas(), r = (v) => Math.round(Number(v) || 0) / 100, p = (x) => (x == null ? "" : x * 100);
      const cab = ["Nível", "Código", "Descrição"];
      MES.forEach((m) => { at.forEach((k) => cab.push(`${m} ${this.rotSerie(k)[1]}`)); if (this.ahavMensal) cab.push(`${m} AH %`, `${m} AV %`); });
      at.forEach((k) => cab.push(`Total ${this.ano} ${this.rotSerie(k)[1]}`)); cab.push("AH %", "AV %");
      const nomes = { empresa: "Empresa", categoria: "Visão", plano: "Plano", centro: "Centro de custo" };
      const rows = this.plano(M.empresas, true).map(({ x }) => {
        const l = [nomes[x.kind] || "", x.codigo || "", x.nome || ""];
        for (let i = 0; i < 12; i++) { at.forEach((k) => l.push(r(this.val(x, k, i)))); if (this.ahavMensal) l.push(p(this.ah(x.real[i], x.n1[i])), p(M.entM[i] ? x.real[i] / M.entM[i] : null)); }
        at.forEach((k) => l.push(r(this.val(x, k)))); l.push(p(this.ah(x.t.real, x.t.n1)), p(M.ent ? x.t.real / M.ent : null));
        return l;
      });
      this.baixar(cab, rows, `DFC_gerencial_${this.ano}.xlsx`, "DFC gerencial");
    },
    htmlTabela(M) {
      const N = this.N, at = this.ativas();
      const nCol = at.length + (this.ahavMensal ? 2 : 0);
      const cels = (x) => {
        let h = "";
        for (let i = 0; i < 12; i++) {
          at.forEach((k, j) => { h += `<td class="is-right${j === 0 ? " odv-ini" : ""}" style="${k === "real" ? "font-weight:600" : ""}">${this.num(this.val(x, k, i))}</td>`; });
          if (this.ahavMensal) h += `<td class="is-right">${this.per(this.ah(x.real[i], x.n1[i]))}</td><td class="is-right">${this.per(M.entM[i] ? x.real[i] / M.entM[i] : null)}</td>`;
        }
        at.forEach((k, j) => { h += `<td class="is-right odv-tot${j === 0 ? " odv-ini" : ""}">${this.num(this.val(x, k))}</td>`; });
        return h + `<td class="is-right odv-ini">${this.per(this.ah(x.t.real, x.t.n1))}</td><td class="is-right">${this.per(M.ent ? x.t.real / M.ent : null)}</td>`;
      };
      const cls = { empresa: "odv-emp", centro: "odv-cc", categoria: "odv-cat", plano: "odv-pl" };
      const corpo = this.plano(M.empresas, false).map(({ x, nivel, tem }) => {
        const ab = !!this.abertos[x.id];
        const c = x.kind === "centro" && nivel > 2 ? "odv-ce" : cls[x.kind] || "odv-pl";
        const forte = x.kind === "empresa" || x.kind === "categoria" || (x.kind === "centro" && this.agrupar === "centro");
        return `<tr class="${c}"><td class="odv-nome" style="padding-left:${8 + nivel * 16}px;${tem ? "cursor:pointer" : ""}" ${tem ? `onclick="${N}.alternar('${this.esc(x.id)}')"` : ""}><span style="display:inline-block;width:14px;color:#94a3b8">${tem ? (ab ? "▾" : "▸") : ""}</span><span class="odv-cod">${this.esc(x.codigo)}</span>${forte ? `<b>${this.esc(x.nome)}</b>` : this.esc(x.nome || x.codigo)}</td>${cels(x)}</tr>`;
      }).join("");
      const h1 = MES.map((m) => `<th colspan="${nCol}" class="is-center odv-ini">${m}</th>`).join("") + `<th colspan="${at.length}" class="is-center odv-ini" style="background:#105436">Total ${this.esc(this.ano)}</th><th rowspan="2" class="is-right odv-ini">AH %</th><th rowspan="2" class="is-right">AV %</th>`;
      const sub = at.map((k, j) => `<th class="is-right${j === 0 ? " odv-ini" : ""}">${this.rotSerie(k)[1]}</th>`).join("") + (this.ahavMensal ? `<th class="is-right">AH %</th><th class="is-right">AV %</th>` : "");
      const h2 = new Array(12).fill(sub).join("") + at.map((k, j) => `<th class="is-right${j === 0 ? " odv-ini" : ""}">${this.rotSerie(k)[1]}</th>`).join("");
      const largura = 340 + (12 * nCol + at.length) * 105 + 170;
      const cols = `<col style="width:340px">${new Array(12 * nCol + at.length).fill(`<col style="width:105px">`).join("")}<col style="width:85px"><col style="width:85px">`;
      return `<div class="cc-scroll" style="max-height:66vh"><table class="cc-table odv-tab" style="min-width:${largura}px"><colgroup>${cols}</colgroup><thead><tr><th rowspan="2" class="odv-nome">${this.agrupar === "centro" ? "Empresa / CC / Visão" : "Empresa / Visão / Plano"}</th>${h1}</tr><tr>${h2}</tr></thead><tbody>${corpo || `<tr><td colspan="99" style="text-align:center;padding:30px">Sem movimento.</td></tr>`}</tbody></table></div>`;
    },
    render() {
      const root = this.root();
      if (!root) return;
      if (!this.C()) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivo de cálculo não carregou. Recarregue a página.</div>`; return; }
      this.estilos();
      root.classList.add("odv");
      const N = this.N, vs = this.versoesFc();
      const extra = `<div><label class="ml-emp-filter-label">Comparar com</label><div class="odv-seg alto"><button type="button" class="${this.modo === "orcado" ? "on" : ""}" onclick="${N}.setModo('orcado')">Orçado</button><button type="button" class="${this.modo === "forecast" ? "on" : ""}" onclick="${N}.setModo('forecast')">Forecast</button></div></div>
        ${this.modo === "forecast" && vs.length ? `<div><label class="ml-emp-filter-label">Versão</label><select class="idx-select" style="height:40px;min-width:150px" onchange="${N}.setVersao(this.value)">${vs.map((v) => `<option value="${this.esc(v)}" ${v === this.versaoAtual() ? "selected" : ""}>${this.esc(this.C().rotuloVersao(v, "forecast"))}</option>`).join("")}</select></div>` : ""}`;
      const topo = `<div style="margin-bottom:12px"><h2 style="font-size:1.4rem;font-weight:800;color:var(--color-primary);margin:0">DFC gerencial</h2>
          <p style="font-size:0.8rem;color:#6b8474;margin:2px 0 0">Mesmos números do DFC, por empresa, visão, plano e centro de custo. Cheio e MLDU lado a lado. Saídas negativas.</p></div>` + this.htmlFiltros(extra);
      const corpo = this.corpoPadrao(() => {
        const M = this.montar(), leg = this.legendaMeses(), K = M.cheio, Km = M.mldu;
        const lgG = `YTD até ${K.corte ? MES[K.corte - 1].toLowerCase() : "—"} + YTG orçado`;
        const cards = `<div class="odv-kpis">${this.kpi("Entradas", leg, K.entradas, Km.entradas)}${this.kpi("Saídas", leg, K.saidas, Km.saidas)}${this.kpi("Líquido", leg, K.liquido, Km.liquido)}${this.kpi("Geração de caixa", lgG, K.geracao, Km.geracao)}</div>` + this.legendaSemaforo();
        const barra = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px"><div style="font-weight:800;color:#1c2e24">Visão DFC <span class="odv-lbl" style="margin-left:6px">padrão</span></div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="odv-lbl">Agrupar</span>
            <button type="button" class="odv-chip ${this.agrupar === "visao" ? "esc" : ""}" onclick="${N}.setAgrupar('visao')">Empresa → Visão</button><button type="button" class="odv-chip ${this.agrupar === "centro" ? "esc" : ""}" onclick="${N}.setAgrupar('centro')">Empresa → CC</button>
            <span class="odv-lbl" style="margin-left:6px">Séries</span>
            ${SER.map(([k]) => `<button type="button" class="odv-chip ${k === "real" || this.series[k] ? "on" : ""}" ${k === "real" ? "disabled" : `onclick="${N}.alternarSerie('${k}')"`}>${this.rotSerie(k)[0]}</button>`).join("")}
            <button type="button" class="odv-chip ${this.ahavMensal ? "on" : ""}" onclick="${N}.ahavMensal=!${N}.ahavMensal;${N}.render()">AH/AV mensal</button>
            <button type="button" class="odv-link" style="margin-left:6px" onclick="${N}.expandir(true)">Expandir</button><button type="button" class="odv-link" style="color:#6b8474" onclick="${N}.expandir(false)">Recolher</button>
            <button type="button" class="btn btn-excel" style="height:32px" onclick="${N}.excel()">⬇ Excel</button></div></div>`;
        return cards + `<div class="odv-card">${barra}${this.passo ? `<div style="font-size:0.75rem;color:#166534;margin-bottom:6px">⟳ ${this.esc(this.passo)}</div>` : ""}${this.htmlTabela(M)}</div>
          <div style="font-size:0.7rem;color:#94a3b8">Fonte: mesmos números do DFC (Orçado × Realizado pela Visão DFC padrão do Integra). Planos fora da visão não entram. Cheio = 100%; MLDU = % de consolidação da empresa (cadastro de Empresas). LY é só o realizado do ano anterior. <button type="button" class="odv-link" style="font-size:0.7rem" onclick="switchTab('orion-dfcv', 'DFC (Órion)')">Conferência com o DFC</button>.</div>`;
      });
      root.innerHTML = topo + (this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : "") + corpo;
      this.ligarFiltros();
    }
  });
  window.OrionDfcApp = App;
})();
