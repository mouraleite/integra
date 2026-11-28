-- Fase 2 · Área engenharia / vistoria / comercial / orçamento de empreendimento.
-- Mapa campo -> coluna, decisões e notas do importador: docs/mapa-tabelas/engenharia-comercial.md
--
-- Arquivos (Firebase Storage): as colunas *_path / *_paths e foto_* guardam o CAMINHO do objeto relativo ao
-- bucket do Firebase (ex.: 'vistorias/<vistoriaId>/frente_1790000000000.jpeg'), nunca a URL de download.
-- O primeiro segmento é a pasta de origem (vistorias/, construcoes/) e vira o bucket no Supabase.
--
-- Depende de 202611191200_usuarios_e_acesso.sql (schema privado, tocar_atualizado_em, usuario_ativo,
-- eh_admin, tem_permissao). Não recria nada de lá.

-- =====================================================================================================
-- Funções de apoio desta área (schema privado; prefixo engcom_ para não colidir com as outras áreas)
-- =====================================================================================================

-- Verdadeiro se o usuário ativo tem QUALQUER uma das chaves (administrador sempre pode).
-- Usado onde o Integra aceita mais de uma chave para a mesma tela (ex.: caução herda de "engenharia").
create or replace function privado.engcom_tem_alguma(variadic chaves text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select privado.eh_admin() or exists (select 1 from unnest(chaves) k where privado.tem_permissao(k));
$$;

-- Conversões tolerantes usadas pelas RPCs que recebem o JSON do front (texto ruim vira null, não erro).
create or replace function privado.engcom_data(t text)
returns date language plpgsql immutable set search_path = '' as $$
begin
  if t is null or btrim(t) = '' then return null; end if;
  if t ~ '^\d{4}-\d{2}-\d{2}' then return left(t, 10)::date; end if;
  if t ~ '^\d{2}/\d{2}/\d{4}$' then return to_date(t, 'DD/MM/YYYY'); end if;
  return null;
exception when others then return null;
end $$;

create or replace function privado.engcom_ts(t text)
returns timestamptz language plpgsql stable set search_path = '' as $$
begin
  if t is null or btrim(t) = '' then return null; end if;
  if t ~ '^\d{12,14}$' then return to_timestamp(t::numeric / 1000); end if;  -- epoch em ms
  return t::timestamptz;
exception when others then return null;
end $$;

create or replace function privado.engcom_num(t text)
returns numeric language plpgsql immutable set search_path = '' as $$
begin
  if t is null or btrim(t) = '' then return null; end if;
  return t::numeric;
exception when others then return null;
end $$;

create or replace function privado.engcom_bool(t text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when t is null then null
    when lower(btrim(t)) in ('true', '1', 's', 'sim', 'y', 'yes') then true
    when lower(btrim(t)) in ('false', '0', 'n', 'nao', 'não', 'no', '') then false
    else null end;
$$;

revoke all on function privado.engcom_tem_alguma(text[]) from public, anon;
revoke all on function privado.engcom_data(text) from public, anon;
revoke all on function privado.engcom_ts(text) from public, anon;
revoke all on function privado.engcom_num(text) from public, anon;
revoke all on function privado.engcom_bool(text) from public, anon;
grant execute on function privado.engcom_tem_alguma(text[]) to authenticated, service_role;
grant execute on function privado.engcom_data(text) to authenticated, service_role;
grant execute on function privado.engcom_ts(text) to authenticated, service_role;
grant execute on function privado.engcom_num(text) to authenticated, service_role;
grant execute on function privado.engcom_bool(text) to authenticated, service_role;

-- =====================================================================================================
-- VISTORIA
-- =====================================================================================================

-- vistorias: pedidos de vistoria de lote (ficha do cliente, link do WhatsApp, app do vistoriador).
create table public.vistorias (
  id                        text primary key default gen_random_uuid()::text,
  status                    text not null check (status in ('solicitada', 'aguardando_fotos', 'aguardando_validacao', 'concluida')),
  customer_id               text,
  contract_id               text,
  contract_keys             text[] not null default '{}',
  titulo                    text,
  titulo_key                text,
  cliente_name              text,
  cidade                    text,
  empreendimento            text,
  cost_center_id            text,
  unidade                   text,
  company_id                text,
  lote_coords               jsonb,                       -- {lat, lng} do KMZ
  foto_frente               text,                        -- caminho no Storage (vistorias/<id>/frente_<ts>.jpeg)
  foto_meio_fundo           text,                        -- caminho no Storage
  foto_fundo_frente         text,                        -- caminho no Storage
  respostas_formulario      jsonb,                       -- {possuiAgua, possuiEnergia, possuiEntulho, permiteAcesso, estagioObra, observacoes}
  enviado_em                timestamptz,
  link_enviado_em           timestamptz,
  closed_by                 text,
  closed_at                 timestamptz,
  requested_by              text,
  requested_by_email        text,
  requested_by_back_office  boolean,
  requested_at              timestamptz,
  origem                    text,
  app_responsavel_email     text,                        -- app.responsavelEmail (vistoriador)
  app_responsavel_nome      text,
  app_atribuido_em          timestamptz,
  app_atribuido_por         text,
  is_test                   boolean not null default false,
  extra                     jsonb not null default '{}'::jsonb,
  criado_em                 timestamptz not null default now(),
  atualizado_em             timestamptz not null default now()
);
create index vistorias_status_idx on public.vistorias (status);
create index vistorias_customer_id_idx on public.vistorias (customer_id);
create index vistorias_contract_id_idx on public.vistorias (contract_id);
create index vistorias_titulo_key_idx on public.vistorias (titulo_key);
create index vistorias_titulo_idx on public.vistorias (titulo);
create index vistorias_contract_keys_idx on public.vistorias using gin (contract_keys);
create index vistorias_app_responsavel_email_idx on public.vistorias (app_responsavel_email);
create trigger vistorias_atualizado_em before update on public.vistorias
  for each row execute function privado.tocar_atualizado_em();

-- vistoria_avisos: aviso ao solicitante (ficha) quando a vistoria pedida é validada.
create table public.vistoria_avisos (
  id                    text primary key default gen_random_uuid()::text,
  vistoria_id           text references public.vistorias (id) on delete cascade,
  email                 text not null check (email = lower(email)),
  nome                  text,
  cliente_name          text,
  unidade               text,
  empreendimento        text,
  cidade                text,
  titulo                text,
  respostas_formulario  jsonb not null default '{}'::jsonb,
  foto_frente           text,                            -- caminho no Storage
  foto_meio_fundo       text,
  foto_fundo_frente     text,
  visto                 boolean not null default false,
  visto_em              timestamptz,
  extra                 jsonb not null default '{}'::jsonb,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index vistoria_avisos_email_visto_idx on public.vistoria_avisos (email, visto);
create index vistoria_avisos_vistoria_id_idx on public.vistoria_avisos (vistoria_id);
create trigger vistoria_avisos_atualizado_em before update on public.vistoria_avisos
  for each row execute function privado.tocar_atualizado_em();

-- vistoria_batimento: fila de clientes para a tela Vistoria, gerada pelo cron do painel diário.
-- Cache regenerável: uma linha por dia (o _meta e os shards _p<i> do Firestore somem).
create table public.vistoria_batimento (
  id             text primary key check (id ~ '^\d{4}-\d{2}-\d{2}$'),   -- 'AAAA-MM-DD'
  date           date not null unique,
  clientes       jsonb not null default '[]'::jsonb,
  total          integer,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create trigger vistoria_batimento_atualizado_em before update on public.vistoria_batimento
  for each row execute function privado.tocar_atualizado_em();

-- construction_checks: registros de construção do lote (aba Construção da ficha / validação da vistoria).
create table public.construction_checks (
  id                 text primary key default gen_random_uuid()::text,
  customer_id        text,
  contract_id        text,
  contract_keys      text[] not null default '{}',
  titulo_key         text,
  company_id         text,
  cost_center_id     text,
  cidade             text,
  empreendimento     text,
  unidade            text,
  vistoria_id        text,                    -- id em public.vistorias (sem FK: há registros de vistorias apagadas)
  date               date,
  responsible        text,
  stage              text,
  observations       text,
  details_text       text,
  file_path          text,                    -- fileUrl  -> caminho no Storage
  file_name          text,
  file_paths         text[] not null default '{}',   -- fileUrls -> caminhos no Storage
  file_names         text[] not null default '{}',
  foto_frente        text,                    -- caminho no Storage
  foto_meio_fundo    text,
  foto_fundo_frente  text,
  send_to_sienge     boolean,
  sienge_sent        boolean,
  sienge_sent_paths  text[] not null default '{}',   -- siengeSentUrls -> caminhos no Storage
  sienge_error       text,
  extra              jsonb not null default '{}'::jsonb,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
create index construction_checks_customer_id_idx on public.construction_checks (customer_id);
create index construction_checks_contract_id_idx on public.construction_checks (contract_id);
create index construction_checks_contract_keys_idx on public.construction_checks using gin (contract_keys);
create index construction_checks_vistoria_id_idx on public.construction_checks (vistoria_id);
create index construction_checks_date_idx on public.construction_checks (date);
create trigger construction_checks_atualizado_em before update on public.construction_checks
  for each row execute function privado.tocar_atualizado_em();

-- =====================================================================================================
-- ENGENHARIA
-- =====================================================================================================

-- engenharia_acompanhamento: o doc "obras" (array linhas) vira uma linha por empreendimento (id = centro de custo).
create table public.engenharia_acompanhamento (
  id             text primary key,               -- centro de custo do empreendimento (linhas[].id)
  nome           text,
  infra          date,
  lazer          date,
  cliente        date,
  tvo_cliente    date,
  lo             date,
  tvo_contrato   date,
  inserido_em    timestamptz,
  historico      jsonb not null default '[]'::jsonb,   -- versões anteriores da linha do tempo (só exibidas)
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create trigger engenharia_acompanhamento_atualizado_em before update on public.engenharia_acompanhamento
  for each row execute function privado.tocar_atualizado_em();

-- caucao_base: base do dia da Gestão de caução (Sienge bulk-data) e base do "passado".
-- Cache regenerável: uma linha por base, com todas as linhas em jsonb (os shards <data>_<n>/_passado_<n> somem).
create table public.caucao_base (
  id             text primary key check (id ~ '^\d{4}-\d{2}-\d{2}$' or id = 'passado'),
  tipo           text not null check (tipo in ('dia', 'passado')),
  date           date,                  -- base do dia: data de geração
  start_date     date,                  -- passado: menor vencimento
  end_date       date,                  -- passado: último dia antes do corte
  corte          date,
  count          integer,
  gerado_em      timestamptz,
  rows           jsonb not null default '[]'::jsonb,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index caucao_base_tipo_date_idx on public.caucao_base (tipo, date);
create trigger caucao_base_atualizado_em before update on public.caucao_base
  for each row execute function privado.tocar_atualizado_em();

-- caucao_base_controle: o doc caucao_base/_meta (trava e resumo da rotina das 06:30). Linha única.
create table public.caucao_base_controle (
  id                text primary key default '_meta' check (id = '_meta'),
  date              date,
  count             integer,
  running           boolean not null default false,
  running_at        timestamptz,
  done              boolean not null default false,
  gerado_em         timestamptz,
  range_start_date  date,
  range_end_date    date,
  erro              text,
  erro_em           timestamptz,
  extra             jsonb not null default '{}'::jsonb,   -- prazo, planejadas, prorrogadas, adiadas, falhas, vencidasRetidas, leituraMs, totalMs
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create trigger caucao_base_controle_atualizado_em before update on public.caucao_base_controle
  for each row execute function privado.tocar_atualizado_em();

-- caucao_base_ajustes: o doc caucao_base/_ajustes (mapa "titulo|parcela" -> {vencimento, at}) vira uma linha por parcela.
create table public.caucao_base_ajustes (
  id             text primary key,               -- 'titulo|parcela' (chave do mapa)
  titulo         text not null,
  parcela        text not null,
  vencimento     date not null,
  ajustado_em    timestamptz not null,           -- campo "at"
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index caucao_base_ajustes_titulo_idx on public.caucao_base_ajustes (titulo);
create trigger caucao_base_ajustes_atualizado_em before update on public.caucao_base_ajustes
  for each row execute function privado.tocar_atualizado_em();

-- =====================================================================================================
-- COMERCIAL
-- =====================================================================================================

-- estoque_comercial: posição de estoque. Os docs cc_<cc>_<n> (array units, até 634 KB) viram UMA LINHA POR UNIDADE.
create table public.estoque_comercial (
  id                     text primary key,        -- units[].id (id da unidade no Sienge)
  enterprise_id          text not null,
  enterprise_name        text,
  name                   text,
  commercial_stock       text,
  legal_stock            text,
  building_stock         text,
  area                   numeric,
  contract_id            text,
  contract_number        text,
  contract_value         numeric(15,2),
  situation              text,
  customer_id            text,
  customer_name          text,
  customer_doc           text,
  receivable_bill_id     text,
  rel_fin                text,
  quitado                boolean,
  quitado_evidencia      boolean,
  quitacao_date          date,
  quitacao_valor         numeric(15,2),
  quitacao_recebido      numeric(15,2),
  quitacao_fonte         text,
  received_locked        boolean,
  statement_done         boolean,
  census_at              date,
  fin_at                 timestamptz,
  fila_at                timestamptz,
  extrato_at             timestamptz,
  sienge_conferido_em    timestamptz,
  kpi_a_vencer           numeric(15,2),
  kpi_vencidas           numeric(15,2),
  kpi_liquido            numeric(15,2),
  kpi_pago               numeric(15,2),
  kpi_acrescimo          numeric(15,2),
  kpi_desconto           numeric(15,2),
  present_debit_balance  numeric(15,2),
  received_amount        numeric(15,2),
  outstanding_balance    numeric(15,2),
  pmp3m                  numeric,
  open_parcelas          jsonb,
  carteira_ct            boolean,
  distrato_data          date,
  distrato_titulo        text,
  date                   date,                    -- "date" do doc cc_* em que a unidade foi gravada
  extra                  jsonb not null default '{}'::jsonb,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);
create index estoque_comercial_enterprise_id_idx on public.estoque_comercial (enterprise_id);
create index estoque_comercial_contract_id_idx on public.estoque_comercial (contract_id);
create index estoque_comercial_customer_id_idx on public.estoque_comercial (customer_id);
create index estoque_comercial_receivable_bill_id_idx on public.estoque_comercial (receivable_bill_id);
create trigger estoque_comercial_atualizado_em before update on public.estoque_comercial
  for each row execute function privado.tocar_atualizado_em();

-- estoque_comercial_controle: os docs _meta, _batimento_state e _conferencia_geral (estado do batimento).
create table public.estoque_comercial_controle (
  id             text primary key check (id in ('_meta', '_batimento_state', '_conferencia_geral')),
  dados          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create trigger estoque_comercial_controle_atualizado_em before update on public.estoque_comercial_controle
  for each row execute function privado.tocar_atualizado_em();

-- comercial_batimento: vendas/distratos por mês (36+ meses), gerado pelo cron do painel diário.
-- Cache regenerável: uma linha por mês; _meta e _state ficam como linhas com "dados". Shards _p<i>/_parts somem.
create table public.comercial_batimento (
  id             text primary key,
  ano            integer,
  mes            integer check (mes between 1 and 12),
  vendas         jsonb not null default '[]'::jsonb,
  distratos      jsonb not null default '[]'::jsonb,
  dados          jsonb not null default '{}'::jsonb,   -- só nas linhas _meta e _state
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  check ((id ~ '^\d{4}-\d{2}$' and ano is not null and mes is not null) or id in ('_meta', '_state'))
);
create index comercial_batimento_ano_mes_idx on public.comercial_batimento (ano, mes);
create trigger comercial_batimento_atualizado_em before update on public.comercial_batimento
  for each row execute function privado.tocar_atualizado_em();

-- tabelas_vigentes: tabela de preços/condições por empreendimento e competência.
create table public.tabelas_vigentes (
  id               text primary key default gen_random_uuid()::text,   -- 'tv_<base36>_<rand>' gerado no front
  enterprise_id    text not null,
  enterprise_name  text,
  city             text,
  city_id          text,
  competencia      text check (competencia ~ '^\d{4}-\d{2}$'),        -- 'AAAA-MM'
  rows             jsonb not null default '[]'::jsonb,                -- planos da tabela (editados/exibidos em bloco)
  extra            jsonb not null default '{}'::jsonb,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index tabelas_vigentes_enterprise_competencia_idx on public.tabelas_vigentes (enterprise_id, competencia);
create trigger tabelas_vigentes_atualizado_em before update on public.tabelas_vigentes
  for each row execute function privado.tocar_atualizado_em();

-- =====================================================================================================
-- ORÇAMENTO DE EMPREENDIMENTO
-- =====================================================================================================

-- orcamento_empreendimento: plano de vendas por centro de custo; id '_padrao' guarda os planos padrão.
create table public.orcamento_empreendimento (
  id             text primary key,               -- centro de custo ou '_padrao'
  cc_id          text,
  company_id     text,
  ano_de         integer,
  ano_ate        integer,
  distratos      jsonb not null default '{}'::jsonb,   -- {"AAAA": [12 quantidades]}
  vendas_qtd     jsonb not null default '{}'::jsonb,   -- {"AAAA": [12 quantidades]}
  planos         jsonb not null default '[]'::jsonb,
  condicoes      jsonb not null default '{}'::jsonb,
  em             timestamptz,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index orcamento_empreendimento_company_id_idx on public.orcamento_empreendimento (company_id);
create trigger orcamento_empreendimento_atualizado_em before update on public.orcamento_empreendimento
  for each row execute function privado.tocar_atualizado_em();

-- orcamento_receita: receita projetada por centro de custo (resultado calculado, lido em bloco).
create table public.orcamento_receita (
  id                text primary key,            -- centro de custo
  cc_id             text,
  company_id        text,
  ano_de            integer,
  ano_ate           integer,
  grade             jsonb not null default '{}'::jsonb,
  por_ano           jsonb not null default '{}'::jsonb,
  sub_mes           jsonb not null default '{}'::jsonb,
  juros_mes         jsonb not null default '{}'::jsonb,
  total             numeric(15,2),
  principal         numeric(15,2),
  reajuste          numeric(15,2),
  fora              numeric(15,2),
  antes             numeric(15,2),
  sub_judice        integer,
  sub_judice_valor  numeric(15,2),
  parcela_media     numeric(15,2),
  parcelas_media    numeric,
  indices           jsonb not null default '[]'::jsonb,
  clientes          jsonb not null default '[]'::jsonb,
  em                timestamptz,
  extra             jsonb not null default '{}'::jsonb,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index orcamento_receita_company_id_idx on public.orcamento_receita (company_id);
create trigger orcamento_receita_atualizado_em before update on public.orcamento_receita
  for each row execute function privado.tocar_atualizado_em();

-- orcamento_forecast: forecast por empresa (id 'emp_<companyId>'), versões em bloco.
create table public.orcamento_forecast (
  id             text primary key check (id ~ '^emp_'),
  company_id     text not null,
  atual          integer,
  versoes        jsonb not null default '{}'::jsonb,
  saved_at       timestamptz,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index orcamento_forecast_company_id_idx on public.orcamento_forecast (company_id);
create trigger orcamento_forecast_atualizado_em before update on public.orcamento_forecast
  for each row execute function privado.tocar_atualizado_em();

-- =====================================================================================================
-- SOLICITAÇÕES (tags e envio para produção)
-- =====================================================================================================

-- tag_solicitacoes: pedidos de TAG nova (anexos) aprovados/recusados pelo administrador ou back office.
create table public.tag_solicitacoes (
  id                    text primary key default gen_random_uuid()::text,
  tag_name              text not null,
  reason                text,
  type                  text,
  status                text not null default 'Pendente' check (status in ('Pendente', 'Aprovada', 'Recusada')),
  solicitado_por_email  text,
  solicitado_por_nome   text,
  parecidas             jsonb not null default '[]'::jsonb,
  motivo_decisao        text,
  decidido_por_email    text,
  decidido_por_nome     text,
  decidido_em           timestamptz,
  tag_criada            text,
  destino_final         text,
  aviso_visto           boolean not null default false,
  extra                 jsonb not null default '{}'::jsonb,
  criado_em             timestamptz not null default now(),   -- campo criado_em (ISO) da origem
  atualizado_em         timestamptz not null default now()
);
create index tag_solicitacoes_status_idx on public.tag_solicitacoes (status);
create index tag_solicitacoes_solicitado_por_email_idx on public.tag_solicitacoes (solicitado_por_email);
create trigger tag_solicitacoes_atualizado_em before update on public.tag_solicitacoes
  for each row execute function privado.tocar_atualizado_em();

-- solicitacoes_producao: pedidos "Encaminhar para produção" dos ambientes de teste.
create table public.solicitacoes_producao (
  id                     text primary key default gen_random_uuid()::text,
  ambiente               text,
  ambiente_nome          text,
  branch                 text,
  sha                    text,
  sha_main               text,
  versao_base            integer,
  descricao              text,
  como_testar            text,
  telas                  text[] not null default '{}',
  telas_nomes            text[] not null default '{}',
  abas                   jsonb not null default '[]'::jsonb,
  solicitante_email      text,                  -- solicitante.email
  solicitante_nome       text,                  -- solicitante.nome
  status                 text not null default 'pendente',
  aviso_visto            boolean not null default false,
  aviso_visto_em         timestamptz,
  sem_alteracoes_codigo  boolean,
  prints                 jsonb not null default '{}'::jsonb,
  arquivos               jsonb not null default '[]'::jsonb,
  commits                jsonb not null default '[]'::jsonb,
  totais                 jsonb not null default '{}'::jsonb,
  motivo                 text,
  decidido_por           text,
  decidido_por_email     text,
  decidido_em            timestamptz,
  versao                 text,
  publicado_em           timestamptz,
  testes                 jsonb,
  publicacoes_parciais   jsonb not null default '[]'::jsonb,
  extra                  jsonb not null default '{}'::jsonb,
  criado_em              timestamptz not null default now(),   -- criadoEm (epoch ms) da origem
  atualizado_em          timestamptz not null default now()
);
create index solicitacoes_producao_status_idx on public.solicitacoes_producao (status);
create index solicitacoes_producao_ambiente_idx on public.solicitacoes_producao (ambiente);
create index solicitacoes_producao_solicitante_email_idx on public.solicitacoes_producao (solicitante_email);
create trigger solicitacoes_producao_atualizado_em before update on public.solicitacoes_producao
  for each row execute function privado.tocar_atualizado_em();

-- =====================================================================================================
-- RLS
-- =====================================================================================================

alter table public.vistorias enable row level security;
alter table public.vistoria_avisos enable row level security;
alter table public.vistoria_batimento enable row level security;
alter table public.construction_checks enable row level security;
alter table public.engenharia_acompanhamento enable row level security;
alter table public.caucao_base enable row level security;
alter table public.caucao_base_controle enable row level security;
alter table public.caucao_base_ajustes enable row level security;
alter table public.estoque_comercial enable row level security;
alter table public.estoque_comercial_controle enable row level security;
alter table public.comercial_batimento enable row level security;
alter table public.tabelas_vigentes enable row level security;
alter table public.orcamento_empreendimento enable row level security;
alter table public.orcamento_receita enable row level security;
alter table public.orcamento_forecast enable row level security;
alter table public.tag_solicitacoes enable row level security;
alter table public.solicitacoes_producao enable row level security;

-- vistorias / construction_checks: usadas pela ficha de qualquer cliente (aba Construção, pedido de vistoria),
-- pela fila de cobrança, pela tela Vistoria e pelo app do vistoriador -> padrão (usuário ativo).
create policy "vistorias: ativos acessam" on public.vistorias
  for all to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));

create policy "construction_checks: ativos acessam" on public.construction_checks
  for all to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));

-- vistoria_avisos: dado pessoal do solicitante (dono = e-mail do JWT). Quem valida cria o aviso para outro usuário.
create policy "vistoria_avisos: dono le" on public.vistoria_avisos
  for select to authenticated
  using ((select privado.usuario_ativo())
         and (email = lower((select auth.jwt() ->> 'email')) or (select privado.eh_admin())));
create policy "vistoria_avisos: ativos criam" on public.vistoria_avisos
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "vistoria_avisos: dono marca visto" on public.vistoria_avisos
  for update to authenticated
  using ((select privado.usuario_ativo())
         and (email = lower((select auth.jwt() ->> 'email')) or (select privado.eh_admin())))
  with check ((select privado.usuario_ativo())
         and (email = lower((select auth.jwt() ->> 'email')) or (select privado.eh_admin())));
create policy "vistoria_avisos: admin apaga" on public.vistoria_avisos
  for delete to authenticated using ((select privado.eh_admin()));

-- vistoria_batimento / comercial_batimento: só o cron grava (service role). Telas só leem.
create policy "vistoria_batimento: ativos leem" on public.vistoria_batimento
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "comercial_batimento: ativos leem" on public.comercial_batimento
  for select to authenticated using ((select privado.usuario_ativo()));

-- engenharia_acompanhamento: leitura também em Relacionamento > Previsão de obras e no cancelamento.
create policy "engenharia_acompanhamento: ativos leem" on public.engenharia_acompanhamento
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "engenharia_acompanhamento: editar grava" on public.engenharia_acompanhamento
  for all to authenticated
  using ((select privado.tem_permissao('sub_eng_geral_acompanhamento_editar')))
  with check ((select privado.tem_permissao('sub_eng_geral_acompanhamento_editar')));

-- Caução: as chaves sub_eng_geral_caucao_* herdam de sub_eng_geral_engenharia_* (app.js:5598).
create policy "caucao_base: tela caucao acessa" on public.caucao_base
  for all to authenticated
  using ((select privado.engcom_tem_alguma(
    'sub_eng_geral_caucao_acessar', 'sub_eng_geral_caucao_visualizar', 'sub_eng_geral_caucao_editar',
    'sub_eng_geral_engenharia_acessar', 'sub_eng_geral_engenharia_visualizar', 'sub_eng_geral_engenharia_editar')))
  with check ((select privado.engcom_tem_alguma(
    'sub_eng_geral_caucao_acessar', 'sub_eng_geral_caucao_visualizar', 'sub_eng_geral_caucao_editar',
    'sub_eng_geral_engenharia_acessar', 'sub_eng_geral_engenharia_visualizar', 'sub_eng_geral_engenharia_editar')));

create policy "caucao_base_controle: tela caucao le" on public.caucao_base_controle
  for select to authenticated
  using ((select privado.engcom_tem_alguma(
    'sub_eng_geral_caucao_acessar', 'sub_eng_geral_caucao_visualizar', 'sub_eng_geral_caucao_editar',
    'sub_eng_geral_engenharia_acessar', 'sub_eng_geral_engenharia_visualizar', 'sub_eng_geral_engenharia_editar')));
-- (escrita do controle: só a rotina do servidor, via service role)

create policy "caucao_base_ajustes: tela caucao le" on public.caucao_base_ajustes
  for select to authenticated
  using ((select privado.engcom_tem_alguma(
    'sub_eng_geral_caucao_acessar', 'sub_eng_geral_caucao_visualizar', 'sub_eng_geral_caucao_editar',
    'sub_eng_geral_engenharia_acessar', 'sub_eng_geral_engenharia_visualizar', 'sub_eng_geral_engenharia_editar')));
create policy "caucao_base_ajustes: editar grava" on public.caucao_base_ajustes
  for insert to authenticated
  with check ((select privado.engcom_tem_alguma('sub_eng_geral_caucao_editar', 'sub_eng_geral_engenharia_editar')));
create policy "caucao_base_ajustes: editar altera" on public.caucao_base_ajustes
  for update to authenticated
  using ((select privado.engcom_tem_alguma('sub_eng_geral_caucao_editar', 'sub_eng_geral_engenharia_editar')))
  with check ((select privado.engcom_tem_alguma('sub_eng_geral_caucao_editar', 'sub_eng_geral_engenharia_editar')));
create policy "caucao_base_ajustes: editar apaga" on public.caucao_base_ajustes
  for delete to authenticated
  using ((select privado.engcom_tem_alguma('sub_eng_geral_caucao_editar', 'sub_eng_geral_engenharia_editar')));

-- Estoque: lido por Comercial, Caixa diário, Marketing e fila de cobrança (PMP); a tela grava o cache
-- automaticamente ao abrir -> padrão (revisar: ver mapa).
create policy "estoque_comercial: ativos acessam" on public.estoque_comercial
  for all to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "estoque_comercial_controle: ativos acessam" on public.estoque_comercial_controle
  for all to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));

-- Tabelas vigentes: lidas também pelo Orçamento; grava quem tem _editar.
create policy "tabelas_vigentes: ativos leem" on public.tabelas_vigentes
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "tabelas_vigentes: editar grava" on public.tabelas_vigentes
  for all to authenticated
  using ((select privado.tem_permissao('sub_com_geral_tabelas_vigentes_editar')))
  with check ((select privado.tem_permissao('sub_com_geral_tabelas_vigentes_editar')));

-- Orçamento: Novo orçamento (empreendimento + receita) e Novo forecast.
create policy "orcamento_empreendimento: tela le" on public.orcamento_empreendimento
  for select to authenticated
  using ((select privado.engcom_tem_alguma(
    'sub_orc_geral_novo_orcamento_acessar', 'sub_orc_geral_novo_orcamento_visualizar', 'sub_orc_geral_novo_orcamento_editar')));
create policy "orcamento_empreendimento: editar grava" on public.orcamento_empreendimento
  for all to authenticated
  using ((select privado.tem_permissao('sub_orc_geral_novo_orcamento_editar')))
  with check ((select privado.tem_permissao('sub_orc_geral_novo_orcamento_editar')));

create policy "orcamento_receita: tela le" on public.orcamento_receita
  for select to authenticated
  using ((select privado.engcom_tem_alguma(
    'sub_orc_geral_novo_orcamento_acessar', 'sub_orc_geral_novo_orcamento_visualizar', 'sub_orc_geral_novo_orcamento_editar')));
create policy "orcamento_receita: editar grava" on public.orcamento_receita
  for all to authenticated
  using ((select privado.tem_permissao('sub_orc_geral_novo_orcamento_editar')))
  with check ((select privado.tem_permissao('sub_orc_geral_novo_orcamento_editar')));

create policy "orcamento_forecast: tela le" on public.orcamento_forecast
  for select to authenticated
  using ((select privado.engcom_tem_alguma(
    'sub_orc_geral_novo_forecast_acessar', 'sub_orc_geral_novo_forecast_visualizar', 'sub_orc_geral_novo_forecast_editar')));
create policy "orcamento_forecast: editar grava" on public.orcamento_forecast
  for all to authenticated
  using ((select privado.tem_permissao('sub_orc_geral_novo_forecast_editar')))
  with check ((select privado.tem_permissao('sub_orc_geral_novo_forecast_editar')));

-- tag_solicitacoes: qualquer usuário pede e vê pendentes (evita pedido repetido); decide quem tem
-- sub_cfg_apoio_tags_editar (administrador e back office); o solicitante marca aviso_visto.
create policy "tag_solicitacoes: ativos leem" on public.tag_solicitacoes
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "tag_solicitacoes: ativos pedem" on public.tag_solicitacoes
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "tag_solicitacoes: decide ou solicitante" on public.tag_solicitacoes
  for update to authenticated
  using ((select privado.tem_permissao('sub_cfg_apoio_tags_editar'))
         or ((select privado.usuario_ativo()) and solicitado_por_email = lower((select auth.jwt() ->> 'email'))))
  with check ((select privado.tem_permissao('sub_cfg_apoio_tags_editar'))
         or ((select privado.usuario_ativo()) and solicitado_por_email = lower((select auth.jwt() ->> 'email'))));
create policy "tag_solicitacoes: admin apaga" on public.tag_solicitacoes
  for delete to authenticated using ((select privado.eh_admin()));

-- solicitacoes_producao: desenvolvedor pede (e atualiza o próprio pedido); administrador decide.
-- api/_lib/publicar.js lê com a service role.
create policy "solicitacoes_producao: ativos leem" on public.solicitacoes_producao
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "solicitacoes_producao: ativos pedem" on public.solicitacoes_producao
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "solicitacoes_producao: admin ou solicitante altera" on public.solicitacoes_producao
  for update to authenticated
  using ((select privado.eh_admin())
         or ((select privado.usuario_ativo()) and solicitante_email = lower((select auth.jwt() ->> 'email'))))
  with check ((select privado.eh_admin())
         or ((select privado.usuario_ativo()) and solicitante_email = lower((select auth.jwt() ->> 'email'))));
create policy "solicitacoes_producao: admin apaga" on public.solicitacoes_producao
  for delete to authenticated using ((select privado.eh_admin()));

-- Visitante sem token (anon) não acessa nada desta área.
revoke all on public.vistorias, public.vistoria_avisos, public.vistoria_batimento, public.construction_checks,
  public.engenharia_acompanhamento, public.caucao_base, public.caucao_base_controle, public.caucao_base_ajustes,
  public.estoque_comercial, public.estoque_comercial_controle, public.comercial_batimento, public.tabelas_vigentes,
  public.orcamento_empreendimento, public.orcamento_receita, public.orcamento_forecast,
  public.tag_solicitacoes, public.solicitacoes_producao
  from anon;

-- =====================================================================================================
-- Realtime (coleções com onSnapshot no código)
-- =====================================================================================================
alter publication supabase_realtime add table public.vistorias;
alter publication supabase_realtime add table public.vistoria_avisos;
alter publication supabase_realtime add table public.tag_solicitacoes;
alter publication supabase_realtime add table public.solicitacoes_producao;

-- =====================================================================================================
-- RPC
-- =====================================================================================================

-- Envio das fotos/respostas da vistoria (link do WhatsApp e app do vistoriador). Substitui o updateDoc de
-- js/engenharia/vistoria.js:585. Só aceita vistoria ainda aberta (não reabre vistoria concluída).
-- O link público (cliente sem login) deve chamar esta função por uma rota do servidor com a service role.
create or replace function public.enviar_vistoria(
  p_id text,
  p_respostas jsonb,
  p_foto_frente text,
  p_foto_meio_fundo text default null,
  p_foto_fundo_frente text default null
)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  n integer;
begin
  update public.vistorias
     set status = 'aguardando_validacao',
         respostas_formulario = coalesce(p_respostas, '{}'::jsonb),
         foto_frente = p_foto_frente,
         foto_meio_fundo = p_foto_meio_fundo,
         foto_fundo_frente = p_foto_fundo_frente,
         enviado_em = now()
   where id = p_id
     and status in ('solicitada', 'aguardando_fotos', 'aguardando_validacao');
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Trava da rotina da caução (lib/caucao-batimento.js:290, runTransaction em caucao_base/_meta).
-- Retorna {resultado: 'rodando' | 'feito' | 'ok', anterior: <linha de controle antes da trava>}.
create or replace function public.travar_caucao_batimento(
  p_hoje date,
  p_forcar boolean default false,
  p_simular boolean default false,
  p_trava interval default interval '4 minutes'
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  m public.caucao_base_controle;
  r text;
begin
  insert into public.caucao_base_controle (id) values ('_meta') on conflict (id) do nothing;
  select * into m from public.caucao_base_controle where id = '_meta' for update;
  if m.running and m.running_at is not null and m.running_at > now() - p_trava then
    r := 'rodando';
  elsif not p_forcar and not p_simular and m.date = p_hoje and m.done then
    r := 'feito';
  else
    if not p_simular then
      update public.caucao_base_controle set running = true, running_at = now() where id = '_meta';
    end if;
    r := 'ok';
  end if;
  return jsonb_build_object('resultado', r, 'anterior', to_jsonb(m));
end $$;

-- Grava (substitui) as unidades de UM empreendimento do estoque, no formato do front (units[] camelCase).
-- Substitui setDoc(cc_<cc>_<n>) + deleteDoc dos chunks sobrando (estoque-comercial.js:855,
-- api/_lib/estoque-batimento.js:472). Unidades do CC que não vieram na lista são apagadas.
create or replace function public.substituir_estoque_comercial_cc(p_enterprise_id text, p_unidades jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  n integer;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_enterprise_id is null or btrim(p_enterprise_id) = '' then
    raise exception 'p_enterprise_id obrigatório';
  end if;
  if p_unidades is null or jsonb_typeof(p_unidades) <> 'array' then
    raise exception 'p_unidades deve ser um array';
  end if;

  delete from public.estoque_comercial e
   where e.enterprise_id = p_enterprise_id
     and not exists (select 1 from jsonb_array_elements(p_unidades) u where u ->> 'id' = e.id);

  insert into public.estoque_comercial as t (
    id, enterprise_id, enterprise_name, name, commercial_stock, legal_stock, building_stock, area,
    contract_id, contract_number, contract_value, situation, customer_id, customer_name, customer_doc,
    receivable_bill_id, rel_fin, quitado, quitado_evidencia, quitacao_date, quitacao_valor, quitacao_recebido,
    quitacao_fonte, received_locked, statement_done, census_at, fin_at, fila_at, extrato_at, sienge_conferido_em,
    kpi_a_vencer, kpi_vencidas, kpi_liquido, kpi_pago, kpi_acrescimo, kpi_desconto,
    present_debit_balance, received_amount, outstanding_balance, pmp3m, open_parcelas, carteira_ct,
    distrato_data, distrato_titulo, date, extra
  )
  select
    u ->> 'id',
    coalesce(nullif(u ->> 'enterpriseId', ''), p_enterprise_id),
    u ->> 'enterpriseName',
    u ->> 'name',
    u ->> 'commercialStock',
    u ->> 'legalStock',
    u ->> 'buildingStock',
    privado.engcom_num(u ->> 'area'),
    u ->> 'contractId',
    u ->> 'contractNumber',
    privado.engcom_num(u ->> 'contractValue'),
    u ->> 'situation',
    u ->> 'customerId',
    u ->> 'customerName',
    u ->> 'customerDoc',
    u ->> 'receivableBillId',
    u ->> 'relFin',
    privado.engcom_bool(u ->> 'quitado'),
    privado.engcom_bool(u ->> 'quitadoEvidencia'),
    privado.engcom_data(u ->> 'quitacaoDate'),
    privado.engcom_num(u ->> 'quitacaoValor'),
    privado.engcom_num(u ->> 'quitacaoRecebido'),
    u ->> 'quitacaoFonte',
    privado.engcom_bool(u ->> 'receivedLocked'),
    privado.engcom_bool(u ->> 'statementDone'),
    privado.engcom_data(u ->> 'censusAt'),
    privado.engcom_ts(u ->> 'finAt'),
    privado.engcom_ts(u ->> 'filaAt'),
    privado.engcom_ts(u ->> 'extratoAt'),
    privado.engcom_ts(u ->> 'siengeConferidoEm'),
    privado.engcom_num(u ->> 'kpiAVencer'),
    privado.engcom_num(u ->> 'kpiVencidas'),
    privado.engcom_num(u ->> 'kpiLiquido'),
    privado.engcom_num(u ->> 'kpiPago'),
    privado.engcom_num(u ->> 'kpiAcrescimo'),
    privado.engcom_num(u ->> 'kpiDesconto'),
    privado.engcom_num(u ->> 'presentDebitBalance'),
    privado.engcom_num(u ->> 'receivedAmount'),
    privado.engcom_num(u ->> 'outstandingBalance'),
    privado.engcom_num(u ->> 'pmp3m'),
    u -> 'openParcelas',
    privado.engcom_bool(u ->> 'carteiraCt'),
    privado.engcom_data(u ->> 'distratoData'),
    u ->> 'distratoTitulo',
    hoje,
    u - array[
      'id', 'enterpriseId', 'enterpriseName', 'name', 'commercialStock', 'legalStock', 'buildingStock', 'area',
      'contractId', 'contractNumber', 'contractValue', 'situation', 'customerId', 'customerName', 'customerDoc',
      'receivableBillId', 'relFin', 'quitado', 'quitadoEvidencia', 'quitacaoDate', 'quitacaoValor',
      'quitacaoRecebido', 'quitacaoFonte', 'receivedLocked', 'statementDone', 'censusAt', 'finAt', 'filaAt',
      'extratoAt', 'siengeConferidoEm', 'kpiAVencer', 'kpiVencidas', 'kpiLiquido', 'kpiPago', 'kpiAcrescimo',
      'kpiDesconto', 'presentDebitBalance', 'receivedAmount', 'outstandingBalance', 'pmp3m', 'openParcelas',
      'carteiraCt', 'distratoData', 'distratoTitulo'
    ]
  from jsonb_array_elements(p_unidades) u
  where coalesce(u ->> 'id', '') <> ''
  on conflict (id) do update set
    enterprise_id = excluded.enterprise_id,
    enterprise_name = excluded.enterprise_name,
    name = excluded.name,
    commercial_stock = excluded.commercial_stock,
    legal_stock = excluded.legal_stock,
    building_stock = excluded.building_stock,
    area = excluded.area,
    contract_id = excluded.contract_id,
    contract_number = excluded.contract_number,
    contract_value = excluded.contract_value,
    situation = excluded.situation,
    customer_id = excluded.customer_id,
    customer_name = excluded.customer_name,
    customer_doc = excluded.customer_doc,
    receivable_bill_id = excluded.receivable_bill_id,
    rel_fin = excluded.rel_fin,
    quitado = excluded.quitado,
    quitado_evidencia = excluded.quitado_evidencia,
    quitacao_date = excluded.quitacao_date,
    quitacao_valor = excluded.quitacao_valor,
    quitacao_recebido = excluded.quitacao_recebido,
    quitacao_fonte = excluded.quitacao_fonte,
    received_locked = excluded.received_locked,
    statement_done = excluded.statement_done,
    census_at = excluded.census_at,
    fin_at = excluded.fin_at,
    fila_at = excluded.fila_at,
    extrato_at = excluded.extrato_at,
    sienge_conferido_em = excluded.sienge_conferido_em,
    kpi_a_vencer = excluded.kpi_a_vencer,
    kpi_vencidas = excluded.kpi_vencidas,
    kpi_liquido = excluded.kpi_liquido,
    kpi_pago = excluded.kpi_pago,
    kpi_acrescimo = excluded.kpi_acrescimo,
    kpi_desconto = excluded.kpi_desconto,
    present_debit_balance = excluded.present_debit_balance,
    received_amount = excluded.received_amount,
    outstanding_balance = excluded.outstanding_balance,
    pmp3m = excluded.pmp3m,
    open_parcelas = excluded.open_parcelas,
    carteira_ct = excluded.carteira_ct,
    distrato_data = excluded.distrato_data,
    distrato_titulo = excluded.distrato_titulo,
    date = excluded.date,
    extra = excluded.extra;

  get diagnostics n = row_count;
  return n;
end $$;

-- setDoc(..., {merge: true}) nos docs de controle do estoque (_meta, _batimento_state, _conferencia_geral).
-- p_substituir = true equivale ao setDoc sem merge.
create or replace function public.mesclar_estoque_comercial_controle(p_id text, p_patch jsonb, p_substituir boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  resultado jsonb;
begin
  insert into public.estoque_comercial_controle as c (id, dados)
  values (p_id, coalesce(p_patch, '{}'::jsonb))
  on conflict (id) do update
    set dados = case when p_substituir then excluded.dados else c.dados || excluded.dados end
  returning dados into resultado;
  return resultado;
end $$;

revoke all on function public.enviar_vistoria(text, jsonb, text, text, text) from public, anon;
revoke all on function public.travar_caucao_batimento(date, boolean, boolean, interval) from public, anon, authenticated;
revoke all on function public.substituir_estoque_comercial_cc(text, jsonb) from public, anon;
revoke all on function public.mesclar_estoque_comercial_controle(text, jsonb, boolean) from public, anon;

grant execute on function public.enviar_vistoria(text, jsonb, text, text, text) to authenticated, service_role;
grant execute on function public.travar_caucao_batimento(date, boolean, boolean, interval) to service_role;
grant execute on function public.substituir_estoque_comercial_cc(text, jsonb) to authenticated, service_role;
grant execute on function public.mesclar_estoque_comercial_controle(text, jsonb, boolean) to authenticated, service_role;
