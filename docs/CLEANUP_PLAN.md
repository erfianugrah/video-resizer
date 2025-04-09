# Documentation Cleanup Plan

*Last Updated: April 9, 2025*

## Current Issues

The current documentation has several issues:

1. **Fragmentation**: Documentation is spread across multiple directories with overlapping content
2. **Inconsistent Naming**: Files use inconsistent naming conventions 
3. **Redundancy**: Multiple files cover the same topics with slightly different information
4. **Outdated Information**: Some documents contain outdated information

## Cleanup Approach

Instead of creating a new structure in parallel, we're focusing on cleaning up the existing documentation:

1. **Identify Core Documents**: Determine the essential documentation files that should be kept
2. **Consolidate Content**: Merge redundant documentation into these core files
3. **Remove Outdated Files**: Delete files that are no longer relevant
4. **Standardize Naming**: Update filenames to follow a consistent convention

## Progress

### Completed Tasks

1. **Moved Root Documents to Appropriate Directories**
   - Moved ARCHITECTURE_ROADMAP.md to docs/architecture/
   - Moved ERROR_HANDLING_NEXT.md to docs/error-handling/next-steps.md
   - Moved DOCUMENTATION.md to docs/

2. **Fixed Broken Documentation Links**
   - Fixed IMQuery link in configuration README to point to features directory
   - Fixed logging configuration link to point to features directory
   - Updated README references for moved files

3. **Removed Duplicate Files**
   - Removed duplicate error handling next steps document
   - Updated references to point to correct files

4. **Created New Documentation Sections**
   - Added environment configuration documentation
   - Created environments directory with README
   - Updated main documentation index with environment section

### Remaining Tasks

1. **Review Archive Directory**
   - Evaluate files in the archive directory for relevant content
   - Move relevant content to main documentation
   - Consider removing the archive directory entirely

2. **Standardize Naming Conventions**
   - Use consistent kebab-case (lowercase-with-dashes) for all filenames
   - Use uppercase for core reference documents (e.g., README.md, CONFIGURATION_REFERENCE.md)

3. **Consolidate Configuration Documentation**
   - Merge smaller configuration files into the main reference document
   - Reduce duplication in configuration documentation
   - Improve cross-references between related documentation

4. **Improve Documentation Index**
   - Enhance the main documentation index with better organization
   - Add clearer categorization of documentation
   - Improve navigation between related documents

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