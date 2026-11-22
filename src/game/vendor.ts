export const vendorPrice = 8;
export const scoutKitBonus = 2;

const scoutKitNames = { en: "Scout's Field Kit", ru: "Походный набор разведчика" };
const eligibleSkills = new Set(["perception", "investigation", "survival"]);

export type Vendor = { role: "innkeeper" | "merchant" | "informant"; tip: string };
export type VendorPurchase = "tip" | "kit";

export function scoutKitName(language: "en" | "ru"): string {
  return scoutKitNames[language];
}

export function isScoutKit(item: string): boolean {
  const name = item.trim().replaceAll("’", "'").toLowerCase();
  return Object.values(scoutKitNames).some(candidate => name.startsWith(candidate.toLowerCase()));
}

export function hasScoutKitBonus(inventory: string[], skill?: string): boolean {
  return !!skill && eligibleSkills.has(skill) && inventory.some(isScoutKit);
}

export function spendScoutKit(inventory: string[]): string[] {
  const index = inventory.findIndex(isScoutKit);
  return index < 0 ? inventory : inventory.filter((_, itemIndex) => itemIndex !== index);
}
