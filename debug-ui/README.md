# Video Resizer Debug UI

A modern, interactive debug UI for Video Resizer built with Astro and shadcn/ui components.

## Features

- 🚀 **Astro-powered**: Fast, static site generation with minimal JavaScript
- 🧩 **Component-based**: Modular architecture with reusable components
- 🌙 **Dark mode support**: Toggle between light and dark themes with system preference detection
- 📱 **Responsive design**: Works on all device sizes from mobile to desktop
- ♿ **Accessible**: Built with accessibility in mind using ARIA standards
- 🔍 **Diagnostic tools**: Visualize and debug video transformation processes
- ⚙️ **Configuration Viewer**: Interactive tabbed interface to explore configuration settings
- 🔄 **JSON Prettifier**: Format and copy diagnostic data with syntax highlighting
- ⚡ **Minimal JS**: Partial hydration for interactive components only
- 🔒 **Type-safe**: Full TypeScript integration for reliable development

## Tech Stack

- **Astro**: Zero-JS-by-default page rendering with islands architecture
- **React**: Interactive UI components with minimal client hydration
- **TypeScript**: Type-safe development experience
- **Tailwind CSS**: Utility-first styling
- **shadcn/ui**: High-quality, accessible UI components based on Radix UI
- **Lucide Icons**: Beautiful, consistent iconography

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm 9+
- Video Resizer project setup

### Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

This will start a local development server at http://localhost:4321.

### Building for Production

There are several ways to build and deploy the Debug UI:

#### Option 1: Step-by-step manual process

```bash
# Step 1: Build the debug UI
npm run build

# Step 2: Copy to worker's public directory
npm run copy-to-worker
```

#### Option 2: Combined script (recommended)

```bash
# Build and copy in one step (simple)
npm run build-debug-ui
```

#### Option 3: Advanced script with special handling

```bash
# Uses scripts/build-and-copy.js for special handling
npm run build-and-copy
```

The differences between these approaches:
- `build-debug-ui`: Simple sequence of build then copy (npm run build && npm run copy-to-worker)
- `build-and-copy`: Uses a Node.js script with enhanced handling of paths and debug.html file

### Type Checking

```bash
# Run TypeScript checks without emitting files
npm run check
```

## Project Structure

```
/debug-ui/
├── src/
│   ├── components/          # UI components
│   │   ├── dashboard/       # Dashboard-specific components
│   │   │   ├── StatCard.tsx         # Metrics display
│   │   │   ├── InfoRow.tsx          # Key-value display
│   │   │   ├── MediaPreview.tsx     # Video preview
│   │   │   ├── DiagnosticJSON.tsx   # JSON viewer
│   │   │   └── ConfigurationViewer.tsx # Config display
│   │   ├── shared/          # Shared components
│   │   │   ├── ThemeToggle.tsx      # Dark mode toggle
│   │   │   └── ThemeProvider.tsx    # Theme context
│   │   └── ui/              # shadcn UI components
│   │       ├── button.tsx           # Button component
│   │       ├── card.tsx             # Card component
│   │       └── tabs.tsx             # Tabs component
│   ├── layouts/             # Page layouts
│   │   └── MainLayout.astro         # Main layout with header
│   ├── pages/               # Astro pages
│   │   ├── index.astro              # Landing page
│   │   └── debug.astro              # Debug dashboard
│   ├── styles/              # Global styles
│   ├── types/               # TypeScript types
│   │   └── diagnostics.ts           # Diagnostic data interfaces
│   └── utils/               # Helper functions
│       ├── cn.ts                    # Class name utility
│       └── diagnostics.ts           # Data processing
├── public/                 # Static assets
├── scripts/                # Build scripts
│   └── build-and-copy.js            # Build automation
└── astro.config.mjs        # Astro configuration
```

## Integration with Worker

The debug UI is designed to be served from the Cloudflare Worker's assets. The integration works as follows:

1. Worker detects debug mode via URL parameters
2. Diagnostic information is collected about the request and transformation
3. Data is injected into the debug UI template using placeholder patterns
4. The complete debug UI is served to the client with minimal JavaScript
5. Interactive components are selectively hydrated on the client

### URL Parameters

- `?debug=view`: Show the debug UI with diagnostic information
- `?debug=true`: Add debug headers to the response without showing the UI
- `?debug=config`: Show configuration data in the debug UI
- `?debug=headers`: Include request/response headers in diagnostic data
- `?debug=all`: Show all available debug information

## Component Documentation

### Core Components

#### StatCard

Display key metrics with icons and optional descriptions:

```jsx
<StatCard 
  title="Processing Time" 
  value="125ms" 
  icon={Clock} 
  description="Total time to process request" 
/>
```

#### InfoRow

Display key-value pairs in a consistent format:

```jsx
<InfoRow label="Media Type" value="video/mp4" />
```

#### MediaPreview

Show video/image preview with controls:

```jsx
<MediaPreview 
  src="https://example.com/video.mp4" 
  type="video/mp4" 
  width={640} 
  height={360} 
/>
```

#### DiagnosticJSON

Interactive JSON viewer with syntax highlighting and copy functionality:

```jsx
<DiagnosticJSON data={diagnosticData} />
```

#### ConfigurationViewer

Tabbed interface for exploring configuration settings:

```jsx
<ConfigurationViewer config={configData} />
```

### Theme Toggle

The debug UI includes a dark mode toggle that:

1. Detects and uses system color preference by default
2. Allows manual toggle between light and dark modes
3. Persists preference in local storage
4. Provides smooth transition between themes

## Performance Considerations

- Only interactive components are hydrated with JavaScript
- Static content is generated at build time
- CSS is optimized with Tailwind's JIT compiler
- Assets are minified during production build
- Font files are preloaded for improved performance

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile browsers on iOS and Android
- IE is not supported

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Submit a pull request

## Future Enhancements

- Full configuration editor with validation
- Visual diff view for configuration changes
- Request/response timeline visualization
- Filter functionality for diagnostic data
- Export/import of debug data
- Integration with development tools

## License

See the main project license.