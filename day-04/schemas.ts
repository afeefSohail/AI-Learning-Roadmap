import { currencyCode, z } from "zod";

export const ReceiptSchema = z.object({
    isReceipt: z.boolean().describe("true only if the text is a purchase receipt or bill"),
    merchant: z.string(),
    date:z.string().describe("ISO date, YYYY-MM-DD"),
    currency: z.string().describe("3-letter ISO currency code, e.g. USD"),
    items: z.array(
        z.object({
            name: z.string(),
            quantity: z.number().refine(Number.isInteger, "must be a whole number"),
            price: z.number().describe("price per unit"),
        })
    ),
    tax: z.number().nullable().describe("tax amount, null if not applicable"),
    total: z.number(),
})
// Zod rules the API schema can't express
.refine((r) => r.isReceipt || r.items.length === 0, {
    message: "isReceipt is false but items were extracted. Fix one or the other.",
})
.refine((data) => {
    const calculatedTotal = data.items.reduce((sum, item) => sum + item.price * item.quantity, 0) + (data.tax ?? 0);
    return Math.abs(calculatedTotal - data.total) < 0.02; // Allowing a small margin for floating point errors
}, { message:  "items (quantity × price) plus tax must equal total"}
);

export type Receipt = z.infer<typeof ReceiptSchema>;