/** Two projects: pure unit tests (no I/O) and DB-backed suites that run serially. */
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/helpers/setup-env.ts'],
};

module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/tests/unit/**/*.test.ts'] },
    {
      ...base,
      displayName: 'db',
      testMatch: [
        '<rootDir>/tests/integration/**/*.test.ts',
        '<rootDir>/tests/e2e/**/*.test.ts',
        '<rootDir>/tests/concurrency/**/*.test.ts',
      ],
      globalSetup: '<rootDir>/tests/helpers/global-setup.ts',
      maxWorkers: 1,
    },
  ],
  testTimeout: 30000,
};
