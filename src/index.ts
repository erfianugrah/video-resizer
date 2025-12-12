/**
 * Video Resizer Worker
 *
 * This worker transforms video requests by modifying URLs to use Cloudflare video parameters
 * via the cdn-cgi path for resizing videos on the fly.
 *
 * - Run `npm run dev` to start a development server
 * - Run `npm run deploy` to publish your worker
 */

import { handleVideoRequest } from "./handlers/videoHandler";
import { handleConfigGet, handleConfigUpload } from "./handlers/configHandler";
import {
  EnvironmentConfig,
  EnvVariables,
  getEnvironmentConfig,
} from "./config/environmentConfig";
import { initializeConfiguration } from "./config";
import { initializeLogging } from "./utils/loggingManager";
import {
  createRequestContext,
  updateBreadcrumbConfig,
} from "./utils/requestContext";
import { createLogger } from "./utils/pinoLogger";
import { initializeLegacyLogger } from "./utils/legacyLoggerAdapter";
import { LoggingConfigurationManager } from "./config/LoggingConfigurationManager";
import { getKVNamespace } from "./utils/flexibleBindings";
import { createCategoryLogger } from "./utils/logger";
import * as Sentry from "@sentry/cloudflare";

// Create a category-specific logger for Worker
const workerLogger = createCategoryLogger("Worker");

/**
 * Helper functions for consistent logging in the index module
 * These need special handling because they're used before request context is available
 */

/**
 * Log an info message with proper context handling
 */
function logInfo(
  context: any,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (context?.requestId) {
    // If we have a proper context, use the centralized logger
    workerLogger.info(message, { ...data, hasContext: true });
  } else {
    // Fallback to console if the logger isn't ready yet
    console.info(`Worker: ${message}`, data || {});
  }
}

/**
 * Log an error message with proper context handling
 */
function logError(
  context: any,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (context?.requestId) {
    // If we have a proper context, use the centralized logger
    workerLogger.error(message, { ...data, hasContext: true });
  } else {
    // Fallback to console if the logger isn't ready yet
    console.error(`Worker: ${message}`, data || {});
  }
}

/**
 * Log a debug message with proper context handling
 */
function logDebug(
  context: any,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (context?.requestId) {
    // If we have a proper context, use the centralized logger
    workerLogger.debug(message, { ...data, hasContext: true });
  } else {
    // Fallback to console if the logger isn't ready yet
    console.debug(`Worker: ${message}`, data || {});
  }
}

// Global environment config that will be populated at runtime
let runtimeConfig: EnvironmentConfig | null = null;
let hasInitialized = false;

export default Sentry.withSentry<EnvVariables>(
  (env: EnvVariables) => ({
    dsn: env.SENTRY_DSN,
    integrations: [
      Sentry.consoleLoggingIntegration({
        levels: ["log", "warn", "error", "debug", "trace"],
      }),
    ],
    tracesSampleRate: 1.0,
    sendDefaultPii: true,
    enableLogs: true,
    enableMetrics: true,
  }),
  {
    async fetch(
      request: Request,
      env: EnvVariables,
      ctx: ExecutionContext,
    ): Promise<Response> {
      // Create request context and logger at the entry point, passing execution context for waitUntil
      const context = createRequestContext(request, ctx);
      const logger = createLogger(context);

      // Initialize legacy logger for backward compatibility
      initializeLegacyLogger(request);

      try {
        // Initialize the runtime config if not already done
        if (!runtimeConfig || !hasInitialized) {
          runtimeConfig = getEnvironmentConfig(env);

          // Initialize the configuration managers instead of setting globals directly
          try {
            // Initialize the configuration system with environment variables
            // This will properly configure all managers (Debug, Logging, etc.)
            // Only call this once
            initializeConfiguration(env);

            // Get the logging configuration and explicitly update breadcrumb config
            const loggingConfig = LoggingConfigurationManager.getInstance();
            const breadcrumbConfig = loggingConfig.getBreadcrumbConfig();
            updateBreadcrumbConfig(breadcrumbConfig);

            // Try to load dynamic configuration from KV if available
            const configKV = getKVNamespace(
              env,
              "CONFIG_KV_NAME",
              "VIDEO_CONFIGURATION_STORE",
            );
            if (configKV) {
              try {
                // Import the ConfigurationService (dynamic import to avoid circular deps)
                const { ConfigurationService } = await import(
                  "./services/configurationService"
                );
                const configService = ConfigurationService.getInstance();

                // Initialize the configuration service with fast non-blocking initialization
                configService.initialize(env);

                // Attempt to load configuration from KV
                logInfo(context, "Attempting to load configuration from KV");
                const kvConfig = await configService.loadConfiguration(env);

                if (kvConfig) {
                  logInfo(
                    context,
                    "Successfully loaded configuration from KV",
                    {
                      version: kvConfig.version,
                      lastUpdated: kvConfig.lastUpdated,
                    },
                  );

                  // Apply KV configuration to all config managers
                  try {
                    const { updateAllConfigFromKV } = await import("./config");

                    // Log configuration details before applying
                    logInfo(context, "About to apply KV configuration", {
                      hasVideoConfig: !!kvConfig.video,
                      hasCacheConfig: !!kvConfig.cache,
                      hasDebugConfig: !!kvConfig.debug,
                      hasLoggingConfig: !!kvConfig.logging,
                      hasPassthrough: !!kvConfig.video?.passthrough,
                      passthroughEnabled: kvConfig.video?.passthrough?.enabled,
                      version: kvConfig.version,
                      lastUpdated: kvConfig.lastUpdated,
                    });

                    // Add breadcrumb for debugging
                    if (context) {
                      const { addBreadcrumb } = await import(
                        "./utils/requestContext"
                      );
                      addBreadcrumb(
                        context,
                        "Configuration",
                        "Applying KV configuration",
                        {
                          hasVideoConfig: !!kvConfig.video,
                          hasPassthrough: !!kvConfig.video?.passthrough,
                          passthroughEnabled: kvConfig.video?.passthrough
                            ?.enabled,
                          hasBindings: !!env.VIDEOS_BUCKET,
                        },
                      );
                    }

                    updateAllConfigFromKV(kvConfig);

                    // Update Pino logger configuration after KV config is loaded
                    try {
                      const { updatePinoLoggerConfig } = await import(
                        "./utils/pinoLogger"
                      );
                      const updated = updatePinoLoggerConfig();
                      logInfo(context, "Updated Pino logger configuration", {
                        success: updated,
                      });
                    } catch (pinoErr) {
                      logError(
                        context,
                        "Error updating Pino logger configuration",
                        {
                          error: pinoErr instanceof Error
                            ? pinoErr.message
                            : String(pinoErr),
                        },
                      );
                    }

                    // Log detailed information about the path patterns after loading from KV
                    try {
                      const { VideoConfigurationManager } = await import(
                        "./config/VideoConfigurationManager"
                      );
                      const videoConfig = VideoConfigurationManager
                        .getInstance();
                      const pathPatterns = videoConfig.getPathPatterns();

                      // Log pattern information without testing specific paths
                      // This avoids hardcoding example paths in the logs

                      logInfo(context, "Path patterns after loading from KV", {
                        patternCount: pathPatterns.length,
                        patterns: pathPatterns.map((p) => ({
                          name: p.name,
                          matcher: p.matcher,
                          processPath: p.processPath,
                        })),
                      });

                      // Add breadcrumb for path patterns
                      if (context) {
                        const { addBreadcrumb } = await import(
                          "./utils/requestContext"
                        );
                        addBreadcrumb(
                          context,
                          "Configuration",
                          "Loaded path patterns from KV",
                          {
                            patternCount: pathPatterns.length,
                            // Include just names for breadcrumb to keep it lightweight
                            patternNames: pathPatterns.map((p) => p.name),
                          },
                        );
                      }
                    } catch (patternErr) {
                      logError(
                        context,
                        "Error logging path patterns after KV load",
                        {
                          error: patternErr instanceof Error
                            ? patternErr.message
                            : String(patternErr),
                        },
                      );
                    }

                    logInfo(
                      context,
                      "Applied KV configuration to all config managers",
                    );
                  } catch (updateErr) {
                    logError(context, "Error applying KV configuration", {
                      error: updateErr instanceof Error
                        ? updateErr.message
                        : String(updateErr),
                    });
                  }
                } else {
                  logInfo(
                    context,
                    "No configuration found in KV, using environment defaults",
                  );
                }
              } catch (configErr) {
                // Log error but continue with environment config
                logError(context, "Error loading configuration from KV", {
                  error: configErr instanceof Error
                    ? configErr.message
                    : String(configErr),
                  stack: configErr instanceof Error
                    ? configErr.stack
                    : undefined,
                });
              }
            }

            // Log initialization
            logInfo(context, "Initialized configuration from environment", {
              breadcrumbsEnabled: breadcrumbConfig.enabled,
              maxItems: breadcrumbConfig.maxItems,
            });
          } catch (err) {
            // Log initialization error
            const errMessage = err instanceof Error ? err.message : String(err);
            const errStack = err instanceof Error ? err.stack : undefined;
            logError(context, "Error initializing configuration", {
              error: errMessage,
              stack: errStack,
            });
          }

          // Initialize logging using our centralized manager
          initializeLogging(env);

          // Set flag to prevent repeated initialization
          hasInitialized = true;

          // Log successful initialization with version and config info
          logInfo(
            context,
            `Initialized video-resizer v${
              env.VERSION || "1.0.0"
            } in ${runtimeConfig.mode} mode with KV caching`,
            {
              loggingLevel: LoggingConfigurationManager.getInstance()
                .getLogLevel(),
              breadcrumbsEnabled: LoggingConfigurationManager.getInstance()
                .areBreadcrumbsEnabled(),
              maxBreadcrumbs: LoggingConfigurationManager.getInstance()
                .getMaxBreadcrumbs(),
            },
          );
        }

        // Log incoming request
        const requestUrl = new URL(request.url);
        logInfo(context, "Incoming request", {
          method: request.method,
          url: requestUrl.toString(),
          pathname: requestUrl.pathname,
          search: requestUrl.search,
        });

        // Track total requests
        Sentry.metrics.count("video_worker.requests.total", 1, {
          attributes: { method: request.method },
        });

        // Define patterns to skip resizing
        const skipPatterns = [
          (headers: Headers) => /video-resizing/.test(headers.get("via") || ""),
        ];

        // Check if this is a configuration API request

        if (requestUrl.pathname === "/admin/config") {
          logInfo(context, "Handling configuration request", {
            method: request.method,
          });

          // Track admin config requests
          Sentry.metrics.count("video_worker.admin_config.requests", 1, {
            attributes: { method: request.method },
          });

          if (request.method === "POST") {
            return handleConfigUpload(request, env);
          } else if (request.method === "GET") {
            return handleConfigGet(request, env);
          } else {
            return new Response("Method not allowed", { status: 405 });
          }
        }

        // Note: We've removed the specific static asset bypass since non-MP4 file passthrough
        // already handles this. All non-MP4 files are automatically passed through to origin.

        // Handle file format passthrough for non-MP4 videos
        // Import dynamically to avoid circular dependencies
        try {
          // Get the file extension
          const pathExtension = requestUrl.pathname.split(".").pop()
            ?.toLowerCase();

          // Log file extension detection for debugging
          logDebug(context, "Checking file extension for passthrough", {
            path: requestUrl.pathname,
            extension: pathExtension || "none",
            hasExtension: !!pathExtension,
            isMP4: pathExtension === "mp4",
          });

          // Add breadcrumb for file detection
          if (context) {
            const { addBreadcrumb } = await import("./utils/requestContext");
            addBreadcrumb(context, "Passthrough", "Detected file extension", {
              path: requestUrl.pathname,
              extension: pathExtension || "none",
              isMP4: pathExtension === "mp4",
            });
          }

          if (pathExtension && pathExtension !== "mp4") {
            // Dynamic import to avoid circular dependencies
            const { VideoConfigurationManager } = await import(
              "./config/VideoConfigurationManager"
            );
            const videoConfig = VideoConfigurationManager.getInstance();
            const passthroughConfig = videoConfig.getPassthroughConfig();

            // Log configuration access
            logInfo(context, "Retrieved passthrough configuration", {
              enabled: passthroughConfig.enabled,
              whitelistedFormatsCount:
                passthroughConfig.whitelistedFormats.length,
              whitelistedFormats: passthroughConfig.whitelistedFormats.join(
                ", ",
              ),
              extension: pathExtension,
              isWhitelisted: passthroughConfig.whitelistedFormats.includes(
                pathExtension,
              ),
            });

            // Add breadcrumb for config retrieval
            if (context) {
              const { addBreadcrumb } = await import("./utils/requestContext");
              addBreadcrumb(
                context,
                "Passthrough",
                "Retrieved passthrough configuration",
                {
                  enabled: passthroughConfig.enabled,
                  whitelistedFormatsCount:
                    passthroughConfig.whitelistedFormats.length,
                  extension: pathExtension,
                  isWhitelisted: passthroughConfig.whitelistedFormats.includes(
                    pathExtension,
                  ),
                },
              );
            }

            // Check storage bindings for diagnostics
            let hasR2 = false;
            if (env && env.VIDEOS_BUCKET) {
              hasR2 = true;
              logDebug(context, "R2 binding detected", {
                binding: "VIDEOS_BUCKET",
                available: true,
              });
            }

            // Check if passthrough is enabled and this format is not explicitly whitelisted
            if (
              passthroughConfig.enabled &&
              !passthroughConfig.whitelistedFormats.includes(pathExtension)
            ) {
              logInfo(
                context,
                "Non-MP4 video request - bypassing video processing",
                {
                  path: requestUrl.pathname,
                  extension: pathExtension,
                  reason: "unsupported-format",
                  passthroughEnabled: true,
                  hasR2: hasR2,
                },
              );

              // Add breadcrumb for passthrough decision
              if (context) {
                const { addBreadcrumb } = await import(
                  "./utils/requestContext"
                );
                addBreadcrumb(
                  context,
                  "Passthrough",
                  "Bypassing video processing",
                  {
                    path: requestUrl.pathname,
                    extension: pathExtension,
                    reason: "unsupported-format",
                  },
                );
              }

              // Track passthrough requests
              Sentry.metrics.count("video_worker.passthrough.total", 1, {
                attributes: { extension: pathExtension },
              });

              // Pass through non-MP4 videos directly
              return fetch(request);
            }
          }
        } catch (err) {
          // Log error but continue with normal processing
          logDebug(
            context,
            "Error checking file extension for passthrough, continuing with normal processing",
            {
              path: requestUrl.pathname,
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            },
          );

          // Add breadcrumb for error
          if (context) {
            const { addBreadcrumb } = await import("./utils/requestContext");
            addBreadcrumb(
              context,
              "Passthrough",
              "Error in passthrough check",
              {
                error: err instanceof Error ? err.message : String(err),
                path: requestUrl.pathname,
              },
            );
          }
        }

        // Check if we should skip resizing
        const shouldSkip = skipPatterns.some((pattern) =>
          pattern(request.headers)
        );

        if (!shouldSkip && runtimeConfig) {
          try {
            // Check if Origins configuration is available and should be used
            const { VideoConfigurationManager } = await import(
              "./config/VideoConfigurationManager"
            );
            const videoConfig = VideoConfigurationManager.getInstance();
            const useOrigins = videoConfig.shouldUseOrigins();

            if (useOrigins) {
              // Log the use of Origins system
              logInfo(
                context,
                "Using Origins configuration for video request",
                {
                  originsCount: videoConfig.getOrigins().length,
                  url: request.url,
                  path: requestUrl.pathname,
                },
              );

              // Add a breadcrumb for using Origins
              if (context) {
                const { addBreadcrumb } = await import(
                  "./utils/requestContext"
                );
                addBreadcrumb(
                  context,
                  "Origins",
                  "Using Origins configuration",
                  {
                    path: requestUrl.pathname,
                    originsCount: videoConfig.getOrigins().length,
                  },
                );
              }

              // Import and use the fetchVideoWithOrigins handler
              const { handleVideoRequestWithOrigins } = await import(
                "./handlers/videoHandlerWithOrigins"
              );
              return handleVideoRequestWithOrigins(
                request,
                runtimeConfig,
                env,
                ctx,
              );
            }

            // Fall back to the standard handler if Origins are not configured
            return handleVideoRequest(request, runtimeConfig, env, ctx);
          } catch (err) {
            // Log error but continue with standard handler
            logError(context, "Error checking for Origins configuration", {
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            });

            // Fall back to standard handler
            return handleVideoRequest(request, runtimeConfig, env, ctx);
          }
        }

        logInfo(context, "Skipping video processing, passing through request");
        return fetch(request); // pass-through and continue
      } catch (err: unknown) {
        const errorMessage = err instanceof Error
          ? err.message
          : "Unknown error";
        const errorStack = err instanceof Error ? err.stack : undefined;

        // Add breadcrumb for worker-level error
        if (context) {
          const { addBreadcrumb } = await import("./utils/requestContext");
          addBreadcrumb(context, "Error", "Unexpected worker error", {
            error: errorMessage,
            url: request.url,
          });
        }

        logError(context, "Unexpected error in worker", {
          error: errorMessage,
          stack: errorStack,
        });

        // Capture exception to Sentry (skip AbortErrors)
        if (err instanceof Error && err.name !== 'AbortError') {
          Sentry.captureException(err, {
            tags: {
              handler: 'worker',
              url: request.url,
            },
            contexts: {
              request: {
                url: request.url,
                method: request.method,
              },
            },
          });
        }

        // Track worker errors
        Sentry.metrics.count("video_worker.errors.total", 1, {
          attributes: {
            error_type: err instanceof Error ? err.name : "unknown",
          },
        });

        return new Response("An unexpected error occurred", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        });
      }
    },
  },
) satisfies ExportedHandler<EnvVariables>;
