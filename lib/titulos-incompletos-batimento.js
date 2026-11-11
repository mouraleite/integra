/** Fila do batimento de títulos incompletos. A idade conta os dias corridos desde a primeira manhã em que o título entrou na fila. */

function chaveTitulo(row) {
  const r = row || {};
  return [r.titulo, r.vencimento, r.documento, r.tipo, r.empresa].join("|");
}

function diasEntre(de, ate) {
  const ms = (iso) => {
    const p = String(iso || "").slice(0, 10).split("-").map(Number);
    if (p.length !== 3 || !p[0]) return NaN;
    return Date.UTC(p[0], p[1] - 1, p[2]);
  };
  const diff = Math.round((ms(ate) - ms(de)) / 86400000);
  return diff > 0 ? diff : 0;
}

function aplicarFila(rows, primeiros, today) {
  const base = primeiros && typeof primeiros === "object" ? primeiros : {};
  const dia = String(today || "").slice(0, 10);
  const vivos = {};
  const saida = (rows || []).map((row) => {
    const k = chaveTitulo(row);
    const antigo = String(base[k] || "").slice(0, 10);
    const desde = antigo && antigo <= dia ? antigo : dia;
    vivos[k] = desde;
    return Object.assign({}, row, { diasCiente: diasEntre(desde, dia) });
  });
  return { rows: saida, primeiros: vivos };
}

function normalizarOutcome(bill) {
  const b = bill || {};
  const status = String(b.consistencyStatus || "").trim().toUpperCase();
  if (status !== "N" && status !== "I") return null;
  return {
    empresa: String(b.companyName || "").trim(),
    tipo: String(b.documentIdentificationId || "").trim(),
    documento: String(b.documentNumber || "").trim(),
    titulo: String(b.billId || "").trim(),
    credor: String(b.creditorName || "").trim(),
    vencimento: String(b.dueDate || "").slice(0, 10),
    emissao: String(b.issueDate || "").slice(0, 10),
    valor: Number(b.originalAmount) || 0,
    legenda: status === "N" ? "Incompleto" : "Em inclusão"
  };
}

function ehAnalistaPagadoriaI(nome) {
  const n = String(nome || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n.includes("ANALISTA") || !n.includes("PAGADORIA")) return false;
  if (/\bII\b/.test(n) || /\b2\b/.test(n)) return false;
  return /\bI\b/.test(n) || /\b1\b/.test(n);
}

module.exports = {
  chaveTitulo,
  diasEntre,
  aplicarFila,
  normalizarOutcome,
  ehAnalistaPagadoriaI
};
