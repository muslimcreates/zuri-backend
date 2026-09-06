// Payment provider abstraction.
//
// Zuri Express doesn't have a registered Turkish company yet, so there is no
// live payment gateway integration — iyzico and PayTR (the two realistic
// options for a Turkey-based store) both require a trade registry gazette,
// tax ID and company IBAN to open an account.
//
// Until then, checkout collects a *manual* payment method and the order sits
// in PENDING_PAYMENT until the admin manually confirms funds arrived and
// flips it to PAYMENT_RECEIVED via PATCH /api/admin/orders/:id.
//
// When the company exists, implement `PaymentProvider` below (e.g.
// `IyzicoProvider`) and swap `activeProvider`. Nothing in the checkout route
// or order model needs to change.

// Cash on delivery isn't offered here on purpose — Zuri Express has no way
// to collect cash at the door, so every order placed with it in the past
// had to be chased down for payment by hand after the fact. The
// PaymentMethod enum (schema.prisma) still has CASH_ON_DELIVERY so those
// past orders keep their recorded value; it's just not in this list, so it
// can no longer be selected at checkout.
export const MANUAL_PAYMENT_METHODS = [
  { value: "BANK_TRANSFER", label: "Bank transfer (havale/EFT)" },
  { value: "MPESA", label: "M-Pesa" },
] as const;

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number]["value"];

export const MANUAL_PAYMENT_VALUES = MANUAL_PAYMENT_METHODS.map((m) => m.value) as [
  ManualPaymentMethod,
  ...ManualPaymentMethod[],
];

export interface PaymentProvider {
  name: string;
  /**
   * Placeholder for a real gateway integration (e.g. iyzico's checkout form
   * initialization). Not implemented — there is no live provider yet.
   */
  createCheckout?(params: { orderId: string; amountKurus: number }): Promise<never>;
}

class ManualPaymentProvider implements PaymentProvider {
  name = "Manual (bank transfer / cash on delivery)";
}

export const activeProvider: PaymentProvider = new ManualPaymentProvider();
