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
  const currency = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'});
  const unitPrice = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL', maximumFractionDigits: 4});
  const quantity = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 4});
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
      items.sort((a, b) => codes.compare(a.wbsCode ?? '', b.wbsCode ?? ''));
      const rows = document.createDocumentFragment();
      for (const item of items) {
        const row = document.createElement('tr');
        const code = item.wbsCode ?? '';
        const values = [code || '—', item.description, item.unitOfMeasure,
          numberLabel(item.quantity, quantity), numberLabel(item.unitPrice, unitPrice),
          numberLabel(item.totalPrice, currency)];
        for (const value of values) row.insertCell().textContent = value || '—';
        const depth = code.split('.').filter(part => Number(part) > 0).length;
        row.cells[1].style.paddingInlineStart = (1.25 + Math.max(0, depth - 1) * 0.75) + 'rem';
        rows.append(row);
      }
      body.append(rows);
      table.hidden = items.length === 0;
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
