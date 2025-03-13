  import express, { Request, Response } from 'express';
import multer from 'multer';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
  import amqp from "amqplib/callback_api";

const PORT = process.env.PORT || 3002;

async function logEvent(level: string, logMessage: string, metadata?: Record<string, any>) {
  amqp.connect('amqps://erhfizhg:sCrrs3sPDKxBKQrUC54Z2nV5jlZtolqZ@hawk.rmq.cloudamqp.com/erhfizhg', (err, connection) => {
    if(err){
      console.log(err);
    }
    let queue = 'logs'
    let message = {service: 'file-service', level: level, message: logMessage, metadata:metadata};
    connection.createChannel((err1, chan) =>{
      chan.assertQueue(queue,{
        durable:false
      })
      chan.sendToQueue(queue, Buffer.from(JSON.stringify(message)));
    })
  })
}

//Создание директории для загрузки файлов при ее отсутствии
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

//Создание базы данных для хранения информации о файлах
const db = new sqlite3.Database('files.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    logEvent('error', 'Failed to connect to database', { error: err.message });
  } else {
    console.log('Connected to SQLite database');
    logEvent('info', 'Database connection established');
    //Создание таблицы для хранения информации о файлах при ее отсутствии
    db.run(`CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      originalname TEXT NOT NULL,
      mimetype TEXT,
      size INTEGER,
      uploadDate DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  }
});

const app = express();


app.use(express.json());

interface FileRequest extends Request {
  file?: Express.Multer.File;
}

//Загрузка файла на сервер
app.post('/upload', upload.single('file'), async (req: FileRequest, res: Response) => {
  if (!req.file) {
    await logEvent('warn', 'File upload failed - no file provided');
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileData = {
    filename: req.file.filename,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size
  };

  const sql = 'INSERT INTO files (filename, originalname, mimetype, size) VALUES (?, ?, ?, ?)';
  db.run(sql, [fileData.filename, fileData.originalname, fileData.mimetype, fileData.size], async function(err) {
    if (err) {
      console.error('Error inserting file data:', err);
      await logEvent('error', 'Failed to save file information to database', {
        error: err.message,
        file: fileData
      });
      return res.status(500).json({ error: 'Failed to save file information' });
    }
    await logEvent('info', 'File uploaded successfully', {
      fileId: this.lastID,
      ...fileData
    });
    res.json({
      message: 'File uploaded successfully',
      fileId: this.lastID,
      ...fileData
    });
  });
});

interface DBFile {
  id: number;
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
  uploadDate: string;
}

//ТЕСТ
app.get('/', async (_req: Request, res: Response) => {
  db.all<DBFile>('SELECT * FROM files', [], async (err, rows) => {
    if (err) {
      console.error('Error fetching files:', err);
      await logEvent('error', 'Failed to fetch files', { error: err.message });
      return res.status(500).json({ error: 'Failed to fetch files' });
    }
    await logEvent('info', 'Files list retrieved', { count: rows.length });
    res.json(rows);
  });
});


app.get('/download/:id', async (req: Request<{ id: string }>, res: Response) => {
  const fileId = req.params.id;
  
  db.get<DBFile>('SELECT * FROM files WHERE id = ?', [fileId], async (err, file) => {
    if (err) {
      console.error('Error fetching file:', err);
      await logEvent('error', 'Failed to fetch file information', {
        fileId,
        error: err.message
      });
      return res.status(500).json({ error: 'Failed to fetch file information' });
    }
    if (!file) {
      await logEvent('warn', 'File not found', { fileId });
      return res.status(404).json({ error: 'File not found' });
    }

    const filePath = path.join(__dirname, './uploads', file.filename);
    
    if (!fs.existsSync(filePath)) {
      await logEvent('error', 'File not found on server', {
        fileId,
        expectedPath: filePath
      });
      return res.status(404).json({ error: 'File not found on server' });
    }

    await logEvent('info', 'File downloaded', {
      fileId,
      filename: file.filename
    });
    res.download(filePath, file.originalname);
  });
});


app.delete('/files/:id', async (req: Request<{ id: string }>, res: Response) => {
  const fileId = req.params.id;

  db.get<{ filename: string }>('SELECT filename FROM files WHERE id = ?', [fileId], async (err, file) => {
    if (err) {
      console.error('Error fetching file:', err);
      await logEvent('error', 'Failed to fetch file for deletion', {
        fileId,
        error: err.message
      });
      return res.status(500).json({ error: 'Failed to fetch file information' });
    }
    if (!file) {
      await logEvent('warn', 'File not found for deletion', { fileId });
      return res.status(404).json({ error: 'File not found' });
    }

    const filePath = path.join(__dirname, '../../uploads', file.filename);
    
    db.run('DELETE FROM files WHERE id = ?', [fileId], async (err) => {
      if (err) {
        console.error('Error deleting file from database:', err);
        await logEvent('error', 'Failed to delete file from database', {
          fileId,
          error: err.message
        });
        return res.status(500).json({ error: 'Failed to delete file from database' });
      }

      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, async (err) => {
          if (err) {
            console.error('Error deleting file from filesystem:', err);
            await logEvent('error', 'Failed to delete file from filesystem', {
              fileId,
              filePath,
              error: err.message
            });
            return res.status(500).json({ error: 'Failed to delete file from filesystem' });
          }
          await logEvent('info', 'File deleted successfully', {
            fileId,
            filename: file.filename
          });
          res.json({ message: 'File deleted successfully' });
        });
      } else {
        await logEvent('warn', 'File deleted from database, file not found in filesystem', {
          fileId,
          expectedPath: filePath
        });
        res.json({ message: 'File deleted from database, file not found in filesystem' });
      }
    });
  });
});


app.get('/health', (_req: Request, res: Response) => {
  res.status(200).send('Healthy');
});

app.listen(PORT, () => {
  console.log(`File Service running on port ${PORT}`);
  logEvent('info', 'File service started', { port: PORT });
});
