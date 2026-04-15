# MunichEvents.ai

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/8691c08c-a249-41ac-9672-3b1df1fcc45f

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deployment

### Vercel (Recommended)
The app is designed to run on Vercel. Deploying to Vercel will host both the frontend and the backend (API).

### GitHub Pages
If you deploy the frontend to GitHub Pages:
1. Ensure your backend is running on Vercel.
2. Set the `VITE_API_URL` environment variable in your GitHub Actions or local environment to your Vercel URL (e.g., `https://munich-events-ai.vercel.app`).
3. Run `npm run deploy`.

Note: GitHub Pages is static and cannot host the `api/` folder. The API calls will be directed to the `VITE_API_URL`.
