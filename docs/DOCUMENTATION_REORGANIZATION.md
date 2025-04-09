# Documentation Reorganization Plan

This document outlines a comprehensive plan for reorganizing and updating the documentation for the video-resizer project. The goal is to create a more structured, consistent, and current set of documentation that accurately reflects the project's architecture, features, and implementation details.

## Current Documentation Structure Issues

1. **Fragmentation**: Documentation is spread across multiple directories with overlapping content
2. **Outdated Information**: Some documents contain outdated information that no longer reflects the current implementation
3. **Inconsistent Naming**: Files use inconsistent naming conventions (kebab-case, snake_case, UPPER_CASE)
4. **Redundancy**: Multiple files cover the same topics with slightly different information
5. **Lack of Central Index**: No clear starting point for documentation navigation

## Reorganization Plan

### 1. Top-Level Documentation

These files will provide high-level overview and entry points to more detailed documentation:

| File | Status | Action |
|------|--------|--------|
| README.md | Update | Ensure it reflects current features and architecture |
| ARCHITECTURE.md | Create | Consolidate from multiple architecture documents |
| DEPLOYMENT.md | Create | Consolidate from deployment directory |
| TROUBLESHOOTING.md | Create | Common issues and solutions |
| CONTRIBUTING.md | Create | Contribution guidelines and development workflow |

### 2. Docs Directory Structure

The docs directory will be reorganized into these clear categories:

```
docs/
├── README.md                    # Documentation index
├── architecture/                # Architectural documentation
│   ├── README.md                # Architecture overview
│   ├── design-patterns.md       # Design patterns used
│   ├── dependency-injection.md  # DI implementation
│   └── component-diagram.md     # Component relationships
├── configuration/               # Configuration documentation
│   ├── README.md                # Configuration overview
│   ├── reference.md             # Complete configuration reference
│   ├── path-patterns.md         # Path pattern matching
│   ├── storage.md               # Storage configuration
│   ├── caching.md               # Cache configuration
│   └── dynamic-updates.md       # Dynamic configuration updates
├── features/                    # Feature documentation
│   ├── README.md                # Features overview
│   ├── transforms/              # Transformation features
│   ├── caching/                 # Caching features
│   ├── imquery/                 # IMQuery integration
│   └── client-detection/        # Client capability detection
├── deployment/                  # Deployment documentation
│   ├── README.md                # Deployment overview
│   ├── environments.md          # Environment setup
│   ├── auth.md                  # Authentication setup
│   └── monitoring.md            # Monitoring and debugging
├── tools/                       # Tools documentation
│   ├── README.md                # Tools overview
│   ├── config-upload.md         # Configuration upload tool
│   └── debugging.md             # Debugging tools
└── guides/                      # User guides
    ├── README.md                # Guides overview
    ├── quickstart.md            # Getting started
    ├── migration.md             # Migration guide
    └── advanced-usage.md        # Advanced usage examples
```

### 3. Content Consolidation Plan

| Source Files | Target File | Action |
|--------------|-------------|--------|
| ARCHITECTURE_OVERVIEW.md, ARCHITECTURE_PATTERNS.md | docs/architecture/README.md | Merge and update |
| DEPENDENCY_INVERSION_PLAN.md, REFINED_DEPENDENCY_INVERSION.md | docs/architecture/dependency-injection.md | Merge and update |
| configuration/*.md (multiple) | docs/configuration/reference.md | Consolidate into reference |
| deployment/DEPLOY.md, deployment/auth-setup.md | docs/deployment/README.md | Merge and update |
| error-handling/*.md (multiple) | docs/architecture/error-handling.md | Consolidate into single guide |
| kv-caching/*.md (multiple) | docs/features/caching/kv-cache.md | Consolidate KV cache docs |
| features/imquery/*.md (multiple) | docs/features/imquery/README.md | Merge IMQuery docs |

### 4. Files to Remove (After Content Migration)

1. Entire `docs/archive/` directory (after salvaging any relevant content)
2. Redundant files in `error-handling/` after consolidation
3. Outdated configuration guides after consolidation

## Implementation Approach

1. **Create New Structure**: First, create the new directory structure
2. **Migrate Content**: Move and consolidate content from existing files
3. **Update References**: Ensure all cross-references are updated
4. **Remove Redundant Files**: Remove files that have been consolidated
5. **Update READMEs**: Update README files at each level to provide navigation

## Documentation Standards

For all new and updated documentation:

1. **Header Structure**: Use clear heading hierarchy (# for title, ## for sections, etc.)
2. **File Naming**: Use kebab-case for all new files
3. **Content Sections**: Include standard sections (Overview, Usage, Configuration, Examples)
4. **Code Examples**: Provide code examples with syntax highlighting
5. **Dates**: Include "Last Updated" dates at the top of each document
6. **Cross-References**: Use relative links to reference other documentation
7. **Completeness**: Ensure each document stands on its own while avoiding redundancy

## Timeline

This reorganization will be implemented in phases:

1. **Phase 1**: Create new structure and migrate critical documentation
2. **Phase 2**: Consolidate redundant content
3. **Phase 3**: Update all cross-references
4. **Phase 4**: Review and remove outdated files

## Next Steps

1. Create the new directory structure
2. Migrate README.md and main architecture documents
3. Consolidate configuration documentation
4. Update deployment guides
5. Review and consolidate feature documentation