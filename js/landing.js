// ─────────────────────────────────────────────
// landing.js — Scripts da landing page
// ─────────────────────────────────────────────

import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Planos padrão (fallback se Firestore falhar) ──
const PLANOS_PADRAO = {
  basico: {
    nome: "Básico", mensal: 15.90, anual: 99.90, destaque: false,
    features: [
      { ok: true,  text: "Meta diária automática" },
      { ok: true,  text: "Registro de corridas (app + particular)" },
      { ok: true,  text: "Controle de despesas e parcelas" },
      { ok: true,  text: "Histórico com calendário" },
      { ok: false, text: "Dashboard financeiro (DRE)" },
      { ok: false, text: "Custo operacional do veículo" },
      { ok: false, text: "Relatórios exportáveis" },
    ]
  },
  pro: {
    nome: "Pro", mensal: 25.90, anual: 169.90, destaque: true,
    features: [
      { ok: true, text: "Tudo do Básico" },
      { ok: true, text: "Dashboard financeiro completo (DRE)" },
      { ok: true, text: "Custo operacional por km" },
      { ok: true, text: "KM ocioso com custo separado" },
      { ok: true, text: "Múltiplos veículos" },
      { ok: false, text: "Relatórios exportáveis" },
      { ok: false, text: "Suporte prioritário WhatsApp" },
    ]
  },
  completo: {
    nome: "Completo", mensal: 35.90, anual: 229.90, destaque: false,
    features: [
      { ok: true, text: "Tudo do Pro" },
      { ok: true, text: "Relatórios exportáveis (PDF/Excel)" },
      { ok: true, text: "Suporte prioritário WhatsApp" },
      { ok: true, text: "Histórico ilimitado" },
      { ok: true, text: "Acesso antecipado a novidades" },
    ]
  }
};

function formatReal(v) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

// ── Renderiza os cards de planos ──
function renderPlanos(planos) {
  const grid = document.getElementById("plansGrid");
  if (!grid) return;
  grid.innerHTML = "";

  Object.values(planos).forEach(p => {
    const card = document.createElement("div");
    card.className = "plan-card reveal" + (p.destaque ? " destaque" : "");

    card.innerHTML = `
      ${p.destaque ? '<div class="plan-popular">✦ Mais popular</div>' : ""}
      <div class="plan-name">${p.nome}</div>
      <div class="plan-price">
        <span class="cur">R$</span>${String(p.mensal.toFixed(2)).replace(".", ",")}
        <span class="per">/mês</span>
      </div>
      <p class="plan-anual">Ou <strong>${formatReal(p.anual)}</strong> no anual — pagamento único</p>
      <div class="plan-divider"></div>
      <ul class="plan-feats">
        ${p.features.map(f => `
          <li>
            <span class="${f.ok ? "ok" : "no"}">${f.ok ? "✓" : "○"}</span>
            ${f.text}
          </li>
        `).join("")}
      </ul>
      <button
        class="btn-plan ${p.destaque ? "btn-plan-roxo" : "btn-plan-outline"}"
        onclick="window.open('https://wa.me/5531991184300?text=Olá! Tenho interesse no plano ${encodeURIComponent(p.nome)} do Drive Finance.','_blank')"
      >
        Começar grátis — 15 dias
      </button>
    `;
    grid.appendChild(card);
  });

  // Re-observa os novos cards
  document.querySelectorAll(".plan-card.reveal").forEach(el => revealObserver.observe(el));
}

// ── Carrega planos do Firestore ──
async function carregarPlanos() {
  let planos = PLANOS_PADRAO;
  try {
    const snap = await getDoc(doc(db, "config_global", "planos"));
    if (snap.exists()) planos = snap.data();
  } catch (e) {
    // usa padrão
  }
  renderPlanos(planos);
}

// ── Intersection Observer para reveal ──
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add("visible");
      revealObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });

function initReveal() {
  document.querySelectorAll(".reveal").forEach(el => revealObserver.observe(el));
}

// ── Cursor glow ──
function initCursorGlow() {
  const glow = document.querySelector(".cursor-glow");
  if (!glow) return;
  document.addEventListener("mousemove", (e) => {
    glow.style.left = e.clientX + "px";
    glow.style.top  = e.clientY + "px";
  });
}

// ── Nav scrolled state ──
function initNavScroll() {
  const nav = document.querySelector(".l-nav");
  if (!nav) return;
  const handler = () => {
    nav.classList.toggle("scrolled", window.scrollY > 20);
  };
  window.addEventListener("scroll", handler, { passive: true });
  handler();
}

// ── Menu mobile ──
function toggleMenu() {
  const links = document.getElementById("navLinks");
  if (links) links.classList.toggle("open");
}
window.toggleMenu = toggleMenu;

// ── Steps da seção "como funciona" ──
function initStepsObserver() {
  const steps = document.querySelectorAll(".como-step");
  if (!steps.length) return;

  const obs = new IntersectionObserver((entries) => {
    entries.forEach((e, i) => {
      if (e.isIntersecting) {
        setTimeout(() => e.target.classList.add("visible"), i * 120);
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.15 });

  steps.forEach(s => obs.observe(s));
}

// ── Número contador animado ──
function animateCounters() {
  document.querySelectorAll("[data-count]").forEach(el => {
    const target = parseFloat(el.dataset.count);
    const prefix = el.dataset.prefix || "";
    const suffix = el.dataset.suffix || "";
    const duration = 1500;
    const start = performance.now();

    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();

      const tick = (now) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = eased * target;
        el.textContent = prefix + current.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + suffix;
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.5 });

    obs.observe(el);
  });
}

// ── Init ──
document.addEventListener("DOMContentLoaded", () => {
  initCursorGlow();
  initNavScroll();
  initReveal();
  initStepsObserver();
  animateCounters();
  carregarPlanos();
});