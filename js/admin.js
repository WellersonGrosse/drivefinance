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
