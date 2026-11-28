/* Órion (transição) › ponte com o banco do Integra (Supabase).
 * As telas do Órion foram escritas para o Firebase (doc/collection/getDoc/getDocs/setDoc/runTransaction). Depois da
 * virada de 28/11/2026 o Integra não usa mais o Firebase: esta ponte oferece as mesmas funções em window.OrionBanco,
 * gravando cada documento em public.configuracoes com a chave "<coleção>/<id>" (DadosNucleo.lerConfig / gravarConfig /
 * listarDocs), sem tabela nova.
 * - dfc_orcamento e estoque_comercial são bases do Integra em tabelas próprias: aqui só leitura, pelas camadas da
 *   main (DadosFinanceiro.lerOrcamentoDfc e DadosEngenharia.lerEstoqueDocs).
 * - runTransaction: lê na hora e grava tudo no fim, em sequência (não há trava entre duas pessoas salvando juntas).
 * - Documento apagado fica com valor null em configuracoes e deixa de aparecer nas leituras.
 * - Arquivos (ref, uploadBytes, getDownloadURL, deleteObject...) seguem pelo js/nucleo/storage-supabase.js. */
(function () {
  "use strict";
  const DB = { banco: "supabase", orion: true };
  const SO_LEITURA = { dfc_orcamento: true, estoque_comercial: true };

  function dn() {
    if (!window.DadosNucleo) throw new Error("Banco do Integra ainda não carregou.");
    return window.DadosNucleo;
  }
  function snap(id, dados) {
    return {
      id: String(id),
      exists: function () { return dados !== null && dados !== undefined; },
      data: function () { return dados === null || dados === undefined ? undefined : dados; },
    };
  }
  function lista(docs) {
    return { docs: docs, size: docs.length, empty: docs.length === 0, forEach: function (fn) { docs.forEach(fn); } };
  }

  function doc(db, col, id) {
    return { tipo: "doc", col: String(col), id: String(id), path: col + "/" + id };
  }
  function collection(db, col) {
    return { tipo: "col", col: String(col), path: String(col) };
  }
  function limit(n) { return { limite: Number(n) || 0 }; }
  function query(colRef) {
    const mods = Array.prototype.slice.call(arguments, 1);
    const lim = mods.find(function (m) { return m && m.limite; });
    return Object.assign({}, colRef, { limite: lim ? lim.limite : 0 });
  }
  function serverTimestamp() { return Date.now(); }

  async function getDoc(ref) {
    if (ref.col === "dfc_orcamento") {
      const d = window.DadosFinanceiro ? await window.DadosFinanceiro.lerOrcamentoDfc(ref.id) : null;
      return snap(ref.id, d);
    }
    if (ref.col === "estoque_comercial") {
      const s = window.DadosEngenharia ? await window.DadosEngenharia.lerEstoqueDocs({ semControle: true }) : null;
      const achado = s ? s.docs.find(function (x) { return x.id === ref.id; }) : null;
      return snap(ref.id, achado ? achado.data() : null);
    }
    const s = await dn().lerConfig(ref.id, ref.col);
    return snap(ref.id, s && s.exists() ? s.data() : null);
  }

  async function getDocs(ref) {
    if (SO_LEITURA[ref.col]) throw new Error("A coleção " + ref.col + " não é lida inteira pelo Órion.");
    const s = await dn().listarDocs(ref.col);
    let docs = s.docs.filter(function (d) { return d.exists(); }).map(function (d) { return snap(d.id, d.data()); });
    if (ref.limite) docs = docs.slice(0, ref.limite);
    return lista(docs);
  }

  function recusar(ref) {
    return Promise.reject(new Error("A base " + ref.col + " é do Integra: o Órion só lê."));
  }
  async function setDoc(ref, dados, opcoes) {
    if (SO_LEITURA[ref.col]) return recusar(ref);
    await dn().gravarConfig(ref.id, JSON.parse(JSON.stringify(dados || {})), opcoes || {}, ref.col);
  }
  async function updateDoc(ref, campos) {
    if (SO_LEITURA[ref.col]) return recusar(ref);
    await dn().gravarConfig(ref.id, JSON.parse(JSON.stringify(campos || {})), { merge: true }, ref.col);
  }
  async function deleteDoc(ref) {
    if (SO_LEITURA[ref.col]) return recusar(ref);
    const valores = {};
    valores[ref.col + "/" + ref.id] = null;
    await dn().gravarConfiguracoes(valores);
  }

  async function runTransaction(db, fn) {
    // Passa pelas funções públicas (window.OrionBanco), que o orion-base-integra.js envolve para proteger o orçamento do Integra.
    const B = window.OrionBanco;
    const ops = [];
    const tx = {
      get: function (r) { return B.getDoc(r); },
      set: function (r, d, o) { ops.push(function () { return B.setDoc(r, d, o); }); return tx; },
      update: function (r, c) { ops.push(function () { return B.updateDoc(r, c); }); return tx; },
      delete: function (r) { ops.push(function () { return B.deleteDoc(r); }); return tx; },
    };
    const resultado = await fn(tx);
    for (let i = 0; i < ops.length; i++) await ops[i]();
    return resultado;
  }

  const api = {
    db: DB, doc: doc, collection: collection, query: query, limit: limit, serverTimestamp: serverTimestamp,
    getDoc: getDoc, getDocs: getDocs, setDoc: setDoc, updateDoc: updateDoc, deleteDoc: deleteDoc, runTransaction: runTransaction,
  };
  // Arquivos: as mesmas funções do storage-supabase.js (lidas na hora, porque ele pode carregar depois).
  ["ref", "uploadBytes", "uploadBytesResumable", "getDownloadURL", "deleteObject", "listAll", "getMetadata"].forEach(function (k) {
    Object.defineProperty(api, k, {
      enumerable: true,
      get: function () { return window.firebaseCollections ? window.firebaseCollections[k] : undefined; },
    });
  });
  window.OrionBanco = api;
})();
