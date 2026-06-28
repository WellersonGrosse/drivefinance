// ─────────────────────────────────────────────
// DriveFinance — despesas.js
// Cadastro hierárquico de blocos, subblocos e despesas
// ─────────────────────────────────────────────

import {
  exigirLogin,
  verificarAcesso,
  getDespesas,
  addDespesa,
  updateDespesa,
  deleteDespesa,
  getGruposDespesas,
  addGrupoDespesa,
  updateGrupoDespesa,
  deleteGrupoDespesa,
  formatReal,
  toast,
  renderNav
} from './app.js';

import { db } from './firebase-config.js';
import {
  doc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const PAGINAS_PRONTAS = new Set([
  'home.html',
  'admin.html',
  'configuracoes.html',
  'custo-operacional.html',
  'despesas.html',
  'lancamentos.html'
]);

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const state = {
  user: null,
  perfil: null,
  grupos: [],
  despesas: [],
  filtro: 'todos',
  ordenar: 'vencimento',
  mesAtual: new Date(),
  grupoEdicaoId: null,
  subblocoEdicaoId: null,
  grupoSubblocoId: null,
  itemEdicao: null,
  excluir: null,
  pagarId: null,
  lancamentoGrupoId: null,
  reabrirLancamentoAposGrupo: false,
  criarDespesaAposSubbloco: false,
  expandidos: new Set()
};

const $ = (id) => document.getElementById(id);

function escapeHtml(valor = '') {
  return String(valor)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function gerarIdLocal() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function textoChave(valor = '') {
  return String(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function termosGrupo(grupo = {}) {
  const nome = textoChave(grupo.nome || '');

  if (nome.includes('cart')) {
    return { singular: 'cartão', plural: 'cartões', artigo: 'o', artigoPlural: 'os' };
  }
  if (nome.includes('boleto')) {
    return { singular: 'boleto', plural: 'boletos', artigo: 'o', artigoPlural: 'os' };
  }
  if (nome.includes('financi')) {
    return { singular: 'financiamento', plural: 'financiamentos', artigo: 'o', artigoPlural: 'os' };
  }
  if (nome.includes('assinatura')) {
    return { singular: 'assinatura', plural: 'assinaturas', artigo: 'a', artigoPlural: 'as' };
  }
  if (nome.includes('emprest')) {
    return { singular: 'empréstimo', plural: 'empréstimos', artigo: 'o', artigoPlural: 'os' };
  }
  if (nome.includes('conta')) {
    return { singular: 'conta', plural: 'contas', artigo: 'a', artigoPlural: 'as' };
  }

  return grupo.estrutura === 'agregador'
    ? { singular: 'conta', plural: 'contas', artigo: 'a', artigoPlural: 'as' }
    : { singular: 'despesa', plural: 'despesas', artigo: 'a', artigoPlural: 'as' };
}

function capitalizar(valor = '') {
  return valor ? valor.charAt(0).toUpperCase() + valor.slice(1) : '';
}

function novoPara(termos) {
  return termos.artigo === 'a' ? 'nova' : 'novo';
}

function primeiroPara(termos) {
  return termos.artigo === 'a' ? 'primeira' : 'primeiro';
}

function anoMesStr(date) {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}`;
}

function labelMes(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function avancarMes(date, delta) {
  const novaData = new Date(date);
  novaData.setDate(1);
  novaData.setMonth(novaData.getMonth() + delta);
  return novaData;
}

function estruturaDespesa(despesa) {
  if (despesa.estrutura === 'agregador' || despesa.estrutura === 'direto') {
    return despesa.estrutura;
  }
  return Array.isArray(despesa.itens) && despesa.itens.length > 0
    ? 'agregador'
    : 'direto';
}

function calcularParcelaAtual(entidade, mesRef) {
  if (entidade.tipo !== 'parcelamento') return null;
  if (!entidade.mes_inicio || !entidade.ano_inicio || !entidade.parcela_total) return null;

  const diffMeses =
    (mesRef.getFullYear() - Number(entidade.ano_inicio)) * 12
    + ((mesRef.getMonth() + 1) - Number(entidade.mes_inicio));

  const parcela = Number(entidade.parcela_atual || 1) + diffMeses;
  if (parcela < 1 || parcela > Number(entidade.parcela_total)) return null;
  return parcela;
}

function entidadeAtivaNoMes(entidade, mesRef) {
  if (entidade.tipo !== 'parcelamento') return true;
  return calcularParcelaAtual(entidade, mesRef) !== null;
}

function parcelamentoEncerrado(entidade, mesRef) {
  if (entidade.tipo !== 'parcelamento') return false;
  if (!entidade.mes_inicio || !entidade.ano_inicio || !entidade.parcela_total) return false;

  const diffMeses =
    (mesRef.getFullYear() - Number(entidade.ano_inicio)) * 12
    + ((mesRef.getMonth() + 1) - Number(entidade.mes_inicio));

  return diffMeses >= Number(entidade.parcela_total);
}

function normalizarItem(item, despesaPai = {}) {
  return {
    id: item.id || gerarIdLocal(),
    nome: item.nome || 'Despesa',
    valor: Number(item.valor) || 0,
    natureza: item.natureza || despesaPai.natureza || 'pessoal',
    tipo: item.tipo || despesaPai.tipo || 'fixa',
    parcela_atual: Number(item.parcela_atual || despesaPai.parcela_atual || 1),
    parcela_total: item.parcela_total || despesaPai.parcela_total || null,
    mes_inicio: item.mes_inicio || despesaPai.mes_inicio || null,
    ano_inicio: item.ano_inicio || despesaPai.ano_inicio || null
  };
}

function itensNormalizados(despesa) {
  return Array.isArray(despesa.itens)
    ? despesa.itens.map(item => normalizarItem(item, despesa))
    : [];
}

function itensAtivosNoMes(despesa, mesRef, filtro = 'todos') {
  return itensNormalizados(despesa).filter(item => {
    const naturezaOk = filtro === 'todos' || item.natureza === filtro;
    return naturezaOk && entidadeAtivaNoMes(item, mesRef);
  });
}

function totalItens(itens) {
  return itens.reduce((total, item) => total + (Number(item.valor) || 0), 0);
}

function valorDespesaNoMes(despesa, mesRef, filtro = 'todos') {
  if (estruturaDespesa(despesa) === 'agregador') {
    return totalItens(itensAtivosNoMes(despesa, mesRef, filtro));
  }

  if (!entidadeAtivaNoMes(despesa, mesRef)) return 0;
  if (filtro !== 'todos' && despesa.natureza !== filtro) return 0;
  return Number(despesa.valor) || 0;
}

function despesaVisivel(despesa, mesRef, filtro) {
  if (estruturaDespesa(despesa) === 'agregador') {
    if (filtro === 'todos') return true;
    return itensAtivosNoMes(despesa, mesRef, filtro).length > 0;
  }

  return entidadeAtivaNoMes(despesa, mesRef)
    && (filtro === 'todos' || despesa.natureza === filtro);
}

function getStatusMes(despesa, anoMes) {
  return (despesa.status_mensal || {})[anoMes] || 'pendente';
}

async function setStatusMensal(uid, despesaId, anoMes, status) {
  const campo = `status_mensal.${anoMes}`;
  await updateDoc(doc(db, 'users', uid, 'despesas', despesaId), { [campo]: status });
}

async function quitarTudo(uid, despesa, mesRef) {
  const parcelaAtual = calcularParcelaAtual(despesa, mesRef);
  if (!parcelaAtual || !despesa.parcela_total) return;

  const atualizacoes = {};
  const restantes = Number(despesa.parcela_total) - parcelaAtual + 1;

  for (let i = 0; i < restantes; i += 1) {
    atualizacoes[`status_mensal.${anoMesStr(avancarMes(mesRef, i))}`] = 'pago';
  }

  await updateDoc(doc(db, 'users', uid, 'despesas', despesa.id), atualizacoes);
}

function labelParcela(entidade, mesRef) {
  if (entidade.tipo !== 'parcelamento') return '';
  const atual = calcularParcelaAtual(entidade, mesRef);
  if (!atual) return '';
  return `${atual}/${entidade.parcela_total}`;
}

function htmlNatureza(natureza) {
  const trabalho = natureza === 'trabalho';
  return `<span class="natureza-badge ${trabalho ? 'natureza-trabalho' : 'natureza-pessoal'}">${trabalho ? 'Trabalho' : 'Pessoal'}</span>`;
}

function htmlTipo(entidade, mesRef) {
  if (entidade.tipo === 'parcelamento') {
    const parcela = labelParcela(entidade, mesRef);
    return `<span class="tipo-badge tipo-parcelamento">Parcelamento${parcela ? ` ${escapeHtml(parcela)}` : ''}</span>`;
  }
  return '<span class="tipo-badge tipo-fixa">Fixa</span>';
}

function htmlStatus(despesa, anoMes) {
  const pago = getStatusMes(despesa, anoMes) === 'pago';
  return `
    <button class="btn-status ${pago ? 'status-pago' : 'status-pendente'}"
            type="button"
            data-acao="toggle-status"
            data-id="${despesa.id}"
            aria-label="${pago ? 'Marcar como pendente' : 'Marcar como pago'}">
      ${pago
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>Pago'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>Em aberto'}
    </button>`;
}

function htmlIconEditar(acao, id, itemId = '') {
  return `
    <button class="icon-btn" type="button" data-acao="${acao}" data-id="${id}" ${itemId ? `data-item-id="${itemId}"` : ''} aria-label="Editar">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
    </button>`;
}

function htmlIconExcluir(acao, id, itemId = '') {
  return `
    <button class="icon-btn icon-btn-danger" type="button" data-acao="${acao}" data-id="${id}" ${itemId ? `data-item-id="${itemId}"` : ''} aria-label="Excluir">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
    </button>`;
}

function ordenarSubblocos(lista, criterio, mesRef, filtro) {
  const anoMes = anoMesStr(mesRef);
  return [...lista].sort((a, b) => {
    if (criterio === 'valor') {
      return valorDespesaNoMes(b, mesRef, filtro) - valorDespesaNoMes(a, mesRef, filtro);
    }
    if (criterio === 'nome') {
      return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
    }
    if (criterio === 'status') {
      const aPago = getStatusMes(a, anoMes) === 'pago' ? 1 : 0;
      const bPago = getStatusMes(b, anoMes) === 'pago' ? 1 : 0;
      return aPago - bPago;
    }
    return Number(a.vencimento_dia || 31) - Number(b.vencimento_dia || 31);
  });
}

function renderItemRow(despesa, item, mesRef) {
  return `
    <div class="item-despesa-row">
      <div class="item-despesa-copy">
        <span class="item-despesa-nome" title="${escapeHtml(item.nome)}">${escapeHtml(item.nome)}</span>
        <div class="item-despesa-meta">
          ${htmlNatureza(item.natureza)}
          ${htmlTipo(item, mesRef)}
        </div>
      </div>
      <span class="item-despesa-valor">${formatReal(item.valor)}</span>
      <div class="item-despesa-actions">
        ${htmlIconEditar('editar-item', despesa.id, item.id)}
        ${htmlIconExcluir('excluir-item', despesa.id, item.id)}
      </div>
    </div>`;
}

function renderSubblocoAgregador(despesa, mesRef, filtro) {
  const anoMes = anoMesStr(mesRef);
  const itensVisiveis = itensAtivosNoMes(despesa, mesRef, filtro);
  const itensTodosAtivos = itensAtivosNoMes(despesa, mesRef, 'todos');
  const valorVisivel = totalItens(itensVisiveis);
  const valorCompleto = totalItens(itensTodosAtivos);
  const expandido = state.expandidos.has(despesa.id);
  const totalLabel = filtro === 'todos'
    ? `${itensVisiveis.length} ${itensVisiveis.length === 1 ? 'despesa' : 'despesas'}`
    : `${itensVisiveis.length} visível${itensVisiveis.length === 1 ? '' : 'is'} • fatura ${formatReal(valorCompleto)}`;

  return `
    <article class="subbloco-card">
      <div class="subbloco-main">
        <div class="subbloco-top">
          <div class="subbloco-identidade">
            <span class="subbloco-nome" title="${escapeHtml(despesa.nome)}">${escapeHtml(despesa.nome || 'Sem nome')}</span>
            <div class="subbloco-meta">
              <span>Vence dia ${Number(despesa.vencimento_dia) || '-'}</span>
              <span class="meta-sep"></span>
              <span>${escapeHtml(totalLabel)}</span>
            </div>
          </div>
          <div class="subbloco-valor-wrap">
            <span class="subbloco-valor">${formatReal(valorVisivel)}</span>
            ${htmlStatus(despesa, anoMes)}
          </div>
        </div>

        <div class="subbloco-actions-row">
          <button class="subbloco-toggle ${expandido ? 'expandido' : ''}" type="button" data-acao="toggle-itens" data-id="${despesa.id}" aria-expanded="${expandido}">
            <span>${expandido ? 'Ocultar despesas' : 'Ver despesas'}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div class="subbloco-actions">
            ${htmlIconEditar('editar-subbloco', despesa.id)}
            ${htmlIconExcluir('excluir-subbloco', despesa.id)}
          </div>
        </div>
      </div>

      <div class="itens-painel" ${expandido ? '' : 'hidden'}>
        ${itensVisiveis.length > 0
          ? itensVisiveis.map(item => renderItemRow(despesa, item, mesRef)).join('')
          : '<p class="item-lista-vazia">Nenhuma despesa neste filtro e mês.</p>'}
        <button class="item-add-inline" type="button" data-acao="adicionar-item" data-id="${despesa.id}" data-feature="despesas.itens.criar">+ Lançar despesa</button>
      </div>
    </article>`;
}

function renderSubblocoDireto(despesa, mesRef) {
  const anoMes = anoMesStr(mesRef);
  const parcela = labelParcela(despesa, mesRef);

  return `
    <article class="subbloco-card">
      <div class="subbloco-main">
        <div class="subbloco-top">
          <div class="subbloco-identidade">
            <span class="subbloco-nome" title="${escapeHtml(despesa.nome)}">${escapeHtml(despesa.nome || 'Sem nome')}</span>
            <div class="subbloco-meta">
              <span>Vence dia ${Number(despesa.vencimento_dia) || '-'}</span>
              <span class="meta-sep"></span>
              ${htmlNatureza(despesa.natureza)}
              ${htmlTipo(despesa, mesRef)}
              ${parcela ? `<span class="meta-sep"></span><span>Parcela ${escapeHtml(parcela)}</span>` : ''}
            </div>
          </div>
          <div class="subbloco-valor-wrap">
            <span class="subbloco-valor">${formatReal(despesa.valor)}</span>
            ${htmlStatus(despesa, anoMes)}
          </div>
        </div>

        <div class="subbloco-actions-row subbloco-actions-row-direto">
          <span></span>
          <div class="subbloco-actions">
            ${htmlIconEditar('editar-subbloco', despesa.id)}
            ${htmlIconExcluir('excluir-subbloco', despesa.id)}
          </div>
        </div>
      </div>
    </article>`;
}

function renderGrupo(grupo, mesRef) {
  const subblocos = state.despesas.filter(d => d.grupo_id === grupo.id);
  const visiveis = ordenarSubblocos(
    subblocos.filter(d => despesaVisivel(d, mesRef, state.filtro)),
    state.ordenar,
    mesRef,
    state.filtro
  );

  const totalGrupo = visiveis.reduce(
    (total, despesa) => total + valorDespesaNoMes(despesa, mesRef, state.filtro),
    0
  );

  const termos = termosGrupo(grupo);
  const descricaoEstrutura = grupo.estrutura === 'agregador'
    ? 'Total calculado pelas despesas internas'
    : `Cada ${termos.singular} possui valor próprio`;

  const vazio = state.filtro === 'todos'
    ? `Nenhum ${termos.singular} cadastrado.`
    : 'Nenhuma despesa encontrada neste filtro.';

  return `
    <section class="grupo-card" data-grupo-id="${grupo.id}">
      <header class="grupo-card-header">
        <div class="grupo-card-title-wrap">
          <div class="grupo-card-title-row">
            <h2 class="grupo-card-title" title="${escapeHtml(grupo.nome)}">${escapeHtml(grupo.nome)}</h2>
            <span class="grupo-count">${visiveis.length}</span>
          </div>
          <p class="grupo-card-subtitle">${escapeHtml(descricaoEstrutura)} • ${formatReal(totalGrupo)}</p>
        </div>
        <div class="grupo-card-actions">
          ${htmlIconEditar('editar-grupo', grupo.id)}
          ${htmlIconExcluir('excluir-grupo', grupo.id)}
        </div>
      </header>

      <div class="grupo-card-body">
        <div class="subblocos-lista">
          ${visiveis.length > 0
            ? visiveis.map(despesa => estruturaDespesa(despesa) === 'agregador'
              ? renderSubblocoAgregador(despesa, mesRef, state.filtro)
              : renderSubblocoDireto(despesa, mesRef)).join('')
            : `
              <div class="grupo-empty">
                <span>${escapeHtml(vazio)}</span>
              </div>`}
        </div>

        <button class="grupo-add-btn" type="button" data-acao="adicionar-subbloco" data-id="${grupo.id}" data-feature="despesas.subblocos.criar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          ${capitalizar(novoPara(termos))} ${escapeHtml(termos.singular)}
        </button>
      </div>
    </section>`;
}

function calcularResumo() {
  const mesRef = state.mesAtual;
  const anoMes = anoMesStr(mesRef);
  let totalTrabalho = 0;
  let totalPessoal = 0;
  let countTrabalho = 0;
  let countPessoal = 0;
  let totalPago = 0;

  state.despesas.forEach(despesa => {
    if (estruturaDespesa(despesa) === 'agregador') {
      const ativos = itensAtivosNoMes(despesa, mesRef, 'todos');
      let totalSubbloco = 0;

      ativos.forEach(item => {
        const valor = Number(item.valor) || 0;
        totalSubbloco += valor;
        if (item.natureza === 'trabalho') {
          totalTrabalho += valor;
          countTrabalho += 1;
        } else {
          totalPessoal += valor;
          countPessoal += 1;
        }
      });

      if (getStatusMes(despesa, anoMes) === 'pago') totalPago += totalSubbloco;
      return;
    }

    if (!entidadeAtivaNoMes(despesa, mesRef)) return;
    const valor = Number(despesa.valor) || 0;

    if (despesa.natureza === 'trabalho') {
      totalTrabalho += valor;
      countTrabalho += 1;
    } else {
      totalPessoal += valor;
      countPessoal += 1;
    }

    if (getStatusMes(despesa, anoMes) === 'pago') totalPago += valor;
  });

  const totalGeral = totalTrabalho + totalPessoal;
  const percentualPago = totalGeral > 0
    ? Math.round((totalPago / totalGeral) * 100)
    : 0;

  return {
    totalTrabalho,
    totalPessoal,
    countTrabalho,
    countPessoal,
    totalGeral,
    percentualPago
  };
}

function renderResumo() {
  const resumo = calcularResumo();
  $('total-trabalho').textContent = formatReal(resumo.totalTrabalho);
  $('total-pessoal').textContent = formatReal(resumo.totalPessoal);
  $('total-geral').textContent = formatReal(resumo.totalGeral);
  $('count-trabalho').textContent = `${resumo.countTrabalho} ${resumo.countTrabalho === 1 ? 'despesa' : 'despesas'}`;
  $('count-pessoal').textContent = `${resumo.countPessoal} ${resumo.countPessoal === 1 ? 'despesa' : 'despesas'}`;
  $('resumo-pago-pct').textContent = `${resumo.percentualPago}% pago`;
  $('resumo-fill').style.width = `${resumo.percentualPago}%`;
}

function obterEncerrados() {
  const mesRef = state.mesAtual;
  const encerrados = [];

  state.despesas.forEach(despesa => {
    if (estruturaDespesa(despesa) === 'direto') {
      if (parcelamentoEncerrado(despesa, mesRef)
          && (state.filtro === 'todos' || despesa.natureza === state.filtro)) {
        const grupo = grupoPorId(despesa.grupo_id);
        encerrados.push({
          nome: despesa.nome,
          contexto: capitalizar(termosGrupo(grupo).singular),
          valor: Number(despesa.valor) || 0,
          natureza: despesa.natureza
        });
      }
      return;
    }

    itensNormalizados(despesa).forEach(item => {
      if (parcelamentoEncerrado(item, mesRef)
          && (state.filtro === 'todos' || item.natureza === state.filtro)) {
        encerrados.push({
          nome: item.nome,
          contexto: despesa.nome,
          valor: Number(item.valor) || 0,
          natureza: item.natureza
        });
      }
    });
  });

  return encerrados.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function renderEncerrados() {
  const encerrados = obterEncerrados();
  $('encerrados-section').hidden = encerrados.length === 0;
  $('count-encerrados').textContent = String(encerrados.length);
  $('encerrados-lista').innerHTML = encerrados.map(item => `
    <article class="encerrado-card">
      <div>
        <strong>${escapeHtml(item.nome)}</strong>
        <span>${escapeHtml(item.contexto)} • ${item.natureza === 'trabalho' ? 'Trabalho' : 'Pessoal'}</span>
      </div>
      <div class="encerrado-card-value">${formatReal(item.valor)}</div>
    </article>`).join('');
}

function renderMesNav() {
  $('mes-label').textContent = labelMes(state.mesAtual);
}

function renderPagina() {
  renderResumo();

  const gruposOrdenados = [...state.grupos].sort((a, b) => {
    const ordemA = Number(a.ordem ?? 9999);
    const ordemB = Number(b.ordem ?? 9999);
    if (ordemA !== ordemB) return ordemA - ordemB;
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
  });

  $('grupos-grid').innerHTML = gruposOrdenados
    .map(grupo => renderGrupo(grupo, state.mesAtual))
    .join('');

  $('empty-global').hidden = gruposOrdenados.length > 0;
  renderEncerrados();
}

function preencherSelectMeses() {
  const options = MESES.map((mes, index) => `<option value="${index + 1}">${mes}</option>`).join('');
  $('inp-subbloco-mes-inicio').innerHTML = options;
  $('inp-item-mes-inicio').innerHTML = options;
}

async function garantirEstruturaInicial() {
  state.grupos = await getGruposDespesas(state.user.uid);
  state.despesas = await getDespesas(state.user.uid);

  if (state.grupos.length === 0) {
    const cartoesRef = await addGrupoDespesa(state.user.uid, {
      nome: 'Cartões',
      estrutura: 'agregador',
      ordem: 1
    });
    const boletosRef = await addGrupoDespesa(state.user.uid, {
      nome: 'Boletos',
      estrutura: 'direto',
      ordem: 2
    });

    state.grupos = [
      { id: cartoesRef.id, nome: 'Cartões', estrutura: 'agregador', ordem: 1 },
      { id: boletosRef.id, nome: 'Boletos', estrutura: 'direto', ordem: 2 }
    ];
  }

  const semGrupo = state.despesas.filter(d => !d.grupo_id);
  if (semGrupo.length === 0) return;

  let grupoAgregador = state.grupos.find(g => g.estrutura === 'agregador');
  let grupoDireto = state.grupos.find(g => g.estrutura === 'direto');

  if (!grupoAgregador && semGrupo.some(d => estruturaDespesa(d) === 'agregador')) {
    const ref = await addGrupoDespesa(state.user.uid, {
      nome: 'Cartões',
      estrutura: 'agregador',
      ordem: state.grupos.length + 1
    });
    grupoAgregador = { id: ref.id, nome: 'Cartões', estrutura: 'agregador' };
    state.grupos.push(grupoAgregador);
  }

  if (!grupoDireto && semGrupo.some(d => estruturaDespesa(d) === 'direto')) {
    const ref = await addGrupoDespesa(state.user.uid, {
      nome: 'Boletos',
      estrutura: 'direto',
      ordem: state.grupos.length + 1
    });
    grupoDireto = { id: ref.id, nome: 'Boletos', estrutura: 'direto' };
    state.grupos.push(grupoDireto);
  }

  await Promise.all(semGrupo.map(despesa => {
    const estrutura = estruturaDespesa(despesa);
    const dados = {
      grupo_id: estrutura === 'agregador' ? grupoAgregador.id : grupoDireto.id,
      estrutura
    };

    if (estrutura === 'agregador') {
      const itens = itensNormalizados(despesa);
      dados.itens = itens;
      dados.valor = totalItens(itens);
    }

    return updateDespesa(state.user.uid, despesa.id, dados);
  }));

  state.despesas = await getDespesas(state.user.uid);
}

async function recarregarDados() {
  const [grupos, despesas] = await Promise.all([
    getGruposDespesas(state.user.uid),
    getDespesas(state.user.uid)
  ]);
  state.grupos = grupos;
  state.despesas = despesas;
  renderPagina();
}

/* ─────────────────────────────────────────────
   Modal de categoria
───────────────────────────────────────────── */

function atualizarHintEstruturaGrupo() {
  const agregador = $('inp-grupo-estrutura').value === 'agregador';
  $('grupo-estrutura-hint').textContent = agregador
    ? 'Ideal para cartões: cada cartão reúne várias despesas e o total é calculado automaticamente.'
    : 'Ideal para boletos e contas: cada despesa possui valor e vencimento próprios.';
}

function abrirModalGrupo(grupo = null, { reabrirLancamento = false } = {}) {
  state.grupoEdicaoId = grupo?.id || null;
  state.reabrirLancamentoAposGrupo = !grupo && reabrirLancamento;
  $('modal-grupo-titulo').textContent = grupo ? 'Editar categoria' : 'Nova categoria';
  $('inp-grupo-nome').value = grupo?.nome || '';
  $('inp-grupo-estrutura').value = grupo?.estrutura || 'agregador';

  const possuiItens = grupo
    ? state.despesas.some(d => d.grupo_id === grupo.id)
    : false;
  $('inp-grupo-estrutura').disabled = possuiItens;

  atualizarHintEstruturaGrupo();
  $('modal-grupo').hidden = false;
  setTimeout(() => $('inp-grupo-nome').focus(), 0);
}

function fecharModalGrupo() {
  $('modal-grupo').hidden = true;
  $('inp-grupo-estrutura').disabled = false;
  state.grupoEdicaoId = null;
  state.reabrirLancamentoAposGrupo = false;
}

async function salvarGrupo() {
  const nome = $('inp-grupo-nome').value.trim();
  const estrutura = $('inp-grupo-estrutura').value;

  if (!nome) {
    toast('Informe o nome da categoria.', 'aviso');
    return;
  }

  const btn = $('btn-salvar-grupo');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const reabrirLancamento = state.reabrirLancamentoAposGrupo;
  let grupoSalvoId = state.grupoEdicaoId;

  try {
    if (state.grupoEdicaoId) {
      await updateGrupoDespesa(state.user.uid, state.grupoEdicaoId, { nome, estrutura });
      toast('Categoria atualizada.', 'sucesso');
    } else {
      const ref = await addGrupoDespesa(state.user.uid, {
        nome,
        estrutura,
        ordem: state.grupos.length + 1
      });
      grupoSalvoId = ref.id;
      toast('Categoria criada.', 'sucesso');
    }

    fecharModalGrupo();
    await recarregarDados();

    if (reabrirLancamento && grupoSalvoId) {
      abrirModalLancamento(grupoSalvoId);
    }
  } catch (erro) {
    console.error('[DriveFinance/despesas/categoria]', erro);
    toast('Não foi possível salvar a categoria.', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

/* ─────────────────────────────────────────────
   Modal de subbloco
───────────────────────────────────────────── */

function grupoPorId(id) {
  return state.grupos.find(grupo => grupo.id === id) || null;
}

function despesaPorId(id) {
  return state.despesas.find(despesa => despesa.id === id) || null;
}

/* ─────────────────────────────────────────────
   Modal para lançar despesa
───────────────────────────────────────────── */

function atualizarDestinoLancamento() {
  const grupo = grupoPorId($('inp-lancamento-grupo').value);
  if (!grupo) return;

  state.lancamentoGrupoId = grupo.id;
  const termos = termosGrupo(grupo);
  const agregador = grupo.estrutura === 'agregador';

  $('lancamento-destino-wrap').hidden = !agregador;
  $('lancamento-direto-info').hidden = agregador;

  if (agregador) {
    const destinos = state.despesas
      .filter(despesa => despesa.grupo_id === grupo.id && estruturaDespesa(despesa) === 'agregador')
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

    $('lancamento-destino-label').textContent = capitalizar(termos.singular);
    $('inp-lancamento-destino').innerHTML = [
      ...destinos.map(despesa => `<option value="${despesa.id}">${escapeHtml(despesa.nome)}</option>`),
      `<option value="__novo__">+ Cadastrar ${novoPara(termos)} ${escapeHtml(termos.singular)}</option>`
    ].join('');

    $('lancamento-destino-hint').textContent = destinos.length > 0
      ? `Escolha ${termos.artigo} ${termos.singular} que receberá a despesa ou cadastre ${termos.artigo} ${novoPara(termos)}.`
      : `Cadastre ${termos.artigo} ${primeiroPara(termos)} ${termos.singular} desta categoria.`;
    $('btn-continuar-lancamento').textContent = 'Continuar';
    return;
  }

  $('lancamento-direto-info').innerHTML = `
    <strong>${capitalizar(novoPara(termos))} ${escapeHtml(termos.singular)}</strong>
    <span>Será cadastrado com valor, natureza e vencimento próprios dentro de ${escapeHtml(grupo.nome)}.</span>`;
  $('btn-continuar-lancamento').textContent = `Cadastrar ${termos.singular}`;
}

function abrirModalLancamento(grupoPreferidoId = null) {
  if (state.grupos.length === 0) {
    toast('Crie uma categoria antes de lançar a primeira despesa.', 'aviso');
    abrirModalGrupo(null, { reabrirLancamento: true });
    return;
  }

  const gruposOrdenados = [...state.grupos].sort((a, b) => {
    const ordemA = Number(a.ordem ?? 9999);
    const ordemB = Number(b.ordem ?? 9999);
    if (ordemA !== ordemB) return ordemA - ordemB;
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
  });

  $('inp-lancamento-grupo').innerHTML = gruposOrdenados
    .map(grupo => `<option value="${grupo.id}">${escapeHtml(grupo.nome)}</option>`)
    .join('');

  const grupoInicial = grupoPreferidoId && grupoPorId(grupoPreferidoId)
    ? grupoPreferidoId
    : gruposOrdenados[0].id;

  $('inp-lancamento-grupo').value = grupoInicial;
  atualizarDestinoLancamento();
  $('modal-lancamento').hidden = false;
}

function fecharModalLancamento() {
  $('modal-lancamento').hidden = true;
  state.lancamentoGrupoId = null;
}

function continuarLancamento() {
  const grupo = grupoPorId(state.lancamentoGrupoId);
  if (!grupo) {
    toast('Selecione uma categoria.', 'aviso');
    return;
  }

  if (grupo.estrutura === 'agregador') {
    const destinoId = $('inp-lancamento-destino').value;

    if (destinoId === '__novo__') {
      state.criarDespesaAposSubbloco = true;
      fecharModalLancamento();
      abrirModalSubbloco(grupo.id);
      return;
    }

    const destino = despesaPorId(destinoId);
    if (!destino) {
      toast(`Selecione ${termosGrupo(grupo).artigo} ${termosGrupo(grupo).singular}.`, 'aviso');
      return;
    }

    fecharModalLancamento();
    abrirModalItem(destino);
    return;
  }

  fecharModalLancamento();
  abrirModalSubbloco(grupo.id);
}

function criarCategoriaDoLancamento() {
  fecharModalLancamento();
  abrirModalGrupo(null, { reabrirLancamento: true });
}

function atualizarCamposSubbloco() {
  const grupo = grupoPorId(state.grupoSubblocoId);
  const agregador = grupo?.estrutura === 'agregador';

  $('bloco-subbloco-valor').hidden = agregador;
  $('campos-subbloco-direto').hidden = agregador;
  $('agregador-explicacao').hidden = !agregador;
  $('campos-parcelamento-subbloco').hidden = agregador
    || $('inp-subbloco-tipo').value !== 'parcelamento';
}

function resetarSubblocoForm() {
  const agora = new Date();
  $('inp-subbloco-nome').value = '';
  $('inp-subbloco-vencimento').value = '';
  $('inp-subbloco-valor').value = '';
  $('inp-subbloco-natureza').value = 'pessoal';
  $('inp-subbloco-tipo').value = 'fixa';
  $('inp-subbloco-parcela-atual').value = '1';
  $('inp-subbloco-parcela-total').value = '';
  $('inp-subbloco-mes-inicio').value = String(agora.getMonth() + 1);
  $('inp-subbloco-ano-inicio').value = String(agora.getFullYear());
}

function abrirModalSubbloco(grupoId, despesa = null) {
  const grupo = grupoPorId(grupoId);
  if (!grupo) return;

  const termos = termosGrupo(grupo);
  state.grupoSubblocoId = grupoId;
  state.subblocoEdicaoId = despesa?.id || null;
  resetarSubblocoForm();

  $('modal-subbloco-titulo').textContent = despesa
    ? `Editar ${termos.singular}`
    : `${capitalizar(novoPara(termos))} ${termos.singular}`;
  $('label-subbloco-nome').textContent = `Nome d${termos.artigo === 'a' ? 'a' : 'o'} ${termos.singular}`;
  $('inp-subbloco-nome').placeholder = grupo.estrutura === 'agregador'
    ? `Ex: Nubank, Inter, Itaú...`
    : `Ex: Aluguel, Energia, Financiamento...`;

  $('subbloco-contexto').innerHTML = `
    <strong>${escapeHtml(grupo.nome)}</strong>
    <span>${grupo.estrutura === 'agregador'
      ? `O vencimento d${termos.artigo === 'a' ? 'a' : 'o'} ${escapeHtml(termos.singular)} será herdado por todas as despesas internas.`
      : `Este ${escapeHtml(termos.singular)} terá valor, natureza e vencimento próprios.`}</span>`;

  if (grupo.estrutura === 'agregador') {
    $('agregador-explicacao').innerHTML = `
      <strong>O valor será calculado automaticamente.</strong>
      <span>Depois de salvar, lance as despesas dentro d${termos.artigo === 'a' ? 'a' : 'o'} ${escapeHtml(termos.singular)}. Todas herdarão o vencimento informado acima.</span>`;
  }

  if (despesa) {
    $('inp-subbloco-nome').value = despesa.nome || '';
    $('inp-subbloco-vencimento').value = despesa.vencimento_dia || '';

    if (grupo.estrutura === 'direto') {
      $('inp-subbloco-valor').value = despesa.valor || '';
      $('inp-subbloco-natureza').value = despesa.natureza || 'pessoal';
      $('inp-subbloco-tipo').value = despesa.tipo || 'fixa';
      $('inp-subbloco-parcela-atual').value = despesa.parcela_atual || 1;
      $('inp-subbloco-parcela-total').value = despesa.parcela_total || '';
      $('inp-subbloco-mes-inicio').value = String(despesa.mes_inicio || new Date().getMonth() + 1);
      $('inp-subbloco-ano-inicio').value = String(despesa.ano_inicio || new Date().getFullYear());
    }
  }

  atualizarCamposSubbloco();
  $('modal-subbloco').hidden = false;
  setTimeout(() => $('inp-subbloco-nome').focus(), 0);
}

function fecharModalSubbloco() {
  $('modal-subbloco').hidden = true;
  state.grupoSubblocoId = null;
  state.subblocoEdicaoId = null;
  state.criarDespesaAposSubbloco = false;
}

function validarParcelamento(prefixo) {
  const parcelaAtual = Number($(`inp-${prefixo}-parcela-atual`).value);
  const parcelaTotal = Number($(`inp-${prefixo}-parcela-total`).value);
  const mesInicio = Number($(`inp-${prefixo}-mes-inicio`).value);
  const anoInicio = Number($(`inp-${prefixo}-ano-inicio`).value);

  if (!Number.isInteger(parcelaAtual) || parcelaAtual < 1) {
    toast('Informe a parcela inicial.', 'aviso');
    return null;
  }
  if (!Number.isInteger(parcelaTotal) || parcelaTotal < 1) {
    toast('Informe o total de parcelas.', 'aviso');
    return null;
  }
  if (parcelaAtual > parcelaTotal) {
    toast('A parcela inicial não pode ser maior que o total.', 'aviso');
    return null;
  }
  if (!Number.isInteger(mesInicio) || !Number.isInteger(anoInicio)) {
    toast('Informe o mês e o ano de início.', 'aviso');
    return null;
  }

  return {
    parcela_atual: parcelaAtual,
    parcela_total: parcelaTotal,
    mes_inicio: mesInicio,
    ano_inicio: anoInicio
  };
}

async function salvarSubbloco() {
  const grupo = grupoPorId(state.grupoSubblocoId);
  if (!grupo) return;

  const termos = termosGrupo(grupo);
  const nome = $('inp-subbloco-nome').value.trim();
  const vencimento = Number($('inp-subbloco-vencimento').value);

  if (!nome) {
    toast(`Informe o nome d${termos.artigo === 'a' ? 'a' : 'o'} ${termos.singular}.`, 'aviso');
    return;
  }
  if (!Number.isInteger(vencimento) || vencimento < 1 || vencimento > 31) {
    toast('Informe um dia de vencimento entre 1 e 31.', 'aviso');
    return;
  }

  const dados = {
    grupo_id: grupo.id,
    estrutura: grupo.estrutura,
    nome,
    vencimento_dia: vencimento
  };

  if (grupo.estrutura === 'agregador') {
    const existente = despesaPorId(state.subblocoEdicaoId);
    dados.itens = existente ? itensNormalizados(existente) : [];
    dados.valor = existente ? totalItens(dados.itens) : 0;
    dados.tipo = 'agregador';
  } else {
    const valor = Number($('inp-subbloco-valor').value);
    const natureza = $('inp-subbloco-natureza').value;
    const tipo = $('inp-subbloco-tipo').value;

    if (!Number.isFinite(valor) || valor <= 0) {
      toast('Informe um valor válido.', 'aviso');
      return;
    }

    Object.assign(dados, { valor, natureza, tipo });

    if (tipo === 'parcelamento') {
      const parcelamento = validarParcelamento('subbloco');
      if (!parcelamento) return;
      Object.assign(dados, parcelamento);
    }
  }

  const btn = $('btn-salvar-subbloco');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const criarDespesaDepois = state.criarDespesaAposSubbloco
    && !state.subblocoEdicaoId
    && grupo.estrutura === 'agregador';
  let novoId = null;

  try {
    if (state.subblocoEdicaoId) {
      await updateDespesa(state.user.uid, state.subblocoEdicaoId, dados);
      toast(`${capitalizar(termos.singular)} atualizado.`, 'sucesso');
    } else {
      const ref = await addDespesa(state.user.uid, dados);
      novoId = ref.id;
      if (grupo.estrutura === 'agregador') state.expandidos.add(ref.id);
      toast(`${capitalizar(termos.singular)} criado.`, 'sucesso');
    }

    fecharModalSubbloco();
    await recarregarDados();

    if (criarDespesaDepois && novoId) {
      const destino = despesaPorId(novoId);
      if (destino) abrirModalItem(destino);
    }
  } catch (erro) {
    console.error('[DriveFinance/despesas/item-categoria]', erro);
    toast(`Não foi possível salvar ${termos.artigo} ${termos.singular}.`, 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

/* ─────────────────────────────────────────────
   Modal de item interno
───────────────────────────────────────────── */

function resetarItemForm() {
  const agora = new Date();
  $('inp-item-nome').value = '';
  $('inp-item-valor').value = '';
  $('inp-item-natureza').value = 'pessoal';
  $('inp-item-tipo').value = 'fixa';
  $('inp-item-parcela-atual').value = '1';
  $('inp-item-parcela-total').value = '';
  $('inp-item-mes-inicio').value = String(agora.getMonth() + 1);
  $('inp-item-ano-inicio').value = String(agora.getFullYear());
  $('campos-parcelamento-item').hidden = true;
}

function abrirModalItem(despesa, item = null) {
  if (!despesa || estruturaDespesa(despesa) !== 'agregador') return;

  state.itemEdicao = {
    despesaId: despesa.id,
    itemId: item?.id || null
  };

  const grupo = grupoPorId(despesa.grupo_id);
  const termos = termosGrupo(grupo);

  resetarItemForm();
  $('modal-item-titulo').textContent = item ? 'Editar despesa' : 'Lançar despesa';
  $('item-heranca-vencimento').innerHTML = `
    <strong>${escapeHtml(despesa.nome)} • ${escapeHtml(grupo?.nome || 'Categoria')}</strong>
    <span>Vencimento herdado d${termos.artigo === 'a' ? 'a' : 'o'} ${escapeHtml(termos.singular)}: dia ${Number(despesa.vencimento_dia) || '-'}</span>`;

  if (item) {
    $('inp-item-nome').value = item.nome || '';
    $('inp-item-valor').value = item.valor || '';
    $('inp-item-natureza').value = item.natureza || 'pessoal';
    $('inp-item-tipo').value = item.tipo || 'fixa';
    $('inp-item-parcela-atual').value = item.parcela_atual || 1;
    $('inp-item-parcela-total').value = item.parcela_total || '';
    $('inp-item-mes-inicio').value = String(item.mes_inicio || new Date().getMonth() + 1);
    $('inp-item-ano-inicio').value = String(item.ano_inicio || new Date().getFullYear());
    $('campos-parcelamento-item').hidden = item.tipo !== 'parcelamento';
  }

  $('modal-item').hidden = false;
  setTimeout(() => $('inp-item-nome').focus(), 0);
}

function fecharModalItem() {
  $('modal-item').hidden = true;
  state.itemEdicao = null;
}

async function salvarItem() {
  if (!state.itemEdicao) return;
  const despesa = despesaPorId(state.itemEdicao.despesaId);
  if (!despesa) return;

  const nome = $('inp-item-nome').value.trim();
  const valor = Number($('inp-item-valor').value);
  const natureza = $('inp-item-natureza').value;
  const tipo = $('inp-item-tipo').value;

  if (!nome) {
    toast('Informe o nome da despesa.', 'aviso');
    return;
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    toast('Informe um valor válido.', 'aviso');
    return;
  }

  const item = {
    id: state.itemEdicao.itemId || gerarIdLocal(),
    nome,
    valor,
    natureza,
    tipo
  };

  if (tipo === 'parcelamento') {
    const parcelamento = validarParcelamento('item');
    if (!parcelamento) return;
    Object.assign(item, parcelamento);
  }

  const itens = itensNormalizados(despesa);
  const indice = itens.findIndex(atual => atual.id === state.itemEdicao.itemId);

  if (indice >= 0) itens[indice] = item;
  else itens.push(item);

  const btn = $('btn-salvar-item');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    await updateDespesa(state.user.uid, despesa.id, {
      itens,
      valor: totalItens(itens),
      estrutura: 'agregador'
    });
    state.expandidos.add(despesa.id);
    toast(indice >= 0 ? 'Despesa atualizada.' : 'Despesa adicionada.', 'sucesso');
    fecharModalItem();
    await recarregarDados();
  } catch (erro) {
    console.error('[DriveFinance/despesas/item]', erro);
    toast('Não foi possível salvar a despesa.', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

/* ─────────────────────────────────────────────
   Exclusão
───────────────────────────────────────────── */

function abrirModalExcluir(config) {
  state.excluir = config;
  $('modal-excluir-titulo').textContent = config.titulo || 'Excluir';
  $('excluir-texto').textContent = config.texto || 'Tem certeza? Essa ação não pode ser desfeita.';
  $('modal-excluir').hidden = false;
}

function fecharModalExcluir() {
  $('modal-excluir').hidden = true;
  state.excluir = null;
}

async function confirmarExcluir() {
  if (!state.excluir) return;
  const btn = $('btn-confirmar-excluir');
  btn.disabled = true;
  btn.textContent = 'Excluindo...';

  try {
    if (state.excluir.tipo === 'grupo') {
      await deleteGrupoDespesa(state.user.uid, state.excluir.id);
      toast('Categoria excluída.', 'sucesso');
    }

    if (state.excluir.tipo === 'subbloco') {
      await deleteDespesa(state.user.uid, state.excluir.id);
      state.expandidos.delete(state.excluir.id);
      toast(state.excluir.mensagemSucesso || 'Item excluído.', 'sucesso');
    }

    if (state.excluir.tipo === 'item') {
      const despesa = despesaPorId(state.excluir.despesaId);
      if (!despesa) throw new Error('Item da categoria não encontrado.');
      const itens = itensNormalizados(despesa)
        .filter(item => item.id !== state.excluir.itemId);
      await updateDespesa(state.user.uid, despesa.id, {
        itens,
        valor: totalItens(itens)
      });
      toast('Despesa excluída.', 'sucesso');
    }

    fecharModalExcluir();
    await recarregarDados();
  } catch (erro) {
    console.error('[DriveFinance/despesas/excluir]', erro);
    toast('Não foi possível concluir a exclusão.', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Excluir';
  }
}

/* ─────────────────────────────────────────────
   Status e pagamentos
───────────────────────────────────────────── */

function abrirModalPagar(despesa) {
  state.pagarId = despesa.id;
  const parcela = calcularParcelaAtual(despesa, state.mesAtual);
  $('modal-pagar-texto').textContent = parcela
    ? `Pagando “${despesa.nome}” — parcela ${parcela}/${despesa.parcela_total}. Como deseja registrar?`
    : `Como deseja registrar o pagamento de “${despesa.nome}”?`;
  $('modal-pagar').hidden = false;
}

function fecharModalPagar() {
  $('modal-pagar').hidden = true;
  state.pagarId = null;
}

async function pagarMes() {
  if (!state.pagarId) return;
  const anoMes = anoMesStr(state.mesAtual);

  try {
    await setStatusMensal(state.user.uid, state.pagarId, anoMes, 'pago');
    toast('Marcado como pago neste mês.', 'sucesso');
    fecharModalPagar();
    await recarregarDados();
  } catch (erro) {
    console.error('[DriveFinance/despesas/pagar-mes]', erro);
    toast('Não foi possível registrar o pagamento.', 'erro');
  }
}

async function pagarTotal() {
  const despesa = despesaPorId(state.pagarId);
  if (!despesa) return;

  try {
    await quitarTudo(state.user.uid, despesa, state.mesAtual);
    toast('Parcelamento quitado.', 'sucesso');
    fecharModalPagar();
    await recarregarDados();
  } catch (erro) {
    console.error('[DriveFinance/despesas/quitar]', erro);
    toast('Não foi possível quitar o parcelamento.', 'erro');
  }
}

async function toggleStatus(id) {
  const despesa = despesaPorId(id);
  if (!despesa) return;

  const anoMes = anoMesStr(state.mesAtual);
  const atual = getStatusMes(despesa, anoMes);

  if (atual === 'pago') {
    try {
      await setStatusMensal(state.user.uid, id, anoMes, 'pendente');
      toast('Marcado como em aberto.', 'info');
      await recarregarDados();
    } catch {
      toast('Não foi possível atualizar o status.', 'erro');
    }
    return;
  }

  if (estruturaDespesa(despesa) === 'direto' && despesa.tipo === 'parcelamento') {
    abrirModalPagar(despesa);
    return;
  }

  try {
    await setStatusMensal(state.user.uid, id, anoMes, 'pago');
    toast('Marcado como pago.', 'sucesso');
    await recarregarDados();
  } catch {
    toast('Não foi possível atualizar o status.', 'erro');
  }
}

/* ─────────────────────────────────────────────
   Eventos
───────────────────────────────────────────── */

function fecharModaisAbertos() {
  if (!$('modal-lancamento').hidden) fecharModalLancamento();
  if (!$('modal-grupo').hidden) fecharModalGrupo();
  if (!$('modal-subbloco').hidden) fecharModalSubbloco();
  if (!$('modal-item').hidden) fecharModalItem();
  if (!$('modal-excluir').hidden) fecharModalExcluir();
  if (!$('modal-pagar').hidden) fecharModalPagar();
}

function bindEvents() {
  $('btn-mes-anterior').addEventListener('click', () => {
    state.mesAtual = avancarMes(state.mesAtual, -1);
    renderMesNav();
    renderPagina();
  });

  $('btn-mes-proximo').addEventListener('click', () => {
    state.mesAtual = avancarMes(state.mesAtual, 1);
    renderMesNav();
    renderPagina();
  });

  $('btn-adicionar-grupo').addEventListener('click', () => abrirModalGrupo());
  $('btn-adicionar-grupo-empty').addEventListener('click', () => abrirModalGrupo());
  $('btn-lancar-despesa').addEventListener('click', () => abrirModalLancamento());

  $('inp-lancamento-grupo').addEventListener('change', atualizarDestinoLancamento);
  $('btn-fechar-lancamento').addEventListener('click', fecharModalLancamento);
  $('btn-cancelar-lancamento').addEventListener('click', fecharModalLancamento);
  $('btn-continuar-lancamento').addEventListener('click', continuarLancamento);
  $('btn-lancamento-nova-categoria').addEventListener('click', criarCategoriaDoLancamento);

  document.querySelectorAll('[data-filtro]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-filtro]').forEach(item => item.classList.remove('chip-ativo'));
      chip.classList.add('chip-ativo');
      state.filtro = chip.dataset.filtro;
      renderPagina();
    });
  });

  $('select-ordenar').addEventListener('change', event => {
    state.ordenar = event.target.value;
    renderPagina();
  });

  $('inp-grupo-estrutura').addEventListener('change', atualizarHintEstruturaGrupo);
  $('btn-fechar-grupo').addEventListener('click', fecharModalGrupo);
  $('btn-cancelar-grupo').addEventListener('click', fecharModalGrupo);
  $('btn-salvar-grupo').addEventListener('click', salvarGrupo);

  $('inp-subbloco-tipo').addEventListener('change', atualizarCamposSubbloco);
  $('btn-fechar-subbloco').addEventListener('click', fecharModalSubbloco);
  $('btn-cancelar-subbloco').addEventListener('click', fecharModalSubbloco);
  $('btn-salvar-subbloco').addEventListener('click', salvarSubbloco);

  $('inp-item-tipo').addEventListener('change', event => {
    $('campos-parcelamento-item').hidden = event.target.value !== 'parcelamento';
  });
  $('btn-fechar-item').addEventListener('click', fecharModalItem);
  $('btn-cancelar-item').addEventListener('click', fecharModalItem);
  $('btn-salvar-item').addEventListener('click', salvarItem);

  $('btn-fechar-excluir').addEventListener('click', fecharModalExcluir);
  $('btn-cancelar-excluir').addEventListener('click', fecharModalExcluir);
  $('btn-confirmar-excluir').addEventListener('click', confirmarExcluir);

  $('btn-fechar-pagar').addEventListener('click', fecharModalPagar);
  $('btn-pagar-mes').addEventListener('click', pagarMes);
  $('btn-pagar-total').addEventListener('click', pagarTotal);

  $('btn-encerrados').addEventListener('click', () => {
    const aberto = $('btn-encerrados').getAttribute('aria-expanded') === 'true';
    $('btn-encerrados').setAttribute('aria-expanded', String(!aberto));
    $('encerrados-lista').hidden = aberto;
  });

  $('grupos-grid').addEventListener('click', event => {
    const btn = event.target.closest('[data-acao]');
    if (!btn) return;

    const acao = btn.dataset.acao;
    const id = btn.dataset.id;
    const itemId = btn.dataset.itemId;

    if (acao === 'editar-grupo') {
      abrirModalGrupo(grupoPorId(id));
      return;
    }

    if (acao === 'excluir-grupo') {
      const grupo = grupoPorId(id);
      const termos = termosGrupo(grupo);
      const possuiItens = state.despesas.some(d => d.grupo_id === id);
      if (possuiItens) {
        toast(`Exclua ${termos.artigoPlural} ${termos.plural} antes de remover esta categoria.`, 'aviso');
        return;
      }
      abrirModalExcluir({
        tipo: 'grupo',
        id,
        titulo: 'Excluir categoria',
        texto: `Excluir a categoria “${grupo?.nome || 'selecionada'}”? Essa ação não pode ser desfeita.`
      });
      return;
    }

    if (acao === 'adicionar-subbloco') {
      abrirModalSubbloco(id);
      return;
    }

    if (acao === 'editar-subbloco') {
      const despesa = despesaPorId(id);
      if (despesa) abrirModalSubbloco(despesa.grupo_id, despesa);
      return;
    }

    if (acao === 'excluir-subbloco') {
      const despesa = despesaPorId(id);
      const grupo = grupoPorId(despesa?.grupo_id);
      const termos = termosGrupo(grupo);
      const sufixo = grupo?.estrutura === 'agregador'
        ? ' e todas as despesas internas'
        : '';
      const participio = termos.artigo === 'a' ? 'excluída' : 'excluído';

      abrirModalExcluir({
        tipo: 'subbloco',
        id,
        titulo: `Excluir ${termos.singular}`,
        texto: `Excluir “${despesa?.nome || `este ${termos.singular}`}”${sufixo}? Essa ação não pode ser desfeita.`,
        mensagemSucesso: `${capitalizar(termos.singular)} ${participio}.`
      });
      return;
    }

    if (acao === 'toggle-itens') {
      if (state.expandidos.has(id)) state.expandidos.delete(id);
      else state.expandidos.add(id);
      renderPagina();
      return;
    }

    if (acao === 'adicionar-item') {
      abrirModalItem(despesaPorId(id));
      return;
    }

    if (acao === 'editar-item') {
      const despesa = despesaPorId(id);
      const item = itensNormalizados(despesa).find(atual => atual.id === itemId);
      if (item) abrirModalItem(despesa, item);
      return;
    }

    if (acao === 'excluir-item') {
      const despesa = despesaPorId(id);
      const grupo = grupoPorId(despesa?.grupo_id);
      const termos = termosGrupo(grupo);
      const item = itensNormalizados(despesa).find(atual => atual.id === itemId);
      abrirModalExcluir({
        tipo: 'item',
        despesaId: id,
        itemId,
        titulo: 'Excluir despesa',
        texto: `Excluir “${item?.nome || 'esta despesa'}” d${termos.artigo === 'a' ? 'a' : 'o'} ${termos.singular} “${despesa?.nome || ''}”?`
      });
      return;
    }

    if (acao === 'toggle-status') toggleStatus(id);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') fecharModaisAbertos();
  });
}

async function init() {
  try {
    state.user = await exigirLogin();
    const { permitido, motivo, perfil } = await verificarAcesso(state.user.uid);

    if (!permitido) {
      window.location.href = motivo === 'trial_expirado' || motivo === 'plano_expirado'
        ? 'landing.html#planos'
        : 'login.html';
      return;
    }

    state.perfil = perfil;
    renderNav('despesas.html', perfil, { paginasProntas: PAGINAS_PRONTAS });
    preencherSelectMeses();
    renderMesNav();
    bindEvents();
    await garantirEstruturaInicial();
    renderPagina();
  } catch (erro) {
    console.error('[DriveFinance/despesas]', erro);
    toast('Erro ao carregar despesas. Recarregue a página.', 'erro');
  }
}

init();
