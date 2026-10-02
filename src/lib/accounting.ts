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

export const EXPENSE_CATEGORIES: ExpenseCategoryDefinition[] = [
  { value: "FUEL", label: "Fuel and travel", hmrcCategory: "carVanTravel", hmrcLabel: "Car, van and travel" },
  { value: "SUPPLIES", label: "Cleaning supplies", hmrcCategory: "costOfGoods", hmrcLabel: "Cost of goods bought for resale" },
  { value: "EQUIPMENT", label: "Equipment", hmrcCategory: "otherAllowableBusinessExpenses", hmrcLabel: "Other allowable expenses" },
  { value: "SOFTWARE", label: "Software and subscriptions", hmrcCategory: "adminCosts", hmrcLabel: "Office, property and equipment" },
  { value: "INSURANCE", label: "Insurance", hmrcCategory: "otherAllowableBusinessExpenses", hmrcLabel: "Other allowable expenses" },
  { value: "MARKETING", label: "Advertising and marketing", hmrcCategory: "advertisingCosts", hmrcLabel: "Advertising and business entertainment" },
  { value: "SUBCONTRACTORS", label: "Subcontractors", hmrcCategory: "constructionIndustrySubcontractors", hmrcLabel: "Construction industry subcontractors" },
  { value: "OFFICE", label: "Office and admin", hmrcCategory: "adminCosts", hmrcLabel: "Office, property and equipment" },
  { value: "VEHICLE_MAINTENANCE", label: "Vehicle maintenance", hmrcCategory: "maintenanceCosts", hmrcLabel: "Repairs and maintenance" },
  { value: "BANK_FEES", label: "Bank fees and finance", hmrcCategory: "financeCharges", hmrcLabel: "Interest, bank and credit card charges" },
  { value: "PROFESSIONAL_FEES", label: "Professional fees", hmrcCategory: "professionalFees", hmrcLabel: "Accountancy, legal and professional fees" },
  { value: "OTHER", label: "Other", hmrcCategory: "otherAllowableBusinessExpenses", hmrcLabel: "Other allowable expenses" },
  // Starting figure entered when a business moves onto Wyndos part-way through a year.
  { value: "OPENING", label: "Expenses before Wyndos", hmrcCategory: "otherAllowableBusinessExpenses", hmrcLabel: "Other allowable expenses" },
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
