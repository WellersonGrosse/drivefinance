// ─────────────────────────────────────────────
// DriveFinance — despesas.js
// Gestao de despesas e dividas mensais
// ─────────────────────────────────────────────

import {
  exigirLogin,
  verificarAcesso,
  getDespesas,
  addDespesa,
  updateDespesa,
  deleteDespesa,
  formatReal,
  toast,
  renderNav
} from './app.js';

// Funcoes de status mensal (implementadas abaixo via app.js wrappers)
import { db } from './firebase-config.js';
import {
  doc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const PAGINAS_PRONTAS = new Set([
  'home.html', 'admin.html', 'configuracoes.html',
  'custo-operacional.html', 'despesas.html'
]);

// ── Estado da pagina ──────────────────────────
const state = {
  user: null,
  perfil: null,
  despesas: [],          // todas as despesas do usuario
  filtro: 'todos',       // 'todos' | 'trabalho' | 'pessoal'
  ordenar: 'vencimento', // 'vencimento' | 'valor' | 'nome' | 'status'
  mesAtual: new Date(),  // Date representando o mes exibido
  modoEdicao: null,      // id da despesa sendo editada, ou null
  excluirId: null,       // id para excluir
  pagarId: null,         // id para pagar
};

const $ = (id) => document.getElementById(id);

// ── Utilitarios de mes ───────────────────────

function anoMesStr(date) {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}`;
}

function labelMes(date) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
}

function avancarMes(date, delta) {
  const d = new Date(date);
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  return d;
}

// ── Calculo de parcela atual ─────────────────
// Calcula qual e a parcela no mes exibido, a partir do mes/ano de inicio.
// Retorna null se a despesa nao e parcelamento ou se o calculo nao e possivel.
function calcularParcelaAtual(despesa, mesRef) {
  if (despesa.tipo !== 'parcelamento') return null;
  if (!despesa.mes_inicio || !despesa.ano_inicio || !despesa.parcela_total) return null;

  const anoRef  = mesRef.getFullYear();
  const mesNumRef = mesRef.getMonth() + 1; // 1-12

  // Quantos meses se passaram desde o inicio
  const diffMeses = (anoRef - despesa.ano_inicio) * 12 + (mesNumRef - despesa.mes_inicio);
  const parcelaAtual = (despesa.parcela_atual || 1) + diffMeses;

  if (parcelaAtual < 1 || parcelaAtual > despesa.parcela_total) return null;
  return parcelaAtual;
}

// Verifica se a despesa esta ativa no mes de referencia
function despesaAtivaNoMes(despesa, mesRef) {
  if (despesa.tipo === 'fixa') return true;
  if (despesa.tipo !== 'parcelamento') return true;

  const parcela = calcularParcelaAtual(despesa, mesRef);
  return parcela !== null;
}

// Verifica se o parcelamento esta encerrado (todas as parcelas pagas ou mes alem do fim)
function parcelamentoEncerrado(despesa, mesRef) {
  if (despesa.tipo !== 'parcelamento') return false;
  const anoRef = mesRef.getFullYear();
  const mesNumRef = mesRef.getMonth() + 1;

  // Verifica se todas as parcelas foram pagas via status_mensal
  const statusMap = despesa.status_mensal || {};
  const totalPagas = Object.values(statusMap).filter(v => v === 'pago').length;
  if (totalPagas >= (despesa.parcela_total || 1)) return true;

  // Verifica se o mes de referencia esta alem do fim natural
  if (!despesa.mes_inicio || !despesa.ano_inicio || !despesa.parcela_total) return false;
  const diffMeses = (anoRef - despesa.ano_inicio) * 12 + (mesNumRef - despesa.mes_inicio);
  return diffMeses >= despesa.parcela_total;
}

// ── Status mensal ────────────────────────────

function getStatusMes(despesa, anoMes) {
  return (despesa.status_mensal || {})[anoMes] || 'pendente';
}

// Atualiza status_mensal no Firestore diretamente (sem nova funcao em app.js)
async function setStatusMensal(uid, despesaId, anoMes, status) {
  const campo = `status_mensal.${anoMes}`;
  await updateDoc(doc(db, 'users', uid, 'despesas', despesaId), {
    [campo]: status
  });
}

// Quita todas as parcelas restantes a partir do mes atual
async function quitarTudo(uid, despesa, mesRef) {
  if (!despesa.mes_inicio || !despesa.ano_inicio || !despesa.parcela_total) return;

  const parcelaAtual = calcularParcelaAtual(despesa, mesRef);
  if (!parcelaAtual) return;

  const atualizacoes = {};
  const parcelasRestantes = despesa.parcela_total - parcelaAtual + 1;

  for (let i = 0; i < parcelasRestantes; i++) {
    const d = avancarMes(mesRef, i);
    const am = anoMesStr(d);
    atualizacoes[`status_mensal.${am}`] = 'pago';
  }

  await updateDoc(doc(db, 'users', uid, 'despesas', despesa.id), atualizacoes);
}

// ── Ordenacao ────────────────────────────────

function ordenarDespesas(lista, criterio, mesRef) {
  const anoMes = anoMesStr(mesRef);
  return [...lista].sort((a, b) => {
    if (criterio === 'valor') return (b.valor || 0) - (a.valor || 0);
    if (criterio === 'nome')  return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
    if (criterio === 'status') {
      const sa = getStatusMes(a, anoMes);
      const sb = getStatusMes(b, anoMes);
      if (sa === sb) return 0;
      return sa === 'pendente' ? -1 : 1;
    }
    // vencimento (padrao)
    return (a.vencimento_dia || 31) - (b.vencimento_dia || 31);
  });
}

// ── Renderizacao ─────────────────────────────

function renderMesNav() {
  $('mes-label').textContent = labelMes(state.mesAtual);
}

function htmlBtnStatus(despesa, anoMes) {
  const status = getStatusMes(despesa, anoMes);
  const pago = status === 'pago';
  const cls  = pago ? 'status-pago' : 'status-pendente';
  const icon = pago
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>';
  const label = pago ? 'Pago' : 'Pendente';
  return `<button class="btn-status ${cls}" data-acao="toggle-status" data-id="${despesa.id}" aria-label="Status: ${label}">${icon}${label}</button>`;
}

function htmlAcoes(despesaId) {
  return `
    <div class="acoes-wrap">
      <button class="btn-acao" data-acao="editar" data-id="${despesaId}" aria-label="Editar">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
      </button>
      <button class="btn-acao btn-acao-excluir" data-acao="excluir" data-id="${despesaId}" aria-label="Excluir">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
      </button>
    </div>`;
}

function htmlTipoBadge(tipo) {
  if (tipo === 'fixa') return '<span class="td-tipo-badge td-tipo-fixa">Fixa</span>';
  return '<span class="td-tipo-badge td-tipo-parcelamento">Parcelamento</span>';
}

function labelParcela(despesa, mesRef) {
  if (despesa.tipo !== 'parcelamento') return '-';
  const parcela = calcularParcelaAtual(despesa, mesRef);
  if (!parcela) return '-';
  return `${parcela}/${despesa.parcela_total}`;
}

function renderTr(despesa, anoMes, mesRef) {
  return `
    <tr>
      <td class="td-nome"><span class="td-nome-text" title="${despesa.nome || ''}">${despesa.nome || '-'}</span></td>
      <td>${htmlTipoBadge(despesa.tipo)}</td>
      <td class="td-parcela">${labelParcela(despesa, mesRef)}</td>
      <td class="td-vencimento">Dia ${despesa.vencimento_dia || '-'}</td>
      <td class="td-valor">${formatReal(despesa.valor)}</td>
      <td>${htmlBtnStatus(despesa, anoMes)}</td>
      <td class="td-acoes">${htmlAcoes(despesa.id)}</td>
    </tr>`;
}

function renderCard(despesa, anoMes, mesRef) {
  const parcela = labelParcela(despesa, mesRef);
  const tipo = despesa.tipo === 'fixa' ? 'Fixa' : 'Parcelamento';
  return `
    <div class="despesa-card">
      <div class="despesa-card-top">
        <span class="despesa-card-nome" title="${despesa.nome || ''}">${despesa.nome || '-'}</span>
        <span class="despesa-card-valor">${formatReal(despesa.valor)}</span>
      </div>
      <div class="despesa-card-meta">
        <span class="despesa-card-meta-item">${tipo}</span>
        ${parcela !== '-' ? `<span class="despesa-card-meta-sep"></span><span class="despesa-card-meta-item">${parcela}</span>` : ''}
        <span class="despesa-card-meta-sep"></span>
        <span class="despesa-card-meta-item">Vence dia ${despesa.vencimento_dia || '-'}</span>
      </div>
      <div class="despesa-card-footer">
        ${htmlBtnStatus(despesa, anoMes)}
        <div class="despesa-card-acoes">
          <button class="btn-acao" data-acao="editar" data-id="${despesa.id}" aria-label="Editar">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
          </button>
          <button class="btn-acao btn-acao-excluir" data-acao="excluir" data-id="${despesa.id}" aria-label="Excluir">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}

function renderEncerradoTr(despesa) {
  return `
    <tr class="tr-encerrada">
      <td class="td-nome"><span class="td-nome-text">${despesa.nome || '-'}</span></td>
      <td>${despesa.natureza === 'trabalho' ? 'Trabalho' : 'Pessoal'}</td>
      <td class="td-parcela">${despesa.parcela_total || '-'} parcelas</td>
      <td class="td-vencimento">Dia ${despesa.vencimento_dia || '-'}</td>
      <td class="td-valor">${formatReal(despesa.valor)}</td>
      <td class="td-acoes">${htmlAcoes(despesa.id)}</td>
    </tr>`;
}

function renderEncerradoCard(despesa) {
  return `
    <div class="despesa-card despesa-card-encerrada">
      <div class="despesa-card-top">
        <span class="despesa-card-nome">${despesa.nome || '-'}</span>
        <span class="despesa-card-valor">${formatReal(despesa.valor)}</span>
      </div>
      <div class="despesa-card-meta">
        <span class="despesa-card-meta-item">${despesa.parcela_total || '-'} parcelas</span>
        <span class="despesa-card-meta-sep"></span>
        <span class="despesa-card-meta-item">Dia ${despesa.vencimento_dia || '-'}</span>
        <span class="despesa-card-meta-sep"></span>
        <span class="despesa-card-meta-item">${despesa.natureza === 'trabalho' ? 'Trabalho' : 'Pessoal'}</span>
      </div>
      <div class="despesa-card-footer">
        <div class="despesa-card-acoes">
          <button class="btn-acao" data-acao="editar" data-id="${despesa.id}" aria-label="Editar">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
          </button>
          <button class="btn-acao btn-acao-excluir" data-acao="excluir" data-id="${despesa.id}" aria-label="Excluir">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}

function renderLista() {
  const mesRef  = state.mesAtual;
  const anoMes  = anoMesStr(mesRef);
  const filtro  = state.filtro;
  const ordenar = state.ordenar;

  // Separa ativas e encerradas no mes atual
  const ativas     = state.despesas.filter(d => despesaAtivaNoMes(d, mesRef));
  const encerradas = state.despesas.filter(d => parcelamentoEncerrado(d, mesRef));

  // Aplica filtro de natureza
  const ativasFiltradas = filtro === 'todos'
    ? ativas
    : ativas.filter(d => d.natureza === filtro);

  const trabalho = ordenarDespesas(ativasFiltradas.filter(d => d.natureza === 'trabalho'), ordenar, mesRef);
  const pessoal  = ordenarDespesas(ativasFiltradas.filter(d => d.natureza === 'pessoal'),  ordenar, mesRef);

  // Totais
  const totalTrabalho = trabalho.reduce((s, d) => s + (d.valor || 0), 0);
  const totalPessoal  = pessoal.reduce((s, d) => s + (d.valor || 0), 0);
  const totalGeral    = totalTrabalho + totalPessoal;

  // Quantas foram pagas no mes
  const pagas = ativasFiltradas.filter(d => getStatusMes(d, anoMes) === 'pago');
  const pct   = ativasFiltradas.length > 0
    ? Math.round((pagas.length / ativasFiltradas.length) * 100)
    : 0;

  // Atualiza cards de resumo
  $('total-trabalho').textContent = formatReal(totalTrabalho);
  $('total-pessoal').textContent  = formatReal(totalPessoal);
  $('total-geral').textContent    = formatReal(totalGeral);
  $('count-trabalho').textContent = `${trabalho.length} ${trabalho.length === 1 ? 'despesa' : 'despesas'}`;
  $('count-pessoal').textContent  = `${pessoal.length} ${pessoal.length === 1 ? 'despesa' : 'despesas'}`;
  $('resumo-fill').style.width    = `${pct}%`;
  $('resumo-pago-pct').textContent = `${pct}% pago`;

  // Grupo trabalho
  $('badge-trabalho').textContent    = trabalho.length;
  $('subtotal-trabalho').textContent = formatReal(totalTrabalho);
  $('tbody-trabalho').innerHTML      = trabalho.map(d => renderTr(d, anoMes, mesRef)).join('');
  $('cards-trabalho').innerHTML      = trabalho.map(d => renderCard(d, anoMes, mesRef)).join('');
  $('empty-trabalho').hidden         = trabalho.length > 0;

  // Grupo pessoal
  $('badge-pessoal').textContent    = pessoal.length;
  $('subtotal-pessoal').textContent = formatReal(totalPessoal);
  $('tbody-pessoal').innerHTML      = pessoal.map(d => renderTr(d, anoMes, mesRef)).join('');
  $('cards-pessoal').innerHTML      = pessoal.map(d => renderCard(d, anoMes, mesRef)).join('');
  $('empty-pessoal').hidden         = pessoal.length > 0;

  // Empty global
  $('empty-global').hidden = (trabalho.length + pessoal.length) > 0 || encerradas.length > 0;

  // Oculta grupos se filtro nao se aplica
  $('grupo-trabalho').hidden = filtro === 'pessoal';
  $('grupo-pessoal').hidden  = filtro === 'trabalho';

  // Secao encerrados
  const encSection = $('encerrados-section');
  encSection.hidden = encerradas.length === 0;
  if (encerradas.length > 0) {
    $('count-encerrados').textContent = encerradas.length;
    $('tbody-encerrados').innerHTML   = encerradas.map(renderEncerradoTr).join('');
    $('cards-encerrados').innerHTML   = encerradas.map(renderEncerradoCard).join('');
  }
}

// ── Modal form ───────────────────────────────

function abrirModalAdicionar() {
  state.modoEdicao = null;
  $('modal-form-titulo').textContent = 'Adicionar despesa';
  $('inp-nome').value       = '';
  $('inp-natureza').value   = 'pessoal';
  $('inp-tipo').value       = 'fixa';
  $('inp-valor').value      = '';
  $('inp-vencimento').value = '';
  $('inp-parcela-atual').value  = '1';
  $('inp-parcela-total').value  = '';
  $('inp-mes-inicio').value = String(new Date().getMonth() + 1);
  $('inp-ano-inicio').value = String(new Date().getFullYear());
  $('inp-retroativo').checked = false;
  $('campos-parcelamento').hidden = true;
  $('opcao-retroativo').hidden    = true;
  $('modal-form').hidden = false;
}

function abrirModalEditar(despesa) {
  state.modoEdicao = despesa.id;
  $('modal-form-titulo').textContent = 'Editar despesa';
  $('inp-nome').value       = despesa.nome || '';
  $('inp-natureza').value   = despesa.natureza || 'pessoal';
  $('inp-tipo').value       = despesa.tipo || 'fixa';
  $('inp-valor').value      = despesa.valor || '';
  $('inp-vencimento').value = despesa.vencimento_dia || '';
  $('inp-parcela-atual').value  = despesa.parcela_atual || 1;
  $('inp-parcela-total').value  = despesa.parcela_total || '';
  $('inp-mes-inicio').value = String(despesa.mes_inicio || new Date().getMonth() + 1);
  $('inp-ano-inicio').value = String(despesa.ano_inicio || new Date().getFullYear());
  $('inp-retroativo').checked = false;
  $('campos-parcelamento').hidden = despesa.tipo !== 'parcelamento';
  $('opcao-retroativo').hidden    = false;
  $('modal-form').hidden = false;
}

function fecharModalForm() {
  $('modal-form').hidden = true;
  state.modoEdicao = null;
}

async function salvarForm() {
  const nome          = $('inp-nome').value.trim();
  const natureza      = $('inp-natureza').value;
  const tipo          = $('inp-tipo').value;
  const valor         = parseFloat($('inp-valor').value);
  const vencimento    = parseInt($('inp-vencimento').value, 10);
  const retroativo    = $('inp-retroativo').checked;

  if (!nome)            { toast('Informe o nome da despesa.', 'aviso'); return; }
  if (isNaN(valor) || valor <= 0) { toast('Informe um valor valido.', 'aviso'); return; }
  if (!vencimento || vencimento < 1 || vencimento > 31) {
    toast('Informe um dia de vencimento entre 1 e 31.', 'aviso');
    return;
  }

  const dados = { nome, natureza, tipo, valor, vencimento_dia: vencimento };

  if (tipo === 'parcelamento') {
    const parcelaAtual = parseInt($('inp-parcela-atual').value, 10);
    const parcelaTotal = parseInt($('inp-parcela-total').value, 10);
    const mesInicio    = parseInt($('inp-mes-inicio').value, 10);
    const anoInicio    = parseInt($('inp-ano-inicio').value, 10);

    if (isNaN(parcelaAtual) || parcelaAtual < 1) { toast('Informe a parcela inicial.', 'aviso'); return; }
    if (isNaN(parcelaTotal) || parcelaTotal < 1) { toast('Informe o total de parcelas.', 'aviso'); return; }
    if (parcelaAtual > parcelaTotal)              { toast('A parcela inicial nao pode ser maior que o total.', 'aviso'); return; }
    if (isNaN(mesInicio) || isNaN(anoInicio))     { toast('Informe mes e ano de inicio.', 'aviso'); return; }

    dados.parcela_atual = parcelaAtual;
    dados.parcela_total = parcelaTotal;
    dados.mes_inicio    = mesInicio;
    dados.ano_inicio    = anoInicio;
  }

  const btn = $('btn-salvar-form');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    if (state.modoEdicao) {
      // Em edicao: se retroativo, limpa status_mensal para recalcular
      if (retroativo) dados.status_mensal = {};
      await updateDespesa(state.user.uid, state.modoEdicao, dados);
      toast('Despesa atualizada.', 'sucesso');
    } else {
      await addDespesa(state.user.uid, dados);
      toast('Despesa adicionada.', 'sucesso');
    }

    fecharModalForm();
    await recarregarDespesas();
  } catch (err) {
    console.error('[DriveFinance/despesas]', err);
    toast('Erro ao salvar. Tente novamente.', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

// ── Modal excluir ────────────────────────────

function abrirModalExcluir(id) {
  const despesa = state.despesas.find(d => d.id === id);
  if (!despesa) return;
  state.excluirId = id;
  $('excluir-nome').textContent = despesa.nome || 'esta despesa';
  $('modal-excluir').hidden = false;
}

function fecharModalExcluir() {
  $('modal-excluir').hidden = true;
  state.excluirId = null;
}

async function confirmarExcluir() {
  if (!state.excluirId) return;
  const btn = $('btn-confirmar-excluir');
  btn.disabled = true;
  btn.textContent = 'Excluindo...';
  try {
    await deleteDespesa(state.user.uid, state.excluirId);
    toast('Despesa excluida.', 'sucesso');
    fecharModalExcluir();
    await recarregarDespesas();
  } catch (err) {
    console.error('[DriveFinance/despesas]', err);
    toast('Erro ao excluir. Tente novamente.', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Excluir';
  }
}

// ── Modal pagar parcelamento ─────────────────

function abrirModalPagar(id) {
  const despesa = state.despesas.find(d => d.id === id);
  if (!despesa) return;
  state.pagarId = id;
  const anoMes  = anoMesStr(state.mesAtual);
  const parcela = calcularParcelaAtual(despesa, state.mesAtual);
  $('modal-pagar-texto').textContent = parcela
    ? `Pagando "${despesa.nome}" — parcela ${parcela}/${despesa.parcela_total}. Como deseja registrar?`
    : `Como deseja registrar o pagamento de "${despesa.nome}"?`;
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
    // Atualiza local sem recarregar do Firestore para resposta imediata
    const d = state.despesas.find(x => x.id === state.pagarId);
    if (d) {
      d.status_mensal = d.status_mensal || {};
      d.status_mensal[anoMes] = 'pago';
    }
    toast('Marcado como pago neste mes.', 'sucesso');
    fecharModalPagar();
    renderLista();
  } catch (err) {
    console.error('[DriveFinance/despesas]', err);
    toast('Erro ao registrar pagamento.', 'erro');
  }
}

async function pagarTotal() {
  if (!state.pagarId) return;
  const despesa = state.despesas.find(d => d.id === state.pagarId);
  if (!despesa) return;
  try {
    await quitarTudo(state.user.uid, despesa, state.mesAtual);
    toast('Parcelamento quitado.', 'sucesso');
    fecharModalPagar();
    await recarregarDespesas();
  } catch (err) {
    console.error('[DriveFinance/despesas]', err);
    toast('Erro ao quitar. Tente novamente.', 'erro');
  }
}

// ── Toggle status direto (despesa fixa ou desfazer pago) ──

async function toggleStatus(id) {
  const despesa = state.despesas.find(d => d.id === id);
  if (!despesa) return;

  const anoMes = anoMesStr(state.mesAtual);
  const statusAtual = getStatusMes(despesa, anoMes);

  // Se ja esta pago: desfaz (volta para pendente)
  if (statusAtual === 'pago') {
    try {
      await setStatusMensal(state.user.uid, id, anoMes, 'pendente');
      despesa.status_mensal = despesa.status_mensal || {};
      despesa.status_mensal[anoMes] = 'pendente';
      toast('Marcado como pendente.', 'info');
      renderLista();
    } catch (err) {
      toast('Erro ao atualizar status.', 'erro');
    }
    return;
  }

  // Se e parcelamento: abre modal de escolha
  if (despesa.tipo === 'parcelamento') {
    abrirModalPagar(id);
    return;
  }

  // Despesa fixa: marca direto como pago
  try {
    await setStatusMensal(state.user.uid, id, anoMes, 'pago');
    despesa.status_mensal = despesa.status_mensal || {};
    despesa.status_mensal[anoMes] = 'pago';
    toast('Marcado como pago.', 'sucesso');
    renderLista();
  } catch (err) {
    toast('Erro ao atualizar status.', 'erro');
  }
}

// ── Carregamento de dados ────────────────────

async function recarregarDespesas() {
  state.despesas = await getDespesas(state.user.uid);
  renderLista();
}

// ── Eventos ──────────────────────────────────

function bindEvents() {
  // Navegacao de mes
  $('btn-mes-anterior').addEventListener('click', () => {
    state.mesAtual = avancarMes(state.mesAtual, -1);
    renderMesNav();
    renderLista();
  });

  $('btn-mes-proximo').addEventListener('click', () => {
    state.mesAtual = avancarMes(state.mesAtual, 1);
    renderMesNav();
    renderLista();
  });

  // Botao adicionar
  $('btn-adicionar').addEventListener('click', abrirModalAdicionar);
  $('btn-adicionar-empty').addEventListener('click', abrirModalAdicionar);

  // Filtros chips
  document.querySelectorAll('.chip[data-filtro]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip[data-filtro]').forEach(c => c.classList.remove('chip-ativo'));
      chip.classList.add('chip-ativo');
      state.filtro = chip.dataset.filtro;
      renderLista();
    });
  });

  // Ordenacao
  $('select-ordenar').addEventListener('change', (e) => {
    state.ordenar = e.target.value;
    renderLista();
  });

  // Modal form
  $('inp-tipo').addEventListener('change', (e) => {
    $('campos-parcelamento').hidden = e.target.value !== 'parcelamento';
  });

  $('btn-fechar-form').addEventListener('click', fecharModalForm);
  $('btn-cancelar-form').addEventListener('click', fecharModalForm);
  $('btn-salvar-form').addEventListener('click', salvarForm);

  // Modal excluir
  $('btn-fechar-excluir').addEventListener('click', fecharModalExcluir);
  $('btn-cancelar-excluir').addEventListener('click', fecharModalExcluir);
  $('btn-confirmar-excluir').addEventListener('click', confirmarExcluir);

  // Modal pagar
  $('btn-fechar-pagar').addEventListener('click', fecharModalPagar);
  $('btn-pagar-mes').addEventListener('click', pagarMes);
  $('btn-pagar-total').addEventListener('click', pagarTotal);

  // Fechar modais com Escape
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('modal-form').hidden)    fecharModalForm();
    if (!$('modal-excluir').hidden) fecharModalExcluir();
    if (!$('modal-pagar').hidden)   fecharModalPagar();
  });

  // Secao encerrados toggle
  $('btn-encerrados').addEventListener('click', () => {
    const expandido = $('btn-encerrados').getAttribute('aria-expanded') === 'true';
    $('btn-encerrados').setAttribute('aria-expanded', String(!expandido));
    $('encerrados-lista').hidden = expandido;
  });

  // Delegacao de eventos na lista (editar, excluir, toggle-status)
  $('lista-despesas').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-acao]');
    if (!btn) return;
    const id   = btn.dataset.id;
    const acao = btn.dataset.acao;

    if (acao === 'editar') {
      const despesa = state.despesas.find(d => d.id === id);
      if (despesa) abrirModalEditar(despesa);
    } else if (acao === 'excluir') {
      abrirModalExcluir(id);
    } else if (acao === 'toggle-status') {
      toggleStatus(id);
    }
  });

  // Delegacao para encerrados
  $('encerrados-lista').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-acao]');
    if (!btn) return;
    const id   = btn.dataset.id;
    const acao = btn.dataset.acao;

    if (acao === 'editar') {
      const despesa = state.despesas.find(d => d.id === id);
      if (despesa) abrirModalEditar(despesa);
    } else if (acao === 'excluir') {
      abrirModalExcluir(id);
    }
  });
}

// ── Inicializacao ────────────────────────────

async function init() {
  try {
    state.user = await exigirLogin();
    const { permitido, motivo, perfil } = await verificarAcesso(state.user.uid);

    if (!permitido) {
      window.location.href = motivo === 'trial_expirado' || motivo === 'plano_expirado'
        ? 'planos.html'
        : 'login.html';
      return;
    }

    state.perfil = perfil;
    renderNav('despesas.html', perfil, { paginasProntas: PAGINAS_PRONTAS });
    renderMesNav();

    state.despesas = await getDespesas(state.user.uid);
    renderLista();
    bindEvents();
  } catch (err) {
    console.error('[DriveFinance/despesas]', err);
    toast('Erro ao carregar despesas. Recarregue a pagina.', 'erro');
  }
}

init();
