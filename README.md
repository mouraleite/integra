# Integra · Moura Leite

Sistema de gestão da Moura Leite (cobrança, jurídico, comercial, financeiro, orçamento, fiscal, contábil, engenharia e marketing).
Produção: https://crm-gestao.vercel.app · Publicação: `deploy.bat` (ver `docs/README_DEPLOY.md`).

## Pastas

| Pasta | O que tem |
|---|---|
| `index.html` | A página do sistema (todas as telas). Carrega os scripts de `js/`. |
| `vistoria.html` | Página avulsa da vistoria de construção. |
| `js/nucleo/` | Base do sistema: `app.js`, login, Firebase, Sienge, usuários, filtros padrão, home, avisos. |
| `js/cobranca/` | Ficha do cliente, relacionamento, repactuações, inadimplência, alçadas, anexos, documentos. |
| `js/juridico/` | Processos, reintegração de posse, custas judiciais, fluxos do jurídico. |
| `js/comercial/` | Estoque comercial, tabelas vigentes, comissões, Webro. |
| `js/financeiro/` | Contas a pagar, gerar pagamento, caixa, fluxo de caixa, centros de custo, plano financeiro, reembolsos, mútuo, investimentos. |
| `js/orcamento/` | Orçamento, DFC, forecast e estimativas. |
| `js/fiscal/` | Notas fiscais e CND. |
| `js/contabil/` | Contábil, equivalências, de-para e societário. |
| `js/compras/` | Previsões, controle financeiro e painel de compras. |
| `js/marketing/` | Eventos e budget de marketing. |
| `js/engenharia/` | Construção, vistoria, caução, custo e acompanhamento de obra. |
| `css/` | `style.css` (estilo de todas as telas). |
| `assets/` | Imagens e arquivos estáticos: `marca/`, `integra/`, `pets/`, `selo/`, `modelos/`, `assinaturas-rydoo/`. |
| `api/` | Funções do servidor na Vercel (proxy do Sienge, rotinas diárias, e-mail etc.). |
| `lib/` | Código compartilhado pelas funções do servidor. |
| `ferramentas/` | Script de versão do deploy, robô do Sienge (`robo-pacote/`), servidor local (`servidor-local/`) e scripts avulsos. |
| `docs/` | Documentação (deploy). |
| `arquivo/` | Material antigo e de referência. Não é publicado. |

## Como as telas carregam

- Os scripts do núcleo e das telas mais usadas carregam na abertura (`<script defer>` no `index.html`).
- Telas grandes e de uso restrito (orçamento, marketing, mútuo, participações, contas a pagar, auditoria do login,
  consumo de API, repactuação em lote, custo e acompanhamento de obra) só baixam o código quando abertas.
  Elas aparecem no `index.html` como `<script type="text/x-sob-demanda" data-grupo="...">`, e o mapa
  tela → grupo fica em `js/nucleo/app.js`, logo antes de `switchTab`.
- Cada arquivo tem `?v=` com um código do próprio conteúdo, gerado pelo `deploy.bat`.
  Arquivo que não mudou não é baixado de novo.

## Arquivo novo

1. Coloque o arquivo na pasta da área (`js/<area>/`).
2. Inclua no `index.html` junto dos outros: `<script defer src="js/<area>/arquivo.js?v=1"></script>`.
3. O `deploy.bat` atualiza o `?v=` sozinho.
