const fs = require('node:fs');
const path = require('node:path');

const source = path.join(__dirname, '..', '..', 'dsh-pet', 'assets');
const destination = path.join(__dirname, '..', 'assets');
const raw = fs.readFileSync(path.join(source, 'config.jsonc'), 'utf8');
const config = JSON.parse(raw.replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
  (token) => token.startsWith('"') ? token : ''));
const { events, ...animations } = config.animations;
const names = new Set([
  ...animations.idle, ...animations.turn, ...animations.drag, ...animations.clicks,
  ...animations.moves.actions.map((action) => action.name),
  ...animations.categories.flatMap((category) => category.actions),
]);
fs.mkdirSync(destination, { recursive: true });
for (const name of names) {
  fs.copyFileSync(path.join(source, 'webm', `${name}.webm`), path.join(destination, `${name}.webm`));
}
fs.copyFileSync(path.join(source, 'pic', 'notify-test.png'), path.join(destination, 'tray.png'));
fs.copyFileSync(path.join(source, '..', '..', 'LICENSE'), path.join(destination, 'UPSTREAM-LICENSE.txt'));
fs.writeFileSync(path.join(destination, 'animations.json'),
  JSON.stringify({ animations, animationWeights: config.animationWeights }, null, 2) + '\n');
console.log(`Imported ${names.size} existing WebM animations and existing tray PNG; excluded DSH events.`);
