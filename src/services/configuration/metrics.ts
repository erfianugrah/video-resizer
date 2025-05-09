/**
 * Performance metrics for the configuration service
 */

// Global metrics for shared access between service instances
let globalMetrics = {
  // Initialization metrics
  initDurationMs: 0,
  lastInitTimestamp: 0,
  isInitialized: false,
  
  // KV operation metrics
  kvFetchCount: 0,
  kvFetchSuccessCount: 0,
  kvFetchFailCount: 0,
  kvStoreCount: 0,
  kvStoreSuccessCount: 0,
  kvStoreFailCount: 0,
  kvLastFetchTimestamp: 0,
  kvLastFetchDurationMs: 0,
  kvLatestFetchSize: 0,
  
  // Cache metrics
  cacheHits: 0,
  cacheMisses: 0,
  cacheLastHitTimestamp: 0,
  
  // Update metrics
  lastConfigUpdateTimestamp: 0,
  configDistributionCount: 0,
  
  // Error metrics
  validationErrorCount: 0,
  kvErrorCount: 0,
  distributionErrorCount: 0,
  
  // Performance metrics
  avgFetchDurationMs: 0,
  maxFetchDurationMs: 0,
};

/**
 * Creates a new metrics object with initial values
 */
export function createMetrics() {
  return {
    // Initialization metrics
    initDurationMs: 0,
    lastInitTimestamp: 0,
    isInitialized: false,
    
    // KV operation metrics
    kvFetchCount: 0,
    kvFetchSuccessCount: 0,
    kvFetchFailCount: 0,
    kvStoreCount: 0,
    kvStoreSuccessCount: 0,
    kvStoreFailCount: 0,
    kvLastFetchTimestamp: 0,
    kvLastFetchDurationMs: 0,
    kvLatestFetchSize: 0,
    
    // Cache metrics
    cacheHits: 0,
    cacheMisses: 0,
    cacheLastHitTimestamp: 0,
    
    // Update metrics
    lastConfigUpdateTimestamp: 0,
    configDistributionCount: 0,
    
    // Error metrics
    validationErrorCount: 0,
    kvErrorCount: 0,
    distributionErrorCount: 0,
    
    // Performance metrics
    avgFetchDurationMs: 0,
    maxFetchDurationMs: 0,
  };
}

/**
 * Returns a copy of the global metrics
 */
export function getGlobalMetrics() {
  return {...globalMetrics};
}

/**
 * Updates the global metrics
 */
export function updateGlobalMetrics(metrics: typeof globalMetrics) {
  globalMetrics = {...metrics};
}

/**
 * Returns formatted metrics for reporting
 */
export function getFormattedMetrics(metrics: Record<string, number | string | boolean>): Record<string, number | string> {
  const result: Record<string, number | string> = {};
  
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === 'number') {
      // Round numeric values to 2 decimal places for readability
      result[key] = Math.round(value * 100) / 100;
    } else if (typeof value === 'boolean') {
      // Convert booleans to 0/1 for metrics
      result[key] = value ? 1 : 0;
    } else {
      // Pass string values unchanged
      result[key] = value;
    }
  }
  
  // Add timestamp for when metrics were generated
  result.metricsTimestamp = Date.now();
  
  return result;
}