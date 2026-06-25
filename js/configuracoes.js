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

  [inputMarca, inputModelo].forEach(input => {
    input.addEventListener('input', () => {
      invalidarFotoSeBuscaMudou();
      agendarBuscaFoto(700);
    });
  });

  inputCor.addEventListener('input', () => {
    invalidarFotoSeBuscaMudou();
    agendarBuscaFoto(550);
  });

  [inputMarca, inputModelo, inputCor].forEach(input => {
    input.addEventListener('blur', () => {
      if (inputMarca.value.trim() && inputModelo.value.trim()) {
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

/*
 * Alguns nomes de veículos são ambíguos para mecanismos de busca.
 * Exemplo: "T-Cross" pode ser interpretado como "Model T" + "cross".
 * Este catálogo pequeno resolve os modelos mais comuns no Brasil sem limitar
 * a busca de veículos que não estejam na lista.
 */
const MODELOS_CONHECIDOS = [
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

function agendarBuscaFoto(atraso = 650) {
  clearTimeout(_fotoBuscaTimer);

  const marca = document.getElementById('v-marca').value.trim();
  const modelo = document.getElementById('v-modelo').value.trim();
  if (!marca || !modelo) {
    cancelarBuscaFotoAtiva();
    resetarFoto();
    return;
  }

  _fotoBuscaTimer = setTimeout(() => {
    buscarFotoVeiculo(false);
  }, atraso);
}

function invalidarFotoSeBuscaMudou() {
  const marca = document.getElementById('v-marca').value.trim();
  const modelo = document.getElementById('v-modelo').value.trim();
  const novaChave = obterChaveBuscaFoto();

  if (!marca || !modelo) {
    cancelarBuscaFotoAtiva();
    resetarFoto();
    return;
  }

  if (novaChave === _fotoBuscaChave) return;

  if (_fotoAbortController) {
    _fotoAbortController.abort();
    _fotoAbortController = null;
  }

  _fotoBuscaSequencia++;
  _fotoAtualUrl = null;
  _fotoResultados = [];
  _fotoResultadoIdx = -1;
  _fotoUrlsFalharam = new Set();
  mostrarLoading(false);
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

  const marca = document.getElementById('v-marca').value.trim();
  const modelo = document.getElementById('v-modelo').value.trim();
  const cor = document.getElementById('v-cor').value.trim();
  if (!marca || !modelo) {
    resetarFoto();
    return;
  }

  const chave = obterChaveBuscaFoto(marca, modelo, cor);

  // No botão “Buscar outra foto”, percorre os resultados já encontrados primeiro.
  if (forcar && chave === _fotoBuscaChave && _fotoResultados.length > 1) {
    const proximoIdx = encontrarProximoIndiceFoto(_fotoResultadoIdx);
    if (proximoIdx !== -1) {
      _fotoResultadoIdx = proximoIdx;
      mostrarFoto(_fotoResultados[_fotoResultadoIdx].url);
      return;
    }
  }

  // Evita repetir a mesma busca ao sair do campo sem alterar modelo ou cor.
  if (!forcar && chave === _fotoBuscaChave && _fotoAtualUrl) return;

  if (_fotoAbortController) _fotoAbortController.abort();
  _fotoAbortController = new AbortController();
  const signal = _fotoAbortController.signal;
  const sequencia = ++_fotoBuscaSequencia;

  mostrarLoading(true);

  try {
    const resultados = await coletarFotosVeiculo(marca, modelo, cor, signal);
    if (sequencia !== _fotoBuscaSequencia) return;

    _fotoBuscaChave = chave;
    _fotoResultados = removerFotosDuplicadas(resultados);
    _fotoResultadoIdx = -1;
    _fotoUrlsFalharam = new Set();

    if (_fotoResultados.length === 0) {
      _fotoAtualUrl = null;
      mostrarPlaceholderFoto('Nenhuma foto confiável encontrada. Tente informar marca e modelo.');
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

  // Com cor informada, prioriza fotos do Commons cujo título também indique a cor.
  if (cor) {
    const consultasComCor = montarConsultasCommons(infoModelo, corTraduzida, true);
    for (const consulta of consultasComCor) {
      const encontrados = await buscarFotosCommons(consulta, infoModelo, cor, signal);
      resultados.push(...encontrados);
      if (removerFotosDuplicadas(resultados).length >= 12) break;
    }
  }

  // Busca exata do modelo no Commons. O filtro posterior exige que o título
  // realmente contenha a identidade do modelo, evitando resultados como Model T.
  const consultasModelo = montarConsultasCommons(infoModelo, '', false);
  for (const consulta of consultasModelo) {
    const encontrados = await buscarFotosCommons(consulta, infoModelo, cor, signal);
    resultados.push(...encontrados);
    if (removerFotosDuplicadas(resultados).length >= 16) break;
  }

  // A imagem principal do artigo da Wikipedia funciona como fallback confiável
  // para o modelo, mesmo quando o Commons não possui uma foto com a cor desejada.
  const wikipedia = await buscarFotosWikipedia(infoModelo, cor, signal);
  resultados.push(...wikipedia);

  return removerFotosDuplicadas(resultados)
    .filter(item => fotoCorrespondeAoModelo(item.titulo, infoModelo))
    .sort((a, b) => b.pontuacao - a.pontuacao);
}

function montarConsultasCommons(infoModelo, corTraduzida = '', incluirCor = false) {
  const consultas = [];
  const cor = incluirCor && corTraduzida ? ` ${corTraduzida}` : '';

  infoModelo.aliases.forEach(alias => {
    consultas.push(`"${alias}"${cor} automobile`);
    consultas.push(`"${alias}"${cor} car`);
  });

  // Categorias do Commons costumam usar o nome canônico do veículo.
  consultas.push(`incategory:"${infoModelo.canonico}"${cor}`);

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

  const correspondeIdentidade = infoModelo.identidades.some(identidade => {
    const identidadeNormalizada = normalizarTexto(identidade);
    if (!identidadeNormalizada) return false;

    if (identidadeNormalizada.length <= 3) {
      return tokensTitulo.includes(identidadeNormalizada);
    }

    return compacto.includes(compactarTexto(identidadeNormalizada));
  });

  if (correspondeIdentidade) return true;

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

function resetarFoto() {
  _fotoAtualUrl = null;
  _fotoBuscaChave = '';
  _fotoResultados = [];
  _fotoResultadoIdx = -1;
  _fotoUrlsFalharam = new Set();
  mostrarPlaceholderFoto('Preencha marca e modelo para buscar uma foto');
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
