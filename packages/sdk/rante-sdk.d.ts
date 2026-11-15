// Type definitions for @rante/sdk 0.1.0 (rante-sdk.js).

export type RantePermission =
  | 'user.read'
  | 'user.email'
  | 'tenant.read'
  | 'auth.token'
  | 'notifications'
  | 'navigation'
  | 'clipboard.write';

export type RanteErrorCode =
  | 'not_in_host'
  | 'not_connected'
  | 'timeout'
  | 'permission_denied'
  | 'not_supported'
  | 'invalid_request'
  | 'rate_limited'
  | 'unavailable'
  | 'host_error';

export declare class RanteError extends Error {
  readonly name: 'RanteError';
  readonly code: RanteErrorCode | string;
  constructor(code: string, message: string);
}

export interface RanteInitOptions {
  /** Your app's Application (client) ID. The host refuses the connection when it frames a different app. */
  appId?: string;
  /** How long to wait for the host, in milliseconds. Default 10000. */
  timeoutMs?: number;
  /** Tell the host the app has loaded as soon as it connects (default true). Pass false and call ready() later. */
  ready?: boolean;
  /** Report the page height to the host whenever it changes (default false). */
  autoResize?: boolean;
  /** The host pages allowed to talk to the app. Default ['https://portal.rante.com']. */
  hostOrigins?: string[];
}

export interface RanteHostInfo {
  protocol: number;
  host: { name: string; version?: string };
  app: { id?: string; version?: string };
  /** The permissions the tenant's admin granted to this app. */
  permissions: string[];
  /** The methods this host answers (for example 'auth.getToken'). */
  capabilities: string[];
  locale: string;
  theme: 'light' | 'dark';
}

export interface RanteUser {
  id?: string;
  displayName?: string;
  /** Present only with the 'user.email' permission. */
  email?: string;
}

export interface RanteTenant {
  id?: string;
  name?: string;
}

export interface RanteContext {
  locale: string;
  theme: 'light' | 'dark';
  /** Present with 'user.read' (id, displayName) and/or 'user.email' (email). */
  user?: RanteUser;
  /** Present with 'tenant.read'. */
  tenant?: RanteTenant;
}

export interface RanteAccessToken {
  /** A JWT issued by login.rante.com for your app (aud = your app's client ID). Validate it on your server. */
  token: string;
  /** When the token expires, in milliseconds since 1970-01-01 UTC. */
  expiresOn: number;
}

export interface RanteEvents {
  'theme.changed': { theme: 'light' | 'dark' };
  'context.changed': Record<string, never>;
}

export interface RanteClient {
  /** Connects to the Rante host. Call it once, before anything else; later calls return the same promise. */
  init(options?: RanteInitOptions): Promise<RanteHostInfo>;
  isConnected(): boolean;
  getHostInfo(): RanteHostInfo | null;
  hasPermission(scope: RantePermission | string): boolean;
  supports(method: string): boolean;
  getContext(): Promise<RanteContext>;
  /** Needs 'user.read'. */
  getUser(): Promise<RanteUser>;
  /** Needs 'tenant.read'. */
  getTenant(): Promise<RanteTenant>;
  /** Needs 'auth.token'. Tokens are cached until a minute before they expire. */
  getAccessToken(options?: { forceRefresh?: boolean }): Promise<RanteAccessToken>;
  /** Needs 'notifications'. */
  notify(message: string, options?: { kind?: 'info' | 'success' | 'warning' | 'error' }): Promise<void>;
  /** Needs 'navigation'. target 'blank' opens a new tab (default); 'self' opens a Rante page in place. */
  openUrl(url: string, options?: { target?: 'blank' | 'self' }): Promise<void>;
  /** Tells the host the frame's height; measures the page when height is omitted. */
  resize(height?: number): Promise<void>;
  setTitle(title: string): Promise<void>;
  /** Tells the host the app has finished loading (when init was called with ready: false). */
  ready(): Promise<void>;
  on<K extends keyof RanteEvents>(event: K, handler: (data: RanteEvents[K]) => void): () => void;
  on(event: string, handler: (data: Record<string, unknown>) => void): () => void;
  off(event: string, handler: (data: any) => void): void;
  /** Sends a raw protocol request (see docs/protocol.md). */
  request<T = unknown>(method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<T>;
  /** Closes the connection to the host. */
  disconnect(): void;
}

export interface RanteSdk extends RanteClient {
  readonly version: string;
  readonly PROTOCOL_VERSION: number;
  readonly RanteError: typeof RanteError;
  /** Creates a client bound to another window (for tests). */
  create(win: Window): RanteClient;
}

declare const Rante: RanteSdk;
export default Rante;

declare global {
  interface Window {
    Rante: RanteSdk;
  }
}
