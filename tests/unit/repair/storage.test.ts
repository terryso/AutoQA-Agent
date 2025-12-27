/**
 * Unit tests for RepairStorage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { RepairStorage } from '../../../src/repair/storage.js'
import type { LocatorCandidate } from '../../../src/ir/types.js'
import type { RepairRecord, RepairFile } from '../../../src/repair/types.js'

// Mock fs operations
vi.mock('node:fs/promises')
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))

const mockMkdir = mkdir as unknown as ReturnType<typeof vi.fn>
const mockWriteFile = writeFile as unknown as ReturnType<typeof vi.fn>
const mockReadFile = readFile as unknown as ReturnType<typeof vi.fn>
const mockRename = rename as unknown as ReturnType<typeof vi.fn>
const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>

describe('repair/storage', () => {
  const testCwd = '/test/project'
  const testRunId = 'test-run-123'
  const testSpecPath = 'specs/login.spec.md'

  let storage: RepairStorage
  let mockLocator: LocatorCandidate

  beforeEach(() => {
    vi.clearAllMocks()

    storage = new RepairStorage(testCwd, testRunId)

    mockLocator = {
      kind: 'cssId',
      value: 'submit-btn',
      code: "page.locator('#submit-btn')",
      validation: {
        unique: true,
        visible: true,
        enabled: true,
      },
    }
  })

  describe('constructor', () => {
    it('should initialize with cwd and runId', () => {
      expect(storage).toBeDefined()
    })
  })

  describe('getRepairsFilePath', () => {
    it('should return correct repairs file path', () => {
      const expectedPath = join(testCwd, '.autoqa', 'runs', testRunId, 'repairs.json')
      // Access private method via reflection for testing
      const filePath = (storage as any).getRepairsFilePath()
      expect(filePath).toBe(expectedPath)
    })
  })

  describe('saveRepair', () => {
    it('should create new repairs file when none exists', async () => {
      mockExistsSync.mockReturnValue(false)
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFile.mockResolvedValue(undefined)
      mockRename.mockResolvedValue(undefined)

      await storage.saveRepair(
        testSpecPath,
        3,
        'Click login button',
        mockLocator,
      )

      const repairsFilePath = join(testCwd, '.autoqa', 'runs', testRunId, 'repairs.json')

      // Verify mkdir was called
      expect(mockMkdir).toHaveBeenCalledWith(
        join(testCwd, '.autoqa', 'runs', testRunId),
        { recursive: true },
      )

      // Verify writeFile was called with temp file
      expect(mockWriteFile).toHaveBeenCalledTimes(1)
      const tempFilePath = mockWriteFile.mock.calls[0][0] as string
      expect(tempFilePath).toContain('.tmp')

      // Verify rename was called
      expect(mockRename).toHaveBeenCalledTimes(1)
      expect(mockRename).toHaveBeenCalledWith(tempFilePath, repairsFilePath)

      // Verify written content structure
      const writtenContent = JSON.parse(mockWriteFile.mock.calls[0][1] as string)

      expect(writtenContent.runId).toBe(testRunId)
      expect(writtenContent.repairs).toHaveLength(1)
      expect(writtenContent.repairs[0].specPath).toBe(testSpecPath)
      expect(writtenContent.repairs[0].stepIndex).toBe(3)
      expect(writtenContent.repairs[0].chosenLocator).toEqual(mockLocator)
    })

    it('should append to existing repairs file', async () => {
      const existingRepairs: RepairRecord[] = [
        {
          runId: testRunId,
          specPath: testSpecPath,
          stepIndex: 1,
          stepText: 'Fill username',
          timestamp: Date.now() - 1000,
          chosenLocator: mockLocator,
          repairedAt: new Date(Date.now() - 1000).toISOString(),
          userConfirmed: true,
        },
      ]

      const existingFile: RepairFile = {
        runId: testRunId,
        createdAt: new Date(Date.now() - 2000).toISOString(),
        updatedAt: new Date(Date.now() - 1000).toISOString(),
        repairs: existingRepairs,
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue(JSON.stringify(existingFile))
      mockWriteFile.mockResolvedValue(undefined)
      mockRename.mockResolvedValue(undefined)

      await storage.saveRepair(
        testSpecPath,
        3,
        'Click login button',
        mockLocator,
      )

      // Verify read was called
      expect(mockReadFile).toHaveBeenCalled()

      // Verify write includes both repairs
      const writtenContent = JSON.parse(mockWriteFile.mock.calls[0][1] as string)

      expect(writtenContent.repairs).toHaveLength(2)
      expect(writtenContent.repairs[0].stepIndex).toBe(1)
      expect(writtenContent.repairs[1].stepIndex).toBe(3)
    })

    it('should update updatedAt timestamp on save', async () => {
      const existingFile: RepairFile = {
        runId: testRunId,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T01:00:00Z',
        repairs: [],
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue(JSON.stringify(existingFile))
      mockWriteFile.mockResolvedValue(undefined)
      mockRename.mockResolvedValue(undefined)

      const beforeSave = new Date().toISOString()

      await storage.saveRepair(
        testSpecPath,
        3,
        'Click login button',
        mockLocator,
      )

      const writtenContent = JSON.parse(mockWriteFile.mock.calls[0][1] as string)

      expect(writtenContent.updatedAt).not.toBe('2025-01-01T01:00:00Z')
      expect(new Date(writtenContent.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeSave).getTime(),
      )
    })

    it('should handle invalid existing file gracefully', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue('invalid json')
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFile.mockResolvedValue(undefined)
      mockRename.mockResolvedValue(undefined)

      // Should not throw, should create new file
      await expect(
        storage.saveRepair(
          testSpecPath,
          3,
          'Click login button',
          mockLocator,
        ),
      ).resolves.toBeUndefined()

      // Should create new file with single repair
      const writeCall = mockWriteFile.mock.calls[0]
      const writtenContent = JSON.parse(writeCall[1] as string)
      expect(writtenContent.repairs).toHaveLength(1)
    })
  })

  describe('loadRepairs', () => {
    it('should return empty array when file does not exist', async () => {
      mockExistsSync.mockReturnValue(false)

      const repairs = await storage.loadRepairs()

      expect(repairs).toEqual([])
      expect(mockReadFile).not.toHaveBeenCalled()
    })

    it('should load all repairs when specPath is not provided', async () => {
      const testRepairs: RepairRecord[] = [
        {
          runId: testRunId,
          specPath: 'specs/test1.spec.md',
          stepIndex: 1,
          stepText: 'Step 1',
          timestamp: Date.now(),
          chosenLocator: mockLocator,
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
        {
          runId: testRunId,
          specPath: 'specs/test2.spec.md',
          stepIndex: 2,
          stepText: 'Step 2',
          timestamp: Date.now(),
          chosenLocator: mockLocator,
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
      ]

      const repairFile: RepairFile = {
        runId: testRunId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        repairs: testRepairs,
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue(JSON.stringify(repairFile))

      const repairs = await storage.loadRepairs()

      expect(repairs).toHaveLength(2)
      expect(repairs[0].specPath).toBe('specs/test1.spec.md')
      expect(repairs[1].specPath).toBe('specs/test2.spec.md')
    })

    it('should filter repairs by specPath when provided', async () => {
      const testRepairs: RepairRecord[] = [
        {
          runId: testRunId,
          specPath: 'specs/login.spec.md',
          stepIndex: 1,
          stepText: 'Login step',
          timestamp: Date.now(),
          chosenLocator: mockLocator,
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
        {
          runId: testRunId,
          specPath: 'specs/other.spec.md',
          stepIndex: 2,
          stepText: 'Other step',
          timestamp: Date.now(),
          chosenLocator: mockLocator,
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
      ]

      const repairFile: RepairFile = {
        runId: testRunId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        repairs: testRepairs,
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue(JSON.stringify(repairFile))

      const repairs = await storage.loadRepairs('specs/login.spec.md')

      expect(repairs).toHaveLength(1)
      expect(repairs[0].specPath).toBe('specs/login.spec.md')
    })

    it('should return empty array for invalid file content', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue('invalid json')

      const repairs = await storage.loadRepairs()

      expect(repairs).toEqual([])
    })
  })

  describe('getRepair', () => {
    it('should return null when file does not exist', async () => {
      mockExistsSync.mockReturnValue(false)

      const repair = await storage.getRepair(testSpecPath, 3)

      expect(repair).toBeNull()
    })

    it('should return null when repair not found for step', async () => {
      const testRepairs: RepairRecord[] = [
        {
          runId: testRunId,
          specPath: testSpecPath,
          stepIndex: 1,
          stepText: 'Step 1',
          timestamp: Date.now(),
          chosenLocator: mockLocator,
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
      ]

      const repairFile: RepairFile = {
        runId: testRunId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        repairs: testRepairs,
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue(JSON.stringify(repairFile))

      const repair = await storage.getRepair(testSpecPath, 3)

      expect(repair).toBeNull()
    })

    it('should return matching repair record', async () => {
      const testRepairs: RepairRecord[] = [
        {
          runId: testRunId,
          specPath: testSpecPath,
          stepIndex: 3,
          stepText: 'Click login button',
          timestamp: Date.now(),
          chosenLocator: mockLocator,
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
      ]

      const repairFile: RepairFile = {
        runId: testRunId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        repairs: testRepairs,
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue(JSON.stringify(repairFile))

      const repair = await storage.getRepair(testSpecPath, 3)

      expect(repair).not.toBeNull()
      expect(repair?.stepIndex).toBe(3)
      expect(repair?.chosenLocator).toEqual(mockLocator)
    })

    it('should match by specPath and stepIndex', async () => {
      const testRepairs: RepairRecord[] = [
        {
          runId: testRunId,
          specPath: 'specs/other.spec.md',
          stepIndex: 3,
          stepText: 'Other spec step 3',
          timestamp: Date.now(),
          chosenLocator: mockLocator,
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
        {
          runId: testRunId,
          specPath: testSpecPath,
          stepIndex: 3,
          stepText: 'Login spec step 3',
          timestamp: Date.now(),
          chosenLocator: {
            kind: 'getByRole',
            value: 'button',
            code: "page.getByRole('button')",
            validation: { unique: true },
          },
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
      ]

      const repairFile: RepairFile = {
        runId: testRunId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        repairs: testRepairs,
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue(JSON.stringify(repairFile))

      const repair = await storage.getRepair(testSpecPath, 3)

      expect(repair).not.toBeNull()
      expect(repair?.specPath).toBe(testSpecPath)
      expect(repair?.stepIndex).toBe(3)
      expect(repair?.chosenLocator.kind).toBe('getByRole')
    })
  })

  describe('atomic write', () => {
    it('should use temporary file for atomic write', async () => {
      mockExistsSync.mockReturnValue(false)
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFile.mockResolvedValue(undefined)
      mockRename.mockResolvedValue(undefined)

      await storage.saveRepair(
        testSpecPath,
        1,
        'Test step',
        mockLocator,
      )

      // Should write to temp file first
      const tempFileCall = mockWriteFile.mock.calls.find((call) =>
        (call[0] as string)?.includes('.tmp'),
      )
      expect(tempFileCall).toBeDefined()
    })
  })
})
