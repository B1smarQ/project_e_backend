import express, { Request, Response } from 'express';
import axios from 'axios';
import cors from 'cors';
import sqlite3 from "sqlite3";
import {log} from "node:util";
const amqp = require('amqplib/callback_api');
const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded( {extended : true}))

const db = new sqlite3.Database('users.db',(err) =>{
    if(err) {
        return console.error(err.message);
    }
    console.log('Connected to the SQLite database.');

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        authKey TEXT NOT NULL
    )`);
});

async function logEvent(level: string, logMessage: string, metadata?: Record<string, any>) {
    amqp.connect('amqps://erhfizhg:sCrrs3sPDKxBKQrUC54Z2nV5jlZtolqZ@hawk.rmq.cloudamqp.com/erhfizhg', (err, connection) => {
        if(err){
            console.log(err);
        }
        let queue = 'logs'
        let message = {service: 'auth-service', level: level, message: logMessage, metadata:metadata};
        connection.createChannel((err1, chan) =>{
            chan.assertQueue(queue,{
                durable:false
            })
            chan.sendToQueue(queue, Buffer.from(JSON.stringify(message)));
        })
    })
}


app.get('/', async (req: Request, res: Response) => {
    const login = req.header('login');
    const password = req.header('password');
    res.header('Access-Control-Allow-Origin', '*');
    if(!login || !password) {
        await logEvent('warn', 'Authentication attempt failed - missing credentials', {
            missingFields: (!login ? 'login' : '') + (!password ? 'password' : '')
        });
        return res.status(401).json({ error: 'Missing login or password' });
    }

    db.get('SELECT * FROM users WHERE login = ?', [login], async (err, user) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (!user) {
            await logEvent('error', 'Authentication failed - user not found', {
                attemptedUser: login,
                ipAddress: req.ip
            });
            return res.status(401).json({ error: 'User not found' });
        }

        // @ts-ignore
        if (user.password !== password) {
            await logEvent('error', 'Authentication failed - invalid credentials', {
                attemptedUser: login,
                ipAddress: req.ip
            });
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // @ts-ignore
        const authKey = user.authKey;
        await logEvent('info', 'Successful authentication', {
            user: login,
            authKey,
            ipAddress: req.ip
        });
        res.header('Content-Type', 'application/json');
        return res.status(200).json({
            message: 'Login successful',
            authKey: authKey,
            userName: login
        });
    });
});

app.get('/user', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    console.log('got request')
    const authKey = req.header('Authorization');
    console.log(authKey)
    if(!authKey) return res.status(400).send()
    db.all('SELECT * FROM users WHERE authKey = ?',[authKey], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.header('Content-Type', 'application/json');
        return res.status(200).json(rows);
    });
})


app.post('/register', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const {login, password} = req.body;
    console.log(req.body)
    if (!login   || !password ) {
        await logEvent('warn', 'Registration attempt failed - missing credentials', {
            missingFields: (!login ? 'login' : '') + (!password ? 'password' : '')
        });
        return res.status(400).json({error: 'Missing login or password'});
    }

    // Use a Promise to handle the asynchronous db.get call
    db.get('SELECT * FROM users WHERE login = ?', [login], async (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({error: 'Database error'});
        }

        if (row) {
            await logEvent('error', 'Registration failed - user already exists', {
                attemptedUser: login
            });
            return res.status(409).json({error: 'User already exists'});
        }

        const authKey = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        db.run('INSERT INTO users (login, password, authKey) VALUES (?,?,?)', [login, password, authKey], async (err) => {
            if (err) {
                console.error(err);
                return res.status(500).json({error: 'Failed to register user'});
            }

            await logEvent('info', 'User registered successfully', {
                user: login,
                authKey
            });

            return res.status(201).json({
                message: 'User registered successfully',
                authKey: authKey,
                userName: login
            });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Authentication Service running on port ${PORT}`);
    logEvent('info', 'Authentication service started', { port: PORT });
});