/**
 * Batimento diário das antecipações (07:00, disparado pelo morning-warmup).
 * O histórico (jan/2024 em diante) já está salvo no Supabase (antecipacoes_mes + antecipacoes_mes_eventos).
 * Todo dia relê no Sienge só os recebimentos dos últimos 7 dias (bulk-data /income por data de
 * pagamento) e regrava esses dias nos meses afetados. Baixa lançada com data retroativa dentro
 * da janela entra; o resto do histórico não muda e não é consultado de novo.
 * ?force=1 roda de novo no mesmo dia.
 */
const { dados } = require("./dados-servidor");
const { todayIsoSP } = require("./br-calendar");
const { montarEventos } = require("./antecipacoes-core");

const SIENGE_DOMAIN = "mouraleite";
// Usuário e senha da API do Sienge ficam nas variáveis da Vercel, nunca no código.
const SIENGE_USER = process.env.SIENGE_API_USER || "";
const SIENGE_PASS = process.env.SIENGE_API_PASSWORD || "";
const SIENGE_AUTH = "Basic " + Buffer.from(`${SIENGE_USER}:${SIENGE_PASS}`).toString("base64");
const SIENGE_BULK_BASE = `https://api.sienge.com.br/${SIENGE_DOMAIN}/public/api`;

const ESTADO = "antecipacoes_batimento"; // config/antecipacoes_batimento (guardado inteiro em configuracoes)
const JANELA_DIAS = 7;

function addDaysIso(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function buscarIncome(start, end, depth) {
  const url = `${SIENGE_BULK_BASE}/bulk-data/v1/income?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}&selectionType=P`;
  const res = await fetch(url, { headers: { Authorization: SIENGE_AUTH, Accept: "application/json" } });
  if (res.status === 429 && depth < 5) {
    await new Promise((r) => setTimeout(r, 3000 * (depth + 1)));
    return buscarIncome(start, end, depth + 1);
  }
  if ((res.status === 507 || res.status === 504) && depth < 6 && start < end) {
    const s = new Date(start + "T12:00:00Z");
    const e = new Date(end + "T12:00:00Z");
    const mid = new Date(s.getTime() + Math.floor((e - s) / 2)).toISOString().slice(0, 10);
    const left = await buscarIncome(start, mid, depth + 1);
    const right = await buscarIncome(addDaysIso(mid, 1), end, depth + 1);
    return left.concat(right);
  }
  if (!res.ok) throw new Error(`Sienge income ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  const j = text ? JSON.parse(text) : {};
  return Array.isArray(j.data) ? j.data : [];
}

async function runAntecipacoesBatimento(force) {
  const hoje = todayIsoSP();
  const D = dados();
  const snap = await D.DadosNucleo.lerConfig(ESTADO);
  if (!force && snap.exists() && (snap.data() || {}).ultimoDia === hoje) {
    return { ok: true, pulado: true, motivo: "já rodou hoje", dia: hoje };
  }
  const ini = addDaysIso(hoje, -JANELA_DIAS);
  const fim = hoje;
  const linhas = await buscarIncome(ini, fim, 0);
  const novos = montarEventos(linhas).filter((e) => e && e.data >= ini && e.data <= fim);
  // Numa transação só (RPC): apaga os eventos da janela e grava o que o Sienge devolveu agora para esses dias.
  // O resto do histórico não muda.
  const gravados = await D.DadosFinanceiro.substituirJanelaAntecipacoes(ini, fim, novos, "batimento-7h", D.sb);
  const porMes = {};
  novos.forEach((e) => { const m = e.data.slice(0, 7); porMes[m] = (porMes[m] || 0) + 1; });
  const resumo = [];
  for (let d = ini; d <= fim; d = addDaysIso(d, 1)) {
    const mes = d.slice(0, 7);
    if (!resumo.some((r) => r.mes === mes)) resumo.push({ mes, daJanela: porMes[mes] || 0 });
  }
  await D.DadosNucleo.gravarConfig(ESTADO, { ultimoDia: hoje, janela: `${ini}..${fim}`, linhas: linhas.length, rodouEm: new Date().toISOString() }, { merge: true });
  return { ok: true, dia: hoje, janela: `${ini}..${fim}`, linhas: linhas.length, gravados, meses: resumo };
}

module.exports = { runAntecipacoesBatimento };
