# Migração Firebase → Supabase + Vercel (mouraleite)

Branch: `migracao-supabase` · Supabase: projeto `integra` (org mouraleite, ref `ujtdtezymcyjnbqkelgp`)
· Vercel: time **mouraleite** (`mouraleite1`), projeto `integra`.
A produção atual (crm-gestao.vercel.app, Firebase `crm-gestao-mldu`) não muda até a virada.

## Ponto de partida
- Firestore com cerca de 80 coleções e Firebase Storage (bucket `crm-gestao-mldu`).
- Login pela Microsoft (Entra ID / MSAL); o Firebase não tem login, então suas regras estão abertas.
- 78 arquivos chamam o Firebase direto (`window.firebaseCollections`), sem camada central; `js/nucleo/app.js` tem 272 chamadas.
- Servidor (`api/_lib`, `lib/`) usa o SDK cliente do Firebase sem login; `api/_lib/publicar.js` usa a REST do Firestore.

## Fases
0. **Base (feito nesta branch):** cliente `js/nucleo/supabase-client.js` (`window.sb`), `lib/supabase-admin.js`,
   pasta `supabase/migrations/`, export `ferramentas/migracao/exportar-firestore.js`, crons fora do `vercel.json`.
1. **Login e segurança (feito):** `/api/supabase-token` (`api/_lib/supabase-token.js`) valida o token Microsoft
   (`lib/integra-auth.js`), procura o usuário ATIVO em `public.usuarios` e emite um JWT ES256 de 1 hora
   (`role=authenticated`, `sub=usuarios.id`). Login compartilhado (mesmo `login_email` para vários usuários):
   o navegador manda o usuário escolhido em `X-Integra-Usuario`. `js/nucleo/supabase-client.js` usa esse token
   (`accessToken`) e renova sozinho.
   Banco: `public.perfis` e `public.usuarios` (carregados com `ferramentas/migracao/importar-usuarios.js`), funções
   `privado.usuario_ativo()`, `privado.eh_admin()`, `privado.tem_permissao(chave)` para as políticas. O schema
   `privado` não é exposto pela API. Toda tabela nova em `public` nasce com RLS ligada (event trigger `ensure_rls`
   do próprio Supabase); sem política, ninguém acessa.
   Modelo de política para as próximas tabelas:
   `using ((select privado.tem_permissao('sub_fin_cr_fila_cobranca_visualizar')))`.
2. **Tabelas relacionais (criadas):** ver `docs/mapa-tabelas/README.md` (mapa por área e decisões pendentes) e
   `supabase/CONVENCOES.md`. Desenho original: uma tabela por coleção, colunas tipadas para o
   que é filtrado e somado, `extra jsonb` para campos raros. `config/*` vira tabelas de cadastro + `configuracoes(chave, valor)`.
   Notas em shards viram uma linha por nota. `increment` e `runTransaction` viram funções SQL. `onSnapshot` vira Realtime.
   Storage: buckets espelhando as pastas atuais; registros guardam o caminho do arquivo, não a URL do Firebase.
3. **Código por área.** Andamento:
   - **Núcleo (feito no código, falta testar com login):** camada `js/nucleo/dados-base.js` (conversão objeto <->
     linha, também usada pelo importador), `js/nucleo/mapas-nucleo.js` (campo -> coluna) e `js/nucleo/dados-nucleo.js`
     (`window.DadosNucleo`). `config/global` continua existindo para o app como espelho do localStorage, mas é montado
     a partir de `configuracoes` + tabelas (`centros_custo`, `empresas`, `usuarios`, `perfis`...) e só as linhas que
     mudaram são gravadas. Migrados: `app.js` (configuração, usuários/perfis, agenda, documentos autenticados, KMZ,
     settings) e os outros arquivos de `js/nucleo/`. Importador: `ferramentas/migracao/importar-nucleo.js`.
     Mudanças de comportamento: as "transações" de usuários/perfis (`crmTransacaoConfig`) leem e gravam sem trava
     (gravam só as linhas alteradas); `empresas.js` idem; KMZ fica numa linha só (sem o doc `_quadras`); a agenda só
     grava notas do próprio usuário, de TODOS ou compartilhadas com ele. Arquivos (Storage) seguem no Firebase até a
     Fase 4. Outras áreas que leem `config/*` direto no Firebase (cobrança, financeiro, contábil, jurídico, engenharia,
     fiscal) passam para `DadosNucleo.lerConfig/gravarConfig` quando a área delas for migrada.
   - **Cobrança e jurídico (feito no código, falta testar com login):** `js/cobranca/mapas-cobranca.js` e
     `js/cobranca/dados-cobranca.js` (`window.DadosCobranca`: notas por cliente via RPC, NEX, registro, motivos,
     cache diário de inadimplência). Migrados: notas de cobrança e jurídicas (sem shards; o merge que era
     `runTransaction` fica na RPC), NEX, renegociação, processos, custas, boletos, documentos de assinatura,
     registro, snapshots de inadimplência e o espelho `sienge_customers` no front; e as leituras de `config/*` das
     telas de cobrança/jurídico. Importador: `ferramentas/migracao/importar-cobranca.js` (`--sem-teste`,
     `--dias-cache`). Pendências: o cache local `crm_moura_notes` deve ser descartado na virada; "sincronizar
     tudo" não apaga mais notas; o registro grava ~2,6 MB numa chamada (conferir limite da API no teste);
     datas vazias voltam ausentes em vez de `""`.
   - **Engenharia, vistoria, comercial e orçamento (feito no código, falta testar com login):**
     `js/engenharia/mapas-engenharia.js` e `dados-engenharia.js` (`window.DadosEngenharia`). Migrados: vistorias,
     verificação de construção, avisos e batimento de vistoria, acompanhamento de obras, caução, estoque comercial
     (uma linha por unidade; gravação por RPC), tabelas vigentes, orçamento e forecast, solicitações de produção e de
     tag; e as pendências do núcleo em `anexos.js` e `js/contabil/*` (config). Campos de arquivo guardam o caminho
     no Storage e voltam como URL pública do Firebase (sem token) até a Fase 4.
     **Link público da vistoria** (`vistoria.html`, cliente sem login): rota `api/vistoria-publica` (GET devolve só os
     campos da página e a coordenada do lote; POST valida respostas e caminhos das fotos e chama `enviar_vistoria`
     com a service role; limite de tamanho e por IP). `vistoria-app/` usa o login Microsoft dele para pegar o token.
     Importador: `ferramentas/migracao/importar-engenharia.js` (`--sem-caches`). Banco: fusão profunda
     (`privado.jsonb_fundir_profundo`) no controle do estoque; mapa vazio zera o campo, como no Firestore.
   - **Financeiro, fiscal, contábil, compras e marketing (feito no código, falta testar com login):**
     `js/financeiro/mapas-financeiro.js` e `dados-financeiro.js` (`window.DadosFinanceiro`, 38 tabelas e 11 RPCs).
     Migrados: caixa diário (posição, movimentos, radar, valor a receber), contas pagas, antecipações, lotes de
     pagamento, participações, contas de parceria, credores do Sienge, DFC, resultado de caixa, Rydoo, mútuo, notas
     fiscais, marketing, títulos incompletos; anexos jurídicos (tabela nova `anexos_juridicos`, que tinha ficado fora
     do inventário) e `cartao_clara`/`compras_dashboard_cache` guardados inteiros em `configuracoes`
     (`DadosNucleo.listarDocs`). Importador: `ferramentas/migracao/importar-financeiro.js`.
     **Com isso o front não faz mais nenhuma chamada ao Firestore**; o Storage também mudou na Fase 4.
     Mudanças: a coleção antiga `creditors` deixou de ser usada como reserva (só `sienge_creditors`); `updatedAt`
     de algumas tabelas passa a ser a hora do servidor; a camada compara JSON com chaves ordenadas para não
     regravar valores iguais.
   - **Servidor (feito no código, falta testar com as chaves na Vercel):** `lib/dados-servidor.js` carrega no Node as
     mesmas camadas das telas (`js/<area>/dados-*.js` e `mapas-*.js`, via `includeFiles` do `vercel.json`) com o cliente
     service role (`lib/supabase-admin.js`). Migrados: `lib/integra-auth.js` (usuário ativo lido de `public.usuarios`;
     login compartilhado passa se um dos cadastros estiver ativo), `publicar` (administrador pelo perfil em `usuarios`;
     solicitação em `solicitacoes_producao`), `central-email-enviar`, `sync-customers`, `sync-creditors`, `morning-warmup`
     (fila da cobrança, snapshot, contas pagas, valor a receber, títulos incompletos, distratos), `painel-diario`,
     `estoque-batimento`, `caucao-batimento`, `reembolso-batimento` e `antecipacoes-batimento`. Os documentos divididos em
     partes viraram uma linha (base da caução, mês do comercial, vistoria do dia) ou uma RPC (contas pagas, antecipações,
     valor a receber, posição do caixa, estoque por empreendimento). As travas que eram `runTransaction` usam
     `travar_caucao_batimento` e `trocar_configuracao`. O Storage também saiu do Firebase na Fase 4
     (ver abaixo).
     Já era assim antes: o `sync-creditors` não apaga os credores que saíram do Sienge (o estado nasce com
     `removidos: 0` e a limpeza só roda com `removidos` vazio).
   Ordem original: núcleo, cobrança, jurídico, engenharia/vistoria, financeiro, comercial/compras,
   orçamento, fiscal/contábil, marketing, servidor. Cada área ganha `js/<area>/dados-<area>.js` e é testada no preview.
4. **Arquivos, carga e virada.**
   - **Arquivos (feito no código):** bucket **privado** `arquivos` no Supabase (migration `202611201000_storage_arquivos.sql`),
     com as mesmas pastas do Firebase. Gravar/ler/apagar só usuário ATIVO (RLS em `storage.objects`).
     - O banco guarda o caminho (o mesmo de antes). A chave no bucket é `DadosBase.chaveStorage(caminho)` (sem acento;
       caractere fora do aceito pelo Supabase vira `_`). No inventário de 20/11/2026 nenhum dos 690 arquivos precisou de troca.
     - Telas: `js/nucleo/storage-supabase.js` substitui o `firebase-config.js` (apagado) e oferece as mesmas funções
       (`ref`, `uploadBytes`, `getDownloadURL`, `deleteObject`, `listAll`, `getMetadata`) em `window.firebaseCollections`.
     - Link de arquivo: `/arquivo?p=<caminho>` (`api/_lib/arquivo.js`). Confere o token do Supabase no cookie `integra_sb`
       (gravado por `supabase-client.js`, só para o caminho `/arquivo`), confere usuário ativo e redireciona para um link
       assinado de 5 minutos. O link não vence, pode ficar gravado. Até a virada, arquivo que ainda não está no Supabase
       cai no Firebase (reserva); desligar com `STORAGE_FIREBASE_RESERVA=0` depois da cópia.
     - Vistoria pública (sem login): a página pede a `/api/vistoria-publica` (`acao: "upload"`) um link de upload
       assinado, só para `vistorias/<id>/...` de vistoria aberta.
     - `sienge-upload` baixa o anexo do bucket com a service role. `/proxy-storage/...` antigo vira `/arquivo`.
   - **Ferramentas:** `copiar-storage.js` (copia Firebase → bucket; reexecutável; `--conferir` compara por pasta;
     `--reescrever` troca no banco os links antigos do Firebase por `/arquivo?p=...`) e `conferir-contagens.js`
     (linhas esperadas pelos importadores × linhas no banco, por tabela).
   - **Roteiro do ensaio** (pode repetir quantas vezes quiser; não mexe na produção atual):
     1. Variáveis na Vercel (ver abaixo) e chave JWT importada no Supabase.
     2. `node ferramentas/migracao/exportar-firestore.js` (export completo).
     3. `importar-nucleo.js`, `importar-cobranca.js`, `importar-engenharia.js`, `importar-financeiro.js` com `--export <pasta>`.
     4. `node ferramentas/migracao/copiar-storage.js --conferir --reescrever`.
     5. `node ferramentas/migracao/conferir-contagens.js --export <pasta>`: nenhuma tabela "A MENOS".
     6. Abrir o deploy da branch, entrar com a conta Microsoft e testar as telas de cada área (abrir, criar, editar,
        excluir, anexar e abrir arquivo). Rodar as rotinas à mão com o `CRON_SECRET`
        (`/api/morning-warmup`, `/api/estoque-batimento`, `/api/sync-creditors`).
   - **Virada** (janela combinada, ninguém usando o Integra antigo):
     1. Avisar a equipe e congelar a produção antiga (ex.: tirar o acesso ao crm-gestao.vercel.app ou pôr aviso).
     2. Export final, os quatro importadores, `copiar-storage.js --conferir --reescrever` e `conferir-contagens.js`.
     3. No projeto novo: `STORAGE_FIREBASE_RESERVA=0`, `GRAPH_MAIL_ENABLED` como na produção, devolver ao
        `vercel.json` os crons da main (`/api/morning-warmup` e `/api/estoque-batimento`, `0 10 * * *`).
     4. Merge da `migracao-supabase` na `main`, Production Branch do projeto novo = `main`, domínio apontado para ele.
     5. Desligar os crons e o deploy do projeto antigo; manter o Firebase só leitura por um tempo e depois desligar.
     6. Descartar o cache local antigo das notas (`crm_moura_notes`) no primeiro acesso (pendência da cobrança).

## Exportar o Firestore
```bat
npm install --ignore-scripts
node ferramentas/migracao/exportar-firestore.js --amostra 200     # inventário rápido
node ferramentas/migracao/exportar-firestore.js                   # tudo
```
Grava em `..\integra-export\<data-hora>\` (fora do Git): um `.ndjson` por coleção, `_relatorio.md` e `_relatorio.json`.

## Usuários e perfis
```bat
node ferramentas/migracao/importar-usuarios.js --export ..\integra-export\<pasta>          :: grava (service role)
node ferramentas/migracao/importar-usuarios.js --export ..\integra-export\<pasta> --sql usuarios.sql
```
Lê `config/crm_users` e `config/global` (`crm_moura_profiles`, `crm_perms_<id>`). Pode rodar de novo: atualiza
pelo id antigo. A primeira carga (só nome, e-mail, perfil, status e gestor; sem telefone, documentos e permissões)
foi feita em 19/11/2026; a carga completa entra na Fase 4.

## Variáveis de ambiente (projeto novo na Vercel)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (servidor) — a service role (ou a secret key `sb_secret_...`) fica em
  Supabase → Project Settings → API Keys.
- `SUPABASE_JWT_PRIVATE_KEY`: chave ES256 que assina os tokens do `/api/supabase-token`.
  1. `node ferramentas/migracao/gerar-chave-jwt.js` grava `..\integra-export\chave-jwt-supabase.json`.
  2. Supabase → Project Settings → JWT Keys → Create standby key → Import a private key: colar o arquivo.
     Depois **Rotate keys** (a chave importada passa a ser a usada; tokens antigos continuam valendo).
  3. Vercel → integra → Environment Variables: `SUPABASE_JWT_PRIVATE_KEY` = conteúdo do arquivo. Guardar o arquivo
     num cofre e apagar da pasta.
  Alternativa provisória: `SUPABASE_JWT_SECRET` com o Legacy JWT secret (HS256), enquanto ele não for revogado.
- As mesmas do projeto atual: `SIENGE_API_USER`, `SIENGE_API_PASSWORD`, `CRON_SECRET`, `WARMUP_SECRET`, `WARMUP_BASE_URL`,
  `CLICKSIGN_ACCESS_TOKEN`, `CLICKSIGN_HOST`, `CVCRM_EMAIL`, `CVCRM_HOST`, `CVCRM_TOKEN`, `SCOD_API_TOKEN`, `SCOD_HOST`,
  `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_MAILBOX`, `GRAPH_MAIL_ENABLED`, `GRAPH_TENANT_ID`, `PROXY_AUTH_MODE`,
  `GITHUB_PUBLICAR_TOKEN`, `PRESTACAO_CONTAS_DIR`.
  Até a virada, deixar `GRAPH_MAIL_ENABLED` desligado no projeto novo para não mandar e-mail em dobro.
- `STORAGE_FIREBASE_RESERVA`: vazio até a virada (arquivo não copiado abre no Firebase); `0` depois da cópia final.
