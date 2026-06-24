// ─────────────────────────────────────────────
// DriveFinance — admin.js
// Painel administrativo exclusivo
// ─────────────────────────────────────────────

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  updateDoc,
  setDoc,
  addDoc,
  serverTimestamp,
  Timestamp,
  orderBy,
  query,
  limit
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────

const TODOS_MODULOS = [
  'home',
  'lancamentos',
  'despesas',
  'historico',
  'dashboard',
  'custo_operacional',
  'relatorios'
];

const MODULOS_LABELS = {
  home:              'Home',
  lancamentos:       'Lançamentos',
  despesas:          'Despesas',
  historico:         'Histórico',
  dashboard:         'Dashboard',
  custo_operacional: 'Custo Operacional',
  relatorios:        'Relatórios'
};

const FEATURES_PADRAO = {
  basico: [
    { ok: true,  text: 'Meta diária automática' },
    { ok: true,  text: 'Registro de corridas (app + particular)' },
    { ok: true,  text: 'Controle de despesas e parcelas' },
    { ok: true,  text: 'Histórico com calendário' },
    { ok: false, text: 'Dashboard financeiro (DRE)' },
    { ok: false, text: 'Custo operacional do veículo' },
    { ok: false, text: 'Relatórios exportáveis' },
  ],
  pro: [
    { ok: true,  text: 'Tudo do Básico' },
    { ok: true,  text: 'Dashboard financeiro completo (DRE)' },
    { ok: true,  text: 'Custo operacional por km' },
    { ok: true,  text: 'KM ocioso com custo separado' },
    { ok: true,  text: 'Múltiplos veículos' },
    { ok: false, text: 'Relatórios exportáveis' },
    { ok: false, text: 'Suporte prioritário WhatsApp' },
  ],
  completo: [
    { ok: true,  text: 'Tudo do Pro' },
    { ok: true,  text: 'Relatórios exportáveis (PDF/Excel)' },
    { ok: true,  text: 'Suporte prioritário WhatsApp' },
    { ok: true,  text: 'Histórico ilimitado' },
    { ok: true,  text: 'Acesso antecipado a novidades' },
  ]
};

const POR_PAGINA = 15;

// ─────────────────────────────────────────────
// ESTADO
// ─────────────────────────────────────────────

const state = {
  adminUid:       null,
  usuarios:       [],       // lista completa carregada
  usuariosFiltrados: [],    // após busca/filtro
  paginaAtual:    1,
  usuarioAberto:  null,     // perfil no modal
  planos:         {},       // config_global/planos
  nomesPorId:     {}        // { basico: 'Básico', pro: 'Pro', ... }
};

// ─────────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────────

const $ = id => document.getElementById(id);

function iniciais(nome = '', email = '') {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return `${partes[0][0]}${partes.at(-1)[0]}`.toUpperCase();
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase() || 'DF';
}

function formatReal(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
}

function formatData(ts) {
  if (!ts) return '—';
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts.seconds * 1000);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDataHora(ts) {
  if (!ts) return '—';
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts.seconds * 1000);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return null;
}

function situacaoUsuario(u) {
  if (u.role === 'admin') return { label: 'Admin', classe: 'badge-admin' };

  if (u.plano === 'trial') {
    const inicio = toDate(u.trial_inicio || u.criado_em);
    if (!inicio) return { label: 'Trial', classe: 'badge-trial' };
    const fim = new Date(inicio);
    fim.setDate(fim.getDate() + 15);
    if (new Date() < fim) {
      const dias = Math.ceil((fim - new Date()) / 86400000);
      return { label: `Trial (${dias}d)`, classe: 'badge-trial' };
    }
    return { label: 'Expirado', classe: 'badge-expirado' };
  }

  if (['basico', 'pro', 'completo'].includes(u.plano)) {
    const expira = toDate(u.plano_expira_em);
    if (expira && new Date() < expira) {
      return { label: state.nomesPorId[u.plano] || u.plano, classe: `badge-${u.plano}` };
    }
    return { label: 'Expirado', classe: 'badge-expirado' };
  }

  return { label: u.plano || '—', classe: 'badge-expirado' };
}

function toast(msg, tipo = 'info') {
  const el = $('admin-toast');
  el.textContent = msg;
  el.className = `admin-toast show ${tipo}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

// ─────────────────────────────────────────────
// AUTENTICAÇÃO — só admin entra
// ─────────────────────────────────────────────

onAuthStateChanged(auth, async user => {
  if (!user) { window.location.replace('login.html'); return; }

  const snap = await getDoc(doc(db, 'users', user.uid));
  if (!snap.exists() || snap.data().role !== 'admin') {
    window.location.replace('home.html');
    return;
  }

  state.adminUid = user.uid;
  await Promise.all([carregarPlanos(), carregarUsuarios()]);
  iniciarApp();
});

function iniciarApp() {
  $('loading-screen').hidden = true;
  $('admin-app').hidden = false;
  bindEvents();
  navegarSecao('visao-geral');
}

// ─────────────────────────────────────────────
// NAVEGAÇÃO
// ─────────────────────────────────────────────

function navegarSecao(id) {
  document.querySelectorAll('.admin-section').forEach(s => s.hidden = true);
  document.querySelectorAll('.nav-item[data-section]').forEach(b => b.classList.remove('ativo'));

  $(`section-${id}`).hidden = false;
  document.querySelector(`.nav-item[data-section="${id}"]`)?.classList.add('ativo');

  fecharMenu();

  if (id === 'visao-geral') renderVisaoGeral();
  if (id === 'usuarios')    renderUsuarios();
  if (id === 'planos')      renderPlanos();
}

window.navegarSecao = navegarSecao;

function irParaHome() { window.location.href = 'home.html'; }
window.irParaHome = irParaHome;

// ─────────────────────────────────────────────
// CARREGAR DADOS
// ─────────────────────────────────────────────

async function carregarPlanos() {
  try {
    const snap = await getDoc(doc(db, 'config_global', 'planos'));
    if (snap.exists()) {
      state.planos = snap.data();
    } else {
      // Planos padrão se ainda não existirem no Firestore
      state.planos = {
        basico:   { id: 'basico',   nome: 'Básico',   mensal: 15.90, anual: 99.90,  modulos: ['home','lancamentos','despesas','historico'], features: [] },
        pro:      { id: 'pro',      nome: 'Pro',       mensal: 25.90, anual: 169.90, modulos: ['home','lancamentos','despesas','historico','dashboard','custo_operacional'], features: [] },
        completo: { id: 'completo', nome: 'Completo',  mensal: 35.90, anual: 229.90, modulos: ['home','lancamentos','despesas','historico','dashboard','custo_operacional','relatorios'], features: [] }
      };
      await setDoc(doc(db, 'config_global', 'planos'), state.planos);
    }
    // Monta mapa de nomes para uso rápido
    Object.values(state.planos).forEach(p => {
      state.nomesPorId[p.id] = p.nome;
    });
  } catch (e) {
    console.error('[Admin] Erro ao carregar planos:', e);
  }
}

async function carregarUsuarios() {
  try {
    const snap = await getDocs(query(collection(db, 'users'), orderBy('criado_em', 'desc')));
    state.usuarios = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    state.usuariosFiltrados = [...state.usuarios];
  } catch (e) {
    console.error('[Admin] Erro ao carregar usuários:', e);
  }
}

// ─────────────────────────────────────────────
// VISÃO GERAL
// ─────────────────────────────────────────────

function renderVisaoGeral() {
  const agora = new Date();
  const seteAtras = new Date(agora - 7 * 86400000);

  let trials = 0, planosAtivos = 0, expirados = 0, recentes = 0;

  state.usuarios.forEach(u => {
    if (u.role === 'admin') return;

    const sit = situacaoUsuario(u);
    if (sit.classe === 'badge-trial') trials++;
    else if (sit.classe === 'badge-expirado') expirados++;
    else if (['badge-basico','badge-pro','badge-completo'].includes(sit.classe)) planosAtivos++;

    const criado = toDate(u.criado_em);
    if (criado && criado >= seteAtras) recentes++;
  });

  $('metric-total').textContent     = state.usuarios.length;
  $('metric-trials').textContent    = trials;
  $('metric-planos').textContent    = planosAtivos;
  $('metric-expirados').textContent = expirados;
  $('metric-recentes').textContent  = recentes;

  // Cadastros recentes
  const ultimos = [...state.usuarios].slice(0, 8);
  const lista = $('lista-recentes');

  if (!ultimos.length) {
    lista.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👤</div><p>Nenhum usuário cadastrado.</p></div>';
    return;
  }

  lista.innerHTML = ultimos.map(u => {
    const sit = situacaoUsuario(u);
    return `
      <div class="recente-item">
        <div class="user-row-avatar">${iniciais(u.nome, u.email)}</div>
        <div class="recente-info">
          <div class="recente-nome">${u.nome || '—'}</div>
          <div class="recente-email">${u.email || '—'}</div>
        </div>
        <span class="badge ${sit.classe}">${sit.label}</span>
        <div class="recente-data">${formatData(u.criado_em)}</div>
        <button class="btn-ver" onclick="abrirModalUsuario('${u.uid}')">Ver</button>
      </div>
    `;
  }).join('');
}

// ─────────────────────────────────────────────
// LISTA DE USUÁRIOS
// ─────────────────────────────────────────────

function aplicarFiltros() {
  const busca   = $('busca-usuario').value.toLowerCase().trim();
  const plano   = $('filtro-plano').value;
  const situacao = $('filtro-situacao').value;

  state.usuariosFiltrados = state.usuarios.filter(u => {
    const matchBusca = !busca
      || (u.nome || '').toLowerCase().includes(busca)
      || (u.email || '').toLowerCase().includes(busca);

    const matchPlano = !plano || u.plano === plano;

    const sit = situacaoUsuario(u);
    const matchSituacao = !situacao
      || (situacao === 'ativo'    && !['badge-expirado','badge-admin'].includes(sit.classe))
      || (situacao === 'expirado' && sit.classe === 'badge-expirado')
      || (situacao === 'admin'    && u.role === 'admin');

    return matchBusca && matchPlano && matchSituacao;
  });

  state.paginaAtual = 1;
  renderUsuarios();
}

function renderUsuarios() {
  const lista = $('lista-usuarios');
  const paginacao = $('paginacao');
  const total = state.usuariosFiltrados.length;
  const totalPaginas = Math.ceil(total / POR_PAGINA);
  const inicio = (state.paginaAtual - 1) * POR_PAGINA;
  const pagina = state.usuariosFiltrados.slice(inicio, inicio + POR_PAGINA);

  if (!total) {
    lista.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><p>Nenhum usuário encontrado.</p></div>';
    paginacao.hidden = true;
    return;
  }

  lista.innerHTML = `
    <table class="user-table">
      <thead>
        <tr>
          <th>Usuário</th>
          <th>Plano / Situação</th>
          <th>Cadastro</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${pagina.map(u => {
          const sit = situacaoUsuario(u);
          return `
            <tr>
              <td>
                <div class="user-row-info">
                  <div class="user-row-avatar">${iniciais(u.nome, u.email)}</div>
                  <div>
                    <div class="user-row-name">${u.nome || '—'}</div>
                    <div class="user-row-email">${u.email || '—'}</div>
                  </div>
                </div>
              </td>
              <td><span class="badge ${sit.classe}">${sit.label}</span></td>
              <td class="recente-data">${formatData(u.criado_em)}</td>
              <td><button class="btn-ver" onclick="abrirModalUsuario('${u.uid}')">Ver perfil</button></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  // Paginação
  if (totalPaginas <= 1) {
    paginacao.hidden = true;
    return;
  }

  paginacao.hidden = false;
  const btns = [];
  for (let i = 1; i <= totalPaginas; i++) {
    btns.push(`<button class="${i === state.paginaAtual ? 'ativo' : ''}" onclick="irPagina(${i})">${i}</button>`);
  }
  paginacao.innerHTML = btns.join('');
}

function irPagina(n) {
  state.paginaAtual = n;
  renderUsuarios();
}
window.irPagina = irPagina;

// ─────────────────────────────────────────────
// MODAL DE USUÁRIO
// ─────────────────────────────────────────────

async function abrirModalUsuario(uid) {
  const u = state.usuarios.find(x => x.uid === uid);
  if (!u) return;
  state.usuarioAberto = u;

  // Cabeçalho
  $('modal-avatar').textContent = iniciais(u.nome, u.email);
  $('modal-usuario-titulo').textContent = u.nome || '—';
  $('modal-meta').textContent = `${u.email || '—'} · cadastrado em ${formatData(u.criado_em)}`;

  // Dados pessoais
  $('edit-nome').value       = u.nome || '';
  $('edit-email').value      = u.email || '';
  $('edit-telefone').value   = u.telefone || '';
  $('edit-nascimento').value = u.data_nascimento || '';

  // Acesso
  $('edit-role').value  = u.role || 'user';
  $('edit-plano').value = u.plano || 'trial';
  $('edit-dias').value  = '';
  atualizarInfoAcesso(u);

  // Módulos
  renderModulosModal(u.modulos_ativos || []);

  // Log
  await carregarLog(uid);

  $('modal-usuario').hidden = false;
  document.body.style.overflow = 'hidden';
}

window.abrirModalUsuario = abrirModalUsuario;

function atualizarInfoAcesso(u) {
  const sit = situacaoUsuario(u);
  $('acesso-situacao').innerHTML = `<span class="badge ${sit.classe}">${sit.label}</span>`;

  if (u.role === 'admin') {
    $('acesso-expira').textContent = 'Acesso permanente';
    return;
  }

  if (u.plano === 'trial') {
    const inicio = toDate(u.trial_inicio || u.criado_em);
    if (inicio) {
      const fim = new Date(inicio);
      fim.setDate(fim.getDate() + 15);
      $('acesso-expira').textContent = formatData({ seconds: fim.getTime() / 1000 });
    } else {
      $('acesso-expira').textContent = '—';
    }
    return;
  }

  $('acesso-expira').textContent = formatData(u.plano_expira_em) || '—';
}

function fecharModalUsuario() {
  $('modal-usuario').hidden = true;
  document.body.style.overflow = '';
  state.usuarioAberto = null;
}
window.fecharModalUsuario = fecharModalUsuario;

function renderModulosModal(ativos) {
  $('edit-modulos').innerHTML = TODOS_MODULOS.map(m => {
    const checked = ativos.includes(m);
    return `
      <label class="modulo-toggle ${checked ? 'checked' : ''}" id="modtoggle-${m}">
        <input type="checkbox" value="${m}" ${checked ? 'checked' : ''}
          onchange="toggleModulo('${m}', this.checked)" />
        <div class="modulo-toggle-dot"></div>
        ${MODULOS_LABELS[m] || m}
      </label>
    `;
  }).join('');
}

function toggleModulo(modulo, checked) {
  const label = $(`modtoggle-${modulo}`);
  label?.classList.toggle('checked', checked);
}
window.toggleModulo = toggleModulo;

// ─────────────────────────────────────────────
// SALVAR — dados pessoais
// ─────────────────────────────────────────────

async function salvarDadosPessoais() {
  const u = state.usuarioAberto;
  if (!u) return;

  const dados = {
    nome:             $('edit-nome').value.trim(),
    telefone:         $('edit-telefone').value.trim(),
    data_nascimento:  $('edit-nascimento').value,
    atualizado_em:    serverTimestamp()
  };

  try {
    await updateDoc(doc(db, 'users', u.uid), dados);
    Object.assign(u, dados);
    $('modal-usuario-titulo').textContent = dados.nome || u.nome;
    await gravarLog(u.uid, 'Dados pessoais atualizados pelo admin');
    toast('Dados pessoais salvos.', 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar dados pessoais.', 'erro');
  }
}
window.salvarDadosPessoais = salvarDadosPessoais;

// ─────────────────────────────────────────────
// SALVAR — acesso e plano
// ─────────────────────────────────────────────

async function salvarAcessoPlano() {
  const u = state.usuarioAberto;
  if (!u) return;

  const novoRole  = $('edit-role').value;
  const novoPlano = $('edit-plano').value;

  const dados = {
    role:  novoRole,
    plano: novoPlano,
    atualizado_em: serverTimestamp()
  };

  // Se mudou para trial, limpa plano_expira_em
  if (novoPlano === 'trial') {
    dados.plano_expira_em = null;
  }

  // Atualiza modulos_ativos com base no plano escolhido
  if (novoRole !== 'admin' && novoPlano !== 'trial') {
    dados.modulos_ativos = state.planos[novoPlano]?.modulos || u.modulos_ativos;
  }

  try {
    await updateDoc(doc(db, 'users', u.uid), dados);
    Object.assign(u, dados);
    atualizarInfoAcesso(u);
    renderModulosModal(u.modulos_ativos || []);
    await gravarLog(u.uid, `Plano alterado para "${novoPlano}" · role: "${novoRole}"`);
    atualizarUsuarioNaLista(u);
    toast('Acesso e plano salvos.', 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar acesso.', 'erro');
  }
}
window.salvarAcessoPlano = salvarAcessoPlano;

// ─────────────────────────────────────────────
// SALVAR — módulos individualmente
// ─────────────────────────────────────────────

async function salvarModulos() {
  const u = state.usuarioAberto;
  if (!u) return;

  const checkboxes = $('edit-modulos').querySelectorAll('input[type="checkbox"]');
  const modulos = Array.from(checkboxes).filter(c => c.checked).map(c => c.value);

  try {
    await updateDoc(doc(db, 'users', u.uid), {
      modulos_ativos: modulos,
      atualizado_em: serverTimestamp()
    });
    u.modulos_ativos = modulos;
    await gravarLog(u.uid, `Módulos atualizados: [${modulos.join(', ')}]`);
    toast('Módulos salvos.', 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar módulos.', 'erro');
  }
}
window.salvarModulos = salvarModulos;

// ─────────────────────────────────────────────
// ADICIONAR DIAS
// ─────────────────────────────────────────────

async function adicionarDias() {
  const u = state.usuarioAberto;
  if (!u) return;

  const dias = parseInt($('edit-dias').value, 10);
  if (!dias || dias < 1) { toast('Informe um número válido de dias.', 'aviso'); return; }

  const plano = $('edit-plano').value;
  if (plano === 'trial') { toast('Selecione um plano pago antes de adicionar dias.', 'aviso'); return; }

  // Soma inteligente: se ainda ativo, soma à expiração. Se vencido, soma de hoje.
  const expiraAtual = toDate(u.plano_expira_em);
  const base = expiraAtual && expiraAtual > new Date() ? expiraAtual : new Date();
  base.setDate(base.getDate() + dias);

  const novaExpiracao = Timestamp.fromDate(base);

  try {
    await updateDoc(doc(db, 'users', u.uid), {
      plano,
      plano_expira_em: novaExpiracao,
      modulos_ativos:  state.planos[plano]?.modulos || u.modulos_ativos,
      atualizado_em:   serverTimestamp()
    });

    u.plano          = plano;
    u.plano_expira_em = novaExpiracao;
    u.modulos_ativos  = state.planos[plano]?.modulos || u.modulos_ativos;

    $('edit-plano').value = plano;
    $('edit-dias').value  = '';
    atualizarInfoAcesso(u);
    renderModulosModal(u.modulos_ativos);
    atualizarUsuarioNaLista(u);

    await gravarLog(u.uid, `+${dias} dias adicionados · plano "${plano}" · expira em ${formatData(novaExpiracao)}`);
    toast(`${dias} dias adicionados com sucesso.`, 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao adicionar dias.', 'erro');
  }
}
window.adicionarDias = adicionarDias;

// ─────────────────────────────────────────────
// LOG DE ALTERAÇÕES
// ─────────────────────────────────────────────

async function gravarLog(uid, descricao) {
  try {
    await addDoc(collection(db, 'users', uid, 'historico_admin'), {
      descricao,
      feito_por: state.adminUid,
      criado_em: serverTimestamp()
    });
  } catch (e) {
    console.error('[Admin] Erro ao gravar log:', e);
  }
}

async function carregarLog(uid) {
  const container = $('log-alteracoes');
  try {
    const snap = await getDocs(
      query(collection(db, 'users', uid, 'historico_admin'), orderBy('criado_em', 'desc'), limit(20))
    );

    if (snap.empty) {
      container.innerHTML = '<div class="empty-state" style="padding:var(--gap-lg)"><p>Nenhuma alteração registrada.</p></div>';
      return;
    }

    container.innerHTML = snap.docs.map(d => {
      const data = d.data();
      return `
        <div class="log-item">
          <div class="log-item-data">${formatDataHora(data.criado_em)}</div>
          <div class="log-item-desc">${data.descricao || '—'}</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = '<div class="empty-state" style="padding:var(--gap-lg)"><p>Erro ao carregar histórico.</p></div>';
  }
}

// ─────────────────────────────────────────────
// PLANOS
// ─────────────────────────────────────────────

function renderPlanos() {
  const grid = $('lista-planos');
  const planos = Object.values(state.planos);

  if (!planos.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📦</div><p>Nenhum plano encontrado.</p></div>';
    return;
  }

  grid.innerHTML = planos.map(p => `
    <div class="plano-card">
      <div class="plano-card-id">${p.id}</div>
      <div class="plano-card-nome">${p.nome}</div>
      <div class="plano-card-preco">
        <div class="plano-preco-item">
          <span class="plano-preco-label">Mensal</span>
          <span class="plano-preco-valor">${formatReal(p.mensal)}</span>
        </div>
        <div class="plano-preco-item">
          <span class="plano-preco-label">Anual</span>
          <span class="plano-preco-valor">${formatReal(p.anual)}</span>
        </div>
      </div>
      <div class="plano-card-modulos">
        ${(p.modulos || []).map(m => `<span class="modulo-tag">${MODULOS_LABELS[m] || m}</span>`).join('')}
      </div>
      <button class="btn btn-secondary btn-full" onclick="abrirModalPlano('${p.id}')">
        Editar plano
      </button>
    </div>
  `).join('');
}

// ─────────────────────────────────────────────
// MODAL DE PLANO
// ─────────────────────────────────────────────

function abrirModalPlano(id) {
  const p = state.planos[id];
  if (!p) return;

  $('plano-edit-id').value     = id;
  $('modal-plano-titulo').textContent = `Editar — ${p.nome}`;
  $('plano-edit-nome').value   = p.nome || '';
  $('plano-edit-mensal').value = p.mensal || '';
  $('plano-edit-anual').value  = p.anual || '';

  // Módulos
  $('plano-edit-modulos').innerHTML = TODOS_MODULOS.map(m => {
    const checked = (p.modulos || []).includes(m);
    return `
      <label class="modulo-toggle ${checked ? 'checked' : ''}" id="planomod-${m}">
        <input type="checkbox" value="${m}" ${checked ? 'checked' : ''}
          onchange="togglePlanoModulo('${m}', this.checked)" />
        <div class="modulo-toggle-dot"></div>
        ${MODULOS_LABELS[m] || m}
      </label>
    `;
  }).join('');

  // Features
  renderFeatures(p.features?.length ? p.features : (FEATURES_PADRAO[id] || []));

  $('modal-plano').hidden = false;
  document.body.style.overflow = 'hidden';
}
window.abrirModalPlano = abrirModalPlano;

function fecharModalPlano() {
  $('modal-plano').hidden = true;
  document.body.style.overflow = '';
}
window.fecharModalPlano = fecharModalPlano;

function togglePlanoModulo(m, checked) {
  $(`planomod-${m}`)?.classList.toggle('checked', checked);
}
window.togglePlanoModulo = togglePlanoModulo;

function renderFeatures(features) {
  const container = $('plano-edit-features');
  container.innerHTML = features.map((f, i) => featureRow(f, i)).join('');
}

function featureRow(f, i) {
  return `
    <div class="feature-row" id="feature-row-${i}">
      <button class="feature-ok-toggle ${f.ok ? 'ok' : ''}" type="button"
        onclick="toggleFeatureOk(${i})" title="${f.ok ? 'Incluído' : 'Não incluído'}">
        ${f.ok ? '✓' : '○'}
      </button>
      <input type="text" class="input" value="${f.text || ''}"
        placeholder="Descrição do item" id="feature-text-${i}" />
      <button class="feature-remove" type="button" onclick="removerFeature(${i})"
        aria-label="Remover">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  `;
}

function adicionarFeature() {
  const container = $('plano-edit-features');
  const i = container.children.length;
  const div = document.createElement('div');
  div.innerHTML = featureRow({ ok: true, text: '' }, i);
  container.appendChild(div.firstElementChild);
}
window.adicionarFeature = adicionarFeature;

function toggleFeatureOk(i) {
  const btn = document.querySelector(`#feature-row-${i} .feature-ok-toggle`);
  const ok = !btn.classList.contains('ok');
  btn.classList.toggle('ok', ok);
  btn.textContent = ok ? '✓' : '○';
}
window.toggleFeatureOk = toggleFeatureOk;

function removerFeature(i) {
  $(`feature-row-${i}`)?.remove();
}
window.removerFeature = removerFeature;

async function salvarPlano() {
  const id     = $('plano-edit-id').value;
  const nome   = $('plano-edit-nome').value.trim();
  const mensal = parseFloat($('plano-edit-mensal').value);
  const anual  = parseFloat($('plano-edit-anual').value);

  if (!nome) { toast('Informe o nome do plano.', 'aviso'); return; }

  // Módulos selecionados
  const modulos = Array.from($('plano-edit-modulos').querySelectorAll('input:checked')).map(c => c.value);

  // Features
  const rows = $('plano-edit-features').querySelectorAll('.feature-row');
  const features = Array.from(rows).map(row => ({
    ok:   row.querySelector('.feature-ok-toggle').classList.contains('ok'),
    text: row.querySelector('input[type="text"]').value.trim()
  })).filter(f => f.text);

  const planoAtualizado = { id, nome, mensal, anual, modulos, features };

  try {
    await setDoc(doc(db, 'config_global', 'planos'), {
      ...state.planos,
      [id]: planoAtualizado
    });

    state.planos[id] = planoAtualizado;
    state.nomesPorId[id] = nome;

    fecharModalPlano();
    renderPlanos();
    toast(`Plano "${nome}" salvo com sucesso.`, 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar plano.', 'erro');
  }
}
window.salvarPlano = salvarPlano;

// ─────────────────────────────────────────────
// UTILITÁRIO — atualiza usuário na lista local
// ─────────────────────────────────────────────

function atualizarUsuarioNaLista(u) {
  const idx = state.usuarios.findIndex(x => x.uid === u.uid);
  if (idx !== -1) state.usuarios[idx] = { ...state.usuarios[idx], ...u };
  aplicarFiltros();
}

// ─────────────────────────────────────────────
// MENU MOBILE
// ─────────────────────────────────────────────

function abrirMenu() {
  $('sidebar').classList.add('aberta');
  $('sidebar-overlay').classList.add('visivel');
  $('btn-menu').setAttribute('aria-expanded', 'true');
  document.body.classList.add('menu-open');
}

function fecharMenu() {
  $('sidebar').classList.remove('aberta');
  $('sidebar-overlay').classList.remove('visivel');
  $('btn-menu')?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open');
}

// ─────────────────────────────────────────────
// EVENTOS
// ─────────────────────────────────────────────

function bindEvents() {
  $('btn-menu').addEventListener('click', abrirMenu);
  $('sidebar-overlay').addEventListener('click', fecharMenu);

  $('btn-logout').addEventListener('click', async () => {
    await signOut(auth);
    window.location.replace('login.html');
  });

  $('busca-usuario').addEventListener('input', aplicarFiltros);
  $('filtro-plano').addEventListener('change', aplicarFiltros);
  $('filtro-situacao').addEventListener('change', aplicarFiltros);

  // Fechar modais com Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      fecharModalUsuario();
      fecharModalPlano();
      fecharMenu();
    }
  });

  // Fechar modal clicando no overlay
  $('modal-usuario').addEventListener('click', e => {
    if (e.target === $('modal-usuario')) fecharModalUsuario();
  });
  $('modal-plano').addEventListener('click', e => {
    if (e.target === $('modal-plano')) fecharModalPlano();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) fecharMenu();
  });
}
