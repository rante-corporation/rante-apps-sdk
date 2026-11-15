// Type definitions for the host bridge of @rante/sdk 0.1.0 (rante-host.js, import '@rante/sdk/host').

export interface RanteHostHandlerContext {
  app: { id?: string; version?: string };
  permissions: string[];
}

export interface RanteHostHandlers {
  /** Return the full context; the bridge removes what the granted permissions do not allow. */
  'context.get'?(params: Record<string, never>, ctx: RanteHostHandlerContext): unknown | Promise<unknown>;
  'auth.getToken'?(params: Record<string, unknown>, ctx: RanteHostHandlerContext):
    { token: string; expiresOn: number } | Promise<{ token: string; expiresOn: number }>;
  'notifications.show'?(params: { message: string; kind: 'info' | 'success' | 'warning' | 'error' }, ctx: RanteHostHandlerContext): unknown;
  'navigation.open'?(params: { url: string; target: 'blank' | 'self' }, ctx: RanteHostHandlerContext): unknown;
}

export type RanteHostEvent = 'connected' | 'ready' | 'resize' | 'title' | 'rejected';

export interface RanteHostBridgeOptions {
  /** The host page's window. */
  window: Window;
  /** The app's iframe (or any object with a contentWindow). */
  frame: { contentWindow: Window | null };
  /** The app's exact origin: https://<label>.gallerycdn.rante.com, or the origin of an external app's entry point. */
  appOrigin: string;
  /** Accept http://localhost and http://127.0.0.1 origins (developer preview only). */
  allowDevelopmentOrigin?: boolean;
  app: { id: string; version?: string };
  /** The permissions the tenant granted to the app. Requests needing anything else are refused. */
  permissions: string[];
  host?: { name: string; version?: string };
  locale?: string;
  theme?: 'light' | 'dark';
  handlers?: RanteHostHandlers;
  onEvent?(type: RanteHostEvent, detail: Record<string, unknown>): void;
  /** Requests per second before the bridge answers rate_limited. Default 20. */
  maxRequestsPerSecond?: number;
  MessageChannel?: typeof MessageChannel;
  now?(): number;
}

export interface RanteHostBridge {
  isConnected(): boolean;
  setTheme(theme: 'light' | 'dark'): boolean;
  notifyContextChanged(): boolean;
  dispose(): void;
}

export interface RanteFrameAttributes {
  sandbox: string;
  allow: string;
  referrerpolicy: string;
  loading: string;
}

export declare const version: string;
export declare const PROTOCOL_VERSION: number;
export declare const METHOD_SCOPES: Record<string, string>;
export declare function createBridge(options: RanteHostBridgeOptions): RanteHostBridge;
export declare function frameAttributes(app: { hosting: 'bundle' | 'external'; permissions?: string[] }): RanteFrameAttributes;
