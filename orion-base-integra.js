/* Órion (transição) › orçamento do Integra nas telas do Órion.
 * O Integra já tem o orçamento de 2027 (receitas e despesas) na base da tela Orçamento › Acompanhamento: o Excel
 * "Base para importação - 2027.xlsm" gravado na coleção dfc_orcamento (documentos 2027_v1 e 2027_v2; sem eles, o arquivo
 * embutido orcamento-dfc-2027.js). Regra do módulo Órion: as telas são do Órion, os dados são do Integra. Por isso essa base
 * NÃO é copiada para orion_orcamentos: este arquivo faz as telas do Órion enxergarem cada versão como um documento
 * "Orçamento" (despesas e receitas) do departamento "Orçamento do Integra", só para leitura:
 *  - a versão 2 (quando existe) é a vigente (Aprovado) e a versão 1 fica como Substituído; só com a versão 1, ela é a vigente;
 *  - as linhas vêm do próprio Integra (empresa, centro de custo, conta, nome da conta, 12 meses) em centavos;
 *  - gravar em um desses documentos é recusado: para mudar o orçamento, use Orçamento › Acompanhamento.
 * Como funciona: as telas do Órion leem orion_orcamentos (lista) e orion_orcamento_itens/{id}_{bloco} (linhas). Aqui as funções
 * getDocs / getDoc do Firebase passam a acrescentar esses documentos só nessas duas coleções, e setDoc / updateDoc / deleteDoc
 * recusam ids que começam com "integra_". Nada mais muda. */
(function () {
  const PREFIXO = "integra_";
  const COL_CAB = "orion_orcamentos", COL_ITENS = "orion_orcamento_itens";
  const DEPTO = { id: "integra", nome: "Orçamento do Integra" };
  const dig = (v) => String(v == null ? "" : v).replace(/\D/g, "");

  const B = {
    _p: null,
    cabs: [],
    blocos: {},
    fontes: [],

    C() { return window.OrionOrcamentoCalc; },
    ehVirtual(id) { return String(id || "").indexOf(PREFIXO) === 0; },

    /** Lê um documento dfc_orcamento (com as partes, quando o texto foi dividido), como a tela do Integra lê. */
    async lerDoc(orig, id) {
      const fx = window.firebaseCollections, db = window.firebaseDb;
      const s = await orig.getDoc(fx.doc(db, "dfc_orcamento", id));
      if (!s || !s.exists()) return null;
      const x = s.data() || {};
      let texto = x.payload || "";
      if (Array.isArray(x.partes) && x.partes.length) {
        const partes = await Promise.all(x.partes.map(async (pid) => { const p = await orig.getDoc(fx.doc(db, "dfc_orcamento", pid)); return p && p.exists() ? String((p.data() || {}).texto || "") : null; }));
        if (partes.some((p) => p == null)) return null;
        texto = partes.join("");
      }
      let lines = [];
      try { lines = JSON.parse(texto || "[]"); } catch (e) { return null; }
      if (!Array.isArray(lines) || !lines.length) return null;
      return { fileName: x.fileName || "Base 2027", savedAt: Number(x.savedAt) || 0, year: Number(x.year) || 2027, lines };
    },

    carregar(orig) {
      if (!this._p) this._p = this._ler(orig).catch((e) => { console.warn("Orçamento do Integra:", e); this._p = null; return []; });
      return this._p;
    },
    async _ler(orig) {
      const C = this.C();
      if (!C) return [];
      let v1 = null, v2 = null;
      try { v1 = await this.lerDoc(orig, "2027_v1"); } catch (e) { v1 = null; }
      try { v2 = await this.lerDoc(orig, "2027_v2"); } catch (e) { v2 = null; }
      if (!v1) { try { v1 = await this.lerDoc(orig, "2027"); } catch (e) { v1 = null; } }
      const emb = window.ORCAMENTO_DFC_2027;
      if (!v1 && emb && Array.isArray(emb.lines) && emb.lines.length) v1 = { fileName: emb.fileName || "Base 2027", savedAt: Number(emb.savedAt) || 0, year: Number(emb.year) || 2027, lines: emb.lines, embutido: true };
      const redutoras = new Set(((window.ORCAMENTO_RECEITA_2027 && ORCAMENTO_RECEITA_2027.reducers) || []).map(dig));
      const versoes = [[1, v1], [2, v2]].filter(([, p]) => p);
      const cabs = [], blocos = {};
      versoes.forEach(([n, p]) => {
        const vigente = n === versoes[versoes.length - 1][0];
        ["DESPESAS", "RECEITAS"].forEach((tipo) => {
          const prefixo = tipo === "RECEITAS" ? "1" : "2";
          const itens = p.lines.filter((l) => String(l.conta || "").trim().charAt(0) === prefixo).map((l) => {
            const m = (Array.isArray(l.m) ? l.m : []).slice(0, 12).map((v) => C.centavos(Number(v) || 0));
            while (m.length < 12) m.push(0);
            return { cc: dig(l.cc), cc_nome: String(l.en || "").trim(), plano: dig(l.conta), plano_nome: String(l.cn || "").trim(), plano_conta: String(l.conta || ""),
              redutora: redutoras.has(dig(l.conta)), empresa: String(l.e || ""), m, total: m.reduce((s, v) => s + v, 0), obs: "" };
          });
          if (!itens.length) return;
          const id = `${PREFIXO}${p.year}_v${n}_${tipo.toLowerCase()}`;
          const quando = p.savedAt ? new Date(p.savedAt).toISOString() : "";
          cabs.push({
            _id: id, integra: true, ano: p.year, tipo, descricao: "Orçamento", versao: n,
            status: vigente ? "Aprovado" : "Substituído", departamento: DEPTO, produto: null,
            blocos: 1, linhas: itens.length, linhas_venda: 0, vgv: 0, totais: C.somarLinhas(itens),
            empreendimentos: [...new Set(itens.map((l) => l.cc))].sort(),
            criado_em: quando, importado_em: quando, criado_por: `Integra · ${p.fileName}${p.embutido ? " (arquivo embutido)" : ""}`,
            origem_integra: { arquivo: p.fileName, versao: n, gravado_em: quando }
          });
          blocos[id + "_0"] = { _id: id + "_0", orcamento: id, bloco: 0, itens, vendas: [] };
        });
      });
      this.cabs = cabs;
      this.blocos = blocos;
      this.fontes = versoes.map(([n, p]) => ({ versao: n, arquivo: p.fileName, gravado_em: p.savedAt, embutido: !!p.embutido }));
      return cabs;
    },

    /* ---------- ligação com o Firebase ---------- */
    nomeCol(ref) {
      if (!ref) return "";
      if (ref.col) return ref.col; // ambiente de teste
      if (ref.type === "collection") return ref.id;
      if (ref.type === "document" && ref.parent) return ref.parent.id;
      return "";
    },
    snapDoc(id, data) { return { id, exists: () => !!data, data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined), get: (k) => (data ? data[k] : undefined), ref: null }; },
    instalar() {
      const fx = window.firebaseCollections;
      if (!fx || fx.__integraBase) return !!fx;
      const orig = { getDocs: fx.getDocs, getDoc: fx.getDoc, setDoc: fx.setDoc, updateDoc: fx.updateDoc, deleteDoc: fx.deleteDoc };
      const self = this;
      const recusa = () => Promise.reject(new Error("Este documento vem do Orçamento do Integra (Orçamento › Acompanhamento). Para mudar os valores, use aquela tela."));
      const protegido = (ref) => { const c = self.nomeCol(ref); return (c === COL_CAB || c === COL_ITENS) && self.ehVirtual(ref.id); };
      fx.getDocs = async function (ref) {
        const snap = await orig.getDocs.apply(this, arguments);
        let virt = [];
        try { if (self.nomeCol(ref) === COL_CAB && (!ref.type || ref.type === "collection")) virt = await self.carregar(orig); } catch (e) { virt = []; }
        if (!virt.length) return snap;
        const docs = (snap.docs || []).concat(virt.map((c) => self.snapDoc(c._id, c)));
        return { docs, size: docs.length, empty: !docs.length, forEach: (fn) => docs.forEach(fn), query: snap.query, metadata: snap.metadata, docChanges: () => [] };
      };
      fx.getDoc = async function (ref) {
        try {
          if (self.nomeCol(ref) === COL_ITENS && self.ehVirtual(ref.id)) { await self.carregar(orig); return self.snapDoc(ref.id, self.blocos[ref.id] || null); }
          if (self.nomeCol(ref) === COL_CAB && self.ehVirtual(ref.id)) { await self.carregar(orig); return self.snapDoc(ref.id, self.cabs.find((c) => c._id === ref.id) || null); }
        } catch (e) { /* segue para o Firebase */ }
        return orig.getDoc.apply(this, arguments);
      };
      fx.setDoc = function (ref) { if (protegido(ref)) return recusa(); return orig.setDoc.apply(this, arguments); };
      fx.updateDoc = function (ref) { if (protegido(ref)) return recusa(); return orig.updateDoc.apply(this, arguments); };
      fx.deleteDoc = function (ref) { if (protegido(ref)) return recusa(); return orig.deleteDoc.apply(this, arguments); };
      fx.__integraBase = true;
      return true;
    }
  };

  window.OrionBaseIntegra = B;
  if (!B.instalar()) {
    let n = 0;
    const t = setInterval(() => { if (B.instalar() || ++n > 120) clearInterval(t); }, 500);
  }
})();
