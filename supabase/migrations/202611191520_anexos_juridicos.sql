-- Anexos jurídicos por cliente (coleção anexos_juridicos; ficou fora do inventário porque o nome vinha de uma
-- propriedade, AnexosDB.collectionName em js/cobranca/anexos.js). Arquivo no Storage; aqui só os metadados.
create table public.anexos_juridicos (
  id                  text primary key,          -- id do doc no Firestore (firebaseDocId(customerId, fileId))
  customer_id         text not null,
  file_id             text not null,
  original_name       text,
  ext                 text,
  size                bigint,
  tags                text[] not null default '{}',
  date_override       text,
  target_customer_id  text,
  target_customer_ids text[] not null default '{}',
  storage_path        text,                      -- caminho no Storage (anexos_juridicos/<cliente>/<arquivo>)
  uploaded_at         timestamptz,
  extra               jsonb not null default '{}'::jsonb,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create index anexos_juridicos_customer_idx on public.anexos_juridicos (customer_id);
create trigger anexos_juridicos_atualizado_em before update on public.anexos_juridicos
  for each row execute function privado.tocar_atualizado_em();
alter table public.anexos_juridicos enable row level security;
create policy "anexos_juridicos: ativos leem" on public.anexos_juridicos
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "anexos_juridicos: ativos incluem" on public.anexos_juridicos
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "anexos_juridicos: ativos alteram" on public.anexos_juridicos
  for update to authenticated using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "anexos_juridicos: ativos excluem" on public.anexos_juridicos
  for delete to authenticated using ((select privado.usuario_ativo()));
revoke all on public.anexos_juridicos from anon;
