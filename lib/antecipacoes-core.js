/**
 * Antecipações de parcelas (Contas a Receber).
 * Lê as linhas do bulk-data /income do Sienge (seleção por data de pagamento) e monta um "evento"
 * por título + data do pagamento: quando o cliente antecipa várias parcelas no mesmo dia (ou quita),
 * o Sienge espalha o desconto por igual entre elas, então a conta só fecha somando o evento.
 *
 * Para cada parcela paga antes do vencimento:
 *   VF   = valor da parcela na baixa (bruto + correção monetária)
 *   VP   = VF / (1 + taxa do contrato)^(meses entre o mês do pagamento e o mês do vencimento)
 *          (é o valor sem os juros do parcelamento; conferido no centavo com o Sienge em out/2026)
 *   Pago = valor líquido recebido
 * No evento:
 *   desconto de juros     = VF - VP   (retirada obrigatória dos juros do parcelamento)
 *   desconto comercial    = VP - Pago (o que foi dado além dos juros; negativo = cobrou acima do VP)
 *   desconto total        = VF - Pago
 * Faixa: "31+" se alguma parcela do evento foi paga 31 dias ou mais antes do vencimento; senão "ate30".
 */

function dia(iso) {
  return new Date(String(iso).slice(0, 10) + "T12:00:00Z");
}

function diasEntre(a, b) {
  return Math.round((dia(b) - dia(a)) / 86400000);
}

function mesesEntre(a, b) {
  const A = dia(a);
  const B = dia(b);
  return (B.getUTCFullYear() - A.getUTCFullYear()) * 12 + (B.getUTCMonth() - A.getUTCMonth());
}

function r2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

/** Linhas do /income -> eventos de antecipação (título + data do pagamento). */
function montarEventos(rows) {
  const eventos = new Map();
  (rows || []).forEach((x) => {
    if (!x || !x.dueDate) return;
    (x.receipts || []).forEach((r) => {
      if (!r || Number(r.operationTypeId) !== 2 || !r.paymentDate) return;
      const pagamento = String(r.paymentDate).slice(0, 10);
      const vencimento = String(x.dueDate).slice(0, 10);
      const dias = diasEntre(pagamento, vencimento);
      if (dias <= 0) return;
      const pago = Number(r.netAmount) || 0;
      if (pago <= 0) return; // baixa sem dinheiro (permuta, cancelamento): não é antecipação
      const vf = (Number(r.grossAmount) || 0) + (Number(r.monetaryCorrectionAmount) || 0);
      const taxa = Number(x.interestRate) || 0;
      const meses = Math.max(0, mesesEntre(pagamento, vencimento));
      const vp = taxa > 0 && meses > 0 ? vf / Math.pow(1 + taxa / 100, meses) : vf;
      const chave = `${x.billId}|${pagamento}`;
      let ev = eventos.get(chave);
      if (!ev) {
        const cat = (((r.bankMovements || [])[0] || {}).financialCategories || [])[0] || {};
        ev = {
          k: chave,
          tit: x.billId,
          data: pagamento,
          emp: x.companyId,
          empNome: x.companyName || "",
          cli: x.clientName || "",
          cliId: x.clientId || "",
          unid: x.mainUnit || "",
          cc: cat.costCenterId || "",
          ccNome: cat.costCenterName || "",
          doc: [String(x.documentIdentificationId || "").trim(), x.documentNumber || ""].filter(Boolean).join(" "),
          taxa,
          tipoJuros: x.interestType || "",
          parcelas: [],
          vf: 0, vp: 0, pago: 0, descSienge: 0,
          maxDias: 0, minDias: Infinity
        };
        eventos.set(chave, ev);
      }
      // Parcela compacta (o mês inteiro precisa caber em poucos documentos):
      // [número, condição, vencimento, dias antes, VF, VP, pago, desconto do Sienge]
      ev.parcelas.push([
        String(x.installmentNumber || x.installmentId || ""),
        (x.paymentTerm && x.paymentTerm.id) || "",
        vencimento,
        dias,
        r2(vf),
        r2(vp),
        r2(pago),
        r2(r.discountAmount)
      ]);
      ev.vf += vf;
      ev.vp += vp;
      ev.pago += pago;
      ev.descSienge += Number(r.discountAmount) || 0;
      if (dias > ev.maxDias) ev.maxDias = dias;
      if (dias < ev.minDias) ev.minDias = dias;
    });
  });
  return Array.from(eventos.values()).map((ev) => {
    ev.parcelas.sort((a, b) => String(a[2]).localeCompare(String(b[2])));
    ev.vf = r2(ev.vf);
    ev.vp = r2(ev.vp);
    ev.pago = r2(ev.pago);
    ev.descSienge = r2(ev.descSienge);
    ev.juros = r2(ev.vf - ev.vp);
    ev.comercial = r2(ev.vp - ev.pago);
    ev.descTotal = r2(ev.vf - ev.pago);
    ev.np = ev.parcelas.length;
    if (ev.minDias === Infinity) ev.minDias = 0;
    ev.faixa = ev.maxDias >= 31 ? "31+" : "ate30";
    return ev;
  }).sort((a, b) => a.data.localeCompare(b.data) || String(a.tit).localeCompare(String(b.tit)));
}

/** Divide o JSON de um mês em partes que cabem num documento do Firestore (limite 1 MB). */
function partesDoMes(eventos, limite) {
  const lim = limite || 700000;
  const texto = JSON.stringify(eventos || []);
  const partes = [];
  for (let i = 0; i < texto.length; i += lim) partes.push(texto.slice(i, i + lim));
  return partes.length ? partes : ["[]"];
}

module.exports = { montarEventos, partesDoMes, diasEntre, mesesEntre };
