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
let uploadTargetId = null;

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
  document.getElementById('receiptInput').addEventListener('change', onReceiptChosen);
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
  document.getElementById('totalVencidas').textContent = 'R$ ' + vencidas.toFixed(0);
  document.getElementById('totalHoje').textContent = 'R$ ' + venceHoje.toFixed(0);
  document.getElementById('totalMes').textContent = 'R$ ' + mes.toFixed(0);
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
  list.querySelectorAll('.upload-box:not(.attached)').forEach(b => b.addEventListener('click', () => { uploadTargetId = b.dataset.id; document.getElementById('receiptInput').click(); }));
}

function renderHistorico(list){
  const pagas = contasCache.filter(c => c.pago).map(c => ({
    nome: c.nome, valor: c.valorPago || c.valor, data: c.pagoEm || c.vencimento, categoria: c.categoria
  }));
  const parcelas = loadHistorico();
  const tudo = pagas.concat(parcelas).sort((a,b) => (a.data < b.data ? 1 : -1));

  if (tudo.length === 0) {
    list.innerHTML = '<div class="empty-state">Nada pago ainda. Assim que você quitar ou pagar uma parcela, aparece aqui.</div>';
    return;
  }
  document.getElementById('contentTitle').textContent = 'Histórico de pagamentos';
  list.innerHTML = '<div class="section-label">Pagas</div>' + tudo.map(h => `
    <div class="card cat-${h.categoria}">
      <div class="card-top">
        <div><div class="card-title">${h.nome}</div><div class="card-sub">Pago em ${h.data.split('-').reverse().join('/')}</div></div>
        <div class="badge ok">Pago</div>
      </div>
      <div class="money-row"><div class="money-main">R$ ${Number(h.valor).toFixed(2).replace('.', ',')}</div></div>
    </div>`).join('');
}

function cardHtml(c){
  const status = statusConta(c);
  const [y,m,d] = c.vencimento.split('-');
  const vencBR = d + '/' + m;
  const valor = Number(c.valor) || 0;
  const catClass = 'cat-' + c.categoria;

  const tags = (c.categoria === 'cartao') ?
    '<div class="card-tags">' +
      (c.minimo ? `<span class="tag">Mínimo R$ ${Number(c.minimo).toFixed(2).replace('.', ',')}</span>` : '') +
      (c.parcelamento ? `<span class="tag parcelado">${c.parcelamento}</span>` : '') +
    '</div>' : '';

  const payArea = c.pago ? '' : ((c.categoria === 'cartao' && c.minimo) ?
    `<div class="pay-toggle">
       <button class="pay-btn" data-id="${c.id}" data-amount="${c.minimo}">Paguei o mínimo</button>
       <button class="pay-btn" data-id="${c.id}" data-amount="${c.valor}">Paguei o total</button>
     </div>` :
    `<div class="pay-toggle"><button class="pay-btn" data-id="${c.id}" data-amount="${c.valor}">Marcar como pago</button></div>`
  );

  const amtRow = c.pago ? '' :
    `<div class="amt-row"><span class="amt-prefix">R$</span><input type="number" step="0.01" class="amt-input"><button class="amt-confirm" data-id="${c.id}">Confirmar</button></div>`;

  const uploadBox = c.comprovanteNome
    ? `<div class="upload-box show attached"><div class="ic">✅</div><div class="txt">${c.comprovanteNome}</div></div>`
    : `<div class="upload-box show" data-id="${c.id}"><div class="ic">📎</div><div class="txt">Anexar comprovante (foto ou PDF)</div></div>`;

  const paidLine = c.pago ? `<div class="paid-line">Pago: R$ ${Number(c.valorPago||c.valor).toFixed(2).replace('.',',')}</div>` : '';

  return `
    <div class="card ${catClass}" id="card-${c.id}">
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
  if (!file || !uploadTargetId) return;
  const c = contasCache.find(x => x.id === uploadTargetId);
  if (c) {
    c.comprovanteNome = file.name; // modo teste: só guarda o nome, não sobe o arquivo de verdade
    saveContas();
    renderList();
    showToast('Comprovante anexado (modo teste — o arquivo em si só sobe quando o Storage do Firebase estiver ativo).');
  }
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
      document.getElementById('f-parcelas').value = c.parcelamento || '';
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
  ['f-nome','f-valor','f-min','f-parcelas','f-venc'].forEach(id => document.getElementById(id).value = '');
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
  const parcelamento = document.getElementById('f-parcelas').value.trim() || null;
  const vencimento = document.getElementById('f-venc').value;
  if (!valor || !vencimento) { alert('Preenche valor e vencimento.'); return; }

  if (editingId) {
    const c = contasCache.find(x => x.id === editingId);
    Object.assign(c, { categoria, nome, valor, minimo, parcelamento, vencimento });
  } else {
    contasCache.push({
      id: 'c' + Date.now(), categoria, nome, valor, minimo, parcelamento, vencimento,
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
