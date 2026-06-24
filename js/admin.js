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
    { ok: false, text: 'Relatórios exportáveis' }
  ],
  pro: [
    { ok: true,  text: 'Tudo do Básico' },
    { ok: true,  text: 'Dashboard financeiro completo (DRE)' },
    { ok: true,  text: 'Custo operacional por km' },
    { ok: true,  text: 'KM ocioso com custo separado' },
    { ok: true,  text: 'Múltiplos veículos' },
    { ok: false, text: 'Relatórios exportáveis' },
    { ok: false, text: 'Suporte prioritário WhatsApp' }
  ],
  completo: [
    { ok: true,  text: 'Tudo do Pro' },
    { ok: true,  text: 'Relatórios exportáveis (PDF/Excel)' },
    { ok: true,  text: 'Suporte prioritário WhatsApp' },
    { ok: true,  text: 'Histórico ilimitado' },
    { ok: true,  text: 'Acesso antecipado a novidades' }
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
// PLANOS — TABELA
// ─────────────────────────────────────────────

// Estado local da tabela (editável antes de salvar)
let tabelaState = {};

function renderPlanos() {
  const ids = ['basico', 'pro', 'completo'];

  // Clona estado atual para edição local
  tabelaState = {};
  ids.forEach(id => {
    const p = state.planos[id] || {};
    tabelaState[id] = {
      id,
      nome:     p.nome    || '',
      mensal:   p.mensal  || 0,
      anual:    p.anual   || 0,
      destaque: p.destaque || false,
      features: (p.features?.length ? p.features : (FEATURES_PADRAO[id] || [])).map(f => ({ ...f })),
      modulos:  [...(p.modulos || [])]
    };
  });

  renderTabelaHTML(ids);
}

function renderTabelaHTML(ids) {
  const container = $('planos-tabela-container');

  const nomesHeader = ids.map(id => {
    const p = tabelaState[id];
    return `<th class="col-plano">${p.nome || id}</th>`;
  }).join('');

  const rowNome = ids.map(id =>
    `<td class="col-valor"><input class="input-tabela" data-field="nome" data-id="${id}"
      value="${tabelaState[id].nome}" placeholder="Nome do plano"
      oninput="tabelaUpdate('${id}','nome',this.value)" /></td>`
  ).join('');

  const rowMensal = ids.map(id =>
    `<td class="col-valor"><input class="input-tabela" type="number" data-field="mensal" data-id="${id}"
      value="${tabelaState[id].mensal}" min="0" step="0.01"
      oninput="tabelaUpdate('${id}','mensal',parseFloat(this.value)||0)" /></td>`
  ).join('');

  const rowAnual = ids.map(id =>
    `<td class="col-valor"><input class="input-tabela" type="number" data-field="anual" data-id="${id}"
      value="${tabelaState[id].anual}" min="0" step="0.01"
      oninput="tabelaUpdate('${id}','anual',parseFloat(this.value)||0)" /></td>`
  ).join('');

  const rowDestaque = ids.map(id => {
    const ativo = tabelaState[id].destaque;
    return `<td class="col-valor"><div class="cell-toggle">
      <button class="cell-toggle-btn ${ativo ? 'destaque-ativo' : 'inativo'}"
        onclick="tabelaToggleDestaque('${id}')" title="Destaque na landing">
        ${ativo ? '★' : '☆'}
      </button></div></td>`;
  }).join('');

  // Máximo de features entre os planos
  const maxFeatures = Math.max(...ids.map(id => tabelaState[id].features.length), 0);

  let rowsFeatures = '';
  for (let fi = 0; fi < maxFeatures; fi++) {
    const cols = ids.map(id => {
      const f = tabelaState[id].features[fi];
      if (!f) {
        return `<td class="col-valor"><div class="cell-toggle">
          <button class="cell-toggle-btn inativo" style="opacity:0.3" disabled>—</button>
        </div></td>`;
      }
      return `<td>
        <div class="feature-label-wrap">
          <button class="cell-toggle-btn ${f.ok ? 'ativo' : 'inativo'}"
            onclick="tabelaToggleFeature('${id}',${fi})">${f.ok ? '✓' : '○'}</button>
          <input class="input-tabela" value="${f.text || ''}" placeholder="Descrição"
            oninput="tabelaUpdateFeature('${id}',${fi},this.value)" />
          <button class="btn-remove-row" onclick="tabelaRemoveFeature('${id}',${fi})" title="Remover">×</button>
        </div>
      </td>`;
    }).join('');
    rowsFeatures += `<tr><td></td>${cols}</tr>`;
  }

  const rowAddFeature = ids.map(id =>
    `<td class="col-valor">
      <button class="btn-add-feature" onclick="tabelaAddFeature('${id}')">+ Adicionar</button>
    </td>`
  ).join('');

  const rowsModulos = TODOS_MODULOS.map(m => {
    const cols = ids.map(id => {
      const ativo = tabelaState[id].modulos.includes(m);
      return `<td class="col-valor"><div class="cell-toggle">
        <button class="cell-toggle-btn ${ativo ? 'ativo' : 'inativo'}"
          onclick="tabelaToggleModulo('${id}','${m}')">
          ${ativo ? '✓' : '○'}
        </button></div></td>`;
    }).join('');
    return `<tr><td>${MODULOS_LABELS[m]}</td>${cols}</tr>`;
  }).join('');

  container.innerHTML = `
    <table class="planos-tabela">
      <thead>
        <tr>
          <th></th>
          ${nomesHeader}
        </tr>
      </thead>
      <tbody>
        <tr class="grupo-header"><td colspan="4">Configurações do plano</td></tr>
        <tr><td>Nome de exibição</td>${rowNome}</tr>
        <tr><td>Preço mensal (R$)</td>${rowMensal}</tr>
        <tr><td>Preço anual (R$)</td>${rowAnual}</tr>
        <tr><td>Destaque na landing</td>${rowDestaque}</tr>

        <tr class="grupo-header"><td colspan="4">Funcionalidades exibidas na landing</td></tr>
        ${rowsFeatures}
        <tr class="row-add-feature"><td></td>${rowAddFeature}</tr>

        <tr class="grupo-header"><td colspan="4">Módulos de acesso</td></tr>
        ${rowsModulos}
      </tbody>
    </table>
  `;
}

// ── Interações da tabela ──

function tabelaUpdate(id, field, value) {
  tabelaState[id][field] = value;
  if (field === 'nome') renderTabelaHTML(['basico','pro','completo']);
}
window.tabelaUpdate = tabelaUpdate;

function tabelaToggleDestaque(id) {
  tabelaState[id].destaque = !tabelaState[id].destaque;
  renderTabelaHTML(['basico','pro','completo']);
}
window.tabelaToggleDestaque = tabelaToggleDestaque;

function tabelaToggleFeature(id, fi) {
  tabelaState[id].features[fi].ok = !tabelaState[id].features[fi].ok;
  renderTabelaHTML(['basico','pro','completo']);
}
window.tabelaToggleFeature = tabelaToggleFeature;

function tabelaUpdateFeature(id, fi, value) {
  tabelaState[id].features[fi].text = value;
}
window.tabelaUpdateFeature = tabelaUpdateFeature;

function tabelaRemoveFeature(id, fi) {
  tabelaState[id].features.splice(fi, 1);
  renderTabelaHTML(['basico','pro','completo']);
}
window.tabelaRemoveFeature = tabelaRemoveFeature;

function tabelaAddFeature(id) {
  tabelaState[id].features.push({ ok: true, text: '' });
  renderTabelaHTML(['basico','pro','completo']);
}
window.tabelaAddFeature = tabelaAddFeature;

function tabelaToggleModulo(id, modulo) {
  const idx = tabelaState[id].modulos.indexOf(modulo);
  if (idx === -1) tabelaState[id].modulos.push(modulo);
  else tabelaState[id].modulos.splice(idx, 1);
  renderTabelaHTML(['basico','pro','completo']);
}
window.tabelaToggleModulo = tabelaToggleModulo;

async function salvarTodosPlanos() {
  const ids = ['basico', 'pro', 'completo'];

  for (const id of ids) {
    if (!tabelaState[id].nome.trim()) {
      toast(`Informe o nome do plano "${id}".`, 'aviso');
      return;
    }
  }

  const planosAtualizados = {};
  ids.forEach(id => {
    const p = tabelaState[id];
    planosAtualizados[id] = {
      id,
      nome:     p.nome.trim(),
      mensal:   p.mensal,
      anual:    p.anual,
      destaque: p.destaque,
      features: p.features.filter(f => f.text.trim()),
      modulos:  p.modulos
    };
  });

  try {
    await setDoc(doc(db, 'config_global', 'planos'), planosAtualizados);
    Object.assign(state.planos, planosAtualizados);
    ids.forEach(id => { state.nomesPorId[id] = planosAtualizados[id].nome; });
    toast('Planos salvos com sucesso.', 'sucesso');
    renderTabelaHTML(ids);
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar planos.', 'erro');
  }
}
window.salvarTodosPlanos = salvarTodosPlanos;

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
      fecharMenu();
    }
  });

  // Fechar modal clicando no overlay
  $('modal-usuario').addEventListener('click', e => {
    if (e.target === $('modal-usuario')) fecharModalUsuario();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) fecharMenu();
  });
}