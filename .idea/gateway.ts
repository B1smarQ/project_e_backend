import express from 'express';
import { json } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const PORT = process.env.port || 3000;
const app = express();
app.use(json());

const serviceRoutes = {
  '/auth': 'http://localhost:3001',  
  '/files': 'http://localhost:3002',
  '/units': 'http://localhost:3003',
  '/logs': 'http://localhost:3004',
  '/posts': 'http://localhost:3005'
};

Object.entries(serviceRoutes).forEach(([path, target]) => {
  app.use(path, createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: {
      [`^${path}`]: '', 
    },
  }));
});
//@ts-ignore
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Gateway service is running on port ${PORT}`);
});
