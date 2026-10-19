import { z } from "zod";
import type { SevdeskClient } from "../client.js";

// The upstream defaults were German (19 %, Deutschland). RE-1002 went out with
// 20 % positions but "Umsatzsteuer 19%" stored as taxText, so derive the text
// from the positions instead of hardcoding a rate.
const AUSTRIA_COUNTRY_ID = 3;

export function defaultTaxText(positions: Array<{ taxRate: number }>): string {
  const rates = [...new Set(positions.map((p) => p.taxRate))];
  return rates.length === 1 ? `Umsatzsteuer ${rates[0]}%` : "Umsatzsteuer";
}

export const invoiceTools = {
  list_invoices: {
    description: "List all invoices from sevdesk. Supports filtering and pagination.",
    inputSchema: z.object({
      status: z.enum(["100", "200", "1000"]).optional().describe("Invoice status: 100=Draft, 200=Open, 1000=Paid"),
      invoiceNumber: z.string().optional().describe("Filter by invoice number"),
      startDate: z.string().optional().describe("Filter by start date (Unix timestamp)"),
      endDate: z.string().optional().describe("Filter by end date (Unix timestamp)"),
      limit: z.number().optional().describe("Limit the number of results"),
      offset: z.number().optional().describe("Skip a number of results"),
    }),
    handler: async (client: SevdeskClient, params: {
      status?: "100" | "200" | "1000";
      invoiceNumber?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    }) => {
      const { data, error } = await client.GET("/Invoice", {
        params: {
          query: {
            status: params.status ? Number(params.status) : undefined,
            invoiceNumber: params.invoiceNumber,
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

  get_invoice: {
    description: "Get a specific invoice by ID from sevdesk",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice to retrieve"),
    }),
    handler: async (client: SevdeskClient, params: { invoiceId: number }) => {
      const { data, error } = await client.GET("/Invoice/{invoiceId}", {
        params: {
          path: { invoiceId: params.invoiceId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_invoice_pdf: {
    description: "Get the PDF of an invoice as base64 encoded string",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice"),
      download: z.boolean().optional().describe("Whether to download the PDF"),
      preventSendBy: z.boolean().optional().describe("Prevent setting sendBy date"),
    }),
    handler: async (client: SevdeskClient, params: {
      invoiceId: number;
      download?: boolean;
      preventSendBy?: boolean;
    }) => {
      const { data, error } = await client.GET("/Invoice/{invoiceId}/getPdf", {
        params: {
          path: { invoiceId: params.invoiceId },
          query: {
            download: params.download,
            preventSendBy: params.preventSendBy,
          },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  create_invoice: {
    description: "Create a new invoice in sevdesk with one or more positions (line items)",
    inputSchema: z.object({
      contactId: z.number().describe("ID of the contact (customer) for this invoice"),
      contactPersonId: z.number().describe("ID of the sevdesk user (SevUser) acting as contact person"),
      invoiceDate: z.string().describe("Invoice date, format dd.mm.yyyy or Unix timestamp"),
      header: z.string().optional().describe("Invoice header text, e.g. 'Rechnung RE-1000'"),
      headText: z.string().optional().describe("HTML text shown above the positions"),
      footText: z.string().optional().describe("HTML text shown below the positions"),
      timeToPay: z.number().optional().describe("Days the customer has to pay"),
      deliveryDate: z.string().optional().describe("Delivery date, format dd.mm.yyyy or Unix timestamp"),
      address: z.string().optional().describe("Full recipient address (name, street, zip, city, country). Omitted = use the contact's default address"),
      addressCountryId: z.number().optional().describe("Static country ID for the invoice address, defaults to 3 (Österreich)"),
      discount: z.number().optional().describe("Overall invoice discount in percent, defaults to 0"),
      taxRuleId: z.enum(["1", "2", "3", "4", "5", "11", "17", "18", "19", "20", "21"]).optional()
        .describe("Tax rule ID (sevdesk-Update 2.0), defaults to 1 = Umsatzsteuer pflichtig - Standard"),
      taxText: z.string().optional().describe("Tax text stored on the invoice. Omitted = derived from the position tax rates, e.g. 'Umsatzsteuer 20%'"),
      taxType: z.enum(["default", "eu", "noteu", "custom"]).optional().describe("Tax type (sevdesk-Update 1.0), defaults to 'default'"),
      invoiceType: z.enum(["RE", "WKR", "SR", "MA", "TR", "AR", "ER"]).optional().describe("Invoice type, defaults to RE (regular invoice)"),
      currency: z.string().optional().describe("Currency code per ISO-4217, defaults to EUR"),
      status: z.enum(["100", "200", "1000"]).optional().describe("Invoice status: 100=Draft, 200=Open, 1000=Paid. Defaults to 100"),
      paymentMethodId: z.number().optional().describe("ID of the payment method"),
      positions: z.array(z.object({
        partId: z.number().optional().describe("ID of an existing part/article from inventory to use for this position"),
        name: z.string().optional().describe("Name of the position (required if no partId is given)"),
        quantity: z.number().describe("Quantity of the position"),
        price: z.number().optional().describe("Price of the position (net or gross, depending on the sevdesk account setting)"),
        unityId: z.number().optional().describe("Unit ID, defaults to 1 (Stück/piece)"),
        taxRate: z.number().describe("Tax rate of the position in percent, e.g. 19"),
        text: z.string().optional().describe("Description text for the position"),
        discount: z.number().optional().describe("Discount for this position"),
      })).min(1).describe("Invoice positions (line items). At least one is required."),
    }),
    handler: async (client: SevdeskClient, params: {
      contactId: number;
      contactPersonId: number;
      invoiceDate: string;
      header?: string;
      headText?: string;
      footText?: string;
      timeToPay?: number;
      deliveryDate?: string;
      address?: string;
      addressCountryId?: number;
      discount?: number;
      taxRuleId?: "1" | "2" | "3" | "4" | "5" | "11" | "17" | "18" | "19" | "20" | "21";
      taxText?: string;
      taxType?: "default" | "eu" | "noteu" | "custom";
      invoiceType?: "RE" | "WKR" | "SR" | "MA" | "TR" | "AR" | "ER";
      currency?: string;
      status?: "100" | "200" | "1000";
      paymentMethodId?: number;
      positions: Array<{
        partId?: number;
        name?: string;
        quantity: number;
        price?: number;
        unityId?: number;
        taxRate: number;
        text?: string;
        discount?: number;
      }>;
    }) => {
      const { data, error } = await client.POST("/Invoice/Factory/saveInvoice", {
        body: {
          invoice: {
            objectName: "Invoice",
            mapAll: true,
            contact: { id: params.contactId, objectName: "Contact" },
            contactPerson: { id: params.contactPersonId, objectName: "SevUser" },
            invoiceDate: params.invoiceDate,
            header: params.header,
            headText: params.headText,
            footText: params.footText,
            timeToPay: params.timeToPay,
            deliveryDate: params.deliveryDate,
            address: params.address,
            addressCountry: { id: params.addressCountryId ?? AUSTRIA_COUNTRY_ID, objectName: "StaticCountry" },
            discount: params.discount ?? 0,
            status: params.status ?? "100",
            taxRate: 0,
            taxRule: { id: params.taxRuleId ?? "1", objectName: "TaxRule" },
            taxText: params.taxText ?? defaultTaxText(params.positions),
            taxType: params.taxType ?? "default",
            invoiceType: params.invoiceType ?? "RE",
            currency: params.currency ?? "EUR",
            paymentMethod: params.paymentMethodId
              ? { id: params.paymentMethodId, objectName: "PaymentMethod" }
              : undefined,
          },
          invoicePosSave: params.positions.map((pos) => ({
            objectName: "InvoicePos",
            mapAll: true,
            part: pos.partId ? { id: pos.partId, objectName: "Part" } : undefined,
            name: pos.name,
            quantity: pos.quantity,
            price: pos.price,
            unity: { id: pos.unityId ?? 1, objectName: "Unity" },
            taxRate: pos.taxRate,
            text: pos.text,
            discount: pos.discount,
          })),
          invoicePosDelete: null,
          discountSave: null,
          discountDelete: null,
          takeDefaultAddress: !params.address,
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  send_invoice_by_email: {
    description: "Send an invoice via email",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice to send"),
      toEmail: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      text: z.string().describe("Email body text"),
      copy: z.boolean().optional().describe("Send a copy to your own email"),
      additionalAttachments: z.string().optional().describe("Additional attachment IDs, comma-separated"),
      ccEmail: z.string().optional().describe("CC email address"),
      bccEmail: z.string().optional().describe("BCC email address"),
    }),
    handler: async (client: SevdeskClient, params: {
      invoiceId: number;
      toEmail: string;
      subject: string;
      text: string;
      copy?: boolean;
      additionalAttachments?: string;
      ccEmail?: string;
      bccEmail?: string;
    }) => {
      const { data, error } = await client.POST("/Invoice/{invoiceId}/sendViaEmail", {
        params: {
          path: { invoiceId: params.invoiceId },
        },
        body: {
          toEmail: params.toEmail,
          subject: params.subject,
          text: params.text,
          copy: params.copy,
          additionalAttachments: params.additionalAttachments,
          ccEmail: params.ccEmail,
          bccEmail: params.bccEmail,
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  mark_invoice_as_sent: {
    description: "Mark an invoice as sent",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice"),
      sendType: z.enum(["VPR", "VPDF", "VM", "VP"]).optional().describe("Send type: VPR=Print, VPDF=PDF, VM=Email, VP=Post"),
      sendDraft: z.boolean().optional().describe("Send draft invoice"),
    }),
    handler: async (client: SevdeskClient, params: {
      invoiceId: number;
      sendType?: "VPR" | "VPDF" | "VM" | "VP";
      sendDraft?: boolean;
    }) => {
      const { data, error } = await client.PUT("/Invoice/{invoiceId}/sendBy", {
        params: {
          path: { invoiceId: params.invoiceId },
          query: {
            sendType: params.sendType ?? "VM",
            sendDraft: params.sendDraft,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  book_invoice: {
    description: "Book an invoice (mark it as paid)",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice to book"),
      amount: z.number().describe("Amount to book"),
      date: z.string().describe("Booking date (Unix timestamp)"),
      type: z.enum(["N", "CB", "CF", "O", "OF", "MF", "C"]).describe("Booking type: N=Normal, CB=Cash discount, etc."),
      checkAccountId: z.number().describe("ID of the check account"),
      checkAccountTransactionId: z.number().optional().describe("ID of an existing transaction to link"),
      createFeed: z.boolean().optional().describe("Create a feed entry"),
    }),
    handler: async (client: SevdeskClient, params: {
      invoiceId: number;
      amount: number;
      date: string;
      type: "N" | "CB" | "CF" | "O" | "OF" | "MF" | "C";
      checkAccountId: number;
      checkAccountTransactionId?: number;
      createFeed?: boolean;
    }) => {
      const { data, error } = await client.PUT("/Invoice/{invoiceId}/bookAmount", {
        params: {
          path: { invoiceId: params.invoiceId },
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

  cancel_invoice: {
    description: "Cancel an invoice (creates a cancellation invoice)",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice to cancel"),
    }),
    handler: async (client: SevdeskClient, params: { invoiceId: number }) => {
      const { data, error } = await client.POST("/Invoice/{invoiceId}/cancelInvoice", {
        params: {
          path: { invoiceId: params.invoiceId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },
};
