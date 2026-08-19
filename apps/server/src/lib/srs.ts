/** SM-2 style spaced repetition. Grades: again | hard | good | easy */
export type Grade = 'again' | 'hard' | 'good' | 'easy'

export function schedule(card: { interval_days: number; ease: number; reps: number; lapses: number }, grade: Grade) {
  let { interval_days: interval, ease, reps, lapses } = card
  ease = ease || 2.5

  if (grade === 'again') {
    lapses += 1
    reps = 0
    ease = Math.max(1.3, ease - 0.2)
    interval = 0.007 // ~10 minutes, same-session re-show
  } else if (grade === 'hard') {
    reps += 1
    ease = Math.max(1.3, ease - 0.15)
    interval = interval < 1 ? 0.5 : interval * 1.2
  } else if (grade === 'good') {
    reps += 1
    interval = interval < 1 ? 1 : reps === 1 ? 1 : reps === 2 ? 3 : interval * ease
  } else {
    reps += 1
    ease = Math.min(3.2, ease + 0.15)
    interval = interval < 1 ? 3 : interval * ease * 1.3
  }

  interval = Math.min(interval, 365)
  const dueMs = Date.now() + interval * 24 * 60 * 60 * 1000
  const due = new Date(dueMs).toISOString().replace('T', ' ').slice(0, 19)
  return { interval_days: interval, ease, reps, lapses, due_at: due }
}
