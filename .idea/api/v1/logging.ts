import express, { Request, Response } from 'express';
import sqlite3 from 'sqlite3';
import { json } from 'express';

const PORT = process.env.PORT || 3004;
const app = express();

// Initialize SQLite database
const db = new sqlite3.Database('logs.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    // Create logs table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service VARCHAR(50) NOT NULL,
      level VARCHAR(20) NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  }
});

interface LogEntry {
  service: string;
  level: string;
  message: string;
  metadata?: Record<string, any>;
}

// Middleware
app.use(json());

// @ts-ignore
app.post('/log', (req: Request<{}, {}, LogEntry>, res: Response) => {
  const { service, level, message, metadata } = req.body;

  if (!service || !level || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const sql = 'INSERT INTO logs (service, level, message, metadata) VALUES (?, ?, ?, ?)';
  const metadataString = metadata ? JSON.stringify(metadata) : null;

  db.run(sql, [service, level, message, metadataString], function(err) {
    if (err) {
      console.error('Error inserting log:', err);
      return res.status(500).json({ error: 'Failed to save log' });
    }
    res.json({
      message: 'Log saved successfully',
      logId: this.lastID
    });
  });
});

interface LogQueryParams {
  service?: string;
  level?: string;
  limit?: number;
  offset?: number;
}

// Get all logs
app.get('/logs', (req: Request<{}, {}, {}, LogQueryParams>, res: Response) => {
  const { service, level, limit = 100, offset = 0 } = req.query;
  
  let sql = 'SELECT * FROM logs';
  const params: any[] = [];
  
  if (service || level) {
    const conditions: string[] = [];
    if (service) {
      conditions.push('service = ?');
      params.push(service);
    }
    if (level) {
      conditions.push('level = ?');
      params.push(level);
    }
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  
  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching logs:', err);
      return res.status(500).json({ error: 'Failed to fetch logs' });
    }
    res.json(rows);
  });
});

// Get logs by service
app.get('/logs/:service', (req: Request<{ service: string }, {}, {}, { limit?: number; offset?: number }>, res: Response) => {
  const { service } = req.params;
  const { limit = 100, offset = 0 } = req.query;

  const sql = 'SELECT * FROM logs WHERE service = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  
  db.all(sql, [service, limit, offset], (err, rows) => {
    if (err) {
      console.error('Error fetching logs:', err);
      return res.status(500).json({ error: 'Failed to fetch logs' });
    }
    res.json(rows);
  });
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).send('Healthy');
});

app.listen(PORT, () => {
  console.log(`Logging Service running on port ${PORT}`);
});



