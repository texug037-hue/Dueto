# Dueto — guia de publicação (passo a passo)

Eu montei o app inteiro, mas não tenho acesso à internet nem às suas
contas aqui neste ambiente — essas partes só você consegue fazer.
Leva uns 10-15 minutos.

## 1. Criar o projeto Firebase
1. Acesse console.firebase.google.com -> "Adicionar projeto" -> nome "Dueto".
2. Em **Build -> Authentication -> Sign-in method**, ative **Telefone**.
3. Em **Authentication -> Settings -> Authorized domains**, adicione o
   domínio do GitHub Pages que você vai usar (ex: `seuusuario.github.io`).
4. Em **Build -> Firestore Database**, crie o banco (modo produção).
5. Em **Build -> Storage**, ative o Storage (pros comprovantes de Pix).

## 2. Pegar a configuração do app
1. ⚙️ **Configurações do projeto -> Seus apps -> Web (`</>`)**.
2. Copie o objeto `firebaseConfig` gerado.
3. Cole no arquivo `firebase-config.js`, substituindo os valores de exemplo.

## 3. Aplicar as regras de segurança
1. **Firestore Database -> Regras**: cole o conteúdo de `firestore.rules`.
2. **Storage -> Regras**: cole o conteúdo de `storage.rules`.
3. Faça login uma vez com cada número (Fabrício e Hosana) pra criar os
   usuários. Depois, em **Authentication -> Users**, copie o UID de cada
   um e troque `UID_DO_FABRICIO` / `UID_DA_HOSANA` nos dois arquivos de
   regras acima (e publique de novo).

## 4. Publicar no GitHub Pages
```
git init
git add .
git commit -m "Dueto v0.7"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/dueto.git
git push -u origin main
```
No GitHub: **Settings -> Pages -> Branch: main -> Save**.
O app fica em `https://SEU_USUARIO.github.io/dueto/`.

## 5. Testar a instalação como app
Abra o link no celular (Chrome/Safari) -> toque em **⬇ Baixar app**
(ou "Adicionar à tela inicial" no menu do navegador). O ícone que você
mandou já está aplicado em `icons/`.

## Checklist de segurança já aplicado
- Login exclusivo por SMS (só os 2 números cadastrados entram; qualquer
  outro é bloqueado até no `onAuthStateChanged`, camada dupla).
- Firestore e Storage fecham tudo por padrão (`allow read, write: if false`)
  e só liberam pros 2 UIDs autorizados.
- Nenhuma chave secreta no código — a `apiKey` do Firebase é pública por
  design; quem protege os dados são as regras acima, não ela.
- Uploads de comprovante limitados a 8MB e só imagem/PDF.
- Service worker usa "rede primeiro", então os dados nunca ficam presos
  em cache velho.

## O que ainda falta pra ficar 100% pronto
- Trocar os placeholders de `firebase-config.js` e dos dois `.rules`.
- Ativar o **reCAPTCHA Enterprise** (o Firebase pede isso hoje em dia
  pra login por telefone em produção — ele guia você na hora de ativar).
- Depois de tudo publicado, a versão sobe pra v1.0.
