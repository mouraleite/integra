(() => {
  const fields = ['id', 'nomeAprovacao', 'municipio', 'fases', 'tipologia', 'status'];
  let loading = false;

  window.carregarLandbank = async function () {
    if (loading) return;

    const status = document.getElementById('landbank-status');
    const lista = document.getElementById('landbank-lista');
    const registros = document.getElementById('landbank-registros');

    loading = true;
    status.textContent = 'Carregando terrenos…';
    lista.hidden = true;
    registros.replaceChildren();

    try {
      const { collection, getDocs } = window.firebaseCollections;
      const snapshot = await getDocs(collection(window.firebaseDb, 'landbank'));
      const terrenos = snapshot.docs.map(doc => doc.data());
      terrenos.sort((a, b) => a.id - b.id);

      const rows = document.createDocumentFragment();
      for (const terreno of terrenos) {
        const row = document.createElement('tr');
        for (const field of fields) {
          const cell = row.insertCell();
          cell.textContent = terreno[field] === null || terreno[field] === undefined || terreno[field] === ''
            ? '—'
            : String(terreno[field]);
        }
        rows.append(row);
      }
      registros.append(rows);
      lista.hidden = terrenos.length === 0;
      status.textContent = terrenos.length === 0
        ? 'Nenhum terreno encontrado.'
        : terrenos.length === 1 ? '1 terreno' : terrenos.length + ' terrenos';
    } catch (error) {
      console.error('Falha ao consultar o Landbank', error);
      status.textContent = 'Não foi possível carregar os terrenos. Abra o Landbank novamente para tentar de novo.';
    } finally {
      loading = false;
    }
  };
})();
