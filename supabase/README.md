# Banco do Integra no Supabase

Projeto Supabase: `integra` (org mouraleite, ref `ujtdtezymcyjnbqkelgp`, região us-east-2).

- `migrations/`: arquivos SQL numerados (`AAAAMMDDHHMM_descricao.sql`), aplicados em ordem.
  Toda mudança de tabela, função ou regra de acesso (RLS) entra aqui, nunca só pelo painel.
- Toda tabela nasce com RLS ligada. O navegador só acessa com o token emitido por `/api/supabase-token`
  (login Microsoft); servidor e crons usam a service role (`lib/supabase-admin.js`).

Plano completo: `docs/MIGRACAO_SUPABASE.md`.
