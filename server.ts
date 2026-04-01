import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { google } from "googleapis";
import session from "express-session";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: "event-extractor-secret",
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: true,
    sameSite: 'none',
    httpOnly: true,
  }
}));

const getOAuth2Client = (req: express.Request) => {
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['host'];
  // Use APP_URL if available, otherwise derive from request
  const baseUrl = process.env.APP_URL || `${protocol}://${host}`;
  const redirectUri = `${baseUrl.replace(/\/$/, '')}/auth/callback`;
  
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
};

// API Routes
app.get("/api/auth/url", (req, res) => {
  const scopes = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly"
  ];

  const client = getOAuth2Client(req);
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent"
  });

  res.json({ url });
});

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const client = getOAuth2Client(req);
    const { tokens } = await client.getToken(code as string);
    // In a real app, you'd store this in a database.
    // For this demo, we'll send it back to the client via postMessage.
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', tokens: ${JSON.stringify(tokens)} }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("OAuth Error:", error);
    res.status(500).send("Authentication failed");
  }
});

app.post("/api/calendar/add", async (req, res) => {
  const { event, tokens, calendarId } = req.body;
  
  if (!tokens) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const auth = getOAuth2Client(req);
  auth.setCredentials(tokens);

  const calendar = google.calendar({ version: "v3", auth });

  try {
    const requestBody: any = {
      summary: event.name,
      location: event.address || event.venue,
      description: `Venue: ${event.venue}\nPrice: ${event.price || 'N/A'}`,
    };

    if (event.isAllDay) {
      requestBody.start = {
        date: event.startDate,
      };
      // For all-day events, the end date is exclusive in Google Calendar API
      // If event.endDate is provided, use it (and increment by 1 day if it's the same as startDate)
      // If not, use startDate + 1 day
      const endDate = event.endDate || event.startDate;
      const date = new Date(endDate);
      date.setDate(date.getDate() + 1);
      requestBody.end = {
        date: date.toISOString().split('T')[0],
      };
    } else {
      requestBody.start = {
        dateTime: event.startDateTime,
        timeZone: "UTC",
      };
      requestBody.end = {
        dateTime: event.endDateTime,
        timeZone: "UTC",
      };
    }

    const response = await calendar.events.insert({
      calendarId: calendarId || "primary",
      requestBody,
    });

    res.json({ success: true, event: response.data });
  } catch (error) {
    console.error("Calendar API Error:", error);
    res.status(500).json({ error: "Failed to add event to calendar" });
  }
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
