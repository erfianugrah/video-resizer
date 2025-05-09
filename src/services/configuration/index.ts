/**
 * Configuration Service
 * Re-exports all functionality to maintain backward compatibility
 */

// Export schemas and types
export { WorkerConfigurationSchema } from './schemas';
export type { WorkerConfiguration, ConfigEnvironment } from './schemas';

// Export accessor functions
export {
  getVideoConfig,
  getCacheConfig,
  getLoggingConfig,
  getDebugConfig
} from './accessors';

// Export validation functions
export {
  validateConfig,
  isConfigValid,
  convertJsonToConfig
} from './validation';

// Export service and metrics
export {
  ConfigurationService,
  getConfigurationMetrics
} from './service';

// Export default instance
import { ConfigurationService } from './service';
export default ConfigurationService.getInstance();