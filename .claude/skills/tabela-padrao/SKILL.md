---
name: tabela-padrao
description: Padrão visual obrigatório para TODA tabela, lista em linhas ou planilha na tela do Integra (CRM projeto-cobranca), igual à tabela da tela Centros de Custo — cabeçalho verde fixo, linhas alternadas, destaque ao passar o mouse, linha clicável e linha em alerta. Use sempre que criar, refazer ou mexer no visual de uma tabela/lista (ex.: "Financiamentos em aberto", templates da Central de e-mail, filas, relatórios na tela), inclusive quando o pedido for só "deixe no padrão".
---

# Tabela padrão do Integra (layout da tela Centros de Custo)

Toda tabela do Integra segue o layout da tabela de **Centros de Custo** (`js/financeiro/centros-custo.js`). O CSS é global em `css/style.css` (procure `.cc-scroll {` e `.cc-table {`). **Reutilize essas classes — não crie cores, cabeçalhos, zebra nem hover próprios, nem estilos inline de cor/padding nas `td`.**

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
      <tr><td>1</td><td title="Texto completo">…</td><td class="is-right">R$ 1.000,00</td></tr>
    </tbody>
  </table>
</div>
```

- Envolva sempre em `<div class="cc-scroll">`: borda `#e2e8f0`, cantos de 8px, fundo branco, rolagem com altura máxima. Dentro de um card que já tem borda, pode ajustar só `max-height`, `border:0` e `border-radius` no próprio `div`.
- `table.cc-table` + uma classe própria da tela (ex.: `fin-abertos-table`) **só** para larguras de coluna e ajustes pontuais.
- Sempre um `<colgroup>` com a largura das colunas curtas; a coluna de texto principal fica sem largura (ocupa o resto).
- Alinhamento: `class="is-right"` para valores/números, `class="is-center"` para colunas curtas (título, datas, status).
- Texto que pode ser cortado com reticências: coloque o texto completo em `title="..."`.

## O padrão (não alterar)

| Item | Valor |
|---|---|
| Cabeçalho | fundo `#1b8253`, texto branco, negrito, `position: sticky; top: 0` |
| Fonte | `0.72rem`, `table-layout: fixed`, `border-collapse: collapse` |
| Célula | `padding: 4px 6px`, borda inferior `1px solid #e8eee9`, texto `#1c2e24`, uma linha com reticências |
| Linhas alternadas | `tbody tr:nth-child(even)` com fundo `#f7faf8` |
| Passar o mouse | `tbody tr:hover` com fundo `#e7f6ee` e texto `#0f3d27` |

## Variações prontas (classes globais)

| Caso | Como fazer |
|---|---|
| Linha que abre algo ao clicar | `<tr class="is-clicavel" tabindex="0" role="button" onclick="..." onkeydown="Enter/Espaço">` |
| Linha em alerta (vencida, atrasada, erro) | acrescente `is-alerta` no `tr`: fundo `#fef2f2`, texto `#991b1b`, barra vermelha à esquerda; hover `#fee2e2` |
| Selo dentro da célula ("VENCIDA", "ATRASADO") | `<span class="cc-selo-alerta">VENCIDA</span>` |
| Lista de leitura (filas, processos, templates), linhas mais altas | `<table class="cc-table is-confortavel ...">`: fonte `0.78rem`, padding `9px 10px`. O padrão compacto fica para planilhas com muitas colunas e números |
| Sem rolagem horizontal | ajuste o `colgroup` (larguras em % e colunas curtas em px) e, se preciso, `overflow-x: hidden` no `.cc-scroll` da tela; e-mails/textos longos quebram com `overflow-wrap: anywhere` |
| Linha de grupo/subtotal | fundo `#e7f6ee`, texto `#105436`, negrito (mesmo padrão de `tr.docs-obra`) |
| Total geral | fundo `#105436`, texto branco, negrito |

Exemplo em uso: "Financiamentos em aberto" (`js/cobranca/financiamento.js`, `fin-abertos-table`) e as tabelas da Central de e-mail (`js/nucleo/central-email.js`).

## Regras

1. Não defina outra cor de cabeçalho, zebra ou hover. Se a tela tiver CSS antigo (`crm-table` com estilo inline, `cxd-analitico`, `orc-…`, `cem-tabela` antiga etc.), troque pela `cc-table` e apague o CSS que ficou sem uso.
2. Não use `onmouseover`/`onmouseout` para pintar linha nem `style="padding:..;color:.."` em cada `td`: o padrão já faz isso.
3. Texto longo que precisa quebrar: classe na `td` com `white-space: normal; overflow: visible; text-overflow: clip` (como `td.cc-nome` ou `td.cem-para`).
4. Coluna de ações com botões: `td` com `overflow: visible` e largura fixa no `colgroup`.
5. Botão "Atualizar" da tela: `btn btn-primary cc-atualizar` com ícone `refresh-cw`. Exportar: `btn btn-excel` com ícone `download`.
6. Tabela vazia: uma linha `<td colspan="N" style="text-align:center;padding:30px;white-space:normal;">Nenhum … para exibir.</td>`.
7. Valores em reais alinhados à direita, com `font-variant-numeric: tabular-nums` quando houver colunas de soma.
8. Ao mudar CSS ou JS, troque o `?v=` do arquivo no `index.html`.
