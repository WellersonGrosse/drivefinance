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

// Verifica se o trial do perfil ainda está ativo
function trialAtivo(perfil) {
  const inicio = timestampParaDate(perfil.trial_inicio || perfil.criado_em);
  if (!inicio) return false;
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + 15);
  return new Date() < fim;
}

// Retorna quantos dias restam no trial (0 se expirado)
export function diasRestantesTrial(perfil) {
  const inicio = timestampParaDate(perfil?.trial_inicio || perfil?.criado_em);
  if (!inicio) return 0;
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + 15);
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
    if (trialAtivo(perfil)) {
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

  // Plano pago sem data de expiração configurada ainda: libera
  // (você pode tornar isso mais restritivo quando o billing estiver completo)
  return { permitido: true, motivo: "plano_ativo", perfil };
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
