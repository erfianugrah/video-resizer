/**
 * @deprecated This module has been merged into the unified videoHandler.ts.
 * This file re-exports handleVideoRequest as handleVideoRequestWithOrigins
 * for backward compatibility with any remaining references.
 */

import { handleVideoRequest } from './videoHandler';

/**
 * @deprecated Use handleVideoRequest from './videoHandler' instead.
 */
export const handleVideoRequestWithOrigins = handleVideoRequest;
