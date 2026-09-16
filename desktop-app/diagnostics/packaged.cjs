const { spawnSync } = require('node:child_process');
const path = require('node:path');

const result = spawnSync(process.execPath, [path.join(__dirname, 'portable.cjs'), path.resolve(process.argv[2])], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
