# Video Resizer Debug UI Redesign

This document outlines the approach to redesigning the Video Resizer Debug UI using Astro and shadcn/ui components.

## Current Implementation

The current debug UI implementation:
- Uses plain HTML/CSS/JS with Bootstrap for styling
- Is rendered statically from Cloudflare Worker assets
- Provides a functional but basic diagnostic interface
- Has limited interactivity and somewhat dated styling

## Redesign Goals

1. **Performance Improvement**:
   - Faster rendering with Astro's partial hydration
   - Reduced bundle size compared to full React/Bootstrap
   - Better caching and resource loading

2. **Enhanced Developer Experience**:
   - Modern component-based architecture
   - Type-safe UI with TypeScript integration
   - Better separation of concerns

3. **Improved UI/UX**:
   - Modern, accessible design with shadcn/ui
   - Dark/light mode support
   - Responsive layout optimized for all devices
   - Improved data visualization

4. **New Features**:
   - Interactive configuration editor
   - Visual diff view for configuration changes
   - Expandable diagnostic sections
   - Request/response timeline visualization
   - Configuration validation feedback

## Technical Approach

### 1. Framework Selection

**Astro** provides several advantages for our use case:
- Zero-JS by default with optional islands of interactivity
- Excellent static site generation capabilities
- Small bundle sizes
- Partial hydration model ("Islands Architecture")
- TypeScript support
- Built-in asset optimization

**shadcn/ui** offers:
- High-quality, accessible React components
- Customizable design system based on Radix UI primitives
- Lightweight with minimal CSS-in-JS overhead
- Theming capabilities
- Comprehensive component library

### 2. Project Structure

```
/debug-ui/
├── src/
│   ├── components/     # UI components
│   │   ├── dashboard/  # Dashboard components
│   │   ├── shared/     # Shared components
│   │   └── ui/         # shadcn UI components
│   ├── layouts/        # Page layouts
│   ├── pages/          # Astro pages
│   ├── styles/         # Global styles
│   ├── types/          # TypeScript types
│   └── utils/          # Helper functions
├── public/             # Static assets
└── astro.config.mjs    # Astro configuration
```

### 3. Implementation Phases

#### Phase 1: Setup and Foundation
- Create Astro project structure
- Install and configure shadcn/ui
- Setup theming and global styles
- Migrate basic layout and structure

#### Phase 2: Component Implementation
- Implement dashboard components
- Build diagnostic displays
- Create configuration viewers
- Implement data visualizations

#### Phase 3: Interactive Features
- Add configuration editor
- Implement diff viewer
- Create validation feedback system
- Add interactive diagnostics

#### Phase 4: Integration with Worker
- Setup build process for Worker assets
- Optimize for Cloudflare deployment
- Implement Worker-side rendering logic
- Add API for diagnostic data retrieval

## Implementation Details

### Build Process

We'll need to integrate the Astro build with the Cloudflare Worker deployment:

1. Build the Astro site to static assets
2. Copy the built assets to the Worker's public directory
3. Ensure proper asset paths and MIME types
4. Update the Worker to inject diagnostic data correctly

### Worker Integration

The debug UI will be served by the Worker:

1. Worker detects debug mode via URL parameters
2. Worker collects diagnostic information
3. Worker serves the debug UI static assets
4. Diagnostic data is either:
   - Embedded as JSON in the HTML
   - Retrieved via a client-side API call

### Theming

We'll implement a consistent theme based on Cloudflare's design language:

1. Primary colors will use Cloudflare's blue/orange gradient
2. Dark/light mode toggle with system preference detection
3. Consistent spacing, typography, and color scales
4. Proper contrast ratios for accessibility

### Component Design

Key components to implement:

1. **DiagnosticHeader**
   - Shows basic metrics and status
   - Provides navigation

2. **MediaPreview**
   - Video/image preview with parameters
   - Controls for testing different parameters

3. **ConfigurationViewer**
   - Shows configuration values
   - Allows editing with validation
   - Displays validation errors

4. **RequestInfo**
   - Details about the HTTP request
   - Headers, parameters, path matching

5. **ClientInfo**
   - Device detection details
   - Network quality estimates
   - Browser capabilities

6. **CacheDetails**
   - Cache status information
   - TTL visualizations
   - Cache control details

7. **DiagnosticJSON**
   - Expandable JSON viewer
   - Syntax highlighting
   - Copy functionality

8. **ErrorDisplay**
   - Shows errors and warnings
   - Suggests solutions
   - Links to relevant documentation

## Dependencies

- **astro**: Core framework
- **@astrojs/react**: React integration
- **react**, **react-dom**: For interactive components
- **typescript**: Type checking
- **tailwindcss**: Utility CSS framework (used by shadcn/ui)
- **@radix-ui**: Accessible UI primitives
- **lucide-react**: Icon library
- **class-variance-authority**: For component variants
- **clsx**: Conditional class name utility
- **tailwind-merge**: Smart class merging for Tailwind

## Next Steps

1. Create proof of concept with basic layout
2. Get stakeholder feedback on design approach
3. Implement core components
4. Test integration with Worker
5. Refine and optimize
6. Documentation and developer guides