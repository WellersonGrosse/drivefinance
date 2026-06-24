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
    document.getElementById('modal-remover-texto').textContent = `"${v.modelo || 'Este veículo'}" será removido permanentemente.`;
    document.getElementById('modal-remover-veiculo').hidden = false;
  });

  document.getElementById('modal-remover-fechar').addEventListener('click', () => { document.getElementById('modal-remover-veiculo').hidden = true; });
  document.getElementById('btn-remover-cancelar').addEventListener('click', () => { document.getElementById('modal-remover-veiculo').hidden = true; });
  document.getElementById('btn-remover-confirmar').addEventListener('click', confirmarRemocao);

  document.getElementById('modal-veiculo-fechar').addEventListener('click', fecharModalVeiculo);
  document.getElementById('btn-modal-cancelar').addEventListener('click', fecharModalVeiculo);
  document.getElementById('btn-modal-salvar').addEventListener('click', salvarVeiculo);
  document.getElementById('btn-rebuscar-foto').addEventListener('click', () => buscarFotoVeiculo(true));

  ['v-modelo', 'v-cor'].forEach(id => {
    document.getElementById(id).addEventListener('blur', () => {
      if (document.getElementById('v-modelo').value.trim()) buscarFotoVeiculo(false);
    });
  });

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
  const fotoHtml = v.foto_url
    ? `<img class="veiculo-card-foto" src="${v.foto_url}" alt="${v.modelo}" onerror="this.style.display='none'" />`
    : `<div class="veiculo-card-foto-placeholder">🚗</div>`;
  card.innerHTML = `
    ${fotoHtml}
    <div class="veiculo-card-body">
      <p class="veiculo-card-modelo">${v.modelo || 'Veículo'}${v.placa ? ' · ' + v.placa : ''}</p>
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
  _editandoVeiculoId = v ? v.id : null;
  _fotoAtualUrl = v?.foto_url || null;
  document.getElementById('modal-veiculo-titulo').textContent = v ? 'Editar veículo' : 'Novo veículo';
  document.getElementById('v-modelo').value = v?.modelo || '';
  document.getElementById('v-placa').value = v?.placa || '';
  document.getElementById('v-cor').value = v?.cor || '';
  document.getElementById('v-combustivel').value = v?.combustivel || '';
  document.getElementById('v-consumo').value = v?.consumo_medio || '';
  document.getElementById('v-padrao').checked = !!v?.default;
  if (v?.foto_url) mostrarFoto(v.foto_url);
  else resetarFoto();
  document.getElementById('modal-veiculo').hidden = false;
}

function fecharModalVeiculo() {
  document.getElementById('modal-veiculo').hidden = true;
  _editandoVeiculoId = null; _fotoAtualUrl = null;
}

async function salvarVeiculo() {
  const btn = document.getElementById('btn-modal-salvar');
  const modelo = document.getElementById('v-modelo').value.trim();
  if (!modelo) { toast('Informe o modelo do veículo', 'aviso'); return; }
  btnLoading(btn, true);
  try {
    const dados = {
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

// ─── Foto via Wikipedia API (sem chave, sem CORS) ─────────────────────────────
async function buscarFotoVeiculo(forcar = false) {
  const modelo = document.getElementById('v-modelo').value.trim();
  const cor = document.getElementById('v-cor').value.trim();
  if (!modelo) return;
  if (!forcar && _fotoAtualUrl) return;

  mostrarLoading(true);

  // Termos de busca: tenta com cor, fallback sem cor
  const termos = cor
    ? [`${modelo} ${cor}`, modelo]
    : [modelo];

  for (const termo of termos) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(termo)}&prop=pageimages&format=json&pithumbsize=800&origin=*`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      const pages = data?.query?.pages || {};
      const page = Object.values(pages)[0];
      if (page?.thumbnail?.source) {
        _fotoAtualUrl = page.thumbnail.source;
        mostrarFoto(_fotoAtualUrl);
        return;
      }
    } catch (e) { /* continua */ }
  }

  // Segunda tentativa: busca por imagem na Wikipedia com search
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(modelo + ' car automobile')}&srlimit=3&format=json&origin=*`;
    const res = await fetch(searchUrl);
    const data = await res.json();
    const results = data?.query?.search || [];

    for (const result of results) {
      const imgUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(result.title)}&prop=pageimages&format=json&pithumbsize=800&origin=*`;
      const imgRes = await fetch(imgUrl);
      const imgData = await imgRes.json();
      const pages = imgData?.query?.pages || {};
      const page = Object.values(pages)[0];
      if (page?.thumbnail?.source) {
        _fotoAtualUrl = page.thumbnail.source;
        mostrarFoto(_fotoAtualUrl);
        return;
      }
    }
  } catch (e) { /* silencioso */ }

  mostrarLoading(false);
  // não encontrou — sem mensagem de erro, fica no placeholder
}

function mostrarFoto(url) {
  document.getElementById('foto-img').src = url;
  document.getElementById('foto-img').hidden = false;
  document.getElementById('foto-placeholder').hidden = true;
  document.getElementById('btn-rebuscar-foto').hidden = false;
  mostrarLoading(false);
}

function resetarFoto() {
  document.getElementById('foto-img').src = '';
  document.getElementById('foto-img').hidden = true;
  document.getElementById('foto-placeholder').hidden = false;
  document.getElementById('btn-rebuscar-foto').hidden = true;
  mostrarLoading(false);
  _fotoAtualUrl = null;
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
