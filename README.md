# ✨ Lash Studio - Sistema de Agendamento Online

Sistema completo de agendamento para salão de cílios com site público para clientes e painel administrativo.

## 🌟 Funcionalidades

### Site Público (para clientes)
- Agendamento online em 4 passos
- Escolha de serviço, data e horário
- Visualização de horários disponíveis
- Confirmação automática

### Painel Admin (para você)
- **Dashboard** - Resumo do negócio
- **Agendamentos Online** - Vê e confirma agendamentos do site
- **Clientes** - Cadastro de clientes
- **Agenda Manual** - Agendamentos feitos por você
- **Serviços** - Catálogo de serviços
- **Vendas** - Histórico financeiro
- **Estoque** - Controle de produtos

### WhatsApp Integrado (semi-automático)
- ✅ Ao confirmar agendamento → abre WhatsApp com mensagem pronta
- ❌ Ao cancelar → abre WhatsApp com mensagem de cancelamento
- 🔔 Lembrete 1 dia antes → alerta no painel + botão para enviar

---

## 🚀 Como Colocar Online (Render + GitHub)

### Passo 1: Criar repositório no GitHub

1. Acesse [github.com](https://github.com) e faça login
2. Clique em **"New repository"** (botão verde)
3. Nome: `lash-studio` (ou o que preferir)
4. Deixe **Public**
5. Clique **"Create repository"**

### Passo 2: Subir os arquivos

No seu computador, abra o terminal na pasta do projeto e rode:

```bash
git init
git add .
git commit -m "Primeiro commit"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/lash-studio.git
git push -u origin main
```

### Passo 3: Criar banco de dados no Render

1. Acesse [render.com](https://render.com) e faça login
2. Clique em **"New +"** → **"PostgreSQL"**
3. Configure:
   - **Name:** `lash-studio-db`
   - **Region:** Ohio (ou mais perto de você)
   - **Instance Type:** Free
4. Clique **"Create Database"**
5. Aguarde criar e **copie a "Internal Database URL"** (vai precisar depois)

### Passo 4: Criar o Web Service no Render

1. Clique em **"New +"** → **"Web Service"**
2. Conecte seu GitHub e selecione o repositório `lash-studio`
3. Configure:
   - **Name:** `lash-studio`
   - **Region:** Mesmo do banco (Ohio)
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free

4. Em **"Environment Variables"**, adicione:
   ```
   DATABASE_URL = [cole a Internal Database URL do passo 3]
   NODE_ENV = production
   ADMIN_PASSWORD = [escolha uma senha forte]
   ```
   
   ⚠️ **IMPORTANTE:** A `ADMIN_PASSWORD` é a senha que sua amiga vai usar pra entrar no painel admin!

5. Clique **"Create Web Service"**

### Passo 5: Aguardar o deploy

- O Render vai instalar as dependências e iniciar o servidor
- Pode demorar uns 2-5 minutos
- Quando aparecer **"Live"**, tá pronto! 🎉

### Passo 6: Acessar seu site

- **Site público:** `https://lash-studio.onrender.com`
- **Painel admin:** `https://lash-studio.onrender.com/admin`

### 🔐 Login no Admin

O painel admin é protegido por senha! Quando acessar `/admin`:

1. Aparece a tela de login
2. Digite a senha que você configurou em `ADMIN_PASSWORD`
3. Clique "Entrar"
4. Pronto! A sessão fica salva por 24 horas

Para sair, clique em **"🚪 Sair"** no menu lateral.

**Para trocar a senha:**
1. No Render, vá em seu Web Service
2. Clique em "Environment"
3. Mude o valor de `ADMIN_PASSWORD`
4. O Render reinicia automaticamente

---

## 📱 Como Funciona o WhatsApp

O sistema é **semi-automático** (grátis e sem risco de bloqueio):

### Quando cliente agenda:
1. Aparece na aba "Agendamentos Online" como **Pendente**
2. Você clica em ✅ **Confirmar**
3. Abre o WhatsApp com a mensagem pronta
4. Você só clica em **Enviar**

### Mensagem de confirmação:
```
Olá Maria! 💕

✅ Seu agendamento foi CONFIRMADO!

📅 Data: 15/01/2024
⏰ Horário: 14:00
💅 Serviço: Extensão Efeito Fox

Te esperamos! ✨

Lash Studio
```

### Lembrete (1 dia antes):
- Aparece um alerta amarelo no Dashboard e na aba Online
- Clique no botão com o nome da cliente
- Abre WhatsApp com lembrete pronto

---

## 🔧 Estrutura do Projeto

```
lash-studio-online/
├── public/
│   ├── index.html      ← Site público (clientes agendam aqui)
│   └── admin.html      ← Painel administrativo
├── server/
│   └── index.js        ← API Node.js + Express
├── package.json
└── README.md
```

---

## 💡 Dicas

### Horários de funcionamento
Por padrão, o sistema mostra horários das 9h às 18h. Para mudar, edite no arquivo `server/index.js`:
```javascript
const allSlots = ['09:00', '10:00', '11:00', ...];
```

### Domínio personalizado
Você pode usar um domínio próprio (ex: www.lashstudio.com.br):
1. No Render, vá em Settings → Custom Domains
2. Adicione seu domínio
3. Configure o DNS no Registro.br ou onde comprou

### Backup dos dados
O banco PostgreSQL do Render Free mantém os dados por 90 dias. Para planos pagos, tem backup automático.

---

## ❓ Problemas Comuns

### "Application Error" ao acessar
- Verifique se a DATABASE_URL está correta nas variáveis de ambiente
- Veja os logs em Render → Logs

### Banco não conecta
- Certifique que usou a **Internal Database URL** (não a External)
- As duas precisam estar na mesma região

### Site demora pra carregar
- No plano Free, o Render "dorme" após 15min sem acesso
- A primeira visita pode demorar ~30s pra "acordar"
- Planos pagos não tem esse delay

---

## 📞 Suporte

Qualquer dúvida, é só perguntar! 💕

---

Feito com ✨ para Lash Studio
