// Jest runs the Whereabouts behaviour tests (see __tests__/whereabouts/SPEC.md).
// The android preset makes Platform.OS === 'android' — the platform these
// tests exist for. Helpers live next to the tests but aren't tests themselves.
//
// This app has no babel.config.js (Metro applies babel-preset-expo implicitly),
// so babel-jest is handed the preset here rather than adding a project-wide
// babel config that would also change what Metro builds.
const preset = require('jest-expo/android/jest-preset')

const transform = { ...preset.transform }
transform['\\.[jt]sx?$'] = [
  'babel-jest',
  { caller: { name: 'metro', bundler: 'metro', platform: 'android' }, presets: ['babel-preset-expo'] },
]

module.exports = {
  preset: 'jest-expo/android',
  transform,
  testTimeout: 30_000,
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  moduleNameMapper: {
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/__tests__/whereabouts/helpers/setup.ts'],
}
