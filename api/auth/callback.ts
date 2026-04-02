import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code } = req.query;
  
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'];
  const baseUrl = process.env.APP_URL || `${protocol}://${host}`;
  const redirectUri = `${baseUrl.replace(/\/$/, '')}/auth/callback`;

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