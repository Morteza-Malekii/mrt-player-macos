// Only invoked by the local test runner. Never included in the app package.
const { app } = require('electron');
if (!process.env.KIYI_TEST_DATA) throw new Error('Isolated test directory required');
app.setPath('userData', process.env.KIYI_TEST_DATA);
require('../dist/main.cjs');
