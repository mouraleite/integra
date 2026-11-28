# Mapa Firestore → tabelas do Supabase (Fase 2)

Regras: `supabase/CONVENCOES.md`. Um mapa por área, com campo → coluna, decisões e notas do importador:

| Área | Migration | Mapa |
|---|---|---|
| Núcleo, sistema e configuração | `202611191300_nucleo.sql` | [nucleo.md](nucleo.md) |
| Cobrança, clientes, jurídico | `202611191310_cobranca_juridico.sql` | [cobranca-juridico.md](cobranca-juridico.md) |
| Engenharia, vistoria, comercial, orçamento | `202611191320_engenharia_comercial.sql` | [engenharia-comercial.md](engenharia-comercial.md) |
| Financeiro, fiscal, contábil, marketing | `202611191330_financeiro_fiscal_marketing.sql` | [financeiro-fiscal-marketing.md](financeiro-fiscal-marketing.md) |

## Decisões para revisar antes da Fase 3

### Permissões que passam a valer de verdade
Hoje a tela só confere a chave `_acessar`. Com as regras do banco, **gravar** passa a exigir a chave `_editar`
nestes pontos. Quem só tem `_acessar` vai receber erro ao salvar:
- orçamento, forecast e tabelas vigentes (engenharia/comercial);
- registro (`sub_rel_geral_registro_editar`);
- resultado de caixa (upload de arquivos locais).
Antes da virada é preciso conferir os perfis ou afrouxar essas regras.

### Regras abertas a qualquer usuário ativo (por necessidade, como hoje)
- Leitura e escrita para qualquer usuário ativo:
  - `configuracoes`, porque muitas telas gravam chaves diferentes;
  - notas de cobrança e jurídicas, custas, NEX, renegociação e documentos de assinatura;
  - `vistorias`, `construction_checks`, `estoque_comercial`, `caixa_posicao` e `caixa_movimentos`.
- Os caches preenchidos ao abrir a tela (`cfin_pagos`, `dfc_realizado`, valor a receber, Rydoo, marketing) podem ser
  gravados por quem vê a tela.

### Fora do padrão
- **Link público da vistoria** (`vistoria.html`): o cliente envia fotos sem login. O banco não tem acesso anônimo.
  Proposta: uma rota do servidor que gera upload assinado e chama `enviar_vistoria` com a service role.
- **Agenda pessoal:** o dono vem do nome no prefixo do id. O importador procura esse nome em `usuarios.sienge_user`
  e depois em `usuarios.nome`. Nota sem dono resolvido só o administrador vê.
- **Chaves de `config/global` que são registros de negócio** foram por enquanto para `configuracoes`. Podem virar
  tabelas da área depois:
  - cobrança: `crm_moura_financiamentos_proc` e `crm_compromissario_cessao_v1`;
  - engenharia: `crm_engenharia_caucao_*`;
  - financeiro: `gp_conferencia` e `ctb_equiv`;
  - jurídico: `subjudice_integra` e `reintegracao_posse`.
- `sienge_creditors`: as flags 'S'/'N' viram boolean, e `sync-creditors` e `rydoo.js` precisam se adaptar na Fase 3.
- Dinheiro em `numeric(15,2)`: valores gravados como float são arredondados para centavos na carga.

### Volume e retenção
- `caixa_posicao`: cerca de 2.900 linhas por dia e nenhuma limpeza definida.
- Histórico de inadimplência (`sienge_defaulters_history`): cache regenerável. Falta definir quantos dias importar.

### Dados de teste
- Notas com o texto "TESTE" e os boletos de teste do título 4868: importar ou descartar?

### Arquivos (Storage)
- As colunas novas guardam o **caminho** do arquivo (`vistorias/<id>/...`, `construcoes/<cliente>/...`), não a URL do
  Firebase. Anexos e PDFs de cobrança, fiscal e Rydoo ainda guardam URL do Firebase, e o `copiar-storage.js` da Fase 4
  reescreve esses campos.
