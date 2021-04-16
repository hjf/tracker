module.exports = {
  ignorePatterns: ['node_modules/*', '.vscode/*', 'static/*', 'tle/*'],
  env: {
    node: true,
    commonjs: true,
    es2021: true
  },
  extends: 'standard',
  parserOptions: {
    ecmaVersion: 12
  },
  rules: {

  }
}
