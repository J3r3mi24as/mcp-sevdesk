import { describe, it, expect } from "vitest";
import { defaultTaxText } from "../src/tools/invoices.js";

describe("defaultTaxText", () => {
  it("leitet den Text aus einem einheitlichen Steuersatz ab", () => {
    expect(defaultTaxText([{ taxRate: 20 }, { taxRate: 20 }])).toBe("Umsatzsteuer 20%");
  });

  it("nennt bei gemischten Sätzen keinen Satz", () => {
    expect(defaultTaxText([{ taxRate: 20 }, { taxRate: 10 }])).toBe("Umsatzsteuer");
  });

  it("übernimmt 0 % unverändert", () => {
    expect(defaultTaxText([{ taxRate: 0 }])).toBe("Umsatzsteuer 0%");
  });
});
