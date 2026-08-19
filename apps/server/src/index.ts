import express from 'express'
import cors from 'cors'
import { PORT, aiConfigured, ANTHROPIC_MODEL } from './lib/config.js'
import './lib/db.js'
import { core } from './routes/core.js'
import { uploads } from './routes/uploads.js'
import { study } from './routes/study.js'
import { insights } from './routes/insights.js'
import { extras } from './routes/extras.js'
import { AiNotConfigured } from './lib/ai.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '25mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ai_configured: aiConfigured(), model: aiConfigured() ? ANTHROPIC_MODEL : null })
})

app.get('/api/ai/status', (_req, res) => {
  res.json({
    configured: aiConfigured(),
    model: aiConfigured() ? ANTHROPIC_MODEL : null,
    env_var: 'ANTHROPIC_API_KEY',
    hint: aiConfigured()
      ? null
      : 'Add ANTHROPIC_API_KEY to the .env file in the Study HQ folder and restart the server. Offline generators are used until then.',
  })
})

app.use('/api', core)
app.use('/api', uploads)
app.use('/api', study)
app.use('/api', insights)
app.use('/api', extras)

app.use((_req, res) => res.status(404).json({ error: 'Not found' }))

// Central error handler: always return a readable message the UI can display.
app.use((err: any, _req: any, res: any, _next: any) => {
  const status = err instanceof AiNotConfigured ? 503 : err?.status || err?.statusCode || 500
  const message = err?.message || 'Unexpected server error'
  if (status >= 500) console.error('[study-hq]', err)
  res.status(status).json({ error: message, code: err?.name })
})

app.listen(PORT, () => {
  console.log(`Study HQ API  http://localhost:${PORT}`)
  console.log(aiConfigured() ? `AI: enabled (${ANTHROPIC_MODEL})` : 'AI: disabled - set ANTHROPIC_API_KEY in .env to enable AI features')
})
