/** A killed writer may leave one partial final record; keep its bytes as evidence. */
export function recoverJournal(text) {
  const end = text.lastIndexOf('\n');
  const complete = text.slice(0, end + 1);
  const entries = complete
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { entries, truncatedTail: text.slice(end + 1) || null };
}
