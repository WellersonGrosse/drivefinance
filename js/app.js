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

// Observa mudança de estado de login
// Uso: onAuthStateChanged(auth, (user) => { ... })
export { onAuthStateChanged, auth };

// Login com e-mail e senha
export async function loginEmail(email, senha) {
  return await signInWithEmailAndPassword(auth, email, senha);
}

// Cadastro com e-mail e senha
export async function cadastrarEmail(email, senha, nome) {
  const cred = await createUserWithEmailAndPassword(auth, email, senha);
  await updateProfile(cred.user, { displayName: nome });
  await criarPerfilUsuario(cred.user.uid, nome, email);
  return cred;
}

// Logout
export async function logout() {
  await signOut(auth);
  window.location.href = "/login.html";
}

// Retorna usuário logado ou null
export function usuarioAtual() {
  return auth.currentUser;
}

// Redireciona para login se não estiver autenticado
export function exigirLogin() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (!user) {
        window.location.href = "/login.html";
      } else {
        resolve(user);
      }
    });
  });
}

// ─────────────────────────────────────────────
// PERFIL DO USUÁRIO
// ─────────────────────────────────────────────

// Cria perfil inicial no Firestore ao cadastrar
async function criarPerfilUsuario(uid, nome, email) {
  await setDoc(doc(db, "users", uid), {
    nome,
    email,
    role: "user",          // "user" ou "admin"
    plano: "basico",       // "basico", "pro", "completo"
    modulos_ativos: [      // módulos liberados pelo plano
      "home",
      "lancamentos",
      "despesas",
      "historico"
    ],
    salario_liquido: 0,
    criado_em: serverTimestamp()
  });
}

// Busca perfil do usuário no Firestore
export async function getPerfil(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// Atualiza perfil do usuário
export async function updatePerfil(uid, dados) {
  await updateDoc(doc(db, "users", uid), dados);
}

// Verifica se usuário tem acesso a um módulo
export async function temAcesso(uid, modulo) {
  const perfil = await getPerfil(uid);
  if (!perfil) return false;
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

// Busca configurações gerais (dias de trabalho, plataformas, toggles)
export async function getConfig(uid) {
  const snap = await getDoc(doc(db, "users", uid, "config", "settings"));
  if (snap.exists()) return snap.data();

  // Configuração padrão se ainda não existir
  const padrao = {
    dias_trabalho: [0, 1, 2, 3, 4, 5, 6], // 0=dom, 1=seg ... 6=sab
    plataformas: ["Uber"],
    superavit: true,
    deficit: true,
    atualizado_em: serverTimestamp()
  };
  await setDoc(doc(db, "users", uid, "config", "settings"), padrao);
  return padrao;
}

// Salva configurações gerais
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

// Retorna apenas despesas ativas do mês atual
export async function getDespesasAtivas(uid) {
  const todas = await getDespesas(uid);
  const hoje = new Date();
  const mesAtual = hoje.getMonth() + 1;
  const anoAtual = hoje.getFullYear();

  return todas.filter(d => {
    if (d.tipo === "fixa") return true;
    if (d.tipo === "parcelamento") {
      // Verifica se o parcelamento ainda está ativo
      if (d.parcela_atual > d.parcela_total) return false;
      // Verifica se já encerrou no passado
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

// Chave do mês: "2026-06"
function chaveAnoMes(data = new Date()) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  return `${ano}-${mes}`;
}

// Chave do dia: "2026-06-22"
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
// CUSTO OPERACIONAL (desgaste do veículo)
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

// Retorna os dias de trabalho do mês para um uid
export async function getDiasTrabalhoMes(uid, data = new Date()) {
  const config = await getConfig(uid);
  const diasSemana = config.dias_trabalho; // ex: [1,2,3,4,5]

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

// Calcula a meta do dia considerando déficit/superávit
export async function calcularMetaDia(uid, data = new Date()) {
  const config = await getConfig(uid);
  const despesas = await getDespesasAtivas(uid);
  const lancamentosMes = await getLancamentosMes(uid, data);
  const diasTrabalho = await getDiasTrabalhoMes(uid, data);

  const hoje = data.getDate();

  // Total mensal de despesas
  const totalMensal = despesas.reduce((acc, d) => acc + (d.valor || 0), 0);

  // Dias restantes de trabalho (incluindo hoje)
  const diasRestantes = diasTrabalho.filter(d => d >= hoje);

  if (diasRestantes.length === 0) return 0;

  // Total já ganho no mês
  const ganhoAcumulado = lancamentosMes.reduce((acc, l) => {
    const ganhoApp = (l.corridas_app || []).reduce((s, c) => s + (c.valor || 0), 0);
    const ganhoParticular = (l.corridas_particular || []).reduce((s, c) => s + (c.valor || 0), 0);
    return acc + ganhoApp + ganhoParticular;
  }, 0);

  // Faltante para cobrir o mês
  const faltante = totalMensal - ganhoAcumulado;

  // Meta do dia = faltante ÷ dias restantes
  const metaDia = faltante / diasRestantes.length;

  return Math.max(0, metaDia);
}

// ─────────────────────────────────────────────
// UTILITÁRIOS GERAIS
// ─────────────────────────────────────────────

// Formata valor em reais: 1480.5 → "R$ 1.480,50"
export function formatReal(valor) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(valor || 0);
}

// Formata data: "2026-06-22" → "22/06/2026"
export function formatData(str) {
  if (!str) return "";
  const [ano, mes, dia] = str.split("-");
  return `${dia}/${mes}/${ano}`;
}

// Retorna saudação por horário
export function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

// Retorna data de hoje no formato "2026-06-22"
export function hoje() {
  return chaveDia(new Date());
}

// Retorna mês atual no formato "2026-06"
export function mesAtual() {
  return chaveAnoMes(new Date());
}

// Exibe toast de notificação na tela
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
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px);
    background: ${c.bg}; color: ${c.cor}; border: 1px solid ${c.border};
    padding: 12px 24px; border-radius: 10px; font-size: 14px; font-family: 'Poppins', sans-serif;
    z-index: 9999; opacity: 0; transition: all 0.3s ease; white-space: nowrap;
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
