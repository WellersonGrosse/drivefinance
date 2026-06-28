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

import { db } from './firebase-config.js';
import {
  doc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const PAGINAS_PRONTAS = new Set([
  'home.html', 'admin.html', 'configuracoes.html',
  'custo-operacional.html', 'despesas.html'
]);

// ── Estado ────────────────────────────────────
const state = {
  user: null,
  perfil: null,
  despesas: [],
  filtro: 'todos',
  ordenar: 'vencimento',
  mesAtual: new Date(),
  modoEdicao: null,
  excluirId: null,
  pagarId: null,
  itensForm: [],        // itens editaveis no modal
  expandidos: new Set() // ids com sublista expandida na tabela
};

const $ = (id) => document.getElementById(id);

// ── Utilitarios de mes ────────────────────────

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

// ── Itens da despesa ─────────────────────────

function somaItens(itens) {
  if (!Array.isArray(itens) || itens.length === 0) return 0;
  return itens.reduce((s, it) => s + (parseFloat(it.valor) || 0), 0);
}

function temItens(despesa) {
  return Array.isArray(despesa.itens) && despesa.itens.length > 0;
}

// ── Calculo de parcela atual ──────────────────

function calcularParcelaAtual(despesa, mesRef) {
  if (despesa.tipo !== 'parcelamento') return null;
  if (!despesa.mes_inicio || !despesa.ano_inicio || !despesa.parcela_total) return null;

  const anoRef    = mesRef.getFullYear();
  const mesNumRef = mesRef.getMonth() + 1;
  const diffMeses = (anoRef - despesa.ano_inicio) * 12 + (mesNumRef - despesa.mes_inicio);
  const parcelaAtual = (despesa.parcela_atual || 1) + diffMeses;

  if (parcelaAtual < 1 || parcelaAtual > despesa.parcela_total) return null;
  return parcelaAtual;
}

function despesaAtivaNoMes(despesa, mesRef) {
  if (despesa.tipo === 'fixa') return true;
  if (despesa.tipo !== 'parcelamento') return true;
  return calcularParcelaAtual(despesa, mesRef) !== null;
}

function parcelamentoEncerrado(despesa, mesRef) {
  if (despesa.tipo !== 'parcelamento') return false;
  const anoRef    = mesRef.getFullYear();
  const mesNumRef = mesRef.getMonth() + 1;

  const statusMap  = despesa.status_mensal || {};
  const totalPagas = Object.values(statusMap).filter(v => v === 'pago').length;
  if (totalPagas >= (despesa.parcela_total || 1)) return true;

  if (!despesa.mes_inicio || !despesa.ano_inicio || !despesa.parcela_total) return false;
  const diffMeses = (anoRef - despesa.ano_inicio) * 12 + (mesNumRef - despesa.mes_inicio);
  return diffMeses >= despesa.parcela_total;
}

// ── Status mensal ─────────────────────────────

function getStatusMes(despesa, anoMes) {
  return (despesa.status_mensal || {})[anoMes] || 'pendente';
}

async function setStatusMensal(uid, despesaId, anoMes, status) {
  const campo = `status_mensal.${anoMes}`;
  await updateDoc(doc(db, 'users', uid, 'despesas', despesaId), { [campo]: status });
}

async function quitarTudo(uid, despesa, mesRef) {
  if (!despesa.mes_inicio || !despesa.ano_inicio || !despesa.parcela_total) return;
  const parcelaAtual = calcularParcelaAtual(despesa, mesRef);
  if (!parcelaAtual) return;

  const atualizacoes = {};
  const restantes = despesa.parcela_total - parcelaAtual + 1;
  for (let i = 0; i < restantes; i++) {
    const am = anoMesStr(avancarMes(mesRef, i));
    atualizacoes[`status_mensal.${am}`] = 'pago';
  }
  await updateDoc(doc(db, 'users', uid, 'despesas', despesa.id), atualizacoes);
}

// ── Ordenacao ─────────────────────────────────

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
    return (a.vencimento_dia || 31) - (b.vencimento_dia || 31);
  });
}

// ── HTML helpers ──────────────────────────────

function htmlBtnStatus(despesa, anoMes) {
  const pago  = getStatusMes(despesa, anoMes) === 'pago';
  const cls   = pago ? 'status-pago' : 'status-pendente';
  const icon  = pago
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

// ── Renderizacao da tabela desktop ────────────

function htmlSublistaItens(despesa) {
  if (!temItens(despesa)) return '';
  const linhas = despesa.itens.map(it => `
    <div class="item-linha">
      <span class="item-linha-nome">${it.nome || 'Item'}</span>
      <span class="item-linha-valor">${formatReal(parseFloat(it.valor) || 0)}</span>
    </div>`).join('');
  return `<div class="itens-sublista">${linhas}</div>`;
}

function renderTr(despesa, anoMes, mesRef) {
  const expandido   = state.expandidos.has(despesa.id);
  const hasItens    = temItens(despesa);
  const chevronCls  = expandido ? 'expandido' : '';
  const nomeHint    = hasItens
    ? `<span class="td-nome-itens-hint">${despesa.itens.length} ${despesa.itens.length === 1 ? 'item' : 'itens'}</span>`
    : '';

  const trPrincipal = `
    <tr>
      <td class="td-expand">
        ${hasItens ? `
          <button class="btn-expand ${chevronCls}" data-acao="expandir" data-id="${despesa.id}" aria-label="Ver itens">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </button>` : ''}
      </td>
      <td class="td-nome td-nome-com-itens">
        <span class="td-nome-text" title="${despesa.nome || ''}">${despesa.nome || '-'}</span>
        ${nomeHint}
      </td>
      <td>${htmlTipoBadge(despesa.tipo)}</td>
      <td class="td-parcela">${labelParcela(despesa, mesRef)}</td>
      <td class="td-vencimento">Dia ${despesa.vencimento_dia || '-'}</td>
      <td class="td-valor">${formatReal(despesa.valor)}</td>
      <td>${htmlBtnStatus(despesa, anoMes)}</td>
      <td class="td-acoes">${htmlAcoes(despesa.id)}</td>
    </tr>`;

  if (!hasItens || !expandido) return trPrincipal;

  const trItens = `
    <tr class="tr-itens" data-itens-id="${despesa.id}">
      <td colspan="8">
        <div class="tr-itens-inner">${htmlSublistaItens(despesa)}</div>
      </td>
    </tr>`;

  return trPrincipal + trItens;
}

// ── Renderizacao dos cards mobile ─────────────

function renderCard(despesa, anoMes, mesRef) {
  const parcela  = labelParcela(despesa, mesRef);
  const tipo     = despesa.tipo === 'fixa' ? 'Fixa' : 'Parcelamento';
  const hasItens = temItens(despesa);
  const expandido = state.expandidos.has(despesa.id + '_card');

  const itensToggle = hasItens ? `
    <button class="despesa-card-itens-toggle ${expandido ? 'expandido' : ''}"
            data-acao="expandir-card" data-id="${despesa.id}">
      <span>${despesa.itens.length} ${despesa.itens.length === 1 ? 'item' : 'itens'} na composicao</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    ${expandido ? `
    <div class="despesa-card-itens-lista">
      ${despesa.itens.map(it => `
        <div class="despesa-card-item-row">
          <span class="despesa-card-item-nome">${it.nome || 'Item'}</span>
          <span class="despesa-card-item-valor">${formatReal(parseFloat(it.valor) || 0)}</span>
        </div>`).join('')}
    </div>` : ''}` : '';

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
      ${itensToggle}
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

// ── Render lista principal ────────────────────

function renderMesNav() {
  $('mes-label').textContent = labelMes(state.mesAtual);
}

function renderLista() {
  const mesRef  = state.mesAtual;
  const anoMes  = anoMesStr(mesRef);
  const filtro  = state.filtro;
  const ordenar = state.ordenar;

  const ativas     = state.despesas.filter(d => despesaAtivaNoMes(d, mesRef));
  const encerradas = state.despesas.filter(d => parcelamentoEncerrado(d, mesRef));

  const ativasFiltradas = filtro === 'todos'
    ? ativas
    : ativas.filter(d => d.natureza === filtro);

  const trabalho = ordenarDespesas(ativasFiltradas.filter(d => d.natureza === 'trabalho'), ordenar, mesRef);
  const pessoal  = ordenarDespesas(ativasFiltradas.filter(d => d.natureza === 'pessoal'),  ordenar, mesRef);

  const totalTrabalho = trabalho.reduce((s, d) => s + (d.valor || 0), 0);
  const totalPessoal  = pessoal.reduce((s, d) => s + (d.valor || 0), 0);
  const totalGeral    = totalTrabalho + totalPessoal;

  const pagas = ativasFiltradas.filter(d => getStatusMes(d, anoMes) === 'pago');
  const pct   = ativasFiltradas.length > 0
    ? Math.round((pagas.length / ativasFiltradas.length) * 100)
    : 0;

  $('total-trabalho').textContent  = formatReal(totalTrabalho);
  $('total-pessoal').textContent   = formatReal(totalPessoal);
  $('total-geral').textContent     = formatReal(totalGeral);
  $('count-trabalho').textContent  = `${trabalho.length} ${trabalho.length === 1 ? 'despesa' : 'despesas'}`;
  $('count-pessoal').textContent   = `${pessoal.length} ${pessoal.length === 1 ? 'despesa' : 'despesas'}`;
  $('resumo-fill').style.width     = `${pct}%`;
  $('resumo-pago-pct').textContent = `${pct}% pago`;

  $('badge-trabalho').textContent    = trabalho.length;
  $('subtotal-trabalho').textContent = formatReal(totalTrabalho);
  $('tbody-trabalho').innerHTML      = trabalho.map(d => renderTr(d, anoMes, mesRef)).join('');
  $('cards-trabalho').innerHTML      = trabalho.map(d => renderCard(d, anoMes, mesRef)).join('');
  $('empty-trabalho').hidden         = trabalho.length > 0;

  $('badge-pessoal').textContent    = pessoal.length;
  $('subtotal-pessoal').textContent = formatReal(totalPessoal);
  $('tbody-pessoal').innerHTML      = pessoal.map(d => renderTr(d, anoMes, mesRef)).join('');
  $('cards-pessoal').innerHTML      = pessoal.map(d => renderCard(d, anoMes, mesRef)).join('');
  $('empty-pessoal').hidden         = pessoal.length > 0;

  $('empty-global').hidden = (trabalho.length + pessoal.length) > 0 || encerradas.length > 0;
  $('grupo-trabalho').hidden = filtro === 'pessoal';
  $('grupo-pessoal').hidden  = filtro === 'trabalho';

  const encSection = $('encerrados-section');
  encSection.hidden = encerradas.length === 0;
  if (encerradas.length > 0) {
    $('count-encerrados').textContent = encerradas.length;
    $('tbody-encerrados').innerHTML   = encerradas.map(renderEncerradoTr).join('');
    $('cards-encerrados').innerHTML   = encerradas.map(renderEncerradoCard).join('');
  }
}

// ── Modal form — itens ────────────────────────

function renderItensForm() {
  const container = $('itens-lista-form');
  if (state.itensForm.length === 0) {
    container.innerHTML = '';
    // Sem itens: mostra campo de valor manual
    $('bloco-valor').hidden       = false;
    $('bloco-valor-itens').hidden = true;
    return;
  }

  // Com itens: esconde campo de valor manual, mostra valor calculado
  $('bloco-valor').hidden       = true;
  $('bloco-valor-itens').hidden = false;

  const soma = somaItens(state.itensForm);
  $('valor-calculado-label').textContent = formatReal(soma);

  container.innerHTML = state.itensForm.map((it, idx) => `
    <div class="item-form-row" data-idx="${idx}">
      <input class="item-form-nome" type="text" placeholder="Nome do item"
             value="${it.nome || ''}" data-campo="nome" data-idx="${idx}" maxlength="60" />
      <input class="item-form-valor" type="number" placeholder="0,00" min="0" step="0.01"
             value="${it.valor || ''}" data-campo="valor" data-idx="${idx}" />
      <button class="btn-remover-item" data-remover="${idx}" aria-label="Remover item">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`).join('');

  // Eventos dos inputs de item
  container.querySelectorAll('[data-campo]').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx   = parseInt(inp.dataset.idx, 10);
      const campo = inp.dataset.campo;
      state.itensForm[idx][campo] = campo === 'valor' ? inp.value : inp.value;
      // Atualiza o total em tempo real sem re-renderizar tudo
      if (campo === 'valor') {
        $('valor-calculado-label').textContent = formatReal(somaItens(state.itensForm));
      }
    });
  });

  container.querySelectorAll('[data-remover]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.remover, 10);
      state.itensForm.splice(idx, 1);
      renderItensForm();
    });
  });
}

function adicionarItemForm() {
  state.itensForm.push({ nome: '', valor: '' });
  renderItensForm();
  // Foca no input de nome do novo item
  const inputs = $('itens-lista-form').querySelectorAll('.item-form-nome');
  if (inputs.length > 0) inputs[inputs.length - 1].focus();
}

// ── Modal form — abrir / fechar / salvar ──────

function resetarForm() {
  $('inp-nome').value       = '';
  $('inp-natureza').value   = 'pessoal';
  $('inp-tipo').value       = 'fixa';
  $('inp-valor').value      = '';
  $('inp-vencimento').value = '';
  $('inp-vencimento2').value = '';
  $('inp-parcela-atual').value = '1';
  $('inp-parcela-total').value = '';
  $('inp-mes-inicio').value = String(new Date().getMonth() + 1);
  $('inp-ano-inicio').value = String(new Date().getFullYear());
  $('inp-retroativo').checked = false;
  $('campos-parcelamento').hidden = true;
  $('opcao-retroativo').hidden    = true;
  state.itensForm = [];
  renderItensForm();
}

function abrirModalAdicionar() {
  state.modoEdicao = null;
  $('modal-form-titulo').textContent = 'Adicionar despesa';
  resetarForm();
  $('modal-form').hidden = false;
}

function abrirModalEditar(despesa) {
  state.modoEdicao = despesa.id;
  $('modal-form-titulo').textContent = 'Editar despesa';

  $('inp-nome').value      = despesa.nome || '';
  $('inp-natureza').value  = despesa.natureza || 'pessoal';
  $('inp-tipo').value      = despesa.tipo || 'fixa';
  $('inp-vencimento').value  = despesa.vencimento_dia || '';
  $('inp-vencimento2').value = despesa.vencimento_dia || '';
  $('inp-parcela-atual').value = despesa.parcela_atual || 1;
  $('inp-parcela-total').value = despesa.parcela_total || '';
  $('inp-mes-inicio').value    = String(despesa.mes_inicio || new Date().getMonth() + 1);
  $('inp-ano-inicio').value    = String(despesa.ano_inicio || new Date().getFullYear());
  $('inp-retroativo').checked  = false;
  $('campos-parcelamento').hidden = despesa.tipo !== 'parcelamento';
  $('opcao-retroativo').hidden    = false;

  // Carrega itens existentes
  state.itensForm = Array.isArray(despesa.itens)
    ? despesa.itens.map(it => ({ nome: it.nome || '', valor: it.valor || '' }))
    : [];

  // Se nao tem itens, preenche valor manual
  if (state.itensForm.length === 0) {
    $('inp-valor').value = despesa.valor || '';
  }

  renderItensForm();
  $('modal-form').hidden = false;
}

function fecharModalForm() {
  $('modal-form').hidden = true;
  state.modoEdicao = null;
}

function getVencimentoAtual() {
  // Usa o campo visivel: se ha itens usa inp-vencimento2, senao inp-vencimento
  const hasItens = state.itensForm.length > 0;
  return parseInt(hasItens ? $('inp-vencimento2').value : $('inp-vencimento').value, 10);
}

async function salvarForm() {
  const nome       = $('inp-nome').value.trim();
  const natureza   = $('inp-natureza').value;
  const tipo       = $('inp-tipo').value;
  const retroativo = $('inp-retroativo').checked;
  const vencimento = getVencimentoAtual();
  const hasItens   = state.itensForm.length > 0;

  if (!nome) { toast('Informe o nome da despesa.', 'aviso'); return; }
  if (!vencimento || vencimento < 1 || vencimento > 31) {
    toast('Informe um dia de vencimento entre 1 e 31.', 'aviso');
    return;
  }

  let valor;
  let itens = [];

  if (hasItens) {
    // Valida itens
    for (const it of state.itensForm) {
      if (!it.nome || !it.nome.trim()) { toast('Preencha o nome de todos os itens.', 'aviso'); return; }
      const v = parseFloat(it.valor);
      if (isNaN(v) || v <= 0) { toast('Preencha o valor de todos os itens.', 'aviso'); return; }
    }
    itens = state.itensForm.map(it => ({ nome: it.nome.trim(), valor: parseFloat(it.valor) }));
    valor = somaItens(itens);
    if (valor <= 0) { toast('O valor total deve ser maior que zero.', 'aviso'); return; }
  } else {
    valor = parseFloat($('inp-valor').value);
    if (isNaN(valor) || valor <= 0) { toast('Informe um valor valido.', 'aviso'); return; }
  }

  const dados = { nome, natureza, tipo, valor, vencimento_dia: vencimento, itens };

  if (tipo === 'parcelamento') {
    const parcelaAtual = parseInt($('inp-parcela-atual').value, 10);
    const parcelaTotal = parseInt($('inp-parcela-total').value, 10);
    const mesInicio    = parseInt($('inp-mes-inicio').value, 10);
    const anoInicio    = parseInt($('inp-ano-inicio').value, 10);

    if (isNaN(parcelaAtual) || parcelaAtual < 1) { toast('Informe a parcela inicial.', 'aviso'); return; }
    if (isNaN(parcelaTotal) || parcelaTotal < 1) { toast('Informe o total de parcelas.', 'aviso'); return; }
    if (parcelaAtual > parcelaTotal) { toast('A parcela inicial nao pode ser maior que o total.', 'aviso'); return; }
    if (isNaN(mesInicio) || isNaN(anoInicio)) { toast('Informe mes e ano de inicio.', 'aviso'); return; }

    dados.parcela_atual = parcelaAtual;
    dados.parcela_total = parcelaTotal;
    dados.mes_inicio    = mesInicio;
    dados.ano_inicio    = anoInicio;
  }

  const btn = $('btn-salvar-form');
  btn.disabled    = true;
  btn.textContent = 'Salvando...';

  try {
    if (state.modoEdicao) {
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
    btn.disabled    = false;
    btn.textContent = 'Salvar';
  }
}

// ── Modal excluir ─────────────────────────────

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
  btn.disabled    = true;
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
    btn.disabled    = false;
    btn.textContent = 'Excluir';
  }
}

// ── Modal pagar ───────────────────────────────

function abrirModalPagar(id) {
  const despesa = state.despesas.find(d => d.id === id);
  if (!despesa) return;
  state.pagarId = id;
  const parcela = calcularParcelaAtual(despesa, state.mesAtual);
  $('modal-pagar-texto').textContent = parcela
    ? `Pagando "${despesa.nome}" - parcela ${parcela}/${despesa.parcela_total}. Como deseja registrar?`
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

// ── Toggle status ─────────────────────────────

async function toggleStatus(id) {
  const despesa  = state.despesas.find(d => d.id === id);
  if (!despesa) return;
  const anoMes   = anoMesStr(state.mesAtual);
  const statusAtual = getStatusMes(despesa, anoMes);

  if (statusAtual === 'pago') {
    try {
      await setStatusMensal(state.user.uid, id, anoMes, 'pendente');
      despesa.status_mensal = despesa.status_mensal || {};
      despesa.status_mensal[anoMes] = 'pendente';
      toast('Marcado como pendente.', 'info');
      renderLista();
    } catch { toast('Erro ao atualizar status.', 'erro'); }
    return;
  }

  if (despesa.tipo === 'parcelamento') { abrirModalPagar(id); return; }

  try {
    await setStatusMensal(state.user.uid, id, anoMes, 'pago');
    despesa.status_mensal = despesa.status_mensal || {};
    despesa.status_mensal[anoMes] = 'pago';
    toast('Marcado como pago.', 'sucesso');
    renderLista();
  } catch { toast('Erro ao atualizar status.', 'erro'); }
}

// ── Expandir sublista ─────────────────────────

function toggleExpandir(id) {
  if (state.expandidos.has(id)) {
    state.expandidos.delete(id);
  } else {
    state.expandidos.add(id);
  }
  renderLista();
}

function toggleExpandirCard(id) {
  const key = id + '_card';
  if (state.expandidos.has(key)) {
    state.expandidos.delete(key);
  } else {
    state.expandidos.add(key);
  }
  renderLista();
}

// ── Carregamento ──────────────────────────────

async function recarregarDespesas() {
  state.despesas = await getDespesas(state.user.uid);
  renderLista();
}

// ── Eventos ───────────────────────────────────

function bindEvents() {
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

  $('btn-adicionar').addEventListener('click', abrirModalAdicionar);
  $('btn-adicionar-empty').addEventListener('click', abrirModalAdicionar);

  document.querySelectorAll('.chip[data-filtro]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip[data-filtro]').forEach(c => c.classList.remove('chip-ativo'));
      chip.classList.add('chip-ativo');
      state.filtro = chip.dataset.filtro;
      renderLista();
    });
  });

  $('select-ordenar').addEventListener('change', (e) => {
    state.ordenar = e.target.value;
    renderLista();
  });

  // Modal form
  $('inp-tipo').addEventListener('change', (e) => {
    $('campos-parcelamento').hidden = e.target.value !== 'parcelamento';
  });
  $('btn-adicionar-item').addEventListener('click', adicionarItemForm);
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

  // Escape fecha modais
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('modal-form').hidden)    fecharModalForm();
    if (!$('modal-excluir').hidden) fecharModalExcluir();
    if (!$('modal-pagar').hidden)   fecharModalPagar();
  });

  // Encerrados toggle
  $('btn-encerrados').addEventListener('click', () => {
    const expandido = $('btn-encerrados').getAttribute('aria-expanded') === 'true';
    $('btn-encerrados').setAttribute('aria-expanded', String(!expandido));
    $('encerrados-lista').hidden = expandido;
  });

  // Delegacao na lista principal
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
    } else if (acao === 'expandir') {
      toggleExpandir(id);
    } else if (acao === 'expandir-card') {
      toggleExpandirCard(id);
    }
  });

  // Delegacao nos encerrados
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

// ── Init ──────────────────────────────────────

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
