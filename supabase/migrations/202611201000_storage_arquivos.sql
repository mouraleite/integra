-- Fase 4: arquivos (Firebase Storage -> Supabase Storage).
-- Um bucket PRIVADO "arquivos" com as mesmas pastas do Firebase (vistorias/, anexos_temp/, mapas/, kmz/, rydoo/...).
-- A chave do objeto é o caminho antigo com os caracteres que o Supabase não aceita trocados
-- (DadosBase.chaveStorage: sem acento; fora de [A-Za-z0-9_/!-.*'() &$@=;:+,] vira "_"). O banco continua guardando o
-- caminho original; a troca é feita na hora de ler/gravar.
-- Leitura no navegador: /arquivo?p=<caminho> (api/_lib/arquivo.js) confere o login e redireciona para um link assinado.
-- Gravação: usuário ativo do Integra (RLS abaixo). Cliente sem login (vistoria pública) só sobe por link de upload
-- assinado que a rota api/vistoria-publica gera para vistorias/<id>/.

insert into storage.buckets (id, name, public, file_size_limit)
values ('arquivos', 'arquivos', false, 104857600)  -- 100 MB por arquivo (o sienge-upload aceita até 80 MB)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists arquivos_ler on storage.objects;
drop policy if exists arquivos_criar on storage.objects;
drop policy if exists arquivos_alterar on storage.objects;
drop policy if exists arquivos_apagar on storage.objects;

create policy arquivos_ler on storage.objects for select to authenticated
  using (bucket_id = 'arquivos' and (select privado.usuario_ativo()));
create policy arquivos_criar on storage.objects for insert to authenticated
  with check (bucket_id = 'arquivos' and (select privado.usuario_ativo()));
create policy arquivos_alterar on storage.objects for update to authenticated
  using (bucket_id = 'arquivos' and (select privado.usuario_ativo()))
  with check (bucket_id = 'arquivos' and (select privado.usuario_ativo()));
create policy arquivos_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'arquivos' and (select privado.usuario_ativo()));

-- Troca, em todas as colunas text/jsonb das tabelas de public, os links antigos do Firebase Storage
-- (https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<caminho codificado>?alt=media&token=...) e do rewrite
-- /proxy-storage/<caminho codificado> pelo link novo /arquivo?p=<caminho codificado>.
-- Rodar depois da carga dos dados (ferramentas/migracao/copiar-storage.js --reescrever). Pode rodar de novo.
-- Devolve uma linha por coluna alterada.
create or replace function privado.reescrever_urls_storage()
returns table (tabela text, coluna text, linhas bigint)
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  n bigint;
  padrao constant text := 'https://firebasestorage\.googleapis\.com/v0/b/[^/"\s\\]+/o/([^?"\s\\]+)(\?[^"\s\\]*)?';
  padrao_proxy constant text := '/proxy-storage/([^?"\s\\]+)';
begin
  for c in
    select col.table_name::text as t, col.column_name::text as k, col.data_type::text as tipo
    from information_schema.columns col
    join information_schema.tables tb on tb.table_schema = col.table_schema and tb.table_name = col.table_name
    where col.table_schema = 'public' and tb.table_type = 'BASE TABLE'
      and col.data_type in ('text', 'jsonb')
  loop
    if c.tipo = 'jsonb' then
      execute format(
        'update public.%I set %I = regexp_replace(regexp_replace(%I::text, %L, %L, %L), %L, %L, %L)::jsonb
           where %I::text like %L or %I::text like %L',
        c.t, c.k, c.k, padrao, '/arquivo?p=\1', 'g', padrao_proxy, '/arquivo?p=\1', 'g',
        c.k, '%firebasestorage.googleapis.com%', c.k, '%/proxy-storage/%');
    else
      execute format(
        'update public.%I set %I = regexp_replace(regexp_replace(%I, %L, %L, %L), %L, %L, %L)
           where %I like %L or %I like %L',
        c.t, c.k, c.k, padrao, '/arquivo?p=\1', 'g', padrao_proxy, '/arquivo?p=\1', 'g',
        c.k, '%firebasestorage.googleapis.com%', c.k, '%/proxy-storage/%');
    end if;
    get diagnostics n = row_count;
    if n > 0 then
      tabela := c.t; coluna := c.k; linhas := n;
      return next;
    end if;
  end loop;
end $$;

revoke all on function privado.reescrever_urls_storage() from public, anon, authenticated;

-- Chamada pelo script (service role) via RPC.
create or replace function public.reescrever_urls_storage()
returns table (tabela text, coluna text, linhas bigint)
language sql security invoker set search_path = '' as $$
  select * from privado.reescrever_urls_storage();
$$;
revoke all on function public.reescrever_urls_storage() from public, anon, authenticated;
grant execute on function public.reescrever_urls_storage() to service_role;
grant execute on function privado.reescrever_urls_storage() to service_role;
