// ─────────────────────────────────────────────
// DriveFinance — lancamentos.js
// Registro diário: corridas de app, particulares,
// combustível e KM ocioso
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
// Estado global da página
// ─────────────────────────────────────────────

const state = {
  user: null,
  perfil: null,
  veiculos: [],
  plataformas: ['Uber'],
  // Data visualizada no calendário (mês de referência)
  mesCal: new Date(),
  // Data do dia selecionado (string YYYY-MM-DD)
  diaSelecionado: null,
  // Dias do mês atual que têm lançamento (Set de strings YYYY-MM-DD)
  diasComLancamento: new Set(),
  // Dados do dia selecionado (carregados do Firestore)
  dadosDia: null,
  // Listas mutáveis do dia em memória (copiadas de dadosDia ao carregar)
  corridasApp: [],
  corridasParticular: [],
  combustivel: null,
  kmOcioso: 0,
  veiculoId: null,
  // Controle de edição nos modais
  editando: {
    tipo: null,   // 'app' | 'particular' | 'combustivel'
    indice: null  // índice na lista, null = novo item
  }
};

const $ = (id) => document.getElementById(id);

// ─────────────────────────────────────────────
// Utilitários de data
// ─────────────────────────────────────────────

function chaveDia(date) {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const dia = String(date.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function chaveAnoMes(date) {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}`;
}

function hojeStr() {
  return chaveDia(new Date());
}

function labelDiaLongo(str) {
  if (!str) return '';
  const [ano, mes, dia] = str.split('-');
  const date = new Date(Number(ano), Number(mes) - 1, Number(dia));
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(date);
}

function labelMes(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function avancarMes(date, delta) {
  const nova = new Date(date);
  nova.setDate(1);
  nova.setMonth(nova.getMonth() + delta);
  return nova;
}

function strParaDate(str) {
  if (!str) return null;
  const [ano, mes, dia] = str.split('-');
  return new Date(Number(ano), Number(mes) - 1, Number(dia));
}

// ─────────────────────────────────────────────
// Calendário
// ─────────────────────────────────────────────

function renderCalendario() {
  $('cal-mes-label').textContent = labelMes(state.mesCal);

  const ano = state.mesCal.getFullYear();
  const mes = state.mesCal.getMonth();
  const primeiroDia = new Date(ano, mes, 1).getDay(); // 0=Dom
  const totalDias = new Date(ano, mes + 1, 0).getDate();
  const hoje = hojeStr();

  const grid = $('calendario-grid');
  grid.innerHTML = '';

  // Preencher dias do mês anterior
  const diasAntes = primeiroDia;
  const totalMesAnterior = new Date(ano, mes, 0).getDate();
  for (let i = diasAntes - 1; i >= 0; i--) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-dia cal-dia-outro-mes';
    btn.textContent = String(totalMesAnterior - i);
    btn.disabled = true;
    btn.setAttribute('aria-hidden', 'true');
    grid.appendChild(btn);
  }

  // Dias do mês atual
  const mesStr = chaveAnoMes(state.mesCal);

  for (let d = 1; d <= totalDias; d++) {
    const diaStr = `${mesStr}-${String(d).padStart(2, '0')}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.dia = diaStr;
    btn.textContent = String(d);

    const classes = ['cal-dia'];
    if (diaStr === hoje) classes.push('cal-dia-hoje');
    if (diaStr === state.diaSelecionado) classes.push('cal-dia-selecionado');
    if (state.diasComLancamento.has(diaStr)) classes.push('cal-dia-tem-lancamento');

    btn.className = classes.join(' ');
    btn.setAttribute('aria-label', labelDiaLongo(diaStr));
    btn.setAttribute('aria-pressed', diaStr === state.diaSelecionado ? 'true' : 'false');

    btn.addEventListener('click', () => selecionarDia(diaStr));
    grid.appendChild(btn);
  }

  // Completar última semana
  const totalCelulas = diasAntes + totalDias;
  const resto = totalCelulas % 7;
  if (resto > 0) {
    for (let i = 1; i <= 7 - resto; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-dia cal-dia-outro-mes';
      btn.textContent = String(i);
      btn.disabled = true;
      btn.setAttribute('aria-hidden', 'true');
      grid.appendChild(btn);
    }
  }
}

async function carregarDiasComLancamento() {
  try {
    const lancamentos = await getLancamentosMes(state.user.uid, state.mesCal);
    state.diasComLancamento = new Set(lancamentos.map(l => l.dia));
  } catch (e) {
    console.warn('[DriveFinance/lancamentos] Falha ao carregar dias do mês:', e);
    state.diasComLancamento = new Set();
  }
}

// ─────────────────────────────────────────────
// Seleção de dia e carregamento de dados
// ─────────────────────────────────────────────

async function selecionarDia(diaStr) {
  state.diaSelecionado = diaStr;
  renderCalendario();
  atualizarHeaderDia();
  await carregarDadosDia();
  renderBlocos();
}

function atualizarHeaderDia() {
  if (!state.diaSelecionado) return;
  $('dia-titulo').textContent = labelDiaLongo(state.diaSelecionado);
  $('dia-subtitle').textContent = 'Registre as corridas e ganhos deste dia';
}

async function carregarDadosDia() {
  if (!state.diaSelecionado) return;
  const date = strParaDate(state.diaSelecionado);
  if (!date) return;

  try {
    const dados = await getLancamentoDia(state.user.uid, date);
    state.dadosDia = dados;
    state.corridasApp = dados?.corridas_app ? [...dados.corridas_app] : [];
    state.corridasParticular = dados?.corridas_particular ? [...dados.corridas_particular] : [];
    state.combustivel = dados?.combustivel || null;
    state.kmOcioso = Number(dados?.km_ocioso) || 0;

    // Seleciona veículo do lançamento ou o default
    const veiculoDia = dados?.veiculo_id;
    if (veiculoDia && state.veiculos.find(v => v.id === veiculoDia)) {
      state.veiculoId = veiculoDia;
    } else {
      const padrao = state.veiculos.find(v => v.default);
      state.veiculoId = padrao?.id || state.veiculos[0]?.id || null;
    }
    $('select-veiculo').value = state.veiculoId || '';
  } catch (e) {
    console.error('[DriveFinance/lancamentos] Falha ao carregar dia:', e);
    state.dadosDia = null;
    state.corridasApp = [];
    state.corridasParticular = [];
    state.combustivel = null;
    state.kmOcioso = 0;
  }
}

// ─────────────────────────────────────────────
// Render dos blocos
// ─────────────────────────────────────────────

function calcularTotalDia() {
  const totalApp = state.corridasApp.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  const totalParticular = state.corridasParticular.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  return totalApp + totalParticular;
}

function renderBlocos() {
  renderCorridasApp();
  renderCorridasParticular();
  renderCombustivel();
  renderKmOcioso();
  $('dia-total-ganhos').textContent = formatReal(calcularTotalDia());
}

function htmlIconEditar(tipo, indice) {
  return `
    <button class="icon-btn" type="button" data-acao="editar" data-tipo="${tipo}" data-indice="${indice}" aria-label="Editar">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
    </button>`;
}

function htmlIconExcluir(tipo, indice) {
  return `
    <button class="icon-btn icon-btn-danger" type="button" data-acao="excluir" data-tipo="${tipo}" data-indice="${indice}" aria-label="Excluir">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
    </button>`;
}

function renderCorridasApp() {
  const lista = $('lista-corridas-app');
  const empty = $('empty-corridas-app');
  const sub = $('sub-corridas-app');

  const total = state.corridasApp.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  const count = state.corridasApp.length;

  sub.textContent = `${count} ${count === 1 ? 'corrida' : 'corridas'} \u2022 ${formatReal(total)}`;

  if (count === 0) {
    empty.hidden = false;
    // Limpa itens anteriores preservando o empty
    Array.from(lista.querySelectorAll('.corrida-row')).forEach(el => el.remove());
    return;
  }

  empty.hidden = true;
  Array.from(lista.querySelectorAll('.corrida-row')).forEach(el => el.remove());

  state.corridasApp.forEach((corrida, i) => {
    const row = document.createElement('div');
    row.className = 'corrida-row';
    row.innerHTML = `
      <div class="corrida-info">
        <span class="corrida-plataforma">${escapeHtml(corrida.plataforma || 'App')}</span>
        <span class="corrida-meta">${corrida.km ? `${Number(corrida.km).toFixed(1)} km` : 'KM não informado'}</span>
      </div>
      <span class="corrida-valor">${formatReal(corrida.valor)}</span>
      <div class="corrida-actions">
        ${htmlIconEditar('app', i)}

        ${htmlIconExcluir('app', i)}
      </div>`;
    lista.appendChild(row);
  });
}

function renderCorridasParticular() {
  const lista = $('lista-corridas-particular');
  const empty = $('empty-corridas-particular');
  const sub = $('sub-corridas-particular');

  const total = state.corridasParticular.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  const count = state.corridasParticular.length;

  sub.textContent = `${count} ${count === 1 ? 'corrida' : 'corridas'} \u2022 ${formatReal(total)}`;

  if (count === 0) {
    empty.hidden = false;
    Array.from(lista.querySelectorAll('.corrida-row')).forEach(el => el.remove());
    return;
  }

  empty.hidden = true;
  Array.from(lista.querySelectorAll('.corrida-row')).forEach(el => el.remove());

  state.corridasParticular.forEach((corrida, i) => {
    const row = document.createElement('div');
    row.className = 'corrida-row';
    row.innerHTML = `
      <div class="corrida-info">
        <span class="corrida-plataforma">Particular</span>
        <span class="corrida-meta">${corrida.km ? `${Number(corrida.km).toFixed(1)} km` : 'KM não informado'}</span>
      </div>
      <span class="corrida-valor">${formatReal(corrida.valor)}</span>
      <div class="corrida-actions">
        ${htmlIconEditar('particular', i)}
        ${htmlIconExcluir('particular', i)}
      </div>`;
    lista.appendChild(row);
  });
}

function renderCombustivel() {
  const lista = $('lista-combustivel');
  const empty = $('empty-combustivel');
  const sub = $('sub-combustivel');

  Array.from(lista.querySelectorAll('.combustivel-row')).forEach(el => el.remove());

  if (!state.combustivel) {
    empty.hidden = false;
    sub.textContent = 'Nenhum abastecimento';
    return;
  }

  empty.hidden = true;
  const comb = state.combustivel;
  const litrosTrabalho = Number(comb.litros_trabalho) || 0;
  const litrosOcioso = Number(comb.litros_ocioso) || 0;
  const preco = Number(comb.preco_litro) || 0;
  const total = (litrosTrabalho + litrosOcioso) * preco;
  const totalTrabalho = litrosTrabalho * preco;

  sub.textContent = `${(litrosTrabalho + litrosOcioso).toFixed(1)}L \u2022 ${formatReal(total)}`;

  const row = document.createElement('div');
  row.className = 'combustivel-row';
  row.innerHTML = `
    <div class="combustivel-info">
      <span class="combustivel-titulo-row">Abastecimento</span>
      <span class="combustivel-meta">
        ${formatReal(preco)}/L &bull;
        Trabalho: ${litrosTrabalho.toFixed(1)}L (${formatReal(totalTrabalho)})
        ${litrosOcioso > 0 ? ` &bull; Ocioso: ${litrosOcioso.toFixed(1)}L` : ''}
      </span>
    </div>
    <span class="combustivel-valor">${formatReal(total)}</span>
    <div class="combustivel-actions">
      ${htmlIconEditar('combustivel', 0)}
      ${htmlIconExcluir('combustivel', 0)}
    </div>`;
  lista.appendChild(row);
}

function renderKmOcioso() {
  const sub = $('sub-km-ocioso');
  const toggle = $('toggle-km-ocioso');
  const campos = $('bloco-km-ocioso-campos');
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
// Preenchimento de selects
// ─────────────────────────────────────────────

function preencherSelectVeiculos() {
  const sel = $('select-veiculo');
  if (state.veiculos.length === 0) {
    sel.innerHTML = '<option value="">Nenhum veículo cadastrado</option>';
    return;
  }
  sel.innerHTML = state.veiculos
    .map(v => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.modelo || v.placa || 'Veículo')}</option>`)
    .join('');
  const padrao = state.veiculos.find(v => v.default);
  sel.value = padrao?.id || state.veiculos[0].id;
  state.veiculoId = sel.value;
}

function preencherSelectPlataformas() {
  const sel = $('inp-app-plataforma');
  sel.innerHTML = state.plataformas
    .map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
    .join('');
}

// ─────────────────────────────────────────────
// Modais: corrida de App
// ─────────────────────────────────────────────

function abrirModalCorridaApp(indice = null) {
  state.editando = { tipo: 'app', indice };

  $('modal-corrida-app-titulo').textContent = indice !== null ? 'Editar corrida de App' : 'Nova corrida de App';

  if (indice !== null) {
    const c = state.corridasApp[indice];
    $('inp-app-plataforma').value = c.plataforma || state.plataformas[0];
    $('inp-app-valor').value = c.valor || '';
    $('inp-app-km').value = c.km || '';
  } else {
    $('inp-app-plataforma').value = state.plataformas[0] || 'Uber';
    $('inp-app-valor').value = '';
    $('inp-app-km').value = '';
  }

  $('modal-corrida-app').hidden = false;
  setTimeout(() => $('inp-app-valor').focus(), 0);
}

function fecharModalCorridaApp() {
  $('modal-corrida-app').hidden = true;
  state.editando = { tipo: null, indice: null };
}

function salvarCorridaApp() {
  const plataforma = $('inp-app-plataforma').value;
  const valor = Number($('inp-app-valor').value);
  const km = Number($('inp-app-km').value) || 0;

  if (!Number.isFinite(valor) || valor <= 0) {
    toast('Informe o valor recebido.', 'aviso');
    return;
  }

  const corrida = { plataforma, valor, km };
  const { indice } = state.editando;

  if (indice !== null) {
    state.corridasApp[indice] = corrida;
  } else {
    state.corridasApp.push(corrida);
  }

  fecharModalCorridaApp();
  renderBlocos();
}

// ─────────────────────────────────────────────
// Modais: corrida particular
// ─────────────────────────────────────────────

function abrirModalCorridaParticular(indice = null) {
  state.editando = { tipo: 'particular', indice };
  $('modal-corrida-particular-titulo').textContent = indice !== null ? 'Editar corrida particular' : 'Nova corrida particular';

  if (indice !== null) {
    const c = state.corridasParticular[indice];
    $('inp-particular-valor').value = c.valor || '';
    $('inp-particular-km').value = c.km || '';
  } else {
    $('inp-particular-valor').value = '';
    $('inp-particular-km').value = '';
  }

  $('modal-corrida-particular').hidden = false;
  setTimeout(() => $('inp-particular-valor').focus(), 0);
}

function fecharModalCorridaParticular() {
  $('modal-corrida-particular').hidden = true;
  state.editando = { tipo: null, indice: null };
}

function salvarCorridaParticular() {
  const valor = Number($('inp-particular-valor').value);
  const km = Number($('inp-particular-km').value) || 0;

  if (!Number.isFinite(valor) || valor <= 0) {
    toast('Informe o valor recebido.', 'aviso');
    return;
  }

  const corrida = { valor, km };
  const { indice } = state.editando;

  if (indice !== null) {
    state.corridasParticular[indice] = corrida;
  } else {
    state.corridasParticular.push(corrida);
  }

  fecharModalCorridaParticular();
  renderBlocos();
}

// ─────────────────────────────────────────────
// Modais: combustível
// ─────────────────────────────────────────────

function atualizarTotalCombustivel() {
  const preco = Number($('inp-comb-preco').value) || 0;
  const litrosTrabalho = Number($('inp-comb-trabalho').value) || 0;
  const litrosOcioso = Number($('inp-comb-ocioso').value) || 0;
  const total = (litrosTrabalho + litrosOcioso) * preco;
  $('comb-total-valor').textContent = formatReal(total);
}

function abrirModalCombustivel() {
  state.editando = { tipo: 'combustivel', indice: 0 };

  if (state.combustivel) {
    $('inp-comb-preco').value = state.combustivel.preco_litro || '';
    $('inp-comb-trabalho').value = state.combustivel.litros_trabalho || '';
    $('inp-comb-ocioso').value = state.combustivel.litros_ocioso || '';
  } else {
    $('inp-comb-preco').value = '';
    $('inp-comb-trabalho').value = '';
    $('inp-comb-ocioso').value = '';
  }

  atualizarTotalCombustivel();
  $('modal-combustivel-titulo').textContent = state.combustivel ? 'Editar combustível' : 'Registrar combustível';
  $('modal-combustivel').hidden = false;
  setTimeout(() => $('inp-comb-preco').focus(), 0);
}

function fecharModalCombustivel() {
  $('modal-combustivel').hidden = true;
  state.editando = { tipo: null, indice: null };
}

function salvarCombustivel() {
  const preco = Number($('inp-comb-preco').value);
  const litrosTrabalho = Number($('inp-comb-trabalho').value) || 0;
  const litrosOcioso = Number($('inp-comb-ocioso').value) || 0;

  if (!Number.isFinite(preco) || preco <= 0) {
    toast('Informe o preço do litro.', 'aviso');
    return;
  }
  if (litrosTrabalho <= 0 && litrosOcioso <= 0) {
    toast('Informe a quantidade de litros abastecida.', 'aviso');
    return;
  }

  state.combustivel = {
    preco_litro: preco,
    litros_trabalho: litrosTrabalho,
    litros_ocioso: litrosOcioso
  };

  fecharModalCombustivel();
  renderBlocos();
}

// ─────────────────────────────────────────────
// Modal de exclusão
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

  if (tipo === 'app') {
    state.corridasApp.splice(indice, 1);
  } else if (tipo === 'particular') {
    state.corridasParticular.splice(indice, 1);
  } else if (tipo === 'combustivel') {
    state.combustivel = null;
  }

  fecharModalExcluir();
  renderBlocos();
  toast('Removido.', 'sucesso');
}

// ─────────────────────────────────────────────
// Salvar lançamentos do dia no Firestore
// ─────────────────────────────────────────────

async function salvarDia() {
  if (!state.diaSelecionado) {
    toast('Selecione um dia no calendário.', 'aviso');
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

    if (state.combustivel) {
      dados.combustivel = state.combustivel;
    }

    if (state.veiculoId) {
      dados.veiculo_id = state.veiculoId;
    }

    const date = strParaDate(state.diaSelecionado);
    await saveLancamentoDia(state.user.uid, dados, date);

    // Atualiza indicador no calendário
    const temConteudo =
      state.corridasApp.length > 0 ||
      state.corridasParticular.length > 0 ||
      state.combustivel !== null ||
      state.kmOcioso > 0;

    if (temConteudo) {
      state.diasComLancamento.add(state.diaSelecionado);
    } else {
      state.diasComLancamento.delete(state.diaSelecionado);
    }

    renderCalendario();
    toast('Lançamentos salvos com sucesso.', 'sucesso');
  } catch (e) {
    console.error('[DriveFinance/lancamentos/salvar]', e);
    toast('Não foi possível salvar. Tente novamente.', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar lançamentos do dia';
  }
}

// ─────────────────────────────────────────────
// Escape HTML
// ─────────────────────────────────────────────

function escapeHtml(valor = '') {
  return String(valor)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ─────────────────────────────────────────────
// Fechar modais abertos
// ─────────────────────────────────────────────

function fecharModaisAbertos() {
  if (!$('modal-corrida-app').hidden) fecharModalCorridaApp();
  if (!$('modal-corrida-particular').hidden) fecharModalCorridaParticular();
  if (!$('modal-combustivel').hidden) fecharModalCombustivel();
  if (!$('modal-excluir').hidden) fecharModalExcluir();
}

// ─────────────────────────────────────────────
// Eventos
// ─────────────────────────────────────────────

function bindEvents() {
  // Navegação de mês no calendário
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

  // Troca de veículo
  $('select-veiculo').addEventListener('change', e => {
    state.veiculoId = e.target.value || null;
  });

  // Botões de adicionar nos blocos
  $('btn-add-corrida-app').addEventListener('click', () => {
    if (!state.diaSelecionado) {
      toast('Selecione um dia no calendário primeiro.', 'aviso');
      return;
    }
    abrirModalCorridaApp();
  });

  $('btn-add-corrida-particular').addEventListener('click', () => {
    if (!state.diaSelecionado) {
      toast('Selecione um dia no calendário primeiro.', 'aviso');
      return;
    }
    abrirModalCorridaParticular();
  });

  $('btn-add-combustivel').addEventListener('click', () => {
    if (!state.diaSelecionado) {
      toast('Selecione um dia no calendário primeiro.', 'aviso');
      return;
    }
    abrirModalCombustivel();
  });

  // Toggle KM ocioso
  $('toggle-km-ocioso').addEventListener('change', e => {
    const ativo = e.target.checked;
    $('bloco-km-ocioso-campos').hidden = !ativo;
    if (!ativo) {
      state.kmOcioso = 0;
      $('inp-km-ocioso').value = '';
      $('sub-km-ocioso').textContent = 'Nenhum KM ocioso registrado';
    } else {
      if (!state.diaSelecionado) {
        toast('Selecione um dia no calendário primeiro.', 'aviso');
        e.target.checked = false;
        $('bloco-km-ocioso-campos').hidden = true;
        return;
      }
      setTimeout(() => $('inp-km-ocioso').focus(), 0);
    }
  });

  $('inp-km-ocioso').addEventListener('input', e => {
    state.kmOcioso = Number(e.target.value) || 0;
    if (state.kmOcioso > 0) {
      $('sub-km-ocioso').textContent = `${state.kmOcioso.toFixed(1)} km fora do trabalho`;
    } else {
      $('sub-km-ocioso').textContent = 'Nenhum KM ocioso registrado';
    }
  });

  // Modal corrida app
  $('btn-fechar-corrida-app').addEventListener('click', fecharModalCorridaApp);
  $('btn-cancelar-corrida-app').addEventListener('click', fecharModalCorridaApp);
  $('btn-salvar-corrida-app').addEventListener('click', salvarCorridaApp);

  // Modal corrida particular
  $('btn-fechar-corrida-particular').addEventListener('click', fecharModalCorridaParticular);
  $('btn-cancelar-corrida-particular').addEventListener('click', fecharModalCorridaParticular);
  $('btn-salvar-corrida-particular').addEventListener('click', salvarCorridaParticular);

  // Modal combustível
  $('btn-fechar-combustivel').addEventListener('click', fecharModalCombustivel);
  $('btn-cancelar-combustivel').addEventListener('click', fecharModalCombustivel);
  $('btn-salvar-combustivel').addEventListener('click', salvarCombustivel);
  ['inp-comb-preco', 'inp-comb-trabalho', 'inp-comb-ocioso'].forEach(id => {
    $(id).addEventListener('input', atualizarTotalCombustivel);
  });

  // Modal excluir
  $('btn-fechar-excluir').addEventListener('click', fecharModalExcluir);
  $('btn-cancelar-excluir').addEventListener('click', fecharModalExcluir);
  $('btn-confirmar-excluir').addEventListener('click', confirmarExcluir);

  // Delegação: editar/excluir itens nas listas
  ['lista-corridas-app', 'lista-corridas-particular', 'lista-combustivel'].forEach(listaId => {
    $(listaId).addEventListener('click', e => {
      const btn = e.target.closest('[data-acao]');
      if (!btn) return;

      const acao = btn.dataset.acao;
      const tipo = btn.dataset.tipo;
      const indice = Number(btn.dataset.indice);

      if (acao === 'editar') {
        if (tipo === 'app') abrirModalCorridaApp(indice);
        else if (tipo === 'particular') abrirModalCorridaParticular(indice);
        else if (tipo === 'combustivel') abrirModalCombustivel();
      }

      if (acao === 'excluir') {
        abrirModalExcluir(tipo, indice);
      }
    });
  });

  // Salvar o dia
  $('btn-salvar-dia').addEventListener('click', salvarDia);

  // Fechar modais com Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') fecharModaisAbertos();
  });
}

// ─────────────────────────────────────────────
// Inicialização
// ─────────────────────────────────────────────

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
    renderNav('lancamentos.html', perfil, { paginasProntas: PAGINAS_PRONTAS });

    // Carrega veículos e config em paralelo
    const [veiculos, config] = await Promise.all([
      getVeiculos(state.user.uid),
      getConfig(state.user.uid)
    ]);

    state.veiculos = veiculos;
    state.plataformas = config.plataformas?.length ? config.plataformas : ['Uber'];

    preencherSelectVeiculos();
    preencherSelectPlataformas();
    bindEvents();

    // Carrega dias com lançamento do mês atual
    await carregarDiasComLancamento();

    // Seleciona hoje como padrão
    await selecionarDia(hojeStr());

  } catch (e) {
    console.error('[DriveFinance/lancamentos]', e);
    toast('Erro ao carregar a página. Recarregue.', 'erro');
  }
}

init();
