// ─────────────────────────────────────────────
// DriveFinance - lancamentos.js
// Corridas de App: totais consolidados por plataforma/dia
// Corridas Particulares: entradas individuais
// ─────────────────────────────────────────────

import {
  exigirLogin,
  verificarAcesso,
  getConfig,
  getVeiculos,
  getLancamentoDia,
  getLancamentosMes,
  saveLancamentoDia,
  formatReal,
  toast,
  renderNav
} from './app.js';

const PAGINAS_PRONTAS = new Set([
  'home.html',
  'admin.html',
  'configuracoes.html',
  'custo-operacional.html',
  'despesas.html',
  'lancamentos.html'
]);

// ─────────────────────────────────────────────
// Estado
// ─────────────────────────────────────────────

const state = {
  user: null,
  perfil: null,
  veiculos: [],
  plataformas: ['Uber'],
  mesCal: new Date(),
  diaSelecionado: null,
  diasComLancamento: new Set(),
  // corridas_app: array de { plataforma, valor, km }
  // uma entrada por plataforma (total do dia)
  corridasApp: [],
  // corridas_particular: array de { valor, km }
  corridasParticular: [],
  combustível: null,
  kmOcioso: 0,
  veiculoId: null,
  editando: { tipo: null, indice: null }
};

const $ = (id) => document.getElementById(id);

// ─────────────────────────────────────────────
// Utilitários de data
// ─────────────────────────────────────────────

function chaveDia(date) {
  const a = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${a}-${m}-${d}`;
}

function chaveAnoMes(date) {
  const a = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${a}-${m}`;
}

function hojeStr() { return chaveDia(new Date()); }

function strParaDate(str) {
  if (!str) return null;
  const [a, m, d] = str.split('-');
  return new Date(Number(a), Number(m) - 1, Number(d));
}

function labelDiaLongo(str) {
  if (!str) return '';
  const date = strParaDate(str);
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long'
  }).format(date);
}

function labelMesCal(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long', year: 'numeric'
  }).format(date);
}

function avancarMes(date, delta) {
  const nova = new Date(date);
  nova.setDate(1);
  nova.setMonth(nova.getMonth() + delta);
  return nova;
}

// ─────────────────────────────────────────────
// Normalizar plataformas (corrige bug [object Object])
// A config pode salvar como string ou como objeto { nome }
// ─────────────────────────────────────────────

function normalizarPlataformas(lista) {
  if (!Array.isArray(lista)) return ['Uber'];
  return lista.map(p => {
    if (typeof p === 'string') return p;
    if (p && typeof p === 'object') return p.nome || p.name || 'Uber';
    return 'Uber';
  }).filter(Boolean);
}

// ─────────────────────────────────────────────
// Calendário
// ─────────────────────────────────────────────

function renderCalendario() {
  $('cal-mes-label').textContent = labelMesCal(state.mesCal);

  const ano = state.mesCal.getFullYear();
  const mes = state.mesCal.getMonth();
  const primeiroDia = new Date(ano, mes, 1).getDay();
  const totalDias = new Date(ano, mes + 1, 0).getDate();
  const totalAnterior = new Date(ano, mes, 0).getDate();
  const hoje = hojeStr();
  const mesStr = chaveAnoMes(state.mesCal);

  const grid = $('cal-grid');
  grid.innerHTML = '';

  // Dias do mês anterior
  for (let i = primeiroDia - 1; i >= 0; i--) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-dia cal-dia-outro';
    btn.textContent = String(totalAnterior - i);
    btn.disabled = true;
    btn.setAttribute('aria-hidden', 'true');
    grid.appendChild(btn);
  }

  // Dias do mês atual
  for (let d = 1; d <= totalDias; d++) {
    const diaStr = `${mesStr}-${String(d).padStart(2, '0')}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.dia = diaStr;
    btn.textContent = String(d);

    const classes = ['cal-dia'];
    if (diaStr === hoje) classes.push('cal-dia-hoje');
    if (diaStr === state.diaSelecionado) classes.push('cal-dia-selecionado');
    if (state.diasComLancamento.has(diaStr)) classes.push('cal-dia-tem');
    btn.className = classes.join(' ');
    btn.setAttribute('aria-label', labelDiaLongo(diaStr));
    btn.setAttribute('aria-pressed', String(diaStr === state.diaSelecionado));
    btn.addEventListener('click', () => selecionarDia(diaStr));
    grid.appendChild(btn);
  }

  // Completar ultima semana
  const totalCelulas = primeiroDia + totalDias;
  const resto = totalCelulas % 7;
  if (resto > 0) {
    for (let i = 1; i <= 7 - resto; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-dia cal-dia-outro';
      btn.textContent = String(i);
      btn.disabled = true;
      btn.setAttribute('aria-hidden', 'true');
      grid.appendChild(btn);
    }
  }
}

async function carregarDiasComLancamento() {
  try {
    const lista = await getLancamentosMes(state.user.uid, state.mesCal);
    state.diasComLancamento = new Set(lista.map(l => l.dia));
  } catch {
    state.diasComLancamento = new Set();
  }
}

// ─────────────────────────────────────────────
// Seleção de dia
// ─────────────────────────────────────────────

async function selecionarDia(diaStr) {
  state.diaSelecionado = diaStr;
  renderCalendario();
  await carregarDadosDia();
  renderTudo();
}

async function carregarDadosDia() {
  if (!state.diaSelecionado) return;
  try {
    const dados = await getLancamentoDia(state.user.uid, strParaDate(state.diaSelecionado));
    state.corridasApp = Array.isArray(dados?.corridas_app) ? [...dados.corridas_app] : [];
    state.corridasParticular = Array.isArray(dados?.corridas_particular) ? [...dados.corridas_particular] : [];
    state.combustivel = dados?.combustível || null;
    state.kmOcioso = Number(dados?.km_ocioso) || 0;

    // Seleciona veiculo do lançamento ou o padrão
    const veiculoDia = dados?.veiculo_id;
    if (veiculoDia && state.veiculos.find(v => v.id === veiculoDia)) {
      state.veiculoId = veiculoDia;
    } else {
      const padrao = state.veiculos.find(v => v.default);
      state.veiculoId = padrao?.id || state.veiculos[0]?.id || null;
    }
    $('select-veiculo').value = state.veiculoId || '';
  } catch {
    state.corridasApp = [];
    state.corridasParticular = [];
    state.combustivel = null;
    state.kmOcioso = 0;
  }
}

// ─────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────

function calcularTotalDia() {
  const app = state.corridasApp.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  const part = state.corridasParticular.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  return app + part;
}

function renderTudo() {
  renderHeaderDia();
  renderBlocoApp();
  renderBlocoParticular();
  renderBlocoCombustivel();
  renderBlocoKmOcioso();
}

function renderHeaderDia() {
  if (!state.diaSelecionado) return;
  $('dia-titulo').textContent = labelDiaLongo(state.diaSelecionado);

  const totalApp = state.corridasApp.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  const totalPart = state.corridasParticular.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  const totalDia = totalApp + totalPart;

  $('dia-card-sub') && ($('dia-sub').textContent =
    `${state.corridasApp.length + state.corridasParticular.length} registro(s) neste dia`);
  $('dia-total').textContent = formatReal(totalDia);

  const partes = [];
  if (state.corridasApp.length > 0) partes.push(`${state.corridasApp.length} de app`);
  if (state.corridasParticular.length > 0) partes.push(`${state.corridasParticular.length} particular`);
  $('dia-total-sub').textContent = partes.length > 0 ? partes.join(' · ') : 'Nenhuma corrida registrada';
}

function htmlIcones(tipo, indice) {
  return `
    <button class="icon-btn" type="button" data-acao="editar" data-tipo="${tipo}" data-indice="${indice}" aria-label="Editar">
      <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
    </button>
    <button class="icon-btn icon-btn-danger" type="button" data-acao="excluir" data-tipo="${tipo}" data-indice="${indice}" aria-label="Excluir">
      <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
    </button>`;
}

function renderBlocoApp() {
  const lista = $('lista-app');
  const empty = $('empty-app');
  const sub = $('sub-app');
  const count = state.corridasApp.length;
  const total = state.corridasApp.reduce((s, c) => s + (Number(c.valor) || 0), 0);

  sub.textContent = count > 0
    ? `${count} plataforma${count > 1 ? 's' : ''} \u2022 ${formatReal(total)}`
    : '0 plataformas \u2022 R$ 0,00';

  Array.from(lista.querySelectorAll('.item-row')).forEach(el => el.remove());

  if (count === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  state.corridasApp.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <div>
        <div class="item-nome">${escapeHtml(c.plataforma)}</div>
        <div class="item-meta">${c.km ? `${Number(c.km).toFixed(1)} km no total` : 'KM não informado'}</div>
      </div>
      <span class="item-valor">${formatReal(c.valor)}</span>
      ${htmlIcones('app', i)}`;
    lista.appendChild(row);
  });
}

function renderBlocoParticular() {
  const lista = $('lista-particular');
  const empty = $('empty-particular');
  const sub = $('sub-particular');
  const count = state.corridasParticular.length;
  const total = state.corridasParticular.reduce((s, c) => s + (Number(c.valor) || 0), 0);

  sub.textContent = count > 0
    ? `${count} corrida${count > 1 ? 's' : ''} \u2022 ${formatReal(total)}`
    : '0 corridas \u2022 R$ 0,00';

  Array.from(lista.querySelectorAll('.item-row')).forEach(el => el.remove());

  if (count === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  state.corridasParticular.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <div>
        <div class="item-nome">Corrida ${i + 1}</div>
        <div class="item-meta">${c.km ? `${Number(c.km).toFixed(1)} km` : 'KM não informado'}</div>
      </div>
      <span class="item-valor">${formatReal(c.valor)}</span>
      ${htmlIcones('particular', i)}`;
    lista.appendChild(row);
  });
}

function renderBlocoCombustivel() {
  const lista = $('lista-combustível');
  const empty = $('empty-combustível');
  const sub = $('sub-combustível');

  Array.from(lista.querySelectorAll('.item-row')).forEach(el => el.remove());

  if (!state.combustivel) {
    empty.hidden = false;
    sub.textContent = 'Nenhum abastecimento';
    return;
  }

  empty.hidden = true;
  const c = state.combustivel;
  const lt = Number(c.litros_trabalho) || 0;
  const lo = Number(c.litros_ocioso) || 0;
  const preco = Number(c.preco_litro) || 0;
  const total = (lt + lo) * preco;

  sub.textContent = `${(lt + lo).toFixed(1)}L \u2022 ${formatReal(total)}`;

  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <div>
      <div class="item-nome">Abastecimento</div>
      <div class="item-meta">${formatReal(preco)}/L \u2022 ${lt.toFixed(1)}L trabalho${lo > 0 ? ` \u2022 ${lo.toFixed(1)}L ocioso` : ''}</div>
    </div>
    <span class="item-valor item-valor-comb">${formatReal(total)}</span>
    ${htmlIcones('combustível', 0)}`;
  lista.appendChild(row);
}

function renderBlocoKmOcioso() {
  const sub = $('sub-km-ocioso');
  const toggle = $('toggle-km-ocioso');
  const campos = $('bloco-km-campos');
  const inp = $('inp-km-ocioso');

  const ativo = state.kmOcioso > 0;
  toggle.checked = ativo;
  campos.hidden = !ativo;

  if (ativo) {
    inp.value = String(state.kmOcioso);
    sub.textContent = `${state.kmOcioso.toFixed(1)} km fora do trabalho`;
  } else {
    inp.value = '';
    sub.textContent = 'Nenhum KM ocioso registrado';
  }
}

// ─────────────────────────────────────────────
// Modais: App
// ─────────────────────────────────────────────

function preencherPlataformasSelect() {
  const sel = $('inp-app-plataforma');
  // Plataformas ja usadas hoje (exceto a que esta sendo editada)
  const usadas = state.corridasApp
    .filter((_, i) => i !== state.editando.indice)
    .map(c => c.plataforma);

  const disponiveis = state.plataformas.filter(p => !usadas.includes(p));

  if (disponiveis.length === 0) {
    sel.innerHTML = '<option value="">Todas as plataformas já lançadas</option>';
    return;
  }
  sel.innerHTML = disponiveis
    .map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
    .join('');
}

function abrirModalApp(indice = null) {
  state.editando = { tipo: 'app', indice };
  $('modal-app-titulo').textContent = indice !== null ? 'Editar corrida de App' : 'Nova corrida de App';
  preencherPlataformasSelect();

  if (indice !== null) {
    const c = state.corridasApp[indice];
    $('inp-app-plataforma').value = c.plataforma;
    $('inp-app-valor').value = c.valor || '';
    $('inp-app-km').value = c.km || '';
  } else {
    $('inp-app-valor').value = '';
    $('inp-app-km').value = '';
  }

  $('modal-app').hidden = false;
  setTimeout(() => $('inp-app-valor').focus(), 0);
}

function fecharModalApp() {
  $('modal-app').hidden = true;
  state.editando = { tipo: null, indice: null };
}

function salvarApp() {
  const plataforma = $('inp-app-plataforma').value;
  const valor = Number($('inp-app-valor').value);
  const km = Number($('inp-app-km').value) || 0;

  if (!plataforma) { toast('Selecione a plataforma.', 'aviso'); return; }
  if (!Number.isFinite(valor) || valor <= 0) { toast('Informe o valor recebido.', 'aviso'); return; }

  const entrada = { plataforma, valor, km };
  const { indice } = state.editando;

  if (indice !== null) {
    state.corridasApp[indice] = entrada;
  } else {
    // Verifica duplicata de plataforma
    const jaExiste = state.corridasApp.findIndex(c => c.plataforma === plataforma);
    if (jaExiste >= 0) {
      toast(`${plataforma} já foi lançada hoje. Edite o registro existente.`, 'aviso');
      return;
    }
    state.corridasApp.push(entrada);
  }

  fecharModalApp();
  renderTudo();
}

// ─────────────────────────────────────────────
// Modais: Particular
// ─────────────────────────────────────────────

function abrirModalParticular(indice = null) {
  state.editando = { tipo: 'particular', indice };
  $('modal-particular-titulo').textContent = indice !== null ? 'Editar corrida particular' : 'Nova corrida particular';

  if (indice !== null) {
    const c = state.corridasParticular[indice];
    $('inp-particular-valor').value = c.valor || '';
    $('inp-particular-km').value = c.km || '';
  } else {
    $('inp-particular-valor').value = '';
    $('inp-particular-km').value = '';
  }

  $('modal-particular').hidden = false;
  setTimeout(() => $('inp-particular-valor').focus(), 0);
}

function fecharModalParticular() {
  $('modal-particular').hidden = true;
  state.editando = { tipo: null, indice: null };
}

function salvarParticular() {
  const valor = Number($('inp-particular-valor').value);
  const km = Number($('inp-particular-km').value) || 0;

  if (!Number.isFinite(valor) || valor <= 0) { toast('Informe o valor recebido.', 'aviso'); return; }

  const entrada = { valor, km };
  const { indice } = state.editando;

  if (indice !== null) state.corridasParticular[indice] = entrada;
  else state.corridasParticular.push(entrada);

  fecharModalParticular();
  renderTudo();
}

// ─────────────────────────────────────────────
// Modais: Combustivel
// ─────────────────────────────────────────────

function atualizarTotalComb() {
  const preco = Number($('inp-comb-preco').value) || 0;
  const lt = Number($('inp-comb-trabalho').value) || 0;
  const lo = Number($('inp-comb-ocioso').value) || 0;
  $('comb-total-valor').textContent = formatReal((lt + lo) * preco);
}

function abrirModalCombustivel() {
  state.editando = { tipo: 'combustível', indice: 0 };
  $('modal-combustível-titulo').textContent = state.combustivel ? 'Editar combustível' : 'Registrar combustível';

  if (state.combustivel) {
    $('inp-comb-preco').value = state.combustivel.preco_litro || '';
    $('inp-comb-trabalho').value = state.combustivel.litros_trabalho || '';
    $('inp-comb-ocioso').value = state.combustivel.litros_ocioso || '';
  } else {
    $('inp-comb-preco').value = '';
    $('inp-comb-trabalho').value = '';
    $('inp-comb-ocioso').value = '';
  }

  atualizarTotalComb();
  $('modal-combustível').hidden = false;
  setTimeout(() => $('inp-comb-preco').focus(), 0);
}

function fecharModalCombustivel() {
  $('modal-combustível').hidden = true;
  state.editando = { tipo: null, indice: null };
}

function salvarCombustivel() {
  const preco = Number($('inp-comb-preco').value);
  const lt = Number($('inp-comb-trabalho').value) || 0;
  const lo = Number($('inp-comb-ocioso').value) || 0;

  if (!Number.isFinite(preco) || preco <= 0) { toast('Informe o preço do litro.', 'aviso'); return; }
  if (lt <= 0 && lo <= 0) { toast('Informe a quantidade de litros.', 'aviso'); return; }

  state.combustivel = { preco_litro: preco, litros_trabalho: lt, litros_ocioso: lo };
  fecharModalCombustivel();
  renderTudo();
}

// ─────────────────────────────────────────────
// Modal exclusao
// ─────────────────────────────────────────────

function abrirModalExcluir(tipo, indice) {
  state.editando = { tipo, indice };
  $('modal-excluir').hidden = false;
}

function fecharModalExcluir() {
  $('modal-excluir').hidden = true;
  state.editando = { tipo: null, indice: null };
}

function confirmarExcluir() {
  const { tipo, indice } = state.editando;
  if (tipo === 'app') state.corridasApp.splice(indice, 1);
  else if (tipo === 'particular') state.corridasParticular.splice(indice, 1);
  else if (tipo === 'combustível') state.combustivel = null;
  fecharModalExcluir();
  renderTudo();
  toast('Removido.', 'sucesso');
}

function fecharModaisAbertos() {
  if (!$('modal-app').hidden) fecharModalApp();
  if (!$('modal-particular').hidden) fecharModalParticular();
  if (!$('modal-combustível').hidden) fecharModalCombustivel();
  if (!$('modal-excluir').hidden) fecharModalExcluir();
}

// ─────────────────────────────────────────────
// Salvar no Firestore
// ─────────────────────────────────────────────

async function salvarDia() {
  if (!state.diaSelecionado) {
    toast('Selecione um dia no calendário primeiro.', 'aviso');
    return;
  }

  const btn = $('btn-salvar-dia');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    const dados = {
      corridas_app: state.corridasApp,
      corridas_particular: state.corridasParticular,
      km_ocioso: state.kmOcioso
    };
    if (state.combustivel) dados.combustível = state.combustivel;
    if (state.veiculoId) dados.veiculo_id = state.veiculoId;

    await saveLancamentoDia(state.user.uid, dados, strParaDate(state.diaSelecionado));

    const temConteudo =
      state.corridasApp.length > 0 ||
      state.corridasParticular.length > 0 ||
      state.combustivel !== null ||
      state.kmOcioso > 0;

    if (temConteudo) state.diasComLancamento.add(state.diaSelecionado);
    else state.diasComLancamento.delete(state.diaSelecionado);

    renderCalendario();
    toast('Lançamentos salvos com sucesso.', 'sucesso');
  } catch (e) {
    console.error('[DriveFinance/lancamentos/salvar]', e);
    toast('Não foi possível salvar. Tente novamente.', 'erro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v14a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg> Salvar lançamentos do dia';
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function escapeHtml(v = '') {
  return String(v)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function preencherSelectVeiculos() {
  const sel = $('select-veiculo');
  if (!state.veiculos.length) {
    sel.innerHTML = '<option value="">Nenhum veículo cadastrado</option>';
    return;
  }
  sel.innerHTML = state.veiculos
    .map(v => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.modelo || v.placa || 'Veiculo')}</option>`)
    .join('');
  const padrao = state.veiculos.find(v => v.default);
  sel.value = padrao?.id || state.veiculos[0].id;
  state.veiculoId = sel.value;
}

// ─────────────────────────────────────────────
// Eventos
// ─────────────────────────────────────────────

function bindEvents() {
  $('btn-cal-anterior').addEventListener('click', async () => {
    state.mesCal = avancarMes(state.mesCal, -1);
    await carregarDiasComLancamento();
    renderCalendario();
  });
  $('btn-cal-proximo').addEventListener('click', async () => {
    state.mesCal = avancarMes(state.mesCal, 1);
    await carregarDiasComLancamento();
    renderCalendario();
  });

  $('select-veiculo').addEventListener('change', e => { state.veiculoId = e.target.value || null; });

  $('btn-add-app').addEventListener('click', () => {
    if (!state.diaSelecionado) { toast('Selecione um dia primeiro.', 'aviso'); return; }
    abrirModalApp();
  });
  $('btn-add-particular').addEventListener('click', () => {
    if (!state.diaSelecionado) { toast('Selecione um dia primeiro.', 'aviso'); return; }
    abrirModalParticular();
  });
  $('btn-add-combustível').addEventListener('click', () => {
    if (!state.diaSelecionado) { toast('Selecione um dia primeiro.', 'aviso'); return; }
    abrirModalCombustivel();
  });

  $('toggle-km-ocioso').addEventListener('change', e => {
    const ativo = e.target.checked;
    $('bloco-km-campos').hidden = !ativo;
    if (!ativo) {
      state.kmOcioso = 0;
      $('inp-km-ocioso').value = '';
      $('sub-km-ocioso').textContent = 'Nenhum KM ocioso registrado';
    } else {
      if (!state.diaSelecionado) {
        toast('Selecione um dia primeiro.', 'aviso');
        e.target.checked = false;
        $('bloco-km-campos').hidden = true;
        return;
      }
      setTimeout(() => $('inp-km-ocioso').focus(), 0);
    }
  });

  $('inp-km-ocioso').addEventListener('input', e => {
    state.kmOcioso = Number(e.target.value) || 0;
    $('sub-km-ocioso').textContent = state.kmOcioso > 0
      ? `${state.kmOcioso.toFixed(1)} km fora do trabalho`
      : 'Nenhum KM ocioso registrado';
  });

  // Modais App
  $('btn-fechar-app').addEventListener('click', fecharModalApp);
  $('btn-cancelar-app').addEventListener('click', fecharModalApp);
  $('btn-salvar-app').addEventListener('click', salvarApp);

  // Modais Particular
  $('btn-fechar-particular').addEventListener('click', fecharModalParticular);
  $('btn-cancelar-particular').addEventListener('click', fecharModalParticular);
  $('btn-salvar-particular').addEventListener('click', salvarParticular);

  // Modais Combustivel
  $('btn-fechar-combustível').addEventListener('click', fecharModalCombustivel);
  $('btn-cancelar-combustível').addEventListener('click', fecharModalCombustivel);
  $('btn-salvar-combustível').addEventListener('click', salvarCombustivel);
  ['inp-comb-preco', 'inp-comb-trabalho', 'inp-comb-ocioso']
    .forEach(id => $(id).addEventListener('input', atualizarTotalComb));

  // Modal excluir
  $('btn-fechar-excluir').addEventListener('click', fecharModalExcluir);
  $('btn-cancelar-excluir').addEventListener('click', fecharModalExcluir);
  $('btn-confirmar-excluir').addEventListener('click', confirmarExcluir);

  // Delegacao: editar/excluir nos blocos
  ['lista-app', 'lista-particular', 'lista-combustível'].forEach(id => {
    $(id).addEventListener('click', e => {
      const btn = e.target.closest('[data-acao]');
      if (!btn) return;
      const { acao, tipo, indice } = btn.dataset;
      const idx = Number(indice);
      if (acao === 'editar') {
        if (tipo === 'app') abrirModalApp(idx);
        else if (tipo === 'particular') abrirModalParticular(idx);
        else if (tipo === 'combustível') abrirModalCombustivel();
      }
      if (acao === 'excluir') abrirModalExcluir(tipo, idx);
    });
  });

  $('btn-salvar-dia').addEventListener('click', salvarDia);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModaisAbertos(); });
}

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────

async function init() {
  try {
    state.user = await exigirLogin();
    const { permitido, motivo, perfil } = await verificarAcesso(state.user.uid);

    if (!permitido) {
      window.location.href = motivo === 'trial_expirado' || motivo === 'plano_expirado'
        ? 'landing.html#planos' : 'login.html';
      return;
    }

    state.perfil = perfil;
    renderNav('lancamentos.html', perfil, { paginasProntas: PAGINAS_PRONTAS });

    const [veiculos, config] = await Promise.all([
      getVeiculos(state.user.uid),
      getConfig(state.user.uid)
    ]);

    state.veiculos = veiculos;
    // Normaliza plataformas para sempre ser array de strings
    state.plataformas = normalizarPlataformas(config.plataformas);

    preencherSelectVeiculos();
    bindEvents();
    await carregarDiasComLancamento();
    renderCalendario();
    await selecionarDia(hojeStr());

  } catch (e) {
    console.error('[DriveFinance/lancamentos]', e);
    toast('Erro ao carregar a página. Recarregue.', 'erro');
  }
}

init();
