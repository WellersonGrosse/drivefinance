import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// AUTENTICAÇÃO
// ─────────────────────────────────────────────

export { onAuthStateChanged, auth };

export async function loginEmail(email, senha) {
  return await signInWithEmailAndPassword(auth, email, senha);
}

export async function cadastrarEmail(email, senha, nome, { telefone, data_nascimento } = {}) {
  const cred = await createUserWithEmailAndPassword(auth, email, senha);
  await updateProfile(cred.user, { displayName: nome });
  await criarPerfilUsuario(cred.user.uid, nome, email, { telefone, data_nascimento });
  return cred;
}

export async function logout() {
  await signOut(auth);
  window.location.href = "login.html";
}

export function usuarioAtual() {
  return auth.currentUser;
}

// Redireciona para login se não estiver autenticado
export function exigirLogin() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (!user) {
        window.location.href = "login.html";
      } else {
        resolve(user);
      }
    });
  });
}

// ─────────────────────────────────────────────
// PERFIL DO USUÁRIO
// ─────────────────────────────────────────────

// Cria perfil inicial no Firestore ao cadastrar.
// Campos protegidos (role, plano, modulos_ativos, trial_inicio) são
// definidos aqui e bloqueados para alteração pelo usuário via regras.
// telefone e data_nascimento são opcionais — enviados apenas se presentes.
async function criarPerfilUsuario(uid, nome, email, { telefone, data_nascimento } = {}) {
  const perfil = {
    nome,
    email,
    role: "user",
    plano: "trial",
    modulos_ativos: [
      "home",
      "lancamentos",
      "despesas",
      "historico"
    ],
    salario_liquido: 0,
    trial_inicio: serverTimestamp(),
    criado_em: serverTimestamp()
  };

  // Inclui campos opcionais apenas se fornecidos — mantém compatibilidade
  // com a regra novoUsuarioValido() que usa keys().hasOnly()
  if (telefone)       perfil.telefone       = telefone;
  if (data_nascimento) perfil.data_nascimento = data_nascimento;

  await setDoc(doc(db, "users", uid), perfil);
}

// Busca perfil do usuário no Firestore
export async function getPerfil(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// Atualiza apenas os campos pessoais permitidos.
// Nunca expõe role, plano, modulos_ativos ou trial_inicio ao caller.
export async function updatePerfil(uid, dados) {
  const CAMPOS_PERMITIDOS = ["nome", "telefone", "data_nascimento", "salario_liquido", "atualizado_em"];
  const dadosFiltrados = Object.fromEntries(
    Object.entries(dados).filter(([chave]) => CAMPOS_PERMITIDOS.includes(chave))
  );
  if (Object.keys(dadosFiltrados).length === 0) return;
  await updateDoc(doc(db, "users", uid), {
    ...dadosFiltrados,
    atualizado_em: serverTimestamp()
  });
}

// ─────────────────────────────────────────────
// CONTROLE DE ACESSO — função central
// ─────────────────────────────────────────────

// Converte qualquer formato de timestamp Firestore para Date
function timestampParaDate(valor) {
  if (!valor) return null;
  if (typeof valor.toDate === "function") return valor.toDate();
  if (valor.seconds) return new Date(valor.seconds * 1000);
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Retorna quantos dias de trial o plano deste perfil oferece
// Lê de config_global/planos se disponível; caso contrário, usa 15
async function getTrialDias() {
  try {
    const snap = await getDoc(doc(db, 'config_global', 'planos'));
    if (snap.exists()) {
      // Usa trial_dias do plano básico como referência (ou o primeiro disponível)
      const dados = snap.data();
      return dados.basico?.trial_dias ?? dados.pro?.trial_dias ?? 15;
    }
  } catch { /* silencioso */ }
  return 15;
}

// Versão síncrona para uso interno com valor já resolvido
function calcularFimTrial(perfil, trialDias = 15) {
  const inicio = timestampParaDate(perfil.trial_inicio || perfil.criado_em);
  if (!inicio) return null;
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + trialDias);
  return fim;
}

// Verifica se o trial do perfil ainda está ativo
function trialAtivo(perfil, trialDias = 15) {
  const fim = calcularFimTrial(perfil, trialDias);
  return fim ? new Date() < fim : false;
}

// Retorna quantos dias restam no trial (0 se expirado)
export function diasRestantesTrial(perfil, trialDias = 15) {
  const fim = calcularFimTrial(perfil, trialDias);
  if (!fim) return 0;
  return Math.max(0, Math.ceil((fim - new Date()) / 86400000));
}

// Verifica se o usuário tem acesso ativo (plano válido ou trial vigente).
// Esta é a função que CADA PÁGINA deve chamar ao carregar.
// Retorna: { permitido: boolean, motivo: string }
export async function verificarAcesso(uid) {
  let perfil;
  try {
    perfil = await getPerfil(uid);
  } catch {
    // Falha na rede: bloqueia por padrão — nunca libera por erro
    return { permitido: false, motivo: "erro_rede", perfil: null };
  }

  if (!perfil) {
    return { permitido: false, motivo: "sem_perfil", perfil: null };
  }

  if (perfil.role === "admin") {
    return { permitido: true, motivo: "admin", perfil };
  }

  if (perfil.plano === "trial") {
    const trialDias = await getTrialDias();
    if (trialAtivo(perfil, trialDias)) {
      return { permitido: true, motivo: "trial_ativo", perfil };
    }
    return { permitido: false, motivo: "trial_expirado", perfil };
  }

  // Plano pago: verifica se plano_expira_em ainda está no futuro
  if (perfil.plano_expira_em) {
    const expira = timestampParaDate(perfil.plano_expira_em);
    if (expira && new Date() < expira) {
      return { permitido: true, motivo: "plano_ativo", perfil };
    }
    return { permitido: false, motivo: "plano_expirado", perfil };
  }

  // Plano pago sem data de expiração é considerado inválido.
  // O painel admin sempre grava plano_expira_em ao ativar um plano.
  return { permitido: false, motivo: "plano_expirado", perfil };
}

// Verifica se usuário tem acesso a um módulo específico
export async function temAcesso(uid, modulo) {
  const { permitido, perfil } = await verificarAcesso(uid);
  if (!permitido || !perfil) return false;
  if (perfil.role === "admin") return true;
  return perfil.modulos_ativos?.includes(modulo) ?? false;
}

// Verifica se usuário é admin
export async function isAdmin(uid) {
  const perfil = await getPerfil(uid);
  return perfil?.role === "admin";
}

// ─────────────────────────────────────────────
// CONFIGURAÇÕES DO USUÁRIO
// ─────────────────────────────────────────────

export async function getConfig(uid) {
  const snap = await getDoc(doc(db, "users", uid, "config", "settings"));
  if (snap.exists()) return snap.data();

  const padrao = {
    dias_trabalho: [0, 1, 2, 3, 4, 5, 6],
    plataformas: ["Uber"],
    superavit: true,
    deficit: true,
    atualizado_em: serverTimestamp()
  };
  await setDoc(doc(db, "users", uid, "config", "settings"), padrao);
  return padrao;
}

export async function saveConfig(uid, dados) {
  await setDoc(
    doc(db, "users", uid, "config", "settings"),
    { ...dados, atualizado_em: serverTimestamp() },
    { merge: true }
  );
}

// ─────────────────────────────────────────────
// VEÍCULOS
// ─────────────────────────────────────────────

export async function getVeiculos(uid) {
  const snap = await getDocs(collection(db, "users", uid, "veiculos"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addVeiculo(uid, dados) {
  return await addDoc(collection(db, "users", uid, "veiculos"), {
    ...dados,
    criado_em: serverTimestamp()
  });
}

export async function updateVeiculo(uid, veiculoId, dados) {
  await updateDoc(doc(db, "users", uid, "veiculos", veiculoId), dados);
}

export async function deleteVeiculo(uid, veiculoId) {
  await deleteDoc(doc(db, "users", uid, "veiculos", veiculoId));
}

// ─────────────────────────────────────────────
// DESPESAS
// ─────────────────────────────────────────────

export async function getDespesas(uid) {
  const snap = await getDocs(
    query(collection(db, "users", uid, "despesas"), orderBy("vencimento_dia"))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addDespesa(uid, dados) {
  return await addDoc(collection(db, "users", uid, "despesas"), {
    ...dados,
    criado_em: serverTimestamp()
  });
}

export async function updateDespesa(uid, despesaId, dados) {
  await updateDoc(doc(db, "users", uid, "despesas", despesaId), dados);
}

export async function deleteDespesa(uid, despesaId) {
  await deleteDoc(doc(db, "users", uid, "despesas", despesaId));
}

export async function getDespesasAtivas(uid) {
  const todas = await getDespesas(uid);
  const hoje = new Date();
  const mesAtual = hoje.getMonth() + 1;
  const anoAtual = hoje.getFullYear();

  return todas.filter(d => {
    if (d.tipo === "fixa") return true;
    if (d.tipo === "parcelamento") {
      if (d.parcela_atual > d.parcela_total) return false;
      if (d.ano_inicio && d.mes_inicio) {
        const mesEncerramento = d.mes_inicio + d.parcela_total - 1;
        const anoEncerramento = d.ano_inicio + Math.floor((d.mes_inicio + d.parcela_total - 2) / 12);
        if (anoAtual > anoEncerramento) return false;
        if (anoAtual === anoEncerramento && mesAtual > (mesEncerramento % 12 || 12)) return false;
      }
      return true;
    }
    return true;
  });
}

// ─────────────────────────────────────────────
// LANÇAMENTOS DIÁRIOS
// ─────────────────────────────────────────────

function chaveAnoMes(data = new Date()) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  return `${ano}-${mes}`;
}

function chaveDia(data = new Date()) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

export async function getLancamentoDia(uid, data = new Date()) {
  const snap = await getDoc(
    doc(db, "users", uid, "lancamentos", chaveAnoMes(data), "dias", chaveDia(data))
  );
  return snap.exists() ? snap.data() : null;
}

export async function saveLancamentoDia(uid, dados, data = new Date()) {
  await setDoc(
    doc(db, "users", uid, "lancamentos", chaveAnoMes(data), "dias", chaveDia(data)),
    { ...dados, atualizado_em: serverTimestamp() },
    { merge: true }
  );
}

export async function getLancamentosMes(uid, data = new Date()) {
  const snap = await getDocs(
    collection(db, "users", uid, "lancamentos", chaveAnoMes(data), "dias")
  );
  return snap.docs.map(d => ({ dia: d.id, ...d.data() }));
}

// ─────────────────────────────────────────────
// CUSTO OPERACIONAL
// ─────────────────────────────────────────────

export async function getCustoOperacional(uid) {
  const snap = await getDocs(collection(db, "users", uid, "custo_operacional"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addCustoOperacional(uid, dados) {
  return await addDoc(collection(db, "users", uid, "custo_operacional"), {
    ...dados,
    criado_em: serverTimestamp()
  });
}

export async function updateCustoOperacional(uid, itemId, dados) {
  await updateDoc(doc(db, "users", uid, "custo_operacional", itemId), dados);
}

export async function deleteCustoOperacional(uid, itemId) {
  await deleteDoc(doc(db, "users", uid, "custo_operacional", itemId));
}

// ─────────────────────────────────────────────
// CÁLCULO DE META DIÁRIA
// ─────────────────────────────────────────────

export async function getDiasTrabalhoMes(uid, data = new Date()) {
  const config = await getConfig(uid);
  const diasSemana = config.dias_trabalho;

  const ano = data.getFullYear();
  const mes = data.getMonth();
  const totalDias = new Date(ano, mes + 1, 0).getDate();

  const dias = [];
  for (let d = 1; d <= totalDias; d++) {
    const diaSemana = new Date(ano, mes, d).getDay();
    if (diasSemana.includes(diaSemana)) dias.push(d);
  }
  return dias;
}

export async function calcularMetaDia(uid, data = new Date()) {
  const config = await getConfig(uid);
  const despesas = await getDespesasAtivas(uid);
  const lancamentosMes = await getLancamentosMes(uid, data);
  const diasTrabalho = await getDiasTrabalhoMes(uid, data);

  const hoje = data.getDate();
  const totalMensal = despesas.reduce((acc, d) => acc + (d.valor || 0), 0);
  const diasRestantes = diasTrabalho.filter(d => d >= hoje);

  if (diasRestantes.length === 0) return 0;

  const ganhoAcumulado = lancamentosMes.reduce((acc, l) => {
    const ganhoApp = (l.corridas_app || []).reduce((s, c) => s + (c.valor || 0), 0);
    const ganhoParticular = (l.corridas_particular || []).reduce((s, c) => s + (c.valor || 0), 0);
    return acc + ganhoApp + ganhoParticular;
  }, 0);

  const faltante = totalMensal - ganhoAcumulado;
  const metaDia = faltante / diasRestantes.length;

  return Math.max(0, metaDia);
}

// ─────────────────────────────────────────────
// UTILITÁRIOS GERAIS
// ─────────────────────────────────────────────

export function formatReal(valor) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(valor || 0);
}

export function formatData(str) {
  if (!str) return "";
  const [ano, mes, dia] = str.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

export function hoje() {
  return chaveDia(new Date());
}

export function mesAtual() {
  return chaveAnoMes(new Date());
}

export function toast(mensagem, tipo = "info") {
  const cores = {
    info:    { bg: "#1A1A2E", border: "#7B5EA7", cor: "#fff" },
    sucesso: { bg: "#1A1A2E", border: "#4FC3A1", cor: "#4FC3A1" },
    erro:    { bg: "#1A1A2E", border: "#E05C5C", cor: "#E05C5C" },
    aviso:   { bg: "#1A1A2E", border: "#F0A830", cor: "#F0A830" },
  };
  const c = cores[tipo] || cores.info;

  const el = document.createElement("div");
  el.textContent = mensagem;
  el.style.cssText = `
    position: fixed;
    bottom: max(24px, calc(env(safe-area-inset-bottom) + 16px));
    left: 50%;
    transform: translateX(-50%) translateY(20px);

    width: calc(100% - 32px);
    max-width: 420px;

    background: ${c.bg};
    color: ${c.cor};
    border: 1px solid ${c.border};

    padding: 12px 16px;
    border-radius: 10px;

    font-size: 14px;
    line-height: 1.45;
    font-family: 'Poppins', sans-serif;
    text-align: center;

    white-space: normal;
    overflow-wrap: anywhere;

    z-index: 9999;
    opacity: 0;
    transition: opacity 0.3s ease, transform 0.3s ease;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  `;
  document.body.appendChild(el);

  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateX(-50%) translateY(0)";
  });

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateX(-50%) translateY(20px)";
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ─────────────────────────────────────────────
// NAV — renderização centralizada do menu lateral
// ─────────────────────────────────────────────

const NAV_ITEMS = [
  {
    module: 'home',
    page: 'home.html',
    label: 'Início',
    publicModule: true,
    svg: '<path d="M3 10.8 12 3l9 7.8V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>'
  },
  {
    module: 'dashboard',
    page: 'dashboard.html',
    label: 'Dashboard',
    svg: '<path d="M4 13h6V4H4Zm10 7h6V11h-6ZM4 20h6v-3H4Zm10-13h6V4h-6Z"/>'
  },
  {
    module: 'lancamentos',
    page: 'lancamentos.html',
    label: 'Lançamentos',
    svg: '<path d="M4 4h16v16H4zM8 12h8M12 8v8"/>'
  },
  {
    module: 'despesas',
    page: 'despesas.html',
    label: 'Despesas',
    svg: '<path d="M4 7h16v13H4zM7 7V4h10v3M8 12h8"/>'
  },
  {
    module: 'custo_operacional',
    page: 'custo-operacional.html',
    label: 'Custo operacional',
    svg: '<path d="m14.7 6.3 3-3a6 6 0 0 1-7.2 7.2l-6.9 6.9a2.1 2.1 0 1 0 3 3l6.9-6.9a6 6 0 0 1 7.2-7.2l-3 3Z"/>'
  },
  {
    module: 'historico',
    page: 'historico.html',
    label: 'Histórico',
    svg: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>'
  },
  { separator: true },
  {
    module: 'configuracoes',
    page: 'configuracoes.html',
    label: 'Configurações',
    publicModule: true,
    svg: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1H21v4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'
  },
  {
    module: 'admin',
    page: 'admin.html',
    label: 'Administração',
    adminOnly: true,
    svg: '<path d="M12 3 4 6v5c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6Z"/><path d="M9 12l2 2 4-4"/>'
  }
];

function _navIniciais(nome = '', email = '') {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return `${partes[0][0]}${partes.at(-1)[0]}`.toUpperCase();
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase() || 'DF';
}

function _navInfoPlano(perfil = {}) {
  const role = String(perfil.role || 'user').toLowerCase();
  if (role === 'admin') return { label: 'Administrador • acesso total', admin: true };
  const plano = String(perfil.plano || 'trial').toLowerCase();
  if (plano === 'trial') {
    const dias = diasRestantesTrial(perfil);
    return { label: dias === 0 ? 'Trial expirado' : `Trial • ${dias} dias restantes`, admin: false };
  }
  const nomes = { basico: 'Plano Básico', pro: 'Plano Pro', completo: 'Plano Completo' };
  return { label: nomes[plano] || `Plano ${plano}`, admin: false };
}

/**
 * Injeta sidebar + overlay + topbar na página e configura todos os eventos do menu.
 *
 * @param {string} paginaAtual  - nome do arquivo da página atual, ex: 'home.html'
 * @param {object} perfil       - objeto do perfil vindo do Firestore
 * @param {object} [opts]
 * @param {Function} [opts.onNavigate]  - callback chamado antes de navegar (pode retornar false para cancelar)
 * @param {Set<string>} [opts.paginasProntas] - Set de páginas já implementadas
 */
export function renderNav(paginaAtual, perfil, { onNavigate, paginasProntas, onLogout } = {}) {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const topbar   = document.getElementById('topbar');

  if (!sidebar || !overlay || !topbar) {
    console.warn('[DriveFinance/renderNav] Placeholders não encontrados.');
    return;
  }

  const isAdmin   = String(perfil?.role || '').toLowerCase() === 'admin';
  const modulos   = new Set(perfil?.modulos_ativos || []);
  const iniciais  = _navIniciais(perfil?.nome || '', perfil?.email || '');
  const planoInfo = _navInfoPlano(perfil);
  const nome      = perfil?.nome || 'Usuário DriveFinance';
  const email     = perfil?.email || '';

  // ── Itens do nav ──
  const itensHtml = NAV_ITEMS.map(item => {
    if (item.separator) return '<div class="nav-separator"></div>';

    if (item.adminOnly && !isAdmin) return '';

    const isAtivo    = paginaAtual === item.page;
    const isPublico  = item.publicModule === true;
    const permitido  = isAdmin || isPublico || modulos.has(item.module);
    const lockedAttr = permitido ? '' : 'data-locked="true"';
    const ativoClass = isAtivo ? ' ativo' : '';
    const ariaAtual  = isAtivo ? ' aria-current="page"' : '';

    return `
      <button class="nav-item module-link${ativoClass}"
              type="button"
              data-module="${item.module}"
              data-page="${item.page}"
              data-allowed="${permitido}"
              data-public-module="${isPublico}"
              ${lockedAttr}
              ${ariaAtual}>
        <svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true">${item.svg}</svg>
        <span>${item.label}</span>
        ${!permitido ? '<span class="nav-lock" aria-hidden="true"></span>' : ''}
      </button>`;
  }).join('');

  // ── Sidebar ──
  sidebar.innerHTML = `
    <a class="sidebar-logo home-logo" href="home.html" aria-label="DriveFinance — Início">
      <span class="logo-drive">Drive</span><span>Finance</span><i class="dot" aria-hidden="true"></i>
    </a>
    <nav class="sidebar-nav">${itensHtml}</nav>
    <div class="sidebar-footer">
      <div class="sidebar-plan${planoInfo.admin ? ' is-admin' : ''}" id="sidebar-plan">${planoInfo.label}</div>
      <div class="sidebar-user">
        <div class="user-avatar" id="sidebar-avatar">${iniciais}</div>
        <div class="user-copy">
          <strong id="sidebar-name">${nome}</strong>
          <span id="sidebar-email">${email}</span>
        </div>
        <button class="logout-btn" id="btn-logout" type="button" aria-label="Sair da conta" title="Sair da conta">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/></svg>
        </button>
      </div>
    </div>`;

  // ── Overlay ──
  overlay.setAttribute('aria-hidden', 'true');

  // ── Topbar ──
  topbar.innerHTML = `
    <button class="topbar-menu" id="btn-menu" type="button" aria-label="Abrir menu" aria-controls="sidebar" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
    <a class="topbar-logo" href="home.html">
      <span class="logo-drive">Drive</span><span>Finance</span><i class="dot" aria-hidden="true"></i>
    </a>
    <button class="topbar-avatar" id="topbar-avatar" type="button" aria-label="Abrir menu do usuário">${iniciais}</button>`;

  // ── Eventos ──
  function abrirMenu() {
    sidebar.classList.add('aberta');
    overlay.classList.add('visivel');
    overlay.setAttribute('aria-hidden', 'false');
    document.getElementById('btn-menu')?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('menu-open');
  }

  function fecharMenu() {
    sidebar.classList.remove('aberta');
    overlay.classList.remove('visivel');
    overlay.setAttribute('aria-hidden', 'true');
    document.getElementById('btn-menu')?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
  }

  document.getElementById('btn-menu')?.addEventListener('click', abrirMenu);
  document.getElementById('topbar-avatar')?.addEventListener('click', abrirMenu);
  overlay.addEventListener('click', fecharMenu);

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    if (onLogout) { onLogout(); return; }
    try { await logout(); } catch { toast('Não foi possível sair agora. Tente novamente.', 'erro'); }
  });

  document.querySelectorAll('.nav-item.module-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const permitido = btn.dataset.allowed === 'true';
      const page = btn.dataset.page;

      if (!permitido) {
        toast('Este módulo não está disponível no seu plano atual.', 'aviso');
        return;
      }

      if (onNavigate && onNavigate(page) === false) return;

      if (paginasProntas && !paginasProntas.has(page)) {
        toast('Este módulo será liberado nas próximas etapas do projeto.', 'info');
        fecharMenu();
        return;
      }

      window.location.href = page;
    });
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharMenu(); });
  window.addEventListener('resize', () => { if (window.innerWidth >= 1024) fecharMenu(); });
}
