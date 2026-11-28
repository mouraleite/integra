-- Recarga do importador sem duplicar: uma linha por (relatorio, ordem).
drop index public.auditoria_login_linhas_relatorio_idx;
alter table public.auditoria_login_linhas add constraint auditoria_login_linhas_relatorio_ordem_key unique (relatorio_id, ordem);
