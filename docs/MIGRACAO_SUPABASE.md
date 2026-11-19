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
1. **Login e segurança:** `/api/supabase-token` valida o token Microsoft (`lib/integra-auth.js`) e emite um JWT do
   Supabase de curta duração. RLS ligada em todas as tabelas, com políticas por perfil (`usuarios`, `permissoes`).
2. **Tabelas relacionais**, desenhadas a partir do relatório do export: uma tabela por coleção, colunas tipadas para o
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

## Variáveis de ambiente (projeto novo na Vercel)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (servidor) — a service role fica em Supabase → Project Settings → API Keys.
- As mesmas do projeto atual: `SIENGE_API_USER`, `SIENGE_API_PASSWORD`, `CRON_SECRET`, `WARMUP_SECRET`, `WARMUP_BASE_URL`,
  `CLICKSIGN_ACCESS_TOKEN`, `CLICKSIGN_HOST`, `CVCRM_EMAIL`, `CVCRM_HOST`, `CVCRM_TOKEN`, `SCOD_API_TOKEN`, `SCOD_HOST`,
  `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_MAILBOX`, `GRAPH_MAIL_ENABLED`, `GRAPH_TENANT_ID`, `PROXY_AUTH_MODE`,
  `GITHUB_PUBLICAR_TOKEN`, `PRESTACAO_CONTAS_DIR`.
  Enquanto a branch ainda usa o Firebase, deixar `GRAPH_MAIL_ENABLED` desligado no projeto novo para não mandar e-mail em dobro.
