// ─────────────────────────────────────────────
// DriveFinance — home.js
// Dados e interações da tela principal
// ─────────────────────────────────────────────

import {
  exigirLogin,
  getPerfil,
  calcularMetaDia,
  getLancamentoDia,
  getLancamentosMes,
  getDespesasAtivas,
  getDiasTrabalhoMes,
  getVeiculos,
  formatReal,
  saudacao,
  logout,
  toast
} from './app.js';

const PAGINAS_PRONTAS = new Set(['home.html']);

const state = {
  user: null,
  perfil: null,
  carregando: false
};

const $ = (id) => document.getElementById(id);

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function somaCorridas(lancamento) {
  if (!lancamento) return 0;

  const app = Array.isArray(lancamento.corridas_app)
    ? lancamento.corridas_app.reduce((total, corrida) => total + numberValue(corrida.valor), 0)
    : 0;

  const particular = Array.isArray(lancamento.corridas_particular)
    ? lancamento.corridas_particular.reduce((total, corrida) => total + numberValue(corrida.valor), 0)
    : 0;

  return app + particular;
}

function primeiroNome(nome = '') {
  const limpo = nome.trim();
  return limpo ? limpo.split(/\s+/)[0] : 'motorista';
}

function iniciais(nome = '', email = '') {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return `${partes[0][0]}${partes.at(-1)[0]}`.toUpperCase();
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase() || 'DF';
}

function dataExtenso(data = new Date()) {
  const texto = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  }).format(data);

  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function nomeMes(data = new Date()) {
  const texto = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric'
  }).format(data);

  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function timestampToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function infoPlano(perfil = {}) {
  const plano = String(perfil.plano || 'trial').toLowerCase();

  if (plano === 'trial') {
    const inicio = timestampToDate(perfil.trial_inicio || perfil.criado_em);
    if (!inicio) return { label: 'Plano Trial', sidebar: 'Trial • 15 dias', expired: false };

    const fim = new Date(inicio);
    fim.setDate(fim.getDate() + 15);
    const hoje = new Date();
    const dias = Math.max(0, Math.ceil((fim - hoje) / 86400000));
    const expired = hoje >= fim;

    return {
      label: expired ? 'Trial expirado' : `Trial • ${dias} ${dias === 1 ? 'dia' : 'dias'}`,
      sidebar: expired ? 'Trial expirado' : `Trial • ${dias} dias restantes`,
      expired
    };
  }

  const nomes = {
    basico: 'Plano Básico',
    pro: 'Plano Pro',
    completo: 'Plano Completo'
  };

  return {
    label: nomes[plano] || `Plano ${plano}`,
    sidebar: nomes[plano] || `Plano ${plano}`,
    expired: false
  };
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function setWidth(id, percent) {
  const element = $(id);
  if (!element) return;
  const safe = Math.max(0, Math.min(percent, 100));
  requestAnimationFrame(() => {
    element.style.width = `${safe}%`;
  });
}

function setStatusMeta(percent, meta, totalDespesas) {
  const element = $('goal-status');
  element.className = 'goal-status badge';

  if (totalDespesas <= 0) {
    element.textContent = 'Configure suas despesas';
    element.classList.add('badge-aviso');
    return;
  }

  if (meta <= 0 || percent >= 100) {
    element.textContent = 'Meta concluída';
    element.classList.add('badge-superavit');
    return;
  }

  if (percent > 0) {
    element.textContent = 'Em andamento';
    element.classList.add('badge-aviso');
    return;
  }

  element.textContent = 'Pronto para começar';
  element.classList.add('badge-pago');
}

function atualizarAcessos(perfil) {
  const modulos = new Set(perfil?.modulos_ativos || []);
  const admin = perfil?.role === 'admin';

  document.querySelectorAll('.module-link').forEach((button) => {
    const modulo = button.dataset.module;
    const publico = button.dataset.publicModule === 'true';
    const alias = modulo?.replaceAll('-', '_');
    const permitido = admin || publico || modulos.has(modulo) || modulos.has(alias);

    button.classList.toggle('is-locked', !permitido);
    button.dataset.allowed = permitido ? 'true' : 'false';

    if (!permitido) {
      button.setAttribute('aria-label', `${button.textContent.trim()} — disponível em outro plano`);
    }
  });

  $('admin-link').hidden = !admin;
  if (admin) $('admin-link').dataset.allowed = 'true';
}

function atualizarChecklist({ perfil, veiculos, despesas, lancamentosMes }) {
  const checks = {
    profile: numberValue(perfil?.salario_liquido) > 0,
    vehicle: veiculos.length > 0,
    expenses: despesas.length > 0,
    launch: lancamentosMes.length > 0
  };

  let completos = 0;
  Object.entries(checks).forEach(([step, complete]) => {
    const item = document.querySelector(`[data-step="${step}"]`);
    item?.classList.toggle('is-complete', complete);
    if (complete) completos += 1;
  });

  setText('setup-count', `${completos}/4`);
  setWidth('setup-fill', completos * 25);
}

function renderResumo({
  perfil,
  metaDia,
  lancamentoHoje,
  lancamentosMes,
  despesas,
  diasTrabalho,
  veiculos
}) {
  const agora = new Date();
  const ganhoHoje = somaCorridas(lancamentoHoje);
  const ganhoMes = lancamentosMes.reduce((total, lancamento) => total + somaCorridas(lancamento), 0);
  const totalDespesas = despesas.reduce((total, despesa) => total + numberValue(despesa.valor), 0);
  const faltanteHoje = Math.max(0, metaDia - ganhoHoje);
  const faltanteMes = Math.max(0, totalDespesas - ganhoMes);
  const saldoMes = ganhoMes - totalDespesas;
  const diasRestantes = diasTrabalho.filter((dia) => dia >= agora.getDate()).length;
  const progressoHoje = metaDia > 0 ? Math.min((ganhoHoje / metaDia) * 100, 100) : (ganhoHoje > 0 ? 100 : 0);
  const coberturaMes = totalDespesas > 0 ? Math.min((ganhoMes / totalDespesas) * 100, 100) : 0;

  const nome = perfil?.nome || state.user?.displayName || '';
  const email = perfil?.email || state.user?.email || '';
  const avatar = iniciais(nome, email);
  const plano = infoPlano(perfil);

  setText('greeting', saudacao());
  setText('first-name', primeiroNome(nome));
  setText('today-label', dataExtenso(agora));
  setText('month-chip', nomeMes(agora));

  setText('sidebar-name', nome || 'Usuário DriveFinance');
  setText('sidebar-email', email || 'Conta autenticada');
  setText('sidebar-avatar', avatar);
  setText('topbar-avatar', avatar);
  setText('plan-badge', plano.label);
  setText('sidebar-plan', plano.sidebar);

  $('plan-badge').classList.toggle('is-expired', plano.expired);

  setText('goal-value', formatReal(metaDia));
  setText('earned-today', formatReal(ganhoHoje));
  setText('remaining-today', formatReal(faltanteHoje));
  setText('remaining-workdays', `${diasRestantes} ${diasRestantes === 1 ? 'dia de trabalho restante' : 'dias de trabalho restantes'}`);
  setText('progress-percent', `${Math.round(progressoHoje)}%`);
  $('progress-ring').style.setProperty('--progress', `${progressoHoje * 3.6}deg`);
  $('progress-ring').setAttribute('aria-label', `${Math.round(progressoHoje)}% da meta concluída`);
  setWidth('goal-progress-fill', progressoHoje);
  setStatusMeta(progressoHoje, metaDia, totalDespesas);

  setText('month-earned', formatReal(ganhoMes));
  setText('month-expenses', formatReal(totalDespesas));
  setText('month-remaining', formatReal(faltanteMes));
  setText('workdays-count', String(diasRestantes));

  setText('coverage-percent', `${Math.round(coberturaMes)}%`);
  setWidth('coverage-fill', coberturaMes);
  setText('list-earned', formatReal(ganhoMes));
  setText('list-expenses', formatReal(totalDespesas));
  setText('month-balance', formatReal(saldoMes));
  $('month-balance').classList.toggle('teal-text', saldoMes >= 0);
  $('month-balance').classList.toggle('coral-text', saldoMes < 0);

  atualizarAcessos(perfil);
  atualizarChecklist({ perfil, veiculos, despesas, lancamentosMes });
}

function mostrarErro(error) {
  console.error('[DriveFinance/Home]', error);
  $('home-error').hidden = false;
  setText('home-error-message', error?.message || 'Verifique sua conexão e tente novamente.');
}

function ocultarErro() {
  $('home-error').hidden = true;
}

function mostrarApp() {
  $('home-app').hidden = false;
  requestAnimationFrame(() => {
    $('loading-screen').classList.add('is-hidden');
    setTimeout(() => {
      $('loading-screen').hidden = true;
    }, 260);
  });
}

async function carregarHome({ silencioso = false } = {}) {
  if (state.carregando) return;
  state.carregando = true;
  ocultarErro();

  const refresh = $('btn-refresh');
  refresh?.classList.add('is-loading');
  refresh?.setAttribute('disabled', '');

  try {
    state.user = state.user || await exigirLogin();

    const perfil = await getPerfil(state.user.uid);
    state.perfil = perfil || {
      nome: state.user.displayName || '',
      email: state.user.email || '',
      role: 'user',
      plano: 'trial',
      modulos_ativos: ['home', 'lancamentos', 'despesas', 'historico'],
      salario_liquido: 0
    };

    const hoje = new Date();
    const [
      metaDia,
      lancamentoHoje,
      lancamentosMes,
      despesas,
      diasTrabalho,
      veiculos
    ] = await Promise.all([
      calcularMetaDia(state.user.uid, hoje),
      getLancamentoDia(state.user.uid, hoje),
      getLancamentosMes(state.user.uid, hoje),
      getDespesasAtivas(state.user.uid),
      getDiasTrabalhoMes(state.user.uid, hoje),
      getVeiculos(state.user.uid)
    ]);

    renderResumo({
      perfil: state.perfil,
      metaDia,
      lancamentoHoje,
      lancamentosMes,
      despesas,
      diasTrabalho,
      veiculos
    });

    if (silencioso) toast('Dados atualizados.', 'sucesso');
  } catch (error) {
    mostrarErro(error);
    if (silencioso) toast('Não foi possível atualizar os dados.', 'erro');
  } finally {
    state.carregando = false;
    refresh?.classList.remove('is-loading');
    refresh?.removeAttribute('disabled');
    mostrarApp();
  }
}

function abrirMenu() {
  $('sidebar').classList.add('aberta');
  $('sidebar-overlay').classList.add('visivel');
  $('sidebar-overlay').setAttribute('aria-hidden', 'false');
  $('btn-menu').setAttribute('aria-expanded', 'true');
  document.body.classList.add('menu-open');
}

function fecharMenu() {
  $('sidebar').classList.remove('aberta');
  $('sidebar-overlay').classList.remove('visivel');
  $('sidebar-overlay').setAttribute('aria-hidden', 'true');
  $('btn-menu').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open');
}

function handleModuleNavigation(button) {
  if (button.dataset.allowed !== 'true') {
    toast('Este módulo não está disponível no seu plano atual.', 'aviso');
    return;
  }

  const page = button.dataset.page;
  if (!PAGINAS_PRONTAS.has(page)) {
    toast('Este módulo será liberado nas próximas etapas do projeto.', 'info');
    fecharMenu();
    return;
  }

  window.location.href = page;
}

function bindEvents() {
  $('btn-menu').addEventListener('click', abrirMenu);
  $('sidebar-overlay').addEventListener('click', fecharMenu);
  $('topbar-avatar').addEventListener('click', abrirMenu);
  $('btn-refresh').addEventListener('click', () => carregarHome({ silencioso: true }));
  $('btn-retry').addEventListener('click', () => carregarHome({ silencioso: true }));

  $('btn-logout').addEventListener('click', async () => {
    try {
      await logout();
    } catch (error) {
      console.error('[DriveFinance/Logout]', error);
      toast('Não foi possível sair agora. Tente novamente.', 'erro');
    }
  });

  document.querySelectorAll('.module-link').forEach((button) => {
    button.addEventListener('click', () => handleModuleNavigation(button));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') fecharMenu();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) fecharMenu();
  });
}

bindEvents();
carregarHome();
