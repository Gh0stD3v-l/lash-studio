require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Senha do admin (configurar no Render como ADMIN_PASSWORD)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Senha para revelar dados sensíveis (configurar no Render como REVEAL_PASSWORD)
const REVEAL_PASSWORD = process.env.REVEAL_PASSWORD;

// Tokens de sessão ativos (em memória)
const activeSessions = new Map();

// Tokens de revelação de dados (em memória)
const revealTokens = new Map();

// Funções de mascaramento
function mascararCPF(cpf) {
  if (!cpf) return null;
  const clean = cpf.replace(/\D/g, '');
  if (clean.length < 6) return '***.***.***-**';
  return '***.' + clean.slice(3, 6) + '.***-**';
}

function mascararTelefone(tel) {
  if (!tel) return null;
  const clean = tel.replace(/\D/g, '');
  if (clean.length < 4) return '(**) *****-****';
  return '(**) *****-' + clean.slice(-4);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ==================== AUTENTICAÇÃO ====================

// Login
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, { createdAt: Date.now() });
    
    // Limpar sessões antigas (mais de 24h)
    const now = Date.now();
    for (const [t, data] of activeSessions) {
      if (now - data.createdAt > 24 * 60 * 60 * 1000) {
        activeSessions.delete(t);
      }
    }
    
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Senha incorreta' });
  }
});

// Verificar token
app.post('/api/auth/verify', (req, res) => {
  const { token } = req.body;
  
  if (token && activeSessions.has(token)) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const { token } = req.body;
  activeSessions.delete(token);
  revealTokens.delete(token); // Também remove token de revelação
  res.json({ success: true });
});

// ==================== REVELAÇÃO DE DADOS SENSÍVEIS ====================

// Verificar senha e liberar revelação
app.post('/api/admin/reveal-data', (req, res) => {
  const { password, sessionToken } = req.body;
  
  // Verificar se está logado
  if (!sessionToken || !activeSessions.has(sessionToken)) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  
  if (password === REVEAL_PASSWORD) {
    // Adicionar token à lista de revelação (válido por 30 minutos)
    revealTokens.set(sessionToken, { createdAt: Date.now() });
    res.json({ success: true, message: 'Dados revelados' });
  } else {
    res.status(401).json({ error: 'Senha incorreta' });
  }
});

// Ocultar dados novamente
app.post('/api/admin/hide-data', (req, res) => {
  const { sessionToken } = req.body;
  revealTokens.delete(sessionToken);
  res.json({ success: true, message: 'Dados ocultados' });
});

// Verificar se dados estão revelados
app.post('/api/admin/check-reveal', (req, res) => {
  const { sessionToken } = req.body;
  
  if (sessionToken && revealTokens.has(sessionToken)) {
    // Verificar se não expirou (30 minutos)
    const data = revealTokens.get(sessionToken);
    if (Date.now() - data.createdAt < 30 * 60 * 1000) {
      return res.json({ revealed: true });
    } else {
      revealTokens.delete(sessionToken);
    }
  }
  res.json({ revealed: false });
});

// Função helper para verificar se deve revelar
function shouldReveal(sessionToken) {
  if (!sessionToken || !revealTokens.has(sessionToken)) return false;
  const data = revealTokens.get(sessionToken);
  if (Date.now() - data.createdAt > 30 * 60 * 1000) {
    revealTokens.delete(sessionToken);
    return false;
  }
  return true;
}

// Rota segura para obter telefone (WhatsApp) - requer dados revelados
app.get('/api/admin/get-phone/:type/:id', async (req, res) => {
  try {
    const sessionToken = req.query.token;
    const { type, id } = req.params;
    
    // Verificar se tem permissão para ver dados
    if (!shouldReveal(sessionToken)) {
      return res.status(403).json({ error: 'Revele os dados primeiro para usar o WhatsApp' });
    }
    
    let phone = null;
    
    if (type === 'client') {
      const result = await pool.query('SELECT phone FROM clients WHERE id = $1', [id]);
      phone = result.rows[0]?.phone;
    } else if (type === 'appointment') {
      const result = await pool.query('SELECT client_phone FROM online_appointments WHERE id = $1', [id]);
      phone = result.rows[0]?.client_phone;
    }
    
    if (!phone) {
      return res.status(404).json({ error: 'Telefone não encontrado' });
    }
    
    res.json({ phone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Banco de dados PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Criar tabelas se não existirem
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        duration INTEGER NOT NULL,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS online_appointments (
        id SERIAL PRIMARY KEY,
        client_name VARCHAR(255) NOT NULL,
        client_cpf VARCHAR(14) NOT NULL,
        client_phone VARCHAR(20) NOT NULL,
        client_email VARCHAR(255),
        service_id INTEGER REFERENCES services(id),
        appointment_date DATE NOT NULL,
        appointment_time TIME NOT NULL,
        status VARCHAR(20) DEFAULT 'pendente',
        notes TEXT,
        reminder_sent BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        confirmed_at TIMESTAMP,
        cancelled_at TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        cpf VARCHAR(14),
        email VARCHAR(255),
        birthdate DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id),
        service_id INTEGER REFERENCES services(id),
        appointment_date DATE NOT NULL,
        appointment_time TIME NOT NULL,
        status VARCHAR(20) DEFAULT 'agendado',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id),
        service_id INTEGER REFERENCES services(id),
        value DECIMAL(10,2) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        sale_date DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        quantity INTEGER DEFAULT 0,
        min_stock INTEGER DEFAULT 5,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        client_name VARCHAR(255) NOT NULL,
        client_phone VARCHAR(20),
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        approved BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Adicionar coluna client_phone se não existir (para bancos já criados)
    await pool.query(`
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS client_phone VARCHAR(20)
    `).catch(() => {});

    // Inserir serviço padrão se não existir
    const services = await pool.query('SELECT COUNT(*) FROM services');
    if (parseInt(services.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO services (name, description, price, duration) VALUES
        ('Extensão Efeito Fox', 'Extensão fio a fio com efeito fox eye, alongado nos cantos.', 180.00, 120)
      `);
    }

    // Inserir produto padrão se não existir
    const products = await pool.query('SELECT COUNT(*) FROM products');
    if (parseInt(products.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO products (name, category, quantity, min_stock) VALUES
        ('Fios de Seda 0.15 C', 'fios', 10, 3)
      `);
    }

    console.log('✅ Banco de dados inicializado!');
  } catch (err) {
    console.error('❌ Erro ao inicializar banco:', err);
  }
}

// ==================== ROTAS - SERVIÇOS ====================

// Listar serviços ativos (para o site público)
app.get('/api/services', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM services WHERE active = true ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar todos os serviços (admin) - só ativos
app.get('/api/admin/services', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM services WHERE active = true ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar serviço
app.post('/api/admin/services', async (req, res) => {
  try {
    const { name, description, price, duration } = req.body;
    const result = await pool.query(
      'INSERT INTO services (name, description, price, duration) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, description, price, duration]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deletar serviço
app.delete('/api/admin/services/:id', async (req, res) => {
  try {
    await pool.query('UPDATE services SET active = false WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ROTAS - AGENDAMENTOS ONLINE ====================

// Função para obter data/hora no horário de Brasília (UTC-3)
function getBrasiliaTime() {
  const now = new Date();
  // Ajusta para UTC-3 (Brasília)
  const brasiliaOffset = -3 * 60; // -3 horas em minutos
  const utcOffset = now.getTimezoneOffset(); // offset do servidor em minutos
  const diff = brasiliaOffset - (-utcOffset); // diferença em minutos
  now.setMinutes(now.getMinutes() + diff);
  return now;
}

function getBrasiliaDate() {
  const brasilia = getBrasiliaTime();
  return brasilia.toISOString().split('T')[0];
}

// Verificar horários disponíveis
app.get('/api/available-slots', async (req, res) => {
  try {
    const { date, service_id } = req.query;
    
    // ===== 🕐 HORÁRIOS DE FUNCIONAMENTO =====
    // Edite aqui os horários disponíveis para agendamento
    // Formato: 'HH:MM' (24 horas)
    // Exemplo: ['08:00', '09:00', '10:00'] = 8h, 9h e 10h
    const allSlots = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
    // =========================================
    
    // Buscar horários já agendados
    const booked = await pool.query(
      `SELECT appointment_time FROM online_appointments 
       WHERE appointment_date = $1 AND status != 'cancelado'
       UNION
       SELECT appointment_time FROM appointments 
       WHERE appointment_date = $1 AND status != 'cancelado'`,
      [date]
    );
    
    const bookedTimes = booked.rows.map(r => r.appointment_time.slice(0, 5));
    let available = allSlots.filter(slot => !bookedTimes.includes(slot));
    
    // Se for hoje (horário de Brasília), filtrar horários que já passaram
    const today = getBrasiliaDate();
    if (date === today) {
      const brasilia = getBrasiliaTime();
      const currentHour = brasilia.getHours();
      const currentMinute = brasilia.getMinutes();
      
      available = available.filter(slot => {
        const [h, m] = slot.split(':').map(Number);
        // Só mostra horários que ainda não passaram (com 30min de margem)
        return h > currentHour || (h === currentHour && m > currentMinute + 30);
      });
    }
    
    res.json(available);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar agendamento online (site público)
app.post('/api/appointments', async (req, res) => {
  try {
    const { client_name, client_phone, client_email, service_id, appointment_date, appointment_time } = req.body;
    
    // Verificar se horário ainda está disponível
    const check = await pool.query(
      `SELECT id FROM online_appointments 
       WHERE appointment_date = $1 AND appointment_time = $2 AND status != 'cancelado'`,
      [appointment_date, appointment_time]
    );
    
    if (check.rows.length > 0) {
      return res.status(400).json({ error: 'Horário não disponível' });
    }
    
    const result = await pool.query(
      `INSERT INTO online_appointments (client_name, client_cpf, client_phone, client_email, service_id, appointment_date, appointment_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [client_name, '', client_phone, client_email, service_id, appointment_date, appointment_time]
    );
    
    // Retorna só sucesso, sem dados sensíveis
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar agendamentos online (admin)
app.get('/api/admin/online-appointments', async (req, res) => {
  try {
    const sessionToken = req.query.token;
    const reveal = shouldReveal(sessionToken);
    
    const result = await pool.query(`
      SELECT oa.id, oa.client_name, oa.client_email, oa.service_id, 
             oa.appointment_date, oa.appointment_time, oa.status, 
             oa.created_at, oa.confirmed_at, oa.cancelled_at, oa.reminder_sent,
             oa.client_cpf, oa.client_phone,
             s.name as service_name, s.price as service_price
      FROM online_appointments oa
      LEFT JOIN services s ON oa.service_id = s.id
      ORDER BY oa.appointment_date DESC, oa.appointment_time DESC
    `);
    
    // Criar objetos SEM dados sensíveis originais
    const data = result.rows.map(row => ({
      id: row.id,
      client_name: row.client_name,
      client_email: row.client_email,
      service_id: row.service_id,
      appointment_date: row.appointment_date,
      appointment_time: row.appointment_time,
      status: row.status,
      created_at: row.created_at,
      confirmed_at: row.confirmed_at,
      cancelled_at: row.cancelled_at,
      reminder_sent: row.reminder_sent,
      service_name: row.service_name,
      service_price: row.service_price,
      client_cpf: reveal ? row.client_cpf : mascararCPF(row.client_cpf),
      client_phone: reveal ? row.client_phone : mascararTelefone(row.client_phone)
    }));
    
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Confirmar agendamento
app.put('/api/admin/online-appointments/:id/confirm', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE online_appointments SET status = 'confirmado', confirmed_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, status`,
      [req.params.id]
    );
    res.json({ success: true, id: result.rows[0]?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancelar agendamento
app.put('/api/admin/online-appointments/:id/cancel', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE online_appointments SET status = 'cancelado', cancelled_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, status`,
      [req.params.id]
    );
    res.json({ success: true, id: result.rows[0]?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Marcar lembrete como enviado
app.put('/api/admin/online-appointments/:id/reminder-sent', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE online_appointments SET reminder_sent = true WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    res.json({ success: true, id: result.rows[0]?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buscar agendamentos que precisam de lembrete (amanhã)
app.get('/api/admin/reminders', async (req, res) => {
  try {
    const sessionToken = req.query.token;
    const reveal = shouldReveal(sessionToken);
    
    // Amanhã no horário de Brasília
    const brasilia = getBrasiliaTime();
    brasilia.setDate(brasilia.getDate() + 1);
    const tomorrowStr = brasilia.toISOString().split('T')[0];
    
    const result = await pool.query(`
      SELECT oa.id, oa.client_name, oa.client_email, oa.service_id, 
             oa.appointment_date, oa.appointment_time, oa.status,
             oa.client_cpf, oa.client_phone,
             s.name as service_name
      FROM online_appointments oa
      LEFT JOIN services s ON oa.service_id = s.id
      WHERE oa.appointment_date = $1 
        AND oa.status = 'confirmado' 
        AND oa.reminder_sent = false
      ORDER BY oa.appointment_time
    `, [tomorrowStr]);
    
    // Criar objetos SEM dados sensíveis originais
    const data = result.rows.map(row => ({
      id: row.id,
      client_name: row.client_name,
      client_email: row.client_email,
      service_id: row.service_id,
      appointment_date: row.appointment_date,
      appointment_time: row.appointment_time,
      status: row.status,
      service_name: row.service_name,
      client_cpf: reveal ? row.client_cpf : mascararCPF(row.client_cpf),
      client_phone: reveal ? row.client_phone : mascararTelefone(row.client_phone)
    }));
    
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ROTAS - CLIENTES ====================

app.get('/api/admin/clients', async (req, res) => {
  try {
    const sessionToken = req.query.token;
    const reveal = shouldReveal(sessionToken);
    
    const result = await pool.query('SELECT id, name, email, birthdate, notes, created_at, cpf, phone FROM clients ORDER BY name');
    
    // Criar objetos SEM dados sensíveis originais
    const data = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      birthdate: row.birthdate,
      notes: row.notes,
      created_at: row.created_at,
      cpf: reveal ? row.cpf : mascararCPF(row.cpf),
      phone: reveal ? row.phone : mascararTelefone(row.phone)
    }));
    
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/clients', async (req, res) => {
  try {
    const { name, phone, cpf, email, birthdate, notes } = req.body;
    const result = await pool.query(
      'INSERT INTO clients (name, phone, cpf, email, birthdate, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name',
      [name, phone, cpf, email, birthdate, notes]
    );
    res.json({ success: true, id: result.rows[0].id, name: result.rows[0].name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/clients/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buscar histórico do cliente
app.get('/api/admin/clients/:id/history', async (req, res) => {
  try {
    const clientId = req.params.id;
    const sessionToken = req.query.token;
    const reveal = shouldReveal(sessionToken);
    
    // Dados do cliente - SÓ campos seguros
    const clientResult = await pool.query(
      'SELECT id, name, email, birthdate, notes, created_at, cpf, phone FROM clients WHERE id = $1', 
      [clientId]
    );
    const clientRaw = clientResult.rows[0];
    
    // Criar objeto SEM dados sensíveis originais
    const client = clientRaw ? {
      id: clientRaw.id,
      name: clientRaw.name,
      email: clientRaw.email,
      birthdate: clientRaw.birthdate,
      notes: clientRaw.notes,
      created_at: clientRaw.created_at,
      cpf_display: reveal ? clientRaw.cpf : mascararCPF(clientRaw.cpf),
      phone_display: reveal ? clientRaw.phone : mascararTelefone(clientRaw.phone)
    } : null;
    
    // Vendas do cliente
    const salesResult = await pool.query(`
      SELECT sa.id, sa.value, sa.payment_method, sa.sale_date, s.name as service_name
      FROM sales sa
      LEFT JOIN services s ON sa.service_id = s.id
      WHERE sa.client_id = $1
      ORDER BY sa.sale_date DESC
    `, [clientId]);
    
    // Agendamentos manuais do cliente
    const appointmentsResult = await pool.query(`
      SELECT a.id, a.appointment_date, a.appointment_time, a.notes, a.status, s.name as service_name
      FROM appointments a
      LEFT JOIN services s ON a.service_id = s.id
      WHERE a.client_id = $1
      ORDER BY a.appointment_date DESC
    `, [clientId]);
    
    // Estatísticas
    const totalSpent = await pool.query(
      'SELECT COALESCE(SUM(value), 0) as total FROM sales WHERE client_id = $1',
      [clientId]
    );
    
    const visitCount = await pool.query(
      'SELECT COUNT(*) FROM sales WHERE client_id = $1',
      [clientId]
    );
    
    res.json({
      client: client,
      sales: salesResult.rows,
      appointments: appointmentsResult.rows,
      totalSpent: parseFloat(totalSpent.rows[0].total),
      visitCount: parseInt(visitCount.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ROTAS - AGENDAMENTOS MANUAIS ====================

app.get('/api/admin/appointments', async (req, res) => {
  try {
    const sessionToken = req.query.token;
    const reveal = shouldReveal(sessionToken);
    
    const result = await pool.query(`
      SELECT a.id, a.client_id, a.service_id, a.appointment_date, a.appointment_time, 
             a.notes, a.status, a.created_at,
             c.name as client_name, c.phone as client_phone, c.cpf as client_cpf, 
             s.name as service_name
      FROM appointments a
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN services s ON a.service_id = s.id
      ORDER BY a.appointment_date DESC, a.appointment_time DESC
    `);
    
    // Criar objetos SEM dados sensíveis originais
    const data = result.rows.map(row => ({
      id: row.id,
      client_id: row.client_id,
      service_id: row.service_id,
      appointment_date: row.appointment_date,
      appointment_time: row.appointment_time,
      notes: row.notes,
      status: row.status,
      created_at: row.created_at,
      client_name: row.client_name,
      service_name: row.service_name,
      client_phone: reveal ? row.client_phone : mascararTelefone(row.client_phone),
      client_cpf: reveal ? row.client_cpf : mascararCPF(row.client_cpf)
    }));
    
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/appointments', async (req, res) => {
  try {
    const { client_id, service_id, appointment_date, appointment_time, notes } = req.body;
    const result = await pool.query(
      'INSERT INTO appointments (client_id, service_id, appointment_date, appointment_time, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [client_id, service_id, appointment_date, appointment_time, notes]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/appointments/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM appointments WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ROTAS - VENDAS ====================

app.get('/api/admin/sales', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sa.*, c.name as client_name, s.name as service_name
      FROM sales sa
      LEFT JOIN clients c ON sa.client_id = c.id
      LEFT JOIN services s ON sa.service_id = s.id
      ORDER BY sa.sale_date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/sales', async (req, res) => {
  try {
    const { client_id, service_id, value, payment_method, sale_date } = req.body;
    const result = await pool.query(
      'INSERT INTO sales (client_id, service_id, value, payment_method, sale_date) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [client_id, service_id, value, payment_method, sale_date || new Date().toISOString().split('T')[0]]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/sales/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sales WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ROTAS - ESTOQUE ====================

app.get('/api/admin/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/products', async (req, res) => {
  try {
    const { name, category, quantity, min_stock } = req.body;
    const result = await pool.query(
      'INSERT INTO products (name, category, quantity, min_stock) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, category, quantity, min_stock || 5]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/products/:id/stock', async (req, res) => {
  try {
    const { delta } = req.body;
    const result = await pool.query(
      'UPDATE products SET quantity = GREATEST(0, quantity + $1) WHERE id = $2 RETURNING *',
      [delta, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ROTAS - ESTATÍSTICAS ====================

app.get('/api/admin/stats', async (req, res) => {
  try {
    // Usar horário de Brasília
    const brasilia = getBrasiliaTime();
    const today = brasilia.toISOString().split('T')[0];
    const firstDayOfMonth = new Date(brasilia.getFullYear(), brasilia.getMonth(), 1).toISOString().split('T')[0];
    
    // Agendamentos de hoje
    const todayAppts = await pool.query(
      `SELECT COUNT(*) FROM appointments WHERE appointment_date = $1
       UNION ALL
       SELECT COUNT(*) FROM online_appointments WHERE appointment_date = $1 AND status = 'confirmado'`,
      [today]
    );
    
    // Faturamento do mês
    const monthRevenue = await pool.query(
      'SELECT COALESCE(SUM(value), 0) as total FROM sales WHERE sale_date >= $1',
      [firstDayOfMonth]
    );
    
    // Total de clientes
    const totalClients = await pool.query('SELECT COUNT(*) FROM clients');
    
    // Vendas do mês
    const monthSales = await pool.query(
      'SELECT COUNT(*) FROM sales WHERE sale_date >= $1',
      [firstDayOfMonth]
    );
    
    // Agendamentos pendentes
    const pendingAppts = await pool.query(
      `SELECT COUNT(*) FROM online_appointments WHERE status = 'pendente'`
    );
    
    res.json({
      todayAppointments: parseInt(todayAppts.rows[0]?.count || 0) + parseInt(todayAppts.rows[1]?.count || 0),
      monthRevenue: parseFloat(monthRevenue.rows[0].total),
      totalClients: parseInt(totalClients.rows[0].count),
      monthSales: parseInt(monthSales.rows[0].count),
      pendingAppointments: parseInt(pendingAppts.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ROTAS - AVALIAÇÕES ====================

// Listar avaliações (público)
app.get('/api/reviews', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, client_name, rating, comment, created_at FROM reviews WHERE approved = true ORDER BY created_at DESC LIMIT 50'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verificar se telefone já avaliou (retorna a avaliação se existir)
app.get('/api/reviews/check/:phone', async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\D/g, '');
    
    if (phone.length < 10 || phone.length > 11) {
      return res.status(400).json({ error: 'Telefone inválido' });
    }
    
    const result = await pool.query(
      'SELECT id, client_name, rating, comment, created_at FROM reviews WHERE client_phone = $1',
      [phone]
    );
    
    if (result.rows.length > 0) {
      // Retorna sem o telefone!
      res.json({ hasReview: true, review: result.rows[0] });
    } else {
      res.json({ hasReview: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar avaliação (público) - 1 por telefone
app.post('/api/reviews', async (req, res) => {
  try {
    const { client_name, client_phone, rating, comment } = req.body;
    
    if (!client_name || !client_phone || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Nome, telefone e avaliação são obrigatórios' });
    }
    
    const phone = client_phone.replace(/\D/g, '');
    
    if (phone.length < 10 || phone.length > 11) {
      return res.status(400).json({ error: 'Telefone inválido' });
    }
    
    // Verificar se já existe avaliação desse telefone
    const existing = await pool.query('SELECT id FROM reviews WHERE client_phone = $1', [phone]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Você já fez uma avaliação. Use a opção de editar.' });
    }
    
    const result = await pool.query(
      'INSERT INTO reviews (client_name, client_phone, rating, comment) VALUES ($1, $2, $3, $4) RETURNING id, client_name, rating, comment, created_at',
      [client_name, phone, rating, comment || '']
    );
    res.json({ success: true, review: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Editar avaliação existente
app.put('/api/reviews/:phone', async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\D/g, '');
    const { client_name, rating, comment } = req.body;
    
    if (phone.length < 10 || phone.length > 11) {
      return res.status(400).json({ error: 'Telefone inválido' });
    }
    
    const result = await pool.query(
      'UPDATE reviews SET client_name = $1, rating = $2, comment = $3, created_at = CURRENT_TIMESTAMP WHERE client_phone = $4 RETURNING id, client_name, rating, comment, created_at',
      [client_name, rating, comment || '', phone]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Avaliação não encontrada' });
    }
    
    res.json({ success: true, review: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deletar avaliação (admin)
app.delete('/api/admin/reviews/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM reviews WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Horários disponíveis hoje (público)
app.get('/api/today-slots', async (req, res) => {
  try {
    const today = getBrasiliaDate();
    
    // ===== 🕐 HORÁRIOS DE FUNCIONAMENTO =====
    const allSlots = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
    // =========================================
    
    // Buscar horários já agendados hoje
    const booked = await pool.query(
      `SELECT appointment_time FROM online_appointments 
       WHERE appointment_date = $1 AND status != 'cancelado'
       UNION
       SELECT appointment_time FROM appointments 
       WHERE appointment_date = $1 AND status != 'cancelado'`,
      [today]
    );
    
    const bookedTimes = booked.rows.map(r => r.appointment_time.slice(0, 5));
    const available = allSlots.filter(slot => !bookedTimes.includes(slot));
    
    // Filtrar horários que já passaram (horário de Brasília)
    const brasilia = getBrasiliaTime();
    const currentHour = brasilia.getHours();
    const currentMinute = brasilia.getMinutes();
    
    const stillAvailable = available.filter(slot => {
      const [h, m] = slot.split(':').map(Number);
      return h > currentHour || (h === currentHour && m > currentMinute);
    });
    
    res.json({
      date: today,
      slots: stillAvailable,
      total: allSlots.length,
      available: stillAvailable.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rota para servir o admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Rota padrão - site público
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Iniciar servidor
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📱 Site público: http://localhost:${PORT}`);
    console.log(`🔐 Painel admin: http://localhost:${PORT}/admin`);
  });
});
