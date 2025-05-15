/**
 * Interface for video transformation strategies
 * Implements the Strategy pattern for different transformation types
 */
import { VideoTransformOptions } from '../commands/TransformVideoCommand';
import { DiagnosticsInfo } from '../../utils/debugHeadersUtils';
import { PathPattern } from '../../utils/pathUtils';

import { Origin } from '../../services/videoStorage/interfaces';
import { SourceResolutionResult } from '../../services/origins/OriginResolver';

export interface TransformationContext {
  request: Request;
  options: VideoTransformOptions;
  pathPattern: PathPattern;
  url: URL;
  path: string;
  diagnosticsInfo: DiagnosticsInfo;
  env?: { 
    ASSETS?: { 
      fetch: (request: Request) => Promise<Response> 
    } 
  };
  // Origins-specific fields
  origin?: Origin;
  sourceResolution?: SourceResolutionResult;
}

export type TransformParamValue = string | number | boolean | null | Record<string, unknown>;
export type TransformParams = Record<string, TransformParamValue>;

/**
 * Base interface for all transformation strategies
 */
export interface TransformationStrategy {
  /**
   * Prepare parameters for this specific transformation strategy
   * @param context The transformation context
   * @returns The prepared CDN parameters
   */
  prepareTransformParams(context: TransformationContext): TransformParams;
  
  /**
   * Validate the options for this strategy
   * @param options The transformation options
   * @throws Error if options are invalid
   */
  validateOptions(options: VideoTransformOptions): void | Promise<void>;
  
  /**
   * Update diagnostics information with strategy-specific details
   * @param context The transformation context
   */
  updateDiagnostics(context: TransformationContext): void;
}