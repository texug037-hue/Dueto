// ============================================================
// CONFIGURAÇÃO DO FIREBASE — PREENCHA COM OS DADOS DO SEU PROJETO
// ============================================================
// Onde pegar: console.firebase.google.com -> seu projeto ->
// ⚙️ Configurações do projeto -> Seus apps -> Config do SDK
//
// Isso NÃO é segredo — a chave pública do Firebase é feita pra
// ficar exposta no navegador. Quem protege seus dados de verdade
// são as Regras de Segurança (firestore.rules), não essa chave.
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyB6STN4wBtC7cmeytPvzCGO062KmSv2_Kw",
  authDomain: "dueto-92a44.firebaseapp.com",
  projectId: "dueto-92a44",
  storageBucket: "dueto-92a44.firebasestorage.app",
  messagingSenderId: "310790339978",
  appId: "1:310790339978:web:e0d7592f3e4070d7aadc73"
};

// Os dois únicos números autorizados a entrar no Dueto.
// Formato E.164 (com +55 na frente).
export const NUMEROS_AUTORIZADOS = {
  "+5519997711319": { nome: "Fabrício", codigo: "F" },
  "+5519997711642": { nome: "Hosana",   codigo: "H" }
};
