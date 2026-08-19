import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/**
 * Renders text that may contain mathematics.
 *
 * Maths is written by the generator between $…$ (inline) or $$…$$ (display) and
 * rendered properly — so a fraction appears stacked with a bar rather than "3/4".
 * Everything outside those delimiters is plain text and is left exactly as written.
 */

/** Split on $$…$$ and $…$, keeping the delimiters' contents. */
function segments(text: string): Array<{ math: boolean; display: boolean; value: string }> {
  const out: Array<{ math: boolean; display: boolean; value: string }> = []
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ math: false, display: false, value: text.slice(last, m.index) })
    const body = m[1] ?? m[2] ?? m[3] ?? m[4] ?? ''
    out.push({ math: true, display: m[1] != null || m[4] != null, value: body })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ math: false, display: false, value: text.slice(last) })
  return out
}

/**
 * Older questions were written with plain slashes. For maths, turn a bare numeric
 * fraction into real notation — but never touch rates or dates, so "km/h", "m/s"
 * and "3/9/2026" are left alone.
 */
function autoFractions(text: string): Array<{ math: boolean; display: boolean; value: string }> {
  const parts: Array<{ math: boolean; display: boolean; value: string }> = []
  const re = /(?<![\w/.])(\d{1,4})\/(\d{1,4})(?![\w/.])/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ math: false, display: false, value: text.slice(last, m.index) })
    parts.push({ math: true, display: false, value: `\\frac{${m[1]}}{${m[2]}}` })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ math: false, display: false, value: text.slice(last) })
  return parts
}

export default function MathText({
  children, fractions = false, className, style,
}: {
  children?: string | null
  /** Also convert bare "3/4" into a rendered fraction. Use for maths content only. */
  fractions?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const html = useMemo(() => {
    const text = String(children ?? '')
    if (!text) return ''
    const base = segments(text)
    const parts = fractions
      ? base.flatMap((p) => (p.math ? [p] : autoFractions(p.value)))
      : base

    return parts
      .map((p) => {
        if (!p.math) {
          return p.value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
        }
        try {
          return katex.renderToString(p.value, {
            displayMode: p.display,
            throwOnError: false,
            strict: false,
            output: 'html',
          })
        } catch {
          // Never lose the question because the maths could not be parsed.
          return p.value.replace(/</g, '&lt;')
        }
      })
      .join('')
  }, [children, fractions])

  return <span className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />
}

/** True when the text looks like it contains maths worth rendering. */
export const hasMath = (text?: string | null) =>
  !!text && (/\$|\\frac|\\sqrt|\\times|\\div/.test(text) || /(?<![\w/.])\d{1,4}\/\d{1,4}(?![\w/.])/.test(text))
