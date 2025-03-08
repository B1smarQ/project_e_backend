import express = require('express');
import sqlite3 from "sqlite3";
import axios from "axios";
import cors from "cors";
const app = express();
const PORT = 3005

app.use(cors());
app.use(express.json());
app.use(express.urlencoded( {extended : true}))

//TODO: switch to mongoDB
async function logEvent(level: string, message: string, metadata?: Record<string, any>) {
    try {
        await axios.post('http://localhost:3004/log', {
            service: 'post-service',
            level,
            message,
            metadata
        });
    } catch (error) {
        console.error('Failed to log event:', error);
    }
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
        const { title, content, userAuth } = req.body;
        
        if (!title || !content || !userAuth) {
            return res.status(400).send('Missing required fields');
        }
        
        db.run('INSERT INTO posts(title, content, userAuth) VALUES(?, ?, ?)', 
            [title, content, userAuth], 
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

        db.all('SELECT * FROM posts WHERE userAuth =?', [userAuth], (err, posts) => {
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
