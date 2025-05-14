// This is a direct test file that you can run with Node.js
// It allows us to test the streamUtils functionality directly

const fs = require('fs');
const path = require('path');

// Print information about the test
console.log('Testing streamUtils functionality');
console.log('= = = = = = = = = = = = = = = = = =');
console.log('');

// Create a test file path
const streamUtilsPath = path.join(__dirname, '..', 'src', 'utils', 'streamUtils.ts');

// Read the file
console.log(`Reading file: ${streamUtilsPath}`);
const fileContent = fs.readFileSync(streamUtilsPath, 'utf8');

// Print the file structure
console.log('\nFile structure:');
const lines = fileContent.split('\n');
const exportLines = lines.filter(line => line.includes('export'));
console.log(exportLines.join('\n'));

// Display function signatures
console.log('\nFunction signatures:');
const functionSignatures = lines.filter(line => 
  (line.includes('export async function') || line.includes('export function')) && 
  !line.includes('* @')
);
console.log(functionSignatures.join('\n'));

// Check for any issues
console.log('\nPotential issues:');
const duplicatedVars = [];
let contextVars = [];

lines.forEach((line, index) => {
  // Check for duplicate context variable declarations
  const contextMatch = line.match(/const\s+(context|currentContext)\s*=/);
  if (contextMatch) {
    contextVars.push({
      line: index + 1,
      name: contextMatch[1],
      content: line.trim()
    });
  }
});

if (contextVars.length > 1) {
  console.log('Possible duplicate context declarations:');
  contextVars.forEach(ctx => {
    console.log(`Line ${ctx.line}: ${ctx.content}`);
  });
} else {
  console.log('No duplicate context variables found.');
}

// Test completed
console.log('\nTest completed.');