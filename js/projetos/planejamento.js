(() => {
  const dateLabel = value => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return parts ? [parts[3], parts[2], parts[1]].join('/') : '—';
  };

  const form = document.getElementById('projetos-planejamento-filtro');
  const obra = document.getElementById('projetos-planejamento-obra');
  const unidade = document.getElementById('projetos-planejamento-unidade');
  const button = form.querySelector('button');
  const status = document.getElementById('projetos-planejamento-status');
  const table = document.getElementById('projetos-planejamento-lista');
  const body = table.querySelector('tbody');
  let obrasCarregadas = false;
  let carregandoObras = false;
  let consulta = 0;

  function limparConsulta() {
    consulta += 1;
    button.disabled = !obrasCarregadas;
    table.hidden = true;
    body.replaceChildren();
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
        const { idSienge, nomeSienge, nomeAprovacao } = doc.data();
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
      if (!obrasCarregadas) status.textContent = 'Nenhuma obra com ID Sienge encontrada no Landbank.';
    } catch (error) {
      console.error('Falha ao carregar obras do Landbank', error);
      status.textContent = 'Não foi possível carregar as obras. Abra Aprovação novamente para tentar de novo.';
    } finally {
      carregandoObras = false;
    }
  };

  obra.addEventListener('change', () => {
    unidade.value = obra.value === '15700' ? '01' : '';
    limparConsulta();
  });
  unidade.addEventListener('input', limparConsulta);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!window.hasCrmPerm('mod_projetos')) return;
    limparConsulta();
    const current = consulta;
    const buildingId = obra.value;
    const unitId = unidade.value.trim();
    button.disabled = true;
    status.textContent = 'Consultando o planejamento no Sienge…';
    try {
      const tasks = await window.SiengeApiService.getBuildingPlanningTasks(buildingId, unitId);
      if (current !== consulta || !window.hasCrmPerm('mod_projetos')) return;
      tasks.sort((a, b) => a.presentationId - b.presentationId);
      const rows = document.createDocumentFragment();
      for (const task of tasks) {
        const row = document.createElement('tr');
        const values = [task.presentationId, task.description, dateLabel(task.startDate),
          dateLabel(task.finishDate), task.duration];
        for (const value of values) row.insertCell().textContent = value ?? '—';
        const description = row.cells[1];
        description.style.paddingInlineStart = (1.25 + Math.max(0, (task.level || 1) - 1) * 0.75) + 'rem';
        if (task.summary) description.style.fontWeight = '700';
        rows.append(row);
      }
      body.append(rows);
      table.hidden = tasks.length === 0;
      status.textContent = tasks.length
        ? tasks.length + (tasks.length === 1 ? ' atividade encontrada.' : ' atividades encontradas.')
        : 'Nenhuma atividade encontrada para esta obra e unidade.';
    } catch (error) {
      if (current !== consulta) return;
      if (error.status === 401 || error.status === 403) {
        status.textContent = 'A consulta foi recusada. Confira sua sessão no Integra e o acesso da integração ao Planejamento do Sienge.';
      } else if (error.status === 404) {
        status.textContent = 'Planejamento não encontrado. Confira o código da unidade construtiva.';
      } else {
        console.error('Falha ao consultar o planejamento', error);
        status.textContent = 'Não foi possível carregar o planejamento. Tente consultar novamente.';
      }
    } finally {
      if (current === consulta) button.disabled = false;
    }
  });
})();
