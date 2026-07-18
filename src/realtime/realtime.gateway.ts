import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ADMIN_ROOM, userRoom } from './realtime.contract';

/** Name of the httpOnly cookie the frontend BFF stores the access token in. */
const ACCESS_TOKEN_COOKIE = 'propmatch_access_token';

/** The verified JWT payload Mohamed's auth mints: `{ sub, email, role }`. */
interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

/**
 * PRO-06 realtime gateway.
 *
 * Transport only: it authenticates connections, files each socket into rooms,
 * and exposes two emit primitives. It holds no business logic — see
 * RealtimeService for the API teammates call.
 *
 * ## Handshake auth (compatibility note)
 * The frontend never exposes the JWT to client JS, so it CANNOT send
 * `auth: { token }` the usual way. Instead the browser connects with
 * `withCredentials` and the browser attaches the httpOnly cookie. Cookies
 * ignore ports, so a cookie set at :3000 reaches this gateway at :3001 locally.
 *
 * In production (different domains) that cookie won't cross without
 * `SameSite=None; Secure` + a shared parent domain, or a short-lived socket
 * ticket. We therefore ALSO accept a Bearer token via `auth.token` or the
 * Authorization header, for native clients, tests, and the cross-domain case.
 *
 * The JWT is verified with the SAME `JWT_SECRET` Mohamed's AuthModule signs
 * with — a mismatch there rejects every socket.
 */
@WebSocketGateway({
  cors: {
    // Reflect the request origin and allow credentials so the browser sends
    // the auth cookie. Lock this to the real web origin in production.
    origin: true,
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Reject unauthenticated sockets in a handshake middleware — before the
   * connection is established — so an anonymous client never sits in a room
   * and never receives another user's PII. It gets `connect_error`.
   */
  afterInit(server: Server): void {
    server.use(async (socket: Socket, next: (err?: Error) => void) => {
      try {
        const token = this.extractToken(socket);
        if (!token) throw new Error('missing token');
        const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
          secret: this.config.get<string>('JWT_SECRET') ?? 'fallback_secret',
        });
        socket.data.userId = payload.sub;
        socket.data.role = payload.role;
        next();
      } catch {
        // One opaque reason — never leak why (expired vs forged vs absent).
        next(new Error('UNAUTHORIZED'));
      }
    });
  }

  handleConnection(client: Socket): void {
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      // Belt-and-braces: middleware should have rejected already.
      client.disconnect(true);
      return;
    }
    client.join(userRoom(userId));
    if (this.isAdmin(client.data.role)) client.join(ADMIN_ROOM);
    this.logger.debug(`connected ${userId} (${String(client.data.role)})`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`disconnected ${String(client.data.userId)}`);
  }

  /* ------------------------------ emit primitives ----------------------- */

  /** Deliver an event to one user across all their open tabs. */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(userRoom(userId)).emit(event, payload);
  }

  /** Deliver an event to every connected admin. */
  emitToAdmins(event: string, payload: unknown): void {
    this.server.to(ADMIN_ROOM).emit(event, payload);
  }

  /* --------------------------------- helpers ---------------------------- */

  /** Cookie first (browser), then `auth.token`, then Authorization header. */
  private extractToken(socket: Socket): string | null {
    const fromCookie = this.readCookie(
      socket.handshake.headers.cookie,
      ACCESS_TOKEN_COOKIE,
    );
    if (fromCookie) return fromCookie;
    const fromAuth = (socket.handshake.auth as { token?: string })?.token;
    if (fromAuth) return fromAuth;
    const header = socket.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return null;
  }

  /**
   * Read one cookie from a raw Cookie header. Inlined rather than pulling a
   * cookie-parsing dependency into the auth path — the logic is trivial and
   * fully auditable here.
   */
  private readCookie(header: string | undefined, name: string): string | null {
    if (!header) return null;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === name) {
        return decodeURIComponent(part.slice(eq + 1).trim());
      }
    }
    return null;
  }

  /** JWT role is UPPERCASE (`ADMIN`); compare case-insensitively to be safe. */
  private isAdmin(role: unknown): boolean {
    return typeof role === 'string' && role.toUpperCase() === 'ADMIN';
  }
}
