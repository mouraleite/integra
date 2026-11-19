-- Fase 2 — área NÚCLEO / SISTEMA / CONFIGURAÇÃO.
-- Mapa completo (campo -> coluna, decisões, notas do importador): docs/mapa-tabelas/nucleo.md
--
-- Origem: config/* (menos crm_users e back_office_perms, já em usuarios/perfis), settings, tags,
-- anexos_tag_memory, anexos_mapa, auditoria_logs, auditoria_login_partes/relatorios, usuarios_online,
-- api_consumo, ambientes_dev, alertas_ciente, suporte_chamados, documentos_autenticados,
-- agenda_personal_notes, agenda_recurring_notes, central_email_envios, config_stages,
-- sienge_sync_state e kmz_coordinates.
--
-- Depende de 202611191200_usuarios_e_acesso.sql (schema privado, tocar_atualizado_em, usuario_ativo,
-- eh_admin, tem_permissao, public.usuarios). RLS já nasce ligada (event trigger do Supabase); o
-- "enable row level security" abaixo é só para deixar explícito.

-- =====================================================================================
-- 1. CONFIGURAÇÕES (catch-all): chaves de config/global, demais docs de config/*, settings/*
--    e config_stages/*. Uma linha por chave; valor = JSON já interpretado (não mais string).
-- =====================================================================================
create table public.configuracoes (
  chave          text primary key,          -- ex.: 'crm_moura_rules', 'config/escala_home_office', 'settings/docpadrao_carta'
  valor          jsonb not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text                        -- e-mail de quem gravou (RPCs preenchem pelo JWT)
);
create trigger configuracoes_atualizado_em before update on public.configuracoes
  for each row execute function privado.tocar_atualizado_em();

-- =====================================================================================
-- 2. CADASTROS QUE SAÍRAM DE config/global e config/<doc>
-- =====================================================================================

-- Parametrização própria do centro de custo (config/centros_custo.byId == global.crm_centros_custo_custom).
-- O cadastro-base (nome, empresa) continua vindo do Sienge; aqui ficam só os campos do Integra.
create table public.centros_custo (
  id                          text primary key,        -- cc_id
  tipo_cc                     text,
  perc_ml                     numeric,
  perc_terrenista             numeric,
  imposto_pago_empresa        boolean,
  valor_vgv                   numeric(15,2),
  clausula_suspensiva_ativa   boolean,
  clausula_suspensiva_dias    integer,
  incorporacao_lotes_proprios boolean,
  incorporacao_lotes_tipo     text,
  incorporacao_lotes_excecao  jsonb not null default '[]'::jsonb,  -- [{id, name}] de unidades
  registro_imovel             text,
  indexador_padrao            text,
  associacao_nome             text,
  conta_parceria              jsonb,                   -- {banco, agencia, numero, id, nome}
  conta_parceria_at           timestamptz,
  updated_at                  timestamptz,             -- carimbo usado pelo merge do front (updatedAt)
  extra                       jsonb not null default '{}'::jsonb,
  criado_em                   timestamptz not null default now(),
  atualizado_em               timestamptz not null default now()
);
create trigger centros_custo_atualizado_em before update on public.centros_custo
  for each row execute function privado.tocar_atualizado_em();

-- Parametrização própria das empresas do Sienge (global.crm_empresas_custom).
create table public.empresas (
  id                             text primary key,     -- company_id como texto (chave do mapa)
  company_id                     integer not null,
  nome_usual                     text,
  percentual_mldu                numeric,
  percentual_mldu_edited         boolean,
  percentual_liquido_mldu        numeric,
  percentual_liquido_mldu_edited boolean,
  consolidacao_padrao            boolean,
  gerida_pelo_grupo              boolean,
  cobranca_interna               boolean,
  nova_empresa                   boolean,
  gestao_elenco                  boolean,
  spe_socios                     boolean,
  holding_interna                boolean,
  updated_at                     timestamptz,
  extra                          jsonb not null default '{}'::jsonb,
  criado_em                      timestamptz not null default now(),
  atualizado_em                  timestamptz not null default now()
);
create unique index empresas_company_id_idx on public.empresas (company_id);
create trigger empresas_atualizado_em before update on public.empresas
  for each row execute function privado.tocar_atualizado_em();

-- Regras por condição de pagamento do Sienge (config/condicoes_pagamento.byId).
create table public.condicoes_pagamento (
  id               text primary key,                   -- código da condição (E1, SA, P2...)
  boleto_sienge    boolean not null default false,
  parcela_webro    boolean not null default false,
  repasse_advogado boolean not null default false,
  updated_at       timestamptz,
  extra            jsonb not null default '{}'::jsonb,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create trigger condicoes_pagamento_atualizado_em before update on public.condicoes_pagamento
  for each row execute function privado.tocar_atualizado_em();

-- Catálogo de motivos de cancelamento (global.crm_cancelamento_motivos.catalogo).
create table public.motivos_cancelamento (
  id            text primary key,                      -- codigo ("01", "02"...)
  nome          text not null,
  ordem         integer,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create trigger motivos_cancelamento_atualizado_em before update on public.motivos_cancelamento
  for each row execute function privado.tocar_atualizado_em();

-- Preâmbulos dos documentos (global.crm_moura_preambles_list). Excluídos ficam como lápide (excluido).
create table public.preambulos (
  id                text primary key,                  -- id numérico do item, como texto
  texto             text,
  responsaveis      text,
  status            text,
  empresa_id        text,
  centros_custo_ids text[] not null default '{}',
  excluido          boolean not null default false,
  updated_at        timestamptz,
  extra             jsonb not null default '{}'::jsonb,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create trigger preambulos_atualizado_em before update on public.preambulos
  for each row execute function privado.tocar_atualizado_em();

-- Cartórios (global.crm_moura_cartorios_list). Na origem não há id: a chave é o nome.
create table public.cartorios (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null unique,
  excluido      boolean not null default false,
  ordem         integer,
  updated_at    timestamptz,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create trigger cartorios_atualizado_em before update on public.cartorios
  for each row execute function privado.tocar_atualizado_em();

-- Fluxos de processo do jurídico (config/fluxos_processo.fluxos[]). Área dona: cobrança/jurídico.
create table public.fluxos_processo (
  id                 text primary key,
  nome               text not null,
  nome_em            timestamptz,
  oficial            boolean not null default false,
  responsavel_nome   text,
  responsavel_email  text,
  responsavel_sienge text,
  supervisor_nome    text,
  supervisor_email   text,
  etapas             jsonb not null default '[]'::jsonb,  -- árvore de etapas (id, parentId, order, dias...)
  created_at         timestamptz,
  updated_at         timestamptz,
  extra              jsonb not null default '{}'::jsonb,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
create trigger fluxos_processo_atualizado_em before update on public.fluxos_processo
  for each row execute function privado.tocar_atualizado_em();

-- Templates da Central de e-mail (config/central_email.templates[]).
create table public.central_email_templates (
  id               text primary key,                   -- "cem_..."
  nome             text not null,
  assunto          text,
  corpo            text,
  tag              numeric,                            -- id numérico da etapa da régua (ex.: 8.5)
  dias_vencido     integer not null default 0,
  destino          text not null default 'contrato' check (destino in ('fixo', 'contrato')),
  para             text,
  cc               text,
  status           text not null default 'pendente' check (status in ('pendente', 'aprovado')),
  ativo            boolean not null default false,
  criado_por_email text,
  criado_por_nome  text,
  aprovado_em      timestamptz,
  aviso_criador    boolean not null default false,
  extra            jsonb not null default '{}'::jsonb,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create trigger central_email_templates_atualizado_em before update on public.central_email_templates
  for each row execute function privado.tocar_atualizado_em();

-- Envios da Central de e-mail (central_email_envios). Gravado só pelo servidor (/api central-email-enviar).
create table public.central_email_envios (
  id            text primary key,                      -- <dia>_<templateId>_<customerId>_<titulo>
  dia           date not null,
  template_id   text,
  customer_id   text,
  titulo        text,
  status        text,                                  -- enviado | erro
  em            timestamptz,
  para          text,
  cc            text,
  extrato       boolean,
  erro          text,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index central_email_envios_dia_idx on public.central_email_envios (dia);
create trigger central_email_envios_atualizado_em before update on public.central_email_envios
  for each row execute function privado.tocar_atualizado_em();

-- Cache compartilhado de VGV por obra (config/obra_vgv.obras). Cache regenerável (Sienge).
create table public.obra_vgv (
  id            text primary key,                      -- id do empreendimento/centro de custo
  nome          text,
  vgv           numeric(15,2),
  lancamento    date,                                  -- "AAAA-MM-DD"; "" vira null
  at            timestamptz,                           -- quando o VGV foi calculado (epoch ms na origem)
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create trigger obra_vgv_atualizado_em before update on public.obra_vgv
  for each row execute function privado.tocar_atualizado_em();

-- Parcerias / parametrização de parceiros (config/partner_parametrizations.list). Área dona: financeiro.
create table public.parcerias (
  id                    text primary key,              -- "par_..." / "p-..."
  company_id            text,
  company_name          text,
  partner_name          text,
  kind                  text,
  obra_code             text,
  default_partner_share numeric,
  conta_terrenista      text,
  conta_distribuicao    text,
  socios_seed           text,
  creditor              jsonb,
  obras                 jsonb not null default '[]'::jsonb,
  cost_centers          jsonb not null default '[]'::jsonb,
  socios                jsonb not null default '[]'::jsonb,
  ordem                 integer,
  created_at            timestamptz,
  extra                 jsonb not null default '{}'::jsonb,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index parcerias_company_id_idx on public.parcerias (company_id);
create trigger parcerias_atualizado_em before update on public.parcerias
  for each row execute function privado.tocar_atualizado_em();

-- =====================================================================================
-- 3. COLEÇÕES DO NÚCLEO
-- =====================================================================================

-- TAGs de anexos.
create table public.tags (
  id             text primary key default gen_random_uuid()::text,  -- addDoc: id gerado
  name           text not null,
  destino        text not null default 'Unidade',
  status         text not null default 'Ativa',
  created_by     text,
  is_default     boolean not null default false,
  solicitacao_id text,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index tags_status_idx on public.tags (status);
create trigger tags_atualizado_em before update on public.tags
  for each row execute function privado.tocar_atualizado_em();

-- Memória do classificador de anexos (impressão digital da imagem -> TAG).
create table public.anexos_tag_memory (
  id            text primary key,                      -- "m_<epoch>_<rand>"
  tag           text not null,
  original_name text,
  pending       boolean not null default false,
  phrase_key    text,
  colors        text[] not null default '{}',
  phrases       text[] not null default '{}',
  aspect        numeric,
  learned_at    timestamptz,
  confirmed     boolean,
  rejected      boolean,
  hits          integer,
  updated_at    timestamptz,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create trigger anexos_tag_memory_atualizado_em before update on public.anexos_tag_memory
  for each row execute function privado.tocar_atualizado_em();

-- Anexos enviados ao Sienge, por empreendimento (anexos_mapa/<cc>.byKey). Uma linha por envio.
create table public.anexos_mapa (
  id              text primary key,                    -- <enterpriseId>_<chave>
  enterprise_id   text not null,
  chave           text not null,                       -- chave do byKey: <contractId>_<TAG>
  contract_id     text,
  contract_number text,
  tag             text,
  destination     text,
  file_name       text,
  description     text,
  unit_id         text,
  unit_name       text,
  sent_by         text,
  sent_at         timestamptz,
  source          text,
  copia_integra   text,
  storage_path    text,
  extra           jsonb not null default '{}'::jsonb,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (enterprise_id, chave)
);
create index anexos_mapa_tag_idx on public.anexos_mapa (tag);
create trigger anexos_mapa_atualizado_em before update on public.anexos_mapa
  for each row execute function privado.tocar_atualizado_em();

-- Auditoria do sistema (somente inclusão).
create table public.auditoria_logs (
  id              text primary key,                    -- "<epoch>-<rand>"
  "timestamp"     timestamptz not null,
  user_name       text,                                -- campo "user" na origem (palavra reservada)
  user_email      text,
  action          text not null default 'HTTP',
  module          text,
  status          text,
  summary         text,
  customer_id     text,
  customer_label  text,
  enterprise_id   text,
  enterprise_name text,
  unit_id         text,
  unit_name       text,
  title_id        text,
  endpoint        text,
  method          text,
  details         jsonb not null default '{}'::jsonb,
  extra           jsonb not null default '{}'::jsonb,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index auditoria_logs_timestamp_idx on public.auditoria_logs ("timestamp" desc);
create index auditoria_logs_action_timestamp_idx on public.auditoria_logs (action, "timestamp" desc);
create trigger auditoria_logs_atualizado_em before update on public.auditoria_logs
  for each row execute function privado.tocar_atualizado_em();

-- Auditoria do login do Sienge: relatório enviado (planilha) ...
create table public.auditoria_login_relatorios (
  id                text primary key,                  -- "rel_<epoch>"
  arquivo           text,
  periodo_de        date,
  periodo_ate       date,
  total             integer,
  usuarios          integer,
  bloqueios         integer,
  partes            integer,
  enviado_por       text,
  enviado_por_email text,
  enviado_em        timestamptz,
  extra             jsonb not null default '{}'::jsonb,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index auditoria_login_relatorios_periodo_idx on public.auditoria_login_relatorios (periodo_ate desc);
create trigger auditoria_login_relatorios_atualizado_em before update on public.auditoria_login_relatorios
  for each row execute function privado.tocar_atualizado_em();

-- ... e uma linha por acesso (substitui os shards auditoria_login_partes).
create table public.auditoria_login_linhas (
  id            bigint generated always as identity primary key,
  relatorio_id  text not null references public.auditoria_login_relatorios(id) on delete cascade,
  ordem         integer not null,                      -- n * 2500 + posição na parte
  usuario       text,
  ip            text,
  sucesso       boolean not null default false,
  entrada       timestamptz,
  saida         timestamptz,
  modo          text,
  motivo        text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index auditoria_login_linhas_relatorio_idx on public.auditoria_login_linhas (relatorio_id, ordem);
create index auditoria_login_linhas_entrada_idx on public.auditoria_login_linhas (entrada);
create trigger auditoria_login_linhas_atualizado_em before update on public.auditoria_login_linhas
  for each row execute function privado.tocar_atualizado_em();

-- Presença dos usuários (usuarios_online/<email>[__sessão]).
create table public.usuarios_online (
  id            text primary key,                      -- presenceId: e-mail (ou e-mail__sessão no login compartilhado)
  email         text not null,
  name          text,
  conta_email   text,
  conta_name    text,
  profile       text,
  online        boolean not null default true,
  since         timestamptz,
  last_seen     timestamptz,
  last_seen_at  timestamptz,
  last_use      timestamptz,
  logout_at     timestamptz,
  tab           text,
  tab_label     text,
  agent         text,
  sessoes       jsonb not null default '[]'::jsonb,    -- últimas 80 sessões {since,last,end,agent,saiu}
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index usuarios_online_email_idx on public.usuarios_online (email);
create index usuarios_online_conta_email_idx on public.usuarios_online (conta_email);
create trigger usuarios_online_atualizado_em before update on public.usuarios_online
  for each row execute function privado.tocar_atualizado_em();

-- Consumo da API do Sienge por dia (contadores incrementados via RPC incrementar_api_consumo).
create table public.api_consumo (
  id            text primary key,                      -- 'AAAA-MM-DD'
  date          date not null unique,
  rest          bigint not null default 0,
  bulk          bigint not null default 0,
  actors        jsonb not null default '{}'::jsonb,    -- {user, system}
  apis          jsonb not null default '{}'::jsonb,    -- {<chave>: {path, rest, bulk, user, system, telas{}, quem{}}}
  users         jsonb not null default '{}'::jsonb,    -- {<userKey>: {label, kind, rest, bulk}}
  updated_at    timestamptz,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create trigger api_consumo_atualizado_em before update on public.api_consumo
  for each row execute function privado.tocar_atualizado_em();

-- Bolhas de teste que cada desenvolvedor já abriu (ambientes_dev/<email>.ambientes).
create table public.ambientes_dev (
  id            bigint generated always as identity primary key,
  email         text not null,
  ambiente      text not null,
  acessado_em   timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (email, ambiente)
);
create trigger ambientes_dev_atualizado_em before update on public.ambientes_dev
  for each row execute function privado.tocar_atualizado_em();

-- "Ciente" dos alertas automáticos (alertas_ciente/<alerta>.<tipo>_<dia> = "ciente").
create table public.alertas_ciente (
  id            bigint generated always as identity primary key,
  alerta        text not null,                         -- id do documento de origem (ex.: ponto_israel)
  tipo          text not null,                         -- ex.: sexta
  dia           date not null,
  usuario_email text not null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (alerta, tipo, dia)
);
create index alertas_ciente_usuario_email_idx on public.alertas_ciente (usuario_email);
create trigger alertas_ciente_atualizado_em before update on public.alertas_ciente
  for each row execute function privado.tocar_atualizado_em();

-- Chamados de suporte.
create table public.suporte_chamados (
  id                text primary key default gen_random_uuid()::text,  -- addDoc: id gerado
  tipo              text,                              -- problema | melhoria | interno ...
  status            text not null default 'pendente',
  modulo            text,
  subitem           text,
  subitem_label     text,
  aba               text,
  aba_label         text,
  local_path        text,
  descricao         text,
  imagens           jsonb not null default '[]'::jsonb,
  mensagens         jsonb not null default '[]'::jsonb,
  user_id           text,                              -- e-mail em minúsculas (userKey)
  user_name         text,
  user_email        text,
  created_by_admin  boolean not null default false,
  arquivado_at      timestamptz,
  arquivado_por     text,
  responsavel_email text,
  responsavel_nome  text,
  responsavel_em    timestamptz,
  created_at        timestamptz,
  updated_at        timestamptz,
  extra             jsonb not null default '{}'::jsonb,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index suporte_chamados_user_email_idx on public.suporte_chamados (user_email);
create index suporte_chamados_updated_at_idx on public.suporte_chamados (updated_at desc);
create trigger suporte_chamados_atualizado_em before update on public.suporte_chamados
  for each row execute function privado.tocar_atualizado_em();

-- Prova de documentos autenticados (QR code dos acordos e cessões).
create table public.documentos_autenticados (
  id                        text primary key,          -- = codigo ("ac-..." / "cs-...")
  codigo                    text not null unique,
  tipo                      text not null,             -- acordo | cessao
  tipo_nome                 text,
  hash                      text,
  titulo                    text,
  unidade                   text,
  cliente                   text,
  arquivo                   text,
  em                        timestamptz,
  reparcelamento            jsonb,                     -- corpo do POST /remade-installments
  reparcelamento_enviado    boolean not null default false,
  reparcelamento_enviado_em timestamptz,
  substituido               boolean not null default false,
  extra                     jsonb not null default '{}'::jsonb,
  criado_em                 timestamptz not null default now(),
  atualizado_em             timestamptz not null default now()
);
create trigger documentos_autenticados_atualizado_em before update on public.documentos_autenticados
  for each row execute function privado.tocar_atualizado_em();

-- Agenda: lembretes pessoais por dono e dia (doc "<NOME DO DONO>_<AAAA-MM-DD>").
create table public.agenda_personal_notes (
  id            text primary key,                      -- id do documento, mantido (é a chave do mapa no front)
  dono          text not null,                         -- prefixo do id: nome do usuário ou "TODOS"
  data          date,                                  -- sufixo do id
  usuario_id    uuid references public.usuarios(id) on delete set null,
  notes         jsonb not null default '[]'::jsonb,    -- [{text, alarm, sharedWith[], triggered, recorrencia...}]
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index agenda_personal_notes_usuario_id_idx on public.agenda_personal_notes (usuario_id);
create index agenda_personal_notes_data_idx on public.agenda_personal_notes (data);
create index agenda_personal_notes_notes_idx on public.agenda_personal_notes using gin (notes jsonb_path_ops);
create trigger agenda_personal_notes_atualizado_em before update on public.agenda_personal_notes
  for each row execute function privado.tocar_atualizado_em();

-- Agenda: lembretes recorrentes (mesmo formato; coleção vazia na amostra).
create table public.agenda_recurring_notes (
  id            text primary key,
  dono          text not null,
  data          date,
  usuario_id    uuid references public.usuarios(id) on delete set null,
  notes         jsonb not null default '[]'::jsonb,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index agenda_recurring_notes_usuario_id_idx on public.agenda_recurring_notes (usuario_id);
create index agenda_recurring_notes_data_idx on public.agenda_recurring_notes (data);
create index agenda_recurring_notes_notes_idx on public.agenda_recurring_notes using gin (notes jsonb_path_ops);
create trigger agenda_recurring_notes_atualizado_em before update on public.agenda_recurring_notes
  for each row execute function privado.tocar_atualizado_em();

-- Estado da sincronização diária do Sienge (só o servidor: api/_lib/sync-creditors.js).
create table public.sienge_sync_state (
  id            text primary key,                      -- 'creditors'
  lock          text,
  running       boolean not null default false,
  phase         text,
  date          date,
  posicao       integer,                               -- campo "offset" na origem (palavra reservada)
  total         integer,
  gravados      integer,
  removidos     integer,
  done          boolean not null default false,
  erro          text,
  finished_at   timestamptz,
  updated_at    timestamptz,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create trigger sienge_sync_state_atualizado_em before update on public.sienge_sync_state
  for each row execute function privado.tocar_atualizado_em();

-- Coordenadas do KMZ por empreendimento. Cache regenerável (vem do arquivo kmz/<id>.kmz).
create table public.kmz_coordinates (
  id                text primary key,                  -- id do empreendimento (4 a 6 dígitos)
  empreendimento_id text not null,
  placemarks        jsonb not null default '[]'::jsonb,  -- [{name, coords}] um por lote
  quadras           jsonb not null default '[]'::jsonb,  -- [{name, coords}] polígonos
  count             integer,
  quadra_count      integer,
  updated_at        timestamptz,
  extra             jsonb not null default '{}'::jsonb,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create trigger kmz_coordinates_atualizado_em before update on public.kmz_coordinates
  for each row execute function privado.tocar_atualizado_em();

-- =====================================================================================
-- 4. RLS
-- =====================================================================================
alter table public.configuracoes              enable row level security;
alter table public.centros_custo              enable row level security;
alter table public.empresas                   enable row level security;
alter table public.condicoes_pagamento        enable row level security;
alter table public.motivos_cancelamento       enable row level security;
alter table public.preambulos                 enable row level security;
alter table public.cartorios                  enable row level security;
alter table public.fluxos_processo            enable row level security;
alter table public.central_email_templates    enable row level security;
alter table public.central_email_envios       enable row level security;
alter table public.obra_vgv                   enable row level security;
alter table public.parcerias                  enable row level security;
alter table public.tags                       enable row level security;
alter table public.anexos_tag_memory          enable row level security;
alter table public.anexos_mapa                enable row level security;
alter table public.auditoria_logs             enable row level security;
alter table public.auditoria_login_relatorios enable row level security;
alter table public.auditoria_login_linhas     enable row level security;
alter table public.usuarios_online            enable row level security;
alter table public.api_consumo                enable row level security;
alter table public.ambientes_dev              enable row level security;
alter table public.alertas_ciente             enable row level security;
alter table public.suporte_chamados           enable row level security;
alter table public.documentos_autenticados    enable row level security;
alter table public.agenda_personal_notes      enable row level security;
alter table public.agenda_recurring_notes     enable row level security;
alter table public.sienge_sync_state          enable row level security;
alter table public.kmz_coordinates            enable row level security;

-- ---- configuracoes: muitas telas gravam chaves diferentes; sem chave de permissão única (revisar).
create policy "configuracoes: ativos leem" on public.configuracoes
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "configuracoes: ativos incluem" on public.configuracoes
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "configuracoes: ativos alteram" on public.configuracoes
  for update to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "configuracoes: admin exclui" on public.configuracoes
  for delete to authenticated using ((select privado.eh_admin()));

-- ---- cadastros com chave de permissão clara: todos os ativos leem; grava quem tem _editar.
create policy "centros_custo: ativos leem" on public.centros_custo
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "centros_custo: editar grava" on public.centros_custo
  for all to authenticated
  using ((select privado.tem_permissao('sub_cfg_apoio_centro_custo_editar')))
  with check ((select privado.tem_permissao('sub_cfg_apoio_centro_custo_editar')));

create policy "empresas: ativos leem" on public.empresas
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "empresas: editar grava" on public.empresas
  for all to authenticated
  using ((select privado.tem_permissao('sub_cfg_apoio_empresas_editar')))
  with check ((select privado.tem_permissao('sub_cfg_apoio_empresas_editar')));

create policy "condicoes_pagamento: ativos leem" on public.condicoes_pagamento
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "condicoes_pagamento: editar grava" on public.condicoes_pagamento
  for all to authenticated
  using ((select privado.tem_permissao('sub_com_geral_condicoes_pagamento_editar')))
  with check ((select privado.tem_permissao('sub_com_geral_condicoes_pagamento_editar')));

create policy "motivos_cancelamento: ativos leem" on public.motivos_cancelamento
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "motivos_cancelamento: editar grava" on public.motivos_cancelamento
  for all to authenticated
  using ((select privado.tem_permissao('sub_cfg_apoio_motivos_cancelamento_editar')))
  with check ((select privado.tem_permissao('sub_cfg_apoio_motivos_cancelamento_editar')));

create policy "preambulos: ativos leem" on public.preambulos
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "preambulos: editar grava" on public.preambulos
  for all to authenticated
  using ((select privado.tem_permissao('sub_cfg_apoio_preambulos_editar')))
  with check ((select privado.tem_permissao('sub_cfg_apoio_preambulos_editar')));

create policy "tags: ativos leem" on public.tags
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "tags: editar grava" on public.tags
  for all to authenticated
  using ((select privado.tem_permissao('sub_cfg_apoio_tags_editar')))
  with check ((select privado.tem_permissao('sub_cfg_apoio_tags_editar')));

create policy "kmz_coordinates: ativos leem" on public.kmz_coordinates
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "kmz_coordinates: editar grava" on public.kmz_coordinates
  for all to authenticated
  using ((select privado.tem_permissao('sub_cfg_apoio_upload_kmz_editar')))
  with check ((select privado.tem_permissao('sub_cfg_apoio_upload_kmz_editar')));

-- ---- padrão (usuário ativo lê e grava; só admin exclui) — sem chave de permissão clara (revisar).
create policy "cartorios: ativos leem" on public.cartorios
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "cartorios: ativos incluem" on public.cartorios
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "cartorios: ativos alteram" on public.cartorios
  for update to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "cartorios: admin exclui" on public.cartorios
  for delete to authenticated using ((select privado.eh_admin()));

create policy "fluxos_processo: ativos leem" on public.fluxos_processo
  for select to authenticated using ((select privado.usuario_ativo()));
-- Fluxos do processo ficam em Jurídico > Configurações (mesma chave usada na migration do jurídico).
create policy "fluxos_processo: configuracoes juridico grava" on public.fluxos_processo
  for all to authenticated
  using ((select privado.tem_permissao('sub_jur_geral_configuracoes_editar')))
  with check ((select privado.tem_permissao('sub_jur_geral_configuracoes_editar')));

create policy "central_email_templates: ativos leem" on public.central_email_templates
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "central_email_templates: ativos incluem" on public.central_email_templates
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "central_email_templates: ativos alteram" on public.central_email_templates
  for update to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "central_email_templates: ativos excluem" on public.central_email_templates
  for delete to authenticated using ((select privado.usuario_ativo()));

-- central_email_envios: a tela só lê; quem grava é o servidor (service role).
create policy "central_email_envios: ativos leem" on public.central_email_envios
  for select to authenticated using ((select privado.usuario_ativo()));

create policy "obra_vgv: ativos leem" on public.obra_vgv
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "obra_vgv: ativos incluem" on public.obra_vgv
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "obra_vgv: ativos alteram" on public.obra_vgv
  for update to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "obra_vgv: admin exclui" on public.obra_vgv
  for delete to authenticated using ((select privado.eh_admin()));

create policy "parcerias: ativos leem" on public.parcerias
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "parcerias: ativos incluem" on public.parcerias
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "parcerias: ativos alteram" on public.parcerias
  for update to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "parcerias: ativos excluem" on public.parcerias
  for delete to authenticated using ((select privado.usuario_ativo()));

create policy "anexos_tag_memory: ativos leem" on public.anexos_tag_memory
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "anexos_tag_memory: ativos incluem" on public.anexos_tag_memory
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "anexos_tag_memory: ativos alteram" on public.anexos_tag_memory
  for update to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "anexos_tag_memory: admin exclui" on public.anexos_tag_memory
  for delete to authenticated using ((select privado.eh_admin()));

create policy "anexos_mapa: ativos leem" on public.anexos_mapa
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "anexos_mapa: ativos incluem" on public.anexos_mapa
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "anexos_mapa: ativos alteram" on public.anexos_mapa
  for update to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "anexos_mapa: admin exclui" on public.anexos_mapa
  for delete to authenticated using ((select privado.eh_admin()));

create policy "documentos_autenticados: ativos leem" on public.documentos_autenticados
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "documentos_autenticados: ativos incluem" on public.documentos_autenticados
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "documentos_autenticados: ativos alteram" on public.documentos_autenticados
  for update to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "documentos_autenticados: admin exclui" on public.documentos_autenticados
  for delete to authenticated using ((select privado.eh_admin()));

-- api_consumo: todo usuário ativo incrementa (RPC security invoker faz upsert, que exige ler a linha).
create policy "api_consumo: ativos leem" on public.api_consumo
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "api_consumo: ativos incluem" on public.api_consumo
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "api_consumo: ativos alteram" on public.api_consumo
  for update to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "api_consumo: admin exclui" on public.api_consumo
  for delete to authenticated using ((select privado.eh_admin()));

-- ---- auditoria do sistema: todos incluem; lê quem tem a tela de auditoria. Os boletos
-- (action BOLETO_GERADO) também são lidos pelo relatório de honorários.
create policy "auditoria_logs: auditoria le" on public.auditoria_logs
  for select to authenticated using (
    (select privado.tem_permissao('sub_seg_geral_auditoria_visualizar'))
    or (action = 'BOLETO_GERADO' and (select privado.usuario_ativo()))
  );
create policy "auditoria_logs: ativos incluem" on public.auditoria_logs
  for insert to authenticated with check ((select privado.usuario_ativo()));

-- ---- auditoria do login do Sienge.
create policy "auditoria_login_relatorios: visualizar le" on public.auditoria_login_relatorios
  for select to authenticated
  using ((select privado.tem_permissao('sub_seg_geral_auditoria_login_visualizar')));
create policy "auditoria_login_relatorios: editar grava" on public.auditoria_login_relatorios
  for all to authenticated
  using ((select privado.tem_permissao('sub_seg_geral_auditoria_login_editar')))
  with check ((select privado.tem_permissao('sub_seg_geral_auditoria_login_editar')));

create policy "auditoria_login_linhas: visualizar le" on public.auditoria_login_linhas
  for select to authenticated
  using ((select privado.tem_permissao('sub_seg_geral_auditoria_login_visualizar')));
create policy "auditoria_login_linhas: editar grava" on public.auditoria_login_linhas
  for all to authenticated
  using ((select privado.tem_permissao('sub_seg_geral_auditoria_login_editar')))
  with check ((select privado.tem_permissao('sub_seg_geral_auditoria_login_editar')));

-- ---- presença: cada um grava a própria linha (e-mail da pessoa ou da conta); a tela lê tudo.
create policy "usuarios_online: proprio ou tela le" on public.usuarios_online
  for select to authenticated using (
    (select privado.usuario_ativo()) and (
      email = (select auth.jwt() ->> 'email')
      or conta_email = (select auth.jwt() ->> 'email')
      or (select privado.tem_permissao('sub_seg_geral_usuarios_online_visualizar'))
    )
  );
create policy "usuarios_online: proprio inclui" on public.usuarios_online
  for insert to authenticated with check (
    (select privado.usuario_ativo()) and (
      email = (select auth.jwt() ->> 'email') or conta_email = (select auth.jwt() ->> 'email')
    )
  );
create policy "usuarios_online: proprio altera" on public.usuarios_online
  for update to authenticated
  using (
    (select privado.usuario_ativo()) and (
      email = (select auth.jwt() ->> 'email') or conta_email = (select auth.jwt() ->> 'email')
    )
  )
  with check (
    (select privado.usuario_ativo()) and (
      email = (select auth.jwt() ->> 'email') or conta_email = (select auth.jwt() ->> 'email')
    )
  );
create policy "usuarios_online: admin exclui" on public.usuarios_online
  for delete to authenticated using ((select privado.eh_admin()));

-- ---- dados pessoais por e-mail.
create policy "ambientes_dev: proprio ou admin le" on public.ambientes_dev
  for select to authenticated using (
    (select privado.usuario_ativo())
    and (email = (select auth.jwt() ->> 'email') or (select privado.eh_admin()))
  );
create policy "ambientes_dev: proprio grava" on public.ambientes_dev
  for all to authenticated
  using ((select privado.usuario_ativo()) and email = (select auth.jwt() ->> 'email'))
  with check ((select privado.usuario_ativo()) and email = (select auth.jwt() ->> 'email'));

create policy "alertas_ciente: proprio le" on public.alertas_ciente
  for select to authenticated using (
    (select privado.usuario_ativo())
    and (usuario_email = (select auth.jwt() ->> 'email') or (select privado.eh_admin()))
  );
create policy "alertas_ciente: proprio grava" on public.alertas_ciente
  for all to authenticated
  using ((select privado.usuario_ativo()) and usuario_email = (select auth.jwt() ->> 'email'))
  with check ((select privado.usuario_ativo()) and usuario_email = (select auth.jwt() ->> 'email'));

-- ---- suporte: o autor vê e responde os seus; o suporte (mod_suporte / chamados_acessar) vê todos.
create policy "suporte_chamados: autor ou suporte le" on public.suporte_chamados
  for select to authenticated using (
    (select privado.usuario_ativo()) and (
      user_email = (select auth.jwt() ->> 'email')
      or (select privado.tem_permissao('mod_suporte'))
      or (select privado.tem_permissao('sub_suporte_geral_chamados_acessar'))
    )
  );
create policy "suporte_chamados: autor ou suporte inclui" on public.suporte_chamados
  for insert to authenticated with check (
    (select privado.usuario_ativo()) and (
      user_email = (select auth.jwt() ->> 'email')
      or (select privado.tem_permissao('mod_suporte'))
      or (select privado.tem_permissao('sub_suporte_geral_chamados_acessar'))
    )
  );
create policy "suporte_chamados: autor ou suporte altera" on public.suporte_chamados
  for update to authenticated
  using (
    (select privado.usuario_ativo()) and (
      user_email = (select auth.jwt() ->> 'email')
      or (select privado.tem_permissao('mod_suporte'))
      or (select privado.tem_permissao('sub_suporte_geral_chamados_acessar'))
    )
  )
  with check (
    (select privado.usuario_ativo()) and (
      user_email = (select auth.jwt() ->> 'email')
      or (select privado.tem_permissao('mod_suporte'))
      or (select privado.tem_permissao('sub_suporte_geral_chamados_acessar'))
    )
  );
create policy "suporte_chamados: admin exclui" on public.suporte_chamados
  for delete to authenticated using ((select privado.eh_admin()));

-- ---- agenda: dono (usuario_id), lembretes de "TODOS" e os compartilhados comigo (sharedWith).
create policy "agenda_personal_notes: dono, todos ou compartilhado le" on public.agenda_personal_notes
  for select to authenticated using (
    (select privado.usuario_ativo()) and (
      usuario_id = (select auth.uid())
      or upper(dono) = 'TODOS'
      or notes @> jsonb_build_array(jsonb_build_object('sharedWith', jsonb_build_array((select auth.jwt() ->> 'email'))))
      or (select privado.eh_admin())
    )
  );
create policy "agenda_personal_notes: dono ou todos inclui" on public.agenda_personal_notes
  for insert to authenticated with check (
    (select privado.usuario_ativo()) and (usuario_id = (select auth.uid()) or upper(dono) = 'TODOS')
  );
create policy "agenda_personal_notes: dono, todos ou compartilhado altera" on public.agenda_personal_notes
  for update to authenticated
  using (
    (select privado.usuario_ativo()) and (
      usuario_id = (select auth.uid())
      or upper(dono) = 'TODOS'
      or notes @> jsonb_build_array(jsonb_build_object('sharedWith', jsonb_build_array((select auth.jwt() ->> 'email'))))
    )
  )
  with check ((select privado.usuario_ativo()));
create policy "agenda_personal_notes: dono ou todos exclui" on public.agenda_personal_notes
  for delete to authenticated using (
    (select privado.usuario_ativo())
    and (usuario_id = (select auth.uid()) or upper(dono) = 'TODOS' or (select privado.eh_admin()))
  );

create policy "agenda_recurring_notes: dono, todos ou compartilhado le" on public.agenda_recurring_notes
  for select to authenticated using (
    (select privado.usuario_ativo()) and (
      usuario_id = (select auth.uid())
      or upper(dono) = 'TODOS'
      or notes @> jsonb_build_array(jsonb_build_object('sharedWith', jsonb_build_array((select auth.jwt() ->> 'email'))))
      or (select privado.eh_admin())
    )
  );
create policy "agenda_recurring_notes: dono ou todos inclui" on public.agenda_recurring_notes
  for insert to authenticated with check (
    (select privado.usuario_ativo()) and (usuario_id = (select auth.uid()) or upper(dono) = 'TODOS')
  );
create policy "agenda_recurring_notes: dono, todos ou compartilhado altera" on public.agenda_recurring_notes
  for update to authenticated
  using (
    (select privado.usuario_ativo()) and (
      usuario_id = (select auth.uid())
      or upper(dono) = 'TODOS'
      or notes @> jsonb_build_array(jsonb_build_object('sharedWith', jsonb_build_array((select auth.jwt() ->> 'email'))))
    )
  )
  with check ((select privado.usuario_ativo()));
create policy "agenda_recurring_notes: dono ou todos exclui" on public.agenda_recurring_notes
  for delete to authenticated using (
    (select privado.usuario_ativo())
    and (usuario_id = (select auth.uid()) or upper(dono) = 'TODOS' or (select privado.eh_admin()))
  );

-- sienge_sync_state: só servidor (RLS ligada, sem política: apenas a service role acessa).

-- Visitante sem token (anon) não tem acesso a nada destas tabelas.
revoke all on
  public.configuracoes, public.centros_custo, public.empresas, public.condicoes_pagamento,
  public.motivos_cancelamento, public.preambulos, public.cartorios, public.fluxos_processo,
  public.central_email_templates, public.central_email_envios, public.obra_vgv, public.parcerias,
  public.tags, public.anexos_tag_memory, public.anexos_mapa, public.auditoria_logs,
  public.auditoria_login_relatorios, public.auditoria_login_linhas, public.usuarios_online,
  public.api_consumo, public.ambientes_dev, public.alertas_ciente, public.suporte_chamados,
  public.documentos_autenticados, public.agenda_personal_notes, public.agenda_recurring_notes,
  public.sienge_sync_state, public.kmz_coordinates
from anon;

-- =====================================================================================
-- 5. REALTIME (coleções/documentos com onSnapshot no código)
-- =====================================================================================
alter publication supabase_realtime add table public.configuracoes;          -- onSnapshot(config/global): crm_obras_andamento
alter publication supabase_realtime add table public.usuarios_online;
alter publication supabase_realtime add table public.suporte_chamados;
alter publication supabase_realtime add table public.agenda_personal_notes;
alter publication supabase_realtime add table public.agenda_recurring_notes;

-- =====================================================================================
-- 6. FUNÇÕES (RPC) — substituem runTransaction / increment
-- =====================================================================================

-- Soma profunda de JSON: números somam, objetos fundem recursivamente, o resto (rótulos) é substituído.
-- Equivale a vários increment() do Firestore em campos aninhados.
create or replace function privado.jsonb_somar(a jsonb, b jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  saida jsonb;
  k     text;
  v     jsonb;
  atual jsonb;
begin
  if b is null or jsonb_typeof(b) <> 'object' then
    return coalesce(b, a);
  end if;
  if a is null or jsonb_typeof(a) <> 'object' then
    a := '{}'::jsonb;
  end if;
  saida := a;
  for k, v in select e.key, e.value from jsonb_each(b) e loop
    atual := saida -> k;
    if atual is not null and jsonb_typeof(atual) = 'number' and jsonb_typeof(v) = 'number' then
      saida := saida || jsonb_build_object(k, (atual::numeric + v::numeric));
    elsif atual is not null and jsonb_typeof(atual) = 'object' and jsonb_typeof(v) = 'object' then
      saida := saida || jsonb_build_object(k, privado.jsonb_somar(atual, v));
    else
      saida := saida || jsonb_build_object(k, v);
    end if;
  end loop;
  return saida;
end $$;
revoke all on function privado.jsonb_somar(jsonb, jsonb) from public, anon;
grant execute on function privado.jsonb_somar(jsonb, jsonb) to authenticated, service_role;

-- api_consumo: soma o lote pendente do dia (ApiUsage.flush). p_delta no mesmo formato do payload atual:
-- {rest, bulk, actors:{user,system}, apis:{<k>:{path,rest,bulk,user,system,telas:{},quem:{}}}, users:{...}}
create or replace function public.incrementar_api_consumo(p_data date, p_delta jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.api_consumo as a (id, date, rest, bulk, actors, apis, users, updated_at)
  values (
    to_char(p_data, 'YYYY-MM-DD'),
    p_data,
    coalesce((p_delta ->> 'rest')::bigint, 0),
    coalesce((p_delta ->> 'bulk')::bigint, 0),
    coalesce(p_delta -> 'actors', '{}'::jsonb),
    coalesce(p_delta -> 'apis', '{}'::jsonb),
    coalesce(p_delta -> 'users', '{}'::jsonb),
    now()
  )
  on conflict (id) do update set
    rest       = a.rest + excluded.rest,
    bulk       = a.bulk + excluded.bulk,
    actors     = privado.jsonb_somar(a.actors, excluded.actors),
    apis       = privado.jsonb_somar(a.apis, excluded.apis),
    users      = privado.jsonb_somar(a.users, excluded.users),
    updated_at = now();
end $$;

-- configuracoes: grava várias chaves numa transação só (commitCrmGlobalConfig / forceUploadLocalConfig).
-- p_valores = {"crm_moura_rules": {...}, "crm_indexadores_ativos": [...]}
create or replace function public.gravar_configuracoes(p_valores jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_valores is null or jsonb_typeof(p_valores) <> 'object' then
    raise exception 'p_valores precisa ser um objeto {chave: valor}';
  end if;
  insert into public.configuracoes (chave, valor, atualizado_por)
  select e.key, e.value, coalesce(auth.jwt() ->> 'email', 'servidor')
  from jsonb_each(p_valores) e
  on conflict (chave) do update
    set valor = excluded.valor, atualizado_por = excluded.atualizado_por;
end $$;

-- configuracoes: fusão rasa atômica de um objeto (setDoc merge numa chave cujo valor é mapa,
-- ex.: crm_plano_reembolsaveis, crm_engenharia_caucao_liberados_v1). Devolve o valor final.
create or replace function public.mesclar_configuracao(p_chave text, p_parcial jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_final jsonb;
begin
  insert into public.configuracoes as c (chave, valor, atualizado_por)
  values (p_chave, p_parcial, coalesce(auth.jwt() ->> 'email', 'servidor'))
  on conflict (chave) do update
    set valor = case
                  when jsonb_typeof(c.valor) = 'object' and jsonb_typeof(excluded.valor) = 'object'
                    then c.valor || excluded.valor
                  else excluded.valor
                end,
        atualizado_por = excluded.atualizado_por
  returning valor into v_final;
  return v_final;
end $$;

-- configuracoes: troca condicional (substitui runTransaction "lê, funde no JS, grava").
-- p_esperado = atualizado_em lido antes (null = a chave ainda não existia).
-- Devolve o novo atualizado_em, ou null se alguém gravou antes (reler, fundir de novo e repetir).
create or replace function public.trocar_configuracao(p_chave text, p_valor jsonb, p_esperado timestamptz)
returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare
  novo timestamptz;
begin
  if p_esperado is null then
    insert into public.configuracoes (chave, valor, atualizado_por)
    values (p_chave, p_valor, coalesce(auth.jwt() ->> 'email', 'servidor'))
    on conflict (chave) do nothing
    returning atualizado_em into novo;
  else
    update public.configuracoes
       set valor = p_valor, atualizado_por = coalesce(auth.jwt() ->> 'email', 'servidor')
     where chave = p_chave and atualizado_em = p_esperado
    returning atualizado_em into novo;
  end if;
  return novo;
end $$;

revoke all on function public.incrementar_api_consumo(date, jsonb) from public, anon;
revoke all on function public.gravar_configuracoes(jsonb) from public, anon;
revoke all on function public.mesclar_configuracao(text, jsonb) from public, anon;
revoke all on function public.trocar_configuracao(text, jsonb, timestamptz) from public, anon;
grant execute on function public.incrementar_api_consumo(date, jsonb) to authenticated, service_role;
grant execute on function public.gravar_configuracoes(jsonb) to authenticated, service_role;
grant execute on function public.mesclar_configuracao(text, jsonb) to authenticated, service_role;
grant execute on function public.trocar_configuracao(text, jsonb, timestamptz) to authenticated, service_role;
