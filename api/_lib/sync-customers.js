const { tabela } = require('../../lib/dados-servidor');

// Configuração Sienge
const SIENGE_DOMAIN = "mouraleite";
// Usuário e senha da API do Sienge ficam nas variáveis da Vercel, nunca no código.
const SIENGE_USER = process.env.SIENGE_API_USER || "";
const SIENGE_PASS = process.env.SIENGE_API_PASSWORD || "";
const SIENGE_AUTH = "Basic " + Buffer.from(`${SIENGE_USER}:${SIENGE_PASS}`).toString('base64');
const SIENGE_API_BASE = `https://api.sienge.com.br/${SIENGE_DOMAIN}/public/api/v1`;

// Banco: tabela sienge_customers no Supabase (service role), com o mesmo mapa das telas.
const clientes = () => tabela('sienge_customers');

// Helper para formatar data (YYYY-MM-DD)
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function shiftDate(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return formatDate(date);
}

/* Cadastros novos: 60 dias. O buraco de 09/10 a 25/10 (códigos 15977 a 15990,
   inclusive a cliente 15990) ficou de fora porque a janela era só o dia anterior
   e não era refeita. */
function janelaCadastros() {
    return { startDate: shiftDate(-60), endDate: shiftDate(1) };
}

/* Alterações de cadastro já existente: janela curta, para o job caber no tempo. */
function janelaAlteracoes() {
    const today = new Date();
    const endDate = shiftDate(1);
    const startDateObj = new Date(today);
    const dayOfWeek = startDateObj.getDay();
    if (dayOfWeek === 1) startDateObj.setDate(startDateObj.getDate() - 2);
    else if (dayOfWeek === 3) startDateObj.setDate(startDateObj.getDate() - 4);
    else startDateObj.setDate(startDateObj.getDate() - 1);
    return { startDate: formatDate(startDateObj), endDate };
}

async function fetchFromSienge(endpoint) {
    const url = `${SIENGE_API_BASE}${endpoint}`;
    const response = await fetch(url, {
        headers: {
            'Authorization': SIENGE_AUTH
        }
    });
    if (!response.ok) {
        throw new Error(`Erro na API do Sienge (${response.status}): ${await response.text()}`);
    }
    return response.json();
}

async function buscarTodos(filtro) {
    const todos = [];
    const limit = 200;
    let offset = 0;
    for (let page = 0; page < 30; page++) {
        const data = await fetchFromSienge(`${filtro}&limit=${limit}&offset=${offset}`);
        const results = data.results || [];
        todos.push.apply(todos, results);
        offset += limit;
        const total = data.resultSetMetadata && Number(data.resultSetMetadata.count);
        if (!results.length || results.length < limit || (Number.isFinite(total) && offset >= total)) break;
    }
    return todos;
}

async function gravarClientes(customers) {
    let gravados = 0;
    for (let i = 0; i < customers.length; i++) {
        const customer = customers[i];
        if (!customer || customer.id == null || customer.id === "") continue;
        try {
            await clientes().gravar(String(customer.id), customer, { merge: true });
            gravados++;
        } catch (e) {
            console.warn("[SYNC] cliente " + customer.id + " não gravou:", e.message);
        }
    }
    return gravados;
}

module.exports = async function handler(req, res) {
    try {
        const cadastros = janelaCadastros();
        const alteracoes = janelaAlteracoes();

        console.log(`[SYNC] Cadastros de ${cadastros.startDate} a ${cadastros.endDate}.`);
        const novos = await buscarTodos(`/customers?createdAfter=${cadastros.startDate}&createdBefore=${cadastros.endDate}`);
        const clientesNovos = await gravarClientes(novos);

        console.log(`[SYNC] Alterações de ${alteracoes.startDate} a ${alteracoes.endDate}.`);
        const mudancas = await buscarTodos(`/customers?modifiedAfter=${alteracoes.startDate}&modifiedBefore=${alteracoes.endDate}`);
        const clientesAtualizados = await gravarClientes(mudancas);

        const msg = `Sincronização concluída. Cadastros no período: ${novos.length}, gravados: ${clientesNovos}. Alterações: ${mudancas.length}, gravadas: ${clientesAtualizados}.`;
        console.log(`[SYNC] ${msg}`);

        return res.status(200).json({
            success: true,
            message: msg,
            novos: clientesNovos,
            atualizados: clientesAtualizados,
            periodoCadastros: cadastros,
            periodoAlteracoes: alteracoes
        });

    } catch (error) {
        console.error('[SYNC ERROR]', error);
        return res.status(500).json({ error: error.message });
    }
};
