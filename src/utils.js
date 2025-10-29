const { execa } = require('execa');

async function isCommandAvailable(command) {
  try {
    // Using a harmless version command to check for presence
    const checkCommand = command === 'java' ? '-version' : '--version';
    await execa(command, [checkCommand]);
    return true;
  } catch {
    return false;
  }
}

module.exports = { isCommandAvailable };