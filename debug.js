// Debug script for testing duration parsing and limits

function parseTimeString(timeStr) {
  if (!timeStr) return null;

  // Match a number followed by 's' or 'm'
  const match = timeStr.match(/^(\d+(?:\.\d+)?)([sm])$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = match[2];

  // Convert to seconds
  if (unit === 'm') {
    return value * 60;
  }
  return value;
}

// Duration validation that only checks format
function isValidDuration(durationStr) {
  if (!durationStr) return true;
  
  const seconds = parseTimeString(durationStr);
  if (seconds === null) return false;
  
  // Only validate that it's a positive value
  return seconds > 0;
}

// Test validation
console.log("'5s' is valid:", isValidDuration('5s'));
console.log("'5m' is valid:", isValidDuration('5m'));
console.log("'0.5s' is valid:", isValidDuration('0.5s'));
console.log("'0.5m' is valid:", isValidDuration('0.5m'));
console.log("'10m' is valid:", isValidDuration('10m'));
console.log("'invalid' is valid:", isValidDuration('invalid'));
console.log("'0s' is valid:", isValidDuration('0s')); // This should be invalid