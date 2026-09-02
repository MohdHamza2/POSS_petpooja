const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    if (fs.statSync(dirPath).isDirectory()) {
      walkDir(dirPath, callback);
    } else if (dirPath.endsWith('.ts')) {
      callback(dirPath);
    }
  });
}

const targetStr = ".catch(() => {})";
const replacementStr = ".catch(err => console.error('Background task error:', err?.message || err))";

let count = 0;
walkDir('apps/api/src', (filePath) => {
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(targetStr)) {
    const updated = content.split(targetStr).join(replacementStr);
    fs.writeFileSync(filePath, updated);
    count++;
  }
});

console.log(`Replaced silent catches in ${count} files.`);
