#!/bin/bash

# Script to help migrate logging imports to the centralized logger

echo "Finding all files using scattered logging helpers..."

# Find all files importing from logging helper files
echo -e "\n=== Files importing from videoStorage/logging.ts ==="
grep -r "from.*videoStorage/logging" src/ --include="*.ts" --include="*.tsx" | grep -v "src/services/videoStorage/logging.ts"

echo -e "\n=== Files importing from errorHandler/logging.ts ==="
grep -r "from.*errorHandler/logging" src/ --include="*.ts" --include="*.tsx" | grep -v "src/services/errorHandler/logging.ts"

echo -e "\n=== Files importing from kvStorage/logging.ts ==="
grep -r "from.*kvStorage/logging" src/ --include="*.ts" --include="*.tsx" | grep -v "src/services/kvStorage/logging.ts"

echo -e "\n=== Files with inline logDebug functions ==="
grep -r "function logDebug\|const logDebug" src/ --include="*.ts" --include="*.tsx" | grep -v "src/utils/logger.ts" | grep -v "logging.ts"

echo -e "\n=== Files with inline logError functions ==="
grep -r "function logError\|const logError" src/ --include="*.ts" --include="*.tsx" | grep -v "src/utils/logger.ts" | grep -v "logging.ts"

echo -e "\n=== Files with inline logInfo functions ==="
grep -r "function logInfo\|const logInfo" src/ --include="*.ts" --include="*.tsx" | grep -v "src/utils/logger.ts" | grep -v "logging.ts"

echo -e "\n=== Direct console usage (should be reviewed) ==="
grep -r "console\.\(log\|debug\|info\|warn\|error\)" src/ --include="*.ts" --include="*.tsx" | head -20

echo -e "\nTo migrate a file, replace:"
echo "  import { logDebug } from '../path/to/logging';"
echo "with:"
echo "  import { logDebug } from '@/utils/logger';"
echo ""
echo "Or for category-specific logging:"
echo "  import { createCategoryLogger } from '@/utils/logger';"
echo "  const logger = createCategoryLogger('CategoryName');"
echo "  const { debug: logDebug, info: logInfo } = logger;"