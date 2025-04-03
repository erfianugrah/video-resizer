# Path Matching System Enhancement Plan

## Current Implementation

The Video Resizer uses a regex-based path matching system to determine how to transform URLs. The current implementation:

1. Defines path patterns in configuration with:
   - Regex patterns for matching URLs
   - Origin URL templates for content sources
   - Transformation parameters and overrides
   - Caching configuration

2. Uses the `findMatchingPathPattern` function in `pathUtils.ts` to:
   - Test each pattern against the URL path
   - Return the first matching pattern
   - Sort patterns by priority

3. The matching happens in multiple places:
   - `videoHandler.ts` checks for path patterns
   - `TransformVideoCommand.ts` performs pattern matching
   - `TransformationService.ts` uses patterns for URL construction

## Issues with Current Approach

While functional, the current implementation has several limitations:

1. **Performance Issues**:
   - Each pattern's regex is compiled repeatedly
   - No caching of compiled patterns
   - Full pattern iteration for each request

2. **Maintainability Challenges**:
   - Complex regex patterns are difficult to understand and modify
   - Pattern testing requires sending actual requests
   - Diagnosing pattern matching issues is complex

3. **Circular Dependencies**:
   - Path utilities are imported in multiple places
   - Creates circular dependency challenges
   - Requires dynamic imports to work around issues

## Enhanced Path Matching Service

We propose creating a dedicated `PathMatchingService` to improve the system:

### 1. Core Service Interface

```typescript
interface PathMatchingService {
  // Find the first matching pattern for a path
  findMatchingPattern(path: string): PathPattern | null;
  
  // Find all matching patterns for a path
  findAllMatchingPatterns(path: string): PathPattern[];
  
  // Extract capture groups from a path using a pattern
  extractCaptureGroups(path: string, pattern: PathPattern): Record<string, string>;
  
  // Test if a specific pattern matches a path
  testPattern(path: string, pattern: PathPattern): boolean;
  
  // Add or update patterns at runtime
  updatePatterns(patterns: PathPattern[]): void;
}
```

### 2. Performance Optimizations

1. **Pattern Caching**:
   ```typescript
   class PatternCache {
     private compiledPatterns: Map<string, RegExp> = new Map();
     
     getCompiledPattern(pattern: string): RegExp {
       if (!this.compiledPatterns.has(pattern)) {
         this.compiledPatterns.set(pattern, new RegExp(pattern));
       }
       return this.compiledPatterns.get(pattern)!;
     }
     
     invalidatePattern(pattern: string): void {
       this.compiledPatterns.delete(pattern);
     }
     
     invalidateAll(): void {
       this.compiledPatterns.clear();
     }
   }
   ```

2. **Pattern Indexing**:
   - Group patterns by path prefixes for faster filtering
   - Sort patterns by specificity and priority
   - Implement early exit when clear match is found

### 3. Validation and Error Reporting

1. **Pattern Validation**:
   ```typescript
   function validatePattern(pattern: PathPattern): ValidationResult {
     try {
       // Test pattern compilation
       new RegExp(pattern.matcher);
       
       // Validate capture groups match expected format
       const declaredGroups = pattern.captureGroups || [];
       const regexGroups = extractNamedGroupsFromRegex(pattern.matcher);
       
       // Check for other constraints
       // ...
       
       return { valid: true };
     } catch (error) {
       return { 
         valid: false, 
         error: error instanceof Error ? error.message : 'Unknown error'
       };
     }
   }
   ```

2. **Comprehensive Logging**:
   - Log pattern loading and compilation
   - Record pattern match attempts with timing
   - Track capture group extraction

### 4. Testing Utilities

1. **Pattern Testing Tool**:
   ```typescript
   class PatternTestingTool {
     testPattern(pattern: string, testCases: string[]): TestResult[] {
       const results: TestResult[] = [];
       try {
         const regex = new RegExp(pattern);
         for (const testCase of testCases) {
           const matches = regex.test(testCase);
           const captures = testCase.match(regex)?.groups || {};
           results.push({ testCase, matches, captures });
         }
       } catch (error) {
         // Handle regex compilation errors
       }
       return results;
     }
     
     generateTestCases(pattern: PathPattern): string[] {
       // Create sample URLs that should match this pattern
       // ...
     }
   }
   ```

2. **Debug Mode**:
   - Add detailed match information in debug headers
   - Create debug views showing all pattern attempts
   - Add timing information for pattern matching

## Implementation Strategy

### Phase 1: Core Service Implementation

1. Create `PathMatchingService` interface
2. Implement `DefaultPathMatchingService` class
3. Add pattern caching and validation
4. Integrate with configuration system

### Phase 2: Integration and Optimization

1. Update `videoHandler.ts` to use the new service
2. Refactor `TransformVideoCommand.ts` to use the service
3. Update `TransformationService.ts` for consistency
4. Add performance metrics and logging

### Phase 3: Testing and Tools

1. Create pattern testing utilities
2. Add debug views for pattern matching
3. Write comprehensive tests for all scenarios
4. Create pattern debugging documentation

## Benefits

1. **Performance**:
   - Reduced regex compilation
   - Faster pattern matching
   - Better memory usage

2. **Maintainability**:
   - Centralized pattern handling
   - Better testing and validation
   - Comprehensive logging and debugging

3. **Architecture**:
   - Reduced circular dependencies
   - Cleaner service boundaries
   - Better separation of concerns

## Migration Plan

1. **Create New Service**: Implement the service without changing existing code
2. **Add Adapter**: Create an adapter that uses the new service internally
3. **Update References**: Replace direct path utils usage with the service
4. **Remove Duplicated Code**: Clean up after full migration

This approach ensures backward compatibility while improving the system architecture.