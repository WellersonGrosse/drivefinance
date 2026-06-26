/**
 * custo-operacional.js — DriveFinance
 * Gestão de itens de desgaste do veículo e cálculo de custo por KM
 */

import {
  exigirLogin,
  verificarAcesso,
  getPerfil,
  getVeiculos,
  getCustoOperacional,
  addCustoOperacional,
  updateCustoOperacional,
  deleteCustoOperacional,
  getLancamentosMes,
  formatReal,
  toast,
  renderNav
} from './app.js';

import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─── Estado ────────────────────────────────────────────────────────────────────
let _uid = null;
let _perfil = null;
let _veiculos = [];
let _veiculoAtual = null;
let _itens = [];
let _editandoId = null;
let _deletandoId = null;

const PAGINAS_PRONTAS = new Set(['home.html', 'admin.html', 'configuracoes.html', 'custo-operacional.html']);

// Sugestões por tipo de veículo (flex/gasolina/diesel)
const SUGESTOES_ITENS = [
  { nome: 'Troca de óleo', qtd: 4, unidade: 'L' },
  { nome: 'Filtro de óleo', qtd: 1, unidade: 'un' },
  { nome: 'Filtro de ar', qtd: 1, unidade: 'un' },
  { nome: 'Filtro de combustível', qtd: 1, unidade: 'un' },
  { nome: 'Velas de ignição', qtd: 4, unidade: 'un' },
  { nome: 'Pneu', qtd: 4, unidade: 'un' },
  { nome: 'Pastilha de freio dianteira', qtd: 1, unidade: 'un' },
  { nome: 'Pastilha de freio traseira', qtd: 1, unidade: 'un' },
  { nome: 'Correia dentada', qtd: 1, unidade: 'un' },
  { nome: 'Correia do alternador', qtd: 1, unidade: 'un' },
  { nome: 'Amortecedor dianteiro', qtd: 2, unidade: 'un' },
  { nome: 'Amortecedor traseiro', qtd: 2, unidade: 'un' },
  { nome: 'Fluido de freio', qtd: 1, unidade: 'L' },
  { nome: 'Fluido de arrefecimento', qtd: 1, unidade: 'L' },
  { nome: 'Bateria', qtd: 1, unidade: 'un' },
  { nome: 'Alinhamento e balanceamento', qtd: 1, unidade: 'un' },
];

const $ = id => document.getElementById(id);

// ─── Formatação ────────────────────────────────────────────────────────────────
function formatKm(valor) {
  return new Intl.NumberFormat('pt-BR').format(valor) + ' KM';
}

function formatCustoKm(valor) {
  if (!valor || valor === 0) return 'R$ 0,000';
  return 'R$ ' + valor.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function formatQtd(qtd, unidade) {
  const n = Number(qtd);
  return `${n % 1 === 0 ? n : n.toFixed(1)} ${unidade}`;
}

// ─── Cálculos ──────────────────────────────────────────────────────────────────
function calcularCustoKmItem(item) {
  const total = (Number(item.qtd) || 0) * (Number(item.valor_unitario) || 0);
  const vida = Number(item.vida_util_km) || 0;
  if (vida === 0) return 0;
  return total / vida;
}

function calcularCustoKmTotal() {
  return _itens.reduce((acc, item) => acc + calcularCustoKmItem(item), 0);
}

async function calcularKmPeriodo(meses) {
  // Busca lançamentos dos últimos N meses e soma os KMs rodados
  const hoje = new Date();
  let totalKm = 0;

  for (let i = 0; i < meses; i++) {
    const data = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    try {
      const lancamentos = await getLancamentosMes(_uid, data);
      lancamentos.forEach(l => {
        const corridas = [...(l.corridas_app || []), ...(l.corridas_particular || [])];
        corridas.forEach(c => { totalKm += Number(c.km || 0); });
      });
    } catch { /* ignora mês sem dados */ }
  }

  return totalKm;
}

async function calcularKmDesdeInicio() {
  // Busca todos os lançamentos desde trial_inicio
  const inicio = _perfil?.trial_inicio?.seconds
    ? new Date(_perfil.trial_inicio.seconds * 1000)
    : new Date(_perfil?.criado_em?.seconds * 1000 || Date.now());

  const hoje = new Date();
  let totalKm = 0;
  const data = new Date(inicio.getFullYear(), inicio.getMonth(), 1);

  while (data <= hoje) {
    try {
      const lancamentos = await getLancamentosMes(_uid, new Date(data));
      lancamentos.forEach(l => {
        const corridas = [...(l.corridas_app || []), ...(l.corridas_particular || [])];
        corridas.forEach(c => { totalKm += Number(c.km || 0); });
      });
    } catch { /* ignora */ }
    data.setMonth(data.getMonth() + 1);
  }

  return totalKm;
}

// ─── Render ────────────────────────────────────────────────────────────────────
function renderTabela() {
  const tbody = $('co-tbody');
  const empty = $('co-empty');
  const tableWrap = $('co-table-wrap');
  const cardsMobile = $('co-cards-mobile');
  const tableFooter = $('co-table-footer');
  const infoMsg = $('co-info-msg');

  const temItens = _itens.length > 0;

  empty.hidden = temItens;
  tableWrap.hidden = !temItens;
  cardsMobile.innerHTML = '';
  tableFooter.hidden = !temItens;
  if (infoMsg) infoMsg.hidden = !temItens;

  if (!temItens) return;

  // Desktop — linhas da tabela
  tbody.innerHTML = _itens.map(item => {
    const total = (Number(item.qtd) || 0) * (Number(item.valor_unitario) || 0);
    const custoKm = calcularCustoKmItem(item);
    return `
      <tr>
        <td class="co-td-nome">${item.nome}</td>
        <td class="text-right co-td-muted">${formatQtd(item.qtd, item.unidade)}</td>
        <td class="text-right co-td-muted">${formatReal(item.valor_unitario)}</td>
        <td class="text-right co-td-muted">${formatReal(total)}</td>
        <td class="text-right co-td-muted">${formatKm(item.vida_util_km)}</td>
        <td class="text-right co-td-custo">${formatCustoKm(custoKm)}</td>
        <td>
          <div class="co-td-actions">
            <button class="co-btn-action" data-id="${item.id}" data-action="editar" aria-label="Editar ${item.nome}">
              <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
            </button>
            <button class="co-btn-action danger" data-id="${item.id}" data-action="deletar" aria-label="Remover ${item.nome}">
              <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');

  // Tfoot
  $('tfoot-custo-km').textContent = formatCustoKm(calcularCustoKmTotal());

  // Mobile — cards
  cardsMobile.innerHTML = _itens.map(item => {
    const total = (Number(item.qtd) || 0) * (Number(item.valor_unitario) || 0);
    const custoKm = calcularCustoKmItem(item);
    return `
      <div class="co-card-item">
        <div class="co-card-item-header">
          <span class="co-card-item-nome">${item.nome}</span>
          <span class="co-card-item-custo">${formatCustoKm(custoKm)}<small style="font-size:10px;font-weight:400;color:var(--text-muted)">/KM</small></span>
        </div>
        <div class="co-card-item-body">
          <div class="co-card-item-row">
            <span>Quantidade</span>
            <span>${formatQtd(item.qtd, item.unidade)}</span>
          </div>
          <div class="co-card-item-row">
            <span>Valor unit.</span>
            <span>${formatReal(item.valor_unitario)}</span>
          </div>
          <div class="co-card-item-row">
            <span>Total</span>
            <span>${formatReal(total)}</span>
          </div>
          <div class="co-card-item-row">
            <span>Vida útil</span>
            <span>${formatKm(item.vida_util_km)}</span>
          </div>
        </div>
        <div class="co-card-item-actions">
          <button class="btn btn-secondary co-btn-action" data-id="${item.id}" data-action="editar">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
            Editar
          </button>
          <button class="btn btn-secondary co-btn-action danger" data-id="${item.id}" data-action="deletar">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
            Remover
          </button>
        </div>
      </div>`;
  }).join('');
}

function renderResumo() {
  const custoKm = calcularCustoKmTotal();
  $('custo-por-km').textContent = formatCustoKm(custoKm);
  $('custo-km-hint').textContent = _itens.length === 0
    ? 'Adicione itens para calcular'
    : `${_itens.length} ${_itens.length === 1 ? 'item cadastrado' : 'itens cadastrados'}`;
}

async function renderPeriodo(periodo) {
  const custoKm = calcularCustoKmTotal();
  const labelEl = $('periodo-label');
  const valorEl = $('periodo-valor');
  const hintEl = $('periodo-hint');

  valorEl.textContent = '...';

  let km = 0;
  let label = '';
  let hint = '';

  try {
    if (periodo === 'mensal') {
      km = await calcularKmPeriodo(1);
      label = 'Custo no mês atual';
      hint = 'Com base nos KMs registrados este mês';
    } else if (periodo === 'semestral') {
      km = await calcularKmPeriodo(6);
      label = 'Custo nos últimos 6 meses';
      hint = 'Com base nos KMs dos últimos 6 meses';
    } else if (periodo === 'anual') {
      km = await calcularKmPeriodo(12);
      label = 'Custo nos últimos 12 meses';
      hint = 'Com base nos KMs dos últimos 12 meses';
    } else if (periodo === 'total') {
      km = await calcularKmDesdeInicio();
      label = 'Custo acumulado (desde o início)';
      hint = 'Total desde a criação da sua conta';
    }
  } catch { km = 0; }

  labelEl.textContent = label;

  if (km === 0 || custoKm === 0) {
    valorEl.textContent = '—';
    hintEl.textContent = 'Registre corridas para ver o custo';
  } else {
    valorEl.textContent = formatReal(custoKm * km);
    hintEl.textContent = hint + ` · ${new Intl.NumberFormat('pt-BR').format(Math.round(km))} KM rodados`;
  }
}

function renderVeiculos() {
  const select = $('select-veiculo');
  const wrap = $('co-veiculo-select');

  if (_veiculos.length <= 1) {
    wrap.hidden = true;
    _veiculoAtual = _veiculos[0]?.id || null;
    return;
  }

  wrap.hidden = false;
  select.innerHTML = _veiculos.map(v =>
    `<option value="${v.id}">${v.modelo} — ${v.placa}</option>`
  ).join('');

  const padrao = _veiculos.find(v => v.default);
  if (padrao) select.value = padrao.id;
  _veiculoAtual = select.value;
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function abrirModal(item = null) {
  _editandoId = item?.id || null;

  $('modal-item-titulo').textContent = item ? 'Editar item' : 'Adicionar item';
  $('item-nome').value = item?.nome || '';
  $('item-qtd').value = item?.qtd || '';
  $('item-unidade').value = item?.unidade || 'un';
  $('item-valor-unit').value = item?.valor_unitario || '';
  $('item-vida-util').value = item?.vida_util_km || '';

  atualizarCalcModal();
  $('modal-item').hidden = false;
  setTimeout(() => $('item-nome').focus(), 100);
}

function fecharModal() {
  $('modal-item').hidden = true;
  _editandoId = null;
  $('co-sugestoes').hidden = true;
}

function atualizarCalcModal() {
  const qtd = Number($('item-qtd').value) || 0;
  const unit = Number($('item-valor-unit').value) || 0;
  const vida = Number($('item-vida-util').value) || 0;
  const total = qtd * unit;
  const custoKm = vida > 0 ? total / vida : 0;

  $('item-total-display').textContent = formatReal(total);
  $('item-custo-km-preview').textContent = custoKm > 0 ? formatCustoKm(custoKm) : '—';
}

function renderSugestoes(texto) {
  const cont = $('co-sugestoes');
  const filtradas = SUGESTOES_ITENS.filter(s =>
    s.nome.toLowerCase().includes(texto.toLowerCase())
  );

  if (!texto || filtradas.length === 0) {
    cont.hidden = true;
    return;
  }

  cont.innerHTML = filtradas.map(s =>
    `<div class="co-sugestao-item" data-nome="${s.nome}" data-qtd="${s.qtd}" data-unidade="${s.unidade}">${s.nome}</div>`
  ).join('');

  cont.hidden = false;
}

async function salvarItem() {
  const nome = $('item-nome').value.trim();
  const qtd = Number($('item-qtd').value);
  const unidade = $('item-unidade').value;
  const valorUnitario = Number($('item-valor-unit').value);
  const vidaUtilKm = Number($('item-vida-util').value);

  if (!nome) { toast('Informe o nome do item.', 'aviso'); $('item-nome').focus(); return; }
  if (!qtd || qtd <= 0) { toast('Informe a quantidade.', 'aviso'); $('item-qtd').focus(); return; }
  if (!valorUnitario || valorUnitario <= 0) { toast('Informe o valor unitário.', 'aviso'); $('item-valor-unit').focus(); return; }
  if (!vidaUtilKm || vidaUtilKm <= 0) { toast('Informe a vida útil em KM.', 'aviso'); $('item-vida-util').focus(); return; }

  const btn = $('modal-item-salvar');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    const dados = {
      nome,
      qtd,
      unidade,
      valor_unitario: valorUnitario,
      vida_util_km: vidaUtilKm,
      veiculo_id: _veiculoAtual || null
    };

    if (_editandoId) {
      await updateCustoOperacional(_uid, _editandoId, dados);
      const idx = _itens.findIndex(i => i.id === _editandoId);
      if (idx !== -1) _itens[idx] = { ..._itens[idx], ...dados };
      toast('Item atualizado.', 'sucesso');
    } else {
      const ref = await addCustoOperacional(_uid, dados);
      _itens.push({ id: ref.id, ...dados });
      toast('Item adicionado.', 'sucesso');
    }

    fecharModal();
    renderTabela();
    renderResumo();
    renderPeriodo(periodoAtivo());
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar. Tente novamente.', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar item';
  }
}

function periodoAtivo() {
  return document.querySelector('.co-tab.ativo')?.dataset.periodo || 'mensal';
}

// ─── Exclusão ─────────────────────────────────────────────────────────────────
function abrirModalDeletar(id) {
  const item = _itens.find(i => i.id === id);
  _deletandoId = id;
  $('modal-deletar-msg').textContent = `Remover "${item?.nome || 'este item'}"? Esta ação não pode ser desfeita.`;
  $('modal-deletar').hidden = false;
}

async function confirmarDeletar() {
  if (!_deletandoId) return;

  const btn = $('modal-deletar-confirmar');
  btn.disabled = true;
  btn.textContent = 'Removendo...';

  try {
    await deleteCustoOperacional(_uid, _deletandoId);
    _itens = _itens.filter(i => i.id !== _deletandoId);
    $('modal-deletar').hidden = true;
    _deletandoId = null;
    renderTabela();
    renderResumo();
    renderPeriodo(periodoAtivo());
    toast('Item removido.', 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao remover. Tente novamente.', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Remover';
  }
}

// ─── Eventos ──────────────────────────────────────────────────────────────────
function bindEvents() {
  // Tabs de período
  document.querySelectorAll('.co-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.co-tab').forEach(t => {
        t.classList.remove('ativo');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('ativo');
      tab.setAttribute('aria-selected', 'true');
      renderPeriodo(tab.dataset.periodo);
    });
  });

  // Seletor de veículo
  $('select-veiculo')?.addEventListener('change', async e => {
    _veiculoAtual = e.target.value;
    _itens = await getCustoOperacional(_uid);
    _itens = _itens.filter(i => !i.veiculo_id || i.veiculo_id === _veiculoAtual);
    renderTabela();
    renderResumo();
    renderPeriodo(periodoAtivo());
  });

  // Botões adicionar
  $('btn-add-item')?.addEventListener('click', () => abrirModal());
  $('btn-empty-add')?.addEventListener('click', () => abrirModal());

  // Delegação de cliques na tabela e cards
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { id, action } = btn.dataset;
    if (action === 'editar') abrirModal(_itens.find(i => i.id === id));
    if (action === 'deletar') abrirModalDeletar(id);
  });

  // Modal item
  $('modal-item-fechar').addEventListener('click', fecharModal);
  $('modal-item-cancelar').addEventListener('click', fecharModal);
  $('modal-item-salvar').addEventListener('click', salvarItem);

  // Cálculo em tempo real
  ['item-qtd', 'item-valor-unit', 'item-vida-util'].forEach(id => {
    $(id).addEventListener('input', atualizarCalcModal);
  });

  // Sugestões no campo nome
  $('item-nome').addEventListener('input', e => renderSugestoes(e.target.value));
  $('item-nome').addEventListener('blur', () => {
    setTimeout(() => { $('co-sugestoes').hidden = true; }, 150);
  });

  $('co-sugestoes').addEventListener('click', e => {
    const item = e.target.closest('.co-sugestao-item');
    if (!item) return;
    $('item-nome').value = item.dataset.nome;
    $('item-qtd').value = item.dataset.qtd;
    $('item-unidade').value = item.dataset.unidade;
    $('co-sugestoes').hidden = true;
    atualizarCalcModal();
    $('item-valor-unit').focus();
  });

  // Modal deletar
  $('modal-deletar-fechar').addEventListener('click', () => { $('modal-deletar').hidden = true; _deletandoId = null; });
  $('modal-deletar-cancelar').addEventListener('click', () => { $('modal-deletar').hidden = true; _deletandoId = null; });
  $('modal-deletar-confirmar').addEventListener('click', confirmarDeletar);

  // Fechar modais no overlay
  $('modal-item').addEventListener('click', e => { if (e.target === $('modal-item')) fecharModal(); });
  $('modal-deletar').addEventListener('click', e => { if (e.target === $('modal-deletar')) { $('modal-deletar').hidden = true; _deletandoId = null; } });

  // ESC
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      fecharModal();
      $('modal-deletar').hidden = true;
    }
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const user = await exigirLogin();
  _uid = user.uid;

  const { permitido, motivo, perfil } = await verificarAcesso(_uid);

  if (!permitido) {
    const destinos = { trial_expirado: 'landing.html#planos', plano_expirado: 'landing.html#planos' };
    window.location.href = destinos[motivo] || 'login.html';
    return;
  }

  _perfil = perfil;

  // Verifica acesso ao módulo custo_operacional
  const modulosAtivos = new Set(perfil?.modulos_ativos || []);
  const isAdmin = perfil?.role === 'admin';
  const temAcessoModulo = isAdmin || modulosAtivos.has('custo_operacional');

  if (!temAcessoModulo) {
    $('co-banner-plano').hidden = false;
  }

  // Carrega dados
  [_veiculos, _itens] = await Promise.all([
    getVeiculos(_uid),
    getCustoOperacional(_uid)
  ]);

  // Filtra itens pelo veículo atual (se aplicável)
  renderVeiculos();
  if (_veiculoAtual) {
    _itens = _itens.filter(i => !i.veiculo_id || i.veiculo_id === _veiculoAtual);
  }

  renderNav('custo-operacional.html', _perfil, { paginasProntas: PAGINAS_PRONTAS });
  renderTabela();
  renderResumo();
  renderPeriodo('mensal');
  bindEvents();

  // Exibe app
  $('co-app').hidden = false;
  requestAnimationFrame(() => {
    $('loading-screen').classList.add('is-hidden');
    setTimeout(() => { $('loading-screen').hidden = true; }, 260);
  });
}

init().catch(err => {
  console.error('[DriveFinance/CustoOperacional]', err);
  toast('Erro ao carregar a página. Tente novamente.', 'erro');
});
