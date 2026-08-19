/**
 * Offline generators. Used when no ANTHROPIC_API_KEY is configured, or when the
 * student explicitly picks "local". Clearly labelled origin='local' everywhere.
 */

const rint = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1))
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
const money = (n: number) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export type LocalQuestion = {
  qtype: string
  difficulty: string
  prompt: string
  stimulus: string
  options: string[]
  answer: string
  working: string
  marking_guide: string
  marks: number
  topic_hint: string
}

/** Mathematics Standard templates - each call randomises numbers and context. */
const MATHS_TEMPLATES: Array<(d: string) => LocalQuestion> = [
  (d) => {
    const price = rint(20, 400)
    const pct = pick([5, 10, 12.5, 15, 20, 25])
    const gst = +(price * (pct / 100)).toFixed(2)
    return {
      qtype: 'short_answer', difficulty: d,
      prompt: `A ${pick(['jacket', 'phone case', 'set of headphones', 'bike helmet', 'textbook'])} costs ${money(price)} before a ${pct}% increase. Find the new price.`,
      stimulus: '', options: [],
      answer: money(+(price + gst).toFixed(2)),
      working: `Increase = ${pct}% of ${money(price)} = ${pct}/100 x ${price} = ${money(gst)}\nNew price = ${money(price)} + ${money(gst)} = ${money(+(price + gst).toFixed(2))}`,
      marking_guide: '1 mark: correct increase. 1 mark: correct new price.',
      marks: 2, topic_hint: 'Percentages',
    }
  },
  (d) => {
    const p = rint(2, 20) * 500, r = pick([2.5, 3, 3.5, 4, 4.5, 5, 6]), t = rint(2, 8)
    const si = +(p * (r / 100) * t).toFixed(2)
    return {
      qtype: 'short_answer', difficulty: d,
      prompt: `${money(p)} is invested at ${r}% p.a. simple interest for ${t} years. Calculate the interest earned and the final value.`,
      stimulus: '', options: [],
      answer: `Interest ${money(si)}, final value ${money(+(p + si).toFixed(2))}`,
      working: `I = Prn\n= ${p} x ${r / 100} x ${t}\n= ${money(si)}\nFinal value = ${money(p)} + ${money(si)} = ${money(+(p + si).toFixed(2))}`,
      marking_guide: '1 mark: correct substitution into I = Prn. 1 mark: interest. 1 mark: final value.',
      marks: 3, topic_hint: 'Simple interest',
    }
  },
  (d) => {
    const p = rint(2, 30) * 1000, r = pick([3, 4, 5, 6, 7]), n = rint(2, 10)
    const fv = +(p * Math.pow(1 + r / 100, n)).toFixed(2)
    return {
      qtype: 'short_answer', difficulty: d,
      prompt: `${money(p)} is invested at ${r}% p.a. compounded annually for ${n} years. Find the future value, correct to the nearest cent.`,
      stimulus: '', options: [],
      answer: money(fv),
      working: `FV = PV(1 + r)^n\n= ${p}(1 + ${r / 100})^${n}\n= ${p} x ${(+Math.pow(1 + r / 100, n).toFixed(6))}\n= ${money(fv)}`,
      marking_guide: '1 mark: correct formula and substitution. 1 mark: correct answer to the nearest cent.',
      marks: 2, topic_hint: 'Compound interest',
    }
  },
  (d) => {
    const xs = Array.from({ length: pick([5, 7, 9]) }, () => rint(1, 40))
    const sorted = [...xs].sort((a, b) => a - b)
    const mean = +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)
    const median = sorted[(sorted.length - 1) / 2]
    return {
      qtype: 'short_answer', difficulty: d,
      prompt: `For the data set ${xs.join(', ')}, find the mean and the median.`,
      stimulus: '', options: [],
      answer: `Mean = ${mean}, median = ${median}`,
      working: `Mean = (${xs.join(' + ')}) / ${xs.length} = ${xs.reduce((a, b) => a + b, 0)} / ${xs.length} = ${mean}\nOrdered: ${sorted.join(', ')}\nMiddle value = ${median}`,
      marking_guide: '1 mark: mean. 1 mark: median (data ordered first).',
      marks: 2, topic_hint: 'Data analysis',
    }
  },
  (d) => {
    const a = rint(3, 20), b = rint(3, 20)
    const c = +Math.sqrt(a * a + b * b).toFixed(2)
    return {
      qtype: 'short_answer', difficulty: d,
      prompt: `A right-angled triangle has shorter sides of ${a} cm and ${b} cm. Find the length of the hypotenuse, correct to 2 decimal places.`,
      stimulus: '', options: [],
      answer: `${c} cm`,
      working: `c^2 = a^2 + b^2\n= ${a}^2 + ${b}^2 = ${a * a} + ${b * b} = ${a * a + b * b}\nc = sqrt(${a * a + b * b}) = ${c} cm`,
      marking_guide: '1 mark: correct use of Pythagoras. 1 mark: correct answer to 2 dp.',
      marks: 2, topic_hint: 'Pythagoras / measurement',
    }
  },
  (d) => {
    const hrs = rint(12, 38), rate = +(rint(2400, 3600) / 100).toFixed(2), ot = rint(0, 6)
    const pay = +(hrs * rate + ot * rate * 1.5).toFixed(2)
    return {
      qtype: 'short_answer', difficulty: d,
      prompt: `A casual employee works ${hrs} ordinary hours at ${money(rate)}/hour plus ${ot} hours at time-and-a-half. Calculate the gross weekly pay.`,
      stimulus: '', options: [],
      answer: money(pay),
      working: `Ordinary = ${hrs} x ${money(rate)} = ${money(+(hrs * rate).toFixed(2))}\nOvertime = ${ot} x ${money(rate)} x 1.5 = ${money(+(ot * rate * 1.5).toFixed(2))}\nGross = ${money(pay)}`,
      marking_guide: '1 mark: ordinary pay. 1 mark: overtime at 1.5x. 1 mark: total.',
      marks: 3, topic_hint: 'Earning money',
    }
  },
  (d) => {
    const r = rint(2, 15), h = rint(3, 25)
    const vol = +(Math.PI * r * r * h).toFixed(2)
    return {
      qtype: 'short_answer', difficulty: d,
      prompt: `A cylindrical water tank has radius ${r} m and height ${h} m. Find its volume in cubic metres, correct to 2 decimal places.`,
      stimulus: '', options: [],
      answer: `${vol} m^3`,
      working: `V = pi r^2 h\n= pi x ${r}^2 x ${h}\n= pi x ${r * r} x ${h}\n= ${vol} m^3`,
      marking_guide: '1 mark: correct formula. 1 mark: correct answer to 2 dp.',
      marks: 2, topic_hint: 'Volume / measurement',
    }
  },
  (d) => {
    const total = rint(20, 60), fav = rint(3, 15)
    const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
    const k = g(fav, total)
    return {
      qtype: 'multiple_choice', difficulty: d,
      prompt: `A bag contains ${total} tickets, of which ${fav} are winning tickets. One ticket is drawn at random. What is the probability that it wins?`,
      stimulus: '',
      options: [`${fav / k}/${total / k}`, `${total / k}/${fav / k}`, `${fav}/${total + fav}`, `1/${fav}`],
      answer: `${fav / k}/${total / k}`,
      working: `P(win) = favourable / total = ${fav}/${total} = ${fav / k}/${total / k}`,
      marking_guide: '1 mark: correct simplified probability.',
      marks: 1, topic_hint: 'Probability',
    }
  },
  (d) => {
    const m = rint(2, 12), c = rint(-20, 40), x = rint(2, 15)
    return {
      qtype: 'short_answer', difficulty: d,
      prompt: `The cost of hiring a ${pick(['marquee', 'trailer', 'jumping castle', 'sound system'])} is modelled by C = ${m}h ${c >= 0 ? '+ ' + c : '- ' + Math.abs(c)}, where h is hours. Find the cost for ${x} hours, and interpret the value ${m} in this context.`,
      stimulus: '', options: [],
      answer: `${money(m * x + c)}; ${m} is the cost per additional hour (the gradient).`,
      working: `C = ${m}(${x}) ${c >= 0 ? '+ ' + c : '- ' + Math.abs(c)} = ${m * x} ${c >= 0 ? '+ ' + c : '- ' + Math.abs(c)} = ${money(m * x + c)}\nThe gradient ${m} is the extra cost for each additional hour.`,
      marking_guide: '1 mark: correct substitution. 1 mark: correct cost. 1 mark: correct interpretation of the gradient.',
      marks: 3, topic_hint: 'Linear relationships',
    }
  },
]

export function localMathsQuestions(count: number, difficulty = 'medium'): LocalQuestion[] {
  const out: LocalQuestion[] = []
  const order = [...MATHS_TEMPLATES].sort(() => Math.random() - 0.5)
  for (let i = 0; i < count; i++) out.push(order[i % order.length](difficulty))
  return out
}

/** Heuristic flashcards from the student's own text: "Term - definition" / "Term: definition" lines. */
export function localFlashcards(text: string, count: number) {
  const cards: Array<{ front: string; back: string; extra: string; card_kind: string; topic_hint: string }> = []
  const seen = new Set<string>()
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    // Drop the context-block headers ("=== MY CLASS NOTES: ... ===") added by buildContext.
    .filter((l) => !/^(===|---|SUBJECT:|FOCUS TOPIC:)/.test(l))
    // Strip the bullet and the "[studying]" status marker buildContext adds to syllabus lines.
    .map((l) => l.replace(/^[\s•\-*\d.()]+/, '').replace(/^\[(not_started|studying|needs_revision|completed)\]\s*/, '').trim())
    .filter((l) => l.length > 8)

  for (const line of lines) {
    if (cards.length >= count) break
    const m = line.match(/^(.{3,70}?)\s*(?::|\s[-–—]\s|\bmeans\b|\bis defined as\b|\brefers to\b)\s*(.{15,600})$/i)
    if (!m) continue
    const front = m[1].replace(/[:\-–—]\s*$/, '').trim()
    const back = m[2].trim()
    // Skip metadata labels that appear in the context block rather than real content.
    if (/^(page|slide|term|week|date|name|teacher|notes?|status|priority|started?|assessment|subject|focus topic|my )\b/i.test(front)) continue
    const key = front.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    cards.push({ front: `Define / explain: ${front}`, back, extra: '', card_kind: 'definition', topic_hint: '' })
  }

  // Fall back to sentence cloze if too few definition-shaped lines were found.
  if (cards.length < count) {
    const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 60 && s.length < 320)
    for (const s of sentences) {
      if (cards.length >= count) break
      const words = s.split(/\s+/)
      const idx = words.findIndex((w) => w.length > 7 && /^[A-Za-z]+$/.test(w))
      if (idx === -1) continue
      const answer = words[idx].replace(/[^A-Za-z]/g, '')
      const cloze = [...words.slice(0, idx), '________', ...words.slice(idx + 1)].join(' ')
      if (seen.has(cloze.slice(0, 40))) continue
      seen.add(cloze.slice(0, 40))
      cards.push({ front: cloze, back: answer, extra: s, card_kind: 'basic', topic_hint: '' })
    }
  }
  return cards
}

/** Very simple offline practice from the student's own notes - definition recall. */
export function localQuestionsFromText(text: string, count: number, difficulty = 'medium'): LocalQuestion[] {
  return localFlashcards(text, count).map((c) => ({
    qtype: 'definition', difficulty,
    prompt: c.front, stimulus: '', options: [],
    answer: c.back, working: '',
    marking_guide: 'Full marks for a definition matching the meaning in your own notes.',
    marks: 2, topic_hint: c.topic_hint,
  }))
}
