/**
 * End-to-end tests for plan generation workflow
 * Tests the complete flow: exploration -> test plan generation -> execution
 */
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const execFileAsync = promisify(execFile)

describe('Plan Generation E2E', () => {
  const tmpDir = join(tmpdir(), `autoqa-e2e-${randomUUID()}`)
  let server: any = null
  const serverUrl = 'http://localhost:8989'

  beforeAll(async () => {
    // Create temporary directory
    await execFileAsync('mkdir', ['-p', tmpDir])

    // Start demo app server
    const demoAppPath = resolve(__dirname, '../../fixtures/demo-app.html')
    const http = await import('http')
    const fs = await import('fs')

    server = http.createServer((req: any, res: any) => {
      const stream = fs.createReadStream(demoAppPath)
      res.writeHead(200, { 'Content-Type': 'text/html' })
      stream.pipe(res)
    })

    await new Promise<void>((resolve) => {
      server.listen(8989, 'localhost', () => resolve())
    })
  })

  afterAll(async () => {
    // Clean up
    if (server) {
      server.close()
    }
    await execFileAsync('rm', ['-rf', tmpDir])
  })

  it('should run complete exploration and generate test cases', async () => {
    const runId = randomUUID()

    // Run exploration
    const exploreCmd = join(process.cwd(), 'bin', 'autoqa.js')
    const exploreArgs = [
      'plan',
      'explore',
      '-u', serverUrl,
      '-d', '2',
      '--max-pages', '5',
    ]

    const { stdout: exploreOut, stderr: exploreErr } = await execFileAsync(
      process.execPath,
      [exploreCmd, ...exploreArgs],
      {
        cwd: tmpDir,
        env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
      }
    )

    expect(exploreErr).toBe('')
    expect(exploreOut).toContain('Exploration completed')
    expect(exploreOut).toContain('Pages visited')

    // Verify exploration artifacts exist
    const exploreDir = join(tmpDir, '.autoqa', 'runs', runId, 'plan-explore')
    await expect(access(exploreDir)).resolves.not.toThrow()

    const exploreFiles = await readdir(exploreDir)
    expect(exploreFiles).toContain('explore-graph.json')
    expect(exploreFiles).toContain('explore-elements.json')

    // Run test plan generation
    const generateArgs = [
      'plan',
      'generate',
      '--run-id', runId,
      '-u', serverUrl,
      '--test-types', 'functional,form,security',
    ]

    const { stdout: genOut, stderr: genErr } = await execFileAsync(
      process.execPath,
      [exploreCmd, ...generateArgs],
      {
        cwd: tmpDir,
        env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
      }
    )

    expect(genErr).toBe('')
    expect(genOut).toContain('Test plan generated')
    expect(genOut).toContain('Test cases created')

    // Verify test plan artifacts exist
    const planDir = join(tmpDir, '.autoqa', 'runs', runId, 'plan')
    await expect(access(planDir)).resolves.not.toThrow()

    const planFiles = await readdir(planDir)
    expect(planFiles).toContain('test-plan.json')

    // Verify test plan JSON structure
    const testPlanPath = join(planDir, 'test-plan.json')
    const testPlanContent = await readFile(testPlanPath, 'utf-8')
    const testPlan = JSON.parse(testPlanContent)

    expect(testPlan).toHaveProperty('cases')
    expect(testPlan.cases).toBeInstanceOf(Array)
    expect(testPlan.cases.length).toBeGreaterThan(0)

    // Verify generated specs exist
    const specsDir = join(planDir, 'specs')
    const specFiles = await readdir(specsDir)
    expect(specFiles.length).toBeGreaterThan(0)

    // Verify spec file content
    for (const specFile of specFiles) {
      const specPath = join(specsDir, specFile)
      const specContent = await readFile(specPath, 'utf-8')

      // Check AutoQA structure
      expect(specContent).toContain('# ')
      expect(specContent).toContain('## Preconditions')
      expect(specContent).toContain('## Steps')

      // Check for placeholders instead of sensitive data
      if (specFile.includes('login')) {
        expect(specContent).toContain('{{')
      }
    }

    // Verify test case types are valid
    const validTypes = ['functional', 'form', 'navigation', 'responsive', 'boundary', 'security']
    testPlan.cases.forEach((testCase: any) => {
      expect(validTypes).toContain(testCase.type)
      expect(['p0', 'p1', 'p2']).toContain(testCase.priority)
    })
  })

  it('should run combined plan command (explore + generate)', async () => {
    const runId = randomUUID()

    // Run combined plan command
    const cmd = join(process.cwd(), 'bin', 'autoqa.js')
    const args = [
      'plan',
      'run',
      '-u', serverUrl,
      '-d', '2',
      '--max-pages', '5',
      '--test-types', 'functional,form',
      '--headless',
    ]

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cmd, ...args],
      {
        cwd: tmpDir,
        env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
      }
    )

    expect(stderr).toBe('')
    expect(stdout).toContain('Plan command completed successfully!')
    expect(stdout).toContain('Exploration completed')
    expect(stdout).toContain('Test plan generated')

    // Verify all artifacts exist
    const baseDir = join(tmpDir, '.autoqa', 'runs', runId)
    const exploreDir = join(baseDir, 'plan-explore')
    const planDir = join(baseDir, 'plan')

    await expect(access(exploreDir)).resolves.not.toThrow()
    await expect(access(planDir)).resolves.not.toThrow()

    const planFiles = await readdir(planDir)
    expect(planFiles).toContain('test-plan.json')
    expect(planFiles).toContain('specs')

    // Verify test plan contains functional and form tests
    const testPlanPath = join(planDir, 'test-plan.json')
    const testPlanContent = await readFile(testPlanPath, 'utf-8')
    const testPlan = JSON.parse(testPlanContent)

    const hasFunctional = testPlan.cases.some((c: any) => c.type === 'functional')
    const hasForm = testPlan.cases.some((c: any) => c.type === 'form')

    expect(hasFunctional).toBe(true)
    expect(hasForm).toBe(true)
  })

  it('should generate appropriate test cases for different page patterns', async () => {
    const runId = randomUUID()

    // Run exploration with deeper depth to capture all patterns
    const cmd = join(process.cwd(), 'bin', 'autoqa.js')
    const args = [
      'plan',
      'run',
      '-u', serverUrl,
      '-d', '3',
      '--max-pages', '10',
      '--test-types', 'functional,form,navigation,security',
      '--headless',
    ]

    const { stdout } = await execFileAsync(
      process.execPath,
      [cmd, ...args],
      {
        cwd: tmpDir,
        env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
      }
    )

    expect(stdout).toContain('Plan command completed successfully!')

    // Read and analyze generated test cases
    const testPlanPath = join(tmpDir, '.autoqa', 'runs', runId, 'plan', 'test-plan.json')
    const testPlanContent = await readFile(testPlanPath, 'utf-8')
    const testPlan = JSON.parse(testPlanContent)

    // Should have tests for different patterns
    const testTypes = new Set(testPlan.cases.map((c: any) => c.type))
    expect(testTypes.size).toBeGreaterThan(1)

    // Verify business patterns are detected
    const specFiles = await readdir(join(tmpDir, '.autoqa', 'runs', runId, 'plan', 'specs'))
    const specContents = await Promise.all(
      specFiles.map(file => readFile(join(tmpDir, '.autoqa', 'runs', runId, 'plan', 'specs', file), 'utf-8'))
    )

    // Check for search-related tests
    const hasSearchTest = specContents.some(content =>
      content.toLowerCase().includes('search') ||
      content.toLowerCase().includes('query')
    )
    expect(hasSearchTest).toBe(true)

    // Check for login-related tests
    const hasLoginTest = specContents.some(content =>
      content.toLowerCase().includes('login') ||
      content.toLowerCase().includes('authentication')
    )
    expect(hasLoginTest).toBe(true)

    // Check for registration-related tests
    const hasRegisterTest = specContents.some(content =>
      content.toLowerCase().includes('register') ||
      content.toLowerCase().includes('signup')
    )
    expect(hasRegisterTest).toBe(true)

    // Check for security tests (e.g., XSS)
    const hasSecurityTest = specContents.some(content =>
      content.toLowerCase().includes('xss') ||
      content.toLowerCase().includes('script') ||
      content.toLowerCase().includes('injection')
    )
    expect(hasSecurityTest).toBe(true)
  })
})