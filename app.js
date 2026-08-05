// ============================================================
// DUETO — modo teste (sem Firebase configurado ainda)
// ============================================================
// O login aqui só confere se o número bate com um dos dois
// cadastrados — sem SMS, sem confirmação. Os dados ficam salvos
// no localStorage do navegador (por celular/navegador, não
// sincroniza entre os dois ainda).
//
// QUANDO O FIREBASE ESTIVER CONFIGURADO: troque este arquivo pela
// versão com Firebase Auth + Firestore (posso gerar de novo na hora).
// ============================================================
import { NUMEROS_AUTORIZADOS } from "./firebase-config.js";

const STORAGE_KEY = 'dueto_contas_teste';
const HIST_KEY = 'dueto_historico_teste';
const REF_TODAY = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };

let currentUser = null; // { phone, nome, codigo }
let contasCache = [];
let editingId = null;
let uploadTarget = null;

// ---------- dados locais (substituem o Firestore por enquanto) ----------
function loadContas(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    contasCache = raw ? JSON.parse(raw) : seedData();
    saveContas();
  } catch (e) {
    contasCache = seedData();
  }
}
function saveContas(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contasCache));
}
function seedData(){
  return [
    { id: 'c1', categoria:'cartao', nome:'Cartão Nubank · Fabrício', valor:340, minimo:68, parcelamento:'Parcelado 3/12x', vencimento:'2026-08-01', lancadoPor:'+5519997711319', lancadoPorNome:'Fabrício', pago:false },
    { id: 'c2', categoria:'agua', nome:'Água', valor:128.40, minimo:null, parcelamento:null, vencimento:'2026-08-03', lancadoPor:'+5519997711642', lancadoPorNome:'Hosana', pago:false }
  ];
}

// ---------- LOGIN (sem SMS, só confere o número) ----------
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnSendCode').addEventListener('click', doLogin);
  document.getElementById('loginPhone').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('btnBackupLogin').addEventListener('click', backupData);
  document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);
  document.getElementById('quickAddBtn').addEventListener('click', () => openAddModal(null, currentSidebarFilter()));
  document.getElementById('fabAdd').addEventListener('click', () => openAddModal(null, null));
  document.getElementById('btnCancelSheet').addEventListener('click', closeModal);
  document.getElementById('btnSaveSheet').addEventListener('click', saveEntry);
  document.getElementById('overlay').addEventListener('click', closeModal);
  document.querySelectorAll('#segCat button').forEach(b => b.addEventListener('click', () => pickCat(b)));
  document.querySelectorAll('.sidebar button').forEach(b => b.addEventListener('click', () => pickFilter(b)));
  document.getElementById('f-numParcelas').addEventListener('input', recalcParcela);
  document.getElementById('f-valor').addEventListener('input', recalcParcela);
  document.getElementById('receiptInput').addEventListener('change', onReceiptChosen);
  document.getElementById('histOverlay').addEventListener('click', closeHistDetail);
  document.getElementById('btnCloseHist').addEventListener('click', closeHistDetail);
  document.getElementById('viewerOverlay').addEventListener('click', closeReceiptViewer);
  document.getElementById('btnCloseViewer').addEventListener('click', closeReceiptViewer);
  document.getElementById('btnViewNewTab').addEventListener('click', () => {
    if (currentViewerData) window.open(currentViewerData.dataUrl, '_blank');
  });
  document.getElementById('btnDownloadReceipt').addEventListener('click', () => {
    if (!currentViewerData) return;
    const a = document.createElement('a');
    a.href = currentViewerData.dataUrl;
    a.download = currentViewerData.nome || 'comprovante';
    a.click();
  });
  setupInstallPrompt();
});

function normalizePhone(v){ return v.replace(/\D/g,''); }

function doLogin(){
  const raw = document.getElementById('loginPhone').value;
  const digits = normalizePhone(raw);
  const e164 = '+55' + digits;
  const err = document.getElementById('loginError');
  const info = NUMEROS_AUTORIZADOS[e164];

  if (!info) {
    err.textContent = 'Número não cadastrado. Só Fabrício e Hosana podem entrar.';
    return;
  }
  err.textContent = '';
  currentUser = { phone: e164, nome: info.nome, codigo: info.codigo };
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appRoot').style.display = 'block';
  loadContas();
  renderList();
  renderTotals();
  showToast('Modo teste: dados salvos só neste navegador, ainda sem sincronizar com o outro celular.');
}

// ---------- cálculo de status/datas ----------
function diasAte(vencStr){
  const due = new Date(vencStr + 'T00:00:00');
  return Math.round((due - REF_TODAY()) / 86400000);
}
function statusConta(c){
  if (c.pago) return { label: 'Pago', cls: 'ok' };
  const d = diasAte(c.vencimento);
  if (d < 0) return { label: 'Venceu ' + Math.abs(d) + 'd', cls: 'overdue' };
  if (d === 0) return { label: 'Hoje', cls: 'today' };
  return { label: d + 'd', cls: '' };
}
function currentSidebarFilter(){
  const b = document.querySelector('.sidebar button.active');
  return b ? b.dataset.filter : 'todas';
}

function renderTotals(){
  const hoje = REF_TODAY();
  let vencidas = 0, venceHoje = 0, mes = 0;
  contasCache.forEach(c => {
    if (c.pago) return;
    const d = diasAte(c.vencimento);
    const v = Number(c.valor) || 0;
    if (d < 0) vencidas += v;
    if (d === 0) venceHoje += v;
    const due = new Date(c.vencimento + 'T00:00:00');
    if (due.getMonth() === hoje.getMonth() && due.getFullYear() === hoje.getFullYear()) mes += v;
  });
  document.getElementById('totalVencidas').textContent = 'R$ ' + vencidas.toFixed(2).replace('.', ',');
  document.getElementById('totalHoje').textContent = 'R$ ' + venceHoje.toFixed(2).replace('.', ',');
  document.getElementById('totalMes').textContent = 'R$ ' + mes.toFixed(2).replace('.', ',');
}

function renderList(){
  const filtro = currentSidebarFilter();
  const list = document.getElementById('list');

  if (filtro === 'historico') {
    renderHistorico(list);
    return;
  }

  const visiveis = contasCache.filter(c => !c.pago && (filtro === 'todas' || c.categoria === filtro));

  if (visiveis.length === 0) {
    list.innerHTML = '<div class="empty-state">Nenhuma conta aqui ainda. Toque em "+" pra lançar.</div>';
    return;
  }
  const vencidas = visiveis.filter(c => diasAte(c.vencimento) < 0);
  const proximas = visiveis.filter(c => diasAte(c.vencimento) >= 0);

  let html = '';
  if (vencidas.length) html += '<div class="section-label">Vencidas</div>' + vencidas.map(cardHtml).join('');
  if (proximas.length) html += '<div class="section-label">Próximas</div>' + proximas.map(cardHtml).join('');
  list.innerHTML = html;

  list.querySelectorAll('.edit-btn').forEach(b => b.addEventListener('click', () => openAddModal(b.dataset.id, null)));
  list.querySelectorAll('.pay-btn').forEach(b => b.addEventListener('click', () => selectPay(b)));
  list.querySelectorAll('.amt-confirm').forEach(b => b.addEventListener('click', () => confirmPay(b)));
  list.querySelectorAll('.upload-box:not(.attached)').forEach(b => b.addEventListener('click', () => { uploadTarget = { tipo:'card', id:b.dataset.id }; document.getElementById('receiptInput').click(); }));
  list.querySelectorAll('.upload-box.attached').forEach(b => b.addEventListener('click', () => {
    const c = contasCache.find(x => x.id === b.dataset.id);
    if (c && c.comprovanteData) openReceiptViewer(c.comprovanteData, c.comprovanteNome);
  }));
  list.querySelectorAll('.card').forEach(card => {
    attachLongPress(card, () => {
      if (confirm('Apagar esta conta? Essa ação não pode ser desfeita.')) {
        contasCache = contasCache.filter(x => x.id !== card.dataset.id);
        saveContas();
        renderList();
        renderTotals();
      }
    });
  });
}

// ---------- segurar pra apagar ----------
function attachLongPress(el, onLongPress){
  let timer = null;
  let fired = false;
  const start = (e) => {
    fired = false;
    timer = setTimeout(() => { fired = true; onLongPress(); }, 550);
  };
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
}

function renderHistorico(list){
  const pagas = contasCache.filter(c => c.pago).map(c => ({
    tipo: 'card', id: c.id, nome: c.nome, valor: c.valorPago || c.valor,
    data: c.pagoEm || c.vencimento, categoria: c.categoria,
    comprovanteNome: c.comprovanteNome, comprovanteData: c.comprovanteData
  }));
  const parcelas = loadHistorico().map(h => ({
    tipo: 'parcela', id: h.id, nome: h.nome, valor: h.valor, data: h.data, categoria: h.categoria,
    comprovanteNome: h.comprovanteNome, comprovanteData: h.comprovanteData
  }));
  const tudo = pagas.concat(parcelas).sort((a,b) => (a.data < b.data ? 1 : -1));

  if (tudo.length === 0) {
    list.innerHTML = '<div class="empty-state">Nada pago ainda. Assim que você quitar ou pagar uma parcela, aparece aqui.</div>';
    return;
  }
  document.getElementById('contentTitle').textContent = 'Histórico de pagamentos';
  list.innerHTML = '<div class="section-label">Pagas</div>' + tudo.map(h => `
    <div class="card cat-${h.categoria}" style="cursor:pointer" data-tipo="${h.tipo}" data-id="${h.id}">
      <div class="card-top">
        <div><div class="card-title">${h.nome}</div><div class="card-sub">Pago em ${h.data.split('-').reverse().join('/')}</div></div>
        <div class="badge ok">Pago</div>
      </div>
      <div class="money-row"><div class="money-main">R$ ${Number(h.valor).toFixed(2).replace('.', ',')}</div></div>
    </div>`).join('');

  list.querySelectorAll('.card').forEach(el => el.addEventListener('click', () => openHistDetail(el.dataset.tipo, el.dataset.id)));
  list.querySelectorAll('.card').forEach(el => {
    attachLongPress(el, () => {
      const tipo = el.dataset.tipo, id = el.dataset.id;
      if (!confirm('Apagar este registro do histórico? Essa ação não pode ser desfeita.')) return;
      if (tipo === 'card') {
        contasCache = contasCache.filter(x => x.id !== id);
        saveContas();
      } else {
        const h = loadHistorico().filter(x => x.id !== id);
        saveHistorico(h);
      }
      renderList();
    });
  });
}

// ---------- detalhe do histórico (abre já mostrando "pago" + comprovante) ----------
function findHistRecord(tipo, id){
  if (tipo === 'card') return contasCache.find(x => x.id === id);
  const h = loadHistorico();
  return h.find(x => x.id === id);
}

function openHistDetail(tipo, id){
  const rec = findHistRecord(tipo, id);
  if (!rec) return;
  uploadTarget = { tipo, id };
  const valor = rec.valorPago || rec.valor;
  const data = rec.pagoEm || rec.data || rec.vencimento;
  const nome = rec.nome;

  const receiptHtml = rec.comprovanteData
    ? `<div class="upload-box show attached" id="histReceiptBox"><div class="ic">✅</div><div class="txt">${rec.comprovanteNome}</div></div>`
    : `<div class="upload-box show" id="histReceiptBox"><div class="ic">📎</div><div class="txt">Anexar comprovante (foto ou PDF)</div></div>`;

  document.getElementById('histTitle').textContent = nome;
  document.getElementById('histDetailBody').innerHTML = `
    <div class="hist-valor">R$ ${Number(valor).toFixed(2).replace('.', ',')}</div>
    <div class="hist-meta">Pago em ${data.split('-').reverse().join('/')}</div>
    <div class="hist-badge">✔ Pago</div>
    ${receiptHtml}
  `;

  const box = document.getElementById('histReceiptBox');
  box.addEventListener('click', () => {
    if (rec.comprovanteData) {
      openReceiptViewer(rec.comprovanteData, rec.comprovanteNome);
    } else {
      document.getElementById('receiptInput').click();
    }
  });

  document.getElementById('histOverlay').classList.add('show');
  document.getElementById('histSheet').classList.add('show');
}
function closeHistDetail(){
  document.getElementById('histOverlay').classList.remove('show');
  document.getElementById('histSheet').classList.remove('show');
}

// ---------- visualizador de comprovante (ver ou baixar) ----------
let currentViewerData = null;
function openReceiptViewer(dataUrl, nome){
  currentViewerData = { dataUrl, nome };
  document.getElementById('viewerName').textContent = nome || 'comprovante';
  const body = document.getElementById('viewerBody');
  if (/\.pdf($|\?)/i.test(nome || '') || dataUrl.startsWith('data:application/pdf')) {
    body.innerHTML = '<div class="pdf-note">Comprovante em PDF — toque em "Abrir" pra ver, ou "Baixar" pra salvar.</div>';
  } else {
    body.innerHTML = `<img src="${dataUrl}" alt="Comprovante">`;
  }
  document.getElementById('viewerOverlay').classList.add('show');
  document.getElementById('receiptViewer').classList.add('show');
}
function closeReceiptViewer(){
  document.getElementById('viewerOverlay').classList.remove('show');
  document.getElementById('receiptViewer').classList.remove('show');
}

function cardHtml(c){
  const status = statusConta(c);
  const [y,m,d] = c.vencimento.split('-');
  const vencBR = d + '/' + m;
  const valor = Number(c.valor) || 0;
  const catClass = 'cat-' + c.categoria;

  const parcelasInfo = parseParcelas(c.parcelamento);
  const tags = (c.categoria === 'cartao') ?
    '<div class="card-tags">' +
      (c.minimo ? `<span class="tag">Mínimo R$ ${Number(c.minimo).toFixed(2).replace('.', ',')}</span>` : '') +
      (parcelasInfo ? `<span class="tag parcelado">Parcela ${parcelasInfo.atual}/${parcelasInfo.total}${c.valorParcela ? ' · R$ ' + Number(c.valorParcela).toFixed(2).replace('.', ',') : ''}</span>` : '') +
    '</div>' : '';

  const payArea = c.pago ? '' :
    (parcelasInfo ?
      `<div class="pay-toggle"><button class="pay-btn" data-id="${c.id}" data-amount="${c.valorParcela || (valor / parcelasInfo.total)}">Pagar parcela ${parcelasInfo.atual}/${parcelasInfo.total}</button></div>` :
    ((c.categoria === 'cartao' && c.minimo) ?
    `<div class="pay-toggle">
       <button class="pay-btn" data-id="${c.id}" data-amount="${c.minimo}">Paguei o mínimo</button>
       <button class="pay-btn" data-id="${c.id}" data-amount="${c.valor}">Paguei o total</button>
     </div>` :
    `<div class="pay-toggle"><button class="pay-btn" data-id="${c.id}" data-amount="${c.valor}">Marcar como pago</button></div>`
  ));

  const amtRow = c.pago ? '' :
    `<div class="amt-row"><span class="amt-prefix">R$</span><input type="number" step="0.01" class="amt-input"><button class="amt-confirm" data-id="${c.id}">Confirmar</button></div>`;

  const uploadBox = c.comprovanteNome
    ? `<div class="upload-box show attached" data-id="${c.id}"><div class="ic">✅</div><div class="txt">${c.comprovanteNome}</div></div>`
    : `<div class="upload-box show" data-id="${c.id}"><div class="ic">📎</div><div class="txt">Anexar comprovante (foto ou PDF)</div></div>`;

  const paidLine = c.pago ? `<div class="paid-line">Pago: R$ ${Number(c.valorPago||c.valor).toFixed(2).replace('.',',')}</div>` : '';

  return `
    <div class="card ${catClass}" id="card-${c.id}" data-id="${c.id}">
      <div class="card-top">
        <div><div class="card-title">${c.nome}</div><div class="card-sub">Lançado por ${c.lancadoPorNome || ''}</div></div>
        <div class="badge-wrap">
          <div class="badge ${status.cls}">${status.label}</div>
          <button class="edit-btn" data-id="${c.id}">✏️</button>
        </div>
      </div>
      <div class="money-row">
        <div class="money-main">R$ ${valor.toFixed(2).replace('.', ',')}</div>
        <div class="money-due">venc. ${vencBR}</div>
      </div>
      ${paidLine}
      ${tags}
      ${payArea}
      ${amtRow}
      ${uploadBox}
    </div>`;
}

function pickFilter(btn){
  document.querySelectorAll('.sidebar button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const f = btn.dataset.filter;
  document.getElementById('contentTitle').textContent = (f === 'todas') ? 'Todas as contas' : btn.textContent.trim();
  renderList();
}

// ---------- pagamento ----------
function selectPay(btn){
  const row = btn.parentElement;
  row.querySelectorAll('button').forEach(b => b.classList.remove('sel-min', 'sel-total'));
  btn.textContent.includes('mínimo') ? btn.classList.add('sel-min') : btn.classList.add('sel-total');
  const card = document.getElementById('card-' + btn.dataset.id);
  const amtRow = card.querySelector('.amt-row');
  amtRow.querySelector('.amt-input').value = btn.dataset.amount;
  amtRow.classList.add('show');
  amtRow.querySelector('.amt-input').focus();
}
function parseParcelas(texto){
  if (!texto) return null;
  const m = texto.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  return { atual: Number(m[1]), total: Number(m[2]) };
}
function addMonths(dateStr, n){
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0,10);
}
function loadHistorico(){
  try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; }
  catch (e) { return []; }
}
function saveHistorico(h){ localStorage.setItem(HIST_KEY, JSON.stringify(h)); }

function confirmPay(btn){
  const id = btn.dataset.id;
  const card = document.getElementById('card-' + id);
  const val = Number(card.querySelector('.amt-input').value);
  const c = contasCache.find(x => x.id === id);
  if (!c) return;

  const parcelas = parseParcelas(c.parcelamento);
  const historico = loadHistorico();

  if (parcelas && parcelas.atual < parcelas.total) {
    // ainda tem parcela pela frente: registra o pagamento desta parcela no
    // histórico, e avança o próprio cartão pro mês seguinte (continua em Próximas).
    historico.push({
      id: 'h' + Date.now(), nome: `${c.nome} — parcela ${parcelas.atual}/${parcelas.total}`,
      valor: val, data: new Date().toISOString().slice(0,10), categoria: c.categoria
    });
    c.parcelamento = `${parcelas.atual + 1}/${parcelas.total}x`;
    c.vencimento = addMonths(c.vencimento, 1);
  } else {
    // última parcela (ou conta sem parcelamento): quita de vez.
    if (parcelas) {
      historico.push({
        id: 'h' + Date.now(), nome: `${c.nome} — parcela ${parcelas.atual}/${parcelas.total} (última)`,
        valor: val, data: new Date().toISOString().slice(0,10), categoria: c.categoria
      });
    }
    c.pago = true;
    c.valorPago = val;
    c.pagoEm = new Date().toISOString().slice(0,10);
  }
  c.pagoPor = currentUser.phone;
  saveContas();
  saveHistorico(historico);
  renderList();
  renderTotals();
}

function onReceiptChosen(e){
  const file = e.target.files[0];
  if (!file || !uploadTarget) return;
  if (file.size > 4 * 1024 * 1024) {
    showToast('Arquivo muito grande pro modo teste (máx. 4MB). Tenta uma foto mais leve.');
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;

    if (uploadTarget.tipo === 'card') {
      const c = contasCache.find(x => x.id === uploadTarget.id);
      if (c) {
        c.comprovanteNome = file.name;
        c.comprovanteData = dataUrl;
        saveContas();
        renderList();
      }
    } else if (uploadTarget.tipo === 'parcela') {
      const h = loadHistorico();
      const entry = h.find(x => x.id === uploadTarget.id);
      if (entry) {
        entry.comprovanteNome = file.name;
        entry.comprovanteData = dataUrl;
        saveHistorico(h);
      }
    }

    // se o detalhe do histórico estiver aberto, atualiza ele também
    if (document.getElementById('histSheet').classList.contains('show')) {
      openHistDetail(uploadTarget.tipo, uploadTarget.id);
    }
    showToast('Comprovante anexado.');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

// (edição de mínimo/parcelamento agora só acontece pelo formulário — lápis ✏️)

// ---------- adicionar / editar ----------
function openAddModal(id, presetCat){
  editingId = id || null;
  document.getElementById('sheetTitle').textContent = editingId ? 'Editar conta' : 'Nova conta';
  resetForm();
  if (editingId) {
    const c = contasCache.find(x => x.id === editingId);
    if (c) {
      document.getElementById('f-nome').value = c.nome || '';
      document.getElementById('f-valor').value = c.valor || '';
      document.getElementById('f-min').value = c.minimo || '';
      const p = parseParcelas(c.parcelamento);
      document.getElementById('f-numParcelas').value = p ? p.total : '';
      document.getElementById('f-valorParcela').value = c.valorParcela || '';
      document.getElementById('f-venc').value = c.vencimento || '';
      const catBtn = document.querySelector(`#segCat button[data-cat="${c.categoria}"]`);
      if (catBtn) pickCat(catBtn);
    }
  } else if (presetCat && presetCat !== 'todas') {
    const catBtn = document.querySelector(`#segCat button[data-cat="${presetCat}"]`);
    if (catBtn) pickCat(catBtn);
  }
  document.getElementById('overlay').classList.add('show');
  document.getElementById('sheet').classList.add('show');
}
function closeModal(){
  document.getElementById('overlay').classList.remove('show');
  document.getElementById('sheet').classList.remove('show');
  editingId = null;
}
function resetForm(){
  ['f-nome','f-valor','f-min','f-numParcelas','f-valorParcela','f-venc'].forEach(id => document.getElementById(id).value = '');
  document.querySelectorAll('#segCat button').forEach(b => b.classList.remove('active'));
  toggleCartaoFields(false);
  toggleNomeField(null);
}
function pickCat(btn){
  document.querySelectorAll('#segCat button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  toggleCartaoFields(btn.dataset.cat === 'cartao');
  toggleNomeField(btn.dataset.cat);
}
function toggleCartaoFields(show){ document.getElementById('cartaoFields').classList.toggle('show', show); }
function toggleNomeField(cat){
  document.getElementById('nomeField').classList.toggle('hide', cat === 'agua' || cat === 'forca');
}
function recalcParcela(){
  const total = Number(document.getElementById('f-valor').value) || 0;
  const n = Number(document.getElementById('f-numParcelas').value) || 0;
  if (n > 1 && total > 0) {
    document.getElementById('f-valorParcela').value = (total / n).toFixed(2);
  }
}

function saveEntry(){
  const catBtn = document.querySelector('#segCat button.active');
  if (!catBtn) { alert('Escolhe a categoria.'); return; }
  const categoria = catBtn.dataset.cat;

  let nome = document.getElementById('f-nome').value.trim();
  if (categoria === 'agua') nome = 'Água';
  if (categoria === 'forca') nome = 'Força';
  if (!nome) { alert('Preenche o nome da conta.'); return; }

  const valor = Number(document.getElementById('f-valor').value);
  const minimo = document.getElementById('f-min').value ? Number(document.getElementById('f-min').value) : null;
  const numParcelas = Number(document.getElementById('f-numParcelas').value) || 0;
  const valorParcelaDigitado = document.getElementById('f-valorParcela').value ? Number(document.getElementById('f-valorParcela').value) : null;
  const vencimento = document.getElementById('f-venc').value;
  if (!valor || !vencimento) { alert('Preenche valor e vencimento.'); return; }

  let parcelamento = null, valorParcela = null;
  if (categoria === 'cartao' && numParcelas > 1) {
    let atualExistente = 1;
    if (editingId) {
      const existente = contasCache.find(x => x.id === editingId);
      const p = parseParcelas(existente ? existente.parcelamento : null);
      if (p) atualExistente = p.atual;
    }
    parcelamento = `${atualExistente}/${numParcelas}x`;
    valorParcela = valorParcelaDigitado || Number((valor / numParcelas).toFixed(2));
  }

  if (editingId) {
    const c = contasCache.find(x => x.id === editingId);
    Object.assign(c, { categoria, nome, valor, minimo, parcelamento, valorParcela, vencimento });
  } else {
    contasCache.push({
      id: 'c' + Date.now(), categoria, nome, valor, minimo, parcelamento, valorParcela, vencimento,
      lancadoPor: currentUser.phone, lancadoPorNome: currentUser.nome, pago: false
    });
  }
  saveContas();
  renderList();
  renderTotals();
  closeModal();
}

// ---------- tema ----------
function toggleTheme(){
  document.body.classList.toggle('theme-light');
  document.getElementById('toggleTrack').classList.toggle('on', document.body.classList.contains('theme-light'));
}

// ---------- instalar PWA ----------
let deferredInstallPrompt = null;
function setupInstallPrompt(){
  const btn = document.getElementById('btnInstall');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    btn.classList.remove('hide');
  });
  btn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      showToast('Use "Adicionar à tela inicial" no menu do navegador.');
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    btn.classList.add('hide');
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(console.error);
  }
}

// ---------- backup ----------
function backupData(){
  const data = contasCache.length ? contasCache : [];
  const blob = new Blob([JSON.stringify({ exportado_em: new Date().toISOString(), contas: data }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dueto-backup-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast(data.length ? 'Backup gerado.' : 'Faça login primeiro.');
}

function showToast(msg){
  let t = document.getElementById('toastEl');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.id = 'toastEl'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}
