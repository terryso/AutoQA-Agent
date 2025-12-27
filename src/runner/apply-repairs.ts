/**
 * Apply Repairs to IR Records
 *
 * Merges repair records into IR records, adding or updating chosenLocator values.
 */

import type { ActionRecord, ElementFingerprint } from '../ir/types.js'
import type { RepairRecord } from '../repair/types.js'

/**
 * Apply repair records to IR records.
 *
 * For each repair record, finds the matching IR record (by specPath and stepIndex)
 * and updates or creates its element.chosenLocator field.
 *
 * Merge logic:
 * - If repair has matching specPath and stepIndex → use repair's chosenLocator
 * - If IR record already has chosenLocator → repair overrides it
 * - If neither has locator → stays missing (no change)
 *
 * @param records - The IR records to update
 * @param repairs - The repair records to apply
 * @returns Updated IR records with repairs applied
 */
export function applyRepairs(
  records: ActionRecord[],
  repairs: RepairRecord[],
): ActionRecord[] {
  if (repairs.length === 0) {
    return records
  }

  // Create a map of repairs for efficient lookup: specPath:stepIndex -> repair
  const repairMap = new Map<string, RepairRecord>()
  for (const repair of repairs) {
    const key = `${repair.specPath}:${repair.stepIndex}`
    repairMap.set(key, repair)
  }

  // Apply repairs to records
  return records.map((record) => {
    // Skip records with null stepIndex
    if (record.stepIndex === null) {
      return record
    }

    const key = `${record.specPath}:${record.stepIndex}`
    const repair = repairMap.get(key)

    if (!repair) {
      // No repair for this record
      return record
    }

    // Apply repair: create or update element with chosenLocator
    const existingElement = record.element

    if (existingElement) {
      // Update existing element with repair's chosenLocator
      return {
        ...record,
        element: {
          ...existingElement,
          chosenLocator: repair.chosenLocator,
        },
      }
    }

    // Create new element with repair's chosenLocator
    // Note: fingerprint is minimal since we don't have original element data
    const minimalFingerprint: ElementFingerprint = {
      tagName: undefined,
      role: undefined,
      accessibleName: undefined,
      id: undefined,
      nameAttr: undefined,
      typeAttr: undefined,
      placeholder: undefined,
      ariaLabel: undefined,
      testId: undefined,
      textSnippet: undefined,
    }

    return {
      ...record,
      element: {
        fingerprint: minimalFingerprint,
        locatorCandidates: [],
        chosenLocator: repair.chosenLocator,
      },
    }
  })
}

/**
 * Load repair records for a specific spec from the repairs file.
 *
 * This is a convenience function that can be used in export flow.
 *
 * @param cwd - Current working directory
 * @param runId - Run ID
 * @param specPath - Spec path to filter repairs
 * @returns Array of repair records for the spec
 */
export async function loadRepairsForSpec(
  cwd: string,
  runId: string,
  specPath: string,
): Promise<RepairRecord[]> {
  const { RepairStorage } = await import('../repair/storage.js')
  const storage = new RepairStorage(cwd, runId)
  return storage.loadRepairs(specPath)
}
