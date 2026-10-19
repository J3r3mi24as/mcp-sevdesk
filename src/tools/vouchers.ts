import { z } from "zod";
import type { SevdeskClient } from "../client.js";

// Umsatzsteuerregelung (TaxSet) of this client for Ausgabebelege. The sevdesk UI
// saves taxType "custom" + taxSet; a voucher with plain taxType "default" gets no
// regime and the UI falls back to its first option. IDs are client-specific, read
// from vouchers corrected by hand in the UI on 2026-10-19; override via env.
const TAX_SET_VORSTEUER = Number(process.env.SEVDESK_TAXSET_VORSTEUER ?? 131709); // Vorsteuer, USt ausgewiesen (20 %/10 %)
const TAX_SET_REVERSE_CHARGE = Number(process.env.SEVDESK_TAXSET_REVERSE_CHARGE ?? 131713); // EU-Leistung / Reverse Charge, 0 %
const TAX_SET_STEUERFREI = Number(process.env.SEVDESK_TAXSET_STEUERFREI ?? 131711); // ohne USt (z. B. Bankspesen)

function taxSetFor(taxType: "default" | "eu" | "noteu" | "ss", taxRate: number): number {
  if (taxType === "eu" || taxType === "noteu") return TAX_SET_REVERSE_CHARGE;
  if (taxType === "ss" || taxRate === 0) return TAX_SET_STEUERFREI;
  return TAX_SET_VORSTEUER;
}

export const voucherTools = {
  list_vouchers: {
    description: "List all vouchers (receipts/expenses) from sevdesk",
    inputSchema: z.object({
      status: z.enum(["50", "100", "1000"]).optional().describe("Voucher status: 50=Draft, 100=Unpaid, 1000=Paid"),
      creditDebit: z.enum(["C", "D"]).optional().describe("C = Ausgabe/expense, D = Einnahme/income (sevdesk names it backwards; verified against real vouchers)"),
      descriptionLike: z.string().optional().describe("Filter by description (partial match)"),
      startDate: z.string().optional().describe("Filter by start date (Unix timestamp)"),
      endDate: z.string().optional().describe("Filter by end date (Unix timestamp)"),
      limit: z.number().optional().describe("Limit the number of results"),
      offset: z.number().optional().describe("Skip a number of results"),
    }),
    handler: async (client: SevdeskClient, params: {
      status?: "50" | "100" | "1000";
      creditDebit?: "C" | "D";
      descriptionLike?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    }) => {
      const { data, error } = await client.GET("/Voucher", {
        params: {
          query: {
            status: params.status ? Number(params.status) : undefined,
            creditDebit: params.creditDebit,
            descriptionLike: params.descriptionLike,
            startDate: params.startDate ? Number(params.startDate) : undefined,
            endDate: params.endDate ? Number(params.endDate) : undefined,
            limit: params.limit,
            offset: params.offset,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_voucher: {
    description: "Get a specific voucher by ID from sevdesk",
    inputSchema: z.object({
      voucherId: z.number().describe("The ID of the voucher to retrieve"),
    }),
    handler: async (client: SevdeskClient, params: { voucherId: number }) => {
      const { data, error } = await client.GET("/Voucher/{voucherId}", {
        params: {
          path: { voucherId: params.voucherId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  book_voucher: {
    description: "Book a voucher (mark it as paid)",
    inputSchema: z.object({
      voucherId: z.number().describe("The ID of the voucher to book"),
      amount: z.number().describe("Amount to book"),
      date: z.string().describe("Booking date (Unix timestamp)"),
      type: z.enum(["N", "CB", "CF", "O", "OF", "MF", "C"]).describe("Booking type: N=Normal, CB=Cash discount, etc."),
      checkAccountId: z.number().describe("ID of the check account"),
      checkAccountTransactionId: z.number().optional().describe("ID of an existing transaction to link"),
      createFeed: z.boolean().optional().describe("Create a feed entry"),
    }),
    handler: async (client: SevdeskClient, params: {
      voucherId: number;
      amount: number;
      date: string;
      type: "N" | "CB" | "CF" | "O" | "OF" | "MF" | "C";
      checkAccountId: number;
      checkAccountTransactionId?: number;
      createFeed?: boolean;
    }) => {
      const { data, error } = await client.PUT("/Voucher/{voucherId}/bookAmount", {
        params: {
          path: { voucherId: params.voucherId },
        },
        body: {
          amount: params.amount,
          date: params.date,
          type: params.type,
          checkAccount: {
            id: params.checkAccountId,
            objectName: "CheckAccount",
          },
          checkAccountTransaction: params.checkAccountTransactionId
            ? {
                id: params.checkAccountTransactionId,
                objectName: "CheckAccountTransaction",
              }
            : undefined,
          createFeed: params.createFeed,
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_voucher_positions: {
    description: "Get all positions (line items) of a voucher",
    inputSchema: z.object({
      voucherId: z.number().describe("The ID of the voucher"),
    }),
    handler: async (client: SevdeskClient, params: { voucherId: number }) => {
      const { data, error } = await client.GET("/VoucherPos", {
        params: {
          query: {
            "voucher[id]": params.voucherId,
            "voucher[objectName]": "Voucher",
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  list_expense_accounts: {
    description:
      "List the active booking accounts (Buchungskonten, AccountingType) of this sevdesk client's chart of accounts (skrAt for RVL) as compact rows {id, name, skrAt, type}. Pick one for create_voucher (`accountingTypeId` = id) — never invent an id. The list mixes expense and revenue accounts: choose an expense account.",
    inputSchema: z.object({}),
    handler: async (client: SevdeskClient, _params: Record<string, never>) => {
      // Not /ReceiptGuidance/*: that endpoint 500s with "Chart of account
      // SKRAT is unknown!" for an Austrian client. /AccountingType is absent
      // from the generated spec, hence the cast; skrAt is the Austrian number.
      const { data, error } = await (client as any).GET("/AccountingType", {
        params: { query: { limit: 1000 } },
      });
      if (error) throw new Error(JSON.stringify(error));
      const rows = (data?.objects ?? []) as Array<Record<string, string | null>>;
      return rows
        .filter((a) => a.skrAt && a.active === "1" && a.hidden !== "1")
        .map((a) => ({ id: Number(a.id), name: a.name, skrAt: a.skrAt, type: a.type }));
    },
  },

  create_voucher: {
    description:
      "Create an expense voucher (Belegart Ausgabe, creditDebit C; incoming invoice/receipt) as a DRAFT (status 50) in sevdesk and attach an already uploaded file. Draft only: booking/payment stays a separate, gated step (book_voucher). `filename` is the sevdesk-internal temp filename returned by Voucher/Factory/uploadTempFile, not a local path.",
    inputSchema: z.object({
      supplierName: z.string().describe("Name of the issuer as printed on the document"),
      supplierContactId: z.number().optional().describe("sevdesk contact id if the supplier already exists"),
      voucherDate: z.string().describe("Document date, YYYY-MM-DD"),
      description: z.string().describe("Invoice number and short subject, e.g. 'RE-2026-0412 Hosting September'"),
      taxType: z
        .enum(["default", "eu", "noteu", "ss"])
        .describe("default=Umsatzsteuer ausgewiesen (inkl. AT-Inland), eu=innergemeinschaftlich, noteu=Drittland/Reverse Charge, ss=nicht steuerbar §19"),
      accountingTypeId: z.number().describe("Booking account id from list_expense_accounts"),
      taxRate: z.number().describe("VAT rate in percent as printed on the document, e.g. 20, 10 or 0"),
      sumGross: z.number().describe("Gross total in the document currency"),
      currency: z.string().optional().describe("ISO code, default EUR"),
      filename: z.string().optional().describe("sevdesk temp filename of the uploaded document"),
    }),
    handler: async (client: SevdeskClient, params: {
      supplierName: string;
      supplierContactId?: number;
      voucherDate: string;
      description: string;
      taxType: "default" | "eu" | "noteu" | "ss";
      accountingTypeId: number;
      taxRate: number;
      sumGross: number;
      currency?: string;
      filename?: string;
    }) => {
      const { data, error } = await client.POST("/Voucher/Factory/saveVoucher", {
        body: {
          voucher: {
            objectName: "Voucher",
            mapAll: true,
            voucherDate: params.voucherDate,
            supplierName: params.supplierName,
            supplier: params.supplierContactId
              ? { id: params.supplierContactId, objectName: "Contact" }
              : undefined,
            description: params.description,
            status: 50, // draft: nothing is booked or paid from here
            // sevdesk names this backwards: C = Ausgabe (expense), D = Einnahme (income).
            // Verified 2026-09-21 against real expense vouchers (1Password, sevDesk GmbH,
            // hosting invoices all carry C); a voucher created with D showed up as "Einnahme".
            creditDebit: "C",
            voucherType: "VOU",
            currency: params.currency ?? "EUR",
            // taxType "custom" + taxSet is what the sevdesk UI writes for this client
            // (taxRule stays null); params.taxType only selects the taxSet.
            taxType: "custom",
            taxSet: { id: taxSetFor(params.taxType, params.taxRate), objectName: "TaxSet" },
          },
          voucherPosSave: [
            {
              objectName: "VoucherPos",
              mapAll: true,
              accountingType: { id: params.accountingTypeId, objectName: "AccountingType" },
              taxRate: params.taxRate,
              net: false,
              sumGross: params.sumGross,
              isAsset: false,
            },
          ],
          voucherPosDelete: null,
          filename: params.filename,
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  upload_voucher_file: {
    description: "Upload a file (receipt image/PDF) for a voucher",
    inputSchema: z.object({
      voucherId: z.number().describe("The ID of the voucher"),
      fileName: z.string().describe("Name of the file"),
      base64Content: z.string().describe("Base64 encoded file content"),
      creditDebit: z.enum(["C", "D"]).optional().describe("C=Credit, D=Debit. Default: D"),
    }),
    handler: async (client: SevdeskClient, params: {
      voucherId: number;
      fileName: string;
      base64Content: string;
      creditDebit?: "C" | "D";
    }) => {
      const { data, error } = await client.POST("/Voucher/Factory/uploadTempFile", {
        body: {
          content: params.base64Content,
          filename: params.fileName,
          base64: true,
          creditDebit: params.creditDebit ?? "D",
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },
};
