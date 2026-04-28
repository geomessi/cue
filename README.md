# cue — Relationship Intelligence

A relationship OS for students. Upload your contacts CSV and AI surfaces who to reach out to, why, and drafts the message.

## Project Structure

```
cue/
├── api/
│   └── analyze.js      # Vercel serverless proxy (keeps API key secret)
├── index.html          # Frontend
├── vercel.json
└── README.md
```

## Setup

### 1. GitHub Pages (frontend)

1. Push this repo to GitHub
2. Go to Settings → Pages → Source: `main`, folder: `/public`
3. Your frontend lives at `https://yourusername.github.io/cue`

### 2. Vercel (API proxy)

1. Go to [vercel.com](https://vercel.com) and import this GitHub repo
2. Vercel auto-detects the `api/` folder — no config needed
3. Go to Project Settings → Environment Variables → add:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** your Anthropic API key (from console.anthropic.com)
   - **Name:** `ALLOWED_ORIGIN`
   - **Value:** the exact origin allowed to call the proxy, for example `https://yourusername.github.io`
4. Deploy. Your proxy lives at `https://cue-app.vercel.app/api/analyze`

### 3. Connect them

If you host the frontend separately from Vercel, define `window.CUE_API_URL` before the app script runs:

```js
window.CUE_API_URL = 'https://cue-app.vercel.app/api/analyze';
```

When the frontend is served from the same Vercel project, Cue automatically uses `/api/analyze`.

## CSV Format

Any CSV with these columns (flexible naming):

| Column | Examples |
|--------|---------|
| Name | name, full name |
| Email | email, mail |
| Company | company, org, employer |
| Role | role, title, position |
| Last Contact | last contact, date, last touched |
| Notes | notes, context, memo |

## Getting an Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. API Keys → Create Key
3. Add it to Vercel environment variables (never put it in your code)
