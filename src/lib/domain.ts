export type ChargeStatus = "paid" | "open" | "due_soon" | "overdue" | "waived" | "cancelled";

export function getChargeStatus(
  dueDate: string,
  balanceCents: number,
  referenceDate = todayInGoiania(),
): ChargeStatus {
  if (balanceCents <= 0) return "paid";
  const daysUntilDue = Math.floor((dateAsUtc(dueDate) - dateAsUtc(referenceDate)) / 86_400_000);
  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue <= 3) return "due_soon";
  return "open";
}

export function dateAsUtc(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function todayInGoiania(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function dueDateForMonth(year: number, monthIndex: number, enrollmentDay: number): string {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(1, enrollmentDay), lastDay);
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function currency(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function consecutiveAbsences(statuses: string[]): number {
  let count = 0;
  for (const status of statuses) {
    if (status === "absent") count += 1;
    else break;
  }
  return count;
}

export function monthlyChargeMessage(
  name: string,
  competence: string,
  value: string,
  dueDate: string,
): string {
  const [year, month] = competence.split("-");
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(year), Number(month) - 1, 1)));
  const [dueYear, dueMonth, dueDay] = dueDate.split("-");
  const dueLabel = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(dueYear), Number(dueMonth) - 1, Number(dueDay))));
  return `Oi, ${name}! Tudo bem? A mensalidade de ${monthLabel} (${year}), no valor de ${value}, vence em ${dueLabel}. Se já pagou, desconsidere. Obrigado!`;
}
