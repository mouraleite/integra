(() => {
  const obra = document.getElementById('projetos-planejamento-obra');
  const planningButton = document.getElementById('projetos-aprovacao-abrir-planejamento');
  const budgetButton = document.getElementById('projetos-aprovacao-abrir-orcamento');
  const planning = document.getElementById('projetos-aprovacao-planejamento');
  const budget = document.getElementById('projetos-aprovacao-orcamento');
  const consultar = document.getElementById('projetos-orcamento-consultar');
  const sheets = document.getElementById('projetos-orcamento-planilha');
  const status = document.getElementById('projetos-orcamento-status');
  const table = document.getElementById('projetos-orcamento-tabela');
  const body = table.querySelector('tbody');
  const dashboard = document.getElementById('projetos-orcamento-resumo');
  const budgetTotal = document.getElementById('projetos-orcamento-total');
  const tableTotal = document.getElementById('projetos-orcamento-total-tabela');
  const chart = document.getElementById('projetos-orcamento-grafico');
  const clearStage = document.getElementById('projetos-orcamento-limpar-etapa');
  let activeStage = null;
  const currency = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'});
  const codes = new Intl.Collator('pt-BR', {numeric: true});
  let request = 0;

  function showBudget(active) {
    planningButton.classList.toggle('btn-primary', !active);
    planningButton.classList.toggle('btn-secondary', active);
    budgetButton.classList.toggle('btn-primary', active);
    budgetButton.classList.toggle('btn-secondary', !active);
    planning.hidden = active;
    budget.hidden = !active;
    planningButton.setAttribute('aria-pressed', String(!active));
    budgetButton.setAttribute('aria-pressed', String(active));
    if (active && !obra.value) status.textContent = 'Selecione uma obra para consultar o orçamento.';
  }

  function clearItems() {
    table.hidden = true;
    dashboard.hidden = true;
    activeStage = null;
    clearStage.hidden = true;
    chart.replaceChildren();
    body.replaceChildren();
  }

  function setError(error, subject) {
    console.error('Falha ao consultar ' + subject + ' do orçamento', error);
    const cause = error.status ? ' (HTTP ' + error.status + ')' : '';
    status.textContent = 'Não foi possível consultar ' + subject + ' no Sienge' + cause + '.';
  }

  function numberLabel(value, formatter) {
    return Number.isFinite(value) ? formatter.format(value) : '—';
  }

  function buildStructure(items) {
    const groups = new Map();
    const roots = [];
    for (const item of items) {
      const code = String(item.wbsCode ?? '').trim();
      const parts = code.split('.');
      while (parts.length > 1 && /^0+$/.test(parts.at(-1))) parts.pop();
      if (!parts[0]) {
        roots.push({code: '', item, children: [], total: item.totalPrice});
        continue;
      }
      let parent = null;
      for (let depth = 1; depth <= parts.length; depth++) {
        const key = parts.slice(0, depth).join('.');
        let group = groups.get(key);
        if (!group) {
          group = {code: key, parent, children: []};
          groups.set(key, group);
          (parent ? parent.children : roots).push(group);
        }
        parent = group;
      }
      parent.item = item;
    }

    function totalize(siblings) {
      siblings.sort((a, b) => codes.compare(a.code, b.code));
      let total = null;
      for (const node of siblings) {
        const childrenTotal = totalize(node.children);
        node.total = childrenTotal ?? node.item?.totalPrice;
        if (Number.isFinite(node.total)) total = (total ?? 0) + node.total;
      }
      return total;
    }
    return {roots, total: totalize(roots)};
  }

  function renderBudget(items) {
    const {roots, total} = buildStructure(items);
    budgetTotal.textContent = numberLabel(total, currency);
    tableTotal.textContent = budgetTotal.textContent;
    const stages = roots.flatMap(root => root.children.length ? root.children : [root]);
    const max = Math.max(0, ...stages.map(stage => stage.total ?? 0));
    const stageButtons = new Map();
    const entries = [];

    function updateVisibility() {
      for (const entry of entries) {
        const included = !activeStage || entry.node === activeStage
          || entry.ancestors.includes(activeStage)
          || entriesByNode.get(activeStage)?.ancestors.includes(entry.node);
        entry.row.hidden = !included || entry.ancestors.some(node => !entriesByNode.get(node).expanded);
      }
      for (const [node, button] of stageButtons) button.setAttribute('aria-pressed', String(activeStage === node));
      clearStage.hidden = !activeStage;
    }

    function addRows(nodes, ancestors = []) {
      for (const node of nodes) {
        const row = document.createElement('tr');
        const entry = {node, row, ancestors, expanded: ancestors.length === 0};
        entries.push(entry);
        const label = row.insertCell();
        label.style.paddingInlineStart = (0.75 + ancestors.length * 1) + 'rem';
        const name = node.item?.description || node.code;
        if (node.children.length) {
          row.className = 'orcamento-grupo';
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'planejamento-gantt-toggle';
          function setExpanded(expanded) {
            entry.expanded = expanded;
            button.textContent = expanded ? '−' : '+';
            button.setAttribute('aria-expanded', String(expanded));
            button.setAttribute('aria-label', (expanded ? 'Recolher ' : 'Expandir ') + name);
          }
          entry.setExpanded = setExpanded;
          setExpanded(entry.expanded);
          button.addEventListener('click', () => {
            setExpanded(!entry.expanded);
            updateVisibility();
          });
          label.append(button);
        }
        const text = document.createElement('span');
        text.textContent = [node.code, node.item?.description].filter(Boolean).join(' · ') || '—';
        label.append(text);
        for (let col = 1; col < 10; col++) {
          row.insertCell().textContent = col === 2 ? numberLabel(node.total, currency) : '—';
        }
        body.append(row);
        addRows(node.children, [...ancestors, node]);
      }
    }
    addRows(roots);
    const entriesByNode = new Map(entries.map(entry => [entry.node, entry]));
    for (const stage of stages) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'orcamento-barra-etapa';
      const name = document.createElement('span');
      name.textContent = stage.item?.description || stage.code || 'Sem código';
      const value = document.createElement('strong');
      value.textContent = numberLabel(stage.total, currency);
      const track = document.createElement('span');
      track.className = 'orcamento-barra-faixa';
      const bar = document.createElement('span');
      bar.style.inlineSize = (max > 0 ? Math.max(0, stage.total ?? 0) / max * 100 : 0) + '%';
      track.append(bar);
      button.append(name, track, value);
      button.addEventListener('click', () => {
        activeStage = activeStage === stage ? null : stage;
        if (activeStage) {
          const entry = entriesByNode.get(stage);
          for (const node of [...entry.ancestors, stage]) entriesByNode.get(node).setExpanded?.(true);
        }
        updateVisibility();
      });
      stageButtons.set(stage, button);
      chart.append(button);
    }

    clearStage.onclick = () => {
      activeStage = null;
      updateVisibility();
    };
    updateVisibility();
    dashboard.hidden = false;
    table.hidden = false;
  }

  async function loadItems() {
    if (!obra.value || !window.hasCrmPerm('mod_projetos')) return;
    const id = ++request;
    clearItems();
    if (!sheets.value) {
      status.textContent = 'Selecione uma planilha de orçamento.';
      return;
    }
    status.textContent = 'Consultando itens do orçamento…';
    try {
      const items = await window.SiengeApiService.getBuildingBudgetItems(obra.value, sheets.value);
      if (id !== request || !window.hasCrmPerm('mod_projetos')) return;
      if (items.length) renderBudget(items);
      status.textContent = items.length
        ? items.length + (items.length === 1 ? ' item encontrado.' : ' itens encontrados.')
        : 'A planilha selecionada não tem itens.';
    } catch (error) {
      if (id === request) setError(error, 'os itens do orçamento');
    }
  }

  planningButton.addEventListener('click', () => showBudget(false));
  budgetButton.addEventListener('click', () => showBudget(true));
  obra.addEventListener('change', () => {
    request += 1;
    consultar.disabled = !obra.value;
    sheets.options.length = 1;
    sheets.disabled = true;
    clearItems();
    status.textContent = obra.value ? '' : 'Selecione uma obra para consultar o orçamento.';
  });
  consultar.addEventListener('click', async () => {
    if (!obra.value || !window.hasCrmPerm('mod_projetos')) return;
    const id = ++request;
    consultar.disabled = true;
    sheets.options.length = 1;
    sheets.disabled = true;
    clearItems();
    status.textContent = 'Consultando planilhas do orçamento…';
    try {
      const result = await window.SiengeApiService.getBuildingBudgetSheets(obra.value);
      if (id !== request || !window.hasCrmPerm('mod_projetos')) return;
      for (const sheet of result) {
        sheets.add(new Option(sheet.description ? sheet.id + ' — ' + sheet.description : String(sheet.id), String(sheet.id)));
      }
      sheets.disabled = result.length === 0;
      status.textContent = result.length ? 'Selecione uma planilha de orçamento.' : 'Nenhuma planilha de orçamento encontrada.';
      if (result.length === 1) {
        sheets.selectedIndex = 1;
        consultar.disabled = false;
        await loadItems();
      }
    } catch (error) {
      if (id === request) setError(error, 'as planilhas do orçamento');
    } finally {
      if (id === request) consultar.disabled = false;
    }
  });
  sheets.addEventListener('change', loadItems);
})();
