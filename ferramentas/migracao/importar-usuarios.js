// Leva usuários e perfis do export do Firestore (config.ndjson) para public.perfis e public.usuarios.
// Origem: config/crm_users (list) e config/global (crm_moura_profiles + crm_perms_<id>).
// Uso:
//   node ferramentas/migracao/importar-usuarios.js --export <pasta-do-export>
//        grava direto no Supabase (precisa de SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente)
//   node ferramentas/migracao/importar-usuarios.js --export <pasta> --sql <arquivo.sql> [--sem-permissoes] [--sem-pessoais]
//        só gera o SQL (upsert), para rodar no SQL Editor do Supabase
// Pode rodar quantas vezes quiser: atualiza pelo id antigo (id_legado) / nome do perfil.
const fs = require("fs");
const path = require("path");

function arg(nome) {
  const i = process.argv.indexOf("--" + nome);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

function json(v, padrao) {
  if (v == null || v === "") return padrao;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch (e) { return padrao; }
}

const minusculo = (s) => String(s || "").trim().toLowerCase() || null;
const nomePerfil = (s) => String(s || "").trim().toUpperCase();

function montar(pasta, opcoes) {
  const linhas = fs.readFileSync(path.join(pasta, "config.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const doc = (id) => (linhas.find((d) => d.id === id) || {}).data || {};
  const global = doc("global");
  const lista = json(doc("crm_users").list, []);

  const perfis = new Map();
  json(global.crm_moura_profiles, []).forEach((p) => {
    const nome = nomePerfil(p && p.name);
    if (!nome) return;
    const permissoes = opcoes.semPermissoes ? {} : (json(p.perms, null) || json(global["crm_perms_" + p.id], {}) || {});
    perfis.set(nome, { nome, id_legado: p.id || null, permissoes });
  });

  const PRINCIPAIS = ["id", "name", "email", "login_email", "sienge_user", "phone", "profile_name", "status", "manager_email"];
  const usuarios = lista.filter((u) => u && u.email).map((u) => {
    const perfil = nomePerfil(u.profile_name) || "SEM PERFIL";
    if (!perfis.has(perfil)) perfis.set(perfil, { nome: perfil, id_legado: null, permissoes: {} });
    const extra = {};
    if (!opcoes.semPessoais) Object.keys(u).forEach((k) => { if (PRINCIPAIS.indexOf(k) < 0) extra[k] = u[k]; });
    return {
      id_legado: String(u.id),
      nome: String(u.name || u.email).trim(),
      email: minusculo(u.email),
      login_email: minusculo(u.login_email),
      sienge_user: u.sienge_user || null,
      telefone: opcoes.semPessoais ? null : (u.phone || null),
      perfil,
      status: String(u.status || "ATIVO").toUpperCase().indexOf("INATIVO") >= 0 ? "INATIVO" : "ATIVO",
      gestor_email: minusculo(u.manager_email),
      extra
    };
  });
  return { perfis: Array.from(perfis.values()), usuarios };
}

function lit(v) {
  if (v == null) return "null";
  if (typeof v === "object") return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function gerarSql({ perfis, usuarios }, opcoes) {
  const out = ["begin;"];
  perfis.forEach((p) => {
    out.push("insert into public.perfis (nome, id_legado, permissoes) values (" + [p.nome, p.id_legado, p.permissoes].map(lit).join(", ") + ")"
      + " on conflict (nome) do update set id_legado = excluded.id_legado"
      + (opcoes.semPermissoes ? "" : ", permissoes = excluded.permissoes") + ";");
  });
  const cols = ["id_legado", "nome", "email", "login_email", "sienge_user", "telefone", "perfil", "status", "gestor_email", "extra"];
  const manter = opcoes.semPessoais ? ["telefone", "extra"] : [];
  usuarios.forEach((u) => {
    out.push("insert into public.usuarios (" + cols.join(", ") + ") values (" + cols.map((c) => lit(u[c])).join(", ") + ")"
      + " on conflict (id_legado) do update set "
      + cols.filter((c) => c !== "id_legado" && manter.indexOf(c) < 0).map((c) => c + " = excluded." + c).join(", ") + ";");
  });
  out.push("commit;");
  return out.join("\n") + "\n";
}

async function gravar({ perfis, usuarios }) {
  const { supabaseAdmin } = require("../../lib/supabase-admin");
  const sb = supabaseAdmin();
  let r = await sb.from("perfis").upsert(perfis, { onConflict: "nome" });
  if (r.error) throw r.error;
  r = await sb.from("usuarios").upsert(usuarios, { onConflict: "id_legado" });
  if (r.error) throw r.error;
}

(async () => {
  const pasta = arg("export");
  if (!pasta || pasta === true) {
    console.error("Informe --export <pasta do export do Firestore>.");
    process.exit(1);
  }
  const opcoes = { semPermissoes: !!arg("sem-permissoes"), semPessoais: !!arg("sem-pessoais") };
  const dados = montar(path.resolve(pasta), opcoes);
  const sql = arg("sql");
  if (sql && sql !== true) {
    fs.writeFileSync(sql, gerarSql(dados, opcoes));
    console.log("SQL gravado em " + sql + ".");
  } else {
    await gravar(dados);
    console.log("Gravado no Supabase.");
  }
  console.log(dados.perfis.length + " perfis, " + dados.usuarios.length + " usuários.");
})().catch((e) => {
  console.error("Falhou: " + (e && e.message ? e.message : e));
  process.exit(1);
});
