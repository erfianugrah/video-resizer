# Origins Migration Plan

This document outlines a comprehensive plan for migrating from the current `pathPatterns`, `pathTransforms`, and `storage` configuration approach to the new unified `origins` schema. The plan includes all necessary code changes, testing strategies, and a rollout approach.

## 1. Core Implementation Files

### Phase 1: Create New Interfaces and Services

| File | Changes |
|------|---------|
| `/src/services/videoStorage/interfaces.ts` | - Add new `Origin`, `Source`, and updated `Auth` interfaces<br>- Add new version of `VideoResizerConfig` with origins |
| `/src/services/origins/OriginResolver.ts` | - Create new file<br>- Implement pattern matching<br>- Implement path resolution for each source type<br>- Provide fallback to legacy methods |
| `/src/services/origins/index.ts` | - Create exports for the origins module |
| `/src/utils/originUtils.ts` | - Create new utilities for working with origins |

### Phase 2: Update Core Storage Services

| File | Changes |
|------|---------|
| `/src/services/videoStorage/fetchVideo.ts` | - Update to use OriginResolver<br>- Refactor fetch logic to work with origins<br>- Add backward compatibility |
| `/src/services/videoStorage/remoteStorage.ts` | - Update to use source-specific path resolution<br>- Refactor authentication logic |
| `/src/services/videoStorage/fallbackStorage.ts` | - Update to use source-specific path resolution<br>- Simplify fallback logic |
| `/src/services/videoStorage/index.ts` | - Update exports<br>- Add backward compatibility layer |

## 2. Configuration Changes

### Phase 1: Update Configuration Interfaces

| File | Changes |
|------|---------|
| `/src/config/videoConfig.ts` | - Add new origins interfaces<br>- Update VideoConfig interface<br>- Preserve backward compatibility |
| `/src/config/VideoConfigurationManager.ts` | - Add support for origins schema<br>- Implement conversion from old to new schema<br>- Update validation logic |
| `/config/worker-config.json` | - Create version with new origins schema<br>- Preserve for reference |
| `/config/worker-config-comprehensive.json` | - Update with new origins schema<br>- Preserve for reference |

### Phase 2: Validation and Conversion Utilities

| File | Changes |
|------|---------|
| `/src/config/validation/originSchema.ts` | - Create schema validation for origins<br>- Implement conversion utilities |
| `/tools/config-migration.js` | - Create new utility for migrating configs |

## 3. Handler and Command Updates

| File | Changes |
|------|---------|
| `/src/handlers/videoHandler.ts` | - Update to use OriginResolver<br>- Modify request handling for origins |
| `/src/handlers/videoHandlerWithCache.ts` | - Update to use OriginResolver<br>- Modify cache key generation for origins |
| `/src/domain/commands/TransformVideoCommand.ts` | - Update to use origins<br>- Modify transformation logic |

## 4. Path and URL Utilities Updates

| File | Changes |
|------|---------|
| `/src/utils/pathUtils.ts` | - Add backward compatibility layer<br>- Refactor to use OriginResolver where needed |
| `/src/utils/urlTransformUtils.ts` | - Update to use origins<br>- Simplify transformation logic |
| `/src/utils/presignedUrlUtils.ts` | - Update to use source-specific authentication |

## 5. TTL and Caching Updates

| File | Changes |
|------|---------|
| `/src/utils/determineTTL.ts` | - Update to use origin TTL settings<br>- Simplify TTL determination logic |
| `/src/utils/cacheUtils.ts` | - Update cache key generation<br>- Support origin-specific caching strategies |

## 6. Testing Strategy

### Unit Tests

| Test Category | Description |
|--------------|-------------|
| OriginResolver Tests | - Test matching patterns<br>- Test path resolution<br>- Test source priority handling |
| Configuration Tests | - Test parsing origins config<br>- Test backward compatibility<br>- Test validation |
| Storage Service Tests | - Test R2/remote/fallback handling<br>- Test error cases and fallbacks |

### Integration Tests

| Test Category | Description |
|--------------|-------------|
| End-to-End Request Flow | - Test complete request handling<br>- Verify correct origin and source selection |
| Multiple Source Testing | - Test fallback between sources<br>- Test priority handling |
| Migration Tests | - Test conversion of old configs to new format |

### Files to Update/Create

| File | Changes |
|------|---------|
| `/test/services/origins/OriginResolver.spec.ts` | - Create new test file |
| `/test/utils/originUtils.spec.ts` | - Create new test file |
| `/test/config/VideoConfigurationManager.spec.ts` | - Update for origins support |
| `/test/integration/origin-resolution.spec.ts` | - Create new integration tests |
| All existing tests using pathPatterns | - Update to work with new approach |

## 7. Implementation Phases and Rollout Plan

### Phase 1: Foundation (Week 1)

1. Create interfaces and initial implementation
2. Set up configuration structures
3. Build core OriginResolver service
4. Write unit tests for new components
5. Create documentation for new schema

### Phase 2: Core Services (Week 2)

1. Update storage services
2. Update handlers
3. Implement backward compatibility layers
4. Create migration utilities
5. Update existing tests

### Phase 3: Additional Components (Week 3)

1. Update URL and path utilities
2. Update caching and TTL logic
3. Add comprehensive integration tests
4. Create examples using new approach

### Phase 4: Final Migration and Rollout (Week 4)

1. Finalize documentation
2. Create migration guide
3. Convert existing configs
4. Conduct performance testing
5. Deploy to staging environment
6. Deploy to production with feature flag

## 8. Backward Compatibility Strategy

1. Use schema version detection
2. Auto-convert from old to new schema when loading configs
3. Support both methods during transition
4. Provide clear config validation errors
5. Support mixed configurations (some origins, some pathPatterns)

## 9. Documentation Updates

| Document | Changes |
|----------|---------|
| `/docs/configuration/config-management.md` | - Document origins schema<br>- Update examples |
| `/docs/configuration/configuration-guide.md` | - Add origins section<br>- Update recommendations |
| `/docs/reference/configuration-schema.md` | - Update with new origins schema |
| `/docs/migration/origins-migration.md` | - Create migration guide |

## 10. Risk Assessment and Mitigation

| Risk | Mitigation |
|------|------------|
| Performance Impact | - Benchmark new vs old approach<br>- Optimize critical paths |
| Breaking Changes | - Provide thorough backward compatibility<br>- Create detailed migration guide |
| Complex Migration | - Provide automated migration tools<br>- Support partial migrations |
| Testing Coverage | - Create comprehensive test suite<br>- Add integration tests |
| Documentation Gaps | - Update all affected documentation<br>- Provide clear examples |

## 11. Future Enhancements

1. Add support for more dynamic source selection
2. Implement origin-specific caching strategies
3. Add metrics for origin performance
4. Create visual origin configuration UI
5. Optimize path matching algorithms

## Conclusion

This migration will significantly improve the maintainability and usability of the video-resizer project by simplifying its configuration approach. The plan provides a structured approach to implementing these changes while ensuring backward compatibility and thorough testing.