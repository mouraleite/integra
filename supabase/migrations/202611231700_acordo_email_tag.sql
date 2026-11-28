-- Marca da Central de e-mail (coleção acordo_email_tag, nova na v1.0.2197+): cliente/título que recebeu o e-mail da
-- régua "Reenviar jurídico". A fila troca a tag para "Acordo Judicial - Alterar p/ Sub judice Sienge".
-- Gravada pelo servidor (/api central-email-enviar, service role) e pela tela (central-email.js); a tela lê tudo.
create table public.acordo_email_tag (
  id            text primary key,                      -- <customerId>_<titulo>
  customer_id   text,
  titulo        text,
  tag           text,
  em            timestamptz,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create trigger acordo_email_tag_atualizado_em before update on public.acordo_email_tag
  for each row execute function privado.tocar_atualizado_em();
alter table public.acordo_email_tag enable row level security;
create policy "acordo_email_tag: ativos leem" on public.acordo_email_tag
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "acordo_email_tag: ativos incluem" on public.acordo_email_tag
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "acordo_email_tag: ativos alteram" on public.acordo_email_tag
  for update to authenticated using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
revoke all on public.acordo_email_tag from anon;
