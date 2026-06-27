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
  'relatorios',
  'configuracoes',
  'configuracoes_sugestao_salario'
];

const MODULOS_LABELS = {
  home:                           'Home',
  lancamentos:                    'Lançamentos',
  despesas:                       'Despesas',
  historico:                      'Histórico',
  dashboard:                      'Dashboard',
  custo_operacional:              'Custo Operacional',
  relatorios:                     'Relatórios',
  configuracoes:                  'Configurações',
  configuracoes_sugestao_salario: 'Configurações — Sugestão de salário'
};

const MODULOS_FILHOS = {
  configuracoes: ['configuracoes_sugestao_salario']
};

const FEATURES_PADRAO = [
  { text: 'Meta diária automática',                basico: true,  pro: true,  completo: true  },
  { text: 'Registro de corridas (app + particular)', basico: true, pro: true,  completo: true  },
  { text: 'Controle de despesas e parcelas',       basico: true,  pro: true,  completo: true  },
  { text: 'Histórico com calendário',              basico: true,  pro: true,  completo: true  },
  { text: 'Dashboard financeiro (DRE)',            basico: false, pro: true,  completo: true  },
  { text: 'Custo operacional por km',              basico: false, pro: true,  completo: true  },
  { text: 'KM ocioso com custo separado',          basico: false, pro: true,  completo: true  },
  { text: 'Múltiplos veículos',                    basico: false, pro: true,  completo: true  },
  { text: 'Relatórios exportáveis (PDF/Excel)',    basico: false, pro: false, completo: true  },
  { text: 'Suporte prioritário WhatsApp',          basico: false, pro: false, completo: true  },
  { text: 'Histórico ilimitado',                   basico: false, pro: false, completo: true  },
  { text: 'Acesso antecipado a novidades',         basico: false, pro: false, completo: true  }
];

const IDS_PLANOS = ['basico', 'pro', 'completo'];
// Trial aparece apenas na tabela de módulos — não tem preço nem features na landing
const IDS_PLANOS_MODULOS = ['trial', 'basico', 'pro', 'completo'];

const POR_PAGINA = 15;

// ─────────────────────────────────────────────
// ESTADO
// ─────────────────────────────────────────────

const state = {
  adminUid:          null,
  usuarios:          [],
  usuariosFiltrados: [],
  paginaAtual:       1,
  usuarioAberto:     null,
  planos:            {},
  nomesPorId:        {}
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
    const trialDias = state.planos[u.plano]?.trial_dias ?? 15;
    const fim = new Date(inicio);
    fim.setDate(fim.getDate() + trialDias);
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
  if (id === 'planos')      { renderPlanos(); renderAcessoTemporario(); }
  if (id === 'referencias') renderReferencias();
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
      const dados = snap.data();

      const precisaMigrar = dados.basico?.features && Array.isArray(dados.basico.features) &&
        dados.basico.features.length > 0 &&
        dados.basico.features[0] !== undefined &&
        !('basico' in dados.basico.features[0]);

      if (precisaMigrar) {
        dados.features_global = migrarFeaturesAntigo(dados);
      }

      state.planos = dados;
    } else {
      state.planos = {
        trial:    { id: 'trial',    modulos: [...TODOS_MODULOS] },
        basico:   { id: 'basico',   nome: 'Básico',   mensal: 15.90, anual: 99.90,  trial_dias: 15, destaque: false, modulos: ['home','lancamentos','despesas','historico'] },
        pro:      { id: 'pro',      nome: 'Pro',       mensal: 25.90, anual: 169.90, trial_dias: 15, destaque: false, modulos: ['home','lancamentos','despesas','historico','dashboard','custo_operacional'] },
        completo: { id: 'completo', nome: 'Completo',  mensal: 35.90, anual: 229.90, trial_dias: 15, destaque: false, modulos: ['home','lancamentos','despesas','historico','dashboard','custo_operacional','relatorios'] },
        features_global: FEATURES_PADRAO,
        modulos_sistema: TODOS_MODULOS.map(id => ({ id, label: MODULOS_LABELS[id] }))
      };
      await setDoc(doc(db, 'config_global', 'planos'), state.planos);
    }
    IDS_PLANOS.forEach(id => {
      state.nomesPorId[id] = state.planos[id]?.nome || id;
    });
  } catch (e) {
    console.error('[Admin] Erro ao carregar planos:', e);
  }
}

function migrarFeaturesAntigo(dados) {
  const map = {};
  IDS_PLANOS.forEach(id => {
    (dados[id]?.features || []).forEach(f => {
      if (!f.text?.trim()) return;
      if (!map[f.text]) map[f.text] = { text: f.text, basico: false, pro: false, completo: false };
      map[f.text][id] = f.ok;
    });
  });
  return Object.values(map).length ? Object.values(map) : FEATURES_PADRAO;
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
  const busca    = $('busca-usuario').value.toLowerCase().trim();
  const plano    = $('filtro-plano').value;
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

  if (totalPaginas <= 1) { paginacao.hidden = true; return; }

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

  $('modal-avatar').textContent = iniciais(u.nome, u.email);
  $('modal-usuario-titulo').textContent = u.nome || '—';
  $('modal-meta').textContent = `${u.email || '—'} · cadastrado em ${formatData(u.criado_em)}`;

  $('edit-nome').value       = u.nome || '';
  $('edit-email').value      = u.email || '';
  $('edit-telefone').value   = u.telefone || '';
  $('edit-nascimento').value = u.data_nascimento || '';

  $('edit-role').value  = u.role || 'user';
  $('edit-plano').value = u.plano || 'trial';
  $('edit-dias').value  = '';
  atualizarInfoAcesso(u);

  renderModulosModal(u.modulos_ativos || []);
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
      const trialDias = state.planos.basico?.trial_dias ?? 15;
      const fim = new Date(inicio);
      fim.setDate(fim.getDate() + trialDias);
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
    nome:            $('edit-nome').value.trim(),
    telefone:        $('edit-telefone').value.trim(),
    data_nascimento: $('edit-nascimento').value,
    atualizado_em:   serverTimestamp()
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
    role:          novoRole,
    plano:         novoPlano,
    atualizado_em: serverTimestamp()
  };

  // Sempre preserva plano_expira_em vigente ao trocar de plano, inclusive para trial.
  // Isso garante que voltar de trial para plano pago não perde a data de expiração anterior.
  const expiraAtual = toDate(u.plano_expira_em);
  if (expiraAtual && expiraAtual > new Date()) {
    dados.plano_expira_em = u.plano_expira_em;
  }

  // Atualiza modulos_ativos de acordo com o plano escolhido (inclusive trial)
  if (novoRole !== 'admin') {
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
      atualizado_em:  serverTimestamp()
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

    u.plano           = plano;
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

let tabelaState = {
  configuracoes: {},
  features: [],
  modulos: {}
};

function renderPlanos() {
  // Trial só tem módulos, sem preço
  tabelaState.modulos['trial'] = [...(state.planos.trial?.modulos || [...TODOS_MODULOS])];
  IDS_PLANOS.forEach(id => {
    const p = state.planos[id] || {};
    tabelaState.configuracoes[id] = {
      nome:       p.nome      || '',
      mensal:     p.mensal    || 0,
      anual:      p.anual     || 0,
      destaque:   p.destaque  || false,
      trial_dias: p.trial_dias ?? 15
    };
    tabelaState.modulos[id] = [...(p.modulos || [])];
  });

  const fg = state.planos.features_global;
  if (fg && Array.isArray(fg) && fg.length > 0) {
    tabelaState.features = fg.map(f => ({ ...f }));
  } else {
    tabelaState.features = migrarFeaturesAntigo(state.planos);
  }

  renderConfiguracoes();
  renderFeaturesTabela();
  renderModulosTabela();
}

// ── Bloco 1: Configurações ──────────────────

function renderConfiguracoes() {
  const c = $('planos-config-container');
  if (!c) return;

  const nomesHeader = IDS_PLANOS.map(id =>
    `<th class="col-plano">${tabelaState.configuracoes[id].nome || id}</th>`
  ).join('');

  const rowNome = IDS_PLANOS.map(id =>
    `<td class="col-valor"><input class="input-tabela" value="${tabelaState.configuracoes[id].nome}"
      placeholder="Nome do plano"
      oninput="cfgUpdate('${id}','nome',this.value)"
      onblur="renderConfiguracoes()" /></td>`
  ).join('');

  const rowMensal = IDS_PLANOS.map(id =>
    `<td class="col-valor"><input class="input-tabela" type="number" value="${tabelaState.configuracoes[id].mensal}"
      min="0" step="0.01"
      oninput="cfgUpdate('${id}','mensal',parseFloat(this.value)||0)" /></td>`
  ).join('');

  const rowAnual = IDS_PLANOS.map(id =>
    `<td class="col-valor"><input class="input-tabela" type="number" value="${tabelaState.configuracoes[id].anual}"
      min="0" step="0.01"
      oninput="cfgUpdate('${id}','anual',parseFloat(this.value)||0)" /></td>`
  ).join('');

  const rowTrial = IDS_PLANOS.map(id =>
    `<td class="col-valor"><input class="input-tabela" type="number" value="${tabelaState.configuracoes[id].trial_dias}"
      min="1" max="365" step="1"
      oninput="cfgUpdate('${id}','trial_dias',parseInt(this.value)||15)" /></td>`
  ).join('');

  const rowDestaque = IDS_PLANOS.map(id => {
    const ativo = tabelaState.configuracoes[id].destaque;
    return `<td class="col-valor"><div class="cell-toggle">
      <button class="cell-toggle-btn ${ativo ? 'destaque-ativo' : 'inativo'}"
        onclick="cfgToggleDestaque('${id}')" title="Destaque na landing">
        ${ativo ? '★' : '☆'}
      </button></div></td>`;
  }).join('');

  c.innerHTML = `
    <table class="planos-tabela">
      <thead><tr><th style="width:200px"></th>${nomesHeader}</tr></thead>
      <tbody>
        <tr><td>Nome de exibição</td>${rowNome}</tr>
        <tr><td>Preço mensal (R$)</td>${rowMensal}</tr>
        <tr><td>Preço anual (R$)</td>${rowAnual}</tr>
        <tr><td>Dias de teste grátis</td>${rowTrial}</tr>
        <tr class="last-row"><td>Destaque na landing</td>${rowDestaque}</tr>
      </tbody>
    </table>
  `;
}

function cfgUpdate(id, field, value) {
  tabelaState.configuracoes[id][field] = value;
}
window.cfgUpdate = cfgUpdate;
window.renderConfiguracoes = renderConfiguracoes;

function cfgToggleDestaque(id) {
  tabelaState.configuracoes[id].destaque = !tabelaState.configuracoes[id].destaque;
  renderConfiguracoes();
}
window.cfgToggleDestaque = cfgToggleDestaque;

async function salvarConfiguracoes() {
  for (const id of IDS_PLANOS) {
    if (!tabelaState.configuracoes[id].nome.trim()) {
      toast(`Informe o nome do plano "${id}".`, 'aviso');
      return;
    }
  }

  const atualizacao = {};
  IDS_PLANOS.forEach(id => {
    const c = tabelaState.configuracoes[id];
    atualizacao[id] = {
      ...(state.planos[id] || {}),
      id,
      nome:       c.nome.trim(),
      mensal:     c.mensal,
      anual:      c.anual,
      destaque:   c.destaque,
      trial_dias: c.trial_dias
    };
    state.nomesPorId[id] = c.nome.trim();
  });

  try {
    await setDoc(doc(db, 'config_global', 'planos'), { ...state.planos, ...atualizacao }, { merge: true });
    Object.assign(state.planos, atualizacao);
    toast('Configurações salvas.', 'sucesso');
    renderConfiguracoes();
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar configurações.', 'erro');
  }
}
window.salvarConfiguracoes = salvarConfiguracoes;

// ── Bloco 2: Funcionalidades ────────────────

function renderFeaturesTabela() {
  const c = $('planos-features-container');
  if (!c) return;

  const nomesHeader = IDS_PLANOS.map(id =>
    `<th class="col-plano-mini">${tabelaState.configuracoes[id].nome || id}</th>`
  ).join('');

  const rowsFeatures = tabelaState.features.map((f, fi) => {
    const toggles = IDS_PLANOS.map(id => {
      const ativo = f[id] === true;
      return `<td class="col-toggle-centro">
        <button class="cell-toggle-btn ${ativo ? 'ativo' : 'inativo'}"
          onclick="featToggle(${fi},'${id}')">${ativo ? '✓' : '○'}</button>
      </td>`;
    }).join('');

    return `<tr>
      <td class="col-feature-texto">
        <div class="feature-linha">
          <input class="input-tabela" value="${escHtml(f.text)}" placeholder="Descrição da funcionalidade"
            oninput="featUpdateText(${fi},this.value)" />
          <button class="btn-remove-row" onclick="featRemove(${fi})" title="Remover">×</button>
        </div>
      </td>
      ${toggles}
    </tr>`;
  }).join('');

  c.innerHTML = `
    <table class="planos-tabela planos-tabela-features">
      <thead><tr><th style="width:auto">Funcionalidade</th>${nomesHeader}</tr></thead>
      <tbody>
        ${rowsFeatures}
        <tr class="row-add-feature">
          <td colspan="${1 + IDS_PLANOS.length}">
            <button class="btn-add-feature" onclick="featAdd()">+ Adicionar funcionalidade</button>
          </td>
        </tr>
      </tbody>
    </table>
  `;
}

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function featToggle(fi, id) {
  tabelaState.features[fi][id] = !tabelaState.features[fi][id];
  renderFeaturesTabela();
}
window.featToggle = featToggle;

function featUpdateText(fi, value) {
  tabelaState.features[fi].text = value;
}
window.featUpdateText = featUpdateText;

function featRemove(fi) {
  tabelaState.features.splice(fi, 1);
  renderFeaturesTabela();
}
window.featRemove = featRemove;

function featAdd() {
  tabelaState.features.push({ text: '', basico: false, pro: false, completo: false });
  renderFeaturesTabela();
  setTimeout(() => {
    const inputs = $('planos-features-container').querySelectorAll('.input-tabela');
    inputs[inputs.length - 1]?.focus();
  }, 50);
}
window.featAdd = featAdd;

async function salvarFeatures() {
  const features = tabelaState.features.filter(f => f.text.trim());
  try {
    await setDoc(doc(db, 'config_global', 'planos'), { features_global: features }, { merge: true });
    await updateDoc(doc(db, 'config_global', 'planos'), {
      'basico.features':    [],
      'pro.features':       [],
      'completo.features':  []
    });
    state.planos.features_global = features;
    if (state.planos.basico)   state.planos.basico.features   = [];
    if (state.planos.pro)      state.planos.pro.features      = [];
    if (state.planos.completo) state.planos.completo.features = [];
    tabelaState.features = features.map(f => ({ ...f }));
    toast('Funcionalidades salvas.', 'sucesso');
    renderFeaturesTabela();
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar funcionalidades.', 'erro');
  }
}
window.salvarFeatures = salvarFeatures;

// ── Bloco 3: Módulos ────────────────────────

function renderModulosTabela() {
  const c = $('planos-modulos-container');
  if (!c) return;

  const nomesHeader = IDS_PLANOS_MODULOS.map(id => {
    const label = id === 'trial' ? 'Trial' : (tabelaState.configuracoes[id]?.nome || id);
    return `<th class="col-plano-mini${id === 'trial' ? ' col-trial' : ''}">${label}</th>`;
  }).join('');

  const todosFilhos = new Set(Object.values(MODULOS_FILHOS).flat());

  const rowsModulos = TODOS_MODULOS
    .filter(m => !todosFilhos.has(m))
    .map(m => {
      const filhos = MODULOS_FILHOS[m] || [];
      const temFilhos = filhos.length > 0;

      const toggles = IDS_PLANOS_MODULOS.map(id => {
        const lista = tabelaState.modulos[id] || [];
        const ativo = lista.includes(m);
        return `<td class="col-toggle-centro${id === 'trial' ? ' col-trial' : ''}">
          <button class="cell-toggle-btn ${ativo ? 'ativo' : 'inativo'}"
            onclick="moduloToggle('${id}','${m}')">${ativo ? '✓' : '○'}</button>
        </td>`;
      }).join('');

      const linhaPai = `<tr data-modulo="${m}" class="${temFilhos ? 'modulo-pai' : ''}">
        <td class="col-modulo-label">
          ${temFilhos ? `<button class="modulo-expandir" onclick="moduloExpandir('${m}')" aria-expanded="false" aria-label="Expandir sub-módulos">
            <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
          </button>` : ''}
          ${MODULOS_LABELS[m] || m}
        </td>
        ${toggles}
      </tr>`;

      const linhasFilhos = filhos.map(f => {
        const togglesFilho = IDS_PLANOS_MODULOS.map(id => {
          const lista = tabelaState.modulos[id] || [];
          const ativo = lista.includes(f);
          return `<td class="col-toggle-centro${id === 'trial' ? ' col-trial' : ''}">
            <button class="cell-toggle-btn ${ativo ? 'ativo' : 'inativo'}"
              onclick="moduloToggle('${id}','${f}')">${ativo ? '✓' : '○'}</button>
          </td>`;
        }).join('');

        const labelFilho = (MODULOS_LABELS[f] || f).replace(/^[^—]*—\s*/, '');

        return `<tr data-modulo="${f}" class="modulo-filho modulo-filho-de-${m}" hidden>
          <td class="col-modulo-label col-modulo-filho-label">${labelFilho}</td>
          ${togglesFilho}
        </tr>`;
      }).join('');

      return linhaPai + linhasFilhos;
    }).join('');

  c.innerHTML = `
    <table class="planos-tabela planos-tabela-modulos">
      <thead><tr><th style="width:auto">Módulo</th>${nomesHeader}</tr></thead>
      <tbody>${rowsModulos}</tbody>
    </table>
    <div class="modulo-add-aviso-info">
      💡 Para adicionar um novo módulo, registre o ID em <code>TODOS_MODULOS</code> no código e ele aparecerá aqui automaticamente.
    </div>
  `;
}

function moduloToggle(id, modulo) {
  const lista = tabelaState.modulos[id] || [];
  const idx = lista.indexOf(modulo);
  if (idx === -1) lista.push(modulo);
  else lista.splice(idx, 1);
  tabelaState.modulos[id] = lista;

  const tabela = $('planos-modulos-container');
  const expandidos = new Set();
  tabela?.querySelectorAll('.modulo-expandir[aria-expanded="true"]').forEach(btn => {
    const pai = btn.closest('tr')?.dataset.modulo;
    if (pai) expandidos.add(pai);
  });

  renderModulosTabela();

  expandidos.forEach(pai => {
    const container = $('planos-modulos-container');
    const filhos = container?.querySelectorAll(`.modulo-filho-de-${pai}`);
    const btn = container?.querySelector(`tr[data-modulo="${pai}"] .modulo-expandir`);
    filhos?.forEach(f => { f.hidden = false; });
    btn?.setAttribute('aria-expanded', 'true');
  });
}
window.moduloToggle = moduloToggle;

function moduloExpandir(pai) {
  const tabela = $('planos-modulos-container');
  if (!tabela) return;
  const filhos = tabela.querySelectorAll(`.modulo-filho-de-${pai}`);
  const btn = tabela.querySelector(`tr[data-modulo="${pai}"] .modulo-expandir`);
  const expandido = btn?.getAttribute('aria-expanded') === 'true';
  filhos.forEach(f => { f.hidden = expandido; });
  if (btn) btn.setAttribute('aria-expanded', String(!expandido));
}
window.moduloExpandir = moduloExpandir;

async function salvarModulosPlanos() {
  const atualizacao = {};
  IDS_PLANOS_MODULOS.forEach(id => {
    if (id === 'trial') {
      atualizacao.trial = { id: 'trial', modulos: tabelaState.modulos.trial || [] };
    } else {
      atualizacao[id] = {
        ...(state.planos[id] || {}),
        modulos: tabelaState.modulos[id]
      };
    }
  });

  const modulosSistema = TODOS_MODULOS.map(id => ({ id, label: MODULOS_LABELS[id] || id }));

  try {
    await setDoc(doc(db, 'config_global', 'planos'),
      { ...state.planos, ...atualizacao, modulos_sistema: modulosSistema },
      { merge: true }
    );
    IDS_PLANOS_MODULOS.forEach(id => {
      if (!state.planos[id]) state.planos[id] = { id };
      state.planos[id].modulos = tabelaState.modulos[id] || [];
    });
    state.planos.modulos_sistema = modulosSistema;
    toast('Módulos salvos.', 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar módulos.', 'erro');
  }
}
window.salvarModulosPlanos = salvarModulosPlanos;

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
// REFERÊNCIAS DE MANUTENÇÃO
// ─────────────────────────────────────────────

const IDS_PLANOS_REF = ['trial', 'basico', 'pro', 'completo'];
const LABELS_PLANOS_REF = { trial: 'Trial', basico: 'Básico', pro: 'Pro', completo: 'Completo' };

let refState = {
  itens:  [],
  acesso: {}
};

async function carregarReferencias() {
  try {
    const snap = await getDoc(doc(db, 'config_global', 'referencias_manutencao'));
    if (snap.exists()) {
      const dados = snap.data();
      refState.itens  = (dados.itens  || []).map((item, i) => ({ ...item, _idx: i }));
      refState.acesso = dados.acesso || {};
    }
  } catch (e) {
    console.error('[Admin] Erro ao carregar referências:', e);
  }
}

function renderReferencias() {
  carregarReferencias().then(() => {
    renderRefItens();
    renderRefAcesso();
  });
}
window.renderReferencias = renderReferencias;

// ── Bloco 1: Itens ──────────────────────────

function renderRefItens() {
  const c = $('ref-itens-container');
  if (!c) return;

  const UNIDADES = ['un', 'L', 'kg', 'm'];

  const rows = refState.itens.map((item, i) => `
    <tr data-idx="${i}">
      <td><input class="input-tabela" value="${item.nome || ''}"
        oninput="refItemUpdate(${i},'nome',this.value)" placeholder="Nome do item" /></td>
      <td class="col-valor">
        <input class="input-tabela" type="number" value="${item.qtd ?? 1}"
          min="0.1" step="0.1" style="width:60px"
          oninput="refItemUpdate(${i},'qtd',parseFloat(this.value)||1)" />
      </td>
      <td class="col-valor">
        <select class="input-tabela" onchange="refItemUpdate(${i},'unidade',this.value)">
          ${UNIDADES.map(u => `<option value="${u}" ${item.unidade === u ? 'selected' : ''}>${u}</option>`).join('')}
        </select>
      </td>
      <td class="col-valor">
        <input class="input-tabela" type="number" value="${item.vida_util_km ?? 0}"
          min="0" step="100"
          oninput="refItemUpdate(${i},'vida_util_km',parseInt(this.value)||0)" />
      </td>
      <td class="col-toggle-centro">
        <button class="cell-toggle-btn inativo" onclick="refItemRemover(${i})" title="Remover">✕</button>
      </td>
    </tr>`).join('');

  c.innerHTML = `
    <table class="planos-tabela">
      <thead>
        <tr>
          <th style="width:auto">Item</th>
          <th class="col-valor">Qtd típica</th>
          <th class="col-valor">Unidade</th>
          <th class="col-valor">Vida útil (KM)</th>
          <th class="col-toggle-centro">Remover</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="padding: var(--gap-md) var(--gap-xl) var(--gap-lg); display:flex; justify-content:flex-start">
      <button class="btn btn-secondary btn-sm" onclick="refItemAdicionar()">+ Adicionar item</button>
    </div>`;
}

function refItemUpdate(idx, campo, valor) {
  if (refState.itens[idx]) refState.itens[idx][campo] = valor;
}
window.refItemUpdate = refItemUpdate;

function refItemRemover(idx) {
  refState.itens.splice(idx, 1);
  renderRefItens();
}
window.refItemRemover = refItemRemover;

function refItemAdicionar() {
  refState.itens.push({ nome: '', qtd: 1, unidade: 'un', vida_util_km: 5000 });
  renderRefItens();
  setTimeout(() => {
    const inputs = $('ref-itens-container')?.querySelectorAll('input.input-tabela');
    inputs?.[inputs.length - 3]?.focus();
  }, 50);
}
window.refItemAdicionar = refItemAdicionar;

async function salvarItensRef() {
  const itens = refState.itens
    .filter(i => i.nome?.trim())
    .map(({ nome, qtd, unidade, vida_util_km }) => ({
      nome: nome.trim(), qtd: Number(qtd) || 1, unidade: unidade || 'un', vida_util_km: Number(vida_util_km) || 0
    }));

  try {
    await setDoc(doc(db, 'config_global', 'referencias_manutencao'), { itens }, { merge: true });
    refState.itens = itens.map((item, i) => ({ ...item, _idx: i }));
    toast('Itens de referência salvos.', 'sucesso');
    renderRefItens();
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar itens.', 'erro');
  }
}
window.salvarItensRef = salvarItensRef;

// ── Bloco 2: Acesso por plano ────────────────

function renderRefAcesso() {
  const c = $('ref-acesso-container');
  if (!c) return;

  const DEFAULTS = {
    trial:    { linhas_visiveis: 999, copiar_liberado: true  },
    basico:   { linhas_visiveis: 3,   copiar_liberado: false },
    pro:      { linhas_visiveis: 999, copiar_liberado: true  },
    completo: { linhas_visiveis: 999, copiar_liberado: true  }
  };

  const rows = IDS_PLANOS_REF.map(id => {
    const def = DEFAULTS[id];
    const cfg = refState.acesso[id] || def;
    const liberado = cfg.copiar_liberado ?? def.copiar_liberado;

    return `<tr>
      <td><strong>${LABELS_PLANOS_REF[id]}</strong></td>
      <td class="col-valor">
        <input class="input-tabela" type="number" value="${cfg.linhas_visiveis ?? def.linhas_visiveis}"
          min="0" max="999" step="1" style="width:70px"
          oninput="refAcessoUpdate('${id}','linhas_visiveis',parseInt(this.value)||0)" />
      </td>
      <td class="col-toggle-centro">
        <button class="cell-toggle-btn ${liberado ? 'ativo' : 'inativo'}"
          onclick="refToggleCopiar('${id}')">${liberado ? '✓' : '○'}</button>
      </td>
    </tr>`;
  }).join('');

  c.innerHTML = `
    <table class="planos-tabela">
      <thead>
        <tr>
          <th style="width:auto">Plano</th>
          <th class="col-valor">Linhas visíveis</th>
          <th class="col-toggle-centro">Copiar para meus itens</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="padding: var(--gap-sm) var(--gap-xl); font-size:11px; color:var(--text-muted)">
      💡 "Linhas visíveis": quantas linhas o plano vê sem blur. Use 999 para liberar todas.
    </div>`;
}

function refAcessoUpdate(plano, campo, valor) {
  if (!refState.acesso[plano]) refState.acesso[plano] = {};
  refState.acesso[plano][campo] = valor;
}
window.refAcessoUpdate = refAcessoUpdate;

function refToggleCopiar(plano) {
  if (!refState.acesso[plano]) {
    const DEFAULTS = { trial: true, basico: false, pro: true, completo: true };
    refState.acesso[plano] = { copiar_liberado: !DEFAULTS[plano] };
  } else {
    refState.acesso[plano].copiar_liberado = !refState.acesso[plano].copiar_liberado;
  }
  renderRefAcesso();
}
window.refToggleCopiar = refToggleCopiar;

async function salvarAcessoRef() {
  try {
    await setDoc(doc(db, 'config_global', 'referencias_manutencao'),
      { acesso: refState.acesso },
      { merge: true }
    );
    toast('Acesso por plano salvo.', 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar acesso.', 'erro');
  }
}
window.salvarAcessoRef = salvarAcessoRef;

// ─────────────────────────────────────────────
// ACESSO TEMPORÁRIO EM LOTE
// ─────────────────────────────────────────────

function renderAcessoTemporario() {
  const c = $('acesso-temporario-container');
  if (!c) return;

  const opcoesModulos = TODOS_MODULOS.map(id =>
    `<option value="${id}">${MODULOS_LABELS[id] || id}</option>`
  ).join('');

  c.innerHTML = `
    <div class="acesso-temp-form">
      <div class="acesso-temp-row">
        <div class="form-group">
          <label class="form-label">Módulo a liberar</label>
          <select class="select" id="at-modulo">${opcoesModulos}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Duração (dias)</label>
          <input type="number" class="input" id="at-dias" min="1" max="365" value="7" placeholder="Ex: 7" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Planos elegíveis</label>
        <div class="acesso-temp-planos">
          ${IDS_PLANOS_MODULOS.map(id => {
            const label = id === 'trial' ? 'Trial' : (state.planos[id]?.nome || id);
            return `<label class="acesso-temp-plano-label">
              <input type="checkbox" value="${id}" id="at-plano-${id}" />
              ${label}
            </label>`;
          }).join('')}
        </div>
      </div>
      <div class="acesso-temp-preview" id="at-preview" hidden>
        <span id="at-preview-texto"></span>
      </div>
      <div class="acesso-temp-footer">
        <button class="btn btn-secondary" onclick="previewAcessoTemporario()">Visualizar impacto</button>
        <button class="btn btn-primary" id="at-btn-aplicar" onclick="aplicarAcessoTemporario()" disabled>Aplicar acesso temporário</button>
      </div>
    </div>
  `;
}
window.renderAcessoTemporario = renderAcessoTemporario;

function previewAcessoTemporario() {
  const modulo  = $('at-modulo')?.value;
  const dias    = parseInt($('at-dias')?.value) || 0;
  const planos  = IDS_PLANOS_MODULOS.filter(id => $(`at-plano-${id}`)?.checked);

  if (!modulo || dias < 1 || planos.length === 0) {
    toast('Selecione módulo, duração e pelo menos um plano.', 'aviso');
    return;
  }

  const afetados = state.usuarios.filter(u => u.role !== 'admin' && planos.includes(u.plano));

  const preview    = $('at-preview');
  const texto      = $('at-preview-texto');
  const btnAplicar = $('at-btn-aplicar');

  if (preview && texto) {
    const labelModulo  = MODULOS_LABELS[modulo] || modulo;
    const labelsPlanos = planos.map(id => id === 'trial' ? 'Trial' : (state.planos[id]?.nome || id)).join(', ');
    texto.textContent = `${afetados.length} usuário(s) dos planos [${labelsPlanos}] receberão acesso ao módulo "${labelModulo}" por ${dias} dia(s).`;
    preview.hidden = false;
  }

  if (btnAplicar) btnAplicar.disabled = afetados.length === 0;
}
window.previewAcessoTemporario = previewAcessoTemporario;

async function aplicarAcessoTemporario() {
  const modulo = $('at-modulo')?.value;
  const dias   = parseInt($('at-dias')?.value) || 0;
  const planos = IDS_PLANOS_MODULOS.filter(id => $(`at-plano-${id}`)?.checked);

  if (!modulo || dias < 1 || planos.length === 0) {
    toast('Preencha todos os campos antes de aplicar.', 'aviso');
    return;
  }

  const afetados = state.usuarios.filter(u => u.role !== 'admin' && planos.includes(u.plano));

  if (afetados.length === 0) {
    toast('Nenhum usuário encontrado para os planos selecionados.', 'aviso');
    return;
  }

  const expira = new Date();
  expira.setDate(expira.getDate() + dias);
  const expira_em = Timestamp.fromDate(expira);

  const btn = $('at-btn-aplicar');
  if (btn) { btn.disabled = true; btn.textContent = 'Aplicando...'; }

  let sucessos = 0, erros = 0;

  for (const u of afetados) {
    try {
      const existentes      = (u.modulos_temporarios || []).filter(t => t.modulo !== modulo);
      const novosTemporarios = [...existentes, { modulo, expira_em }];
      await updateDoc(doc(db, 'users', u.uid), {
        modulos_temporarios: novosTemporarios,
        atualizado_em: serverTimestamp()
      });
      u.modulos_temporarios = novosTemporarios;
      sucessos++;
    } catch (e) {
      console.error(`[Admin] Erro ao aplicar acesso temporário para ${u.uid}:`, e);
      erros++;
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Aplicar acesso temporário'; }

  if (erros === 0) {
    toast(`Acesso temporário aplicado para ${sucessos} usuário(s).`, 'sucesso');
  } else {
    toast(`Aplicado para ${sucessos} usuário(s). ${erros} erro(s).`, 'aviso');
  }

  const preview = $('at-preview');
  if (preview) preview.hidden = true;
  if (btn) btn.disabled = true;
}
window.aplicarAcessoTemporario = aplicarAcessoTemporario;

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

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      fecharModalUsuario();
      fecharMenu();
    }
  });

  $('modal-usuario').addEventListener('click', e => {
    if (e.target === $('modal-usuario')) fecharModalUsuario();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) fecharMenu();
  });
}
