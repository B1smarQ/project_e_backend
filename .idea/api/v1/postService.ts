import express = require('express');
import sqlite3 from "sqlite3";
import axios from "axios";
import cors from "cors";
import amqp from "amqplib/callback_api";
const app = express();
const PORT = 3005

app.use(cors());
app.use(express.json());
app.use(express.urlencoded( {extended : true}))

async function logEvent(level: string, logMessage: string, metadata?: Record<string, any>) {
    amqp.connect('amqps://erhfizhg:sCrrs3sPDKxBKQrUC54Z2nV5jlZtolqZ@hawk.rmq.cloudamqp.com/erhfizhg', (err, connection) => {
        if(err){
            console.log(err);
        }
        let queue = 'logs'
        let message = {service: 'post-service', level: level, message: logMessage, metadata:metadata};
        connection.createChannel((err1, chan) =>{
            chan.assertQueue(queue,{
                durable:false
            })
            chan.sendToQueue(queue, Buffer.from(JSON.stringify(message)));
        })
    })
}

// Connect to SQLite database
const db = new sqlite3.Database('posts.db', (err)=>{
    if (err) {
        console.error(err.message);
    }
    else{
        console.log('Connected to the SQLite database.');
        // Create posts table if not exists
        db.run('CREATE TABLE IF NOT EXISTS posts' +
            ' (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT,' +
            ' postTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP, userAuth TEXT NOT NULL)');

    }
})

// Middleware to parse JSON request bodies
app.use(express.json());

// GET all posts
app.get('/', async (req, res) => {
    try {
        db.all('SELECT * FROM posts', [], (err, posts) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Database error');
            }
            console.log(posts);
            res.status(200).json(posts);
        });
    } catch (err) {
        // @ts-ignore
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// GET single post by ID
app.get('/post/:id', async (req, res) => {
    try {
        const { id } = req.params;
        db.get('SELECT * FROM posts WHERE id = ?', [id], (err, post) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Database error');
            }
            
            if (!post) {
                return res.status(404).send('Post not found');
            }
            
            res.status(200).json(post);
        });
    } catch (err) {
        // @ts-ignore
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// POST a new post
app.post('/', async (req, res) => {
    try {
        res.header('Access-Control-Allow-Origin','*')
        console.log(req.body);
        const { title, content, userAuth, userName, threadId } = req.body;
        
        if (!title || !content || !userAuth) {
            return res.status(400).send('Missing required fields');
        }
        
        db.run('INSERT INTO posts(title, content, userAuth, userName, threadId) VALUES(?, ?, ?, ?, ?)',
            [title, content, userAuth, userName, threadId],
            async function(err) {
                if (err) {
                    console.error(err.message);
                    return res.status(500).send('Database error');
                }
                
                // Log the creation event
                await logEvent('info', 'Post created', { 
                    postId: this.lastID,
                    userAuth: userAuth 
                });
                
                res.status(201).json({
                    message: 'Post created',
                    postId: this.lastID
                });
            }
        );
    } catch (err) {
        // @ts-ignore
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

app.post('/threads', async (req, res) => {
    res.header('Access-Control-Allow-Origin','*')
    try{
        const {title,author} = req.body;
        console.log('Inserting into db')
        db.run('INSERT INTO threads(threadTitle, threadAuthor) VALUES(?,?)', [title, author], async function(err){
            if(err){
                console.log("ERROR")
                console.error(err.message);
                return res.status(500).send('Database error');
            }
        })
        await logEvent('info', 'Thread created', {
            threadId: this.lastID,
            author: author
        });
        res.status(201).json({
            message: 'Thread created',

        })
    }
    catch(err){
        console.log("ERROR")
        // @ts-ignore
        console.error(err.message);
        res.status(500).send('Server error');
    }
})

// GET all threads
app.get('/threads', async (req, res) => {
    try{
        db.all(`
            SELECT 
                t.*,
                COUNT(p.id) as messages
            FROM 
                threads t
            LEFT JOIN 
                posts p ON t.id = p.threadId
            GROUP BY 
                t.id
            ORDER BY messages DESC
        `, [], (err, threads) => {
            if(err){
                console.error(err.message);
                return res.status(500).send('Database error');
            }
            console.log(threads)
            res.status(200).json(threads);
        })
    }
    catch(err){
        // @ts-ignore
        console.error(err.message);
        res.status(500).send('Server error');
    }
})

//GET all posts from a thread by thread ID
app.get('/threads/:id/posts', async (req, res) => {
    try {
        const { id } = req.params;
        db.all('SELECT * FROM posts WHERE threadId = ?', [id], (err, posts) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Database error');
            }

            if (!posts.length) {
                return res.status(404).send('No posts found in this thread');
            }

            res.status(200).json(posts);
        });
    } catch (err) {
        // @ts-ignore
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

//Delete a thread by thread ID
app.delete('/threads/:id', async (req, res) => {
    try {
        const { id } = req.params;
        db.run('DELETE FROM threads WHERE id =?', [id], async function(err) {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Database error');
            }

            if (this.changes === 0) {
                return res.status(404).send('Thread not found');
            }

            // Log the deletion event
            await logEvent('info', 'Thread deleted', { threadId: id });

        });
        //Delete all posts in a thread
        db.run('DELETE FROM posts WHERE threadId =?', [id], async function(err){
            if(err){
                console.error(err.message);
                return res.status(500).send('Database error');
            }
            await logEvent('info', 'Thread posts deleted', { threadId: id})
            res.status(200).send('Thread deleted');
        })
    } catch (err) {
        // @ts-ignore
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// PUT update an existing post
app.put('/post/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, userAuth } = req.body;
        
        if (!title || !content || !userAuth) {
            return res.status(400).send('Missing required fields');
        }
        
        db.run('UPDATE posts SET title = ?, content = ?, userAuth = ? WHERE id = ?',
            [title, content, userAuth, id],
            async function(err) {
                if (err) {
                    console.error(err.message);
                    return res.status(500).send('Database error');
                }
                
                if (this.changes === 0) {
                    return res.status(404).send('Post not found or no changes made');
                }
                
                // Log the update event
                await logEvent('info', 'Post updated', { postId: id, userAuth: userAuth });
                
                res.status(200).send('Post updated');
            }
        );
    } catch (err) {
        // @ts-ignore
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// DELETE a post by ID
app.delete('/delete/:id', async (req, res) => {
    try {
        console.log(req.params)
        res.header('Access-Control-Allow-Origin','*')
        const { id } = req.params;
        
        db.run('DELETE FROM posts WHERE id = ?', [id], async function(err) {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Database error');
            }
            
            if (this.changes === 0) {
                return res.status(404).send('Post not found');
            }
            
            // Log the deletion event
            await logEvent('info', 'Post deleted', { postId: id });
            
            res.status(200).send('Post deleted');
        });
    } catch (err) {
        // @ts-ignore
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

app.get('/userPosts', async (req, res) => {
    try {
        const  userAuth  = req.header('Authorization');
        if (!userAuth) {
            return res.status(400).send('Missing userAuth parameter');
        }

        db.all('SELECT * FROM posts WHERE userAuth =? ORDER BY postTime DESC', [userAuth], (err, posts) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Database error');
            }

            res.status(200).json(posts);
        });
    } catch (err) {
        // @ts-ignore
        console.error(err.message);
        res.status(500).send('Server error');
    }
})

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
