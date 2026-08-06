// ============================================================
// DUETO — versão com Firebase de verdade (login por número+senha + Firestore)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, NUMEROS_AUTORIZADOS } from "./firebase-config.js";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

const MAX_FILE_BYTES = 600 * 1024; // comprovante guardado direto no Firestore (sem Storage)
const REF_TODAY = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };

let currentUser = null;   // { uid, phone, nome, codigo }
let contasCache = [];
let historicoCache = [];
let unsubContas = null, unsubHistorico = null;
let editingId = null;
let uploadTarget = null;  // { tipo:'card'|'parcela', id }
let currentViewerData = null;

const SENHA_PADRAO = 'Krisium150'; // mesma senha pros dois números cadastrados

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnSendCode').addEventListener('click', doLogin);
  document.getElementById('loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
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

// ---------- LOGIN por número + senha (sem SMS) ----------
function normalizePhone(v){ return v.replace(/\D/g,''); }
function phoneToEmail(e164){ return e164.replace('+','') + '@dueto.local'; }

async function doLogin(){
  const raw = document.getElementById('loginPhone').value;
  const e164 = '+55' + normalizePhone(raw);
  const senha = document.getElementById('loginPassword').value;
  const err = document.getElementById('loginError');

  if (!NUMEROS_AUTORIZADOS[e164]) {
    err.textContent = 'Número não cadastrado. Só Fabrício e Hosana podem entrar.';
    return;
  }
  if (!senha) { err.textContent = 'Digita a senha.'; return; }

  err.textContent = 'Entrando...';
  const email = phoneToEmail(e164);
  try {
    await signInWithEmailAndPassword(auth, email, senha);
    // onAuthStateChanged assume o resto
  } catch (e) {
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
      // primeiro acesso desse número: cria a conta com a senha combinada
      try {
        await createUserWithEmailAndPassword(auth, email, senha);
      } catch (e2) {
        console.error(e2);
        err.textContent = 'Não consegui entrar. Confere a senha e tenta de novo.';
      }
    } else if (e.code === 'auth/wrong-password') {
      err.textContent = 'Senha errada.';
    } else {
      console.error(e);
      err.textContent = 'Não consegui entrar. Confere sua conexão e tenta de novo.';
    }
  }
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    const digits = user.email.split('@')[0];
    const e164 = '+' + digits;
    const info = NUMEROS_AUTORIZADOS[e164];
    if (!info) { signOut(auth); return; }
    currentUser = { uid: user.uid, phone: e164, nome: info.nome, codigo: info.codigo };
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appRoot').style.display = 'block';
    startListening();
  } else {
    currentUser = null;
    if (unsubContas) unsubContas();
    if (unsubHistorico) unsubHistorico();
    document.getElementById('appRoot').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
  }
});

// ---------- Firestore em tempo real ----------
function startListening(){
  const qContas = query(collection(db, 'contas'), orderBy('vencimento', 'asc'));
  unsubContas = onSnapshot(qContas, (snap) => {
    contasCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderList();
    renderTotals();
  }, (err) => {
    console.error(err);
    document.getElementById('list').innerHTML = '<div class="empty-state">Erro ao carregar. Confere sua conexão e as regras do Firestore.</div>';
  });

  const qHist = query(collection(db, 'historico'), orderBy('data', 'desc'));
  unsubHistorico = onSnapshot(qHist, (snap) => {
    historicoCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (currentSidebarFilter() === 'historico') renderList();
  });
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

  if (filtro === 'historico') { renderHistorico(list); return; }

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
    attachLongPress(card, async () => {
      if (!confirm('Apagar esta conta? Essa ação não pode ser desfeita.')) return;
      try { await deleteDoc(doc(db, 'contas', card.dataset.id)); }
      catch (e) { console.error(e); alert('Não consegui apagar. Tenta de novo.'); }
    });
  });
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

async function confirmPay(btn){
  const id = btn.dataset.id;
  const card = document.getElementById('card-' + id);
  const val = Number(card.querySelector('.amt-input').value);
  const c = contasCache.find(x => x.id === id);
  if (!c) return;
  const parcelas = parseParcelas(c.parcelamento);

  try {
    if (parcelas && parcelas.atual < parcelas.total) {
      // ainda tem parcela pela frente: registra o pagamento e avança pro próximo mês
      await addDoc(collection(db, 'historico'), {
        nome: `${c.nome} — parcela ${parcelas.atual}/${parcelas.total}`,
        valor: val, data: new Date().toISOString().slice(0,10), categoria: c.categoria,
        pagoPor: currentUser.phone, criadoEm: serverTimestamp()
      });
      await updateDoc(doc(db, 'contas', id), {
        parcelamento: `${parcelas.atual + 1}/${parcelas.total}x`,
        vencimento: addMonths(c.vencimento, 1)
      });
    } else if (c.categoria === 'cartao') {
      // cartão nunca "acaba": fecha essa fatura e já abre a próxima, zerada,
      // no mesmo dia do mês seguinte — fica esperando você lançar o valor
      // assim que a próxima fatura fechar.
      const nomeHist = parcelas ? `${c.nome} — parcela ${parcelas.atual}/${parcelas.total} (última)` : `${c.nome} — fatura`;
      await addDoc(collection(db, 'historico'), {
        nome: nomeHist, valor: val, data: new Date().toISOString().slice(0,10), categoria: c.categoria,
        pagoPor: currentUser.phone, criadoEm: serverTimestamp()
      });
      await updateDoc(doc(db, 'contas', id), {
        valor: 0, minimo: null, parcelamento: null, valorParcela: null,
        vencimento: addMonths(c.vencimento, 1), pago: false, valorPago: null,
        comprovanteNome: null, comprovanteData: null
      });
    } else {
      // água, força, despesas gerais: paga e some da lista de pendentes, vai pro histórico
      await updateDoc(doc(db, 'contas', id), {
        pago: true, valorPago: val, pagoPor: currentUser.phone,
        pagoEm: new Date().toISOString().slice(0,10)
      });
    }
  } catch (e) {
    console.error(e);
    alert('Não consegui salvar o pagamento. Confere sua conexão e tenta de novo.');
  }
}

function onReceiptChosen(e){
  const file = e.target.files[0];
  if (!file || !uploadTarget) return;
  if (file.size > MAX_FILE_BYTES) {
    showToast('Arquivo muito grande (máx. ~600KB, já que guardamos direto no Firestore). Tenta uma foto mais leve.');
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result;
    try {
      const colecao = uploadTarget.tipo === 'card' ? 'contas' : 'historico';
      await updateDoc(doc(db, colecao, uploadTarget.id), { comprovanteNome: file.name, comprovanteData: dataUrl });
      if (document.getElementById('histSheet').classList.contains('show')) {
        openHistDetail(uploadTarget.tipo, uploadTarget.id);
      }
      showToast('Comprovante anexado.');
    } catch (err) {
      console.error(err);
      showToast('Não consegui salvar o comprovante — pode ter passado do limite do Firestore.');
    }
  };
  reader.readAsDataURL(file);
  e.target.value = '';
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
function toggleNomeField(cat){ document.getElementById('nomeField').classList.toggle('hide', cat === 'agua' || cat === 'forca'); }
function recalcParcela(){
  const total = Number(document.getElementById('f-valor').value) || 0;
  const n = Number(document.getElementById('f-numParcelas').value) || 0;
  if (n > 1 && total > 0) document.getElementById('f-valorParcela').value = (total / n).toFixed(2);
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

  const payload = { categoria, nome, valor, minimo, parcelamento, valorParcela, vencimento };

  try {
    if (editingId) {
      await updateDoc(doc(db, 'contas', editingId), payload);
    } else {
      await addDoc(collection(db, 'contas'), {
        ...payload, pago: false,
        lancadoPor: currentUser.phone, lancadoPorNome: currentUser.nome,
        criadoEm: serverTimestamp()
      });
    }
    closeModal();
  } catch (e) {
    console.error(e);
    alert('Não consegui salvar. Confere sua conexão e tenta de novo.');
  }
}

// ---------- histórico ----------
function renderHistorico(list){
  const pagas = contasCache.filter(c => c.pago).map(c => ({
    tipo: 'card', id: c.id, nome: c.nome, valor: c.valorPago || c.valor,
    data: c.pagoEm || c.vencimento, categoria: c.categoria,
    comprovanteNome: c.comprovanteNome, comprovanteData: c.comprovanteData
  }));
  const parcelas = historicoCache.map(h => ({
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
    attachLongPress(el, async () => {
      const tipo = el.dataset.tipo, id = el.dataset.id;
      if (!confirm('Apagar este registro do histórico? Essa ação não pode ser desfeita.')) return;
      try { await deleteDoc(doc(db, tipo === 'card' ? 'contas' : 'historico', id)); }
      catch (e) { console.error(e); alert('Não consegui apagar. Tenta de novo.'); }
    });
  });
}

function findHistRecord(tipo, id){
  if (tipo === 'card') return contasCache.find(x => x.id === id);
  return historicoCache.find(x => x.id === id);
}

function openHistDetail(tipo, id){
  const rec = findHistRecord(tipo, id);
  if (!rec) return;
  uploadTarget = { tipo, id };
  const valor = rec.valorPago || rec.valor;
  const data = rec.pagoEm || rec.data || rec.vencimento;

  const receiptHtml = rec.comprovanteData
    ? `<div class="upload-box show attached" id="histReceiptBox"><div class="ic">✅</div><div class="txt">${rec.comprovanteNome}</div></div>`
    : `<div class="upload-box show" id="histReceiptBox"><div class="ic">📎</div><div class="txt">Anexar comprovante (foto ou PDF)</div></div>`;

  document.getElementById('histTitle').textContent = rec.nome;
  document.getElementById('histDetailBody').innerHTML = `
    <div class="hist-valor">R$ ${Number(valor).toFixed(2).replace('.', ',')}</div>
    <div class="hist-meta">Pago em ${data.split('-').reverse().join('/')}</div>
    <div class="hist-badge">✔ Pago</div>
    ${receiptHtml}
  `;
  document.getElementById('histReceiptBox').addEventListener('click', () => {
    if (rec.comprovanteData) openReceiptViewer(rec.comprovanteData, rec.comprovanteNome);
    else document.getElementById('receiptInput').click();
  });
  document.getElementById('histOverlay').classList.add('show');
  document.getElementById('histSheet').classList.add('show');
}
function closeHistDetail(){
  document.getElementById('histOverlay').classList.remove('show');
  document.getElementById('histSheet').classList.remove('show');
}

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

// ---------- segurar pra apagar ----------
function attachLongPress(el, onLongPress){
  let timer = null;
  const start = () => { timer = setTimeout(onLongPress, 550); };
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
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
  });
  btn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      showToast('Use "Adicionar à tela inicial" no menu do navegador.');
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(console.error);
  }
}

// ---------- backup ----------
function backupData(){
  const blob = new Blob([JSON.stringify({
    exportado_em: new Date().toISOString(),
    contas: contasCache,
    historico: historicoCache
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dueto-backup-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast(contasCache.length ? 'Backup gerado.' : 'Faça login primeiro pra baixar os dados reais.');
}

function showToast(msg){
  let t = document.getElementById('toastEl');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.id = 'toastEl'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}
