import { describe, expect, it } from "vitest";
import { consecutiveAbsences, dueDateForMonth, getChargeStatus } from "./domain";

describe("situação da mensalidade", () => {
  it("fica amarela no vencimento e nos três dias anteriores", () => {
    expect(getChargeStatus("2026-11-27", 10000, "2026-11-24")).toBe("due_soon");
    expect(getChargeStatus("2026-11-24", 10000, "2026-11-24")).toBe("due_soon");
  });

  it("fica vencida somente depois da data e quitada sem saldo", () => {
    expect(getChargeStatus("2026-11-23", 10000, "2026-11-24")).toBe("overdue");
    expect(getChargeStatus("2026-11-20", 0, "2026-11-24")).toBe("paid");
    expect(getChargeStatus("2026-11-30", 10000, "2026-11-24")).toBe("open");
  });
});

describe("vencimento mensal", () => {
  it("ajusta dia 31 para o último dia do mês", () => {
    expect(dueDateForMonth(2026, 1, 31)).toBe("2026-02-28");
    expect(dueDateForMonth(2028, 1, 31)).toBe("2028-02-29");
  });
});

describe("faltas consecutivas", () => {
  it("conta somente as últimas chamadas registradas, sem transformar chamada em branco em falta", () => {
    expect(consecutiveAbsences(["absent", "absent", "present", "absent"])).toBe(2);
    expect(consecutiveAbsences(["present", "absent"])).toBe(0);
  });
});
