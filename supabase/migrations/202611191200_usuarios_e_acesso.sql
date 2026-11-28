-- Fase 1: usuários, perfis e funções usadas pelas regras de acesso (RLS).
-- O login é pela Microsoft; /api/supabase-token emite um JWT com sub = usuarios.id.
-- Funções de apoio ficam no schema "privado", que a API (PostgREST) não expõe.

create schema if not exists privado;
revoke all on schema privado from public, anon;
grant usage on schema privado to authenticated, service_role;

-- Atualiza a coluna atualizado_em em qualquer tabela que a tenha.
create or replace function privado.tocar_atualizado_em()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- Perfis de acesso (hoje: profile_name dos usuários + config/back_office_perms).
-- permissoes: as chaves de tela/ação do Integra (mod_fin, sub_fin_cr_..._editar etc.) => true/false.
create table public.perfis (
  nome          text primary key,
  permissoes    jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

-- Usuários (hoje: JSON em config/crm_users). Campos raros ficam em extra.
create table public.usuarios (
  id            uuid primary key default gen_random_uuid(),
  id_legado     text unique,
  nome          text not null,
  email         text not null unique check (email = lower(email)),
  login_email   text unique check (login_email = lower(login_email)),
  sienge_user   text,
  telefone      text,
  perfil        text not null references public.perfis(nome) on update cascade,
  status        text not null default 'ATIVO' check (status in ('ATIVO', 'INATIVO')),
  gestor_email  text,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index usuarios_perfil_idx on public.usuarios (perfil);

create trigger perfis_atualizado_em before update on public.perfis
  for each row execute function privado.tocar_atualizado_em();
create trigger usuarios_atualizado_em before update on public.usuarios
  for each row execute function privado.tocar_atualizado_em();

-- Funções de acesso. security definer para poderem ler usuarios/perfis sem cair na própria RLS.
create or replace function privado.usuario_ativo()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.usuarios u
    where u.id = (select auth.uid()) and u.status = 'ATIVO'
  );
$$;

create or replace function privado.perfil_atual()
returns text language sql stable security definer set search_path = '' as $$
  select u.perfil from public.usuarios u
  where u.id = (select auth.uid()) and u.status = 'ATIVO';
$$;

create or replace function privado.eh_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(privado.perfil_atual() = 'ADMINISTRADOR', false);
$$;

-- tem_permissao('sub_fin_cr_fila_cobranca_editar'): administrador sempre pode.
create or replace function privado.tem_permissao(chave text)
returns boolean language sql stable security definer set search_path = '' as $$
  select privado.eh_admin() or coalesce((
    select (p.permissoes ->> chave)::boolean
    from public.perfis p
    where p.nome = privado.perfil_atual()
  ), false);
$$;

revoke all on all functions in schema privado from public, anon;
grant execute on all functions in schema privado to authenticated, service_role;

-- RLS: todo usuário ativo lê; só administrador grava.
alter table public.perfis enable row level security;
alter table public.usuarios enable row level security;

create policy "perfis: ativos leem" on public.perfis
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "perfis: admin grava" on public.perfis
  for all to authenticated
  using ((select privado.eh_admin())) with check ((select privado.eh_admin()));

create policy "usuarios: ativos leem" on public.usuarios
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "usuarios: admin grava" on public.usuarios
  for all to authenticated
  using ((select privado.eh_admin())) with check ((select privado.eh_admin()));

-- Visitante sem token (anon) não tem acesso a nada em public.
revoke all on public.perfis, public.usuarios from anon;

-- Rede de segurança: toda tabela nova em public nasce com RLS ligada (sem política = ninguém acessa).
create or replace function privado.ligar_rls_em_tabela_nova()
returns event_trigger language plpgsql set search_path = '' as $$
declare r record;
begin
  for r in select * from pg_event_trigger_ddl_commands()
           where command_tag = 'CREATE TABLE' and schema_name = 'public'
  loop
    execute format('alter table %s enable row level security', r.object_identity);
  end loop;
end $$;

create event trigger ligar_rls_em_tabela_nova on ddl_command_end
  when tag in ('CREATE TABLE') execute function privado.ligar_rls_em_tabela_nova();
