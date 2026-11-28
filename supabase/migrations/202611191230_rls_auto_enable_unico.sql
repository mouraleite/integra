-- O projeto ja tem o event trigger ensure_rls (public.rls_auto_enable) do proprio Supabase:
-- fica so ele. A funcao nao deve ser chamavel pela API.
drop event trigger ligar_rls_em_tabela_nova;
drop function privado.ligar_rls_em_tabela_nova();
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
