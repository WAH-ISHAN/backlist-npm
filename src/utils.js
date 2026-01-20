const { execa } = require('execa');

const VERSION_ARGS = {
  java: ['-version'],
  python: ['--version'],
  python3: ['--version'],
  node: ['--version'],
  npm: ['--version'],
  dotnet: ['--version'],
  mvn: ['-v'],
  git: ['--version'],
};

async function isCommandAvailable(command) {
  const args = VERSION_ARGS[command] || ['--version'];

  try {
    // Reject false only if spawn fails (ENOENT). Non-zero exit still counts as "available".
    await execa(command, args, { reject: false });
    return true;
  } catch (err) {
    // If command not found, execa throws with code 'ENOENT'
    if (err && err.code === 'ENOENT') return false;
    // Other unexpected errors: treat as not available
    return false;
  }
}

module.exports = { isCommandAvailable };