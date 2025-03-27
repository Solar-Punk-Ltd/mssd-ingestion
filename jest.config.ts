import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest', // Use the ESM preset for ts-jest
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': 'ts-jest', // No need for ESM-specific options
  },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
}

export default config
