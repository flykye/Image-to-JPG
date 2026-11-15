module.exports = {
  testMatch: ['<rootDir>/__tests__/**/*.test.js'],
  modulePathIgnorePatterns: ['<rootDir>/resources/', '<rootDir>/build/', '<rootDir>/dist/', '<rootDir>/.mygo/'],
  collectCoverageFrom: ['src/core/**/*.js', 'src/desktop/**/*.js']
};
