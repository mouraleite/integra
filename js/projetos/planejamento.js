(() => {
  const dateLabel = value => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return parts ? [parts[3], parts[2], parts[1]].join('/') : '—';
  };

  const dayMs = 86400000;
  const todayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const monthFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const percentageFormat = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });

  const form = document.getElementById('projetos-planejamento-filtro');
  const obra = document.getElementById('projetos-planejamento-obra');
  const button = form.querySelector('button');
  const status = document.getElementById('projetos-planejamento-status');
  const table = document.getElementById('projetos-planejamento-lista');
  const body = table.querySelector('tbody');
  const hierarchy = document.getElementById('projetos-planejamento-hierarquia');
  let taskRows = [];

  function atualizarHierarquia() {
    for (const entry of taskRows) {
      const { row, parent, toggle, expanded } = entry;
      row.hidden = Boolean(parent && (parent.row.hidden || !parent.expanded));
      if (toggle) {
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', (expanded ? 'Recolher ' : 'Expandir ') + entry.description);
        toggle.textContent = expanded ? '▾' : '▸';
      }
    }
  }

  for (const control of hierarchy.querySelectorAll('button')) {
    control.addEventListener('click', () => {
      const expanded = control.dataset.expand === 'true';
      for (const entry of taskRows) entry.expanded = expanded;
      atualizarHierarquia();
    });
  }
  let obrasCarregadas = false;
  let carregandoObras = false;
  let consulta = 0;

  function limparConsulta() {
    consulta += 1;
    button.disabled = !obrasCarregadas;
    table.hidden = true;
    body.replaceChildren();
    taskRows = [];
    hierarchy.hidden = true;
    status.textContent = '';
  }

  window.iniciarPlanejamentoProjetos = async function () {
    if (obrasCarregadas || carregandoObras) return;

    carregandoObras = true;
    status.textContent = 'Carregando obras do Landbank…';
    try {
      const { collection, getDocs } = window.firebaseCollections;
      const snapshot = await getDocs(collection(window.firebaseDb, 'landbank'));
      const obras = new Map();
      for (const doc of snapshot.docs) {
        const { idSienge, nomeSienge, nomeAprovacao, status: landbankStatus } = doc.data();
        const etapa = String(landbankStatus ?? '').split('|').at(-1).trim().replace(/^\d+(?:\.\d+)*\.?\s+/, '');
        if (etapa.localeCompare('Aprovação', 'pt-BR', { sensitivity: 'base' }) !== 0) continue;
        if (Number.isSafeInteger(idSienge) && idSienge > 0 && !obras.has(idSienge)) {
          obras.set(idSienge, nomeSienge || nomeAprovacao || '');
        }
      }
      for (const [id, nome] of [...obras].sort(([a], [b]) => a - b)) {
        obra.add(new Option(nome ? id + ' — ' + nome : String(id), String(id)));
      }
      obrasCarregadas = obras.size > 0;
      obra.disabled = !obrasCarregadas;
      limparConsulta();
      if (!obrasCarregadas) status.textContent = 'Nenhuma obra em Aprovação com ID Sienge encontrada no Landbank.';
    } catch (error) {
      console.error('Falha ao carregar obras do Landbank', error);
      status.textContent = 'Não foi possível carregar as obras. Abra Aprovação novamente para tentar de novo.';
    } finally {
      carregandoObras = false;
    }
  };

  obra.addEventListener('change', limparConsulta);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!window.hasCrmPerm('mod_projetos')) return;
    limparConsulta();
    const current = consulta;
    const buildingId = obra.value;
    button.disabled = true;
    status.textContent = 'Consultando o planejamento no Sienge…';
    try {
      const tasks = await window.SiengeApiService.getBuildingPlanningTasks(buildingId, '01');
      if (current !== consulta || !window.hasCrmPerm('mod_projetos')) return;
      let measurements = null;
      let measurementError = null;
      if (tasks.length) {
        status.textContent = 'Consultando as medições no Sienge…';
        try {
          const result = await window.SiengeApiService.getBuildingPlanningMeasurements(
            buildingId, '01', tasks.map(task => task.id)
          );
          measurements = result.measured;
          measurementError = result.itemError;
        } catch (error) {
          measurementError = error;
        }
      }
      if (current !== consulta || !window.hasCrmPerm('mod_projetos')) return;
      const today = Date.parse(todayFormat.format(new Date()));
      tasks.sort((a, b) => a.presentationId - b.presentationId);
      const rows = document.createDocumentFragment();
      const ancestors = [];
      for (const task of tasks) {
        const level = Number.isSafeInteger(task.level) && task.level > 0 ? task.level : 1;
        while (ancestors.length && ancestors.at(-1).level >= level) ancestors.pop();
        const parent = ancestors.at(-1);
        const row = document.createElement('tr');
        const start = Date.parse(task.startDate);
        const finish = Date.parse(task.finishDate);
        const days = Number.isFinite(start) && finish >= start ? (finish - start) / dayMs + 1 : null;
        const recorded = measurements?.get(String(task.id));
        const measured = recorded ?? (measurements && !measurementError && !task.summary ? 0 : null);
        const elapsedDays = (today - start) / dayMs;
        const overdue = days === null || measured === null
          ? null
          : measured >= 100 ? 0 : Math.max(0, Math.floor(elapsedDays - days * Math.max(0, measured) / 100));
        const values = [task.presentationId, task.description, dateLabel(task.startDate),
          dateLabel(task.finishDate), task.duration, days, days === null ? null : monthFormat.format(days / 30.4375),
          overdue, measured === null ? null : percentageFormat.format(measured / 100)];
        for (const value of values) row.insertCell().textContent = value ?? '—';
        const description = row.cells[1];
        description.style.paddingInlineStart = (1.25 + (level - 1) * 0.75) + 'rem';
        if (task.summary) description.style.fontWeight = '700';

        const entry = { row, parent, level, expanded: true, description: task.description || String(task.presentationId) };
        if (parent && !parent.toggle) {
          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'btn btn-secondary btn-sm';
          toggle.style.marginInlineEnd = '0.5rem';
          toggle.addEventListener('click', () => {
            parent.expanded = !parent.expanded;
            atualizarHierarquia();
          });
          parent.row.cells[1].prepend(toggle);
          parent.toggle = toggle;
        }
        ancestors.push(entry);
        taskRows.push(entry);
        rows.append(row);
      }
      body.append(rows);
      hierarchy.hidden = !taskRows.some(entry => entry.toggle);
      atualizarHierarquia();
      table.hidden = tasks.length === 0;
      status.textContent = tasks.length
        ? tasks.length + (tasks.length === 1 ? ' atividade encontrada.' : ' atividades encontradas.')
        : 'Nenhuma atividade encontrada para esta obra e unidade.';
      if (measurements?.size) {
        status.textContent += ' Medição acumulada encontrada para ' + measurements.size
          + (measurements.size === 1 ? ' atividade.' : ' atividades.');
      } else if (tasks.length && !measurementError) {
        status.textContent += ' Nenhuma medição acumulada foi encontrada para essas atividades.';
      }
      if (measurementError) {
        console.error('Falha ao consultar as medições do planejamento', measurementError);
        const etapa = measurementError.measurementStage === 'itens' ? 'os itens' : 'a lista';
        const motivo = measurementError.status ? 'HTTP ' + measurementError.status : 'resposta inválida';
        status.textContent += ' Não foi possível ler ' + etapa + ' das medições (' + motivo + ').';
        if (measurements?.size) status.textContent += ' A tabela mostra apenas os percentuais confirmados.';
      }
    } catch (error) {
      if (current !== consulta) return;
      if (error.status === 401 || error.status === 403) {
        status.textContent = 'A consulta foi recusada. Confira sua sessão no Integra e o acesso da integração ao Planejamento do Sienge.';
      } else if (error.status === 404) {
        status.textContent = 'Planejamento indisponível para a unidade construtiva 1 desta obra.';
      } else {
        console.error('Falha ao consultar o planejamento', error);
        status.textContent = 'Não foi possível carregar o planejamento. Tente consultar novamente.';
      }
    } finally {
      if (current === consulta) button.disabled = false;
    }
  });
})();
