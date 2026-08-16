// ============================================================
// DUETO — versão com Firebase de verdade (login por número+senha + Firestore)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut,
  setPersistence, inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, NUMEROS_AUTORIZADOS } from "./firebase-config.js";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
// Sem persistência entre sessões: toda vez que abrir o app, pede senha de novo
// (é assim que dá pra sempre acessar a tela de login com o botão "Baixar app").
setPersistence(auth, inMemoryPersistence).catch(console.error);

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
  document.getElementById('btnBiometria').addEventListener('click', entrarComBiometria);
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
  document.getElementById('btnDeleteReceipt').addEventListener('click', deleteReceipt);
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
  setupBackButton();
  atualizarBotaoBiometria();
});

// ---------- LOGIN por número + senha (sem SMS) ----------
function normalizePhone(v){ return v.replace(/\D/g,''); }
function phoneToEmail(e164){ return e164.replace('+','') + '@dueto.local'; }

let senhaDigitadaAgora = null;

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
  senhaDigitadaAgora = senha;
  await entrarComSenha(e164, senha, err);
}

async function entrarComSenha(e164, senha, err){
  if (err) err.textContent = 'Entrando...';
  const email = phoneToEmail(e164);
  try {
    await signInWithEmailAndPassword(auth, email, senha);
    // onAuthStateChanged assume o resto
  } catch (e) {
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
      try {
        await createUserWithEmailAndPassword(auth, email, senha);
      } catch (e2) {
        console.error(e2);
        if (err) err.textContent = 'Não consegui entrar. Confere a senha e tenta de novo.';
      }
    } else if (e.code === 'auth/wrong-password') {
      if (err) err.textContent = 'Senha errada.';
    } else {
      console.error(e);
      if (err) err.textContent = 'Não consegui entrar. Confere sua conexão e tenta de novo.';
    }
  }
}

// ---------- login por biometria (WebAuthn) ----------
const WEBAUTHN_KEY = 'dueto_biometria_cred';

function suportaBiometria(){ return !!(window.PublicKeyCredential && navigator.credentials); }

function credenciaisSalvas(){
  try { return JSON.parse(localStorage.getItem(WEBAUTHN_KEY)) || null; }
  catch (e) { return null; }
}

function atualizarBotaoBiometria(){
  const btn = document.getElementById('btnBiometria');
  const saved = credenciaisSalvas();
  if (saved && suportaBiometria()) {
    btn.classList.remove('hide');
    btn.textContent = `👆 Entrar como ${NUMEROS_AUTORIZADOS[saved.phone] ? NUMEROS_AUTORIZADOS[saved.phone].nome : ''}`;
  } else {
    btn.classList.add('hide');
  }
}

async function ativarBiometriaNesteAparelho(e164, senha){
  if (!suportaBiometria()) return;
  try {
    const disponivel = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!disponivel) return;
    const ativar = confirm('Quer ativar login por impressão digital / Face neste aparelho, pra não precisar digitar a senha de novo?');
    if (!ativar) return;

    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Dueto' },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: e164,
          displayName: NUMEROS_AUTORIZADOS[e164].nome
        },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000
      }
    });
    const credIdB64 = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
    localStorage.setItem(WEBAUTHN_KEY, JSON.stringify({ credId: credIdB64, phone: e164, senha }));
    showToast('Biometria ativada neste aparelho.');
    atualizarBotaoBiometria();
  } catch (e) {
    console.error(e);
    showToast('Não deu pra ativar a biometria agora.');
  }
}

async function entrarComBiometria(){
  const saved = credenciaisSalvas();
  const err = document.getElementById('loginError');
  if (!saved) return;
  try {
    const credIdBytes = Uint8Array.from(atob(saved.credId), c => c.charCodeAt(0));
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: credIdBytes, type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000
      }
    });
    // biometria confirmada neste aparelho -> completa o login de verdade
    await entrarComSenha(saved.phone, saved.senha, err);
  } catch (e) {
    console.error(e);
    err.textContent = 'Não reconheci a biometria. Usa a senha.';
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
    pedirPermissaoNotificacao();
    startListening();
    if (senhaDigitadaAgora && !credenciaisSalvas()) {
      ativarBiometriaNesteAparelho(e164, senhaDigitadaAgora);
    }
    senhaDigitadaAgora = null;
  } else {
    currentUser = null;
    if (unsubContas) unsubContas();
    if (unsubHistorico) unsubHistorico();
    primeiraCargaContas = true;
    primeiraCargaHistorico = true;
    document.getElementById('appRoot').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
  }
});

// ---------- Firestore em tempo real ----------
let primeiraCargaContas = true;
let primeiraCargaHistorico = true;

function startListening(){
  const qContas = query(collection(db, 'contas'), orderBy('vencimento', 'asc'));
  unsubContas = onSnapshot(qContas, (snap) => {
    if (!primeiraCargaContas) {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const c = change.doc.data();
          notificar('Nova conta lançada', `${c.nome} — R$ ${Number(c.valor).toFixed(2).replace('.', ',')}`);
        }
      });
    }
    primeiraCargaContas = false;
    contasCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderList();
    renderTotals();
  }, (err) => {
    console.error(err);
    document.getElementById('list').innerHTML = '<div class="empty-state">Erro ao carregar. Confere sua conexão e as regras do Firestore.</div>';
  });

  const qHist = query(collection(db, 'historico'), orderBy('data', 'desc'));
  unsubHistorico = onSnapshot(qHist, (snap) => {
    if (!primeiraCargaHistorico) {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const h = change.doc.data();
          notificar('Pagamento registrado', `${h.nome} — R$ ${Number(h.valor).toFixed(2).replace('.', ',')}`);
        }
      });
    }
    primeiraCargaHistorico = false;
    historicoCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (currentSidebarFilter() === 'historico' || currentSidebarFilter() === 'resumo') renderList();
  });
}

// ---------- notificações ----------
async function pedirPermissaoNotificacao(){
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch (e) { console.error(e); }
  }
}

async function notificar(titulo, corpo){
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    showToast(`${titulo}: ${corpo}`);
    return;
  }
  const opcoes = { body: corpo, icon: './icon-192.png', badge: './badge-96.png', vibrate: [200, 100, 200] };
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(titulo, opcoes);
    } else {
      new Notification(titulo, opcoes);
    }
  } catch (e) {
    console.error(e);
    showToast(`${titulo}: ${corpo}`);
  }
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

// Agrupa as contas vencidas por categoria, mas a ordem dos grupos é definida
// pela conta mais vencida de cada grupo (o grupo com a mais antiga entra primeiro).
// Dentro do grupo, todas ficam juntas, ordenadas da mais vencida pra menos vencida.
function agruparVencidasPorCategoria(lista){
  const grupos = {};
  lista.forEach(c => {
    if (!grupos[c.categoria]) grupos[c.categoria] = [];
    grupos[c.categoria].push(c);
  });
  const categorias = Object.keys(grupos).map(cat => {
    grupos[cat].sort((a, b) => a.vencimento < b.vencimento ? -1 : 1); // mais vencida primeiro
    return { cat, itens: grupos[cat], maisVencida: grupos[cat][0].vencimento };
  });
  categorias.sort((a, b) => a.maisVencida < b.maisVencida ? -1 : 1); // grupo mais vencido primeiro
  let resultado = [];
  categorias.forEach(g => { resultado = resultado.concat(g.itens); });
  return resultado;
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
  if (filtro === 'resumo') { renderResumo(list); return; }

  const visiveis = contasCache.filter(c => !c.pago && (filtro === 'todas' || c.categoria === filtro));
  if (visiveis.length === 0) {
    list.innerHTML = '<div class="empty-state">Nenhuma conta aqui ainda. Toque em "+" pra lançar.</div>';
    return;
  }
  const vencidas = agruparVencidasPorCategoria(visiveis.filter(c => diasAte(c.vencimento) < 0));
  const proximas = visiveis.filter(c => diasAte(c.vencimento) >= 0);

  let html = '';
  if (vencidas.length) html += '<div class="section-label">Vencidas</div>' + vencidas.map(cardHtml).join('');
  if (proximas.length) html += '<div class="section-label">Próximas</div>' + proximas.map(cardHtml).join('');
  list.innerHTML = html;

  list.querySelectorAll('.edit-btn').forEach(b => b.addEventListener('click', () => openAddModal(b.dataset.id, null)));
  list.querySelectorAll('.pay-btn').forEach(b => b.addEventListener('click', () => selectPay(b)));
  list.querySelectorAll('.entrada-btn').forEach(b => b.addEventListener('click', () => openSetupEntrada(b.dataset.id)));
  list.querySelectorAll('.setup-cancel').forEach(b => b.addEventListener('click', () => closeSetupEntrada(b.dataset.id)));
  list.querySelectorAll('.setup-confirm').forEach(b => b.addEventListener('click', () => confirmSetupEntrada(b.dataset.id)));
  list.querySelectorAll('.amt-confirm').forEach(b => b.addEventListener('click', () => confirmPay(b)));
  list.querySelectorAll('.amt-cancel').forEach(b => b.addEventListener('click', () => cancelPay(b)));
  list.querySelectorAll('.upload-box:not(.attached)').forEach(b => b.addEventListener('click', () => { uploadTarget = { tipo:'card', id:b.dataset.id }; document.getElementById('receiptInput').click(); }));
  list.querySelectorAll('.upload-box.attached').forEach(b => b.addEventListener('click', () => {
    const c = contasCache.find(x => x.id === b.dataset.id);
    if (c && c.comprovanteData) openReceiptViewer(c.comprovanteData, c.comprovanteNome, 'card', c.id);
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
      (parcelasInfo ? `<span class="tag parcelado">${parcelasInfo.atual === 0 ? 'Entrada' : 'Parcela ' + parcelasInfo.atual + '/' + parcelasInfo.total}${c.valorParcela ? ' · R$ ' + Number(c.valorParcela).toFixed(2).replace('.', ',') : ''}</span>` : '') +
    '</div>' : '';

  const temEntradaPendente = (c.categoria === 'cartao' && c.minimo && !parcelasInfo);

  const payArea = c.pago ? '' :
    (parcelasInfo ?
      `<div class="pay-toggle"><button class="pay-btn" data-id="${c.id}" data-amount="${c.valorParcela || (valor / parcelasInfo.total)}">${parcelasInfo.atual === 0 ? 'Pagar entrada' : 'Pagar parcela ' + parcelasInfo.atual + '/' + parcelasInfo.total}</button></div>` :
    (temEntradaPendente ?
    `<div class="pay-toggle">
       <button class="entrada-btn" data-id="${c.id}">Entrada</button>
       <button class="pay-btn" data-id="${c.id}" data-amount="${c.valor}">Paguei o total</button>
     </div>` :
    `<div class="pay-toggle"><button class="pay-btn" data-id="${c.id}" data-amount="${c.valor}">Marcar como pago</button></div>`
  ));

  const setupRow = (c.pago || !temEntradaPendente) ? '' :
    `<div class="setup-row" data-id="${c.id}">
       <div class="amt-line1"><span class="amt-prefix">Entrada R$</span><input type="number" step="0.01" class="setup-valor-input" value="${c.minimo}"></div>
       <div class="amt-line1"><span class="amt-prefix">Em quantas vezes</span><input type="number" min="1" class="setup-parcelas-input" placeholder="Ex: 3"></div>
       <div class="amt-actions"><button class="setup-cancel" data-id="${c.id}">Cancelar</button><button class="setup-confirm" data-id="${c.id}">Confirmar</button></div>
     </div>`;

  const amtRow = c.pago ? '' :
    `<div class="amt-row">
       <div class="amt-line1"><span class="amt-prefix">R$</span><input type="number" step="0.01" class="amt-input"></div>
       <div class="amt-actions"><button class="amt-cancel" data-id="${c.id}">Cancelar</button><button class="amt-confirm" data-id="${c.id}">Confirmar</button></div>
     </div>`;

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
      ${setupRow}
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

function cancelPay(btn){
  const card = document.getElementById('card-' + btn.dataset.id);
  card.querySelector('.amt-row').classList.remove('show');
  card.querySelectorAll('.pay-toggle button').forEach(b => b.classList.remove('sel-min', 'sel-total'));
}

function openSetupEntrada(id){
  const card = document.getElementById('card-' + id);
  card.querySelector('.setup-row').classList.add('show');
}
function closeSetupEntrada(id){
  const card = document.getElementById('card-' + id);
  card.querySelector('.setup-row').classList.remove('show');
}
async function confirmSetupEntrada(id){
  const card = document.getElementById('card-' + id);
  const row = card.querySelector('.setup-row');
  const valorEntrada = Number(row.querySelector('.setup-valor-input').value);
  const numParcelas = Number(row.querySelector('.setup-parcelas-input').value);
  if (!valorEntrada || valorEntrada <= 0) { alert('Preenche o valor da entrada.'); return; }
  if (!numParcelas || numParcelas < 1) { alert('Preenche em quantas vezes vai parcelar o resto.'); return; }

  const c = contasCache.find(x => x.id === id);
  if (!c) return;
  const restante = Math.max(c.valor - valorEntrada, 0);
  const valorParcela = Number((restante / numParcelas).toFixed(2));

  try {
    await addDoc(collection(db, 'historico'), {
      nome: `${c.nome} — entrada`, valor: valorEntrada,
      data: new Date().toISOString().slice(0,10), categoria: c.categoria,
      pagoPor: currentUser.phone, criadoEm: serverTimestamp()
    });
    await updateDoc(doc(db, 'contas', id), {
      parcelamento: `1/${numParcelas}x`,
      valorParcela,
      vencimento: addMonths(c.vencimento, 1),
      comprovanteNome: null, comprovanteData: null
    });
  } catch (e) {
    console.error(e);
    alert('Não consegui salvar a entrada. Tenta de novo.');
  }
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
      const nomeLog = parcelas.atual === 0 ? `${c.nome} — entrada` : `${c.nome} — parcela ${parcelas.atual}/${parcelas.total}`;
      await addDoc(collection(db, 'historico'), {
        nome: nomeLog,
        valor: val, data: new Date().toISOString().slice(0,10), categoria: c.categoria,
        pagoPor: currentUser.phone, criadoEm: serverTimestamp()
      });
      await updateDoc(doc(db, 'contas', id), {
        parcelamento: `${parcelas.atual + 1}/${parcelas.total}x`,
        vencimento: addMonths(c.vencimento, 1),
        comprovanteNome: null, comprovanteData: null
      });
    } else {
      // toda conta é recorrente agora (água, força, geral, cartão sem parcela):
      // registra o pagamento no histórico e já reabre pro mês seguinte, no
      // mesmo dia de vencimento, com o valor zerado esperando a próxima edição.
      const nomeHist = parcelas ? `${c.nome} — parcela ${parcelas.atual}/${parcelas.total} (última)` : c.nome;
      await addDoc(collection(db, 'historico'), {
        nome: nomeHist, valor: val, data: new Date().toISOString().slice(0,10), categoria: c.categoria,
        pagoPor: currentUser.phone, criadoEm: serverTimestamp()
      });
      const reset = {
        valor: 0, vencimento: addMonths(c.vencimento, 1), pago: false, valorPago: null,
        comprovanteNome: null, comprovanteData: null
      };
      if (c.categoria === 'cartao') { reset.minimo = null; reset.parcelamento = null; reset.valorParcela = null; }
      await updateDoc(doc(db, 'contas', id), reset);
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
  const btnReset = document.getElementById('btnResetEntrada');
  btnReset.classList.add('hide');
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
      if (c.categoria === 'cartao' && p && p.atual > 0) {
        btnReset.classList.remove('hide');
        btnReset.onclick = () => resetParaEntrada(c.id, p.total);
      }
    }
  } else if (presetCat && presetCat !== 'todas') {
    const catBtn = document.querySelector(`#segCat button[data-cat="${presetCat}"]`);
    if (catBtn) pickCat(catBtn);
  }
  document.getElementById('overlay').classList.add('show');
  document.getElementById('sheet').classList.add('show');
}

async function resetParaEntrada(id, total){
  if (!confirm('Reiniciar esse cartão como Entrada? Isso volta a contagem de parcelas pro começo (0/' + total + ').')) return;
  try {
    await updateDoc(doc(db, 'contas', id), { parcelamento: `0/${total}x` });
    closeModal();
  } catch (e) {
    console.error(e);
    alert('Não consegui reiniciar. Tenta de novo.');
  }
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
  if (categoria === 'cartao' && numParcelas >= 1) {
    let atualExistente = 0; // conta nova sempre começa na Entrada
    if (editingId) {
      const existente = contasCache.find(x => x.id === editingId);
      const p = parseParcelas(existente ? existente.parcelamento : null);
      if (p) atualExistente = p.atual; // editando, mantém o progresso atual
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

// ---------- resumo mensal ----------
const MESES_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const CAT_LABEL = { cartao: 'Cartões', agua: 'Água', forca: 'Força', geral: 'Despesas gerais' };
const CAT_COR = { cartao: 'var(--cartao)', agua: 'var(--agua)', forca: 'var(--forca)', geral: 'var(--geral)' };

function renderResumo(list){
  const hoje = REF_TODAY();
  const anoMes = hoje.toISOString().slice(0, 7); // "2026-08"
  const doMes = historicoCache.filter(h => h.data && h.data.startsWith(anoMes));
  const totalMes = doMes.reduce((s, h) => s + (Number(h.valor) || 0), 0);

  const porCategoria = {};
  doMes.forEach(h => { porCategoria[h.categoria] = (porCategoria[h.categoria] || 0) + (Number(h.valor) || 0); });

  const porPessoa = {};
  doMes.forEach(h => {
    const info = NUMEROS_AUTORIZADOS[h.pagoPor];
    const nome = info ? info.nome : 'Outro';
    porPessoa[nome] = (porPessoa[nome] || 0) + (Number(h.valor) || 0);
  });

  const barrasCategoria = Object.keys(CAT_LABEL).map(cat => {
    const v = porCategoria[cat] || 0;
    const pct = totalMes > 0 ? Math.round((v / totalMes) * 100) : 0;
    return `<div class="resumo-row">
      <div class="resumo-row-top"><span>${CAT_LABEL[cat]}</span><span>R$ ${v.toFixed(2).replace('.', ',')}</span></div>
      <div class="resumo-bar-track"><div class="resumo-bar-fill" style="width:${pct}%;background:${CAT_COR[cat]}"></div></div>
    </div>`;
  }).join('');

  const nomesPessoa = Object.keys(porPessoa);
  const barrasPessoa = nomesPessoa.length ? nomesPessoa.map(nome => {
    const v = porPessoa[nome];
    const pct = totalMes > 0 ? Math.round((v / totalMes) * 100) : 0;
    return `<div class="resumo-row">
      <div class="resumo-row-top"><span>${nome}</span><span>R$ ${v.toFixed(2).replace('.', ',')}</span></div>
      <div class="resumo-bar-track"><div class="resumo-bar-fill" style="width:${pct}%;background:var(--gold)"></div></div>
    </div>`;
  }).join('') : '<div class="empty-state">Nada pago este mês ainda.</div>';

  const gruposCat = { cartao: [], agua: [], forca: [], geral: [] };
  contasCache.forEach(c => { if (gruposCat[c.categoria]) gruposCat[c.categoria].push(c); });
  Object.keys(gruposCat).forEach(cat => gruposCat[cat].sort((a, b) => a.vencimento < b.vencimento ? -1 : 1));

  const acordeaoHtml = Object.keys(CAT_LABEL).map(cat => {
    const itens = gruposCat[cat];
    const totalCat = itens.reduce((s, c) => s + (Number(c.valor) || 0), 0);
    const corpo = itens.length ? itens.map(c => {
      const st = statusConta(c);
      return `<div class="resumo-item">
        <span class="resumo-item-nome">${c.nome}</span>
        <span class="badge ${st.cls}">${st.label}</span>
        <span class="resumo-item-valor">R$ ${Number(c.valor).toFixed(2).replace('.', ',')}</span>
      </div>`;
    }).join('') : '<div class="empty-state">Nenhuma conta aqui ainda.</div>';

    return `<div class="resumo-cat">
      <button class="resumo-cat-head" data-cat="${cat}">
        <span>${CAT_LABEL[cat]} <span class="resumo-cat-count">(${itens.length})</span></span>
        <span class="resumo-cat-right">R$ ${totalCat.toFixed(2).replace('.', ',')} <span class="resumo-chevron">▾</span></span>
      </button>
      <div class="resumo-cat-body" id="resumoCat-${cat}">${corpo}</div>
    </div>`;
  }).join('');

  document.getElementById('contentTitle').textContent = 'Resumo do mês';
  list.innerHTML = `
    <div class="resumo-total">
      <div class="resumo-total-lbl">Total pago em ${MESES_PT[hoje.getMonth()]}/${hoje.getFullYear()}</div>
      <div class="resumo-total-val">R$ ${totalMes.toFixed(2).replace('.', ',')}</div>
    </div>
    <div class="section-label">Por categoria</div>
    ${barrasCategoria}
    <div class="section-label">Por pessoa</div>
    ${barrasPessoa}
    <div class="section-label">Todos os cartões e contas</div>
    ${acordeaoHtml}
  `;

  list.querySelectorAll('.resumo-cat-head').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = document.getElementById('resumoCat-' + btn.dataset.cat);
      body.classList.toggle('show');
      btn.classList.toggle('open');
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
    if (rec.comprovanteData) openReceiptViewer(rec.comprovanteData, rec.comprovanteNome, tipo, id);
    else document.getElementById('receiptInput').click();
  });
  document.getElementById('histOverlay').classList.add('show');
  document.getElementById('histSheet').classList.add('show');
}
function closeHistDetail(){
  document.getElementById('histOverlay').classList.remove('show');
  document.getElementById('histSheet').classList.remove('show');
}

function openReceiptViewer(dataUrl, nome, tipo, id){
  currentViewerData = { dataUrl, nome, tipo, id };
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

async function deleteReceipt(){
  if (!currentViewerData || !currentViewerData.tipo) return;
  if (!confirm('Apagar esse comprovante?')) return;
  const { tipo, id } = currentViewerData;
  try {
    await updateDoc(doc(db, tipo === 'card' ? 'contas' : 'historico', id), { comprovanteNome: null, comprovanteData: null });
    closeReceiptViewer();
    if (document.getElementById('histSheet').classList.contains('show')) openHistDetail(tipo, id);
  } catch (e) {
    console.error(e);
    alert('Não consegui apagar o comprovante. Tenta de novo.');
  }
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

// ---------- botão voltar do Android: fecha telas internas antes de sair do app ----------
function setupBackButton(){
  history.pushState({ dueto: true }, '');

  window.addEventListener('popstate', () => {
    if (document.getElementById('sheet').classList.contains('show')) {
      closeModal();
      history.pushState({ dueto: true }, '');
      return;
    }
    if (document.getElementById('histSheet').classList.contains('show')) {
      closeHistDetail();
      history.pushState({ dueto: true }, '');
      return;
    }
    if (document.getElementById('receiptViewer').classList.contains('show')) {
      closeReceiptViewer();
      history.pushState({ dueto: true }, '');
      return;
    }
    if (currentSidebarFilter() !== 'todas') {
      const btnTodos = document.querySelector('.sidebar button[data-filter="todas"]');
      if (btnTodos) pickFilter(btnTodos);
      history.pushState({ dueto: true }, '');
      return;
    }
    // nada aberto e já na tela principal: pergunta antes de sair de verdade
    if (confirm('Sair do Dueto?')) {
      history.back();
    } else {
      history.pushState({ dueto: true }, '');
    }
  });
}
