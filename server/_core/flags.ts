export function isFlagEnabled(value: string | undefined, defaultEnabled: boolean): boolean {
  if (value === undefined || value === null || value.trim() === "") return defaultEnabled;
  const normalized = value.trim().toLowerCase();
  return !["0", "false", "off", "no", "disabled"].includes(normalized);
}
