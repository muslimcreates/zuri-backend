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

export const MANUAL_PAYMENT_METHODS = [
  { value: "BANK_TRANSFER", label: "Bank transfer (havale/EFT)" },
  { value: "CASH_ON_DELIVERY", label: "Cash on delivery" },
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
