# Documentation Cleanup Plan

*Last Updated: April 9, 2025*

## Current Issues

The current documentation has several issues:

1. **Fragmentation**: Documentation is spread across multiple directories with overlapping content
2. **Inconsistent Naming**: Files use inconsistent naming conventions 
3. **Redundancy**: Multiple files cover the same topics with slightly different information
4. **Outdated Information**: Some documents contain outdated information

## Cleanup Approach

Instead of creating a new structure in parallel, we'll focus on cleaning up the existing documentation:

1. **Identify Core Documents**: Determine the essential documentation files that should be kept
2. **Consolidate Content**: Merge redundant documentation into these core files
3. **Remove Outdated Files**: Delete files that are no longer relevant
4. **Standardize Naming**: Update filenames to follow a consistent convention

## Core Documents to Keep

### 1. Main Documentation

- `README.md` - Main project README with usage examples
- `docs/README.md` - Documentation index

### 2. Architecture Documentation

- `docs/architecture/ARCHITECTURE_OVERVIEW.md` - Main architecture document
- `docs/architecture/DEPENDENCY_INVERSION_PLAN.md` - DI implementation

### 3. Configuration Documentation

- `docs/configuration/README.md` - Configuration overview
- `docs/configuration/CONFIGURATION_REFERENCE.md` - Complete reference

### 4. Error Handling

- `docs/error-handling/README.md` - Main error handling guide

### 5. Deployment

- `docs/deployment/README.md` - Deployment guide
- `docs/deployment/DEPLOYMENT_ISSUES_FIXED.md` - Recent fixes
- `docs/deployment/FUTURE_RECOMMENDATIONS.md` - Future improvements

### 6. Features

- One README per feature in the features directory

## Files to Remove or Consolidate

### 1. Archive Directory

- All files in `docs/archive` - Move any relevant content to main files

### 2. Redundant Configuration Docs

- Consolidate smaller configuration files into the reference document

### 3. Outdated Architecture Docs

- Consolidate older versions into the main architecture documents

## Implementation Steps

1. Review and update core documents
2. Extract useful information from redundant documents
3. Delete outdated files
4. Update cross-references

## Timeline

This cleanup will be implemented in a single focused effort to minimize disruption.