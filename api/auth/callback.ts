import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import { allowCors } from '../_cors.js';

async function handler(req: VercelRequest, res: VercelResponse) {
  const { code } = req.query;
  
  const host = req.headers['host'];
  // Use APP_URL if defined, otherwise fallback to current host with https
  const baseUrl = process.env.APP_URL || `https://${host}`;
  const redirectUri = `${baseUrl.replace(/\/$/, '')}/api/auth/callback`;

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  try {
    const { tokens } = await client.getToken(code as string);
    
    res.setHeader('Content-Type', 'text/html');
    res.send(`
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', tokens: ${JSON.stringify(tokens)} }, '*');
          window.close();
        } else {
          window.location.href = '/';
        }
      </script>
      <p>Authentication successful. This window should close automatically.</p>
    `);
  } catch (error) {
    console.error('OAuth Error:', error);
    res.status(500).send('Authentication failed');
  }
}

export default allowCors(handler);