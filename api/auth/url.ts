import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const host = req.headers['host'];
  // Use APP_URL if defined, otherwise fallback to current host with https
  const baseUrl = process.env.APP_URL || `https://${host}`;
  const redirectUri = `${baseUrl.replace(/\/$/, '')}/api/auth/callback`;

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  const scopes = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly'
  ];

  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  res.json({ url });
}