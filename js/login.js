// ─────────────────────────────────────────
//  DriveFinance — login.js
//  Lógica da tela de login / cadastro
// ─────────────────────────────────────────

import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  deleteUser,
  sendPasswordResetEmail,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc,
  setDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Verifica apenas o estado inicial da sessão ──────
// Depois dessa primeira verificação, login e cadastro controlam o próprio
// redirecionamento. Assim, no cadastro, a página só muda depois de o perfil
// ter sido gravado com sucesso no Firestore.
let fluxoAuthEmAndamento = false;
let estadoInicialProcessado = false;
let pararObserverAuth = null;

pararObserverAuth = onAuthStateChanged(auth, (user) => {
  if (estadoInicialProcessado) return;

  estadoInicialProcessado = true;
  if (pararObserverAuth) pararObserverAuth();

  if (user && !fluxoAuthEmAndamento) {
    window.location.replace('home.html');
  }
});

// ─────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────

function showToast(msg, tipo = 'success') {
  const t    = document.getElementById('toast');
  const icon = document.getElementById('toast-icon');
  document.getElementById('toast-msg').textContent = msg;
  t.className = 'toast ' + tipo;
  icon.innerHTML = tipo === 'success'
    ? '<polyline points="20 6 9 17 4 12"/>'
    : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

function setLoading(btnId, on) {
  const b = document.getElementById(btnId);
  b.disabled = on;
  b.classList.toggle('loading', on);
}

function clearErrors() {
  document.querySelectorAll('.field-error').forEach(el => el.classList.remove('show'));
  document.querySelectorAll('input').forEach(el => el.classList.remove('error'));
}

function showError(errId, inputId, msg) {
  const el = document.getElementById(errId);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  const input = document.getElementById(inputId);
  if (input) input.classList.add('error');
}

function firebaseErro(code) {
  const mapa = {
    'auth/invalid-email':          'E-mail inválido.',
    'auth/user-not-found':         'Nenhuma conta com esse e-mail.',
    'auth/wrong-password':         'Senha incorreta.',
    'auth/invalid-credential':     'E-mail ou senha incorretos.',
    'auth/email-already-in-use':   'Esse e-mail já está cadastrado.',
    'auth/weak-password':          'A senha precisa ter pelo menos 6 caracteres.',
    'auth/too-many-requests':      'Muitas tentativas. Aguarde um momento.',
    'auth/network-request-failed': 'Sem conexão. Verifique sua internet.',
  };
  return mapa[code] || 'Algo deu errado. Tente novamente.';
}

// ─────────────────────────────────────────
// MÁSCARA DE TELEFONE
// ─────────────────────────────────────────

function mascaraTel(v) {
  v = v.replace(/\D/g, '');
  if (v.length <= 10) return v.replace(/(\d{2})(\d{4})(\d+)/, '($1) $2-$3');
  return v.replace(/(\d{2})(\d{1})(\d{4})(\d+)/, '($1) $2 $3-$4');
}

document.getElementById('cad-telefone').addEventListener('input', function () {
  const pos  = this.selectionStart;
  const prev = this.value.length;
  this.value = mascaraTel(this.value);
  const diff = this.value.length - prev;
  this.setSelectionRange(pos + diff, pos + diff);
});

// ─────────────────────────────────────────
// TOGGLE LOGIN / CADASTRO
// ─────────────────────────────────────────

export function setMode(modo) {
  clearErrors();
  document.getElementById('panel-login').classList.toggle('active', modo === 'login');
  document.getElementById('panel-cadastro').classList.toggle('active', modo === 'cadastro');
  document.getElementById('btn-login').classList.toggle('active', modo === 'login');
  document.getElementById('btn-cadastro').classList.toggle('active', modo === 'cadastro');
  document.getElementById('btn-login').setAttribute('aria-selected', modo === 'login');
  document.getElementById('btn-cadastro').setAttribute('aria-selected', modo === 'cadastro');
}

// expõe para os onclick do HTML
window.setMode = setMode;

// ─────────────────────────────────────────
// MOSTRAR / OCULTAR SENHA
// ─────────────────────────────────────────

export function toggleSenha(inputId, btn) {
  const input   = document.getElementById(inputId);
  const visible = input.type === 'text';
  input.type    = visible ? 'password' : 'text';
  btn.setAttribute('aria-label', visible ? 'Mostrar senha' : 'Ocultar senha');
  btn.querySelector('svg').innerHTML = visible
    ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
}

window.toggleSenha = toggleSenha;

// ─────────────────────────────────────────
// FORÇA DA SENHA
// ─────────────────────────────────────────

export function avaliarSenha(v) {
  const bar   = document.getElementById('pw-bar');
  let score   = 0;
  if (v.length >= 8)       score++;
  if (/[A-Z]/.test(v))     score++;
  if (/[0-9]/.test(v))     score++;
  if (/[^A-Za-z0-9]/.test(v)) score++;
  const cores = ['#E05C5C', '#F0A830', '#F0A830', '#4FC3A1', '#4FC3A1'];
  bar.style.width      = (score * 25) + '%';
  bar.style.background = cores[score];
}

window.avaliarSenha = avaliarSenha;

// ─────────────────────────────────────────
// MODAL — ESQUECI A SENHA
// ─────────────────────────────────────────

export function abrirEsqueceu() {
  document.getElementById('modal-esqueceu').classList.add('show');
  setTimeout(() => document.getElementById('forgot-email').focus(), 200);
}

export function fecharEsqueceu(e) {
  if (e && e.target !== document.getElementById('modal-esqueceu')) return;
  document.getElementById('modal-esqueceu').classList.remove('show');
  document.getElementById('forgot-email').value = '';
  const err = document.getElementById('err-forgot');
  err.textContent = '';
  err.classList.remove('show');
}

export async function enviarRecuperacao() {
  const email = document.getElementById('forgot-email').value.trim();
  const errEl = document.getElementById('err-forgot');
  errEl.classList.remove('show');
  if (!email) {
    errEl.textContent = 'Informe o e-mail.';
    errEl.classList.add('show');
    return;
  }
  document.getElementById('btn-recuperar').disabled = true;
  try {
    await sendPasswordResetEmail(auth, email);
    document.getElementById('modal-esqueceu').classList.remove('show');
    showToast('Link de recuperação enviado para ' + email);
  } catch (err) {
    errEl.textContent = firebaseErro(err.code);
    errEl.classList.add('show');
  } finally {
    document.getElementById('btn-recuperar').disabled = false;
  }
}

window.abrirEsqueceu    = abrirEsqueceu;
window.fecharEsqueceu   = fecharEsqueceu;
window.enviarRecuperacao = enviarRecuperacao;

// ─────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────

export async function fazerLogin() {
  clearErrors();
  const email = document.getElementById('login-email').value.trim();
  const senha = document.getElementById('login-senha').value;
  let ok = true;

  if (!email) { showError('err-login-email', 'login-email', 'Informe o e-mail.'); ok = false; }
  if (!senha) { showError('err-login-senha', 'login-senha', 'Informe a senha.');  ok = false; }
  if (!ok) return;

  fluxoAuthEmAndamento = true;
  setLoading('btn-entrar', true);

  let loginConcluido = false;

  try {
    await signInWithEmailAndPassword(auth, email, senha);
    loginConcluido = true;
    showToast('Bem-vindo de volta!');
    setTimeout(() => window.location.replace('home.html'), 800);
  } catch (err) {
    fluxoAuthEmAndamento = false;
    showToast(firebaseErro(err.code), 'error');
  } finally {
    // Em caso de sucesso, mantém o botão carregando até a troca de página.
    if (!loginConcluido) setLoading('btn-entrar', false);
  }
}

window.fazerLogin = fazerLogin;

// ─────────────────────────────────────────
// CADASTRO
// ─────────────────────────────────────────

export async function fazerCadastro() {
  clearErrors();
  const nome     = document.getElementById('cad-nome').value.trim();
  const telefone = document.getElementById('cad-telefone').value.trim();
  const nasc     = document.getElementById('cad-nascimento').value;
  const email    = document.getElementById('cad-email').value.trim();
  const senha    = document.getElementById('cad-senha').value;
  const termos   = document.getElementById('termos').checked;
  let ok = true;

  if (!nome)        { showError('err-cad-nome',  'cad-nome',       'Informe seu nome.');              ok = false; }
  if (!telefone)    { showError('err-cad-tel',   'cad-telefone',   'Informe o telefone.');            ok = false; }
  if (!nasc)        { showError('err-cad-nasc',  'cad-nascimento', 'Informe a data de nascimento.');  ok = false; }
  if (!email)       { showError('err-cad-email', 'cad-email',      'Informe o e-mail.');              ok = false; }
  if (senha.length < 8) { showError('err-cad-senha', 'cad-senha', 'Mínimo 8 caracteres.');            ok = false; }
  if (!termos)      { showError('err-termos',    null,             'Aceite os termos para continuar.'); ok = false; }
  if (!ok) return;

  fluxoAuthEmAndamento = true;
  setLoading('btn-cadastrar', true);

  let usuarioCriado = null;
  let cadastroConcluido = false;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, senha);
    usuarioCriado = cred.user;

    await updateProfile(usuarioCriado, { displayName: nome });

    // Aguarda a gravação completa do perfil antes de redirecionar.
    await setDoc(doc(db, 'users', usuarioCriado.uid), {
      nome,
      email,
      telefone,
      data_nascimento: nasc,
      role:            'user',
      plano:           'trial',
      trial_inicio:    serverTimestamp(),
      modulos_ativos:  ['home', 'lancamentos', 'despesas', 'historico'],
      salario_liquido: 0,
      criado_em:       serverTimestamp()
    });

    cadastroConcluido = true;
    showToast('Conta criada! Bem-vindo ao DriveFinance 🎉');
    setTimeout(() => window.location.replace('home.html'), 1000);
  } catch (err) {
    fluxoAuthEmAndamento = false;

    // Evita deixar uma conta no Authentication sem o perfil correspondente
    // no Firestore caso alguma etapa do cadastro falhe.
    if (usuarioCriado) {
      try {
        await deleteUser(usuarioCriado);
      } catch (rollbackErr) {
        console.error('Não foi possível desfazer o usuário incompleto:', rollbackErr);
      }
    }

    showToast(firebaseErro(err.code), 'error');
  } finally {
    // Em caso de sucesso, mantém o botão carregando até a troca de página.
    if (!cadastroConcluido) setLoading('btn-cadastrar', false);
  }
}

window.fazerCadastro = fazerCadastro;

// ─────────────────────────────────────────
// ENTER nos formulários
// ─────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const loginAtivo = document.getElementById('panel-login').classList.contains('active');
  if (loginAtivo) fazerLogin();
  else            fazerCadastro();
});
