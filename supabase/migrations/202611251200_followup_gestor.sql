-- Follow-up do gestor (coleção followup_gestor, nova na v1.0.2217+): o administrador pede ao operador uma atualização
-- detalhada do caso; o operador vê o pop-up e responde. A tela grava e lê (js/cobranca/followup-gestor.js).
-- "criadoEm" do pedido vai para pedido_em (criado_em é a coluna de controle de todas as tabelas).
create table public.followup_gestor (
  id               text primary key,
  customer_id      text,
  sale_id          text,
  titulo           text,
  cliente          text,
  unidade          text,
  empreendimento   text,
  operador         text,
  pedido_por       text,
  pedido_por_email text,
  mensagem         text,
  status           text not null default 'aguardando',   -- aguardando / respondido
  pedido_em        timestamptz,
  visto_em         timestamptz,
  resposta         text,
  respondido_em    timestamptz,
  respondido_por   text,
  nota_id          text,
  extra            jsonb not null default '{}'::jsonb,    -- resumo do contrato e a nota das ocorrências
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index followup_gestor_status on public.followup_gestor (status);
create trigger followup_gestor_atualizado_em before update on public.followup_gestor
  for each row execute function privado.tocar_atualizado_em();
alter table public.followup_gestor enable row level security;
create policy "followup_gestor: ativos leem" on public.followup_gestor
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "followup_gestor: ativos incluem" on public.followup_gestor
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "followup_gestor: ativos alteram" on public.followup_gestor
  for update to authenticated using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
revoke all on public.followup_gestor from anon;
alter publication supabase_realtime add table public.followup_gestor;
