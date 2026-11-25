/**
 * Batimento das 7h da Remessa avulsa.
 * Mesma leitura da tela: extrato CT/TC do mês, sem recebimento e sem boleto,
 * situação Normal, condição Parcelas Mensais ou Parcela Acordo.
 * Cliente com financiamento em aberto fica de fora.
 * Também resume as parcelas desses financiamentos: vencida, neste mês ou no mês seguinte.
 */

function pad(n) {
  return String(n).padStart(2, "0");
}

function iso(d) {
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}

function fimDoMes(isoDia) {
  const p = String(isoDia).slice(0, 10).split("-").map(Number);
  return iso(new Date(Date.UTC(p[0], p[1], 0, 12)));
}

function fimDoMesSeguinte(isoDia) {
  const p = String(isoDia).slice(0, 10).split("-").map(Number);
  return iso(new Date(Date.UTC(p[0], p[1] + 1, 0, 12)));
}

function addDays(isoDia, n) {
  const p = String(isoDia).slice(0, 10).split("-").map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n, 12));
  return iso(d);
}

function soDigitos(v) {
  return String(v == null ? "" : v).replace(/\D/g, "");
}

function linhasDe(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

function obj(v) {
  return v && typeof v === "object" ? v : null;
}

function titulosDoExtrato(row) {
  if (!row || typeof row !== "object") return [];
  if (row.billReceivableId || row.receivableBillId || Array.isArray(row.installments)) return [row];
  const nested = row.billsReceivable || row.bills;
  return Array.isArray(nested) ? nested : [];
}

function semRecebimento(inst) {
  const recs = inst && inst.receipts;
  if (!recs) return true;
  const lista = Array.isArray(recs) ? recs : [recs];
  if (!lista.length) return true;
  return lista.every((r) => !r || r.type == null || String(r.type).trim() === "");
}

function parcelaEmAberto(inst) {
  if (!inst) return false;
  const bal = inst.currentBalance != null ? inst.currentBalance : inst.balance;
  if (bal != null && bal !== "" && !isNaN(Number(bal))) return Number(bal) > 0.009;
  return semRecebimento(inst);
}

function boletoNaoGerado(inst) {
  const v = inst && inst.sentToScripturalCharge;
  return v === false || v === "false" || v === 0 || v === "0";
}

function situacaoNormal(valor) {
  return String(valor || "").trim().toLowerCase() === "normal";
}

function condicaoElegivel(id, descricao) {
  const d = String(descricao || "");
  const i = String(id || "");
  if (d.indexOf("Entrada") >= 0) return false;
  if (i.indexOf("SI") >= 0) return false;
  if (d.indexOf("Unica") >= 0 || d.indexOf("Única") >= 0) return false;
  if (i.indexOf("SA") >= 0) return false;
  if (d === "Parcelas Mensais") return true;
  if (d.indexOf("Parcela Acordo") >= 0) return true;
  return false;
}

function termoDaLinha(row) {
  const termo = obj(row && row.paymentTerm) || {};
  return {
    id: termo.id != null ? termo.id : (row && (row.paymentTermId || row.conditionType)),
    descricao: termo.descrition || termo.description || termo.name || ""
  };
}

function processosAbertos(raw) {
  let mapa = {};
  try { mapa = JSON.parse(raw || "{}") || {}; } catch (e) { mapa = {}; }
  if (!mapa || typeof mapa !== "object" || Array.isArray(mapa)) mapa = {};
  const titulos = new Set();
  const clientes = new Set();
  const lista = [];
  Object.keys(mapa).forEach((key) => {
    const proc = mapa[key];
    if (!proc || typeof proc !== "object") return;
    const st = String(proc.status || "").toLowerCase();
    if (st === "concluido" || st === "encerrado" || st === "cancelado" || st === "closed") return;
    if (proc.closedAt || proc.finishedAt) return;
    const titulo = soDigitos(proc.titulo);
    const cliente = soDigitos(proc.customerId);
    if (titulo) titulos.add(titulo);
    if (cliente) clientes.add(cliente);
    lista.push({
      key: key,
      titulo: titulo,
      clienteId: cliente,
      cliente: String(proc.customerName || "")
    });
  });
  return { titulos, clientes, lista };
}

async function bulkPeriodo(getJson, montar, de, ate, depth) {
  try {
    return linhasDe(await getJson(montar(de, ate)));
  } catch (err) {
    if (Number(err && err.status) !== 507 || de >= ate || depth > 8) throw err;
    const a = new Date(de + "T12:00:00Z").getTime();
    const b = new Date(ate + "T12:00:00Z").getTime();
    const mid = iso(new Date(a + Math.floor((b - a) / 2)));
    const next = addDays(mid, 1);
    if (!mid || mid < de || mid >= ate || next > ate) throw err;
    const esq = await bulkPeriodo(getJson, montar, de, mid, depth + 1);
    const dir = await bulkPeriodo(getJson, montar, next, ate, depth + 1);
    return esq.concat(dir);
  }
}

function montarLinhas(extrato, income, condicoes, fin) {
  const situacao = new Map();
  income.forEach((row) => {
    const id = soDigitos(row && (row.billId || row.receivableBillId || row.billReceivableId));
    if (!id) return;
    if (!situacao.has(id)) situacao.set(id, new Set());
    situacao.get(id).add(String(row.defaulterSituation || ""));
  });
  const termos = new Map();
  condicoes.forEach((row) => {
    const titulo = soDigitos(row && (row.billId || row.receivableBillId));
    const parcela = String(row && (row.installmentId != null ? row.installmentId : row.installmentNumber) || "");
    if (!titulo || !parcela) return;
    const chave = titulo + "|" + parcela;
    if (!termos.has(chave)) termos.set(chave, []);
    termos.get(chave).push(termoDaLinha(row));
  });
  const vistos = new Set();
  const linhas = [];
  extrato.forEach((item) => {
    titulosDoExtrato(item).forEach((bill) => {
      const titulo = soDigitos(bill.billReceivableId || bill.receivableBillId);
      if (!titulo) return;
      const sits = situacao.get(titulo);
      if (!sits) return;
      let normal = false;
      sits.forEach((s) => { if (situacaoNormal(s)) normal = true; });
      if (!normal) return;
      const empresaObj = obj(bill.company) || obj(item.company);
      const ccObj = obj(bill.costCenter) || obj(item.costCenter);
      const cliObj = obj(bill.customer) || obj(item.customer);
      const empresaId = String((empresaObj && (empresaObj.id || empresaObj.companyId)) || bill.companyId || item.companyId || "");
      const ccId = String((ccObj && (ccObj.id || ccObj.costCenterId)) || bill.costCenterId || item.costCenterId || "");
      const clienteId = soDigitos((cliObj && cliObj.id) || bill.clientId || bill.customerId);
      const cliente = String((cliObj && (cliObj.name || cliObj.tradeName)) || bill.clientName || "");
      if (fin.titulos.has(titulo) || fin.clientes.has(clienteId)) return;
      (bill.installments || []).forEach((inst) => {
        if (!inst || !boletoNaoGerado(inst) || !semRecebimento(inst)) return;
        const venc = String(inst.dueDate || inst.originalDueDate || "").slice(0, 10);
        const parcela = String(inst.id != null ? inst.id : (inst.installmentId != null ? inst.installmentId : ""));
        if (!parcela || !venc) return;
        const lista = termos.get(titulo + "|" + parcela) || [];
        if (!lista.some((t) => condicaoElegivel(t.id, t.descricao))) return;
        const chave = titulo + "|" + parcela;
        if (vistos.has(chave)) return;
        vistos.add(chave);
        linhas.push({
          conta: "",
          empresaId: empresaId,
          empresa: String((empresaObj && empresaObj.name) || "").toUpperCase(),
          cc: ccId,
          empreendimento: String((ccObj && ccObj.name) || "").toUpperCase(),
          titulo: titulo,
          parcela: parcela,
          clienteId: clienteId,
          cliente: cliente.toUpperCase(),
          vencimento: venc
        });
      });
    });
  });
  linhas.sort((a, b) => String(a.empresa).localeCompare(b.empresa, "pt-BR")
    || String(a.cc).localeCompare(b.cc, "pt-BR", { numeric: true })
    || String(a.cliente).localeCompare(b.cliente, "pt-BR"));
  return linhas;
}

function resumir(proc, itens, hoje, fimMes, fimSeg) {
  let vencidas = 0;
  let mes = 0;
  let seguinte = 0;
  let maisAntiga = "";
  let primeiraMes = "";
  let primeiraSeguinte = "";
  itens.forEach((inst) => {
    if (!parcelaEmAberto(inst)) return;
    const venc = String(inst.dueDate || inst.originalDueDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(venc) || venc > fimSeg) return;
    if (venc < hoje) {
      vencidas += 1;
      if (!maisAntiga || venc < maisAntiga) maisAntiga = venc;
    } else if (venc <= fimMes) {
      mes += 1;
      if (!primeiraMes || venc < primeiraMes) primeiraMes = venc;
    } else {
      seguinte += 1;
      if (!primeiraSeguinte || venc < primeiraSeguinte) primeiraSeguinte = venc;
    }
  });
  if (!vencidas && !mes && !seguinte) return null;
  return {
    key: proc.key,
    cliente: proc.cliente,
    titulo: proc.titulo,
    clienteId: proc.clienteId,
    vencidas: vencidas,
    mes: mes,
    seguinte: seguinte,
    maisAntiga: maisAntiga,
    primeiraMes: primeiraMes,
    primeiraSeguinte: primeiraSeguinte
  };
}

async function parcelasDosFinanciamentos(getJson, lista, hoje, fimSeg) {
  const fimMes = fimDoMes(hoje);
  const out = [];
  const limite = Date.now() + 40000;
  const comTitulo = lista.filter((p) => p.titulo);
  for (let i = 0; i < comTitulo.length; i += 3) {
    if (Date.now() > limite) break;
    const parte = comTitulo.slice(i, i + 3);
    const achados = await Promise.all(parte.map(async (proc) => {
      const path = "/bulk-data/v1/customer-extract-history?startDueDate=1996-01-01&endDueDate=" + encodeURIComponent(fimSeg)
        + "&billReceivableId=" + encodeURIComponent(proc.titulo)
        + "&documentsId=" + encodeURIComponent("CT,TC")
        + "&includeRemadeInstallments=false&includeCanceledInstallments=false&includeRevokedInstallments=false&includeRenegotiatedDischarge=false";
      try {
        const extrato = linhasDe(await getJson(path));
        const itens = [];
        extrato.forEach((item) => {
          titulosDoExtrato(item).forEach((bill) => {
            if (soDigitos(bill.billReceivableId || bill.receivableBillId) !== proc.titulo) return;
            (bill.installments || []).forEach((inst) => itens.push(inst));
          });
        });
        return resumir(proc, itens, hoje, fimMes, fimSeg);
      } catch (e) {
        return null;
      }
    }));
    achados.forEach((p) => { if (p) out.push(p); });
  }
  return out;
}

async function runRemessaAvulsaBatimento(deps) {
  const today = deps.today;
  const ref = deps.doc(deps.db, "remessa_avulsa_batimento", "atual");
  const snap = await deps.getDoc(ref);
  const prev = snap.exists() ? (snap.data() || {}) : {};
  if (!deps.force && prev.date === today && prev.done) {
    return { ok: true, skipped: true, date: today, total: Number(prev.total) || 0 };
  }
  if (prev.date === today && Number(prev.lockAte || 0) > Date.now()) {
    return { ok: true, locked: true, date: today };
  }
  await deps.setDoc(ref, { date: today, done: false, lockAte: Date.now() + 3 * 60 * 1000 }, { merge: true });
  try {
    const de = today.slice(0, 8) + "01";
    const ate = fimDoMes(today);
    const fimSeg = fimDoMesSeguinte(today);
    const cfg = await deps.getDoc(deps.doc(deps.db, "config", "global"));
    const rawProc = cfg.exists() ? String((cfg.data() || {}).crm_moura_financiamentos_proc || "{}") : "{}";
    const fin = processosAbertos(rawProc);
    const base = deps.bulkBase;
    const getJson = (path) => deps.getJson(base + path);
    const extratoPath = (ini, fim) => "/bulk-data/v1/customer-extract-history?startDueDate=" + encodeURIComponent(ini)
      + "&endDueDate=" + encodeURIComponent(fim)
      + "&documentsId=" + encodeURIComponent("CT,TC")
      + "&includeRemadeInstallments=false&includeCanceledInstallments=false&includeRevokedInstallments=false&includeRenegotiatedDischarge=false";
    const incomePath = (ini, fim) => "/bulk-data/v1/income?startDate=" + encodeURIComponent(ini)
      + "&endDate=" + encodeURIComponent(fim)
      + "&selectionType=D";
    const extrato = await bulkPeriodo(getJson, extratoPath, de, ate, 0);
    const income = await bulkPeriodo(getJson, incomePath, de, ate, 0);
    const condicoes = await bulkPeriodo(getJson, (ini, fim) => incomePath(ini, fim) + "&originsIds=CO", de, ate, 0);
    const linhas = montarLinhas(extrato, income, condicoes, fin).filter((r) => r.vencimento >= de && r.vencimento <= ate);
    const guardadas = linhas.slice(0, 2500);
    const parcelas = await parcelasDosFinanciamentos(getJson, fin.lista, today, fimSeg);
    await deps.setDoc(ref, {
      date: today,
      done: true,
      lockAte: 0,
      at: new Date().toISOString(),
      de: de,
      ate: ate,
      total: linhas.length,
      truncado: linhas.length > guardadas.length,
      linhas: guardadas,
      parcelas: parcelas
    });
    return { ok: true, date: today, total: linhas.length, parcelas: parcelas.length };
  } catch (e) {
    try { await deps.setDoc(ref, { lockAte: 0 }, { merge: true }); } catch (e2) {}
    throw e;
  }
}

module.exports = { runRemessaAvulsaBatimento };
