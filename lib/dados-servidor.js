/* Camadas de dados das telas (js/<area>/dados-<area>.js) rodando no servidor (api/_lib, lib/, rotinas automáticas).
   As camadas foram escritas para o navegador (window.sb, window.DadosBase...). Aqui cada arquivo é compilado uma vez
   como função que recebe um "window" próprio (sem criar window global no Node, que confundiria outras bibliotecas),
   cujo sb é o cliente com a service role (lib/supabase-admin.js). A service role ignora a RLS: só usar no servidor.
   Assim as rotinas leem e gravam com os mesmos mapas e funções das telas.

   const { dados, tabela } = require("../lib/dados-servidor");
   const D = dados();   // { sb, DadosBase, DadosNucleo, DadosCobranca, DadosEngenharia, DadosFinanceiro, Mapas* }
   await tabela("sienge_customers").gravar(id, obj, { merge: true });

   Os arquivos lidos com fs entram na função da Vercel pelo includeFiles do vercel.json. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { supabaseAdmin } = require("./supabase-admin");

const RAIZ = path.join(__dirname, "..");
let carregado = null;

function rodarCamada(janela, relativo) {
  const arquivo = path.join(RAIZ, relativo);
  const codigo = fs.readFileSync(arquivo, "utf8");
  const fn = vm.compileFunction(codigo, ["window"], { filename: arquivo });
  fn.call(janela, janela);
}

function dados() {
  if (carregado) return carregado;
  const eventos = new EventTarget();
  const janela = {
    sb: supabaseAdmin(),
    addEventListener: eventos.addEventListener.bind(eventos),
    removeEventListener: eventos.removeEventListener.bind(eventos),
    dispatchEvent: eventos.dispatchEvent.bind(eventos),
    // O servidor não tem usuário logado: a service role já vale para tudo.
    sbToken: async () => null,
    sbUsuario: () => null,
  };
  // UMD (module.exports no Node).
  janela.DadosBase = require("../js/nucleo/dados-base.js");
  janela.MapasNucleo = require("../js/nucleo/mapas-nucleo.js");
  janela.MapasCobranca = require("../js/cobranca/mapas-cobranca.js");
  janela.MapasEngenharia = require("../js/engenharia/mapas-engenharia.js");
  janela.MapasFinanceiro = require("../js/financeiro/mapas-financeiro.js");
  // Só navegador (usam window.*): compiladas com o window acima.
  rodarCamada(janela, "js/nucleo/dados-nucleo.js");
  rodarCamada(janela, "js/cobranca/dados-cobranca.js");
  rodarCamada(janela, "js/engenharia/dados-engenharia.js");
  rodarCamada(janela, "js/financeiro/dados-financeiro.js");
  carregado = {
    sb: janela.sb,
    DadosBase: janela.DadosBase,
    MapasNucleo: janela.MapasNucleo,
    MapasCobranca: janela.MapasCobranca,
    MapasEngenharia: janela.MapasEngenharia,
    MapasFinanceiro: janela.MapasFinanceiro,
    DadosNucleo: janela.DadosNucleo,
    DadosCobranca: janela.DadosCobranca,
    DadosEngenharia: janela.DadosEngenharia,
    DadosFinanceiro: janela.DadosFinanceiro,
  };
  return carregado;
}

// Atalho: tabela("sienge_customers") procura o mapa nas quatro áreas e devolve o DadosNucleo.tabela dele.
function tabela(nome) {
  const D = dados();
  const mapa = D.MapasNucleo[nome] || D.MapasCobranca[nome] || D.MapasEngenharia[nome] || D.MapasFinanceiro[nome];
  if (!mapa || typeof mapa !== "object" || !mapa.tabela) throw new Error("Tabela sem mapa: " + nome);
  return D.DadosNucleo.tabela(mapa);
}

// Erro do supabase-js vira exceção; devolve data.
function checar(r) {
  if (r && r.error) throw new Error(r.error.message || String(r.error));
  return r ? r.data : null;
}

module.exports = { dados, tabela, checar };
