export function renderTemplate(text: string, title: string, now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const values: Record<string, string> = {
    title,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
  return text.replace(/\{\{(title|date|time)\}\}/g, (_, key: string) => values[key]);
}
