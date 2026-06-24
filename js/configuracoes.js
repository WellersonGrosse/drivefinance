/**
 * configuracoes.js — DriveFinance
 * Perfil pessoal, perfil profissional, veículos, conta.
 */

import {
  exigirLogin,
  getPerfil, updatePerfil,
  getConfig, saveConfig,
  getVeiculos, addVeiculo, updateVeiculo, deleteVeiculo,
  logout,
  formatData, toast,
  isAdmin
} from './app.js';

import { auth } from './firebase-config.js';
import { sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ─── Estado global ────────────────────────────────────────────────────────────
let _uid = null;
let _perfil = null;
let _config = null;
let _veiculos = [];         // array de { id, ...dados }
let _carrosselIdx = 0;      // índice do card central
let _editandoVeiculoId = null;  // null = novo, string = editar
let _fotoAtualUrl = null;   // URL da foto do veículo no modal

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const user = await exigirLogin();
  _uid = user.uid;

  await Promise.all([
    carregarPerfil(),
    carregarConfig(),
    carregarVeiculos()
  ]);

  preencherSidebar();
  configurarTabs();
  configurarSidebar();
  configurarPessoal();
  configurarProfissional();
  configurarVeiculos();
  configurarConta();
});

// ─── Carregamento de dados ────────────────────────────────────────────────────
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
  // getVeiculos pode retornar array ou objeto — normalizamos
  if (Array.isArray(lista)) {
    _veiculos = lista;
  } else {
    _veiculos = Object.entries(lista || {}).map(([id, dados]) => ({ id, ...dados }));
  }
  renderCarrossel();
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function preencherSidebar() {
  const iniciais = iniciarDeNome(_perfil?.nome || '');
  const plano = _perfil?.plano || '—';

  document.getElementById('sidebar-avatar').textContent = iniciais;
  document.getElementById('sidebar-nome').textContent = _perfil?.nome || 'Usuário';
  document.getElementById('sidebar-plano').textContent = plano;
  document.getElementById('topbar-avatar').textContent = iniciais;
}

function configurarSidebar() {
  const btnMenu = document.getElementById('btn-menu');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  btnMenu?.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('visible');
  });

  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  });
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function configurarTabs() {
  const tabs = document.querySelectorAll('.cfg-tab');
  const sections = document.querySelectorAll('.cfg-section');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const alvo = tab.dataset.tab;

      tabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      sections.forEach(s => { s.classList.remove('active'); s.hidden = true; });

      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      const secao = document.getElementById(`tab-${alvo}`);
      secao.classList.add('active');
      secao.hidden = false;
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
  // Atualiza avatar ao digitar nome
  document.getElementById('input-nome').addEventListener('input', e => {
    const iniciais = iniciarDeNome(e.target.value);
    document.getElementById('avatar-display').textContent = iniciais;
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
  if (!_config) return;

  // Dias de trabalho
  const diasAtivos = _config.dias_trabalho || [];
  document.querySelectorAll('.dia-toggle').forEach(btn => {
    const dia = parseInt(btn.dataset.dia);
    const ativo = diasAtivos.includes(dia);
    btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  });

  // Plataformas
  renderPlataformas();

  // Toggles de meta
  document.getElementById('toggle-superavit').checked = !!_config.superavit;
  document.getElementById('toggle-deficit').checked = !!_config.deficit;
}

function configurarProfissional() {
  // Dias
  document.querySelectorAll('.dia-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const atual = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', !atual ? 'true' : 'false');
    });
  });

  // Plataforma — add
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

function renderPlataformas() {
  const lista = document.getElementById('plataformas-lista');
  const plataformas = _config?.plataformas || [];

  // Garante que as 3 padrão existam (sem duplicar)
  const PADROES = ['Uber', '99', 'InDrive'];
  const icones = { 'Uber': '🚗', '99': '🟡', 'InDrive': '🚙' };

  const todas = [...PADROES, ...plataformas.filter(p => !PADROES.includes(p.nome || p))
    .map(p => typeof p === 'string' ? p : p.nome)];

  const ativas = new Set(
    plataformas
      .filter(p => p.ativa !== false)
      .map(p => typeof p === 'string' ? p : p.nome)
  );

  lista.innerHTML = '';
  todas.forEach(nome => {
    const row = document.createElement('div');
    row.className = `plataforma-row${ativas.has(nome) ? ' ativa' : ''}`;
    row.dataset.nome = nome;

    const icone = icones[nome] || '🔷';
    const isPadrao = PADROES.includes(nome);

    row.innerHTML = `
      <div class="plataforma-nome">
        <div class="plataforma-icone">${icone}</div>
        <span>${nome}</span>
      </div>
      <div class="plataforma-acoes">
        ${!isPadrao ? `<button class="plataforma-remover" title="Remover plataforma" data-plat="${nome}">✕</button>` : ''}
        <label class="switch">
          <input type="checkbox" class="plat-toggle" data-nome="${nome}" ${ativas.has(nome) ? 'checked' : ''} />
          <span class="switch-track"></span>
        </label>
      </div>
    `;

    lista.appendChild(row);
  });

  // Eventos de toggle por linha
  lista.querySelectorAll('.plat-toggle').forEach(chk => {
    chk.addEventListener('change', () => {
      const row = chk.closest('.plataforma-row');
      row.classList.toggle('ativa', chk.checked);
    });
  });

  // Eventos de remover plataforma customizada
  lista.querySelectorAll('.plataforma-remover').forEach(btn => {
    btn.addEventListener('click', () => {
      const nome = btn.dataset.plat;
      // Remove do _config em memória e re-renderiza
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

  const existentes = Array.from(document.querySelectorAll('.plataforma-row'))
    .map(r => r.dataset.nome.toLowerCase());
  if (existentes.includes(nome.toLowerCase())) {
    toast('Essa plataforma já existe', 'aviso');
    return;
  }

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
    // Dias
    const diasSelecionados = [];
    document.querySelectorAll('.dia-toggle').forEach(b => {
      if (b.getAttribute('aria-pressed') === 'true') {
        diasSelecionados.push(parseInt(b.dataset.dia));
      }
    });

    // Plataformas — coletamos o estado dos toggles no DOM
    const plataformasFinais = [];
    document.querySelectorAll('.plataforma-row').forEach(row => {
      const nome = row.dataset.nome;
      const ativa = row.querySelector('.plat-toggle')?.checked ?? false;
      plataformasFinais.push({ nome, ativa });
    });

    const dados = {
      dias_trabalho: diasSelecionados,
      plataformas: plataformasFinais,
      superavit: document.getElementById('toggle-superavit').checked,
      deficit: document.getElementById('toggle-deficit').checked
    };

    await saveConfig(_uid, dados);
    _config = { ..._config, ...dados };
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
    document.getElementById('modal-remover-texto').textContent =
      `"${v.modelo || 'Este veículo'}" será removido permanentemente.`;
    document.getElementById('modal-remover-veiculo').hidden = false;
  });

  // Modal remover
  document.getElementById('modal-remover-fechar').addEventListener('click', () => {
    document.getElementById('modal-remover-veiculo').hidden = true;
  });
  document.getElementById('btn-remover-cancelar').addEventListener('click', () => {
    document.getElementById('modal-remover-veiculo').hidden = true;
  });
  document.getElementById('btn-remover-confirmar').addEventListener('click', confirmarRemocao);

  // Modal veículo
  document.getElementById('modal-veiculo-fechar').addEventListener('click', fecharModalVeiculo);
  document.getElementById('btn-modal-cancelar').addEventListener('click', fecharModalVeiculo);
  document.getElementById('btn-modal-salvar').addEventListener('click', salvarVeiculo);
  document.getElementById('btn-rebuscar-foto').addEventListener('click', () => buscarFotoVeiculo(true));

  // Busca foto ao sair do campo modelo ou cor
  ['v-modelo', 'v-cor'].forEach(id => {
    document.getElementById(id).addEventListener('blur', () => {
      const modelo = document.getElementById('v-modelo').value.trim();
      if (modelo) buscarFotoVeiculo(false);
    });
  });

  // Swipe no carrossel (touch)
  const track = document.getElementById('carrossel-track');
  let touchStartX = 0;
  track.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend', e => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) moverCarrossel(diff > 0 ? 1 : -1);
  });

  // Clicar nos cards laterais navega
  track.addEventListener('click', e => {
    const card = e.target.closest('.veiculo-card');
    if (!card) return;
    const idx = parseInt(card.dataset.idx);
    if (!isNaN(idx) && idx !== _carrosselIdx) {
      _carrosselIdx = idx;
      renderCarrossel();
    }
  });
}

function renderCarrossel() {
  const wrapper = document.getElementById('carrossel-wrapper');
  const empty = document.getElementById('veiculos-empty');
  const acoes = document.getElementById('veiculo-acoes');
  const track = document.getElementById('carrossel-track');
  const dots = document.getElementById('carrossel-dots');

  if (_veiculos.length === 0) {
    wrapper.hidden = true;
    empty.hidden = false;
    acoes.hidden = true;
    return;
  }

  empty.hidden = true;
  wrapper.hidden = false;
  acoes.hidden = false;

  // Garante índice válido
  if (_carrosselIdx >= _veiculos.length) _carrosselIdx = _veiculos.length - 1;
  if (_carrosselIdx < 0) _carrosselIdx = 0;

  // Setas
  document.getElementById('arrow-left').disabled = _veiculos.length <= 1;
  document.getElementById('arrow-right').disabled = _veiculos.length <= 1;

  // Render cards
  track.innerHTML = '';
  _veiculos.forEach((v, idx) => {
    const card = criarCardVeiculo(v, idx);
    track.appendChild(card);
  });

  // Posiciona os cards
  posicionarCards();

  // Dots
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
    ? `<img class="veiculo-card-foto" src="${v.foto_url}" alt="${v.modelo}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="veiculo-card-foto-placeholder" style="display:none">🚗</div>`
    : `<div class="veiculo-card-foto-placeholder">🚗</div>`;

  const padrao = v.default ? '<span class="veiculo-tag padrao">⭐ Padrão</span>' : '';
  const combustivel = v.combustivel ? `<span class="veiculo-tag">${v.combustivel}</span>` : '';
  const cor = v.cor ? `<span class="veiculo-tag">${v.cor}</span>` : '';

  card.innerHTML = `
    ${fotoHtml}
    <div class="veiculo-card-body">
      <p class="veiculo-card-modelo">${v.modelo || 'Veículo'} ${v.placa ? '· ' + v.placa : ''}</p>
      <div class="veiculo-card-detalhes">
        ${padrao}${cor}${combustivel}
      </div>
    </div>
  `;

  return card;
}

function posicionarCards() {
  const cards = document.querySelectorAll('.veiculo-card');
  const total = _veiculos.length;

  cards.forEach((card, idx) => {
    // Remove todas as classes de posição
    card.classList.remove('pos-center', 'pos-left', 'pos-right', 'pos-hidden-left', 'pos-hidden-right');

    const diff = idx - _carrosselIdx;

    if (diff === 0) card.classList.add('pos-center');
    else if (diff === 1) card.classList.add('pos-right');
    else if (diff === -1) card.classList.add('pos-left');
    else if (diff > 1) card.classList.add('pos-hidden-right');
    else card.classList.add('pos-hidden-left');
  });
}

function moverCarrossel(direcao) {
  const total = _veiculos.length;
  if (total <= 1) return;
  _carrosselIdx = (_carrosselIdx + direcao + total) % total;
  posicionarCards();

  // Atualiza dots
  document.querySelectorAll('.carrossel-dot').forEach((dot, i) => {
    dot.classList.toggle('ativo', i === _carrosselIdx);
  });
}

// ─── Modal Veículo ────────────────────────────────────────────────────────────
function abrirModalVeiculo(veiculo) {
  _editandoVeiculoId = veiculo ? veiculo.id : null;
  _fotoAtualUrl = veiculo?.foto_url || null;

  const modal = document.getElementById('modal-veiculo');
  document.getElementById('modal-veiculo-titulo').textContent = veiculo ? 'Editar veículo' : 'Novo veículo';

  // Preenche campos
  document.getElementById('v-modelo').value = veiculo?.modelo || '';
  document.getElementById('v-placa').value = veiculo?.placa || '';
  document.getElementById('v-cor').value = veiculo?.cor || '';
  document.getElementById('v-combustivel').value = veiculo?.combustivel || '';
  document.getElementById('v-consumo').value = veiculo?.consumo_medio || '';
  document.getElementById('v-padrao').checked = !!veiculo?.default;

  // Foto
  if (veiculo?.foto_url) {
    mostrarFoto(veiculo.foto_url);
  } else {
    resetarFoto();
  }

  modal.hidden = false;
}

function fecharModalVeiculo() {
  document.getElementById('modal-veiculo').hidden = true;
  _editandoVeiculoId = null;
  _fotoAtualUrl = null;
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

    // Se for padrão, remove default dos outros
    if (dados.default) {
      for (const v of _veiculos) {
        if (v.id !== _editandoVeiculoId && v.default) {
          await updateVeiculo(_uid, v.id, { default: false });
        }
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

// ─── Busca de foto (Unsplash → Pexels fallback) ───────────────────────────────
// Chave pública Unsplash (demo key — limite 50 req/hora, suficiente para uso real pequeno)
// Para produção, trocar por chave própria registrada em unsplash.com/developers
const UNSPLASH_KEY = 'vF_dA6-r0G3wr5cNUBV2F0amHsYf74HxHQJqL08q4EI';
const PEXELS_KEY   = 'S7MHGiiHbG9hE9ynKkVHEF4GDZRDijWCKRRMTk3U0Nh3AZGG8cBMwwxm';

async function buscarFotoVeiculo(forcar = false) {
  const modelo = document.getElementById('v-modelo').value.trim();
  const cor = document.getElementById('v-cor').value.trim();

  if (!modelo) return;
  if (!forcar && _fotoAtualUrl) return; // já tem foto e não forçou rebusca

  const query = cor ? `${modelo} ${cor} car` : `${modelo} car`;

  mostrarLoading(true);

  // Tenta Unsplash
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape&client_id=${UNSPLASH_KEY}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        // Pega uma foto aleatória entre os primeiros resultados para variar no rebuscar
        const pick = forcar
          ? data.results[Math.floor(Math.random() * data.results.length)]
          : data.results[0];
        const fotoUrl = pick.urls.regular;
        _fotoAtualUrl = fotoUrl;
        mostrarFoto(fotoUrl);
        mostrarLoading(false);
        return;
      }
    }
  } catch (e) {
    console.warn('Unsplash falhou, tentando Pexels...', e);
  }

  // Fallback: Pexels
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`;
    const res = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
    if (res.ok) {
      const data = await res.json();
      if (data.photos && data.photos.length > 0) {
        const pick = forcar
          ? data.photos[Math.floor(Math.random() * data.photos.length)]
          : data.photos[0];
        const fotoUrl = pick.src.large;
        _fotoAtualUrl = fotoUrl;
        mostrarFoto(fotoUrl);
        mostrarLoading(false);
        return;
      }
    }
  } catch (e) {
    console.warn('Pexels também falhou', e);
  }

  mostrarLoading(false);
  // Não encontrou — mantém placeholder, sem mensagem de erro (silencioso)
}

function mostrarFoto(url) {
  const img = document.getElementById('foto-img');
  const placeholder = document.getElementById('foto-placeholder');
  const rebuscar = document.getElementById('btn-rebuscar-foto');

  img.src = url;
  img.hidden = false;
  placeholder.hidden = true;
  rebuscar.hidden = false;
  mostrarLoading(false);
}

function resetarFoto() {
  const img = document.getElementById('foto-img');
  const placeholder = document.getElementById('foto-placeholder');
  const rebuscar = document.getElementById('btn-rebuscar-foto');

  img.src = '';
  img.hidden = true;
  placeholder.hidden = false;
  rebuscar.hidden = true;
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

  // Mostrar botão de alterar senha só para email/password
  const user = auth.currentUser;
  if (user) {
    const isEmailProvider = user.providerData.some(p => p.providerId === 'password');
    document.getElementById('btn-alterar-senha').hidden = !isEmailProvider;
  }
}

function configurarConta() {
  // Alterar senha
  document.getElementById('btn-alterar-senha').addEventListener('click', async () => {
    const email = auth.currentUser?.email;
    if (!email) return;
    try {
      await sendPasswordResetEmail(auth, email);
      toast('E-mail de redefinição enviado!', 'sucesso');
    } catch (e) {
      console.error(e);
      toast('Erro ao enviar e-mail', 'erro');
    }
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    document.getElementById('modal-logout').hidden = false;
  });
  document.getElementById('modal-logout-fechar').addEventListener('click', () => {
    document.getElementById('modal-logout').hidden = true;
  });
  document.getElementById('btn-logout-cancelar').addEventListener('click', () => {
    document.getElementById('modal-logout').hidden = true;
  });
  document.getElementById('btn-logout-confirmar').addEventListener('click', async () => {
    await logout();
    // logout() em app.js já redireciona para login
  });

  // Fechar modais clicando no overlay
  ['modal-logout', 'modal-remover-veiculo', 'modal-veiculo'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target.id === id) {
        document.getElementById(id).hidden = true;
        if (id === 'modal-veiculo') fecharModalVeiculo();
      }
    });
  });
}

// ─── Utilidades ───────────────────────────────────────────────────────────────
function iniciarDeNome(nome) {
  if (!nome) return '?';
  const partes = nome.trim().split(' ').filter(Boolean);
  if (partes.length === 1) return partes[0][0].toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function formatarPlano(plano) {
  const nomes = { trial: 'Período de teste', basico: 'Básico', pro: 'Pro', completo: 'Completo' };
  return nomes[plano] || plano || '—';
}

function btnLoading(btn, loading) {
  const txt = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  btn.disabled = loading;
  if (txt) txt.hidden = loading;
  if (spinner) spinner.hidden = !loading;
}
