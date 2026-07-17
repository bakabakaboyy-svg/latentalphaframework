// Capital velocity filter — opportunities settling further out tie up
// quarter-Kelly capital for longer without a proportionally higher edge, so
// the detection route excludes anything outside a 7-day settlement window
// entirely, and flags anything inside 48 hours as urgent for the UI's
// urgency dot.

const VELOCITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const URGENT_WINDOW_MS = 48 * 60 * 60 * 1000;

export function withinVelocityWindow(settleAt: string | Date, now: Date = new Date()): boolean {
  const settleMs = new Date(settleAt).getTime();
  return settleMs - now.getTime() <= VELOCITY_WINDOW_MS;
}

export function prioritizeUrgent(settleAt: string | Date, now: Date = new Date()): boolean {
  const settleMs = new Date(settleAt).getTime();
  const msUntilSettle = settleMs - now.getTime();
  return msUntilSettle >= 0 && msUntilSettle <= URGENT_WINDOW_MS;
}
