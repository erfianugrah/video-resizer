# Path Pattern Troubleshooting Guide

This guide addresses common issues with path pattern matching in the video-resizer and provides strategies for debugging and resolving them.

## Common Issues

### 1. Path Patterns Not Matching

If your path patterns aren't matching as expected, check the following:

#### Regular Expression Syntax

- **Escaping Special Characters**: When matching literal periods in file extensions (e.g., `.mp4`), make sure to escape the period in the regular expression: `\\.mp4`. In JSON configuration, this requires double escaping: `\\\\.mp4` or using the more readable `\\.mp4`.

  ```json
  // Correct
  { "matcher": "^/(.*\\.mp4)" }
  
  // Incorrect
  { "matcher": "^/(.*\\.mp4)" }
  ```

- **Beginning/End Anchors**: Make sure your regex uses the correct anchors. `^` matches the beginning of a string, and `$` matches the end.

#### Pattern Priority

- Patterns are evaluated in order of their `priority` value (highest first). If no priority is specified, they're evaluated in the order they appear in the configuration.
- Ensure that more specific patterns have higher priority than more general ones.

### 2. Configuration Loading Issues

If your path patterns are defined correctly but still not being applied, the issue might be with how the configuration is loaded:

- **KV Store Access**: Ensure that the KV namespace binding is correctly set and accessible.
- **Configuration Loading Timing**: The configuration might not be fully loaded when the first requests are processed.

## Debugging Strategies

### Enable Debug Logging

1. Add `debug=true` to your request URL as a query parameter to enable debug mode:
   ```
   https://your-worker.example.com/video.mp4?debug=true
   ```

2. Check the response headers for debug information:
   - `X-Debug-Path-Match`: Shows which pattern matched the URL
   - `X-Debug-Path-Patterns`: Shows how many path patterns were available

### Use Console Logging

Our code includes extensive console logging to help troubleshoot path pattern issues. In the Cloudflare dashboard, you can view these logs in real-time:

1. Go to Workers & Pages > your-worker > Logs
2. Look for logs related to:
   - Path pattern loading: `Path patterns after loading from KV`
   - Pattern testing: `Testing pattern #X`
   - Pattern matching results: `Path pattern matching result`

### Implementation Details

The pattern matching process works as follows:

1. Configuration is loaded from KV storage at startup and cached
2. For each request, the path is extracted from the URL
3. Each pattern is tested against the path in order of priority
4. The first matching pattern is used to determine how to handle the request
5. If `processPath` is `true`, the video is transformed according to the pattern
6. If no match is found or `processPath` is `false`, the request is passed through to origin

## Examples From Log Output

Here's an example of a successful pattern match in the logs:

```
[PathUtils] Testing pattern #3: standard { matcher: '^/(.*\\.mp4)', path: '/erfi.mp4' }
[PathUtils] Pattern #3 test result: MATCH {
  pattern: 'standard',
  matcher: '^/(.*\\.mp4)',
  regexObj: '/^\\/(.*\\.mp4)/',
  path: '/erfi.mp4'
}
[PathUtils] Found matching pattern: standard { matcher: '^/(.*\\.mp4)', path: '/erfi.mp4', processPath: true }
```

## Advanced Troubleshooting

For more complex issues, you can add detailed request tracing by adding the `X-Debug-Trace: true` header to your requests. This will include:

- Request flow through the worker
- Path matching attempts
- Configuration loading steps
- Detailed timing information

## Best Practices for Path Patterns

1. **Be Specific**: Define patterns that precisely match your URL structure
2. **Test Thoroughly**: Verify patterns with sample URLs before deploying
3. **Order by Specificity**: More specific patterns should have higher priority
4. **Use Named Capture Groups**: For better readability and maintenance
5. **Include Fallback Pattern**: Always include a catch-all pattern with lowest priority