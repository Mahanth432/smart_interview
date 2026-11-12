import { spawnSync } from 'node:child_process'

const SUITES = [
  'scripts/test-failover-classification.ts',
  'scripts/test-failover-hardening.ts',
  'scripts/test-p0-security-and-core.ts',
  'scripts/test-p1-kb-rag-lifecycle.ts',
  'scripts/test-p2-memory-and-reports.ts',
  'scripts/test-p4-rag-validation-and-db.ts',
]

for (const suite of SUITES) {
  console.log(`\n=== Running ${suite} ===`)
  const result = spawnSync('npx', ['tsx', '--tsconfig', 'tsconfig.json', suite], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    console.error(`\nTest suite failed: ${suite} (exit ${result.status ?? 'unknown'})`)
    process.exit(result.status || 1)
  }
}

console.log(`\nAll ${SUITES.length} test suites passed.`)
