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
  apiKey: "COLE_AQUI_A_API_KEY",
  authDomain: "SEU-PROJETO.firebaseapp.com",
  projectId: "SEU-PROJETO",
  storageBucket: "SEU-PROJETO.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxxxxxxxx"
};

// Os dois únicos números autorizados a entrar no Dueto.
// Formato E.164 (com +55 na frente).
export const NUMEROS_AUTORIZADOS = {
  "+5519997711319": { nome: "Fabrício", codigo: "F" },
  "+5519997711642": { nome: "Hosana",   codigo: "H" }
};
