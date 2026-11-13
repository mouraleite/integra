---
name: filtros-padrao
description: Padrão obrigatório de filtros e barras de ação no CRM projeto-cobranca — seleção única (empresa, empreendimento, centro de custo) com MlSelectUnico, seleção múltipla com MlEmpresaFilter, e botões/campos da mesma linha sempre com a mesma altura. Use sempre que criar ou refazer um filtro, um seletor de empresa/empreendimento ou uma linha de botões numa tela.
---

# Filtros e barras de ação do CRM

## 1. Botões e campos na mesma linha: mesma altura

Tudo que fica lado a lado numa barra (botões, campos, selects, datas) tem **40px de altura**.

```css
.minha-barra .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px;
  height:40px; box-sizing:border-box; padding:0 16px; margin:0; line-height:1; white-space:nowrap; }
.minha-barra .btn svg { width:16px; height:16px; flex-shrink:0; }   /* ícone grande estica o botão */
.minha-barra input, .minha-barra select { height:40px; box-sizing:border-box; }
```

- Alinhe a linha com `align-items:flex-end` quando os campos tiverem rótulo em cima.
- `.cc-atualizar` tem 36px; dentro de uma barra com outros controles, sobrescreva para 40px.

## 2. Seleção única de empresa, empreendimento ou centro de custo: `MlSelectUnico`

Visual do campo "Centro de Custo (Empreendimento)" do Assistente de Anexos: busca + botão de seta + lista com **ID em destaque verde** e o **nome completo**. Arquivo: `js/nucleo/ml-select-unico.js` (carregado no `index.html`).

```js
// no render():
const html = MlSelectUnico.html({
  id: "minha-emp",                 // único na página
  label: "Empresa",
  items: lista.map((e) => ({ id: String(e.id), label: e.name })),   // ordene por ID
  selectedId: this.empresaId,      // ou "TODAS"
  todos: { id: "TODAS", label: "Todas as empresas" },  // opcional
  largura: "420px"                 // opcional
});
// depois de colocar o html no DOM:
MlSelectUnico.bind("minha-emp", { onSelect: (id) => { this.empresaId = id; this.carregar(); } });
```

- **Nunca quebrar o nome** da empresa/empreendimento: a lista cresce na largura (`width:max-content`) e as linhas usam `white-space:nowrap`. Não use `<select>` simples para empresa/empreendimento.
- Digitar filtra por ID ou nome; setas e Enter funcionam; Esc fecha.

## 3. Seleção múltipla: `MlEmpresaFilter` (padrão "Filtros avançados")

Botão com o resumo ("Todos", "3 empresas"), lista com busca, **Marcar Todos** (verde) e **Desmarcar Todos** (laranja), itens "ID - NOME" com caixa de marcar. Arquivo: `js/nucleo/empresa-filter.js`.

```js
const html = MlEmpresaFilter.html({
  id: "minha-emp-multi", label: "Empresas",
  items: lista.map((e) => ({ id: String(e.id), label: e.id + " - " + e.name.toUpperCase() })),
  selectedIds: this.ids, open: this.aberto, query: this.busca, emptyMeansAll: false
});
MlEmpresaFilter.bind("minha-emp-multi", {
  toggleOpen: () => { this.aberto = !this.aberto; this.render(); },
  setQuery: (q) => { this.busca = q; this.render(); },
  toggleId: (id, on) => { /* inclui/remove id */ },
  selectAll: () => { /* todos */ },
  selectNone: () => { /* nenhum */ }
});
```

## Exemplos no código
- Seleção única: `js/financeiro/mutuo.js` (filtro Empresa).
- Seleção múltipla: `js/financeiro/caixa-diario.js`, `js/financeiro/centros-custo.js`, `js/compras/compras-previsoes.js`.
