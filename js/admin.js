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

// Módulos do sistema — fonte da verdade é este array no código.
// Para adicionar um módulo novo: inclua o ID aqui + em MODULOS_LABELS,
// crie as páginas correspondentes e publique. Ele aparecerá automaticamente
// no admin para você definir em quais planos fica disponível.
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

// Features padrão no formato novo: lista global com flags por plano
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
      const dados = snap.data();

      // Migração: se features ainda estão no formato antigo por plano,
      // converte para o novo formato global
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

// Converte formato antigo {basico:[{ok,text}], pro:[...]} → novo [{text, basico, pro, completo}]
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

  if (novoPlano === 'trial') {
    dados.plano_expira_em = null;
  }

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
// PLANOS — NOVA ESTRUTURA
// ─────────────────────────────────────────────

// Estado local da tabela (editável antes de salvar)
let tabelaState = {
  configuracoes: {},  // { basico: {nome, mensal, anual, destaque, trial_dias}, ... }
  features: [],       // [{ text, basico, pro, completo }, ...]
  modulos: {}         // { basico: ['home', ...], pro: [...], completo: [...] }
};

function renderPlanos() {
  // Clona estado atual do Firestore para edição local
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

  // Features: usa o novo formato global ou migra do antigo
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
      <thead>
        <tr>
          <th style="width:200px"></th>
          ${nomesHeader}
        </tr>
      </thead>
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
  // nome: re-render só no onblur para não destruir o foco durante digitação
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
      <thead>
        <tr>
          <th style="width:auto">Funcionalidade</th>
          ${nomesHeader}
        </tr>
      </thead>
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
  // Foca no último input adicionado
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
    state.planos.features_global = features;
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

  const nomesHeader = IDS_PLANOS.map(id =>
    `<th class="col-plano-mini">${tabelaState.configuracoes[id].nome || id}</th>`
  ).join('');

  const rowsModulos = TODOS_MODULOS.map(m => {
    const toggles = IDS_PLANOS.map(id => {
      const ativo = tabelaState.modulos[id].includes(m);
      return `<td class="col-toggle-centro">
        <button class="cell-toggle-btn ${ativo ? 'ativo' : 'inativo'}"
          onclick="moduloToggle('${id}','${m}')">${ativo ? '✓' : '○'}</button>
      </td>`;
    }).join('');

    return `<tr data-modulo="${m}">
      <td class="col-modulo-label">${MODULOS_LABELS[m] || m}</td>
      <td class="col-modulo-id"><code class="modulo-id-code">${m}</code></td>
      ${toggles}
    </tr>`;
  }).join('');

  c.innerHTML = `
    <table class="planos-tabela planos-tabela-modulos">
      <thead>
        <tr>
          <th style="width:auto">Módulo</th>
          <th class="col-modulo-id-th">ID no sistema</th>
          ${nomesHeader}
        </tr>
      </thead>
      <tbody>
        ${rowsModulos}
      </tbody>
    </table>
    <div class="modulo-add-aviso-info">
      💡 Para adicionar um novo módulo, registre o ID em <code>TODOS_MODULOS</code> no código e ele aparecerá aqui automaticamente.
    </div>
  `;
}

function moduloToggle(id, modulo) {
  const idx = tabelaState.modulos[id].indexOf(modulo);
  if (idx === -1) tabelaState.modulos[id].push(modulo);
  else tabelaState.modulos[id].splice(idx, 1);
  renderModulosTabela();
}
window.moduloToggle = moduloToggle;

async function salvarModulosPlanos() {
  const atualizacao = {};
  IDS_PLANOS.forEach(id => {
    atualizacao[id] = {
      ...(state.planos[id] || {}),
      modulos: tabelaState.modulos[id]
    };
  });

  // Persiste lista master para que módulos extras sobrevivam entre sessões
  const modulosSistema = TODOS_MODULOS.map(id => ({ id, label: MODULOS_LABELS[id] || id }));

  try {
    await setDoc(doc(db, 'config_global', 'planos'),
      { ...state.planos, ...atualizacao, modulos_sistema: modulosSistema },
      { merge: true }
    );
    IDS_PLANOS.forEach(id => { state.planos[id].modulos = tabelaState.modulos[id]; });
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
