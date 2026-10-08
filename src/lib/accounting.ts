export type ExpenseCategoryDefinition = {
  value: string;
  label: string;
  hmrcCategory: string;
  hmrcLabel: string;
};

export type OtherIncomeCategoryDefinition = {
  value: string;
  label: string;
};

export type TaxTreatmentDefinition = {
  value: string;
  label: string;
  vatRate: number;
};

/**
 * HMRC's Making Tax Digital self-employment expense categories (Self-Employment Business API,
 * periodExpenses). Under £90,000 turnover a business can send one consolidated total instead.
 */
export const HMRC_EXPENSE_CATEGORIES = [
  { key: "costOfGoods", label: "Cost of goods bought for resale or goods used" },
  { key: "paymentsToSubcontractors", label: "Payments to subcontractors" },
  { key: "wagesAndStaffCosts", label: "Wages, salaries and other staff costs" },
  { key: "carVanTravelExpenses", label: "Car, van and travel expenses" },
  { key: "premisesRunningCosts", label: "Rent, rates, power and insurance costs" },
  { key: "maintenanceCosts", label: "Repairs and maintenance of property and equipment" },
  { key: "adminCosts", label: "Phone, fax, stationery and other office costs" },
  { key: "businessEntertainmentCosts", label: "Business entertainment costs" },
  { key: "advertisingCosts", label: "Advertising costs" },
  { key: "interestOnBankOtherLoans", label: "Interest on bank and other loans" },
  { key: "financeCharges", label: "Bank, credit card and other financial charges" },
  { key: "irrecoverableDebts", label: "Irrecoverable debts written off" },
  { key: "professionalFees", label: "Accountancy, legal and other professional fees" },
  { key: "depreciation", label: "Depreciation and loss/profit on sale of assets" },
  { key: "otherExpenses", label: "Other business expenses" },
] as const;
const hmrc = (key: (typeof HMRC_EXPENSE_CATEGORIES)[number]["key"]) => ({ hmrcCategory: key, hmrcLabel: HMRC_EXPENSE_CATEGORIES.find((c) => c.key === key)!.label });

/** Wyndos's everyday categories, each filed under one HMRC category. */
export const EXPENSE_CATEGORIES: ExpenseCategoryDefinition[] = [
  { value: "FUEL", label: "Fuel and travel", ...hmrc("carVanTravelExpenses") },
  { value: "VEHICLE_MAINTENANCE", label: "Vehicle repairs and servicing", ...hmrc("carVanTravelExpenses") },
  { value: "VEHICLE_COSTS", label: "Vehicle tax, insurance, parking and tolls", ...hmrc("carVanTravelExpenses") },
  { value: "SUPPLIES", label: "Cleaning supplies", ...hmrc("costOfGoods") },
  { value: "SUBCONTRACTORS", label: "Subcontractors", ...hmrc("paymentsToSubcontractors") },
  { value: "WAGES", label: "Wages and staff costs", ...hmrc("wagesAndStaffCosts") },
  { value: "PREMISES", label: "Rent, rates, power (unit, storage, yard)", ...hmrc("premisesRunningCosts") },
  { value: "INSURANCE", label: "Business insurance (public liability)", ...hmrc("premisesRunningCosts") },
  { value: "EQUIPMENT_REPAIRS", label: "Equipment repairs and replacement parts", ...hmrc("maintenanceCosts") },
  { value: "OFFICE", label: "Office, phone and admin", ...hmrc("adminCosts") },
  { value: "SOFTWARE", label: "Software and subscriptions", ...hmrc("adminCosts") },
  { value: "MARKETING", label: "Advertising and marketing", ...hmrc("advertisingCosts") },
  { value: "ENTERTAINMENT", label: "Business entertainment (not tax deductible)", ...hmrc("businessEntertainmentCosts") },
  { value: "LOAN_INTEREST", label: "Loan and finance interest", ...hmrc("interestOnBankOtherLoans") },
  { value: "BANK_FEES", label: "Bank and card fees", ...hmrc("financeCharges") },
  { value: "BAD_DEBTS", label: "Bad debts written off", ...hmrc("irrecoverableDebts") },
  { value: "PROFESSIONAL_FEES", label: "Accountant and professional fees", ...hmrc("professionalFees") },
  { value: "EQUIPMENT", label: "Equipment and tools", ...hmrc("otherExpenses") },
  { value: "CLOTHING", label: "Workwear and protective clothing", ...hmrc("otherExpenses") },
  { value: "TRAINING", label: "Training and memberships", ...hmrc("otherExpenses") },
  { value: "OTHER", label: "Other", ...hmrc("otherExpenses") },
  // Starting figure entered when a business moves onto Wyndos part-way through a year.
  { value: "OPENING", label: "Expenses before Wyndos", ...hmrc("otherExpenses") },
];

export const OTHER_INCOME_CATEGORIES: OtherIncomeCategoryDefinition[] = [
  { value: "OTHER", label: "Other income" },
  { value: "COMMERCIAL", label: "Commercial work" },
  { value: "BONUS", label: "Bonus / tip" },
  { value: "EQUIPMENT_SALE", label: "Equipment sale" },
  { value: "ADJUSTMENT", label: "Adjustment" },
  { value: "OPENING", label: "Earnings before Wyndos" },
];

/** Category used for the one-off starting figures (see Accounting, "Before Wyndos"). */
export const OPENING_CATEGORY = "OPENING";

export const TAX_TREATMENT_OPTIONS: TaxTreatmentDefinition[] = [
  { value: "NO_VAT", label: "No VAT registered", vatRate: 0 },
  { value: "STANDARD_20", label: "Standard rated 20% VAT", vatRate: 20 },
  { value: "REDUCED_5", label: "Reduced rate 5% VAT", vatRate: 5 },
  { value: "ZERO_RATED", label: "Zero rated", vatRate: 0 },
  { value: "EXEMPT", label: "Exempt", vatRate: 0 },
  { value: "OUT_OF_SCOPE", label: "Out of scope", vatRate: 0 },
];

const EXPENSE_CATEGORY_MAP = new Map(EXPENSE_CATEGORIES.map((category) => [category.value, category]));
const OTHER_INCOME_CATEGORY_MAP = new Map(OTHER_INCOME_CATEGORIES.map((category) => [category.value, category]));
// "VAT entered as an amount" (starting figures): not offered in the pickers.
const ENTERED_VAT: TaxTreatmentDefinition = { value: "MIXED", label: "VAT as entered", vatRate: 0 };
const TAX_TREATMENT_MAP = new Map([...TAX_TREATMENT_OPTIONS, ENTERED_VAT].map((option) => [option.value, option]));

export function getExpenseCategory(value: string | null | undefined) {
  return EXPENSE_CATEGORY_MAP.get(value ?? "") ?? EXPENSE_CATEGORY_MAP.get("OTHER")!;
}

export function getOtherIncomeCategory(value: string | null | undefined) {
  return OTHER_INCOME_CATEGORY_MAP.get(value ?? "") ?? OTHER_INCOME_CATEGORY_MAP.get("OTHER")!;
}

export function getTaxTreatment(value: string | null | undefined) {
  return TAX_TREATMENT_MAP.get(value ?? "") ?? TAX_TREATMENT_MAP.get("NO_VAT")!;
}
