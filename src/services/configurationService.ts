/**
 * ConfigurationService
 * 
 * Service for managing dynamic worker configuration via KV storage
 * 
 * This file now serves as an entry point that re-exports the refactored functionality
 * from the configuration directory. This maintains backward compatibility.
 */

// Export everything from the configuration module
export * from './configuration';

// Export default instance
import configurationService from './configuration';
export default configurationService;