/**
 * Batimento diário dos reembolsos de custas (07:00, disparado pelo morning-warmup).
 * Lê os títulos a pagar gerados na tela "Pagar reembolso" (custas_judiciais.billId) que ainda
 * não constam como pagos, consulta os pagamentos no Sienge (bulk-data /outcome por data de
 * pagamento) e grava reemPago/pagoEm no próprio documento. A tela já abre com a situação certa.
 * ?force=1 roda de novo no mesmo dia.
 */
const { dados, checar } = require("./dados-servidor");
const { todayIsoSP } = require("./br-calendar");

const SIENGE_DOMAIN = "mouraleite";
// Usuário e senha da API do Sienge ficam nas variáveis da Vercel, nunca no código.
const SIENGE_USER = process.env.SIENGE_API_USER || "";
const SIENGE_PASS = process.env.SIENGE_API_PASSWORD || "";
const SIENGE_AUTH = "Basic " + Buffer.from(`${SIENGE_USER}:${SIENGE_PASS}`).toString("base64");
const SIENGE_BULK_BASE = `https://api.sienge.com.br/${SIENGE_DOMAIN}/public/api`;

const COL = "custas_judiciais";
const ESTADO = "reembolso_batimento"; // config/reembolso_batimento (guardado inteiro em configuracoes)
/** Não volta mais que isso no Sienge, mesmo que haja reembolso antigo em aberto. */
const MAX_DIAS = 400;

function addDaysIso(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function outcomeUrl(start, end) {
  return `${SIENGE_BULK_BASE}/bulk-data/v1/outcome?startDate=${encodeURIComponent(start)}`
    + `&endDate=${encodeURIComponent(end)}`
    + `&selectionType=P&correctionIndexerId=0&correctionDate=${encodeURIComponent(end)}&withAuthorizations=false`;
}

async function buscar(start, end, depth) {
  const res = await fetch(outcomeUrl(start, end), { headers: { Authorization: SIENGE_AUTH, Accept: "application/json" } });
  if (res.status === 429 && depth < 5) {
    await new Promise((r) => setTimeout(r, 3000 * (depth + 1)));
    return buscar(start, end, depth + 1);
  }
  if (res.status === 507 && depth < 7 && start < end) {
    const s = new Date(start + "T12:00:00Z");
    const e = new Date(end + "T12:00:00Z");
    const mid = new Date(s.getTime() + Math.floor((e - s) / 2)).toISOString().slice(0, 10);
    const left = await buscar(start, mid, depth + 1);
    const right = await buscar(addDaysIso(mid, 1), end, depth + 1);
    return left.concat(right);
  }
  if (!res.ok) throw new Error(`Sienge ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  return (body && body.data) || [];
}

/** billId -> { pago, pagoEm } a partir das parcelas pagas no período. */
function situacaoPorTitulo(rows) {
  const porTitulo = new Map();
  (rows || []).forEach((row) => {
    const id = String(row && row.billId || "");
    if (!id) return;
    const atual = porTitulo.get(id) || { saldoAberto: false, pagoEm: "" };
    const saldo = Number(row.balanceAmount);
    if (!(Number.isFinite(saldo) && saldo <= 0.004)) atual.saldoAberto = true;
    (row.payments || []).forEach((p) => {
      const d = String(p && p.paymentDate || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > atual.pagoEm) atual.pagoEm = d;
    });
    porTitulo.set(id, atual);
  });
  const out = new Map();
  porTitulo.forEach((v, id) => out.set(id, { pago: !v.saldoAberto, pagoEm: v.pagoEm }));
  return out;
}

async function lerEstado() {
  const snap = await dados().DadosNucleo.lerConfig(ESTADO);
  return snap.exists() ? (snap.data() || {}) : {};
}

function gravarEstado(obj) {
  return dados().DadosNucleo.gravarConfig(ESTADO, obj);
}

async function runReembolsoBatimento(force) {
  const today = todayIsoSP();
  if (!force) {
    const p = await lerEstado();
    if (p.date === today && p.done) return { ok: true, skipped: true, date: today, pagos: Number(p.pagos) || 0 };
  }

  const { sb, DadosBase } = dados();
  // Só os títulos de reembolso gerados e ainda não pagos.
  const linhas = await DadosBase.lerTudo(() => sb.from(COL).select("id, bill_id, liberated_at, reem_pago")
    .not("bill_id", "is", null).or("reem_pago.is.null,reem_pago.eq.false").order("id"));
  const alvos = [];
  linhas.forEach((l) => {
    if (!l.bill_id || l.reem_pago === true) return;
    alvos.push({ id: l.id, billId: String(l.bill_id), desde: String(l.liberated_at || "").slice(0, 10) });
  });
  if (!alvos.length) {
    await gravarEstado({ date: today, done: true, at: new Date().toISOString(), conferidos: 0, pagos: 0 });
    return { ok: true, date: today, conferidos: 0, pagos: 0 };
  }

  const limite = addDaysIso(today, -MAX_DIAS);
  let inicio = today;
  alvos.forEach((a) => {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(a.desde) ? a.desde : limite;
    if (d < inicio) inicio = d;
  });
  if (inicio < limite) inicio = limite;
  inicio = addDaysIso(inicio, -1);

  const rows = await buscar(inicio, today, 0);
  const sit = situacaoPorTitulo(rows);
  const quando = new Date().toISOString();
  const pagos = alvos.filter((a) => sit.get(a.billId) && sit.get(a.billId).pago);
  for (const a of pagos) {
    checar(await sb.from(COL).update({
      reem_pago: true,
      pago_em: sit.get(a.billId).pagoEm || null,
      reem_conferido_em: quando
    }).eq("id", a.id));
  }

  const resumo = { date: today, done: true, at: quando, de: inicio, conferidos: alvos.length, pagos: pagos.length };
  await gravarEstado(resumo);
  return Object.assign({ ok: true }, resumo);
}

module.exports = { runReembolsoBatimento, situacaoPorTitulo };
