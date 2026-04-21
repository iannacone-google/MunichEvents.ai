import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import { allowCors } from '../_cors.js';

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { event, tokens, calendarId } = req.body;

  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials(tokens);

  const calendar = google.calendar({ version: 'v3', auth });

  try {
    const requestBody: any = {
      summary: event.name,
      location: event.address || event.venue,
      description: `Venue: ${event.venue || 'N/A'}\nPrice: ${event.price || 'N/A'}\n\n${event.description || ''}`,
    };

    if (event.isAllDay) {
      requestBody.start = { date: event.startDate };
      const endDate = event.endDate || event.startDate;
      const date = new Date(endDate);
      date.setDate(date.getDate() + 1);
      requestBody.end = { date: date.toISOString().split('T')[0] };
    } else {
      requestBody.start = { dateTime: event.startDateTime, timeZone: 'UTC' };
      requestBody.end = { dateTime: event.endDateTime, timeZone: 'UTC' };
    }

    const response = await calendar.events.insert({
      calendarId: calendarId || 'primary',
      requestBody,
    });

    res.json({ success: true, event: response.data });
  } catch (error) {
    console.error('Calendar API Error:', error);
    res.status(500).json({ error: 'Failed to add event to calendar' });
  }
}

export default allowCors(handler);