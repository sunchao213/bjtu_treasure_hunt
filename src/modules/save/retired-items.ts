const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Remove the retired collectible before validating saves; retain all other data. */
export function migrateRetiredItems(value: unknown): void {
  if (!record(value) || ![1, 2, 3].includes(Number(value.schemaVersion))) return;
  const keep = (item: unknown) => !record(item) || item.itemId !== 'campus-map';
  if (Array.isArray(value.warehouse)) value.warehouse = value.warehouse.filter(keep);
  if (Array.isArray(value.codexIds)) {
    value.codexIds = value.codexIds.filter((id) => id !== 'campus-map');
  }
  if (record(value.lastResult) && Array.isArray(value.lastResult.items)) {
    // Keep historical settlement scores even though their retired item is hidden.
    value.lastResult.items = value.lastResult.items.filter(keep);
  }
  if (record(value.activeRaid) && Array.isArray(value.activeRaid.loadout)) {
    value.activeRaid.loadout = value.activeRaid.loadout.filter(keep);
  }
}
