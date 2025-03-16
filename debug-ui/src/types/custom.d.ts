import type { DiagnosticsInfo } from './diagnostics';

declare global {
  interface Window {
    DIAGNOSTICS_DATA?: DiagnosticsInfo;
  }
}