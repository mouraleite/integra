# Convenções do banco (Fase 2)

Valem para toda migration em `supabase/migrations/`. Objetivo: tabelas relacionais de verdade, sem perder dado
do Firestore, e com troca mecânica no código (Fase 3) e na carga (Fase 4).

## Nomes
- **Tabela = nome da coleção do Firestore** (ex.: `sienge_customers`, `vistorias`), para a troca no código ser direta.
  Exceções: shards e documentos de `config` (abaixo), e coleções-filhas, que viram `<pai>_<filho>` com FK para o pai.
- **Coluna = nome do campo em snake_case minúsculo** (`customerId` → `customer_id`, `createdAt` → `created_at`).
  Campo com acento ou caractere estranho: transliterar e registrar no mapa da área.
- Funções RPC: `public.<verbo>_<objeto>` (ex.: `public.incrementar_consumo`).

## Colunas padrão de toda tabela
```sql
id            text primary key,          -- id do documento no Firestore (mantido na carga)
...colunas tipadas...
extra         jsonb not null default '{}'::jsonb,   -- campos raros/irregulares: nada se perde
criado_em     timestamptz not null default now(),
atualizado_em timestamptz not null default now()
```
- Quando o id do documento é composto/derivado (ex.: `<cliente>_<mes>`), manter `id text` e criar também as
  colunas que o compõem, com índice.
- Tabela nascida de um array dentro de documento (um item por linha): `id bigint generated always as identity`
  ou `uuid default gen_random_uuid()`, + FK/coluna do documento de origem + `ordem int` se a ordem importa.
- Trigger de `atualizado_em`:
  `create trigger <t>_atualizado_em before update on public.<t> for each row execute function privado.tocar_atualizado_em();`

## Tipos
- Timestamp do Firestore, ISO com hora ou epoch ms → `timestamptz`. Data `AAAA-MM-DD` ou `DD/MM/AAAA` → `date`.
- Dinheiro → `numeric(15,2)`; percentual/índice → `numeric`; contagem → `integer`/`bigint`.
- Booleano (inclusive 0/1 usado como flag) → `boolean`.
- Lista simples de textos → `text[]`; lista de objetos que é consultada/filtrada → tabela filha;
  lista de objetos só exibida em bloco → `jsonb`.
- Campo presente em < ~20% dos docs e não usado em filtro/ordenação → fica em `extra`.
- `not null` só quando 100% da amostra tem o campo E o código sempre grava.

## Documentos grandes ("planilha num documento")
Vários docs guardam centenas de KB (cache/snapshot de dados do Sienge, arrays enormes). Regra:
- Se o código **filtra, soma ou busca item a item** → uma linha por item (tabela filha), com colunas tipadas.
- Se o código só **lê o bloco inteiro e mostra** (snapshot/cache regenerável) → uma linha por documento com
  `dados jsonb`, e registrar no mapa "cache regenerável".
- Registrar a decisão e o motivo no mapa da área.

## Shards e `config`
- Notas em shards (`*_notes_shards`): uma linha por nota, com a chave do cliente/processo; esqueça o shard.
- Documentos de `config/*` e chaves de `config/global`: listas/cadastros viram tabelas próprias;
  o resto vai para `public.configuracoes(chave text primary key, valor jsonb, atualizado_em, atualizado_por)`.

## Acesso (RLS) — obrigatório
RLS já nasce ligada (event trigger do Supabase). Toda tabela precisa de política, senão ninguém acessa:
- Padrão: `to authenticated using ((select privado.usuario_ativo()))` para select/insert/update/delete.
- Onde existe chave de permissão clara do Integra (ex.: `sub_fin_cr_fila_cobranca_editar`), usar
  `(select privado.tem_permissao('<chave>'))` — leitura com `_visualizar`/`_acessar`, escrita com `_editar`.
  Na dúvida, usar o padrão e anotar no mapa para revisar.
- Dado pessoal do usuário (notas pessoais, preferências): dono = `(select auth.uid())` numa coluna `usuario_id uuid
  references public.usuarios(id)`; se a origem só tem e-mail, guardar `usuario_email` e comparar com
  `(select auth.jwt() ->> 'email')`.
- Tabelas só do servidor/crons (sem tela): RLS ligada **sem** política (só a service role acessa) e anotar.
- Nunca `to anon`. Nunca `using (true)`.

## Realtime, transações, contadores
- Coleção com `onSnapshot` no código → `alter publication supabase_realtime add table public.<t>;`
- `runTransaction` / `increment` → função SQL (`language plpgsql`, `security invoker`, `set search_path = ''`),
  com `grant execute ... to authenticated` (ou só `service_role` se for do servidor).

## Índices
- Índice para todo campo usado em `where`/`orderBy` no código, e para toda FK.

## Entregas por área
- `supabase/migrations/<AAAAMMDDHHMM>_<area>.sql`: DDL completo, idempotência não é exigida (roda uma vez).
- `docs/mapa-tabelas/<area>.md`: para cada coleção → tabela(s), mapeamento campo → coluna (com transformação),
  decisão para docs grandes, chave de permissão usada, listeners/transações encontrados e onde (arquivo:linha),
  e o que o importador (Fase 4) precisa fazer.
