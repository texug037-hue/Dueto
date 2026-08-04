// ============================================================
// DUETO — lógica principal
// Firebase v10 modular SDK, carregado direto via CDN (sem build step,
// funciona publicando os arquivos puros no GitHub Pages).
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, doc, onSnapshot,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { firebaseConfig, NUMEROS_AUTORIZADOS } from "./firebase-config.js";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const storage = getStorage(fbApp);

const REF_TODAY = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };

let currentUser = null;      // { uid, phone, nome, codigo }
let unsubscribeContas = null;
let contasCache = [];
let editingId = null;
let confirmationResult = null;

// ---------- LOGIN ----------
window.addEventListener('DOMContentLoaded', () => {
  window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });

  document.getElementById('btnSendCode').addEventListener('click', enviarCodigo);
  document.getElementById('btnConfirmCode').addEventListener('click', confirmarCodigo);
  document.getElementById('btnBackupLogin').addEventListener('click', backupData);
  document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);
  document.getElementById('quickAddBtn').addEventListener('click', () => openAddModal(null, currentSidebarFilter()));
  document.getElementById('fabAdd').addEventListener('click', () => openAddModal(null, null));
  document.getElementById('btnCancelSheet').addEventListener('click', closeModal);
  document.getElementById('btnSaveSheet').addEventListener('click', saveEntry);
  document.getElementById('overlay').addEventListener('click', closeModal);
  document.querySelectorAll('#segCat button').forEach(b => b.addEventListener('click', () => pickCat(b)));
  document.querySelectorAll('.sidebar button').forEach(b => b.addEventListener('click', () => pickFilter(b)));

  setupInstallPrompt();
});

function normalizePhone(v){ return v.replace(/\D/g,''); }

async function enviarCodigo(){
  const raw = document.getElementById('loginPhone').value;
  const digits = normalizePhone(raw);
  const e164 = '+55' + digits;
  const err = document.getElementById('loginError');

  if (!NUMEROS_AUTORIZADOS[e164]) {
    err.textContent = 'Número não cadastrado. Só Fabrício e Hosana podem entrar.';
    return;
  }
  err.textContent = 'Enviando SMS...';
  try {
    confirmationResult = await signInWithPhoneNumber(auth, e164, window.recaptchaVerifier);
    err.textContent = '';
    document.getElementById('stepPhone').classList.add('hide');
    document.getElementById('stepCode').classList.remove('hide');
  } catch (e) {
    console.error(e);
    err.textContent = 'Não deu pra enviar o SMS. Confere o número e tenta de novo.';
  }
}

async function confirmarCodigo(){
  const code = document.getElementById('loginCode').value.trim();
  const err = document.getElementById('codeError');
  try {
    await confirmationResult.confirm(code);
    // onAuthStateChanged cuida do resto
  } catch (e) {
    console.error(e);
    err.textContent = 'Código errado. Confere e tenta de novo.';
  }
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    const e164 = user.phoneNumber;
    const info = NUMEROS_AUTORIZADOS[e164];
    if (!info) {
      // Alguém autenticou mas não está na lista dos dois — bloqueia e desloga.
      signOut(auth);
      return;
    }
    currentUser = { uid: user.uid, phone: e164, nome: info.nome, codigo: info.codigo };
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appRoot').style.display = 'block';
    startListeningContas();
  } else {
    currentUser = null;
    if (unsubscribeContas) unsubscribeContas();
    document.getElementById('appRoot').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
  }
});

// ---------- FIRESTORE: escuta em tempo real ----------
function startListeningContas(){
  const q = query(collection(db, 'contas'), orderBy('vencimento', 'asc'));
  unsubscribeContas = onSnapshot(q, (snap) => {
    contasCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderList();
    renderTotals();
  }, (err) => {
    console.error('Erro ao ler contas:', err);
    document.getElementById('list').innerHTML =
      '<div class="empty-state">Erro ao carregar. Confere sua conexão e as regras do Firestore.</div>';
  });
}

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
  const visiveis = contasCache.filter(c => filtro === 'todas' || c.categoria === filtro);

  if (visiveis.length === 0) {
    list.innerHTML = '<div class="empty-state">Nenhuma conta aqui ainda. Toque em "+" pra lançar.</div>';
    return;
  }

  const vencidas = visiveis.filter(c => !c.pago && diasAte(c.vencimento) < 0);
  const proximas = visiveis.filter(c => !c.pago && diasAte(c.vencimento) >= 0);
  const pagas = visiveis.filter(c => c.pago);

  let html = '';
  if (vencidas.length) html += '<div class="section-label">Vencidas</div>' + vencidas.map(cardHtml).join('');
  if (proximas.length) html += '<div class="section-label">Próximas</div>' + proximas.map(cardHtml).join('');
  if (pagas.length) html += '<div class="section-label">Pagas</div>' + pagas.map(cardHtml).join('');
  list.innerHTML = html;

  // religa os eventos (innerHTML apaga listeners antigos)
  list.querySelectorAll('.edit-btn').forEach(b => b.addEventListener('click', () => openAddModal(b.dataset.id, null)));
  list.querySelectorAll('.pay-btn').forEach(b => b.addEventListener('click', () => selectPay(b)));
  list.querySelectorAll('.amt-confirm').forEach(b => b.addEventListener('click', () => confirmPay(b)));
  list.querySelectorAll('.upload-box:not(.attached)').forEach(b => b.addEventListener('click', () => triggerUpload(b)));
  list.querySelectorAll('.tag.editable').forEach(t => t.addEventListener('blur', () => saveTagEdit(t)));
}

function cardHtml(c){
  const status = statusConta(c);
  const [y,m,d] = c.vencimento.split('-');
  const vencBR = d + '/' + m;
  const valor = Number(c.valor) || 0;
  const catClass = 'cat-' + c.categoria;

  const tags = (c.categoria === 'cartao') ?
    '<div class="card-tags">' +
      (c.minimo ? `<span class="tag editable" contenteditable="true" data-id="${c.id}" data-field="minimoLabel">Mínimo R$ ${Number(c.minimo).toFixed(2).replace('.', ',')}</span>` : '') +
      (c.parcelamento ? `<span class="tag parcelado editable" contenteditable="true" data-id="${c.id}" data-field="parcelamento">${c.parcelamento}</span>` : '') +
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

  const uploadBox = c.comprovanteUrl
    ? `<div class="upload-box show attached" onclick="window.open('${c.comprovanteUrl}','_blank')"><div class="ic">✅</div><div class="txt">Ver comprovante Pix</div></div>`
    : (c.pago ? '' : `<div class="upload-box" data-id="${c.id}"><div class="ic">📎</div><div class="txt">Anexar comprovante Pix</div></div>`);

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

async function confirmPay(btn){
  const id = btn.dataset.id;
  const card = document.getElementById('card-' + id);
  const val = Number(card.querySelector('.amt-input').value);
  try {
    await updateDoc(doc(db, 'contas', id), {
      pago: true,
      valorPago: val,
      pagoPor: currentUser.phone,
      pagoEm: serverTimestamp()
    });
  } catch (e) {
    console.error(e);
    alert('Não consegui salvar o pagamento. Tenta de novo.');
  }
}

let uploadTargetId = null;
function triggerUpload(box){
  uploadTargetId = box.dataset.id;
  document.getElementById('receiptInput').click();
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('receiptInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !uploadTargetId) return;
    try {
      const path = `comprovantes/${uploadTargetId}-${Date.now()}-${file.name}`;
      const sref = ref(storage, path);
      await uploadBytes(sref, file);
      const url = await getDownloadURL(sref);
      await updateDoc(doc(db, 'contas', uploadTargetId), { comprovanteUrl: url });
      showToast('Comprovante anexado.');
    } catch (err) {
      console.error(err);
      showToast('Não consegui subir o comprovante.');
    }
    e.target.value = '';
  });
});

async function saveTagEdit(tag){
  const id = tag.dataset.id;
  const field = tag.dataset.field;
  try {
    if (field === 'parcelamento') {
      await updateDoc(doc(db, 'contas', id), { parcelamento: tag.textContent.trim() });
    }
    // "minimoLabel" é só exibição (ex: "Mínimo R$ 68,00") — pra editar o valor
    // de verdade, o usuário deve usar o lápis (formulário completo).
  } catch (e) { console.error(e); }
}

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

async function saveEntry(){
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

  const payload = {
    categoria, nome, valor, minimo, parcelamento, vencimento,
    lancadoPor: currentUser.phone,
    lancadoPorNome: currentUser.nome,
    pago: false
  };

  try {
    if (editingId) {
      await updateDoc(doc(db, 'contas', editingId), payload);
    } else {
      payload.criadoEm = serverTimestamp();
      await addDoc(collection(db, 'contas'), payload);
    }
    closeModal();
  } catch (e) {
    console.error(e);
    alert('Não consegui salvar. Confere sua conexão e tenta de novo.');
  }
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
      showToast('Já está instalado, ou seu navegador não suporta instalação direta aqui — use "Adicionar à tela inicial" no menu do navegador.');
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
  showToast(data.length ? 'Backup gerado.' : 'Faça login primeiro pra baixar os dados reais.');
}

function showToast(msg){
  let t = document.getElementById('toastEl');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.id = 'toastEl'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
