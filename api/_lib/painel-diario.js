const { dados, checar } = require("../../lib/dados-servidor");

// Supabase (service role). comercial_batimento: uma linha por mês ("AAAA-MM", vendas/distratos em jsonb, sem partes)
// + linhas "_state" e "_meta" (objeto em "dados"). vistoria_batimento: uma linha por dia (clientes em jsonb).
const COM_COL = "comercial_batimento";
const VIS_COL = "vistoria_batimento";
const sb = () => dados().sb;

async function lerControle(id) {
  const l = checar(await sb().from(COM_COL).select("dados").eq("id", id).maybeSingle());
  return l && l.dados && typeof l.dados === "object" ? l.dados : null;
}

async function gravarControle(id, obj) {
  checar(await sb().from(COM_COL).upsert({ id, dados: obj }, { onConflict: "id" }));
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function monthsUntil(today) {
  const d = new Date(String(today).slice(0, 10) + "T12:00:00-03:00");
  const endY = d.getFullYear();
  const endM = d.getMonth() + 1;
  const out = [];
  for (let y = endY - 3; y <= endY; y++) {
    const last = y === endY ? endM : 12;
    for (let m = 1; m <= last; m++) out.push({ year: y, month: m, id: y + "-" + pad(m) });
  }
  return out;
}

function lastDay(year, month) {
  return pad(new Date(year, month, 0).getDate());
}

function slimUnit(u) {
  if (!u) return null;
  return {
    id: u.id || u.unitId || "",
    unitId: u.unitId || u.id || "",
    enterpriseId: u.enterpriseId || u.costCenterId || "",
    costCenterId: u.costCenterId || u.enterpriseId || "",
    enterpriseName: u.enterpriseName || "",
    privateArea: u.privateArea || u.indexedPrivateArea || u.totalArea || u.area || 0
  };
}

function slimContract(c) {
  if (!c) return null;
  const units = (c.salesContractUnits || c.units || []).map(slimUnit).filter(Boolean);
  return {
    id: c.id,
    enterpriseId: c.enterpriseId || c.costCenterId || "",
    costCenterId: c.costCenterId || c.enterpriseId || "",
    enterpriseName: c.enterpriseName || "",
    unitId: c.unitId || "",
    totalArea: c.totalArea || c.privateArea || c.indexedPrivateArea || 0,
    issueDate: String(c.issueDate || c.contractDate || c.saleDate || "").slice(0, 10),
    cancellationDate: String(c.cancellationDate || c.cancelDate || "").slice(0, 10),
    salesContractUnits: units
  };
}

async function fetchPages(fetchAllPages, path) {
  try {
    const rows = await fetchAllPages(path);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}

async function fetchMonth(fetchAllPages, year, month) {
  const first = year + "-" + pad(month) + "-01";
  const last = year + "-" + pad(month) + "-" + lastDay(year, month);
  const [ativas, canceladas, quitadas, distratos] = await Promise.all([
    fetchPages(fetchAllPages, "/sales-contracts?situation=2&initialIssueDate=" + first + "&finalIssueDate=" + last),
    fetchPages(fetchAllPages, "/sales-contracts?situation=3&initialIssueDate=" + first + "&finalIssueDate=" + last),
    fetchPages(fetchAllPages, "/sales-contracts?situation=4&initialIssueDate=" + first + "&finalIssueDate=" + last),
    fetchPages(fetchAllPages, "/sales-contracts?situation=3&initialCancelDate=" + first + "&finalCancelDate=" + last)
  ]);
  const seen = new Set();
  const vendas = [];
  ativas.concat(canceladas).concat(quitadas).forEach((c) => {
    const id = String(c && c.id != null ? c.id : "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    const slim = slimContract(c);
    if (slim) vendas.push(slim);
  });
  return {
    year: year,
    month: month,
    vendas: vendas,
    distratos: distratos.map(slimContract).filter(Boolean)
  };
}

async function saveMonth(row) {
  const id = row.year + "-" + pad(row.month);
  checar(await sb().from(COM_COL).upsert({
    id,
    ano: row.year,
    mes: row.month,
    vendas: row.vendas || [],
    distratos: row.distratos || []
  }, { onConflict: "id" }));
}

function clientFromBill(b, acc) {
  const sale = String(b.saleId || b.id || "");
  if (!sale) return;
  const cur = acc.get(sale) || {
    customerId: b.customerId || 0,
    customerName: b.clientName || "",
    saleId: b.saleId || b.id,
    contractId: b.saleId || b.id,
    id: b.saleId || b.id,
    billIds: [],
    saleCode: b.realSaleId || "",
    contractNumber: b.realSaleId || "",
    realSaleId: b.realSaleId || "",
    unitName: b.units || "",
    unit: b.units || "",
    companyId: b.companyId || "",
    costCenterId: b.costCenterId || "",
    maxDaysDelay: 0,
    billCount: 0,
    overdueValue: 0,
    overdueCharges: 0,
    subjudice: false
  };
  if (!cur.billIds.includes(String(b.id))) cur.billIds.push(String(b.id));
  cur.maxDaysDelay = Math.max(cur.maxDaysDelay, Number(b.daysDelay) || 0);
  cur.billCount += (b.defaulterInstallments && b.defaulterInstallments.length) || 1;
  cur.overdueValue += Number(b.value) || 0;
  cur.overdueCharges += (Number(b.interest) || 0) + (Number(b.fine) || 0);
  if (b.subjudice === "S" || b.subjudice === true) cur.subjudice = true;
  if (b.clientName) cur.customerName = b.clientName;
  acc.set(sale, cur);
}

async function buildVistoriaClients(today) {
  const r = await dados().DadosCobranca.lerBlocosDia(today);
  if (!r) return [];
  const acc = new Map();
  (r.lista || []).forEach((b) => clientFromBill(b, acc));
  return Array.from(acc.values());
}

async function saveVistoria(today, clients) {
  checar(await sb().from(VIS_COL).upsert({ id: today, date: today, clientes: clients, total: clients.length }, { onConflict: "id" }));
}

module.exports = async function advancePainelDiario(ctx) {
  const { req, res, today, started, log, fetchAllPages, continuar } = ctx;
  const budget = 42000;
  let state = null;
  try {
    const s = await lerControle("_state");
    if (s && s.date === today) state = s;
  } catch (e) {}
  if (!state) {
    state = { date: today, step: "comercial", index: 0, months: monthsUntil(today).map((m) => m.id) };
  }
  if (state.step === "done") {
    return res.status(200).json({ done: true, filaPronta: true, date: today, step: "painel", log: log });
  }

  if (state.step === "comercial") {
    const months = state.months && state.months.length ? state.months : monthsUntil(today).map((m) => m.id);
    state.months = months;
    const id = months[state.index || 0];
    if (!id) {
      state.step = "vistoria";
    } else if (Date.now() - started < budget) {
      const parts = id.split("-");
      const year = Number(parts[0]);
      const month = Number(parts[1]);
      try {
        const row = await fetchMonth(fetchAllPages, year, month);
        await saveMonth(row);
        log.push("comercial " + id + ": " + row.vendas.length + " vendas, " + row.distratos.length + " distratos");
      } catch (e) {
        log.push("comercial " + id + " falhou: " + e.message);
      }
      state.index = (state.index || 0) + 1;
      if (state.index >= months.length) state.step = "vistoria";
      await gravarControle("_state", state);
    }
    if (state.step === "comercial") {
      await continuar();
      return res.status(200).json({ done: false, filaPronta: true, date: today, step: "comercial", index: state.index, total: state.months.length, log: log });
    }
  }

  if (state.step === "vistoria") {
    try {
      const clients = await buildVistoriaClients(today);
      await saveVistoria(today, clients);
      log.push("vistoria: " + clients.length + " contratos");
    } catch (e) {
      log.push("vistoria falhou: " + e.message);
    }
    state.step = "done";
    await gravarControle("_state", state);
    await gravarControle("_meta", {
      date: today,
      done: true,
      months: state.months || [],
      updatedAt: new Date().toISOString()
    });
  }

  return res.status(200).json({ done: true, filaPronta: true, date: today, step: "painel", log: log });
};
