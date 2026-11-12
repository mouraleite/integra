/* Gravação dos cadastros vindos do ML Órion no Firestore do Integra.
 * Cada cadastro é UM documento na coleção "orion_config" (ex.: orion_config/cenarios), com:
 *   { itens: [...], versao: n, atualizadoEm, atualizadoPor }
 * Um documento por cadastro = uma leitura por tela (o Firestore cobra por documento lido).
 * A gravação confere a versão: se outra pessoa salvou antes, avisa em vez de sobrescrever.
 * Não toca em nenhuma coleção que já existia no Integra. */
const OrionStore = {
  COLECAO: "orion_config",

  fc() {
    return window.firebaseCollections;
  },

  pronto() {
    return !!(window.firebaseDb && window.firebaseCollections);
  },

  usuario() {
    const u = window.AppState && AppState.currentUser;
    if (!u) return "";
    return String(u.email || u.mail || u.name || "");
  },

  /** Lê o cadastro. Devolve { itens, versao, atualizadoEm, atualizadoPor } (itens = padrao se não existir). */
  async ler(chave, padrao) {
    if (!this.pronto()) throw new Error("Banco do Integra ainda não carregou. Aguarde alguns segundos e tente de novo.");
    const fc = this.fc();
    const snap = await fc.getDoc(fc.doc(window.firebaseDb, this.COLECAO, chave));
    if (!snap.exists()) return { itens: padrao == null ? [] : padrao, versao: 0, atualizadoEm: null, atualizadoPor: "" };
    const d = snap.data() || {};
    return {
      itens: d.itens == null ? (padrao == null ? [] : padrao) : d.itens,
      versao: Number(d.versao) || 0,
      atualizadoEm: d.atualizadoEm && d.atualizadoEm.toDate ? d.atualizadoEm.toDate() : null,
      atualizadoPor: d.atualizadoPor || ""
    };
  },

  /** Grava o cadastro inteiro se a versão no banco ainda for a que a tela leu. Devolve a nova versão. */
  async gravar(chave, itens, versaoLida) {
    if (!this.pronto()) throw new Error("Banco do Integra ainda não carregou.");
    const fc = this.fc();
    const ref = fc.doc(window.firebaseDb, this.COLECAO, chave);
    const quem = this.usuario();
    return fc.runTransaction(window.firebaseDb, async (tx) => {
      const snap = await tx.get(ref);
      const atual = snap.exists() ? Number((snap.data() || {}).versao) || 0 : 0;
      if (atual !== (Number(versaoLida) || 0)) {
        const por = snap.exists() ? (snap.data() || {}).atualizadoPor || "outra pessoa" : "outra pessoa";
        const err = new Error(`Este cadastro foi alterado por ${por} depois que você abriu a tela. Clique em Atualizar e refaça a alteração.`);
        err.conflito = true;
        throw err;
      }
      const nova = atual + 1;
      tx.set(ref, { itens: JSON.parse(JSON.stringify(itens)), versao: nova, atualizadoEm: fc.serverTimestamp(), atualizadoPor: quem });
      return nova;
    });
  }
};

window.OrionStore = OrionStore;
