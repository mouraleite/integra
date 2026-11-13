---
name: tabela-padrao
description: Padrão visual obrigatório para qualquer tabela nova (ou refeita) no CRM projeto-cobranca, igual à tabela da tela Centros de Custo — cabeçalho verde fixo, linhas alternadas, destaque ao passar o mouse. Use sempre que for criar ou redesenhar uma tabela/planilha na tela.
---

# Tabela padrão do CRM (layout da tela Centros de Custo)

Toda tabela nova do CRM segue o layout da tabela de **Centros de Custo** (`js/financeiro/centros-custo.js`). O CSS já existe e é global em `css/style.css` (classes `.cc-scroll` e `.cc-table`, perto da linha 10797). **Reutilize essas classes — não recrie cores nem estilos próprios.**

## Estrutura

```html
<div class="cc-scroll">
  <table class="cc-table minha-tela-table">
    <colgroup>
      <col style="width:60px"><col><col style="width:120px">
    </colgroup>
    <thead>
      <tr><th>Emp.</th><th>Descrição</th><th class="is-right">Valor</th></tr>
    </thead>
    <tbody>
      <tr><td>1</td><td>…</td><td class="is-right">R$ 1.000,00</td></tr>
    </tbody>
  </table>
</div>
```

- Envolva sempre em `<div class="cc-scroll">`: borda `#e2e8f0`, cantos de 8px, fundo branco, rolagem com altura máxima.
- `table.cc-table` + uma classe própria da tela (ex.: `cxd-vr-table`) **só** para larguras de coluna e ajustes pontuais.
- Alinhamento: `class="is-right"` para valores/números, `class="is-center"` para colunas curtas centralizadas.

## O padrão (não alterar)

| Item | Valor |
|---|---|
| Cabeçalho | fundo `#1b8253`, texto branco, negrito, `position: sticky; top: 0` |
| Fonte | `0.72rem`, `table-layout: fixed`, `border-collapse: collapse` |
| Célula | `padding: 4px 6px`, borda inferior `1px solid #e8eee9`, texto `#1c2e24`, uma linha com reticências |
| Linhas alternadas | `tbody tr:nth-child(even)` com fundo `#f7faf8` |
| Passar o mouse | `tbody tr:hover` com fundo `#e7f6ee` e texto `#0f3d27` |

## Regras

1. Não defina outra cor de cabeçalho, zebra ou hover na tabela nova. Se a tela tiver CSS antigo (`cxd-analitico`, `orc-…` etc.), troque pela `cc-table`.
2. Linhas de grupo/subtotal: fundo `#e7f6ee`, texto `#105436`, negrito (mesmo padrão de `tr.docs-obra`). Total geral: fundo `#105436`, texto branco, negrito.
3. Texto longo que precisa quebrar: adicione uma classe na `td` com `white-space: normal` (como `td.cc-nome`).
4. Botão "Atualizar" da tela: `btn btn-primary cc-atualizar` com ícone `refresh-cw`. Exportar: `btn btn-excel` com ícone `download`.
5. Tabela vazia: uma linha `<td colspan="N" style="text-align:center;padding:30px;">Nenhum … para exibir.</td>`.
6. Valores em reais alinhados à direita, com `font-variant-numeric: tabular-nums` quando houver colunas de soma.
