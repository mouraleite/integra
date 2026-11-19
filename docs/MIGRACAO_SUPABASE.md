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
3. **Código por área**, nesta ordem: núcleo, cobrança, jurídico, engenharia/vistoria, financeiro, comercial/compras,
   orçamento, fiscal/contábil, marketing, servidor. Cada área ganha `js/<area>/dados-<area>.js` e é testada no preview.
4. **Carga e virada:** `importar-supabase.js` e `copiar-storage.js` (reexecutáveis), ensaio com conferência de contagens,
   congelamento do Firebase, carga final, crons ligados, domínio apontado, merge na `main`.

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
  Enquanto a branch ainda usa o Firebase, deixar `GRAPH_MAIL_ENABLED` desligado no projeto novo para não mandar e-mail em dobro.
