/**
 * Batimento diário das antecipações (07:00, disparado pelo morning-warmup).
 * O histórico (jan/2024 em diante) já está salvo em antecipacoes_mes/{AAAA-MM} (+ partes __pN).
 * Todo dia relê no Sienge só os recebimentos dos últimos 7 dias (bulk-data /income por data de
 * pagamento) e regrava esses dias nos meses afetados. Baixa lançada com data retroativa dentro
 * da janela entra; o resto do histórico não muda e não é consultado de novo.
 * ?force=1 roda de novo no mesmo dia.
 */
const { initializeApp, getApps } = require("firebase/app");
const { getFirestore, doc, setDoc, getDoc, deleteDoc } = require("firebase/firestore");
const { todayIsoSP } = require("./br-calendar");
const { montarEventos, partesDoMes } = require("./antecipacoes-core");

const SIENGE_DOMAIN = "mouraleite";
// Usuário e senha da API do Sienge ficam nas variáveis da Vercel, nunca no código.
const SIENGE_USER = process.env.SIENGE_API_USER || "";
const SIENGE_PASS = process.env.SIENGE_API_PASSWORD || "";
const SIENGE_AUTH = "Basic " + Buffer.from(`${SIENGE_USER}:${SIENGE_PASS}`).toString("base64");
const SIENGE_BULK_BASE = `https://api.sienge.com.br/${SIENGE_DOMAIN}/public/api`;

const firebaseConfig = {
  apiKey: "AIzaSyBlBCaXn4y3sJDENW0GXw3ck_D2h3qknHc",
  authDomain: "crm-gestao-mldu.firebaseapp.com",
  projectId: "crm-gestao-mldu",
  storageBucket: "crm-gestao-mldu.firebasestorage.app",
  messagingSenderId: "1040392341069",
  appId: "1:1040392341069:web:6acf1beb34af663cfffe04"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

const COL = "antecipacoes_mes";
const ESTADO = ["config", "antecipacoes_batimento"];
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

async function lerMes(mes) {
  const meta = await getDoc(doc(db, COL, mes));
  if (!meta.exists()) return { eventos: [], partes: 0 };
  const n = Number((meta.data() || {}).partes) || 0;
  let texto = "";
  for (let i = 0; i < n; i++) {
    const p = await getDoc(doc(db, COL, `${mes}__p${i}`));
    if (p.exists()) texto += String((p.data() || {}).texto || "");
  }
  let eventos = [];
  try { eventos = JSON.parse(texto || "[]"); } catch (e) { throw new Error(`Mês ${mes} ilegível no Firebase; não foi regravado.`); }
  return { eventos: Array.isArray(eventos) ? eventos : [], partes: n };
}

async function gravarMes(mes, eventos, partesAntes) {
  const partes = partesDoMes(eventos);
  for (let i = 0; i < partes.length; i++) {
    await setDoc(doc(db, COL, `${mes}__p${i}`), { mes, parte: i, texto: partes[i] });
  }
  await setDoc(doc(db, COL, mes), {
    mes,
    partes: partes.length,
    eventos: eventos.length,
    atualizadoEm: new Date().toISOString(),
    fonte: "batimento-7h"
  });
  for (let i = partes.length; i < partesAntes; i++) {
    try { await deleteDoc(doc(db, COL, `${mes}__p${i}`)); } catch (e) {}
  }
}

async function runAntecipacoesBatimento(force) {
  const hoje = todayIsoSP();
  const estadoRef = doc(db, ESTADO[0], ESTADO[1]);
  const estado = await getDoc(estadoRef);
  if (!force && estado.exists() && (estado.data() || {}).ultimoDia === hoje) {
    return { ok: true, pulado: true, motivo: "já rodou hoje", dia: hoje };
  }
  const ini = addDaysIso(hoje, -JANELA_DIAS);
  const fim = hoje;
  const linhas = await buscarIncome(ini, fim, 0);
  const novos = montarEventos(linhas);
  const meses = new Set();
  for (let d = ini; d <= fim; d = addDaysIso(d, 1)) meses.add(d.slice(0, 7));
  const resumo = [];
  for (const mes of meses) {
    const atual = await lerMes(mes);
    // Tira do mês o que estava na janela e põe o que o Sienge devolveu agora para esses dias.
    const fora = atual.eventos.filter((e) => !(e && e.data >= ini && e.data <= fim));
    const dentro = novos.filter((e) => e.data.slice(0, 7) === mes);
    const lista = fora.concat(dentro).sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.tit).localeCompare(String(b.tit)));
    await gravarMes(mes, lista, atual.partes);
    resumo.push({ mes, eventos: lista.length, daJanela: dentro.length });
  }
  await setDoc(estadoRef, { ultimoDia: hoje, janela: `${ini}..${fim}`, linhas: linhas.length, rodouEm: new Date().toISOString() }, { merge: true });
  return { ok: true, dia: hoje, janela: `${ini}..${fim}`, linhas: linhas.length, meses: resumo };
}

module.exports = { runAntecipacoesBatimento };
