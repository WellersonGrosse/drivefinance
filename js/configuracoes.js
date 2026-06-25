/**
 * configuracoes.js — DriveFinance
 */

import {
  exigirLogin,
  getPerfil, updatePerfil,
  getConfig, saveConfig,
  getVeiculos, addVeiculo, updateVeiculo, deleteVeiculo,
  logout, isAdmin,
  formatData, toast
} from './app.js';

import { auth } from './firebase-config.js';
import { sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ─── Estado ───────────────────────────────────────────────────────────────────
let _uid = null;
let _perfil = null;
let _config = null;
let _veiculos = [];
let _carrosselIdx = 0;
let _editandoVeiculoId = null;
let _fotoAtualUrl = null;
let _fotoBuscaTimer = null;
let _fotoBuscaChave = '';
let _fotoResultados = [];
let _fotoResultadoIdx = -1;
let _fotoAbortController = null;
let _fotoBuscaSequencia = 0;
let _fotoUrlsFalharam = new Set();

const DIAS_NOMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const user = await exigirLogin();
  _uid = user.uid;

  await Promise.all([carregarPerfil(), carregarConfig(), carregarVeiculos()]);

  preencherSidebar();
  configurarSidebar();
  configurarTabs();
  configurarPessoal();
  configurarProfissional();
  configurarVeiculos();
  configurarConta();

  // Mostra app, oculta loading
  document.getElementById('loading-screen').hidden = true;
  document.getElementById('cfg-app').hidden = false;
});

// ─── Dados ────────────────────────────────────────────────────────────────────
async function carregarPerfil() {
  _perfil = await getPerfil(_uid);
  preencherFormPessoal();
  preencherConta();
}

async function carregarConfig() {
  _config = await getConfig(_uid);
  preencherFormProfissional();
}

async function carregarVeiculos() {
  const lista = await getVeiculos(_uid);
  _veiculos = Array.isArray(lista)
    ? lista
    : Object.entries(lista || {}).map(([id, d]) => ({ id, ...d }));
  renderCarrossel();
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
async function preencherSidebar() {
  const iniciais = iniciarDeNome(_perfil?.nome || '');
  document.getElementById('sidebar-avatar').textContent = iniciais;
  document.getElementById('sidebar-name').textContent = _perfil?.nome || 'Usuário';
  document.getElementById('sidebar-email').textContent = _perfil?.email || '';
  document.getElementById('sidebar-plan').textContent =
    'Plano ' + formatarPlano(_perfil?.plano);
  document.getElementById('topbar-avatar').textContent = iniciais;

  // Admin link
  const adminOk = await isAdmin(_uid).catch(() => false);
  if (adminOk) document.getElementById('admin-link').hidden = false;
}

function configurarSidebar() {
  const btn = document.getElementById('btn-menu');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  btn?.addEventListener('click', () => {
    sidebar.classList.toggle('aberta');
    overlay.classList.toggle('visivel');
  });
  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('aberta');
    overlay.classList.remove('visivel');
  });
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function configurarTabs() {
  document.querySelectorAll('.cfg-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cfg-tab').forEach(t => t.classList.remove('ativo'));
      document.querySelectorAll('.cfg-section').forEach(s => { s.hidden = true; });
      tab.classList.add('ativo');
      document.getElementById(`tab-${tab.dataset.tab}`).hidden = false;
    });
  });
}

// ─── PERFIL PESSOAL ───────────────────────────────────────────────────────────
function preencherFormPessoal() {
  if (!_perfil) return;
  document.getElementById('input-nome').value = _perfil.nome || '';
  document.getElementById('input-telefone').value = _perfil.telefone || '';
  document.getElementById('input-nascimento').value = _perfil.data_nascimento || '';
  const iniciais = iniciarDeNome(_perfil.nome || '');
  document.getElementById('avatar-display').textContent = iniciais;
  document.getElementById('avatar-nome-display').textContent = _perfil.nome || 'Seu nome';
  document.getElementById('avatar-email-display').textContent = _perfil.email || '';
}

function configurarPessoal() {
  document.getElementById('input-nome').addEventListener('input', e => {
    document.getElementById('avatar-display').textContent = iniciarDeNome(e.target.value);
    document.getElementById('avatar-nome-display').textContent = e.target.value || 'Seu nome';
  });
  document.getElementById('btn-salvar-pessoal').addEventListener('click', salvarPessoal);
}

async function salvarPessoal() {
  const btn = document.getElementById('btn-salvar-pessoal');
  const nome = document.getElementById('input-nome').value.trim();
  if (!nome) { toast('Informe seu nome', 'aviso'); return; }
  btnLoading(btn, true);
  try {
    await updatePerfil(_uid, {
      nome,
      telefone: document.getElementById('input-telefone').value.trim(),
      data_nascimento: document.getElementById('input-nascimento').value
    });
    _perfil = { ..._perfil, nome };
    preencherSidebar();
    toast('Perfil pessoal salvo!', 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar perfil', 'erro');
  } finally {
    btnLoading(btn, false);
  }
}

// ─── PERFIL PROFISSIONAL ──────────────────────────────────────────────────────
function preencherFormProfissional() {
  document.getElementById('input-salario').value = _perfil?.salario_liquido || '';

  const diasAtivos = _config?.dias_trabalho || [];
  document.querySelectorAll('.dia-toggle').forEach(btn => {
    btn.setAttribute('aria-pressed', diasAtivos.includes(parseInt(btn.dataset.dia)) ? 'true' : 'false');
  });
  atualizarResumodias();

  renderPlataformas();

  document.getElementById('toggle-superavit').checked = !!_config?.superavit;
  document.getElementById('toggle-deficit').checked = !!_config?.deficit;
}

function configurarProfissional() {
  document.querySelectorAll('.dia-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const atual = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', atual ? 'false' : 'true');
      atualizarResumodias();
    });
  });

  document.getElementById('btn-add-plataforma').addEventListener('click', () => {
    document.getElementById('add-plataforma-form').hidden = false;
    document.getElementById('btn-add-plataforma').hidden = true;
    document.getElementById('input-nova-plataforma').focus();
  });
  document.getElementById('btn-cancelar-plataforma').addEventListener('click', fecharFormPlataforma);
  document.getElementById('btn-confirmar-plataforma').addEventListener('click', adicionarPlataforma);
  document.getElementById('input-nova-plataforma').addEventListener('keydown', e => {
    if (e.key === 'Enter') adicionarPlataforma();
    if (e.key === 'Escape') fecharFormPlataforma();
  });

  document.getElementById('btn-salvar-profissional').addEventListener('click', salvarProfissional);
}

function atualizarResumodias() {
  const selecionados = [];
  // Ordem lógica: Seg=1 … Dom=0
  const ordem = [1,2,3,4,5,6,0];
  ordem.forEach(dia => {
    const btn = document.querySelector(`.dia-toggle[data-dia="${dia}"]`);
    if (btn?.getAttribute('aria-pressed') === 'true') {
      selecionados.push(DIAS_NOMES[dia]);
    }
  });

  const el = document.getElementById('dias-resumo');
  if (selecionados.length === 0) {
    el.textContent = 'Nenhum dia selecionado';
    el.classList.remove('tem-dias');
  } else if (selecionados.length === 7) {
    el.textContent = '✓ Todos os dias selecionados';
    el.classList.add('tem-dias');
  } else {
    el.textContent = `✓ ${selecionados.join(', ')}`;
    el.classList.add('tem-dias');
  }
}

function renderPlataformas() {
  const lista = document.getElementById('plataformas-lista');
  const PADROES = ['Uber', '99', 'InDrive'];
  const icones = { 'Uber': '🚗', '99': '🟡', 'InDrive': '🚙' };

  const plataformas = _config?.plataformas || [];
  const customizadas = plataformas
    .map(p => typeof p === 'string' ? p : p.nome)
    .filter(n => !PADROES.includes(n));

  const todas = [...PADROES, ...customizadas];

  const ativas = new Set(
    plataformas.filter(p => p.ativa !== false).map(p => typeof p === 'string' ? p : p.nome)
  );

  lista.innerHTML = '';
  todas.forEach(nome => {
    const row = document.createElement('div');
    row.className = `plataforma-row${ativas.has(nome) ? ' ativa' : ''}`;
    row.dataset.nome = nome;
    const isPadrao = PADROES.includes(nome);
    row.innerHTML = `
      <div class="plataforma-nome">
        <div class="plataforma-icone">${icones[nome] || '🔷'}</div>
        <span>${nome}</span>
      </div>
      <div class="plataforma-acoes">
        ${!isPadrao ? `<button class="plataforma-remover" data-plat="${nome}" title="Remover">✕</button>` : ''}
        <label class="toggle">
          <input type="checkbox" class="plat-toggle" data-nome="${nome}" ${ativas.has(nome) ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>
    `;
    lista.appendChild(row);
  });

  lista.querySelectorAll('.plat-toggle').forEach(chk => {
    chk.addEventListener('change', () => {
      chk.closest('.plataforma-row').classList.toggle('ativa', chk.checked);
    });
  });
  lista.querySelectorAll('.plataforma-remover').forEach(btn => {
    btn.addEventListener('click', () => {
      const nome = btn.dataset.plat;
      if (_config.plataformas) {
        _config.plataformas = _config.plataformas.filter(p => (p.nome || p) !== nome);
      }
      renderPlataformas();
    });
  });
}

function adicionarPlataforma() {
  const input = document.getElementById('input-nova-plataforma');
  const nome = input.value.trim();
  if (!nome) { toast('Digite o nome da plataforma', 'aviso'); return; }
  const existentes = Array.from(document.querySelectorAll('.plataforma-row')).map(r => r.dataset.nome.toLowerCase());
  if (existentes.includes(nome.toLowerCase())) { toast('Essa plataforma já existe', 'aviso'); return; }
  if (!_config.plataformas) _config.plataformas = [];
  _config.plataformas.push({ nome, ativa: true });
  input.value = '';
  fecharFormPlataforma();
  renderPlataformas();
}

function fecharFormPlataforma() {
  document.getElementById('add-plataforma-form').hidden = true;
  document.getElementById('btn-add-plataforma').hidden = false;
  document.getElementById('input-nova-plataforma').value = '';
}

async function salvarProfissional() {
  const btn = document.getElementById('btn-salvar-profissional');
  btnLoading(btn, true);
  try {
    const salario = parseFloat(document.getElementById('input-salario').value) || 0;
    const dias = [];
    document.querySelectorAll('.dia-toggle').forEach(b => {
      if (b.getAttribute('aria-pressed') === 'true') dias.push(parseInt(b.dataset.dia));
    });
    const plataformas = [];
    document.querySelectorAll('.plataforma-row').forEach(row => {
      plataformas.push({ nome: row.dataset.nome, ativa: row.querySelector('.plat-toggle')?.checked ?? false });
    });

    await updatePerfil(_uid, { salario_liquido: salario });
    await saveConfig(_uid, {
      dias_trabalho: dias, plataformas,
      superavit: document.getElementById('toggle-superavit').checked,
      deficit: document.getElementById('toggle-deficit').checked
    });
    _perfil = { ..._perfil, salario_liquido: salario };
    toast('Configurações profissionais salvas!', 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar configurações', 'erro');
  } finally {
    btnLoading(btn, false);
  }
}

// ─── VEÍCULOS ─────────────────────────────────────────────────────────────────
function configurarVeiculos() {
  document.getElementById('arrow-left').addEventListener('click', () => moverCarrossel(-1));
  document.getElementById('arrow-right').addEventListener('click', () => moverCarrossel(1));
  document.getElementById('btn-add-veiculo').addEventListener('click', () => abrirModalVeiculo(null));
  document.getElementById('btn-add-veiculo-empty')?.addEventListener('click', () => abrirModalVeiculo(null));

  document.getElementById('btn-editar-veiculo').addEventListener('click', () => {
    const v = _veiculos[_carrosselIdx];
    if (v) abrirModalVeiculo(v);
  });
  document.getElementById('btn-remover-veiculo').addEventListener('click', () => {
    const v = _veiculos[_carrosselIdx];
    if (!v) return;
    const nomeVeiculo = [v.marca, v.modelo].filter(Boolean).join(' ') || 'Este veículo';
    document.getElementById('modal-remover-texto').textContent = `"${nomeVeiculo}" será removido permanentemente.`;
    document.getElementById('modal-remover-veiculo').hidden = false;
  });

  document.getElementById('modal-remover-fechar').addEventListener('click', () => { document.getElementById('modal-remover-veiculo').hidden = true; });
  document.getElementById('btn-remover-cancelar').addEventListener('click', () => { document.getElementById('modal-remover-veiculo').hidden = true; });
  document.getElementById('btn-remover-confirmar').addEventListener('click', confirmarRemocao);

  document.getElementById('modal-veiculo-fechar').addEventListener('click', fecharModalVeiculo);
  document.getElementById('btn-modal-cancelar').addEventListener('click', fecharModalVeiculo);
  document.getElementById('btn-modal-salvar').addEventListener('click', salvarVeiculo);
  document.getElementById('btn-rebuscar-foto').addEventListener('click', () => buscarFotoVeiculo(true));

  const inputMarca = document.getElementById('v-marca');
  const inputModelo = document.getElementById('v-modelo');
  const inputCor = document.getElementById('v-cor');

  [inputMarca, inputModelo, inputCor].forEach(input => {
    input.addEventListener('input', () => {
      invalidarFotoSeBuscaMudou();
      agendarBuscaFoto(700);
    });

    input.addEventListener('blur', () => {
      if (
        inputMarca.value.trim() &&
        inputModelo.value.trim()
      ) {
        buscarFotoVeiculo(false);
      }
    });
  });

  document.getElementById('foto-img').addEventListener('error', tentarProximaFotoDisponivel);

  // Swipe touch
  const track = document.getElementById('carrossel-track');
  let touchX = 0;
  track.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend', e => {
    const diff = touchX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) moverCarrossel(diff > 0 ? 1 : -1);
  });
  track.addEventListener('click', e => {
    const card = e.target.closest('.veiculo-card');
    if (!card) return;
    const idx = parseInt(card.dataset.idx);
    if (!isNaN(idx) && idx !== _carrosselIdx) { _carrosselIdx = idx; renderCarrossel(); }
  });

  // Fechar modais pelo overlay
  ['modal-logout', 'modal-remover-veiculo', 'modal-veiculo'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target.id === id) {
        document.getElementById(id).hidden = true;
        if (id === 'modal-veiculo') fecharModalVeiculo();
      }
    });
  });
}

function renderCarrossel() {
  const wrapper = document.getElementById('carrossel-wrapper');
  const empty = document.getElementById('veiculos-empty');
  const acoes = document.getElementById('veiculo-acoes');
  const track = document.getElementById('carrossel-track');
  const dots = document.getElementById('carrossel-dots');

  if (_veiculos.length === 0) {
    wrapper.hidden = true; empty.hidden = false; acoes.hidden = true; return;
  }
  empty.hidden = true; wrapper.hidden = false; acoes.hidden = false;

  if (_carrosselIdx >= _veiculos.length) _carrosselIdx = _veiculos.length - 1;
  if (_carrosselIdx < 0) _carrosselIdx = 0;

  document.getElementById('arrow-left').disabled = _veiculos.length <= 1;
  document.getElementById('arrow-right').disabled = _veiculos.length <= 1;

  track.innerHTML = '';
  _veiculos.forEach((v, idx) => track.appendChild(criarCardVeiculo(v, idx)));
  posicionarCards();

  dots.innerHTML = '';
  _veiculos.forEach((_, idx) => {
    const dot = document.createElement('div');
    dot.className = `carrossel-dot${idx === _carrosselIdx ? ' ativo' : ''}`;
    dots.appendChild(dot);
  });
}

function criarCardVeiculo(v, idx) {
  const card = document.createElement('div');
  card.className = 'veiculo-card';
  card.dataset.idx = idx;
  const nomeVeiculo = [v.marca, v.modelo].filter(Boolean).join(' ') || 'Veículo';
  const fotoHtml = v.foto_url
    ? `<img class="veiculo-card-foto" src="${v.foto_url}" alt="${nomeVeiculo}" onerror="this.style.display='none'" />`
    : `<div class="veiculo-card-foto-placeholder">🚗</div>`;
  card.innerHTML = `
    ${fotoHtml}
    <div class="veiculo-card-body">
      <p class="veiculo-card-modelo">${nomeVeiculo}${v.placa ? ' · ' + v.placa : ''}</p>
      <div class="veiculo-card-detalhes">
        ${v.default ? '<span class="veiculo-tag padrao">⭐ Padrão</span>' : ''}
        ${v.cor ? `<span class="veiculo-tag">${v.cor}</span>` : ''}
        ${v.combustivel ? `<span class="veiculo-tag">${v.combustivel}</span>` : ''}
      </div>
    </div>
  `;
  return card;
}

function posicionarCards() {
  document.querySelectorAll('.veiculo-card').forEach((card, idx) => {
    card.classList.remove('pos-center','pos-left','pos-right','pos-hidden-left','pos-hidden-right');
    const diff = idx - _carrosselIdx;
    if (diff === 0) card.classList.add('pos-center');
    else if (diff === 1) card.classList.add('pos-right');
    else if (diff === -1) card.classList.add('pos-left');
    else if (diff > 1) card.classList.add('pos-hidden-right');
    else card.classList.add('pos-hidden-left');
  });
}

function moverCarrossel(dir) {
  if (_veiculos.length <= 1) return;
  _carrosselIdx = (_carrosselIdx + dir + _veiculos.length) % _veiculos.length;
  posicionarCards();
  document.querySelectorAll('.carrossel-dot').forEach((d, i) => d.classList.toggle('ativo', i === _carrosselIdx));
}

// ─── Modal veículo ────────────────────────────────────────────────────────────
function abrirModalVeiculo(v) {
  cancelarBuscaFotoAtiva();
  _editandoVeiculoId = v ? v.id : null;
  document.getElementById('modal-veiculo-titulo').textContent = v ? 'Editar veículo' : 'Novo veículo';
  document.getElementById('v-marca').value = v?.marca || '';
  document.getElementById('v-modelo').value = v?.modelo || '';
  document.getElementById('v-placa').value = v?.placa || '';
  document.getElementById('v-cor').value = v?.cor || '';
  document.getElementById('v-combustivel').value = v?.combustivel || '';
  document.getElementById('v-consumo').value = v?.consumo_medio || '';
  document.getElementById('v-padrao').checked = !!v?.default;

  resetarFoto();
  if (v?.foto_url) {
    _fotoBuscaChave = obterChaveBuscaFoto();
    _fotoResultados = [{
      url: v.foto_url,
      titulo: [v.marca, v.modelo].filter(Boolean).join(' ') || 'Veículo',
      pontuacao: 0
    }];
    _fotoResultadoIdx = 0;
    mostrarFoto(v.foto_url);
  }

  document.getElementById('modal-veiculo').hidden = false;
}

function fecharModalVeiculo() {
  cancelarBuscaFotoAtiva();
  document.getElementById('modal-veiculo').hidden = true;
  _editandoVeiculoId = null;
  resetarFoto();
}

async function salvarVeiculo() {
  const btn = document.getElementById('btn-modal-salvar');
  const marca = document.getElementById('v-marca').value.trim();
  const modelo = document.getElementById('v-modelo').value.trim();

  if (!marca) { toast('Informe a marca do veículo', 'aviso'); return; }
  if (!modelo) { toast('Informe o modelo do veículo', 'aviso'); return; }

  btnLoading(btn, true);
  try {
    const dados = {
      marca,
      modelo,
      placa: document.getElementById('v-placa').value.trim().toUpperCase(),
      cor: document.getElementById('v-cor').value.trim(),
      combustivel: document.getElementById('v-combustivel').value,
      consumo_medio: parseFloat(document.getElementById('v-consumo').value) || null,
      default: document.getElementById('v-padrao').checked,
      foto_url: _fotoAtualUrl || null
    };
    if (dados.default) {
      for (const v of _veiculos) {
        if (v.id !== _editandoVeiculoId && v.default) await updateVeiculo(_uid, v.id, { default: false });
      }
    }
    if (_editandoVeiculoId) {
      await updateVeiculo(_uid, _editandoVeiculoId, dados);
      toast('Veículo atualizado!', 'sucesso');
    } else {
      await addVeiculo(_uid, dados);
      toast('Veículo adicionado!', 'sucesso');
    }
    fecharModalVeiculo();
    await carregarVeiculos();
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar veículo', 'erro');
  } finally {
    btnLoading(btn, false);
  }
}

async function confirmarRemocao() {
  const v = _veiculos[_carrosselIdx];
  if (!v) return;
  try {
    await deleteVeiculo(_uid, v.id);
    document.getElementById('modal-remover-veiculo').hidden = true;
    if (_carrosselIdx > 0) _carrosselIdx--;
    await carregarVeiculos();
    toast('Veículo removido', 'info');
  } catch (e) {
    console.error(e);
    toast('Erro ao remover veículo', 'erro');
  }
}

// ─── Foto automática via Wikipedia/Wikimedia Commons (sem chave) ─────────────
const CORES_BUSCA = {
  'branco': 'white',
  'branca': 'white',
  'preto': 'black',
  'preta': 'black',
  'prata': 'silver',
  'prateado': 'silver',
  'prateada': 'silver',
  'cinza': 'gray',
  'cinza chumbo': 'dark gray',
  'chumbo': 'dark gray',
  'vermelho': 'red',
  'vermelha': 'red',
  'azul': 'blue',
  'azul marinho': 'navy blue',
  'verde': 'green',
  'amarelo': 'yellow',
  'amarela': 'yellow',
  'marrom': 'brown',
  'bege': 'beige',
  'dourado': 'gold',
  'dourada': 'gold',
  'laranja': 'orange',
  'roxo': 'purple',
  'roxa': 'purple',
  'vinho': 'burgundy'
};

const CORES_CANONICAS = {
  'branco': 'branco', 'branca': 'branco', 'white': 'branco',
  'preto': 'preto', 'preta': 'preto', 'black': 'preto',
  'prata': 'prata', 'prateado': 'prata', 'prateada': 'prata', 'silver': 'prata',
  'cinza': 'cinza', 'gray': 'cinza', 'grey': 'cinza',
  'cinza chumbo': 'chumbo', 'chumbo': 'chumbo', 'dark gray': 'chumbo', 'dark grey': 'chumbo',
  'vermelho': 'vermelho', 'vermelha': 'vermelho', 'red': 'vermelho',
  'azul': 'azul', 'blue': 'azul',
  'azul marinho': 'azul marinho', 'navy': 'azul marinho', 'navy blue': 'azul marinho',
  'verde': 'verde', 'green': 'verde',
  'amarelo': 'amarelo', 'amarela': 'amarelo', 'yellow': 'amarelo',
  'marrom': 'marrom', 'brown': 'marrom',
  'bege': 'bege', 'beige': 'bege',
  'dourado': 'dourado', 'dourada': 'dourado', 'gold': 'dourado',
  'laranja': 'laranja', 'orange': 'laranja',
  'roxo': 'roxo', 'roxa': 'roxo', 'purple': 'roxo',
  'vinho': 'vinho', 'bordo': 'vinho', 'bordô': 'vinho', 'burgundy': 'vinho'
};

const TERMOS_COR_TITULO = {
  branco: ['branco', 'branca', 'white'],
  preto: ['preto', 'preta', 'black'],
  prata: ['prata', 'prateado', 'prateada', 'silver'],
  cinza: ['cinza', 'gray', 'grey'],
  chumbo: ['chumbo', 'dark gray', 'dark grey', 'graphite'],
  vermelho: ['vermelho', 'vermelha', 'red'],
  azul: ['azul', 'blue'],
  'azul marinho': ['azul marinho', 'navy', 'navy blue'],
  verde: ['verde', 'green'],
  amarelo: ['amarelo', 'amarela', 'yellow'],
  marrom: ['marrom', 'brown'],
  bege: ['bege', 'beige'],
  dourado: ['dourado', 'dourada', 'gold'],
  laranja: ['laranja', 'orange'],
  roxo: ['roxo', 'roxa', 'purple'],
  vinho: ['vinho', 'bordo', 'bordô', 'burgundy', 'wine red']
};

/*
 * Alguns nomes de veículos são ambíguos para mecanismos de busca.
 * Exemplo: "T-Cross" pode ser interpretado como "Model T" + "cross".
 * Este catálogo pequeno resolve os modelos mais comuns no Brasil sem limitar
 * a busca de veículos que não estejam na lista.
 */
const MODELOS_CONHECIDOS = [
  {
    detectar: compacto => compacto.includes('unoway'),
    canonico: 'Fiat Uno Way',
    aliases: ['Fiat Uno Way', 'Fiat Uno 1.0 Way', 'Fiat Uno 1.4 Way', 'Uno Way'],
    identidades: ['unoway'],
    tokensObrigatorios: ['uno', 'way'],
    categorias: ['Fiat Uno (2010)', 'Fiat Uno (2014)'],
    marcas: ['fiat']
  },
  {
    detectar: compacto => compacto.includes('unovivace'),
    canonico: 'Fiat Uno Vivace',
    aliases: ['Fiat Uno Vivace', 'Fiat Uno 1.0 Vivace', 'Fiat Uno 1.4 Vivace', 'Uno Vivace'],
    identidades: ['unovivace'],
    tokensObrigatorios: ['uno', 'vivace'],
    categorias: ['Fiat Uno (2010)'],
    marcas: ['fiat']
  },
  {
    detectar: compacto => {
      const semAno = compacto.replace(/(19|20)\d{2}/g, '');
      return semAno === 'uno' || /^uno(10|14|mille|fire|economy)?$/.test(semAno);
    },
    canonico: 'Fiat Uno',
    aliases: ['Fiat Uno', 'Uno'],
    identidades: ['uno'],
    tokensObrigatorios: ['uno'],
    categorias: ['Fiat Uno'],
    marcas: ['fiat']
  },
  {
    detectar: compacto => compacto.startsWith('gol') && !compacto.startsWith('golf'),
    canonico: 'Volkswagen Gol',
    aliases: ['Volkswagen Gol', 'VW Gol', 'Gol'],
    identidades: ['gol'],
    marcas: ['volkswagen', 'vw']
  },
  {
    detectar: compacto => compacto.startsWith('polo'),
    canonico: 'Volkswagen Polo',
    aliases: ['Volkswagen Polo', 'VW Polo', 'Polo'],
    identidades: ['polo'],
    marcas: ['volkswagen', 'vw']
  },
  {
    detectar: compacto => compacto.startsWith('agile'),
    canonico: 'Chevrolet Agile',
    aliases: ['Chevrolet Agile', 'Agile'],
    identidades: ['agile'],
    marcas: ['chevrolet', 'gm']
  },
  {
    detectar: compacto => compacto.startsWith('sonic'),
    canonico: 'Chevrolet Sonic',
    aliases: ['Chevrolet Sonic', 'Sonic'],
    identidades: ['sonic'],
    marcas: ['chevrolet', 'gm']
  },
  {
    detectar: compacto => compacto === 'ka' || compacto.startsWith('ka10') || compacto.startsWith('ka15') || compacto.startsWith('kase'),
    canonico: 'Ford Ka',
    aliases: ['Ford Ka', 'Ka'],
    identidades: ['fordka', 'ka'],
    marcas: ['ford']
  },
  {
    detectar: compacto => compacto.includes('tcross'),
    canonico: 'Volkswagen T-Cross',
    aliases: ['Volkswagen T-Cross', 'VW T-Cross', 'T-Cross'],
    identidades: ['tcross'],
    marcas: ['volkswagen', 'vw']
  },
  {
    detectar: compacto => compacto.includes('hb20s'),
    canonico: 'Hyundai HB20S',
    aliases: ['Hyundai HB20S', 'HB20S'],
    identidades: ['hb20s'],
    marcas: ['hyundai']
  },
  {
    detectar: compacto => compacto.includes('hb20'),
    canonico: 'Hyundai HB20',
    aliases: ['Hyundai HB20', 'HB20'],
    identidades: ['hb20'],
    marcas: ['hyundai']
  },
  {
    detectar: compacto => compacto.includes('onix'),
    canonico: 'Chevrolet Onix',
    aliases: ['Chevrolet Onix', 'Onix'],
    identidades: ['onix'],
    marcas: ['chevrolet']
  },
  {
    detectar: compacto => compacto.includes('creta'),
    canonico: 'Hyundai Creta',
    aliases: ['Hyundai Creta', 'Creta'],
    identidades: ['creta'],
    marcas: ['hyundai']
  },
  {
    detectar: compacto => compacto.includes('tracker'),
    canonico: 'Chevrolet Tracker',
    aliases: ['Chevrolet Tracker', 'Tracker'],
    identidades: ['tracker'],
    marcas: ['chevrolet']
  },
  {
    detectar: compacto => compacto.includes('renegade'),
    canonico: 'Jeep Renegade',
    aliases: ['Jeep Renegade', 'Renegade'],
    identidades: ['renegade'],
    marcas: ['jeep']
  },
  {
    detectar: compacto => compacto.includes('compass'),
    canonico: 'Jeep Compass',
    aliases: ['Jeep Compass', 'Compass'],
    identidades: ['compass'],
    marcas: ['jeep']
  },
  {
    detectar: compacto => compacto.includes('kicks'),
    canonico: 'Nissan Kicks',
    aliases: ['Nissan Kicks', 'Kicks'],
    identidades: ['kicks'],
    marcas: ['nissan']
  },
  {
    detectar: compacto => compacto.includes('corolla'),
    canonico: 'Toyota Corolla',
    aliases: ['Toyota Corolla', 'Corolla'],
    identidades: ['corolla'],
    marcas: ['toyota']
  },
  {
    detectar: compacto => compacto.includes('nivus'),
    canonico: 'Volkswagen Nivus',
    aliases: ['Volkswagen Nivus', 'VW Nivus', 'Nivus'],
    identidades: ['nivus'],
    marcas: ['volkswagen', 'vw']
  },
  {
    detectar: compacto => compacto.includes('virtus'),
    canonico: 'Volkswagen Virtus',
    aliases: ['Volkswagen Virtus', 'VW Virtus', 'Virtus'],
    identidades: ['virtus'],
    marcas: ['volkswagen', 'vw']
  },
  {
    detectar: compacto => compacto.includes('fastback'),
    canonico: 'Fiat Fastback',
    aliases: ['Fiat Fastback', 'Fastback'],
    identidades: ['fastback'],
    marcas: ['fiat']
  },
  {
    detectar: compacto => compacto.includes('pulse'),
    canonico: 'Fiat Pulse',
    aliases: ['Fiat Pulse', 'Pulse'],
    identidades: ['pulse'],
    marcas: ['fiat']
  },
  {
    detectar: compacto => compacto.includes('kwid'),
    canonico: 'Renault Kwid',
    aliases: ['Renault Kwid', 'Kwid'],
    identidades: ['kwid'],
    marcas: ['renault']
  }
];

const MARCAS_CONHECIDAS = [
  'volkswagen', 'vw', 'hyundai', 'chevrolet', 'fiat', 'jeep', 'toyota',
  'nissan', 'honda', 'renault', 'ford', 'peugeot', 'citroen', 'mitsubishi',
  'kia', 'bmw', 'mercedes', 'audi', 'volvo', 'chery', 'caoa', 'byd', 'gm'
];

const ALIASES_MARCAS = {
  'volkswagen': ['volkswagen', 'vw'],
  'vw': ['volkswagen', 'vw'],
  'chevrolet': ['chevrolet', 'gm'],
  'gm': ['chevrolet', 'gm'],
  'mercedes benz': ['mercedes benz', 'mercedes', 'benz'],
  'mercedes': ['mercedes benz', 'mercedes', 'benz'],
  'caoa chery': ['caoa chery', 'caoa', 'chery'],
  'chery': ['caoa chery', 'caoa', 'chery']
};

const TERMOS_GENERICOS_MODELO = new Set([
  'carro', 'car', 'automobile', 'vehicle', 'veiculo', 'modelo', 'versao',
  'flex', 'gasolina', 'etanol', 'diesel', 'hibrido', 'eletrico',
  'automatico', 'automatica', 'manual', 'turbo'
]);

function obterParametrosBuscaFoto() {
  return {
    marca: document.getElementById('v-marca').value.trim(),
    modelo: document.getElementById('v-modelo').value.trim(),
    cor: document.getElementById('v-cor').value.trim()
  };
}

function obterMensagemCamposFoto({ marca, modelo }) {
  if (!marca && !modelo) return 'Preencha marca e modelo para buscar uma foto';
  if (!marca) return 'Preencha a marca para buscar uma foto';
  if (!modelo) return 'Preencha o modelo para buscar uma foto';
  return '';
}

function agendarBuscaFoto(atraso = 700) {
  clearTimeout(_fotoBuscaTimer);

  const parametros = obterParametrosBuscaFoto();
  if (!parametros.marca || !parametros.modelo) {
    cancelarBuscaFotoAtiva();
    resetarFoto(obterMensagemCamposFoto(parametros));
    return;
  }

  _fotoBuscaTimer = setTimeout(() => {
    buscarFotoVeiculo(false);
  }, atraso);
}

function invalidarFotoSeBuscaMudou() {
  const parametros = obterParametrosBuscaFoto();
  const novaChave = obterChaveBuscaFoto(parametros.marca, parametros.modelo, parametros.cor);

  if (!parametros.marca || !parametros.modelo) {
    cancelarBuscaFotoAtiva();
    resetarFoto(obterMensagemCamposFoto(parametros));
    return;
  }

  if (novaChave === _fotoBuscaChave) return;

  clearTimeout(_fotoBuscaTimer);
  _fotoBuscaTimer = null;

  if (_fotoAbortController) {
    _fotoAbortController.abort();
    _fotoAbortController = null;
  }

  _fotoBuscaSequencia++;
  _fotoAtualUrl = null;
  _fotoResultados = [];
  _fotoResultadoIdx = -1;
  _fotoUrlsFalharam = new Set();

  // Nunca mantém na tela uma foto encontrada com valores anteriores.
  mostrarPlaceholderFoto('Atualizando a foto para os dados informados...');
}

function cancelarBuscaFotoAtiva() {
  clearTimeout(_fotoBuscaTimer);
  _fotoBuscaTimer = null;

  if (_fotoAbortController) {
    _fotoAbortController.abort();
    _fotoAbortController = null;
  }

  _fotoBuscaSequencia++;
  mostrarLoading(false);
}

async function buscarFotoVeiculo(forcar = false) {
  clearTimeout(_fotoBuscaTimer);
  _fotoBuscaTimer = null;

  const { marca, modelo, cor } = obterParametrosBuscaFoto();
  if (!marca || !modelo) {
    resetarFoto(obterMensagemCamposFoto({ marca, modelo }));
    return;
  }

  const chave = obterChaveBuscaFoto(marca, modelo, cor);

  // “Buscar outra foto” percorre somente resultados já validados para a cor atual.
  if (forcar && chave === _fotoBuscaChave && _fotoResultados.length > 1) {
    const proximoIdx = encontrarProximoIndiceFoto(_fotoResultadoIdx);
    if (proximoIdx !== -1) {
      _fotoResultadoIdx = proximoIdx;
      mostrarFoto(_fotoResultados[_fotoResultadoIdx].url);
      return;
    }
  }

  if (!forcar && chave === _fotoBuscaChave && _fotoAtualUrl) return;

  if (_fotoAbortController) _fotoAbortController.abort();
  _fotoAbortController = new AbortController();
  const signal = _fotoAbortController.signal;
  const sequencia = ++_fotoBuscaSequencia;

  mostrarLoading(true);

  try {
    const resultados = await coletarFotosVeiculo(marca, modelo, cor, signal);

    // Garante que nenhum resultado de uma busca antiga seja aplicado depois.
    if (
      sequencia !== _fotoBuscaSequencia ||
      chave !== obterChaveBuscaFoto()
    ) return;

    _fotoBuscaChave = chave;
    _fotoResultados = removerFotosDuplicadas(resultados);
    _fotoResultadoIdx = -1;
    _fotoUrlsFalharam = new Set();

    if (_fotoResultados.length === 0) {
      _fotoAtualUrl = null;
      const detalheCor = cor
        ? ` na cor ${cor}. Você pode apagar a cor para visualizar fotos do modelo em outras cores.`
        : '.';
      mostrarPlaceholderFoto(
        `Não encontramos uma foto confiável de ${marca} ${modelo}${detalheCor}`
      );
      return;
    }

    _fotoResultadoIdx = 0;
    mostrarFoto(_fotoResultados[0].url);
  } catch (erro) {
    if (erro?.name === 'AbortError' || sequencia !== _fotoBuscaSequencia) return;
    console.warn('Não foi possível buscar a foto do veículo:', erro);
    _fotoBuscaChave = chave;
    _fotoAtualUrl = null;
    _fotoResultados = [];
    _fotoResultadoIdx = -1;
    mostrarPlaceholderFoto('Não foi possível buscar a foto agora.');
  } finally {
    if (sequencia === _fotoBuscaSequencia) {
      _fotoAbortController = null;
      mostrarLoading(false);
    }
  }
}

async function coletarFotosVeiculo(marca, modelo, cor, signal) {
  const infoModelo = resolverModeloBusca(marca, modelo);
  const corNormalizada = normalizarTexto(cor);
  const corTraduzida = CORES_BUSCA[corNormalizada] || cor;
  const resultados = [];

  // A cor é opcional. Quando informada, entra em todas as consultas prioritárias.
  if (cor) {
    const termosCor = [...new Set([cor, corTraduzida].filter(Boolean))];
    for (const termoCor of termosCor) {
      const consultasComCor = montarConsultasCommons(infoModelo, termoCor, true);
      for (const consulta of consultasComCor) {
        const encontrados = await buscarFotosCommons(consulta, infoModelo, cor, signal);
        resultados.push(...encontrados);
        if (removerFotosDuplicadas(resultados).length >= 28) break;
      }
      if (removerFotosDuplicadas(resultados).length >= 28) break;
    }
  }

  // Busca sempre o modelo exato, inclusive quando a cor não foi informada.
  if (!cor || removerFotosDuplicadas(resultados).length < 16) {
    const consultasModelo = montarConsultasCommons(infoModelo, '', false);
    for (const consulta of consultasModelo) {
      const encontrados = await buscarFotosCommons(consulta, infoModelo, cor, signal);
      resultados.push(...encontrados);
      if (removerFotosDuplicadas(resultados).length >= 36) break;
    }
  }

  const wikipedia = await buscarFotosWikipedia(infoModelo, cor, signal);
  resultados.push(...wikipedia);

  const candidatos = removerFotosDuplicadas(resultados)
    .filter(item => fotoCorrespondeAoModelo(item.titulo, infoModelo))
    .sort((a, b) => b.pontuacao - a.pontuacao)
    .slice(0, 40);

  // Sem cor, retorna somente os candidatos validados para marca e modelo.
  if (!cor) return candidatos;

  // Com cor, exibe apenas fotos cuja cor tenha sido confirmada.
  const validados = await filtrarFotosPelaCor(candidatos, cor, signal);
  return validados.sort((a, b) => b.pontuacao - a.pontuacao);
}

function montarConsultasCommons(infoModelo, corTraduzida = '', incluirCor = false) {
  const consultas = [];
  const cor = incluirCor && corTraduzida ? ` ${corTraduzida}` : '';

  infoModelo.aliases.forEach(alias => {
    consultas.push(`"${alias}"${cor} automobile`);
    consultas.push(`"${alias}"${cor} car`);
    consultas.push(`intitle:"${alias}"${cor}`);
  });

  // Algumas versões, como Uno Way e Uno Vivace, ficam em categorias da geração.
  (infoModelo.categorias || []).forEach(categoria => {
    const termosVersao = (infoModelo.tokensObrigatorios || [])
      .filter(token => token !== 'uno')
      .join(' ');
    consultas.push(
      `incategory:"${categoria}"${termosVersao ? ` "${termosVersao}"` : ''}${cor}`
    );
  });

  return [...new Set(consultas)];
}

async function buscarFotosCommons(termo, infoModelo, cor, signal) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: termo,
    gsrnamespace: '6',
    gsrlimit: '24',
    prop: 'imageinfo',
    iiprop: 'url|mime|size',
    iiurlwidth: '900',
    format: 'json',
    formatversion: '2',
    origin: '*'
  });

  const resposta = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, { signal });
  if (!resposta.ok) throw new Error(`Wikimedia respondeu com status ${resposta.status}`);

  const dados = await resposta.json();
  const paginas = dados?.query?.pages || [];

  return paginas
    .map(pagina => {
      const info = pagina?.imageinfo?.[0];
      if (!info) return null;

      const url = info.thumburl || info.url;
      const mime = info.thumbmime || info.mime || '';
      const largura = Number(info.width || 0);
      const altura = Number(info.height || 0);
      const titulo = pagina.title || '';

      if (!url || !mime.startsWith('image/')) return null;
      if (mime === 'image/svg+xml' || mime === 'image/gif') return null;
      if (largura && altura && (largura < 400 || altura < 220)) return null;
      if (!fotoCorrespondeAoModelo(titulo, infoModelo)) return null;
      if (possuiTermoIndesejado(titulo)) return null;

      return {
        url,
        titulo,
        largura,
        altura,
        fonte: 'commons',
        pontuacao: pontuarFoto(titulo, infoModelo, cor, largura, altura, 'commons')
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.pontuacao - a.pontuacao);
}

async function buscarFotosWikipedia(infoModelo, cor, signal) {
  const resultados = [];

  // Primeiro tenta os títulos exatos. Isso resolve diretamente casos como
  // "Volkswagen T-Cross" sem depender da interpretação livre do buscador.
  const paramsExatos = new URLSearchParams({
    action: 'query',
    titles: infoModelo.aliases.join('|'),
    redirects: '1',
    prop: 'pageimages',
    piprop: 'thumbnail|original',
    pithumbsize: '900',
    format: 'json',
    formatversion: '2',
    origin: '*'
  });

  const respostaExata = await fetch(`https://en.wikipedia.org/w/api.php?${paramsExatos.toString()}`, { signal });
  if (respostaExata.ok) {
    const dadosExatos = await respostaExata.json();
    const paginas = dadosExatos?.query?.pages || [];
    paginas.forEach(pagina => {
      const url = pagina?.thumbnail?.source || pagina?.original?.source;
      const titulo = pagina?.title || '';
      if (!url || pagina?.missing || !fotoCorrespondeAoModelo(titulo, infoModelo) || possuiTermoIndesejado(titulo)) return;
      resultados.push({
        url,
        titulo,
        largura: Number(pagina?.thumbnail?.width || 0),
        altura: Number(pagina?.thumbnail?.height || 0),
        fonte: 'wikipedia',
        pontuacao: pontuarFoto(titulo, infoModelo, cor, 0, 0, 'wikipedia')
      });
    });
  }

  if (resultados.length > 0) return resultados;

  // Fallback para modelos cujo artigo não usa exatamente o título digitado.
  const paramsBusca = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `intitle:"${infoModelo.canonico}" automobile`,
    gsrnamespace: '0',
    gsrlimit: '6',
    prop: 'pageimages',
    piprop: 'thumbnail|original',
    pithumbsize: '900',
    format: 'json',
    formatversion: '2',
    origin: '*'
  });

  const respostaBusca = await fetch(`https://en.wikipedia.org/w/api.php?${paramsBusca.toString()}`, { signal });
  if (!respostaBusca.ok) return resultados;

  const dadosBusca = await respostaBusca.json();
  const paginasBusca = dadosBusca?.query?.pages || [];

  paginasBusca.forEach(pagina => {
    const url = pagina?.thumbnail?.source || pagina?.original?.source;
    const titulo = pagina?.title || '';
    if (!url || !fotoCorrespondeAoModelo(titulo, infoModelo) || possuiTermoIndesejado(titulo)) return;
    resultados.push({
      url,
      titulo,
      largura: Number(pagina?.thumbnail?.width || 0),
      altura: Number(pagina?.thumbnail?.height || 0),
      fonte: 'wikipedia',
      pontuacao: pontuarFoto(titulo, infoModelo, cor, 0, 0, 'wikipedia')
    });
  });

  return resultados;
}

function resolverModeloBusca(marcaDigitada, modeloDigitado) {
  const marcaNormalizada = normalizarTexto(marcaDigitada);
  const aliasesMarca = resolverAliasesMarca(marcaDigitada);
  const modeloNormalizado = normalizarTexto(modeloDigitado);
  const modeloCompacto = compactarTexto(modeloDigitado);

  const conhecido = MODELOS_CONHECIDOS.find(item => {
    if (!item.detectar(modeloCompacto)) return false;
    return item.marcas.some(marca => aliasesMarca.includes(normalizarTexto(marca)));
  });

  if (conhecido) {
    return {
      digitado: `${marcaDigitada} ${modeloDigitado}`.trim(),
      canonico: conhecido.canonico,
      aliases: [...new Set([
        conhecido.canonico,
        `${marcaDigitada} ${modeloDigitado}`.trim(),
        ...conhecido.aliases
      ])],
      identidades: conhecido.identidades,
      tokensObrigatorios: (conhecido.tokensObrigatorios || [])
        .map(normalizarTexto)
        .filter(Boolean),
      categorias: conhecido.categorias || [],
      marcas: [...new Set([...aliasesMarca, ...conhecido.marcas.map(normalizarTexto)])],
      tokens: modeloNormalizado
        .split(' ')
        .filter(token => token.length >= 2 && !TERMOS_GENERICOS_MODELO.has(token)),
      conhecido: true
    };
  }

  const tokensModelo = modeloNormalizado.split(' ').filter(token => {
    if (TERMOS_GENERICOS_MODELO.has(token)) return false;
    if (/^(19|20)\d{2}$/.test(token)) return false;
    return token.length >= 2;
  });

  const identidadeCompacta = tokensModelo.join('');
  const identidades = identidadeCompacta ? [identidadeCompacta] : [modeloCompacto];
  const canonico = `${marcaDigitada} ${modeloDigitado}`.replace(/\s+/g, ' ').trim();

  return {
    digitado: canonico,
    canonico,
    aliases: [canonico],
    identidades,
    tokensObrigatorios: tokensModelo.filter(token => !/^(19|20)\d{2}$/.test(token)),
    categorias: [],
    marcas: aliasesMarca.length ? aliasesMarca : [marcaNormalizada],
    tokens: tokensModelo,
    conhecido: false
  };
}

function resolverAliasesMarca(marcaDigitada) {
  const normalizada = normalizarTexto(marcaDigitada);
  const aliases = ALIASES_MARCAS[normalizada] || [normalizada];

  return [...new Set(
    [normalizada, ...aliases]
      .map(normalizarTexto)
      .filter(Boolean)
  )];
}

function fotoCorrespondeAoModelo(titulo, infoModelo) {
  const texto = normalizarTexto(titulo);
  const tokensTitulo = texto.split(' ').filter(Boolean);
  const compacto = compactarTexto(titulo);

  const correspondeMarca = infoModelo.marcas.some(marca => {
    const marcaNormalizada = normalizarTexto(marca);
    if (!marcaNormalizada) return false;

    if (marcaNormalizada.length <= 3) {
      return tokensTitulo.includes(marcaNormalizada);
    }

    return texto.includes(marcaNormalizada) ||
      compacto.includes(compactarTexto(marcaNormalizada));
  });

  if (!correspondeMarca) return false;

  const obrigatorios = (infoModelo.tokensObrigatorios || [])
    .map(normalizarTexto)
    .filter(Boolean);

  // Versões específicas precisam conter todos os termos essenciais.
  if (
    obrigatorios.length > 0 &&
    !obrigatorios.every(token => tokensTitulo.includes(token) || compacto.includes(compactarTexto(token)))
  ) {
    return false;
  }

  const correspondeIdentidade = infoModelo.identidades.some(identidade => {
    const identidadeNormalizada = normalizarTexto(identidade);
    if (!identidadeNormalizada) return false;

    if (identidadeNormalizada.length <= 3) {
      return tokensTitulo.includes(identidadeNormalizada);
    }

    return compacto.includes(compactarTexto(identidadeNormalizada));
  });

  if (correspondeIdentidade || obrigatorios.length > 0) return true;

  const tokens = infoModelo.tokens.filter(token => token.length >= 2);
  if (tokens.length === 0) return false;

  const correspondencias = tokens.filter(token => tokensTitulo.includes(token)).length;
  const minimo = tokens.length === 1 ? 1 : Math.min(2, tokens.length);
  return correspondencias >= minimo;
}

function possuiTermoIndesejado(titulo) {
  const texto = normalizarTexto(titulo);
  return [
    'logo', 'emblem', 'badge', 'interior', 'engine', 'motor', 'diagram',
    'drawing', 'sketch', 'toy', 'miniature', 'police', 'taxi', 'race',
    'wreck', 'crash', 'damaged', 'wrecked', 'accident', 'abandoned',
    'scrapyard', 'junkyard', 'burned', 'rusty', 'dashboard', 'steering wheel',
    'model t', 'vintage', 'classic car', 'oldtimer', 'shirt', 'jersey',
    'football', 'soccer', 'playing card', 'card game', 'construction',
    'building', 'demolition', 'camisa', 'futebol', 'baralho', 'carta', 'obra'
  ].some(termo => texto.includes(termo));
}

function pontuarFoto(titulo, infoModelo, cor, largura, altura, fonte) {
  const texto = normalizarTexto(titulo);
  const tokensTitulo = texto.split(' ').filter(Boolean);
  const compacto = compactarTexto(titulo);
  const corNormalizada = normalizarTexto(cor);
  const corTraduzida = normalizarTexto(CORES_BUSCA[corNormalizada] || cor);
  let pontos = 0;

  infoModelo.identidades.forEach(identidade => {
    const identidadeNormalizada = normalizarTexto(identidade);
    if (!identidadeNormalizada) return;

    const encontrou = identidadeNormalizada.length <= 3
      ? tokensTitulo.includes(identidadeNormalizada)
      : compacto.includes(compactarTexto(identidadeNormalizada));

    if (encontrou) pontos += 35;
  });

  infoModelo.tokens.forEach(token => {
    if (token.length >= 2 && tokensTitulo.includes(token)) pontos += 5;
  });

  infoModelo.marcas.forEach(marca => {
    const marcaNormalizada = normalizarTexto(marca);
    if (!marcaNormalizada) return;

    const encontrou = marcaNormalizada.length <= 3
      ? tokensTitulo.includes(marcaNormalizada)
      : texto.includes(marcaNormalizada) ||
        compacto.includes(compactarTexto(marcaNormalizada));

    if (encontrou) pontos += 18;
  });

  if (corNormalizada && texto.includes(corNormalizada)) pontos += 14;
  if (corTraduzida && texto.includes(corTraduzida)) pontos += 14;
  if (largura > altura) pontos += 3;
  if (fonte === 'wikipedia') pontos += cor ? 2 : 10;

  if (possuiTermoIndesejado(titulo)) pontos -= 50;

  return pontos;
}

function resolverCorCanonica(cor) {
  const normalizada = normalizarTexto(cor);
  if (CORES_CANONICAS[normalizada]) return CORES_CANONICAS[normalizada];

  const entrada = Object.keys(CORES_CANONICAS)
    .sort((a, b) => b.length - a.length)
    .find(alias => normalizada.includes(alias));

  return entrada ? CORES_CANONICAS[entrada] : null;
}

function tituloConfirmaCor(titulo, cor) {
  const canonica = resolverCorCanonica(cor);
  if (!canonica) return false;

  const texto = normalizarTexto(titulo);
  const termos = TERMOS_COR_TITULO[canonica] || [];
  return termos.some(termo => texto.includes(normalizarTexto(termo)));
}

async function filtrarFotosPelaCor(candidatos, cor, signal) {
  const corCanonica = resolverCorCanonica(cor);

  // Cor fora do catálogo: exige que o nome do arquivo confirme exatamente
  // o texto digitado, evitando assumir uma cor que não pode ser validada.
  if (!corCanonica) {
    const corNormalizada = normalizarTexto(cor);
    return candidatos.filter(item => normalizarTexto(item.titulo).includes(corNormalizada));
  }

  const validados = [];
  const tamanhoLote = 4;

  for (let inicio = 0; inicio < candidatos.length; inicio += tamanhoLote) {
    if (signal?.aborted) throw criarErroAbortado();

    const lote = candidatos.slice(inicio, inicio + tamanhoLote);
    const analises = await Promise.all(lote.map(async item => {
      const tituloConfirma = tituloConfirmaCor(item.titulo, cor);

      try {
        const analise = await analisarCorDaImagem(item.url, corCanonica, signal);
        if (!analise.compativel) return null;

        const confianca = Math.max(analise.confianca, tituloConfirma ? 0.90 : 0);
        return {
          ...item,
          cor_confirmada: true,
          confianca_cor: confianca,
          pontuacao: item.pontuacao + Math.round(confianca * 100)
        };
      } catch (erro) {
        if (erro?.name === 'AbortError') throw erro;

        // Se o navegador não conseguir ler os pixels por CORS, só aceita a foto
        // quando a cor estiver explicitamente no título do arquivo.
        if (!tituloConfirma) return null;
        return {
          ...item,
          cor_confirmada: true,
          confianca_cor: 0.85,
          pontuacao: item.pontuacao + 85
        };
      }
    }));

    validados.push(...analises.filter(Boolean));
    if (validados.length >= 12) break;
  }

  return removerFotosDuplicadas(validados);
}

function criarErroAbortado() {
  const erro = new Error('Busca cancelada');
  erro.name = 'AbortError';
  return erro;
}

function carregarImagemParaAnalise(url, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(criarErroAbortado());
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    const limpar = () => signal?.removeEventListener('abort', abortar);
    const abortar = () => {
      limpar();
      img.src = '';
      reject(criarErroAbortado());
    };

    img.onload = () => {
      limpar();
      resolve(img);
    };
    img.onerror = () => {
      limpar();
      reject(new Error('Não foi possível analisar a cor da imagem'));
    };

    signal?.addEventListener('abort', abortar, { once: true });
    img.src = url;
  });
}

async function analisarCorDaImagem(url, corCanonica, signal) {
  const img = await carregarImagemParaAnalise(url, signal);
  if (signal?.aborted) throw criarErroAbortado();

  const largura = 180;
  const altura = 120;
  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas indisponível');

  // Recorta a área central/inferior, onde normalmente está a carroceria,
  // reduzindo a influência de céu, árvores e chão.
  const sx = img.naturalWidth * 0.08;
  const sy = img.naturalHeight * 0.18;
  const sw = img.naturalWidth * 0.84;
  const sh = img.naturalHeight * 0.72;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, largura, altura);

  const pixels = ctx.getImageData(0, 0, largura, altura).data;
  let pesoTotal = 0;
  let pesoCompativel = 0;
  let quantidadeCompativel = 0;

  for (let y = 0; y < altura; y += 2) {
    for (let x = 0; x < largura; x += 2) {
      const i = (y * largura + x) * 4;
      if (pixels[i + 3] < 220) continue;

      const r = pixels[i] / 255;
      const g = pixels[i + 1] / 255;
      const b = pixels[i + 2] / 255;
      const hsv = rgbParaHsv(r, g, b);

      // O núcleo recebe mais peso que as bordas da fotografia.
      const noNucleo = x > largura * 0.18 && x < largura * 0.82 &&
        y > altura * 0.20 && y < altura * 0.88;
      const peso = noNucleo ? 2 : 1;

      pesoTotal += peso;
      if (pixelCompativelComCor(hsv, corCanonica)) {
        pesoCompativel += peso;
        quantidadeCompativel++;
      }
    }
  }

  const proporcao = pesoTotal ? pesoCompativel / pesoTotal : 0;
  const minimo = minimoProporcaoCor(corCanonica);

  return {
    compativel: proporcao >= minimo && quantidadeCompativel >= 24,
    confianca: Math.min(1, proporcao / Math.max(minimo * 2.2, 0.01)),
    proporcao
  };
}

function rgbParaHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * (((b - r) / delta) + 2);
    else h = 60 * (((r - g) / delta) + 4);
  }

  if (h < 0) h += 360;

  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max
  };
}

function hueEntre(h, inicio, fim) {
  if (inicio <= fim) return h >= inicio && h <= fim;
  return h >= inicio || h <= fim;
}

function pixelCompativelComCor({ h, s, v }, cor) {
  switch (cor) {
    case 'branco':
      return s <= 0.22 && v >= 0.72;
    case 'preto':
      return v <= 0.24;
    case 'prata':
      return s <= 0.22 && v >= 0.48 && v < 0.84;
    case 'cinza':
      return s <= 0.24 && v >= 0.28 && v < 0.70;
    case 'chumbo':
      return s <= 0.25 && v >= 0.18 && v < 0.48;
    case 'vermelho':
      // Faixa mais estreita para não confundir marrom, laranja ou vinho com vermelho.
      return hueEntre(h, 350, 9) && s >= 0.48 && v >= 0.34;
    case 'vinho':
      return hueEntre(h, 340, 18) && s >= 0.32 && v >= 0.16 && v < 0.58;
    case 'laranja':
      return hueEntre(h, 15, 38) && s >= 0.42 && v >= 0.38;
    case 'marrom':
      return hueEntre(h, 12, 42) && s >= 0.28 && v >= 0.16 && v < 0.58;
    case 'dourado':
      return hueEntre(h, 35, 58) && s >= 0.28 && v >= 0.42;
    case 'amarelo':
      return hueEntre(h, 42, 72) && s >= 0.42 && v >= 0.52;
    case 'verde':
      return hueEntre(h, 72, 170) && s >= 0.30 && v >= 0.22;
    case 'azul':
      return hueEntre(h, 185, 255) && s >= 0.30 && v >= 0.22;
    case 'azul marinho':
      return hueEntre(h, 195, 245) && s >= 0.28 && v >= 0.12 && v < 0.52;
    case 'roxo':
      return hueEntre(h, 255, 330) && s >= 0.30 && v >= 0.22;
    case 'bege':
      return hueEntre(h, 25, 65) && s >= 0.10 && s <= 0.45 && v >= 0.52;
    default:
      return false;
  }
}

function minimoProporcaoCor(cor) {
  if (['branco', 'preto', 'prata', 'cinza', 'chumbo'].includes(cor)) return 0.16;
  if (['bege', 'dourado'].includes(cor)) return 0.07;
  return 0.045;
}

function removerFotosDuplicadas(resultados) {
  const urls = new Set();
  return resultados.filter(item => {
    if (!item?.url || urls.has(item.url)) return false;
    urls.add(item.url);
    return true;
  });
}

function obterChaveBuscaFoto(
  marca = document.getElementById('v-marca').value,
  modelo = document.getElementById('v-modelo').value,
  cor = document.getElementById('v-cor').value
) {
  return [
    normalizarTexto(marca),
    normalizarTexto(modelo),
    normalizarTexto(cor)
  ].join('|');
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactarTexto(valor) {
  return normalizarTexto(valor).replace(/\s+/g, '');
}

function encontrarProximoIndiceFoto(indiceAtual) {
  if (_fotoResultados.length === 0) return -1;

  for (let passo = 1; passo <= _fotoResultados.length; passo++) {
    const idx = (indiceAtual + passo) % _fotoResultados.length;
    const url = _fotoResultados[idx]?.url;
    if (url && !_fotoUrlsFalharam.has(url)) return idx;
  }

  return -1;
}

function tentarProximaFotoDisponivel() {
  const urlQueFalhou = _fotoResultados[_fotoResultadoIdx]?.url || _fotoAtualUrl;
  if (urlQueFalhou) _fotoUrlsFalharam.add(urlQueFalhou);

  const proximoIdx = encontrarProximoIndiceFoto(_fotoResultadoIdx);
  if (proximoIdx === -1) {
    _fotoAtualUrl = null;
    mostrarPlaceholderFoto('As fotos encontradas não puderam ser carregadas.');
    return;
  }

  _fotoResultadoIdx = proximoIdx;
  mostrarFoto(_fotoResultados[_fotoResultadoIdx].url);
}

function mostrarFoto(url) {
  const img = document.getElementById('foto-img');
  _fotoAtualUrl = url;
  img.src = url;
  img.hidden = false;
  document.getElementById('foto-placeholder').hidden = true;
  document.getElementById('btn-rebuscar-foto').hidden = false;
  mostrarLoading(false);
}

function mostrarPlaceholderFoto(mensagem = 'Preencha marca e modelo para buscar uma foto') {
  const img = document.getElementById('foto-img');
  const placeholder = document.getElementById('foto-placeholder');
  const texto = placeholder.querySelector('p');

  img.removeAttribute('src');
  img.hidden = true;
  placeholder.hidden = false;
  if (texto) texto.textContent = mensagem;
  document.getElementById('btn-rebuscar-foto').hidden = true;
  mostrarLoading(false);
}

function resetarFoto(mensagem = 'Preencha marca e modelo para buscar uma foto') {
  _fotoAtualUrl = null;
  _fotoBuscaChave = '';
  _fotoResultados = [];
  _fotoResultadoIdx = -1;
  _fotoUrlsFalharam = new Set();
  mostrarPlaceholderFoto(mensagem);
}

function mostrarLoading(ativo) {
  document.getElementById('foto-loading').hidden = !ativo;
  if (ativo) document.getElementById('foto-img').hidden = true;
}


// ─── CONTA ────────────────────────────────────────────────────────────────────
function preencherConta() {
  document.getElementById('conta-email').textContent = _perfil?.email || auth.currentUser?.email || '—';
  document.getElementById('conta-plano').textContent = formatarPlano(_perfil?.plano);
  document.getElementById('conta-desde').textContent = _perfil?.criado_em
    ? formatData(_perfil.criado_em.toDate?.()?.toISOString?.().slice(0, 10) || _perfil.criado_em)
    : '—';
  const isEmailProvider = auth.currentUser?.providerData?.some(p => p.providerId === 'password');
  document.getElementById('btn-alterar-senha').hidden = !isEmailProvider;
}

function configurarConta() {
  document.getElementById('btn-alterar-senha').addEventListener('click', async () => {
    const email = auth.currentUser?.email;
    if (!email) return;
    try {
      await sendPasswordResetEmail(auth, email);
      toast('E-mail de redefinição enviado!', 'sucesso');
    } catch (e) { toast('Erro ao enviar e-mail', 'erro'); }
  });

  document.getElementById('btn-logout').addEventListener('click', () => {
    document.getElementById('modal-logout').hidden = false;
  });
  document.getElementById('modal-logout-fechar').addEventListener('click', () => { document.getElementById('modal-logout').hidden = true; });
  document.getElementById('btn-logout-cancelar').addEventListener('click', () => { document.getElementById('modal-logout').hidden = true; });
  document.getElementById('btn-logout-confirmar').addEventListener('click', async () => { await logout(); });
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function iniciarDeNome(nome) {
  if (!nome) return '?';
  const p = nome.trim().split(' ').filter(Boolean);
  if (p.length === 1) return p[0][0].toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function formatarPlano(plano) {
  return { trial: 'Período de teste', basico: 'Básico', pro: 'Pro', completo: 'Completo' }[plano] || plano || '—';
}

function btnLoading(btn, loading) {
  btn.disabled = loading;
  const txt = btn.querySelector('.btn-text');
  const spin = btn.querySelector('.btn-spinner');
  if (txt) txt.hidden = loading;
  if (spin) spin.hidden = !loading;
}
