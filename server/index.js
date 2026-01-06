require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Senha do admin (configurar no Render)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'lash123';

// Tokens de sessão ativos (em memória)
const activeSessions = new Map();

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
  res.json({ success: true });
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
        client_cpf VARCHAR(14),
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        approved BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Adicionar coluna client_cpf se não existir (para bancos já criados)
    await pool.query(`
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS client_cpf VARCHAR(14)
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
    
    // Se for hoje, filtrar horários que já passaram
    const today = new Date().toISOString().split('T')[0];
    if (date === today) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      
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
    const { client_name, client_cpf, client_phone, client_email, service_id, appointment_date, appointment_time } = req.body;
    
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
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [client_name, client_cpf, client_phone, client_email, service_id, appointment_date, appointment_time]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar agendamentos online (admin)
app.get('/api/admin/online-appointments', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT oa.*, s.name as service_name, s.price as service_price
      FROM online_appointments oa
      LEFT JOIN services s ON oa.service_id = s.id
      ORDER BY oa.appointment_date DESC, oa.appointment_time DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Confirmar agendamento
app.put('/api/admin/online-appointments/:id/confirm', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE online_appointments SET status = 'confirmado', confirmed_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancelar agendamento
app.put('/api/admin/online-appointments/:id/cancel', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE online_appointments SET status = 'cancelado', cancelled_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Marcar lembrete como enviado
app.put('/api/admin/online-appointments/:id/reminder-sent', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE online_appointments SET reminder_sent = true WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buscar agendamentos que precisam de lembrete (amanhã)
app.get('/api/admin/reminders', async (req, res) => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    
    const result = await pool.query(`
      SELECT oa.*, s.name as service_name
      FROM online_appointments oa
      LEFT JOIN services s ON oa.service_id = s.id
      WHERE oa.appointment_date = $1 
        AND oa.status = 'confirmado' 
        AND oa.reminder_sent = false
      ORDER BY oa.appointment_time
    `, [tomorrowStr]);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ROTAS - CLIENTES ====================

app.get('/api/admin/clients', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/clients', async (req, res) => {
  try {
    const { name, phone, cpf, email, birthdate, notes } = req.body;
    const result = await pool.query(
      'INSERT INTO clients (name, phone, cpf, email, birthdate, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, phone, cpf, email, birthdate, notes]
    );
    res.json(result.rows[0]);
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
    
    // Dados do cliente
    const client = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    
    // Vendas do cliente
    const salesResult = await pool.query(`
      SELECT sa.*, s.name as service_name
      FROM sales sa
      LEFT JOIN services s ON sa.service_id = s.id
      WHERE sa.client_id = $1
      ORDER BY sa.sale_date DESC
    `, [clientId]);
    
    // Agendamentos manuais do cliente
    const appointmentsResult = await pool.query(`
      SELECT a.*, s.name as service_name
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
      client: client.rows[0],
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
    const result = await pool.query(`
      SELECT a.*, c.name as client_name, c.phone as client_phone, s.name as service_name
      FROM appointments a
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN services s ON a.service_id = s.id
      ORDER BY a.appointment_date DESC, a.appointment_time DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/appointments', async (req, res) => {
  try {
    const { client_id, service_id, appointment_date, appointment_time, notes } = req.body;
    const result = await pool.query(
      'INSERT INTO appointments (client_id, service_id, appointment_date, appointment_time, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [client_id, service_id, appointment_date, appointment_time, notes]
    );
    res.json(result.rows[0]);
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
      'INSERT INTO sales (client_id, service_id, value, payment_method, sale_date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [client_id, service_id, value, payment_method, sale_date || new Date().toISOString().split('T')[0]]
    );
    res.json(result.rows[0]);
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
    const today = new Date().toISOString().split('T')[0];
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    
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

// Validar CPF
function isValidCPF(cpf) {
  cpf = cpf.replace(/[^\d]/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false; // CPFs com todos dígitos iguais
  
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(cpf[9])) return false;
  
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  if (d2 !== parseInt(cpf[10])) return false;
  
  return true;
}

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

// Verificar se CPF já avaliou (retorna a avaliação se existir)
app.get('/api/reviews/check/:cpf', async (req, res) => {
  try {
    const cpf = req.params.cpf.replace(/[^\d]/g, '');
    
    if (!isValidCPF(cpf)) {
      return res.status(400).json({ error: 'CPF inválido' });
    }
    
    const result = await pool.query(
      'SELECT * FROM reviews WHERE client_cpf = $1',
      [cpf]
    );
    
    if (result.rows.length > 0) {
      res.json({ hasReview: true, review: result.rows[0] });
    } else {
      res.json({ hasReview: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar avaliação (público) - 1 por CPF
app.post('/api/reviews', async (req, res) => {
  try {
    const { client_name, client_cpf, rating, comment } = req.body;
    
    if (!client_name || !client_cpf || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Nome, CPF e avaliação são obrigatórios' });
    }
    
    const cpf = client_cpf.replace(/[^\d]/g, '');
    
    if (!isValidCPF(cpf)) {
      return res.status(400).json({ error: 'CPF inválido' });
    }
    
    // Verificar se já existe avaliação desse CPF
    const existing = await pool.query('SELECT id FROM reviews WHERE client_cpf = $1', [cpf]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Você já fez uma avaliação. Use a opção de editar.' });
    }
    
    const result = await pool.query(
      'INSERT INTO reviews (client_name, client_cpf, rating, comment) VALUES ($1, $2, $3, $4) RETURNING *',
      [client_name, cpf, rating, comment || '']
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Editar avaliação existente
app.put('/api/reviews/:cpf', async (req, res) => {
  try {
    const cpf = req.params.cpf.replace(/[^\d]/g, '');
    const { client_name, rating, comment } = req.body;
    
    if (!isValidCPF(cpf)) {
      return res.status(400).json({ error: 'CPF inválido' });
    }
    
    const result = await pool.query(
      'UPDATE reviews SET client_name = $1, rating = $2, comment = $3, created_at = CURRENT_TIMESTAMP WHERE client_cpf = $4 RETURNING *',
      [client_name, rating, comment || '', cpf]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Avaliação não encontrada' });
    }
    
    res.json(result.rows[0]);
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
    const today = new Date().toISOString().split('T')[0];
    
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
    
    // Filtrar horários que já passaram
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
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
