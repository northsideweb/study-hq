import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '../../../..')

// Load .env from the repo root (never bundled into the frontend).
dotenv.config({ path: path.join(ROOT, '.env') })

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(ROOT, process.env.DATA_DIR)
  : path.join(ROOT, 'data')

export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
// Deliberately not `PORT`: some dev harnesses inject PORT for the web server,
// which would make the API bind over the top of Vite.
export const PORT = Number(process.env.API_PORT || 4100)

export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
export const aiConfigured = () => ANTHROPIC_API_KEY.trim().length > 0
