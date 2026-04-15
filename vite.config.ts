import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const appBase = env.APP_BASE?.replace(/^\/|\/$/g, '') || (mode === 'production' ? 'MunichEvents.ai' : '');
  const base = appBase ? `/${appBase}/` : '/';

  return {
    base,
    plugins: [
      react(), 
      tailwindcss(),
      {
        name: 'api-server',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url?.startsWith('/api/') || req.url?.startsWith('/auth/callback')) {
              const url = new URL(req.url, `http://${req.headers.host}`);
              const pathname = url.pathname;
              
              try {
                let handler;
                if (pathname === '/api/auth/url') {
                  handler = (await server.ssrLoadModule('/api/auth/url.ts')).default;
                } else if (pathname === '/api/auth/callback' || pathname === '/auth/callback') {
                  handler = (await server.ssrLoadModule('/api/auth/callback.ts')).default;
                } else if (pathname === '/api/calendar/add') {
                  handler = (await server.ssrLoadModule('/api/calendar/add.ts')).default;
                }

                if (handler) {
                  // Mock Vercel response object
                  const vercelRes = {
                    status: (code: number) => {
                      res.statusCode = code;
                      return vercelRes;
                    },
                    json: (data: any) => {
                      res.setHeader('Content-Type', 'application/json');
                      res.end(JSON.stringify(data));
                    },
                    send: (data: any) => {
                      res.end(data);
                    },
                    setHeader: (name: string, value: string) => {
                      res.setHeader(name, value);
                    }
                  };
                  
                  // Mock Vercel request object
                  const vercelReq = {
                    ...req,
                    query: Object.fromEntries(url.searchParams),
                    body: await new Promise((resolve) => {
                      if (req.method === 'GET') {
                        resolve({});
                        return;
                      }
                      let body = '';
                      req.on('data', chunk => body += chunk);
                      req.on('end', () => {
                        try {
                          resolve(body ? JSON.parse(body) : {});
                        } catch (e) {
                          resolve({});
                        }
                      });
                    })
                  };

                  await handler(vercelReq as any, vercelRes as any);
                  return;
                }
              } catch (e) {
                console.error('API Error:', e);
                res.statusCode = 500;
                res.end('Internal Server Error');
                return;
              }
            }
            next();
          });
        }
      }
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
