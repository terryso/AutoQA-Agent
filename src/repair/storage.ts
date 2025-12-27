/**
 * Repair Storage
 *
 * Handles persistent storage of repair records in repairs.json files.
 * Uses atomic writes to ensure data integrity.
 */

import { join } from 'node:path'
import { mkdir, rename, readFile, writeFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Logger } from '../logging/index.js'
import type { LocatorCandidate } from '../ir/types.js'
import type { RepairRecord, RepairFile } from './types.js'

/**
 * Storage class for repair records.
 *
 * Manages reading and writing repairs.json files in the .autoqa/runs/<runId>/ directory.
 * Uses atomic writes (write to temp file, then rename) to prevent corruption.
 */
export class RepairStorage {
  private readonly cwd: string
  private readonly runId: string
  private readonly repairsDir: string
  private readonly logger?: Logger

  /**
   * Create a new RepairStorage instance.
   *
   * @param cwd - Current working directory
   * @param runId - Run ID for this repair session
   * @param logger - Optional logger instance
   */
  constructor(cwd: string, runId: string, logger?: Logger) {
    this.cwd = cwd
    this.runId = runId
    this.repairsDir = join(cwd, '.autoqa', 'runs', runId)
    this.logger = logger
  }

  /**
   * Get the path to the repairs.json file.
   */
  getRepairsFilePath(): string {
    return join(this.repairsDir, 'repairs.json')
  }

  /**
   * Save a repair record to the repairs.json file.
   *
   * Creates the repairs.json file if it doesn't exist, otherwise appends to it.
   * Uses atomic write (write to temp file + rename) for safety.
   *
   * @param specPath - Path to the spec file
   * @param stepIndex - Step index being repaired
   * @param stepText - Step text description
   * @param chosenLocator - The locator chosen by the user
   */
  async saveRepair(
    specPath: string,
    stepIndex: number,
    stepText: string,
    chosenLocator: LocatorCandidate,
  ): Promise<void> {
    const repairsFilePath = this.getRepairsFilePath()
    const now = new Date()
    const timestamp = now.getTime()
    const repairedAt = now.toISOString()

    this.logger?.log({
      event: 'autoqa.repair.save.started',
      runId: this.runId,
      specPath,
      stepIndex,
      stepText,
    })

    let repairFile: RepairFile

    if (existsSync(repairsFilePath)) {
      // Load existing file
      try {
        const content = await readFile(repairsFilePath, 'utf-8')
        repairFile = JSON.parse(content) as RepairFile

        // Update updatedAt timestamp
        repairFile.updatedAt = repairedAt

        this.logger?.log({
          event: 'autoqa.repair.save.loaded_existing',
          runId: this.runId,
          existingRepairCount: repairFile.repairs.length,
        })
      } catch (err) {
        // File exists but is invalid - create new
        this.logger?.log({
          event: 'autoqa.repair.save.invalid_file',
          runId: this.runId,
          error: err instanceof Error ? err.message : String(err),
        })

        repairFile = {
          runId: this.runId,
          createdAt: repairedAt,
          updatedAt: repairedAt,
          repairs: [],
        }
      }
    } else {
      // Create new file
      repairFile = {
        runId: this.runId,
        createdAt: repairedAt,
        updatedAt: repairedAt,
        repairs: [],
      }

      // Ensure directory exists
      await mkdir(this.repairsDir, { recursive: true })

      this.logger?.log({
        event: 'autoqa.repair.save.new_file',
        runId: this.runId,
        repairsFilePath,
      })
    }

    // Create repair record
    const repairRecord: RepairRecord = {
      runId: this.runId,
      specPath,
      stepIndex,
      stepText,
      timestamp,
      chosenLocator,
      repairedAt,
      userConfirmed: true, // Always true when coming from saveRepair
    }

    // Check if repair for this step already exists
    const existingIndex = repairFile.repairs.findIndex(
      (r) => r.specPath === specPath && r.stepIndex === stepIndex,
    )

    if (existingIndex >= 0) {
      // Update existing repair
      repairFile.repairs[existingIndex] = repairRecord

      this.logger?.log({
        event: 'autoqa.repair.save.updated',
        runId: this.runId,
        specPath,
        stepIndex,
      })
    } else {
      // Append new repair
      repairFile.repairs.push(repairRecord)

      this.logger?.log({
        event: 'autoqa.repair.save.appended',
        runId: this.runId,
        specPath,
        stepIndex,
        totalRepairs: repairFile.repairs.length,
      })
    }

    // Atomic write: write to temp file, then rename
    const tempFilePath = `${repairsFilePath}.tmp.${Date.now()}`

    try {
      await writeFile(tempFilePath, JSON.stringify(repairFile, null, 2), 'utf-8')
      await rename(tempFilePath, repairsFilePath)

      this.logger?.log({
        event: 'autoqa.repair.save.success',
        runId: this.runId,
        specPath,
        stepIndex,
      })
    } catch (err) {
      this.logger?.log({
        event: 'autoqa.repair.save.failed',
        runId: this.runId,
        specPath,
        stepIndex,
        error: err instanceof Error ? err.message : String(err),
      })

      // Clean up temp file on failure
      try {
        await unlink(tempFilePath)
      } catch {
        // Ignore cleanup errors
      }

      throw err
    }
  }

  /**
   * Load all repair records, optionally filtered by specPath.
   *
   * @param specPath - Optional spec path to filter repairs
   * @returns Array of repair records (empty if file doesn't exist or is invalid)
   */
  async loadRepairs(specPath?: string): Promise<RepairRecord[]> {
    const repairsFilePath = this.getRepairsFilePath()

    if (!existsSync(repairsFilePath)) {
      this.logger?.log({
        event: 'autoqa.repair.load.not_found',
        runId: this.runId,
      })
      return []
    }

    try {
      const content = await readFile(repairsFilePath, 'utf-8')
      const repairFile = JSON.parse(content) as RepairFile

      this.logger?.log({
        event: 'autoqa.repair.load.success',
        runId: this.runId,
        totalRepairs: repairFile.repairs.length,
        specPath: specPath ?? 'all',
      })

      // Filter by specPath if provided
      if (specPath) {
        return repairFile.repairs.filter((r) => r.specPath === specPath)
      }

      return repairFile.repairs
    } catch (err) {
      this.logger?.log({
        event: 'autoqa.repair.load.failed',
        runId: this.runId,
        error: err instanceof Error ? err.message : String(err),
      })

      // Return empty array on error
      return []
    }
  }

  /**
   * Get a specific repair record by specPath and stepIndex.
   *
   * @param specPath - Path to the spec file
   * @param stepIndex - Step index
   * @returns The repair record or null if not found
   */
  async getRepair(
    specPath: string,
    stepIndex: number,
  ): Promise<RepairRecord | null> {
    const repairs = await this.loadRepairs(specPath)

    const repair = repairs.find((r) => r.stepIndex === stepIndex) ?? null

    this.logger?.log({
      event: 'autoqa.repair.get',
      runId: this.runId,
      specPath,
      stepIndex,
      found: repair !== null,
    })

    return repair
  }
}
